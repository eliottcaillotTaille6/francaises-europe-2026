// Liste des Françaises (nationalité FIBA « FRA ») des compétitions suivies, d'après les effectifs
// publiés sur fiba.basketball. Lit la page de chaque match déjà joué (effectifs + feuille de match)
// et, pour une équipe qui n'a pas encore joué, la page d'un de ses prochains matchs.
//
// Écrit data/players.json (les champs `active`, `note` et `aliases` déjà présents sont conservés)
// et data/players-report.md (liste par club, à valider).
import fs from 'node:fs';
import { competitionGames, gamePage, valueAfter } from './lib/fiba.mjs';

const comps = JSON.parse(fs.readFileSync('config/competitions.json', 'utf8')).competitions;
const old = fs.existsSync('data/players.json') ? JSON.parse(fs.readFileSync('data/players.json', 'utf8')) : [];
const oldById = new Map(old.map((p) => [p.fiba_person_id, p]));

const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const title = (s) => (s ?? '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase());

const players = new Map(); // personId -> joueuse
const errors = [];

for (const c of comps) {
  const games = await competitionGames(c.slug);
  const played = games.filter((g) => g.gameResultStatusCode === 'VALID');
  const teamsSeen = new Set(played.flatMap((g) => [g.teamA?.teamId, g.teamB?.teamId]));
  // équipes sans match joué : un match à venir dont les deux équipes sont connues
  const extra = [];
  for (const g of games.filter((x) => x.teamA && x.teamB).sort((a, b) => a.gameDateTimeUTC.localeCompare(b.gameDateTimeUTC))) {
    if (!teamsSeen.has(g.teamA.teamId) || !teamsSeen.has(g.teamB.teamId)) {
      extra.push(g);
      teamsSeen.add(g.teamA.teamId);
      teamsSeen.add(g.teamB.teamId);
    }
  }
  console.log(`${c.name} : ${played.length} matchs joués + ${extra.length} pages pour les équipes sans match joué`);

  for (const g of [...played, ...extra].sort((a, b) => a.gameDateTimeUTC.localeCompare(b.gameDateTimeUTC))) {
    let page;
    try {
      page = await gamePage(c.slug, g);
    } catch (e) {
      errors.push(`${c.code} ${g.gameId} : ${e.message}`);
      continue;
    }
    const isPlayed = g.gameResultStatusCode === 'VALID';
    for (const roster of [page.rosterA, page.rosterB]) {
      for (const r of roster?.players ?? []) {
        if (r.nationality !== 'FRA') continue;
        const p = players.get(r.personId) ?? {
          fiba_person_id: r.personId,
          name: `${title(r.firstName)} ${title(r.lastName)}`.trim(),
          dob: r.dateOfBirth?.slice(0, 10) ?? '',
          competitions: [],
          clubs: [],
          club_orgs: {}, // organisation FIBA du club -> dernier nom lu (un club peut changer de nom d'une compétition à l'autre)
          games_on_sheet: 0,
        };
        // le dernier match lu donne le club et le numéro actuels
        Object.assign(p, {
          position: r.position ?? '',
          height_cm: r.heightInCm ?? null,
          number: r.uniformNumber ?? '',
          club: roster.name,
          club_country: r.clubCountryFIBACode ?? '',
        });
        if (!p.competitions.includes(c.code)) p.competitions.push(c.code);
        p.club_orgs[roster.teamOrganisationId] = roster.name;
        p.clubs = Object.values(p.club_orgs);
        players.set(r.personId, p);
      }
    }
    // feuille de match : joueuses inscrites sur ce match
    if (isPlayed) {
      for (const key of ['playersTeamA', 'playersTeamB']) {
        const sheet = valueAfter(page.text, key) ?? [];
        for (const s of sheet) if (players.has(s.personId)) players.get(s.personId).games_on_sheet++;
      }
    }
  }
}

const list = [...players.values()]
  .map((p) => {
    const prev = oldById.get(p.fiba_person_id);
    const { club_orgs, ...rest } = p;
    return {
      id: prev?.id ?? slugify(p.name),
      ...rest,
      // le club actuel en premier, avec le nom lu en dernier
      clubs: [p.club, ...Object.values(club_orgs).filter((n) => n !== p.club)],
      club_org: Number(Object.keys(club_orgs).find((k) => club_orgs[k] === p.club)),
      active: prev?.active ?? true,
      note: prev?.note ?? '',
      ...(prev?.aliases ? { aliases: prev.aliases } : {}),
    };
  })
  .sort((a, b) => a.club.localeCompare(b.club) || a.name.localeCompare(b.name));

// identifiants uniques (deux homonymes : on ajoute l'année de naissance)
const seen = new Map();
for (const p of list) seen.set(p.id, (seen.get(p.id) ?? 0) + 1);
for (const p of list) if (seen.get(p.id) > 1 && !oldById.has(p.fiba_person_id)) p.id = `${p.id}-${p.dob.slice(0, 4)}`;

fs.writeFileSync('data/players.json', JSON.stringify(list, null, 1) + '\n');

// ---------- rapport ----------
const age = (dob) => (dob ? Math.floor((Date.now() - Date.parse(dob)) / (365.25 * 86400000)) : '');
const byClub = new Map();
for (const p of list) byClub.set(p.club, [...(byClub.get(p.club) ?? []), p]);
let md = `# Françaises en ${comps.map((c) => c.name).join(' et ')} (${new Date().toISOString().slice(0, 10)})\n\n`;
md += `${list.length} joueuses de nationalité FIBA « FRA », dans ${byClub.size} clubs. Source : effectifs des pages de match de fiba.basketball.\n\n`;
md += `« Feuilles » = nombre de matchs joués par son équipe où elle était inscrite sur la feuille de match.\n\n`;
for (const [club, ps] of [...byClub].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
  md += `## ${club} (${ps[0].club_country}, ${ps[0].competitions.join(' + ')}) — ${ps.length}\n\n| Joueuse | N° | Poste | Taille | Âge | Feuilles | Autre club cette saison |\n|---|---|---|---|---|---|---|\n`;
  for (const p of ps)
    md += `| ${p.name} | ${p.number} | ${p.position} | ${p.height_cm ? `${p.height_cm} cm` : ''} | ${age(p.dob)} | ${p.games_on_sheet} | ${p.clubs.filter((x) => x !== club).join(', ')} |\n`;
  md += '\n';
}
if (errors.length) md += `## Erreurs\n\n${errors.map((e) => `- ${e}`).join('\n')}\n`;
fs.writeFileSync('data/players-report.md', md);
console.log(`${list.length} Françaises dans ${byClub.size} clubs · erreurs : ${errors.length}`);
