# Galerie-tunnel, suite — la porte au lieu du fondu, et le banking

Brief d'exécution, 2026-09-09 (soir). Suite de
`2026-09-09-galerie-tunnel.md`, après la première revue d'Alexandre.

## Ce qu'Alexandre a vu, et pourquoi c'est ça

Sa capture (pleine transition d'entrée) montre **deux images superposées** :
le conduit cobalt avec son rectangle de sortie à bord dur, et le couloir
blanc quadrillé qui apparaît par transparence *par-dessus* les parois cobalt,
avec son propre rectangle de section net. On voit la technique : c'est une
double exposition, pas un passage. Deux causes, mesurables dans le code :

1. **Les deux tunnels occupent le même volume** et sont fondus l'un dans
   l'autre (`Gallery.js`, `FADE = 0.08`, opacité globale sur treillis, papier
   et photos ; `Three.#render` efface la profondeur entre les deux passes).
   Tout ce que le fondu a à offrir, c'est deux arêtes qui coïncident ; tout
   le reste (le bord de sortie, les lignes du treillis sur le cobalt) est un
   fantôme.
2. **La caméra s'arrête pendant le fondu.** Le progress est épinglé à
   `PLATEAU` dès `t = 0`, et la caméra galerie ne bouge pas avant
   `t = FADE`. Le visiteur avance, s'immobilise, regarde une matière changer,
   repart. C'est l'arrêt qui trahit la couture.

## La nouvelle règle : le couloir est la SUITE du conduit, pas son double

Le conduit du logo se termine par un plan de sortie. **Le couloir blanc
commence exactement à ce plan** et continue tout droit, même section carrée,
même axe. Le visiteur roule dans le cobalt, franchit une porte, et roule dans
le papier quadrillé. Il n'y a plus rien à fondre à l'entrée : la matière
change là où la géométrie change, et la caméra ne s'arrête jamais.

### Rendu : une seule profondeur, dans le même monde

- Le couloir reste une scène séparée (`Gallery.js`), mais son tunnel commence
  à `z = +halfLength` du conduit (le plan de sortie, `bore.origin +
  axisDir × 2·halfLength·s`) au lieu de 2 unités avant la couture. Plus de
  recouvrement avec les parois cobalt.
- Pendant l'**approche** (la caméra du logo est encore dans le conduit ou
  devant sa bouche), la passe galerie se rend **avec la caméra de rendu du
  logo elle-même** (`scene.renderCamera`, même projection, même near/far) et
  **sans effacer la profondeur** : le couloir est dans le même monde, le
  z-buffer fait l'occultation. Depuis l'intérieur du conduit, les parois du
  couloir ne se projettent que **dans** le rectangle de sortie — c'est
  géométrique (le tube est convexe) — donc elles remplacent exactement ce
  que ce rectangle montrait (le cyclorama blanc), et rien d'autre.
- Cette passe n'existe que **dans la fenêtre de la traversée** :
  `h ∈ [JOURNEY.MORPH_IN[0], JOURNEY.MORPH_OUT[0] + ε]` (entre l'alignement
  sur l'axe et le début du demi-tour). Hors de la fenêtre, pas de passe : le
  couloir fait 18 largeurs (≈ 22 unités monde), il perce le cyclorama
  (`ROOM.radius` ≈ 19 unités) et ne doit jamais être vu depuis l'orbite.
- **Le plateau commence quand la caméra du logo a franchi la porte** :
  `PLATEAU` devient le progress où la position eassée de `TRAVERSE` est au
  moins **0,1 largeur de conduit au-delà du plan de sortie** (le conduit est
  derrière, le cadre est tout couloir). Le calculer, ne pas le deviner :
  aujourd'hui l'exit est croisée à h ≈ 0,627 et le traverse finit à
  `EXIT_OVER = 0,3` derrière, donc c'est vers h ≈ 0,635–0,64. Il faut aussi
  que la vitesse y soit encore franche (la fenêtre `TRAVERSE` freine sur sa
  fin) : mesurer `dz/dh` par différence centrée à P.
- Sur le plateau, la caméra galerie **part de la pose de couture à la même
  vitesse par unité de scroll que le conduit à P** (dérivée mesurée
  ci-dessus, convertie en unités par vh), puis rejoint la vitesse de croisière
  du couloir par un smoothstep sur les premiers ~10 % du trajet. Ce n'est pas
  une ease inventée : c'est la continuité C1 de la vitesse à travers la
  couture. Le passage logo → galerie ne se voit ni en position ni en vitesse.
- Le recentrage de l'œil (`RECENTRE`) reste, il est doux.
- À partir du plateau, le logo n'est plus rendu (comme aujourd'hui quand
  `fade ≥ 1`) et la galerie se rend seule avec sa caméra, `autoClear` vrai,
  fond papier.

### La sortie

À `t → 1` la caméra galerie est 18 largeurs plus loin. Ce qu'on retrouve
ensuite, c'est la caméra du logo à P, juste derrière la porte, regardant le
cyclorama blanc ; puis le demi-tour (`SWEEP`/`MORPH_OUT`) tel qu'il existe.
La transition de sortie est donc **blanc vers blanc** et elle se fait ainsi :

- Sur les derniers ~10 % du trajet, **le treillis s'éteint** (opacité des
  lignes → 0) et le brouillard se rapproche : le couloir s'ouvre, il ne reste
  que du papier. Les photos sont déjà loin (`TAIL`).
