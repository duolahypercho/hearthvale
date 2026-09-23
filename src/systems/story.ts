/**
 * StorySystem: the main questline of Hearthvale (data/story.ts) — flags, the mailbox, and when to
 * play which cutscene (data/story-scenes.ts via the `cutscene` service).
 *
 *   New Game ────────► intro (Gran's letter → evening coach → Mayor Hollis → farm → first night)
 *   first Hall visit ─► hall-first (the six dark rooms)
 *   room restored ───► room-<id> (lantern ignites, the valley changes) + one of Gran's sealed letters
 *   1 room lit ──────► glimmer-survey: Sterling measures the Hall (Spring 15+: his kiosk by the fountain)
 *   2 rooms lit ─────► glimmer-marigold: he tries to buy Thimble & Pip's out from under Marigold
 *   3 rooms lit ─────► Glimmerco's offer on the Hall steps (moral choice: sign / refuse)
 *                      sign:   +5,000g, the Hall goes EverGlow white, a van + floodlight on the square,
 *                              Marigold, Bram and Hazel each think one heart less of you
 *                      refuse: the kiosk packs up; once the Hall is lit by hand, sterling-redeem
 *   Winter 28 eve ───► the Lantern Festival finale (the whole valley, lanterns in hand), Gran's last letter
 *
 * Mail: letters arrive in the farm mailbox each morning (or at once for sealed letters handed over in
 * a scene). Read them from the mailbox, the envelope badge by the clock, or the journal (J).
 * Registers the story panels: 'journal[:tab]', 'bundles:<room>', 'board', 'letter:<id>'.
 *
 * Services: `story` (flags, mail, newGame) and `letters` (show a letter and await it).
 *
 * Co-op (DESIGN pillar 13; the net layer drives this, nothing here opens a socket). The story, the
 * Hall and the board are one shared world, so the host is the author and farmhands follow:
 *   role        `setRole('host' | 'guest' | 'solo')`. A guest never starts a beat itself (walking into
 *               town does not trigger Glimmerco on a farmhand's machine) and does not celebrate its own
 *               predicted room completions: it waits for the host's scene.
 *   state       `netState()` → { flags, mail, quests } (a few KB), `applyNetState(s)` on a guest.
 *               `story:dirty` fires (at most once a frame) whenever any of it changes — the host's cue
 *               to rebroadcast.
 *   scenes      the host emits `story:scene` { scene } whenever a beat plays; guests call
 *               `playRemote(scene)`: the same scene, then back to where that farmer stood (a room
 *               celebration should not leave a farmhand in the Hall).
 *   choices     the host picks (a guest sees the options locked, "waiting for …"); the pick is emitted as
 *               `story:choice` { scene, index } → guests `cutscene.resolveRemoteChoice(index)`.
 *   hand-ins    a guest's bundle / board hand-ins apply locally (prediction) and go to the host as
 *               intents: `quests.contributeRemote / contributeGoldRemote / deliverRemote` (no inventory
 *               on the host side; the return value is what was accepted).
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { LETTERS, STORY_QUESTS } from '../data/story';
import { ROOMS } from '../data/bundles';
import { LetterPanel } from '../ui/journal-letter';
import { JournalPanel, StoryBadge } from '../ui/journal';
import { BundlePanel } from '../ui/journal-bundles';
import { BoardPanel } from '../ui/journal-board';
import { WorldHints, type HintPoint } from '../ui/journal-hint';

export interface MailItem {
  id: string;
  read: boolean;
  day: number;
}

export interface StoryQuestView {
  id: string;
  title: string;
  text: string;
  goal: string;
  giver: string;
  hint?: string;
  state: 'locked' | 'active' | 'done';
  progress?: [number, number];
}

export interface StoryApi {
  flag(key: string): string | undefined;
  setFlag(key: string, value: string): void;
  mail(): MailItem[];
  unread(): number;
  /** Put a letter in the mailbox (now, or on the next morning). */
  deliver(id: string, nextMorning?: boolean): void;
  markRead(id: string): void;
  /** Title screen → New Game. */
  newGame(): void;
  quests(): StoryQuestView[];
  // ── co-op
  role(): StoryRole;
  setRole(role: StoryRole): void;
  netState(): StoryNetState;
  applyNetState(s: StoryNetState): void;
  /** Guest: play a scene the host started, then return to where this farmer stood. */
  playRemote(scene: string): Promise<void>;
}

export type StoryRole = 'solo' | 'host' | 'guest';

