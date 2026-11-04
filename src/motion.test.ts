import { rootFact } from '@gershy/disk';
import png from './util/png.ts';
import type { Draw } from './util/draw.ts';
import { Pt } from './util/pt.ts';

(async () => {
  
  const fns = {
    circle: draw => {
      
      const turnsPerSec = 0.0095;
      const metersPerSec = 8;
      const secsPerTurn = 1 / turnsPerSec;
      const maxSecs = 100;
      
      for (let secs = 0; secs < maxSecs; secs += 1) {
        
        const circum = secsPerTurn * metersPerSec;
        const r = circum / (2 * Math.PI);
        
        const ang = turnsPerSec * secs * 2 * Math.PI;
        const x = 250 + Math.cos(ang) * r;
        const y = 250 + Math.sin(ang) * r;
        
        const red = Math.round(255 * (1 - (secs / maxSecs)));
        draw.circle({ pos: new Pt({ x: x - r, y }), r: 3, fill: `rgb(${red.toString(10)}, 0, 0)` });
        
      }
      
    },
    spiral: draw => {
      
      const turnsPerSec2 = 0.00001;
      const metersPerSec = 15;
      const maxSecs = 100;
      
      for (let scs = 0; scs < maxSecs; scs += 0.2) {
        
        const secs = scs;
        
        const turnsPerSec = turnsPerSec2 * 0.5 * secs ** 2;
        const secsPerTurn = 1 / turnsPerSec;
        
        const circum = secsPerTurn * metersPerSec;
        const r = circum / (2 * Math.PI);
        console.log(r);
        
        const ang = turnsPerSec * secs * 2 * Math.PI;
        const x = 500 + Math.cos(ang) * r;
        const y = 500 + Math.sin(ang) * r;
        
        const red = Math.round(255 * (1 - (secs / maxSecs)));
        draw.circle({ pos: new Pt({ x: x - r, y }), r: 2, fill: `rgb(${red.toString(10)}, 0, 0)` });
        
      }
      
      // const initAng = this.state.tur - tur * 0.25; // Quarter turn offset in the direction of turning
      
    },
    equalArcLength: draw => {
      
      const turnsPerSec2 = 0.0005;
      const metersPerSec = 10;
      const maxSecs = 100;
      const integrationStepSecs = 0.02;
      const renderStepSecs = 0.2;
      const path = [{ x: 0, y: 0, dist: 0 }];
      
      let x = 0;
      let y = 0;
      let dist = 0;
      for (let secs = 0; secs < maxSecs; secs += integrationStepSecs) {
        
        const dt = Math.min(integrationStepSecs, maxSecs - secs);
        const midSecs = secs + dt * 0.5;
        const ang = 2 * Math.PI * 0.5 * turnsPerSec2 * midSecs ** 2;
        const dx = metersPerSec * dt * Math.cos(ang);
        const dy = metersPerSec * dt * Math.sin(ang);
        x += dx;
        y += dy;
        dist += Math.hypot(dx, dy);
        path.push({ x, y, dist });
        
      }
      
      let pathInd = 1;
      const renderStepDist = metersPerSec * renderStepSecs;
      for (let targetDist = 0; targetDist <= dist; targetDist += renderStepDist) {
        
        while (pathInd < path.length - 1 && path[pathInd].dist < targetDist) pathInd++;
        const prev = path[pathInd - 1];
        const next = path[pathInd];
        const amt = (targetDist - prev.dist) / (next.dist - prev.dist);
        const secs = targetDist / metersPerSec;
        const red = Math.round(255 * (1 - secs / maxSecs));
        draw.circle({
          pos: new Pt({
            x: 500 + prev.x + (next.x - prev.x) * amt,
            y: 500 + prev.y + (next.y - prev.y) * amt,
          }),
          r: 2,
          fill: `rgb(${red.toString(10)}, 0, 0)`
        });
        
      }
      
    },
    integrated: draw => {
      
      const turnsPerSec2 = 0.0005;
      const metersPerSec = 10;
      const maxSecs = 100;
      const stepSecs = 0.2;
      
      let x = 500;
      let y = 500;
      for (let secs = 0; secs < maxSecs; secs += stepSecs) {
        
        const dt = Math.min(stepSecs, maxSecs - secs);
        const midSecs = secs + dt * 0.5;
        const ang = 2 * Math.PI * 0.5 * turnsPerSec2 * midSecs ** 2;
        x += metersPerSec * dt * Math.cos(ang);
        y += metersPerSec * dt * Math.sin(ang);
        
        const red = Math.round(255 * (1 - secs / maxSecs));
        draw.circle({ pos: new Pt({ x, y }), r: 2, fill: `rgb(${red.toString(10)}, 0, 0)` });
        
      }
      
    },
    eulerTaylorApprox: draw => {
      
      const turnPerSec2 = 0.05;
      const metersPerSec = 8;
      const maxSecs = 100;
      
      for (let secs = 0; secs < maxSecs; secs += 1) {
        
        // Total angle turned up to time t
        const a = 0.5 * turnPerSec2 * secs * secs;
        
        // // Power series approximation for Fresnel Integrals (highly accurate for early turns)
        // // x = t - t^5/40 + t^9/3456 - ...
        // // y = t^3/6 - t^7/336 + t^11/42240 - ...
        
        // Standard approximation terms
        const m = metersPerSec * secs;
        const x = 500 + m * (1 - a ** 2 / 10 + a ** 4 / 216);
        const y = 500 + m * (0 + a ** 1 /  3 - a ** 3 /  42 + a ** 5 / 1320);
        
        const red = Math.round(255 * (1 - (secs / maxSecs)));
        draw.circle({ pos: new Pt({ x, y }), r: 3, fill: `rgb(${red.toString(10)}, 0, 0)` });
        
      }
      
      // const initAng = this.state.tur - tur * 0.25; // Quarter turn offset in the direction of turning
      
    },
  } satisfies Obj<(draw: Draw) => void>;
  
  const fn: keyof (typeof fns) = 'spiral';
  
  await png({
    fact: rootFact.kid([ import.meta.dirname, `motion.${fn}.png` ]),
    w: 1000,
    h: 1000,
    frame: fns[fn]
  });
  
})()
  .catch(err => (console.log('FATAL', err), process.exit(1)));