/**
 * One run of the fight (M4, pure; tested in __tests__/run.test.ts). Real fixed steps (60/s):
 * hitstop and slow motion never stretch the banners, lines or the timer.
 * canyon → intro (852) → fight ⇄ transition → defeat (「败」, retry) | victory (lines) → result.
 * Design: design/milestones/M4-one-run.md §1, 2, 6–9.
 */

export const RUN = Object.freeze({
  introEnd: 852,
  /** The first viewing can only skip the fly-in and the shadow lap (to step 390); later ones skip it all. */
  introSkipTo: 390,
  defeatBannerFirst: 110,
  defeatBannerLater: 45,
  victoryHudFade: 30,
  victorySlowmo: 60,
  victoryResult: 400,
  /** S: ≤ 180.0 s and ≤ 3 hits; A: ≤ 300 s and ≤ 8 hits; else B. */
  sSteps: 10800,
  sHits: 3,
  aSteps: 18000,
  aHits: 8,
});

export type Speaker = 'dragonKing' | 'nezha';
export interface Line {
  /** Language-table key (ui namespace). */
  readonly key: string;
  readonly speaker: Speaker;
  /** First and last (exclusive) step the line is shown, from the scene's step 0. */
  readonly from: number;
  readonly to: number;
}

/** The subtitle timetable (M4 §6): the same steps in both languages, sized for English (4 steps/char, ≥ 90). */
export const LINES = Object.freeze({
  intro: [
    { key: 'dialogue.dragonKing.intro', speaker: 'dragonKing', from: 390, to: 678 },
    { key: 'dialogue.nezha.intro', speaker: 'nezha', from: 688, to: 852 },
  ] as readonly Line[],
  transition: [
    { key: 'dialogue.dragonKing.phase2', speaker: 'dragonKing', from: 0, to: 280 },
    { key: 'dialogue.nezha.phase2', speaker: 'nezha', from: 290, to: 570 },
  ] as readonly Line[],
  defeat: [{ key: 'dialogue.dragonKing.defeat', speaker: 'dragonKing', from: 20, to: 160 }] as readonly Line[],
  victory: [
    { key: 'dialogue.dragonKing.fall', speaker: 'dragonKing', from: 60, to: 210 },
    { key: 'dialogue.nezha.victory', speaker: 'nezha', from: 270, to: 370 },
  ] as readonly Line[],
});

export function lineAt(lines: readonly Line[], k: number): Line | undefined {
  return lines.find((l) => k >= l.from && k < l.to);
}

export type Rating = 'S' | 'A' | 'B';
export function rating(steps: number, hits: number): Rating {
  if (steps <= RUN.sSteps && hits <= RUN.sHits) return 'S';
  if (steps <= RUN.aSteps && hits <= RUN.aHits) return 'A';
  return 'B';
}
/** Shown time in seconds: steps rounded up to 0.1 s. */
export function timerSeconds(steps: number): number {
  return Math.ceil(steps / 6) / 10;
}

export type Stage = 'canyon' | 'intro' | 'fight' | 'transition' | 'defeat' | 'victory' | 'result' | 'roam';

export interface RunInput {
  /** Nezha crossed into the arena (canyon only). */
  readonly entered?: boolean;
  /** Enter key this step (skip / retry). */
  readonly enter?: boolean;
  /** Frontend commands: 「再战」, pause-menu 「重新开始」, 「回到标题」. */
  readonly retry?: boolean;
  readonly restart?: boolean;
  readonly toTitle?: boolean;
  /** Result screen 「自由游览」 (v1.4.0 btnRoam): walk the terrace freely after the win. */
  readonly roam?: boolean;
  readonly playerDead?: boolean;
  readonly phaseChange?: boolean;
  readonly transitionEnd?: boolean;
  readonly dragonDead?: boolean;
  /** Hits taken / perfect dodges this step (one per attack). */
  readonly hurt?: number;
  readonly perfect?: number;
}

export type RunAction =
  | { readonly type: 'begin-intro' }
  | { readonly type: 'skip-intro'; readonly to: number }
  | { readonly type: 'intro-end' }
  /** Back to a fresh fight at the checkpoint, intro skipped (retry / restart / result 「再战」). */
  | { readonly type: 'reset'; readonly reason: 'retry' | 'restart' }
  | { readonly type: 'to-canyon' }
  /** Retry after falling on the boardwalk (陈塘关 yaksha): back on the road, waves and gate reset. */
  | { readonly type: 'to-road' }
  | { readonly type: 'defeat'; readonly first: boolean; readonly road?: boolean }
  | { readonly type: 'victory' }
  | { readonly type: 'result' }
  | { readonly type: 'roam' };

export interface RunRecord {
  readonly attempt: number;
  readonly outcome: 'defeat' | 'victory';
  readonly steps: number;
  readonly seconds: number;
  readonly hits: number;
  readonly perfects: number;
  readonly rating: Rating | null;
}

