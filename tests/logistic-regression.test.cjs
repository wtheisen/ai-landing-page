const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../static/js/logistic-regression.js'),'utf8');
const elements = new Map();
const element = id => {if(!elements.has(id)) elements.set(id,{value:'',textContent:'',style:{}});return elements.get(id);};
const context = {window:{},document:{getElementById:element},Math,clearTimeout};
vm.createContext(context);
vm.runInContext(source.replace("    if (window.VizLib?.CanvasUtils) init();", `
    window.math = {sigmoid, boundaryIntersections, projectGeometry, interpolateCamera,
        set(w,b,data){weights=[...w];bias=b;points=data;},
        loss:computeLoss,step:gradientStep,predict,
        params(){return {weights:[...weights],bias};},
        lastUpdate(){return lastUpdate;},
        edit:resetFromEditedWeights,reset:doReset,
        disableUI(){redrawGeometry=()=>{};updateMetrics=()=>{};updatePointSelector=()=>{};}
    };
    if (false) init();`).replace("    else window.addEventListener('vizlib-ready', init, {once:true});",''),context);
const api = context.window.math;
test('decision boundary is the same score-zero / probability-half contour',()=>{
    for(const [weights,bias] of [[[2,-3],.2],[[1,0],-.5],[[0,1],-.5],[[1,1],0]]) {
        api.set(weights,bias,[]);
        for(const p of api.boundaryIntersections()) assert.ok(Math.abs(api.predict(p.x,p.y)-.5)<1e-12);
    }
    assert.equal(api.boundaryIntersections([0,0],0).length,0);
    assert.equal(api.boundaryIntersections([1,1],0).length,1);
});
test('score-zero and probability-half project to the same reference plane',()=>{
    const camera={yaw:.65,pitch:.55,zoom:1.4,panX:15,panY:-20};
    for(const [x,y] of [[0,0],[.2,.8],[1,1]]) {
        const a=api.projectGeometry(x,y,0,camera,4,false),b=api.projectGeometry(x,y,.5,camera,4,true);
        assert.deepEqual(a,b);
    }
});
test('score handle screen derivative maps a drag back to the intended weight change',()=>{
    const camera={yaw:.65,pitch:.55,zoom:1,panX:0,panY:0};
    const p=api.projectGeometry(.8,0,-1.6,camera,2,false),unit=api.projectGeometry(.8,0,-.8,camera,2,false);
    const target=api.projectGeometry(.8,0,-1.6+3*.8,camera,2,false),dx=unit.x-p.x,dy=unit.y-p.y;
    const delta=((target.x-p.x)*dx+(target.y-p.y)*dy)/(dx*dx+dy*dy);
    assert.ok(Math.abs(delta-3)<1e-12);
});
test('large manually edited logits have finite, uncapped loss',()=>{
    api.set([100,100],100,[{x:1,y:1,classLabel:0}]);
    assert.equal(api.loss(),300);
});
test('training changes the displayed classifier and reset restores the edited start',()=>{
    api.disableUI();
    api.set([-2,2],.3,[{x:.1,y:.9,classLabel:1},{x:.9,y:.1,classLabel:0}]);
    api.edit();const start=api.params(),before=api.loss();
    api.step(.5);assert.ok(api.loss()<before);assert.notDeepEqual(api.params(),start);
    api.reset();assert.deepEqual(api.params(),start);
});
test('side view collapses equal-score points to the same sigmoid position',()=>{
    const camera={yaw:-Math.atan2(2,-2),pitch:0,zoom:1,panX:0,panY:0};
    const a=api.projectGeometry(.1,.3,api.sigmoid(.4),camera,2,true);
    const b=api.projectGeometry(.5,.7,api.sigmoid(.4),camera,2,true);
    assert.ok(Math.abs(a.x-b.x)<1e-10);
    assert.ok(Math.abs(a.y-b.y)<1e-10);
});
test('with a fixed score scale, doubling a score doubles its displacement from the input plane',()=>{
    const camera={yaw:.65,pitch:.55,zoom:1,panX:0,panY:0};
    const base=api.projectGeometry(.3,.6,0,camera,8,false);
    const one=api.projectGeometry(.3,.6,2,camera,8,false);
    const two=api.projectGeometry(.3,.6,4,camera,8,false);
    assert.ok(Math.abs((two.y-base.y)-2*(one.y-base.y))<1e-10);
});

test('repeated and interrupted camera transitions land on exact absolute presets',()=>{
    const side={yaw:-Math.atan2(16,-15.9),pitch:Math.PI*5/180,zoom:1,panX:0,panY:0,sideTint:1};
    const top={...side,pitch:Math.PI*85/180,sideTint:0};
    let camera={...top,yaw:top.yaw+20*Math.PI};
    for(let i=0;i<100;i++){
        camera=api.interpolateCamera(camera,side,.37);
        camera=api.interpolateCamera(camera,top,1);
        camera=api.interpolateCamera(camera,side,1);
        assert.equal(camera.pitch,side.pitch);
        assert.equal(camera.yaw,side.yaw);
        assert.ok(camera.pitch>0);
        assert.deepEqual(api.projectGeometry(.2,.8,.5,camera,8,true),api.projectGeometry(.2,.8,.5,side,8,true));
    }
});

test('above-plane cameras project farther floor points higher and raised points nearer',()=>{
    for(const pitch of [5,31.5,85].map(degrees=>degrees*Math.PI/180)){
        const camera={yaw:-Math.atan2(16,-15.9),pitch,zoom:1,panX:0,panY:0};
        const point=d=>api.projectGeometry(.5+d*Math.sin(camera.yaw),.5+d*Math.cos(camera.yaw),.5,camera,8,true);
        const near=point(-.4),far=point(.4);
        assert.ok(far.depth>near.depth);
        assert.ok(far.y<near.y,'farther part of the plane must appear above the nearer part');
        const floor=point(0),raised=api.projectGeometry(.5,.5,1,camera,8,true);
        assert.ok(raised.y<floor.y);
        assert.ok(raised.depth<floor.depth,'raised surface must sort in front of the floor');
    }
});

test('teaching summary records the actual batch gradient and clears on reset',()=>{
    api.disableUI();api.set([0,0],0,[{x:1,y:0,classLabel:1},{x:0,y:1,classLabel:0}]);
    api.edit();api.step(.4);
    const update=api.lastUpdate();
    assert.deepEqual(Array.from(update.gradient),[-.25,.25,0]);
    assert.deepEqual(Array.from(update.before),[0,0,0]);
    assert.deepEqual(Array.from(update.after),[.1,-.1,0]);
    api.reset();assert.equal(api.lastUpdate(),null);
});
