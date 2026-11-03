// Lecture des pages fiba.basketball (application Next.js) : les données sont dans le flux de rendu
// (self.__next_f.push([1, "…"])). On le reconstitue, puis on en extrait les objets JSON utiles.
import { fetchText } from './http.mjs';

const BASE = 'https://www.fiba.basketball/en/events';

export function flight(html) {
  const parts = [...html.matchAll(/self\.__next_f\.push\(\[1,"(.*?)"\]\)<\/script>/gs)].map((m) => m[1]);
  return parts.map((p) => JSON.parse(`"${p}"`)).join('');
}

/** Objet JSON qui commence à la position i du texte (accolade ou crochet). */
export function objectAt(text, i) {
  let depth = 0;
  let inStr = false;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (inStr) {
      if (c === '\\') j++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(i, j + 1));
    }
  }
  throw new Error('objet JSON incomplet');
}

/** Valeur JSON qui suit « "key": », première occurrence après `from`. */
export function valueAfter(text, key, from = 0) {
  const needle = `"${key}":`;
  const i = text.indexOf(needle, from);
  if (i < 0) return undefined;
  return objectAt(text, i + needle.length);
}

/** Tous les matchs d'une compétition (page /games). */
export async function competitionGames(slug, { ttl = 3 * 3600 } = {}) {
  const t = flight(await fetchText(`${BASE}/${slug}/games`, { ttl }));
  const games = new Map();
  for (const m of t.matchAll(/\{"gameId":\d+,"gameName"/g)) {
    try {
      const g = objectAt(t, m.index);
      games.set(g.gameId, g);
    } catch { /* objet tronqué : ignoré */ }
  }
  return [...games.values()];
}

export const gameUrl = (slug, g) =>
  `${BASE}/${slug}/games/${g.gameId}-${g.teamA?.code ?? 'TBD'}-${g.teamB?.code ?? 'TBD'}`;

/** Page d'un match : effectifs complets (rosterA / rosterB, avec nationalité) et feuille de match. */
export async function gamePage(slug, g, { ttl } = {}) {
  const url = gameUrl(slug, g);
  // match terminé et validé : la page ne change plus
  const final = g.gameResultStatusCode === 'VALID' && g.gamePlayByPlayStatusCode === 'VALID';
  const t = flight(await fetchText(url, { ttl: ttl ?? (final ? 30 * 86400 : 3 * 3600) }));
  const at = t.indexOf('"rosterA":');
  const rosterA = at >= 0 ? valueAfter(t, 'rosterA', at) : null;
  const rosterB = at >= 0 ? valueAfter(t, 'rosterB', at) : null;
  return { url, text: t, rosterA, rosterB };
}
