import {mkdirSync, symlinkSync, writeFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {licensesPage, LicensesPlaceholder, packageRoot, packagesImportedBy, permissive, refuseCopyleft, renderLicenses, shippedPackages} from './licenses.ts';
import {Mit, packageStore, type PackageStore} from './test-packages.ts';

let store: PackageStore;

/** What Vite's build hands buildEnd: the module graph and the files read beside it. */
function buildOf(moduleIds: string[]) {
  return {getModuleIds: () => moduleIds[Symbol.iterator]()};
}

beforeEach(() => {
  store = packageStore();
});
afterEach(() => store.remove());

describe('packageRoot: the package a bundled module came from', () => {
  it('finds a plain and a scoped package inside pnpm\'s store, and ignores the app\'s own code and virtual modules', () => {
    expect(packageRoot('/app/node_modules/.pnpm/earcut@3.2.4/node_modules/earcut/src/earcut.js')).toBe('/app/node_modules/.pnpm/earcut@3.2.4/node_modules/earcut');
    expect(packageRoot('/app/node_modules/.pnpm/@mapbox+tiny-sdf@2.3.0/node_modules/@mapbox/tiny-sdf/index.js?commonjs')).toBe('/app/node_modules/.pnpm/@mapbox+tiny-sdf@2.3.0/node_modules/@mapbox/tiny-sdf');
    expect(packageRoot('/app/src/main.ts')).toBeUndefined();
    expect(packageRoot('\0vite/preload-helper.js')).toBeUndefined();
  });
});

describe('shippedPackages: every notice the bundle must carry (MIT, BSD, ISC and Apache require them with every copy)', () => {
  it('lists a bundled package with its full license file, and the dependencies its prebuilt file folds in', () => {
    const map = store.install('map-lib', '6.0.0', {LICENSE: 'Copyright (c) Map Lib contributors\nBSD-3-Clause text', license: 'BSD-3-Clause'}, {earcut: '^3.0.0'});
    store.linkBeside(map, store.install('earcut', '1.0.0', {LICENSE: 'ISC'}), 'earcut');
    const found = shippedPackages([join(map, 'dist', 'map-lib.mjs')]);
    expect(found.map(item => item.name)).toEqual(['earcut', 'map-lib']);
    const mapLib = found.find(item => item.name === 'map-lib');
    expect(mapLib?.notices).toEqual(['Copyright (c) Map Lib contributors\nBSD-3-Clause text']);
    expect(mapLib?.license).toBe('BSD-3-Clause');
    expect(mapLib?.source).toBe('https://github.com/example/map-lib');
  });

  it('keeps every notice file a package ships (an Apache package\'s NOTICE beside its LICENSE)', () => {
    const root = store.install('apache-lib', '2.0.0', {LICENSE: 'Apache License 2.0', NOTICE: 'This product includes software by Example.', license: 'Apache-2.0'});
    expect(shippedPackages([join(root, 'index.js')])[0]?.notices).toEqual(['Apache License 2.0', 'This product includes software by Example.']);
  });

  it('lists a package once however many of its modules the bundle read', () => {
    const root = store.install('one', '1.0.0', {'LICENSE.md': 'MIT'});
    expect(shippedPackages([join(root, 'a.js'), join(root, 'b.js'), join(root, 'c.js')])).toHaveLength(1);
  });

  it('fails the build, naming the package, when it ships no license file', () => {
    const root = store.install('silent', '0.1.0', {'index.js': ''});
    expect(() => shippedPackages([join(root, 'index.js')])).toThrow(/licenses-page: silent@0\.1\.0 .*ships no license file/);
  });

  it('takes a notice found at the package\'s source when it ships none (boolbase\'s repository has its ISC notice)', () => {
    const root = store.install('silent', '0.1.0', {'index.js': ''});
    const [found] = shippedPackages([join(root, 'index.js')], {atSource: {silent: 'ISC License\nCopyright (c) Silent\n(from its repository)'}});
    expect(found?.notices).toEqual(['ISC License\nCopyright (c) Silent\n(from its repository)']);
  });

  it('takes a README’s License section when there is no license file, as murmurhash-js ships its notice', () => {
    const root = store.install('hash', '1.0.0', {'README.md': '# hash\n\nFast.\n\n## License (MIT)\n\nCopyright (c) 2011 Someone\n\nPermission is hereby granted…\n\n## Thanks\n\nNot the license.'});
    expect(shippedPackages([join(root, 'index.js')])[0]?.notices).toEqual(['## License (MIT)\n\nCopyright (c) 2011 Someone\n\nPermission is hereby granted…']);
  });

  it('still fails when the README’s section names no copyright: "MIT" alone isn’t the notice MIT asks for', () => {
    const root = store.install('bare', '1.0.0', {'README.md': '# bare\n\n## License\n\nMIT'});
    expect(() => shippedPackages([join(root, 'index.js')])).toThrow(/licenses-page: bare@1\.0\.0/);
  });
});

describe('renderLicenses', () => {
  it('escapes the notices, so a license\'s "<" can\'t break the page', () => {
    const html = renderLicenses([{name: 'x', version: '1.0.0', license: 'MIT', notices: ['Copyright <Someone> & co']}]);
    expect(html).toContain('Copyright &lt;Someone&gt; &amp; co');
    expect(html).not.toContain('<Someone>');
  });
});

describe('licensesPage: the Vite plugin', () => {
  it('fills only the page that carries the placeholder, with outbound links opened in a new tab', () => {
    const root = store.install('lib', '1.0.0', {LICENSE: 'MIT text'});
    const plugin = licensesPage({siteUrl: 'https://globe.hubnx.com', extras: [{name: 'Noto Sans', license: 'OFL-1.1', text: 'SIL Open Font License'}]});
    plugin.buildEnd.call(buildOf([join(root, 'index.js')]));
    const page = plugin.transformIndexHtml.handler(`<main>${LicensesPlaceholder}</main>`);
    expect(page).toContain('<strong>lib</strong> 1.0.0 · MIT');
    expect(page).toContain('<strong>Noto Sans</strong>');
    expect(page).toMatch(/<a href="https:\/\/github\.com\/example\/lib" target="_blank" rel="noopener">/);
    expect(plugin.transformIndexHtml.handler('<main>other page</main>')).toBe('<main>other page</main>');
  });
});

describe('refuseCopyleft: what an app sold under its own license beside its open one can ship', () => {
  it('passes permissive licenses, a choice with a permissive one in it, and permissive ones joined by AND', () => {
    for (const license of ['MIT', 'ISC', 'BSD-3-Clause', 'Apache-2.0', '(MIT OR EUPL-1.1+)', '(BSD-3-Clause OR GPL-2.0)', 'MIT AND Zlib', 'BlueOak-1.0.0']) expect(permissive(license), license).toBe(true);
    for (const license of ['GPL-3.0', 'AGPL-3.0-only', 'LGPL-2.1', 'MPL-2.0', '', 'UNLICENSED', 'MIT AND GPL-2.0']) expect(permissive(license), license).toBe(false);
  });

  it('stops the build for a copyleft or unlicensed package, unless a written decision names it', () => {
    const shipped = [{name: 'gpl-thing', version: '1.0.0', license: 'GPL-3.0', notices: ['GPL']}, {name: 'fine', version: '1.0.0', license: 'MIT', notices: ['MIT']}];
    expect(() => refuseCopyleft(shipped)).toThrow(/licenses-page: copyleft or unlicensed, with no written decision: gpl-thing@1\.0\.0 \(GPL-3\.0\)/);
    expect(() => refuseCopyleft(shipped, {'gpl-thing': 'Installed by the system, not shipped'})).not.toThrow();
  });

  it('lists notices given first ahead of the packages, as an app\'s upstream', () => {
    const page = renderLicenses([{name: 'zeta', version: '1.0.0', license: 'MIT', notices: ['MIT']}], [], [{name: 'OpenClaw', license: 'MIT', text: 'Copyright OpenClaw'}]);
    expect(page.indexOf('OpenClaw')).toBeLessThan(page.indexOf('zeta'));
  });
});

describe('the code review of 2026-11-19: notices a bundle could ship without', () => {
  it('pastes a license text as it is: "$&", "$`" and "$$" in a notice stay text, not replacement commands', () => {
    const root = store.install('dollars', '1.0.0', {LICENSE: 'Price: $$5 and pattern $` here, $& and $<'});
    const plugin = licensesPage({siteUrl: 'https://globe.hubnx.com'});
    plugin.buildEnd.call(buildOf([join(root, 'index.js')]));
    const page = plugin.transformIndexHtml.handler(`<!doctype html><main>${LicensesPlaceholder}</main>`);
    expect(page).toContain('Price: $$5 and pattern $` here, $&amp; and $&lt;');
    expect(page.match(/<!doctype html>/g)).toHaveLength(1);
  });

  it('keeps a package’s third-party notices and its LICENSES folder: code it bundles without declaring it (prettier, TypeScript)', () => {
    const root = store.install('bundler', '3.0.0', {LICENSE: 'MIT, the bundler', 'THIRD-PARTY-NOTICES.md': '@angular/compiler: MIT, Copyright Google'});
    mkdirSync(join(root, 'LICENSES'));
    writeFileSync(join(root, 'LICENSES', 'Apache-2.0.txt'), 'Apache License 2.0');
    expect(shippedPackages([join(root, 'index.js')])[0]?.notices).toEqual(['MIT, the bundler', '@angular/compiler: MIT, Copyright Google', 'Apache License 2.0']);
  });

  it('lists a package a stylesheet imports by name, which Vite inlines outside the module graph', () => {
    store.installFlat('cssonly', {license: 'MIT'}, {LICENSE: 'MIT, cssonly'});
    mkdirSync(join(store.root, 'src'));
    const plugin = licensesPage({siteUrl: 'https://globe.hubnx.com'});
    plugin.transform.handler(`@import 'cssonly/style.css';\n@import './own.css';\nbody { color: red }`, join(store.root, 'src', 'styles.css'));
    plugin.buildEnd.call(buildOf([join(store.root, 'src', 'main.ts')]));
    expect(plugin.transformIndexHtml.handler(LicensesPlaceholder)).toContain('<strong>cssonly</strong>');
  });

  it('reads a stylesheet’s package imports in their every form, and leaves relative, absolute and remote ones', () => {
    expect(packagesImportedBy(`@import "tailwindcss";\n@use '@scope/theme/vars' as v;\n@import url("~pkg/x.css");\n@forward 'kit';\n@import './own.css';\n@import '/abs.css';\n@import url(https://fonts.googleapis.com/x);`)).toEqual(['tailwindcss', '@scope/theme', 'pkg', 'kit']);
  });

  it('reads esbuild’s relative module ids and Windows’ backslashes', () => {
    const root = store.install('flatpkg', '1.0.0', {LICENSE: 'MIT, flatpkg'});
    expect(packageRoot('node_modules/flatpkg/index.js')).toBe('node_modules/flatpkg');
    expect(packageRoot('C:\\app\\node_modules\\@scope\\lib\\index.js')).toBe('C:/app/node_modules/@scope/lib');
    expect(shippedPackages([relative(store.root, join(root, 'index.js'))], {buildFolder: store.root}).map(item => item.name)).toEqual(['flatpkg']);
  });

  it('follows a package’s dependencies from its real folder when the bundle names it by its link (preserveSymlinks)', () => {
    const map = store.install('map-lib', '6.0.0', {LICENSE: 'BSD, map-lib'}, {earcut: '^3.0.0'});
    store.linkBeside(map, store.install('earcut', '1.0.0', {LICENSE: 'ISC, earcut'}), 'earcut');
    symlinkSync(map, join(store.root, 'node_modules', 'map-lib'), 'dir');
    expect(shippedPackages([join(store.root, 'node_modules', 'map-lib', 'index.js')]).map(item => item.name)).toEqual(['earcut', 'map-lib']);
  });

  it('reads SPDX’s grammar: a required GPL part beside a permissive choice is not permissive', () => {
    for (const license of ['(MIT OR Apache-2.0) AND GPL-3.0-only', 'GPL-2.0-only AND (MIT OR BSD-3-Clause)', 'LGPL-3.0 AND (MIT OR Apache-2.0)', 'GPL-2.0 WITH Classpath-exception-2.0', '(MIT', 'MIT OR']) expect(permissive(license), license).toBe(false);
    for (const license of ['(MIT OR GPL-3.0) AND Apache-2.0', 'Apache-2.0 WITH LLVM-exception', '((MIT))', 'mit OR ISC'.replace('mit', 'MIT')]) expect(permissive(license), license).toBe(true);
  });

  it('fails the build when the licenses page is written without its list, or not at all', () => {
    const plugin = licensesPage({siteUrl: 'https://globe.hubnx.com'});
    const page = (source: string) => ({'licenses/index.html': {type: 'asset' as const, fileName: 'licenses/index.html', source}});
    expect(() => plugin.writeBundle({}, page('<main></main>'))).toThrow(/licenses-page: licenses\/index\.html was written without its list/);
    expect(() => plugin.writeBundle({}, {})).toThrow(/licenses-page: the build wrote no licenses\/index\.html/);
    expect(() => plugin.writeBundle({}, page('<ul class="license-list"></ul>'))).not.toThrow();
  });

  it('lists the bundler’s own helper code (Vite’s preload helper) under the bundler’s notice, without its build-time dependencies', () => {
    store.installFlat('vite', {license: 'MIT', dependencies: {lightningcss: '^1.0.0'}}, {LICENSE: 'MIT, Vite'});
    store.installFlat('lightningcss', {license: 'MPL-2.0'}, {LICENSE: 'MPL'});
    expect(shippedPackages(['\0vite/preload-helper.js'], {buildFolder: store.root}).map(item => item.name)).toEqual(['vite']);
  });

  it('fails, naming the folder, for shipped code with no package.json to name it (node_modules/.prisma)', () => {
    mkdirSync(join(store.root, 'node_modules', '.prisma', 'client'), {recursive: true});
    expect(() => shippedPackages([join(store.root, 'node_modules', '.prisma', 'client', 'index.js')])).toThrow(/licenses-page: .*\.prisma ships code but has no package\.json/);
  });

  it('reads the old "licenses" field in either shape, and repository shorthands as links', () => {
    const old = store.installFlat('old', {licenses: {type: 'MIT'}, repository: 'git@github.com:example/old.git'}, {LICENSE: Mit});
    const pair = store.installFlat('pair', {licenses: [{type: 'MIT'}, {type: 'Apache-2.0'}], repository: 'example/pair'}, {LICENSE: Mit});
    const found = shippedPackages([join(old, 'i.js'), join(pair, 'i.js')]);
    expect(found.map(item => [item.license, item.source])).toEqual([['MIT', 'https://github.com/example/old'], ['(MIT OR Apache-2.0)', 'https://github.com/example/pair']]);
  });

  it('takes a README section only with a copyright and the license’s terms; a heading inside code doesn’t end it; underlined headings count', () => {
    const pointer = store.installFlat('pointer', {}, {'README.md': '# pointer\n\n## License\n\nCopyright (c) 2020 A. MIT licensed; see LICENSE.'});
    expect(() => shippedPackages([join(pointer, 'i.js')])).toThrow(/licenses-page: pointer@1\.0\.0/);
    const fenced = store.installFlat('fenced', {}, {'README.md': `# fenced\n\n## License\n\n${Mit}\n\n\`\`\`sh\n# not a heading\n\`\`\`\n\nThe rest of the terms.\n\n## Thanks`});
    expect(shippedPackages([join(fenced, 'i.js')])[0]?.notices[0]).toContain('The rest of the terms.');
    const underlined = store.installFlat('underlined', {}, {'README.md': `underlined\n==========\n\nLicense\n-------\n\n${Mit}\n\nNext\n----\n\nNot it.`});
    expect(shippedPackages([join(underlined, 'i.js')])[0]?.notices).toEqual([`License\n-------\n\n${Mit}`]);
  });

  it('leaves out the app\'s own source linked by path from outside node_modules, but lists what it depends on', () => {
    const own = join(store.root, 'linked', 'web-parts');
    mkdirSync(own, {recursive: true});
    writeFileSync(join(own, 'package.json'), JSON.stringify({name: '@hubnx/web-parts', version: '0.1.0', dependencies: {helper: '^1.0.0'}}));
    store.installFlat('helper', {license: 'MIT'}, {LICENSE: 'MIT, helper'});
    mkdirSync(join(store.root, 'node_modules', '@hubnx'), {recursive: true});
    symlinkSync(own, join(store.root, 'node_modules', '@hubnx', 'web-parts'), 'dir');
    expect(shippedPackages([join(store.root, 'node_modules', '@hubnx', 'web-parts', 'web-parts.css')]).map(item => item.name)).toEqual(['helper']);
  });
});
