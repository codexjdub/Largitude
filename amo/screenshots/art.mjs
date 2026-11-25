// The pictures on the screenshots' pages: landscapes drawn here, as SVG, so that the screenshots show nobody else's
// work. The same seed draws the same picture every time.
const W = 1600;
const H = 1000;

function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A line of hills or peaks across the picture, `base` at its lowest and up to about `height` above it, and the
// height of the line at any x.
function ridge(rand, { base, height, waves = 5, roughness = 1.5, sharp = false }) {
  const parts = Array.from({ length: waves }, (_, i) => ({
    amp: (height / 1.9 ** i) * (0.55 + rand() * 0.6),
    freq: (((i + 1) * roughness * (0.7 + rand() * 0.6)) / W) * 2 * Math.PI,
    phase: rand() * 2 * Math.PI,
  }));
  const yAt = (x) =>
    base -
    parts.reduce((sum, p) => {
      const s = Math.sin(x * p.freq + p.phase);
      return sum + p.amp * (sharp ? 1 - Math.abs(s) : 0.5 + 0.5 * s);
    }, 0);
  const points = [];
  for (let x = 0; x <= W; x += 8) points.push(`${x},${yAt(x).toFixed(1)}`);
  return { yAt, points, d: `M0,${H} L${points.join(' L')} L${W},${H} Z` };
}

const gradient = (id, stops, vertical = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">` +
  stops.map(([at, color, opacity = 1]) => `<stop offset="${at}" stop-color="${color}" stop-opacity="${opacity}"/>`).join('') +
  '</linearGradient>';

function stars(rand, count, below) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const r = (0.5 + rand() ** 3 * 1.8).toFixed(2);
    out += `<circle cx="${(rand() * W).toFixed(0)}" cy="${(rand() * below).toFixed(0)}" r="${r}" fill="#fff" opacity="${(0.35 + rand() * 0.65).toFixed(2)}"/>`;
  }
  return out;
}

function clouds(rand, count, top, bottom, color) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = rand() * W;
    const y = top + rand() * (bottom - top);
    const w = 120 + rand() * 220;
    for (let j = 0; j < 4; j++) {
      out += `<ellipse cx="${(x + (j - 1.5) * w * 0.35).toFixed(0)}" cy="${(y - Math.sin(j) * 14).toFixed(0)}" rx="${(w * (0.3 + rand() * 0.2)).toFixed(0)}" ry="${(18 + rand() * 18).toFixed(0)}" fill="${color}"/>`;
    }
  }
  return `<g filter="url(#soft)" opacity="0.8">${out}</g>`;
}

// Small firs along a ridge.
function trees(rand, line, color, size) {
  let out = '';
  for (let x = -10; x < W + 10; x += size * (0.45 + rand() * 0.5)) {
    const h = size * (0.9 + rand() * 1.1);
    const y = line.yAt(x) + size * 0.5;
    out += `M${x.toFixed(1)},${(y - h).toFixed(1)} L${(x + h * 0.28).toFixed(1)},${y.toFixed(1)} L${(x - h * 0.28).toFixed(1)},${y.toFixed(1)} Z `;
  }
  return `<path d="${out}" fill="${color}"/>`;
}

