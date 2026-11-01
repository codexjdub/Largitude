// eBay: listing photos at their largest.
addSite({
  name: 'eBay',
  larger: [
    // s-l500 asks for at most 500 px; s-l1600 is the largest eBay serves.
    [
      /^(https?:\/\/i\.ebayimg\.com\/)(?:thumbs\/)?(images\/g\/[^/?#]+\/)s-l\d+(\.(?:jpe?g|png|webp))(?:[?#].*)?$/i,
      '$1$2s-l1600$3',
    ],
  ],
});
