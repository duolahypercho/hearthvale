/**
 * StorySystem: the main questline of Hearthvale (data/story.ts) — flags, the mailbox, and when to
 * play which cutscene (data/story-scenes.ts via the `cutscene` service).
 *
 *   New Game ────────► intro (Gran's letter → evening coach → Mayor Hollis → farm → first night)
 *   first Hall visit ─► hall-first (the six dark rooms)
 *   room restored ───► room-<id> (lantern ignites, the valley changes) + one of Gran's sealed letters
 *   3 rooms lit ─────► Glimmerco's offer on the Hall steps (moral choice: sign / refuse)
 *   Winter 28 eve ───► the Lantern Festival finale, then Gran's last letter
 *
 * Mail: letters arrive in the farm mailbox each morning (or at once for sealed letters handed over in
 * a scene). Read them from the mailbox, the envelope badge by the clock, or the journal (J).
 * Registers the story panels: 'journal[:tab]', 'bundles:<room>', 'board', 'letter:<id>'.
 *
 * Services: `story` (flags, mail, newGame) and `letters` (show a letter and await it).
 */
import type { System } from '../core/system';
import type { Game } from '../core/game';
import { LETTERS, STORY_QUESTS } from '../data/story';
import { ROOMS } from '../data/bundles';
import { LetterPanel } from '../ui/journal-letter';
import { JournalPanel, StoryBadge } from '../ui/journal';
import { BundlePanel } from '../ui/journal-bundles';
import { BoardPanel } from '../ui/journal-board';

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

  init(game: Game): void {
    this.game = game;
    const root = game.hud.root;
    this.letters = new LetterPanel(game, root.parentElement ?? root, { onClose: (id) => this.markRead(id) });
    game.hud.registerPanel('letter', this.letters);
    game.hud.registerPanel('journal', new JournalPanel(game, root));
    game.hud.registerPanel('bundles', new BundlePanel(game, root));
    game.hud.registerPanel('board', new BoardPanel(game, root));
    new StoryBadge(game, root);
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
    game.events.on('map:change', ({ map }) => this.onMap(map));
    game.events.on('time:hour', () => this.onMap(game.world.current?.id ?? ''));
    game.events.on('quest:room', ({ roomId, lit, glimmer }) => this.roomRestored(roomId, lit, glimmer));
    game.events.on('quest:hallRestored', ({ glimmer }) => {
      this.setFlag('hall', glimmer ? 'glimmer' : 'restored');
      if (!glimmer && this.flags.glimmer === 'refused') this.deliver('sterling-resign', true);
    });
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
    }
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

  private play(scene: string): void {
    const cs = this.game.services.cutscene;
    if (!cs || cs.playing || this.staging || this.game.paused) return;
    if (this.game.hud.openPanelName) this.game.events.emit('ui:open', { name: 'none' });
    void cs.play(scene);
  }

  private onMap(map: string): void {
    if (this.staging || this.game.paused || this.game.services.cutscene?.playing) return;
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
    if (map === 'town' && c.season === 'winter' && c.day === 28 && c.hour >= 17 && !this.flags.festival) {
      this.flags.festival = 'pending';
      this.play('finale');
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
    const want = showcase.find((s) => s.startsWith('story:'));
    if (!want) return;
    const [, what, arg] = want.split(':');
    switch (what) {
      case 'progress': {
        // A mid-game save: 2 rooms lit (+ a half-filled bundle), a few letters.
        q?.debugFill(Number(arg ?? 2));
        this.flags = { intro: 'done', hallVisited: 'yes', hallKey: 'yes', glimmerLetter: 'yes' };
        this.box = [];
        for (const id of ['glimmer-offer', 'wren-sketch', 'gran-first-lantern', 'marigold-seeds', 'hollis-welcome']) this.box.push({ id, read: id !== 'glimmer-offer' && id !== 'wren-sketch', day: 1 });
        this.game.events.emit('mail:new', { id: 'glimmer-offer' });
        const inv = this.game.services.inventory;
        if (inv) for (const [id, n] of [['tomato', 4], ['corn', 7], ['sunflower', 2], ['pumpkin', 2], ['potato', 12], ['parsnip', 6], ['wood', 60], ['fiber', 30]] as const) if (inv.count(id) < n) inv.add(id, n - inv.count(id));
        break;
      }
      case 'scene':
        if (cs && arg) await cs.stage(arg);
        break;
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
