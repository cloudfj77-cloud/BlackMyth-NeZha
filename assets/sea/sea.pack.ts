import { definePack } from '@forgeax/engine/pack/source';
import { Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { createMeshBuilder, packInterleavedVertexAttributes } from '@forgeax/engine/geometry';
import { CanvasTexture, Materials, MeshFilter, MeshRenderer, PointLight, Points, PointShapeValue, PointSizeUnitsValue } from '@forgeax/engine/render';
import type {} from '@forgeax/engine/assets-runtime';
import type { Plugin } from '@forgeax/engine/plugin';
import { PROPAGATE_TRANSFORMS_SYSTEM, readPresentationWorldMatrix, Transform } from '@forgeax/engine/scene';
import type { MeshAsset } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import type { PlayerService } from '../hover-player/hover-player.pack.ts';
import { geometryGuid, guidText, materialGuid, PACKAGE_IDS } from '../shared/asset-refs.ts';
import { resolveGameEntity } from '../shared/scene-refs.ts';
import { gerstner, LEVEL_SCALE as S, SEA, SEA_LAMPS, seaConstrain, type SeaRules } from '../shared/sea-layout.ts';

/**
 * 东海 · 陈塘关 living scenery (v1.4.0 `SeaWorld.update`, ported):
 * - the sea: a camera-following grid moved by the Gerstner set on the CPU (one mesh, one draw),
 *   flattened toward its rim where a flat far ring (same material) takes over;
 * - the 太乙莲台 lotus turning and bobbing; the stage runes breathing (brighter in the fight);
 * - lamp flicker, the arena light rising in the fight;
 * - the water gate curtain (shut until the yaksha are cleared) and the fight mist at the entry;
 * - salt spray drifting round Nezha;
 * - walking limits: platform ∪ boardwalk (gate) or platform only while sealed (`seaConstrain`).
 */
export interface SeaService {
  readonly setGate: (open: boolean) => void;
  readonly gateOpen: () => boolean;
  /** Fight seal: platform only, mist at the entry. */
  readonly setSealed: (on: boolean) => void;
  readonly sealed: () => boolean;
  /** Fight lighting cue (runes, arena light); independent of the seal (e.g. victory roaming). */
  readonly setFightLight: (on: boolean) => void;
  readonly rules: () => SeaRules;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    nezhaSea: SeaService;
  }
}

/** Grid: 100 × 100 cells over 170 m (1.7 m), waves full within 60 m of its centre, flat by 78 m. */
const GRID = 100;
const EXTENT = 170;
const STEP = EXTENT / GRID;
const FLAT_IN = 60;
const FLAT_OUT = 78;
const SPRAY = 500;

function seaGrid(): { mesh: MeshAsset; rest: Float32Array } {
  const n = GRID + 1;
  const position = new Float32Array(n * n * 3);
  const normal = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  const rest = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i;
      const x = -EXTENT / 2 + i * STEP, z = -EXTENT / 2 + j * STEP;
      position.set([x, 0, z], k * 3);
      normal.set([0, 1, 0], k * 3);
      uv.set([i / GRID, j / GRID], k * 2);
      rest.set([x, z], k * 2);
    }
  }
  const indices = new Uint32Array(GRID * GRID * 6);
  let o = 0;
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      indices.set([a, c, b, b, c, d], o);
      o += 6;
    }
  }
  const built = createMeshBuilder({
    attributes: { position, normal, uv },
    indices,
    submeshes: [{ indexOffset: 0, indexCount: indices.length, vertexCount: n * n, topology: 'triangle-list', materialSlot: 0 }],
    materialSlots: [{ slotName: 'sea' }],
  }).build();
  if (!built.ok) throw built.error;
  return { mesh: { ...built.value, aabb: new Float32Array([-EXTENT, -4, -EXTENT, EXTENT, 4, EXTENT]) }, rest };
}

function sprayCloud(): MeshAsset {
  const position = new Float32Array(SPRAY * 3);
  const normal = new Float32Array(SPRAY * 3);
  const tangent = new Float32Array(SPRAY * 4);
  for (let i = 0; i < SPRAY; i += 1) { normal[i * 3 + 1] = 1; tangent[i * 4] = 1; tangent[i * 4 + 3] = 1; }
  const attributes = { position, normal, uv: new Float32Array(SPRAY * 2), tangent };
  const packed = packInterleavedVertexAttributes(attributes, SPRAY);
  if (!packed.ok) throw packed.error;
  return {
    kind: 'mesh',
    vertices: packed.value.vertices,
    attributes,
    aabb: new Float32Array([-200, -10, -200, 200, 30, 200]),
    submeshes: [{ indexOffset: 0, indexCount: 0, vertexCount: SPRAY, topology: 'point-list', materialSlot: 0 }],
    materialSlots: [{ slotName: 'spray' }],
  };
}

