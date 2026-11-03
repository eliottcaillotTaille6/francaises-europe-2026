// Les Françaises en Coupe d'Europe — site statique, sans framework.
// Données : data/games.json, data/players.json, config/site.json, config/competitions.json.

const $main = document.getElementById('main');
const $tip = document.getElementById('tooltip');

const state = { players: [], byId: new Map(), games: [], comps: {}, config: {}, updated: null };

// ---------- utilitaires ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt1 = (n) => (Number.isFinite(n) ? n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '–');
const pct = (m, a) => (a ? `${((100 * m) / a).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : '–');
const noon = (ymd) => new Date(`${ymd}T12:00:00Z`);

const dateFR = (ymd, opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) =>
  noon(ymd).toLocaleDateString('fr-FR', { ...opts, timeZone: 'UTC' });
const dateShortFR = (ymd) => noon(ymd).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const timeParis = (utc) =>
  new Date(utc).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', ' h ');
const kickoff = (g) => (g.tipoff_utc ? `${timeParis(g.tipoff_utc)} (Paris)` : '');
const age = (dob) => (dob ? Math.floor((Date.now() - Date.parse(dob)) / (365.25 * 86400000)) : null);

// Postes FIBA en français
const POSTES = {
  'Point Guard': 'Meneuse', 'Shooting Guard': 'Arrière', Guard: 'Arrière', 'Small Forward': 'Ailière',
  Forward: 'Ailière', 'Power Forward': 'Ailière forte', Center: 'Pivot',
  PG: 'Meneuse', SG: 'Arrière', G: 'Arrière', SF: 'Ailière', F: 'Ailière', PF: 'Ailière forte', C: 'Pivot',
};
const poste = (p) => POSTES[p] ?? p ?? '';
const compName = (code) => state.comps[code]?.name ?? code;
const teamName = (t) => t.short || t.name; // nom d'usage du club (le nom officiel est souvent plus long)
const compBadge = (g) => `<span class="badge comp" title="${esc(compName(g.competition))}">${esc(g.competition === 'ELW' ? 'EuroLeague' : g.competition === 'ECW' ? 'EuroCup' : g.competition)}</span>`;

// Mode éditeur : activé une fois par appareil en ouvrant le site avec ?admin (désactivé avec ?admin=0).
const params = new URLSearchParams(location.search);
const ADMIN = (() => {
  try {
    if (params.has('admin')) params.get('admin') === '0' ? localStorage.removeItem('europe-admin') : localStorage.setItem('europe-admin', '1');
    return localStorage.getItem('europe-admin') === '1';
  } catch {
    return params.has('admin') && params.get('admin') !== '0';
  }
})();

// ---------- liens ----------
function youtubeLinks(g) {
  const yt = state.config.youtube ?? {};
  // Un seul bouton : le match complet trouvé par le pipeline, sinon le résumé, sinon la recherche sur la chaîne officielle.
  const v = g.youtube?.url ? g.youtube : g.highlights?.url ? g.highlights : null;
  if (v) return [{ label: yt.label ?? 'YouTube', url: v.url, title: v.title }];
  const query = `${g.home.short ?? g.home.name} v ${g.away.short ?? g.away.name}`;
  return [{ label: yt.label ?? 'YouTube', url: `${yt.search_url ?? 'https://www.youtube.com/results?search_query='}${encodeURIComponent(query)}`, title: 'Recherche sur la chaîne YouTube officielle' }];
}

// Bouton « Clipper » (mode éditeur) : ouvre l'outil de clipping local avec le match complet (jamais le
// résumé : l'analyse ne retrouve dans un résumé que les paniers montrés), la page FIBA du match
// (play-by-play), le nom et le numéro de la joueuse. Pas de match complet : pas de bouton.
function clipLink(g, l) {
  const clip = state.config.clipping;
  if (!ADMIN || !clip?.url || !l || l.status !== 'played') return null;
  if (!g.youtube?.url || g.youtube.kind !== 'full') return null;
  const q = new URLSearchParams({
    video: g.youtube.url,
    pbp: g.links.game,
    name: state.byId.get(l.player_id)?.name ?? '',
    number: l.jersey ?? '',
    team: l.side === 'home' ? '1' : '2', // page FIBA : équipe 1 = à domicile (première du lien)
    zones: 'fiba', // habillage TV identique sur tous les matchs : zones posées et analyse lancée par l'outil
    t: Date.now().toString(36), // adresse unique : Chrome ne ressert jamais une ancienne page de l'outil
  });
  return { label: clip.label ?? 'Clipper', url: `${clip.url}?${q}`, title: 'Match complet : ouvrir dans l\'outil de clipping (vidéo, play-by-play, joueuse et zones préremplis, analyse lancée)' };
}

function gameLinks(g, line) {
  const clip = clipLink(g, line);
  return [
    { label: 'Play-by-play', url: g.links.pbp, title: 'Play-by-play officiel (fiba.basketball, onglet « Play by play »)' },
    { label: 'Box score', url: g.links.boxscore, title: 'Box score officiel (fiba.basketball, onglet « Boxscore »)' },
    ...youtubeLinks(g),
    ...(clip ? [clip] : []),
  ];
}
const linkTag = (l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener"${l.title ? ` title="${esc(l.title)}"` : ''}>${esc(l.label)}</a>`;
const linksHTML = (g, line) => `<div class="links">${gameLinks(g, line).map(linkTag).join('')}</div>`;

// ---------- calculs ----------
function perspective(g, l) {
  const us = l.side === 'home' ? g.home : g.away;
  const them = us === g.home ? g.away : g.home;
  const where = us === g.home ? 'vs' : 'à';
  const res = us.score != null && them.score != null ? (us.score > them.score ? 'V' : us.score < them.score ? 'D' : 'N') : '';
  return { us, them, where, res };
}

// Ligne encadrée : points au moins égaux au seuil de la joueuse (config/site.json → highlight.players,
// sinon highlight.points), ou double-double / triple-double.
function pointsThreshold(playerId) {
  const h = state.config.highlight ?? {};
  return h.players?.[playerId] ?? h.points ?? 15;
}
function isBig(s, playerId) {
  if (!s) return { big: false, tags: [] };
  const tens = ['pts', 'reb', 'ast', 'stl', 'blk'].filter((k) => s[k] >= 10).length;
  const tags = [];
  if (s.pts >= pointsThreshold(playerId)) tags.push(`${s.pts} pts`);
  if (tens >= 3) tags.push('Triple-double');
  else if (tens === 2) tags.push('Double-double');
  return { big: tags.length > 0, tags };
}

// Toutes les lignes d'une joueuse, du plus ancien au plus récent.
function playerLog(id) {
  return state.games
    .filter((g) => g.lines?.[id])
    .map((g) => ({ g, l: g.lines[id] }))
    .sort((a, b) => a.g.tipoff_utc.localeCompare(b.g.tipoff_utc));
}

function averages(id, comp = '') {
  const played = playerLog(id).filter((x) => x.l.status === 'played' && x.l.stats && (!comp || x.g.competition === comp));
  const n = played.length;
  const sum = (k) => played.reduce((a, x) => a + (x.l.stats[k] ?? 0), 0);
  const avg = (k) => (n ? sum(k) / n : NaN);
  return {
    gp: n,
    gs: played.filter((x) => x.l.starter).length,
    min: avg('min'), pts: avg('pts'), reb: avg('reb'), oreb: avg('oreb'), dreb: avg('dreb'),
    ast: avg('ast'), stl: avg('stl'), blk: avg('blk'), to: avg('to'), pf: avg('pf'),
    fgm: sum('fgm'), fga: sum('fga'), tpm: sum('tpm'), tpa: sum('tpa'), ftm: sum('ftm'), fta: sum('fta'),
  };
}

// ---------- composants ----------
const statusText = (l) => (l.status === 'dnp' ? 'Sur la feuille de match, n\'a pas joué' : 'Absente de la feuille de match');

function statlineHTML(s) {
  const cell = (k, v, sub = '') => `<div><dt>${k}</dt><dd>${v}${sub ? ` <span>${sub}</span>` : ''}</dd></div>`;
  return `<dl class="statline">
    ${cell('MIN', Math.round(s.min))}
    ${cell('REB', s.reb, `${s.oreb}/${s.dreb}`)}
    ${cell('PD', s.ast)}
    ${cell('INT', s.stl)}
    ${cell('CTR', s.blk)}
    ${cell('BP', s.to)}
    ${cell('FTE', s.pf)}
    ${cell('TIRS', `${s.fgm}-${s.fga}`)}
    ${cell('3 PTS', `${s.tpm}-${s.tpa}`)}
    ${cell('LF', `${s.ftm}-${s.fta}`)}
  </dl>`;
}

function gameMeta(g, l) {
  const { them, where, res, us } = perspective(g, l);
  const score = us.score != null ? `<span class="${res === 'V' ? 'res-w' : 'res-l'}">${res} ${us.score}-${them.score}</span>` : '';
  return `<div class="game-meta">${where} ${esc(teamName(them))} · ${score}<br>${esc(dateFR(g.date))}${kickoff(g) ? ` · ${esc(kickoff(g))}` : ''}<br>${esc(compName(g.competition))} · ${esc(g.round)}</div>`;
}

function cardHTML(g, l) {
  const p = state.byId.get(l.player_id);
  const s = l.stats;
  const { big, tags } = isBig(s, l.player_id);
  return `<article class="card${big ? ' big' : ''}">
    <div class="card-head">
      <div>
        <h3><a href="#/joueuse/${esc(l.player_id)}">${esc(p?.name ?? l.player_id)}</a></h3>
        <div class="team">${esc(l.team)}</div>
      </div>
      <div class="pts">${s.pts}<small>PTS</small></div>
    </div>
    ${gameMeta(g, l)}
    ${statlineHTML(s)}
    <div class="badges">${tags.map((t) => `<span class="badge accent">${esc(t)}</span>`).join('')}${l.starter ? '<span class="badge">Titulaire</span>' : '<span class="badge">Remplaçante</span>'}${compBadge(g)}</div>
    ${linksHTML(g, l)}
  </article>`;
}

// ---------- pages ----------
const playedDays = () => [...new Set(state.games.filter((g) => Object.values(g.lines ?? {}).some((l) => l.status === 'played')).map((g) => g.date))].sort();

// Accueil : une semaine de matchs (une journée de coupe d'Europe s'étale du mardi au jeudi).
const addDays = (ymd, n) => new Date(noon(ymd).getTime() + n * 86400000).toISOString().slice(0, 10);

function pageHome(end) {
  const days = playedDays();
  const last = end ?? days.at(-1);
  if (!last) return `<h1>Derniers matchs</h1><p class="empty">Aucun match pour l'instant.</p>`;
  const start = addDays(last, -6);
  const games = state.games.filter((g) => g.date >= start && g.date <= last);
  const lines = games.flatMap((g) => Object.values(g.lines ?? {}).map((l) => ({ g, l })));
  const played = lines.filter((x) => x.l.status === 'played' && x.l.stats).sort((a, b) => b.l.stats.pts - a.l.stats.pts || b.l.stats.reb - a.l.stats.reb);
  const others = lines.filter((x) => x.l.status !== 'played');
  const prev = days.filter((d) => d < start).at(-1);
  const next = days.find((d) => d > last);
  const range = (a, b) => `du ${dateFR(a, { day: 'numeric', month: 'long' })} au ${dateFR(b, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  return `<h1>${end ? 'Matchs de la semaine' : 'Derniers matchs'}</h1>
    <p class="page-sub">${esc(range(start, last))} · ${played.length} ligne${played.length > 1 ? 's' : ''} de stats, ${games.length} match${games.length > 1 ? 's' : ''}</p>
    <div class="day-nav">
      ${prev ? `<a class="btn ghost" href="#/semaine/${prev}">← Semaine précédente</a>` : ''}
      ${next ? `<a class="btn ghost" href="#/semaine/${addDays(next, 6) > days.at(-1) ? days.at(-1) : addDays(next, 6)}">Semaine suivante →</a>` : ''}
      <a class="btn ghost" href="#/calendrier/${last}">Calendrier</a>
    </div>
    <div class="cards">${played.map(({ g, l }) => cardHTML(g, l)).join('') || '<p class="empty">Aucune Française n\'a joué cette semaine.</p>'}</div>
    ${others.length ? `<div class="absents"><h2>N'ont pas joué</h2><ul>${others.map(({ g, l }) => `<li><a href="#/joueuse/${esc(l.player_id)}">${esc(state.byId.get(l.player_id)?.name ?? l.player_id)}</a> (${esc(l.team)}, ${esc(dateShortFR(g.date))} ${perspective(g, l).where} ${esc(teamName(perspective(g, l).them))}) : ${statusText(l)}</li>`).join('')}</ul></div>` : ''}`;
}

function pagePlayer(id) {
  const p = state.byId.get(id);
  if (!p) return `<h1>Joueuse introuvable</h1><p><a href="#/tableau">Retour au tableau</a></p>`;
  const log = playerLog(id);
  const comps = [...new Set(log.map((x) => x.g.competition))];
  const bio = [
    ['Club', `${p.club}${p.club_country ? ` (${p.club_country})` : ''}`],
    ['Compétition', p.competitions.map(compName).join(', ')],
    ['Poste', poste(p.position)], ['Taille', p.height_cm ? `${p.height_cm} cm` : ''],
    ['Numéro', p.number], ['Naissance', p.dob ? `${dateFR(p.dob, { day: 'numeric', month: 'long', year: 'numeric' })} (${age(p.dob)} ans)` : ''],
    ['Autres clubs cette saison', p.clubs?.filter((c) => c !== p.club).join(', ')], ['Note', p.note === 'ajoutée automatiquement' ? '' : p.note],
  ].filter(([, v]) => v);
  const av = (k, v) => `<div class="avg"><div class="v">${v}</div><div class="k">${k}</div></div>`;
  const block = (a) => `<div class="averages">
      ${av('Matchs (tit.)', `${a.gp} (${a.gs})`)}${av('Points', fmt1(a.pts))}${av('Rebonds', fmt1(a.reb))}
      ${av('Passes', fmt1(a.ast))}${av('Minutes', fmt1(a.min))}${av('Tirs', pct(a.fgm, a.fga))}
      ${av('3 pts', pct(a.tpm, a.tpa))}${av('LF', pct(a.ftm, a.fta))}${av('Interceptions', fmt1(a.stl))}
      ${av('Contres', fmt1(a.blk))}${av('Balles perdues', fmt1(a.to))}${av('Fautes', fmt1(a.pf))}
    </div>`;
  return `<p><a href="#/tableau">← Tableau général</a></p>
    <h1>${esc(p.name)}</h1>
    <dl class="bio">${bio.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${comps.length > 1
      ? comps.map((c) => `<h2>Moyennes en ${esc(compName(c))}</h2>${block(averages(id, c))}`).join('')
      : `<h2>Moyennes de la saison${comps[0] ? ` (${esc(compName(comps[0]))})` : ''}</h2>${block(averages(id))}`}
    <h2>Points match par match</h2>
    ${log.length ? `<div class="chart-wrap">${pointsChart(log)}</div>` : '<p class="empty">Aucun match pour l\'instant.</p>'}
    <h2>Game log</h2>
    ${log.length ? gameLogTable(log) : '<p class="empty">Aucun match pour l\'instant.</p>'}`;
}

function pointsChart(log) {
  const W = Math.round(Math.min(900, Math.max(300, $main.clientWidth - 58))), H = 200, padL = 28, padB = 26, padT = 12;
  const max = Math.max(10, ...log.map((x) => x.l.stats?.pts ?? 0));
  const top = Math.ceil(max / 10) * 10;
  const n = log.length;
  const step = (W - padL - 8) / n;
  const bw = Math.min(28, step * 0.6);
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const ticks = [0, top / 2, top];
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Points marqués par match">`;
  for (const t of ticks) svg += `<line class="grid" x1="${padL}" x2="${W - 4}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${t.toLocaleString('fr-FR')}</text>`;
  log.forEach(({ g, l }, i) => {
    const x = padL + step * i + (step - bw) / 2;
    const v = l.status === 'played' ? l.stats.pts : 0;
    const { them, where } = perspective(g, l);
    const label = `${dateShortFR(g.date)} ${where} ${teamName(them)} : ${l.status === 'played' ? `${v} pts, ${l.stats.reb} reb, ${l.stats.ast} pd` : statusText(l)}`;
    const h = Math.max(0, y(0) - y(v));
    svg += `<rect class="bar-hit" x="${padL + step * i}" y="${padT}" width="${step}" height="${H - padT - padB}" data-tip="${esc(label)}"/>`;
    if (l.status === 'played' && h > 0) {
      const r = Math.min(4, bw / 2, h);
      svg += `<path class="bar" d="M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + bw - r} Q${x + bw},${y(v)} ${x + bw},${y(v) + r} V${y(0)} Z"/>`;
    } else {
      svg += `<rect class="zero" x="${x}" y="${y(0) - 2}" width="${bw}" height="2"/>`;
    }
    if (n <= 12 || i % Math.ceil(n / 12) === 0) svg += `<text class="axis" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(dateShortFR(g.date))}</text>`;
  });
  return svg + '</svg>';
}

function gameLogTable(log) {
  const rows = [...log].reverse().map(({ g, l }) => {
    const { them, where, res, us } = perspective(g, l);
    const s = l.stats;
    const { big } = isBig(s, l.player_id);
    const links = gameLinks(g, l).map(linkTag).join(' · ');
    const stats = s
      ? `<td>${l.starter ? 'oui' : ''}</td><td>${Math.round(s.min)}</td><td class="hl">${s.pts}</td><td>${s.reb} <span class="muted">(${s.oreb}/${s.dreb})</span></td><td>${s.ast}</td><td>${s.stl}</td><td>${s.blk}</td><td>${s.to}</td><td>${s.pf}</td><td>${s.fgm}-${s.fga}</td><td>${s.tpm}-${s.tpa}</td><td>${s.ftm}-${s.fta}</td>`
      : `<td colspan="12" class="l muted">${statusText(l)}</td>`;
    return `<tr class="${big ? 'big' : ''}"><td class="first-col">${esc(dateShortFR(g.date))}</td><td class="l">${compBadge(g)}</td><td class="l">${where} ${esc(teamName(them))}</td><td class="l">${us.score != null ? `${res} ${us.score}-${them.score}` : ''}</td>${stats}<td class="l">${links}</td></tr>`;
  });
  return `<div class="table-wrap"><table>
    <thead><tr><th class="first-col">Date</th><th class="l">Comp.</th><th class="l">Adversaire</th><th class="l">Score</th><th>Tit.</th><th>MIN</th><th>PTS</th><th>REB (O/D)</th><th>PD</th><th>INT</th><th>CTR</th><th>BP</th><th>FTE</th><th>TIRS</th><th>3 PTS</th><th>LF</th><th class="l">Liens</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>`;
}

// ---------- tableau général ----------
const tableState = { sort: 'pts', dir: -1, comp: '', club: '', country: '', pos: '' };
const COLS = [
  ['name', 'Joueuse', 'l'], ['gp', 'MJ'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'PD'], ['min', 'MIN'],
  ['stl', 'INT'], ['blk', 'CTR'], ['to', 'BP'], ['fgp', 'Tirs %'], ['tpp', '3 pts %'], ['ftp', 'LF %'],
  ['club', 'Club', 'l'], ['country', 'Pays', 'l'], ['pos', 'Poste', 'l'],
];

function tableRows() {
  return state.players.map((p) => {
    const a = averages(p.id, tableState.comp);
    return {
      id: p.id, name: p.name, club: p.club, country: p.club_country, comps: p.competitions, pos: poste(p.position) || 'Non précisé',
      gp: a.gp, min: a.min, pts: a.pts, reb: a.reb, ast: a.ast, stl: a.stl, blk: a.blk, to: a.to,
      fgp: a.fga ? a.fgm / a.fga : NaN, tpp: a.tpa ? a.tpm / a.tpa : NaN, ftp: a.fta ? a.ftm / a.fta : NaN,
    };
  });
}

function pageTable() {
  const all = tableRows();
  const opts = (vals, cur) => [...new Set(vals)].filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr')).map((v) => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const { comp, club, country, pos, sort, dir } = tableState;
  const rows = all
    .filter((r) => (!comp || r.comps.includes(comp)) && (!club || r.club === club) && (!country || r.country === country) && (!pos || r.pos === pos))
    .sort((a, b) => {
      const x = a[sort], y = b[sort];
      if (typeof x === 'string') return dir * x.localeCompare(y, 'fr');
      const nx = Number.isFinite(x) ? x : -Infinity, ny = Number.isFinite(y) ? y : -Infinity;
      return dir * (nx - ny) || a.name.localeCompare(b.name, 'fr');
    });
  const val = (r, k) => {
    if (['fgp', 'tpp', 'ftp'].includes(k)) return Number.isFinite(r[k]) ? `${(r[k] * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}` : '–';
    if (k === 'name') return `<a href="#/joueuse/${esc(r.id)}">${esc(r.name)}</a>`;
    if (typeof r[k] === 'string') return esc(r[k]);
    if (k === 'gp') return r.gp;
    return r.gp ? fmt1(r[k]) : '–';
  };
  const compOpts = Object.values(state.comps).map((c) => `<option value="${esc(c.code)}"${c.code === comp ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<h1>Tableau général</h1>
    <p class="page-sub">${rows.length} joueuses · moyennes par match joué${comp ? ` en ${esc(compName(comp))}` : ''}</p>
    <div class="filters" role="group" aria-label="Filtres">
      <label>Compétition<select data-filter="comp" class="${comp ? 'active' : ''}"><option value="">Toutes</option>${compOpts}</select></label>
      <label>Club<select data-filter="club" class="${club ? 'active' : ''}"><option value="">Tous</option>${opts(all.map((r) => r.club), club)}</select></label>
      <label>Pays du club<select data-filter="country" class="${country ? 'active' : ''}"><option value="">Tous</option>${opts(all.map((r) => r.country), country)}</select></label>
      <label>Poste<select data-filter="pos" class="${pos ? 'active' : ''}"><option value="">Tous</option>${opts(all.map((r) => r.pos), pos)}</select></label>
      ${comp || club || country || pos ? '<button class="btn ghost" data-reset>Réinitialiser</button>' : ''}
    </div>
    <div class="table-wrap"><table>
      <thead><tr>${COLS.map(([k, label, cls], i) => `<th class="${cls ?? ''}${i === 0 ? ' first-col' : ''}" aria-sort="${k === sort ? (dir < 0 ? 'descending' : 'ascending') : 'none'}"><button data-sort="${k}">${label}</button></th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${COLS.map(([k, , cls], i) => `<td class="${cls ?? ''}${i === 0 ? ' first-col' : ''}">${val(r, k)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
}

$main.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sort]');
  if (b) {
    const k = b.dataset.sort;
    tableState.dir = tableState.sort === k ? -tableState.dir : ['name', 'club', 'country', 'pos'].includes(k) ? 1 : -1;
    tableState.sort = k;
    render();
    document.querySelector(`[data-sort="${k}"]`)?.focus();
  }
  if (e.target.closest('[data-reset]')) {
    Object.assign(tableState, { comp: '', club: '', country: '', pos: '' });
    render();
  }
});
$main.addEventListener('change', (e) => {
  const f = e.target.dataset?.filter;
  if (f) {
    tableState[f] = e.target.value;
    render();
    document.querySelector(`[data-filter="${f}"]`)?.focus();
  }
  if (e.target.id === 'day-picker' && e.target.value) location.hash = `#/calendrier/${e.target.value}`;
});

// ---------- calendrier ----------
function pageCalendar(day) {
  const days = [...new Set(state.games.map((g) => g.date))].sort();
  const d = day ?? days.at(-1) ?? new Date().toISOString().slice(0, 10);
  const games = state.games.filter((g) => g.date === d).sort((a, b) => a.tipoff_utc.localeCompare(b.tipoff_utc));
  const i = days.indexOf(d);
  const prev = i > 0 ? days[i - 1] : days.filter((x) => x < d).at(-1);
  const next = i >= 0 ? days[i + 1] : days.find((x) => x > d);
  const block = (g) => {
    const lines = Object.values(g.lines ?? {}).sort((a, b) => (b.stats?.pts ?? -1) - (a.stats?.pts ?? -1));
    return `<section class="game-block">
      <h3>${esc(teamName(g.home))} ${g.home.score ?? ''} – ${g.away.score ?? ''} ${esc(teamName(g.away))}</h3>
      <div class="game-meta">${compBadge(g)} ${esc(g.round)}${kickoff(g) ? ` · ${esc(kickoff(g))}` : ''}${g.venue ? ` · ${esc(g.venue)}` : ''}</div>
      <ul>${lines.map((l) => {
        const s = l.stats;
        const { big, tags } = isBig(s, l.player_id);
        return `<li><a href="#/joueuse/${esc(l.player_id)}"><strong>${esc(state.byId.get(l.player_id)?.name ?? l.player_id)}</strong></a>
          <span class="muted">${esc(l.team)}</span>
          ${s ? `<span${big ? ' style="color:var(--t6-green);font-weight:700"' : ''}>${s.pts} pts, ${s.reb} reb, ${s.ast} pd · ${Math.round(s.min)} min · ${s.fgm}-${s.fga} tirs</span>${tags.map((t) => `<span class="badge accent">${esc(t)}</span>`).join('')}` : `<span class="muted">${statusText(l)}</span>`}${(() => { const c = clipLink(g, l); return c ? ` ${linkTag(c)}` : ''; })()}</li>`;
      }).join('')}</ul>
      ${linksHTML(g)}
    </section>`;
  };
  return `<h1>Calendrier</h1>
    <div class="day-nav">
      ${prev ? `<a class="btn ghost" href="#/calendrier/${prev}" aria-label="Journée précédente">← ${esc(dateShortFR(prev))}</a>` : ''}
      <label class="filters" style="margin:0"><span class="sr">Date</span><input type="date" id="day-picker" class="active" value="${d}" min="2026-09-01" max="2027-04-30"></label>
      ${next ? `<a class="btn ghost" href="#/calendrier/${next}" aria-label="Journée suivante">${esc(dateShortFR(next))} →</a>` : ''}
    </div>
    <p class="page-sub">${esc(dateFR(d))} · ${games.length} match${games.length > 1 ? 's' : ''} avec une Française</p>
    ${games.map(block).join('') || '<p class="empty">Aucun match de Française enregistré ce jour-là.</p>'}`;
}

// ---------- infobulle du graphique ----------
function showTip(e) {
  const t = e.target.closest?.('[data-tip]');
  if (!t) return hideTip();
  $tip.textContent = t.dataset.tip;
  $tip.hidden = false;
  const r = t.getBoundingClientRect();
  const x = Math.min(window.innerWidth - $tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - $tip.offsetWidth / 2));
  $tip.style.left = `${x}px`;
  $tip.style.top = `${Math.max(8, r.top - $tip.offsetHeight - 8)}px`;
  t.nextElementSibling?.classList?.add('on');
}
function hideTip() {
  $tip.hidden = true;
  document.querySelectorAll('.bar.on').forEach((b) => b.classList.remove('on'));
}
$main.addEventListener('pointerover', (e) => { hideTip(); showTip(e); });
$main.addEventListener('pointerleave', hideTip);
window.addEventListener('scroll', hideTip, { passive: true });

// ---------- routeur ----------
function render() {
  const [, page, arg] = location.hash.replace(/^#\/?/, '#/').split('/');
  let html;
  let nav = 'home';
  if (page === 'joueuse') { html = pagePlayer(decodeURIComponent(arg ?? '')); nav = ''; }
  else if (page === 'tableau') { html = pageTable(); nav = 'tableau'; }
  else if (page === 'calendrier') { html = pageCalendar(arg); nav = 'calendrier'; }
  else if (page === 'semaine') html = pageHome(arg);
  else html = pageHome();
  $main.innerHTML = html;
  document.querySelectorAll('[data-nav]').forEach((a) => (a.dataset.nav === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const p = page === 'joueuse' ? state.byId.get(decodeURIComponent(arg ?? '')) : null;
  document.title = `${p ? `${p.name} · ` : ''}Les Françaises en Coupe d'Europe`;
}

let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  render();
  if (location.hash.split('/')[1] !== lastHash.split('/')[1]) window.scrollTo(0, 0);
  lastHash = location.hash;
});

async function load() {
  const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${u} : ${r.status}`);
    return r.json();
  });
  try {
    const [players, games, config, comps] = await Promise.all([
      get('data/players.json'), get('data/games.json'), get('config/site.json'), get('config/competitions.json'),
    ]);
    const excluded = new Set(config.excluded_players ?? []);
    state.players = players.filter((p) => p.active !== false && !excluded.has(p.id));
    state.byId = new Map(players.map((p) => [p.id, p]));
    state.games = games.games ?? [];
    state.comps = Object.fromEntries((comps.competitions ?? []).map((c) => [c.code, c]));
    state.config = config;
    state.updated = games.updated ?? null;
    if (games.updated) {
      const u = new Date(games.updated);
      document.getElementById('updated').textContent = `Mis à jour le ${updatedText(u)}`;
      $refreshInfo.textContent = `Données du ${updatedText(u)}`;
    }
    render();
  } catch (e) {
    $main.innerHTML = `<p class="empty">Les données n'ont pas pu être chargées (${esc(e.message)}).</p>`;
  }
}

const updatedText = (u) => `${u.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })} à ${timeParis(u)}`;

// ---------- bouton « Actualiser » (réservé à l'éditeur) ----------
// Il ouvre la page GitHub de l'Action (bouton « Run workflow »), puis recharge le site
// tout seul dès que les nouvelles données sont publiées.
const $refresh = document.getElementById('refresh');
const $refreshBtn = document.getElementById('refresh-btn');
const $refreshInfo = document.getElementById('refresh-info');
$refresh.hidden = !ADMIN;

let polling = null;
$refreshBtn.addEventListener('click', async () => {
  const url = state.config.update_workflow_url;
  if (url) window.open(url, '_blank', 'noopener');
  const before = state.updated;
  $refreshBtn.disabled = true;
  $refreshInfo.textContent = url
    ? 'Sur GitHub, cliquer « Run workflow ». Le site se rechargera tout seul (5 à 10 min).'
    : 'Rechargement des données…';
  await load();
  if (!url) {
    $refreshBtn.disabled = false;
    return;
  }
  clearInterval(polling);
  const started = Date.now();
  polling = setInterval(async () => {
    try {
      const r = await fetch('data/games.json', { cache: 'no-cache' }).then((x) => x.json());
      if (r.updated && r.updated !== before) {
        clearInterval(polling);
        await load();
        $refreshInfo.textContent = `Site actualisé : données du ${updatedText(new Date(r.updated))}`;
        $refreshBtn.disabled = false;
      }
    } catch { /* réessai au prochain tour */ }
    if (Date.now() - started > 20 * 60 * 1000) {
      clearInterval(polling);
      $refreshInfo.textContent = 'Pas de nouvelles données après 20 min : vérifier l\'Action sur GitHub.';
      $refreshBtn.disabled = false;
    }
  }, 30000);
});

load();
