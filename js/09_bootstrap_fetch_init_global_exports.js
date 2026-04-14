/* ===========================
 * BOOTSTRAP (fetch + init + global exports)
 * =========================== */

function getHomepageDashboardTimeApi() {
    return window.WSBDashboardTime || null;
}

const HOMEPAGE_TZ_STORAGE_KEY = "wicked_dashboard_timezone_v1";
const HOMEPAGE_TZ_CHANGE_EVENT = "wsb:timezonechange";
const LAST_UPDATED_PREFIX = "Last updated:";

function extractUtcStampFromLastUpdatedText(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    const withoutPrefix = raw
        .replace(/^last\s+updated(?:\s+on)?\s*:?\s*/i, "")
        .trim();
    if (!withoutPrefix) return "";

    // Already ISO with timezone suffix.
    if (/Z$|[+-]\d{2}:?\d{2}$/i.test(withoutPrefix)) {
        return withoutPrefix;
    }

    // Explicit UTC text such as:
    // - "2026-03-22 17:15 UTC"
    // - "March 22, 2026 at 17:15 UTC"
    if (/\bUTC$/i.test(withoutPrefix)) {
        const body = withoutPrefix.replace(/\s+UTC$/i, "").trim();
        const isoLikeMatch = body.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
        if (isoLikeMatch) {
            return `${isoLikeMatch[1]}T${isoLikeMatch[2]}Z`;
        }
        const parsedUtc = new Date(`${body.replace(/\s+at\s+/i, " ")} UTC`);
        if (!Number.isNaN(parsedUtc.getTime())) {
            return parsedUtc.toISOString();
        }
    }

    // Fallback: if parseable, normalize to ISO; otherwise return empty so caller can skip.
    const parsed = new Date(withoutPrefix);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
    }
    return "";
}

function formatLastUpdatedForPreferredTimeZone(utcStamp) {
    const normalizedStamp = String(utcStamp || "").trim();
    if (!normalizedStamp) return `${LAST_UPDATED_PREFIX} -`;

    const dashboardTimeApi = getHomepageDashboardTimeApi();
    const preferredTimeZone = dashboardTimeApi?.getPreferredTimeZone?.() || "UTC";
    const formatted = dashboardTimeApi?.formatUtcTimestamp
        ? dashboardTimeApi.formatUtcTimestamp(normalizedStamp, preferredTimeZone).text
        : normalizedStamp;
    return `${LAST_UPDATED_PREFIX} ${normalizeTimeZoneSuffixForFooter(formatted)}`;
}

function normalizeTimeZoneSuffixForFooter(text) {
    const value = String(text || "").trim();
    if (!value) return value;
    if (/\([^)]*\)\s*$/i.test(value)) return value;

    const match = value.match(/^(.*\s)([A-Z]{2,6}|UTC|GMT(?:[+-]\d{1,2}(?::\d{2})?)?)$/i);
    if (!match) return value;
    const prefix = String(match[1] || "").trimEnd();
    const zone = String(match[2] || "").trim();
    if (!zone) return value;
    return `${prefix} (${zone})`;
}

function renderHomepageLastUpdated(utcStamp) {
    const el = document.getElementById("last-updated");
    if (!el) return;
    el.textContent = formatLastUpdatedForPreferredTimeZone(utcStamp);
}

function rerenderHomepageLastUpdatedForTimeZoneChange() {
    if (homepageLastUpdatedStamp) {
        renderHomepageLastUpdated(homepageLastUpdatedStamp);
        return;
    }
    const el = document.getElementById("last-updated");
    if (!el) return;
    const parsedStamp = extractUtcStampFromLastUpdatedText(el.textContent || "");
    if (!parsedStamp) return;
    homepageLastUpdatedStamp = parsedStamp;
    renderHomepageLastUpdated(homepageLastUpdatedStamp);
}

