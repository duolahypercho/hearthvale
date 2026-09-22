/**
 * Input: keyboard (WASD / arrows), mouse (buttons, NDC position, wheel), hotkeys.
 *
 * Default bindings:
 *   move            WASD / arrow keys
 *   use tool        left mouse / C / Space
 *   interact        right mouse / X / F / Enter
 *   toolbar         1..9, 0 (slot 10), mouse wheel cycles
 *   inventory       E / I / Tab
 *   menu / back     Escape
 *
 * Systems poll `input.pressed('use')` etc. in update(), or listen to events on the bus.
 * `input.enabled = false` (e.g. while a modal UI is open) suppresses gameplay actions;
 * menu keys still register so UI can close itself.
 */
import type { EventBus } from './events';

export type Action = 'use' | 'interact' | 'inventory' | 'menu' | 'run' | 'map' | 'journal';

const KEY_ACTIONS: Record<string, Action> = {
  KeyC: 'use',
  Space: 'use',
  KeyX: 'interact',
  KeyF: 'interact',
  Enter: 'interact',
  KeyE: 'inventory',
  KeyI: 'inventory',
  Tab: 'inventory',
  Escape: 'menu',
  ShiftLeft: 'run',
  ShiftRight: 'run',
  KeyM: 'map',
  KeyJ: 'journal',
};

const MENU_ACTIONS: ReadonlySet<Action> = new Set(['inventory', 'menu', 'map', 'journal']);

export class Input {
  enabled = true;
  readonly keys = new Set<string>();
  /** Normalized device coords of the pointer (-1..1). */
  readonly pointer = { x: 0, y: 0, inside: false };
  readonly mouse = { left: false, right: false };
  private pressedActions = new Set<Action>();
  private heldActions = new Set<Action>();
  private wheel = 0;
  private toolbarPressed: number | null = null;

  constructor(private events: EventBus, private target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.heldActions.clear();
    });
    target.addEventListener('pointermove', this.onPointerMove);
    target.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    target.addEventListener('pointerleave', () => (this.pointer.inside = false));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('wheel', this.onWheel, { passive: true });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'Tab') e.preventDefault();
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    if (!e.repeat) {
      const a = KEY_ACTIONS[e.code];
      if (a) this.fire(a);
      const digit = /^Digit(\d)$/.exec(e.code);
      if (digit) {
        const n = Number(digit[1]);
        this.toolbarPressed = n === 0 ? 9 : n - 1;
        if (this.enabled) this.events.emit('toolbar:select', { slot: this.toolbarPressed });
      }
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    const a = KEY_ACTIONS[e.code];
    if (a) this.heldActions.delete(a);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const r = this.target.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.pointer.inside = true;
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.onPointerMove(e);
    if (e.button === 0) {
      this.mouse.left = true;
      this.fire('use');
    } else if (e.button === 2) {
      this.mouse.right = true;
      this.fire('interact');
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0) {
      this.mouse.left = false;
      this.heldActions.delete('use');
    }
    if (e.button === 2) {
      this.mouse.right = false;
      this.heldActions.delete('interact');
    }
  };

  private onWheel = (e: WheelEvent): void => {
    this.wheel += Math.sign(e.deltaY);
  };

  private fire(a: Action): void {
    if (!this.enabled && !MENU_ACTIONS.has(a)) return;
    this.pressedActions.add(a);
    this.heldActions.add(a);
  }

  /** True only on the frame the action was pressed. */
  pressed(a: Action): boolean {
    return this.pressedActions.has(a);
  }

  held(a: Action): boolean {
    if (a === 'run') return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    return this.heldActions.has(a);
  }

  /** Consume a pressed action so other systems don't also react to it. */
  consume(a: Action): boolean {
    const had = this.pressedActions.has(a);
    this.pressedActions.delete(a);
    return had;
  }

  /** Movement vector in screen space: x right, y down (towards camera). Length <= 1. */
  moveAxis(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    const k = this.keys;
    let x = 0;
    let y = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    const len = Math.hypot(x, y);
    return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
  }

  /** Wheel steps since last frame (+ = down). */
  wheelSteps(): number {
    return this.wheel;
  }

  /** Call at the end of each frame. */
  endFrame(): void {
    this.pressedActions.clear();
    this.wheel = 0;
    this.toolbarPressed = null;
  }
}
