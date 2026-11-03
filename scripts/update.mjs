// Mise à jour : matchs joués des compétitions suivies où une Française est dans l'effectif,
// box score reconstitué à partir du play-by-play (scripts/lib/boxscore.mjs).
//
// node scripts/update.mjs            tous les matchs joués de la saison (pages en cache 30 jours une fois validées)
//
// Contrôle : la somme des points de chaque équipe doit égaler le score officiel, sinon le match n'est
// pas publié et il est listé dans data/missing-games.md.
// Une Française de nationalité FIBA « FRA » qui n'est pas encore dans data/players.json y est ajoutée.
import fs from 'node:fs';
import { boxscore } from './lib/boxscore.mjs';
import { competitionGames, gamePage, valueAfter } from './lib/fiba.mjs';
import { findVideos, similarity } from './lib/youtube.mjs';
import { fetchText } from './lib/http.mjs';

const comps = JSON.parse(fs.readFileSync('config/competitions.json', 'utf8')).competitions;
const players = JSON.parse(fs.readFileSync('data/players.json', 'utf8'));
const byPerson = new Map(players.map((p) => [String(p.fiba_person_id), p]));
const GAMES = 'data/games.json';
const prev = fs.existsSync(GAMES) ? JSON.parse(fs.readFileSync(GAMES, 'utf8')).games : [];
const games = new Map(prev.map((g) => [g.id, g]));

