# Anamorphic landing — *Hi, I'm Alex*

Une page d'accueil qui **est** un document plat, jusqu'à ce qu'on scrolle.

Au repos, l'écran montre du texte noir sur papier blanc et le glyph ALXMTNC en
cobalt, à son angle isométrique exact. Rien ne trahit la 3D. Au premier geste de
scroll, le document se révèle avoir toujours été un objet dans une pièce : la
page était **imprimée** sur un cyclorama, et le logo est un solide posé au
milieu.

Ensuite, le scroll est une **orbite libre**. Un tour de la boucle est un tour
complet autour du glyph, qui reste l'axe de tout : à 45° les trois marches
arrivent pile de face (c'est là que le menu ira, un item par marche), à 225° on
est derrière.

**Deux pages, deux façons d'encrer le même solide.** `index.html` est la
version bouclée : faces verticales cobalt, faces horizontales papier. `v2.html`
est celle où le blanc n'est pas une couleur — voir « [v2 — une seule
matière](#v2--une-seule-matière) ». Tout le reste est partagé : même copie,
même géométrie, même orbite.

Reprise de la technique de
[cullenwebber/three-html-to-canvas](https://github.com/cullenwebber/three-html-to-canvas)
(HTML → SVG `foreignObject` → canvas → matériau projeté), avec quatre écarts
délibérés, expliqués plus bas.

---

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5180
npm run build
```

| Script | Ce qu'il fait |
|---|---|
| `npm run dev` | Vite, port 5180 |
| `npm run build` | build statique dans `dist/` |
| `npm run shoot` | frames déterministes de la boucle **+ le contrôle du repos** (voir plus bas). Nécessite `npm run dev` dans un autre terminal |
| `npm run shoot:v2` | pareil sur `v2.html`, avec le coin creux **vérifié** en plus |
| `npm run measure` | remesure la boîte encrée du glyph et la compare au SVG |
| `npm run bake` | recalcule ce que chaque face du solide voit de la pièce (~30 s) |
| `npm run curation` | rapatrie les 31 photos de la curation amatencio-photo dans `public/curation/` et écrit `public/curation.json`. Idempotent ; `-- --force` retélécharge tout |

`npm run dev` sert les deux pages : `/` et `/v2.html`.
`npm run shoot` accepte `--width 430 --height 930 --out tools/shots/narrow`.
`npm run bake` n'est à relancer que si le `.glb` change.

---

## Comment ça marche

Une **caméra projecteur** est un clone figé de la caméra de rendu, à sa pose de
repos. Le DOM (`#page`, hors écran) est rastérisé en texture, et cette texture
est projetée depuis ce projecteur sur le cyclorama. Tant que les deux caméras
coïncident, chaque surface affiche exactement le pixel que la page plate aurait
affiché à cet endroit : la scène **est** le document.

`uLitness` est la seconde moitié du tour. À 0, le résultat éclairé est jeté et
seule la couleur projetée survit — pas d'ombre, pas de dégradé, rien qui puisse
trahir une troisième dimension. Il monte à 1 en quittant le repos, et le monde
prend du volume. Le logo partage cet uniform : il passe de son aplat SVG exact à
du cobalt réfléchissant sur la même courbe.

### Le modèle de caméra : une orbite, pas une chorégraphie

Le scroll est branché **directement sur l'azimut**. Rien n'est scénarisé : on
tourne où on veut, la boucle Lenis est infinie, et tout le reste (élévation,
zoom, recentrage, passage de plat à éclairé) est fonction d'un seul nombre, la
distance au repos. Deux poses sur ce cercle portent tout le poids :

| Progress | Pose | Ce qui s'y passe |
|---|---|---|
| `0` | **repos** — azimut 45°, élévation 35,264° = asin(1/√3) | la seule pose où la projection s'aligne : la scène est une page plate |
| `0.125` | **marches** — azimut 90°, élévation 12° | les trois contremarches pile de face, empilées, séparées par les marches en blanc. C'est la vue du menu |
| `0.625` | **arrière** | le solide vu de dos |
| `0.2 → 0.875` | **la traversée** (v2) | juste après le menu, la ligne quitte l'orbite et passe dans le trou du solide — voir « La traversée du trou » |
| `0.62746` | **la porte** (v2) | le progress s'arrête là pendant 750vh : la caméra vient de franchir le plan de sortie et le couloir des Selected Works prend la route — voir « La porte, et le couloir » |

Ce sont des conséquences de la géométrie, pas des choix : les trois
contremarches du solide regardent toutes +X (mesuré : x = 0, +1, +2 aux hauteurs
y = +1, 0, −1), soit exactement 45° après l'axe iso.

Le mouvement est une **rotation rigide de la caméra autour du glyph**. À
progress 0 tous les termes valent zéro, donc elle se réduit à l'identité et la
caméra de rendu retombe sur celle du projecteur pose pour pose. C'est ça qui
garde l'image au repos identique à l'octet près.

### Le menu

`scene.stepAnchors()` rend la position à l'écran des trois contremarches, en
pixels CSS, plus un `facing` de 0 à 1 selon qu'on leur fait face ou non. Le menu
n'a donc aucun nombre de scroll en dur : il suit la géométrie.

```js
const { facing, steps } = three.scene.stepAnchors()
nav.style.opacity = facing
for (const s of steps) {
  const el = items[s.id]              // "step-1" | "step-2" | "step-3"
  el.style.transform = `translate(${s.x}px, ${s.y}px)`
  el.hidden = !s.onScreen
}
```

À 0.125 les trois ancres tombent sur la même verticale, à un tiers de hauteur
d'écart — une colonne de trois items. Sur `v2.html` c'est branché : **Agency**
sur la contremarche du haut, **Photography** au milieu, **Design** en bas
(`#step-menu` dans `v2.html`, collé à la géométrie chaque frame par
`main-v2.js`, cliquable dès que `facing > 0.5`).

### Les plongées

Cliquer un item ne navigue pas : ça **entre dans la marche**. Le scroll rend la
main (`lenis.stop()`), puis `Scene.startDive(step)` joue 2,1 s d'automatique :

1. **Le saut périlleux avant** — une rotation rigide de la caméra autour de la
   marche visée, du regard de la pose square-on jusqu'au nadir, sans roulis.
   Même construction que l'orbite elle-même, donc même garantie : à t = 0 c'est
   exactement la pose gelée, aucun raccord. Deux constructions plus « évidentes »
   (lerp de poses, blend de lookAt) ont été essayées et jetées : les deux
   laissaient l'escalier sortir du cadre à mi-course.
2. **Le recentrage pendant l'arc** — une caméra orthographique zoome autour du
   centre de l'écran, donc la marche y est amenée PENDANT la bascule, tant que
   le zoom est sage. Recentrer pendant la plongée perd la course : l'offset non
   encore résorbé est multiplié par le zoom qui suit (mesuré : NDC y 1,13 à
   mi-plongée, la marche au bord du cadre).
3. **La plongée** — le zoom est l'entrée (l'orthographique n'a pas de
   « plus près ») : 1,75 → 15, au carré sur l'horloge, une fois la marche
   centrée. Le dessus blanc de la marche avale le cadre.
4. **Le raccord** — `#dive-veil` fondu sur la fin, peint de la couleur du
   PREMIER frame de la destination, pour que l'arrivée soit un match cut :
   Agency → `#1e1e1e` (le faux VS Code du splash AAXLO qui s'écrit lui-même),
   Photography → blanc (le portfolio ouvre sur ALX / MTNC sur blanc — rien à
   changer). Puis `location.assign`. `prefers-reduced-motion` court-circuite
   tout et navigue directement.

### Et le retour

Le bouton « précédent » du navigateur ne recharge pas une page plate : il
**rejoue la plongée à l'envers**, jusqu'à ressortir de la marche face au menu.

Ça ne tient qu'à une chose : `#applyDive` est une **fonction pure de `t`**.
`animate()` reconstruit toute la pose d'orbite depuis la caméra de repos à
chaque frame *avant* d'appliquer la plongée, donc rien ne s'accumule. Faire
descendre `t` au lieu de le monter suffit — la caméra retrace exactement son
propre chemin. Une plongée qui aurait intégré son état (un lerp convergent vers
la cible, par exemple) aurait exigé une seconde animation écrite à la main, et
les deux auraient divergé à la première retouche.

Deux chemins, un seul enregistrement (`sessionStorage`, écrit au départ de la
plongée, consommé par le premier arrivé) :

| retour | ce qui se passe |
|---|---|
| **back/forward cache** | `pageshow` avec `persisted` : l'état JS est intact, la plongée est encore à `t = 1`, on la retourne. |
| **rechargement à froid** | Le voile est levé **synchronement**, avant que la scène ne soit prête (`ready: false`, voile déjà à 1) — sinon les premières frames montreraient la pose de repos, la page à plat, la seule chose que le retour ne doit pas montrer. |

Dans les deux cas l'orbite est épinglée à `ORBIT.STEPS` par `progressOverride`
le temps du rembobinage, puis le scroll récupère la caméra à `t = 0` — où la
plongée est l'identité, donc la reprise ne se voit pas — avec Lenis positionné
sur `limit × 0.125`, la position que l'orbite elle-même appelle « vue des
marches ». `history.scrollRestoration = "manual"`, sinon le navigateur restaure
son propre offset une frame plus tard et fait déraper la caméra.

Destinations dans `DESTINATIONS`, en tête de `main-v2.js` : Agency →
`https://www.aaxlo.com`, Photography →
`https://alexandrematencio.github.io/photo-portfolio`, Design → pas encore de
cible (le clic n'est pas câblé ; cette page EST le travail de design, jusqu'à
nouvel ordre).

### La traversée du trou (v2)

Juste après le menu, la ligne quitte l'orbite et passe dans le trou du solide
— et pour ce plan, la caméra cesse d'être orthographique. C'est **l'interlude
en perspective** : l'ortho ne sait pas dire « j'avance » (translater le long du
regard ne change rien à l'image, une sortie ne grossit jamais), donc pendant le
tunnel la caméra devient un œil. Le raccord est invisible par construction :
une caméra en perspective à distance D = H / (2·tan(fov/2)) cadre la même
image que l'ortho de hauteur de cadre H, à une parallaxe près qui meurt avec
le fov. Toutes les poses de l'interlude dérivent de cette formule
(pos = focus − dir·D) ; presser tan(fov/2) vers zéro fait CONVERGER la
perspective vers le cadre ortho, et les deux bascules se posent sur une
couture de rien.

Le film : l'orbite s'incline vers l'axe du conduit (le logo épinglé — viser
ailleurs fait glisser 18 % d'encre à l'écran, mesuré), la profondeur se
déverse dans l'image pendant que la bouche approche (le morph EST le
roulage), la traversée voit **la sortie en face, qui grandit** — c'est la
perspective qui parle, plus aucun zoom —, puis à la sortie la grue monte
au-dessus du solide dans l'air libre pendant que la perspective se draine
(le dolly-zoom à la Hitchcock, joué sur la route avant le demi-tour), et le
balayage du regard — azimut + élévation vers le regard VIVANT de l'orbite,
jamais un lerp de points — fait le tour du solide de loin, où tourner le
regard EST orbiter. La vue de dos, avalée par le raccourci, revient dans ce
survol. À `LAND` il n'y a rien à atterrir : l'image est déjà celle de
l'orbite du progress courant.

**Le juge est le flux optique, pas les courbes.** Toutes les métriques d'espace
monde peuvent être C1-parfaites pendant que l'image claque — une cible qui
frôle l'œil, un zoom à fort grossissement, un slerp qui jette le cadre.
`npm run flow` (tools/flow.mjs) échantillonne toute la boucle et mesure la
différence d'image par pas de scroll : la croisière est la médiane, chaque
excès est listé. Les leçons payées sont dans les commentaires de `JOURNEY`
(Scene.js) : balayer près du solide claque à 21-33× quel que soit le flanc ;
reculer le long de la route repasse par le conduit (28×) ; la grue par le
regard rase les marches (10-21×) — d'où la grue POSITIONNELLE, haut et vers
l'avant. Reste un transit à ~5,6× la croisière sur 1,5 % de boucle (le
panoramique de 166° est incompressible ; le reveal shippé de v1 tourne à
4×) : c'est le plafond accepté de la jauge, resserrable avec `--budget 3`.

