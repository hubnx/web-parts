// The report pop-up, over whichever page it opens on (feedback-link.ts), as hubnx.com's report-a-problem:
// a picture of the page as it is (page-picture.ts), on which the person boxes what they mean and blacks
// out anything private, painted into the picture before it leaves the browser, beside the form
// (feedback-form.ts). Only a picture the person has seen is sent, with the boxes drawn before Send: Send
// pressed while it is still being taken sends the words alone, and the picture can't be drawn on while a
// report goes (a code review, 2026-11-05: an unseen picture went, and a box drawn during the send didn't).
// A picture that can't be taken never holds a report back: the words are the report. Closed unsent, the
// pop-up keeps the words for next time; each opening takes a fresh picture.

import {FeedbackForm, renderFeedbackForm} from './feedback-form.ts';
import type {FeedbackApp} from './feedback-report.ts';
import {paintMarks, takePagePicture, type Mark} from './page-picture.ts';
import {createPopup, popupHead} from './popup.ts';

/** A press without a drag draws nothing. */
const SmallestMark = 0.01;

class ReportPopup {
  readonly dialog = createPopup({className: 'feedback-popup', titleId: 'feedback-title'});
  sent = false;
  /** A report is on its way: nothing in it may change until Hub Nexus answers. */
  private sending = false;
  /** The picture being taken for this opening; one from an earlier opening, arriving late, is dropped. */
  private capture: Promise<string | null> = Promise.resolve(null);
  private marks: Mark[] = [];
  private drawing: Mark | null = null;
  private tool: Mark['tool'] = 'highlight';
  private readonly form: FeedbackForm;

  constructor(app: FeedbackApp) {
    this.dialog.innerHTML = `<div class="popup-body">
        ${popupHead('feedback-title', 'Send feedback')}
        <div class="feedback-layout" data-part="layout">
          <div class="feedback-picture-side" data-part="picture-side">
            <div class="feedback-picture" data-part="frame">
              <p class="feedback-picture-note" data-part="note"></p>
              <img alt="A picture of this page" draggable="false" data-part="image" hidden />
              <div class="feedback-marks" data-part="marks" aria-hidden="true"></div>
            </div>
            <div class="feedback-tools" data-part="tools">
              <div class="segmented" role="group" aria-label="What a box does">
                <button type="button" data-tool="highlight" aria-pressed="true">Highlight</button>
                <button type="button" data-tool="hide" aria-pressed="false">Hide</button>
              </div>
              <button type="button" class="button" data-action="undo" disabled>Undo</button>
              <p class="feedback-how">Drag on the picture to box what you mean. <em>Hide</em> blacks out anything private: it's painted into the picture before it's sent.</p>
            </div>
          </div>
          <div class="feedback-form-side" data-part="form">${renderFeedbackForm('report')}</div>
        </div>
        <div class="feedback-thanks" data-part="thanks" role="status" hidden>
          <p><strong>Thank you.</strong> Your report is on its way to us.</p>
          <button type="button" class="button button-primary" data-close>Close</button>
        </div>
      </div>`;
    this.form = new FeedbackForm(this.part('form'), {
      app,
      about: () => document.title,
      picture: () => this.finishedPicture(),
      busy: sending => this.lock(sending),
      sent: () => this.thank(),
    });
    this.part('tools').addEventListener('click', event => {
      const target = event.target as Element;
      const tool = target.closest<HTMLElement>('[data-tool]')?.dataset.tool as Mark['tool'] | undefined;
      if (tool) this.chooseTool(tool);
      if (target.closest('[data-action="undo"]')) this.setMarks(this.marks.slice(0, -1));
    });
    this.listenForDrawing(this.part('frame'));
  }

  open(): void {
    this.dialog.showModal();
    // Closed and opened again while its report is still going: the report stays as it is, locked, and the thanks
    // or the answer lands on it (a reopening once took a fresh picture and let new words be typed, which the
    // thanks then hid: a code review, 2026-11-11).
    if (this.sending) return;
    this.setMarks([]);
    this.showPicture(null, 'Taking a picture of this page…');
    // Taken while the person writes (a second or two); the pop-up itself is left out of it.
    const taking = takePagePicture(this.dialog);
    this.capture = taking;
    void taking.then(png => {
      if (this.capture === taking) this.showPicture(png, "This page couldn't be captured. Send the words: they're the report.");
    });
    // On a touch screen the keyboard that opens by itself would cover the picture the person is about to mark.
    if (!matchMedia('(pointer: coarse)').matches) this.form.focus();
  }