const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const title = (s) => (s ?? '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase());
const parisDate = (utc) => new Date(`${utc}Z`).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

const missing = [];
const added = [];
let processed = 0;

for (const c of comps) {
  const all = await competitionGames(c.slug);
  for (const g of all.filter((x) => x.gameResultStatusCode === 'VALID' && x.teamA && x.teamB)) {
    const id = `${c.code}-${g.gameId}`;
    // déjà traité et validé : la feuille ne change plus
    if (games.get(id)?.final) continue;

    let page;
    try {
      page = await gamePage(c.slug, g);
    } catch (e) {
      missing.push(`- ${c.name}, ${g.teamA.officialName} – ${g.teamB.officialName} (${parisDate(g.gameDateTimeUTC)}) : page illisible (${e.message})`);
      continue;
    }
    const t = page.text;
    const rosters = [
      { side: 'home', team: g.teamA, roster: page.rosterA, sheet: valueAfter(t, 'playersTeamA') ?? [] },
      { side: 'away', team: g.teamB, roster: page.rosterB, sheet: valueAfter(t, 'playersTeamB') ?? [] },
    ];

    // nouvelles Françaises (arrivées en cours de saison)
    for (const r of rosters)
      for (const p of r.roster?.players ?? []) {
        if (p.nationality !== 'FRA' || byPerson.has(String(p.personId))) continue;
        const np = {
          id: slugify(`${p.firstName} ${p.lastName}`), fiba_person_id: p.personId,
          name: `${title(p.firstName)} ${title(p.lastName)}`.trim(), dob: p.dateOfBirth?.slice(0, 10) ?? '',
          competitions: [c.code], clubs: [r.roster.name], games_on_sheet: 0, position: p.position ?? '',
          height_cm: p.heightInCm ?? null, number: p.uniformNumber ?? '', club: r.roster.name,
          club_country: p.clubCountryFIBACode ?? '', active: true, note: 'ajoutée automatiquement',
        };
        if (players.some((x) => x.id === np.id)) np.id += `-${np.dob.slice(0, 4)}`;
        players.push(np);
        byPerson.set(String(p.personId), np);
        added.push(`${np.name} (${np.club})`);
      }

    const french = rosters.flatMap((r) => (r.roster?.players ?? []).filter((p) => byPerson.has(String(p.personId))).map((p) => ({ ...r, p })));
    if (!french.length) continue;

    const label = `${c.name}, ${g.teamA.officialName} ${g.teamAScore}-${g.teamBScore} ${g.teamB.officialName} (${parisDate(g.gameDateTimeUTC)})`;
    const at = t.indexOf('"playByPlay":{"items"');
    const pbp = at >= 0 ? valueAfter(t, 'playByPlay', at) : null;
    if (!pbp) {
      missing.push(`- ${label} : play-by-play absent de la page. ${page.url}`);
      continue;
    }
    const orgA = String(g.teamA.organisationId);
    const orgB = String(g.teamB.organisationId);
    const box = boxscore(pbp, { [orgA]: rosters[0].sheet, [orgB]: rosters[1].sheet });
    if (box.totals[orgA] !== g.teamAScore || box.totals[orgB] !== g.teamBScore) {
      missing.push(`- ${label} : points reconstitués ${box.totals[orgA]}-${box.totals[orgB]}, différents du score : match non publié. ${page.url}`);
      continue;
    }

    const lines = {};
    for (const { side, team, sheet, p, roster } of french) {
      const pl = byPerson.get(String(p.personId));
      const onSheet = sheet.some((s) => String(s.personId) === String(p.personId));
      const b = box.players.get(String(p.personId));
      const played = onSheet && b?.played;
      const { sec, ...stats } = b?.stats ?? {};
      lines[pl.id] = {
        player_id: pl.id,
        team: roster.name,
        side,
        jersey: p.uniformNumber ?? '',
        status: played ? 'played' : onSheet ? 'dnp' : 'absent',
        starter: !!(played && b.starter),
        stats: played ? { ...stats, sec } : null,
        source: 'fiba',
      };
    }
    games.set(id, {
      id,
      final: g.gamePlayByPlayStatusCode === 'VALID' && g.gameStatisticStatusCode === 'VALID',
      competition: c.code,
      round: g.round?.roundName ?? '',
      group: g.groupPairingCode ?? '',
      date: parisDate(g.gameDateTimeUTC),
      tipoff_utc: `${g.gameDateTimeUTC}Z`,
      venue: [g.venueName, g.hostCity].filter(Boolean).join(', '),
      // short : nom d'usage du club (celui de l'effectif, avec le sponsor : « BLMA », « Galatasaray Cagdas Faktoring »)
      home: { name: g.teamA.officialName, short: page.rosterA?.name ?? g.teamA.shortName, code: g.teamA.code, score: g.teamAScore },
      away: { name: g.teamB.officialName, short: page.rosterB?.name ?? g.teamB.shortName, code: g.teamB.code, score: g.teamBScore },
      links: { game: page.url, boxscore: `${page.url}#boxscore`, pbp: `${page.url}#playByPlay` },
      lines,
      ...(games.get(id)?.youtube ? { youtube: games.get(id).youtube } : {}),
      ...(games.get(id)?.highlights ? { highlights: games.get(id).highlights } : {}),
      ...(games.get(id)?.videos_checked ? { videos_checked: games.get(id).videos_checked } : {}),
    });
    processed++;
  }
}

// ---------- vidéos officielles ----------
// Match complet (direct rediffusé) et résumé, cherchés pendant 14 jours après le match
// (et une fois pour un match plus ancien jamais cherché, ex. au premier lancement).
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const daysSince = (d) => (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 86400000;
let videosFound = 0;
const taken = new Set([...games.values()].flatMap((g) => [g.youtube?.url, g.highlights?.url]).filter(Boolean));
for (const g of games.values()) {
  if (g.youtube?.url && g.highlights?.url) continue;
  if (daysSince(g.date) > 14 && g.videos_checked) continue;
  const c = comps.find((x) => x.code === g.competition);
  try {
    const v = await findVideos(g, c.name, c.youtube_channels ?? [], today, taken);
    g.videos_checked = today;
    if (v.full && !g.youtube?.url) { g.youtube = { ...v.full, kind: 'full' }; taken.add(v.full.url); videosFound++; }
    if (v.highlights && !g.highlights?.url) { g.highlights = v.highlights; taken.add(v.highlights.url); videosFound++; }
  } catch (e) {
    missing.push(`- Recherche des vidéos (${g.id}) : ${e.message}`);
  }
}

// ---------- fiche de chaque joueuse sur fiba.basketball, par compétition ----------
// Adresse : /en/events/<compétition>/teams/<club>/<n° FIBA>-<prénom-nom>. Le club est pris dans la liste
// des clubs de la compétition (page /teams) ; chaque lien est vérifié une fois (titre de la page = la joueuse).
const teamSlugs = {};
for (const c of comps) {
  try {
    const html = await fetchText(`https://www.fiba.basketball/en/events/${c.slug}/teams`, { ttl: 7 * 86400 });
    teamSlugs[c.code] = [...new Set(html.match(new RegExp(`/en/events/${c.slug}/teams/[a-z0-9-]+(?=["\\\\/])`, 'g')) ?? [])]
      .map((u) => u.split('/').pop());
  } catch (e) {
    missing.push(`- Liste des clubs ${c.name} illisible : ${e.message}`);
  }
}
const lastTeam = {}; // joueuse -> compétition -> club (dernier match)
for (const g of [...games.values()].sort((a, b) => a.tipoff_utc.localeCompare(b.tipoff_utc)))
  for (const l of Object.values(g.lines)) (lastTeam[l.player_id] ??= {})[g.competition] = l.team;
const pageErrors = [];
for (const p of players) {
  p.fiba_pages ??= {};
  for (const [code, team] of Object.entries(lastTeam[p.id] ?? {})) {
    const c = comps.find((x) => x.code === code);
    const slugs = teamSlugs[code] ?? [];
    const teamSlug = slugs.includes(slugify(team)) ? slugify(team)
      : slugs.map((s) => [s, similarity(s.replace(/-/g, ' '), team)]).sort((a, b) => b[1] - a[1]).find(([, v]) => v >= 0.5)?.[0];
    if (!teamSlug) { pageErrors.push(`${p.name} (${team}, ${c.name}) : club introuvable dans la liste FIBA`); continue; }
    const url = `https://www.fiba.basketball/en/events/${c.slug}/teams/${teamSlug}/${p.fiba_person_id}-${slugify(p.name)}`;
    if (p.fiba_pages[code] === url) continue;
    try {
      const title = /<title>([^<]*)/.exec(await fetchText(url, { ttl: 30 * 86400 }))?.[1] ?? '';
      const last = p.name.split(' ').slice(1).join(' ');
      if (/not found/i.test(title) || similarity(title, last) < 0.5) throw new Error(`titre « ${title} »`);
      p.fiba_pages[code] = url;
    } catch (e) {
      pageErrors.push(`${p.name} (${c.name}) : ${url} → ${e.message}`);
    }
  }
}
if (pageErrors.length) missing.push(`- Fiches FIBA non trouvées :\n${pageErrors.map((x) => `  - ${x}`).join('\n')}`);

const list = [...games.values()].sort((a, b) => a.tipoff_utc.localeCompare(b.tipoff_utc));
fs.writeFileSync(GAMES, JSON.stringify({ updated: new Date().toISOString(), season: '2026-27', games: list }, null, 1) + '\n');
fs.writeFileSync('data/players.json', JSON.stringify(players, null, 1) + '\n');
fs.writeFileSync('data/missing-games.md', `# Matchs non publiés\n\nMatchs joués avec une Française dans l'effectif, mais sans box score fiable.\n\n${missing.length ? missing.join('\n') : 'Aucun.'}\n`);
console.log(`matchs traités : ${processed} · vidéos trouvées : ${videosFound} · total games.json : ${list.length} · non publiés : ${missing.length} · nouvelles Françaises : ${added.length}${added.length ? ` (${added.join(', ')})` : ''}`);
