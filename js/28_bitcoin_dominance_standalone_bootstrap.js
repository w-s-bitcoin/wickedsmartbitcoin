(() => {
  const STANDALONE_FILENAME = "bitcoin_dominance.png";
  const IMAGE_LIST_URL = "assets/image_list.json";
  const DASHBOARD_URL = "webapps/bitcoin_dominance/dashboard.html";
  const FAVORITES_STORAGE_KEY = "favorites";

  const modal = document.getElementById("modal");
  const modalImg = document.getElementById("modal-img");
  const modalEmbedWrap = document.getElementById("modal-embed-wrap");
  const modalEmbed = document.getElementById("modal-embed");
  const modalFavBtn = document.getElementById("modal-fav-btn");
  const modalDlBtn = document.getElementById("modal-dl-btn");
  const xLink = document.getElementById("x-link");
  const nostrLink = document.getElementById("nostr-link");
  const youtubeLink = document.getElementById("youtube-link");
  const youtubeOverlay = document.getElementById("youtube-overlay");
  const youtubeOverlayClose = document.getElementById("youtubeOverlayClose");
  const youtubeIframe = document.getElementById("youtube-iframe");

  let currentImage = {
    filename: STANDALONE_FILENAME,
    title: "Bitcoin Dominance",
    description: "",
    latest_x: "",
    latest_nostr: "",
    latest_youtube: "",
  };
  let currentIndex = 0;
  let imageListCache = null;
  let imageListPromise = null;
  let currentYoutubeUrl = "";

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
    const path = location.hostname === "localhost"
      ? `${base}/bitcoin_dominance.html`
      : `${base}/bitcoin_dominance`;
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
    if (slug === "bitcoin_dominance") return getStandalonePath();

    const base = getPageBasePath();
    if (location.hostname === "localhost") {
      return normalizeJoinedPath(`${getPageBasePath()}/view.html#${encodeURIComponent(slug)}`);
    }
    return normalizeJoinedPath(`${base}/${slug}`);
  }

  function imgSrc(filename) {
    return normalizeJoinedPath(`${getPageBasePath()}/final_frames/${filename}`);
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
  }

  function setCurrentImage(image, index) {
    currentImage = image || currentImage;
    currentIndex = Number.isInteger(index) ? index : currentIndex;
    document.title = `${currentImage.title || "Bitcoin Dominance"} | Wicked Smart Bitcoin`;
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
      modalEmbed.setAttribute("src", DASHBOARD_URL);
    }
    if (modalImg) {
      modalImg.style.opacity = "0";
      modalImg.style.visibility = "hidden";
      modalImg.style.transform = "translate3d(-9999px,-9999px,0) scale(1)";
    }
    if (modalDlBtn) {
      modalDlBtn.style.display = "";
      modalDlBtn.disabled = true;
      modalDlBtn.classList.add("dashboard-download-disabled");
      modalDlBtn.setAttribute("aria-label", "Download disabled");
      modalDlBtn.title = "Download disabled";
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
    const showArchived = parseStoredBoolean(localStorage.getItem("showArchivedVisualizations"));
    const showFavoritesOnly = parseStoredBoolean(localStorage.getItem("showFavoritesOnly"));
    const favorites = new Set(readFavorites());

    return list.filter((item) => {
      const filename = String(item?.filename || "").trim();
      if (!filename) return false;

      const isArchived = parseStoredBoolean(item?.archived);
      if (!showArchived && isArchived) return false;
      if (showFavoritesOnly && !favorites.has(filename)) return false;
      return true;
    });
  }

  function parseStoredBoolean(value) {
    if (typeof value === "boolean") return value;
    const normalized = String(value == null ? "" : value).trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }

  async function downloadCurrentModalImage() {
    const filename = currentImage.filename || STANDALONE_FILENAME;
    const url = imgSrc(filename);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (_) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
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
    window.location.href = getHomeUrl();
  }

  function prevImage() {
    navigateRelative(-1);
  }

  function nextImage() {
    navigateRelative(1);
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
      prevImage();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      nextImage();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
    }
  }

  function bindEvents() {
    modalDlBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      if (modalDlBtn.disabled) return;
      downloadCurrentModalImage();
    });
    modalDlBtn?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " " && event.code !== "Space") return;
      event.preventDefault();
      if (modalDlBtn.disabled) return;
      downloadCurrentModalImage();
    });
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
