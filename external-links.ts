// A link that leaves the site, opens a plain file, or writes an email opens in a new tab: someone mid-task must
// not lose their place, and the page they came from stays where they left it. Applied to every page
// at build time (from the app's Vite config), so no page marks its own links and a new page cannot forget.
// `noopener` stops the new page reaching this one; the referrer stays, so the site linked to can see where
// its visitors came from. A link with a `download` attribute is left alone: it saves in place.
// An email link opens a tab too: with a webmail such as Gmail as the browser's
// mail program, a `mailto:` in the same tab replaces the page. It gets no ↗ and no spoken note,
// since it is not another site's page. That is only the no-JavaScript case: with scripts,
// email-chooser.ts opens a chooser instead. `tel:` and `#` links stay where they are.

/** The same markup for a link a script makes, which this build-time rewrite never sees. */
export const NewTabAttributes = 'target="_blank" rel="noopener"';
export const NewTabNote = '<span class="visually-hidden"> (opens in a new tab)</span>';

/** Quoted values removed, so words inside a title or alt can't pass for attributes. */
function attributeNames(attributes: string): string {
  return attributes.replace(/"[^"]*"|'[^']*'/g, '""');
}

/** A link marked `download` saves a file in place (even on another origin, such as a GitHub release): no tab. */
function savesAFile(attributes: string): boolean {
  return /\sdownload(?=[\s=]|$)/.test(attributes);
}

/** Documents, not pages: they have no way back into the site. */
const FileLink = /\.(txt|pdf)$/i;

const MailLink = /^mailto:/i;

function leavesThePage(href: string, siteUrl: string): boolean {
  // Absolute or protocol-relative ("//host"), in any letter case.
  if (/^(https?:)?\/\//i.test(href)) return new URL(href, siteUrl).origin !== new URL(siteUrl).origin;
  return MailLink.test(href) || FileLink.test(href.split(/[?#]/)[0] ?? '');
}

/** An attribute list, read quote by quote, so a ">" inside a value doesn't end the tag. */
const Attributes = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*`;
const Link = new RegExp(String.raw`<a\b(${Attributes}?)\shref="([^"]*)"(${Attributes})>([\s\S]*?)<\/a>`, 'g');

export function openOutboundLinksInNewTab(html: string, siteUrl: string): string {
  return html.replace(Link, (link, before: string, href: string, after: string, inner: string) => {
    const attributes = attributeNames(` ${before} ${after} `);
    if (!leavesThePage(href, siteUrl) || /\starget=/.test(attributes) || savesAFile(attributes)) return link;
    const note = MailLink.test(href) ? '' : NewTabNote;
    return `<a${before} href="${href}"${after} ${NewTabAttributes}>${inner}${note}</a>`;
  });
}
