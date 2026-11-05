import type { EntityHandle, World } from '@forgeax/engine/ecs';
import { sceneEntity, worldResolveSceneEntity } from '@forgeax/engine/scene';

export interface GameScene {
  readonly root: EntityHandle;
}
declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    gameScene: GameScene;
  }
}

export const GAME_SCENE_SOURCE_KEY = 'scene/dragon-palace' as const;

/** Resolve an instance-relative authored binding without consulting display names. */
export function resolveGameEntity(world: World, host: GameScene, entityKey: string): EntityHandle {
  if (host.root === undefined) {
    throw new Error(`dragon palace scene is unavailable for entity ${entityKey}`);
  }
  const resolved = worldResolveSceneEntity(
    world,
    host.root,
    sceneEntity(GAME_SCENE_SOURCE_KEY, entityKey),
  );
  if (!resolved.ok) throw resolved.error;
  return resolved.value;
}