Et parce que la seule façon honnête de ralentir un film piloté au scroll est
d'allonger la route, **v2 roule sur 1200vh** de voyage (contre 800 pour v1),
plus 750vh de plateau pour la galerie — 1950 en tout, inline dans v2.html.
Le repos aimante toujours légèrement (`#maybeSnap`, v2 seulement), et tout
reste une fonction pure du scroll : marche arrière gratuite.

### Le banking : la caméra prend ses virages (v2)

Quand la caméra tourne, elle **s'incline dans le virage**, comme un wagon sur
sa courbe. Deux virages sur cette étape, et deux seulement : ALIGN, où le
bezier quitte l'orbite et se pose sur l'axe du conduit, et SWEEP, le demi-tour
passager de 166° après la sortie. Le conduit est droit — le cap est constant
sur MORPH_IN et TRAVERSE — donc l'inclinaison y vaut exactement zéro, et le
couloir de la galerie hérite gratuitement d'un horizon d'aplomb à la porte.
L'orbite n'en a pas non plus : c'est la page au repos.

C'est une **fonction pure de h**, lue sur la route et jamais intégrée :

```
bank(h) = 30° × tanh( cap'(h) / 11 ) × win(h, [0, 0.03]) × win(1−h, [0, 0.03])
```

`cap'` est la différence centrée de l'azimut du regard (ε = 0,002 de l'étape),
et l'inclinaison est appliquée en tournant `WORLD_UP` autour du regard avant le
`lookAt`. `tanh` plutôt qu'un clamp : un clamp met un angle dans le roulis au
moment où le virage sature, et un angle dans le roulis est précisément ce que
tout ça sert à supprimer.

