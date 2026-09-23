/**
 * Festival mini-game overlay (DOM). One card-and-parchment layer over the living festival map:
 *
 *   dance     Ribbon Dance — blossoms drift along a ribbon track to a flower ring; tap the arrow on
 *             the beat (Bloom / Sweet / Oops), combo + a harmony meter with your partner's portrait
 *   lanterns  Lantern Release — pick a wish, then hold to lift each of three lanterns and let go
 *             inside the swell of glowing tide
 *   sackrace  Sack Race — countdown, then alternate ◀ ▶ in rhythm (too fast = wobble); live lane strip
 *   pumpkin   Produce Judging — enter your best crop, the judges flip the cards, ribbons drop
 *   giftswap  Gift Exchange — draw a name from the mitten, pick a present, see them react, then
 *             unwrap the gift someone wrapped for you
 *   skate     Starlight Skate — HUD for the river slalom the winter map simulates
 *
 * Every game ends on a shared result card (rosette, rewards, hearts). The 3D side is staged by the
 * map through `PlayState` + `map.playEvent(kind, value)`. `auto` (demo / attract mode) plays itself.
 */
import type { Game } from '../../core/game';
import { NPCS, type NpcId, type Mood } from '../../data/npcs';
import { itemDef } from '../../data/items';
import { WISHES, PRODUCE_RIVALS, STARFALL_GIFTS, PRIZES, type ActivityDef, type FestivalDef } from '../../data/festivals';
import { portraitSvg } from '../../ui/portraits';
import { itemIcon } from '../../ui/icons';
import type { FestivalMap, PlayState } from './base';

export interface GameEnv {
  game: Game;
  map: FestivalMap;
  play: PlayState;
  def: ActivityDef;
  festival: FestivalDef;
  /** Demo / attract mode: the game plays itself and loops. */
  auto: boolean;
}

export interface GameResult {
  /** 0 = best tier. */
  place: number;
  score: number;
  gold: number;
  item?: string;
  hearts?: { id: string; delta: number }[];
  title: string;
  sub: string;
}

