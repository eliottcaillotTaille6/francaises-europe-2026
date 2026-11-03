// Requêtes HTTP polies : pause entre appels, cache disque, reprises sur erreur.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CACHE_DIR = '.cache/http';
const UA = 'Francaises-Europe-Tracker/1.0';
const DELAY_MS = Number(process.env.HTTP_DELAY_MS ?? 1000);

let last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} url
 * @param {{ttl?: number, json?: boolean, retries?: number}} opts ttl en secondes (0 = pas de cache)
 */
export async function fetchText(url, { ttl = 3600, retries = 3, headers = {} } = {}) {
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const file = path.join(CACHE_DIR, key);
  if (ttl > 0 && fs.existsSync(file)) {
    const age = (Date.now() - fs.statSync(file).mtimeMs) / 1000;
    if (age < ttl) return fs.readFileSync(file, 'utf8');
  }
  let err;
  for (let i = 0; i <= retries; i++) {
    const wait = last + DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 404) throw Object.assign(new Error(`404 ${url}`), { status: 404, fatal: true });
      if (res.status === 403 || res.status === 401)
        throw Object.assign(new Error(`${res.status} (bloqué) ${url}`), { status: res.status, fatal: true });
      if (!res.ok) throw Object.assign(new Error(`${res.status} ${url}`), { status: res.status });
      const text = await res.text();
      if (ttl > 0) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(file, text);
      }
      return text;
    } catch (e) {
      err = e;
      if (e.fatal) break;
      await sleep(1500 * 2 ** i);
    }
  }
  throw err;
}

export async function fetchJSON(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}
