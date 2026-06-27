/* ===========================
 * GRID: LAYOUT + FILTER/RENDER
 * =========================== */
const DASHBOARD_CARD_PREVIEW_SPECS = Object.freeze({
  'quantum_exposure.png': {
    url: 'webapps/quantum_exposure/preview.html',
    width: 1280,
    height: 720,
  },
  'dca_cost_basis.png': {
    url: 'webapps/dca_cost_basis/preview.html',
    width: 1280,
    height: 720,
  },
  'days_since_ath.png': {
    url: 'webapps/days_since_ath/preview.html',
    width: 1280,
    height: 720,
  },
  'issuance_rate.png': {
    url: 'webapps/issuance_rate/preview.html',
    width: 1280,
    height: 720,
  },
  'dca_comparison.png': {
    url: 'webapps/dca_comparison/preview.html',
    width: 1280,
    height: 720,
  },
  'patoshi_pattern.png': {
    url: 'webapps/patoshi_pattern/preview.html',
    width: 1280,
    height: 720,
  },
  'bip110_signaling.png': {
    url: 'webapps/bip110_signaling/preview.html',
    width: 1280,
    height: 720,
  },
  'bitcoin_dominance.png': {
    url: 'webapps/bitcoin_dominance/preview.html',
    width: 1280,
    height: 720,
  },
  'uoa.png': {
    url: 'webapps/uoa/preview.html',
    width: 1280,
    height: 720,
  },
  'node_count.png': {
    url: 'webapps/node_count/preview.html',
    width: 1280,
    height: 720,
  },
  'bitcoin_net_worth.png': {
    url: 'webapps/bitcoin_net_worth/preview.html',
    width: 1280,
    height: 720,
  },
  'casascius_explorer.png': {
    url: 'webapps/casascius_explorer/preview.html',
    width: 1280,
    height: 720,
  },
});

const DASHBOARD_CARD_PREVIEW_CACHE_VERSION = '20260612-grid-ready-v2';
let dashboardPreviewResizeObserver = null;
let dashboardPreviewWindowResizeBound = false;
const GRID_FOCUS_RESTORE_KEY = 'wsb_pending_grid_focus_filename_v1';
let layoutForcedByNarrowWidth = false;
let layoutBeforeNarrowForce = null;

function getDashboardCardPreviewSpec(filename) {
  return DASHBOARD_CARD_PREVIEW_SPECS[String(filename || '').trim().toLowerCase()] || null;
}

function getDashboardPreviewUrl(url, paramName = 'preview') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, window.location.href);
    parsed.searchParams.set(paramName, DASHBOARD_CARD_PREVIEW_CACHE_VERSION);
    return parsed.href;
  } catch (_) {
    const separator = raw.includes('?') ? '&' : '?';
    return `${raw}${separator}${encodeURIComponent(paramName)}=${encodeURIComponent(DASHBOARD_CARD_PREVIEW_CACHE_VERSION)}`;
  }
}

function updateDashboardPreviewScale(card) {
  const preview = card?.preview;
  if (!preview) return;
  const { viewport, scene, width, height } = preview;
  if (!viewport?.isConnected || !scene?.isConnected) return;

  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const scale = Math.min(rect.width / width, rect.height / height);
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const offsetX = Math.max(0, (rect.width - scaledWidth) / 2);
  const offsetY = Math.max(0, (rect.height - scaledHeight) / 2);

  scene.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}

function updateAllDashboardPreviewScales() {
  for (const card of cardByFilename.values()) {
    if (card?.preview) updateDashboardPreviewScale(card);
  }
}

function ensureDashboardPreviewObservers() {
  if (!dashboardPreviewResizeObserver && typeof ResizeObserver !== 'undefined') {
    dashboardPreviewResizeObserver = new ResizeObserver(() => {
      updateAllDashboardPreviewScales();
    });
  }
  if (!dashboardPreviewWindowResizeBound) {
    window.addEventListener('resize', updateAllDashboardPreviewScales);
    dashboardPreviewWindowResizeBound = true;
  }
}

function setGridCardLoading(card) {
  const wrapper = card?.wrapper;
  if (!wrapper) return;
  wrapper.classList.remove('card-ready');
  wrapper.classList.add('card-loading');
  if (card.spinner && !card.spinner.isConnected) {
    wrapper.insertBefore(card.spinner, wrapper.firstChild);
  }
}

