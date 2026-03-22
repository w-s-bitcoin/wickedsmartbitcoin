/* ===========================
 * GLOBAL STATE
 * =========================== */
let imageList = [];
let visibleImages = [];
let currentIndex = 0;
let lastOpenedFilename = null;
let justUnstarredInModal = false;
let userSelectedLayout = null;
let showFavoritesOnly = localStorage.getItem('showFavoritesOnly') === 'true';
let showArchivedVisualizations = localStorage.getItem('showArchivedVisualizations') === 'true';
let searchWasInitiallyClosed = true;
let touchStartX = 0, touchEndX = 0;
let touchStartY = 0, touchEndY = 0;
let isPinching = false;
let isPanning = false;
let isMousePanning = false;
let mouseHadMoved = false;
let gestureConsumed = false;
let startPinchDistance = 0;
let startScale = 1;
let currentScale = 1;
let pinchFocus = null;
let lastTapTime = 0;
let translateX = 0;
let translateY = 0;
let panStartX = 0;
let panStartY = 0;
let lastTapX = 0;
let lastTapY = 0;
let singleTapMoved = false;
let nonModalFocusable = [];
let thanksOverlay = null;
let thanksToastTimeout = null;
let hasThanksOverlayEverLoaded = false;
let isBuyMeVisible = false;
let buyCoffeeCloseBtn = null;
let tempNonFavInjected = false;
let modalImgLoadToken = 0;
let modalContentMode = 'image';
let modalSpinnerEl = null;
let lastThanksPreloadMode = null;
let gridBuilt = false;
let distMetric = localStorage.getItem(DIST_STORAGE_KEY) || "price";
function ensureModalSpinner(){
  const wrap = modalImg?.parentElement || modal;
  if(!wrap) return null;
  if(getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
  if(modalSpinnerEl && modalSpinnerEl.parentElement === wrap) return modalSpinnerEl;
  if(modalSpinnerEl && modalSpinnerEl.parentElement) modalSpinnerEl.remove();
  modalSpinnerEl = document.createElement("div");
  modalSpinnerEl.className = "chart-loading";
  wrap.appendChild(modalSpinnerEl);
  return modalSpinnerEl;
}
function showModalSpinner(){
  const el = ensureModalSpinner();
  if(el) el.style.display = "";
}
function hideModalSpinner(){
  if(modalSpinnerEl) modalSpinnerEl.style.display = "none";
}