function updateLastUpdatedStamp() {
    const el = document.getElementById("last-updated");
    if (!el) return Promise.resolve("");
    const url = `${getPageBasePath()}/assets/last_updated.txt?ts=${Date.now()}`;
    return fetch(url, { cache: "no-store" })
        .then((res) => {
            if (!res.ok) return "";
            return res.text();
        })
        .then((text) => {
            const t = String(text || "").trim();
            if (!t) return "";
            const utcStamp = extractUtcStampFromLastUpdatedText(t);
            if (!utcStamp) return "";
            renderHomepageLastUpdated(utcStamp);
            return utcStamp;
        })
        .catch(() => "");
}

const HOMEPAGE_AUTO_REFRESH_MS = 60000;
const HOMEPAGE_FORCE_REFRESH_MS = 3600000;
let homepageAutoRefreshTimer = null;
let homepageRefreshInFlight = false;
let homepageLastSuccessfulRefreshAt = 0;
let homepageLastUpdatedStamp = "";

function triggerHomepageRefreshSoon(delayMs = 150) {
    window.setTimeout(() => {
        refreshHomepageLastUpdatedStamp();
    }, delayMs);
}

function setupHomepageRefreshWakeEvents() {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            triggerHomepageRefreshSoon(0);
        }
    });

    window.addEventListener("focus", () => {
        triggerHomepageRefreshSoon(0);
    });

    window.addEventListener("pageshow", () => {
        triggerHomepageRefreshSoon(0);
    });

    window.addEventListener("online", () => {
        triggerHomepageRefreshSoon(0);
    });
}

function startHomepageAutoRefresh() {
    if (homepageAutoRefreshTimer) {
        clearInterval(homepageAutoRefreshTimer);
    }
    homepageAutoRefreshTimer = setInterval(() => {
        const now = Date.now();
        const shouldForceRefresh = (now - homepageLastSuccessfulRefreshAt) >= HOMEPAGE_FORCE_REFRESH_MS;
        if (shouldForceRefresh || homepageLastUpdatedStamp) {
            refreshHomepageLastUpdatedStamp();
        }
    }, HOMEPAGE_AUTO_REFRESH_MS);
}

async function refreshHomepageLastUpdatedStamp() {
    if (homepageRefreshInFlight) return;
    homepageRefreshInFlight = true;
    try {
        const latestStamp = await updateLastUpdatedStamp();
        if (latestStamp && homepageLastUpdatedStamp && latestStamp !== homepageLastUpdatedStamp) {
            window.location.reload();
            return;
        }
        if (latestStamp) {
            homepageLastUpdatedStamp = latestStamp;
        }
        homepageLastSuccessfulRefreshAt = Date.now();
    } finally {
        homepageRefreshInFlight = false;
    }
}

refreshHomepageLastUpdatedStamp();
setupHomepageRefreshWakeEvents();
startHomepageAutoRefresh();

window.addEventListener(HOMEPAGE_TZ_CHANGE_EVENT, () => {
    rerenderHomepageLastUpdatedForTimeZoneChange();
});

window.addEventListener("storage", (event) => {
    if (event.key !== HOMEPAGE_TZ_STORAGE_KEY) return;
    rerenderHomepageLastUpdatedForTimeZoneChange();
});

