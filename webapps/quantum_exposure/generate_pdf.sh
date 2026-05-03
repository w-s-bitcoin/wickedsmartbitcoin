#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MD_FILE="$SCRIPT_DIR/METHODOLOGY.txt"
PDF_OUT="$SCRIPT_DIR/METHODOLOGY.pdf"
CSS_FILE="/tmp/methodology_style.css"
HTML_FILE="/tmp/METHODOLOGY_inline.html"

# ── Stylesheet ──────────────────────────────────────────────────────────────
cat > "$CSS_FILE" << 'ENDCSS'
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

@page {
  margin: 2.2cm 2.5cm 2.2cm 2.5cm;
  @bottom-center {
    content: counter(page) " / " counter(pages);
    font-family: 'Inter', sans-serif;
    font-size: 9pt;
    color: #888;
  }
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 10.5pt;
  line-height: 1.65;
  color: #1a1a1a;
  max-width: 100%;
}

h1 {
  font-size: 20pt;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 0.3em;
  padding-bottom: 0.4em;
  border-bottom: 2.5px solid #f7931a;
}

h2 {
  font-size: 13.5pt;
  font-weight: 700;
  color: #1e3a5f;
  margin-top: 1.8em;
  margin-bottom: 0.4em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid #d1dbe8;
  page-break-after: avoid;
}

h3 {
  font-size: 11pt;
  font-weight: 600;
  color: #334155;
  margin-top: 1.2em;
  margin-bottom: 0.3em;
  page-break-after: avoid;
}

h4 {
  font-size: 10.5pt;
  font-weight: 600;
  color: #475569;
  margin-top: 1em;
  margin-bottom: 0.2em;
  page-break-after: avoid;
}

p {
  margin: 0.5em 0 0.7em 0;
}

ul, ol {
  margin: 0.4em 0 0.7em 1.4em;
  padding: 0;
}

li {
  margin-bottom: 0.35em;
}

strong {
  font-weight: 600;
  color: #111;
}

em {
  color: #334155;
}

code {
  font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
  font-size: 9pt;
  background: #f1f5f9;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  color: #c0392b;
}

pre {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-left: 3px solid #f7931a;
  border-radius: 4px;
  padding: 0.8em 1em;
  font-size: 9pt;
  overflow-x: auto;
  page-break-inside: avoid;
}

pre code {
  background: none;
  padding: 0;
  color: #1a1a1a;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9.5pt;
  margin: 0.8em 0 1em 0;
  page-break-inside: avoid;
}

thead tr {
  background: #1e3a5f;
  color: white;
}

thead th {
  padding: 0.5em 0.8em;
  text-align: left;
  font-weight: 600;
  font-size: 9pt;
  letter-spacing: 0.02em;
}

tbody tr:nth-child(even) {
  background: #f8fafc;
}

tbody tr:hover {
  background: #f1f5f9;
}

tbody td {
  padding: 0.45em 0.8em;
  border-bottom: 1px solid #e2e8f0;
  vertical-align: top;
}

hr {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 1.5em 0;
}

blockquote {
  border-left: 3px solid #f7931a;
  padding: 0.3em 1em;
  margin: 0.8em 0;
  color: #475569;
  background: #fffbf5;
}

a {
  color: #1e3a5f;
}
ENDCSS

# ── Markdown → HTML (no --metadata title to avoid duplicate h1) ─────────────
/opt/homebrew/bin/pandoc \
  "$MD_FILE" \
  --from markdown \
  --to html5 \
  --standalone \
  --css "$CSS_FILE" \
  --output /tmp/METHODOLOGY_raw.html

# ── Inline the CSS so Chrome doesn't need filesystem access ─────────────────
python3 - << 'PYEOF'
import sys
with open('/tmp/methodology_style.css') as f:
    css = f.read()
with open('/tmp/METHODOLOGY_raw.html') as f:
    html = f.read()
html = html.replace(
    '<link rel="stylesheet" href="/tmp/methodology_style.css" />',
    f'<style>\n{css}\n</style>'
)
with open('/tmp/METHODOLOGY_inline.html', 'w') as f:
    f.write(html)
PYEOF

# ── HTML → PDF via Chrome headless ──────────────────────────────────────────
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --print-to-pdf="$PDF_OUT" \
  --no-pdf-header-footer \
  "file://$HTML_FILE" 2>&1 | grep -v "^$" || true

echo "PDF written to $PDF_OUT"
