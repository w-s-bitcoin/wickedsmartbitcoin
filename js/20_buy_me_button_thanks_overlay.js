/* ===========================
 * BUY ME: BUTTON + THANKS OVERLAY
 * =========================== */
const DONATION_LIGHTNING = 'wicked@getalby.com';
const DONATION_LIQUID = 'VJLDEF7n8TBjyJY2BaAgeVvzPSRMJ7VAP5opW9mB5A7ChyiKHnaguTugZNznxNiV2ZDyPxJyQoeZ2KhM';
const DONATION_ONCHAIN = 'bc1q8mql8fucypd3dllkawqafytmrnwtv77gzxy346';
const DASHBOARD_TZ_STORAGE_KEY = 'wicked_dashboard_timezone_v1';
const DASHBOARD_TZ_CHANGE_EVENT = 'wsb:timezonechange';
function getSelectedDashboardTimeZone() {
    const api = window.WSBDashboardTime;
    if (api && typeof api.getPreferredTimeZone === 'function') {
        return api.getPreferredTimeZone();
    }
    try {
        const raw = String(localStorage.getItem(DASHBOARD_TZ_STORAGE_KEY) || '').trim();
        if (!raw) return 'UTC';
        Intl.DateTimeFormat('en-US', { timeZone: raw }).format(new Date());
        return raw;
    } catch (_) {
        return 'UTC';
    }
}
function getHourInTimeZone(timeZone, now = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour: '2-digit',
            hour12: false
        }).formatToParts(now);
        const hourPart = parts.find(p => p.type === 'hour');
        const hour = Number(hourPart?.value);
        if (Number.isFinite(hour)) return hour;
    } catch (_) {}
    return now.getHours();
}
function isBeerTime() {
    const now = new Date();
    const hour = getHourInTimeZone(getSelectedDashboardTimeZone(), now);
    return hour >= 17 || hour < 3;
}
function onThanksKeydown(e) {
    if (e.key === 'Escape') {
        hideThanksPopup();
    }
}
function hideThanksPopup({ fromRoute = false } = {}) {
    if (!thanksOverlay) return;
    const toast = thanksOverlay.querySelector('.thanks-toast');
    if (toast) toast.style.opacity = '0';
    thanksOverlay.style.display = 'none';
    if (thanksOverlay.parentNode) {
        thanksOverlay.parentNode.removeChild(thanksOverlay);
    }
    document.removeEventListener('keydown', onThanksKeydown);
    if (thanksToastTimeout) {
        clearTimeout(thanksToastTimeout);
        thanksToastTimeout = null;
    }
    isBuyMeVisible = false;
    if (!fromRoute && !(modal && modal.style.display === 'flex') && isDonateRouteActive()) {
        setDonateRouteUrl(false, { push: true });
    }
}
async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        console.log('Copied to clipboard:', text);
    } catch (err) {
        console.error('Failed to copy to clipboard', err);
    }
}
function showThanksToast(message) {
    if (!thanksOverlay) return;
    let toast = thanksOverlay.querySelector('.thanks-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'thanks-toast';
        Object.assign(toast.style, {
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '0.5rem 1rem',
            fontSize: '0.9rem',
            borderRadius: '999px',
            background: 'rgba(0, 0, 0, 0.85)',
            color: '#fff',
            pointerEvents: 'none',
            opacity: '0',
            transition: 'opacity 0.2s ease-out',
            zIndex: '20'
        });
        thanksOverlay.appendChild(toast);
    }
    toast.innerHTML = message;
    toast.style.opacity = '1';
    if (thanksToastTimeout) clearTimeout(thanksToastTimeout);
    thanksToastTimeout = setTimeout(() => {
        toast.style.opacity = '0';
    }, 2000);
}
function thanksImagePath({ beerMode, isPortrait, method }) {
    const drink = beerMode ? 'beer' : 'coffee';
    const orient = isPortrait ? 'portrait' : 'landscape';
    const m = normalizeBuyCoffeeMethod(method);
    return `assets/thanks_for_the_${drink}_${orient}_${m}.png`;
}
function updateThanksOverlayImageForMethod(method) {
    if (!thanksOverlay) return;
    const beerMode = isBeerTime();
    const isPortrait = window.innerHeight >= window.innerWidth;
    const imgEl = thanksOverlay.querySelector('#thanks-overlay-img');
    if (!imgEl) return;

    setThanksOverlayLoading(true);
    imgEl.src = thanksImagePath({ beerMode, isPortrait, method });

    // Cached fast-path
    if (imgEl.complete && imgEl.naturalWidth > 0) {
        setThanksOverlayLoading(false);
        positionThanksMethodButtonsForOrientation();
    }
}

