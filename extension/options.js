// The settings page: saves each change as it is made.
// DEFAULT_OPTIONS comes from defaults.js, loaded first.
const field = (id) => document.getElementById(id);
const status = field('status');

function show(text) {
  status.textContent = text;
  setTimeout(() => {
    if (status.textContent === text) status.textContent = '';
  }, 2500);
}

async function load() {
  const { options } = await browser.storage.local.get('options');
  const values = { ...DEFAULT_OPTIONS, ...options };
  field('excluded').value = values.excluded;
  field('reverseWheel').checked = values.reverseWheel;
}

async function save() {
  await browser.storage.local.set({
    options: {
      excluded: field('excluded').value,
      reverseWheel: field('reverseWheel').checked,
    },
  });
  show('Saved.');
}

field('options').addEventListener('change', save);
field('options').addEventListener('submit', (event) => event.preventDefault());
load();
