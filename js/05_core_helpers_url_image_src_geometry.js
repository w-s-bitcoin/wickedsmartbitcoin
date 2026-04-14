/* ===========================
 * CORE HELPERS (url + image src + geometry)
 * =========================== */
const THANKS_ALL_IMG_URLS = [...BUY_BEER_IMG_URLS, ...BUY_COFFEE_IMG_URLS, ...BUY_DONATION_QR_URLS];
function preloadImages(urls, { useLinkPreload = true } = {}) {
    const uniq = [...new Set(urls)].filter(Boolean);
    if (!uniq.length) return;

    if (useLinkPreload) {
        const head = document.head || document.getElementsByTagName('head')[0];
        uniq.forEach((href) => {
            if (!head) return;
            if (document.querySelector(`link[rel="preload"][as="image"][href="${href}"]`)) return;
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'image';
            link.href = href;
            head.appendChild(link);
        });
    }

    uniq.forEach((href) => {
        const img = new Image();
        img.decoding = 'async';
        img.src = href;
    });
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
        const starKey = newFilename;
    card.star.setAttribute("data-filename", starKey);
    const favOn = isFavorite(starKey);
    card.star.textContent = favOn ? "★" : "☆";
    card.star.classList.toggle("filled", favOn);
  }
}

function getMetaForFilename(fname){
  const list = Array.isArray(rawImageList) ? rawImageList : (Array.isArray(imageList) ? imageList : []);
  return list.find(x => String(x.filename).toLowerCase() === String(fname).toLowerCase()) || null;
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
    if (nostrLink) {
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

function isStandaloneModalShell() {
    const markedStandalone = document.body?.dataset?.standaloneModalShell === '1';
    if (!markedStandalone) return false;
    const path = String(window.location.pathname || '').toLowerCase();
    return /(?:^|\/)view\.html$/.test(path);
}

function getVisualizationSlug(filename) {
    return String(filename || '').replace(/\.png$/i, '').trim();
}

function getVisualizationUrl(filename) {
    const slug = getVisualizationSlug(filename);
    const base = getPageBasePath();
    if (!slug) return `${base || ''}/`.replace(/\/{2,}/g, '/');
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '::1') {
        const localStandaloneBySlug = {
            quantum_exposure: 'quantum_exposure.html',
            dca_cost_basis: 'dca_cost_basis.html',
            bip110_signaling: 'bip110_signaling.html',
            node_count: 'node_count.html',
            bitcoin_dominance: 'bitcoin_dominance.html',
        };
        const localStandalone = localStandaloneBySlug[slug];
        if (localStandalone) {
            return `${base}/${localStandalone}`.replace(/\/{2,}/g, '/');
        }
        return `${base}/view.html#${encodeURIComponent(slug)}`.replace(/\/{2,}/g, '/');
    }
    return `${base}/${slug}`.replace(/\/{2,}/g, '/');
}

function isDonateRouteActive() {
    if (isStandaloneModalShell()) return false;
    const hash = String(window.location.hash || '').replace(/^#/, '').split('?')[0].trim().toLowerCase();
    if (hash === DONATE_ROUTE) return true;
    const base = getPageBasePath();
    let rel = window.location.pathname;
    if (base && rel.startsWith(base)) rel = rel.slice(base.length);
    rel = rel.replace(/^\/+|\/+$/g, '').toLowerCase();
    return rel === DONATE_ROUTE;
}

function setDonateRouteUrl(active, { push = false } = {}) {
    if (isStandaloneModalShell()) return;
    const base = getPageBasePath();
    const method = push ? 'pushState' : 'replaceState';
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '::1') {
        const nextUrl = active ? `${base}/#${DONATE_ROUTE}` : (base || '/');
        history[method](null, '', nextUrl.replace(/\/{2,}/g, '/'));
        return;
    }
    const nextUrl = active ? `${base}/${DONATE_ROUTE}` : (base || '/');
    history[method](null, '', nextUrl.replace(/\/{2,}/g, '/'));
}

function replaceUrlForFilename(filename) {
    const nextUrl = getVisualizationUrl(filename);
    if (!nextUrl) return;
    if (isStandaloneModalShell() && location.hostname === 'localhost') {
        const slug = getVisualizationSlug(filename);
        history.replaceState(null, '', `${getPageBasePath()}/view.html#${encodeURIComponent(slug)}`.replace(/\/{2,}/g, '/'));
        return;
    }
    history.replaceState(null, '', nextUrl);
}

function syncDonateOverlayToRoute() {
    if (isStandaloneModalShell()) return;
    if (isDonateRouteActive()) {
        if (!isBuyMeVisible) showThanksPopup({ fromRoute: true });
        return;
    }
    if (isBuyMeVisible) hideThanksPopup({ fromRoute: true });
}

function imgSrc(filename){
  const base = getPageBasePath();
    return `${base}/assets/${filename}`;
}

function modalEmbedSrc(pathOrUrl){
    const raw = String(pathOrUrl || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const base = getPageBasePath();
        const resolved = raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw.replace(/^\/+/, '')}`;

        // Preserve shell query params when embedding dashboard routes from shell URLs.
        // Supports both `?state=...#slug` and `#slug?state=...` forms.
        const shellParams = new URLSearchParams(window.location.search || '');
        const hash = String(window.location.hash || '').replace(/^#/, '');
        const hashQueryIndex = hash.indexOf('?');
        if (hashQueryIndex >= 0) {
            const hashSearch = hash.slice(hashQueryIndex + 1);
            const hashParams = new URLSearchParams(hashSearch);
            hashParams.forEach((value, key) => {
                if (!shellParams.has(key)) {
                    shellParams.set(key, value);
                }
            });
        }
        if (!shellParams.toString()) return resolved;

        try {
                const url = new URL(resolved, window.location.origin);
                const isDashboardPath = /\/webapps\/[^/]+\/dashboard\.html$/i.test(url.pathname);
                if (!isDashboardPath) return resolved;

                shellParams.forEach((value, key) => {
                        if (!url.searchParams.has(key)) {
                                url.searchParams.set(key, value);
                        }
                });
                return `${url.pathname}${url.search}${url.hash}`;
        } catch (_error) {
                return resolved;
        }
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