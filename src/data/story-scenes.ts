/**
 * Cutscene scripts (pure data) run by systems/cutscene.ts. A scene is a flat list of commands
 * executed in order; most wait for themselves to finish (`wait: false` runs them in the background).
 * `{ do: 'mark' }` is where a demo freezes the scene for a beauty shot (everything before it is
 * fast-forwarded). World-specific beats (the coach, a lantern igniting, the valley changing) are
 * `cue`s that the story systems listen for.
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
  pitch: number;
  dist: number;
}

export type Emote = 'exclaim' | 'question' | 'heart' | 'note' | 'dots' | 'sweat' | 'sparkle' | 'angry';
export type Ease = 'inOut' | 'out' | 'in' | 'linear';

export type Cmd =
  | { do: 'fade'; to: 'black' | 'clear'; dur?: number }
  | { do: 'letterbox'; on: boolean }
  | { do: 'map'; map: string; x: number; z: number; facing?: Facing }
  | { do: 'time'; hour: number; day?: number; season?: Season }
  | { do: 'cam'; to: CamKey; dur?: number; ease?: Ease; wait?: boolean }
  | { do: 'rail'; keys: CamKey[]; dur: number; wait?: boolean }
  | { do: 'actor'; id: string; x: number; z: number; facing?: Facing; prop?: 'lantern' | 'clipboard' }
  | { do: 'remove'; id: string }
  | { do: 'walk'; id: string; path: [number, number][]; facing?: Facing; speed?: number; wait?: boolean }
  | { do: 'face'; id: string; facing?: Facing; toward?: string }
  | { do: 'emote'; id: string; emote: Emote; wait?: boolean }
  | { do: 'say'; who: string; text: string; mood?: 'happy' | 'neutral' | 'surprised' }
  | { do: 'choice'; who: string; text: string; options: { label: string; hint?: string; flag: string; value: string; then?: string }[] }
  | { do: 'wait'; t: number }
  | { do: 'caption'; text: string; sub?: string; dur?: number }
  | { do: 'letter'; id: string }
  | { do: 'cue'; cue: string; arg?: string; t?: number }
  | { do: 'player'; visible: boolean }
  | { do: 'flag'; key: string; value: string }
  | { do: 'hud'; on: boolean }
  | { do: 'mark' };

// ─────────────────────────────────────────────── places

/** Town: the coach stop on the west road, the Hall steps, the plaza. */
const STOP = { x: 9.6, z: 26.2 };
const STEPS = { x: 32, z: 14.9 };