function nextGridCardPaint() {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function markGridCardReady(card, { loaded = true } = {}) {
  const wrapper = card?.wrapper;
  if (!wrapper || wrapper.classList.contains('card-ready')) return;
  await nextGridCardPaint();
  if (!wrapper.isConnected) return;
  wrapper.classList.remove('card-loading');
  wrapper.classList.add('card-ready');
  if (card.spinner?.parentElement) card.spinner.remove();
  if (card.img) {
    card.img.style.opacity = '';
    card.img.dataset.loaded = loaded ? '1' : '0';
  }
}

function startDashboardPreviewReadyPolling(card) {
  const iframe = card?.preview?.iframe;
  if (!iframe) return;
  const token = Symbol('dashboard-preview-ready-poll');
  card.preview.readyPollToken = token;
  const startedAt = Date.now();
  const poll = () => {
    if (card.preview.readyPollToken !== token) return;
    if (!iframe.isConnected || card.wrapper?.classList.contains('card-ready')) return;
    try {
      const doc = iframe.contentDocument;
      if (doc?.documentElement?.dataset?.previewReady === '1') {
        markGridCardReady(card);
        return;
      }
    } catch (_) {
      return;
    }
    if (Date.now() - startedAt < 20000) {
      window.setTimeout(poll, 100);
    }
  };
  window.setTimeout(poll, 0);
}

function setupDashboardPreviewReadyListener() {
  if (setupDashboardPreviewReadyListener.bound) return;
  setupDashboardPreviewReadyListener.bound = true;
  window.addEventListener('message', (event) => {
    if (window.location.protocol !== 'file:' && event.origin !== window.location.origin) return;
    if (event.data?.type !== 'wsb-preview-ready') return;
    const filename = String(event.data.filename || '').trim().toLowerCase();
    for (const card of cardByFilename.values()) {
      const preview = card?.preview;
      if (!preview?.iframe || preview.iframe.contentWindow !== event.source) continue;
      if (filename && String(preview.filename || '').trim().toLowerCase() !== filename) continue;
      markGridCardReady(card);
      return;
    }
  });
}

function openModalByFilename(fname){
  if(!fname) return;
  const idx = visibleImages.findIndex(x => x.filename === fname);
  if(idx !== -1) openModalByIndex(idx);
  else openByFilenameAllowingNonFav(fname);
}
function buildGridOnce(){
  if(gridBuilt) return;
  gridBuilt = true;
  const grid = document.getElementById('image-grid');
  grid.innerHTML = '';
  cardByFilename.clear();
  for(const {filename, title, description} of imageList){
    const previewSpec = getDashboardCardPreviewSpec(filename);
    const container = document.createElement('div');
    const titleElem = document.createElement('div');
    titleElem.className = 'chart-title';
    titleElem.textContent = title;
    const chartContainer = document.createElement('div');
    chartContainer.className = 'chart-container';
    const chartWrapper = document.createElement('div');
    chartWrapper.className = 'chart-wrapper';
    chartWrapper.classList.add('card-loading');
    const spinner = document.createElement('div');
    spinner.className = 'chart-loading';
    const img = document.createElement('img');
    img.className = 'grid-thumb lazy';
    img.dataset.filename = filename;
    img.dataset.src = imgSrc(filename);
    img.alt = title || '';
    const onOpen = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
      const filename = img.dataset.filename;
      const routeUrl = typeof getVisualizationUrl === 'function'
        ? getVisualizationUrl(filename)
        : '';
      if (routeUrl) {
        window.location.href = routeUrl;
        return;
      }
      openModalByFilename(filename);
    };

    chartContainer.dataset.filename = filename;
    chartContainer.tabIndex = 0;
    chartContainer.addEventListener('click', onOpen);
    chartContainer.addEventListener('keydown', (e) => {
      const isActivate = (
        e.key === 'Enter'
        || e.key === ' '
        || e.key === 'Spacebar'
        || e.code === 'Space'
      );
      if (!isActivate) return;
      onOpen(e);
    });

    img.onload = () => {
      const card = cardByFilename.get(_cardKey(filename));
      markGridCardReady(card, { loaded: true });
    };
    img.onerror = () => {
      const card = cardByFilename.get(_cardKey(filename));
      markGridCardReady(card, { loaded: false });
    };
    const star = document.createElement('div');
    star.className = 'favorite-star';
    const favOn = isFavorite(filename);
    star.textContent = favOn ? '★' : '☆';
    if(favOn) star.classList.add('filled');
    star.setAttribute('data-filename', filename);
    // record favourite state on the image element itself so that the lazy loader
    // can quickly inspect it without hitting localStorage repeatedly.
    img.dataset.fav = favOn ? '1' : '0';
    img.dataset.filename = filename; // already set but ensure consistency
    star.onclick = e => {
      e.stopPropagation();
      toggleFavorite(img.dataset.filename, star);
    };

    chartContainer.appendChild(star);

    if (previewSpec) {
      chartWrapper.classList.add('dashboard-preview-wrapper');
      const viewport = document.createElement('div');
      viewport.className = 'dashboard-preview-viewport';
      const scene = document.createElement('div');
      scene.className = 'dashboard-preview-scene';
      scene.style.width = `${previewSpec.width}px`;
      scene.style.height = `${previewSpec.height}px`;
      const iframe = document.createElement('iframe');
      iframe.className = 'dashboard-preview-frame';
      iframe.src = getDashboardPreviewUrl(previewSpec.url);
      iframe.dataset.baseSrc = previewSpec.url;
      iframe.dataset.filename = filename;
      iframe.title = `${title || filename} preview`;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      iframe.addEventListener('load', () => {
        const card = cardByFilename.get(_cardKey(filename));
        startDashboardPreviewReadyPolling(card);
        if (typeof postThemeToPreviewFrames === 'function') {
          postThemeToPreviewFrames(
            typeof getStoredDashboardTheme === 'function' ? getStoredDashboardTheme() : 'dark'
          );
        }
      });

      scene.appendChild(iframe);
      viewport.appendChild(scene);
      chartWrapper.appendChild(spinner);
      chartWrapper.appendChild(viewport);

      container.dataset.dashboardPreview = '1';
      cardByFilename.set(_cardKey(filename), {
        container,
        img,
        titleElem,
        desc: null,
        star,
        wrapper: chartWrapper,
        spinner,
        preview: {
          filename,
          viewport,
          scene,
          iframe,
          url: previewSpec.url,
          width: previewSpec.width,
          height: previewSpec.height,
        },
      });
    } else {
      chartWrapper.appendChild(spinner);
      chartWrapper.appendChild(img);
      cardByFilename.set(_cardKey(filename), {container, img, titleElem, desc: null, star, wrapper: chartWrapper, spinner});
    }

    chartContainer.appendChild(chartWrapper);
    const desc = document.createElement('div');
    desc.className = 'chart-description';
    desc.textContent = description;
    chartContainer.appendChild(desc);
    container.appendChild(titleElem);
    container.appendChild(chartContainer);
    grid.appendChild(container);
    const card = cardByFilename.get(_cardKey(filename));
    if (card) card.desc = desc;
  }

  ensureDashboardPreviewObservers();
  setupDashboardPreviewReadyListener();
  if (dashboardPreviewResizeObserver) {
    for (const card of cardByFilename.values()) {
      if (card?.preview?.viewport) {
        dashboardPreviewResizeObserver.observe(card.preview.viewport);
      }
    }
  }

  updateAllDashboardPreviewScales();
  initLazyImages();
}
function filterImages(){
  buildGridOnce();
  const query = (document.getElementById('search-input')?.value || '').toLowerCase();
  const {inTitle, inDesc} = readSearchPrefs();
  visibleImages = imageList.filter(({title, description, filename}) => {
    let matchesSearch = true;
    if(query){
      const hayTitle = inTitle ? (title || '').toLowerCase() : '';
      const hayDesc  = inDesc  ? (description || '').toLowerCase() : '';
      matchesSearch = hayTitle.includes(query) || hayDesc.includes(query);
    }
    return matchesSearch && (!showFavoritesOnly || isFavorite(filename));
  });
  const message = document.getElementById('no-favorites-message');
  if(message) message.style.display = (showFavoritesOnly && visibleImages.length === 0) ? 'block' : 'none';
  const visibleKeys = new Set();
  visibleImages.forEach((item, index) => {
    const card = cardByFilename.get(_cardKey(item.filename));
    if(!card) return;
    visibleKeys.add(_cardKey(item.filename));
    card.container.style.display = '';
    const chartContainer = card.container.querySelector('.chart-container');
    if (chartContainer) {
      chartContainer.dataset.gridIndex = index;
      chartContainer.dataset.filename = item.filename;
    }
    if (card.img) card.img.dataset.gridIndex = index;
    // update the fav flag in case the user changed it while browsing
    if (card.img) card.img.dataset.fav = isFavorite(item.filename) ? '1' : '0';
    card.titleElem.dataset.gridIndex = index;
    if (card.desc) card.desc.dataset.gridIndex = index;
  });
  for (const [key, card] of cardByFilename.entries()) {
    if (visibleKeys.has(key)) continue;
    card.container.style.display = 'none';
  }
  updateLayoutBasedOnWidth();
  updateAllDashboardPreviewScales();
  initLazyImages();

  // If a modal close triggered a return to homepage, restore focus to that card.
  try {
    const pendingFilename = String(sessionStorage.getItem(GRID_FOCUS_RESTORE_KEY) || '').trim();
    if (pendingFilename) {
      const card = cardByFilename.get(_cardKey(pendingFilename));
      const target = card?.container?.querySelector?.('.chart-container');
      if (target && typeof target.focus === 'function' && target.offsetParent !== null) {
        requestAnimationFrame(() => {
          try { target.focus({ preventScroll: true }); }
          catch (_) { target.focus(); }
        });
        sessionStorage.removeItem(GRID_FOCUS_RESTORE_KEY);
      }
    }
  } catch (_) {
    // Ignore storage failures.
  }
}
function setLayout(type, manual = true) {
    imageGrid.classList.remove('grid', 'list');
    imageGrid.classList.add(type);
    if (type === 'grid') {
        gridIcon.classList.add('active');
        listIcon.classList.remove('active');
    } else {
        listIcon.classList.add('active');
        gridIcon.classList.remove('active');
    }
    if (manual) {
      layoutForcedByNarrowWidth = false;
      layoutBeforeNarrowForce = null;
        userSelectedLayout = type;
        localStorage.setItem('preferredLayout', type);
    }
}
function updateLayoutBasedOnWidth() {
  const toggleIconsEl = document.getElementById('toggleIcons');
  const searchContainer = document.querySelector('.search-container');
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  if(!imageGrid || !toggleIconsEl || !searchContainer || !searchInput || !searchBtn) return;
  searchContainer.classList.add('active');
  setSearchInputFocusability(true);
  const containerWidth = imageGrid.offsetWidth;
  const columnWidth = 280 + 32;
  const columns = Math.floor(containerWidth / columnWidth);
  const storedLayout = localStorage.getItem('preferredLayout');
  const storedPreferred = storedLayout === 'grid' || storedLayout === 'list' ? storedLayout : null;

  if (columns < 2) {
    if (!layoutForcedByNarrowWidth) {
      layoutBeforeNarrowForce =
        userSelectedLayout ||
        storedPreferred ||
        (imageGrid.classList.contains('list') ? 'list' : 'grid');
    }
    layoutForcedByNarrowWidth = true;
    toggleIconsEl.style.display = 'none';
    searchBtn.disabled = false;
    if (!imageGrid.classList.contains('list')) {
      setLayout('list', false);
    }
  } else {
    toggleIconsEl.style.display = 'inline-flex';
    searchBtn.disabled = false;

    if (layoutForcedByNarrowWidth) {
      const restoreLayout =
        layoutBeforeNarrowForce ||
        userSelectedLayout ||
        storedPreferred ||
        'grid';
      layoutForcedByNarrowWidth = false;
      layoutBeforeNarrowForce = null;
      setLayout(restoreLayout, false);
      return;
    }

    const preferred =
      userSelectedLayout ||
      storedPreferred ||
      (imageGrid.classList.contains('list') ? 'list' : 'grid');
    setLayout(preferred, false);
  }
}
function toggleSearch() {
  const input = document.getElementById('search-input');
  if (!input) return;

  // Defer focus so it wins over other click handlers running in the same tick.
  requestAnimationFrame(() => {
    input.focus({ preventScroll: true });
    const end = input.value.length;
    try {
      input.setSelectionRange(end, end);
    } catch (_) {
      // setSelectionRange can fail on some input types; safe to ignore here.
    }
  });
}
