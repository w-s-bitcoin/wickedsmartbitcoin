/* ===========================
 * CORE HELPERS (url + image src + geometry)
 * =========================== */
const THANKS_ALL_IMG_URLS = [...BUY_BEER_IMG_URLS, ...BUY_COFFEE_IMG_URLS];
function preloadImages(urls, { useLinkPreload = true } = {}) {
  const uniq = [...new Set(urls)].filter(Boolean);
  if (useLinkPreload) {
    const head = document.head || document.getElementsByTagName('head')[0];
    uniq.forEach((href) => {
      if (document.querySelector(`link[rel="preload"][as="image"][href="${href}"]`)) return;
      const l = document.createElement('link');
      l.rel = 'preload';
      l.as = 'image';
      l.href = href;
      head.appendChild(l);
    });
  }
  const loaders = uniq.map((url) => new Promise(resolve => {
    const img = new Image();
    img.onload = img.onerror = () => resolve(url);
    img.src = url;
  }));
  try { uniq.forEach((url) => fetch(url, { cache: "force-cache" })); } catch {}
  return Promise.all(loaders);
}
function preloadAllThanksImagesOnce() {
  if (preloadAllThanksImagesOnce._did) return;
  preloadAllThanksImagesOnce._did = true;
  const run = () => preloadImages(THANKS_ALL_IMG_URLS, { useLinkPreload: true });
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 1500 });
  else setTimeout(run, 0);
}
function getThanksPreloadUrls() {
  return isBeerTime() ? BUY_BEER_IMG_URLS : BUY_COFFEE_IMG_URLS;
}
function preloadThanksImagesIfNeeded(force = false) {
  const mode = isBeerTime() ? 'beer' : 'coffee';
  if (!force && lastThanksPreloadMode === mode) return;
  lastThanksPreloadMode = mode;
  preloadImages(getThanksPreloadUrls());
}
function replaceUrlForFilename(newFilename) {
  const slug = String(newFilename || "").replace(/\.png$/i, "");
    if (isStandaloneModalShell()) {
        const base = getPageBasePath();
        if (location.hostname !== 'localhost') {
            history.replaceState(null, '', `${base}/${slug}`.replace(/\/{2,}/g, '/'));
        } else {
            const currentPage = (location.pathname.split('/').pop() || 'view.html').split('?')[0];
            history.replaceState(null, '', `${base}/${currentPage}?image=${encodeURIComponent(slug)}`.replace(/\/{2,}/g, '/'));
        }
        return;
    }
  if (location.hostname === "localhost") {
    location.hash = slug;
    return;
  }

  // Always preserve repo subpath like "/animations"
  const base = getPageBasePath(); // '' on custom domain root, '/animations' on GH pages
  const next = `${base}/${slug}`.replace(/\/{2,}/g, "/");
  history.replaceState(null, "", next);
}

function isStandaloneModalShell() {
    return document.body?.dataset?.standaloneModalShell === '1';
}

function getVisualizationUrl(filename) {
    const slug = String(filename || '').replace(/\.png$/i, '');
    const base = getPageBasePath();
    if (location.hostname === 'localhost') {
        return `${base}/view.html?image=${encodeURIComponent(filename)}`.replace(/\/{2,}/g, '/');
    }
    return `${base}/${slug}`.replace(/\/{2,}/g, '/');
}

