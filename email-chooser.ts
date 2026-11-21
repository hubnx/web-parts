// Email links open a chooser instead of the browser's mail program. In a fresh browser profile or a private
// window there is no mail program, so a `mailto:` opened in a new tab stayed blank (found 2026-11-01); with
// Gmail as the mail program, the same link in the same tab replaced the page.
// Without JavaScript the links stay new-tab `mailto:` links (external-links.ts). Importing this module installs
// the chooser, so only pages with an email link need load it; an app should test that each such page does.

import {NewTabAttributes, NewTabNote} from './external-links.ts';
import {escapeHtml} from './html.ts';
import {mailOptions, parseMailto, type Mail} from './mail-options.ts';
import {canPopUp, createPopup, isPlainClick, popupHead} from './popup.ts';

/** Marks the chooser's own mail-app link, which must reach the mail program instead of reopening the chooser. */
const MailAppMarker = 'data-mail-app';
const CopiedMs = 1600;

function chooserHtml(mail: Mail): string {
  const options = mailOptions(mail)
    .map(option => {
      const opens = option.opens === 'new-tab' ? NewTabAttributes : MailAppMarker;
      const note = option.opens === 'new-tab' ? NewTabNote : '';
      return `<a class="mail-option" href="${escapeHtml(option.href)}" ${opens}><strong class="mail-option-name">${option.name}</strong><span class="mail-option-hint">${option.hint}</span>${note}</a>`;
    })
    .join('');
  return `<div class="popup-body">
      ${popupHead('mail-chooser-title', 'Email us')}
      <p class="mail-chooser-to"><span>To</span><strong>${escapeHtml(mail.to)}</strong><button type="button" class="button" data-copy="${escapeHtml(mail.to)}">Copy</button></p>
      <div class="mail-options">${options}</div>
    </div>`;
}

/** Where the clipboard is missing (some in-app browsers, plain http) or refused, the address is
 * selected instead, ready for the visitor to copy. */
function copy(button: HTMLButtonElement): void {
  const label = button.textContent;
  const select = () => {
    const range = document.createRange();
    range.selectNodeContents(button.closest('.mail-chooser-to')?.querySelector('strong') ?? button);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    button.textContent = 'Selected';
  };
  try {
    navigator.clipboard.writeText(button.dataset.copy ?? '').then(() => {
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = label), CopiedMs);
    }, select);
  } catch {
    select();
  }
}

function createChooser(): HTMLDialogElement {
  const dialog = createPopup({className: 'mail-chooser', titleId: 'mail-chooser-title'});
  dialog.addEventListener('click', event => {
    const target = event.target as Element;
    const copyButton = target.closest<HTMLButtonElement>('[data-copy]');
    if (copyButton) copy(copyButton);
    // A chosen way to write closes it too, so it isn't still open when the visitor comes back to this tab.
    else if (target.closest('.mail-option')) dialog.close();
  });
  return dialog;
}

if (canPopUp) {
  let chooser: HTMLDialogElement | null = null;
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="mailto:"]') : null;
    if (!link || link.hasAttribute(MailAppMarker) || !isPlainClick(event)) return;
    const mail = parseMailto(link.getAttribute('href') ?? '');
    if (!mail.to) return;
    chooser ??= createChooser();
    chooser.innerHTML = chooserHtml(mail);
    chooser.showModal();
    // Last, so a failure above leaves the link's own `mailto:` working instead of a dead link.
    event.preventDefault();
  });
}
