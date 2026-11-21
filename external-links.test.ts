import {describe, expect, it} from 'vitest';
import {openOutboundLinksInNewTab} from './external-links.ts';

const Site = 'https://typing.hubnx.com';
const run = (html: string) => openOutboundLinksInNewTab(html, Site);

describe('links that open in a new tab', () => {
  it('keeps a ">" inside an attribute value from breaking the tag (a code review, 2026-11-01)', () => {
    expect(run('<a href="https://x.com" title="a>b">X</a>')).toBe('<a href="https://x.com" title="a>b" target="_blank" rel="noopener">X<span class="visually-hidden"> (opens in a new tab)</span></a>');
  });

  it('opens other sites written protocol-relative or in capitals, but not its own', () => {
    expect(run('<a href="//x.com/a">X</a>')).toContain('target="_blank"');
    expect(run('<a href="HTTPS://X.COM">X</a>')).toContain('target="_blank"');
    expect(run('<a href="//typing.hubnx.com/about/">About</a>')).not.toContain('target=');
  });

  it('opens another site, safely and with a spoken note', () => {
    const out = run('<a href="https://hubnx.com">Hub Nexus</a>');
    expect(out).toContain('target="_blank" rel="noopener"');
    expect(out).toContain('(opens in a new tab)');
    expect(out).not.toContain('noreferrer');
  });

  it('opens plain files, whichever way they are written', () => {
    expect(run('<a href="/licenses/scowl.txt">SCOWL</a>')).toContain('target="_blank"');
    expect(run('<a href="/guide.PDF#page=2">Guide</a>')).toContain('target="_blank"');
  });

  it('opens an email link in a tab too, without the note meant for other sites', () => {
    const out = run('<a href="mailto:typing@hubnx.com">typing@hubnx.com</a>');
    expect(out).toContain('target="_blank" rel="noopener"');
    expect(out).not.toContain('opens in a new tab');
    expect(run('<a href="MAILTO:a@b.co">a</a>')).toContain('target="_blank"');
  });

  it('leaves the site\'s own pages, phone links and in-page jumps alone', () => {
    for (const html of [
      '<a href="/about/">About</a>',
      `<a href="${Site}/privacy/">Privacy</a>`,
      '<a href="#progress" data-view-link="progress">Progress</a>',
      '<a href="tel:+15550100">Call</a>',
    ]) {
      expect(run(html)).toBe(html);
    }
  });

  it('keeps the link\'s other attributes and does not mark one twice', () => {
    expect(run('<a class="x" href="https://hubnx.com" data-y="1">Hub</a>')).toContain('class="x" href="https://hubnx.com" data-y="1" target="_blank"');
    const marked = '<a href="https://hubnx.com" target="_blank" rel="noopener">Hub</a>';
    expect(run(marked)).toBe(marked);
  });

  it('leaves a download button alone, even on another origin', () => {
    for (const html of [
      '<a href="https://github.com/hubnx/x/releases/download/v1/x.dmg" download>Download</a>',
      '<a class="button" download="x.dmg" href="https://github.com/hubnx/x/releases/download/v1/x.dmg">Download</a>',
    ]) {
      expect(run(html)).toBe(html);
    }
  });

  it('counts download only as a whole attribute, not inside another attribute or a value', () => {
    expect(run('<a href="https://hubnx.com" data-download="1">Hub</a>')).toContain('target="_blank"');
    expect(run('<a href="https://hubnx.com" title="please download it">Hub</a>')).toContain('target="_blank"');
  });

  it('marks each link on a line separately', () => {
    const out = run('<a href="/about/">A</a> <a href="https://hubnx.com">B</a> <a href="/terms/">C</a>');
    expect(out.match(/target="_blank"/g)).toHaveLength(1);
  });
});