function isDonateRouteActive() {
    if (location.hostname === 'localhost') {
        return (location.hash || '').replace(/^#/, '') === DONATE_ROUTE;
    }
    const path = window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    return path === DONATE_ROUTE;
}
function setDonateRouteUrl(active, { push = true } = {}) {
  if (location.hostname === "localhost") {
    location.hash = active ? DONATE_ROUTE : "";
    return;
  }
  const base = getPageBasePath();
  const target = active ? `${base}/${DONATE_ROUTE}` : (base || "/");
  const fn = push ? "pushState" : "replaceState";
  history[fn](null, "", target.replace(/\/{2,}/g, "/"));
}

function syncDonateOverlayToRoute() {
    if (modal && modal.style.display === 'flex') return;

    if (isDonateRouteActive()) {
        if (!isBuyMeVisible) showThanksPopup({ fromRoute: true });
    } else {
        if (isBuyMeVisible) hideThanksPopup({ fromRoute: true });
    }
}
function updateGridThumbAtCurrent(filename, title){
  let img = document.querySelector(`img.grid-thumb[data-grid-index="${currentIndex}"]`);

  // Fallback: locate by filename in your card map
  if(!img && filename){
    const card = cardByFilename.get(_cardKey(filename));
    if(card && card.img) img = card.img;
  }

  if(!img) return;

  const next = imgSrc(filename);
  img.dataset.filename = filename;
  img.dataset.src = next;
  if(title !== undefined) img.alt = title || "";

  const loaded =
    img.dataset.loaded === "1" ||
    (img.getAttribute("src") && img.naturalWidth > 0);

  if(!loaded) return;

  // Avoid blanking: preload then swap
  if (img.src !== next) {
    const pre = new Image();
    pre.onload = () => {
      // only swap if this thumb is still representing this filename
      if ((img.dataset.filename || "").toLowerCase() !== String(filename || "").toLowerCase()) return;
      img.src = next;
      img.dataset.loaded = "1";
    };
    pre.onerror = () => {
      // keep the old thumb if the new one fails
      img.dataset.loaded = "0";
    };
    pre.src = next;
  }
}

function _cardKey(fname){
  return String(fname || "").toLowerCase();
}
function rekeyCard(oldFilename, newFilename){
  const oldK = _cardKey(oldFilename);
  const newK = _cardKey(newFilename);
  if (!oldK || !newK || oldK === newK) return;
  const card = cardByFilename.get(oldK);
  if (!card) return;
  cardByFilename.delete(oldK);
  cardByFilename.set(newK, card);
}

/**
 * Updates the currently-open card in the GRID (title/desc/thumb/star binding).
 * Designed primarily for the Distribution metric swap, but safe generally.
 */
function updateGridCardAtCurrent({ oldFilename, newFilename, title, description }){
  if (!newFilename) return;

  const card =
    cardByFilename.get(_cardKey(oldFilename)) ||
    cardByFilename.get(_cardKey(newFilename));

  if(!card) return;

  // Update visible UI text
  if (title !== undefined) card.titleElem.textContent = title || "";
  if (description !== undefined) card.desc.textContent = description || "";

  // Update thumb datasets
  const nextSrc = imgSrc(newFilename);
  card.img.dataset.filename = newFilename;
  card.img.dataset.src = nextSrc;
  if (title !== undefined) card.img.alt = title || "";

  // Swap src immediately only if already loaded
  const loaded =
    card.img.dataset.loaded === "1" ||
    (card.img.getAttribute("src") && card.img.naturalWidth > 0);

  if (loaded && card.img.src !== nextSrc) card.img.src = nextSrc;

  // Keep cardByFilename key consistent
  rekeyCard(oldFilename, newFilename);

  // Update favorite star binding/state
  if (card.star) {
    const starKey = newFilename.startsWith(POF_BASE) ? POF_FAV_KEY : newFilename;
    card.star.setAttribute("data-filename", starKey);

    // For POF_FAV_KEY, `isFavorite(newFilename)` might not match your grouping,
    // so we check the effective favorite key.
    const favOn = isFavorite(starKey);
    card.star.textContent = favOn ? "★" : "☆";
    card.star.classList.toggle("filled", favOn);
  }

  // Update count label (Distribution stays "2", but safe to recompute)
  if (card.countElem) {
    card.countElem.textContent = String(getCardImageCount(newFilename));
    card.countElem.setAttribute('aria-label', `Images in this set: ${card.countElem.textContent}`);
  }
}
function showAnchorControls(show) {
  anchorControls?.classList.toggle('show', !!show);
}
function showYearControls(show) {
    yearControls?.classList.toggle('show', !!show);
}

function showScaleControls(show) {
    scaleControls?.classList.toggle('show', !!show);
}
function showHashControls(show) {
    hashControls?.classList.toggle('show', !!show);
}
function showPriceOfControls(show) {
    const on = !!show;
    priceOfControls?.classList.toggle('show', on);
    pofSortControls?.classList.toggle('show', on);
}
function showUoaControls(show) {
    const on = !!show;
    if (uoaControls) uoaControls.classList.toggle('show', on);
    if (sortControls) sortControls.classList.toggle('show', on);
    if (uoaShowControls) uoaShowControls.classList.toggle('show', on);
}
function showDominanceControls(show) {
    dominanceControls?.classList.toggle('show', !!show);
}

function showMyrControls(show) {
    myrControls?.classList.toggle('show', !!show);
}
function showHalvingViewControls(show) {
    halvingViewControls?.classList.toggle('show', !!show);
}
function showBtcmapsControls(show) {
    const on = !!show;
    btcmapsControls?.classList.toggle('show', on);
    viewControls?.classList.toggle('show', on);
}

function showMetricControls(show) {
    metricControls?.classList.toggle('show', !!show);
}

function isCycleAnchorFile(filename) {
  return filename === CYCLE_LOW_FILE || filename === CYCLE_HIGH_FILE;
}
function cycleAnchorFromFilename(filename) {
  if (filename === CYCLE_LOW_FILE) return 'low';
  if (filename === CYCLE_HIGH_FILE) return 'high';
  return null;
}
function cycleFilenameForAnchor(anchor) {
  return anchor === 'high' ? CYCLE_HIGH_FILE : CYCLE_LOW_FILE;
}
function getStoredCycleAnchor() {
  const v = (localStorage.getItem(CYCLE_ANCHOR_STORAGE_KEY) || '').toLowerCase();
  return v === 'low' ? 'low' : 'high';
}
function setStoredCycleAnchor(anchor) {
  const v = anchor === 'high' ? 'high' : 'low';
  localStorage.setItem(CYCLE_ANCHOR_STORAGE_KEY, v);
  return v;
}

function setCycleAnchor(anchor, { title = '' } = {}) {
  const norm = setStoredCycleAnchor(anchor);
  const nextFilename = cycleFilenameForAnchor(norm);

  const cur = visibleImages?.[currentIndex];
  const oldFilename = (cur && isCycleAnchorFile(cur.filename)) ? cur.filename : null;

  // Pull canonical metadata for the selected file
  const meta = getMetaForFilename(nextFilename);

  // Update current visible item (so arrows + state stay consistent)
  if (cur && isCycleAnchorFile(cur.filename)) {
    cur.filename = nextFilename;
    if (meta) {
      cur.title = meta.title || cur.title;
      cur.description = meta.description || cur.description;
      cur.latest_x = meta.latest_x || "";
      cur.latest_nostr = meta.latest_nostr || "";
      cur.latest_youtube = meta.latest_youtube || "";
    }
    lastOpenedFilename = nextFilename;
  }

  // Update modal
  setModalLinks({
    x: meta?.latest_x || cur?.latest_x || '',
    nostr: meta?.latest_nostr || cur?.latest_nostr || '',
    youtube: meta?.latest_youtube || cur?.latest_youtube || ''
  });
  setModalImageAndCenter(nextFilename, title || (meta?.title || cur?.title || ''));
  replaceUrlForFilename(nextFilename);

  // Update grid card immediately (title/desc/thumb/star/count)
  if (oldFilename) {
    updateGridCardAtCurrent({
      oldFilename,
      newFilename: nextFilename,
      title: meta?.title || cur?.title || "",
      description: meta?.description || cur?.description || ""
    });
  }
}

function cycleCycleAnchor(direction /* 'up' | 'down' */) {
  const cur = getStoredCycleAnchor();
  const idx = Math.max(0, CYCLE_ANCHORS.indexOf(cur));
  const delta = direction === 'up' ? -1 : 1;
  const next = CYCLE_ANCHORS[(idx + delta + CYCLE_ANCHORS.length) % CYCLE_ANCHORS.length];
  setCycleAnchor(next, { title: visibleImages?.[currentIndex]?.title || '' });
  if (anchorSelect) anchorSelect.value = next;
}

/* ===========================
 * Metric dropdown helpers
 * =========================== */
function isDistFile(filename) {
    return filename === DIST_PRICE_FILE || filename === DIST_MCAP_FILE;
}
function distMetricFromFilename(filename) {
    if (filename === DIST_MCAP_FILE) return 'mcap';
    if (filename === DIST_PRICE_FILE) return 'price';
    return null;
}
function distFilenameForMetric(metric) {
    return metric === 'mcap' ? DIST_MCAP_FILE : DIST_PRICE_FILE;
}
function getStoredDistMetric() {
    const v = (localStorage.getItem(DIST_STORAGE_KEY) || '').toLowerCase();
    return v === 'mcap' ? 'mcap' : 'price';
}
function setStoredDistMetric(metric) {
    const v = metric === 'mcap' ? 'mcap' : 'price';
    localStorage.setItem(DIST_STORAGE_KEY, v);
    return v;
}
function setDistMetric(metric, { title = '' } = {}) {
    const norm = setStoredDistMetric(metric);
    const nextFilename = distFilenameForMetric(norm);

    const cur = visibleImages?.[currentIndex];
    const oldFilename = (cur && isDistFile(cur.filename)) ? cur.filename : null;

    // Pull canonical title/desc/links from the underlying file entry
    const meta = getMetaForFilename(nextFilename);

    if (cur && isDistFile(cur.filename)) {
        cur.filename = nextFilename;
        if (meta) {
            cur.title = meta.title || cur.title;
            cur.description = meta.description || cur.description;
            cur.latest_x = meta.latest_x || "";
            cur.latest_nostr = meta.latest_nostr || "";
            cur.latest_youtube = meta.latest_youtube || "";
        }
        lastOpenedFilename = nextFilename;
    }

    // Update modal
    setModalImageAndCenter(nextFilename, title || (meta?.title || cur?.title || ''));
    replaceUrlForFilename(nextFilename);

    // Update grid card title/desc/thumb immediately
    if (oldFilename) {
        updateGridCardAtCurrent({
            oldFilename,
            newFilename: nextFilename,
            title: meta?.title || cur?.title || "",
            description: meta?.description || cur?.description || ""
        });
    }
}
function getMetaForFilename(fname){
  const list = Array.isArray(rawImageList) ? rawImageList : (Array.isArray(imageList) ? imageList : []);
  return list.find(x => String(x.filename).toLowerCase() === String(fname).toLowerCase()) || null;
}

function cycleDistMetric(direction /* 'up' | 'down' */) {
    const cur = getStoredDistMetric();
    const idx = Math.max(0, DIST_METRICS.indexOf(cur));
    const delta = direction === 'up' ? -1 : 1;
    const next = DIST_METRICS[(idx + delta + DIST_METRICS.length) % DIST_METRICS.length];
    setDistMetric(next, { title: visibleImages?.[currentIndex]?.title || '' });
    if (metricSelect) metricSelect.value = next;
}
// Store current YouTube video ID for the modal
let currentYoutubeVideoId = '';

function extractYoutubeVideoId(url) {
    if (!url) return '';
    // Handle youtu.be/VIDEO_ID format
    const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (shortMatch) return shortMatch[1];
    // Handle youtube.com/watch?v=VIDEO_ID format
    const longMatch = url.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/);
    if (longMatch) return longMatch[1];
    return '';
}

