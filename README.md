# Les Françaises en Coupe d'Europe

Site statique qui suit, match par match, les joueuses françaises d'EuroLeague Women et d'EuroCup Women
(saison 2026-27). Il se met à jour tout seul les mardis, mercredis et jeudis à 22 h 15 (heure de Paris), soirs de
coupe d'Europe, grâce à une GitHub Action, puis se redéploie sur GitHub Pages. Entre deux, bouton Actualiser.

Site : <https://eliottcaillottaille6.github.io/francaises-europe-2026/>

## Comment ça marche

```
fiba.basketball ──► scripts/update.mjs ──► data/games.json ──► site (public/)
  (calendrier,           │
   effectifs,            ├─► data/players.json     (Françaises, ajout automatique des nouvelles)
   play-by-play)         └─► data/missing-games.md (matchs non publiés)
YouTube (@euroleaguewomen, @FIBA) ─┘  vidéos officielles
```

- **Source unique : fiba.basketball**, qui gère les deux compétitions. La page `/games` de chaque compétition donne
  tous les matchs de la saison (équipes, score, heure, tour). La page de chaque match donne les effectifs (avec la
  nationalité) et le play-by-play complet.
- **Françaises** : joueuses de nationalité FIBA « FRA ». `data/players.json` est construit par
  `npm run players`, et `update.mjs` y ajoute toute nouvelle Française qui apparaît dans un effectif.
- **Stats reconstituées à partir du play-by-play** (`scripts/lib/boxscore.mjs`) : points, tirs, rebonds offensifs et
  défensifs, passes, interceptions, contres, balles perdues, fautes, et minutes à partir des entrées et sorties.
  FIBA ne publie le box score que par une API interne protégée par une clé, qui n'est pas utilisée.
- **Contrôles** : les points de chaque équipe doivent égaler le score officiel, sinon le match n'est pas publié et
  il est listé dans `data/missing-games.md`. Vérifié au lancement : 79 matchs sur 79 conformes, minutes exactes
  (5 joueuses × durée du match) sur tous les matchs de la saison, et box scores identiques à ceux affichés sur
  fiba.basketball (à la seconde près pour les minutes, FIBA comptant les dixièmes).
- **Statut de chaque ligne** : a joué, « sur la feuille de match, n'a pas joué », ou « absente de la feuille de match »
  (dans l'effectif mais pas inscrite pour ce match).
- Les pages des matchs validés sont gardées 30 jours en cache (`.cache/http`) : une mise à jour ne relit que les
  nouveaux matchs. Les requêtes sont espacées d'une seconde (`HTTP_DELAY_MS`).

## Vidéos (`scripts/lib/youtube.mjs`)

Les deux compétitions diffusent leurs matchs gratuitement sur YouTube : EuroLeague Women sur **@euroleaguewomen**,
EuroCup Women sur **@FIBA** (chaînes réglées dans `config/competitions.json` → `youtube_channels`).
Pour chaque match, recherche « Domicile v Extérieur » dans ces chaînes. Une vidéo n'est retenue que si :

- l'équipe à domicile est citée en premier, et les deux noms correspondent (mots significatifs ; un club peut
  changer de nom d'une vidéo à l'autre, ex. « KSSSE Enea AJP Gorzow » / « PRO-NETWORK ENEA AJP Gorzow ») ;
- le titre porte le nom de la compétition et la saison 2026-27 ;
- elle a été publiée après le match : dans les 2 jours pour un match complet (direct rediffusé), dans les 7 jours
  pour un résumé (en play-off, le même « A v B » peut revenir quelques jours plus tard) ;
- elle n'est pas déjà attribuée à un autre match.

« Full Basketball Game » d'au moins 45 min = **match complet** (`youtube` dans `games.json`) ;
« Highlights » = **résumé** (`highlights`). Recherche pendant 14 jours après le match.
Le bouton YouTube du site mène au match complet, sinon au résumé, sinon à la recherche sur la chaîne officielle.

## Pages

- **Accueil** : la semaine civile en cours (lundi → dimanche, heure de Paris ; une journée de coupe d'Europe s'étale
  du mardi au jeudi). Cartes des joueuses encadrées d'abord, puis les autres, chaque groupe par points ; liste des
  joueuses qui n'ont pas joué. Boutons semaine précédente / suivante.
- **Fiche joueuse** : club, compétition, lien vers sa page sur fiba.basketball (une par compétition ; adresse
  construite à partir de son numéro FIBA et du club, vérifiée une fois), poste, taille, âge, moyennes (séparées par compétition si elle joue les
  deux), graphique des points, game log.
