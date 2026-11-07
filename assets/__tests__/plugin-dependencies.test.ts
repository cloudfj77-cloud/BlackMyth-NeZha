import { Context, inspectPluginFiber, type Plugin } from '@forgeax/engine/plugin';
import { describe, expect, it } from 'vitest';
import { core } from '../core/core.pack.ts';
import { ui } from '../ui/ui.pack.ts';
import { scene } from '../world/world.pack.ts';

const asset = '00000000-0000-4000-8000-000000000001';
const cases: { name: string; plugin: Plugin; missing: string; config: unknown }[] = [
  { name: 'core requires the App-owned GameHost', plugin: core, missing: 'gameHost', config: undefined },
  { name: 'scene requires physics before spawning', plugin: scene, missing: 'physics', config: { scene: asset, children: [] } },
  { name: 'UI requires assets before touching the DOM', plugin: ui, missing: 'assets', config: { menu: asset } },
];

describe('plugin activation prerequisites', () => {
  for (const { name, plugin, missing, config } of cases) {
    it(name, async () => {
      const ctx = new Context();
      // Unused sentinels: any eager apply would fail instead of silently
      // substituting a fake World, physics backend, asset loader, or DOM.
      for (const service of ['world', 'gameHost', 'gameScene', 'physics', 'assets', 'pluginPrograms']) {
        if (service === missing || (plugin === scene && service === 'gameScene')) continue;
        ctx.provide(service, Object.freeze({}));
      }
      try {
        const fork = ctx.plugin(plugin, config);
        await fork.await();
        expect(inspectPluginFiber(fork.ctx.fiber)).toMatchObject({ state: 'pending', missingServices: [missing] });
        await fork.dispose();
        expect(inspectPluginFiber(fork.ctx.fiber).state).toBe('disposed');
        expect([...ctx.registry.values()].flatMap((runtime) => runtime.fibers)).toHaveLength(0);
      } finally {
        await ctx.fiber.dispose();
      }
    });
  }
});
