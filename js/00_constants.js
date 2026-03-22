/* ===========================
 * CONSTANTS
 * =========================== */
const BVG_BASE = 'bitcoin_vs_gold';
const BVG_STORAGE_KEY = 'bvgYear';
const THIS_YEAR = new Date().getFullYear();
const BVG_YEARS = Array.from({length: THIS_YEAR - 2013 + 1}, (_, i) => THIS_YEAR - i);
const DAL_BASE = 'days_at_a_loss';
const DAL_STORAGE_KEY = 'dalScale';
const DAL_SCALES = ['linear', 'log'];
const DOM_BASE = 'bitcoin_dominance';
const POF_BASE = 'price_of_';
const POF_STORAGE_KEY = 'pofItem';
const POF_FAV_KEY = 'price_of_*';
const POF_SORT_STORAGE_KEY = 'pofSort';
let PRICE_OF_OPTIONS = [];
let PRICE_OF_META = {};

const MYR_BASE = 'monthly_yearly_returns';
let MYR_RANGES = [];
const BTCMAP_GLOBAL_FILE = 'btcmap.png';
const BTCMAP_PREFIX = 'btcmap_';
const BTCMAP_STORAGE_KEY = 'btcmapRegion';
const BTCMAP_VIEW_STORAGE_KEY = 'btcmapView';
const BTCMAP_VIEW_OPTIONS = ['total', 'per_100k'];
const BTCMAP_VIEW_LABELS = {
  total: 'Total Merchants',
  per_100k: 'Per 100k'
};
const BTCMAP_VIEW_VALUES = new Set(["total", "per_100k"]);
function _normalizeBtcmapsView(v) {
  const s = String(v || "").toLowerCase();
  return BTCMAP_VIEW_VALUES.has(s) ? s : "total";
}
let BTCMAP_OPTIONS = [];
let BTCMAP_META = {};
let BTCMAP_META_BY_FILENAME = {};
let BTCMAP_REGION_SLUGS = [];
let BTCMAP_VIEWS_BY_REGION = {};
const DIST_PRICE_FILE = 'price_distribution.png';
const DIST_MCAP_FILE  = 'mcap_distribution.png';
const DIST_STORAGE_KEY = 'distMetric';
const DIST_METRICS = ['price', 'mcap'];
const CYCLE_LOW_FILE  = 'cycle_low_multiple.png';
const CYCLE_HIGH_FILE = 'cycle_high_drawdown.png';
const CYCLE_ANCHOR_STORAGE_KEY = 'cycleAnchor'; // 'low' | 'high'
const CYCLE_ANCHORS = ['low', 'high'];
const MYR_START_YEAR = 2010;
const MYR_DEFAULT_RANGE = `${THIS_YEAR - 4} - ${THIS_YEAR}`;
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_DELAY = 300;
const MAX_TAP_MOVE_PX = 12;
const SLIDE_EXP_KEY = 'slideshowExp';
const BUY_COFFEE_METHOD_KEY = 'buyCoffeeMethod';
const ASSET_BASE = 'assets/';
const BUY_BEER_IMG_URLS = [
  ASSET_BASE+'thanks_for_the_beer_landscape_lightning.png',
  ASSET_BASE+'thanks_for_the_beer_landscape_liquid.png',
  ASSET_BASE+'thanks_for_the_beer_landscape_onchain.png',
  ASSET_BASE+'thanks_for_the_beer_portrait_lightning.png',
  ASSET_BASE+'thanks_for_the_beer_portrait_liquid.png',
  ASSET_BASE+'thanks_for_the_beer_portrait_onchain.png'
];
const BUY_COFFEE_IMG_URLS = [
  ASSET_BASE+'thanks_for_the_coffee_landscape_lightning.png',
  ASSET_BASE+'thanks_for_the_coffee_landscape_liquid.png',
  ASSET_BASE+'thanks_for_the_coffee_landscape_onchain.png',
  ASSET_BASE+'thanks_for_the_coffee_portrait_lightning.png',
  ASSET_BASE+'thanks_for_the_coffee_portrait_liquid.png',
  ASSET_BASE+'thanks_for_the_coffee_portrait_onchain.png'
];
const cardByFilename = new Map();