export const SCENES: Record<string, Cmd[]> = {
  /** New game: Gran's letter → the evening coach → the mayor → the farm → first night → morning. */
  intro: [
    { do: 'hud', on: false },
    { do: 'fade', to: 'black', dur: 0 },
    { do: 'letterbox', on: true },
    { do: 'map', map: 'farm', x: 31.2, z: 20.2 },
    { do: 'time', hour: 19.35, day: 1, season: 'spring' },
    { do: 'player', visible: false },
    { do: 'cam', to: { x: 33, z: 22, y: 1.5, yaw: -24, pitch: 22, dist: 34 }, dur: 0 },
    { do: 'fade', to: 'clear', dur: 1.4 },
    { do: 'cam', to: { x: 31, z: 18, y: 1.5, yaw: -12, pitch: 26, dist: 30 }, dur: 16, ease: 'linear', wait: false },
    { do: 'letter', id: 'gran-intro' },
    { do: 'fade', to: 'black', dur: 1.0 },
    { do: 'caption', text: 'Hearthvale', sub: 'Spring · the evening coach', dur: 2.6 },
    // The coach stop at dusk.
    { do: 'map', map: 'town', x: STOP.x - 1, z: STOP.z + 1.4 },
    { do: 'time', hour: 19.15 },
    { do: 'actor', id: 'hollis', x: STOP.x + 2.4, z: STOP.z - 0.5, facing: 'left', prop: 'lantern' },
    { do: 'cue', cue: 'coach:place', arg: 'offstage' },
    { do: 'cam', to: { x: STOP.x + 1.5, z: STOP.z, y: 1.2, yaw: 32, pitch: 24, dist: 17 }, dur: 0 },
    { do: 'fade', to: 'clear', dur: 1.2 },
    { do: 'cue', cue: 'coach:arrive', t: 4.2 },
    { do: 'cam', to: { x: STOP.x + 0.6, z: STOP.z, y: 1.1, yaw: 26, pitch: 22, dist: 12.5 }, dur: 3.5, ease: 'inOut', wait: false },
    { do: 'player', visible: true },
    { do: 'walk', id: 'player', path: [[STOP.x - 1, STOP.z + 1.4], [STOP.x + 0.5, STOP.z + 0.9]], facing: 'right' },
    { do: 'emote', id: 'hollis', emote: 'exclaim' },
    { do: 'walk', id: 'hollis', path: [[STOP.x + 1.7, STOP.z + 0.55]], facing: 'left', speed: 1.3 },
    { do: 'mark' },
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
    { do: 'map', map: 'farm', x: 31.4, z: 21.6, facing: 'up' },
    { do: 'time', hour: 20.4 },
    { do: 'actor', id: 'hollis', x: 32.9, z: 20.2, facing: 'left', prop: 'lantern' },
    { do: 'cam', to: { x: 31.8, z: 19.6, y: 1.4, yaw: -10, pitch: 30, dist: 15 }, dur: 0 },
    { do: 'fade', to: 'clear', dur: 1.2 },
    { do: 'cam', to: { x: 31.8, z: 19.2, y: 1.4, yaw: -4, pitch: 32, dist: 13 }, dur: 6, ease: 'out', wait: false },
    { do: 'say', who: 'hollis', text: "Here we are. She's, ah... she's got good bones." },
    { do: 'emote', id: 'hollis', emote: 'sweat' },
    { do: 'say', who: 'hollis', text: 'I aired out the bedroom and chased away most of the mice. The ones that stayed have seniority.' },
    { do: 'face', id: 'hollis', toward: 'player' },
    { do: 'say', who: 'hollis', text: 'Oh — before I forget. She left this with me. The key to the Lantern Hall, up at the top of the square.' },
    { do: 'cue', cue: 'story:hallKey' },
    { do: 'emote', id: 'player', emote: 'sparkle' },
    { do: 'say', who: 'hollis', text: "The old place has been dark for seven winters. Rosalind always said you'd know what to do with it. I confess I don't. Nobody does, anymore." },
    { do: 'say', who: 'hollis', text: 'Get some sleep, dear. Hearthvale looks better in the morning. Most places do.' },
    { do: 'walk', id: 'hollis', path: [[36, 21], [41, 22.5]], speed: 1.3, wait: false },
    { do: 'wait', t: 1.4 },
    { do: 'fade', to: 'black', dur: 1.4 },
    { do: 'remove', id: 'hollis' },
    { do: 'caption', text: 'The farmhouse smells of dust, cedar and lavender.', sub: 'On the kitchen table: a jar of honey, her reading glasses, and a note that says “Welcome home.”', dur: 5.5 },
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
    { do: 'walk', id: 'hollis', path: [[16.4, 19.2]], facing: 'up', speed: 1.4 },
    { do: 'say', who: 'hollis', text: 'Mind the third floorboard. And the fourth. Actually, mind all of them.' },
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

  /** Glimmerco's offer on the Hall steps (3 rooms lit). */
  'glimmer-offer': [
    { do: 'hud', on: false },
    { do: 'letterbox', on: true },
    { do: 'map', map: 'town', x: STEPS.x - 0.2, z: STEPS.z + 3.2, facing: 'up' },
    { do: 'actor', id: 'sterling', x: STEPS.x + 0.2, z: STEPS.z - 0.3, facing: 'down', prop: 'clipboard' },
    { do: 'cam', to: { x: STEPS.x, z: STEPS.z + 1.4, y: 1.3, yaw: 18, pitch: 26, dist: 11 }, dur: 0 },
    { do: 'fade', to: 'clear', dur: 0.8 },
    { do: 'say', who: 'sterling', text: 'Impressive. Genuinely. Three lanterns, lit by hand. Do you know what that costs per lumen?' },
    { do: 'emote', id: 'sterling', emote: 'sparkle' },
    { do: 'say', who: 'sterling', text: "Sterling Vance, Glimmerco. Here's the thing: winters are long, the valley is small, and you are one person with a hoe." },
    { do: 'walk', id: 'sterling', path: [[STEPS.x + 0.1, STEPS.z + 1.4]], facing: 'down', speed: 1.2 },
    { do: 'mark' },
    {
      do: 'choice',
      who: 'sterling',
      text: 'Sign the Hall charter over to Glimmerco and by morning every room will blaze with EverGlow™. No bundles. No waiting. And a cheque for you — a very round number.',
      options: [
        { label: 'Sign the charter', hint: '+5,000g · Glimmerco lights the remaining rooms', flag: 'glimmer', value: 'accepted', then: 'glimmer-accept' },
        { label: 'Refuse', hint: 'The valley lights its own lanterns', flag: 'glimmer', value: 'refused', then: 'glimmer-refuse' },
      ],
    },
  ],
  'glimmer-accept': [
    { do: 'say', who: 'sterling', text: "Pleasure doing business. You'll hardly notice the logo." },
    { do: 'cue', cue: 'story:glimmerAccept' },
    { do: 'walk', id: 'sterling', path: [[STEPS.x + 4, STEPS.z + 3], [STEPS.x + 9, STEPS.z + 7]], speed: 1.6, wait: false },
    { do: 'wait', t: 1.6 },
    { do: 'fade', to: 'black', dur: 1.2 },
    { do: 'remove', id: 'sterling' },
    { do: 'caption', text: 'By morning the Hall is blinding white.', sub: 'Every window hums. Nobody in the square quite knows where to look.', dur: 4.2 },
    { do: 'letterbox', on: false },
    { do: 'hud', on: true },
    { do: 'fade', to: 'clear', dur: 1 },
  ],
  'glimmer-refuse': [
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

  /** Year-end finale: the Lantern Festival (Winter 28). */
  finale: [
    { do: 'hud', on: false },
    { do: 'fade', to: 'black', dur: 0.8 },
    { do: 'letterbox', on: true },
    { do: 'map', map: 'town', x: 32, z: 29.4, facing: 'up' },
    { do: 'time', hour: 19.9 },
    { do: 'cue', cue: 'festival:on' },
    { do: 'actor', id: 'hollis', x: 32, z: 17.6, facing: 'down', prop: 'lantern' },
    { do: 'cam', to: { x: 32, z: 24, y: 2, yaw: 0, pitch: 18, dist: 30 }, dur: 0 },
    { do: 'caption', text: 'The Lantern Festival', sub: 'Winter 28 · the longest night', dur: 3 },
    { do: 'fade', to: 'clear', dur: 1.6 },
    { do: 'cam', to: { x: 32, z: 19.5, y: 1.6, yaw: 8, pitch: 24, dist: 13 }, dur: 5, ease: 'inOut' },
    { do: 'say', who: 'hollis', text: 'Friends. Neighbours. Bram — put the pie down, Bram.' },
    { do: 'say', who: 'hollis', text: "Seven winters we kept the lamps low and told ourselves the dark was just how things were now. It wasn't. It was only that nobody had asked us to gather." },
    { do: 'say', who: 'hollis', text: 'Rosalind asked. And then she sent someone to keep asking.' },
    { do: 'face', id: 'hollis', toward: 'player' },
    { do: 'walk', id: 'player', path: [[32, 20.2]], facing: 'up' },
    { do: 'say', who: 'hollis', text: 'Would you do the honours?' },
    { do: 'cam', to: { x: 32, z: 13, y: 3.4, yaw: 0, pitch: 12, dist: 11 }, dur: 2.4, ease: 'inOut' },
    { do: 'cue', cue: 'festival:greatLantern', t: 1.8 },
    { do: 'cue', cue: 'festival:skyLanterns' },
    { do: 'cam', to: { x: 32, z: 21, y: 4, yaw: -6, pitch: 20, dist: 36 }, dur: 9, ease: 'inOut', wait: false },
    { do: 'wait', t: 3.5 },
    { do: 'mark' },
    { do: 'caption', text: 'For one night, the whole valley glows like a hearth.', dur: 4.5 },
    { do: 'wait', t: 1.5 },
    { do: 'fade', to: 'black', dur: 2 },
    { do: 'remove', id: 'hollis' },
    { do: 'flag', key: 'festival', value: 'done' },
    { do: 'caption', text: 'Thank you for playing', sub: 'The valley keeps going. So can you.', dur: 3.5 },
    { do: 'letterbox', on: false },
    { do: 'hud', on: true },
    { do: 'fade', to: 'clear', dur: 1.2 },
  ],
};

/** Hall interior: the Great Lantern dais and entrance. */
export const HALL = { entrance: { x: 15, z: 21.2 }, dais: { x: 15, z: 5.2 } };

/**
 * Room restored: the camera pushes in on the room's lantern, it ignites (glowmoths, chime), then
 * we cut out to the valley to see what came back.
 */
export function roomScene(room: RoomDef, town: { x: number; z: number; yaw: number; pitch: number; dist: number }): Cmd[] {
  const side = room.x < 15 ? -1 : 1;
  return [
    { do: 'hud', on: false },
    { do: 'letterbox', on: true },
    { do: 'cam', to: { x: room.x, z: room.z, y: 1.2, yaw: side * 18, pitch: 40, dist: 13 }, dur: 1.8, ease: 'inOut' },
    { do: 'cue', cue: 'hall:ignite', arg: room.id, t: 2.2 },
    { do: 'mark' },
    { do: 'caption', text: `${room.name} is restored`, sub: `The ${room.lantern} burns again.`, dur: 2.8 },
    { do: 'fade', to: 'black', dur: 0.9 },
    { do: 'map', map: 'town', x: 32, z: 29.4, facing: 'up' },
    { do: 'player', visible: false },
    { do: 'cue', cue: 'town:restore', arg: room.id },
    { do: 'cam', to: { ...town, y: 1.2 }, dur: 0 },
    { do: 'fade', to: 'clear', dur: 1 },
    { do: 'cam', to: { ...town, y: 1.2, dist: town.dist * 0.82 }, dur: 4, ease: 'out', wait: false },
    { do: 'cue', cue: 'town:reveal', arg: room.id, t: 1.8 },
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
export const RESTORE_SHOTS: Record<string, { x: number; z: number; yaw: number; pitch: number; dist: number }> = {
  seed: { x: 32, z: 14.4, yaw: 14, pitch: 26, dist: 13 },
  sun: { x: 40.5, z: 27.5, yaw: -18, pitch: 34, dist: 15 },
  harvest: { x: 10, z: 26, yaw: 28, pitch: 30, dist: 18 },
  hearth: { x: 32, z: 10, yaw: -10, pitch: 24, dist: 22 },
  craft: { x: 32, z: 25, yaw: 0, pitch: 40, dist: 22 },
  tide: { x: 32, z: 25, yaw: 10, pitch: 52, dist: 10 },
};

export const ROOM_SCENES: Record<string, Cmd[]> = Object.fromEntries(ROOMS.map((r) => [`room-${r.id}`, roomScene(r, RESTORE_SHOTS[r.id]!)]));
