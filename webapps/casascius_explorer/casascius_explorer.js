(() => {
  const root = document.documentElement;
  const SHARED_THEME_KEY = 'quantum-research-dashboard-theme';
  const WEBP_SUPPORTED = (() => {
    try {
      const canvas = document.createElement('canvas');
      return canvas.toDataURL('image/webp').startsWith('data:image/webp');
    } catch (_) {
      return false;
    }
  })();
  const USE_COMPACT_IMAGE_ASSETS = (() => {
    try {
      const ua = String(navigator.userAgent || '');
      const mobileUa = /iPhone|iPod|Android/i.test(ua);
      return WEBP_SUPPORTED
        && Number(window.devicePixelRatio || 1) >= 2
        && (mobileUa || Number(navigator.maxTouchPoints || 0) > 0 || matchMedia('(pointer: coarse)').matches)
        && Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 680;
    } catch (_) {
      return false;
    }
  })();

  function applySharedTheme(theme) {
    root.dataset.theme = theme === 'light' ? 'light' : 'dark';
    document.dispatchEvent(new CustomEvent('casascius-theme-change'));
  }

  try {
    const storedTheme = localStorage.getItem(SHARED_THEME_KEY);
    applySharedTheme(storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'dark');
  } catch (_) {
    applySharedTheme('dark');
  }

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'quantum-dashboard-theme') applySharedTheme(event.data.theme);
  });

  window.addEventListener('storage', (event) => {
    if (event.key === SHARED_THEME_KEY && (event.newValue === 'light' || event.newValue === 'dark')) {
      applySharedTheme(event.newValue);
    }
  });

  if (window.self !== window.top) {
    root.classList.add('wsb-modal-embedded');
  }
  try {
    const ua = String(navigator.userAgent || '');
    if (/iPhone|iPod/.test(ua) && /(Twitter|Twitter for iPhone|Twitter-iPhone|X\/[0-9])/i.test(ua)) {
      root.classList.add('wsb-twitter-ios-webview');
    }
  } catch (_) {}
  const topbar = document.querySelector('.topbar');
  const tabs = document.getElementById('coinTabs');
  const versionTabs = document.getElementById('versionTabs');
  const app = document.getElementById('app');
  const comparisonStage = document.getElementById('comparisonStage');
  const scene = document.getElementById('scene');
  const gradedMediaViewer = document.getElementById('gradedMediaViewer');
  const gradedMediaImage = document.getElementById('gradedMediaImage');
  const gradedMediaDots = document.getElementById('gradedMediaDots');
  const gradedCaseScene = document.getElementById('gradedCaseScene');
  const gradedCaseModel = document.getElementById('gradedCaseModel');
  const gradedCaseCrosshair = document.getElementById('gradedCaseCrosshair');
  const allItemsStage = document.getElementById('allItemsStage');
  const stageLoadingRing = document.getElementById('stageLoadingRing');
  const model = document.getElementById('model');
  const quarterScene = document.getElementById('quarterScene');
  const quarterModel = document.getElementById('quarterModel');
  const rightPanelCoinName = document.getElementById('rightPanelCoinName');
  const bottomStack = document.querySelector('.bottom-stack');
  const controls = document.querySelector('.controls');
  const toggle = document.getElementById('toggle');
  const spinOrbitMarker = toggle.querySelector('.spin-orbit-marker');
  const tiltControl = document.getElementById('tiltControl');
  const frontBtn = document.getElementById('frontBtn');
  const backBtn = document.getElementById('backBtn');
  const hologramBtn = document.getElementById('hologramBtn');
  const quarterComparisonInput = document.getElementById('quarterComparison');
  const speedInput = document.getElementById('speed');
  const speedValueInput = document.getElementById('speedValue');
  const zoomInput = document.getElementById('zoom');
  const zoomValueInput = document.getElementById('zoomValue');
  const addressSearchControl = document.getElementById('addressSearchControl');
  const addressSearchInput = document.getElementById('addressSearch');
  const addressSearchClose = document.getElementById('addressSearchClose');
  const keyboardShortcutsBtn = document.getElementById('keyboardShortcutsBtn');
  const leftPanelBtn = document.getElementById('leftPanelBtn');
  const bottomPanelBtn = document.getElementById('bottomPanelBtn');
  const rightPanelBtn = document.getElementById('rightPanelBtn');
  const leftDataPanel = document.getElementById('leftDataPanel');
  const rightDataPanel = document.getElementById('rightDataPanel');
  const recentSpendsPanel = document.getElementById('recentSpendsPanel');
  const recentSpendsView = document.getElementById('recentSpendsView');
  const activeCoinsView = document.getElementById('activeCoinsView');
  const gradedCoinsView = document.getElementById('gradedCoinsView');
  const leftPanelHeader = leftDataPanel?.querySelector('.data-panel-header');
  const leftPanelTitle = document.getElementById('leftPanelTitle');
  const leftPanelModeToggle = document.getElementById('leftPanelModeToggle');
  const coinInfoPanel = document.getElementById('coinInfoPanel');
  const barAddressOverlay = document.getElementById('barAddressOverlay');
  const coinBackAddressOverlay = document.getElementById('coinBackAddressOverlay');

  const COIN_SEGMENTS = 160;
  const SMOOTH_EDGE_SEGMENTS = COIN_SEGMENTS * 2;
  const QUARTER_REEDS = 119;
  const QUARTER_DIAMETER_MM = 24.26;
  const QUARTER_THICKNESS_MM = 1.75;
  const ORBIT_FACE_SNAP_DEGREES = 12;
  const STORAGE_ACTIVE_SLUG = 'casasciusSpinnerActiveSlug';
  const STORAGE_VIEW_STATE = 'casasciusSpinnerViewState';
  const STORAGE_GROUP_SELECTIONS = 'casasciusSpinnerGroupSelections';
  const STORAGE_VERSIONS_COLLAPSED = 'casasciusSpinnerVersionsCollapsed';
  const STORAGE_QUARTER_COMPARISON = 'casasciusSpinnerQuarterComparison';
  const STORAGE_PANEL_STATE = 'casasciusSpinnerPanelState';
  const STORAGE_BALANCE_CHART_OPEN = 'casasciusSpinnerBalanceChartOpen';
  const STORAGE_CHART_MODAL_MODE = 'casasciusSpinnerChartModalMode';
  const LEFT_PANEL_MODES = ['recent', 'active', 'graded'];
  const LEFT_PANEL_MODE_TITLES = { recent: 'Redeemed', active: 'Active', graded: 'Graded' };
  const STORAGE_BALANCE_CHART_UNIT = 'casasciusSpinnerBalanceChartUnit';
  const STORAGE_PRICE_CHART_UNIT = 'casasciusSpinnerPriceChartUnit';
  const STORAGE_PRICE_CHART_SCALE = 'casasciusSpinnerPriceChartScale';
  const STORAGE_PRICE_CHART_VISIBLE_GROUPS = 'casasciusSpinnerPriceChartVisibleGroups';
  const STORAGE_BALANCE_CHART_BACKGROUND_HIDDEN = 'casasciusSpinnerBalanceChartBackgroundHidden';
  const STORAGE_BALANCE_CHART_VISIBLE_SERIES = 'casasciusSpinnerBalanceChartVisibleSeries';
  const STORAGE_ALL_ITEMS_CROSSHAIR = 'casasciusSpinnerAllItemsCrosshair';
  const STORAGE_ALL_ITEMS_WINDOW = 'casasciusSpinnerAllItemsWindow';
  const STORAGE_ALL_ITEMS_VIEW_MODE = 'casasciusSpinnerAllItemsViewMode';
  const STORAGE_ALL_ITEMS_SELECTION = 'casasciusSpinnerAllItemsSelection';
  const STORAGE_GRADED_MEDIA_MODE = 'casasciusSpinnerGradedMediaMode';
  const STORAGE_GRADED_MEDIA_SELECTION = 'casasciusSpinnerGradedMediaSelection';
  const CASASCIUS_ITEM_DATA_PATH = 'assets/items/';
  const MOBILE_PANEL_QUERY = '(max-width: 680px)';
  const LEGACY_DEFAULT_ACTIVE_SLUG = 'cas_1btc_2011_s1';
  const DEFAULT_ACTIVE_SLUG = 'all:coins-bars';
  const TRACKER_CSV_URL = 'data/casascius_explorer.csv';
  const GRADED_CSV_URL = 'data/casascius_graded.csv';
  const SERIES_PRICE_CSV_URL = 'data/casascius_coin_series_dates_prices.csv';
  const NGC_GRADED_MEDIA_DEFAULTS = {
    imageWidthPx: 2113,
    imageHeightPx: 3010,
    coinDiameterPx: 960,
    caseWidthMm: 64.3,
    caseHeightMm: 85.9,
    caseThicknessMm: 7.2,
    caseCornerRatio: 0.16,
    caseStyle: 'ngc'
  };
  const PCGS_GRADED_MEDIA_DEFAULTS = {
    imageWidthPx: 2190,
    imageHeightPx: 2918,
    coinDiameterPx: 995,
    caseWidthMm: 62.75,
    caseHeightMm: 82.2,
    caseThicknessMm: 7.5,
    caseCornerRatio: 0.118,
    caseStyle: 'pcgs'
  };
  const PCGS_BAR_GRADED_MEDIA_DEFAULTS = {
    ...PCGS_GRADED_MEDIA_DEFAULTS,
    caseWidthMm: 116.6,
    caseHeightMm: 154.76,
    caseThicknessMm: 10
  };
  const GRADED_ONLY_ENTRIES_BY_LABEL = {
    '2012 Mule Bitnickel': {
      slug: 'cas_5btc_2012_bitnickel_mule',
      Status: 'Unfunded',
      type: 'MULE-BITNICKEL-2012',
      value: 5,
      balance: 0,
      index: null,
      createBlock: null,
      createTime: null,
      redeemBlock: null,
      redeemTime: null,
      displayOnlyAddress: true
    }
  };
  function ngcGradedMedia(stem, overrides = {}) {
    return {
      front: `gradings/NGC_${stem}_front.png`,
      back: `gradings/NGC_${stem}_back.png`,
      ...NGC_GRADED_MEDIA_DEFAULTS,
      ...overrides
    };
  }
  function pcgsGradedMedia(stem, overrides = {}) {
    return {
      front: `gradings/PCGS_${stem}_front.png`,
      back: `gradings/PCGS_${stem}_back.png`,
      ...PCGS_GRADED_MEDIA_DEFAULTS,
      ...overrides
    };
  }
  const GRADED_MEDIA_BY_ADDRESS = {
    '2012 Mule Bitnickel': pcgsGradedMedia('mule_bitnickel', {
      front: 'gradings/PCGS_mule_bitnickel_front.png',
      back: 'gradings/PCGS_mule_bitnickel_back.png'
    }),
    '2factor 1AuHc241cAwfLQ7u': ngcGradedMedia('1AuHc241', {
      front: 'gradings/NGC_1AuHc241_front.png',
      back: 'gradings/NGC_1AuHc241_back.png'
    }),
    '2factor 1Au9Aag4jVYqbu3L': ngcGradedMedia('1Au9Aag4', {
      front: 'gradings/NGC_1Au9Aag4_front.png',
      back: 'gradings/NGC_1Au9Aag4_back.png'
    }),
    '2factor 1Auiao8gP7YEnaUF': ngcGradedMedia('1Auiao8g', {
      front: 'gradings/NGC_1Auiao8g_front.png',
      back: 'gradings/NGC_1Auiao8g_back.png'
    }),
    '2factor 1AuDhxo8TLQFPU3C': ngcGradedMedia('1AuDhxo8', {
      front: 'gradings/NGC_1AuDhxo8_front.png',
      back: 'gradings/NGC_1AuDhxo8_back.png'
    }),
    '2factor 1AuEVPghdbbQuDfz': ngcGradedMedia('1AuEVPgh', {
      front: 'gradings/NGC_1AuEVPgh_front.png',
      back: 'gradings/NGC_1AuEVPgh_back.png'
    }),
    '133RXZaTtyyDLCTCdyFHCW4TV2nH4xxj2K': ngcGradedMedia('133RXZaT'),
    '15eTzCSj3G5gngyFYeztApydy1xNyh4pz3': pcgsGradedMedia('15eTzCSj'),
    '1NSNKCP2ZRT9Si3FHTQKCicVvb73MYVJdn': ngcGradedMedia('1NSNKCP2'),
    '19MyvLp3LJi1n2p7jqtXnqENnvAZkQmgwT': ngcGradedMedia('19MyvLp3')
  };
  const READY_GRADED_MEDIA_STEMS = new Set([
    'NGC_133RXZaT',
    'NGC_19MyvLp3',
    'NGC_1A2Qg7aB',
    'NGC_1AgMX8Kb',
    'NGC_1Agk99qw',
    'NGC_1Agsmd1m',
    'NGC_1Agw6y5i',
    'NGC_1AgyAERK',
    'NGC_1AgyC8At',
    'NGC_1AgyzVmd',
    'NGC_1Au9Aag4',
    'NGC_1AuDhxo8',
    'NGC_1AuEVPgh',
    'NGC_1AuHc241',
    'NGC_1Auiao8g',
    'NGC_1CAH8ptQ',
    'NGC_1CAU8zUx',
    'NGC_1CAYauRp',
    'NGC_1CCJGmuS',
    'NGC_1EWgq7NL',
    'NGC_1GDmtdSt',
    'NGC_1NSNKCP2',
    'PCGS_1241ZPxy',
    'PCGS_12424P5N',
    'PCGS_1256uomj',
    'PCGS_12583Cxf',
    'PCGS_1331BaAy',
    'PCGS_133Z3Duk',
    'PCGS_136aiDov',
    'PCGS_137czggS',
    'PCGS_15eTzCSj',
    'PCGS_1Ag1kGst',
    'PCGS_1Ag2icXL',
    'PCGS_1Ag6z4rQ',
    'PCGS_1AgQSDDn',
    'PCGS_1AgQtm5R',
    'PCGS_1Agk3CAk',
    'PCGS_1Agy2FRJ',
    'PCGS_1AgypFuk',
    'PCGS_1AgyyPm3',
    'PCGS_1GCufn8u',
    'PCGS_1Gcy3Yy4',
    'PCGS_1GdgTNBL',
    'PCGS_1QBWPrTP',
    'PCGS_mule_bitnickel'
  ]);
  const GRADED_SELECTION_SLUGS_BY_ADDRESS = {
    '133RXZaTtyyDLCTCdyFHCW4TV2nH4xxj2K': 'cas_1btc_2013_brass',
    '1NSNKCP2ZRT9Si3FHTQKCicVvb73MYVJdn': 'cas_1btc_2011_s1',
    '19MyvLp3LJi1n2p7jqtXnqENnvAZkQmgwT': 'cas_1btc_2011_s1',
    '15eTzCSj3G5gngyFYeztApydy1xNyh4pz3': 'cas_1btc_2011_s1'
  };
  const GRADED_UNFUNDED_SLUGS_BY_ADDRESS = {
    '15eTzCSj3G5gngyFYeztApydy1xNyh4pz3': 'cas_1btc_2011_s1'
  };
  const S2_TEN_SILVER_VARIANT_SLUGS_BY_ADDRESS = {
    '1Agk3CAk2QbDwENywK6mMKB5fP2XTe8FUt': 'cas_10btc_2012_silver',
    '1AgacUuq7BffwMEteEGAYjd6dHRDdWayvk': 'cas_10btc_2012_silver_gold_b',
    '1Ag1bos9Ko1DRwr3BS9MQxCyHmuPVLZU5D': 'cas_10btc_2012_silver_gold_b',
    '1AgRPnVgEyJejCfFP5Qg2AEEM4rtMaYiSF': 'cas_10btc_2012_silver_gold_b'
  };
  const S3_HALF_SILVER_VARIANT_SLUGS_BY_ADDRESS = {};
  const S3_ONE_SILVER_VARIANT_SLUGS_BY_ADDRESS = {
    '1Ag6z4rQCA3czTJUYb4qKbtZrnKyecC8RK': 'cas_1btc_2013_gold_rim_silver'
  };
  const DAILY_PRICE_CSV_URL = '../../assets/daily_price.csv';
  const ALL_ITEMS_GROUP_KEY = 'all:coins-bars';
  const ALL_ITEMS_LABEL = 'All Coins & Bars';
  const ALL_ITEMS_PACKING = {
    widthMm: 265,
    heightMm: 192.378,
    items: [
      { slug: 'cas_bar_diy_gold_s2', x: -112.5, y: -56.189 },
      { slug: 'cas_bar_100btc_gp', x: -67.5, y: -56.189 },
      { slug: 'cas_bar_500btc_gp_s2', x: -22.5, y: -56.189 },
      { slug: 'cas_bar_1000btc_gp', x: 22.5, y: -56.189 },
      { slug: 'cas_bar_500btc_gp', x: 67.5, y: -56.189 },
      { slug: 'cas_bar_100btc_gp_s2', x: 112.5, y: -56.189 },
      { slug: 'cas_1000btc_gold', x: 22.2144, y: 3.9183 },
      { slug: 'cas_1btc_2013_silver', x: 113, y: 8.4341 },
      { slug: 'cas_10btc_2012_silver', x: -113, y: 8.4811 },
      { slug: 'cas_1btc_2013_gold_rim_silver', x: -18.4392, y: 10.0485 },
      { slug: 'cas_25btc_2011_gp_s2', x: 65.5044, y: 11.1615 },
      { slug: 'cas_25btc_2011_gp', x: -66.1238, y: 11.7536 },
      { slug: 'cas_10btc_2012_silver_gold_b', x: 11.6413, y: 42.5392 },
      { slug: 'cas_5btc_2012_bitnickel', x: -34.7847, y: 45.9808 },
      { slug: 'cas_5btc_2012_bitnickel_mule', x: 115.65, y: 47.1401 },
      { slug: 'cas_aluminum_2013', x: -116.5, y: 48.8809 },
      { slug: 'cas_1btc_2012_s2', x: 82.1936, y: 49.6125 },
      { slug: 'cas_1btc_2011_mule_demo', x: -80.5896, y: 50.7873 },
      { slug: 'cas_0p5btc_2013_silver_s25', x: 48.5913, y: 57.8953 },
      { slug: 'cas_1btc_2011_s2', x: -54.0388, y: 74.7277 },
      { slug: 'cas_0p5btc_2013_silver_s3', x: -18.1544, y: 79.5611 },
      { slug: 'cas_1btc_2013_brass', x: 118.25, y: 80.7324 },
      { slug: 'cas_1btc_2011_s1', x: 20.6726, y: 81.0425 },
      { slug: 'cas_5btc_2012_bitnickel_s2', x: 73.0708, y: 81.939 },
      { slug: 'cas_05btc_2013_brass', x: -115.7, y: 82.6177 },
      { slug: 'cas_0p1btc_2013_silver_s3', x: -84.5517, y: 83.6089 },
    ]
  };
  const ALL_ITEMS_IMAGE_PATHS = {
    front: 'assets/all_front.png',
    back: 'assets/all_back.png',
    hologram: 'assets/all_hologram.png'
  };
  const ALL_ITEMS_TILE_GAP_MM = 5;
  const DEFAULT_ALL_ITEMS_FOCUS_SLUG = 'cas_1000btc_gold';
  const ALL_ITEMS_REVEAL_PAINT_BUFFER_MS = 120;
  const BAR_EDGE_CACHE_KEY = 'shared-bar-edge-v13';
  const BAR_EDGE_STRAIGHT_STEP_RATIO = 0.026;
  const BAR_EDGE_MIN_STEP_PX = 5.5;
  const BAR_EDGE_ARC_STEP_DEGREES = 6;
  const BAR_EDGE_SEGMENT_OVERLAP_PX = 1.25;
  const BAR_BOTTOM_EDGE_INSET_RATIO = 0;
  const BALANCE_CHART_SERIES = [
    { key: 'minted', label: 'Funded', color: '#ff9900', defaultVisible: false },
    { key: 'active', label: 'Active', color: '#38c172', defaultVisible: true },
    { key: 'redeemed', label: 'Redeemed', color: '#e05243', defaultVisible: true }
  ];
  const FUNDED_AUCTION_DENOMINATION_BUFFER = 0.95;
  const LEFT_PANEL_ADDRESS_CHARS = 34;
  const LEFT_PANEL_ADDRESS_FONT = '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
  const LEFT_PANEL_HORIZONTAL_PADDING = 68;
  const LEFT_PANEL_BATCH_SIZE = 25;
  const LEFT_PANEL_MAX_RENDERED_ROWS = 50;
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const objectUrlCache = new Map();
  const DEFAULT_SPEED_VALUE = Number(speedInput.defaultValue) || 54;
  const ZOOM_SNAP_TRACK_RATIO = 3 / (Number(zoomInput.max) - Number(zoomInput.min));
  const TILT_MIN = -55;
  const TILT_MAX = 55;
  const FACE_ON_TILT = 0;
  const TILT_SNAP_DEGREES = 8;
  const TRACKER_TYPE_SLUGS = {
    'S1-BAR-100': 'cas_bar_100btc_gp',
    'S1-BAR-500': 'cas_bar_500btc_gp',
    'S1-BAR-1000': 'cas_bar_1000btc_gp',
    'S2-BAR-100': 'cas_bar_100btc_gp_s2',
    'S2-BAR-500': 'cas_bar_500btc_gp_s2',
    'S2-BAR-DIY': 'cas_bar_diy_gold_s2',
    'S1-COIN-1': 'cas_1btc_2011_s1',
    'S1-COIN-5': 'cas_5btc_2012_bitnickel',
    'S1-COIN-25': 'cas_25btc_2011_gp',
    'S1-COIN-1000': 'cas_1000btc_gold',
    'S2-COIN-0.5': 'cas_05btc_2013_brass',
    'S2-COIN-1-2011': 'cas_1btc_2011_s2',
    'S2-COIN-1-2012': 'cas_1btc_2012_s2',
    'S2-COIN-1-2013': 'cas_1btc_2013_brass',
    'S2-COIN-5': 'cas_5btc_2012_bitnickel_s2',
    'S2-COIN-10': 'cas_10btc_2012_silver',
    'S2-COIN-25': 'cas_25btc_2011_gp_s2',
    'S3-COIN-0.1-AG': 'cas_0p1btc_2013_silver_s3',
    'S3-COIN-0.5-AG': 'cas_0p5btc_2013_silver_s3'
  };
  const S3_HALF_SERIES2_ESTIMATED_COUNT = 45;
  const S3_ONE_GOLD_RIM_ESTIMATED_COUNT = 700;
  const SHARED_STATS_SLUGS = {
    cas_10btc_2012_silver_gold_b: 'cas_10btc_2012_silver'
  };
  const MINTAGE_NOTES = {
    cas_0p5btc_2013_silver_s25: 'An estimated 45 half-BTC coins were made with the Series 2 sticker and are assumed to be the ones with the earliest indexes.',
    cas_0p5btc_2013_silver_s3: 'An estimated 45 half-BTC coins were made with the Series 2 sticker and are assumed to be the ones with the earliest indexes.',
    cas_1btc_2013_gold_rim_silver: 'Gold-rim mintage is estimated from the latest 700 Series 3 1 BTC silver indexes; exact serial split is unknown.',
    cas_10btc_2012_silver: 'Mintage figures represent both 2012 10 BTC Series 2 Silver Coin with and without Gold B; specific numbers are unknown.',
    cas_10btc_2012_silver_gold_b: 'Mintage figures represent both 2012 10 BTC Series 2 Silver Coin with and without Gold B; specific numbers are unknown.'
  };

  function clampNumber(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function readVersionsCollapsed() {
    try {
      const saved = localStorage.getItem(STORAGE_VERSIONS_COLLAPSED);
      if (saved !== null) return saved === 'true';
      return window.matchMedia?.(MOBILE_PANEL_QUERY)?.matches || false;
    } catch (_) {
      return false;
    }
  }

  function saveVersionsCollapsed() {
    try {
      localStorage.setItem(STORAGE_VERSIONS_COLLAPSED, String(versionsCollapsed));
    } catch (_) {}
  }

  function readQuarterComparison() {
    try {
      return localStorage.getItem(STORAGE_QUARTER_COMPARISON) === 'true';
    } catch (_) {
      return false;
    }
  }

  function saveQuarterComparison() {
    try {
      localStorage.setItem(STORAGE_QUARTER_COMPARISON, String(quarterComparisonInput.checked));
    } catch (_) {}
  }

  function validLeftPanelMode(mode) {
    return LEFT_PANEL_MODES.includes(mode) ? mode : 'recent';
  }

  function nextLeftPanelMode(mode) {
    const index = LEFT_PANEL_MODES.indexOf(validLeftPanelMode(mode));
    return LEFT_PANEL_MODES[(index + 1) % LEFT_PANEL_MODES.length];
  }

  function isGradedEntry(entry) {
    return Boolean(entry?.gradedRecord);
  }

  function readPanelState() {
    try {
      const raw = localStorage.getItem(STORAGE_PANEL_STATE);
      if (!raw) {
        const mobile = window.matchMedia?.(MOBILE_PANEL_QUERY)?.matches || false;
        return { left: !mobile, bottom: true, right: !mobile, leftMode: 'recent' };
      }
      const saved = JSON.parse(raw);
      return {
        left: Boolean(saved.left),
        bottom: saved.bottom !== false,
        right: Boolean(saved.right),
        leftMode: validLeftPanelMode(saved.leftMode)
      };
    } catch (_) {
      const mobile = window.matchMedia?.(MOBILE_PANEL_QUERY)?.matches || false;
      return { left: !mobile, bottom: true, right: !mobile, leftMode: 'recent' };
    }
  }

  function savePanelState(leftMode = leftPanelMode) {
    try {
      localStorage.setItem(STORAGE_PANEL_STATE, JSON.stringify({
        left: leftPanelOpen,
        bottom: bottomPanelOpen,
        right: rightPanelOpen,
        leftMode: validLeftPanelMode(leftMode)
      }));
    } catch (_) {}
  }

  function syncStageLoadingRing() {
    const loading = stageLoadingKeys.size > 0;
    app?.classList.toggle('stage-model-loading', loading);
    if (stageLoadingRing) stageLoadingRing.setAttribute('aria-hidden', String(!loading));
  }

  function setStageLoading(key, loading) {
    if (!key) return;
    if (loading) stageLoadingKeys.add(key);
    else stageLoadingKeys.delete(key);
    syncStageLoadingRing();
  }

  function readBalanceChartOpen() {
    try {
      return localStorage.getItem(STORAGE_BALANCE_CHART_OPEN) === 'true';
    } catch (_) {
      return false;
    }
  }

  function saveBalanceChartOpen(open) {
    try {
      localStorage.setItem(STORAGE_BALANCE_CHART_OPEN, String(Boolean(open)));
    } catch (_) {}
  }

  function readChartModalMode() {
    try {
      return localStorage.getItem(STORAGE_CHART_MODAL_MODE) === 'price' ? 'price' : 'balance';
    } catch (_) {
      return 'balance';
    }
  }

  function saveChartModalMode(mode) {
    try {
      localStorage.setItem(STORAGE_CHART_MODAL_MODE, mode === 'price' ? 'price' : 'balance');
    } catch (_) {}
  }

  function readBalanceChartUnit() {
    try {
      return localStorage.getItem(STORAGE_BALANCE_CHART_UNIT) === 'usd' ? 'usd' : 'btc';
    } catch (_) {
      return 'btc';
    }
  }

  function saveBalanceChartUnit(unit) {
    try {
      localStorage.setItem(STORAGE_BALANCE_CHART_UNIT, unit === 'usd' ? 'usd' : 'btc');
    } catch (_) {}
  }

  function readPriceChartUnit() {
    try {
      return localStorage.getItem(STORAGE_PRICE_CHART_UNIT) === 'usd' ? 'usd' : 'btc';
    } catch (_) {
      return 'btc';
    }
  }

  function savePriceChartUnit(unit) {
    try {
      localStorage.setItem(STORAGE_PRICE_CHART_UNIT, unit === 'usd' ? 'usd' : 'btc');
    } catch (_) {}
  }

  function readPriceChartScale() {
    try {
      return localStorage.getItem(STORAGE_PRICE_CHART_SCALE) === 'log' ? 'log' : 'linear';
    } catch (_) {
      return 'linear';
    }
  }

  function savePriceChartScale(scale) {
    try {
      localStorage.setItem(STORAGE_PRICE_CHART_SCALE, scale === 'log' ? 'log' : 'linear');
    } catch (_) {}
  }

  function defaultPriceChartVisibleGroups() {
    return {
      originalFunded: true,
      fundedSale: true,
      originalPremium: true,
      redeemedSale: true
    };
  }

  function readPriceChartVisibleGroups() {
    const defaults = defaultPriceChartVisibleGroups();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_PRICE_CHART_VISIBLE_GROUPS) || 'null');
      if (!saved || typeof saved !== 'object') return defaults;
      const legacyFunded = typeof saved.funded === 'boolean' ? saved.funded : defaults.originalFunded;
      const legacyPremium = typeof saved.premium === 'boolean' ? saved.premium : defaults.originalPremium;
      return {
        originalFunded: typeof saved.originalFunded === 'boolean' ? saved.originalFunded : legacyFunded,
        fundedSale: typeof saved.fundedSale === 'boolean' ? saved.fundedSale : legacyFunded,
        originalPremium: typeof saved.originalPremium === 'boolean' ? saved.originalPremium : legacyPremium,
        redeemedSale: typeof saved.redeemedSale === 'boolean'
          ? saved.redeemedSale
          : (typeof saved.premiumSale === 'boolean' ? saved.premiumSale : legacyPremium)
      };
    } catch (_) {
      return defaults;
    }
  }

  function savePriceChartVisibleGroups() {
    try {
      localStorage.setItem(STORAGE_PRICE_CHART_VISIBLE_GROUPS, JSON.stringify(priceChartVisibleGroups));
    } catch (_) {}
  }

  function priceChartVisibilityKey(point) {
    if (point?.visibilityKey && Object.prototype.hasOwnProperty.call(defaultPriceChartVisibleGroups(), point.visibilityKey)) {
      return point.visibilityKey;
    }
    if (point?.source === 'Initial') return point?.seriesKey === 'funded' ? 'originalFunded' : 'originalPremium';
    return point?.seriesKey === 'funded' ? 'fundedSale' : 'redeemedSale';
  }

  function clampPriceChartPointToPlot(point, meta) {
    if (!point || !meta?.pad) return null;
    return {
      x: Math.max(meta.pad.left, Math.min(meta.pad.left + meta.plotW, point.x)),
      y: Math.max(meta.pad.top, Math.min(meta.pad.top + meta.plotH, point.y))
    };
  }

  function priceChartTimeAtCanvasX(meta, x) {
    if (!meta) return null;
    const ratio = (x - meta.pad.left) / Math.max(1, meta.plotW);
    return meta.minTime + ratio * Math.max(1, meta.maxTime - meta.minTime);
  }

  function priceChartValueAtCanvasY(meta, y) {
    if (!meta) return null;
    const ratio = 1 - ((y - meta.pad.top) / Math.max(1, meta.plotH));
    if (meta.scale === 'log') {
      const logMin = Math.log10(Math.max(Number.MIN_VALUE, meta.yMin));
      const logMax = Math.log10(Math.max(Number.MIN_VALUE, meta.yMax));
      return 10 ** (logMin + ratio * Math.max(1e-12, logMax - logMin));
    }
    return meta.yMin + ratio * Math.max(1e-12, meta.yMax - meta.yMin);
  }

  function balanceChartValueAtCanvasY(meta, y) {
    if (!meta) return null;
    const ratio = 1 - ((y - meta.pad.top) / Math.max(1, meta.plotH));
    return meta.yMin + ratio * Math.max(1e-12, meta.yMax - meta.yMin);
  }

  function priceChartDragSelection(meta, drag = priceChartDrag) {
    if (!meta || !drag || !drag.active) return null;
    const start = clampPriceChartPointToPlot({ x: drag.startX, y: drag.startY }, meta);
    const current = clampPriceChartPointToPlot({ x: drag.currentX, y: drag.currentY }, meta);
    if (!start || !current) return null;
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    const horizontalOnly = Math.abs(dy) < 24;
    const left = Math.min(start.x, current.x);
    const right = Math.max(start.x, current.x);
    const top = horizontalOnly ? meta.pad.top : Math.min(start.y, current.y);
    const bottom = horizontalOnly ? meta.pad.top + meta.plotH : Math.max(start.y, current.y);
    return {
      left,
      right,
      top,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
      horizontalOnly,
      moved: Math.hypot(dx, dy) >= 4
    };
  }

  function drawChartDragOverlay(ctx, meta, selection) {
    if (!ctx || !meta || !selection?.moved || selection.width < 2 || selection.height < 2) return;
    const plotLeft = meta.pad.left;
    const plotTop = meta.pad.top;
    const plotRight = meta.pad.left + meta.plotW;
    const plotBottom = meta.pad.top + meta.plotH;
    ctx.save();
    ctx.fillStyle = root.dataset.theme === 'light' ? 'rgba(0,0,0,.42)' : 'rgba(248,241,223,.16)';
    ctx.fillRect(plotLeft, plotTop, meta.plotW, selection.top - plotTop);
    ctx.fillRect(plotLeft, selection.bottom, meta.plotW, plotBottom - selection.bottom);
    ctx.fillRect(plotLeft, selection.top, selection.left - plotLeft, selection.height);
    ctx.fillRect(selection.right, selection.top, plotRight - selection.right, selection.height);
    ctx.strokeStyle = root.dataset.theme === 'light' ? 'rgba(248,241,223,.72)' : 'rgba(0,0,0,.82)';
    ctx.lineWidth = 1.25;
    ctx.strokeRect(selection.left, selection.top, selection.width, selection.height);
    ctx.restore();
  }

  function defaultBalanceChartVisibleSeries() {
    return Object.fromEntries(BALANCE_CHART_SERIES.map(series => [series.key, series.defaultVisible]));
  }

  function readBalanceChartVisibleSeries() {
    const defaults = defaultBalanceChartVisibleSeries();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_BALANCE_CHART_VISIBLE_SERIES) || 'null');
      if (!saved || typeof saved !== 'object') return defaults;
      return Object.fromEntries(BALANCE_CHART_SERIES.map(series => [
        series.key,
        typeof saved[series.key] === 'boolean' ? saved[series.key] : defaults[series.key]
      ]));
    } catch (_) {
      return defaults;
    }
  }

  function saveBalanceChartVisibleSeries() {
    try {
      localStorage.setItem(STORAGE_BALANCE_CHART_VISIBLE_SERIES, JSON.stringify(balanceChartVisibleSeries));
    } catch (_) {}
  }

  function readBalanceChartBackgroundHidden() {
    try {
      return localStorage.getItem(STORAGE_BALANCE_CHART_BACKGROUND_HIDDEN) === 'true';
    } catch (_) {
      return false;
    }
  }

  function saveBalanceChartBackgroundHidden(hidden) {
    try {
      localStorage.setItem(STORAGE_BALANCE_CHART_BACKGROUND_HIDDEN, String(Boolean(hidden)));
    } catch (_) {}
  }

  function normalizeAngle(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return ((n % 360) + 360) % 360;
  }

  function normalizeViewMode(value) {
    return ['front', 'back', 'hologram'].includes(value) ? value : null;
  }

  function readSavedViewState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_VIEW_STATE) || 'null');
      if (!saved || typeof saved !== 'object') return null;
      return {
        angle: normalizeAngle(saved.angle),
        tilt: clampNumber(saved.tilt, FACE_ON_TILT, TILT_MIN, TILT_MAX),
        speedValue: clampNumber(saved.speedValue, Number(speedInput.value), Number(speedInput.min), Number(speedInput.max)),
        zoomValue: clampNumber(saved.zoomValue, Number(zoomInput.value), Number(zoomInput.min), Number(zoomInput.max)),
        running: saved.running === true,
        viewMode: normalizeViewMode(saved.viewMode)
      };
    } catch (_) {
      return null;
    }
  }

  function readSavedAllItemsViewMode() {
    try {
      return normalizeViewMode(localStorage.getItem(STORAGE_ALL_ITEMS_VIEW_MODE)) || 'front';
    } catch (_) {
      return 'front';
    }
  }

  function saveAllItemsViewMode(mode) {
    try {
      localStorage.setItem(STORAGE_ALL_ITEMS_VIEW_MODE, normalizeViewMode(mode) || 'front');
    } catch (_) {}
  }

  function normalizeGradedMediaMode(mode) {
    return ['model', 'case', 'front', 'back'].includes(mode) ? mode : null;
  }

  function readSavedGradedMediaMode() {
    try {
      return normalizeGradedMediaMode(localStorage.getItem(STORAGE_GRADED_MEDIA_MODE)) || 'model';
    } catch (_) {
      return 'model';
    }
  }

  function readSavedGradedMediaSelection() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_GRADED_MEDIA_SELECTION) || 'null');
      if (!saved || typeof saved !== 'object') return null;
      const address = String(saved.address || '').trim();
      const gradedRecordId = String(saved.gradedRecordId || '').trim();
      const rawSlug = String(saved.slug || '').trim();
      const slug = ALL_ITEMS_PACKING.items.some(item => item.slug === rawSlug)
        ? rawSlug
        : (GRADED_SELECTION_SLUGS_BY_ADDRESS[address] || '');
      return address ? { address, gradedRecordId, mode: validLeftPanelMode(saved.mode), slug, allItems: saved.allItems === true } : null;
    } catch (_) {
      return null;
    }
  }

  function saveGradedMediaMode(mode) {
    const normalized = normalizeGradedMediaMode(mode) || 'model';
    try {
      localStorage.setItem(STORAGE_GRADED_MEDIA_MODE, normalized);
    } catch (_) {}
  }

  function saveGradedMediaSelection(mode = leftPanelMode) {
    const selected = selectedTrackerEntry(currentBalanceChartRows, mode);
    const address = String(selected?.address || '').trim();
    const gradedRecordId = mode === 'graded' ? String(selected?.gradedRecordId || selected?.gradedRecord?.gradedRecordId || '').trim() : '';
    const slug = selected
      ? (SHARED_STATS_SLUGS[selected.slug] || selected.slug || GRADED_SELECTION_SLUGS_BY_ADDRESS[address] || '')
      : '';
    try {
      if (!address) {
        localStorage.removeItem(STORAGE_GRADED_MEDIA_SELECTION);
        return;
      }
      localStorage.setItem(STORAGE_GRADED_MEDIA_SELECTION, JSON.stringify({
        address,
        gradedRecordId,
        mode: validLeftPanelMode(mode),
        slug,
        allItems: allItemsSelected()
      }));
      if (allItemsSelected()) saveActiveSlug(ALL_ITEMS_GROUP_KEY);
    } catch (_) {}
  }

  const savedViewState = readSavedViewState();
  if (savedViewState) {
    speedInput.value = savedViewState.speedValue;
    speedValueInput.value = `${Math.round(Number(speedInput.value) / DEFAULT_SPEED_VALUE * 100)}%`;
    zoomInput.value = savedViewState.zoomValue;
    zoomValueInput.value = `${savedViewState.zoomValue}%`;
    root.style.setProperty('--zoom', savedViewState.zoomValue / 100);
  }
  speedValueInput.value = `${Math.round(Number(speedInput.value) / DEFAULT_SPEED_VALUE * 100)}%`;
  zoomValueInput.value = `${zoomInput.value}%`;
  quarterComparisonInput.checked = readQuarterComparison();

  let angle = savedViewState?.angle ?? 0;
  let tilt = savedViewState?.tilt ?? FACE_ON_TILT;
  let speed = Number(speedInput.value) / 1000;
  let running = savedViewState?.running ?? false;
  toggle.classList.toggle('is-running', running);
  toggle.setAttribute('aria-label', running ? 'Stop spinning' : 'Spin');
  let last = performance.now();
  let dragging = false;
  let pointerId = null;
  let dragTarget = null;
  let lastX = 0;
  let lastY = 0;
  let dragDistance = 0;
  let allItemsModelDragPending = false;
  let allItemsModelDragPointerId = null;
  let allItemsModelDragTarget = null;
  let allItemsModelDragStartX = 0;
  let allItemsModelDragStartY = 0;
  let allItemsSelectedClickTimer = 0;
  let allItemsSelectedClickTime = 0;
  let allItemsSelectedClickX = 0;
  let allItemsSelectedClickY = 0;
  let lastModelTapTime = 0;
  let lastModelTapX = 0;
  let lastModelTapY = 0;
  let lastModelTapTarget = null;
  let allItemsWheelZoomRaf = 0;
  let allItemsWheelZoomSettleTimer = 0;
  let allItemsWheelZoomTarget = null;
  let allItemsWheelZoomAnchor = null;
  let gradedCasePanX = 0;
  let gradedCasePanY = 0;
  let gradedCasePanning = false;
  let gradedCasePanPointerId = null;
  let gradedCasePanLastX = 0;
  let gradedCasePanLastY = 0;
  let gradedCasePanStartX = 0;
  let gradedCasePanStartY = 0;
  let gradedCasePanDistance = 0;
  let gradedCaseWheelZoomTarget = null;
  let gradedCaseWheelZoomRaf = 0;
  let gradedCaseZoomingTimer = 0;
  let orbitDragging = false;
  let orbitPointerId = null;
  let tiltDragging = false;
  let tiltPointerId = null;
  let lastViewStateSave = 0;
  let transformAnimationToken = 0;
  const pinchPointers = new Map();
  let pinchActive = false;
  let pinchStartDistance = 0;
  let pinchStartZoom = 100;
  let pinchTargetMode = 'model';
  let pinchAnchorPoint = null;

  function saveViewState(force = false) {
    const now = performance.now();
    if (!force && now - lastViewStateSave < 400) return;
    lastViewStateSave = now;
    const transformState = {
      angle,
      tilt,
      viewMode: activeViewMode
    };
    try {
      localStorage.setItem(STORAGE_VIEW_STATE, JSON.stringify({
        angle: normalizeAngle(transformState.angle),
        tilt: clampNumber(transformState.tilt, FACE_ON_TILT, TILT_MIN, TILT_MAX),
        speedValue: Number(speedInput.value),
        zoomValue: Number(zoomInput.value),
        running,
        viewMode: normalizeViewMode(transformState.viewMode)
      }));
    } catch (_) {}
  }

  function readSavedAllItemsCrosshair() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_ALL_ITEMS_CROSSHAIR) || 'null');
      const x = Number(saved?.x);
      const y = Number(saved?.y);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    } catch (_) {
      return null;
    }
  }

  function saveAllItemsCrosshair() {
    if (!allItemsCrosshairTarget) return;
    try {
      localStorage.setItem(STORAGE_ALL_ITEMS_CROSSHAIR, JSON.stringify({
        x: Number(allItemsCrosshairTarget.x),
        y: Number(allItemsCrosshairTarget.y)
      }));
    } catch (_) {}
  }

  function readSavedAllItemsWindow() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_ALL_ITEMS_WINDOW) || 'null');
      const x = Number(saved?.x);
      const y = Number(saved?.y);
      const slug = typeof saved?.slug === 'string' && allItemsPackingItem(saved.slug) ? saved.slug : DEFAULT_ALL_ITEMS_FOCUS_SLUG;
      const autoLatest = saved?.autoLatest === true;
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y, slug, autoLatest } : null;
    } catch (_) {
      return null;
    }
  }

  function saveAllItemsWindow() {
    try {
      const slug = allItemsPackingItem(allItemsFocusedSlug)?.slug || DEFAULT_ALL_ITEMS_FOCUS_SLUG;
      const latestSlug = latestRedeemedAllItemsSlug();
      const autoLatest = Boolean(latestSlug && slug === latestSlug);
      localStorage.setItem(STORAGE_ALL_ITEMS_WINDOW, JSON.stringify({
        x: Number(allItemsOffsetX) || 0,
        y: Number(allItemsOffsetY) || 0,
        slug,
        autoLatest
      }));
      allItemsWindowHasSavedState = !autoLatest;
    } catch (_) {}
  }

  function readSavedAllItemsSelection() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_ALL_ITEMS_SELECTION) || 'null');
      if (!saved || typeof saved !== 'object') return null;
      const mode = validLeftPanelMode(saved?.mode);
      const address = String(saved?.address || '').trim();
      const gradedRecordId = String(saved?.gradedRecordId || '').trim();
      const rawSlug = String(saved?.slug || '').trim();
      const slug = ALL_ITEMS_PACKING.items.some(item => item.slug === rawSlug) ? rawSlug : '';
      return { mode, address, gradedRecordId, slug };
    } catch (_) {
      return null;
    }
  }

  function saveAllItemsSelection(mode = leftPanelMode, address = selectedLeftPanelAddressByMode[mode], slug = allItemsFocusedSlug) {
    if (!allItemsMode) return;
    const normalizedAddress = String(address || '').trim();
    const normalizedSlug = allItemsPackingItem(slug)?.slug || allItemsPackingItem(allItemsFocusedSlug)?.slug || DEFAULT_ALL_ITEMS_FOCUS_SLUG;
    try {
      saveActiveSlug(ALL_ITEMS_GROUP_KEY);
      localStorage.setItem(STORAGE_ALL_ITEMS_SELECTION, JSON.stringify({
        mode: validLeftPanelMode(mode),
        address: normalizedAddress,
        gradedRecordId: mode === 'graded' ? selectedLeftPanelRecordId(mode) : '',
        slug: normalizedSlug
      }));
    } catch (_) {}
  }

  const savedAllItemsSelection = readSavedAllItemsSelection();

  function allItemsZoomAnchorPoint(anchor) {
    const x = Number(anchor?.x);
    const y = Number(anchor?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    if (allItemsCrosshairTarget) {
      return {
        x: Number(allItemsCrosshairTarget.x) || 0,
        y: Number(allItemsCrosshairTarget.y) || 0
      };
    }
    return allItemsObjectTargetOffset();
  }

  function currentAllItemsVisualState() {
    const stageRect = allItemsStage?.getBoundingClientRect();
    const image = allItemsStage?.querySelector('.all-items-tile[data-tile-x="0"][data-tile-y="0"]');
    const imageRect = image?.getBoundingClientRect();
    if (!stageRect?.width || !stageRect?.height || !imageRect?.width || !imageRect?.height) return null;
    return {
      stageRect,
      scale: imageRect.width / ALL_ITEMS_PACKING.widthMm,
      offsetX: imageRect.left + imageRect.width / 2 - (stageRect.left + stageRect.width / 2),
      offsetY: imageRect.top + imageRect.height / 2 - (stageRect.top + stageRect.height / 2)
    };
  }

  function gradedCaseModeActive() {
    return !allItemsMode && gradedMediaMode === 'case' && app?.classList.contains('graded-media-case-mode');
  }

  function gradedCaseInteractionRect() {
    const leftRect = leftPanelOpen ? leftDataPanel?.getBoundingClientRect() : null;
    const rightRect = rightPanelOpen ? rightDataPanel?.getBoundingClientRect() : null;
    const bottomRect = bottomPanelOpen ? bottomStack?.getBoundingClientRect() : null;
    return {
      left: leftRect?.right ?? 0,
      right: rightRect?.left ?? window.innerWidth,
      top: topControlsBottom(),
      bottom: bottomRect?.top ?? window.innerHeight
    };
  }

  function eventInGradedCaseInteractionRect(e) {
    if (!gradedCaseModeActive()) return false;
    const rect = gradedCaseInteractionRect();
    return e.clientX >= rect.left
      && e.clientX <= rect.right
      && e.clientY >= rect.top
      && e.clientY <= rect.bottom;
  }

  function updateGradedCaseCursor(e) {
    const inWindow = e ? eventInGradedCaseInteractionRect(e) : false;
    app?.classList.toggle('graded-case-interaction-hover', inWindow && !gradedCaseCursorExcludedTarget(e.target));
  }

  function clearGradedCaseCursor() {
    app?.classList.remove('graded-case-interaction-hover', 'graded-case-panning');
  }

  function applyGradedCasePan() {
    root.style.setProperty('--graded-case-pan-x', `${gradedCasePanX.toFixed(2)}px`);
    root.style.setProperty('--graded-case-pan-y', `${gradedCasePanY.toFixed(2)}px`);
  }

  function resetGradedCasePan() {
    gradedCasePanX = 0;
    gradedCasePanY = 0;
    applyGradedCasePan();
  }

  function currentGradedCaseZoom() {
    return numericCssVar('--zoom') || Number(zoomInput.value) / 100 || 1;
  }

  function adjustGradedCasePanForZoom(oldZoom, newZoom) {
    if (!gradedCaseModeActive() || !oldZoom || !newZoom) return;
    gradedCasePanX = gradedCasePanX * newZoom / oldZoom;
    gradedCasePanY = gradedCasePanY * newZoom / oldZoom;
    applyGradedCasePan();
  }

  function applyZoomValue(value, { allItemsAnchor = null, deferAllItemsSync = false, useAllItemsLayoutRead = true } = {}) {
    const z = Math.round(value);
    const preciseZoom = Number(value);
    const appliedZoom = (numericCssVar('--zoom') || 1) * 100;
    const oldGradedCaseZoom = gradedCaseModeActive() ? currentGradedCaseZoom() : null;
    const allItemsAnchorTarget = allItemsMode ? allItemsZoomAnchorPoint(allItemsAnchor) : null;
    const oldAllItemsVisualState = allItemsMode && useAllItemsLayoutRead ? currentAllItemsVisualState() : null;
    const oldAllItemsScale = allItemsMode ? (oldAllItemsVisualState?.scale || allItemsScalePx(appliedZoom)) : 0;
    const oldAllItemsOffset = oldAllItemsVisualState
      ? { x: oldAllItemsVisualState.offsetX, y: oldAllItemsVisualState.offsetY }
      : { x: allItemsOffsetX, y: allItemsOffsetY };
    const oldAllItemsStageRect = oldAllItemsVisualState?.stageRect || (allItemsMode ? stageCenterRect() : null);
    const allItemsAnchorScreenPoint = allItemsMode && oldAllItemsStageRect ? {
      x: oldAllItemsStageRect.left + oldAllItemsStageRect.width / 2 + allItemsAnchorTarget.x,
      y: oldAllItemsStageRect.top + oldAllItemsStageRect.height / 2 + allItemsAnchorTarget.y
    } : null;
    const anchoredAllItemsWorld = allItemsMode && oldAllItemsScale > 0 ? {
      x: (allItemsAnchorTarget.x - oldAllItemsOffset.x) / oldAllItemsScale,
      y: (allItemsAnchorTarget.y - oldAllItemsOffset.y) / oldAllItemsScale
    } : null;
    zoomInput.value = z;
    zoomValueInput.value = `${z}%`;
    root.style.setProperty('--zoom', preciseZoom / 100);
    if (oldGradedCaseZoom) adjustGradedCasePanForZoom(oldGradedCaseZoom, preciseZoom / 100);
    updateComparisonSpacing(preciseZoom);
    if (allItemsMode) {
      lockAllItemsGridForFrame();
      lockAllItemsZoomForFrame();
      lockAllItemsModelPositionForZoom();
      const newAllItemsScale = allItemsScalePx(preciseZoom);
      const newAllItemsStageRect = stageCenterRect();
      const newAllItemsAnchorTarget = allItemsAnchorScreenPoint && newAllItemsStageRect ? {
        x: allItemsAnchorScreenPoint.x - (newAllItemsStageRect.left + newAllItemsStageRect.width / 2),
        y: allItemsAnchorScreenPoint.y - (newAllItemsStageRect.top + newAllItemsStageRect.height / 2)
      } : allItemsAnchorTarget;
      if (anchoredAllItemsWorld) {
        allItemsOffsetX = newAllItemsAnchorTarget.x - anchoredAllItemsWorld.x * newAllItemsScale;
        allItemsOffsetY = newAllItemsAnchorTarget.y - anchoredAllItemsWorld.y * newAllItemsScale;
      }
      setAllItemsCrosshairTarget(newAllItemsAnchorTarget);
      renderAllItems({ wrap: false, syncTarget: false });
      if (!deferAllItemsSync) {
        rememberAllItemsCenteredWorldPoint();
        syncAllItemsLeftPanelSelectionToCentered({ save: true });
        saveAllItemsWindow();
      }
    }
  }

  function lockAllItemsGridForFrame() {
    if (!allItemsStage) return;
    allItemsStage.classList.add('grid-locked');
    clearTimeout(lockAllItemsGridForFrame.timer);
    lockAllItemsGridForFrame.timer = setTimeout(() => {
      requestAnimationFrame(() => {
        allItemsStage?.classList.remove('grid-locked');
      });
    }, 40);
  }

  function lockAllItemsZoomForFrame() {
    if (!allItemsStage) return;
    allItemsStage.classList.add('zooming');
    clearTimeout(lockAllItemsZoomForFrame.timer);
    lockAllItemsZoomForFrame.timer = setTimeout(() => {
      requestAnimationFrame(() => {
        allItemsStage?.classList.remove('zooming');
      });
    }, 120);
  }

  function lockAllItemsModelPositionForZoom() {
    if (!allItemsMode) return;
    app.classList.add('all-items-model-positioning');
    clearTimeout(lockAllItemsModelPositionForZoom.timer);
    lockAllItemsModelPositionForZoom.timer = setTimeout(() => {
      requestAnimationFrame(() => {
        app.classList.remove('all-items-model-positioning');
      });
    }, 120);
  }

  function cancelTransformAnimation() {
    transformAnimationToken++;
    if (allItemsMode) clearAllItemsRenderedSceneTransform();
  }

  function getOrbitGeometry() {
    const rect = toggle.getBoundingClientRect();
    const styles = getComputedStyle(toggle);
    const borderTopWidth = parseFloat(styles.borderTopWidth) || 0;
    const borderLeftWidth = parseFloat(styles.borderLeftWidth) || borderTopWidth;
    const radius = Math.max(0, Math.min(rect.width, rect.height) / 2 - borderTopWidth / 2);
    return {
      rect,
      width: rect.width,
      height: rect.height,
      radius,
      midX: rect.width / 2,
      midY: rect.height / 2,
      originX: borderLeftWidth,
      originY: borderTopWidth
    };
  }

  function pointOnOrbitPath(phaseAngle, geometry) {
    if (!geometry || !geometry.radius) return { x: 0, y: 0 };
    const radians = normalizeAngle(phaseAngle) * Math.PI / 180;
    return {
      x: geometry.midX + Math.sin(radians) * geometry.radius,
      y: geometry.midY - Math.cos(radians) * geometry.radius
    };
  }

  function angleFromOrbitPoint(pageX, pageY, geometry) {
    if (!geometry) return normalizeAngle(angle);
    const cx = geometry.rect.left + geometry.midX;
    const cy = geometry.rect.top + geometry.midY;
    return normalizeAngle(Math.atan2(pageX - cx, -(pageY - cy)) * 180 / Math.PI);
  }

  function updateOrbitMarker(markerAngle = angle) {
    const geometry = getOrbitGeometry();
    if (!geometry || !geometry.width || !geometry.height) return;
    const { x, y } = pointOnOrbitPath(markerAngle, geometry);
    root.style.setProperty('--orbit-x', `${(x - geometry.originX).toFixed(2)}px`);
    root.style.setProperty('--orbit-y', `${(y - geometry.originY).toFixed(2)}px`);
  }

  function clampTilt(value) {
    return Math.max(TILT_MIN, Math.min(TILT_MAX, value));
  }

  function snapTilt(value) {
    const clamped = clampTilt(value);
    return Math.abs(clamped - FACE_ON_TILT) <= TILT_SNAP_DEGREES ? FACE_ON_TILT : clamped;
  }

  function updateTiltControl() {
    if (!tiltControl) return;
    const trackTop = 2;
    const trackMiddle = 21;
    const trackBottom = 40;
    const clampedTilt = clampTilt(tilt);
    const y = clampedTilt >= FACE_ON_TILT
      ? trackTop + ((TILT_MAX - clampedTilt) / (TILT_MAX - FACE_ON_TILT)) * (trackMiddle - trackTop)
      : trackMiddle + ((FACE_ON_TILT - clampedTilt) / (FACE_ON_TILT - TILT_MIN)) * (trackBottom - trackMiddle);
    tiltControl.style.setProperty('--tilt-control-y', `${y.toFixed(2)}px`);
    tiltControl.setAttribute('aria-valuenow', String(Math.round(clampedTilt)));
  }

  function orbitSnapTarget(rawAngle) {
    const normalized = normalizeAngle(rawAngle);
    const frontDistance = Math.min(normalized, 360 - normalized);
    if (frontDistance <= ORBIT_FACE_SNAP_DEGREES) return { angle: 0, mode: 'front' };
    if (Math.abs(normalized - 180) <= ORBIT_FACE_SNAP_DEGREES) return { angle: 180, mode: 'back' };
    return { angle: normalized, mode: null };
  }

  function syncOrbitSnapMode(mode) {
    if (allItemsMode) {
      activeViewMode = allItemsViewMode;
      syncViewButtons();
      return;
    }
    if (mode) {
      activeViewMode = mode;
      syncViewButtons();
      return;
    }
    clearViewMode();
  }

  function setAngleFromOrbitPointer(e) {
    const snap = orbitSnapTarget(angleFromOrbitPoint(e.clientX, e.clientY, getOrbitGeometry()));
    angle = snap.angle;
    syncOrbitSnapMode(snap.mode);
    setTransform({ save: false });
  }

  function setZoomValue(value, {
    clearView = false,
    save = false,
    snap = false,
    allItemsAnchor = null,
    deferAllItemsSync = false,
    useAllItemsLayoutRead = true
  } = {}) {
    const previous = Number(zoomInput.value);
    const min = Number(zoomInput.min);
    const max = Number(zoomInput.max);
    const numericValue = typeof value === 'string' ? value.replace('%', '').trim() : value;
    let z = Math.round(clampNumber(numericValue, previous, min, max));
    if (snap && Math.abs(z - 100) <= 3) z = 100;
    if (clearView && z !== previous) clearViewMode();
    applyZoomValue(z, { allItemsAnchor, deferAllItemsSync, useAllItemsLayoutRead });
    if (save) saveViewState(true);
  }

  function settleAllItemsWheelZoom() {
    allItemsWheelZoomSettleTimer = 0;
    if (!allItemsMode) return;
    rememberAllItemsCenteredWorldPoint();
    syncAllItemsLeftPanelSelectionToCentered({ save: true, revealModel: false });
    saveViewState(true);
  }

  function scheduleAllItemsWheelZoom(deltaY) {
    cancelTransformAnimation();
    const min = Number(zoomInput.min);
    const max = Number(zoomInput.max);
    const start = allItemsWheelZoomTarget ?? Number(zoomInput.value);
    let target = Math.max(min, Math.min(max, start - Math.sign(deltaY) * 4));
    if (Math.abs(target - 100) <= 3) target = 100;
    allItemsWheelZoomTarget = target;
    allItemsWheelZoomAnchor = allItemsWheelZoomAnchor || allItemsZoomAnchorPoint();
    clearTimeout(allItemsWheelZoomSettleTimer);
    allItemsWheelZoomSettleTimer = setTimeout(settleAllItemsWheelZoom, 140);
    if (allItemsWheelZoomRaf) return;
    allItemsWheelZoomRaf = requestAnimationFrame(() => {
      allItemsWheelZoomRaf = 0;
      const nextZoom = allItemsWheelZoomTarget;
      const anchor = allItemsWheelZoomAnchor;
      allItemsWheelZoomTarget = null;
      allItemsWheelZoomAnchor = null;
      setZoomValue(nextZoom, {
        save: false,
        snap: true,
        allItemsAnchor: anchor,
        deferAllItemsSync: true,
        useAllItemsLayoutRead: false
      });
    });
  }

  function clearGradedCaseZoomingSoon() {
    clearTimeout(gradedCaseZoomingTimer);
    gradedCaseZoomingTimer = setTimeout(() => {
      requestAnimationFrame(() => gradedCaseScene?.classList.remove('zooming'));
    }, 140);
  }

  function scheduleGradedCaseWheelZoom(deltaY) {
    cancelTransformAnimation();
    gradedCaseScene?.classList.add('zooming');
    clearGradedCaseZoomingSoon();
    const min = Number(zoomInput.min);
    const max = Number(zoomInput.max);
    const start = gradedCaseWheelZoomTarget ?? Number(zoomInput.value);
    let target = Math.max(min, Math.min(max, start - Math.sign(deltaY) * 4));
    if (Math.abs(target - 100) <= 3) target = 100;
    gradedCaseWheelZoomTarget = target;
    if (gradedCaseWheelZoomRaf) return;
    gradedCaseWheelZoomRaf = requestAnimationFrame(() => {
      gradedCaseWheelZoomRaf = 0;
      const nextZoom = gradedCaseWheelZoomTarget;
      gradedCaseWheelZoomTarget = null;
      setZoomValue(nextZoom, { save: true, snap: true });
    });
  }

  function animateZoomTo(targetZoom = 100) {
    const token = ++transformAnimationToken;
    const min = Number(zoomInput.min);
    const max = Number(zoomInput.max);
    const startZoom = Number(zoomInput.value);
    const endZoom = clampNumber(targetZoom, 100, min, max);
    if (!Number.isFinite(startZoom) || Math.abs(startZoom - endZoom) < 0.1) {
      applyZoomValue(endZoom);
      saveViewState(true);
      return;
    }
    const start = performance.now();
    const duration = 420;
    function step(now) {
      if (token !== transformAnimationToken) return;
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const ease = 1 - Math.pow(1 - t, 3);
      applyZoomValue(startZoom + (endZoom - startZoom) * ease);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        applyZoomValue(endZoom);
        saveViewState(true);
      }
    }
    requestAnimationFrame(step);
  }

  function manualZoomValue() {
    const value = Number(String(zoomValueInput.value).replace('%', '').trim());
    if (!Number.isFinite(value)) return null;
    if (value < Number(zoomInput.min)) return null;
    return Math.min(Number(zoomInput.max), value);
  }

  function commitZoomValue() {
    setZoomValue(zoomValueInput.value || zoomInput.value, { save: true });
  }

  function expandSearch() {
    addressSearchControl.classList.add('expanded');
    requestAnimationFrame(() => addressSearchInput.focus());
  }

  function collapseSearch() {
    addressSearchInput.blur();
    addressSearchInput.value = '';
    addressSearchInput.classList.remove('search-miss');
    addressSearchControl.classList.remove('expanded');
  }

  function speedPercentText(value) {
    return `${Math.round(Number(value) / DEFAULT_SPEED_VALUE * 100)}%`;
  }

  function setSpeedValue(value, { save = false, snap = false } = {}) {
    const previous = Number(speedInput.value);
    const min = Number(speedInput.min);
    const max = Number(speedInput.max);
    const numericValue = typeof value === 'string' ? value.replace('%', '').trim() : value;
    let v = Math.round(clampNumber(numericValue, previous, min, max) * 2) / 2;
    if (snap && Math.abs(v - DEFAULT_SPEED_VALUE) <= (max - min) * ZOOM_SNAP_TRACK_RATIO) v = DEFAULT_SPEED_VALUE;
    speedInput.value = v;
    speedValueInput.value = speedPercentText(v);
    speed = v / 1000;
    if (save) saveViewState(true);
  }

  function manualSpeedValue() {
    const value = Number(String(speedValueInput.value).replace('%', '').trim());
    if (!Number.isFinite(value)) return null;
    return value / 100 * DEFAULT_SPEED_VALUE;
  }

  function commitSpeedValue() {
    if (speedValueInput.value === '') {
      setSpeedValue(speedInput.value, { save: true });
      return;
    }
    const value = manualSpeedValue();
    if (value === null) {
      speedValueInput.value = speedPercentText(speedInput.value);
      return;
    }
    setSpeedValue(value, { save: true });
  }

  function readSavedSlug() {
    try {
      const saved = localStorage.getItem(STORAGE_ACTIVE_SLUG);
      if (saved === ALL_ITEMS_GROUP_KEY) return saved;
      if (saved === LEGACY_DEFAULT_ACTIVE_SLUG) return ALL_ITEMS_GROUP_KEY;
      const coin = COINS.find(c => c.slug === saved);
      return coin ? saved : null;
    } catch (_) {
      return null;
    }
  }

  function saveActiveSlug(slug) {
    try {
      localStorage.setItem(STORAGE_ACTIVE_SLUG, slug);
    } catch (_) {}
  }

  function denominationValue(c) {
    const explicitRaw = c?.denominationBtc;
    const explicit = Number(explicitRaw);
    if (explicitRaw !== null && explicitRaw !== undefined && Number.isFinite(explicit) && explicit >= 0) return explicit;
    const match = String(c.label || '').match(/([\d.]+)\s*BTC/i);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
  }

  function objectShape(c) {
    return c.shape === 'bar' ? 'bar' : 'coin';
  }

  function groupKey(c) {
    if (c?.slug === 'cas_aluminum_2013') return 'coin:aluminum';
    return `${objectShape(c)}:${denominationValue(c)}`;
  }

  function seriesValue(c) {
    const explicit = Number(c.version);
    if (Number.isFinite(explicit)) return explicit;
    const match = String(c.series || c.label || '').match(/Series\s*([\d.]+)/i);
    return match ? Number(match[1]) : 0;
  }

  function issueVariantRank(c) {
    if (c?.slug === 'cas_5btc_2012_bitnickel_mule') return 1;
    const isOneBtcSeriesOne = objectShape(c) === 'coin' && denominationValue(c) === 1 && seriesValue(c) === 1;
    return isOneBtcSeriesOne && /mule/i.test(String(c.label || '')) ? 1 : 0;
  }

  function issueSort(a, b) {
    return (issueVariantRank(a) - issueVariantRank(b))
      || (Number(a.year || 0) - Number(b.year || 0))
      || (seriesValue(a) - seriesValue(b))
      || String(a.label).localeCompare(String(b.label));
  }

  function groupLabel(c) {
    if (c.groupLabel) return c.groupLabel;
    if (c?.slug === 'cas_aluminum_2013') return 'Aluminum Coin';
    return `${mmText(denominationValue(c))} BTC ${objectShape(c) === 'coin' ? 'Coin' : 'Bar'}`;
  }

  function groupSortValue(group) {
    if (group.coins[0]?.slug === 'cas_aluminum_2013') return 0.05;
    const custom = Number(group.coins[0]?.groupSort);
    return Number.isFinite(custom) ? custom : group.denomination;
  }

  function buildCoinGroups() {
    const byKey = new Map();
    COINS.forEach((coin) => {
      const key = groupKey(coin);
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          shape: objectShape(coin),
          denomination: coin.slug === 'cas_aluminum_2013' ? 0.05 : denominationValue(coin),
          label: groupLabel(coin),
          coins: []
        });
      }
      byKey.get(key).coins.push(coin);
    });
    return [...byKey.values()]
      .map(group => ({ ...group, coins: group.coins.sort(issueSort) }))
      .sort((a, b) => (a.shape === b.shape ? 0 : (a.shape === 'coin' ? -1 : 1)) || (groupSortValue(a) - groupSortValue(b)));
  }

  function buildNavigationGroups() {
    return [
      {
        key: ALL_ITEMS_GROUP_KEY,
        shape: 'all',
        denomination: 0,
        label: ALL_ITEMS_LABEL,
        coins: []
      },
      ...buildCoinGroups()
    ];
  }

  function readSavedGroupSelections() {
    const selections = new Map();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_GROUP_SELECTIONS) || '{}');
      if (!saved || typeof saved !== 'object') return selections;
      Object.entries(saved).forEach(([key, slug]) => {
        const group = COIN_GROUPS.find(g => g.key === key);
        if (group && group.coins.some(c => c.slug === slug)) selections.set(key, slug);
      });
    } catch (_) {}
    return selections;
  }

  function saveGroupSelections() {
    try {
      localStorage.setItem(STORAGE_GROUP_SELECTIONS, JSON.stringify(Object.fromEntries(groupSelections)));
    } catch (_) {}
  }

  function rememberGroupSelection(c) {
    groupSelections.set(groupKey(c), c.slug);
    saveGroupSelections();
  }

  function rememberedGroupSlug(group) {
    const saved = groupSelections.get(group.key);
    return group.coins.some(c => c.slug === saved) ? saved : group.coins[0].slug;
  }

  function groupThumbCoin(group) {
    return group.coins.find(c => c.slug === rememberedGroupSlug(group)) || group.coins[0];
  }

  function coinFrontThumbData(c) {
    return c?.frontThumbData || c?.frontData || '';
  }

  function applyTabThumb(thumb, c) {
    if (!thumb || !c) return;
    const isBar = c.shape === 'bar';
    thumb.style.backgroundImage = cssUrl(coinFrontThumbData(c), { compact: true });
    thumb.style.backgroundPosition = c.thumbPosition || c.frontPosition || 'center';
    thumb.style.backgroundSize = isBar ? '12px 24px' : (c.thumbBackgroundSize || c.frontBackgroundSize || 'cover');
  }

  function applyAllItemsIcon(icon) {
    if (!icon) return;
    [
      ['.all-bar', 'cas_bar_100btc_gp'],
      ['.all-coin-tl', 'cas_1btc_2013_gold_rim_silver'],
      ['.all-coin-tr', 'cas_5btc_2012_bitnickel'],
      ['.all-coin-br', 'cas_25btc_2011_gp'],
      ['.all-coin-bl', 'cas_0p1btc_2013_silver_s3']
    ].forEach(([selector, slug]) => {
      const el = icon.querySelector(selector);
      const c = COINS.find(coin => coin.slug === slug);
      if (!el || !c) return;
      const isBar = c.shape === 'bar';
      el.style.backgroundImage = cssUrl(coinFrontThumbData(c), { compact: true });
      el.style.backgroundPosition = c.thumbPosition || c.frontPosition || 'center';
      el.style.backgroundSize = isBar ? 'contain' : (c.thumbBackgroundSize || c.frontBackgroundSize || 'cover');
    });
  }

  const COIN_GROUPS = buildNavigationGroups();
  const GROUP_REPEATS = 3;
  const groupSelections = readSavedGroupSelections();
  const savedAllItemsWindow = readSavedAllItemsWindow();
  const savedAllItemsLegacyDefault = savedAllItemsWindow?.slug === DEFAULT_ALL_ITEMS_FOCUS_SLUG;
  const savedAllItemsAutoLatest = savedAllItemsWindow?.autoLatest === true;
  const savedGradedMediaMode = readSavedGradedMediaMode();
  const savedGradedMediaSelection = readSavedGradedMediaSelection();
  const savedActiveSlug = readSavedSlug();
  const savedGradedActiveSlug = savedActiveSlug !== ALL_ITEMS_GROUP_KEY
    && savedGradedMediaMode !== 'model'
    && savedGradedMediaSelection?.slug
    && savedGradedMediaSelection.allItems !== true
    ? savedGradedMediaSelection.slug
    : null;
  let activeSlug = savedActiveSlug === ALL_ITEMS_GROUP_KEY
    ? ALL_ITEMS_GROUP_KEY
    : savedGradedActiveSlug
    || savedActiveSlug
    || DEFAULT_ACTIVE_SLUG
    || COINS[0]?.slug
    || COINS[0].slug;
  let activeGroupKey = activeSlug === ALL_ITEMS_GROUP_KEY ? ALL_ITEMS_GROUP_KEY : groupKey(COINS.find(x => x.slug === activeSlug) || COINS[0]);
  let allItemsMode = false;
  let allItemsBuilt = false;
  let allItemsOffsetX = (savedAllItemsLegacyDefault || savedAllItemsAutoLatest) ? 0 : (savedAllItemsWindow?.x || 0);
  let allItemsOffsetY = (savedAllItemsLegacyDefault || savedAllItemsAutoLatest) ? 0 : (savedAllItemsWindow?.y || 0);
  let allItemsWindowHasSavedState = Boolean(savedAllItemsWindow) && !savedAllItemsLegacyDefault && !savedAllItemsAutoLatest;
  let allItemsCrosshairTarget = readSavedAllItemsCrosshair();
  let allItemsPointerId = null;
  let allItemsDragging = false;
  let allItemsLastX = 0;
  let allItemsLastY = 0;
  let allItemsStartX = 0;
  let allItemsStartY = 0;
  let allItemsDragDistance = 0;
  let allItemsCaptureTarget = null;
  let allItemsCenteredWorldPoint = null;
  let bottomPanelClosing = false;
  let bottomPanelClosingTimer = 0;
  let bottomPanelOpeningDockTimer = 0;
  let tabScrollRaf = 0;
  let resizeRaf = 0;
  let balanceChartRedrawRaf = 0;
  let suppressTabNormalize = false;
  let suppressTabNormalizeTimer = 0;
  let tabAlignToken = 0;
  let tabScrollAnimationRaf = 0;
  let versionPanelAnimationRaf = 0;
  let versionPanelAnimationToken = 0;
  let tabDragPointerId = null;
  let tabDragStartX = 0;
  let tabDragStartScroll = 0;
  let tabDragMoved = false;
  let suppressNextTabClick = false;
  let suppressTabClickTimer = 0;
  let bottomDragPointerId = null;
  let bottomDragStartX = 0;
  let bottomDragStartScroll = 0;
  let bottomDragMoved = false;
  let leftPanelDragPointerId = null;
  let leftPanelDragStartY = 0;
  let leftPanelDragStartScroll = 0;
  let leftPanelDragMoved = false;
  let leftPanelSuppressClick = false;
  let selectionToken = 0;
  const stageLoadingKeys = new Set();
  let quarterLayoutAnimationToken = 0;
  let sceneLayoutAnimationToken = 0;
  let allItemsLayoutAnimationToken = 0;
  let allItemsModelPositionRaf = 0;
  let suppressAllItemsQuarterDockUpdate = false;
  let quarterExitToken = 0;
  let quarterExitClone = null;
  let activeViewMode = savedViewState?.viewMode ?? null;
  let allItemsViewMode = readSavedAllItemsViewMode();
  let allItemsFocusedSlug = savedAllItemsLegacyDefault ? DEFAULT_ALL_ITEMS_FOCUS_SLUG : (savedAllItemsWindow?.slug || DEFAULT_ALL_ITEMS_FOCUS_SLUG);
  let allItemsDefaultFocusPending = !savedAllItemsWindow || savedAllItemsLegacyDefault || savedAllItemsAutoLatest;
  let allItemsSelectionRestorePending = Boolean(savedAllItemsSelection);
  let allItemsBootCrosshairTarget = null;
  let allItemsExtraScene = null;
  let versionsCollapsed = readVersionsCollapsed();
  const savedPanelState = readPanelState();
  const savedChartOpen = readBalanceChartOpen();
  const savedChartModalMode = readChartModalMode();
  let leftPanelOpen = savedPanelState.left;
  let bottomPanelOpen = savedPanelState.bottom;
  let rightPanelOpen = savedPanelState.right;
  let leftPanelMode = savedPanelState.leftMode;
  let leftPanelMeasureMode = null;
  let leftPanelTransitionToken = 0;
  let refreshingLeftPanelData = false;
  const leftPanelCounts = { recent: null, active: null, graded: null };
  const leftPanelRowsByMode = { recent: [], active: [], graded: [] };
  const leftPanelVisibleRowsByMode = { recent: LEFT_PANEL_MAX_RENDERED_ROWS, active: LEFT_PANEL_MAX_RENDERED_ROWS, graded: LEFT_PANEL_MAX_RENDERED_ROWS };
  const leftPanelWindowStartByMode = { recent: 0, active: 0, graded: 0 };
  const leftPanelScrollTopByMode = { recent: 0, active: 0, graded: 0 };
  const selectedLeftPanelAddressByMode = { recent: '', active: '', graded: '' };
  const selectedLeftPanelRecordIdByMode = { recent: '', active: '', graded: '' };
  let searchAddressNotFound = false;
  let searchedUnfundedEntry = null;
  let pendingSearchSelection = null;
  let currentBalanceChartRows = [];
  let balanceChartModal = null;
  let shortcutsModal = null;
  let shortcutsCloseButton = null;
  let shortcutsPausedBalanceChart = false;
  let shortcutCommandPressed = false;
  let gradedMediaMode = savedGradedMediaMode;
  let gradedMediaAddress = '';
  let gradedCaseStyle = 'ngc';
  let gradedCaseLoadToken = 0;
  if (activeSlug !== ALL_ITEMS_GROUP_KEY
    && !allItemsMode
    && savedGradedMediaSelection?.address
    && (savedGradedMediaMode !== 'model' || (savedChartOpen && savedChartModalMode === 'price'))) {
    leftPanelMode = savedGradedMediaSelection.mode;
    selectedLeftPanelAddressByMode[leftPanelMode] = savedGradedMediaSelection.address;
    selectedLeftPanelRecordIdByMode[leftPanelMode] = savedGradedMediaSelection.gradedRecordId || '';
    pendingSearchSelection = {
      address: savedGradedMediaSelection.address,
      gradedRecordId: savedGradedMediaSelection.gradedRecordId || '',
      mode: leftPanelMode
    };
  }
  let balanceChartUnit = readBalanceChartUnit();
  let priceChartUnit = readPriceChartUnit();
  let priceChartScale = readPriceChartScale();
  let balanceChartBackgroundHidden = readBalanceChartBackgroundHidden();
  let balanceChartBackgroundHideDeferred = false;
  let balanceChartHoverPoint = null;
  let activeChartModalMode = savedChartOpen ? savedChartModalMode : 'balance';
  const balanceChartVisibleSeries = readBalanceChartVisibleSeries();
  const priceChartVisibleGroups = readPriceChartVisibleGroups();
  let balanceChartZoom = null;
  let balanceChartDrag = null;
  let balanceChartSuppressClick = false;
  let priceChartZoom = null;
  let priceChartDrag = null;
  let priceChartSuppressClick = false;
  let panelRenderToken = 0;
  let trackerIndexPromise = null;
  let unfundedIndexPromise = null;
  let gradedIndexPromise = null;
  let trackerIndexWithGradedPromise = null;
  let dataPanelsRefreshQueued = false;
  let dailyPriceIndexPromise = null;
  let dailyPriceIndexCache = null;
  let seriesPriceIndexPromise = null;
  let seriesPriceIndexCache = null;
  let currentTrackerEntries = [];
  let currentGradedTrackerEntries = [];
  const leftPanelRowsCache = new Map();
  const smoothEdgePaletteCache = new Map();
  const barEdgeTemplateCache = new Map();
  const coinDataLoadPromises = new Map();
  const loadedCoinDataSlugs = new Set();
  let allItemsRevealedModelSlug = null;
  let allItemsModelRevealToken = 0;

  function coinHasInline3dData(coin) {
    return String(coin?.frontData || '').startsWith('data:')
      && String(coin?.backData || '').startsWith('data:');
  }

  COINS.forEach((coin) => {
    if (coinHasInline3dData(coin)) loadedCoinDataSlugs.add(coin.slug);
  });

  function coin3dDataLoaded(slug) {
    const coin = COINS.find(c => c.slug === slug);
    return Boolean(coin && (loadedCoinDataSlugs.has(slug) || coinHasInline3dData(coin)));
  }

  function allItemsFocusedModelRevealed(slug = allItemsFocusedSlug) {
    return Boolean(
      slug
      && allItemsRevealedModelSlug === slug
      && coin3dDataLoaded(slug)
      && model.classList.contains('loaded')
      && !app.classList.contains('all-items-model-pending')
      && !app.classList.contains('all-items-model-hidden')
    );
  }

  function hideAllItemsFocusedModel({ invalidateReveal = true } = {}) {
    if (invalidateReveal) allItemsModelRevealToken++;
    allItemsRevealedModelSlug = null;
    app.classList.add('all-items-model-pending', 'all-items-model-hidden');
    model.classList.remove('loaded');
    model.style.opacity = '0';
    scene.style.opacity = '0';
    scene.style.visibility = 'hidden';
    scene.style.pointerEvents = 'none';
    clearAllItemsRenderedSceneTransform();
    clearAllItemsExtraScene();
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Unable to load ${src}`));
      document.head.appendChild(script);
    });
  }

  function mergeLoadedCoinData(slug) {
    const item = window.CASASCIUS_ITEM_DATA?.[slug];
    const coin = COINS.find(c => c.slug === slug);
    if (!item || !coin) return false;
    const frontThumbData = coin.frontThumbData || coin.frontData;
    const backThumbData = coin.backThumbData || coin.backData;
    Object.assign(coin, item);
    coin.frontThumbData = frontThumbData;
    coin.backThumbData = backThumbData;
    loadedCoinDataSlugs.add(slug);
    return true;
  }

  function loadCoin3dData(slug) {
    const coin = COINS.find(c => c.slug === slug);
    if (!coin) return Promise.resolve(null);
    if (coin3dDataLoaded(slug)) return Promise.resolve(coin);
    if (coinDataLoadPromises.has(slug)) return coinDataLoadPromises.get(slug);
    const src = `${CASASCIUS_ITEM_DATA_PATH}${encodeURIComponent(slug)}.js`;
    const promise = loadScriptOnce(src)
      .then(() => {
        if (!mergeLoadedCoinData(slug)) throw new Error(`Missing Casascius item data for ${slug}`);
        return coin;
      })
      .catch((error) => {
        coinDataLoadPromises.delete(slug);
        throw error;
      });
    coinDataLoadPromises.set(slug, promise);
    return promise;
  }

  function scheduleRemainingCoinDataLoad() {
    const slugs = COINS.map(c => c.slug).filter(slug => !coin3dDataLoaded(slug));
    if (!slugs.length) return;
    let index = 0;
    const loadNext = () => {
      if (index >= slugs.length) return;
      const slug = slugs[index++];
      loadCoin3dData(slug).catch(() => {});
      schedule(loadNext);
    };
    const schedule = (fn) => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: 2500 });
      else setTimeout(fn, 650);
    };
    schedule(loadNext);
  }

  const metalVars = {
    gold:   ['#fff0a9', '#d09b36', '#5b3912', '#f8c85a'],
    brass:  ['#e6c674', '#a9712d', '#4b3315', '#d79d3f'],
    nickel: ['#f2f0e7', '#a9a9a2', '#4a4d4c', '#d7d6ce'],
    silver: ['#ffffff', '#bfc3c7', '#555b60', '#e4e7e8']
  };

  const MAX_PHYSICAL_MM = Math.max(...COINS.map(c => c.shape === 'bar'
    ? Math.max(Number(c.widthMm || 0), Number(c.heightMm || 0))
    : Number(c.diameterMm || 0)
  )) || 80;
  const CSS_PX_PER_MM = 96 / 25.4;
  const DISPLAY_SIZE_CORRECTION = 1.47;
  const APPLE_DISPLAY_PROFILES = [
    { name: 'iPhone 17 / 17 Pro / 16 Pro', width: 402, height: 874, dpr: 3, ppi: 460 },
    { name: 'iPhone 17 Pro Max / 16 Pro Max', width: 440, height: 956, dpr: 3, ppi: 460 },
    { name: 'iPhone Air', width: 420, height: 912, dpr: 3, ppi: 460 },
    { name: 'iPhone 17e / 15 / 14 / 13', width: 390, height: 844, dpr: 3, ppi: 460 },
    { name: 'iPhone 16', width: 393, height: 852, dpr: 3, ppi: 460 },
    { name: 'iPhone 16 Plus / 15 Plus / 14 Plus', width: 430, height: 932, dpr: 3, ppi: 460 },
    { name: 'iPad mini', width: 744, height: 1133, dpr: 2, ppi: 326 },
    { name: 'iPad 11-inch / iPad Air 11-inch', width: 820, height: 1180, dpr: 2, ppi: 264 },
    { name: 'iPad Pro 11-inch', width: 834, height: 1194, dpr: 2, ppi: 264 },
    { name: 'iPad Air 13-inch / iPad Pro 13-inch', width: 1032, height: 1376, dpr: 2, ppi: 264 },
    { name: 'iPad Pro 12.9-inch', width: 1024, height: 1366, dpr: 2, ppi: 264 }
  ];

  function normalizedDisplaySize(width, height) {
    const w = Math.round(Number(width) || 0);
    const h = Math.round(Number(height) || 0);
    if (!w || !h) return null;
    return {
      width: Math.min(w, h),
      height: Math.max(w, h),
      dpr: Number(window.devicePixelRatio) || 1
    };
  }

  function normalizedDisplayCandidates() {
    const candidates = [
      normalizedDisplaySize(window.screen?.width, window.screen?.height),
      normalizedDisplaySize(window.innerWidth, window.innerHeight),
      normalizedDisplaySize(window.visualViewport?.width, window.visualViewport?.height)
    ].filter(Boolean);
    return candidates.filter((candidate, index) => {
      return candidates.findIndex(item => item.width === candidate.width && item.height === candidate.height) === index;
    });
  }

  function isAppleHandheld() {
    const platform = String(navigator.platform || '');
    const ua = String(navigator.userAgent || '');
    return /iPhone|iPad|iPod/.test(platform)
      || /iPhone|iPad|iPod/.test(ua)
      || (platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
  }

  function displayProfilePxPerMm() {
    if (!isAppleHandheld()) return null;
    const displayCandidates = normalizedDisplayCandidates();
    const displaySize = displayCandidates.reduce((best, candidate) => {
      if (!best) return candidate;
      return candidate.width * candidate.height > best.width * best.height ? candidate : best;
    }, null);
    const profile = APPLE_DISPLAY_PROFILES.find(candidate => {
      return displayCandidates.some(display => {
        const sizeMatch = Math.abs(display.width - candidate.width) <= 2
          && Math.abs(display.height - candidate.height) <= 2;
        return sizeMatch && Math.abs(display.dpr - candidate.dpr) < 0.15;
      });
    });
    const ppi = profile?.ppi
      || (displaySize?.dpr >= 2.8 ? 460 : null)
      || (displaySize?.dpr >= 1.8 && displaySize.width <= 760 ? 326 : null)
      || (displaySize?.dpr >= 1.8 && displaySize.width <= 1100 ? 264 : null);
    if (!ppi || !displaySize?.dpr) return null;
    root.dataset.physicalSizeProfile = profile?.name || `Apple ${displaySize.width}x${displaySize.height}@${displaySize.dpr}`;
    return ppi / (25.4 * displaySize.dpr);
  }

  function baseObjectSizePx() {
    const profilePxPerMm = displayProfilePxPerMm();
    if (profilePxPerMm) return MAX_PHYSICAL_MM * profilePxPerMm;
    // Match a calibrated 16.2" MacBook Pro ruler scale instead of browser-default CSS mm.
    root.dataset.physicalSizeProfile = 'Calibrated MacBook fallback';
    return MAX_PHYSICAL_MM * CSS_PX_PER_MM * DISPLAY_SIZE_CORRECTION;
  }

  function activeCoin() {
    return COINS.find(x => x.slug === activeSlug) || COINS[0];
  }

  function coinBySlug(slug) {
    return COINS.find(x => x.slug === slug) || null;
  }

  function allItemsFocusedCoin() {
    return coinBySlug(allItemsFocusedSlug) || coinBySlug(DEFAULT_ALL_ITEMS_FOCUS_SLUG) || COINS[0];
  }

  function comparisonCoin() {
    return allItemsMode ? allItemsFocusedCoin() : activeCoin();
  }

  function allItemsSelected() {
    return allItemsMode || activeGroupKey === ALL_ITEMS_GROUP_KEY || activeSlug === ALL_ITEMS_GROUP_KEY;
  }

  function mmText(n) {
    return Number.isInteger(n) ? String(n) : String(n).replace(/\.0$/, '');
  }

  function btcDenominationText(value) {
    if (!Number.isFinite(value)) return '—';
    if (value > 0 && value < 0.0001) {
      const sats = Math.round(value * 100000000);
      return `${formatInteger(sats)} ${sats === 1 ? 'sat' : 'sats'}`;
    }
    return `${mmText(value)} BTC`;
  }

  function btcDenominationRangeText(values) {
    const numbers = values.filter(Number.isFinite);
    if (!numbers.length) return '—';
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    return min === max ? btcDenominationText(min) : `${btcDenominationText(min)} - ${btcDenominationText(max)}`;
  }

  function diyBarLoadedValue(entry) {
    const values = [entry?.value, entry?.balance].filter(Number.isFinite);
    return values.length ? Math.max(...values) : null;
  }

  function entryDenominationText(entry, coin = null) {
    const slug = coin?.slug || entry?.slug;
    if (slug === 'cas_bar_diy_gold_s2') return btcDenominationText(diyBarLoadedValue(entry));
    return formatBtc(entry?.value);
  }

  function denominationInfoText(coin, rows = []) {
    if (coin?.slug === 'cas_bar_diy_gold_s2') {
      return btcDenominationRangeText(rows.map(diyBarLoadedValue));
    }
    const denomination = denominationValue(coin);
    return Number.isFinite(denomination) ? `${mmText(denomination)} BTC` : '—';
  }

  function dimensionText(c) {
    const weight = c.weight ? `, ${c.weight}` : '';
    if (c.shape === 'bar') {
      return `(${mmText(c.widthMm)} mm x ${mmText(c.heightMm)} mm x ${mmText(c.thicknessMm)} mm${weight})`;
    }
    return `(${mmText(c.diameterMm)} mm x ${mmText(c.thicknessMm)} mm${weight})`;
  }

  function dimensionsOnlyText(c) {
    if (c.shape === 'bar') {
      return `${mmText(c.widthMm)} mm x ${mmText(c.heightMm)} mm x ${mmText(c.thicknessMm)} mm`;
    }
    return `${mmText(c.diameterMm)} mm x ${mmText(c.thicknessMm)} mm`;
  }

  function materialDescriptor(c) {
    let text = String(c.label || '')
      .replace(/^\s*[\d.]+ BTC\s*/i, '')
      .replace(/\b[\d.]+ BTC\b\s*/i, '')
      .replace(/\b20\d{2}\b/gi, '')
      .replace(/Series\s*[\d.]+/gi, '')
      .replace(/\b(?:coin|bar)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (c.shape === 'bar') text = text.replace(/\bGold\b/i, 'Gold Plated Alloy');
    if (denominationValue(c) === 25) text = text.replace(/\bGold-Plated\b/i, 'Gold Plated Alloy');
    return text;
  }

  function isMuleCoin(c) {
    return /mule/i.test(String(c?.slug || '')) || /mule/i.test(String(c?.label || ''));
  }

  function rightPanelMaterialDescriptor(c) {
    if (/bitnickel/i.test(String(c?.slug || ''))) return 'Nickel Plated Alloy';
    return materialDescriptor(c);
  }

  function panelDisplayName(c) {
    const denomination = denominationValue(c);
    const denominationText = Number.isFinite(denomination) ? `${mmText(denomination)} BTC` : '';
    const type = objectShape(c) === 'coin' ? 'Coin' : 'Bar';
    if (isMuleCoin(c)) {
      const material = materialDescriptor(c).replace(/\bMule\b/gi, '').replace(/\s+/g, ' ').trim();
      return [c.year, denominationText, 'Mule', material, type].filter(Boolean).join(' ');
    }
    const series = c.series || `Series ${seriesValue(c)}`;
    const material = materialDescriptor(c);
    const colorSuffixes = [];
    const baseMaterial = material
      .replace(/\s*(?:w\/\s*)?Gold Rim\b/i, () => {
        colorSuffixes.push('Gold Rim');
        return '';
      })
      .replace(/\s*(?:w\/\s*)?Gold B\b/i, () => {
        colorSuffixes.push('Gold B');
        return '';
      })
      .replace(/\s+/g, ' ')
      .trim();
    const suffix = colorSuffixes.length ? `w/ ${colorSuffixes.join(', ')}` : '';
    return [c.year, denominationText, series, baseMaterial, type, suffix]
      .filter(Boolean)
      .join(' ');
  }

  function chartDisplayName(c) {
    return panelDisplayName(c)
      .replace(/\bCoin(?=(?:\s+w\/|$))/i, 'Coins')
      .replace(/\bBar(?=(?:\s+w\/|$))/i, 'Bars');
  }

  function titleCaseChartText(value) {
    const keepUpper = new Set(['BTC', 'USD']);
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map(word => {
        if (keepUpper.has(word.toUpperCase())) return word.toUpperCase();
        if (/^w\/$/i.test(word)) return 'w/';
        if (/^[\d.]+$/.test(word)) return word;
        return word
          .split(/([-–—/])/)
          .map(part => /^[a-z]/i.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part)
          .join('');
      })
      .join(' ');
  }

  function balanceChartTitleText(unit = balanceChartUnit) {
    const selectionTitle = allItemsSelected() ? ALL_ITEMS_LABEL : chartDisplayName(activeCoin());
    const suffix = unit === 'usd' ? 'USD Value Over Time' : 'Balance Over Time';
    return titleCaseChartText(`${selectionTitle} ${suffix}`);
  }

  function normalizeSearchAddress(value) {
    return String(value || '').trim().toLowerCase();
  }

  function sanitizeSearchAddress(value) {
    return String(value || '')
      .replace(/[0O]/g, 'o')
      .replace(/[Il]/g, '1')
      .replace(/[^a-z0-9]/gi, '');
  }

  function isAllowedSearchKey(key) {
    return key.length !== 1 || /^[a-z0-9]$/i.test(key);
  }

  function searchAddressValues(c) {
    return [
      c.address,
      c.addressFirstbits,
      c.backAddress,
      c.backAddressFirstbits
    ].filter(Boolean).map(String);
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') {
          value += '"';
          i++;
        } else if (char === '"') {
          quoted = false;
        } else {
          value += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(value);
        value = '';
      } else if (char === '\n') {
        row.push(value);
        rows.push(row);
        row = [];
        value = '';
      } else if (char !== '\r') {
        value += char;
      }
    }
    if (value || row.length) {
      row.push(value);
      rows.push(row);
    }
    const header = rows.shift() || [];
    return rows.map(values => Object.fromEntries(header.map((name, index) => [name, values[index] || ''])));
  }

  async function loadTextFile(url) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.text();
    } catch (_) {}
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('GET', url, true);
      request.onload = () => {
        if (request.status === 0 || (request.status >= 200 && request.status < 300)) {
          resolve(request.responseText);
        } else {
          reject(new Error(`Unable to load ${url}`));
        }
      };
      request.onerror = () => reject(new Error(`Unable to load ${url}`));
      request.send();
    });
  }

  function trackerSlugForRow(row, s3OneGoldRimMinIndex, s3HalfSeries2MaxIndex) {
    if (row.Type === 'S3-COIN-1-AG') {
      const overrideSlug = S3_ONE_SILVER_VARIANT_SLUGS_BY_ADDRESS[String(row.Address || '').trim()];
      if (overrideSlug) return overrideSlug;
      return Number(row.Index) >= s3OneGoldRimMinIndex
        ? 'cas_1btc_2013_gold_rim_silver'
        : 'cas_1btc_2013_silver';
    }
    if (row.Type === 'S3-COIN-0.5-AG') {
      return Number(row.Index) <= s3HalfSeries2MaxIndex
        ? 'cas_0p5btc_2013_silver_s25'
        : 'cas_0p5btc_2013_silver_s3';
    }
    return TRACKER_TYPE_SLUGS[row.Type] || null;
  }

  function unfundedFallbackSlugForRow(row) {
    if (!isUnfundedStatus(row)) return null;
    return GRADED_UNFUNDED_SLUGS_BY_ADDRESS[gradedAddressKey(row.Address)] || null;
  }

  function finiteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function trackerEntryFromRow(row, s3OneGoldRimMinIndex, s3HalfSeries2MaxIndex) {
    const slug = trackerSlugForRow(row, s3OneGoldRimMinIndex, s3HalfSeries2MaxIndex) || unfundedFallbackSlugForRow(row);
    if (!slug || !row.Address) return null;
    return {
      Status: row.Status,
      address: String(row.Address),
      type: String(row.Type || ''),
      slug,
      index: finiteNumber(row.Index),
      value: finiteNumber(row.Value),
      balance: finiteNumber(row.Balance),
      createBlock: finiteNumber(row['Create Block']),
      createTime: finiteNumber(row['Create Time']),
      redeemBlock: finiteNumber(row['Redeem Block']),
      redeemTime: finiteNumber(row['Redeem Time'])
    };
  }

  function unfundedEntryFromRow(row) {
    if (!isUnfundedStatus(row) || !row.Address) return null;
    return {
      Status: row.Status || 'Unfunded',
      address: String(row.Address),
      type: String(row.Type || ''),
      slug: unfundedFallbackSlugForRow(row),
      index: finiteNumber(row.Index),
      value: finiteNumber(row.Value),
      balance: finiteNumber(row.Balance),
      createBlock: finiteNumber(row['Create Block']),
      createTime: finiteNumber(row['Create Time']),
      redeemBlock: finiteNumber(row['Redeem Block']),
      redeemTime: finiteNumber(row['Redeem Time']),
      unfundedOnly: true
    };
  }

  function buildTrackerIndex(rows) {
    const s3OneIndexes = rows
      .filter(row => row.Type === 'S3-COIN-1-AG')
      .map(row => Number(row.Index))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const s3HalfIndexes = rows
      .filter(row => row.Type === 'S3-COIN-0.5-AG')
      .map(row => Number(row.Index))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const s3OneGoldRimMinIndex = s3OneIndexes[Math.max(0, s3OneIndexes.length - S3_ONE_GOLD_RIM_ESTIMATED_COUNT)] || Number.POSITIVE_INFINITY;
    const s3HalfSeries2MaxIndex = s3HalfIndexes.length
      ? s3HalfIndexes[Math.min(s3HalfIndexes.length, S3_HALF_SERIES2_ESTIMATED_COUNT) - 1]
      : Number.NEGATIVE_INFINITY;
    return rows
      .map(row => trackerEntryFromRow(row, s3OneGoldRimMinIndex, s3HalfSeries2MaxIndex))
      .filter(Boolean);
  }

  function gradedAddressKey(address) {
    return String(address || '').trim();
  }

  function isDisplayOnlyAddress(entryOrAddress) {
    if (entryOrAddress && typeof entryOrAddress === 'object') {
      return Boolean(entryOrAddress.displayOnlyAddress);
    }
    return Boolean(GRADED_ONLY_ENTRIES_BY_LABEL[gradedAddressKey(entryOrAddress)]);
  }

  function linkableBitcoinAddress(address) {
    const text = String(address || '').trim();
    return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[ac-hj-np-z02-9]{11,71}$/i.test(text);
  }

  function gradedAddressFirstbits(address) {
    const text = String(address || '').trim();
    const match = text.match(/\b([13][a-km-zA-HJ-NP-Z1-9]{7,34}|bc1[ac-hj-np-z02-9]{7,71})\b/i);
    return match ? match[1].slice(0, 8) : text.slice(0, 8);
  }

  function gradedMediaFromStem(stem) {
    if (!READY_GRADED_MEDIA_STEMS.has(stem)) return null;
    if (stem.startsWith('NGC_')) return ngcGradedMedia(stem.slice(4));
    if (stem.startsWith('PCGS_')) return pcgsGradedMedia(stem.slice(5));
    return null;
  }

  function applyGradedMediaCaseProfile(media, entry) {
    if (!media) return null;
    const coin = COINS.find(c => c.slug === entry?.slug);
    if (media.caseStyle === 'pcgs' && coin?.shape === 'bar') {
      return { ...media, ...PCGS_BAR_GRADED_MEDIA_DEFAULTS };
    }
    return media;
  }

  function gradedMediaForEntry(entryOrAddress) {
    const address = typeof entryOrAddress === 'object'
      ? String(entryOrAddress?.address || '')
      : String(entryOrAddress || '');
    const explicit = GRADED_MEDIA_BY_ADDRESS[gradedAddressKey(address)];
    if (explicit) return applyGradedMediaCaseProfile(explicit, entryOrAddress);
    const firstbits = gradedAddressFirstbits(address);
    if (!firstbits) return null;
    const preferredGrader = String(entryOrAddress?.gradedRecord?.grader || '').trim().toUpperCase();
    const graders = preferredGrader === 'NGC' || preferredGrader === 'PCGS'
      ? [preferredGrader, preferredGrader === 'NGC' ? 'PCGS' : 'NGC']
      : ['NGC', 'PCGS'];
    for (const grader of graders) {
      const media = gradedMediaFromStem(`${grader}_${firstbits}`);
      if (media) return applyGradedMediaCaseProfile(media, entryOrAddress);
    }
    return null;
  }

  function normalizedGradedRecord(row, index = 0) {
    const address = gradedAddressKey(row.address);
    return {
      ...row,
      address,
      gradedRecordId: `${address || 'graded'}:${index}`,
      gradedRecordIndex: index,
      'auction sold date': row['auction sold date'] || row['auction date'] || '',
      'auction sold amount': row['auction sold amount'] || row['auction sale amount'] || ''
    };
  }

  function compareGradedRecords(a, b) {
    return (parseSeriesPriceDate(b?.['auction sold date']) || 0) - (parseSeriesPriceDate(a?.['auction sold date']) || 0)
      || (parseUsdPriceText(b?.['auction sold amount']) || 0) - (parseUsdPriceText(a?.['auction sold amount']) || 0)
      || (Number(b?.gradedRecordIndex) || 0) - (Number(a?.gradedRecordIndex) || 0);
  }

  function buildGradedIndex(rows) {
    const recordsByAddress = new Map();
    rows.forEach((row, index) => {
      const address = gradedAddressKey(row.address);
      if (!address) return;
      if (!recordsByAddress.has(address)) recordsByAddress.set(address, []);
      recordsByAddress.get(address).push(normalizedGradedRecord(row, index));
    });
    const latestByAddress = new Map();
    recordsByAddress.forEach((records, address) => {
      records.sort(compareGradedRecords);
      latestByAddress.set(address, records[0]);
    });
    return { recordsByAddress, latestByAddress };
  }

  function gradedIndex() {
    if (!gradedIndexPromise) {
      gradedIndexPromise = loadTextFile(GRADED_CSV_URL)
        .then(text => buildGradedIndex(parseCsv(text)))
        .catch(() => ({ recordsByAddress: new Map(), latestByAddress: new Map() }));
    }
    return gradedIndexPromise;
  }

  function trackerIndex() {
    if (!trackerIndexPromise) {
      trackerIndexPromise = loadTextFile(TRACKER_CSV_URL)
        .then(text => buildTrackerIndex(parseCsv(text)))
        .catch(() => []);
    }
    return trackerIndexPromise;
  }

  function unfundedIndex() {
    if (!unfundedIndexPromise) {
      unfundedIndexPromise = loadTextFile(TRACKER_CSV_URL)
        .then(text => parseCsv(text).map(unfundedEntryFromRow).filter(Boolean))
        .catch(() => []);
    }
    return unfundedIndexPromise;
  }

  function entryWithGradedRecord(entry, gradedRecord, records = []) {
    return gradedRecord ? { ...entry, gradedRecord, gradedRecords: records } : entry;
  }

  function mergeGradedRecords(entries, gradedIndexData) {
    const latestByAddress = gradedIndexData?.latestByAddress || new Map();
    const recordsByAddress = gradedIndexData?.recordsByAddress || new Map();
    const merged = entries.map(entry => {
      const address = gradedAddressKey(entry.address);
      return entryWithGradedRecord(entry, latestByAddress.get(address), recordsByAddress.get(address) || []);
    });
    Object.entries(GRADED_ONLY_ENTRIES_BY_LABEL).forEach(([label, baseEntry]) => {
      const address = gradedAddressKey(label);
      const gradedRecord = latestByAddress.get(address);
      if (!gradedRecord) return;
      merged.push({
        ...baseEntry,
        address: label,
        gradedRecord,
        gradedRecords: recordsByAddress.get(address) || []
      });
    });
    return merged;
  }

  function trackerIndexWithGraded() {
    if (!trackerIndexWithGradedPromise) {
      trackerIndexWithGradedPromise = Promise.all([trackerIndex(), gradedIndex()])
        .then(([entries, gradedRecords]) => mergeGradedRecords(entries, gradedRecords))
        .catch(() => trackerIndex());
    }
    return trackerIndexWithGradedPromise;
  }

  function dailyPriceRowDay(row) {
    const timestamp = String(row?.timestamp || '').trim();
    const parsed = timestamp ? Date.parse(`${timestamp.replace(' ', 'T')}Z`) : NaN;
    if (Number.isFinite(parsed)) return startOfUtcDaySeconds(parsed / 1000);
    const dateParts = String(row?.date || '').trim().split('/').map(part => Number(part));
    if (dateParts.length === 3 && dateParts.every(Number.isFinite)) {
      const [month, day, year] = dateParts;
      const fullYear = year < 100 ? 2000 + year : year;
      return Date.UTC(fullYear, month - 1, day) / 1000;
    }
    return null;
  }

  function buildDailyPriceIndex(rows) {
    const pricesByDay = new Map();
    rows.forEach(row => {
      const day = dailyPriceRowDay(row);
      const price = finiteNumber(row?.price);
      if (!Number.isFinite(day) || !Number.isFinite(price)) return;
      pricesByDay.set(day, price);
    });
    const days = Array.from(pricesByDay.keys()).sort((a, b) => a - b);
    return { days, pricesByDay };
  }

  function dailyPriceIndex() {
    if (dailyPriceIndexCache) return Promise.resolve(dailyPriceIndexCache);
    if (!dailyPriceIndexPromise) {
      dailyPriceIndexPromise = loadTextFile(DAILY_PRICE_CSV_URL)
        .then(text => {
          dailyPriceIndexCache = buildDailyPriceIndex(parseCsv(text));
          return dailyPriceIndexCache;
        })
        .catch(() => {
          dailyPriceIndexCache = { days: [], pricesByDay: new Map() };
          return dailyPriceIndexCache;
        });
    }
    return dailyPriceIndexPromise;
  }

  function priceForDaySeconds(time) {
    const index = dailyPriceIndexCache;
    if (!index?.days?.length) return 0;
    const day = startOfUtcDaySeconds(time);
    if (index.pricesByDay.has(day)) return index.pricesByDay.get(day) || 0;
    let low = 0;
    let high = index.days.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (index.days[mid] <= day) low = mid + 1;
      else high = mid - 1;
    }
    return index.pricesByDay.get(index.days[Math.max(0, high)]) || 0;
  }

  function parseFirstNumber(value) {
    const match = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const number = Number(match[0]);
    return Number.isFinite(number) ? number : null;
  }

  function parseSeriesPriceDate(value) {
    const text = String(value || '').trim();
    const isoDate = text.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (isoDate) {
      const [year, month, day] = isoDate.split('-').map(Number);
      if ([year, month, day].every(Number.isFinite)) return Date.UTC(year, month - 1, day) / 1000;
    }
    const parsed = Date.parse(/\bUTC\b/i.test(text) ? text.replace(/\s+UTC\b/i, ' UTC') : `${text} UTC`);
    return Number.isFinite(parsed) ? startOfUtcDaySeconds(parsed / 1000) : null;
  }

  function parseBtcPriceText(value) {
    const text = String(value || '').trim();
    if (!text || !/\d/.test(text) || /^formula\b/i.test(text)) return null;
    const eachMatches = Array.from(text.matchAll(/(-?\d+(?:\.\d+)?)\s*BTC\s*each\b/gi));
    if (/\bper\s+dozen\b/i.test(text) && eachMatches.length) {
      const eachPrice = Number(eachMatches[eachMatches.length - 1][1]);
      if (Number.isFinite(eachPrice)) return eachPrice;
    }
    return parseFirstNumber(text);
  }

  function parseUsdPriceText(value) {
    const text = String(value || '').trim();
    if (!text || !/\$/.test(text) || isNotSoldAuctionAmount(text)) return null;
    return parseFirstNumber(text);
  }

  function seriesTrackerTypes(value) {
    return String(value || '')
      .split(/[;|]/)
      .map(part => part.trim())
      .filter(Boolean);
  }

  function priceVariantKeyForSeriesRow(row) {
    const trackerTypes = seriesTrackerTypes(row?.tracker_type);
    const text = [
      row?.item_or_series,
      row?.series_or_variant
    ].join(' ');
    if (trackerTypes.includes('S2-COIN-10')) {
      if (/\bgold\b/i.test(text)) return 'gold-b';
      if (/\bplain\b|\bwithout\b/i.test(text)) return 'plain';
    }
    if (trackerTypes.includes('S3-COIN-0.5-AG')) {
      return 'series-3';
    }
    if (trackerTypes.includes('S3-COIN-1-AG')) {
      if (/\bgold[-\s]?rim\b|\bgold[-\s]?plated\b|\bgold\b/i.test(text)) return 'gold-rim';
      if (/\bplain\b|\bsilver\b/i.test(text)) return 'plain';
    }
    return '';
  }

  function buildSeriesPriceIndex(rows) {
    const byType = new Map();
    rows.forEach(row => {
      const date = parseSeriesPriceDate(row?.verified_sale_or_listing_date);
      const postedBtc = parseBtcPriceText(row?.posted_price_btc);
      const denomination = parseFirstNumber(row?.denomination_btc);
      if (!Number.isFinite(date) || !Number.isFinite(postedBtc)) return;
      const listedUnfunded = Number(denomination) <= 0
        || /\bunfunded\b|\bno\s+btc\s+value\b|\bnon-denominated\b/i.test([
          row?.item_or_series,
          row?.denomination_btc,
          row?.series_or_variant,
          row?.notes
        ].join(' '));
      seriesTrackerTypes(row?.tracker_type).forEach(type => {
        const points = byType.get(type) || [];
        points.push({
          kind: 'initial',
          time: date,
          btc: postedBtc,
          denomination: Number.isFinite(denomination) ? denomination : 0,
          listedUnfunded,
          variantKey: priceVariantKeyForSeriesRow(row),
          label: row?.item_or_series || 'Initial price'
        });
        byType.set(type, points);
      });
    });
    byType.forEach(points => points.sort((a, b) => a.time - b.time || a.btc - b.btc));
    return byType;
  }

  function seriesPriceIndex() {
    if (seriesPriceIndexCache) return Promise.resolve(seriesPriceIndexCache);
    if (!seriesPriceIndexPromise) {
      seriesPriceIndexPromise = loadTextFile(SERIES_PRICE_CSV_URL)
        .then(text => {
          seriesPriceIndexCache = buildSeriesPriceIndex(parseCsv(text));
          return seriesPriceIndexCache;
        })
        .catch(() => {
          seriesPriceIndexCache = new Map();
          return seriesPriceIndexCache;
        });
    }
    return seriesPriceIndexPromise;
  }

  function addressValueMatches(query, value) {
    const q = normalizeSearchAddress(query);
    const v = normalizeSearchAddress(value);
    if (!q || !v) return false;
    if (q === v) return true;
    return q.length === 8 && v.slice(0, 8) === q;
  }

  function findEmbeddedCoinByAddress(query) {
    if (!normalizeSearchAddress(query)) return null;
    const coin = COINS.find(c => searchAddressValues(c).some(value => addressValueMatches(query, value)));
    return coin ? { coin, address: searchAddressValues(coin).find(value => addressValueMatches(query, value)) || '' } : null;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function formatInteger(value) {
    return Number.isFinite(value) ? value.toLocaleString() : '—';
  }

  function formatCountShare(value, total) {
    if (!Number.isFinite(value)) return '—';
    if (!Number.isFinite(total) || total <= 0) return formatInteger(value);
    const percent = (value / total) * 100;
    return `${formatInteger(value)} <span class="info-percent">(${percent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%)</span>`;
  }

  function statusKey(entryOrStatus) {
    const value = typeof entryOrStatus === 'string' ? entryOrStatus : entryOrStatus?.Status;
    return String(value || '').trim().toLowerCase();
  }

  function isActiveStatus(entryOrStatus) {
    return statusKey(entryOrStatus) === 'active';
  }

  function isRedeemedStatus(entryOrStatus) {
    return statusKey(entryOrStatus) === 'redeemed';
  }

  function isUnfundedStatus(entryOrStatus) {
    const key = statusKey(entryOrStatus);
    return key === 'unfunded' || key === 'unloaded';
  }

  function statusLabel(entryOrStatus) {
    if (isActiveStatus(entryOrStatus)) return 'Active';
    if (isRedeemedStatus(entryOrStatus)) return 'Redeemed';
    if (isUnfundedStatus(entryOrStatus)) return 'Unfunded';
    return 'Unknown';
  }

  function formatBtc(value) {
    return Number.isFinite(value)
      ? `${value.toLocaleString(undefined, { maximumFractionDigits: 8 })} BTC`
      : '—';
  }

  function formatAuctionAmount(value) {
    const text = String(value || '').trim();
    if (/^not\s+sold$/i.test(text)) return 'Not Sold';
    return text.replace(/\.00$/, '');
  }

  function isNotSoldAuctionAmount(value) {
    return /^not\s+sold$/i.test(String(value || '').trim());
  }

  function formatAuctionResult(date, amount, { soldPrefix = true } = {}) {
    const dateText = String(date || '').trim();
    const amountText = formatAuctionAmount(amount);
    if (dateText && amountText) {
      if (isNotSoldAuctionAmount(amount)) return `No Sale on ${dateText}`;
      return soldPrefix ? `Sold on ${dateText} for ${amountText}` : `${dateText} for ${amountText}`;
    }
    if (amountText) return isNotSoldAuctionAmount(amount) ? 'No Sale' : `Sold for ${amountText}`;
    if (dateText) return `Auction on ${dateText}`;
    return 'No auction data available';
  }

  function gradedAuctionTime(entry) {
    return parseSeriesPriceDate(entry?.gradedRecord?.['auction sold date']) || 0;
  }

  function gradedAuctionPrice(entry) {
    return parseUsdPriceText(entry?.gradedRecord?.['auction sold amount']) || 0;
  }

  function compareGradedAuctionRows(a, b) {
    return gradedAuctionTime(b) - gradedAuctionTime(a)
      || gradedAuctionPrice(b) - gradedAuctionPrice(a)
      || (b.createTime || 0) - (a.createTime || 0)
      || (b.createBlock || 0) - (a.createBlock || 0)
      || (b.index || 0) - (a.index || 0);
  }

  function gradedAuctionEntriesForEntry(entry) {
    const records = Array.isArray(entry?.gradedRecords) && entry.gradedRecords.length
      ? entry.gradedRecords
      : (entry?.gradedRecord ? [entry.gradedRecord] : []);
    return records.map(record => ({
      ...entry,
      gradedRecord: record,
      gradedRecordId: record?.gradedRecordId || entry?.gradedRecordId || ''
    }));
  }

  function externalInfoLinkHtml(text, url) {
    const label = String(text || '').trim();
    const href = String(url || '').trim();
    if (!label) return '—';
    if (!/^https?:\/\//i.test(href)) return escapeHtml(label);
    return `<a class="info-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  }

  function formatUtcDateTime(value) {
    if (!Number.isFinite(value) || value <= 0) return '—';
    const date = new Date(value * 1000);
    const dayText = date.toLocaleDateString(undefined, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    const timeText = date.toLocaleTimeString(undefined, {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    return `${dayText} ${timeText} UTC`;
  }

  function formatUtcDate(value) {
    if (!Number.isFinite(value) || value <= 0) return '—';
    return new Date(value * 1000).toLocaleDateString(undefined, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function formatBlockDay(block, time) {
    const blockText = formatInteger(block);
    const dateText = formatUtcDate(time);
    if (blockText === '—') return dateText;
    if (dateText === '—') return blockText;
    return `${blockText} · ${dateText}`;
  }

  function s2TenSilverVariantKeyForSlug(slug) {
    if (slug === 'cas_10btc_2012_silver') return 'plain';
    if (slug === 'cas_10btc_2012_silver_gold_b') return 'gold-b';
    return '';
  }

  function s2TenSilverOverrideSlugForEntry(entry) {
    return S2_TEN_SILVER_VARIANT_SLUGS_BY_ADDRESS[String(entry?.address || '').trim()] || '';
  }

  function s2TenSilverVariantKeyForGradedRecord(record) {
    const text = [
      record?.label,
      record?.description,
      record?.grade,
      record?.['auction link'],
      record?.['grader link']
    ].join(' ');
    if (/\bgold[-\s]?b\b|\bgold[-\s]?bitcoin\s+logo\b|\bgold[-\s]?plated\s+bitcoin\s+logo\b/i.test(text)) return 'gold-b';
    if (/\bplain\s+silver\b|\bwithout\s+gold\b/i.test(text)) return 'plain';
    return '';
  }

  function s2TenSilverVariantKeyForEntry(entry) {
    return s2TenSilverVariantKeyForSlug(s2TenSilverOverrideSlugForEntry(entry))
      || s2TenSilverVariantKeyForGradedRecord(entry?.gradedRecord);
  }

  function s3HalfSilverVariantKeyForSlug(slug) {
    if (slug === 'cas_0p5btc_2013_silver_s25') return 'series-2';
    if (slug === 'cas_0p5btc_2013_silver_s3') return 'series-3';
    return '';
  }

  function s3HalfSilverOverrideSlugForEntry(entry) {
    return S3_HALF_SILVER_VARIANT_SLUGS_BY_ADDRESS[String(entry?.address || '').trim()] || '';
  }

  function s3HalfSilverVariantKeyForEntry(entry) {
    const overrideVariant = s3HalfSilverVariantKeyForSlug(s3HalfSilverOverrideSlugForEntry(entry));
    if (overrideVariant) return overrideVariant;
    if (entry?.gradedRecord && String(entry?.type || '').trim() === 'S3-COIN-0.5-AG') return 'series-3';
    return s3HalfSilverVariantKeyForSlug(entry?.slug);
  }

  function s3OneSilverVariantKeyForSlug(slug) {
    if (slug === 'cas_1btc_2013_silver') return 'plain';
    if (slug === 'cas_1btc_2013_gold_rim_silver') return 'gold-rim';
    return '';
  }

  function s3OneSilverOverrideSlugForEntry(entry) {
    return S3_ONE_SILVER_VARIANT_SLUGS_BY_ADDRESS[String(entry?.address || '').trim()] || '';
  }

  function s3OneSilverVariantKeyForEntry(entry) {
    return s3OneSilverVariantKeyForSlug(s3OneSilverOverrideSlugForEntry(entry) || entry?.slug);
  }

  function entryBelongsToCoin(entry, coin = activeCoin()) {
    const coinSlug = coin?.slug || '';
    const statsSlug = SHARED_STATS_SLUGS[coinSlug] || coinSlug;
    const targetVariant = s2TenSilverVariantKeyForSlug(coinSlug);
    const targetS3HalfVariant = s3HalfSilverVariantKeyForSlug(coinSlug);
    const targetS3Variant = s3OneSilverVariantKeyForSlug(coinSlug);
    if (targetS3HalfVariant && isGradedEntry(entry) && String(entry?.type || '').trim() === 'S3-COIN-0.5-AG') {
      return s3HalfSilverVariantKeyForEntry(entry) === targetS3HalfVariant;
    }
    if (!entry?.slug || !statsSlug || entry.slug !== statsSlug) return false;
    if (!targetVariant && !targetS3HalfVariant && !targetS3Variant) return true;
    const entryVariant = targetVariant
      ? s2TenSilverVariantKeyForEntry(entry)
      : (targetS3HalfVariant ? s3HalfSilverVariantKeyForEntry(entry) : s3OneSilverVariantKeyForEntry(entry));
    const target = targetVariant || targetS3HalfVariant || targetS3Variant;
    return !entryVariant || entryVariant === target;
  }

  function rowsForCoin(entries, coin = activeCoin()) {
    if (allItemsSelected()) return entries;
    return entries.filter(entry => entryBelongsToCoin(entry, coin));
  }

  function statsRowsForCoin(entries, coin = activeCoin()) {
    return rowsForCoin(entries, coin);
  }

  function updateLeftPanelCounts(entries = null, coin = activeCoin()) {
    if (!entries) {
      leftPanelCounts.recent = null;
      leftPanelCounts.active = null;
      leftPanelCounts.graded = null;
      return;
    }
    const rows = rowsForCoin(entries, coin);
    leftPanelCounts.recent = rows.filter(isRedeemedStatus).length;
    leftPanelCounts.active = rows.filter(isActiveStatus).length;
    leftPanelCounts.graded = rows.filter(isGradedEntry).flatMap(gradedAuctionEntriesForEntry).length;
  }

  function leftPanelToggleText() {
    return leftPanelModeToggle?.querySelector('.left-panel-mode-text') || leftPanelModeToggle;
  }

  function leftPanelModeTitle(mode, { count = false } = {}) {
    const title = LEFT_PANEL_MODE_TITLES[validLeftPanelMode(mode)] || LEFT_PANEL_MODE_TITLES.recent;
    const modeCount = leftPanelCounts[mode];
    const hideCount = window.matchMedia?.(MOBILE_PANEL_QUERY)?.matches || false;
    return count && !hideCount && Number.isFinite(modeCount) ? `${title} (${formatInteger(modeCount)})` : title;
  }

  function leftPanelOppositeTitle(mode) {
    return leftPanelModeTitle(nextLeftPanelMode(mode));
  }

  function setLeftPanelToggleText(text) {
    const target = leftPanelToggleText();
    if (target) target.textContent = text;
  }

  function removeIncomingLeftPanelToggle() {
    leftPanelHeader?.querySelector('.left-panel-mode-toggle-incoming')?.remove();
  }

  function addIncomingLeftPanelToggle(text) {
    if (!leftPanelHeader) return;
    removeIncomingLeftPanelToggle();
    const incoming = document.createElement('button');
    incoming.className = 'left-panel-mode-toggle left-panel-mode-toggle-incoming';
    incoming.type = 'button';
    incoming.tabIndex = -1;
    incoming.setAttribute('aria-hidden', 'true');
    incoming.innerHTML = `<span class="left-panel-mode-text">${escapeHtml(text)}</span>`;
    leftPanelHeader.appendChild(incoming);
    incoming.getBoundingClientRect();
    leftPanelHeader.classList.add('label-incoming-active');
  }

  function lockLeftPanelBodyWidth() {
    if (!document.createElement) return;
    const canvas = lockLeftPanelBodyWidth.canvas || (lockLeftPanelBodyWidth.canvas = document.createElement('canvas'));
    const context = canvas.getContext?.('2d');
    if (!context) return;
    context.font = LEFT_PANEL_ADDRESS_FONT;
    const addressWidth = Math.ceil(context.measureText('1'.repeat(LEFT_PANEL_ADDRESS_CHARS)).width);
    root.style.setProperty('--left-panel-body-width', `${addressWidth + LEFT_PANEL_HORIZONTAL_PADDING}px`);
  }

  function syncLeftPanelHeader() {
    if (leftPanelTitle) leftPanelTitle.textContent = leftPanelModeTitle(leftPanelMode, { count: true });
    setLeftPanelToggleText(leftPanelOppositeTitle(leftPanelMode));
    for (const mode of LEFT_PANEL_MODES) {
      leftPanelHeader?.classList.toggle(`mode-${mode}`, leftPanelMode === mode);
    }
    leftPanelHeader?.classList.remove(...LEFT_PANEL_MODES.map(mode => `target-${mode}`));
  }

  function activeLeftPanelView(mode = leftPanelMeasureMode || leftPanelMode) {
    if (mode === 'active') return activeCoinsView;
    if (mode === 'graded') return gradedCoinsView;
    return recentSpendsView;
  }

  function saveLeftPanelScroll() {
    if (!recentSpendsPanel) return;
    leftPanelScrollTopByMode[leftPanelMode] = recentSpendsPanel.scrollTop || 0;
  }

  function restoreLeftPanelScroll(mode = leftPanelMode) {
    if (!recentSpendsPanel) return;
    recentSpendsPanel.scrollTop = leftPanelScrollTopByMode[mode] || 0;
  }

  function leftPanelBodyNaturalHeight(mode = leftPanelMeasureMode || leftPanelMode) {
    if (!recentSpendsPanel) return 0;
    const styles = getComputedStyle(recentSpendsPanel);
    const padding = parseFloat(styles.paddingTop || 0) + parseFloat(styles.paddingBottom || 0);
    const view = activeLeftPanelView(mode);
    const viewHeight = Math.ceil([...view?.children || []].reduce((max, child) => {
      return Math.max(max, child.scrollHeight || child.getBoundingClientRect().height || 0);
    }, 0));
    root.style.setProperty('--left-panel-view-height', `${viewHeight}px`);
    return Math.ceil(viewHeight + padding);
  }

  function updateLeftPanelScrollbarGutter() {
    if (!recentSpendsPanel) return false;
    const styles = getComputedStyle(recentSpendsPanel);
    const borderWidth = parseFloat(styles.borderLeftWidth || 0) + parseFloat(styles.borderRightWidth || 0);
    const gutter = Math.max(0, Math.round(recentSpendsPanel.offsetWidth - recentSpendsPanel.clientWidth - borderWidth));
    const current = parseFloat(getComputedStyle(root).getPropertyValue('--left-panel-scrollbar-gutter')) || 0;
    if (Math.round(current) === gutter) return false;
    root.style.setProperty('--left-panel-scrollbar-gutter', `${gutter}px`);
    return true;
  }

  function syncLeftPanelMode() {
    recentSpendsPanel?.classList.toggle('show-active', leftPanelMode === 'active');
    recentSpendsPanel?.classList.toggle('show-graded', leftPanelMode === 'graded');
    recentSpendsPanel?.classList.remove('returning-recent', 'return-to-recent', 'wrap-graded-recent', 'wrap-to-recent', 'wrap-graded-active', 'wrap-to-active', 'wrap-active-recent', 'no-panel-transition');
    syncSelectedLeftPanelAddress(leftPanelMode, { forceDefault: !selectedLeftPanelAddressByMode[leftPanelMode] });
    renderLeftPanelRows(leftPanelMode);
    syncLeftPanelHeader();
    restoreLeftPanelScroll();
    updateLeftPanelLayout();
  }

  function animateLeftPanelHeader(targetMode) {
    if (!leftPanelHeader || !leftPanelTitle || !leftPanelModeToggle) {
      leftPanelMode = targetMode;
      syncLeftPanelHeader();
      return;
    }
    setLeftPanelToggleText(leftPanelModeTitle(targetMode, { count: true }));
    addIncomingLeftPanelToggle(leftPanelOppositeTitle(targetMode));
    leftPanelHeader.classList.remove('label-entering', 'no-label-transition', ...LEFT_PANEL_MODES.map(mode => `target-${mode}`));
    leftPanelHeader.classList.add(`target-${targetMode}`);
    const toggleRect = leftPanelModeToggle.getBoundingClientRect();
    const titleRect = leftPanelTitle.getBoundingClientRect();
    const shift = toggleRect ? titleRect.left - toggleRect.left : 0;
    leftPanelHeader.style.setProperty('--left-panel-label-shift', `${Math.round(shift)}px`);
    leftPanelHeader.getBoundingClientRect();
    leftPanelHeader.classList.add('label-transitioning');
    setTimeout(() => {
      leftPanelMode = targetMode;
      leftPanelHeader.classList.add('no-label-transition');
      syncSelectedLeftPanelAddress(leftPanelMode, { forceDefault: true });
      renderLeftPanelRows(leftPanelMode);
      syncLeftPanelHeader();
      leftPanelHeader.classList.remove('label-transitioning');
      leftPanelHeader.classList.remove('label-incoming-active');
      removeIncomingLeftPanelToggle();
      leftPanelHeader.getBoundingClientRect();
      leftPanelHeader.classList.remove('no-label-transition');
      updateLeftPanelLayout();
    }, 360);
  }

  function showLeftPanelMode(mode) {
    mode = validLeftPanelMode(mode);
    if (mode === leftPanelMode) return;
    if (
      leftPanelMode === 'graded'
      && mode === 'recent'
      && activeChartModalMode === 'price'
      && balanceChartModal?.classList.contains('open')
    ) {
      closeBalanceChartModal();
    }
    if (mode === 'graded') hydrateGradedPanelForCurrentSelection();
    if (!allItemsMode) {
      syncSelectedLeftPanelAddress(mode, { forceDefault: true });
    }
    savePanelState(mode);
    if (allItemsMode) {
      saveAllItemsSelection(mode, selectedLeftPanelAddressByMode[mode], allItemsFocusedSlug);
    }
    const token = ++leftPanelTransitionToken;
    saveLeftPanelScroll();
    leftPanelMeasureMode = mode;
    prepareLeftPanelModeForTransition(mode);
    updateLeftPanelLayout();
    recentSpendsPanel?.getBoundingClientRect();

    requestAnimationFrame(() => {
      if (token !== leftPanelTransitionToken) return;
      if (mode === 'recent' && leftPanelMode === 'graded' && recentSpendsPanel) {
        animateLeftPanelHeader(mode);
        recentSpendsPanel.classList.add('no-panel-transition', 'wrap-graded-recent');
        recentSpendsPanel.classList.remove('show-active', 'show-graded', 'wrap-to-recent', 'wrap-graded-active', 'wrap-to-active', 'wrap-active-recent', 'returning-recent', 'return-to-recent');
        recentSpendsPanel.getBoundingClientRect();
        recentSpendsPanel.classList.remove('no-panel-transition');
        recentSpendsPanel.classList.add('wrap-to-recent');
        setTimeout(() => {
          if (token !== leftPanelTransitionToken) return;
          recentSpendsPanel.classList.add('no-panel-transition');
          recentSpendsPanel.classList.remove('wrap-graded-recent', 'wrap-to-recent', 'wrap-graded-active', 'wrap-to-active', 'wrap-active-recent', 'show-active', 'show-graded');
          recentSpendsPanel.getBoundingClientRect();
          recentSpendsPanel.classList.remove('no-panel-transition');
          leftPanelMeasureMode = null;
          restoreLeftPanelScroll();
          updateLeftPanelLayout();
        }, 360);
        return;
      }
      if (mode === 'active' && leftPanelMode === 'graded' && recentSpendsPanel) {
        animateLeftPanelHeader(mode);
        recentSpendsPanel.classList.add('no-panel-transition', 'wrap-graded-active');
        recentSpendsPanel.classList.remove('show-active', 'show-graded', 'wrap-to-active', 'wrap-graded-recent', 'wrap-to-recent', 'wrap-active-recent', 'returning-recent', 'return-to-recent');
        recentSpendsPanel.getBoundingClientRect();
        recentSpendsPanel.classList.remove('no-panel-transition');
        recentSpendsPanel.classList.add('wrap-to-active');
        setTimeout(() => {
          if (token !== leftPanelTransitionToken) return;
          recentSpendsPanel.classList.add('no-panel-transition', 'show-active');
          recentSpendsPanel.classList.remove('wrap-graded-active', 'wrap-to-active', 'wrap-graded-recent', 'wrap-to-recent', 'wrap-active-recent', 'show-graded');
          recentSpendsPanel.getBoundingClientRect();
          recentSpendsPanel.classList.remove('no-panel-transition');
          leftPanelMeasureMode = null;
          restoreLeftPanelScroll();
          updateLeftPanelLayout();
        }, 360);
        return;
      }
      if (mode === 'recent' && leftPanelMode === 'active' && recentSpendsPanel) {
        animateLeftPanelHeader(mode);
        recentSpendsPanel.classList.add('no-panel-transition', 'wrap-active-recent');
        recentSpendsPanel.classList.remove('show-active', 'show-graded', 'wrap-to-recent', 'wrap-graded-recent', 'wrap-graded-active', 'wrap-to-active', 'returning-recent', 'return-to-recent');
        recentSpendsPanel.getBoundingClientRect();
        recentSpendsPanel.classList.remove('no-panel-transition');
        recentSpendsPanel.classList.add('wrap-to-recent');
        setTimeout(() => {
          if (token !== leftPanelTransitionToken) return;
          recentSpendsPanel.classList.add('no-panel-transition');
          recentSpendsPanel.classList.remove('wrap-active-recent', 'wrap-to-recent', 'wrap-graded-recent', 'wrap-graded-active', 'wrap-to-active', 'show-active', 'show-graded');
          recentSpendsPanel.getBoundingClientRect();
          recentSpendsPanel.classList.remove('no-panel-transition');
          leftPanelMeasureMode = null;
          restoreLeftPanelScroll();
          updateLeftPanelLayout();
        }, 360);
        return;
      }
      animateLeftPanelHeader(mode);
      recentSpendsPanel?.classList.toggle('show-active', mode === 'active');
      recentSpendsPanel?.classList.toggle('show-graded', mode === 'graded');
      recentSpendsPanel?.classList.remove('returning-recent', 'return-to-recent', 'wrap-graded-recent', 'wrap-to-recent', 'wrap-graded-active', 'wrap-to-active', 'wrap-active-recent', 'no-panel-transition');
      setTimeout(() => {
        if (token !== leftPanelTransitionToken) return;
        leftPanelMeasureMode = null;
        restoreLeftPanelScroll();
        updateLeftPanelLayout();
      }, 360);
    });
  }

  function resetLeftPanelPagination() {
    for (const mode of LEFT_PANEL_MODES) {
      leftPanelRowsByMode[mode] = [];
      leftPanelVisibleRowsByMode[mode] = LEFT_PANEL_MAX_RENDERED_ROWS;
      leftPanelWindowStartByMode[mode] = 0;
    }
  }

  function entryGradedRecordId(entry) {
    return String(entry?.gradedRecordId || entry?.gradedRecord?.gradedRecordId || '');
  }

  function selectedLeftPanelRecordId(mode = leftPanelMode) {
    return mode === 'graded' ? String(selectedLeftPanelRecordIdByMode.graded || '') : '';
  }

  function leftPanelRowHtml(entry, mode) {
    const fundedMode = mode === 'active' || mode === 'graded';
    const block = fundedMode ? entry.createBlock : entry.redeemBlock;
    const time = fundedMode ? entry.createTime : entry.redeemTime;
    const action = mode === 'graded' ? 'Graded' : (mode === 'active' ? 'Funded' : 'Redeemed');
    const coin = allItemsSelected() ? COINS.find(c => c.slug === entry.slug) || activeCoin() : activeCoin();
    const isBar = coin.shape === 'bar';
    const address = String(entry.address || '');
    const gradedRecordId = mode === 'graded' ? entryGradedRecordId(entry) : '';
    const selected = selectedLeftPanelAddressByMode[mode] === address
      && (mode !== 'graded' || selectedLeftPanelRecordIdByMode.graded === gradedRecordId);
    const selectedStatusMode = isActiveStatus(entry) ? 'active' : (isUnfundedStatus(entry) ? 'unfunded' : 'recent');
    const iconImage = cssUrl(coinFrontThumbData(coin), { compact: true });
    const iconPosition = coin.thumbPosition || coin.frontPosition || 'center';
    const iconSize = isBar ? 'contain' : (coin.thumbBackgroundSize || coin.frontBackgroundSize || 'cover');
    const gradedRecord = mode === 'graded' ? entry.gradedRecord : null;
    const graderText = String(gradedRecord?.grader || '').trim();
    const gradeText = String(gradedRecord?.grade || '').trim();
    const soldDate = String(gradedRecord?.['auction sold date'] || '').trim();
    const soldAmount = gradedRecord?.['auction sold amount'];
    const gradeByGraderText = gradeText && graderText
      ? `${gradeText} by ${graderText}`
      : (gradeText || graderText);
    const valueText = entryDenominationText(entry, coin);
    const gradedLine = [valueText, gradeByGraderText].filter(Boolean).join(' ');
    const gradedSaleLine = formatAuctionResult(soldDate, soldAmount);
    return `
      <div
        class="spend-row${selected ? ` spend-row-selected spend-row-selected-${mode === 'graded' ? selectedStatusMode : mode}` : ''}"
        role="button"
        tabindex="0"
        data-panel-mode="${escapeHtml(mode)}"
        data-address="${escapeHtml(address)}"
        data-graded-record-id="${escapeHtml(gradedRecordId)}"
        data-slug="${escapeHtml(entry.slug || '')}"
      >
        <div class="spend-main">
          <span
            class="spend-icon${isBar ? ' spend-icon-bar' : ''}"
            aria-hidden="true"
            style="background-image: ${escapeHtml(iconImage)}; background-position: ${escapeHtml(iconPosition)}; background-size: ${escapeHtml(iconSize)};"
          ></span>
          <div class="spend-copy">
            <div class="spend-address">${escapeHtml(address)}</div>
            <div class="spend-line">${escapeHtml(mode === 'graded' && gradedRecord ? gradedLine : `${valueText} ${action}`)}</div>
          </div>
        </div>
        <div class="spend-time">${escapeHtml(mode === 'graded' && gradedRecord ? gradedSaleLine : `${formatInteger(block)} · ${formatUtcDateTime(time)}`)}</div>
      </div>
    `;
  }

  function applySelectedAddressToObject(address, coin = activeCoin()) {
    if (isDisplayOnlyAddress(address) || !linkableBitcoinAddress(address)) {
      address = '';
    }
    const firstbits = String(address || '').slice(0, 8);
    if (coin.shape === 'bar') {
      renderBarAddress(firstbits, coin);
      return;
    }
    model.classList.toggle('coin-back-address-active', Boolean(firstbits));
    renderCoinBackAddress(firstbits, coin);
  }

  function noAddressesLabel(mode = leftPanelMode) {
    if (mode === 'active') return 'No active addresses';
    if (mode === 'graded') return 'No graded addresses';
    return 'No redeemed addresses';
  }

  function syncSelectedLeftPanelAddress(mode = leftPanelMode, { forceDefault = false, apply = true } = {}) {
    const rows = leftPanelRowsByMode[mode] || [];
    if (!rows.length) {
      selectedLeftPanelAddressByMode[mode] = '';
      selectedLeftPanelRecordIdByMode[mode] = '';
      if (apply && mode === leftPanelMode) {
        if (allItemsMode) {
          syncFocusedAllItemsModelWhenLoaded();
        } else {
          applySelectedAddressToObject('', activeCoin());
        }
        updateSelectedCoinDetailSection();
        refreshBalanceChartHover();
      }
      return;
    }
    searchAddressNotFound = false;
    if (allItemsMode) {
      syncAllItemsLeftPanelSelectionToCentered({ mode, render: false, save: apply });
      return;
    }
    const current = selectedLeftPanelAddressByMode[mode];
    const hasCurrent = current && rows.some(entry => String(entry.address || '') === current);
    if (forceDefault || !hasCurrent) {
      selectedLeftPanelAddressByMode[mode] = String(rows[0].address || '');
      selectedLeftPanelRecordIdByMode[mode] = mode === 'graded' ? entryGradedRecordId(rows[0]) : '';
    } else if (mode === 'graded') {
      const currentRecordId = selectedLeftPanelRecordIdByMode.graded;
      const hasCurrentRecord = currentRecordId && rows.some(entry => leftPanelRowMatchesSelection(entry, current, currentRecordId, mode));
      if (!hasCurrentRecord) {
        const firstCurrent = rows.find(entry => String(entry.address || '') === current);
        selectedLeftPanelRecordIdByMode.graded = entryGradedRecordId(firstCurrent);
      }
    }
    if (apply && !allItemsMode) {
      const selectedAddress = selectedLeftPanelAddressByMode[mode];
      const selectedRecordId = selectedLeftPanelRecordId(mode);
      const selectedEntry = rows.find(entry => leftPanelRowMatchesSelection(entry, selectedAddress, selectedRecordId, mode)) || rows[0];
      const coin = COINS.find(c => c.slug === selectedEntry?.slug) || activeCoin();
      applySelectedAddressToObject(selectedEntry?.address, coin);
      updateSelectedCoinDetailSection();
      refreshBalanceChartHover();
      revealLeftPanelAddress(mode, selectedEntry?.address, { gradedRecordId: selectedRecordId, render: false });
    }
  }

  function renderLeftPanelRows(mode) {
    const view = activeLeftPanelView(mode);
    if (!view) return;
    const rows = leftPanelRowsByMode[mode] || [];
    const windowStart = normalizedLeftPanelWindowStart(mode);
    const windowEnd = Math.min(rows.length, windowStart + leftPanelVisibleRowsByMode[mode]);
    const visibleRows = rows.slice(windowStart, windowEnd);
    if (mode === leftPanelMode) recentSpendsPanel?.classList.remove('left-panel-selected-flush');
    if (!rows.length) {
      const emptyMessages = {
        recent: 'No redeemed spends found for this selection.',
        active: 'No active funded items found for this selection.',
        graded: 'No graded items found for this selection.'
      };
      view.innerHTML = `<div class="panel-empty">${emptyMessages[mode] || emptyMessages.recent}</div>`;
      lockLeftPanelBodyWidth();
      if (mode === leftPanelMode) syncSelectedLeftPanelAddress(mode);
      if (!refreshingLeftPanelData) updateLeftPanelLayout();
      return;
    }
    view.innerHTML = `<div class="spend-list">${visibleRows.map(entry => leftPanelRowHtml(entry, mode)).join('')}</div>`;
    lockLeftPanelBodyWidth();
    if (mode === leftPanelMode) updateSelectedCoinDetailSection();
    if (!refreshingLeftPanelData) updateLeftPanelLayout();
  }

  function leftPanelModeForEntry(entry) {
    if (isGradedEntry(entry)) return 'graded';
    return isActiveStatus(entry) ? 'active' : 'recent';
  }

  function setLeftPanelModeInstant(mode) {
    mode = validLeftPanelMode(mode);
    leftPanelMode = mode;
    savePanelState(mode);
    recentSpendsPanel?.classList.add('no-panel-transition');
    recentSpendsPanel?.classList.toggle('show-active', mode === 'active');
    recentSpendsPanel?.classList.toggle('show-graded', mode === 'graded');
    recentSpendsPanel?.classList.remove('returning-recent', 'return-to-recent', 'wrap-graded-recent', 'wrap-to-recent', 'wrap-graded-active', 'wrap-to-active', 'wrap-active-recent');
    syncLeftPanelHeader();
    recentSpendsPanel?.getBoundingClientRect();
    recentSpendsPanel?.classList.remove('no-panel-transition');
  }

  function normalizedLeftPanelWindowStart(mode) {
    const rows = leftPanelRowsByMode[mode] || [];
    const size = Math.min(LEFT_PANEL_MAX_RENDERED_ROWS, Math.max(LEFT_PANEL_BATCH_SIZE, leftPanelVisibleRowsByMode[mode] || LEFT_PANEL_BATCH_SIZE), rows.length || LEFT_PANEL_BATCH_SIZE);
    leftPanelVisibleRowsByMode[mode] = size;
    const maxStart = Math.max(0, rows.length - size);
    const start = Math.max(0, Math.min(leftPanelWindowStartByMode[mode] || 0, maxStart));
    leftPanelWindowStartByMode[mode] = start;
    return start;
  }

  function setLeftPanelWindowForIndex(mode, index, { center = false } = {}) {
    const rows = leftPanelRowsByMode[mode] || [];
    if (!rows.length) {
      leftPanelWindowStartByMode[mode] = 0;
      leftPanelVisibleRowsByMode[mode] = LEFT_PANEL_MAX_RENDERED_ROWS;
      return;
    }
    const size = Math.min(LEFT_PANEL_MAX_RENDERED_ROWS, rows.length);
    const preferredStart = center ? index - LEFT_PANEL_BATCH_SIZE : index;
    leftPanelVisibleRowsByMode[mode] = size;
    leftPanelWindowStartByMode[mode] = Math.max(0, Math.min(preferredStart, Math.max(0, rows.length - size)));
  }

  function maxUsefulLeftPanelScrollTop(mode = leftPanelMode) {
    if (!recentSpendsPanel) return 0;
    const view = activeLeftPanelView(mode);
    const list = view?.querySelector('.spend-list');
    const contentBottom = list
      ? list.offsetTop + list.scrollHeight
      : (view?.scrollHeight || recentSpendsPanel.scrollHeight || 0);
    return Math.max(0, Math.ceil(contentBottom - recentSpendsPanel.clientHeight));
  }

  function clampLeftPanelScroll(mode = leftPanelMode) {
    if (!recentSpendsPanel) return 0;
    const maxScrollTop = maxUsefulLeftPanelScrollTop(mode);
    const clamped = Math.max(0, Math.min(recentSpendsPanel.scrollTop || 0, maxScrollTop));
    if (Math.abs((recentSpendsPanel.scrollTop || 0) - clamped) > 0.5) {
      recentSpendsPanel.scrollTop = clamped;
    }
    return clamped;
  }

  function leftPanelRowElementForSelection(view, mode, address, gradedRecordId = '') {
    if (!view || !address) return null;
    return [...view.querySelectorAll(`.spend-row[data-address="${CSS.escape(String(address))}"]`)]
      .find(row => mode !== 'graded' || !gradedRecordId || String(row.dataset.gradedRecordId || '') === String(gradedRecordId))
      || null;
  }

  function applyLeftPanelAddressScroll(mode, address, { force = false, async = true, gradedRecordId = '' } = {}) {
    if (!recentSpendsPanel || !address || (!force && mode !== leftPanelMode)) return;
    const applyScroll = () => {
      if (!force && mode !== leftPanelMode) return;
      const view = activeLeftPanelView(mode);
      const row = leftPanelRowElementForSelection(view, mode, address, gradedRecordId);
      if (!row) return;
      const hasRowAbove = Boolean(row.previousElementSibling);
      recentSpendsPanel.classList.remove('left-panel-selected-flush');
      const maxUsefulScrollTop = maxUsefulLeftPanelScrollTop(mode);
      const hasScrollableOverflow = maxUsefulScrollTop > 1;
      if (!hasScrollableOverflow) {
        recentSpendsPanel.scrollTop = 0;
        leftPanelScrollTopByMode[mode] = 0;
        return;
      }
      const top = hasRowAbove ? Math.min(Math.max(0, row.offsetTop), maxUsefulScrollTop) : 0;
      recentSpendsPanel.classList.toggle('left-panel-selected-flush', top > 0);
      recentSpendsPanel.scrollTop = top;
      leftPanelScrollTopByMode[mode] = top;
    };
    if (async) {
      requestAnimationFrame(() => {
        applyScroll();
        requestAnimationFrame(applyScroll);
      });
    } else {
      applyScroll();
    }
  }

  function scrollLeftPanelAddressToTop(mode, address, options = {}) {
    applyLeftPanelAddressScroll(mode, address, options);
  }

  function revealLeftPanelAddress(mode, address, { render = true, gradedRecordId = '' } = {}) {
    if (!address) return;
    const rows = leftPanelRowsByMode[mode] || [];
    const index = rows.findIndex(row => leftPanelRowMatchesSelection(row, address, gradedRecordId, mode));
    if (index >= 0) {
      setLeftPanelWindowForIndex(mode, index, { center: true });
      if (render) renderLeftPanelRows(mode);
    }
    scrollLeftPanelAddressToTop(mode, address, { gradedRecordId });
  }

  function leftPanelRowMatchesSelection(row, address, gradedRecordId = '', mode = leftPanelMode) {
    if (String(row?.address || '') !== String(address || '')) return false;
    if (mode !== 'graded' || !gradedRecordId) return true;
    return String(row.gradedRecordId || row.gradedRecord?.gradedRecordId || '') === String(gradedRecordId);
  }

  function prepareLeftPanelModeForTransition(mode) {
    if (!recentSpendsPanel) return;
    if (allItemsMode) {
      syncAllItemsLeftPanelSelectionToCentered({ mode, render: false, save: false });
    } else {
      syncSelectedLeftPanelAddress(mode, { forceDefault: true, apply: false });
    }
    renderLeftPanelRows(mode);
    const address = selectedLeftPanelAddressByMode[mode];
    if (address) {
      applyLeftPanelAddressScroll(mode, address, { force: true, async: false, gradedRecordId: selectedLeftPanelRecordId(mode) });
    } else {
      recentSpendsPanel.classList.remove('left-panel-selected-flush');
      recentSpendsPanel.scrollTop = leftPanelScrollTopByMode[mode] || 0;
    }
  }

  function applySearchSelectionToPanels(entry, entries, { centerAll = allItemsMode, scroll = true } = {}) {
    if (!entry?.address) return false;
    const mode = leftPanelModeForEntry(entry);
    const address = String(entry.address || '');
    const cachedRows = cachedLeftPanelRows(entries);
    for (const panelMode of LEFT_PANEL_MODES) {
      leftPanelRowsByMode[panelMode] = cachedRows[panelMode] || [];
    }
    const rows = leftPanelRowsByMode[mode] || [];
    const gradedRecordId = entryGradedRecordId(entry);
    const index = rows.findIndex(row => leftPanelRowMatchesSelection(row, address, gradedRecordId, mode));
    if (index < 0) return false;
    selectedLeftPanelAddressByMode[mode] = address;
    selectedLeftPanelRecordIdByMode[mode] = mode === 'graded' ? gradedRecordId : '';
    setLeftPanelWindowForIndex(mode, index, { center: true });
    setLeftPanelModeInstant(mode);
    if (allItemsMode && centerAll) {
      centerAllItemsOnEntry(entry, { animate: true, save: true, syncSelection: false });
      saveAllItemsSelection(mode, address, allItemsEntrySlug(entry));
    } else if (!allItemsMode) {
      const coin = COINS.find(c => c.slug === entry.slug) || activeCoin();
      applySelectedAddressToObject(address, coin);
      if (mode === 'graded') saveGradedMediaSelection(mode);
    }
    for (const panelMode of LEFT_PANEL_MODES) renderLeftPanelRows(panelMode);
    updateSelectedCoinDetailSection();
    refreshBalanceChartHover();
    redrawOpenBalanceChart();
    if (scroll) revealLeftPanelAddress(mode, address, { gradedRecordId, render: false });
    return true;
  }

  function applyPendingSearchSelectionForMode(mode, entries) {
    if (pendingSearchSelection?.mode !== mode) return false;
    const rows = leftPanelRowsByMode[mode] || [];
    const address = String(pendingSearchSelection.address || '');
    const pendingRecordId = String(pendingSearchSelection.gradedRecordId || '');
    const entry = rows.find(row => leftPanelRowMatchesSelection(row, address, pendingRecordId, mode));
    if (!entry) return false;
    selectedLeftPanelAddressByMode[mode] = address;
    selectedLeftPanelRecordIdByMode[mode] = mode === 'graded' ? entryGradedRecordId(entry) : '';
    const index = rows.findIndex(row => leftPanelRowMatchesSelection(row, address, selectedLeftPanelRecordIdByMode[mode], mode));
    if (index >= 0) {
      setLeftPanelWindowForIndex(mode, index, { center: true });
    }
    if (mode === leftPanelMode && allItemsMode) centerAllItemsOnEntry(entry, { animate: true, save: true, syncSelection: false });
    if (mode === leftPanelMode && !allItemsMode) applySelectedAddressToObject(address, COINS.find(c => c.slug === entry.slug) || activeCoin());
    if (allItemsMode) saveAllItemsSelection(mode, address, allItemsEntrySlug(entry));
    searchedUnfundedEntry = null;
    pendingSearchSelection = null;
    return true;
  }

  function leftPanelCacheKey() {
    return allItemsSelected() ? ALL_ITEMS_GROUP_KEY : activeCoin().slug;
  }

  function cachedLeftPanelRows(entries) {
    const cacheKey = leftPanelCacheKey();
    if (leftPanelRowsCache.has(cacheKey)) return leftPanelRowsCache.get(cacheKey);
    const rows = rowsForCoin(entries);
    const cached = {
      recent: rows
        .filter(isRedeemedStatus)
        .sort((a, b) => (b.redeemTime || 0) - (a.redeemTime || 0) || (b.index || 0) - (a.index || 0)),
      active: rows
        .filter(isActiveStatus)
        .sort((a, b) => (b.createTime || 0) - (a.createTime || 0) || (b.createBlock || 0) - (a.createBlock || 0) || (b.index || 0) - (a.index || 0)),
      graded: rows
        .filter(isGradedEntry)
        .flatMap(gradedAuctionEntriesForEntry)
        .sort(compareGradedAuctionRows)
    };
    leftPanelRowsCache.set(cacheKey, cached);
    return cached;
  }

  function renderRecentSpends(entries) {
    leftPanelRowsByMode.recent = cachedLeftPanelRows(entries).recent;
    const pendingApplied = applyPendingSearchSelectionForMode('recent', entries);
    if (pendingApplied) {
      // The searched row should stay selected through async panel refreshes.
    } else if (allItemsMode && !allItemsSelectionRestorePending) {
      applyPendingAllItemsDefaultFocus({ animate: true });
      syncAllItemsLeftPanelSelectionToCentered({ mode: 'recent', render: false });
    } else {
      syncSelectedLeftPanelAddress('recent', { forceDefault: true, apply: leftPanelMode === 'recent' });
    }
    renderLeftPanelRows('recent');
    if (pendingApplied && leftPanelMode === 'recent') scrollLeftPanelAddressToTop('recent', selectedLeftPanelAddressByMode.recent);
  }

  function renderActiveCoins(entries) {
    leftPanelRowsByMode.active = cachedLeftPanelRows(entries).active;
    const pendingApplied = applyPendingSearchSelectionForMode('active', entries);
    if (pendingApplied) {
      // The searched row should stay selected through async panel refreshes.
    } else if (allItemsMode && !allItemsSelectionRestorePending) {
      syncAllItemsLeftPanelSelectionToCentered({ mode: 'active', render: false });
    } else {
      syncSelectedLeftPanelAddress('active', { forceDefault: true, apply: leftPanelMode === 'active' });
    }
    renderLeftPanelRows('active');
    if (pendingApplied && leftPanelMode === 'active') scrollLeftPanelAddressToTop('active', selectedLeftPanelAddressByMode.active);
  }

  function renderGradedCoins(entries) {
    leftPanelRowsByMode.graded = cachedLeftPanelRows(entries).graded;
    const pendingApplied = applyPendingSearchSelectionForMode('graded', entries);
    if (pendingApplied) {
      // The searched row should stay selected through async panel refreshes.
    } else if (allItemsMode && !allItemsSelectionRestorePending) {
      syncAllItemsLeftPanelSelectionToCentered({ mode: 'graded', render: false });
    } else {
      syncSelectedLeftPanelAddress('graded', { forceDefault: false, apply: leftPanelMode === 'graded' });
    }
    renderLeftPanelRows('graded');
    if (pendingApplied && leftPanelMode === 'graded') {
      scrollLeftPanelAddressToTop('graded', selectedLeftPanelAddressByMode.graded, {
        gradedRecordId: selectedLeftPanelRecordIdByMode.graded
      });
    }
  }

  function hydrateGradedPanelForCurrentSelection() {
    const token = panelRenderToken;
    const slug = activeSlug;
    trackerIndexWithGraded().then(entries => {
      if (token !== panelRenderToken || slug !== activeSlug) return;
      leftPanelRowsCache.clear();
      updateLeftPanelCounts(entries);
      refreshingLeftPanelData = true;
      renderGradedCoins(entries);
      refreshingLeftPanelData = false;
      renderCoinInfo(entries);
      syncLeftPanelHeader();
      if (leftPanelMode === 'graded') {
        syncLeftPanelMode();
      } else {
        renderLeftPanelRows('graded');
      }
      updateLeftPanelLayout();
    });
  }

  function allItemsEntrySlug(entry) {
    const slug = SHARED_STATS_SLUGS[entry?.slug] || entry?.slug;
    return ALL_ITEMS_PACKING.items.some(item => item.slug === slug) ? slug : '';
  }

  function latestRedeemedAllItemsSlug() {
    const rows = leftPanelRowsByMode.recent || [];
    const entry = rows.find(item => allItemsEntrySlug(item));
    return allItemsEntrySlug(entry);
  }

  function allItemsRowForCenteredSlug(mode = leftPanelMode, slug = allItemsCenteredSlug()) {
    const rows = leftPanelRowsByMode[mode] || [];
    const statsSlug = SHARED_STATS_SLUGS[slug] || slug;
    return rows.find(entry => allItemsEntrySlug(entry) === statsSlug) || null;
  }

  function currentAllItemsSelectionForSingleView(slug = allItemsFocusedSlug) {
    if (!allItemsMode) return null;
    const targetSlug = SHARED_STATS_SLUGS[slug] || slug;
    const mode = validLeftPanelMode(leftPanelMode);
    const selectedAddress = String(selectedLeftPanelAddressByMode[mode] || '');
    const selectedRecordId = selectedLeftPanelRecordId(mode);
    const rows = leftPanelRowsByMode[mode] || [];
    const selected = selectedAddress
      ? rows.find(entry => leftPanelRowMatchesSelection(entry, selectedAddress, selectedRecordId, mode) && allItemsEntrySlug(entry) === targetSlug)
      : null;
    const entry = selected || allItemsRowForCenteredSlug(mode, targetSlug);
    const address = String(entry?.address || '');
    return address ? { mode, address, gradedRecordId: entryGradedRecordId(entry) } : null;
  }

  function currentSingleViewSelectionForAllItems({ preferGraded = false } = {}) {
    if (allItemsMode) return null;
    if (preferGraded) {
      const graded = selectedGradedMediaEntry(currentBalanceChartRows);
      const gradedAddress = String(graded?.address || '').trim();
      const gradedSlug = allItemsEntrySlug(graded?.entry) || (allItemsPackingItem(activeCoin().slug)?.slug || '');
      if (gradedAddress && gradedSlug) {
        return { mode: 'graded', address: gradedAddress, gradedRecordId: entryGradedRecordId(graded?.entry), slug: gradedSlug };
      }
    }
    const mode = validLeftPanelMode(leftPanelMode);
    const entry = selectedTrackerEntry(currentBalanceChartRows, mode);
    const address = String(entry?.address || '');
    const slug = allItemsEntrySlug(entry) || (allItemsPackingItem(activeCoin().slug)?.slug || '');
    return address && slug ? { mode, address, gradedRecordId: entryGradedRecordId(entry), slug } : null;
  }

  function enterAllItemsModeWithSingleSelection(options = {}) {
    const selection = currentSingleViewSelectionForAllItems(options);
    if (!selection) {
      enterAllItemsMode({ align: true });
      return;
    }
    allItemsFocusedSlug = selection.slug;
    allItemsDefaultFocusPending = false;
    allItemsSelectionRestorePending = false;
    selectedLeftPanelAddressByMode[selection.mode] = selection.address;
    selectedLeftPanelRecordIdByMode[selection.mode] = selection.mode === 'graded' ? (selection.gradedRecordId || '') : '';
    pendingSearchSelection = {
      mode: selection.mode,
      address: selection.address,
      gradedRecordId: selection.gradedRecordId || ''
    };
    setLeftPanelModeInstant(selection.mode);
    enterAllItemsMode({ align: false });
  }

  function syncAllItemsLeftPanelSelectionToCentered({ mode = leftPanelMode, render = true, save = false, revealModel = true } = {}) {
    if (!allItemsMode) return;
    const slug = allItemsPackingItem(allItemsFocusedSlug)?.slug || DEFAULT_ALL_ITEMS_FOCUS_SLUG;
    const row = allItemsRowForCenteredSlug(mode, slug);
    const nextAddress = row ? String(row.address || '') : '';
    selectedLeftPanelAddressByMode[mode] = nextAddress;
    selectedLeftPanelRecordIdByMode[mode] = mode === 'graded' ? entryGradedRecordId(row) : '';
    if (nextAddress) {
      revealLeftPanelAddress(mode, nextAddress, { gradedRecordId: selectedLeftPanelRecordId(mode), render });
    } else if (render) {
      renderLeftPanelRows(mode);
    }
    syncFocusedAllItemsModelWhenLoaded({ reveal: revealModel });
    updateSelectedCoinDetailSection();
    refreshBalanceChartHover();
    if (save) {
      saveAllItemsWindow();
      saveAllItemsSelection(mode, nextAddress, slug);
    }
  }

  function centerAllItemsOnEntry(entry, { animate = true, save = true, syncSelection = true } = {}) {
    const slug = allItemsEntrySlug(entry);
    if (!slug) return false;
    allItemsDefaultFocusPending = false;
    centerAllItemsOnPlacement(nearestAllItemsPlacement(slug), { animate, save, syncSelection });
    return true;
  }

  function restoreSavedAllItemsSelection(entries) {
    if (!allItemsMode || !allItemsSelectionRestorePending || !savedAllItemsSelection) return false;
    const address = String(savedAllItemsSelection.address || '').trim();
    const mode = address ? validLeftPanelMode(savedAllItemsSelection.mode) : leftPanelMode;
    const savedSlug = String(savedAllItemsSelection.slug || '').trim();
    const rows = leftPanelRowsByMode[mode] || cachedLeftPanelRows(entries)[mode] || [];
    const savedRecordId = String(savedAllItemsSelection?.gradedRecordId || '').trim();
    const entry = address ? rows.find(row => leftPanelRowMatchesSelection(row, address, savedRecordId, mode)) : null;
    const targetSlug = allItemsEntrySlug(entry) || (allItemsPackingItem(savedSlug)?.slug || '');
    allItemsSelectionRestorePending = false;
    if (!targetSlug) {
      setLeftPanelModeInstant(mode);
      for (const panelMode of LEFT_PANEL_MODES) renderLeftPanelRows(panelMode);
      updateSelectedCoinDetailSection();
      refreshBalanceChartHover();
      return false;
    }
    allItemsDefaultFocusPending = false;
    selectedLeftPanelAddressByMode[mode] = entry ? address : '';
    selectedLeftPanelRecordIdByMode[mode] = mode === 'graded' && entry ? entryGradedRecordId(entry) : '';
    setLeftPanelModeInstant(mode);
    centerAllItemsOnPlacement(nearestAllItemsPlacement(targetSlug), { animate: false, save: true, syncSelection: false });
    saveAllItemsSelection(mode, entry ? address : '', targetSlug);
    for (const panelMode of LEFT_PANEL_MODES) renderLeftPanelRows(panelMode);
    if (entry) revealLeftPanelAddress(mode, address, { gradedRecordId: selectedLeftPanelRecordId(mode), render: false });
    updateSelectedCoinDetailSection();
    refreshBalanceChartHover();
    return true;
  }

  function applyPendingAllItemsDefaultFocus({ animate = true } = {}) {
    if (!allItemsMode || !allItemsDefaultFocusPending || !allItemsBuilt) return false;
    const slug = latestRedeemedAllItemsSlug();
    if (!slug) return false;
    allItemsDefaultFocusPending = false;
    centerAllItemsOnPlacement(nearestAllItemsPlacement(slug), { animate, save: true, animateTransform: false });
    return true;
  }

  function maybeLoadMoreLeftPanelRows() {
    if (!recentSpendsPanel || leftPanelMeasureMode) return;
    const rows = leftPanelRowsByMode[leftPanelMode] || [];
    if (rows.length <= LEFT_PANEL_MAX_RENDERED_ROWS) return;
    const visibleRows = Math.min(LEFT_PANEL_MAX_RENDERED_ROWS, leftPanelVisibleRowsByMode[leftPanelMode] || LEFT_PANEL_MAX_RENDERED_ROWS);
    const start = normalizedLeftPanelWindowStart(leftPanelMode);
    const maxScrollTop = maxUsefulLeftPanelScrollTop(leftPanelMode);
    const bottomDistance = maxScrollTop - recentSpendsPanel.scrollTop;
    if (bottomDistance <= 8 && start + visibleRows < rows.length) {
      leftPanelWindowStartByMode[leftPanelMode] = Math.min(start + LEFT_PANEL_BATCH_SIZE, Math.max(0, rows.length - visibleRows));
      renderLeftPanelRows(leftPanelMode);
      recentSpendsPanel.scrollTop = Math.max(0, maxUsefulLeftPanelScrollTop(leftPanelMode) / 2);
      updateLeftPanelLayout();
      return;
    }
    if (recentSpendsPanel.scrollTop <= 8 && start > 0) {
      leftPanelWindowStartByMode[leftPanelMode] = Math.max(0, start - LEFT_PANEL_BATCH_SIZE);
      renderLeftPanelRows(leftPanelMode);
      recentSpendsPanel.scrollTop = Math.max(0, maxUsefulLeftPanelScrollTop(leftPanelMode) / 2);
      updateLeftPanelLayout();
    }
  }

  function selectLeftPanelAddressFromRow(row) {
    if (!row) return;
    searchAddressNotFound = false;
    searchedUnfundedEntry = null;
    pendingSearchSelection = null;
    const mode = validLeftPanelMode(row.dataset.panelMode);
    const address = String(row.dataset.address || '');
    const gradedRecordId = String(row.dataset.gradedRecordId || '');
    if (!address) return;
    selectedLeftPanelAddressByMode[mode] = address;
    selectedLeftPanelRecordIdByMode[mode] = mode === 'graded' ? gradedRecordId : '';
    const rows = leftPanelRowsByMode[mode] || [];
    const entry = rows.find(item => leftPanelRowMatchesSelection(item, address, gradedRecordId, mode));
    const coin = allItemsMode ? COINS.find(c => c.slug === (entry?.slug || row.dataset.slug)) || activeCoin() : activeCoin();
    if (allItemsMode) {
      centerAllItemsOnEntry(entry || { slug: row.dataset.slug }, { animate: true, save: true, syncSelection: false });
      saveAllItemsSelection(mode, address, allItemsEntrySlug(entry) || row.dataset.slug);
      renderLeftPanelRows(mode);
      updateSelectedCoinDetailSection();
    } else {
      applySelectedAddressToObject(address, coin);
      if (mode === 'graded') saveGradedMediaSelection(mode);
      renderLeftPanelRows(mode);
      updateSelectedCoinDetailSection();
    }
    redrawOpenBalanceChart();
    refreshBalanceChartHover();
  }

  function precalculatedRightPanelInfo() {
    const items = window.CASASCIUS_RIGHT_PANEL_DATA?.items;
    if (!items) return null;
    const slug = allItemsSelected() ? ALL_ITEMS_GROUP_KEY : activeCoin().slug;
    const info = items[slug];
    return info ? { slug, ...info } : null;
  }

  function rightPanelMintageNote(info) {
    return info?.mintageNote || MINTAGE_NOTES[info?.slug] || '';
  }

  function rightPanelStatsCells(info) {
    if (info?.statsMode === 'dash') {
      return { minted: '—', active: '—', redeemed: '—' };
    }
    const minted = Number(info?.minted);
    const active = Number(info?.active);
    const redeemed = Number(info?.redeemed);
    const noteMark = rightPanelMintageNote(info) ? '<span class="info-note-mark">*</span>' : '';
    return {
      minted: `${escapeHtml(formatInteger(minted))}${noteMark}`,
      active: formatCountShare(active, minted),
      redeemed: formatCountShare(redeemed, minted)
    };
  }

  function rightPanelTableHtml(info) {
    const statsCells = rightPanelStatsCells(info);
    const mintageNote = rightPanelMintageNote(info);
    const noteRow = mintageNote
      ? `<tr class="info-note-row"><td colspan="2"><span class="info-note-mark">*</span>${escapeHtml(mintageNote)}</td></tr>`
      : '';
    const unfunded = Number(info?.unfunded);
    const unfundedRow = info?.statsMode !== 'dash' && Number.isFinite(unfunded) && unfunded > 0
      ? `<tr><th><span class="info-label-dot info-label-dot-unfunded"></span>Unfunded</th><td>${escapeHtml(formatInteger(unfunded))}</td></tr>`
      : '';
    return `
      <table class="info-table">
        <tbody>
          <tr><th><span class="info-label-dot info-label-dot-minted"></span>Funded</th><td>${statsCells.minted}</td></tr>
          <tr><th><span class="info-label-dot info-label-dot-active"></span>Active</th><td>${statsCells.active}</td></tr>
          <tr><th><span class="info-label-dot info-label-dot-redeemed"></span>Redeemed</th><td>${statsCells.redeemed}</td></tr>
          ${unfundedRow}
          <tr><th>First Funding</th><td>${escapeHtml(formatBlockDay(info?.firstBlock, info?.firstTime))}</td></tr>
          <tr><th>Last Redeem</th><td>${escapeHtml(formatBlockDay(info?.lastBlock, info?.lastTime))}</td></tr>
          ${noteRow}
        </tbody>
      </table>
    `;
  }

  function balanceChartHtml(rows, { keepEmpty = false } = {}) {
    const hasChartData = rows?.some(entry => Number.isFinite(entry.value) && (Number.isFinite(entry.createTime) || Number.isFinite(entry.redeemTime)));
    if (!hasChartData && !keepEmpty) return '';
    return `
      <button class="balance-chart-thumb${hasChartData ? '' : ' balance-chart-thumb-empty'}" type="button"${hasChartData ? ' data-balance-chart-open aria-label="Open balance chart"' : ' aria-label="No balance chart available" tabindex="-1"'}>
        <canvas class="balance-chart-canvas" width="320" height="108" aria-hidden="true"></canvas>
      </button>
    `;
  }

  function selectedTrackerEntry(rows = currentBalanceChartRows, mode = leftPanelMode) {
    const panelRows = leftPanelRowsByMode[mode] || [];
    const selectedAddress = selectedLeftPanelAddressByMode[mode];
    const selectedRecordId = mode === 'graded' ? selectedLeftPanelRecordIdByMode.graded : '';
    const selected = selectedAddress && panelRows.find(entry => leftPanelRowMatchesSelection(entry, selectedAddress, selectedRecordId, mode));
    if (selected) return selected;
    const selectedInRows = selectedAddress && rows?.find(entry => String(entry.address || '') === selectedAddress);
    if (selectedInRows) return selectedInRows;
    if (!panelRows.length) return null;
    return null;
  }

  function selectedPriceChartEntry(rows = currentBalanceChartRows) {
    return selectedTrackerEntry(rows, 'graded') || selectedTrackerEntry(rows);
  }

  function selectedObjectAddress(mode = leftPanelMode) {
    const rows = leftPanelRowsByMode[mode] || [];
    if (!rows.length) return '';
    const selectedAddress = selectedLeftPanelAddressByMode[mode];
    const selected = selectedAddress && rows.find(entry => String(entry.address || '') === selectedAddress);
    if (isDisplayOnlyAddress(selected)) return '';
    return String(selected?.address || '');
  }

  function selectedGradedMediaEntry(rows = currentBalanceChartRows) {
    if (allItemsMode) return null;
    const entry = selectedTrackerEntry(rows);
    const address = String(entry?.address || '');
    const media = gradedMediaForEntry(entry);
    return media ? { entry, address, media } : null;
  }

  function selectedAddressHasGradedMedia(rows = currentBalanceChartRows) {
    if (allItemsMode) return false;
    const entry = selectedTrackerEntry(rows);
    const address = String(entry?.address || '').trim();
    return Boolean(address && gradedMediaForEntry(entry));
  }

  function updateGradedMediaDots() {
    gradedMediaDots?.querySelectorAll('.graded-media-dot').forEach(button => {
      const active = button.dataset.gradedMediaMode === gradedMediaMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function gradedMediaModesForMedia(media) {
    if (!media) return [];
    return ['model', 'case'];
  }

  function resolveGradedMediaMode(mode, media) {
    const modes = gradedMediaModesForMedia(media);
    return modes.includes(mode) ? mode : 'model';
  }

  function addGradedCaseEdgeSegment(frag, x, y, angleDeg, len, thick, region = '') {
    const el = document.createElement('i');
    const isArc = region.includes('arc');
    const styleClass = gradedCaseStyle === 'pcgs' ? 'graded-case-edge-pcgs' : 'graded-case-edge-ngc';
    el.className = `graded-case-edge-segment ${styleClass} ${isArc ? 'graded-case-edge-arc' : 'graded-case-edge-straight'}`;
    el.style.width = `${len}px`;
    el.style.height = `${thick}px`;
    el.style.marginLeft = `${-len / 2}px`;
    el.style.marginTop = `${-thick / 2}px`;
    el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotateZ(${angleDeg.toFixed(2)}deg) rotateX(90deg)`;
    if (gradedCaseStyle === 'pcgs') {
      el.style.setProperty('--case-edge-a', '#f8fbff');
      el.style.setProperty('--case-edge-b', '#cad5dc');
      el.style.setProperty('--case-edge-c', '#8e9ba4');
      el.style.setProperty('--case-edge-ridge', '0.070');
      el.style.setProperty('--case-edge-shadow', '0.105');
      el.style.setProperty('--case-edge-shadow-soft', '0.075');
      el.style.setProperty('--case-edge-glint', '0.420');
      el.style.setProperty('--case-edge-glint-mid', '0.260');
      el.style.setProperty('--case-edge-glint-low', '0.185');
    } else {
      el.style.setProperty('--case-edge-a', '#e7ecee');
      el.style.setProperty('--case-edge-b', '#9fa8aa');
      el.style.setProperty('--case-edge-c', '#7e898c');
      el.style.setProperty('--case-edge-ridge', '0.420');
      el.style.setProperty('--case-edge-shadow', '0.160');
      el.style.setProperty('--case-edge-shadow-soft', '0.115');
      el.style.setProperty('--case-edge-glint', '0.340');
      el.style.setProperty('--case-edge-glint-mid', '0.190');
      el.style.setProperty('--case-edge-glint-low', '0.145');
    }
    frag.appendChild(el);
  }

  function buildGradedCaseEdges() {
    if (!gradedCaseModel || !gradedCaseScene) return;
    gradedCaseModel.querySelectorAll('.graded-case-edge-segment').forEach(el => el.remove());
    const styles = getComputedStyle(root);
    const sceneRect = gradedCaseScene.getBoundingClientRect();
    const w = parseFloat(styles.getPropertyValue('--graded-case-w')) || sceneRect.width || 420;
    const h = parseFloat(styles.getPropertyValue('--graded-case-h')) || sceneRect.height || 560;
    const t = parseFloat(styles.getPropertyValue('--graded-case-thickness')) || Math.max(12, w * 0.045);
    const cornerRatio = parseFloat(styles.getPropertyValue('--graded-case-corner-ratio')) || 0.16;
    const halfW = w / 2;
    const halfH = h / 2;
    const r = Math.min(w, h) * cornerRatio;
    const straightLenX = Math.max(0, w - 2 * r);
    const straightLenY = Math.max(0, h - 2 * r);
    const arcStep = gradedCaseStyle === 'pcgs' ? 3 : 6;
    const arcLen = Math.max(4, (2 * Math.PI * r) * (arcStep / 360) + 1);
    const frag = document.createDocumentFragment();
    const edgeFrag = document.createDocumentFragment();
    if (straightLenX > 0) addGradedCaseEdgeSegment(edgeFrag, 0, -halfH, 0, straightLenX, t, 'top');
    for (let a = 270; a <= 360.001; a += arcStep) {
      const rad = a * Math.PI / 180;
      addGradedCaseEdgeSegment(edgeFrag, halfW - r + Math.cos(rad) * r, -halfH + r + Math.sin(rad) * r, a + 90, arcLen, t, 'top-right-arc');
    }
    if (straightLenY > 0) addGradedCaseEdgeSegment(edgeFrag, halfW, 0, 90, straightLenY, t, 'right');
    for (let a = 0; a <= 90.001; a += arcStep) {
      const rad = a * Math.PI / 180;
      addGradedCaseEdgeSegment(edgeFrag, halfW - r + Math.cos(rad) * r, halfH - r + Math.sin(rad) * r, a + 90, arcLen, t, 'bottom-right-arc');
    }
    if (straightLenX > 0) addGradedCaseEdgeSegment(edgeFrag, 0, halfH, 180, straightLenX, t, 'bottom');
    for (let a = 90; a <= 180.001; a += arcStep) {
      const rad = a * Math.PI / 180;
      addGradedCaseEdgeSegment(edgeFrag, -halfW + r + Math.cos(rad) * r, halfH - r + Math.sin(rad) * r, a + 90, arcLen, t, 'bottom-left-arc');
    }
    if (straightLenY > 0) addGradedCaseEdgeSegment(edgeFrag, -halfW, 0, 270, straightLenY, t, 'left');
    for (let a = 180; a <= 270.001; a += arcStep) {
      const rad = a * Math.PI / 180;
      addGradedCaseEdgeSegment(edgeFrag, -halfW + r + Math.cos(rad) * r, -halfH + r + Math.sin(rad) * r, a + 90, arcLen, t, 'top-left-arc');
    }
    frag.appendChild(edgeFrag);
    gradedCaseModel.insertBefore(frag, gradedCaseModel.firstChild);
  }

  function syncGradedMediaViewer(rows = currentBalanceChartRows) {
    const selected = selectedGradedMediaEntry(rows);
    const available = Boolean(selected);
    if (!available) {
      gradedMediaMode = 'model';
      gradedMediaAddress = '';
    } else if (gradedMediaAddress !== selected.address) {
      gradedMediaMode = resolveGradedMediaMode(readSavedGradedMediaMode(), selected.media);
      gradedMediaAddress = selected.address;
    } else {
      gradedMediaMode = resolveGradedMediaMode(gradedMediaMode, selected.media);
    }
    app?.classList.toggle('graded-media-available', available);
    app?.classList.toggle('graded-media-image-mode', available && gradedMediaMode !== 'model' && gradedMediaMode !== 'case');
    app?.classList.toggle('graded-media-case-mode', available && gradedMediaMode === 'case');
    app?.classList.toggle('graded-media-pcgs-case', available && selected?.media?.caseStyle === 'pcgs');
    root.classList.toggle('graded-media-available', available);
    root.classList.toggle('graded-media-image-mode', available && gradedMediaMode !== 'model' && gradedMediaMode !== 'case');
    root.classList.toggle('graded-media-case-mode', available && gradedMediaMode === 'case');
    root.classList.toggle('graded-media-pcgs-case', available && selected?.media?.caseStyle === 'pcgs');
    if (!(available && gradedMediaMode === 'case')) clearGradedCaseCursor();
    const caseLoadToken = ++gradedCaseLoadToken;
    const caseLoadingKey = `graded-case:${caseLoadToken}`;
    gradedCaseModel?.classList.remove('loaded');
    if (available && gradedMediaMode === 'case') setStageLoading(caseLoadingKey, true);
    if (available) {
      const imageWidth = Number(selected.media.imageWidthPx) || 1;
      const imageHeight = Number(selected.media.imageHeightPx) || 1;
      const caseThicknessMm = Number(selected.media.caseThicknessMm) || 7.2;
      const caseCornerRatio = Number(selected.media.caseCornerRatio) || 0.16;
      const caseWidthMm = Number(selected.media.caseWidthMm) || 64.3;
      const caseHeightMm = Number(selected.media.caseHeightMm) || 85.9;
      const pxPerMm = baseObjectSizePx() / MAX_PHYSICAL_MM;
      const caseW = caseWidthMm * pxPerMm;
      const caseH = caseHeightMm * pxPerMm;
      gradedCaseStyle = selected.media.caseStyle === 'pcgs' ? 'pcgs' : 'ngc';
      root.style.setProperty('--graded-media-w', `${caseW.toFixed(2)}px`);
      root.style.setProperty('--graded-media-aspect-ratio', `${imageWidth} / ${imageHeight}`);
      root.style.setProperty('--graded-case-w', `${caseW.toFixed(2)}px`);
      root.style.setProperty('--graded-case-h', `${caseH.toFixed(2)}px`);
      root.style.setProperty('--graded-case-thickness', `${(caseThicknessMm * pxPerMm).toFixed(2)}px`);
      root.style.setProperty('--graded-case-corner-ratio', caseCornerRatio.toFixed(4));
      const caseFront = gradedCaseModel?.querySelector('.graded-case-image-front');
      const caseBack = gradedCaseModel?.querySelector('.graded-case-image-back');
      gradedCaseModel?.querySelectorAll('.graded-case-edge-segment').forEach(el => el.remove());
      Promise.allSettled([loadImage(selected.media.front), loadImage(selected.media.back)]).then(() => {
        if (caseLoadToken !== gradedCaseLoadToken || !available || gradedMediaAddress !== selected.address) return;
        requestAnimationFrame(() => {
          if (caseLoadToken !== gradedCaseLoadToken || gradedMediaAddress !== selected.address) return;
          if (caseFront) caseFront.style.backgroundImage = cssUrl(selected.media.front);
          if (caseBack) caseBack.style.backgroundImage = cssUrl(selected.media.back);
          buildGradedCaseEdges();
          gradedCaseModel?.classList.add('loaded');
          setStageLoading(caseLoadingKey, false);
        });
      }).finally(() => {
        if (caseLoadToken !== gradedCaseLoadToken || gradedMediaMode !== 'case') setStageLoading(caseLoadingKey, false);
      });
    } else {
      setStageLoading(caseLoadingKey, false);
      root.style.removeProperty('--graded-media-width-ratio');
      root.style.removeProperty('--graded-media-w');
      root.style.removeProperty('--graded-media-aspect-ratio');
      root.style.removeProperty('--graded-case-w');
      root.style.removeProperty('--graded-case-h');
      root.style.removeProperty('--graded-case-thickness');
      root.style.removeProperty('--graded-case-corner-ratio');
      gradedCaseStyle = 'ngc';
      const caseFront = gradedCaseModel?.querySelector('.graded-case-image-front');
      const caseBack = gradedCaseModel?.querySelector('.graded-case-image-back');
      if (caseFront) caseFront.style.backgroundImage = '';
      if (caseBack) caseBack.style.backgroundImage = '';
      gradedCaseModel?.querySelectorAll('.graded-case-edge-segment').forEach(el => el.remove());
    }
    if (gradedMediaViewer) gradedMediaViewer.setAttribute('aria-hidden', String(!(available && gradedMediaMode !== 'model' && gradedMediaMode !== 'case')));
    if (gradedCaseScene) gradedCaseScene.setAttribute('aria-hidden', String(!(available && gradedMediaMode === 'case')));
    if (gradedMediaImage) {
      const src = available && gradedMediaMode !== 'model' && gradedMediaMode !== 'case' ? selected.media[gradedMediaMode] : '';
      if (src) {
        if (gradedMediaImage.getAttribute('src') !== src) gradedMediaImage.setAttribute('src', src);
      } else {
        gradedMediaImage.removeAttribute('src');
      }
      gradedMediaImage.alt = available && gradedMediaMode !== 'model' && gradedMediaMode !== 'case'
        ? `${selected.address} graded ${gradedMediaMode} image`
        : '';
    }
    updateGradedMediaDots();
    if (available && gradedMediaMode !== 'model' && !pendingSearchSelection) saveGradedMediaSelection();
    updateComparisonSpacing();
  }

  function setGradedMediaMode(mode, { persist = true } = {}) {
    if (!['model', 'case', 'front', 'back'].includes(mode)) return;
    gradedMediaMode = mode;
    if (persist) {
      saveGradedMediaMode(mode);
      if (mode !== 'model') saveGradedMediaSelection();
    }
    syncGradedMediaViewer();
  }

  function gradedMediaModesForSelected() {
    const selected = selectedGradedMediaEntry();
    return gradedMediaModesForMedia(selected?.media);
  }

  function setGradedMediaModeByNumber(value) {
    const index = Number(value) - 1;
    const modes = gradedMediaModesForSelected();
    if (!Number.isInteger(index) || index < 0 || index >= modes.length) return false;
    setGradedMediaMode(modes[index]);
    return true;
  }

  function selectedCoinAddressHtml(entry, coinOverride = null, {
    addressText = null,
    iconImageOverride = null,
    iconPositionOverride = null,
    iconSizeOverride = null
  } = {}) {
    const coin = coinOverride || COINS.find(c => c.slug === entry?.slug) || comparisonCoin();
    const isBar = coin.shape === 'bar';
    const status = entry ? (isActiveStatus(entry) ? 'active' : (isUnfundedStatus(entry) ? 'unfunded' : 'recent')) : 'none';
    const iconImage = cssUrl(iconImageOverride || coinFrontThumbData(coin), { compact: true });
    const iconPosition = iconPositionOverride || coin.thumbPosition || coin.frontPosition || 'center';
    const iconSize = iconSizeOverride || (isBar ? 'contain' : (coin.thumbBackgroundSize || coin.frontBackgroundSize || 'cover'));
    const displayAddress = addressText || entry?.address || 'No selected address';
    const realAddress = entry?.address ? String(entry.address) : '';
    const addressHtml = realAddress && !isDisplayOnlyAddress(entry) && linkableBitcoinAddress(realAddress)
      ? `<a class="spend-address selected-coin-address-text selected-coin-address-link" href="https://mempool.space/address/${encodeURIComponent(realAddress)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayAddress)}</a>`
      : `<span class="spend-address selected-coin-address-text">${escapeHtml(displayAddress)}</span>`;
    return `
      <div class="selected-coin-address selected-coin-address-${status}">
        <span class="selected-coin-status" aria-hidden="true"></span>
        <span
          class="spend-icon selected-coin-icon${isBar ? ' spend-icon-bar' : ''}"
          aria-hidden="true"
          style="background-image: ${escapeHtml(iconImage)}; background-position: ${escapeHtml(iconPosition)}; background-size: ${escapeHtml(iconSize)};"
        ></span>
        ${addressHtml}
      </div>
    `;
  }

  function selectedCoinInfoRowsHtml(entry, rows = [], coinOverride = null, { forceDash = false } = {}) {
    const coin = coinOverride || COINS.find(c => c.slug === entry?.slug) || comparisonCoin();
    const info = window.CASASCIUS_RIGHT_PANEL_DATA?.items?.[coin.slug] || null;
    const statsSlug = SHARED_STATS_SLUGS[coin.slug] || coin.slug;
    const sameCoinRows = rows.filter(row => row.slug === statsSlug);
    const shape = objectShape(coin);
    const material = allItemsMode && coin.slug === 'cas_10btc_2012_silver_gold_b'
      ? 'Silver'
      : info?.material || rightPanelMaterialDescriptor(coin) || '—';
    const series = info?.series || (isMuleCoin(coin) ? 'Mule' : coin.series || `Series ${seriesValue(coin)}`);
    const dimensions = info?.dimensions || dimensionsOnlyText(coin) || '—';
    const denomination = entry && coin?.slug === 'cas_bar_diy_gold_s2'
      ? btcDenominationText(diyBarLoadedValue(entry))
      : info?.denomination || denominationInfoText(coin, sameCoinRows.length ? sameCoinRows : rows);
    const fundedText = isUnfundedStatus(entry) ? '—' : formatBlockDay(entry?.createBlock, entry?.createTime);
    const redeemedText = isActiveStatus(entry) || isUnfundedStatus(entry)
      ? '—'
      : formatBlockDay(entry?.redeemBlock, entry?.redeemTime);
    const gradedRecord = entry?.gradedRecord || null;
    const graderText = String(gradedRecord?.grader || '').trim();
    const gradeText = String(gradedRecord?.grade || '').trim();
    const graderLink = String(gradedRecord?.['grader link'] || '').trim();
    const auctionSoldDate = String(gradedRecord?.['auction sold date'] || '').trim();
    const auctionSoldAmount = gradedRecord?.['auction sold amount'];
    const auctionLink = String(gradedRecord?.['auction link'] || '').trim();
    const auctionText = formatAuctionResult(auctionSoldDate, auctionSoldAmount, { soldPrefix: false });
    const combinedGradeText = gradeText && graderText
      ? `${gradeText} by ${graderText}`
      : (gradeText || graderText || '—');
    const gradedRowsHtml = gradedRecord ? `
          <tr><th>Grade</th><td>${externalInfoLinkHtml(combinedGradeText, graderLink)}</td></tr>
          <tr><th>Last Sale</th><td>${externalInfoLinkHtml(auctionText, auctionLink)}</td></tr>
    ` : '';
    if (forceDash) {
      return `
        <table class="info-table selected-coin-info-table">
          <tbody>
            <tr><th>Type</th><td>—</td></tr>
            <tr><th>Material</th><td>—</td></tr>
            <tr><th>Series</th><td>—</td></tr>
            <tr><th>Year</th><td>—</td></tr>
            <tr><th>Denomination</th><td>—</td></tr>
            <tr><th>Balance</th><td>—</td></tr>
            <tr><th>Dimensions</th><td>—</td></tr>
            <tr><th>Weight</th><td>—</td></tr>
            <tr><th>Funded</th><td>—</td></tr>
            <tr><th>Redeemed</th><td>—</td></tr>
          </tbody>
        </table>
      `;
    }
    return `
      <table class="info-table selected-coin-info-table">
        <tbody>
          <tr><th>Type</th><td>${escapeHtml(info?.type || (shape === 'coin' ? 'Coin' : 'Bar'))}</td></tr>
          <tr><th>Material</th><td>${escapeHtml(material)}</td></tr>
          <tr><th>Series</th><td>${escapeHtml(series)}</td></tr>
          <tr><th>Year</th><td>${escapeHtml(info?.year || coin.year || '—')}</td></tr>
          <tr><th>Denomination</th><td>${escapeHtml(denomination)}</td></tr>
          <tr><th>Status</th><td>${escapeHtml(statusLabel(entry))}</td></tr>
          <tr><th>Balance</th><td>${escapeHtml(formatBtc(entry?.balance))}</td></tr>
          <tr><th>Dimensions</th><td>${escapeHtml(dimensions)}</td></tr>
          <tr><th>Weight</th><td>${escapeHtml(info?.weight || coin.weight || '—')}</td></tr>
          <tr><th>Funded</th><td>${escapeHtml(fundedText)}</td></tr>
          <tr><th>Redeemed</th><td>${escapeHtml(redeemedText)}</td></tr>
          ${gradedRowsHtml}
        </tbody>
      </table>
    `;
  }

  function initialPricePointForSeries(point, seriesKey, unit) {
    const premiumBtc = Math.max(0, (point.btc || 0) - (point.denomination || 0));
    const btcValue = seriesKey === 'funded' ? point.btc : premiumBtc;
    const usdPrice = priceForDaySeconds(point.time);
    return {
      time: point.time,
      value: unit === 'usd' ? btcValue * usdPrice : btcValue,
      source: 'Initial',
      seriesKey,
      visibilityKey: seriesKey === 'funded' ? 'originalFunded' : 'originalPremium',
      tooltipLabel: seriesKey === 'funded' ? 'Original Funded Price' : 'Original Premium',
      label: point.label
    };
  }

  function auctionSeriesKeyForEntry(entry, usdValue, time) {
    const denomination = Math.max(0, Number(entry?.value) || 0);
    const btcPrice = priceForDaySeconds(time);
    const denominationUsd = denomination * btcPrice;
    if (denominationUsd > 0 && usdValue < denominationUsd * FUNDED_AUCTION_DENOMINATION_BUFFER) return 'premium';
    if (denominationUsd <= 0 && (isUnfundedStatus(entry) || isRedeemedStatus(entry))) return 'premium';
    return 'funded';
  }

  function auctionPricePointForEntry(entry, unit) {
    const record = entry?.gradedRecord;
    const time = parseSeriesPriceDate(record?.['auction sold date']);
    const usdValue = parseUsdPriceText(record?.['auction sold amount']);
    if (!Number.isFinite(time) || !Number.isFinite(usdValue)) return null;
    const btcPrice = priceForDaySeconds(time);
    const seriesKey = auctionSeriesKeyForEntry(entry, usdValue, time);
    const tooltipLabel = seriesKey === 'funded'
      ? 'Funded Sale'
      : (isUnfundedStatus(entry) ? 'Unfunded' : (isRedeemedStatus(entry) ? 'Redeemed' : 'Premium'));
    return {
      time,
      value: unit === 'usd' ? usdValue : (btcPrice > 0 ? usdValue / btcPrice : 0),
      source: 'Auction',
      seriesKey,
      visibilityKey: seriesKey === 'funded' ? 'fundedSale' : 'redeemedSale',
      tooltipLabel,
      label: record?.grade || entry.address || 'Auction',
      grade: String(record?.grade || '').trim(),
      usdValue,
      btcValue: btcPrice > 0 ? usdValue / btcPrice : 0,
      address: String(entry?.address || ''),
      gradedRecordId: String(entry?.gradedRecordId || record?.gradedRecordId || ''),
      slug: String(entry?.slug || ''),
      status: statusKey(entry),
      createTime: Number(entry?.createTime) || 0,
      createBlock: Number(entry?.createBlock) || 0
    };
  }

  function priceChartTypeTitle(entry) {
    const coin = COINS.find(c => c.slug === entry?.slug) || null;
    if (coin?.slug === 'cas_bar_diy_gold_s2') return '2011 DIY Series 2 Gold Plated Alloy Bars';
    return coin ? chartDisplayName(coin) : String(entry?.type || '').trim();
  }

  function priceChartTitleText(entry) {
    return titleCaseChartText(`${priceChartTypeTitle(entry)} Price History`);
  }

  function priceVariantKeyForEntry(entry) {
    const type = String(entry?.type || '').trim();
    if (type === 'S2-COIN-10') {
      const overrideVariant = s2TenSilverVariantKeyForEntry(entry);
      if (overrideVariant) return overrideVariant;
      return entry?.slug === 'cas_10btc_2012_silver_gold_b' ? 'gold-b' : '';
    }
    if (type === 'S3-COIN-0.5-AG') {
      return s3HalfSilverVariantKeyForEntry(entry);
    }
    if (type === 'S3-COIN-1-AG') {
      const overrideVariant = s3OneSilverVariantKeyForEntry(entry);
      if (overrideVariant) return overrideVariant;
      return entry?.slug === 'cas_1btc_2013_gold_rim_silver' ? 'gold-rim' : 'plain';
    }
    return '';
  }

  function selectedPriceVariantKeyForEntry(entry) {
    const type = String(entry?.type || '').trim();
    if (type === 'S2-COIN-10') {
      if (!allItemsSelected()) {
        const activeVariant = s2TenSilverVariantKeyForSlug(activeCoin()?.slug);
        if (activeVariant) return activeVariant;
      }
      return priceVariantKeyForEntry(entry) || 'plain';
    }
    if (type === 'S3-COIN-0.5-AG') {
      if (!allItemsSelected()) {
        const activeVariant = s3HalfSilverVariantKeyForSlug(activeCoin()?.slug);
        if (activeVariant) return activeVariant;
      }
      return priceVariantKeyForEntry(entry) || 'series-3';
    }
    if (type === 'S3-COIN-1-AG') {
      if (!allItemsSelected()) {
        const activeVariant = s3OneSilverVariantKeyForSlug(activeCoin()?.slug);
        if (activeVariant) return activeVariant;
      }
      return priceVariantKeyForEntry(entry) || 'plain';
    }
    return '';
  }

  function pricePointMatchesVariant(point, variantKey) {
    return !variantKey || !point?.variantKey || point.variantKey === variantKey;
  }

  function selectedInitialPricePoints(entry) {
    const type = String(entry?.type || '').trim();
    if (!type || !entry?.gradedRecord || !seriesPriceIndexCache) return [];
    const variantKey = selectedPriceVariantKeyForEntry(entry);
    return (seriesPriceIndexCache.get(type) || [])
      .filter(point => pricePointMatchesVariant(point, variantKey));
  }

  function selectedPriceChartSeries(entry, unit = priceChartUnit) {
    const empty = { funded: [], premium: [], points: [] };
    const type = String(entry?.type || '').trim();
    if (!type || !entry?.gradedRecord || !seriesPriceIndexCache) return empty;
    const variantKey = selectedPriceVariantKeyForEntry(entry);
    const initialPoints = selectedInitialPricePoints(entry);
    if (!initialPoints.length) return empty;
    const funded = initialPoints
      .filter(point => Number(point?.denomination) > 0)
      .map(point => initialPricePointForSeries(point, 'funded', unit))
      .filter(point => Number.isFinite(point.time) && Number.isFinite(point.value) && point.value > 0);
    const premium = initialPoints
      .map(point => initialPricePointForSeries(point, 'premium', unit))
      .filter(point => Number.isFinite(point.time) && Number.isFinite(point.value) && point.value >= 0);
    const saleSourceEntries = currentGradedTrackerEntries.length ? currentGradedTrackerEntries : currentTrackerEntries;
    saleSourceEntries
      .filter(row => (
        String(row?.type || '').trim() === type
        && row?.gradedRecord
        && pricePointMatchesVariant({ variantKey: priceVariantKeyForEntry(row) }, variantKey)
      ))
      .flatMap(gradedAuctionEntriesForEntry)
      .map(row => auctionPricePointForEntry(row, unit))
      .filter(point => point && Number.isFinite(point.time) && Number.isFinite(point.value) && point.value > 0)
      .forEach(point => {
        if (point.seriesKey === 'funded') funded.push(point);
        else premium.push(point);
      });
    const sortPoints = (a, b) => a.time - b.time || a.value - b.value;
    funded.sort(sortPoints);
    premium.sort(sortPoints);
    return {
      funded,
      premium,
      points: [...funded, ...premium].sort(sortPoints)
    };
  }

  function selectedPriceChartHtml(entry) {
    if (!entry?.gradedRecord || !String(entry.type || '').trim()) return '';
    if (!seriesPriceIndexCache) {
      seriesPriceIndex().then(() => updateSelectedCoinDetailSection());
      return '';
    }
    if (!dailyPriceIndexCache) dailyPriceIndex().then(() => renderSelectedPriceChartPreview());
    return `
      <button class="selected-price-chart" type="button" data-selected-price-chart-open aria-label="Open price history chart">
        <canvas class="selected-price-chart-canvas" width="320" height="118" aria-label="Price history chart"></canvas>
      </button>
    `;
  }

  function addresslessSelectedCoin(coin = comparisonCoin()) {
    return Boolean(coin?.nonFundedStats || isMuleCoin(coin));
  }

  function selectedUnknownUnfundedInfoRowsHtml(entry) {
    return `
      <table class="info-table selected-coin-info-table">
        <tbody>
          <tr><th>Type</th><td>—</td></tr>
          <tr><th>Material</th><td>—</td></tr>
          <tr><th>Series</th><td>—</td></tr>
          <tr><th>Year</th><td>—</td></tr>
          <tr><th>Denomination</th><td>—</td></tr>
          <tr><th>Status</th><td>${escapeHtml(statusLabel(entry))}</td></tr>
          <tr><th>Balance</th><td>${escapeHtml(formatBtc(entry?.balance))}</td></tr>
          <tr><th>Dimensions</th><td>—</td></tr>
          <tr><th>Weight</th><td>—</td></tr>
          <tr><th>Funded</th><td>—</td></tr>
          <tr><th>Redeemed</th><td>—</td></tr>
        </tbody>
      </table>
    `;
  }

  function selectedCoinDetailHtml(rows) {
    const currentCoin = comparisonCoin();
    const selectedEntry = selectedTrackerEntry(rows);
    const forceAddressless = addresslessSelectedCoin(currentCoin) && !selectedEntry;
    const entry = forceAddressless ? null : selectedEntry;
    const coin = forceAddressless || allItemsMode ? currentCoin : (entry ? COINS.find(c => c.slug === entry.slug) || currentCoin : currentCoin);
    if (searchedUnfundedEntry) {
      const unfundedCoin = coinBySlug(searchedUnfundedEntry.slug) || coinBySlug('cas_1btc_2011_mule_demo') || coin;
      const infoRowsHtml = searchedUnfundedEntry.slug
        ? selectedCoinInfoRowsHtml(searchedUnfundedEntry, rows, unfundedCoin)
        : selectedUnknownUnfundedInfoRowsHtml(searchedUnfundedEntry);
      return `
        <section class="selected-coin-detail" aria-label="Selected coin">
          ${selectedCoinAddressHtml(searchedUnfundedEntry, unfundedCoin)}
          ${infoRowsHtml}
        </section>
      `;
    }
    if (searchAddressNotFound) {
      const notFoundIconCoin = coinBySlug('cas_1btc_2011_mule_demo') || coin;
      return `
        <section class="selected-coin-detail" aria-label="Selected coin">
          ${selectedCoinAddressHtml(null, notFoundIconCoin, {
            addressText: 'Address not found',
            iconImageOverride: notFoundIconCoin.backData || notFoundIconCoin.frontData,
            iconPositionOverride: notFoundIconCoin.backPosition || notFoundIconCoin.thumbPosition || 'center',
            iconSizeOverride: notFoundIconCoin.backBackgroundSize || notFoundIconCoin.thumbBackgroundSize || notFoundIconCoin.frontBackgroundSize || 'cover'
          })}
          ${selectedCoinInfoRowsHtml(null, rows, coin, { forceDash: true })}
        </section>
      `;
    }
    if (!entry) {
      const emptyModeRows = !(leftPanelRowsByMode[leftPanelMode] || []).length;
      const focusedAllItemHasModeRow = allItemsMode
        ? Boolean(allItemsRowForCenteredSlug(leftPanelMode, allItemsFocusedSlug))
        : true;
      const addressText = emptyModeRows || !focusedAllItemHasModeRow ? noAddressesLabel(leftPanelMode) : 'No selected address';
      return `
        <section class="selected-coin-detail" aria-label="Selected coin">
          ${selectedCoinAddressHtml(null, coin, { addressText })}
          ${selectedCoinInfoRowsHtml(null, rows, coin)}
        </section>
      `;
    }
    return `
      <section class="selected-coin-detail" aria-label="Selected coin">
        ${selectedCoinAddressHtml(entry, coin)}
        ${selectedCoinInfoRowsHtml(entry, rows, coin)}
        ${selectedPriceChartHtml(entry)}
      </section>
    `;
  }

  function updateSelectedCoinDetailSection() {
    const section = coinInfoPanel?.querySelector('.selected-coin-detail');
    if (!section) return;
    section.outerHTML = selectedCoinDetailHtml(currentBalanceChartRows);
    syncGradedMediaViewer(currentBalanceChartRows);
    renderSelectedPriceChartPreview();
  }

  function scheduleDataPanelsRefresh() {
    if (dataPanelsRefreshQueued) return;
    dataPanelsRefreshQueued = true;
    const run = () => {
      dataPanelsRefreshQueued = false;
      refreshDataPanels();
    };
    requestAnimationFrame(() => {
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(run, { timeout: 700 });
      } else {
        setTimeout(run, 80);
      }
    });
  }

  function currentChartRows(entries) {
    return allItemsSelected() ? entries : statsRowsForCoin(entries, activeCoin());
  }

  function buildBalanceChartSeries(rows) {
    const events = [];
    rows.forEach(entry => {
      const value = Number(entry.value);
      if (!Number.isFinite(value) || value <= 0) return;
      if (Number.isFinite(entry.createTime) && entry.createTime > 0) {
        events.push({ time: entry.createTime, activeDelta: value, redeemedDelta: 0 });
      }
      if (isRedeemedStatus(entry) && Number.isFinite(entry.redeemTime) && entry.redeemTime > 0) {
        events.push({ time: entry.redeemTime, activeDelta: -value, redeemedDelta: value });
      }
    });
    events.sort((a, b) => a.time - b.time || b.activeDelta - a.activeDelta);
    if (!events.length) return { points: [], maxY: 0, minTime: 0, maxTime: 0 };

    let active = 0;
    let redeemed = 0;
    const eventPoints = [{ time: events[0].time, minted: 0, active: 0, redeemed: 0 }];
    events.forEach(event => {
      active = Math.max(0, active + event.activeDelta);
      redeemed = Math.max(0, redeemed + event.redeemedDelta);
      eventPoints.push({ time: event.time, minted: active + redeemed, active, redeemed });
    });
    const firstDay = startOfUtcDaySeconds(events[0].time);
    const today = startOfUtcDaySeconds(Date.now() / 1000);
    const lastDay = Math.max(today, startOfUtcDaySeconds(events[events.length - 1].time));
    const points = [];
    for (let day = firstDay; day <= lastDay; day += 86400) {
      const sampleTime = day === today ? Date.now() / 1000 : day + 86399;
      const values = balanceValuesAtTime(eventPoints, sampleTime);
      points.push({
        time: day,
        minted: (values.active || 0) + (values.redeemed || 0),
        active: values.active,
        redeemed: values.redeemed
      });
    }
    if (points.length && ((points[0].active || 0) !== 0 || (points[0].redeemed || 0) !== 0)) {
      points.unshift({ time: points[0].time - 86400, minted: 0, active: 0, redeemed: 0 });
    }
    const maxY = Math.max(1, ...points.flatMap(point => [point.minted, point.active, point.redeemed]));
    return {
      points,
      maxY,
      minTime: points[0].time,
      maxTime: points[points.length - 1].time
    };
  }

  function projectedBalanceChartSeries(rows, unit = 'btc') {
    const series = buildBalanceChartSeries(rows);
    if (unit !== 'usd' || !series.points.length) return series;
    const points = series.points.map(point => {
      const price = priceForDaySeconds(point.time);
      return {
        time: point.time,
        minted: (point.minted || 0) * price,
        active: (point.active || 0) * price,
        redeemed: (point.redeemed || 0) * price
      };
    });
    const maxY = Math.max(1, ...points.flatMap(point => [point.minted, point.active, point.redeemed]));
    return {
      points,
      maxY,
      minTime: series.minTime,
      maxTime: series.maxTime
    };
  }

  function buildLinearTicks(min, max, count = 5) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
    count = Math.max(3, count);
    if (Math.abs(max - min) < 1e-12) {
      const scale = Math.max(Math.abs(min), Math.abs(max), 1);
      const epsilon = Math.max(scale * 1e-6, Number.EPSILON * scale * 16);
      const start = min - epsilon;
      const end = max + epsilon;
      return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / (count - 1));
    }

    const rawStep = (max - min) / (count - 1);
    const exponent = Math.floor(Math.log10(Math.abs(rawStep)));
    const niceBases = [1, 2, 2.5, 5, 10];
    const stepCandidates = [];
    for (let exp = exponent - 3; exp <= exponent + 3; exp += 1) {
      const scale = 10 ** exp;
      niceBases.forEach(base => stepCandidates.push(base * scale));
    }
    stepCandidates.sort((a, b) => a - b);

    let candidateIndex = stepCandidates.findIndex(step => step >= rawStep);
    if (candidateIndex < 0) candidateIndex = stepCandidates.length - 1;

    const buildTicksForStep = step => {
      const valueScale = Math.max(Math.abs(min), Math.abs(max), 1);
      const eps = Math.max(Math.abs(step) * 1e-9, valueScale * 1e-12, Number.EPSILON * valueScale * 16);
      const start = Math.ceil((min - eps) / step) * step;
      const end = Math.floor((max + eps) / step) * step;
      const ticks = [];
      for (let value = start; value <= end + eps; value += step) {
        ticks.push(Number(value.toPrecision(15)));
      }
      return ticks;
    };

    let ticks = buildTicksForStep(stepCandidates[candidateIndex]);
    while (ticks.length < 3 && candidateIndex > 0) {
      candidateIndex -= 1;
      ticks = buildTicksForStep(stepCandidates[candidateIndex]);
    }
    while (ticks.length > 12 && candidateIndex < stepCandidates.length - 1) {
      const nextTicks = buildTicksForStep(stepCandidates[candidateIndex + 1]);
      if (nextTicks.length < 3) break;
      candidateIndex += 1;
      ticks = nextTicks;
    }
    return ticks.length >= 3
      ? ticks
      : Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
  }

  function buildLogTicks(min, max, count = 6) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0 || max < min) return [];
    const minExp = Math.floor(Math.log10(min));
    const maxExp = Math.ceil(Math.log10(max));
    const multipliers = [1, 2, 5];
    const ticks = [];
    for (let exp = minExp; exp <= maxExp; exp += 1) {
      multipliers.forEach(multiplier => {
        const value = multiplier * (10 ** exp);
        if (value >= min && value <= max) ticks.push(value);
      });
    }
    if (ticks.length <= Math.max(3, count + 2)) return ticks;
    const decadeTicks = ticks.filter(value => {
      const exp = Math.round(Math.log10(value));
      return Math.abs(value - (10 ** exp)) <= value * 1e-9;
    });
    return decadeTicks.length >= 3 ? decadeTicks : ticks.filter((_, index) => index % Math.ceil(ticks.length / count) === 0);
  }

  function makeUtcDate(year, month, day = 1) {
    return new Date(Date.UTC(year, month, day));
  }

  function startOfUtcDaySeconds(time) {
    const date = new Date(Number(time) * 1000);
    if (Number.isNaN(date.getTime())) return 0;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000;
  }

  function buildBalanceTimeTicks(minTime, maxTime, plotW) {
    if (!Number.isFinite(minTime) || !Number.isFinite(maxTime) || maxTime <= minTime) return [];
    const first = new Date(minTime * 1000);
    const last = new Date(maxTime * 1000);
    const monthStarts = [];
    let cursor = makeUtcDate(first.getUTCFullYear(), first.getUTCMonth(), 1);
    while (cursor <= last) {
      const ms = cursor.getTime();
      if (ms >= first.getTime() && ms <= last.getTime()) monthStarts.push(new Date(ms));
      cursor = makeUtcDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1);
    }
    if (!monthStarts.length) {
      return [
        { time: minTime, label: formatBalanceTickDate(first) },
        { time: maxTime, label: formatBalanceTickDate(last) }
      ];
    }

    const maxTicks = Math.max(4, Math.floor(plotW / 92));
    const startYear = first.getUTCFullYear();
    const endYear = last.getUTCFullYear();
    const selectedIndices = new Set();
    if (endYear > startYear) {
      const tierMonthSets = [
        [0],
        [0, 6],
        [0, 4, 8],
        [0, 3, 6, 9],
        [0, 2, 4, 6, 8, 10],
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
      ];
      const tierIndices = monthSet => {
        const lookup = new Set(monthSet);
        const out = [];
        monthStarts.forEach((date, index) => {
          if (lookup.has(date.getUTCMonth())) out.push(index);
        });
        return out;
      };
      let chosen = null;
      for (let index = tierMonthSets.length - 1; index >= 0; index -= 1) {
        const indices = tierIndices(tierMonthSets[index]);
        if (indices.length && indices.length <= maxTicks) {
          chosen = indices;
          break;
        }
      }
      const indices = chosen || tierIndices([0]);
      const stride = Math.max(1, Math.ceil(indices.length / maxTicks));
      indices.forEach((monthIndex, index) => {
        if (index % stride === 0) selectedIndices.add(monthIndex);
      });
    } else {
      const minStep = Math.max(1, Math.ceil(monthStarts.length / maxTicks));
      const monthStep = [1, 2, 3, 4, 6, 12].find(step => step >= minStep) || minStep;
      for (let index = 0; index < monthStarts.length; index += monthStep) selectedIndices.add(index);
    }

    const ticks = monthStarts
      .filter((_, index) => selectedIndices.has(index))
      .map(date => ({
        time: date.getTime() / 1000,
        label: date.getUTCMonth() === 0 ? String(date.getUTCFullYear()) : MONTH_SHORT[date.getUTCMonth()]
      }));
    return ticks.length ? ticks : [{ time: minTime, label: formatBalanceTickDate(first) }];
  }

  function formatBalanceTickDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${MONTH_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
  }

  function formatUsdValue(value, { compact = false } = {}) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '$0';
    const abs = Math.abs(number);
    const sign = number < 0 ? '-' : '';
    if (compact) {
      const units = [
        { value: 1e12, suffix: 'T' },
        { value: 1e9, suffix: 'B' },
        { value: 1e6, suffix: 'M' },
        { value: 1e3, suffix: 'K' }
      ];
      const unit = units.find(entry => abs >= entry.value);
      if (unit) {
        const scaled = abs / unit.value;
        const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
        return `${sign}$${scaled.toLocaleString(undefined, { maximumFractionDigits: digits })}${unit.suffix}`;
      }
    }
    const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
    return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
  }

  function formatBalanceTickValue(value, unit = balanceChartUnit) {
    if (unit === 'usd') return formatUsdValue(value, { compact: true });
    const number = Number(value);
    if (!Number.isFinite(number)) return '0 BTC';
    const abs = Math.abs(number);
    const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 4;
    return `${number.toLocaleString(undefined, { maximumFractionDigits: digits })} BTC`;
  }

  function formatBalanceTooltipValue(value, unit = balanceChartUnit) {
    if (unit === 'usd') return formatUsdValue(value);
    const number = Number(value);
    if (!Number.isFinite(number)) return '0 BTC';
    const abs = Math.abs(number);
    const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 8;
    return `${number.toLocaleString(undefined, { maximumFractionDigits: digits })} BTC`;
  }

  function wrapCanvasText(ctx, text, maxWidth, maxLines = 3) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach(word => {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    while (kept[maxLines - 1] && ctx.measureText(`${kept[maxLines - 1]}...`).width > maxWidth) {
      const parts = kept[maxLines - 1].split(/\s+/);
      parts.pop();
      kept[maxLines - 1] = parts.join(' ');
    }
    kept[maxLines - 1] = `${kept[maxLines - 1] || lines[maxLines - 1] || ''}...`;
    return kept;
  }

  function balanceValuesAtTime(points, time) {
    if (!Array.isArray(points) || !points.length || !Number.isFinite(time)) return { minted: 0, active: 0, redeemed: 0 };
    let low = 0;
    let high = points.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (points[mid].time <= time) low = mid + 1;
      else high = mid - 1;
    }
    const point = points[Math.max(0, high)] || points[0];
    return { minted: point.minted || 0, active: point.active || 0, redeemed: point.redeemed || 0 };
  }

  function visibleBalanceChartSeries({ compact = false } = {}) {
    return BALANCE_CHART_SERIES.filter(series => balanceChartVisibleSeries[series.key]);
  }

  function balanceChartPalette() {
    const light = root.dataset.theme === 'light';
    return light
      ? {
          grid: 'rgba(88,62,28,.16)',
          axis: 'rgba(88,62,28,.34)',
          tick: 'rgba(76,57,31,.66)',
          tickMuted: 'rgba(96,72,39,.34)',
          title: 'rgba(36,25,13,.90)',
          legend: 'rgba(36,25,13,.82)',
          legendMuted: 'rgba(96,72,39,.48)',
          currentStroke: 'rgba(255,251,242,.90)'
        }
      : {
          grid: 'rgba(248,241,223,.12)',
          axis: 'rgba(248,241,223,.34)',
          tick: 'rgba(248,241,223,.58)',
          tickMuted: 'rgba(248,241,223,.22)',
          title: 'rgba(248,241,223,.72)',
          legend: 'rgba(248,241,223,.72)',
          legendMuted: 'rgba(248,241,223,.45)',
          currentStroke: '#000'
        };
  }

  function balanceChartSeriesMax(points, seriesItems) {
    if (!Array.isArray(points) || !points.length || !seriesItems.length) return 1;
    return Math.max(1, ...points.flatMap(point => seriesItems.map(series => point[series.key] || 0)));
  }

  function balanceChartScopeKey() {
    return allItemsSelected() ? ALL_ITEMS_GROUP_KEY : activeCoin().slug;
  }

  function drawBalanceChart(canvas, rows, { compact = false, unit = 'btc' } = {}) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width || canvas.width || 320));
    const cssHeight = Math.max(1, Math.round(rect.height || canvas.height || 108));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    const palette = balanceChartPalette();

    const { points, minTime: fullMinTime, maxTime: fullMaxTime } = projectedBalanceChartSeries(rows, unit);
    const visibleSeries = visibleBalanceChartSeries({ compact });
    const chartSeries = visibleSeries.length ? visibleSeries : [];
    const activeZoom = !compact
      && balanceChartZoom
      && balanceChartZoom.scope === balanceChartScopeKey()
      && balanceChartZoom.unit === unit
      ? balanceChartZoom
      : null;
    let minTime = Number.isFinite(activeZoom?.minTime) ? activeZoom.minTime : fullMinTime;
    let maxTime = Number.isFinite(activeZoom?.maxTime) ? activeZoom.maxTime : fullMaxTime;
    if (maxTime <= minTime) {
      minTime = fullMinTime;
      maxTime = fullMaxTime;
    }
    const timeFilteredPoints = points.filter(point => point.time >= minTime && point.time <= maxTime);
    const chartPoints = points.length
      ? [
          { time: minTime, ...balanceValuesAtTime(points, minTime) },
          ...timeFilteredPoints.filter(point => point.time > minTime && point.time < maxTime),
          { time: maxTime, ...balanceValuesAtTime(points, maxTime) }
        ]
      : [];
    const domainPoints = chartPoints.length ? chartPoints : points;
    const domainValues = domainPoints.flatMap(point => chartSeries.map(series => Number(point[series.key]) || 0));
    const minSeriesValue = domainValues.length ? Math.min(...domainValues) : 0;
    const maxY = domainValues.length ? Math.max(1, ...domainValues) : 1;
    const currentPoint = balanceValuesAtTime(points, maxTime);
    const currentValueFontSize = compact ? 0 : (cssWidth < 700 ? 17 : 19);
    const axisTickFontSize = compact ? 0 : (cssWidth < 700 ? 14 : 15);
    let measuredRightPad = cssWidth < 700 ? 82 : 112;
    if (!compact) {
      ctx.save();
      ctx.font = `800 ${currentValueFontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      const currentLabelWidth = Math.max(0, ...chartSeries.map(series => (
        ctx.measureText(formatBalanceTickValue(currentPoint[series.key] || 0, unit)).width
      )));
      ctx.font = `${axisTickFontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      const axisLabelWidth = ctx.measureText(formatBalanceTickValue(maxY, unit)).width;
      ctx.restore();
      measuredRightPad = Math.max(
        measuredRightPad,
        Math.ceil(currentLabelWidth + 34),
        Math.ceil(axisLabelWidth + 26)
      );
      measuredRightPad = Math.min(measuredRightPad, Math.max(96, Math.floor(cssWidth * 0.34)));
    }
    const baseTopPad = cssWidth < 700 ? 88 : 96;
    let titleFontSize = cssWidth < 700 ? 18 : 22;
    const titleMaxWidth = Math.max(160, cssWidth - (cssWidth < 700 ? 360 : 420));
    let titleLines = [];
    if (!compact) {
      ctx.save();
      const titleText = balanceChartTitleText(unit);
      while (titleFontSize > 14) {
        ctx.font = `700 ${titleFontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        titleLines = wrapCanvasText(ctx, titleText, titleMaxWidth);
        if (titleLines.length <= 2 || titleLines.every(line => ctx.measureText(line).width <= titleMaxWidth)) break;
        titleFontSize -= 1;
      }
      if (!titleLines.length) titleLines = wrapCanvasText(ctx, titleText, titleMaxWidth);
      ctx.restore();
    }
    const titleLineHeight = titleFontSize + 4;
    const titleExtraHeight = compact ? 0 : Math.max(0, titleLines.length - 1) * titleLineHeight;
    const pad = compact
      ? { left: 10, right: 9, top: 8, bottom: 10 }
      : {
          left: cssWidth < 700 ? 24 : 34,
          right: measuredRightPad,
          top: baseTopPad + titleExtraHeight,
          bottom: cssWidth < 700 ? 62 : 72
        };
    const plotW = Math.max(1, cssWidth - pad.left - pad.right);
    const plotH = Math.max(1, cssHeight - pad.top - pad.bottom);
    const zoomHasY = Number.isFinite(activeZoom?.yMin) && Number.isFinite(activeZoom?.yMax) && activeZoom.yMax > activeZoom.yMin;
    const valueRange = Math.max(0, maxY - minSeriesValue);
    const yPad = valueRange > 0
      ? valueRange * 0.04
      : Math.max(Math.abs(maxY) * 0.04, unit === 'usd' ? 1 : 0.00000001);
    const yMin = zoomHasY ? activeZoom.yMin : Math.max(0, minSeriesValue - yPad);
    const yMax = zoomHasY ? activeZoom.yMax : Math.max(1, maxY + yPad);
    const yTicks = compact ? [] : buildLinearTicks(yMin, yMax, Math.max(4, Math.min(8, Math.floor(plotH / 84))));
    const yAxisMin = Math.min(yMin, ...yTicks);
    const yAxisMax = Math.max(yMax, ...yTicks);
    const yAxisSpan = Math.max(1e-12, yAxisMax - yAxisMin);
    const xTicks = compact ? [] : buildBalanceTimeTicks(minTime, maxTime, plotW);

    if (!compact) {
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      yTicks.forEach(value => {
        const y = pad.top + plotH - ((value - yAxisMin) / yAxisSpan) * plotH;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + plotW, y);
        ctx.stroke();
      });
    }

    if (!points.length) return null;
    const span = Math.max(1, maxTime - minTime);
    const xFor = time => pad.left + (time - minTime) / span * plotW;
    const yFor = value => pad.top + plotH - ((value - yAxisMin) / yAxisSpan) * plotH;
    const currentLabels = compact ? [] : chartSeries.map(series => ({
      key: series.key,
      value: currentPoint[series.key] || 0,
      y: yFor(currentPoint[series.key] || 0),
      color: series.color
    }));

    if (!compact) {
      ctx.save();
      ctx.font = `${axisTickFontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.strokeStyle = palette.axis;
      ctx.lineWidth = 1;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const currentOverlapRadius = currentValueFontSize * 1.6;
      yTicks.forEach(value => {
        const y = yFor(value);
        const overlapsCurrentLabel = currentLabels.some(label => Math.abs(y - label.y) < currentOverlapRadius);
        ctx.fillStyle = overlapsCurrentLabel ? palette.tickMuted : palette.tick;
        ctx.fillText(formatBalanceTickValue(value, unit), pad.left + plotW + 10, y);
      });
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      xTicks.forEach(tick => {
        const x = xFor(tick.time);
        ctx.beginPath();
        ctx.moveTo(x, pad.top + plotH);
        ctx.lineTo(x, pad.top + plotH + 5);
        ctx.stroke();
        ctx.fillText(tick.label, x, pad.top + plotH + axisTickFontSize);
      });
      ctx.strokeStyle = palette.axis;
      ctx.beginPath();
      ctx.moveTo(pad.left + plotW, pad.top);
      ctx.lineTo(pad.left + plotW, pad.top + plotH);
      ctx.lineTo(pad.left, pad.top + plotH);
      ctx.stroke();
      ctx.restore();
    }

    const drawLine = (key, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = compact ? 2 : 2.4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      chartPoints.forEach((point, index) => {
        const x = xFor(point.time);
        const y = yFor(point[key]);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    if (!compact) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(pad.left, pad.top, plotW, plotH);
      ctx.clip();
    }
    if (chartSeries.some(series => series.key === 'minted')) drawLine('minted', '#ff9900');
    if (chartSeries.some(series => series.key === 'redeemed')) drawLine('redeemed', '#e05243');
    if (chartSeries.some(series => series.key === 'active')) drawLine('active', '#38c172');
    if (!compact) ctx.restore();

    let renderedTitleLines = [];
    if (!compact) {
      ctx.save();
      ctx.font = `800 ${currentValueFontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      currentLabels.forEach(label => {
        const y = label.value <= 0
          ? label.y
          : Math.max(pad.top + 7, Math.min(pad.top + plotH - 7, label.y));
        const text = formatBalanceTickValue(label.value, unit);
        ctx.lineWidth = 5;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = palette.currentStroke;
        ctx.strokeText(text, pad.left + plotW + 10, y);
        ctx.fillStyle = label.color;
        ctx.fillText(text, pad.left + plotW + 10, y);
      });
      ctx.restore();

      const legendFont = cssWidth < 700 ? 12 : 13;
      const legendLineWidth = cssWidth < 700 ? 24 : 30;
      const legendStroke = cssWidth < 700 ? 3 : 3.4;
      const legendGap = cssWidth < 700 ? 18 : 24;
      ctx.save();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = palette.title;
      renderedTitleLines = titleLines;
      const titleBlockTop = cssWidth < 700 ? 20 : 21;
      ctx.font = `700 ${titleFontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textBaseline = 'top';
      titleLines.forEach((line, index) => {
        ctx.fillText(line, cssWidth / 2, titleBlockTop + index * titleLineHeight);
      });
      const legendY = Math.max(titleBlockTop + titleLines.length * titleLineHeight + 18, pad.top - 28);

      ctx.font = `600 ${legendFont}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textBaseline = 'middle';
      const legendItems = BALANCE_CHART_SERIES.map(series => ({
        ...series,
        visible: Boolean(balanceChartVisibleSeries[series.key])
      }));
      const measuredLegendWidth = legendItems.reduce((total, item, index) => {
        return total + legendLineWidth + 8 + ctx.measureText(item.label).width + (index ? legendGap : 0);
      }, 0);
      let legendX = Math.max(pad.left, (cssWidth - measuredLegendWidth) / 2);
      const legendHitBoxes = [];
      legendItems.forEach((item, index) => {
        if (index) legendX += legendGap;
        const itemStartX = legendX;
        const labelWidth = ctx.measureText(item.label).width;
        const itemAlpha = item.visible ? 1 : 0.35;
        ctx.globalAlpha = itemAlpha;
        ctx.strokeStyle = item.color;
        ctx.lineWidth = legendStroke;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(legendX, legendY);
        ctx.lineTo(legendX + legendLineWidth, legendY);
        ctx.stroke();
        legendX += legendLineWidth + 8;
        ctx.fillStyle = item.visible ? palette.legend : palette.legendMuted;
        ctx.textAlign = 'left';
        ctx.fillText(item.label, legendX, legendY);
        legendX += labelWidth;
        ctx.globalAlpha = 1;
        legendHitBoxes.push({
          key: item.key,
          x: itemStartX - 8,
          y: legendY - Math.max(12, legendFont),
          width: legendLineWidth + 8 + labelWidth + 16,
          height: Math.max(24, legendFont + 10)
        });
      });
      canvas._balanceChartLegendHitBoxes = legendHitBoxes;
      ctx.restore();
    }
    if (!compact && balanceChartDrag?.active) {
      drawChartDragOverlay(ctx, { pad, plotW, plotH }, priceChartDragSelection({ pad, plotW, plotH }, balanceChartDrag));
    }
    if (compact) canvas._balanceChartLegendHitBoxes = [];
    const meta = { pad, plotW, plotH, cssWidth, cssHeight, minTime, maxTime, fullMinTime, fullMaxTime, yMin: yAxisMin, yMax: yAxisMax, points, chartPoints, unit, titleLines: renderedTitleLines };
    canvas._balanceChartMeta = meta;
    return meta;
  }

  function drawSelectedPriceChart(canvas, entry, { unit = priceChartUnit, compact = false, scale = compact ? 'linear' : priceChartScale } = {}) {
    if (!canvas) return null;
    const needsSeriesPrices = !seriesPriceIndexCache;
    const needsDailyPrices = !dailyPriceIndexCache;
    if (needsSeriesPrices || needsDailyPrices) {
      Promise.all([
        needsSeriesPrices ? seriesPriceIndex() : Promise.resolve(seriesPriceIndexCache),
        needsDailyPrices ? dailyPriceIndex() : Promise.resolve(dailyPriceIndexCache)
      ]).then(() => {
        renderSelectedPriceChartPreview();
        redrawOpenBalanceChart();
      });
      return null;
    }
    const chartData = selectedPriceChartSeries(entry, unit);
    const { points, funded, premium } = chartData;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width || canvas.width || 320));
    const cssHeight = Math.max(1, Math.round(rect.height || canvas.height || 118));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    const palette = balanceChartPalette();
    const priceColors = {
      funded: '#ff9900',
      premium: '#8f98a3'
    };
    const baseTopPad = cssWidth < 700 ? 88 : 96;
    let titleFontSize = cssWidth < 700 ? 18 : 22;
    const titleMaxWidth = Math.max(160, cssWidth - (cssWidth < 700 ? 360 : 420));
    let titleLines = [];
    if (!compact) {
      ctx.save();
      const titleText = priceChartTitleText(entry);
      while (titleFontSize > 14) {
        ctx.font = `700 ${titleFontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        titleLines = wrapCanvasText(ctx, titleText, titleMaxWidth);
        if (titleLines.length <= 2 || titleLines.every(line => ctx.measureText(line).width <= titleMaxWidth)) break;
        titleFontSize -= 1;
      }
      if (!titleLines.length) titleLines = wrapCanvasText(ctx, titleText, titleMaxWidth);
      ctx.restore();
    }
    const titleLineHeight = titleFontSize + 4;
    const titleExtraHeight = compact ? 0 : Math.max(0, titleLines.length - 1) * titleLineHeight;
    if (!points.length) {
      const emptyPad = compact
        ? { left: 10, right: 10, top: 10, bottom: 10 }
        : {
            left: cssWidth < 700 ? 24 : 34,
            right: cssWidth < 700 ? 82 : 112,
            top: baseTopPad + titleExtraHeight,
            bottom: cssWidth < 700 ? 62 : 72
          };
      const emptyPlotW = Math.max(1, cssWidth - emptyPad.left - emptyPad.right);
      const emptyPlotH = Math.max(1, cssHeight - emptyPad.top - emptyPad.bottom);
      ctx.save();
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      const horizontalLines = compact ? 3 : 6;
      for (let index = 1; index <= horizontalLines; index += 1) {
        const y = emptyPad.top + emptyPlotH * index / (horizontalLines + 1);
        ctx.beginPath();
        ctx.moveTo(emptyPad.left, y);
        ctx.lineTo(emptyPad.left + emptyPlotW, y);
        ctx.stroke();
      }
      ctx.restore();
      canvas._priceChartMeta = null;
      canvas._balanceChartMeta = null;
      canvas._balanceChartLegendHitBoxes = [];
      canvas._priceChartLegendHitBoxes = [];
      canvas._priceChartPointHitBoxes = [];
      if (!compact || activeChartModalMode === 'price') hideBalanceChartHover();
      return null;
    }

    const visiblePoints = points.filter(point => priceChartVisibleGroups[priceChartVisibilityKey(point)] !== false);
    const domainPoints = visiblePoints.length ? visiblePoints : points;
    let fullMinTime = Math.min(...domainPoints.map(point => point.time));
    let fullMaxTime = Math.max(...domainPoints.map(point => point.time));
    if (fullMaxTime <= fullMinTime) {
      fullMinTime -= 43200;
      fullMaxTime += 43200;
    }
    const activeZoom = !compact
      && priceChartZoom
      && priceChartZoom.type === String(entry?.type || '')
      && priceChartZoom.unit === unit
      && priceChartZoom.scale === (scale === 'log' ? 'log' : 'linear')
      ? priceChartZoom
      : null;
    let minTime = Number.isFinite(activeZoom?.minTime) ? activeZoom.minTime : fullMinTime;
    let maxTime = Number.isFinite(activeZoom?.maxTime) ? activeZoom.maxTime : fullMaxTime;
    if (maxTime <= minTime) {
      minTime = fullMinTime;
      maxTime = fullMaxTime;
    }
    const timeFilteredVisiblePoints = visiblePoints.filter(point => point.time >= minTime && point.time <= maxTime);
    const chartPoints = timeFilteredVisiblePoints;
    const axisPoints = chartPoints.length ? chartPoints : (visiblePoints.length ? visiblePoints : points);
    const axisValues = axisPoints.map(point => Number(point.value)).filter(value => Number.isFinite(value));
    const maxValue = axisValues.length ? Math.max(...axisValues) : 0;
    const minValue = axisValues.length ? Math.min(...axisValues) : 0;
    const positiveAxisValues = axisValues.filter(value => value > 0);
    const useLogScale = !compact && scale === 'log' && positiveAxisValues.length > 0;
    const yPaddingRatio = 0.08;
    const valueRangeForDomain = Math.max(0, maxValue - minValue);
    const linearYPad = valueRangeForDomain > 0
      ? valueRangeForDomain * yPaddingRatio
      : Math.max(Math.abs(maxValue) * yPaddingRatio, unit === 'usd' ? 1 : 0.00000001);
    const zoomHasY = Number.isFinite(activeZoom?.yMin) && Number.isFinite(activeZoom?.yMax) && activeZoom.yMax > activeZoom.yMin;
    let linearAxisMin = zoomHasY && !useLogScale ? activeZoom.yMin : minValue - linearYPad;
    let linearAxisMax = zoomHasY && !useLogScale ? activeZoom.yMax : maxValue + linearYPad;
    if (linearAxisMax <= linearAxisMin) linearAxisMax = linearAxisMin + Math.max(Math.abs(linearAxisMin) * yPaddingRatio, unit === 'usd' ? 1 : 0.00000001);
    const minPositiveForDomain = useLogScale ? Math.min(...positiveAxisValues) : 1;
    const maxPositiveForDomain = useLogScale ? Math.max(...positiveAxisValues) : 10;
    const logMinValue = Math.log10(minPositiveForDomain);
    const logMaxValue = Math.log10(maxPositiveForDomain);
    const logYPad = logMaxValue > logMinValue ? (logMaxValue - logMinValue) * yPaddingRatio : yPaddingRatio;
    const paddedLogAxisMin = zoomHasY && useLogScale && activeZoom.yMin > 0 ? activeZoom.yMin : 10 ** (logMinValue - logYPad);
    const paddedLogAxisMax = zoomHasY && useLogScale && activeZoom.yMax > paddedLogAxisMin ? activeZoom.yMax : 10 ** (logMaxValue + logYPad);
    const axisMinForLabels = useLogScale ? paddedLogAxisMin : linearAxisMin;
    const axisMaxForLabels = useLogScale ? paddedLogAxisMax : linearAxisMax;
    const axisTickFontSize = compact ? 0 : (cssWidth < 700 ? 14 : 15);
    let axisLabelWidth = 0;
    let measuredRightPad = cssWidth < 700 ? 82 : 112;
    if (!compact) {
      ctx.save();
      ctx.font = `${axisTickFontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      axisLabelWidth = Math.max(
        ctx.measureText(formatBalanceTickValue(axisMaxForLabels, unit)).width,
        ctx.measureText(formatBalanceTickValue(axisMinForLabels, unit)).width
      );
      ctx.restore();
      measuredRightPad = Math.max(
        measuredRightPad,
        Math.ceil(axisLabelWidth + 24)
      );
      measuredRightPad = Math.min(measuredRightPad, Math.max(96, cssWidth - 96));
    }
    const pad = compact
      ? { left: 10, right: 10, top: 10, bottom: 10 }
      : {
          left: cssWidth < 700 ? 24 : 34,
          right: measuredRightPad,
          top: baseTopPad + titleExtraHeight,
          bottom: cssWidth < 700 ? 62 : 72
        };
    const plotW = Math.max(1, cssWidth - pad.left - pad.right);
    const plotH = Math.max(1, cssHeight - pad.top - pad.bottom);
    const availableRightLabelWidth = Math.max(24, pad.right - 18);
    const fittedAxisTickFontSize = !compact && axisLabelWidth > availableRightLabelWidth
      ? Math.max(10, Math.floor(axisTickFontSize * (availableRightLabelWidth / axisLabelWidth)))
      : axisTickFontSize;
    const span = Math.max(1, maxTime - minTime);
    let yTicks = [];
    let yAxisMin = 0;
    let yAxisMax = 1;
    let yAxisSpan = 1;
    let logAxisMin = 1;
    let logAxisMax = 10;
    let logAxisSpan = 1;
    if (useLogScale) {
      logAxisMin = paddedLogAxisMin;
      logAxisMax = paddedLogAxisMax;
      if (logAxisMax <= logAxisMin) logAxisMax = logAxisMin * 10;
      yTicks = buildLogTicks(logAxisMin, logAxisMax, Math.max(4, Math.min(8, Math.floor(plotH / 84))));
      yAxisMin = logAxisMin;
      yAxisMax = logAxisMax;
      logAxisSpan = Math.max(1e-12, Math.log10(logAxisMax) - Math.log10(logAxisMin));
    } else {
      yTicks = compact ? [] : buildLinearTicks(linearAxisMin, linearAxisMax, Math.max(4, Math.min(8, Math.floor(plotH / 84))));
      yAxisMin = Math.min(linearAxisMin, ...yTicks);
      yAxisMax = Math.max(linearAxisMax, ...yTicks);
      yAxisSpan = Math.max(1e-12, yAxisMax - yAxisMin);
    }
    const xTicks = compact ? [] : buildBalanceTimeTicks(minTime, maxTime, plotW);
    const xFor = time => pad.left + ((time - minTime) / span) * plotW;
    const yFor = value => {
      if (useLogScale) {
        if (!Number.isFinite(value) || value <= 0) return pad.top + plotH;
        return pad.top + plotH - ((Math.log10(value) - Math.log10(logAxisMin)) / logAxisSpan) * plotH;
      }
      return pad.top + plotH - ((value - yAxisMin) / yAxisSpan) * plotH;
    };

    if (!compact) {
      ctx.save();
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      yTicks.forEach(value => {
        const y = yFor(value);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + plotW, y);
        ctx.stroke();
      });
      ctx.strokeStyle = palette.axis;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = `${fittedAxisTickFontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.fillStyle = palette.tick;
      yTicks.forEach(value => {
        const y = yFor(value);
        ctx.fillText(formatBalanceTickValue(value, unit), pad.left + plotW + 10, y);
      });
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      xTicks.forEach(tick => {
        const x = xFor(tick.time);
        ctx.beginPath();
        ctx.moveTo(x, pad.top + plotH);
        ctx.lineTo(x, pad.top + plotH + 5);
        ctx.stroke();
        ctx.fillText(tick.label, x, pad.top + plotH + fittedAxisTickFontSize);
      });
      ctx.beginPath();
      ctx.moveTo(pad.left + plotW, pad.top);
      ctx.lineTo(pad.left + plotW, pad.top + plotH);
      ctx.lineTo(pad.left, pad.top + plotH);
      ctx.stroke();
      ctx.restore();
    }

    const drawPricePointMarker = (x, y, {
      color = priceColors.funded,
      original = false,
      size = compact ? 3.2 : 4,
      fill = true,
      stroke = true
    } = {}) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = palette.currentStroke;
      ctx.lineWidth = compact ? 2 : 2.6;
      ctx.beginPath();
      if (original) {
        const outerRadius = size;
        const innerRadius = size * 0.48;
        for (let index = 0; index < 10; index += 1) {
          const angle = -Math.PI / 2 + index * Math.PI / 5;
          const radius = index % 2 ? innerRadius : outerRadius;
          const px = x + Math.cos(angle) * radius;
          const py = y + Math.sin(angle) * radius;
          if (index) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.closePath();
      } else {
        ctx.arc(x, y, size, 0, Math.PI * 2);
      }
      if (stroke) ctx.stroke();
      if (fill) ctx.fill();
    };

    const drawAddressSaleLines = () => {
      const addressGroups = new Map();
      chartPoints
        .filter(point => point.source === 'Auction' && point.address)
        .forEach(point => {
          const address = String(point.address || '');
          if (!addressGroups.has(address)) addressGroups.set(address, []);
          addressGroups.get(address).push(point);
        });
      ctx.save();
      ctx.lineWidth = compact ? 0.75 : 1;
      ctx.globalAlpha = compact ? 0.42 : 0.55;
      addressGroups.forEach(addressPoints => {
        addressPoints
          .sort((a, b) => a.time - b.time || (Number(a.value) || 0) - (Number(b.value) || 0))
          .forEach((point, index, sortedPoints) => {
            const nextPoint = sortedPoints[index + 1];
            if (!nextPoint || nextPoint.seriesKey !== point.seriesKey) return;
            const seriesKey = point.seriesKey === 'funded' ? 'funded' : 'premium';
            ctx.strokeStyle = seriesKey === 'funded' ? priceColors.funded : priceColors.premium;
            ctx.beginPath();
            ctx.moveTo(xFor(point.time), yFor(point.value));
            ctx.lineTo(xFor(nextPoint.time), yFor(nextPoint.value));
            ctx.stroke();
          });
      });
      ctx.restore();
    };

    const pointHitBoxes = [];
    const priceMarkerDraws = [];
    const selectedPricePointHighlights = [];
    const selectedGradedPriceAddress = String(selectedLeftPanelAddressByMode.graded || '');
    const selectedGradedPriceRecordId = String(selectedLeftPanelRecordIdByMode.graded || '');
    ctx.save();
    drawAddressSaleLines();
    chartPoints.forEach(point => {
      const x = xFor(point.time);
      const y = yFor(point.value);
      const markerSize = point.source === 'Auction' ? (compact ? 3.2 : 4) : (compact ? 6.6 : 8.1);
      priceMarkerDraws.push({
        x,
        y,
        color: point.seriesKey === 'funded' ? priceColors.funded : priceColors.premium,
        original: point.source === 'Initial',
        size: markerSize
      });
      if (!compact) {
        pointHitBoxes.push({
          point,
          x,
          y,
          radius: Math.max(10, markerSize + 6),
          clickable: point.source === 'Auction' && Boolean(point.address)
        });
      }
      if (
        point.source === 'Auction'
        && selectedGradedPriceAddress
        && selectedGradedPriceRecordId
        && point.address === selectedGradedPriceAddress
        && String(point.gradedRecordId || '') === selectedGradedPriceRecordId
      ) {
        selectedPricePointHighlights.push({ point, x, y, markerSize });
      }
    });
    priceMarkerDraws.forEach(marker => {
      drawPricePointMarker(marker.x, marker.y, {
        color: marker.color,
        original: marker.original,
        size: marker.size,
        fill: false,
        stroke: true
      });
    });
    priceMarkerDraws.forEach(marker => {
      drawPricePointMarker(marker.x, marker.y, {
        color: marker.color,
        original: marker.original,
        size: marker.size,
        fill: true,
        stroke: false
      });
    });
    selectedPricePointHighlights.forEach(({ point, x, y, markerSize }) => {
      const color = point.status === 'active'
        ? '#38c172'
        : (point.status === 'redeemed' ? '#e05243' : '#8f98a3');
      const highlightRadius = markerSize + (compact ? 1 : 2.5);
      ctx.lineWidth = compact ? 2 : 2.5;
      ctx.strokeStyle = palette.currentStroke;
      ctx.beginPath();
      ctx.arc(x, y, highlightRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = compact ? 1.5 : 2;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, highlightRadius, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();

    if (!compact && priceChartDrag?.active) {
      const dragMeta = { pad, plotW, plotH };
      const selection = priceChartDragSelection(dragMeta);
      drawChartDragOverlay(ctx, { pad, plotW, plotH }, selection);
    }

    if (!compact) {
      ctx.save();
      ctx.font = `700 ${titleFontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      ctx.fillStyle = palette.title;
      const titleBlockTop = cssWidth < 700 ? 20 : 21;
      titleLines.forEach((line, index) => {
        ctx.fillText(line, cssWidth / 2, titleBlockTop + index * titleLineHeight);
      });
      const legendFontSize = cssWidth < 700 ? 12 : 13;
      ctx.font = `600 ${legendFontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textBaseline = 'middle';
      const hasOriginalPremiumPoint = points.some(point => point.source === 'Initial' && point.seriesKey !== 'funded');
      const originalPremiumLabel = entry?.slug === 'cas_bar_diy_gold_s2' ? 'Original Unfunded Price' : 'Original Premium';
      const nonFundedSalePoints = points.filter(point => point.source === 'Auction' && point.seriesKey !== 'funded');
      const nonFundedSaleLabels = new Set(nonFundedSalePoints.map(point => String(point.tooltipLabel || '').toLowerCase()));
      const nonFundedSaleLegendLabel = nonFundedSaleLabels.size === 1 && nonFundedSaleLabels.has('unfunded')
        ? 'Unfunded Sale'
        : (nonFundedSaleLabels.size === 1 && nonFundedSaleLabels.has('redeemed') ? 'Redeemed Sale' : 'Unfunded/Redeemed Sale');
      const legendItems = [
        points.some(point => point.source === 'Initial' && point.seriesKey === 'funded')
          ? { key: 'originalFunded', label: 'Original Funded Price', color: priceColors.funded, original: true, visible: priceChartVisibleGroups.originalFunded !== false }
          : null,
        hasOriginalPremiumPoint
          ? { key: 'originalPremium', label: originalPremiumLabel, color: priceColors.premium, original: true, visible: priceChartVisibleGroups.originalPremium !== false }
          : null,
        points.some(point => point.source === 'Auction' && point.seriesKey === 'funded')
          ? { key: 'fundedSale', label: 'Funded Sale', color: priceColors.funded, original: false, visible: priceChartVisibleGroups.fundedSale !== false }
          : null,
        nonFundedSalePoints.length
          ? { key: 'redeemedSale', label: nonFundedSaleLegendLabel, color: priceColors.premium, original: false, visible: priceChartVisibleGroups.redeemedSale !== false }
          : null
      ].filter(Boolean);
      const markerW = cssWidth < 700 ? 12 : 13;
      const gap = cssWidth < 700 ? 13 : 18;
      const rowGap = cssWidth < 700 ? 17 : 18;
      const itemWidths = legendItems.map(item => markerW + 7 + ctx.measureText(item.label).width);
      const maxLegendWidth = Math.max(180, cssWidth - pad.left - pad.right - 8);
      const legendRows = [];
      legendItems.forEach((item, index) => {
        const itemWidth = itemWidths[index];
        const row = legendRows[legendRows.length - 1];
        if (!row || (row.width && row.width + gap + itemWidth > maxLegendWidth)) {
          legendRows.push({ items: [{ item, width: itemWidth }], width: itemWidth });
        } else {
          row.items.push({ item, width: itemWidth });
          row.width += gap + itemWidth;
        }
      });
      const legendY = Math.max(58, pad.top - 28);
      const legendHitBoxes = [];
      legendRows.forEach((row, rowIndex) => {
        let legendX = Math.max(pad.left, (cssWidth - row.width) / 2);
        const y = legendY + rowIndex * rowGap;
        row.items.forEach(({ item, width }, index) => {
          if (index) legendX += gap;
          const itemStartX = legendX;
          ctx.globalAlpha = item.visible ? 1 : 0.35;
          drawPricePointMarker(legendX + markerW / 2, y, {
            color: item.color,
            original: item.original,
            size: item.original ? (cssWidth < 700 ? 7.5 : 8.4) : (cssWidth < 700 ? 4 : 4.4)
          });
          legendX += markerW + 7;
          ctx.fillStyle = item.visible ? palette.legend : palette.legendMuted;
          ctx.textAlign = 'left';
          ctx.fillText(item.label, legendX, y);
          legendX += width - markerW - 7;
          ctx.globalAlpha = 1;
          legendHitBoxes.push({
            key: item.key,
            x: itemStartX - 12,
            y: y - Math.max(16, rowGap * 0.72),
            width: width + 24,
            height: Math.max(32, legendFontSize + 18)
          });
        });
      });
      canvas._priceChartLegendHitBoxes = legendHitBoxes;
      ctx.restore();
    }
    if (compact) canvas._priceChartLegendHitBoxes = [];
    canvas._priceChartPointHitBoxes = compact ? [] : pointHitBoxes;
    const meta = { entry, points: chartPoints, allPoints: points, funded, premium, minTime, maxTime, fullMinTime, fullMaxTime, yMin: yAxisMin, yMax: yAxisMax, pad, plotW, plotH, cssWidth, cssHeight, unit, scale: useLogScale ? 'log' : 'linear' };
    canvas._priceChartMeta = meta;
    canvas._balanceChartMeta = meta;
    canvas._balanceChartLegendHitBoxes = [];
    return meta;
  }

  function renderSelectedPriceChartPreview() {
    const canvas = coinInfoPanel?.querySelector('.selected-price-chart-canvas');
    if (!canvas) return;
    const entry = selectedPriceChartEntry(currentBalanceChartRows);
    drawSelectedPriceChart(canvas, entry, { unit: priceChartUnit, compact: true });
  }

  function renderBalanceChartThumbnail(rows) {
    currentBalanceChartRows = rows || [];
    redrawBalanceChartThumbnail();
    syncBalanceChartThumbState();
    redrawOpenBalanceChart();
  }

  function redrawBalanceChartThumbnail() {
    const canvas = coinInfoPanel?.querySelector('.balance-chart-canvas');
    if (canvas?.closest('.balance-chart-thumb-empty')) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if (balanceChartUnit === 'usd' && !dailyPriceIndexCache) {
      dailyPriceIndex().then(() => {
        if (balanceChartUnit === 'usd') redrawBalanceChartThumbnail();
      });
      return;
    }
    if (canvas) {
      drawBalanceChart(canvas, currentBalanceChartRows, {
        compact: true,
        unit: balanceChartUnit
      });
    }
  }

  function balanceChartIsOpen() {
    return Boolean(balanceChartModal?.classList.contains('open'));
  }

  function bottomPanelCountsForViewport() {
    return bottomPanelOpen && !root.classList.contains('balance-chart-open');
  }

  function mobileBrowserBottomSpace() {
    if (!bottomPanelCountsForViewport()) return 0;
    const value = parseFloat(getComputedStyle(root).getPropertyValue('--mobile-browser-bottom-space')) || 0;
    return Math.max(0, Math.ceil(value));
  }

  function effectiveBottomPanelHeight() {
    return bottomPanelCountsForViewport()
      ? Math.ceil(bottomStack?.getBoundingClientRect().height || 0) + mobileBrowserBottomSpace()
      : 0;
  }

  function syncBalanceChartThumbState() {
    const open = root.classList.contains('balance-chart-open') || balanceChartIsOpen();
    coinInfoPanel?.querySelectorAll('[data-balance-chart-open]').forEach(button => {
      const closeLabel = activeChartModalMode === 'balance' ? 'Close balance chart' : 'Close chart';
      button.setAttribute('aria-label', open ? closeLabel : 'Open balance chart');
    });
    coinInfoPanel?.querySelectorAll('[data-selected-price-chart-open]').forEach(button => {
      const closeLabel = activeChartModalMode === 'price' ? 'Close price history chart' : 'Close chart';
      button.setAttribute('aria-label', open ? closeLabel : 'Open price history chart');
    });
  }

  function syncBalanceChartUnitButtons() {
    const activeUnit = activeChartModalMode === 'price' ? priceChartUnit : balanceChartUnit;
    balanceChartModal?.querySelectorAll('[data-balance-chart-unit]').forEach(button => {
      const active = button.dataset.balanceChartUnit === activeUnit;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    balanceChartModal?.querySelectorAll('[data-price-chart-scale]').forEach(button => {
      const active = button.dataset.priceChartScale === priceChartScale;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function syncBalanceChartBackgroundLayers({ hiddenOverride = null } = {}) {
    const hidden = hiddenOverride ?? (balanceChartIsOpen() && balanceChartBackgroundHidden && !balanceChartBackgroundHideDeferred);
    [scene, allItemsStage, allItemsExtraScene, quarterScene].filter(Boolean).forEach((layer) => {
      if (hidden) {
        layer.style.setProperty('opacity', '0', 'important');
      } else {
        layer.style.removeProperty('opacity');
      }
    });
  }

  function syncBalanceChartBackgroundToggle({ deferLayers = false } = {}) {
    const active = balanceChartIsOpen() && balanceChartBackgroundHidden;
    root.classList.toggle('balance-chart-background-hidden', active && !deferLayers);
    balanceChartModal?.classList.toggle('background-hidden', balanceChartBackgroundHidden);
    const button = balanceChartModal?.querySelector('.balance-chart-background-toggle');
    if (button) {
      button.setAttribute('aria-pressed', balanceChartBackgroundHidden ? 'true' : 'false');
      button.setAttribute('aria-label', balanceChartBackgroundHidden ? 'Show background image' : 'Hide background image');
    }
    clearTimeout(syncBalanceChartBackgroundToggle.deferTimer);
    balanceChartBackgroundHideDeferred = false;
    if (!deferLayers || !active) {
      syncBalanceChartBackgroundLayers();
      return;
    }
    balanceChartBackgroundHideDeferred = true;
    syncBalanceChartBackgroundLayers({ hiddenOverride: false });
    syncBalanceChartBackgroundToggle.deferTimer = setTimeout(() => {
      balanceChartBackgroundHideDeferred = false;
      if (!balanceChartIsOpen() || !balanceChartBackgroundHidden) return;
      root.classList.add('balance-chart-background-hidden');
      syncBalanceChartBackgroundLayers();
    }, 64);
  }

  function toggleBalanceChartBackground() {
    balanceChartBackgroundHidden = !balanceChartBackgroundHidden;
    saveBalanceChartBackgroundHidden(balanceChartBackgroundHidden);
    syncBalanceChartBackgroundToggle();
  }

  async function setBalanceChartUnit(unit) {
    const nextUnit = unit === 'usd' ? 'usd' : 'btc';
    if (nextUnit === balanceChartUnit) return;
    const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
    const meta = canvas?._balanceChartMeta;
    const preserveZoom = balanceChartZoom && meta && meta.unit === balanceChartUnit
      && balanceChartZoom.scope === balanceChartScopeKey()
      && (meta.minTime > meta.fullMinTime || meta.maxTime < meta.fullMaxTime)
      ? {
          scope: balanceChartScopeKey(),
          unit: nextUnit,
          minTime: meta.minTime,
          maxTime: meta.maxTime
        }
      : null;
    balanceChartUnit = nextUnit;
    balanceChartZoom = preserveZoom;
    balanceChartDrag = null;
    saveBalanceChartUnit(nextUnit);
    syncBalanceChartUnitButtons();
    hideBalanceChartHover();
    if (nextUnit === 'usd') await dailyPriceIndex();
    if (balanceChartUnit !== nextUnit) return;
    redrawBalanceChartThumbnail();
    redrawOpenBalanceChart();
  }

  function cycleBalanceChartUnit() {
    setBalanceChartUnit(balanceChartUnit === 'usd' ? 'btc' : 'usd');
  }

  async function setPriceChartUnit(unit) {
    const nextUnit = unit === 'usd' ? 'usd' : 'btc';
    if (nextUnit === priceChartUnit) return;
    const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
    const meta = canvas?._priceChartMeta;
    const preserveZoom = priceChartZoom && meta && meta.unit === priceChartUnit && meta.scale === priceChartScale
      && priceChartZoom.type === String(meta.entry?.type || '')
      && (meta.minTime > meta.fullMinTime || meta.maxTime < meta.fullMaxTime)
      ? {
          type: String(meta.entry?.type || ''),
          unit: nextUnit,
          scale: priceChartScale,
          minTime: meta.minTime,
          maxTime: meta.maxTime
        }
      : null;
    priceChartUnit = nextUnit;
    priceChartZoom = preserveZoom;
    priceChartDrag = null;
    savePriceChartUnit(nextUnit);
    syncBalanceChartUnitButtons();
    hideBalanceChartHover();
    if (nextUnit === 'usd') await dailyPriceIndex();
    if (priceChartUnit !== nextUnit) return;
    renderSelectedPriceChartPreview();
    if (activeChartModalMode === 'price' && balanceChartModal?.classList.contains('open')) {
      redrawCurrentPriceChartCanvas(canvas);
      refreshBalanceChartHover();
    } else {
      redrawOpenBalanceChart();
    }
  }

  function cyclePriceChartUnit() {
    setPriceChartUnit(priceChartUnit === 'usd' ? 'btc' : 'usd');
  }

  function setPriceChartScale(scale) {
    const nextScale = scale === 'log' ? 'log' : 'linear';
    if (nextScale === priceChartScale) return;
    priceChartScale = nextScale;
    priceChartZoom = null;
    priceChartDrag = null;
    savePriceChartScale(nextScale);
    syncBalanceChartUnitButtons();
    hideBalanceChartHover();
    redrawOpenBalanceChart();
  }

  function shortcutKeyId(key) {
    return String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function shortcutKeyHtml(key, id) {
    const shortcutId = shortcutKeyId(id);
    if (Array.isArray(key)) {
      return `
        <span class="shortcut-combo">
          ${key.map((part, index) => `
            ${index ? '<span class="shortcut-plus" aria-hidden="true">+</span>' : ''}
            <span class="shortcut-key" data-shortcut-key="${shortcutId}"${part === '⌘' ? ' data-shortcut-command-key="true"' : ''}>${escapeHtml(part)}</span>
          `).join('')}
        </span>
      `;
    }
    return `<span class="shortcut-key" data-shortcut-key="${shortcutId}">${escapeHtml(key)}</span>`;
  }

  function shortcutRows(rows) {
    return rows.map(([key, desc, id = key]) => `
      <div class="shortcut-row">
        ${shortcutKeyHtml(key, id)}
        <span class="shortcut-desc">${desc}</span>
      </div>
    `).join('');
  }

  function shortcutIdForKeyboardEvent(event) {
    if (!event) return '';
    const commandPrefix = event.metaKey ? 'cmd-' : '';
    if (event.key === 'ArrowLeft') return `${commandPrefix}arrow-left`;
    if (event.key === 'ArrowRight') return `${commandPrefix}arrow-right`;
    if (event.key === 'ArrowUp') return `${commandPrefix}arrow-up`;
    if (event.key === 'ArrowDown') return `${commandPrefix}arrow-down`;
    if (event.key === 'Enter') return 'enter';
    if (event.key === 'Escape') return 'escape';
    if (event.key === ' ' || event.code === 'Space') return 'space';
    const keyId = shortcutKeyId(event.key || '');
    return commandPrefix && keyId ? `${commandPrefix}${keyId}` : keyId;
  }

  function commandComboShortcutId(id) {
    if (id === 'arrow-left') return 'cmd-arrow-left';
    if (id === 'arrow-right') return 'cmd-arrow-right';
    if (id === 'arrow-up') return 'cmd-arrow-up';
    if (id === 'arrow-down') return 'cmd-arrow-down';
    if (id === 's') return 'cmd-s';
    return id;
  }

  function setShortcutKeyPressed(id, pressed) {
    if (!id || !shortcutsModal?.classList.contains('open')) return;
    shortcutsModal
      .querySelectorAll(`.shortcut-key[data-shortcut-key="${CSS.escape(id)}"]`)
      .forEach(key => key.classList.toggle('pressed', pressed));
  }

  function setShortcutCommandPressed(pressed) {
    if (!shortcutsModal?.classList.contains('open')) return;
    shortcutsModal
      .querySelectorAll('.shortcut-key[data-shortcut-command-key="true"]')
      .forEach(key => key.classList.toggle('pressed', pressed));
  }

  function clearShortcutPressedState() {
    shortcutCommandPressed = false;
    shortcutsModal?.querySelectorAll('.shortcut-key.pressed').forEach(key => key.classList.remove('pressed'));
  }

  function shortcutKeyFromPointerEvent(event) {
    const key = event?.target?.closest?.('.shortcut-key[data-shortcut-key]');
    if (!key || !shortcutCommandPressed) return key;
    const comboId = commandComboShortcutId(key.dataset.shortcutKey || '');
    if (comboId === key.dataset.shortcutKey) return key;
    return shortcutsModal?.querySelector(`.shortcut-key[data-shortcut-key="${CSS.escape(comboId)}"]:not([data-shortcut-command-key])`) || key;
  }

  function ensureShortcutsModal() {
    if (shortcutsModal) return shortcutsModal;
    shortcutsModal = document.createElement('div');
    shortcutsModal.className = 'shortcuts-modal';
    shortcutsModal.setAttribute('role', 'dialog');
    shortcutsModal.setAttribute('aria-modal', 'true');
    shortcutsModal.setAttribute('aria-labelledby', 'shortcutsTitle');
    shortcutsModal.innerHTML = `
      <div class="shortcuts-panel">
        <div class="shortcuts-header">
          <h2 class="shortcuts-title" id="shortcutsTitle">Shortcuts &amp; Gestures</h2>
        </div>
        <div class="shortcuts-grid">
          <section class="shortcuts-section" aria-labelledby="shortcutsNavigationTitle">
            <h3 class="shortcuts-section-title" id="shortcutsNavigationTitle">Navigation</h3>
            ${shortcutRows([
              ['◀', 'Select the previous coin or bar group.', 'arrow-left'],
              ['▶', 'Select the next coin or bar group.', 'arrow-right'],
              ['▲', 'Cycle to the previous version in the selected group.', 'arrow-up'],
              ['▼', 'Cycle to the next version in the selected group.', 'arrow-down'],
              ['A', 'Show active addresses in the left panel.'],
              ['G', 'Show graded addresses in the left panel.'],
              ['R', 'Show redeemed addresses in the left panel.'],
              [['⌘', '▲'], 'Show or hide all panels.', 'cmd-arrow-up'],
              [['⌘', '◀'], 'Show or hide the left panel.', 'cmd-arrow-left'],
              [['⌘', '▶'], 'Show or hide the right panel.', 'cmd-arrow-right'],
              [['⌘', '▼'], 'Show or hide the bottom panel.', 'cmd-arrow-down'],
              [['⌘', 'S'], 'Show or hide the shortcuts panel.', 'cmd-s']
            ])}
          </section>
          <div class="shortcuts-column">
            <section class="shortcuts-section" aria-labelledby="shortcutsViewTitle">
              <h3 class="shortcuts-section-title" id="shortcutsViewTitle">3D View</h3>
              ${shortcutRows([
                ['space', 'Play or pause the spin animation.', 'Space'],
                ['F', 'Show the front face.'],
                ['B', 'Show the back face.'],
                ['H', 'Show the hologram face.'],
                ['T', 'Animate tilt back to the baseline.'],
                ['Z', 'Animate zoom back to 100%.'],
                ['S', 'Reset speed to 100%.'],
                ['1', 'Show the 3D coin when extra images are available.'],
                ['2', 'Show the 3D graded holder when available.']
              ])}
            </section>
            <section class="shortcuts-section" aria-labelledby="shortcutsAllModeTitle">
              <h3 class="shortcuts-section-title" id="shortcutsAllModeTitle">All Coins &amp; Bars</h3>
              ${shortcutRows([
                ['click item', 'Select and center that coin or bar.'],
                ['drag outside', 'Pan the all-mode image.'],
                ['drag selected', 'Spin and tilt the selected 3D item.'],
                ['double click', 'Snap only the selected 3D item to its closest face.'],
                [['⌘', 'click item'], 'Open that coin or bar in its single-item view.', 'cmd-click-item']
              ])}
            </section>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(shortcutsModal);
    shortcutsCloseButton = document.createElement('button');
    shortcutsCloseButton.className = 'shortcuts-close shortcuts-floating-close';
    shortcutsCloseButton.type = 'button';
    shortcutsCloseButton.setAttribute('aria-label', 'Close shortcuts');
    shortcutsCloseButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 6L18 18M18 6L6 18"></path>
      </svg>
    `;
    document.body.appendChild(shortcutsCloseButton);
    shortcutsCloseButton.addEventListener('click', closeShortcutsModal);
    shortcutsModal.addEventListener('click', event => {
      if (event.target === shortcutsModal) closeShortcutsModal();
    });
    shortcutsModal.addEventListener('pointerdown', event => {
      const key = shortcutKeyFromPointerEvent(event);
      if (!key) return;
      key.classList.add('pressed');
      key.setPointerCapture?.(event.pointerId);
    });
    shortcutsModal.addEventListener('pointerup', event => {
      const key = shortcutKeyFromPointerEvent(event);
      key?.classList.remove('pressed');
      if (shortcutCommandPressed) setShortcutCommandPressed(true);
    });
    shortcutsModal.addEventListener('pointercancel', event => {
      const key = shortcutKeyFromPointerEvent(event);
      key?.classList.remove('pressed');
      if (shortcutCommandPressed) setShortcutCommandPressed(true);
    });
    shortcutsModal.addEventListener('pointerleave', event => {
      const key = shortcutKeyFromPointerEvent(event);
      key?.classList.remove('pressed');
      if (shortcutCommandPressed) setShortcutCommandPressed(true);
    });
    return shortcutsModal;
  }

  function openShortcutsModal() {
    const modal = ensureShortcutsModal();
    shortcutsPausedBalanceChart = balanceChartIsOpen();
    if (shortcutsPausedBalanceChart) {
      balanceChartModal?.classList.remove('open');
      hideBalanceChartHover();
    }
    updateBalanceChartModalBounds();
    modal.classList.add('open');
    root.classList.add('shortcuts-open');
    keyboardShortcutsBtn?.setAttribute('aria-expanded', 'true');
  }

  function closeShortcutsModal({ restoreChart = true } = {}) {
    clearShortcutPressedState();
    shortcutsModal?.classList.remove('open');
    root.classList.remove('shortcuts-open');
    keyboardShortcutsBtn?.setAttribute('aria-expanded', 'false');
    if (restoreChart && shortcutsPausedBalanceChart) {
      const modal = ensureBalanceChartModal();
      syncBalanceChartUnitButtons();
      updateBalanceChartModalBounds();
      modal.classList.add('open');
      syncBalanceChartBackgroundToggle({ deferLayers: balanceChartBackgroundHidden });
      redrawOpenBalanceChart();
      hideBalanceChartHover();
      syncBalanceChartThumbState();
    }
    shortcutsPausedBalanceChart = false;
    keyboardShortcutsBtn?.focus();
  }

  function toggleShortcutsModal() {
    if (shortcutsModal?.classList.contains('open')) closeShortcutsModal();
    else openShortcutsModal();
  }

  function ensureBalanceChartModal() {
    if (balanceChartModal) return balanceChartModal;
    balanceChartModal = document.createElement('div');
    balanceChartModal.className = 'balance-chart-modal';
    balanceChartModal.innerHTML = `
      <button class="balance-chart-background-toggle" type="button" aria-label="Hide background image" aria-pressed="false">
        <svg class="balance-chart-eye-icon balance-chart-eye-open" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"></path>
          <circle cx="12" cy="12" r="2.8"></circle>
        </svg>
        <svg class="balance-chart-eye-icon balance-chart-eye-closed" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"></path>
          <circle cx="12" cy="12" r="2.8"></circle>
          <path d="M4 4l16 16"></path>
        </svg>
      </button>
      <div class="balance-chart-unit-toggle" role="group" aria-label="Chart denomination">
        <button class="balance-chart-unit-btn active" type="button" data-balance-chart-unit="btc" aria-pressed="true">BTC</button>
        <button class="balance-chart-unit-btn" type="button" data-balance-chart-unit="usd" aria-pressed="false">USD</button>
      </div>
      <div class="balance-chart-unit-toggle price-chart-scale-toggle" role="group" aria-label="Price chart scale">
        <button class="balance-chart-unit-btn active" type="button" data-price-chart-scale="linear" aria-pressed="true">LIN</button>
        <button class="balance-chart-unit-btn" type="button" data-price-chart-scale="log" aria-pressed="false">LOG</button>
      </div>
      <button class="balance-chart-close" type="button" aria-label="Close balance chart">
        <svg class="balance-chart-close-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 6L18 18M18 6L6 18"></path>
        </svg>
      </button>
      <canvas class="balance-chart-full-canvas" aria-label="Balance chart"></canvas>
      <div class="balance-chart-hover-line" aria-hidden="true"></div>
      <div class="balance-chart-tooltip" role="status"></div>
    `;
    document.body.appendChild(balanceChartModal);
    balanceChartModal.querySelector('.balance-chart-background-toggle')?.addEventListener('click', toggleBalanceChartBackground);
    balanceChartModal.querySelector('.balance-chart-close')?.addEventListener('click', closeBalanceChartModal);
    balanceChartModal.querySelector('.balance-chart-unit-toggle')?.addEventListener('click', event => {
      const button = event.target?.closest?.('[data-balance-chart-unit]');
      if (!button) return;
      if (activeChartModalMode === 'price') cyclePriceChartUnit();
      else setBalanceChartUnit(button.dataset.balanceChartUnit);
    });
    balanceChartModal.querySelector('.price-chart-scale-toggle')?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setPriceChartScale(priceChartScale === 'log' ? 'linear' : 'log');
    });
    balanceChartModal.addEventListener('click', event => {
      if (activeChartModalMode === 'balance' && balanceChartSuppressClick) {
        balanceChartSuppressClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (activeChartModalMode === 'price' && priceChartSuppressClick) {
        priceChartSuppressClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (activeChartModalMode === 'price' && handlePriceChartLegendClick(event)) return;
      if (activeChartModalMode === 'price' && handlePriceChartPointClick(event)) return;
      if (activeChartModalMode === 'balance' && handleBalanceChartLegendClick(event)) return;
      if (event.target === balanceChartModal) closeBalanceChartModal();
    });
    balanceChartModal.addEventListener('pointerdown', handleBalanceChartPointerDown);
    balanceChartModal.addEventListener('pointerup', handleBalanceChartPointerUp);
    balanceChartModal.addEventListener('pointercancel', handleBalanceChartPointerCancel);
    balanceChartModal.addEventListener('pointerdown', handlePriceChartPointerDown);
    balanceChartModal.addEventListener('pointerup', handlePriceChartPointerUp);
    balanceChartModal.addEventListener('pointercancel', handlePriceChartPointerCancel);
    balanceChartModal.addEventListener('dblclick', handlePriceChartDoubleClick);
    balanceChartModal.addEventListener('pointermove', updateBalanceChartHover);
    balanceChartModal.addEventListener('pointerleave', hideBalanceChartHover);
    return balanceChartModal;
  }

  function openBalanceChartModal(mode = 'balance') {
    activeChartModalMode = mode === 'price' ? 'price' : 'balance';
    const modal = ensureBalanceChartModal();
    modal.classList.toggle('price-chart-mode', activeChartModalMode === 'price');
    const canvas = modal.querySelector('.balance-chart-full-canvas');
    if (canvas) {
      canvas.setAttribute('aria-label', activeChartModalMode === 'price' ? 'Price history chart' : 'Balance chart');
    }
    syncBalanceChartUnitButtons();
    updateBalanceChartModalBounds();
    modal.classList.add('open');
    syncBalanceChartBackgroundToggle({ deferLayers: balanceChartBackgroundHidden });
    animatePanelLayoutChange(() => {
      root.classList.add('balance-chart-open');
      syncBalanceChartBackgroundToggle({ deferLayers: balanceChartBackgroundHidden });
      updateDockedPanelLayout();
    }, { layoutDurationMs: 320 });
    saveBalanceChartOpen(true);
    saveChartModalMode(activeChartModalMode);
    if (activeChartModalMode === 'price' && selectedLeftPanelAddressByMode.graded) {
      saveGradedMediaSelection('graded');
    }
    syncBalanceChartThumbState();
    modal.getBoundingClientRect();
    redrawOpenBalanceChart();
    hideBalanceChartHover();
  }

  function closeBalanceChartModal() {
    balanceChartModal?.classList.remove('open');
    root.classList.remove('balance-chart-background-hidden');
    syncBalanceChartBackgroundLayers();
    animatePanelLayoutChange(() => {
      root.classList.remove('balance-chart-open');
      updateDockedPanelLayout();
    }, { layoutDurationMs: 320 });
    saveBalanceChartOpen(false);
    syncBalanceChartThumbState();
    hideBalanceChartHover();
  }

  function balanceChartSelectionSuppressesHover() {
    if (activeChartModalMode === 'price') return false;
    if (activeChartModalMode !== 'balance') return true;
    if (isMuleCoin(allItemsSelected() ? allItemsFocusedCoin() : activeCoin())) return true;
    const selectedEntry = selectedTrackerEntry(currentBalanceChartRows);
    const selectedCoin = selectedEntry?.slug ? COINS.find(c => c.slug === selectedEntry.slug) : null;
    return isMuleCoin(selectedCoin);
  }

  function hideBalanceChartHover({ clearHover = true } = {}) {
    if (!balanceChartModal) return;
    if (clearHover) balanceChartHoverPoint = null;
    balanceChartModal.querySelector('.balance-chart-full-canvas')?.style.removeProperty('cursor');
    balanceChartModal.querySelector('.balance-chart-hover-line')?.classList.remove('visible');
    balanceChartModal.querySelector('.balance-chart-tooltip')?.classList.remove('visible');
  }

  function refreshBalanceChartHover() {
    if (!balanceChartModal?.classList.contains('open') || !balanceChartHoverPoint) return;
    if (balanceChartSelectionSuppressesHover()) {
      hideBalanceChartHover({ clearHover: false });
      return;
    }
    updateBalanceChartHover(balanceChartHoverPoint);
  }

  function balanceChartCanvasPoint(canvas, event) {
    const meta = canvas?._balanceChartMeta || canvas?._priceChartMeta;
    if (!canvas || !meta) return null;
    const rect = canvas.getBoundingClientRect();
    const drawWidth = Number(meta.cssWidth) || canvas.clientWidth || rect.width || 1;
    const drawHeight = Number(meta.cssHeight) || canvas.clientHeight || rect.height || 1;
    const scaleX = rect.width ? drawWidth / rect.width : 1;
    const scaleY = rect.height ? drawHeight / rect.height : 1;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
      rect,
      drawWidth,
      drawHeight
    };
  }

  function formatPriceTooltipRange(points, unit) {
    const values = points
      .map(point => Number(point?.value))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (!values.length) return formatBalanceTooltipValue(0, unit);
    const min = values[0];
    const max = values[values.length - 1];
    const epsilon = unit === 'usd' ? 0.005 : 0.000000005;
    if (Math.abs(max - min) <= epsilon) return formatBalanceTooltipValue(min, unit);
    return `${formatBalanceTooltipValue(min, unit)} - ${formatBalanceTooltipValue(max, unit)}`;
  }

  function priceTooltipHasRange(points, unit) {
    const values = points
      .map(point => Number(point?.value))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (values.length < 2) return false;
    const epsilon = unit === 'usd' ? 0.005 : 0.000000005;
    return Math.abs(values[values.length - 1] - values[0]) > epsilon;
  }

  function priceTooltipDisplayLabel(group, unit) {
    const label = String(group?.label || '').trim();
    const isAuction = group?.points?.some(point => point.source === 'Auction');
    if (!isAuction) return label;
    const baseLabel = label.replace(/\s+Sales?$/i, '');
    return `${baseLabel} ${priceTooltipHasRange(group.points, unit) ? 'Sales' : 'Sale'}`;
  }

  function priceTooltipRowsForPoints(points, unit) {
    const groups = new Map();
    points.forEach(point => {
      const label = point.tooltipLabel || (point.seriesKey === 'funded' ? 'Funded' : 'Premium');
      const key = `${point.seriesKey || 'premium'}|${label}`;
      if (!groups.has(key)) groups.set(key, { label, seriesKey: point.seriesKey || 'premium', points: [] });
      groups.get(key).points.push(point);
    });
    return Array.from(groups.values()).map(group => (
      `<div><span class="balance-chart-tooltip-swatch balance-chart-tooltip-swatch-price-${group.seriesKey}"></span>${escapeHtml(priceTooltipDisplayLabel(group, unit))} ${escapeHtml(formatPriceTooltipRange(group.points, unit))}</div>`
    )).join('');
  }

  function gradeSortValue(grade) {
    const text = String(grade || '').toUpperCase();
    const numeric = text.match(/(?:MS|PR|PF|SP|AU|XF|VF|F|VG|G)?\s*(\d+(?:\.\d+)?)/);
    if (!numeric) return -1;
    const prefix = (text.match(/\b(MS|PR|PF|SP|AU|XF|VF|F|VG|G)\b/) || [])[1] || '';
    const prefixBonus = { MS: 900, PR: 850, PF: 850, SP: 825, AU: 800, XF: 700, VF: 600, F: 500, VG: 400, G: 300 }[prefix] || 0;
    const plusBonus = /\d(?:\.\d+)?\s*\+/.test(text) ? 0.25 : 0;
    return prefixBonus + Number(numeric[1]) + plusBonus;
  }

  function formatPriceTooltipBtcValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0.00000000 BTC';
    return `${number.toLocaleString(undefined, { minimumFractionDigits: 8, maximumFractionDigits: 8 })} BTC`;
  }

  function formatPriceTooltipPointValue(point, unit) {
    if (point?.source === 'Auction' && unit === 'usd' && Number.isFinite(point.usdValue)) {
      return formatBalanceTooltipValue(point.usdValue, 'usd');
    }
    if (point?.source === 'Auction' && Number.isFinite(point.btcValue) && point.btcValue > 0) {
      return formatPriceTooltipBtcValue(point.btcValue);
    }
    if (unit !== 'usd') {
      return formatPriceTooltipBtcValue(point?.value || 0);
    }
    return formatBalanceTooltipValue(point?.value || 0, unit);
  }

  function priceTooltipPointLabel(point) {
    if (point?.source === 'Initial') {
      return point.seriesKey === 'funded' ? 'Original price' : 'Original premium';
    }
    return String(point.grade || point.label || point.tooltipLabel || 'Sale').trim();
  }

  function priceTooltipSortValue(point, unit) {
    if (point?.source === 'Auction' && unit === 'usd' && Number.isFinite(point.usdValue)) return point.usdValue;
    if (point?.source === 'Auction' && Number.isFinite(point.btcValue)) return point.btcValue;
    return Number(point?.value) || 0;
  }

  function priceTooltipMarkerRowParts(point, unit) {
    const label = priceTooltipPointLabel(point);
    const seriesKey = point.seriesKey === 'funded' ? 'funded' : 'premium';
    const markerClass = point.source === 'Initial' ? 'balance-chart-tooltip-star' : 'balance-chart-tooltip-swatch';
    const value = formatPriceTooltipPointValue(point, unit);
    return { label, seriesKey, markerClass, value };
  }

  function priceTooltipMarkerRows(points, unit) {
    const sortedPoints = [...points].sort((a, b) => (
      priceTooltipSortValue(b, unit) - priceTooltipSortValue(a, unit)
      || gradeSortValue(b.grade || b.label) - gradeSortValue(a.grade || a.label)
      || (a.seriesKey === b.seriesKey ? 0 : (a.seriesKey === 'funded' ? -1 : 1))
      || (Number(b.value) || 0) - (Number(a.value) || 0)
      || String(a.label || '').localeCompare(String(b.label || ''))
    ));
    const groupedRows = [];
    sortedPoints.forEach(point => {
      const row = priceTooltipMarkerRowParts(point, unit);
      const key = [row.markerClass, row.seriesKey, row.label, row.value].join('|');
      const existing = groupedRows.find(group => group.key === key);
      if (existing) {
        existing.count += 1;
        return;
      }
      groupedRows.push({ key, ...row, count: 1 });
    });
    const rows = groupedRows.map(row => {
      const countSuffix = row.count > 1 ? ` x ${row.count}` : '';
      return `
        <span class="balance-chart-tooltip-sale-label"><span class="${row.markerClass} balance-chart-tooltip-swatch-price-${row.seriesKey}"></span>${escapeHtml(row.label)}</span>
        <span class="balance-chart-tooltip-sale-value">${escapeHtml(row.value)}</span>
        <span class="balance-chart-tooltip-sale-count">${escapeHtml(countSuffix)}</span>
      `;
    }).join('');
    return `<div class="balance-chart-tooltip-sales">${rows}</div>`;
  }

  function balanceChartLegendHit(canvas, event) {
    const point = balanceChartCanvasPoint(canvas, event);
    if (!point) return null;
    return (canvas._balanceChartLegendHitBoxes || []).find(box => (
      point.x >= box.x
      && point.x <= box.x + box.width
      && point.y >= box.y
      && point.y <= box.y + box.height
    )) || null;
  }

  function priceChartLegendHit(canvas, event) {
    const point = balanceChartCanvasPoint(canvas, event);
    if (!point) return null;
    const tolerance = 6;
    return (canvas._priceChartLegendHitBoxes || []).find(box => (
      point.x >= box.x - tolerance
      && point.x <= box.x + box.width + tolerance
      && point.y >= box.y - tolerance
      && point.y <= box.y + box.height + tolerance
    )) || null;
  }

  function priceChartAuctionPointHit(canvas, event) {
    const point = balanceChartCanvasPoint(canvas, event);
    if (!point) return null;
    const candidates = (canvas._priceChartPointHitBoxes || [])
      .filter(box => box.clickable)
      .map(box => {
        const distance = Math.hypot(point.x - box.x, point.y - box.y);
        return { ...box, distance };
      })
      .filter(box => box.distance <= box.radius)
      .sort((a, b) => a.distance - b.distance);
    if (!candidates.length) return null;
    const nearest = candidates[0];
    const sameDot = candidates.filter(box => (
      Math.abs(box.x - nearest.x) <= 0.75
      && Math.abs(box.y - nearest.y) <= 0.75
    ));
    return sameDot
      .map(box => box.point)
      .sort((a, b) => (b.createTime || 0) - (a.createTime || 0) || (b.createBlock || 0) - (a.createBlock || 0))[0] || null;
  }

  function priceChartClosestMarkerHit(canvas, event) {
    const point = balanceChartCanvasPoint(canvas, event);
    if (!point) return null;
    const candidates = (canvas._priceChartPointHitBoxes || [])
      .map(box => {
        const distance = Math.hypot(point.x - box.x, point.y - box.y);
        return { ...box, distance };
      })
      .sort((a, b) => a.distance - b.distance);
    if (!candidates.length) return null;
    const nearest = candidates[0];
    const samePosition = candidates.filter(box => (
      Math.abs(box.x - nearest.x) <= 0.75
      && Math.abs(box.y - nearest.y) <= 0.75
    ));
    return {
      x: nearest.x,
      y: nearest.y,
      point: nearest.point,
      points: samePosition.map(box => box.point)
    };
  }

  function handleBalanceChartLegendClick(event) {
    const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
    const hit = balanceChartLegendHit(canvas, event);
    if (!hit) return false;
    balanceChartVisibleSeries[hit.key] = !balanceChartVisibleSeries[hit.key];
    saveBalanceChartVisibleSeries();
    hideBalanceChartHover();
    redrawBalanceChartThumbnail();
    redrawOpenBalanceChart();
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handlePriceChartLegendClick(event) {
    const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
    const hit = priceChartLegendHit(canvas, event);
    if (!hit || !Object.prototype.hasOwnProperty.call(priceChartVisibleGroups, hit.key)) return false;
    priceChartVisibleGroups[hit.key] = priceChartVisibleGroups[hit.key] === false;
    priceChartZoom = null;
    priceChartDrag = null;
    savePriceChartVisibleGroups();
    hideBalanceChartHover();
    drawSelectedPriceChart(canvas, canvas?._priceChartMeta?.entry || selectedPriceChartEntry(currentBalanceChartRows), {
      compact: false,
      unit: priceChartUnit,
      scale: priceChartScale
    });
    renderSelectedPriceChartPreview();
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function redrawCurrentBalanceChartCanvas(canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas')) {
    if (!canvas || activeChartModalMode !== 'balance') return;
    drawBalanceChart(canvas, currentBalanceChartRows, {
      compact: false,
      unit: balanceChartUnit
    });
  }

  function handleBalanceChartPointerDown(event) {
    if (activeChartModalMode !== 'balance' || event.button !== 0) return;
    const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
    const meta = canvas?._balanceChartMeta;
    const point = balanceChartCanvasPoint(canvas, event);
    if (!canvas || !meta || !point) return;
    if (balanceChartLegendHit(canvas, event)) return;
    const insidePlot = point.x >= meta.pad.left && point.x <= meta.pad.left + meta.plotW
      && point.y >= meta.pad.top && point.y <= meta.pad.top + meta.plotH;
    if (!insidePlot) return;
    balanceChartDrag = {
      active: true,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y
    };
    hideBalanceChartHover();
    canvas.setPointerCapture?.(event.pointerId);
  }

  function handleBalanceChartPointerMove(event) {
    if (activeChartModalMode !== 'balance' || !balanceChartDrag?.active) return false;
    if (balanceChartDrag.pointerId !== event.pointerId) return true;
    const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
    const point = balanceChartCanvasPoint(canvas, event);
    if (!canvas || !point) return true;
    balanceChartDrag.currentX = point.x;
    balanceChartDrag.currentY = point.y;
    hideBalanceChartHover();
    redrawCurrentBalanceChartCanvas(canvas);
    event.preventDefault();
    return true;
  }

  function handleBalanceChartPointerUp(event) {
    if (activeChartModalMode !== 'balance' || !balanceChartDrag?.active) return false;
    if (balanceChartDrag.pointerId !== event.pointerId) return true;
    const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
    const meta = canvas?._balanceChartMeta;
    const selection = priceChartDragSelection(meta, balanceChartDrag);
    balanceChartDrag = null;
    canvas?.releasePointerCapture?.(event.pointerId);
    if (selection?.moved && selection.width >= 10 && (selection.horizontalOnly || selection.height >= 10)) {
      const minTime = priceChartTimeAtCanvasX(meta, selection.left);
      const maxTime = priceChartTimeAtCanvasX(meta, selection.right);
      const yTopValue = balanceChartValueAtCanvasY(meta, selection.top);
      const yBottomValue = balanceChartValueAtCanvasY(meta, selection.bottom);
      const yMin = selection.horizontalOnly ? meta.yMin : Math.min(yTopValue, yBottomValue);
      const yMax = selection.horizontalOnly ? meta.yMax : Math.max(yTopValue, yBottomValue);
      if (Number.isFinite(minTime) && Number.isFinite(maxTime) && maxTime > minTime && Number.isFinite(yMin) && Number.isFinite(yMax) && yMax > yMin) {
        balanceChartZoom = {
          scope: balanceChartScopeKey(),
          unit: meta.unit,
          minTime,
          maxTime,
          yMin,
          yMax
        };
      }
      balanceChartSuppressClick = true;
      hideBalanceChartHover();
      redrawCurrentBalanceChartCanvas(canvas);
      event.preventDefault();
      return true;
    }
    redrawCurrentBalanceChartCanvas(canvas);
    return false;
  }

  function handleBalanceChartPointerCancel(event) {
    if (!balanceChartDrag?.active || balanceChartDrag.pointerId !== event.pointerId) return;
    const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
    balanceChartDrag = null;
    canvas?.releasePointerCapture?.(event.pointerId);
    redrawCurrentBalanceChartCanvas(canvas);
  }

  function handlePriceChartPointClick(event) {
    const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
    const hit = priceChartAuctionPointHit(canvas, event);
    const address = String(hit?.address || '');
    if (!address) return false;
    const gradedRecordId = String(hit?.gradedRecordId || '');
    const saleSourceEntries = currentGradedTrackerEntries.length ? currentGradedTrackerEntries : currentTrackerEntries;
    const entry = saleSourceEntries
      .flatMap(gradedAuctionEntriesForEntry)
      .find(row => String(row.address || '') === address && (!gradedRecordId || String(row.gradedRecordId || '') === gradedRecordId));
    if (!entry) return false;
    applySearchSelectionToPanels(entry, saleSourceEntries);
    hideBalanceChartHover();
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function redrawCurrentPriceChartCanvas(canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas')) {
    if (!canvas || activeChartModalMode !== 'price') return;
    drawSelectedPriceChart(canvas, canvas?._priceChartMeta?.entry || selectedPriceChartEntry(currentBalanceChartRows), {
      compact: false,
      unit: priceChartUnit,
      scale: priceChartScale
    });
  }

  function handlePriceChartPointerDown(event) {
    if (activeChartModalMode !== 'price' || event.button !== 0) return;
    const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
    const meta = canvas?._priceChartMeta;
    const point = balanceChartCanvasPoint(canvas, event);
    if (!canvas || !meta || !point) return;
    if (priceChartLegendHit(canvas, event)) return;
    const insidePlot = point.x >= meta.pad.left && point.x <= meta.pad.left + meta.plotW
      && point.y >= meta.pad.top && point.y <= meta.pad.top + meta.plotH;
    if (!insidePlot) return;
    priceChartDrag = {
      active: true,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y
    };
    hideBalanceChartHover();
    canvas.setPointerCapture?.(event.pointerId);
  }

  function handlePriceChartPointerMove(event) {
    if (activeChartModalMode !== 'price' || !priceChartDrag?.active) return false;
    if (priceChartDrag.pointerId !== event.pointerId) return true;
    const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
    const point = balanceChartCanvasPoint(canvas, event);
    if (!canvas || !point) return true;
    priceChartDrag.currentX = point.x;
    priceChartDrag.currentY = point.y;
    hideBalanceChartHover();
    redrawCurrentPriceChartCanvas(canvas);
    event.preventDefault();
    return true;
  }

  function handlePriceChartPointerUp(event) {
    if (activeChartModalMode !== 'price' || !priceChartDrag?.active) return false;
    if (priceChartDrag.pointerId !== event.pointerId) return true;
    const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
    const meta = canvas?._priceChartMeta;
    const selection = priceChartDragSelection(meta);
    priceChartDrag = null;
    canvas?.releasePointerCapture?.(event.pointerId);
    if (selection?.moved && selection.width >= 10 && (selection.horizontalOnly || selection.height >= 10)) {
      const minTime = priceChartTimeAtCanvasX(meta, selection.left);
      const maxTime = priceChartTimeAtCanvasX(meta, selection.right);
      const yTopValue = priceChartValueAtCanvasY(meta, selection.top);
      const yBottomValue = priceChartValueAtCanvasY(meta, selection.bottom);
      const yMin = selection.horizontalOnly ? meta.yMin : Math.min(yTopValue, yBottomValue);
      const yMax = selection.horizontalOnly ? meta.yMax : Math.max(yTopValue, yBottomValue);
      if (Number.isFinite(minTime) && Number.isFinite(maxTime) && maxTime > minTime && Number.isFinite(yMin) && Number.isFinite(yMax) && yMax > yMin) {
        priceChartZoom = {
          type: String(meta.entry?.type || ''),
          unit: meta.unit,
          scale: meta.scale,
          minTime,
          maxTime,
          yMin,
          yMax
        };
      }
      priceChartSuppressClick = true;
      hideBalanceChartHover();
      redrawCurrentPriceChartCanvas(canvas);
      event.preventDefault();
      return true;
    }
    redrawCurrentPriceChartCanvas(canvas);
    return false;
  }

  function handlePriceChartPointerCancel(event) {
    if (!priceChartDrag?.active || priceChartDrag.pointerId !== event.pointerId) return;
    const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
    priceChartDrag = null;
    canvas?.releasePointerCapture?.(event.pointerId);
    redrawCurrentPriceChartCanvas(canvas);
  }

  function handlePriceChartDoubleClick(event) {
    if (activeChartModalMode === 'balance') {
      const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
      const point = balanceChartCanvasPoint(canvas, event);
      const meta = canvas?._balanceChartMeta;
      if (!point || !meta) return;
      const insidePlot = point.x >= meta.pad.left && point.x <= meta.pad.left + meta.plotW
        && point.y >= meta.pad.top && point.y <= meta.pad.top + meta.plotH;
      if (!insidePlot) return;
      balanceChartZoom = null;
      balanceChartDrag = null;
      balanceChartSuppressClick = true;
      hideBalanceChartHover();
      redrawCurrentBalanceChartCanvas(canvas);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (activeChartModalMode !== 'price') return;
    const canvas = balanceChartModal?.querySelector('.balance-chart-full-canvas');
    const point = balanceChartCanvasPoint(canvas, event);
    const meta = canvas?._priceChartMeta;
    if (!point || !meta) return;
    const insidePlot = point.x >= meta.pad.left && point.x <= meta.pad.left + meta.plotW
      && point.y >= meta.pad.top && point.y <= meta.pad.top + meta.plotH;
    if (!insidePlot) return;
    priceChartZoom = null;
    priceChartDrag = null;
    priceChartSuppressClick = true;
    hideBalanceChartHover();
    redrawCurrentPriceChartCanvas(canvas);
    event.preventDefault();
    event.stopPropagation();
  }

  function updatePriceChartHover(event) {
    if (!balanceChartModal?.classList.contains('open')) return;
    if (handlePriceChartPointerMove(event)) return;
    const canvas = balanceChartModal.querySelector('.balance-chart-full-canvas');
    const meta = canvas?._priceChartMeta;
    if (!canvas || !meta) return;
    const point = balanceChartCanvasPoint(canvas, event);
    if (!point) return;
    if (priceChartLegendHit(canvas, event)) {
      canvas.style.cursor = 'pointer';
      hideBalanceChartHover({ clearHover: false });
      canvas.style.cursor = 'pointer';
      return;
    }
    const auctionPointHit = priceChartAuctionPointHit(canvas, event);
    canvas.style.removeProperty('cursor');
    if (!Array.isArray(meta.points) || !meta.points.length) return;
    const { x: localX, y: localY, rect, drawWidth, drawHeight } = point;
    const insidePlot = localX >= meta.pad.left && localX <= meta.pad.left + meta.plotW
      && localY >= meta.pad.top && localY <= meta.pad.top + meta.plotH;
    if (!insidePlot) {
      hideBalanceChartHover();
      return;
    }
    balanceChartHoverPoint = { clientX: event.clientX, clientY: event.clientY };
    canvas.style.cursor = auctionPointHit ? 'pointer' : 'crosshair';

    const xFor = time => meta.pad.left + ((time - meta.minTime) / Math.max(1, meta.maxTime - meta.minTime)) * meta.plotW;
    const nearestDate = meta.points.reduce((best, chartPoint) => {
      const distance = Math.abs(xFor(chartPoint.time) - localX);
      return !best || distance < best.distance
        ? { time: chartPoint.time, distance }
        : best;
    }, null);
    const maxTooltipSnapDistance = Math.max(14, Math.min(32, meta.plotW * 0.035));
    const nearestTime = nearestDate?.time;
    if (!nearestDate || nearestDate.distance > maxTooltipSnapDistance) {
      hideBalanceChartHover();
      return;
    }
    if (!Number.isFinite(nearestTime)) {
      hideBalanceChartHover();
      return;
    }
    const datePoints = meta.points.filter(chartPoint => chartPoint.time === nearestTime);
    if (!datePoints.length) {
      hideBalanceChartHover();
      return;
    }

    const line = balanceChartModal.querySelector('.balance-chart-hover-line');
    const tooltip = balanceChartModal.querySelector('.balance-chart-tooltip');
    if (!line || !tooltip) return;

    const hoverX = xFor(nearestTime);
    const cssX = rect.left + (hoverX / drawWidth) * rect.width;
    const modalRect = balanceChartModal.getBoundingClientRect();
    const modalLocalX = cssX - modalRect.left;
    const cssPlotTop = rect.top + (meta.pad.top / drawHeight) * rect.height;
    const cssPlotHeight = (meta.plotH / drawHeight) * rect.height;

    line.classList.add('visible');
    line.style.left = `${modalLocalX}px`;
    line.style.top = `${cssPlotTop - modalRect.top}px`;
    line.style.height = `${cssPlotHeight}px`;

    const rows = priceTooltipMarkerRows(datePoints, meta.unit);
    tooltip.innerHTML = `
      <div class="balance-chart-tooltip-date">${escapeHtml(formatBalanceTickDate(new Date(nearestTime * 1000)))}</div>
      ${rows}
    `;
    tooltip.classList.add('visible');

    const tooltipWidth = tooltip.offsetWidth || 190;
    const tooltipHeight = tooltip.offsetHeight || 74;
    const gap = 10;
    const modalWidth = modalRect.width || window.innerWidth;
    const modalHeight = modalRect.height || window.innerHeight;
    const plotRight = rect.left + ((meta.pad.left + meta.plotW) / drawWidth) * rect.width - modalRect.left;
    const right = modalLocalX + gap;
    const left = right + tooltipWidth <= Math.min(plotRight, modalWidth - 10)
      ? right
      : Math.max(10, modalLocalX - gap - tooltipWidth);
    const plotBottom = cssPlotTop - modalRect.top + cssPlotHeight;
    const maxTop = Math.max(10, Math.min(modalHeight - tooltipHeight - 10, plotBottom - tooltipHeight - gap));
    const top = Math.max(10, Math.min(event.clientY - modalRect.top - tooltipHeight / 2, maxTop));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function updateBalanceChartHover(event) {
    if (!balanceChartModal?.classList.contains('open')) return;
    if (activeChartModalMode === 'price') {
      updatePriceChartHover(event);
      return;
    }
    if (handleBalanceChartPointerMove(event)) return;
    if (balanceChartSelectionSuppressesHover()) {
      hideBalanceChartHover({ clearHover: false });
      return;
    }
    const canvas = balanceChartModal.querySelector('.balance-chart-full-canvas');
    const meta = canvas?._balanceChartMeta;
    if (!canvas || !meta) return;
    if (balanceChartLegendHit(canvas, event)) {
      canvas.style.cursor = 'pointer';
      hideBalanceChartHover({ clearHover: false });
      canvas.style.cursor = 'pointer';
      return;
    }
    canvas.style.removeProperty('cursor');
    const rect = canvas.getBoundingClientRect();
    const modalRect = balanceChartModal.getBoundingClientRect();
    const drawWidth = Number(meta.cssWidth) || canvas.clientWidth || rect.width || 1;
    const drawHeight = Number(meta.cssHeight) || canvas.clientHeight || rect.height || 1;
    const scaleX = rect.width ? drawWidth / rect.width : 1;
    const scaleY = rect.height ? drawHeight / rect.height : 1;
    const localX = (event.clientX - rect.left) * scaleX;
    const localY = (event.clientY - rect.top) * scaleY;
    const insidePlot = localX >= meta.pad.left && localX <= meta.pad.left + meta.plotW
      && localY >= meta.pad.top && localY <= meta.pad.top + meta.plotH;
    if (!insidePlot) {
      hideBalanceChartHover();
      return;
    }
    balanceChartHoverPoint = { clientX: event.clientX, clientY: event.clientY };

    const ratio = (localX - meta.pad.left) / Math.max(1, meta.plotW);
    const time = meta.minTime + ratio * Math.max(1, meta.maxTime - meta.minTime);
    const values = balanceValuesAtTime(meta.points, time);
    const line = balanceChartModal.querySelector('.balance-chart-hover-line');
    const tooltip = balanceChartModal.querySelector('.balance-chart-tooltip');
    if (!line || !tooltip) return;

    line.classList.add('visible');
    const cssX = rect.left + (localX / drawWidth) * rect.width;
    const cssPlotTop = rect.top + (meta.pad.top / drawHeight) * rect.height;
    const cssPlotHeight = (meta.plotH / drawHeight) * rect.height;
    const modalLocalX = cssX - modalRect.left;
    line.style.left = `${modalLocalX}px`;
    line.style.top = `${cssPlotTop - modalRect.top}px`;
    line.style.height = `${cssPlotHeight}px`;
    const tooltipRows = BALANCE_CHART_SERIES
      .filter(series => balanceChartVisibleSeries[series.key])
      .map(series => (
        `<div><span class="balance-chart-tooltip-swatch balance-chart-tooltip-swatch-${series.key}"></span>${escapeHtml(series.label)} ${escapeHtml(formatBalanceTooltipValue(values[series.key], meta.unit))}</div>`
      ))
      .join('');
    tooltip.innerHTML = `
      <div class="balance-chart-tooltip-date">${escapeHtml(formatBalanceTickDate(new Date(time * 1000)))}</div>
      ${tooltipRows || '<div>No visible lines</div>'}
    `;
    tooltip.classList.add('visible');
    const tooltipWidth = tooltip.offsetWidth || 180;
    const tooltipHeight = tooltip.offsetHeight || 74;
    const gap = 12;
    const modalWidth = modalRect.width || window.innerWidth;
    const modalHeight = modalRect.height || window.innerHeight;
    const plotRight = rect.left + ((meta.pad.left + meta.plotW) / drawWidth) * rect.width - modalRect.left;
    const rightOfDate = modalLocalX + gap;
    const leftOfDate = modalLocalX - gap - tooltipWidth;
    const rightFitsBeforeCurrentDate = rightOfDate + tooltipWidth <= Math.min(plotRight, modalWidth - 10);
    const left = rightFitsBeforeCurrentDate
      ? rightOfDate
      : Math.max(10, leftOfDate);
    const plotBottom = cssPlotTop - modalRect.top + cssPlotHeight;
    const maxTop = Math.max(10, Math.min(modalHeight - tooltipHeight - 10, plotBottom - tooltipHeight - gap));
    const top = Math.max(10, Math.min(event.clientY - modalRect.top - tooltipHeight / 2, maxTop));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function renderCoinInfo(entries) {
    if (!coinInfoPanel) return;
    currentTrackerEntries = Array.isArray(entries) ? entries : [];
    if (currentTrackerEntries.some(entry => entry?.gradedRecord)) {
      currentGradedTrackerEntries = currentTrackerEntries;
    }
    const precalculatedInfo = precalculatedRightPanelInfo();
    if (precalculatedInfo) {
      const rows = currentChartRows(entries);
      const keepEmptyChartThumb = !allItemsSelected() && (activeCoin().nonFundedStats || isMuleCoin(activeCoin()));
      coinInfoPanel.innerHTML = rightPanelTableHtml(precalculatedInfo) + balanceChartHtml(rows, { keepEmpty: keepEmptyChartThumb }) + selectedCoinDetailHtml(rows);
      renderBalanceChartThumbnail(rows);
      renderSelectedPriceChartPreview();
      syncGradedMediaViewer(rows);
      updateSidePanelLayouts();
      return;
    }
    if (allItemsSelected()) {
      const rows = entries;
      const active = rows.filter(isActiveStatus).length;
      const redeemed = rows.filter(isRedeemedStatus).length;
      const unfunded = rows.filter(isUnfundedStatus).length;
      const funded = active + redeemed;
      const unfundedRow = unfunded
        ? `<tr><th><span class="info-label-dot info-label-dot-unfunded"></span>Unfunded</th><td>${escapeHtml(formatInteger(unfunded))}</td></tr>`
        : '';
      const firstCreated = rows
        .filter(entry => Number.isFinite(entry.createBlock) || Number.isFinite(entry.createTime))
        .sort((a, b) => (a.createBlock || Infinity) - (b.createBlock || Infinity) || (a.createTime || Infinity) - (b.createTime || Infinity))[0];
      const latestRedeemed = rows
        .filter(entry => Number.isFinite(entry.redeemTime) || Number.isFinite(entry.redeemBlock))
        .sort((a, b) => (b.redeemTime || 0) - (a.redeemTime || 0) || (b.redeemBlock || 0) - (a.redeemBlock || 0))[0];
      coinInfoPanel.innerHTML = `
        <table class="info-table">
          <tbody>
            <tr><th><span class="info-label-dot info-label-dot-minted"></span>Funded</th><td>${escapeHtml(formatInteger(funded))}</td></tr>
            <tr><th><span class="info-label-dot info-label-dot-active"></span>Active</th><td>${formatCountShare(active, funded)}</td></tr>
            <tr><th><span class="info-label-dot info-label-dot-redeemed"></span>Redeemed</th><td>${formatCountShare(redeemed, funded)}</td></tr>
            ${unfundedRow}
            <tr><th>First Funding</th><td>${escapeHtml(formatBlockDay(firstCreated?.createBlock, firstCreated?.createTime))}</td></tr>
            <tr><th>Last Redeem</th><td>${escapeHtml(formatBlockDay(latestRedeemed?.redeemBlock, latestRedeemed?.redeemTime))}</td></tr>
          </tbody>
        </table>
      ` + balanceChartHtml(rows) + selectedCoinDetailHtml(rows);
      renderBalanceChartThumbnail(rows);
      renderSelectedPriceChartPreview();
      syncGradedMediaViewer(rows);
      updateSidePanelLayouts();
      return;
    }
    const coin = activeCoin();
    const rows = statsRowsForCoin(entries, coin);
    const statuses = rows.reduce((counts, entry) => {
      const status = statusKey(entry) || 'unknown';
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
    const active = statuses.active || 0;
    const redeemed = statuses.redeemed || 0;
    const unfunded = (statuses.unfunded || 0) + (statuses.unloaded || 0);
    const funded = active + redeemed;
    const firstCreated = rows
      .filter(entry => Number.isFinite(entry.createBlock) || Number.isFinite(entry.createTime))
      .sort((a, b) => (a.createBlock || Infinity) - (b.createBlock || Infinity) || (a.createTime || Infinity) - (b.createTime || Infinity))[0];
    const latestRedeemed = rows
      .filter(entry => Number.isFinite(entry.redeemTime) || Number.isFinite(entry.redeemBlock))
      .sort((a, b) => (b.redeemTime || 0) - (a.redeemTime || 0) || (b.redeemBlock || 0) - (a.redeemBlock || 0))[0];
    const showDashStats = coin.nonFundedStats || isMuleCoin(coin);
    const statsText = showDashStats ? {
      minted: '—',
      active: '—',
      redeemed: '—'
    } : {
      minted: formatInteger(funded),
      active: formatCountShare(active, funded),
      redeemed: formatCountShare(redeemed, funded)
    };
    const statsCells = showDashStats ? {
      minted: escapeHtml(statsText.minted),
      active: escapeHtml(statsText.active),
      redeemed: escapeHtml(statsText.redeemed)
    } : statsText;
    const mintageNote = MINTAGE_NOTES[coin.slug] || '';
    if (mintageNote && !coin.nonFundedStats) {
      statsCells.minted = `${statsCells.minted}<span class="info-note-mark">*</span>`;
    }
    const noteRow = mintageNote
      ? `<tr class="info-note-row"><td colspan="2"><span class="info-note-mark">*</span>${escapeHtml(mintageNote)}</td></tr>`
      : '';
    const unfundedRow = !showDashStats && unfunded
      ? `<tr><th><span class="info-label-dot info-label-dot-unfunded"></span>Unfunded</th><td>${escapeHtml(formatInteger(unfunded))}</td></tr>`
      : '';

    coinInfoPanel.innerHTML = `
      <table class="info-table">
        <tbody>
          <tr><th><span class="info-label-dot info-label-dot-minted"></span>Funded</th><td>${statsCells.minted}</td></tr>
          <tr><th><span class="info-label-dot info-label-dot-active"></span>Active</th><td>${statsCells.active}</td></tr>
          <tr><th><span class="info-label-dot info-label-dot-redeemed"></span>Redeemed</th><td>${statsCells.redeemed}</td></tr>
          ${unfundedRow}
          <tr><th>First Funding</th><td>${escapeHtml(formatBlockDay(firstCreated?.createBlock, firstCreated?.createTime))}</td></tr>
          <tr><th>Last Redeem</th><td>${escapeHtml(formatBlockDay(latestRedeemed?.redeemBlock, latestRedeemed?.redeemTime))}</td></tr>
          ${noteRow}
        </tbody>
      </table>
    ` + balanceChartHtml(rows, { keepEmpty: showDashStats }) + selectedCoinDetailHtml(rows);
    renderBalanceChartThumbnail(rows);
    renderSelectedPriceChartPreview();
    syncGradedMediaViewer(rows);
    updateSidePanelLayouts();
  }

  function refreshDataPanels() {
    if (!recentSpendsPanel || !coinInfoPanel) return;
    const token = ++panelRenderToken;
    const slug = activeSlug;
    leftPanelRowsCache.clear();
    leftDataPanel?.classList.remove('data-ready');
    for (const mode of LEFT_PANEL_MODES) leftPanelScrollTopByMode[mode] = 0;
    resetLeftPanelPagination();
    recentSpendsPanel.scrollTop = 0;
    if (recentSpendsView) recentSpendsView.innerHTML = '<div class="panel-empty">Loading…</div>';
    if (activeCoinsView) activeCoinsView.innerHTML = '<div class="panel-empty">Loading…</div>';
    if (gradedCoinsView) gradedCoinsView.innerHTML = '<div class="panel-empty">Loading…</div>';
    updateLeftPanelCounts(null);
    syncLeftPanelHeader();
    renderCoinInfo([]);
    trackerIndex().then(entries => {
      if (token !== panelRenderToken || slug !== activeSlug) return;
      updateLeftPanelCounts(entries);
      refreshingLeftPanelData = true;
      renderRecentSpends(entries);
      renderActiveCoins(entries);
      refreshingLeftPanelData = false;
      const restoredAllItemsSelection = restoreSavedAllItemsSelection(entries);
      if (allItemsMode && allItemsSelectionRestorePending === false && !restoredAllItemsSelection) {
        syncAllItemsLeftPanelSelectionToCentered({ mode: leftPanelMode, render: true, save: true });
      }
      renderCoinInfo(entries);
      syncLeftPanelMode();
      requestAnimationFrame(() => {
        if (token !== panelRenderToken || slug !== activeSlug) return;
        updateLeftPanelLayout();
        leftDataPanel?.classList.add('data-ready');
      });
      const shouldHydrateGraded = leftPanelMode === 'graded'
        || activeChartModalMode === 'price'
        || Boolean(selectedLeftPanelAddressByMode.graded)
        || selectedAddressHasGradedMedia(entries);
      if (shouldHydrateGraded) {
        trackerIndexWithGraded().then(gradedEntries => {
          if (token !== panelRenderToken || slug !== activeSlug) return;
          leftPanelRowsCache.clear();
          updateLeftPanelCounts(gradedEntries);
          refreshingLeftPanelData = true;
          renderGradedCoins(gradedEntries);
          refreshingLeftPanelData = false;
          renderCoinInfo(gradedEntries);
          redrawOpenBalanceChart();
          syncLeftPanelHeader();
          if (leftPanelMode === 'graded') syncLeftPanelMode();
          requestAnimationFrame(() => {
            if (token !== panelRenderToken || slug !== activeSlug) return;
            updateLeftPanelLayout();
          });
        });
      } else if (gradedCoinsView) {
        leftPanelRowsByMode.graded = [];
        renderLeftPanelRows('graded');
      }
    });
  }

  function sidePanelsAllowed() {
    return true;
  }

  function rightPanelTitleHtml(title) {
    const displayTitle = String(title || '');
    const match = displayTitle.match(/^(.*\bSeries\s+[\d.]+)\s+(.+)$/i);
    if (!match) return escapeHtml(displayTitle);
    return `<span class="coin-name-line-part">${escapeHtml(match[1])}</span><span class="coin-name-line-part">${escapeHtml(match[2])}</span>`;
  }

  function setSelectedTitle(title, spec = '') {
    const displayTitle = String(title || '');
    if (rightPanelCoinName) {
      rightPanelCoinName.dataset.titleText = displayTitle;
      rightPanelCoinName.textContent = displayTitle;
      updateRightPanelTitleWrap();
    }
  }

  function updateRightPanelTitleWrap() {
    if (!rightPanelCoinName) return;
    const displayTitle = rightPanelCoinName.dataset.titleText || rightPanelCoinName.textContent || '';
    const canPreferBreak = /\bSeries\s+[\d.]+\s+.+/i.test(displayTitle);
    if (!canPreferBreak) {
      rightPanelCoinName.classList.remove('coin-name-preferred-break');
      rightPanelCoinName.textContent = displayTitle;
      return;
    }
    rightPanelCoinName.classList.remove('coin-name-preferred-break');
    rightPanelCoinName.textContent = displayTitle;
    const availableWidth = rightPanelCoinName.clientWidth;
    const contentWidth = rightPanelCoinName.scrollWidth;
    const needsBreak = availableWidth > 0 && contentWidth > availableWidth + 1;
    if (needsBreak) {
      rightPanelCoinName.innerHTML = rightPanelTitleHtml(displayTitle);
      rightPanelCoinName.classList.add('coin-name-preferred-break');
    }
  }

  function syncCoinNamePlacement() {
    const showRightTitle = sidePanelsAllowed() && rightPanelOpen;
    rightPanelCoinName?.classList.toggle('open', showRightTitle);
    rightPanelCoinName?.setAttribute('aria-hidden', String(!showRightTitle));
  }

  function updateMeasuredPanelLayout(panel, body, topProperty, heightProperty, minTop, { alignTop = false, bodyHeight = null, fitNaturalHeight = false } = {}) {
    if (!panel) return;
    const bottomMargin = parseFloat(getComputedStyle(root).getPropertyValue('--side-panel-bottom')) || 0;
    const availableHeight = Math.max(96, window.innerHeight - minTop - bottomMargin);
    const headerHeight = panel.querySelector('.data-panel-header')?.offsetHeight || 0;
    const measuredBodyHeight = Number.isFinite(bodyHeight) ? bodyHeight : (body?.scrollHeight || 0);
    const fallbackNaturalHeight = fitNaturalHeight ? 0 : (panel.scrollHeight || panel.getBoundingClientRect().height || 0);
    const naturalHeight = Math.max(0, headerHeight + measuredBodyHeight, fallbackNaturalHeight);
    const panelHeight = Math.min(naturalHeight || availableHeight, availableHeight);
    const centeredTop = (window.innerHeight - panelHeight) / 2;
    const top = alignTop ? minTop : Math.max(minTop, centeredTop);
    root.style.setProperty(topProperty, `${Math.ceil(top)}px`);
    const maxHeight = Math.min(panelHeight, Math.floor(window.innerHeight - top - bottomMargin));
    root.style.setProperty(heightProperty, `${Math.max(96, Math.floor(maxHeight))}px`);
  }

  function versionPanelBottom() {
    const rect = versionTabs?.getBoundingClientRect();
    if (!rect) return tabs?.getBoundingClientRect()?.bottom ?? 178;
    const { activeHeight, expandedHeight } = versionPanelMetrics();
    const targetHeight = versionsCollapsed ? activeHeight : expandedHeight;
    return rect.top + Math.max(0, targetHeight || rect.height);
  }

  function topControlsBottom() {
    const tabBottom = tabs?.getBoundingClientRect()?.bottom ?? topbar?.getBoundingClientRect()?.bottom ?? 178;
    return tabBottom;
  }

  function leftPanelControlsBottom() {
    const tabBottom = topControlsBottom();
    if (!versionTabs?.children.length || allItemsMode) return tabBottom;
    return Math.max(tabBottom, versionPanelBottom());
  }

  function updateSecondaryPanelWidth(leftWidth = 0) {
    if (sidePanelsAllowed() && leftPanelOpen && Number.isFinite(leftWidth) && leftWidth > 0) {
      const panelSideMargin = parseFloat(getComputedStyle(root).getPropertyValue('--panel-side-margin')) || 0;
      root.style.setProperty('--secondary-nav-button-width', `${Math.max(0, Math.ceil(leftWidth - panelSideMargin))}px`);
    } else {
      root.style.removeProperty('--secondary-nav-button-width');
    }
  }

  function updateSidePanelLayouts() {
    const allowSidePanels = sidePanelsAllowed();
    const fallbackSideWidth = sidePanelFallbackWidth();
    if (!versionTabs?.children.length && !allItemsMode) {
      const leftWidth = syncMatchedSidePanelWidth(fallbackSideWidth);
      updateSecondaryPanelWidth(allowSidePanels && leftPanelOpen ? leftWidth : 0);
      leftDataPanel?.classList.remove('position-ready');
      return;
    }
    const panelGap = 0;
    const leftMinTop = Math.max(0, leftPanelControlsBottom() + panelGap);
    const rightMinTop = Math.max(0, topControlsBottom() + panelGap);
    updateMeasuredPanelLayout(leftDataPanel, recentSpendsPanel, '--left-panel-top', '--left-panel-max-height', leftMinTop, {
      alignTop: true,
      bodyHeight: leftPanelBodyNaturalHeight(),
      fitNaturalHeight: true
    });
    const leftWidth = syncMatchedSidePanelWidth(fallbackSideWidth);
    updateSecondaryPanelWidth(allowSidePanels && leftPanelOpen ? leftWidth : 0);
    if (Number.isFinite(leftWidth) && leftWidth > 0) {
      root.style.setProperty('--recent-spends-panel-width', `${Math.ceil(leftWidth)}px`);
    }
    updateRightPanelTitleWrap();
    updateMeasuredPanelLayout(rightDataPanel, coinInfoPanel, '--right-panel-top', '--right-panel-max-height', rightMinTop);
    leftDataPanel?.classList.add('position-ready');
  }

  function updateLeftPanelLayout() {
    updateDockedPanelLayout();
    updateSidePanelLayouts();
    if (updateLeftPanelScrollbarGutter()) {
      updateSidePanelLayouts();
    }
    if (!leftPanelMeasureMode) {
      clampLeftPanelScroll();
      saveLeftPanelScroll();
    }
    updateDockedPanelLayout();
  }

  function panelWidth(panel, fallback = 0) {
    if (!panel) return fallback;
    const rect = panel.getBoundingClientRect();
    const width = rect.width || panel.offsetWidth || fallback;
    return Number.isFinite(width) ? Math.max(0, Math.ceil(width)) : fallback;
  }

  function sidePanelMaxWidth() {
    return Math.max(0, window.innerWidth * 0.5);
  }

  function sidePanelFallbackWidth() {
    return Math.min(340, window.innerWidth * 0.36, sidePanelMaxWidth());
  }

  function syncMatchedSidePanelWidth(fallback = sidePanelFallbackWidth()) {
    const width = panelWidth(leftDataPanel, fallback) || fallback;
    const matchedWidth = Math.min(sidePanelMaxWidth(), Number.isFinite(width) && width > 0 ? Math.ceil(width) : fallback);
    root.style.setProperty('--matched-side-panel-width', `${matchedWidth}px`);
    return matchedWidth;
  }

  function measureControlsOneLine(compact) {
    if (!controls) return 0;
    const wasCompact = root.classList.contains('bottom-controls-compact');
    root.classList.toggle('bottom-controls-compact', compact);
    controls.classList.add('measure-nowrap');
    const width = Math.ceil(Math.max(controls.scrollWidth || 0, controls.getBoundingClientRect().width || 0));
    controls.classList.remove('measure-nowrap');
    root.classList.toggle('bottom-controls-compact', wasCompact);
    return width;
  }

  function updateDockedPanelLayout() {
    const allowSidePanels = sidePanelsAllowed();
    const leftActive = allowSidePanels && leftPanelOpen;
    const rightActive = allowSidePanels && rightPanelOpen;
    const fallbackSideWidth = sidePanelFallbackWidth();
    const matchedSideWidth = syncMatchedSidePanelWidth(fallbackSideWidth);
    const leftWidth = leftActive ? matchedSideWidth : 0;
    const rightWidth = rightActive ? matchedSideWidth : 0;
    const betweenWidth = Math.max(0, window.innerWidth - leftWidth - rightWidth);
    updateSecondaryPanelWidth(leftWidth);

    let compactControls = root.classList.contains('bottom-controls-compact');
    let fullWidthBottom = root.classList.contains('bottom-panel-full-width');
    if (bottomPanelOpen) {
      compactControls = false;
      fullWidthBottom = false;
      const fullControlsWidth = measureControlsOneLine(false);
      if (fullControlsWidth > betweenWidth) {
        compactControls = true;
        fullWidthBottom = measureControlsOneLine(true) > betweenWidth;
      }
    }

    if (!bottomPanelClosing) {
      root.classList.toggle('bottom-controls-compact', compactControls);
      root.classList.toggle('bottom-panel-full-width', fullWidthBottom);
    }
    root.style.setProperty('--left-reserved-space', `${leftWidth}px`);
    root.style.setProperty('--right-reserved-space', `${rightWidth}px`);
    if (!bottomPanelClosing) {
      root.style.setProperty('--bottom-panel-left', `${bottomPanelOpen && !fullWidthBottom ? leftWidth : 0}px`);
      root.style.setProperty('--bottom-panel-right', `${bottomPanelOpen && !fullWidthBottom ? rightWidth : 0}px`);
    }

    const bottomHeight = effectiveBottomPanelHeight();
    root.style.setProperty('--bottom-reserved-space', `${bottomHeight}px`);
    root.style.setProperty('--side-panel-bottom', `${bottomPanelCountsForViewport() && fullWidthBottom ? bottomHeight : 0}px`);
    updateBalanceChartModalBounds(leftWidth, rightWidth);
    scheduleOpenBalanceChartRedraw();
    if (allItemsMode && allItemsBuilt) {
      syncAllItemsTargetCursor();
      if (!suppressAllItemsQuarterDockUpdate) updateAllItemsQuarterPlacement();
    } else {
      updateSingleItemViewportCenter();
    }
  }

  function updateBalanceChartModalBounds(leftWidth = null, rightWidth = null) {
    const allowSidePanels = sidePanelsAllowed();
    const fallbackSideWidth = sidePanelFallbackWidth();
    const matchedSideWidth = parseFloat(getComputedStyle(root).getPropertyValue('--matched-side-panel-width')) || fallbackSideWidth;
    let left = Number.isFinite(leftWidth) && leftWidth !== null
      ? leftWidth
      : (allowSidePanels && leftPanelOpen ? matchedSideWidth : 0);
    let right = Number.isFinite(rightWidth) && rightWidth !== null
      ? rightWidth
      : (allowSidePanels && rightPanelOpen ? matchedSideWidth : 0);
    const minChartWidth = 240;
    const minChartHeight = 220;
    const maxSideReserve = Math.max(0, window.innerWidth - minChartWidth);
    const sideReserve = Math.max(0, left + right);
    if (sideReserve > maxSideReserve && sideReserve > 0) {
      const scale = maxSideReserve / sideReserve;
      left *= scale;
      right *= scale;
    }
    const preferredTop = Math.max(0, Math.ceil(topControlsBottom()));
    const top = Math.min(preferredTop, Math.max(0, window.innerHeight - minChartHeight));
    root.style.setProperty('--balance-chart-left', `${Math.max(0, Math.ceil(left))}px`);
    root.style.setProperty('--balance-chart-right', `${Math.max(0, Math.ceil(right))}px`);
    root.style.setProperty('--balance-chart-top', `${top}px`);
    root.style.setProperty('--balance-chart-bottom', '0px');
  }

  function redrawOpenBalanceChart() {
    if (!balanceChartModal?.classList.contains('open')) return;
    const unit = activeChartModalMode === 'price' ? priceChartUnit : balanceChartUnit;
    const needsDailyPrices = (activeChartModalMode === 'price' || unit === 'usd') && !dailyPriceIndexCache;
    const needsSeriesPrices = activeChartModalMode === 'price' && !seriesPriceIndexCache;
    const needsGradedEntries = activeChartModalMode === 'price' && !currentGradedTrackerEntries.length;
    if (needsDailyPrices || needsSeriesPrices || needsGradedEntries) {
      Promise.all([
        needsDailyPrices ? dailyPriceIndex() : Promise.resolve(dailyPriceIndexCache),
        needsSeriesPrices ? seriesPriceIndex() : Promise.resolve(seriesPriceIndexCache),
        needsGradedEntries ? trackerIndexWithGraded() : Promise.resolve(currentGradedTrackerEntries)
      ]).then(([, , gradedEntries]) => {
        if (Array.isArray(gradedEntries) && gradedEntries.some(entry => entry?.gradedRecord)) {
          currentGradedTrackerEntries = gradedEntries;
        }
        const stillNeedsPriceRedraw = activeChartModalMode === 'price';
        const stillNeedsBalanceUsdRedraw = activeChartModalMode === 'balance' && balanceChartUnit === 'usd';
        if ((stillNeedsPriceRedraw || stillNeedsBalanceUsdRedraw) && balanceChartModal?.classList.contains('open')) {
          redrawOpenBalanceChart();
        }
      });
      return;
    }
    const canvas = balanceChartModal.querySelector('.balance-chart-full-canvas');
    if (activeChartModalMode === 'price') {
      drawSelectedPriceChart(canvas, selectedPriceChartEntry(currentBalanceChartRows), {
        compact: false,
        unit,
        scale: priceChartScale
      });
      refreshBalanceChartHover();
      return;
    }
    drawBalanceChart(canvas, currentBalanceChartRows, {
      compact: false,
      unit
    });
    refreshBalanceChartHover();
  }

  document.addEventListener('casascius-theme-change', () => {
    redrawBalanceChartThumbnail();
    renderSelectedPriceChartPreview();
    redrawOpenBalanceChart();
  });

  function scheduleOpenBalanceChartRedraw() {
    if (!balanceChartModal?.classList.contains('open')) return;
    if (balanceChartRedrawRaf) cancelAnimationFrame(balanceChartRedrawRaf);
    balanceChartRedrawRaf = requestAnimationFrame(() => {
      balanceChartRedrawRaf = 0;
      redrawOpenBalanceChart();
    });
  }

  function primeBottomPanelOpenPosition() {
    if (!bottomStack) return;
    const allowSidePanels = sidePanelsAllowed();
    const fallbackSideWidth = sidePanelFallbackWidth();
    const matchedSideWidth = syncMatchedSidePanelWidth(fallbackSideWidth);
    const leftWidth = allowSidePanels && leftPanelOpen ? matchedSideWidth : 0;
    const rightWidth = allowSidePanels && rightPanelOpen ? matchedSideWidth : 0;
    const betweenWidth = Math.max(0, window.innerWidth - leftWidth - rightWidth);
    let compactControls = false;
    let fullWidthBottom = false;
    const fullControlsWidth = measureControlsOneLine(false);
    if (fullControlsWidth > betweenWidth) {
      compactControls = true;
      fullWidthBottom = measureControlsOneLine(true) > betweenWidth;
    }

    root.classList.toggle('bottom-controls-compact', compactControls);
    root.classList.toggle('bottom-panel-full-width', fullWidthBottom);
    bottomStack.classList.add('instant-dock');
    root.style.setProperty('--bottom-panel-left', `${fullWidthBottom ? 0 : leftWidth}px`);
    root.style.setProperty('--bottom-panel-right', `${fullWidthBottom ? 0 : rightWidth}px`);
    const bottomHeight = effectiveBottomPanelHeight();
    root.style.setProperty('--bottom-reserved-space', `${bottomHeight}px`);
    root.style.setProperty('--side-panel-bottom', `${fullWidthBottom ? bottomHeight : 0}px`);
    bottomStack.getBoundingClientRect();
  }

  function syncPanelToggles() {
    const allowSidePanels = sidePanelsAllowed();
    leftPanelBtn?.classList.toggle('is-open', allowSidePanels && leftPanelOpen);
    leftPanelBtn?.setAttribute('aria-expanded', String(allowSidePanels && leftPanelOpen));
    leftPanelBtn?.toggleAttribute('disabled', !allowSidePanels);
    leftDataPanel?.classList.toggle('open', allowSidePanels && leftPanelOpen);
    rightPanelBtn?.classList.toggle('is-open', allowSidePanels && rightPanelOpen);
    rightPanelBtn?.setAttribute('aria-expanded', String(allowSidePanels && rightPanelOpen));
    rightPanelBtn?.toggleAttribute('disabled', !allowSidePanels);
    rightDataPanel?.classList.toggle('open', allowSidePanels && rightPanelOpen);
    syncCoinNamePlacement();
    bottomPanelBtn?.classList.toggle('is-open', bottomPanelOpen);
    bottomPanelBtn?.setAttribute('aria-expanded', String(bottomPanelOpen));
    bottomPanelBtn?.setAttribute('aria-label', bottomPanelOpen ? 'Hide bottom controls panel' : 'Show bottom controls panel');
    bottomStack?.classList.toggle('is-hidden', !bottomPanelOpen);
    updateBottomReservedSpace();
    updateLeftPanelLayout();
    updateComparisonSpacing();
  }

  function settleInitialPanelLayout(callback) {
    let frames = 0;
    const step = () => {
      updateDockedPanelLayout();
      updateSidePanelLayouts();
      updateDockedPanelLayout();
      frames += 1;
      if (frames < 3) {
        requestAnimationFrame(step);
        return;
      }
      callback?.();
    };
    requestAnimationFrame(step);
  }

  function animatePanelLayoutChange(applyChange, { layoutDurationMs = 480 } = {}) {
    const previousSceneLayout = allItemsMode ? null : captureSceneLayout();
    const previousQuarterLayout = captureQuarterLayout();
    const previousAllItemsViewport = captureAllItemsViewportLayout();
    suppressAllItemsQuarterDockUpdate = allItemsMode;
    try {
      applyChange();
    } finally {
      suppressAllItemsQuarterDockUpdate = false;
    }
    if (allItemsMode) {
      slideAllItemsViewportFrom(previousAllItemsViewport);
    } else {
      const playSceneLayoutAnimation = prepareSceneLayoutAnimation(previousSceneLayout, layoutDurationMs);
      if (playSceneLayoutAnimation) playSceneLayoutAnimation();
    }
    if (!allItemsMode) {
      const playQuarterLayoutAnimation = prepareQuarterLayoutAnimation(previousQuarterLayout, layoutDurationMs);
      if (playQuarterLayoutAnimation) playQuarterLayoutAnimation();
    }
  }

  function toggleBottomPanelWithLayoutAnimation() {
    const closing = bottomPanelOpen;
    clearTimeout(bottomPanelClosingTimer);
    clearTimeout(bottomPanelOpeningDockTimer);
    if (closing) bottomStack?.classList.remove('instant-dock');
    bottomPanelClosing = closing;
    animatePanelLayoutChange(() => {
      if (!closing) primeBottomPanelOpenPosition();
      bottomPanelOpen = !bottomPanelOpen;
      if (bottomPanelOpen) bottomPanelClosing = false;
      savePanelState();
      syncPanelToggles();
    });
    if (!closing) {
      bottomPanelOpeningDockTimer = setTimeout(() => {
        bottomStack?.classList.remove('instant-dock');
      }, 360);
    }
    if (closing) {
      bottomPanelClosingTimer = setTimeout(() => {
        bottomPanelClosing = false;
        updateDockedPanelLayout();
      }, 340);
    }
  }

  function toggleRightPanelWithLayoutAnimation() {
    animatePanelLayoutChange(() => {
      rightPanelOpen = !rightPanelOpen;
      savePanelState();
      syncPanelToggles();
    }, { layoutDurationMs: 240 });
  }

  function toggleLeftPanelWithLayoutAnimation() {
    animatePanelLayoutChange(() => {
      leftPanelOpen = !leftPanelOpen;
      savePanelState();
      syncPanelToggles();
    });
  }

  function toggleAllPanelsWithLayoutAnimation() {
    const sidePanelsOpen = sidePanelsAllowed() && (leftPanelOpen || rightPanelOpen);
    const anyPanelOpen = sidePanelsOpen || bottomPanelOpen;
    clearTimeout(bottomPanelClosingTimer);
    clearTimeout(bottomPanelOpeningDockTimer);
    if (anyPanelOpen && bottomPanelOpen) bottomStack?.classList.remove('instant-dock');
    bottomPanelClosing = anyPanelOpen && bottomPanelOpen;
    animatePanelLayoutChange(() => {
      if (!anyPanelOpen) primeBottomPanelOpenPosition();
      leftPanelOpen = !anyPanelOpen;
      rightPanelOpen = !anyPanelOpen;
      bottomPanelOpen = !anyPanelOpen;
      if (bottomPanelOpen) bottomPanelClosing = false;
      savePanelState();
      syncPanelToggles();
    });
    if (!anyPanelOpen) {
      bottomPanelOpeningDockTimer = setTimeout(() => {
        bottomStack?.classList.remove('instant-dock');
      }, 360);
    }
    if (bottomPanelClosing) {
      bottomPanelClosingTimer = setTimeout(() => {
        bottomPanelClosing = false;
        updateDockedPanelLayout();
      }, 340);
    }
  }

  function renderSearchedAddress(coin, address) {
    const firstbits = String(address || '').slice(0, 8);
    if (!firstbits) return;
    if (coin.shape === 'bar') {
      renderBarAddress(firstbits, coin);
      return;
    }
    model.classList.add('coin-back-address-active');
    renderCoinBackAddress(firstbits, coin);
  }

  async function runAddressSearch() {
    if (!addressSearchInput) return;
    const query = addressSearchInput.value;
    const entries = await trackerIndexWithGraded();
    const trackerEntry = entries.find(entry => addressValueMatches(query, entry.address));
    const unfundedEntry = trackerEntry ? null : (await unfundedIndex()).find(entry => addressValueMatches(query, entry.address));
    const match = trackerEntry
      ? { coin: COINS.find(c => c.slug === trackerEntry.slug), address: trackerEntry.address, entry: trackerEntry }
      : findEmbeddedCoinByAddress(query);
    addressSearchInput.classList.toggle('search-miss', Boolean(addressSearchInput.value.trim()) && !match && !unfundedEntry);
    if (unfundedEntry && !match?.entry) {
      pendingSearchSelection = null;
      searchAddressNotFound = false;
      searchedUnfundedEntry = unfundedEntry;
      for (const mode of LEFT_PANEL_MODES) {
        selectedLeftPanelAddressByMode[mode] = '';
        renderLeftPanelRows(mode);
      }
      updateSelectedCoinDetailSection();
      refreshBalanceChartHover();
      const fallbackCoin = coinBySlug(unfundedEntry.slug) || coinBySlug('cas_1btc_2011_mule_demo') || activeCoin();
      renderSearchedAddress(fallbackCoin, unfundedEntry.address);
      return;
    }
    if (!match?.entry) {
      pendingSearchSelection = null;
      searchAddressNotFound = Boolean(addressSearchInput.value.trim());
      searchedUnfundedEntry = null;
      for (const mode of LEFT_PANEL_MODES) {
        selectedLeftPanelAddressByMode[mode] = '';
        renderLeftPanelRows(mode);
      }
      updateSelectedCoinDetailSection();
      refreshBalanceChartHover();
      return;
    }
    searchAddressNotFound = false;
    searchedUnfundedEntry = null;
    const targetMode = leftPanelModeForEntry(match.entry);
    const shouldStayInCurrentView = allItemsMode || entryBelongsToCoin(match.entry, activeCoin());
    pendingSearchSelection = {
      address: String(match.entry.address || ''),
      gradedRecordId: entryGradedRecordId(match.entry),
      mode: targetMode
    };
    const willTriggerRefresh = !shouldStayInCurrentView;
    if (willTriggerRefresh) {
      enterAllItemsMode({ align: true });
    }
    updateLeftPanelCounts(entries);
    applySearchSelectionToPanels(match.entry, entries, { centerAll: allItemsMode, scroll: true });
    if (!willTriggerRefresh) pendingSearchSelection = null;
    renderSearchedAddress(match.coin, match.address);
    if (!allItemsMode) setViewMode('hologram', { animate: false, coin: match.coin });
  }

  const ADDRESS_GLYPHS = {
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '00100'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    A:   ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    B:   ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    C:   ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
    E:   ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    G:   ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
    K:   ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    T:   ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    U:   ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    V:   ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    W:   ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
    Z:   ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
    b:   ['10000', '10000', '11110', '10001', '10001', '10001', '11110'],
    c:   ['00000', '00000', '01111', '10000', '10000', '10000', '01111'],
    e:   ['00000', '00000', '01110', '10001', '11111', '10000', '01111'],
    g:   ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
    j:   ['00100', '00000', '00100', '00100', '00100', '00100', '00100', '10100', '11000'],
    k:   ['10000', '10000', '10010', '10100', '11000', '10100', '10010'],
    n:   ['00000', '00000', '11110', '10001', '10001', '10001', '10001'],
    o:   ['00000', '00000', '01110', '10001', '10001', '10001', '01110'],
    p:   ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    q:   ['01111', '10001', '10001', '01111', '00001', '00001', '00001'],
    v:   ['00000', '00000', '10001', '10001', '10001', '01010', '00100'],
    w:   ['00000', '00000', '10001', '10001', '10101', '10101', '01010'],
    y:   ['10001', '10001', '10001', '01111', '00001', '00001', '01110']
  };
  Object.assign(ADDRESS_GLYPHS, {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    D:   ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    F:   ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    H:   ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    I:   ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    J:   ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    L:   ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M:   ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N:   ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O:   ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P:   ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    Q:   ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    R:   ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S:   ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    X:   ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    Y:   ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    a:   ['00000', '00000', '01110', '00001', '01111', '10001', '01111'],
    d:   ['00001', '00001', '01111', '10001', '10001', '10001', '01111'],
    f:   ['00110', '01001', '01000', '11100', '01000', '01000', '01000'],
    h:   ['10000', '10000', '11110', '10001', '10001', '10001', '10001'],
    i:   ['00100', '00000', '01100', '00100', '00100', '00100', '01110'],
    l:   ['01100', '00100', '00100', '00100', '00100', '00100', '01110'],
    m:   ['00000', '00000', '11010', '10101', '10101', '10101', '10101'],
    r:   ['00000', '00000', '10110', '11001', '10000', '10000', '10000'],
    s:   ['00000', '00000', '01111', '10000', '01110', '00001', '11110'],
    t:   ['01000', '01000', '11100', '01000', '01000', '01001', '00110'],
    u:   ['00000', '00000', '10001', '10001', '10001', '10011', '01101'],
    x:   ['00000', '00000', '10001', '01010', '00100', '01010', '10001'],
    z:   ['00000', '00000', '11111', '00010', '00100', '01000', '11111']
  });

  function appendOcrAddress(target, value) {
    [...value].forEach((char, charIndex) => {
      const rows = ADDRESS_GLYPHS[char] || ADDRESS_GLYPHS[char.toUpperCase()];
      if (!rows) return;
      const glyph = document.createElement('span');
      glyph.className = 'ocr-glyph';
      if ('gjpqy'.includes(char)) glyph.classList.add('descender');
      if (char === 'j') glyph.classList.add('descender-j');
      glyph.setAttribute('aria-hidden', 'true');
      rows.join('').split('').forEach((cell, pixelIndex) => {
        const pixel = document.createElement('i');
        const shouldBreak = (charIndex + pixelIndex) % 9 === 0;
        pixel.className = cell === '1' ? `ocr-pixel${shouldBreak ? ' skip' : ''}` : 'ocr-pixel skip';
        if (cell !== '1') pixel.style.visibility = 'hidden';
        glyph.appendChild(pixel);
      });
      target.appendChild(glyph);
    });
  }

  function renderBarAddress(value = '', coin = activeCoin()) {
    const isSeries2 = coin?.shape === 'bar' && Number(coin.version) === 2;
    barAddressOverlay.dataset.address = value;
    barAddressOverlay.classList.toggle('bar-address-series-2', isSeries2);
    barAddressOverlay.setAttribute('aria-label', value ? `Address ${value}` : '');
    barAddressOverlay.replaceChildren();
    if (!value) return;
    if (isSeries2) {
      const label = document.createElement('span');
      label.className = 'bar-address-text';
      label.textContent = `**${value}**`;
      barAddressOverlay.appendChild(label);
      return;
    }
    appendOcrAddress(barAddressOverlay, value);
  }

  function renderCoinBackAddress(value = '', coin = activeCoin()) {
    const useOcr = coin?.shape !== 'bar' && Number(coin.version) === 1 && coin?.slug !== 'cas_1000btc_gold';
    const coinVersion = Number(coin?.version);
    const useSeries2Text = coin?.shape !== 'bar' && coinVersion === 2;
    const usePlainSeries3Text = coin?.shape !== 'bar' && coinVersion === 3;
    const useTextAddress = useSeries2Text || usePlainSeries3Text;
    const use1BtcTextSize = [
      'cas_1btc_2011_s2',
      'cas_1btc_2012_s2',
      'cas_1btc_2013_brass',
      'cas_1btc_2013_gold_rim_silver',
      'cas_1btc_2013_silver'
    ].includes(coin?.slug);
    coinBackAddressOverlay.replaceChildren();
    coinBackAddressOverlay.classList.toggle('coin-address-ocr', useOcr);
    coinBackAddressOverlay.classList.toggle('coin-address-ocr-large', coin?.slug === 'cas_5btc_2012_bitnickel');
    coinBackAddressOverlay.classList.toggle('coin-address-ocr-xl', coin?.slug === 'cas_1btc_2011_s1');
    coinBackAddressOverlay.classList.toggle('coin-address-25btc-s1', coin?.slug === 'cas_25btc_2011_gp');
    coinBackAddressOverlay.classList.toggle('coin-address-series-2-text', useTextAddress);
    coinBackAddressOverlay.classList.toggle('coin-address-1btc-s2', use1BtcTextSize);
    coinBackAddressOverlay.classList.toggle('coin-address-series-3-text', usePlainSeries3Text);
    coinBackAddressOverlay.classList.toggle('coin-address-s3-gold-rim', coin?.slug === 'cas_1btc_2013_gold_rim_silver');
    coinBackAddressOverlay.classList.toggle('coin-address-s3-silver', coin?.slug === 'cas_1btc_2013_silver');
    coinBackAddressOverlay.classList.toggle('coin-address-10btc-s2', coin?.slug === 'cas_10btc_2012_silver');
    coinBackAddressOverlay.classList.toggle('coin-address-10btc-gold-b-s2', coin?.slug === 'cas_10btc_2012_silver_gold_b');
    coinBackAddressOverlay.classList.toggle('coin-address-25btc-s2', coin?.slug === 'cas_25btc_2011_gp_s2');
    coinBackAddressOverlay.classList.toggle('coin-address-0p1-s3', coin?.slug === 'cas_0p1btc_2013_silver_s3');
    coinBackAddressOverlay.classList.toggle('coin-address-0p5-silver-s3', coin?.slug === 'cas_0p5btc_2013_silver_s3');
    coinBackAddressOverlay.classList.toggle('coin-address-0p5-brass-s2', coin?.slug === 'cas_05btc_2013_brass');
    coinBackAddressOverlay.classList.toggle('coin-address-0p5-silver-s2', coin?.slug === 'cas_0p5btc_2013_silver_s25');
    coinBackAddressOverlay.setAttribute('aria-label', value ? `Address ${value}` : '');
    if (!value) return;
    if (useTextAddress) {
      const label = document.createElement('span');
      label.className = 'bar-address-text';
      label.textContent = usePlainSeries3Text ? value : `**${value}**`;
      coinBackAddressOverlay.appendChild(label);
      return;
    }
    if (useOcr) {
      appendOcrAddress(coinBackAddressOverlay, value);
      return;
    }
    const chars = [...value];
    const mid = (chars.length - 1) / 2;
    chars.forEach((char, index) => {
      const offset = index - mid;
      const el = document.createElement('span');
      el.className = 'coin-back-address-char';
      el.textContent = char;
      el.style.setProperty('--x', `${50 + offset * 10.7}%`);
      el.style.setProperty('--y', `${42 + Math.abs(offset) ** 1.8 * 1.25}%`);
      el.style.setProperty('--r', `${offset * 4.3}deg`);
      coinBackAddressOverlay.appendChild(el);
    });
  }

  function applyDimensions(c) {
    const base = baseObjectSizePx();
    const thicknessPx = base * Number(c.thicknessMm || 2.5) / MAX_PHYSICAL_MM;
    if (c.shape === 'bar') {
      const w = base * Number(c.widthMm || 40) / MAX_PHYSICAL_MM;
      const h = base * Number(c.heightMm || 80) / MAX_PHYSICAL_MM;
      const radius = w * 0.12;
      root.style.setProperty('--object-w', `${w.toFixed(2)}px`);
      root.style.setProperty('--object-h', `${h.toFixed(2)}px`);
      root.style.setProperty('--face-radius', `${radius.toFixed(2)}px`);
    } else {
      const size = base * Number(c.diameterMm || MAX_PHYSICAL_MM) / MAX_PHYSICAL_MM;
      root.style.setProperty('--object-w', `${size.toFixed(2)}px`);
      root.style.setProperty('--object-h', `${size.toFixed(2)}px`);
      root.style.setProperty('--face-radius', '50%');
    }
    root.style.setProperty('--thickness', `${thicknessPx.toFixed(2)}px`);
    applyQuarterDimensions();
    updateBottomReservedSpace();
    updateComparisonSpacing();
  }

  function applyQuarterDimensions() {
    const base = baseObjectSizePx();
    const sizePx = base * QUARTER_DIAMETER_MM / MAX_PHYSICAL_MM;
    const thicknessPx = base * QUARTER_THICKNESS_MM / MAX_PHYSICAL_MM;
    root.style.setProperty('--quarter-size', `${sizePx.toFixed(2)}px`);
    root.style.setProperty('--quarter-thickness', `${thicknessPx.toFixed(2)}px`);
  }

  function updateBottomReservedSpace() {
    const topSpace = Math.max(0, topControlsBottom());
    root.style.setProperty('--top-reserved-space', `${Math.ceil(topSpace)}px`);

    const sidePanelTop = Math.max(0, topControlsBottom());
    root.style.setProperty('--side-panel-top', `${Math.ceil(sidePanelTop)}px`);

    updateDockedPanelLayout();
    updateLeftPanelLayout();
    updateDockedPanelLayout();
  }

  function appContentSpace() {
    const styles = getComputedStyle(app);
    return {
      width: Math.max(0, window.innerWidth - parseFloat(styles.paddingLeft || 0) - parseFloat(styles.paddingRight || 0)),
      height: Math.max(0, window.innerHeight - parseFloat(styles.paddingTop || 0) - parseFloat(styles.paddingBottom || 0))
    };
  }

  function updateComparisonSpacing(zoomValue = Number(zoomInput.value)) {
    const c = comparisonCoin();
    const zoom = Number(zoomValue) / 100;
    const baseWideGap = Math.min(Math.max(window.innerWidth * 0.08, 34), 120);
    const baseStackGap = Math.min(Math.max(window.innerHeight * 0.04, 16), 34);
    const objectW = parseFloat(getComputedStyle(root).getPropertyValue('--object-w')) || 0;
    const objectH = parseFloat(getComputedStyle(root).getPropertyValue('--object-h')) || 0;
    const quarterSize = parseFloat(getComputedStyle(root).getPropertyValue('--quarter-size')) || 0;
    const contentSpace = appContentSpace();
    const wideInnerExtra = Math.max(0, (zoom - 1) * (objectW + quarterSize) / 2);
    const stackInnerExtra = c.shape === 'bar' ? 0 : Math.max(0, (zoom - 1) * (objectH + quarterSize) / 2);
    const wideOuterExtra = wideInnerExtra;
    const stackOuterExtra = stackInnerExtra;
    const availableWideExtra = Math.max(0, contentSpace.width - objectW - quarterSize - baseWideGap - wideOuterExtra);
    const availableStackExtra = Math.max(0, contentSpace.height - objectH - quarterSize - baseStackGap - stackOuterExtra);
    const appliedWideExtra = Math.min(wideInnerExtra, availableWideExtra);
    const appliedStackExtra = Math.min(stackInnerExtra, availableStackExtra);
    const inlineTotal = objectW + quarterSize || 1;
    const stackTotal = objectH + quarterSize || 1;
    root.style.setProperty('--comparison-gap', `${baseWideGap.toFixed(2)}px`);
    root.style.setProperty('--comparison-stack-gap', `${baseStackGap.toFixed(2)}px`);
    root.style.setProperty('--object-zoom-inline-margin', `${(appliedWideExtra * objectW / inlineTotal).toFixed(2)}px`);
    root.style.setProperty('--quarter-zoom-inline-margin', `${(appliedWideExtra * quarterSize / inlineTotal).toFixed(2)}px`);
    root.style.setProperty('--object-zoom-stack-margin', `${(appliedStackExtra * objectH / stackTotal).toFixed(2)}px`);
    root.style.setProperty('--quarter-zoom-stack-margin', `${(appliedStackExtra * quarterSize / stackTotal).toFixed(2)}px`);
    root.style.setProperty('--bar-quarter-inline-margin', `${(c.shape === 'bar' ? appliedWideExtra : 0).toFixed(2)}px`);
    updateSingleItemViewportCenter();
  }

  function captureQuarterLayout() {
    if (app.classList.contains('quarter-booting')) return null;
    if (!app.classList.contains('quarter-comparison') && !app.classList.contains('quarter-exiting')) return null;
    const rect = quarterScene.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return rect;
  }

  function captureSceneLayout() {
    const rect = scene.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return rect;
  }

  function prepareSceneLayoutAnimation(previousRect, durationMs = 480) {
    if (!previousRect) return null;
    const token = ++sceneLayoutAnimationToken;
    const rect = scene.getBoundingClientRect();
    const dx = previousRect.left - rect.left;
    const dy = previousRect.top - rect.top;
    if (Math.hypot(dx, dy) < 1) return null;
    scene.style.transition = 'none';
    scene.style.transform = `translate(${dx}px, ${dy}px) scale(var(--zoom))`;
    scene.getBoundingClientRect();
    return () => {
      const releaseSceneTransform = () => {
        if (token !== sceneLayoutAnimationToken) return;
        scene.style.transition = 'none';
        scene.style.transform = '';
        scene.getBoundingClientRect();
        requestAnimationFrame(() => {
          if (token !== sceneLayoutAnimationToken) return;
          scene.style.transition = '';
        });
      };
      setTimeout(releaseSceneTransform, durationMs + 120);
      requestAnimationFrame(() => {
        if (token !== sceneLayoutAnimationToken) return;
        scene.style.transition = `transform ${durationMs}ms cubic-bezier(.22, 1, .36, 1)`;
        scene.style.transform = 'translate(0, 0) scale(var(--zoom))';
      });
    };
  }

  function prepareQuarterLayoutAnimation(previousRect, durationMs = 480) {
    if (!previousRect || !quarterComparisonInput.checked) return null;
    const token = ++quarterLayoutAnimationToken;
    const rect = quarterScene.getBoundingClientRect();
    const dx = previousRect.left - rect.left;
    const dy = previousRect.top - rect.top;
    if (Math.hypot(dx, dy) < 1) return null;
    quarterScene.style.transition = 'none';
    quarterScene.style.transform = `translate(${dx}px, ${dy}px) scale(var(--zoom))`;
    quarterScene.getBoundingClientRect();
    return () => {
      requestAnimationFrame(() => {
        if (token !== quarterLayoutAnimationToken) return;
        quarterScene.style.transition = `transform ${durationMs}ms cubic-bezier(.22, 1, .36, 1)`;
        quarterScene.style.transform = 'translate(0, 0) scale(var(--zoom))';
        setTimeout(() => {
          if (token !== quarterLayoutAnimationToken) return;
          quarterScene.style.transition = 'none';
          quarterScene.style.transform = '';
          quarterScene.getBoundingClientRect();
          requestAnimationFrame(() => {
            if (token !== quarterLayoutAnimationToken) return;
            quarterScene.style.transition = '';
          });
        }, durationMs + 80);
      });
    };
  }

  function releaseQuarterExitPosition({ hideDuringRelease = false } = {}) {
    if (hideDuringRelease) {
      quarterScene.style.transition = 'none';
      quarterScene.style.visibility = 'hidden';
      quarterScene.style.opacity = '0';
      quarterScene.style.display = 'none';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => releaseQuarterExitPosition());
      });
      return;
    }
    quarterScene.style.transition = '';
    quarterScene.style.display = '';
    quarterScene.style.position = '';
    quarterScene.style.left = '';
    quarterScene.style.top = '';
    quarterScene.style.width = '';
    quarterScene.style.height = '';
    quarterScene.style.margin = '';
    quarterScene.style.transform = '';
    quarterScene.style.opacity = '';
    quarterScene.style.visibility = '';
  }

  function releaseInitialQuarterBoot() {
    removeQuarterExitClone();
    if (activeGroupKey === ALL_ITEMS_GROUP_KEY) {
      updateAllItemsQuarterPlacement();
      quarterScene.style.opacity = '';
      quarterScene.style.visibility = '';
      quarterScene.style.display = '';
    } else {
      updateComparisonSpacing();
      releaseQuarterExitPosition();
    }
    app.classList.remove('quarter-booting', 'all-items-booting');
  }

  function releaseInitialAllItemsQuarterBoot() {
    removeQuarterExitClone();
    const bootCrosshairTarget = allItemsBootCrosshairTarget || (allItemsCrosshairTarget ? {
      x: Number(allItemsCrosshairTarget.x) || 0,
      y: Number(allItemsCrosshairTarget.y) || 0
    } : null);
    quarterScene.style.transition = 'none';
    quarterScene.style.opacity = '0';
    quarterScene.style.visibility = 'hidden';
    allItemsStage?.classList.add('grid-locked');
    updateDockedPanelLayout();
    updateBottomReservedSpace();
    updateComparisonSpacing();
    updateAllItemsQuarterPlacement();
    if (allItemsBuilt) {
      if (bootCrosshairTarget) setAllItemsCrosshairTarget(bootCrosshairTarget);
      renderAllItems({ wrap: false, syncTarget: false });
      updateAllItemsFocusedModelPosition();
    }
    let frames = 0;
    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      updateDockedPanelLayout();
      updateAllItemsQuarterPlacement();
      if (allItemsBuilt) {
        if (bootCrosshairTarget) setAllItemsCrosshairTarget(bootCrosshairTarget);
        renderAllItems({ wrap: false, syncTarget: false });
        updateAllItemsFocusedModelPosition();
      }
      quarterScene.getBoundingClientRect();
      quarterScene.style.transition = '';
      quarterScene.style.opacity = '';
      quarterScene.style.visibility = '';
      allItemsStage?.classList.remove('grid-locked');
      scene.style.transition = 'none';
      scene.style.opacity = '1';
      scene.style.visibility = 'visible';
      app.classList.remove('quarter-booting', 'all-items-booting');
      scene.getBoundingClientRect();
      requestAnimationFrame(() => {
        scene.style.transition = '';
      });
      allItemsBootCrosshairTarget = null;
    };
    clearTimeout(releaseInitialAllItemsQuarterBoot.timer);
    releaseInitialAllItemsQuarterBoot.timer = setTimeout(finalize, 900);
    const settle = () => {
      if (finalized) return;
      updateDockedPanelLayout();
      updateAllItemsQuarterPlacement();
      if (allItemsBuilt) {
        if (bootCrosshairTarget) setAllItemsCrosshairTarget(bootCrosshairTarget);
        renderAllItems({ wrap: false, syncTarget: false });
        updateAllItemsFocusedModelPosition();
      }
      frames += 1;
      if (frames < 6) {
        requestAnimationFrame(settle);
        return;
      }
      clearTimeout(releaseInitialAllItemsQuarterBoot.timer);
      finalize();
    };
    requestAnimationFrame(settle);
  }

  function removeQuarterExitClone({ restoreQuarter = true } = {}) {
    quarterExitClone?.remove();
    quarterExitClone = null;
    if (restoreQuarter) {
      quarterScene.style.opacity = '';
      quarterScene.style.visibility = '';
    }
  }

  function finishAllItemsQuarterEntryClone(clone) {
    if (quarterExitClone !== clone) return;
    quarterScene.style.transition = 'none';
    quarterScene.style.opacity = '1';
    quarterScene.style.visibility = 'visible';
    quarterScene.getBoundingClientRect();
    requestAnimationFrame(() => {
      if (quarterExitClone !== clone) return;
      removeQuarterExitClone({ restoreQuarter: false });
      requestAnimationFrame(() => {
        quarterScene.style.transition = '';
        quarterScene.style.opacity = '';
        quarterScene.style.visibility = '';
      });
    });
  }

  function fadeQuarterExitClone(previousRect) {
    if (!previousRect) return null;
    removeQuarterExitClone();
    const baseWidth = quarterScene.offsetWidth || previousRect.width;
    const baseHeight = quarterScene.offsetHeight || previousRect.height;
    const scaleX = previousRect.width / baseWidth;
    const scaleY = previousRect.height / baseHeight;
    const clone = quarterScene.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    clone.style.cssText = '';
    clone.style.display = 'block';
    clone.style.position = 'fixed';
    clone.style.left = `${previousRect.left}px`;
    clone.style.top = `${previousRect.top}px`;
    clone.style.width = `${baseWidth}px`;
    clone.style.height = `${baseHeight}px`;
    clone.style.margin = '0';
    clone.style.opacity = '1';
    clone.style.pointerEvents = 'none';
    clone.style.transformOrigin = '0 0';
    clone.style.transform = `scale(${scaleX}, ${scaleY})`;
    clone.style.transition = 'opacity .22s ease';
    clone.style.zIndex = '21';
    quarterExitClone = clone;
    document.body.appendChild(clone);
    clone.getBoundingClientRect();
    requestAnimationFrame(() => {
      if (quarterExitClone === clone) clone.style.opacity = '0';
    });
    const cleanup = () => {
      clone.removeEventListener('transitionend', onEnd);
      if (quarterExitClone === clone) removeQuarterExitClone();
    };
    const onEnd = e => {
      if (e.propertyName === 'opacity') cleanup();
    };
    clone.addEventListener('transitionend', onEnd);
    setTimeout(cleanup, 320);
    return clone;
  }

  quarterScene.addEventListener('transitionend', e => {
    if (e.propertyName !== 'transform') return;
    quarterScene.style.transition = 'none';
    quarterScene.style.transform = '';
    quarterScene.getBoundingClientRect();
    requestAnimationFrame(() => {
      quarterScene.style.transition = '';
    });
  });

  scene.addEventListener('transitionend', e => {
    if (e.propertyName !== 'transform') return;
    scene.style.transition = '';
    scene.style.transform = '';
  });

  function objectUrlForDataUrl(data) {
    if (!String(data || '').startsWith('data:')) return data || '';
    if (objectUrlCache.has(data)) return objectUrlCache.get(data);
    try {
      const [header, encoded = ''] = data.split(',');
      const mime = header.match(/^data:([^;]+)/)?.[1] || 'application/octet-stream';
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      objectUrlCache.set(data, url);
      return url;
    } catch (_) {
      return data || '';
    }
  }

  function compactAssetUrl(url) {
    if (!String(url || '').endsWith('.png')) return url;
    if (url.startsWith('assets/all_')) {
      return url.replace(/^assets\/(.+)\.png$/, 'assets/mobile/$1.webp');
    }
    if (url.startsWith('coins_and_bars/')) {
      return url.replace(/^coins_and_bars\/(.+)\.png$/, 'coins_and_bars/mobile/$1.webp');
    }
    return url;
  }

  function imageUrl(data, { compact = false } = {}) {
    const url = objectUrlForDataUrl(data);
    if ((compact || USE_COMPACT_IMAGE_ASSETS) && String(url || '').endsWith('.png')) return compactAssetUrl(url);
    return url;
  }

  function cssUrl(data, options) { return `url("${imageUrl(data, options)}")`; }

  function allItemsImagePath() {
    return imageUrl(ALL_ITEMS_IMAGE_PATHS[allItemsViewMode] || ALL_ITEMS_IMAGE_PATHS.front);
  }

  function allItemsScalePx(zoomValue = Number(zoomInput.value)) {
    const zoom = Number(zoomValue) / 100 || 1;
    return baseObjectSizePx() * zoom / (MAX_PHYSICAL_MM || 80);
  }

  function wrapAllItemsDelta(value, span) {
    if (!Number.isFinite(span) || span <= 0) return value;
    return ((value + span / 2) % span + span) % span - span / 2;
  }

  function allItemsTileSizePx() {
    const scale = allItemsScalePx();
    return {
      width: ALL_ITEMS_PACKING.widthMm * scale,
      height: ALL_ITEMS_PACKING.heightMm * scale,
      scale
    };
  }

  function allItemsTileStridePx() {
    const size = allItemsTileSizePx();
    const gap = ALL_ITEMS_TILE_GAP_MM * size.scale;
    return {
      ...size,
      strideWidth: size.width + gap,
      strideHeight: size.height + gap
    };
  }

  function allItemsPackingItem(slug = allItemsFocusedSlug) {
    return ALL_ITEMS_PACKING.items.find(item => item.slug === slug)
      || ALL_ITEMS_PACKING.items.find(item => item.slug === DEFAULT_ALL_ITEMS_FOCUS_SLUG)
      || ALL_ITEMS_PACKING.items[0];
  }

  function stageCenterRect() {
    const rect = allItemsStage?.getBoundingClientRect();
    if (rect?.width && rect?.height) return rect;
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function usableViewportBounds() {
    const allowSidePanels = sidePanelsAllowed();
    const fallbackSideWidth = sidePanelFallbackWidth();
    const matchedSideWidth = syncMatchedSidePanelWidth(fallbackSideWidth);
    const leftWidth = allowSidePanels && leftPanelOpen ? matchedSideWidth : 0;
    const rightWidth = allowSidePanels && rightPanelOpen ? matchedSideWidth : 0;
    const bottomHeight = effectiveBottomPanelHeight();
    let left = leftWidth;
    let right = window.innerWidth - rightWidth;
    let top = topControlsBottom();
    let bottom = window.innerHeight - bottomHeight;
    if (right <= left) {
      left = 0;
      right = window.innerWidth;
    }
    if (bottom <= top) {
      top = 0;
      bottom = window.innerHeight;
    }

    return { left, right, top, bottom };
  }

  function usableViewportCenterPoint() {
    const bounds = usableViewportBounds();
    return {
      x: (bounds.left + bounds.right) / 2,
      y: (bounds.top + bounds.bottom) / 2
    };
  }

  function resetSingleItemViewportCenter() {
    root.style.setProperty('--single-stage-shift-x', '0px');
    root.style.setProperty('--single-stage-shift-y', '0px');
    if (comparisonStage) {
      comparisonStage.style.left = '';
      comparisonStage.style.top = '';
      comparisonStage.style.transform = '';
    }
  }

  function updateSingleItemViewportCenter() {
    if (!comparisonStage) return;
    if (allItemsMode || quarterComparisonInput.checked || app.classList.contains('quarter-comparison') || app.classList.contains('quarter-exiting')) {
      resetSingleItemViewportCenter();
      return;
    }

    app.classList.add('measuring-single-stage');
    comparisonStage.style.left = '0px';
    comparisonStage.style.top = '0px';
    const rect = comparisonStage.getBoundingClientRect();
    app.classList.remove('measuring-single-stage');
    if (!rect.width || !rect.height) return;

    const target = usableViewportCenterPoint();
    const dx = target.x - (rect.left + rect.width / 2);
    const dy = target.y - (rect.top + rect.height / 2);
    root.style.setProperty('--single-stage-shift-x', `${dx.toFixed(2)}px`);
    root.style.setProperty('--single-stage-shift-y', `${dy.toFixed(2)}px`);
    comparisonStage.style.left = `${dx.toFixed(2)}px`;
    comparisonStage.style.top = `${dy.toFixed(2)}px`;
  }

  function updateAllItemsQuarterPlacement() {
    const center = usableViewportCenterPoint();
    setAllItemsQuarterPlacementFromPoint(center);
    clearAllItemsQuarterShift();
  }

  function setAllItemsQuarterPlacementFromPoint(center) {
    const quarterSize = numericCssVar('--quarter-size');
    root.style.setProperty('--all-quarter-left', `${(center.x - quarterSize / 2).toFixed(2)}px`);
    root.style.setProperty('--all-quarter-top', `${(center.y - quarterSize / 2).toFixed(2)}px`);
  }

  function setAllItemsQuarterShift(dx = 0, dy = 0) {
    root.style.setProperty('--all-quarter-shift-x', `${Number(dx || 0).toFixed(2)}px`);
    root.style.setProperty('--all-quarter-shift-y', `${Number(dy || 0).toFixed(2)}px`);
  }

  function clearAllItemsQuarterShift() {
    root.style.removeProperty('--all-quarter-shift-x');
    root.style.removeProperty('--all-quarter-shift-y');
  }

  function allItemsQuarterVisualRect() {
    const quarterSize = numericCssVar('--quarter-size');
    const zoom = Number(zoomInput.value) / 100 || 1;
    const center = usableViewportCenterPoint();
    const width = quarterSize * zoom;
    const height = quarterSize * zoom;
    return {
      left: center.x - width / 2,
      top: center.y - height / 2,
      width,
      height
    };
  }

  function animateAllItemsQuarterEntry(previousRect) {
    if (!previousRect || !quarterComparisonInput.checked) {
      updateAllItemsQuarterPlacement();
      quarterScene.style.opacity = '';
      quarterScene.style.visibility = '';
      return;
    }
    removeQuarterExitClone();
    updateAllItemsQuarterPlacement();
    const targetRect = allItemsQuarterVisualRect();
    const baseWidth = quarterScene.offsetWidth || numericCssVar('--quarter-size') || previousRect.width;
    const baseHeight = quarterScene.offsetHeight || numericCssVar('--quarter-size') || previousRect.height;
    const clone = quarterScene.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    clone.style.cssText = '';
    clone.style.display = 'block';
    clone.style.position = 'fixed';
    clone.style.left = `${previousRect.left}px`;
    clone.style.top = `${previousRect.top}px`;
    clone.style.width = `${baseWidth}px`;
    clone.style.height = `${baseHeight}px`;
    clone.style.margin = '0';
    clone.style.opacity = '1';
    clone.style.pointerEvents = 'none';
    clone.style.transformOrigin = '0 0';
    clone.style.transform = `scale(${previousRect.width / baseWidth}, ${previousRect.height / baseHeight})`;
    clone.style.transition = 'left .48s cubic-bezier(.22, 1, .36, 1), top .48s cubic-bezier(.22, 1, .36, 1), transform .48s cubic-bezier(.22, 1, .36, 1), opacity .18s ease';
    clone.style.zIndex = '30';
    quarterExitClone = clone;
    quarterScene.style.opacity = '0';
    quarterScene.style.visibility = 'hidden';
    document.body.appendChild(clone);
    clone.getBoundingClientRect();
    requestAnimationFrame(() => {
      clone.style.left = `${targetRect.left}px`;
      clone.style.top = `${targetRect.top}px`;
      clone.style.transform = `scale(${targetRect.width / baseWidth}, ${targetRect.height / baseHeight})`;
      setTimeout(() => {
        finishAllItemsQuarterEntryClone(clone);
      }, 560);
    });
  }

  function allItemsUsableCenterOffset() {
    const rect = stageCenterRect();
    const stageLeft = rect.left || 0;
    const stageTop = rect.top || 0;
    const bounds = usableViewportBounds();
    const left = Math.max(stageLeft, bounds.left);
    const right = Math.min(stageLeft + rect.width, bounds.right);
    const top = Math.max(stageTop, bounds.top);
    const bottom = Math.min(stageTop + rect.height, bounds.bottom);
    if (right <= left || bottom <= top) return { x: 0, y: 0 };

    return {
      x: (left + right) / 2 - (stageLeft + rect.width / 2),
      y: (top + bottom) / 2 - (stageTop + rect.height / 2)
    };
  }

  function numericCssVar(name) {
    return parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;
  }

  function allItemsObjectTargetOffset() {
    const center = allItemsUsableCenterOffset();
    return {
      x: center.x,
      y: center.y
    };
  }

  function setAllItemsCrosshairTarget(target, { save = false } = {}) {
    if (!allItemsStage) return;
    allItemsCrosshairTarget = {
      x: Number(target?.x) || 0,
      y: Number(target?.y) || 0
    };
    allItemsStage.style.setProperty('--all-items-target-x', `${allItemsCrosshairTarget.x.toFixed(2)}px`);
    allItemsStage.style.setProperty('--all-items-target-y', `${allItemsCrosshairTarget.y.toFixed(2)}px`);
    if (save) saveAllItemsCrosshair();
  }

  function syncAllItemsTargetCursor() {
    setAllItemsCrosshairTarget(allItemsObjectTargetOffset());
  }

  function syncAllItemsCursorToCenter() {
    setAllItemsCrosshairTarget(allItemsObjectTargetOffset());
  }

  function clearAllItemsQuarterPosition() {
    root.style.removeProperty('--all-quarter-left');
    root.style.removeProperty('--all-quarter-top');
    quarterScene.style.position = '';
    quarterScene.style.left = '';
    quarterScene.style.top = '';
    quarterScene.style.width = '';
    quarterScene.style.height = '';
    quarterScene.style.margin = '';
    quarterScene.style.transform = '';
    quarterScene.style.opacity = '';
    quarterScene.style.visibility = '';
    quarterScene.style.display = '';
  }

  function focusedAllItemsOffset(slug = allItemsFocusedSlug, { tileX = 0, tileY = 0 } = {}) {
    const item = allItemsPackingItem(slug);
    const { scale, strideWidth, strideHeight } = allItemsTileStridePx();
    const target = allItemsObjectTargetOffset();
    return {
      x: target.x - tileX * strideWidth - Number(item?.x || 0) * scale,
      y: target.y - tileY * strideHeight - Number(item?.y || 0) * scale
    };
  }

  function allItemsItemScreenRectForOffset(slug = allItemsFocusedSlug, tileX = 0, tileY = 0, offsetX = allItemsOffsetX, offsetY = allItemsOffsetY) {
    const item = allItemsPackingItem(slug);
    const coin = coinBySlug(item?.slug);
    const stageRect = allItemsStage?.getBoundingClientRect();
    if (!item || !coin || !stageRect?.width || !stageRect?.height) return null;
    const { scale, strideWidth, strideHeight } = allItemsTileStridePx();
    const centerX = stageRect.left + stageRect.width / 2 + offsetX + tileX * strideWidth + Number(item.x || 0) * scale;
    const centerY = stageRect.top + stageRect.height / 2 + offsetY + tileY * strideHeight + Number(item.y || 0) * scale;
    const width = (coin.shape === 'bar' ? Number(coin.widthMm || 0) : Number(coin.diameterMm || 0)) * scale;
    const height = (coin.shape === 'bar' ? Number(coin.heightMm || 0) : Number(coin.diameterMm || 0)) * scale;
    return {
      left: centerX - width / 2,
      top: centerY - height / 2,
      width,
      height,
      centerX,
      centerY,
      shape: coin.shape
    };
  }

  function allItemsItemScreenRect(slug = allItemsFocusedSlug, tileX = 0, tileY = 0) {
    return allItemsItemScreenRectForOffset(slug, tileX, tileY);
  }

  function nearestAllItemsFocusedTile(slug = allItemsFocusedSlug) {
    return allItemsClosestFocusedPlacements(slug, 1)[0] || { tileX: 0, tileY: 0 };
  }

  function allItemsClosestFocusedPlacements(slug = allItemsFocusedSlug, limit = 2) {
    const item = allItemsPackingItem(slug);
    if (!item || !allItemsStage) return [];
    const target = allItemsObjectTargetOffset();
    const { scale, strideWidth, strideHeight } = allItemsTileStridePx();
    if (!Number.isFinite(scale) || !Number.isFinite(strideWidth) || !Number.isFinite(strideHeight) || strideWidth <= 0 || strideHeight <= 0) {
      return [{ slug: item.slug, tileX: 0, tileY: 0, distance: 0 }];
    }
    const placements = [];
    for (let tileY = -1; tileY <= 1; tileY += 1) {
      for (let tileX = -1; tileX <= 1; tileX += 1) {
        const cx = allItemsOffsetX + tileX * strideWidth + Number(item.x || 0) * scale;
        const cy = allItemsOffsetY + tileY * strideHeight + Number(item.y || 0) * scale;
        placements.push({
          slug: item.slug,
          tileX,
          tileY,
          distance: Math.hypot(target.x - cx, target.y - cy)
        });
      }
    }
    return placements
      .sort((a, b) => a.distance - b.distance || Math.abs(a.tileX) + Math.abs(a.tileY) - Math.abs(b.tileX) - Math.abs(b.tileY))
      .slice(0, Math.max(1, limit));
  }

  function nearestAllItemsFocusedItemScreenRect(slug = allItemsFocusedSlug) {
    const { tileX, tileY } = nearestAllItemsFocusedTile(slug);
    return allItemsItemScreenRect(slug, tileX, tileY);
  }

  function allItemsSelectedItemClientHit(e) {
    if (!allItemsMode || !e) return false;
    const rect = nearestAllItemsFocusedItemScreenRect();
    if (!rect?.width || !rect?.height) return false;
    const dx = e.clientX - rect.centerX;
    const dy = e.clientY - rect.centerY;
    if (rect.shape === 'bar') {
      return Math.abs(dx) <= rect.width / 2 && Math.abs(dy) <= rect.height / 2;
    }
    return Math.hypot(dx, dy) <= Math.min(rect.width, rect.height) / 2;
  }

  function updateAllItemsFocusedModelPositionFromRect(rect) {
    if (!rect?.width || !rect?.height) {
      if (allItemsMode) app.classList.add('all-items-model-pending');
      return false;
    }
    const objectWidth = numericCssVar('--object-w') || rect.width;
    const objectHeight = numericCssVar('--object-h') || rect.height;
    root.style.setProperty('--all-selected-left', `${(rect.centerX - objectWidth / 2).toFixed(2)}px`);
    root.style.setProperty('--all-selected-top', `${(rect.centerY - objectHeight / 2).toFixed(2)}px`);
    if (
      allItemsMode
      && allItemsRevealedModelSlug === allItemsFocusedSlug
      && model.classList.contains('loaded')
      && !app.classList.contains('all-items-model-hidden')
    ) {
      app.classList.remove('all-items-model-pending');
    }
    return true;
  }

  function updateAllItemsFocusedModelPosition() {
    if (!allItemsMode || !allItemsStage) return false;
    return updateAllItemsFocusedModelPositionFromRect(nearestAllItemsFocusedItemScreenRect());
  }

  function easeAllItemsLayoutShift(t) {
    const x1 = 0.22;
    const y1 = 1;
    const x2 = 0.36;
    const y2 = 1;
    const target = Math.max(0, Math.min(1, t));
    let lo = 0;
    let hi = 1;
    let u = target;
    for (let i = 0; i < 8; i += 1) {
      u = (lo + hi) / 2;
      const x = cubicBezierPoint(u, x1, x2);
      if (x < target) lo = u;
      else hi = u;
    }
    return cubicBezierPoint(u, y1, y2);
  }

  function cubicBezierPoint(t, p1, p2) {
    const inv = 1 - t;
    return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t;
  }

  function cancelAllItemsModelPositionTrack() {
    if (allItemsModelPositionRaf) {
      cancelAnimationFrame(allItemsModelPositionRaf);
      allItemsModelPositionRaf = 0;
    }
  }

  function trackAllItemsFocusedModelPosition(slug, tileX, tileY, startOffset, targetOffset, token) {
    cancelAllItemsModelPositionTrack();
    if (!allItemsMode || !allItemsStage) return;
    const startX = Number(startOffset?.x);
    const startY = Number(startOffset?.y);
    const targetX = Number(targetOffset?.x);
    const targetY = Number(targetOffset?.y);
    if (![startX, startY, targetX, targetY].every(Number.isFinite)) return;
    const duration = 480;
    const startedAt = performance.now();
    app.classList.add('all-items-model-positioning');
    updateAllItemsFocusedModelPositionFromRect(allItemsItemScreenRectForOffset(slug, tileX, tileY, startX, startY));
    const step = now => {
      if (token !== allItemsLayoutAnimationToken || !allItemsMode || !allItemsStage) {
        allItemsModelPositionRaf = 0;
        return;
      }
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = easeAllItemsLayoutShift(progress);
      const rect = allItemsItemScreenRectForOffset(
        slug,
        tileX,
        tileY,
        startX + (targetX - startX) * eased,
        startY + (targetY - startY) * eased
      );
      updateAllItemsFocusedModelPositionFromRect(rect);
      if (progress < 1) {
        allItemsModelPositionRaf = requestAnimationFrame(step);
        return;
      }
      allItemsModelPositionRaf = 0;
      updateAllItemsFocusedModelPositionFromRect(allItemsItemScreenRectForOffset(slug, tileX, tileY, targetX, targetY));
      app.classList.remove('all-items-model-positioning');
    };
    allItemsModelPositionRaf = requestAnimationFrame(step);
  }

  function clearAllItemsExtraScene() {
    allItemsExtraScene?.remove();
    allItemsExtraScene = null;
  }

  function stripDuplicateIds(node) {
    if (!node?.querySelectorAll) return node;
    node.removeAttribute?.('id');
    node.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    return node;
  }

  function ensureAllItemsExtraScene() {
    if (allItemsExtraScene) return allItemsExtraScene;
    allItemsExtraScene = document.createElement('div');
    allItemsExtraScene.className = 'scene all-items-extra-scene';
    allItemsExtraScene.setAttribute('aria-hidden', 'true');
    comparisonStage.appendChild(allItemsExtraScene);
    return allItemsExtraScene;
  }

  function cloneModelForExtraScene() {
    if (!allItemsExtraScene || !model.classList.contains('loaded')) return;
    const clone = stripDuplicateIds(model.cloneNode(true));
    allItemsExtraScene.replaceChildren(clone);
  }

  function syncAllItemsExtraModelPosition() {
    if (!allItemsMode || !allItemsStage) {
      clearAllItemsExtraScene();
      return;
    }
    const placements = allItemsClosestFocusedPlacements(allItemsFocusedSlug, 2);
    const placement = placements[1];
    if (!placement) {
      clearAllItemsExtraScene();
      return;
    }
    const rect = allItemsItemScreenRect(allItemsFocusedSlug, placement.tileX, placement.tileY);
    if (!rect?.width || !rect?.height) {
      clearAllItemsExtraScene();
      return;
    }
    const extraScene = ensureAllItemsExtraScene();
    const placementKey = `${allItemsFocusedSlug}:${placement.tileX}:${placement.tileY}`;
    const changedPlacement = extraScene.dataset.placementKey !== placementKey;
    if (!extraScene.firstElementChild || extraScene.dataset.slug !== allItemsFocusedSlug) {
      cloneModelForExtraScene();
      extraScene.dataset.slug = allItemsFocusedSlug;
    }
    if (changedPlacement) extraScene.classList.add('all-items-extra-swap');
    extraScene.dataset.placementKey = placementKey;
    const objectWidth = numericCssVar('--object-w') || rect.width;
    const objectHeight = numericCssVar('--object-h') || rect.height;
    root.style.setProperty('--all-extra-left', `${(rect.centerX - objectWidth / 2).toFixed(2)}px`);
    root.style.setProperty('--all-extra-top', `${(rect.centerY - objectHeight / 2).toFixed(2)}px`);
    if (changedPlacement) {
      extraScene.getBoundingClientRect();
      requestAnimationFrame(() => extraScene.classList.remove('all-items-extra-swap'));
    }
    syncBalanceChartBackgroundLayers();
  }

  function clearAllItemsTileMask(image) {
    image.style.webkitMaskImage = '';
    image.style.maskImage = '';
    image.style.webkitMaskSize = '';
    image.style.maskSize = '';
    image.style.webkitMaskRepeat = '';
    image.style.maskRepeat = '';
  }

  function allItemsMaskedPlacements() {
    const focused = allItemsPackingItem(allItemsFocusedSlug)?.slug;
    return focused && allItemsFocusedModelRevealed(focused) ? allItemsClosestFocusedPlacements(focused, 2) : [];
  }

  function allItemsCutoutShape(slug, tileW, tileH, scale) {
    const item = allItemsPackingItem(slug);
    const coin = coinBySlug(item?.slug);
    if (!item || !coin || !tileW || !tileH || !scale) return '';
    const pad = coin.shape === 'bar' ? 2 : 1.5;
    const cx = tileW / 2 + Number(item.x || 0) * scale;
    const cy = tileH / 2 + Number(item.y || 0) * scale;
    const width = Math.max(0, (coin.shape === 'bar' ? Number(coin.widthMm || 0) : Number(coin.diameterMm || 0)) * scale + pad * 2);
    const height = Math.max(0, (coin.shape === 'bar' ? Number(coin.heightMm || 0) : Number(coin.diameterMm || 0)) * scale + pad * 2);
    return coin.shape === 'bar'
      ? `<rect x="${(cx - width / 2).toFixed(2)}" y="${(cy - height / 2).toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" rx="${Math.min(6, height / 8).toFixed(2)}" fill="black"/>`
      : `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(Math.min(width, height) / 2).toFixed(2)}" fill="black"/>`;
  }

  function applyAllItemsTileMask(image, tileW, tileH, scale, tileX = 0, tileY = 0) {
    const cutoutShapes = allItemsMaskedPlacements()
      .filter(placement => placement.tileX === tileX && placement.tileY === tileY)
      .map(placement => allItemsCutoutShape(placement.slug, tileW, tileH, scale))
      .filter(Boolean)
      .join('');
    if (!cutoutShapes) {
      clearAllItemsTileMask(image);
      return;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW.toFixed(2)}" height="${tileH.toFixed(2)}" viewBox="0 0 ${tileW.toFixed(2)} ${tileH.toFixed(2)}"><defs><mask id="all-items-cutout"><rect width="100%" height="100%" fill="white"/>${cutoutShapes}</mask></defs><rect width="100%" height="100%" fill="white" mask="url(#all-items-cutout)"/></svg>`;
    const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    image.style.webkitMaskImage = mask;
    image.style.maskImage = mask;
    image.style.webkitMaskSize = '100% 100%';
    image.style.maskSize = '100% 100%';
    image.style.webkitMaskRepeat = 'no-repeat';
    image.style.maskRepeat = 'no-repeat';
  }

  function syncAllItemsFocusedOverlay() {
    updateAllItemsFocusedModelPosition();
  }

  function captureAllItemsCenteredWorldPoint() {
    if (!allItemsMode || !allItemsStage || !allItemsBuilt) return null;
    const target = allItemsObjectTargetOffset();
    const { scale } = allItemsTileSizePx();
    if (!scale) return null;
    return {
      xMm: (target.x - allItemsOffsetX) / scale,
      yMm: (target.y - allItemsOffsetY) / scale
    };
  }

  function rememberAllItemsCenteredWorldPoint() {
    const point = captureAllItemsCenteredWorldPoint();
    if (point) allItemsCenteredWorldPoint = point;
    return point;
  }

  function restoreAllItemsCenteredWorldPoint(point, { save = false } = {}) {
    if (!point || !allItemsMode || !allItemsStage || !allItemsBuilt) return false;
    const { scale } = allItemsTileSizePx();
    if (!scale) return false;
    const target = allItemsObjectTargetOffset();
    allItemsOffsetX = target.x - Number(point.xMm || 0) * scale;
    allItemsOffsetY = target.y - Number(point.yMm || 0) * scale;
    allItemsStage.classList.add('grid-locked');
    renderAllItems({ wrap: false });
    updateAllItemsQuarterPlacement();
    allItemsStage.getBoundingClientRect();
    requestAnimationFrame(() => {
      allItemsStage?.classList.remove('grid-locked');
    });
    rememberAllItemsCenteredWorldPoint();
    syncAllItemsLeftPanelSelectionToCentered({ save });
    if (save) saveAllItemsWindow();
    return true;
  }

  function captureAllItemsViewportLayout() {
    if (!allItemsMode || !allItemsStage || !allItemsBuilt) return null;
    const rect = stageCenterRect();
    const center = usableViewportCenterPoint();
    return {
      stageCenterX: (rect.left || 0) + rect.width / 2,
      stageCenterY: (rect.top || 0) + rect.height / 2,
      centerX: center.x,
      centerY: center.y,
      offsetX: allItemsOffsetX,
      offsetY: allItemsOffsetY
    };
  }

  function slideAllItemsViewportFrom(previousLayout) {
    if (!previousLayout || !allItemsMode || !allItemsStage || !allItemsBuilt) {
      updateAllItemsQuarterPlacement();
      return;
    }
    const rect = stageCenterRect();
    const center = usableViewportCenterPoint();
    const stageCenterX = (rect.left || 0) + rect.width / 2;
    const stageCenterY = (rect.top || 0) + rect.height / 2;
    const start = {
      x: previousLayout.offsetX + previousLayout.stageCenterX - stageCenterX,
      y: previousLayout.offsetY + previousLayout.stageCenterY - stageCenterY
    };
    const target = {
      x: previousLayout.offsetX + (center.x - previousLayout.centerX) - (stageCenterX - previousLayout.stageCenterX),
      y: previousLayout.offsetY + (center.y - previousLayout.centerY) - (stageCenterY - previousLayout.stageCenterY)
    };
    allItemsOffsetX = target.x;
    allItemsOffsetY = target.y;
    if (Math.hypot(target.x - start.x, target.y - start.y) < 1) {
      setAllItemsQuarterPlacementFromPoint(center);
      clearAllItemsQuarterShift();
      renderAllItems({ wrap: false, updateQuarter: false });
      syncAllItemsLeftPanelSelectionToCentered({ save: true });
      saveAllItemsWindow();
      return;
    }
    const token = ++allItemsLayoutAnimationToken;
    clearTimeout(slideAllItemsViewportFrom.timer);
    app.classList.remove('all-items-quarter-shifting');
    allItemsStage.classList.add('grid-locked');
    allItemsOffsetX = start.x;
    allItemsOffsetY = start.y;
    setAllItemsQuarterPlacementFromPoint(center);
    setAllItemsQuarterShift(previousLayout.centerX - center.x, previousLayout.centerY - center.y);
    renderAllItems({ wrap: false, updateQuarter: false });
    allItemsStage.getBoundingClientRect();
    quarterScene?.getBoundingClientRect();
    requestAnimationFrame(() => {
      if (token !== allItemsLayoutAnimationToken) return;
      allItemsStage.classList.remove('grid-locked');
      allItemsStage.classList.add('layout-shifting');
      app.classList.add('all-items-quarter-shifting');
      allItemsOffsetX = target.x;
      allItemsOffsetY = target.y;
      setAllItemsQuarterShift(0, 0);
      renderAllItems({ wrap: false, updateQuarter: false });
      slideAllItemsViewportFrom.timer = setTimeout(() => {
        if (token !== allItemsLayoutAnimationToken) return;
        allItemsStage.classList.remove('layout-shifting');
        app.classList.remove('all-items-quarter-shifting');
        setAllItemsQuarterPlacementFromPoint(center);
        clearAllItemsQuarterShift();
        renderAllItems({ wrap: false, updateQuarter: false });
        syncAllItemsLeftPanelSelectionToCentered({ save: true });
        saveAllItemsWindow();
      }, 560);
    });
  }

  function normalizeAllItemsTileOffset() {
    const { strideWidth, strideHeight } = allItemsTileStridePx();
    const x = wrapAllItemsDelta(allItemsOffsetX, strideWidth);
    const y = wrapAllItemsDelta(allItemsOffsetY, strideHeight);
    if (Math.abs(x - allItemsOffsetX) < 0.01 && Math.abs(y - allItemsOffsetY) < 0.01) return false;
    allItemsStage?.classList.add('retiling');
    allItemsOffsetX = x;
    allItemsOffsetY = y;
    renderAllItems({ wrap: false });
    allItemsStage?.getBoundingClientRect();
    requestAnimationFrame(() => {
      allItemsStage?.classList.remove('retiling');
    });
    return true;
  }

  function setAllItemsFocusPlacement(placement) {
    const item = allItemsPackingItem(placement?.slug);
    if (!item) return;
    const tileX = Number(placement?.tileX || 0);
    const tileY = Number(placement?.tileY || 0);
    const startingRect = allItemsItemScreenRect(item.slug, tileX, tileY);
    const target = focusedAllItemsOffset(item.slug, { tileX, tileY });
    allItemsFocusedSlug = item.slug;
    const c = allItemsFocusedCoin();
    refreshBalanceChartHover();
    applyDimensions(c);
    setMetal(c.metal || 'gold');
    hideAllItemsFocusedModel();
    if (startingRect) updateAllItemsFocusedModelPositionFromRect(startingRect);
    syncFocusedAllItemsModelWhenLoaded({ updateOverlay: false, reveal: false });
    updateComparisonSpacing();
    allItemsOffsetX = target.x;
    allItemsOffsetY = target.y;
    allItemsStage?.classList.add('grid-locked');
    renderAllItems({ wrap: false });
    allItemsStage?.getBoundingClientRect();
    rememberAllItemsCenteredWorldPoint();
    syncAllItemsLeftPanelSelectionToCentered({ save: true, revealModel: false });
    revealFocusedAllItemsModel({ updateOverlay: true });
    requestAnimationFrame(() => {
      allItemsStage?.classList.remove('grid-locked');
    });
  }

  function nearestAllItemsPlacement(slug) {
    const item = allItemsPackingItem(slug);
    if (!item || !allItemsStage) return { slug, tileX: 0, tileY: 0 };
    const { strideWidth, strideHeight } = allItemsTileStridePx();
    if (!Number.isFinite(strideWidth) || !Number.isFinite(strideHeight)) return { slug: item.slug, tileX: 0, tileY: 0 };
    const searchRadius = 1;
    let best = { slug: item.slug, tileX: 0, tileY: 0 };
    let bestDistance = Infinity;
    for (let tileY = -searchRadius; tileY <= searchRadius; tileY += 1) {
      for (let tileX = -searchRadius; tileX <= searchRadius; tileX += 1) {
        const target = focusedAllItemsOffset(item.slug, { tileX, tileY });
        const dx = target.x - allItemsOffsetX;
        const dy = target.y - allItemsOffsetY;
        const distance = Math.hypot(dx, dy);
        if (
          distance < bestDistance
          || (
            Math.abs(distance - bestDistance) < 0.01
            && Math.abs(tileX) + Math.abs(tileY) < Math.abs(best.tileX) + Math.abs(best.tileY)
          )
        ) {
          bestDistance = distance;
          best = { slug: item.slug, tileX, tileY };
        }
      }
    }
    return best;
  }

  function allItemsCenteredSlug() {
    if (!allItemsMode || !allItemsStage || !allItemsBuilt) {
      return allItemsPackingItem(allItemsFocusedSlug)?.slug || DEFAULT_ALL_ITEMS_FOCUS_SLUG;
    }
    const target = allItemsObjectTargetOffset();
    const { scale, strideWidth, strideHeight } = allItemsTileStridePx();
    if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(strideWidth) || !Number.isFinite(strideHeight)) {
      return allItemsPackingItem(allItemsFocusedSlug)?.slug || DEFAULT_ALL_ITEMS_FOCUS_SLUG;
    }
    let bestSlug = allItemsPackingItem(allItemsFocusedSlug)?.slug || DEFAULT_ALL_ITEMS_FOCUS_SLUG;
    let bestDistance = Infinity;
    let bestCenterDistance = Infinity;
    for (let tileY = -1; tileY <= 1; tileY += 1) {
      for (let tileX = -1; tileX <= 1; tileX += 1) {
        ALL_ITEMS_PACKING.items.forEach(item => {
          const coin = coinBySlug(item.slug);
          if (!coin) return;
          const cx = allItemsOffsetX + tileX * strideWidth + Number(item.x || 0) * scale;
          const cy = allItemsOffsetY + tileY * strideHeight + Number(item.y || 0) * scale;
          const dx = target.x - cx;
          const dy = target.y - cy;
          const centerDistance = Math.hypot(dx, dy);
          let edgeDistance = centerDistance;
          if (coin.shape === 'bar') {
            const halfW = Number(coin.widthMm || 0) * scale / 2;
            const halfH = Number(coin.heightMm || 0) * scale / 2;
            edgeDistance = Math.max(Math.abs(dx) - halfW, Math.abs(dy) - halfH, 0);
          } else {
            const radius = Number(coin.diameterMm || 0) * scale / 2;
            edgeDistance = Math.max(centerDistance - radius, 0);
          }
          if (
            edgeDistance < bestDistance
            || (Math.abs(edgeDistance - bestDistance) < 0.01 && centerDistance < bestCenterDistance)
          ) {
            bestDistance = edgeDistance;
            bestCenterDistance = centerDistance;
            bestSlug = item.slug;
          }
        });
      }
    }
    return bestSlug;
  }

  function centerAllItemsOnPlacement(placement, { animate = true, save = false, syncSelection = true, animateTransform = true } = {}) {
    const item = allItemsPackingItem(placement?.slug);
    if (!item || !allItemsStage) return;
    const tileX = Number(placement?.tileX || 0);
    const tileY = Number(placement?.tileY || 0);
    const target = focusedAllItemsOffset(item.slug, { tileX, tileY });
    const visualState = animate ? currentAllItemsVisualState() : null;
    const startOffset = visualState
      ? { x: visualState.offsetX, y: visualState.offsetY }
      : { x: allItemsOffsetX, y: allItemsOffsetY };
    const startingRect = animate ? allItemsItemScreenRectForOffset(item.slug, tileX, tileY, startOffset.x, startOffset.y) : null;
    const previousSlug = allItemsFocusedSlug;
    const previousCoin = allItemsFocusedCoin();
    const changedFocus = item.slug !== previousSlug;
    allItemsFocusedSlug = item.slug;
    const c = allItemsFocusedCoin();
    const pausedHologramTargetAngle = pausedHologramShapeTargetAngle(previousCoin, c);
    if (pausedHologramTargetAngle !== null) {
      angle = pausedHologramTargetAngle;
      setTransform({ save: false });
    }
    refreshBalanceChartHover();
    clearAllItemsRenderedSceneTransform();
    applyDimensions(c);
    setMetal(c.metal || 'gold');
    scene.style.opacity = '';
    scene.style.transition = '';
    if (changedFocus) {
      hideAllItemsFocusedModel();
      syncFocusedAllItemsModelWhenLoaded({ updateOverlay: false, reveal: false });
    } else {
      syncFocusedAllItemsModelWhenLoaded({ updateOverlay: !startingRect });
    }
    if (startingRect && !changedFocus) {
      app.classList.add('all-items-model-positioning');
      updateAllItemsFocusedModelPositionFromRect(startingRect);
      scene?.getBoundingClientRect();
    }
    updateComparisonSpacing();
    const token = ++allItemsLayoutAnimationToken;
    clearTimeout(centerAllItemsOnPlacement.timer);
    allItemsStage.classList.remove('grid-locked', 'retiling');
    if (animate) allItemsStage.classList.add('layout-shifting');
    allItemsOffsetX = target.x;
    allItemsOffsetY = target.y;
    syncAllItemsCursorToCenter();
    renderAllItems({ wrap: false, updateOverlay: !startingRect });
    if (startingRect && animate && !changedFocus) {
      scene?.getBoundingClientRect();
      trackAllItemsFocusedModelPosition(item.slug, tileX, tileY, startOffset, target, token);
    } else {
      cancelAllItemsModelPositionTrack();
      app.classList.remove('all-items-model-positioning');
      if (!changedFocus) updateAllItemsFocusedModelPosition();
    }
    rememberAllItemsCenteredWorldPoint();
    if (syncSelection) syncAllItemsLeftPanelSelectionToCentered({ save, revealModel: !changedFocus });
    if (!animate) {
      normalizeAllItemsTileOffset();
      rememberAllItemsCenteredWorldPoint();
      if (syncSelection) syncAllItemsLeftPanelSelectionToCentered({ save, revealModel: !changedFocus });
      if (save) saveAllItemsWindow();
      if (changedFocus) {
        revealFocusedAllItemsModel({
          updateOverlay: true,
          animateTransform,
          targetAngle: pausedHologramTargetAngle ?? angle,
          targetTilt: tilt
        });
      }
      return;
    }
    centerAllItemsOnPlacement.timer = setTimeout(() => {
      if (token !== allItemsLayoutAnimationToken) return;
      allItemsStage.classList.remove('layout-shifting');
      cancelAllItemsModelPositionTrack();
      app.classList.remove('all-items-model-positioning');
      normalizeAllItemsTileOffset();
      renderAllItems({ wrap: false });
      rememberAllItemsCenteredWorldPoint();
      if (syncSelection) syncAllItemsLeftPanelSelectionToCentered({ save, revealModel: !changedFocus });
      if (save) saveAllItemsWindow();
      if (changedFocus) {
        revealFocusedAllItemsModel({
          updateOverlay: true,
          animateTransform,
          targetAngle: pausedHologramTargetAngle ?? angle,
          targetTilt: tilt
        });
      }
    }, 560);
  }

  function setAllItemsFocusSlug(slug, options) {
    setAllItemsFocusPlacement({ slug, tileX: 0, tileY: 0 }, options);
  }

  function allItemsPointerLocalPoint(e) {
    const rect = stageCenterRect();
    return {
      x: e.clientX - (rect.left || 0) - rect.width / 2,
      y: e.clientY - (rect.top || 0) - rect.height / 2
    };
  }

  function allItemsHitPlacement(e) {
    if (!e || !allItemsBuilt) return null;
    const point = allItemsPointerLocalPoint(e);
    const { scale, strideWidth: tileW, strideHeight: tileH } = allItemsTileStridePx();
    const visualState = currentAllItemsVisualState();
    const offsetX = visualState?.offsetX ?? allItemsOffsetX;
    const offsetY = visualState?.offsetY ?? allItemsOffsetY;
    let best = null;
    let bestDistance = Infinity;
    [-1, 0, 1].forEach(tileY => {
      [-1, 0, 1].forEach(tileX => {
        ALL_ITEMS_PACKING.items.forEach(item => {
          const coin = coinBySlug(item.slug);
          if (!coin) return;
          const cx = offsetX + tileX * tileW + Number(item.x || 0) * scale;
          const cy = offsetY + tileY * tileH + Number(item.y || 0) * scale;
          const dx = point.x - cx;
          const dy = point.y - cy;
          let hit = false;
          let distance = Math.hypot(dx, dy);
          if (coin.shape === 'bar') {
            const halfW = Number(coin.widthMm || 0) * scale / 2;
            const halfH = Number(coin.heightMm || 0) * scale / 2;
            hit = Math.abs(dx) <= halfW && Math.abs(dy) <= halfH;
            distance = Math.max(Math.abs(dx) - halfW, Math.abs(dy) - halfH, 0);
          } else {
            const radius = Number(coin.diameterMm || 0) * scale / 2;
            hit = distance <= radius;
            distance = Math.max(distance - radius, 0);
          }
          if (hit && distance < bestDistance) {
            bestDistance = distance;
            best = { slug: item.slug, tileX, tileY };
          }
        });
      });
    });
    return best;
  }

  function buildAllItemsLayout({ syncTarget = true } = {}) {
    if (!allItemsStage) return;
    const tiles = [-1, 0, 1].flatMap(tileY => (
      [-1, 0, 1].map(tileX => {
        const centerTile = tileX === 0 && tileY === 0;
        return `<img class="all-items-tile" data-tile-x="${tileX}" data-tile-y="${tileY}" src="${allItemsImagePath()}" alt="${centerTile ? 'All coins and bars' : ''}"${centerTile ? '' : ' aria-hidden="true"'} />`;
      })
    )).join('');
    allItemsStage.innerHTML = `
      <div class="all-items-static">
        ${tiles}
      </div>
      <div class="all-items-crosshair" aria-hidden="true"></div>
    `;
    allItemsBuilt = true;
    if (allItemsCrosshairTarget) setAllItemsCrosshairTarget(allItemsCrosshairTarget);
    renderAllItems({ syncTarget });
  }

  function renderAllItems({ wrap = true, updateQuarter = true, updateOverlay = true, syncTarget = true } = {}) {
    if (!allItemsStage || !allItemsBuilt) return;
    if (syncTarget && !allItemsDragging) syncAllItemsTargetCursor();
    const images = Array.from(allItemsStage.querySelectorAll('.all-items-static img'));
    if (!images.length) return;
    const { width: tileW, height: tileH, strideWidth, strideHeight, scale } = allItemsTileStridePx();
    if (wrap) {
      allItemsOffsetX = wrapAllItemsDelta(allItemsOffsetX, strideWidth);
      allItemsOffsetY = wrapAllItemsDelta(allItemsOffsetY, strideHeight);
    }
    images.forEach(image => {
      const tileX = Number(image.dataset.tileX || 0);
      const tileY = Number(image.dataset.tileY || 0);
      const x = allItemsOffsetX + tileX * strideWidth;
      const y = allItemsOffsetY + tileY * strideHeight;
      image.style.width = `${tileW.toFixed(2)}px`;
      image.style.height = `${tileH.toFixed(2)}px`;
      image.style.transform = `translate(-50%, -50%) translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
      applyAllItemsTileMask(image, tileW, tileH, scale, tileX, tileY);
    });
    if (updateOverlay) syncAllItemsFocusedOverlay();
    syncAllItemsExtraModelPosition();
    if (updateQuarter) updateAllItemsQuarterPlacement();
  }

  function updateAllItemsImages() {
    if (!allItemsBuilt) return;
    allItemsStage.querySelectorAll('.all-items-static img').forEach(image => {
      image.src = allItemsImagePath();
    });
  }

  function scheduleAllItemsAtlasPreload() {
    if (!allItemsMode) return;
    const currentPath = allItemsImagePath();
    const paths = Object.values(ALL_ITEMS_IMAGE_PATHS)
      .map(path => imageUrl(path))
      .filter(path => path && path !== currentPath);
    if (!paths.length) return;
    const run = () => {
      if (!allItemsMode) return;
      paths.forEach(path => {
        const img = new Image();
        img.decoding = 'async';
        img.src = path;
      });
    };
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 1800 });
    } else {
      setTimeout(run, 900);
    }
  }

  function setAllItemsControls(enabled) {
    toggle.disabled = !enabled;
    speedInput.disabled = !enabled;
    speedValueInput.disabled = !enabled;
    if (tiltControl) {
      tiltControl.disabled = !enabled;
      tiltControl.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    }
  }

  function enterAllItemsMode({ align = false, repeat = null, direction = 0, previousKey = activeGroupKey } = {}) {
    if (allItemsMode) return;
    const bootingAllItems = app.classList.contains('all-items-booting');
    const previousQuarterLayout = bootingAllItems ? null : captureQuarterLayout();
    if (previousQuarterLayout) app.classList.add('layout-switching');
    allItemsViewMode = readSavedAllItemsViewMode();
    allItemsBootCrosshairTarget = bootingAllItems && allItemsCrosshairTarget ? {
      x: Number(allItemsCrosshairTarget.x) || 0,
      y: Number(allItemsCrosshairTarget.y) || 0
    } : null;
    setAllItemsControls(true);
    allItemsMode = true;
    app.classList.add('all-items-model-pending');
    if (allItemsDefaultFocusPending) {
      const defaultFocusSlug = latestRedeemedAllItemsSlug();
      if (defaultFocusSlug) {
        allItemsFocusedSlug = defaultFocusSlug;
        allItemsDefaultFocusPending = false;
      }
    }
    allItemsFocusedSlug = allItemsPackingItem(allItemsFocusedSlug)?.slug || DEFAULT_ALL_ITEMS_FOCUS_SLUG;
    const focusCoin = allItemsFocusedCoin();
    applyDimensions(focusCoin);
    setMetal(focusCoin.metal || 'gold');
    activeSlug = ALL_ITEMS_GROUP_KEY;
    activeGroupKey = ALL_ITEMS_GROUP_KEY;
    saveActiveSlug(ALL_ITEMS_GROUP_KEY);
    applyAllItemsViewMode(allItemsViewMode, { updateImages: false });
    syncFocusedAllItemsModelWhenLoaded();
    versionTabs.innerHTML = '';
    root.style.setProperty('--version-panel-height', '0px');
    root.style.setProperty('--version-collapse-offset', '0px');
    updateAllItemsQuarterPlacement();
    app.classList.add('all-items-mode');
    syncGradedMediaViewer();
    setSelectedTitle(ALL_ITEMS_LABEL);
    if (!allItemsBuilt) buildAllItemsLayout({ syncTarget: !allItemsWindowHasSavedState });
    scheduleAllItemsAtlasPreload();
    if (allItemsWindowHasSavedState) {
      allItemsStage?.classList.add('grid-locked');
      renderAllItems({ wrap: false, syncTarget: false });
      requestAnimationFrame(() => allItemsStage?.classList.remove('grid-locked'));
    } else {
      setAllItemsFocusSlug(allItemsFocusedSlug);
      if (!allItemsDefaultFocusPending) saveAllItemsWindow();
    }
    rememberAllItemsCenteredWorldPoint();
    syncQuarterComparison();
    syncNavigation();
    updateBottomReservedSpace();
    updateAllItemsQuarterPlacement();
    scheduleDataPanelsRefresh();
    animateAllItemsQuarterEntry(previousQuarterLayout);
    app.classList.remove('layout-switching');
    if (bootingAllItems) {
      clearTimeout(enterAllItemsMode.bootReleaseTimer);
      enterAllItemsMode.bootReleaseTimer = setTimeout(() => {
        if (allItemsMode && app.classList.contains('all-items-booting')) {
          releaseInitialAllItemsQuarterBoot();
        }
      }, 180);
    }
    if (align) alignActiveGroup({ repeat: repeat ?? cycleRepeatTarget(previousKey, ALL_ITEMS_GROUP_KEY, direction), snapRepeat: 1 });
  }

  function exitAllItemsMode() {
    if (!allItemsMode) return;
    clearPendingAllItemsSelectedRecenter();
    allItemsMode = false;
    allItemsBootCrosshairTarget = null;
    cancelAllItemsModelPositionTrack();
    clearAllItemsRenderedSceneTransform();
    allItemsRevealedModelSlug = null;
    allItemsModelRevealToken++;
    clearAllItemsExtraScene();
    scene.style.opacity = '';
    scene.style.visibility = '';
    scene.style.transition = '';
    app.classList.remove('all-items-mode', 'all-items-model-pending', 'all-items-model-hidden', 'all-items-model-positioning');
    clearAllItemsQuarterPosition();
    clearViewMode();
    setAllItemsControls(true);
    toggle.classList.toggle('is-running', running);
    toggle.setAttribute('aria-label', running ? 'Stop spinning' : 'Spin');
    syncGradedMediaViewer();
  }

  function setMetal(metal) {
    const vals = metalVars[metal] || metalVars.gold;
    root.style.setProperty('--edge-a', vals[0]);
    root.style.setProperty('--edge-b', vals[1]);
    root.style.setProperty('--edge-c', vals[2]);
    root.style.setProperty('--edge-d', vals[3]);
  }

  function buildTabs() {
    tabs.innerHTML = '';
    for (let repeat = 0; repeat < GROUP_REPEATS; repeat++) {
      COIN_GROUPS.forEach((group) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `coin-tab${repeat === 1 ? '' : ' clone'}`;
        btn.dataset.groupKey = group.key;
        btn.dataset.repeat = String(repeat);
        if (group.key === ALL_ITEMS_GROUP_KEY) {
          btn.innerHTML = '<span class="all-items-icon" aria-hidden="true"><span class="all-bar"></span><span class="all-coin all-coin-tl"></span><span class="all-coin all-coin-tr"></span><span class="all-coin all-coin-br"></span><span class="all-coin all-coin-bl"></span></span><span class="tab-label">All Coins & Bars</span><span class="collapse-indicator" aria-hidden="true"></span>';
          applyAllItemsIcon(btn.querySelector('.all-items-icon'));
        } else {
          const c = groupThumbCoin(group);
          btn.innerHTML = `<span class="thumb ${group.shape === 'bar' ? 'bar-thumb' : ''}" aria-hidden="true"></span><span class="tab-label">${group.label}</span><span class="collapse-indicator" aria-hidden="true"></span>`;
          const thumb = btn.querySelector('.thumb');
          applyTabThumb(thumb, c);
        }
        btn.addEventListener('click', () => {
          if (group.key === activeGroupKey) {
            if (group.key === ALL_ITEMS_GROUP_KEY) return;
            toggleVersionsCollapsed(repeat);
            return;
          }
          selectGroup(group.key, { align: true, repeat });
        });
        tabs.appendChild(btn);
      });
    }
    withTabNormalizeSuppressed(() => {
      setTabScrollInstant(groupSetWidth());
      alignActiveGroup({ smooth: false });
      syncNavigation();
    });
  }

  function activeGroup() {
    return COIN_GROUPS.find(group => group.key === activeGroupKey) || COIN_GROUPS[0];
  }

  function groupSetWidth() {
    return tabs.scrollWidth / GROUP_REPEATS;
  }

  function normalizeTabScroll() {
    const setWidth = groupSetWidth();
    if (!setWidth) return;
    if (tabs.scrollLeft < setWidth * 0.25) setTabScrollInstant(tabs.scrollLeft + setWidth);
    if (tabs.scrollLeft > setWidth * 2.05) setTabScrollInstant(tabs.scrollLeft - setWidth);
  }

  function setTabScrollInstant(left) {
    const previousBehavior = tabs.style.scrollBehavior;
    tabs.style.scrollBehavior = 'auto';
    tabs.scrollLeft = left;
    tabs.style.scrollBehavior = previousBehavior;
  }

  function cancelTabScrollAnimation() {
    if (!tabScrollAnimationRaf) return;
    cancelAnimationFrame(tabScrollAnimationRaf);
    tabScrollAnimationRaf = 0;
  }

  function withTabNormalizeSuppressed(fn, ms = 0) {
    suppressTabNormalize = true;
    if (suppressTabNormalizeTimer) {
      clearTimeout(suppressTabNormalizeTimer);
      suppressTabNormalizeTimer = 0;
    }
    try {
      fn();
    } finally {
      if (ms > 0) {
        suppressTabNormalizeTimer = setTimeout(() => {
          suppressTabNormalizeTimer = 0;
          suppressTabNormalize = false;
        }, ms);
      } else {
        requestAnimationFrame(() => {
          suppressTabNormalize = false;
        });
      }
    }
  }

  function startTabDrag(e) {
    if (e.button !== undefined && e.button !== 0) return;
    cancelTabScrollAnimation();
    tabDragPointerId = e.pointerId;
    tabDragStartX = e.clientX;
    tabDragStartScroll = tabs.scrollLeft;
    tabDragMoved = false;
    suppressNextTabClick = false;
    if (suppressTabClickTimer) {
      clearTimeout(suppressTabClickTimer);
      suppressTabClickTimer = 0;
    }
  }

  function moveTabDrag(e) {
    if (tabDragPointerId === null || e.pointerId !== tabDragPointerId) return;
    const dx = e.clientX - tabDragStartX;
    if (!tabDragMoved && Math.abs(dx) > 3) {
      tabAlignToken++;
      tabDragMoved = true;
      suppressNextTabClick = true;
      tabs.classList.add('dragging');
      try { tabs.setPointerCapture(tabDragPointerId); } catch (_) {}
    }
    if (!tabDragMoved) return;
    e.preventDefault();
    tabs.scrollLeft = tabDragStartScroll - dx;
  }

  function stopTabDrag(e) {
    if (tabDragPointerId === null || (e && e.pointerId !== tabDragPointerId)) return;
    if (tabDragMoved) {
      try { tabs.releasePointerCapture(tabDragPointerId); } catch (_) {}
      normalizeTabScroll();
      suppressTabClickTimer = setTimeout(() => {
        suppressTabClickTimer = 0;
        suppressNextTabClick = false;
      }, 250);
    }
    tabDragPointerId = null;
    tabs.classList.remove('dragging');
  }

  function primaryTabInset() {
    return parseFloat(getComputedStyle(root).getPropertyValue('--panel-side-margin')) || 0;
  }

  function tabAlignTarget(btn) {
    return btn.offsetLeft - primaryTabInset();
  }

  function clampTabScroll(left) {
    const maxScroll = Math.max(0, tabs.scrollWidth - tabs.clientWidth);
    return Math.max(0, Math.min(maxScroll, left));
  }

  function correctTabAlignment(btn) {
    const delta = btn.getBoundingClientRect().left - tabs.getBoundingClientRect().left - primaryTabInset();
    if (Math.abs(delta) > 0.5) setTabScrollInstant(clampTabScroll(tabs.scrollLeft + delta));
  }

  function setAlignedTabScroll(btn) {
    setTabScrollInstant(clampTabScroll(tabAlignTarget(btn)));
    correctTabAlignment(btn);
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function animateTabScroll(target, token, done) {
    cancelTabScrollAnimation();
    const start = tabs.scrollLeft;
    const distance = target - start;
    const duration = Math.max(300, Math.min(760, 260 + Math.abs(distance) * 0.42));
    const startedAt = performance.now();
    const step = now => {
      if (token !== tabAlignToken) {
        tabScrollAnimationRaf = 0;
        return;
      }
      const progress = Math.min(1, (now - startedAt) / duration);
      setTabScrollInstant(start + distance * easeInOutCubic(progress));
      if (progress < 1) {
        tabScrollAnimationRaf = requestAnimationFrame(step);
        return;
      }
      tabScrollAnimationRaf = 0;
      done();
    };
    tabScrollAnimationRaf = requestAnimationFrame(step);
    return duration;
  }

  function alignActiveGroup({ smooth = true, repeat = 1, snapRepeat = null } = {}) {
    const buttons = [...tabs.querySelectorAll(`.coin-tab[data-group-key="${activeGroupKey}"]`)];
    const btn = buttons.find(el => el.dataset.repeat === String(repeat));
    if (!btn) return;
    const target = clampTabScroll(tabAlignTarget(btn));
    if (smooth) {
      const token = ++tabAlignToken;
      const duration = Math.max(300, Math.min(760, 260 + Math.abs(target - tabs.scrollLeft) * 0.42));
      withTabNormalizeSuppressed(() => {
        animateTabScroll(target, token, () => {
          setAlignedTabScroll(btn);
          if (snapRepeat !== null && snapRepeat !== repeat) {
            const snapBtn = buttons.find(el => el.dataset.repeat === String(snapRepeat));
            if (snapBtn) setAlignedTabScroll(snapBtn);
          }
        });
      }, duration + 120);
    } else {
      tabAlignToken++;
      cancelTabScrollAnimation();
      setAlignedTabScroll(btn);
      if (snapRepeat !== null && snapRepeat !== repeat) {
        const snapBtn = buttons.find(el => el.dataset.repeat === String(snapRepeat));
        if (snapBtn) setAlignedTabScroll(snapBtn);
      }
    }
  }

  function centerActiveGroupInstant() {
    alignActiveGroup({ smooth: false, repeat: 1 });
  }

  function renderVersionTabs() {
    const group = activeGroup();
    versionTabs.innerHTML = '';
    if (group.key === ALL_ITEMS_GROUP_KEY) return;
    group.coins.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'version-tab';
      btn.dataset.slug = c.slug;
      btn.textContent = keepLastTwoWordsTogether(versionLabel(c));
      btn.addEventListener('click', () => {
        if (c.slug === activeSlug) return;
        selectCoin(c.slug, { alignGroup: false });
      });
      versionTabs.appendChild(btn);
    });
  }

  function keepLastTwoWordsTogether(text) {
    return String(text).replace(/\s+(\S+)$/, '\u00a0$1');
  }

  function versionLabel(c) {
    if (c?.slug === 'cas_aluminum_2013') return '2013 Promo Aluminum';
    if (/mule/i.test(String(c.label || ''))) {
      const material = materialDescriptor(c).replace(/\bMule\b/gi, '').replace(/\s+/g, ' ').trim();
      return [c.year, 'Mule', material].filter(Boolean).join(' ');
    }
    const base = `${c.year || ''} ${c.series || `Series ${seriesValue(c)}`}`.trim();
    const extra = materialDescriptor(c).replace(/\bSilver Gold Rim\b/i, 'Silver w/ Gold Rim');
    return extra ? `${base} ${extra}` : base;
  }

  function syncNavigation() {
    tabs.querySelectorAll('.coin-tab').forEach((btn) => {
      const active = btn.dataset.groupKey === activeGroupKey;
      btn.classList.toggle('active', active);
      btn.classList.toggle('versions-collapsed', active && versionsCollapsed);
      if (active && btn.dataset.groupKey !== ALL_ITEMS_GROUP_KEY) {
        btn.setAttribute('aria-expanded', String(!versionsCollapsed));
      } else {
        btn.removeAttribute('aria-expanded');
      }
    });
    versionTabs.querySelectorAll('.version-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.slug === activeSlug));
  }

  function syncVersionToggle() {
    versionTabs.classList.toggle('collapsed', versionsCollapsed);
    syncNavigation();
    positionVersionPanel();
  }

  function versionPanelMetrics() {
    const buttons = [...versionTabs.querySelectorAll('.version-tab')];
    const activeButton = buttons.find(btn => btn.dataset.slug === activeSlug) || buttons[0];
    const expandedHeight = buttons.reduce((sum, btn) => sum + btn.offsetHeight, 0);
    const activeTop = activeButton ? activeButton.offsetTop : 0;
    const activeHeight = activeButton?.offsetHeight || 0;
    return { activeHeight, activeTop, expandedHeight };
  }

  function positionVersionPanel() {
    const { activeHeight, activeTop, expandedHeight } = versionPanelMetrics();
    const height = versionsCollapsed ? activeHeight : expandedHeight;
    const offset = versionsCollapsed ? -activeTop : 0;
    root.style.setProperty('--version-panel-height', `${Math.max(0, Math.ceil(height))}px`);
    root.style.setProperty('--version-collapse-offset', `${Math.round(offset)}px`);
    updateSidePanelLayouts();
  }

  function trackVersionPanelAnimation(token, duration = 380) {
    if (versionPanelAnimationRaf) cancelAnimationFrame(versionPanelAnimationRaf);
    const startedAt = performance.now();
    const step = now => {
      if (token !== versionPanelAnimationToken) {
        versionPanelAnimationRaf = 0;
        return;
      }
      updateBottomReservedSpace();
      updateComparisonSpacing();
      if (now - startedAt < duration) {
        versionPanelAnimationRaf = requestAnimationFrame(step);
        return;
      }
      versionPanelAnimationRaf = 0;
      updateBottomReservedSpace();
      updateComparisonSpacing();
    };
    versionPanelAnimationRaf = requestAnimationFrame(step);
  }

  function toggleVersionsCollapsed(repeat = 1) {
    positionVersionPanel();
    const token = ++versionPanelAnimationToken;
    versionsCollapsed = !versionsCollapsed;
    saveVersionsCollapsed();
    requestAnimationFrame(() => {
      syncVersionToggle();
      trackVersionPanelAnimation(token);
      updateBottomReservedSpace();
      updateComparisonSpacing();
      alignActiveGroup({ smooth: true, repeat, snapRepeat: 1 });
    });
  }

  function updateGroupThumb(c) {
    const group = COIN_GROUPS.find(g => g.key === groupKey(c));
    if (!group) return;
    tabs.querySelectorAll(`.coin-tab[data-group-key="${group.key}"] .thumb`).forEach((thumb) => {
      applyTabThumb(thumb, c);
    });
  }

  function cycleRepeatTarget(previousKey, nextKey, direction) {
    const previousIndex = Math.max(0, COIN_GROUPS.findIndex(group => group.key === previousKey));
    const nextIndex = Math.max(0, COIN_GROUPS.findIndex(group => group.key === nextKey));
    if (direction > 0 && nextIndex < previousIndex) return 2;
    if (direction < 0 && nextIndex > previousIndex) return 0;
    return 1;
  }

  function selectGroup(key, { align = false, direction = 0, repeat = null } = {}) {
    const group = COIN_GROUPS.find(g => g.key === key);
    if (!group) return;
    const previousKey = activeGroupKey;
    if (group.key === ALL_ITEMS_GROUP_KEY) {
      enterAllItemsMode({ align, direction, repeat, previousKey });
      return;
    }
    activeGroupKey = group.key;
    renderVersionTabs();
    if (align) {
      const targetRepeat = repeat ?? cycleRepeatTarget(previousKey, group.key, direction);
      alignActiveGroup({ repeat: targetRepeat, snapRepeat: 1 });
    }
    selectCoin(rememberedGroupSlug(group), { alignGroup: false });
  }

  function cycleVariant(direction) {
    const group = activeGroup();
    if (!group || group.coins.length <= 1) return;
    const currentIndex = group.coins.findIndex(c => c.slug === activeSlug);
    const nextIndex = (currentIndex + direction + group.coins.length) % group.coins.length;
    selectCoin(group.coins[nextIndex].slug, { alignGroup: false });
  }

  function cycleGroup(direction) {
    centerActiveGroupInstant();
    const currentIndex = Math.max(0, COIN_GROUPS.findIndex(group => group.key === activeGroupKey));
    const next = COIN_GROUPS[(currentIndex + direction + COIN_GROUPS.length) % COIN_GROUPS.length];
    selectGroup(next.key, { align: true, direction });
  }

  function clearEdges() {
    model.querySelectorAll('.edge, .bar-edge-segment').forEach(el => el.remove());
  }

  function clearQuarterEdges() {
    quarterModel.querySelectorAll('.edge').forEach(el => el.remove());
  }

  function mixRgb(a, b, t) {
    return a.map((v, i) => Math.round(v + (b[i] - v) * t));
  }

  function rgbCss(rgb) {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  function angularColor(samples, theta) {
    const tau = Math.PI * 2;
    const normalized = ((theta % tau) + tau) % tau;
    const positions = [0, Math.PI / 2, Math.PI, Math.PI * 1.5, tau];
    const colors = [samples.right, samples.bottom, samples.left, samples.top, samples.right];
    for (let i = 0; i < positions.length - 1; i++) {
      if (normalized >= positions[i] && normalized <= positions[i + 1]) {
        return mixRgb(colors[i], colors[i + 1], (normalized - positions[i]) / (positions[i + 1] - positions[i]));
      }
    }
    return samples.right;
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = imageUrl(dataUrl);
    });
  }

  async function sampleCoinEdgePalette(c) {
    const cacheKey = c.slug;
    if (smoothEdgePaletteCache.has(cacheKey)) return smoothEdgePaletteCache.get(cacheKey);

    const readSamples = async (dataUrl) => {
      const img = await loadImage(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const radius = Math.min(canvas.width, canvas.height) / 2;
      const dirs = {
        right: [1, 0],
        bottom: [0, 1],
        left: [-1, 0],
        top: [0, -1]
      };
      const sampleDir = ([dx, dy]) => {
        const gathered = [];
        for (let r = radius - 2; r > radius * 0.72 && gathered.length < 10; r -= 1) {
          const x = Math.max(0, Math.min(canvas.width - 1, Math.round(cx + dx * r)));
          const y = Math.max(0, Math.min(canvas.height - 1, Math.round(cy + dy * r)));
          const p = ctx.getImageData(x, y, 1, 1).data;
          if (p[3] > 24) gathered.push([p[0], p[1], p[2]]);
        }
        if (!gathered.length) return [120, 78, 22];
        return gathered.reduce((acc, rgb) => acc.map((v, i) => v + rgb[i]), [0, 0, 0])
          .map(v => Math.round(v / gathered.length));
      };
      return Object.fromEntries(Object.entries(dirs).map(([name, dir]) => [name, sampleDir(dir)]));
    };

    const promise = Promise.all([readSamples(c.frontData), readSamples(c.backData)])
      .then(([front, back]) => ({ front, back }))
      .catch(() => null);
    smoothEdgePaletteCache.set(cacheKey, promise);
    return promise;
  }

  function buildCoinEdges(c) {
    const edgeClass = c.edgeStyle === 'reeded' ? 'reeded' : 'smooth';
    const coinSize = parseFloat(getComputedStyle(root).getPropertyValue('--object-w')) || 420;
    const radius = coinSize / 2;
    const segmentCount = edgeClass === 'smooth' ? SMOOTH_EDGE_SEGMENTS : COIN_SEGMENTS;
    const segmentWidth = Math.ceil((2 * Math.PI * radius) / segmentCount) + (edgeClass === 'smooth' ? 3 : 1);
    const cachedPalette = smoothEdgePaletteCache.get(c.slug);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < segmentCount; i++) {
      const seg = document.createElement('i');
      seg.className = `edge ${edgeClass}`;
      seg.style.width = segmentWidth + 'px';
      seg.style.marginLeft = (-segmentWidth / 2) + 'px';
      const theta = (360 / segmentCount) * i;
      seg.style.transform = `rotateZ(${theta}deg) translateY(${-radius}px) rotateX(90deg)`;
      if (edgeClass === 'reeded') {
        const shade = 76 + Math.round(22 * Math.sin(i / segmentCount * Math.PI * 4));
        seg.style.filter = `brightness(${shade}%)`;
      } else if (cachedPalette && !(cachedPalette instanceof Promise)) {
        const thetaRad = theta * Math.PI / 180;
        const frontColor = angularColor(cachedPalette.front, thetaRad);
        const backColor = angularColor(cachedPalette.back, thetaRad);
        const light = Math.max(0, Math.cos(thetaRad - Math.PI * 1.72));
        const glint = Math.max(0, Math.cos(thetaRad - Math.PI * 1.55));
        const shadow = Math.max(0, Math.cos(thetaRad - Math.PI * 0.70));
        const sheenAlpha = (0.10 + glint * 0.58).toFixed(3);
        const darkAlpha = (0.10 + shadow * 0.24).toFixed(3);
        const brightness = 76 + light * 46 - shadow * 13;
        const saturate = 104 + light * 24;
        seg.style.background = `
          linear-gradient(90deg,
            rgba(0,0,0,${darkAlpha}) 0%,
            rgba(255,255,255,${(sheenAlpha * 0.42).toFixed(3)}) 23%,
            rgba(255,255,255,${sheenAlpha}) 42%,
            rgba(255,255,255,${(sheenAlpha * 0.30).toFixed(3)}) 54%,
            rgba(0,0,0,${(darkAlpha * 0.78).toFixed(3)}) 100%),
          linear-gradient(180deg, ${rgbCss(frontColor)}, ${rgbCss(backColor)})
        `;
        seg.style.filter = `brightness(${brightness.toFixed(1)}%) saturate(${saturate.toFixed(1)}%) contrast(108%)`;
      }
      frag.appendChild(seg);
    }
    model.insertBefore(frag, model.firstChild);

    if (edgeClass === 'smooth' && !cachedPalette) {
      sampleCoinEdgePalette(c).then((palette) => {
        if (!palette || comparisonCoin().slug !== c.slug) return;
        smoothEdgePaletteCache.set(c.slug, palette);
        buildEdges();
      });
    } else if (cachedPalette instanceof Promise) {
      cachedPalette.then((palette) => {
        if (!palette || comparisonCoin().slug !== c.slug) return;
        smoothEdgePaletteCache.set(c.slug, palette);
        buildEdges();
      });
    }
  }

  function buildQuarterEdges() {
    clearQuarterEdges();
    const coinSize = parseFloat(getComputedStyle(root).getPropertyValue('--quarter-size')) || 92;
    const radius = coinSize * 0.5;
    const segmentCount = QUARTER_REEDS;
    const segmentWidth = Math.ceil((2 * Math.PI * radius) / segmentCount) + 1;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < segmentCount; i++) {
      const seg = document.createElement('i');
      seg.className = 'edge reeded';
      seg.style.width = segmentWidth + 'px';
      seg.style.marginLeft = (-segmentWidth / 2) + 'px';
      const theta = (360 / segmentCount) * i;
      seg.style.transform = `rotateZ(${theta}deg) translateY(${-radius}px) rotateX(90deg)`;
      const light = Math.max(0, Math.cos(theta * Math.PI / 180 - Math.PI * 1.72));
      const wear = Math.sin(i * 1.91) * 5 + Math.sin(i * 0.43) * 3;
      const shade = 72 + light * 42 + wear;
      const copperWarmth = 94 + Math.max(0, Math.sin(i * 0.37)) * 18;
      seg.style.filter = `brightness(${shade.toFixed(1)}%) saturate(${copperWarmth.toFixed(1)}%) contrast(112%)`;
      frag.appendChild(seg);
    }
    quarterModel.insertBefore(frag, quarterModel.firstChild);
  }

  function addBarSegment(frag, x, y, ang, len, thick, halfW, halfH, region = '') {
    const el = document.createElement('i');
    const insetY = /^bottom/.test(region) ? thick * BAR_BOTTOM_EDGE_INSET_RATIO : 0;
    const drawY = y - insetY;
    el.className = 'bar-edge-segment';
    el.style.width = len + 'px';
    el.style.height = thick + 'px';
    el.style.marginLeft = (-len / 2) + 'px';
    el.style.marginTop = (-thick / 2) + 'px';
    el.style.transform = `translate3d(${x.toFixed(2)}px, ${drawY.toFixed(2)}px, 0) rotateZ(${ang.toFixed(2)}deg) rotateX(90deg)`;
    const clamp01 = value => Math.max(0, Math.min(1, value));
    const mixColor = (dark, light, amount) => {
      const parse = (hex) => hex.match(/\w\w/g).map(v => parseInt(v, 16));
      const d = parse(dark);
      const l = parse(light);
      const t = clamp01(amount);
      return `#${d.map((v, i) => Math.round(v + (l[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
    };
    el.style.setProperty('--bar-thickness-angle', '0deg');
    const topGold = '#b98224';
    const sideGold = '#7a5016';
    const bottomGold = '#5f3a0e';
    const segmentColor = (() => {
      if (region === 'top') return topGold;
      if (region === 'right' || region === 'left') return sideGold;
      if (region === 'bottom') return bottomGold;
      if (region === 'top-right-arc') return mixColor(topGold, sideGold, ang / 90);
      if (region === 'bottom-right-arc') return mixColor(sideGold, bottomGold, (ang - 90) / 90);
      if (region === 'bottom-left-arc') return mixColor(bottomGold, sideGold, (ang - 180) / 90);
      if (region === 'top-left-arc') return mixColor(sideGold, topGold, (ang - 270) / 90);
      return sideGold;
    })();
    ['--bar-thick-a', '--bar-thick-b', '--bar-thick-c', '--bar-edge-a', '--bar-edge-b', '--bar-edge-c']
      .forEach(name => el.style.setProperty(name, segmentColor));
    ['--bar-front-light', '--bar-front-mid', '--bar-front-shine', '--bar-back-light', '--bar-back-mid', '--bar-back-shine',
      '--bar-top-glint', '--bar-top-wash', '--bar-bottom-occlusion', '--bar-bottom-wash', '--bar-left-wash', '--bar-right-wash']
      .forEach(name => el.style.setProperty(name, '0'));
    el.style.filter = 'brightness(100%) saturate(108%)';
    frag.appendChild(el);
  }

  function buildBarEdges() {
    const w = parseFloat(getComputedStyle(root).getPropertyValue('--object-w'));
    const h = parseFloat(getComputedStyle(root).getPropertyValue('--object-h'));
    const t = parseFloat(getComputedStyle(root).getPropertyValue('--thickness'));
    const r = parseFloat(getComputedStyle(root).getPropertyValue('--face-radius'));
    const cachedTemplate = barEdgeTemplateCache.get(BAR_EDGE_CACHE_KEY);
    if (cachedTemplate) {
      model.insertBefore(cachedTemplate.content.cloneNode(true), model.firstChild);
      return;
    }
    const halfW = w / 2;
    const halfH = h / 2;
    const straightX = Math.max(0, w - 2 * r);
    const straightY = Math.max(0, h - 2 * r);
    const step = Math.max(BAR_EDGE_MIN_STEP_PX, w * BAR_EDGE_STRAIGHT_STEP_RATIO);
    const segLen = step + BAR_EDGE_SEGMENT_OVERLAP_PX;
    const straightLenX = Math.max(0, straightX + BAR_EDGE_SEGMENT_OVERLAP_PX);
    const straightLenY = Math.max(0, straightY + BAR_EDGE_SEGMENT_OVERLAP_PX);
    const arcStep = BAR_EDGE_ARC_STEP_DEGREES;
    const frag = document.createDocumentFragment();

    if (straightLenX > 0) addBarSegment(frag, 0, -halfH, 0, straightLenX, t, halfW, halfH, 'top');
    for (let a = -90; a <= 0.001; a += arcStep) {
      const rad = a * Math.PI / 180;
      const cx = halfW - r, cy = -halfH + r;
      addBarSegment(frag, cx + Math.cos(rad) * r, cy + Math.sin(rad) * r, a + 90, segLen, t, halfW, halfH, 'top-right-arc');
    }
    if (straightLenY > 0) addBarSegment(frag, halfW, 0, 90, straightLenY, t, halfW, halfH, 'right');
    for (let a = 0; a <= 90.001; a += arcStep) {
      const rad = a * Math.PI / 180;
      const cx = halfW - r, cy = halfH - r;
      addBarSegment(frag, cx + Math.cos(rad) * r, cy + Math.sin(rad) * r, a + 90, segLen, t, halfW, halfH, 'bottom-right-arc');
    }
    if (straightLenX > 0) addBarSegment(frag, 0, halfH, 180, straightLenX, t, halfW, halfH, 'bottom');
    for (let a = 90; a <= 180.001; a += arcStep) {
      const rad = a * Math.PI / 180;
      const cx = -halfW + r, cy = halfH - r;
      addBarSegment(frag, cx + Math.cos(rad) * r, cy + Math.sin(rad) * r, a + 90, segLen, t, halfW, halfH, 'bottom-left-arc');
    }
    if (straightLenY > 0) addBarSegment(frag, -halfW, 0, 270, straightLenY, t, halfW, halfH, 'left');
    for (let a = 180; a <= 270.001; a += arcStep) {
      const rad = a * Math.PI / 180;
      const cx = -halfW + r, cy = -halfH + r;
      addBarSegment(frag, cx + Math.cos(rad) * r, cy + Math.sin(rad) * r, a + 90, segLen, t, halfW, halfH, 'top-left-arc');
    }
    const template = document.createElement('template');
    template.content.appendChild(frag);
    barEdgeTemplateCache.set(BAR_EDGE_CACHE_KEY, template);
    model.insertBefore(template.content.cloneNode(true), model.firstChild);
  }

  function buildEdges() {
    clearEdges();
    const c = comparisonCoin();
    if (c.shape === 'bar') {
      buildBarEdges();
    } else {
      buildCoinEdges(c);
    }
  }

  function syncFocusedAllItemsModel({ updateOverlay = true, show = true } = {}) {
    if (!allItemsMode) return;
    const c = allItemsFocusedCoin();
    const frontFace = model.querySelector('.front');
    const backFace = model.querySelector('.back');
    const firstbits = selectedObjectAddress().slice(0, 8);
    model.classList.toggle('bar-active', c.shape === 'bar');
    model.classList.toggle('coin-back-address-active', c.shape !== 'bar' && Boolean(firstbits));
    frontFace.style.backgroundImage = cssUrl(c.frontData);
    backFace.style.backgroundImage = cssUrl(c.backData);
    frontFace.style.backgroundPosition = c.frontPosition || 'center';
    backFace.style.backgroundPosition = c.backPosition || 'center';
    const fittedFaceBackgroundSize = c.shape === 'bar'
      ? (c.faceDiameterScale ? `${(clampNumber(c.faceDiameterScale, 1, 0.7, 1.18) * 100).toFixed(3)}%` : 'cover')
      : '100% 100%';
    frontFace.style.backgroundSize = c.frontBackgroundSize || fittedFaceBackgroundSize;
    backFace.style.backgroundSize = c.backBackgroundSize || fittedFaceBackgroundSize;
    root.style.setProperty('--front-image', 'none');
    root.style.setProperty('--back-image', 'none');
    renderBarAddress(c.shape === 'bar' ? firstbits : '', c);
    renderCoinBackAddress(c.shape === 'bar' ? '' : firstbits, c);
    buildEdges();
    model.style.opacity = '';
    model.classList.add('loaded');
    allItemsRevealedModelSlug = c.slug;
    if (show) {
      scene.style.opacity = '';
      scene.style.visibility = '';
      scene.style.pointerEvents = '';
      app.classList.remove('all-items-model-pending', 'all-items-model-hidden');
    }
    clearAllItemsExtraScene();
    if (updateOverlay) syncAllItemsFocusedOverlay();
    if (show) syncAllItemsExtraModelPosition();
  }

  function syncFocusedAllItemsModelWhenLoaded({ updateOverlay = true, reveal = true } = {}) {
    if (!allItemsMode) return Promise.resolve(false);
    const slug = allItemsFocusedSlug;
    const shouldReveal = reveal && !app.classList.contains('all-items-model-hidden');
    if (coin3dDataLoaded(slug)) {
      if (shouldReveal) syncFocusedAllItemsModel({ updateOverlay });
      return Promise.resolve(true);
    }
    if (shouldReveal) hideAllItemsFocusedModel();
    const loadingKey = `all-items-sync:${slug}:${allItemsModelRevealToken}`;
    if (shouldReveal) setStageLoading(loadingKey, true);
    return loadCoin3dData(slug)
      .then(() => {
        if (!allItemsMode || allItemsFocusedSlug !== slug) return false;
        if (shouldReveal) {
          syncFocusedAllItemsModel({ updateOverlay });
          renderAllItems({ wrap: false, updateOverlay });
        }
        return true;
      })
      .catch(() => false)
      .finally(() => setStageLoading(loadingKey, false));
  }

  function waitForAllItemsRevealPaint(slug, token) {
    return new Promise(resolve => {
      let frames = 2;
      const valid = () => token === allItemsModelRevealToken && allItemsMode && allItemsFocusedSlug === slug;
      const step = () => {
        if (!valid()) {
          resolve(false);
          return;
        }
        if (frames > 0) {
          frames -= 1;
          requestAnimationFrame(step);
          return;
        }
        setTimeout(() => resolve(valid()), ALL_ITEMS_REVEAL_PAINT_BUFFER_MS);
      };
      requestAnimationFrame(step);
    });
  }

  function revealFocusedAllItemsModel({ updateOverlay = true, animateTransform = false, targetAngle = angle, targetTilt = tilt } = {}) {
    if (!allItemsMode) return Promise.resolve(false);
    const slug = allItemsFocusedSlug;
    hideAllItemsFocusedModel({ invalidateReveal: false });
    const token = ++allItemsModelRevealToken;
    const loadingKey = `all-items-reveal:${token}`;
    setStageLoading(loadingKey, true);
    return loadCoin3dData(slug)
      .then(() => {
        if (token !== allItemsModelRevealToken || !allItemsMode || allItemsFocusedSlug !== slug) return false;
        const c = allItemsFocusedCoin();
        const startAngle = viewAngle(allItemsViewMode, c);
        return Promise.allSettled([loadImage(c.frontData), loadImage(c.backData)]).then(() => {
          if (token !== allItemsModelRevealToken || !allItemsMode || allItemsFocusedSlug !== slug) return false;
          syncFocusedAllItemsModel({ updateOverlay, show: false });
          setAllItemsPrimarySceneTransform(startAngle, FACE_ON_TILT);
          scene.style.opacity = '';
          scene.style.visibility = '';
          scene.style.pointerEvents = '';
          app.classList.remove('all-items-model-pending', 'all-items-model-hidden');
          scene.getBoundingClientRect();
          return waitForAllItemsRevealPaint(slug, token).then((painted) => {
            if (!painted) return false;
            renderAllItems({ wrap: false, updateOverlay });
            syncAllItemsExtraModelPosition();
            return waitForAllItemsRevealPaint(slug, token).then((masked) => {
              if (!masked) return false;
              if (animateTransform) animateAllItemsSelectionTransform(c, targetAngle, targetTilt);
              else clearAllItemsRenderedSceneTransform();
              return true;
            });
          });
        });
      })
      .catch(() => false)
      .finally(() => setStageLoading(loadingKey, false));
  }

  function pausedHologramShapeTargetAngle(previousCoin, nextCoin) {
    if (running || activeViewMode !== 'hologram' || !previousCoin || !nextCoin) return null;
    if (previousCoin.shape === nextCoin.shape) return null;
    return viewAngle('hologram', nextCoin);
  }

  function syncQuarterComparison() {
    updateComparisonSpacing();
    app.classList.toggle('quarter-comparison', quarterComparisonInput.checked);
    app.classList.toggle('bar-comparison', quarterComparisonInput.checked && comparisonCoin().shape === 'bar');
    updateSingleItemViewportCenter();
    if (quarterComparisonInput.checked) app.classList.remove('quarter-exiting');
    if (quarterComparisonInput.checked && !quarterModel.querySelector('.edge')) {
      buildQuarterEdges();
    }
    if (allItemsMode) {
      updateAllItemsQuarterPlacement();
      renderAllItems({ wrap: false, syncTarget: !app.classList.contains('all-items-booting') });
    }
  }

  async function selectCoin(slug, { alignGroup = true, preservedSelection = null } = {}) {
    const token = ++selectionToken;
    const loadingKey = `model:${token}`;
    setStageLoading(loadingKey, true);
    searchAddressNotFound = false;
    searchedUnfundedEntry = null;
    pendingSearchSelection = preservedSelection?.address
      ? {
          address: String(preservedSelection.address || ''),
          mode: validLeftPanelMode(preservedSelection.mode)
        }
      : null;
    const requestedCoin = COINS.find(x => x.slug === slug);
    const c = requestedCoin || COINS.find(x => !x.allModeOnly) || COINS[0];
    const previousCoin = activeCoin();
    const pausedHologramTargetAngle = pausedHologramShapeTargetAngle(previousCoin, c);
    const frontFace = model.querySelector('.front');
    const backFace = model.querySelector('.back');
    const previousQuarterLayout = captureQuarterLayout();
    if (previousQuarterLayout) app.classList.add('layout-switching');
    exitAllItemsMode();
    activeSlug = c.slug;
    if (pausedHologramTargetAngle !== null) {
      angle = pausedHologramTargetAngle;
    }
    activeGroupKey = groupKey(c);
    refreshBalanceChartHover();
    saveActiveSlug(c.slug);
    rememberGroupSelection(c);
    updateGroupThumb(c);
    model.classList.remove('loaded');
    clearEdges();
    applyDimensions(c);
    setMetal(c.metal || 'gold');
    setSelectedTitle(chartDisplayName(c), dimensionText(c));
    updateBottomReservedSpace();
    updateComparisonSpacing();
    renderVersionTabs();
    syncVersionToggle();
    syncViewButtons();
    if (alignGroup) alignActiveGroup();
    model.classList.toggle('bar-active', c.shape === 'bar');
    model.classList.toggle('coin-back-address-active', Boolean(c.backAddressFirstbits));
    syncQuarterComparison();
    const playQuarterLayoutAnimation = prepareQuarterLayoutAnimation(previousQuarterLayout);
    app.classList.remove('layout-switching');
    if (playQuarterLayoutAnimation) playQuarterLayoutAnimation();
    try {
      try {
        await loadCoin3dData(c.slug);
      } catch (_) {}
      if (token !== selectionToken) return;
      renderBarAddress(c.addressFirstbits || '', c);
      renderCoinBackAddress(c.backAddressFirstbits || '', c);
      frontFace.style.backgroundImage = cssUrl(c.frontData);
      backFace.style.backgroundImage = cssUrl(c.backData);
      frontFace.style.backgroundPosition = c.frontPosition || 'center';
      backFace.style.backgroundPosition = c.backPosition || 'center';
      const fittedFaceBackgroundSize = c.shape === 'bar'
        ? (c.faceDiameterScale ? `${(clampNumber(c.faceDiameterScale, 1, 0.7, 1.18) * 100).toFixed(3)}%` : 'cover')
        : '100% 100%';
      frontFace.style.backgroundSize = c.frontBackgroundSize || fittedFaceBackgroundSize;
      backFace.style.backgroundSize = c.backBackgroundSize || fittedFaceBackgroundSize;
      root.style.setProperty('--front-image', 'none');
      root.style.setProperty('--back-image', 'none');
      buildEdges();
      if (quarterComparisonInput.checked) buildQuarterEdges();
      setTransform();
      Promise.allSettled([loadImage(c.frontData), loadImage(c.backData)]).then(() => {
        if (token !== selectionToken) return;
        requestAnimationFrame(() => {
          if (token === selectionToken) {
            model.classList.add('loaded');
            scheduleDataPanelsRefresh();
            setStageLoading(loadingKey, false);
          }
        });
      }).finally(() => {
        if (token !== selectionToken) setStageLoading(loadingKey, false);
      });
    } finally {
      if (token !== selectionToken) setStageLoading(loadingKey, false);
    }
  }

  function setTransform({ save = true, orbitAngle = angle } = {}) {
    const normalizedOrbitAngle = normalizeAngle(orbitAngle);
    root.style.setProperty('--spin', angle + 'deg');
    root.style.setProperty('--orbit-angle', normalizedOrbitAngle + 'deg');
    root.style.setProperty('--tilt', tilt + 'deg');
    updateOrbitMarker(orbitAngle);
    updateTiltControl();
    if (save) saveViewState();
  }

  function animateTiltToBaseline() {
    const targetTilt = FACE_ON_TILT;
    const startTilt = tilt;
    const delta = targetTilt - startTilt;
    const token = ++transformAnimationToken;
    const start = performance.now();
    const duration = 260;
    if (Math.abs(delta) < 0.01) {
      tilt = targetTilt;
      setTransform();
      return;
    }
    function step(now) {
      if (token !== transformAnimationToken) return;
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const ease = 1 - Math.pow(1 - t, 3);
      tilt = startTilt + delta * ease;
      setTransform({ save: false });
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        tilt = targetTilt;
        setTransform();
      }
    }
    requestAnimationFrame(step);
  }

  function animateTo(targetAngle, targetTilt = tilt, { targetZoom = null, save = true } = {}) {
    const token = ++transformAnimationToken;
    running = false;
    toggle.classList.remove('is-running');
    toggle.setAttribute('aria-label', 'Spin');
    if (allItemsMode) clearAllItemsRenderedSceneTransform();
    const startAngle = normalizeAngle(angle);
    const startTilt = tilt;
    const startZoom = Number(zoomInput.value);
    const shouldAnimateZoom = targetZoom !== null && targetZoom !== undefined && Number.isFinite(Number(targetZoom));
    const delta = ((((targetAngle - startAngle) % 360) + 540) % 360) - 180;
    const start = performance.now() + 16;
    const duration = 560;
    angle = startAngle;
    setTransform({ save: false });
    function step(now) {
      if (token !== transformAnimationToken) return;
      const t = Math.min(1, (now - start) / duration);
      if (t <= 0) {
        requestAnimationFrame(step);
        return;
      }
      const ease = 1 - Math.pow(1 - t, 3);
      angle = startAngle + delta * ease;
      tilt = startTilt + (targetTilt - startTilt) * ease;
      if (shouldAnimateZoom) {
        applyZoomValue(startZoom + (Number(targetZoom) - startZoom) * ease);
      }
      setTransform({ save: false });
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        if (shouldAnimateZoom) applyZoomValue(Number(targetZoom));
        if (save) saveViewState(true);
      }
    }
    requestAnimationFrame(step);
  }

  function allItemsRenderedScenes() {
    return [scene, allItemsExtraScene].filter(Boolean);
  }

  function setAllItemsPrimarySceneTransform(spin, sceneTilt) {
    scene.style.setProperty('--model-spin', `${spin}deg`);
    scene.style.setProperty('--model-tilt', `${sceneTilt}deg`);
  }

  function clearAllItemsRenderedSceneTransform() {
    allItemsRenderedScenes().forEach(targetScene => {
      targetScene.style.removeProperty('--model-spin');
      targetScene.style.removeProperty('--model-tilt');
    });
  }

  function animateAllItemsSelectionTransform(c, targetAngle, targetTilt) {
    const token = ++transformAnimationToken;
    const startAngle = viewAngle(allItemsViewMode, c);
    const startTilt = FACE_ON_TILT;
    const targetBaseAngle = normalizeAngle(targetAngle);
    const targetBaseTilt = clampNumber(targetTilt, FACE_ON_TILT, TILT_MIN, TILT_MAX);
    const wasRunning = running;
    const start = performance.now();
    const duration = 260;
    setAllItemsPrimarySceneTransform(startAngle, startTilt);
    function step(now) {
      if (token !== transformAnimationToken) return;
      const elapsed = Math.max(0, now - start);
      const t = Math.min(1, elapsed / duration);
      const liveTargetAngle = targetBaseAngle + (wasRunning ? elapsed * speed : 0);
      const delta = wasRunning
        ? normalizeAngle(liveTargetAngle - startAngle)
        : ((((liveTargetAngle - startAngle) % 360) + 540) % 360) - 180;
      const ease = 1 - Math.pow(1 - t, 3);
      setAllItemsPrimarySceneTransform(
        startAngle + delta * ease,
        startTilt + (targetBaseTilt - startTilt) * ease
      );
      if (t < 1) {
        setTimeout(() => step(performance.now()), 16);
      } else {
        clearAllItemsRenderedSceneTransform();
      }
    }
    setTimeout(() => step(performance.now()), 16);
  }

  function viewAngle(mode, c = activeCoin()) {
    if (mode === 'front') return 0;
    if (mode === 'back') return 180;
    return c.shape === 'bar' ? 0 : 180;
  }

  function nearestFaceMode() {
    const a = normalizeAngle(angle);
    return a > 90 && a < 270 ? 'back' : 'front';
  }

  function nearestFaceTarget() {
    const mode = nearestFaceMode();
    return { mode, angle: viewAngle(mode) };
  }

  function syncViewButtons() {
    [
      [frontBtn, 'front'],
      [backBtn, 'back'],
      [hologramBtn, 'hologram']
    ].forEach(([btn, mode]) => {
      const active = activeViewMode === mode;
      btn.classList.toggle('view-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function applyAllItemsViewMode(mode, { save = false, updateImages = true } = {}) {
    allItemsViewMode = normalizeViewMode(mode) || 'front';
    activeViewMode = allItemsViewMode;
    syncViewButtons();
    if (save) saveAllItemsViewMode(allItemsViewMode);
    if (updateImages) updateAllItemsImages();
  }

  function clearViewMode() {
    if (allItemsMode) {
      activeViewMode = allItemsViewMode;
      syncViewButtons();
      return;
    }
    if (!activeViewMode) return;
    activeViewMode = null;
    syncViewButtons();
  }

  function setViewMode(mode, { animate = true, coin = activeCoin(), targetAngle = null, targetZoom = null } = {}) {
    activeViewMode = mode;
    if (allItemsMode) {
      applyAllItemsViewMode(mode, { save: true });
      const focusedCoin = allItemsFocusedCoin();
      const resolvedTargetAngle = targetAngle === null || targetAngle === undefined ? viewAngle(mode, focusedCoin) : targetAngle;
      if (animate) {
        animateTo(resolvedTargetAngle, FACE_ON_TILT, { targetZoom, save: false });
      } else {
        angle = resolvedTargetAngle;
        tilt = FACE_ON_TILT;
        if (targetZoom !== null && targetZoom !== undefined && Number.isFinite(Number(targetZoom))) applyZoomValue(Number(targetZoom));
        setTransform({ save: false });
      }
      return;
    }
    syncViewButtons();
    const resolvedTargetAngle = targetAngle === null || targetAngle === undefined ? viewAngle(mode, coin) : targetAngle;
    if (animate) {
      animateTo(resolvedTargetAngle, FACE_ON_TILT, { targetZoom });
    } else {
      angle = resolvedTargetAngle;
      tilt = FACE_ON_TILT;
      if (targetZoom !== null && targetZoom !== undefined && Number.isFinite(Number(targetZoom))) applyZoomValue(Number(targetZoom));
      setTransform();
    }
  }

  function selectRelative(delta) {
    cycleGroup(delta);
  }

  function togglePlayback() {
    running = !running;
    if (running) {
      clearViewMode();
    }
    toggle.classList.toggle('is-running', running);
    toggle.setAttribute('aria-label', running ? 'Stop spinning' : 'Spin');
    saveViewState(true);
  }

  function flattenToNearestFace() {
    const target = nearestFaceTarget();
    if (allItemsMode) {
      animateTo(target.angle, FACE_ON_TILT, { targetZoom: 100, save: false });
      return;
    }
    setViewMode(target.mode, { targetAngle: target.angle, targetZoom: 100 });
  }

  function resetSingleViewInteraction(targetScene) {
    if (targetScene === gradedCaseScene && gradedCaseModeActive()) {
      resetGradedCasePan();
    }
    flattenToNearestFace();
  }

  function render(now) {
    const dt = Math.min(64, now - last);
    last = now;
    if (running && !dragging) {
      angle = (angle + dt * speed) % 360;
      setTransform({ save: false });
    }
    requestAnimationFrame(render);
  }

  function beginModelDrag(e, targetScene) {
    cancelTransformAnimation();
    if (allItemsMode && targetScene === scene) clearAllItemsRenderedSceneTransform();
    dragging = true;
    dragTarget = targetScene;
    pointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    dragDistance = 0;
    targetScene.setPointerCapture(pointerId);
    targetScene.classList.add('dragging');
  }

  function pinchDistance(points) {
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function pinchMidpoint(points) {
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2
    };
  }

  function allItemsPinchAnchor(point) {
    const rect = stageCenterRect();
    return {
      x: point.x - (rect.left + rect.width / 2),
      y: point.y - (rect.top + rect.height / 2)
    };
  }

  function clearDragForPinch() {
    if (dragging) {
      dragTarget?.classList.remove('dragging');
      try { dragTarget?.releasePointerCapture(pointerId); } catch (_) {}
      dragging = false;
      dragTarget = null;
      pointerId = null;
    }
    if (allItemsDragging) stopAllItemsDrag();
    if (allItemsModelDragPending) {
      try { allItemsModelDragTarget?.releasePointerCapture(allItemsModelDragPointerId); } catch (_) {}
      clearAllItemsModelDragPending();
    }
    if (gradedCasePanning) stopGradedCasePan();
  }

  function beginPinchIfReady() {
    if (pinchActive || pinchPointers.size < 2) return;
    const points = [...pinchPointers.values()].slice(-2);
    const distance = pinchDistance(points);
    if (distance < 12) return;
    const midpoint = pinchMidpoint(points);
    clearDragForPinch();
    cancelTransformAnimation();
    pinchActive = true;
    pinchStartDistance = distance;
    pinchStartZoom = Number(zoomInput.value) || 100;
    pinchTargetMode = allItemsMode ? 'all-items' : 'model';
    pinchAnchorPoint = allItemsMode ? allItemsPinchAnchor(midpoint) : null;
    clearViewMode();
    points.forEach(point => point.target?.classList?.add('zooming'));
  }

  function trackPinchPointer(e, target) {
    if (e.pointerType === 'mouse') return false;
    pinchPointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      target
    });
    beginPinchIfReady();
    if (!pinchActive) return false;
    e.preventDefault();
    return true;
  }

  function updatePinchPointer(e) {
    if (!pinchPointers.has(e.pointerId)) return false;
    const point = pinchPointers.get(e.pointerId);
    point.x = e.clientX;
    point.y = e.clientY;
    if (!pinchActive) {
      beginPinchIfReady();
      return pinchActive;
    }
    const points = [...pinchPointers.values()].slice(-2);
    const distance = pinchDistance(points);
    if (!distance || !pinchStartDistance) return true;
    const min = Number(zoomInput.min);
    const max = Number(zoomInput.max);
    const nextZoom = clampNumber(pinchStartZoom * distance / pinchStartDistance, pinchStartZoom, min, max);
    if (pinchTargetMode === 'all-items') {
      setZoomValue(nextZoom, {
        save: false,
        snap: true,
        allItemsAnchor: pinchAnchorPoint,
        deferAllItemsSync: true
      });
    } else {
      setZoomValue(nextZoom, { save: false, snap: true });
    }
    e.preventDefault();
    return true;
  }

  function finishPinchPointer(e) {
    if (!pinchPointers.has(e.pointerId) && !pinchActive) return false;
    pinchPointers.delete(e.pointerId);
    if (!pinchActive) return false;
    if (pinchPointers.size >= 2) {
      const points = [...pinchPointers.values()].slice(-2);
      pinchStartDistance = pinchDistance(points);
      pinchStartZoom = Number(zoomInput.value) || pinchStartZoom;
      pinchAnchorPoint = pinchTargetMode === 'all-items' ? allItemsPinchAnchor(pinchMidpoint(points)) : null;
      return true;
    }
    pinchActive = false;
    pinchStartDistance = 0;
    pinchTargetMode = 'model';
    pinchAnchorPoint = null;
    scene.classList.remove('zooming');
    quarterScene.classList.remove('zooming');
    gradedCaseScene?.classList.remove('zooming');
    gradedMediaViewer?.classList.remove('zooming');
    if (allItemsMode) {
      rememberAllItemsCenteredWorldPoint();
      syncAllItemsLeftPanelSelectionToCentered({ save: true });
    }
    saveViewState(true);
    if (e) e.preventDefault();
    return true;
  }

  function clearAllItemsModelDragPending() {
    allItemsModelDragPending = false;
    allItemsModelDragPointerId = null;
    allItemsModelDragTarget = null;
  }

  function startAllItemsModelPendingDrag(e, targetScene) {
    cancelTransformAnimation();
    clearAllItemsModelDragPending();
    allItemsModelDragPending = true;
    allItemsModelDragPointerId = e.pointerId;
    allItemsModelDragTarget = targetScene;
    allItemsModelDragStartX = e.clientX;
    allItemsModelDragStartY = e.clientY;
    try { targetScene.setPointerCapture(e.pointerId); } catch (_) {}
  }

  function recenterCurrentAllItemsSelection() {
    const placement = nearestAllItemsFocusedTile();
    centerAllItemsOnPlacement({ slug: allItemsFocusedSlug, tileX: placement.tileX, tileY: placement.tileY }, {
      animate: true,
      save: true,
      syncSelection: false,
      animateTransform: false
    });
    setAllItemsCrosshairTarget(allItemsObjectTargetOffset(), { save: true });
  }

  function allItemsFocusedSelectionCentered() {
    const placement = nearestAllItemsFocusedTile();
    return Number(placement?.distance || 0) <= 6;
  }

  function handleAllItemsSelectedDoubleActivate(e) {
    clearPendingAllItemsSelectedRecenter();
    allItemsSelectedClickTime = 0;
    if (allItemsFocusedSelectionCentered()) {
      e?.preventDefault?.();
      flattenToNearestFace();
      return;
    }
    recenterCurrentAllItemsSelection();
  }

  function allItemsSelectionClickLocked() {
    return allItemsStage?.classList.contains('layout-shifting');
  }

  function clearPendingAllItemsSelectedRecenter() {
    clearTimeout(allItemsSelectedClickTimer);
    allItemsSelectedClickTimer = 0;
  }

  function scheduleAllItemsSelectedRecenter(e) {
    const now = e?.timeStamp || performance.now();
    const x = Number(e?.clientX);
    const y = Number(e?.clientY);
    const doubleClick = allItemsSelectedClickTimer
      && now - allItemsSelectedClickTime < 340
      && Math.hypot(x - allItemsSelectedClickX, y - allItemsSelectedClickY) < 28;
    if (doubleClick) {
      handleAllItemsSelectedDoubleActivate(e);
      return false;
    }
    clearPendingAllItemsSelectedRecenter();
    allItemsSelectedClickTime = now;
    allItemsSelectedClickX = x;
    allItemsSelectedClickY = y;
    allItemsSelectedClickTimer = setTimeout(() => {
      allItemsSelectedClickTimer = 0;
      recenterCurrentAllItemsSelection();
    }, 260);
    return true;
  }

  function recenterGradedCasePanIfNeeded() {
    if (!gradedCaseModeActive()) return false;
    if (Math.hypot(gradedCasePanX, gradedCasePanY) < 1) return false;
    resetGradedCasePan();
    return true;
  }

  function handleSingleViewTap(e, targetScene) {
    if (!e || e.pointerType === 'mouse' || allItemsMode) return false;
    const singleViewCommandTarget = targetScene === scene
      || (targetScene === gradedCaseScene && gradedCaseModeActive());
    if (!singleViewCommandTarget) return false;
    const now = e.timeStamp || performance.now();
    const doubleTap = lastModelTapTarget === targetScene
      && now - lastModelTapTime < 340
      && Math.hypot(e.clientX - lastModelTapX, e.clientY - lastModelTapY) < 28;
    lastModelTapTime = now;
    lastModelTapX = e.clientX;
    lastModelTapY = e.clientY;
    lastModelTapTarget = targetScene;
    if (!doubleTap) return false;
    lastModelTapTime = 0;
    lastModelTapTarget = null;
    e.preventDefault();
    resetSingleViewInteraction(targetScene);
    return true;
  }

  function gradedCasePanExcludedTarget(target) {
    if (!target?.closest) return false;
    return Boolean(target.closest([
      '.graded-case-scene',
      '.graded-media-dots',
      '.data-panel',
      '.bottom-stack',
      '.modal-controls',
      '.panel-toggle-actions',
      '.keyboard-shortcuts-btn',
      '.balance-chart-modal',
      '.shortcuts-modal',
      '.shortcuts-floating-close',
      'button',
      'a',
      'input',
      'select',
      'textarea',
      '[role="button"]',
      '[data-balance-chart-open]'
    ].join(',')));
  }

  function gradedCaseCursorExcludedTarget(target) {
    if (!target?.closest) return false;
    return Boolean(target.closest([
      '.graded-media-dots',
      '.data-panel',
      '.bottom-stack',
      '.modal-controls',
      '.panel-toggle-actions',
      '.keyboard-shortcuts-btn',
      '.balance-chart-modal',
      '.shortcuts-modal',
      '.shortcuts-floating-close',
      'button',
      'a',
      'input',
      'select',
      'textarea',
      '[role="button"]',
      '[data-balance-chart-open]'
    ].join(',')));
  }

  function startDrag(e, targetScene) {
    if (allItemsMode && targetScene === scene) {
      if (!allItemsSelectedItemClientHit(e)) {
        startAllItemsDrag(e, targetScene);
        return;
      }
      startAllItemsModelPendingDrag(e, targetScene);
      return;
    }
    beginModelDrag(e, targetScene);
  }

  function moveDrag(e) {
    if (pinchActive) return;
    if (allItemsDragging && e.pointerId === allItemsPointerId) {
      moveAllItemsDrag(e);
      return;
    }
    if (allItemsModelDragPending && e.pointerId === allItemsModelDragPointerId) {
      const moved = Math.hypot(e.clientX - allItemsModelDragStartX, e.clientY - allItemsModelDragStartY);
      if (moved < 8) return;
      clearPendingAllItemsSelectedRecenter();
      const targetScene = allItemsModelDragTarget;
      const startEvent = {
        clientX: allItemsModelDragStartX,
        clientY: allItemsModelDragStartY,
        pointerId: allItemsModelDragPointerId
      };
      clearAllItemsModelDragPending();
      beginModelDrag(startEvent, targetScene);
      moveDrag(e);
      return;
    }
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    dragDistance += Math.hypot(dx, dy);
    if (dragDistance < 4) return;
    if (dx || dy) clearViewMode();
    angle = (angle + dx * .62) % 360;
    tilt = clampTilt(tilt - dy * .34);
    setTransform({ save: false });
  }

  function stopDrag(e) {
    if (pinchActive && e) {
      finishPinchPointer(e);
      return;
    }
    if (allItemsDragging && (!e || e.pointerId === allItemsPointerId)) {
      stopAllItemsDrag(e);
      return;
    }
    if (allItemsModelDragPending && (!e || e.pointerId === allItemsModelDragPointerId)) {
      const targetScene = allItemsModelDragTarget;
      const endedAsClick = e
        && Math.hypot(e.clientX - allItemsModelDragStartX, e.clientY - allItemsModelDragStartY) < 8;
      try { targetScene?.releasePointerCapture(allItemsModelDragPointerId); } catch (_) {}
      clearAllItemsModelDragPending();
      if (endedAsClick) {
        e.preventDefault();
        if (allItemsSelectionClickLocked()) return;
        if (e.metaKey) {
          selectCoin(allItemsFocusedSlug, {
            preservedSelection: currentAllItemsSelectionForSingleView(allItemsFocusedSlug)
          });
          return;
        }
        scheduleAllItemsSelectedRecenter(e);
      }
      return;
    }
    if (!dragging || (e && e.pointerId !== pointerId)) return;
    const endedAsClick = e && dragDistance < 8;
    const endedAsTap = e && e.pointerType !== 'mouse' && dragDistance < 8;
    dragging = false;
    dragTarget?.classList.remove('dragging');
    try { dragTarget?.releasePointerCapture(pointerId); } catch (_) {}
    const finishedTarget = dragTarget;
    dragTarget = null;
    pointerId = null;
    const singleViewCommandTarget = finishedTarget === scene
      || (finishedTarget === gradedCaseScene && gradedCaseModeActive());
    if (!allItemsMode && singleViewCommandTarget && endedAsClick && e?.metaKey) {
      e.preventDefault();
      enterAllItemsModeWithSingleSelection({ preferGraded: finishedTarget === gradedCaseScene });
      return;
    }
    if (finishedTarget === gradedCaseScene && endedAsClick && recenterGradedCasePanIfNeeded()) {
      e.preventDefault();
    }
    if (endedAsTap) {
      handleSingleViewTap(e, finishedTarget);
    }
    saveViewState(true);
  }

  function startGradedCasePan(e) {
    if (pinchActive) return;
    if (!gradedCaseModeActive() || gradedCasePanning || gradedCasePanExcludedTarget(e.target)) return;
    if (!eventInGradedCaseInteractionRect(e)) return;
    if (e.button !== undefined && e.button !== 0) return;
    cancelTransformAnimation();
    gradedCasePanning = true;
    gradedCasePanPointerId = e.pointerId;
    gradedCasePanLastX = e.clientX;
    gradedCasePanLastY = e.clientY;
    gradedCasePanStartX = e.clientX;
    gradedCasePanStartY = e.clientY;
    gradedCasePanDistance = 0;
    try { document.documentElement.setPointerCapture?.(e.pointerId); } catch (_) {}
    gradedCaseScene?.classList.add('panning');
    app?.classList.add('graded-case-panning');
    e.preventDefault();
  }

  function moveGradedCasePan(e) {
    if (!gradedCasePanning || e.pointerId !== gradedCasePanPointerId) return;
    e.preventDefault();
    const dx = e.clientX - gradedCasePanLastX;
    const dy = e.clientY - gradedCasePanLastY;
    gradedCasePanX += dx;
    gradedCasePanY += dy;
    gradedCasePanDistance += Math.hypot(dx, dy);
    gradedCasePanLastX = e.clientX;
    gradedCasePanLastY = e.clientY;
    applyGradedCasePan();
  }

  function stopGradedCasePan(e) {
    if (!gradedCasePanning || (e && e.pointerId !== gradedCasePanPointerId)) return;
    const endedAsClick = e
      && Math.hypot(e.clientX - gradedCasePanStartX, e.clientY - gradedCasePanStartY) < 8
      && gradedCasePanDistance < 8;
    gradedCasePanning = false;
    try { document.documentElement.releasePointerCapture?.(gradedCasePanPointerId); } catch (_) {}
    gradedCasePanPointerId = null;
    gradedCaseScene?.classList.remove('panning');
    app?.classList.remove('graded-case-panning');
    if (e) updateGradedCaseCursor(e);
    if (endedAsClick) e.preventDefault();
  }

  function addModelInteraction(targetScene) {
    targetScene.addEventListener('pointerdown', e => {
      if (targetScene === gradedCaseScene && !eventInGradedCaseInteractionRect(e)) return;
      if (trackPinchPointer(e, targetScene)) return;
      startDrag(e, targetScene);
    });
    targetScene.addEventListener('pointermove', moveDrag);
    targetScene.addEventListener('pointerup', stopDrag);
    targetScene.addEventListener('pointercancel', stopDrag);
    targetScene.addEventListener('wheel', e => {
      if (targetScene === gradedCaseScene && !eventInGradedCaseInteractionRect(e)) return;
      e.preventDefault();
      if (allItemsMode) {
        scheduleAllItemsWheelZoom(e.deltaY);
        return;
      }
      if (targetScene === gradedCaseScene && gradedCaseModeActive()) {
        scheduleGradedCaseWheelZoom(e.deltaY);
        return;
      }
      cancelTransformAnimation();
      const z = Math.max(Number(zoomInput.min), Math.min(Number(zoomInput.max), Number(zoomInput.value) - Math.sign(e.deltaY) * 4));
      setZoomValue(z, { save: true, snap: true });
    }, { passive: false });
    targetScene.addEventListener('dblclick', e => {
      e.preventDefault();
      if (allItemsMode && targetScene === scene && allItemsSelectionClickLocked()) return;
      if (allItemsMode && targetScene === scene && allItemsSelectedItemClientHit(e)) {
        handleAllItemsSelectedDoubleActivate(e);
        return;
      }
      if (!allItemsMode && (targetScene === scene || (targetScene === gradedCaseScene && gradedCaseModeActive()))) {
        resetSingleViewInteraction(targetScene);
      }
    });
  }

  addModelInteraction(scene);
  if (gradedCaseScene) addModelInteraction(gradedCaseScene);
  addModelInteraction(quarterScene);
  gradedMediaViewer?.addEventListener('pointerdown', e => {
    trackPinchPointer(e, gradedMediaViewer);
  });

  document.addEventListener('pointerdown', startGradedCasePan, true);
  document.addEventListener('pointermove', updateGradedCaseCursor, true);
  document.addEventListener('pointermove', e => {
    if (updatePinchPointer(e)) e.preventDefault();
  }, { passive: false, capture: true });
  document.addEventListener('pointerup', finishPinchPointer, { passive: false, capture: true });
  document.addEventListener('pointercancel', finishPinchPointer, { passive: false, capture: true });
  document.addEventListener('pointerleave', finishPinchPointer, { passive: false, capture: true });
  document.addEventListener('pointermove', moveGradedCasePan, true);
  document.addEventListener('pointerup', stopGradedCasePan, true);
  document.addEventListener('pointercancel', stopGradedCasePan, true);
  document.addEventListener('pointerleave', clearGradedCaseCursor, true);
  document.addEventListener('wheel', e => {
    if (!gradedCaseModeActive() || gradedCaseScene?.contains(e.target)) return;
    if (!eventInGradedCaseInteractionRect(e) || gradedCasePanExcludedTarget(e.target)) return;
    e.preventDefault();
    scheduleGradedCaseWheelZoom(e.deltaY);
  }, { passive: false, capture: true });

  function startAllItemsDrag(e, captureTarget = allItemsStage) {
    cancelTransformAnimation();
    syncAllItemsCursorToCenter();
    allItemsDragging = true;
    allItemsPointerId = e.pointerId;
    allItemsCaptureTarget = captureTarget || allItemsStage;
    allItemsLastX = e.clientX;
    allItemsLastY = e.clientY;
    allItemsStartX = e.clientX;
    allItemsStartY = e.clientY;
    allItemsDragDistance = 0;
    try { allItemsCaptureTarget?.setPointerCapture(allItemsPointerId); } catch (_) {}
    allItemsStage.classList.add('dragging');
    app.classList.add('all-items-dragging');
  }

  allItemsStage?.addEventListener('pointerdown', e => {
    if (trackPinchPointer(e, allItemsStage)) return;
    const placement = allItemsHitPlacement(e);
    if (placement && placement.slug !== allItemsFocusedSlug) {
      hideAllItemsFocusedModel();
      renderAllItems({ wrap: false, updateOverlay: false });
    }
    startAllItemsDrag(e, allItemsStage);
  });
  function moveAllItemsDrag(e) {
    if (pinchActive) return;
    if (!allItemsDragging || e.pointerId !== allItemsPointerId) return;
    e.preventDefault();
    const dx = e.clientX - allItemsLastX;
    const dy = e.clientY - allItemsLastY;
    const { strideWidth: tileW, strideHeight: tileH } = allItemsTileStridePx();
    allItemsOffsetX = wrapAllItemsDelta(allItemsOffsetX + dx, tileW);
    allItemsOffsetY = wrapAllItemsDelta(allItemsOffsetY + dy, tileH);
    allItemsDragDistance += Math.hypot(dx, dy);
    allItemsLastX = e.clientX;
    allItemsLastY = e.clientY;
    syncAllItemsCursorToCenter();
    renderAllItems();
  }
  allItemsStage?.addEventListener('pointermove', moveAllItemsDrag);
  allItemsStage?.addEventListener('wheel', e => {
    e.preventDefault();
    scheduleAllItemsWheelZoom(e.deltaY);
  }, { passive: false });
  function stopAllItemsDrag(e) {
    if (!allItemsDragging || (e && e.pointerId !== allItemsPointerId)) return;
    const endedAsClick = e && Math.hypot(e.clientX - allItemsStartX, e.clientY - allItemsStartY) < 8 && allItemsDragDistance < 8;
    allItemsDragging = false;
    try { allItemsCaptureTarget?.releasePointerCapture(allItemsPointerId); } catch (_) {}
    allItemsPointerId = null;
    allItemsCaptureTarget = null;
    allItemsStage.classList.remove('dragging');
    app.classList.remove('all-items-dragging');
    if (endedAsClick) {
      if (allItemsSelectionClickLocked()) {
        e.preventDefault();
        return;
      }
      const placement = allItemsHitPlacement(e);
      if (placement) {
        if (e.metaKey) {
          e.preventDefault();
          selectCoin(placement.slug, {
            preservedSelection: placement.slug === allItemsFocusedSlug
              ? currentAllItemsSelectionForSingleView(placement.slug)
              : null
          });
          return;
        }
        if (placement.slug === allItemsFocusedSlug) {
          scheduleAllItemsSelectedRecenter(e);
        } else {
          clearPendingAllItemsSelectedRecenter();
          centerAllItemsOnPlacement(placement, { animate: true, save: true });
          setAllItemsCrosshairTarget(allItemsObjectTargetOffset(), { save: true });
        }
      }
      saveAllItemsCrosshair();
      return;
    }
    normalizeAllItemsTileOffset();
    clearPendingAllItemsSelectedRecenter();
    rememberAllItemsCenteredWorldPoint();
    syncAllItemsLeftPanelSelectionToCentered({ save: true, revealModel: false });
    saveAllItemsCrosshair();
    saveAllItemsWindow();
  }
  allItemsStage?.addEventListener('pointerup', stopAllItemsDrag);
  allItemsStage?.addEventListener('pointercancel', stopAllItemsDrag);

  spinOrbitMarker.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    cancelTransformAnimation();
    running = false;
    toggle.classList.remove('is-running');
    toggle.setAttribute('aria-label', 'Spin');
    orbitDragging = true;
    orbitPointerId = e.pointerId;
    spinOrbitMarker.setPointerCapture(orbitPointerId);
    spinOrbitMarker.classList.add('dragging');
    setAngleFromOrbitPointer(e);
  });
  spinOrbitMarker.addEventListener('pointermove', e => {
    if (!orbitDragging || e.pointerId !== orbitPointerId) return;
    e.preventDefault();
    setAngleFromOrbitPointer(e);
  });
  function stopOrbitDrag(e) {
    if (!orbitDragging || (e && e.pointerId !== orbitPointerId)) return;
    orbitDragging = false;
    try { spinOrbitMarker.releasePointerCapture(orbitPointerId); } catch (_) {}
    orbitPointerId = null;
    spinOrbitMarker.classList.remove('dragging');
    saveViewState(true);
  }
  spinOrbitMarker.addEventListener('pointerup', stopOrbitDrag);
  spinOrbitMarker.addEventListener('pointercancel', stopOrbitDrag);
  spinOrbitMarker.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
  });

  function setTiltFromControlPointer(e) {
    if (!tiltControl) return;
    const rect = tiltControl.getBoundingClientRect();
    const trackTop = 2;
    const trackMiddle = rect.height / 2;
    const trackBottom = rect.height - 2;
    const y = Math.max(trackTop, Math.min(trackBottom, e.clientY - rect.top));
    if (y <= trackMiddle) {
      const ratio = (y - trackTop) / Math.max(1, trackMiddle - trackTop);
      tilt = snapTilt(TILT_MAX - ratio * (TILT_MAX - FACE_ON_TILT));
    } else {
      const ratio = (y - trackMiddle) / Math.max(1, trackBottom - trackMiddle);
      tilt = snapTilt(FACE_ON_TILT - ratio * (FACE_ON_TILT - TILT_MIN));
    }
    clearViewMode();
    setTransform({ save: false });
  }

  tiltControl?.addEventListener('pointerdown', e => {
    if (tiltControl.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    cancelTransformAnimation();
    tiltDragging = true;
    tiltPointerId = e.pointerId;
    tiltControl.setPointerCapture(tiltPointerId);
    tiltControl.classList.add('dragging');
    setTiltFromControlPointer(e);
  });
  tiltControl?.addEventListener('pointermove', e => {
    if (!tiltDragging || e.pointerId !== tiltPointerId) return;
    e.preventDefault();
    setTiltFromControlPointer(e);
  });
  function stopTiltDrag(e) {
    if (!tiltDragging || (e && e.pointerId !== tiltPointerId)) return;
    tiltDragging = false;
    try { tiltControl?.releasePointerCapture(tiltPointerId); } catch (_) {}
    tiltPointerId = null;
    tiltControl?.classList.remove('dragging');
    saveViewState(true);
  }
  tiltControl?.addEventListener('pointerup', stopTiltDrag);
  tiltControl?.addEventListener('pointercancel', stopTiltDrag);
  tiltControl?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
  });

  toggle.addEventListener('click', () => {
    togglePlayback();
  });
  quarterComparisonInput.addEventListener('change', () => {
    const previousSceneLayout = captureSceneLayout();
    const previousQuarterLayout = captureQuarterLayout();
    const wasComparing = app.classList.contains('quarter-comparison');
    const isExiting = !quarterComparisonInput.checked && wasComparing;
    if (isExiting) {
      fadeQuarterExitClone(previousQuarterLayout);
      quarterScene.style.transition = 'none';
      quarterScene.style.visibility = 'hidden';
      quarterScene.style.opacity = '0';
      quarterScene.style.display = 'none';
      app.classList.remove('quarter-exiting');
    } else {
      removeQuarterExitClone();
      if (!allItemsMode) releaseQuarterExitPosition();
    }
    saveQuarterComparison();
    syncQuarterComparison();
    if (isExiting) requestAnimationFrame(() => releaseQuarterExitPosition());
    const playSceneLayoutAnimation = prepareSceneLayoutAnimation(previousSceneLayout);
    if (playSceneLayoutAnimation) playSceneLayoutAnimation();
    if (!isExiting) {
      quarterExitToken++;
      app.classList.remove('quarter-exiting');
      if (!allItemsMode) releaseQuarterExitPosition();
    }
  });
  frontBtn.addEventListener('click', () => setViewMode('front'));
  backBtn.addEventListener('click', () => setViewMode('back'));
  hologramBtn.addEventListener('click', () => setViewMode('hologram'));
  addressSearchInput.addEventListener('input', () => {
    const cleanValue = sanitizeSearchAddress(addressSearchInput.value);
    if (addressSearchInput.value !== cleanValue) addressSearchInput.value = cleanValue;
    addressSearchInput.classList.remove('search-miss');
  });
  addressSearchInput.addEventListener('paste', e => {
    e.preventDefault();
    const pasted = sanitizeSearchAddress(e.clipboardData?.getData('text') || '');
    const start = addressSearchInput.selectionStart ?? addressSearchInput.value.length;
    const end = addressSearchInput.selectionEnd ?? start;
    addressSearchInput.value = sanitizeSearchAddress(addressSearchInput.value.slice(0, start) + pasted + addressSearchInput.value.slice(end));
    const cursor = start + pasted.length;
    addressSearchInput.setSelectionRange(cursor, cursor);
    addressSearchInput.classList.remove('search-miss');
  });
  addressSearchControl.addEventListener('click', e => {
    if (e.target === addressSearchClose) return;
    if (!addressSearchControl.classList.contains('expanded')) {
      e.preventDefault();
      expandSearch();
    }
  });
  addressSearchClose.addEventListener('pointerdown', e => {
    e.preventDefault();
  });
  addressSearchClose.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    collapseSearch();
  });
  addressSearchInput.addEventListener('change', () => {
    runAddressSearch();
  });
  addressSearchInput.addEventListener('keydown', e => {
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      togglePlayback();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      runAddressSearch();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      collapseSearch();
      return;
    }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && !isAllowedSearchKey(e.key)) {
      e.preventDefault();
    }
  });
  speedInput.addEventListener('input', () => {
    setSpeedValue(speedInput.value, { save: true, snap: true });
  });
  speedValueInput.addEventListener('input', () => {
    if (speedValueInput.value === '') return;
    const value = manualSpeedValue();
    if (value === null) return;
    if (value < Number(speedInput.min)) return;
    setSpeedValue(value, { save: true });
  });
  speedValueInput.addEventListener('change', () => {
    commitSpeedValue();
  });
  speedValueInput.addEventListener('blur', () => {
    commitSpeedValue();
  });
  speedValueInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    commitSpeedValue();
    speedValueInput.blur();
  });
  zoomInput.addEventListener('input', () => {
    cancelTransformAnimation();
    setZoomValue(zoomInput.value, { save: true, snap: true });
  });
  zoomValueInput.addEventListener('input', () => {
    cancelTransformAnimation();
    if (zoomValueInput.value === '') return;
    const value = manualZoomValue();
    if (value === null) return;
    setZoomValue(value, { save: true });
  });
  zoomValueInput.addEventListener('change', () => {
    commitZoomValue();
  });
  zoomValueInput.addEventListener('blur', () => {
    commitZoomValue();
  });
  zoomValueInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    commitZoomValue();
    zoomValueInput.blur();
  });
  tabs.addEventListener('scroll', () => {
    if (tabDragPointerId !== null) return;
    if (suppressTabNormalize) return;
    if (tabScrollRaf) return;
    tabScrollRaf = requestAnimationFrame(() => {
      tabScrollRaf = 0;
      if (suppressTabNormalize) return;
      normalizeTabScroll();
    });
  });
  tabs.addEventListener('pointerdown', startTabDrag);
  tabs.addEventListener('pointermove', moveTabDrag);
  tabs.addEventListener('pointerup', stopTabDrag);
  tabs.addEventListener('pointercancel', stopTabDrag);
  tabs.addEventListener('click', e => {
    if (!suppressNextTabClick) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    suppressNextTabClick = false;
  }, true);
  leftPanelBtn?.addEventListener('click', () => {
    toggleLeftPanelWithLayoutAnimation();
  });
  leftPanelModeToggle?.addEventListener('click', () => {
    showLeftPanelMode(nextLeftPanelMode(leftPanelMode));
  });
  recentSpendsPanel?.addEventListener('scroll', () => {
    if (leftPanelMeasureMode) return;
    clampLeftPanelScroll();
    saveLeftPanelScroll();
    maybeLoadMoreLeftPanelRows();
  }, { passive: true });
  function leftPanelCanDragScroll() {
    return Boolean(recentSpendsPanel && maxUsefulLeftPanelScrollTop(leftPanelMode) > 1);
  }

  function leftPanelDragBlocked(target) {
    return Boolean(target?.closest?.('button, input, textarea, select, label, a'));
  }

  recentSpendsPanel?.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !leftPanelCanDragScroll() || leftPanelDragBlocked(e.target)) return;
    leftPanelDragPointerId = e.pointerId;
    leftPanelDragStartY = e.clientY;
    leftPanelDragStartScroll = recentSpendsPanel.scrollTop;
    leftPanelDragMoved = false;
  });
  recentSpendsPanel?.addEventListener('pointermove', (e) => {
    if (leftPanelDragPointerId !== e.pointerId) return;
    const dy = e.clientY - leftPanelDragStartY;
    if (!leftPanelDragMoved && Math.abs(dy) > 3) {
      leftPanelDragMoved = true;
      recentSpendsPanel.classList.add('left-panel-dragging');
      recentSpendsPanel.setPointerCapture?.(e.pointerId);
    }
    if (!leftPanelDragMoved) return;
    recentSpendsPanel.scrollTop = leftPanelDragStartScroll - dy;
    e.preventDefault();
  });
  function endLeftPanelDrag(e) {
    if (leftPanelDragPointerId !== e.pointerId) return;
    leftPanelSuppressClick = leftPanelDragMoved;
    leftPanelDragPointerId = null;
    leftPanelDragMoved = false;
    recentSpendsPanel?.classList.remove('left-panel-dragging');
    recentSpendsPanel?.releasePointerCapture?.(e.pointerId);
  }
  recentSpendsPanel?.addEventListener('pointerup', endLeftPanelDrag);
  recentSpendsPanel?.addEventListener('pointercancel', endLeftPanelDrag);
  recentSpendsPanel?.addEventListener('click', (e) => {
    if (!leftPanelSuppressClick) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    leftPanelSuppressClick = false;
  }, true);
  recentSpendsPanel?.addEventListener('click', (e) => {
    selectLeftPanelAddressFromRow(e.target?.closest?.('.spend-row'));
  });
  coinInfoPanel?.addEventListener('click', (e) => {
    const balanceTarget = e.target?.closest?.('[data-balance-chart-open]');
    const priceTarget = e.target?.closest?.('[data-selected-price-chart-open]');
    if (!balanceTarget && !priceTarget) return;
    if (shortcutsModal?.classList.contains('open')) closeShortcutsModal({ restoreChart: false });
    const nextMode = priceTarget ? 'price' : 'balance';
    if (balanceChartIsOpen() && activeChartModalMode === nextMode) closeBalanceChartModal();
    else openBalanceChartModal(nextMode);
  });
  gradedMediaDots?.addEventListener('click', (e) => {
    const button = e.target?.closest?.('.graded-media-dot[data-graded-media-mode]');
    if (!button) return;
    setGradedMediaMode(button.dataset.gradedMediaMode || 'model');
  });
  recentSpendsPanel?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target?.closest?.('.spend-row');
    if (!row) return;
    e.preventDefault();
    selectLeftPanelAddressFromRow(row);
  });
  bottomPanelBtn?.addEventListener('click', () => {
    toggleBottomPanelWithLayoutAnimation();
  });
  rightPanelBtn?.addEventListener('click', () => {
    toggleRightPanelWithLayoutAnimation();
  });
  function bottomPanelCanScroll() {
    return Boolean(bottomStack && bottomStack.scrollWidth > bottomStack.clientWidth + 1);
  }

  function bottomPanelDragBlocked(target) {
    return Boolean(target?.closest?.('button, input, textarea, select, label, a, [role="button"]'));
  }

  bottomStack?.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !bottomPanelCanScroll() || bottomPanelDragBlocked(e.target)) return;
    bottomDragPointerId = e.pointerId;
    bottomDragStartX = e.clientX;
    bottomDragStartScroll = bottomStack.scrollLeft;
    bottomDragMoved = false;
    bottomStack.classList.add('bottom-dragging');
    bottomStack.setPointerCapture?.(e.pointerId);
  });
  bottomStack?.addEventListener('pointermove', (e) => {
    if (bottomDragPointerId !== e.pointerId) return;
    const dx = e.clientX - bottomDragStartX;
    if (Math.abs(dx) > 3) bottomDragMoved = true;
    bottomStack.scrollLeft = bottomDragStartScroll - dx;
    e.preventDefault();
  });
  function endBottomPanelDrag(e) {
    if (bottomDragPointerId !== e.pointerId) return;
    bottomDragPointerId = null;
    bottomStack?.classList.remove('bottom-dragging');
    bottomStack?.releasePointerCapture?.(e.pointerId);
  }
  bottomStack?.addEventListener('pointerup', endBottomPanelDrag);
  bottomStack?.addEventListener('pointercancel', endBottomPanelDrag);
  bottomStack?.addEventListener('click', (e) => {
    if (!bottomDragMoved) return;
    e.preventDefault();
    e.stopPropagation();
    bottomDragMoved = false;
  }, true);
  function flushViewStateForHost() {
    saveViewState(true);
  }

  window.addEventListener('pagehide', flushViewStateForHost);
  window.addEventListener('beforeunload', flushViewStateForHost);
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === 'casascius-flush-view-state') flushViewStateForHost();
  });
  document.addEventListener('keydown', (e) => {
    const shortcutPressId = shortcutsModal?.classList.contains('open') ? shortcutIdForKeyboardEvent(e) : '';
    if (shortcutsModal?.classList.contains('open') && e.key === 'Meta') {
      shortcutCommandPressed = true;
      setShortcutCommandPressed(true);
    }
    if (shortcutPressId) setShortcutKeyPressed(shortcutPressId, true);
    if (e.key === 'Escape' && shortcutsModal?.classList.contains('open')) {
      e.preventDefault();
      setTimeout(closeShortcutsModal, 140);
      return;
    }
    if (e.key === 'Escape' && balanceChartModal?.classList.contains('open')) {
      e.preventDefault();
      closeBalanceChartModal();
      return;
    }
    if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        toggleShortcutsModal();
        if (shortcutsModal?.classList.contains('open')) {
          shortcutCommandPressed = true;
          setShortcutCommandPressed(true);
          setShortcutKeyPressed('cmd-s', true);
        }
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        toggleLeftPanelWithLayoutAnimation();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        toggleRightPanelWithLayoutAnimation();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        toggleBottomPanelWithLayoutAnimation();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        toggleAllPanelsWithLayoutAnimation();
        return;
      }
    }
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const targetTag = e.target?.tagName;
    const isRangeInput = targetTag === 'INPUT' && e.target.type === 'range';
    if (targetTag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag) && !isRangeInput) return;
    const key = e.key.toLowerCase();
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      selectRelative(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      selectRelative(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      cycleVariant(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cycleVariant(-1);
    } else if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      togglePlayback();
    } else if (/^[1-9]$/.test(e.key) && setGradedMediaModeByNumber(e.key)) {
      e.preventDefault();
    } else if (key === 'f') {
      e.preventDefault();
      setViewMode('front');
    } else if (key === 'b') {
      e.preventDefault();
      setViewMode('back');
    } else if (key === 'h') {
      e.preventDefault();
      setViewMode('hologram');
    } else if (key === 't') {
      e.preventDefault();
      animateTiltToBaseline();
    } else if (key === 'z') {
      e.preventDefault();
      animateZoomTo(100);
    } else if (key === 's') {
      e.preventDefault();
      setSpeedValue(DEFAULT_SPEED_VALUE, { save: true });
    } else if (key === 'a') {
      e.preventDefault();
      showLeftPanelMode('active');
    } else if (key === 'g') {
      e.preventDefault();
      showLeftPanelMode('graded');
    } else if (key === 'r') {
      e.preventDefault();
      showLeftPanelMode('recent');
    }
  });
  document.addEventListener('keyup', (e) => {
    const shortcutPressId = shortcutIdForKeyboardEvent(e);
    setShortcutKeyPressed(shortcutPressId, false);
    setShortcutKeyPressed(commandComboShortcutId(shortcutPressId), false);
    if (!shortcutPressId.startsWith('cmd-')) {
      setShortcutKeyPressed(`cmd-${shortcutPressId}`, false);
    }
    if (e.key === 'Meta') {
      shortcutCommandPressed = false;
      shortcutsModal
        ?.querySelectorAll('.shortcut-key.pressed[data-shortcut-key^="cmd-"]:not([data-shortcut-command-key])')
        .forEach(key => key.classList.remove('pressed'));
      setShortcutCommandPressed(false);
    } else if (shortcutCommandPressed) {
      setShortcutCommandPressed(true);
    }
  });
  window.addEventListener('blur', clearShortcutPressedState);
  keyboardShortcutsBtn?.addEventListener('click', () => {
    toggleShortcutsModal();
  });
  window.addEventListener('resize', () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    const allItemsResizePoint = allItemsCenteredWorldPoint || rememberAllItemsCenteredWorldPoint();
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      applyDimensions(comparisonCoin());
      buildEdges();
      if (allItemsMode) {
        allItemsBuilt = false;
        buildAllItemsLayout();
        if (!restoreAllItemsCenteredWorldPoint(allItemsResizePoint, { save: true })) saveAllItemsWindow();
      }
      if (quarterComparisonInput.checked) buildQuarterEdges();
      lockLeftPanelBodyWidth();
      syncLeftPanelHeader();
      updateBottomReservedSpace();
      updateComparisonSpacing();
      syncPanelToggles();
      updateOrbitMarker();
      if (balanceChartModal?.classList.contains('open')) {
        updateBalanceChartModalBounds();
        scheduleOpenBalanceChartRedraw();
      }
      if (shortcutsModal?.classList.contains('open')) updateBalanceChartModalBounds();
      withTabNormalizeSuppressed(() => alignActiveGroup({ smooth: false }));
    });
  });

  if (quarterComparisonInput.checked) {
    app.classList.add('quarter-booting');
    quarterScene.style.transition = 'none';
    quarterScene.style.opacity = '0';
    quarterScene.style.visibility = 'hidden';
  }
  root.classList.add('panels-booting');
  if (activeSlug === ALL_ITEMS_GROUP_KEY) app.classList.add('all-items-booting');
  buildTabs();
  syncVersionToggle();
  lockLeftPanelBodyWidth();
  syncLeftPanelMode();
  syncPanelToggles();
  applyQuarterDimensions();
  updateBottomReservedSpace();
  updateComparisonSpacing();
  buildQuarterEdges();
  syncQuarterComparison();
  renderBarAddress();
  const initialSelection = activeSlug === ALL_ITEMS_GROUP_KEY
    ? enterAllItemsMode({ align: false })
    : selectCoin(activeSlug, { alignGroup: false });
  Promise.resolve(initialSelection).finally(() => {
    settleInitialPanelLayout(() => {
      updateDockedPanelLayout();
      updateSidePanelLayouts();
      updateDockedPanelLayout();
      updateComparisonSpacing();
      requestAnimationFrame(() => {
        updateDockedPanelLayout();
        requestAnimationFrame(() => {
          root.classList.remove('panels-booting');
          requestAnimationFrame(() => {
            updateDockedPanelLayout();
            requestAnimationFrame(() => {
              bottomStack?.classList.remove('bottom-booting');
              if (activeGroupKey === ALL_ITEMS_GROUP_KEY) releaseInitialAllItemsQuarterBoot();
              else if (quarterComparisonInput.checked) releaseInitialQuarterBoot();
              else app.classList.remove('quarter-booting', 'all-items-booting');
              if (readBalanceChartOpen()) openBalanceChartModal(readChartModalMode());
              scheduleRemainingCoinDataLoad();
            });
          });
        });
      });
    });
  });
  setTransform();
  requestAnimationFrame(render);
})();
