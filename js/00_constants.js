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