  /** While a report goes, the whole of it is locked: the picture can't be drawn on and the words can't be changed. */
  private lock(sending: boolean): void {
    this.sending = sending;
    this.part('layout').toggleAttribute('inert', sending);
  }

  /** The picture on screen with the marks painted in; none while it is still being taken, since the person hasn't seen it. */
  private async finishedPicture(): Promise<string | undefined> {
    const image = this.part('image') as HTMLImageElement;
    return this.part('frame').classList.contains('has-picture') && image.src ? paintMarks(image.src, this.marks) : undefined;
  }

  private showPicture(png: string | null, note: string): void {
    const image = this.part('image') as HTMLImageElement;
    // The frame has the screen's shape from the start, so nothing below it moves when the picture arrives.
    this.dialog.style.setProperty('--picture-ratio', String(innerWidth / Math.max(1, innerHeight)));
    this.part('frame').classList.toggle('has-picture', png !== null);
    image.hidden = png === null;
    if (png) image.src = png;
    else image.removeAttribute('src');
    this.part('note').textContent = png ? '' : note;
    // The tools keep their room while there is nothing to draw on.
    this.part('tools').classList.toggle('is-idle', png === null);
  }

  private chooseTool(tool: Mark['tool']): void {
    this.tool = tool;
    for (const button of this.part('tools').querySelectorAll<HTMLElement>('[data-tool]')) button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
  }

  /**
   * Boxes by mouse, pen or finger: the picture takes touches for itself (`touch-action` in web-parts.css)
   * and captures the pointer, and a cancelled gesture is finished like a released one, so what is on
   * screen is always what `paintMarks` paints.
   */
  private listenForDrawing(frame: HTMLElement): void {
    const point = (event: PointerEvent) => {
      const box = frame.getBoundingClientRect();
      const clamp = (value: number) => Math.min(1, Math.max(0, value));
      return {x: clamp((event.clientX - box.left) / box.width), y: clamp((event.clientY - box.top) / box.height)};
    };
    frame.addEventListener('pointerdown', event => {
      if (!frame.classList.contains('has-picture') || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      this.drawing = {...point(event), w: 0, h: 0, tool: this.tool};
      frame.setPointerCapture(event.pointerId);
      this.drawMarks();
    });
    frame.addEventListener('pointermove', event => {
      if (!this.drawing) return;
      const {x, y} = point(event);
      this.drawing = {...this.drawing, w: x - this.drawing.x, h: y - this.drawing.y};
      this.drawMarks();
    });
    const finish = () => {
      const mark = this.drawing;
      this.drawing = null;
      this.setMarks(mark && Math.abs(mark.w) > SmallestMark && Math.abs(mark.h) > SmallestMark ? [...this.marks, mark] : this.marks);
    };
    frame.addEventListener('pointerup', finish);
    frame.addEventListener('pointercancel', finish);
  }

  private setMarks(marks: Mark[]): void {
    this.marks = marks;
    (this.part('tools').querySelector('[data-action="undo"]') as HTMLButtonElement).disabled = marks.length === 0;
    this.drawMarks();
  }

  private drawMarks(): void {
    const percent = (value: number) => `${(value * 100).toFixed(3)}%`;
    this.part('marks').innerHTML = [...this.marks, ...(this.drawing ? [this.drawing] : [])]
      .map(mark => {
        const left = mark.w < 0 ? mark.x + mark.w : mark.x;
        const top = mark.h < 0 ? mark.y + mark.h : mark.y;
        return `<span class="feedback-mark" data-mark="${mark.tool}" style="left:${percent(left)};top:${percent(top)};width:${percent(Math.abs(mark.w))};height:${percent(Math.abs(mark.h))}"></span>`;
      })
      .join('');
  }

  private thank(): void {
    this.sent = true;
    this.dialog.classList.add('is-thanked');
    this.part('layout').hidden = true;
    this.part('thanks').hidden = false;
    this.part('thanks').querySelector('button')?.focus();
  }

  private part(name: string): HTMLElement {
    return this.dialog.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  }
}

let report: ReportPopup | null = null;

export function openFeedback(app: FeedbackApp): void {
  // A report sent, the next one starts blank.
  if (!report || report.sent) {
    report?.dialog.remove();
    report = new ReportPopup(app);
  }
  report.open();
}
