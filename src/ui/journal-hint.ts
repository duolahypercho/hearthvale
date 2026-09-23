/**
 * Floating key hints over story interactables ("F · Offer" over a Lantern Hall plinth, "F · Read"
 * over the mailbox, "F · Look" at the notice board). Each owner passes its points; every frame the
 * nearest point within its radius of the player gets a small wooden pill that bobs above it.
 * Hidden during cutscenes and while any panel is open.
 */
import * as THREE from 'three';
import type { Game } from '../core/game';
import './journal.css';

export interface HintPoint {
  map: string;
  x: number;
  z: number;
  /** Height of the pill above the ground (m). */
  y: number;
  label: string;
  /** Show within this many metres of the player. */
  r: number;
}

export class WorldHints {
  private el: HTMLElement;
  private label: HTMLElement;
  private cur: HintPoint | null = null;
  private v = new THREE.Vector3();

  constructor(private game: Game, parent: HTMLElement, private points: () => HintPoint[]) {
    this.el = document.createElement('div');
    this.el.className = 'hv-world-hint';
    this.el.innerHTML = `<span class="k">F</span><span class="l"></span>`;
    this.label = this.el.querySelector('.l')!;
    parent.appendChild(this.el);
  }

  update(): void {
    const g = this.game;
    const map = g.world.current?.id;
    const p = g.player.position;
    let best: HintPoint | null = null;
    let bd = Infinity;
    if (map && !g.cinematic && !g.hud.openPanelName && g.player.root.visible) {
      for (const h of this.points()) {
        if (h.map !== map) continue;
        const d = Math.hypot(p.x - h.x, p.z - h.z);
        if (d < h.r && d < bd) {
          bd = d;
          best = h;
        }
      }
    }
    if (best !== this.cur) {
      this.cur = best;
      this.el.classList.toggle('on', !!best);
      if (best) this.label.textContent = best.label;
    }
    if (!best) return;
    const cam = g.rc.camera;
    this.v.set(best.x, g.world.heightAt(best.x, best.z) + best.y, best.z).project(cam);
    const c = g.rc.renderer.domElement;
    const r = c.getBoundingClientRect();
    const x = r.left + (this.v.x * 0.5 + 0.5) * r.width;
    const y = r.top + (-this.v.y * 0.5 + 0.5) * r.height;
    this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
}
