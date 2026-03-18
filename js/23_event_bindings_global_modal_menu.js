/* ===========================
 * EVENT BINDINGS (global + modal + menu)
 * =========================== */
window.addEventListener('resize', updateLayoutBasedOnWidth);
window.addEventListener('resize', updateModalSafePadding);
document.addEventListener('keydown', onGridArrowNav, true);
window.addEventListener('orientationchange', updateModalSafePadding);
window.addEventListener('resize', handleModalViewportChange);
window.addEventListener('orientationchange', handleModalViewportChange);
window.addEventListener("popstate", () => {
  syncDonateOverlayToRoute();
  syncModalToUrl();
});
window.addEventListener('resize', () => {
    if (!isBuyMeVisible) return;
    positionThanksMethodButtonsForOrientation();
});
window.addEventListener('orientationchange', () => {
    if (!isBuyMeVisible) return;
    positionThanksMethodButtonsForOrientation();
});
window.addEventListener('resize', handleThanksOverlayResize);
window.addEventListener('orientationchange', handleThanksOverlayResize);
chkSearchTitles?.addEventListener('click', e => {
    e.stopPropagation();
    toggleSearchPref('title');
});
chkSearchDescriptions?.addEventListener('click', e => {
    e.stopPropagation();
    toggleSearchPref('desc');
});
modal.addEventListener('click', e => {
    if (e.target === modal) closeModal();
});
modal.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
});
modal.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    if (!gestureConsumed) {
        handleSwipe();
        handleVerticalSwipe();
    }
});
startSlideshowBtn?.addEventListener('click', () => {
    kebabMenu?.classList.add('hidden');
    kebabBtn?.setAttribute('aria-expanded', 'false');
    if (!visibleImages || !visibleImages.length) return;
    openSlideshow(0, true);
});
ssExitBtn?.addEventListener('click', e => {
    e.stopPropagation();
    showSlideshowUI(slideshowPlaying);
    closeSlideshow();
});
ssNextBtn?.addEventListener('click', e => {
    e.stopPropagation();
    showSlideshowUI(slideshowPlaying);
    slideshowNext(true);
});
ssPrevBtn?.addEventListener('click', e => {
    e.stopPropagation();
    showSlideshowUI(slideshowPlaying);
    slideshowPrev(true);
});
function onPlayPauseActivate(e) {
    if (e.type === 'keydown' && !(e.key === 'Enter' || e.key === ' ' || e.code === 'Space')) return;
    e.stopPropagation();
    e.preventDefault();
    if (slideshowPlaying) {
        pauseSlideshow();
        showSlideshowUI(false);
    } else {
        playSlideshow();
        showSlideshowUI(true);
    }
}
ssPlayPauseBtn?.addEventListener('click', onPlayPauseActivate);
ssPlayPauseBtn?.addEventListener('keydown', onPlayPauseActivate);
ssPlayPauseBtn?.setAttribute('tabindex', '0');
ssPlayPauseBtn?.setAttribute('role', 'button');
document.addEventListener('keydown', e => {
    if (isBuyMeVisible) return;
    if (!slideshowEl || slideshowEl.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        closeSlideshow();
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        slideshowNext(true);
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        slideshowPrev(true);
    } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
    }
});
function onFullscreenChangeAutoClose() {
    if (!document.fullscreenElement && isSlideshowOpen()) {
        closeSlideshow();
    }
}
['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => document.addEventListener(evt, onFullscreenChangeAutoClose));
slideRange?.addEventListener('change', () => restartSlideshowTimer());
slideRange?.addEventListener('input', () => restartSlideshowTimer());
buyMeBtn?.addEventListener('click', e => {
    e.preventDefault();
    if (modal && modal.style.display === 'flex') return;
    setDonateRouteUrl(true, { push: true });
    showThanksPopup({ fromRoute: false });
});
modalDlBtn?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    if (modal?.style?.display !== 'flex') return;
    downloadCurrentModalImage();
});
modalDlBtn?.addEventListener('keydown', e => {
    if (!(e.key === 'Enter' || e.key === ' ' || e.code === 'Space')) return;
    e.preventDefault();
    e.stopPropagation();
    if (modal?.style?.display !== 'flex') return;
    downloadCurrentModalImage();
});
function onToolbarButtonKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space') return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.click();
}
gridIcon?.addEventListener('keydown', onToolbarButtonKeydown);
listIcon?.addEventListener('keydown', onToolbarButtonKeydown);
favoritesToggleBtn?.addEventListener('keydown', onToolbarButtonKeydown);
document.addEventListener('keydown', e => {
    if (!isBuyMeVisible) return;
    const k = e.key;
    if (
        k === 'ArrowLeft' ||
        k === 'ArrowRight' ||
        k === 'ArrowUp' ||
        k === 'ArrowDown' ||
        k === ' ' ||
        k === 'Spacebar'
    ) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
        }
        if (k === ' ' || k === 'Spacebar') {
            hideThanksPopup();
        }
    }
}, true);
document.addEventListener('keydown', e => {
    if (isBuyMeVisible) return;
    if (modal.style.display !== 'flex') return;
    const swallow = () => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
        }
    };
    if (e.key === 'ArrowLeft') {
        swallow();
        prevImage();
    } else if (e.key === 'ArrowRight') {
        swallow();
        nextImage();
    } else if (e.key === ' ' || e.code === 'Space') {
        swallow();
        closeModal();
    } else if (e.key === 'Escape') {
        swallow();
        // Check if YouTube overlay is open - if so, close it instead of the modal
        const youtubeOverlay = document.getElementById('youtube-overlay');
        if (youtubeOverlay && !youtubeOverlay.classList.contains('hidden')) {
            closeYoutubeOverlay();
            return;
        }
        closeModal();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const currentFile = visibleImages[currentIndex]?.filename || '';
        if (!currentFile) return;
        const isUp = (e.key === 'ArrowUp');
        const active = document.activeElement;
        swallow();
        let dropdownToFocus = null;

        if (active === yearSelect) {
            isUp ? cycleBvgYear('up') : cycleBvgYear('down');
            dropdownToFocus = yearSelect;
        } else if (active === scaleSelect) {
            if (isDalFile(currentFile)) {
                isUp ? cycleDalScale('up') : cycleDalScale('down');
            } else if (isPotdFile(currentFile)) {
                isUp ? cyclePotdScale('up') : cyclePotdScale('down');
            } else if (isNlbpFile(currentFile)) {
                isUp ? cycleNlbpScale('up') : cycleNlbpScale('down');
            }
            dropdownToFocus = scaleSelect;
        } else if (active === dominanceSelect) {
            isUp ? cycleDominance('up') : cycleDominance('down');
            dropdownToFocus = dominanceSelect;
        } else if (active === halvingViewSelect) {
            isUp ? cycleHalvingView('up') : cycleHalvingView('down');
            dropdownToFocus = halvingViewSelect;
        } else if (active === priceOfSelect) {
            isUp ? cyclePriceOf('up') : cyclePriceOf('down');
            dropdownToFocus = priceOfSelect;
        } else if (active === uoaSelect) {
            isUp ? cycleUoaItem('up') : cycleUoaItem('down');
            dropdownToFocus = uoaSelect;
        } else if (active === uoaSortSelect) {
            const order = ['az', 'za', 'high', 'low'];
            const currentSort = getStoredUoaSort();
            const idx = order.indexOf(currentSort);
            const delta = isUp ? -1 : 1;
            const next = order[((idx === -1 ? 0 : idx) + delta + order.length) % order.length];
            setUoaSortMode(next);
            if (uoaSortSelect) uoaSortSelect.value = next;
            dropdownToFocus = uoaSortSelect;
        } else if (active === uoaShowSelect) {
            const order = UOA_SHOW_MODES;
            const currentMode = getStoredUoaShowMode();
            const idx = order.indexOf(currentMode);
            const delta = isUp ? -1 : 1;
            const next = order[((idx === -1 ? 0 : idx) + delta + order.length) % order.length];
            setUoaShowMode(next);
            if (uoaShowSelect) uoaShowSelect.value = next;
            dropdownToFocus = uoaShowSelect;
        } else if (active === pofSortSelect) {
            const order = ['az', 'za', 'high', 'low'];
            const currentSort = getStoredPofSort();
            const idx = order.indexOf(currentSort);
            const delta = isUp ? -1 : 1;
            const next = order[((idx === -1 ? 0 : idx) + delta + order.length) % order.length];
            setPofSortMode(next);
            if (pofSortSelect) pofSortSelect.value = next;
            dropdownToFocus = pofSortSelect;
        } else if (active === hashSelect) {
            isUp ? cycleHashLength('up') : cycleHashLength('down');
            dropdownToFocus = hashSelect;
        } else if (active === myrSelect) {
            isUp ? cycleMyrRange('up') : cycleMyrRange('down');
            dropdownToFocus = myrSelect;
        } else if (active === btcmapsSelect) {
            isUp ? cycleBtcmapsRegion('up') : cycleBtcmapsRegion('down');
            dropdownToFocus = btcmapsSelect;
        } else if (active === viewSelect) {
            isUp ? cycleBtcmapsView('up') : cycleBtcmapsView('down');
            dropdownToFocus = viewSelect;
        } else if (active === anchorSelect) {
            isUp ? cycleCycleAnchor('up') : cycleCycleAnchor('down');
            dropdownToFocus = anchorSelect;
        } else if (active === metricSelect) {
            isUp ? cycleDistMetric('up') : cycleDistMetric('down');
            dropdownToFocus = metricSelect;
        }
        if (!dropdownToFocus) {
            if (isBvgFile(currentFile)) {
                isUp ? cycleBvgYear('up') : cycleBvgYear('down');
                dropdownToFocus = yearSelect;
            } else if (isDalFile(currentFile)) {
                isUp ? cycleDalScale('up') : cycleDalScale('down');
                dropdownToFocus = scaleSelect;
            } else if (isPotdFile(currentFile)) {
                isUp ? cyclePotdScale('up') : cyclePotdScale('down');
                dropdownToFocus = scaleSelect;
            } else if (isNlbpFile(currentFile)) {
                isUp ? cycleNlbpScale('up') : cycleNlbpScale('down');
                dropdownToFocus = scaleSelect;
            } else if (isDominanceFile(currentFile)) {
                isUp ? cycleDominance('up') : cycleDominance('down');
                dropdownToFocus = dominanceSelect;
            } else if (isHalvingViewFile(currentFile)) {
                isUp ? cycleHalvingView('up') : cycleHalvingView('down');
                dropdownToFocus = halvingViewSelect;
            } else if (isPriceOfFile(currentFile)) {
                isUp ? cyclePriceOf('up') : cyclePriceOf('down');
                dropdownToFocus = priceOfSelect;
            } else if (isUoaFile(currentFile)) {
                isUp ? cycleUoaItem('up') : cycleUoaItem('down');
                dropdownToFocus = uoaSelect;
            } else if (isTargetHashFile(currentFile)) {
                isUp ? cycleHashLength('up') : cycleHashLength('down');
                dropdownToFocus = hashSelect;
            } else if (isBtcmapsFile(currentFile)) {
                isUp ? cycleBtcmapsRegion('up') : cycleBtcmapsRegion('down');
                dropdownToFocus = btcmapsSelect;
            } else if (isDistFile(currentFile)) {
                isUp ? cycleDistMetric('up') : cycleDistMetric('down');
                dropdownToFocus = metricSelect;
            } else if (isCycleAnchorFile(currentFile)) {
                isUp ? cycleCycleAnchor('up') : cycleCycleAnchor('down');
                dropdownToFocus = anchorSelect;
            } else if (isMyrFile(currentFile)) {
                isUp ? cycleMyrRange('up') : cycleMyrRange('down');
                dropdownToFocus = myrSelect;
            }
        }
        if (dropdownToFocus && typeof dropdownToFocus.focus === 'function') {
            requestAnimationFrame(() => dropdownToFocus.focus());
        }
    }
}, true);
document.addEventListener('keydown', e => {
    if (isBuyMeVisible) return;
    if (!(e.key === ' ' || e.code === 'Space')) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const active = document.activeElement;
    if (
        active &&
        (active.tagName === 'INPUT' ||
         active.tagName === 'TEXTAREA' ||
         active.tagName === 'SELECT' ||
         active.isContentEditable)
    ) {
        return;
    }
    if (modal.style.display === 'flex') return;
    if (typeof isSlideshowOpen === 'function' && isSlideshowOpen()) return;
    if (!visibleImages || !visibleImages.length) return;
    e.preventDefault();
    e.stopPropagation();
    let indexToOpen = 0;
    if (lastOpenedFilename) {
        const idx = visibleImages.findIndex(img => img.filename === lastOpenedFilename);
        if (idx !== -1) {
            indexToOpen = idx;
        }
    }
    openModalByIndex(indexToOpen);
});
document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (isBuyMeVisible) return;
    if (modal.style.display === 'flex') return;
    if (typeof isSlideshowOpen === 'function' && isSlideshowOpen()) return;
    const active = document.activeElement;
    if (!active || !active.classList.contains('grid-thumb')) return;
    const thumbs = Array.from(document.querySelectorAll('img.grid-thumb'));
    if (!thumbs.length) return;
    const currentIdx = thumbs.indexOf(active);
    if (currentIdx === -1) return;
    const delta = e.shiftKey ? -1 : 1;
    const nextIdx = currentIdx + delta;
    if (nextIdx < 0 || nextIdx >= thumbs.length) return;
    e.preventDefault();
    e.stopPropagation();
    const nextThumb = thumbs[nextIdx];
    if (nextThumb && typeof nextThumb.focus === 'function') {
        nextThumb.focus();
    }
});
function onOptionSStartSlideshow(e) {
    if (isBuyMeVisible) return;
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.code !== 'KeyS') return;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return;
    const slideshowOpen = !!slideshowEl && !slideshowEl.classList.contains('hidden');
    if (slideshowOpen) return;
    e.preventDefault();
    e.stopPropagation();
    kebabMenu?.classList.add('hidden');
    kebabBtn?.setAttribute('aria-expanded', 'false');
    if (modal && modal.style.display === 'flex') closeModal();
    if (startSlideshowBtn) startSlideshowBtn.click();
    else if (typeof openSlideshow === 'function') openSlideshow(0, true);
}
document.addEventListener('keydown', onOptionSStartSlideshow, true);
kebabBtn?.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = !kebabMenu.classList.contains('hidden');
    kebabMenu.classList.toggle('hidden', isOpen);
    const nowOpen = !isOpen;
    kebabBtn.setAttribute('aria-expanded', String(nowOpen));
    if (nowOpen) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                updateSlideDurationUI(false);
                refreshMenuTimeZoneSelect();
            });
        });
    }
});
function refreshMenuTimeZoneSelect() {
    const sel = document.getElementById('menuTimeZoneSelect');
    if (!sel || !window.WSBDashboardTime) return;
    const current = window.WSBDashboardTime.getPreferredTimeZone();
    const options = window.WSBDashboardTime.getTimeZoneOptions();
    sel.innerHTML = '';
    options.forEach(({ value, label }) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        if (value === current) opt.selected = true;
        sel.appendChild(opt);
    });
}