function openYoutubeOverlay() {
    if (!currentYoutubeVideoId) return;
    const overlay = document.getElementById('youtube-overlay');
    const iframe = document.getElementById('youtube-iframe');
    if (overlay && iframe) {
        iframe.src = `https://www.youtube.com/embed/${currentYoutubeVideoId}?autoplay=1`;
        overlay.classList.remove('hidden');
        overlay.focus();
    }
}

function closeYoutubeOverlay() {
    const overlay = document.getElementById('youtube-overlay');
    const iframe = document.getElementById('youtube-iframe');
    if (overlay && iframe) {
        overlay.classList.add('hidden');
        iframe.src = '';
    }
}

function setModalLinks({x = '', nostr = '', youtube = ''} = {}) {
    const xLink = document.getElementById('x-link');
    const nostrLink = document.getElementById('nostr-link');
    const ytLink = document.getElementById('youtube-link');
    if (x) {
        xLink.href = x;
        xLink.classList.remove('disabled');
        xLink.removeAttribute('aria-disabled');
        xLink.removeAttribute('tabindex');
    } else {
        xLink.href = '#';
        xLink.classList.add('disabled');
        xLink.setAttribute('aria-disabled', 'true');
        xLink.setAttribute('tabindex', '-1');
    }
    if (nostr) {
        nostrLink.href = nostr;
        nostrLink.classList.remove('disabled');
        nostrLink.removeAttribute('aria-disabled');
        nostrLink.removeAttribute('tabindex');
    } else {
        nostrLink.href = '#';
        nostrLink.classList.add('disabled');
        nostrLink.setAttribute('aria-disabled', 'true');
        nostrLink.setAttribute('tabindex', '-1');
    }
    if (youtube) {
        currentYoutubeVideoId = extractYoutubeVideoId(youtube);
        ytLink.classList.remove('disabled');
        ytLink.removeAttribute('aria-disabled');
        ytLink.removeAttribute('tabindex');
    } else {
        currentYoutubeVideoId = '';
        ytLink.classList.add('disabled');
        ytLink.setAttribute('aria-disabled', 'true');
        ytLink.setAttribute('tabindex', '-1');
    }
}

