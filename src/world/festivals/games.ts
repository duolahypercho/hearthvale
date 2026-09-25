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
import { CROPS } from '../../data/crops';
import { WISHES, produceRivals, PRESENTATIONS, favouredPresentation, STARFALL_GIFTS, PRIZES, MIN_ENTRY_VALUE, shortName, type ActivityDef, type FestivalDef } from '../../data/festivals';
import { portraitSvg } from '../../ui/portraits';
import { itemIcon } from '../../ui/icons';
import type { FestivalMap, PlayState } from './base';
import type { CoopLobby, CoopRace, CoopRacer } from './coop';

export interface GameEnv {
  game: Game;
  map: FestivalMap;
  play: PlayState;
  def: ActivityDef;
  festival: FestivalDef;
  /** Demo / attract mode: the game plays itself and loops. */
  auto: boolean;
  /** Encore: you have won this before — the harder variant (dance: the fast chart). */
  hard?: boolean;
  /** Co-op: today's board for this activity with your result folded in (shown when > 1 farmer). */
  board?: (r: GameResult) => BoardRow[];
  /** Co-op start line (sack race / skate with other farmers on the grounds), else null. */
  lobby?: CoopLobby | null;
}

/** A row of the co-op festival board (mirrors systems/festivals FestivalScore). */
export interface BoardRow {
  player: string;
  name: string;
  score: number;
  place: number;
  color?: string;
}

