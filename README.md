# Largitude

A Firefox extension that shows images and videos full size when you rest the mouse on them, on any site.

**[Install Largitude from Firefox Add-ons](https://addons.mozilla.org/firefox/addon/largitude/)**. It needs Firefox 142 or later, on the desktop.

## How to use it

Rest the mouse on a thumbnail, a picture in a post, or a link to an image or video file. After a moment, the full-size version opens beside the pointer, fitted to the window. Move away and it closes.

While it's open:

| Key | What it does |
| --- | --- |
| ← → or the mouse wheel | Move through a gallery |
| S | Save the image or video |
| M | Turn a video's sound on or off |
| Space | Pause or play a video |
| Escape, or a click | Close it |

The mouse wheel moves through a gallery the way it scrolls the page: scrolling down shows the next image. Past the last one, it scrolls the page again.

## What it shows

- **On any site**, the largest version the page offers: the image file a thumbnail links to, the biggest of the sizes the page lists, or the image itself.
- **On Reddit and X**, the original upload, rather than the smaller copy the page shows. A Reddit gallery or an X post with several photos opens as a gallery, with a counter showing where you are.
- **Videos**: links to video files, Imgur GIFVs, X GIFs and small videos playing on a page. They play muted and looping, with a bar showing how far they've played.

It stays out of the way: the mouse goes right through the popup, it leaves alone images already shown at full size and small icons, and scrolling closes it. Keys you type into a text box go to the text box.

## Settings

Largitude's settings are on its page in Firefox's **Add-ons and themes** (`about:addons`):

- **Sites to leave alone**: one per line, such as `example.com` or a page's address copied from the address bar. Largitude does nothing there, subdomains included.
- **Reverse the mouse wheel in galleries**: scrolling down shows the previous image instead of the next.

Changes apply at once, on pages already open too.

## Limits

- Videos a site streams can't be shown: YouTube's, X's videos (its GIFs work), Reddit's, and most news sites' players.
- Original uploads and galleries are only known on Reddit and X so far. Elsewhere, Largitude shows the largest version the page itself offers.
- An image in a small embedded frame has little room for a popup, since the popup stays inside the frame.

Coming next: YouTube, Reddit video, and more image hosts.

## Privacy and permissions

Largitude collects no data and sends nothing anywhere. It only loads the images and videos the page refers to, or larger versions of them from the same service.

Firefox asks for two permissions when you install it:

- **Access your data for all websites**, to find the image under the mouse and show the popup on any page.
- **Download files and read and modify the browser's download history**, so that S can save the image or video the popup shows. Largitude only starts downloads; it doesn't read your download history.

## Feedback

Report a problem or suggest an idea in [GitHub Issues](https://github.com/codexjdub/Largitude/issues).

## Development

How Largitude works, and how to work on it, is in [DEVELOPMENT.md](DEVELOPMENT.md).

## License

[MIT](LICENSE)
