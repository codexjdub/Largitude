// Imgur: the original behind a thumbnail or a link to an image's page, and the video behind a GIFV.
addSite({
  name: 'Imgur',
  larger: [
    // A .gifv address is a page that plays the MP4 of the same name.
    [/^(https?:\/\/i\.imgur\.com\/\w+)\.gifv(?:[?#].*)?$/i, '$1.mp4'],
    // Thumbnails add a letter for their size to the image's id, which is 5 or 7 characters: s, b and t are
    // squares and small copies, m, l and h 320, 640 and 1024 px. Without it, the address is the original.
    [/^(https?:\/\/i\.imgur\.com\/(?:\w{5}|\w{7}))[sbtmlh]\.(jpe?g|png|gif|webp)(?:[?#].*)?$/, '$1.$2'],
    // An image's page, imgur.com/<id>: the image itself is on i.imgur.com, whatever its type, under .jpg. Ids
    // mix capitals and digits in, which tells them from Imgur's own pages, such as imgur.com/privacy. Albums
    // (imgur.com/a/…, imgur.com/gallery/…) are named by an id of their own, not their images'.
    [/^https?:\/\/(?:www\.|m\.)?imgur\.com\/((?=\w*[A-Z0-9])(?:\w{5}|\w{7}))(?:[?#].*)?$/, 'https://i.imgur.com/$1.jpg'],
  ],
});
