import { describe, expect, it } from 'vitest';
import { createRun, LINES, rating, RUN, timerSeconds, type RunInput } from '../fight/run.ts';

const go = (run: ReturnType<typeof createRun>, steps: number, input: RunInput = {}) => {
  const actions = [];
  for (let i = 0; i < steps; i += 1) actions.push(...run.step(input));
  return actions;
};

describe('one run (M4)', () => {
  it('rates S / A / B on whole steps (180.0 s counts as within 3 minutes)', () => {
    expect(rating(10800, 3)).toBe('S');
    expect(rating(10801, 3)).toBe('A');
    expect(rating(10800, 4)).toBe('A');
    expect(rating(18000, 8)).toBe('A');
    expect(rating(18001, 8)).toBe('B');
    expect(rating(18000, 9)).toBe('B');
    expect(timerSeconds(1)).toBe(0.1);
    expect(timerSeconds(6)).toBe(0.1);
    expect(timerSeconds(7)).toBe(0.2);
  });
  it('plays the intro for 852 steps: no control, first viewing skips only to 390, then the fight starts', () => {
    const run = createRun();
    go(run, 10);
    expect(run.snapshot().stage).toBe('canyon');
    expect(run.step({ entered: true })).toEqual([{ type: 'begin-intro' }]);
    expect(run.controls()).toBe(false);
    go(run, 99);
    expect(run.skipHint()).toBe(true);
    expect(run.step({ enter: true })).toEqual([{ type: 'skip-intro', to: 390 }]);
    expect(run.snapshot().k).toBe(390);
    expect(run.skipHint()).toBe(false);
    expect(run.step({ enter: true })).toEqual([]);
    expect(run.subtitle()?.key).toBe('dialogue.dragonKing.intro');
    const acts = go(run, RUN.introEnd - 391);
    expect(acts).toEqual([{ type: 'intro-end' }]);
    expect(run.snapshot().stage).toBe('fight');
    expect(run.controls()).toBe(true);
    expect(run.snapshot().timer).toBe(0);
  });
  it('lets a second viewing skip the whole intro', () => {
    const run = createRun();
    run.step({ entered: true });
    go(run, RUN.introEnd);
    run.step({ toTitle: true });
    run.step({ entered: true });
    go(run, 5);
    expect(run.step({ enter: true })).toEqual([{ type: 'skip-intro', to: RUN.introEnd }, { type: 'intro-end' }]);
  });
  it('times only the fight: phase change and pauses stop the clock', () => {
    const run = createRun();
    run.step({ entered: true });
    go(run, RUN.introEnd);
    go(run, 100);
    expect(run.snapshot().timer).toBe(100);
    // The step on which the change happens is still a fight step.
    run.step({ phaseChange: true });
    go(run, 569);
    expect(run.snapshot().timer).toBe(101);
    run.step({ transitionEnd: true });
    go(run, 50);
    expect(run.snapshot().timer).toBe(151);
  });
  it('shows the phase-change lines on the 570-step change, once per session', () => {
    const run = createRun();
    run.step({ restart: true });
    run.step({ phaseChange: true });
    expect(run.snapshot().stage).toBe('transition');
    go(run, 9);
    expect(run.subtitle()?.key).toBe('dialogue.dragonKing.phase2');
    go(run, 290);
    expect(run.subtitle()?.key).toBe('dialogue.nezha.phase2');
    run.step({ transitionEnd: true });
    run.step({ restart: true });
    run.step({ phaseChange: true });
    go(run, 10);
    expect(run.subtitle()).toBeUndefined();
  });
  it('defeat: first time the line, 「败」 at 110; later at 45 without the line; no automatic retry', () => {
    const run = createRun();
    run.step({ restart: true });
    run.step({ playerDead: true });
    expect(run.snapshot().stage).toBe('defeat');
    go(run, 19);
    expect(run.subtitle()).toBeUndefined();
    run.step({});
    expect(run.subtitle()?.key).toBe('dialogue.dragonKing.defeat');
    go(run, 89);
    expect(run.defeatBanner()).toBe(false);
    run.step({});
    expect(run.defeatBanner()).toBe(true);
    go(run, 2000);
    expect(run.snapshot().stage).toBe('defeat');
    expect(run.step({ retry: true })).toEqual([{ type: 'reset', reason: 'retry' }]);
    expect(run.snapshot()).toMatchObject({ stage: 'fight', timer: 0, hits: 0, deaths: 1, attempt: 3 });
    run.step({ playerDead: true });
    go(run, 44);
    expect(run.defeatBanner()).toBe(false);
    expect(run.subtitle()).toBeUndefined();
    run.step({});
    expect(run.defeatBanner()).toBe(true);
    expect(run.step({ enter: true })).toEqual([{ type: 'reset', reason: 'retry' }]);
    expect(run.snapshot().played.defeat).toBe(true);
  });
  it('victory: lines at 60 / 270 on real steps, the result at 400, both-dead counts as a win', () => {
    const run = createRun();
    run.step({ restart: true });
    go(run, 1000, {});
    run.step({ hurt: 1 });
    run.step({ perfect: 1 });
    expect(run.step({ dragonDead: true, playerDead: true })).toEqual([{ type: 'victory' }]);
    const s = run.snapshot();
    expect(s.result).toMatchObject({ outcome: 'victory', hits: 1, perfects: 1, rating: 'S' });
    expect(s.result?.steps).toBe(1003);
    go(run, 59);
    expect(run.subtitle()).toBeUndefined();
    run.step({});
    expect(run.subtitle()?.key).toBe(LINES.victory[0]!.key);
    go(run, 150);
    expect(run.subtitle()).toBeUndefined();
    go(run, 60);
    expect(run.subtitle()?.key).toBe(LINES.victory[1]!.key);
    const acts = go(run, 130);
    expect(acts).toEqual([{ type: 'result' }]);
    expect(run.snapshot().stage).toBe('result');
    expect(run.step({ enter: true })).toEqual([{ type: 'reset', reason: 'retry' }]);
  });
  it('keeps every line on screen at least max(90, 4 × English characters) steps, 10 apart', () => {
    for (const lines of Object.values(LINES)) {
      for (let i = 0; i < lines.length; i += 1) {
        expect(lines[i]!.to - lines[i]!.from).toBeGreaterThanOrEqual(90);
        if (i > 0) expect(lines[i]!.from - lines[i - 1]!.to).toBeGreaterThanOrEqual(10);
      }
    }
  });
  it('falling on the boardwalk shows 「败」 (no lines, no record) and retry goes back to the road', () => {
    const run = createRun();
    const a = run.step({ playerDead: true });
    expect(a).toEqual([{ type: 'defeat', first: false, road: true }]);
    expect(run.snapshot().stage).toBe('defeat');
    expect(run.snapshot().records.length).toBe(0);
    for (let i = 0; i < RUN.defeatBannerLater; i += 1) run.step({});
    expect(run.step({ enter: true })).toEqual([{ type: 'to-road' }]);
    expect(run.snapshot().stage).toBe('canyon');
    // The boss fight's own defeat still retries into the fight.
    run.step({ entered: true });
    expect(run.snapshot().stage).toBe('intro');
  });
  it('the result screen can go to free roaming (v1.4.0 自由游览), HUD on, and back to a fresh fight', () => {
    const run = createRun();
    run.step({ entered: true });
    run.step({ enter: true });
    run.step({ enter: true });
    for (let i = 0; i < RUN.introEnd; i += 1) run.step({});
    run.step({ dragonDead: true });
    for (let i = 0; i < RUN.victoryResult; i += 1) run.step({});
    expect(run.snapshot().stage).toBe('result');
    expect(run.step({ roam: true })).toEqual([{ type: 'roam' }]);
    expect(run.snapshot().stage).toBe('roam');
    expect(run.hudVisible()).toBe(true);
    expect(run.step({ enter: true })).toEqual([]);
    expect(run.step({ restart: true })[0]!.type).toBe('reset');
  });
});
