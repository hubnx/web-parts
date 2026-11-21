import {describe, expect, it, vi} from 'vitest';
import {draftProblem, EmailRefusal, feedbackBody, FeedbackUrl, sendFeedback, type FeedbackApp, type FeedbackDraft} from './feedback-report.ts';

const app: FeedbackApp = {key: 'typing', name: 'Finger Trainer', support: 'typing@hubnx.com'};

const draft: FeedbackDraft = {
  kind: 'problem',
  message: '  The K key lights the wrong finger.  ',
  email: ' ada@example.com ',
  about: 'Typing Finger Trainer: Learn Which Finger Types Each Key',
  url: 'https://typing.hubnx.com/#practice',
  viewport: {width: 1280, height: 800},
  picture: 'data:image/png;base64,AAAA',
  context: {locale: 'en', theme: 'dark', dpr: 2, browser: 'Chrome'},
};

describe('a report as Hub Nexus takes it (its FeedbackSchema)', () => {
  it('names the app by its key in Hub Nexus\'s list, which only a page on its own origin may use, and the page in its subject', () => {
    expect(feedbackBody(app, draft)).toEqual({
      source: 'app',
      app: {name: 'typing'},
      kind: 'problem',
      subject: 'Problem: Typing Finger Trainer: Learn Which Finger Types Each Key',
      message: 'The K key lights the wrong finger.',
      email: 'ada@example.com',
      url: 'https://typing.hubnx.com/#practice',
      viewport: '1280×800',
      screenshot: 'data:image/png;base64,AAAA',
      context: {locale: 'en', theme: 'dark', dpr: 2, browser: 'Chrome'},
    });
    expect(feedbackBody(app, {...draft, kind: 'idea'}).subject).toMatch(/^Idea: /);
  });

  it('leaves out an empty address, a missing picture and an address too long for the route, rather than be refused for them', () => {
    const body = feedbackBody(app, {...draft, email: '  ', picture: undefined, url: `https://typing.hubnx.com/#${'x'.repeat(2000)}`});
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('screenshot');
    expect(body).not.toHaveProperty('url');
  });

  it('keeps the subject within the route’s 150 characters, however long the title', () => {
    expect((feedbackBody(app, {...draft, about: 'T'.repeat(400)}).subject as string).length).toBeLessThanOrEqual(150);
  });
});

describe('what the form refuses before sending', () => {
  it('a message under ten characters, as the route would, said on its field', () => {
    expect(draftProblem('  too short ', '')).toEqual({field: 'message', text: expect.stringContaining('ten characters')});
    expect(draftProblem('Long enough now', '')).toBeNull();
  });

  it('an address that is plainly not one; an empty one is fine, since the address is optional', () => {
    expect(draftProblem('Long enough now', 'ada@example')).toEqual({field: 'email', text: EmailRefusal});
    expect(draftProblem('Long enough now', '   ')).toBeNull();
  });
});

describe('sending to Hub Nexus', () => {
  const answering = (status: number) => vi.fn<typeof fetch>(async () => new Response('{}', {status}));

  it('posts JSON to the route with no cookies, which it never answers with', async () => {
    const post = answering(200);
    expect(await sendFeedback(feedbackBody(app, draft), post)).toBe('sent');
    const [url, init] = post.mock.calls[0]!;
    expect(url).toBe(FeedbackUrl);
    expect(init).toMatchObject({method: 'POST', credentials: 'omit', headers: {'content-type': 'application/json'}});
    expect(JSON.parse(init!.body as string).app).toEqual({name: 'typing'});
  });

  it('tells a refusal, the hourly limit and a failure apart, each said differently to the person', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await sendFeedback({}, answering(400))).toBe('refused');
    expect(await sendFeedback({}, answering(429))).toBe('limited');
    expect(await sendFeedback({}, answering(502))).toBe('failed');
    expect(await sendFeedback({}, async () => Promise.reject(new TypeError('Failed to fetch')))).toBe('failed');
  });
});
