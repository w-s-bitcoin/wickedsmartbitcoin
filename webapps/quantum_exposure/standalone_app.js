(() => {
  const STANDALONE_FILENAME = "quantum_exposure.png";
  const IMAGE_LIST_URL = "assets/image_list.json";
  const DASHBOARD_URL = "webapps/quantum_exposure/dashboard.html";
  const FAVORITES_STORAGE_KEY = "favorites";
  const MODAL_NAV_SNAPSHOT_KEY = "wsb_modal_nav_snapshot_v1";
  const GRID_FOCUS_RESTORE_KEY = "wsb_pending_grid_focus_filename_v1";
  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
  const IS_LOCAL_HOST = LOCAL_HOSTS.has(String(location.hostname || "").toLowerCase());

  const modal = document.getElementById("modal");
  const modalImg = document.getElementById("modal-img");
  const modalEmbedWrap = document.getElementById("modal-embed-wrap");
  const modalEmbed = document.getElementById("modal-embed");
  const modalFavBtn = document.getElementById("modal-fav-btn");
  const xLink = document.getElementById("x-link");
  const nostrLink = document.getElementById("nostr-link");
  const youtubeLink = document.getElementById("youtube-link");
  const youtubeOverlay = document.getElementById("youtube-overlay");
  const youtubeOverlayClose = document.getElementById("youtubeOverlayClose");
  const youtubeIframe = document.getElementById("youtube-iframe");

  let currentImage = {
    filename: STANDALONE_FILENAME,
    title: "Bitcoin Quantum Exposure",
    description: "",
    latest_x: "",
    latest_nostr: "",
    latest_youtube: "",
  };
  let currentIndex = 0;
  let imageListCache = null;
  let imageListPromise = null;
  let currentYoutubeUrl = "";

  function applyStandaloneFocusOrder() {
    if (!document.body || document.body.getAttribute("data-standalone-modal-shell") !== "1") return;

    const modalControls = document.querySelector(".modal-controls");
    const orderedFocusables = [];

    if (modalControls) {
      const controls = Array.from(modalControls.querySelectorAll("button.close-btn, a.close-btn"));
      controls.forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        const isDisabledLink = el.getAttribute("aria-disabled") === "true" || el.getAttribute("tabindex") === "-1";
        if (isDisabledLink) return;
        orderedFocusables.push(el);
      });
    }

    const buyCoffeeButton = document.getElementById("buyCoffeeBtn");
    const shellThemeButton = document.getElementById("shellThemeToggle");
    if (buyCoffeeButton instanceof HTMLElement) orderedFocusables.push(buyCoffeeButton);
    if (shellThemeButton instanceof HTMLElement) orderedFocusables.push(shellThemeButton);

    orderedFocusables.forEach((el, idx) => {
      el.setAttribute("tabindex", String(idx + 1));
    });
  }

  function getPageBasePath() {
    const parts = window.location.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    if (parts.length <= 1) return "";
    return `/${parts.slice(0, -1).join("/")}`;
  }

  function normalizeJoinedPath(value) {
    return String(value || "").replace(/\/{2,}/g, "/");
  }

  function getStandalonePath() {
    const base = getPageBasePath();
    const path = IS_LOCAL_HOST
      ? `${base}/quantum_exposure.html`
      : `${base}/quantum_exposure`;
    return normalizeJoinedPath(path);
  }

  function getHomeUrl() {
    return normalizeJoinedPath(`${getPageBasePath() || ""}/`);
  }

  function slugFromFilename(filename) {
    return String(filename || "").replace(/\.png$/i, "");
  }

  function getMainRouteUrl(filename) {
    const slug = slugFromFilename(filename);
    const localStandaloneBySlug = {
      quantum_exposure: 'quantum_exposure.html',
      bip110_signaling: 'bip110_signaling.html',
      node_count: 'node_count.html',
      bitcoin_dominance: 'bitcoin_dominance.html',
    };

    if (slug === "quantum_exposure") {
      if (IS_LOCAL_HOST) {
        return normalizeJoinedPath(`${getPageBasePath()}/quantum_exposure.html`);
      }
      return getStandalonePath();
    }

    const base = getPageBasePath();
    if (IS_LOCAL_HOST) {
      const localStandalone = localStandaloneBySlug[slug];
      if (localStandalone) {
        return normalizeJoinedPath(`${base}/${localStandalone}`);
      }
      return normalizeJoinedPath(`${getPageBasePath()}/view.html#${encodeURIComponent(slug)}`);
    }
    return normalizeJoinedPath(`${base}/${slug}`);
  }

  function imgSrc(filename) {
    return normalizeJoinedPath(`${getPageBasePath()}/assets/${filename}`);
  }

  function getDashboardSrc() {
    const search = String(window.location.search || "");
    return search ? `${DASHBOARD_URL}${search}` : DASHBOARD_URL;
  }

  function readFavorites() {
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeFavorites(favorites) {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  }

  function isFavorite(filename) {
    return readFavorites().includes(filename);
  }

  function updateFavoriteButton() {
    if (!modalFavBtn) return;
    const active = isFavorite(currentImage.filename);
    modalFavBtn.textContent = active ? "★" : "☆";
    modalFavBtn.classList.toggle("filled", active);
  }

  function setLinkState(anchor, href) {
    if (!anchor) return;
    if (href) {
      anchor.href = href;
      anchor.classList.remove("disabled");
      anchor.removeAttribute("aria-disabled");
      anchor.removeAttribute("tabindex");
      return;
    }
    anchor.href = "#";
    anchor.classList.add("disabled");
    anchor.setAttribute("aria-disabled", "true");
    anchor.setAttribute("tabindex", "-1");
  }

  function extractYoutubeVideoId(url) {
    if (!url) return "";
    const shortMatch = String(url).match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (shortMatch) return shortMatch[1];
    const longMatch = String(url).match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/);
    if (longMatch) return longMatch[1];
    return "";
  }

  function closeYoutubeOverlay() {
    if (youtubeOverlay) youtubeOverlay.classList.add("hidden");
    if (youtubeIframe) youtubeIframe.src = "";
  }

  function openYoutubeOverlay() {
    const id = extractYoutubeVideoId(currentYoutubeUrl);
    if (!id || !youtubeOverlay || !youtubeIframe) return false;
    youtubeIframe.src = `https://www.youtube.com/embed/${id}?autoplay=1`;
    youtubeOverlay.classList.remove("hidden");
    return true;
  }

  function applySocialLinks(image) {
    currentYoutubeUrl = String(image?.latest_youtube || "").trim();
    setLinkState(xLink, String(image?.latest_x || "").trim());
    setLinkState(nostrLink, String(image?.latest_nostr || "").trim());
    setLinkState(youtubeLink, currentYoutubeUrl);
    if (youtubeLink) youtubeLink.dataset.youtube = currentYoutubeUrl;
    applyStandaloneFocusOrder();
  }

  function setCurrentImage(image, index) {
    currentImage = image || currentImage;
    currentIndex = Number.isInteger(index) ? index : currentIndex;
    document.title = `${currentImage.title || "Bitcoin Quantum Exposure"} | Wicked Smart Bitcoin`;
    if (modalImg) {
      modalImg.dataset.filename = currentImage.filename;
      modalImg.alt = currentImage.title || "";
    }
    applySocialLinks(currentImage);
    updateFavoriteButton();
  }

  async function loadImageList() {
    if (Array.isArray(imageListCache)) return imageListCache;
    if (!imageListPromise) {
      const url = normalizeJoinedPath(`${getPageBasePath()}/${IMAGE_LIST_URL}`);
      imageListPromise = fetch(url, { cache: "force-cache" })
        .then((response) => {
          if (!response.ok) throw new Error(`Image list request failed: ${response.status}`);
          return response.json();
        })
        .then((data) => {
          imageListCache = Array.isArray(data) ? data : [];
          return imageListCache;
        })
        .catch((error) => {
          imageListPromise = null;
          throw error;
        });
    }
    return imageListPromise;
  }

  async function ensureCurrentImageFromList() {
    try {
      const list = await loadImageList();
      const index = list.findIndex((item) => String(item?.filename).toLowerCase() === STANDALONE_FILENAME);
      if (index >= 0) {
        setCurrentImage(list[index], index);
      }
    } catch (error) {
      console.warn("Standalone image list failed to load:", error);
    }
  }

  function showShell() {
    if (!modal) return;
    modal.style.display = "flex";
    modal.classList.add("embed-active");
    document.body.classList.add("modal-open");
    document.body.style.overflow = "hidden";
    if (modalEmbedWrap) modalEmbedWrap.hidden = false;
    if (modalEmbed && !modalEmbed.getAttribute("src")) {
      modalEmbed.setAttribute("src", getDashboardSrc());
    }
    if (modalImg) {
      modalImg.style.opacity = "0";
      modalImg.style.visibility = "hidden";
      modalImg.style.transform = "translate3d(-9999px,-9999px,0) scale(1)";
    }
  }

  function navigateToImage(filename) {
    window.location.href = getMainRouteUrl(filename);
  }

  function getRequestedStandaloneImage() {
    const params = new URLSearchParams(window.location.search || "");
    const raw = String(params.get("image") || "").trim();
    if (!raw) return null;
    return raw.endsWith(".png") ? raw : `${raw}.png`;
  }

  async function navigateRelative(delta) {
    try {
      const list = await loadImageList();
      if (!list.length) return;
      const navList = getFilteredNavigationList(list);
      if (!navList.length) return;
      const currentNavIndex = navList.findIndex((item) => String(item?.filename).toLowerCase() === String(currentImage.filename).toLowerCase());
      const baseIndex = currentNavIndex >= 0
        ? currentNavIndex
        : (delta >= 0 ? 0 : navList.length - 1);
      const nextIndex = (baseIndex + delta + navList.length) % navList.length;
      const target = navList[nextIndex];
      if (!target?.filename) return;
      navigateToImage(target.filename);
    } catch (error) {
      console.warn("Standalone navigation failed:", error);
    }
  }

  function getFilteredNavigationList(list) {
    const showFavoritesOnly = parseStoredBoolean(localStorage.getItem("showFavoritesOnly"));
    const favorites = new Set(readFavorites());

    const filtered = list.filter((item) => {
      const filename = String(item?.filename || "").trim();
      if (!filename) return false;
      if (showFavoritesOnly && !favorites.has(filename)) return false;
      return true;
    });

    const snapshot = readModalNavigationSnapshot();
    if (!snapshot.length) return filtered;

    const snapshotSet = new Set(snapshot);
    const candidates = filtered.filter((item) => snapshotSet.has(String(item?.filename || "").trim()));
    if (!candidates.length) return filtered;

    const candidateByFilename = new Map(candidates.map((item) => [String(item.filename), item]));
    const ordered = snapshot.map((filename) => candidateByFilename.get(filename)).filter(Boolean);
    if (!ordered.length) return filtered;

    const anchorFilename = String(currentImage?.filename || STANDALONE_FILENAME).trim();
    return ordered.some((item) => String(item?.filename || "").trim() === anchorFilename)
      ? ordered
      : filtered;
  }

  function readModalNavigationSnapshot() {
    try {
      const raw = sessionStorage.getItem(MODAL_NAV_SNAPSHOT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
    } catch (_) {
      return [];
    }
  }

  function parseStoredBoolean(value) {
    if (typeof value === "boolean") return value;
    const normalized = String(value == null ? "" : value).trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }

  function toggleFavoriteFromModal() {
    const filename = currentImage.filename || STANDALONE_FILENAME;
    const favorites = readFavorites();
    const existingIndex = favorites.indexOf(filename);
    if (existingIndex >= 0) {
      favorites.splice(existingIndex, 1);
    } else {
      favorites.push(filename);
    }
    writeFavorites(favorites);
    updateFavoriteButton();
  }

  function closeModal() {
    try {
      const filename = String(currentImage?.filename || STANDALONE_FILENAME).trim();
      if (filename) {
        sessionStorage.setItem(GRID_FOCUS_RESTORE_KEY, filename);
      }
    } catch (_) {
      // Ignore storage failures.
    }
    window.location.href = getHomeUrl();
  }

  function prevImage() {
    navigateRelative(-1);
  }

  function nextImage() {
    navigateRelative(1);
  }

  function handleNavKey(key) {
    if (youtubeOverlay && !youtubeOverlay.classList.contains("hidden")) return;
    if (!modal || modal.style.display !== "flex") return;
    if (key === "ArrowLeft") {
      prevImage();
      return;
    }
    if (key === "ArrowRight") {
      nextImage();
      return;
    }
    if (key === " " || key === "Spacebar") {
      closeModal();
    }
  }

  function handleKeydown(event) {
    if (youtubeOverlay && !youtubeOverlay.classList.contains("hidden")) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeYoutubeOverlay();
      }
      return;
    }
    if (!modal || modal.style.display !== "flex") return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      handleNavKey("ArrowLeft");
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      handleNavKey("ArrowRight");
      return;
    }
    if (event.key === " " || event.key === "Spacebar" || event.code === "Space") {
      event.preventDefault();
      handleNavKey(" ");
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
    }
  }

  function bindEvents() {
    youtubeLink?.addEventListener("click", (event) => {
      const href = youtubeLink.dataset.youtube || currentYoutubeUrl;
      if (!href) return;
      event.preventDefault();
      const opened = openYoutubeOverlay();
      if (!opened) {
        window.open(href, "_blank", "noopener");
      }
    });
    youtubeOverlayClose?.addEventListener("click", (event) => {
      event.preventDefault();
      closeYoutubeOverlay();
    });
    youtubeOverlay?.addEventListener("click", (event) => {
      if (event.target === youtubeOverlay) {
        closeYoutubeOverlay();
      }
    });
    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== modalEmbed?.contentWindow) return;
      const data = event.data || {};
      if (data.type !== "wsb-dashboard-nav-key") return;
      const key = String(data.key || "");
      if (!key) return;
      handleNavKey(key);
    });
    document.addEventListener("keydown", handleKeydown);
  }

  async function init() {
    const requested = getRequestedStandaloneImage();
    if (requested && requested !== STANDALONE_FILENAME) {
      navigateToImage(requested);
      return;
    }

    if (requested === STANDALONE_FILENAME) {
      history.replaceState(null, "", getStandalonePath());
    }

    showShell();
    bindEvents();
    applyStandaloneFocusOrder();
    updateFavoriteButton();
    applySocialLinks(currentImage);
    ensureCurrentImageFromList();
  }

  window.closeModal = closeModal;
  window.prevImage = prevImage;
  window.nextImage = nextImage;
  window.toggleFavoriteFromModal = toggleFavoriteFromModal;

  init();
})();