export interface StoryNetState {
  flags: Record<string, string>;
  box: MailItem[];
  queued: string[];
  quests: unknown;
}

export interface LettersApi {
  show(id: string): Promise<void>;
}

declare module '../core/game' {
  interface GameServices {
    story: StoryApi;
    letters: LettersApi;
  }
}

declare module '../core/events' {
  interface GameEvents {
    'mail:new': { id: string };
    'mail:read': { id: string };
    'story:beat': { id: string };
    /** Shared story / Hall / board state changed (coalesced to one per frame) — co-op rebroadcast cue. */
    'story:dirty': Record<string, never>;
    /** A story beat started on this machine (host / solo): co-op guests play it too. */
    'story:scene': { scene: string };
    /** The host picked option `index` of the choice in `scene`. */
    'story:choice': { scene: string; index: number };
  }
}

/** Farm mailbox tile, town notice board tile. */
const MAILBOX = { map: 'farm', x: 35, z: 18 };
const BOARD = { map: 'town', x: 27, z: 19 };

export class StorySystem implements System, StoryApi {
  readonly name = 'story';
  private game!: Game;
  private flags: Record<string, string> = {};
  private box: MailItem[] = [];
  private queued: string[] = [];
  private letters!: LetterPanel;
  private staging = false;
  private hints!: WorldHints;
  private coop: StoryRole = 'solo';
  private dirty = false;

