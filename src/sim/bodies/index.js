// Registry of body plans. A body plan supplies anthropometrics, a skeleton
// (joints + bones) and a pose generator. Future plans (goose, dog, bear...)
// plug in here and the renderer / recorder work unchanged.
import { humanPlan } from './human.js';

export const BODY_PLANS = {
  human: humanPlan,
};

export function getBodyPlan(id) {
  const plan = BODY_PLANS[id];
  if (!plan) throw new Error(`Unknown body plan: ${id}`);
  return plan;
}
