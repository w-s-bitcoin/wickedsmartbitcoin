/* ===========================
 * MODAL OPEN/CLOSE & SWIPES
 * =========================== */
function updateModalSafePadding() {
    const controls = document.querySelector('.modal-controls');
    const isSmallLandscape = window.matchMedia('(max-width: 900px) and (orientation: landscape)').matches;
    const isEmbed = modalContentMode === 'embed';
    if (!controls || modal.style.display !== 'flex' || (!isSmallLandscape && !isEmbed)) {
        modal.style.removeProperty('--controls-offset');
        return;
    }
    const h = controls.getBoundingClientRect().height;
    const offset = Math.max(24, Math.ceil(h + 12));
    modal.style.setProperty('--controls-offset', offset + 'px');
}

function resumeDeferredGridLoadingIfNeeded() {
    if (typeof window.resumeDeferredGridLazyLoading === 'function') {
        window.resumeDeferredGridLazyLoading();
        return;
    }
    if (window.__deferGridLazyUntilModalSettled === true) {
        window.__deferGridLazyUntilModalSettled = false;
        try { initLazyImages(); } catch (_) {}
    }
}

function openModalByIndex(index) {
    const image = visibleImages[index];
    if (!image) return;
    if (!isStandaloneModalShell()) {
        window.location.href = getVisualizationUrl(image.filename);
        return;
    }
    // temporarily suspend the thumbnail observer so it doesn't fire off a
    // bunch of grid loads that could compete with the modal image request.
    if (io && io.disconnect) {
        io.disconnect();
        // we'll re‑initialise again when the modal closes (see closeModal)
    }
    closeYoutubeOverlay();
    const firstOpen = modal.style.display !== 'flex';
    currentIndex = index;
    lastOpenedFilename = image.filename || null;
    if (firstOpen) {
        const focusable = document.querySelectorAll(
            'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        nonModalFocusable = [];
        focusable.forEach(el => {
            if (!modal.contains(el)) {
                const prev = el.getAttribute('tabindex');
                nonModalFocusable.push({ el, prev });
                el.setAttribute('tabindex', '-1');
            }
        });
    }
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    isPinching = false;
    isPanning = false;
    gestureConsumed = false;
    currentScale = 1;
    pinchFocus = null;
    const fname = image.filename;
    modal.classList.remove('zoomed');
    modalImg.dataset.filename = fname;
    modalImg.alt = image.title || '';
    const modalType = String(image.modal_type || '').trim().toLowerCase();
    const fallbackEmbedPath = fname === 'bip110_signaling.png'
        ? '/webapps/bip110_signaling/dashboard.html'
        : (fname === 'node_count.png' ? '/webapps/node_count/dashboard.html' : '');
    const embedPath = String(image.embed_url || '').trim() || fallbackEmbedPath;
    const shouldEmbed = modalType === 'embed' || !!embedPath;
    const embedUrl = shouldEmbed ? modalEmbedSrc(embedPath) : '';
    const isEmbed = !!embedUrl;
    const isStandaloneDashboardEmbed = isEmbed && (
        fname === 'bip110_signaling.png' ||
        fname === 'node_count.png'
    );
    if (isEmbed) {
        modalContentMode = 'embed';
        hideModalSpinner();
        modal.classList.add('embed-active');
        if (modalEmbedWrap) modalEmbedWrap.hidden = false;
        if (modalEmbed) {
            if (window.__deferGridLazyUntilModalSettled === true) {
                const resumeOnce = () => resumeDeferredGridLoadingIfNeeded();
                modalEmbed.addEventListener('load', resumeOnce, { once: true });
                modalEmbed.addEventListener('error', resumeOnce, { once: true });
                // Safety net in case load events are suppressed/cached oddly.
                setTimeout(resumeDeferredGridLoadingIfNeeded, 1200);
            }
            if (modalEmbed.src !== embedUrl) modalEmbed.src = embedUrl;
            else if (window.__deferGridLazyUntilModalSettled === true) resumeDeferredGridLoadingIfNeeded();
        }
        modalImg.style.opacity = '0';
        modalImg.style.visibility = 'hidden';
        modalImg.style.transform = 'translate3d(-9999px,-9999px,0) scale(1)';
        if (modalDlBtn) {
            modalDlBtn.style.display = isStandaloneDashboardEmbed ? '' : 'none';
            if (isStandaloneDashboardEmbed) {
                modalDlBtn.disabled = true;
                modalDlBtn.classList.add('dashboard-download-disabled');
                modalDlBtn.setAttribute('aria-label', 'Download disabled');
                modalDlBtn.title = 'Download disabled';
            } else {
                modalDlBtn.disabled = false;
                modalDlBtn.classList.remove('dashboard-download-disabled');
                modalDlBtn.setAttribute('aria-label', 'Download image');
                modalDlBtn.title = 'Download image';
            }
        }
    } else {
        modalContentMode = 'image';
        modal.classList.remove('embed-active');
        if (modalEmbedWrap) modalEmbedWrap.hidden = true;
        if (modalEmbed) modalEmbed.src = 'about:blank';
        if (modalDlBtn) {
            modalDlBtn.style.display = '';
            modalDlBtn.disabled = false;
            modalDlBtn.classList.remove('dashboard-download-disabled');
            modalDlBtn.setAttribute('aria-label', 'Download image');
            modalDlBtn.title = 'Download image';
        }
        showModalSpinner();
        const token = ++modalImgLoadToken;
        modalImg.style.transition = '';
        modalImg.style.opacity = '0';
        modalImg.style.visibility = 'hidden';
        modalImg.style.transform = 'translate3d(-9999px,-9999px,0) scale(1)';
        void modalImg.offsetHeight;
        modalImg.style.transition = 'opacity 0.12s ease-out';
        modalImg.style.transformOrigin = '0 0';
        const nextUrl = imgSrc(fname);
        // preload so that the browser treats this as a high‑priority fetch
        try { preloadImage(nextUrl); } catch (_){ }
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
            resumeDeferredGridLoadingIfNeeded();
        };
        const fail = () => {
            if (token !== modalImgLoadToken) return;
            hideModalSpinner();
            modalImg.style.visibility = 'visible';
            modalImg.style.opacity = '1';
            resumeDeferredGridLoadingIfNeeded();
        };
        if (modalImg.src && modalImg.src.endsWith(nextUrl) && modalImg.complete && modalImg.naturalWidth) {
            done();
        } else {
            modalImg.addEventListener('load', done, { once: true });
            modalImg.addEventListener('error', fail, { once: true });
            modalImg.src = nextUrl;
        }
    }
    updateModalSafePadding();
    setTimeout(updateModalSafePadding, 0);
    document.body.style.overflow = 'hidden';
    setModalLinks({
        x: image.latest_x || '',
        nostr: image.latest_nostr || '',
        youtube: image.latest_youtube || ''
    });
    populateYearSelect();
    showYearControls(false);
    showScaleControls(false);
    showHashControls(false);
    showPriceOfControls(false);
    showDominanceControls(false);
    showMyrControls(false);
    showHalvingViewControls(false);
    showUoaControls(false);
    showBtcmapsControls(false);
    showMetricControls(false);
    showAnchorControls(false);
    if (isBvgFile(fname)) {
        showYearControls(true);
        const chosenYear = extractBvgYear(fname) || getStoredBvgYear();
        yearSelect.value = chosenYear;
        setBvgYear(chosenYear);
    } else if (isBtcmapsFile(fname)) {
        showBtcmapsControls(true);
        populateBtcmapsSelect();
        const parsed = btcmapsRegionAndViewFromFilename(fname);
        let chosenRegion =
            parsed.region ||
            getStoredBtcmapsRegion() ||
            BTCMAP_OPTIONS[0]?.slug ||
            "global";
        if (chosenRegion && !BTCMAP_OPTIONS.some(o => o.slug === chosenRegion)) {
            chosenRegion = BTCMAP_OPTIONS[0]?.slug || "global";
        }
        if (btcmapsSelect) btcmapsSelect.value = chosenRegion;
        populateBtcmapsViewSelect(chosenRegion);
        let chosenView =
            parsed.view ||
            getStoredBtcmapsView(chosenRegion) ||
            "total";
        chosenView = setStoredBtcmapsView(chosenRegion, chosenView);
        if (viewSelect) viewSelect.value = chosenView;
        setBtcmapsRegionAndView(chosenRegion, chosenView);
    } else if (isDominanceFile(fname)) {
        showDominanceControls(true);
        const unit = domUnitFromFilename(fname) || getStoredDominanceUnit();
        dominanceSelect.value = unit;
        setDominanceUnit(unit);
    } else if (isDalFile(fname)) {
        showScaleControls(true);
        const sc = dalScaleFromFilename(fname) || getStoredDalScale();
        scaleSelect.value = sc;
        setDalScale(sc);
    } else if (isPotdFile(fname)) {
        showScaleControls(true);
        const sc = potdScaleFromFilename(fname) || getStoredPotdScale();
        scaleSelect.value = sc;
        setPotdScale(sc);
    } else if (isNlbpFile(fname)) {
        showScaleControls(true);
        const sc = nlbpScaleFromFilename(fname) || getStoredNlbpScale();
        scaleSelect.value = sc;
        setNlbpScale(sc);
    } else if (isHalvingViewFile(fname)) {
        showHalvingViewControls(true);
        populateHalvingViewSelect();

        const view =
        halvingViewFromFilename(fname) ||
        getStoredHalvingView();

        if (halvingViewSelect) halvingViewSelect.value = view;
        setHalvingView(view);
    } else if (isPriceOfFile(fname)) {
        showPriceOfControls(true);
        sortPriceOfOptions(getStoredPofSort());
        if (pofSortSelect) {
            pofSortSelect.value = getStoredPofSort();
        }
        let chosenSlug = pofSlugFromFilename(fname) || getStoredPofItem();
        if (!PRICE_OF_OPTIONS.some(o => o.slug === chosenSlug)) {
            chosenSlug =
                PRICE_OF_OPTIONS.find(o => o.slug === 'ground_beef')?.slug ||
                PRICE_OF_OPTIONS[0]?.slug;
        }
        priceOfSelect.value = chosenSlug;
        const meta = PRICE_OF_META[chosenSlug];
        if (meta) applyPostLinksFromMeta(meta);
        setPriceOfItem(chosenSlug);
        updatePofIndexUiBySlug(chosenSlug);
    } else if (isUoaFile(fname)) {
        showUoaControls(true);
        sortUoaOptions(getStoredUoaSort());
        populateUoaSelect();
        let chosenSlug = uoaSlugFromFilename(fname) || getStoredUoaItem();
        if (!UOA_OPTIONS.some(o => o.slug === chosenSlug)) {
            chosenSlug = UOA_OPTIONS[0]?.slug || chosenSlug;
        }
        if (uoaSelect) uoaSelect.value = chosenSlug;
        if (uoaSortSelect) {
            uoaSortSelect.value = getStoredUoaSort();
        }
        if (uoaShowSelect) {
            uoaShowSelect.value = getStoredUoaShowMode();
        }
        setUoaItem(chosenSlug);
    } else if (isTargetHashFile(fname)) {
        showHashControls(true);
        const len = hashLengthFromFilename(fname);
        if (hashSelect) hashSelect.value = len;
        setHashLength(len);
    } else if (isMyrFile(fname)) {
        showMyrControls(true);
        populateMyrSelect();
        const chosenRange = myrRangeFromFilename(fname) || MYR_DEFAULT_RANGE;
        myrSelect.value = chosenRange;
        setMyrRange(chosenRange);
    } else if (isDistFile(fname)) {
        showMetricControls(true);
        const metric =
            distMetricFromFilename(fname) ||
            getStoredDistMetric();
        if (metricSelect) metricSelect.value = metric;
        setDistMetric(metric, { title: image.title });
    } else if (isCycleAnchorFile(fname)) {
        showAnchorControls(true);
        const anchor =
            cycleAnchorFromFilename(fname) ||
            getStoredCycleAnchor();
        if (anchorSelect) anchorSelect.value = anchor;
        setCycleAnchor(anchor, { title: image.title });

    } else {
        if (modalContentMode === 'embed') {
            replaceUrlForFilename(fname);
        } else {
            setModalImageAndCenter(fname, image.title);
            replaceUrlForFilename(fname);
        }
    }
    const fav = isFavorite(visibleImages[currentIndex].filename);
    modalFavBtn.textContent = fav ? '★' : '☆';
    modalFavBtn.classList.toggle('filled', fav);
    requestAnimationFrame(() => {
        const active = document.activeElement;
        const focusIsInsideModal = !!(active && modal.contains(active));
        if (!firstOpen && focusIsInsideModal) return;
        const focusableButtons = Array.from(
            modal.querySelectorAll('button, [role="button"], [data-modal-close]')
        );
        let closeBtn = focusableButtons.find(btn => {
            if (!modal.contains(btn)) return false;
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            const text = (btn.textContent || '').toLowerCase().trim();
            return (
                ariaLabel.includes('close') ||
                text === '×' ||
                text === 'x' ||
                text.includes('close')
            );
        });
        if (closeBtn && typeof closeBtn.focus === 'function') {
            closeBtn.focus();
        } else if (modalFavBtn && typeof modalFavBtn.focus === 'function') {
            modalFavBtn.focus();
        }
    });
}
function closeModal() {
    closeYoutubeOverlay();
    modal.style.display = 'none';
    modalContentMode = 'image';
    modal.classList.remove('embed-active');
    if (modalEmbedWrap) modalEmbedWrap.hidden = true;
    if (modalEmbed) modalEmbed.src = 'about:blank';
    resumeDeferredGridLoadingIfNeeded();
    if (modalDlBtn) modalDlBtn.style.display = '';
    document.body.classList.remove('modal-open');
    // restart lazy loading so thumbnails continue to fetch when user returns
    try { initLazyImages(); } catch (_) {}
    if (isStandaloneModalShell()) {
        const home = `${getPageBasePath() || ''}/`.replace(/\/{2,}/g, '/');
        window.location.href = home;
        return;
    }
    if (location.hostname === 'localhost') {
        location.hash = '';
    } else {
        history.replaceState(null, '', getPageBasePath() || '/');
    }
    document.body.style.overflow = '';
    nonModalFocusable.forEach(({ el, prev }) => {
        if (prev === null) el.removeAttribute('tabindex');
        else el.setAttribute('tabindex', prev);
    });
    nonModalFocusable = [];
    if (justUnstarredInModal) {
        justUnstarredInModal = false;
        filterImages();
    }
    showYearControls(false);
    showScaleControls(false);
    showHashControls(false);
    showPriceOfControls(false);
    showMyrControls(false);
    showDominanceControls(false);
    showHalvingViewControls(false);
    showMetricControls(false);
    showAnchorControls(false);
    try {
        const cur = visibleImages[currentIndex];
        if (cur && isMyrFile(cur.filename) && cur.filename !== `${MYR_BASE}.png`) {
            const defaultFile = `${MYR_BASE}.png`;
            cur.filename = defaultFile;
            updateGridThumbAtCurrent(defaultFile);
        }
    } catch (_) {}
    if (tempNonFavInjected) {
        tempNonFavInjected = false;
        filterImages();
    }
    isPinching = false;
    isPanning = false;
    gestureConsumed = false;
    currentScale = 1;
    translateX = 0;
    translateY = 0;
    pinchFocus = null;
    modalImg.style.opacity = '1';
    modalImg.style.visibility = 'visible';
    modalImg.style.transform = '';
    modalImg.style.transformOrigin = '';
    modal.classList.remove('zoomed');
    modal.style.removeProperty('--controls-offset');
    try {
        const last =
            (modalImg && modalImg.dataset && modalImg.dataset.filename) ||
            (visibleImages && visibleImages[currentIndex] && visibleImages[currentIndex].filename) ||
            lastOpenedFilename;
        const lastTitle =
            (visibleImages && visibleImages[currentIndex] && visibleImages[currentIndex].title) ||
            "";
        if (last) {
        updateGridThumbAtCurrent(last, lastTitle);

        // If distribution, also refresh the title/description text in the grid card
        if (isDistFile(last)) {
            const meta = getMetaForFilename(last);
            const oldKey = lastOpenedFilename || last; // safe fallback
            updateGridCardAtCurrent({
            oldFilename: oldKey,
            newFilename: last,
            title: meta?.title || lastTitle || "",
            description: meta?.description || ""
            });
        }
        }
    } catch (_) {}
    if (typeof currentIndex === 'number' && currentIndex >= 0) {
        const thumb = document.querySelector(`img.grid-thumb[data-grid-index="${currentIndex}"]`);
        if (thumb && typeof thumb.focus === 'function') {
            requestAnimationFrame(() => thumb.focus());
        }
    }
}
function handleSwipe() {
    if (isPinching || currentScale > 1.001 || modal.classList.contains('zoomed')) return;
    const swipeDistance = touchEndX - touchStartX;
    const minSwipe = 50;
    if (Math.abs(swipeDistance) > minSwipe) {
        if (swipeDistance < 0) nextImage();
        else prevImage();
    }
}
function handleVerticalSwipe() {
    if (isPinching || currentScale > 1.001 || modal.classList.contains('zoomed')) return;
    const deltaY = touchEndY - touchStartY;
    const threshold = 50;
    const controls = document.querySelector('.modal-controls');
    if (Math.abs(deltaY) > threshold) {
        if (deltaY < 0) controls.classList.add('hidden');
        else controls.classList.remove('hidden');
    }
}
modalImg.addEventListener(
    'touchstart',
    e => {
        if (e.touches.length === 2) {
            isPinching = true;
            gestureConsumed = true;
            modal.classList.add('zoomed');
            startPinchDistance = distance(e.touches);
            startScale = currentScale;
            const {x, y} = midpoint(e.touches);
            const {ox, oy} = getContainerOrigin();
            const focusUx = (x - ox - translateX) / startScale;
            const focusUy = (y - oy - translateY) / startScale;
            pinchFocus = {focusUx, focusUy};
        } else if (e.touches.length === 1) {
            singleTapMoved = false;
            modalImg.style.transition = '';
            if (currentScale > 1) {
                isPanning = true;
                gestureConsumed = true;
                panStartX = e.touches[0].clientX - translateX;
                panStartY = e.touches[0].clientY - translateY;
            }
        }
    },
    {passive: false}
);
modalImg.addEventListener(
    'touchmove',
    e => {
        if (isPinching && e.touches.length === 2) {
            e.preventDefault();
            const s = startScale * (distance(e.touches) / startPinchDistance);
            currentScale = clamp(s, MIN_SCALE, MAX_SCALE);
            const {x, y} = midpoint(e.touches);
            const {ox, oy} = getContainerOrigin();
            if (pinchFocus) {
                const {focusUx, focusUy} = pinchFocus;
                translateX = x - ox - focusUx * currentScale;
                translateY = y - oy - focusUy * currentScale;
                if (currentScale === MIN_SCALE) {
                    translateX = x - ox - focusUx * MIN_SCALE;
                    translateY = y - oy - focusUy * MIN_SCALE;
                }
            }
            clampPanToBounds();
            applyTransform();
        } else if (isPanning && e.touches.length === 1 && currentScale > 1) {
            e.preventDefault();
            const cx = e.touches[0].clientX,
                cy = e.touches[0].clientY;
            translateX = cx - panStartX;
            translateY = cy - panStartY;
            clampPanToBounds();
            applyTransform();
        } else if (e.touches.length === 1 && currentScale <= 1.001) {
            const dx = Math.abs(e.touches[0].clientX - (lastTapX || e.touches[0].clientX));
            const dy = Math.abs(e.touches[0].clientY - (lastTapY || e.touches[0].clientY));
            if (dx > MAX_TAP_MOVE_PX || dy > MAX_TAP_MOVE_PX) singleTapMoved = true;
        }
    },
    {passive: false}
);
modalImg.addEventListener('touchend', e => {
    if (isPinching && e.touches.length === 1) {
        isPinching = false;
        pinchFocus = null;
        if (currentScale > 1) {
            const t = e.touches[0];
            panStartX = t.clientX - translateX;
            panStartY = t.clientY - translateY;
            isPanning = true;
            gestureConsumed = true;
        } else {
            isPanning = false;
        }
        return;
    }
    if (e.touches.length === 0) {
        const now = Date.now();
        const t = e.changedTouches[0];
        const dt = now - lastTapTime;
        const closeToLast = Math.abs(t.clientX - lastTapX) < 12 && Math.abs(t.clientY - lastTapY) < 12;
        if (!singleTapMoved && dt > 0 && dt <= DOUBLE_TAP_DELAY && closeToLast) {
            gestureConsumed = true;
            modalImg.style.transition = '';
            if (currentScale <= 1.001) {
                zoomToPoint(3, t.clientX, t.clientY);
            } else {
                resetZoomAndCenterAnimated();
            }
            lastTapTime = 0;
            lastTapX = lastTapY = 0;
            return;
        }
        lastTapTime = now;
        lastTapX = t.clientX;
        lastTapY = t.clientY;
        isPinching = false;
        isPanning = false;
        pinchFocus = null;
        if (currentScale <= 1.001) {
            currentScale = 1;
            modal.classList.remove('zoomed');
            centerImageAtScale1();
        }
        setTimeout(() => {
            gestureConsumed = false;
        }, 0);
    }
});
let lastDownTime = 0;
let lastDownX = 0;
let lastDownY = 0;
modalImg.addEventListener(
    'pointerdown',
    e => {
        if (e.pointerType !== 'mouse') return;
        modalImg.style.transition = '';
        const now = Date.now();
        const x = e.clientX,
            y = e.clientY;
        const dt = now - lastDownTime;
        const closeToLast = Math.abs(x - lastDownX) <= 12 && Math.abs(y - lastDownY) <= 12;
        if (dt > 0 && dt <= DOUBLE_TAP_DELAY && closeToLast) {
            e.preventDefault();
            e.stopPropagation();
            gestureConsumed = true;
            if (currentScale <= 1.001) {
                zoomToPoint(3, x, y);
            } else {
                resetZoomAndCenterAnimated();
            }
            lastDownTime = 0;
            lastDownX = 0;
            lastDownY = 0;
            return;
        }
        lastDownTime = now;
        lastDownX = x;
        lastDownY = y;
    },
    {passive: false}
);
modalImg.addEventListener('mousedown', e => {
    if (e.button !== 0 || currentScale <= 1.001) return;
    e.preventDefault();
    gestureConsumed = true;
    isMousePanning = true;
    mouseHadMoved = false;
    panStartX = e.clientX - translateX;
    panStartY = e.clientY - translateY;
    modalImg.style.cursor = 'grabbing';
    modal.classList.add('zoomed');
});
window.addEventListener('mousemove', e => {
    if (!isMousePanning) return;
    const nx = e.clientX - panStartX;
    const ny = e.clientY - panStartY;
    if (Math.abs(nx - translateX) > 0.5 || Math.abs(ny - translateY) > 0.5) {
        mouseHadMoved = true;
    }
    translateX = nx;
    translateY = ny;
    clampPanToBounds();
    applyTransform();
});
function endMousePan() {
    if (!isMousePanning) return;
    isMousePanning = false;
    modalImg.style.cursor = '';
    setTimeout(() => {
        gestureConsumed = false;
    }, 0);
}
window.addEventListener('mouseup', endMousePan);
window.addEventListener('mouseleave', endMousePan);
modalImg.addEventListener(
    'click',
    e => {
        if (mouseHadMoved) {
            e.preventDefault();
            e.stopPropagation();
        }
        mouseHadMoved = false;
    },
    true
);
modalImg.addEventListener('touchcancel', () => {
    isPinching = false;
    isPanning = false;
    pinchFocus = null;
    if (currentScale <= 1.001) {
        currentScale = 1;
        modal.classList.remove('zoomed');
        centerImageAtScale1();
    }
    gestureConsumed = false;
});
modalImg.addEventListener('dragstart', e => e.preventDefault());
function prevImage() {
    if (justUnstarredInModal) {
        justUnstarredInModal = false;
        filterImages();
    }
    const prevIndex = (currentIndex - 1 + visibleImages.length) % visibleImages.length;
    openModalByIndex(prevIndex);
}
function nextImage() {
    if (justUnstarredInModal) {
        justUnstarredInModal = false;
        filterImages();
    }
    const nextIndex = (currentIndex + 1) % visibleImages.length;
    openModalByIndex(nextIndex);
}
function toggleFavoriteFromModal() {
    const filename = visibleImages[currentIndex].filename;
    const favKey = filename.startsWith(POF_BASE) ? POF_FAV_KEY : filename;
    let favs = getFavorites();
    const index = favs.indexOf(favKey);
    const gridStar = document.querySelector(`.favorite-star[data-filename="${favKey}"]`);
    if (index !== -1) {
        favs.splice(index, 1);
        modalFavBtn.textContent = '☆';
        modalFavBtn.classList.remove('filled');
        if (gridStar) {
            gridStar.textContent = '☆';
            gridStar.classList.remove('filled');
        }
    } else {
        if (favKey === POF_FAV_KEY) favs = favs.filter(f => !/^price_of_/.test(f));
        favs.push(favKey);
        modalFavBtn.textContent = '★';
        modalFavBtn.classList.add('filled');
        if (gridStar) {
            gridStar.textContent = '★';
            gridStar.classList.add('filled');
        }
    }
    saveFavorites(favs);
    if (showFavoritesOnly && index !== -1) justUnstarredInModal = true;
}