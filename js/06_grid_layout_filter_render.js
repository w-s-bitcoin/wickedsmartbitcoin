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

const DASHBOARD_CARD_PREVIEW_CACHE_VERSION = '20260825-stage5-atomic-v1';
const DASHBOARD_PREVIEW_ROOT_MARGIN = '720px 0px';
const DASHBOARD_PREVIEW_LOAD_STAGGER_MS = 140;
let dashboardPreviewResizeObserver = null;
let dashboardPreviewWindowResizeBound = false;
let dashboardPreviewLoadObserver = null;
let dashboardPreviewLoadPassQueued = false;
let dashboardPreviewIdleLoadHandle = null;
const GRID_FOCUS_RESTORE_KEY = 'wsb_pending_grid_focus_filename_v1';
let layoutForcedByNarrowWidth = false;
let layoutBeforeNarrowForce = null;
let gridReorderMode = false;
let gridReorderLongPressTimer = null;
let gridReorderPressState = null;
let gridReorderDragState = null;
let gridReorderSuppressClickUntil = 0;

function normalizeDashboardGridOrder(order) {
  if (!Array.isArray(order)) return [];
  const seen = new Set();
  return order
    .map((value) => String(value || '').trim())
    .filter((filename) => {
      if (!filename || seen.has(filename)) return false;
      seen.add(filename);
      return true;
    });
}

function readDashboardGridOrder() {
  try {
    return normalizeDashboardGridOrder(JSON.parse(localStorage.getItem(DASHBOARD_GRID_ORDER_KEY) || '[]'));
  } catch (_) {
    return [];
  }
}

function writeDashboardGridOrder() {
  if (!Array.isArray(imageList) || !imageList.length) return;
  try {
    localStorage.setItem(DASHBOARD_GRID_ORDER_KEY, JSON.stringify(imageList.map((item) => item.filename).filter(Boolean)));
  } catch (_) {}
}