const CSS = /* css */ `
.fg-root { position: absolute; inset: 0; z-index: 40; pointer-events: none; font-family: var(--font-body); color: var(--ink); }
.fg-root * { box-sizing: border-box; }
.fg-root .fg-live { pointer-events: auto; }
.fg-plaque { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); text-align: center; padding: 6px 34px 9px; border-radius: 16px;
  background: var(--u-wood, none) 0 0 / 512px 256px, var(--wood-grad); border: 2px solid var(--wood-3); box-shadow: var(--shadow), inset 0 2px 0 var(--wood-hi), inset 0 -3px 0 var(--wood-3);
  animation: fgDrop 420ms var(--ease-back) both; }
.fg-plaque .k { font-family: var(--font-head); font-weight: 600; font-size: 14px; letter-spacing: 2px; text-transform: uppercase; color: #ffe2b0; text-shadow: 0 1px 0 var(--wood-3); }
.fg-plaque .t { font-family: var(--font-head); font-weight: 700; font-size: 32px; line-height: 34px; color: #fff8e8; text-shadow: 0 3px 0 var(--wood-3), 0 6px 14px rgba(0,0,0,.35); }
.fg-plaque::before, .fg-plaque::after { content: ''; position: absolute; top: 50%; width: 18px; height: 18px; border-radius: 50%; transform: translateY(-50%);
  background: radial-gradient(circle at 35% 35%, #ffe9a8, #c89030 60%, #7a5018); box-shadow: 0 2px 0 rgba(0,0,0,.35); }
.fg-plaque::before { left: 9px; } .fg-plaque::after { right: 9px; }
.fg-howto { position: absolute; top: 104px; left: 50%; transform: translateX(-50%); max-width: 640px; text-align: center; font-weight: 800; font-size: 17px; color: #fff8e8;
  padding: 7px 18px; border-radius: 999px; background: rgba(40, 22, 10, .55); backdrop-filter: blur(4px); text-shadow: 0 1px 2px rgba(0,0,0,.5); animation: fgFade 5s ease both; }
@keyframes fgDrop { from { opacity: 0; transform: translate(-50%, -30px) scale(.9); } }
@keyframes fgFade { 0% { opacity: 0; } 8% { opacity: 1; } 85% { opacity: 1; } 100% { opacity: 0; } }
@keyframes fgPop { 0% { opacity: 0; transform: translate(-50%, 8px) scale(.6); } 25% { opacity: 1; transform: translate(-50%, -6px) scale(1.12); } 70% { opacity: 1; transform: translate(-50%, -14px) scale(1); } 100% { opacity: 0; transform: translate(-50%, -30px) scale(.95); } }
@keyframes fgIn { from { opacity: 0; transform: translateY(24px) scale(.94); } }
@keyframes fgBounce { 0% { transform: scale(.3) rotate(-30deg); opacity: 0; } 60% { transform: scale(1.18) rotate(6deg); opacity: 1; } 100% { transform: scale(1) rotate(0); } }
@keyframes fgShake { 0%,100% { transform: rotate(0); } 20% { transform: rotate(-7deg); } 40% { transform: rotate(6deg); } 60% { transform: rotate(-4deg); } 80% { transform: rotate(3deg); } }
@keyframes fgSpin { to { transform: rotate(360deg); } }
@keyframes fgPulse { 50% { transform: scale(1.08); } }
.fg-panel { position: absolute; border-radius: 20px; padding: 7px; background: var(--u-wood, none) 0 0 / 512px 256px, var(--wood-grad); border: 2px solid var(--wood-3);
  box-shadow: var(--shadow-lg), inset 0 2px 0 var(--wood-hi), inset 0 -3px 0 var(--wood-3); animation: fgIn 320ms var(--ease-back) both; }
.fg-panel > .in { position: relative; border-radius: 14px; background: var(--u-paper, none) 0 0 / 256px, radial-gradient(120% 90% at 50% 20%, var(--parch-1), var(--parch-2));
  box-shadow: inset 0 2px 5px rgba(120, 70, 20, .35), inset 0 0 0 2px rgba(150, 100, 50, .25); overflow: hidden; }
.fg-count { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); font-family: var(--font-head); font-weight: 700; font-size: 150px; color: #fff8e8;
  text-shadow: 0 6px 0 #6a3a1a, 0 14px 30px rgba(0,0,0,.45); animation: fgBounce 520ms var(--ease-back) both; }
.fg-judge { position: absolute; left: 50%; font-family: var(--font-head); font-weight: 700; font-size: 34px; white-space: nowrap; pointer-events: none; animation: fgPop 700ms ease-out both;
  text-shadow: 0 3px 0 rgba(60,30,10,.55), 0 0 16px rgba(255,255,255,.6); }
.fg-judge.p { color: #ffd84a; } .fg-judge.g { color: #9ce07a; } .fg-judge.m { color: #ff8a7a; }
/* ── dance ── */
.fg-dance { left: 50%; bottom: 34px; transform: translateX(-50%); width: min(900px, calc(100vw - 32px)); }
.fg-dance > .in { height: 150px; padding: 0; }
.fg-dance .lane { position: absolute; left: 18px; right: 150px; top: 26px; height: 98px; border-radius: 50px;
  background: linear-gradient(180deg, rgba(255,255,255,.55), rgba(255,240,220,.2)), repeating-linear-gradient(115deg, rgba(247,168,192,.28) 0 18px, rgba(253,226,160,.22) 18px 36px, rgba(184,224,240,.25) 36px 54px);
  box-shadow: inset 0 3px 8px rgba(120, 60, 30, .3), inset 0 0 0 2px rgba(150, 90, 50, .25); }
.fg-dance .ribbon { position: absolute; left: 60px; right: 10px; top: 47px; height: 4px; border-radius: 2px; background: linear-gradient(90deg, #f7a8c0, #fde2a0, #b8e0f0, #d4b8f0); opacity: .8; }
.fg-dance .ring { position: absolute; left: 20px; top: 8px; width: 82px; height: 82px; border-radius: 50%; border: 5px solid #fff4e0;
  box-shadow: 0 0 0 3px #d86a8a, 0 0 22px rgba(255, 180, 210, .9), inset 0 0 14px rgba(255,190,210,.8); }
.fg-dance .ring.hit { animation: fgPulse 180ms ease-out; box-shadow: 0 0 0 4px #ffd84a, 0 0 40px rgba(255, 220, 120, 1), inset 0 0 20px rgba(255,230,160,.9); }
.fg-dance .note { position: absolute; top: 9px; width: 80px; height: 80px; margin-left: -40px; will-change: transform; }
.fg-dance .note svg { width: 100%; height: 100%; display: block; filter: drop-shadow(0 3px 2px rgba(80, 30, 20, .35)); }
.fg-dance .note.gone { transition: opacity 160ms, transform 160ms; opacity: 0; }
.fg-dance .note.hitp svg { animation: fgSpin 400ms ease-out; }
.fg-dance .side { position: absolute; right: 14px; top: 12px; width: 124px; text-align: center; }
.fg-dance .combo { font-family: var(--font-head); font-weight: 700; font-size: 44px; line-height: 44px; color: #c8573e; text-shadow: 0 2px 0 #fff; }
.fg-dance .combo small { display: block; font-size: 13px; line-height: 14px; letter-spacing: 2px; color: var(--ink-soft); }
.fg-dance .score { font-family: var(--font-head); font-weight: 700; font-size: 20px; margin-top: 6px; color: var(--ink); }
.fg-partner { position: absolute; left: 50%; bottom: 196px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 6px 18px 6px 6px; }
.fg-partner .pp { width: 64px; height: 64px; border-radius: 14px; overflow: hidden; box-shadow: 0 0 0 3px var(--wood-2), 0 0 0 5px var(--wood-hi), 0 4px 10px rgba(0,0,0,.3); }
.fg-partner .pp svg { width: 100%; height: 100%; display: block; }
.fg-partner .nm { font-family: var(--font-head); font-weight: 700; font-size: 18px; color: #fff8e8; text-shadow: 0 2px 0 rgba(60,30,10,.7); }
.fg-meter { width: 240px; height: 16px; border-radius: 10px; background: rgba(40, 20, 10, .5); box-shadow: inset 0 2px 3px rgba(0,0,0,.4), 0 0 0 2px rgba(255, 240, 220, .6); overflow: hidden; margin-top: 3px; }
.fg-meter i { display: block; height: 100%; width: 50%; border-radius: 10px; background: linear-gradient(90deg, #f06a8a, #ffb0c8 60%, #ffe0ea); box-shadow: 0 0 12px rgba(255, 150, 190, .9); transition: width 200ms var(--ease-out); }
.fg-keys { position: absolute; left: 50%; bottom: 190px; transform: translateX(-50%); display: none; gap: 10px; }
.fg-key { width: 64px; height: 64px; border-radius: 16px; display: grid; place-items: center; font-family: var(--font-head); font-size: 30px; font-weight: 700; color: #fff; cursor: pointer;
  background: linear-gradient(180deg, var(--wood-1), var(--wood-2)); border: 2px solid var(--wood-3); box-shadow: 0 5px 0 var(--wood-3), inset 0 2px 0 var(--wood-hi); user-select: none; transition: transform 90ms; }
.fg-key.on { transform: translateY(3px); box-shadow: 0 2px 0 var(--wood-3), inset 0 2px 0 var(--wood-hi), 0 0 20px rgba(255, 220, 120, .9); background: linear-gradient(180deg, #f2b54a, #c8782a); }
.fg-key.next { animation: fgPulse 420ms ease-in-out infinite; background: linear-gradient(180deg, #f08a6a, #c8483a); }
@media (pointer: coarse) { .fg-keys { display: flex; } }
/* ── lanterns ── */
.fg-lant { right: 64px; top: 50%; transform: translateY(-50%); width: 150px; }
.fg-lant > .in { height: 420px; background: linear-gradient(180deg, #16244a, #0e1a3a 55%, #0a1430); }
.fg-lant .band { position: absolute; left: 10px; right: 10px; height: 64px; border-radius: 14px; background: radial-gradient(60% 60% at 50% 50%, rgba(120, 255, 240, .75), rgba(60, 200, 230, .25) 70%, transparent);
  box-shadow: 0 0 26px rgba(90, 230, 240, .6); border: 2px solid rgba(180, 255, 250, .7); }
.fg-lant .band::after { content: ''; position: absolute; left: 12px; right: 12px; top: 50%; height: 2px; background: rgba(230, 255, 255, .9); border-radius: 2px; }
.fg-lant .lamp { position: absolute; left: 50%; width: 58px; height: 70px; margin-left: -29px; will-change: transform; }
.fg-lant .lamp svg { width: 100%; height: 100%; filter: drop-shadow(0 0 14px rgba(255, 180, 90, .95)); }
.fg-lant .stars { position: absolute; inset: 0; background-image: radial-gradient(1.5px 1.5px at 20% 30%, #fff, transparent), radial-gradient(1px 1px at 70% 20%, #fff, transparent), radial-gradient(1.5px 1.5px at 40% 70%, #cfe, transparent), radial-gradient(1px 1px at 85% 60%, #fff, transparent); opacity: .6; }
.fg-lant .water { position: absolute; left: 0; right: 0; bottom: 0; height: 46px; background: linear-gradient(180deg, rgba(80, 220, 240, .5), rgba(20, 60, 120, .9)); box-shadow: 0 -4px 16px rgba(90, 230, 240, .5); }
.fg-slots { position: absolute; right: 50px; top: calc(50% + 236px); display: flex; gap: 8px; width: 178px; justify-content: center; }
.fg-slots i { width: 34px; height: 42px; border-radius: 10px 10px 14px 14px; background: rgba(40, 22, 10, .45); box-shadow: inset 0 0 0 2px rgba(255, 230, 200, .35); }
.fg-slots i.on { background: radial-gradient(circle at 50% 40%, #fff2c0, #ffb050 55%, #d8703a); box-shadow: 0 0 16px rgba(255, 170, 80, .95), inset 0 0 0 2px #fff3d0; animation: fgBounce 420ms var(--ease-back) both; }
.fg-slots i.dim { background: radial-gradient(circle at 50% 40%, #e8d8c0, #b89878); box-shadow: inset 0 0 0 2px rgba(255,255,255,.4); }
.fg-hint { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%); padding: 8px 20px; border-radius: 999px; background: rgba(30, 16, 8, .6); color: #fff5e0; font-weight: 800; font-size: 17px; white-space: nowrap; }
.fg-hint b { font-family: var(--font-head); color: #ffd27a; padding: 0 3px; }
/* ── cards / choices ── */
.fg-choose { left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(820px, calc(100vw - 32px)); }
.fg-choose > .in { padding: 20px 24px 22px; }
.fg-choose h3 { margin: 0 0 4px; font-family: var(--font-head); font-size: 28px; color: #5a3218; text-align: center; }
.fg-choose p.sub { margin: 0 0 14px; text-align: center; font-weight: 800; color: var(--ink-soft); }
.fg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.fg-card { position: relative; border-radius: 14px; padding: 12px 10px 10px; text-align: center; cursor: pointer; background: rgba(255, 250, 235, .7); border: 2px solid rgba(120, 70, 30, .3);
  transition: transform 140ms var(--ease-back), border-color 140ms, background 140ms; animation: fgIn 300ms var(--ease-back) both; }
.fg-card .u-ic, .fg-card .ic { width: 56px; height: 56px; display: block; margin: 0 auto 6px; image-rendering: auto; }
.fg-card .nm { font-family: var(--font-head); font-weight: 600; font-size: 17px; color: #4a2c14; line-height: 20px; }
.fg-card .meta { font-size: 13px; font-weight: 800; color: var(--ink-soft); margin-top: 2px; }
.fg-card.sel { transform: translateY(-5px) scale(1.04); background: #fff6dc; border-color: #c8573e; box-shadow: 0 6px 0 rgba(120,60,20,.25), 0 0 0 4px rgba(255, 200, 120, .45); }
.fg-card .star { color: #e8a820; letter-spacing: -1px; }
.fg-wish { font-family: var(--font-hand); font-size: 30px !important; line-height: 30px !important; font-weight: 700 !important; }
/* ── race ── */
.fg-race { left: 50%; bottom: 30px; transform: translateX(-50%); width: min(900px, calc(100vw - 32px)); }
.fg-race > .in { height: 150px; }
.fg-track { position: absolute; left: 150px; right: 70px; top: 14px; bottom: 14px; border-radius: 12px; background: repeating-linear-gradient(90deg, rgba(160, 110, 50, .14) 0 22px, rgba(160, 110, 50, .06) 22px 44px), linear-gradient(180deg, #e8d49a, #d8bc78);
  box-shadow: inset 0 2px 6px rgba(100, 60, 20, .35); }
.fg-track .lanes { position: absolute; inset: 6px 0; display: grid; grid-template-rows: repeat(5, 1fr); }
.fg-track .lanes > div { position: relative; border-bottom: 1px dashed rgba(120, 80, 30, .3); }
.fg-token { position: absolute; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; border: 2px solid rgba(60, 30, 10, .6); box-shadow: 0 2px 0 rgba(0,0,0,.25); }
.fg-token.me { width: 38px; height: 26px; margin: -13px 0 0 -19px; border-radius: 13px; background: linear-gradient(180deg, #fff4d0, #e6c275 60%, #b08a40); border: 3px solid #3d6f8f; z-index: 2; display: grid; place-items: center; }
.fg-token.me b { font-family: var(--font-head); font-size: 11px; color: #2a4a6a; letter-spacing: .5px; }
.fg-flag { position: absolute; right: -4px; top: -6px; bottom: -6px; width: 14px; border-radius: 3px; background: repeating-conic-gradient(#2a1a10 0 25%, #fff 0 50%) 0 0 / 14px 14px; box-shadow: 0 0 0 2px rgba(60,30,10,.5); }
.fg-race .keys2 { position: absolute; left: 14px; top: 22px; display: flex; gap: 8px; }
.fg-race .keys2 .fg-key { width: 58px; height: 58px; }
.fg-race .bounce { position: absolute; left: 14px; bottom: 16px; width: 124px; }
.fg-race .bounce small { display: block; font-size: 12px; font-weight: 800; letter-spacing: 1.5px; color: var(--ink-soft); text-transform: uppercase; }
.fg-race .bounce .fg-meter { width: 124px; }
.fg-race .bounce .fg-meter i { background: linear-gradient(90deg, #6aa83c, #b8e07a); box-shadow: 0 0 10px rgba(160, 230, 110, .8); }
.fg-race .place { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-family: var(--font-head); font-weight: 700; font-size: 30px; color: #c8573e; width: 50px; text-align: center; }
/* ── judging ── */
.fg-show { left: 50%; top: 47%; transform: translate(-50%, -50%); width: min(980px, calc(100vw - 32px)); }
.fg-show > .in { padding: 18px 20px 20px; }
.fg-show h3 { margin: 0 0 12px; text-align: center; font-family: var(--font-head); font-size: 28px; color: #5a3218; }
.fg-entries { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.fg-entry { position: relative; perspective: 800px; height: 230px; }
.fg-entry .face { position: absolute; inset: 0; border-radius: 16px; padding: 14px 10px; text-align: center; backface-visibility: hidden; transition: transform 600ms var(--ease-back);
  background: linear-gradient(180deg, #fffaf0, #f6e6c4); border: 2px solid rgba(120, 70, 30, .35); box-shadow: 0 4px 0 rgba(120, 70, 30, .2); }
.fg-entry .back { transform: rotateY(180deg); background: repeating-linear-gradient(45deg, #c8573e 0 12px, #b8482e 12px 24px); border-color: #7a2e1e; display: grid; place-items: center; }
.fg-entry .back span { font-family: var(--font-head); font-size: 54px; color: #ffe2b0; text-shadow: 0 3px 0 #7a2e1e; }
.fg-entry:not(.open) .front { transform: rotateY(-180deg); }
.fg-entry:not(.open) .back { transform: rotateY(0); }
.fg-entry .blob { width: 92px; height: 78px; margin: 4px auto 8px; border-radius: 50% 50% 46% 46% / 58% 58% 42% 42%; box-shadow: inset -10px -10px 0 rgba(0,0,0,.12), inset 8px 8px 0 rgba(255,255,255,.25), 0 6px 0 rgba(80,40,10,.2); position: relative; }
.fg-entry .blob::after { content: ''; position: absolute; left: 50%; top: -12px; width: 10px; height: 18px; margin-left: -5px; border-radius: 4px; background: #5a7a2a; transform: rotate(10deg); }
.fg-entry .front .u-ic { width: 84px; height: 84px; display: block; margin: 0 auto 6px; }
.fg-entry .nm { font-family: var(--font-head); font-weight: 600; font-size: 17px; color: #4a2c14; line-height: 20px; }
.fg-entry .by { font-size: 13px; font-weight: 800; color: var(--ink-soft); }
.fg-entry .pts { font-family: var(--font-head); font-weight: 700; font-size: 34px; color: #c8573e; margin-top: 4px; }
.fg-entry.me .front { border-color: #3d6f8f; box-shadow: 0 4px 0 rgba(61, 111, 143, .35), 0 0 0 3px rgba(120, 180, 230, .4); }
.fg-entry .rib { position: absolute; top: -18px; right: -12px; width: 70px; height: 96px; animation: fgBounce 560ms var(--ease-back) both; z-index: 3; }
.fg-entry .rib svg { width: 100%; height: 100%; filter: drop-shadow(0 4px 3px rgba(0,0,0,.35)); }
/* ── gifts ── */
.fg-draw { left: 50%; top: 45%; transform: translate(-50%, -50%); width: 360px; }
.fg-draw > .in { padding: 18px 18px 20px; text-align: center; }
.fg-draw .pp { width: 200px; height: 200px; margin: 6px auto 10px; border-radius: 22px; overflow: hidden; box-shadow: 0 0 0 4px var(--wood-2), 0 0 0 7px var(--wood-hi), 0 8px 20px rgba(0,0,0,.3); }
.fg-draw .pp svg { width: 100%; height: 100%; display: block; }
.fg-draw .nm { font-family: var(--font-head); font-weight: 700; font-size: 28px; color: #4a2c14; }
.fg-draw .rl { font-weight: 800; color: var(--ink-soft); font-size: 14px; }
.fg-draw .line { margin-top: 10px; font-size: 18px; font-weight: 700; color: #4a2c14; line-height: 24px; }
.fg-draw.spin .pp { animation: fgShake 160ms linear infinite; }
.fg-box { width: 180px; height: 180px; margin: 6px auto 8px; position: relative; cursor: pointer; }
.fg-box svg { width: 100%; height: 100%; overflow: visible; }
.fg-box.shake { animation: fgShake 520ms ease-in-out infinite; }
.fg-box .rays { position: absolute; inset: -60px; border-radius: 50%; background: repeating-conic-gradient(rgba(255, 220, 120, .55) 0 10deg, transparent 10deg 20deg); animation: fgSpin 8s linear infinite; mask: radial-gradient(circle, #000 30%, transparent 70%); -webkit-mask: radial-gradient(circle, #000 30%, transparent 70%); }
.fg-box .gift { position: absolute; left: 50%; top: 50%; width: 110px; height: 110px; margin: -55px 0 0 -55px; animation: fgBounce 600ms var(--ease-back) both; }
.fg-box .gift .u-ic { width: 100%; height: 100%; }
/* ── skate ── */
.fg-skate { right: 26px; top: 170px; width: 220px; }
.fg-skate > .in { padding: 12px 16px 14px; text-align: center; background: linear-gradient(180deg, #f4f8ff, #dce8f6); }
.fg-skate .big { font-family: var(--font-head); font-weight: 700; font-size: 44px; color: #2f6a9a; line-height: 46px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.fg-skate .big svg { width: 38px; height: 38px; filter: drop-shadow(0 0 8px rgba(255, 210, 90, .9)); }
.fg-skate small { font-weight: 800; color: #5a7a9a; letter-spacing: 1.5px; text-transform: uppercase; font-size: 12px; }
.fg-skate .fg-meter { width: 100%; margin-top: 8px; }
.fg-skate .fg-meter i { background: linear-gradient(90deg, #7ad0ff, #d8f2ff); box-shadow: 0 0 10px rgba(140, 210, 255, .9); }
/* ── result ── */
.fg-result { left: 50%; top: 48%; transform: translate(-50%, -50%); width: min(560px, calc(100vw - 32px)); }
.fg-result > .in { padding: 22px 26px 22px; text-align: center; overflow: visible; }
.fg-result .ros { width: 118px; height: 150px; margin: -80px auto 0; animation: fgBounce 700ms var(--ease-back) both; }
.fg-result .ros svg { width: 100%; height: 100%; filter: drop-shadow(0 6px 4px rgba(0,0,0,.35)); }
.fg-result h2 { margin: 6px 0 2px; font-family: var(--font-head); font-size: 38px; color: #5a3218; }
.fg-result .sub { font-weight: 800; font-size: 18px; color: var(--ink-soft); margin-bottom: 14px; }
.fg-chips { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; }
.fg-chip { display: flex; align-items: center; gap: 8px; padding: 6px 14px 6px 6px; border-radius: 999px; background: rgba(255, 250, 235, .8); border: 2px solid rgba(120, 70, 30, .25); font-weight: 800; font-size: 18px; animation: fgIn 360ms var(--ease-back) both; }
.fg-chip .ci { width: 34px; height: 34px; border-radius: 50%; overflow: hidden; display: grid; place-items: center; }
.fg-chip .ci svg, .fg-chip .ci img { width: 100%; height: 100%; display: block; }
.fg-chip.gold { color: #8a5a10; } .fg-chip.heart { color: #b83a3a; }
.fg-go { margin-top: 16px; display: inline-flex; align-items: center; gap: 10px; padding: 8px 24px; border-radius: 14px; cursor: pointer; font-family: var(--font-head); font-weight: 700; font-size: 20px; color: #fff;
  background: linear-gradient(180deg, #8fd05a, #4f9a34); border: 2px solid #24521a; box-shadow: 0 4px 0 #24521a, inset 0 2px 0 #c8f0a0; text-shadow: 0 2px 0 #24521a; }
.fg-go kbd { font-family: var(--font-head); font-size: 13px; padding: 1px 7px; border-radius: 6px; background: rgba(0,0,0,.2); }
.fg-confetti { position: absolute; width: 10px; height: 14px; border-radius: 2px; pointer-events: none; animation: fgConf 1600ms cubic-bezier(.2,.7,.4,1) forwards; }
@keyframes fgConf { from { transform: translate(0, 0) rotate(0); opacity: 1; } to { transform: translate(var(--dx), var(--dy)) rotate(var(--r)); opacity: 0; } }
`;

