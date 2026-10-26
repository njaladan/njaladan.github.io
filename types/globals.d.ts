// Vendor libraries loaded as classic scripts (see assets/vendor/).
declare const L: any;
declare const maplibregl: any;
declare const topojson: any;

interface Window {
  L: any;
}

// Scroll-driven animations, which TypeScript's DOM types don't have yet.
declare class ScrollTimeline extends AnimationTimeline {
  constructor(options?: { source?: Element | null; axis?: 'block' | 'inline' | 'x' | 'y' });
}