function applyStoredDashboardGridOrder(list) {
  if (!Array.isArray(list) || !list.length) return [];
  const storedOrder = readDashboardGridOrder();
  if (!storedOrder.length) return list.slice();
  const orderIndex = new Map(storedOrder.map((filename, index) => [filename, index]));
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aOrder = orderIndex.has(a.item.filename) ? orderIndex.get(a.item.filename) : Number.POSITIVE_INFINITY;
      const bOrder = orderIndex.has(b.item.filename) ? orderIndex.get(b.item.filename) : Number.POSITIVE_INFINITY;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

function moveDashboardGridItem(filename, targetFilename, position = 'before') {
  if (!filename || !targetFilename || filename === targetFilename) return false;
  const fromIndex = imageList.findIndex((item) => item.filename === filename);
  const targetIndex = imageList.findIndex((item) => item.filename === targetFilename);
  if (fromIndex < 0 || targetIndex < 0) return false;
  const [item] = imageList.splice(fromIndex, 1);
  let insertIndex = imageList.findIndex((entry) => entry.filename === targetFilename);
  if (insertIndex < 0) {
    imageList.splice(fromIndex, 0, item);
    return false;
  }
  if (position === 'after') insertIndex += 1;
  imageList.splice(insertIndex, 0, item);
  writeDashboardGridOrder();
  return true;
}

function getVisibleGridCardEntries() {
  return Array.from(cardByFilename.values()).filter((card) => {
    const container = card?.container;
    if (!container?.isConnected || container.style.display === 'none' || container.offsetParent === null) return false;
    const chartContainer = container.querySelector('.chart-container');
    return !!chartContainer;
  });
}

function getGridCardEntryFilename(card) {
  return card?.img?.dataset?.filename || card?.container?.querySelector?.('.chart-container[data-filename]')?.dataset?.filename || '';
}

function getLayoutSortedGridCardEntries() {
  return getVisibleGridCardEntries()
    .map((card) => ({ card, rect: getGridCardLayoutRect(card.container) }))
    .filter((entry) => entry.rect)
    .sort((a, b) => {
      if (Math.abs(a.rect.top - b.rect.top) > 8) return a.rect.top - b.rect.top;
      return a.rect.left - b.rect.left;
    });
}

function captureVisibleGridCardRects() {
  const rects = new Map();
  getVisibleGridCardEntries().forEach((card) => {
    const filename = getGridCardEntryFilename(card);
    if (!filename) return;
    rects.set(filename, card.container.getBoundingClientRect());
  });
  return rects;
}

function getGridCardLayoutRect(container) {
  if (!container) return null;
  const previousTransition = container.style.transition;
  const previousTransform = container.style.transform;
  container.style.transition = 'none';
  container.style.transform = '';
  const rect = container.getBoundingClientRect();
  container.style.transition = previousTransition;
  container.style.transform = previousTransform;
  return rect;
}

function animateGridReorderFromRects(previousRects) {
  if (!previousRects || !previousRects.size) return;
  getVisibleGridCardEntries().forEach((card) => {
    const container = card.container;
    const filename = card?.img?.dataset?.filename || container.querySelector?.('.chart-container')?.dataset?.filename || '';
    if (!filename || gridReorderDragState?.filename === filename) return;
    const previous = previousRects.get(filename);
    if (!previous) return;
    const next = container.getBoundingClientRect();
    const dx = previous.left - next.left;
    const dy = previous.top - next.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    container.style.transition = 'none';
    container.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    requestAnimationFrame(() => {
      container.style.transition = 'transform 190ms cubic-bezier(0.2, 0, 0, 1)';
      container.style.transform = '';
      window.setTimeout(() => {
        if (container.classList.contains('grid-card-dragging')) return;
        container.style.transition = '';
        container.style.transform = '';
      }, 220);
    });
  });
}

function applyGridDomOrder() {
  if (!imageGrid || !Array.isArray(imageList)) return;
  imageList.forEach((item, index) => {
    const card = cardByFilename.get(_cardKey(item.filename));
    if (card?.container) card.container.style.order = String(index);
  });
}

function setGridReorderMode(active) {
  const isActive = !!active;
  if (gridReorderMode === isActive) return;
  gridReorderMode = isActive;
  document.body.classList.toggle('grid-reorder-mode', isActive);
  imageGrid?.classList?.toggle('is-reordering', isActive);
  getVisibleGridCardEntries().forEach((card) => {
    card.container.classList.toggle('grid-card-jiggle', isActive);
  });
  if (!isActive) {
    endGridReorderDrag();
    gridReorderPressState = null;
  }
}

function updateGridReorderDragTransform(event) {
  const state = gridReorderDragState;
  if (!state?.container) return;
  const layoutRect = getGridCardLayoutRect(state.container);
  if (!layoutRect) return;
  state.visualLeft = event.clientX - state.offsetX;
  state.visualTop = event.clientY - state.offsetY;
  state.visualCenterX = state.visualLeft + state.width / 2;
  state.visualCenterY = state.visualTop + state.height / 2;
  const x = state.visualLeft - layoutRect.left;
  const y = state.visualTop - layoutRect.top;
  state.container.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
}

function findGridReorderTarget(event) {
  const state = gridReorderDragState;
  if (!state) return null;
  const centerX = Number.isFinite(state.visualCenterX) ? state.visualCenterX : event.clientX;
  const centerY = Number.isFinite(state.visualCenterY) ? state.visualCenterY : event.clientY;
  const layoutEntries = getLayoutSortedGridCardEntries();
  for (const { card, rect } of layoutEntries) {
    const filename = getGridCardEntryFilename(card);
    if (!filename || filename === state.filename) continue;
    const isInside = centerX >= rect.left && centerX <= rect.right && centerY >= rect.top && centerY <= rect.bottom;
    if (!isInside) continue;
    const horizontal = rect.width >= rect.height
      ? Math.abs(centerX - (rect.left + rect.width / 2)) >= Math.abs(centerY - (rect.top + rect.height / 2))
      : Math.abs(centerX - (rect.left + rect.width / 2)) > Math.abs(centerY - (rect.top + rect.height / 2));
    const after = horizontal
      ? centerX > rect.left + rect.width / 2
      : centerY > rect.top + rect.height / 2;
    return { filename, position: after ? 'after' : 'before' };
  }
  const trailingEntries = layoutEntries.filter(({ card }) => getGridCardEntryFilename(card) !== state.filename);
  const lastEntry = trailingEntries[trailingEntries.length - 1];
  if (lastEntry) {
    const rect = lastEntry.rect;
    const inBottomRightTrailingZone = centerX >= rect.left + rect.width / 2 && centerY >= rect.top + rect.height / 2;
    if (inBottomRightTrailingZone) {
      return { filename: getGridCardEntryFilename(lastEntry.card), position: 'after' };
    }
  }
  return null;
}

function updateGridReorderTarget(event) {
  const target = findGridReorderTarget(event);
  if (!target || target.filename === gridReorderDragState?.lastTargetFilename && target.position === gridReorderDragState?.lastTargetPosition) return;
  const previousRects = captureVisibleGridCardRects();
  if (!moveDashboardGridItem(gridReorderDragState.filename, target.filename, target.position)) return;
  gridReorderDragState.lastTargetFilename = target.filename;
  gridReorderDragState.lastTargetPosition = target.position;
  applyGridDomOrder();
  filterImages({ preserveReorderDrag: true, skipPreviewRefresh: true });
  animateGridReorderFromRects(previousRects);
  updateGridReorderDragTransform(event);
}

function beginGridReorderDrag(chartContainer, event) {
  const filename = String(chartContainer?.dataset?.filename || '').trim();
  const card = cardByFilename.get(_cardKey(filename));
  if (!filename || !card?.container) return;
  setGridReorderMode(true);
  const rect = card.container.getBoundingClientRect();
  gridReorderDragState = {
    pointerId: event.pointerId,
    filename,
    container: card.container,
    pointerType: event.pointerType || '',
    width: rect.width,
    height: rect.height,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    visualLeft: rect.left,
    visualTop: rect.top,
    visualCenterX: rect.left + rect.width / 2,
    visualCenterY: rect.top + rect.height / 2,
    lastTargetFilename: '',
    lastTargetPosition: '',
  };
  card.container.classList.add('grid-card-dragging');
  try {
    chartContainer.setPointerCapture?.(event.pointerId);
  } catch (_) {}
  updateGridReorderDragTransform(event);
}

function endGridReorderDrag() {
  if (!gridReorderDragState) return;
  const container = gridReorderDragState.container;
  container?.classList?.remove('grid-card-dragging');
  if (container) {
    container.style.transition = 'transform 160ms cubic-bezier(0.2, 0, 0, 1)';
    container.style.transform = '';
    window.setTimeout(() => {
      if (!container.classList.contains('grid-card-dragging')) {
        container.style.transition = '';
        container.style.transform = '';
      }
    }, 180);
  }
  gridReorderDragState = null;
  gridReorderSuppressClickUntil = Date.now() + 350;
  filterImages();
}

function cancelGridReorderLongPress() {
  if (gridReorderLongPressTimer) {
    window.clearTimeout(gridReorderLongPressTimer);
    gridReorderLongPressTimer = null;
  }
  gridReorderPressState = null;
}

function bindGridReorderInteractions(chartContainer) {
  if (!chartContainer || chartContainer.dataset.reorderBound === '1') return;
  chartContainer.dataset.reorderBound = '1';
  chartContainer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || modal?.style?.display === 'flex') return;
    if (event.target?.closest?.('.favorite-star, a, button, input, select, textarea')) return;
    const filename = String(chartContainer.dataset.filename || '').trim();
    if (!filename) return;
    gridReorderPressState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      chartContainer,
    };
    if (gridReorderMode) {
      event.preventDefault();
      beginGridReorderDrag(chartContainer, event);
      return;
    }
    gridReorderLongPressTimer = window.setTimeout(() => {
      gridReorderLongPressTimer = null;
      if (!gridReorderPressState || gridReorderPressState.pointerId !== event.pointerId) return;
      beginGridReorderDrag(chartContainer, event);
    }, 520);
  });
  chartContainer.addEventListener('pointermove', (event) => {
    if (!gridReorderPressState || gridReorderPressState.pointerId !== event.pointerId) return;
    const dx = event.clientX - gridReorderPressState.startX;
    const dy = event.clientY - gridReorderPressState.startY;
    if (Math.hypot(dx, dy) > 10) cancelGridReorderLongPress();
  });
  chartContainer.addEventListener('pointerup', (event) => {
    if (gridReorderDragState?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      endGridReorderDrag();
      return;
    }
    cancelGridReorderLongPress();
  });
  chartContainer.addEventListener('pointercancel', () => {
    cancelGridReorderLongPress();
    endGridReorderDrag();
  });
  chartContainer.addEventListener('lostpointercapture', () => {
    cancelGridReorderLongPress();
  });
  chartContainer.addEventListener('click', (event) => {
    if (!gridReorderMode && Date.now() >= gridReorderSuppressClickUntil) return;
    if (gridReorderMode && event.target?.closest?.('.favorite-star')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }, true);
  chartContainer.addEventListener('contextmenu', (event) => {
    if (!gridReorderMode && !gridReorderPressState) return;
    event.preventDefault();
  });
}

