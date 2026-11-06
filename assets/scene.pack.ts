import { quat } from '@forgeax/engine/math';
import { JOINT_NAMES, JOINT_PARTS, JOINTS, jointKey, kebab, RIG_SCALE } from './nezha-rig/rig-def.ts';
import { definePack } from '@forgeax/engine/pack/source';
import {
  CharacterController,
  Collider,
  ColliderShapeValue,
  RigidBody,
  RigidBodyTypeValue,
} from '@forgeax/engine/physics';
import {
  ANTIALIAS_FXAA,
  Camera,
  DirectionalLight,
  Fog,
  PointLight,
  FogModeValue,
  MeshFilter,
  MeshRenderer,
  perspective,
  SKYBOX_MODE_CUBEMAP,
  SkyboxBackground,
  Skylight,
  TONEMAP_ACES_FILMIC,
} from '@forgeax/engine/render';
import { ChildOf, Name, Transform } from '@forgeax/engine/scene';
import type { AssetGuid, SceneAsset, SceneEntity } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import { SEA_FOG } from './environment.pack.ts';
import { pillarSpan } from './sea/sea-geometry.ts';
import { MOB_SLOTS, mobKey, YJOINT_NAMES, YJOINT_PARTS, YJOINTS } from './yaksha/rig-def.ts';
import { ARENA_PILLARS, LEVEL_SCALE, SEA, SEA_LAMPS } from './shared/sea-layout.ts';
import { assetGuid, characterGuid, geometryGuid, guidText, PACKAGE_IDS, SUN_OUTGOING_DIRECTION } from './shared/asset-refs.ts';
import { GROUPS } from './shared/collision.ts';
import { FLOOR_Y, SPAWN, type Vec3 } from './shared/layout.ts';
import { yawQ } from './shared/mesh-kit.ts';
import { NEZHA } from './shared/nezha-shape.ts';
import { CAPSULE_CENTER_Y, CAPSULE_SKIN } from './shared/player-rig.ts';
import { GAME_SCENE_SOURCE_KEY } from './shared/scene-refs.ts';
import TUNING from './data/tuning.json' with { type: 'json' };

type Components = Record<string, Record<string, unknown>>;

const staticBody = { RigidBody: { type: RigidBodyTypeValue.static } };
const cuboid = (halfExtents: Vec3, group: number = GROUPS.world): Components => ({
  ...staticBody,
  Collider: { shape: ColliderShapeValue.cuboid, halfExtents, friction: 0.8, restitution: 0, collisionGroups: group },
});
const cylinder = (radius: number, halfHeight: number, group: number): Components => ({
  ...staticBody,
  Collider: { shape: ColliderShapeValue.cylinder, radius, halfHeight, friction: 0.8, restitution: 0, collisionGroups: group },
});

const mesh = (guid: AssetGuid): Components => ({
  MeshFilter: { assetHandle: guidText(guid) },
  MeshRenderer: { materials: [] },
});

const q = (value: ArrayLike<number>): [number, number, number, number] => [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1];


/** Contact glow height: above the plaza slab top (0.026 m) so it shows on the seabed and the plaza alike. */
const GLOW_Y = 0.04;