  init(game: Game): void {
    this.game = game;
    const root = game.hud.root;
    this.letters = new LetterPanel(game, root.parentElement ?? root, { onClose: (id) => this.markRead(id) });
    game.hud.registerPanel('letter', this.letters);
    game.hud.registerPanel('journal', new JournalPanel(game, root));
    game.hud.registerPanel('bundles', new BundlePanel(game, root));
    game.hud.registerPanel('board', new BoardPanel(game, root));
    new StoryBadge(game, root);
    const HINTS: HintPoint[] = [
      { map: MAILBOX.map, x: MAILBOX.x + 0.5, z: MAILBOX.z + 0.5, y: 1.7, label: 'Read letters', r: 2.2 },
      { map: BOARD.map, x: BOARD.x + 0.5, z: BOARD.z + 0.5, y: 2.6, label: 'Help Wanted', r: 2.4 },
      { map: 'town', x: 38.4, z: 30.2, y: 2.6, label: 'Read the flyer', r: 2.2 },
    ];
    this.hints = new WorldHints(game, root.parentElement ?? root, () => HINTS.filter((h) => h.label !== 'Read the flyer' || this.kioskUp()));
    game.provide('story', this);
    game.provide('letters', { show: (id) => this.letters.show(id) });

    game.events.on('demo:stage', ({ showcase }) => {
      this.staging = true;
      void this.stageDemo(showcase);
    });
    game.events.on('story:flag', ({ key, value }) => this.setFlag(key, value));
    game.events.on('load:after', () => (this.staging = false));
    game.events.on('cutscene:cue', ({ cue }) => {
      if (cue === 'story:hallKey') this.setFlag('hallKey', 'yes');
    });
    game.events.on('day:start', ({ day, season }) => this.morning(day, season));
    // Deferred a tick: a demo / debug teleport finishes staging (and pausing) before beats are checked.
    game.events.on('map:change', ({ map }) => window.setTimeout(() => this.onMap(map), 0));
    game.events.on('time:hour', () => this.onMap(game.world.current?.id ?? ''));
    game.events.on('quest:room', ({ roomId, lit, glimmer }) => this.roomRestored(roomId, lit, glimmer));
    game.events.on('quest:hallRestored', ({ glimmer }) => {
      this.setFlag('hall', glimmer ? 'glimmer' : 'restored');
      if (!glimmer && this.flags.glimmer === 'refused') this.deliver('sterling-resign', true);
    });
    // Anything shared changed → one `story:dirty` per frame (see update()).
    const touch = (): void => {
      this.dirty = true;
    };
    for (const ev of ['story:beat', 'mail:new', 'mail:read', 'quest:bundle', 'quest:room', 'quest:sync', 'quest:posted', 'quest:accepted', 'quest:complete', 'quest:expired'] as const) game.events.on(ev, touch);
    game.events.on('player:interact', ({ x, z }) => {
      const map = game.world.current?.id;
      const near = (t: { map: string; x: number; z: number }): boolean => map === t.map && Math.abs(x - t.x) <= 1 && Math.abs(z - t.z) <= 1;
      if (near(MAILBOX)) game.events.emit('ui:open', { name: 'journal:letters' });
      else if (near(BOARD)) game.events.emit('ui:open', { name: 'board' });
    });
    // Journal hotkey.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyJ' || e.repeat || game.services.cutscene?.playing) return;
      const open = game.hud.openPanelName;
      if (open === 'journal') game.events.emit('ui:open', { name: 'none' });
      else if (!open) game.events.emit('ui:open', { name: 'journal' });
    });
  }

  // ───────────────────────────── flags + mail

  flag(key: string): string | undefined {
    return this.flags[key];
  }

  setFlag(key: string, value: string): void {
    if (this.flags[key] === value) return;
    this.flags[key] = value;
    this.game.events.emit('story:beat', { id: `${key}:${value}` });
    if (key === 'glimmer' && value === 'accepted') {
      this.game.services.economy?.add(5000, 'glimmerco');
      this.game.services.quests?.glimmerFinish();
      this.deliver('marigold-sad', true);
      // The valley remembers who sold the Hall.
      const rel = this.game.services.relationships;
      for (const id of ['marigold', 'bram', 'hazel']) rel?.adjust(id, -250);
      this.game.events.emit('ui:toast', { text: 'Marigold, Bram and Hazel think a little less of you', kind: 'bad' });
    }
    if (key === 'glimmer' && value === 'refused') this.deliver('hollis-proud', true);
    if (key === 'intro' && value === 'done') {
      this.deliver('hollis-welcome', true);
      this.deliver('marigold-seeds', true);
    }
    if (key === 'festival' && value === 'done') this.deliver('gran-final', true);
  }

  mail(): MailItem[] {
    return this.box;
  }

  unread(): number {
    return this.box.filter((m) => !m.read).length;
  }

  deliver(id: string, nextMorning = false): void {
    if (!LETTERS[id] || this.box.some((m) => m.id === id) || this.queued.includes(id)) return;
    if (nextMorning && !this.staging) {
      this.queued.push(id);
      return;
    }
    this.box.unshift({ id, read: false, day: this.game.calendar.day });
    const a = LETTERS[id]!.attach;
    this.game.events.emit('mail:new', { id });
    void a;
  }

  markRead(id: string): void {
    const m = this.box.find((q) => q.id === id);
    if (!m) return;
    if (!m.read) {
      m.read = true;
      const a = LETTERS[id]?.attach;
      if (a?.gold) this.game.services.economy?.add(a.gold, `mail:${id}`);
      if (a?.itemId) this.game.events.emit('item:give', { itemId: a.itemId, qty: a.qty ?? 1 });
    }
    this.game.events.emit('mail:read', { id });
  }

  private morning(day: number, season: string): void {
    this.staging = false;
    const q = this.queued;
    this.queued = [];
    for (const id of q) this.deliver(id);
    if (season === 'winter' && day === 1) this.deliver('gran-winter');
    const lit = this.game.services.quests?.lanternsLit() ?? 0;
    if (lit >= 2 && !this.flags.glimmerLetter) {
      this.flags.glimmerLetter = 'yes';
      this.deliver('glimmer-offer');
    }
  }

  // ───────────────────────────── beats

  newGame(): void {
    this.flags = {};
    this.box = [];
    this.queued = [];
    this.staging = false;
    this.game.services.quests?.debugFill(0, false);
    const cs = this.game.services.cutscene;
    if (cs) void cs.play('intro');
    else this.setFlag('intro', 'done');
  }

  /** The EverGlow kiosk stands by the fountain (Spring 15 on, until the offer is refused). */
  private kioskUp(): boolean {
    const c = this.game.calendar;
    const past15 = c.year > 1 || c.season !== 'spring' || c.day >= 15;
    return this.flags.intro === 'done' && ((past15 && this.flags.glimmer !== 'refused') || this.flags.glimmer === 'accepted');
  }

  update(): void {
    this.hints.update();
    if (this.dirty) {
      this.dirty = false;
      this.game.events.emit('story:dirty', {});
    }
  }

  private play(scene: string): void {
    const cs = this.game.services.cutscene;
    if (!cs || cs.playing || this.staging || this.game.paused || this.coop === 'guest') return;
    if (this.game.hud.openPanelName) this.game.events.emit('ui:open', { name: 'none' });
    this.game.events.emit('story:scene', { scene });
    void cs.play(scene);
  }

  // ───────────────────────────── co-op

  role(): StoryRole {
    return this.coop;
  }

  setRole(role: StoryRole): void {
    this.coop = role;
  }

  netState(): StoryNetState {
    return { flags: { ...this.flags }, box: this.box.map((m) => ({ ...m })), queued: [...this.queued], quests: this.game.systems.find((q) => q.name === 'quests')?.save?.() ?? null };
  }

  applyNetState(s: StoryNetState): void {
    // Keep this farmer's own "read" marks (letters are opened per machine; attachments paid once, by the host).
    const read = new Set(this.box.filter((m) => m.read).map((m) => m.id));
    this.flags = { ...s.flags };
    this.box = s.box.map((m) => ({ ...m, read: m.read || read.has(m.id) }));
    this.queued = [...s.queued];
    if (s.quests) this.game.systems.find((q) => q.name === 'quests')?.load?.(s.quests);
    this.game.events.emit('mail:new', { id: '' });
  }

  async playRemote(scene: string): Promise<void> {
    const cs = this.game.services.cutscene;
    if (!cs || !cs.has(scene)) return;
    const g = this.game;
    const from = { map: g.world.current?.id ?? '', x: g.player.position.x, z: g.player.position.z };
    if (g.hud.openPanelName) g.events.emit('ui:open', { name: 'none' });
    await cs.play(scene);
    if (from.map && (g.world.current?.id !== from.map || Math.hypot(g.player.position.x - from.x, g.player.position.z - from.z) > 0.5)) await g.teleport(from.map, from.x, from.z);
  }

  private onMap(map: string): void {
    // Story beats only fire in a story game (the intro has played): debug boots stay quiet. In co-op
    // only the host authors beats (guests get them as `playRemote`).
    if (this.coop === 'guest' || this.staging || this.game.paused || this.game.services.cutscene?.playing || this.flags.intro !== 'done') return;
    if (this.game.world.current?.id !== map) return;
    const c = this.game.calendar;
    if (map === 'hall' && !this.flags.hallVisited) {
      this.flags.hallVisited = 'pending';
      this.play('hall-first');
      return;
    }
    const lit = this.game.services.quests?.lanternsLit() ?? 0;
    if (map === 'town' && lit >= 3 && !this.flags.glimmer && c.hour >= 16 && c.hour < 22) {
      this.flags.glimmer = 'pending';
      this.play('glimmer-offer');
      return;
    }
    if (map === 'town' && lit >= 1 && !this.flags.glimmer && !this.flags.glimmerSurvey && c.hour >= 10 && c.hour < 18) {
      this.flags.glimmerSurvey = 'pending';
      this.play('glimmer-survey');
      return;
    }
    if (map === 'town' && lit >= 2 && !this.flags.glimmer && this.flags.glimmerSurvey === 'yes' && !this.flags.glimmerMarigold && c.hour >= 9 && c.hour < 17) {
      this.flags.glimmerMarigold = 'pending';
      this.play('glimmer-marigold');
      return;
    }
    if (map === 'town' && this.flags.glimmer === 'refused' && this.flags.hall === 'restored' && !this.flags.sterling && c.hour >= 17 && c.hour < 23) {
      this.flags.sterling = 'pending';
      this.play('sterling-redeem');
      return;
    }
    if (map === 'town' && c.season === 'winter' && c.day === 28 && c.hour >= 17 && !this.flags.festival) {
      this.flags.festival = 'pending';
      this.play(this.flags.glimmer === 'accepted' ? 'finale-glimmer' : 'finale');
    }
  }

  private roomRestored(roomId: string, lit: number, glimmer: boolean): void {
    if (glimmer) return;
    if (this.game.hud.openPanelName) {
      // Let the bundle panel show its "room restored" stamp for a beat first.
      window.setTimeout(() => this.play(`room-${roomId}`), 1400);
    } else this.play(`room-${roomId}`);
    if (lit === 1) this.deliver('gran-first-lantern', true);
    if (lit === 3) this.deliver('gran-tired', true);
    if (roomId === 'harvest') this.deliver('bram-bread', true);
    if (lit === 2) this.deliver('wren-sketch', true);
  }

  quests(): StoryQuestView[] {
    const f = this.flags;
    const lit = this.game.services.quests?.lanternsLit() ?? 0;
    const done: Record<string, boolean> = {
      arrive: f.intro === 'done',
      'visit-hall': f.hallVisited === 'yes',
      'first-lantern': lit >= 1,
      glimmer: f.glimmer === 'accepted' || f.glimmer === 'refused',
      'all-lanterns': lit >= ROOMS.length,
      festival: f.festival === 'done',
    };
    let activeSet = false;
    return STORY_QUESTS.map((q) => {
      let state: StoryQuestView['state'] = done[q.id] ? 'done' : 'locked';
      if (!done[q.id] && !activeSet) {
        state = 'active';
        activeSet = true;
      }
      // The Glimmerco beat and the room count run in parallel with each other.
      if (!done[q.id] && q.id === 'all-lanterns' && lit >= 1) state = 'active';
      const progress: [number, number] | undefined = q.id === 'all-lanterns' ? [lit, ROOMS.length] : q.id === 'glimmer' ? [Math.min(3, lit), 3] : undefined;
      return { ...q, state, progress };
    });
  }

  // ───────────────────────────── demos

  private async stageDemo(showcase: string[]): Promise<void> {
    const q = this.game.services.quests;
    const cs = this.game.services.cutscene;
    // `&coop=guest` stages a scene as a co-op farmhand sees it (e.g. the Glimmerco choice, locked).
    const coop = new URLSearchParams(location.search).get('coop');
    if (coop === 'guest' || coop === 'host' || coop === 'solo') this.coop = coop;
    for (const want of showcase.filter((s) => s.startsWith('story:'))) {
      const [, what, arg, mark] = want.split(':');
      switch (what) {
        case 'progress': {
          // A mid-game save: N rooms lit (+ a half-filled bundle), a few letters. `&lit=N` overrides.
          const url = new URLSearchParams(location.search).get('lit');
          const n = url !== null ? Number(url) : Number(arg ?? 2);
          q?.debugFill(n);
          this.flags = { intro: 'done', hallVisited: 'yes', hallKey: 'yes', glimmerLetter: 'yes' };
          if (n >= 6) this.flags.glimmer = 'refused';
          this.box = [];
          const mail = ['glimmer-offer', 'wren-sketch', 'gran-first-lantern', 'marigold-seeds', 'hollis-welcome'];
          if (n >= 3) mail.unshift('gran-tired', 'bram-bread');
          for (const id of mail) this.box.push({ id, read: id !== 'glimmer-offer' && id !== 'wren-sketch' && id !== 'gran-tired', day: 1 });
          this.game.events.emit('mail:new', { id: 'glimmer-offer' });
          const inv = this.game.services.inventory;
          // Stocked silently (slot writes, not add(): no "+60 Wood" toasts in the demo frame).
          if (inv && n > 0 && n < 6)
            for (const [id, k] of [['tomato', 4], ['corn', 7], ['sunflower', 2], ['pumpkin', 2], ['potato', 12], ['parsnip', 6], ['wood', 60], ['fiber', 30]] as const) {
              if (inv.count(id) >= k) continue;
              const at = inv.slots.findIndex((sl) => !!sl && sl.id === id);
              const free = at >= 0 ? at : inv.slots.findIndex((sl, i) => i >= 10 && !sl);
              if (free >= 0) inv.setSlot(free, { ...(inv.slots[free] ?? {}), id, qty: k });
              else inv.add(id, k - inv.count(id));
            }
          break;
        }
        case 'glimmer': {
          // The Glimmerco path: three rooms by hand, the charter signed, the rest in EverGlow.
          q?.debugFill(3);
          this.flags = { ...this.flags, intro: 'done', hallVisited: 'yes', hallKey: 'yes', glimmerLetter: 'yes', glimmerSurvey: 'yes', glimmerMarigold: 'yes', glimmer: 'accepted' };
          q?.glimmerFinish();
          this.game.events.emit('story:beat', { id: 'glimmer:accepted' });
          break;
        }
        case 'scene': {
          // Room celebrations: `&room=<id>` swaps in another room's scene (lit up to and including it).
          let scene = arg;
          const room = new URLSearchParams(location.search).get('room');
          const idx = ROOMS.findIndex((r) => r.id === room);
          if (scene?.startsWith('room-') && idx >= 0) {
            scene = `room-${room}`;
            q?.debugFill(idx + 1);
          }
          if (cs && scene) await cs.stage(scene, mark);
          break;
        }
      }
    }
  }

  // ───────────────────────────── save

  save(): unknown {
    return { flags: this.flags, box: this.box, queued: this.queued };
  }

  load(data: unknown): void {
    const d = data as { flags?: Record<string, string>; box?: MailItem[]; queued?: string[] } | null;
    this.flags = { ...(d?.flags ?? {}) };
    this.box = d?.box ?? [];
    this.queued = d?.queued ?? [];
    this.game.events.emit('mail:new', { id: '' });
  }
}
