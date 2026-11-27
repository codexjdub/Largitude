# Largitude

A Firefox extension that shows images and videos full size when you rest the mouse on them, on any site.

**[Install Largitude from Firefox Add-ons](https://addons.mozilla.org/firefox/addon/largitude/)**. It needs Firefox 142 or later, on the desktop.

## How to use it

Rest the mouse on a thumbnail, a picture in a post, or a link to an image or video file. After a moment, the full-size version grows out of the thumbnail to open beside the pointer, fitted to the window, with a checkerboard showing through any transparent parts. The thumbnail shows, softened, until the full-size image has loaded, and for a moment a corner says how big the image is and how much bigger than the thumbnail. Move away and it shrinks back into the thumbnail.

While it's open:

| Key | What it does |
| --- | --- |
| ← → or the mouse wheel | Move through a gallery |
| S | Save the image or video; for one you've already saved, it says so, and S again saves a copy |
| O | Open it in a new tab |
| C | Copy the image (on https pages, where Firefox allows it) |
| Shift+C | Copy the image's or video's address |
| Z | Show the image at its actual size, filling the window; move the mouse to look around it, and press Z again to go back |
| R | Turn the image or video a quarter turn clockwise |
| F | Flip the image or video left to right |
| M | Turn a video's sound on or off |
| Space | Pause or play a video |
| ← → | Go back or on 5 seconds in a video that isn't in a gallery |
| I | Show details over the popup: the file's name, size in pixels, type, size and site, and a video's length |
| ? | Show every key over the popup, and hide them again |
| Escape, or a click | Close it |

A line under the popup shows a few of the keys for what it shows, such as M and Space for a video. Once you know them, you can turn it off in the settings, and the popup gets that room too.

The mouse wheel moves through a gallery the way it scrolls the page: scrolling down shows the next image. Past the last one, it scrolls the page again. The keys you press light up in the line under the popup, the next image slides in, and at either end of a gallery the popup gives a little bump.

If your system is set to reduce motion, the popup opens, closes, turns and moves through a gallery without moving.

## What it shows

- **On any site**, the largest version the page offers: the image file a thumbnail links to, the biggest of the sizes the page lists, or the image itself.
- **On sites it knows**, the original upload, rather than the smaller copy the page shows: Reddit, X, Bluesky, Imgur, Wikipedia, Amazon, IMDb, Pinterest, eBay and Flickr (at 1024 px, the largest it can find there). Also on any site whose images come from WordPress, Next.js, Cloudinary, imgix or Google (Blogger, Google Play, YouTube profile pictures).
- **Google Images**: the original image of each of the first 100 or so results, which Google's page lists; for results that load as you scroll, Google's larger thumbnail.
- **YouTube videos**: the video's largest still, for its thumbnails and for links to it, on other sites. On YouTube itself, thumbnails are left to YouTube's own preview.
- **Links to an Imgur image** (`imgur.com/…`): the image itself.
- **Galleries**: a Reddit gallery, an X post with several photos or a Bluesky post with several images opens as a gallery, with a counter and a dot for each image showing where you are.
- **Videos**: links to video files, Imgur GIFVs, X GIFs, Giphy GIFs, small videos playing on a page, and Reddit's videos, with their sound. They play muted and looping, with a bar showing how far they've played and an icon in the corner while the sound is off or the video is paused; one playing on the page goes on from where it is.

It stays out of the way: the mouse goes right through the popup, it leaves alone images already shown at full size and small icons, and scrolling closes it. Keys you type into a text box go to the text box.

## Settings

To turn Largitude off on a site, click its button in the toolbar while you're on that site: the button then shows "off" there and turns gray. Click it again to turn Largitude back on. Firefox puts the button in the Extensions menu (the puzzle piece) at first; pin it to the toolbar to see it.

Largitude's settings are on its page in Firefox's **Add-ons and themes** (`about:addons`):

- **Sites to leave alone**: one per line, such as `example.com` or a page's address copied from the address bar. Largitude does nothing there, subdomains included. The toolbar button adds sites here and takes them off.
- **Wait before showing**: how long the mouse rests on an image before the popup opens. Short, Normal or Long.
- **Show keys under the popup**: the line of keys under each popup. On at first. The settings page also lists every key.
- **Reverse the mouse wheel in galleries**: scrolling down shows the previous image instead of the next.

Changes apply at once, on pages already open too. If you sync add-ons with Firefox Sync, your settings follow you to your other computers.

## Limits

- Videos a site streams can't be played: YouTube's (their stills show), X's videos (its GIFs work), Reddit's on old.reddit.com, and most news sites' players.
- On sites it doesn't know, Largitude shows the largest version the page itself offers, which may be smaller than the original.
- An image in a small embedded frame has little room for a popup, since the popup stays inside the frame.

Coming next: more image hosts.

## Privacy and permissions

Largitude collects no data and sends nothing anywhere. It only loads the images and videos the page refers to, or larger versions of them at addresses worked out from those. Its settings, including the sites to leave alone, go to your other computers through Firefox Sync if you sync add-ons there; Firefox encrypts them so that only your devices can read them.

Firefox asks for two permissions when you install it:

- **Access your data for all websites**, to find the image under the mouse and show the popup on any page.
- **Download files and read and modify the browser's download history**, so that S can save the image or video the popup shows. Largitude only starts downloads; it doesn't read your download history.

## Feedback

Report a problem or suggest an idea in [GitHub Issues](https://github.com/codexjdub/Largitude/issues).

## Development

How Largitude works, and how to work on it, is in [DEVELOPMENT.md](DEVELOPMENT.md).

## License

[MIT](LICENSE)
