// Every page's feedback links (the menu's, the footer's) open the report pop-up over the page, with a picture
// of it (feedback-dialog.ts). A modified click, a browser without pop-ups, and the feedback page itself, which
// carries the form, keep to the page. Each app calls this once, from the script its header loads.

import type {FeedbackApp} from './feedback-report.ts';
import {canPopUp, isPlainClick} from './popup.ts';

export function openFeedbackLinksAsPopup(app: FeedbackApp): void {
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href="/feedback/"]') : null;
    if (!link || !canPopUp || !isPlainClick(event) || location.pathname === '/feedback/') return;
    event.preventDefault();
    import('./feedback-dialog.ts').then(
      ({openFeedback}) => openFeedback(app),
      error => {
        console.error('FEEDBACK_POPUP_FAILED', error);
        location.href = link.href;
      },
    );
  });
}
