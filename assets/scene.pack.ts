import { quat } from '@forgeax/engine/math';
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
import { WATER_HORIZON } from './environment.pack.ts';
import { assetGuid, characterGuid, geometryGuid, guidText, PACKAGE_IDS, SUN_OUTGOING_DIRECTION } from './shared/asset-refs.ts';
import { GROUPS } from './shared/collision.ts';
import { canyonWallSegments, ringWallSegments } from './shared/greybox.ts';
import { ARENA, BEAM, CANYON, canyonCenterX, canyonHalfWidth, FLOOR_Y, LOCK_TARGET, PALACE, PILLARS, SPAWN, targetThickness, type Vec3 } from './shared/layout.ts';
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


function dragonPalace(): SceneAsset {
  const entities: [string, SceneEntity][] = [];
  const add = (key: string, components: Components) => entities.push([key, { components }]);

  // --- Lighting: cool only. Dim blue key from the sea surface + underwater sky + distance fog.
  add('sun', {
    Name: { value: 'Sea Surface Light' },
    DirectionalLight: { direction: SUN_OUTGOING_DIRECTION, color: [0.55, 0.78, 0.95], intensity: 1.6, castShadow: true, shadowDistance: 60 },
  });
  add('skylight', {
    Name: { value: 'Underwater Skylight' },
    Skylight: { equirect: guidText(assetGuid(PACKAGE_IDS.environment, 'environment/underwater')), color: [1, 1, 1], intensity: 0.55 },
  });
  add('sky-background', {
    Name: { value: 'Underwater Background' },
    SkyboxBackground: { equirect: guidText(assetGuid(PACKAGE_IDS.environment, 'environment/underwater')), mode: SKYBOX_MODE_CUBEMAP },
  });
  add('fog', {
    Name: { value: 'Deep Water Fog' },
    Fog: { color: WATER_HORIZON, density: 0.035, heightFalloff: 0.012, maxOpacity: 0.97, mode: FogModeValue.exp },
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
      clearColor: [WATER_HORIZON[0], WATER_HORIZON[1], WATER_HORIZON[2], 1],
    },
  });

  // --- Level: merged visual meshes + collider-only entities.
  add('level/seabed', { Name: { value: 'Seabed' }, Transform: { pos: [0, FLOOR_Y - 0.2, 0] }, ...mesh(geometryGuid('seabed')), ...cuboid([120, 0.2, 120]) });
  add('level/plaza', { Name: { value: 'White Jade Plaza' }, Transform: { pos: [0, FLOOR_Y + 0.006, 0] }, ...mesh(geometryGuid('plaza')) });
  add('level/walls', { Name: { value: 'Palace And Reef Walls' }, Transform: { pos: [0, 0, 0] }, ...mesh(geometryGuid('walls')) });
  add('level/trench', { Name: { value: 'Far Trench' }, Transform: { pos: [0, 0, 0] }, ...mesh(geometryGuid('trench')) });
  ringWallSegments().forEach((segment, index) => {
    add(`collider/ring-${index}`, {
      Name: { value: `Palace Wall ${index}` },
      Transform: { pos: [segment.x, ARENA.wallHeight / 2, segment.z], quat: q(yawQ(segment.yaw)) },
      ...cuboid([segment.length / 2, ARENA.wallHeight / 2, ARENA.wallThickness / 2]),
    });
  });
  canyonWallSegments().forEach((segment, index) => {
    add(`collider/canyon-${index}`, {
      Name: { value: `Reef Wall ${index}` },
      Transform: { pos: [segment.x, CANYON.wallHeight / 2, segment.z], quat: q(yawQ(segment.yaw)) },
      ...cuboid([segment.length / 2 + 0.3, CANYON.wallHeight / 2, CANYON.wallThickness / 2]),
    });
  });
  const facadeHalf = ARENA.wallRadius * Math.sin((ARENA.gateHalfAngleDeg * Math.PI) / 180) + 1.5;
  add('collider/facade', { Name: { value: 'Palace Facade' }, Transform: { pos: [0, 4.5, PALACE.facadeZ - 0.7] }, ...cuboid([facadeHalf, 4.5, 0.7]) });
  add('collider/canyon-end', {
    Name: { value: 'Canyon Dead End' },
    Transform: { pos: [canyonCenterX(CANYON.zEnd), CANYON.wallHeight / 2, CANYON.zEnd + 1.2] },
    ...cuboid([canyonHalfWidth(CANYON.zEnd) + 3, CANYON.wallHeight / 2, 1.2]),
  });

  // --- Standing pillars: each its own entity so it can fade alone.
  for (const pillar of PILLARS) {
    add(`pillar/${pillar.id}`, {
      Name: { value: `Dragon Pillar ${pillar.id}` },
      Transform: { pos: [pillar.x, pillar.height / 2, pillar.z] },
      ...mesh(geometryGuid(pillar.id.startsWith('plaza') ? 'pillar-plaza' : 'pillar-canyon')),
      ...cylinder(pillar.radius, pillar.height / 2, GROUPS.pillar),
    });
  }

  // --- Lock-on placeholder (render-only unit box; the hover controller keeps Nezha outside it).
  const height = TUNING.lock.targetHeight;
  add('lock-target', {
    Name: { value: 'Lock Target Placeholder' },
    Transform: {
      pos: [LOCK_TARGET.center[0], LOCK_TARGET.center[1] + height / 2, LOCK_TARGET.center[2]],
      quat: q(yawQ(LOCK_TARGET.yaw)),
      scale: [TUNING.lock.targetLength, height, targetThickness(height)],
    },
    ...mesh(geometryGuid('lock-target')),
  });

  // --- Light beam over the plaza (swayed by the ambience plugin).
  add('beam', {
    Name: { value: 'Light Beam' },
    Transform: { pos: BEAM.origin, scale: [BEAM.bottomRadius, BEAM.height, BEAM.bottomRadius] },
    ...mesh(geometryGuid('beam')),
  });

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
  add('player/body', { Name: { value: 'Nezha Body' }, Transform: { pos: [0, 0, 0] }, ChildOf: { parent: 'player/model' }, ...mesh(characterGuid('nezha-body')) });
  add('player/spear', {
    Name: { value: 'Fire-Tipped Spear' },
    Transform: { pos: [NEZHA.grip[0], NEZHA.grip[1], NEZHA.grip[2]], quat: q(quat.fromEuler(quat.create(), (-NEZHA.spearTiltDeg * Math.PI) / 180, 0, 0, 'YXZ')) },
    ChildOf: { parent: 'player/model' },
    ...mesh(characterGuid('nezha-spear')),
  });
  add('player/wheels', { Name: { value: 'Wind-Fire Wheels' }, Transform: { pos: [0, 0, 0] }, ChildOf: { parent: 'player/model' }, ...mesh(characterGuid('nezha-wheels')) });
  add('player/glow', {
    Name: { value: 'Contact Glow' },
    Transform: { pos: [0, -CAPSULE_CENTER_Y + 0.015, 0], scale: [TUNING.glow.radius, 1, TUNING.glow.radius] },
    ChildOf: { parent: 'player' },
    ...mesh(characterGuid('contact-glow')),
  });

  return { kind: 'scene', entities: Object.fromEntries(entities) };
}

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.scene,
  name: 'Nezha / Dragon Palace Scene',
  sceneComponents: [
    Camera, CharacterController, ChildOf, Collider, DirectionalLight, Fog, MeshFilter, MeshRenderer, Name,
    RigidBody, SkyboxBackground, Skylight, Transform,
  ],
  build: () => ok({ [GAME_SCENE_SOURCE_KEY]: dragonPalace() }),
});
