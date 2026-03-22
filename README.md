# Wicked Smart Bitcoin

Live site: https://wickedsmartbitcoin.com  
Repository: https://github.com/w-s-bitcoin/animations

Wicked Smart Bitcoin is a static site that publishes Bitcoin data visualizations as shareable pages.

## What This Repo Contains

- Static frontend files (HTML/CSS/JS)
- Generated PNG charts and metadata manifest
- No backend, database, or runtime API dependency

## Current Architecture (High Level)

- `index.html`: home/discovery page (grid, search, favorites, menu, slideshow)
- `view.html`: standalone visualization shell used for local deep-link rendering
- `404.html`: production standalone shell entry (GitHub Pages fallback for clean paths)
- `assets/image_list.json`: source of visualization metadata

This split allows clean production URLs such as `/node_count` while avoiding the old “modal over home page” behavior for shared links.

## Key User Features

- Fast grid/list browsing on home page
- Standalone deep-link visualization pages
- Contextual controls by visualization family (scale, year, region, unit, etc.)
- Favorites persisted locally
- Keyboard and touch-friendly modal interactions
- Slideshow mode

## Local Development

```bash
git clone https://github.com/w-s-bitcoin/animations
cd animations
python3 -m http.server 8080
```

Open:

- Home: `http://localhost:8080`
- Standalone deep link: `http://localhost:8080/view.html#<visualization_slug>`

## Repository Layout

```text
.
├── index.html
├── view.html
├── 404.html
├── assets/
├── final_frames/
├── js/
└── webapps/
```

For JavaScript internals and editing guidance, see `js/js_README.md`.

## Donation

Lightning address: `wicked@getalby.com`

![Lightning Donation QR](assets/lightning_donation_qr.png)

## License

© 2025 Wicked Smart Bitcoin. Reuse of charts requires attribution.