// Store the raw youtube URL on the link node so click handlers can use it
// even if the global `currentYoutubeVideoId` is out of sync for some reason.
try {
    if (typeof document !== 'undefined') {
        const _yt = document.getElementById('youtube-link');
        if (_yt) _yt.dataset.youtube = (typeof youtube !== 'undefined' && youtube) ? String(youtube) : '';
    }
} catch (_) {}
function openByFilenameAllowingNonFav(filename) {
    let idx = visibleImages.findIndex(img => img.filename === filename);
    if (idx !== -1) {
        openModalByIndex(idx);
        return true;
    }
    const fullIdx = imageList.findIndex(img => img.filename === filename);
    if (fullIdx !== -1) {
        visibleImages = [imageList[fullIdx], ...visibleImages];
        tempNonFavInjected = true;
        openModalByIndex(0);
        return true;
    }
    const raw = Array.isArray(rawImageList) ? rawImageList : null;
    if (raw) {
        const rawIdx = raw.findIndex(img => img.filename === filename);
        if (rawIdx !== -1) {
            visibleImages = [raw[rawIdx], ...visibleImages];
            tempNonFavInjected = true;
            openModalByIndex(0);
            return true;
        }
    }
    return false;
}
function setModalImageAndCenter(filename, altText = '') {
    const token = ++modalImgLoadToken;
    showModalSpinner();
    modalImg.style.transition = '';
    modalImg.style.opacity = '0';
    modalImg.style.visibility = 'hidden';
    modalImg.style.transform = 'translate3d(-9999px,-9999px,0) scale(1)';
    void modalImg.offsetHeight;
    modalImg.style.transition = 'opacity 0.12s ease-out';
    currentScale = 1;
    pinchFocus = null;
    modal.classList.remove('zoomed');
    modalImg.dataset.filename = filename;
    modalImg.alt = altText || '';
    const reveal = () => {
        modalImg.style.visibility = 'visible';
        requestAnimationFrame(() => {
            if (token !== modalImgLoadToken) return;
            modalImg.style.opacity = '1';
        });
    };
    const done = () => {
        if (token !== modalImgLoadToken) return;
        hideModalSpinner();
        if (currentScale <= 1.001) centerImageAtScale1();
        else {
            clampPanToBounds();
            applyTransform();
        }
        reveal();
    };
    const fail = () => {
        if (token !== modalImgLoadToken) return;
        hideModalSpinner();
        modalImg.style.visibility = 'visible';
        modalImg.style.opacity = '1';
    };
    const nextUrl = imgSrc(filename);
    if (modalImg.src && modalImg.src.endsWith(nextUrl) && modalImg.complete && modalImg.naturalWidth) {
        done();
        return;
    }
    modalImg.addEventListener('load', done, { once: true });
    modalImg.addEventListener('error', fail, { once: true });
    modalImg.src = nextUrl;
}
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}
function distance(touches) {
    const [a, b] = touches;
    const dx = b.clientX - a.clientX,
        dy = b.clientY - a.clientY;
    return Math.hypot(dx, dy);
}
function midpoint(touches) {
    const [a, b] = touches;
    return {x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2};
}
function applyTransform() {
    modalImg.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${currentScale})`;
}
function screenPointToImageLocal(clientX, clientY) {
    const rect = modalImg.getBoundingClientRect();
    const xRel = clientX - rect.left;
    const yRel = clientY - rect.top;
    const u = xRel / currentScale;
    const v = yRel / currentScale;
    return {u, v, xRel, yRel};
}
function computeBaseSizeAtScale1() {
    const vp = modal.getBoundingClientRect();
    const offset = getControlsOffset();
    const nw = modalImg.naturalWidth || 1;
    const nh = modalImg.naturalHeight || 1;
    const maxW = vp.width * 0.95;
    const availH = Math.max(0, vp.height - offset);
    const maxH = availH * 0.88;
    const fit = Math.min(maxW / nw, maxH / nh, 1);
    return {baseW: nw * fit, baseH: nh * fit, vpW: vp.width, vpH: vp.height, offset, availH};
}
function centerImageAtScale1() {
    const {baseW, baseH, vpW, vpH, offset} = computeBaseSizeAtScale1();
    currentScale = 1;
    translateX = (vpW - baseW) / 2;
    translateY = offset + (vpH - offset - baseH) / 2;
    applyTransform();
}
function resetZoomAndCenterAnimated() {
    const {baseW, baseH, vpW, vpH, offset} = computeBaseSizeAtScale1();
    currentScale = 1;
    translateX = (vpW - baseW) / 2;
    translateY = offset + (vpH - offset - baseH) / 2;
    modalImg.style.transition = 'transform 0.25s ease-out';
    applyTransform();
    modal.classList.remove('zoomed');
    pinchFocus = null;
    setTimeout(() => {
        modalImg.style.transition = '';
    }, 300);
}
function zoomToPoint(targetScale, clientX, clientY) {
    const {u, v, xRel, yRel} = screenPointToImageLocal(clientX, clientY);
    currentScale = clamp(targetScale, MIN_SCALE, MAX_SCALE);
    translateX = xRel - u * currentScale;
    translateY = yRel - v * currentScale;
    modal.classList.add('zoomed');
    clampPanToBounds();
    modalImg.style.transition = 'transform 0.2s ease-out';
    applyTransform();
    setTimeout(() => {
        modalImg.style.transition = '';
    }, 220);
}
let modalViewportRAF = null;
function handleModalViewportChange() {
    if (modal.style.display !== 'flex') return;
    updateModalSafePadding();
    if (modalViewportRAF) cancelAnimationFrame(modalViewportRAF);
    modalViewportRAF = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (currentScale <= 1.001 && !isPinching && !isPanning && !modal.classList.contains('zoomed')) {
                centerImageAtScale1();
            } else {
                clampPanToBounds();
                applyTransform();
            }
            modalViewportRAF = null;
        });
    });
}
function clampPanToBounds() {
    const {baseW, baseH, vpW, availH, offset} = computeBaseSizeAtScale1();
    const scaledW = baseW * currentScale;
    const scaledH = baseH * currentScale;
    const minTx = Math.min(0, vpW - scaledW);
    const maxTx = 0;
    if (scaledW <= vpW) {
        translateX = (vpW - scaledW) / 2;
    } else {
        translateX = Math.max(minTx, Math.min(translateX, maxTx));
    }
    const minTy = offset + Math.min(0, availH - scaledH);
    const maxTy = offset;
    if (scaledH <= availH) {
        translateY = offset + (availH - scaledH) / 2;
    } else {
        translateY = Math.max(minTy, Math.min(translateY, maxTy));
    }
}
function getControlsOffset() {
    const isSmallLandscape = window.matchMedia('(max-width: 900px) and (orientation: landscape)').matches;
    if (!isSmallLandscape) return 0;
    const v = parseFloat(getComputedStyle(modal).getPropertyValue('--controls-offset')) || 0;
    return Math.max(0, v);
}
function getContainerOrigin() {
    const r = modal.getBoundingClientRect();
    return {ox: r.left, oy: r.top};
}
function setSearchInputFocusability(active) {
    const input = document.getElementById('search-input');
    if (!input) return;
    if (active) {
        const orig = input.getAttribute('data-original-tabindex');
        if (orig !== null) {
            if (orig === '') input.removeAttribute('tabindex');
            else input.setAttribute('tabindex', orig);
        } else {
            input.removeAttribute('tabindex');
        }
        input.removeAttribute('aria-hidden');
    } else {
        if (!input.hasAttribute('data-original-tabindex')) {
            const existing = input.getAttribute('tabindex');
            input.setAttribute('data-original-tabindex', existing === null ? '' : existing);
        }
        input.setAttribute('tabindex', '-1');
        input.setAttribute('aria-hidden', 'true');
    }
}
function getPageBasePath(){
  const parts = window.location.pathname.replace(/^\/+|\/+$/g,'').split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  return `/${parts.slice(0, -1).join('/')}`;
}

function imgSrc(filename){
  const base = getPageBasePath();
  return `${base}/final_frames/${filename}`;
}

function modalEmbedSrc(pathOrUrl){
    const raw = String(pathOrUrl || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const base = getPageBasePath();
    if (raw.startsWith('/')) return `${base}${raw}`;
    return `${base}/${raw.replace(/^\/+/, '')}`;
}

// prefetch an image URL by inserting a <link rel="preload"> element; this
// gives the browser high network priority and is useful when an image is about
// to be shown in the modal (especially during route‑driven opens).
function preloadImage(url){
  if (!url) return;
  const existing = document.querySelector(`link[rel=preload][href="${url}"]`);
  if (existing) return; // already added
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = url;
  document.head.appendChild(link);
  // remove after a minute to keep DOM clean; the browser retains the fetch
  setTimeout(() => { link.remove(); }, 60 * 1000);
}
async function downloadCurrentModalImage() {
    const fname = modalImg?.dataset?.filename || visibleImages?.[currentIndex]?.filename;
    if (modalContentMode === 'embed' && fname !== 'bip110_signaling.png') {
        const src = modalEmbed?.src || '';
        if (src) window.open(src, '_blank', 'noopener');
        return;
    }
    if (!fname) return;
    const url = imgSrc(fname);
    try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objUrl);
    } catch (_) {
        const a = document.createElement('a');
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
}