function dragonPalace(): SceneAsset {
  const entities: [string, SceneEntity][] = [];
  const add = (key: string, components: Components) => entities.push([key, { components }]);

  // --- Lighting (v1.4.0 陈塘关): low cold sun in the south, overcast sea sky, grey-green sea fog.
  const SKY = guidText(assetGuid(PACKAGE_IDS.environment, 'environment/sea-sky'));
  add('sun', {
    Name: { value: 'Cold Sun' },
    DirectionalLight: { direction: SUN_OUTGOING_DIRECTION, color: [0.72, 0.8, 1.0], intensity: 2.4, castShadow: true, shadowDistance: 60 },
  });
  add('skylight', { Name: { value: 'Sea Sky Light' }, Skylight: { equirect: SKY, color: [1, 1, 1], intensity: 1.5 } });
  add('sky-background', { Name: { value: 'Sea Sky' }, SkyboxBackground: { equirect: SKY, mode: SKYBOX_MODE_CUBEMAP } });
  add('fog', {
    Name: { value: 'Sea Fog' },
    // v1.4.0 FogExp2(0x7d9aa2, 0.0115); distances are 0.86×, so density / 0.86.
    Fog: { color: SEA_FOG, density: 0.0115 / LEVEL_SCALE, maxOpacity: 1, mode: FogModeValue.exp2 },
  });

  // --- Camera (the camera plugin owns its pose every frame).
  const spawnFocus: Vec3 = [SPAWN[0], 1.6, SPAWN[2]];
  const cameraPosition: Vec3 = [SPAWN[0] + 0.6, 2.6, SPAWN[2] + 5];
  const cameraRotation = quat.fromLookAt(quat.create(), cameraPosition, spawnFocus, [0, 1, 0]);
  add('camera', {
    Name: { value: 'Main Camera' },
    Transform: { pos: cameraPosition, quat: q(cameraRotation) },
    Camera: {
      ...perspective({ fov: (TUNING.camera.fovY * Math.PI) / 180, aspect: 16 / 9, near: 0.05, far: 320 }),
      tonemap: TONEMAP_ACES_FILMIC,
      antialias: ANTIALIAS_FXAA,
      clearColor: [SEA_FOG[0], SEA_FOG[1], SEA_FOG[2], 1],
    },
  });

  // --- Level: 东海 · 陈塘关 (v1.4.0 port). Walking limits live in `seaConstrain` (sea plugin);
  // physics only keeps the floor and the pillar cylinders (see-through probes).
  add('level/floor', { Name: { value: 'Walk Floor (collider)' }, Transform: { pos: [0, FLOOR_Y - 0.2, 50] }, ...cuboid([160, 0.2, 160]) });
  const level = (key: string, name: string, pos: Vec3 = [0, 0, 0]) => add(`level/${key}`, { Name: { value: name }, Transform: { pos }, ...mesh(geometryGuid(`sea-${key}`)) });
  level('walk', 'Chentang Boardwalk');
  level('rocks', 'Shore Reefs');
  level('gate', 'Sea-Calming Water Gate');
  level('arena', 'Sea-Calming Terrace');
  level('runes', 'Taiji Runes');
  level('lotus-pond', 'Taiyi Lotus Pond');
  level('coral', 'Coral');
  level('palace', 'Distant Dragon Palace');
  add('level/lotus', { Name: { value: 'Taiyi Lotus' }, Transform: { pos: [SEA.lotus[0], 0.35 * LEVEL_SCALE, SEA.lotus[1]] }, ...mesh(geometryGuid('sea-lotus')) });
  add('level/veil', { Name: { value: 'Gate Water Curtain' }, Transform: { pos: [0, 0, SEA.gateZ] }, ...mesh(geometryGuid('sea-veil')) });
  add('level/mist', { Name: { value: 'Entry Mist' }, Transform: { pos: [0, 0, SEA.mistZ], scale: [1, 0, 1] }, ...mesh(geometryGuid('sea-mist')) });
  // Platform pillars: one entity each (fade alone), mesh and collider centred at half height.
  for (const pillar of ARENA_PILLARS) {
    const span = pillarSpan(pillar.height);
    add(`pillar/${pillar.id}`, {
      Name: { value: `Dragon Pillar ${pillar.id}` },
      Transform: { pos: [pillar.x, span / 2, pillar.z] },
      ...mesh(geometryGuid(`sea-pillar-${Math.round(pillar.height * 100)}`)),
      ...cylinder(0.8 * LEVEL_SCALE, span / 2, GROUPS.pillar),
    });
  }
  // Lights: every other sea lamp, the lotus, and the arena light (rises in the fight).
  SEA_LAMPS.forEach(([x, z], i) => {
    if (i % 2) return;
    add(`light/lamp-${i}`, { Name: { value: `Sea Lamp Light ${i}` }, Transform: { pos: [x, 1.7 * LEVEL_SCALE, z] }, PointLight: { color: [0.42, 0.85, 1.0], intensity: 12, range: 9 * LEVEL_SCALE, decay: 2 } });
  });
  add('light/lotus', { Name: { value: 'Lotus Light' }, Transform: { pos: [SEA.lotus[0], 1.2 * LEVEL_SCALE, SEA.lotus[1]] }, PointLight: { color: [1.0, 0.54, 0.63], intensity: 10, range: 7 * LEVEL_SCALE, decay: 2 } });
  add('light/arena', { Name: { value: 'Arena Light' }, Transform: { pos: [0, 8 * LEVEL_SCALE, 0] }, PointLight: { color: [0.29, 0.82, 1.0], intensity: 0, range: 40 * LEVEL_SCALE, decay: 1.5 } });

  // --- 巡海夜叉: five rigs parked under the floor until a wave calls them (the plugin poses them).
  for (let slotIndex = 0; slotIndex < MOB_SLOTS; slotIndex += 1) {
    add(mobKey(slotIndex), { Name: { value: `Sea Yaksha ${slotIndex}` }, Transform: { pos: [0, -60, 0], scale: [LEVEL_SCALE, LEVEL_SCALE, LEVEL_SCALE] } });
    add(`${mobKey(slotIndex)}/fan`, { Name: { value: `Yaksha Fan ${slotIndex}` }, Transform: { pos: [0, 0, 0], scale: [0, 0, 0] }, ChildOf: { parent: mobKey(slotIndex) }, ...mesh(geometryGuid('yaksha-fan')) });
    for (const joint of YJOINT_NAMES) {
      const j = YJOINTS[joint];
      add(mobKey(slotIndex, joint), {
        Name: { value: `Yaksha ${slotIndex} ${joint}` },
        Transform: { pos: [...j.pos] },
        ChildOf: { parent: j.parent ? mobKey(slotIndex, j.parent) : mobKey(slotIndex) },
        ...(YJOINT_PARTS[joint] ? mesh(characterGuid(`yk-${joint.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`)) : {}),
      });
    }
  }

  // --- Nezha: root = kinematic capsule on the seabed; model child floats above it.
  const capsuleRadius = TUNING.move.capsuleRadius;
  add('player', {
    Name: { value: 'Nezha' },
    Transform: { pos: [SPAWN[0], FLOOR_Y + CAPSULE_CENTER_Y, SPAWN[2]] },
    RigidBody: { type: RigidBodyTypeValue.kinematic },
    Collider: {
      shape: ColliderShapeValue.capsule,
      radius: capsuleRadius,
      halfHeight: CAPSULE_CENTER_Y - CAPSULE_SKIN - capsuleRadius,
      friction: 0,
      restitution: 0,
      collisionGroups: GROUPS.player,
    },
    CharacterController: { offset: 0.02, maxSlopeClimbDeg: 40, minSlopeSlideDeg: 50, autoStepMaxHeight: 0.25, autoStepMinWidth: 0.15, snapToGroundDist: 0.3 },
  });
  add('player/model', {
    Name: { value: 'Nezha Model' },
    Transform: { pos: [0, -CAPSULE_CENTER_Y + TUNING.move.hoverHeight, 0] },
    ChildOf: { parent: 'player' },
  });
  // M1 greybox body / wheels stay as hidden references (silhouette QA reads the cooked meshes).
  add('player/body', { Name: { value: 'Nezha Body (greybox)' }, Transform: { pos: [0, 0, 0], scale: [0, 0, 0] }, ChildOf: { parent: 'player/model' }, ...mesh(characterGuid('nezha-body')) });
  add('player/wheels', { Name: { value: 'Wind-Fire Wheels (greybox)' }, Transform: { pos: [0, 0, 0], scale: [0, 0, 0] }, ChildOf: { parent: 'player/model' }, ...mesh(characterGuid('nezha-wheels')) });
  // Jointed Nezha (v1.4.0 port): rig root turned to face −Z and scaled to our silhouette height.
  add('player/rig', { Name: { value: 'Nezha Rig' }, Transform: { pos: [0, 0, 0], quat: q(quat.fromEuler(quat.create(), 0, Math.PI, 0, 'YXZ')), scale: [RIG_SCALE, RIG_SCALE, RIG_SCALE] }, ChildOf: { parent: 'player/model' } });
  for (const name of JOINT_NAMES) {
    const joint = JOINTS[name];
    add(jointKey(name), {
      Name: { value: `Nezha ${name}` },
      Transform: { pos: [...joint.pos] },
      ChildOf: { parent: joint.parent ? jointKey(joint.parent) : 'player/rig' },
      ...(JOINT_PARTS[name] ? mesh(characterGuid(`nz-${kebab(name)}`)) : {}),
    });
  }
  add('player/spear', {
    Name: { value: 'Fire-Tipped Spear' },
    Transform: { pos: [0, 0, 0], scale: [1 / RIG_SCALE, 1 / RIG_SCALE, 1 / RIG_SCALE] },
    ChildOf: { parent: jointKey('staffPivot') },
    ...mesh(characterGuid('nz-spear')),
  });
  add('player/glow', {
    Name: { value: 'Contact Glow' },
    Transform: { pos: [0, -CAPSULE_CENTER_Y + GLOW_Y, 0], scale: [TUNING.glow.radius, 1, TUNING.glow.radius] },
    ChildOf: { parent: 'player' },
    ...mesh(characterGuid('contact-glow')),
  });

  return { kind: 'scene', entities: Object.fromEntries(entities) };
}

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.scene,
  name: 'Nezha / Chentang Pass Scene',
  sceneComponents: [
    Camera, CharacterController, ChildOf, Collider, DirectionalLight, Fog, MeshFilter, MeshRenderer, Name, PointLight,
    RigidBody, SkyboxBackground, Skylight, Transform,
  ],
  build: () => ok({ [GAME_SCENE_SOURCE_KEY]: dragonPalace() }),
});
