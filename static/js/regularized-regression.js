/* Two-coefficient least squares with L1/L2/Elastic penalties. */
(function () {
    'use strict';
    function model(points) {
        var n=points.length, mx=0,my=0,xx=0,xy=0,yy=0;
        points.forEach(function(p){mx+=p.x;my+=p.y;xx+=p.x*p.x;xy+=p.x*p.y;yy+=p.y*p.y;});
        mx/=n;my/=n;xx/=n;xy/=n;yy/=n;
        var variance=Math.max(0,xx-mx*mx), slope=variance>1e-12?(xy-mx*my)/variance:0;
        var ordinary=[my-slope*mx,slope];
        function loss(b,m) { return Math.max(0,yy-2*b*my-2*m*xy+b*b+2*b*m*mx+m*m*xx); }
        function gradient(b,m){return {dw1:2*(b+m*mx-my),dw2:2*(b*mx+m*xx-xy)};}
        function fit(type,lambda,alpha,penalizeIntercept) {
            if(type==='none'||lambda===0) return ordinary.slice();
            var l1=lambda*(type==='l1'?1:type==='elastic'?alpha:0),l2=lambda*(type==='l2'?1:type==='elastic'?1-alpha:0);
            var b=ordinary[0],m=ordinary[1];
            function soft(v,t){return Math.sign(v)*Math.max(0,Math.abs(v)-t);}
            for(var i=0;i<10000;i++) {
                var nextB=penalizeIntercept?soft(my-m*mx,l1/2)/(1+l2):my-m*mx;
                var nextM=xx+l2>1e-12?soft(xy-nextB*mx,l1/2)/(xx+l2):0;
                var change=Math.max(Math.abs(nextB-b),Math.abs(nextM-m));b=nextB;m=nextM;if(change<1e-10)break;
            }
            return [b,m];
        }
        function fitBudget(type,budget,alpha,penalizeIntercept) {
            function cost(w) {
                var b=penalizeIntercept?w[0]:0,m=w[1];
                var l1=Math.abs(b)+Math.abs(m),l2=b*b+m*m;
                return type==='l1'?l1:type==='l2'?l2:type==='elastic'?alpha*l1+(1-alpha)*l2:0;
            }
            if(type==='none'||cost(ordinary)<=budget)return ordinary.slice();
            if(budget<=0)return [penalizeIntercept?0:my,0];
            var lo=0,hi=1,result=fit(type,hi,alpha,penalizeIntercept);
            while(cost(result)>budget&&hi<1e16){hi*=2;result=fit(type,hi,alpha,penalizeIntercept);}
            for(var i=0;i<70;i++) {
                var mid=(lo+hi)/2,w=fit(type,mid,alpha,penalizeIntercept);
                if(cost(w)>budget)lo=mid;else {hi=mid;result=w;}
            }
            return result;
        }
        return {ordinary:ordinary,loss:loss,gradient:gradient,fit:fit,fitBudget:fitBudget};
    }
    window.RegularizedRegression={model:model};
}());
