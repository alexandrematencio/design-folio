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
repos. Le DOM (`#page`, sous le canvas) est rastérisé en texture, et cette texture
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
| `0.63388` | **la porte** (v2) | le progress s'arrête là pendant 592vh : la caméra vient de franchir le plan de sortie et le couloir des Selected Works prend la route — voir « La porte, et le couloir » |

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
perspective qui parle, plus aucun zoom, et l'œil est sur l'axe du conduit, donc
ce carré est centré du parking jusqu'au couloir (voir « La porte » plus bas) —,
puis à la sortie la grue monte
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
l'avant. Reste un transit à **5,80×** la croisière sur 1,5 % de boucle (le panoramique
de 166° est incompressible ; le reveal shippé de v1 tourne à 4×) : c'est le
plafond accepté de la jauge, resserrable avec `--budget 3`. `--accel` ajoute la
seconde différence — voir « L'amortissement » plus bas.

Et parce que la seule façon honnête de ralentir un film piloté au scroll est
d'allonger la route, **v2 roule sur 1200vh** de voyage (contre 800 pour v1),
plus 592vh de plateau pour la galerie — 1792 en tout, inline dans v2.html.
Le repos aimante toujours légèrement (`#maybeSnap`, v2 seulement), et tout
reste une fonction pure du scroll : marche arrière gratuite.

### Le banking : la caméra prend ses virages (v2)

Quand la caméra tourne, elle **s'incline dans le virage**, comme un wagon sur
sa courbe. Deux virages sur cette étape, et deux seulement : ALIGN, où le
bezier quitte l'orbite et se pose sur l'axe du conduit, et SWEEP, le demi-tour
passager de 166° après la sortie. *(Depuis « Le chemin de la caméra », plus
bas, seul SWEEP s'incline encore, et il tourne à gauche : ALIGN est le virage
de l'orbite qui s'éteint, et l'orbite ne s'incline pas.)* Le conduit est droit — le cap est constant
sur MORPH_IN et TRAVERSE — donc l'inclinaison y vaut exactement zéro, et le
couloir de la galerie hérite gratuitement d'un horizon d'aplomb à la porte.
L'orbite n'en a pas non plus : c'est la page au repos.

C'est une **fonction pure de h**, lue sur la route et jamais intégrée :

