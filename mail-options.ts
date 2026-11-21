// What an email link offers in the chooser (email-chooser.ts): Gmail and Outlook on the web with
// the message already written, and the computer's own mail app.

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

export interface MailOption {
  name: string;
  hint: string;
  href: string;
  /** Webmail opens beside the page; the mail app needs the plain `mailto:`, followed in place. */
  opens: 'new-tab' | 'mail-app';
}

/** A stray "%" (as in "50%off") is kept as written rather than thrown on. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Splits at the first `separator` only: a subject may hold a "?" or an "=". */
function splitOnce(text: string, separator: string): [string, string] {
  const at = text.indexOf(separator);
  return at === -1 ? [text, ''] : [text.slice(0, at), text.slice(at + 1)];
}

/** `mailto:` keeps "+" literal, so the query is decoded by hand rather than by URLSearchParams. */
export function parseMailto(href: string): Mail {
  const [address, query] = splitOnce(href.replace(/^mailto:/i, ''), '?');
  const fields = new Map(
    query
      .split('&')
      .filter(Boolean)
      .map(pair => {
        const [name, value] = splitOnce(pair, '=');
        return [name.toLowerCase(), decoded(value)] as const;
      }),
  );
  return {to: decoded(address), subject: fields.get('subject') ?? '', body: fields.get('body') ?? ''};
}

/** Only fields with a value, so a bare address stays a bare `mailto:typing@hubnx.com`. */
function withFields(address: string, fields: Record<string, string>): string {
  const query = Object.entries(fields)
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('&');
  if (!query) return address;
  return `${address}${address.includes('?') ? '&' : '?'}${query}`;
}

// Personal accounts write at outlook.live.com, which keeps the message through sign-in; work and
// school accounts sign in at outlook.office.com (both checked signed out, 2026-11-01).
export function mailOptions({to, subject, body}: Mail): MailOption[] {
  return [
    {name: 'Gmail', hint: 'A Gmail or Google Workspace account', href: withFields('https://mail.google.com/mail/?view=cm&fs=1', {to, su: subject, body}), opens: 'new-tab'},
    {name: 'Outlook.com', hint: 'An Outlook, Hotmail or Live account', href: withFields('https://outlook.live.com/mail/0/deeplink/compose', {to, subject, body}), opens: 'new-tab'},
    {name: 'Outlook at work', hint: 'A Microsoft 365 work or school account', href: withFields('https://outlook.office.com/mail/deeplink/compose', {to, subject, body}), opens: 'new-tab'},
    {name: 'Mail app', hint: 'The mail app set up on this computer', href: withFields(`mailto:${to}`, {subject, body}), opens: 'mail-app'},
  ];
}
