/* Perspective WebGL surface viewer. No external rendering dependency. */
(function () {
    'use strict';
    function Scene(canvas) {
        var gl = canvas.getContext('webgl', {antialias: true, alpha: false, stencil: true});
        if (!gl) throw new Error('WebGL is unavailable. Use the 2D contour view.');
        var vertex = 'attribute vec3 position, normal; attribute vec4 color; uniform mat4 camera; uniform bool labelPass; varying vec4 shade; varying vec2 uv; varying float gridLine; void main(){gridLine=normal.z < -2.5 ? 2. : (normal.z < -1.5 ? 1. : 0.);if(labelPass){gl_Position=vec4(position,1.);uv=normal.xy;shade=color;return;}float light=.78+.22*abs(dot(normalize(gridLine>1.5?vec3(0.,1.,0.):normal),normalize(vec3(-.4,1.,.6)))); shade=vec4(color.rgb*light,color.a);gl_Position=camera*vec4(position,1.);gl_PointSize=10.;}';
        var fragment = 'precision mediump float; varying vec4 shade; uniform bool dotMarker, labelPass; uniform sampler2D labelTexture; uniform vec2 gridFadeRange; varying float gridLine; varying vec2 uv; void main(){if(labelPass){gl_FragColor=texture2D(labelTexture,uv);gl_FragColor.a*=shade.a;if(gl_FragColor.a<.01)discard;return;}if(dotMarker && distance(gl_PointCoord,vec2(.5))>.5) discard; gl_FragColor=shade;if(gridLine>.5){float extension=gridLine>1.5?1.15:1.;float fade=1.-smoothstep(gridFadeRange.x*extension,gridFadeRange.y*extension,1./gl_FragCoord.w);gl_FragColor.a*=fade;if(gl_FragColor.a<.001)discard;}}';
        function shader(type, source) {
            var s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
            return s;
        }
        var program = gl.createProgram();
        gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
        gl.useProgram(program);
        var buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        [['position',3,0],['normal',3,12],['color',4,24]].forEach(function(a) {
            var loc=gl.getAttribLocation(program,a[0]); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,a[1],gl.FLOAT,false,40,a[2]);
        });
        var uniform=gl.getUniformLocation(program,'camera'), dotUniform=gl.getUniformLocation(program,'dotMarker');
        var budgetProfile=null, budgetFloor=[], contourSpec=null, dynamicContours=[], lossProfile=null, penaltyProfile=null, totalProfile=null, triangles=[], lines=[], spokes=[], budgetWalls=[], penaltyEdges=[], lossRims=[], rims=[], points=[], samples=[], matrix, radius=6, center=[0,2,0], height;
        this.pan=[0,0];
        var framingReady=false, labelGeometry=null, depthScale=1, depthOffset=0, labelTextures=new Map();
        var labelUniform=gl.getUniformLocation(program,'labelPass'),gridFadeUniform=gl.getUniformLocation(program,'gridFadeRange');
        this.resetFraming=function(){framingReady=false;};
        function rgb(hex, alpha) {
            if (hex[0]==='#') { var h=hex.slice(1); if(h.length===3) h=h.replace(/./g,'$&$&'); return [parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255,alpha]; }
            var values=hex.match(/[\d.]+/g); return values ? [values[0]/255,values[1]/255,values[2]/255,alpha] : [.5,.6,.7,alpha];
        }
        function v(p,n,c) { return p.concat(n,c); }
        function line(a,b,c) { lines.push.apply(lines,v(a,[0,1,0],c).concat(v(b,[0,1,0],c))); }
        function tri(a,b,c) { triangles.push({v:a.concat(b,c), p:[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3,(a[2]+b[2]+c[2])/3]}); }
        function displayedPenalty(s,x,z,penalty) {
            if(s.penaltyVisualAlpha!==undefined) {
                if(s.regression&&!s.penalizeIntercept)x=0;
                var alpha=s.penaltyVisualAlpha;
                return s.lambda*(s.penaltyVisualStrength===undefined?1:s.penaltyVisualStrength)*(alpha*(Math.abs(x)+Math.abs(z))+(1-alpha)*(x*x+z*z));
            }
            return s.lambda*penalty(x,z);
        }
        this.updateContributions=function(s,weights,loss,penalty) {
            dynamicContours=[];
            if(s.cameraPreset==='top'&&contourSpec) {
                var spec=contourSpec,base=loss(spec.cx,spec.cy),selected=loss(weights.w1,weights.w2),rise=Math.max(0,selected-base);
                // Stable cost increments reveal successive rings as the selected loss grows.
                var step=.5;
                while(rise/step>12)step*=2;
                var levels=[];
                for(var value=base+step;value<selected-1e-7;value+=step)levels.push(value);
                if(rise>1e-8)levels.push(selected);
                levels.forEach(function(value,index){
                    var contour=[],color=rgb(spec.color,index===levels.length-1?1:.5);
                    for(var j=0;j<=96;j++) {
                        var angle=j/96*2*Math.PI,dx=Math.cos(angle),dz=Math.sin(angle),lo=0,hi=1;
                        while(hi<128&&loss(spec.cx+hi*dx,spec.cy+hi*dz)<value)hi*=2;
                        if(loss(spec.cx+hi*dx,spec.cy+hi*dz)<value){contour.push(null);continue;}
                        for(var k=0;k<28;k++){var mid=(lo+hi)/2;if(loss(spec.cx+mid*dx,spec.cy+mid*dz)<value)lo=mid;else hi=mid;}
                        contour.push([spec.cx+hi*dx,height(value),spec.cy+hi*dz]);
                    }
                    for(var j=0;j<96;j++)if(contour[j]&&contour[j+1])dynamicContours.push.apply(dynamicContours,v(contour[j],[0,1,0],color).concat(v(contour[j+1],[0,1,0],color)));
                });
            }
            this.contributions=[];
            this.contributionFoot=[weights.w1,0,weights.w2];
            var lossValue=loss(weights.w1,weights.w2),penaltyValue=s.lambda*penalty(weights.w1,weights.w2);
            var add=function(kind,value,label){this.contributions.push({p:[weights.w1,height(value),weights.w2],kind:kind,opacity:kind==='penalty'&&s.penaltyOpacity!==undefined?s.penaltyOpacity:1,text:label+' '+value.toFixed(2)});}.bind(this);
            if(s.showBoth||s.showLoss||s.showComponents&&s.showTotal)add('loss',lossValue,'Loss');
            if(s.regType!=='none'&&(s.showBoth||s.showPenalty||s.showComponents&&s.showTotal))add('penalty',s.penaltyMarkerValue===undefined?displayedPenalty(s,weights.w1,weights.w2,penalty):s.penaltyMarkerValue,'Penalty');
            if(s.showTotal)add('total',lossValue+penaltyValue,'Total');
        };
        this.update=function(s, colors, loss, penalty, total) {
            this.lossMinimum=null;
            contourSpec=(s.showLoss||s.showBoth)?{cx:s.cx,cy:s.cy,color:colors.modelLoss}:null;
            budgetProfile=null; budgetFloor=[]; lossProfile=null; penaltyProfile=null; totalProfile=null; triangles=[]; lines=[]; spokes=[]; budgetWalls=[]; penaltyEdges=[]; lossRims=[]; rims=[]; points=[]; samples=[];
            // The clipping height must not change the cost-to-world-height mapping.
            var cap=s.rimHeight || 6, referenceHeight=6;
            var scale=5*s.stretch/(s.heightMode==='linear'?referenceHeight:5*Math.log(1+referenceHeight/5));
            height=function(value) { return scale*(s.heightMode==='linear'?value:5*Math.log(1+value/5)); };
            var weighted=function(x,z) {return displayedPenalty(s,x,z,penalty);};
            var specs=[];
            if(s.showLoss||s.showBoth) specs.push({fn:loss,c:[s.cx,s.cy],color:colors.modelLoss});
            if((s.showPenalty||s.showBoth)&&s.regType!=='none') specs.push({fn:weighted,c:[0,0],color:colors.modelPenalty});
            if(s.showTotal) specs.push({fn:total,c:[s.optimum.w1,s.optimum.w2],color:colors.modelTotal});
            if(s.showTotal&&s.showComponents) {
                if(!s.showLoss&&!s.showBoth) specs.push({fn:loss,c:[s.cx,s.cy],color:colors.modelLoss,wire:true});
                if(!s.showPenalty&&!s.showBoth) specs.push({fn:weighted,c:[0,0],color:colors.modelPenalty,wire:true});
            }
            var min=[Infinity,0,Infinity], max=[-Infinity,0,-Infinity];
            var budget=s.formulation==='budget'?s.budget:penalty(s.optimum.w1,s.optimum.w2), constrained=s.showConstraint&&(s.formulation==='budget'||s.lambda>0)&&s.regType!=='none';
            specs.forEach(function(spec) {
                var cap=spec.fn===weighted&&s.penaltyVisualCap!==undefined?s.penaltyVisualCap:(s.rimHeight||6);
                var opacity=spec.fn===weighted&&s.penaltyOpacity!==undefined?s.penaltyOpacity:1;
                function surfaceColor(alpha){return rgb(spec.color,alpha*opacity);}
                var n=96, rings=32, grid=[], radii=[], base=spec.fn(spec.c[0],spec.c[1]);
                for(var j=0;j<=rings;j++) {
                    var row=[];
                    for(var i=0;i<=n;i++) {
                        var angle=i/n*Math.PI*2, dx=Math.cos(angle), dz=Math.sin(angle), lo=0, hi=1;
                        if (j === 0) {
                        while(hi<(s.regression&&!s.penalizeIntercept ? Math.max(3,Math.abs(s.cx)+2):16) && spec.fn(spec.c[0]+hi*dx,spec.c[1]+hi*dz)<base+cap) hi*=2;
                        // Finite level rim; a zero penalty is a flat disk, not a fabricated bowl.
                        hi=Math.min(hi,s.regression&&!s.penalizeIntercept ? Math.max(3,Math.abs(s.cx)+2):16);
                        for(var k=0;k<28;k++) { var mid=(lo+hi)/2; if(spec.fn(spec.c[0]+mid*dx,spec.c[1]+mid*dz)<base+cap) lo=mid; else hi=mid; }
                        radii[i]=hi;
                        }
                        var r=radii[i]*j/rings, x=spec.c[0]+r*dx,z=spec.c[1]+r*dz,y=height(spec.fn(x,z));
                        var eps=.001, nx=-(height(spec.fn(x+eps,z))-height(spec.fn(x-eps,z)))/(2*eps), nz=-(height(spec.fn(x,z+eps))-height(spec.fn(x,z-eps)))/(2*eps), norm=Math.hypot(nx,1,nz);
                        var c=surfaceColor(s.showBoth ? .24 : .42);
                        var p=[x,y,z]; row.push(v(p,[nx/norm,1/norm,nz/norm],c));
                        for(var q=0;q<3;q++) {min[q]=Math.min(min[q],p[q]);max[q]=Math.max(max[q],p[q]);}
                        if(s.showTotal&&!spec.wire) samples.push({p:p,w1:x,w2:z});
                    }
                    grid.push(row);
                }
                if(spec.fn===loss)this.lossMinimum=[spec.c[0],height(base),spec.c[1]];
                if(spec.fn===loss)lossProfile={rows:grid,color:surfaceColor(.85)};
                var l1Mix=s.regType==='l1'?1:s.regType==='elastic'?s.alpha:0;
                // Keep both edge sets through the morph; blend their visibility continuously.
                if(spec.fn===weighted)penaltyProfile={rows:grid,color:surfaceColor(.85*(1-l1Mix))};
                if(spec.fn===total)totalProfile={rows:grid,color:surfaceColor(.85)};
                var wire=surfaceColor(spec.wire ? .8 : .38);
                for(var ring=0;ring<rings;ring++) for(var a=0;a<n;a++) {
                    var va=grid[ring][a],vb=grid[ring+1][a],vc=grid[ring+1][a+1],vd=grid[ring][a+1];
                    if(!spec.wire) {tri(va,vb,vc);tri(va,vc,vd);}
                    if(a%16===0) spokes.push.apply(spokes,v(va.slice(0,3),[0,1,0],wire).concat(v(vb.slice(0,3),[0,1,0],wire)));
                    if(spec.fn===weighted && a%24===0) penaltyEdges.push.apply(penaltyEdges,v(va.slice(0,3),[0,1,0],surfaceColor(.9*l1Mix)).concat(v(vb.slice(0,3),[0,1,0],surfaceColor(.9*l1Mix))));

                    if(ring===rings-1) {var rimBuffer=spec.fn===loss?lossRims:rims;rimBuffer.push.apply(rimBuffer,v(vb.slice(0,3),[0,1,0],surfaceColor(.85)).concat(v(vc.slice(0,3),[0,1,0],surfaceColor(.85))));}
                }
                // Horizontal level sets, not radial mesh rings: these become contours from above.
                for(var level=1;level<=(s.cameraPreset==='top'&&spec.fn===loss?0:4);level++) {
                    var value=base+cap*level/5,contour=[];
                    for(var angleIndex=0;angleIndex<=n;angleIndex++) {
                        var theta=angleIndex/n*2*Math.PI,dx=Math.cos(theta),dz=Math.sin(theta),lo=0,hi=radii[angleIndex];
                        if(spec.fn(spec.c[0]+hi*dx,spec.c[1]+hi*dz)<value-1e-7){contour.push(null);continue;}
                        for(var step=0;step<26;step++){var mid=(lo+hi)/2;if(spec.fn(spec.c[0]+mid*dx,spec.c[1]+mid*dz)<value)lo=mid;else hi=mid;}
                        contour.push([spec.c[0]+hi*dx,height(value),spec.c[1]+hi*dz]);
                    }
                    for(var segment=0;segment<n;segment++)if(contour[segment]&&contour[segment+1])line(contour[segment],contour[segment+1],surfaceColor(.8));
                }
                points.push.apply(points,v([spec.c[0],height(base),spec.c[1]],[0,1,0],surfaceColor(1)));
            },this);
            if(constrained) {
                var boundary=[], sliceHeight=height(s.formulation==='budget'?loss(s.cx,s.cy)+cap:s.lambda*budget), ringColor=rgb(colors.constraint,1);
                function overlayLine(a,b) { rims.push.apply(rims,v(a,[0,1,0],ringColor).concat(v(b,[0,1,0],ringColor))); }

                for(var b=0;b<=128;b++) {
                    var theta=b/128*Math.PI*2, low=0, high=s.regression&&!s.penalizeIntercept ? Math.max(3,Math.abs(s.cx)+2):16;
                    for(var t=0;t<32;t++) {var m=(low+high)/2; if(penalty(m*Math.cos(theta),m*Math.sin(theta))<=budget) low=m;else high=m;}
                    boundary.push([low*Math.cos(theta),-.06,low*Math.sin(theta)]);
                }
                for(var e=0;e<128;e++) {
                    tri(v([0,-.06,0],[0,1,0],rgb(colors.constraint,.3)),v(boundary[e],[0,1,0],rgb(colors.constraint,.3)),v(boundary[e+1],[0,1,0],rgb(colors.constraint,.3)));
                    if(s.formulation==='budget')budgetFloor.push.apply(budgetFloor,v(boundary[e],[0,1,0],ringColor).concat(v(boundary[e+1],[0,1,0],ringColor)));
                    else overlayLine(boundary[e],boundary[e+1]);
                    if(s.formulation==='budget') {
                        var floorA=boundary[e],floorB=boundary[e+1],topA=[floorA[0],sliceHeight,floorA[2]],topB=[floorB[0],sliceHeight,floorB[2]],wall=rgb(colors.modelPenalty,.12);
                        tri(v(floorA,[0,1,0],wall),v(topA,[0,1,0],wall),v(topB,[0,1,0],wall));
                        tri(v(floorA,[0,1,0],wall),v(topB,[0,1,0],wall),v(floorB,[0,1,0],wall));
                        budgetWalls.push.apply(budgetWalls,v(topA,[0,1,0],ringColor).concat(v(topB,[0,1,0],ringColor)));
                        if(e%16===0)budgetWalls.push.apply(budgetWalls,v(floorA,[0,1,0],ringColor).concat(v(topA,[0,1,0],ringColor)));
                        for(var axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],floorA[axis]);max[axis]=Math.max(max[axis],topA[axis]);}
                        continue;
                    }
                    // Only lift true budget boundaries, not the clipped ends of an unbounded band.
                    var a=boundary[e],b=boundary[e+1];
                    if(Math.abs(penalty(a[0],a[2])-budget)<1e-5 && Math.abs(penalty(b[0],b[2])-budget)<1e-5) {
                        overlayLine([a[0],sliceHeight,a[2]],[b[0],sliceHeight,b[2]]);
                        if(e%16===0) {
                            for(var dash=0;dash<8;dash++) overlayLine([a[0],-.06+(sliceHeight+.06)*dash/8,a[2]],[a[0],-.06+(sliceHeight+.06)*(dash+.45)/8,a[2]]);
                        }
                    }
                }
            }
            if(constrained&&s.formulation==='budget')budgetProfile={boundary:boundary,height:sliceHeight,color:ringColor};
            var opt=s.optimum;
            this.optimumLabel=null;
            this.contributions=[];
            if(s.showBoth || s.showTotal || s.showConstraint) {
                var markerHeight=s.showBoth ? 0 : height(s.showTotal ? opt.total : opt.loss);
                this.optimumLabel={p:[opt.w1,markerHeight,opt.w2],
                    title:'Optimal weights ('+opt.w1.toFixed(2)+', '+opt.w2.toFixed(2)+')',
                    detail:s.showConstraint ? 'Lowest allowed loss: '+opt.loss.toFixed(2) : 'L + λR = '+opt.loss.toFixed(2)+' + '+(s.lambda*opt.penalty).toFixed(2)+' = '+opt.total.toFixed(2),
                    note:s.showBoth ? '★ marks the weights on the floor' : '★ marks the minimum on the surface'};
            }
            this.updateContributions(s,opt,loss,penalty);

            if(s.showTotal) for(var g=1;g<s.gdPath.length;g++) {
                var prev=s.gdPath[g-1],next=s.gdPath[g];
                line([prev.w1,height(total(prev.w1,prev.w2))+.04,prev.w2],[next.w1,height(total(next.w1,next.w2))+.04,next.w2],rgb(colors.gd,1));
            }
            if(!specs.length) {min=[-3,0,-3];max=[3,6,3];}
            // Surface changes must not move the camera target or change its distance.
            // Fit once on opening; explicit Reset view fits the current surfaces again.
            if(!framingReady) {
                center=min.map(function(value,index){return (value+max[index])/2;});
                radius=Math.max(3,Math.hypot(max[0]-min[0],max[1]-min[1],max[2]-min[2])/2);
                framingReady=true;
            }
            this.gridColor=rgb(colors.gridLine,.14);
            this.axisColor=rgb(colors.axis,.85);
            // Labels have fixed world positions, independent of the surface bounds.
            this.labels=[{p:[3,0,0],text:s.regression?'intercept b':'w₀'},{p:[0,0,3],text:s.regression?'slope m':'w₁'},{p:[0,3,0],text:'cost'}];
            this.background=rgb(colors.bg,1);
            this.translucent=true;
        };
        function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
        this.panForPoint=function(point,s) {
            var delta=point.map(function(value,index){return value-center[index];});
            var cy=Math.cos(s.yaw),sy=Math.sin(s.yaw),sp=Math.sin(s.pitch),cp=Math.cos(s.pitch);
            var pan=[dot(delta,[cy,0,-sy]),dot(delta,[-sy*sp,cp,-cy*sp])];
            if(s.cameraPreset==='side'||s.cameraPreset==='3d') {
                var depth=radius*2.5/s.zoom-dot(delta,[sy*cp,sp,cy*cp]);
                // Move halfway from the previous focus height toward the bottom edge.
                var focusY=s.cameraPreset==='side'?.875:.75;
                pan[1]+=(2*focusY-1)*depth*Math.tan(Math.PI/8);
            }
            return pan;
        };
        this.render=function(s,projectionOnly) {
            gl.viewport(0,0,canvas.width,canvas.height); gl.clearColor.apply(gl,this.background); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
            var cy=Math.cos(s.yaw),sy=Math.sin(s.yaw),cp=Math.cos(s.pitch),sp=Math.sin(s.pitch);
            var right=[cy,0,-sy], up=[-sy*sp,cp,-cy*sp], back=[sy*cp,sp,cy*cp], distance=radius*2.5/s.zoom;
            var target=center.map(function(v,i){return v+right[i]*this.pan[0]+up[i]*this.pan[1];},this);
            var eye=target.map(function(v,i){return v+back[i]*distance;});
            var aspect=canvas.width/canvas.height,f=1/Math.tan(Math.PI/8),near=.05,far=radius*50,aa=(far+near)/(near-far),bb=2*far*near/(near-far);
            matrix=new Float32Array([f/aspect*right[0],f*up[0],aa*back[0],-back[0],f/aspect*right[1],f*up[1],aa*back[1],-back[1],f/aspect*right[2],f*up[2],aa*back[2],-back[2],-f/aspect*dot(right,eye),-f*dot(up,eye),-aa*dot(back,eye)+bb,dot(back,eye)]);
            if(projectionOnly)return;
            depthScale=-aa;depthOffset=bb;
            gl.uniform2f(gridFadeUniform,distance*1.8,distance*6);
            // Extend the visible patch around the camera, always on the same unit lattice.
            // Panning reveals more grid; changing the model never changes its spacing.
            var grid=[],reach=Math.ceil(Math.max(100,distance*8)),gx=Math.floor(target[0]),gz=Math.floor(target[2]);
            function gridLine(a,b,color){var normal=s.cameraPreset==='top'?[0,1,0]:[0,1,-2];grid.push.apply(grid,v(a,normal,color).concat(v(b,normal,color)));}
            for(var tick=-reach;tick<=reach;tick++) {
                gridLine([gx+tick,0,gz-reach],[gx+tick,0,gz+reach],this.gridColor);
                gridLine([gx-reach,0,gz+tick],[gx+reach,0,gz+tick],this.gridColor);
            }
            // Triangle ribbons remain visibly thick on WebGL implementations that only support 1px lines.
            var axes=[],axisColor=this.axisColor,halfWidth=distance*Math.tan(Math.PI/8)*2/canvas.clientHeight;
            function axisRibbon(a,b) {
                var d=b.map(function(value,i){return value-a[i];});
                var across=[d[1]*back[2]-d[2]*back[1],d[2]*back[0]-d[0]*back[2],d[0]*back[1]-d[1]*back[0]],length=Math.hypot.apply(null,across);
                if(length<1e-8)return;
                across=across.map(function(value){return value/length*halfWidth;});
                var ap=a.map(function(value,i){return value+across[i];}),am=a.map(function(value,i){return value-across[i];});
                var bp=b.map(function(value,i){return value+across[i];}),bm=b.map(function(value,i){return value-across[i];});
                [ap,am,bp,am,bm,bp].forEach(function(point){axes.push.apply(axes,v(point,s.cameraPreset==='top'?[0,1,0]:[0,1,-3],axisColor));});
            }
            axisRibbon([gx-reach,0,0],[gx+reach,0,0]);
            axisRibbon([0,0,gz-reach],[0,0,gz+reach]);
            axisRibbon([0,0,0],[0,Math.max(reach,target[1]+reach),0]);

            gl.uniformMatrix4fv(uniform,false,matrix); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
            // The depth buffer resolves intersecting opaque surfaces per pixel. Sort translucent constraint fragments back to front.
            triangles.sort(function(a,b){return dot(a.p,back)-dot(b.p,back);});
            var fill=s.surfaceOpacity===undefined?1:s.surfaceOpacity;
            var data=new Float32Array(triangles.length*30); triangles.forEach(function(t,i){data.set(t.v,i*30);});
            for(var alphaIndex=9;alphaIndex<data.length;alphaIndex+=10)data[alphaIndex]*=fill;
            gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1,1);
            gl.depthMask(!this.translucent); gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW); gl.drawArrays(gl.TRIANGLES,0,data.length/10);
            gl.depthMask(true); gl.colorMask(false,false,false,false); if(fill>0)gl.drawArrays(gl.TRIANGLES,0,data.length/10); gl.colorMask(true,true,true,true); gl.disable(gl.POLYGON_OFFSET_FILL);
            // Follow the two outer sides of the loss bowl as the camera orbits.
            // At each height, take the leftmost and rightmost points along camera-right.
            var profiles=[];
            var outlines=[lossProfile];
            if(s.cameraPreset==='side')outlines.push(penaltyProfile,totalProfile);
            outlines.filter(Boolean).forEach(function(profile) {
                var previous=null,profileColor=profile.color.slice();
                profileColor[3]*=Math.abs(cp);
                profile.rows.forEach(function(row){
                    var left=row[0],rightmost=row[0];
                    row.forEach(function(point){if(dot(point,right)<dot(left,right))left=point;if(dot(point,right)>dot(rightmost,right))rightmost=point;});
                    var pair=[left,rightmost];
                    if(previous)for(var side=0;side<2;side++)profiles.push.apply(profiles,v(previous[side].slice(0,3),[0,1,0],profileColor).concat(v(pair[side].slice(0,3),[0,1,0],profileColor)));
                    previous=pair;
                });
            });
            var visibleLines=grid.concat(lines).concat(dynamicContours).concat(profiles).concat(spokes.map(function(value,index){return index%10===9?value*fill:value;}));
            var faintLines=visibleLines.map(function(value,index){return index%10===9 ? value*(1-.78*fill) : value;});
            gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
            gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(faintLines),gl.DYNAMIC_DRAW); gl.drawArrays(gl.LINES,0,faintLines.length/10);
            gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
            gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(visibleLines),gl.DYNAMIC_DRAW); gl.drawArrays(gl.LINES,0,visibleLines.length/10);
            // Continuous colored rims stay legible through the translucent walls.
            gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
            var wallOpacity=s.budgetWallOpacity===undefined?1:s.budgetWallOpacity;
            var cylinderLines=budgetFloor.concat(budgetWalls.map(function(value,index){return index%10===9?value*wallOpacity:value;}));
            if(s.cameraPreset==='side'&&budgetProfile) {
                cylinderLines=[];
                var left=budgetProfile.boundary[0],rightEdge=left;
                budgetProfile.boundary.forEach(function(point){if(dot(point,right)<dot(left,right))left=point;if(dot(point,right)>dot(rightEdge,right))rightEdge=point;});
                var topLeft=[left[0],budgetProfile.height,left[2]],topRight=[rightEdge[0],budgetProfile.height,rightEdge[2]];
                function cylinderEdge(a,b){cylinderLines.push.apply(cylinderLines,v(a,[0,1,0],budgetProfile.color).concat(v(b,[0,1,0],budgetProfile.color)));}
                for(var edge=0;edge<budgetProfile.boundary.length-1;edge++) {
                    var a=budgetProfile.boundary[edge],b=budgetProfile.boundary[edge+1];
                    cylinderEdge(a,b);
                    cylinderEdge([a[0],budgetProfile.height,a[2]],[b[0],budgetProfile.height,b[2]]);
                }
                if(s.regType==='l1'&&(!s.regression||s.penalizeIntercept)) {
                    // The diamond has four actual corners, including the two
                    // interior edges in this projection, not just a silhouette.
                    for(var corner=0;corner<128;corner+=32) {
                        var foot=budgetProfile.boundary[corner];
                        cylinderEdge(foot,[foot[0],budgetProfile.height,foot[2]]);
                    }
                } else {
                    // Show depth around the cylinder as well as its silhouette.
                    for(var depthEdge=0;depthEdge<budgetProfile.boundary.length-1;depthEdge+=16) {
                        var base=budgetProfile.boundary[depthEdge];
                        if(base!==left&&base!==rightEdge)cylinderEdge(base,[base[0],budgetProfile.height,base[2]]);
                    }
                    cylinderEdge(left,topLeft);cylinderEdge(rightEdge,topRight);
                }
            }
            var visibleRims=rims.concat(cylinderLines).concat(penaltyEdges.map(function(value,index){return index%10===9?value*wallOpacity:value;})).concat(lossRims.map(function(value,index){return index%10===9?value*wallOpacity:value;}));
            gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(visibleRims),gl.DYNAMIC_DRAW); gl.drawArrays(gl.LINES,0,visibleRims.length/10);
            if(!s.showBoth) gl.enable(gl.DEPTH_TEST);
            gl.disable(gl.DEPTH_TEST);
            gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(axes),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,axes.length/10);
            gl.uniform1i(dotUniform,1);
            gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points),gl.DYNAMIC_DRAW); gl.drawArrays(gl.POINTS,0,points.length/10); gl.uniform1i(dotUniform,0);
            gl.depthMask(true);
            labelGeometry={contours:new Float32Array(lines.concat(profiles).concat(visibleRims)),surfaces:data,edges:new Float32Array(visibleLines.concat(visibleRims)),axes:new Float32Array(axes)};
            canvas.dataset.renderer='webgl';
        };
        this.project=function(p) {
            var a=matrix,w=a[3]*p[0]+a[7]*p[1]+a[11]*p[2]+a[15];
            return {x:(1+(a[0]*p[0]+a[4]*p[1]+a[8]*p[2]+a[12])/w)*canvas.clientWidth/2,y:(1-(a[1]*p[0]+a[5]*p[1]+a[9]*p[2]+a[13])/w)*canvas.clientHeight/2,depth:w};
        };
        this.beginAnnotations=function() {
            gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.depthFunc(gl.LEQUAL);
            gl.clearDepth(1);gl.stencilMask(255);gl.clearStencil(0);
            gl.clear(gl.DEPTH_BUFFER_BIT|gl.STENCIL_BUFFER_BIT);
            gl.enable(gl.STENCIL_TEST);gl.stencilFunc(gl.ALWAYS,1,255);gl.stencilOp(gl.KEEP,gl.KEEP,gl.REPLACE);
        };
        this.endAnnotations=function(s) {
            // Reapply translucent surfaces only to annotation pixels and only when nearer.
            if(s.cameraPreset==='3d'&&labelGeometry) {
                gl.stencilFunc(gl.EQUAL,1,255);gl.stencilOp(gl.KEEP,gl.KEEP,gl.KEEP);
                gl.depthFunc(gl.LESS);gl.depthMask(false);
                gl.bufferData(gl.ARRAY_BUFFER,labelGeometry.surfaces,gl.DYNAMIC_DRAW);
                gl.drawArrays(gl.TRIANGLES,0,labelGeometry.surfaces.length/10);
            }
            gl.disable(gl.STENCIL_TEST);gl.depthMask(true);gl.depthFunc(gl.LEQUAL);
        };
        this.renderGuides=function(s,colors) {
            var foot=this.contributionFoot;
            if(!foot)return;
            var segments=[[foot,[foot[0],0,0],colors.weight],[foot,[0,0,foot[2]],colors.weight]],data=[];
            if(this.contributions.length) {
                var solid=this.contributions.filter(function(item){return item.kind!=='penalty';});
                var highest=solid.length?solid.reduce(function(a,b){return a.p[1]>b.p[1]?a:b;}):null;
                if(highest)segments.push([foot,highest.p,colors.vertical]);
                this.contributions.forEach(function(item){
                    if(item.kind==='penalty'&&(!highest||item.p[1]>highest.p[1]))segments.push([highest?highest.p:foot,item.p,colors.vertical,item.opacity]);
                });
                if(s.cameraPreset!=='top')this.contributions.forEach(function(item){
                    if(item.kind==='loss'||item.kind==='total')segments.push([item.p,[0,item.p[1],0],colors[item.kind]]);
                });
            }
            segments.forEach(function(segment) {
                var a=segment[0],b=segment[1],pa=this.project(a),pb=this.project(b),c=rgb(segment[2],segment[3]===undefined?1:segment[3]);
                if(pa.depth<=0||pb.depth<=0)return;
                var length=Math.hypot(pb.x-pa.x,pb.y-pa.y);
                if(length<1)return;
                // Invert perspective along the segment to keep a consistent 3px/4px dash rhythm.
                function point(fraction) {
                    var t=fraction*pa.depth/((1-fraction)*pb.depth+fraction*pa.depth);
                    return a.map(function(value,index){return value+(b[index]-value)*t;});
                }
                for(var pixel=0;pixel<length;pixel+=7) {
                    var start=this.project(point(pixel/length)),end=this.project(point(Math.min(length,pixel+3)/length));
                    var dx=end.x-start.x,dy=end.y-start.y,d=Math.hypot(dx,dy);
                    if(d<1e-6)continue;
                    var ox=-dy/d*.9,oy=dx/d*.9; // 1.8 CSS pixels, independent of WebGL line-width limits.
                    var corners=[[start,ox,oy],[start,-ox,-oy],[end,ox,oy],[start,-ox,-oy],[end,-ox,-oy],[end,ox,oy]];
                    corners.forEach(function(corner) {
                        var p=corner[0];
                        data.push.apply(data,v([2*(p.x+corner[1])/canvas.clientWidth-1,1-2*(p.y+corner[2])/canvas.clientHeight,depthScale+depthOffset/p.depth-1e-6],[0,1,0],c));
                    });
                }
            },this);
            gl.enable(gl.DEPTH_TEST);gl.depthMask(true);
            if(labelGeometry)labelGeometry.guides=new Float32Array(data);
            gl.uniformMatrix4fv(uniform,false,new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]));
            gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,data.length/10);
            gl.uniformMatrix4fv(uniform,false,matrix);
            gl.depthMask(true);gl.enable(gl.DEPTH_TEST);
        };
        this.renderFloorMarkers=function(optimum,selected,optimalColor,selectedColor) {
            function marker(weights,count,outer,inner,color) {
                var center=[weights.w1,0,weights.w2],outline=[],fill=[],edge=[],c=rgb(color,1);
                for(var i=0;i<count;i++) {
                    var angle=-Math.PI/2+i*2*Math.PI/count,r=i%2?inner:outer;
                    outline.push([weights.w1+r*Math.cos(angle),0,weights.w2+r*Math.sin(angle)]);
                }
                for(var i=0;i<count;i++) {
                    fill.push.apply(fill,v(center,[0,1,0],c).concat(v(outline[i],[0,1,0],c),v(outline[(i+1)%count],[0,1,0],c)));
                    edge.push.apply(edge,v(outline[i],[0,1,0],[1,1,1,1]));
                }
                gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(fill),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,fill.length/10);
                gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(edge),gl.DYNAMIC_DRAW);gl.drawArrays(gl.LINE_LOOP,0,count);
            }
            // Keep the floor markers visible through translucent bowls, but below labels.
            gl.enable(gl.DEPTH_TEST);gl.depthMask(true);
            marker(optimum,10,.098,.042,optimalColor);
            if(selected)marker(selected,40,.0375,.0375,selectedColor);
            gl.depthMask(true);gl.enable(gl.DEPTH_TEST);
        };
        // Screen-sized billboards write real camera depth. Repaint only geometry in front
        // of their pixels, so translucent surfaces and nearer edges cross the text naturally.
        this.renderLabels=function(labels,preset) {
            if(!labelGeometry)return;
            var dpr=canvas.width/canvas.clientWidth;
            gl.enable(gl.SCISSOR_TEST);gl.enable(gl.DEPTH_TEST);
            labels.forEach(function(label) {
                var key=JSON.stringify([label.text,label.width,label.height,label.font,label.color,label.background,label.border,label.borderWidth,label.radius,dpr]);
                var texture=labelTextures.get(key);
                if(!texture) {
                    var bitmap=document.createElement('canvas');
                    bitmap.width=Math.ceil(label.width*dpr);bitmap.height=Math.ceil(label.height*dpr);
                    var ctx=bitmap.getContext('2d');ctx.scale(dpr,dpr);
                    ctx.beginPath();ctx.roundRect(0,0,label.width,label.height,label.radius);
                    ctx.fillStyle=label.background;ctx.fill();
                    if(label.borderWidth) {
                        var inset=label.borderWidth/2;
                        ctx.beginPath();ctx.roundRect(inset,inset,label.width-2*inset,label.height-2*inset,Math.max(0,label.radius-inset));
                        ctx.strokeStyle=label.border;ctx.lineWidth=label.borderWidth;ctx.stroke();
                    }
                    ctx.font=label.font;ctx.fillStyle=label.color;ctx.textBaseline='middle';
                    ctx.fillText(label.text,label.paddingLeft,label.height/2);
                    texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
                    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
                    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);
                    labelTextures.set(key,texture);
                    if(labelTextures.size>64){var oldest=labelTextures.keys().next().value;gl.deleteTexture(labelTextures.get(oldest));labelTextures.delete(oldest);}
                }
                var left=2*label.x/canvas.clientWidth-1,right=2*(label.x+label.width)/canvas.clientWidth-1;
                var top=1-2*label.y/canvas.clientHeight,bottom=1-2*(label.y+label.height)/canvas.clientHeight;
                var z=depthScale+depthOffset/label.depth;
                var quad=[];
                [[left,top,0,0],[left,bottom,0,1],[right,top,1,0],[left,bottom,0,1],[right,bottom,1,1],[right,top,1,0]].forEach(function(p){quad.push.apply(quad,v([p[0],p[1],z],[p[2],p[3],0],[1,1,1,label.opacity===undefined?1:label.opacity]));});
                var x=Math.floor(label.x*dpr),y=Math.floor(canvas.height-(label.y+label.height)*dpr);
                gl.scissor(x,y,Math.ceil(label.width*dpr)+1,Math.ceil(label.height*dpr)+1);
                // Zero depth outside the rounded label prevents repainting the surrounding scene.
                gl.depthMask(true);gl.clearDepth(0);gl.clear(gl.DEPTH_BUFFER_BIT);gl.depthFunc(gl.ALWAYS);
                gl.uniform1i(labelUniform,1);gl.bindTexture(gl.TEXTURE_2D,texture);
                gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(quad),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,6);
                gl.uniform1i(labelUniform,0);gl.depthFunc(gl.LESS);gl.depthMask(false);
                if(label.axisLabel&&labelGeometry.guides) {
                    // Guides carry clip-space depth; replay only the portions in front of this label.
                    gl.uniformMatrix4fv(uniform,false,new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]));
                    gl.bufferData(gl.ARRAY_BUFFER,labelGeometry.guides,gl.DYNAMIC_DRAW);
                    gl.drawArrays(gl.TRIANGLES,0,labelGeometry.guides.length/10);
                    gl.uniformMatrix4fv(uniform,false,matrix);
                }
                if(preset==='3d') {
                gl.bufferData(gl.ARRAY_BUFFER,labelGeometry.surfaces,gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,labelGeometry.surfaces.length/10);
                }
                gl.bufferData(gl.ARRAY_BUFFER,labelGeometry.edges,gl.DYNAMIC_DRAW);gl.drawArrays(gl.LINES,0,labelGeometry.edges.length/10);
                gl.bufferData(gl.ARRAY_BUFFER,labelGeometry.axes,gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,labelGeometry.axes.length/10);
                if(preset==='side') {
                    // Side-view contours stay continuous across the caption panels.
                    gl.depthFunc(gl.ALWAYS);
                    gl.bufferData(gl.ARRAY_BUFFER,labelGeometry.contours,gl.DYNAMIC_DRAW);
                    gl.drawArrays(gl.LINES,0,labelGeometry.contours.length/10);
                    gl.depthFunc(gl.LESS);
                }
            });
            gl.disable(gl.SCISSOR_TEST);gl.depthMask(true);gl.clearDepth(1);gl.depthFunc(gl.LEQUAL);
        };
        // Invert the projected weight plane (height = 0), including perspective.
        this.weightAt=function(x,y,planeHeight) {
            planeHeight=planeHeight||0;
            var a=matrix,u=2*x/canvas.clientWidth-1,v=1-2*y/canvas.clientHeight;
            var A=a[0]-u*a[3],B=a[8]-u*a[11],C=u*a[15]-a[12]-(a[4]-u*a[7])*planeHeight;
            var D=a[1]-v*a[3],E=a[9]-v*a[11],F=v*a[15]-a[13]-(a[5]-v*a[7])*planeHeight;
            var det=A*E-B*D;
            if(Math.abs(det)<1e-7)return null; // Plane viewed edge-on.
            var w1=(C*E-B*F)/det,w2=(A*F-C*D)/det;
            return Number.isFinite(w1)&&Number.isFinite(w2)&&this.project([w1,planeHeight,w2]).depth>0 ? {w1:w1,w2:w2} : null;
        };
        var previousFitGeometry=null,fitTarget=null,lastFitZoom=null,lastFitTime=0;
        this.fitSelection=function(s) {
            var targets=[{p:this.contributionFoot,pad:30},{p:[s.optimum.w1,0,s.optimum.w2],pad:25}];
            this.contributions.forEach(function(item){targets.push({p:item.p,pad:75});});
            for(var i=0;i<dynamicContours.length;i+=20)targets.push({p:dynamicContours.slice(i,i+3),pad:20});
            if(budgetProfile)for(var edge=0;edge<budgetProfile.boundary.length;edge+=8) {
                var boundaryPoint=budgetProfile.boundary[edge];
                targets.push({p:boundaryPoint,pad:20});
                if(s.cameraPreset!=='top')targets.push({p:[boundaryPoint[0],budgetProfile.height,boundaryPoint[2]],pad:20});
            }
            var geometry=JSON.stringify([canvas.clientWidth,canvas.clientHeight,targets]),original=s.zoom;
            var geometryChanged=geometry!==previousFitGeometry;
            var firstFit=previousFitGeometry===null;
            // A direct wheel/pinch change overrides an in-flight automatic transition.
            if(lastFitZoom!==null&&Math.abs(original-lastFitZoom)>1e-8)fitTarget=null;
            previousFitGeometry=geometry;
            if(!geometryChanged&&fitTarget===null) {
                this.fitAnimating=false;lastFitZoom=s.zoom;lastFitTime=performance.now();
                return false;
            }
            // Refit both ways when the content changes; leave deliberate zooming alone otherwise.
            if(geometryChanged)s.zoom=3;else if(fitTarget!==null)s.zoom=fitTarget;
            var tooClose=null;
            for(var attempt=0;attempt<60;attempt++) {
                this.render(s,true);
                var fits=targets.every(function(target){
                    if(!target.p)return true;
                    var p=this.project(target.p),mx=Math.min(target.pad,canvas.clientWidth*.22),my=Math.min(target.pad,canvas.clientHeight*.22);
                    return p.depth>0&&p.x>=mx&&p.x<=canvas.clientWidth-mx&&p.y>=my&&p.y<=canvas.clientHeight-my;
                },this);
                if(fits||s.zoom<=.01)break;
                tooClose=s.zoom;s.zoom=Math.max(.01,s.zoom*.85);
            }
            if(tooClose!==null&&s.zoom>.01) {
                var low=s.zoom,high=tooClose;
                for(var step=0;step<12;step++) {
                    s.zoom=(low+high)/2;this.render(s,true);
                    var fits=targets.every(function(target){if(!target.p)return true;var p=this.project(target.p),mx=Math.min(target.pad,canvas.clientWidth*.22),my=Math.min(target.pad,canvas.clientHeight*.22);return p.depth>0&&p.x>=mx&&p.x<=canvas.clientWidth-mx&&p.y>=my&&p.y<=canvas.clientHeight-my;},this);
                    if(fits)low=s.zoom;else high=s.zoom;
                }
                s.zoom=low;
            }
            var desired=s.zoom,now=performance.now();
            var reduced=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if(!firstFit&&!reduced&&Math.abs(Math.log(desired/original))>.001) {
                fitTarget=desired;
                var dt=Math.min(40,Math.max(1,lastFitTime?now-lastFitTime:16));
                // Interpolate camera distance proportionally, preserving continuity when retargeted.
                s.zoom=Math.exp(Math.log(original)+(Math.log(desired)-Math.log(original))*(1-Math.exp(-dt/110)));
                this.fitAnimating=true;
            } else {s.zoom=desired;fitTarget=null;this.fitAnimating=false;}
            lastFitTime=now;lastFitZoom=s.zoom;
            this.render(s,true);
            return Math.abs(s.zoom-original)>1e-8;
        };
        this.pick=function(x,y) {
            var best=null,bestDepth=Infinity;
            samples.forEach(function(sample){var p=this.project(sample.p);if(Math.hypot(p.x-x,p.y-y)<12&&p.depth<bestDepth){best=sample;bestDepth=p.depth;}},this);
            return best;
        };
        this.panBy=function(dx,dy,s){fitTarget=null;this.fitAnimating=false;this.pan[0]-=dx*radius/(canvas.clientHeight*s.zoom);this.pan[1]+=dy*radius/(canvas.clientHeight*s.zoom);};
    }
    window.RegularizationScene=Scene;
}());