```
bank(h) = 30° × tanh( cap'(h) / 11 ) × win(h, [0, 0.03]) × win(LAND−h, [0, 0.03])
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
**18,11 rad** dans SWEEP (h = 0,786). D'où un roulis mesuré sur la caméra de
rendu de **19,8°** au pic d'ALIGN (h = 0,260) et **29,0°** au pic de SWEEP
(h = 0,795) — de signes opposés parce que les deux virages le sont, ce qui est
de la géométrie et pas un choix. Jauge : médiane 3,705 → 3,816, pire pas
20,95 → 20,63 (5,65× → 5,41× la croisière), plateau inchangé — la preuve que
l'inclinaison ne franchit pas la porte.

**La fenêtre de sortie se ferme sur `LAND`, et pas sur la fin de l'étape** —
c'est le bug que la jauge d'accélération a trouvé. Écrite `win(1−h, …)` elle ne
se fermait jamais : à partir de `LAND` (h = 0,96) c'est la caméra ortho de
l'orbite qui dessine, et elle n'a aucune inclinaison. Or le balayage, une fois
posé sur le regard vivant de l'orbite, lit toujours un virage — celui de
l'orbite, 4,24 rad par unité de h — et s'incline dedans. Mesuré : **8,2° de
roulis encore debout sur la dernière frame en perspective**, zéro sur la
suivante. Un pas de **17,1** sur la jauge de flux contre 1,1 de part et d'autre,
4,2× la croisière : le plus gros à-coup de toute l'étape, et aucune courbe
n'aurait pu le lisser puisque c'était une porte qu'on avait oublié de fermer.
Fenêtre fermée sur `LAND`, le même pas retombe à **1,18**.

### L'amortissement : mesurer l'accélération, pas la vitesse (v2)

Alexandre a signalé « deux mouvements rugueux, comme s'il n'y avait pas
d'amortissement », sans dire lesquels. La jauge de flux ne pouvait pas les
trouver : elle mesure la **vitesse** du film et le budget était tenu. Alors
`tools/flow.mjs --accel` ajoute la **différence de cette différence** — combien
le flux change d'un pas au suivant, c'est-à-dire l'accélération de l'image — et
sort les huit pics, étiquetés par la phase où ils tombent (pics et pas
échantillons : un moment rugueux fait plusieurs pas de large, et un tri brut
dépenserait tout le tableau dessus). Lancée avant d'avoir touché à quoi que ce
soit, elle a nommé les deux :

| # | Avant | ×croisière | Après | ×croisière |
|---|---|---|---|---|
| 1 | LAND, h 0,967 | **3,96** | TRAVERSE, h 0,615 | 2,08 |
| 2 | TRAVERSE, h 0,604 | **3,81** | plateau, t 0,341 | 1,31 |
| 3 | TRAVERSE, h 0,526 | 2,03 | plateau, t 0,380 | 1,26 |
| 4 | plateau, t 0,388 | 1,30 | TRAVERSE, h 0,511 | 1,23 |
| 5 | plateau, t 0,552 | 1,27 | plateau, t 0,288 | 1,06 |
| 6 | MORPH_IN, h 0,304 | 1,02 | plateau, t 0,678 | 1,06 |
| 7 | plateau, t 0,788 | 0,99 | plateau, t 0,769 | 0,93 |
| 8 | plateau, t 0,296 | 0,86 | plateau, t 0,433 | 0,92 |

Les deux gros ont disparu. Ce qui reste en tête est le conduit qui se rue vers
l'embrasure — à vitesse constante, l'écoulement optique d'un tunnel croît comme
l'inverse de la distance au plan de sortie, donc c'est de la perspective et pas
une couture. Les lignes « plateau » sont les **photographies qui passent** : la
caméra du couloir avance maintenant à vitesse rigoureusement constante, donc
toute accélération mesurée là-bas est du contenu, pas du mouvement. Elles
montent un peu parce que le couloir est parcouru 20 % plus vite en molette.

**1. Le quintique partout dans le voyage.** `smoothstep` est C1 : vitesse nulle
aux bords, accélération qui saute de 0 à ±6. `smootherstep` (6t⁵ − 15t⁴ + 10t³)
tue aussi la seconde dérivée. Il est **ajouté à côté** dans `utils.js`, jamais à
la place : `index.html` est figé et partage ce fichier. `win()`, `traverseDepth`,
`GAZE_IN`, `STITCH`, les fenêtres du banking et la grue passent au quintique ;
l'orbite et le reveal de v1 gardent leur cubique. Ça se paie : la pente maximale
d'un quintique vaut 1,875 contre 1,5, donc chaque fenêtre gagne un quart de
vitesse de pointe — le pire pas de la jauge de flux passe de 20,6 à 23,2, soit
5,80× la croisière, sous le budget de 6 mais avec moins de marge qu'avant.

**2. La porte sans freinage.** La traversée était **une seule courbe en S** sur
toute sa longueur : la caméra s'arrêtait presque à la bouche (0,016 unité monde
par pas de 60 px de molette contre 0,319 au milieu — 5 % de la vitesse de
pointe), repartait, puis levait le pied avant la porte (0,136) pendant que le
couloir, lui, réaccélérait de 0,74 à 1 sur ses premiers 10 %. Deux changements
de signe de l'accélération, dont un pile dans l'embrasure.

Maintenant c'est trois morceaux : `MORPH_IN` accélère depuis le parking et
**arrive à la croisière** (le cadre à la bouche est piloté par une courbe qui a
une pente d'arrivée imposée, `rampTo` dans Scene.js — le fov, lui, garde sa
fenêtre plate aux deux bouts, sinon la perspective prendrait un angle) ; la
traversée roule **à plat** de la bouche jusqu'à la porte ; le frein n'arrive
qu'**après** la porte, derrière le visiteur, face au cyclorama blanc où rien ne
bouge. `CRUISE_UNTIL` est résolu, pas réglé : `avant / (avant + 2 × après)`, ce
qui pose le genou exactement sur la porte.

Mesuré, marche du scroll par pas constants de 60 px à travers la couture :
**0,2219 unité monde par pas dans le conduit, 0,2228 dans le couloir** —
rapport 1,004, plat d'un bout à l'autre. Avant : 0,0156 → 0,3185 → 0,1364 →
0,1875, un rapport de 20,4 entre le pire et le meilleur pas de la même
traversée. Marche arrière : les mêmes positions **au bit près** (écart maximal
0,000e+0 sur 69 arrêts), ce qui est la seule chose qu'on peut demander à une
fonction pure du scroll.

**3. La porte que le banking avait oublié de fermer** — voir la section
précédente : 8,2° de roulis abandonnés à la bascule ortho, un pas à 17,1.

**Essayé et jeté.** Le premier suspect pour le pic de `LAND` était la parallaxe
résiduelle de la caméra plate : à `FOV_FLAT = 0,5°` l'œil dérivé est à 655
unités, la pièce en fait 19 de profondeur, donc le mur du fond est dessiné 0,3 %
plus petit qu'en orthographique — et c'est sur ce mur qu'est imprimé le texte.
Descendu à 0,15° (avec le plan proche relevé pour que le z-buffer suive), le pas
mesurait **17,2 au lieu de 17,1** : rigoureusement rien. Reverti. L'élargissement
de l'ε du banking (0,002 → 0,01) proposé au brief n'a pas été fait non plus :
plus aucun pic ne tombe au bord d'un virage, donc il n'y avait rien à filtrer.

**Lenis n'a pas été touché.** `lerp: 0.075` est le lissage temporel du scroll ;
les à-coups étaient dans les courbes, pas dans la molette, et le baisser aurait
ralenti tout le site, repos compris.

### La porte, et le couloir des Selected Works (v2)

Le conduit du logo s'arrête sur un plan de sortie. **Le couloir blanc commence
exactement là** et continue tout droit : même origine, même axe, même section
carrée, même ligne de roulage — qui est l'axe lui-même —, construits dans le
repère du glyph (`boreFrame()`). Les deux volumes ne partagent pas un pouce
cube, donc il n'y a rien à fondre. On roule dans le cobalt, on franchit une
porte, on roule dans le papier quadrillé — la matière change là où la géométrie
change.

**L'œil roule sur l'axe, et il y est déjà au parking.** Il tenait 0,15 en
dessous, pour que le point de fuite passe au-dessus de la route comme au
volant. Bon pour une route, faux pour celle-ci : le couloir est la même section
carrée prolongée, donc un œil bas est un œil décentré dans un cadre dont le
sujet EST un carré — et il faut bien qu'il remonte au milieu à un moment. Ce
rattrapage prenait les premiers 10 % du couloir, et c'était le seul mouvement
qu'on pouvait prendre le couloir à faire. `RIDE_DROP` vaut zéro ; `RECENTRE` et
son terme `rise` n'existent plus.

Ce qui se mesure, à P : l'écart entre la caméra du voyage et le point analytique
`ride(traverseDepth(h))` vaut **0** unité monde (pas « petit » : zéro), et la
distance de l'œil à l'axe du conduit vaut zéro aussi — à la porte comme sur tout
le couloir, t = 0,001 à 0,999. Avant, c'était 0,183 unité monde à la porte,
encore 0,120 à t = 0,05 et 0,008 à t = 0,1 : la remontée était bien là où
Alexandre l'a vue. Au pixel, sur la frame de porte p = 0,5915, les arêtes haute
et basse du carré de sortie tombent au même nombre de pixels du centre du cadre
— **353,30 px** de part et d'autre, asymétrie 0,00 px — contre **530,65 et
285,74 px** avant, soit 245 px d'écart, un quart de la hauteur de l'image. (Le
353 était 408 juste après ce premier passage : la refonte du pacing, juste
au-dessus, recule un peu la caméra à ce progress-là. Elle ne touche pas à la symétrie.)
Dans le couloir à t = 0,02, les dix premières traverses du treillis relevées sur
la colonne centrale tombent à **0,0 px** de leurs jumelles d'en face, contre des
écarts alternés jusqu'à 15,5 px avant.

Tout ce qui en dérive a suivi sans une retouche — la ligne de roulage n'ayant
bougé que perpendiculairement à la route, `PLATEAU`, `rideRate(P)` et
`SEAM_SPEED` sont sortis inchangés de ce premier passage. C'est le second, celui
du pacing, qui les a bougés.

C'est pour ça que **l'approche est rendue dans le z-buffer du logo**, avec sa
caméra de rendu et sans effacer la profondeur (`Three.#render`, passe
`through`). Depuis l'intérieur d'un tube convexe, le couloir ne peut se
projeter QUE dans le rectangle de sortie : il remplace exactement ce que ce
rectangle montrait — le cyclorama — et rien d'autre. La première version
faisait l'inverse (deux tunnels dans le même volume, fondus l'un dans l'autre,
profondeur jetée entre les passes) et ça ne pouvait pas se lire comme un
passage : c'était une double exposition.

