/**
 * Cutscene scripts (pure data) run by systems/cutscene.ts. A scene is a flat list of commands
 * executed in order; most wait for themselves to finish (`wait: false` runs them in the background).
 * `{ do: 'mark' }` is where a demo freezes the scene for a beauty shot (everything before it is
 * fast-forwarded). World-specific beats (the coach, a lantern igniting, the valley changing) are
 * `cue`s that the story systems listen for.
 *
 * Blocking rule: in a two-shot the speaker's face is never covered. `ots(listener, speaker)` puts
 * the lens over the listener's shoulder, 50° off the line between them, so both faces read.
 */
import type { Facing } from '../core/events';
import type { Season } from '../core/time';
import { ROOMS, type RoomDef } from './bundles';

export interface CamKey {
  x: number;
  z: number;
  /** Look-target height above the ground (default 0.8). */
  y?: number;
  yaw: number;
  /** Degrees down from horizontal (negative = looking up at the sky). */
  pitch: number;
  dist: number;
}

export type Emote = 'exclaim' | 'question' | 'heart' | 'note' | 'dots' | 'sweat' | 'sparkle' | 'angry';
export type Ease = 'inOut' | 'out' | 'in' | 'linear';
export type PropKind = 'lantern' | 'clipboard' | 'paperLantern';

export type Cmd =
  | { do: 'fade'; to: 'black' | 'clear'; dur?: number }
  | { do: 'letterbox'; on: boolean }
  | { do: 'map'; map: string; x: number; z: number; facing?: Facing }
  | { do: 'time'; hour: number; day?: number; season?: Season }
  | { do: 'cam'; to: CamKey; dur?: number; ease?: Ease; wait?: boolean }
  | { do: 'rail'; keys: CamKey[]; dur: number; wait?: boolean }
  /** `yaw` (degrees) turns the actor to any angle; `facing` snaps to the four directions. */
  | { do: 'actor'; id: string; x: number; z: number; facing?: Facing; prop?: PropKind; yaw?: number }
  | { do: 'remove'; id: string }
  | { do: 'walk'; id: string; path: [number, number][]; facing?: Facing; speed?: number; wait?: boolean }
  | { do: 'face'; id: string; facing?: Facing; toward?: string }
  | { do: 'emote'; id: string; emote: Emote; wait?: boolean }
  | { do: 'say'; who: string; text: string; mood?: 'happy' | 'neutral' | 'surprised' }
  | { do: 'choice'; who: string; text: string; options: { label: string; hint?: string; flag: string; value: string; then?: string }[] }
  | { do: 'wait'; t: number }
  /** `low`: narration set along the bottom of the frame (keeps the action visible) instead of a centred title. */
  | { do: 'caption'; text: string; sub?: string; dur?: number; low?: boolean }
  | { do: 'letter'; id: string }
  | { do: 'cue'; cue: string; arg?: string; t?: number }
  | { do: 'player'; visible: boolean }
  | { do: 'flag'; key: string; value: string }
  | { do: 'hud'; on: boolean }
  /** A painted full-screen backdrop over the 3D view (null = off). */
  | { do: 'backdrop'; kind: 'coach' | null }
  /** Hide named objects on the current map for the rest of the scene. */
  | { do: 'hide'; names: string[] }
  /** Villagers on an arc round (x, z) at `radius`, from angle a0 to a1 (degrees, 0 = +z), all facing `face`. */
  | { do: 'crowd'; ids: string[]; x: number; z: number; radius: number; a0: number; a1: number; face: { x: number; z: number }; prop?: PropKind }
  /** Demo freeze point; `id` names one of several marks in a scene (`stage(scene, id)`). */
  | { do: 'mark'; id?: string };

// ─────────────────────────────────────────────── framing helpers

type P2 = [number, number];

/**
 * Over-the-shoulder two-shot: the lens sits behind the listener, `off` degrees off the listener →
 * speaker line (on the given side), looking at a point 55 % of the way to the speaker.
 */
export function ots(listener: P2, speaker: P2, o: { side?: 1 | -1; off?: number; dist?: number; pitch?: number; y?: number } = {}): CamKey {
  const dx = speaker[0] - listener[0];
  const dz = speaker[1] - listener[1];
  // Camera offset = the speaker→listener direction rotated by ±off.
  const back = Math.atan2(-dx, -dz);
  const yaw = ((back + ((o.side ?? 1) * (o.off ?? 50) * Math.PI) / 180) * 180) / Math.PI;
  return { x: listener[0] + dx * 0.55, z: listener[1] + dz * 0.55, y: o.y ?? 1.2, yaw, pitch: o.pitch ?? 18, dist: o.dist ?? 8.5 };
}

// ─────────────────────────────────────────────── places

/** Town: the coach stop on the west road, the Hall steps, the plaza, Thimble & Pip's. */
const STOP = { x: 9.6, z: 26.2 };
const STEPS = { x: 32, z: 14.9 };
// (Marigold's doorstep, east of the flower cart so its canopy stays out of the two-shots.)
const STORE = { x: 21.2, z: 21.3 };

