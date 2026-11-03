// Box score reconstitué à partir du play-by-play de fiba.basketball.
// Chaque action : { ac: code, txt, oId: organisation de l'équipe, pId: joueuse, Time: "m:ss" restant,
// order, made, pts }. Codes utiles : P2 / P3 / FT (tirs), REB (rebond, « offensive » ou « defensive »
// dans txt), ASS (passe décisive), ST (interception), BS (contre), TO (balle perdue), FOUL (faute),
// SUBST (« Sub-In » / « Sub-Out »).
//
// Minutes : une joueuse est sur le terrain du début du match si sa première substitution est une
// sortie (ou si elle n'en a aucune mais a une action) ; ensuite, chaque entrée / sortie ouvre ou ferme
// un intervalle. Longueur des périodes : 10 min, prolongation 5 min.

const periodLength = (key) => (/^OT/i.test(key) ? 300 : 600);
const clock = (t) => {
  const [m, s] = String(t ?? '0:00').split(':').map(Number);
  return m * 60 + (s || 0);
};

const empty = () => ({
  sec: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
  oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0,
});

/**
 * @param {object} pbp       objet playByPlay de la page ({ items: { Q1: { items: [...] }, … } })
 * @param {object} sheets    { [orgId]: [{ personId, … }] } joueuses inscrites, par équipe
 * @returns {{ players: Map<personId, {org, starter, stats}>, totals: {[orgId]: pts} }}
 */
export function boxscore(pbp, sheets) {
  const periods = Object.entries(pbp.items ?? {});
  const players = new Map();
  for (const [org, list] of Object.entries(sheets))
    for (const p of list) players.set(String(p.personId), { org: String(org), starter: false, stats: empty(), events: 0 });

  // temps de jeu écoulé au moment d'une action
  let base = 0;
  const timeline = [];
  for (const [key, block] of periods) {
    const len = periodLength(key);
    const acts = [...(block.items ?? [])].sort((a, b) => a.order - b.order);
    for (const a of acts) timeline.push({ ...a, at: base + len - clock(a.Time), period: key });
    base += len;
  }
  const end = base;

  const get = (a) => {
    const id = String(a.pId);
    if (!a.pId || a.pId === '$undefined') return null;
    if (!players.has(id)) players.set(id, { org: String(a.oId), starter: false, stats: empty(), events: 0 });
    return players.get(id);
  };

  // statistiques
  for (const a of timeline) {
    const p = get(a);
    if (!p) continue;
    const s = p.stats;
    if (a.ac !== 'SUBST') p.events++;
    switch (a.ac) {
      case 'P2':
      case 'P3':
        s.fga++;
        if (a.ac === 'P3') s.tpa++;
        if (a.made) {
          s.fgm++;
          if (a.ac === 'P3') s.tpm++;
          s.pts += a.ac === 'P3' ? 3 : 2;
        }
        break;
      case 'FT':
        s.fta++;
        if (a.made) { s.ftm++; s.pts++; }
        break;
      case 'REB':
        if (/offensive/i.test(a.txt)) s.oreb++;
        else s.dreb++;
        s.reb++;
        break;
      case 'ASS': s.ast++; break;
      case 'ST': s.stl++; break;
      case 'BS': s.blk++; break;
      case 'TO': s.to++; break;
      case 'FOUL': s.pf++; break;
    }
  }

  // minutes
  const firstSub = new Map();
  for (const a of timeline) if (a.ac === 'SUBST' && get(a) && !firstSub.has(String(a.pId))) firstSub.set(String(a.pId), a);
  const onSince = new Map();
  for (const [id, p] of players) {
    const f = firstSub.get(id);
    if ((f && /out/i.test(f.txt)) || (!f && p.events > 0)) {
      p.starter = true;
      onSince.set(id, 0);
    }
  }
  for (const a of timeline) {
    if (a.ac !== 'SUBST') continue;
    const id = String(a.pId);
    const p = players.get(id);
    if (!p) continue;
    if (/in/i.test(a.txt) && !/out/i.test(a.txt)) {
      if (!onSince.has(id)) onSince.set(id, a.at);
    } else if (onSince.has(id)) {
      p.stats.sec += a.at - onSince.get(id);
      onSince.delete(id);
    }
  }
  for (const [id, since] of onSince) players.get(id).stats.sec += end - since;

  const totals = {};
  for (const p of players.values()) totals[p.org] = (totals[p.org] ?? 0) + p.stats.pts;
  for (const p of players.values()) {
    p.played = p.stats.sec > 0 || p.events > 0;
    p.stats.min = Math.round((p.stats.sec / 60) * 10) / 10;
    delete p.events;
  }
  return { players, totals };
}