Le plateau s'ouvre quand la caméra a **franchi la porte**, pas avant :
`PLATEAU` est résolu, pas choisi — `progressPastExit(JOURNEY.DOOR_OVER)` inverse
le pacing de `TRAVERSE` par dichotomie et rend `0.63388` (h = 0.64279), qui est
exactement le genou où la traversée arrête de rouler à plat et commence à
freiner. Et le couloir ne « rattrape » plus rien : le conduit tient sa croisière
jusque dans l'embrasure, et `GALLERY.VH` est résolu pour que le couloir tienne
la même — 17 largeurs de conduit à 34,43 largeurs par unité de progress font
`1200 × 17 / 34,43` = 592,5vh, arrondis à **592**. `SEAM_SPEED` vaut 0,9992 :
0,1 % d'écart, loin sous un pas de la jauge de flux. Il n'y a donc
plus de rampe du tout, `travelOf` a disparu et le trajet vaut `travel = t`. Ni
la position ni la vitesse ne trahissent le changement de scène, aux deux
coutures.

La sortie est **blanche sur blanche** : sur la dernière largeur de conduit le
treillis s'éteint et il ne reste que du papier ; sur les trois derniers quarts
de largeur la scène du logo est rendue dessous (caméra à la porte, face au
cyclorama) pendant que l'opacité du papier tombe à zéro. Ces deux mesures sont
en largeurs de conduit, plus en fractions du trajet — voir « Le fond du tunnel
se voit depuis l'entrée » plus bas pour ce que ça a changé. Rien ne bouge à
l'écran, donc l'arrêt de la caméra pendant ce fondu ne se voit pas. En marche
arrière, le papier se lève, le treillis se rallume, on repasse la porte à
reculons dans le cobalt.

