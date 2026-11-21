import {describe, expect, it} from 'vitest';
import {mailOptions, parseMailto} from './mail-options.ts';

const Request = 'mailto:typing@hubnx.com?subject=A%20wrong%20hint&body=The%20k%20hint%20says%20ring%20finger.%0AThanks';

describe('email links open a chooser, never a blank tab', () => {
  it('reads the address, subject and body of a mailto: link', () => {
    expect(parseMailto(Request)).toEqual({to: 'typing@hubnx.com', subject: 'A wrong hint', body: 'The k hint says ring finger.\nThanks'});
  });

  it('keeps a plus sign literal, as mailto: does', () => {
    expect(parseMailto('mailto:a@b.com?subject=1+1').subject).toBe('1+1');
  });

  it('keeps a stray "%" as written instead of throwing (a review, 2026-11-01)', () => {
    expect(parseMailto('mailto:a@b.com?subject=50%off').subject).toBe('50%off');
  });

  it('keeps a "?" or "=" inside a field instead of cutting the message off', () => {
    expect(parseMailto('mailto:a@b.com?subject=Why?&body=a=b')).toEqual({to: 'a@b.com', subject: 'Why?', body: 'a=b'});
  });

  it('opens Gmail and both Outlooks in a new tab with the same message', () => {
    const [gmail, personal, work] = mailOptions(parseMailto(Request));
    expect([gmail?.name, personal?.name, work?.name]).toEqual(['Gmail', 'Outlook.com', 'Outlook at work']);
    const gmailFields = new URL(gmail?.href ?? '').searchParams;
    expect([gmailFields.get('to'), gmailFields.get('su'), gmailFields.get('body')]).toEqual(['typing@hubnx.com', 'A wrong hint', 'The k hint says ring finger.\nThanks']);
    for (const outlook of [personal, work]) {
      const fields = new URL(outlook?.href ?? '').searchParams;
      expect([fields.get('to'), fields.get('subject')]).toEqual(['typing@hubnx.com', 'A wrong hint']);
    }
    expect([gmail, personal, work].every(option => option?.opens === 'new-tab')).toBe(true);
  });

  it('hands the mail app a plain mailto:, a bare address staying bare', () => {
    const app = mailOptions(parseMailto('mailto:typing@hubnx.com')).at(-1);
    expect(app).toMatchObject({name: 'Mail app', href: 'mailto:typing@hubnx.com', opens: 'mail-app'});
  });
});
