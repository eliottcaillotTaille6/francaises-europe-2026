// Assemble le site statique dans _site/ : public/ + les JSON publics + la config.
import fs from 'node:fs';

const OUT = '_site';
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync('public', OUT, { recursive: true });
fs.mkdirSync(`${OUT}/data`, { recursive: true });
fs.mkdirSync(`${OUT}/config`, { recursive: true });
for (const f of ['games.json', 'players.json']) fs.copyFileSync(`data/${f}`, `${OUT}/data/${f}`);
for (const f of ['site.json', 'competitions.json']) fs.copyFileSync(`config/${f}`, `${OUT}/config/${f}`);
fs.writeFileSync(`${OUT}/.nojekyll`, '');

// Numéro de version sur le code : un navigateur qui garde l'ancienne version en cache (10 min sur GitHub Pages)
// charge quand même le nouveau code dès la publication.
const v = Date.now().toString(36);
const index = `${OUT}/index.html`;
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(/(href="styles\.css|src="app\.js)"/g, `$1?v=${v}"`));
console.log(`Site prêt dans ${OUT}/`);
