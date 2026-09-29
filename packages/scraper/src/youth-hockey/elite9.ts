import { localToIso, parseClock, parseDateOnly, type YouthBirthYear, type YouthTeam } from "@openice/shared";
import { flattenSchedule, flattenStandings, gameDateKey, isHomeGame, opponentDisplayName, rangersPostWithCookie, scheduleBody, standingsBody, widgetSessionCookie, widgetToken, RANGERS_SEASON, RANGERS_SCHEDULE_URL, RANGERS_STANDINGS_URL, type VaGameRow, type VaTeamRow, type VaScheduleResponse, type VaStandingsResponse } from "../elite9.js";
import type { RawYouthGame } from "./core.js";

export function elite9Team(row: VaTeamRow, year: YouthBirthYear): YouthTeam {
  const name = row.TeamName ?? row.Team ?? row.Team3 ?? "";
  return { id: `e9:${row.TeamID}`, name, division: row.DivisionName ?? "", eligible: Boolean(name && /\belite\b/i.test(name) && new RegExp(`\\b${year}\\b`).test(row.DivisionName ?? "")), evidenceUrl: RANGERS_STANDINGS_URL };
}

export function parseElite9Games(rows: VaGameRow[], standings: VaTeamRow[]): RawYouthGame[] {
  const teams = new Map(standings.map((t) => [String(t.TeamID), t]));
  const games: RawYouthGame[] = [];
  for (const r of rows) {
    const year = Number((r.DivisionName ?? "").match(/\b(2015|2016)\b/)?.[1]) as YouthBirthYear;
    if (![2015, 2016].includes(year) || !/^upcoming$|^scheduled$/i.test(r.GameStatus ?? "")) continue;
    const date = parseDateOnly(gameDateKey(r));
    const time = parseClock(r.StartTime ?? "");
    const usRow = teams.get(String(r.CurrTeamID));
    if (!date || !time || !usRow || !r.LocationName) continue;
    const us = elite9Team(usRow, year);
    const other = teams.get(String(r.OpponentTeamID));
    const them: YouthTeam = other ? elite9Team(other, year) : { id: `e9:${r.OpponentTeamID ?? opponentDisplayName(r.OpponentName3 ?? "")}`, name: opponentDisplayName(r.OpponentName3 ?? ""), division: "Unverified", eligible: false };
    if (!them.name || !(us.eligible || them.eligible)) continue;
    const home = isHomeGame(r.OpponentName3 ?? "") ? us : them;
    const away = home === us ? them : us;
    games.push({ birthYear: year, division: r.DivisionName!, home, away, start: localToIso({ ...date, ...time }), location: r.LocationName, sourceUrl: RANGERS_SCHEDULE_URL });
  }
  return games;
}

export async function collectElite9(now: Date): Promise<RawYouthGame[]> {
  const expectedSeason = now.getUTCFullYear() + (now.getUTCMonth() >= 7 ? 1 : 0);
  if (Number(RANGERS_SEASON) !== expectedSeason) throw new Error("Elite 9 season configuration needs updating.");
  const post = rangersPostWithCookie(await widgetSessionCookie(() => {}));
  const standings = await post<VaStandingsResponse>("/standings/get", standingsBody());
  if (standings.result !== "success") throw new Error("Elite 9 standings are unavailable.");
  const token = await widgetToken(post, () => {});
  const response = await post<VaScheduleResponse>("/schedules/get", scheduleBody("", token));
  if (response.result !== "success") throw new Error("Elite 9 schedules are unavailable.");
  const rows = flattenSchedule(response.Games);
  const teams = flattenStandings(standings.Teams);
  if (!teams.some((t) => /2015/.test(t.DivisionName ?? "")) || !teams.some((t) => /2016/.test(t.DivisionName ?? ""))) throw new Error("Elite 9 birth-year divisions are missing.");
  // A hidden future board is not a successful empty schedule during the season.
  if (!rows.some((r) => /^upcoming$|^scheduled$/i.test(r.GameStatus ?? "")) && now.getUTCMonth() >= 8) throw new Error("Elite 9 did not return its future schedule.");
  return parseElite9Games(rows, teams);
}