function syncModalToUrl() {
  if (!Array.isArray(imageList) || imageList.length === 0) return;
  const fname = getImageNameFromPath();
    const standaloneShell = isStandaloneModalShell();
  const donate = isDonateRouteActive();
    if (!standaloneShell && donate) {
    if (modal?.style?.display === 'flex') closeModal();
    syncDonateOverlayToRoute();
    return;
  }
  if (isBuyMeVisible) hideThanksPopup({ fromRoute: true });
  if (fname) {
    // if we're about to open a specific image via the URL, bump its
    // priority ahead of the grid thumbs so the modal will render as quickly
    // as possible. the preload helper adds a high‑priority request.
    try {
      preloadImage(imgSrc(fname));
    } catch (_) {}
        if (!standaloneShell) {
            try { filterImages(); } catch (_) {}
        }
    openModalByFilename(fname);
    return;
  }
  if (modal?.style?.display === 'flex') closeModal();
}
function getImageNameFromPath() {
    if (isStandaloneModalShell()) {
        const params = new URLSearchParams(window.location.search || '');
        const q = String(params.get('image') || '').trim();
        if (q) return q.endsWith('.png') ? q : `${q}.png`;
    }
  if (isDonateRouteActive()) return null;
  if (location.hash) {
    let h = location.hash.replace(/^#/, "");
        const hashQueryIndex = h.indexOf("?");
        if (hashQueryIndex >= 0) {
            h = h.slice(0, hashQueryIndex);
        }
    if (h.toLowerCase() === DONATE_ROUTE) return null;
    return h + ".png";
  }
  const base = getPageBasePath();
  let rel = window.location.pathname;
  if (base && rel.startsWith(base)) rel = rel.slice(base.length);
  rel = rel.replace(/^\/+|\/+$/g, "");
  if (!rel) return null;
    if (rel.toLowerCase().endsWith('.html')) return null;
  if (rel.toLowerCase() === DONATE_ROUTE) return null;
  return rel + ".png";
}
const IMAGE_LIST_URL = `${getPageBasePath()}/assets/image_list.json`;
fetch(IMAGE_LIST_URL)
    .then(res => res.json())
    .then(data => {
        const dashboardFilenames = new Set([
            'quantum_exposure.png',
            'dca_cost_basis.png',
            'bip110_signaling.png',
            'node_count.png',
            'bitcoin_dominance.png'
        ]);
        imageList = Array.isArray(data)
            ? data
                .filter((item) => dashboardFilenames.has(String(item?.filename || '').trim().toLowerCase()))
                .map((item) => ({ ...item }))
            : [];
        rawImageList = imageList.map((item) => ({ ...item }));
        visibleImages = [...imageList];
        const standaloneShell = isStandaloneModalShell();
        let initialFilename = getImageNameFromPath();
        if (standaloneShell && !initialFilename) {
            window.location.replace((getPageBasePath() || '') + '/');
            return;
        }
        const initialIsDonate = !standaloneShell && isDonateRouteActive();
        const shouldPrioritizeDeepLinkModal = !!(initialFilename && !initialIsDonate);
        window.__deferGridLazyUntilModalSettled = shouldPrioritizeDeepLinkModal;
        const normalizedInitialFilename = String(initialFilename || '').trim().toLowerCase();
        if (initialFilename) {
            try { preloadImage(imgSrc(initialFilename)); } catch (_) {}
        }
        if (!standaloneShell && !shouldPrioritizeDeepLinkModal) {
            filterImages();
        }
        if (!standaloneShell) {
            const savedLayout = localStorage.getItem("preferredLayout");
            if (savedLayout === "list" || savedLayout === "grid") {
                setLayout(savedLayout, false);
            }
        }
        if (!standaloneShell && showFavoritesOnly)
            document.getElementById("favoritesToggle")?.classList.add("active");
        if (initialIsDonate) {
            showThanksPopup({ fromRoute: true });
        } else if (initialFilename) {
            const openIdx = visibleImages.findIndex(
                (img) => String(img?.filename || '').trim().toLowerCase() === normalizedInitialFilename
            );
            if (openIdx !== -1) {
                openModalByIndex(openIdx);
            } else {
                if (!openByFilenameAllowingNonFav(initialFilename)) {
                    history.replaceState(null, "", getPageBasePath() || "/");
                }
                if (window.__deferGridLazyUntilModalSettled === true && typeof window.resumeDeferredGridLazyLoading === 'function') {
                    window.resumeDeferredGridLazyLoading();
                }
            }
        }
        if (modal?.style?.display === 'flex') {
            refreshFavoriteStarsUI();
            if (!standaloneShell) {
                syncDonateOverlayToRoute();
                if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(() => {
                        filterImages();
                        syncModalToUrl();
                    });
                } else {
                    setTimeout(() => {
                        filterImages();
                        syncModalToUrl();
                    }, 100);
                }
            }
        } else {
            if (!standaloneShell) {
                filterImages();
            }
            refreshFavoriteStarsUI();
            if (!standaloneShell) {
                syncDonateOverlayToRoute();
            }
            syncModalToUrl();
        }
    })
    .catch(err => {
        if (imageGrid) imageGrid.textContent = "Failed to load visualizations.";
        console.error(err);
    });
