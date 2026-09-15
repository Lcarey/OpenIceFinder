/** 2016 birth-year Elite 9 White maps to 10U on MyHockeyRankings in 2026–27. */
export const RANGERS_MHR_YEAR = 2026;

export interface RangersMhrTeam {
  id: number;
  club: RegExp;
}

/** Elite 9 2016 White clubs → MHR 10U team ids. */
export const RANGERS_MHR_TEAMS: readonly RangersMhrTeam[] = [
  { id: 1116, club: /rangers/i },
  { id: 32702, club: /winter\s*club/i },
  { id: 1336, club: /avalanche/i },
  { id: 1471, club: /bruins/i },
  { id: 6474, club: /icemen/i },
  { id: 23032, club: /railers/i },
];

export function rangersMhrUrl(id: number, year = RANGERS_MHR_YEAR): string {
  return `https://myhockeyrankings.com/team-info/${id}/${year}`;
}

export function matchRangersMhrTeam(name: string): RangersMhrTeam | undefined {
  const n = name.trim();
  if (!n) return undefined;
  return RANGERS_MHR_TEAMS.find((team) => team.club.test(n));
}

export function formatMhrRank(rank?: number): string {
  return rank && rank > 0 ? String(rank) : "—";
}
