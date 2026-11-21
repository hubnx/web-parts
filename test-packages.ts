// Packages installed in a temporary folder, for the tests of the licenses builders: pnpm-shaped (each package in
// `.pnpm/<name>@<version>/node_modules/<name>`, its dependencies linked beside it) or flat (`node_modules/<name>`).

import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** A license file with a copyright and MIT's terms. */
export const Mit = 'Copyright (c) Someone\n\nPermission is hereby granted, free of charge…';

export interface PackageStore {
  /** The folder holding `node_modules`. */
  readonly root: string;
  /** A package in pnpm's layout; `files.license` is its package.json's license (default MIT), the rest its files. */
  install(name: string, version: string, files: Record<string, string>, dependencies?: Record<string, string>): string;
  /** A package at `node_modules/<name>`, with a package.json written as given. */
  installFlat(name: string, manifest: Record<string, unknown>, files?: Record<string, string>): string;
  /** pnpm links a dependency into the folder beside the package that needs it. */
  linkBeside(parentRoot: string, dependencyRoot: string, name: string): void;
  remove(): void;
}

export function packageStore(): PackageStore {
  const root = mkdtempSync(join(tmpdir(), 'web-parts-test-'));
  return {
    root,
    install(name, version, files, dependencies = {}) {
      const folder = join(root, 'node_modules', '.pnpm', `${name.replace('/', '+')}@${version}`, 'node_modules', name);
      mkdirSync(folder, {recursive: true});
      writeFileSync(join(folder, 'package.json'), JSON.stringify({name, version, license: files.license ?? 'MIT', repository: `git+https://github.com/example/${name}.git`, dependencies}));
      for (const [file, text] of Object.entries(files)) if (file !== 'license') writeFileSync(join(folder, file), text);
      return folder;
    },
    installFlat(name, manifest, files = {}) {
      const folder = join(root, 'node_modules', name);
      mkdirSync(folder, {recursive: true});
      writeFileSync(join(folder, 'package.json'), JSON.stringify({name, version: '1.0.0', ...manifest}));
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(join(folder, file, '..'), {recursive: true});
        writeFileSync(join(folder, file), text);
      }
      return folder;
    },
    linkBeside(parentRoot, dependencyRoot, name) {
      symlinkSync(dependencyRoot, join(parentRoot, '..', name), 'dir');
    },
    remove() {
      rmSync(root, {recursive: true, force: true});
    },
  };
}
