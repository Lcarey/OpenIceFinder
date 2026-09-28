/**
 * Scout-card win model, chosen by the walk-forward backtest in `backtest/` (run `npm run backtest:belief`).
 *
 * A ridge-regularized Massey rating on goal margin capped at 8 gives each team an opponent-adjusted goals-per-game
 * rating plus a home-ice term. Before a team has results, its rating starts from a quarter-weight blend of last
 * season's Elite 9 and MyHockeyRankings ratings. The predicted margin maps to expected points through a logistic
 * calibration, and to win / tie / loss through an ordered logit, both fit on last season's Elite 9 2013–2016 games.
 * It beat 212 alternatives, including head-to-head, streak, form, rest, Elo, Bradley–Terry, Poisson, Kalman-filter
 * drift and gradient-boosted models, and nothing stacked on top of it improved it.
 */
import { History, type BtGame } from "./backtest/games.js";
import { orderedProbs, sigmoid } from "./backtest/linalg.js";
import { priorValue, priorsFromSources, type TeamIdentity, type TeamPrior } from "./backtest/priors.js";
import { masseyRatings } from "./backtest/ratings.js";
import { PRIOR_SOURCES, SHIPPED_MODEL } from "./belief-model.generated.js";

export const BELIEF_MODEL = {
  ...SHIPPED_MODEL,
  intercept: SHIPPED_MODEL.calibration.intercept,
  slope: SHIPPED_MODEL.calibration.slope,
  /** Last season's fitted home-ice edge in goals, used as a prior so a few early games cannot inflate it. */
  homeEdge: 0.2,
  homeEdgeWeight: 20,
  priorSeason: PRIOR_SOURCES.season,
} as const;

export interface MatchupPrediction {
  /** Expected points share for the home side (ties count half). */
  pHome: number;
  /** Three-way odds for the home side. */
  outcome: { win: number; tie: number; loss: number };
  expectedHomeMargin: number;
  /** Opponent-adjusted goals per game versus an average division team. */
  homeRating: number;
  awayRating: number;
  hfa: number;
  homeGames: number;
  awayGames: number;
  /** Last season's rating in goals per game, centered in the division (undefined when unknown). */
  homePrior?: number;
  awayPrior?: number;
}

export interface BeliefModel {
  predict(homeId: string, awayId: string): MatchupPrediction;
}

/** Fit ratings on completed games dated before `date`. `teams` (every team this season) enables pre-season priors. */
export function fitBeliefModel(games: BtGame[], date: string, teams?: Map<string, TeamIdentity>): BeliefModel {
  const history = new History(games.filter((g) => g.date < date).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)));
  const priors: Map<string, TeamPrior> = teams ? priorsFromSources(teams, PRIOR_SOURCES) : new Map();
  const raw = (id: string) => priorValue(priors.get(id), "blend", 1);
  const m = masseyRatings(history, date, {
    cap: BELIEF_MODEL.cap,
    lambda: BELIEF_MODEL.lambda,
    target: "margin",
    hfaPrior: { value: BELIEF_MODEL.homeEdge, weight: BELIEF_MODEL.homeEdgeWeight },
    priorMean: (id) => BELIEF_MODEL.rho * (raw(id) ?? 0),
  });
  return {
    predict(homeId, awayId) {
      const homeRating = m.rating(homeId);
      const awayRating = m.rating(awayId);
      const expectedHomeMargin = homeRating - awayRating + m.hfa;
      const o = orderedProbs(BELIEF_MODEL.ordered, expectedHomeMargin);
      return {
        pHome: sigmoid(BELIEF_MODEL.intercept + BELIEF_MODEL.slope * expectedHomeMargin),
        outcome: { win: o.home, tie: o.tie, loss: o.away },
        expectedHomeMargin,
        homeRating,
        awayRating,
        hfa: m.hfa,
        homeGames: history.team(homeId).length,
        awayGames: history.team(awayId).length,
        homePrior: raw(homeId),
        awayPrior: raw(awayId),
      };
    },
  };
}