- **Tableau** : toutes les joueuses, triable, filtres compétition (les moyennes sont alors recalculées), club, pays
  du club, poste.
- **Calendrier** : jour par jour, avec un sélecteur de date.

Lignes encadrées en vert : au moins le seuil de points de la joueuse (`config/site.json` → `highlight` : `points`, 20
pour toutes, `players` pour un seuil par joueuse, par `id`), ou double-double / triple-double.

## Commandes

```bash
npm run update    # matchs joués + vidéos
npm run players   # reconstruit la liste des Françaises à partir de tous les effectifs
npm run build     # assemble le site dans _site/
npm run dev       # site local sur http://localhost:4321 (variable PORT pour changer)
```

## Ajouter, retirer ou corriger une joueuse

Dans **`data/players.json`** :

- **Retirer du site** : `"active": false` (ses matchs restent dans `games.json`).
- **Écarter définitivement** : ajouter son `id` dans `config/site.json` → `excluded_players` et son numéro FIBA dans
  `excluded_fiba_ids`. À la mise à jour suivante, elle est retirée de `players.json` et de tous les matchs, et elle
  n'est plus jamais rajoutée automatiquement. Elle Ladine est dans ce cas.
- **Ajouter une joueuse qui n'est pas de nationalité FIBA « FRA »** (double nationalité enregistrée sous un autre
  pays) : copier un bloc existant, mettre son `fiba_person_id` (nombre dans l'adresse de sa fiche sur
  fiba.basketball, ex. `…/teams/basket-landes/253743-emma-peytour` → `253743`) et son club, puis lancer
  `npm run update` : ses matchs sont repris.
- `npm run players` conserve `active`, `note` et `aliases` des joueuses déjà présentes.

## Ajouter une compétition ou passer à la saison suivante

Dans `config/competitions.json` : `slug` = partie de l'adresse `fiba.basketball/en/events/<slug>`
(ex. `euroleague-women-27-28`), `name` = nom tel qu'il apparaît dans les titres YouTube, `youtube_channels`.
Changer aussi l'année `2026-27` dans `scripts/lib/youtube.mjs` (contrôle de la saison dans le titre).

## Mode éditeur, Actualiser et Clipper

Ouvrir une fois le site avec `?admin` à la fin de l'adresse : le mode éditeur reste actif sur cet appareil
(`?admin=0` pour le désactiver).

- **Actualiser** (en haut) : ouvre la page GitHub de l'Action (cliquer « Run workflow »), puis le site se recharge tout
  seul dès que les nouvelles données sont publiées.
- **Clipper** sur chaque ligne d'une joueuse qui a joué, quand le match complet est sur YouTube (jamais avec un
  résumé, où seuls les paniers montrés seraient retrouvés) : ouvre l'outil de clipping du Mac (`http://127.0.0.1:8765/`,
  `config/site.json` → `clipping.url`) avec le match complet, la page
  FIBA du match comme play-by-play, le nom, le numéro et l'équipe (1 = à domicile), et `zones=fiba` : l'habillage TV
  étant le même sur tous les matchs des deux compétitions, l'outil pose lui-même les zones du quart-temps et du
  chrono, puis lance l'analyse. Il reste la vérification des clips et l'export. Vérifié au lancement : l'outil
  retrouve les 251 lignes de Françaises, avec autant de paniers que de tirs réussis dans le box score.
  Le pré-téléchargement de ces vidéos chaque matin est géré par l'outil de clipping (`prefetch_ncaa.py`, qui lit les
  deux sites).

## Déploiement

Dépôt GitHub `eliottcaillotTaille6/francaises-europe-2026`, GitHub Pages en mode « GitHub Actions ».
L'Action `.github/workflows/update.yml` tourne les mardis, mercredis et jeudis à 22 h 15 (heure de Paris : deux
horaires UTC sont programmés pour suivre l'heure d'été, un seul s'exécute), commite `data/` puis redéploie. Elle redéploie aussi le
site à chaque push sur `public/`, `config/` ou `data/players.json`.

## Points d'attention

- Les pages de fiba.basketball ne sont pas une API documentée : si FIBA change leur format, `update.mjs` s'arrêtera
  avec une erreur dans l'Action plutôt que de publier des chiffres faux.
- Deux matchs n'ont pas de vidéo au lancement (Chartres – Chomutov, Ruzomberok – Namur) : rien n'a été publié sur
  les chaînes officielles.