/** Intro blocking at the coach stop: the farmer by the coach door, Hollis up the lane. */
const ARR_P: P2 = [STOP.x - 0.5, STOP.z + 0.85];
const ARR_H: P2 = [STOP.x + 1.95, STOP.z + 0.25];
/** The farmhouse porch. */
const FARM_P: P2 = [30.4, 21.3];
const FARM_H: P2 = [32.5, 20.5];
/** Glimmerco on the Hall steps. */
const OFFER_S: P2 = [STEPS.x + 1.1, STEPS.z + 0.2];
const OFFER_P: P2 = [STEPS.x - 1.0, STEPS.z + 1.2];

export const SCENES: Record<string, Cmd[]> = {
  /** New game: Gran's letter on the evening coach → Hearthvale at dusk → the mayor → the farm → first night. */
  intro: [
    { do: 'hud', on: false },
    { do: 'fade', to: 'black', dur: 0 },
    { do: 'letterbox', on: true },
    // Load the valley behind the painted coach window while the letter is read.
    { do: 'map', map: 'town', x: STOP.x - 1, z: STOP.z + 1.4 },
    { do: 'time', hour: 19.15, day: 1, season: 'spring' },
    { do: 'player', visible: false },
    { do: 'cue', cue: 'coach:place', arg: 'offstage' },
    { do: 'backdrop', kind: 'coach' },
    { do: 'fade', to: 'clear', dur: 1.6 },
    { do: 'caption', text: 'The evening coach', sub: 'Somewhere past the city, in the rain', dur: 3, low: true },
    { do: 'mark', id: 'letter' },
    { do: 'letter', id: 'gran-intro' },
    { do: 'fade', to: 'black', dur: 1.2 },
    { do: 'backdrop', kind: null },
    { do: 'caption', text: 'Hearthvale', sub: 'Spring · the valley at dusk', dur: 2.8 },
    // The coach comes down the west road into the valley; Hollis waits by the lamp with a lantern.
    // Hollis waits under the blossom tree by the lamp, clear of the lens → coach line.
    { do: 'actor', id: 'hollis', x: STOP.x + 4.3, z: STOP.z - 2.3, yaw: 245, prop: 'lantern' },
    // From the east, down the lane: the coach comes towards the lens out of the dusk (cottage_west
    // sits south-east of the stop, so the lens stays north of it).
    { do: 'cam', to: { x: STOP.x - 4.5, z: STOP.z - 0.2, y: 1.8, yaw: 96, pitch: 14, dist: 21 }, dur: 0 },
    { do: 'fade', to: 'clear', dur: 1.4 },
    { do: 'cue', cue: 'coach:arrive', t: 0 },
    { do: 'cam', to: { x: STOP.x - 1.6, z: STOP.z + 0.2, y: 1.5, yaw: 97, pitch: 13, dist: 14 }, dur: 4.6, ease: 'inOut' },
    { do: 'mark', id: 'establish' },
    { do: 'cam', to: ots(ARR_P, ARR_H, { side: 1, off: 60, dist: 9.2, pitch: 19, y: 1.25 }), dur: 2.8, ease: 'inOut', wait: false },
    { do: 'player', visible: true },
    { do: 'walk', id: 'player', path: [[STOP.x - 1, STOP.z + 1.4], ARR_P], facing: 'right' },
    { do: 'emote', id: 'hollis', emote: 'exclaim' },
    { do: 'walk', id: 'hollis', path: [ARR_H], speed: 1.3 },
    { do: 'face', id: 'hollis', toward: 'player' },
    { do: 'mark', id: 'arrival' },
    { do: 'say', who: 'hollis', text: 'There you are! The evening coach — right on time. Well. Forty minutes late, which for the evening coach is right on time.' },
    { do: 'say', who: 'hollis', text: "Hollis Pennyroyal. Mayor of Hearthvale. Also treasurer, and the fellow who winds the clock. It's a small town." },
    { do: 'emote', id: 'hollis', emote: 'heart' },
    { do: 'say', who: 'hollis', text: "Rosalind talked about you so often I feel I ought to know your shoe size. I'm so very sorry, dear. She was the best of us." },
    { do: 'say', who: 'hollis', text: "Come, your farm is just west along the lane. I'll light the way — nobody has lit the lamps on that road in years." },
    { do: 'cue', cue: 'coach:leave', t: 0 },
    { do: 'walk', id: 'hollis', path: [[STOP.x - 2, STOP.z + 0.3], [STOP.x - 6, STOP.z + 0.1]], speed: 1.4, wait: false },
    { do: 'walk', id: 'player', path: [[STOP.x - 1.5, STOP.z + 0.8], [STOP.x - 5.5, STOP.z + 0.6]], wait: false },
    { do: 'wait', t: 1.6 },
    { do: 'fade', to: 'black', dur: 1.0 },
    { do: 'remove', id: 'hollis' },
    // The farm, by lantern light.
    { do: 'map', map: 'farm', x: 29.2, z: 22.4, facing: 'up' },
    { do: 'time', hour: 20.4 },
    { do: 'actor', id: 'hollis', x: 31.2, z: 22.1, facing: 'up', prop: 'lantern' },
    { do: 'cam', to: { x: 31.4, z: 20.2, y: 1.6, yaw: -22, pitch: 26, dist: 16 }, dur: 0 },
    { do: 'fade', to: 'clear', dur: 1.2 },
    { do: 'walk', id: 'player', path: [FARM_P], facing: 'right', wait: false },
    { do: 'walk', id: 'hollis', path: [FARM_H], speed: 1.3 },
    { do: 'face', id: 'hollis', toward: 'player' },
    { do: 'cam', to: ots(FARM_P, FARM_H, { side: 1, dist: 9.5, pitch: 20, y: 1.35 }), dur: 2.4, ease: 'inOut', wait: false },
    { do: 'mark', id: 'farm' },
    { do: 'say', who: 'hollis', text: "Here we are. She's, ah... she's got good bones." },
    { do: 'emote', id: 'hollis', emote: 'sweat' },
    { do: 'say', who: 'hollis', text: 'I aired out the bedroom and chased away most of the mice. The ones that stayed have seniority.' },
    { do: 'say', who: 'hollis', text: 'Oh — before I forget. She left this with me. The key to the Lantern Hall, up at the top of the square.' },
    { do: 'cue', cue: 'story:hallKey' },
    { do: 'emote', id: 'player', emote: 'sparkle' },
    { do: 'say', who: 'hollis', text: "The old place has been dark for seven winters. Rosalind always said you'd know what to do with it. I confess I don't. Nobody does, anymore." },
    { do: 'say', who: 'hollis', text: 'Get some sleep, dear. Hearthvale looks better in the morning. Most places do.' },
    { do: 'walk', id: 'hollis', path: [[36, 22], [41, 23.5]], speed: 1.3, wait: false },
    { do: 'wait', t: 1.4 },
    { do: 'fade', to: 'black', dur: 1.4 },
    { do: 'remove', id: 'hollis' },
    // First night in the farmhouse: dust sheets, her reading glasses, a hurricane lantern.
    { do: 'map', map: 'house', x: 6.5, z: 7.4, facing: 'up' },
    { do: 'time', hour: 21.4 },
    { do: 'cue', cue: 'house:night' },
    { do: 'cam', to: { x: 6.2, z: 5.0, y: 0.9, yaw: -8, pitch: 44, dist: 12.5 }, dur: 0 },
    { do: 'fade', to: 'clear', dur: 1.6 },
    { do: 'cam', to: { x: 3.6, z: 4.0, y: 1.2, yaw: -34, pitch: 40, dist: 9 }, dur: 9, ease: 'out', wait: false },
    // Straight to the kitchen table: her note, her glasses, the honey.
    { do: 'walk', id: 'player', path: [[5.8, 5.9], [4.2, 4.6]], facing: 'left', speed: 1.4 },
    { do: 'emote', id: 'player', emote: 'dots' },
    { do: 'mark', id: 'night' },
    { do: 'caption', text: 'The farmhouse smells of dust, cedar and lavender.', sub: 'On the kitchen table: a jar of honey, her reading glasses, and a note that says “Welcome home.”', dur: 5.5, low: true },
    { do: 'walk', id: 'player', path: [[9.6, 2.9]], facing: 'right', speed: 1.4 },
    { do: 'emote', id: 'player', emote: 'heart' },
    { do: 'fade', to: 'black', dur: 1.6 },
    { do: 'cue', cue: 'house:off' },
    { do: 'time', hour: 6.1, day: 1 },
    { do: 'map', map: 'farm', x: 31.5, z: 18.6, facing: 'down' },
    { do: 'caption', text: 'Spring 1', sub: 'Year 1', dur: 2.4 },
    { do: 'letterbox', on: false },
    { do: 'flag', key: 'intro', value: 'done' },
    { do: 'hud', on: true },
    { do: 'fade', to: 'clear', dur: 1.2 },
  ],

  /** First time through the Hall doors. */
  'hall-first': [
    { do: 'hud', on: false },
    { do: 'letterbox', on: true },
    { do: 'player', visible: true },
    { do: 'cam', to: { x: 15, z: 18, y: 1, yaw: 0, pitch: 34, dist: 14 }, dur: 0 },
    { do: 'cam', to: { x: 15, z: 11.5, y: 1, yaw: 0, pitch: 50, dist: 33 }, dur: 5.5, ease: 'inOut', wait: false },
    { do: 'walk', id: 'player', path: [[15, 18.5]], facing: 'up' },
    { do: 'emote', id: 'player', emote: 'dots' },
    { do: 'wait', t: 2.4 },
    { do: 'actor', id: 'hollis', x: 15.6, z: 21.4, facing: 'up', prop: 'lantern' },
    { do: 'walk', id: 'hollis', path: [[16.6, 18.2]], facing: 'up', speed: 1.4 },
    { do: 'cam', to: ots([15, 18.5], [16.6, 18.2], { side: 1, dist: 9, pitch: 26, y: 1.2 }), dur: 2, ease: 'inOut', wait: false },
    { do: 'say', who: 'hollis', text: 'Mind the third floorboard. And the fourth. Actually, mind all of them. Some of them are just holes with ambitions.' },
    { do: 'say', who: 'hollis', text: "Six rooms, six lanterns, and the great one in the middle. Each room was kept by the whole valley — seeds, harvests, firewood, a fish or two. When the rooms were full, the lanterns burned." },
    { do: 'face', id: 'hollis', toward: 'player' },
    { do: 'say', who: 'hollis', text: "Then the mill closed, and folk went to the city, and one winter nobody came with firewood. We told ourselves we'd do it next year." },
    { do: 'emote', id: 'hollis', emote: 'dots' },
    { do: 'say', who: 'hollis', text: "Look at the plinths — each wants its bundle. Fill a room and I'd wager its lantern remembers what to do. I'll leave you to it." },
    { do: 'walk', id: 'hollis', path: [[15.6, 22.5]], speed: 1.4, wait: false },
    { do: 'wait', t: 1.2 },
    { do: 'remove', id: 'hollis' },
    { do: 'letterbox', on: false },
    { do: 'flag', key: 'hallVisited', value: 'yes' },
    { do: 'hud', on: true },
  ],

  // ─────────────────────────────── the Glimmerco thread

  /** 1 lantern lit: a man in cyan and silver measures the Hall from the plaza. */
  'glimmer-survey': [
    { do: 'hud', on: false },
    { do: 'letterbox', on: true },
    { do: 'map', map: 'town', x: 30.2, z: 21.2, facing: 'up' },
    { do: 'hide', names: ['festoon-bulbs', 'festoon-cords'] },
    { do: 'actor', id: 'sterling', x: 33.2, z: 18.6, yaw: 190, prop: 'clipboard' },
    { do: 'cam', to: { x: 32, z: 17.5, y: 2.2, yaw: 24, pitch: 16, dist: 13 }, dur: 0 },
    { do: 'fade', to: 'clear', dur: 0.8 },
    { do: 'walk', id: 'sterling', path: [[33.9, 18.9]], speed: 0.8 },
    { do: 'say', who: 'sterling', text: 'Hm. Hm-hm. Forty-one percent façade, fifty-nine percent potential.' },
    { do: 'emote', id: 'sterling', emote: 'sparkle' },
    { do: 'walk', id: 'player', path: [[31.6, 19.8]], facing: 'right' },
    { do: 'face', id: 'sterling', toward: 'player' },
    { do: 'cam', to: ots([31.6, 19.8], [33.9, 18.9], { side: 1, dist: 8.5, pitch: 16, y: 1.3 }), dur: 1.6, ease: 'inOut', wait: false },
    { do: 'mark' },
    { do: 'say', who: 'sterling', text: "Oh! The lantern person. Sterling Vance, Glimmerco. Don't mind me — just measuring. Lumens, mostly. Also feelings. Feelings are a kind of lumen." },
    { do: 'say', who: 'sterling', text: "We'll talk properly soon. I'll bring the good pen." },
    { do: 'walk', id: 'sterling', path: [[38, 21], [44, 23.5]], speed: 1.5, wait: false },
    { do: 'wait', t: 1.6 },
    { do: 'fade', to: 'black', dur: 0.8 },
    { do: 'remove', id: 'sterling' },
    { do: 'flag', key: 'glimmerSurvey', value: 'yes' },
    { do: 'letterbox', on: false },
    { do: 'hud', on: true },
    { do: 'fade', to: 'clear', dur: 0.8 },
  ],

  /** 2 lanterns lit: Sterling tries to buy Thimble & Pip's out from under Marigold. */
  'glimmer-marigold': [
    { do: 'hud', on: false },
    { do: 'letterbox', on: true },
    { do: 'map', map: 'town', x: STORE.x + 3.6, z: STORE.z + 2.6, facing: 'left' },
    { do: 'actor', id: 'marigold', x: STORE.x - 0.6, z: STORE.z + 0.4, facing: 'right' },
    { do: 'actor', id: 'sterling', x: STORE.x + 1.3, z: STORE.z + 0.9, facing: 'left', prop: 'clipboard' },
    { do: 'cam', to: ots([STORE.x + 1.3, STORE.z + 0.9], [STORE.x - 0.6, STORE.z + 0.4], { side: -1, dist: 10.5, pitch: 23, y: 1.3 }), dur: 0 },
    { do: 'fade', to: 'clear', dur: 0.8 },
    { do: 'mark' },
    { do: 'say', who: 'sterling', text: 'Picture it, Mrs. Thimble: an EverGlow Express, right here. Self-checkout. Open all night. No haggling. Ever.' },
    { do: 'say', who: 'marigold', text: "No haggling? Then what would Rosalind's grandchild and I talk about?", mood: 'neutral' },
    { do: 'cam', to: ots([STORE.x - 0.6, STORE.z + 0.4], [STORE.x + 1.3, STORE.z + 0.9], { side: 1, dist: 10.5, pitch: 23, y: 1.3 }), dur: 0 },
    { do: 'say', who: 'sterling', text: 'The weather. Via the app.' },
    { do: 'emote', id: 'marigold', emote: 'angry' },
    { do: 'say', who: 'marigold', text: 'Out. And take your good pen with you.', mood: 'surprised' },
    { do: 'walk', id: 'sterling', path: [[STORE.x + 5, STORE.z + 3.4], [STORE.x + 12, STORE.z + 5]], speed: 1.5, wait: false },
    { do: 'walk', id: 'player', path: [[STORE.x + 1.4, STORE.z + 1.4]], facing: 'left' },
    { do: 'face', id: 'marigold', toward: 'player' },
    { do: 'cam', to: ots([STORE.x + 1.4, STORE.z + 1.4], [STORE.x - 0.6, STORE.z + 0.4], { side: -1, dist: 9.5, pitch: 21, y: 1.3 }), dur: 1.2, ease: 'inOut', wait: false },
    { do: 'say', who: 'marigold', text: "Thirty-one years I've run this shop. I'm not selling it to a man who alphabetises his smiles." },
    { do: 'say', who: 'marigold', text: "...He's put a little glowing booth by the fountain, you know. Cheaper seeds, he says. Cheaper everything. I suppose we'll see." },
    { do: 'fade', to: 'black', dur: 0.8 },
    { do: 'remove', id: 'sterling' },
    { do: 'remove', id: 'marigold' },
    { do: 'flag', key: 'glimmerMarigold', value: 'yes' },
    { do: 'letterbox', on: false },
    { do: 'hud', on: true },
    { do: 'fade', to: 'clear', dur: 0.8 },
  ],

  /** Glimmerco's offer on the Hall steps (3 rooms lit). */
  'glimmer-offer': [
    { do: 'hud', on: false },
    { do: 'letterbox', on: true },
    { do: 'map', map: 'town', x: OFFER_P[0] - 1.2, z: OFFER_P[1] + 2.4, facing: 'up' },
    { do: 'hide', names: ['festoon-bulbs', 'festoon-cords'] },
    { do: 'actor', id: 'sterling', x: STEPS.x + 0.3, z: STEPS.z - 0.4, facing: 'down', prop: 'clipboard' },
    { do: 'cam', to: { x: STEPS.x, z: STEPS.z + 1.4, y: 1.6, yaw: -20, pitch: 20, dist: 13 }, dur: 0 },
    { do: 'fade', to: 'clear', dur: 0.8 },
    { do: 'walk', id: 'player', path: [OFFER_P], facing: 'up', wait: false },
    { do: 'walk', id: 'sterling', path: [OFFER_S], speed: 1.1 },
    { do: 'face', id: 'sterling', toward: 'player' },
    { do: 'cam', to: ots(OFFER_P, OFFER_S, { side: 1, dist: 8.8, pitch: 15, y: 1.45 }), dur: 1.8, ease: 'inOut', wait: false },
    { do: 'say', who: 'sterling', text: 'Impressive. Genuinely. Three lanterns, lit by hand. Do you know what that costs per lumen?' },
    { do: 'emote', id: 'sterling', emote: 'sparkle' },
    { do: 'say', who: 'sterling', text: "Here's the thing: winters are long, the valley is small, and you are one person with a hoe." },
    { do: 'mark' },
    {
      do: 'choice',
      who: 'sterling',
      text: 'Sign the Hall charter over to Glimmerco and by morning every room will blaze with EverGlow™. No bundles. No waiting. And a cheque for you — a very round number.',
      options: [
        { label: 'Sign the charter', hint: '+5,000g · Glimmerco lights the rest · the valley will remember', flag: 'glimmer', value: 'accepted', then: 'glimmer-accept' },
        { label: 'Refuse', hint: 'The valley lights its own lanterns', flag: 'glimmer', value: 'refused', then: 'glimmer-refuse' },
      ],
    },
  ],
  'glimmer-accept': [
    { do: 'hud', on: false },
    { do: 'letterbox', on: true },
    { do: 'say', who: 'sterling', text: "Pleasure doing business. You'll hardly notice the logo." },
    { do: 'cue', cue: 'story:glimmerAccept' },
    { do: 'walk', id: 'sterling', path: [[STEPS.x + 4, STEPS.z + 3], [STEPS.x + 9, STEPS.z + 7]], speed: 1.6, wait: false },
    { do: 'wait', t: 1.4 },
    { do: 'fade', to: 'black', dur: 1.2 },
    { do: 'remove', id: 'sterling' },
    // By morning: the Hall in EverGlow white, a van on the plaza, the square turning its back.
    { do: 'time', hour: 21.2 },
    { do: 'player', visible: false },
    { do: 'cam', to: { x: STEPS.x, z: STEPS.z - 2, y: 3.2, yaw: 8, pitch: 12, dist: 20 }, dur: 0 },
    { do: 'crowd', ids: ['marigold', 'bram', 'hazel'], x: STEPS.x, z: STEPS.z + 3, radius: 5.2, a0: -40, a1: 40, face: { x: STEPS.x, z: STEPS.z - 2 } },
    { do: 'fade', to: 'clear', dur: 1.4 },
    { do: 'cam', to: { x: STEPS.x, z: STEPS.z - 1, y: 3.6, yaw: 4, pitch: 10, dist: 17 }, dur: 6, ease: 'out', wait: false },
    { do: 'mark', id: 'after' },
    { do: 'caption', text: 'By nightfall the Hall is blinding white.', sub: 'Every window hums. Nobody in the square quite knows where to look.', dur: 4.6, low: true },
    { do: 'emote', id: 'marigold', emote: 'dots' },
    { do: 'wait', t: 1.2 },
    { do: 'fade', to: 'black', dur: 1.2 },
    { do: 'remove', id: 'marigold' },
    { do: 'remove', id: 'bram' },
    { do: 'remove', id: 'hazel' },
    { do: 'player', visible: true },
    { do: 'letterbox', on: false },
    { do: 'hud', on: true },
    { do: 'fade', to: 'clear', dur: 1 },
  ],
  'glimmer-refuse': [
    { do: 'hud', on: false },
    { do: 'letterbox', on: true },
    { do: 'emote', id: 'sterling', emote: 'dots' },
    { do: 'say', who: 'sterling', text: "Sentiment doesn't scale, farmer." },
    { do: 'face', id: 'sterling', facing: 'up' },
    { do: 'say', who: 'sterling', text: '...My mother used to bring me here, you know. Before. Never mind. Good evening.' },
    { do: 'walk', id: 'sterling', path: [[STEPS.x + 4, STEPS.z + 3], [STEPS.x + 9, STEPS.z + 7]], speed: 1.3, wait: false },
    { do: 'wait', t: 2.2 },
    { do: 'fade', to: 'black', dur: 1 },
    { do: 'remove', id: 'sterling' },
    { do: 'letterbox', on: false },
    { do: 'hud', on: true },
    { do: 'fade', to: 'clear', dur: 1 },
  ],

  /** Hall restored by hand after the refusal: Sterling, badge-less, comes to see it lit. */
  'sterling-redeem': [
    { do: 'hud', on: false },
    { do: 'letterbox', on: true },
    { do: 'map', map: 'town', x: 30.2, z: 19.4, facing: 'up' },
    { do: 'hide', names: ['festoon-bulbs', 'festoon-cords'] },
    { do: 'actor', id: 'sterling', x: 32.9, z: 16.6, facing: 'up' },
    { do: 'cam', to: { x: 32.4, z: 15, y: 2.6, yaw: 196, pitch: 12, dist: 9 }, dur: 0 },
    { do: 'fade', to: 'clear', dur: 1 },
    { do: 'cam', to: { x: 32.4, z: 15, y: 2.4, yaw: 186, pitch: 10, dist: 8 }, dur: 5, ease: 'out', wait: false },
    { do: 'say', who: 'sterling', text: "...It's warmer than I remembered. The light. I'd convinced myself I'd remembered it wrong." },
    { do: 'walk', id: 'player', path: [[31.1, 17.6]], facing: 'right' },
    { do: 'face', id: 'sterling', toward: 'player' },
    { do: 'cam', to: ots([31.1, 17.6], [32.9, 16.6], { side: 1, dist: 8, pitch: 14, y: 1.35 }), dur: 1.6, ease: 'inOut', wait: false },
    { do: 'mark' },
    { do: 'say', who: 'sterling', text: 'I handed in the badge. They gave me a very small cake. It had the logo on it. I ate the logo first.' },
    { do: 'emote', id: 'sterling', emote: 'sweat' },
    { do: 'say', who: 'sterling', text: "Hollis says the festival needs someone to carry chairs. I've been practising." },
    { do: 'say', who: 'sterling', text: 'Thank you. For saying no to me. Nobody ever does — it is terrible for a person.' },
    { do: 'walk', id: 'sterling', path: [[36, 19.5], [42, 22.5]], speed: 1.2, wait: false },
    { do: 'wait', t: 1.8 },
    { do: 'fade', to: 'black', dur: 1 },
    { do: 'remove', id: 'sterling' },
    { do: 'flag', key: 'sterling', value: 'redeemed' },
    { do: 'letterbox', on: false },
    { do: 'hud', on: true },
    { do: 'fade', to: 'clear', dur: 1 },
  ],
};

