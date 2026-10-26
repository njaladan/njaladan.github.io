// Non-modal side panel that slides in beside the map and closes after its
// slide-out transition, so the map can resize alongside it.

// Used when the panel has no transition duration in CSS (seconds).
const FALLBACK_SLIDE_SECONDS = 0.34;

/**
 * @param {HTMLDialogElement} panel
 * @param {{onToggle: (open: boolean, resize?: boolean) => void}} options
 */
export function createSlidingPanel(panel, { onToggle }) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let closeTimer = null;
  return {
    /** Fully open and not sliding out. */
    isOpen: () => panel.open && closeTimer === null,
    /**
     * The map makes room for the panel as it slides in; a fitted view already does.
     * @param {boolean} fitted
     */
    show(fitted) {
      const opening = !panel.open || closeTimer !== null;
      clearTimeout(closeTimer);
      closeTimer = null;
      if (!panel.open) {
        panel.show();
        // Start off-screen, then slide in beside the map.
        panel.classList.remove('is-visible');
        // Reading layout commits the off-screen position before the transition.
        void panel.offsetWidth;
      }
      panel.classList.add('is-visible');
      if (opening) onToggle(true, !fitted);
    },
    /** Slides the panel out, closing the dialog once the transition ends. */
    hide() {
      panel.classList.remove('is-visible');
      onToggle(false);
      const finish = () => {
        closeTimer = null;
        panel.close();
      };
      const seconds =
        parseFloat(getComputedStyle(panel).transitionDuration) || FALLBACK_SLIDE_SECONDS;
      closeTimer = setTimeout(finish, seconds * 1000);
    }
  };
}
