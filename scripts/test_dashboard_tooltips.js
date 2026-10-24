#!/usr/bin/env node
// Portable real-source UI contracts with synthetic DOM/canvas fixtures only.
// Does not start a browser, fetch data, or inspect personal Net Worth records.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

class ElementFixture {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map(Object.entries(attrs));
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this.rect = { left: 100, top: 80, right: 200, bottom: 110, width: 100, height: 30 };
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  matches(selector) {
    if (selector === 'dialog[open]') return this.tagName === 'DIALOG' && this.hasAttribute('open');
    if (selector.startsWith('.')) return String(this.className || '').split(/\s+/).includes(selector.slice(1));
    if (/^\[[\w-]+\]$/.test(selector)) return this.hasAttribute(selector.slice(1, -1));
    return false;
  }
  closest(selectors) {
    for (let node = this; node; node = node.parentElement) {
      if (selectors.split(',').some(selector => node.matches(selector.trim()))) return node;
    }
    return null;
  }
  contains(other) {
    for (let node = other; node; node = node.parentElement) if (node === this) return true;
    return false;
  }
  appendChild(child) {
    if (child.parentElement) child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  getBoundingClientRect() {
    return this.id === 'wsb-native-title-tooltip'
      ? { left: 0, top: 0, right: 240, bottom: 40, width: 240, height: 40 }
      : this.rect;
  }
}

function runtime() {
  const listeners = new Map();
  const windowListeners = new Map();
  const html = new ElementFixture('html');
  const body = html.appendChild(new ElementFixture('body'));
  html.clientWidth = 390;
  html.clientHeight = 600;
  const document = {
    documentElement: html, body, readyState: 'complete',
    createElement: tag => new ElementFixture(tag),
    querySelectorAll: selector => html.querySelectorAll(selector),
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
  };
  const window = { addEventListener: (type, fn) => windowListeners.set(type, [...(windowListeners.get(type) || []), fn]) };
  const tokens = {};
  const context = vm.createContext({ window, document, Element: ElementFixture, HTMLElement: ElementFixture,
    getComputedStyle: () => ({ getPropertyValue: name => tokens[name] || '' }) });
  vm.runInContext(fs.readFileSync(path.join(root, 'webapps/shared/dashboard_components.js'), 'utf8'), context);
  const emit = (type, event = {}) => (listeners.get(type) || []).forEach(fn => fn(event));
  const emitWindow = type => (windowListeners.get(type) || []).forEach(fn => fn({}));
  return { api: window.WSBDashboardComponents, html, body, emit, emitWindow, tokens };
}

const run = runtime();
const { api } = run;
const escaped = api.renderTooltip({ title: '<img src=x onerror="bad">',
  rows: [{ label: 'A&B <script>', value: '\'quoted" > value' }], note: '<svg onload=bad>' });
assert(!escaped.includes('<img') && !escaped.includes('<script>') && !escaped.includes('<svg'));
assert(escaped.includes('&amp;') && escaped.includes('&lt;') && escaped.includes('&quot;') && escaped.includes('&#39;'));
const empty = api.renderTooltip({ title: 0, rows: [{ label: 'Zero', value: 0 }, { label: 'Missing' }, { label: 'Null', value: null }] });
assert.match(empty, /wsb-tooltip-title">0</);
assert.match(empty, /wsb-tooltip-value">0</);
assert.equal((empty.match(/wsb-tooltip-value">—</g) || []).length, 2, 'missing values are distinct from zero');
for (const color of ['#ff9900', 'rgba(1, 2, 3, 0.4)', 'var(--series-color)']) {
  assert.match(api.renderTooltip({ rows: [{ label: 'Series', value: 1, color }] }), /wsb-tooltip-swatch/);
}
for (const color of ['red; color:red', 'url(https://example.invalid/image)', '#fff" onmouseover="bad', 'var(--x);display:none']) {
  const rendered = api.renderTooltip({ rows: [{ label: 'Series', value: 1, color }] });
  assert(!rendered.includes('style='), 'untrusted color must not create CSS or HTML');
}
const semantic = api.renderTooltip({ rows: [
  { label: 'Liabilities', value: '2 BTC', color: '#ff0000' },
  { label: 'Return', value: '+3%', tone: 'positive' },
  { label: 'Return', value: '-2%', tone: 'negative' },
  { label: 'Invalid tone', value: '1', tone: 'positive injected' },
] });
assert.equal((semantic.match(/wsb-tooltip-value--positive/g) || []).length, 1);
assert.equal((semantic.match(/wsb-tooltip-value--negative/g) || []).length, 1);
assert(!semantic.includes('injected'), 'series colors do not imply value tones');
assert.equal(api.getTooltipTheme().background, '#0b0b0b');
run.html.dataset.theme = 'light';
assert.equal(api.getTooltipTheme().background, '#ffffff');
assert.equal(api.getTooltipTheme().color, '#1c1b19');
run.tokens['--wsb-tooltip-bg'] = '#123456';
run.tokens['--wsb-tooltip-fg'] = '#abcdef';
run.tokens['--wsb-tooltip-border'] = '#999999';
const plotly = api.getPlotlyHoverlabel();
assert.equal(plotly.bgcolor, '#123456');
assert.equal(plotly.bordercolor, '#999999');
assert.equal(plotly.font.color, '#abcdef');
assert.equal(plotly.font.size, 12);
assert.match(plotly.font.family, /IBM Plex Mono/);

// Delegated help: accessibility restoration, nested targets, top-layer dialogs,
// dynamic data-tooltip controls, and coexistence with rich custom binders.
const control = run.body.appendChild(new ElementFixture('button', { title: '<literal> help', 'aria-describedby': 'existing-description' }));
const icon = control.appendChild(new ElementFixture('span'));
const tooltip = () => [...run.body.children, ...run.body.children.flatMap(node => node.children)]
  .find(node => node.id === 'wsb-native-title-tooltip');
run.emit('pointerover', { target: icon });
assert.equal(tooltip().textContent, '<literal> help', 'native help is text, not HTML');
assert.equal(tooltip().parentElement, run.body);
assert.equal(control.getAttribute('title'), null);
assert.equal(control.getAttribute('aria-describedby'), 'existing-description wsb-native-title-tooltip');
run.emit('pointerout', { target: control, relatedTarget: icon });
assert.equal(tooltip().hidden, false, 'moving within an anchor must keep its tooltip');
run.emit('pointerout', { target: icon, relatedTarget: run.body });
assert.equal(control.getAttribute('title'), '<literal> help');
assert.equal(control.getAttribute('aria-describedby'), 'existing-description');
assert.equal(tooltip().hidden, true);
for (const dismiss of ['pointerdown', 'scroll', 'keydown', 'resize', 'focusout']) {
  run.emit('focusin', { target: control });
  if (dismiss === 'resize') run.emitWindow('resize');
  else run.emit(dismiss, { target: control, relatedTarget: run.body, key: 'Escape' });
  assert.equal(tooltip().hidden, true, `${dismiss} dismisses help`);
  assert.equal(control.getAttribute('title'), '<literal> help');
  assert.equal(control.getAttribute('aria-describedby'), 'existing-description');
}
run.emit('pointerover', { target: control });
control.setAttribute('title', 'Updated while open');
run.emit('pointerdown');
assert.equal(control.getAttribute('title'), 'Updated while open', 'dismissal preserves a newer title written by the app');
const record = run.body.appendChild(new ElementFixture('tr', { title: 'Load snapshot' }));
const deleteButton = record.appendChild(new ElementFixture('button', { title: 'Delete snapshot' }));
const deleteIcon = deleteButton.appendChild(new ElementFixture('span'));
run.emit('pointerover', { target: record });
assert.equal(tooltip().textContent, 'Load snapshot');
run.emit('pointerover', { target: deleteButton });
assert.equal(tooltip().textContent, 'Delete snapshot', 'nested titled controls take over ancestor help');
assert.equal(record.getAttribute('title'), 'Load snapshot');
assert.equal(deleteButton.getAttribute('title'), null);
run.emit('pointerover', { target: deleteIcon });
assert.equal(tooltip().textContent, 'Delete snapshot', 'plain descendants keep the nearest active owner');
run.emit('pointerout', { target: deleteButton, relatedTarget: record });
run.emit('pointerover', { target: record });
assert.equal(tooltip().textContent, 'Load snapshot');
assert.equal(deleteButton.getAttribute('title'), 'Delete snapshot');
run.emit('pointerdown');
const dialog = run.body.appendChild(new ElementFixture('dialog', { open: '' }));
const dialogControl = dialog.appendChild(new ElementFixture('button', { title: 'Inside dialog' }));
dialogControl.rect = { left: 360, top: 570, bottom: 595, width: 20, height: 25 };
run.emit('focusin', { target: dialogControl });
assert.equal(tooltip().parentElement, dialog, 'help must enter the open dialog top layer');
assert.equal(tooltip().style.left, '138px', 'help stays inside viewport');
assert.equal(tooltip().style.top, '522px', 'help moves above a bottom-edge control');
run.emit('keydown', { key: 'Escape' });
assert.equal(dialogControl.getAttribute('aria-describedby'), null);
const dataControl = run.body.appendChild(new ElementFixture('button', { 'data-tooltip': 'Dynamic help' }));
run.emit('pointerover', { target: dataControl });
assert.equal(tooltip().hidden, false);
assert.equal(tooltip().textContent, 'Dynamic help');
run.emit('pointerdown');
assert.equal(dataControl.hasAttribute('title'), false, 'data-tooltip must not synthesize a native title');
run.html.setAttribute('data-custom-tooltip-binder', '');
run.emit('pointerover', { target: dataControl });
assert.equal(tooltip().hidden, true, 'custom rich tooltip binder remains the only owner');
const richChild = record.appendChild(new ElementFixture('span', { 'data-tooltip': 'Rich snapshot details' }));
run.emit('pointerover', { target: record });
assert.equal(tooltip().hidden, false);
run.emit('pointerover', { target: richChild });
assert.equal(tooltip().hidden, true, 'nested rich help dismisses active ancestor help instead of doubling it');
assert.equal(record.getAttribute('title'), 'Load snapshot');
const capControl = run.body.appendChild(new ElementFixture('button', { title: 'Rich metric', 'data-cap-tooltip': '1' }));
run.emit('pointerover', { target: capControl });
assert.equal(tooltip().hidden, true);
const about = run.body.appendChild(new ElementFixture()); about.className = 'info-wrap';
run.emit('pointerover', { target: about.appendChild(new ElementFixture('button', { title: 'About' })) });
assert.equal(tooltip().hidden, true);
run.emit('pointerover', { target: control });
assert.equal(tooltip().hidden, false, 'ordinary titles still work beside custom data-tooltip binders');
run.emit('pointerdown');

// Extract the actual canvas painter, without evaluating the personal-data app.
const source = fs.readFileSync(path.join(root, 'webapps/bitcoin_net_worth/dashboard_app.js'), 'utf8');
const helper = source.slice(source.indexOf('function drawHistoryTooltip('), source.indexOf('\nfunction drawLineChart('));
assert(helper.startsWith('function drawHistoryTooltip('));
const theme = runtime().api.getTooltipTheme();
function paint(dpr, width = 600, datasets = [
  { label: 'BTC Net Worth', color: '#ff9900', values: [25], rawValues: [2.5], rawFormatter: value => `${value.toFixed(8)} BTC` },
  { label: 'USD Net Worth', color: '#aabbcc', values: [-10], rawValues: [250000], rawFormatter: value => `$${value.toLocaleString('en-US')}` },
]) {
  const text = [], swatches = [], scales = [];
  const ctx = { save() {}, restore() {}, scale(...args) { scales.push(args); }, beginPath() {}, moveTo() {}, closePath() {}, arcTo() {}, fill() {}, stroke() {},
    fillRect(...args) { swatches.push({ args, color: this.fillStyle }); },
    measureText(value) { return { width: String(value).length * 7.2 }; },
    fillText(value, x, y) { text.push({ text: value, x, y, font: this.font, color: this.fillStyle }); },
  };
  const canvas = { width: width * dpr, height: 320 * dpr, getContext: () => ctx, getBoundingClientRect: () => ({ width, height: 320 }) };
  const context = vm.createContext({ window: { devicePixelRatio: dpr, WSBDashboardComponents: { getTooltipTheme: () => theme } },
    formatDisplayDate: () => '10/24/2026', formatChartTooltipValue: (value, percent) => percent ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : value.toFixed(6) });
  vm.runInContext(helper, context);
  context.drawHistoryTooltip(canvas, datasets, 0, { hoveredHistoryDate: '102426', hoverY: 240 * dpr },
    { x: 250 * dpr, left: 20 * dpr, top: 20 * dpr, width: (width - 40) * dpr, height: 280 * dpr });
  return { text, swatches, scales };
}
const one = paint(1), two = paint(2);
assert.deepEqual(one.text, two.text, 'CSS positions and fonts must match across DPR');
assert.deepEqual(one.scales, [[1, 1]]); assert.deepEqual(two.scales, [[2, 2]]);
assert(one.text.every(item => / 12px /.test(item.font)));
assert.equal(one.text.find(item => item.text === '+25.00%').color, theme.positive);
assert.equal(one.text.find(item => item.text === '-10.00%').color, theme.negative);
assert.equal(one.text.find(item => item.text === '2.50000000 BTC ').color, theme.color);
assert(one.text.some(item => item.text === 'BTC Net Worth' && item.color === theme.muted));
assert.equal(one.swatches[0].color, '#ff9900');
for (const width of [320, 390, 600]) {
  const painted = paint(2, width);
  assert(painted.text.every(item => item.x >= 20 && item.x + item.text.length * 7.2 <= width - 20 + 0.01), 'text stays within plot width');
  assert(painted.text.every(item => item.y >= 20 && item.y <= 300), 'text stays within plot height');
}
const liabilities = paint(1, 600, [{ label: 'Liabilities', color: '#ff6f86', values: [0.25], valueFormatter: value => value.toFixed(6) }]);
assert.equal(liabilities.text.find(item => item.text === '0.250000').color, theme.color, 'series red does not imply a loss');
console.log('Dashboard tooltip contracts passed: escaping, theme/Plotly tokens, native help ownership/dialogs, and canvas DPR/layout/value semantics.');
