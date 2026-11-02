# Developing Largitude

How Largitude works, and how to work on it. What it does and how to install it are in the [README](README.md), which is written for the people who use it.

## Trying it

There is no build step: `extension/` is the extension, exactly as it goes to Firefox Add-ons. To try it, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and choose `extension/manifest.json`. Firefox removes it when it restarts. `npx web-ext@10 build --source-dir extension` packages it as a zip in `web-ext-artifacts/`, which **Load Temporary Add-on…** takes too.

## Checks

```
npm run lint
npm test
```

`npm run lint` checks the extension with Mozilla's add-on checker (`web-ext lint`, fetched by `npx` on first use). `npm test` runs the unit tests of `extension/helpers.js` and the site rules with Node's own test runner (Node 20+); nothing needs installing.

The test page has one card for each kind of image Largitude should show, or leave alone. Run `npm run serve`, open http://127.0.0.1:8766/test/test-page.html with the extension installed, and click **Run checks**: it hovers each card with synthetic mouse events and lists what the popup showed, then checks opening and closing. With `?standalone` added to the address, the page loads the content script itself, with a stand-in for the extension APIs, so it also works in other browsers (closed shadow roots excepted).

On every push, a GitHub Action, **Tests**, runs the add-on checker and the unit tests.

## Site rules

What Largitude knows about particular sites is in `extension/sites/`, one file per site, each added with `addSite` (from `helpers.js`). `image-services.js` is the exception: it holds the rules for image services many sites use (WordPress, Next.js, Cloudinary, imgix, Google), whatever site they're on. A site's `larger` rules are pairs of a regular expression and its replacement: when the expression matches an image's address, the address with the replacement put in is a larger version, tried first. Its `gallery` function, if it has one, finds the images of the post an image is in. Three more are optional: `standIn` recognizes an image a site sends in place of a file it doesn't have (YouTube's gray 120×90 still), which the popup skips like a failed load, `leaveAlone` leaves a site's own images to it (YouTube's thumbnails on YouTube, which play a preview), and `video` finds files of a video the site streams (the MP4s Reddit's player lists in `packaged-media-json`), which the popup plays instead. A new site's file goes in the manifest's content scripts, between `helpers.js` and `content.js` (a test checks), and its rules get tests in `test/sites.test.mjs`.

## Releasing

Bump `version` in `extension/manifest.json` for each release. The release's notes start with a `## What's new` heading; the list under it, up to any `## Updating` section, becomes the version's release notes on Firefox Add-ons, as plain text.

Publishing a GitHub release runs another GitHub Action, **Firefox Add-ons**, which submits that version of the extension to Firefox Add-ons with the notes for Mozilla's reviewers (`amo/reviewer-notes.txt`) and the release's "What's new", and sets the listing's description to `amo/description.txt` as it is in that release. The new description shows on Firefox Add-ons as soon as the release is submitted, before Mozilla has approved the version. It needs two repository secrets, `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`, from an [API key on Firefox Add-ons](https://addons.mozilla.org/developers/addon/api/key/). A failed submission can be retried from the Actions tab with **Run workflow** and the release's tag.

The listing's other fields, the ones that stay the same from one version to the next (its website), are in `amo/listing.json`. A change to it on `main` runs **Firefox Add-ons listing**, which sends it to Firefox Add-ons straight away, with the same secrets.

The [README](README.md) and the listing's description (`amo/description.txt`) are what users read: keep them in step with what Largitude does.

## How it works

The details are in the code's comments. This is a map of where to find them, with the reasons the code doesn't make obvious. `helpers.js` holds the parts with no side effects, unit-tested in Node; `content.js` does the rest, in each frame; `background.js` gives each frame its settings and saves files.

- **Finding the image** (`findImage`, `imageOf`). Everything under the pointer, topmost first, through shadow roots, closed ones included, which Firefox lets extensions see. Transparent overlays are looked through; text, an opaque background or a video stops the search. A `blob:` video is a stream that can't be played anywhere else, so it's left alone, unless a site's `video` knows files of it (`streamedVideoOf`), checked for the poster shown before it plays too; the popup then starts where the page's video is.
- **The full-size address** (`sourcesOf`, `withRules`). A link to an image or video file, then the largest `srcset` candidate, then the image shown, each preceded by any larger version the site rules know (`fullSizeUrls`). An address that fails moves on to the next.
- **Opening** (`open`, `fetchMedia`). The size always comes from loading the file afresh: an image the browser picked from a `srcset` reports the size it's shown at as its own. The popup opens as soon as the size is known, at its final size, with the thumbnail standing in, and only if it's at least 20% bigger than the image on the page.
- **Placing** (`placePopup`). Beside the pointer, on the side that shows the image largest, or over the whole window when no side shows it well, so where the pointer happens to be never decides whether there's a popup.
- **Galleries** (each site's `gallery`, `go`, `onWheel`). The wheel moves one image per gesture, so a trackpad's momentum counts once. It's only listened to while a gallery is open: a listener that can stop scrolling makes Firefox wait on it at every turn of the wheel.
- **Videos** (`videoSourcesOf`, `makeVideo`). What a page's `<video>` plays loads as a video whatever its address, since many sites leave off the file extension.
- **Keys** (the `keydown` listener, `isTyping`; `openInTab`, `copyAddress`, and `toggleActualSize` with `lookAround` for Z, `turn` for R). Only while the popup is open, and they don't reach the page. Keys typed in a text field are left alone, following the focus into web components, whose keys seem to come from the component itself. Shift is the exception (`keepAway`): held, it keeps popups away, read from each mouse move so it can't get stuck.
- **Saving** (`save`, in content.js and background.js). The background script downloads the file, since content scripts can't.
- **Isolation** (`createHost`). The popup is a `popover`, in the top layer above the page's own dialogs, with its styles set on its elements, which a page's content security policy can't block.
- **Settings** (`settingsFor`). Decided for each frame, going by the tab's page too, so a frame embedded on a site to leave alone is left alone.
- **Toolbar button** (`browser.action.onClicked`, `showState`, in background.js; `listWithSite` and `listWithoutSite` in helpers.js). It edits the sites to leave alone, and its badge follows the list for each tab.