function getDonationTextForMethod(method) {
  const m = normalizeBuyCoffeeMethod(method);
  if (m === 'lightning') return DONATION_LIGHTNING;
  if (m === 'liquid') return DONATION_LIQUID;
  if (m === 'onchain') return DONATION_ONCHAIN;
  return DONATION_LIGHTNING;
}
function getDonationToastForMethod(method) {
  const m = normalizeBuyCoffeeMethod(method);
  if (m === 'lightning') return 'Lightning address<br>copied to clipboard';
  if (m === 'liquid') return 'Liquid address<br>copied to clipboard';
  if (m === 'onchain') return 'On-chain address<br>copied to clipboard';
  return 'Copied to clipboard';
}
function positionThanksMethodButtonsForOrientation() {
    if (!thanksOverlay) return;
    const container = thanksOverlay.querySelector('#thanks-overlay img')?.parentElement;
    if (!container) return;
    const buttonContainer = container.querySelector('.buy-coffee-methods');
    if (!buttonContainer) return;
    const isPortrait = window.innerHeight >= window.innerWidth;
    Object.assign(buttonContainer.style, {
        position: 'absolute',
        left: '0',
        bottom: '20px',
        top: 'auto',
        width: '50%',
        maxWidth: '',
        display: 'flex',
        justifyContent: 'center',
        alignItems: '',
        flexWrap: '',
        gap: '',
        transform: '',
        zIndex: '10'
    });
    if (isPortrait) {
        Object.assign(buttonContainer.style, {
            left: '50%',
            top: '50%',
            bottom: 'auto',
            width: 'auto',
            maxWidth: '92%',
            alignItems: 'center',
            flexWrap: 'nowrap',
            whiteSpace: 'nowrap',
            gap: 'clamp(6px, 1.5vw, 12px)',
            transform: 'translate(-50%, calc(-100% - clamp(8px, 2vh, 18px)))'
        });
    }
}
function setThanksOverlayLoading(isLoading) {
    if (!thanksOverlay) return;

    const spinner = thanksOverlay.querySelector('#thanks-overlay-spinner');
    const btnsWrap = thanksOverlay.querySelector('.buy-coffee-methods');
    const closeBtn = thanksOverlay.querySelector('#thanks-overlay-close');

    if (spinner) spinner.style.display = isLoading ? 'flex' : 'none';

    // Only hide controls during the *initial* image load
    const hideControls = isLoading && !hasThanksOverlayEverLoaded;

    if (btnsWrap) btnsWrap.style.visibility = hideControls ? 'hidden' : 'visible';
    if (closeBtn) closeBtn.style.visibility = hideControls ? 'hidden' : 'visible';

    // After first load, keep controls clickable even while loading next image
    if (btnsWrap) btnsWrap.style.pointerEvents = hideControls ? 'none' : 'auto';
    if (closeBtn) closeBtn.style.pointerEvents = hideControls ? 'none' : 'auto';
}