export interface GameResult {
  /** 0 = best tier (1st), 1 = 2nd, 2 = 3rd; ≥ 3 with `noRibbon` = below the prize line. */
  place: number;
  /** Below the ribbon threshold: no rosette, a laugh and a consolation. */
  noRibbon?: boolean;
  /** Gift exchange: the recipient's reaction (shown as a heart burst instead of a rosette). */
  reaction?: 'love' | 'like' | 'neutral' | 'dislike';
  score: number;
  gold: number;
  item?: string;
  hearts?: { id: string; delta: number }[];
  title: string;
  sub: string;
  /** Co-op farmers who raced with you (their places as this machine saw the finish). */
  rivals?: BoardRow[];
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
/* The result card (trophy / slam) owns the top of the screen: the plaque steps aside. */
.fg-root:has(.fg-result) .fg-plaque { animation: none; opacity: 0; transform: translate(-50%, -24px); transition: opacity 220ms ease, transform 260ms ease; }
.fg-howto { position: absolute; top: 104px; left: 50%; transform: translateX(-50%); max-width: 640px; text-align: center; font-weight: 800; font-size: 17px; color: #fff8e8;
  padding: 7px 18px; border-radius: 999px; background: rgba(40, 22, 10, .55); backdrop-filter: blur(4px); text-shadow: 0 1px 2px rgba(0,0,0,.5); animation: fgFade 5s ease both; }
@keyframes fgShakeX { 0%,100% { translate: 0 0; } 20% { translate: -4px 1px; } 40% { translate: 4px -1px; } 60% { translate: -3px 0; } 80% { translate: 2px 1px; } }
.fg-shakeit { animation: fgShakeX 240ms linear both; }
.fg-result .burst { width: 150px; height: 140px; margin: -86px auto 0; animation: fgBounce 700ms var(--ease-back) both; }
.fg-result .burst svg { width: 100%; height: 100%; filter: drop-shadow(0 6px 5px rgba(0,0,0,.3)); }
.fg-result .tier { display: inline-block; margin: 4px 0 2px; padding: 3px 14px; border-radius: 999px; font-family: var(--font-head); font-weight: 700; font-size: 15px; letter-spacing: 1.5px; text-transform: uppercase; color: #fff; }
.fg-skate .rows { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; margin-top: 6px; text-align: left; font-weight: 800; color: #3a5a7a; font-size: 15px; }
.fg-skate .rows b { font-family: var(--font-head); font-size: 20px; color: #2f6a9a; }
.fg-skate .rows .bad b { color: #c8503a; }
.fg-skate .combo { margin-top: 8px; font-family: var(--font-head); font-weight: 700; font-size: 26px; color: #e8a020; text-shadow: 0 2px 0 rgba(90, 50, 0, .25); }
.fg-skate .combo small { font-size: 12px; color: #9a7a4a; margin-left: 4px; }
.fg-skate .ctimer { height: 6px; border-radius: 4px; background: rgba(40, 60, 90, .2); overflow: hidden; }
.fg-skate .ctimer i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #ffb020, #ffe07a); }
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
  -webkit-text-stroke: 5px #3a1c0c; paint-order: stroke fill; text-shadow: 0 4px 0 #3a1c0c, 0 6px 12px rgba(0,0,0,.45); }
.fg-judge.p { color: #ffd84a; } .fg-judge.g { color: #a8ec82; } .fg-judge.m { color: #ff7a66; }
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
.fg-lant > .in { height: 420px; overflow: visible; background:
  radial-gradient(34px 34px at 74% 13%, rgba(255, 248, 220, .95) 0 40%, rgba(255, 236, 190, .25) 60%, transparent 100%),
  repeating-linear-gradient(180deg, transparent 0 22px, rgba(120, 190, 255, .05) 22px 24px),
  linear-gradient(180deg, #1c2a5a 0%, #1a2654 38%, #1a3a68 70%, #16507a 100%); }
.fg-lant > .in::before { content: ''; position: absolute; inset: 0; border-radius: 14px; background: radial-gradient(90% 40% at 50% 100%, rgba(90, 230, 240, .28), transparent 70%); pointer-events: none; }
/* The swell: a painted glowing wave ribbon (crest line + inner foam line), not a box. */
.fg-lant .band { position: absolute; left: -6px; right: -6px; height: 64px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 130 64' preserveAspectRatio='none'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%23d8fff8' stop-opacity='.95'/%3E%3Cstop offset='.45' stop-color='%2376f0e6' stop-opacity='.8'/%3E%3Cstop offset='1' stop-color='%23208aa8' stop-opacity='.35'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M0 20 C16 8 30 8 44 18 S74 30 88 18 S116 6 130 16 L130 46 C114 56 100 56 86 48 S56 36 42 46 S14 58 0 48 Z' fill='url(%23g)'/%3E%3Cpath d='M0 20 C16 8 30 8 44 18 S74 30 88 18 S116 6 130 16' fill='none' stroke='%23f4fffc' stroke-width='3' stroke-linecap='round'/%3E%3Cpath d='M10 34 C24 28 34 30 46 35 S72 40 86 33 S110 28 122 32' fill='none' stroke='%23e6fffb' stroke-opacity='.55' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") center / 100% 100% no-repeat;
  filter: drop-shadow(0 0 10px rgba(110, 250, 240, .75)) drop-shadow(0 0 22px rgba(60, 200, 230, .45)); animation: fgSwell 2.4s ease-in-out infinite alternate; }
.fg-lant .band::after { content: ''; position: absolute; left: 22px; right: 22px; top: 50%; height: 3px; margin-top: -1px; background: radial-gradient(closest-side, #fffef0, rgba(255, 250, 220, 0)); border-radius: 2px; }
@keyframes fgSwell { from { background-position: 0 0; transform: scaleX(1) skewX(-2deg); } to { transform: scaleX(1.04) skewX(2deg); } }
.fg-lant .lamp { position: absolute; left: 50%; width: 58px; height: 70px; margin-left: -29px; will-change: transform; z-index: 2; }
.fg-lant .lamp svg { width: 100%; height: 100%; filter: drop-shadow(0 0 14px rgba(255, 180, 90, .95)); }
.fg-lant .stars { position: absolute; inset: 0; border-radius: 14px; background-image: radial-gradient(1.5px 1.5px at 20% 30%, #fff, transparent), radial-gradient(1px 1px at 70% 22%, #fff, transparent), radial-gradient(1.5px 1.5px at 40% 8%, #cfe, transparent), radial-gradient(1px 1px at 85% 40%, #fff, transparent), radial-gradient(1px 1px at 12% 52%, #fff, transparent), radial-gradient(1.2px 1.2px at 58% 46%, #eef, transparent), radial-gradient(1px 1px at 30% 16%, #fff, transparent); opacity: .7; }
.fg-lant .water { position: absolute; left: 0; right: 0; bottom: 0; height: 60px; border-radius: 0 0 14px 14px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 136 60' preserveAspectRatio='none'%3E%3Cpath d='M0 14 C12 4 22 4 34 12 S58 22 70 12 S94 2 106 10 S126 18 136 10 L136 60 L0 60 Z' fill='%23155a86'/%3E%3Cpath d='M0 14 C12 4 22 4 34 12 S58 22 70 12 S94 2 106 10 S126 18 136 10' fill='none' stroke='%237ff0ec' stroke-width='3'/%3E%3Cpath d='M0 30 C14 24 26 26 38 30 S62 36 76 30 S100 24 114 29 S130 33 136 30' fill='none' stroke='%2358c8e0' stroke-opacity='.5' stroke-width='2'/%3E%3C/svg%3E") center top / 100% 100% no-repeat; box-shadow: 0 -6px 18px rgba(90, 230, 240, .35); }
.fg-lant .fg-judge { font-size: 28px; }
.fg-slots { position: absolute; right: 40px; top: calc(50% + 236px); display: flex; gap: 6px; width: 198px; justify-content: center; }
.fg-slots i { width: 32px !important; }
.fg-slots i.q3 { background: radial-gradient(circle at 50% 40%, #ffffff, #ffe27a 50%, #f0a020) !important; box-shadow: 0 0 20px rgba(255, 220, 110, 1), inset 0 0 0 2px #fff8e0 !important; }
.fg-slots i.q1 { background: radial-gradient(circle at 50% 40%, #ffe0e8, #e89aa8 60%, #b86a7a) !important; box-shadow: 0 0 8px rgba(240, 150, 170, .7), inset 0 0 0 2px rgba(255,255,255,.5) !important; }
.fg-streak { position: absolute; right: 40px; top: calc(50% + 286px); width: 198px; text-align: center; font-family: var(--font-head); font-weight: 700; font-size: 16px; color: #ffe9a8; text-shadow: 0 2px 0 rgba(60, 30, 10, .8); letter-spacing: 1px; }
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
.fg-wish { font-family: var(--font-hand); font-size: 27px !important; line-height: 28px !important; font-weight: 700 !important; text-wrap: balance; }
.fg-choose .fg-card:has(.fg-wish) { min-height: 176px; display: flex; flex-direction: column; justify-content: center; }
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
.fg-show { left: 50%; top: auto; bottom: 18px; transform: translateX(-50%); width: min(920px, calc(100vw - 32px)); }
.fg-show > .in { padding: 8px 14px 12px; }
.fg-show h3 { margin: 0 0 6px; text-align: center; font-family: var(--font-head); font-size: 22px; color: #5a3218; }
.fg-entries { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.fg-entry { position: relative; perspective: 800px; height: 112px; }
.fg-show .fg-entry .face { padding: 8px 8px 6px 70px; text-align: left; display: flex; flex-direction: column; justify-content: center; }
.fg-show .fg-entry .back { padding: 0; }
.fg-show .fg-entry .front .u-ic, .fg-show .fg-entry .blob { position: absolute; left: 10px; top: 50%; margin: 0; transform: translateY(-50%); width: 52px; height: 52px; }
.fg-show .fg-entry .blob { height: 44px; }
.fg-show .fg-entry .nm { font-size: 15px; line-height: 17px; }
.fg-show .fg-entry .pts { font-size: 26px; margin-top: 0; line-height: 28px; }
.fg-show .fg-entry .back span { font-size: 38px; }
.fg-show .fg-entry .rib { top: -30px; right: -6px; width: 46px; height: 64px; }
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
.fg-board { margin: 14px auto 0; max-width: 380px; text-align: left; border-radius: 12px; padding: 6px 8px; background: rgba(120, 70, 30, .08); box-shadow: inset 0 0 0 2px rgba(150, 100, 50, .18); }
.fg-board .h { font-family: var(--font-head); font-weight: 700; font-size: 13px; letter-spacing: 2px; text-transform: uppercase; color: var(--ink-soft); text-align: center; margin: 2px 0 4px; }
.fg-board .r { display: grid; grid-template-columns: 34px 14px 1fr auto; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 9px; font-weight: 800; font-size: 17px; animation: fgIn 360ms var(--ease-back) both; }
.fg-board .r.me { background: rgba(255, 244, 214, .95); box-shadow: 0 0 0 2px #e8b64a; }
.fg-board .r .pl { font-family: var(--font-head); font-weight: 700; font-size: 18px; color: #8a5a10; text-align: center; }
.fg-board .r .dot { width: 12px; height: 12px; border-radius: 50%; box-shadow: 0 1px 0 rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.5); }
.fg-board .r .sc { font-family: var(--font-head); font-weight: 700; color: var(--ink); }
/* Win stinger: a slow-motion title slam + light sweep; loss: a sheepish droop. */
.fg-sting { position: absolute; left: 50%; top: 20%; transform: translate(-50%, -50%); font-family: var(--font-head); font-weight: 700; font-size: 96px; letter-spacing: 4px; white-space: nowrap; pointer-events: none; z-index: 2;
  color: #ffe27a; -webkit-text-stroke: 8px #5a2c0c; paint-order: stroke fill; text-shadow: 0 8px 0 #5a2c0c, 0 18px 40px rgba(0,0,0,.5), 0 0 60px rgba(255,210,90,.8); animation: fgSting 2400ms cubic-bezier(.16,.9,.3,1) both; }
@keyframes fgSting { 0% { opacity: 0; transform: translate(-50%, -50%) scale(2.6) rotate(-8deg); } 18% { opacity: 1; transform: translate(-50%, -50%) scale(.94) rotate(2deg); } 26% { transform: translate(-50%, -50%) scale(1.04) rotate(-1deg); }
  80% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); } 100% { opacity: 0; transform: translate(-50%, -64%) scale(1.1); } }
.fg-rays { position: absolute; left: 50%; top: 42%; width: 1100px; height: 1100px; margin: -550px 0 0 -550px; pointer-events: none; border-radius: 50%; opacity: 0;
  background: repeating-conic-gradient(rgba(255, 226, 130, .35) 0 8deg, transparent 8deg 18deg); -webkit-mask: radial-gradient(circle, #000 10%, transparent 62%); mask: radial-gradient(circle, #000 10%, transparent 62%);
  animation: fgRays 3.6s ease-out both, fgSpin 24s linear infinite; }
@keyframes fgRays { 0% { opacity: 0; } 15% { opacity: 1; } 75% { opacity: .8; } 100% { opacity: 0; } }
.fg-result.lose .in { filter: saturate(.72); }
.fg-result .wilt { width: 150px; height: 140px; margin: -86px auto 0; transform-origin: 50% 100%; animation: fgWilt 1400ms cubic-bezier(.3,.7,.3,1) both; }
.fg-result .wilt svg { width: 100%; height: 100%; filter: drop-shadow(0 6px 5px rgba(0,0,0,.3)); }
@keyframes fgWilt { 0% { transform: scale(.4); opacity: 0; } 30% { transform: scale(1.05) rotate(0); opacity: 1; } 60% { transform: rotate(-9deg); } 100% { transform: rotate(-5deg); } }
.fg-result .trophy { width: 130px; height: 140px; margin: -92px auto 0; animation: fgBounce 900ms var(--ease-back) both; }
.fg-result .trophy svg { width: 100%; height: 100%; filter: drop-shadow(0 8px 6px rgba(0,0,0,.35)) drop-shadow(0 0 22px rgba(255, 210, 90, .7)); }
.fg-chip.none { color: #8a7a6a; background: rgba(230, 220, 205, .7); }
.fg-board .r .pl small { color: var(--ink-soft); }
.fg-board .r .pl svg { width: 26px; height: 32px; display: block; margin: 0 auto; }
.fg-lobby { left: 50%; bottom: 40px; transform: translateX(-50%); width: min(520px, calc(100vw - 32px)); }
.fg-lobby > .in { padding: 14px 20px 14px; text-align: center; }
.fg-lobby .k { font-family: var(--font-head); font-weight: 700; font-size: 24px; color: #5a3218; }
.fg-lobby .who { margin: 8px auto 6px; display: grid; gap: 4px; max-width: 360px; }
.fg-lobby .p { display: grid; grid-template-columns: 16px 1fr auto; gap: 8px; align-items: center; padding: 4px 10px; border-radius: 9px; font-weight: 800; font-size: 17px; text-align: left; background: rgba(255, 250, 235, .7); animation: fgIn 300ms var(--ease-back) both; }
.fg-lobby .p i { width: 12px; height: 12px; border-radius: 50%; box-shadow: 0 1px 0 rgba(0,0,0,.25); }
.fg-lobby .p span { font-size: 13px; color: #4f8a34; } .fg-lobby .p.wait { opacity: .6; } .fg-lobby .p.wait span { color: var(--ink-soft); }
.fg-lobby .t { font-weight: 800; font-size: 14px; color: var(--ink-soft); }
.fg-lobby .fg-go { margin-top: 10px; } .fg-lobby .esc { margin-top: 6px; font-size: 12px; font-weight: 800; color: var(--ink-soft); opacity: .8; }
.fg-token.farmer { background: linear-gradient(180deg, #ffffff, #e8e0d0); border-width: 3px; }
.fg-token.farmer b { color: #4a2c14; font-size: 9px; }
.fg-skate .rivals { margin-top: 8px; display: grid; gap: 3px; text-align: left; font-weight: 800; font-size: 13px; color: #3a5a7a; }
.fg-skate .rivals div { display: grid; grid-template-columns: 10px 1fr auto; gap: 6px; align-items: center; }
.fg-skate .rivals i { width: 10px; height: 10px; border-radius: 50%; }
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

/** Presentation cards (produce judging). */
const PRESENT_SVG: Record<string, string> = {
  polish: `<svg viewBox="0 0 56 56"><circle cx="28" cy="32" r="16" fill="#f07a1e"/><path d="M28 16 q2 -6 6 -8" stroke="#5a7a2a" stroke-width="3" fill="none"/><path d="M20 26 q4 -5 9 -5" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M42 12 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#ffe27a"/></svg>`,
  nest: `<svg viewBox="0 0 56 56"><ellipse cx="28" cy="42" rx="22" ry="8" fill="#d8b060"/><path d="M8 40 q20 8 40 0 M10 44 q18 6 36 0" stroke="#a8803a" stroke-width="2" fill="none"/><circle cx="28" cy="30" r="13" fill="#f07a1e"/><path d="M28 17 q2 -5 5 -7" stroke="#5a7a2a" stroke-width="3" fill="none"/></svg>`,
  bow: `<svg viewBox="0 0 56 56"><circle cx="28" cy="32" r="16" fill="#f07a1e"/><path d="M28 18 C 16 8 12 20 26 20 Z M28 18 C 40 8 44 20 30 20 Z" fill="#d84a6a" stroke="#8a2a3a" stroke-width="1.5"/><circle cx="28" cy="19" r="3" fill="#f06a8a"/></svg>`,
  plain: `<svg viewBox="0 0 56 56"><circle cx="28" cy="32" r="16" fill="#e8862a"/><path d="M28 16 q2 -6 6 -8" stroke="#5a7a2a" stroke-width="3" fill="none"/></svg>`,
};

const STAR_SVG = `<svg viewBox="0 0 40 40"><path d="M20 3 L25 15 L38 15.5 L28 24 L31.5 37 L20 29.5 L8.5 37 L12 24 L2 15.5 L15 15 Z" fill="#ffd84a" stroke="#fff4c0" stroke-width="2" stroke-linejoin="round"/></svg>`;


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

  /**
   * Co-op start line: list who is lined up (and who could still join) until the lobby resolves.
   * The owner can start early (Space); Escape races solo. Resolves to the shared race or null.
   */
  private async lineUp(env: GameEnv): Promise<CoopRace | null> {
    const lob = env.lobby;
    if (!lob || env.auto) return null;
    const root = this.root!;
    const panel = div('fg-panel fg-lobby fg-live', `<div class="in"><div class="k">${lob.owner ? 'At the start line' : 'Joining the line-up'}</div><div class="who"></div><div class="t"></div>${lob.owner ? '<div class="fg-go">Start now <kbd>Space</kbd></div>' : ''}<div class="esc">Esc · go it alone</div></div>`);
    const who = panel.querySelector('.who') as HTMLElement;
    const tEl = panel.querySelector('.t') as HTMLElement;
    panel.querySelector('.fg-go')?.addEventListener('click', () => lob.startNow());
    root.append(panel);
    let res: CoopRace | null | undefined;
    void lob.result.then((r) => (res = r));
    let sig = '';
    const ok = await this.loop(() => {
      const rows = [{ name: 'You', color: '#7ac050', st: 'in' }, ...lob.joined().map((w) => ({ ...w, st: 'in' })), ...lob.waitingFor().map((w) => ({ ...w, st: 'wait' }))];
      const s2 = rows.map((r) => r.name + r.st).join('|');
      if (s2 !== sig) {
        sig = s2;
        who.innerHTML = rows.map((r) => `<div class="p ${r.st}"><i style="background:${r.color}"></i>${escapeHtml(r.name)}<span>${r.st === 'in' ? '✔ at the line' : '… on the grounds'}</span></div>`).join('');
        if (rows.length > 1) this.sfx('ui:select', 0.8);
      }
      const left = Math.ceil(lob.left());
      tEl.textContent = lob.owner ? `Starting in ${left}s — anyone at the fair can talk to the host to join` : `Waiting for the starter… ${left}s`;
      if (lob.owner && this.hit('Space', 'Enter')) lob.startNow();
      if (this.hit('Escape')) lob.cancel();
      return res !== undefined;
    });
    panel.remove();
    if (!ok) {
      lob.cancel();
      return null;
    }
    return res ?? null;
  }

  private judges = new WeakMap<HTMLElement, { el: HTMLElement | null; k: number }>();
  /** Pop a judgement label (replaces the previous one on this parent; alternates its height). */
  private judge(parent: HTMLElement, text: string, cls: 'p' | 'g' | 'm', x: string, y: string): void {
    const st = this.judges.get(parent) ?? { el: null, k: 0 };
    st.el?.remove();
    const j = div(`fg-judge ${cls}`, text);
    j.style.left = x;
    j.style.top = `calc(${y} - ${(st.k % 2) * 26}px)`;
    parent.append(j);
    st.el = j;
    st.k++;
    this.judges.set(parent, st);
    setTimeout(() => {
      j.remove();
      if (st.el === j) st.el = null;
    }, 720);
  }

  /** A short screen-shake of a panel (misses, stumbles). */
  private shake(el: HTMLElement): void {
    // Restart the CSS animation without a forced reflow (was `void el.offsetWidth`): drop the
    // class now, re-add it on the next frame.
    el.classList.remove('fg-shakeit');
    requestAnimationFrame(() => el.classList.add('fg-shakeit'));
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
    // Few cards (≤ 4): one row of exactly that many equal columns (no empty auto-fill slot).
    if (cards.length <= 4) grid.style.gridTemplateColumns = `repeat(${cards.length}, minmax(0, 1fr))`;
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
      if (n && h.delta > 0) chips.push(`<div class="fg-chip heart"><span class="ci">${portraitSvg(n.look, n.portraitBg, r.noRibbon ? 'neutral' : 'happy')}</span>${shortName(n.name)} · ${friendWord(h.delta, !!r.noRibbon)}</div>`);
    }
    if (r.noRibbon && !chips.length) chips.push(`<div class="fg-chip none">No prize this year</div>`);
    const win = !r.reaction && !r.noRibbon;
    // Each tier has its own emblem: a gold trophy for 1st, blue / red rosettes, a wilted flower below
    // the ribbon line (no prize money, no hearts unless you were already close).
    const art = r.reaction
      ? `<div class="burst">${heartSvg(r.reaction)}</div><div class="tier" style="background:${REACTION[r.reaction].c}">${REACTION[r.reaction].label}</div>`
      : r.noRibbon
        ? `<div class="wilt">${WILT_SVG}</div><div class="tier" style="background:#8a7a6a">No ribbon</div>`
        : r.place === 0
          ? `<div class="trophy">${TROPHY_SVG}</div><div class="tier" style="background:#d89a1a">1st place</div>`
          : `<div class="ros">${rosetteSvg(r.place)}</div><div class="tier" style="background:${r.place === 1 ? '#3f6fd0' : '#c8452f'}">${r.place === 1 ? '2nd' : '3rd'} place</div>`;
    const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
    const boardHtml = (rows: BoardRow[], anim: boolean): string =>
      rows.length > 1
        ? `<div class="fg-board"><div class="h">Farmers today</div>${rows
            .map((e, i) => `<div class="r${e.player === 'local' ? ' me' : ''}" style="${anim ? `animation-delay:${200 + i * 90}ms` : 'animation:none'}"><span class="pl">${e.place < 3 && i < 3 ? miniRosette(i) : '<small>—</small>'}</span><span class="dot" style="background:${e.color ?? (e.player === 'local' ? '#7ac050' : '#b89a7a')}"></span><span>${ORD[i] ?? ''} · ${escapeHtml(e.name)}</span><span class="sc">${e.score > 0 ? e.score.toLocaleString() : '…'}</span></div>`)
            .join('')}</div>`
        : '';
    const boardRows = (): BoardRow[] => (!r.reaction && env.board ? env.board(r) : []);
    const rowsSig = (rows: BoardRow[]): string => rows.map((e) => `${e.player}:${e.score}:${e.place}`).join('|');
    let rows = boardRows();
    let sig = rowsSig(rows);
    const board = boardHtml(rows, true);
    const card = div(`fg-panel fg-result fg-live${r.noRibbon ? ' lose' : ''}`, `<div class="in">${art}<h2>${r.title}</h2><div class="sub">${r.sub}</div><div class="fg-chips">${chips.join('')}</div>${board}<div class="fg-go">Continue <kbd>Space</kbd></div></div>`);
    const big = r.reaction ? r.reaction === 'love' : win && r.place === 0;
    if (win && r.place === 0) {
      // The payoff: rays + a slow-motion title slam, a confetti storm, the whole crowd cheering in 3D
      // and the ribbon pinned to your chest.
      root.append(div('fg-rays'), div('fg-sting', env.def.id === 'sackrace' ? 'CHAMPION!' : '1ST PLACE!'));
    }
    if (win || r.reaction) env.map.playEvent('win', r.reaction ? 0 : r.place);
    else env.map.playEvent('lose', r.place);
    root.append(card);
    if (!r.noRibbon && r.reaction !== 'dislike') this.confetti(root, r.reaction ? [0xff5a7a, 0xffa0b8, 0xffffff, 0xf2d27a] : env.festival.colors, big ? 130 : 40);
    this.sfx(r.noRibbon || r.reaction === 'dislike' ? 'plop' : big ? 'catch:perfect' : 'catch', 1);
    let go = false;
    card.querySelector('.fg-go')!.addEventListener('click', () => (go = true));
    let poll = 0;
    await this.loop((dt, t) => {
      // Co-op: another farmer's own result reaches the board through the host a moment after the
      // card goes up — fold it in live, so every farmer ends up looking at the same standings.
      if ((poll += dt) > 0.4 && env.board && !r.reaction) {
        poll = 0;
        const next = boardRows();
        const s2 = rowsSig(next);
        if (s2 !== sig) {
          sig = s2;
          rows = next;
          const old = card.querySelector('.fg-board');
          const tmp = div('', boardHtml(rows, false));
          if (old && tmp.firstElementChild) old.replaceWith(tmp.firstElementChild);
          else if (tmp.firstElementChild) card.querySelector('.fg-go')?.before(tmp.firstElementChild);
        }
      }
      return hold ? false : env.auto ? t > 4.2 : go || (t > 0.5 && this.hit('Space', 'Enter', 'KeyX', 'KeyF', 'Escape'));
    });
    card.remove();
    root.querySelectorAll('.fg-rays, .fg-sting').forEach((e) => e.remove());
  }

  /** Below the ribbon line: no prize money, and only a partner who already loves you smiles anyway. */
  private sympathy(id: string): { id: string; delta: number }[] {
    const rel = this.game.services.relationships;
    return rel && rel.hearts(id) >= 4 ? [{ id, delta: 5 }] : [];
  }

  // ───────────────────────────────────────────── dance

  private async dance(env: GameEnv): Promise<GameResult | null> {
    const root = this.root!;
    const partner = (env.play.partner ?? 'wren') as NpcId;
    const pn = NPCS[partner];
    const hard = !!env.hard;
    // Encore (you've won before): the fiddler's fast reel — quicker, busier, trickier syncopation.
    const bpm = env.festival.music.tempo * (hard ? 1.18 : 1);
    const beat = 60 / bpm;
    const notes: { t: number; dir: number; el: HTMLDivElement; state: 0 | 1 | 2; off?: boolean }[] = [];
    let seed = hard ? 23 : 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const beats: number[] = [];
    if (!hard) {
      // Chart: 2 bars of warm-up quarter notes, then syncopation, then a flourish.
      for (let b = 0; b < 8; b++) beats.push(b);
      for (let b = 8; b < 20; b++) {
        beats.push(b);
        if (b % 4 === 1 || b % 4 === 3) beats.push(b + 0.5);
      }
      for (let b = 20; b < 28; b += 0.5) if (!(b % 2 === 1.5)) beats.push(b);
      beats.push(28, 29, 30, 30.5, 31);
    } else {
      for (let b = 0; b < 4; b++) beats.push(b);
      for (let b = 4; b < 16; b += 0.5) if (!(b % 4 === 3.5)) beats.push(b);
      for (let b = 16; b < 28; b++) beats.push(b, b + 0.5, ...(b % 2 ? [b + 0.75] : []));
      for (let b = 28; b < 34; b += 0.5) beats.push(b);
      beats.push(34, 34.25, 34.5, 35);
    }
    const lead = 3;
    const first = shortName(pn.name);
    const partnerBar = div('fg-partner fg-panel', `<div class="in" style="display:flex;align-items:center;gap:12px;padding:6px 16px 6px 6px"><div class="pp">${portraitSvg(pn.look, pn.portraitBg, 'happy')}</div><div><div class="nm" style="color:#4a2c14;text-shadow:none">${hard ? 'Encore reel' : 'Dancing'} with ${first}</div><div class="fg-meter"><i></i></div></div></div>`);
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
      if (dir === prevDir && rnd() < (hard ? 0.35 : 0.6)) dir = (dir + 1 + Math.floor(rnd() * 3)) % 4;
      prevDir = dir;
      const el = div('note', blossomSvg(dir));
      lane.append(el);
      notes.push({ t: (b + lead) * beat, dir, el, state: 0 });
    }
    const RING_X = 61;
    const SPEED = hard ? 360 : 300;
    const win = hard ? 0.14 : 0.17;
    let combo = 0;
    let best = 0;
    let score = 0;
    let perfect = 0;
    let good = 0;
    let misses = 0;
    let harmony = 0.5;
    const end = notes[notes.length - 1]!.t + 1.2;
    const codes = [['ArrowLeft', 'KeyA'], ['ArrowUp', 'KeyW'], ['ArrowRight', 'KeyD'], ['ArrowDown', 'KeyS']];
    if (!(await this.countdown(root))) return null;
    env.play.live = true;
    env.play.progress[0] = 0;
    const t0 = performance.now();
    const acc = (): number => (perfect + good * 0.6) / notes.length;
    const miss = (): void => {
      combo = 0;
      misses++;
      harmony = Math.max(0, harmony - 0.06);
      this.judge(panel, 'Oops', 'm', `${RING_X + 25}px`, '-34px');
      this.shake(panel);
      env.map.playEvent('miss', misses);
    };
    const hitNote = (n: (typeof notes)[number], dt: number): void => {
      const p = Math.abs(dt) < (hard ? 0.06 : 0.075);
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
        // Attract mode plays like a skilled dancer (~88 % blooms / sweets, the odd slip): each note is
        // judged directly so a slow frame never turns into a string of misses.
        for (const n of notes) {
          if (n.state !== 0 || t < n.t - 0.01) continue;
          const h = (n.t * 7.31) % 1;
          if (h < 0.06) continue; // a deliberate slip (expires as an Oops)
          keyEls[n.dir]!.classList.add('on');
          setTimeout(() => keyEls[n.dir]!.classList.remove('on'), 110);
          hitNote(n, h < 0.8 ? 0.01 : 0.11);
        }
      } else codes.forEach((c, d) => this.hit(...c) && pressed.push(d));
      for (const d of pressed) {
        keyEls[d]!.classList.add('on');
        setTimeout(() => keyEls[d]!.classList.remove('on'), 110);
        const cand = notes.find((n) => n.state === 0 && Math.abs(n.t - t) < win);
        if (cand && cand.dir === d) hitNote(cand, cand.t - t);
        else if (cand) {
          cand.state = 2;
          cand.el.classList.add('gone');
          this.sfx('ui:error', 0.6);
          miss();
        } else if (!env.auto) {
          // Mashing between notes costs harmony (no free points for spamming).
          harmony = Math.max(0, harmony - 0.03);
          combo = 0;
        }
      }
      // Perf: one layout read per frame (reading clientWidth after each note's style write forced a
      // synchronous reflow per note, ~30 per frame); notes long past the ring stop being restyled.
      const laneW = lane.clientWidth;
      for (const n of notes) {
        if (n.state === 0 && t - n.t > win) {
          n.state = 2;
          n.el.style.opacity = '0.25';
          miss();
        }
        const x = RING_X + (n.t - t) * SPEED;
        const off = x > laneW + 60 || x < -240;
        if (n.state !== 1 && !off) n.el.style.transform = `translateX(${x}px) rotate(${Math.sin((n.t - t) * 5) * 8}deg)`;
        if (n.off !== off) {
          n.off = off;
          n.el.style.display = off ? 'none' : '';
        }
      }
      env.play.progress[0] = acc();
      const comboTxt = String(combo);
      if (comboEl.firstChild!.textContent !== comboTxt) comboEl.firstChild!.textContent = comboTxt;
      const scoreTxt = score.toLocaleString();
      if (scoreEl.textContent !== scoreTxt) scoreEl.textContent = scoreTxt;
      const meterW = `${Math.round(harmony * 100)}%`;
      if (meter.style.width !== meterW) meter.style.width = meterW;
      return t > end;
    });
    env.play.live = false;
    if (!ok) return null;
    const a = acc();
    await this.wait(300);
    panel.remove();
    partnerBar.remove();
    keys.remove();
    const stats = `${perfect} blooms · ${good} sweet · ${misses} oops · best combo ${best}`;
    if (a < 0.4) {
      return {
        place: 3,
        noRibbon: true,
        score,
        gold: 0,
        hearts: this.sympathy(partner),
        title: 'Tangled in the Ribbons!',
        sub: `${stats} — ${first} laughed so hard the fiddler lost the tune. “Again next year?”`,
      };
    }
    const place = a >= 0.85 ? 0 : a >= 0.65 ? 1 : 2;
    return {
      place,
      score,
      gold: Math.round(PRIZES.dance[place]! * (hard ? 1.5 : 1)),
      hearts: [{ id: partner, delta: [120, 80, 40][place]! }],
      title: hard ? ['Encore! Encore!', 'The Fast Reel, Survived', 'Breathless but Standing'][place]! : ['Radiant Dance!', 'A Lovely Dance', 'A Charming Dance'][place]!,
      sub: `${stats} — ${first} ${['is beaming', 'is smiling ear to ear', 'laughed the whole way round'][place]}`,
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
    const THROWS = 5;
    const slots = div('fg-slots', '<i></i>'.repeat(THROWS));
    const streakEl = div('fg-streak', '');
    const hint = div('fg-hint', 'Hold <b>Space</b> to lift · let go inside the glowing swell · the tide quickens');
    root.append(panel, slots, streakEl, hint);
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
    let streak = 0;
    let radiant = 0;
    for (let k = 0; k < THROWS; k++) {
      let v = 0;
      let autoIn = -1;
      let wasHeld = false;
      let released = -1;
      const phase = Math.random() * 6;
      // The swell quickens lantern by lantern (and the last two wander wider).
      const speed = 0.85 + k * 0.32;
      let bandY = 0;
      env.play.live = true;
      const ok = await this.loop((dt, t) => {
        // The swell drifts between 30 % and 80 % of the meter.
        bandY = 0.55 + (k >= 3 ? 0.3 : 0.25) * Math.sin(t * speed + phase) * Math.cos(t * speed * 0.37 + phase * 2);
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
      // A perfect release inside the bright core of the swell chains a streak bonus (+15 per link).
      streak = q === 3 ? streak + 1 : 0;
      if (q === 3) radiant++;
      const bonus = streak >= 2 ? (streak - 1) * 15 : 0;
      const pts = [15, 45, 75, 100][q]! + bonus;
      total += pts;
      best = Math.max(best, q);
      const sl = slots.children[k] as HTMLElement;
      sl.classList.add(q >= 2 ? 'on' : 'dim', `q${q}`);
      streakEl.textContent = streak >= 2 ? `Radiant ×${streak}  +${bonus}` : '';
      this.judge(inner, bonus ? `Radiant ×${streak}!` : ['Sputter…', 'Wobbly', 'Aloft!', 'Radiant!'][q]!, q >= 2 ? 'p' : q === 1 ? 'g' : 'm', '50%', `${H - 46 - released * (H - 106) - 60}px`);
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
    streakEl.remove();
    hint.remove();
    // Out of 500 (+ streak bonuses): ribbon ≥ 185, 2nd ≥ 285, 1st ≥ 415.
    if (total < 185) {
      return {
        place: 3,
        noRibbon: true,
        score: total,
        gold: 0,
        hearts: this.sympathy('marigold'),
        title: 'The Sea Said “Maybe”',
        sub: `“${wishes[w]}” — most of them sputtered on the sand. Marigold relit one for you, very gently.`,
      };
    }
    const place = total >= 415 ? 0 : total >= 285 ? 1 : 2;
    return {
      place,
      score: total,
      gold: PRIZES.lanterns[place]!,
      hearts: [{ id: 'marigold', delta: [60, 40, 20][place]! }],
      title: ['The Sea Says Yes!', 'Five Lanterns Aloft', 'Lanterns on the Tide'][place]!,
      sub: `“${wishes[w]}” — ${['every lantern caught the swell and sailed for the horizon', 'your wishes are bobbing out past the pier', 'they wobbled, but they’re floating. Wishes are stubborn like that'][place]}${radiant >= 3 ? ` (${radiant} radiant — the gold ones lead the flotilla)` : ''}`,
    };
  }

  // ───────────────────────────────────────────── sack race

  private async sackRace(env: GameEnv): Promise<GameResult | null> {
    const root = this.root!;
    // Co-op: farmers at the start line race each other (the lobby owner takes lane 0, joiners the
    // next lanes); villagers fill the free lanes. Racer 0 is always you.
    const race = await this.lineUp(env);
    if (this.aborted) return null;
    const N = 5;
    const lanesOf: number[] = [race?.myLane ?? 0];
    const kinds: ('me' | 'npc' | 'farmer')[] = ['me'];
    const farmer: (CoopRacer | null)[] = [null];
    for (const r of race?.racers ?? []) {
      if (lanesOf.length >= N) break;
      lanesOf.push(r.lane);
      kinds.push('farmer');
      farmer.push(r);
    }
    for (let lane = 0; lanesOf.length < N && lane < N; lane++) {
      if (lanesOf.includes(lane)) continue;
      lanesOf.push(lane);
      kinds.push('npc');
      farmer.push(null);
    }
    env.play.lanes = lanesOf;
    env.play.kinds = kinds;
    env.play.coop = race;
    const npcTints = ['#d8392f', '#3f6fd0', '#f2b928', '#3a8a4a'];
    const panel = div('fg-panel fg-race fg-live', `<div class="in"><div class="keys2"><div class="fg-key">◀</div><div class="fg-key">▶</div></div><div class="bounce"><small>Bounce</small><div class="fg-meter"><i></i></div></div><div class="fg-track"><div class="lanes"></div><div class="fg-flag"></div></div><div class="place">–</div></div>`);
    const lanes = panel.querySelector('.lanes') as HTMLElement;
    const toks: HTMLElement[] = [];
    const rowsEl: HTMLElement[] = [];
    let npcK = 0;
    for (let i = 0; i < N; i++) {
      const l = div('');
      const f = farmer[i];
      const t = div(i === 0 ? 'fg-token me' : f ? 'fg-token me farmer' : 'fg-token', i === 0 ? '<b>YOU</b>' : f ? `<b>${escapeHtml(f.name.slice(0, 5).toUpperCase())}</b>` : '');
      if (f) t.style.borderColor = f.color;
      else if (i) t.style.background = npcTints[npcK++ % npcTints.length]!;
      l.append(t);
      rowsEl.push(l);
      toks.push(t);
    }
    // Rows top → bottom = lanes far → near in 3D (lane 0 is nearest the camera).
    const byLane = rowsEl.map((el, i) => ({ el, lane: lanesOf[i]! })).sort((a, b) => b.lane - a.lane);
    for (const r of byLane) lanes.append(r.el);
    const [kL, kR] = [...panel.querySelectorAll('.keys2 .fg-key')] as HTMLElement[];
    kL!.addEventListener('pointerdown', () => this.keys.pressed.push('ArrowLeft'));
    kR!.addEventListener('pointerdown', () => this.keys.pressed.push('ArrowRight'));
    const meter = panel.querySelector('.bounce i') as HTMLElement;
    const placeEl = panel.querySelector('.place') as HTMLElement;
    root.append(panel);
    const LEN = 25.4;
    const pos = new Array(N).fill(0) as number[];
    /** Finish time on the race clock (s), -1 = still hopping. */
    const finT = new Array(N).fill(-1) as number[];
    // Villager racers: steady hops with the odd wobble (deterministic from the race clock, so every
    // farmer in a shared race sees the same villagers).
    const NPC_SPEEDS = [2.62, 2.48, 2.75, 2.36];
    const npc: { s: number; stumble: number }[] = [];
    for (let i = 0, k = 0; i < N; i++) npc.push(kinds[i] === 'npc' ? { s: NPC_SPEEDS[k % 4]!, stumble: 3 + (k++ + 1) * 1.7 } : { s: 0, stumble: 1 });
    env.play.progress = pos.map(() => 0);
    if (!(await this.countdown(root))) return null;
    env.play.live = true;
    let next: 0 | 1 = 0;
    let last = -1;
    let stun = 0;
    let bounce = 0.5;
    let finishedAt = -1;
    const ok = await this.loop((dt, t) => {
      for (let i = 1; i < N; i++) {
        if (finT[i]! >= 0) continue;
        if (kinds[i] === 'farmer') {
          // Another farmer: their own machine's progress, eased toward the latest 10 Hz sample.
          const smp = race?.sample(farmer[i]!.id);
          if (smp) {
            const goal = smp.p * LEN;
            pos[i] = goal > pos[i]! ? pos[i]! + (goal - pos[i]!) * (1 - Math.exp(-12 * dt)) : goal;
            if (smp.fin >= 0) {
              finT[i] = smp.fin;
              pos[i] = LEN;
            }
          }
          continue;
        }
        const n = npc[i]!;
        const wob = Math.abs(((t + i * 1.3) % n.stumble) - n.stumble / 2) < 0.22 ? 0.2 : 1;
        pos[i] = Math.min(LEN, pos[i]! + n.s * wob * dt * (0.9 + 0.1 * Math.sin(t * 7 + i)));
        if (pos[i]! >= LEN) finT[i] = t;
      }
      // Player hops.
      stun = Math.max(0, stun - dt);
      let press: 0 | 1 | -1 = -1;
      if (env.auto) {
        if (t - last > 0.37 + 0.04 * Math.sin(t * 3) || last < 0) press = next;
      } else if (this.hit('ArrowLeft', 'KeyA')) press = 0;
      else if (this.hit('ArrowRight', 'KeyD')) press = 1;
      if (press >= 0 && finT[0]! < 0) {
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
            finT[0] = t;
            finishedAt = t;
            env.map.playEvent('finish', rankOf(0));
          }
        }
      }
      race?.report(t, pos[0]! / LEN, finT[0]!);
      env.play.hop = last < 0 ? 1 : Math.min(1, (t - last) / 0.3);
      kL!.classList.toggle('next', next === 0 && finT[0]! < 0);
      kR!.classList.toggle('next', next === 1 && finT[0]! < 0);
      meter.style.width = `${Math.round(bounce * 100)}%`;
      placeEl.textContent = ['1st', '2nd', '3rd', '4th', '5th'][rankOf(0)]!;
      for (let i = 0; i < N; i++) {
        env.play.progress[i] = pos[i]! / LEN;
        toks[i]!.style.left = `${(pos[i]! / LEN) * 100}%`;
      }
      // Finished: hold 1.4 s for the others (a farmer a few hops behind still gets placed).
      // Co-op: wait (up to 8 s) for every other farmer to cross, so both machines rank the same finish.
      const farmersOut = farmer.some((f, i) => f && finT[i]! < 0);
      return (finishedAt >= 0 && t - finishedAt > (farmersOut ? 8 : 1.4)) || finT.every((f) => f >= 0) || t > 48;
    });
    /** 0-based place of racer i: finishers by time (ties to the farther lane), then by distance. */
    function rankOf(i: number): number {
      let r = 0;
      for (let j = 0; j < N; j++) {
        if (j === i) continue;
        const fi = finT[i]!;
        const fj = finT[j]!;
        if (fj >= 0 && (fi < 0 || fj < fi || (fj === fi && j < i))) r++;
        else if (fj < 0 && fi < 0 && pos[j]! > pos[i]!) r++;
      }
      return r;
    }
    env.play.live = false;
    if (!ok) return null;
    const place = finT[0]! >= 0 ? rankOf(0) : 4;
    panel.remove();
    const rival = farmer.find((f, i) => f && finT[i]! >= 0 && finT[i]! < finT[0]!) ?? null;
    const beat = farmer.filter((f, i) => f && (finT[i]! < 0 || finT[i]! > finT[0]!)).map((f) => f!.name);
    const coopLine = rival ? ` ${rival.name} out-hopped you — rematch next fall!` : beat.length ? ` You beat ${beat.join(' and ')} to the tape!` : '';
    const rivals: BoardRow[] = farmer.flatMap((f, i) => (f ? [{ player: f.key, name: f.name, color: f.color, place: finT[i]! >= 0 ? Math.min(3, rankOf(i)) : 3, score: finT[i]! >= 0 ? Math.round(1000 - rankOf(i) * 200) : 0 }] : []));
    if (place >= 3) {
      return {
        place,
        noRibbon: true,
        score: Math.round(1000 - place * 200),
        gold: 0,
        hearts: this.sympathy('wren'),
        title: ['', '', '', 'Fourth — Valiant!', 'Last, but Bouncy'][place]!,
        sub: ['', '', '', 'No ribbon, but a round of applause and a cup of cider.', 'Kit says you “hopped with feeling”. The sack says otherwise.'][place]! + coopLine,
        rivals,
      };
    }
    return {
      place,
      score: Math.round(1000 - place * 200),
      gold: PRIZES.sackrace[place]!,
      hearts: [{ id: 'wren', delta: place === 0 ? 60 : 30 }],
      title: ['Sack Race Champion!', 'Second Place!', 'Third Place!'][place]!,
      sub: (race ? ['The whole Commons is chanting your name.', 'So close! A sack-length in it.', 'A bronze-worthy bounce!'] : ['Wren is demanding a rematch. Loudly.', 'Odessa won by a sack-length. She is insufferable about it.', 'A bronze-worthy bounce!'])[place]! + coopLine,
      rivals,
    };
  }

  // ───────────────────────────────────────────── produce judging

  private async judging(env: GameEnv): Promise<GameResult | null> {
    const root = this.root!;
    const inv = this.game.services.inventory;
    type Entry = { id: string; name: string; q: number; score: number; note: string };
    // Judges' card: value (log of the sell price), quality stars, presentation (in season, a full
    // basket). Entries worth under MIN_ENTRY_VALUE are admired politely and scored accordingly.
    const judge = (id: string, q: number, qty: number): { score: number; note: string } => {
      const d = itemDef(id);
      const sell = d?.sell ?? 0;
      if (sell < MIN_ENTRY_VALUE) return { score: Math.round(22 + sell * 0.45 + q * 4), note: 'charming, but a little small for the giants’ table' };
      const crop = (CROPS as Record<string, { seasons: string[] } | undefined>)[id];
      const inSeason = !!crop?.seasons.includes(this.game.calendar.season);
      const basket = qty >= 5;
      const v = 20 + 22 * Math.log10(sell);
      const score = Math.round(Math.min(99, v + q * 8 + (inSeason ? 4 : 0) + (basket ? 3 : 0)));
      const bits = [q ? `${'★'.repeat(q)} quality` : 'honest quality', inSeason ? 'in season' : '', basket ? 'a full basket' : ''].filter(Boolean);
      return { score, note: bits.join(' · ') };
    };
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
      cands.push({ id: s.id, name: d.name, q, ...judge(s.id, q, s.qty) });
    }
    if (env.auto && (!cands.length || Math.max(...cands.map((c) => c.score)) < 80)) {
      // Attract mode: a plausible prize-winning farmer's shortlist.
      cands.length = 0;
      for (const [id, q] of [['pumpkin', 2], ['melon', 1], ['cauliflower', 1], ['sunflower', 0], ['strawberry', 2]] as const) {
        const d = itemDef(id);
        if (d) cands.push({ id, name: d.name, q, ...judge(id, q, 6) });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const list = cands.slice(0, 8);
    const rivals = produceRivals(this.game.calendar.year);
    const top = Math.max(...rivals.map((r) => r.score));
    const topBy = rivals.find((r) => r.score === top)!;
    let mine: Entry;
    if (!list.length) mine = { id: 'stone', name: 'A Very Polished Stone', q: 0, score: 12, note: 'the judges are baffled' };
    else {
      const stars = (q: number): string => (q ? `<span class="star">${'★'.repeat(q)}</span>` : 'Regular');
      const k = await this.pick(env, 'Choose your entry', `Judged on value, quality and presentation. Entries under ${MIN_ENTRY_VALUE}g rarely place — this year's favourite, ${topBy.name.split(' (')[0]}, scores ${top}.`, list.map((c) => `${itemIcon(c.id)}<div class="nm">${c.name}</div><div class="meta">${stars(c.q)}</div>`), 0);
      if (k === null) return null;
      mine = { ...list[k]! };
      // Presentation: the judges favour one touch each year (the hint is the tell).
      const fav = favouredPresentation(this.game.calendar.year);
      const pk = await this.pick(env, 'Present it', PRESENTATIONS[fav]!.hint, [...PRESENTATIONS.map((p) => `<div class="ic">${PRESENT_SVG[p.id]}</div><div class="nm">${p.name}</div>`), `<div class="ic">${PRESENT_SVG.plain}</div><div class="nm">Just as it is</div>`], fav);
      if (pk === null) return null;
      const bonus = pk === fav ? 7 : pk < PRESENTATIONS.length ? 2 : 0;
      mine.score = Math.min(99, mine.score + bonus);
      if (pk < PRESENTATIONS.length) mine.note += ` · ${PRESENTATIONS[pk]!.name.toLowerCase()}${pk === fav ? ' (the judges swooned)' : ''}`;
    }
    env.play.partner = mine.id;
    env.map.playEvent('enter');
    const entries = [...rivals.map((r) => ({ ...r, me: false, icon: '' })), { name: mine.name, by: 'You', score: mine.score, tint: '', me: true, icon: mine.id }];
    // Shuffle the table, but keep yours third.
    const SLOTS = [1, 0, 3, 2];
    const table = SLOTS.map((k) => entries[k]!);
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
      // The judges walk over to that entry in 3D before its card turns.
      env.map.playEvent('judge', SLOTS[i]!);
      if (!(await this.wait(900))) return null;
      cards[i]!.classList.add('open');
      this.sfx('ui:tab', 1.2);
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
    // Ties go to the rival (the judges are loyal to Duchess).
    const ranked = table.map((e, i) => ({ e, i })).sort((a, b) => b.e.score - a.e.score || (a.e.me ? 1 : 0) - (b.e.me ? 1 : 0));
    (panel.querySelector('h3') as HTMLElement).textContent = 'And the ribbons go to…';
    for (let p = 2; p >= 0; p--) {
      if (!(await this.wait(560))) return null;
      const c = cards[ranked[p]!.i]!;
      c.append(div('rib', rosetteSvg(p)));
      env.map.playEvent('rosette', SLOTS[ranked[p]!.i]! + 4 * p);
      this.sfx(p === 0 ? 'bundle' : 'ui:select', 1);
    }
    const place = ranked.findIndex((r) => r.e.me);
    env.map.playEvent('ribbon', place);
    if (!(await this.wait(1500))) return null;
    panel.remove();
    if (place >= 3) {
      return {
        place,
        noRibbon: true,
        score: mine.score,
        gold: 0,
        hearts: this.sympathy('marigold'),
        title: 'Honourable Mention',
        sub: `${mine.score} points — ${mine.note}. ${rivals[2]!.by}'s ${rivals[2]!.name.split(' (')[0]} beat you, and ${rivals[2]!.by} will never, ever let it go.`,
      };
    }
    return {
      place,
      score: mine.score,
      gold: PRIZES.pumpkin[place]!,
      hearts: [{ id: 'marigold', delta: 30 }],
      title: ['Best in Show!', 'Second Prize!', 'Third Prize!'][place]!,
      sub: `${mine.score} points (${mine.note}) — ${[`your ${mine.name.toLowerCase()} beat ${topBy.name.split(' (')[0]}. ${topBy.by} has gone very quiet.`, 'a blue ribbon! Your gran would have pinned it to her hat.', 'a red ribbon for a fine entry!'][place]}`,
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
        nm.textContent = shortName(NPCS[id].name);
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
    if (env.auto) {
      // Attract mode: a festive shortlist that includes something the recipient loves.
      gifts.length = 0;
      const pool = ['strawberry', 'sunflower', 'amethyst', 'pumpkin', 'topaz', 'wool', 'ruby', 'truffle', 'aquamarine', 'melon', 'cauliflower', 'diamond', 'goatMilk', 'emberOpal'].filter((id) => itemDef(id));
      const loved = pool.find((id) => rel?.taste(target, id) === 'love');
      for (const id of [...(loved ? [loved] : []), ...pool.filter((id) => id !== loved)].slice(0, 6)) gifts.push({ id, q: 0 });
    }
    let giftId: string | null = null;
    if (gifts.length) {
      const list = gifts.slice(0, 12);
      const autoPick = Math.max(0, list.findIndex((g) => rel?.taste(target, g.id) === 'love'));
      const c = await this.pick(env, `A present for ${shortName(tn.name)}`, 'Wrap something from your backpack. (They’ll never guess it was you.)', list.map((g) => `${itemIcon(g.id)}<div class="nm">${itemDef(g.id)?.name ?? g.id}</div>`), autoPick);
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
    const react = div('fg-panel fg-draw fg-live', `<div class="in"><div class="pp">${portraitSvg(tn.look, tn.portraitBg, mood)}</div><div class="nm">${shortName(tn.name)}</div><div class="line">“${line}”</div></div>`);
    root.append(react);
    this.sfx(`gift:${reaction}`, 1);
    env.map.playEvent('given', reaction === 'love' ? 3 : reaction === 'like' ? 2 : 1);
    if (!(await this.loop((_dt, t) => (env.auto ? t > 2.2 : t > 0.6 && this.hit('Space', 'Enter', 'KeyX', 'KeyF')) || t > 7))) return null;
    react.remove();
    // 4) Somebody drew you: the present appears in your hands in 3D; unwrap it there (lid pops,
    // ribbon flies, confetti), THEN the card names what was inside.
    const giver = ids.filter((i) => i !== target)[Math.floor(Math.random() * (ids.length - 1))]!;
    const got = STARFALL_GIFTS.filter((g) => itemDef(g))[Math.floor(Math.random() * STARFALL_GIFTS.filter((g) => itemDef(g)).length)] ?? 'topaz';
    env.map.playEvent('gift-appear');
    const prompt = div('fg-hint fg-live', `<b>${shortName(NPCS[giver].name)}</b> drew your name! Press <b>Space</b> to unwrap`);
    root.append(prompt);
    let open = false;
    prompt.addEventListener('click', () => (open = true));
    if (!(await this.loop((_dt, t) => (env.auto ? t > 1.6 : open || (t > 0.4 && this.hit('Space', 'Enter', 'KeyX', 'KeyF')))))) return null;
    prompt.remove();
    env.map.playEvent('unwrap');
    this.sfx('catch:perfect', 0.9);
    if (!(await this.wait(1300))) return null;
    const box = div('fg-panel fg-draw fg-live', `<div class="in"><div class="rl">From ${shortName(NPCS[giver].name)}, with love</div><div class="fg-box"><div class="rays"></div><div class="gift">${itemIcon(got)}</div></div><div class="nm">${itemDef(got)?.name ?? got}</div></div>`);
    box.style.top = '34%';
    root.append(box);
    this.confetti(root, env.festival.colors, 40);
    if (!env.auto) inv?.add(got, 1);
    if (!(await this.wait(1800))) return null;
    box.remove();
    const tier = (reaction === 'love' || reaction === 'like' || reaction === 'dislike' ? reaction : 'neutral') as 'love' | 'like' | 'neutral' | 'dislike';
    const rk = ['love', 'like', 'neutral', 'dislike'].indexOf(tier);
    const tnm = shortName(tn.name);
    return {
      place: rk,
      reaction: tier,
      score: 0,
      gold: 0,
      item: got,
      hearts: [{ id: target, delta: [80, 45, 20, 5][rk]! }],
      title: [`${tnm} Loved It!`, `${tnm} Liked It`, 'A Kind Thought', 'It’s the Thought…'][rk]!,
      sub: `${tnm} ${['can’t stop smiling', 'is delighted', 'thanks you warmly', 'is… being very polite about it'][rk]} · ${shortName(NPCS[giver].name)} wrapped you a ${itemDef(got)?.name ?? 'present'}`,
    };
  }

  // ───────────────────────────────────────────── skate

  private async skate(env: GameEnv): Promise<GameResult | null> {
    const root = this.root!;
    const panel = div(
      'fg-panel fg-skate fg-live',
      `<div class="in"><small class="lap">Lap 1 / 4</small><div class="big">${STAR_SVG}<span>0</span></div><div class="rows"><div>Gates <b class="g">0</b></div><div class="bad">Cracks <b class="c">0</b></div></div><div class="combo"><span>×0</span><small>combo</small></div><div class="ctimer"><i></i></div><div class="fg-meter"><i style="width:0%"></i></div></div>`,
    );
    const hint = div('fg-hint', '<b>↑ ↓</b> steer across the ice · hold <b>Space</b> to push · thread the lantern gates, dodge the cracks');
    root.append(panel, hint);
    const q = (sel: string): HTMLElement => panel.querySelector(sel) as HTMLElement;
    const num = q('.big span');
    const bar = q('.fg-meter i');
    const lapEl = q('.lap');
    const gEl = q('.g');
    const cEl = q('.c');
    const comboEl = q('.combo span');
    const ctimer = q('.ctimer i');
    // Co-op: a shared heat — everyone at the line starts together; their runs show as rows here
    // (their skaters are on the ice through the net layer's own farmer sync).
    panel.style.visibility = 'hidden';
    const race = await this.lineUp(env);
    if (this.aborted) return null;
    panel.style.visibility = '';
    env.play.coop = race;
    const rivals = race?.racers.length ? div('rivals') : null;
    if (rivals) q('.in').append(rivals);
    if (!(await this.countdown(root))) return null;
    env.play.live = true;
    if (env.auto) env.play.stats.auto = 1;
    const st = env.play.stats;
    let last = { stars: 0, gates: 0, cracks: 0, lap: 1 };
    let doneAt = -1;
    const ok = await this.loop((_dt, t) => {
      if (race) {
        if (env.play.done && doneAt < 0) doneAt = t;
        race.report(t, env.play.progress[0] ?? 0, doneAt, [st.stars ?? 0, st.lap ?? 1, st.gates ?? 0]);
        if (rivals && Math.floor(t * 4) !== Math.floor((t - _dt) * 4)) {
          rivals.innerHTML = race.racers
            .map((r) => {
              const smp = race.sample(r.id);
              const txt = !smp ? 'lacing up…' : smp.fin >= 0 ? `done · ★${smp.x[0] ?? 0}` : `lap ${smp.x[1] ?? 1} · ★${smp.x[0] ?? 0}`;
              return `<div><i style="background:${r.color}"></i>${escapeHtml(r.name)}<b>${txt}</b></div>`;
            })
            .join('');
        }
      }
      if (!env.auto) {
        env.play.steer = (this.keys.down.has('ArrowDown') || this.keys.down.has('KeyS') ? 1 : 0) - (this.keys.down.has('ArrowUp') || this.keys.down.has('KeyW') ? 1 : 0);
        env.play.boost = this.keys.down.has('Space') || this.keys.down.has('KeyX');
      }
      const stars = st.stars ?? 0;
      const gates = st.gates ?? 0;
      const cracks = st.cracks ?? 0;
      const lap = st.lap ?? 1;
      if (stars > last.stars) {
        this.sfx('ui:select', 1.1);
        num.parentElement!.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
        this.judge(root, 'Star!', 'p', '50%', '30%');
      }
      if (gates > last.gates) {
        this.sfx('ui:tab', 1.3);
        this.judge(root, (st.combo ?? 0) >= 3 ? `Gate ×${st.combo}!` : 'Gate!', 'g', '50%', '30%');
      }
      if (cracks > last.cracks) {
        this.sfx('ui:error', 0.8);
        this.judge(root, 'Crack!', 'm', '50%', '30%');
        this.shake(panel);
        this.shake(root);
      }
      if (lap > last.lap) this.judge(root, lap === st.laps ? 'Final lap!' : `Lap ${lap}`, 'p', '50%', '22%');
      last = { stars, gates, cracks, lap };
      num.textContent = `${stars} / ${st.starsTotal ?? 0}`;
      lapEl.textContent = `Lap ${lap} / ${st.laps ?? 4}`;
      gEl.textContent = `${gates}/${st.gatesTotal ?? 0}`;
      cEl.textContent = String(cracks);
      comboEl.textContent = `×${st.combo ?? 0}`;
      ctimer.style.width = `${Math.round((st.comboT ?? 0) * 100)}%`;
      bar.style.width = `${Math.round((env.play.progress[0] ?? 0) * 100)}%`;
      return env.play.done;
    });
    env.play.live = false;
    if (!ok) return null;
    panel.remove();
    hint.remove();
    // Skill rating: gates threaded (50 %), stars (30 %), clean ice (20 %).
    const gf = (st.gates ?? 0) / Math.max(1, st.gatesTotal ?? 1);
    const sf = (st.stars ?? 0) / Math.max(1, st.starsTotal ?? 1);
    const clean = 1 - Math.min(3, st.cracks ?? 0) / 3;
    const rating = gf * 0.5 + sf * 0.3 + clean * 0.2;
    const line = `${st.gates}/${st.gatesTotal} gates · ${st.stars}/${st.starsTotal} stars · ${st.cracks} crack${st.cracks === 1 ? '' : 's'} · best combo ×${st.best ?? 0}`;
    if (rating < 0.45) {
      return {
        place: 3,
        noRibbon: true,
        score: Math.round(rating * 100),
        gold: 0,
        hearts: this.sympathy('odessa'),
        title: 'Mostly Upright',
        sub: `${line} — Odessa hands you a cocoa “for the bruises”.`,
      };
    }
    const place = rating >= 0.85 ? 0 : rating >= 0.65 ? 1 : 2;
    return {
      place,
      score: Math.round(rating * 100),
      gold: PRIZES.skate[place]!,
      hearts: [{ id: 'odessa', delta: [50, 30, 15][place]! }],
      title: ['Starlight Skater!', 'Graceful Glide', 'Wobbly but Wonderful'][place]!,
      sub: `${line} — ${['Odessa nodded. Once. That’s a standing ovation.', 'Kit wants lessons.', 'You only fell over artistically.'][place]}`,
    };
  }
}

const COIN = `<svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="15" fill="#f5c542" stroke="#b8861a" stroke-width="2.5"/><circle cx="17" cy="17" r="10" fill="none" stroke="#fff2b0" stroke-width="2"/><text x="17" y="22" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="700" font-size="13" fill="#8a5a10">g</text></svg>`;

const REACTION: Record<'love' | 'like' | 'neutral' | 'dislike', { label: string; c: string }> = {
  love: { label: 'Loved it!', c: '#e8456a' },
  like: { label: 'Liked it', c: '#e8883a' },
  neutral: { label: 'Polite thanks', c: '#8a8a9a' },
  dislike: { label: 'Oh… thank you', c: '#6a7aa0' },
};

/** Heart burst: one big heart + satellites, fuller for warmer reactions. */
function heartSvg(r: 'love' | 'like' | 'neutral' | 'dislike'): string {
  const heart = (x: number, y: number, s: number, c: string, rot = 0): string =>
    `<path transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" d="M0 8 C -14 -4, -22 -14, -12 -22 C -6 -27, 0 -22, 0 -16 C 0 -22, 6 -27, 12 -22 C 22 -14, 14 -4, 0 8 Z" fill="${c}" stroke="#fff" stroke-width="${2.4 / s}"/>`;
  const main = r === 'love' ? '#e8456a' : r === 'like' ? '#f0708a' : r === 'neutral' ? '#c8a8b0' : '#9aa0b8';
  const n = r === 'love' ? 7 : r === 'like' ? 4 : r === 'neutral' ? 2 : 0;
  let sat = '';
  for (let i = 0; i < n; i++) {
    const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2 + 0.3;
    sat += heart(75 + Math.cos(a) * 52, 78 + Math.sin(a) * 44, 0.55 + (i % 2) * 0.2, i % 2 ? '#ffb0c4' : '#ff7a98', (i * 37) % 60 - 30);
  }
  const crack = r === 'dislike' ? '<path d="M75 50 l-6 12 l8 6 l-5 14" stroke="#fff" stroke-width="3" fill="none" stroke-linejoin="round"/>' : '';
  return `<svg viewBox="0 0 150 140">${sat}${heart(75, 84, 2.3, main)}${crack}</svg>`;
}

/** 1st place: a gold loving cup with a laurel and a ribbon bow. */
const TROPHY_SVG = `<svg viewBox="0 0 150 160"><defs><linearGradient id="tg" x1="0" x2="1"><stop offset="0" stop-color="#b8781a"/><stop offset=".35" stop-color="#ffe27a"/><stop offset=".55" stop-color="#f6c63a"/><stop offset="1" stop-color="#9a5e10"/></linearGradient></defs>
<path d="M40 30 C 10 30 12 70 46 74" stroke="#c8901a" stroke-width="9" fill="none"/><path d="M110 30 C 140 30 138 70 104 74" stroke="#c8901a" stroke-width="9" fill="none"/>
<path d="M36 18 H114 C 114 70 100 92 75 96 C 50 92 36 70 36 18 Z" fill="url(#tg)" stroke="#7a4a0c" stroke-width="3"/><ellipse cx="75" cy="18" rx="39" ry="7" fill="#ffe9a0" stroke="#7a4a0c" stroke-width="3"/>
<rect x="68" y="95" width="14" height="22" fill="url(#tg)" stroke="#7a4a0c" stroke-width="3"/><path d="M46 118 H104 L110 140 H40 Z" fill="#6a3a1a" stroke="#3a1c0c" stroke-width="3"/><rect x="58" y="124" width="34" height="9" rx="2" fill="#f6c63a"/>
<path d="M58 38 C 60 64 68 78 75 82" stroke="#fff8d0" stroke-width="5" fill="none" stroke-linecap="round" opacity=".75"/>
<text x="75" y="66" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="700" font-size="26" fill="#7a4a0c">1</text>
<path d="M60 96 L48 150 L60 142 L66 154 L72 100 Z" fill="#d84a3a"/><path d="M90 96 L102 150 L90 142 L84 154 L78 100 Z" fill="#b8302a"/></svg>`;

/** Board row mini rosette (1st gold, 2nd blue, 3rd red). */
function miniRosette(place: number): string {
  const c = [['#f6c63a', '#c8901a'], ['#4a8ad8', '#2a5aa0'], ['#d84a3a', '#a02a1e']][Math.min(place, 2)]!;
  let petals = '';
  for (let i = 0; i < 10; i++) petals += `<ellipse cx="20" cy="9" rx="4.5" ry="7" fill="${i % 2 ? c[0] : c[1]}" transform="rotate(${i * 36} 20 18)"/>`;
  return `<svg viewBox="0 0 40 48"><path d="M14 26 L9 46 L15 42 L18 47 L20 28 Z" fill="${c[1]}"/><path d="M26 26 L31 46 L25 42 L22 47 L20 28 Z" fill="${c[0]}"/>${petals}<circle cx="20" cy="18" r="8" fill="#fff8e0" stroke="${c[1]}" stroke-width="1.5"/><text x="20" y="22" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="700" font-size="10" fill="${c[1]}">${place + 1}</text></svg>`;
}

/** Below the ribbon line: a wilted flower with a sheepish face (petals drooping, one fallen). */
const WILT_SVG = `<svg viewBox="0 0 150 140"><path d="M75 136 q-4 -30 6 -58 q8 -18 -2 -30" stroke="#7a9a4a" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M78 104 q-22 -4 -28 8 q16 6 28 -8z" fill="#8aa85a"/>
<g transform="translate(70 46) rotate(28)">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<ellipse cx="0" cy="-28" rx="10" ry="20" fill="#efe2cc" stroke="#cdbb98" stroke-width="2" transform="rotate(${110 + i * 26})"/>`).join('')}<circle r="21" fill="#d8b050" stroke="#b08a30" stroke-width="3"/>
<path d="M-10 -2 q4 3 8 0 M3 -2 q4 3 8 0" stroke="#5a3218" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M-6 10 q6 -5 12 0" stroke="#5a3218" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M13 -10 q4 6 0 9 q-4 -3 0 -9z" fill="#7ac0e8"/></g>
<ellipse cx="112" cy="128" rx="9" ry="17" fill="#efe2cc" stroke="#cdbb98" stroke-width="2" transform="rotate(70 112 128)"/></svg>`;


function friendWord(delta: number, lost = false): string {
  if (lost) return 'A sympathetic smile';
  return delta >= 100 ? 'Best friends vibes' : delta >= 60 ? 'Friendship ♥♥' : delta >= 30 ? 'Friendship ♥' : 'A warm smile';
}

function stripTags(s: string): string {
  return s.replace(/\[[a-z]+\]\s*/g, '');
}

function escapeHtml(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
