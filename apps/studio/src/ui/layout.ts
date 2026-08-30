// Geometry shared by the timeline pieces. Everything is drawn in one SVG
// coordinate space; time maps linearly onto x.

export const WIDTH = 1400;
export const GUTTER = 96; // node labels
export const RIGHT = 24;
export const TOP = 56; // time axis and captions
export const LANE = 72;
export const LANE_PAD = 10;

export interface Scale {
  readonly x: (t: number) => number;
  readonly laneTop: (node: number) => number;
  readonly laneMid: (node: number) => number;
  readonly height: number;
  readonly plotLeft: number;
  readonly plotRight: number;
}

export function makeScale(duration: number, nodeCount: number): Scale {
  const plotLeft = GUTTER;
  const plotRight = WIDTH - RIGHT;
  const span = Math.max(duration, 1);
  return {
    x: (t) => plotLeft + (t / span) * (plotRight - plotLeft),
    laneTop: (node) => TOP + (node - 1) * LANE,
    laneMid: (node) => TOP + (node - 1) * LANE + LANE / 2,
    height: TOP + nodeCount * LANE + 16,
    plotLeft,
    plotRight,
  };
}

export function formatTime(t: number): string {
  return `${(t / 1000).toFixed(1)}s`;
}