// ─────────────────────────────────────────────── finale

/** The whole valley, lanterns in hand, in two arcs facing the Hall steps (the speech axis stays open). */
const CROWD_W = ['marigold', 'bram', 'wren', 'odessa', 'linus'];
const CROWD_E = ['june', 'tobias', 'kit', 'rowan', 'hazel'];

/**
 * Year-end finale: the Lantern Festival (Winter 28). `glimmer` = the player signed with Glimmerco:
 * the Hall hums with EverGlow, and the farmer switches it off so the valley can light its own
 * lanterns (the charter was never the point).
 */
function finaleScene(glimmer: boolean): Cmd[] {
  const HOLLIS: P2 = [STEPS.x, STEPS.z - 0.7];
  const speech: Cmd[] = glimmer
    ? [
        { do: 'say', who: 'hollis', text: 'Well. The Hall has never been brighter. You can read a ledger from the far end of the lane.' },
        { do: 'say', who: 'hollis', text: "Funny thing, though. Hardly anyone walked a lantern up the hill this year. Didn't seem much point, with it humming away like that." },
        { do: 'emote', id: 'hollis', emote: 'dots' },
        { do: 'say', who: 'hollis', text: "Rosalind used to say light isn't for seeing. It's for finding each other. I think... I think she'd switch it off." },
        { do: 'walk', id: 'player', path: [[STEPS.x, STEPS.z + 1.3]], facing: 'up' },
        { do: 'face', id: 'hollis', toward: 'player' },
        { do: 'say', who: 'hollis', text: 'Would you? And then — would you do the honours, the old way?' },
        { do: 'cue', cue: 'festival:everglowOff', t: 1.2 },
      ]
    : [
        { do: 'say', who: 'hollis', text: 'Friends. Neighbours. Bram — put the pie down, Bram.' },
        { do: 'emote', id: 'bram', emote: 'sweat', wait: false },
        { do: 'say', who: 'hollis', text: "Seven winters we kept the lamps low and told ourselves the dark was just how things were now. It wasn't. It was only that nobody had asked us to gather." },
        { do: 'say', who: 'hollis', text: 'Rosalind asked. And then she sent someone to keep asking.' },
        { do: 'walk', id: 'player', path: [[STEPS.x, STEPS.z + 1.3]], facing: 'up' },
        { do: 'face', id: 'hollis', toward: 'player' },
        { do: 'say', who: 'hollis', text: 'Would you do the honours?' },
      ];
  return [
    { do: 'hud', on: false },
    { do: 'fade', to: 'black', dur: 0.8 },
    { do: 'letterbox', on: true },
    { do: 'map', map: 'town', x: STEPS.x - 1.4, z: STEPS.z + 4.4, facing: 'up' },
    { do: 'time', hour: 19.9 },
    { do: 'cue', cue: glimmer ? 'festival:onGlimmer' : 'festival:on' },
    { do: 'actor', id: 'hollis', x: HOLLIS[0], z: HOLLIS[1], facing: 'down', prop: 'lantern' },
    { do: 'crowd', ids: glimmer ? CROWD_W.slice(0, 3) : CROWD_W, x: STEPS.x, z: STEPS.z, radius: 4.4, a0: -80, a1: -28, face: { x: STEPS.x, z: STEPS.z - 0.6 }, prop: 'paperLantern' },
    { do: 'crowd', ids: glimmer ? CROWD_E.slice(2, 4) : CROWD_E, x: STEPS.x, z: STEPS.z, radius: 4.4, a0: 28, a1: 80, face: { x: STEPS.x, z: STEPS.z - 0.6 }, prop: 'paperLantern' },
    ...(glimmer ? [] : ([{ do: 'actor', id: 'sterling', x: STEPS.x + 5.8, z: STEPS.z + 5.4, yaw: 215, prop: 'paperLantern' }] as Cmd[])),
    { do: 'cam', to: { x: STEPS.x, z: STEPS.z + 3, y: 2.4, yaw: 8, pitch: 20, dist: 25 }, dur: 0 },
    { do: 'caption', text: 'The Lantern Festival', sub: 'Winter 28 · the longest night', dur: 3 },
    { do: 'fade', to: 'clear', dur: 1.6 },
    // Down the open aisle between the two arcs, over the crowd's shoulders to the steps.
    { do: 'cam', to: { x: STEPS.x + 0.3, z: STEPS.z + 0.4, y: 2.1, yaw: 14, pitch: 11, dist: 10.5 }, dur: 5, ease: 'inOut' },
    { do: 'mark', id: 'speech' },
    ...speech,
    { do: 'cam', to: { x: STEPS.x, z: STEPS.z - 2.5, y: 3.6, yaw: 0, pitch: 10, dist: 11 }, dur: 2.4, ease: 'inOut' },
    { do: 'cue', cue: 'festival:greatLantern', t: 1.6 },
    { do: 'cue', cue: 'festival:skyLanterns' },
    // Low behind the crowd, looking up: the lanterns rise over the Hall into the stars.
    { do: 'cam', to: { x: STEPS.x, z: STEPS.z - 3, y: 7.5, yaw: -6, pitch: -9, dist: 22 }, dur: 8, ease: 'inOut', wait: false },
    { do: 'wait', t: 3.8 },
    { do: 'mark', id: 'sky' },
    { do: 'caption', text: 'For one night, the whole valley glows like a hearth.', dur: 4.5 },
    { do: 'wait', t: 1.5 },
    { do: 'fade', to: 'black', dur: 2 },
    { do: 'remove', id: 'hollis' },
    { do: 'flag', key: 'festival', value: 'done' },
    { do: 'caption', text: 'Thank you for playing', sub: 'The valley keeps going. So can you.', dur: 3.5 },
    { do: 'letterbox', on: false },
    { do: 'hud', on: true },
    { do: 'fade', to: 'clear', dur: 1.2 },
  ];
}
SCENES.finale = finaleScene(false);
SCENES['finale-glimmer'] = finaleScene(true);