// One picture: a sky from `sky` (top to horizon), a sun or moon, layers of ridges from far to near, and water below
// `water` that mirrors them.
function landscape({ seed, sky, sun, ridges, water, night, aurora, cloud, forest }) {
  const rand = random(seed);
  const defs = [
    gradient('sky', sky.map((color, i) => [i / (sky.length - 1), color])),
    '<filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>',
    '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>',
  ];
  let body = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  if (night) body += stars(rand, 260, (water || H) * 0.8);
  if (aurora) {
    defs.push(gradient('aurora', [[0, aurora[0], 0], [0.5, aurora[0], 0.9], [1, aurora[1], 0]]));
    for (let i = 0; i < 3; i++) {
      const band = ridge(rand, { base: 330 + i * 40, height: 160, waves: 3, roughness: 1 });
      const top = 120 + i * 30;
      body += `<path d="M${band.points.join(' L')} L${W},${top} L0,${top} Z" fill="url(#aurora)" filter="url(#soft)" opacity="${0.75 - i * 0.2}"/>`;
    }
  }
  if (sun) {
    const [x, y, r, color] = sun;
    body += `<circle cx="${x}" cy="${y}" r="${r * 3}" fill="${color}" opacity="0.45" filter="url(#glow)"/>`;
    body += `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
  }
  if (cloud) body += clouds(rand, 5, 120, 420, cloud);
  let land = '';
  ridges.forEach((options, i) => {
    const line = ridge(rand, options);
    const id = 'ridge' + i;
    defs.push(gradient(id, [[0, options.color], [1, options.fog || options.color]]));
    land += `<path d="${line.d}" fill="url(#${id})"/>`;
    if (forest && i === ridges.length - 1) land += trees(rand, line, options.color, forest);
  });
  body += land;
  if (water) {
    defs.push(`<clipPath id="below"><rect y="${water}" width="${W}" height="${H - water}"/></clipPath>`);
    defs.push(gradient('water', [[0, sky[sky.length - 1], 0.35], [1, sky[0], 0.85]]));
    body += `<g clip-path="url(#below)"><rect y="${water}" width="${W}" height="${H - water}" fill="${sky[sky.length - 2]}"/>`;
    body += `<g transform="translate(0 ${2 * water}) scale(1 -1)" opacity="0.55">${sun ? `<circle cx="${sun[0]}" cy="${sun[1]}" r="${sun[2]}" fill="${sun[3]}"/>` : ''}${land}</g>`;
    body += `<rect y="${water}" width="${W}" height="${H - water}" fill="url(#water)"/>`;
    for (let i = 0; i < 40; i++) {
      const y = water + 8 + rand() ** 1.6 * (H - water);
      const x = rand() * W;
      body += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${(40 + rand() * 160).toFixed(0)}" height="2" fill="#fff" opacity="${(0.08 + rand() * 0.15).toFixed(2)}"/>`;
    }
    body += '</g>';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs.join('')}</defs>${body}</svg>`;
}

// The pictures, by name: a title for the page to show, and how to draw it.
export const pictures = {
  'lake-at-dawn': {
    title: 'Lake at dawn',
    svg: landscape({
      seed: 3,
      sky: ['#6f7fc4', '#c99bb6', '#f4b7a0', '#fbdcb6'],
      sun: [1080, 600, 46, '#fff4dc'],
      water: 660,
      ridges: [
        { base: 640, height: 260, sharp: true, color: '#9a93c2', fog: '#c8b3c6' },
        { base: 660, height: 190, sharp: true, color: '#6f6aa2', fog: '#9a8fb5' },
        { base: 670, height: 110, color: '#45467a', fog: '#5d5a8a' },
      ],
    }),
  },
  'dunes-at-dusk': {
    title: 'Dunes at dusk',
    svg: landscape({
      seed: 11,
      sky: ['#2a1f52', '#7b3a6e', '#d65f64', '#f7a25e'],
      sun: [520, 640, 70, '#ffd690'],
      ridges: [
        { base: 720, height: 120, roughness: 1, color: '#d27a50', fog: '#e59a64' },
        { base: 820, height: 150, roughness: 0.8, color: '#b35b3d', fog: '#c8704a' },
        { base: 930, height: 170, roughness: 0.7, color: '#7d3a2c', fog: '#93472f' },
        { base: 1040, height: 180, roughness: 0.6, color: '#4e2322', fog: '#5e2a25' },
      ],
    }),
  },
  'northern-lights': {
    title: 'Northern lights',
    svg: landscape({
      seed: 7,
      sky: ['#050a1c', '#0b1a3b', '#123063', '#1a3f6e'],
      night: true,
      aurora: ['#5cf2a8', '#38c7d9'],
      ridges: [
        { base: 760, height: 260, sharp: true, color: '#1b2c4a', fog: '#24406a' },
        { base: 860, height: 160, sharp: true, color: '#111d33', fog: '#182b48' },
        { base: 980, height: 120, color: '#080f1e', fog: '#0c1628' },
      ],
    }),
  },
  'misty-forest': {
    title: 'Misty forest',
    svg: landscape({
      seed: 19,
      sky: ['#cfdcd6', '#e3ebe5', '#f1f3ec'],
      sun: [1220, 260, 40, '#fffbea'],
      forest: 26,
      ridges: [
        { base: 520, height: 200, color: '#aec4ba', fog: '#dfe8e2' },
        { base: 640, height: 190, color: '#86a69a', fog: '#c4d5cc' },
        { base: 780, height: 170, color: '#5b8174', fog: '#9fb9ad' },
        { base: 950, height: 160, color: '#2f5248', fog: '#4f7266' },
      ],
    }),
  },
  'sea-cliffs': {
    title: 'Sea cliffs',
    svg: landscape({
      seed: 23,
      sky: ['#4d9fdc', '#86c3ec', '#c6e6f6', '#e8f5fb'],
      sun: [320, 200, 50, '#fffef2'],
      cloud: '#ffffff',
      water: 640,
      ridges: [
        { base: 640, height: 60, roughness: 3, color: '#8aa4b6', fog: '#a9c0cf' },
        { base: 700, height: 330, roughness: 0.9, sharp: true, color: '#b88d62', fog: '#8c6a4b' },
      ],
    }),
  },
  'autumn-hills': {
    title: 'Autumn hills',
    svg: landscape({
      seed: 31,
      sky: ['#e9b878', '#f3d3a0', '#f8e9cc'],
      sun: [400, 420, 60, '#fff3d6'],
      forest: 20,
      ridges: [
        { base: 600, height: 150, color: '#d9a36a', fog: '#ebc792' },
        { base: 720, height: 160, color: '#c9773b', fog: '#dc9a5c' },
        { base: 860, height: 170, color: '#9c4f27', fog: '#b9683a' },
        { base: 1010, height: 170, color: '#5d2d1b', fog: '#7a3d24' },
      ],
    }),
  },
  'glacier-lake': {
    title: 'Glacier lake',
    svg: landscape({
      seed: 41,
      sky: ['#9cc3e6', '#c4dcf0', '#e6f0f8', '#f4f8fb'],
      cloud: '#ffffff',
      water: 700,
      ridges: [
        { base: 640, height: 380, sharp: true, color: '#f4f7fb', fog: '#b9cbdc' },
        { base: 690, height: 240, sharp: true, color: '#9fb4ca', fog: '#7d96b0' },
        { base: 705, height: 80, color: '#3e5a52', fog: '#2f4a43' },
      ],
    }),
  },
  'violet-peaks': {
    title: 'Violet peaks',
    svg: landscape({
      seed: 53,
      sky: ['#2d2363', '#6a3f8f', '#c56fa6', '#f3a7a8'],
      sun: [800, 700, 54, '#ffe2c8'],
      ridges: [
        { base: 760, height: 340, sharp: true, color: '#7d5aa0', fog: '#b07cab' },
        { base: 860, height: 260, sharp: true, color: '#55407e', fog: '#7a5793' },
        { base: 960, height: 200, sharp: true, color: '#33285a', fog: '#46346c' },
        { base: 1040, height: 120, color: '#1c1738', fog: '#251d45' },
      ],
    }),
  },
  'moonlit-bay': {
    title: 'Moonlit bay',
    svg: landscape({
      seed: 61,
      sky: ['#0a1430', '#1a2b55', '#344a7a', '#4f6390'],
      night: true,
      sun: [1150, 240, 44, '#f4f1e4'],
      water: 690,
      ridges: [
        { base: 690, height: 150, roughness: 1.2, color: '#26355d', fog: '#33467a' },
        { base: 700, height: 70, roughness: 2, color: '#141d38', fog: '#1b2748' },
      ],
    }),
  },
};
