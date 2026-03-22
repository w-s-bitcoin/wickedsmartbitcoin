/* ===========================
 * DOM ELEMENTS
 * =========================== */
const imageGrid = document.getElementById('image-grid');
const gridIcon = document.getElementById('gridView');
const listIcon = document.getElementById('listView');
const modal = document.getElementById('modal');
const modalImg = document.getElementById('modal-img');
const modalEmbedWrap = document.getElementById('modal-embed-wrap');
const modalEmbed = document.getElementById('modal-embed');
const modalFavBtn = document.getElementById('modal-fav-btn');
const modalDlBtn = document.getElementById('modal-dl-btn');
const kebabBtn = document.getElementById('kebabBtn');
const kebabMenu = document.getElementById('kebabMenu');
const chkSearchTitles = document.getElementById('chkSearchTitles');
const chkSearchDescriptions = document.getElementById('chkSearchDescriptions');
const startSlideshowBtn = document.getElementById('startSlideshowBtn');
const slideshowEl = document.getElementById('slideshow');
const slideshowImg = document.getElementById('slideshow-img');
const ssExitBtn = document.getElementById('ssExitBtn');
const ssPlayPauseBtn = document.getElementById('ssPlayPauseBtn');
const ssPrevBtn = document.getElementById('ssPrevBtn');
const ssNextBtn = document.getElementById('ssNextBtn');
const slideRange = document.getElementById('slideDuration');
const slideBubble = document.getElementById('slideDurationBubble');
const yearControls = document.getElementById('year-controls');
const yearSelect = document.getElementById('year-select');
const scaleControls = document.getElementById('scale-controls');
const scaleSelect = document.getElementById('scale-select');
const hashControls = document.getElementById('hashlen-controls');
const hashSelect = document.getElementById('hashlen-select');
const priceOfControls = document.getElementById('priceof-controls');
const priceOfSelect = document.getElementById('priceof-select');
const pofSortControls = document.getElementById('pof-sort-controls');
const pofSortSelect = document.getElementById('pof-sort-select');
const pofIndexInput = document.getElementById('pof-index-input');
const pofIndexTotal = document.getElementById('pof-index-total');

const myrControls = document.getElementById('myr-controls');
const myrSelect = document.getElementById('myr-select');
const btcmapsControls =
  document.getElementById('btcmaps-controls') ||
  document.getElementById('btcmap-controls') ||
  document.getElementById('region-controls') ||
  document.querySelector('[data-controls="btcmaps"]');
const btcmapsSelect =
  document.getElementById('btcmaps-select') ||
  document.getElementById('btcmap-select') ||
  document.getElementById('region-select') ||
  document.querySelector('[data-select="btcmaps"]');
const halvingViewControls = document.getElementById('halving-view-controls');
const halvingViewSelect   = document.getElementById('halving-view-select');
const uoaControls = document.getElementById('uoa-controls');
const uoaSelect = document.getElementById('uoa-select');
const sortControls = document.getElementById('sort-controls');
const uoaSortSelect = document.getElementById('sort-select');
const uoaIndexInput = document.getElementById('uoa-index-input');
const uoaIndexTotal = document.getElementById('uoa-index-total');
const uoaShowControls = document.getElementById('uoa-show-controls');
const uoaShowSelect = document.getElementById('uoa-show-select');
const metricControls = document.getElementById('metric-controls');
const metricSelect   = document.getElementById('metric-select');
const anchorControls = document.getElementById('anchor-controls');
const anchorSelect   = document.getElementById('anchor-select');
const buyMeBtn = document.getElementById('buyCoffeeBtn');
const favoritesToggleBtn = document.getElementById('favoritesToggle');
const showArchivedToggle = document.getElementById('showArchivedToggle');
const buyCoffeeMethodBtns = Array.from(document.querySelectorAll('.buy-coffee-method-btn'));
const DONATE_ROUTE = 'donate';
const viewControls =
  document.getElementById('view-controls') ||
  document.querySelector('[data-controls="btcmap-view"]');
const viewSelect =
  document.getElementById('view-select') ||
  document.querySelector('[data-select="btcmap-view"]');