La jauge suit : `tools/flow.mjs` échantillonnait le progress, or le plateau est
592vh où le progress ne bouge pas — depuis que le couloir est visible pendant
l'approche, ça mettait côte à côte deux images séparées par tout le plateau et appelait
ça un pas (9× la croisière mesurés, pour une coupe qui n'existe pas). La jauge
parcourt maintenant le plateau sur son propre axe, avec le nombre de pas qui
fait **la même molette par pas** sur les deux axes : 198 pas, médiane 6,93,
pic 3,52× la croisière du voyage.

### Le fond du tunnel se voit depuis l'entrée, et la sortie suit la dernière photo (2026-09-09)

Deux plaintes sur une capture d'écran prise à progress 0,44 — le solide de
face, la bouche du conduit ouverte, et **rien dedans** : un carré de papier.
Un visiteur qui roule vers un trou doit savoir qu'il mène quelque part, sinon
la curiosité meurt avant la porte.

**Le brouillard était accroché à l'œil.** Le brouillard de three est une
distance à la caméra, et pendant l'approche la caméra est encore à quatre à
huit largeurs de conduit de la porte : mesuré de là, tout le couloir était
au-delà de `FOG[1]` et le rectangle de sortie restait une feuille de papier
depuis le parking jusqu'à mi-conduit (progress 0,55). Le couloir était bien
dessiné dans le z-buffer du logo depuis la fin de la première passe — mais
noyé. La bande de brouillard glisse maintenant de la distance œil-porte
(`#fogFrom` dans Gallery.js) : le couloir s'embrume **comme vu depuis la
porte**, le treillis et les premiers rangs apparaissent au fond du tube de
cobalt dès que la perspective s'ouvre, et le glissement s'annule pile à la
porte, où la bande redevient celle du plateau. Mêmes nombres, donc aucune
couture, dans les deux sens.

**Deux écrans de rien après la dernière photo.** Mesuré sur les frames : la
dernière photo quittait le cadre vers t = 0,87 du plateau, puis 81vh de
treillis vide et de voile, puis encore ~100vh de ciel gris (progress 0,634 →
0,72) avant que l'escalier entre dans le cadre. Trois causes, trois réglages :

| Avant | Après | Où |
|---|---|---|
| `TAIL` 6 cellules (1,5 largeur après le dernier rang) | 2 cellules | Gallery.js |
| `OPEN` / `VEIL` en fractions du trajet (10 % / 6 %) | 1 largeur / 0,75 largeur, convertis une fois | Gallery.js |
| couloir 18 largeurs → plateau 625vh | 17 largeurs → **592vh**, re-résolu | Gallery.js, v2.html |
| balayage de sortie en fenêtre smootherstep plate | chargé sur sa partie vide : `SWEEP_EMPTY` 0,37 du virage en `SWEEP_EMPTY_OVER` 0,2 de la fenêtre | Scene.js |

Le balayage regardait le vide pendant son premier tiers (l'œil sort du conduit
face au cyclorama ; l'escalier n'entre qu'à wS ≈ 0,37), et le pire était que
le transit de l'escalier tombait à u = 0,5, le **pic** de la smootherstep
(1,875× sa moyenne). Le virage est maintenant deux pièces : une quintique
sur la partie vide, à pente ET courbure nulles au départ (une cubique
seulement plate au départ faisait un à-coup de 10,3 à la couture, deuxième
pire endroit du trajet — mesuré, puis corrigé), raccordée C2 à une Hermite
cubique sur l'escalier, plate à l'arrivée comme avant. Résultat à la jauge :
transit de l'escalier **15,3 → 9,8**, partie vide 1,3 → 9,8 (budget 25),
pire à-coup du balayage 6,6 (1,6× cruise, sous celui de la porte à 11,6 qui
préexistait). `PASS` sur toute la boucle, contrôle du repos inchangé.

Ce que le visiteur voit : dernière photo hors cadre vers t = 0,92 (41vh de
couloir nu au lieu de 81), frein 14vh, et l'escalier revient à progress 0,67
au lieu de 0,72 — environ 100vh entre la dernière photo et le retour du
solide, contre 185 avant.

**Deux repères, même librairie.** La flèche de sortie est le `ArrowUp` de
lucide, encre `#0A0A0A`, imprimée à plat sur le sol deux cellules après le
dernier rang (le sol y est libre : le dernier rang est au plafond et sur la
paroi +x), avec la base d'une photo de sol — son « haut » est +z, donc elle
pointe vers la porte. Texture SVG → data URL rasterisée à 256 px, gardée
entre deux rebuilds ; elle survit à l'extinction du treillis et part avec le
papier sous le voile. Et au frame 0, à froid, la souris outline de lucide
(`Mouse`, 26 px, trait 1,5, même flottement 2,4 s que la cue de la hero
d'amatencio-photo — qui, elle, est un `ChevronDown`) remplace la légende
« Scroll — it isn't flat » : hors de la page projetée, en DOM fixe, visible
seulement pour une arrivée à froid au repos, retirée au premier scroll et
jamais pour un retour de plongée ni sous un outil. `src/utils/icon.js`
sérialise un nœud lucide en SVG pour les deux usages ; `lucide` (vanilla) est
la seule dépendance ajoutée. index.html (v1, gelé) garde sa légende.

### Le chemin de la caméra : un seul lacet, une seule montée (2026-09-09, soir)

Alexandre a décrit deux passages qu'il ne peut pas accepter, en termes de
passager : « comme dans un avion de ligne, il ne doit pas renverser son verre
d'eau presque plein ». À la sortie du tunnel, la caméra « se retourne, continue
un peu vers l'arrière du logo, se reprend, repart dans la bonne direction, puis
monte d'un cran avant de continuer son ascension ». Et sur l'approche, après le
menu, « trop d'angles, trop de mouvements brusques », rendus plus aigus par un
scroll rapide. Ce qu'il veut : après le tunnel, une caméra qui monte tout droit
en se retournant sur elle-même, et retrouve la page en face d'elle au repos.

**Le relevé d'abord.** La caméra de rendu a été échantillonnée sur toute la
boucle (400 pas ; azimut du regard, élévation, roulis) et les deux plaintes
sont apparues telles quelles dans les nombres.

À la sortie : le balayage tournait **à droite** (« le grand tour par −X, pour
que l'escalier entre par la droite ») vers une cible qui est le regard VIVANT
de l'orbite — et l'orbite tourne à gauche. La caméra tournait donc 194° pour
rattraper une cible qui reculait, puis revenait de 14° avec elle jusqu'à la
pose +Z : **lacet 0 → 194° → 180°**, et le roulis, qui suit le taux de lacet,
changeait de signe dans le retour : **−30° → 0 → +3° → 0**. Ensuite, LAND
posait la caméra sur l'orbite à 12° d'élévation, tenue à plat pendant 50vh,
et la rampe de retour (12° → 35°) ne partait qu'à progress 0,89. Une montée,
un palier, une montée : le « cran ».

Sur l'approche : ALIGN roulait un bezier de soixante unités monde jusqu'au
parking en visant la marque depuis là où il passait. Or la caméra est
**orthographique** sur ce tronçon : une position ne montre rien d'elle-même,
seuls les deux angles du regard et le centre du cadre se voient. Ce que ça
donnait : un taux de lacet qui tombait au tiers de celui de l'orbite, remontait
au double, et s'annulait en 36vh ; la marque qui dérivait d'une demi-hauteur de
cadre (NDC y 0,48 à progress 0,3) avant de revenir ; et un roulis de
0 → 7° → 4° → 20° → 0 par-dessus, le tout en 240vh.

**Ce qui a changé, dans `Scene.js` :**

| | Avant | Après |
|---|---|---|
| Sens du balayage | à droite, « le grand tour » | **à gauche, le sens de l'orbite** — `dAz` replié dans (−2π, 0], jamais le demi-tour le plus court (la cible passe par 180° et ne doit pas basculer) |
| Cible du balayage | regard vivant de l'orbite, mais centre = la marque, cadre = zoom 1,75 | regard, **ligne de centre et hauteur de cadre vivants** de l'orbite — le balayage atterrit sur ce que l'orbite dessine à LAND, quoi que fasse sa rampe |
| Rampe de retour de l'orbite | miroir de la rampe de départ, à partir de 0,89 | `TRAVEL_RETURN` : part dès que la perspective est drainée (progress 0,794), `travelReturn` ajouté **à côté** dans `orbitPose` — `index.html` ne le passe jamais |
| Fondu du roulis avant LAND | 0,03 de l'étape (24vh pour 11°) | `EDGE_OUT` 0,15 (un dixième de la boucle) |
| ALIGN | bezier + regard épinglé + roulis | écrit **dans l'image** : lacet qui part au taux de l'orbite et décélère une fois, C2, sur le cap de l'axe (`rampTo` à l'envers) ; tangage 12° → 0 en une quintique ; centre du cadre de la marque au parking en une quintique ; position dérivée (centre − regard × rayon de l'orbite), donc exactement celle de l'orbite en h = 0. **Aucun roulis** : c'est le virage de l'orbite qui s'éteint, et l'orbite ne s'incline pas |
| Chargement du balayage | 0,37 du virage sur 0,20 de la fenêtre, genou 1,1 | re-mesuré pour la gauche (l'escalier entre à wS ≈ 0,44) et adouci : 0,44 sur 0,30, genou 1,3 — pic 2,4× la moyenne au lieu de 3,0, pire chute de taux 0,96 au lieu de 1,75 |

La grue (`LIFT` / `PUSH`) reste : sans elle, le drain recule la caméra le long
de la paroi −X du solide à 0,17 unité (modèle hors navigateur, mêmes nombres
que la scène), et avec le virage à gauche elle ne pousse plus le sujet hors du
cadre sur la mise en page large. Le sujet entre par la gauche à progress 0,73,
glisse au centre, et rétrécit de façon monotone jusqu'au repos.

**Mesuré après, même relevé :** à la sortie, lacet monotone de 0° à −360°
(la pose de repos), roulis 0 → 28° (h 0,68) → 0 à LAND sans changement de
signe, élévation 0 → −12° (balayage) → −35,26° (repos) **sans palier** —
le taux d'élévation vaut −0,38°/pas de part et d'autre de LAND. Sur
l'approche, roulis nul partout, lacet 0,90 → 1,16 → 0 °/pas en une bosse,
élévation 0,28°/pas au plus, et le profil de flux entre 0,20 et 0,40 tombe de
`6,3 3,1 5,0 5,2 2,9 2,6 3,5 4,2 1,2` à `3,7 3,5 4,2 3,4 2,7 2,0 1,4 0,4 0,6`.
La jauge d'accélération n'a plus rien du voyage dans ses huit pics hormis le
conduit ; le genou du balayage (8,5, 2,4× la croisière, deuxième de la liste
après le premier passage) a disparu.

**Ce qui se paie, à dire :** l'escalier revient à progress 0,73 au lieu de
0,67 (+65vh de ciel après le couloir — la géométrie du virage à gauche : le
solide est derrière-gauche à la sortie, il faut 75° de lacet pour l'avoir dans
le cadre), et la jauge de flux marque `FAIL` sur le même pas qu'avant, à la
porte (21,9 en absolu, inchangé) : la croisière médiane est descendue de 4,19
à 3,52 parce que le reste du film s'est calmé, et 21,9 / 3,52 = 6,23. Le
budget est relatif ; l'à-coup, lui, n'a pas bougé. Contrôle du repos : PASS,
identique à l'octet.

**Deux leçons pour le prochain virage.** Un balayage qui poursuit une cible
mobile doit tourner **dans le sens de la cible**, sinon il la dépasse et
revient ; et tant que la caméra est orthographique, une animation s'écrit sur
les angles du regard et le centre du cadre, jamais sur une position — la
position ne se voit pas, et les angles qu'elle induit ne se contrôlent pas.

### Le texte suit sa visibilité (v2)

Plus de fenêtre de fade sur le scroll. La règle est physique : le texte est
imprimé sur la pièce, donc **il reste visible tant que son empreinte est dans
le cadre**, quelle que soit l'animation qui a bougé la caméra — l'orbite, le
tunnel, une plongée, la prochaine qu'on ajoutera.

`#buildPageFootprint` échantillonne une grille sur l'union des boîtes du titre
et du corps (relatives à `#page`, pas au viewport : le raster est celui de
`#page` seul, donc son repère est celui du projecteur), lance chaque
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

### Le texte est du texte, et ses liens se cliquent (2026-09-10)

Deux demandes le même jour : que le texte imprimé sur le sol soit **lisible
par un navigateur** (donc par un moteur de recherche), et qu'un lien posé dans
ce texte **se clique** — celui vers LENIA se voyait, mais l'encre projetée sur
un mur n'est pas sous le pointeur.

**Le DOM n'est plus parqué à `left: -200vw`.** Il était réel, mais hors écran,
ce que Google appelle du texte caché et dévalue. `#page-host` est maintenant
dans le viewport, à l'endroit exact où la projection l'imprime, **une couche
sous le canvas** (`z-index` 0 sous `#app` à 1 — pas −1, qui passerait derrière
le fond du `body`). Au repos le canvas repeint les mêmes pixels par-dessus,
en orbite il est opaque : rien ne se voit deux fois, et le premier paint **est**
l'image de repos, avant que WebGL ait dessiné quoi que ce soit. Corollaire :
la feuille de style est liée depuis le `<head>` et non importée par le module
d'entrée, sinon le DOM visible arrivait nu un instant en dev.

**Les liens ont une doublure.** `Scene.pageLinkAnchors()` fait pour chaque
boîte de ligne de chaque `<a>` sous `#page` ce que `stepAnchors()` fait pour
les contremarches : les quatre coins sont lancés une fois par layout depuis le
projecteur gelé sur la pièce (`#buildPageAnchors`, même trajet que
l'empreinte), puis reprojetés chaque frame dans la caméra courante.
`utils/pageLinks.js` tient au-dessus du canvas un `<a>` transparent par boîte
— même `href`, `target`, `rel`, donc clic-molette et « ouvrir dans un onglet »
marchent — et ne l'arme que si le texte est **lisible** : opacité de page
≥ 0,5, boîte entière dans le cadre sur une surface tournée vers l'œil, rien du
solide devant (un rayon par boîte, de l'œil au centre), pas de plongée en
cours. La doublure est `aria-hidden` et hors tabulation : le lien sémantique
reste celui du DOM, que le clavier atteint et que les robots lisent.

Vérifié au pixel (script Puppeteer, 18 contrôles) : au repos la doublure
coïncide avec le lien DOM à 0,00 px, `elementFromPoint` la rend, l'encre
cobalt est dessous ; à progress 0,012 elle a suivi le texte (−55, −47 px) et
l'encre est toujours dessous ; à 0,03 le lien est sorti du cadre par la gauche
et elle se désarme ; à la vue du menu et à 0,5, désarmée ; un vrai clic
navigue. Contrôle du repos inchangé : `PASS`, identique à l'octet.

Au passage, le `<head>` porte ce qu'un moteur attend : titre avec le nom,
description, cartes Open Graph / Twitter (`public/og.png`, l'image de repos en
1200 × 630, tirée avec l'outil de capture), un `Person` en JSON-LD,
`public/robots.txt`. Et les deux items du menu qui ont une destination sont
de vrais `<a href>` — le clic est intercepté pour jouer la plongée, un clic
modifié (molette, ⌘) est laissé au navigateur.

### Le tunnel est payé au repos, pas à la porte (2026-09-10)

« Quand la caméra se pose, il y a une micro-attente, ensuite je vois le tunnel
(avec la galerie) se montrer, et là seulement ça avance de nouveau. » Mesuré
avant de toucher quoi que ce soit (marche de progress 0,30 → 0,60 par pas de
0,002, en 1600 × 1000, Chrome headless) : **rien n'était construit ni chargé
au repos**. Le couloir se construisait sur la première frame de la passe
`through`, à progress 0,404 — le parking, exactement là où la caméra se pose
après ALIGN. Cette frame payait la géométrie et trois compilations de shaders
(24 à 29 ms), et deux frames plus tard les trente et une photographies
atterrissaient ensemble, décodées et envoyées au GPU dans **une seule frame :
178 ms à froid, 207 ms depuis le cache HTTP**. Lenis tourne dans ce même rAF,
donc le scroll gelait avec l'image. C'est la micro-attente, et le tunnel qui
« se montre » ensuite.

L'`arm()` sur idle existait déjà et ne servait à rien : il déclenchait le
chargement des textures, mais sur une liste de cadres encore vide, puisque le
couloir n'était pas construit.

Trois gestes, tous avant que le scroll aille où que ce soit, dans `Gallery.js` :

| | Avant | Après |
|---|---|---|
| Construction du couloir | première frame de la passe `through` (0,404) | **première frame où le glyph est placé** — au repos |
| Shaders | compilés au premier dessin | `renderer.compileAsync` juste après la construction, avec **un pixel blanc en `map`** sur chaque photo et sur la flèche : une `MeshBasicMaterial` avec `map` est un autre programme (`USE_MAP`) que sans, et c'est celui-là qu'il faut avoir compilé. Vérifié : 10 programmes avant, 10 après la porte, 10 sur le plateau — la vraie texture ne change qu'un uniform |
| Textures | `TextureLoader`, décodage synchrone dans `texImage2D` au premier dessin, toutes dans la même frame | `ImageLoader` + `img.decode()` (hors thread principal), puis **une seule `renderer.initTexture` par frame** (`#warm`), liée au cadre seulement une fois résidente |

Une photo qui devient résidente pendant que le couloir est hors écran est
simplement là quand il apparaît (`born = 0`) ; si elle arrive pendant qu'on le
regarde, elle garde son fondu d'arrivée. `ready` conserve son sens — tout ce
qui va arriver est **dessinable** — parce que `pending` compte jusqu'à
l'envoi au GPU, pas jusqu'à la réponse réseau.

**Mesuré après, même marche :** aucune frame au-dessus de 22 ms sur les deux
passages (pire : 20,8 ms à froid, 21,0 ms depuis le cache), 31 textures
résidentes au repos, `born` à 0 partout. Ce que ça coûte : une frame de
~55 ms de plus au chargement, au repos, où rien ne bouge (le chargement en
avait déjà une de 53 ms avant). Contrôle du repos : `PASS`, identique à
l'octet ; console propre ; frames de galerie et de porte inchangées.

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
  utils/pageLinks.js         la doublure cliquable des liens de la page
  main.js / main-v2.js       les deux points d'entrée : la règle d'encrage, un mot
tools/
  shoot.mjs                  frames déterministes + contrôle du repos
  flow.mjs                   la jauge de flux optique (voyage + plateau),
                             et --accel pour son accélération
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

### Le studio a des sources, pas un dégradé (2026-09-09)

Le rig précédent était un dégradé lisse de l'horizon (0,12) au zénith (42),
réfléchi par un vernis quasi miroir (roughness 0,09, coat 0,55 / 0,035) sans
aucun roll-off des hautes lumières. C'est la recette exacte de la « boule
chromée » : au repos ça marchait par construction, mais à 3 % de scroll le
solide restait un autocollant (marches blanc pur, contremarches cobalt plat),
et dans le tunnel chaque paroi en incidence rasante étalait le dégradé du
cobalt au lavande puis au blanc. Alexandre : « un gloss dégueulasse et cheap ».

Un vrai studio est **sombre partout et brillant en quelques rectangles**, et
c'est ces bords qu'un laque montre. `createStudioEnvironment` accepte donc des
`panels` (azimut, élévation, demi-largeur, demi-hauteur, pénombre, radiance)
posés en MAX sur un fond bas (ciel 3 au zénith, horizon 0,1, sol 0,03). Trois
sources, toutes placées par la géométrie :

| Source | Où | Pourquoi là |
|---|---|---|
| **Key** softbox, radiance 40, plateau ±4,5° × ±9°, pénombre 3,5° | az 225°, él 35,26° | le miroir d'une marche sous la caméra de repos : `(1,1,1)` réfléchi par `+Y` donne `(−1,1,−1)` |
| **Strip** bas, radiance 30, ±12° × ±5° | az 180°, él 12° | le miroir d'une marche à la pose du menu (œil sur +X à 12°) : les trois bandes gardent leurs filets clairs |
| **Carte de sol**, radiance 6, ±18° × ±14° | az −45°, él −35,26° | le miroir d'une contremarche au repos ; seules les faces `aWell` la voient — c'est le coin pâle |

**La largeur de la key est le budget de scroll.** Le miroir d'une marche
tourne d'un degré d'azimut par degré d'orbite ; un plateau de 4,5° plus 3,5° de
pénombre, flouté par la roughness de base, donne mesuré : blanc pur jusqu'à
0,015, `(247,248,255)` à 0,02, `(212,214,255)` à 0,025, `(188,190,255)` à 0,03,
`(136,139,255)` à 0,05 — puis les marches retrouvent le strip et reblanchissent
pour le menu à 0,125. Le bleu réapparaît sous le blanc entre 2 et 3 % de la
boucle, ce qui était la demande.

**La matière est un laque à deux lobes**, pas un miroir : base roughness 0,28
(le bord de la softbox se fond sur quelques degrés d'orbite au lieu de
basculer), clearcoat 0,7 à 0,06 (le bord net reste dessus). Réglé dans
`SHADING["one-material"].surface` de `Scene.js`, par-dessus les valeurs du
`.glb` — le master Blender n'est pas touché, et `brand/3d/README.md` décrit
toujours ses propres molettes (0,09 / 0,55).

**Le glyph porte son propre épaulement** (`knee` dans `GlyphMaterial.js`,
0,9) : le renderer reste en `NoToneMapping` pour la page projetée, mais la
sur-exposition du glyph se replie dans les derniers dix pour cent au lieu de
couper net. Par canal, volontairement : une courbe qui préserve la teinte
garderait une marche saturée bleu pâle pour toujours, et le blanc du logo EST
cette désaturation. Coût : un cobalt à exactement 1,0 sort à 251 au lieu de
255 — la peau plate garantit le repos, pas la peau éclairée.

Deux conséquences à connaître. Le studio n'étant plus une lampe, les
contremarches ont perdu ~0,4 d'irradiance diffuse : `envDiffuse` monte de
0,05 à 0,45 pour les ramener sur l'encre (mesuré au repos éclairé :
`(0,19,247)` pour `#0013FF`). Et le fondu plat → éclairé n'a plus besoin de
durer : la peau éclairée retombe d'elle-même sur les trois valeurs du logo,
donc `orbit.lit` de v2 finit à progress 0,012, avant que le bord de la key
n'arrive — `ORBIT.LIT` de `utils.js` reste celui de v1, qui est figé.

Le tunnel, lui, est devenu ce qu'il est physiquement : un couloir de laque
bleu sombre éclairé par ses deux bouts, `(29,31,129)` à mi-course, avec un
reflet de ciel doux au sommet de la face d'entrée. Plus de bande lavande.

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

**Un dégradé n'est pas un studio.** Une surface réfléchissante ne montre
que les BORDS de ce qu'elle réfléchit. Un environnement qui n'est qu'un
dégradé lisse n'a aucun bord : la réflexion est un voile continu, identique
sous tous les angles à un décalage près, et c'est ce que l'œil lit comme
« plastique cheap ». Le blanc des marches ne prouvait rien, il tenait à une
radiance de 42 qui saturait tout. Dès qu'une caméra en perspective a regardé
le solide de près (le tunnel), le voile s'est vu. Des rectangles lumineux sur
un fond sombre, et un épaulement sur les hautes lumières — voir « Le studio a
des sources » plus haut.

**Un brouillard accroché à l'œil cache ce qu'il y a au bout du couloir.** Le
brouillard de three se mesure depuis la caméra ; tant que l'œil est loin de la
porte, tout ce qu'il y a derrière est au-delà de `far` et l'ouverture est une
feuille blanche. Le couloir était rendu, correct, et invisible. Décaler la
bande de la distance œil-porte le rend visible sans toucher au plateau.

**Une pause de deux écrans n'est pas une respiration.** Après la dernière
photo, la queue du couloir, le voile et le premier tiers du balayage faisaient
185vh de rien. Chaque morceau avait une raison locale ; c'est la somme qui
n'en avait pas. Mesurer le rien bout à bout, en vh, avant de juger un pacing.

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
- **Le domaine n'est pas choisi, donc pas de `canonical` ni d'`og:image`
  absolue.** Les deux exigent une URL absolue ; une fausse ferait plus de mal
  qu'une absente. À faire le jour du domaine : `<link rel="canonical">` sur la
  page retenue, `og:image` / `twitter:image` en absolu, une ligne `Sitemap:`
  dans `robots.txt`. Tant que `/` et `/v2.html` coexistent avec le même texte,
  c'est un doublon aux yeux d'un moteur — une raison de plus de trancher.
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