/** Deterministic spray seeds (no Math.random in the frame loop's first fill either). */
function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const sea: Plugin = {
  name: 'nezha/sea',
  inject: ['world', 'gameHost', 'gameScene', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry', 'nezhaPlayer'],
  async apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    const session = ctx.nezhaSession as SessionService | undefined;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    const player = ctx.nezhaPlayer as PlayerService | undefined;
    if (!host || !session || !tuning || !telemetry || !player) throw new Error('nezha/sea requires core and player services');
    const assets = host.assets;
    const load = async (guid: string, kind: 'material' | 'mesh') => {
      const loaded = await assets.load(guid, kind);
      if (!loaded.ok) throw loaded.error;
      return loaded.value;
    };
    const mat = {
      water: await load(guidText(materialGuid('sea-water')), 'material'),
      rune: await load(guidText(materialGuid('sea-rune')), 'material'),
      veil: await load(guidText(materialGuid('sea-veil')), 'material'),
      spray: await load(guidText(materialGuid('sea-spray')), 'material'),
    };
    const farMesh = await load(guidText(geometryGuid('sea-far')), 'mesh');
    const quadMesh = await load(guidText(geometryGuid('quad')), 'mesh');
    const camera = resolveGameEntity(world, ctx.gameScene, 'camera');
    const lotus = resolveGameEntity(world, ctx.gameScene, 'level/lotus');
    const veil = resolveGameEntity(world, ctx.gameScene, 'level/veil');
    const mist = resolveGameEntity(world, ctx.gameScene, 'level/mist');
    const lampLights = SEA_LAMPS.map((_, i) => i).filter((i) => i % 2 === 0).map((i) => resolveGameEntity(world, ctx.gameScene, `light/lamp-${i}`));
    const lotusLight = resolveGameEntity(world, ctx.gameScene, 'light/lotus');
    const arenaLight = resolveGameEntity(world, ctx.gameScene, 'light/arena');

    await ctx.effect(function* () {
      yield () => {
        for (const h of [mat.water, mat.rune, mat.veil, mat.spray, farMesh, quadMesh]) assets.release(h as never).unwrap();
      };
      const spawned: EntityHandle[] = [];
      yield () => { for (const e of spawned) world.despawn(e).unwrap(); };

      let plaqueState = 'none';
      // 「陈塘关」 name board on the arch (v1.4.0 canvas plaque: teal board, gold frame, gold regular script).
      // In-world calligraphy is scenery, so it stays Chinese in every UI language.
      // Game logic may run in a Worker (no DOM): OffscreenCanvas works in both realms.
      const canvas: OffscreenCanvas | HTMLCanvasElement | undefined = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(512, 160)
        : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: 512, height: 160 }) : undefined;
      plaqueState = canvas ? (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas ? 'offscreen' : 'dom') : 'none';
      if (canvas) {
        const ink = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
        if (ink) {
          // The quad's v runs opposite to the canvas rows (text came out upside down): draw it flipped vertically.
          ink.translate(0, 160); ink.scale(1, -1);
          ink.fillStyle = '#0f2a2c'; ink.fillRect(0, 0, 512, 160);
          ink.strokeStyle = '#c9a24a'; ink.lineWidth = 10; ink.strokeRect(10, 10, 492, 140);
          ink.fillStyle = '#e8c870';
          ink.font = 'bold 92px "STKaiti", "KaiTi", "Kaiti SC", "Songti SC", serif';
          ink.textAlign = 'center'; ink.textBaseline = 'middle';
          ink.fillText('陈 塘 关', 256, 84);
          const display = new CanvasTexture(canvas as never);
          yield () => display.dispose();
          const plaqueMat = assets.create(Materials.standard({ baseColor: [1, 1, 1, 1], baseColorTexture: { source: display.source }, roughness: 0.5, metallic: 0.2 } as never)).unwrap();
          yield () => assets.release(plaqueMat as never).unwrap();
          // Despawn the boards before the material goes (effects unwind in reverse).
          const boards: EntityHandle[] = [];
          yield () => { for (const e of boards) world.despawn(e).unwrap(); };
          for (const side of [1, -1]) {
            boards.push(world.spawn(
              { component: Transform, data: { pos: [0, 4.5 * S, SEA.paifangZ + side * 0.19 * S], quat: side > 0 ? [0, 0, 0, 1] : [0, 1, 0, 0], scale: [3 * S, 0.94 * S, 1] } },
              { component: MeshFilter, data: { assetHandle: quadMesh } as never },
              { component: MeshRenderer, data: { materials: [plaqueMat] } as never },
            ).unwrap());
          }
        }
      }

      // The moving sea and the flat far ring.
      const grid = seaGrid();
      const gridMesh = assets.create(grid.mesh).unwrap();
      yield () => assets.release(gridMesh).unwrap();
      const gridEntity = world.spawn(
        { component: Transform, data: { pos: [0, SEA.seaY, 0] } },
        { component: MeshFilter, data: { assetHandle: gridMesh } as never },
        { component: MeshRenderer, data: { materials: [mat.water] } as never },
      ).unwrap();
      spawned.push(gridEntity);
      const farEntity = world.spawn(
        { component: Transform, data: { pos: [0, SEA.seaY - 0.02, 0] } },
        { component: MeshFilter, data: { assetHandle: farMesh } as never },
        { component: MeshRenderer, data: { materials: [mat.water] } as never },
      ).unwrap();
      spawned.push(farEntity);
      const gpos = new Float32Array((GRID + 1) * (GRID + 1) * 3);
      const gnor = new Float32Array(gpos.length);

      // Salt spray.
      const sprayMesh = assets.create(sprayCloud()).unwrap();
      yield () => assets.release(sprayMesh).unwrap();
      const sprayEntity = world.spawn(
        { component: Transform, data: { pos: [0, 0, 0] } },
        { component: MeshFilter, data: { assetHandle: sprayMesh } as never },
        { component: MeshRenderer, data: { materials: [mat.spray] } as never },
        { component: Points, data: { size: 0.09 * S, sizeUnits: PointSizeUnitsValue.world, shape: PointShapeValue.soft } as never },
      ).unwrap();
      spawned.push(sprayEntity);
      const rand = rng(4242);
      const spray = new Float32Array(SPRAY * 3);
      const sprayPhase = new Float32Array(SPRAY);
      let sprayReady = false;

      let gateOpen = false;
      let sealed = false;
      let fightLight = false;
      let veilOp = 1, mistOp = 0, runeK = 0.16, arenaK = 0;
      let time = 0;
      let centre: [number, number] = [0, 0];
      const rules = (): SeaRules => ({ gateOpen, arenaOnly: sealed });
      const applyBounds = () => player.setBounds((x, z) => seaConstrain(x, z, tuning.current.move.capsuleRadius, rules()));
      applyBounds();
      yield () => player.setBounds(undefined);

      world.addSystem(Update, {
        name: 'nezha-sea',
        after: ['nezha-camera'],
        before: [PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          const real = Math.min(world.getResource(Time).delta, 0.1);
          const dt = session.clock.frozen() ? 0 : real;
          time += dt;
          const t = time;
          const cam = readPresentationWorldMatrix(world, camera);
          const cx = cam?.[12] ?? 0, cz = cam?.[14] ?? 0;
          // Grid snapped to its cell so vertices never swim; waves fade out toward the rim.
          const gx = Math.round(cx / STEP) * STEP, gz = Math.round(cz / STEP) * STEP;
          centre = [gx, gz];
          world.set(gridEntity, Transform, { pos: [gx, SEA.seaY, gz] }).unwrap();
          world.set(farEntity, Transform, { pos: [gx, SEA.seaY - 0.02, gz] }).unwrap();
          const n = GRID + 1;
          for (let k = 0; k < n * n; k += 1) {
            const lx = grid.rest[k * 2]!, lz = grid.rest[k * 2 + 1]!;
            const w = 1 - smooth(FLAT_IN, FLAT_OUT, Math.hypot(lx, lz));
            if (w <= 0) {
              gpos[k * 3] = lx; gpos[k * 3 + 1] = 0; gpos[k * 3 + 2] = lz;
              gnor[k * 3] = 0; gnor[k * 3 + 1] = 1; gnor[k * 3 + 2] = 0;
              continue;
            }
            const g = gerstner(gx + lx, gz + lz, t);
            gpos[k * 3] = lx + g.dx * w; gpos[k * 3 + 1] = g.dy * w; gpos[k * 3 + 2] = lz + g.dz * w;
            const nx = g.nx * w, ny = g.ny * w + (1 - w), nz = g.nz * w;
            const l = Math.hypot(nx, ny, nz) || 1;
            gnor[k * 3] = nx / l; gnor[k * 3 + 1] = ny / l; gnor[k * 3 + 2] = nz / l;
          }
          assets.writeRange(gridMesh, { attribute: 'position', first: 0, values: gpos }).unwrap();
          assets.writeRange(gridMesh, { attribute: 'normal', first: 0, values: gnor }).unwrap();

          // Lotus: turn 0.3 rad/s and bob 5 cm (× scale).
          const lq = Math.sin((t * 0.3) / 2), lw = Math.cos((t * 0.3) / 2);
          world.set(lotus, Transform, { pos: [SEA.lotus[0], 0.35 * S + Math.sin(t * 1.4) * 0.05 * S, SEA.lotus[1]], quat: [0, lq, 0, lw] }).unwrap();

          // Runes breathe; brighter in the fight. Arena light rises / falls in ~0.5 s.
          const k2 = Math.min(1, real * 2);
          runeK = 0.16 + Math.sin(t * 1.3) * 0.06 + (fightLight ? 0.14 : 0);
          assets.update(mat.rune, { values: { intensity: runeK * 2.2 } } as never).unwrap();
          arenaK += ((fightLight ? 1 : 0) - arenaK) * k2;
          world.set(arenaLight, PointLight, { intensity: arenaK * 60 } as never).unwrap();
          lampLights.forEach((e, i) => world.set(e, PointLight, { intensity: 9 * (1.4 + Math.sin(t * 5 + i) * 0.15) } as never).unwrap());
          world.set(lotusLight, PointLight, { intensity: 10 } as never).unwrap();

          // Gate curtain and fight mist.
          veilOp += ((gateOpen ? 0 : 1) - veilOp) * Math.min(1, real * 3);
          mistOp += ((sealed ? 1 : 0) - mistOp) * k2;
          // Seen from outside (camera north of it) the mist would veil the whole view: only show it from the stage side.
          const mistSeen = (cam?.[14] ?? 0) < SEA.mistZ - 0.3 ? mistOp : 0;
          world.set(veil, Transform, { scale: [1, veilOp > 0.01 ? 1 : 0, 1] }).unwrap();
          world.set(mist, Transform, { scale: [1, mistSeen > 0.01 ? 1 : 0, 1] }).unwrap();
          setOp(veil, veilOp);
          setOp(mist, mistSeen);

          // Spray: drift with the wind, refill round Nezha when it leaves a 30 m box.
          const root = player.root();
          const fx = root[0], fz = root[2];
          if (!sprayReady) {
            for (let i = 0; i < SPRAY; i += 1) { spray.set([fx + (rand() - 0.5) * 58, rand() * 8, fz + (rand() - 0.5) * 58], i * 3); sprayPhase[i] = rand() * 6.28; }
            sprayReady = true;
          }
          for (let i = 0; i < SPRAY; i += 1) {
            const ph = sprayPhase[i]!;
            let x = spray[i * 3]!, y = spray[i * 3 + 1]!, z = spray[i * 3 + 2]!;
            const f = dt * 60;
            x += (Math.sin(t * 0.6 + ph) * 0.01 + 0.012) * f; y += Math.sin(t * 0.9 + ph) * 0.004 * f; z += Math.cos(t * 0.5 + ph) * 0.01 * f;
            if (Math.abs(x - fx) > 30 || Math.abs(z - fz) > 30) { x = fx + (rand() - 0.5) * 58; z = fz + (rand() - 0.5) * 58; y = rand() * 8; }
            spray[i * 3] = x; spray[i * 3 + 1] = y; spray[i * 3 + 2] = z;
          }
          assets.writeRange(sprayMesh, { attribute: 'position', first: 0, values: spray }).unwrap();
        },
      });

      // Per-curtain opacity: each curtain entity gets its own copy of the veil material once.
      const opCopies = new Map<EntityHandle, unknown>();
      const opShown = new Map<EntityHandle, number>();
      yield () => { for (const c of opCopies.values()) assets.release(c as never).unwrap(); };
      for (const e of [veil, mist]) {
        const copy = assets.copy(mat.veil).unwrap();
        opCopies.set(e, copy);
        world.set(e, MeshRenderer, { materials: [copy] } as never).unwrap();
      }
      function setOp(e: EntityHandle, op: number) {
        const v = r3(op);
        if (opShown.get(e) === v) return;
        opShown.set(e, v);
        assets.update(opCopies.get(e) as never, { values: { op: v } } as never).unwrap();
      }

      yield telemetry.section('sea', () => ({ plaque: plaqueState, gateOpen, sealed, fightLight, veil: r3(veilOp), mist: r3(mistOp), rune: r3(runeK), arena: r3(arenaK), centre, t: r3(time) }));
      yield ctx.provide('nezhaSea', {
        setGate: (open) => { gateOpen = open; },
        gateOpen: () => gateOpen,
        setSealed: (on) => { sealed = on; },
        sealed: () => sealed,
        setFightLight: (on) => { fightLight = on; },
        rules,
      } satisfies SeaService);
    }, 'nezha/sea');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.seaPlugin,
  build: () => ok({
    'plugin/sea': { kind: 'plugin', module: { specifier: './sea.pack.ts', export: 'sea' } },
  }),
});
