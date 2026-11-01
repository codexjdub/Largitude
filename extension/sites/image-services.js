// Image services that many sites use. Each puts the size it was asked for in the image's address, in its own
// way; taking the size out leaves the image as it was uploaded.
addSite({
  name: 'Image services',
  larger: [
    // WordPress keeps smaller copies beside an upload, named photo-300x200.jpg; WordPress.com and WordPress VIP
    // sites ask for a size in the query (?w=668, ?resize=604,403).
    [
      /^(https?:\/\/(?:[\w-]+\.files\.wordpress\.com|[^?#]+\/wp-content\/uploads)\/[^?#]+?)(?:-\d+x\d+)?(\.(?:jpe?g|png|gif|webp|avif))(?:[?#].*)?$/i,
      '$1$2',
    ],
    // Jetpack's copies, on i0.wp.com and the like, put the site's own address after the host.
    [/^https?:\/\/i\d\.wp\.com\/([^?#]+?)(?:-\d+x\d+)?(\.(?:jpe?g|png|gif|webp|avif))(?:[?#].*)?$/i, 'https://$1$2'],
    // Next.js: /_next/image?url=<the image>&w=640 is a copy of the image named in url=, which may be a path on
    // the same site.
    [
      /^https?:\/\/[^?#]*\/_next\/image\/?\?(?:[^#]*&)?url=[^&#].*$/,
      (address) => {
        try {
          const url = new URL(address);
          const image = new URL(url.searchParams.get('url'), url);
          return /^https?:$/.test(image.protocol) ? image.href : address;
        } catch (err) {
          return address;
        }
      },
    ],
    // Cloudinary: the changes made to the image come after /image/upload/, one step per part of the path, as
    // w_300,c_fill and the like, before the version (v1234) and the image's name.
    [
      /^(https?:\/\/(?:[\w-]+-)?res\.cloudinary\.com\/[^/]+\/image\/(?:upload|fetch)\/)([^?#]+)/,
      (match, start, rest) => {
        const isStep = (part) =>
          part.split(',').every((piece) => /^(?:[a-z]|ac|af|ar|bo|co|dl|dn|dpr|du|eo|fl|fn|fps|ki|pg|so|sp|vc|vs)_/.test(piece));
        const parts = rest.split('/');
        let steps = 0;
        while (steps < parts.length - 1 && isStep(parts[steps])) steps++;
        return start + parts.slice(steps).join('/');
      },
    ],
    // imgix: the size is asked for in the query (?w=300&fit=crop).
    [/^(https?:\/\/[\w-]+\.imgix\.net\/[^?#]+)\?[^#]*/, '$1'],
    // Google (Blogger, Google Play, YouTube's profile pictures and others): =s200, =w240-h480-rw and the like at
    // the end; =s0 is the original size.
    [/^(https?:\/\/[\w-]+\.(?:googleusercontent|ggpht)\.com\/[^?#=]+)=[\w-]*$/, '$1=s0'],
    // Blogger also puts it in the path, before the image's name: /s320/photo.jpg, /w640-h400/photo.jpg.
    [
      /^(https?:\/\/(?:blogger\.googleusercontent\.com\/img|\d+\.bp\.blogspot\.com)\/[^?#]+\/)[swh]\d+(?:-[\w-]+)?(\/[^/?#]+)$/,
      '$1s0$2',
    ],
  ],
});
