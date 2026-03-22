/* ===========================
 * MODULE: Price Of (price_of_*)
 * =========================== */
function isPriceOfFile(fname) {
    return fname.startsWith(POF_BASE);
}
function pofSlugFromFilename(fname) {
    const m = fname.match(/^price_of_([a-z0-9_]+)\.png$/);
    return m ? m[1] : null;
}
function pofFilenameForSlug(slug) {
    return `${POF_BASE}${slug}.png`;
}
function slugToTitle(slug) {
    return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function buildPriceOfOptionsFromList(list) {
    const bySlug = new Map();
    list.forEach(img => {
        const m = img.filename.match(/^price_of_([a-z0-9_]+)\.png$/);
        if (!m) return;
        const slug = m[1];
        const rawMsat = img.pof_msat ?? img.uoa_msat ?? img.msat;
        const msatNum = Number(rawMsat);
        const msat = Number.isFinite(msatNum) ? msatNum : null;
        if (!bySlug.has(slug)) {
            bySlug.set(slug, {
                slug,
                label:
                    slug === 'min_wage_ca' ? 'Min Wage CA' :
                    slug === 'min_wage_fl' ? 'Min Wage FL' :
                    slug === 'min_wage_ma' ? 'Min Wage MA' :
                    slug === 'min_wage_ny' ? 'Min Wage NY' :
                    slug === 'min_wage_oh' ? 'Min Wage OH' :
                    slug === 'min_wage_pa' ? 'Min Wage PA' :
                    slug === 'min_wage_tx' ? 'Min Wage TX' :
                    slug === 'min_wage_wa' ? 'Min Wage WA' :
                    slug === 'wti_crude' ? 'WTI Crude' :
                    slug === 'natural_gas_us' ? 'Natural Gas US' :
                    slug === 'natural_gas_eu' ? 'Natural Gas EU' :
                    slugToTitle(slug),
                filename: `price_of_${slug}.png`,
                title: img.title,
                description: img.description,
                latest_x: img.latest_x || '',
                latest_nostr: img.latest_nostr || '',
                latest_youtube: img.latest_youtube || '',
                msat
            });
        }
    });
    PRICE_OF_OPTIONS = Array.from(bySlug.values());
    PRICE_OF_META = PRICE_OF_OPTIONS.reduce((acc, o) => {
        acc[o.slug] = o;
        return acc;
    }, {});
}
function populatePriceOfSelect() {
    if (!priceOfSelect) return;
    priceOfSelect.innerHTML = PRICE_OF_OPTIONS.map(o => `<option value="${o.slug}">${o.label}</option>`).join('');
}
function updatePofIndexUiBySlug(slug) {
    if (
        !pofIndexInput ||
        !pofIndexTotal ||
        !Array.isArray(PRICE_OF_OPTIONS) ||
        PRICE_OF_OPTIONS.length === 0
    ) {
        return;
    }
    const total = PRICE_OF_OPTIONS.length;
    pofIndexTotal.textContent = String(total);
    pofIndexInput.min = '1';
    pofIndexInput.max = String(total);
    const idx = PRICE_OF_OPTIONS.findIndex(o => o.slug === slug);
    if (idx === -1) {
        pofIndexInput.value = '';
        return;
    }
    pofIndexInput.value = String(idx + 1);
}
function applyPostLinksFromMeta(meta) {
    setModalLinks({x: meta.latest_x || '', nostr: meta.latest_nostr || '', youtube: meta.latest_youtube || ''});
}
function getStoredPofItem() {
    return getCookie(POF_STORAGE_KEY) || localStorage.getItem(POF_STORAGE_KEY) || 'ground_beef';
}
function setStoredPofItem(slug) {
    setCookie(POF_STORAGE_KEY, slug, 365);
    localStorage.setItem(POF_STORAGE_KEY, slug);
}
function normalizePofSortMode(mode) {
    if (!mode) return 'az';
    const m = String(mode).toLowerCase();
    if (m === 'a-z' || m === 'az') return 'az';
    if (m === 'z-a' || m === 'za') return 'za';
    if (m === 'highest' || m === 'highest price' || m === 'high') return 'high';
    if (m === 'lowest' || m === 'lowest price' || m === 'low') return 'low';
    return 'az';
}
function getStoredPofSort() {
    const raw = localStorage.getItem(POF_SORT_STORAGE_KEY);
    return normalizePofSortMode(raw || 'az');
}
function setStoredPofSort(mode) {
    const norm = normalizePofSortMode(mode);
    localStorage.setItem(POF_SORT_STORAGE_KEY, norm);
}
function sortPriceOfOptions(mode, preferredSlug) {
    const norm = normalizePofSortMode(mode);
    if (!Array.isArray(PRICE_OF_OPTIONS) || PRICE_OF_OPTIONS.length === 0) return;

    const byLabel = (a, b) => a.label.localeCompare(b.label);
    const byMsatAsc = (a, b) => {
        const am = typeof a.msat === 'number' ? a.msat : Infinity;
        const bm = typeof b.msat === 'number' ? b.msat : Infinity;
        if (am === bm) return byLabel(a, b);
        return am - bm;
    };
    const byMsatDesc = (a, b) => {
        const am = typeof a.msat === 'number' ? a.msat : -Infinity;
        const bm = typeof b.msat === 'number' ? b.msat : -Infinity;
        if (am === bm) return byLabel(a, b);
        return bm - am;
    };
    const hasAnyNumericMsat = PRICE_OF_OPTIONS.some(
        o => typeof o.msat === 'number' && Number.isFinite(o.msat)
    );
    if ((norm === 'high' || norm === 'low') && !hasAnyNumericMsat) {
        PRICE_OF_OPTIONS.sort(byLabel);
    } else if (norm === 'az') {
        PRICE_OF_OPTIONS.sort(byLabel);
    } else if (norm === 'za') {
        PRICE_OF_OPTIONS.sort((a, b) => byLabel(b, a));
    } else if (norm === 'high') {
        PRICE_OF_OPTIONS.sort(byMsatDesc);
    } else if (norm === 'low') {
        PRICE_OF_OPTIONS.sort(byMsatAsc);
    }
    PRICE_OF_META = PRICE_OF_OPTIONS.reduce((acc, o) => {
        acc[o.slug] = o;
        return acc;
    }, {});
    const currentSlug =
        preferredSlug ||
        (priceOfSelect && priceOfSelect.value) ||
        getStoredPofItem() ||
        (PRICE_OF_OPTIONS[0] && PRICE_OF_OPTIONS[0].slug);
    populatePriceOfSelect();
    if (priceOfSelect && currentSlug && PRICE_OF_OPTIONS.some(o => o.slug === currentSlug)) {
        priceOfSelect.value = currentSlug;
    }
    if (currentSlug) {
        updatePofIndexUiBySlug(currentSlug);
    }
}
function setPofSortMode(modeRaw) {
    const norm = normalizePofSortMode(modeRaw);
    setStoredPofSort(norm);
    let currentSlug = null;
    const curImg = visibleImages[currentIndex];
    if (curImg && isPriceOfFile(curImg.filename)) {
        currentSlug = pofSlugFromFilename(curImg.filename) || getStoredPofItem();
    } else {
        currentSlug = getStoredPofItem();
    }
    sortPriceOfOptions(norm, currentSlug);
    if (pofSortSelect) {
        pofSortSelect.value = norm;
    }
}
function setPriceOfItem(slug) {
    const image = visibleImages[currentIndex];
    if (!image || !isPriceOfFile(image.filename)) return;
    const oldFilename   = image.filename;
    const newFilename   = pofFilenameForSlug(slug);
    const fallbackTitle = `Price of ${slugToTitle(slug)}`;
    const meta          = PRICE_OF_META[slug] || { title: fallbackTitle, description: '' };
    const title       = meta.title       || image.title       || fallbackTitle;
    const description = meta.description || image.description || '';
    setStoredPofItem(slug);
    setModalImageAndCenter(newFilename, title);
    replaceUrlForFilename(newFilename);
    applyPostLinksFromMeta(meta);
    Object.assign(image, {
        filename:      newFilename,
        title,
        description,
        latest_x:      meta.latest_x      || image.latest_x      || '',
        latest_nostr:  meta.latest_nostr  || image.latest_nostr  || '',
        latest_youtube: meta.latest_youtube || image.latest_youtube || ''
    });
    const titleEl = document.querySelector(`.chart-title[data-grid-index="${currentIndex}"]`);
    if (titleEl) titleEl.textContent = title;
    const descEl = document.querySelector(`.chart-description[data-grid-index="${currentIndex}"]`);
    if (descEl) descEl.textContent = description;
    updateGridThumbAtCurrent(newFilename, title);
    const gridImg = document.querySelector(`img.grid-thumb[data-grid-index="${currentIndex}"]`);
    const cardContainer = gridImg ? gridImg.closest('.chart-container') : null;
    if (cardContainer && gridImg) {
        const tip = description || title;
        cardContainer.setAttribute('title', tip);
        gridImg.alt = title;
    }
    syncCurrentModalFavoriteUI();
    updateModalSafePadding();
    updatePofIndexUiBySlug(slug);
}
function cyclePriceOf(direction) {
    if (!priceOfSelect) return;
    const opts = Array.from(priceOfSelect.options);
    if (opts.length === 0) return;
    const slugs = opts.map(o => o.value);
    const currentSlug = priceOfSelect.value || getStoredPofItem();
    const idx = slugs.indexOf(currentSlug);
    if (idx === -1) return;
    const delta = direction === 'up' ? -1 : 1;
    const len = slugs.length;
    const newIdx = (idx + delta + len) % len;
    const nextSlug = slugs[newIdx];
    priceOfSelect.value = nextSlug;
    setPriceOfItem(nextSlug);
}