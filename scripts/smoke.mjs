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
  // (180 s: under a load of 150-400 on the shared machine a cold Vite transform of the module graph
  // alone overran the default 30 s navigation timeout)
  await page.goto(`http://127.0.0.1:${port}/?demo=farm-morning`, { waitUntil: 'load', timeout: 180000 });
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
    // farming depth: harvest XP, fertilizer, exhaustion (heavy work refused at 0, plain swings run
    // the bar negative), a scrubbed hoe swing on the tools demo keeps presenting frames
    const fm = g.game.services.farming;
    out.xp = fm.xp() > 0;
    const en = g.game.services.energy;
    const ft = { x: 45, z: 30 };
    grid.removeObject(ft.x, ft.z);
    ev.emit('item:use', { itemId: 'hoe', x: ft.x, z: ft.z, slot: 0 });
    inv.add('qualityFertilizer', 1);
    ev.emit('item:use', { itemId: 'qualityFertilizer', x: ft.x, z: ft.z, slot: inv.slots.findIndex((s) => s && s.id === 'qualityFertilizer') });
    out.fertilized = fm.fertAt(ft.x, ft.z) === 2;
    const eSave = en.value();
    en.set(0);
    fm.setToolTier('hoe', 3);
    fm.act('charge', { level: 3 });
    out.heavyRefused = en.value() === 0;
    grid.removeObject(46, 30);
    ev.emit('item:use', { itemId: 'hoe', x: 46, z: 30, slot: 0 });
    out.negative = en.value() < 0;
    fm.setToolTier('hoe', 0);
    en.set(eSave);
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
    // Town pod: no two villagers may stand inside each other at the busy hours (spot sub-slots).
    out.npcGaps = [];
    for (const h of [9, 12, 15, 18]) {
      g.setTime(h);
      g.step(20, 1 / 30);
      const mg = g.game.services.npcs?.minGap?.();
      if (mg) out.npcGaps.push({ h, d: mg.d, a: mg.a, b: mg.b });
    }
    // Town pod: the live talk lens is clear (no fountain / bystander heads in front, no buildings in
    // the sight lines) for every villager at 10:30; the dialogue card is each villager's own 3D model.
    out.talkCam = g.game.services.npcs?.auditTalk?.(10.5) ?? { checked: 0, fails: ['no audit'] };
    // Town pod r8: real F-talks (farmer beside each villager, left / right / south, at 9, 13, 17 h).
    out.liveTalk = g.game.services.npcs?.auditLive?.([9, 13, 17]) ?? { checked: 0, fails: ['no audit'] };
    // Town pod r7: heart-event staging audit (owner faces, sight lines, framing) and the portrait gate
    // (hair over eyes / nose, painted hair colour vs the 3D look) fail npm test.
    out.evAudit = g.game.services.npcs?.auditEvents?.() ?? { beats: 0, fails: ['no audit'] };
    out.portraitAudit = g.game.services.npcs?.auditPortraits?.() ?? { checked: 0, fails: ['no audit'] };
    try {
      const P = await import('/src/ui/portraits.ts');
      const N = await import('/src/data/npcs.ts');
      out.portraits = N.NPC_IDS.map((id) => {
        const d = N.NPCS[id];
        const svg = P.portraitSvg(d.look, d.portraitBg, 'happy');
        // (r8: a painted vector bust — no raster render inside — drawn from the villager's own look)
        return { id, model: svg.startsWith('<svg') && !/<image href="data:image/.test(svg) && svg.includes('feMorphology'), own: N.lookOwner(d.look)?.def.id === id };
      });
    } catch (e) {
      out.portraits = [{ id: 'error', model: false, own: false, err: String(e) }];
    }
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
    // animals: a night with a stocked coop + barn shows the Animals row on the end-of-day card
    await g.demo('barn-interior');
    g.step(3);
    let night = null;
    const offNight = ev.on('sleep:summary', (s) => (night = s));
    g.game.services.sleep.sleep();
    await new Promise((res) => setTimeout(res, 60));
    offNight();
    g.step(2);
    out.animalsNight = !!night?.animals && night.animals.total > 0 && night.animals.fed + night.animals.hungry === night.animals.total;
    out.animalsRow = !!document.querySelector('.hv-dayend .de-animals');
    g.openUI('none');
    await g.demo('farm-tools');
    for (let i = 0; i < 6; i++) {
      g.game.services.farming.scrub(0.1 + i * 0.06);
      g.step(3);
    }
    out.toolsSeq = g.game.player.position.x > 0;
    // farming: a ripe 3×3 melon block fuses into a giant; crows eat an unguarded 16-crop field
    await g.demo('farm-noon');
    {
      const f = g.game.services.farming;
      const fr = g.game.world.current.plots?.field;
      const g0 = f.giantCount();
      out.giantPlanted = fr ? f.plantBlock('melon', fr.x0 + 1, fr.z0 + 1, 3, 3, true) : 0;
      out.giants = f.forceGiants() - g0;
      let planted = 0;
      const cells = [];
      for (const [x0, z0] of [[23, 30], [24, 29], [22, 31]]) {
        planted = f.plantBlock('parsnip', x0, z0, 4, 4, false);
        if (planted >= 16) {
          for (let z = z0; z < z0 + 4; z++) for (let x = x0; x < x0 + 4; x++) cells.push([x, z]);
          break;
        }
      }
      g.grow(2);
      out.crowField = planted;
      out.crowsSent = f.raid(40, true);
      out.crowEaten = cells.filter(([x, z]) => f.cropAt(x, z)?.dead).length;
      g.step(3);
    }
    // farming: sleeping in the house bed still runs the farm's overnight update (growth + dried soil)
    {
      const f = g.game.services.farming;
      const cells = [];
      for (let z = 22; z < 40 && cells.length < 4; z++) {
        for (let x = 20; x < 44 && cells.length < 4; x++) {
          if (f.cropAt(x, z)) continue;
          f.till(x, z, true);
          if (f.plant('parsnip', x, z) && f.water(x, z)) cells.push([x, z]);
        }
      }
      const sown = cells.length;
      const before = cells.map(([x, z]) => f.cropAt(x, z)?.stage ?? -9);
      await g.teleport('house', 4.5, 4.5);
      const inHouse = g.game.world.current.id;
      const rain = () => ['rain', 'storm'].includes(g.game.calendar.weather);
      g.game.services.sleep.sleep();
      await new Promise((res) => setTimeout(res, 60));
      g.openUI('none');
      await g.teleport('farm', 31.5, 20);
      const grid = g.game.world.current.grid;
      const after = cells.map(([x, z]) => f.cropAt(x, z));
      const alive = after.map((c, i) => [c, i]).filter(([c]) => c && !c.dead);
      out.houseSleep = {
        sown,
        inHouse,
        before,
        after: after.map((c) => (c ? (c.dead ? 'dead' : c.stage) : null)),
        grew: alive.length > 0 && alive.every(([c, i]) => c.stage === before[i] + 1),
        dried: rain() || cells.every(([x, z]) => !grid.hasFlag(x, z, 8)), // 8 = TileFlag.Watered
      };
      g.step(2);
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
  check('farming: ripe 3×3 block forms a giant crop', r.giantPlanted === 9 && r.giants >= 1, `planted=${r.giantPlanted} giants=${r.giants}`);
  check('farming: sleeping in the house grows farm crops overnight', r.houseSleep.sown === 4 && r.houseSleep.inHouse === 'house' && r.houseSleep.grew && r.houseSleep.dried, JSON.stringify(r.houseSleep));
  check('farming: crows eat an unguarded field', r.crowField >= 16 && r.crowsSent > 0 && r.crowEaten > 0, `field=${r.crowField} sent=${r.crowsSent} eaten=${r.crowEaten}`);
  check('energy: tools spend stamina', r.energySpent > 0, `${r.energySpent}`);
  check('pillar services registered', r.services.length === 0, r.services.join(','));
  check('economy: refuses unaffordable spend', r.spendRefused);
  check('relationships: talk earns friendship', r.friendship);
  check('quests: Lantern Hall bundles', r.bundles >= 4, `${r.bundles}`);
  check('sleep: next morning, full energy', r.slept);
  check('farming: can waters', r.watered);
  check('farming: seeds plant', r.planted);
  check('farming: grow + harvest', r.harvested);
  check('farming: harvest XP', r.xp);
  check('farming: fertilizer', r.fertilized);
  check('energy: heavy work refused at 0', r.heavyRefused);
  check('energy: plain swings run negative', r.negative);
  check('farming: scrubbed tools sequence', r.toolsSeq);
  check('panels registered (shop, dialogue, fishing, crafting, map, title)', r.panels.length === 0, r.panels.join(','));
  check('farm overgrowth debris ≥ 350', r.debris >= 350, `${r.debris}`);
  check('town map loads with villagers', r.townMap === 'town' && r.npcs >= 3, `${r.townMap}, ${r.npcs} npcs`);
  check('villagers never overlap (≥ 0.6 m at 9/12/15/18 h)', r.npcGaps.every((x) => x.d >= 0.6), r.npcGaps.map((x) => `${x.h}h ${x.d.toFixed(2)} ${x.a}/${x.b}`).join(', '));
  check('town: live talk lens clear for all villagers at 10:30 (auditTalk)', r.talkCam.checked >= 8 && r.talkCam.fails.length === 0, `${r.talkCam.checked} checked; ${r.talkCam.fails.join(' · ')}`);
  check('town: live F-talk lens clear beside every villager at 9 / 13 / 17 h (auditLive)', r.liveTalk.checked >= 60 && r.liveTalk.fails.length === 0, `${r.liveTalk.checked} talks; ${r.liveTalk.fails.slice(0, 6).join(' · ')}`);
  check('town: heart-event staging audit clean (auditEvents)', r.evAudit.beats >= 40 && r.evAudit.fails.length === 0, `${r.evAudit.beats} beats; ${r.evAudit.fails.slice(0, 6).join(' · ')}`);
  check('town: portraits pass the painted gate — brows above the eyes, skin / backdrop value gap, face fill (auditPortraits)', r.portraitAudit.checked >= 90 && r.portraitAudit.fails.length === 0, `${r.portraitAudit.checked} busts; ${r.portraitAudit.fails.slice(0, 6).join(' · ')}`);
  check('town: portraits are painted busts of the villagers\' own looks (inked, same skin / hair)', r.portraits.length === 10 && r.portraits.every((p) => p.model && p.own), r.portraits.filter((p) => !p.model || !p.own).map((p) => p.id + (p.err ? ` ${p.err}` : '')).join(', '));
  check('render budget (town)', r.townPerf.ok, `${r.townPerf.drawCalls} calls, ${(r.townPerf.triangles / 1e6).toFixed(2)}M tris`);
  check('farm → town warp', r.warps.includes('town'));
  check('audio service', r.audio);
  check('demo(*)', r.demos.length > 5, r.demos.join(', '));
  check('animals: overnight report reaches sleep:summary', r.animalsNight);
  check('animals: end-of-day card shows the Animals row', r.animalsRow);
  check('pause', r.paused === true);
  check('save/load', r.saved && r.loaded);
  const p = r.perfEnd;
  check('render budget (farm-morning)', p.ok, `${p.drawCalls} calls, ${(p.triangles / 1e6).toFixed(2)}M tris`);
  // Kintara: simulated $KIN ledger, emission caps, sinks, soulbound deeds, save/load, tamper check, co-op intents.
  {
    const k = await page.evaluate(async () => {
      const g = window.__game;
      const gm = g.game;
      const sv = gm.services;
      const out = {};
      const kin = sv.kintara;
      out.exists = !!kin;
      await g.teleport('farm', 31.5, 20);
      // SaveManager.load() restores the saved map with a fire-and-forget teleport (core save 'map'): wait for it to land,
      // or it races the next teleport and drags the player back (this is what used to break the forest-forage check).
      const settle = async () => { for (let i = 0; i < 60 && !gm.world.current; i++) await new Promise((r) => setTimeout(r, 50)); await new Promise((r) => setTimeout(r, 400)); };
      const total = () => { const s = kin.supply(); return s.reserve + s.circulating + s.burned; };
      const t0 = total();
      // one-time milestones pay once; repeatable income respects the per-source and daily caps
      const b0 = kin.balance();
      const once1 = kin.debugEarn('hall', 10, 'smoke:once');
      const once2 = kin.debugEarn('hall', 10, 'smoke:once');
      out.once = once1 === 10 && once2 === 0;
      for (let i = 0; i < 20; i++) kin.debugEarn('ship', 50);
      const td = kin.today();
      out.capped = (td.bySource.ship ?? 0) <= 9 && (td.bySource.ship ?? 0) >= 1 && td.earned <= td.cap;
      out.supplyConserved = total() === t0;
      // away from town: the counter and the seal are closed
      out.awayRefused = kin.convert(1).ok === false && kin.mint('ruby', 0).ok === false;
      await g.teleport('town', 28.6, 35.2);
      gm.events.emit('day:start', { day: gm.calendar.day, season: gm.calendar.season, year: gm.calendar.year });
      kin.debugGrant(200);
      // Gold Counter: pays gold, burns kin, slips with volume, daily limit
      const gold0 = sv.economy.gold();
      const bal0 = kin.balance();
      const q1 = kin.quoteConvert(5);
      const c1 = kin.convert(5);
      out.convert = c1.ok && sv.economy.gold() === gold0 + c1.gold && kin.balance() === bal0 - 5 && c1.gold === q1.gold;
      out.slip = kin.quoteConvert(1).rate < q1.rate;
      const burnedBefore = kin.supply().burned;
      kin.convert(100);
      out.limit = kin.today().counterLeft === 0 && kin.convert(1).ok === false && kin.supply().burned > burnedBefore;
      // deeds: soulbound, fee burned, item consumed, editions get dearer, no unsealable items
      kin.debugGrant(300);
      const inv = sv.inventory;
      for (let i = 10; i < 30; i++) inv.setSlot(i, null);
      const give = (id, q) => gm.events.emit('item:give', { itemId: id, qty: 1, quality: q });
      give('cauliflower', 2); give('cauliflower', 2); give('wood', 0);
      const n0 = kin.deeds().length;
      const fee1 = kin.mintOptions().find((o) => o.itemId === 'cauliflower' && o.quality === 2)?.fee;
      const have0 = inv.slots.filter((s) => s && s.id === 'cauliflower').reduce((a, s) => a + s.qty, 0);
      const m1 = kin.mint('cauliflower', 2);
      const fee2 = kin.mintOptions().find((o) => o.itemId === 'cauliflower' && o.quality === 2)?.fee;
      const m2 = kin.mint('cauliflower', 2);
      const have1 = inv.slots.filter((s) => s && s.id === 'cauliflower').reduce((a, s) => a + s.qty, 0);
      out.mint = m1.ok && m2.ok && kin.deeds().length === n0 + 2 && have0 - have1 === 2 && m1.deed.soulbound === true && fee2 === fee1 * 2;
      out.noWood = kin.mint('wood', 0).ok === false;
      out.verify = kin.verify().ok;
      // save / load round trip keeps balance, deeds and a valid chain
      const bal = kin.balance();
      const nd = kin.deeds().length;
      g.save('smoke-kin');
      kin.debugGrant(77);
      await settle();
      g.load('smoke-kin');
      await settle();
      out.saved = kin.balance() === bal && kin.deeds().length === nd && kin.verify().ok;
      // tamper: an edited ledger entry fails verification
      const snap = kin.snapshot();
      snap.chain.txs[snap.chain.txs.length - 2].amount += 999;
      kin.applySnapshot(snap);
      out.tamper = kin.verify().ok === false;
      g.load('smoke-kin');
      await settle();
      // co-op: a farmhand forwards intents and never writes; the host re-validates them
      const intents = [];
      const grants = [];
      const off1 = gm.events.on('kintara:intent', (p) => intents.push(p.intent));
      const off2 = gm.events.on('kintara:grant', (p) => grants.push(p));
      kin.setAuthority(false);
      const balC = kin.balance();
      gm.events.emit('fishing:catch', { fishId: 'pondPerch', perfect: false, size: 20, quality: 0, treasure: false });
      out.clientNoWrite = kin.balance() === balC && intents.some((i) => i.k === 'earn' && i.src === 'fish');
      give('ruby', 0);
      out.clientMintPending = kin.mint('ruby', 0).pending === true && intents.some((i) => i.k === 'mint');
      kin.setAuthority(true);
      const balH = kin.balance();
      kin.applyIntent('2', { k: 'earn', src: 'fish', fishId: 'pondPerch', size: 20 });
      kin.applyIntent('2', { k: 'earn', src: 'mine', deepest: 99999 });
      out.hostEarn = kin.balance() > balH && kin.balance() - balH < 100;
      kin.applyIntent('2', { k: 'mint', itemId: 'wood', quality: 0, by: 'Pal' });
      out.hostRefund = grants.length > 0 && grants[grants.length - 1].peer === 2;
      off1(); off2();
      // UI: panel opens on every tab, the chip is on screen
      for (const t of ['kintara', 'kintara:mint', 'kintara:collection', 'kintara:market']) { g.openUI(t); g.step(2); }
      out.panel = !document.querySelector('.hv-kintara')?.classList.contains('hv-hidden');
      out.chip = !!document.querySelector('.kn-chip-hud');
      g.openUI('none');
      await g.demo('kintara');
      g.step(3);
      out.stall = !!gm.world.current.root.getObjectByName('kintara-stall');
      return out;
    });
    check('kintara: service + one-time milestones pay once', k.exists && k.once);
    check('kintara: repeatable income capped per source and per day; supply conserved', k.capped && k.supplyConserved);
    check('kintara: counter + seal closed away from the Exchange', k.awayRefused);
    check('kintara: Gold Counter pays gold, burns kin, slips and has a daily limit', k.convert && k.slip && k.limit);
    check('kintara: deeds are soulbound, burn a fee, consume the item, editions cost more', k.mint && k.noWood);
    check('kintara: save/load keeps wallet + deeds; verify() ok', k.saved && k.verify);
    check('kintara: an edited ledger fails verification', k.tamper);
    check('kintara: co-op farmhand forwards intents, host validates + refunds', k.clientNoWrite && k.clientMintPending && k.hostEarn && k.hostRefund, JSON.stringify(k));
    check('kintara: panel tabs, HUD chip and the Exchange stall in town', k.panel && k.chip && k.stall);
  }
  // Cindergrove forage: day rollovers must never leave ghost forage entries in the grid.
  {
    const f = await page.evaluate(async () => {
      const g = window.__game;
      await g.teleport('forest', 32.5, 6);
      const m = g.game.world.current;
      const counts = [];
      for (let i = 0; i < 30; i++) {
        g.setDay((i % 28) + 1);
        g.game.events.emit('day:start', { day: (i % 28) + 1, season: g.game.calendar.season, year: g.game.calendar.year });
        counts.push(m.forageTiles());
      }
      g.setSeason('winter');
      const winter = m.forageTiles();
      g.setSeason('spring');
      return { map: m.id, max: Math.max(...counts), last: counts[counts.length - 1], winter };
    });
    check('forest forage: no ghost tiles after 30 days (<= 11)', f.map === 'forest' && f.max <= 11 && f.winter <= 11, JSON.stringify(f));
  }
  // Fishing reel minigame (pure sim, Node): idle play never lands a fish, pacing bands, treasure delay.
  {
    const { runReelTests } = await import('./fishing-reel.test.mjs');
    const reelFails = runReelTests(() => {});
    check('fishing reel: no AFK catches, 5-8 s commons, treasure ≥ 1.5 s', reelFails.length === 0, reelFails.slice(0, 2).join(' | '));
  }
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