/** Hall interior: the Great Lantern dais and entrance. */
export const HALL = { entrance: { x: 15, z: 21.2 }, dais: { x: 15, z: 5.2 } };

/** Who peeks in through the arch when each room relights. */
const PEEKERS: Record<string, [string, string]> = {
  seed: ['hazel', 'kit'],
  sun: ['marigold', 'linus'],
  harvest: ['bram', 'june'],
  hearth: ['odessa', 'tobias'],
  craft: ['wren', 'rowan'],
  tide: ['linus', 'kit'],
};

/**
 * Room restored: the camera pushes in on the room's lantern, it ignites (a light pool floods the
 * floor, a shockwave ring, a column of sparks, glowmoths), the lens orbits the plinth while two
 * villagers peek in through the arch — then we cut out to the valley to see what came back.
 */
export function roomScene(room: RoomDef, town: { x: number; z: number; y?: number; yaw: number; pitch: number; dist: number }): Cmd[] {
  const side = room.x < 15 ? -1 : 1;
  // Plinth + the arch into the nave (divider walls at x = 12 / 18).
  const px = room.x + (side < 0 ? 0.4 : -0.4);
  const archX = side < 0 ? 11.55 : 18.45;
  const [a, b] = PEEKERS[room.id] ?? ['hazel', 'kit'];
  // From high over the room's front-outer corner (the knee walls between rooms are low, the back
  // wall is not: a lens behind it saw only plaster), looking across the lantern to the arch where two
  // villagers peek in, their faces lit by the new light; the orbit swings 40° round the plinth.
  const look = { x: (px + archX) / 2 - side * 0.2, z: room.z - 0.1, y: 1.2 };
  const orbit = (d: number): CamKey => ({ ...look, yaw: side * 22 + d, pitch: 44, dist: 8.8 });
  return [
    { do: 'hud', on: false },
    { do: 'letterbox', on: true },
    { do: 'actor', id: a, x: archX, z: room.z - 0.65, facing: side < 0 ? 'left' : 'right' },
    { do: 'actor', id: b, x: archX + side * 0.35, z: room.z + 0.6, facing: side < 0 ? 'left' : 'right' },
    { do: 'cam', to: orbit(side * -20), dur: 1.8, ease: 'inOut' },
    { do: 'cue', cue: 'hall:ignite', arg: room.id },
    { do: 'cue', cue: 'sfx', arg: 'hall' },
    { do: 'rail', keys: [orbit(side * -7), orbit(side * 7), orbit(side * 20)], dur: 6.5, wait: false },
    { do: 'wait', t: 1.1 },
    { do: 'emote', id: a, emote: 'exclaim', wait: false },
    { do: 'mark', id: 'ignite' },
    { do: 'caption', text: `${room.name} is restored`, sub: `The ${room.lantern} burns again.`, dur: 2.8, low: true },
    { do: 'emote', id: b, emote: 'heart', wait: false },
    { do: 'wait', t: 1.4 },
    { do: 'fade', to: 'black', dur: 0.9 },
    { do: 'remove', id: a },
    { do: 'remove', id: b },
    { do: 'map', map: 'town', x: 32, z: 29.4, facing: 'up' },
    { do: 'player', visible: false },
    { do: 'cue', cue: 'town:restore', arg: room.id },
    { do: 'cam', to: { y: 1.2, ...town }, dur: 0 },
    { do: 'fade', to: 'clear', dur: 1 },
    { do: 'cam', to: { y: 1.2, ...town, dist: town.dist * 0.82 }, dur: 4, ease: 'out', wait: false },
    { do: 'cue', cue: 'town:reveal', arg: room.id, t: 1.8 },
    { do: 'mark', id: 'reveal' },
    { do: 'caption', text: room.restores.title, sub: room.restores.text, dur: 3 },
    { do: 'fade', to: 'black', dur: 0.9 },
    { do: 'map', map: 'hall', x: room.x - side * 3.2, z: room.z + 0.5, facing: side < 0 ? 'left' : 'right' },
    { do: 'player', visible: true },
    { do: 'letterbox', on: false },
    { do: 'hud', on: true },
    { do: 'fade', to: 'clear', dur: 0.8 },
  ];
}

