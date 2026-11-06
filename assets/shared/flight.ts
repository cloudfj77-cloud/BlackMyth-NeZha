/**
 * Mid-air combat (boss 11-06 20:57): Nezha and the dragon fight up in the air over the 镇海台 whirlpool.
 *  - the fight height is two Nezhas tall (her wheels / the dragon's underside ≈ 3.4 m above the stage);
 *  - both float up and down over a band one Nezha tall (peak to peak 1.7 m), slowly, out of phase;
 *  - on the road and when free-roaming she hovers low (v1.4.0 0.5 m).
 */
/** Nezha's standing height, wheels to the top of her buns (v1.4.0 rig × 0.86). */
export const NEZHA_HEIGHT = 1.7;
export const FLIGHT = Object.freeze({
  /** Wheels / underside above the stage while fighting. */
  height: 2 * NEZHA_HEIGHT,
  /** Half of the up-down band (the band is one Nezha tall). */
  // Asset v2 / boss 11-06: the same swell as the dragon, ±2 m every 4.5 s.
  bob: 2.0,
  /** Nezha's slow air swell (Hz) and the dragon's (a travelling wave along its body). */
  nezhaHz: 1 / 4.5,
  dragonHz: 1 / 4.5,
  /** Rise / descent smoothing rate (1/s). */
  rate: 1.6,
});

/** Nezha's altitude above her low hover at fight time t (s): two-frequency swell inside the band. */
export function nezhaFlight(t: number): number {
  const w = 2 * Math.PI * FLIGHT.nezhaHz * t;
  const swell = 0.8 * Math.sin(w) + 0.2 * Math.sin(w * 2.3 + 1.1);
  return FLIGHT.height + FLIGHT.bob * swell;
}

/** The dragon's underside height at body point i, time t (s): the same band, a wave down the body. */
export function dragonFlight(i: number, t: number): number {
  return FLIGHT.height + FLIGHT.bob * Math.sin(2 * Math.PI * FLIGHT.dragonHz * t - i * 0.14 + 2.0);
}