export function createRun() {
  let stage: Stage = 'canyon';
  let k = 0;
  let timer = 0;
  let hits = 0;
  let perfects = 0;
  let attempt = 1;
  let deaths = 0;
  /** Played-this-session flags (M4 §6: lines play once; the intro is fully skippable once seen). */
  const played = { intro: false, transition: false, defeat: false };
  /** This scene shows its lines (decided when it starts). */
  let withLines = false;
  /** The current defeat happened on the boardwalk (yaksha), not in the boss fight. */
  let onRoad = false;
  let introSkippable = false;
  let result: RunRecord | null = null;
  const records: RunRecord[] = [];

  const enterStage = (next: Stage) => {
    stage = next;
    k = 0;
  };
  const record = (outcome: 'defeat' | 'victory'): RunRecord => {
    const r: RunRecord = { attempt, outcome, steps: timer, seconds: timerSeconds(timer), hits, perfects, rating: outcome === 'victory' ? rating(timer, hits) : null };
    records.push(r);
    while (records.length > 50) records.shift();
    return r;
  };
  const freshFight = () => {
    enterStage('fight');
    timer = 0;
    hits = 0;
    perfects = 0;
    result = null;
  };

  return {
    step(input: RunInput): RunAction[] {
      const out: RunAction[] = [];
      if (input.toTitle) {
        enterStage('canyon');
        timer = 0;
        hits = 0;
        perfects = 0;
        result = null;
        attempt += 1;
        onRoad = false;
        out.push({ type: 'to-canyon' });
        return out;
      }
      if (input.restart) {
        onRoad = false;
        attempt += 1;
        freshFight();
        out.push({ type: 'reset', reason: 'restart' });
        return out;
      }
      k += 1;
      switch (stage) {
        case 'canyon':
          k = 0;
          if (input.playerDead) {
            // Fell to the yaksha: 「败」 without the boss's lines; no run record (the boss was never met).
            deaths += 1;
            onRoad = true;
            withLines = false;
            enterStage('defeat');
            out.push({ type: 'defeat', first: false, road: true });
            break;
          }
          if (input.entered) {
            introSkippable = played.intro;
            played.intro = true;
            enterStage('intro');
            out.push({ type: 'begin-intro' });
          }
          break;
        case 'intro': {
          if (input.enter) {
            const to = introSkippable ? RUN.introEnd : k < RUN.introSkipTo ? RUN.introSkipTo : k;
            if (to > k) {
              k = to;
              out.push({ type: 'skip-intro', to });
            }
          }
          if (k >= RUN.introEnd) {
            freshFight();
            out.push({ type: 'intro-end' });
          }
          break;
        }
        case 'fight':
        case 'transition': {
          if (stage === 'fight') timer += 1;
          hits += input.hurt ?? 0;
          perfects += input.perfect ?? 0;
          if (input.dragonDead) {
            // Both at zero in the same step counts as a win.
            result = record('victory');
            enterStage('victory');
            out.push({ type: 'victory' });
          } else if (input.playerDead) {
            deaths += 1;
            record('defeat');
            withLines = !played.defeat;
            played.defeat = true;
            enterStage('defeat');
            out.push({ type: 'defeat', first: withLines });
          } else if (input.phaseChange && stage === 'fight') {
            withLines = !played.transition;
            played.transition = true;
            enterStage('transition');
          } else if (input.transitionEnd && stage === 'transition') {
            stage = 'fight';
            k = 0;
          }
          break;
        }
        case 'defeat':
          if (k >= (withLines ? RUN.defeatBannerFirst : RUN.defeatBannerLater) && (input.enter || input.retry)) {
            if (onRoad) {
              onRoad = false;
              enterStage('canyon');
              out.push({ type: 'to-road' });
            } else {
              attempt += 1;
              freshFight();
              out.push({ type: 'reset', reason: 'retry' });
            }
          }
          break;
        case 'victory':
          if (k >= RUN.victoryResult) {
            stage = 'result';
            out.push({ type: 'result' });
          }
          break;
        case 'result':
          if (input.roam) {
            enterStage('roam');
            out.push({ type: 'roam' });
            break;
          }
          if (input.enter || input.retry) {
            attempt += 1;
            freshFight();
            out.push({ type: 'reset', reason: 'retry' });
          }
          break;
      }
      return out;
    },
    /** The line on screen now, if any. */
    subtitle(): Line | undefined {
      if (stage === 'intro') return lineAt(LINES.intro, k);
      if (stage === 'transition' && withLines) return lineAt(LINES.transition, k);
      if (stage === 'defeat' && withLines) return lineAt(LINES.defeat, k);
      if (stage === 'victory') return lineAt(LINES.victory, k);
      return undefined;
    },
    /** Player input drives Nezha (fight and phase change only). */
    controls(): boolean {
      return stage === 'fight' || stage === 'transition';
    },
    defeatBanner(): boolean {
      return stage === 'defeat' && k >= (withLines ? RUN.defeatBannerFirst : RUN.defeatBannerLater);
    },
    /** Combat HUD (bars, items): hidden in the intro, the defeat and the victory. */
    hudVisible(): boolean {
      return stage === 'fight' || stage === 'transition' || stage === 'roam';
    },
    /** Intro skip prompt: only while a skip would do something. */
    skipHint(): boolean {
      return stage === 'intro' && (introSkippable ? k < RUN.introEnd : k < RUN.introSkipTo);
    },
    snapshot() {
      return {
        stage,
        k,
        timer,
        seconds: timerSeconds(timer),
        hits,
        perfects,
        attempt,
        deaths,
        played: { ...played },
        withLines,
        introSkippable,
        result,
        records,
      };
    },
  };
}

export type Run = ReturnType<typeof createRun>;
