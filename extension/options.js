// The settings page: saves each change as it is made.
// entriesOf comes from helpers.js; DEFAULT_OPTIONS, MAX_SITES, readOptions and saveOptions from settings.js, all
// loaded first.
const field = (id) => document.getElementById(id);
const status = field('status');

function show(text) {
  status.textContent = text;
  setTimeout(() => {
    if (status.textContent === text) status.textContent = '';
  }, 2500);
}

async function load() {
  const values = await readOptions();
  if (field('excluded').value !== values.excluded) field('excluded').value = values.excluded;
  field('hoverDelay').value = values.hoverDelay;
  if (!field('hoverDelay').value) field('hoverDelay').value = DEFAULT_OPTIONS.hoverDelay;
  field('galleryWheelReversed').checked = values.galleryWheelReversed;
  field('keysUnderPopup').checked = values.keysUnderPopup;
}

async function save() {
  try {
    await saveOptions({
      excluded: field('excluded').value,
      hoverDelay: field('hoverDelay').value,
      galleryWheelReversed: field('galleryWheelReversed').checked,
      keysUnderPopup: field('keysUnderPopup').checked,
    });
    show('Saved.');
  } catch (err) {
    const tooMany = entriesOf(field('excluded').value).length > MAX_SITES;
    show(tooMany ? `Couldn't save: Firefox keeps ${MAX_SITES} sites to leave alone at most.` : "Couldn't save.");
  }
}

field('options').addEventListener('change', save);
field('options').addEventListener('submit', (event) => event.preventDefault());
// The toolbar button changes the sites to leave alone too, and Firefox Sync brings changes made on other
// computers: the page shows the settings as they now are, so that saving another change doesn't put back old ones.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') load();
});
load();
