/* ===========================
 * PERSISTENCE (cookies + localStorage)
 * =========================== */
function setCookie(name, value, days = 365) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
}
function getCookie(name) {
    const match = document.cookie.split('; ').find(row => row.startsWith(name + '='));
    return match ? decodeURIComponent(match.split('=')[1]) : null;
}
function readSearchPrefs() {
    const t = localStorage.getItem('searchTitles');
    const d = localStorage.getItem('searchDescriptions');
    let inTitle = t === null ? true : t === 'true';
    let inDesc = d === null ? true : d === 'true';
    if (!inTitle && !inDesc) {
        inTitle = true;
        inDesc = false;
    }
    return {inTitle, inDesc};
}
function writeSearchPrefs(inTitle, inDesc) {
    localStorage.setItem('searchTitles', String(inTitle));
    localStorage.setItem('searchDescriptions', String(inDesc));
}
function applySearchPrefsToUI(inTitle, inDesc) {
    if (chkSearchTitles) {
        chkSearchTitles.classList.toggle('checked', inTitle);
        chkSearchTitles.setAttribute('aria-checked', String(inTitle));
    }
    if (chkSearchDescriptions) {
        chkSearchDescriptions.classList.toggle('checked', inDesc);
        chkSearchDescriptions.setAttribute('aria-checked', String(inDesc));
    }
}
function initSearchPrefsAndUI() {
    const {inTitle, inDesc} = readSearchPrefs();
    writeSearchPrefs(inTitle, inDesc);
    applySearchPrefsToUI(inTitle, inDesc);
}
function isSearchHappening() {
    const container = document.querySelector('.search-container');
    const input = document.getElementById('search-input');
    if (!container || !input) return false;
    return container.classList.contains('active') && input.value.trim().length > 0;
}
function toggleSearchPref(which) {
    let {inTitle, inDesc} = readSearchPrefs();
    if (which === 'title') {
        if (inTitle && !inDesc) {
            inTitle = false;
            inDesc = true;
        } else inTitle = !inTitle;
    } else {
        if (inDesc && !inTitle) {
            inDesc = false;
            inTitle = true;
        } else inDesc = !inDesc;
    }
    if (!inTitle && !inDesc) {
        if (which === 'title') inTitle = true;
        else inDesc = true;
    }
    writeSearchPrefs(inTitle, inDesc);
    applySearchPrefsToUI(inTitle, inDesc);
    if (isSearchHappening()) filterImages();
}
function migrateFavoriteFilename(oldFilename, newFilename) {
    let favs = getFavorites();
    const pos = favs.indexOf(oldFilename);
    if (pos !== -1) {
        favs.splice(pos, 1);
        if (!favs.includes(newFilename)) favs.push(newFilename);
        saveFavorites(favs);
    }
    const currentGridStar = getCurrentGridFavoriteStar();
    if (currentGridStar) {
        currentGridStar.setAttribute('data-filename', favoriteKeyForFilename(newFilename));
    }
    const gridStar = findFavoriteStarByKey(oldFilename);
    if (gridStar) gridStar.setAttribute('data-filename', favoriteKeyForFilename(newFilename));
    syncCurrentModalFavoriteUI();
}
function getFavorites() {
    const stored = localStorage.getItem('favorites');
    return stored ? JSON.parse(stored) : [];
}
function saveFavorites(favs) {
    localStorage.setItem('favorites', JSON.stringify(favs));
}
function getAllFavoriteKeys() {
    const keys = new Set();
    if (!Array.isArray(imageList) || imageList.length === 0) return keys;
    let hasPriceOf = false;
    for (const img of imageList) {
        if (!img || !img.filename) continue;
        if (img.filename.startsWith(POF_BASE)) hasPriceOf = true;
        else keys.add(img.filename);
    }
    if (hasPriceOf) keys.add(POF_FAV_KEY);
    return keys;
}
function favoriteKeyForFilename(filename) {
    return String(filename || '').startsWith(POF_BASE) ? POF_FAV_KEY : String(filename || '');
}
function setFavoriteVisualState(elem, on) {
    if (!elem) return;
    elem.textContent = on ? '★' : '☆';
    elem.classList.toggle('filled', !!on);
}
function findFavoriteStarByKey(key) {
    return Array.from(document.querySelectorAll('.favorite-star')).find(
        star => star.getAttribute('data-filename') === key
    ) || null;
}
function getCurrentGridFavoriteStar() {
    const thumb = document.querySelector(`img.grid-thumb[data-grid-index="${currentIndex}"]`);
    if (!thumb) return null;
    return thumb.closest('.chart-container')?.querySelector('.favorite-star') || null;
}
function syncCurrentModalFavoriteUI() {
    const cur = visibleImages?.[currentIndex];
    if (!cur) return;
    const key = favoriteKeyForFilename(cur.filename);
    const on = isFavorite(cur.filename);
    setFavoriteVisualState(modalFavBtn, on);
    const gridStar = getCurrentGridFavoriteStar() || findFavoriteStarByKey(key);
    if (gridStar) {
        gridStar.setAttribute('data-filename', key);
        setFavoriteVisualState(gridStar, on);
    }
    const thumb = document.querySelector(`img.grid-thumb[data-grid-index="${currentIndex}"]`);
    if (thumb) thumb.dataset.fav = on ? '1' : '0';
}
function refreshFavoriteStarsUI() {
    const favs = new Set(getFavorites());
    document.querySelectorAll('.favorite-star').forEach(star => {
        const key = star.getAttribute('data-filename');
        const on = favs.has(key) || (key !== POF_FAV_KEY && favs.has(POF_FAV_KEY) && /^price_of_/.test(key));
        setFavoriteVisualState(star, on);
    });
    document.querySelectorAll('img.grid-thumb[data-grid-index]').forEach(thumb => {
        thumb.dataset.fav = isFavorite(thumb.dataset.filename || '') ? '1' : '0';
    });
    if (modal && modal.style.display === 'flex') {
        syncCurrentModalFavoriteUI();
    }
}
function favoriteAll() {
    const all = Array.from(getAllFavoriteKeys());
    saveFavorites(all);
    refreshFavoriteStarsUI();
    if (showFavoritesOnly) filterImages();
}
function unfavoriteAll() {
    saveFavorites([]);
    refreshFavoriteStarsUI();
    if (showFavoritesOnly) filterImages();
}
function isFavorite(filename) {
    const favs = getFavorites();
    if (filename.startsWith(POF_BASE)) {
        return favs.includes(POF_FAV_KEY) || favs.some(f => /^price_of_/.test(f));
    }
    return favs.includes(filename);
}
function toggleFavorite(filename, starElem) {
    const favKey = favoriteKeyForFilename(filename);
    let favs = getFavorites();
    const index = favs.indexOf(favKey);
    const becameFav = index === -1;
    if (!becameFav) {
        favs.splice(index, 1);
    } else {
        if (favKey === POF_FAV_KEY) favs = favs.filter(f => !/^price_of_/.test(f));
        favs.push(favKey);
    }
    saveFavorites(favs);
    if (starElem) {
        starElem.setAttribute('data-filename', favKey);
        setFavoriteVisualState(starElem, becameFav);
    }
    refreshFavoriteStarsUI();

    if (showFavoritesOnly && !becameFav) filterImages();
    // if the user just added a favorite we want its thumbnail to begin
    // loading even if it's off‑screen; our lazy loader will load all favorites
    // first when initLazyImages runs.
    if (becameFav) {
        try { initLazyImages(); } catch (_) {}
    }
}

function migratePriceOfFavorites() {
    let favs = getFavorites();
    const hadLegacy = favs.some(f => /^price_of_/.test(f));
    if (!hadLegacy) return;
    favs = favs.filter(f => !/^price_of_/.test(f));
    if (!favs.includes(POF_FAV_KEY)) favs.push(POF_FAV_KEY);
    saveFavorites(favs);
}