**Le produit vitesse × cap' du brief a été essayé et jeté, mesures à l'appui.**
Un passager ressent v²κ, donc la forme évidente est vitesse × taux de lacet.
Elle ne peut pas marcher ici, et la raison est le tour de force de la page :
toutes les poses de l'interlude dérivent de `pos = focus − dir·D`, donc la
vitesse monde de la caméra est surtout D qui bouge — et D bouge le long du
regard, ce qui est optiquement inerte. Mesuré sur l'étape : **151 246** unités
monde par unité de h en h = 0,30 (la téléportation ortho → perspective,
invisible à l'écran) et **8 293** en h = 0,88 (le drain qui recule). Multipliez
par le lacet : le SWEEP culmine à 385 000 contre 1 403 pour ALIGN, donc tout
`A_REF` qui donne à ALIGN une inclinaison visible **épingle tout le balayage à
30°** — un clamp déguisé en tanh — et un roulis de −30° se déclenche en
h = 0,30, au milieu d'une approche parfaitement droite. La seule composante
transverse tue l'artefact de 0,30 mais pas le drain : 73:1 quand même.

Or le film est paramétré par le **scroll**, et le scroll est l'abscisse
curviligne de cette page. Avec l'abscisse curviligne comme paramètre, la
vitesse vaut 1 par définition et v²κ se réduit à κ — le cap tourné par cran de
molette, c'est-à-dire la courbure de la route. C'est ce qui est implémenté.

`RATE = 11` est **calibré, pas choisi** : |cap'| mesuré sur toute l'étape vaut
0,000 partout dans le conduit, culmine à **8,655 rad** dans ALIGN (h = 0,26) et
**18,11 rad** dans SWEEP (h = 0,786). D'où un roulis mesuré de **−19,7°** au
pic d'ALIGN et **+27,85°** au pic de SWEEP — les signes sont opposés parce que
les deux virages le sont, ce qui est de la géométrie et pas un choix. Jauge :
médiane 3,705 → 3,816, pire pas 20,95 → 20,63 (5,65× → 5,41× la croisière),
plateau inchangé à 12,95 — la preuve que l'inclinaison ne franchit pas la
porte.

### La porte, et le couloir des Selected Works (v2)

Le conduit du logo s'arrête sur un plan de sortie. **Le couloir blanc commence
exactement là** et continue tout droit : même origine, même axe, même section
carrée, même ligne de roulage, construits dans le repère du glyph
(`boreFrame()`). Les deux volumes ne partagent pas un pouce cube, donc il n'y a
rien à fondre. On roule dans le cobalt, on franchit une porte, on roule dans le
papier quadrillé — la matière change là où la géométrie change.

C'est pour ça que **l'approche est rendue dans le z-buffer du logo**, avec sa
caméra de rendu et sans effacer la profondeur (`Three.#render`, passe
`through`). Depuis l'intérieur d'un tube convexe, le couloir ne peut se
projeter QUE dans le rectangle de sortie : il remplace exactement ce que ce
rectangle montrait — le cyclorama — et rien d'autre. La première version
faisait l'inverse (deux tunnels dans le même volume, fondus l'un dans l'autre,
profondeur jetée entre les passes) et ça ne pouvait pas se lire comme un
passage : c'était une double exposition.

