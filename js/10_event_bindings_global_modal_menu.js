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
document.getElementById('search-btn')?.addEventListener('click', e => {
    e.preventDefault();
    toggleSearch();
});
document.getElementById('search-btn')?.addEventListener('pointerdown', e => {
    e.preventDefault();
    toggleSearch();
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
buyMeBtn?.addEventListener('click', e => {
    e.preventDefault();
    if (modal && modal.style.display === 'flex') return;
    setDonateRouteUrl(true, { push: true });
    showThanksPopup({ fromRoute: false });
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
    if (active && active.closest && active.closest('.chart-container, img.grid-thumb')) return;
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
kebabBtn?.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = !kebabMenu.classList.contains('hidden');
    kebabMenu.classList.toggle('hidden', isOpen);
    const nowOpen = !isOpen;
    kebabBtn.setAttribute('aria-expanded', String(nowOpen));
    if (nowOpen) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
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

function resetDashboardsToDefaults() {
    const confirmed = window.confirm('Restore defaults for all dashboards? This will clear saved preferences and reload the page.');
    if (!confirmed) return;

    const keysToRemove = [
        'favorites',
        'searchTitles',
        'searchDescriptions',
        'preferredLayout',
        'showFavoritesOnly',
        'wicked_dashboard_timezone_v1',
        'quantum-research-dashboard-theme',
        'quantum-research-dashboard-filters-v1',
        'buyCoffeeMethod'
    ];
    const keyPrefixesToRemove = [
        'bip110_signaling_',
        'bitcoin_dominance_',
        'dca_cost_basis_',
        'node_count_'
    ];

    keysToRemove.forEach((key) => {
        try {
            localStorage.removeItem(key);
        } catch (_) {
            // Ignore storage errors.
        }
    });

    try {
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
            const key = localStorage.key(i);
            if (!key) continue;
            if (!keyPrefixesToRemove.some((prefix) => key.startsWith(prefix))) continue;
            localStorage.removeItem(key);
        }
    } catch (_) {
        // Ignore storage enumeration errors.
    }

    try {
        setCookie('pofItem', '', -1);
    } catch (_) {
        // Ignore cookie errors.
    }

    window.location.reload();
}

function isLocalWebappHost() {
    const host = String(window.location.hostname || '').toLowerCase();
    if (window.location.protocol === 'file:') return true;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}

function setPullLatestDataButtonVisibility() {
    if (!pullLatestDataBtn) return;
    const show = isLocalWebappHost();
    pullLatestDataBtn.classList.toggle('hidden', !show);
}

async function pullLatestDataFromOriginMain() {
    if (!isLocalWebappHost()) return;
    const confirmed = window.confirm(
        'Pull latest data from origin/main for local dashboards now? This can overwrite uncommitted local data-file changes.'
    );
    if (!confirmed) return;

    if (pullLatestDataBtn) {
        pullLatestDataBtn.disabled = true;
        pullLatestDataBtn.textContent = 'Pulling latest data...';
    }

    try {
        const base = getPageBasePath();
        const endpoint = `${base}/__pull_latest_data__`;
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store'
        });

        let payload = null;
        try {
            payload = await res.json();
        } catch (_) {
            payload = null;
        }

        if (!res.ok) {
            const msg = payload?.error || `Request failed (${res.status})`;
            throw new Error(msg);
        }

        const commit = String(payload?.commit || '').trim();
        const commitSuffix = commit ? ` (${commit})` : '';
        window.alert(`Latest dashboard data pulled from origin/main${commitSuffix}. The page will now reload.`);
        window.location.reload();
    } catch (err) {
        const message = String(err?.message || err || 'Unknown error');
        window.alert(
            'Could not pull latest data automatically. If you are using python -m http.server, run local_data_server.py instead and try again.\n\n' +
            `Details: ${message}`
        );
    } finally {
        if (pullLatestDataBtn) {
            pullLatestDataBtn.disabled = false;
            pullLatestDataBtn.textContent = 'Pull Latest Data';
        }
    }
}

setPullLatestDataButtonVisibility();

kebabMenu?.addEventListener('click', async e => {
    const btn = e.target.closest('.menu-item');
    if (!btn) return;
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
    else if (action === 'reset-dashboards') {
        kebabMenu.classList.add('hidden');
        kebabBtn.setAttribute('aria-expanded', 'false');
        resetDashboardsToDefaults();
        return;
    } else if (action === 'pull-latest-data') {
        kebabMenu.classList.add('hidden');
        kebabBtn.setAttribute('aria-expanded', 'false');
        await pullLatestDataFromOriginMain();
        return;
    }
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
function toggleFavoritesView() {
    showFavoritesOnly = !showFavoritesOnly;
    localStorage.setItem('showFavoritesOnly', showFavoritesOnly);
    document.getElementById('favoritesToggle').classList.toggle('active', showFavoritesOnly);
    filterImages();
}
document.addEventListener('keydown', (e) => {
  if (modal?.style.display === 'flex') return;
  if (isBuyMeVisible) return;
    const isActivate = (
        e.key === 'Enter'
        || e.key === ' '
        || e.key === 'Spacebar'
        || e.code === 'Space'
    );
  if (!isActivate) return;
  const ae = document.activeElement;
    const img = (ae && ae.matches && ae.matches('img.grid-thumb'))
        ? ae
        : (ae && ae.closest ? ae.closest('img.grid-thumb') : null);
    const card = (ae && ae.matches && ae.matches('.chart-container'))
        ? ae
        : (ae && ae.closest ? ae.closest('.chart-container') : null);
    if (!img && !card) return;
  e.preventDefault();
  e.stopImmediatePropagation();
    const fname = img?.dataset?.filename || card?.dataset?.filename;
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

function applyStandaloneFocusOrder() {
    if (!document.body || document.body.getAttribute('data-standalone-modal-shell') !== '1') return;

    const modalControls = document.querySelector('.modal-controls');
    const orderedFocusables = [];

    if (modalControls) {
        const controls = Array.from(modalControls.querySelectorAll('button.close-btn, a.close-btn'));
        controls.forEach((el) => orderedFocusables.push(el));
    }

    const buyCoffeeButton = document.getElementById('buyCoffeeBtn');
    const shellThemeButton = document.getElementById('shellThemeToggle');
    if (buyCoffeeButton) orderedFocusables.push(buyCoffeeButton);
    if (shellThemeButton) orderedFocusables.push(shellThemeButton);

    orderedFocusables.forEach((el, idx) => {
        if (!(el instanceof HTMLElement)) return;
        el.setAttribute('tabindex', String(idx + 1));
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyStandaloneFocusOrder, { once: true });
} else {
    applyStandaloneFocusOrder();
}

