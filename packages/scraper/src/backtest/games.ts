/** Shared game record for the belief backtest and the shipped model. */
export interface BtGame {
  /** Stable id: date|start|homeId|awayId. */
  id: string;
  /** YYYY-MM-DD, America/New_York. */
  date: string;
  /** 24h HH:MM local start, "" when unknown. */
  time: string;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
  /** Division names, "" when the team is outside the snapshot. */
  homeDiv: string;
  awayDiv: string;
}

export interface BtSnapshot {
  season: string;
  seasonLabel: string;
  fetchedAt: string;
  source: string;
  divisions: string[];
  games: BtGame[];
}

export type GameResult = 1 | 0.5 | 0;

/** 1 home win, 0.5 tie, 0 away win. */
export function homeResult(game: Pick<BtGame, "homeGoals" | "awayGoals">): GameResult {
  if (game.homeGoals > game.awayGoals) return 1;
  if (game.homeGoals < game.awayGoals) return 0;
  return 0.5;
}

export function birthYear(division: string): string {
  return division.match(/\b(20\d\d)\b/)?.[1] ?? "";
}

export function divisionTier(division: string): string {
  return division.match(/\b(Red|White|Blue|Green|Black|Gold|Silver)\b/i)?.[1]?.toLowerCase() ?? "";
}

/** One game from a single team's point of view. */
export interface TeamGame {
  date: string;
  oppId: string;
  home: boolean;
  gf: number;
  ga: number;
  result: GameResult;
}

const NO_GAMES: readonly TeamGame[] = Object.freeze([]);

/** Append-only history of completed games. Metrics read it; only the harness adds to it. */
export class History {
  readonly games: BtGame[] = [];
  readonly teams = new Map<string, TeamGame[]>();

  constructor(games: Iterable<BtGame> = []) {
    for (const g of games) this.add(g);
  }

  add(game: BtGame): void {
    this.games.push(game);
    const r = homeResult(game);
    this.push(game.homeId, { date: game.date, oppId: game.awayId, home: true, gf: game.homeGoals, ga: game.awayGoals, result: r });
    this.push(game.awayId, { date: game.date, oppId: game.homeId, home: false, gf: game.awayGoals, ga: game.homeGoals, result: (1 - r) as GameResult });
  }

  team(id: string): readonly TeamGame[] {
    return this.teams.get(id) ?? NO_GAMES;
  }

  private push(id: string, g: TeamGame): void {
    const list = this.teams.get(id);
    if (list) list.push(g);
    else this.teams.set(id, [g]);
  }
}

export function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}
