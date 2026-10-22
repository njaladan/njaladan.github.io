// Animates the photo viewer's frame between the print on the map, the
// medium window and fullscreen, folding the header and footer away when the
// frame is as small as a print.

export const VIEWER_ANIMATION = { duration: 400, easing: 'cubic-bezier(.2,.8,.2,1)' };
// Frames this narrow (px) are the print itself: the chrome folds away.
const PRINT_FRAME_WIDTH = 60;
const STAGE_PADDING = { print: '3px', frame: '8px' };
// Corner radius of the medium window (px); fullscreen frames are square.
const FRAME_RADIUS = 10;

/**
 * @typedef {{left: number, top: number, width: number, height: number, radius?: number}} FrameBox
 * @typedef {{height: number, paddingTop: string, paddingBottom: string}} ChromeMetrics
 */

/** @param {HTMLElement[]} chrome @returns {ChromeMetrics[]} */
const chromeMetrics = chrome =>
  chrome.map(node => ({
    height: node.getBoundingClientRect().height,
    paddingTop: getComputedStyle(node).paddingTop,
    paddingBottom: getComputedStyle(node).paddingBottom
  }));

/** @param {FrameBox} box */
const framePose = box => ({
  left: `${box.left}px`,
  top: `${box.top}px`,
  width: `${box.width}px`,
  height: `${box.height}px`,
  borderRadius: `${box.radius ?? (box.width === innerWidth ? 0 : FRAME_RADIUS)}px`
});

/**
 * Folds the chrome and stage padding away (into a print) or back out, and
 * scales the photo between its print crop and the full frame.
 * @param {{chrome: HTMLElement[], stage: HTMLElement, image: HTMLElement}} parts
 * @param {{toPrint: boolean, before: ChromeMetrics[], after: ChromeMetrics[],
 *   photo: {width: number, height: number}}} change
 * @returns {Animation[]}
 */
function foldChrome({ chrome, stage, image }, { toPrint, before, after, photo }) {
  /** @param {Keyframe[]} frames expanded → folded */
  const order = frames => (toPrint ? frames : [...frames].reverse());
  const animations = chrome.map((node, index) => {
    const shown = toPrint ? before[index] : after[index];
    const large = { ...shown, height: `${shown.height}px`, opacity: 1 };
    const small = { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 };
    return node.animate(order([large, small]), VIEWER_ANIMATION);
  });
  animations.push(
    stage.animate(
      order([{ padding: STAGE_PADDING.frame }, { padding: STAGE_PADDING.print }]),
      VIEWER_ANIMATION
    )
  );
  // The print shows a square crop; scale so the photo's short side fills it.
  const crop = Math.max(photo.width / photo.height, photo.height / photo.width);
  animations.push(
    image.animate(
      order([{ transform: 'scale(1)' }, { transform: `scale(${crop})` }]),
      VIEWER_ANIMATION
    )
  );
  return animations;
}

/**
 * @param {{dialog: HTMLElement, stage: HTMLElement, image: HTMLElement, chrome: HTMLElement[]}} parts
 * @param {{reduceMotion: boolean, resized: () => void, settled: (animated: boolean) => void}} hooks
 *   `resized` runs once the frame has its final size; `settled` when it arrives.
 */
export function createFrameMotion(parts, { reduceMotion, resized, settled }) {
  const { dialog, chrome } = parts;
  /** @type {Animation | null} */
  let motion = null;
  /** @type {Animation[]} */
  let chromeMotions = [];
  function stop() {
    chromeMotions.forEach(animation => animation.cancel());
    chromeMotions = [];
    if (!motion) return;
    const current = motion;
    motion = null;
    current.cancel();
    dialog.classList.remove('photo-resizing');
  }
  /**
   * Moves the frame to `to`, animating from `from` when given.
   * @param {FrameBox | null} from
   * @param {FrameBox} to
   * @param {{photo: {width: number, height: number}, complete?: () => void}} options
   */
  function move(from, to, { photo, complete }) {
    stop();
    const before = chromeMetrics(chrome);
    const { left, top, width, height } = framePose(to);
    Object.assign(dialog.style, { left, top, width, height });
    resized();
    if (reduceMotion || !from) {
      settled(false);
      complete?.();
      return;
    }
    const after = chromeMetrics(chrome);
    dialog.classList.add('photo-resizing');
    const animation = dialog.animate([framePose(from), framePose(to)], VIEWER_ANIMATION);
    motion = animation;
    if (from.width <= PRINT_FRAME_WIDTH || to.width <= PRINT_FRAME_WIDTH) {
      chromeMotions = foldChrome(parts, {
        toPrint: to.width <= PRINT_FRAME_WIDTH,
        before,
        after,
        photo
      });
    }
    animation.finished.then(
      () => {
        if (motion !== animation) return;
        motion = null;
        chromeMotions.forEach(item => item.cancel());
        chromeMotions = [];
        dialog.classList.remove('photo-resizing');
        settled(true);
        complete?.();
      },
      // Cancelled by a newer move, which owns the frame now.
      () => {}
    );
  }
  return {
    stop,
    move,
    get active() {
      return motion !== null;
    }
  };
}