function handleThanksOverlayResize() {
    if (!isBuyMeVisible || !thanksOverlay) return;
    const method = getStoredBuyCoffeeMethod();
    updateThanksOverlayImageForMethod(method);
    positionThanksMethodButtonsForOrientation();
}
function showThanksPopup({ fromRoute = false } = {}) {
    preloadThanksImagesIfNeeded(true);
    const beerMode = isBeerTime();
    const isPortrait = window.innerHeight >= window.innerWidth;
    const method = getStoredBuyCoffeeMethod();
    const imgSrc = thanksImagePath({ beerMode, isPortrait, method });
    if (!thanksOverlay) {
        thanksOverlay = document.createElement('div');
        thanksOverlay.id = 'thanks-overlay';
        Object.assign(thanksOverlay.style, {
            position: 'fixed',
            top: '0', left: '0', right: '0', bottom: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '10001',
            cursor: 'default',
            background: 'rgba(0, 0, 0, 0.9)',
            padding: 'max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left))'
        });
        const container = document.createElement('div');
        Object.assign(container.style, {
            position: 'relative',
            display: 'inline-block',
            cursor: 'pointer',
            maxWidth: '90vw',
        });

        const img = document.createElement('img');
        img.id = 'thanks-overlay-img';

        // Spinner overlay (centered)
        const spinner = document.createElement('div');
        spinner.id = 'thanks-overlay-spinner';
        spinner.setAttribute('aria-label', 'Loading');
        spinner.setAttribute('role', 'status');
        Object.assign(spinner.style, {
            position: 'absolute',
            inset: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: '15'
        });

        // The spinning wheel itself
        const wheel = document.createElement('div');
        Object.assign(wheel.style, {
            width: '44px',
            height: '44px',
            borderRadius: '999px',
            border: '4px solid rgba(255,255,255,0.25)',
            borderTopColor: 'rgba(255,255,255,0.95)',
            animation: 'thanksSpin 0.9s linear infinite',
            filter: 'drop-shadow(0 0 10px rgba(0,0,0,0.8))'
        });
        spinner.appendChild(wheel);

        // Inject keyframes once
        if (!document.getElementById('thanks-spinner-style')) {
            const style = document.createElement('style');
            style.id = 'thanks-spinner-style';
            style.textContent = `
                @keyframes thanksSpin { to { transform: rotate(360deg); } }
            `;
            document.head.appendChild(style);
        }

        // Show spinner until the image loads
        img.addEventListener('load', () => {
            if (!hasThanksOverlayEverLoaded) hasThanksOverlayEverLoaded = true;
            setThanksOverlayLoading(false);
            positionThanksMethodButtonsForOrientation();
        });
        img.addEventListener('error', () => {
            // Hide spinner so user isn't stuck; still show controls so they can close
            setThanksOverlayLoading(false);
        });

        async function copyActiveDonationToClipboard() {
        const active = getStoredBuyCoffeeMethod();
        const text = getDonationTextForMethod(active);
        await copyToClipboard(text);
        showThanksToast(getDonationToastForMethod(active));
        }
        img.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await copyActiveDonationToClipboard();
        });
        img.addEventListener('keydown', async (e) => {
        if (!(e.key === 'Enter' || e.key === ' ' || e.code === 'Space')) return;
        e.preventDefault();
        e.stopPropagation();
        await copyActiveDonationToClipboard();
        });
        img.alt = 'Thanks!';
        img.style.maxWidth = '90vw';
        img.style.maxHeight = '90vh';
        img.style.boxShadow = '0 0 20px rgba(0,0,0,0.8)';
        img.style.borderRadius = '8px';
        img.style.display = 'block';
        img.tabIndex = 0;
        const closeBtn = document.createElement('button');
        closeBtn.id = 'thanks-overlay-close';
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        closeBtn.classList.add('buy-coffee-close');
        closeBtn.setAttribute('aria-label', 'Close');
        Object.assign(closeBtn.style, {
            position: 'absolute',
            top: '8px',
            left: '8px'
        });
        buyCoffeeCloseBtn = closeBtn;
        closeBtn.addEventListener('click', e => {
            e.stopPropagation();
            e.preventDefault();
            hideThanksPopup({ fromRoute: false });
        });
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'buy-coffee-methods';
        const overlayMethodBtns = [];
        function setActiveOverlayBuyCoffeeMethod(methodRaw) {
            const norm = setStoredBuyCoffeeMethod(methodRaw);
            overlayMethodBtns.forEach(b => {
                const isOn = b.dataset.method === norm;
                b.classList.toggle('active', isOn);
                b.setAttribute('aria-pressed', String(isOn));
            });
            return norm;
        }
        Object.assign(buttonContainer.style, {
            position: 'absolute',
            left: '0',
            bottom: '20px',
            width: '50%',
            display: 'flex',
            justifyContent: 'center',
            zIndex: '10'
        });
        function makeMethodBtn(label, methodRaw) {
            const method = normalizeBuyCoffeeMethod(methodRaw);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'buy-coffee-method-btn';
            btn.textContent = label;
            btn.dataset.method = method;
            btn.setAttribute('aria-pressed', 'false');
            btn.addEventListener('click', e => {
                e.stopPropagation();
                e.preventDefault();
                const active = setActiveOverlayBuyCoffeeMethod(method);
                updateThanksOverlayImageForMethod(active);
            });
            btn.addEventListener('keydown', e => {
                if (!(e.key === 'Enter' || e.key === ' ' || e.code === 'Space')) return;
                e.preventDefault();
                e.stopPropagation();
                btn.click();
            });
            return btn;
        }
        const lightningButton = makeMethodBtn('Lightning', 'lightning');
        const liquidButton    = makeMethodBtn('Liquid', 'liquid');
        const onChainButton   = makeMethodBtn('On-chain', 'onchain');
        overlayMethodBtns.push(lightningButton, liquidButton, onChainButton);
        const initialMethod = getStoredBuyCoffeeMethod();
        setActiveOverlayBuyCoffeeMethod(initialMethod);
        updateThanksOverlayImageForMethod(initialMethod);
        buttonContainer.appendChild(lightningButton);
        buttonContainer.appendChild(liquidButton);
        buttonContainer.appendChild(onChainButton);
        container.appendChild(img);
        container.appendChild(spinner);
        container.appendChild(buttonContainer);
        container.appendChild(closeBtn);
        thanksOverlay.appendChild(container);
        thanksOverlay.addEventListener('click', e => {
            if (e.target === thanksOverlay) {
                hideThanksPopup({ fromRoute: false });
            }
        });
        thanksOverlay.addEventListener('keydown', e => {
            if (!isBuyMeVisible) return;
            if (e.key !== 'Tab') return;
            const closeEl = thanksOverlay.querySelector('#thanks-overlay-close');
            const imgEl = thanksOverlay.querySelector('#thanks-overlay-img');
            const methodBtns = Array.from(thanksOverlay.querySelectorAll('.buy-coffee-method-btn'));
            const focusables = [closeEl, ...methodBtns, imgEl].filter(Boolean);
            if (!focusables.length) return;
            const currentIdx = focusables.indexOf(document.activeElement);
            const delta = e.shiftKey ? -1 : 1;
            let nextIdx = currentIdx + delta;
            if (nextIdx < 0) nextIdx = focusables.length - 1;
            if (nextIdx >= focusables.length) nextIdx = 0;
            e.preventDefault();
            e.stopPropagation();
            focusables[nextIdx].focus();
        });
    }
    const imgEl = thanksOverlay.querySelector('#thanks-overlay-img');

    // Start in loading state BEFORE changing src
    setThanksOverlayLoading(true);
    imgEl.src = imgSrc;

    // If the image is already cached, `load` may not fire in time; handle that
    if (imgEl.complete && imgEl.naturalWidth > 0) {
        if (!hasThanksOverlayEverLoaded) hasThanksOverlayEverLoaded = true;
        setThanksOverlayLoading(false);
    }

    const toast = thanksOverlay.querySelector('.thanks-toast');
    if (toast) {
        toast.style.opacity = '0';
    }

    document.body.appendChild(thanksOverlay);
    thanksOverlay.style.display = 'flex';
    isBuyMeVisible = true;

    // Don’t position buttons until visible; load handler will position too.
    // But keeping this call is fine; they’re hidden while loading anyway.
    positionThanksMethodButtonsForOrientation();

    document.addEventListener('keydown', onThanksKeydown);
    buyCoffeeCloseBtn = thanksOverlay.querySelector('#thanks-overlay-close');
    if (buyCoffeeCloseBtn && typeof buyCoffeeCloseBtn.focus === 'function') {
        requestAnimationFrame(() => buyCoffeeCloseBtn.focus());
    }
}
function updateBuyMeButton() {
    const icon = document.getElementById("buyCoffeeIcon");
    const text = document.getElementById("buyCoffeeText");
    if (!icon || !text) return;
    const hour = getHourInTimeZone(getSelectedDashboardTimeZone(), new Date());
    const isBeerTimeNow = (hour >= 17 || hour < 3);
    if (isBeerTimeNow) {
        icon.textContent = "🍺";
        text.textContent = "Buy me a beer";
    } else {
        icon.textContent = "☕";
        text.textContent = "Buy me a coffee";
    }
    preloadThanksImagesIfNeeded(false);
}
function handleDonationTimeZoneChanged() {
        updateBuyMeButton();
        if (!isBuyMeVisible || !thanksOverlay) return;
        const method = getStoredBuyCoffeeMethod();
        updateThanksOverlayImageForMethod(method);
        positionThanksMethodButtonsForOrientation();
}
document.addEventListener("DOMContentLoaded", () => {
  updateBuyMeButton();
  preloadThanksImagesIfNeeded(true);
  preloadAllThanksImagesOnce();
});
setInterval(updateBuyMeButton, 5 * 60 * 1000);
window.addEventListener(DASHBOARD_TZ_CHANGE_EVENT, handleDonationTimeZoneChanged);
window.addEventListener('storage', e => {
        if (e.key !== DASHBOARD_TZ_STORAGE_KEY) return;
        handleDonationTimeZoneChanged();
});
function updateBuyMeButtonLayout() {
    const btn = document.getElementById("buyCoffeeBtn");
    if (!btn) return;
    const narrow = window.innerWidth <= 750;
    btn.classList.toggle("buy-coffee-hide-text", narrow);
}
document.addEventListener("DOMContentLoaded", updateBuyMeButtonLayout);
window.addEventListener("resize", updateBuyMeButtonLayout);

