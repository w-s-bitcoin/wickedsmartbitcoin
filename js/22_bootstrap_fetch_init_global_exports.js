/* ===========================
 * BOOTSTRAP (fetch + init + global exports)
 * =========================== */

const HOMEPAGE_DASHBOARD_TIME = window.WSBDashboardTime || null;
const HOMEPAGE_TZ_STORAGE_KEY = HOMEPAGE_DASHBOARD_TIME?.STORAGE_KEY || "wicked_dashboard_timezone_v1";
const HOMEPAGE_TZ_CHANGE_EVENT = HOMEPAGE_DASHBOARD_TIME?.CHANGE_EVENT || "wsb:timezonechange";
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

    const preferredTimeZone = HOMEPAGE_DASHBOARD_TIME?.getPreferredTimeZone?.() || "UTC";
    const formatted = HOMEPAGE_DASHBOARD_TIME?.formatUtcTimestamp
        ? HOMEPAGE_DASHBOARD_TIME.formatUtcTimestamp(normalizedStamp, preferredTimeZone).text
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
    const resolveBtcmaps = (slugNoPng) => {
    let s = String(slugNoPng || "").replace(/^\/+|\/+$/g, "").toLowerCase();
    if (!s) return null;
    const parsed = btcmapsRegionAndViewFromFilename(s + ".png");
    return _pickExistingBtcmapsFilename(parsed.region || "global", parsed.view || "total");
    };
  if (location.hash) {
    let h = location.hash.replace(/^#/, "");
    if (h.toLowerCase() === DONATE_ROUTE) return null;
    const hLow = h.toLowerCase();
    if (
    hLow === "btcmap" || hLow === "btcmaps" ||
    hLow.startsWith("btcmap_") || hLow.startsWith("btcmaps_")
    ) {
    return resolveBtcmaps(h);
    }
    return h + ".png";
  }
  const base = getPageBasePath();
  let rel = window.location.pathname;
  if (base && rel.startsWith(base)) rel = rel.slice(base.length);
  rel = rel.replace(/^\/+|\/+$/g, "");
  if (!rel) return null;
    if (rel.toLowerCase().endsWith('.html')) return null;
  if (rel.toLowerCase() === DONATE_ROUTE) return null;
    const relLow = rel.toLowerCase();
    if (
    relLow === "btcmap" || relLow === "btcmaps" ||
    relLow.startsWith("btcmap_") || relLow.startsWith("btcmaps_")
    ) {
    return resolveBtcmaps(rel);
    }
  return rel + ".png";
}
const IMAGE_LIST_URL = `${getPageBasePath()}/assets/image_list.json`;
fetch(IMAGE_LIST_URL)
    .then(res => res.json())
    .then(data => {
        imageList = data;
        rawImageList = data;
        buildHalvingMetaFromList(imageList);
        MYR_RANGES = buildMyrRanges(MYR_START_YEAR, THIS_YEAR);
        populateMyrSelect();
        buildPriceOfOptionsFromList(imageList);
        sortPriceOfOptions(getStoredPofSort());
        // coin options removed
        buildUoaOptionsFromList(imageList);
        sortUoaOptions(getStoredUoaSort());
        setUoaShowMode(getStoredUoaShowMode());
        buildBtcmapsOptionsAndViewsFromList(imageList);
        populateBtcmapsSelect();
        const standaloneShell = isStandaloneModalShell();
        let initialFilename = getImageNameFromPath();
        if (standaloneShell && !initialFilename) {
            window.location.replace((getPageBasePath() || '') + '/');
            return;
        }
        const initialIsDonate = !standaloneShell && isDonateRouteActive();
        // Deep-linked modal routes should prioritize modal content fetches
        // before grid thumbnail lazy requests.
        const shouldPrioritizeDeepLinkModal = !!(initialFilename && !initialIsDonate);
        window.__deferGridLazyUntilModalSettled = shouldPrioritizeDeepLinkModal;
        let urlDistMetric = null;
        if (initialFilename && isDistFile(initialFilename)) {
            urlDistMetric = distMetricFromFilename(initialFilename) || null;
            if (urlDistMetric) setStoredDistMetric(urlDistMetric);
        }
        let urlPofSlug = null;
        let urlUoaSlug = null;
        let urlBtcmapsRegion = null;
        let urlBtcmapsView = null;
        if (initialFilename && isBtcmapsFile(initialFilename)) {
            const parsed = btcmapsRegionAndViewFromFilename(initialFilename);
            const r0 = parsed.region || "global";
            const v0 = parsed.view || "total";
            if (BTCMAP_OPTIONS.some(o => o.slug === r0)) {
                urlBtcmapsRegion = setStoredBtcmapsRegion(r0);
                urlBtcmapsView = setStoredBtcmapsView(urlBtcmapsRegion, v0);
            }
        }
        if (initialFilename && isUoaFile(initialFilename)) {
            const s = uoaSlugFromFilename(initialFilename);
            if (s && UOA_OPTIONS.some(o => o.slug === s)) {
                urlUoaSlug = s;
                setStoredUoaItem(s);
            }
        }
        const uoaAll = imageList.filter(img => isUoaFile(img.filename));
        if (uoaAll.length) {
            const storedUoaSlug = getStoredUoaItem();
            const effectiveSlug =
                urlUoaSlug ||
                storedUoaSlug ||
                (UOA_OPTIONS[0]?.slug || null);
            const repFilename = effectiveSlug
                ? uoaFilenameForSlug(effectiveSlug)
                : uoaAll[0].filename;
            const repMeta = effectiveSlug ? UOA_META[effectiveSlug] : null;
            const chosen = uoaAll.find(img => img.filename === repFilename) || uoaAll[0];
            const uoaCard = {
                ...chosen,
                filename: repFilename,
                title: repMeta?.title || chosen.title || "Unit of Account",
                description: repMeta?.description || chosen.description || "",
                latest_x: repMeta?.latest_x || chosen.latest_x || "",
                latest_nostr: repMeta?.latest_nostr || chosen.latest_nostr || "",
                latest_youtube: repMeta?.latest_youtube || chosen.latest_youtube || ""
            };
            const firstIdx = imageList.findIndex(img => isUoaFile(img.filename));
            const nonUoa = imageList.filter(img => !isUoaFile(img.filename));
            const insertIndex = firstIdx === -1 ? nonUoa.length : firstIdx;
            imageList = [
                ...nonUoa.slice(0, insertIndex),
                uoaCard,
                ...nonUoa.slice(insertIndex)
            ];
        }
        // coin card logic removed

        const btcmapsAll = imageList.filter(img => isBtcmapsFile(img.filename));
        if (btcmapsAll.length) {
        const storedRegion = getStoredBtcmapsRegion();
        const effectiveRegion =
            urlBtcmapsRegion ||
            storedRegion ||
            BTCMAP_OPTIONS[0]?.slug ||
            btcmapsSlugFromFilename(btcmapsAll[0].filename) ||
            "global";
        const effectiveView =
            urlBtcmapsView ||
            getStoredBtcmapsView(effectiveRegion) ||
            "total";
        const normRegion = setStoredBtcmapsRegion(effectiveRegion);
        const normView   = setStoredBtcmapsView(normRegion, effectiveView);
        const repFilename = btcmapsFilenameForRegionView(normRegion, normView);
        const repMeta = BTCMAP_META[normRegion] || {};
        const chosen = btcmapsAll.find(img => String(img.filename).toLowerCase() === String(repFilename).toLowerCase()) || btcmapsAll[0];
        const btcmapsCard = {
            ...chosen,
            filename: repFilename,
            title: repMeta.title || chosen.title || "BTC Map",
            description: repMeta.description || chosen.description || "",
            latest_x: repMeta.latest_x || chosen.latest_x || "",
            latest_nostr: repMeta.latest_nostr || chosen.latest_nostr || "",
            latest_youtube: repMeta.latest_youtube || chosen.latest_youtube || ""
        };
        const firstIdx = imageList.findIndex(img => isBtcmapsFile(img.filename));
        const nonBtcmaps = imageList.filter(img => !isBtcmapsFile(img.filename));
        const insertIndex = firstIdx === -1 ? nonBtcmaps.length : firstIdx;
        imageList = [
            ...nonBtcmaps.slice(0, insertIndex),
            btcmapsCard,
            ...nonBtcmaps.slice(insertIndex)
        ];
        }
        const storedPofSlug = getStoredPofItem();
        const repPofFilename = pofFilenameForSlug(storedPofSlug);
        const repPofMeta = PRICE_OF_META[storedPofSlug];
        const nonPof = imageList.filter(img => !isPriceOfFile(img.filename));
        const pofAll = imageList.filter(img => isPriceOfFile(img.filename));
        let pofCard = null;
        if (pofAll.length) {
        const chosen = pofAll.find(img => img.filename === repPofFilename) || pofAll[0];
        pofCard = {
            ...chosen,
            filename: repPofFilename,
            title: repPofMeta?.title || chosen.title,
            description: repPofMeta?.description || chosen.description,
            latest_x: repPofMeta?.latest_x || "",
            latest_nostr: repPofMeta?.latest_nostr || "",
            latest_youtube: repPofMeta?.latest_youtube || ""
        };
        }
        if (pofCard) {
        const gwIdx = nonPof.findIndex(img => img.filename.startsWith("global_wealth"));
        if (gwIdx !== -1) imageList = [...nonPof.slice(0, gwIdx + 1), pofCard, ...nonPof.slice(gwIdx + 1)];
        else imageList = [...nonPof, pofCard];
        } else {
        imageList = nonPof;
        }
        if (pofCard) {
            const gwIdx = nonPof.findIndex(img =>
                img.filename.startsWith("global_wealth")
            );
            if (gwIdx !== -1) {
                imageList = [
                    ...nonPof.slice(0, gwIdx + 1),
                    pofCard,
                    ...nonPof.slice(gwIdx + 1)
                ];
            } else {
                imageList = [...nonPof, pofCard];
            }
        } else {
            imageList = nonPof;
        }
        const halvingEntries = imageList.filter(img =>
        isHalvingViewFile(img.filename)
        );

        if (halvingEntries.length) {
        let urlHalvingView = null;

        if (initialFilename && isHalvingViewFile(initialFilename)) {
            urlHalvingView = halvingViewFromFilename(initialFilename);
            setStoredHalvingView(urlHalvingView);
        }

        const storedHalvingView = getStoredHalvingView();
        const effectiveView = urlHalvingView || storedHalvingView;

        const desiredFilename = halvingFilenameForView(effectiveView);
        const sourceEntry =
            halvingEntries.find(img => String(img.filename).toLowerCase() === String(desiredFilename).toLowerCase()) ||
            halvingEntries[0];
        const baseMeta = HALVING_META[desiredFilename] || sourceEntry;

        const firstIdx = imageList.findIndex(img =>
            isHalvingViewFile(img.filename)
        );

        imageList = imageList.filter(img => !isHalvingViewFile(img.filename));

        const halvingCard = {
            ...sourceEntry,
            ...baseMeta,
            filename: desiredFilename,
            title: baseMeta.title || "Halving View",
            description: baseMeta.description || "",
            latest_x: baseMeta.latest_x || "",
            latest_nostr: baseMeta.latest_nostr || "",
            latest_youtube: baseMeta.latest_youtube || ""
        };

        const insertIndex = firstIdx === -1 ? imageList.length : firstIdx;
        imageList.splice(insertIndex, 0, halvingCard);
        }

        const distAll = imageList.filter(img => isDistFile(img.filename));
        if (distAll.length) {
            const effectiveMetric = urlDistMetric || getStoredDistMetric();
            const normMetric = setStoredDistMetric(effectiveMetric);
            const repFilename = distFilenameForMetric(normMetric);

            const chosen =
                distAll.find(img => String(img.filename).toLowerCase() === String(repFilename).toLowerCase()) ||
                distAll[0];

            const distCard = {
                ...chosen,
                filename: repFilename,
                // keep chosen title/desc/links; this mirrors your other merged cards
                title: chosen.title || "Distribution",
                description: chosen.description || "",
                latest_x: chosen.latest_x || "",
                latest_nostr: chosen.latest_nostr || "",
                latest_youtube: chosen.latest_youtube || ""
            };

            const firstIdx = imageList.findIndex(img => isDistFile(img.filename));
            const nonDist = imageList.filter(img => !isDistFile(img.filename));
            const insertIndex = firstIdx === -1 ? nonDist.length : firstIdx;

            imageList = [
                ...nonDist.slice(0, insertIndex),
                distCard,
                ...nonDist.slice(insertIndex)
            ];
        }
        // ---- Cycle Anchor merge (cycle_low_multiple + cycle_high_drawdown => one card)
        const cycleAll = imageList.filter(img => isCycleAnchorFile(img.filename));
        if (cycleAll.length) {
        // If URL directly requested one of these, pin the stored anchor accordingly
        let urlCycleAnchor = null;
        if (initialFilename && isCycleAnchorFile(initialFilename)) {
            const a = cycleAnchorFromFilename(initialFilename);
            if (a) urlCycleAnchor = setStoredCycleAnchor(a);
        }

        const effectiveAnchor = urlCycleAnchor || getStoredCycleAnchor();
        const repFilename = cycleFilenameForAnchor(effectiveAnchor);

        const chosen =
            cycleAll.find(img => String(img.filename).toLowerCase() === String(repFilename).toLowerCase()) ||
            cycleAll[0];

        const cycleCard = {
            ...chosen,
            filename: repFilename
        };

        const firstIdx = imageList.findIndex(img => isCycleAnchorFile(img.filename));
        const nonCycle = imageList.filter(img => !isCycleAnchorFile(img.filename));
        const insertIndex = firstIdx === -1 ? nonCycle.length : firstIdx;

        imageList = [
            ...nonCycle.slice(0, insertIndex),
            cycleCard,
            ...nonCycle.slice(insertIndex)
        ];
        }
        let urlBvgYear = null;
        if (initialFilename && initialFilename.startsWith("bitcoin_vs_gold_")) {
            const m = initialFilename.match(/bitcoin_vs_gold_(\d{4})\.png$/);
            if (m && isValidBvgYear(m[1])) {
                urlBvgYear = m[1];
                setStoredBvgYear(urlBvgYear);
            }
        }
        let urlDalScale = null;
        if (initialFilename && initialFilename.startsWith(DAL_BASE)) {
            if (initialFilename === `${DAL_BASE}_log.png`) urlDalScale = "log";
            else urlDalScale = "linear";
            setStoredDalScale(urlDalScale);
        }
        let urlPotdScale = null;
        if (initialFilename && initialFilename.startsWith(POTD_BASE)) {
            if (initialFilename === `${POTD_BASE}_log.png`) urlPotdScale = "log";
            else urlPotdScale = "linear";
            setStoredPotdScale(urlPotdScale);
        }
        let urlNlbpScale = null;
        if (initialFilename && initialFilename.startsWith(NLBP_BASE)) {
            if (initialFilename === `${NLBP_BASE}_log.png`) urlNlbpScale = "log";
            else urlNlbpScale = "linear";
            setStoredNlbpScale(urlNlbpScale);
        }
        imageList = imageList.map(img =>
            img.filename.startsWith(BVG_BASE)
                ? { ...img, filename: `${BVG_BASE}_${getStoredBvgYear()}.png` }
                : img
        );
        imageList = imageList.map(img =>
            img.filename.startsWith(DAL_BASE)
                ? { ...img, filename: dalFilenameForScale(getStoredDalScale()) }
                : img
        );
        imageList = imageList.map(img =>
            img.filename.startsWith(POTD_BASE)
                ? { ...img, filename: potdFilenameForScale(getStoredPotdScale()) }
                : img
        );
        imageList = imageList.map(img =>
            img.filename.startsWith(NLBP_BASE)
                ? { ...img, filename: nlbpFilenameForScale(getStoredNlbpScale()) }
                : img
        );
        visibleImages = [...imageList];
        migratePriceOfFavorites();
        // if we're about to open something right away (deep link) make sure the
        // modal image gets preloaded before we fire off a bunch of thumb loads.
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
        if (!standaloneShell && showArchivedToggle) {
            showArchivedToggle.checked = showArchivedVisualizations;
        }
        if (initialIsDonate) {
            showThanksPopup({ fromRoute: true });
        } else if (initialFilename) {
            let opened = false;
            let openIdx = -1;
            if (urlBvgYear) {
                openIdx = visibleImages.findIndex(
                    img => img.filename === initialFilename
                );
                if (openIdx === -1)
                    openIdx = visibleImages.findIndex(img =>
                        img.filename.startsWith("bitcoin_vs_gold_")
                    );
            } else if (urlDalScale) {
                openIdx = visibleImages.findIndex(
                    img => img.filename === initialFilename
                );
                if (openIdx === -1)
                    openIdx = visibleImages.findIndex(img =>
                        img.filename.startsWith(DAL_BASE)
                    );
            } else if (urlPotdScale) {
                openIdx = visibleImages.findIndex(img =>
                    img.filename.startsWith(POTD_BASE)
                );
                if (openIdx === -1)
                    openIdx = visibleImages.findIndex(
                        img => img.filename === initialFilename
                    );
            } else if (urlNlbpScale) {
                openIdx = visibleImages.findIndex(img =>
                    img.filename.startsWith(NLBP_BASE)
                );
                if (openIdx === -1)
                    openIdx = visibleImages.findIndex(
                        img => img.filename === initialFilename
                    );
            } else if (urlUoaSlug) {
                openIdx = visibleImages.findIndex(img => isUoaFile(img.filename));
            } else if (urlBtcmapsRegion) {
                openIdx = visibleImages.findIndex(img => isBtcmapsFile(img.filename));
            } else if (urlDistMetric) {
                openIdx = visibleImages.findIndex(img => isDistFile(img.filename));
            } else if (urlPofSlug) {
                openIdx = visibleImages.findIndex(
                    img => img.filename === initialFilename
                );
                if (openIdx === -1)
                    openIdx = visibleImages.findIndex(img =>
                        img.filename.startsWith(POF_BASE)
                    );
            } else if (
                !initialFilename.startsWith("bitcoin_vs_gold_")
            ) {
                openIdx = visibleImages.findIndex(
                    img => img.filename === initialFilename
                );
            }
            if (openIdx !== -1) {
                openModalByIndex(openIdx);
                opened = true;
            }
            if (!opened) {
                if (
                    !openByFilenameAllowingNonFav(initialFilename)
                )
                    history.replaceState(null, "", "/");
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
  if(typeof isSlideshowOpen === "function" && isSlideshowOpen()) return;
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