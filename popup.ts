// What an app site's pop-ups share (the email chooser, a leaderboard, a report): a `<dialog>` shaped by web-parts.css, closed by
// its × or a click on the backdrop. A click that began inside (selecting text, then
// letting go past the edge) lands on the backdrop too, and must not close it.

/** Browsers without `<dialog>` would show a pop-up's contents on the page; their links keep working as plain links. */
export const canPopUp = typeof HTMLDialogElement === 'function' && 'showModal' in HTMLDialogElement.prototype;

/** A click that opens a pop-up: a modified one (a new tab, a new window) is the visitor's own choice. */
export function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function createPopup({className, titleId}: {className: string; titleId: string}): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = `popup ${className}`;
  dialog.setAttribute('aria-labelledby', titleId);
  let pressedOnBackdrop = false;
  dialog.addEventListener('pointerdown', event => (pressedOnBackdrop = event.target === dialog));
  dialog.addEventListener('click', event => {
    const target = event.target as Element;
    if ((target === dialog && pressedOnBackdrop) || target.closest('[data-close]')) dialog.close();
  });
  document.body.append(dialog);
  return dialog;
}

/**
 * A site's lighter panels (a menu, a settings panel) are `popover`s: over the page, closed by
 * Esc or a click outside, with no script. Whether one is open; false where a browser doesn't know them,
 * and then shows them in the page.
 */
export function isPanelOpen(panel: Element): boolean {
  try {
    return panel.matches(':popover-open');
  } catch {
    return false;
  }
}

/**
 * A panel doesn't hold the keyboard as a pop-up does, so Tab past its last control closes it: keys never
 * reach the page behind an open panel (a review, 2026-11-05: Enter pressed past a panel reached the page behind it).
 */
export function closeWhenFocusLeaves(panel: HTMLElement): void {
  panel.addEventListener('focusout', event => {
    const next = event.relatedTarget;
    if (next instanceof Node && !panel.contains(next) && isPanelOpen(panel)) panel.hidePopover();
  });
}

/** Whether a pop-up or a panel is over the page: it has the keys, and the round behind it gets none. */
export function anythingOverPage(): boolean {
  return document.querySelector('dialog[open]') !== null || [...document.querySelectorAll('[popover]')].some(isPanelOpen);
}

/** A pop-up's title row, with its ×. */
export function popupHead(titleId: string, title: string): string {
  return `<div class="popup-head"><h2 id="${titleId}">${title}</h2><button type="button" class="popup-close" aria-label="Close" data-close>×</button></div>`;
}
