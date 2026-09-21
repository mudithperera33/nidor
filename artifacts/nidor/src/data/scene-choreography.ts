export type SceneTiming = {
  enter: readonly [number, number];
  hold: readonly [number, number];
  exit: readonly [number, number];
  gap: readonly [number, number];
};

export const sceneChoreography = {
  intro: {
    enter: [0, 0.018],
    hold: [0.018, 0.088],
    exit: [0.088, 0.1],
    gap: [0.1, 0.11],
  },
  bottleReveal: {
    enter: [0.11, 0.128],
    hold: [0.128, 0.198],
    exit: [0.198, 0.21],
    gap: [0.21, 0.22],
  },
  topNotes: {
    enter: [0.22, 0.238],
    hold: [0.238, 0.308],
    exit: [0.308, 0.32],
    gap: [0.32, 0.33],
  },
  heartNotes: {
    enter: [0.33, 0.348],
    hold: [0.348, 0.418],
    exit: [0.418, 0.43],
    gap: [0.43, 0.44],
  },
  baseNotes: {
    enter: [0.44, 0.458],
    hold: [0.458, 0.528],
    exit: [0.528, 0.54],
    gap: [0.54, 0.55],
  },
  story: {
    enter: [0.55, 0.572],
    hold: [0.572, 0.652],
    exit: [0.652, 0.67],
    gap: [0.67, 0.68],
  },
  finalProduct: {
    enter: [0.68, 0.7],
    hold: [0.7, 0.77],
    exit: [0.77, 0.79],
    gap: [0.79, 0.8],
  },
  order: {
    enter: [0.8, 0.83],
    hold: [0.83, 0.99],
    exit: [0.99, 1],
    gap: [1, 1],
  },
} satisfies Record<string, SceneTiming>;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value: number) {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
}

export function sceneVisibility(progress: number, timing: SceneTiming) {
  if (progress < timing.enter[0] || progress > timing.exit[1]) return 0;
  if (progress < timing.enter[1]) {
    return smoothstep((progress - timing.enter[0]) / Math.max(0.001, timing.enter[1] - timing.enter[0]));
  }
  if (progress <= timing.hold[1]) return 1;
  if (progress < timing.exit[1]) {
    return 1 - smoothstep((progress - timing.exit[0]) / Math.max(0.001, timing.exit[1] - timing.exit[0]));
  }
  return 0;
}