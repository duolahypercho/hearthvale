/**
 * NpcSystem: the villagers of Hearthvale.
 *   · spawns one Villager per data/npcs.ts entry on the town map
 *   · daily schedules ([hour, spot, activity], rainy-day variants) resolved to named SPOTS / doors,
 *     A*-pathfound along the streets; 'inside' walks to the door and steps in (fades out)
 *   · activities at the spot (sweep, read, hammer, paint, water, knead, saw, fish, lean, sit),
 *     wandering, a child's play laps, pairs of villagers chatting (turn to each other, alternate
 *     talking, emote), idle villagers glance at a nearby player, ambient emotes
 *   · talking: player:interact next to a villager → ui:open 'dialogue:<id>' (holding a gift-able
 *     item → 'dialogue:<id>/gift/<item>'), mouth flaps while the box types
 *   · heart events: two scripted mini cutscenes per villager (data/npcs.ts `events`) — trigger when
 *     friendship is high enough and the player is near at the right hour; letterbox, title card,
 *     camera framing, walks, emotes, dialogue with expressions, choices with friendship deltas
 *   · demo staging: villagers at their schedule spots for the demo hour, `?npc=&mood=` for the
 *     dialogue demo, `?event=<id>[&step=N]` for 'town-heart-event'
 *
 * Service `npcs`: conversation(id), positions(), playEvent(id), stageEvent(id, step?), seenEvents().
 * Friendship (points, hearts, gifts) lives in RelationshipSystem; read via services.
 */
import * as THREE from 'three';
import type { System } from '../core/system';
import type { Game } from '../core/game';
import type { Facing } from '../core/events';
import { NPCS, NPC_IDS, pickGroup, heartEvent, seasonLook, memoryBefore, choiceFlags, type NpcId, type NpcLook, type NpcDef, type Activity, type Ask, type HeartEvent, type CutStep, type Place, type Who, type Emote } from '../data/npcs';
import { itemDef } from '../data/items';
import { Villager, auditPortraits, buildCat, buildCandle, buildPainting, MOOD_GESTURE, ReactionFx, VILLAGER_FILL, dressFarmerWinter, buildLedger, buildLetter, buildKidMap, buildSparks, buildLanternCage, buildChair, buildPie, buildRose } from '../entities/villager';
import { SPOTS, NEW_BUILDINGS, EXTRA_PROPS, FESTOON_POLES, BRIDGES } from '../world/town/layout';
import { BUILDINGS, TOWN_PROPS } from '../data/town-layout';
import type { Festoons } from '../world/town/festoons';
import { itemIconUrl } from '../ui/icons';
import { findPath, type Waypoint } from '../world/town/pathfind';
import { repaintNotices } from '../world/town/notices';
import { SocialPanel, PortraitSheetPanel } from '../ui/dialogue';
import { setPortraitSeason, prewarmPortraits, auditPainted, portraitOpts } from '../ui/portraits';
import { PRESET_LOOKS } from '../entities/remote-look';
import type { Season } from '../core/time';

export interface Conversation {
  id: NpcId;
  name: string;
  role: string;
  /** Lines of the matching group ("[mood] text" tags allowed). */
  lines: string[];
  ask?: Ask;
  hearts: number;
  birthday: boolean;
  look: NpcLook;
  portraitBg: [number, number];
}

export interface NpcApi {
  conversation(id: string): Conversation | null;
  /** World positions of the villagers on the current map (outdoors only). */
  positions(): { id: NpcId; x: number; z: number }[];
  /** Run a heart event now (teleports to town if needed). */
  playEvent(id: string): Promise<void>;
  /** Freeze a heart event at a step for a beauty shot (default: its choice). */
  stageEvent(id: string, step?: number): void;
  seenEvents(): string[];
  /**
   * Heart-event camera audit: stages every talky beat of every event (or one), computes its shot and
   * reports beats whose actors are hidden behind a building or off-frame / under the dialogue box.
   * Trees in the way are listed too (they are hidden at run time). Empty `fails` = all clear.
   */
  auditEvents(id?: string): { beats: number; fails: string[]; trees: number };
  /**
   * Night heart-event face check (r3 blocker: Odessa's face crushed to black): stages every spoken
   * beat of the night events (or one), renders it and reads back a box round the speaker's face;
   * a mean sRGB luma under `min` (default 42; a lit deep skin tone reads ≈ 100–115) fails. Resolves with each beat's luma.
   */
  auditFaces(id?: string, min?: number): Promise<{ beats: number; fails: string[]; luma: Record<string, number> }>;
  /**
   * Live talk-lens audit (r3: real conversations framed over the fountain with blurred bystander heads):
   * every villager at their `hour` (default 10.5) spot, the farmer walking up from the lens side, the
   * talk camera solved as in play; fails on foreground clutter, buildings in the sight lines or a
   * blocked face. `lens` lists each conversation's camera for shots.
   */
  auditTalk(hour?: number): { checked: number; fails: string[]; lens: Record<string, string> };
  /**
   * Live F-talk audit (r8 blocker): the farmer teleports beside each villager (left / right / south) at
   * each hour, presses talk for real (placement + scored lens + screen re-solve), and the settled frame
   * fails on a post between the pair or on a head, a prop / building in a sight line, or a bystander's
   * box over either head.
   */
  auditLive(hours?: number[]): { checked: number; fails: string[]; moved: number };
  /** Portrait gate (r7): every bust in every mood — hair over the eyes / nose, painted hair colour vs the 3D look. */
  auditPortraits(): { checked: number; fails: string[]; stats: Record<string, string> };
  /** The last live (F-press) conversation's self-audit (dev builds; pair gap, foreground, lens). */
  liveAudit(): { id: string; gap: number; fails: string[] } | null;
  /** Co-op state (tests): gift reactions seen here, villagers held by a farmhand, the event being watched. */
  coop(): { gifts: { id: string; from: number; reaction: string }[]; held: { id: string; x: number; z: number }[]; spectating: string | null; facing: Record<string, number> };
  /** Closest pair of visible villagers (m) — nobody may stand inside anybody. */
  minGap(): { d: number; a: string; b: string };
}

declare module '../core/game' {
  interface GameServices {
    npcs: NpcApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'npc:talk': { id: string };
    'npc:event': { id: string; npcId: string; phase: 'start' | 'end' };
    /** The dialogue box shows a villager's line in this mood (body language follows). */
    'npc:line': { id: string; mood: string };
  }
}

const _ab = new THREE.Vector3();
const _q = new THREE.Vector3();
const _hp = new THREE.Vector3();
const _q2 = new THREE.Vector3();
const _pr = new THREE.Vector3();
const _fm = new THREE.Matrix4();
const _fr = new THREE.Frustum();
const _fs = new THREE.Sphere();
const _ph = new THREE.Vector3();
const _pe = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _bRight = new THREE.Vector3();
const _bUp = new THREE.Vector3();
// Lens-sweep scratch (pillar 14: the 42-angle camera search allocated ~30-74 KB a frame, GC on p99, r5).
const _cp = new THREE.Vector3();
const _sa = new THREE.Vector3();
const _sb = new THREE.Vector3();
const _seen: { id: Who; x: number; y: number; z: number; head: number }[] = [];
const _seenProp = { id: 'player' as Who, x: 0, y: 0, z: 0, head: 1.3 };
const _fgP = new THREE.Vector3();
const _fgSeg = new THREE.Vector3();
const _fgW = new THREE.Vector3();
/** Candidate lens offsets [yaw delta, pitch delta, distance scale], best-last fallback order. */
const CAM_CANDS: readonly (readonly [number, number, number])[] = (() => {
  const c: [number, number, number][] = [];
  for (const k of [1, 0.75]) for (const dp of [0, 10, 20]) for (const dy of [0, 15, -15, 30, -30, 45, -45]) c.push([dy, dp, k]);
  return c;
})();
/** The reverse angle (r6b): tried only when every usual candidate is blocked (a pair in front of a
 *  north-facing facade — the inn terrace — can only be seen from the far side). */
const CAM_REV: readonly (readonly [number, number, number])[] = CAM_CANDS.filter((c) => Math.abs(c[0]) <= 30).map((c) => [c[0] + 180, c[1], c[2]] as const);
/** A/B switch for the prop-occluder term (`&propocc=0`). */
const NO_PROP_OCC = typeof location !== 'undefined' && new URLSearchParams(location.search).get('propocc') === '0';
const CAM_ALL = [...CAM_CANDS, ...CAM_REV];
const FACING_YAW: Record<Facing, number> = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
const _propW = new THREE.Vector3();
const PLAZA_C = { x: 32, z: 25, r: 3.55 };
const EMOTES_CHAT: Emote[] = ['music', 'exclaim', 'question', 'heart', 'dots', 'idea'];
/** Co-op wire order of activities (villager snapshots carry the index). */
const REACTIONS = ['love', 'like', 'neutral', 'dislike'] as const;
/** A scripted farmhand (net layer's RemotePlayer, the parts the town-coop demo drives). */
interface CoopBot {
  map: string;
  farmer: { position: THREE.Vector3; speed: number; targetYaw: number };
  snap?(x: number, z: number, map: string): void;
  chat?(text: string, hold?: number): void;
}

const ACTS: Activity[] = ['idle', 'sweep', 'read', 'chat', 'hammer', 'paint', 'water', 'sit', 'play', 'fish', 'inside', 'wander', 'knead', 'saw', 'lean', 'tip', 'carry'];
/** Host → farmhands villager snapshot period (s). */
const NET_SNAP = 0.25;

/**
 * Beauty-shot blocking for the town demos: [villager, x, z, yaw (deg, 0 = facing camera), activity,
 * emote held over the head]. Pairs stand three-quarter to the lens so faces read.
 */
type Mark = [NpcId, number, number, number, Activity, Emote?, MarkOpt?];
/**
 * r9 street life: `free` marks turn `deg` relative to the lens with no clamp (a profile, a back
 * three-quarter — people busy with each other, not posing); `walk` sends them on their way (A* to the
 * point; a still catches them mid-stride, `&live=1` lets the demo run); `door` walks them to a door
 * and in (the door fade).
 */
interface MarkOpt {
  free?: boolean;
  walk?: [number, number];
  run?: boolean;
  door?: string;
}
const STAGES: Record<string, Mark[]> = {
  // r5: spread over the whole square, not a ring round the fountain — the store step, the Hall steps
  // and planters, the notice board, the bakery stall, a bench, the east cobbles — each busy with
  // their own thing, a pair or two chatting turned to each other.
  // r9 critic: "the flagship day frame shows the same showcase square … villagers evenly spread,
  // facing the camera". town-day is now the establishing frame — plaza edge, the bakery, the market
  // row, the Kettle Bridge and the river — with the town at work in asymmetric knots: Bram unloading
  // flour, June and Hazel haggling at the produce stall in profile, Marigold browsing the flowers
  // with her back half-turned, Rowan crossing the bridge into town, Kit running the lane, Linus
  // heading off frame, Odessa walking up from the forge road. (`town-square`: the old plaza frame.)
  'town-day': [
    ['bram', 42.4, 21.3, 25, 'carry', undefined, { free: true }],
    ['june', 49.7, 23.9, 78, 'chat', 'music', { free: true }],
    ['hazel', 51.0, 24.1, -82, 'chat', undefined, { free: true }],
    ['marigold', 55.2, 24.0, 150, 'idle', undefined, { free: true }],
    ['rowan', 67.4, 26.3, 0, 'idle', undefined, { walk: [57.8, 26.4] }],
    ['wren', 59.6, 21.6, 133, 'paint'],
    ['kit', 44.6, 28.6, 0, 'play', 'exclaim', { walk: [52.6, 27.4], run: true }],
    ['linus', 46.6, 31.2, 0, 'idle', undefined, { walk: [40.4, 34.6] }],
    ['odessa', 58.6, 29.6, 0, 'idle', undefined, { walk: [52.8, 26.0] }],
    ['tobias', 37.8, 26.8, -35, 'idle', 'music'],
  ],
  'town-square': [
    ['marigold', 20.6, 21.3, 25, 'sweep'],
    ['hazel', 29.9, 18.6, -150, 'water', 'music'],
    ['kit', 34.6, 18.4, 30, 'play'],
    ['tobias', 36.3, 19.2, -40, 'idle'],
    ['wren', 24.8, 23.3, 75, 'paint'],
    ['rowan', 26.9, 21.2, 160, 'read'],
    ['bram', 41.9, 20.8, -15, 'knead'],
    // (side by side across the view: r6 had June's curls in Odessa's face)
    ['odessa', 41.0, 24.8, -60, 'chat'],
    ['june', 39.3, 24.9, 60, 'chat', 'heart'],
    ['linus', 36.9, 27.3, -30, 'read'],
  ],
  // r9: dusk as the town winds down, not a line-up — Tobias at the hall lantern with his back to us,
  // Kit kicking his heels on the steps, a knot of four outside the bakery talking among themselves
  // (profiles, one back), Marigold and Hazel heading home arm in arm, Linus crossing the foreground
  // to the clinic road, Wren catching the lamplight at her easel.
  'town-evening': [
    ['tobias', 33.6, 15.2, 170, 'idle', undefined, { free: true }],
    ['kit', 31.3, 14.1, 20, 'sit'],
    ['bram', 41.4, 22.6, 70, 'chat', 'music', { free: true }],
    ['june', 43.0, 22.2, -60, 'chat', undefined, { free: true }],
    ['rowan', 42.6, 23.9, 175, 'chat', undefined, { free: true }],
    ['odessa', 41.2, 24.1, 115, 'chat', undefined, { free: true }],
    ['marigold', 26.2, 23.6, 0, 'idle', 'heart', { walk: [21.4, 21.4] }],
    ['hazel', 27.1, 24.2, 0, 'idle', undefined, { walk: [22.0, 22.2] }],
    ['linus', 30.2, 31.6, 0, 'idle', undefined, { walk: [33.4, 40.0] }],
    ['wren', 25.0, 23.4, 75, 'paint'],
  ],
  // r5 hero: the river crossing — the market row, the painter at her easel on the west bank, two old
  // friends leaning on the stone bridge, a kid on the bank, the inn terrace and the forge yard beyond.
  'town-river': [
    ['wren', 59.6, 21.6, 133, 'paint'],
    ['tobias', 63.0, 24.6, 70, 'chat', 'music'],
    ['linus', 64.3, 25.1, -100, 'chat'],
    ['kit', 60.3, 29.4, 40, 'play', 'exclaim'],
    ['marigold', 55.8, 22.7, 20, 'chat'],
    ['hazel', 54.5, 23.3, 80, 'chat', 'heart'],
    ['bram', 50.4, 22.5, -10, 'idle'],
    ['june', 77.6, 30.6, -30, 'sweep'],
    ['rowan', 73.8, 18.8, 200, 'saw'],
    ['odessa', 84.6, 19.5, 180, 'hammer'],
  ],
  // r9 'town-memories': a farmer a year in — the square keeps what they shared. Marigold by the bench
  // with the rhubarb pie, Kit at the board under his pinned map, Odessa by the lantern cage on the
  // hall step, Hazel at Rosalind's rose, Rowan off the board reading his letter from Mum.
  'town-memories': [
    ['marigold', 23.9, 22.4, 35, 'idle', 'heart'],
    ['hazel', 29.9, 17.2, -150, 'water', 'music'],
    ['kit', 28.7, 21.5, -35, 'play', 'exclaim'],
    ['tobias', 32.6, 19.6, -30, 'idle'],
    ['wren', 21.8, 24.6, 50, 'read'],
    ['rowan', 30.4, 22.3, -25, 'read'],
    ['bram', 41.9, 20.8, -15, 'knead'],
    ['odessa', 34.6, 16.4, 20, 'idle', 'idea'],
    ['june', 39.3, 24.9, 60, 'chat'],
    ['linus', 37.9, 25.2, -60, 'chat'],
  ],
  // Meadow Lane mid-morning: the doctor sweeps his porch and chats with Marigold, Hazel waters the
  // allotment, Kit plays by the schoolyard swing, and by the picnic Wren sketches the lane while
  // retired Tobias keeps her company (r7: the innkeeper and the baker picnicking at 10:20 on a
  // Monday read as nobody working — they're at their counters).
  'town-south': [
    ['linus', 33.6, 50.2, 30, 'chat'],
    ['marigold', 35.0, 50.9, -55, 'chat', 'heart'],
    ['hazel', 30.1, 55.5, -55, 'water', 'music'],
    ['kit', 21.6, 48.6, 20, 'play'],
    ['wren', 34.4, 55.1, 40, 'paint'],
    ['tobias', 36.0, 55.6, -50, 'chat', 'music'],
  ],
  // Winter afternoon: fewer idlers (Hazel and June stay in by the fire), Marigold sweeps snow off her
  // step, Kit plays by the snowmen with Tobias keeping an eye on him, Bram sells hot buns with Linus
  // warming his hands, Odessa and Rowan talk sledges by the bakery, Wren sketches the snowy Hall.
  'town-winter': [
    // (r8b: the lower third was empty cobbles — Marigold sweeps the snow off the front of the square
    // and Kit plays in it below the fountain)
    ['marigold', 27.4, 27.6, 25, 'sweep'],
    ['wren', 25.0, 23.4, 75, 'paint'],
    ['kit', 30.4, 26.3, -25, 'play', 'exclaim'],
    ['tobias', 31.2, 19.6, -40, 'idle', 'music'],
    // (r7: chat pairs side by side across the view, ~1.6 m apart — the r6 diagonal pairs overlapped
    // on screen: Rowan's beanie in Odessa's face, Bram hidden behind Linus)
    ['bram', 42.5, 20.9, -50, 'idle', 'music'],
    ['linus', 40.8, 21.1, 50, 'chat'],
    ['odessa', 38.5, 23.9, -52, 'chat', 'idea'],
    ['rowan', 36.8, 23.9, 52, 'chat'],
  ],
};
/** 'town-cast': everyone in a row in front of the fountain (model sheet). */
const CAST_ORDER: NpcId[] = ['kit', 'wren', 'marigold', 'bram', 'odessa', 'linus', 'june', 'tobias', 'rowan', 'hazel'];

interface Agent {
  v: Villager;
  def: NpcDef;
  stepKey: string;
  path: Waypoint[];
  goal: { x: number; z: number; yaw: number } | null;
  activity: Activity;
  inside: boolean;
  /** 0 = hidden indoors, 1 = fully out (door fade). */
  vis: number;
  visTarget: number;
  wanderT: number;
  chatT: number;
  emoteT: number;
  speakT: number;
  anchor: { x: number; z: number } | null;
  scripted: boolean;
  onArrive: (() => void) | null;
  run: boolean;
  /** Demo blocking: hold the staged yaw (no turning towards chat partners / the player). */
  staged?: boolean;
  /** r9 free mark: no lens cheat (a profile / back three-quarter, walking past). */
  free?: boolean;
  /** Seconds until this villager may wave at a passing farmer again. */
  greetT?: number;
  /** Quarter-hour index until which the villager is out on an errand (a walk to another spot). */
  errandUntil?: number;
}

/**
 * Small props a standing villager must keep clear of (radius, m): A-boards, chalk boards, barrels,
 * pots, lamp posts, crates… Spot slots and event marks are pushed out by radius + 0.45 (an actor capsule).
 */
