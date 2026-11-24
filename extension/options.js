// The settings page: saves each change as it is made.
// rebasedList comes from helpers.js; DEFAULT_OPTIONS, MAX_SITES, readOptions and saveOptions from settings.js, all
// loaded first.
const field = (id) => document.getElementById(id);
const status = field('status');

// The sites to leave alone as last shown, which an edit in progress started from.
let loaded = '';

function show(text) {
  status.textContent = text;
  setTimeout(() => {
    if (status.textContent === text) status.textContent = '';
  }, 2500);
}

// Shows the settings as they're stored. The list of sites stays as it is while it's being edited: the edit is saved
// on top of what changed meanwhile.
async function load() {
  const values = await readOptions();
  const list = field('excluded');
  const editing = document.activeElement === list && list.value !== loaded;
  if (!editing) {
    if (list.value !== values.excluded) list.value = values.excluded;
    loaded = values.excluded;
  }
  field('hoverDelay').value = values.hoverDelay;
  if (!field('hoverDelay').value) field('hoverDelay').value = DEFAULT_OPTIONS.hoverDelay;
  field('galleryWheelReversed').checked = values.galleryWheelReversed;
  field('keysUnderPopup').checked = values.keysUnderPopup;
}

async function save() {
  try {
    // The list as edited, with what Firefox Sync or the toolbar button changed since it was shown.
    const excluded = rebasedList(loaded, field('excluded').value, (await readOptions()).excluded);
    await saveOptions({
      excluded,
      hoverDelay: field('hoverDelay').value,
      galleryWheelReversed: field('galleryWheelReversed').checked,
      keysUnderPopup: field('keysUnderPopup').checked,
    });
    loaded = excluded;
    show('Saved.');
  } catch (err) {
    const why = {
      sites: `Couldn't save: Firefox keeps ${MAX_SITES} sites to leave alone at most.`,
      size: "Couldn't save: the list is longer than Firefox's synced storage holds.",
    };
    show(why[err && err.limit] || "Couldn't save.");
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
