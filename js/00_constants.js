/* ===========================
 * CONSTANTS
 * =========================== */
const DOM_BASE = 'bitcoin_dominance';
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_DELAY = 300;
const MAX_TAP_MOVE_PX = 12;
const BUY_COFFEE_METHOD_KEY = 'buyCoffeeMethod';
const ASSET_BASE = 'assets/';
const BUY_BEER_IMG_URLS = [
  ASSET_BASE+'thanks_for_the_beer_landscape.png',
  ASSET_BASE+'thanks_for_the_beer_portrait.png'
];
const BUY_COFFEE_IMG_URLS = [
  ASSET_BASE+'thanks_for_the_coffee_landscape.png',
  ASSET_BASE+'thanks_for_the_coffee_portrait.png'
];
const BUY_DONATION_QR_URLS = [
  ASSET_BASE+'qr_lightning.png',
  ASSET_BASE+'qr_liquid.png',
  ASSET_BASE+'qr_onchain.png'
];
const cardByFilename = new Map();
