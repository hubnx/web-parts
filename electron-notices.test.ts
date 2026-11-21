import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {electronAppNotices, noticesCollector} from './electron-notices.ts';
import type {ShippedPackage} from './licenses.ts';
import {Mit, packageStore, type PackageStore} from './test-packages.ts';

let store: PackageStore;
let notices: string;

beforeEach(() => {
  store = packageStore();
  notices = join(store.root, 'dist', 'notices');
});
afterEach(() => store.remove());

/** What Vite's build hands buildEnd: the module graph. */
function buildOf(moduleIds: string[]) {
  return {getModuleIds: () => moduleIds[Symbol.iterator]()};
}

/** The app's package.json and an installed Electron with the two license files its download carries. */
function app(dependencies: Record<string, string> = {}, electronFiles: Record<string, string> = {'dist/LICENSE': 'Copyright (c) Electron contributors\nMIT', 'dist/LICENSES.chromium.html': '<html>Chromium</html>'}): void {
  writeFileSync(join(store.root, 'package.json'), JSON.stringify({name: 'some-app', dependencies}));
  store.installFlat('electron', {version: '45.2.1', license: 'MIT'}, electronFiles);
}

/** A build's list as its collector writes it. */
function buildList(build: string, packages: ShippedPackage[]): void {
  mkdirSync(notices, {recursive: true});
  writeFileSync(join(notices, `${build}.json`), JSON.stringify(packages));
}

const windowPackage: ShippedPackage = {name: 'ui-lib', version: '2.0.0', license: 'MIT', notices: ['MIT, ui-lib']};

describe('noticesCollector: one build’s packages, for the merge', () => {
  it('writes the packages the build read, with their notices, to <folder>/<build>.json', () => {
    const root = store.install('ui-lib', '2.0.0', {LICENSE: 'MIT, ui-lib'});
    const plugin = noticesCollector({build: 'window', folder: notices});
    plugin.buildStart();
    plugin.buildEnd.call(buildOf([join(root, 'index.js'), join(store.root, 'src', 'main.ts')]));
    plugin.closeBundle();
    const written = JSON.parse(readFileSync(join(notices, 'window.json'), 'utf8')) as ShippedPackage[];
    expect(written.map(item => [item.name, item.version, item.notices])).toEqual([['ui-lib', '2.0.0', ['MIT, ui-lib']]]);
  });

  it('removes the last run’s list when a build starts, so a build that fails leaves none for the merge to read', () => {
    buildList('main', [windowPackage]);
    noticesCollector({build: 'main', folder: notices}).buildStart();
    expect(existsSync(join(notices, 'main.json'))).toBe(false);
  });
});

describe('electronAppNotices: one list for everything an Electron app ships', () => {
  it('merges every build’s list with the dependencies electron-builder packs (and theirs), each package once', () => {
    store.installFlat('updater', {license: 'MIT', dependencies: {tiny: '^1.0.0'}}, {LICENSE: Mit});
    store.installFlat('tiny', {license: 'ISC'}, {LICENSE: 'ISC, tiny'});
    store.installFlat('codec', {license: 'MIT'}, {LICENSE: 'MIT, codec'});
    // In the window's bundle and packed as a dependency too: listed once.
    store.installFlat('ui-lib', {version: '2.0.0', license: 'MIT'}, {LICENSE: 'MIT, ui-lib'});
    app({updater: '1.0.0', 'ui-lib': '2.0.0'});
    buildList('window', [windowPackage]);
    buildList('main', []);
    const found = electronAppNotices({appFolder: store.root, folder: notices, builds: ['window', 'main'], alsoShipped: ['codec']});
    expect(found.packages.map(item => `${item.name}@${item.version}`)).toEqual(['codec@1.0.0', 'tiny@1.0.0', 'ui-lib@2.0.0', 'updater@1.0.0']);
  });

  it('adds Electron’s own notice and Chromium’s, by Electron’s version, saying where Chromium’s whole notices are', () => {
    app();
    buildList('window', []);
    const {extras} = electronAppNotices({appFolder: store.root, folder: notices, builds: ['window'], chromiumNoticesUrl: 'https://example.com/licenses/chromium.html'});
    expect(extras.map(item => item.name)).toEqual(['Electron 45.2.1', 'Chromium, inside Electron 45.2.1']);
    expect(extras[0]?.text).toBe('Copyright (c) Electron contributors\nMIT');
    expect(extras[1]?.text).toContain('as LICENSES.chromium.html beside it, and are at https://example.com/licenses/chromium.html.');
  });

  it('stops, naming the build, when a build’s list is missing: a build skipped or failed', () => {
    app();
    buildList('window', []);
    expect(() => electronAppNotices({appFolder: store.root, folder: notices, builds: ['window', 'preload']})).toThrow(/electron-notices: no preload\.json in .*run every build first/);
  });

  it('stops, naming it, for a dependency that ships with the app but isn’t installed', () => {
    app({missing: '1.0.0'});
    buildList('window', []);
    expect(() => electronAppNotices({appFolder: store.root, folder: notices, builds: ['window']})).toThrow(/electron-notices: missing ships with the app but isn't installed/);
  });

  it('takes a notice found at the source for a dependency’s dependency that ships none (lazy-val, under electron-updater)', () => {
    store.installFlat('auto-updater', {license: 'MIT', dependencies: {'lazy-thing': '^1.0.0'}}, {LICENSE: Mit});
    store.installFlat('lazy-thing', {license: 'MIT'});
    app({'auto-updater': '1.0.0'});
    buildList('window', []);
    const options = {appFolder: store.root, folder: notices, builds: ['window']};
    expect(() => electronAppNotices(options)).toThrow(/licenses-page: lazy-thing@1\.0\.0 .*ships no license file/);
    const found = electronAppNotices({...options, atSource: {'lazy-thing': 'MIT License\nCopyright (c) Lazy (from its repository)'}});
    expect(found.packages.find(item => item.name === 'lazy-thing')?.notices).toEqual(['MIT License\nCopyright (c) Lazy (from its repository)']);
  });

  it('refuses a copyleft package from any build unless a written decision names it', () => {
    app();
    buildList('window', [{name: 'gpl-codec', version: '1.0.0', license: 'GPL-3.0-only', notices: ['GPL']}]);
    const options = {appFolder: store.root, folder: notices, builds: ['window']};
    expect(() => electronAppNotices(options)).toThrow(/copyleft or unlicensed, with no written decision: gpl-codec@1\.0\.0/);
    expect(() => electronAppNotices({...options, decisions: {'gpl-codec': 'Its own file, loaded at run time, so it can be replaced'}})).not.toThrow();
  });

  it('stops when Electron is installed without its download’s license files', () => {
    app({}, {});
    buildList('window', []);
    expect(() => electronAppNotices({appFolder: store.root, folder: notices, builds: ['window']})).toThrow(/electron-notices: no .*LICENSE; is Electron installed with its download/);
  });
});
