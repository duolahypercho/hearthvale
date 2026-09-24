/**
 * Shader gate (DESIGN pillar 14): no synchronous shader compiles mid-play.
 *
 * Anything that becomes visible after `ready()` with a material three has never compiled (an
 * emote bubble, a leaping fish, a hit flash, a weather mesh first shown at dusk) used to stall the
 * main thread 0.3-3.7 s while the driver compiled + linked the program on first draw. Each frame
 * (in the same visible-tree walk as the light budget) the gate spots such objects, keeps them out
 * of the frame via their layer mask, and hands them to `renderer.compileAsync`, which compiles in
 * the GPU process (KHR_parallel_shader_compile) and resolves once the programs are linked; the
 * objects then appear on the next frame. Cached programs (another material with the same
 * parameters) resolve within a frame. A gated object is never held longer than MAX_HOLD_MS and is
 * never gated twice.
 *
 * Map loads use RenderContext.compile() behind the warp fade instead (see World.load).
 */
import * as THREE from 'three';

const MAX_HOLD_MS = 2500;

type Props = { get(m: THREE.Material): { currentProgram?: unknown } };

export class ShaderGate {
  enabled = true;
  private known = new WeakSet<THREE.Material>();
  /** Object → the material it was released with (a pooled object that gets a new material is checked again). */
  private released = new WeakMap<THREE.Object3D, THREE.Material | THREE.Material[]>();
  private held = new Map<THREE.Object3D, { mask: number; at: number }>();
  private queue: THREE.Object3D[] = [];
  /** Objects gated so far (debug / perf report). */
  count = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    /** The render target the scene is really drawn into (programs are keyed by output colour space / tone mapping). */
    private target: () => THREE.WebGLRenderTarget | null,
  ) {}

  private compiled(m: THREE.Material): boolean {
    if (this.known.has(m)) return true;
    const p = (this.renderer as unknown as { properties: Props }).properties.get(m);
    if (p.currentProgram !== undefined) {
      this.known.add(m);
      return true;
    }
    return false;
  }

  /** Visit one visible drawable (called from the frame's scene walk). */
  visit(o: THREE.Object3D): void {
    if (!this.enabled || this.held.has(o)) return;
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mat || this.released.get(o) === mat) return;
    let ok = true;
    if (Array.isArray(mat)) {
      for (const m of mat) if (m && !this.compiled(m)) ok = false;
    } else if (!this.compiled(mat)) ok = false;
    if (ok || o.layers.mask === 0) return;
    this.held.set(o, { mask: o.layers.mask, at: performance.now() });
    o.layers.mask = 0;
    this.queue.push(o);
    this.count++;
  }

  /** After the walk: start async compiles for newly gated objects, release timed-out ones. */
  flush(): void {
    if (this.queue.length) {
      const batch = this.queue.splice(0);
      const r = this.renderer as THREE.WebGLRenderer & { compileAsync?: (o: THREE.Object3D, c: THREE.Camera, t?: THREE.Scene) => Promise<unknown> };
      // One compile call for the whole batch: compile() walks the target scene for lights on every
      // call, so per-object calls cost a full scene walk each. A duck-typed root iterates the batch.
      const root = {
        traverse: (cb: (o: THREE.Object3D) => void) => {
          for (const o of batch) o.traverse(cb);
        },
        // Lights: the batch already lives in the scene, whose lights compile() gathers; walking them
        // again here would count them twice (a wrong light-count program variant).
        traverseVisible: () => {},
      } as unknown as THREE.Object3D;
      const done = (): void => {
        for (const o of batch) this.release(o);
      };
      const prev = r.getRenderTarget();
      r.setRenderTarget(this.target());
      try {
        if (r.compileAsync) void r.compileAsync(root, this.camera, this.scene).then(done, done);
        else {
          r.compile(root, this.camera, this.scene);
          done();
        }
      } catch {
        done();
      } finally {
        r.setRenderTarget(prev);
      }
    }
    if (this.held.size) {
      const now = performance.now();
      for (const [o, h] of this.held) if (now - h.at > MAX_HOLD_MS) this.release(o);
    }
  }

  private release(o: THREE.Object3D): void {
    const h = this.held.get(o);
    if (!h) return;
    this.held.delete(o);
    if (o.layers.mask === 0) o.layers.mask = h.mask;
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (mat) this.released.set(o, mat);
    if (Array.isArray(mat)) for (const m of mat) this.known.add(m);
    else if (mat) this.known.add(mat);
  }

  /** Mark everything currently in the scene as compiled (after a blocking/whole-scene compile). */
  settle(): void {
    for (const o of [...this.held.keys()]) this.release(o);
  }
}