document.addEventListener('pointermove', (event) => {
  if (gridReorderDragState?.pointerId !== event.pointerId) return;
  event.preventDefault();
  updateGridReorderDragTransform(event);
  updateGridReorderTarget(event);
}, true);

document.addEventListener('pointerup', (event) => {
  if (gridReorderDragState?.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  endGridReorderDrag();
}, true);

document.addEventListener('pointercancel', (event) => {
  if (gridReorderDragState?.pointerId !== event.pointerId) return;
  cancelGridReorderLongPress();
  endGridReorderDrag();
}, true);

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

function loadDashboardPreviewFrame(card) {
  const preview = card?.preview;
  const iframe = preview?.iframe;
  if (!preview || !iframe || preview.loaded || preview.loading) return false;
  const container = card?.container;
  if (!container?.isConnected || container.style.display === 'none' || container.offsetParent === null) return false;
  const src = iframe.dataset.src || preview.src || '';
  if (!src) return false;
  preview.loading = true;
  preview.loaded = true;
  iframe.src = src;
  return true;
}

function getVisibleDashboardPreviewCards() {
  if (!Array.isArray(visibleImages) || !visibleImages.length) return [];
  return visibleImages
    .map((item) => cardByFilename.get(_cardKey(item.filename)))
    .filter((card) => {
      const container = card?.container;
      return !!(
        card?.preview?.iframe
        && container?.isConnected
        && container.style.display !== 'none'
        && container.offsetParent !== null
      );
    });
}

function getDashboardPreviewInitialBatchSize() {
  const width = Number(window.innerWidth || document.documentElement?.clientWidth || 0);
  if (width && width <= 760) return 2;
  if (width && width <= 1200) return 4;
  return 5;
}

function isDashboardPreviewCardInViewport(card) {
  const container = card?.container;
  if (!container?.isConnected) return false;
  const rect = container.getBoundingClientRect();
  const viewportHeight = Number(window.innerHeight || document.documentElement?.clientHeight || 0);
  const viewportWidth = Number(window.innerWidth || document.documentElement?.clientWidth || 0);
  if (!viewportHeight || !viewportWidth) return false;
  return rect.bottom >= 0 && rect.top <= viewportHeight && rect.right >= 0 && rect.left <= viewportWidth;
}

function scheduleDashboardPreviewIdleLoads(cards, startIndex = 0) {
  if (!cards.length) return;
  if (dashboardPreviewIdleLoadHandle) {
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(dashboardPreviewIdleLoadHandle);
    else window.clearTimeout(dashboardPreviewIdleLoadHandle);
    dashboardPreviewIdleLoadHandle = null;
  }
  const run = () => {
    dashboardPreviewIdleLoadHandle = null;
    cards.forEach((card, index) => {
      window.setTimeout(() => loadDashboardPreviewFrame(card), (startIndex + index) * DASHBOARD_PREVIEW_LOAD_STAGGER_MS);
    });
  };
  if (typeof requestIdleCallback === 'function') {
    dashboardPreviewIdleLoadHandle = requestIdleCallback(run, { timeout: 2500 });
  } else {
    dashboardPreviewIdleLoadHandle = window.setTimeout(run, 900);
  }
}

function scheduleDashboardPreviewLoading() {
  if (dashboardPreviewLoadPassQueued) return;
  dashboardPreviewLoadPassQueued = true;
  requestAnimationFrame(() => {
    dashboardPreviewLoadPassQueued = false;
    const cards = getVisibleDashboardPreviewCards();
    if (!cards.length) return;

    const immediateLimit = getDashboardPreviewInitialBatchSize();
    const immediateCards = cards.slice(0, immediateLimit);
    immediateCards.forEach((card, index) => {
      window.setTimeout(() => loadDashboardPreviewFrame(card), index * DASHBOARD_PREVIEW_LOAD_STAGGER_MS);
    });

    const deferredCards = cards.slice(immediateLimit).filter((card) => !card.preview?.loaded);
    if (!deferredCards.length) return;

    const hasIntersectionObserver = 'IntersectionObserver' in window;
    const onscreenDeferredCards = deferredCards.filter(isDashboardPreviewCardInViewport);
    const offscreenDeferredCards = deferredCards.filter((card) => !isDashboardPreviewCardInViewport(card));
    if (hasIntersectionObserver && offscreenDeferredCards.length) {
      if (!dashboardPreviewLoadObserver) {
        dashboardPreviewLoadObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            dashboardPreviewLoadObserver.unobserve(entry.target);
            const filename = entry.target?.dataset?.filename || '';
            const card = filename ? cardByFilename.get(_cardKey(filename)) : null;
            loadDashboardPreviewFrame(card);
          });
        }, { root: null, rootMargin: DASHBOARD_PREVIEW_ROOT_MARGIN, threshold: 0.01 });
      }
      offscreenDeferredCards.forEach((card) => {
        const target = card?.container?.querySelector?.('.chart-container') || card?.container;
        if (!target || card.preview?.loaded) return;
        dashboardPreviewLoadObserver.observe(target);
      });
    }

    scheduleDashboardPreviewIdleLoads(
      hasIntersectionObserver ? onscreenDeferredCards : deferredCards,
      immediateCards.length
    );
  });
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

