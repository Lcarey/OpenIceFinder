/**
 * The hand-tuned scout-card score that shipped before the backtest (commit b79f9b5), kept verbatim as a baseline.
 * Returns the 6–90 "our chance" score for `us`.
 */
import type { RangersPlayedGame, RangersRecord } from "@openice/shared";

export interface LegacyBeliefInput {
  us: RangersRecord;
  them: RangersRecord;
  lostTo: RangersPlayedGame[];
  prior?: RangersPlayedGame;
  isHome: boolean;
}

export function legacyBeliefScore(input: LegacyBeliefInput): number {
  let score = 42;
  if (input.lostTo.length > 0) {
    score += 16;
    if (input.lostTo.some((g) => g.result === "L" && Math.abs(g.ourScore - g.theirScore) === 1)) score += 10;
  } else if (input.them.gp > 0) {
    score -= 6;
  }
  if (input.prior?.result === "L") {
    score -= 18;
    if (input.prior.theirScore - input.prior.ourScore >= 5) score -= 10;
  } else if (input.prior?.result === "W") {
    score += 12;
  }
  score += input.isHome ? 7 : -5;
  if (input.us.gf === 0 && input.us.gp > 0) score -= 4;
  if (input.us.wins > 0) score += 8;
  score += Math.round((input.us.wins / Math.max(input.us.gp, 1) - input.them.wins / Math.max(input.them.gp, 1)) * 8);
  return Math.max(6, Math.min(90, score));
}
