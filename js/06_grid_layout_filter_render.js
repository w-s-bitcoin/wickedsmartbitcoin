/* ===========================
 * GRID: LAYOUT + FILTER/RENDER
 * =========================== */
const DASHBOARD_CARD_PREVIEW_SPECS = Object.freeze({
  'bip110_signaling.png': {
    url: 'webapps/bip110_signaling/dashboard.html?preview=card',
    width: 1280,
    height: 720,
  },
  'bitcoin_dominance.png': {
    url: 'webapps/bitcoin_dominance/dashboard.html?preview=card',
    width: 1280,
    height: 720,
  },
  'node_count.png': {
    url: 'webapps/node_count/dashboard.html?preview=card',
    width: 1280,
    height: 720,
  },
});

let dashboardPreviewResizeObserver = null;
let dashboardPreviewWindowResizeBound = false;

function getDashboardCardPreviewSpec(filename) {
  return DASHBOARD_CARD_PREVIEW_SPECS[String(filename || '').trim().toLowerCase()] || null;
}

function updateDashboardPreviewScale(card) {
  const preview = card?.preview;
  if (!preview) return;
  const { viewport, scene, width, height } = preview;
  if (!viewport?.isConnected || !scene?.isConnected) return;

  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const scale = Math.min(rect.width / width, rect.height / height);
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const offsetX = Math.max(0, (rect.width - scaledWidth) / 2);
  const offsetY = Math.max(0, (rect.height - scaledHeight) / 2);

  scene.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}

function updateAllDashboardPreviewScales() {
  for (const card of cardByFilename.values()) {
    if (card?.preview) updateDashboardPreviewScale(card);
  }
}

function ensureDashboardPreviewObservers() {
  if (!dashboardPreviewResizeObserver && typeof ResizeObserver !== 'undefined') {
    dashboardPreviewResizeObserver = new ResizeObserver(() => {
      updateAllDashboardPreviewScales();
    });
  }
  if (!dashboardPreviewWindowResizeBound) {
    window.addEventListener('resize', updateAllDashboardPreviewScales);
    dashboardPreviewWindowResizeBound = true;
  }
}