Le plateau s'ouvre quand la caméra a **franchi la porte**, pas avant :
`PLATEAU` est résolu, pas choisi — `progressPastExit(0.1)` inverse l'easing de
`TRAVERSE` par dichotomie et rend `0.62746` (h = 0.63327 ; le plan de sortie
est croisé à h = 0.62691). Et la caméra du couloir **part à la vitesse du
conduit à cet endroit** : 14,3 largeurs de conduit par unité de h, soit 0,735
de la croisière du couloir, parce que `TRAVERSE` freine sur sa fin. La rampe
qui rejoint la croisière est intégrée en forme close, et la croisière est
résolue pour que le trajet fasse toujours exactement 18 largeurs (`travelOf`,
Gallery.js). C1 à la couture : ni la position ni la vitesse ne trahissent le
changement de scène.

La sortie est **blanche sur blanche** : sur les derniers 10 % du trajet le
treillis s'éteint et il ne reste que du papier ; sur les derniers 6 % du
plateau la scène du logo est rendue dessous (caméra à la porte, face au
cyclorama) pendant que l'opacité du papier tombe à zéro. Rien ne bouge à
l'écran, donc l'arrêt de la caméra pendant ce fondu ne se voit pas. En marche
arrière, le papier se lève, le treillis se rallume, on repasse la porte à
reculons dans le cobalt.

