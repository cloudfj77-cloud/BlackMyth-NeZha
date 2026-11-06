import { definePack } from '@forgeax/engine/pack/source';
import { FixedUpdate, Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { createMeshBuilder } from '@forgeax/engine/geometry';
import type { Plugin } from '@forgeax/engine/plugin';
import { MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { ChildOf, PROPAGATE_TRANSFORMS_SYSTEM, readPresentationWorldMatrix, Transform } from '@forgeax/engine/scene';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import type {} from '@forgeax/engine/assets-runtime';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import type { PlayerService } from '../hover-player/hover-player.pack.ts';
import type { CombatService } from '../combat/combat.pack.ts';
import type { RigService } from '../nezha-rig/rig.pack.ts';
import { rotate, type Q } from '../combat/poses.ts';
import { guidText, materialGuid, PACKAGE_IDS } from '../shared/asset-refs.ts';
import { HEAD_TOP_Y, SASH_ANCHORS } from '../shared/nezha-shape.ts';
import { CAPSULE_CENTER_Y } from '../shared/player-rig.ts';
import { createFloat } from './float.ts';

type V3 = [number, number, number];

function quatOf(m: ArrayLike<number>): Q {
  const m00 = m[0]!, m01 = m[4]!, m02 = m[8]!, m10 = m[1]!, m11 = m[5]!, m12 = m[9]!, m20 = m[2]!, m21 = m[6]!, m22 = m[10]!;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
const r3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Float + Red Armillary Sash.
 * - Float: bob/roll offsets on the model child (visual only).
 * - Sash: two procedural ribbons on spring point chains, emissive, drifting
 *   back and up like flame. The tips never rise above the hair buns and stay
 *   behind the head. Simulated in world space (water drag trails them when
 *   Nezha moves), written into one ribbon mesh parented to the root.
 */
export const floatFx: Plugin = {
  name: 'nezha/float-fx',
  inject: ['world', 'gameHost', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry', 'nezhaPlayer', 'nezhaCombat', 'nezhaRig'],
  async apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    const session = ctx.nezhaSession as SessionService | undefined;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    const player = ctx.nezhaPlayer as PlayerService | undefined;
    const combatService = ctx.nezhaCombat as CombatService | undefined;
    const rig = ctx.nezhaRig as RigService | undefined;
    if (!combatService) throw new Error('nezha/float-fx requires the combat service');
    if (!host || !session || !tuning || !telemetry || !player) throw new Error('nezha/float-fx requires core and player services');
    const assets = host.assets;
    const material = await assets.load(guidText(materialGuid('sash-live')), 'material');
    if (!material.ok) throw material.error;
    const greyMat = await assets.load(guidText(materialGuid('grey')), 'material');
    if (!greyMat.ok) throw greyMat.error;

    const strands = Math.max(1, Math.round(tuning.current.sash.strands));
    const segments = Math.max(2, Math.round(tuning.current.sash.segments));
    const points = segments + 1;
    const vertsPerStrand = points * 2;
    const vertexCount = strands * vertsPerStrand;
    const indices: number[] = [];
    const uv = new Float32Array(vertexCount * 2);
    for (let s = 0; s < strands; s += 1) {
      for (let i = 0; i < points; i += 1) {
        const v = s * vertsPerStrand + i * 2;
        uv.set([0, i / segments, 1, i / segments], v * 2);
        if (i < segments) indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    for (let v = 0; v < vertexCount; v += 1) {
      positions.set([((v % 2) - 0.5) * 0.1, 0.2 + v * 0.02, 0.4 + (v % 3) * 0.3], v * 3); // generous initial bounds
      normals.set([0, 0, 1], v * 3);
    }
    const built = createMeshBuilder({
      attributes: { position: positions, normal: normals, uv },
      indices: new Uint32Array(indices),
      submeshes: [{ indexOffset: 0, indexCount: indices.length, vertexCount, topology: 'triangle-list', materialSlot: 0 }],
      materialSlots: [{ slotName: 'sash' }],
    }).build();
    if (!built.ok) throw built.error;
    // Bounds cover the whole reachable sash volume around the root so it is never culled.
    const ribbonAsset = { ...built.value, aabb: new Float32Array([-3.5, -1.5, -3.5, 3.5, 4.5, 3.5]) };
    const mesh = assets.create(ribbonAsset).unwrap();

    await ctx.effect(function* () {
      yield () => {
        assets.release(material.value).unwrap();
        assets.release(greyMat.value).unwrap();
      };
      let sashGrey = false;
      let gate = 1;
      let flash = 0;
      let wasCooling = false;
      let lastLook = { brightness: 1, fill: 0, flash: 0 };
      let hoverY = 0, ribbonV = 0, lastY = 0;
      // Roll reel-in (M3 §8): 0 = full length, 1 = reeled to rollLength (in 4 steps, out over 12).
      let reel = 0;
      let worstTipY = -Infinity;
      yield () => {
        assets.release(mesh).unwrap();
      };
      const ribbon: EntityHandle = world.spawn(
        { component: Transform, data: { pos: [0, 0, 0] } },
        { component: ChildOf, data: { parent: player.entity } },
        { component: MeshFilter, data: { assetHandle: mesh } as never },
        { component: MeshRenderer, data: { materials: [material.value] } as never },
      ).unwrap();
      yield () => world.despawn(ribbon).unwrap();

      const float = createFloat();
      let floatState = { y: 0, roll: 0, amp: 0, bobPhase: 0 };
      // Chain state per strand (world space): positions and previous positions (Verlet).
      const chain: { p: V3[]; q: V3[] }[] = [];
      let initialised = false;
      let worstAboveHead = -Infinity;
      let worstAhead = -Infinity;

      world.addSystem(Update, {
        name: 'nezha-float-fx',
        after: [FixedUpdate],
        before: ['nezha-player-pose', PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          if (session.frontend().grey !== sashGrey) {
            sashGrey = session.frontend().grey;
            world.set(ribbon, MeshRenderer, { materials: [sashGrey ? greyMat.value : material.value] } as never).unwrap();
          }
          const rawDt = world.getResource(Time).delta;
          // Nezha's clock: hitstop freezes the float and the sash together (design rule 3).
          const nezhaScale = session.clock.nezhaScale();
          const dt = Math.min(rawDt, 1 / 30) * nezhaScale;
          const t = tuning.current;
          const playing = session.phase() !== 'paused';
          // Sash cooldown look: dimmer, droops (20 % flutter), gold fills from the root; tip glint when ready.
          const cd = combatService.sashCooldown();
          const cooling = cd.left > 0;
          if (wasCooling && !cooling) flash = 1;
          wasCooling = cooling;
          flash = Math.max(0, flash - rawDt / 0.15);
          const look = { brightness: cooling ? 0.3 : 1, fill: cooling ? r3(1 - cd.left / cd.total) : 0, flash: r3(flash) };
          if (look.brightness !== lastLook.brightness || look.fill !== lastLook.fill || look.flash !== lastLook.flash) {
            lastLook = look;
            assets.update(material.value, { values: look } as never).unwrap();
          }
          const flutter = cooling ? 0.2 : 1;
          if (dt === 0 || !playing) {
            hoverY = 0;
            ribbonV = 0;
            if (!playing) return;
            return;
          }
          // Actions fade the float out over 6 steps and back in (gate from the combat plugin).
          const gateTarget = player.floatGate();
          gate += Math.max(-dt * 10, Math.min(dt * 10, gateTarget - gate));
          floatState = float.step(player.mode(), t.float, dt);
          // Approved bob (±15 cm, 0.8 Hz, quick rise) + the v1.4.0 inertia layer: state height, lean, bank.
          const inertia = rig?.hover();
          player.setFloat(floatState.y * gate + (inertia?.dy ?? 0), floatState.roll * gate + (inertia?.roll ?? 0), -(inertia?.pitch ?? 0));
          hoverY = r3((floatState.y * gate) / Math.max(dt, 1e-6) - lastY / Math.max(dt, 1e-6));
          lastY = floatState.y * gate;

          const matrix = readPresentationWorldMatrix(world, player.entity);
          const modelMatrix = readPresentationWorldMatrix(world, player.model);
          if (!matrix || !modelMatrix) return;
          // The model may be turned by an action (roll): anchors follow the real shoulders.
          const modelQ = quatOf(modelMatrix);
          const rolled = (modelMatrix[5] ?? 1) < 0.95;
          const rx = matrix[12] ?? 0, ry = matrix[13] ?? 0, rz = matrix[14] ?? 0;
          const yaw = Math.atan2(-(matrix[2] ?? 0), matrix[0] ?? 1);
          const cos = Math.cos(yaw), sin = Math.sin(yaw);
          const toWorld = (l: readonly number[]): V3 => [rx + l[0]! * cos + l[2]! * sin, ry + l[1]!, rz - l[0]! * sin + l[2]! * cos];
          const toLocal = (w: readonly number[]): V3 => {
            const dx = w[0]! - rx, dz = w[2]! - rz;
            return [dx * cos - dz * sin, w[1]! - ry, dx * sin + dz * cos];
          };
          // Model space -> root-local: model origin sits hover + float above the seabed.
          const modelY = -CAPSULE_CENTER_Y + t.move.hoverHeight + floatState.y * gate + (rig?.hover().dy ?? 0);
          const anchorWorld = (a: readonly number[]): V3 => {
            const v = rotate(modelQ, [a[0]!, a[1]!, a[2]!]);
            return [(modelMatrix[12] ?? 0) + v[0], (modelMatrix[13] ?? 0) + v[1], (modelMatrix[14] ?? 0) + v[2]];
          };
          const headTop = modelY + HEAD_TOP_Y;
          const rolling = combatService.action() === 'roll';
          reel = rolling ? Math.min(1, reel + (dt * 60) / 4) : Math.max(0, reel - (dt * 60) / 12);
          const length = t.sash.length + (t.sash.rollLength - t.sash.length) * reel;
          const segLength = length / segments;
          // Hard ceiling during the roll (above the vortex), root-local.
          const capLocal = -CAPSULE_CENTER_Y + t.sash.rollCap;
          if (!initialised) {
            for (let s = 0; s < strands; s += 1) {
              const anchor = SASH_ANCHORS[s % SASH_ANCHORS.length]!;
              const p: V3[] = [];
              for (let i = 0; i < points; i += 1) p.push(toWorld([anchor[0], modelY + anchor[1] - i * 0.02, anchor[2] + i * segLength]));
              chain.push({ p, q: p.map((x) => [...x] as V3) });
            }
            initialised = true;
          }
          const time = world.getResource(Time).elapsed;
          // Flame-like flutter, a quarter cycle behind the body bob.
          const lag = 2 * Math.PI * t.sash.lagCycles;
          const damping = Math.exp(-t.sash.damping * dt);
          worstAboveHead = -Infinity;
          worstAhead = -Infinity;
          worstTipY = -Infinity;
          for (let s = 0; s < strands; s += 1) {
            const anchor = SASH_ANCHORS[s % SASH_ANCHORS.length]!;
            const side = anchor[0] < 0 ? -1 : 1;
            const { p, q } = chain[s]!;
            p[0] = anchorWorld(anchor);
            q[0] = [...p[0]];
            for (let i = 1; i < points; i += 1) {
              const u = i / segments;
              // Rest shape (root-local): back and up, slightly outward, with a travelling flutter.
              const wave = flutter * Math.sin(floatState.bobPhase - lag - u * 2.4 + s * 0.9);
              const restLocal: V3 = [
                anchor[0] + side * (0.03 + 0.07 * u) + 0.06 * u * wave,
                // Rise in an S: up off the shoulder, then trailing back; tips settle ~0.2 m below the bun tops.
                modelY + anchor[1] + (cooling ? -0.25 * u : 0.1 * Math.sin(Math.PI * Math.min(1, u * 1.4)) + 0.06 * u) + 0.08 * flutter * u * Math.sin(time * 2 * Math.PI * t.sash.tipFreq + s + u * 4),
                anchor[2] + 0.12 + segLength * segments * 0.85 * u,
              ];
              const rest = toWorld(restLocal);
              const cur = p[i]!, prev = q[i]!;
              const vel: V3 = [(cur[0] - prev[0]) * damping, (cur[1] - prev[1]) * damping, (cur[2] - prev[2]) * damping];
              const k = t.sash.stiffness * (0.35 + 0.65 * (1 - u));
              const acc: V3 = [(rest[0] - cur[0]) * k, (rest[1] - cur[1]) * k + t.sash.buoyancy * u, (rest[2] - cur[2]) * k];
              q[i] = [...cur];
              p[i] = [cur[0] + vel[0] + acc[0] * dt * dt, cur[1] + vel[1] + acc[1] * dt * dt, cur[2] + vel[2] + acc[2] * dt * dt];
            }
            // Length constraints, then the readability limits (local space).
            for (let iter = 0; iter < 2; iter += 1) {
              for (let i = 1; i < points; i += 1) {
                const a = p[i - 1]!, b = p[i]!;
                const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                const len = Math.hypot(...d) || 1;
                const f = segLength / len;
                p[i] = [a[0] + d[0] * f, a[1] + d[1] * f, a[2] + d[2] * f];
              }
            }
            for (let i = 1; i < points; i += 1) {
              const l = toLocal(p[i]!);
              // M3: no height limit any more; never in front of the back of the head (except mid-roll).
              if (!rolled) l[2] = Math.max(l[2], anchor[2] + 0.06);
              // Rolling (and while reeling back out): hard ceiling 3.45 m above the vortex.
              if (rolling || reel > 0) l[1] = Math.min(l[1], capLocal);
              l[1] = Math.max(l[1], -CAPSULE_CENTER_Y + 0.3); // fire never touches the seabed
              p[i] = toWorld(l);
              worstAboveHead = Math.max(worstAboveHead, l[1] - headTop);
              worstAhead = Math.max(worstAhead, -(l[2] - anchor[2]));
              if (rolling) worstTipY = Math.max(worstTipY, l[1] + CAPSULE_CENTER_Y);
            }
            // Ribbon vertices (root-local), tapering from 8 cm to 3 cm.
            for (let i = 0; i < points; i += 1) {
              const l = toLocal(p[i]!);
              const half = 0.06 - 0.035 * (i / segments);
              const v = s * vertsPerStrand + i * 2;
              // Ribbon face stands mostly upright (width along local Y/X) so it reads from behind and the side.
              positions.set([l[0] - half * 0.45, l[1] - half, l[2]], v * 3);
              positions.set([l[0] + half * 0.45, l[1] + half, l[2]], (v + 1) * 3);
            }
          }
          let tipSpeed = 0;
          for (const { p, q } of chain) tipSpeed += Math.hypot(p[points - 1]![0] - q[points - 1]![0], p[points - 1]![1] - q[points - 1]![1], p[points - 1]![2] - q[points - 1]![2]) / dt;
          ribbonV = r3(tipSpeed / Math.max(1, chain.length));
          assets.writeRange(mesh, { attribute: 'position', first: 0, values: positions }).unwrap();
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-float-fx').unwrap();

      yield telemetry.section('float', () => ({
        hoverY,
        ribbonV,
        gate: r3(gate),
        amp: r3(floatState.amp),
        freq: tuning.current.float.idleFreq,
        roll: r3((floatState.roll * 180) / Math.PI),
        mode: player.mode(),
      }));
      yield telemetry.section('sash', () => ({
        strands,
        segments,
        tipAboveHeadTop: r3(worstAboveHead),
        aheadOfAnchor: r3(worstAhead),
        length: r3(tuning.current.sash.length + (tuning.current.sash.rollLength - tuning.current.sash.length) * reel),
        reel: r3(reel),
        rollTopY: Number.isFinite(worstTipY) ? r3(worstTipY) : null,
      }));
    }, 'nezha/float-fx');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.floatFxPlugin,
  build: () => ok({
    'plugin/float-fx': { kind: 'plugin', module: { specifier: './float-fx.pack.ts', export: 'floatFx' } },
  }),
});
