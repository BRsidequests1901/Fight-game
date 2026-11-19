// Registry of body plans. A body plan supplies anthropometrics, a skeleton
// (joints + bones) and a pose generator. Renderer and recorder are generic.
import { humanPlan } from './human.js';
import { quadrupedPlan } from './quadruped.js';
import { birdPlan } from './bird.js';

export const BODY_PLANS = {
  human: humanPlan,
  quadruped: quadrupedPlan,
  bird: birdPlan,
};

export function getBodyPlan(id) {
  const plan = BODY_PLANS[id];
  if (!plan) throw new Error(`Unknown body plan: ${id}`);
  return plan;
}