La jauge suit : `tools/flow.mjs` échantillonnait le progress, or le plateau est
750vh où le progress ne bouge pas — depuis que le couloir est visible pendant
l'approche, ça mettait côte à côte deux images séparées par 750vh et appelait
ça un pas (9× la croisière mesurés, pour une coupe qui n'existe pas). La jauge
parcourt maintenant le plateau sur son propre axe, avec le nombre de pas qui
fait **la même molette par pas** sur les deux axes : 251 pas, médiane 6,2,
pic 3,5× la croisière du voyage.

### Le texte suit sa visibilité (v2)

Plus de fenêtre de fade sur le scroll. La règle est physique : le texte est
imprimé sur la pièce, donc **il reste visible tant que son empreinte est dans
le cadre**, quelle que soit l'animation qui a bougé la caméra — l'orbite, le
tunnel, une plongée, la prochaine qu'on ajoutera.

`#buildPageFootprint` échantillonne une grille sur l'union des boîtes du titre
et du corps (relatives à `#page` : la copie DOM vivante est parquée hors écran,
ses coordonnées viewport mentent de tout l'offset de parking), lance chaque
point depuis le projecteur gelé sur le cyclorama — le trajet même de la
projection — et garde point d'impact + normale. Chaque frame, `#pageVisibility`
reprojette ces échantillons dans la caméra courante : dans le cadre et sur une
surface encore tournée vers l'œil → visible. Pleine opacité au-dessus d'un
quart de la zone en vue (rogner est le travail du cadre, pas d'un fondu),
noir sous six pour cent : ce plancher est l'anti-clignotement — un ou deux
échantillons qui frôlent le bord du frustum pendant le virage faisaient
cligner le fantôme du titre quatre fois (mesuré au balayage). La grille est en
13 × 9 : l'opacité est quantifiée au point de grille, et en 7 × 5 le fondu
descendait en marches visibles de 0,2. Les rayons ne sont lancés qu'au layout ;
par frame ce sont 117 projections matricielles, gratuites.

Conséquence assumée : à la vue du menu, le titre traîne en anamorphose sur le
sol derrière les items, à pleine opacité — c'est la règle demandée, et c'est le
concept de la page (« scroll — it isn't flat ») qui s'expose. `index.html`
garde sa fenêtre calibrée d'origine.

### Les fichiers

```
src/
  core/Three.js              boucle rAF, Lenis, resize débounce
  core/WebGLContext.js       renderer, canvas, espace colorimétrique
  scenes/Scene.js            caméras, composition, éclairage, matériaux
  scenes/Gallery.js          le couloir des Selected Works : la porte, le plateau
  utils/HtmlToCanvas.js      DOM → <canvas> via SVG foreignObject
  utils/collectDocumentCss.js aplatit le CSS et inline TOUTES les url()
  utils/ProjectedMaterial.js patch onBeforeCompile : la projection + uLitness
  utils/GlyphMaterial.js     le logo : aplat SVG ↔ cobalt réfléchissant
  utils/glyphLightBake.js    attache le bake à la géométrie (et refuse un bake périmé)
  utils/studioEnvironment.js le studio (plafond, pas de sol) construit à la main
  utils/utils.js             le modèle d'orbite + les ancres du menu
  main.js / main-v2.js       les deux points d'entrée : la règle d'encrage, un mot
tools/
  shoot.mjs                  frames déterministes + contrôle du repos
  flow.mjs                   la jauge de flux optique (voyage + plateau)
  curation.mjs               bake des photos de la curation dans public/
  measure-glyph-ink.py       la mesure qui fixe GLYPH_INK
  bake-glyph-light.py        ce que chaque face voit de la pièce → .light.json
```

---

## v2 — une seule matière

`v2.html`. Même page, même solide, une autre lecture de la lumière — celle avec
laquelle le logo a été dessiné.

### Ce que le SVG dit vraiment

`glyph-alxmtnc.svg` a **trois** valeurs, pas deux. Il y a le cobalt, il y a le
blanc, et il y a un `<path>` de plus, tout au début du fichier : `#2E3191` à 30 %
d'opacité, qui remplit le coin creux sous la marche du bas. Sur le papier, ça
compose `rgb(189, 190, 217)`.

Deux conséquences, et ce sont les deux corrections de cette version.

**Le blanc n'est pas une couleur.** Le solide est cobalt partout. Ce que le
fichier 2D montre en blanc, ce sont les faces qui prennent le plus de lumière,
au-delà du point de coupure — du négatif, pas de la peinture. La v1 le peignait :
faces horizontales papier, faces verticales cobalt. C'est juste à 99,1 %, et
c'est faux sur le principe.

**Le creux est éclairé par en dessous.** Pas par une lampe : par tout ce blanc
autour et en dessous, qui renvoie. C'est pour ça que ce coin est plus clair que
le cobalt qui l'entoure alors qu'il est le plus enfermé.

### Ce qui a été mesuré

`tools/bake-glyph-light.py` lance des rayons depuis le solide contre lui-même et
compte, pour chaque face, ce qu'elle voit de la pièce. Les contremarches, toutes
orientées `+X`, toutes identiques par ailleurs :

| contremarche | voit du ciel | voit du sol |
|---|---|---|
| marche du haut, `x = 0` | 0,51 | 0,21 |
| marche du milieu, `x = +1` | 0,51 | 0,25 |
| marche du bas, `x = +2` | 0,51 | 0,49 |
| **sous le surplomb, `x = −1`** | **0,06** | 0,29 |

Rien dans la géométrie ne distingue cette face des trois autres — même normale,
même matériau — sauf ce qui se tient devant elle. Le facteur sept sur le ciel,
c'est exactement le coin que le SVG peint en pâle. Alexandre l'avait dessiné ;
l'outil ne fait que le retrouver, ce qui veut dire que le shader le sélectionne
depuis le modèle et pas depuis une liste de coordonnées écrite à la main, qui
pourrirait au premier rebuild.

Le bake sort trois nombres. Le ciel et le sol **par sommet**, interpolés sur
chaque face : c'est ce qui donne à toute surface la chute douce vers le bas
qu'un cyclorama pose réellement sur les choses, et c'est la différence entre un
objet et un autocollant. Et un sélecteur **par face**, plat, pour le coin creux
— parce que le dessin est plat : le coin du SVG n'a aucun dégradé dedans.

### Ce qui a changé dans le rendu

Le rig d'éclairage est le **même** sur les deux pages. Il doit l'être : la pièce
*est* le papier, et le papier est `#FAFAF8` par définition, donc son exposition
n'est pas libre. Ce qui change est ailleurs, et tient en une phrase : **au repos,
le rendu physique retombe de lui-même sur les trois valeurs du logo, et hors du
repos chaque teinte est un reflet vivant** — le blanc des marches, la pâleur du
coin, tout est accroché au vecteur miroir et glisse avec le regard.

**Le plafond garde son miroir et perd sa lampe.** Sa radiance doit être très
au-dessus de 1 pour qu'une marche claque en blanc à travers le clearcoat, et
three verse cette même carte dans l'irradiance diffuse, où elle enterre toutes
les autres lumières et noie le solide au-delà du point de coupure. C'était ça, le
logo plat de la première tentative : le canal bleu du cobalt vaut déjà 1,0, donc
**toute** irradiance supérieure à l'unité colle toutes les faces sur la même
valeur. Dans three, `iblIrradiance` et `radiance` sont deux variables
distinctes ; une ligne au bon endroit ne touche que la première.

**Le coin pâle est devenu un vrai reflet.** La pièce a maintenant un sol —
blanc, lumineux — et le coin sous la marche du bas le réfléchit, au même angle
de Fresnel que tout le reste. Ce n'est plus un voile posé sur la face : c'est
une image dans le vernis, donc elle vit et meurt avec le point de vue. Un quart
de tour plus loin, la pâleur a glissé de la face et il reste du bleu à l'ombre —
exactement comme le blanc quitte les marches.

**Toutes les lampes vivent dans le ciel, donc chaque vertex ne les reçoit qu'à
hauteur du ciel qu'il voit.** Le ratio bake/normale (`_roomVis` dans
`GlyphMaterial.js`) pondère la key, le fill, l'hémisphérique et la
carte-en-lampe. Une contremarche exposée garde 98 % de sa lumière ; le coin, à
0,03 d'un possible 0,5, tombe à six pour cent — et la key ne peut plus **fuir à
travers le flou VSM** sous le surplomb, parce qu'elle est barrée par de la
géométrie lancée en rayons, pas filtrée dans une shadow map (fuite mesurée :
+17 de bleu sur le coin, sonde lumières coupées une à une).

**Une seule règle n'est pas de la physique, et elle est mesurée nécessaire.**
Tracer le miroir de la vue de repos contre le solide lui-même
(`scratchpad/mirror_probe.py`, jetable) : les faces avant et la contremarche du
bas réfléchissent **le même sol, sur 100 % de leur surface, au même angle** que
le coin. Aucune pièce physiquement cohérente ne rend le coin pâle ET les avants
cobalt — le dessin le fait quand même. Donc le sol ne se montre que dans les
faces que le bake déclare scellées du ciel (`aWell`). **La mesure choisit les
faces ; la lumière, elle, est celle de la pièce.**

---

## Les quatre écarts par rapport à la démo d'origine

**1. Caméra orthographique, pas perspective.** `brand/3d/README.md` établit que
`glyph-alxmtnc.svg` n'est pas un dessin « à la manière de » l'isométrie : c'est
la projection orthographique exacte du solide sur l'axe (1, 1, 1). Une caméra
perspective, à n'importe quelle focale, fait converger les arêtes parallèles et
le logo cesse d'être le logo. L'orthographique est la seule qui reproduise le
fichier vectoriel au lieu de lui ressembler.

**2. Le logo ne reçoit pas d'encre.** Il reste cobalt et occulte le texte, au
lieu de servir d'écran. C'est ce que demande le brief — le texte est *derrière*.

**3. Un seul glyph.** Il est le logo, il est la forme qui fait l'anamorphose, et
il est l'axe autour duquel la caméra tourne : le même objet fait les trois. Il
n'est jamais tourné — il y a un angle dans cette scène et il appartient au SVG.

**3 bis. Le décor est un cyclorama.** Sol, gorge et mur en une seule surface de
révolution, comme un fond infini de studio. Il faut une pièce dès lors que la
caméra fait le tour : un mur plat se met de profil au quart de tour et laisse le
visiteur dans le vide. La gorge n'est pas une coquetterie — un sol regarde en
l'air et prend toute la lumière, un mur regarde de côté et n'en prend que la
moitié ; bout à bout, la jointure trace une barre grise en travers du cadre.

**4. Zéro requête tierce.** Inter est auto-hébergé (`public/fonts/`) et inliné
en data-URI dans le SVG, Helvetica est une police système. Aucun appel réseau,
donc aucune question RGPD — la règle du brand book.

---

## Le contrôle qui compte

```
$ npm run shoot
rest frame
  uLitness        0
  paper           87.82 %
  ink              2.51 %
  cobalt           7.92 %
  largest stray    0.07 %  (125,134,251)
  PASS — byte-identical to the CSS.
```

Au repos, l'image WebGL doit être **identique à l'octet près** au CSS dont elle
est issue : `#FAFAF8`, `#0A0A0A`, `#0013FF`, et rien d'autre en quantité. Tout
le reste est du bord — antialiasing du texte, chanfrein de 0,012 du glyph — et
un bord est un liseré : aucune valeur intermédiaire ne doit peser. Le test porte
donc sur le **plus gros intrus**, pas sur leur somme : leur somme dépend de la
taille du viewport (un téléphone rend la même page avec proportionnellement plus
de bord), alors qu'un dérapage d'espace colorimétrique déplace tout le papier
vers **une** mauvaise valeur et se voit immédiatement.

Cette égalité **est** l'illusion. Elle se casse par accident, elle ne se voit
pas à l'œil, et elle a déjà attrapé une régression — la première de la liste
ci-dessous.

Sur `v2.html` il y a une quatrième valeur, et elle est **vérifiée**, pas
tolérée — puis un **second contrat** : la peau physique, forcée à `uLitness 1`
sous l'angle de repos, doit retomber sur les valeurs du logo toute seule.

```
$ npm run shoot:v2
  cobalt           7.65 %
  bounce           0.25 %
  wedge            0.25 % (expected 0.18 .. 0.35 %)
  PASS — byte-identical to the CSS.

lit frame (uLitness forced to 1, rest angle)
  wedge     rgb(188,189,233)  target rgb(189,190,217) ±30  ok
  front     rgb(0,22,255)     target rgb(0,19,255)    ±45  ok
  riser     rgb(0,19,255)     target rgb(0,19,255)    ±45  ok
  tread     rgb(255,255,255)  target rgb(250,250,248) ±20  ok
  PASS — the room paints the logo on its own.
```

La fenêtre du coin n'est pas choisie, elle est calculée : le coin creux fait
1,44 % du SVG, l'encre du logo couvre 18,1 % d'un cadre 1600 × 1000, et
0,0144 × 0,181 = 0,26 %. Tomber dessus, c'est la preuve que le reflet a trouvé
**la** face et pas une autre — une face voisine aurait une autre surface.

Le second contrat est celui qui autorise tout le reste : c'est parce que le
rendu physique atterrit déjà sur le logo que le fondu depuis la peau plate est
invisible, et qu'à partir de là chaque teinte peut être un reflet qui bouge.
Les sondes sont des centroïdes de faces en espace objet, projetés par la
`restCamera` — le point du coin est décalé dans son triangle visible
(`z − y ≥ 1,5`, tracé contre le surplomb). Le seul écart assumé : les marches
mesurent 255 au lieu de 250 — le blanc y est un claquage spéculaire, il ne
connaît pas le papier.

Le placement du glyph est vérifié dans la même passe : NDC (0.44, 0.08), et
0,46 de la hauteur du cadre, mesuré sur la silhouette **encrée**.

---

## Pièges payés

**Le décodage sRGB en double.** Une `CanvasTexture` déclarée `SRGBColorSpace`
est envoyée au GPU en `SRGB8_ALPHA8` : le sampler décode en matériel,
`texture2D()` rend déjà du linéaire. La décoder une seconde fois dans le shader
ne casse rien visiblement — le papier passe de `#FAFAF8` à `#F4F4EF` et l'encre
de `#0A0A0A` à `#010101`. Ça se lit comme « un peu terne », pas comme un bug.
C'est ce qui lui permet de survivre à une relecture.

**La texture qui n'est jamais réallouée.** Redimensionner le `<canvas>` d'une
`CanvasTexture` sans appeler `dispose()` laisse l'allocation GPU à l'ancienne
taille. three tente alors un upload partiel : `GL_INVALID_VALUE`, *"Offset
overflows texture dimensions"*, la texture reste vide, et la scène se rend
parfaitement en n'affichant **rien**. Symptôme : la géométrie est là, le texte
a disparu, et la console ne dit rien d'autre qu'un avertissement WebGL noyé.

**`v = 0` d'une equirect, c'est le NADIR.** three échantillonne une carte
d'environnement en `v = 0.5 + asin(dir.y) / PI`, et une `DataTexture` n'est pas
retournée : la première ligne est donc le bas. Construire le studio à l'endroit
inverse le rig en silence — les contremarches virent au blanc et les marches au
cobalt, soit le logo retourné comme un gant.

**`studio-white-env.hdr` ne contient pas de studio.** Décodé, le fichier livré
dans `brand/3d/` vaut **0,100 uniformément dans toutes les directions**
(plafond 0,0983 · horizon 0,1000 · sol 0,1018). C'est la valeur du *monde*
Blender pour les rayons d'éclairage — « blanc à 0,10 », exactement ce que dit
son propre README — et le monde n'est pas ce qui a éclairé le rendu : le
plafond était un **objet lumineux**, et les objets lumineux ne survivent pas à
un export `.hdr`. Un environnement parfaitement uniforme ne peut réfléchir que
du gris plat, donc avec lui les marches ne blanchissent jamais et le papier
tourne gunmetal dès que la scène est éclairée. Le fichier n'est pas cassé ; il
n'est simplement pas ce qu'on lui demande d'être. Le rig est reconstruit dans
`src/utils/studioEnvironment.js`, à partir de la description qui, elle, est
juste : *« tout ce qui est brillant doit venir d'en haut, et rien d'autre »*.
→ **À arbitrer avec Alexandre : `brand/3d/README.md` affirme le contraire.**

**Une pièce se construit à l'envers.** `LatheGeometry` prend sa normale du sens
de parcours du profil : construit de bas en haut, le sol regarde vers le bas et
le mur vers l'extérieur — un solide ordinaire. Profil inversé, les normales
pointent vers l'intérieur : une pièce. Ce qui compte parce que la caméra
orthographique est **toujours dehors** — l'œil doit se placer plus loin que la
pièce n'est large, sinon sa moitié arrière passe derrière le plan proche. Le mur
proche doit donc être une face arrière et se faire éliminer pour laisser passer
le regard. En `DoubleSide` la pièce se referme, on rend son extérieur, et il ne
reste que du papier : plus de logo du tout.

**Le projecteur ne bouge pas, donc la page finit par s'effacer** — mais pas
une seconde avant que la géométrie ne l'emporte. Depuis une autre pose, la
diapositive atterrit en fragments de typo géants et gauchis ; près du repos
c'est précisément la révélation, un quart de tour plus loin c'est du détritus
juste derrière le menu.

**Où commence le fondu n'est pas une valeur de goût.** Rendue à pleine opacité
sur toute l'approche, l'encre sombre encore à l'écran fait 2,78 % (progress
0,03), 2,65 (0,05), 2,03 (0,07), 1,21 (0,09), 0,77 (0,11) : le recentrage et le
zoom 1,75× emportent le texte hors cadre tout seuls, et à 0,09 il ne reste que
des fragments étirés du titre. Le fondu part donc à 0,17 de distance au repos —
progress 0,085, la dernière pose où la page se lit — et se termine à 0,24,
progress 0,12, juste avant que les marches ne se mettent de face.

Il partait de 0,12, soit progress 0,06 : l'opacité était déjà tombée à 0,15 à
0,07, là où le titre est encore grand et parfaitement lisible. On ne laissait
pas la page derrière, on la retirait.

**La caméra tourne AUTOUR DU LOGO, pas autour de l'origine.** C'est une
rotation rigide : à l'image-clé zéro elle se réduit à l'identité, donc la caméra
de rendu retombe exactement sur celle du projecteur — pose pour pose, pas à peu
près — et l'image au repos reste identique à l'octet près. Orbiter l'origine
puis recadrer au pan ne peut pas le promettre. Bénéfice secondaire : le logo est
à 0,44 en NDC, loin du centre ; tourner autour de l'origine le jetait d'un bord
à l'autre du cadre.

**Le zoom ne descend jamais sous 1.** La page n'existe que dans le tronc du
projecteur ; tout ce qui est hors de ce cône est du papier vierge. Reculer fait
forcément entrer dans le cadre plus de monde que la diapositive n'en couvre — à
0,6 il restait la moitié de l'écran en blanc. S'approcher est toujours sûr,
reculer ne l'est jamais : le zoom de voyage est à 1,75.

**Deux rampes, volontairement décalées.** Celle du passage plat → éclairé part
en premier et vite, pendant que la caméra n'a presque pas tourné : c'est la
révélation, et elle veut se produire là où la page est encore dans le cadre. Sur
la même courbe que le voyage, elle est finie en deux pour cent de scroll, avant
que quiconque l'ait vue. Celle du voyage — élévation, zoom, recentrage — part
plus tard et doit être terminée à 0,125, où les marches arrivent de face.

**Le signe de l'élévation.** Faire tourner l'offset de la caméra autour de son
propre axe droit d'un angle **positif** la fait descendre. Écrire là le
changement signé d'élévation (négatif, puisqu'on descend) l'a fait monter à 58°,
d'où les marches vues de dessus : les girons devenaient plus larges que les
contremarches et le menu s'inversait.

**Deux surfaces aux expositions opposées ne partagent pas une carte.** Le
plafond du studio doit dépasser largement 1 pour qu'une marche sature en blanc.
Une `scene.environment` unique aussi violente cuit le papier : le fond et le
décor deviennent une feuille plate et tous leurs plis disparaissent. Le studio
est donc accroché au matériau du glyph (`material.envMap`), et le papier est
éclairé par l'hémisphère et les deux directionnelles, ce qu'il veut.

**Pas d'`AmbientLight` dans ce rig.** L'ambiante éclaire toutes les directions à
la fois, ce qui est exactement le sol lumineux que la règle interdit. Elle
valait 0,55 ici et elle a viré les marches au périwinkle. La bonne forme est une
`HemisphereLight` blanche en haut, noire en bas.

**Le logo autocollant.** Une fois éclairé, le solide sortait comme un aplat
bleu sans le moindre modelé, quel que soit l'angle. Ce n'était pas l'éclairage :
`#0013FF` est une valeur d'**encre sur papier**, pas un albédo. Comme albédo son
canal bleu vaut 1,0, donc dès que l'irradiance dépasse l'unité toutes les faces
saturent sur la même valeur et il ne reste rien à voir. Le coupable principal
était l'environnement : plafond à 42 pour que les marches claquent, versé tel
quel dans le diffus. Séparer les deux (`envDiffuse`) rend le modelé.

**Un bake par face n'est pas un bake.** Première version de
`bake-glyph-light.py` : un rayon par triangle, depuis son centre, moyenné sur
les sommets. Chaque face ressortait d'une seule valeur, donc l'objet restait du
papier découpé. Une face verticale près du sol en voit énormément à son pied et
beaucoup moins à sa tête ; c'est ce dégradé qui fait la photo. Par sommet, donc
— sauf le sélecteur du coin creux, qui doit rester plat, parce que par sommet
ses coins du bas voyaient par-dessus le surplomb (0,25 contre 0,06 en haut) et
le coin sortait à moitié cobalt, avec la couture en diagonale.

**Une shadow map floue fuit sous les surplombs.** La key light déposait +17 de
bleu sur le coin creux, à travers le flou VSM (`radius 5`) — mesuré en coupant
les lampes une à une dans la page. Aucune valeur de biais ne règle ça proprement
quand l'interstice fait une unité. La sortie n'était pas de durcir l'ombre (elle
est juste partout ailleurs) mais de barrer la lumière par la géométrie : les
lampes vivent dans le ciel, le bake dit combien de ciel chaque vertex voit,
`_roomVis` fait le produit. Une ombre lancée en rayons ne fuit pas.

