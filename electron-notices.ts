// The open-source notices for an Electron app, made at build time from what it ships, for its in-app licenses view
// and its website's licenses page (renderLicenses in licenses.ts draws the list). An Electron app ships more than a
// web page does: the code each of its Vite builds bundles (the window, the main process, the preload), the packages
// electron-builder copies whole from package.json's `dependencies` (a main-process build leaves those out of its
// bundle), and Electron itself, with Chromium inside it.
//
// The builds are separate Vite runs, so this is two steps: `noticesCollector`, a plugin in each build, writes that
// build's packages to `<folder>/<build>.json`; `electronAppNotices`, run once every build is done, merges them with
// the packed dependencies and Electron's and Chromium's notices. Lifted from hubnx Music's build, 2026-11-21.

import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {refuseCopyleft, shippedPackages, type ExtraNotice, type LicenseDecisions, type NoticesAtSource, type ShippedPackage} from './licenses.ts';

/** The structural part of Vite's plugin types this needs, so this package needs no Vite of its own. */
interface BuildContext {
  getModuleIds(): IterableIterator<string>;
}

export interface NoticesCollectorPlugin {
  name: string;
  apply: 'build';
  buildStart(): void;
  buildEnd(this: BuildContext): void;
  writeBundle(): void;
}

export interface NoticesCollectorOptions {
  /** The build's name, which names its file: such as "window", "main" or "preload". */
  build: string;
  /** The folder every build writes its list to, such as the app's `dist/notices`. */
  folder: string;
  /** Notices found at a package's source, for one the build bundles that ships none (licenses.ts › shippedPackages). */
  atSource?: NoticesAtSource | undefined;
}

/** The Vite plugin for one build: the packages it read, with their notices, in `<folder>/<build>.json`. */
export function noticesCollector({build, folder, atSource}: NoticesCollectorOptions): NoticesCollectorPlugin {
  const read = new Set<string>();
  const file = join(folder, `${build}.json`);
  return {
    name: 'hubnx-notices-collector',
    apply: 'build',
    // A build that fails leaves no list behind, so the merge stops on it instead of reading the last run's: the old
    // list goes when the build starts, and the new one is written only once the bundle is (Vite runs closeBundle
    // after a failed build too).
    buildStart() {
      rmSync(file, {force: true});
      read.clear();
    },
    buildEnd() {
      for (const id of this.getModuleIds()) read.add(id);
    },
    writeBundle() {
      mkdirSync(folder, {recursive: true});
      writeFileSync(file, JSON.stringify(shippedPackages(read, {atSource}), null, 1));
    },
  };
}

export interface ElectronAppNoticesOptions {
  /** The app's folder, its package.json and node_modules: absolute, or relative to the working folder. */
  appFolder: string;
  /** Where every build's collector wrote its list. */
  folder: string;
  /** Every build's name; a list missing from the folder stops the merge (a build skipped or failed). */
  builds: readonly string[];
  /** Packages shipped outside every bundle and outside `dependencies`, by name: a file copied beside the window's and
   * loaded at run time, say. Listed from their installed folders, with what they depend on. */
  alsoShipped?: readonly string[] | undefined;
  /** Notices found at a package's source, for one that ships none: electron-updater pulls in lazy-val, which has none. */
  atSource?: NoticesAtSource | undefined;
  /** Why each package that isn't permissive may still ship (licenses.ts › refuseCopyleft); any other stops the merge. */
  decisions?: LicenseDecisions | undefined;
  /** Where Chromium's notices are online too, such as the app site's copy of LICENSES.chromium.html. */
  chromiumNoticesUrl?: string | undefined;
}

export interface ElectronAppNotices {
  /** Every package the app ships, once each, sorted by name. */
  packages: ShippedPackage[];
  /** Electron's own notice and Chromium's, for the list's extras. */
  extras: ExtraNotice[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Each package once, by name and version, sorted as shippedPackages sorts. */
function merged(lists: readonly (readonly ShippedPackage[])[]): ShippedPackage[] {
  const byKey = new Map<string, ShippedPackage>();
  for (const item of lists.flat()) byKey.set(`${item.name}@${item.version}`, item);
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/**
 * The one list for everything the app ships. Throws, naming what is wrong, for a build's list that is missing, a
 * dependency that isn't installed, a package with no notice, a copyleft or unlicensed package with no decision, and an
 * Electron without its license files: a build must not ship code whose notice it can't show.
 */
export function electronAppNotices(options: ElectronAppNoticesOptions): ElectronAppNotices {
  const {folder, builds, alsoShipped = [], atSource, decisions, chromiumNoticesUrl} = options;
  // Absolute, since the installed packages' paths below are module ids, which shippedPackages reads from the app.
  const appFolder = resolve(options.appFolder);
  const lists = builds.map(build => {
    const file = join(folder, `${build}.json`);
    if (!existsSync(file)) throw new Error(`electron-notices: no ${build}.json in ${folder}; run every build first (${builds.join(', ')})`);
    return readJson<ShippedPackage[]>(file);
  });
  // electron-builder packs package.json's dependencies whole, with theirs, so each is listed from its folder.
  const dependencies = Object.keys(readJson<{dependencies?: Record<string, string>}>(join(appFolder, 'package.json')).dependencies ?? {});
  const packed = [...alsoShipped, ...dependencies].map(name => {
    const manifest = join(appFolder, 'node_modules', name, 'package.json');
    if (!existsSync(manifest)) throw new Error(`electron-notices: ${name} ships with the app but isn't installed in ${join(appFolder, 'node_modules')}`);
    return manifest;
  });
  const packages = merged([...lists, shippedPackages(packed, {atSource, buildFolder: appFolder})]);
  refuseCopyleft(packages, decisions);

  const electron = join(appFolder, 'node_modules', 'electron');
  const license = join(electron, 'dist', 'LICENSE');
  const chromium = join(electron, 'dist', 'LICENSES.chromium.html');
  for (const file of [license, chromium]) {
    if (!existsSync(file)) throw new Error(`electron-notices: no ${file}; is Electron installed with its download (its install script allowed to run)?`);
  }
  const version = readJson<{version: string}>(join(electron, 'package.json')).version;
  const online = chromiumNoticesUrl ? `, and are at ${chromiumNoticesUrl}` : '';
  return {
    packages,
    extras: [
      {name: `Electron ${version}`, license: 'MIT', source: 'https://github.com/electron/electron', text: readFileSync(license, 'utf8').trim()},
      {
        name: `Chromium, inside Electron ${version}`,
        license: 'BSD-3-Clause and others',
        source: 'https://www.chromium.org',
        // Hundreds of components' notices, megabytes of them: too long for the list. Electron's own download carries
        // the file, and a packaged app has it beside the program (in Resources on a Mac).
        text: `Chromium's notices list hundreds of components, each with its license. They are too long for this list, so they ship whole with every copy of the app, as LICENSES.chromium.html beside it${online}.`,
      },
    ],
  };
}
