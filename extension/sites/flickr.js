// Flickr: photos at 1024 px.
addSite({
  name: 'Flickr',
  larger: [
    // A letter after the photo's id and secret picks the size: _m is 240 px, _w 400, _c 800, _b 1024. The larger
    // sizes (_h, _k, the original) have secrets of their own, which the page doesn't give.
    [
      /^(https?:\/\/(?:live|farm\d+)\.staticflickr\.com\/(?:\d+\/)+\d+_[0-9a-f]+)(?:_[sqtmnwzc])?\.jpg(?:[?#].*)?$/,
      '$1_b.jpg',
    ],
  ],
});