document.getElementById('menuTimeZoneSelect')?.addEventListener('change', e => {
    if (!window.WSBDashboardTime) return;
    window.WSBDashboardTime.setPreferredTimeZone(e.target.value);
});

window.addEventListener('storage', e => {
    if (!window.WSBDashboardTime) return;
    if (e.key !== window.WSBDashboardTime.STORAGE_KEY) return;
    const sel = document.getElementById('menuTimeZoneSelect');
    if (sel) sel.value = window.WSBDashboardTime.getPreferredTimeZone();
});

kebabMenu?.addEventListener('click', e => {
    const btn = e.target.closest('.menu-item');
    if (!btn) return;
    if (btn.classList.contains('slideshow-row') || btn.closest('.slideshow-row')) {
        e.stopPropagation();
        return;
    }
    if (btn.classList.contains('timezone-row') || btn.closest('.timezone-row')) {
        e.stopPropagation();
        return;
    }
    if (btn.classList.contains('menu-check')) {
        e.stopPropagation();
        if (btn.id === 'chkSearchTitles') toggleSearchPref('title');
        else if (btn.id === 'chkSearchDescriptions') toggleSearchPref('desc');
        return;
    }
    const action = btn.dataset.action;
    if (action === 'star-all') favoriteAll();
    else if (action === 'unstar-all') unfavoriteAll();
    kebabMenu.classList.add('hidden');
    kebabBtn.setAttribute('aria-expanded', 'false');
});
document.addEventListener('click', e => {
    if (!kebabMenu || kebabMenu.classList.contains('hidden')) return;
    if (e.target === kebabBtn || kebabBtn.contains(e.target)) return;
    if (kebabMenu.contains(e.target)) return;
    kebabMenu.classList.add('hidden');
    kebabBtn.setAttribute('aria-expanded', 'false');
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && kebabMenu && !kebabMenu.classList.contains('hidden')) {
        kebabMenu.classList.add('hidden');
        kebabBtn.setAttribute('aria-expanded', 'false');
    }
});
yearSelect?.addEventListener('change', e => setBvgYear(e.target.value));
scaleSelect?.addEventListener('change', e => {
    const currentFile = visibleImages[currentIndex]?.filename || '';
    if (isDalFile(currentFile)) setDalScale(e.target.value);
    else if (isPotdFile(currentFile)) setPotdScale(e.target.value);
    else if (isNlbpFile(currentFile)) setNlbpScale(e.target.value);
});
dominanceSelect?.addEventListener('change', e => setDominanceUnit(e.target.value));
priceOfSelect?.addEventListener('change', e => setPriceOfItem(e.target.value));
pofSortSelect?.addEventListener('change', e => setPofSortMode(e.target.value));

