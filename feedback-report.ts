// Feedback goes to Hub Nexus's own report route, the one hubnx.com's report-a-problem uses: its address, the
// limits it checks, the body it takes, and what its answers mean, kept here in step with the route. Hub Nexus
// names each app from its own list and takes an app's reports only from that app's origin, so the route answers
// Hub Nexus's own apps only.

export const FeedbackUrl = 'https://www.hubnx.com/api/feedback';

export const MessageMin = 10;
export const MessageMax = 5000;
export const EmailMax = 320;
/** The route takes up to 4,000,000 characters; a picture is shrunk until it fits under this, with room to spare. */
export const PictureMaxChars = 3_900_000;
/** The subject names the page, cut to this, well within the route's 150 characters. */
const SubjectPageMax = 80;
const UrlMax = 2000;

export type FeedbackKind = 'problem' | 'idea';

/** The app a report is about: its key in Hub Nexus's list, the name a visitor knows, and its support address. */
export interface FeedbackApp {
  key: string;
  name: string;
  support: string;
}

/** What the person wrote, the page it is about, and what the screen was, so a report can be acted on without asking. */
export interface FeedbackDraft {
  kind: FeedbackKind;
  message: string;
  email: string;
  /** The page's title. */
  about: string;
  url: string;
  viewport: {width: number; height: number};
  /** A PNG data URL, its marks already painted in. */
  picture?: string | undefined;
  context: {locale?: string | undefined; theme?: 'light' | 'dark' | undefined; dpr?: number | undefined; browser?: string | undefined};
}

/** Each a different thing to tell the person: sent; refused (most often a mistyped address); over the route's hourly limit; or not reached. */
export type FeedbackOutcome = 'sent' | 'refused' | 'limited' | 'failed';

/** Loose on purpose, so a typo is answered on its field before anything is sent; the route's check is the strict one. */
const EmailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Said on the email field, before sending and when the route refuses the address. */
export const EmailRefusal = "That doesn't look like an email address. Check it, or leave the box empty.";

/** What the form says on a field before sending, or null when the route would take it. */
export function draftProblem(message: string, email: string): {field: 'message' | 'email'; text: string} | null {
  if (message.trim().length < MessageMin) return {field: 'message', text: 'Say a little more: at least ten characters, so we know what to look at.'};
  if (message.trim().length > MessageMax) return {field: 'message', text: `Keep it under ${MessageMax.toLocaleString('en-US')} characters.`};
  const address = email.trim();
  if (address && (address.length > EmailMax || !EmailShape.test(address))) return {field: 'email', text: EmailRefusal};
  return null;
}

export function feedbackBody(app: FeedbackApp, draft: FeedbackDraft): Record<string, unknown> {
  const email = draft.email.trim();
  return {
    source: 'app',
    app: {name: app.key},
    kind: draft.kind,
    subject: `${draft.kind === 'idea' ? 'Idea' : 'Problem'}: ${draft.about.slice(0, SubjectPageMax)}`,
    message: draft.message.trim(),
    ...(email ? {email} : {}),
    ...(draft.url.length <= UrlMax ? {url: draft.url} : {}),
    viewport: `${draft.viewport.width}×${draft.viewport.height}`,
    ...(draft.picture ? {screenshot: draft.picture} : {}),
    context: draft.context,
  };
}

/** Sends a report to Hub Nexus. The route answers this site's origin across origins, never with cookies. */
export async function sendFeedback(body: Record<string, unknown>, post: typeof fetch = fetch): Promise<FeedbackOutcome> {
  try {
    const response = await post(FeedbackUrl, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
      credentials: 'omit',
    });
    if (response.ok) return 'sent';
    if (response.status === 429) return 'limited';
    if (response.status === 400) return 'refused';
    console.error('FEEDBACK_SEND_FAILED', response.status);
    return 'failed';
  } catch (error) {
    console.error('FEEDBACK_SEND_FAILED', error);
    return 'failed';
  }
}