function normalizeBuyCoffeeMethod(m) {
    const v = String(m || '').toLowerCase().trim();
    if (v === 'on-chain') return 'onchain';
    if (v === 'lightning' || v === 'liquid' || v === 'onchain') return v;
    return 'lightning';
}
function getStoredBuyCoffeeMethod() {
    return normalizeBuyCoffeeMethod(localStorage.getItem(BUY_COFFEE_METHOD_KEY) || 'lightning');
}
function setStoredBuyCoffeeMethod(m) {
    const norm = normalizeBuyCoffeeMethod(m);
    localStorage.setItem(BUY_COFFEE_METHOD_KEY, norm);
    return norm;
}
function setActiveBuyCoffeeMethod(method) {
    const norm = setStoredBuyCoffeeMethod(method);
    if (!buyCoffeeMethodBtns || buyCoffeeMethodBtns.length === 0) return norm;
    buyCoffeeMethodBtns.forEach(btn => {
        const isOn = btn.dataset.method === norm;
        btn.classList.toggle('active', isOn);
        btn.setAttribute('aria-pressed', String(isOn));
    });
    return norm;
}
function initBuyCoffeeMethodsUI() {
    if (!buyCoffeeMethodBtns || buyCoffeeMethodBtns.length === 0) return;
    buyCoffeeMethodBtns.forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            const m = btn.dataset.method;
            setActiveBuyCoffeeMethod(m);
        });
        btn.addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space') return;
            e.preventDefault();
            e.stopPropagation();
            btn.click();
        });
    });
}