myrSelect?.addEventListener('change', e => setMyrRange(e.target.value));
halvingViewSelect?.addEventListener('change', e => setHalvingView(e.target.value));
uoaSelect?.addEventListener('change', e => setUoaItem(e.target.value));
uoaSortSelect?.addEventListener('change', e => setUoaSortMode(e.target.value));
hashSelect?.addEventListener('change', e => setHashLength(e.target.value));
uoaShowSelect?.addEventListener('change', e => setUoaShowMode(e.target.value));
metricSelect?.addEventListener('change', e => {
    setDistMetric(e.target.value, { title: visibleImages?.[currentIndex]?.title || '' });
});
anchorSelect?.addEventListener('change', e => {
  setCycleAnchor(e.target.value, { title: visibleImages?.[currentIndex]?.title || '' });
});
uoaIndexInput?.addEventListener('input', e => {
    const opts = getFilteredUoaOptions();
    if (!Array.isArray(opts) || opts.length === 0) return;
    let raw = e.target.value || '';
    raw = raw.replace(/\D+/g, '');
    if (raw === '') {
        e.target.value = '';
        return;
    }
    let n = parseInt(raw, 10);
    if (!Number.isFinite(n)) {
        e.target.value = '';
        return;
    }
    const total = opts.length;
    if (n < 1) n = 1;
    if (n > total) n = total;
    if (String(n) !== raw) {
        e.target.value = String(n);
    }
    const target = opts[n - 1];
    if (!target) return;
    if (uoaSelect) {
        uoaSelect.value = target.slug;
    }
    setUoaItem(target.slug);
});
uoaIndexInput?.addEventListener('blur', () => {
    const raw = (uoaIndexInput.value || '').trim();
    if (raw !== '') return;
    let currentSlug = null;
    if (uoaSelect && uoaSelect.value) {
        currentSlug = uoaSelect.value;
    } else {
        const image = visibleImages?.[currentIndex];
        if (image && isUoaFile(image.filename)) {
            currentSlug = uoaSlugFromFilename(image.filename);
        }
    }
    if (currentSlug) {
        updateUoaIndexUiBySlug(currentSlug);
    }
});
pofIndexInput?.addEventListener('input', e => {
    if (!Array.isArray(PRICE_OF_OPTIONS) || PRICE_OF_OPTIONS.length === 0) return;
    let raw = e.target.value || '';
    raw = raw.replace(/\D+/g, '');
    if (raw === '') {
        e.target.value = '';
        return;
    }
    let n = parseInt(raw, 10);
    if (!Number.isFinite(n)) {
        e.target.value = '';
        return;
    }
    const total = PRICE_OF_OPTIONS.length;
    if (n < 1) n = 1;
    if (n > total) n = total;
    if (String(n) !== raw) {
        e.target.value = String(n);
    }
    const target = PRICE_OF_OPTIONS[n - 1];
    if (!target) return;
    if (priceOfSelect) {
        priceOfSelect.value = target.slug;
    }
    setPriceOfItem(target.slug);
});
pofIndexInput?.addEventListener('blur', () => {
    const raw = (pofIndexInput.value || '').trim();
    if (raw !== '') return;
    let currentSlug = null;
    if (priceOfSelect && priceOfSelect.value) {
        currentSlug = priceOfSelect.value;
    } else {
        const image = visibleImages?.[currentIndex];
        if (image && isPriceOfFile(image.filename)) {
            currentSlug = pofSlugFromFilename(image.filename);
        }
    }
    if (currentSlug) {
        updatePofIndexUiBySlug(currentSlug);
    }
});
function toggleFavoritesView() {
    showFavoritesOnly = !showFavoritesOnly;
    localStorage.setItem('showFavoritesOnly', showFavoritesOnly);
    document.getElementById('favoritesToggle').classList.toggle('active', showFavoritesOnly);
    filterImages();
}
document.addEventListener('keydown', (e) => {
  if (modal?.style.display === 'flex') return;
  if (isSlideshowOpen && isSlideshowOpen()) return;
  if (isBuyMeVisible) return;
  const isActivate = (e.key === 'Enter' || e.key === ' ' || e.code === 'Space');
  if (!isActivate) return;
  const ae = document.activeElement;
  const img = (ae && ae.matches && ae.matches('img.grid-thumb'))
    ? ae
    : (ae && ae.closest ? ae.closest('img.grid-thumb') : null);
  if (!img) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const fname = img.dataset.filename;
  if (fname) openModalByFilename(fname);
}, true);

