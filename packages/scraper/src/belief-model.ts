/**
 * Scout-card win model, chosen by the walk-forward backtest in `backtest/` (run `npm run backtest:belief`).
 *
 * A ridge-regularized Massey rating on goal margin capped at 8 gives each team an opponent-adjusted goals-per-game
 * rating plus a home-ice term. The predicted margin maps to P(home points share) through a logistic calibration fit
 * on last season's Elite 9 2013–2016 games. It beat 140 alternatives, including head-to-head, streak, form, rest,
 * Elo, Bradley–Terry and Poisson models, and none of them improved it when stacked on top.
 */
import { History, type BtGame } from "./backtest/games.js";
import { sigmoid } from "./backtest/linalg.js";
import { masseyRatings } from "./backtest/ratings.js";

export const BELIEF_MODEL = {
  metric: "massey:cap8:l1",
  cap: 8,
  lambda: 1,
  /** From `finalCalibration` in backtest/cli.ts; the test suite refits and checks these. */
  intercept: -0.0131,
  slope: 0.5225,
  /** Last season's fitted home-ice edge in goals (`analysis.json` homeRatingEdge), used as a prior early on. */
  homeEdge: 0.2,
  homeEdgeWeight: 20,
  trainedOn: "Elite 9 2025–26, 2013–2016 birth years",
} as const;

export interface MatchupPrediction {
  /** Expected points share for the home side (ties count half). */
  pHome: number;
  expectedHomeMargin: number;
  /** Opponent-adjusted goals per game versus an average team. */
  homeRating: number;
  awayRating: number;
  hfa: number;
  homeGames: number;
  awayGames: number;
}

export interface BeliefModel {
  predict(homeId: string, awayId: string): MatchupPrediction;
}

/** Fit ratings on completed games dated before `date`. */
export function fitBeliefModel(games: BtGame[], date: string): BeliefModel {
  const history = new History(games.filter((g) => g.date < date).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)));
  const m = masseyRatings(history, date, {
    cap: BELIEF_MODEL.cap,
    lambda: BELIEF_MODEL.lambda,
    target: "margin",
    hfaPrior: { value: BELIEF_MODEL.homeEdge, weight: BELIEF_MODEL.homeEdgeWeight },
  });
  return {
    predict(homeId, awayId) {
      const homeRating = m.rating(homeId);
      const awayRating = m.rating(awayId);
      const expectedHomeMargin = homeRating - awayRating + m.hfa;
      return {
        pHome: sigmoid(BELIEF_MODEL.intercept + BELIEF_MODEL.slope * expectedHomeMargin),
        expectedHomeMargin,
        homeRating,
        awayRating,
        hfa: m.hfa,
        homeGames: history.team(homeId).length,
        awayGames: history.team(awayId).length,
      };
    },
  };
}