let cssInstalled = false;
function installCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const s = document.createElement('style');
  s.id = 'fg-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function div(cls: string, html = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (html) d.innerHTML = html;
  return d;
}

const THREE_LERP = (a: number, b: number, k: number): number => a + (b - a) * k;
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** Prize rosette (1st gold, 2nd blue, 3rd red, else green "well done"). */
export function rosetteSvg(place: number): string {
  const c = [['#f6c63a', '#c8901a', '#fff2b0'], ['#4a8ad8', '#2a5aa0', '#cfe4ff'], ['#d84a3a', '#a02a1e', '#ffd0c4'], ['#6aa83c', '#3f7a2a', '#dff2c8']][Math.min(place, 3)]!;
  const label = ['1st', '2nd', '3rd', '★'][Math.min(place, 3)]!;
  let petals = '';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * 360;
    petals += `<ellipse cx="50" cy="22" rx="9" ry="16" fill="${i % 2 ? c[0] : c[1]}" transform="rotate(${a} 50 48)"/>`;
  }
  return `<svg viewBox="0 0 100 130"><path d="M34 70 L22 126 L36 116 L44 128 L50 74 Z" fill="${c[1]}"/><path d="M66 70 L78 126 L64 116 L56 128 L50 74 Z" fill="${c[0]}"/>
${petals}<circle cx="50" cy="48" r="21" fill="${c[2]}" stroke="${c[1]}" stroke-width="3"/><circle cx="50" cy="48" r="15" fill="none" stroke="${c[1]}" stroke-width="1.5" stroke-dasharray="3 3"/>
<text x="50" y="55" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="700" font-size="${label.length > 1 ? 17 : 22}" fill="${c[1]}">${label}</text></svg>`;
}

