# @hubnx/web-parts

The parts [Hub Nexus](https://www.hubnx.com)'s apps share: a build-time link rewriter, pop-ups, an email-link
chooser, the feedback form, and open-source licenses builders for a website and for an Electron app. TypeScript
source with no build step, used through [Vite](https://vite.dev). MIT licensed.

They're made for Hub Nexus's own apps, open-source and closed alike, so they follow those apps' needs. Anyone may use
them under the license; the feedback parts only work for Hub Nexus's apps (see [Feedback](#feedback)).

## What's here

| Module | Runs | Does |
|---|---|---|
| `external-links` | at build time | Rewrites a page's links: one to another site, a plain file (`.txt`, `.pdf`) or an email opens in a new tab, with `rel="noopener"` and a note for screen readers. A link with `download` is left alone |
| `popup` | in the page | A `<dialog>` with one shape, closed by its × or the backdrop; helpers for `popover` panels; whether anything is over the page |
| `email-chooser` · `mail-options` | in the page | An email link opens a chooser (Gmail, Outlook.com, Outlook at work, the mail app, copy the address) instead of a blank tab when no mail program is set up. Importing `email-chooser` installs it |
| `feedback-link` · `feedback-form` · `feedback-report` | in the page | The feedback form, alone or in a pop-up over any page with a picture of it, where the person boxes what they mean and blacks out anything private before it's sent. Sent to Hub Nexus's report route |
| `licenses` | at build time | A website's open-source licenses page, made from the files the bundle actually read: a Vite plugin, and the plain functions for other bundlers |
| `electron-notices` | at build time | The same for an Electron app: every Vite build's packages, the dependencies electron-builder packs, Electron's and Chromium's notices |
| `html` | anywhere | `escapeHtml` |
| `web-parts.css` · `licenses.css` | in the page | The styles, drawn on the app's own colour tokens (below). `web-parts.css` imports `licenses.css` |

## Use it in an app

**1. Pin it by commit** in the app's `package.json`, and change the commit to update:

```json
"dependencies": {
  "@hubnx/web-parts": "github:hubnx/web-parts#<commit SHA>"
}
```

**2. Let every place that loads it compile TypeScript.** The modules are `.ts` files. Node 24 runs TypeScript, but
never from `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), and that's where a git dependency lives.

- **In the page's code**, nothing to do: Vite compiles TypeScript from `node_modules` like the app's own.
- **In `vite.config.ts`** (the licenses page, the notices collector), run Vite with its runner config loader, which
  compiles the config's imports instead of handing them to Node:

  ```json
  "build": "vite build --configLoader runner"
  ```

  Pass the flag to every `vite` command that reads a config importing these parts, `vite` (the dev server) included.
- **In a plain Node script** (`node scripts/x.ts`), load the module through Vite's runner:

  ```ts
  import {runnerImport} from 'vite';

  type Notices = typeof import('@hubnx/web-parts/electron-notices');
  const {module: notices} = await runnerImport<Notices>('@hubnx/web-parts/electron-notices');
  ```

- **The type check** reads these files under the app's own settings. They pass with `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`, under `bundler` or `nodenext`
  resolution. The app needs `allowImportingTsExtensions` (the modules import each other by `.ts` name), the `dom`
  library for the page's parts, and `"types": ["node"]` for the build-time ones.

**3. Load the styles** from the app's stylesheet: `@import '@hubnx/web-parts/web-parts.css';`. They use these
custom properties, which the app defines: `--surface`, `--surface-2`, `--ink`, `--muted`, `--line`, `--accent`,
`--wrong`, `--radius`, `--shadow`. The app's own `.button` and `.segmented` style the buttons, and its
`.visually-hidden` the screen-reader notes.

### Links that open in a new tab

```ts
import {openOutboundLinksInNewTab} from '@hubnx/web-parts/external-links';

// in vite.config.ts's plugins:
{name: 'outbound-links', transformIndexHtml: {order: 'post', handler: html => openOutboundLinksInNewTab(html, 'https://example.com')}}
```

A link a script writes after the build gets the same markup from `NewTabAttributes` and `NewTabNote`.

### The licenses page (a website)

MIT, BSD, ISC and Apache require their notices to travel with every copy of the code, and a website is a copy. The
plugin lists what the bundle actually read, never a list kept by hand:

```ts
import {licensesPage} from '@hubnx/web-parts/licenses';

export default defineConfig({
  plugins: [licensesPage({siteUrl: 'https://example.com'})],
});
```

Write the page as `licenses/index.html` (one of the build's inputs) with `<!--licenses-->` where the list goes, and
style it with `licenses.css` (or `web-parts.css`, which imports it).

- **What it lists**: every package the bundle read; the packages a stylesheet imports by name (Vite inlines those
  outside the module graph); Vite's own helper code; and, from each package's real folder, the dependencies it folds
  into its prebuilt file. Each comes with its LICENSE, NOTICE, third-party notice files and `LICENSES/` folder, or,
  when it has none, its README's License section if that holds a copyright and the license's terms.
- **What stops the build**, by name: a package with no notice; a folder of shipped code with no `package.json`; a
  copyleft or unlicensed package with no written decision (SPDX expressions are read with SPDX's grammar); and a page
  written without its list.
- **Options**: `extras` (notices the bundle can't see: a font in `public/`, a data set), `first` (shown ahead of the
  packages, such as the project an app is adapted from), `atSource` (a notice found at a package's source, for one
  that ships none), `decisions` (why a package that isn't permissive may still ship), `page` (another path than
  `licenses/index.html`).
- Put the plugin in `worker.plugins` too when a worker imports packages of its own.
- **Another bundler**: pass its module paths (esbuild's metafile inputs, say) to `shippedPackages(ids, {buildFolder})`,
  then `refuseCopyleft` and `renderLicenses`.
- Code linked by path from outside `node_modules` (a workspace package) is the app's own and isn't listed; this
  package, installed from git, is in `node_modules` and is listed under its MIT license.

### An Electron app's licenses

An Electron app ships more than its window's bundle: the main process and the preload are builds of their own, a
main-process build leaves its dependencies for electron-builder to pack whole, and Electron carries Chromium. Two
steps make one list.

In each Vite build's config (run with `--configLoader runner`), a collector writes that build's packages:

```ts
import {noticesCollector} from '@hubnx/web-parts/electron-notices';

plugins: [noticesCollector({build: 'window', folder: 'dist/notices'})]   // and 'main', 'preload' in theirs
```

Then, after every build, a script merges them with the rest:

```ts
import {writeFileSync} from 'node:fs';
import {runnerImport} from 'vite';

type Notices = typeof import('@hubnx/web-parts/electron-notices');
type Licenses = typeof import('@hubnx/web-parts/licenses');
const {module: {electronAppNotices}} = await runnerImport<Notices>('@hubnx/web-parts/electron-notices');
const {module: {renderLicenses}} = await runnerImport<Licenses>('@hubnx/web-parts/licenses');

const {packages, extras} = electronAppNotices({
  appFolder: '.',
  folder: 'dist/notices',
  builds: ['window', 'main', 'preload'],
  chromiumNoticesUrl: 'https://example.com/licenses/chromium.html',
});
writeFileSync('dist/licenses-list.html', renderLicenses(packages, extras));
```

- **What it lists**: every build's packages; `package.json`'s `dependencies` with theirs (what electron-builder
  packs); `alsoShipped`, packages shipped outside both (a file copied beside the window's and loaded at run time);
  Electron's own license; and a note that Chromium's notices, too long for the list, ship whole as
  `LICENSES.chromium.html` beside the program.
- **What stops it**, by name: a build's list missing (a build skipped or failed: each collector removes its old list
  when its build starts), a dependency that isn't installed, a package with no notice, a copyleft or unlicensed package
  with no decision, and an Electron installed without its download's license files.
- **Trap: `lazy-val` 1.0.5, which `electron-updater` pulls in, ships no license file, and its repository has none
  either**, so the merge stops at it. Its package.json says MIT; pass the MIT terms, with its author named and where
  you found that, through `atSource: {'lazy-val': text}`. Any Electron app with `electron-updater` meets it.

### Feedback

The form posts to Hub Nexus's report route (`https://www.hubnx.com/api/feedback`, the one hubnx.com's own
report-a-problem uses), which takes reports only from the apps in Hub Nexus's list, each from its own origin. So these
parts work for Hub Nexus's apps only; anyone may read them as an example.

```ts
import {openFeedbackLinksAsPopup} from '@hubnx/web-parts/feedback-link';

openFeedbackLinksAsPopup({key: 'example', name: 'Example', support: 'example@hubnx.com'});
```

Every `<a href="/feedback/">` then opens the report pop-up over the page. The page's picture needs
[modern-screenshot](https://github.com/qq15725/modern-screenshot) 4.7.0 installed by the app (an optional peer
dependency, loaded only when a report opens). A part of the page marked `data-private` is left blank in the picture.

## Tests

```sh
pnpm install
pnpm typecheck
pnpm test
```

The tests use Vitest and run in Node. GitHub Actions runs the type check and the tests on every push and pull
request.

## License

[MIT](LICENSE), copyright HubNX, Inc. Contributions are accepted under the same license.
