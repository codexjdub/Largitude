// Amazon and IMDb, which share Amazon's image server: product photos and posters as uploaded.
addSite({
  name: 'Amazon and IMDb',
  larger: [
    // A copy's size and format are a code between the image's name and its extension, as in
    // 71DQp57-ltL._AC_UY654_FMwebp_QL65_.jpg or MV5B…@._V1_QL75_UX180_.jpg; without it, the address is the original.
    [
      /^(https?:\/\/(?:m\.media-amazon\.com|images-(?:na|eu|fe)\.ssl-images-amazon\.com)\/images\/[IM]\/[^/?#]+?)\._[^/?#]*_\.(jpe?g|png|gif|webp)(?:[?#].*)?$/i,
      '$1.$2',
    ],
  ],
});
