/* ===========================
 * LAZY IMAGE LOADING
 * =========================== */
let io;
let rawImageList = null;
let ioInitialized = false;

function isGridLazyDeferredForModal() {
  return window.__deferGridLazyUntilModalSettled === true;
}

function resumeDeferredGridLazyLoading() {
  if (!isGridLazyDeferredForModal()) return;
  window.__deferGridLazyUntilModalSettled = false;
  // Run the lazy pass immediately now that modal-priority fetches have started.
  initLazyImages();
}

window.resumeDeferredGridLazyLoading = resumeDeferredGridLazyLoading;

// helper: load a lazy image immediately (bypassing the observer)
function _loadLazyImageNow(img) {
  if (!img) return;
  const url = img.getAttribute("data-src") || img.dataset.src;
  const hasSrcAttr = img.hasAttribute("src") && (img.getAttribute("src") || "").trim() !== "";
  if (url && !hasSrcAttr) {
    img.setAttribute("src", url);
    img.classList.remove("lazy");
    img.removeAttribute("data-src");
  }
  if (io) io.unobserve(img);
}

function initLazyImages(){
  if (isGridLazyDeferredForModal()) return;

  // gather any images that still need a src
  const allLazy = Array.from(document.querySelectorAll('img.lazy[data-src]:not([src])'));
  const shouldRefresh = allLazy.length > 0 || !ioInitialized;
  if(!shouldRefresh) return;

  if(!ioInitialized || !io) {
    if(io) io.disconnect();
    io = new IntersectionObserver(es=>{
      for(const e of es){
        // when the modal is open we don't care if the thumb is off‑screen;
        // the observer may still fire because we force‑load the modal image separately.
        if(!e.isIntersecting && !document.body.classList.contains("modal-open")) continue;
        const img = e.target;
        const url = img.getAttribute("data-src") || img.dataset.src;
        const hasSrcAttr = img.hasAttribute("src") && (img.getAttribute("src") || "").trim() !== "";
        if(url && !hasSrcAttr){
          img.setAttribute("src", url);
          img.classList.remove("lazy");
          img.removeAttribute("data-src");
        }
        io.unobserve(img);
      }
    },{root:null,rootMargin:"400px 0px",threshold:0.01});
    ioInitialized = true;
  }

  // Split images into visible vs hidden (hidden ones usually result from filtering)
  const visibleLazy = allLazy.filter(img => {
    const idx = parseInt(img.dataset.gridIndex, 10);
    // any card that has no numeric index or is hidden should be deferred
    if (isNaN(idx)) return false;
    const card = img.closest('div');
    if (card && card.style && card.style.display === 'none') return false;
    return true;
  });
  const hiddenLazy = allLazy.filter(img => !visibleLazy.includes(img));

  // sort visible images by favorite first then grid index ascending
  visibleLazy.sort((a, b) => {
    const aFav = a.dataset.fav === '1' || isFavorite(a.dataset.filename) ? 0 : 1;
    const bFav = b.dataset.fav === '1' || isFavorite(b.dataset.filename) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    const ai = parseInt(a.dataset.gridIndex, 10) || 0;
    const bi = parseInt(b.dataset.gridIndex, 10) || 0;
    return ai - bi;
  });

  // favourites get loaded immediately; after that we also kick‑off a handful of top
  //‑of‑grid images so the page looks populated quickly. the remainder are observed
  // in the normal way and will load as they scroll into view.
  const favourites = visibleLazy.filter(img => img.dataset.fav === '1' || isFavorite(img.dataset.filename));
  favourites.forEach(_loadLazyImageNow);

  const initialBurst = visibleLazy.filter(img => !isFavorite(img.dataset.filename)).slice(0, 20);
  initialBurst.forEach(_loadLazyImageNow);

  // observe every image that hasn't been given a src yet
  allLazy.forEach(img => {
    if (!img.src) io.observe(img);
  });
}