function openModalByFilename(fname){
  if(!fname) return;
  const idx = visibleImages.findIndex(x => x.filename === fname);
  if(idx !== -1) openModalByIndex(idx);
  else openByFilenameAllowingNonFav(fname);
}
function buildGridOnce(){
  if(gridBuilt) return;
  gridBuilt = true;
  const grid = document.getElementById('image-grid');
  grid.innerHTML = '';
  cardByFilename.clear();
  for(const {filename, title, description} of imageList){
    const previewSpec = getDashboardCardPreviewSpec(filename);
    const container = document.createElement('div');
    const titleElem = document.createElement('div');
    titleElem.className = 'chart-title';
    titleElem.textContent = title;
    const chartContainer = document.createElement('div');
    chartContainer.className = 'chart-container';
    const chartWrapper = document.createElement('div');
    chartWrapper.className = 'chart-wrapper';
    const spinner = document.createElement('div');
    spinner.className = 'chart-loading';
    const img = document.createElement('img');
    img.className = 'grid-thumb lazy';
    img.dataset.filename = filename;
    img.dataset.src = imgSrc(filename);
    img.alt = title || '';
    const onOpen = (e) => {
      e.preventDefault();
      openModalByFilename(img.dataset.filename);
    };

    chartContainer.tabIndex = 0;
    chartContainer.addEventListener('click', onOpen);
    chartContainer.addEventListener('keydown', (e) => {
      if (!(e.key === 'Enter' || e.key === ' ' || e.code === 'Space')) return;
      onOpen(e);
    });

    img.onload = () => { spinner.remove(); img.style.opacity = 1; img.dataset.loaded = "1"; };
    img.onerror = () => { spinner.remove(); img.style.opacity = 1; img.dataset.loaded = "0"; };
    const star = document.createElement('div');
    star.className = 'favorite-star';
    const favOn = isFavorite(filename);
    star.textContent = favOn ? '★' : '☆';
    if(favOn) star.classList.add('filled');
    const favKeyForThisCard = filename.startsWith(POF_BASE) ? POF_FAV_KEY : filename;
    star.setAttribute('data-filename', favKeyForThisCard);
    // record favourite state on the image element itself so that the lazy loader
    // can quickly inspect it without hitting localStorage repeatedly.
    img.dataset.fav = favOn ? '1' : '0';
    img.dataset.filename = filename; // already set but ensure consistency
    star.onclick = e => {
      e.stopPropagation();
      toggleFavorite(img.dataset.filename, star);
    };

    chartContainer.appendChild(star);

    if (previewSpec) {
      chartWrapper.classList.add('dashboard-preview-wrapper');
      const viewport = document.createElement('div');
      viewport.className = 'dashboard-preview-viewport';
      const scene = document.createElement('div');
      scene.className = 'dashboard-preview-scene';
      scene.style.width = `${previewSpec.width}px`;
      scene.style.height = `${previewSpec.height}px`;
      const iframe = document.createElement('iframe');
      iframe.className = 'dashboard-preview-frame';
      iframe.src = previewSpec.url;
      iframe.title = `${title || filename} preview`;
      iframe.loading = 'lazy';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      iframe.addEventListener('load', () => {
        spinner.remove();
      }, { once: true });

      scene.appendChild(iframe);
      viewport.appendChild(scene);
      chartWrapper.appendChild(spinner);
      chartWrapper.appendChild(viewport);

      container.dataset.dashboardPreview = '1';
      cardByFilename.set(_cardKey(filename), {
        container,
        img,
        titleElem,
        desc: null,
        star,
        preview: {
          viewport,
          scene,
          width: previewSpec.width,
          height: previewSpec.height,
        },
      });
    } else {
      chartWrapper.appendChild(spinner);
      chartWrapper.appendChild(img);
      cardByFilename.set(_cardKey(filename), {container, img, titleElem, desc: null, star});
    }

    chartContainer.appendChild(chartWrapper);
    const desc = document.createElement('div');
    desc.className = 'chart-description';
    desc.textContent = description;
    chartContainer.appendChild(desc);
    container.appendChild(titleElem);
    container.appendChild(chartContainer);
    grid.appendChild(container);
    const card = cardByFilename.get(_cardKey(filename));
    if (card) card.desc = desc;
  }

  ensureDashboardPreviewObservers();
  if (dashboardPreviewResizeObserver) {
    for (const card of cardByFilename.values()) {
      if (card?.preview?.viewport) {
        dashboardPreviewResizeObserver.observe(card.preview.viewport);
      }
    }
  }

  updateAllDashboardPreviewScales();
  initLazyImages();
}
function filterImages(){
  buildGridOnce();
  const query = (document.getElementById('search-input')?.value || '').toLowerCase();
  const {inTitle, inDesc} = readSearchPrefs();
  visibleImages = imageList.filter(({title, description, filename, archived}) => {
    let matchesSearch = true;
    const archivedString = String(archived || '').trim().toLowerCase();
    const isArchived = archived === true || archivedString === 'true';
    const matchesArchived = showArchivedVisualizations || !isArchived;
    if(query){
      const hayTitle = inTitle ? (title || '').toLowerCase() : '';
      const hayDesc  = inDesc  ? (description || '').toLowerCase() : '';
      matchesSearch = hayTitle.includes(query) || hayDesc.includes(query);
    }
    return matchesSearch && matchesArchived && (!showFavoritesOnly || isFavorite(filename));
  });
  const message = document.getElementById('no-favorites-message');
  if(message) message.style.display = (showFavoritesOnly && visibleImages.length === 0) ? 'block' : 'none';
  const grid = document.getElementById('image-grid');
  const frag = document.createDocumentFragment();
  for(const {container} of cardByFilename.values()){
    container.style.display = 'none';
  }
  visibleImages.forEach((item, index) => {
    const card = cardByFilename.get(_cardKey(item.filename));
    if(!card) return;
    card.container.style.display = '';
    if (card.img) card.img.dataset.gridIndex = index;
    // update the fav flag in case the user changed it while browsing
    if (card.img) card.img.dataset.fav = isFavorite(item.filename) ? '1' : '0';
    card.titleElem.dataset.gridIndex = index;
    if (card.desc) card.desc.dataset.gridIndex = index;
    frag.appendChild(card.container);
  });
  grid.appendChild(frag);
  updateLayoutBasedOnWidth();
  updateAllDashboardPreviewScales();
  initLazyImages();
}
function setLayout(type, manual = true) {
    imageGrid.classList.remove('grid', 'list');
    imageGrid.classList.add(type);
    if (type === 'grid') {
        gridIcon.classList.add('active');
        listIcon.classList.remove('active');
    } else {
        listIcon.classList.add('active');
        gridIcon.classList.remove('active');
    }
    if (manual) {
        userSelectedLayout = type;
        localStorage.setItem('preferredLayout', type);
    }
}
function updateLayoutBasedOnWidth() {
  const toggleIconsEl = document.getElementById('toggleIcons');
  const searchContainer = document.querySelector('.search-container');
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  if(!imageGrid || !toggleIconsEl || !searchContainer || !searchInput || !searchBtn) return;
  searchContainer.classList.add('active');
  setSearchInputFocusability(true);
  const containerWidth = imageGrid.offsetWidth;
  const columnWidth = 280 + 32;
  const columns = Math.floor(containerWidth / columnWidth);
  if (columns < 2) {
        toggleIconsEl.style.display = 'none';
    searchBtn.disabled = false;
        if (userSelectedLayout !== 'list') setLayout('list', false);
    } else {
        toggleIconsEl.style.display = 'inline-flex';
    searchBtn.disabled = false;
        const storedLayout = localStorage.getItem('preferredLayout');
        const preferred =
            userSelectedLayout ||
            (storedLayout === 'grid' || storedLayout === 'list' ? storedLayout : null) ||
            (imageGrid.classList.contains('list') ? 'list' : 'grid');
        setLayout(preferred, false);
    }
}
function toggleSearch() {
    const input = document.getElementById('search-input');
  if (input) input.focus();
}