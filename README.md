# Largitude

Largitude is a Firefox extension: hover over a thumbnail or a link to an image, and it shows the full-size image in a popup, on any site. It's in early development.

## Install

Largitude isn't on Firefox Add-ons yet. To try a local copy, see [Development](#development).

## How it works

- **Finding the image.** When the pointer moves, Largitude looks at everything under it (`elementsFromPoint`), topmost first, including inside shadow roots: closed ones too, which Firefox lets extensions see. It looks through transparent overlays, which many sites lay over their images, and stops at text or at an element with a background color of its own, since that hides what's under it. The first `<img>` or CSS background image it finds, 24 px or more each way, is the one. An image that ignores the mouse (`pointer-events: none`) is found inside the element over it. Failing all that, a link to an image file under the pointer counts.
- **The full-size address.** For each image, Largitude tries in turn: a link around it to an image file, the largest candidate in its `srcset` (and those of the `<source>` elements around it in a `<picture>`), and what the page shows. Lazy-loading pages keep the last two in `data-lazy-srcset` and `data-lazy-src` until the image comes into view. Before each address comes any larger version the site rules know of. An address that fails to load moves it on to the next.
- **Site rules.** Reddit shows copies at most 1080 px wide (`preview.redd.it`); the original upload is on `i.redd.it` under the copy's id, which newer copies put after words from the post's title (`some-title-v0-<id>.png`). X picks a photo's size with `name=` (`small`, `large`, …), and `name=orig` is the original; profile pictures drop `_normal` or `_400x400`, and banners go to `1500x500`.
- **Opening.** The pointer rests on the image for 300 ms first. The full image starts loading then, and the popup opens as soon as its size is known, at its final size, with the page's thumbnail standing in until the full image has arrived. A spinner shows if that takes more than 150 ms. The size always comes from loading the file, even when it's the page's own copy (from the cache then): an image the browser picked from a `srcset` reports the size it's shown at, not its own. The popup doesn't open when it wouldn't be at least 20% wider or taller than the image on the page.
- **Placing.** The image is fitted, never past its own size, into whichever side of the pointer shows it largest, next to the pointer. It covers the window instead when every side would show it at less than two thirds of what the whole window allows, or when only the whole window shows it clearly bigger than the page does, so where the pointer happens to be never decides whether there's a popup. The popup lets the mouse through, so it never gets in the way.
- **Galleries.** When the image is one of a post's several, the popup shows where it is ("2 / 5"), and ← → or the mouse wheel move through the rest, with the images on either side loading in advance. Reddit galleries are a `<gallery-carousel>` with every slide in the page as an `<li>`, the ones not in view yet included. X posts link each photo to `…/status/<post>/photo/<n>` within the post's `<article>`; a quoted post's photos have another post's number and are left out. Moving your fingers or the wheel down shows the next image. Wheel events only say which way the page would scroll, which macOS reverses with natural scrolling, its default, and pages can't tell whether it's on; so on a Mac, Largitude takes it to be on, and **Reverse the mouse wheel in galleries** in the settings is there for when it isn't. The wheel moves one image per gesture: a gesture ends after 150 ms without wheel movement, so a trackpad swipe and its momentum count once. Past either end, the next gesture scrolls the page as usual. While a gallery is open, the keys and the wheel don't reach the page. The wheel is only listened to while a gallery is open, since a listener that can stop scrolling makes the browser wait on it for every turn of the wheel.
- **Saving.** With a popup open, S saves the image it shows, as the full-size file it came from. The background script downloads it (with the `downloads` permission), and Firefox's own setting decides whether to ask where; a private window's download stays private. The file is named after the last part of the address, with the type added when the address gives it elsewhere, as X's `?format=jpg` does. A note in the popup says "Saved", "Not saved" (the save dialog was canceled) or "Couldn't save".
- **Closing.** Moving off the image, leaving the window, or scrolling the page (or a box the image is in) closes the popup; another box on the page scrolling, such as a chat, leaves it open. A click or Escape closes it too, and it stays closed until the pointer leaves the image. Escape then doesn't reach the page, which might otherwise close a dialog of its own.
- **Isolation.** The popup lives in a shadow root on a `popover="manual"` element, so it sits in the browser's top layer, above everything the page shows, its own dialogs included. Its styles are set on its elements rather than in a stylesheet, which a page's content security policy can't block, and `!important` on the outer element beats the page's stylesheets. The content script runs in its own world, out of the page's reach.
- **Settings.** The settings page keeps a list of sites to leave alone, and the wheel's direction in galleries. A change applies at once, on pages already open too. The background script decides for each frame, going by the tab's page as well as the frame's own address, so a frame embedded on a site in the list is left alone too.

## Limits

- A popup for an image inside a frame stays inside that frame, so a small frame leaves no room for one.
- Site rules cover Reddit and X so far. Elsewhere only the addresses the page itself gives are tried; rules for YouTube, Imgur and common image CDNs come next.
- Galleries are recognized on Reddit and X only.

## Development

Bump `version` in `extension/manifest.json` for each release.

```
npm run lint
npm test
```

`npm run lint` checks the extension with Mozilla's add-on checker (`web-ext lint`, fetched by `npx` on first use). `npm test` runs the unit tests of `extension/helpers.js` with Node's own test runner (Node 20+); nothing needs installing.

There is no build step: `extension/` is the extension, exactly as it goes to Firefox Add-ons. To try it, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and choose `extension/manifest.json`. Firefox removes it when it restarts. `npx web-ext@10 build --source-dir extension` packages it as a zip in `web-ext-artifacts/`, which **Load Temporary Add-on…** takes too.

The test page has one card for each kind of image Largitude should show, or leave alone. Run `npm run serve`, open http://127.0.0.1:8766/test/test-page.html with the extension installed, and click **Run checks**: it hovers each card with synthetic mouse events and lists what the popup showed, then checks opening and closing. With `?standalone` added to the address, the page loads the content script itself, with a stand-in for the extension APIs, so it also works in other browsers (closed shadow roots excepted).

On every push, a GitHub Action, **Tests**, runs the add-on checker and the unit tests.

Publishing a GitHub release runs a second one, **Firefox Add-ons**, which submits that version of the extension to Firefox Add-ons with the notes for Mozilla's reviewers (`amo/reviewer-notes.txt`) and the release's "What's new", and sets the listing's description to `amo/description.txt` as it is in that release. The new description shows on Firefox Add-ons as soon as the release is submitted, before Mozilla has approved the version. It needs two repository secrets, `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`, from an [API key on Firefox Add-ons](https://addons.mozilla.org/developers/addon/api/key/). A failed submission can be retried from the Actions tab with **Run workflow** and the release's tag.

## License

[MIT](LICENSE)