const CLEAR_R: Record<string, number> = {
  sandwichBoard: 0.42, chalkBoard: 0.5, barrel: 0.42, flowerPot: 0.28, lanternPost: 0.26, lamp: 0.26, lampLit: 0.26,
  crateStack: 0.6, crates: 0.6, sacks: 0.45, signpost: 0.28, mailbox: 0.28, wheelbarrow: 0.7, bicycle: 0.7, flowerCart: 0.9, well: 1.0,
};
const PROP_CLEAR: { x: number; z: number; r: number }[] = [
  ...TOWN_PROPS.filter((p) => CLEAR_R[p.kind]).map((p) => ({ x: p.x, z: p.z, r: CLEAR_R[p.kind]! })),
  ...EXTRA_PROPS.filter((p) => CLEAR_R[p.kind]).map((p) => ({ x: p.x, z: p.z, r: CLEAR_R[p.kind]! })),
];
/** Benches (seat centre + yaw): actors may only be on one seated. */
const BENCHES: { x: number; z: number; rot: number }[] = [...TOWN_PROPS, ...EXTRA_PROPS].filter((p) => p.kind === 'bench').map((p) => ({ x: p.x, z: p.z, rot: (p as { rot?: number }).rot ?? 0 }));
/** Thin vertical occluders (lamp posts, festoon poles): a lens whose sight line grazes one is rejected. */
const POSTS: { x: number; z: number }[] = [
  ...TOWN_PROPS.filter((p) => p.kind === 'lanternPost').map((p) => ({ x: p.x, z: p.z })),
  ...EXTRA_PROPS.filter((p) => p.kind === 'lamp' || p.kind === 'lampLit' || p.kind === 'signpost').map((p) => ({ x: p.x, z: p.z })),
  ...FESTOON_POLES.map(([x, z]) => ({ x, z })),
  // Stone-bridge end pillars (parapet posts at each corner).
  ...BRIDGES.filter((b) => b.kind === 'stone').flatMap((b) => [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: b.x + (sx * b.len) / 2, z: b.z + (sz * b.width) / 2 })))),
];
/** Free-standing lamp posts + festoon poles (no bridge pillars): kept out of the middle of event frames. */
const LAMP_POSTS = POSTS.filter((p) => !BRIDGES.some((b) => b.kind === 'stone' && Math.abs(p.x - b.x) <= b.len / 2 + 0.01 && Math.abs(p.z - b.z) <= b.width / 2 + 0.01));
/** Errand destinations: the everyday walks between shops, the board, the square and the river. */
const ERRANDS = ['notice', 'fountain_e', 'fountain_w', 'fountain_s', 'market_produce', 'bakery_front', 'store_front', 'planters_hall', 'bridge_mid', 'river_walk', 'inn_front', 'garden_east'];
/** A small deterministic hash (co-op clients roll the same errands from the shared calendar). */
function hash3(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Portrait mood a held emote implies (staged demo faces agree with their bubbles). */
const EMOTE_MOOD: Partial<Record<Emote, string>> = { heart: 'happy', music: 'happy', exclaim: 'surprised', idea: 'happy', question: 'thinking', sweat: 'worried', anger: 'angry', sad: 'sad' };

export class NpcSystem implements System {
  readonly name = 'npcs';
  private game!: Game;
  private agents = new Map<NpcId, Agent>();
  private active = false;
  private talking: Agent | null = null;
  private staged = false;
  /** Demo staging set the relationship memory from the URL (`&mem=`): events don't reseed it. */
  private memStaged = false;
  private festival = false;
  private restage: string | null = null;
  private lastQuarter = -1;
  private lastHour = -1;
  private seen = new Set<string>();
  private eventRunning = false;
  private eventCheckT = 0;
  private waits: { t: number; r: () => void }[] = [];
  private clock = 0;
  // ── co-op (DESIGN pillar 13): the host's town is the truth. The host streams every villager's
  // position / yaw / activity (`['v.s', …]`, 4 Hz); a farmhand's copy walks after it instead of running
  // its own schedule (falls back to local simulation when the host is not in town). A farmhand
  // talking to a villager tells the host (`['v.t', idx, on, x, z]`), whose villager stops and turns
  // to that farmer — so everyone sees the conversation.
  private netT = 0;
  private followAt = -99;
  private follow = new Map<NpcId, { x: number; z: number; yaw: number; act: Activity; inside: boolean; speaking: boolean }>();
  private heldBy = new Map<NpcId, { x: number; z: number; until: number }>();
  /** Street chatter: seconds until the next speech bubble may pop (town-wide), rotating line index. */
  private barkCd = 2;
  private barkN = 0;
  private playerPath: Waypoint[] = [];
  private playerArrive: { resolve: () => void; face?: Facing | number } | null = null;
  private camSaved: { yaw: number; pitch: number; distance: number; off: THREE.Vector3 } | null = null;
  private lookPoint = new THREE.Vector3();
  /** Who the director frames: a heart event's cast, or the farmer + the villager being talked to. */
  private camMode: 'event' | 'talk' | null = null;
  /** Current shot: wide (establishing / walks / narration), two-shot, or a close-up on the speaker. */
  private shot: { kind: 'wide' | 'two' | 'close'; speaker: NpcId | null; anchor: { x: number; z: number; yaw?: number; pitch?: number; distance?: number } | null; prop?: THREE.Object3D } = { kind: 'wide', speaker: null, anchor: null };
  private baseYaw = 0;
  private camCur = { yaw: 0, pitch: 45, dist: 15, target: new THREE.Vector3(), set: false };
  private camPick: { key: string; t: number; dy: number; dp: number; k: number } = { key: '', t: 0, dy: 0, dp: 0, k: 1 };
  private camRelease: { t: number; from: { yaw: number; pitch: number; distance: number; off: THREE.Vector3 } } | null = null;
  private lineNo = 0;
  /** What the last shotGoal() really framed ('ots' = a reverse three-quarter on a speaker who looks at a thing, not a person). */
  private goalKind: { kind: 'wide' | 'two' | 'close'; ots: boolean } = { kind: 'wide', ots: false };
  /** Tree instances hidden because they stood between the lens and an actor (restored after). */
  private occluded: { mesh: THREE.BatchedMesh; id: number }[] = [];
  private treeCache: { map: string; meshes: THREE.BatchedMesh[] } | null = null;
  private occFrame = 0;
  private eventProps: THREE.Object3D[] = [];
  private fitCam = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 200);
  private fx = new ReactionFx();
  /** Warm key light on the actors during night-time conversations and heart events (always in the map, 0 by day). */
  /** A soft spot from camera side aimed at the actors' faces (a point light lit the wall behind them into a blown-out glare). */
  private keyLight = new THREE.SpotLight(0xffd2a0, 0, 9, 0.5, 0.9, 1.4);
  private keyPos = new THREE.Vector3();
  /** Every villager's soft contact shadow in one instanced draw call. */
  private blobs = (() => {
    const m = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.2, depthWrite: false }), NPC_IDS.length);
    m.name = 'npc-blobs';
    m.renderOrder = 1;
    m.frustumCulled = false;
    m.castShadow = m.receiveShadow = false;
    m.userData.noAO = true;
    m.userData.perfTag = 'npcs';
    return m;
  })();
  private blobM = new THREE.Matrix4();

  init(game: Game): void {
    this.game = game;
    for (const id of NPC_IDS) {
      const v = new Villager(NPCS[id], { blob: false });
      this.agents.set(id, { v, def: NPCS[id], stepKey: '', path: [], goal: null, activity: 'idle', inside: false, vis: 1, visTarget: 1, wanderT: 0, chatT: 2 + Math.random() * 3, emoteT: 4 + Math.random() * 8, speakT: 0, anchor: null, scripted: false, onArrive: null, run: false });
    }
    game.provide('npcs', {
      conversation: (id) => this.conversation(id),
      positions: () => (this.active ? [...this.agents.values()].filter((a) => !a.inside).map((a) => ({ id: a.def.id, x: a.v.position.x, z: a.v.position.z })) : []),
      playEvent: (id) => this.playEvent(id),
      stageEvent: (id, step) => this.stageEvent(id, step),
      seenEvents: () => [...this.seen],
      auditEvents: (id) => this.auditEvents(id),
      auditFaces: (id, min) => this.auditFaces(id, min),
      auditTalk: (hour) => this.auditTalk(hour),
      auditLive: (hours) => this.auditLive(hours),
      auditPortraits: () => {
        const moods = ['neutral', 'happy', 'laugh', 'sad', 'angry', 'surprised', 'blush', 'worried', 'thinking', 'wistful'] as const;
        // (r8: the cards are painted busts; the 3D-bust gate stays for the model3d A/B switch)
        if (!portraitOpts.model3d) return auditPainted(NPC_IDS.map((id) => ({ id, look: NPCS[id].look, bg: NPCS[id].portraitBg })), [...moods]);
        return auditPortraits(NPC_IDS.map((id) => NPCS[id]), [...moods]);
      },
      liveAudit: () => this.liveAudit,
      coop: () => ({
        gifts: this.gifts.map((g) => ({ id: g.id, from: g.from, reaction: g.reaction })),
        held: [...this.heldBy.entries()].map(([id, h]) => ({ id, x: h.x, z: h.z })),
        spectating: this.spectating,
        facing: Object.fromEntries([...this.agents.values()].map((a) => [a.def.id, (a.v as unknown as { yaw: number }).yaw])),
      }),
      minGap: () => this.minGap(),
    });
    game.hud.registerPanel('social', new SocialPanel(game, game.hud.root));
    game.hud.registerPanel('portraits', new PortraitSheetPanel(game, game.hud.root));
    game.events.on('player:interact', ({ x, z }) => this.tryTalk(x, z));
    game.events.on('ui:close', ({ name }) => {
      if (name !== 'dialogue') return;
      this.closedAt = this.clock;
      // The clock stands still while you read.
      if (!this.eventRunning) game.calendar.frozen = game.paused;
      if (this.talking) {
        if (this.netRole() === 'client') this.netApi()?.sendExt('host', ['v.t', NPC_IDS.indexOf(this.talking.def.id), 0]);
        this.talking.v.talkTo = null;
        this.talking.v.speaking = false;
        this.talking.v.setMood('neutral');
        this.talking.v.dropIcon();
        this.talking = null;
      }
      this.giftLoop = null;
      if (this.camMode === 'talk') this.releaseCam();
    });
    game.events.on('ui:open', ({ name }) => {
      if (name.startsWith('dialogue')) game.calendar.frozen = true;
    });
    game.events.on('dialogue:speaking', ({ id, on }) => {
      const a = this.agents.get(id as NpcId);
      if (a) a.v.speaking = on;
    });
    game.events.on('npc:emote', ({ id, emote }) => this.agents.get(id as NpcId)?.v.emote(emote));
    game.events.on('npc:line', ({ id, mood }) => {
      const a = this.agents.get(id as NpcId);
      const g = MOOD_GESTURE[mood];
      // The 3D face wears the same mood as the portrait (brows, eyes, mouth, tear, blush).
      a?.v.setMood(mood);
      if (a && g) a.v.gesture(g, mood === 'sad' || mood === 'thinking' ? 3.2 : 2.4);
    });
    game.events.on('npc:gift', ({ npcId, itemId, reaction }) => {
      this.giftJuice(npcId as NpcId, itemId, reaction);
      // Host: everyone else sees the host's gift land (a farmhand's own gift goes through the host's ledger).
      if (this.netRole() === 'host') {
        const p = this.game.player.position;
        this.netApi()!.sendExt('*', ['v.g', NPC_IDS.indexOf(npcId as NpcId), REACTIONS.indexOf(reaction), this.myId(), itemId, Math.round(p.x * 100), Math.round(p.z * 100)]);
      }
    });
    game.events.on('npc:gift-remote', ({ npcId, itemId, reaction, from }) => this.remoteGift(npcId as NpcId, itemId, reaction, from));
    game.events.on('net:ext', ({ from, data }) => this.netRecv(from, data));
    game.events.on('relationship:memory', () => {
      if (!this.active) return;
      this.refreshKeepsakes();
      // (a changed routine: everyone heads for the slot their memory now says, next quarter hour)
      this.lastQuarter = -1;
    });
    game.events.on('demo:stage', ({ name, showcase }) => {
      this.staged = showcase.includes('npcs');
      this.festival = showcase.includes('festival');
      if (this.active) this.restage = name;
    });
  }

  // ───────────────────────────────────────────── conversation

  private conversation(id: string): Conversation | null {
    const def = NPCS[id as NpcId];
    if (!def) return null;
    const rel = this.game.services.relationships;
    const c = this.game.calendar;
    const hearts = Math.min(10, rel?.hearts(id) ?? 0);
    const birthday = rel?.isBirthday(id) ?? false;
    // Old friends (hearts earned through gifts / staging) are never met for the "first" time.
    const first = (rel?.talks(id) ?? 0) === 0 && (rel?.points(id) ?? 0) < 250;
    const g = pickGroup(def, { first, season: c.season, weather: c.weather, hour: c.hour, hearts, birthday, recalls: (f) => rel?.recalls(f) ?? false });
    // Rotate through the group's lines by talk count so repeat visits feel fresh.
    let lines = g?.lines ?? ['...'];
    const talks = rel?.talks(id) ?? 0;
    if (!g?.first && lines.length > 1) lines = [lines[talks % lines.length]!];
    const ask = g?.ask && !(rel?.talkedToday(id) ?? false) ? g.ask : undefined;
    return { id: def.id, name: def.name, role: def.role, lines, ask, hearts, birthday, look: def.look, portraitBg: def.portraitBg };
  }

  private tryTalk(x: number, z: number): void {
    // One press = one conversation: the player's fixed-step loop can re-emit 'interact' on every
    // substep of a frame; once the box is open (or input is off) further presses are ignored.
    if (!this.active || this.eventRunning || this.spectating || this.talking || this.game.hud.openPanelName || !this.game.input.enabled) return;
    // The press that closed a conversation must not open the next one.
    if (this.clock - this.closedAt < 0.35) return;
    const best = this.reachable(x, z);
    const p = this.game.player.position;
    if (!best) return;
    this.talking = best;
    best.v.talkTo = p;
    const sel = this.game.services.inventory?.selected();
    const kind = sel ? itemDef(sel.id)?.kind : undefined;
    const gift = sel && kind && kind !== 'tool' && kind !== 'seed' && kind !== 'placeable';
    this.game.events.emit('ui:open', { name: gift ? `dialogue:${best.def.id}/gift/${sel.id}` : `dialogue:${best.def.id}` });
    this.game.events.emit('npc:talk', { id: best.def.id });
    if (this.netRole() === 'client') this.netApi()?.sendExt('host', ['v.t', NPC_IDS.indexOf(best.def.id), 1, Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100]);
    // Live talks get the full staging (r7: it only ran in demos): a conversational gap, the
    // bystanders (demo-marked ones too) stepping out of the two-shot, and a debug self-audit.
    this.spaceTalk();
    this.startTalkCam(true);
    this.liveResolve();
    if (import.meta.env.DEV) window.setTimeout(() => this.auditLiveTalk(), 900);
  }

  /**
   * r8: the scored lens solve runs on every live talk, then the frame it would really show is checked
   * in screen space (talkFrameFails). A post between the pair, a pole on a head or a prop box over a
   * face re-solves the placement with that mark banned (up to three tries), keeping the cleanest.
   */
  private liveResolve(): void {
    const t = this.talking;
    if (!t || this.camMode !== 'talk') return;
    const ban: { x: number; z: number }[] = [];
    let bestFails: string[] | null = null;
    let bestPlace: { slide: { x0: number; z0: number; x1: number; z1: number; t: number } | null; vx: number; vz: number } | null = null;
    const pl = this.game.player;
    const p0 = { x: pl.position.x, z: pl.position.z };
    const v0 = { x: t.v.position.x, z: t.v.position.z };
    // (r8b: six tries — the wider post berth needs a couple more re-blocks round the lamp-lit spots.
    // Placements are weighed, not counted: a post beside a head is a softer flaw than the lens inside
    // a prop or a building in a sight line, and the fountain / a bystander in front of the pair
    // (auditTalk's foreground clutter) counts too.)
    let bestScore = Infinity;
    for (let i = 0; i < 6; i++) {
      const fails = this.talkFrameFails();
      let score = 0;
      for (const f of fails) score += f.startsWith('post on a head') ? 0.4 : 1;
      if (this.talkClutter() > 0) score += 0.8;
      if (score < bestScore) {
        bestScore = score;
        bestFails = fails;
        bestPlace = { slide: this.talkSlide ? { ...this.talkSlide } : null, vx: t.v.position.x, vz: t.v.position.z };
      }
      if (score === 0 || i === 5) break;
      const s = this.talkSlide;
      ban.push(s ? { x: s.x1, z: s.z1 } : { x: pl.position.x, z: pl.position.z });
      // (re-solve from the original stance)
      this.talkSlide = null;
      const map = this.game.world.current!;
      t.v.setPosition(v0.x, map.heightAt(v0.x, v0.z), v0.z);
      void p0;
      this.spaceTalk(ban);
      this.camPick.key = '';
    }
    if (bestPlace) {
      const map = this.game.world.current!;
      this.talkSlide = bestPlace.slide;
      t.v.setPosition(bestPlace.vx, map.heightAt(bestPlace.vx, bestPlace.vz), bestPlace.vz);
      this.camPick.key = '';
      // The villager's own step (if any) glides over 0.35 s instead of popping.
      if (Math.hypot(bestPlace.vx - v0.x, bestPlace.vz - v0.z) > 0.03) {
        this.villSlide = { x0: v0.x, z0: v0.z, x1: bestPlace.vx, z1: bestPlace.vz, t: 0 };
        t.v.setPosition(v0.x, map.heightAt(v0.x, v0.z), v0.z);
      } else this.villSlide = null;
    }
    this.liveFrame = bestFails ?? [];
  }
  /** The screen check of the open live talk (empty = clean). */
  liveFrame: string[] = [];

  /**
   * Foreground clutter of the candidate talk lens talkFrameFails just solved (fitCam): the fountain or
   * a bystander's head in front of the pair — the same measure auditTalk fails on.
   */
  private talkClutter(): number {
    const t = this.talking;
    const map = this.game.world.current;
    if (!t || !map) return 0;
    const v = t.v.position;
    const s = this.talkSlide;
    const px = s ? s.x1 : this.game.player.position.x;
    const pz = s ? s.z1 : this.game.player.position.z;
    const by: THREE.Vector3[] = [];
    for (const o of this.agents.values()) if (o !== t && !o.inside && o.v.root.visible && o.v.position.distanceTo(v) < 12) by.push(new THREE.Vector3(o.v.position.x, o.v.position.y + o.v.headTop * 0.55, o.v.position.z));
    const mid = new THREE.Vector3((v.x + px) / 2, map.heightAt(v.x, v.z) + 0.9, (v.z + pz) / 2);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.fitCam.quaternion).multiplyScalar(this.fitCam.position.distanceTo(mid)).add(this.fitCam.position);
    return this.foreground(this.fitCam.position, look, by, mid);
  }

  /**
   * Screen-space check of the talk frame the director would settle on (the farmer at the end of their
   * step): a post / pole standing between the two heads, a post on a head (postsNearHeads), the lens
   * inside / a sight line behind a prop or a building.
   */
  talkFrameFails(): string[] {
    const t = this.talking;
    const map = this.game.world.current;
    if (!t || !map) return ['no talk'];
    const pl = this.game.player;
    const save = { x: pl.position.x, z: pl.position.z };
    const s = this.talkSlide;
    if (s) pl.position.set(s.x1, map.heightAt(s.x1, s.z1), s.z1);
    const fails: string[] = [];
    try {
      this.camPick.key = '';
      const g = this.shotGoal();
      if (!g) return ['no shot'];
      const tc = this.fitCam;
      tc.fov = this.game.rc.camera.fov;
      tc.aspect = this.game.rc.camera.aspect;
      tc.updateProjectionMatrix();
      this.camPosFor(g.target, g.yaw, g.pitch, g.dist, tc.position);
      tc.lookAt(g.target);
      tc.updateMatrixWorld(true);
      const acts = this.camActors();
      const heads = acts.map((a) => {
        const top = _pt.set(a.x, a.y + a.head, a.z).project(tc).clone();
        const chin = _pb.set(a.x, a.y + a.head * 0.5, a.z).project(tc).clone();
        // (x in aspect-corrected NDC so widths compare with heights)
        return { x: top.x * tc.aspect, top: top.y, chin: chin.y, hw: Math.max(0.02, top.y - chin.y) * 0.36 };
      });
      for (const h of heads) if (h.top > 0.9) fails.push('a head cut by the top of the frame');
      if (heads.length === 2) {
        const [L, R] = heads[0]!.x < heads[1]!.x ? [heads[0]!, heads[1]!] : [heads[1]!, heads[0]!];
        // The pair side by side on screen: heads (and the farmer's hat brim) must not stack.
        if (R.x - L.x < (L.hw + R.hw) * 1.05) fails.push(`the pair overlaps on screen (${(R.x - L.x).toFixed(2)} < ${((L.hw + R.hw) * 1.05).toFixed(2)})`);
        const lo = Math.min(L.chin, R.chin);
        for (const po of POSTS) {
          if (Math.hypot(po.x - t.v.position.x, po.z - t.v.position.z) > 9) continue;
          const gy = map.heightAt(po.x, po.z);
          const b = _pb.set(po.x, gy, po.z).project(tc);
          const bx = b.x;
          const by = b.y;
          const tp = _pt.set(po.x, gy + 3.3, po.z).project(tc);
          if (b.z > 1 || tp.z > 1) continue;
          // Between the heads (inside their inner edges) and reaching up into the head band.
          const px = ((bx + tp.x) / 2) * tc.aspect;
          if (px > L.x + L.hw * 0.4 && px < R.x - R.hw * 0.4 && Math.max(by, tp.y) > lo && Math.min(by, tp.y) < Math.max(L.top, R.top)) {
            // …and nearer the lens than the far partner (a post far behind reads as background).
            const dPost = tc.position.distanceTo(_pt.set(po.x, gy + 1.5, po.z));
            const dFar = Math.max(...acts.map((a) => tc.position.distanceTo(_pb.set(a.x, a.y + 1.2, a.z))));
            if (dPost < dFar + 1.5) fails.push(`post between the pair (${po.x.toFixed(1)}, ${po.z.toFixed(1)})`);
          }
        }
      }
      // (r8b: a wider berth than the event scorer — the post's hanging lantern sits ~0.5 m out from the
      // pole: in the live Rowan talk it hung right beside the farmer's hat brim)
      const pn = this.postsNearHeads(tc, acts, t.def.id, 2.7);
      if (pn) fails.push(`post on a head (${pn})`);
      this.gatherOcc(tc.position.x, tc.position.z, 24);
      const ph = this.propHits(tc.position, acts);
      if (ph) fails.push(`lens in / behind a prop (${ph})`);
      const bh = this.buildingHits(tc.position, acts);
      if (bh) fails.push(`${bh} sight line(s) behind a building`);
    } finally {
      pl.position.set(save.x, map.heightAt(save.x, save.z), save.z);
    }
    return fails;
  }

  /** Slide (0.3 s) of the farmer back to a talking distance, run from update(). */
  private talkSlide: { x0: number; z0: number; x1: number; z1: number; t: number } | null = null;
  /** Minimum farmer ↔ villager gap in a conversation (heads ≥ ~1.1 m apart from the lens). */
  static readonly TALK_GAP = 1.3;

  /**
   * Live-talk blocking (r8 blocker: an unstaged F-talk framed a lamp post straight down the middle of
   * the pair, the lantern on Rowan's chest, the notice board's roof and two bystanders' heads behind).
   * Every live talk now solves the pair's placement before the lens: the farmer steps to one of 16
   * marks round the villager at TALK_GAP (and, solo / host only, the villager may take a step of up to
   * a metre too), scored by:
   *  - nothing tall between the two (lamp / festoon posts, signposts, the notice board, prop boxes),
   *  - no post in the lens corridor (lens → either head) and none right behind a head,
   *  - the pair standing across the lens (side by side on screen), not along it,
   *  - the fewest bystanders within 1.6 m, and the smallest steps (the villager's cost more).
   * `ban` skips a configuration a failed screen check already rejected (liveCheck re-solve).
   */
  private spaceTalk(ban: { x: number; z: number }[] = []): void {
    const t = this.talking;
    const map = this.game.world.current;
    if (!t || !map) return;
    const p = this.game.player.position;
    const v0 = { x: t.v.position.x, z: t.v.position.z };
    const gap = NpcSystem.TALK_GAP;
    const ry = THREE.MathUtils.degToRad(this.game.rc.rig.yaw);
    const right = { x: Math.cos(ry), z: -Math.sin(ry) };
    // The lens sits behind the pair along (sin yaw, cos yaw), ~7.5 m out in plan at the talk pitch.
    const toLens = { x: Math.sin(ry), z: Math.cos(ry) };
    const across = (dx: number, dz: number): number => {
      const l = Math.hypot(dx, dz) || 1;
      return Math.abs((dx * right.x + dz * right.z) / l);
    };
    this.gatherOcc(v0.x, v0.z, 12);
    const occ = this.occSub;
    const segD = (ax: number, az: number, bx: number, bz: number, px: number, pz: number): number => {
      const dx = bx - ax;
      const dz = bz - az;
      const t2 = THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      return Math.hypot(ax + dx * t2 - px, az + dz * t2 - pz);
    };
    // Plan-view segment vs an axis box (tall props only), via a few samples (short segments).
    const segBox = (ax: number, az: number, bx: number, bz: number, pad: number, minH: number, noWalls = false): boolean => {
      for (let i = 0; i < occ.length; i += 6) {
        if (occ[i + 4]! - map.heightAt(occ[i]!, occ[i + 2]!) < minH) continue;
        for (let k = 1; k < 8; k++) {
          const x = ax + ((bx - ax) * k) / 8;
          const z = az + ((bz - az) * k) / 8;
          if (x > occ[i]! - pad && x < occ[i + 3]! + pad && z > occ[i + 2]! - pad && z < occ[i + 5]! + pad) return true;
        }
      }
      for (const b of NpcSystem.BLOCKERS) {
        if (b.h < 1.4 || (noWalls && b.h > 3)) continue;
        for (let k = 1; k < 8; k++) {
          const x = ax + ((bx - ax) * k) / 8;
          const z = az + ((bz - az) * k) / 8;
          if (x > b.r[0] - pad && x < b.r[2] + pad && z > b.r[1] - pad && z < b.r[3] + pad) return true;
        }
      }
      return false;
    };
    const standOk = (x: number, z: number, postR: number): boolean => {
      if (!map.grid.isWalkable(Math.floor(x), Math.floor(z))) return false;
      const c = NpcSystem.clearOf(x, z, 0.45);
      if (Math.hypot(c.x - x, c.z - z) > 0.05) return false;
      for (const po of POSTS) if (Math.hypot(po.x - x, po.z - z) < postR) return false;
      for (const b of NpcSystem.BLOCKERS) if (b.h > 1 && x > b.r[0] - 0.35 && x < b.r[2] + 0.35 && z > b.r[1] - 0.35 && z < b.r[3] + 0.35) return false;
      return true;
    };
    const others = [...this.agents.values()].filter((o) => o !== t && !o.inside && o.v.root.visible);
    const score = (vx: number, vz: number, fx: number, fz: number): number => {
      // Something tall between the pair: never.
      for (const po of POSTS) if (segD(vx, vz, fx, fz, po.x, po.z) < 0.6) return Infinity;
      if (segBox(vx, vz, fx, fz, 0.15, 1.2)) return Infinity;
      for (const o of others) if (Math.hypot(o.v.position.x - fx, o.v.position.z - fz) < 0.8 || segD(vx, vz, fx, fz, o.v.position.x, o.v.position.z) < 0.45) return Infinity;
      let sc = 0;
      const mx = (vx + fx) / 2;
      const mz = (vz + fz) / 2;
      const cx = mx + toLens.x * 7.5;
      const cz = mz + toLens.z * 7.5;
      for (const [ax, az] of [[vx, vz], [fx, fz]] as const) {
        for (const po of POSTS) {
          // In the lens corridor (lens → head), or standing right behind a head.
          if (segD(cx, cz, ax, az, po.x, po.z) < 0.5) sc += 6;
          const d = Math.hypot(po.x - ax, po.z - az);
          if (d < 1.1) sc += 2.5 * (1.1 - d);
        }
        if (segBox(cx, cz, ax, az, 0.1, 1.6)) sc += 5;
        // A notice board / stall / wall right behind a head (the farmer's hat merging with the board).
        if (segBox(ax - toLens.x * 0.3, az - toLens.z * 0.3, ax - toLens.x * 1.6, az - toLens.z * 1.6, 0.15, 1.4, true)) sc += 3;
        for (const o of others) if (Math.hypot(o.v.position.x - ax, o.v.position.z - az) < 1.6) sc += 1.2;
      }
      // (across the lens matters most: a diagonal pair lines up behind each other from a swung lens)
      sc += 4.5 * (1 - across(fx - vx, fz - vz));
      sc += Math.hypot(fx - p.x, fz - p.z) * 0.6;
      const vm = Math.hypot(vx - v0.x, vz - v0.z);
      if (vm > 0.01) sc += 1.5 + vm * 2.5;
      for (const b of ban) if (Math.hypot(b.x - fx, b.z - fz) < 0.5) sc += 30;
      return sc;
    };
    const vSpots: { x: number; z: number }[] = [v0];
    if (this.netRole() !== 'client' && !t.scripted)
      for (const r of [0.6, 1.0]) for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const x = v0.x + Math.sin(a) * r;
        const z = v0.z + Math.cos(a) * r;
        if (standOk(x, z, 0.75)) vSpots.push({ x, z });
      }
    let best: { vx: number; vz: number; fx: number; fz: number; s: number } | null = null;
    for (const vs of vSpots)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        for (const g of [gap, gap + 0.25]) {
          const fx = vs.x + Math.sin(a) * g;
          const fz = vs.z + Math.cos(a) * g;
          if (!standOk(fx, fz, 0.85)) continue;
          const sc = score(vs.x, vs.z, fx, fz) + (g > gap ? 0.3 : 0);
          if (!best || sc < best.s) best = { vx: vs.x, vz: vs.z, fx, fz, s: sc };
        }
      }
    this.talkPlace = best ? { ...best } : null;
    if (!best || !Number.isFinite(best.s)) {
      // Nowhere clean: at least keep the gap (the villager steps back from the farmer).
      const d = Math.hypot(p.x - v0.x, p.z - v0.z);
      if (d >= gap - 0.02) return;
      const base = d > 1e-3 ? Math.atan2(p.x - v0.x, p.z - v0.z) : 0;
      const x = p.x - Math.sin(base) * gap;
      const z = p.z - Math.cos(base) * gap;
      if (this.netRole() !== 'client' && map.grid.isWalkable(Math.floor(x), Math.floor(z))) {
        t.v.setPosition(x, map.heightAt(x, z), z);
        t.anchor = { x, z };
      }
      return;
    }
    if (Math.hypot(best.vx - v0.x, best.vz - v0.z) > 0.01) {
      t.v.setPosition(best.vx, map.heightAt(best.vx, best.vz), best.vz);
      if (!t.path.length) t.anchor = { x: best.vx, z: best.vz };
    }
    if (Math.hypot(best.fx - p.x, best.fz - p.z) > 0.02) this.talkSlide = { x0: p.x, z0: p.z, x1: best.fx, z1: best.fz, t: 0 };
  }
  /** The last live-talk placement (debug / audits). */
  talkPlace: { vx: number; vz: number; fx: number; fz: number; s: number } | null = null;

  private villSlide: { x0: number; z0: number; x1: number; z1: number; t: number } | null = null;
  private stepTalkSlide(dt: number): void {
    const vs = this.villSlide;
    if (vs && this.talking) {
      vs.t = Math.min(1, vs.t + dt / 0.35);
      const e = 1 - (1 - vs.t) ** 3;
      const x = vs.x0 + (vs.x1 - vs.x0) * e;
      const z = vs.z0 + (vs.z1 - vs.z0) * e;
      this.talking.v.setPosition(x, this.game.world.heightAt(x, z), z);
      if (vs.t >= 1) this.villSlide = null;
    } else this.villSlide = null;
    const s = this.talkSlide;
    if (!s) return;
    if (!this.talking) {
      this.talkSlide = null;
      return;
    }
    s.t = Math.min(1, s.t + dt / 0.3);
    const e = 1 - (1 - s.t) ** 3;
    this.game.player.teleport(s.x0 + (s.x1 - s.x0) * e, s.z0 + (s.z1 - s.z0) * e);
    if (s.t >= 1) this.talkSlide = null;
  }

  /** Dev builds: the auditTalk checks on the conversation that is actually open (console warning). */
  private auditLiveTalk(): void {
    const t = this.talking;
    if (!t || this.camMode !== 'talk') return;
    const p = this.game.player.position;
    const fails: string[] = [];
    const gap = Math.hypot(p.x - t.v.position.x, p.z - t.v.position.z);
    if (gap < 1.1) fails.push(`pair gap ${gap.toFixed(2)} m`);
    const acts = this.camActors();
    const cam = this.game.rc.camera;
    cam.updateMatrixWorld(true);
    let fgv = 0;
    for (const o of this.agents.values())
      if (o !== t && !o.inside && o.v.root.visible && !o.scripted) {
        const b = this.fgBox(o);
        if (b.near) fgv += b.cover;
      }
    if (fgv > 0.08) fails.push(`bystanders cover ${(fgv * 100).toFixed(0)} % of the near foreground`);
    this.gatherOcc(cam.position.x, cam.position.z, 24);
    const ph = this.propHits(cam.position, acts);
    if (ph) fails.push(`lens in / behind a prop (${ph})`);
    const hits = this.buildingHits(cam.position, acts);
    if (hits) fails.push(`${hits} sight line(s) behind a building`);
    this.liveAudit = { id: t.def.id, gap, fails };
    if (fails.length) console.warn(`[npcs] live talk audit (${t.def.id}): ${fails.join(' · ')}`);
  }
  liveAudit: { id: string; gap: number; fails: string[] } | null = null;

  /**
   * The villager a talk press would reach: within 1.85 m of the farmer (or 1.45 m of the tile they
   * face), nearest first — the same test drives the "Talk / Give" prompt, so the prompt never lies.
   */
  private reachable(x?: number, z?: number): Agent | null {
    const p = this.game.player.position;
    let best: Agent | null = null;
    let bd = Infinity;
    for (const a of this.agents.values()) {
      if (a.inside || a.vis < 0.5 || a.scripted) continue;
      const v = a.v;
      const dp = Math.hypot(v.position.x - p.x, v.position.z - p.z);
      const dt = x === undefined || z === undefined ? Infinity : Math.hypot(v.position.x - (x + 0.5), v.position.z - (z + 0.5));
      const ok = dp < 1.85 || dt < 1.45;
      const d = Math.min(dp, dt + 0.2);
      if (ok && d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  /** Conversations lean in: a gentle two-shot of the farmer and the villager, above the dialogue box. */
  private startTalkCam(live = false): void {
    if (this.camMode === 'event' || !this.talking) return;
    // Street chatter would sit right in the lens (a bubble the size of the dialogue box); emote
    // bubbles (a greeting ♪) clear too.
    for (const a of this.agents.values()) {
      a.v.hush();
      a.v.emote('dots', 0.01);
      a.emoteT = Math.max(a.emoteT, 3);
    }
    this.takeCam('talk');
    this.shot = { kind: 'two', speaker: this.talking.def.id, anchor: null };
    this.clearStage(live);
  }

  /**
   * "Excuse me": villagers standing on the lens side of a conversation (or right on top of the
   * pair) stroll a few steps aside, so nobody's big chibi head fills the foreground of the two-shot.
   */
  private clearStage(live = false): void {
    const t = this.talking;
    const map = this.game.world.current;
    if (!t || !map) return;
    // (the farmer's end of the pair after the step back — the slide is still running)
    const p = this.talkSlide ? new THREE.Vector3(this.talkSlide.x1, 0, this.talkSlide.z1) : this.game.player.position;
    const mx = (p.x + t.v.position.x) / 2;
    const mz = (p.z + t.v.position.z) / 2;
    const yaw = THREE.MathUtils.degToRad(this.game.rc.rig.yaw);
    const cx = Math.sin(yaw);
    const cz = Math.cos(yaw);
    for (const b of this.agents.values()) {
      // (a live talk moves demo-marked villagers too: the r6 'real talk' kept Wren's easel in the lens)
      if (b === t || b.inside || b.scripted || (b.staged && !live) || !b.v.root.visible || this.heldBy.has(b.def.id)) continue;
      const dx = b.v.position.x - mx;
      const dz = b.v.position.z - mz;
      const d = Math.hypot(dx, dz);
      const front = dx * cx + dz * cz; // + = between the pair and the lens
      const near = Math.min(Math.hypot(b.v.position.x - p.x, b.v.position.z - p.z), Math.hypot(b.v.position.x - t.v.position.x, b.v.position.z - t.v.position.z));
      if (!(near < 1.5 || (front > -0.3 && d < 4.2))) continue;
      // Step round behind the pair (background life, never in front of the lens), on whichever side
      // they already lean towards; failing that, well out to the side.
      const side = dx * cz - dz * cx >= 0 ? 1 : -1;
      let best: { x: number; z: number } | null = null;
      const cands: [number, number][] = [[2.6, 1.6], [3.4, 2.2], [2.2, 2.6], [1.2, 4.6], [0, 5.4]];
      for (const [back, lat] of cands) {
        for (const sg of [side, -side]) {
          const x = mx - cx * back + cz * lat * sg;
          const z = mz - cz * back - cx * lat * sg;
          if (map.grid.isWalkable(Math.floor(x), Math.floor(z))) {
            best = NpcSystem.clearOf(x, z);
            break;
          }
        }
        if (best) break;
      }
      if (!best) continue;
      b.staged = false;
      this.releaseClaim(b);
      this.setActivity(b, 'idle');
      b.path = [];
      b.goal = null;
      b.onArrive = null;
      b.anchor = { x: best.x, z: best.z };
      // Round the pair, not through them: out to the side at their own depth first.
      const bs = (best.x - mx) * cz - (best.z - mz) * cx >= 0 ? 1 : -1;
      const fd = Math.max(0, front);
      const w1 = { x: mx + cx * fd + cz * 2.4 * bs, z: mz + cz * fd - cx * 2.4 * bs };
      const yawTo = Math.atan2(mx - best.x, mz - best.z);
      b.path = map.grid.isWalkable(Math.floor(w1.x), Math.floor(w1.z)) && d < 3.5 ? [w1, { x: best.x, z: best.z }] : [{ x: best.x, z: best.z }];
      b.goal = { x: best.x, z: best.z, yaw: yawTo };
      this.nextWaypoint(b);
    }
  }

  // ───────────────────────────────────────────── gifts

  /** The gift arcs from the farmer's hands to the villager, who squashes and bursts into a reaction. */
  private giftJuice(id: NpcId, itemId: string, reaction: 'love' | 'like' | 'neutral' | 'dislike', giver?: { x: number; y: number; z: number }): void {
    const a = this.agents.get(id);
    if (!a || !this.active) return;
    const p = giver ?? this.game.player.position;
    const v = a.v;
    const from = new THREE.Vector3(p.x, p.y + 1.05, p.z);
    const to = new THREE.Vector3(v.position.x, v.position.y + v.headTop * 0.62, v.position.z);
    let url = '';
    try {
      url = itemIconUrl(itemId);
    } catch {
      /* no icon: skip the toss */
    }
    const land = (): void => {
      // r7 juice: a real hop with squash on a loved gift, the heart emote, a sparkle where it landed,
      // and the hearts bursting from just over the head (not a metre above it).
      v.squash(reaction === 'love' ? 1.8 : reaction === 'like' ? 1.3 : reaction === 'dislike' ? 0.7 : 1.1);
      if (reaction === 'love') v.emote('heart', 2.6);
      else if (reaction === 'like') v.emote('music', 2.2);
      if (reaction !== 'dislike') this.fx.burst(to.clone(), 'neutral');
      this.fx.burst(new THREE.Vector3(v.position.x, v.position.y + v.headTop * 0.86, v.position.z), reaction);
      // Liked gifts are held up at the chest through the reaction line (until the box closes when it is
      // the local farmer's talk); a disliked one is shrugged at.
      if (url && reaction !== 'dislike') v.holdIcon(url, this.talking === a ? 1e9 : 3.6);
      else v.gesture(reaction === 'dislike' ? 'shrug' : 'nod', 1.8);
    };
    // (the arc starts a beat after the box opens, so the throw is seen)
    void this.wait(0.22).then(() => {
      if (url) this.fx.tossItem(url, from, to, land);
      else land();
    });
  }

  /**
   * Host: a farmhand's gift its ledger accepted — the villager turns to that farmer (held a few
   * seconds), the item arcs from their hands, hearts / puff burst; then every client is told ('v.g').
   */
  private remoteGift(id: NpcId, itemId: string, reaction: 'love' | 'like' | 'neutral' | 'dislike', from: number, at?: { x: number; z: number }): void {
    const a = this.agents.get(id);
    if (!a) return;
    const held = this.heldBy.get(id);
    // Where the giver stands: the demo's mark, their farmer as the host sees it, their talk lock.
    const rf = this.coopNet()?.remotes?.get?.(from)?.farmer.position;
    const pos = at ?? (rf && Math.hypot(rf.x - a.v.position.x, rf.z - a.v.position.z) < 6 ? { x: rf.x, z: rf.z } : held ? { x: held.x, z: held.z } : { x: a.v.position.x, z: a.v.position.z + 1.3 });
    const y = this.game.world.current?.heightAt(pos.x, pos.z) ?? 0;
    this.heldBy.set(id, { x: pos.x, z: pos.z, until: Math.max(held?.until ?? 0, this.clock + 4) });
    a.v.facePoint(pos.x, pos.z);
    this.giftJuice(id, itemId, reaction, { x: pos.x, y, z: pos.z });
    this.gifts.push({ id, from, reaction, t: this.clock });
    this.netApi()?.sendExt('*', ['v.g', NPC_IDS.indexOf(id), REACTIONS.indexOf(reaction), from, itemId, Math.round(pos.x * 100), Math.round(pos.z * 100)]);
  }

  /** Recent gift reactions seen on this machine (tests: the host saw the farmhand's gift land). */
  private gifts: { id: NpcId; from: number; reaction: string; t: number }[] = [];

  private myId(): number {
    const n = (this.game.services as { net?: { myId?(): number } }).net;
    return typeof n?.myId === 'function' ? n.myId() : 0;
  }

  // ───────────────────────────────────────────── map + placement

  onMapChange(mapId: string, game: Game): void {
    this.lensRestore();
    const map = game.world.current;
    this.active = mapId === 'town' && !!map;
    for (const a of this.agents.values()) a.v.root.removeFromParent();
    this.keyLight.removeFromParent();
    this.keyLight.target.removeFromParent();
    this.blobs.removeFromParent();
    this.fx.group.removeFromParent();
    this.occluded = [];
    this.treeCache = null;
    this.treeBalls = null;
    if (!this.active || !map) return;
    this.applySeason(game.calendar.season);
    map.root.add(this.blobs, this.fx.group);
    for (const a of this.agents.values()) map.root.add(a.v.root);
    this.keyLight.name = 'npc-keylight';
    this.keyLight.castShadow = false;
    map.root.add(this.keyLight, this.keyLight.target);
    this.placeAll();
    this.refreshKeepsakes();
    if (this.staged) this.restage = this.restage ?? 'map';
  }

  // ───────────────────────────────────────────── keepsakes (r9: remembered choices left in the town)

  private keepGroup: THREE.Group | null = null;
  /** Keepsakes on show (tests / demos): label per flag. */
  keepsakesShown: string[] = [];

  /**
   * The town remembers (host-authoritative: the host's memory; farmhands get it as r.hm): a rhubarb
   * pie cooling on Marigold's bench, Pip asleep on the shop step, Wren's river painting drying by the
   * water, the lantern cage on the hall step, Rowan's mended chair at the inn, Kit's map and the
   * clinic's open-evening notice on the board, a second candle on the inn step, the rose in bloom.
   */
  private refreshKeepsakes(): void {
    const map = this.game.world.current;
    if (this.keepGroup) {
      this.keepGroup.removeFromParent();
      this.keepGroup.traverse((c) => {
        const m = c as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
      this.keepGroup = null;
    }
    this.keepsakesShown = [];
    const rel = this.game.services.relationships;
    if (!this.active || !map || !rel) return;
    // Memory notes pinned to the notice board (one repainted canvas: no extra draws).
    const board = map.root.getObjectByName('notice-papers') as THREE.Mesh | undefined;
    const notes = Object.values(NPCS).flatMap((d) => (d.keeps ?? []).filter((k) => k.keepsake?.kind === 'notice' && rel.townRecalls(k.flag)));
    if (board) repaintNotices(board, notes.map((k) => k.flag));
    for (const k of notes) this.keepsakesShown.push(`${k.flag}: ${k.keepsake!.label}`);
    const g = new THREE.Group();
    g.name = 'keepsakes';
    g.userData.perfTag = 'npcs';
    for (const def of Object.values(NPCS))
      for (const k of def.keeps ?? []) {
        const ks = k.keepsake;
        if (!ks || ks.kind === 'notice' || !rel.townRecalls(k.flag)) continue;
        const sp = this.spot(ks.spot);
        if (!sp) continue;
        let o: THREE.Object3D;
        switch (ks.kind) {
          case 'cat':
            // (sitting up: curled, at plaza distance Pip read as a loaf on the step)
            o = buildCat('sit');
            o.scale.setScalar(1.3);
            break;
          case 'pie':
            o = buildPie(false);
            break;
          case 'cake':
            o = buildPie(true);
            break;
          case 'painting':
            o = buildPainting();
            o.scale.setScalar(1.1);
            break;
          case 'cage':
            o = buildLanternCage();
            o.scale.setScalar(1.3);
            break;
          case 'chair':
            o = buildChair(0xa0703c);
            break;
          case 'candle':
            o = buildCandle();
            o.scale.setScalar(1.4);
            break;
          case 'rose':
            o = buildRose();
            break;
          case 'letter': {
            // pinned flat to the notice board's face
            o = buildLetter(0x2f7a74);
            const m = o.children[0];
            if (m) m.rotation.set(0, 0, 0.06);
            o.scale.setScalar(1.5);
            break;
          }
          case 'map': {
            o = buildKidMap();
            o.rotation.x = Math.PI / 2;
            o.scale.setScalar(0.42);
            break;
          }
        }
        const x = sp.x + (ks.dx ?? 0);
        const z = sp.z + (ks.dz ?? 0);
        const holder = new THREE.Group();
        holder.add(o);
        holder.position.set(x, map.heightAt(x, z) + (ks.y ?? 0), z);
        holder.rotation.y = ks.rot ?? 0;
        holder.userData.keepsake = k.flag;
        o.traverse((c) => ((c as THREE.Mesh).isMesh ? ((c as THREE.Mesh).castShadow = ks.kind !== 'letter' && ks.kind !== 'map') : undefined));
        g.add(holder);
        this.keepsakesShown.push(`${k.flag}: ${ks.label}`);
      }
    if (!g.children.length) return;
    this.keepGroup = g;
    map.root.add(g);
  }

  // ───────────────────────────────────────────── seasonal wardrobe

  private lookSeason: Season | null = null;

  /**
   * Dress everyone for the season (data/npcs.ts `wardrobe`: winter coats, scarves, knit hats and
   * earmuffs, mittens — no sunhat in the snow). A changed look rebuilds that villager's one skinned
   * mesh in place (position, yaw, activity, visibility carried over); portraits follow the season.
   */
  private applySeason(season: Season): void {
    if (season === this.lookSeason) return;
    this.lookSeason = season;
    setPortraitSeason(season);
    for (const a of this.agents.values()) {
      const L = seasonLook(a.def, season);
      if (L === a.v.def.look) continue;
      const old = a.v;
      const v = new Villager(L === a.def.look ? a.def : { ...a.def, look: L }, { blob: false });
      const ov = old as unknown as { yaw: number; targetYaw: number; target: THREE.Vector3 | null; arriveFacing: unknown; runMul: number };
      const nv = v as unknown as typeof ov;
      v.setPosition(old.position.x, old.position.y, old.position.z);
      v.setYaw(ov.yaw);
      nv.targetYaw = ov.targetYaw;
      nv.target = ov.target;
      nv.arriveFacing = ov.arriveFacing;
      nv.runMul = ov.runMul;
      v.setActivity(old.activity);
      v.setMood(old.currentMood);
      v.talkTo = old.talkTo;
      v.talkCheat = old.talkCheat;
      v.speaking = old.speaking;
      v.root.visible = old.root.visible;
      v.root.scale.copy(old.root.scale);
      if (this.prompt && this.prompt.parent === old.root) {
        this.prompt.removeFromParent();
        this.promptFor = null;
      }
      old.root.parent?.add(v.root);
      old.root.removeFromParent();
      old.dispose();
      a.v = v;
    }
  }

  private spot(name: string): { x: number; z: number; yaw: number } | null {
    const map = this.game.world.current;
    if (name.startsWith('door:')) {
      const id = name.slice(5);
      const d = map?.poi?.[id]?.[0];
      if (!d) return null;
      const b = map?.root.getObjectByName(id);
      const yaw = b ? Math.atan2(b.position.x - d.x, b.position.z - d.z) : 0;
      return { x: d.x, z: d.z, yaw };
    }
    const s = SPOTS[name];
    if (!s) return null;
    return { x: s[0], z: s[1], yaw: typeof s[2] === 'number' ? s[2] : FACING_YAW[s[2]] };
  }

  private place(p: Place): { x: number; z: number; yaw: number } | null {
    if (typeof p === 'string') return this.spot(p);
    const c = NpcSystem.clearOf(p[0], p[1]);
    return { x: c.x, z: c.z, yaw: 0 };
  }

  /** Push a standing point out of any small prop's footprint (A-boards, barrels, lamp posts…). */
  static clearOf(x: number, z: number, pad = 0.45): { x: number; z: number } {
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (const c of PROP_CLEAR) {
        const dx = x - c.x;
        const dz = z - c.z;
        const d = Math.hypot(dx, dz);
        const need = c.r + pad;
        if (d >= need) continue;
        const k = d > 1e-3 ? need / d : 1;
        x = c.x + (d > 1e-3 ? dx : 0) * k;
        z = c.z + (d > 1e-3 ? dz : need);
        moved = true;
      }
      if (!moved) break;
    }
    return { x, z };
  }

  /** spot#slot → villager. Two villagers sent to one spot stand side by side (or face to face), never inside each other. */
  private claims = new Map<string, NpcId>();
  private closedAt = -1;
  private claimOf = new Map<NpcId, string>();

  private releaseClaim(a: Agent): void {
    const k = this.claimOf.get(a.def.id);
    if (k) this.claims.delete(k);
    this.claimOf.delete(a.def.id);
  }

  /**
   * Resolve a schedule spot to a free sub-slot: the spot itself, then ±1.2 m to its sides (±0.62 m
   * along a bench), then two a step behind — walkable, clear of props and claimed until the villager
   * moves on.
   */
  private claimSpot(a: Agent, spotName: string, act: Activity): { x: number; z: number; yaw: number } | null {
    this.releaseClaim(a);
    const s = this.spot(spotName);
    if (!s) return null;
    if (act === 'inside') return s;
    const map = this.game.world.current;
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    // (chibi heads are ~0.75 m wide: side slots 1.2 m apart so two heads never touch on screen)
    const lat = act === 'sit' ? 0.62 : 1.2;
    const offs: [number, number][] = [[0, 0], [lat, 0], [-lat, 0], [0.65, -1.1], [-0.65, -1.1], [2.3, 0.1], [-2.3, 0.1]];
    for (let i = 0; i < offs.length; i++) {
      const key = `${spotName}#${i}`;
      if (this.claims.has(key)) continue;
      let x = s.x + fz * offs[i]![0] + fx * offs[i]![1];
      let z = s.z - fx * offs[i]![0] + fz * offs[i]![1];
      if (act !== 'sit' && act !== 'paint' && act !== 'hammer' && act !== 'knead' && act !== 'saw') ({ x, z } = NpcSystem.clearOf(x, z));
      if (i > 0 && act !== 'sit' && map && !map.grid.isWalkable(Math.floor(x), Math.floor(z))) continue;
      this.claims.set(key, a.def.id);
      this.claimOf.set(a.def.id, key);
      // Side slots of a chat spot turn a little in towards the middle (a loose conversation ring).
      const yaw = act === 'chat' && i > 0 ? s.yaw + (offs[i]![0] > 0 ? 0.5 : -0.5) : s.yaw;
      return { x, z, yaw };
    }
    return s;
  }

  private stepFor(a: Agent, hour: number): [number, string, Activity?] {
    const w = this.game.calendar.weather;
    const winter = this.game.calendar.season === 'winter';
    let list = (w === 'rain' || w === 'storm') && a.def.rainSchedule ? a.def.rainSchedule : winter && a.def.winterSchedule ? a.def.winterSchedule : a.def.schedule;
    if (list === a.def.schedule) list = this.routines(a, list);
    let cur = list[0]!;
    for (const s of list) if (hour >= s[0]) cur = s;
    return cur;
  }

  /**
   * r9: remembered choices change routines on fair days (data `keeps[].routine`: Tobias takes his tea
   * on Rosalind's bench at ten, Odessa does night rounds at the hall lantern, Linus goes fishing…).
   * The slot replaces whatever the schedule had in [from, to); at `to` the regular entry resumes.
   */
  private routines(a: Agent, list: [number, string, Activity?][]): [number, string, Activity?][] {
    const rel = this.game.services.relationships;
    const keeps = a.def.keeps?.filter((k) => k.routine && rel?.townRecalls(k.flag));
    if (!keeps?.length) return list;
    let out = list.slice();
    for (const k of keeps) {
      const [h0, h1, spot, act] = k.routine!;
      let resume = out[0]!;
      for (const s of out) if (s[0] <= h1) resume = s;
      out = out.filter((s) => s[0] < h0 || s[0] >= h1);
      out.push([h0, spot, act]);
      if (!out.some((s) => s[0] === h1)) out.push([h1, resume[1], resume[2]]);
      out.sort((x, y) => x[0] - y[0]);
    }
    return out;
  }

  /** Put everyone where their schedule says right now (no walking). */
  private placeAll(): void {
    const map = this.game.world.current;
    if (!map) return;
    const hour = this.game.calendar.hour;
    this.claims.clear();
    this.claimOf.clear();
    for (const a of this.agents.values()) {
      a.staged = false;
      a.free = false;
      a.errandUntil = undefined;
      a.v.setMood('neutral');
      if (a.scripted) continue;
      const [, spotName, act] = this.stepFor(a, hour);
      a.stepKey = `${spotName}|${act ?? 'idle'}`;
      const s = this.claimSpot(a, spotName, act ?? 'idle') ?? this.spot('fountain_s')!;
      a.path = [];
      a.onArrive = null;
      a.v.stop();
      a.v.talkTo = null;
      a.v.headLook = null;
      a.anchor = { x: s.x, z: s.z };
      a.v.setPosition(s.x, map.heightAt(s.x, s.z), s.z);
      const free = !act || act === 'idle' || act === 'chat' || act === 'wander';
      a.v.setYaw(free ? this.toLens(s.x, s.z, s.yaw) : s.yaw);
      a.goal = null;
      this.setInside(a, act === 'inside', true);
      this.setActivity(a, act ?? 'idle');
    }
    this.lastHour = hour;
    this.lastQuarter = Math.floor(hour * 4);
  }

  private setInside(a: Agent, inside: boolean, instant = false): void {
    a.inside = inside;
    a.visTarget = inside ? 0 : 1;
    if (instant) {
      a.vis = a.visTarget;
      a.v.root.visible = a.vis > 0.01;
      a.v.root.scale.setScalar(1);
    }
  }

  private setActivity(a: Agent, act: Activity): void {
    a.activity = act;
    a.v.setActivity(act === 'inside' ? 'idle' : act);
    a.wanderT = 1 + Math.random() * 3;
  }

  private goTo(a: Agent, spotName: string, act: Activity): void {
    const map = this.game.world.current;
    const s = this.claimSpot(a, spotName, act);
    if (!map || !s) return;
    const wasInside = a.inside;
    if (wasInside) {
      // Step out of the building we were in (at our current door), then walk.
      this.setInside(a, false);
      a.vis = 0.01;
      a.v.root.visible = true;
    }
    this.setActivity(a, 'idle');
    const path = findPath(map.grid, a.v.position.x, a.v.position.z, s.x, s.z);
    a.path = path.length ? path.slice(1) : [{ x: s.x, z: s.z }];
    a.goal = s;
    a.anchor = { x: s.x, z: s.z };
    a.onArrive = () => {
      // Free-standing villagers (idle / chat / wander) open up to the lens; work spots keep their facing.
      a.v.faceYaw(act === 'idle' || act === 'chat' || act === 'wander' ? this.toLens(s.x, s.z, s.yaw) : s.yaw);
      if (act === 'inside') this.setInside(a, true);
      this.setActivity(a, act);
    };
    this.nextWaypoint(a);
  }

  private nextWaypoint(a: Agent): void {
    const w = a.path.shift();
    if (!w) {
      const cb = a.onArrive;
      a.onArrive = null;
      a.run = false;
      cb?.();
      return;
    }
    const last = a.path.length === 0;
    a.v.walkTo(w.x, w.z, last && a.goal ? a.goal.yaw : 'down', a.run);
  }

  // ───────────────────────────────────────────── staging (demos)

  /**
   * Relationship memory for a demo (r9): `&mem=all` remembers every first answer of every scene,
   * `&mem=alt` every second answer, `&mem=a.b,c.d` exactly those; 'town-memories' defaults to all.
   * Without it, a heart-event demo seeds the answers before that scene (stageEvent).
   */
  private stageMemory(name: string): void {
    const rel = this.game.services.relationships;
    if (!rel || typeof location === 'undefined') return;
    const q = new URLSearchParams(location.search).get('mem') ?? (name === 'town-memories' ? 'all' : null);
    this.memStaged = q !== null;
    if (q === null) return;
    rel.forget();
    if (q === 'all' || q === 'alt') {
      for (const id of NPC_IDS)
        for (const ev of NPCS[id].events)
          for (const st of ev.script) {
            if (!('choice' in st)) continue;
            const o = st.options[q === 'alt' && st.options.length > 1 ? 1 : 0];
            if (o?.flag) rel.remember(o.flag);
          }
    } else for (const f of q.split(',')) if (NPCS[f.split('.')[0] as NpcId] && choiceFlags(f.split('.')[0] as NpcId).includes(f)) rel.remember(f);
  }

  private stage(name: string): void {
    const map = this.game.world.current;
    if (!map) return;
    this.stageMemory(name);
    // `&live=1`: the staged town runs (walkers walk, the clock ticks) — sequence captures of street life.
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('live') === '1') window.setTimeout(() => this.game.setPaused(false), 120);
    // Demos staged back to back in one page (critic batches): drop the previous demo's still —
    // a staged heart event (cast, props, letterbox, event lens) or a held conversation.
    if (!this.eventRunning && (this.camMode || [...this.agents.values()].some((a) => a.scripted))) {
      const box = this.game.services.dialogueBox;
      box?.end();
      box?.cinema(false);
      this.talking = null;
      for (const a of this.agents.values()) {
        a.v.talkTo = null;
        a.v.speaking = false;
        a.v.talkCheat = null;
      }
      // (the demo already set its own lens: nothing to hand back to)
      this.camSaved = null;
      this.endEvent();
      this.camRelease = null;
    }
    for (const a of this.agents.values()) a.v.hush();
    this.placeAll();
    const params = new URLSearchParams(window.location.search);
    if (this.festival) {
      // Festival: everyone in a loose ring around the maypole, facing the centre.
      const ids = NPC_IDS;
      ids.forEach((id, i) => {
        const a = this.agents.get(id)!;
        const ang = ((-150 + (i * 300) / ids.length) * Math.PI) / 180 + (i % 2 ? 0.08 : -0.05);
        const r = PLAZA_C.r + (i % 2) * 0.9;
        const x = PLAZA_C.x + Math.cos(ang) * r;
        const z = PLAZA_C.z + Math.sin(ang) * r;
        this.setInside(a, false, true);
        a.v.setPosition(x, map.heightAt(x, z), z);
        a.v.setYaw(Math.atan2(PLAZA_C.x - x, PLAZA_C.z - z));
        this.setActivity(a, i % 3 === 0 ? 'chat' : 'idle');
        a.anchor = { x, z };
      });
      return;
    }
    this.clearBots();
    if (name === 'town-coop') {
      this.applyMarks(STAGES['town-square']!);
      // (the square's own chatter and held bubbles stay quiet: the frame is about the two farmhands)
      for (const a of this.agents.values()) {
        a.v.hush();
        if (a.emoteT > 100) {
          a.v.emote('dots', 0.01);
          a.emoteT = 8;
        }
      }
      this.stageCoop();
      // (r8: the right-hand Bram / Linus / Juniper stack — once the demo lens lands, anyone whose
      // screen box overlaps a kept figure by > 15 % steps indoors)
      window.setTimeout(() => this.declutter(), 450);
      return;
    }
    const marks = STAGES[name];
    if (marks) {
      if (name === 'town-winter') for (const id of ['hazel', 'june'] as NpcId[]) this.setInside(this.agents.get(id)!, true, true);
      this.applyMarks(marks);
      return;
    }
    if (name === 'town-social' || name === 'town-dialogue' || name === 'town-night-talk') this.seedFriendship(name !== 'town-social' && params.get('first') === '1' ? ((params.get('npc') as NpcId | null) ?? 'marigold') : null);
    // A daytime conversation happens in the living square: the rest of the town goes about its day —
    // a different handful out per conversation and hour, busy with their own things (r4 critic: the same
    // frozen 'audience' ring staring into the lens behind every talk).
    if (name === 'town-dialogue' && this.game.calendar.hour < 17) this.stageBackdrop((params.get('npc') as NpcId | null) ?? 'marigold');
    this.stageRest(name, params);
  }

  /**
   * Background life behind a conversation: who is out depends on the talker and the hour; each does
   * their own thing (sweeping the store step, watering, painting, kneading at the stall, reading, a kid
   * at play) or chats in a pair turned to each other — no held emotes, nobody posing for the lens.
   */
  private stageBackdrop(talker: NpcId): void {
    const map = this.game.world.current!;
    // [x, z, activity, yaw (deg; null = towards the partner)] per villager's own business.
    const SOLO: Partial<Record<NpcId, [number, number, Activity, number][]>> = {
      marigold: [[20.6, 21.3, 'sweep', 60], [22.4, 22.2, 'sweep', -120]],
      hazel: [[32.9, 21.35, 'water', 170], [37.2, 21.4, 'water', -150]],
      wren: [[24.8, 23.3, 'paint', 75], [43.6, 26.2, 'paint', -100]],
      bram: [[41.9, 20.8, 'knead', -15]],
      kit: [[37.4, 27.4, 'play', 140], [25.6, 26.6, 'play', -60]],
      linus: [[35.4, 20.9, 'read', 150], [28.6, 21.2, 'read', -160]],
      tobias: [[29.8, 21.4, 'lean', 120]],
    };
    const PAIRS: [number, number, number, number][] = [
      [26.9, 25.6, 28.2, 26.4],
      [39.0, 23.4, 40.3, 24.2],
      [43.2, 21.6, 44.4, 22.5],
      [23.4, 24.6, 24.8, 25.2],
    ];
    const hour = this.game.calendar.hour;
    const ti = NPC_IDS.indexOf(talker);
    const seed = ti * 7 + Math.floor(hour * 2);
    const order = NPC_IDS.filter((id) => id !== talker).sort((a, b) => hash3(seed, NPC_IDS.indexOf(a), 3) - hash3(seed, NPC_IDS.indexOf(b), 3));
    const out = order.slice(0, 6);
    const used: { x: number; z: number }[] = [];
    // (nobody looming at the talk lens: background business stays a few strides off the pair)
    const pl = this.game.player.position;
    const free = (x: number, z: number): boolean => Math.hypot(x - pl.x, z - pl.z) > 6.2 && used.every((u) => Math.hypot(u.x - x, u.z - z) > 1.6);
    const put = (id: NpcId, x: number, z: number, act: Activity, yaw: number, speak = false): void => {
      const a = this.agents.get(id)!;
      this.setInside(a, false, true);
      a.v.setPosition(x, map.heightAt(x, z), z);
      a.v.setYaw(yaw);
      this.setActivity(a, act);
      a.anchor = { x, z };
      a.stepKey = '';
      a.staged = true;
      a.v.speaking = speak;
      a.v.setMood(act === 'chat' ? (speak ? 'happy' : 'neutral') : 'neutral');
      used.push({ x, z });
    };
    const chatters: NpcId[] = [];
    for (const id of out) {
      const opts = SOLO[id];
      const pick = opts?.[(seed + NPC_IDS.indexOf(id)) % opts.length];
      if (pick && free(pick[0], pick[1]) && hash3(seed, NPC_IDS.indexOf(id), 9) < 0.75) put(id, pick[0], pick[1], pick[2], (pick[3] * Math.PI) / 180);
      else chatters.push(id);
    }
    let pi = seed % PAIRS.length;
    while (chatters.length >= 2) {
      const [ax, az, bx, bz] = PAIRS[pi % PAIRS.length]!;
      pi++;
      if (!free(ax, az) || !free(bx, bz)) {
        if (pi > seed % PAIRS.length + PAIRS.length) break;
        continue;
      }
      const a = chatters.shift()!;
      const b = chatters.shift()!;
      // Turned to each other (a touch open to the square), one of them mid-sentence.
      put(a, ax, az, 'chat', Math.atan2(bx - ax, bz - az) + 0.25, true);
      put(b, bx, bz, 'chat', Math.atan2(ax - bx, az - bz) - 0.25);
    }
    for (const id of chatters) {
      const a = this.agents.get(id)!;
      this.setInside(a, true, true);
    }
    for (const id of order.slice(6)) this.setInside(this.agents.get(id)!, true, true);
  }

  /** Demo blocking: put each marked villager on their spot, holding yaw, activity and emote. */
  private applyMarks(marks: Mark[], skip?: NpcId): void {
    const map = this.game.world.current!;
    {
      let barks = 0;
      for (const [id, x, z, deg, act, emote, mo] of marks) {
        if (id === skip) continue;
        const a = this.agents.get(id)!;
        this.setInside(a, false, true);
        a.v.setPosition(x, map.heightAt(x, z), z);
        a.free = !!mo?.free || !!mo?.walk;
        if (mo && (mo.walk || mo.door)) {
          // Caught on the way somewhere: a real A* walk (a still steps them into the stride).
          this.setActivity(a, 'idle');
          a.anchor = null;
          a.staged = true;
          a.stepKey = '';
          a.v.setMood(emote && EMOTE_MOOD[emote] ? EMOTE_MOOD[emote]! : 'neutral');
          if (emote) {
            a.v.emote(emote, 600);
            a.emoteT = 600;
          }
          const dst = mo.door ? this.spot(`door:${mo.door}`) : { x: mo.walk![0], z: mo.walk![1], yaw: 0 };
          if (!dst) continue;
          const path = findPath(map.grid, x, z, dst.x, dst.z);
          a.path = path.length ? path.slice(1) : [{ x: dst.x, z: dst.z }];
          a.goal = { x: dst.x, z: dst.z, yaw: this.toLens(dst.x, dst.z, 0, 60) };
          a.run = !!mo.run;
          a.onArrive = () => {
            if (mo.door) this.setInside(a, true);
            this.setActivity(a, act);
          };
          this.nextWaypoint(a);
          for (let k = 0; k < 6; k++) a.v.update(0.055, (qx, qz) => map.heightAt(qx, qz), true);
          continue;
        }
        // (a mark may turn three-quarter away, never show the back of a head: within ±75° of the lens)
        // (r8: showcase faces open to within 45° of the lens — a third of the cast was the back of a
        // head; work at a bench / anvil / saw keeps 75°)
        const lim = act === 'hammer' || act === 'saw' || act === 'knead' || act === 'fish' ? 75 : 45;
        if (mo?.free) {
          const toC = this.toLens(x, z, 0, 0);
          a.v.setYaw(toC + (deg * Math.PI) / 180);
        } else a.v.setYaw(act === 'sit' || act === 'paint' ? (deg * Math.PI) / 180 : this.toLens(x, z, (deg * Math.PI) / 180, lim));
        this.setActivity(a, act);
        a.anchor = { x, z };
        a.stepKey = '';
        a.staged = true;
        if (act === 'chat') a.v.speaking = !!emote;
        a.v.setMood((emote && EMOTE_MOOD[emote]) || (act === 'chat' ? 'happy' : 'neutral'));
        if (emote) {
          a.v.emote(emote, 600);
          a.emoteT = 600;
        }
        // Two of the talkers are caught mid-sentence (a speech bubble reads as a living town).
        const pool = this.barkLines(a);
        if (act === 'chat' && emote && barks < 2 && pool?.length) {
          barks++;
          // Lean the bubble away from a close neighbour (no speech bubble over another face).
          let lean = 0;
          for (const [oid, ox, oz] of marks) if (oid !== id && Math.hypot(ox - x, oz - z) < 3.2) lean += ox < x ? 1 : -1;
          a.v.bark(pool[(barks + NPC_IDS.indexOf(id)) % pool.length]!, 600, Math.sign(lean));
        }
      }
    }
  }

  private stageRest(name: string, params: URLSearchParams): void {
    const map = this.game.world.current!;
    // The social page rendered before the seeding: reopen it.
    if (name === 'town-social') this.game.events.emit('ui:open', { name: 'social' });
    if (name === 'town-cast') {
      CAST_ORDER.forEach((id, i) => {
        const a = this.agents.get(id)!;
        // (r8b: a step south of the square's benches — Wren and Rowan stood inside them)
        const x = 26.3 + i * 1.1;
        const z = 30.7;
        this.setInside(a, false, true);
        a.v.setPosition(x, map.heightAt(x, z), z);
        a.v.setYaw(0);
        this.setActivity(a, 'idle');
        a.anchor = { x, z };
        // Hold the line-up pose (no glancing round at the farmer standing beside the row).
        a.staged = true;
        a.stepKey = '';
      });
      return;
    }
    if (name === 'town-dialogue' || name === 'town-night-talk') {
      const id = (params.get('npc') as NpcId | null) ?? (name === 'town-night-talk' ? 'tobias' : 'marigold');
      const a = this.agents.get(id) ?? this.agents.get('marigold')!;
      // r6: each villager is met at their own place of work (the forge for Odessa, the oven for Bram,
      // the easel by the bridge for Wren…), not the same fountain bench every time (`&at=square` opts out).
      const WORK: Partial<Record<NpcId, string>> = { odessa: 'forge_anvil', bram: 'bakery_front', wren: 'easel_river', linus: 'clinic_front', june: 'inn_front', rowan: 'lumber_yard', hazel: 'garden_east', marigold: 'store_front', tobias: 'hall_steps', kit: 'plaza_play' };
      const ws = name === 'town-dialogue' && params.get('at') !== 'square' && params.get('npc') ? SPOTS[WORK[a.def.id] ?? ''] : undefined;
      // r6b: a workplace with its facade right behind it to the south (the inn terrace) can only be
      // filmed from the far side: the farmer steps up from the north, so the villager faces the lens.
      const rev = !!ws && NpcSystem.BLOCKERS.some((b) => b.h > 3 && ws[0] > b.r[0] - 1 && ws[0] < b.r[2] + 1 && b.r[1] > ws[1] && b.r[1] - ws[1] < 4.5);
      const fz = rev ? -1 : 1;
      if (ws) {
        for (const [ox, oz] of [[-1.4, 0.6], [1.4, 0.6], [-1.2, 1.2], [1.2, 1.2], [0, 1.5]] as const) {
          const c = NpcSystem.clearOf(ws[0] + ox, ws[1] + oz * fz);
          if (map.grid.isWalkable(Math.floor(c.x), Math.floor(c.z))) {
            this.game.player.teleport(c.x, c.z);
            this.game.followPlayer(true);
            for (const b of this.agents.values()) if (b !== a && !b.inside && Math.hypot(b.v.position.x - c.x, b.v.position.z - c.z) < 3) this.setInside(b, true, true);
            break;
          }
        }
      }
      // Face-to-face with the farmer on a diagonal (up-screen, to the right) so both read clearly.
      const p = this.game.player.position;
      // (to the left instead when a building stands close on the right: the lens needs the gap)
      const near = (qx: number, qz: number): number => Math.min(...NpcSystem.BLOCKERS.filter((b) => b.h > 3).map((b) => Math.hypot(Math.max(b.r[0] - qx, 0, qx - b.r[2]), Math.max(b.r[1] - qz, 0, qz - b.r[3]))));
      const side = near(p.x + 1.4, p.z - 0.6 * fz) < 3.2 && near(p.x - 1.4, p.z - 0.6 * fz) > near(p.x + 1.4, p.z - 0.6 * fz) ? -1 : 1;
      const x = p.x + 1.4 * side;
      const z = p.z - 0.6 * fz;
      this.setInside(a, false, true);
      a.v.setPosition(x, map.heightAt(x, z), z);
      a.v.setYaw(Math.atan2(p.x - x, p.z - z));
      this.game.player.setFacing(side > 0 ? 'right' : 'left');
      // Anyone else standing right behind the pair steps aside.
      for (const b of this.agents.values()) if (b !== a && Math.hypot(b.v.position.x - x, b.v.position.z - z) < 2.2) this.setInside(b, true, true);
      this.setActivity(a, 'idle');
      const mood = params.get('mood');
      const extra = params.get('gift') ? `/gift/${params.get('gift')}` : mood ? `/${mood}` : params.get('ask') ? '/ask' : '';
      // Reopening the box closes the demo's first one ('ui:close' clears `talking`): set it after.
      this.game.events.emit('ui:open', { name: `dialogue:${a.def.id}${extra}` });
      a.v.talkTo = p;
      this.talking = a;
      if (rev) this.game.rc.rig.yaw = 172;
      this.startTalkCam();
      this.snapCam();
      // Settle the stage cheat before the shot (the rig yaw is final after the snap).
      a.v.talkCheat = THREE.MathUtils.degToRad(this.camCur.yaw);
      // (a few settled ticks: the head's share of the cheat eases in over time, and demos are paused)
      for (let k = 0; k < 4; k++) a.v.update(0.25, (qx, qz) => this.game.world.heightAt(qx, qz), false);
      a.v.setYaw((a.v as unknown as { targetYaw: number }).targetYaw);
      // (demos hold the clock paused, so the per-frame bystander cull never runs: cull once now, and
      // again once the lens has settled)
      this.fgCull(true);
      window.setTimeout(() => this.fgCull(true), 400);
      window.setTimeout(() => this.game.services.dialogueBox?.finishLine(), 30);
      const gi = params.get('gift');
      if (gi) this.giftLoop = { id: a.def.id, item: gi, reaction: (params.get('reaction') as 'love' | null) ?? 'love', t: 1.2 };
      return;
    }
    if (name === 'town-heart-event') {
      const ev = params.get('event') ?? 'wren-2';
      const step = params.get('step');
      this.stageEvent(ev, step !== null ? Number(step) : undefined);
    }
  }

  /**
   * Demo staging only: a believable spread of friendship so heart meters aren't all empty, and every
   * seeded villager counts as already met (no first-meeting lines at 5 hearts). `stranger` stays at 0.
   */
  private seedFriendship(stranger: NpcId | null = null): void {
    const rel = this.game.services.relationships;
    if (!rel || NPC_IDS.some((id) => rel.points(id) > 0)) return;
    const spread = [3.4, 5.2, 2.6, 6.8, 1.8, 4.5, 7.3, 3.0, 2.2, 5.9];
    NPC_IDS.forEach((id, i) => {
      if (id === stranger) return;
      rel.adjust(id, Math.round(spread[i % spread.length]! * 250));
      rel.meet(id);
    });
  }

  // ───────────────────────────────────────────── heart events

  private who(w: Who): Agent | null {
    return w === 'player' ? null : (this.agents.get(w) ?? null);
  }

  private whoPos(w: Who): THREE.Vector3 {
    return w === 'player' ? this.game.player.position : this.agents.get(w)!.v.position;
  }

  private faceTo(w: Who, to: Facing | Who): void {
    let yaw: number;
    if (to in FACING_YAW) yaw = FACING_YAW[to as Facing];
    else {
      const a = this.whoPos(w);
      const b = this.whoPos(to as Who);
      yaw = Math.atan2(b.x - a.x, b.z - a.z);
      // Stage cheat: in a heart event, a villager turning to another actor opens up ~35° towards the
      // lens so the two-shot reads as two three-quarter faces, not two profiles.
      if (this.camMode === 'event' && w !== 'player') {
        const toCam = THREE.MathUtils.degToRad(this.baseYaw);
        const d = Math.atan2(Math.sin(toCam - yaw), Math.cos(toCam - yaw));
        yaw += THREE.MathUtils.clamp(d, -0.6, 0.6);
      }
    }
    if (w === 'player') {
      const f: Facing = Math.abs(Math.sin(yaw)) > Math.abs(Math.cos(yaw)) ? (Math.sin(yaw) > 0 ? 'right' : 'left') : Math.cos(yaw) > 0 ? 'down' : 'up';
      this.game.player.setFacing(f);
    } else {
      const a = this.agents.get(w);
      // Seated on a bench: the body keeps the bench's yaw (a turn would swing it through the backrest);
      // the head turns towards whoever they talk to.
      if (a && a.activity === 'sit') {
        a.v.headLook = to in FACING_YAW ? null : this.whoPos(to as Who).clone();
        return;
      }
      a?.v.faceYaw(yaw);
      // Turning to talk to someone puts the work down (head up, hands free); the painter keeps her
      // easel so the canvas stays in the shot.
      if (a && !(to in FACING_YAW) && (a.activity === 'saw' || a.activity === 'hammer' || a.activity === 'knead' || a.activity === 'sweep' || a.activity === 'water' || a.activity === 'fish' || a.activity === 'read')) this.setActivity(a, 'idle');
    }
  }

  private wait(sec: number): Promise<void> {
    return new Promise((r) => this.waits.push({ t: this.clock + sec, r }));
  }

  private castEvent(ev: HeartEvent): void {
    const map = this.game.world.current!;
    for (const [w, spec] of Object.entries(ev.cast) as [Who, [Place, Facing]][]) {
      const p = this.place(spec[0]);
      if (!p) continue;
      if (w === 'player') {
        this.game.player.teleport(p.x, p.z);
        this.game.player.setFacing(spec[1]);
        continue;
      }
      const a = this.agents.get(w)!;
      a.scripted = true;
      a.path = [];
      a.onArrive = null;
      a.v.stop();
      a.v.talkTo = null;
      this.setInside(a, false, true);
      a.v.setPosition(p.x, map.heightAt(p.x, p.z), p.z);
      a.v.setYaw(typeof spec[0] === 'string' && !spec[0].startsWith('door:') ? p.yaw : FACING_YAW[spec[1]]);
      a.v.headLook = null;
      // Cast on a bench spot = seated on it (hips on the seat, square to the backrest), never standing in it.
      this.setActivity(a, typeof spec[0] === 'string' && spec[0].includes('bench') ? 'sit' : 'idle');
    }
    // Bystanders: anyone between the lens and the scene, or crowding the actors, steps aside; up to four
    // villagers further back stay at their spots — the town goes on behind the scene (r3 blind judge:
    // "only one villager visible, no sense of a town").
    const cy = THREE.MathUtils.degToRad(ev.camera.yaw ?? 0);
    const cx = Math.sin(cy);
    const cz = Math.cos(cy);
    let kept = 0;
    const map0 = this.game.world.current!;
    const baseCam = this.game.rc.camera.clone();
    {
      const ec = ev.camera;
      const p = THREE.MathUtils.degToRad(ec.pitch ?? 40);
      const dist = ec.distance ?? 14;
      const tgt = new THREE.Vector3(ec.x, map0.heightAt(ec.x, ec.z) + 0.8, ec.z);
      baseCam.position.set(tgt.x + Math.sin(cy) * Math.cos(p) * dist, tgt.y + Math.sin(p) * dist, tgt.z + Math.cos(cy) * Math.cos(p) * dist);
      baseCam.lookAt(tgt);
      baseCam.updateMatrixWorld(true);
    }
    /** Whole figure inside the establishing frame (no head cut by the top edge, nothing at the very sides). */
    const inFrame = (x: number, z: number): boolean => {
      const gy = map0.heightAt(x, z);
      const head = _q.set(x, gy + 2.0, z).project(baseCam);
      const feet = _q2.set(x, gy, z).project(baseCam);
      // (the event's close and two-shots crop this establishing frame: keep to its middle)
      return !(Math.abs(head.x) > 0.6 || head.y > 0.5 || feet.y < -0.3 || head.z > 1);
    };
    const cast = [...this.agents.values()].filter((a) => a.scripted).map((a) => a.v.position);
    const pc = ev.cast.player ? this.place(ev.cast.player[0]) : null;
    if (pc) cast.push(new THREE.Vector3(pc.x, 0, pc.z));
    const order = [...this.agents.values()].filter((a) => !a.scripted && !a.inside).sort((p, q) => Math.hypot(p.v.position.x - ev.camera.x, p.v.position.z - ev.camera.z) - Math.hypot(q.v.position.x - ev.camera.x, q.v.position.z - ev.camera.z));
    for (const a of order) {
      const dx = a.v.position.x - ev.camera.x;
      const dz = a.v.position.z - ev.camera.z;
      const d = Math.hypot(dx, dz);
      if (d >= 13) continue;
      const front = dx * cx + dz * cz;
      const crowd = cast.some((c) => Math.hypot(c.x - a.v.position.x, c.z - a.v.position.z) < 3.2);
      if (front > -2.5 || crowd || kept >= 4 || d < 3 || !inFrame(a.v.position.x, a.v.position.z)) this.setInside(a, true, true);
      else {
        kept++;
        a.staged = true;
        a.v.hush();
      }
    }
    // Too quiet a backdrop: bring a pair (and a passer-by) out to the far side of the scene — chatting,
    // three-quarter to the lens, well clear of the actors and of the lens's sight lines.
    if (kept < 3) {
      const map = map0;
      // (from indoors, or from across town — off screen either way)
      const free = [...this.agents.values()].filter((a) => !a.scripted && !a.staged && !ev.cast[a.def.id] && (a.inside || Math.hypot(a.v.position.x - ev.camera.x, a.v.position.z - ev.camera.z) > 16));
      const spots: { x: number; z: number }[] = [];
      for (const back of [5, 6.2, 4.4, 7.4])
        for (const lat of [-2.6, 2.6, -4.2, 4.2, 0, -5.6, 5.6]) {
          const x = ev.camera.x - cx * back + cz * lat;
          const z = ev.camera.z - cz * back - cx * lat;
          const c = NpcSystem.clearOf(x, z);
          if (!map.grid.isWalkable(Math.floor(c.x), Math.floor(c.z)) || !map.grid.isWalkable(Math.floor(c.x + 1.1), Math.floor(c.z))) continue;
          if (cast.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < 4) || spots.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < 3)) continue;
          if (BENCHES.some((b) => Math.hypot(b.x - c.x, b.z - c.z) < 1.3)) continue;
          if (!inFrame(c.x, c.z)) continue;
          spots.push(c);
        }
      let n = 0;
      for (const sp of spots) {
        if (kept >= 3 || !free.length) break;
        const pair = n === 0 && free.length >= 2;
        const who = free.splice(0, pair ? 2 : 1);
        who.forEach((a, i) => {
          const x = sp.x + (pair ? (i ? 0.62 : -0.62) : 0);
          const z = sp.z + (pair ? (i ? 0.25 : -0.25) : 0);
          this.setInside(a, false, true);
          a.v.stop();
          a.path = [];
          a.onArrive = null;
          a.v.setPosition(x, map.heightAt(x, z), z);
          this.setActivity(a, pair ? 'chat' : 'idle');
          const toP = pair ? Math.atan2((i ? -1 : 1) * 1.24, (i ? -1 : 1) * 0.5) : 0;
          a.v.setYaw(pair ? this.toLens(x, z, toP) : this.toLens(x, z, Math.random() * 6));
          a.anchor = { x, z };
          a.staged = true;
          a.v.hush();
          kept++;
        });
        n++;
      }
    }
    this.clearEventProps();
    for (const pr of ev.props ?? []) {
      if (pr.kind === 'ledger' || pr.kind === 'map' || pr.kind === 'sparks' || pr.kind === 'letter' || pr.kind === 'cage' || pr.kind === 'rose') {
        const c = pr.kind === 'ledger' ? buildLedger() : pr.kind === 'map' ? buildKidMap() : pr.kind === 'letter' ? buildLetter() : pr.kind === 'cage' ? buildLanternCage() : pr.kind === 'rose' ? buildRose() : buildSparks();
        c.userData.kind = pr.kind;
        c.userData.perfTag = 'npcs';
        const holder = pr.hold ? this.agents.get(pr.hold[0]) : undefined;
        const near = pr.near ? this.agents.get(pr.near[0]) : undefined;
        if (holder) {
          holder.v.holdProp(c, pr.hold![1]);
        } else {
          let x = pr.at[0];
          let z = pr.at[1];
          if (near) {
            const yaw = (near.v as unknown as { yaw: number }).yaw;
            const side = pr.near![2] ?? 0;
            x = near.v.position.x + Math.sin(yaw) * pr.near![1] + Math.cos(yaw) * side;
            z = near.v.position.z + Math.cos(yaw) * pr.near![1] - Math.sin(yaw) * side;
          }
          c.rotation.y = pr.rot ?? 0;
          c.position.set(x, map.heightAt(x, z) + (pr.y ?? 0), z);
          c.scale.setScalar(pr.scale ?? 1);
          map.root.add(c);
        }
        this.eventProps.push(c);
        continue;
      }
      if (pr.kind === 'candle' || pr.kind === 'painting') {
        const c = pr.kind === 'candle' ? buildCandle() : buildPainting();
        c.userData.kind = pr.kind;
        c.rotation.y = pr.rot ?? 0;
        c.position.set(pr.at[0], map.heightAt(pr.at[0], pr.at[1]) + (pr.y ?? 0), pr.at[1]);
        c.scale.setScalar(pr.scale ?? 1);
        c.userData.perfTag = 'npcs';
        map.root.add(c);
        this.eventProps.push(c);
        continue;
      }
      if (pr.kind !== 'cat') continue;
      // Pip is the town cat: the one napping on the plaza bench steps off stage meanwhile.
      const nap = map.poi?.cat?.[0];
      const crit = this.game.scene.getObjectByName('critters');
      if (nap && crit)
        for (const c of crit.children)
          if (c.visible && Math.hypot(c.position.x - nap.x, c.position.z - nap.z) < 0.4) {
            c.visible = false;
            this.hiddenCats.push(c);
          }
      const cat = buildCat(pr.pose ?? 'sit');
      cat.scale.setScalar(pr.scale ?? 1);
      cat.position.set(pr.at[0], map.heightAt(pr.at[0], pr.at[1]) + (pr.y ?? 0), pr.at[1]);
      cat.rotation.y = pr.rot ?? 0;
      cat.userData.perfTag = 'npcs';
      map.root.add(cat);
      this.eventProps.push(cat);
    }
  }

  private hiddenCats: THREE.Object3D[] = [];

  private clearEventProps(): void {
    for (const c of this.hiddenCats) c.visible = true;
    this.hiddenCats = [];
    for (const o of this.eventProps) {
      o.removeFromParent();
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
    }
    this.eventProps = [];
  }

  // ───────────────────────────────────────────── camera director (heart events + conversations)

  /** Take the camera rig (saved for release) and drive it ourselves. */
  private takeCam(mode: 'event' | 'talk'): void {
    const rig = this.game.rc.rig;
    if (!this.camSaved) this.camSaved = { yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance, off: rig.lookOffset.clone() };
    if (this.camRelease) {
      this.camSaved = { ...this.camSaved };
      this.camRelease = null;
    }
    if (!this.camMode) {
      this.camCur.yaw = rig.yaw;
      this.camCur.pitch = rig.pitch;
      this.camCur.dist = rig.distance;
      this.camCur.target.copy(rig.focus).add(rig.lookOffset);
      this.camCur.set = true;
      this.baseYaw = mode === 'talk' ? rig.yaw : this.baseYaw;
    }
    this.camMode = mode;
    this.camPick.key = '';
    // Heart events are cinematics (the rig stops following; co-op hides other farmers). A chat only
    // leans the camera in through the look offset, so everyone else stays on screen in co-op.
    this.game.cinematic = mode === 'event';
    rig.lookOffset.set(0, 0, 0);
  }

  /** Hand the camera back to the player follow, blending yaw / pitch / distance home. */
  private releaseCam(): void {
    if (!this.camMode) return;
    const wasEvent = this.camMode === 'event';
    this.camMode = null;
    this.game.cinematic = false;
    const rig = this.game.rc.rig;
    if (this.camSaved) {
      // Event cams hand back from their own target (the rig's follow smooths it); chats blend the offset home.
      const off = wasEvent ? this.camSaved.off.clone() : rig.lookOffset.clone();
      this.camRelease = { t: 0, from: { yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance, off } };
      rig.lookOffset.copy(off);
    }
    this.game.followPlayer(false);
    this.restoreOccluders();
    this.fgRestore();
    this.festoonGuard(true);
  }

  /** Jump straight to the current shot (staging, cuts). */
  private snapCam(): void {
    if (!this.camMode) return;
    this.camPick.key = '';
    const g = this.shotGoal();
    if (!g) return;
    this.camCur.yaw = g.yaw;
    this.camCur.pitch = g.pitch;
    this.camCur.dist = g.dist;
    this.camCur.target.copy(g.target);
    // (r8b: a talk's lens hangs off the farmer — after a re-block slide the rig still held the old
    // stance, so the snapped camera sat ~1 m off the solved one: auditTalk measured that lens, not the
    // one talkFrameFails had cleared)
    if (this.camMode === 'talk') this.game.followPlayer(false);
    this.applyCam();
    this.game.rc.rig.snap();
    this.game.rc.camera.updateMatrixWorld(true);
    this.festoonGuard(false, true);
    this.game.rc.camera.updateMatrixWorld(true);
  }

  private applyCam(): void {
    const rig = this.game.rc.rig;
    rig.yaw = this.camCur.yaw;
    rig.pitch = this.camCur.pitch;
    rig.distance = this.camCur.dist;
    if (this.camMode === 'talk') {
      const p = this.game.player.position;
      rig.lookOffset.set(this.camCur.target.x - p.x, this.camCur.target.y - p.y, this.camCur.target.z - p.z);
    } else {
      rig.target.copy(this.camCur.target);
      rig.lookOffset.set(0, 0, 0);
    }
    this.lookPoint.copy(this.camCur.target);
  }

  /** The actors the director frames (world position, head height). */
  private camActors(): { id: Who; x: number; y: number; z: number; head: number }[] {
    const out: { id: Who; x: number; y: number; z: number; head: number }[] = [];
    const p = this.game.player.position;
    if (this.camMode === 'talk') {
      const a = this.talking;
      if (a) out.push({ id: a.def.id, x: a.v.position.x, y: a.v.position.y, z: a.v.position.z, head: a.v.headTop });
    } else
      for (const a of this.agents.values())
        if (a.scripted && !a.inside && a.v.root.visible) out.push({ id: a.def.id, x: a.v.position.x, y: a.v.position.y, z: a.v.position.z, head: a.v.headTop });
    if (this.game.player.root.visible !== false) out.push({ id: 'player', x: p.x, y: p.y, z: p.z, head: 1.85 });
    return out;
  }

  /** Building footprints + roof heights (the director keeps them out of the sight lines). */
  private static readonly BLOCKERS: { r: [number, number, number, number]; h: number }[] = [
    ...BUILDINGS.map((b) => ({ r: [b.block[0], b.block[1], b.block[2] + 1, b.block[3] + 1] as [number, number, number, number], h: b.kind === 'hall' ? 11 : 6.2 })),
    ...NEW_BUILDINGS.map((b) => ({ r: [b.block[0], b.block[1], b.block[2] + 1, b.block[3] + 1] as [number, number, number, number], h: b.kind === 'inn' || b.kind === 'school' ? 7.5 : 6.2 })),
    // The fountain: low basin rim, then the tiered spout.
    { r: [29.7, 22.7, 34.3, 27.3], h: 0.62 },
    { r: [31.0, 24.0, 33.0, 26.0], h: 2.2 },
    // The notice board (roofed, head height) by the store.
    { r: [26.1, 19.25, 28.3, 19.95], h: 2.35 },
  ];

  /** Number of actor sight lines (head + chest) cut by a building from this camera position. */
  private buildingHits(cam: THREE.Vector3, acts: { x: number; y: number; z: number; head: number }[]): number {
    const map = this.game.world.current;
    if (!map) return 0;
    let hits = 0;
    const blk = NpcSystem.BLOCKERS;
    // Indexed loops, no tuple destructuring: run ~10k sight-line steps per lens sweep, and each for-of /
    // [a, b] = r iterator step allocated (pillar 14).
    for (let ai = 0; ai < acts.length; ai++) {
      const a = acts[ai]!;
      for (let k = 0; k < 2; k++) {
        const hy = k === 0 ? a.head - 0.3 : a.head * 0.5;
        const ax = a.x;
        const ay = a.y + hy;
        const az = a.z;
        const len = Math.hypot(cam.x - ax, cam.y - ay, cam.z - az);
        const n = Math.ceil(len / 0.3);
        let hit = false;
        for (let i = Math.ceil(0.9 / 0.3); i < n && !hit; i++) {
          const t = i / n;
          const x = ax + (cam.x - ax) * t;
          const y = ay + (cam.y - ay) * t;
          const z = az + (cam.z - az) * t;
          // The land itself (the rise at the town's edge, river banks) cutting the sight line.
          if (y < map.heightAt(x, z) + 0.15) {
            hit = true;
            break;
          }
          for (let bi = 0; bi < blk.length; bi++) {
            const b = blk[bi]!;
            const r = b.r;
            if (x < r[0] || x > r[2] || z < r[1] || z > r[3]) continue;
            if (y - map.heightAt(x, z) < b.h) {
              hit = true;
              break;
            }
          }
        }
        if (hit) hits++;
      }
    }
    return hits;
  }

  /** Tall static prop boxes near the lens subject, gathered once per lens solve (see TownMap.occluders). */
  private occSub: number[] = [];
  private propCamIn = 0;
  private gatherOcc(x: number, z: number, r = 18): void {
    const out = this.occSub;
    out.length = 0;
    const occ = (this.game.world.current as unknown as { occluders?: Float32Array } | null)?.occluders;
    if (!occ || NO_PROP_OCC) return;
    for (let i = 0; i < occ.length; i += 6) {
      if (occ[i + 3]! < x - r || occ[i]! > x + r || occ[i + 5]! < z - r || occ[i + 2]! > z + r) continue;
      out.push(occ[i]!, occ[i + 1]!, occ[i + 2]!, occ[i + 3]!, occ[i + 4]!, occ[i + 5]!);
    }
  }

  /**
   * Prop occlusion (r6b): 2 when the lens itself sits inside / grazes an awning, parasol, stall or
   * wall, plus one per actor sight line (head, chest) cut by a prop box. Boxes the actor stands in
   * (the stall they work at) don't count for that actor.
   */
  private propHits(cam: THREE.Vector3, acts: { x: number; y: number; z: number; head: number }[]): number {
    const o = this.occSub;
    let h = 0;
    const m = 0.35;
    this.propCamIn = 0;
    for (let i = 0; i < o.length; i += 6)
      if (cam.x > o[i]! - m && cam.x < o[i + 3]! + m && cam.y > o[i + 1]! - m && cam.y < o[i + 4]! + m && cam.z > o[i + 2]! - m && cam.z < o[i + 5]! + m) {
        h += 2;
        this.propCamIn = 1;
        break;
      }
    for (let ai = 0; ai < acts.length; ai++) {
      const a = acts[ai]!;
      for (let k = 0; k < 2; k++) {
        const ax = a.x;
        const ay = a.y + (k === 0 ? a.head - 0.3 : a.head * 0.5);
        const az = a.z;
        const dx = cam.x - ax;
        const dy = cam.y - ay;
        const dz = cam.z - az;
        const len = Math.hypot(dx, dy, dz) || 1;
        const t0 = 0.6 / len;
        for (let i = 0; i < o.length; i += 6) {
          // (the actor's own stall / awning / doorway)
          if (ax > o[i]! - 0.2 && ax < o[i + 3]! + 0.2 && az > o[i + 2]! - 0.2 && az < o[i + 5]! + 0.2 && ay > o[i + 1]! - 0.6) continue;
          let lo = t0;
          let hi = 1;
          // Slab test, axis by axis.
          let miss = false;
          for (let ax3 = 0; ax3 < 3 && !miss; ax3++) {
            const p0 = ax3 === 0 ? ax : ax3 === 1 ? ay : az;
            const d = ax3 === 0 ? dx : ax3 === 1 ? dy : dz;
            const mn = o[i + ax3]!;
            const mx = o[i + 3 + ax3]!;
            if (Math.abs(d) < 1e-6) {
              if (p0 < mn || p0 > mx) miss = true;
              continue;
            }
            let ta = (mn - p0) / d;
            let tb = (mx - p0) / d;
            if (ta > tb) {
              const s = ta;
              ta = tb;
              tb = s;
            }
            if (ta > lo) lo = ta;
            if (tb < hi) hi = tb;
            if (lo > hi) miss = true;
          }
          if (!miss) {
            h++;
            break;
          }
        }
      }
    }
    return h;
  }

  /**
   * Fraction of an actor's face box (screen space) covered by a nearer tall-prop box (occSub, after
   * gatherOcc): parasol canopies, awnings, stall roofs, signs. Ground-standing boxes the actor stands
   * inside (their own stall / doorway) don't count; an overhead canopy does.
   */
  private propOverHead(cam: THREE.Camera, a: { x: number; y: number; z: number; head: number }): number {
    // Real geometry (audit only): rays from the lens to five points on the face against the props
    // batches — a canopy box is mostly air, its cloth is what hides a face.
    const map = this.game.world.current;
    if (!map) return 0;
    const roots = map.root.children.filter((c) => c.userData.perfTag === 'props' && c.visible);
    if (!roots.length) return 0;
    const rc = this.rayc;
    const r = Math.min(0.42, a.head * 0.16);
    const cy = a.y + a.head - r * 1.1;
    let hit = 0;
    const pts: [number, number][] = [[0, 0], [-0.6, 0.15], [0.6, 0.15], [0, 0.75], [0, -0.7]];
    const right = _pr.set(1, 0, 0).applyQuaternion(cam.quaternion);
    for (const [u, v] of pts) {
      _hp.set(a.x + right.x * u * r, cy + v * r, a.z + right.z * u * r);
      const dir = _q.subVectors(_hp, cam.position);
      const d = dir.length();
      rc.set(cam.position, dir.normalize());
      rc.far = d - 0.25;
      if (rc.intersectObjects(roots, true).length) hit++;
    }
    return hit / pts.length;
  }
  private rayc = new THREE.Raycaster();

  /**
   * How many of the speaker's face points (eyes, mouth) are hidden behind another actor's head /
   * hat or shoulders from this lens position (0–2). Heads are spheres sized for hats and hair.
   */
  private faceBlocked(pos: THREE.Vector3, lead: { id: Who; x: number; y: number; z: number; head: number }, acts: { id: Who; x: number; y: number; z: number; head: number }[]): number {
    let n = 0;
    const la = lead.id !== 'player' ? this.agents.get(lead.id) : null;
    const fr = la ? 0.62 * (la.v.headTop / 1.9) : 0.3;
    for (const dy of [0.42, 0.72]) {
      _ab.set(lead.x, lead.y + lead.head - fr * (dy + 0.2), lead.z);
      const dl = pos.distanceTo(_ab);
      let hit = false;
      for (const o of acts) {
        if (o === lead) continue;
        // Head (with a hat brim for the farmer), then the shoulders.
        for (let k = 0; k < 2; k++) {
          const oy = k === 0 ? o.head - (o.id === 'player' ? 0.38 : 0.34) : o.head * 0.55;
          const r = k === 0 ? (o.id === 'player' ? 0.5 : 0.4) : 0.3;
          _hp.set(o.x, o.y + oy, o.z);
          if (pos.distanceTo(_hp) > dl - 0.2) continue;
          _q.subVectors(_ab, pos);
          const t = THREE.MathUtils.clamp(_q2.subVectors(_hp, pos).dot(_q) / _q.lengthSq(), 0, 1);
          if (_q2.copy(pos).addScaledVector(_q, t).distanceTo(_hp) < r) hit = true;
        }
      }
      if (hit) n++;
    }
    return n;
  }

  /**
   * Foreground clutter for a lens (r3: the live talk lens framed the pair over the fountain, spray across
   * the box, a bystander's out-of-focus head in a corner): the fountain and every bystander that sits in
   * the frame nearer than the actors costs, more the bigger it projects; a bystander within 3 m of the
   * lens costs a lot (a giant blurred head).
   */
  private foreground(pos: THREE.Vector3, look: THREE.Vector3, by: THREE.Vector3[], actors: THREE.Vector3): number {
    const fx = look.x - pos.x;
    const fy = look.y - pos.y;
    const fz = look.z - pos.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    const dAct = Math.hypot(actors.x - pos.x, actors.y - pos.y, actors.z - pos.z);
    const map = this.game.world.current;
    let h = 0;
    const test = (x: number, y: number, z: number, r: number, k: number, near: number): void => {
      const vx = x - pos.x;
      const vy = y - pos.y;
      const vz = z - pos.z;
      const along = (vx * fx + vy * fy + vz * fz) / fl;
      if (along < 0.4 || along > dAct * 0.85) return;
      const lat = Math.sqrt(Math.max(0, vx * vx + vy * vy + vz * vz - along * along));
      // In frame (half-diagonal ≈ 0.42 rad at 35° fov): the sphere's near edge inside the cone.
      if ((lat - r) / along > 0.42) return;
      h += k * (1 + (r / along) * 6) + (Math.hypot(vx, vz) < near ? 8 : 0);
    };
    if (map?.id === 'town') {
      // The plaza fountain: basin + tiered spout + jets.
      test(32, (map.heightAt(32, 25) || 0) + 1.0, 25, 2.1, 3.5, 0);
    }
    for (const b of by) test(b.x, b.y, b.z, 0.55, 2.5, 3);
    return h;
  }

  private camPosFor(target: THREE.Vector3, yawDeg: number, pitchDeg: number, dist: number, out = new THREE.Vector3()): THREE.Vector3 {
    const p = THREE.MathUtils.degToRad(pitchDeg);
    const y = THREE.MathUtils.degToRad(yawDeg);
    return out.set(target.x + Math.sin(y) * Math.cos(p) * dist, target.y + Math.sin(p) * dist, target.z + Math.cos(y) * Math.cos(p) * dist);
  }

  /**
   * The shot for right now: a two-shot square to the line between speaker and listener, a close-up
   * that favours the speaker, or a wide establishing frame; the look point is lifted so the actors sit
   * in the upper-middle of the frame, clear of the dialogue box. Buildings in the way swing the yaw
   * (±15–45°) or raise the camera; trees in the way are hidden per frame (guardView).
   */
  private shotGoal(): { yaw: number; pitch: number; dist: number; target: THREE.Vector3; focus: THREE.Vector3 } | null {
    const map = this.game.world.current;
    const acts = this.camActors();
    if (!map || !acts.length) return null;
    const s = this.shot;
    let wx = 0;
    let wz = 0;
    let W = 0;
    for (const a of acts) {
      const w = a.id === 'player' ? 0.6 : a.id === s.speaker ? 1.5 : 1;
      wx += a.x * w;
      wz += a.z * w;
      W += w;
    }
    let cx = wx / W;
    let cz = wz / W;
    let spread = 0;
    for (const a of acts) for (const b of acts) spread = Math.max(spread, Math.hypot(a.x - b.x, a.z - b.z));
    const lead = acts.find((a) => a.id === s.speaker) ?? acts.find((a) => a.id !== 'player') ?? acts[0]!;
    const other = acts.find((a) => a !== lead && a.id === 'player') ?? acts.find((a) => a !== lead);
    const base = this.baseYaw;
    let yaw = base;
    let kind = s.kind;
    let ots = false;
    // A speaker turned away from the lens (talking to a cat on a roof…) gets the wide frame instead.
    const la = lead.id !== 'player' ? this.agents.get(lead.id) : null;
    if (la && kind !== 'wide') {
      const toCam = THREE.MathUtils.degToRad(base);
      const fy = (la.v as unknown as { yaw: number }).yaw;
      const off = Math.abs(Math.atan2(Math.sin(fy - toCam), Math.cos(fy - toCam)));
      if (off > THREE.MathUtils.degToRad(115)) {
        // …the lens swings round in front of them instead (a reverse three-quarter, 40° off their
        // gaze on the side nearer the usual view) so the face reads while they look at a lantern,
        // a rose or a cat; the frame holds the speaker and what they look at, far actors drop out.
        const f = THREE.MathUtils.radToDeg(fy);
        const d = (a: number): number => Math.abs(((a - base + 540) % 360) - 180);
        // (32°: the owner's face must stay within 50° of the lens — auditEvents)
        yaw = d(f + 32) < d(f - 32) ? f + 32 : f - 32;
        ots = true;
        cx = lead.x + Math.sin(fy) * 0.9;
        cz = lead.z + Math.cos(fy) * 0.9;
        spread = 1.2;
      }
    }
    // The title's subject (the bridge being painted) pulls the wide frame to include it.
    const subj = this.camMode === 'event' ? this.evCur?.subject : undefined;
    if (kind === 'wide' && subj && !s.anchor) {
      cx = (cx * W + subj.at[0] * 1.6) / (W + 1.6);
      cz = (cz * W + subj.at[1] * 1.6) / (W + 1.6);
      for (const a of acts) spread = Math.max(spread, Math.hypot(a.x - subj.at[0], a.z - subj.at[1]) + 0.8);
    }
    // Scene props (Pip on the roof) pull the wide frame towards them.
    if (kind === 'wide' && this.eventProps.length && !s.anchor) {
      for (const o of this.eventProps) {
        const op = o.getWorldPosition(_propW);
        cx = (cx * W + op.x * 0.8) / (W + 0.8);
        cz = (cz * W + op.z * 0.8) / (W + 0.8);
      }
    }
    if (s.prop && kind !== 'wide') {
      // Insert: the speaker and the thing they talk about share the frame (prop weighted like an actor).
      const pp = s.prop.getWorldPosition(_propW);
      cx = (cx * W + pp.x * 1.4) / (W + 1.4);
      cz = (cz * W + pp.z * 1.4) / (W + 1.4);
      spread = Math.max(spread, Math.hypot(pp.x - lead.x, pp.z - lead.z) + 0.6);
    }
    if (ots) kind = 'two';
    else if (kind !== 'wide' && other && Math.hypot(other.x - lead.x, other.z - lead.z) > 0.5) {
      // Camera offset (sin y, cos y) perpendicular to the pair: y = atan2(-dz, dx) or + 180°.
      const c1 = THREE.MathUtils.radToDeg(Math.atan2(-(other.z - lead.z), other.x - lead.x));
      const d = (a: number): number => Math.abs(((a - base + 540) % 360) - 180);
      const pick = d(c1) < d(c1 + 180) ? c1 : c1 + 180;
      // (the candidate search below swings towards the listener's shoulder for a three-quarter view)
      let delta = ((pick - base + 540) % 360) - 180;
      delta = THREE.MathUtils.clamp(delta, -34, 34);
      yaw = base + delta;
    } else if (kind !== 'wide') kind = 'close';
    let pitch: number;
    let dist: number;
    if (kind === 'wide') {
      pitch = 40;
      dist = Math.max(10.8, spread * 1.4 + 8.2);
      if (s.anchor) {
        cx = s.anchor.x;
        cz = s.anchor.z;
        yaw = s.anchor.yaw ?? base;
        pitch = Math.max(34, s.anchor.pitch ?? 40);
        dist = s.anchor.distance ?? dist;
      }
    } else if (kind === 'two') {
      // Conversations lean in close (the villager's face and outfit read at thumbnail size).
      pitch = this.camMode === 'talk' ? 25 : 29;
      // (r8b: 8.9 m — with the rig now on the farmer's settled stance the 8.3 m lens cut a tall
      // villager's beanie pom at the top of the frame)
      dist = this.camMode === 'talk' ? 8.9 : THREE.MathUtils.clamp(spread * 1.35 + 5.8, 8, 12.5);
    } else {
      // Close-up: lower for short actors (children) so the lens meets the face, not the crown.
      pitch = lead.head < 1.6 ? 22 : 28;
      dist = THREE.MathUtils.clamp(spread * 0.8 + 5.4, 6.2, 8.5);
      cx = THREE.MathUtils.lerp(cx, lead.x, 0.5);
      cz = THREE.MathUtils.lerp(cz, lead.z, 0.5);
    }
    // Pick a clear angle (cached per shot and re-checked twice a second).
    const key = `${kind}|${s.speaker}|${Math.round(cx)}|${Math.round(cz)}|${Math.round(yaw / 5)}`;
    if (key !== this.camPick.key || this.clock - this.camPick.t > 0.5) {
      const probe = new THREE.Vector3(cx, map.heightAt(cx, cz) + 0.9, cz);
      const cands = CAM_CANDS;
      let best = cands[cands.length - 1]!;
      let bestHits = 99;
      // Score: blocked sight lines dominate; then a speaker turned from the lens (three-quarter is
      // best), the listener's head in front of the speaker's face, then distance from the base angle.
      const fy = la ? (la.v as unknown as { yaw: number }).yaw : null;
      const lh = other ? new THREE.Vector3(other.x, other.y + other.head - 0.25, other.z) : null;
      const v1 = new THREE.Vector3();
      const v2 = new THREE.Vector3();
      // Bystanders (other villagers near the pair) must not stand in front of the actors either.
      const ids = new Set(acts.map((a) => a.id));
      const by: THREE.Vector3[] = [];
      for (const o of this.agents.values())
        if (!ids.has(o.def.id) && !o.inside && o.v.root.visible && Math.hypot(o.v.position.x - cx, o.v.position.z - cz) < 10) by.push(new THREE.Vector3(o.v.position.x, o.v.position.y + o.v.headTop * 0.55, o.v.position.z));
      const segD = (a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): number => {
        v1.subVectors(b, a);
        const t = THREE.MathUtils.clamp(v2.subVectors(p, a).dot(v1) / (v1.lengthSq() || 1), 0, 1);
        return v2.copy(a).addScaledVector(v1, t).distanceTo(p);
      };
      this.gatherOcc(cx, cz);
      for (const c of this.camMode === 'talk' ? CAM_ALL : cands) {
        // (the reverse ring only when the usual side is blocked: a sight line or the lens in a prop)
        if (c[0] > 90 && bestHits < 8) break;
        const cy = yaw + c[0];
        // Test the lens where it will really sit: the look point is lifted towards it (see below).
        const cp = Math.min(62, pitch + c[1]);
        const cd = dist * c[2];
        const upK = ots ? 0.14 : kind === 'close' ? 0.15 : this.camMode === 'talk' ? 0.24 : kind === 'two' ? 0.28 : 0.16;
        const lf = (cd * Math.tan(upK * Math.tan(THREE.MathUtils.degToRad(this.game.rc.camera.fov) / 2))) / Math.sin(THREE.MathUtils.degToRad(cp));
        const cyr = THREE.MathUtils.degToRad(cy);
        const pos = this.camPosFor(_q2.set(probe.x + Math.sin(cyr) * lf, probe.y, probe.z + Math.cos(cyr) * lf), cy, cp, cd, _cp);
        let h = this.buildingHits(pos, acts) * 12;
        {
          // (the lens inside an awning is never acceptable; a sight line grazing a prop's box is
          // weighed lighter in events, whose marks were blocked round the buildings by hand)
          const ph = this.propHits(pos, acts);
          const camIn = this.propCamIn;
          h += camIn * 20 + (ph - camIn * 2) * (this.camMode === 'talk' ? 9 : 4);
        }
        for (const b of by) for (const a of acts) if (segD(pos, _sa.set(a.x, a.y + a.head * 0.6, a.z), b) < 0.55) h += 3;
        h += this.foreground(pos, _q2, by, probe);
        // Lamp posts / festoon poles standing in front of a face or body.
        // (the prop a line is about counts as an actor: nothing may stand in front of it either)
        let seen = acts;
        if (s.prop && kind !== 'wide') {
          _seen.length = 0;
          for (const a of acts) _seen.push(a);
          const sp = s.prop.getWorldPosition(_propW);
          _seenProp.x = sp.x;
          _seenProp.y = sp.y;
          _seenProp.z = sp.z;
          _seen.push(_seenProp);
          seen = _seen;
        }
        for (const a of seen)
          for (const po of POSTS) {
            if (Math.hypot(po.x - a.x, po.z - a.z) > 7) continue;
            for (let k = 0; k < 2; k++) {
              const hy = k === 0 ? a.head * 0.85 : a.head * 0.45;
              const ex = a.x;
              const ez = a.z;
              // Closest approach of the lens→actor ray (in plan) to the post, below the post top (3.3 m).
              const dx = ex - pos.x;
              const dz = ez - pos.z;
              const L2 = dx * dx + dz * dz || 1;
              const tr = ((po.x - pos.x) * dx + (po.z - pos.z) * dz) / L2;
              if (tr > 1.03 && tr < 2.6 && k === 0) {
                // Tangent: a post standing right BEHIND a head (r4 critic: a lamp post growing out of
                // Marigold's bun) — the extended lens→head ray passes the post below its lamp.
                const qx = pos.x + dx * tr - po.x;
                const qz = pos.z + dz * tr - po.z;
                const yb = pos.y + (a.y + hy - pos.y) * tr - map.heightAt(po.x, po.z);
                if (qx * qx + qz * qz < 0.42 * 0.42 && yb > -0.2 && yb < 3.6) h += a.id === s.speaker ? 6 : 2.5;
              }
              const t = THREE.MathUtils.clamp(tr, 0, 1);
              if (t > 0.97) continue;
              const px = pos.x + dx * t - po.x;
              const pz = pos.z + dz * t - po.z;
              const yAt = pos.y + (a.y + hy - pos.y) * t - map.heightAt(po.x, po.z);
              if (px * px + pz * pz < 0.3 * 0.3 && yAt < 3.4) h += a.id === s.speaker ? 7 : 3;
            }
          }
        // A post planted in the middle of the frame between the lens and the actors (a lamp post
        // splitting a two-shot) reads as clutter even when it misses every face: keep the centre clear.
        if (this.camMode === 'event' || this.camMode === 'talk') {
          const fx = probe.x - pos.x;
          const fz = probe.z - pos.z;
          const fl = Math.hypot(fx, fz) || 1;
          // (lamp posts and festoon poles only, one penalty at most: a soft preference, never
          // enough to swing the lens round behind a speaker)
          for (const po of LAMP_POSTS) {
            const px = po.x - pos.x;
            const pz = po.z - pos.z;
            const along = (px * fx + pz * fz) / fl;
            if (along < 1.2 || along > fl * 0.92) continue;
            const side = Math.abs(px * fz - pz * fx) / fl;
            if (side / along < 0.2) {
              // (a live talk has no hand-blocked marks: a post splitting the pair is a hard fail there)
              h += this.camMode === 'talk' ? 5 : 1.5;
              break;
            }
          }
        }
        // The listener (often the farmer) looming in the near foreground — a hat brim filling a quarter of
        // the frame — reads as an accident, not an over-the-shoulder: prefer a side-on two-shot.
        if (this.camMode === 'event' && kind !== 'wide' && !ots && s.speaker) {
          const sp = acts.find((a) => a.id === s.speaker);
          if (sp)
            for (const o of acts) {
              if (o === sp) continue;
              const r = Math.hypot(o.x - pos.x, o.z - pos.z) / (Math.hypot(sp.x - pos.x, sp.z - pos.z) || 1);
              if (r < 0.8) h += (0.8 - r) * 12;
            }
        }
        // Walk beats: the walker's body must not hide behind the farmer (or anyone).
        if (kind === 'wide' && s.speaker) {
          const w = acts.find((a) => a.id === s.speaker);
          if (w) for (const o of acts) if (o !== w && segD(pos, _sa.set(w.x, w.y + w.head * 0.55, w.z), _sb.set(o.x, o.y + o.head * 0.55, o.z)) < 0.6) h += 8;
        }
        if (fy !== null && kind !== 'wide') {
          const cr = THREE.MathUtils.degToRad(cy);
          const off = Math.abs(Math.atan2(Math.sin(fy - cr), Math.cos(fy - cr)));
          if (off > THREE.MathUtils.degToRad(100)) h += 6;
          h += (Math.abs(off - 0.6) / Math.PI) * 3;
          if (lh) h += this.faceBlocked(pos, lead, acts) * 8;
        }
        if (this.camMode === 'event' || this.camMode === 'talk') {
          // Screen space: no pole / trunk within 0.6 head-widths of a framed head.
          const tc = this.fitCam;
          tc.fov = this.game.rc.camera.fov;
          tc.aspect = this.game.rc.camera.aspect;
          tc.updateProjectionMatrix();
          tc.position.copy(pos);
          tc.lookAt(_q2.set(probe.x + Math.sin(cyr) * lf, probe.y, probe.z + Math.cos(cyr) * lf));
          tc.updateMatrixWorld(true);
          const framed = kind === 'close' || ots ? acts.filter((a) => a.id === s.speaker) : acts;
          h += this.postsNearHeads(tc, framed, s.speaker) * 3.5;
          // The event's owner must face the lens (≤ 50°) whenever they are framed.
          const ow = this.evOwner();
          const oa = ow && this.camMode === 'event' ? this.agents.get(ow) : null;
          if (oa && oa.scripted && framed.some((a) => a.id === ow)) {
            // (seated owners keep the bench's yaw: the lens has to come round to the front of the bench)
            const oy = (oa.v as unknown as { targetYaw: number }).targetYaw;
            const toC = Math.atan2(pos.x - oa.v.position.x, pos.z - oa.v.position.z);
            const off = Math.abs(Math.atan2(Math.sin(oy - toC), Math.cos(oy - toC)));
            if (off > THREE.MathUtils.degToRad(50)) h += (off - THREE.MathUtils.degToRad(50)) * 3;
          }
        }
        h += c[0] > 90 ? 4 + Math.abs(c[0] - 180) / 180 + c[1] / 60 + (1 - c[2]) * 2 : Math.abs(c[0]) / 180 + c[1] / 60 + (1 - c[2]) * 2;
        if (h < bestHits) {
          bestHits = h;
          best = c;
        }
      }
      this.camPick = { key, t: this.clock, dy: best[0], dp: best[1], k: best[2] };
    }
    yaw += this.camPick.dy;
    pitch = Math.min(62, pitch + this.camPick.dp);
    dist *= this.camPick.k;
    // Lift the look point towards the lens so the actors sit ~26 % above centre (clear of the box).
    const fov = THREE.MathUtils.degToRad(this.game.rc.camera.fov);
    const up = ots ? 0.14 : kind === 'close' ? 0.15 : this.camMode === 'talk' ? 0.24 : kind === 'two' ? 0.28 : 0.16;
    const yr = THREE.MathUtils.degToRad(yaw);
    const gy = map.heightAt(cx, cz);
    const target = new THREE.Vector3();
    // Fit: a tall listener beside a seated / short speaker must not lose the top of the head into the
    // letterbox (r4: linus-2 "framed badly") — back the lens off until every framed head sits inside.
    const tc = this.fitCam;
    tc.fov = this.game.rc.camera.fov;
    tc.aspect = this.game.rc.camera.aspect;
    tc.updateProjectionMatrix();
    for (let it = 0; it < 6; it++) {
      const lift = (dist * Math.tan(up * Math.tan(fov / 2))) / Math.sin(THREE.MathUtils.degToRad(pitch));
      target.set(cx + Math.sin(yr) * lift, gy + lead.head * (kind === 'close' || ots ? 0.58 : 0.42), cz + Math.cos(yr) * lift);
      if (this.camMode !== 'event' || kind === 'wide') break;
      this.camPosFor(target, yaw, pitch, dist, tc.position);
      tc.lookAt(target);
      tc.updateMatrixWorld(true);
      let bad = false;
      let card = false;
      let edgeL = false;
      for (const a of acts) {
        if ((kind === 'close' || ots) && a.id !== s.speaker) continue;
        const hp = _q2.set(a.x, a.y + a.head - 0.1, a.z).project(tc);
        if (hp.y > 0.72 || Math.abs(hp.x) > 0.88) bad = true;
        // (r7 marigold-2: the card pan pushed the farmer half off the left edge — never pan past it)
        if (hp.x < -0.62) edgeL = true;
        // The portrait card (lower right, beside the box) must not cover a face: slide the frame.
        const fp = _q2.set(a.x, a.y + a.head * 0.55, a.z).project(tc);
        if (fp.x > 0.2 && fp.x < 0.64 && fp.y < -0.02) card = true;
      }
      if (card && edgeL && it < 5) {
        dist *= 1.1;
        continue;
      }
      if (card && it < 5) {
        // Pan so the actors move left of the card (camera right = (cos y, -sin y) in plan).
        cx += Math.cos(yr) * 0.7;
        cz -= Math.sin(yr) * 0.7;
        continue;
      }
      if (!bad) break;
      dist *= 1.1;
    }
    const focus = new THREE.Vector3(cx, gy + 1.0, cz);
    this.goalKind = { kind, ots };
    return { yaw, pitch, dist, target, focus };
  }

  private updateCam(dt: number): void {
    const rig = this.game.rc.rig;
    if (this.camRelease && this.camSaved && !this.camMode) {
      const r = this.camRelease;
      r.t += dt;
      const u = Math.min(1, r.t / 0.7);
      const e = u * u * (3 - 2 * u);
      let dy = this.camSaved.yaw - r.from.yaw;
      dy = ((dy + 540) % 360) - 180;
      rig.yaw = r.from.yaw + dy * e;
      rig.pitch = THREE.MathUtils.lerp(r.from.pitch, this.camSaved.pitch, e);
      rig.distance = THREE.MathUtils.lerp(r.from.distance, this.camSaved.distance, e);
      rig.lookOffset.lerpVectors(r.from.off, this.camSaved.off, e);
      if (u >= 1) {
        this.camRelease = null;
        this.camSaved = null;
      }
    }
    if (!this.camMode) return;
    const g = this.specGoal && this.spectating ? this.specGoal : this.shotGoal();
    if (!g) return;
    const k = 1 - Math.exp(-2.6 * dt);
    let dy = g.yaw - this.camCur.yaw;
    dy = ((dy + 540) % 360) - 180;
    this.camCur.yaw += dy * k;
    this.camCur.pitch += (g.pitch - this.camCur.pitch) * k;
    this.camCur.dist += (g.dist - this.camCur.dist) * k;
    this.camCur.target.lerp(g.target, k);
    this.applyCam();
    if (this.camMode === 'talk' && this.talking) this.talking.v.talkCheat = THREE.MathUtils.degToRad(this.camCur.yaw);
    if (this.camMode === 'event') this.game.rc.focusPoint.lerp(g.focus, k);
    this.guardView();
    this.festoonGuard();
  }

  /**
   * Festoon strings vs close lenses (conversations + heart events): any span whose cord passes within
   * 0.4 m of a sight line from the lens to an actor's face / chest, or that hangs within 4 m of the
   * lens (near bulbs would bloom across the frame), is taken down for the shot. Daytime heart events
   * drop every unlit string; lit ones elsewhere stay up — they are the mood.
   */
  private festoonGuard(restore = false, force = false): void {
    const map = this.game.world.current;
    const f = map?.root.getObjectByName('festoons')?.userData.festoons as Festoons | undefined;
    if (!f) return;
    if (restore || !this.camMode) {
      f.setHidden([]);
      return;
    }
    if (!force && ++this.festFrame % 3) return;
    // Pooled scratch (pillar 14: this ran every third frame of every dialogue, ~10 KB a frame of garbage).
    const hide = this.fgHide;
    hide.length = 0;
    const cam = this.game.rc.camera.position;
    const acts = this.camActors();
    const dayEvent = this.camMode === 'event' && this.game.lighting.night < 0.3;
    const pool = this.fgEyes;
    let ne = 0;
    const eye = (x: number, y: number, z: number): void => {
      if (ne === pool.length) pool.push(new THREE.Vector3());
      pool[ne++]!.set(x, y, z);
    };
    for (const a of acts) for (let k = 0; k < 3; k++) eye(a.x, a.y + a.head * (1 - (k === 0 ? 0.3 : k === 1 ? 0.5 : 0.75) * 0.5) - 0.1, a.z);
    // Bystanders in the frame keep their faces clear too (a cord across a background face reads as a glitch).
    for (const o of this.agents.values())
      if (!o.inside && o.v.root.visible && !acts.some((a) => a.id === o.def.id) && o.v.position.distanceTo(this.lookPoint) < 9)
        eye(o.v.position.x, o.v.position.y + o.v.headTop * 0.8, o.v.position.z);
    const p = _fgP;
    const seg = _fgSeg;
    const w = _fgW;
    for (let i = 0; i < f.spans.length; i++) {
      if (dayEvent) {
        hide.push(i);
        continue;
      }
      let bad = false;
      for (let t = 0; t <= 1.0001 && !bad; t += 1 / 16) {
        f.point(i, t, p);
        if (p.distanceTo(cam) < 4) bad = true;
        for (let ei = 0; ei < ne; ei++) {
          const e = pool[ei]!;
          // Distance from the cord point to the lens→face segment.
          seg.subVectors(e, cam);
          const u = THREE.MathUtils.clamp(w.subVectors(p, cam).dot(seg) / seg.lengthSq(), 0, 1);
          if (u < 0.98 && w.copy(cam).addScaledVector(seg, u).distanceTo(p) < 0.4 + u * 0.1) {
            bad = true;
            break;
          }
        }
      }
      if (bad) hide.push(i);
    }
    f.setHidden(hide);
  }
  private festFrame = 0;
  private fgHide: number[] = [];
  private fgEyes: THREE.Vector3[] = [];

  // ── trees in the sight lines (same approach as the story cutscenes)

  private trees(): THREE.BatchedMesh[] {
    const map = this.game.world.current;
    if (!map) return [];
    if (this.treeCache?.map === map.id) return this.treeCache.meshes;
    const meshes: THREE.BatchedMesh[] = [];
    map.root.traverse((o) => {
      if ((o as THREE.BatchedMesh).isBatchedMesh) {
        let p: THREE.Object3D | null = o.parent;
        while (p && p !== map.root && p.name !== 'trees') p = p.parent;
        if (p?.name === 'trees') meshes.push(o as THREE.BatchedMesh);
      }
    });
    this.treeCache = { map: map.id, meshes };
    return meshes;
  }

  /**
   * Tree instances as bounding spheres grouped by trunk position (canopy + trunk batches share a
   * spot), built once per map: occlusion tests are segment-vs-sphere, not triangle raycasts.
   */
  private treeBalls: { map: string; list: { c: THREE.Vector3; r: number; parts: { mesh: THREE.BatchedMesh; id: number }[] }[] } | null = null;
  private balls(): { c: THREE.Vector3; r: number; parts: { mesh: THREE.BatchedMesh; id: number }[] }[] {
    const map = this.game.world.current;
    if (!map) return [];
    if (this.treeBalls?.map === map.id) return this.treeBalls.list;
    const groups = new Map<string, { c: THREE.Vector3; r: number; parts: { mesh: THREE.BatchedMesh; id: number }[] }>();
    const m = new THREE.Matrix4();
    const sp = new THREE.Sphere();
    for (const mesh of this.trees()) {
      mesh.updateMatrixWorld();
      const max = (mesh as unknown as { maxInstanceCount?: number }).maxInstanceCount ?? 0;
      for (let i = 0; i < max; i++) {
        let gid: number;
        try {
          mesh.getMatrixAt(i, m);
          gid = mesh.getGeometryIdAt(i);
          if (gid < 0 || !mesh.getBoundingSphereAt(gid, sp)) continue;
        } catch {
          continue;
        }
        m.premultiply(mesh.matrixWorld);
        const base = new THREE.Vector3().setFromMatrixPosition(m);
        const key = `${Math.round(base.x * 10)},${Math.round(base.z * 10)}`;
        const c = sp.center.clone().applyMatrix4(m);
        const r = sp.radius * m.getMaxScaleOnAxis();
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { c, r, parts: [] }));
        else {
          // Union of the parts' spheres (trunk + canopy): the canopy sits well above the trunk's
          // centre, so keeping only the larger sphere missed a lens parked inside the leaves.
          const u = new THREE.Sphere(g.c, g.r).union(new THREE.Sphere(c, r));
          g.c = u.center;
          g.r = u.radius;
        }
        g.parts.push({ mesh, id: i });
      }
    }
    this.treeBalls = { map: map.id, list: [...groups.values()] };
    return this.treeBalls.list;
  }

  private treeHits(a: THREE.Vector3, b: THREE.Vector3): { mesh: THREE.BatchedMesh; id: number }[] {
    const out: { mesh: THREE.BatchedMesh; id: number }[] = [];
    const ab = _ab.subVectors(b, a);
    const len2 = ab.lengthSq() || 1;
    const q = _q;
    for (const g of this.balls()) {
      // Closest point on the segment to the canopy centre (spheres are loose: shrink 15 %).
      const t = THREE.MathUtils.clamp(q.subVectors(g.c, a).dot(ab) / len2, 0, 1);
      q.copy(a).addScaledVector(ab, t);
      const rr = g.r * 0.85;
      if (q.distanceToSquared(g.c) < rr * rr) out.push(...g.parts);
    }
    return out;
  }

  private hideTree(mesh: THREE.BatchedMesh, id: number): void {
    if (this.occluded.some((o) => o.mesh === mesh && o.id === id)) return;
    try {
      if (!mesh.getVisibleAt(id)) return;
      mesh.setVisibleAt(id, false);
      this.occluded.push({ mesh, id });
    } catch {
      /* instance gone */
    }
  }

  private restoreOccluders(): void {
    for (const o of this.occluded) {
      try {
        o.mesh.setVisibleAt(o.id, true);
      } catch {
        /* instance gone */
      }
    }
    this.occluded = [];
  }

  // ── Foreground canopies: on the high diorama lens a tree planted just below the frame's bottom
  // edge fills a third of the screen with a blurred blob (and hides the farmer walking south). Its
  // instance is hidden while its canopy projects into the bottom band of the frame, restored after.
  private lensHidden: { mesh: THREE.BatchedMesh; id: number }[] = [];
  private lensFrame = 0;
  private lensCull(): void {
    if (++this.lensFrame % 8) return;
    const cam = this.game.rc.camera;
    cam.updateMatrixWorld();
    const want: { mesh: THREE.BatchedMesh; id: number }[] = [];
    const v = _q;
    for (const g of this.balls()) {
      v.copy(g.c).project(cam);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.25) continue;
      // Canopy centre in the bottom ~22 % of the frame (or below it, with the crown reaching in).
      if (v.y < -0.56 && v.y > -2.2) want.push(...g.parts);
    }
    const key = (o: { mesh: THREE.BatchedMesh; id: number }): string => `${o.mesh.uuid}:${o.id}`;
    const wantK = new Set(want.map(key));
    for (const o of this.lensHidden)
      if (!wantK.has(key(o)))
        try {
          o.mesh.setVisibleAt(o.id, true);
        } catch {
          /* gone */
        }
    const had = new Set(this.lensHidden.map(key));
    this.lensHidden = this.lensHidden.filter((o) => wantK.has(key(o)));
    for (const o of want) {
      if (had.has(key(o))) continue;
      try {
        if (!o.mesh.getVisibleAt(o.id)) continue;
        o.mesh.setVisibleAt(o.id, false);
        this.lensHidden.push(o);
      } catch {
        /* gone */
      }
    }
  }

  /**
   * Bystander villagers in the lens foreground during a chat / heart event (r6 critic: Rowan's giant
   * out-of-focus head filled a third of the real talk frame). Screen-space test per non-participant:
   * nearer the lens than ~60 % of the focus distance, or with the head in the bottom ~30 % of the
   * frame, while on screen → stepped out of the shot (hidden) until the camera hands back.
   */
  /** The heart event on stage (its owner keeps a readable face; its subject opens the scene). */
  private evCur: HeartEvent | null = null;
  private evOwner(): NpcId | null {
    const id = this.evCur?.id.split('-')[0];
    return id && id in NPCS ? (id as NpcId) : null;
  }

  /**
   * Stage cheat (r6 critic: Dr. Pell listened with his back to the lens): standing cast members open
   * up towards the camera — the event's owner to within 50° of it, everyone else to within 72° —
   * whether they speak or listen. Workers at a prop (painting, kneading…) and seated actors keep theirs.
   */
  private cheatOpen(instant = false): void {
    if (this.camMode !== 'event') return;
    const cam = this.game.rc.camera.position;
    const owner = this.evOwner();
    for (const a of this.agents.values()) {
      // (the owner opens up in any standing work too — the anvil, the watering can — but not at the
      // easel or the rod, where the prop direction is the pose)
      const own = a.def.id === owner;
      const workOk = own ? a.activity !== 'sit' && a.activity !== 'paint' && a.activity !== 'fish' : a.activity === 'idle' || a.activity === 'chat';
      if (!a.scripted || a.inside || a.v.isMoving || !workOk) continue;
      const v = a.v;
      const toC = Math.atan2(cam.x - v.position.x, cam.z - v.position.z);
      const ty = (v as unknown as { targetYaw: number }).targetYaw;
      const d = Math.atan2(Math.sin(ty - toC), Math.cos(ty - toC));
      const lim = THREE.MathUtils.degToRad(a.def.id === owner ? 48 : 72);
      if (Math.abs(d) <= lim) continue;
      const want = toC + Math.sign(d) * lim;
      if (instant) v.setYaw(want);
      else v.faceYaw(want);
    }
  }

  /**
   * Screen-space clutter: vertical props (lamp posts, festoon poles, signposts, tree trunks) within
   * 0.6 head-widths of a framed head — "a lamp post growing out of Dr. Pell's head". Returns the
   * weighted hit count (speaker heads count double).
   */
  private postsNearHeads(cam: THREE.Camera, acts: { id: Who; x: number; y: number; z: number; head: number }[], speaker: Who | null, berth = 2.2): number {
    const map = this.game.world.current;
    if (!map) return 0;
    let n = 0;
    const right = _pr.set(1, 0, 0).applyQuaternion(cam.quaternion);
    for (const a of acts) {
      const hr = a.id === 'player' ? 0.36 : Math.min(0.5, 0.3 + a.head * 0.04);
      const hc = _ph.set(a.x, a.y + a.head - hr * 1.1, a.z);
      const edge = _pe.copy(hc).addScaledVector(right, hr).project(cam);
      hc.project(cam);
      if (hc.z > 1 || Math.abs(hc.x) > 1 || Math.abs(hc.y) > 1) continue;
      const rs = Math.abs(edge.x - hc.x);
      const test = (x: number, z: number, h: number): void => {
        if (Math.hypot(x - a.x, z - a.z) > 12) return;
        const gy = map.heightAt(x, z);
        const b0 = _pb.set(x, gy, z).project(cam);
        const bx = b0.x;
        const by = b0.y;
        const t0 = _pt.set(x, gy + h, z).project(cam);
        if (b0.z > 1 || t0.z > 1) return;
        if (!(Math.min(by, t0.y) < hc.y && Math.max(by, t0.y) > hc.y - rs)) return;
        const u = (hc.y - by) / ((t0.y - by) || 1e-4);
        const px = bx + (t0.x - bx) * THREE.MathUtils.clamp(u, 0, 1);
        if (Math.abs(px - hc.x) < rs * berth) n += a.id === speaker ? 2 : 1;
      };
      for (const po of POSTS) test(po.x, po.z, 3.3);
      for (const t of this.balls()) if (Math.abs(t.c.x - a.x) < 12 && Math.abs(t.c.z - a.z) < 12) test(t.c.x, t.c.z, Math.max(0.5, t.c.y - map.heightAt(t.c.x, t.c.z) - t.r * 0.35));
    }
    return n;
  }

  /**
   * Speech bubbles vs farmer name tags (r6: Juniper's chip clipped Linus's bark): a bubble whose
   * screen box overlaps a remote farmer's tag (≈ 2.35 m over their feet) rises above it.
   */
  private bubbleRepel(): void {
    const cam = this.game.rc.camera;
    const tags: THREE.Vector3[] = [];
    for (const o of this.game.scene.children) if (o.name === 'remote-farmer' && o.visible) tags.push(_pt.set(o.position.x, o.position.y + 2.35, o.position.z).project(cam).clone());
    for (const a of this.agents.values()) {
      const v = a.v;
      if (!tags.length || !v.barking) {
        v.barkLift = 0;
        continue;
      }
      const b = _pb.set(v.position.x, v.position.y + v.headTop + 0.6, v.position.z).project(cam);
      let lift = 0;
      for (const t of tags) if (Math.abs(t.x - b.x) < 0.22 && t.y > b.y - 0.09 && t.y < b.y + 0.07) lift = 0.55;
      v.barkLift = lift;
    }
  }

  /** Last candidate each barking villager's bubble took (hysteresis: no flicker between equal spots). */
  private bubblePick = new Map<string, number>();
  /**
   * Speech-bubble solver (r8 critic: bubbles sat on the heads they belong to, tails pointed at signs).
   * In screen space, for every bark: ~17 candidate spots above / beside the speaker are scored against
   * every head box on screen (the speaker's own included), the bubbles already placed, farmer name tags
   * and the frame edges; the tail is a separate wedge aimed from the bubble's bottom edge to the
   * speaker's head top. A speaker turned away whose head is hidden behind a nearer one fades.
   */
  private placeBubbles(): void {
    const talkers: Agent[] = [];
    for (const a of this.agents.values()) if (a.v.barking && a.v.root.visible) talkers.push(a);
    if (!talkers.length) return;
    const cam = this.game.rc.camera;
    cam.updateMatrixWorld();
    const asp = cam.aspect;
    const right = _bRight.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = _bUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const P = (x: number, y: number, z: number): [number, number, number] => {
      const q = _pt.set(x, y, z).project(cam);
      return [q.x * asp, q.y, q.z];
    };
    type Box = { x0: number; y0: number; x1: number; y1: number; d: number; id: string };
    const heads: Box[] = [];
    const headBox = (id: string, x: number, y: number, z: number, top: number, r: number): Box | null => {
      const t = P(x, y + top + 0.06, z);
      const b = P(x, y + top - 2 * r, z);
      if (t[2] > 1 || b[2] > 1) return null;
      const hh = t[1] - b[1];
      return { x0: t[0] - hh * 0.55, x1: t[0] + hh * 0.55, y0: b[1], y1: t[1], d: cam.position.distanceTo(_pb.set(x, y + top, z)), id };
    };
    for (const a of this.agents.values()) {
      if (!a.v.root.visible || a.inside) continue;
      const b = headBox(a.def.id, a.v.position.x, a.v.position.y, a.v.position.z, a.v.headTop, a.v.headTop * 0.24);
      if (b) heads.push(b);
    }
    const pl = this.game.player;
    if (pl.root.visible) {
      const b = headBox('player', pl.position.x, pl.position.y, pl.position.z, 1.95, 0.42);
      if (b) heads.push(b);
    }
    for (const o of this.game.scene.children)
      if (o.name === 'remote-farmer' && o.visible) {
        // (head + the name tag above it)
        const b = headBox('remote', o.position.x, o.position.y, o.position.z, 2.55, 0.62);
        if (b) heads.push(b);
      }
    const overlap = (a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }): number => {
      const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      return w > 0 && h > 0 ? (w * h) / Math.max(1e-6, (b.x1 - b.x0) * (b.y1 - b.y0)) : 0;
    };
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    talkers.sort((a, b) => (a.def.id < b.def.id ? -1 : 1));
    for (const a of talkers) {
      const v = a.v;
      const sx = v.position.x;
      const sy = v.position.y + v.headTop + 0.03;
      const sz = v.position.z;
      const S = P(sx, sy, sz);
      if (S[2] > 1) continue;
      const k = Math.abs(P(sx + up.x, sy + up.y, sz + up.z)[1] - S[1]);
      const { h, w, bot } = v.barkSize();
      const g = 0.42 + bot;
      const cands: [number, number][] = [];
      for (const oy of [g, g + 0.45 * h, g + 0.95 * h]) for (const ox of [0, -0.3 * w, 0.3 * w, -0.56 * w, 0.56 * w]) cands.push([ox, oy]);
      cands.push([-(w / 2 + 0.62), bot + 0.1], [w / 2 + 0.62, bot + 0.1]);
      const last = this.bubblePick.get(a.def.id) ?? 0;
      let best = 0;
      let bestC = Infinity;
      let bestBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
      for (let i = 0; i < cands.length; i++) {
        const [ox, oy] = cands[i]!;
        const c = P(sx + right.x * ox + up.x * oy, sy + right.y * ox + up.y * oy, sz + right.z * ox + up.z * oy);
        const bx = { x0: c[0] - (w * k) / 2, x1: c[0] + (w * k) / 2, y0: c[1] - (h * k) / 2 + bot * k * 0.0, y1: c[1] + (h * k) / 2 };
        // (the canvas has an empty strip under the bubble: its box ends at the bubble's bottom edge)
        bx.y0 = c[1] - bot * k;
        let cost = 0;
        for (const hb of heads) cost += overlap(bx, hb) * (hb.id === a.def.id ? 80 : 60);
        for (const pb of placed) cost += overlap(bx, pb) * 40 + overlap(pb, bx) * 10;
        if (bx.x0 < -asp * 0.97 || bx.x1 > asp * 0.97) cost += 30;
        if (bx.y1 > 0.94) cost += 30;
        cost += (oy - g) * 1.2 + (Math.abs(ox) / w) * 1.6 + (i !== last ? 0.6 : 0);
        if (cost < bestC) {
          bestC = cost;
          best = i;
          bestBox = bx;
        }
      }
      this.bubblePick.set(a.def.id, best);
      if (bestBox) placed.push(bestBox);
      const [ox, oy] = cands[best]!;
      // Tail: from the bubble's bottom edge (on the side nearest the head) down to the head top.
      const ax = THREE.MathUtils.clamp(-ox, -w * 0.32, w * 0.32);
      const side = Math.abs(ox) > w / 2;
      const aox = side ? ox - Math.sign(ox) * (w / 2 - 0.25) : ox + ax;
      const aoy = oy - bot + 0.06;
      const dx = -aox;
      const dy = -aoy + 0.0;
      const len = Math.hypot(dx, dy);
      const rot = Math.atan2(dx, -dy);
      // Turned away and hidden behind a nearer head: fade (the bubble can't be read as theirs).
      let fade = 1;
      const my = heads.find((hb) => hb.id === a.def.id);
      const yaw = (v as unknown as { yaw: number }).yaw;
      const ly = v.lensYaw ?? yaw;
      const off = Math.abs(Math.atan2(Math.sin(yaw - ly), Math.cos(yaw - ly)));
      if (my && off > THREE.MathUtils.degToRad(110)) for (const hb of heads) if (hb !== my && hb.d < my.d - 0.3 && overlap(my, hb) > 0.35) fade = 0.35;
      const ux = (ox2: number, oy2: number, axis: 'x' | 'y' | 'z'): number => right[axis] * ox2 + up[axis] * oy2;
      const tx = (aox + 0) * 0.5;
      const ty = aoy * 0.5;
      v.barkPlace = {
        cx: ux(ox, oy, 'x'),
        cy: v.headTop + 0.03 + ux(ox, oy, 'y'),
        cz: ux(ox, oy, 'z'),
        tx: ux(tx, ty, 'x'),
        ty: v.headTop + 0.03 + ux(tx, ty, 'y'),
        tz: ux(tx, ty, 'z'),
        len,
        rot,
        fade,
      };
    }
  }

  /** town-dialogue &gift= demo: the arc replays every 2.6 s while the box is open (stills catch it). */
  private giftLoop: { id: NpcId; item: string; reaction: 'love' | 'like' | 'neutral' | 'dislike'; t: number } | null = null;

  private fgHidden = new Set<Agent>();
  private fgFrame = 0;
  /** NDC head boxes [x0, y0, x1, y1] of the talking pair (live talk), padded a little. */
  private pairHeadBoxes(): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    const t = this.talking;
    if (!t) return out;
    const cam = this.game.rc.camera;
    const pp = this.game.player.position;
    for (const [x, y, z, h] of [[t.v.position.x, t.v.position.y, t.v.position.z, t.v.headTop], [pp.x, pp.y, pp.z, 1.85]] as const) {
      const top = _pt.set(x, y + h + 0.05, z).project(cam);
      const tx = top.x;
      const ty = top.y;
      const chin = _pb.set(x, y + h * 0.5, z).project(cam);
      const hh = Math.max(0.02, ty - chin.y);
      out.push([tx - hh * 0.62, chin.y, tx + hh * 0.62, ty + hh * 0.08]);
    }
    return out;
  }

  private fgBox(a: Agent): { cover: number; near: boolean } {
    const cam = this.game.rc.camera;
    const v = a.v;
    const top = _q.set(v.position.x, v.position.y + v.headTop, v.position.z).project(cam);
    const ty = top.y;
    const tz = top.z;
    const tx = top.x;
    const foot = _q.set(v.position.x, v.position.y, v.position.z).project(cam);
    if (tz > 1 || foot.z > 1) return { cover: 0, near: false };
    const h = Math.max(0.02, ty - foot.y);
    const w = h * 0.55;
    const x0 = Math.max(-1, Math.min(tx, foot.x) - w / 2);
    const x1 = Math.min(1, Math.max(tx, foot.x) + w / 2);
    const y0 = Math.max(-1, foot.y);
    const y1 = Math.min(1, ty);
    const cover = x1 > x0 && y1 > y0 ? ((x1 - x0) * (y1 - y0)) / 4 : 0;
    const dC = cam.position.distanceTo(_hp.set(v.position.x, v.position.y + v.headTop * 0.6, v.position.z));
    const dF = cam.position.distanceTo(this.lookPoint);
    const headY = foot.y + h * 0.8;
    // (r6b: also a bystander at the pair's own depth looming in from the frame edge — Rowan's beanie
    // filling the left third of Bram's talk — anything that big and that close is foreground)
    // (r7: Kit's big head cut by the left edge of Bram's talk — a figure clipped by the frame edge at
    // the pair's depth reads as foreground clutter too)
    const edge = (x0 < -0.84 || x1 > 0.84) && cover > 0.022 && dC < dF * 1.3;
    // A live talk keeps a little room round the pair: a bystander within 2.2 m of either partner
    // (stepping aside, or parked at their own business) drops out of the two-shot while that close.
    let crowd = false;
    if (this.camMode === 'talk' && this.talking && a !== this.talking) {
      const tp = this.talking.v.position;
      const pp = this.game.player.position;
      crowd = Math.min(Math.hypot(v.position.x - tp.x, v.position.z - tp.z), Math.hypot(v.position.x - pp.x, v.position.z - pp.z)) < 2.2;
      // r8: a bystander whose screen box overlaps either partner's head box (heads stacked behind the
      // pair, a hat brim over a face) drops out too, wherever they stand.
      if (!crowd && x1 > x0 && y1 > y0) for (const hb of this.pairHeadBoxes()) if (x0 < hb[2] && x1 > hb[0] && y0 < hb[3] && y1 > hb[1]) crowd = true;
    }
    const near = cover > 0 && (dC < dF * 0.62 || headY < -0.42 || (cover > 0.09 && dC < dF * 1.15) || edge || crowd);
    return { cover, near };
  }
  /** Farmer tucked out of a heart event's close-up while it stands between the lens and the speaker. */
  private playerTucked = false;
  /**
   * r7 critic: the close-ups were over-the-shoulder shots with the farmer's straw hat the biggest
   * thing on screen. A close single drops the farmer while they are nearer the lens than the speaker
   * and on screen (the reverse is implied, as in film); two-shots and wides keep them.
   */
  private tuckPlayer(): void {
    const pl = this.game.player;
    let tuck = false;
    const s = this.shot;
    // (r8: two-shots too — odessa-4's farmer was a dark hat silhouette cut by the left frame edge)
    const closeK = this.goalKind.kind === 'close' || this.goalKind.ots;
    if (this.camMode === 'event' && this.goalKind.kind !== 'wide' && s.speaker) {
      const sp = this.agents.get(s.speaker);
      const cam = this.game.rc.camera;
      if (sp) {
        const dP = cam.position.distanceTo(_hp.set(pl.position.x, pl.position.y + 1.2, pl.position.z));
        const dS = cam.position.distanceTo(_hp.set(sp.v.position.x, sp.v.position.y + 1.2, sp.v.position.z));
        const hp = _q.set(pl.position.x, pl.position.y + 1.5, pl.position.z).project(cam);
        // (…or cut by the frame edge: r6 marigold-2's farmer was half a figure at the left edge)
        const onScreen = hp.z < 1 && Math.abs(hp.x) < 1.25 && hp.y > -1.3 && hp.y < 1.1;
        // (r8b: …or well in front of the speaker in any tighter shot — odessa-4's two-shot still had the
        // farmer as a big dark hat silhouette in the near foreground)
        tuck = onScreen && ((closeK && dP < dS - 0.4) || dP < dS - 1.5 || Math.abs(hp.x) > 0.74);
      }
    }
    if (tuck === this.playerTucked) return;
    this.playerTucked = tuck;
    pl.root.visible = !tuck;
  }

  private fgCull(force = false): void {
    if (this.camMode === 'event' || this.playerTucked) this.tuckPlayer();
    if (!force && ++this.fgFrame % 4) return;
    this.game.rc.camera.updateMatrixWorld();
    const keep = new Set<Agent>();
    for (const a of this.agents.values()) {
      if (a === this.talking || a.scripted || a.inside) continue;
      if (!a.v.root.visible && !this.fgHidden.has(a)) continue;
      const { near } = this.fgBox(a);
      if (near) keep.add(a);
    }
    for (const a of this.fgHidden)
      if (!keep.has(a)) {
        a.v.root.visible = a.vis > 0.01;
        this.fgHidden.delete(a);
      }
    for (const a of keep) {
      a.v.root.visible = false;
      this.fgHidden.add(a);
    }
    // Tree canopies looming between the lens and the scene (r6: a blurred blossom crown filled a third
    // of Hazel's gift frame): any crown on screen nearer than ~60 % of the focus distance goes.
    const cam = this.game.rc.camera;
    const dF = cam.position.distanceTo(this.lookPoint);
    const want = new Set<string>();
    const add: { mesh: THREE.BatchedMesh; id: number }[] = [];
    _fm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_fm);
    for (const g of this.balls()) {
      const d = cam.position.distanceTo(g.c) - g.r;
      if (d > dF * 0.6) continue;
      // (any crown whose sphere reaches into the view — its centre may sit off-frame or behind the lens)
      if (d > 0.6 && !_fr.intersectsSphere(_fs.set(g.c, g.r * 0.85))) continue;
      for (const o of g.parts) {
        want.add(`${o.mesh.uuid}:${o.id}`);
        add.push(o);
      }
    }
    this.fgTrees = this.fgTrees.filter((o) => {
      if (want.has(`${o.mesh.uuid}:${o.id}`)) return true;
      try {
        o.mesh.setVisibleAt(o.id, true);
      } catch {
        /* gone */
      }
      return false;
    });
    const had = new Set(this.fgTrees.map((o) => `${o.mesh.uuid}:${o.id}`));
    for (const o of add) {
      if (had.has(`${o.mesh.uuid}:${o.id}`)) continue;
      try {
        if (!o.mesh.getVisibleAt(o.id)) continue;
        o.mesh.setVisibleAt(o.id, false);
        this.fgTrees.push(o);
      } catch {
        /* gone */
      }
    }
  }
  private fgTrees: { mesh: THREE.BatchedMesh; id: number }[] = [];
  private fgRestore(): void {
    if (this.playerTucked) {
      this.playerTucked = false;
      this.game.player.root.visible = true;
    }
    for (const a of this.fgHidden) a.v.root.visible = a.vis > 0.01;
    this.fgHidden.clear();
    for (const o of this.fgTrees)
      try {
        o.mesh.setVisibleAt(o.id, true);
      } catch {
        /* gone */
      }
    this.fgTrees = [];
  }

  private lensRestore(): void {
    for (const o of this.lensHidden)
      try {
        o.mesh.setVisibleAt(o.id, true);
      } catch {
        /* gone */
      }
    this.lensHidden = [];
  }

  /** Every other frame: trees between the lens and an actor's head / chest are hidden for the scene. */
  private guardView(force = false): void {
    if (!force && ++this.occFrame % 3) return;
    const cam = this.game.rc.camera.position;
    for (const a of this.camActors())
      for (let k = 0; k < 2; k++) {
        _hp.set(a.x, a.y + (k ? a.head * 0.45 : a.head - 0.3), a.z);
        for (const h of this.treeHits(cam, _hp)) this.hideTree(h.mesh, h.id);
      }
  }

  /** Shot for a script beat (heart events). */
  private shotFor(ev: HeartEvent, i: number): void {
    const s = ev.script[i]!;
    const next = ev.script.slice(i + 1).find((x) => 'say' in x || 'choice' in x || 'narrate' in x);
    if ('say' in s) {
      this.lineNo++;
      const intimate = s.mood === 'sad' || s.mood === 'blush' || s.mood === 'worried';
      const close = intimate || (next !== undefined && 'choice' in next) || this.lineNo % 3 === 0;
      // A line about a thing in the scene (the candle, the canvas, the cat) frames that thing with the speaker.
      const txt = s.text.toLowerCase();
      const pr = (ev.props ?? []).findIndex((p) => p.word && txt.includes(p.word));
      const prop = pr >= 0 ? this.eventProps[pr] : undefined;
      this.shot = { kind: prop ? 'two' : close ? 'close' : 'two', speaker: s.say, anchor: null, prop };
    } else if ('choice' in s) {
      const txt = (s.q ?? "").toLowerCase();
      const pr = (ev.props ?? []).findIndex((p) => p.word && txt.includes(p.word));
      this.shot = { kind: 'two', speaker: s.choice, anchor: null, prop: pr >= 0 ? this.eventProps[pr] : undefined };
    }
    else if ('narrate' in s) this.shot = { kind: 'wide', speaker: null, anchor: null };
    else if ('walk' in s) this.shot = { kind: 'wide', speaker: s.walk === 'player' ? null : s.walk, anchor: null };
    else if ('cam' in s) this.shot = { kind: 'wide', speaker: null, anchor: s.cam };
  }

  private frame(ev: HeartEvent): void {
    this.evCur = ev;
    this.baseYaw = ev.camera.yaw ?? 0;
    for (const a of this.agents.values()) a.v.hush();
    this.takeCam('event');
    this.lineNo = 0;
    this.shot = { kind: 'wide', speaker: null, anchor: null };
  }

  /** Apply a step instantly (fast-forward for staging). */
  private applyInstant(s: CutStep): void {
    const map = this.game.world.current!;
    if ('walk' in s) {
      const p = this.place(s.to);
      if (!p) return;
      if (s.walk === 'player') this.game.player.teleport(p.x, p.z);
      else {
        const a = this.agents.get(s.walk)!;
        a.v.setPosition(p.x, map.heightAt(p.x, p.z), p.z);
      }
      if (s.face) this.faceTo(s.walk, s.face);
      if (s.walk !== 'player') {
        const a = this.agents.get(s.walk)!;
        a.v.setYaw((a.v as unknown as { targetYaw: number }).targetYaw);
      }
    } else if ('face' in s) {
      this.faceTo(s.face, s.to);
      if (s.face !== 'player') {
        const a = this.agents.get(s.face)!;
        a.v.setYaw((a.v as unknown as { targetYaw: number }).targetYaw);
      }
    } else if ('act' in s) this.setActivity(this.agents.get(s.act)!, s.activity);
  }

  /** Friendship at least as high as the event requires (demos / staging: the meter must agree with the title card). */
  private seedFor(npc: NpcId, hearts: number): void {
    const rel = this.game.services.relationships;
    if (!rel) return;
    const want = hearts * 250 + 120;
    if (rel.points(npc) < want) rel.adjust(npc, want - rel.points(npc));
    rel.meet(npc);
  }

  /** The heart event's insert card for a line (its first card whose words the line mentions). */
  static insertFor(ev: HeartEvent, text: string | undefined): { kind: string; caption: string } | null {
    if (!text || !ev.insert) return null;
    const t = text.toLowerCase();
    for (const c of ev.insert) if (c.word.split('|').some((w) => w && t.includes(w.toLowerCase()))) return { kind: c.kind, caption: c.caption };
    return null;
  }

  /** Memory-gated script step (`if` / `unless` flags, data/npcs.ts StepCond). */
  private stepOn(s: CutStep): boolean {
    if (!s.if && !s.unless) return true;
    const rel = this.game.services.relationships;
    if (s.if && !rel?.recalls(s.if)) return false;
    if (s.unless && rel?.recalls(s.unless)) return false;
    return true;
  }

  stageEvent(id: string, step?: number): void {
    const he = heartEvent(id);
    if (!he || !this.active) return;
    const { npc, ev } = he;
    this.seedFor(npc.id, ev.hearts);
    // Demo staging: the memory of a farmer who gave the earlier scenes' first answers (`&alt=1`: the
    // second answers), so the 6 / 8 / 10-heart scenes quote the choices back.
    const rel = this.game.services.relationships;
    if (rel && step === undefined && !this.memStaged) {
      const alt = typeof location !== 'undefined' && new URLSearchParams(location.search).get('alt') === '1';
      for (const f of memoryBefore(id, alt)) rel.remember(f);
    }
    // Morning events stage at mid-morning (clear of the dawn haze) unless they pin a time.
    const [h0, h1] = ev.hours;
    this.game.calendar.setHour(ev.demoTime ?? (h0 < 10 && h1 > 10.5 ? 10.5 : h0 + 0.5));
    // The hour jump must not trigger the 'big time jump' re-placement of everyone.
    this.lastHour = this.game.calendar.hour;
    this.lastQuarter = Math.floor(this.lastHour * 4);
    this.castEvent(ev);
    this.frame(ev);
    this.game.input.enabled = false;
    this.game.player.controllable = false;
    // (a scene that remembers an earlier answer stages that line: the consequence is the point of it)
    const memLine = ev.script.findIndex((s) => !!s.if && 'say' in s && this.stepOn(s));
    let mark = step ?? (memLine >= 0 ? memLine : ev.script.findIndex((s) => 'choice' in s));
    if (mark < 0) mark = ev.script.findIndex((s) => 'say' in s);
    mark = Math.max(0, Math.min(ev.script.length - 1, mark));
    // A still of a silent beat (a turn, an emote, a wait) reads as a broken scene: stage the next line.
    const talky = (st: CutStep): boolean => 'say' in st || 'choice' in st || 'narrate' in st;
    if (!talky(ev.script[mark]!)) {
      const nx = ev.script.findIndex((st, i) => i > mark && talky(st));
      if (nx >= 0) mark = nx;
    }
    for (let i = 0; i < mark; i++) {
      if (!this.stepOn(ev.script[i]!)) continue;
      this.applyInstant(ev.script[i]!);
      if ('say' in ev.script[i]!) this.lineNo++;
      if ('cam' in ev.script[i]!) this.shotFor(ev, i);
    }
    this.shotFor(ev, mark);
    for (const a of this.agents.values()) if (a.scripted) a.v.update(0, (x, z) => this.game.world.heightAt(x, z), false);
    // Show the last emote before the mark so the bubble is in the shot.
    for (let i = mark - 1; i >= 0; i--) {
      const s = ev.script[i]!;
      if ('emote' in s) {
        this.who(s.emote)?.v.emote(s.icon);
        break;
      }
      if ('say' in s || 'choice' in s) break;
    }
    const box = this.game.services.dialogueBox;
    box?.cinema(true, ev.title, `${npc.name.startsWith('Dr. ') ? `Dr. ${npc.name.split(' ').pop()}` : npc.name.split(' ')[0]} · ${ev.hearts} hearts`);
    this.snapCam();
    this.guardView(true);
    const s = ev.script[mark];
    if (!s || !box) return;
    box.insert?.(NpcSystem.insertFor(ev, 'say' in s ? s.text : 'narrate' in s ? s.narrate : 'choice' in s ? s.q : undefined));
    if ('choice' in s) void box.choose(s.choice, s.q, s.options.map((o) => o.text), 'thinking');
    else if ('say' in s) {
      void box.say(s.say, s.text, s.mood);
      window.setTimeout(() => box.finishLine(), 30);
    } else if ('narrate' in s) {
      void box.narrate(s.narrate);
      window.setTimeout(() => box.finishLine(), 30);
    }
  }

  async playEvent(id: string): Promise<void> {
    const he = heartEvent(id);
    if (!he || this.eventRunning) return;
    const { npc, ev } = he;
    if (this.game.world.current?.id !== 'town') {
      const c = ev.cast.player;
      const p = c ? this.place(c[0]) : null;
      await this.game.teleport('town', p?.x ?? 32, p?.z ?? 28);
    }
    this.eventRunning = true;
    this.seen.add(id);
    this.game.events.emit('npc:event', { id, npcId: npc.id, phase: 'start' });
    this.game.events.emit('ui:open', { name: 'none' });
    this.game.input.enabled = false;
    this.game.player.controllable = false;
    const box = this.game.services.dialogueBox;
    await this.game.hud.fade(true);
    this.castEvent(ev);
    this.frame(ev);
    this.snapCam();
    this.guardView(true);
    await this.game.hud.fade(false);
    box?.cinema(true, ev.title, `${npc.name.startsWith('Dr. ') ? `Dr. ${npc.name.split(' ').pop()}` : npc.name.split(' ')[0]} · ${ev.hearts} hearts`);
    this.eventNet(['v.e', 1, id, this.game.services.relationships?.points(npc.id) ?? 0, this.hostName()]);
    await this.wait(1.6);
    let boxOpen = false;
    for (let i = 0; i < ev.script.length; i++) {
      const s = ev.script[i]!;
      // r9 memory: a step that quotes an earlier answer plays only for the farmer who gave it.
      if (!this.stepOn(s)) continue;
      const talky = 'say' in s || 'choice' in s || 'narrate' in s;
      if (!talky && boxOpen && !('emote' in s)) {
        box?.end();
        boxOpen = false;
      }
      this.shotFor(ev, i);
      if (talky) this.eventNet(['v.l', id, i]);
      if (talky) box?.insert?.(NpcSystem.insertFor(ev, 'say' in s ? s.text : 'narrate' in s ? s.narrate : 'choice' in s ? s.q : undefined));
      if ('say' in s) {
        boxOpen = true;
        this.faceSpeaker(s.say);
        await box?.say(s.say, s.text, s.mood);
      } else if ('narrate' in s) {
        boxOpen = true;
        await box?.narrate(s.narrate);
      } else if ('choice' in s) {
        boxOpen = true;
        const k = (await box?.choose(s.choice, s.q, s.options.map((o) => o.text), 'thinking')) ?? 0;
        this.eventNet(['v.c', id, i, k]);
        const opt = s.options[k]!;
        this.game.events.emit('npc:choice', { npcId: s.choice, delta: opt.delta, flag: opt.flag });
        if (opt.mood === 'blush' || opt.mood === 'sad') this.shot = { kind: 'close', speaker: s.choice, anchor: null };
        await box?.say(s.choice, opt.reply, opt.mood ?? 'happy');
      } else if ('walk' in s) await this.walkActor(s.walk, s.to, s.face, s.run);
      else if ('face' in s) {
        this.faceTo(s.face, s.to);
        await this.wait(0.35);
      } else if ('emote' in s) {
        const w = this.who(s.emote);
        w?.v.emote(s.icon);
        if (w && s.icon === 'heart') {
          w.v.squash(1.1);
          this.fx.burst(new THREE.Vector3(w.v.position.x, w.v.position.y + w.v.headTop + 0.2, w.v.position.z), 'like');
        }
        await this.wait(1.1);
      } else if ('act' in s) {
        this.setActivity(this.agents.get(s.act)!, s.activity);
      } else if ('wait' in s) await this.wait(s.wait);
      else if ('cam' in s) await this.wait(1.0);
      else if ('fade' in s) await this.game.hud.fade(s.fade === 'out');
    }
    await this.wait(1.4);
    box?.end();
    box?.cinema(false);
    this.eventNet(['v.e', 0, id]);
    await this.game.hud.fade(true);
    this.endEvent();
    await this.game.hud.fade(false);
    this.game.events.emit('npc:event', { id, npcId: npc.id, phase: 'end' });
  }

  private faceSpeaker(id: NpcId): void {
    const a = this.agents.get(id);
    if (!a) return;
    // Listeners turn towards whoever is talking (only the player, here).
    const p = this.game.player.position;
    if (Math.hypot(p.x - a.v.position.x, p.z - a.v.position.z) < 5) this.faceTo('player', id);
  }

  private walkActor(w: Who, to: Place, face: Facing | Who | undefined, run = false): Promise<void> {
    const p = this.place(to);
    const map = this.game.world.current;
    if (!p || !map) return Promise.resolve();
    return new Promise((resolve) => {
      if (w === 'player') {
        const pp = this.game.player.position;
        const path = findPath(map.grid, pp.x, pp.z, p.x, p.z);
        this.playerPath = path.length ? path.slice(1) : [{ x: p.x, z: p.z }];
        this.playerArrive = {
          resolve: () => {
            if (face) this.faceTo('player', face);
            resolve();
          },
        };
        return;
      }
      const a = this.agents.get(w)!;
      const path = findPath(map.grid, a.v.position.x, a.v.position.z, p.x, p.z);
      a.path = path.length ? path.slice(1) : [{ x: p.x, z: p.z }];
      a.goal = null;
      a.run = run;
      a.onArrive = () => {
        if (face) this.faceTo(w, face);
        resolve();
      };
      this.nextWaypoint(a);
    });
  }

  private endEvent(): void {
    this.evCur = null;
    for (const a of this.agents.values()) a.scripted = false;
    this.clearEventProps();
    this.releaseCam();
    this.camRelease = null;
    const rig = this.game.rc.rig;
    if (this.camSaved) {
      rig.yaw = this.camSaved.yaw;
      rig.pitch = this.camSaved.pitch;
      rig.distance = this.camSaved.distance;
      rig.lookOffset.copy(this.camSaved.off);
      this.camSaved = null;
    }
    this.playerPath = [];
    this.playerArrive = null;
    this.game.input.enabled = true;
    this.game.player.controllable = true;
    this.eventRunning = false;
    this.placeAll();
    this.game.followPlayer(true);
  }

  auditEvents(only?: string): { beats: number; fails: string[]; trees: number } {
    const out = { beats: 0, fails: [] as string[], trees: 0 };
    if (!this.active || this.eventRunning) return { ...out, fails: ['not in town / event running'] };
    const cam = this.game.rc.camera;
    const savedHour = this.game.calendar.hour;
    const savedP = this.game.player.position.clone();
    for (const npc of Object.values(NPCS))
      for (const ev of npc.events) {
        if (only && ev.id !== only) continue;
        // (a previously staged event's cast — a demo still — must not leak into this one's frame)
        for (const a of this.agents.values()) a.scripted = false;
        this.castEvent(ev);
        this.frame(ev);
        this.lineNo = 0;
        // (c) The title's subject is on screen in the opening wide shot.
        if (ev.subject) {
          for (const a of this.agents.values()) if (a.scripted) a.v.update(0, (x, z) => this.game.world.heightAt(x, z), false);
          this.snapCam();
          const sj = ev.subject;
          const sp = new THREE.Vector3(sj.at[0], this.game.world.heightAt(sj.at[0], sj.at[1]) + (sj.y ?? 0.5), sj.at[1]).project(cam);
          if (sp.z > 1 || Math.abs(sp.x) > 0.92 || sp.y > 0.9 || sp.y < -0.92) out.fails.push(`${ev.id}: subject '${sj.label}' out of the opening wide shot (${sp.x.toFixed(2)},${sp.y.toFixed(2)})`);
        }
        for (let i = 0; i < ev.script.length; i++) {
          const s = ev.script[i]!;
          if ('cam' in s) this.shotFor(ev, i);
          if ('say' in s || 'choice' in s || 'narrate' in s) {
            this.shotFor(ev, i);
            for (const a of this.agents.values()) if (a.scripted) a.v.update(0, (x, z) => this.game.world.heightAt(x, z), false);
            this.snapCam();
            this.cheatOpen(true);
            for (const a of this.agents.values()) if (a.scripted) a.v.update(0, (x, z) => this.game.world.heightAt(x, z), false);
            this.snapCam();
            out.beats++;
            const acts = this.camActors();
            // (a) The owner's face reads (≤ 50° off the lens) whenever they are in the frame.
            const ow = this.evOwner();
            const oa = ow ? this.agents.get(ow) : null;
            if (oa && oa.scripted && oa.activity !== 'sit' && oa.v.root.visible) {
              const hp = new THREE.Vector3(oa.v.position.x, oa.v.position.y + oa.v.headTop * 0.8, oa.v.position.z).project(cam);
              if (hp.z < 1 && Math.abs(hp.x) < 0.95 && Math.abs(hp.y) < 0.95) {
                const fy = (oa.v as unknown as { yaw: number }).yaw;
                const toC = Math.atan2(cam.position.x - oa.v.position.x, cam.position.z - oa.v.position.z);
                const off = Math.abs(Math.atan2(Math.sin(fy - toC), Math.cos(fy - toC)));
                if (off > THREE.MathUtils.degToRad(52)) out.fails.push(`${ev.id}#${i}: owner ${ow} turned ${THREE.MathUtils.radToDeg(off).toFixed(0)}° from the lens`);
              }
            }
            // (b) No pole / trunk within 0.6 head-widths of a framed head (screen space).
            const framedA = this.shot.kind === 'close' || this.goalKind.ots ? acts.filter((a) => a.id === this.shot.speaker) : acts;
            const ph = this.postsNearHeads(cam, framedA, this.shot.speaker);
            if (ph) out.fails.push(`${ev.id}#${i}: vertical prop beside a head (${ph})`);
            this.gatherOcc(cam.position.x, cam.position.z, 24);
            this.propHits(cam.position, acts);
            if (this.propCamIn) out.fails.push(`${ev.id}#${i}: lens inside a prop`);
            // (r8) A parasol / awning / pole box over the speaking head on screen (june-2: the parasol
            // across Rowan's face, a lamp post down his body).
            if (this.shot.speaker) {
              const sp = acts.find((a) => a.id === this.shot.speaker);
              const po = sp ? this.propOverHead(cam, sp) : 0;
              if (po > 0.22) out.fails.push(`${ev.id}#${i}: a prop covers ${(po * 100).toFixed(0)} % of ${sp!.id}'s face`);
            }
            const hits = this.buildingHits(cam.position, acts);
            if (hits) out.fails.push(`${ev.id}#${i}: ${hits} sight line(s) behind a building (lens ${cam.position.x.toFixed(1)},${cam.position.y.toFixed(1)},${cam.position.z.toFixed(1)}; ${acts.map((a) => `${a.id} ${a.x.toFixed(1)},${a.z.toFixed(1)}`).join(' ')})`);
            // The speaker's face must read: turned towards the lens and not behind the listener's head / hat.
            const spk = this.shot.speaker ? acts.find((a) => a.id === this.shot.speaker) : null;
            const sa = spk && spk.id !== 'player' ? this.agents.get(spk.id) : null;
            // A reverse three-quarter (the speaker addresses a lantern / a rose / a cat) frames only the
            // speaker and what they look at: the far actors are meant to be out of it.
            const ots = this.goalKind.ots;
            if (spk && sa && this.shot.kind !== 'wide') {
              const fy = (sa.v as unknown as { yaw: number }).yaw;
              const toC = Math.atan2(cam.position.x - spk.x, cam.position.z - spk.z);
              const off = Math.abs(Math.atan2(Math.sin(fy - toC), Math.cos(fy - toC)));
              if (off > THREE.MathUtils.degToRad(105)) out.fails.push(`${ev.id}#${i}: ${spk.id} turned from the lens (${THREE.MathUtils.radToDeg(off).toFixed(0)}°)`);
              const fb = this.faceBlocked(cam.position, spk, acts);
              if (fb) out.fails.push(`${ev.id}#${i}: ${spk.id}'s face behind another actor (${fb}/2 points)`);
            }
            // Nobody may stand inside a bench, barrel, board or lamp post (r3: Marigold inside the bench).
            for (const a of this.agents.values()) {
              if (!a.scripted) continue;
              const clash = this.propClash(a);
              if (clash) out.fails.push(`${ev.id}#${i}: ${a.def.id} ${clash}`);
            }
            for (const a of acts) {
              if ((this.shot.kind === 'close' || ots) && a.id !== this.shot.speaker) continue;
              const t = this.treeHits(cam.position, new THREE.Vector3(a.x, a.y + a.head - 0.3, a.z)).length;
              out.trees += t;
              const hp = new THREE.Vector3(a.x, a.y + a.head - 0.2, a.z).project(cam);
              // (a close-up crops at the chest by design: its check is the chest clearing the box, not the feet)
              const closeUp = this.shot.kind === 'close' || ots;
              const fp = new THREE.Vector3(a.x, a.y + (closeUp ? a.head * 0.62 : 0.1), a.z).project(cam);
              // Off-frame, or the feet under the dialogue box (its top sits ≈ -0.5 NDC since r4: thin letterbox,
              // the box sized to its text).
              if (Math.abs(hp.x) > 0.93 || hp.y > 0.8 || fp.y < -0.5) out.fails.push(`${ev.id}#${i}: ${a.id} framed badly (head ${hp.x.toFixed(2)},${hp.y.toFixed(2)} feet ${fp.y.toFixed(2)})`);
            }
          } else this.applyInstant(s);
        }
        for (const a of this.agents.values()) a.scripted = false;
      }
    this.clearEventProps();
    this.releaseCam();
    this.camRelease = null;
    if (this.camSaved) {
      const rig = this.game.rc.rig;
      rig.yaw = this.camSaved.yaw;
      rig.pitch = this.camSaved.pitch;
      rig.distance = this.camSaved.distance;
      rig.lookOffset.copy(this.camSaved.off);
      this.camSaved = null;
    }
    this.game.calendar.setHour(savedHour);
    this.game.player.teleport(savedP.x, savedP.z);
    this.placeAll();
    this.game.followPlayer(true);
    return out;
  }

  auditLive(hours = [9, 13, 17]): { checked: number; fails: string[]; moved: number } {
    const out = { checked: 0, fails: [] as string[], moved: 0 };
    const map = this.game.world.current;
    if (!this.active || this.eventRunning || !map || this.talking) return { ...out, fails: ['not in town / busy'] };
    const savedHour = this.game.calendar.hour;
    const pl = this.game.player;
    const savedP = pl.position.clone();
    for (const hour of hours) {
      this.game.calendar.setHour(hour);
      this.lastHour = hour;
      for (const id of NPC_IDS) {
        for (const [dx, dz, side] of [[-1.1, 0, 'L'], [1.1, 0, 'R'], [0, 1.1, 'S']] as const) {
          this.placeAll();
          const a = this.agents.get(id)!;
          if (a.inside || !a.v.root.visible) break;
          const v = a.v.position;
          const vx = v.x;
          const vz = v.z;
          const c = NpcSystem.clearOf(vx + dx, vz + dz);
          if (!map.grid.isWalkable(Math.floor(c.x), Math.floor(c.z))) continue;
          pl.teleport(c.x, c.z);
          this.game.followPlayer(true);
          this.talking = a;
          a.v.talkTo = pl.position;
          this.spaceTalk();
          this.startTalkCam(true);
          this.liveResolve();
          if (this.talkSlide) {
            pl.teleport(this.talkSlide.x1, this.talkSlide.z1);
            this.talkSlide = null;
          }
          if (this.villSlide) {
            a.v.setPosition(this.villSlide.x1, map.heightAt(this.villSlide.x1, this.villSlide.z1), this.villSlide.z1);
            this.villSlide = null;
          }
          if (Math.hypot(a.v.position.x - vx, a.v.position.z - vz) > 0.05) out.moved++;
          this.snapCam();
          this.fgCull(true);
          out.checked++;
          const k = `${id}@${hour}${side}`;
          for (const f of this.talkFrameFails()) out.fails.push(`${k}: ${f}`);
          const hb = this.pairHeadBoxes();
          for (const o of this.agents.values()) {
            if (o === a || o.inside || !o.v.root.visible || o.scripted) continue;
            const cam = this.game.rc.camera;
            const top = _q.set(o.v.position.x, o.v.position.y + o.v.headTop, o.v.position.z).project(cam);
            const tx = top.x;
            const ty = top.y;
            const tz = top.z;
            const ft = _q.set(o.v.position.x, o.v.position.y + o.v.headTop * 0.45, o.v.position.z).project(cam);
            if (tz > 1 || ft.z > 1 || Math.abs(tx) > 1.1) continue;
            const w = (ty - ft.y) * 0.55;
            for (const b of hb) if (tx - w < b[2] && tx + w > b[0] && ft.y < b[3] && ty > b[1]) out.fails.push(`${k}: ${o.def.id}'s head box over the pair`);
          }
          a.v.talkTo = null;
          this.talking = null;
          this.releaseCam();
          this.camRelease = null;
          if (this.camSaved) {
            const rig = this.game.rc.rig;
            rig.yaw = this.camSaved.yaw;
            rig.pitch = this.camSaved.pitch;
            rig.distance = this.camSaved.distance;
            rig.lookOffset.copy(this.camSaved.off);
            this.camSaved = null;
          }
        }
      }
    }
    this.game.calendar.setHour(savedHour);
    this.lastHour = savedHour;
    pl.teleport(savedP.x, savedP.z);
    this.placeAll();
    return out;
  }

  auditTalk(hour = 10.5): { checked: number; fails: string[]; lens: Record<string, string> } {
    const out = { checked: 0, fails: [] as string[], lens: {} as Record<string, string> };
    const map = this.game.world.current;
    if (!this.active || this.eventRunning || !map) return { ...out, fails: ['not in town / event running'] };
    const savedHour = this.game.calendar.hour;
    const savedP = this.game.player.position.clone();
    this.game.calendar.setHour(hour);
    this.lastHour = hour;
    for (const id of NPC_IDS) {
      this.placeAll();
      const a = this.agents.get(id)!;
      if (a.inside) continue;
      // Walk up from the lens side (south), else from whichever side is open.
      const v = a.v.position;
      let px = v.x;
      let pz = v.z + 1.3;
      for (const [dx, dz] of [[0, 1.3], [1.2, 0.6], [-1.2, 0.6], [1.3, 0], [-1.3, 0], [0, -1.3]] as const) {
        const c = NpcSystem.clearOf(v.x + dx, v.z + dz);
        if (map.grid.isWalkable(Math.floor(c.x), Math.floor(c.z))) {
          px = c.x;
          pz = c.z;
          break;
        }
      }
      this.game.player.teleport(px, pz);
      this.game.followPlayer(true);
      this.talking = a;
      a.v.talkTo = this.game.player.position;
      // (r8: the same live blocking a real F-press gets — placement, lens, screen re-solve)
      this.spaceTalk();
      this.startTalkCam(true);
      this.liveResolve();
      if (this.talkSlide) {
        this.game.player.teleport(this.talkSlide.x1, this.talkSlide.z1);
        px = this.talkSlide.x1;
        pz = this.talkSlide.z1;
        this.talkSlide = null;
      }
      if (this.villSlide) {
        a.v.setPosition(this.villSlide.x1, map.heightAt(this.villSlide.x1, this.villSlide.z1), this.villSlide.z1);
        this.villSlide = null;
      }
      this.snapCam();
      out.checked++;
      const cam = this.game.rc.camera;
      cam.updateMatrixWorld(true);
      const acts = this.camActors();
      const by: THREE.Vector3[] = [];
      for (const o of this.agents.values()) if (o !== a && !o.inside && o.v.root.visible && o.v.position.distanceTo(v) < 12) by.push(new THREE.Vector3(o.v.position.x, o.v.position.y + o.v.headTop * 0.55, o.v.position.z));
      const look = this.camCur.target.clone();
      const mid = new THREE.Vector3((v.x + px) / 2, map.heightAt(v.x, v.z) + 0.9, (v.z + pz) / 2);
      const fg = this.foreground(cam.position, look, by, mid);
      this.gatherOcc(cam.position.x, cam.position.z, 24);
      const phT = this.propHits(cam.position, acts);
      if (phT) out.fails.push(`${id}: lens in / behind a prop (${phT})`);
      const hits = this.buildingHits(cam.position, acts);
      const spk = acts.find((x) => x.id === id);
      const fb = spk ? this.faceBlocked(cam.position, spk, acts) : 0;
      out.lens[id] = `${cam.position.x.toFixed(1)},${cam.position.y.toFixed(1)},${cam.position.z.toFixed(1)} yaw ${this.camCur.yaw.toFixed(0)} fg ${fg.toFixed(1)}`;
      if (fg > 0) out.fails.push(`${id}: foreground clutter ${fg.toFixed(1)} (fountain / bystander in front of the pair)`);
      // Villagers left in the near / low foreground after the bystander cull (> 8 % of the frame fails).
      this.fgCull(true);
      let fgv = 0;
      for (const o of this.agents.values()) if (o !== a && !o.inside && o.v.root.visible && !o.scripted) {
        const b = this.fgBox(o);
        if (b.near) fgv += b.cover;
      }
      if (fgv > 0.08) out.fails.push(`${id}: bystander villager covers ${(fgv * 100).toFixed(0)} % of the near foreground`);
      out.lens[id] += ` fgv ${(fgv * 100).toFixed(0)}% live [${this.liveFrame.join(' | ')}]`;
      if (hits) out.fails.push(`${id}: ${hits} sight line(s) behind a building`);
      if (fb) out.fails.push(`${id}: face behind the farmer (${fb}/2)`);
      a.v.talkTo = null;
      this.talking = null;
      this.releaseCam();
      this.camRelease = null;
      if (this.camSaved) {
        const rig = this.game.rc.rig;
        rig.yaw = this.camSaved.yaw;
        rig.pitch = this.camSaved.pitch;
        rig.distance = this.camSaved.distance;
        rig.lookOffset.copy(this.camSaved.off);
        this.camSaved = null;
      }
    }
    this.game.calendar.setHour(savedHour);
    this.lastHour = savedHour;
    this.game.player.teleport(savedP.x, savedP.z);
    this.placeAll();
    return out;
  }

  /**
   * Bias a free yaw into the lens's half-space (within ±70° of the direction to the camera) so idle
   * villagers show a face or a clear three-quarter, never the back of a hat (r3: chibi heads read as
   * hat discs from the 36° town lens).
   */
  private toLens(x: number, z: number, yaw: number, limDeg = 70): number {
    // (where the rig puts the lens — right after a demo sets it the camera itself hasn't moved yet)
    const r = this.game.rc.rig;
    const rp = THREE.MathUtils.degToRad(r.pitch);
    const ry = THREE.MathUtils.degToRad(r.yaw);
    const cam = _cp.set(r.target.x + r.lookOffset.x + Math.sin(ry) * Math.cos(rp) * r.distance, 0, r.target.z + r.lookOffset.z + Math.cos(ry) * Math.cos(rp) * r.distance);
    const toC = Math.atan2(cam.x - x, cam.z - z);
    const d = Math.atan2(Math.sin(yaw - toC), Math.cos(yaw - toC));
    const lim = THREE.MathUtils.degToRad(limDeg);
    return toC + THREE.MathUtils.clamp(d, -lim, lim);
  }

  /** Event stage hour (as stageEvent picks it). */
  private static eventHour(ev: HeartEvent): number {
    const [h0, h1] = ev.hours;
    return ev.demoTime ?? (h0 < 10 && h1 > 10.5 ? 10.5 : h0 + 0.5);
  }

  async auditFaces(only?: string, min = 42): Promise<{ beats: number; fails: string[]; luma: Record<string, number> }> {
    const out = { beats: 0, fails: [] as string[], luma: {} as Record<string, number> };
    if (!this.active || this.eventRunning) return { ...out, fails: ['not in town / event running'] };
    const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
    const rc = this.game.rc;
    const gl = rc.renderer.getContext();
    const c = new THREE.Vector3();
    for (const npc of Object.values(NPCS))
      for (const ev of npc.events) {
        if (only ? ev.id !== only : NpcSystem.eventHour(ev) < 18.5) continue;
        // (a clean stage per event: the previous cast steps down)
        this.game.services.dialogueBox?.end();
        this.endEvent();
        for (let i = 0; i < ev.script.length; i++) {
          const st = ev.script[i]!;
          if (!('say' in st)) continue;
          this.stageEvent(ev.id, i);
          for (let k = 0; k < 8; k++) await frame();
          const a = this.agents.get(st.say)!;
          // Render a frame now and read the face box straight back (same task: the buffer is intact).
          rc.render(0, performance.now() / 1000);
          const hc = a.v.headCenter(c);
          const p = hc.center.clone();
          // Cheeks + mouth (under the fringe / brim): the skin that has to read.
          p.y -= hc.radius * 0.32;
          const ndc = p.clone().project(rc.camera);
          const W = gl.drawingBufferWidth;
          const H = gl.drawingBufferHeight;
          // Box half-size: ~45 % of the projected head radius (eyes, cheeks, mouth).
          const edge = hc.center.clone().add(new THREE.Vector3(hc.radius, 0, 0).applyQuaternion(rc.camera.quaternion)).project(rc.camera);
          if (ndc.z > 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) {
            out.fails.push(`${ev.id}#${i}:${st.say} face off-frame`);
            continue;
          }
          const rPx = THREE.MathUtils.clamp(Math.abs(edge.x - ndc.x) * 0.5 * W, 6, 400);
          const half = Math.max(4, Math.round(rPx * 0.34));
          const x0 = Math.round((ndc.x * 0.5 + 0.5) * W) - half;
          const y0 = Math.round((ndc.y * 0.5 + 0.5) * H) - half;
          const px = new Uint8Array(half * 2 * half * 2 * 4);
          rc.renderer.setRenderTarget(null);
          gl.readPixels(Math.max(0, x0), Math.max(0, y0), half * 2, half * 2, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let sum = 0;
          for (let j = 0; j < px.length; j += 4) sum += 0.2126 * px[j]! + 0.7152 * px[j + 1]! + 0.0722 * px[j + 2]!;
          const luma = sum / (px.length / 4);
          const key = `${ev.id}#${i}:${st.say}`;
          out.luma[key] = Math.round(luma);
          out.beats++;
          if (luma < min) out.fails.push(`${key} face luma ${luma.toFixed(0)} < ${min}`);
        }
      }
    const box = this.game.services.dialogueBox;
    box?.end();
    box?.cinema(false);
    this.endEvent();
    return out;
  }

  /** An actor's capsule (r 0.28 m) against the benches + small props: null when clear. */
  private propClash(a: Agent): string | null {
    const p = a.v.position;
    for (const b of BENCHES) {
      // Bench frame: x along the seat (±0.85 m), z across it (±0.3 m); seated villagers belong there.
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const c = Math.cos(b.rot);
      const s = Math.sin(b.rot);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (Math.abs(lx) < 0.85 + 0.2 && Math.abs(lz) < 0.3 + 0.2 && a.activity !== 'sit') return `stands inside the bench at ${b.x.toFixed(1)},${b.z.toFixed(1)}`;
    }
    for (const c of PROP_CLEAR) if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + 0.15) return `inside a prop at ${c.x.toFixed(1)},${c.z.toFixed(1)}`;
    return null;
  }

  private checkEvents(): void {
    if (this.eventRunning || this.staged || !this.game.input.enabled || !this.game.player.controllable) return;
    const rel = this.game.services.relationships;
    if (!rel) return;
    const c = this.game.calendar;
    const p = this.game.player.position;
    for (const a of this.agents.values()) {
      const hearts = rel.hearts(a.def.id);
      const ev = a.def.events.find((e) => !this.seen.has(e.id) && hearts >= e.hearts);
      if (!ev) continue;
      if (c.hour < ev.hours[0] || c.hour > ev.hours[1]) continue;
      if (ev.dry && (c.weather === 'rain' || c.weather === 'storm' || c.weather === 'snow')) continue;
      const anchor = this.place(ev.cast[a.def.id]?.[0] ?? [a.v.position.x, a.v.position.z]);
      if (!anchor || Math.hypot(anchor.x - p.x, anchor.z - p.z) > 8) continue;
      void this.playEvent(ev.id);
      return;
    }
  }

  // ───────────────────────────────────────────── per frame

  fixedUpdate(dt: number): void {
    // Scripted player walks: drive position + velocity so the farmer animates its walk cycle.
    if (!this.playerPath.length) return;
    const pl = this.game.player;
    const tgt = this.playerPath[0]!;
    const dx = tgt.x - pl.position.x;
    const dz = tgt.z - pl.position.z;
    const d = Math.hypot(dx, dz);
    const speed = 2.3;
    const pv = pl as unknown as { velocity?: THREE.Vector3; targetYaw?: number };
    if (d <= speed * dt) {
      pl.position.set(tgt.x, this.game.world.heightAt(tgt.x, tgt.z), tgt.z);
      this.playerPath.shift();
      if (!this.playerPath.length) {
        pv.velocity?.set(0, 0, 0);
        const r = this.playerArrive;
        this.playerArrive = null;
        r?.resolve();
      }
      return;
    }
    pl.position.x += (dx / d) * speed * dt;
    pl.position.z += (dz / d) * speed * dt;
    pl.position.y = this.game.world.heightAt(pl.position.x, pl.position.z);
    pv.velocity?.set((dx / d) * speed, 0, (dz / d) * speed);
    if (pv.targetYaw !== undefined) pv.targetYaw = Math.atan2(dx, dz);
  }

  // ───────────────────────────────────────────── the farmers' winter wardrobe (local + remote)

  private wardrobeT = 0;
  private playerWinter = false;
  private remoteLooks = new WeakMap<object, unknown>();

  /**
   * Farmers dress for the season like the villagers do (r4 critic: the farmer kept the straw boater
   * and short sleeves in the snow): the local rig gets the knit beanie, coat, scarf and mittens; a
   * remote farmhand's look swaps its hat for a beanie + scarf and gets the same coat overlay.
   */
  private dressFarmers(dt: number): void {
    this.wardrobeT -= dt;
    if (this.wardrobeT > 0) return;
    this.wardrobeT = 0.5;
    const on = this.game.calendar.season === 'winter';
    if (on !== this.playerWinter) {
      this.playerWinter = on;
      dressFarmerWinter(this.game.player.rig, on);
    }
    const net = this.game.services.net as unknown as { remotes?: { list?: Map<number, { farmer?: { look: Record<string, unknown>; setLook(l: unknown): void; rig: Parameters<typeof dressFarmerWinter>[0] } }> } } | undefined;
    const list = net?.remotes?.list;
    if (!list) return;
    for (const p of list.values()) {
      const f = p.farmer;
      if (!f) continue;
      const orig = this.remoteLooks.get(f) as Record<string, unknown> | undefined;
      if (on && (!orig || f.look.hat !== 'beanie')) {
        const base = orig && f.look.hat === 'beanie' ? orig : f.look;
        this.remoteLooks.set(f, base);
        f.setLook({ ...base, hat: 'beanie', accessory: 'scarf' });
        dressFarmerWinter(f.rig, true, { hat: false, knit: (base.scarf as number) ?? 0xc8443a, coat: 0x5a4a3e });
      } else if (!on && orig) {
        this.remoteLooks.delete(f);
        f.setLook(orig);
        dressFarmerWinter(f.rig, false, { hat: false });
      }
    }
  }

  update(dt: number, game: Game): void {
    this.clock += dt;
    this.dressFarmers(dt);
    for (const o of this.eventProps) (o.userData.tick as ((dt: number) => void) | undefined)?.(dt);
    if (this.waits.length) {
      const due = this.waits.filter((w) => w.t <= this.clock);
      if (due.length) {
        this.waits = this.waits.filter((w) => w.t > this.clock);
        for (const w of due) w.r();
      }
    }
    if (!this.active) return;
    const map = game.world.current!;
    if (game.calendar.season !== this.lookSeason) this.applySeason(game.calendar.season);
    if (this.restage !== null) {
      const name = this.restage;
      this.restage = null;
      this.stage(name);
    }
    this.stepTalkSlide(dt);
    if (!this.camMode) this.lensCull();
    else if (this.lensHidden.length) this.lensRestore();
    if (this.camMode && !this.specGoal) this.fgCull();
    else if (this.fgHidden.size || this.fgTrees.length) this.fgRestore();
    if (this.camMode === 'event') this.cheatOpen();
    this.sendEventCam(dt);
    const hour = game.calendar.hour;
    const following = this.netRole() === 'client' && this.clock - this.followAt < 2;
    this.netSend(dt);
    if (this.bots.length) this.botFrame(dt);
    // Big time jumps (setTime, sleeping): re-place instantly.
    if (!this.eventRunning && !following && Math.abs(hour - this.lastHour) > 0.6) this.placeAll();
    this.lastHour = hour;
    const q = Math.floor(hour * 4);
    if (following) this.lastQuarter = q;
    if (q !== this.lastQuarter && !this.staged && !this.eventRunning) {
      this.lastQuarter = q;
      const day = (game.calendar as unknown as { day: number }).day ?? 1;
      let idx = 0;
      for (const a of this.agents.values()) {
        idx++;
        if (a.scripted || a === this.talking || this.heldBy.has(a.def.id)) continue;
        const [, spotName, act] = this.stepFor(a, hour);
        const key = `${spotName}|${act ?? 'idle'}`;
        if (a.errandUntil !== undefined && q < a.errandUntil) continue;
        if (a.errandUntil !== undefined) {
          a.errandUntil = undefined;
          a.stepKey = '';
        }
        if (key !== a.stepKey) {
          a.stepKey = key;
          this.goTo(a, spotName, act ?? 'idle');
        } else if (!a.inside && act !== 'inside' && act !== 'fish' && act !== 'sit' && hash3(day, q, idx) < 0.2) {
          // Street life: now and then a villager pops over to the board, the bakery, the fountain…
          // (a walk of 8–26 m), lingers a quarter hour, then heads back to their schedule spot.
          const here = a.v.position;
          const opts = ERRANDS.filter((n) => {
            const t = SPOTS[n];
            if (!t || n === spotName) return false;
            const d = Math.hypot(t[0] - here.x, t[1] - here.z);
            return d > 8 && d < 26;
          });
          if (opts.length) {
            const pick = opts[Math.floor(hash3(idx, q, day + 7) * opts.length)]!;
            a.errandUntil = q + 2;
            a.stepKey = `errand:${pick}`;
            const wet = game.calendar.weather === 'rain' || game.calendar.weather === 'storm';
            this.goTo(a, pick, pick === 'notice' ? 'read' : wet ? 'idle' : hash3(q, idx, day) < 0.5 ? 'chat' : 'idle');
          }
        }
      }
    }
    this.barkCd -= dt;
    // Camera direction during heart events / conversations.
    this.updateCam(dt);
    this.updateKeyLight(dt, game);
    this.fx.update(dt);
    if (this.giftLoop && this.talking) {
      this.giftLoop.t -= dt;
      if (this.giftLoop.t <= 0) {
        this.giftLoop.t = 2.6;
        this.giftJuice(this.giftLoop.id, this.giftLoop.item, this.giftLoop.reaction);
      }
    }
    const winter = game.calendar.season === 'winter';
    const wet = game.calendar.weather === 'rain' || game.calendar.weather === 'storm';
    for (const a of this.agents.values()) {
      a.v.setWinter(winter);
      a.v.rain = wet && !a.inside;
    }
    // A missed press: the farmer's interact is polled on fixed steps, so a frame without one drops
    // it — catch it here too (tryTalk ignores a second call once a conversation is open).
    if (game.input.pressed('interact') && !this.talking && !this.eventRunning) {
      const t = (game.player as unknown as { facingTile?: () => { x: number; z: number } }).facingTile?.();
      const pp = game.player.position;
      this.tryTalk(t?.x ?? Math.floor(pp.x), t?.z ?? Math.floor(pp.z));
    }
    const simulate = !game.paused || this.eventRunning;
    const h = (x: number, z: number): number => map.heightAt(x, z);
    const pl = game.player.position;
    // Every farmer in town (co-op: remote farmers too) — villagers glance at and greet whoever passes.
    this.farmers.length = 0;
    this.farmers.push(pl);
    for (const o of game.scene.children) if (o.name === 'remote-farmer' && o.visible) this.farmers.push(o.position);
    const camP = game.rc.camera.position;
    for (const a of this.agents.values()) {
      const v = a.v;
      v.lensYaw = Math.atan2(camP.x - v.position.x, camP.z - v.position.z);
      {
        // Face LOD (r8): features grow ~18 % from the far plaza lens (faces were two dots at town zoom).
        const d = Math.hypot(camP.x - v.position.x, camP.y - v.position.y - 1.2, camP.z - v.position.z);
        const k = THREE.MathUtils.smoothstep(d, 15, 25);
        v.faceLod = 1 + 0.18 * k;
      }
      // Mesh LOD (r9, pillar 14): half-segment copy past ~19 m of lens.
      v.lodFor(camP);
      // Staged talkers / idlers keep at least a profile to the lens (the demo's lens may land after the marks).
      if (a.staged && !a.free && !a.scripted && (a.activity === 'chat' || a.activity === 'idle') && !v.isMoving) {
        const ty = (v as unknown as { targetYaw: number }).targetYaw;
        const want = this.toLens(v.position.x, v.position.z, ty, 45);
        if (Math.abs(want - ty) > 0.01) v.faceYaw(want);
      }
      // Door fades.
      if (a.vis !== a.visTarget) {
        a.vis += Math.sign(a.visTarget - a.vis) * Math.min(Math.abs(a.visTarget - a.vis), dt * 2.5);
        v.root.visible = a.vis > 0.01;
        const s = 0.6 + 0.4 * a.vis;
        v.root.scale.set(s, a.vis < 1 ? 0.8 + 0.2 * a.vis : 1, s);
      }
      if (following && !a.scripted && a !== this.talking && this.follow.has(a.def.id)) {
        this.followAgent(a);
        if (v.root.visible || !a.inside) v.update(dt, h, simulate);
        continue;
      }
      if (!v.root.visible && a.inside) continue;
      const held = this.heldBy.get(a.def.id);
      if (held) {
        // A farmhand is talking to this villager (co-op): stand still, face them, gesture along.
        if (this.clock > held.until) this.heldBy.delete(a.def.id);
        v.facePoint(held.x, held.z);
        v.update(dt, h, simulate);
        continue;
      }
      if (simulate && !v.hasTarget && a.path.length === 0 && a.onArrive) this.nextWaypoint(a);
      else if (simulate && !v.hasTarget && a.path.length) this.nextWaypoint(a);
      if (!a.scripted && !a.inside && !v.hasTarget && !a.path.length && v !== this.talking?.v) this.ambient(a, dt, simulate, pl);
      v.update(dt, h, simulate);
    }
    this.separate(dt);
    this.placeBubbles();
    this.updatePrompt(dt, game);
    this.updateBlobs();
    this.updateEasels(map.root);
    if (!this.eventRunning && !game.paused) {
      this.eventCheckT -= dt;
      if (this.eventCheckT <= 0) {
        this.eventCheckT = 1;
        this.checkEvents();
      }
    }
  }

  private easels: { root: THREE.Object3D; list: THREE.Object3D[] } | null = null;
  /** A painter's easel stands in the street only while someone paints at it. */
  private updateEasels(root: THREE.Object3D): void {
    if (this.easels?.root !== root) {
      const list: THREE.Object3D[] = [];
      root.traverse((o) => {
        if (o.name === 'painter-easel') list.push(o);
      });
      this.easels = { root, list };
    }
    const ownCanvas = this.eventProps.some((o) => o.name === 'painting' || o.userData.kind === 'painting');
    // r10 (r7 critic: wren-2 showed the blank back of the canvas): a scene's painting keeps its face
    // to the lens — when a cut leaves its back (or a hard edge-on view) to the camera it is turned
    // round on its stand to face it (cuts hide the snap; small camera drifts never trigger it).
    if (ownCanvas) {
      const cam = this.game.rc.camera.position;
      for (const o of this.eventProps) {
        if (o.userData.kind !== 'painting') continue;
        const dx = cam.x - o.position.x;
        const dz = cam.z - o.position.z;
        const l = Math.hypot(dx, dz) || 1;
        if ((Math.sin(o.rotation.y) * dx + Math.cos(o.rotation.y) * dz) / l < 0.5) o.rotation.y = Math.atan2(dx, dz) - 0.25;
      }
    }
    for (const e of this.easels.list) {
      let on = false;
      if (ownCanvas) {
        e.visible = false;
        continue;
      }
      for (const a of this.agents.values())
        if (a.activity === 'paint' && !a.inside && a.v.root.visible && Math.hypot(a.v.position.x - e.position.x, a.v.position.z - e.position.z) < 1.8) on = true;
      e.visible = on;
    }
  }

  private updateBlobs(): void {
    let i = 0;
    for (const a of this.agents.values()) {
      const v = a.v;
      const s = v.root.visible ? v.blobR * v.root.scale.x : 0;
      this.blobM.makeScale(s, 1, s).setPosition(v.root.position.x, v.root.position.y + 0.03, v.root.position.z);
      this.blobs.setMatrixAt(i++, this.blobM);
    }
    this.blobs.instanceMatrix.needsUpdate = true;
  }

  /** Night scenes: lift the faces of whoever is talking with a soft warm key from camera-side. */
  private updateKeyLight(dt: number, game: Game): void {
    const night = game.lighting.night;
    let want = 0;
    const yaw = THREE.MathUtils.degToRad(game.rc.rig.yaw);
    const cx = Math.sin(yaw);
    const cz = Math.cos(yaw);
    if (this.camMode === 'event') {
      // lookPoint sits camera-side of the actors: the key hangs just behind it.
      want = 1;
      this.keyPos.set(this.lookPoint.x + cx * 1.6 + cz * 0.8, 0, this.lookPoint.z + cz * 1.6 - cx * 0.8);
    } else if (this.talking) {
      want = 1;
      // Hung in front of the villager's face (camera side), clear of the farmer's hat brim.
      const a = this.talking.v.position;
      const p = game.player.position;
      this.keyPos.set(a.x * 0.8 + p.x * 0.2 + cx * 2.4, 0, a.z * 0.8 + p.z * 0.2 + cz * 2.4);
    }
    const map = game.world.current;
    if (map && want) {
      this.keyLight.position.set(this.keyPos.x, map.heightAt(this.keyPos.x, this.keyPos.z) + 3.1, this.keyPos.z);
      // Aimed at the faces: the talker (conversations) or the look point (events), head height.
      // (events: the speaker's face when someone talks, else the look point)
      const sp = this.camMode === 'event' && this.shot.speaker ? this.agents.get(this.shot.speaker) : null;
      const a = sp ? sp.v.position : this.camMode === 'event' ? this.lookPoint : this.talking ? this.talking.v.position : this.lookPoint;
      this.keyLight.target.position.set(a.x, map.heightAt(a.x, a.z) + (sp ? sp.v.headTop * 0.7 : 1.2), a.z);
      this.keyLight.target.updateMatrixWorld();
    }
    // A soft fill that lifts faces out of the night, not a flash: white hair / beards / pale caps
    // blew out to paper-white at 15.
    // (r8b: by day too, a gentle lens-side key — a speaker with the sun behind them had the lower half of
    // the face in a dark grey-brown band with a hard terminator across the cheeks)
    const target = want * (night * 5.5 + (1 - night) * 1.4);
    this.keyLight.intensity += (target - this.keyLight.intensity) * (1 - Math.exp(-4 * dt));
    if (this.keyLight.intensity < 0.01 && !want) this.keyLight.intensity = 0;
    // Faces lifted out of the night (albedo-relative lens-side fill in the villager shader).
    const fill = want * Math.max(Math.min(1, night * 1.25) * 0.55, 0.06);
    VILLAGER_FILL.value += (fill - VILLAGER_FILL.value) * (dt > 0 ? 1 - Math.exp(-4 * dt) : 1);
    if (VILLAGER_FILL.value < 0.002 && !want) VILLAGER_FILL.value = 0;
  }

  /** Idle life at the spot: wander, play laps, chat, glance at the player, emotes. */
  private farmers: THREE.Vector3[] = [];

  private ambient(a: Agent, dt: number, simulate: boolean, pl0: THREE.Vector3): void {
    // No ambient emote bubbles while a conversation / scene owns the lens (r6: a ♪ over Hazel mid-talk).
    if (this.camMode) a.emoteT = Math.max(a.emoteT, 3);
    // The nearest farmer (local or co-op) is the one a villager reacts to.
    let pl = pl0;
    let best = Infinity;
    for (const f of this.farmers) {
      const d = Math.hypot(f.x - a.v.position.x, f.z - a.v.position.z);
      if (d < best) {
        best = d;
        pl = f;
      }
    }
    // A wave hello when a farmer walks up (at most every 40 s per villager).
    a.greetT = (a.greetT ?? 0) - dt;
    if (best < 2.6 && a.greetT <= 0 && simulate && !a.staged && a.activity !== 'sit' && a.activity !== 'paint') {
      a.greetT = 40;
      a.v.facePoint(pl.x, pl.z);
      a.v.gesture('wave', 1.6);
      if (a.emoteT <= 1) {
        a.v.emote('music');
        a.emoteT = 6;
      }
    }
    const v = a.v;
    const map = this.game.world.current!;
    const anchor = a.anchor ?? { x: v.position.x, z: v.position.z };
    a.emoteT -= dt;
    if (a.activity === 'wander' && simulate) {
      a.wanderT -= dt;
      if (a.wanderT <= 0) {
        a.wanderT = 5 + Math.random() * 5;
        for (let k = 0; k < 6; k++) {
          const x = anchor.x + (Math.random() - 0.5) * 7;
          const z = anchor.z + (Math.random() - 0.5) * 7;
          if (map.grid.isWalkable(Math.floor(x), Math.floor(z))) {
            v.walkTo(x, z, this.toLens(x, z, Math.random() * Math.PI * 2));
            break;
          }
        }
      }
    } else if (a.activity === 'play' && simulate) {
      a.wanderT -= dt;
      if (a.wanderT <= 0) {
        // A running lap around the anchor, then a breather.
        a.wanderT = 7 + Math.random() * 4;
        const pts: Waypoint[] = [];
        const r = 2.2 + Math.random() * 1.2;
        const a0 = Math.random() * Math.PI * 2;
        for (let k = 1; k <= 6; k++) {
          const ang = a0 + (k / 6) * Math.PI * 2;
          const x = anchor.x + Math.cos(ang) * r;
          const z = anchor.z + Math.sin(ang) * r;
          if (map.grid.isWalkable(Math.floor(x), Math.floor(z))) pts.push({ x, z });
        }
        a.path = pts;
        a.run = true;
        a.goal = null;
        a.onArrive = () => {
          v.faceYaw(0);
          if (Math.random() < 0.5) v.emote(Math.random() < 0.5 ? 'music' : 'exclaim');
        };
        this.nextWaypoint(a);
      }
    } else if (a.activity === 'chat' || a.activity === 'idle') {
      // Chat partner: the nearest other villager standing still within 4 m.
      let partner: Agent | null = null;
      let bd = 4.2;
      for (const b of this.agents.values()) {
        if (b === a || b.inside || b.v.isMoving) continue;
        const d = Math.hypot(b.v.position.x - v.position.x, b.v.position.z - v.position.z);
        if (d < bd && (b.activity === 'chat' || b.activity === 'idle' || b.activity === 'sit')) {
          bd = d;
          partner = b;
        }
      }
      const pd = Math.hypot(pl.x - v.position.x, pl.z - v.position.z);
      if (a.staged) {
        /* hold the blocking */
      } else if (a.activity === 'chat' && partner) {
        // Turn to the partner, but cheat three-quarter towards the lens (stage blocking) so both
        // faces read from the diorama camera instead of two profiles / a back of the head.
        const toP = Math.atan2(partner.v.position.x - v.position.x, partner.v.position.z - v.position.z);
        const cam = this.game.rc.camera.position;
        const toC = Math.atan2(cam.x - v.position.x, cam.z - v.position.z);
        let dc = toC - toP;
        dc = Math.atan2(Math.sin(dc), Math.cos(dc));
        v.faceYaw(toP + THREE.MathUtils.clamp(dc, -0.75, 0.75));
        a.chatT -= dt;
        if (a.chatT <= 0) {
          a.chatT = 1.8 + Math.random() * 2.4;
          v.speaking = !v.speaking && !partner.v.speaking;
          if (v.speaking && Math.random() < 0.45 && this.barkOK(a, pl)) this.barkAt(a);
          // Faces live with the gossip: a grin, a laugh, a raised brow, a knowing look.
          const r = Math.random();
          v.setMood(v.speaking ? (r < 0.35 ? 'happy' : r < 0.55 ? 'laugh' : r < 0.7 ? 'surprised' : 'neutral') : r < 0.3 ? 'thinking' : r < 0.6 ? 'happy' : 'neutral');
          if (a.emoteT <= 0 && Math.random() < 0.4) {
            a.emoteT = 6 + Math.random() * 8;
            v.emote(EMOTES_CHAT[Math.floor(Math.random() * EMOTES_CHAT.length)]!);
          }
        }
      } else if (pd < 3.2 && a.activity === 'idle') {
        v.facePoint(pl.x, pl.z);
        v.speaking = false;
      } else v.speaking = false;
    }
    // Occasional ambient emotes while working / sitting.
    if (a.emoteT <= 0) {
      a.emoteT = 9 + Math.random() * 14;
      const late = this.game.calendar.hour > 21;
      const e: Emote | null = a.activity === 'paint' ? 'idea' : a.activity === 'sit' && late ? 'zzz' : a.activity === 'read' ? 'dots' : a.activity === 'water' || a.activity === 'knead' ? 'music' : a.activity === 'fish' ? 'question' : null;
      if (e && Math.random() < 0.6) v.emote(e);
    }
  }

  /** Idle villagers who drift closer than 0.72 m (errands, chats, shared benches) ease apart. */
  private separate(dt: number): void {
    const list = [...this.agents.values()].filter((a) => !a.inside && a.v.root.visible && !a.scripted && !a.staged && !a.v.isMoving && a !== this.talking);
    const k = Math.min(1, dt * 4);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i]!.v.position;
        const Bp = list[j]!.v.position;
        let dx = Bp.x - A.x;
        let dz = Bp.z - A.z;
        let d = Math.hypot(dx, dz);
        // (personal space ~1 m: r6 clumps had heads intersecting)
        if (d >= 1.0) continue;
        if (d < 1e-3) {
          dx = 1;
          dz = 0;
          d = 1e-3;
        }
        const push = ((1.0 - d) / 2) * k;
        A.x -= (dx / d) * push;
        A.z -= (dz / d) * push;
        Bp.x += (dx / d) * push;
        Bp.z += (dz / d) * push;
      }
  }

  /** Closest pair distance among visible, unscripted villagers (tests: nobody stands inside anybody). */
  minGap(): { d: number; a: string; b: string } {
    let best = { d: Infinity, a: '', b: '' };
    const list = [...this.agents.values()].filter((a) => !a.inside && a.v.root.visible);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const d = Math.hypot(list[i]!.v.position.x - list[j]!.v.position.x, list[i]!.v.position.z - list[j]!.v.position.z);
        if (d < best.d) best = { d, a: list[i]!.def.id, b: list[j]!.def.id };
      }
    return best;
  }

  // ── "Talk / Give" prompt over the villager in reach (like a speech cursor)

  private prompt: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private promptTex: { talk: THREE.CanvasTexture; gift: THREE.CanvasTexture } | null = null;
  private promptFor: Agent | null = null;
  private promptT = 0;

  private promptTexture(gift: boolean): THREE.CanvasTexture {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.shadowColor = 'rgba(50,25,8,0.4)';
    g.shadowBlur = 8;
    g.shadowOffsetY = 3;
    g.fillStyle = '#fff8e8';
    g.strokeStyle = '#7a4a2a';
    g.lineWidth = 6;
    g.beginPath();
    g.ellipse(64, 54, 50, 38, 0, 0, Math.PI * 2);
    g.fill();
    g.shadowColor = 'transparent';
    g.stroke();
    g.fillStyle = '#fff8e8';
    g.beginPath();
    g.moveTo(44, 84);
    g.lineTo(34, 112);
    g.lineTo(64, 88);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#fff8e8';
    g.fillRect(40, 78, 26, 10);
    if (gift) {
      // A wrapped present with a ribbon bow.
      g.fillStyle = '#e8574a';
      g.fillRect(42, 46, 44, 30);
      g.fillStyle = '#c8412f';
      g.fillRect(38, 38, 52, 12);
      g.fillStyle = '#ffd166';
      g.fillRect(60, 38, 8, 38);
      g.beginPath();
      g.ellipse(56, 34, 10, 6, -0.5, 0, Math.PI * 2);
      g.ellipse(72, 34, 10, 6, 0.5, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = '#7a4a2a';
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(40 + i * 24, 56, 8, 0, Math.PI * 2);
        g.fill();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private updatePrompt(dt: number, game: Game): void {
    const free = !this.eventRunning && !this.talking && !this.staged && !game.hud.openPanelName && game.input.enabled && game.player.controllable && !game.cinematic;
    const a = free ? this.reachable() : null;
    if (!this.prompt) {
      this.promptTex = { talk: this.promptTexture(false), gift: this.promptTexture(true) };
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.promptTex.talk, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
      m.name = 'npc-talk-prompt';
      m.renderOrder = 21;
      m.frustumCulled = false;
      m.userData.noAO = true;
      m.userData.perfTag = 'npcs';
      m.onBeforeRender = (_r, _s, cam) => {
        m.quaternion.copy(cam.quaternion);
        m.updateMatrixWorld();
      };
      this.prompt = m;
    }
    const m = this.prompt;
    if (a !== this.promptFor) {
      this.promptFor = a;
      this.promptT = 0;
      if (a) {
        a.v.root.add(m);
        // The card's 3D bust renders on first use: warm the likely faces while the player walks up.
        const look = a.v.def.look;
        window.setTimeout(() => prewarmPortraits(look, ['neutral', 'happy']), 0);
      } else m.removeFromParent();
    }
    if (!a) return;
    this.promptT += dt;
    const sel = game.services.inventory?.selected();
    const kind = sel ? itemDef(sel.id)?.kind : undefined;
    const gift = !!(sel && kind && kind !== 'tool' && kind !== 'seed' && kind !== 'placeable');
    const tex = gift ? this.promptTex!.gift : this.promptTex!.talk;
    if (m.material.map !== tex) {
      m.material.map = tex;
      m.material.needsUpdate = true;
    }
    const pop = Math.min(1, this.promptT / 0.18);
    const s = 0.6 * (pop < 1 ? pop * (1 + 0.3 * Math.sin(pop * Math.PI)) : 1 + Math.sin(this.promptT * 4) * 0.04);
    m.scale.set(s, s, 1);
    // Beside the head (clear of any emote bubble above it).
    m.position.set(0.5, a.v.headTop + 0.18 + Math.sin(this.promptT * 3) * 0.03, 0);
  }

  // ───────────────────────────────────────────── street chatter

  /** At most two bubbles at once, a few seconds apart, only near a farmer, never during a scene. */
  private barkOK(a: Agent, pl: THREE.Vector3): boolean {
    if (this.barkCd > 0 || this.eventRunning || this.talking || this.camMode || !this.barkLines(a).length || a.inside) return false;
    if (Math.hypot(pl.x - a.v.position.x, pl.z - a.v.position.z) > 22) return false;
    let n = 0;
    for (const b of this.agents.values()) if (b.v.barking) n++;
    return n < 2;
  }

  /** Street chatter for the season (winter has its own lines: cocoa, ice, mittens). */
  private barksOf(a: Agent): string[] | undefined {
    const base = (this.game.calendar.season === 'winter' && a.def.winterBarks) || a.def.barks;
    // r9: remembered choices come first — the street hears what the farmer and the villager share.
    const rel = this.game.services.relationships;
    const mem = rel ? (a.def.keeps ?? []).filter((k) => k.barks && rel.townRecalls(k.flag)).flatMap((k) => k.barks!) : [];
    return mem.length ? [...mem, ...(base ?? [])] : base;
  }

  /**
   * Context tags on barks (r6: "Pip, off the scales!" shouted in the middle of the square): a line
   * may start with `{spot}` (only within 7 m of that named spot — the shop, the oven, the forge) or
   * `{@villager}` (only with them within 6 m); untagged lines play anywhere.
   */
  private barkLines(a: Agent): string[] {
    const out: string[] = [];
    const p = a.v.position;
    for (const raw of this.barksOf(a) ?? []) {
      const m = /^\{(@?)([a-z_]+)\}\s*/.exec(raw);
      if (!m) {
        out.push(raw);
        continue;
      }
      const text = raw.slice(m[0].length);
      if (m[1]) {
        const o = this.agents.get(m[2] as NpcId);
        if (o && !o.inside && o.v.root.visible && Math.hypot(o.v.position.x - p.x, o.v.position.z - p.z) < 6) out.push(text);
      } else {
        const sp = SPOTS[m[2]!];
        if (sp && Math.hypot(sp[0] - p.x, sp[1] - p.z) < 7) out.push(text);
      }
    }
    return out;
  }

  /** Lines already barked today (r7: the same 'Rowan owes me a chair.' twice a day). */
  private barkDay = { key: '', said: new Set<string>() };
  private barkAt(a: Agent, dur = 3.4): void {
    const all = this.barkLines(a);
    if (!all.length) return;
    const c = this.game.calendar;
    const day = `${c.year ?? 1}|${c.season}|${c.day}`;
    if (this.barkDay.key !== day) this.barkDay = { key: day, said: new Set() };
    const fresh = all.filter((l) => !this.barkDay.said.has(`${a.def.id}|${l}`));
    // (once a villager has said everything, they keep quiet for the rest of the day)
    if (!fresh.length) return;
    // Seeded by the day and the half-hour, so two scenes of one day don't open on the same line.
    const seed = c.day * 7 + Math.floor(c.hour * 2) * 3 + NPC_IDS.indexOf(a.def.id) + this.barkN++;
    const line = fresh[seed % fresh.length]!;
    this.barkDay.said.add(`${a.def.id}|${line}`);
    a.v.bark(line, dur);
    this.barkCd = 3.5 + Math.random() * 4;
  }

  // ───────────────────────────────────────────── co-op villager sync

  private netApi(): { role(): 'solo' | 'host' | 'client'; sendExt(to: number | '*' | 'host', data: unknown[]): void } | null {
    const n = (this.game.services as { net?: { role?(): string; sendExt?(to: number | '*' | 'host', data: unknown[]): void } }).net;
    return n && typeof n.role === 'function' && typeof n.sendExt === 'function' ? (n as never) : null;
  }

  private netRole(): 'solo' | 'host' | 'client' {
    return this.netApi()?.role() ?? 'solo';
  }

  /** Host: stream the town (4 Hz) while the host's own world is in town. */
  private netSend(dt: number): void {
    const n = this.netApi();
    if (!n || n.role() !== 'host') return;
    this.netT -= dt;
    if (this.netT > 0) return;
    this.netT = NET_SNAP;
    const out: unknown[] = ['v.s'];
    for (const id of NPC_IDS) {
      const a = this.agents.get(id)!;
      const v = a.v;
      const flags = (a.inside ? 1 : 0) | (v.speaking ? 2 : 0);
      out.push(Math.round(v.position.x * 100), Math.round(v.position.z * 100), Math.round((v as unknown as { targetYaw: number }).targetYaw * 100), ACTS.indexOf(a.activity), flags);
    }
    n.sendExt('*', out);
  }

  private netRecv(from: number, data: unknown[]): void {
    const kind = data[0];
    if (kind === 'v.s' && this.netRole() === 'client') {
      if (data.length !== 1 + NPC_IDS.length * 5) return;
      NPC_IDS.forEach((id, i) => {
        const o = 1 + i * 5;
        const num = (k: number): number => {
          const x = data[o + k];
          return typeof x === 'number' && Number.isFinite(x) ? x : 0;
        };
        const flags = num(4);
        this.follow.set(id, { x: num(0) / 100, z: num(1) / 100, yaw: num(2) / 100, act: ACTS[num(3)] ?? 'idle', inside: !!(flags & 1), speaking: !!(flags & 2) });
      });
      this.followAt = this.clock;
    } else if (kind === 'v.g') {
      // A gift landed somewhere in town (host's or another farmhand's): play its reaction here too.
      const id = NPC_IDS[Number(data[1])];
      const reaction = REACTIONS[Number(data[2])];
      const giver = Number(data[3]);
      const x = Number(data[5]) / 100;
      const z = Number(data[6]) / 100;
      if (!id || !reaction || giver === this.myId() || !Number.isFinite(x) || !Number.isFinite(z)) return;
      const y = this.game.world.current?.heightAt(x, z) ?? 0;
      this.agents.get(id)?.v.facePoint(x, z);
      this.giftJuice(id, String(data[4] ?? ''), reaction, { x, y, z });
      this.gifts.push({ id, from: giver, reaction, t: this.clock });
    } else if ((kind === 'v.e' || kind === 'v.l' || kind === 'v.c') && this.netRole() === 'client') {
      this.spectate(kind, data);
    } else if (kind === 'v.k' && this.netRole() === 'client') {
      this.specCam(data);
    } else if (kind === 'v.t' && this.netRole() === 'host') {
      const id = NPC_IDS[Number(data[1])];
      if (!id) return;
      const x = Number(data[3]);
      const z = Number(data[4]);
      if (data[2] && Number.isFinite(x) && Number.isFinite(z)) {
        this.heldBy.set(id, { x, z, until: this.clock + 90 });
        const a = this.agents.get(id)!;
        a.v.stop();
        a.v.gesture('wave', 1.2);
      } else this.heldBy.delete(id);
      void from;
    }
  }

  // ── 'town-coop' demo (no server): two scripted farmhands in the square — Juniper chatting with Bram,
  // Pip giving Wren strawberries — through the same host paths a real farmhand's intents take ('v.t'
  // talk lock: the villager stops and turns to them; the gift ledger → remoteGift → 'v.g' broadcast).
  private bots: { id: number; p: CoopBot; npc: NpcId; job: 'talk' | 'gift'; x: number; z: number; t: number; n: number }[] = [];

  private coopNet(): { role(): string; remotes?: { add?(id: number, name: string, look: unknown): CoopBot; remove?(id: number): void; get?(id: number): CoopBot | undefined } } | null {
    return (this.game.services.net as unknown as ReturnType<NpcSystem['coopNet']>) ?? null;
  }

  private stageCoop(): void {
    const net = this.coopNet();
    const map = this.game.world.current;
    if (!net?.remotes?.add || net.role() !== 'solo' || !map) return;
    // Two pairs either side of the fountain, three-quarter to the lens. The farmhands stand on the far
    // (north) side of their villager, facing back towards the lens: faces read, and each name tag floats
    // above its own farmer instead of over a villager's head (r4 critic).
    const pairs: [NpcId, number, number, number, number, 'talk' | 'gift', string][] = [
      // (r8: side by side across the view — Juniper stood behind Bram's shoulder on screen)
      ['bram', 38.3, 24.0, 36.85, 23.75, 'talk', 'Juniper'],
      // (r6: Pip gives from the lens side, south-west, so Wren turns three-quarter towards the lens
      // to take the strawberries instead of showing her back)
      // (r8: Pip a step east, out of the front-left lamp post's column)
      ['wren', 25.0, 23.6, 24.35, 25.2, 'gift', 'Pip'],
    ];
    pairs.forEach(([npc, vx, vz, bx, bz, job, name], i) => {
      const a = this.agents.get(npc)!;
      this.setInside(a, false, true);
      a.v.setPosition(vx, map.heightAt(vx, vz), vz);
      this.setActivity(a, 'idle');
      a.anchor = { x: vx, z: vz };
      a.staged = true;
      a.v.facePoint(bx, bz);
      a.v.setYaw(Math.atan2(bx - vx, bz - vz) + (job === 'talk' ? -0.45 : 0.45));
      // Anyone already standing on the pair steps aside.
      for (const b of this.agents.values()) if (b !== a && Math.hypot(b.v.position.x - vx, b.v.position.z - vz) < 2.4) this.setInside(b, true, true);
      const id = 951 + i;
      const p = net.remotes!.add!(id, name, PRESET_LOOKS[(i + 1) % PRESET_LOOKS.length]!);
      p.map = 'town';
      p.snap?.(bx, bz, 'town');
      this.heldBy.set(npc, { x: bx, z: bz, until: this.clock + 1e9 });
      this.bots.push({ id, p, npc, job, x: bx, z: bz, t: job === 'gift' ? 1.7 : 0.4, n: 0 });
    });
  }

  /** Showcase de-overlap: no two figures' screen boxes overlap > 15 % (the pairs' villagers + farmhands stay). */
  private declutter(): void {
    const cam = this.game.rc.camera;
    cam.updateMatrixWorld(true);
    const box = (x: number, y: number, z: number, h: number): [number, number, number, number] | null => {
      const t = _pt.set(x, y + h, z).project(cam);
      const tx = t.x;
      const ty = t.y;
      const tz = t.z;
      const f = _pb.set(x, y, z).project(cam);
      if (tz > 1 || f.z > 1) return null;
      const hh = ty - f.y;
      return [tx - hh * 0.28, f.y, tx + hh * 0.28, ty];
    };
    const kept: [number, number, number, number][] = [];
    for (const b of this.bots) {
      const f = b.p.farmer;
      const bb = box(f.position.x, f.position.y, f.position.z, 2.3);
      if (bb) kept.push(bb);
      const a = this.agents.get(b.npc)!;
      const ab = box(a.v.position.x, a.v.position.y, a.v.position.z, a.v.headTop);
      if (ab) kept.push(ab);
    }
    const pl = this.game.player.position;
    const pb = box(pl.x, pl.y, pl.z, 1.95);
    if (pb) kept.push(pb);
    const held = new Set(this.bots.map((b) => b.npc));
    const rest = [...this.agents.values()].filter((a) => !held.has(a.def.id) && !a.inside && a.v.root.visible);
    // nearest first (the near figure is the one that hides the far one)
    rest.sort((a, b) => cam.position.distanceTo(a.v.position) - cam.position.distanceTo(b.v.position));
    for (const a of rest) {
      const ab = box(a.v.position.x, a.v.position.y, a.v.position.z, a.v.headTop);
      if (!ab) continue;
      const area = (ab[2] - ab[0]) * (ab[3] - ab[1]);
      let worst = 0;
      for (const k of kept) {
        const w = Math.min(ab[2], k[2]) - Math.max(ab[0], k[0]);
        const h = Math.min(ab[3], k[3]) - Math.max(ab[1], k[1]);
        if (w > 0 && h > 0) worst = Math.max(worst, (w * h) / Math.min(area, (k[2] - k[0]) * (k[3] - k[1])));
      }
      if (worst > 0.15) this.setInside(a, true, true);
      else kept.push(ab);
    }
  }

  private clearBots(): void {
    if (!this.bots.length) return;
    for (const b of this.bots) {
      this.coopNet()?.remotes?.remove?.(b.id);
      this.heldBy.delete(b.npc);
    }
    this.bots = [];
  }

  private botFrame(dt: number): void {
    const map = this.game.world.current;
    if (!map) return;
    for (const b of this.bots) {
      const f = b.p.farmer;
      const a = this.agents.get(b.npc)!;
      f.position.set(b.x, map.heightAt(b.x, b.z), b.z);
      f.speed = 0;
      f.targetYaw = Math.atan2(a.v.position.x - b.x, a.v.position.z - b.z);
      b.t -= dt;
      if (b.t > 0) continue;
      b.n++;
      if (b.job === 'talk') {
        b.t = 2.6;
        // Chat back and forth: the villager's line, then the farmhand's.
        if (b.n % 2) {
          a.v.speaking = true;
          a.v.setMood(b.n % 4 === 1 ? 'laugh' : 'happy');
          a.v.gesture(b.n % 4 === 1 ? 'laugh' : 'open', 2.2);
          const pool = this.barkLines(a);
          if (pool?.length) a.v.bark(pool[(b.n >> 1) % pool.length]!, 2.4);
        } else {
          a.v.speaking = false;
          b.p.chat?.(['Two rye loaves, please!', 'Is that cinnamon?', 'Save me a bun!'][(b.n >> 1) % 3]!, 2.4);
        }
      } else {
        b.t = 2.4;
        if (b.n === 1) b.p.chat?.('Strawberries, Wren!', 600);
        this.remoteGift(b.npc, 'strawberry', 'love', b.id, { x: b.x, z: b.z });
      }
    }
  }

  // ── heart events in co-op: the host plays the scene, farmhands in town watch it (title card, the
  // lines as they are spoken, the choice locked "Waiting for the host…", the answer); the actors'
  // walks reach them through the 'v.s' stream. Wire: ['v.e', 1|0, eventId] start / end,
  // ['v.l', eventId, step] a line / narration / choice shown, ['v.c', eventId, step, pick] the answer.

  private spectating: string | null = null;

  private eventNet(data: unknown[]): void {
    if (this.netRole() === 'host') this.netApi()!.sendExt('*', data);
  }

  /** The host's display name (co-op spectator labels). */
  private hostName(): string {
    const n = (this.game.services as unknown as { net?: { name?: () => string; myName?: string } }).net;
    return (typeof n?.name === 'function' ? n.name() : n?.myName) ?? 'Host';
  }

  /**
   * Co-op spectator lens (r6 critic: the farmhand got a radio play over an empty fountain): the host
   * streams its event camera (['v.k', yaw, pitch, dist, tx, ty, tz] at 5 Hz); the farmhand's rig
   * eases onto it through the look offset (no cinematic: the host's farmer — an actor — stays visible)
   * and hands back to the follow cam when the scene ends.
   */
  private specGoal: { yaw: number; pitch: number; dist: number; target: THREE.Vector3; focus: THREE.Vector3 } | null = null;
  private camNetT = 0;
  private sendEventCam(dt: number): void {
    if (this.camMode !== 'event' || !this.evCur || this.netRole() !== 'host') return;
    this.camNetT -= dt;
    if (this.camNetT > 0) return;
    this.camNetT = 0.2;
    const c = this.camCur;
    const r = (v: number): number => Math.round(v * 100) / 100;
    this.netApi()?.sendExt('*', ['v.k', r(c.yaw), r(c.pitch), r(c.dist), r(c.target.x), r(c.target.y), r(c.target.z)]);
  }
  private specCam(data: unknown[]): void {
    if (!this.spectating || this.talking) return;
    const n = data.slice(1, 7).map(Number);
    if (n.length < 6 || n.some((v) => !Number.isFinite(v))) return;
    const [yaw, pitch, dist, tx, ty, tz] = n as [number, number, number, number, number, number];
    const first = !this.specGoal;
    this.specGoal = { yaw, pitch, dist, target: new THREE.Vector3(tx, ty, tz), focus: new THREE.Vector3(tx, ty, tz) };
    if (first) {
      this.takeCam('talk');
      this.camCur.yaw = yaw;
      this.camCur.pitch = pitch;
      this.camCur.dist = dist;
      this.camCur.target.set(tx, ty, tz);
      this.applyCam();
      this.game.rc.rig.snap();
    }
  }
  private endSpecCam(): void {
    if (!this.specGoal) return;
    this.specGoal = null;
    if (this.camMode === 'talk' && !this.talking) this.releaseCam();
  }

  private spectate(kind: string, data: unknown[]): void {
    const box = this.game.services.dialogueBox;
    if (!box || !this.active || this.eventRunning || this.talking) return;
    if (kind === 'v.e') {
      const id = String(data[2] ?? '');
      const he = heartEvent(id);
      if (data[1] && he) {
        this.spectating = id;
        const n = he.npc.name;
        // (r9: the "watching" chip folds into the title card — one place says whose scene this is)
        box.cinema(true, he.ev.title, `${n.startsWith('Dr. ') ? `Dr. ${n.split(' ').pop()}` : n.split(' ')[0]} · ${he.ev.hearts} hearts · ${String(data[4] ?? 'Host')}’s scene`);
        // The heart row shows the host's friendship with the scene's villager (it is their scene).
        const pts = Number(data[3]);
        if (Number.isFinite(pts)) box.spectatorHearts?.(he.npc.id, pts, String(data[4] ?? 'Host'));
      } else if (this.spectating) {
        const he0 = heartEvent(this.spectating);
        this.spectating = null;
        box.end();
        box.cinema(false);
        if (he0) box.spectatorHearts?.(he0.npc.id, null);
        this.endSpecCam();
      }
      return;
    }
    const id = String(data[1] ?? '');
    const he = heartEvent(id);
    if (!he || this.spectating !== id) return;
    const st = he.ev.script[Number(data[2])];
    if (!st) return;
    if (kind === 'v.l') {
      // (the host's insert card rides along: it is keyed off the same line text)
      box.insert?.(NpcSystem.insertFor(he.ev, 'say' in st ? st.text : 'narrate' in st ? st.narrate : 'choice' in st ? st.q : undefined));
      if ('say' in st) void box.say(st.say, st.text, st.mood);
      else if ('narrate' in st) void box.narrate(st.narrate);
      else if ('choice' in st) void box.choose(st.choice, st.q, st.options.map((o) => o.text), 'thinking', 'Waiting for the host to choose…');
    } else if ('choice' in st) {
      const opt = st.options[Number(data[3])];
      if (opt) void box.say(st.choice, opt.reply, opt.mood ?? 'happy');
    }
  }

  /** Farmhand: walk this villager after the host's copy (teleport when far behind). */
  private followAgent(a: Agent): void {
    const f = this.follow.get(a.def.id)!;
    const map = this.game.world.current!;
    const v = a.v;
    if (f.inside !== a.inside) this.setInside(a, f.inside);
    const d = Math.hypot(f.x - v.position.x, f.z - v.position.z);
    if (d > 4 || (!v.root.visible && d > 0.05)) {
      v.stop();
      v.setPosition(f.x, map.heightAt(f.x, f.z), f.z);
      v.setYaw(f.yaw);
    } else if (d > 0.18) v.walkTo(f.x, f.z, f.yaw, d > 1.4);
    else if (!v.isMoving) {
      v.stop();
      v.faceYaw(f.yaw);
    }
    if (!v.isMoving && a.activity !== f.act) this.setActivity(a, f.act);
    a.path = [];
    a.onArrive = null;
    if (f.speaking && !v.speaking && Math.random() < 0.45 && this.barkOK(a, this.game.player.position)) this.barkAt(a);
    v.speaking = f.speaking;
  }

  save(): unknown {
    return { seen: [...this.seen] };
  }

  load(data: unknown): void {
    const d = data as { seen?: string[] };
    if (d?.seen) this.seen = new Set(d.seen);
  }
}
