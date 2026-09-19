/**
 * Logistic Regression Visualizer
 *
 * Interactive visualization with sigmoid function, animated gradient descent,
 * decision boundary, and probability gradient display.
 */
(function() {
    'use strict';

    const CANVAS_W = 560, CANVAS_H = 400;
    const SIG_W = 560, SIG_H = 160;
    const PAD = 10;
    const POINT_R = 6;
    const BOUNDARY_RES = 60;

    // State
    let points = [];
    let weights = [-2, 2]; // w1, w2
    let startingWeights = [-2, 2], startingBias = 0;
    let cameraPreset = 'orbit';
    let axisCorner = {x:0,y:0};
    let geometryView = 'probability', selectedPoint = 0, screenPoints = [], weightHandles = [], scoreExtent = 8, geometryLabels = [];
    let camera = {yaw:-3*Math.PI/4,pitch:.55,zoom:1,panX:0,panY:0,sideTint:0};
    let bias = 0;
    let trainedState = true;
    let lossHistory = [];
    let iteration = 0;
    let lastUpdate = null;
    let trainTimer = null;
    let editMode = 'inspect';
    let selectedClass = 0;
    let showProbability = true, showBoundaryLine = true;

    let canvas, ctx, dpr;
    let surfaceCanvas;
    let sigCanvas, sigCtx, sigDpr;
    let lossCurveCanvas, lossCurveCtx, lossCurveDpr;

    // ============================================
    // Math
    // ============================================
    function sigmoid(z) { return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z)))); }

    function predict(x, y) {
        return sigmoid(weights[0] * x + weights[1] * y + bias);
    }

    function computeLoss() {
        if (points.length === 0) return 0;
        let loss = 0;
        for (const p of points) {
            const z=scoreAt(p.x,p.y);
            loss += Math.max(z,0)-p.classLabel*z+Math.log1p(Math.exp(-Math.abs(z)));
        }
        return loss / points.length;
    }

    function gradientStep(lr) {
        const n = points.length;
        let dw0 = 0, dw1 = 0, db = 0;
        for (const p of points) {
            const prob = predict(p.x, p.y);
            const err = prob - p.classLabel;
            dw0 += err * p.x;
            dw1 += err * p.y;
            db += err;
        }
        if(!n)return;
        const before=[...weights,bias];
        weights[0] -= lr * dw0 / n;
        weights[1] -= lr * dw1 / n;
        bias -= lr * db / n;
        lastUpdate={before,after:[...weights,bias],gradient:[dw0/n,dw1/n,db/n],lr};
    }

    function computeAccuracy() {
        if (points.length === 0) return 0;
        let correct = 0;
        for (const p of points) {
            const pred = predict(p.x, p.y) >= 0.5 ? 1 : 0;
            if (pred === p.classLabel) correct++;
        }
        return correct / points.length;
    }

    // ============================================
    // Coordinate transforms (data in [0,1])
    // ============================================
    function d2c(dx, dy) {
        return {
            x: PAD + dx * (CANVAS_W - 2 * PAD),
            y: PAD + (1 - dy) * (CANVAS_H - 2 * PAD)
        };
    }
    function c2d(cx, cy) {
        return {
            x: (cx - PAD) / (CANVAS_W - 2 * PAD),
            y: 1 - (cy - PAD) / (CANVAS_H - 2 * PAD)
        };
    }

    // ============================================
    // Dataset generators
    // ============================================
    function generateDataset(type) {
        points = [];
        const DG = window.VizLib && window.VizLib.DatasetGenerators;
        let raw = [];
        switch (type) {
            case 'linear': raw = DG ? DG.linear(20) : []; break;
            case 'overlap':
                for (let i = 0; i < 20; i++) {
                    const x = Math.random(), y = Math.random();
                    const cls = y > x + (Math.random() - 0.5) * 0.5 ? 1 : 0;
                    raw.push({ x, y, classLabel: cls });
                }
                break;
            case 'moons': raw = DG ? DG.moons(20, 0.12) : []; break;
            case 'xor': raw = DG ? DG.xor(20, 0.06) : []; break;
        }
        points = raw.map(p => ({ x: p.x, y: p.y, classLabel: p.classLabel }));
    }

    // ============================================
    // Drawing
    // ============================================
    function getColors() {
        const s = getComputedStyle(document.documentElement);
        return {
            class0: s.getPropertyValue('--viz-class-0').trim() || '#e41a1c',
            class1: s.getPropertyValue('--viz-class-1').trim() || '#377eb8',
            boundary: s.getPropertyValue('--logreg-boundary-color').trim() || '#333',
            bg: s.getPropertyValue('--viz-canvas-bg').trim() || '#fafafa',
            muted: s.getPropertyValue('--viz-text-muted').trim() || '#6c757d',
            sigColor: s.getPropertyValue('--logreg-sigmoid-color').trim() || '#e41a1c',
            sigMarker: s.getPropertyValue('--logreg-sigmoid-marker').trim() || '#ff9800',
            border: s.getPropertyValue('--viz-border').trim() || '#dee2e6',
        };
    }

    function render() {
        const c = getColors();
        const CU = window.VizLib.CanvasUtils;
        CU.resetCanvasTransform(ctx, dpr);
        CU.clearCanvas(ctx, CANVAS_W, CANVAS_H, c.bg);

        screenPoints = []; weightHandles = [];
        if (geometryView !== '2d') {renderSurface(c); return;}

        // Probability gradient background
        if (showProbability && trainedState) {
            const cellW = (CANVAS_W - 2 * PAD) / BOUNDARY_RES;
            const cellH = (CANVAS_H - 2 * PAD) / BOUNDARY_RES;
            for (let i = 0; i < BOUNDARY_RES; i++) {
                for (let j = 0; j < BOUNDARY_RES; j++) {
                    const dx = i / (BOUNDARY_RES - 1);
                    const dy = j / (BOUNDARY_RES - 1);
                    const prob = predict(dx, dy);
                    // Color: class0 color at prob=0, class1 color at prob=1
                    const r0 = parseInt(c.class0.slice(1, 3), 16);
                    const g0 = parseInt(c.class0.slice(3, 5), 16);
                    const b0 = parseInt(c.class0.slice(5, 7), 16);
                    const r1 = parseInt(c.class1.slice(1, 3), 16);
                    const g1 = parseInt(c.class1.slice(3, 5), 16);
                    const b1 = parseInt(c.class1.slice(5, 7), 16);
                    const r = Math.round(r0 + (r1 - r0) * prob);
                    const g = Math.round(g0 + (g1 - g0) * prob);
                    const b = Math.round(b0 + (b1 - b0) * prob);
                    ctx.fillStyle = `rgba(${r},${g},${b},0.15)`;
                    ctx.fillRect(
                        PAD + i * cellW,
                        PAD + (BOUNDARY_RES - 1 - j) * cellH,
                        cellW + 1, cellH + 1
                    );
                }
            }
        }

        // Decision boundary line (where w·x + b = 0)
        if (showBoundaryLine && trainedState) {
            const wMag = Math.sqrt(weights[0] ** 2 + weights[1] ** 2);
            if (wMag > 1e-6) {
                ctx.strokeStyle = c.boundary;
                ctx.lineWidth = 2.5;
                ctx.setLineDash([]);

                // Find two endpoints on the canvas boundary
                const linePoints = [];
                // y = -(w0*x + b) / w1
                if (Math.abs(weights[1]) > 1e-6) {
                    for (const dx of [0, 1]) {
                        const dy = -(weights[0] * dx + bias) / weights[1];
                        if (dy >= -0.1 && dy <= 1.1) linePoints.push(d2c(dx, dy));
                    }
                }
                // x = -(w1*y + b) / w0
                if (Math.abs(weights[0]) > 1e-6) {
                    for (const dy of [0, 1]) {
                        const dx = -(weights[1] * dy + bias) / weights[0];
                        if (dx >= -0.1 && dx <= 1.1) linePoints.push(d2c(dx, dy));
                    }
                }

                if (linePoints.length >= 2) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(PAD, PAD, CANVAS_W - 2 * PAD, CANVAS_H - 2 * PAD);
                    ctx.clip();
                    ctx.beginPath();
                    ctx.moveTo(linePoints[0].x, linePoints[0].y);
                    ctx.lineTo(linePoints[1].x, linePoints[1].y);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }

        // The selected point is linked to the sigmoid; hollow points are mistakes.
        points.forEach((p,i)=>{const cp=d2c(p.x,p.y);screenPoints.push({...cp,index:i});drawGeometryPoint(cp,p,i,c);});

    }

    // ============================================
    // Sigmoid display
    // ============================================
    function renderSigmoid() {
        if (!sigCanvas) return;
        const c = getColors();
        const CU = window.VizLib.CanvasUtils;
        CU.resetCanvasTransform(sigCtx, sigDpr);
        CU.clearCanvas(sigCtx, SIG_W, SIG_H, c.bg);

        const pad = { l: 50, r: 20, t: 15, b: 25 };
        const pw = SIG_W - pad.l - pad.r;
        const ph = SIG_H - pad.t - pad.b;
        const selectedZ=points[selectedPoint]?scoreAt(points[selectedPoint].x,points[selectedPoint].y):0;
        const limit=Math.max(6,Math.ceil(Math.abs(selectedZ)*1.15));
        const zMin=-limit,zMax=limit;

        // Axes
        sigCtx.strokeStyle = c.border;
        sigCtx.lineWidth = 1;
        sigCtx.beginPath();
        sigCtx.moveTo(pad.l, pad.t + ph);
        sigCtx.lineTo(pad.l + pw, pad.t + ph);
        sigCtx.stroke();
        sigCtx.beginPath();
        sigCtx.moveTo(pad.l, pad.t);
        sigCtx.lineTo(pad.l, pad.t + ph);
        sigCtx.stroke();

        // Grid lines
        sigCtx.strokeStyle = c.border;
        sigCtx.lineWidth = 0.3;
        sigCtx.setLineDash([2, 4]);
        // Horizontal at 0.5
        const halfY = pad.t + ph * 0.5;
        sigCtx.beginPath(); sigCtx.moveTo(pad.l, halfY); sigCtx.lineTo(pad.l + pw, halfY); sigCtx.stroke();
        // Vertical at 0
        const zeroX = pad.l + pw * 0.5;
        sigCtx.beginPath(); sigCtx.moveTo(zeroX, pad.t); sigCtx.lineTo(zeroX, pad.t + ph); sigCtx.stroke();
        sigCtx.setLineDash([]);

        // Labels
        sigCtx.fillStyle = c.muted;
        sigCtx.font = '10px sans-serif';
        sigCtx.textAlign = 'center';
        for (let z = -limit; z <= limit; z += limit/3) {
            const x = pad.l + ((z - zMin) / (zMax - zMin)) * pw;
            sigCtx.fillText(Number(z.toFixed(1)), x, pad.t + ph + 15);
        }
        sigCtx.textAlign = 'right';
        sigCtx.fillText('0', pad.l - 5, pad.t + ph + 3);
        sigCtx.fillText('0.5', pad.l - 5, halfY + 3);
        sigCtx.fillText('1', pad.l - 5, pad.t + 10);

        sigCtx.textAlign = 'center';
        sigCtx.fillText('z = w·x + b', pad.l + pw / 2, SIG_H - 2);

        // Sigmoid curve
        sigCtx.strokeStyle = c.sigColor;
        sigCtx.lineWidth = 2.5;
        sigCtx.beginPath();
        for (let i = 0; i <= pw; i++) {
            const z = zMin + (i / pw) * (zMax - zMin);
            const sv = sigmoid(z);
            const x = pad.l + i;
            const y = pad.t + ph - sv * ph;
            if (i === 0) sigCtx.moveTo(x, y);
            else sigCtx.lineTo(x, y);
        }
        sigCtx.stroke();

        // Mark the selected sample, preserving the true probability when z is off scale.
        const point=points[selectedPoint];
        if(point){
            const z=scoreAt(point.x,point.y),prob=predict(point.x,point.y);
            const x=pad.l+(clamp(z,zMin,zMax)-zMin)/(zMax-zMin)*pw,y=pad.t+ph*(1-prob);
            sigCtx.strokeStyle=c.sigMarker;sigCtx.lineWidth=1.5;sigCtx.setLineDash([3,3]);
            sigCtx.beginPath();sigCtx.moveTo(x,pad.t+ph);sigCtx.lineTo(x,y);sigCtx.lineTo(pad.l,y);sigCtx.stroke();sigCtx.setLineDash([]);
            sigCtx.fillStyle=c.sigMarker;sigCtx.beginPath();sigCtx.arc(x,y,5,0,Math.PI*2);sigCtx.fill();
            sigCtx.fillStyle=c.boundary;sigCtx.textAlign='left';sigCtx.fillText(`Point ${selectedPoint+1}: z = ${number(z)} → p = ${number(prob)}`,pad.l,12);
        }

    }

    // ============================================
    // Loss curve
    // ============================================
    function renderLossCurve() {
        if (!lossCurveCanvas || lossHistory.length < 2) return;
        const c = getColors();
        const CU = window.VizLib.CanvasUtils;
        const W = 300, H = 160;
        const pad = { l: 40, r: 10, t: 10, b: 25 };

        CU.resetCanvasTransform(lossCurveCtx, lossCurveDpr);
        CU.clearCanvas(lossCurveCtx, W, H, c.bg);

        const maxLoss = Math.max(...lossHistory) * 1.1;
        const pw = W - pad.l - pad.r;
        const ph = H - pad.t - pad.b;

        lossCurveCtx.strokeStyle = c.border;
        lossCurveCtx.lineWidth = 1;
        lossCurveCtx.beginPath();
        lossCurveCtx.moveTo(pad.l, pad.t);
        lossCurveCtx.lineTo(pad.l, pad.t + ph);
        lossCurveCtx.lineTo(pad.l + pw, pad.t + ph);
        lossCurveCtx.stroke();

        lossCurveCtx.fillStyle = c.muted;
        lossCurveCtx.font = '9px sans-serif';
        lossCurveCtx.textAlign = 'center';
        lossCurveCtx.fillText('Iteration', pad.l + pw / 2, H - 2);

        lossCurveCtx.strokeStyle = c.sigColor;
        lossCurveCtx.lineWidth = 2;
        lossCurveCtx.beginPath();
        for (let i = 0; i < lossHistory.length; i++) {
            const x = pad.l + (i / (lossHistory.length - 1)) * pw;
            const y = pad.t + ph - (lossHistory[i] / maxLoss) * ph;
            if (i === 0) lossCurveCtx.moveTo(x, y);
            else lossCurveCtx.lineTo(x, y);
        }
        lossCurveCtx.stroke();
    }

    // ============================================
    // Metrics
    // ============================================
    function updateMetrics() {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('metric-points', points.length);
        set('metric-iteration', iteration > 0 ? iteration : '-');
        set('metric-loss', trainedState ? computeLoss().toFixed(4) : '-');
        set('metric-accuracy', trainedState ? (computeAccuracy() * 100).toFixed(1) + '%' : '-');
        set('metric-weights', trainedState ? `[${weights[0].toFixed(3)}, ${weights[1].toFixed(3)}]` : '-');
        set('metric-bias', trainedState ? bias.toFixed(4) : '-');
    }

    function setStatus(msg) {
        const el = document.getElementById('metric-status'); if (el) el.textContent = msg;
        const ps = document.getElementById('playback-step'); if (ps) ps.textContent = msg;
    }

    // ============================================
    // Actions
    // ============================================
    function doTrain() {
        if (points.length < 2) { setStatus('Need at least 2 points'); return; }
        if(trainTimer){stopTrain();setStatus('Paused');return;}
        trainedState = true;
        document.getElementById('btn-train').textContent='Pause';

        document.getElementById('loss-curve-panel').style.display = '';
        if(!lossHistory.length)lossHistory.push(computeLoss());
        setStatus('Training...');

        const maxIter = parseInt(document.getElementById('iter-value').value);

        function step() {
            if (iteration >= maxIter) {
                stopTrain();setStatus(`Done: ${iteration} iterations`);
                updateMetrics(); redrawGeometry(); renderLossCurve();
                return;
            }

            gradientStep(parseFloat(document.getElementById('lr-slider').value));
            iteration++;
            lossHistory.push(computeLoss());

            updateMetrics(); redrawGeometry(); renderLossCurve();

            trainTimer = setTimeout(step, Math.max(5,1050-Number(document.getElementById('speed-slider').value)*100));
        }
        step();
    }

    function doStep() {
        if (points.length < 2) return;
        stopTrain();
        document.getElementById('loss-curve-panel').style.display = '';
        if(!lossHistory.length)lossHistory.push(computeLoss());
        const lr = parseFloat(document.getElementById('lr-slider').value);
        gradientStep(lr);
        iteration++;
        lossHistory.push(computeLoss());
        setStatus(`Step ${iteration}`);
        updateMetrics(); redrawGeometry(); renderLossCurve();
    }

    function stopTrain() {
        if (trainTimer) { clearTimeout(trainTimer); trainTimer = null; }
        const button=document.getElementById('btn-train');if(button)button.innerHTML='<i class="fa fa-play"></i> Train';
    }

    function doReset() {
        stopTrain();
        weights = [...startingWeights]; bias = startingBias; trainedState = true;
        iteration = 0; lossHistory = []; lastUpdate=null;
        document.getElementById('loss-curve-panel').style.display = 'none';
        setStatus('Ready');
        updatePointSelector();updateMetrics(); redrawGeometry();
    }

    // ============================================
    // Event handlers
    // ============================================
    function onCanvasClick(e) {
        const rect = canvas.getBoundingClientRect();
        const cx=(e.clientX-rect.left)*CANVAS_W/rect.width,cy=(e.clientY-rect.top)*CANVAS_H/rect.height;
        const d = c2d(cx, cy);
        if (d.x < 0 || d.x > 1 || d.y < 0 || d.y > 1) return;

        if (editMode === 'add') {
            if(points.length>=200){setStatus('Limit: 200 points');return;}
            points.push({ x: d.x, y: d.y, classLabel: selectedClass });
        } else {
            let closest = -1, minDist = 20;
            for (let i = 0; i < points.length; i++) {
                const cp = d2c(points[i].x, points[i].y);
                const dist = Math.hypot(cp.x-cx, cp.y-cy);
                if (dist < minDist) { minDist = dist; closest = i; }
            }
            if (closest >= 0) points.splice(closest, 1);
        }
        document.getElementById('dataset-select').value='custom';doReset();
    }

    function init() {
        canvas = document.getElementById('logistic-canvas');
        sigCanvas = document.getElementById('sigmoid-canvas');
        lossCurveCanvas = document.getElementById('loss-curve-canvas');
        const setup=(target,w,h)=>{const ratio=window.devicePixelRatio||1;target.width=w*ratio;target.height=h*ratio;return {ctx:target.getContext('2d'),dpr:ratio};};
        ({ctx,dpr}=setup(canvas,CANVAS_W,CANVAS_H));
        ({ctx:sigCtx,dpr:sigDpr}=setup(sigCanvas,SIG_W,SIG_H));
        ({ctx:lossCurveCtx,dpr:lossCurveDpr}=setup(lossCurveCanvas,300,160));

        setupGeometry();

        // Edit mode
        document.querySelectorAll('.edit-mode-buttons .btn').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.edit-mode-buttons .btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                editMode = this.dataset.mode;
                canvas.style.cursor = editMode === 'delete' ? 'pointer' : 'crosshair';
            });
        });

        // Class selector
        document.querySelectorAll('#class-selector .btn').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('#class-selector .btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                selectedClass = parseInt(this.dataset.class);
            });
        });

        document.getElementById('btn-clear-points').addEventListener('click', () => { points = []; doReset(); });

        document.getElementById('dataset-select').addEventListener('change', function() {
            stopTrain();if (this.value !== 'custom') { generateDataset(this.value); }selectedPoint=0;doReset();
        });

        document.getElementById('lr-slider').addEventListener('input', function() {
            document.getElementById('lr-value').textContent = parseFloat(this.value).toFixed(2);
        });

        document.getElementById('iter-minus').addEventListener('click', () => {
            const el = document.getElementById('iter-value');
            el.value = Math.max(10, parseInt(el.value) - 50);
        });
        document.getElementById('iter-plus').addEventListener('click', () => {
            const el = document.getElementById('iter-value');
            el.value = Math.min(5000, parseInt(el.value) + 50);
        });

        document.getElementById('show-probability').addEventListener('change', function() { showProbability = this.checked; render(); });
        document.getElementById('show-boundary').addEventListener('change', function() { showBoundaryLine = this.checked; render(); });

        document.getElementById('btn-train').addEventListener('click', doTrain);
        document.getElementById('btn-step').addEventListener('click', doStep);
        document.getElementById('btn-reset').addEventListener('click', doReset);

        // Info tabs
        document.querySelectorAll('.info-panel-tabs .btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const tabId = this.dataset.tab;
                document.querySelectorAll('.info-panel-tabs .btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                document.querySelectorAll('.info-tab-content').forEach(c => c.classList.remove('active'));
                const content = document.getElementById('tab-' + tabId);
                if (content) content.classList.add('active');
            });
        });

        document.addEventListener('themechange', () => { redrawGeometry(); renderLossCurve(); });

        generateDataset(document.getElementById('dataset-select').value);
        updatePointSelector();redrawGeometry();updateMetrics();setStatus('Ready');
    }

    // Geometry uses the same weights and selected point as the sigmoid and trainer.
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const scoreAt = (x, y) => weights[0] * x + weights[1] * y + bias;
    const number = value => Math.abs(value) > 0 && Math.abs(value) < .0005 ? value.toExponential(1) : value.toFixed(3);
    function projectGeometry(x, y, value, camera, extent, probability) {
        const a = (x - .5) * 1.7, b = (y - .5) * 1.7;
        const h = probability ? (value - .5) * 1.5 : value / extent * .85;
        const horizontal = a * Math.cos(camera.yaw) - b * Math.sin(camera.yaw);
        const depth = a * Math.sin(camera.yaw) + b * Math.cos(camera.yaw);
        return {x: CANVAS_W / 2 + camera.panX + horizontal * 180 * camera.zoom,
            y: CANVAS_H / 2 + camera.panY + (-depth * Math.sin(camera.pitch) - h * Math.cos(camera.pitch)) * 150 * camera.zoom,
            depth: depth * Math.cos(camera.pitch) - h * Math.sin(camera.pitch)};
    }
    function geometryLine(a, b, color, width = 1, dash = []) {
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
    }
    function geometryLabel(text, p, color) {
        ctx.fillStyle = color; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
        const width=ctx.measureText(text).width;
        const x=clamp(p.x+10,8,CANVAS_W-width-8);
        let y=clamp(p.y-12,42,CANVAS_H-12);
        for(let attempt=0;attempt<12;attempt++){
            if(!geometryLabels.some(r=>x<r.x+r.width+5&&x+width+5>r.x&&Math.abs(y-r.y)<16))break;
            y=42+((y-42+18)%(CANVAS_H-54));
        }
        geometryLabels.push({x,y,width});
        if(Math.abs(y-p.y)>24)geometryLine(p,{x:x-3,y:y-4},color,.8,[2,3]);
        ctx.save();ctx.globalAlpha=.88;ctx.fillStyle=getColors().bg;ctx.fillRect(x-2,y-11,width+4,14);ctx.restore();
        ctx.fillText(text,x,y);
    }
    function boundaryIntersections(w = weights, b = bias) {
        const hits = [];
        const add = (x, y) => {if (x >= 0 && x <= 1 && y >= 0 && y <= 1 && !hits.some(p => Math.hypot(p.x - x, p.y - y) < 1e-8)) hits.push({x, y});};
        if (Math.abs(w[1]) > 1e-10) {add(0, -b / w[1]); add(1, -(w[0] + b) / w[1]);}
        if (Math.abs(w[0]) > 1e-10) {add(-b / w[0], 0); add(-(w[1] + b) / w[0], 1);}
        return hits;
    }
    function renderSurface(c) {
        const probability = geometryView === 'probability';
        const extent = scoreExtent;
        geometryLabels=[];
        const value = (x, y) => probability ? predict(x,y) : scoreAt(x,y);
        const project = (x,y,z) => projectGeometry(x,y,z,camera,extent,probability);
        const floor = probability ? .5 : 0;
        ctx.save(); ctx.beginPath(); ctx.rect(0,0,CANVAS_W,CANVAS_H); ctx.clip();
        // Side-view class backdrop rotates with the projected input plane.
        if(camera.sideTint>0 && Math.abs(Math.sin(camera.pitch))>.001){
            const screenScore=p=>{
                const horizontal=(p.x-CANVAS_W/2-camera.panX)/(180*camera.zoom);
                const depth=-(p.y-CANVAS_H/2-camera.panY)/(150*camera.zoom*Math.sin(camera.pitch));
                return scoreAt(.5+(horizontal*Math.cos(camera.yaw)+depth*Math.sin(camera.yaw))/1.7,
                    .5+(-horizontal*Math.sin(camera.yaw)+depth*Math.cos(camera.yaw))/1.7);
            };
            const corners=[{x:0,y:0},{x:CANVAS_W,y:0},{x:CANVAS_W,y:CANVAS_H},{x:0,y:CANVAS_H}];
            for(const cls of [0,1]){
                const polygon=[],sign=cls?1:-1;
                corners.forEach((a,i)=>{
                    const b=corners[(i+1)%4],sa=screenScore(a)*sign,sb=screenScore(b)*sign;
                    if(cls?sa>=0:sa>0)polygon.push(a);
                    if((sa>=0)!==(sb>=0)){
                        const t=sa/(sa-sb);polygon.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)});
                    }
                });
                ctx.save();ctx.globalAlpha=.085*camera.sideTint;ctx.fillStyle=cls?c.class1:c.class0;
                ctx.beginPath();polygon.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
                ctx.closePath();ctx.fill();ctx.restore();
            }
        }
        // Cover the viewport even when zoomed out, panned, or nearly edge-on.
        const reach=(Math.hypot(CANVAS_W,CANVAS_H)+Math.hypot(camera.panX,camera.panY)) /
            (150*camera.zoom*Math.max(.02,Math.abs(Math.sin(camera.pitch))));
        const lo=.5-reach,hi=.5+reach;
        // Compensate gradually for foreshortening without snapping between grid sizes.
        const elevation=Math.max(Math.sin(Math.PI*5/180),Math.abs(Math.sin(camera.pitch)));
        const gridStep=.1/camera.zoom*Math.sqrt(Math.sin(.55)/elevation);
        ctx.save();ctx.globalAlpha=.55;
        for(let i=Math.ceil(lo/gridStep)*gridStep;i<=hi;i+=gridStep) {
            geometryLine(project(i,lo,floor),project(i,hi,floor),c.border);
            geometryLine(project(lo,i,floor),project(hi,i,floor),c.border);
        }
        ctx.restore();
        if (showProbability) {
            // Composite transparency once, so overlapping facets cannot form dark seams.
            surfaceCanvas ||= document.createElement('canvas');
            if(surfaceCanvas.width!==canvas.width || surfaceCanvas.height!==canvas.height){
                surfaceCanvas.width=canvas.width;surfaceCanvas.height=canvas.height;
            }
            const surface=surfaceCanvas.getContext('2d');
            surface.setTransform(dpr,0,0,dpr,0,0);
            surface.clearRect(0,0,CANVAS_W,CANVAS_H);
            const ramp=surface.createLinearGradient(0,0,256,0);
            ramp.addColorStop(0,c.class0);ramp.addColorStop(.5,c.bg);ramp.addColorStop(1,c.class1);
            surface.save();surface.setTransform(1,0,0,1,0,0);
            surface.fillStyle=ramp;surface.fillRect(0,0,256,1);
            const palette=surface.getImageData(0,0,256,1).data;
            surface.clearRect(0,0,surfaceCanvas.width,surfaceCanvas.height);surface.restore();
            const cells=[], n=720;
            // Extend along the sigmoid, but retain visible edges across its width.
            // An unbounded transverse direction fills the screen and hides the bend.
            const magnitude=Math.hypot(...weights);
            const direction=magnitude>1e-8?weights.map(w=>w/magnitude):[1,0];
            const transverse=[-direction[1],direction[0]],halfWidth=.7;
            const square=[[-reach,-halfWidth],[reach,-halfWidth],[reach,halfWidth],[-reach,halfWidth]].map(([along,across])=>({
                x:.5+direction[0]*along+transverse[0]*across,
                y:.5+direction[1]*along+transverse[1]*across
            }));
            const scores=square.map(p=>scoreAt(p.x,p.y));
            const low=Math.min(...scores),high=Math.max(...scores);
            const clipScore=(polygon,threshold,sign)=>{
                const result=[];
                polygon.forEach((a,i)=>{
                    const b=polygon[(i+1)%polygon.length];
                    const sa=(scoreAt(a.x,a.y)-threshold)*sign,sb=(scoreAt(b.x,b.y)-threshold)*sign;
                    if(sa>=0)result.push(a);
                    if((sa>=0)!==(sb>=0)){
                        const t=sa/(sa-sb);
                        result.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)});
                    }
                });
                return result;
            };
            // Concentrate samples near the sigmoid bend while extending its flat tails.
            const scoreSample=t=>Math.sinh(Math.asinh(low)+(Math.asinh(high)-Math.asinh(low))*t);
            // The sigmoid is constant along each strip, so there are no crosswise facets.
            for(let i=0;i<(high===low?1:n);i++){
                const start=i===0?low:scoreSample(i/n),end=i===n-1?high:scoreSample((i+1)/n);
                const polygon=high===low?square:clipScore(clipScore(square,start,1),end,-1);
                if(polygon.length<3)continue;
                const vertices=polygon.map(p=>project(p.x,p.y,value(p.x,p.y)));
                cells.push({vertices,prob:sigmoid((start+end)/2),depth:vertices.reduce((sum,v)=>sum+v.depth,0)/vertices.length});
            }
            cells.sort((a,b)=>b.depth-a.depth).forEach(cell=>{
                surface.beginPath();cell.vertices.forEach((v,i)=>i?surface.lineTo(v.x,v.y):surface.moveTo(v.x,v.y));surface.closePath();
                const offset=Math.round(cell.prob*255)*4;
                surface.fillStyle=`rgb(${palette[offset]},${palette[offset+1]},${palette[offset+2]})`;
                surface.fill();
                // Same-color overlap closes antialiasing gaps without drawing a wireframe.
                surface.strokeStyle=surface.fillStyle;surface.lineWidth=1.5;surface.stroke();
            });
            ctx.save();ctx.globalAlpha=.55;
            ctx.drawImage(surfaceCanvas,0,0,CANVAS_W,CANVAS_H);ctx.restore();
        }
        const weightLength=Math.hypot(...weights);
        if(showBoundaryLine&&weightLength>1e-8){
            const nx=weights[0]/weightLength,ny=weights[1]/weightLength;
            const offset=scoreAt(.5,.5)/weightLength;
            const x=.5-nx*offset,y=.5-ny*offset;
            geometryLine(project(x-ny*reach*2,y+nx*reach*2,floor),project(x+ny*reach*2,y-nx*reach*2,floor),c.boundary,2.5);
        }
        // Presets choose the back corner; manual rotation leaves the frame fixed in space.
        const axisX=axisCorner.x,axisY=axisCorner.y;
        geometryLine(project(lo,axisY,floor),project(hi,axisY,floor),c.muted,1.5);
        geometryLine(project(axisX,lo,floor),project(axisX,hi,floor),c.muted,1.5);
        for(const [end,name] of [[project(axisX?-.05:1.05,axisY,floor),'x₁'],[project(axisX,axisY?-.05:1.05,floor),'x₂']]) {
            geometryLabel(name,end,c.muted);
        }
        geometryLine(project(axisX,axisY,probability?0:-extent),project(axisX,axisY,probability?1:extent),c.muted,1.5);
        for(const z of probability?[1,.5,0]:[extent,0,-extent]) geometryLabel(`${probability?'p':'z'} = ${number(z)}`,project(axisX,axisY,z),c.muted);
        points.map((p,i)=>({p,i,q:project(p.x,p.y,value(p.x,p.y))})).sort((a,b)=>b.q.depth-a.q.depth).forEach(({p,i,q})=>{
            screenPoints.push({...q,index:i});
            if(i===selectedPoint){
                if(document.getElementById('show-construction').checked){
                    const ground=project(p.x,p.y,floor);
                    geometryLine(ground,q,c.sigMarker,2,[4,3]);
                    ctx.beginPath();ctx.arc(ground.x,ground.y,5,0,Math.PI*2);ctx.fillStyle=c.bg;ctx.fill();ctx.strokeStyle=c.sigMarker;ctx.lineWidth=2;ctx.stroke();
                    {
                        geometryLine(project(axisX,p.y,floor),ground,c.class0,1.5,[3,3]);
                        geometryLine(project(p.x,axisY,floor),ground,c.class1,1.5,[3,3]);
                        geometryLabel(`x₁ = ${number(p.x)}`,project(p.x,axisY,floor),c.class0);
                        geometryLabel(`x₂ = ${number(p.y)}`,project(axisX,p.y,floor),c.class1);
                    }
                    if(!probability){
                        const levels=[0,bias,bias+weights[0]*p.x,scoreAt(p.x,p.y)];
                        const names=[`w₀ = ${number(bias)}`,`w₁x₁ = ${number(weights[0]*p.x)}`,`w₂x₂ = ${number(weights[1]*p.y)}`];
                        levels.slice(1).forEach((z,j)=>{
                            const a=project(p.x,p.y,levels[j]),b=project(p.x,p.y,z),color=['#0f766e',c.class0,c.class1][j];
                            const offset=12*j,aa={x:a.x+offset,y:a.y},bb={x:b.x+offset,y:b.y};
                            geometryLine(a,aa,color,1,[2,3]);geometryLine(aa,bb,color,3);geometryLine(bb,b,color,1,[2,3]);
                            geometryLabel(names[j],{x:bb.x+8,y:(a.y+b.y)/2},color);
                        });
                    }
                }
                geometryLabel(`${probability?'p':'z'} = ${number(value(p.x,p.y))}`,q,c.boundary);
            }
            drawGeometryPoint(q,p,i,c);
        });
        if(!probability) {
            const positions=[[.8,0,scoreAt(.8,0)],[0,.8,scoreAt(0,.8)],[0,0,bias]];
            positions.forEach((a,i)=>{
                const p=project(...a),q=project(a[0],a[1],a[2]+(i===2?1:.8));
                const color=[c.class0,c.class1,'#0f766e'][i];
                geometryLine(project(0,0,i===2?0:bias),p,color,2.5);
                ctx.beginPath();ctx.arc(p.x,p.y,6,0,Math.PI*2);ctx.fillStyle=c.bg;ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.stroke();
                geometryLabel(['w₁','w₂','w₀'][i],p,color);
                weightHandles.push({i,p,dx:q.x-p.x,dy:q.y-p.y,extent});
            });
        }
        ctx.restore();
        ctx.fillStyle=c.bg;ctx.globalAlpha=.9;ctx.fillRect(0,0,CANVAS_W,26);ctx.globalAlpha=1;
        ctx.fillStyle=c.muted;ctx.font='12px sans-serif';ctx.textAlign='left';
        ctx.fillText(probability?'p = σ(z) · decision level p = 0.5':`z = w₀ + w₁x₁ + w₂x₂ · fixed scale ±${number(extent)}`,12,18);
    }
    function drawGeometryPoint(cp,p,i,c) {
        const correct=Number(predict(p.x,p.y)>=.5)===p.classLabel;
        ctx.beginPath();ctx.arc(cp.x,cp.y,i===selectedPoint?5.5:4,0,Math.PI*2);
        ctx.fillStyle=correct?(p.classLabel?c.class1:c.class0):c.bg;ctx.fill();
        ctx.strokeStyle=p.classLabel?c.class1:c.class0;ctx.lineWidth=1.8;ctx.stroke();
        if(i===selectedPoint){ctx.beginPath();ctx.arc(cp.x,cp.y,9,0,Math.PI*2);ctx.strokeStyle=c.sigMarker;ctx.stroke();}
    }
    function updateTeachingMath() {
        const host=document.getElementById('logreg-live-math');
        if(!host)return;
        const p=points[selectedPoint];
        if(!p)host.innerHTML='<p>Choose a dataset or add a point in 2D to work through a prediction.</p>';
        else {
            const z=scoreAt(p.x,p.y),prob=predict(p.x,p.y),error=prob-p.classLabel;
            const loss=Math.max(z,0)-p.classLabel*z+Math.log1p(Math.exp(-Math.abs(z)));
            const predicted=Number(prob>=.5);
            const stage=(title,formula,explanation)=>`<section class="logreg-math-stage"><h5>${title}</h5><div class="logreg-equation">${formula}</div><p>${explanation}</p></section>`;
            host.innerHTML=`<p class="logreg-point-badge">Point ${selectedPoint+1} · true class ${p.classLabel} · x = [${number(p.x)}, ${number(p.y)}]</p>`+
                stage('1. Combine the inputs',`z = w₀ + w₁x₁ + w₂x₂<br>= ${number(bias)} + (${number(weights[0])} × ${number(p.x)}) + (${number(weights[1])} × ${number(p.y)})<br><strong>= ${number(z)}</strong>`,'Weights set each input contribution; the bias shifts the score.')+
                stage('2. Turn score into probability',`p = 1 / (1 + e<sup>−z</sup>)<br><strong>p ≈ ${prob.toFixed(6)} · ${(prob*100).toFixed(2)}% for class 1</strong>`,`Predict class ${predicted}: ${predicted===p.classLabel?'correct':'incorrect'}. The threshold is 0.5; probability of class 0 is ${number(1-prob)}.`)+
                stage('3. Measure this prediction',`ℓ = −ln(${p.classLabel?'p':'1 − p'})<br><strong>ℓ = ${number(loss)}</strong>`,'Natural-log loss approaches zero for a confident correct prediction and grows for a confident wrong one. Displayed probabilities are rounded; loss uses the full score.')+
                stage('4. Contribute to the update',`p − y ≈ ${prob.toFixed(6)} − ${p.classLabel} ≈ ${number(error)}<br>∂ℓ/∂w₁ = (p − y)x₁ = ${number(error*p.x)}<br>∂ℓ/∂w₂ = (p − y)x₂ = ${number(error*p.y)}<br>∂ℓ/∂w₀ = p − y = ${number(error)}`,`This is one point out of ${points.length}. Training averages these contributions over every point before changing the weights.`);
        }
        const summary=document.getElementById('logreg-last-update');
        if(summary)summary.innerHTML=lastUpdate?`<p>Step ${iteration} · learning rate ${number(lastUpdate.lr)}</p><div class="logreg-table-wrap"><table class="table table-condensed"><thead><tr><th>Parameter</th><th>Before</th><th>Gradient</th><th>After</th></tr></thead><tbody>${['w₁','w₂','w₀'].map((name,i)=>`<tr><th>${name}</th><td>${number(lastUpdate.before[i])}</td><td>${number(lastUpdate.gradient[i])}</td><td>${number(lastUpdate.after[i])}</td></tr>`).join('')}</tbody></table></div><p class="note">After = before − learning rate × gradient. The Math tab shows predictions using the updated weights.</p>`:'Press Step to see how the weights change.';
    }
    function updateGeometryReadout() {
        updateTeachingMath();
        const p=points[selectedPoint], target=document.getElementById('geometry-readout');
        target.textContent=p?`x = [${number(p.x)}, ${number(p.y)}] · y = ${p.classLabel} · z = ${number(scoreAt(p.x,p.y))} → p = ${number(predict(p.x,p.y))}`:'Choose a dataset or add points in 2D.';
        ['geometry-w1','geometry-w2','geometry-bias'].forEach((id,i)=>{const input=document.getElementById(id);if(document.activeElement!==input)input.value=i===2?bias:weights[i];const slider=document.getElementById(id+'-slider');const value=i===2?bias:weights[i];slider.min=Math.min(-20,Math.floor(value));slider.max=Math.max(20,Math.ceil(value));slider.value=value;});
        document.getElementById('geometry-hint').textContent=geometryView==='2d'?'Select a point · Add/Delete modes edit data · Hollow points are misclassified':geometryView==='score'?'Drag colored handles to edit weights · Drag space to orbit · Shift-drag to pan · Scroll to zoom':'Drag to orbit · Shift-drag to pan · Scroll to zoom · Same boundary at p = 0.5';
    }
    function updatePointSelector() {
        selectedPoint=clamp(selectedPoint,0,Math.max(0,points.length-1));
        const select=document.getElementById('selected-point');
        select.innerHTML=points.map((p,i)=>`<option value="${i}">Point ${i+1} · class ${p.classLabel}</option>`).join('');
        select.value=String(selectedPoint);select.disabled=!points.length;
    }
    function redrawGeometry() {render();renderSigmoid();updateGeometryReadout();}
    function resetFromEditedWeights() {
        stopTrain();startingWeights=[...weights];startingBias=bias;iteration=0;lossHistory=[];lastUpdate=null;trainedState=true;
        document.getElementById('loss-curve-panel').style.display='none';
        setStatus('Weights edited');updateMetrics();redrawGeometry();
    }
    function interpolateCamera(from,target,progress) {
        const t=clamp(progress,0,1);
        if(t===1)return {...target};
        const ease=t*t*(3-2*t);
        const result=Object.fromEntries(Object.keys(target).map(key=>[key,from[key]+(target[key]-from[key])*ease]));
        const yawDelta=Math.atan2(Math.sin(target.yaw-from.yaw),Math.cos(target.yaw-from.yaw));
        result.yaw=from.yaw+yawDelta*ease;
        return result;
    }
    function setupGeometry() {
        let cameraFrame=null;
        const cancelCamera=()=>{
            if(cameraFrame!==null){
                cancelAnimationFrame(cameraFrame);cameraFrame=null;cameraPreset='free';
                document.querySelectorAll('[data-camera]').forEach(btn=>{btn.classList.remove('active');btn.setAttribute('aria-pressed','false');});
            }
        };
        document.getElementById('fit-geometry').addEventListener('click',()=>{
            cancelCamera();
            scoreExtent=Math.max(1,...[[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>Math.abs(scoreAt(x,y))))*1.15;
            camera.zoom=1;camera.panX=0;camera.panY=0;redrawGeometry();
        });
        document.getElementById('show-construction').addEventListener('change',redrawGeometry);
        document.getElementById('geometry-view').addEventListener('change',e=>{cancelCamera();geometryView=e.target.value;redrawGeometry();});
        const setCamera=name=>{
            cancelCamera();stopTrain();
            const from={...camera};
            const target={yaw:Math.hypot(...weights)>1e-8?-Math.atan2(weights[1],weights[0]):from.yaw,
                pitch:name==='top'?Math.PI*85/180:name==='side'?Math.PI*5/180:.55,zoom:from.zoom,panX:from.panX,panY:from.panY,sideTint:name==='side'?1:0};
            axisCorner={x:Math.sin(target.yaw)>0?1:0,y:Math.cos(target.yaw)>0?1:0};
            document.querySelectorAll('[data-camera]').forEach(btn=>{const on=btn.dataset.camera===name;btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',String(on));});
            if(window.matchMedia('(prefers-reduced-motion: reduce)').matches||geometryView==='2d'){
                camera=target;cameraPreset=name;redrawGeometry();return;
            }
            cameraPreset='transition';
            const began=performance.now();
            const tick=now=>{
                const t=clamp((now-began)/650,0,1);
                camera=interpolateCamera(from,target,t);
                if(t===1){cameraFrame=null;cameraPreset=name;}
                render();
                if(t<1)cameraFrame=requestAnimationFrame(tick);
            };
            cameraFrame=requestAnimationFrame(tick);
        };
        document.querySelectorAll('[data-camera]').forEach(btn=>btn.addEventListener('click',()=>setCamera(btn.dataset.camera)));
        document.getElementById('reset-camera').addEventListener('click',()=>{camera.zoom=1;camera.panX=0;camera.panY=0;setCamera('orbit');});
        document.getElementById('selected-point').addEventListener('change',e=>{selectedPoint=Number(e.target.value);redrawGeometry();});
        ['geometry-w1','geometry-w2','geometry-bias'].forEach((id,i)=>{
            const input=document.getElementById(id);
            const apply=e=>{
                const value=Number(input.value);
                if(!input.value||!Number.isFinite(value)||Math.abs(value)>100){
                    if(e.type==='change')input.value=i===2?bias:weights[i];
                    return;
                }
                if(value===(i===2?bias:weights[i]))return;
                cancelCamera();
                if(i===2)bias=value;else weights[i]=value;
                resetFromEditedWeights();
            };
            document.getElementById(id+'-slider').addEventListener('input',e=>{
                input.value=e.target.value;apply(e);
            });
            input.addEventListener('focus',stopTrain);
            input.addEventListener('input',apply);input.addEventListener('change',apply);
        });
        const position=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*CANVAS_W/r.width,y:(e.clientY-r.top)*CANVAS_H/r.height};};
        let drag=null;
        canvas.addEventListener('pointerdown',e=>{
            if(e.button!==0)return;
            cancelCamera();stopTrain();const p=position(e);
            const handle=weightHandles.find(h=>Math.hypot(h.p.x-p.x,h.p.y-p.y)<12);
            drag={p,startCamera:{...camera},weights:[...weights],bias,moved:false,handle,pan:e.shiftKey};
            canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointermove',e=>{
            if(!drag)return;
            const p=position(e),dx=p.x-drag.p.x,dy=p.y-drag.p.y;
            if(Math.hypot(dx,dy)<3&&!drag.moved)return;
            drag.moved=true;
            if(drag.handle) {
                const h=drag.handle,n=h.dx*h.dx+h.dy*h.dy;if(n<.01)return;
                const value=clamp((h.i===2?drag.bias:drag.weights[h.i])+(dx*h.dx+dy*h.dy)/n,-100,100);
                if(h.i===2)bias=value;else weights[h.i]=value;
                resetFromEditedWeights();
            } else if(geometryView!=='2d') {
                if(drag.pan){camera.panX=drag.startCamera.panX+dx;camera.panY=drag.startCamera.panY+dy;}
                else {
                    camera.yaw=drag.startCamera.yaw+dx*.008;
                    if(!['top','side'].includes(cameraPreset)){
                        cameraPreset='free';camera.pitch=clamp(drag.startCamera.pitch+dy*.008,-1.4,1.4);
                        document.querySelectorAll('[data-camera]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');});
                    }
                }
                render();
            }
        });
        const release=e=>{
            if(!drag)return;
            if(!drag.moved&&e.type==='pointerup') {
                const p=position(e);
                if(editMode==='inspect'||geometryView!=='2d') {
                    const hit=screenPoints.map(q=>({...q,distance:Math.hypot(q.x-p.x,q.y-p.y)})).sort((a,b)=>a.distance-b.distance)[0];
                    if(hit&&hit.distance<16){selectedPoint=hit.index;document.getElementById('selected-point').value=String(selectedPoint);redrawGeometry();}
                } else onCanvasClick(e);
            }
            drag=null;
        };
        canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);canvas.addEventListener('lostpointercapture',release);
        canvas.addEventListener('wheel',e=>{if(geometryView==='2d')return;e.preventDefault();cancelCamera();const unit=e.deltaMode===1?16:e.deltaMode===2?CANVAS_H:1;camera.zoom=clamp(camera.zoom*Math.exp(-e.deltaY*unit*.001),.4,3);render();},{passive:false});
    }

    if (window.VizLib?.CanvasUtils) init();
    else window.addEventListener('vizlib-ready', init, {once:true});
})();
