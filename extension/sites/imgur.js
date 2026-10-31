// Imgur: the video behind a GIFV.
addSite({
  name: 'Imgur',
  larger: [
    // A .gifv address is a page that plays the MP4 of the same name.
    [/^(https?:\/\/i\.imgur\.com\/\w+)\.gifv(?:[?#].*)?$/i, '$1.mp4'],
  ],
});
