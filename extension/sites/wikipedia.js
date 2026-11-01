// Wikipedia and the other Wikimedia sites: the original file behind a thumbnail.
addSite({
  name: 'Wikipedia',
  larger: [
    // A thumbnail is …/thumb/a/ab/Name.jpg/250px-Name.jpg, on upload.wikimedia.org or thumb.wikimedia.org; the
    // original is …/a/ab/Name.jpg, on upload.wikimedia.org only. Originals that aren't images (PDFs, videos,
    // TIFFs) are left alone.
    [
      /^https?:\/\/(?:upload|thumb)\.wikimedia\.org\/([^?#]+?)\/thumb\/([0-9a-f]\/[0-9a-f]{2}\/[^/?#]+\.(?:jpe?g|png|gif|webp|svg))\/[^/?#]+(?:[?#].*)?$/i,
      'https://upload.wikimedia.org/$1/$2',
    ],
  ],
});