---

## Reste à faire

- **Laquelle des deux pages part en prod.** Elles coexistent pour l'instant :
  `/` et `/v2.html`. Si la v2 gagne, `index.html` devient un point d'entrée avec
  `shading: "one-material"` et `v2.html` disparaît.
- **`#BDBED9` n'a pas de nom.** C'est la troisième valeur du logo, lue dans le
  premier `<path>` du SVG (`#2E3191` à 30 % sur le papier), et elle vit
  aujourd'hui dans `BOUNCE`, en haut de `Scene.js` — uniquement dans la peau
  plate désormais : à `uLitness 1`, c'est la pièce qui produit la valeur. Elle mérite une ligne dans
  le brand book — proposé, pas pris : ce fichier ne s'édite pas sans arbitrage.
- **Design n'a pas de destination.** Le label est sur sa contremarche, la
  plongée existe, le clic n'est pas branché. À décider : cette page elle-même,
  une page dédiée, ou rien.
- **`/lenia.html` n'existe pas encore.** Le nouveau texte de `v2.html` fait de
  LENIA un lien (« running live within this website ») ; le POC tourne, la page
  reste à faire. Tant qu'elle n'existe pas, le lien mène sur un 404 de dev —
  acceptable en atelier, pas en prod.
- **Deux retouches du nouveau texte à valider** (typos probables corrigées au
  passage, à confirmer par Alexandre) : « interact with one *another* » pour
  « one other », et « entrepreneurship *are* two others » pour « and two
  others ».
- Le texte v1 (`index.html`) reste l'ancien, mot pour mot : cette page est
  bouclée.
- **Vue des marches, deux réglages** si elle ne tombe pas juste : `EL_TRAVEL`
  (12°) fixe l'épaisseur des filets blancs entre les bandes, `ZOOM_TRAVEL`
  (1,75) le cadrage. Pile à 90° d'azimut les trois contremarches s'alignent en
  colonne parfaite ; quelques degrés de biais rendraient l'escalier lisible en
  profondeur, au prix de bandes de largeurs inégales.
- Le fond est `#FAFAF8` (`--color-bg` du brand book), pas `#FFFFFF`. Si le blanc
  pur est voulu, c'est une constante à changer dans `src/style.css` **et** dans
  `PAPER` de `src/scenes/Scene.js` — les deux doivent rester d'accord, sinon le
  contrôle du repos tombe.
- Le vide vertical entre le titre et la colonne de texte est volontaire (il fait
  contrepoids au glyph). Il se resserre en une ligne : `.copy { margin-top }`
  dans `src/style.css`.
