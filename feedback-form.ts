// The feedback form, in the report pop-up (feedback-dialog.ts, beside a picture of the page) and on the
// app's own feedback page: what it asks, what it says on a field before sending, and what each
// of Hub Nexus's answers means to the person (feedback-report.ts).

import {draftProblem, EmailMax, EmailRefusal, feedbackBody, MessageMax, sendFeedback, type FeedbackApp, type FeedbackKind} from './feedback-report.ts';

const MessageLabels: Record<FeedbackKind, string> = {problem: 'What went wrong?', idea: 'What would make this better?'};
const notSent = (app: FeedbackApp) => `That didn't send. Your words are still here: try again in a moment, or write to ${app.support}.`;
const limited = (app: FeedbackApp) => `You've sent several reports this hour. Try again later, or write to ${app.support}.`;

/** The form's markup; `id` keeps its fields' ids apart from anything else on the page. */
export function renderFeedbackForm(id: string): string {
  return `<form class="feedback-form" novalidate>
      <div class="segmented" role="group" aria-label="Kind of feedback">
        <button type="button" data-kind="problem" aria-pressed="true">Problem</button>
        <button type="button" data-kind="idea" aria-pressed="false">Idea</button>
      </div>
      <label for="${id}-message" data-part="message-label">${MessageLabels.problem}</label>
      <textarea id="${id}-message" name="message" rows="6" maxlength="${MessageMax}" aria-describedby="${id}-message-error"></textarea>
      <p class="field-error" id="${id}-message-error" data-part="message-error" hidden></p>
      <label for="${id}-email">Your email <span class="muted">(optional, so we can reply)</span></label>
      <input id="${id}-email" name="email" type="email" maxlength="${EmailMax}" autocomplete="email" aria-describedby="${id}-email-error" />
      <p class="field-error" id="${id}-email-error" data-part="email-error" hidden></p>
      <div class="feedback-send">
        <p class="form-status" data-part="status" role="status"></p>
        <button class="button button-primary" type="submit">Send</button>
      </div>
    </form>`;
}

export interface FeedbackFormOptions {
  app: FeedbackApp;
  /** What the report is about: the page's title. */
  about: () => string;
  /** The page's picture with its marks painted in, or undefined to send the words alone. */
  picture: () => Promise<string | undefined>;
  /** A report is on its way (true), or came back unsent (false): nothing that goes in it may change meanwhile. */
  busy?: (sending: boolean) => void;
  sent: () => void;
}

export class FeedbackForm {
  private kind: FeedbackKind = 'problem';
  private readonly options: FeedbackFormOptions;
  private readonly form: HTMLFormElement;
  private readonly message: HTMLTextAreaElement;
  private readonly email: HTMLInputElement;
  private readonly button: HTMLButtonElement;

  constructor(root: HTMLElement, options: FeedbackFormOptions) {
    this.options = options;
    this.form = root.querySelector('form')!;
    this.message = this.form.querySelector('textarea')!;
    this.email = this.form.querySelector('input[type="email"]')!;
    this.button = this.form.querySelector('button[type="submit"]')!;
    this.form.addEventListener('click', event => {
      const choice = (event.target as Element).closest<HTMLElement>('[data-kind]');
      if (choice) this.choose(choice.dataset.kind as FeedbackKind);
    });
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      void this.send();
    });
    // A field's refusal goes once the person changes it.
    for (const field of ['message', 'email'] as const) this[field].addEventListener('input', () => this.clearRefusal(field));
  }

  focus(): void {
    this.message.focus({preventScroll: true});
  }

  private choose(kind: FeedbackKind): void {
    this.kind = kind;
    for (const button of this.form.querySelectorAll<HTMLElement>('[data-kind]')) button.setAttribute('aria-pressed', String(button.dataset.kind === kind));
    this.part('message-label').textContent = MessageLabels[kind];
  }

  private async send(): Promise<void> {
    const problem = draftProblem(this.message.value, this.email.value);
    if (problem) {
      this.refuse(problem.field, problem.text);
      return;
    }
    this.button.disabled = true;
    this.options.busy?.(true);
    this.say('Sending…');
    // The words go even when the picture can't be painted.
    const picture = await this.options.picture().catch(error => {
      console.error('FEEDBACK_PICTURE_FAILED', error);
      return undefined;
    });
    const outcome = await sendFeedback(
      feedbackBody(this.options.app, {
        kind: this.kind,
        message: this.message.value,
        email: this.email.value,
        about: this.options.about(),
        url: location.href,
        viewport: {width: innerWidth, height: innerHeight},
        picture,
        context: {
          locale: document.documentElement.lang || undefined,
          theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
          dpr: devicePixelRatio,
          browser: navigator.userAgent.slice(0, 300),
        },
      }),
    );
    this.button.disabled = false;
    if (outcome !== 'sent') this.options.busy?.(false);
    if (outcome === 'sent') {
      this.say('');
      this.options.sent();
    } else if (outcome === 'refused' && this.email.value.trim()) {
      // The message was checked before sending; Hub Nexus's address check is the stricter one.
      this.say('');
      this.refuse('email', EmailRefusal);
    } else {
      this.say(outcome === 'limited' ? limited(this.options.app) : notSent(this.options.app));
    }
  }

  /** The line under the field, and the focus on the field. */
  private refuse(field: 'message' | 'email', text: string): void {
    const line = this.part(`${field}-error`);
    line.textContent = text;
    line.hidden = false;
    this[field].setAttribute('aria-invalid', 'true');
    this[field].focus();
  }

  private clearRefusal(field: 'message' | 'email'): void {
    this.part(`${field}-error`).hidden = true;
    this[field].removeAttribute('aria-invalid');
  }

  private say(text: string): void {
    this.part('status').textContent = text;
  }

  private part(name: string): HTMLElement {
    return this.form.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  }
}