- Sur les tout derniers 6 % du plateau, la scène du logo est rendue
  dessous (caméra à P) et **l'opacité du papier** de la galerie descend à 0 :
  c'est un fondu entre du papier uni et le cyclorama lit — il n'y a rien à
  voir bouger, donc l'arrêt de la caméra pendant ce fondu est invisible.
  Puis le plateau s'achève et le progress repart : la caméra recule et fait
  son demi-tour comme avant.
- Symétrique par construction : en scroll arrière depuis le demi-tour, le
  papier se lève, le treillis se rallume, on rentre dans le couloir à
  reculons, on repasse la porte à reculons, on est dans le cobalt.

### Ce qui disparaît

`FADE` d'entrée, le crossfade des parois, le `clearDepth()` entre les
passes, `INSET`/`polygonOffset` s'ils n'ont plus de raison d'être (plus de
recouvrement). Le commentaire de tête de `Gallery.js` doit raconter la
**porte**, pas plus la couture par superposition.

## Le banking — la caméra prend ses virages comme un roller coaster

Demande d'Alexandre : quand la caméra tourne, elle **s'incline dans le
virage** pour que la « gravité du véhicule » reste dans l'axe du siège. Sans
exagération : de l'ordre de **30° au plus fort**, à évaluer à l'œil et à la
jauge.

Où sont les virages, dans `#applyJourney` :

1. **ALIGN** (`h` 0 → 0,3) : le bezier qui quitte l'orbite et se pose sur
   l'axe du conduit, caméra orthographique, le regard glisse de la marque
   vers la route (`GAZE_IN`).
2. **SWEEP** (`h` 0,66 → 0,96) : le demi-tour passager de 166° après la
   sortie, perspective qui se draine.

Le couloir de la galerie est droit : pas de banking dedans. L'orbite
elle-même n'en a pas non plus (c'est la page, et le repos doit rester exact).

### La formule, fonction pure de `h`

```
yawRate(h) = (heading(h + ε) − heading(h − ε)) / 2ε      // azimut du regard, différence centrée, ε = 0.002
lateral(h) = speed(h) × yawRate(h)                       // speed = |pos(h+ε) − pos(h−ε)| / 2ε, en unités monde
bank(h)    = MAX_BANK × tanh(lateral(h) / A_REF)         // saturation douce, jamais de clamp dur
             × win(h, [0, 0.03]) × win(1 − h, [0, 0.03]) // zéro garanti aux deux coutures de l'étape
```

- `MAX_BANK = 30°`. `A_REF` se **calibre** : mesurer `lateral(h)` sur toute
  l'étape (petit script jetable, ou `window.__three` en dev) et choisir
  `A_REF` pour que le pic du SWEEP atteigne ~27–30° et qu'ALIGN reste
  autour de 10–20°. Rapporter les deux valeurs mesurées.
- Le signe : la caméra **se penche vers l'intérieur du virage** (virage à
  gauche → le haut de l'image bascule vers la gauche, comme un wagon qui
  s'incline sur sa courbe). Vérifier sur une frame, pas dans sa tête.
- Application : `up = WORLD_UP` tourné de `bank` autour de l'axe du regard,
  avant le `lookAt` (ortho en ALIGN, perspective dans l'interlude). Dans
  ALIGN le quaternion est construit par `Matrix4.lookAt(pos, target,
  WORLD_UP)` : remplacer `WORLD_UP` par le `up` incliné. Le `STITCH` slerp
  reste, il gère la couture avec le regard vivant de l'orbite.
- **Interdits** : aucun état intégré (le banking se recalcule à chaque frame
  depuis `h`), aucun banking pendant une plongée, aucun sur le plateau
  (la galerie copie la pose de couture, où bank = 0 par la fenêtre… **sauf**
  si P tombe dans un virage — il n'y tombe pas, la traversée est droite).

### La jauge

`npm run flow` (`tools/flow.mjs`) mesure le flux optique. Le banking fait
tourner tout le cadre : ça pèse sur le flux. Le budget reste **6× la
croisière** (`--budget 6` par défaut). Lancer la jauge avant et après ; si le
pic du SWEEP dépasse, baisser `MAX_BANK` ou `A_REF`, pas la fenêtre.

## Vérification attendue

1. `npm run shoot:v2` vert (repos identique, coin creux asserté).
2. `node tools/shoot.mjs --url http://localhost:5180/v2.html --gallery --out
   tools/shots/gallery2` : à `t = 0,02` on doit voir **le conduit cobalt qui
   se termine et le couloir quadrillé qui continue derrière la porte, net,
   sans fantôme** ; à `t = 0,5` les photos ; à `t = 0,98` du papier presque
   uni. Ajouter deux frames de progress **avant** P (h = 0,58 et 0,61, dans
   le conduit) pour montrer le couloir vu à travers la sortie pendant
   l'approche. Regarder les PNG.
3. Continuité de vitesse : un script jetable qui fait avancer le scroll réel
   par pas constants de 60 px à travers la couture et imprime la position
   caméra (logo puis galerie) — les pas doivent être réguliers, sans
   saut ni arrêt.
4. Banking : frames à h = 0,15 (ALIGN) et h = 0,75 / 0,85 (SWEEP) — le cadre
   est incliné, la scène n'est pas cassée ; `npm run flow` ≤ budget, valeurs
   avant/après dans le rapport.
5. Marche arrière depuis le milieu du couloir : on repasse la porte à
   reculons dans le cobalt.
6. Deux commits : la porte, puis le banking. Messages en français.
