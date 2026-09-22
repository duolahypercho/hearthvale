#!/usr/bin/env node
/**
 * Smoke test: boots the real game in headless Chromium (WebGL via ANGLE/Metal, SwiftShader
 * fallback) and exercises every window.__game DebugApi method plus the core farming loop.
 * Fails on page errors, console errors, broken invariants, or a blown render budget.
 *
 *   node scripts/smoke.mjs        (npm test)
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = resolve(tmpdir(), `hearthvale-smoke-${process.pid}`);
const server = await createServer({ root, logLevel: 'error', cacheDir, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const port = server.httpServer.address().port;

const GPU = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'];
const SWIFT = ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let browser = await chromium.launch({ headless: true, args: GPU });
let page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const hasGL = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
if (!hasGL) {
  await browser.close();
  browser = await chromium.launch({ headless: true, args: SWIFT });
  page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
}

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};

try {
  await page.goto(`http://127.0.0.1:${port}/?demo=farm-morning`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__game?.ready === 'function', null, { timeout: 90000 });
  await page.evaluate(() => window.__game.ready());
  check('boot + ready()', true);

  const r = await page.evaluate(async () => {
    const g = window.__game;
    const out = {};
    const info = () => g.info();
    g.step(10);
    out.perf = info().perf;
    // time / calendar
    g.setTime(18.5);
    out.time = info().calendar.hour;
    g.setDay(5);
    out.day = info().calendar.day;
    for (const s of ['summer', 'fall', 'winter', 'spring']) {
      g.setSeason(s);
      g.step(2);
    }
    out.season = info().calendar.season;
    for (const w of ['rain', 'storm', 'snow', 'wind', 'sun']) {
      g.setWeather(w);
      g.step(2);
    }
    out.weather = info().calendar.weather;
    await g.teleport('farm', 30.5, 22.5);
    out.pos = info().player;
    g.facing('up');
    out.facing = info().player.facing;
    // UI
    g.openUI('inventory');
    out.invOpen = !document.querySelector('.hv-inventory')?.classList.contains('hv-hidden');
    g.openUI('none');
    out.invClosed = !!document.querySelector('.hv-inventory')?.classList.contains('hv-hidden');
    // economy / items
    g.setGold(1234);
    g.step(30);
    out.gold = info().gold;
    const inv = g.game.services.inventory;
    const before = inv.count('pumpkin');
    g.give('pumpkin', 3);
    out.gave = inv.count('pumpkin') - before;
    // farming loop on a fresh tile: hoe → water → plant → grow → harvest
    const ev = g.game.events;
    const tx = 44, tz = 30;
    const grid = g.game.world.current.grid;
    grid.removeObject(tx, tz);
    const e0 = g.game.services.energy.value();
    ev.emit('item:use', { itemId: 'hoe', x: tx, z: tz, slot: 0 });
    out.tilled = grid.hasFlag(tx, tz, 4);
    out.energySpent = e0 - g.game.services.energy.value();
    ev.emit('item:use', { itemId: 'wateringCan', x: tx, z: tz, slot: 1 });
    out.watered = grid.hasFlag(tx, tz, 8);
    g.setSeason('spring');
    inv.add('parsnipSeeds', 1);
    const slot = inv.slots.findIndex((s) => s && s.id === 'parsnipSeeds');
    ev.emit('item:use', { itemId: 'parsnipSeeds', x: tx, z: tz, slot });
    out.planted = grid.getObject(tx, tz)?.kind === 'crop';
    g.grow(10);
    const p0 = inv.count('parsnip');
    ev.emit('player:interact', { x: tx, z: tz });
    out.harvested = inv.count('parsnip') > p0;
    // gameplay pillar services (each system owns its state; teams land work independently)
    const sv = g.game.services;
    out.services = ['economy', 'energy', 'sleep', 'relationships', 'fishing', 'mining', 'crafting', 'quests'].filter((k) => !sv[k]);
    out.spendRefused = sv.economy.spend(1e9) === false && sv.economy.gold() === 1234;
    ev.emit('npc:talk', { id: 'wren' });
    out.friendship = sv.relationships.points('wren') > 0;
    out.bundles = sv.quests.bundles().length;
    // sleep: a proper night refills energy and rolls the calendar
    const day0 = g.game.calendar.day;
    g.setTime(21);
    sv.sleep.sleep();
    out.slept = g.game.calendar.day === day0 + 1 && sv.energy.value() === sv.energy.max() && g.game.calendar.hour < 6.5;
    // every DESIGN.md screen has a registered panel
    out.panels = ['inventory', 'shop', 'dialogue', 'fishing', 'crafting', 'map', 'title'].filter((p) => !g.game.hud.hasPanel(p));
    for (const p of ['shop', 'dialogue:bram', 'fishing', 'crafting', 'map', 'title']) {
      g.openUI(p);
      g.step(2);
    }
    g.openUI('none');
    // overgrown farm: hundreds of clearable debris tiles
    out.debris = g.game.world.current.overgrowth?.placed ?? 0;
    // town + villagers + farm → town warp
    await g.teleport('town', 32, 30);
    g.step(5);
    out.townMap = info().map;
    out.npcs = g.game.services.npcs?.positions().length ?? 0;
    out.townPerf = info().perf;
    await g.teleport('farm', 31.5, 20);
    out.warps = (g.game.world.current.warps ?? []).map((w) => w.to);
    out.audio = !!g.game.services.audio;
    // demos
    out.demos = [];
    for (const d of g.demos) {
      await g.demo(d);
      g.step(2);
      out.demos.push(d);
    }
    // quality + camera + pause + save/load
    g.quality('low');
    g.step(3);
    g.quality('high');
    g.step(3);
    g.camera({ yaw: 10, pitch: 45, distance: 26 });
    g.pause(true);
    out.paused = info().paused;
    g.pause(false);
    out.saved = g.save('smoke');
    out.loaded = g.load('smoke');
    g.step(5);
    await g.demo('farm-morning');
    g.step(20);
    out.perfEnd = info().perf;
    return out;
  });

  check('setTime', Math.abs(r.time - 18.5) < 0.01, `hour=${r.time}`);
  check('setDay', r.day === 5);
  check('setSeason', r.season === 'spring');
  check('setWeather', r.weather === 'sun');
  check('teleport', Math.abs(r.pos.x - 30.5) < 0.01 && Math.abs(r.pos.z - 22.5) < 0.01);
  check('facing', r.facing === 'up');
  check('openUI(inventory)', r.invOpen);
  check('openUI(none)', r.invClosed);
  check('setGold', r.gold === 1234);
  check('give', r.gave === 3);
  check('farming: hoe tills', r.tilled);
  check('energy: tools spend stamina', r.energySpent > 0, `${r.energySpent}`);
  check('pillar services registered', r.services.length === 0, r.services.join(','));
  check('economy: refuses unaffordable spend', r.spendRefused);
  check('relationships: talk earns friendship', r.friendship);
  check('quests: Lantern Hall bundles', r.bundles >= 4, `${r.bundles}`);
  check('sleep: next morning, full energy', r.slept);
  check('farming: can waters', r.watered);
  check('farming: seeds plant', r.planted);
  check('farming: grow + harvest', r.harvested);
  check('panels registered (shop, dialogue, fishing, crafting, map, title)', r.panels.length === 0, r.panels.join(','));
  check('farm overgrowth debris ≥ 350', r.debris >= 350, `${r.debris}`);
  check('town map loads with villagers', r.townMap === 'town' && r.npcs >= 3, `${r.townMap}, ${r.npcs} npcs`);
  check('render budget (town)', r.townPerf.ok, `${r.townPerf.drawCalls} calls, ${(r.townPerf.triangles / 1e6).toFixed(2)}M tris`);
  check('farm → town warp', r.warps.includes('town'));
  check('audio service', r.audio);
  check('demo(*)', r.demos.length > 5, r.demos.join(', '));
  check('pause', r.paused === true);
  check('save/load', r.saved && r.loaded);
  const p = r.perfEnd;
  check('render budget (farm-morning)', p.ok, `${p.drawCalls} calls, ${(p.triangles / 1e6).toFixed(2)}M tris`);
  const real = errors.filter((e) => !/not implemented yet|staging on farm/.test(e));
  check('no page / console errors', real.length === 0, real.slice(0, 3).join(' | '));
} catch (e) {
  console.error('✗ smoke crashed:', e);
  failed++;
} finally {
  await browser.close().catch(() => {});
  await server.close().catch(() => {});
  try {
    rmSync(cacheDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall smoke checks passed');
process.exit(failed ? 1 : 0);
