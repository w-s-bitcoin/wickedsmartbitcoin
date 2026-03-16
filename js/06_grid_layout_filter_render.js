/* ===========================
 * GRID: LAYOUT + FILTER/RENDER
 * =========================== */
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
    img.tabIndex = 0;
    const onOpen = (e) => {
      e.preventDefault();
      openModalByFilename(img.dataset.filename);
    };
    img.addEventListener('click', onOpen);
    img.addEventListener('keydown', (e) => {
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
    chartWrapper.appendChild(spinner);
    chartWrapper.appendChild(img);
    chartContainer.appendChild(chartWrapper);
    const desc = document.createElement('div');
    desc.className = 'chart-description';
    desc.textContent = description;
    chartContainer.appendChild(desc);
    container.appendChild(titleElem);
    container.appendChild(chartContainer);
    grid.appendChild(container);
    cardByFilename.set(_cardKey(filename), {container, img, titleElem, desc, star});
  }
  initLazyImages();
}
function filterImages(){
  buildGridOnce();
  const query = (document.getElementById('search-input')?.value || '').toLowerCase();
  const {inTitle, inDesc} = readSearchPrefs();
  visibleImages = imageList.filter(({title, description, filename}) => {
    let matchesSearch = true;
    if(query){
      const hayTitle = inTitle ? (title || '').toLowerCase() : '';
      const hayDesc  = inDesc  ? (description || '').toLowerCase() : '';
      matchesSearch = hayTitle.includes(query) || hayDesc.includes(query);
    }
    return matchesSearch && (!showFavoritesOnly || isFavorite(filename));
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
    card.img.dataset.gridIndex = index;
    // update the fav flag in case the user changed it while browsing
    card.img.dataset.fav = isFavorite(item.filename) ? '1' : '0';
    card.titleElem.dataset.gridIndex = index;
    card.desc.dataset.gridIndex = index;
    frag.appendChild(card.container);
  });
  grid.appendChild(frag);
  updateLayoutBasedOnWidth();
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
  const containerWidth = imageGrid.offsetWidth;
  const columnWidth = 280 + 32;
  const columns = Math.floor(containerWidth / columnWidth);
  if (columns < 2) {
        toggleIconsEl.style.display = 'none';
        if (!searchContainer.classList.contains('active')) {
            searchContainer.classList.add('active');
            searchBtn.classList.add('active');
        }
        searchBtn.disabled = true;
        setSearchInputFocusability(true);
        if (userSelectedLayout !== 'list') setLayout('list', false);
    } else {
        toggleIconsEl.style.display = 'inline-flex';
        if (searchWasInitiallyClosed && searchInput.value.trim() === '') {
            searchContainer.classList.remove('active');
            searchBtn.classList.remove('active');
        }
        searchBtn.disabled = false;
        setSearchInputFocusability(searchContainer.classList.contains('active'));
        const storedLayout = localStorage.getItem('preferredLayout');
        const preferred =
            userSelectedLayout ||
            (storedLayout === 'grid' || storedLayout === 'list' ? storedLayout : null) ||
            (imageGrid.classList.contains('list') ? 'list' : 'grid');
        setLayout(preferred, false);
    }
}
function toggleSearch() {
    const container = document.querySelector('.search-container');
    const input = document.getElementById('search-input');
    const button = document.getElementById('search-btn');
    const nowActive = !container.classList.contains('active');
    container.classList.toggle('active');
    button.classList.toggle('active', nowActive);
    setSearchInputFocusability(nowActive);
    if (nowActive) {
        searchWasInitiallyClosed = false;
        input.focus();
    } else {
        input.value = '';
        searchWasInitiallyClosed = true;
        filterImages();
    }
}