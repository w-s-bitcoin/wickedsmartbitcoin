/* ===========================
 * MODULE: Dominance helpers
 * =========================== */
function isDominanceFile(fname) {
    const normalized = String(fname || '').replace(/^\/+/, '').toLowerCase();
    return normalized === `${DOM_BASE}.png` || normalized === `${DOM_BASE}_btc.png`;
}