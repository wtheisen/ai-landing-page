/**
 * Perceptron Learning Visualizer
 *
 * Interactive visualization of the perceptron learning rule.
 * Shows step-by-step updates, decision boundary, and convergence behavior.
 */
(function() {
    'use strict';

    // ============================================
    // Constants
    // ============================================
    const CANVAS_WIDTH = 560;
    const CANVAS_HEIGHT = 380;
    const FEATURE_SCALE = 10;
    const PLOT = {x: 42, y: 26, width: 492, height: 308};


    const POINT_RADIUS = 3.5;
    const HIGHLIGHT_RADIUS = 8;
    const DEFAULT_NUM_POINTS = 20;

    const STEP_PHASES = ['activation', 'prediction', 'update', 'redraw'];

    // ============================================
    // Helpers (clamp assigned on load after VizLib is available)
    // ============================================
    let clamp;

    const toTarget = (label) => (label === 1 ? 1 : 0);
    const toLabel = (sign) => (sign === 1 ? 1 : 0);

    const formatNumber = (value, decimals = 2) => {
        if (Number.isNaN(value) || !Number.isFinite(value)) return '-';
        if(value!==0 && Math.abs(value)<0.5*10**(-decimals)) return value.toExponential(1);
        return value.toFixed(decimals);
    };

    // ============================================
    // Dataset State
    // ============================================
    class DatasetState {
        constructor() {
            this.points = [];
            this.currentType = 'linear';
        }

        loadDataset(type, numPoints = DEFAULT_NUM_POINTS) {
            this.currentType = type;
            this.points = [];

            switch (type) {
                case 'linear':
                    this._generateLinear(numPoints);
                    break;
                case 'moons':
                    this._generateMoons(numPoints);
                    break;
                case 'xor':
                    this._generateXOR(numPoints);
                    break;
                case 'blobs':
                    this._generateBlobs(numPoints);
                    break;
                default:
                    this._generateLinear(numPoints);
            }

            this.points.forEach(p=>{p.x*=FEATURE_SCALE;p.y*=FEATURE_SCALE;});
            return this.points;
        }

        _generateLinear(n, noise = 0.08) {
            const nPerClass = Math.floor(n / 2);
            for (let i = 0; i < nPerClass; i++) {
                const x0 = 0.1 + 0.8 * Math.random();
                const y0 = x0 + (Math.random() - 0.5) * noise;
                this.points.push({
                    x: clamp(x0 + (Math.random() - 0.5) * noise, 0.02, 0.98),
                    y: clamp(y0 + (Math.random() - 0.5) * noise, 0.02, 0.98),
                    classLabel: 1
                });
                const x1 = 0.48 + 0.42 * Math.random();
                const y1 = x1 - 0.4 + (Math.random() - 0.5) * noise;
                this.points.push({
                    x: clamp(x1 + (Math.random() - 0.5) * noise, 0.02, 0.98),
                    y: clamp(y1 + (Math.random() - 0.5) * noise, 0.02, 0.98),
                    classLabel: 0
                });
            }
        }

        _generateMoons(n, noise = 0.1) {
            const nPerClass = Math.floor(n / 2);
            for (let i = 0; i < nPerClass; i++) {
                const angle1 = Math.PI * i / nPerClass;
                const x1 = Math.cos(angle1) + this._noise(noise);
                const y1 = Math.sin(angle1) + this._noise(noise);
                this.points.push({
                    x: this._normalize(x1, -1.5, 2.5),
                    y: this._normalize(y1, -0.6, 1.6),
                    classLabel: 1
                });
                const x2 = 1 - Math.cos(angle1) + this._noise(noise);
                const y2 = 0.5 - Math.sin(angle1) + this._noise(noise);
                this.points.push({
                    x: this._normalize(x2, -1.5, 2.5),
                    y: this._normalize(y2, -0.6, 1.6),
                    classLabel: 0
                });
            }
        }

        _generateXOR(n, noise = 0.08) {
            const nPerQuadrant = Math.floor(n / 4);
            const centers = [
                { x: 0.25, y: 0.25, label: 0 },
                { x: 0.75, y: 0.75, label: 0 },
                { x: 0.25, y: 0.75, label: 1 },
                { x: 0.75, y: 0.25, label: 1 }
            ];

            centers.forEach(center => {
                for (let i = 0; i < nPerQuadrant; i++) {
                    this.points.push({
                        x: clamp(center.x + this._gaussian() * noise, 0.02, 0.98),
                        y: clamp(center.y + this._gaussian() * noise, 0.02, 0.98),
                        classLabel: center.label
                    });
                }
            });
        }

        _generateBlobs(n, noise = 0.08) {
            const centers = [
                { x: 0.3, y: 0.7, label: 0 },
                { x: 0.7, y: 0.3, label: 1 }
            ];
            const nPerBlob = Math.floor(n / centers.length);
            centers.forEach(center => {
                for (let i = 0; i < nPerBlob; i++) {
                    this.points.push({
                        x: clamp(center.x + this._gaussian() * noise, 0.02, 0.98),
                        y: clamp(center.y + this._gaussian() * noise, 0.02, 0.98),
                        classLabel: center.label
                    });
                }
            });
        }

        _gaussian() {
            let u = 0, v = 0;
            while (u === 0) u = Math.random();
            while (v === 0) v = Math.random();
            return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        }

        _noise(scale) {
            return (Math.random() - 0.5) * scale;
        }

        _normalize(value, min, max) {
            return (value - min) / (max - min);
        }
    }

    // ============================================
    // Perceptron Model
    // ============================================
    class PerceptronModel {
        constructor(learningRate = 0.005) {
            this.learningRate = learningRate;
            this.weights = [0, 0];
            this.bias = 0;
        }

        reset(initMode = 'zero') {
            if (initMode === 'random') {
                this.weights = [Math.random() * 2 - 1, Math.random() * 2 - 1];
                this.bias = -.5 * (this.weights[0] + this.weights[1]);
            } else {
                this.weights = [0, 0];
                this.bias = 0;
            }
        }

        activation(x, y) {
            return this.weights[0] * x + this.weights[1] * y + this.bias;
        }

        predict(x, y) {
            const act = this.activation(x, y);
            const sign = act >= 0 ? 1 : 0;
            return { activation: act, sign, label: toLabel(sign) };
        }

        applyUpdate(x, y, targetSign, predictedSign) {
            const error = targetSign - predictedSign;
            if (error === 0) {
                return { updated: false, delta: [0, 0], deltaBias: 0 };
            }
            const deltaW0 = this.learningRate * error * x;
            const deltaW1 = this.learningRate * error * y;
            const deltaB = this.learningRate * error;

            this.weights[0] += deltaW0;
            this.weights[1] += deltaW1;
            this.bias += deltaB;

            return { updated: true, delta: [deltaW0, deltaW1], deltaBias: deltaB };
        }
    }

    // ============================================
    // Trainer
    // ============================================
    class Trainer {
        constructor(dataset, model, options) {
            this.dataset = dataset;
            this.model = model;
            this.epochs = options.epochs ?? 50;
            this.shuffle = options.shuffle ?? true;
        }

        generateSteps() {
            const steps = [];
            let globalStep = 0;
            const points = [...this.dataset];

            for (let epoch = 1; epoch <= this.epochs; epoch++) {
                const samples = this.shuffle ? this._shuffled(points) : [...points];
                let mistakes = 0;

                for (let index = 0; index < samples.length; index++) {
                    const point = samples[index];
                    const before = {
                        weights: [...this.model.weights],
                        bias: this.model.bias
                    };
                    const beforeMistakes = this._computeMisclassifiedIndices(before.weights, before.bias, points);
                    const prediction = this.model.predict(point.x, point.y);
                    const targetSign = toTarget(point.classLabel);
                    const correct = prediction.sign === targetSign;

                    const activationStep = this._buildStep({
                        phase: 'activation',
                        epoch,
                        sampleIndex: index + 1,
                        totalSamples: samples.length,
                        globalStep: globalStep++,
                        point,
                        targetLabel: point.classLabel,
                        prediction,
                        correct,
                        mistakes,
                        weights: before.weights,
                        bias: before.bias
                    });

                    const predictionStep = this._buildStep({
                        phase: 'prediction',
                        epoch,
                        sampleIndex: index + 1,
                        totalSamples: samples.length,
                        globalStep: globalStep++,
                        point,
                        targetLabel: point.classLabel,
                        prediction,
                        correct,
                        mistakes,
                        weights: before.weights,
                        bias: before.bias
                    });

                    const updateResult = this.model.applyUpdate(point.x, point.y, targetSign, prediction.sign);
                    if (updateResult.updated) {
                        mistakes += 1;
                    }

                    const updateStep = this._buildStep({
                        phase: 'update',
                        epoch,
                        sampleIndex: index + 1,
                        totalSamples: samples.length,
                        globalStep: globalStep++,
                        point,
                        targetLabel: point.classLabel,
                        prediction,
                        correct,
                        mistakes,
                        weights: [...this.model.weights],
                        bias: this.model.bias,
                        updateResult
                    });

                    const accuracy = this._computeAccuracy(this.model.weights, this.model.bias, points);
                    const misclassifiedIndices = this._computeMisclassifiedIndices(this.model.weights, this.model.bias, points);
                    const redrawStep = this._buildStep({
                        phase: 'redraw',
                        epoch,
                        sampleIndex: index + 1,
                        totalSamples: samples.length,
                        globalStep: globalStep++,
                        point,
                        targetLabel: point.classLabel,
                        prediction,
                        correct,
                        mistakes,
                        weights: [...this.model.weights],
                        bias: this.model.bias,
                        accuracy,
                        misclassifiedIndices
                    });

                    // Match mistake markers to the weights displayed in each phase
                    activationStep.misclassifiedIndices = beforeMistakes;
                    predictionStep.misclassifiedIndices = beforeMistakes;
                    updateStep.misclassifiedIndices = misclassifiedIndices;
                    redrawStep.misclassifiedIndices = misclassifiedIndices;

                    [activationStep, predictionStep, updateStep, redrawStep].forEach(step => {
                        step.before = before;
                        step.after = { weights: [...this.model.weights], bias: this.model.bias };
                        step.update = updateResult;
                        step.accuracy = 1 - step.misclassifiedIndices.size / points.length;
                    });
                    steps.push(activationStep, predictionStep, updateStep, redrawStep);
                }

                // Early stopping: converged if no mistakes this epoch
                if (mistakes === 0) break;
            }

            return steps;
        }

        _buildStep(payload) {
            const phaseIndex = STEP_PHASES.indexOf(payload.phase) + 1;
            return {
                phase: payload.phase,
                phaseIndex,
                epoch: payload.epoch,
                sampleIndex: payload.sampleIndex,
                totalSamples: payload.totalSamples,
                globalStep: payload.globalStep,
                point: payload.point,
                targetLabel: payload.targetLabel,
                prediction: payload.prediction,
                correct: payload.correct,
                mistakes: payload.mistakes,
                weights: payload.weights,
                bias: payload.bias,
                updateResult: payload.updateResult ?? null,
                accuracy: payload.accuracy ?? null,
                misclassifiedIndices: payload.misclassifiedIndices ?? null
            };
        }

        _computeMisclassifiedIndices(weights, bias, points) {
            const set = new Set();
            points.forEach((point, idx) => {
                const activation = weights[0] * point.x + weights[1] * point.y + bias;
                const sign = activation >= 0 ? 1 : 0;
                if (toLabel(sign) !== point.classLabel) {
                    set.add(idx);
                }
            });
            return set;
        }

        _computeAccuracy(weights, bias, points) {
            let correct = 0;
            points.forEach(point => {
                const activation = weights[0] * point.x + weights[1] * point.y + bias;
                const sign = activation >= 0 ? 1 : 0;
                const label = toLabel(sign);
                if (label === point.classLabel) {
                    correct += 1;
                }
            });
            return correct / points.length;
        }

        _shuffled(points) {
            const array = [...points];
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        }
    }

    // ============================================
    // UI Renderer
    // ============================================
    class UIRenderer {
        constructor() {
            this.canvas = document.getElementById('perceptron-canvas');
            this.ctx = this.canvas?.getContext('2d');
            this.displayScale = 1;
            this.classColors = ['#e41a1c', '#377eb8'];
            this._updateColors();
            this._setupHiDPI();
        }

        _setupHiDPI() {
            if (!this.canvas || !this.ctx) return;

            const wrapper = this.canvas.parentElement;
            const displayWidth = wrapper.clientWidth;
            const displayHeight = Math.round(displayWidth * (CANVAS_HEIGHT / CANVAS_WIDTH));
            const dpr = window.devicePixelRatio || 1;
            const scale = displayWidth / CANVAS_WIDTH;

            this.canvas.width = displayWidth * dpr;
            this.canvas.height = displayHeight * dpr;
            this.canvas.style.width = displayWidth + 'px';
            this.canvas.style.height = displayHeight + 'px';

            this.ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
            this.displayScale = scale;
        }

        _updateColors() {
            if (window.VizLib?.ThemeManager) {
                const colors = window.VizLib.ThemeManager.getColors('categorical');
                this.classColors = [colors[0], colors[1]];
            }
            const style = getComputedStyle(document.documentElement);
            this.boundaryColor = style.getPropertyValue('--perceptron-boundary').trim() || '#111827';
            this.vectorColor = style.getPropertyValue('--perceptron-vector').trim() || '#0f766e';
            this.marginColor = style.getPropertyValue('--perceptron-margin').trim() || 'rgba(17,24,39,0.25)';
            this.misclassifiedColor = style.getPropertyValue('--perceptron-misclassified').trim() || '#f59e0b';
            this.highlightColor = style.getPropertyValue('--perceptron-highlight').trim() || '#facc15';
            this.gridColor = style.getPropertyValue('--viz-border').trim() || '#dee2e6';
            this.textColor = style.getPropertyValue('--viz-text').trim() || '#333333';
        }

        _resetTransform() {
            if (!this.ctx) return;
            const dpr = window.devicePixelRatio || 1;
            this.ctx.setTransform(this.displayScale * dpr, 0, 0, this.displayScale * dpr, 0, 0);
        }

        dataToCanvas(x, y) {
            return {
                x: PLOT.x + x / FEATURE_SCALE * PLOT.width,
                y: PLOT.y + (1 - y / FEATURE_SCALE) * PLOT.height
            };
        }

        render(state) {
            if (!this.ctx) return;
            this._updateColors();
            this._resetTransform();

            this.ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

            if(this.projectionView){this._renderProjection(state);return;}
            if(this.view3d){this._render3D(state);return;}
            this.ctx.save();
            this.ctx.beginPath(); this.ctx.rect(PLOT.x,PLOT.y,PLOT.width,PLOT.height); this.ctx.clip();
            if (state.showBoundary) {
                this._drawRegions(state.weights, state.bias);
            }
            this._drawGrid();
            if (state.previous) {
                this.ctx.save(); this.ctx.globalAlpha = .3; this.ctx.setLineDash([5, 5]);
                this._drawBoundary(state.previous.weights, state.previous.bias); this.ctx.restore();
            }

            if (state.showBoundary) {
                this._drawBoundary(state.weights, state.bias);
            }
            if (state.showMargin) {
                this._drawMargin(state.weights, state.bias);
            }
            if (state.showVector) {
                this._drawWeightVector(state.weights, state.bias);
            }

            this._drawPoints(state.points, state.misclassifiedSet);
            if (state.showBoundary) this._drawHandles(state.weights, state.bias);

            if (state.currentPoint) this._drawHighlight(state.currentPoint);
            this.ctx.restore();
            this._drawAxes();
            if(state.currentPoint) {
                const p=state.currentPoint;
                this.ctx.font='11px monospace';this.ctx.fillStyle=this.textColor;this.ctx.textAlign='left';
                this.ctx.fillText(`Selected: x₁ ${p.x.toFixed(2)} · x₂ ${p.y.toFixed(2)} · class ${p.classLabel}`,PLOT.x,15);
            }
        }

        _drawGrid() {
            const ctx=this.ctx;ctx.save();ctx.strokeStyle=this.gridColor;ctx.globalAlpha=.45;ctx.lineWidth=.6;
            for(let i=0;i<=4;i++) {
                const x=PLOT.x+PLOT.width*i/4,y=PLOT.y+PLOT.height*i/4;
                ctx.beginPath();ctx.moveTo(x,PLOT.y);ctx.lineTo(x,PLOT.y+PLOT.height);ctx.stroke();
                ctx.beginPath();ctx.moveTo(PLOT.x,y);ctx.lineTo(PLOT.x+PLOT.width,y);ctx.stroke();
            }
            ctx.restore();
        }

        _drawAxes() {
            const ctx=this.ctx;ctx.save();ctx.font='10px sans-serif';ctx.fillStyle=this.textColor;
            for(let i=0;i<=4;i++) {
                ctx.textAlign='center';ctx.fillText((FEATURE_SCALE*i/4).toFixed(2),PLOT.x+PLOT.width*i/4,PLOT.y+PLOT.height+17);
                ctx.textAlign='right';ctx.fillText((FEATURE_SCALE*i/4).toFixed(2),PLOT.x-8,PLOT.y+PLOT.height*(1-i/4)+3);
            }
            ctx.textAlign='center';ctx.fillText('Feature x₁',PLOT.x+PLOT.width/2,CANVAS_HEIGHT-6);
            ctx.translate(11,PLOT.y+PLOT.height/2);ctx.rotate(-Math.PI/2);ctx.fillText('Feature x₂',0,0);ctx.restore();
        }

        _drawPoints(points, misclassifiedSet) {
            const ctx = this.ctx;
            points.forEach((point, idx) => {
                const pos = this.dataToCanvas(point.x, point.y);
                const isMisclassified = misclassifiedSet?.has(idx);
                ctx.beginPath();
                ctx.fillStyle = this.classColors[point.classLabel];
                ctx.strokeStyle = this.classColors[point.classLabel];
                ctx.globalAlpha = isMisclassified ? .85 : .8;
                ctx.arc(pos.x, pos.y, POINT_RADIUS, 0, Math.PI * 2);
                if(isMisclassified){ctx.lineWidth=1.2;ctx.stroke();}else ctx.fill();
                ctx.globalAlpha=1;
            });
        }

        _drawHighlight(point) {
            const ctx = this.ctx;
            const pos = this.dataToCanvas(point.x, point.y);
            ctx.beginPath();
            ctx.fillStyle = this.classColors[point.classLabel];
            ctx.globalAlpha = 0.18;
            ctx.arc(pos.x, pos.y, HIGHLIGHT_RADIUS, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = this.classColors[point.classLabel];
            ctx.lineWidth = 2;
            ctx.stroke();

        }

        _renderProjection(state) {
            const ctx=this.ctx,[wx,wy]=state.weights,magnitude=Math.hypot(wx,wy);
            if(magnitude<1e-10){ctx.fillStyle=this.textColor;ctx.font='13px sans-serif';ctx.fillText('Set nonzero w₁ or w₂ to define a projection direction.',25,60);return;}
            const nx=wx/magnitude,ny=wy/magnitude,cutoff=-state.bias/magnitude;
            const projections=state.points.map(p=>p.x*nx+p.y*ny);
            const scorePositions=projections.map(t=>t+state.bias/magnitude);
            const all=[{x:0,y:0},{x:10,y:10},...projections.concat(scorePositions).map(t=>({x:nx*t,y:ny*t})),{x:nx*cutoff,y:ny*cutoff}];
            const minX=Math.min(...all.map(p=>p.x))-1,maxX=Math.max(...all.map(p=>p.x))+1,minY=Math.min(...all.map(p=>p.y))-1,maxY=Math.max(...all.map(p=>p.y))+1;
            const scale=Math.min(470/(maxX-minX),235/(maxY-minY));
            const project=(x,y)=>({x:280+(x-(minX+maxX)/2)*scale,y:192-(y-(minY+maxY)/2)*scale});
            this.projectionToCanvas=project;
            const line=(a,b,color,width=1)=>{ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();};
            ctx.save();ctx.beginPath();ctx.rect(15,55,CANVAS_WIDTH-30,265);ctx.clip();
            ctx.globalAlpha=.35;
            for(let i=0;i<=10;i+=2){line(project(i,0),project(i,10),this.gridColor);line(project(0,i),project(10,i),this.gridColor);}ctx.globalAlpha=1;
            line(project(0,0),project(10,0),this.textColor);line(project(0,0),project(0,10),this.textColor);
            const low=Math.min(0,cutoff,...projections,...scorePositions)-1,high=Math.max(0,cutoff,...projections,...scorePositions)+1;
            const start=project(nx*low,ny*low),end=project(nx*high,ny*high);
            line(start,end,this.vectorColor,2);
            const angle=Math.atan2(end.y-start.y,end.x-start.x);for(const a of [-.4,.4])line(end,{x:end.x-9*Math.cos(angle+a),y:end.y-9*Math.sin(angle+a)},this.vectorColor,2);
            const center={x:nx*cutoff,y:ny*cutoff};
            line(project(center.x-ny*30,center.y+nx*30),project(center.x+ny*30,center.y-nx*30),this.boundaryColor,2);
            state.points.forEach((p,i)=>{const a=project(p.x,p.y),b=project(nx*projections[i],ny*projections[i]),selected=p===state.currentPoint;
                if(selected){ctx.setLineDash([3,3]);line(a,b,this.classColors[p.classLabel],2);ctx.setLineDash([]);}
                ctx.beginPath();ctx.arc(a.x,a.y,selected?5:3.5,0,Math.PI*2);ctx.fillStyle=this.classColors[p.classLabel];ctx.fill();
                if(selected){ctx.beginPath();ctx.arc(b.x,b.y,5,0,Math.PI*2);ctx.strokeStyle=this.classColors[p.classLabel];ctx.lineWidth=2;ctx.stroke();}
            });ctx.restore();
            const background=getComputedStyle(document.documentElement).getPropertyValue('--viz-canvas-bg').trim();
            const label=(text,p,color)=>{ctx.font='11px sans-serif';const width=ctx.measureText(text).width,x=Math.max(10,Math.min(CANVAS_WIDTH-width-10,p.x)),y=Math.max(65,Math.min(315,p.y));ctx.fillStyle=background;ctx.fillRect(x-3,y-12,width+6,17);ctx.fillStyle=color;ctx.fillText(text,x,y);};
            ctx.textAlign='left';
            const mark=project(center.x,center.y);ctx.fillStyle=this.boundaryColor;ctx.fillRect(mark.x-4,mark.y-4,8,8);
            label('boundary',{x:mark.x+10,y:mark.y+20},this.boundaryColor);
            // Screen-space unit directions preserve the right angle under the isotropic projection.
            const u={x:nx,y:-ny},v={x:-ny,y:-nx},r=12;
            const cornerA={x:mark.x+u.x*r,y:mark.y+u.y*r};
            const cornerB={x:cornerA.x+v.x*r,y:cornerA.y+v.y*r};
            line(cornerA,cornerB,this.vectorColor,1.5);
            line(cornerB,{x:mark.x+v.x*r,y:mark.y+v.y*r},this.vectorColor,1.5);
            const origin=project(0,0);
            ctx.beginPath();ctx.arc(origin.x,origin.y,3,0,Math.PI*2);ctx.fillStyle=this.vectorColor;ctx.fill();
            label('0',{x:origin.x+8,y:origin.y+17},this.vectorColor);
            const zLow=magnitude*low,zHigh=magnitude*high;
            const raw=(zHigh-zLow)/5,power=10**Math.floor(Math.log10(raw)),step=[1,2,5,10].map(v=>v*power).find(v=>v>=raw);
            for(let z=Math.ceil(zLow/step)*step;z<=zHigh;z+=step){
                if(Math.abs(z)<step*.001)continue;
                const t=z/magnitude,q=project(nx*t,ny*t);
                line({x:q.x-ny*4,y:q.y-nx*4},{x:q.x+ny*4,y:q.y+nx*4},this.vectorColor);

            }
            // Resolve the projection displacement into horizontal and vertical changes.
            if(state.currentPoint){
                const p=state.currentPoint,t=p.x*nx+p.y*ny;
                const stops=[
                    {x:p.x,y:p.y},
                    {x:nx*t,y:p.y},
                    {x:nx*t,y:ny*t},
                    {x:nx*(t+state.bias/magnitude),y:ny*(t+state.bias/magnitude)}
                ];
                const colors=['#c45145','#397fba','#9563c6'];
                stops.slice(0,3).forEach((point,i)=>{
                    const a=project(point.x,point.y),b=project(stops[i+1].x,stops[i+1].y);
                    line(a,b,colors[i],3);
                    const length=Math.hypot(b.x-a.x,b.y-a.y);
                    if(length>1){
                        const ux=(b.x-a.x)/length,uy=(b.y-a.y)/length,h=Math.min(7,length*.4);
                        ctx.beginPath();ctx.moveTo(b.x,b.y);
                        ctx.lineTo(b.x-ux*h-uy*h*.5,b.y-uy*h+ux*h*.5);
                        ctx.lineTo(b.x-ux*h+uy*h*.5,b.y-uy*h-ux*h*.5);
                        ctx.closePath();ctx.fillStyle=colors[i];ctx.fill();
                    }
                    if(i===2)label('w₀',{x:(a.x+b.x)/2-ny*15,y:(a.y+b.y)/2-nx*15},colors[i]);
                });
            }
            label('x₁',project(10.5,0),this.textColor);label('x₂',project(0,10.5),this.textColor);
            const p=state.currentPoint;if(p){const t=p.x*nx+p.y*ny,z=magnitude*t+state.bias;const q=project(nx*z/magnitude,ny*z/magnitude);ctx.beginPath();ctx.arc(q.x,q.y,4,0,Math.PI*2);ctx.fillStyle=this.classColors[p.classLabel];ctx.fill();label(`z = ${formatNumber(z)}`,{x:q.x+12,y:q.y-24},this.classColors[p.classLabel]);}
        }

        _renderSharedScore(state) {
            const ctx=this.ctx,[wx,wy]=state.weights,bias=state.bias,score=(x,y)=>bias+wx*x+wy*y;
            const extent=this.weightDragExtent??Math.max(2,...[[0,0],[10,0],[10,10],[0,10]].map(([x,y])=>Math.max(Math.abs(score(x,y)),Math.abs(wx*x),Math.abs(wx*x+wy*y))));
            const camera=this.camera3d||(this.camera3d={yaw:-.45,pitch:.5,zoom:1,panX:0,panY:0});
            // Perspective camera: zoom dollies through the scene rather than scaling a tile.
            const distance=12+35/camera.zoom;
            // Frame the observed scores, rather than the far corners of the score plane.
            const scoreRange=Math.max(.01,...state.points.map(p=>Math.abs(score(p.x,p.y))));
            const sideExtent=scoreRange*1034*3.5/((12+35/2.5)*115);
            const displayedExtent=extent+(sideExtent-extent)*(camera.sideBlend||0);
            const project=(x,y,z=0)=>{
                const a=x-(camera.targetX??5),b=y-(camera.targetY??5),c=z/displayedExtent*3.5;
                const horizontal=a*Math.cos(camera.yaw)-b*Math.sin(camera.yaw);
                const depth=a*Math.sin(camera.yaw)+b*Math.cos(camera.yaw);
                const vertical=depth*Math.sin(camera.pitch)+c*Math.cos(camera.pitch);
                const cameraDepth=distance+depth*Math.cos(camera.pitch)-c*Math.sin(camera.pitch);
                const perspective=1034/Math.max(2,this.cameraPreset==='top'?distance:cameraDepth);
                const px=horizontal*perspective,py=-vertical*perspective,roll=camera.roll||0;
                return {x:280+camera.panX+px*Math.cos(roll)-py*Math.sin(roll),y:CANVAS_HEIGHT/2+camera.panY+px*Math.sin(roll)+py*Math.cos(roll),depth:cameraDepth};
            };
            this.project3d=project;
            const line=(a,b,color,width=1,dash=[],arrow=false)=>{let p=project(...a),q=project(...b);
                const near=2;
                if(p.depth<near&&q.depth<near)return;
                if(p.depth<near||q.depth<near){
                    const t=(near-p.depth)/(q.depth-p.depth),cut=a.map((n,i)=>n+t*(b[i]-n));
                    if(p.depth<near)p=project(...cut);else q=project(...cut);
                }
                const d=Math.hypot(q.x-p.x,q.y-p.y);if(d<.01)return;const ux=(q.x-p.x)/d,uy=(q.y-p.y)/d,h=arrow?Math.min(6,d*.3):0;ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x-ux*h*.8,q.y-uy*h*.8);ctx.stroke();if(h){ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-ux*h-uy*h*.4,q.y-uy*h+ux*h*.4);ctx.lineTo(q.x-ux*h+uy*h*.4,q.y-uy*h-ux*h*.4);ctx.closePath();ctx.fill()}ctx.restore();};
            const label=(a,text,dx=5,dy=-6)=>{const p=project(...a);ctx.fillStyle=this.textColor;ctx.font='11px sans-serif';ctx.fillText(text,p.x+dx,p.y+dy);};
            const dot=(a,color,r=4)=>{const p=project(...a);ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();};
            // Reveal a larger domain as the camera pulls back, without rescaling scores.
            const radius=distance*20+Math.hypot(camera.panX,camera.panY),lo=5-radius,hi=5+radius;
            // Extend the surface forward from the bias corner along both feature directions.
            const handleInset=8;
            const planeReach=radius*2;
            const corners=[[0,0],[planeReach,0],[planeReach,planeReach],[0,planeReach]];
            const gridRaw=distance/35,gridPower=10**Math.floor(Math.log10(gridRaw));
            const gridStep=[1,2,5,10].map(n=>n*gridPower).find(n=>n>=gridRaw);
            ctx.save();ctx.beginPath();ctx.rect(0,0,CANVAS_WIDTH,CANVAS_HEIGHT);ctx.clip();
            // Classify the input plane by the sign of the score.
            const clipPolygon=(polygon,value)=>{
                const result=[];
                polygon.forEach((a,i)=>{
                    const b=polygon[(i+1)%polygon.length],va=value(a),vb=value(b);
                    if(va>=0)result.push(a);
                    if((va>=0)!==(vb>=0)){const t=va/(va-vb);result.push(a.map((n,k)=>n+t*(b[k]-n)));}
                });
                return result;
            };
            for(const predicted of [0,1]){
                let region=[[lo,lo,0],[hi,lo,0],[hi,hi,0],[lo,hi,0]];
                region=clipPolygon(region,p=>(predicted===1?1:-1)*score(p[0],p[1]));
                region=clipPolygon(region,p=>project(...p).depth-2);
                ctx.save();ctx.globalAlpha=.09;ctx.fillStyle=this.classColors[predicted];ctx.beginPath();
                region.forEach((p,i)=>{const q=project(...p);if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});
                ctx.closePath();ctx.fill();ctx.restore();
            }
            for(let i=Math.ceil(lo/gridStep)*gridStep;i<=hi;i+=gridStep){line([i,lo,0],[i,hi,0],this.gridColor);line([lo,i,0],[hi,i,0],this.gridColor);}
            if(state.showBoundary){ctx.save();ctx.globalAlpha=this.cameraPreset==='top'?0:.12*(1-(camera.sideBlend||0));ctx.fillStyle=this.vectorColor;ctx.beginPath();
                const surface=corners.map(([x,y])=>[x,y,score(x,y)]),clipped=[];
                surface.forEach((a,i)=>{
                    const b=surface[(i+1)%surface.length],da=project(...a).depth,db=project(...b).depth;
                    if(da>=2)clipped.push(a);
                    if((da>=2)!==(db>=2)){const t=(2-da)/(db-da);clipped.push(a.map((n,k)=>n+t*(b[k]-n)));}
                });
                clipped.forEach((a,i)=>{const p=project(...a);if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});
                ctx.closePath();ctx.fill();ctx.restore();for(let i=0;i<corners.length;i++){
                    const a=corners[i],b=corners[(i+1)%corners.length];
                    if(this.cameraPreset!=='top'&&this.cameraPreset!=='side'&&(i===0||i===3))line([...a,score(...a)],[...b,score(...b)],'#b9c0c9',1);
                }
            const normalLength=Math.hypot(wx,wy);
            if(normalLength>1e-8){
                const nx=wx/normalLength,ny=wy/normalLength;
                const offset=score(5,5)/normalLength;
                const cx=5-nx*offset,cy=5-ny*offset;
                line([cx-ny*radius*2,cy+nx*radius*2,0],
                     [cx+ny*radius*2,cy-nx*radius*2,0],'#98a3ae',1.5);
            }}

            // The feature-weight vector lies in z=0, normal to the decision line.
            const weightLength=Math.hypot(wx,wy);
            if(state.showVector&&weightLength>1e-8){
                const nx=wx/weightLength,ny=wy/weightLength;
                const offset=score(5,5)/weightLength;
                const anchor=[5-nx*offset,5-ny*offset,0];
                const tip=[anchor[0]+nx*2.2,anchor[1]+ny*2.2,0];
                line(anchor,tip,this.vectorColor,2.5,[],true);

                // Construct the right angle in the input plane before camera projection.
                const size=.45,u=[nx*size,ny*size],v=[-ny*size,nx*size];
                const a=[anchor[0]+u[0],anchor[1]+u[1],0],
                    b=[a[0]+v[0],a[1]+v[1],0],
                    c=[anchor[0]+v[0],anchor[1]+v[1],0];
                line(a,b,this.vectorColor,1.2);line(b,c,this.vectorColor,1.2);
            }
            for(const [a,b,name] of [[[lo,0,0],[hi+1,0,0],'x₁'],[[0,lo,0],[0,hi+1,0],'x₂'],[[0,0,-extent/Math.min(1,camera.zoom)],[0,0,extent*1.1/Math.min(1,camera.zoom)],'z']]){if(name==='z'&&this.cameraPreset==='top')continue;line(a,b,'#65717e',1.6,[],true);if(name==='x₁')label([11,0,0],name);if(name==='x₂')label([0,11,0],name);if(name==='z')label(b,'z');}
            // Edge heights encode each slope; the intercept translates the plane.
            const positions=[[handleInset,0,score(handleInset,0)],[0,handleInset,score(0,handleInset)],[0,0,bias]];
            this.weightHandles=positions.map((a,i)=>{
                const p=project(...a),q=project(a[0],a[1],a[2]+(i===2?1:handleInset));
                if(this.cameraPreset==='top'){
                    // Screen-up dragging changes height when viewed along the height axis.
                    return {i,p,dx:0,dy:i===2?-8:-40,extent};
                }
                if(this.cameraPreset==='side'){
                    const dx=q.x-p.x,dy=q.y-p.y;
                    p.x=clamp(p.x,35,CANVAS_WIDTH-35);p.y=clamp(p.y,85,CANVAS_HEIGHT-65);
                    return {i,p,dx,dy,extent};
                }
                return {i,p,dx:q.x-p.x,dy:q.y-p.y,extent};
            });
            if(this.cameraPreset!=='top')line([0,0,0],[0,0,bias],'#65717e',1.6);
            state.points.forEach(p=>{
                const selected=p===state.currentPoint,q=project(p.x,p.y,0);
                if(q.depth<2)return;
                const correct=(score(p.x,p.y)>=0?1:0)===p.classLabel;
                ctx.beginPath();ctx.arc(q.x,q.y,selected?5:3.5,0,Math.PI*2);
                ctx.strokeStyle=this.classColors[p.classLabel];ctx.lineWidth=selected?2:1.5;
                if(correct){ctx.fillStyle=this.classColors[p.classLabel];ctx.fill();}
                ctx.stroke();
            });
            // The z-axis is also the one-dimensional score ruler.
            if(this.cameraPreset!=='top')line([0,0,-extent],[0,0,extent],'#65717e',1.6);

            // Walk from the input to the score axis, accumulating each contribution.
            if(state.currentPoint){
                const p=state.currentPoint,base=[p.x,p.y,0],first=[0,p.y,wx*p.x],second=[0,0,wx*p.x+wy*p.y],last=[0,0,score(p.x,p.y)];
                const color1=this.classColors[0],color2=this.classColors[1];
                if(this.showPointProjection){ctx.save();ctx.globalAlpha=.3;line(base,last,'#9563c6',2,[],true);ctx.restore();}
                if(this.showPointComponents){line(base,first,color1,2.5,[],true);
                line(first,second,color2,2.5,[],true);
                line(second,last,this.vectorColor,2.5,[],true);}

            }
            if(state.currentPoint&&(this.showPointComponents||this.showPointProjection)){const p=state.currentPoint;dot([0,0,score(p.x,p.y)],this.classColors[p.classLabel],4);}
            ctx.restore();
            const drawWeightHandles=()=>positions.forEach((a,i)=>{
                const p=this.weightHandles[i].p;
                {
                    const color=i===2?this.vectorColor:this.classColors[i],start=project(0,0,i===2?0:bias);

                    if(this.cameraPreset==='side'){start.x=clamp(start.x,35,CANVAS_WIDTH-35);start.y=clamp(start.y,85,CANVAS_HEIGHT-65);}

                    const length=Math.hypot(p.x-start.x,p.y-start.y);
                    if(length>1){
                        const ux=(p.x-start.x)/length,uy=(p.y-start.y)/length,head=Math.min(10,length*.6);
                        ctx.beginPath();ctx.moveTo(start.x,start.y);
                        ctx.lineTo(p.x-ux*head,p.y-uy*head);
                        ctx.strokeStyle=color;ctx.lineWidth=2.2;ctx.stroke();
                        ctx.beginPath();ctx.moveTo(p.x,p.y);
                        ctx.lineTo(p.x-ux*head-uy*head*.5,p.y-uy*head+ux*head*.5);
                        ctx.lineTo(p.x-ux*head+uy*head*.5,p.y-uy*head-ux*head*.5);
                        ctx.closePath();ctx.fillStyle=color;ctx.fill();
                    }
                }
            });
            const sideBlend=camera.sideBlend||0;
            if(sideBlend>0){
                const zero=project(0,0,0),top=0,bottom=CANVAS_HEIGHT;
                ctx.save();ctx.beginPath();ctx.rect(0,top,CANVAS_WIDTH,bottom-top);ctx.clip();
                ctx.globalAlpha=sideBlend*.65;ctx.fillStyle=getComputedStyle(this.canvas).backgroundColor;
                if(ctx.fillStyle==='rgba(0, 0, 0, 0)')ctx.fillStyle='#fff';
                ctx.fillRect(0,top,CANVAS_WIDTH,bottom-top);
                ctx.globalAlpha=sideBlend*.09;
                ctx.fillStyle=this.classColors[1];ctx.fillRect(zero.x,top,CANVAS_WIDTH-zero.x,bottom-top);
                ctx.fillStyle=this.classColors[0];ctx.fillRect(0,top,zero.x,bottom-top);
                ctx.globalAlpha=sideBlend;
                line([0,0,-extent*2],[0,0,extent*2],'#65717e',1.6);
                ctx.strokeStyle='#65717e';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(zero.x,top);ctx.lineTo(zero.x,bottom);ctx.stroke();
                ctx.fillStyle=this.textColor;ctx.font='12px sans-serif';ctx.fillText('z',CANVAS_WIDTH-25,zero.y-10);ctx.fillText('0',zero.x+8,zero.y+18);
                ctx.restore();
                if(this.cameraPreset==='side'){this.project3d=(x,y)=>project(0,0,score(x,y));}
            }

            drawWeightHandles();
            if(sideBlend>0){
                ctx.save();ctx.beginPath();ctx.rect(0,0,CANVAS_WIDTH,CANVAS_HEIGHT);ctx.clip();
                // Render the active point last so nearby scores cannot obscure it.
                [...state.points].sort((a,b)=>(a===state.currentPoint)-(b===state.currentPoint)).forEach(p=>{
                    const z=score(p.x,p.y),q=project(0,0,z),correct=(z>=0?1:0)===p.classLabel;
                    ctx.beginPath();ctx.arc(q.x,q.y,p===state.currentPoint?6:2.4,0,Math.PI*2);
                    if(correct){ctx.fillStyle=this.classColors[p.classLabel];ctx.fill();}
                    ctx.strokeStyle=this.classColors[p.classLabel];ctx.lineWidth=1.8;ctx.stroke();
                });ctx.restore();
            }
        }

        _renderSharedBox(state) {
            if(this.sharedScore){this._renderSharedScore(state);return;}
            const ctx=this.ctx,w=[...state.weights,state.bias],mag=Math.hypot(...w);
            const camera=this.camera3d||(this.camera3d={yaw:-.45,pitch:.5,zoom:1,panX:0,panY:0});
            const project=(x,y,z=1)=>{const a=x-5,b=y-5,c=z-1.5;return {x:245+camera.panX+(a*Math.cos(camera.yaw)-b*Math.sin(camera.yaw))*22*camera.zoom,y:205+camera.panY-((a*Math.sin(camera.yaw)+b*Math.cos(camera.yaw))*Math.sin(camera.pitch)+c*Math.cos(camera.pitch))*22*camera.zoom};};
            this.project3d=project;
            const line=(a,b,color,width=1,dash=[],arrow=false)=>{
                const p=project(...a),q=project(...b),length=Math.hypot(q.x-p.x,q.y-p.y);
                if(length<.01)return;
                const ux=(q.x-p.x)/length,uy=(q.y-p.y)/length,head=arrow?Math.min(6,length*.3):0;
                ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.setLineDash(dash);
                ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x-ux*head*.8,q.y-uy*head*.8);ctx.stroke();
                if(arrow){ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-ux*head-uy*head*.42,q.y-uy*head+ux*head*.42);ctx.lineTo(q.x-ux*head+uy*head*.42,q.y-uy*head-ux*head*.42);ctx.closePath();ctx.fill();}ctx.restore();
            };
            const polygon=(vertices,color,alpha)=>{ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.beginPath();vertices.forEach((a,i)=>{const p=project(...a);if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y)});ctx.closePath();ctx.fill();ctx.restore();};
            const label=(a,text,color=this.textColor,dx=5,dy=-6)=>{const p=project(...a);ctx.fillStyle=color;ctx.font='12px sans-serif';ctx.fillText(text,p.x+dx,p.y+dy);};
            const dot=(a,color,r)=>{const p=project(...a);ctx.beginPath();ctx.arc(p.x,p.y,r,0,2*Math.PI);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=this.textColor;ctx.lineWidth=.5;ctx.stroke();};
            ctx.save();ctx.beginPath();ctx.rect(8,60,CANVAS_WIDTH-16,CANVAS_HEIGHT-105);ctx.clip();
            const vertices=[];for(const a of [0,10])for(const b of [0,10])for(const c of [0,5])vertices.push([a,b,c]);
            const score=p=>p.reduce((v,a,i)=>v+a*w[i],0),hits=[];
            for(let i=0;i<8;i++)for(let j=i+1;j<8;j++){const a=vertices[i],b=vertices[j];if(a.filter((v,k)=>v!==b[k]).length!==1)continue;const sa=score(a),sb=score(b);if(Math.abs(sa)<1e-9)hits.push(a);if(Math.abs(sb)<1e-9)hits.push(b);if(sa*sb<0){const t=sa/(sa-sb);hits.push(a.map((v,k)=>v+t*(b[k]-v)))}}
            const plane=hits.filter((p,i)=>hits.findIndex(q=>Math.hypot(...p.map((v,k)=>v-q[k]))<1e-7)===i);
            if(state.showBoundary&&mag>1e-8&&plane.length>=3){const center=plane.reduce((a,p)=>a.map((v,k)=>v+p[k]/plane.length),[0,0,0]),u=plane[0].map((v,k)=>v-center[k]),v=[w[1]*u[2]-w[2]*u[1],w[2]*u[0]-w[0]*u[2],w[0]*u[1]-w[1]*u[0]],ul=Math.hypot(...u),vl=Math.hypot(...v);const theta=p=>Math.atan2(p.reduce((s,a,k)=>s+(a-center[k])*v[k]/vl,0),p.reduce((s,a,k)=>s+(a-center[k])*u[k]/ul,0));plane.sort((a,b)=>theta(a)-theta(b));polygon(plane,this.vectorColor,.075);}
            polygon([[0,0,1],[10,0,1],[10,10,1],[0,10,1]],'#9260bb',.05);
            for(let i=0;i<=10;i+=2){line([i,0,1],[i,10,1],this.gridColor);line([0,i,1],[10,i,1],this.gridColor)}
            for(const [a,b] of [[[0,0,5],[10,0,5]],[[0,0,5],[0,10,5]],[[10,0,5],[10,10,5]],[[0,10,5],[10,10,5]],[[10,0,0],[10,0,5]],[[0,10,0],[0,10,5]]])line(a,b,this.gridColor,1,[3,3]);
            const crossings=[];for(const [a,b] of [[[0,0],[10,0]],[[10,0],[10,10]],[[10,10],[0,10]],[[0,10],[0,0]]]){const sa=score([...a,1]),sb=score([...b,1]);if(Math.abs(sa)<1e-9)crossings.push([...a,1]);if(sa*sb<0){const t=sa/(sa-sb);crossings.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]),1])}}
            if(state.showBoundary&&crossings.length>=2)line(crossings[0],crossings[1],this.boundaryColor,2);
            state.points.forEach(p=>{const pos=[p.x,p.y,1],selected=p===state.currentPoint;dot(pos,this.classColors[p.classLabel],selected?6:4);if((score(pos)>=0?1:0)!==p.classLabel){const q=project(...pos);ctx.beginPath();ctx.arc(q.x,q.y,selected?9:6,0,Math.PI*2);ctx.strokeStyle='#d24b47';ctx.lineWidth=1;ctx.stroke();}});
            for(const [end,name] of [[[11,0,0],'x₁'],[[0,11,0],'x₂'],[[0,0,5.7],'x₀']]){line([0,0,0],end,'#3977c2',1.25,[],true);label(end,name,'#3977c2')}
            const weightOrigin=[10.8,10.8,0],weightScale=this.weightDragScale??4/Math.max(4,...w.map(Math.abs));
            const onAxis=(i,value)=>weightOrigin.map((v,k)=>v+(i===k?value*weightScale:0));
            const axisNames=['w₁','w₂','w₀'],weightMarkers=[];this.weightHandles=[];
            for(let i=0;i<3;i++){
                const reach=Math.max(4/weightScale,Math.abs(w[i])+1/weightScale);
                const a=onAxis(i,-reach),b=onAxis(i,reach);
                line(a,b,'#3977c2',1.25,[],true);
                const point=onAxis(i,w[i]);dot(point,this.vectorColor,3);weightMarkers.push({point,i});const hp=project(...point),hq=project(...onAxis(i,w[i]+1));this.weightHandles.push({i,p:hp,dx:hq.x-hp.x,dy:hq.y-hp.y,scale:weightScale});
            }
            dot(weightOrigin,'#3977c2',2);label(weightOrigin,'0',this.textColor,6,14);
            dot([0,0,1],'#9260bb',3);label([0,0,1],'1','#9260bb',-14,3);
            if(state.showVector&&mag>1e-8){const normal=w.map(a=>a/mag*2.5),tip=w.map((a,i)=>weightOrigin[i]+a*weightScale);line(weightOrigin,tip,this.vectorColor,1.5,[],true);}
            ctx.restore();
            // Keep value labels in a stable rail, away from the crowded weight origin.
            const ordered=weightMarkers.map(m=>({...m,p:project(...m.point)})).sort((a,b)=>a.p.y-b.p.y);
            ordered.forEach((m,row)=>{const lx=475,ly=130+row*58;ctx.save();ctx.strokeStyle=this.gridColor;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(m.p.x+5,m.p.y);ctx.lineTo(lx-14,ly-4);ctx.lineTo(lx-5,ly-4);ctx.stroke();ctx.fillStyle=this.vectorColor;ctx.font='12px sans-serif';ctx.fillText(axisNames[m.i],lx,ly-9);ctx.font='bold 14px monospace';ctx.fillStyle=this.textColor;ctx.fillText(formatNumber(w[m.i]),lx,ly+11);ctx.restore();});
            ctx.fillStyle=this.textColor;ctx.font='12px sans-serif';ctx.fillText(`Decision plane: ${formatNumber(state.bias)}x₀ + (${formatNumber(w[0])})x₁ + (${formatNumber(w[1])})x₂ = 0`,15,23);
            ctx.font='11px sans-serif';ctx.fillText('Data sheet: x₀ = 1   ·   Dark line: decision boundary',15,43);
            ctx.fillText('One scale for all weights. Teal arrow is perpendicular to the decision plane.',15,CANVAS_HEIGHT-29);
            ctx.fillText('Drag: orbit · Shift-drag: pan · Scroll: zoom · Double-click: reset',15,CANVAS_HEIGHT-12);
        }

        _render3D(state) {
            if(this.sharedBox){this._renderSharedBox(state);return;}
            if(this.weightSpace){this._renderWeightSpace(state);return;}
            const ctx=this.ctx,score=(x,y)=>state.bias+state.weights[0]*x+state.weights[1]*y;
            const corners=[[0,0],[10,0],[10,10],[0,10]];
            const extent=Math.max(1,...corners.map(([x,y])=>Math.abs(score(x,y))));
            const camera=this.camera3d||(this.camera3d={yaw:Math.PI/4,pitch:.48,zoom:1,panX:0,panY:0});
            const project=(x,y,z=0)=>{
                const a=x-5,b=y-5,c=z/extent*2.5;
                const horizontal=a*Math.cos(camera.yaw)-b*Math.sin(camera.yaw),depth=a*Math.sin(camera.yaw)+b*Math.cos(camera.yaw);
                return {x:280+camera.panX+horizontal*26*camera.zoom,y:215+camera.panY+(depth*Math.sin(camera.pitch)-c*Math.cos(camera.pitch))*26*camera.zoom};
            };
            this.project3d=project;
            const line=(a,b,color,width=1)=>{ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();};
            const polygon=(vertices,color,alpha)=>{ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.beginPath();vertices.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();ctx.restore();};
            const background=getComputedStyle(document.documentElement).getPropertyValue('--viz-canvas-bg').trim();
            const label=(text,p,color=this.textColor)=>{ctx.font='11px sans-serif';ctx.textAlign='left';const width=ctx.measureText(text).width;const x=Math.max(8,Math.min(CANVAS_WIDTH-width-12,p.x));const y=Math.max(83,Math.min(CANVAS_HEIGHT-30,p.y));ctx.fillStyle=background;ctx.fillRect(x-3,y-12,width+6,17);ctx.fillStyle=color;ctx.fillText(text,x,y);};
            polygon(corners.map(([x,y])=>project(x,y)),this.textColor,.06);
            for(let i=0;i<=10;i+=2){line(project(i,0),project(i,10),this.gridColor);line(project(0,i),project(10,i),this.gridColor);}
            if(state.showBoundary){
                polygon(corners.map(([x,y])=>project(x,y,score(x,y))),this.vectorColor,.2);
                for(let i=0;i<=10;i+=2){line(project(i,0,score(i,0)),project(i,10,score(i,10)),this.vectorColor);line(project(0,i,score(0,i)),project(10,i,score(10,i)),this.vectorColor);}
                const h=this._boundaryHandles(state.weights,state.bias);
                if(h){const dx=2*(h.rotate.x-h.center.x),dy=2*(h.rotate.y-h.center.y);line(project(h.center.x-dx,h.center.y-dy),project(h.center.x+dx,h.center.y+dy),this.boundaryColor,2);}
            }
            const origin=project(0,0);
            for(const [end,text] of [[project(11,0),'x₁'],[project(0,11),'x₂'],[project(0,0,extent*1.15),'z (score)']]){line(origin,end,this.textColor);label(text,{x:end.x+5,y:end.y});}
            line(origin,project(0,0,-extent),this.textColor);
            label('0',{x:origin.x+6,y:origin.y+15});
            state.points.forEach(p=>{const base=project(p.x,p.y),top=project(p.x,p.y,score(p.x,p.y)),selected=p===state.currentPoint;
                if(selected || this.construction){ctx.save();ctx.globalAlpha=selected?1:.22;ctx.setLineDash([3,3]);line(base,top,this.classColors[p.classLabel],selected?2:1);ctx.restore();}
                for(const [q,r] of [[base,selected?5:3],[top,selected?5:2]]){ctx.beginPath();ctx.arc(q.x,q.y,r,0,Math.PI*2);ctx.fillStyle=this.classColors[p.classLabel];ctx.fill();}
                if(selected)label(`z = ${formatNumber(score(p.x,p.y))}`,{x:top.x+10,y:top.y+16},this.classColors[p.classLabel]);
            });
            const intercept=project(0,0,state.bias);
            line(origin,intercept,this.vectorColor,3);
            ctx.beginPath();ctx.arc(intercept.x,intercept.y,5,0,Math.PI*2);ctx.fillStyle=this.vectorColor;ctx.fill();
            label(`w₀ = ${formatNumber(state.bias)} at (0, 0, ${formatNumber(state.bias)})`,{x:intercept.x+12,y:intercept.y+5},this.vectorColor);
            if(this.construction){
                // Unit runs show each coefficient as a slope, anchored on the score surface.
                [[0,this.classColors[0]],[1,this.classColors[1]]].forEach(([axis,color])=>{
                    const x=axis===0?3:0,y=axis===1?3:0;
                    const start=project(x,y,score(x,y));
                    const run=project(x+(axis===0?1:0),y+(axis===1?1:0),score(x,y));
                    const end=project(x+(axis===0?1:0),y+(axis===1?1:0),score(x,y)+state.weights[axis]);
                    line(start,run,color,2);line(run,end,color,3);line(start,end,color,1);
                    label(`Δx${axis+1} = 1`,{x:(start.x+run.x)/2-25,y:Math.max(start.y,run.y)+18},color);
                    label(`Δz = w${axis+1} = ${formatNumber(state.weights[axis])}`,{x:end.x+(axis===0?8:-125),y:end.y-12},color);
                });
                const sample=state.currentPoint;
                if(sample){
                    const z=score(sample.x,sample.y),top=project(sample.x,sample.y,z);
                    const key=[sample.x,sample.y,...state.weights,state.bias].join(',');
                    if(this.constructionKey!==key){this.constructionKey=key;this.constructionStart=performance.now();}
                    const progress=Math.min(1,(performance.now()-this.constructionStart)/1100),base=project(sample.x,sample.y);
                    const q={x:base.x+(top.x-base.x)*progress,y:base.y+(top.y-base.y)*progress};
                    ctx.beginPath();ctx.arc(q.x,q.y,5,0,Math.PI*2);ctx.fillStyle=this.classColors[sample.classLabel];ctx.fill();
                    if(progress<1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){cancelAnimationFrame(this.constructionFrame);this.constructionFrame=requestAnimationFrame(()=>{if(this.view3d&&this.construction)this.render(state);});}
                }
            }
            ctx.fillStyle=background;ctx.globalAlpha=.96;ctx.fillRect(12,8,CANVAS_WIDTH-24,54);ctx.globalAlpha=1;
            ctx.font='11px sans-serif';ctx.fillStyle=this.textColor;ctx.fillText('Score surface: z = w₀ + w₁x₁ + w₂x₂',22,24);
            ctx.fillText('At x₁ = x₂ = 0, z = w₀. The marked point is the z-intercept.',22,42);
            ctx.fillText('Dark line: z = 0 · Drag: orbit · Shift-drag: pan · Scroll: zoom',15,CANVAS_HEIGHT-12);
        }

        _renderWeightSpace(state) {
            const ctx=this.ctx,p=state.currentPoint||state.points[0];if(!p)return;
            const camera=this.camera3d||(this.camera3d={yaw:Math.PI/4,pitch:.48,zoom:1,panX:0,panY:0});
            const extent=Math.max(1,Math.abs(state.bias),...state.weights.map(Math.abs))*1.3;
            const project=(w0,w1,w2)=>{
                const horizontal=w1*Math.cos(camera.yaw)-w2*Math.sin(camera.yaw),depth=w1*Math.sin(camera.yaw)+w2*Math.cos(camera.yaw);
                return {x:280+camera.panX+horizontal/extent*125*camera.zoom,y:215+camera.panY+(depth*Math.sin(camera.pitch)-w0*Math.cos(camera.pitch))/extent*125*camera.zoom};
            };
            this.project3d=()=>project(state.bias,...state.weights);
            const line=(a,b,color,width=1)=>{ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();};
            // A sample defines a plane in weight space: w0 + x1*w1 + x2*w2 = 0.
            const normal=[1,p.x,p.y],length=Math.hypot(...normal),n=normal.map(v=>v/length);
            const u=[-p.x,1,0],ul=Math.hypot(...u);u.forEach((v,i)=>u[i]=v/ul);
            const v=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]];
            const vertices=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>project(...u.map((value,i)=>extent*(a*value+b*v[i]))));
            ctx.save();ctx.globalAlpha=.18;ctx.fillStyle=this.vectorColor;ctx.beginPath();vertices.forEach((q,i)=>i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));ctx.closePath();ctx.fill();ctx.restore();
            vertices.forEach((q,i)=>line(q,vertices[(i+1)%4],this.vectorColor));
            const origin=project(0,0,0);ctx.font='12px sans-serif';ctx.textAlign='left';
            for(let i=0;i<3;i++){
                const a=[0,0,0],b=[0,0,0];a[i]=-extent;b[i]=extent;
                const end=project(...b);line(project(...a),end,this.textColor);ctx.fillStyle=this.textColor;ctx.fillText(['w₀','w₁','w₂'][i],end.x+5,end.y);
            }
            const current=[state.bias,...state.weights],tip=project(...current);
            line(origin,tip,this.vectorColor,3);ctx.beginPath();ctx.arc(tip.x,tip.y,5,0,Math.PI*2);ctx.fillStyle=this.vectorColor;ctx.fill();
            const score=current.reduce((sum,w,i)=>sum+w*normal[i],0),foot=current.map((w,i)=>w-score/length*n[i]);
            ctx.setLineDash([4,3]);line(tip,project(...foot),this.vectorColor);ctx.setLineDash([]);
            ctx.fillText(`w = (${current.map(w=>formatNumber(w)).join(', ')})`,Math.max(10,Math.min(CANVAS_WIDTH-190,tip.x+9)),Math.max(90,tip.y-12));
            ctx.fillStyle=this.textColor;ctx.fillText('Weight space: axes are parameters, not input features',15,22);
            ctx.fillText(`Selected sample’s zero-score plane: w₀ + ${formatNumber(p.x)}w₁ + ${formatNumber(p.y)}w₂ = 0`,15,42);
            ctx.fillText(`Current weights give z = ${formatNumber(score)} → prediction ${Number(score>=0)}`,15,62);
            ctx.fillText('Drag: orbit · Shift-drag: pan · Scroll: zoom · Double-click: reset',15,CANVAS_HEIGHT-12);
        }

        _drawRegions(weights, bias) {
            const ctx=this.ctx, score=p=>weights[0]*p.x+weights[1]*p.y+bias;
            const corners=[{x:0,y:0},{x:FEATURE_SCALE,y:0},{x:FEATURE_SCALE,y:FEATURE_SCALE},{x:0,y:FEATURE_SCALE}];
            for(const label of [0,1]) {
                const vertices=[],inside=p=>label===1?score(p)>=0:score(p)<=0;
                for(let i=0;i<4;i++) {
                    const a=corners[i],b=corners[(i+1)%4],sa=score(a),sb=score(b);
                    if(inside(a))vertices.push(a);
                    if(inside(a)!==inside(b)){const t=sa/(sa-sb);vertices.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)});}
                }
                if(!vertices.length)continue;
                ctx.save();ctx.globalAlpha=.025;ctx.fillStyle=this.classColors[label];ctx.beginPath();
                vertices.forEach((p,i)=>{const c=this.dataToCanvas(p.x,p.y);if(i)ctx.lineTo(c.x,c.y);else ctx.moveTo(c.x,c.y);});
                ctx.closePath();ctx.fill();ctx.restore();
            }
        }

        _drawBoundary(weights, bias) {
            const line = this._lineForWeights(weights, bias);
            if (!line) return;

            const ctx = this.ctx;
            ctx.save();
            ctx.strokeStyle = this.boundaryColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(line.x1, line.y1);
            ctx.lineTo(line.x2, line.y2);
            ctx.stroke();
            ctx.restore();
        }

        _drawMargin(weights, bias) {
            const margin = this._marginLines(weights, bias);
            if (!margin) return;

            const ctx = this.ctx;
            ctx.save();
            ctx.strokeStyle = this.marginColor;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            margin.forEach(line => {
                ctx.beginPath();
                ctx.moveTo(line.x1, line.y1);
                ctx.lineTo(line.x2, line.y2);
                ctx.stroke();
            });
            ctx.restore();
        }

        _boundaryHandles(weights, bias) {
            const [wx,wy]=weights, norm=wx*wx+wy*wy;
            if(norm<1e-10)return null;
            const hits=[];
            const add=(x,y)=>{if(x>=0&&x<=FEATURE_SCALE&&y>=0&&y<=FEATURE_SCALE&&!hits.some(p=>Math.hypot(p.x-x,p.y-y)<1e-8))hits.push({x,y});};
            if(Math.abs(wy)>1e-8){add(0,-bias/wy);add(FEATURE_SCALE,(-bias-wx*FEATURE_SCALE)/wy);}
            if(Math.abs(wx)>1e-8){add(-bias/wx,0);add((-bias-wy*FEATURE_SCALE)/wx,FEATURE_SCALE);}
            if(hits.length<2)return null;
            const [a,b]=hits;
            return {center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},rotate:{x:a.x*.25+b.x*.75,y:a.y*.25+b.y*.75}};
        }

        _drawHandles(weights,bias) {
            const h=this._boundaryHandles(weights,bias); if(!h)return;
            const c=this.dataToCanvas(h.center.x,h.center.y),r=this.dataToCanvas(h.rotate.x,h.rotate.y),ctx=this.ctx;
            ctx.save();ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--viz-canvas-bg').trim() || '#fff';
            ctx.strokeStyle=this.boundaryColor;ctx.lineWidth=1.5;
            ctx.beginPath();ctx.arc(c.x,c.y,5,0,2*Math.PI);ctx.fill();ctx.stroke();
            ctx.fillRect(r.x-4,r.y-4,8,8);ctx.strokeRect(r.x-4,r.y-4,8,8);ctx.restore();
        }

        _drawWeightVector(weights,bias) {
            const ctx=this.ctx, handles=this._boundaryHandles(weights,bias);
            if(!handles)return;
            const magnitude=Math.hypot(...weights);
            const center=this.dataToCanvas(handles.center.x,handles.center.y);
            const nx=weights[0]/magnitude,ny=weights[1]/magnitude,h=handles.center;
            const roomX=Math.abs(nx)<1e-8?Infinity:(nx>0?FEATURE_SCALE-h.x:h.x)/Math.abs(nx);
            const roomY=Math.abs(ny)<1e-8?Infinity:(ny>0?FEATURE_SCALE-h.y:h.y)/Math.abs(ny);
            const length=Math.min(.12*FEATURE_SCALE,.8*roomX,.8*roomY);
            if(length<.025*FEATURE_SCALE)return;
            const end=this.dataToCanvas(h.x+nx*length,h.y+ny*length);

            ctx.save();
            ctx.strokeStyle = this.vectorColor;
            ctx.fillStyle = this.vectorColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(center.x, center.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();

            const angle = Math.atan2(end.y - center.y, end.x - center.x);
            const arrowSize = 8;
            ctx.beginPath();
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(
                end.x - arrowSize * Math.cos(angle - Math.PI / 6),
                end.y - arrowSize * Math.sin(angle - Math.PI / 6)
            );
            ctx.lineTo(
                end.x - arrowSize * Math.cos(angle + Math.PI / 6),
                end.y - arrowSize * Math.sin(angle + Math.PI / 6)
            );
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        _lineForWeights(weights, bias) {
            const [w1, w2] = weights;
            if (Math.abs(w1) < 1e-6 && Math.abs(w2) < 1e-6) return null;

            // Compute two points far apart on the line w1*x + w2*y + b = 0.
            // Canvas clipping handles the rest — no manual intersection needed.
            let p1, p2;
            if (Math.abs(w2) > Math.abs(w1)) {
                // Line is more horizontal — parameterize by x
                p1 = { x: -10, y: (-bias - w1 * -10) / w2 };
                p2 = { x:  10, y: (-bias - w1 *  10) / w2 };
            } else {
                // Line is more vertical — parameterize by y
                p1 = { x: (-bias - w2 * -10) / w1, y: -10 };
                p2 = { x: (-bias - w2 *  10) / w1, y:  10 };
            }

            const c1 = this.dataToCanvas(p1.x, p1.y);
            const c2 = this.dataToCanvas(p2.x, p2.y);
            return { x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y };
        }

        _marginLines(weights, bias) {
            const magnitude = Math.sqrt(weights[0] ** 2 + weights[1] ** 2);
            if (magnitude < 1e-6) return null;

            const marginOffset = 1;
            const upper = this._lineForWeights(weights, bias + marginOffset);
            const lower = this._lineForWeights(weights, bias - marginOffset);
            if (!upper || !lower) return null;
            return [upper, lower];
        }
    }

    // ============================================
    // Perceptron Visualizer Controller
    // ============================================
    class PerceptronViz {
        constructor() {
            this.dataset = new DatasetState();
            this.model = new PerceptronModel();
            this.ui = new UIRenderer();
            this.playback = null;
            this.steps = [];

            this.state = {
                showBoundary: true,
                showVector: false,
                showMargin: false
            };

            this._init();
        }

        _init() {
            if (window.VizLib?.PlaybackController) {
                this._setupPlayback();
                this._setupEventListeners();
                this._resetTraining();
            } else {
                window.addEventListener('vizlib-ready', () => {
                    this._setupPlayback();
                    this._setupEventListeners();
                    this._resetTraining();
                });
            }

            if (window.VizLib?.ThemeManager) {
                window.VizLib.ThemeManager.onThemeChange(() => {
                    this._renderCurrent();
                });
            }

            window.addEventListener('resize', () => {
                this.ui._setupHiDPI();
                this._renderCurrent();
            });
        }

        _setupPlayback() {
            const PlaybackController = window.VizLib?.PlaybackController;
            if (!PlaybackController) return;

            this.playback = new PlaybackController({
                initialSpeed: 6,
                getDelayFn: (speed) => {
                    // Speed 1 = 500ms, Speed 6 = 30ms, Speed 10 = 1ms
                    const step = this.playback?.getCurrentStep();
                    const scale = Math.max(.4, (11-speed)/5);
                    return ({activation:1700,prediction:1100,update:1100,redraw:650}[step?.phase] || 1700)*scale;
                },
                onRenderStep: (step) => this._onRenderStep(step),
                onPlayStateChange: (isPlaying) => this._onPlayStateChange(isPlaying),
                onStepChange: (index, total) => this._onStepChange(index, total),
                onFinished: () => this._onPlaybackFinished(),
                onReset: () => this._onPlaybackReset()
            });
        }

        _setupEventListeners() {
            document.getElementById('dataset-select')?.addEventListener('change', () => this._resetTraining({newData:true}));
            document.getElementById('init-select')?.addEventListener('change', () => this._resetTraining({newWeights:true}));
            document.getElementById('shuffle-toggle')?.addEventListener('change', () => this._resetTraining());

            const lrSlider = document.getElementById('lr-slider');
            const lrValue = document.getElementById('lr-value');
            lrSlider?.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                if (lrValue) lrValue.textContent = value.toFixed(3);
                this._resetTraining();
            });

            VizLib.DomUtils.wireStepper('epochs-minus', 'epochs-plus', 'epochs-value', {
                min: 1, max: 50, step: 1, onChange: () => this._resetTraining()
            });

            document.getElementById('show-boundary')?.addEventListener('change', (e) => {
                this.state.showBoundary = e.target.checked;
                this._renderCurrent();
            });
            for(const [id,property] of [['show-components','showPointComponents'],['show-projection','showPointProjection']]){
                document.getElementById(id)?.addEventListener('change',e=>{
                    this.ui[property]=e.target.checked;
                    this._renderCurrent();
                });
            }
            document.getElementById('show-vector')?.addEventListener('change', (e) => {
                this.state.showVector = e.target.checked;
                this._renderCurrent();
            });
            document.getElementById('show-margin')?.addEventListener('change', (e) => {
                this.state.showMargin = e.target.checked;
                this._renderCurrent();
            });

            document.getElementById('btn-play')?.addEventListener('click', () => this.playback?.play());
            document.getElementById('btn-pause')?.addEventListener('click', () => this.playback?.pause());
            document.getElementById('btn-step-forward')?.addEventListener('click', () => this.playback?.stepForward());
            document.getElementById('btn-step-back')?.addEventListener('click', () => this.playback?.stepBackward());
            document.getElementById('btn-reset')?.addEventListener('click', () => this._resetTraining());

            document.getElementById('speed-slider')?.addEventListener('input', (e) => {
                const value = parseInt(e.target.value, 10);
                this.playback?.setSpeed(value);
            });

            this._setupTeaching();

            // Info tab button switching (for btn-group variant)
            document.querySelectorAll('.info-panel-tabs .btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tabId = btn.getAttribute('data-tab');
                    btn.closest('.info-panel-tabs').querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const panel = btn.closest('.panel');
                    panel.querySelectorAll('.info-tab-content').forEach(t => t.classList.remove('active'));
                    const target = panel.querySelector('#tab-' + tabId);
                    if (target) target.classList.add('active');
                });
            });
        }

        _resetTraining({newData=false, newWeights=false} = {}) {
            cancelAnimationFrame(this.boundaryAnimation);
            this._cancelTeachingMotion();
            this.selectedPoint = null;
            this.lastRenderedStep = null;
            this.walkthroughKey=null;
            if (this.playback) {
                this.playback.pause();
            }

            const datasetType = document.getElementById('dataset-select')?.value || 'linear';
            const initMode = document.getElementById('init-select')?.value || 'zero';
            const lr = parseFloat(document.getElementById('lr-slider')?.value || '0.005');
            const epochs = parseInt(document.getElementById('epochs-value')?.value || '50', 10);
            const shuffle = Boolean(document.getElementById('shuffle-toggle')?.checked);

            const points = newData || !this.dataset.points.length
                ? this.dataset.loadDataset(datasetType, DEFAULT_NUM_POINTS) : this.dataset.points;
            this.model.learningRate = lr;
            if (newWeights || !this.initialized) this.model.reset(initMode);
            if ((newWeights || newData || !this.initialized) && initMode==='random') {
                this._initializeTeachingBoundary(points);
            }
            this.initialized = true;

            const trainingModel = new PerceptronModel(lr);
            trainingModel.weights = [...this.model.weights];
            trainingModel.bias = this.model.bias;
            const trainer = new Trainer(points, trainingModel, { epochs, shuffle });
            this.steps = trainer.generateSteps();
            this.epochSummaries = this.steps.filter(s => s.phase === 'redraw' && s.sampleIndex === s.totalSamples);
            this.epochs = epochs;

            if (this.playback) {
                this.playback.load(this.steps);
            }

            this._renderCurrent();
            this._updatePlaybackButtons();
            this._updateMetrics(null);
            this._updateStepList(null);
            const nonSeparable = datasetType === 'moons' || datasetType === 'xor';
            this._setStatus(nonSeparable ? 'Ready (non-separable data)' : 'Ready');
            this._onStepChange(-1, this.steps.length);
            this._updateTeaching(null);
        }

        _initializeTeachingBoundary(points) {
            if(!points.length)return;
            const center=points.reduce((c,p)=>({x:c.x+p.x/points.length,y:c.y+p.y/points.length}),{x:0,y:0});
            let xx=0,xy=0,yy=0;
            points.forEach(p=>{const x=p.x-center.x,y=p.y-center.y;xx+=x*x;xy+=x*y;yy+=y*y;});
            // The normal follows the main data direction, so the line crosses it.
            const principal=.5*Math.atan2(2*xy,xx-yy);
            const lower=Math.min(5,Math.floor(points.length/2)),upper=Math.min(10,Math.ceil(points.length/2));
            let best=null;
            for(let turn=-6;turn<=6;turn++) {
                const angle=principal+turn*Math.PI/36,normal=[Math.cos(angle),Math.sin(angle)];
                const projections=points.map(p=>normal[0]*p.x+normal[1]*p.y).sort((a,b)=>a-b);
                const midpoint=normal[0]*center.x+normal[1]*center.y;
                const cuts=[midpoint,...projections.slice(0,-1).map((v,i)=>(v+projections[i+1])/2)];
                for(const cut of cuts) for(const sign of [-1,1]) {
                    const mistakes=points.filter(p=>Number(sign*(normal[0]*p.x+normal[1]*p.y-cut)>=0)!==p.classLabel).length;
                    const penalty=Math.max(lower-mistakes,0,mistakes-upper)*1000;
                    const score=penalty+Math.abs(cut-midpoint)+Math.abs(turn)*.15;
                    if(!best || score<best.score)best={score,weights:normal.map(w=>w*sign),bias:-cut*sign};
                }
            }
            this.model.weights=best.weights;
            this.model.bias=best.bias;
        }

        _renderCurrent() {
            const currentStep = this.playback?.currentStepIndex >= 0
                ? this.steps[this.playback.currentStepIndex]
                : null;

            const weights = currentStep?.weights ?? this.model.weights;
            const bias = currentStep?.bias ?? this.model.bias;

            const misclassifiedSet = this._computeMisclassified(weights, bias);

            this.ui.render({
                points: this.dataset.points,
                weights,
                bias,
                currentPoint: this.selectedPoint || currentStep?.point || this.dataset.points[0],
                misclassifiedSet,
                showBoundary: this.state.showBoundary,
                showVector: this.state.showVector,
                showMargin: this.state.showMargin
            });
        }

        _computeMisclassified(weights, bias) {
            const set = new Set();
            this.dataset.points.forEach((point, idx) => {
                const activation = weights[0] * point.x + weights[1] * point.y + bias;
                const sign = activation >= 0 ? 1 : 0;
                const label = toLabel(sign);
                if (label !== point.classLabel) {
                    set.add(idx);
                }
            });
            return set;
        }

        _onRenderStep(step) {
            if (!step) return;
            this.walkthroughKey=null;
            cancelAnimationFrame(this.boundaryAnimation);
            this._cancelTeachingMotion();
            this.selectedPoint = null;

            this.ui.render({
                points: this.dataset.points,
                weights: step.weights,
                bias: step.bias,
                currentPoint: step.point,
                misclassifiedSet: step.misclassifiedIndices,
                showBoundary: this.state.showBoundary,
                showVector: this.state.showVector,
                showMargin: this.state.showMargin
            });

            this._updateMetrics(step);
            this._updateStepList(step.phase);
            this._updateTeaching(step);
            if (step.update.updated && (step.phase === 'update' ||
                (step.phase === 'redraw' && this.lastRenderedStep !== this.steps[step.globalStep-1]))) this._animateUpdate(step);
            this.lastRenderedStep = step;
        }

        _onPlayStateChange(isPlaying) {
            const playBtn = document.getElementById('btn-play');
            const pauseBtn = document.getElementById('btn-pause');
            if (playBtn) {playBtn.disabled = isPlaying;playBtn.hidden=isPlaying;}
            if (pauseBtn) pauseBtn.hidden=!isPlaying;
            if (pauseBtn) pauseBtn.disabled = !isPlaying;
            this._updatePlaybackButtons();
        }

        _onStepChange(index, total) {
            const display = document.getElementById('playback-step');
            if (display) {
                const step = this.steps[index];
                if (step) {
                    display.textContent = `Epoch ${step.epoch} / ${this.epochs} · Sample ${step.sampleIndex} / ${step.totalSamples}`;
                } else {
                    display.textContent = `Epoch 0 / ${this.epochs}`;
                }
            }
            this._updatePlaybackButtons();
        }

        _onPlaybackFinished() {
            const lastStep = this.steps[this.steps.length - 1];
            const converged = lastStep && lastStep.mistakes === 0;
            this._setStatus(converged ? 'Converged!' : 'Finished');
            this._updatePlaybackButtons();
        }

        _onPlaybackReset() {
            this._setStatus('Ready');
            this._updatePlaybackButtons();
            this._updateStepList(null);
            this._updateMetrics(null);
            this._renderCurrent();
        }

        _updatePlaybackButtons() {
            const hasSteps = this.steps.length > 0;
            const isPlaying = this.playback?.isPlaying;
            const atStart = (this.playback?.currentStepIndex ?? -1) <= 0;
            const atEnd = (this.playback?.currentStepIndex ?? -1) >= this.steps.length - 1;

            const stepForward = document.getElementById('btn-step-forward');
            const stepBack = document.getElementById('btn-step-back');
            const playBtn = document.getElementById('btn-play');

            if (stepForward) stepForward.disabled = !hasSteps || atEnd || isPlaying;
            if (stepBack) stepBack.disabled = !hasSteps || atStart || isPlaying;
            if (playBtn) playBtn.disabled = !hasSteps || isPlaying;
        }

        _updateMetrics(step) {
            const epochEl = document.getElementById('metric-epoch');
            const stepEl = document.getElementById('metric-step');
            const mistakesEl = document.getElementById('metric-mistakes');
            const accuracyEl = document.getElementById('metric-accuracy');
            const weightsEl = document.getElementById('metric-weights');
            const biasEl = document.getElementById('metric-bias');

            const sampleEl = document.getElementById('metric-sample');
            const activationEl = document.getElementById('metric-activation');
            const predictionEl = document.getElementById('metric-prediction');
            const targetEl = document.getElementById('metric-target');

            if (!step) {
                if (epochEl) epochEl.textContent = '0';
                if (stepEl) stepEl.textContent = '0';
                if (mistakesEl) mistakesEl.textContent = '0';
                if (accuracyEl) accuracyEl.textContent = '0%';
                if (weightsEl) weightsEl.textContent = `[${formatNumber(this.model.weights[0])}, ${formatNumber(this.model.weights[1])}]`;
                if (biasEl) biasEl.textContent = formatNumber(this.model.bias);
                if (sampleEl) sampleEl.textContent = '-';
                if (activationEl) activationEl.textContent = '-';
                if (predictionEl) predictionEl.textContent = '-';
                if (targetEl) targetEl.textContent = '-';
                return;
            }

            if (epochEl) epochEl.textContent = String(step.epoch);
            if (stepEl) stepEl.textContent = `${step.sampleIndex} / ${step.totalSamples}`;
            if (mistakesEl) mistakesEl.textContent = String(step.mistakes);

            if (weightsEl) {
                weightsEl.textContent = `[${formatNumber(step.weights[0])}, ${formatNumber(step.weights[1])}]`;
            }
            if (biasEl) biasEl.textContent = formatNumber(step.bias);

            if (step.accuracy !== null) {
                if (accuracyEl) accuracyEl.textContent = `${Math.round(step.accuracy * 100)}%`;
            }

            if (sampleEl) {
                sampleEl.textContent = `(${formatNumber(step.point.x, 2)}, ${formatNumber(step.point.y, 2)})`;
            }
            if (activationEl) activationEl.textContent = formatNumber(step.prediction.activation);
            if (predictionEl) predictionEl.textContent = String(step.prediction.label);
            if (targetEl) targetEl.textContent = String(step.targetLabel);

            if (step.phase === 'update') {
                const status = step.updateResult?.updated ? 'Update applied' : 'No update (correct)';
                this._setStatus(status);
            }
        }

        _currentParameters() {
            const step = this.playback?.getCurrentStep();
            return step ? {weights: [...step.weights], bias: step.bias} : {weights: [...this.model.weights], bias: this.model.bias};
        }

        _showMath() {
            document.querySelector('.info-panel-tabs [data-tab="math"]')?.click();
        }

        _setupTeaching() {
            const setCameraView=(value,immediate=false)=>{
                this._cancelTeachingMotion();
                cancelAnimationFrame(this.cameraTransition);
                this.cameraOverlay?.remove();
                const previous=this.ui.cameraPreset||'orbit';
                const from={...(this.ui.camera3d||{yaw:-.45,pitch:.5,zoom:1,panX:0,panY:0})};
                const target={yaw:value==='top'?-.15:-.45,pitch:value==='top'?Math.PI/3:value==='side'?Math.PI/36:.5,zoom:value==='side'?2.5:1,panX:0,panY:0,targetX:value==='side'?0:5,targetY:value==='side'?0:5,sideBlend:value==='side'?1:0,roll:value==='side'?Math.PI/2:0};
                from.roll??=0;from.targetX??=5;from.targetY??=5;from.sideBlend??=0;
                const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                this.ui.cameraPreset=value;
                if(immediate||reduced){this.ui.camera3d=target;}
                else{
                    const began=performance.now(),duration=650;
                    const tick=now=>{
                        const t=Math.min(1,(now-began)/duration),ease=t*t*(3-2*t);
                        this.ui.camera3d=Object.fromEntries(Object.keys(target).map(key=>[key,from[key]+(target[key]-from[key])*ease]));
                        this._renderCurrent();
                        if(this.cameraOverlay)this.cameraOverlay.style.opacity=String(1-ease);
                        if(t<1)this.cameraTransition=requestAnimationFrame(tick);
                        else{this.cameraOverlay?.remove();this.cameraOverlay=null;}
                    };
                    this.cameraTransition=requestAnimationFrame(tick);
                }
                document.querySelectorAll('[data-camera-view]').forEach(button=>{
                    const active=button.dataset.cameraView===value;
                    button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
                });
                const url=new URL(window.location.href);url.searchParams.set('pc-camera-view',value);
                window.history.replaceState(null,'',url);
                this._renderCurrent();
            };
            document.querySelectorAll('[data-camera-view]').forEach(button=>button.addEventListener('click',()=>setCameraView(button.dataset.cameraView)));
            const initialCamera=new URLSearchParams(window.location.search).get('pc-camera-view');
            if(['orbit','side','top'].includes(initialCamera))setCameraView(initialCamera,true);
            document.getElementById('pc-dimension').addEventListener('change',event=>{this._cancelTeachingMotion();this.ui.view3d=!['2d','projection'].includes(event.target.value);this.ui.projectionView=event.target.value==='projection';this.ui.weightSpace=event.target.value==='weights';this.ui.construction=event.target.value==='construction';this.ui.sharedBox=['shared-box','shared-score'].includes(event.target.value);this.ui.sharedScore=event.target.value==='shared-score';this._renderCurrent();});
            document.querySelectorAll('.pc-section-toggle').forEach(button=>{
                button.addEventListener('click',()=>{
                    this._cancelTeachingMotion();
                    const expanded=button.getAttribute('aria-expanded')!=='true';
                    button.setAttribute('aria-expanded',String(expanded));
                    document.getElementById(button.getAttribute('aria-controls')).hidden=!expanded;
                    button.querySelector('.pc-section-chevron').textContent=expanded?'▾':'▸';
                    if(expanded && button.getAttribute('aria-controls')==='perceptron-sample-values') this._updateTeaching(this.playback.getCurrentStep());
                });
            });
            window.addEventListener('resize',()=>this._cancelTeachingMotion());
            window.addEventListener('scroll',()=>this._cancelTeachingMotion(),{passive:true});
            document.getElementById('pc-view-select').addEventListener('change',event=>{
                this._cancelTeachingMotion();
                ['diagram','code','matrix'].forEach(name=>{
                    document.getElementById('pc-'+name+'-view').hidden=name!==event.target.value;
                });
            });
            document.getElementById('teaching-next').addEventListener('click',()=>{
                const kind=document.getElementById('teaching-step').value;
                if(kind==='phase'){this.playback.pause();this.playback.stepForward();this._showMath();}
                else this._advance(kind);
            });
            document.getElementById('new-data').addEventListener('click', () => this._resetTraining({newData:true}));
            ['sample', 'mistake', 'epoch'].forEach(kind => {
                document.getElementById('next-' + kind).addEventListener('click', () => this._advance(kind));
            });
            ['weight-x', 'weight-y', 'weight-bias'].forEach((id, index) => {
                document.getElementById(id).addEventListener('change', e => {
                    const value = Number(e.target.value);
                    if (!e.target.value || !Number.isFinite(value) || Math.abs(value) > 100) {
                        this._updateTeaching(this.playback.getCurrentStep()); return;
                    }
                    const params = this._currentParameters();
                    if (index === 2) params.bias = value; else params.weights[index] = value;
                    this.model.weights = params.weights; this.model.bias = params.bias;
                    this._resetTraining(); if (e.isTrusted) this._showMath();
                });
            });
            const canvas = this.ui.canvas;
            const location = e => {
                const r = canvas.getBoundingClientRect();
                return {x: FEATURE_SCALE*clamp(((e.clientX-r.left)/r.width*CANVAS_WIDTH-PLOT.x)/PLOT.width,0,1), y: FEATURE_SCALE*clamp(1-((e.clientY-r.top)/r.height*CANVAS_HEIGHT-PLOT.y)/PLOT.height,0,1)};
            };
            let drag = null;
            canvas.addEventListener('pointerdown', e => {
                if (e.button !== 0) return;
                this.playback.pause(); cancelAnimationFrame(this.boundaryAnimation); this._cancelTeachingMotion();
                const rect=canvas.getBoundingClientRect();
                const px=(e.clientX-rect.left)/rect.width*CANVAS_WIDTH,py=(e.clientY-rect.top)/rect.height*CANVAS_HEIGHT;
                if(px<PLOT.x||px>PLOT.x+PLOT.width||py<PLOT.y||py>PLOT.y+PLOT.height)return;
                if(this.ui.projectionView){
                    const nearest=this.dataset.points.map(point=>({point,p:this.ui.projectionToCanvas(point.x,point.y)})).sort((a,b)=>Math.hypot(a.p.x-px,a.p.y-py)-Math.hypot(b.p.x-px,b.p.y-py))[0];
                    if(nearest&&Math.hypot(nearest.p.x-px,nearest.p.y-py)<18){this.selectedPoint=nearest.point;this._renderCurrent();this._updateTeaching(this.playback.getCurrentStep());}return;
                }
                if(this.ui.view3d&&this.ui.sharedBox){
                    const hit=(this.ui.weightHandles||[]).map(h=>({...h,distance:Math.hypot(h.p.x-px,h.p.y-py)})).sort((a,b)=>a.distance-b.distance)[0];
                    if(hit&&hit.distance<12&&Math.hypot(hit.dx,hit.dy)>.1){
                        drag={weight:true,handle:hit,px,py,params:this._currentParameters(),moved:false};
                        this.ui.weightDragExtent=hit.extent;this.ui.weightDragScale=hit.scale;
                        canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';return;
                    }
                }
                if(this.ui.view3d){
                    drag={camera:true,startX:e.clientX,startY:e.clientY,initial:{...this.ui.camera3d},pan:e.shiftKey,moved:false,px,py};
                    canvas.setPointerCapture(e.pointerId);return;
                }
                const p = location(e), params = this._currentParameters();
                const bounds = canvas.getBoundingClientRect();
                const r = {width:bounds.width*PLOT.width/CANVAS_WIDTH/FEATURE_SCALE,height:bounds.height*PLOT.height/CANVAS_HEIGHT/FEATURE_SCALE};
                const nearest = this.dataset.points.reduce((best, point) => {
                    const distance = Math.hypot((point.x-p.x)*r.width,(point.y-p.y)*r.height);
                    return distance < best.distance ? {point,distance} : best;
                }, {point:null,distance:14});
                const mode = document.getElementById('edit-mode').value;
                const handles=this.ui._boundaryHandles(params.weights,params.bias);
                const nearHandle=h=>h && Math.hypot((h.x-p.x)*r.width,(h.y-p.y)*r.height)<16;
                const rotateHandle=nearHandle(handles?.rotate), moveHandle=nearHandle(handles?.center);
                if (mode.startsWith('add')) {
                    if (this.dataset.points.length >= 200) {this._setStatus('Limit: 200 points'); return;}
                    this.dataset.points.push({...p,classLabel:Number(mode.slice(-1))});
                    this._resetTraining(); this.selectedPoint = this.dataset.points.at(-1);
                } else if (nearest.point && mode !== 'rotate' && !rotateHandle && !moveHandle) {
                    if (mode === 'relabel') {
                        nearest.point.classLabel = 1-nearest.point.classLabel;
                        this._resetTraining();
                    }
                    this.selectedPoint = nearest.point;
                } else if (mode === 'inspect' || mode === 'rotate') {
                    const [wx,wy] = params.weights, magnitude = Math.hypot(wx,wy);
                    const distance = Math.abs(wx*p.x+wy*p.y+params.bias)/Math.hypot(wx/r.width,wy/r.height);
                    if (magnitude > 1e-8 && (distance < 16 || e.shiftKey || mode === 'rotate' || rotateHandle || moveHandle)) {
                        const center = {x:FEATURE_SCALE/2,y:FEATURE_SCALE/2};
                        const offset = (wx*center.x+wy*center.y+params.bias)/(magnitude*magnitude);
                        const pivot = handles?.center || {x:center.x-wx*offset,y:center.y-wy*offset};
                        drag = {p,params,pivot,rotate:e.shiftKey || mode === 'rotate' || rotateHandle, moved:false};
                        canvas.setPointerCapture(e.pointerId);
                    }
                }
                this._renderCurrent(); this._updateTeaching(this.playback.getCurrentStep()); this._showMath();
            });
            canvas.addEventListener('pointermove', e => {
                if (!drag){if(this.ui.view3d&&this.ui.sharedBox){const r=canvas.getBoundingClientRect(),px=(e.clientX-r.left)/r.width*CANVAS_WIDTH,py=(e.clientY-r.top)/r.height*CANVAS_HEIGHT;canvas.style.cursor=(this.ui.weightHandles||[]).some(h=>Math.hypot(h.p.x-px,h.p.y-py)<12)?'grab':'default';}return;}
                if(drag.weight){
                    const r=canvas.getBoundingClientRect(),px=(e.clientX-r.left)/r.width*CANVAS_WIDTH,py=(e.clientY-r.top)/r.height*CANVAS_HEIGHT,h=drag.handle;
                    const delta=((px-drag.px)*h.dx+(py-drag.py)*h.dy)/(h.dx*h.dx+h.dy*h.dy);
                    const values=[...drag.params.weights,drag.params.bias];values[h.i]=clamp(values[h.i]+delta,-100,100);
                    if(!drag.moved){this.playback.load([]);this.steps=[];drag.moved=true;}
                    this.model.weights=values.slice(0,2);this.model.bias=values[2];this._renderCurrent();this._updateTeaching(null);return;
                }
                if(drag.camera){
                    const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY,c=this.ui.camera3d;
                    if(Math.hypot(dx,dy)>3)drag.moved=true;
                    if(drag.pan){const r=canvas.getBoundingClientRect();c.panX=drag.initial.panX+dx*CANVAS_WIDTH/r.width;c.panY=drag.initial.panY+dy*CANVAS_HEIGHT/r.height;}
                    else if(this.ui.cameraPreset==='side'){c.yaw=drag.initial.yaw+dx*.008;}
                    else if(this.ui.cameraPreset!=='top') {c.yaw=drag.initial.yaw+dx*.008;c.pitch=drag.initial.pitch+dy*.008;}
                    this._renderCurrent();return;
                }
                const p = location(e), {params,pivot} = drag;
                let weights = [...params.weights], bias;
                if (drag.rotate) {
                    const a = Math.atan2(drag.p.y-pivot.y,drag.p.x-pivot.x);
                    const angle = Math.atan2(p.y-pivot.y,p.x-pivot.x)-a;
                    const c = Math.cos(angle), s = Math.sin(angle);
                    weights = [params.weights[0]*c-params.weights[1]*s,params.weights[0]*s+params.weights[1]*c];
                    bias = -weights[0]*pivot.x-weights[1]*pivot.y;
                } else bias = params.bias-weights[0]*(p.x-drag.p.x)-weights[1]*(p.y-drag.p.y);
                // Invalidate playback once; rebuilding the training trace waits until release.
                if (!drag.moved) {this.playback.load([]); this.steps=[]; drag.moved=true;}
                this.model.weights=weights; this.model.bias=bias;
                this._renderCurrent(); this._updateTeaching(null);
            });
            const release = e => {
                // Keep the axis scale after release so the marker stays where it was dropped.
                if(drag?.weight){canvas.style.cursor='default';}
                if(drag?.camera){
                    if(!drag.moved && e.type==='pointerup' && !this.ui.weightSpace){
                        const nearest=this.dataset.points.map(point=>({point,p:this.ui.project3d(point.x,point.y)})).sort((a,b)=>Math.hypot(a.p.x-drag.px,a.p.y-drag.py)-Math.hypot(b.p.x-drag.px,b.p.y-drag.py))[0];
                        if(nearest && Math.hypot(nearest.p.x-drag.px,nearest.p.y-drag.py)<18){this.selectedPoint=nearest.point;this._renderCurrent();this._updateTeaching(this.playback.getCurrentStep());}
                    }
                } else if(drag?.moved)this._resetTraining();
                drag=null;
            };
            canvas.addEventListener('wheel',e=>{if(!this.ui.view3d)return;e.preventDefault();this._cancelTeachingMotion();const unit=e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1;this.ui.camera3d.zoom=Math.max(.3,Math.min(5,this.ui.camera3d.zoom*Math.exp(-e.deltaY*unit*.001)));this._renderCurrent();},{passive:false});
            canvas.addEventListener('dblclick',()=>{if(this.ui.view3d){this.ui.camera3d=null;this.ui.weightDragExtent=undefined;this.ui.weightDragScale=undefined;this._renderCurrent();}});
            canvas.addEventListener('pointerup', release);
            canvas.addEventListener('pointercancel', release);
            canvas.addEventListener('lostpointercapture', release);
        }

        _advance(kind) {
            this.playback.pause(); this._showMath();
            const current = this.playback.currentStepIndex;
            const epoch = this.steps[current]?.epoch || 1;
            let target = -1;
            for (let i=current+1; i<this.steps.length; i++) {
                const s = this.steps[i];
                if ((kind==='sample' && s.phase==='redraw') ||
                    (kind==='mistake' && s.phase==='prediction' && !s.correct) ||
                    (kind==='epoch' && s.phase==='redraw' && s.sampleIndex===s.totalSamples &&
                     (s.epoch===epoch || s.epoch===epoch+1))) {target=i;break;}
            }
            if (target<0) target=this.steps.length-1;
            if (target>=0) this.playback.goToStep(target);
            if (target===this.steps.length-1) this._onPlaybackFinished();
        }

        _animateUpdate(step) {
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            const start=performance.now();
            const tick = now => {
                if (this.playback.getCurrentStep() !== step || this.selectedPoint) return;
                const t=Math.min(1,(now-start)/(650*Math.max(.4,(11-this.playback.speed)/5))), eased=t*t*(3-2*t);
                const weights=step.before.weights.map((w,i)=>w+(step.after.weights[i]-w)*eased);
                const bias=step.before.bias+(step.after.bias-step.before.bias)*eased;
                this.ui.render({points:this.dataset.points,weights,bias,previous:step.before,
                    currentPoint:step.point,misclassifiedSet:this._computeMisclassified(weights,bias),...this.state});
                this._updateTeaching(step,t<1?{weights,bias}:null);
                if(t<1)this.boundaryAnimation=requestAnimationFrame(tick);
            };
            tick(start);
        }

        _updateTeaching(step, animatedParams=null) {
            const params=animatedParams || this._currentParameters(), point=this.selectedPoint || step?.point || this.dataset.points[0];
            if (!point) return;
            const inspecting=!!this.selectedPoint || !step;
            const before=inspecting?params:step.before;
            const n=v=>formatNumber(v,2);
            const activation=before.weights[0]*point.x+before.weights[1]*point.y+before.bias;
            const predicted=activation>=0?1:0, target=toTarget(point.classLabel);
            const error=target-predicted, eta=this.model.learningRate;
            const delta=[eta*error*point.x,eta*error*point.y], db=eta*error;
            const expanded=document.querySelector('#perceptron-live-math details')?.open;
            const f=(title,body,css='')=>`<section class="perceptron-math-step ${css}"><h4>${title}</h4><div>${body}</div></section>`;
            const x=`<span class="pc-input" style="color:${this.ui.classColors[point.classLabel]}">[${n(point.x)}, ${n(point.y)}]</span>`;
            const w=`<span class="pc-weight">[${before.weights.map(n).join(', ')}]</span>`;
            const phase=inspecting?'inspect':step.phase;
            const revealPrediction=phase!=='activation';
            const revealUpdate=inspecting || phase==='update' || phase==='redraw';
            if(!animatedParams) {
                const index=this.dataset.points.indexOf(point), panel=document.getElementById('perceptron-sample-values');
                document.getElementById('pc-point-counter').textContent=`Point ${index+1} / ${this.dataset.points.length}`;
                panel.innerHTML=`<div class="pc-data-scroll"><table class="table table-condensed pc-data-table"><thead><tr><th scope="col">Point</th><th scope="col">x₀</th><th scope="col">x₁</th><th scope="col">x₂</th><th scope="col">y</th></tr></thead><tbody>${this.dataset.points.map((p,i)=>`<tr ${p===point?'class="pc-data-current" aria-current="true"':''}><th scope="row"><span class="pc-table-point-dot" style="background:${this.ui.classColors[p.classLabel]};visibility:${p===point?'visible':'hidden'}" aria-hidden="true"></span>${i+1}</th><td>1</td><td>${p===point?`<strong>${n(p.x)}</strong>`:n(p.x)}</td><td>${p===point?`<strong>${n(p.y)}</strong>`:n(p.y)}</td><td>${p.classLabel}</td></tr>`).join('')}</tbody></table></div>`;
                const row=panel.querySelector('.pc-data-current'), scroller=panel.querySelector('.pc-data-scroll');
                if(row) requestAnimationFrame(()=>{scroller.scrollTop=Math.max(0,(index-2)*row.getBoundingClientRect().height);});
            }
            this._updateWalkthrough({phase,before,params,point,activation,predicted,target,error,eta,delta,db,inspecting,animating:!!animatedParams});
            let html='';
            html+=`<details ${expanded?'open':''}><summary>Numerical working</summary>`;
            html+=f('Inputs and weights',`x = ${x}<br>w = ${w} · b = <span class="pc-weight">${n(before.bias)}</span>`);
            html+=f('Activation',`z = w·x + b<br>(${n(before.weights[0])} × ${n(point.x)}) + (${n(before.weights[1])} × ${n(point.y)}) + ${n(before.bias)} = <strong>${n(activation)}</strong>`);
            if(revealPrediction) html+=f('Prediction',`z ≥ 0 → 1; otherwise 0<br>ŷ = ${predicted} (class ${toLabel(predicted)}) · y = ${target} (class ${point.classLabel})<br><strong>${error?(inspecting || ['activation','prediction'].includes(step.phase)?'Mistake: update needed':animatedParams?'Applying correction…':'Correction applied'):'Correct: weights stay unchanged'}</strong>`);
            if(revealUpdate) html+=f(inspecting?'Proposed correction':'Learning update',`η = ${n(eta)} · (y − ŷ) = ${error}<br>Δw = η(y − ŷ)x = ${n(eta)} × ${error} × ${x}<br>Δw = [${delta.map(n).join(', ')}]<br>Δb = ${n(eta)} × ${error} = ${n(db)}<br>w′ = [${before.weights.map((v,i)=>n(v+delta[i])).join(', ')}]<br>b′ = ${n(before.bias+db)}`,'pc-update');
            html+='</details><p class="note">Values are rounded; training uses full precision.</p>';
            document.getElementById('perceptron-live-math').innerHTML=html;
            const mistakes=this._computeMisclassified(params.weights,params.bias).size;
            document.getElementById('perceptron-live-status').textContent=`${this.dataset.points.length-mistakes}/${this.dataset.points.length} correct · ${mistakes} misclassified · ${step?`Epoch ${step.epoch}, ${step.phase}`:'Ready to train'}`;
            document.getElementById('metric-weights').textContent=`[${params.weights.map(n).join(', ')}]`;
            document.getElementById('metric-bias').textContent=n(params.bias);
            document.getElementById('metric-accuracy').textContent=`${Math.round(100*(1-mistakes/this.dataset.points.length))}%`;
            ['weight-x','weight-y','weight-bias'].forEach((id,i)=>{document.getElementById(id).value=i===2?params.bias:params.weights[i];});
            ['sample','mistake','epoch'].forEach(kind=>{document.getElementById('next-'+kind).disabled=!this.steps.length || this.playback.currentStepIndex>=this.steps.length-1;});
            document.getElementById('teaching-next').disabled=!this.steps.length || this.playback.currentStepIndex>=this.steps.length-1;
            this._drawHistory();
        }

        _updateWalkthrough(v) {
            const {phase,before,params,point,activation,predicted,target,error,eta,delta,db,inspecting,animating}=v;
            const key=JSON.stringify([phase,before,point,eta,target,error]);
            if(this.walkthroughKey===key) {
                if(phase==='update') {
                    const values={weight1:formatNumber(params.weights[0],2),weight2:formatNumber(params.weights[1],2),bias:formatNumber(params.bias,2)};
                    Object.entries(values).forEach(([name,value])=>{
                        const element=document.querySelector?.(`[data-motion="${name}"]`);if(element)element.querySelector('.pc-number').textContent=value;
                    });
                }
                if(phase==='update' && !animating) document.getElementById('pc-walkthrough-caption').textContent=error?'Correction applied. Continue to see the new boundary.':'Correct prediction. No weight update.';
                if(animating) document.getElementById('pc-walkthrough-caption').textContent=`Applying correction: w = [${params.weights.map(x=>formatNumber(x,2)).join(', ')}], b = ${formatNumber(params.bias,2)}.`;
                return;
            }
            this.walkthroughKey=key;
            const n=value=>formatNumber(value,2);
            const number=value=>`<mn>${value}</mn>`;
            const weightSymbol=i=>`<msub><mi>w</mi><mn>${i}</mn></msub>`;
            document.getElementById('pc-weight-equations').innerHTML=`${[before.bias,...before.weights].map((weight,i)=>{
                const input=[1,point.x,point.y][i], change=eta*error*input;
                return `<div class="pc-weight-equation"><math display="block"><mtable columnalign="right left" columnspacing="0.5em" rowspacing="0.5em">
                    <mtr><mtd><msup>${weightSymbol(i)}<mo>′</mo></msup></mtd><mtd><mo>=</mo>${number(n(weight))}<mo>+</mo>${number(eta)}<mo>×</mo><mo>(</mo>${number(target)}<mo>−</mo>${number(predicted)}<mo>)</mo><mo>×</mo>${number(i===0?'1':n(input))}</mtd></mtr>
                    <mtr><mtd></mtd><mtd><mo>=</mo>${number(n(weight))}<mo>+</mo><mo>(</mo>${number(n(change))}<mo>)</mo><mo>=</mo><mstyle class="pc-equation-result">${number(n(weight+change))}</mstyle></mtd></mtr>
                </mtable></math></div>`;
            }).join('')}`;
            const stage=inspecting?-1:STEP_PHASES.indexOf(phase);
            const revealed=inspecting||stage>=1;
            const current=name=>phase===name?'pc-node-active':'';
            const stepExtent=Math.max(0.01,Math.abs(activation)*1.5);
            const stepX=313+34*Math.max(-1,Math.min(1,activation/stepExtent));
            const stepY=activation>=0?105:130;
            const sum=n(activation), output=revealed?(predicted===1?'1':'0'):'?';
            document.getElementById('pc-diagram-view').innerHTML=`<svg class="pc-neuron" viewBox="0 0 530 280" role="img" aria-label="Inputs x0 = 1, x1 and x2 multiply bias, w1 and w2 and feed a weighted sum, then a threshold produces the prediction. ${phase}">
                <defs><marker id="pc-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="currentColor"/></marker></defs>
                <g class="pc-wires ${current('activation')}" marker-end="url(#pc-arrowhead)">
                    <path d="M144.4 58.9 L162.4 79.7" marker-end="none"/><path d="M171.6 90.3 L189.6 111.1"/>
                    <path d="M153 130 L160 130" marker-end="none"/><path d="M174 130 L181 130"/>
                    <path d="M144.4 201.1 L162.4 180.3" marker-end="none"/><path d="M171.6 169.7 L189.6 148.9"/>
                    <path d="M231 130 L263 130"/><path d="M363 130 L385 111"/><path d="M363 130 L385 149"/>
                </g>
                ${[1,point.x,point.y].map((value,i)=>{
                    const y=40+i*90,weight=[before.bias,...before.weights][i];
                    return `<g data-motion="input${i}" class="pc-node"><circle cx="43" cy="${y}" r="25"/><text class="pc-number" x="43" y="${y+4}">${i===0?'1':n(value)}</text><text x="43" y="${y+41}">x${['₀','₁','₂'][i]}</text></g>
                    <g class="pc-wires"><path d="M68 ${y} H78 M92 ${y} H103"/></g>
                    <text x="85" y="${y}" dominant-baseline="central" aria-label="times">×</text>
                    <g data-motion="${i===0?'bias':'weight'+i}" class="pc-node"><circle cx="128" cy="${y}" r="25" style="stroke:${i===0?this.ui.vectorColor:this.ui.classColors[i-1]};fill:color-mix(in srgb, ${i===0?this.ui.vectorColor:this.ui.classColors[i-1]} 12%, var(--viz-canvas-bg));stroke-width:2"/><text class="pc-number" x="128" y="${y+4}">${n(weight)}</text><text x="128" y="${y+41}">w${['₀','₁','₂'][i]}</text></g>`;
                }).join('')}
                <text x="167" y="85" dominant-baseline="central">+</text><text x="167" y="130" dominant-baseline="central">+</text><text x="167" y="175" dominant-baseline="central">+</text>
                <g data-motion="sum" class="pc-node ${current('activation')}"><circle cx="206" cy="130" r="25" style="stroke:#9563c6;stroke-width:2;fill:color-mix(in srgb, #9563c6 14%, var(--viz-canvas-bg))"/><text class="pc-number" x="206" y="134">${sum}</text><text x="206" y="171">z</text></g>
                <g data-motion="threshold" class="pc-node ${current('prediction')}">
                    <rect x="264" y="80" width="98" height="100" rx="6"/>
                    <path d="M270 80 H313 V180 H270 Q264 180 264 174 V86 Q264 80 270 80 Z" style="fill:${this.ui.classColors[0]};fill-opacity:.10;stroke:none"/>
                    <path d="M313 80 H356 Q362 80 362 86 V174 Q362 180 356 180 H313 Z" style="fill:${this.ui.classColors[1]};fill-opacity:.10;stroke:none"/>
                    <path class="pc-step-axis" d="M274 130 H352 M313 91 V169" style="stroke:var(--viz-text-color, #555);stroke-opacity:.8;stroke-width:1.4"/>
                    <path class="pc-threshold" d="M279 130 H313 M313 105 H347"/>
                    <circle class="pc-step-open" cx="313" cy="130" r="2"/><circle class="pc-step-closed" cx="313" cy="105" r="2"/>
                    <text class="pc-step-label" x="303" y="100">1</text><text class="pc-step-label" x="303" y="141">0</text>
                    <text class="pc-step-label" x="349" y="141">z</text>
                    <path data-motion="step-trace" class="pc-step-trace" d="M${stepX} 130 V${stepY} H313" opacity="${revealed?1:0}"/>
                    <circle class="pc-step-input" cx="${stepX}" cy="130" r="2.7"/>
                    <circle data-motion="step-dot" class="pc-step-result" cx="${stepX}" cy="${stepY}" r="3" opacity="${revealed?1:0}"/>
                    <text class="pc-number" x="313" y="197">step(z)</text>
                </g>
                <g data-motion="output" aria-label="Prediction ${output}">
                    ${[0,1].map(value=>`<g class="pc-node ${revealed&&predicted===value?'pc-output-selected':''}"><circle cx="402" cy="${160-value*60}" r="20" style="stroke:${this.ui.classColors[value]};stroke-width:${revealed&&predicted===value?3:1};fill:color-mix(in srgb, ${this.ui.classColors[value]} ${revealed&&predicted===value?22:4}%, var(--viz-canvas-bg))"/><text x="402" y="${165-value*60}">${value}</text></g>`).join('')}
                    <text class="pc-number" x="402" y="202">ŷ</text>
                </g>
                <g class="pc-node pc-output-selected" aria-label="Ground truth ${target}">
                    <circle cx="493" cy="130" r="20" style="stroke:${this.ui.classColors[target]};stroke-width:2;fill:color-mix(in srgb, ${this.ui.classColors[target]} 22%, var(--viz-canvas-bg))"/><text x="493" y="135">${target}</text>
                    <text class="pc-number" x="493" y="172">y</text>
                </g>
                ${revealed?(()=>{
                    const fromY=160-predicted*60,toY=130;
                    const dx=91,dy=toY-fromY,length=Math.hypot(dx,dy),ux=dx/length,uy=dy/length;
                    const mx=447.5,my=(fromY+toY)/2;
                    return `<g class="pc-comparison ${error?'pc-comparison-wrong':''}"><path d="M${402+ux*20} ${fromY+uy*20} L${mx-ux*10} ${my-uy*10} M${mx+ux*10} ${my+uy*10} L${493-ux*20} ${toY-uy*20}"/><text x="${mx}" y="${my}" dominant-baseline="central">${error?'≠':'='}</text></g>`;
                })():''}
                <text class="pc-number ${revealed?(error?'pc-match-wrong':'pc-match-correct'):''}" x="448" y="226">${revealed?(error?'Mismatch':'Match'):'Awaiting prediction'}</text>
            </svg>`;
            const matrixExpression=(inputs,weights,y)=>`<g transform="translate(0 ${y})">
                <text x="26" y="52">ŷ =</text><text x="78" y="52">step</text>
                <path d="M111 10 Q96 50 111 90 M407 10 Q422 50 407 90" class="pc-threshold"/>
                <path d="M130 34 H124 V66 H130 M267 34 H273 V66 H267 M306 10 H300 V90 H306 M383 10 H389 V90 H383" class="pc-threshold"/>
                ${inputs.map((value,i)=>`<text class="pc-number" x="${148+i*49}" y="54">${value}</text>`).join('')}
                <text x="286" y="54">×</text>
                ${weights.map((value,i)=>`<text class="pc-number" x="344" y="${27+i*27}">${value}</text>`).join('')}
            </g>`;
            document.getElementById('pc-matrix-view').innerHTML=`<svg class="pc-neuron" viewBox="0 0 440 270" role="img" aria-label="Prediction equals step of the input row vector times the weight column vector. Inputs 1, ${n(point.x)}, ${n(point.y)}; weights ${n(before.bias)}, ${n(before.weights[0])}, ${n(before.weights[1])}. Weighted sum ${sum}. Prediction ${output}.">
                ${matrixExpression(['x₀','x₁','x₂'],['w₀','w₁','w₂'],0)}
                ${matrixExpression(['1',n(point.x),n(point.y)],[n(before.bias),...before.weights.map(n)],105)}
                <text x="220" y="238">ŷ = step(${sum}) = ${output}</text>
            </svg>`;
            const rows=[
                ['For each epoch:',false],
                ['  For each point (x, y):',stage===0],
                ['    z ← w₀x₀ + w₁x₁ + w₂x₂  (x₀ = 1)',stage===0],
                ['    ŷ ← 1 if z ≥ 0, else 0',stage===1],
                ['    if ŷ ≠ y:',stage===2],
                ['      w ← w + η(y − ŷ)x',stage===2&&!!error],
                ['      w₀ ← w₀ + η(y − ŷ)x₀',stage===2&&!!error],
                ['    redraw boundary and count mistakes',stage===3],
                ['  stop if this epoch made no mistakes',false]
            ];
            document.getElementById('pc-code-view').innerHTML=`<ol class="pc-pseudocode">${rows.map(([line,active])=>`<li class="${active?'active':''}" ${active?'aria-current="step"':''}><code>${line}</code></li>`).join('')}</ol>`;
            const descriptions={activation:`Weighted sum: ${n(before.weights[0])} × ${n(point.x)} + ${n(before.weights[1])} × ${n(point.y)} + ${n(before.bias)} = ${sum}.`,prediction:`${sum} ${activation>=0?'≥':'<'} 0 → prediction ${output}. Target ${target===1?'1':'0'}: ${error?'a mistake':'correct'}.`,update:error?`${animating?'Applying':'Applied'} correction with η = ${n(eta)}. Weights [${params.weights.map(n).join(', ')}], bias ${n(params.bias)}.`:'Correct prediction. Skip the weight and bias updates.',redraw:'The boundary now reflects these weights. Continue to the next point.'};
            document.getElementById('pc-walkthrough-caption').textContent=inspecting?'This point’s values feed the perceptron. Step by Calculation to follow the weighted sum, prediction, and update.':descriptions[phase];
            if(this.ui) this._queueTeachingMotion(v);
        }

        _cancelTeachingMotion() {
            (this.motionTimers||[]).forEach(clearTimeout);
            (this.motionAnimations||[]).forEach(animation=>animation.cancel());
            (this.motionElements||[]).forEach(element=>element.remove());
            (this.motionResets||[]).forEach(reset=>reset());
            this.motionResets=[];
            this.motionTimers=[];this.motionAnimations=[];this.motionElements=[];
        }

        _queueTeachingMotion(v) {
            this._cancelTeachingMotion();
            // Manual inspection and weight edits update values without replaying the lesson.
            if(v.inspecting || window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
            const scale=Math.max(.4,(11-(this.playback?.speed||6))/5);
            const later=(delay,fn)=>this.motionTimers.push(setTimeout(fn,delay*scale));
            const animate=(element,frames,duration=450,delay=0)=>{
                if(!element)return;
                const animation=element.animate(frames,{duration:duration*scale,delay:delay*scale,easing:'cubic-bezier(.22,.7,.25,1)',fill:'none'});
                this.motionAnimations.push(animation);return animation;
            };
            const revealLater=(element,delay)=>{
                if(!element)return;
                const text=element.textContent; element.textContent='…';
                const restore=()=>{element.textContent=text;};this.motionResets.push(restore);later(delay,restore);
            };
            const pulse=element=>animate(element,[{opacity:.35,filter:'brightness(1.4)'},{opacity:1,filter:'brightness(1)'},{opacity:1}],500);
            const center=element=>{const r=element.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};};
            const fly=(text,from,to,duration=450)=>{
                const pill=document.createElement('span');pill.className='pc-flying-value';pill.textContent=text; pill.setAttribute('aria-hidden','true');
                pill.style.left=from.x+'px';pill.style.top=from.y+'px';document.body.appendChild(pill);this.motionElements.push(pill);
                const dx=to.x-from.x,dy=to.y-from.y;
                const animation=animate(pill,[{transform:'translate(-50%,-50%) scale(.8)',opacity:0},{transform:`translate(calc(-50% + ${dx*.35}px),calc(-50% + ${dy*.35-18}px)) scale(1.08)`,opacity:1,offset:.4},{transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(1)`,opacity:0}],duration);
                animation.finished.then(()=>pill.remove()).catch(()=>{});
            };
            later(0,()=>{
                const panel=document.getElementById('perceptron-sample-values');
                if(!panel.getClientRects().length)return;
                const values=panel.querySelectorAll('strong');
                const diagram=document.getElementById('pc-diagram-view');
                const svg=diagram.querySelector('svg');
                const node=name=>diagram.querySelector(`[data-motion="${name}"]`);
                const point=(x,y)=>{const r=svg.getBoundingClientRect();return {x:r.x+x/530*r.width,y:r.y+y/280*r.height};};
                const newPoint=this.motionPoint!==v.point;
                this.motionPoint=v.point;
                if(newPoint){
                    const r=this.ui.canvas.getBoundingClientRect(),p=this.ui.projectionView?this.ui.projectionToCanvas(v.point.x,v.point.y):this.ui.view3d?this.ui.project3d(v.point.x,v.point.y):this.ui.dataToCanvas(v.point.x,v.point.y);
                    const origin={x:r.x+p.x/CANVAS_WIDTH*r.width,y:r.y+p.y/CANVAS_HEIGHT*r.height};
                    [v.point.x,v.point.y].forEach((value,i)=>fly(formatNumber(value,2),origin,center(values[i]),400));
                    values.forEach(element=>pulse(element));
                }
                if(diagram.hidden) {
                    document.querySelectorAll('.pc-pseudocode li.active').forEach(element=>animate(element,[{transform:'translateX(-8px)',opacity:.3},{transform:'translateX(0)',opacity:1}],500));
                    return;
                }
                if(v.phase==='activation'||v.inspecting||newPoint){
                    const delay=newPoint?400:0;
                    revealLater(node('sum').querySelector('.pc-number'),delay+900);
                    later(delay,()=>{
                        [v.point.x,v.point.y].forEach((value,i)=>fly(formatNumber(value,2),center(values[i]),point(43,i?220:130)));
                        pulse(node('input1'));pulse(node('input2'));
                    });
                    later(delay+450,()=>{
                        fly(formatNumber(v.point.x*v.before.weights[0],2),point(153,130),point(206,130));
                        fly(formatNumber(v.point.y*v.before.weights[1],2),point(144.4,201.1),point(206,130));
                        fly(formatNumber(v.before.bias,2),point(144.4,58.9),point(206,130));
                    });
                    later(delay+900,()=>pulse(node('sum')));
                } else if(v.phase==='prediction') {
                    const dot=node('step-dot'),trace=node('step-trace');
                    const x=Number(dot.getAttribute('cx')),y=Number(dot.getAttribute('cy'));
                    fly(formatNumber(v.activation,2),point(206,130),point(x,130),300);
                    animate(dot,[{transform:`translateY(${130-y}px)`,opacity:0},{transform:`translateY(${130-y}px)`,opacity:1,offset:.35},{transform:'translateY(0)',opacity:1}],700);
                    animate(trace,[{strokeDasharray:'100',strokeDashoffset:100,opacity:0},{strokeDasharray:'100',strokeDashoffset:100,opacity:1,offset:.35},{strokeDasharray:'100',strokeDashoffset:0,opacity:1}],700);
                    later(700,()=>{fly(v.predicted===1?'1':'0',point(313,y),point(402,160-v.predicted*60),300);});
                    later(800,()=>pulse(node('output')));
                } else if(v.phase==='update') {
                    pulse(diagram.querySelector('.pc-learning-strip'));
                    if(v.error) {
                        [v.delta[0],v.delta[1],v.db].forEach((value,i)=>{
                            const target=node(['weight1','weight2','bias'][i]);
                            fly((value>=0?'+':'')+formatNumber(value,2),point(402,130),center(target),600);
                            later(600,()=>pulse(target));
                        });
                    } else pulse(node('output'));
                } else if(v.phase==='redraw') {
                    pulse(svg);pulse(document.getElementById('perceptron-live-status'));
                }
            });
        }

        _drawHistory() {
            const completed=(this.epochSummaries || []).filter(s=>s.globalStep<=this.playback.currentStepIndex);
            const max=Math.max(1,...completed.map(s=>s.mistakes));
            const x=e=>40+(e-1)*500/Math.max(1,this.epochs-1), y=m=>115-m/max*90;
            const svg=document.getElementById('perceptron-history');
            svg.style.display=completed.length?'block':'none';
            svg.innerHTML=`<path d="M40 20 V115 H540" fill="none" stroke="currentColor"/><text x="5" y="25">${max}</text><text x="20" y="118">0</text><text x="40" y="140">1</text><text x="475" y="140">Epoch ${this.epochs}</text>`+
                `<polyline points="${completed.map(s=>`${x(s.epoch)},${y(s.mistakes)}`).join(' ')}" fill="none" stroke="var(--perceptron-vector)" stroke-width="2"/>`+
                completed.map(s=>`<circle cx="${x(s.epoch)}" cy="${y(s.mistakes)}" r="3" fill="var(--perceptron-vector)"><title>Epoch ${s.epoch}: ${s.mistakes} mistakes</title></circle>`).join('');
            const last=completed.at(-1);
            document.getElementById('perceptron-history-caption').textContent=last?`Epoch ${last.epoch}: ${last.mistakes} training mistakes.${last.mistakes===0?' Converged: a full pass without an update.':last.epoch===this.epochs?' Epoch limit reached; convergence was not established.':''} Counts include mistakes made while weights were changing.`:'Complete an epoch to see its mistake count.';
        }

        _updateStepList(phase) {
            const ids = {
                activation: 'step-activation',
                prediction: 'step-prediction',
                update: 'step-update',
                redraw: 'step-redraw'
            };

            Object.values(ids).forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.remove('active');
            });

            if (phase && ids[phase]) {
                const activeEl = document.getElementById(ids[phase]);
                if (activeEl) activeEl.classList.add('active');
            }
        }

        _setStatus(text) {
            const statusEl = document.getElementById('metric-status');
            if (statusEl) statusEl.textContent = text;
        }
    }

    window.addEventListener('load', () => {
        clamp = VizLib.MathUtils.clamp;
        new PerceptronViz();
    });
})();