// YouTube overlay handlers - uses capture phase to intercept Escape before modal handler
const youtubeLink = document.getElementById('youtube-link');
const youtubeOverlay = document.getElementById('youtube-overlay');
const youtubeOverlayClose = document.getElementById('youtubeOverlayClose');

youtubeLink?.addEventListener('click', (e) => {
    // Prefer the explicit URL stored on the element; fall back to the extracted ID.
    const urlFromData = youtubeLink?.dataset?.youtube || '';
    const url = urlFromData || (currentYoutubeVideoId ? `https://www.youtube.com/watch?v=${currentYoutubeVideoId}` : '');
    if (!url) return; // nothing available — keep behavior no‑op

    e.preventDefault();
    e.stopPropagation();

    // Try to open the in-page overlay. If that doesn't actually show, fall
    // back to opening the YouTube page in a new tab so the user still reaches
    // the video on deployed sites where the overlay may be blocked or broken.
    try {
        openYoutubeOverlay();
    } catch (err) {
        console.warn('openYoutubeOverlay failed', err);
    }

    // If the overlay isn't visible after attempting to open it, open a new tab.
    try {
        const overlay = document.getElementById('youtube-overlay');
        const visible = overlay && !overlay.classList.contains('hidden');
        if (!visible) {
            window.open(url, '_blank', 'noopener');
        }
    } catch (_) {}
});

youtubeOverlayClose?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  closeYoutubeOverlay();
});

youtubeOverlay?.addEventListener('click', (e) => {
  if (e.target === youtubeOverlay) {
    closeYoutubeOverlay();
  }
});

