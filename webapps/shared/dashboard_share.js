(function () {
  "use strict";

  // A copied link is a complete control snapshot, including default values.
  // Dashboard-specific validation remains with each dashboard's data model.
  function encodeShareState(payload) {
    try {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      let binary = "";
      bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    } catch (_) {
      return "";
    }
  }

  function decodeShareState(raw) {
    if (!raw) return null;
    try {
      const normalized = String(raw).replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function getShellParams(location = window.location) {
    const params = new URLSearchParams(location.search || "");
    const hash = String(location.hash || "");
    const queryIndex = hash.indexOf("?");
    if (queryIndex >= 0) {
      const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
      for (const key of new Set(hashParams.keys())) {
        if (!params.has(key)) hashParams.getAll(key).forEach((value) => params.append(key, value));
      }
    }
    return params;
  }

  function readShareState({ search, param = "state", aliases = [] } = {}) {
    const params = search == null ? getShellParams() : new URLSearchParams(search);
    for (const key of [param, ...aliases]) {
      const state = decodeShareState(params.get(key));
      if (state) return state;
    }
    return null;
  }

  function buildShareUrl({ slug, state = {}, params = {}, param = "state" }) {
    if (!/^[a-z0-9_]+$/.test(slug || "")) throw new Error("Invalid dashboard slug");
    const location = window.location;
    const path = String(location.pathname || "");
    const match = path.match(/^(.*)\/webapps\/[^/]+\/dashboard\.html$/i);
    const base = match ? match[1] : path.replace(/\/[^/]*$/, "");
    const local = location.protocol === "file:"
      || ["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname);
    const url = new URL(`${base}/${slug}${local ? ".html" : ""}`, location.href);
    Object.entries(params).forEach(([key, value]) => {
      if (value != null) url.searchParams.set(key, String(value));
    });
    const encoded = encodeShareState(state);
    if (!encoded) throw new Error("Unable to encode dashboard settings");
    url.searchParams.set(param, encoded);
    return url.toString();
  }

  function buildDashboardSrc(path, { params = getShellParams(), nonce = Date.now() } = {}) {
    const url = new URL(path, window.location.href);
    if (url.origin !== window.location.origin) return url.toString();
    // Keep legacy dashboard query fields as well as the canonical state payload.
    const sourceParams = new URLSearchParams(params);
    for (const key of new Set(sourceParams.keys())) {
      if (key !== "_" && key !== "image" && !url.searchParams.has(key)) {
        sourceParams.getAll(key).forEach((value) => url.searchParams.append(key, value));
      }
    }
    url.searchParams.set("_", String(nonce));
    return `${url.pathname}${url.search}${url.hash}`;
  }

  window.WSBDashboardShare = {
    encodeShareState, decodeShareState, readShareState, buildShareUrl,
    getShellParams, buildDashboardSrc,
  };
}());
