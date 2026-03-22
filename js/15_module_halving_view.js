/* ===========================
 * MODULE: Halving View
 * =========================== */
const HALVING_VIEW_OPTIONS = ['cycles_block', 'cycles_days', 'progress_block'];
const HALVING_VIEW_STORAGE_KEY = 'halvingView';

// Update this if your progress file has a different name:
const HALVING_PROGRESS_FILE = 'halving_progress.png';

let HALVING_META = {};

function isHalvingViewFile(fname) {
  return (
    fname === 'halving_cycles.png' ||
    fname === 'halving_cycles_days.png' ||
    fname === HALVING_PROGRESS_FILE
  );
}

function halvingViewFromFilename(fname) {
  if (fname === 'halving_cycles_days.png') return 'cycles_days';
  if (fname === HALVING_PROGRESS_FILE) return 'progress_block';
  return 'cycles_block';
}

function halvingFilenameForView(view) {
  if (view === 'cycles_days') return 'halving_cycles_days.png';
  if (view === 'progress_block') return HALVING_PROGRESS_FILE;
  return 'halving_cycles.png';
}

function buildHalvingMetaFromList(list) {
  HALVING_META = {};
  list.forEach(img => {
    if (isHalvingViewFile(img.filename)) {
      HALVING_META[img.filename] = {
        archived: img.archived,
        title: img.title || '',
        description: img.description || '',
        latest_x: img.latest_x || '',
        latest_nostr: img.latest_nostr || '',
        latest_youtube: img.latest_youtube || ''
      };
    }
  });
}

function populateHalvingViewSelect() {
  if (!halvingViewSelect) return;

  halvingViewSelect.innerHTML = HALVING_VIEW_OPTIONS.map(v => {
    const label =
      v === 'cycles_block' ? 'Cycles (Block Height)' :
      v === 'cycles_days'  ? 'Cycles (Days After Halving)' :
                             'Progress (Block Height)';
    return `<option value="${v}">${label}</option>`;
  }).join('');
}

function getStoredHalvingView() {
  const v = (localStorage.getItem(HALVING_VIEW_STORAGE_KEY) || '').toLowerCase();
  return HALVING_VIEW_OPTIONS.includes(v) ? v : 'cycles_block';
}

function setStoredHalvingView(v) {
  if (!HALVING_VIEW_OPTIONS.includes(v)) v = 'cycles_block';
  localStorage.setItem(HALVING_VIEW_STORAGE_KEY, v);
  return v;
}

function setHalvingView(view) {
  view = setStoredHalvingView(view);

  const cur = visibleImages[currentIndex];
  if (!cur || !isHalvingViewFile(cur.filename)) return;

  const oldFilename = cur.filename;
  const newFilename = halvingFilenameForView(view);

  const meta = HALVING_META[newFilename] || {};
  const fallbackTitle =
    view === 'cycles_days' ? 'Halving Cycles (Days After Halving)' :
    view === 'progress_block' ? 'Halving Progress (Block Height)' :
                                'Halving Cycles (Block Height)';

  const newTitle = meta.title || cur.title || fallbackTitle;
  const newDescription = meta.description || cur.description || '';

  const latest_x = meta.latest_x || cur.latest_x || '';
  const latest_nostr = meta.latest_nostr || cur.latest_nostr || '';
  const latest_youtube = meta.latest_youtube || cur.latest_youtube || '';

  setModalImageAndCenter(newFilename, newTitle);
  replaceUrlForFilename(newFilename);
  setModalLinks({ x: latest_x, nostr: latest_nostr, youtube: latest_youtube });

  Object.assign(visibleImages[currentIndex], {
    filename: newFilename,
    title: newTitle,
    description: newDescription,
    latest_x,
    latest_nostr,
    latest_youtube
  });

  // Update grid UI immediately
  updateGridCardAtCurrent({
    oldFilename,
    newFilename,
    title: newTitle,
    description: newDescription
  });

  migrateFavoriteFilename(oldFilename, newFilename);
  updateModalSafePadding();
}

function cycleHalvingView(direction /* 'up' | 'down' */) {
  if (!halvingViewSelect) return;
  const current =
    halvingViewSelect.value ||
    halvingViewFromFilename(visibleImages[currentIndex]?.filename || '');

  const idx = HALVING_VIEW_OPTIONS.indexOf(current);
  if (idx === -1) return;

  const delta = direction === 'up' ? -1 : 1;
  const next = HALVING_VIEW_OPTIONS[(idx + delta + HALVING_VIEW_OPTIONS.length) % HALVING_VIEW_OPTIONS.length];
  halvingViewSelect.value = next;
  setHalvingView(next);
}