/** Where the town camera looks for each room's restoration. */
export const RESTORE_SHOTS: Record<string, { x: number; z: number; y?: number; yaw: number; pitch: number; dist: number }> = {
  seed: { x: 32, z: 14.6, y: 2.75, yaw: 14, pitch: 18, dist: 16 },
  sun: { x: 40.5, z: 27.5, yaw: -18, pitch: 34, dist: 15 },
  // High over the rooftops, looking down the lane the lanterns now line.
  harvest: { x: 12.5, z: 26.2, yaw: -6, pitch: 50, dist: 19 },
  // Up on the roofline, so the smoking chimney is in shot.
  hearth: { x: 34, z: 9.6, y: 4.4, yaw: -10, pitch: 13, dist: 21 },
  // Close on one plaza lamp and its basket (the other three read in the background).
  craft: { x: 37.2, z: 22.4, y: 1.3, yaw: -32, pitch: 20, dist: 7.5 },
  // Steeply down into the basin: the koi circle the fountain column in the lit water.
  tide: { x: 32, z: 24.9, y: 0.4, yaw: 4, pitch: 60, dist: 7.6 },
};

export const ROOM_SCENES: Record<string, Cmd[]> = Object.fromEntries(ROOMS.map((r) => [`room-${r.id}`, roomScene(r, RESTORE_SHOTS[r.id]!)]));
