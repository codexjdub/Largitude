// Pinterest: pins as uploaded.
addSite({
  name: 'Pinterest',
  larger: [
    // Copies are in folders named by width (236x, 736x); originals/ has the image as uploaded. Its name always
    // ends in .jpg, even where the original is a PNG, so 1200x, the largest copy, comes next.
    [/^(https?:\/\/i\.pinimg\.com)\/\d+x\d*(?:_RS)?\//, '$1/originals/'],
    [/^(https?:\/\/i\.pinimg\.com)\/\d+x\d*(?:_RS)?\//, '$1/1200x/'],
  ],
});