const ARROWS = ['←', '↑', '→', '↓'] as const;
const NOTE_COLORS = ['#f06a8a', '#f2b928', '#5ab0e8', '#b07ae8'];

function blossomSvg(dir: number): string {
  const c = NOTE_COLORS[dir]!;
  let p = '';
  for (let i = 0; i < 5; i++) p += `<ellipse cx="40" cy="18" rx="13" ry="17" fill="${c}" stroke="#fff" stroke-width="2.5" transform="rotate(${i * 72} 40 40)"/>`;
  const rot = [270, 0, 90, 180][dir]!;
  return `<svg viewBox="0 0 80 80">${p}<circle cx="40" cy="40" r="17" fill="#fff8e8" stroke="${c}" stroke-width="3"/><path d="M40 29 L50 42 L44 42 L44 51 L36 51 L36 42 L30 42 Z" fill="${c}" transform="rotate(${rot} 40 40)"/></svg>`;
}

const LANTERN_SVG = `<svg viewBox="0 0 60 72"><path d="M22 6 h16 v5 h-16z" fill="#6a3a1a"/><path d="M12 14 Q30 4 48 14 L52 50 Q30 62 8 50 Z" fill="#ffb050"/><path d="M12 14 Q30 4 48 14 L52 50 Q30 62 8 50 Z" fill="url(#lg)"/>
<defs><radialGradient id="lg" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#fff6d0"/><stop offset=".6" stop-color="#ffb050" stop-opacity=".4"/><stop offset="1" stop-color="#d8603a" stop-opacity=".2"/></radialGradient></defs>
<path d="M18 13 Q16 32 18 52 M30 9 V58 M42 13 Q44 32 42 52" stroke="#c8602a" stroke-width="1.5" fill="none" opacity=".6"/><path d="M14 52 Q30 60 46 52 L44 58 Q30 64 16 58 Z" fill="#8a4a2a"/><path d="M30 60 v10" stroke="#f2d27a" stroke-width="2"/></svg>`;

const STAR_SVG = `<svg viewBox="0 0 40 40"><path d="M20 3 L25 15 L38 15.5 L28 24 L31.5 37 L20 29.5 L8.5 37 L12 24 L2 15.5 L15 15 Z" fill="#ffd84a" stroke="#fff4c0" stroke-width="2" stroke-linejoin="round"/></svg>`;

function giftBoxSvg(c1: string, c2: string, open = false): string {
  const lid = open ? 'transform="translate(40 -70) rotate(28 90 60)"' : '';
  return `<svg viewBox="0 0 180 180"><rect x="30" y="72" width="120" height="96" rx="10" fill="${c1}"/><rect x="30" y="72" width="120" height="96" rx="10" fill="url(#gb)" opacity=".35"/>
<rect x="82" y="72" width="16" height="96" fill="${c2}"/><g ${lid}><rect x="22" y="50" width="136" height="30" rx="8" fill="${c1}"/><rect x="82" y="50" width="16" height="30" fill="${c2}"/>
<path d="M90 50 C 60 14 42 34 64 48 Z M90 50 C 120 14 138 34 116 48 Z" fill="${c2}" stroke="rgba(0,0,0,.2)" stroke-width="2"/></g>
<defs><linearGradient id="gb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs></svg>`;
}

type Keys = { down: Set<string>; pressed: string[] };

