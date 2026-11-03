// Vidéos officielles d'un match sur YouTube (recherche dans les chaînes de la compétition,
// config/competitions.json → youtube_channels). Titres FIBA :
//   « Casademont Zaragoza v Basket Landes | Full Basketball Game | EuroLeague Women 2026-27 »
//   « Regular Season | PRO-NETWORK ENEA AJP Gorzow v BLMA | Full Basketball Game | EuroCup Women 2026-27 »
//   « Galatasaray Cagdas Faktoring v KKZ Crvena Zvezda | Full Game Highlights | EuroLeague Women 2026-27 »
// Une vidéo n'est retenue que si :
// - l'équipe à domicile est citée en premier (« A v B »), les deux noms reconnus ;
// - le titre porte le nom de la compétition et la saison (2026-27) ;
// - elle a été publiée après le match : dans les 2 jours (match complet) ou les 7 jours (résumé) ;
// - « Full Basketball Game » d'au moins 45 min (match complet) ou « Highlights » (résumé).
// Les directs à venir (« LIVE - … », sans durée) sont ignorés.
import { fetchText } from './http.mjs';

const plain = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// mots trop courants pour distinguer deux clubs
const GENERIC = new Set(['basket', 'basketball', 'club', 'bc', 'wbc', 'bk', 'kk', 'zkk', 'women', 'feminin', 'team', 'sport', 'spor', 'the', 'de', 'and']);
const words = (s) => plain(s).split(' ').filter((w) => w.length >= 2 && !GENERIC.has(w));

/** Part des mots significatifs du plus court des deux noms présents dans l'autre (0 à 1). */
export function similarity(a, b) {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (!wa.size || !wb.size) return 0;
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / Math.min(wa.size, wb.size);
}

function seconds(text) {
  if (!/^\d+(:\d{2}){1,2}$/.test(text ?? '')) return null;
  return text.split(':').reduce((a, x) => a * 60 + Number(x), 0);
}

// « 4d ago », « Streamed 2 weeks ago », « 1 month ago » → âge en jours, sous forme d'intervalle
// (YouTube arrondit : « 1 month ago » = entre 30 et 60 jours).
function ageDays(text) {
  const m = /(\d+)\s*(s|sec|second|m|min|minute|h|hr|hour|d|day|w|wk|week|mo|month|y|yr|year)s?\s+ago/i.exec(text ?? '');
  if (!m) return null;
  const unit = m[2].toLowerCase();
  const n = Number(m[1]);
  const per = /^(y|yr|year)$/.test(unit) ? 365 : /^(mo|month)$/.test(unit) ? 30 : /^(w|wk|week)$/.test(unit) ? 7
    : /^(d|day)$/.test(unit) ? 1 : /^(h|hr|hour)$/.test(unit) ? 1 / 24 : 1 / 1440;
  return { min: n * per, max: (n + 1) * per };
}

function results(html) {
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
  if (!m) return [];
  const out = [];
  const seen = new Set();
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    const v = o.videoRenderer;
    if (v && !seen.has(v.videoId)) {
      seen.add(v.videoId);
      out.push({
        id: v.videoId,
        title: (v.title?.runs ?? []).map((r) => r.text).join('') || v.title?.simpleText || '',
        age_days: ageDays(v.publishedTimeText?.simpleText),
        duration_s: seconds(v.lengthText?.simpleText),
      });
    }
    Object.values(o).forEach(walk);
  };
  walk(JSON.parse(m[1]));
  return out;
}

/** Classe la vidéo pour ce match : 'full', 'highlights' ou null (pas ce match, ou pas sûr). */
export function classify(v, game, compName, today) {
  const segments = v.title.split('|').map((s) => s.trim());
  const matchup = segments.find((s) => / v /i.test(s));
  if (!matchup || !v.duration_s) return null;
  const [a, b] = matchup.replace(/^[^:]*:\s*/, '').split(/\s+v\s+/i);
  if (!a || !b) return null;
  if (similarity(a, game.home.short) < 0.5 || similarity(b, game.away.short) < 0.5) return null;
  if (!plain(v.title).includes(plain(compName))) return null;
  if (!/2026\s*-\s*(20)?27/.test(v.title)) return null;
  const sinceGame = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${game.date}T12:00:00Z`)) / 86400000;
  // publiée après le match : le jour même ou presque pour un direct rediffusé, dans la semaine pour un résumé
  // (en play-off, le même « A v B » peut revenir quelques jours plus tard)
  const within = (days) => v.age_days && v.age_days.min <= sinceGame + 1 && v.age_days.max >= sinceGame - days;
  if (/full\s+basketball?\s+game|full game(?!\s*highlight)/i.test(v.title) && v.duration_s >= 45 * 60) return within(2) ? 'full' : null;
  if (/highlight/i.test(v.title)) return within(7) ? 'highlights' : null;
  return null;
}

/**
 * Cherche les vidéos du match dans les chaînes données (ex. ['@euroleaguewomen', '@FIBA']).
 * taken : vidéos déjà attribuées à d'autres matchs.
 * Renvoie { full: {url,title,channel,duration_s} | null, highlights: … | null }.
 */
export async function findVideos(game, compName, channels, today, taken = new Set()) {
  const found = { full: null, highlights: null };
  for (const ch of channels) {
    const q = `${game.home.short} v ${game.away.short}`;
    const html = await fetchText(`https://www.youtube.com/${ch}/search?query=${encodeURIComponent(q)}`, {
      ttl: 6 * 3600,
      headers: { 'Accept-Language': 'en-US,en;q=0.8' },
    });
    for (const v of results(html)) {
      const kind = classify(v, game, compName, today);
      if (!kind || found[kind] || taken.has(`https://www.youtube.com/watch?v=${v.id}`)) continue;
      found[kind] = { url: `https://www.youtube.com/watch?v=${v.id}`, title: v.title, channel: ch, duration_s: v.duration_s };
    }
    if (found.full && found.highlights) break;
  }
  return found;
}
