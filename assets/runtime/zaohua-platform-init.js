// Zaohua platform SDK base initialization (M1: base version, no optional capability).
// Compiled by the Zaohua plugin and awaited before the engine bundle starts.
import { initialize } from 'zaohua-platform-sdk';

await initialize({ capabilities: [] });
globalThis.__nezhaPlatform = { initialized: true };
