// The open-source licenses page every Hub Nexus app site ships. MIT,
// BSD, ISC and Apache require their notices to travel with every copy of the code, and a site is a copy, so the
// list is made at build time from the files the bundle actually read, never from a list someone keeps by hand.
// A package's own dependencies are listed with it: many packages (MapLibre among them) ship a file that already
// contains their dependencies' code, so the bundle never names those dependencies. Listing a notice too many
// costs nothing; leaving one out breaks the license.

import {existsSync, readdirSync, readFileSync, realpathSync, statSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {openOutboundLinksInNewTab} from './external-links.ts';
import {escapeHtml} from './html.ts';

export interface ShippedPackage {
  name: string;
  version: string;
  /** The SPDX expression from its package.json, such as "MIT" or "(MIT OR Apache-2.0)". */
  license: string;
  /** Where its source is, when its package.json says. */
  source?: string | undefined;
  /** Its LICENSE, COPYING, NOTICE and third-party notice files, whole. */
  notices: string[];
}

/** A notice the bundle can't see: a font served from `public/`, a data set, a model. */
export interface ExtraNotice {
  name: string;
  license: string;
  source?: string | undefined;
  text: string;
}

/** Where `<!--licenses-->` sits in the app's `licenses/index.html`, the list goes. */
export const LicensesPlaceholder = '<!--licenses-->';

/** The list's own class: the page is checked for it once written, so a placeholder lost on the way (a typo, a
 * minifier that strips comments) fails the build instead of shipping an empty page. */
const ListClass = 'license-list';

// A package's own notice, and the notices of code it bundles without declaring it (prettier keeps 251 packages'
// notices only in THIRD-PARTY-NOTICES.md; TypeScript, rolldown and vscode-jsonrpc ship such files too).
const NoticeFile = /^(licen[cs]es?|copying|notices?|third[-_ ]?party[-_ ]?(notices?|licen[cs]es?))([-._].*)?$/i;
/** A folder of license texts (REUSE's `LICENSES/`). */
const NoticeFolder = /^licen[cs]es$/i;

/** Module ids as Vite, esbuild and Windows write them: absolute or relative, with either slash. */
function slashed(moduleId: string): string {
  return (moduleId.split('?')[0] ?? '').replace(/\\/g, '/');
}

/** The folder of the installed package a module came from, or nothing for the app's own code and virtual modules.
 * A relative id (esbuild's metafile) stays relative, to the folder the build ran in. */
export function packageRoot(moduleId: string): string | undefined {
  const path = slashed(moduleId);
  if (path.startsWith('\0')) return undefined;
  const markers = [...path.matchAll(/(?:^|\/)node_modules\//g)];
  const last = markers.at(-1);
  if (!last) return undefined;
  const start = last.index + last[0].length;
  const parts = path.slice(start).split('/');
  const nameParts = parts[0]?.startsWith('@') ? 2 : 1;
  if (parts.length <= nameParts) return undefined;
  return path.slice(0, start) + parts.slice(0, nameParts).join('/');
}

/** Code a bundler writes in from its own package, under a virtual id: Vite's preload helper and polyfill, rolldown's
 * runtime. Only that package's own notice ships with it; the tool's dependencies (lightningcss, postcss…) run at
 * build time and never reach the bundle. */
const VirtualFrom: readonly {prefix: string; name: string}[] = [
  {prefix: '\0vite/', name: 'vite'},
  {prefix: '\0rolldown/', name: 'rolldown'},
];

/** Node's own lookup: the package's nested `node_modules`, then each folder above it (pnpm keeps a package's
 * dependencies beside it, which the second step finds). */
function installedDependency(name: string, fromRoot: string): string | undefined {
  for (let folder = resolve(fromRoot); ; folder = dirname(folder)) {
    const candidate = basename(folder) === 'node_modules' ? join(folder, name) : join(folder, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(folder) === folder) return undefined;
  }
}

interface PackageJson {
  name?: string;
  version?: string;
  license?: string | {type?: string};
  licenses?: {type?: string}[] | {type?: string};
  homepage?: string;
  repository?: string | {url?: string};
  dependencies?: Record<string, string>;
}

/** A repository as package.json writes it ("git+https://…", "github:a/b", "a/b", "git@github.com:a/b.git") as a page
 * address, else the homepage. */
function sourceOf(manifest: PackageJson): string | undefined {
  const repository = (typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url)?.trim();
  const url = repository
    ?.replace(/^git\+/, '')
    .replace(/^(git|ssh):\/\/(git@)?/, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/^(github|gitlab|bitbucket):/, (_, host: string) => `https://${host}.${host === 'bitbucket' ? 'org' : 'com'}/`)
    .replace(/^([\w.-]+\/[\w.-]+)$/, 'https://github.com/$1')
    .replace(/\.git$/, '');
  const candidate = url && /^https:\/\//.test(url) ? url : manifest.homepage;
  return candidate && /^https?:\/\//.test(candidate) ? candidate : undefined;
}

function licenseOf(manifest: PackageJson): string {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  // The old form: "licenses": [{"type": "MIT"}], or a single {"type": "MIT"}.
  const old = manifest.licenses;
  const types = (Array.isArray(old) ? old : old ? [old] : []).map(entry => entry.type).filter(Boolean);
  return types.length > 1 ? `(${types.join(' OR ')})` : (types[0] ?? '');
}

const ReadmeFile = /^readme(\.(md|markdown|txt))?$/i;

/** Words only a license's terms carry: a line naming a copyright and pointing elsewhere ("MIT licensed; see LICENSE")
 * is not the notice MIT asks to be copied. */
const LicenseTerms = /permission is hereby granted|permission to use, copy|redistribution and use|licensed under the apache license|the software is provided|this software is provided/i;

/** A README's "License" section, heading included, when it carries a copyright and the license's terms: some
 * packages (murmurhash-js) put their whole notice there and ship no license file. Headings inside a fenced code
 * block don't count, and "License" underlined with = or - is a heading too. */
export function licenseSectionOf(readme: string): string | undefined {
  const lines = readme.split(/\r?\n/);
  let fenced = false;
  const headings: {line: number; level: number; title: string}[] = [];
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) return;
    const atx = /^(#{1,6})\s+(.*)$/.exec(line);
    if (atx) headings.push({line: index, level: atx[1]?.length ?? 1, title: atx[2] ?? ''});
    else if (index > 0 && /^(=+|-+)\s*$/.test(line) && (lines[index - 1] ?? '').trim() !== '') {
      headings.push({line: index - 1, level: line.startsWith('=') ? 1 : 2, title: lines[index - 1] ?? ''});
    }
  });
  const start = headings.findIndex(heading => /^licen[cs]e\b/i.test(heading.title.trim()));
  const heading = headings[start];
  if (!heading) return undefined;
  const next = headings.slice(start + 1).find(other => other.level <= heading.level && other.line > heading.line);
  const section = lines.slice(heading.line, next?.line).join('\n').trim();
  return /copyright/i.test(section) && LicenseTerms.test(section) ? section : undefined;
}

function noticesIn(root: string): string[] {
  const entries = readdirSync(root);
  const isFile = (path: string) => statSync(path).isFile();
  const files = entries.filter(entry => isFile(join(root, entry)));
  const folders = entries.filter(entry => NoticeFolder.test(entry) && statSync(join(root, entry)).isDirectory());
  const notices = [
    ...files.filter(file => NoticeFile.test(file)).sort().map(file => join(root, file)),
    ...folders.flatMap(folder => readdirSync(join(root, folder)).sort().map(file => join(root, folder, file)).filter(isFile)),
  ].map(path => readFileSync(path, 'utf8').trim());
  if (notices.length > 0) return notices;
  const readme = files.find(file => ReadmeFile.test(file));
  const section = readme ? licenseSectionOf(readFileSync(join(root, readme), 'utf8')) : undefined;
  return section ? [section] : [];
}

/** Notices found at a package's source, by package name, for one that ships none (boolbase's repository has its
 * ISC notice; its package doesn't): each says where it was found. */
export type NoticesAtSource = Readonly<Record<string, string>>;

export interface ShippedPackagesOptions {
  atSource?: NoticesAtSource | undefined;
  /** Where the build ran, for relative module ids and for a bundler's own virtual modules (default: this process's
   * working folder). */
  buildFolder?: string;
}

/** Every package whose code the modules carry, with the packages each depends on, sorted by name. Throws, by
 * name, for a package with neither a license file nor a README section with its copyright and terms, unless its
 * notice was found at its source (`atSource`): a build must not ship code whose notice it can't show. */
export function shippedPackages(moduleIds: Iterable<string>, {atSource = {}, buildFolder = process.cwd()}: ShippedPackagesOptions = {}): ShippedPackage[] {
  const found = new Map<string, ShippedPackage>();
  const visited = new Set<string>();
  const pending: {root: string; withDependencies: boolean}[] = [];
  for (const id of moduleIds) {
    const virtual = VirtualFrom.find(tool => id.startsWith(tool.prefix));
    if (virtual) {
      const root = installedDependency(virtual.name, buildFolder);
      if (!root) throw new Error(`licenses-page: the bundle carries ${virtual.name}'s own code (${id}) but ${virtual.name} isn't installed above ${buildFolder}`);
      pending.push({root, withDependencies: false});
      continue;
    }
    const root = packageRoot(id);
    if (root) pending.push({root: resolve(buildFolder, root), withDependencies: true});
  }
  while (pending.length > 0) {
    const next = pending.pop() as {root: string; withDependencies: boolean};
    // The real folder: pnpm keeps a package's dependencies beside its real folder in its store, which a linked path
    // (preserveSymlinks, a path built by hand) never reaches.
    const root = realpathSync(next.root);
    const seen = `${root}\n${next.withDependencies}`;
    if (visited.has(seen)) continue;
    visited.add(seen);
    if (!existsSync(join(root, 'package.json'))) {
      throw new Error(`licenses-page: ${root} ships code but has no package.json to name it (generated code, such as node_modules/.prisma); add its notice as an extra and keep it out of the bundle's packages`);
    }
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson;
    if (!manifest.name) throw new Error(`licenses-page: ${root}/package.json has no name, so its package can't be listed`);
    if (next.withDependencies) {
      for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        const dependencyRoot = installedDependency(dependency, root);
        if (dependencyRoot) pending.push({root: dependencyRoot, withDependencies: true});
      }
    }
    // A linked package whose real folder is outside every node_modules is the app's own source (a workspace package,
    // or this one linked by path): its dependencies are listed, itself isn't a third party. Installed from git, this
    // package sits in node_modules and is listed like any other, under its MIT license.
    if (!/(^|\/)node_modules\//.test(slashed(root))) continue;
    const version = manifest.version ?? '';
    const key = `${manifest.name}@${version}`;
    if (found.has(key)) continue;
    const own = noticesIn(root);
    const notices = own.length > 0 ? own : atSource[manifest.name] ? [atSource[manifest.name] as string] : [];
    // Type definitions carry no code into the bundle.
    if (notices.length === 0 && manifest.name.startsWith('@types/')) continue;
    if (notices.length === 0) {
      throw new Error(`licenses-page: ${key} (${root}) ships no license file and no README license section with its copyright and terms; find its notice at its source before shipping it`);
    }
    found.set(key, {name: manifest.name, version, license: licenseOf(manifest), source: sourceOf(manifest), notices});
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function entry(name: string, detail: string, license: string, source: string | undefined, texts: string[]): string {
  const sourceLink = source ? `<p><a href="${escapeHtml(source)}">Source code</a></p>` : '';
  const text = texts.map(notice => `<pre class="license-text">${escapeHtml(notice)}</pre>`).join('');
  return `<li><details><summary><strong>${escapeHtml(name)}</strong>${detail ? ` ${escapeHtml(detail)}` : ''}${license ? ` · ${escapeHtml(license)}` : ''}</summary>${sourceLink}${text}</details></li>`;
}

/** The licenses a package may ship under for an app that may also be sold under its own license: permissive ones. */
const Permissive = new Set(['MIT', 'MIT-0', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'BlueOak-1.0.0', 'Python-2.0', 'Zlib', 'Unlicense', 'CC0-1.0', 'CC-BY-4.0']);

/** Whether an SPDX expression lets the code ship as permissive, read as SPDX's grammar reads it (AND binds tighter
 * than OR, parentheses group): a permissive license, a choice with a permissive one in it ("(MIT OR EUPL-1.1+)"), or
 * permissive ones all joined by AND. "(MIT OR Apache-2.0) AND GPL-3.0-only" is not: its GPL part is required. A
 * license WITH an exception counts as its license. */
export function permissive(expression: string): boolean {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const word = (text: string) => peek()?.toUpperCase() === text;
  const either = (): boolean => {
    let result = both();
    while (word('OR')) {
      at++;
      const other = both();
      result = result || other;
    }
    return result;
  };
  const both = (): boolean => {
    let result = single();
    while (word('AND')) {
      at++;
      const other = single();
      result = result && other;
    }
    return result;
  };
  const single = (): boolean => {
    const token = tokens[at++];
    if (token === '(') {
      const inner = either();
      if (tokens[at++] !== ')') throw new SyntaxError(`unbalanced "(" in "${expression}"`);
      return inner;
    }
    if (token === undefined || token === ')' || /^(AND|OR|WITH)$/i.test(token)) throw new SyntaxError(`a license is missing in "${expression}"`);
    if (word('WITH')) at += 2;
    return Permissive.has(token);
  };
  if (tokens.length === 0) return false;
  try {
    const result = either();
    return at === tokens.length && result;
  } catch {
    // An expression SPDX can't read is a license nobody has checked: not permissive, so it needs a decision.
    return false;
  }
}

/** Why each package that isn't permissive may still ship, by package name: a written decision (it's replaced, or it
 * isn't linked or shipped). */
export type LicenseDecisions = Readonly<Record<string, string>>;

/** Stops the build, naming each, for a package under GPL, AGPL, LGPL, MPL or another copyleft license, or with none,
 * unless a decision names it: an app sold under its own license beside its open one can't carry them unseen. */
export function refuseCopyleft(packages: readonly ShippedPackage[], decisions: LicenseDecisions = {}): void {
  const refused = packages.filter(item => !permissive(item.license) && !decisions[item.name]);
  if (refused.length > 0) throw new Error(`licenses-page: copyleft or unlicensed, with no written decision: ${refused.map(item => `${item.name}@${item.version} (${item.license || 'no license'})`).join(', ')}`);
}

/** The list for the page: one entry per package, each opening to its full notices; `first`, such as the upstream an
 * app is adapted from, ahead of the rest. */
export function renderLicenses(packages: readonly ShippedPackage[], extras: readonly ExtraNotice[] = [], first: readonly ExtraNotice[] = []): string {
  const items = [
    ...first.map(item => entry(item.name, '', item.license, item.source, [item.text])),
    ...packages.map(item => entry(item.name, item.version, item.license, item.source, item.notices)),
    ...extras.map(item => entry(item.name, '', item.license, item.source, [item.text])),
  ];
  return `<ul class="${ListClass}">\n${items.join('\n')}\n</ul>`;
}

const StyleFile = /\.(css|scss|sass|less|styl|stylus|pcss|postcss)$/;
const StyleImport = /@(?:import|use|forward)\s+(?:url\(\s*)?['"]([^'"]+)['"]/g;

/** The packages a stylesheet imports by name (`@import "tailwindcss"`, `@use "pkg/theme"`, `@import "~pkg/x.css"`):
 * Vite inlines them into the CSS outside the module graph, so the bundle's module ids never name them. */
export function packagesImportedBy(stylesheet: string): string[] {
  const names = [...stylesheet.matchAll(StyleImport)]
    .map(match => (match[1] ?? '').replace(/^~/, ''))
    .filter(specifier => specifier !== '' && !/^(\.|\/|[a-z][a-z0-9+.-]*:)/i.test(specifier))
    .map(specifier => {
      const parts = specifier.split('/');
      return (specifier.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/');
    });
  return [...new Set(names)];
}

/** The structural part of Vite's plugin types this needs, so this folder needs no Vite of its own. */
interface BuildContext {
  getModuleIds(): IterableIterator<string>;
}

interface OutputFile {
  type: 'asset' | 'chunk';
  fileName: string;
  source?: string | Uint8Array;
}

export interface LicensesPagePlugin {
  name: string;
  apply: 'build';
  buildEnd(this: BuildContext): void;
  transform: {order: 'pre'; handler(code: string, id: string): null};
  transformIndexHtml: {order: 'post'; handler(html: string): string};
  writeBundle(options: unknown, bundle: Record<string, OutputFile>): void;
}

export interface LicensesPageOptions {
  /** The site's own address, so the list's links to other sites open in a new tab as every other link does. */
  siteUrl: string;
  extras?: readonly ExtraNotice[] | undefined;
  /** Notices ahead of the packages, such as the upstream the app is adapted from. */
  first?: readonly ExtraNotice[] | undefined;
  /** Notices found at a package's source, for one that ships none. */
  atSource?: NoticesAtSource | undefined;
  /** Why a package that isn't permissive may still ship; any other stops the build. */
  decisions?: LicenseDecisions | undefined;
  /** The page's path in the output (default `licenses/index.html`), checked once written. */
  page?: string | undefined;
}

/**
 * The Vite plugin: put it in `plugins`, and again in `worker.plugins` when a worker imports packages of its own
 * (the same object: both builds add to one list). The page itself is the app's `licenses/index.html`, with
 * `<!--licenses-->` where the list goes. Vite runs a page's "post" HTML step after the bundle is complete
 * (its build-html plugin, in generateBundle), so every module is known by then; once written, the page is read back
 * and the build fails if its list isn't there.
 */
export function licensesPage(options: LicensesPageOptions): LicensesPagePlugin {
  const readFiles = new Set<string>();
  const page = options.page ?? 'licenses/index.html';
  return {
    name: 'hubnx-licenses-page',
    apply: 'build',
    // Before Vite's CSS step inlines a stylesheet's imports (rolldown's plugin context has no getWatchFiles to read
    // them from afterwards).
    transform: {
      order: 'pre',
      handler(code, id) {
        const path = slashed(id);
        if (!StyleFile.test(path)) return null;
        for (const name of packagesImportedBy(code)) {
          const root = installedDependency(name, dirname(path));
          if (root) readFiles.add(join(root, 'package.json'));
        }
        return null;
      },
    },
    buildEnd() {
      for (const id of this.getModuleIds()) readFiles.add(id);
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!html.includes(LicensesPlaceholder)) return html;
        const packages = shippedPackages(readFiles, {atSource: options.atSource});
        refuseCopyleft(packages, options.decisions);
        const list = openOutboundLinksInNewTab(renderLicenses(packages, options.extras, options.first), options.siteUrl);
        // A function, not the text: in a replacement string "$&", "$`" and "$$" are commands, and an escaped "$<" in
        // a license would have pasted the page into itself.
        return html.replace(LicensesPlaceholder, () => list);
      },
    },
    writeBundle(_options, bundle) {
      const written = bundle[page];
      if (!written) throw new Error(`licenses-page: the build wrote no ${page}; the site would ship without its licenses`);
      const source = typeof written.source === 'string' ? written.source : new TextDecoder().decode(written.source);
      if (!source.includes(`class="${ListClass}"`)) throw new Error(`licenses-page: ${page} was written without its list; is <!--licenses--> in it, and kept by every HTML step before this one?`);
    },
  };
}
