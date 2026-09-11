(function() {
    'use strict';

    // ========== State ==========
    var state = {
        regType: 'l2',
        regression: true,
        penalizeIntercept: true,
        lambda: 1.0,
        formulation: 'penalty', budget: 1,
        eccentricity: 4.0,
        cx: 1.5,         // loss center w1
        cy: 1.0,         // loss center w2
        alpha: 0.5,       // elastic net mixing
        rotation: 30,     // loss ellipse rotation in degrees
        cameraPreset: '3d',
        surfaceOpacity: 1,
        budgetWallOpacity: 1,
        viewMode: '3d',   // '3d' or 'contour'
        // Surface visibility
        showLoss: true,
        showPenalty: true,
        showTotal: false,
        showComponents: false,
        showBoth: true,
        showConstraint: true,
        // 3D camera
        yaw: -0.6,
        pitch: Math.PI/18,
        zoom: 1,
        heightMode: 'linear',
        stretch: 1.3,
        rimHeight: 6,
        bowlReveal: 1,
        autoHeight: true,
        dragging: false,
        lastMouse: null,
        // Gradient descent
        gdPath: [],
        gdAnimating: false,
        gdLR: 0.05,
        gdAnimFrame: null,
        // Computed
        optimum: null     // {w1, w2}
    };

    var regressionModel, regressionPoints=[], dataBounds, linkedControlSource=null;
    var selectedWeights=null, trackpadInput=true, weightSnapAnimation=0, weightRelease=null;
    var canvas3d;
    var canvasContour, ctxContour;

    // ========== Color Helpers ==========
    function budgetEmphasized() {return (linkedControlSource||state.formulation)==='budget';}
    function getCS() {
        var s = getComputedStyle(document.documentElement);
        return {
            modelLoss: s.getPropertyValue('--reg-model-loss').trim(),
            modelPenalty: s.getPropertyValue(budgetEmphasized()?'--reg-reference-color':'--reg-model-penalty').trim(),
            l1: s.getPropertyValue('--reg-l1-color').trim(),
            l2: s.getPropertyValue('--reg-l2-color').trim(),
            elastic: s.getPropertyValue('--reg-elastic-color').trim(),
            none: s.getPropertyValue('--reg-none-color').trim(),
            loss: s.getPropertyValue('--reg-loss-color').trim(),
            optimal: s.getPropertyValue('--reg-optimal-color').trim(),
            path: s.getPropertyValue('--reg-path-color').trim(),
            contour: s.getPropertyValue('--reg-contour-color').trim(),
            constraint: s.getPropertyValue(budgetEmphasized()?'--reg-model-penalty':'--reg-reference-color').trim(),
            constraintFill: s.getPropertyValue('--reg-constraint-fill').trim(),
            warm: s.getPropertyValue('--reg-surface-warm').trim(),
            cool: s.getPropertyValue('--reg-surface-cool').trim(),
            modelTotal: s.getPropertyValue('--reg-model-total').trim(),
            mid: s.getPropertyValue('--reg-surface-mid').trim(),
            high: s.getPropertyValue('--reg-surface-high').trim(),
            gridLine: s.getPropertyValue('--reg-grid-line').trim(),
            axis: s.getPropertyValue('--reg-axis-color').trim(),
            zero: s.getPropertyValue('--reg-zero-marker').trim(),
            text: s.getPropertyValue('--viz-text').trim(),
            textMuted: s.getPropertyValue('--viz-text-muted').trim(),
            bg: s.getPropertyValue('--viz-canvas-bg').trim(),
            border: s.getPropertyValue('--viz-border').trim(),
            gd: s.getPropertyValue('--reg-gd-color').trim()
        };
    }

    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        return [parseInt(hex.substring(0,2),16), parseInt(hex.substring(2,4),16), parseInt(hex.substring(4,6),16)];
    }

    function lerpColor(c1, c2, t) {
        var a = hexToRgb(c1), b = hexToRgb(c2);
        return 'rgb(' + Math.round(a[0]+(b[0]-a[0])*t) + ',' + Math.round(a[1]+(b[1]-a[1])*t) + ',' + Math.round(a[2]+(b[2]-a[2])*t) + ')';
    }

    // ========== Loss & Penalty Functions ==========
    function lossAt(w1, w2) {
        if(state.regression && regressionModel) return regressionModel.loss(w1,w2);
        // Rotated elliptical quadratic loss centered at (cx, cy)
        var dx = w1 - state.cx;
        var dy = w2 - state.cy;
        var rad = state.rotation * Math.PI / 180;
        var cos = Math.cos(rad), sin = Math.sin(rad);
        var rx = cos * dx + sin * dy;
        var ry = -sin * dx + cos * dy;
        return state.eccentricity * rx * rx + ry * ry;
    }

    var penaltyBlend=null,penaltyStrength=1,penaltyAnimation=0,optimumMotion=null;
    function effectivePenalty() {
        return penaltyBlend===null?{type:state.regType,alpha:state.alpha,strength:state.regType==='none'?0:1}:{type:penaltyStrength===0?'none':'elastic',alpha:penaltyBlend,strength:penaltyStrength};
    }
    function penaltyAt(w1, w2) {
        if(state.regression && !state.penalizeIntercept) w1=0;
        var penalty=effectivePenalty();
        switch (penalty.type) {
            case 'l1': return Math.abs(w1) + Math.abs(w2);
            case 'l2': return w1 * w1 + w2 * w2;
            case 'elastic':
                return penalty.strength*(penalty.alpha * (Math.abs(w1) + Math.abs(w2)) + (1 - penalty.alpha) * (w1 * w1 + w2 * w2));
            default: return 0;
        }
    }

    function totalAt(w1, w2) {
        return lossAt(w1, w2) + state.lambda * penaltyAt(w1, w2);
    }

    // ========== Gradients for GD ==========
    function gradLoss(w1, w2) {
        if(state.regression && regressionModel) return regressionModel.gradient(w1,w2);
        var dx = w1 - state.cx;
        var dy = w2 - state.cy;
        var rad = state.rotation * Math.PI / 180;
        var cos = Math.cos(rad), sin = Math.sin(rad);
        var rx = cos * dx + sin * dy;
        var ry = -sin * dx + cos * dy;
        var dLdrx = 2 * state.eccentricity * rx;
        var dLdry = 2 * ry;
        return {
            dw1: dLdrx * cos + dLdry * (-sin),
            dw2: dLdrx * sin + dLdry * cos
        };
    }

    function gradPenalty(w1, w2) {
        if(state.regression && !state.penalizeIntercept) w1=0;
        var penalty=effectivePenalty();
        switch (penalty.type) {
            case 'l1': return { dw1: Math.sign(w1) || 0, dw2: Math.sign(w2) || 0 };
            case 'l2': return { dw1: 2 * w1, dw2: 2 * w2 };
            case 'elastic': return {
                dw1: penalty.alpha * (Math.sign(w1) || 0) + (1 - penalty.alpha) * 2 * w1,
                dw2: penalty.alpha * (Math.sign(w2) || 0) + (1 - penalty.alpha) * 2 * w2
            };
            default: return { dw1: 0, dw2: 0 };
        }
    }

    function gradTotal(w1, w2) {
        var gl = gradLoss(w1, w2);
        var gp = gradPenalty(w1, w2);
        return {
            dw1: gl.dw1 + state.lambda * gp.dw1,
            dw2: gl.dw2 + state.lambda * gp.dw2
        };
    }

    // ========== Gradient Descent Simulation ==========
    function startGD(w1, w2) {
        // Clamp to range
        var limit = state.viewMode === '3d' ? 16 : 3;
        w1 = Math.max(-limit, Math.min(limit, w1));
        w2 = Math.max(-limit, Math.min(limit, w2));
        state.gdPath = [{w1: w1, w2: w2}];
        state.gdAnimating = true;
        if (state.gdAnimFrame) cancelAnimationFrame(state.gdAnimFrame);
        animateGD();
    }

    function animateGD() {
        if (!state.gdAnimating || state.gdPath.length > 500) {
            state.gdAnimating = false;
            return;
        }
        var last = state.gdPath[state.gdPath.length - 1];
        // Take a few steps per frame for smoother animation
        var stepsPerFrame = 3;
        for (var s = 0; s < stepsPerFrame; s++) {
            var g = gradTotal(last.w1, last.w2);
            var gnorm = Math.sqrt(g.dw1 * g.dw1 + g.dw2 * g.dw2);
            if (gnorm < 1e-5) {
                state.gdAnimating = false;
                redraw();
                return;
            }
            var stepSize=state.gdLR;
            if(state.regression) {
                var meanX2=regressionPoints.reduce(function(sum,p){return sum+p.x*p.x;},0)/regressionPoints.length;
                stepSize=Math.min(stepSize,.45/(1+meanX2+state.lambda));
            }
            var nw1 = last.w1 - stepSize * g.dw1;
            var nw2 = last.w2 - stepSize * g.dw2;
            var limit = state.viewMode === '3d' ? 16 : 3;
            nw1 = Math.max(-limit, Math.min(limit, nw1));
            nw2 = Math.max(-limit, Math.min(limit, nw2));
            last = {w1: nw1, w2: nw2};
            state.gdPath.push(last);
        }
        redraw();
        state.gdAnimFrame = requestAnimationFrame(animateGD);
    }

    // Smooth log compression: preserves shape near 0, no hard plateau
    function compress(val) {
        var c = 5;
        return c * Math.log(1 + val / c);
    }

    // ========== Find Optimum via Grid Search ==========
    function findOptimum() {
        computeOptimum();
        if(optimumMotion) {
            var m=optimumMotion,w1=m.from.w1+(m.to.w1-m.from.w1)*m.progress,w2=m.from.w2+(m.to.w2-m.from.w2)*m.progress;
            // This is the visual transition between solved endpoints, not an intermediate solve.
            state.optimum={w1:w1,w2:w2,loss:lossAt(w1,w2),penalty:penaltyAt(w1,w2),total:totalAt(w1,w2)};
        }
    }
    function computeOptimum() {
        if(state.regression && regressionModel) {
            var penalty=effectivePenalty();
            var fit=state.formulation==='budget'?regressionModel.fitBudget(penalty.type,penalty.strength?state.budget/penalty.strength:state.budget,penalty.alpha,state.penalizeIntercept):regressionModel.fit(penalty.type,state.lambda*penalty.strength,penalty.alpha,state.penalizeIntercept);
            state.cx=regressionModel.ordinary[0]; state.cy=regressionModel.ordinary[1];
            state.optimum={w1:fit[0],w2:fit[1],loss:lossAt(fit[0],fit[1]),penalty:penaltyAt(fit[0],fit[1]),total:totalAt(fit[0],fit[1])};
            return;
        }
        var bestW1 = 0, bestW2 = 0, bestVal = state.formulation==='budget'?lossAt(0,0):Infinity;
        var range = 3, steps = 200;
        for (var i = 0; i <= steps; i++) {
            for (var j = 0; j <= steps; j++) {
                var w1 = -range + (2 * range * i / steps);
                var w2 = -range + (2 * range * j / steps);
                var val = state.formulation==='budget'?(penaltyAt(w1,w2)<=state.budget?lossAt(w1,w2):Infinity):totalAt(w1,w2);
                if (val < bestVal) {
                    bestVal = val;
                    bestW1 = w1;
                    bestW2 = w2;
                }
            }
        }
        // Refine with smaller grid around best
        var r2 = 2 * range / steps;
        var centerW1 = bestW1, centerW2 = bestW2;
        for (var ii = 0; ii <= 40; ii++) {
            for (var jj = 0; jj <= 40; jj++) {
                var ww1 = centerW1 - r2 + (2 * r2 * ii / 40);
                var ww2 = centerW2 - r2 + (2 * r2 * jj / 40);
                var vv = state.formulation==='budget'?(penaltyAt(ww1,ww2)<=state.budget?lossAt(ww1,ww2):Infinity):totalAt(ww1,ww2);
                if (vv < bestVal) {
                    bestVal = vv;
                    bestW1 = ww1;
                    bestW2 = ww2;
                }
            }
        }
        state.optimum = {w1: bestW1, w2: bestW2, loss: lossAt(bestW1, bestW2), penalty: penaltyAt(bestW1, bestW2), total: bestVal};
    }

    function displayState() {
        var visible=state.formulation==='budget'?Object.assign({},state,{showBoth:false,showLoss:true,showPenalty:false,showTotal:false,showComponents:false,showConstraint:true}):state;
        visible=Object.assign({},visible,{displayWeights:currentWeights(),budgetEmphasis:budgetEmphasized()});
        if(penaltyBlend===null)return visible;
        var extra={regType:'elastic',alpha:penaltyBlend,penaltyOpacity:penaltyStrength};
        if(optimumMotion) {
            var m=optimumMotion,travel=m.toNone?m.progress:1-m.progress;
            var widen=Math.min(1,travel/.8),fade=Math.max(0,(travel-.8)/.2);
            widen=widen*widen*(3-2*widen);fade=fade*fade*(3-2*fade);
            extra.penaltyVisualAlpha=m.penaltyAlpha;
            // Lower the rim while reducing curvature further, so it becomes shorter AND wider.
            var heightRatio=1-.7*widen;
            extra.penaltyVisualCap=m.penaltyCap*heightRatio;
            extra.penaltyVisualStrength=(1+(m.expandedStrength-1)*widen)*heightRatio;
            extra.penaltyOpacity=1-fade;
            var endpoint=m.toNone?m.from:m.to,weights=selectedWeights||endpoint;
            var b=state.regression&&!state.penalizeIntercept?0:weights.w1,w=weights.w2,a=m.penaltyAlpha;
            var endpointValue=state.lambda*(a*(Math.abs(b)+Math.abs(w))+(1-a)*(b*b+w*w));
            extra.penaltyMarkerValue=endpointValue*(1-travel);
        }
        return Object.assign({},visible,extra);
    }
    function defaultSideYaw() {
        // Align screen-right with the displacement between the two minima.
        // This shows their separation instead of looking along it.
        return Math.hypot(state.cx,state.cy)>1e-6?Math.atan2(-state.cy,state.cx):-.6;
    }
    var scene, cameraAnimation=0, fitAnimation=0, initialCameraSet=false;
    function draw3d() {
        if (!scene) return;
        if(!initialCameraSet){state.yaw=defaultSideYaw();state.pitch=Math.PI/18;initialCameraSet=true;}
        var budgetLegend=state.formulation==='budget';
        document.getElementById('reg-model-legend').hidden = !budgetLegend && !(state.showBoth || state.showLoss || state.showPenalty || state.showTotal);
        document.getElementById('reg-model-total-key').hidden = !displayState().showTotal;
        document.getElementById('reg-model-loss-key').hidden = !(budgetLegend || state.showLoss || state.showBoth);
        document.getElementById('reg-model-penalty-key').hidden = (state.regType==='none'&&penaltyBlend===null) || !(budgetLegend || state.showPenalty || state.showBoth);
        document.getElementById('reg-model-penalty-key').innerHTML=budgetLegend?'<i></i>Constraint <b>R(w) ≤ t</b>':'<i></i>Penalty <b>λR(w)</b>';
        document.getElementById('reg-model-penalty-key').classList.toggle('reg-legend-diamond',state.regType==='l1');
        var budgetKey=document.getElementById('reg-model-budget-key'),colors=getCS();
        budgetKey.hidden=budgetLegend||!state.showConstraint||(state.regType==='none'&&penaltyBlend===null);
        budgetKey.classList.toggle('reg-legend-diamond',state.regType==='l1');
        [[document.querySelector('#reg-model-penalty-key i'),budgetLegend?colors.constraint:colors.modelPenalty],[budgetKey.querySelector('i'),colors.constraint]].forEach(function(entry){entry[0].style.borderColor=entry[1];entry[0].style.background='transparent';});
        scene.update(displayState(), getCS(), lossAt, penaltyAt, totalAt);
        renderCamera();
    }
    function currentWeights() { return selectedWeights || state.optimum; }
    function constrainWeights(w1,w2) {
        var w={w1:Math.max(-16,Math.min(16,w1)),w2:Math.max(-16,Math.min(16,w2))};
        if(state.formulation!=='budget'||penaltyAt(w.w1,w.w2)<=state.budget)return w;
        // Intersect the proposed direction with the budget boundary. Preserve an
        // unpenalized intercept so the allowed band remains freely traversable.
        var keepIntercept=state.regression&&!state.penalizeIntercept,lo=0,hi=1;
        for(var i=0;i<55;i++) {
            var scale=(lo+hi)/2;
            if(penaltyAt(keepIntercept?w.w1:w.w1*scale,w.w2*scale)<=state.budget)lo=scale;else hi=scale;
        }
        return {w1:keepIntercept?w.w1:w.w1*lo,w2:w.w2*lo};
    }
    function weightPointColor(weights) {
        var style=getComputedStyle(document.documentElement);
        var amber=style.getPropertyValue('--reg-selected-color').trim(),purple=style.getPropertyValue('--reg-optimal-color').trim();
        var proximity=Math.max(0,1-Math.hypot(weights.w1-state.optimum.w1,weights.w2-state.optimum.w2)/.9);
        var blend=proximity*proximity*(3-2*proximity);
        function channels(hex) {
            var h=hex.slice(1);if(h.length===3)h=h.replace(/./g,'$&$&');
            return [0,2,4].map(function(i){return parseInt(h.slice(i,i+2),16);});
        }
        var from=channels(amber),to=channels(purple);
        return 'rgb('+from.map(function(c,i){return Math.round(c+(to[i]-c)*blend);}).join(',')+')';
    }
    function cancelWeightSnap() {
        if(weightSnapAnimation)cancelAnimationFrame(weightSnapAnimation);
        weightSnapAnimation=0;
        weightRelease=null;
    }
    function selectWeights(w1,w2,snapToOptimum) {
        var held=selectedWeights===null||(weightSnapAnimation!==0&&!weightRelease),candidate=constrainWeights(w1,w2),close=false;
        if(snapToOptimum) {
            close=Math.hypot(candidate.w1-state.optimum.w1,candidate.w2-state.optimum.w2)<(held?.45:.3);
            if(close&&scene&&state.viewMode==='3d') {
                var point=scene.project([candidate.w1,0,candidate.w2]),star=scene.project([state.optimum.w1,0,state.optimum.w2]);
                close=point.depth>0&&star.depth>0&&Math.hypot(point.x-star.x,point.y-star.y)<(held?24:16.5);
            }
        }
        state.gdAnimating=false;
        if(state.gdAnimFrame)cancelAnimationFrame(state.gdAnimFrame);
        if(close) {
            if(weightRelease)cancelWeightSnap();
            // Keep the existing pull running while the pointer remains in its
            // release radius; restarting it on every move would stall capture.
            if(weightSnapAnimation||selectedWeights===null)return;
            if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                selectedWeights=null;
            } else {
                var from=currentWeights(),target={w1:state.optimum.w1,w2:state.optimum.w2},start=performance.now();
                function pull(now) {
                    var t=Math.min(1,(now-start)/220),ease=1-Math.pow(1-t,3);
                    selectedWeights=t===1?null:{w1:from.w1+(target.w1-from.w1)*ease,w2:from.w2+(target.w2-from.w2)*ease};
                    weightSnapAnimation=t===1?0:requestAnimationFrame(pull);
                    refreshSelectedWeights();
                }
                weightSnapAnimation=requestAnimationFrame(pull);
                return;
            }
        } else {
            if(snapToOptimum&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                if(weightRelease) {
                    weightRelease.target=candidate;
                    return;
                }
                if(held) {
                    var releaseFrom=currentWeights();
                    cancelWeightSnap();
                    // Start at the visible point and ease away from the magnet.
                    // Pointer moves update the destination without restarting time.
                    weightRelease={from:{w1:releaseFrom.w1,w2:releaseFrom.w2},target:candidate,start:performance.now()};
                    selectedWeights=weightRelease.from;
                    function release(now) {
                        var motion=weightRelease,t=Math.min(1,(now-motion.start)/350),ease=t*t*(3-2*t);
                        selectedWeights=constrainWeights(motion.from.w1+(motion.target.w1-motion.from.w1)*ease,motion.from.w2+(motion.target.w2-motion.from.w2)*ease);
                        if(t===1) {weightRelease=null;weightSnapAnimation=0;}
                        else weightSnapAnimation=requestAnimationFrame(release);
                        refreshSelectedWeights();
                    }
                    weightSnapAnimation=requestAnimationFrame(release);
                    return;
                }
            }
            cancelWeightSnap();
            selectedWeights=candidate;
        }
        refreshSelectedWeights();
    }
    function updateWeightReadout() {
        var budgetMode=state.formulation==='budget',weights=currentWeights();
        var selected=selectedWeights!==null;
        var opt={w1:weights.w1,w2:weights.w2,loss:lossAt(weights.w1,weights.w2),penalty:penaltyAt(weights.w1,weights.w2),total:totalAt(weights.w1,weights.w2)},noPenalty=state.regType==='none'&&penaltyBlend===null;
        var weightNames=state.regression?['intercept b','slope m']:['w₀','w₁'];
        var optimumClass=noPenalty?'reg-readout-loss':'reg-readout-total';
        var optimumName=noPenalty?'Unconstrained optimum':budgetMode?'Constrained optimum':'Combined optimum';
        var readout='<div class="reg-optimum-row"><strong class="'+(selected?'reg-readout-weight':optimumClass)+'">'+(selected?'● Selected weights':'★ '+optimumName)+'</strong><div class="reg-optimum-weights">';
        [opt.w1,opt.w2].forEach(function(value,i){readout+='<span>'+weightNames[i]+' <strong class="reg-readout-weight">'+value.toFixed(2)+'</strong></span>';});
        readout+='</div></div>';
        if(state.regression) {
            readout+='<div class="reg-fit-equation-row"><span class="reg-fit-equation '+(selected?'reg-readout-weight':optimumClass)+'">y = <span class="reg-readout-weight">'+opt.w1.toFixed(2)+'</span>'+(opt.w2<0?' − ':' + ')+'<span class="reg-readout-weight">'+Math.abs(opt.w2).toFixed(2)+'</span>x</span><span class="reg-fit-sample-count">'+regressionPoints.length+' data points</span></div>';
        }
        readout+='<div class="reg-objective-metrics">';
        function metric(color,label,formula,value) {
            return '<div class="reg-objective-metric '+color+'"><span>'+label+' <small>'+formula+'</small></span><strong>'+value+'</strong></div>';
        }
        readout+=metric('reg-readout-loss',state.regression?'Loss · MSE':'Loss','L(w)',opt.loss.toFixed(3));
        if(!noPenalty&&!budgetMode) {
            readout+=metric('reg-readout-penalty','Penalty','λR(w)',(state.lambda*opt.penalty).toFixed(2));
            readout+=metric('reg-readout-total','Combined objective','L(w) + λR(w)',opt.total.toFixed(2));
        }
        if(budgetMode&&!noPenalty)readout+=metric('reg-readout-penalty','Weight cost','R(w)',opt.penalty.toFixed(2)+' / '+state.budget.toFixed(2));
        readout+='</div><div class="reg-readout-key"><span class="reg-readout-loss">● Unconstrained minimum</span><span class="'+optimumClass+'">★ '+optimumName+'</span></div>';
        document.getElementById('reg-live-readout').innerHTML=readout;
    }
    function refreshSelectedWeights() {
        updateWeightReadout();
        updateMathPanel();
        if(state.viewMode==='3d') {
            if(state.autoHeight) {
                updateAutoHeight();
                document.getElementById('reg-rim-value').textContent=state.rimHeight.toFixed(2);
                draw3d();
            } else renderCamera();
        } else drawContour();
        drawRegression();
    }
    function renderCamera() {
        // Apply the same orbit limit to mouse, trackpad, and keyboard input.
        if(state.cameraPreset==='3d')state.pitch=Math.max(Math.PI/180,Math.min(Math.PI/2,state.pitch));
        if(fitAnimation)cancelAnimationFrame(fitAnimation);
        fitAnimation=0;
        scene.updateContributions(displayState(),state.regression?currentWeights():state.optimum,lossAt,penaltyAt);
        if(!optimumMotion&&scene.fitSelection(state)) {
            document.getElementById('reg-zoom-value').textContent=Math.round(state.zoom*100)+'%';
            document.getElementById('reg-zoom-out').disabled=state.zoom<=.01;
            document.getElementById('reg-zoom-in').disabled=state.zoom>=3;
        }
        scene.refreshViewport(displayState(),getCS(),lossAt,penaltyAt,totalAt);
        scene.render(state);
        if(!optimumMotion&&scene.fitAnimating)fitAnimation=requestAnimationFrame(function(){fitAnimation=0;if(state.viewMode==='3d')renderCamera();});
        var labels = document.getElementById('reg-scene-labels');
        labels.innerHTML = '';
        {
            var weights=state.regression?currentWeights():state.optimum, handle=scene.project([weights.w1,0,weights.w2]);
            var atOptimum=Math.hypot(weights.w1-state.optimum.w1,weights.w2-state.optimum.w2)<1e-4;
            scene.beginAnnotations();
            scene.renderFloorMarkers(state.optimum,atOptimum?null:weights,state.regType==='none'?getCS().modelLoss:getCS().optimal,weightPointColor(weights));
            var guideStyle=getComputedStyle(document.documentElement);
            scene.renderGuides(state,{
                weight:guideStyle.getPropertyValue('--reg-selected-color').trim(),
                loss:guideStyle.getPropertyValue('--reg-l2-color').trim(),
                total:guideStyle.getPropertyValue('--reg-model-total').trim(),
                vertical:guideStyle.getPropertyValue('--viz-text-muted').trim()
            });
            scene.endAnnotations(state);
            if(handle.depth>0) {
                [[weights.w1,0,0],[0,0,weights.w2]].forEach(function(endpoint,index) {
                    var axis=scene.project(endpoint);
                    if(axis.depth<=0) return;
                    var caption=document.createElement('span');caption.className='reg-selected-caption';
                    var name=state.regression?(index===0?'b':'m'):(index===0?'w₁':'w₂');
                    caption.dataset.depth=axis.depth;
                    caption.textContent=name+' = '+(index===0?weights.w1:weights.w2).toFixed(2);
                    labels.appendChild(caption);
                    // Place each value beyond its axis intersection, away from the guide.
                    var dx=axis.x-handle.x,dy=axis.y-handle.y,length=Math.hypot(dx,dy);
                    var ux=length>1?dx/length:(index===0?1:0),uy=length>1?dy/length:(index===0?0:1);
                    var width=caption.offsetWidth,height=caption.offsetHeight;
                    var clearance=8+Math.abs(ux)*width/2+Math.abs(uy)*height/2;
                    caption.style.left=Math.max(4,Math.min(axis.x+ux*clearance-width/2,canvas3d.clientWidth-width-4))+'px';
                    // A camera-facing label at floor depth must sit above its anchor;
                    // centering it vertically would put its lower half beneath the grid.
                    var labelY=axis.y+uy*clearance-height/2;
                    if(state.cameraPreset==='3d')labelY=axis.y-height-4;
                    caption.style.top=Math.max(4,Math.min(labelY,canvas3d.clientHeight-height-4))+'px';
                });
            }
        }
        scene.labels.forEach(function(label) {
            var p = scene.project(label.p);
            if (p.depth <= 0 || p.x < 0 || p.y < 0 || p.x > canvas3d.clientWidth || p.y > canvas3d.clientHeight) return;
            var el = document.createElement('span');
            el.dataset.depth=p.depth;
            el.textContent = label.text; el.style.left = p.x+'px'; el.style.top = p.y+'px'; labels.appendChild(el);
        });
        scene.contributions.forEach(function(item) {
            var p=scene.project(item.p);
            if(p.depth<=0 || p.x<0 || p.y<0 || p.x>canvas3d.clientWidth || p.y>canvas3d.clientHeight) return;
            if((item.kind==='loss'||item.kind==='total')) {
                var axisPoint=scene.project([0,item.p[1],0]);

            }
            var dot=document.createElement('span'); dot.className='reg-contribution-dot '+item.kind;
            dot.style.opacity=item.opacity;
            dot.style.left=p.x+'px'; dot.style.top=p.y+'px'; labels.appendChild(dot);
            var caption=document.createElement('span'); caption.className='reg-contribution-label '+item.kind;
            caption.textContent=item.text; labels.appendChild(caption);
            var labelAnchor=(item.kind==='loss'||item.kind==='total')&&state.cameraPreset!=='top'&&axisPoint&&axisPoint.depth>0?axisPoint:p;
            caption.dataset.depth=labelAnchor.depth;
            caption.style.opacity=item.opacity;
            var width=caption.offsetWidth,height=caption.offsetHeight;
            var x=labelAnchor.x+14,y=labelAnchor.y-height/2;
            if((item.kind==='loss'||item.kind==='total')) {
                // Continue beyond the axis endpoint, away from the loss contact point.
                var dx=labelAnchor.x-p.x,dy=labelAnchor.y-p.y;
                if(state.cameraPreset==='top') {
                    var contourCenter=scene.project([item.kind==='total'?state.optimum.w1:state.cx,item.p[1],item.kind==='total'?state.optimum.w2:state.cy]);
                    dx=p.x-contourCenter.x;dy=p.y-contourCenter.y;
                }
                var length=Math.hypot(dx,dy);
                var ux=length>1?dx/length:1,uy=length>1?dy/length:0;
                var clearance=12+Math.abs(ux)*width/2+Math.abs(uy)*height/2;
                x=labelAnchor.x+ux*clearance-width/2;
                y=labelAnchor.y+uy*clearance-height/2;
            }
            x=Math.max(4,Math.min(x,canvas3d.clientWidth-width-4));
            y=Math.max(4,Math.min(y,canvas3d.clientHeight-height-4));
            // At a viewport edge, move vertically rather than clamp over the contact marker.
            if((item.kind==='loss'||item.kind==='total')&&p.x>=x-8&&p.x<=x+width+8&&p.y>=y-8&&p.y<=y+height+8) {
                y=p.y-height-14>=4?p.y-height-14:Math.min(canvas3d.clientHeight-height-4,p.y+14);
            }
            if((item.kind==='loss'||item.kind==='total')) labels.querySelectorAll('.reg-selected-caption').forEach(function(coordinates) {
                var cx=coordinates.offsetLeft,cy=coordinates.offsetTop,cw=coordinates.offsetWidth,ch=coordinates.offsetHeight;
                if(x<cx+cw+8&&x+width>cx-8&&y<cy+ch+8&&y+height>cy-8) {
                    // Prefer above the coordinates; use below when the viewport leaves no room.
                    y=cy-height-12>=4?cy-height-12:Math.min(canvas3d.clientHeight-height-4,cy+ch+12);
                }
            });
            caption.style.left=x+'px';caption.style.top=y+'px';
        });
        {
            var sceneLabels=Array.from(labels.querySelectorAll('span[data-depth]'));
            // Axis names first; selected values and contribution labels retain overlap priority.
            sceneLabels.sort(function(a,b){return Number(a.matches('.reg-selected-caption,.reg-contribution-label'))-Number(b.matches('.reg-selected-caption,.reg-contribution-label'));});
            scene.renderLabels(sceneLabels.map(function(label) {
                var style=getComputedStyle(label);
                return {text:label.textContent,x:label.offsetLeft,y:label.offsetTop,width:label.offsetWidth,height:label.offsetHeight,
                    depth:Number(label.dataset.depth),opacity:parseFloat(style.opacity),axisLabel:!label.matches('.reg-selected-caption,.reg-contribution-label'),font:style.font,color:style.color,background:style.backgroundColor,
                    border:style.borderColor,borderWidth:parseFloat(style.borderTopWidth)||0,radius:parseFloat(style.borderRadius)||0,
                    paddingLeft:(parseFloat(style.paddingLeft)||0)+(parseFloat(style.borderLeftWidth)||0)};
            }),state.cameraPreset);
            sceneLabels.forEach(function(label){label.style.visibility='hidden';});

        }
    }

    function drawContour() {
        var colors = getCS();
        var dpr = window.devicePixelRatio || 1;
        var pw = canvasContour.width / dpr;
        var ph = canvasContour.height / dpr;

        ctxContour.save();
        ctxContour.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctxContour.clearRect(0, 0, pw, ph);

        var range = state.regression ? Math.max(3,Math.abs(state.cx)+1,Math.abs(state.cy)+1) : 3;
        var pad = pw * 0.08;
        var plotW = pw - 2 * pad;
        var plotH = ph - 2 * pad;

        function toScreenX(w) { return pad + (w + range) / (2 * range) * plotW; }
        function toScreenY(w) { return pad + (range - w) / (2 * range) * plotH; }

        // Grid background
        ctxContour.strokeStyle = colors.zero;
        ctxContour.lineWidth = 1;
        // Zero lines
        ctxContour.beginPath();
        ctxContour.moveTo(toScreenX(0), pad);
        ctxContour.lineTo(toScreenX(0), pad + plotH);
        ctxContour.moveTo(pad, toScreenY(0));
        ctxContour.lineTo(pad + plotW, toScreenY(0));
        ctxContour.stroke();

        // Draw loss contours
        var contourLevels = [0.5, 1, 2, 3, 5, 8, 12, 18];
        ctxContour.strokeStyle = colors.contour;
        ctxContour.lineWidth = 1.5;

        for (var li = 0; li < contourLevels.length; li++) {
            var level = contourLevels[li];
            // Sample points on contour using marching
            drawContourLevel(ctxContour, function(w1, w2) { return lossAt(w1, w2); }, level, range, pad, plotW, plotH, colors.contour);
        }

        // Draw constraint region
        if (state.regType !== 'none' && (state.formulation==='budget' || state.lambda > 0)) {
            var regColor = colors[state.regType] || colors.l1;

            // For the constraint interpretation: penalty(w) <= t
            // We draw the boundary of the feasible region at a few levels
            // The "budget" level that corresponds to the optimum
            if (state.optimum) {
                var budgetLevel = state.formulation==='budget'?state.budget:penaltyAt(state.optimum.w1, state.optimum.w2);
                if(state.regression && !state.penalizeIntercept) {
                    var band=state.formulation==='budget'?(state.regType==='l1'?state.budget:state.regType==='l2'?Math.sqrt(state.budget):state.alpha===1?state.budget:(Math.sqrt(state.alpha*state.alpha+4*(1-state.alpha)*state.budget)-state.alpha)/(2*(1-state.alpha))):Math.abs(state.optimum.w2), top=toScreenY(band), bottom=toScreenY(-band);
                    ctxContour.fillStyle=colors.constraintFill;ctxContour.fillRect(pad,top,plotW,bottom-top);
                    ctxContour.strokeStyle=colors.constraint;ctxContour.lineWidth=2;
                    ctxContour.beginPath();ctxContour.moveTo(pad,top);ctxContour.lineTo(pad+plotW,top);ctxContour.moveTo(pad,bottom);ctxContour.lineTo(pad+plotW,bottom);ctxContour.stroke();
                } else drawConstraintRegion(ctxContour, budgetLevel, range, pad, plotW, plotH, regColor, colors.constraintFill);
            }
        }

        // This is the specific loss contour that touches the equivalent constraint boundary.
        if (state.regType !== 'none' && (state.formulation==='budget' || state.lambda > 0) && state.optimum) {
            ctxContour.lineWidth = 2.5;
            drawContourLevel(ctxContour, lossAt, state.optimum.loss, range, pad, plotW, plotH, colors.loss);
            ctxContour.lineWidth = 1.5;
        }

        // Draw loss center
        ctxContour.beginPath();
        ctxContour.arc(toScreenX(state.cx), toScreenY(state.cy), 4, 0, Math.PI * 2);
        ctxContour.fillStyle = colors.loss;
        ctxContour.fill();
        ctxContour.strokeStyle = '#fff';
        ctxContour.lineWidth = 1.5;
        ctxContour.stroke();

        // Draw optimum
        if (state.optimum) {
            var ox = toScreenX(state.optimum.w1);
            var oy = toScreenY(state.optimum.w2);

            // Star marker
            ctxContour.beginPath();
            for (var si = 0; si < 10; si++) {
                var a = si * Math.PI / 5 - Math.PI / 2;
                var r = si % 2 === 0 ? 7 : 3;
                if (si === 0) ctxContour.moveTo(ox + r * Math.cos(a), oy + r * Math.sin(a));
                else ctxContour.lineTo(ox + r * Math.cos(a), oy + r * Math.sin(a));
            }
            ctxContour.closePath();
            ctxContour.fillStyle = colors.optimal;
            ctxContour.fill();
            ctxContour.strokeStyle = '#fff';
            ctxContour.lineWidth = 1.5;
            ctxContour.stroke();

            // Coordinate label
            ctxContour.font = '600 10px ' + getComputedStyle(document.documentElement).getPropertyValue('--viz-mono-font').trim();
            ctxContour.fillStyle = colors.optimal;
            ctxContour.textAlign = 'left';
            ctxContour.fillText('(' + state.optimum.w1.toFixed(2) + ', ' + state.optimum.w2.toFixed(2) + ')', ox + 10, oy - 4);
        }

        if(state.regression) {
            var weights=currentWeights();
            ctxContour.beginPath();ctxContour.arc(toScreenX(weights.w1),toScreenY(weights.w2),5,0,2*Math.PI);
            ctxContour.strokeStyle=weightPointColor(weights);
            ctxContour.lineWidth=3;ctxContour.stroke();
        }

        // Draw GD path
        if (state.gdPath.length > 0) {
            if (state.gdPath.length > 1) {
            ctxContour.strokeStyle = colors.gd;
            ctxContour.lineWidth = 2;
            ctxContour.globalAlpha = 0.8;
            ctxContour.beginPath();
            for (var gi = 0; gi < state.gdPath.length; gi++) {
                var gpx = toScreenX(state.gdPath[gi].w1);
                var gpy = toScreenY(state.gdPath[gi].w2);
                if (gi === 0) ctxContour.moveTo(gpx, gpy);
                else ctxContour.lineTo(gpx, gpy);
            }
            ctxContour.stroke();
            ctxContour.globalAlpha = 1;

            // Start marker
            ctxContour.beginPath();
            ctxContour.arc(toScreenX(state.gdPath[0].w1), toScreenY(state.gdPath[0].w2), 3, 0, Math.PI * 2);
            ctxContour.fillStyle = colors.textMuted;
            ctxContour.fill();
            }

            // Current ball
            var gcur = state.gdPath[state.gdPath.length - 1];
            ctxContour.beginPath();
            ctxContour.arc(toScreenX(gcur.w1), toScreenY(gcur.w2), 5, 0, Math.PI * 2);
            ctxContour.fillStyle = colors.gd;
            ctxContour.fill();
            ctxContour.strokeStyle = '#fff';
            ctxContour.lineWidth = 1.5;
            ctxContour.stroke();
        }

        // Axis labels
        ctxContour.font = 'bold ' + Math.max(11, pw * 0.025) + 'px sans-serif';
        ctxContour.fillStyle = colors.text;
        ctxContour.textAlign = 'center';
        ctxContour.textBaseline = 'top';
        ctxContour.fillText(state.regression?'intercept b':'w₀', pad + plotW / 2, pad + plotH + 4);
        ctxContour.save();
        ctxContour.translate(pad - 6, pad + plotH / 2);
        ctxContour.rotate(-Math.PI / 2);
        ctxContour.textBaseline = 'bottom';
        ctxContour.fillText(state.regression?'slope m':'w₁', 0, 0);
        ctxContour.restore();

        // Legend
        var legendY = ph - 6;
        ctxContour.font = '10px sans-serif';
        ctxContour.textBaseline = 'bottom';
        ctxContour.textAlign = 'left';

        // Loss contour swatch
        ctxContour.fillStyle = colors.contour;
        ctxContour.fillRect(pad, legendY - 8, 14, 3);
        ctxContour.fillStyle = colors.textMuted;
        ctxContour.fillText('Loss contours', pad + 18, legendY);

        // Optimum swatch
        ctxContour.fillStyle = colors.optimal;
        ctxContour.fillRect(pad + 105, legendY - 8, 8, 8);
        ctxContour.fillStyle = colors.textMuted;
        ctxContour.fillText('Optimum', pad + 117, legendY);

        // Unregularized swatch
        ctxContour.fillStyle = colors.loss;
        ctxContour.beginPath();
        ctxContour.arc(pad + 186, legendY - 4, 4, 0, Math.PI * 2);
        ctxContour.fill();
        ctxContour.fillStyle = colors.textMuted;
        ctxContour.fillText('Unreg. min', pad + 194, legendY);

        ctxContour.restore();
    }

    // Draw a single contour level using marching squares (simplified)
    function drawContourLevel(ctx, fn, level, range, pad, plotW, plotH, color) {
        var res = 80;
        var step = 2 * range / res;

        function toSX(w) { return pad + (w + range) / (2 * range) * plotW; }
        function toSY(w) { return pad + (range - w) / (2 * range) * plotH; }

        ctx.strokeStyle = color;
        ctx.beginPath();

        for (var i = 0; i < res; i++) {
            for (var j = 0; j < res; j++) {
                var w1 = -range + i * step;
                var w2 = -range + j * step;

                var v00 = fn(w1, w2) - level;
                var v10 = fn(w1 + step, w2) - level;
                var v01 = fn(w1, w2 + step) - level;
                var v11 = fn(w1 + step, w2 + step) - level;

                // Simple edge crossing detection
                var edges = [];
                if (v00 * v10 < 0) {
                    var t = v00 / (v00 - v10);
                    edges.push({x: toSX(w1 + t * step), y: toSY(w2)});
                }
                if (v10 * v11 < 0) {
                    var t2 = v10 / (v10 - v11);
                    edges.push({x: toSX(w1 + step), y: toSY(w2 + t2 * step)});
                }
                if (v01 * v11 < 0) {
                    var t3 = v01 / (v01 - v11);
                    edges.push({x: toSX(w1 + t3 * step), y: toSY(w2 + step)});
                }
                if (v00 * v01 < 0) {
                    var t4 = v00 / (v00 - v01);
                    edges.push({x: toSX(w1), y: toSY(w2 + t4 * step)});
                }

                if (edges.length >= 2) {
                    ctx.moveTo(edges[0].x, edges[0].y);
                    ctx.lineTo(edges[1].x, edges[1].y);
                    if (edges.length === 4) {
                        ctx.moveTo(edges[2].x, edges[2].y);
                        ctx.lineTo(edges[3].x, edges[3].y);
                    }
                }
            }
        }
        ctx.stroke();
    }

    // Draw filled constraint region
    function drawConstraintRegion(ctx, budget, range, pad, plotW, plotH, strokeColor, fillColor) {
        function toSX(w) { return pad + (w + range) / (2 * range) * plotW; }
        function toSY(w) { return pad + (range - w) / (2 * range) * plotH; }

        ctx.save();
        ctx.beginPath();

        if (state.regType === 'l1') {
            // Diamond: |w1| + |w2| = budget
            var r = budget;
            ctx.moveTo(toSX(r), toSY(0));
            ctx.lineTo(toSX(0), toSY(r));
            ctx.lineTo(toSX(-r), toSY(0));
            ctx.lineTo(toSX(0), toSY(-r));
            ctx.closePath();
        } else if (state.regType === 'l2') {
            // Circle: w1^2 + w2^2 = budget
            var rad = Math.sqrt(budget);
            var cx = toSX(0), cy2 = toSY(0);
            var rx = rad / (2 * range) * plotW;
            var ry = rad / (2 * range) * plotH;
            ctx.ellipse(cx, cy2, rx, ry, 0, 0, Math.PI * 2);
        } else if (state.regType === 'elastic') {
            // Parametric: sample boundary
            var pts = 200;
            var first = true;
            for (var ai = 0; ai <= pts; ai++) {
                var angle = ai * 2 * Math.PI / pts;
                // Binary search for radius at this angle where penalty = budget
                var lo = 0, hi = 5;
                for (var bs = 0; bs < 30; bs++) {
                    var mid = (lo + hi) / 2;
                    var tw1 = mid * Math.cos(angle);
                    var tw2 = mid * Math.sin(angle);
                    if (penaltyAt(tw1, tw2) < budget) lo = mid;
                    else hi = mid;
                }
                var rr = (lo + hi) / 2;
                var px = rr * Math.cos(angle);
                var py = rr * Math.sin(angle);
                if (first) { ctx.moveTo(toSX(px), toSY(py)); first = false; }
                else ctx.lineTo(toSX(px), toSY(py));
            }
            ctx.closePath();
        }

        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
    }

    // ========== Math Panel ==========
    function updateMathPanel() {
        if(state.regression) {
            var panel=document.getElementById('reg-math-panel'),w=currentWeights(),p=effectivePenalty(),budget=state.formulation==='budget';
            var loss=lossAt(w.w1,w.w2),cost=penaltyAt(w.w1,w.w2),weighted=state.lambda*cost;
            function n(v){return v.toFixed(3);}
            function weight(v){return '<span class="reg-readout-weight">'+n(v)+'</span>';}
            function step(label,color,formula,calculation){return '<section class="reg-live-math-step"><h5 class="'+color+'">'+label+'</h5><div class="reg-live-formula">'+formula+'</div><div class="reg-live-calculation '+color+'">'+calculation+'</div></section>';}
            var html='<p class="reg-live-math-status">'+(selectedWeights?'Evaluating your selected weights':'Evaluating the optimum')+' · '+regressionPoints.length+' data points</p>';
            html+=step('1 · Predictions','reg-readout-weight','ŷᵢ = b + mxᵢ','ŷᵢ = '+weight(w.w1)+(w.w2<0?' − ':' + ')+weight(Math.abs(w.w2))+'xᵢ');
            function matrix(rows,color) {
                return '<span class="reg-matrix-annotated"><span class="reg-matrix '+(color||'')+'" style="--matrix-cols:'+rows[0].length+'">'+rows.map(function(row){return row.map(function(value){return '<span>'+value+'</span>';}).join('');}).join('')+'</span><small class="reg-matrix-dim">&lt;'+rows.length+', '+rows[0].length+'&gt;</small></span>';
            }
            var predictions=regressionPoints.map(function(point){return w.w1+w.w2*point.x;});
            var residuals=regressionPoints.map(function(point,i){return point.y-predictions[i];});
            var sum=residuals.reduce(function(total,r){return total+r*r;},0);
            html+='<section class="reg-live-math-step"><h5 class="reg-readout-weight">Design matrix × weights</h5><div class="reg-live-formula">ŷ = Xw · w = [b, m]ᵀ</div><div class="reg-matrix-equation">';
            html+=matrix(regressionPoints.map(function(point){return ['1',n(point.x)];}))+'<span>×</span>'+matrix([[n(w.w1)],[n(w.w2)]],'reg-readout-weight')+'<span>=</span>'+matrix(predictions.map(function(value){return [n(value)];}));
            html+='</div></section><section class="reg-live-math-step"><h5 class="reg-readout-loss">2 · Residual vector</h5><div class="reg-live-formula">r = y − Xw</div><div class="reg-matrix-equation">';
            html+=matrix(regressionPoints.map(function(point){return [n(point.y)];}))+'<span>−</span>'+matrix(predictions.map(function(value){return [n(value)];}))+'<span>=</span>'+matrix(residuals.map(function(value){return [n(value)];}),'reg-readout-loss');
            html+='</div><p class="reg-live-math-status">Rows follow the data points in order. Display rounded to 3 decimals; calculations use full precision.</p></section>';
            function vectorProduct(values,absolute) {
                var entries=values.map(function(value){return [n(absolute?Math.abs(value):value)];});
                var left=absolute?values.map(function(){return ['1'];}):entries;
                return '<span class="reg-matrix-annotated"><span class="reg-transposed">'+matrix(left)+'<sup>ᵀ</sup></span><small class="reg-matrix-dim">after transpose: &lt;1, '+values.length+'&gt;</small></span><span>×</span>'+matrix(entries,absolute?'reg-readout-weight':'');
            }
            var residualProduct=vectorProduct(residuals,false);
            var lossProduct='<span class="reg-matrix-annotated">1 / '+regressionPoints.length+' ×<small class="reg-matrix-dim">&lt;1, 1&gt; · scalar</small></span>'+residualProduct;
            html+=step('Mean squared error','reg-readout-loss','L(w) = (1/n) rᵀr','<div class="reg-matrix-equation reg-readout-loss">'+lossProduct+'<span class="reg-matrix-annotated">= <strong>'+n(loss)+'</strong><small class="reg-matrix-dim">&lt;1, 1&gt; · scalar</small></span></div>');
            var penaltyWeights=state.penalizeIntercept?[w.w1,w.w2]:[w.w2];
            var l1Product=vectorProduct(penaltyWeights,true),l2Product=vectorProduct(penaltyWeights,false);
            var formula='0',substitution='<span>0</span>',name={none:'None',l1:'L1',l2:'L2',elastic:'Elastic Net'}[state.regType];
            if(p.type==='l1'){formula='1ᵀ|v|';substitution=l1Product;}
            if(p.type==='l2'){formula='vᵀv';substitution=l2Product;}
            if(p.type==='elastic'){
                formula='α1ᵀ|v| + (1 − α)vᵀv';
                substitution='<span>'+n(p.alpha)+' ×</span>'+l1Product+'<span> + '+n(1-p.alpha)+' ×</span>'+l2Product;
                if(p.strength!==1){formula=n(p.strength)+' ['+formula+']';substitution='<span>'+n(p.strength)+' × (</span>'+substitution+'<span>)</span>';}
            }
            html+=step('3 · '+name+' penalty','reg-readout-penalty','R(w) = '+formula+' · '+(state.penalizeIntercept?'v = [b, m]ᵀ':'v = [m] (intercept unpenalized)'),'<div class="reg-matrix-equation">'+substitution+'<span class="reg-matrix-annotated">= <strong>'+n(cost)+'</strong><small class="reg-matrix-dim">&lt;1, 1&gt; · scalar</small></span></div>');
            if(budget){
                html+=step('4 · Budget check','reg-readout-penalty',p.type==='none'?'No constraint':'R(b, m) ≤ t',p.type==='none'?'All weights are allowed':n(cost)+' ≤ '+n(state.budget)+' · '+(cost<=state.budget+1e-8?'Within budget':'Outside budget'));
                html+=step('Minimize the loss','reg-readout-loss','min L(b, m) subject to R(w) ≤ t','Current loss = <strong>'+n(loss)+'</strong>');
            }else{
                html+=step('4 · Combined objective','reg-readout-total','J(w) = (1/n) rᵀr + λ('+formula+')','<div class="reg-matrix-equation"><span class="reg-matrix-term reg-readout-loss">'+lossProduct+'</span><span> + '+n(state.lambda)+' × (</span><span class="reg-matrix-term reg-readout-penalty">'+substitution+'</span><span>)</span></div><span class="reg-readout-loss">'+n(loss)+'</span> + <span class="reg-readout-penalty">'+n(state.lambda)+' × '+n(cost)+'</span> = <strong>'+n(loss+weighted)+'</strong>');
            }
            panel.innerHTML=html;
            return;
        }
        var panel = document.getElementById('reg-math-panel');
        if (!state.optimum) {
            panel.innerHTML = '<span class="formula-note">Adjust parameters to see the computation.</span>';
            return;
        }
        var o = state.optimum;
        var regLabels = {none: 'None', l1: 'L1', l2: 'L2', elastic: 'Elastic Net'};

        var html = '';
        html += '<div class="reg-calc-row"><span>Reg Type:</span><span>' + regLabels[state.regType] + '</span></div>';
        html += '<div class="reg-calc-row"><span>&lambda;:</span><span>' + state.lambda.toFixed(2) + '</span></div>';

        html += '<div class="reg-calc-row"><span>Unreg. min:</span><span class="reg-val-loss">(' + state.cx.toFixed(2) + ', ' + state.cy.toFixed(2) + ')</span></div>';
        html += '<div class="reg-calc-row"><span>Reg. optimum:</span><span class="reg-val-optimal">(' + o.w1.toFixed(3) + ', ' + o.w2.toFixed(3) + ')</span></div>';

        html += '<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--viz-border)"></div>';
        html += '<div class="reg-calc-row"><span>Loss L(w):</span><span class="reg-val-loss">' + o.loss.toFixed(4) + '</span></div>';
        html += '<div class="reg-calc-row"><span>Penalty R(w):</span><span class="reg-val-l1">' + o.penalty.toFixed(4) + '</span></div>';
        html += '<div class="reg-calc-row"><span>&lambda; &middot; R(w):</span><span>' + (state.lambda * o.penalty).toFixed(4) + '</span></div>';
        html += '<div class="reg-calc-row reg-calc-result"><span>Total:</span><span>' + o.total.toFixed(4) + '</span></div>';

        // Sparsity check
        var thresh = 0.03;
        var w1Zero = Math.abs(o.w1) < thresh;
        var w2Zero = Math.abs(o.w2) < thresh;
        if (w1Zero || w2Zero) {
            html += '<div style="margin-top:8px;padding:6px 8px;border-radius:4px;background:var(--viz-success-bg);border:1px solid var(--viz-success-border);font-size:11px;color:var(--viz-success-border);">';
            html += '<i class="fa fa-check-circle"></i> Sparse solution: ';
            if (w1Zero && w2Zero) html += 'both weights &asymp; 0';
            else if (w1Zero) html += 'w<sub>0</sub> &asymp; 0';
            else html += 'w<sub>1</sub> &asymp; 0';
            html += '</div>';
        }

        panel.innerHTML = html;
    }

    // ========== Canvas Setup ==========
    function setupCanvas(canvas, aspectRatio) {
        var dpr = window.devicePixelRatio || 1;
        var parentStyle = getComputedStyle(canvas.parentElement);
        var parentW = canvas.parentElement.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight);
        var h = parentW * (aspectRatio || 0.75);
        canvas.style.width = parentW + 'px';
        canvas.style.height = h + 'px';
        canvas.width = parentW * dpr;
        canvas.height = h * dpr;
    }

    function updatePenaltySwatch() {
        var colors = getCS();
        var swatch = document.getElementById('reg-penalty-swatch');
        if (swatch) swatch.style.background = colors[state.regType] || colors.l1;
    }

    function updateAutoHeight() {
        if(optimumMotion) {
            state.rimHeight=optimumMotion.startCap+(optimumMotion.endCap-optimumMotion.startCap)*optimumMotion.progress;
            return;
        }
        if(!state.autoHeight)return;
        var opt=state.optimum,shown=displayState(),weights=currentWeights(),rise=0;
        var selectedLoss=lossAt(weights.w1,weights.w2),selectedPenalty=penaltyAt(weights.w1,weights.w2);
        if(shown.showLoss||shown.showBoth)rise=Math.max(rise,Math.max(opt.loss,selectedLoss)-lossAt(state.cx,state.cy));
        if(shown.showPenalty||shown.showBoth)rise=Math.max(rise,state.lambda*Math.max(opt.penalty,selectedPenalty));
        if(shown.showTotal)rise=Math.max(rise,selectedLoss+state.lambda*selectedPenalty-opt.total);
        state.rimHeight=Math.max(.1,rise*1.25+.05);
    }

    function redraw() {
        cancelWeightSnap();
        if(state.regression&&regressionModel&&state.regType!=='none'&&penaltyBlend===null&&!optimumMotion) {
            // Preserve the control the user is adjusting, including loose budgets
            // and L1 strengths beyond the point where the weights reach zero.
            if((linkedControlSource||state.formulation)==='budget') {
                state.lambda=regressionModel.lambdaForBudget(state.regType,state.budget,state.alpha,state.penalizeIntercept);
            } else {
                var linkedFit=regressionModel.fit(state.regType,state.lambda,state.alpha,state.penalizeIntercept);
                state.budget=penaltyAt(linkedFit[0],linkedFit[1]);
            }
        }
        findOptimum();
        if(selectedWeights)selectedWeights=constrainWeights(selectedWeights.w1,selectedWeights.w2);
        updateAutoHeight();
        document.getElementById('reg-auto-height').checked=state.autoHeight;
        document.getElementById('reg-rim-height').disabled=state.autoHeight;
        var budgetMode=state.formulation==='budget';
        document.getElementById('reg-lambda-control').hidden=false;
        document.getElementById('reg-budget-control').hidden=false;
        document.getElementById('reg-budget-value').textContent=state.budget.toFixed(2);

        document.getElementById('reg-data-panel').hidden=!state.regression;
        document.getElementById('reg-weight-controls').hidden=!state.regression;
        document.getElementById('reg-pan-controls').hidden=state.viewMode!=='3d';
        document.querySelector('#reg-lambda-control p').textContent=state.regression&&!state.penalizeIntercept?'Increase λ to shrink the slope toward zero.':'Increase λ to pull the optimum toward zero.';
        ['reg-ecc-slider','reg-cx-slider','reg-cy-slider','reg-rot-slider'].forEach(function(id){document.getElementById(id).disabled=state.regression;});
        document.getElementById('reg-fit-explanation').textContent=budgetMode?'Model: y = b + mx. Choose the line with the lowest mean squared error whose weight cost fits the budget. With both coefficients constrained, L2 gives a cylinder and L1 a diamond prism; excluding the intercept gives an unbounded band.':'Model: y = b + mx. The landscape uses these points’ mean squared error. Penalizing both coefficients produces a bowl or pyramid; penalizing only the slope produces a trough.';
        if(state.regression) drawRegression();
        document.getElementById('reg-scene-help').hidden = !!scene && state.viewMode !== '3d';
        document.getElementById('reg-height-controls').hidden = state.viewMode !== '3d';
        document.getElementById('reg-rim-controls').hidden = state.viewMode !== '3d';
        document.getElementById('reg-rim-value').textContent=state.rimHeight.toFixed(2);
        document.getElementById('reg-stretch-value').textContent = state.stretch.toFixed(1)+'×';
        document.getElementById('reg-camera-controls').hidden = state.viewMode !== '3d';
        document.getElementById('reg-zoom-value').textContent = Math.round(state.zoom*100)+'%';
        document.getElementById('reg-zoom-out').disabled = state.zoom <= 0.01;
        document.getElementById('reg-zoom-in').disabled = state.zoom >= 3;
        document.querySelectorAll('[data-layer]').forEach(function(input){input.checked=state[input.dataset.layer];});
        document.getElementById('reg-budget-explanation').hidden = !state.showConstraint || state.viewMode !== '3d';
        var togglesDiv = document.getElementById('reg-surface-toggles');
        if (state.viewMode === '3d') {
            canvas3d.parentElement.style.display = 'block';
            canvasContour.style.display = 'none';
            if (togglesDiv) togglesDiv.style.display = budgetMode?'none':'flex';
            setupCanvas(canvas3d, state.regression ? 0.65 : 0.9);
            updatePenaltySwatch();
            draw3d();
        } else {
            canvas3d.parentElement.style.display = 'none';
            canvasContour.style.display = 'block';
            if (togglesDiv) togglesDiv.style.display = 'none';
            setupCanvas(canvasContour, 1);
            drawContour();
        }
        document.getElementById('reg-component-controls').hidden = state.viewMode !== '3d' || !state.showTotal;
        document.getElementById('reg-scale-note').hidden = state.viewMode !== '3d';
        var scaleDescription = state.heightMode === 'linear' ? 'Linear height preserves each bowl’s shape. All surfaces share one height scale.' : 'Log height compresses steep regions. All surfaces share one height scale.';
        document.getElementById('reg-scale-note').textContent = (state.showConstraint ? 'The boundary shows the equivalent weight budget at the optimum. Red highlights the last slider adjusted; grey shows the reference shape. Dashed guides lie on the weight plane. ' : '') + scaleDescription + ' Surfaces are clipped at the displayed height; the mathematical bowls continue upward.';
        updateMathPanel();
        document.querySelector('.reg-component-legend span:nth-child(2)').style.color = getCS().modelPenalty;
        updateWeightReadout();
        var opt=state.optimum;
        if(budgetMode) {
            document.getElementById('reg-model-legend').hidden=false;
            document.getElementById('reg-model-loss-key').hidden=false;
            document.getElementById('reg-model-penalty-key').hidden=state.regType==='none'&&penaltyBlend===null;
            document.getElementById('reg-budget-explanation').hidden=true;
            document.getElementById('reg-component-controls').hidden=true;
            document.getElementById('reg-scale-note').textContent='The red walls end at the optimal loss height, meeting the blue bowl at the best allowed weights. The floor boundary determines feasibility; a budget of zero collapses the region.';
        }

        var none=state.regType==='none'&&penaltyBlend===null;
        var travel=optimumMotion?(optimumMotion.toNone?optimumMotion.progress:1-optimumMotion.progress):(none?1:0);
        var lambdaValue=state.lambda*(1-travel);
        var budgetSlider=document.getElementById('reg-budget-slider');
        var budgetEnd=optimumMotion?Math.max(state.budget,optimumMotion.unrestrictedBudget):Number(budgetSlider.max);
        var budgetValue=state.budget+(budgetEnd-state.budget)*travel;
        document.getElementById('reg-lambda-slider').max=Math.max(10,state.lambda);
        document.getElementById('reg-lambda-slider').value=lambdaValue;
        document.getElementById('reg-lambda-value').textContent=lambdaValue.toFixed(2);
        budgetSlider.max=Math.max(10,budgetEnd,state.budget);budgetSlider.value=none?budgetSlider.max:budgetValue;
        document.getElementById('reg-budget-value').textContent=none?'Unlimited':budgetValue.toFixed(2);
        document.getElementById('reg-budget-badge').classList.toggle('is-active',!none&&budgetEmphasized());
        document.getElementById('reg-strength-badge').classList.toggle('is-active',!none&&!budgetEmphasized());
        ['reg-lambda-slider','reg-budget-slider','reg-alpha-slider','reg-penalize-intercept'].forEach(function(id){
            var control=document.getElementById(id);if(control)control.disabled=state.regType==='none'||!!optimumMotion;
        });

    }


    function refreshRegression() {
        selectedWeights=null;
        regressionModel=window.RegularizedRegression.model(regressionPoints);
        state.gdPath=[]; state.gdAnimating=false;
        if(state.gdAnimFrame) cancelAnimationFrame(state.gdAnimFrame);
    }
    function seedRegression() {
        var preset=document.getElementById('reg-dataset').value;
        regressionPoints=[];
        dataBounds=null;
        for(var i=0;i<6;i++) {
            var x=-2+i*4/5, noise=[-.2,.25,-.1,.15][i%4];
            regressionPoints.push({x:x,y:.6+(preset==='flat'?.1:1.1)*x+noise});
        }
        if(preset==='outlier') regressionPoints.push({x:1.5,y:-2.5});
        refreshRegression();
    }
    function setupRegression() {
        seedRegression();
        var imported=new URLSearchParams(location.search).get('regression-data');
        if(imported) {
            try {
                var data=JSON.parse(imported);
                if(Array.isArray(data)&&data.length>=2&&data.length<=500&&data.every(function(p){return Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=100&&Math.abs(p.y)<=100;})) {
                    regressionPoints=data;dataBounds=null;refreshRegression();
                }
            } catch(error) { /* Ignore invalid optional dataset links. */ }
        }
        document.getElementById('reg-dataset').addEventListener('change',function(){seedRegression();redraw();});
        document.getElementById('reg-data-reset').addEventListener('click',function(){seedRegression();redraw();});
        document.getElementById('reg-penalize-intercept').addEventListener('change',function(e){state.penalizeIntercept=e.target.checked;state.gdPath=[];state.gdAnimating=false;redraw();});
        var dataCanvas=document.getElementById('reg-data-canvas'),lineDrag=null,suppressDataClick=false;
        function dataPointer(e) {
            var rect=dataCanvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
            var w=dataCanvas.width/dpr,h=dataCanvas.height/dpr;
            var px=(e.clientX-rect.left-dataCanvas.clientLeft)*w/dataCanvas.clientWidth;
            var py=(e.clientY-rect.top-dataCanvas.clientTop)*h/dataCanvas.clientHeight;
            return {px:px,py:py,w:w,h:h,x:dataBounds.x0+(px-38)/(w-54)*(dataBounds.x1-dataBounds.x0),y:dataBounds.y1-(py-16)/(h-46)*(dataBounds.y1-dataBounds.y0)};
        }
        dataCanvas.addEventListener('pointerdown',function(e) {
            suppressDataClick=false;
            if(!dataBounds||e.button!==0)return;
            var p=dataPointer(e),weights=currentWeights();
            if(p.px<38||p.px>p.w-16||p.py<16||p.py>p.h-30)return;
            var scaleY=(p.h-46)/(dataBounds.y1-dataBounds.y0),scaleX=(p.w-54)/(dataBounds.x1-dataBounds.x0);
            var distance=Math.abs(p.y-weights.w1-weights.w2*p.x)*scaleY/Math.hypot(1,weights.w2*scaleY/scaleX);
            if(distance>9)return;
            lineDrag={id:e.pointerId,start:p,b:weights.w1,m:weights.w2,rotate:e.shiftKey};
            dataCanvas.setPointerCapture(e.pointerId);
        });
        dataCanvas.addEventListener('pointermove',function(e) {
            if(!lineDrag||lineDrag.id!==e.pointerId)return;
            var p=dataPointer(e),d=lineDrag;
            if(!suppressDataClick&&Math.hypot(p.px-d.start.px,p.py-d.start.py)<3)return;
            suppressDataClick=true;
            if(d.rotate) {
                // Pivot at the opposite side of the plot to avoid instability near x = 0.
                var pivot=d.start.x<(dataBounds.x0+dataBounds.x1)/2?dataBounds.x1:dataBounds.x0;
                var dx=p.x-pivot;
                if(Math.abs(dx)<(dataBounds.x1-dataBounds.x0)*.05)return;
                var slope=(d.m*(d.start.x-pivot)+p.y-d.start.y)/dx;
                selectWeights(d.b+(d.m-slope)*pivot,slope);
            } else selectWeights(d.b+p.y-d.start.y-d.m*(p.x-d.start.x),d.m);
        });
        function endLineDrag(e) {if(lineDrag&&lineDrag.id===e.pointerId)lineDrag=null;}
        dataCanvas.addEventListener('pointerup',endLineDrag);
        dataCanvas.addEventListener('pointercancel',endLineDrag);
        dataCanvas.addEventListener('lostpointercapture',endLineDrag);
        document.getElementById('reg-data-canvas').addEventListener('click',function(e){
            if(suppressDataClick){suppressDataClick=false;return;}
            if(!dataBounds)return;
            var rect=this.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
            var w=this.width/dpr,h=this.height/dpr;
            // Match the canvas content coordinates, excluding its CSS border.
            var px=(e.clientX-rect.left-this.clientLeft)*w/this.clientWidth;
            var py=(e.clientY-rect.top-this.clientTop)*h/this.clientHeight;
            var x=dataBounds.x0+(px-38)/(w-54)*(dataBounds.x1-dataBounds.x0);
            var y=dataBounds.y1-(py-16)/(h-46)*(dataBounds.y1-dataBounds.y0);
            if(px<38||px>w-16||py<16||py>h-30)return;
            if(e.shiftKey) {
                if(regressionPoints.length<=2)return;
                var nearest=-1,distance=14;
                regressionPoints.forEach(function(p,index){var d=Math.hypot((p.x-x)/(dataBounds.x1-dataBounds.x0)*(w-54),(p.y-y)/(dataBounds.y1-dataBounds.y0)*(h-46));if(d<distance){distance=d;nearest=index;}});
                if(nearest<0)return;regressionPoints.splice(nearest,1);
            } else {if(regressionPoints.length>=500)return;regressionPoints.push({x:x,y:y});}
            refreshRegression();redraw();
        });
    }
    function drawRegression() {
        var canvas=document.getElementById('reg-data-canvas');setupCanvas(canvas,.48);
        if(!canvas.parentElement.clientWidth)return;
        var ctx=canvas.getContext('2d'),dpr=window.devicePixelRatio||1,w=canvas.width/dpr,h=canvas.height/dpr,c=getCS();
        ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle=c.bg;ctx.fillRect(0,0,w,h);
        // Keep the viewport fixed during edits so adding a point cannot move
        // the existing data or visually cancel the fitted line's response.
        // A new preset or imported dataset gets fresh bounds on its first draw.
        if(!dataBounds) {
            var xs=regressionPoints.map(function(p){return p.x;}),ys=regressionPoints.map(function(p){return p.y;});
            var minX=Math.min.apply(null,xs),maxX=Math.max.apply(null,xs),minY=Math.min.apply(null,ys),maxY=Math.max.apply(null,ys);
            var dx=Math.max(1,maxX-minX)*.15,dy=Math.max(1,maxY-minY)*.2;
            dataBounds={x0:minX-dx,x1:maxX+dx,y0:minY-dy,y1:maxY+dy};
        }
        var x0=dataBounds.x0,x1=dataBounds.x1,y0=dataBounds.y0,y1=dataBounds.y1;
        function X(x){return 38+(x-x0)/(x1-x0)*(w-54);}
        function Y(y){return 16+(y1-y)/(y1-y0)*(h-46);}
        ctx.font='10px sans-serif';ctx.fillStyle=c.textMuted;ctx.strokeStyle=c.gridLine;ctx.lineWidth=1;
        for(var i=0;i<=4;i++) {
            var x=x0+(x1-x0)*i/4,y=y0+(y1-y0)*i/4;
            ctx.beginPath();ctx.moveTo(X(x),16);ctx.lineTo(X(x),h-30);ctx.stroke();
            ctx.beginPath();ctx.moveTo(38,Y(y));ctx.lineTo(w-16,Y(y));ctx.stroke();
            ctx.textAlign='center';ctx.fillText(x.toFixed(1),X(x),h-15);
            ctx.textAlign='right';ctx.fillText(y.toFixed(1),32,Y(y)+3);
        }
        ctx.save();ctx.beginPath();ctx.rect(38,16,w-54,h-46);ctx.clip();
        var weights=currentWeights(),fit=[weights.w1,weights.w2];
        ctx.strokeStyle=c.gridLine;
        regressionPoints.forEach(function(p){ctx.beginPath();ctx.moveTo(X(p.x),Y(p.y));ctx.lineTo(X(p.x),Y(fit[0]+fit[1]*p.x));ctx.stroke();});
        function drawFit(coeffs,color,dash){ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.setLineDash(dash);ctx.beginPath();ctx.moveTo(X(x0),Y(coeffs[0]+coeffs[1]*x0));ctx.lineTo(X(x1),Y(coeffs[0]+coeffs[1]*x1));ctx.stroke();ctx.setLineDash([]);}
        drawFit(regressionModel.ordinary,c.modelLoss,[5,4]);
        drawFit([state.optimum.w1,state.optimum.w2],state.regType==='none'?c.modelLoss:c.modelTotal,selectedWeights?[3,4]:[]);
        if(selectedWeights)drawFit(fit,getComputedStyle(document.documentElement).getPropertyValue('--reg-selected-color').trim(),[]);
        regressionPoints.forEach(function(p){ctx.fillStyle=c.text;ctx.beginPath();ctx.arc(X(p.x),Y(p.y),3.5,0,2*Math.PI);ctx.fill();});ctx.restore();
        ctx.textAlign='right';ctx.fillStyle=c.textMuted;ctx.fillText('x',w-3,h-15);ctx.fillText('y',30,12);
    }

    // ========== Event Wiring ==========
    function init() {
        setupRegression();
        document.getElementById('reg-budget-slider').addEventListener('input',function(){
            linkedControlSource='budget';
            state.budget=parseFloat(this.value);
            state.lambda=regressionModel.lambdaForBudget(state.regType,state.budget,state.alpha,state.penalizeIntercept);
            redraw();
        });
        canvas3d = document.getElementById('reg-3d-canvas');
        canvasContour = document.getElementById('reg-contour-canvas');
        try { scene = new window.RegularizationScene(canvas3d); } catch (error) {
            state.viewMode = 'contour'; document.getElementById('reg-scene-help').textContent = error.message;
            document.querySelectorAll('[data-view]').forEach(function(b){b.disabled=b.dataset.view!=='contour';});
            document.querySelector('[data-view="contour"]').hidden=false;
            document.querySelectorAll('[data-view]').forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-view') === 'contour'); });
        }
        ctxContour = canvasContour.getContext('2d');

        redraw();

        // Theme changes
        if (window.VizLib && window.VizLib.ThemeManager) {
            window.VizLib.ThemeManager.onThemeChange(function() { redraw(); });
        }

        // Reg type buttons
        var regBtns = document.querySelectorAll('.reg-type-toggle .btn');
        regBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                regBtns.forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                var previous=state.regType,target=btn.getAttribute('data-reg');
                var from=penaltyBlend===null?(previous==='l1'?1:previous==='elastic'?state.alpha:0):penaltyBlend;
                var fromStrength=effectivePenalty().strength,fromOptimum=Object.assign({},state.optimum);
                if(penaltyAnimation)cancelAnimationFrame(penaltyAnimation);
                penaltyAnimation=0;penaltyBlend=null;penaltyStrength=1;optimumMotion=null;state.regType=target;
                state.gdAnimating=false;
                if(state.gdAnimFrame)cancelAnimationFrame(state.gdAnimFrame);
                state.gdPath=[];
                var reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                if(!reduced&&state.viewMode==='3d'&&['none','l1','l2','elastic'].includes(previous)&&['none','l1','l2','elastic'].includes(target)&&previous!==target) {
                    var start=performance.now(),to=target==='none'?from:target==='l1'?1:target==='elastic'?state.alpha:0,toStrength=target==='none'?0:1;
                    if(previous==='none')from=to;
                    if(previous==='none'||target==='none') {
                        var startCap=state.rimHeight;
                        computeOptimum();updateAutoHeight();
                        var endCap=state.rimHeight,toOptimum=Object.assign({},state.optimum);
                        var regularizedCap=target==='none'?startCap:endCap;
                        optimumMotion={from:fromOptimum,to:toOptimum,progress:0,penaltyAlpha:target==='none'?from:to,
                            penaltyCap:regularizedCap,startCap:startCap,endCap:endCap,toNone:target==='none'};
                        var unrestricted=target==='none'?toOptimum:fromOptimum;
                        var b=state.regression&&!state.penalizeIntercept?0:unrestricted.w1,m=unrestricted.w2,a=optimumMotion.penaltyAlpha;
                        var endpointCost=state.lambda*(a*(Math.abs(b)+Math.abs(m))+(1-a)*(b*b+m*m));
                        // A bounded expansion reaches the ordinary fit; it never divides by a fading strength.
                        optimumMotion.expandedStrength=endpointCost>0?Math.max(.02,Math.min(1,.9*regularizedCap/endpointCost)):1;
                        optimumMotion.unrestrictedBudget=a*(Math.abs(b)+Math.abs(m))+(1-a)*(b*b+m*m);
                        state.rimHeight=startCap;state.optimum=fromOptimum;
                    }
                    var duration=optimumMotion?1400:1000;
                    function morph(now) {
                        var t=Math.min(1,(now-start)/duration),ease=t*t*(3-2*t);
                        if(optimumMotion){optimumMotion.progress=ease;if(t===1)optimumMotion=null;}
                        penaltyBlend=t<1?from+(to-from)*ease:null;
                        penaltyStrength=t<1?fromStrength+(toStrength-fromStrength)*ease:1;
                        redraw();
                        penaltyAnimation=t<1?requestAnimationFrame(morph):0;
                    }
                    penaltyBlend=from;penaltyStrength=fromStrength;
                    penaltyAnimation=requestAnimationFrame(morph);
                } else redraw();
            });
        });

        // Independent surface layers can be compared in any combination.
        document.querySelectorAll('[data-layer]').forEach(function(input) {
            input.addEventListener('change',function(){
                state[input.dataset.layer]=input.checked;
                state.showBoth=state.showLoss&&state.showPenalty;
                redraw();
            });
        });

        document.getElementById('reg-components').addEventListener('change', function(e) {
            state.showComponents=e.target.checked; redraw();
        });

        // Presets animate the same scene; only Free 3D permits orbiting.
        var viewBtns = document.querySelectorAll('.reg-view-toggle .btn');
        function chooseView(view) {
            if(cameraAnimation)cancelAnimationFrame(cameraAnimation);
            state.cameraPreset=view;
            state.viewMode=view==='contour'?'contour':'3d';
            viewBtns.forEach(function(b){b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});
            updateInputHelp();
            redraw();
            if(view==='contour')return;
            var startYaw=state.yaw,startPitch=state.pitch,startOpacity=state.surfaceOpacity,targetOpacity=view==='3d'?1:0,startWallOpacity=state.budgetWallOpacity,targetWallOpacity=view==='top'?0:1;
            var targetYaw=view==='top'?startYaw:defaultSideYaw(),targetPitch=view==='top'?Math.PI/2:view==='side'?Math.PI/36:Math.PI/18;
            var focus=state.regression?currentWeights():state.optimum,focusPoint=[focus.w1,0,focus.w2],startPan=scene.pan.slice();
            // Pick the shortest angular path even after several complete orbits.
            var dy=Math.atan2(Math.sin(targetYaw-startYaw),Math.cos(targetYaw-startYaw));
            var dp=Math.atan2(Math.sin(targetPitch-startPitch),Math.cos(targetPitch-startPitch));
            var start=performance.now(),duration=window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:850;
            function tick(now) {
                var t=duration?Math.min(1,(now-start)/duration):1,ease=t*t*(3-2*t);
                state.yaw=startYaw+dy*ease;state.pitch=startPitch+dp*ease;state.surfaceOpacity=startOpacity+(targetOpacity-startOpacity)*ease;state.budgetWallOpacity=startWallOpacity+(targetWallOpacity-startWallOpacity)*ease;
                var centeredPan=scene.panForPoint(focusPoint,state);
                scene.pan=[startPan[0]+(centeredPan[0]-startPan[0])*ease,startPan[1]+(centeredPan[1]-startPan[1])*ease];
                renderCamera();
                if(t<1)cameraAnimation=requestAnimationFrame(tick);else {state.yaw=targetYaw;state.pitch=targetPitch;cameraAnimation=0;renderCamera();}
            }
            cameraAnimation=requestAnimationFrame(tick);
        }
        viewBtns.forEach(function(btn){btn.addEventListener('click',function(){chooseView(btn.dataset.view);});});

        function updateInputHelp() {
            var help=trackpadInput?'Trackpad: click-drag to pan · Two-finger swipe to rotate · Pinch to zoom.':'Mouse: drag to rotate · Shift-drag or right-drag to pan · Wheel to zoom.';
            if(state.cameraPreset==='top')help='Top view: loss contours appear up to the selected loss. The strongest ring marks its level. Rotation locked · Drag to pan · Pinch or mouse wheel to zoom.';
            if(state.cameraPreset==='side')help='Side view: 5° above the floor, tilt locked. '+(trackpadInput?'Swipe horizontally with two fingers to orbit · Click-drag to pan · Pinch to zoom.':'Drag horizontally to orbit · Shift-drag to pan · Wheel to zoom.')+' Drag the weight marker in any direction to move across the weight plane.';
            document.getElementById('reg-pan-help').textContent=help;
            document.getElementById('reg-scene-help').textContent=help+' Drag the weight ring to change the line.';
            canvas3d.setAttribute('aria-label','3D loss and penalty surfaces. '+help+(state.cameraPreset==='side'?' Left/right arrows orbit; tilt stays locked. Shift + arrow keys pan.':' Arrow keys rotate; Shift + arrow keys pan.'));
            canvas3d.style.cursor=trackpadInput?'move':'grab';
        }
        document.getElementById('reg-input-device').addEventListener('change',function(){trackpadInput=this.value==='trackpad';updateInputHelp();});
        updateInputHelp();

        document.getElementById('reg-optimal-fit').addEventListener('click',function(){
            cancelWeightSnap();selectedWeights=null;
            state.gdAnimating=false;if(state.gdAnimFrame)cancelAnimationFrame(state.gdAnimFrame);
            resetCameraView();
        });
        // Pointer capture keeps orbit/pan working outside the canvas; two fingers pan and pinch.
        var pointers = new Map(), dragDist = 0, previousGesture = null, weightDrag = false, bowlDrag = null, weightDragMapping = null;
        function gesture() {
            var p = Array.from(pointers.values());
            return {x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2,d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)};
        }
        canvas3d.addEventListener('contextmenu',function(e){e.preventDefault();});
        canvas3d.addEventListener('pointerdown',function(e){
            canvas3d.setPointerCapture(e.pointerId); pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
            dragDist=0; previousGesture=pointers.size===2?gesture():null;
            var rect=canvas3d.getBoundingClientRect(),weights=currentWeights(),p=scene.project([weights.w1,0,weights.w2]);
            weightDrag=state.regression&&pointers.size===1&&!e.shiftKey&&e.button!==2&&p.depth>0&&Math.hypot(e.clientX-rect.left-p.x,e.clientY-rect.top-p.y)<18;
            weightDragMapping=null;
            if(weightDrag) {
                var px=scene.project([weights.w1+1,0,weights.w2]),pz=scene.project([weights.w1,0,weights.w2+1]);
                var ax=px.x-p.x,ay=px.y-p.y,bx=pz.x-p.x,by=pz.y-p.y,det=ax*by-bx*ay,map;
                if(Math.abs(det)<1e-6) {
                    var rx=Math.cos(state.yaw),rz=-Math.sin(state.yaw);
                    var right=scene.project([weights.w1+rx,0,weights.w2+rz]);
                    var scale=Math.max(1,Math.abs(right.x-p.x));map=[rx/scale,0,rz/scale,0];
                } else map=[by/det,-bx/det,-ay/det,ax/det];
                var gain=Math.hypot.apply(null,map);
                if(gain>.025)map=map.map(function(value){return value*.025/gain;});
                map=map.map(function(value){return value*.8;});
                weightDragMapping={x:e.clientX,y:e.clientY,b:weights.w1,m:weights.w2,map:map};
            }
            bowlDrag=null;
            if(state.regression&&pointers.size===1&&!e.shiftKey&&e.button===0&&scene.lossMinimum) {
                var minimum=scene.lossMinimum,screen=scene.project(minimum);
                var distance=Math.hypot(e.clientX-rect.left-screen.x,e.clientY-rect.top-screen.y);
                if(screen.depth>0&&distance<12&&(!weightDrag||distance<Math.hypot(e.clientX-rect.left-p.x,e.clientY-rect.top-p.y))) {
                    weightDrag=false;
                    var px=scene.project([minimum[0]+1,minimum[1],minimum[2]]),pz=scene.project([minimum[0],minimum[1],minimum[2]+1]);
                    var ax=px.x-screen.x,ay=px.y-screen.y,bx=pz.x-screen.x,by=pz.y-screen.y,det=ax*by-bx*ay;
                    var map;
                    if(Math.abs(det)<1e-6) {
                        var rx=Math.cos(state.yaw),rz=-Math.sin(state.yaw);
                        var right=scene.project([minimum[0]+rx,minimum[1],minimum[2]+rz]);
                        var scale=Math.max(1,Math.abs(right.x-screen.x));
                        map=[rx/scale,0,rz/scale,0];
                    } else map=[by/det,-bx/det,-ay/det,ax/det];
                    // Freeze the screen-to-weight mapping and cap sensitivity near edge-on views.
                    var gain=Math.hypot.apply(null,map),limit=.025;
                    if(gain>limit)map=map.map(function(value){return value*limit/gain;});
                    bowlDrag={startX:e.clientX,startY:e.clientY,b:minimum[0],m:minimum[2],map:map,
                        residuals:regressionPoints.map(function(point){return {x:point.x,residual:point.y-regressionModel.ordinary[0]-regressionModel.ordinary[1]*point.x};})};
                }
            }
        });
        canvas3d.addEventListener('pointermove',function(e){
            if(!pointers.has(e.pointerId)) return;
            var old=pointers.get(e.pointerId), dx=e.clientX-old.x,dy=e.clientY-old.y;
            pointers.set(e.pointerId,{x:e.clientX,y:e.clientY}); dragDist+=Math.abs(dx)+Math.abs(dy);
            if(bowlDrag&&pointers.size===1) {
                var d=bowlDrag,dxTotal=e.clientX-d.startX,dyTotal=e.clientY-d.startY;
                var hit={w1:Math.max(-8,Math.min(8,d.b+d.map[0]*dxTotal+d.map[1]*dyTotal)),
                    w2:Math.max(-8,Math.min(8,d.m+d.map[2]*dxTotal+d.map[3]*dyTotal))};
                if(!Number.isFinite(hit.w1)||!Number.isFinite(hit.w2))return;
                if(hit) {
                    regressionPoints=bowlDrag.residuals.map(function(point){return {x:point.x,y:hit.w1+hit.w2*point.x+point.residual};});
                    refreshRegression();
                    // Keep all shifted data visible without changing the x coordinates.
                    var ys=regressionPoints.map(function(point){return point.y;}),low=Math.min.apply(null,ys),high=Math.max.apply(null,ys),padding=Math.max(1,high-low)*.2;
                    dataBounds.y0=low-padding;dataBounds.y1=high+padding;
                    redraw();
                }
                return;
            }
            if(weightDrag&&weightDragMapping&&pointers.size===1) {
                var d=weightDragMapping,dxTotal=e.clientX-d.x,dyTotal=e.clientY-d.y;
                var w1=d.b+d.map[0]*dxTotal+d.map[1]*dyTotal,w2=d.m+d.map[2]*dxTotal+d.map[3]*dyTotal;
                if(Number.isFinite(w1)&&Number.isFinite(w2))selectWeights(w1,w2,true);
                return;
            }
            if(pointers.size===2) {
                var next=gesture(); if(previousGesture) {scene.panBy(next.x-previousGesture.x,next.y-previousGesture.y,state); setUserZoom(state.zoom*next.d/Math.max(1,previousGesture.d));} previousGesture=next;
            } else if(state.cameraPreset==='top' || trackpadInput || e.shiftKey || e.buttons===2) scene.panBy(dx,dy,state);
            else {state.yaw-=dx*.008;if(state.cameraPreset!=='side')state.pitch+=dy*.008;}
            document.getElementById('reg-zoom-value').textContent=Math.round(state.zoom*100)+'%';
            document.getElementById('reg-zoom-out').disabled=state.zoom<=.01;
            document.getElementById('reg-zoom-in').disabled=state.zoom>=3;
            renderCamera();
        });
        function release(e) {
            if(e.type==='pointerup'&&pointers.size===1&&dragDist<5&&state.showTotal&&!state.regression&&state.formulation!=='budget') {
                var rect=canvas3d.getBoundingClientRect(), picked=scene.pick(e.clientX-rect.left,e.clientY-rect.top);
                if(picked) startGD(picked.w1,picked.w2);
            }
            var wasBowlDrag=!!bowlDrag;
            pointers.delete(e.pointerId); previousGesture=null;weightDrag=false;bowlDrag=null;
            if(wasBowlDrag)redraw();
        }
        canvas3d.addEventListener('pointerup',release); canvas3d.addEventListener('pointercancel',release);
        canvas3d.addEventListener('keydown',function(e) {
            var arrows={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,.1],ArrowDown:[0,-.1]};
            if((e.shiftKey||state.cameraPreset==='top')&&arrows[e.key]){e.preventDefault();scene.panBy(arrows[e.key][0]*200,-arrows[e.key][1]*200,state);renderCamera();return;}
            if(arrows[e.key]) {e.preventDefault();state.yaw+=arrows[e.key][0];if(state.cameraPreset!=='side')state.pitch+=arrows[e.key][1];renderCamera();}
        });
        function resetCameraView() {
            if(!scene){redraw();return;}
            if(cameraAnimation)cancelAnimationFrame(cameraAnimation);cameraAnimation=0;state.surfaceOpacity=state.cameraPreset==='3d'?1:0;state.budgetWallOpacity=state.cameraPreset==='top'?0:1;
            scene.resetFraming(); scene.pan=[0,0]; state.yaw=state.cameraPreset==='top'?0:defaultSideYaw(); state.pitch=state.cameraPreset==='top'?Math.PI/2:state.cameraPreset==='side'?Math.PI/36:Math.PI/18; state.zoom=1; state.bowlReveal=1; state.stretch=1.3; document.getElementById('reg-stretch').value=1.3; redraw();
            scene.pan=scene.panForPoint([state.optimum.w1,0,state.optimum.w2],state);renderCamera();
        }
        document.getElementById('reg-camera-reset').addEventListener('click',resetCameraView);

        document.getElementById('reg-height-mode').addEventListener('change',function(e) {
            state.heightMode=e.target.value; redraw();
        });
        document.getElementById('reg-stretch').addEventListener('input',function(e) {
            state.stretch=parseFloat(e.target.value); redraw();
        });
        function setUserZoom(zoom) {
            var previous=state.zoom;
            state.zoom=Math.max(.01,Math.min(3,zoom));
            // Only direct zoom gestures change the cutoff. Automatic framing must
            // not feed back into surface size and trigger more automatic zoom.
            state.bowlReveal=Math.max(.25,Math.min(100,state.bowlReveal*Math.pow(previous/state.zoom,1.4)));
            scene.update(displayState(),getCS(),lossAt,penaltyAt,totalAt);
        }
        function changeZoom(delta) {
            setUserZoom(state.zoom+delta);
            document.getElementById('reg-zoom-value').textContent=Math.round(state.zoom*100)+'%';
            document.getElementById('reg-zoom-out').disabled=state.zoom<=.01;
            document.getElementById('reg-zoom-in').disabled=state.zoom>=3;
            renderCamera();
        }
        document.getElementById('reg-zoom-out').addEventListener('click',function() { changeZoom(-0.1); });
        document.getElementById('reg-zoom-in').addEventListener('click',function() { changeZoom(0.1); });
        // Chromium reports trackpad pinch as a Ctrl+wheel event. Safari uses gesture events.
        var nativePinch=false,pinchZoom=1;
        canvas3d.addEventListener('wheel',function(e) {
            e.preventDefault();
            if(nativePinch)return;
            if(e.ctrlKey) changeZoom(state.zoom*(Math.exp(-e.deltaY*.01)-1));
            else if(trackpadInput) {
                var unit=e.deltaMode===1?16:e.deltaMode===2?canvas3d.clientHeight:1;
                if(state.cameraPreset==='3d'){state.yaw-=e.deltaX*unit*.006;state.pitch+=e.deltaY*unit*.006;}else if(state.cameraPreset==='side'){state.yaw-=e.deltaX*unit*.006;}else scene.panBy(-e.deltaX*unit,-e.deltaY*unit,state);
                renderCamera();
            } else changeZoom(e.deltaY>0?-.05:e.deltaY<0?.05:0);
        },{passive:false});
        canvas3d.addEventListener('gesturestart',function(e){e.preventDefault();nativePinch=true;pinchZoom=state.zoom;},{passive:false});
        canvas3d.addEventListener('gesturechange',function(e){e.preventDefault();if(Number.isFinite(e.scale))changeZoom(pinchZoom*e.scale-state.zoom);},{passive:false});
        canvas3d.addEventListener('gestureend',function(e){e.preventDefault();nativePinch=false;},{passive:false});

        // Drag in the 2D weight plane; illustrative examples retain gradient descent.
        var contourDragging=false;
        function contourWeight(e) {
            var rect=canvasContour.getBoundingClientRect();
            var range=state.regression?Math.max(3,Math.abs(state.cx)+1,Math.abs(state.cy)+1):3;
            var x=(e.clientX-rect.left)/rect.width,y=(e.clientY-rect.top)/rect.height;
            if(!contourDragging&&(x<.08||x>.92||y<.08||y>.92))return;
            var w0=Math.max(-range,Math.min(range,(x-.08)/.84*2*range-range));
            var w1=Math.max(-range,Math.min(range,range-(y-.08)/.84*2*range));
            if(state.regression)selectWeights(w0,w1,true);else if(state.formulation!=='budget')startGD(w0,w1);
        }
        canvasContour.addEventListener('pointerdown',function(e){
            if(e.button!==0)return;
            canvasContour.setPointerCapture(e.pointerId);contourWeight(e);contourDragging=state.regression;
        });
        canvasContour.addEventListener('pointermove',function(e){if(contourDragging)contourWeight(e);});
        canvasContour.addEventListener('pointerup',function(){contourDragging=false;});
        canvasContour.addEventListener('pointercancel',function(){contourDragging=false;});

        // Sliders
        function wireSlider(id, key, displayId, formatter) {
            var slider = document.getElementById(id);
            var display = document.getElementById(displayId);
            if (!slider) return;
            slider.addEventListener('input', function() {
                var v = parseFloat(slider.value);
                state[key] = v;
                display.innerHTML = formatter ? formatter(v) : v.toFixed(2);
                redraw();
            });
        }

        document.getElementById('reg-auto-height').addEventListener('change',function(){state.autoHeight=this.checked;if(!state.autoHeight)state.rimHeight=parseFloat(document.getElementById('reg-rim-height').value);redraw();});
        wireSlider('reg-rim-height', 'rimHeight', 'reg-rim-value', function(v) { return v.toFixed(0); });
        document.getElementById('reg-lambda-slider').addEventListener('input',function(){
            linkedControlSource='penalty';
            state.lambda=parseFloat(this.value);
            var fit=regressionModel.fit(state.regType,state.lambda,state.alpha,state.penalizeIntercept);
            state.budget=penaltyAt(fit[0],fit[1]);
            redraw();
        });
        wireSlider('reg-ecc-slider', 'eccentricity', 'reg-ecc-value', function(v) { return v.toFixed(1); });
        wireSlider('reg-cx-slider', 'cx', 'reg-cx-value');
        wireSlider('reg-cy-slider', 'cy', 'reg-cy-value');
        wireSlider('reg-alpha-slider', 'alpha', 'reg-alpha-value');
        wireSlider('reg-rot-slider', 'rotation', 'reg-rot-value', function(v) { return v + '&deg;'; });
        wireSlider('reg-lr-slider', 'gdLR', 'reg-lr-value', function(v) { return v.toFixed(3); });

        // Clear GD path
        document.getElementById('reg-clear-path-btn').addEventListener('click', function() {
            state.gdPath = [];
            state.gdAnimating = false;
            if (state.gdAnimFrame) cancelAnimationFrame(state.gdAnimFrame);
            redraw();
        });

        // Reset
        document.getElementById('reg-reset-btn').addEventListener('click', function() {
            state.regType = 'l2'; state.lambda = 1.0; state.eccentricity = 4.0;
            state.cx = 1.5; state.cy = 1.0; state.alpha = 0.5; state.rotation = 30;
            if(scene) scene.pan=[0,0]; state.yaw = -0.6; state.pitch = 0.7; state.zoom = 1;
            state.heightMode='linear'; state.stretch=1.3; state.rimHeight=6; state.autoHeight=true;
            document.getElementById('reg-rim-height').value=6;
            document.getElementById('reg-height-mode').value='linear';
            document.getElementById('reg-stretch').value=1.3;

            document.getElementById('reg-lambda-slider').value = 1;
            document.getElementById('reg-lambda-value').textContent = '1.00';
            document.getElementById('reg-ecc-slider').value = 4;
            document.getElementById('reg-ecc-value').textContent = '4.0';
            document.getElementById('reg-cx-slider').value = 1.5;
            document.getElementById('reg-cx-value').textContent = '1.50';
            document.getElementById('reg-cy-slider').value = 1;
            document.getElementById('reg-cy-value').textContent = '1.00';
            document.getElementById('reg-alpha-slider').value = 0.5;
            document.getElementById('reg-alpha-value').textContent = '0.50';
            document.getElementById('reg-rot-slider').value = 30;
            document.getElementById('reg-rot-value').innerHTML = '30&deg;';

            if(cameraAnimation)cancelAnimationFrame(cameraAnimation);cameraAnimation=0;state.cameraPreset='3d';state.surfaceOpacity=1;state.budgetWallOpacity=1;
            state.formulation='penalty';linkedControlSource=null;state.budget=1;selectedWeights=null;
            document.getElementById('reg-budget-slider').value=1;
            state.viewMode = scene ? '3d' : 'contour';
            state.showLoss = true;
            state.showPenalty = true;
            state.showTotal = false;
            state.showConstraint = true;
            state.showBoth = true;
            state.showComponents = false;
            document.getElementById('reg-components').checked = false;
            state.gdPath = [];
            state.gdAnimating = false;
            state.gdLR = 0.05;
            if (state.gdAnimFrame) cancelAnimationFrame(state.gdAnimFrame);

            document.getElementById('reg-lr-slider').value = 0.05;
            document.getElementById('reg-lr-value').textContent = '0.050';

            var regBtns2 = document.querySelectorAll('.reg-type-toggle .btn');
            regBtns2.forEach(function(b) {
                b.classList.toggle('active', b.getAttribute('data-reg') === 'l2');
            });
            var viewBtns2 = document.querySelectorAll('.reg-view-toggle .btn');
            viewBtns2.forEach(function(b) {
                b.classList.toggle('active', b.getAttribute('data-view') === state.viewMode);
            });
            document.querySelectorAll('.reg-surface-toggle').forEach(function(label) {
                var s = label.getAttribute('data-surface');
                label.classList.toggle('active', s === 'both');
                label.setAttribute('aria-pressed', String(s === 'both'));
            });

            redraw();
        });

        // Resize
        var resizeTimer;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(redraw, 100);
        });

        // Reveal the linked data only on actual plot/control interaction, not
        // hover, page scrolling, URL restoration, or automatic animations.
        var weightPanel=document.querySelector('.reg-weight-column');
        function revealLiveMath(event) {
            if(!event.isTrusted)return;
            var target=event.target;
            if(event.type==='wheel'||event.type==='gesturestart') {
                if(target!==canvas3d&&target!==canvasContour)return;
            } else if(!target.closest('canvas,button,input,select,label'))return;
            if(event.type==='keydown'&&!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(event.key))return;
            var dataTab=document.querySelector('.info-panel-tabs [data-tab="math"]');
            if(dataTab&&!dataTab.classList.contains('active'))dataTab.click();
        }
        ['pointerdown','click','input','change','keydown','wheel','gesturestart'].forEach(function(type){
            weightPanel.addEventListener(type,revealLiveMath,{passive:true});
        });

        // Info tab switching
        document.querySelectorAll('.info-panel-tabs .btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var tabId = btn.getAttribute('data-tab');
                btn.closest('.info-panel-tabs').querySelectorAll('.btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                var panel = btn.closest('.panel');
                panel.querySelectorAll('.info-tab-content').forEach(function(t) { t.classList.remove('active'); });
                var target = panel.querySelector('#tab-' + tabId);
                if (target) target.classList.add('active');
                if(tabId==='math' && state.regression) drawRegression();
            });
        });
    }

    // ========== Entry Point ==========
    if (window.VizLib && window.VizLib._ready) {
        init();
    } else {
        window.addEventListener('vizlib-ready', init);
    }
})();
