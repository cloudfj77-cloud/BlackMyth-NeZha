import { definePack, definePackageId } from '@forgeax/engine/pack/source';
import { ok } from '@forgeax/engine/types';
import { assetGuid, guidText, PACKAGE_IDS, pluginGuid } from '../shared/asset-refs.ts';
import { joinPluginFiber, mountPluginAsset, type Plugin } from '@forgeax/engine/plugin';
import { worldDespawnScene } from '@forgeax/engine/scene';
import { GAME_SCENE_SOURCE_KEY } from '../shared/scene-refs.ts';

/** Scene owner: instantiates the Dragon Palace greybox, provides it, then mounts gameplay children in order. */
export const scene: Plugin.Object<{ readonly scene: string; readonly children: readonly string[] }> = {
  name: 'nezha/scene',
  inject: ['world', 'assets', 'physics', 'pluginPrograms'],
  async apply(ctx, config) {
    const assets = ctx.assets;
    if (!assets) throw new Error('scene owner requires assets');
    const loaded = await assets.load(assets.parseGuid(config.scene), 'scene');
    if (!loaded.ok) throw loaded.error;
    // Register each inverse immediately; generator disposal joins children before scene data.
    await ctx.effect(async function* () {
      const handle = loaded.value;
      yield () => {
        assets.release(handle).unwrap();
      };
      const root = assets.instantiate(handle, ctx.world).unwrap();
      yield () => worldDespawnScene(ctx.world, root).unwrap();
      yield ctx.provide('gameScene', { root });
      for (const guid of config.children) {
        const child = await mountPluginAsset(ctx, guid);
        if (!child.ok) throw child.error;
        yield joinPluginFiber(child.value);
      }
    });
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: definePackageId('019fb7ce-3a00-7000-8000-000000000000'),
  build: () => ok({
    'plugin/scene': {
      kind: 'plugin',
      module: { specifier: './world.pack.ts', export: 'scene' },
      config: {
        scene: { $asset: guidText(assetGuid(PACKAGE_IDS.scene, GAME_SCENE_SOURCE_KEY)) },
        children: [
          { $asset: pluginGuid(PACKAGE_IDS.corePlugin, 'core') },
          { $asset: pluginGuid(PACKAGE_IDS.hoverPlayerPlugin, 'hover-player') },
          { $asset: pluginGuid(PACKAGE_IDS.cameraPlugin, 'camera') },
          { $asset: pluginGuid(PACKAGE_IDS.seaPlugin, 'sea') },
          { $asset: pluginGuid(PACKAGE_IDS.dragonPlugin, 'dragon') },
          { $asset: pluginGuid(PACKAGE_IDS.lockOnPlugin, 'lock-on') },
          { $asset: pluginGuid(PACKAGE_IDS.combatPlugin, 'combat') },
          { $asset: pluginGuid(PACKAGE_IDS.fightPlugin, 'fight') },
          { $asset: pluginGuid(PACKAGE_IDS.rigPlugin, 'rig') },
          { $asset: pluginGuid(PACKAGE_IDS.floatFxPlugin, 'float-fx') },
          { $asset: pluginGuid(PACKAGE_IDS.occlusionPlugin, 'occlusion') },
        ],
      },
    },
  }),
});