/** The mini-game overlay controller (one per festival system). */
export class FestivalOverlay {
  private root: HTMLDivElement | null = null;
  private keys: Keys = { down: new Set(), pressed: [] };
  private aborted = false;
  private raf = 0;
  private onDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.keys.down.add(e.code);
    this.keys.pressed.push(e.code);
  };
  private onUp = (e: KeyboardEvent): void => {
    this.keys.down.delete(e.code);
  };

  constructor(private game: Game) {}

  get running(): boolean {
    return !!this.root;
  }

  abort(): void {
    this.aborted = true;
  }

  private sfx(name: string, gain = 1): void {
    // (AudioApi.play is the audio pod's; tolerate builds where it isn't there yet.)
    const audio = this.game.services.audio as { play?: (n: string, o?: { gain?: number }) => void } | undefined;
    audio?.play?.(name, { gain });
  }

  /** Run one activity end to end (incl. the result card). null = aborted. */
  async run(env: GameEnv): Promise<GameResult | null> {
    installCss();
    this.aborted = false;
    this.keys = { down: new Set(), pressed: [] };
    const host = this.game.hud.root.parentElement ?? document.body;
    const root = div('fg-root');
    this.root = root;
    host.appendChild(root);
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    // Hide the toolbar / clock / energy while the mini-game owns the screen.
    this.game.hud.root.classList.add('hv-cinema');
    try {
      const plaque = div('fg-plaque', `<div class="k">${env.festival.name}</div><div class="t">${env.def.name}</div>`);
      root.append(plaque);
      if (!env.auto) root.append(div('fg-howto', env.def.howto));
      let res: GameResult | null;
      // Attract mode loops the game itself; `&result=1` (demos) shows the result card instead.
      const showResult = !env.auto || new URLSearchParams(location.search).has('result');
      do {
        res = await this.play(env);
        if (!res || this.aborted) return null;
        if (showResult) await this.result(env, res, env.auto);
        if (env.auto) {
          if (showResult) return res;
          this.clearBody(root, plaque);
          env.play.progress = [];
          env.play.score = 0;
          env.play.done = false;
          env.map.playEvent('restart');
        }
      } while (env.auto && !this.aborted);
      return res;
    } finally {
      window.removeEventListener('keydown', this.onDown);
      window.removeEventListener('keyup', this.onUp);
      cancelAnimationFrame(this.raf);
      this.game.hud.root.classList.remove('hv-cinema');
      root.remove();
      this.root = null;
    }
  }

  private clearBody(root: HTMLElement, keep: HTMLElement): void {
    for (const c of [...root.children]) if (c !== keep) c.remove();
  }

  private play(env: GameEnv): Promise<GameResult | null> {
    switch (env.def.id) {
      case 'dance':
        return this.dance(env);
      case 'lanterns':
        return this.lanterns(env);
      case 'sackrace':
        return this.sackRace(env);
      case 'pumpkin':
        return this.judging(env);
      case 'giftswap':
        return this.giftSwap(env);
      case 'skate':
        return this.skate(env);
    }
  }

  // ───────────────────────────────────────────── plumbing

  /** Frame loop until `step` returns true (or abort). `step(dt, t)` in seconds. */
  private loop(step: (dt: number, t: number) => boolean | void): Promise<boolean> {
    return new Promise((resolve) => {
      let last = performance.now();
      const t0 = last;
      const frame = (now: number): void => {
        if (this.aborted) return resolve(false);
        // rAF timestamps are frame-start times and can precede performance.now() at scheduling.
        const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
        last = Math.max(last, now);
        let done: boolean | void = false;
        try {
          done = step(dt, Math.max(0, now - t0) / 1000);
        } catch (e) {
          console.error('[festival] mini-game error', e);
          done = true;
        }
        this.keys.pressed.length = 0;
        if (done) resolve(true);
        else this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    });
  }

  private wait(ms: number): Promise<boolean> {
    return this.loop((_dt, t) => t * 1000 >= ms);
  }

  private hit(...codes: string[]): boolean {
    return this.keys.pressed.some((k) => codes.includes(k));
  }

  private async countdown(root: HTMLElement): Promise<boolean> {
    for (const n of ['3', '2', '1']) {
      const c = div('fg-count', n);
      root.append(c);
      this.sfx('ui:tick', 1.4);
      if (!(await this.wait(620))) return false;
      c.remove();
    }
    const go = div('fg-count', 'Go!');
    root.append(go);
    this.sfx('ui:select', 1.5);
    setTimeout(() => go.remove(), 700);
    return true;
  }

  private judge(parent: HTMLElement, text: string, cls: 'p' | 'g' | 'm', x: string, y: string): void {
    const j = div(`fg-judge ${cls}`, text);
    j.style.left = x;
    j.style.top = y;
    parent.append(j);
    setTimeout(() => j.remove(), 720);
  }

  private confetti(parent: HTMLElement, colors: number[], n = 46): void {
    const r = parent.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const c = div('fg-confetti');
      c.style.left = `${r.width / 2 + (Math.random() - 0.5) * 60}px`;
      c.style.top = `${r.height * 0.2}px`;
      c.style.background = hex(colors[i % colors.length]!);
      c.style.setProperty('--dx', `${(Math.random() - 0.5) * 900}px`);
      c.style.setProperty('--dy', `${120 + Math.random() * 420}px`);
      c.style.setProperty('--r', `${(Math.random() - 0.5) * 1200}deg`);
      c.style.animationDelay = `${Math.random() * 180}ms`;
      parent.append(c);
      setTimeout(() => c.remove(), 2000);
    }
  }

  /** Pick one card from a grid (arrows / 1-9 / click, Enter / Space confirms). Auto picks `autoPick`. */
  private async pick(env: GameEnv, title: string, sub: string, cards: string[], autoPick = 0): Promise<number | null> {
    const root = this.root!;
    const panel = div('fg-panel fg-choose fg-live', `<div class="in"><h3>${title}</h3><p class="sub">${sub}</p><div class="fg-grid"></div></div>`);
    const grid = panel.querySelector('.fg-grid') as HTMLElement;
    const els = cards.map((html, i) => {
      const c = div('fg-card', html);
      c.style.animationDelay = `${i * 40}ms`;
      c.addEventListener('mouseenter', () => (sel = i));
      c.addEventListener('click', () => (chosen = i));
      grid.append(c);
      return c;
    });
    root.append(panel);
    let sel = 0;
    let chosen = -1;
    const cols = Math.max(1, Math.round(grid.clientWidth / 162));
    const ok = await this.loop((_dt, t) => {
      if (env.auto) {
        sel = Math.min(cards.length - 1, Math.floor(t / 0.5) % (autoPick + 1));
        if (t > 0.5 * (autoPick + 1) + 0.6) chosen = autoPick;
      }
      if (this.hit('ArrowRight', 'KeyD')) sel = Math.min(cards.length - 1, sel + 1);
      if (this.hit('ArrowLeft', 'KeyA')) sel = Math.max(0, sel - 1);
      if (this.hit('ArrowDown', 'KeyS')) sel = Math.min(cards.length - 1, sel + cols);
      if (this.hit('ArrowUp', 'KeyW')) sel = Math.max(0, sel - cols);
      for (let k = 1; k <= Math.min(9, cards.length); k++) if (this.hit(`Digit${k}`)) chosen = k - 1;
      if (this.hit('Enter', 'Space', 'KeyX', 'KeyF')) chosen = sel;
      els.forEach((e, i) => e.classList.toggle('sel', i === sel));
      return chosen >= 0;
    });
    this.sfx('ui:select');
    panel.remove();
    return ok ? chosen : null;
  }

  private async result(env: GameEnv, r: GameResult, hold = false): Promise<void> {
    const root = this.root!;
    const chips: string[] = [];
    if (r.gold > 0) chips.push(`<div class="fg-chip gold"><span class="ci">${COIN}</span>+${r.gold}g</div>`);
    if (r.item) chips.push(`<div class="fg-chip"><span class="ci">${itemIcon(r.item)}</span>${itemDef(r.item)?.name ?? r.item}</div>`);
    for (const h of r.hearts ?? []) {
      const n = NPCS[h.id as NpcId];
      if (n && h.delta > 0) chips.push(`<div class="fg-chip heart"><span class="ci">${portraitSvg(n.look, n.portraitBg, 'happy')}</span>${n.name.split(' ')[0]} · ${friendWord(h.delta)}</div>`);
    }
    const card = div(
      'fg-panel fg-result fg-live',
      `<div class="in"><div class="ros">${rosetteSvg(r.place)}</div><h2>${r.title}</h2><div class="sub">${r.sub}</div><div class="fg-chips">${chips.join('')}</div><div class="fg-go">Continue <kbd>Space</kbd></div></div>`,
    );
    root.append(card);
    this.confetti(root, env.festival.colors, r.place === 0 ? 70 : 36);
    this.sfx(r.place === 0 ? 'catch:perfect' : 'catch', 1);
    let go = false;
    card.querySelector('.fg-go')!.addEventListener('click', () => (go = true));
    await this.loop((_dt, t) => (hold ? false : env.auto ? t > 4.2 : go || (t > 0.5 && this.hit('Space', 'Enter', 'KeyX', 'KeyF', 'Escape'))));
    card.remove();
  }

  // ───────────────────────────────────────────── dance

  private async dance(env: GameEnv): Promise<GameResult | null> {
    const root = this.root!;
    const partner = (env.play.partner ?? 'wren') as NpcId;
    const pn = NPCS[partner];
    const bpm = env.festival.music.tempo;
    const beat = 60 / bpm;
    // Chart: 4 bars of warm-up quarter notes, then syncopation, then a flourish.
    const notes: { t: number; dir: number; el: HTMLDivElement; state: 0 | 1 | 2 }[] = [];
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const beats: number[] = [];
    for (let b = 0; b < 8; b++) beats.push(b);
    for (let b = 8; b < 20; b++) {
      beats.push(b);
      if (b % 4 === 1 || b % 4 === 3) beats.push(b + 0.5);
    }
    for (let b = 20; b < 28; b += 0.5) if (!(b % 2 === 1.5)) beats.push(b);
    beats.push(28, 29, 30, 30.5, 31);
    const lead = 3;
    const partnerBar = div('fg-partner fg-panel', `<div class="in" style="display:flex;align-items:center;gap:12px;padding:6px 16px 6px 6px"><div class="pp">${portraitSvg(pn.look, pn.portraitBg, 'happy')}</div><div><div class="nm" style="color:#4a2c14;text-shadow:none">Dancing with ${pn.name.split(' ')[0]}</div><div class="fg-meter"><i></i></div></div></div>`);
    const panel = div('fg-panel fg-dance fg-live', `<div class="in"><div class="lane"><div class="ribbon"></div><div class="ring"></div></div><div class="side"><div class="combo">0<small>COMBO</small></div><div class="score">0</div></div></div>`);
    const keys = div('fg-keys fg-live');
    const keyEls = ARROWS.map((a, d) => {
      const k = div('fg-key', a);
      k.addEventListener('pointerdown', () => this.keys.pressed.push(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'][d]!));
      keys.append(k);
      return k;
    });
    root.append(partnerBar, panel, keys);
    const lane = panel.querySelector('.lane') as HTMLElement;
    const ring = panel.querySelector('.ring') as HTMLElement;
    const comboEl = panel.querySelector('.combo') as HTMLElement;
    const scoreEl = panel.querySelector('.score') as HTMLElement;
    const meter = partnerBar.querySelector('.fg-meter i') as HTMLElement;
    let prevDir = -1;
    for (const b of beats) {
      let dir = Math.floor(rnd() * 4);
      if (dir === prevDir && rnd() < 0.6) dir = (dir + 1 + Math.floor(rnd() * 3)) % 4;
      prevDir = dir;
      const el = div('note', blossomSvg(dir));
      lane.append(el);
      notes.push({ t: (b + lead) * beat, dir, el, state: 0 });
    }
    const RING_X = 61;
    const SPEED = 300;
    let combo = 0;
    let best = 0;
    let score = 0;
    let perfect = 0;
    let good = 0;
    let harmony = 0.5;
    const end = notes[notes.length - 1]!.t + 1.2;
    const codes = [['ArrowLeft', 'KeyA'], ['ArrowUp', 'KeyW'], ['ArrowRight', 'KeyD'], ['ArrowDown', 'KeyS']];
    if (!(await this.countdown(root))) return null;
    env.play.live = true;
    const t0 = performance.now();
    const hitNote = (n: (typeof notes)[number], dt: number): void => {
      const p = Math.abs(dt) < 0.075;
      n.state = 1;
      n.el.classList.add('gone', p ? 'hitp' : 'hitg');
      combo++;
      best = Math.max(best, combo);
      score += (p ? 100 : 60) + Math.min(combo, 30) * 4;
      if (p) perfect++;
      else good++;
      harmony = Math.min(1, harmony + (p ? 0.05 : 0.025));
      this.judge(panel, p ? 'Bloom!' : 'Sweet', p ? 'p' : 'g', `${RING_X + 25}px`, '-34px');
      ring.classList.remove('hit');
      void ring.offsetWidth;
      ring.classList.add('hit');
      this.sfx(p ? 'ui:select' : 'ui:tick', p ? 1.2 : 1);
      env.map.playEvent(p ? 'perfect' : 'good', combo);
    };
    const ok = await this.loop(() => {
      const t = (performance.now() - t0) / 1000;
      env.play.beat = t / beat - lead;
      // Auto (demo): hit most notes near-perfectly.
      const pressed: number[] = [];
      if (env.auto) {
        for (const n of notes) if (n.state === 0 && t >= n.t - 0.02 && (n.t * 7) % 1 > 0.08) pressed.push(n.dir);
      } else codes.forEach((c, d) => this.hit(...c) && pressed.push(d));
      for (const d of pressed) {
        keyEls[d]!.classList.add('on');
        setTimeout(() => keyEls[d]!.classList.remove('on'), 110);
        const cand = notes.find((n) => n.state === 0 && Math.abs(n.t - t) < 0.17);
        if (cand && cand.dir === d) hitNote(cand, cand.t - t);
        else if (cand) {
          cand.state = 2;
          cand.el.classList.add('gone');
          combo = 0;
          harmony = Math.max(0, harmony - 0.06);
          this.judge(panel, 'Oops', 'm', `${RING_X + 25}px`, '-34px');
          this.sfx('ui:error', 0.6);
          env.map.playEvent('miss');
        }
      }
      for (const n of notes) {
        if (n.state === 0 && t - n.t > 0.17) {
          n.state = 2;
          n.el.style.opacity = '0.25';
          combo = 0;
          harmony = Math.max(0, harmony - 0.05);
          this.judge(panel, 'Oops', 'm', `${RING_X + 25}px`, '-34px');
          env.map.playEvent('miss');
        }
        const x = RING_X + (n.t - t) * SPEED;
        if (n.state !== 1) n.el.style.transform = `translateX(${x}px) rotate(${Math.sin((n.t - t) * 5) * 8}deg)`;
        n.el.style.display = x > lane.clientWidth + 60 ? 'none' : '';
      }
      comboEl.firstChild!.textContent = String(combo);
      scoreEl.textContent = score.toLocaleString();
      meter.style.width = `${Math.round(harmony * 100)}%`;
      return t > end;
    });
    env.play.live = false;
    if (!ok) return null;
    const acc = (perfect + good * 0.6) / notes.length;
    const place = acc >= 0.85 ? 0 : acc >= 0.6 ? 1 : 2;
    await this.wait(300);
    panel.remove();
    partnerBar.remove();
    keys.remove();
    const first = pn.name.split(' ')[0];
    return {
      place,
      score,
      gold: PRIZES.dance[place]!,
      hearts: [{ id: partner, delta: [120, 80, 40][place]! }],
      title: ['Radiant Dance!', 'A Lovely Dance', 'A Charming Dance'][place]!,
      sub: `${perfect} blooms · ${good} sweet · best combo ${best} — ${first} ${['is beaming', 'is smiling ear to ear', 'laughed the whole way round'][place]}`,
    };
  }

  // ───────────────────────────────────────────── lanterns

  private async lanterns(env: GameEnv): Promise<GameResult | null> {
    const root = this.root!;
    const wishes = WISHES.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    const w = await this.pick(env, 'Make a wish', 'Write it on the paper before the flame catches.', wishes.map((s) => `<div class="ic">${LANTERN_SVG}</div><div class="nm fg-wish">${s}</div>`), 1);
    if (w === null) return null;
    env.map.playEvent('wish', w);
    const panel = div('fg-panel fg-lant fg-live', `<div class="in"><div class="stars"></div><div class="band"></div><div class="water"></div><div class="lamp">${LANTERN_SVG}</div></div>`);
    const slots = div('fg-slots', '<i></i><i></i><i></i>');
    const hint = div('fg-hint', 'Hold <b>Space</b> to lift · let go inside the glowing swell');
    root.append(panel, slots, hint);
    const inner = panel.querySelector('.in') as HTMLElement;
    const band = panel.querySelector('.band') as HTMLElement;
    const lamp = panel.querySelector('.lamp') as HTMLElement;
    let held = false;
    const release = (): void => void (held = false);
    panel.addEventListener('pointerdown', () => (held = true));
    window.addEventListener('pointerup', release);
    const H = 420;
    const BAND = 64;
    let total = 0;
    let best = 0;
    for (let k = 0; k < 3; k++) {
      let v = 0;
      let autoIn = -1;
      let wasHeld = false;
      let released = -1;
      const phase = Math.random() * 6;
      const speed = 0.9 + k * 0.35;
      let bandY = 0;
      env.play.live = true;
      const ok = await this.loop((dt, t) => {
        // The swell drifts between 30 % and 80 % of the meter.
        bandY = 0.55 + 0.25 * Math.sin(t * speed + phase) * Math.cos(t * speed * 0.37 + phase * 2);
        let h = held || this.keys.down.has('Space') || this.keys.down.has('KeyX');
        if (env.auto) {
          // Attract mode: lift, hover with the swell for a beat, then let go.
          if (v >= bandY - 0.03 && autoIn < 0) autoIn = t;
          h = autoIn < 0 || t - autoIn < 1.1;
          if (h && autoIn >= 0) v = THREE_LERP(v, bandY, 0.2);
        }
        if (h && !(env.auto && autoIn >= 0)) v = Math.min(1, v + dt * (env.auto ? 0.38 : 0.62));
        else if (!wasHeld) v = Math.max(0, v - dt * 0.4);
        if (wasHeld && !h && v > 0.06) released = v;
        wasHeld = h;
        env.play.progress[0] = v;
        band.style.bottom = `${(bandY * (H - 46) + 46 - BAND / 2) | 0}px`;
        lamp.style.transform = `translateY(${-(v * (H - 46 - 60)) - 36}px) rotate(${Math.sin(t * 5) * 4}deg)`;
        lamp.style.bottom = '0px';
        return released >= 0;
      });
      if (!ok) return null;
      const d = Math.abs(released - bandY) * (H - 46);
      const q = d < 12 ? 3 : d < BAND / 2 ? 2 : d < BAND ? 1 : 0;
      const pts = [15, 45, 75, 100][q]!;
      total += pts;
      best = Math.max(best, q);
      const sl = slots.children[k] as HTMLElement;
      sl.classList.add(q >= 2 ? 'on' : 'dim');
      this.judge(inner, ['Sputter…', 'Wobbly', 'Aloft!', 'Radiant!'][q]!, q >= 2 ? 'p' : q === 1 ? 'g' : 'm', '50%', `${H - 46 - released * (H - 106) - 60}px`);
      this.sfx(q >= 2 ? 'lantern' : 'plop', q >= 2 ? 1 : 0.7);
      env.map.playEvent('release', q);
      lamp.style.transition = 'transform 900ms ease-in, opacity 900ms';
      lamp.style.transform = `translateY(-${H + 40}px) scale(.6)`;
      lamp.style.opacity = '0';
      await this.wait(1000);
      lamp.style.transition = '';
      lamp.style.opacity = '1';
    }
    env.play.live = false;
    window.removeEventListener('pointerup', release);
    panel.remove();
    slots.remove();
    hint.remove();
    const place = total >= 250 ? 0 : total >= 150 ? 1 : 2;
    return {
      place,
      score: total,
      gold: PRIZES.lanterns[place]!,
      hearts: [{ id: 'marigold', delta: [60, 40, 20][place]! }],
      title: ['The Sea Says Yes!', 'Three Lanterns Aloft', 'Lanterns on the Tide'][place]!,
      sub: `“${wishes[w]}” — ${['every lantern caught the swell and sailed for the horizon', 'your wishes are bobbing out past the pier', 'they wobbled, but they’re floating. Wishes are stubborn like that'][place]}`,
    };
  }

  // ───────────────────────────────────────────── sack race

  private async sackRace(env: GameEnv): Promise<GameResult | null> {
    const root = this.root!;
    const N = 5;
    const tints = ['#e6c275', '#d8392f', '#3f6fd0', '#f2b928', '#3a8a4a'];
    const panel = div('fg-panel fg-race fg-live', `<div class="in"><div class="keys2"><div class="fg-key">◀</div><div class="fg-key">▶</div></div><div class="bounce"><small>Bounce</small><div class="fg-meter"><i></i></div></div><div class="fg-track"><div class="lanes"></div><div class="fg-flag"></div></div><div class="place">–</div></div>`);
    const lanes = panel.querySelector('.lanes') as HTMLElement;
    const toks: HTMLElement[] = [];
    for (let i = 0; i < N; i++) {
      const l = div('');
      const t = div(i === 0 ? 'fg-token me' : 'fg-token', i === 0 ? '<b>YOU</b>' : '');
      if (i) t.style.background = tints[i]!;
      l.append(t);
      lanes.append(l);
      toks.push(t);
    }
    const [kL, kR] = [...panel.querySelectorAll('.keys2 .fg-key')] as HTMLElement[];
    kL!.addEventListener('pointerdown', () => this.keys.pressed.push('ArrowLeft'));
    kR!.addEventListener('pointerdown', () => this.keys.pressed.push('ArrowRight'));
    const meter = panel.querySelector('.bounce i') as HTMLElement;
    const placeEl = panel.querySelector('.place') as HTMLElement;
    root.append(panel);
    const LEN = 25.4;
    const pos = new Array(N).fill(0) as number[];
    const fin = new Array(N).fill(-1) as number[];
    const npc = [0, 2.62, 2.48, 2.75, 2.36].map((s, i) => ({ s, stumble: 3 + i * 1.7 }));
    env.play.progress = pos.map(() => 0);
    if (!(await this.countdown(root))) return null;
    env.play.live = true;
    let next: 0 | 1 = 0;
    let last = -1;
    let stun = 0;
    let bounce = 0.5;
    let finishedAt = -1;
    let order = 0;
    const ok = await this.loop((dt, t) => {
      // NPC racers: steady hops with the odd wobble.
      for (let i = 1; i < N; i++) {
        if (fin[i]! >= 0) continue;
        const n = npc[i]!;
        const wob = Math.abs(((t + i * 1.3) % n.stumble) - n.stumble / 2) < 0.22 ? 0.2 : 1;
        pos[i] = Math.min(LEN, pos[i]! + n.s * wob * dt * (0.9 + 0.1 * Math.sin(t * 7 + i)));
        if (pos[i]! >= LEN) fin[i] = order++;
      }
      // Player hops.
      stun = Math.max(0, stun - dt);
      let press: 0 | 1 | -1 = -1;
      if (env.auto) {
        if (t - last > 0.37 + 0.04 * Math.sin(t * 3) || last < 0) press = next;
      } else if (this.hit('ArrowLeft', 'KeyA')) press = 0;
      else if (this.hit('ArrowRight', 'KeyD')) press = 1;
      if (press >= 0 && fin[0]! < 0) {
        (press ? kR : kL)!.classList.add('on');
        setTimeout(() => (press ? kR : kL)!.classList.remove('on'), 100);
        const gap = last < 0 ? 0.35 : t - last;
        if (stun > 0) {
          /* still wobbling */
        } else if (press !== next) {
          stun = 0.28;
          bounce = Math.max(0, bounce - 0.2);
          this.judge(panel, 'Tangled!', 'm', '50%', '-40px');
          env.map.playEvent('stumble');
        } else if (gap < 0.17) {
          stun = 0.45;
          bounce = Math.max(0, bounce - 0.3);
          this.judge(panel, 'Wobble!', 'm', '50%', '-40px');
          this.sfx('ui:error', 0.5);
          env.map.playEvent('stumble');
        } else {
          const q = gap >= 0.26 && gap <= 0.46 ? 1 : gap < 0.26 ? 0.55 : Math.max(0.3, 1 - (gap - 0.46) * 1.2);
          bounce = bounce * 0.6 + q * 0.4;
          pos[0] = Math.min(LEN, pos[0]! + 0.92 * (0.45 + 0.55 * q));
          env.play.hop = 0;
          this.sfx(press ? 'step:dirt' : 'step:grass', 1.3);
          env.map.playEvent('hop', q);
          next = press ? 0 : 1;
          last = t;
          if (pos[0]! >= LEN) {
            fin[0] = order++;
            finishedAt = t;
            env.map.playEvent('finish', fin[0]!);
          }
        }
      }
      env.play.hop = last < 0 ? 1 : Math.min(1, (t - last) / 0.3);
      kL!.classList.toggle('next', next === 0 && fin[0]! < 0);
      kR!.classList.toggle('next', next === 1 && fin[0]! < 0);
      meter.style.width = `${Math.round(bounce * 100)}%`;
      const rank = 1 + pos.filter((p, i) => i > 0 && (fin[i]! >= 0 ? fin[i]! < (fin[0]! < 0 ? 99 : fin[0]!) : p > pos[0]!)).length;
      placeEl.textContent = ['1st', '2nd', '3rd', '4th', '5th'][rank - 1]!;
      for (let i = 0; i < N; i++) {
        env.play.progress[i] = pos[i]! / LEN;
        toks[i]!.style.left = `${(pos[i]! / LEN) * 100}%`;
      }
      return (finishedAt >= 0 && t - finishedAt > 1.4) || fin.every((f) => f >= 0) || t > 40;
    });
    env.play.live = false;
    if (!ok) return null;
    const place = fin[0]! >= 0 ? fin[0]! : 4;
    panel.remove();
    return {
      place,
      score: Math.round(1000 - place * 200),
      gold: PRIZES.sackrace[place] ?? 0,
      hearts: [{ id: 'wren', delta: place === 0 ? 60 : 30 }],
      title: ['Sack Race Champion!', 'Second Place!', 'Third Place!', 'Fourth — Valiant!', 'Last, but Bouncy'][place]!,
      sub: ['Wren is demanding a rematch. Loudly.', 'Odessa won by a sack-length. She is insufferable about it.', 'A bronze-worthy bounce!', 'You found the bounce eventually!', 'Kit says you “hopped with feeling”.'][place]!,
    };
  }

  // ───────────────────────────────────────────── produce judging

  private async judging(env: GameEnv): Promise<GameResult | null> {
    const root = this.root!;
    const inv = this.game.services.inventory;
    type Entry = { id: string; name: string; q: number; score: number };
    const cands: Entry[] = [];
    const seen = new Set<string>();
    for (const s of inv?.slots ?? []) {
      if (!s) continue;
      const d = itemDef(s.id);
      if (!d || !['produce', 'forage', 'fish'].includes(d.kind)) continue;
      const key = `${s.id}:${s.quality ?? 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const q = s.quality ?? 0;
      cands.push({ id: s.id, name: d.name, q, score: Math.round(Math.min(98, 34 + Math.sqrt(d.sell) * 4.2 + q * 11)) });
    }
    if (!cands.length && env.auto) {
      // Attract mode on an empty backpack: a plausible farmer's shortlist.
      for (const [id, q] of [['pumpkin', 2], ['melon', 1], ['cauliflower', 1], ['sunflower', 0], ['strawberry', 2]] as const) {
        const d = itemDef(id);
        if (d) cands.push({ id, name: d.name, q, score: Math.round(Math.min(98, 34 + Math.sqrt(d.sell) * 4.2 + q * 11)) });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const list = cands.slice(0, 8);
    let mine: Entry;
    if (!list.length) mine = { id: 'stone', name: 'A Very Polished Stone', q: 0, score: 23 };
    else {
      const stars = (q: number): string => (q ? `<span class="star">${'★'.repeat(q)}</span>` : 'Regular');
      const k = await this.pick(env, 'Choose your entry', 'Your best produce goes on the judging table.', list.map((c) => `${itemIcon(c.id)}<div class="nm">${c.name}</div><div class="meta">${stars(c.q)}</div>`), 0);
      if (k === null) return null;
      mine = list[k]!;
    }
    env.map.playEvent('enter');
    const entries = [...PRODUCE_RIVALS.map((r) => ({ ...r, me: false, icon: '' })), { name: mine.name, by: 'You', score: mine.score + Math.floor(Math.random() * 6), tint: '', me: true, icon: mine.id }];
    // Shuffle the table, but keep yours third.
    const table = [entries[1]!, entries[0]!, entries[3]!, entries[2]!];
    const panel = div('fg-panel fg-show fg-live', `<div class="in"><h3>The judges confer…</h3><div class="fg-entries"></div></div>`);
    const row = panel.querySelector('.fg-entries') as HTMLElement;
    const cards = table.map((e) => {
      const c = div(`fg-entry${e.me ? ' me' : ''}`);
      const art = e.me ? itemIcon(e.icon) : `<div class="blob" style="background:${e.tint}"></div>`;
      c.innerHTML = `<div class="face front">${art}<div class="nm">${e.name}</div><div class="by">${e.by}</div><div class="pts">?</div></div><div class="face back"><span>?</span></div>`;
      row.append(c);
      return c;
    });
    root.append(panel);
    for (let i = 0; i < cards.length; i++) {
      if (!(await this.wait(i ? 650 : 400))) return null;
      cards[i]!.classList.add('open');
      this.sfx('ui:tab', 1.2);
      env.map.playEvent('judge', i);
    }
    if (!(await this.wait(500))) return null;
    // Scores roll up.
    const ptsEls = cards.map((c) => c.querySelector('.pts') as HTMLElement);
    await this.loop((_dt, t) => {
      const k = Math.min(1, t / 1.6);
      table.forEach((e, i) => (ptsEls[i]!.textContent = String(Math.round(e.score * k * k * (3 - 2 * k)))));
      if (Math.floor(t * 12) !== Math.floor((t - 0.016) * 12)) this.sfx('ui:tick', 0.6);
      return t > 1.7;
    });
    const ranked = table.map((e, i) => ({ e, i })).sort((a, b) => b.e.score - a.e.score);
    (panel.querySelector('h3') as HTMLElement).textContent = 'And the ribbons go to…';
    for (let p = 2; p >= 0; p--) {
      if (!(await this.wait(560))) return null;
      const c = cards[ranked[p]!.i]!;
      c.append(div('rib', rosetteSvg(p)));
      this.sfx(p === 0 ? 'bundle' : 'ui:select', 1);
    }
    const place = ranked.findIndex((r) => r.e.me);
    env.map.playEvent('ribbon', place);
    if (!(await this.wait(1500))) return null;
    panel.remove();
    return {
      place: Math.min(place, 3),
      score: mine.score,
      gold: PRIZES.pumpkin[Math.min(place, 3)]!,
      hearts: [{ id: 'marigold', delta: 30 }],
      title: ['Best in Show!', 'Second Prize!', 'Third Prize!', 'Honourable Mention'][Math.min(place, 3)]!,
      sub: [`Your ${mine.name.toLowerCase()} beat Duchess. Bram has gone very quiet.`, 'A blue ribbon! Your gran would have pinned it to her hat.', 'A red ribbon for a fine entry!', 'The judges were “moved”. Also slightly confused.'][Math.min(place, 3)]!,
    };
  }

  // ───────────────────────────────────────────── gift exchange

  private async giftSwap(env: GameEnv): Promise<GameResult | null> {
    const root = this.root!;
    const rel = this.game.services.relationships;
    const ids = Object.keys(NPCS) as NpcId[];
    const target = (env.play.partner as NpcId) ?? ids[Math.floor(Math.random() * ids.length)]!;
    // 1) Draw a name.
    const draw = div('fg-panel fg-draw spin fg-live', `<div class="in"><div class="rl">You drew…</div><div class="pp"></div><div class="nm">?</div><div class="rl">&nbsp;</div></div>`);
    root.append(draw);
    const pp = draw.querySelector('.pp') as HTMLElement;
    const nm = draw.querySelector('.nm') as HTMLElement;
    const rl = draw.querySelectorAll('.rl')[1] as HTMLElement;
    let k = 0;
    const ok = await this.loop((_dt, t) => {
      const step = Math.floor(Math.pow(t, 0.7) * 9);
      if (step !== k && t < 1.9) {
        k = step;
        const id = ids[k % ids.length]!;
        pp.innerHTML = portraitSvg(NPCS[id].look, NPCS[id].portraitBg, 'neutral');
        nm.textContent = NPCS[id].name.split(' ')[0]!;
        this.sfx('ui:tick', 0.8);
      }
      return t >= 1.9;
    });
    if (!ok) return null;
    const tn = NPCS[target];
    draw.classList.remove('spin');
    pp.innerHTML = portraitSvg(tn.look, tn.portraitBg, 'happy');
    nm.textContent = tn.name;
    rl.textContent = tn.role;
    this.sfx('ui:select', 1.3);
    env.map.playEvent('draw');
    if (!(await this.wait(1400))) return null;
    draw.remove();
    // 2) Pick a present from the backpack.
    const inv = this.game.services.inventory;
    const gifts: { id: string; q: number }[] = [];
    const seen = new Set<string>();
    for (const s of inv?.slots ?? []) {
      if (!s || seen.has(s.id)) continue;
      const d = itemDef(s.id);
      if (!d || d.kind === 'tool') continue;
      seen.add(s.id);
      gifts.push({ id: s.id, q: s.quality ?? 0 });
    }
    if (!gifts.length && env.auto) for (const id of ['strawberry', 'sunflower', 'amethyst', 'pumpkin', 'topaz', 'wool']) if (itemDef(id)) gifts.push({ id, q: 0 });
    let giftId: string | null = null;
    if (gifts.length) {
      const list = gifts.slice(0, 12);
      const autoPick = Math.max(0, list.findIndex((g) => rel?.taste(target, g.id) === 'love'));
      const c = await this.pick(env, `A present for ${tn.name.split(' ')[0]}`, 'Wrap something from your backpack. (They’ll never guess it was you.)', list.map((g) => `${itemIcon(g.id)}<div class="nm">${itemDef(g.id)?.name ?? g.id}</div>`), autoPick);
      if (c === null) return null;
      giftId = list[c]!.id;
    }
    // 3) Their reaction.
    const reaction = giftId ? (rel?.taste(target, giftId) ?? 'like') : 'neutral';
    if (giftId && !env.auto) {
      if (rel?.gift(target, giftId) === null) rel?.adjust(target, reaction === 'love' ? 80 : reaction === 'like' ? 45 : 20);
      else rel?.adjust(target, 40);
      inv?.remove(giftId, 1);
    }
    const mood: Mood = reaction === 'love' ? 'laugh' : reaction === 'like' ? 'happy' : reaction === 'dislike' ? 'worried' : 'happy';
    const line = giftId ? stripTags(tn.giftLines[reaction]) : 'A hand-drawn card! With a little star on it. I’ll keep this forever.';
    const react = div('fg-panel fg-draw fg-live', `<div class="in"><div class="pp">${portraitSvg(tn.look, tn.portraitBg, mood)}</div><div class="nm">${tn.name.split(' ')[0]}</div><div class="line">“${line}”</div></div>`);
    root.append(react);
    this.sfx(`gift:${reaction}`, 1);
    env.map.playEvent('given', reaction === 'love' ? 3 : reaction === 'like' ? 2 : 1);
    if (!(await this.loop((_dt, t) => (env.auto ? t > 2.2 : t > 0.6 && this.hit('Space', 'Enter', 'KeyX', 'KeyF')) || t > 7))) return null;
    react.remove();
    // 4) Somebody drew you: unwrap.
    const giver = ids.filter((i) => i !== target)[Math.floor(Math.random() * (ids.length - 1))]!;
    const got = STARFALL_GIFTS.filter((g) => itemDef(g))[Math.floor(Math.random() * STARFALL_GIFTS.filter((g) => itemDef(g)).length)] ?? 'topaz';
    const box = div('fg-panel fg-draw fg-live', `<div class="in"><div class="rl">Someone drew <b>your</b> name!</div><div class="fg-box shake">${giftBoxSvg('#c8302a', '#f2d27a')}</div><div class="nm">From ${NPCS[giver].name.split(' ')[0]}</div><div class="rl">Press Space to unwrap</div></div>`);
    root.append(box);
    const bx = box.querySelector('.fg-box') as HTMLElement;
    let open = false;
    bx.addEventListener('click', () => (open = true));
    if (!(await this.loop((_dt, t) => (env.auto ? t > 1.4 : open || (t > 0.4 && this.hit('Space', 'Enter', 'KeyX', 'KeyF')))))) return null;
    bx.classList.remove('shake');
    bx.innerHTML = `<div class="rays"></div>${giftBoxSvg('#c8302a', '#f2d27a', true)}<div class="gift">${itemIcon(got)}</div>`;
    (box.querySelectorAll('.rl')[1] as HTMLElement).textContent = itemDef(got)?.name ?? got;
    this.sfx('catch:perfect', 0.9);
    this.confetti(root, env.festival.colors, 40);
    env.map.playEvent('unwrap');
    if (!env.auto) inv?.add(got, 1);
    if (!(await this.wait(1800))) return null;
    box.remove();
    const place = reaction === 'love' ? 0 : reaction === 'like' ? 1 : reaction === 'dislike' ? 3 : 2;
    return {
      place,
      score: 0,
      gold: 0,
      item: got,
      hearts: [{ id: target, delta: [80, 45, 20, 5][place]! }],
      title: ['A Perfect Present!', 'A Lovely Present', 'A Kind Thought', 'It’s the Thought…'][place]!,
      sub: `${tn.name.split(' ')[0]} ${['can’t stop smiling', 'is delighted', 'thanks you warmly', 'is… being very polite about it'][place]} · ${NPCS[giver].name.split(' ')[0]} wrapped you something special`,
    };
  }

  // ───────────────────────────────────────────── skate

  private async skate(env: GameEnv): Promise<GameResult | null> {
    const root = this.root!;
    const panel = div('fg-panel fg-skate fg-live', `<div class="in"><small>Star lights</small><div class="big">${STAR_SVG}<span>0</span></div><div class="fg-meter"><i style="width:0%"></i></div></div>`);
    const hint = div('fg-hint', '<b>◀ ▶</b> steer · hold <b>Space</b> to glide');
    root.append(panel, hint);
    const num = panel.querySelector('.big span') as HTMLElement;
    const bar = panel.querySelector('.fg-meter i') as HTMLElement;
    if (!(await this.countdown(root))) return null;
    env.play.live = true;
    let lastScore = 0;
    const ok = await this.loop((_dt, t) => {
      let steer = (this.keys.down.has('ArrowRight') || this.keys.down.has('KeyD') ? 1 : 0) - (this.keys.down.has('ArrowLeft') || this.keys.down.has('KeyA') ? 1 : 0);
      if (env.auto) steer = Math.sin(t * 1.3) * 0.9;
      env.play.steer = steer;
      env.play.boost = env.auto ? Math.sin(t * 0.7) > 0 : this.keys.down.has('Space');
      if (env.play.score !== lastScore) {
        lastScore = env.play.score;
        this.sfx('ui:select', 1.1);
        num.parentElement!.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
      }
      num.textContent = `${env.play.score} / ${env.play.total}`;
      bar.style.width = `${Math.round((env.play.progress[0] ?? 0) * 100)}%`;
      return env.play.done;
    });
    env.play.live = false;
    if (!ok) return null;
    panel.remove();
    hint.remove();
    const f = env.play.total ? env.play.score / env.play.total : 0;
    const place = f >= 0.8 ? 0 : f >= 0.5 ? 1 : 2;
    return {
      place,
      score: env.play.score,
      gold: PRIZES.skate[place]!,
      hearts: [{ id: 'odessa', delta: [50, 30, 15][place]! }],
      title: ['Starlight Skater!', 'Graceful Glide', 'Wobbly but Wonderful'][place]!,
      sub: `${env.play.score} of ${env.play.total} star lights · ${['Odessa nodded. Once. That’s a standing ovation.', 'Kit wants lessons.', 'You only fell over artistically.'][place]}`,
    };
  }
}

const COIN = `<svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="15" fill="#f5c542" stroke="#b8861a" stroke-width="2.5"/><circle cx="17" cy="17" r="10" fill="none" stroke="#fff2b0" stroke-width="2"/><text x="17" y="22" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="700" font-size="13" fill="#8a5a10">g</text></svg>`;

function friendWord(delta: number): string {
  return delta >= 100 ? 'Best friends vibes' : delta >= 60 ? 'Friendship ♥♥' : delta >= 30 ? 'Friendship ♥' : 'A warm smile';
}

function stripTags(s: string): string {
  return s.replace(/\[[a-z]+\]\s*/g, '');
}
