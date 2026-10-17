import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../webapps/shared/dashboard_charting.js', import.meta.url), 'utf8');

function fixture() {
  let time = 0, id = 0;
  const frames = new Map();
  function events(properties = {}) {
    const listeners = new Map();
    return Object.assign(properties, {
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(callback);
      },
      removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
      emit(type) { for (const callback of listeners.get(type) || []) callback({ type }); },
    });
  }
  const motion = events({ matches: false });
  const document = events({ hidden: false });
  const window = events({ performance: { now: () => time }, matchMedia: () => motion,
    requestAnimationFrame(callback) { frames.set(++id, callback); return id; },
    cancelAnimationFrame(key) { frames.delete(key); },
  });
  vm.runInNewContext(source, { window, document });
  return { C: window.WSBDashboardCharting, window, document, motion, frames,
    setTime(value) { time = value; },
    advance(value) { time = value; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); },
  };
}

test('scale transitions paint intermediate geometry and end exactly at the selected mode', () => {
  const f = fixture(), seen = [];
  const controller = f.C.createScaleTransitionController({ render: () => seen.push(controller.getMix('chart', 'log')) });
  controller.start('chart', 'linear', 'log');
  assert.equal(controller.getMix('chart', 'log'), 0);
  f.advance(350);
  assert.ok(Math.abs(seen.at(-1) - 0.5) < 1e-12);
  f.advance(700);
  assert.equal(seen.at(-1), 1);
  assert.equal(controller.isAnimating(), false);
  assert.equal(f.frames.size, 0);
  controller.destroy();
});

test('a slow render still gets its final endpoint frame', () => {
  const f = fixture(), seen = [];
  const controller = f.C.createScaleTransitionController({ render() {
    seen.push(controller.getMix('chart', 'log'));
    f.setTime(705);
  } });
  controller.start('chart', 'linear', 'log');
  f.advance(695);
  assert.ok(seen.at(-1) < 1);
  assert.equal(f.frames.size, 1);
  f.advance(720);
  assert.equal(seen.at(-1), 1);
  assert.equal(f.frames.size, 0);
});

test('rapid reversals begin at the last painted point and panels animate independently', () => {
  const f = fixture(), values = {};
  let mode = 'log';
  const controller = f.C.createScaleTransitionController({ render() {
    values.a = controller.getMix('a', mode);
    values.b = controller.getMix('b', 'linear');
  } });
  controller.start('a', 'linear', 'log');
  controller.start('b', 'log', 'linear');
  f.advance(280);
  const drawn = values.a;
  f.setTime(310);
  controller.start('a', 'log', 'linear'); mode = 'linear';
  f.setTime(325); // The click handler may spend time synchronizing controls.
  assert.equal(controller.getMix('a', mode), drawn);
  f.advance(450);
  assert.ok(values.a < drawn);
  assert.ok(values.b > 0 && values.b < 1);
  controller.finish('a');
  assert.equal(controller.getMix('a', mode), 0);
  assert.equal(controller.isAnimating('b'), true);
  f.advance(700);
  assert.equal(values.b, 0);
  assert.equal(controller.isAnimating(), false);
});

test('reduced motion, external mode changes, hidden pages and restored pages settle cleanly', () => {
  const f = fixture(); let paints = 0;
  const controller = f.C.createScaleTransitionController({ render: () => paints++ });
  controller.start('a', 'linear', 'log');
  f.motion.matches = true; f.motion.emit('change');
  assert.equal(controller.isAnimating(), false);
  assert.equal(controller.getMix('a', 'log'), 1);
  assert.equal(paints, 1);
  controller.start('a', 'log', 'linear');
  assert.equal(f.frames.size, 0);
  f.motion.matches = false;
  controller.start('a', 'linear', 'log');
  assert.equal(controller.getMix('a', 'linear'), 0);
  assert.equal(controller.isAnimating(), false);
  controller.start('a', 'linear', 'log');
  f.document.hidden = true; f.document.emit('visibilitychange');
  assert.equal(f.frames.size, 0);
  f.document.hidden = false; f.window.emit('pageshow');
  assert.equal(paints, 2);
  controller.destroy();
  f.window.emit('pageshow');
  assert.equal(paints, 2);
});

test('panels removed while animating stop scheduling work', () => {
  const f = fixture();
  const controller = f.C.createScaleTransitionController({ render() {} });
  controller.start('removed', 'linear', 'log');
  f.advance(701);
  assert.equal(controller.isAnimating(), false);
  assert.equal(f.frames.size, 0);
});

test('tick values remain fixed, shared labels survive, and unique zero fades only once', () => {
  const { C } = fixture();
  const linear = [0, 50000, 100000], log = [0.001, 0.1, 10, 1000, 100000];
  const alphas = [];
  for (let step = 0; step <= 200; step++) {
    const mix = step / 200;
    const y = value => (600 - value / 126000 * 568) * (1 - mix)
      + (value > 0 ? 600 - (Math.log10(value) - Math.log10(0.000764)) / (Math.log10(126000) - Math.log10(0.000764)) * 568 : 616) * mix;
    const ticks = C.morphScaleTicks(linear, log, mix, y);
    alphas.push(ticks.find(tick => tick.value === 0)?.alpha || 0);
    assert.equal(ticks.find(tick => tick.value === 100000).alpha, 1);
    assert.equal(new Set(ticks.map(tick => tick.value)).size, ticks.length);
    assert.ok(ticks.every(tick => [...linear, ...log].includes(tick.value)));
    assert.ok(ticks.every(tick => tick.alpha > 0 && tick.alpha <= 1));
  }
  assert.equal(alphas[0], 1); assert.equal(alphas.at(-1), 0);
  assert.ok(alphas.some(alpha => alpha > 0 && alpha < 1));
  for (let i = 1; i < alphas.length; i++) assert.ok(alphas[i] <= alphas[i - 1]);
  for (const mix of [0, 0.2, 0.5, 0.8, 1]) {
    assert.equal(C.morphScaleTicks([0, 100], [0, 10, 100], mix, value => 600 - value).find(tick => tick.value === 0).alpha, 1);
  }
});