function _isTypingEl(el){
  if(!el) return false;
  const tag = (el.tagName||"").toLowerCase();
  if(tag === "input" || tag === "textarea" || tag === "select") return true;
  if(el.isContentEditable) return true;
  return false;
}
function _focusedGridIndex(){
  const a = document.activeElement;
  if(!a) return null;
  if(a.classList?.contains("grid-thumb")) return Number(a.dataset.gridIndex);
  const withIdx = a.closest?.('[data-grid-index]');
  if(withIdx) return Number(withIdx.getAttribute("data-grid-index"));
  return null;
}
function _thumbByGridIndex(i){
  return document.querySelector(`img.grid-thumb[data-grid-index="${i}"]`);
}
function _cardByGridIndex(i){
    return document.querySelector(`.chart-container[data-grid-index="${i}"]`);
}
function _visibleGridCards(){
    return Array.from(document.querySelectorAll('.chart-container[data-grid-index]')).filter(el=>{
    if(!el.isConnected) return false;
    if(el.offsetParent === null) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  });
}
function _gridColumnCount(cards){
    if(!cards || cards.length <= 1) return 1;
    const tops = cards.map(c=>c.getBoundingClientRect().top);
  const top0 = Math.min(...tops);
    const row = cards
        .filter(c=>Math.abs(c.getBoundingClientRect().top - top0) < 8)
    .sort((a,b)=>a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  return Math.max(1, row.length || 1);
}
function _focusGridCard(i){
    const card = _cardByGridIndex(i) || _thumbByGridIndex(i)?.closest?.('.chart-container');
    if(!card) return false;
    card.focus();
    try{ card.scrollIntoView({block:"nearest", inline:"nearest"}); }catch(_){}
  return true;
}
function onGridArrowNav(e){
  if(e.key!=="ArrowLeft" && e.key!=="ArrowRight" && e.key!=="ArrowUp" && e.key!=="ArrowDown") return;
  if(document.body.classList.contains("modal-open")) return;
  const a = document.activeElement;
  if(_isTypingEl(a)) return;
  if(!imageGrid || !a || !imageGrid.contains(a)) return;
    const focusedCard =
        (a.classList?.contains("chart-container") ? a : null)
        || a.closest?.('.chart-container')
        || (a.classList?.contains("grid-thumb") ? a.closest?.('.chart-container') : null);
    if(!focusedCard) return;
  if(!imageGrid.classList.contains("grid")) return;
    const gi = Number(focusedCard.dataset.gridIndex);
  if(!Number.isFinite(gi)) return;
    const cards = _visibleGridCards();
    const cols = _gridColumnCount(cards);
  let delta = 0;
  if(e.key==="ArrowLeft") delta = -1;
  else if(e.key==="ArrowRight") delta = 1;
  else if(e.key==="ArrowUp") delta = -cols;
  else if(e.key==="ArrowDown") delta = cols;
  let target = gi + delta;
  if(target < 0) target = 0;
  if(e.key==="ArrowDown"){
        while(target <= gi + cols && !_cardByGridIndex(target) && target > gi) target -= 1;
  } else if(e.key==="ArrowUp"){
        while(target >= gi - cols && !_cardByGridIndex(target) && target < gi) target += 1;
  }
  if(target === gi) return;
  e.preventDefault();
    _focusGridCard(target);
}
window.setLayout = setLayout;
window.toggleSearch = toggleSearch;
if (typeof toggleFavoritesView === 'function') {
  window.toggleFavoritesView = toggleFavoritesView;
}
window.closeModal = closeModal;
window.prevImage = prevImage;
window.nextImage = nextImage;
window.toggleFavoriteFromModal = toggleFavoriteFromModal;