document.addEventListener('click', (event) => {
  if (!gridReorderMode) return;
  if (Date.now() < gridReorderSuppressClickUntil) return;
  if (event.target?.closest?.('#image-grid .chart-container')) return;
  setGridReorderMode(false);
}, true);

document.addEventListener('keydown', (event) => {
  if (!gridReorderMode || event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  setGridReorderMode(false);
}, true);

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
      if (gridReorderMode || Date.now() < gridReorderSuppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        return;
      }
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
        if (typeof persistModalNavigationSnapshot === 'function') {
          persistModalNavigationSnapshot(undefined, filename);
        }
        window.location.href = routeUrl;
        return;
      }
      openModalByFilename(filename);
    };

    chartContainer.dataset.filename = filename;
    chartContainer.tabIndex = 0;
    bindGridReorderInteractions(chartContainer);
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
      iframe.dataset.src = getDashboardPreviewUrl(previewSpec.url);
      iframe.dataset.baseSrc = previewSpec.url;
      iframe.dataset.filename = filename;
      iframe.loading = 'lazy';
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
          src: iframe.dataset.src,
          width: previewSpec.width,
          height: previewSpec.height,
          loading: false,
          loaded: false,
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
function filterImages(options = {}){
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
  applyGridDomOrder();
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
    card.container.classList.remove('grid-card-jiggle', 'grid-card-dragging');
    card.container.style.transform = '';
    card.container.style.transition = '';
  }
  if (gridReorderMode) {
    getVisibleGridCardEntries().forEach((card) => {
      card.container.classList.toggle('grid-card-jiggle', true);
    });
  }
  if (!options.skipPreviewRefresh) {
    updateLayoutBasedOnWidth();
    updateAllDashboardPreviewScales();
    initLazyImages();
    scheduleDashboardPreviewLoading();
  }

  // If a modal close triggered a return to homepage, restore focus to that card.
  try {
    const pendingFilename = String(sessionStorage.getItem(GRID_FOCUS_RESTORE_KEY) || '').trim();
    if (pendingFilename) {
      const card = cardByFilename.get(_cardKey(pendingFilename));
      const target = card?.container?.querySelector?.('.chart-container');
      if (target && typeof target.focus === 'function' && target.offsetParent !== null) {
        lastOpenedFilename = pendingFilename;
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
