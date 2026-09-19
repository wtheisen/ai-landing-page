const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/js/perceptron.js'),'utf8');
const context = {window:{addEventListener(){}}, Math, Set, clearTimeout};
vm.createContext(context);
vm.runInContext(source.replace("    window.addEventListener('load',", "    window.classes = {PerceptronModel, Trainer, UIRenderer, PerceptronViz};\n    window.addEventListener('load',"), context);
const {PerceptronModel,Trainer,UIRenderer,PerceptronViz} = context.window.classes;
test('phase snapshots and mistake markers agree with the displayed classifier',()=>{
 const model=new PerceptronModel(.1);
 const points=[{x:1,y:0,classLabel:0},{x:0,y:1,classLabel:1}];
 const steps=new Trainer(points,model,{epochs:2,shuffle:false}).generateSteps();
 for(const s of steps) {
  const wrong=points.map((p,i)=>((s.weights[0]*p.x+s.weights[1]*p.y+s.bias>=0?1:0)!==p.classLabel?i:-1)).filter(i=>i>=0);
  assert.deepEqual([...s.misclassifiedIndices],wrong);
  assert.equal(s.accuracy,1-wrong.length/points.length);
 }
 assert.equal(steps[0].weights[0],0);
 assert.equal(steps[2].weights[0],-.1);
 assert.equal(steps[2].bias,-.1);
 assert.equal(steps[0].before.weights[0],0);
});
test('separable points converge, XOR exhausts the epoch budget',()=>{
 const run=points=>new Trainer(points,new PerceptronModel(.1),{epochs:30,shuffle:false}).generateSteps();
 assert.equal(run([{x:0,y:0,classLabel:0},{x:1,y:1,classLabel:1}]).at(-1).mistakes,0);
 const xor=run([{x:0,y:0,classLabel:0},{x:1,y:1,classLabel:0},{x:0,y:1,classLabel:1},{x:1,y:0,classLabel:1}]);
 assert.equal(xor.at(-1).epoch,30);
 assert.ok(xor.at(-1).mistakes>0);
});
test('margin contours shift the score by one, not inverse weight norm',()=>{
 const ui=Object.create(UIRenderer.prototype);ui._lineForWeights=(w,b)=>b;
 assert.deepEqual(Array.from(ui._marginLines([3,4],2)),[3,1]);
});
test('teaching jumps pause at a mistake, complete a sample, then successive epochs',()=>{
 const steps=new Trainer([{x:0,y:0,classLabel:0},{x:1,y:1,classLabel:1}],new PerceptronModel(.1),{epochs:30,shuffle:false}).generateSteps();
 const controller=Object.create(PerceptronViz.prototype);
 controller.steps=steps; controller._showMath=()=>{};controller._onPlaybackFinished=()=>{};
 controller.playback={currentStepIndex:-1,pause(){},goToStep(i){this.currentStepIndex=i;}};
 controller._advance('mistake');assert.equal(steps[controller.playback.currentStepIndex].phase,'prediction');
 assert.equal(steps[controller.playback.currentStepIndex].correct,false);
 controller._advance('sample');assert.equal(steps[controller.playback.currentStepIndex].phase,'redraw');
 controller._advance('epoch');assert.equal(steps[controller.playback.currentStepIndex].epoch,1);
 controller._advance('epoch');assert.equal(steps[controller.playback.currentStepIndex].epoch,2);
});
test('reset and learning-rate changes preserve data and starting weights',()=>{
 const elements={
  'dataset-select':{value:'linear'}, 'init-select':{value:'random'},
  'lr-slider':{value:'0.2'}, 'epochs-value':{value:'2'}, 'shuffle-toggle':{checked:false}
 };
 context.document={getElementById:id=>elements[id]};
 context.window.matchMedia=()=>({matches:true});context.cancelAnimationFrame=()=>{};
 const controller=Object.create(PerceptronViz.prototype);
 const points=[{x:0,y:0,classLabel:0},{x:1,y:1,classLabel:1}];
 controller.dataset={points,loadDataset(){throw Error('Reset must not generate data');}};
 controller.model=new PerceptronModel(.1);controller.model.weights=[.3,-.4];controller.model.bias=.2;
 controller.initialized=true;controller.playback={pause(){},load(){}};
 for(const method of ['_renderCurrent','_updatePlaybackButtons','_updateMetrics','_updateStepList','_setStatus','_onStepChange','_updateTeaching'])controller[method]=()=>{};
 controller._resetTraining();
 assert.equal(controller.dataset.points,points);
 assert.deepEqual(controller.model.weights,[.3,-.4]);assert.equal(controller.model.bias,.2);
 assert.equal(controller.model.learningRate,.2);
});
test('boundary handles remain on the visible line, including corner crossings',()=>{
 const ui=Object.create(UIRenderer.prototype);
 for(const [weights,bias] of [[[1,1],-.1],[[1,0],-.5],[[0,1],-.5]]) {
  const handles=ui._boundaryHandles(weights,bias);
  assert.ok(handles);
  for(const point of Object.values(handles)) {
   assert.ok(point.x>=0&&point.x<=10&&point.y>=0&&point.y<=10);
   assert.ok(Math.abs(weights[0]*point.x+weights[1]*point.y+bias)<1e-9);
  }
 }
 assert.equal(ui._boundaryHandles([0,0],0),null);
});
test('walkthrough follows prediction and distinguishes skipped versus applied updates',()=>{
 const elements=Object.fromEntries(['pc-diagram-view','pc-code-view','pc-matrix-view','pc-weight-equations','pc-walkthrough-caption'].map(id=>[id,{}]));
 context.document={getElementById:id=>elements[id]};
 context.window.matchMedia=()=>({matches:true});
 const controller=Object.create(PerceptronViz.prototype);
 controller.ui={vectorColor:'#0f766e',classColors:['#ef1515','#3784bd']};
 const v={phase:'prediction',before:{weights:[1,1],bias:0},params:{weights:[1,1],bias:0},point:{x:.2,y:.3},activation:.5,predicted:1,target:1,error:0,eta:.1,delta:[0,0],db:0,inspecting:false,animating:false};
 controller._updateWalkthrough(v);
 assert.match(elements['pc-walkthrough-caption'].textContent,/correct/);
 assert.match(elements['pc-matrix-view'].innerHTML,/step\(0.50\) = 1/);
 assert.match(elements['pc-code-view'].innerHTML,/aria-current="step"><code>    ŷ/);
 controller._updateWalkthrough({...v,phase:'update'});
 assert.match(elements['pc-walkthrough-caption'].textContent,/Skip/);
 assert.doesNotMatch(elements['pc-code-view'].innerHTML,/aria-current="step"><code>      w/);
 controller._updateWalkthrough({...v,phase:'update',error:-1,target:0,delta:[-.02,-.03],db:-.1});
 assert.match(elements['pc-code-view'].innerHTML,/aria-current="step"><code>      w/);
 assert.match(elements['pc-walkthrough-caption'].textContent,/Applied correction/);
});
test('canceling teaching motion clears scheduled work and removes in-flight values',()=>{
 const controller=Object.create(PerceptronViz.prototype);let canceled=0,removed=0,cleared=0;
 context.clearTimeout=()=>cleared++;
 controller.motionTimers=[1,2];controller.motionAnimations=[{cancel(){canceled++;}}];controller.motionElements=[{remove(){removed++;}}];
 controller._cancelTeachingMotion();
 assert.equal(cleared,2);assert.equal(canceled,1);assert.equal(removed,1);
 assert.equal(controller.motionElements.length,0);assert.equal(controller.motionTimers.length,0);
});

test('teaching initialization crosses the data with five to ten mistakes',()=>{
 const points=Array.from({length:20},(_,i)=>({x:1+i*.4,y:1+i*.4+(i%2?1:-1),classLabel:i%2}));
 const controller=Object.create(PerceptronViz.prototype);controller.model=new PerceptronModel(.005);
 controller._initializeTeachingBoundary(points);
 const mistakes=points.filter(p=>controller.model.predict(p.x,p.y).label!==p.classLabel).length;
 assert.ok(mistakes>=5&&mistakes<=10);
 const center=points.reduce((c,p)=>({x:c.x+p.x/20,y:c.y+p.y/20}),{x:0,y:0});
 assert.ok(Math.abs(controller.model.activation(center.x,center.y))<1);
});
