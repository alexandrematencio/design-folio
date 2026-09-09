# Galerie-tunnel — les Selected Works dans le trou du logo (v2)

Brief d'exécution, 2026-09-09. Décisions prises avec Alexandre ; ce qui reste
ouvert est marqué **[à mesurer]**.

## Ce qu'on construit

Sur `v2.html`, quand le scroll amène la caméra **dans le conduit du logo**
(la traversée, `JOURNEY.TRAVERSE`), l'image se fond en un **tunnel blanc**
plein écran habillé d'un **quadrillage de lignes fines**, avec les **31 photos
de la curation** d'amatencio-photo posées sur les quatre parois (sol, plafond,
gauche, droite). On y avance au scroll, on en ressort par la même transition
dans le conduit, et la boucle reprend son cours. **Un clic sur n'importe quelle
photo** amène sur la home d'amatencio-photo, par le même match cut blanc que
la plongée « Photography » du menu.

Référence visuelle : `https://delphi-three.vercel.app/` (clone de la home de
Delphi). Son code, extrait du bundle, dit exactement ce qu'est le « grid » :

- tunnel rectangulaire 24 × 16, segments de 6 de profondeur, 14 segments
  recyclés (tunnel infini) ; caméra perspective fov 70 au centre, avancée
  `scrollY × 0.05` lissée par lerp 0.1 ;
- le « papier peint » est un **treillis de `LineSegments`**, pas une texture :
  lignes qui courent **le long de l'axe** sur les quatre parois (6 colonnes sur
  la largeur → cellules de 4, 4 rangées sur la hauteur → cellules de 4) plus un
  **rectangle de section** à chaque frontière de segment. Couleur `#B0B0B0`,
  opacité 0,5 sur fond blanc ;
- chaque photo est un `PlaneGeometry` de la taille d'une cellule **moins une
  marge de 0,4**, posé **à plat sur la paroi** (sol : rotation −π/2 en x ;
  plafond : +π/2 ; gauche : +π/2 en y ; droite : −π/2), `MeshBasicMaterial`,
  `DoubleSide`, fondu d'opacité à l'apparition. Jamais deux photos sur des
  cellules adjacentes d'une même paroi.

On garde l'esprit (treillis fin, photos posées sur les cellules, quatre parois)
et on adapte : **fond papier `#FAFAF8`** (PAPER de Scene.js, pas `#ffffff`),
photos **opaques**, placement **déterministe** (pas de `Math.random` : les
shoots doivent être reproductibles), ratio d'image respecté.

## Architecture — trois pièces, le reste ne bouge pas

`index.html` / `main.js` sont figés (README). Tout se passe sur v2.

### 1. Le plateau de scroll (`src/core/Three.js`)

La galerie n'est pas un état : c'est **un segment de scroll pendant lequel le
progress de l'orbite est figé**. Le spacer de `v2.html` passe de 1200vh à
**1200 + GALLERY_VH** (GALLERY_VH ≈ 600, **[à mesurer]** : on veut ~40vh de
molette par rangée de photos). `#getLoopProgress` devient une fonction
monotone par morceaux du scroll brut `u ∈ [0,1)` :

```
P        = progress de plateau  (voir §2 : la caméra bien dans le conduit)
a        = P × 1200 / (1200 + GALLERY_VH)
g        = GALLERY_VH / (1200 + GALLERY_VH)
u <  a          → progress = u × (1200 + GALLERY_VH) / 1200,   gallery.t = 0
a ≤ u ≤ a + g   → progress = P,                                 gallery.t = (u − a) / g
u >  a + g      → progress = (u − g) × (1200 + GALLERY_VH) / 1200, gallery.t = 1
```

Exposer sur `Three` : `this.gallery = { t, active }` (active = t strictement
entre 0 et 1), un `galleryOverride` (même rôle que `progressOverride`, pour
`tools/shoot.mjs`) et **`scrollFor(progress)` + `scrollForGallery(t)`**, les
inverses. `main-v2.js` utilise aujourd'hui `limit * ORBIT.STEPS` pour reparquer
le scroll après une plongée : le remplacer par `scrollFor(ORBIT.STEPS)`, sinon
le retour de plongée atterrit à côté de la vue des marches.

`#maybeSnap` raisonne en multiples de `limit` : inchangé.

### 2. La scène galerie (`src/scenes/Gallery.js`, nouveau)

Une **seconde `THREE.Scene`**, rendue par le même renderer, avec sa propre
`PerspectiveCamera`. Rien n'est ajouté à la scène du logo.

**La couture est géométrique, pas chorégraphiée.** Le conduit du logo est un
carré de 1 unité (`TUNNEL` dans Scene.js : centre `[-0.5, -1, 0]`, demi-longueur
1,25 le long de z, `bore` 1), en espace glTF du glyph, mis en monde par
`glyph.matrixWorld` et l'échelle `glyph.scale.x`. Pendant la traversée la
caméra de rendu est `scene.perspCamera` (fov 55, sur la « ride line » : l'axe
du conduit descendu de `RIDE_DROP` 0,15). Le tunnel de la galerie est construit
**dans le même espace monde, aligné sur l'axe du conduit** : même section
carrée de 1 unité (× s), même axe, et il s'étend depuis l'entrée du conduit vers
+axe sur toute la longueur nécessaire. Sa caméra, à `t = 0`, **est** la caméra
perspective du logo au progress P (copier position, quaternion, fov, aspect).
Ainsi, au moment du fondu, les quatre arêtes du conduit cobalt et les quatre
arêtes du tunnel blanc se superposent au pixel, et le fondu se lit comme la
matière qui se dissout — sans une ligne de maths de raccord.

`Scene.js` expose ce qu'il faut pour ça : un `boreFrame()` (origine = bouche
du conduit sur la ride line, `axisDir`, `s`, et la pose de `perspCamera`) —
les lambdas `local()` / `ride()` de `#applyJourney` font déjà ce calcul, les
sortir en méthode plutôt que dupliquer.

Choix de **P** : dans `JOURNEY.TRAVERSE` `[0.44, 0.66]` de l'étape, donc
progress `0.2 + h × 0.675`. Partir de **h = 0,52** (progress ≈ 0,551) : la
caméra est entre les deux bouches, les parois remplissent le cadre, la sortie
est un rectangle clair devant. **[à mesurer]** au shoot : si la bouche
d'entrée est encore visible dans le cadre à P, avancer h.

Le film de la galerie, fonction pure de `t` :

| t | ce qui se passe |
|---|---|
| 0 → 0,08 | **fondu entrant** : la galerie est rendue par-dessus le logo, son opacité globale monte (smoothstep). Sa caméra ne bouge pas. |
| 0,08 → 0,92 | **la traversée** : la caméra avance le long de l'axe, de la bouche jusqu'à la fin des photos. Vitesse constante en t (pas d'easing au milieu : la seule règle de la page est « fonction pure du scroll »). Elle peut recentrer doucement son œil de −0,15 à 0 sur les premiers 10 % pour retrouver le centre du tunnel à la Delphi, puis revenir sur la ride line sur les derniers 10 % pour la couture de sortie. |
| 0,92 → 1 | **fondu sortant** : symétrique, la caméra est revenue à la pose de couture (même pose qu'à t = 0 : le progress du logo est le même, le treillis est périodique donc la trame est la même, seules les photos ont défilé). |

**Le fondu** : rendu en deux passes dans `Three.#render` — la scène du logo
d'abord, puis la galerie avec `renderer.autoClear = false`, tous ses matériaux
`transparent` avec une opacité multipliée par `fade`. Le fond papier de la
galerie est un **plan fermant le tunnel au loin** (ou un brouillard
`THREE.Fog` couleur PAPER, comme la sortie blanche du conduit) et non
`scene.background`, sinon il n'y a rien à fondre. Quand `fade ≥ 1`, sauter la
passe logo (c'est aussi la performance : pas de VSM shadow map ni de
projection pour rien pendant 600vh).

**Repli si le crossfade aligné est boueux à l'œil** [à mesurer] : un « dip »
papier — le `#dive-veil` monte à `#FAFAF8` sur 0 → 0,06, on bascule de scène,
il redescend sur 0,06 → 0,12. Symétrique en sortie. Propre, sur la marque, et
cohérent avec la lumière blanche au bout du conduit.

**Le treillis** : `LineSegments`, `LineBasicMaterial` couleur `#B0B0B0`
opacité 0,5 × fade (les lignes de 1px de WebGL sont exactement le rendu de la
référence). Cellules **carrées** : 4 colonnes par paroi (cellule 0,25 × s),
profondeur de cellule 0,25 × s, rectangle de section à chaque pas. Construire
une seule géométrie pour toute la longueur (≤ 30 rangées, c'est quelques
centaines de segments) — pas de recyclage, la galerie est finie.

**Les photos** : lues dans `public/curation.json` (voir §4). Ordre de la
curation conservé. Placement déterministe, par exemple : photo `i` va sur la
rangée `⌊i / 2⌋` et sur la paroi `WALLS[i % 4]` avec `WALLS = [floor, left,
ceiling, right]` — deux photos par rangée, jamais deux sur la même paroi ni sur
la même colonne que la précédente de cette paroi. Chaque photo occupe un slot
de **2 × 2 cellules moins une marge de 0,1 × s** et est mise à l'échelle **dans
ce slot en respectant son ratio** (paysage 3:2 → pleine largeur ; portrait →
pleine hauteur). Sur le sol et le plafond l'image est orientée pour être lue
depuis la caméra qui avance (le haut de l'image vers le fond du tunnel). Sur
les murs, à l'endroit. `MeshBasicMaterial`, `toneMapped: false` (le renderer
est en `NoToneMapping`, garder les couleurs telles quelles), texture
`colorSpace = SRGBColorSpace`, `anisotropy` = max du renderer (les photos sont
vues en biais), opacité 1 × fade. `FrontSide` suffit : chaque plan regarde
l'axe.

**Chargement** : les textures ne bloquent jamais la page. Charger via
`TextureLoader` **la première fois que le progress dépasse 0,3**, ou après
`requestIdleCallback` (fallback `setTimeout` 3 s) — le premier des deux. Une
photo dont la texture n'est pas prête est un plan invisible (opacité 0), puis
fondu à 1 sur 0,4 s quand elle arrive. Pas de texture > 1024 px de grand côté :
31 × ~4 Mo GPU, c'est le plafond mobile qu'on s'autorise.

**Resize** : la galerie se reconstruit sur `onResize` comme le reste (le
glyph est replacé, `s` et `matrixWorld` changent).

### 3. Interaction (`src/main-v2.js`)

- **Raycast** sur les plans photo à `pointermove` / `click` sur `window`
  (le canvas et `#app` sont en `pointer-events: none`, ne pas y toucher),
  actif seulement si `three.gallery.active && fade > 0.5` et hors plongée.
- **Survol** : `cursor: pointer` sur `document.body`, et un scale du plan
  vers 1,03 lissé (règle brand : zoom ≤ 1,04, jamais zoom + légende). Sous
  `prefers-reduced-motion`, pas de scale.
- **Clic** : même mécanique que la plongée Photography — `veil` peint
  `#ffffff` (l'ouverture d'amatencio-photo est blanche), écriture de
  `RETURN_KEY` avec `{ dest: "photography", gallery: three.gallery.t }`,
  `lenis.stop()`, fondu du voile sur ~0,5 s, puis
  `location.assign(DESTINATIONS.photography.url)`. Sous reduced-motion :
  navigation directe.
- **Retour** (`playReturn`) : si `record.gallery` est défini, on ne rembobine
  pas de plongée : voile blanc levé **synchronement**, `lenis.scrollTo(
  three.scrollForGallery(record.gallery), { immediate: true, force: true })`
  une fois la scène prête, puis le voile s'efface. Le visiteur revient
  **dans le tunnel, sur la photo qu'il avait cliquée**.
- Le clic reste inerte si `three.scene.dive` ou si une navigation est déjà
  partie (`navigatedTo`).

### 4. Les photos, bakées (`tools/curation.mjs`, nouveau)

Le CDN images de Sanity répond `403 CORS Origin not allowed` à tout domaine
non déclaré ; les textures WebGL exigent CORS. Décision : **baker au build**.

- `npm run curation` → `node tools/curation.mjs`. Node 24, `fetch` natif,
  aucune dépendance.
- Lit la curation en GROQ, dataset public, sans token :
  `https://yh5i5diw.api.sanity.io/v2026-01-01/data/query/production?query=`
  + encodeURIComponent de
  `*[_type=="siteSettings"][0].curation[]->{title,"slug":slug.current,"url":image.asset->url,"width":image.asset->metadata.dimensions.width,"height":image.asset->metadata.dimensions.height}`
  (vérifié : 31 entrées, la requête curl répond en 6 ms).
- Télécharge chaque image en `${url}?w=1024&fm=jpg&q=82` (le pipeline images
  de Sanity redimensionne côté serveur ; la CDN accepte un curl sans `Origin`)
  vers `public/curation/<slug>.jpg`. Concurrence 4, réessai 1 fois, échec
  d'une image = le script sort en code 1 en nommant l'image.
- Écrit `public/curation.json` :

```json
{
  "generatedAt": "2026-09-09T…",
  "source": "sanity:yh5i5diw/production siteSettings.curation",
  "photos": [
    { "slug": "teens-of-paris", "title": "Teens of Paris",
      "src": "/curation/teens-of-paris.jpg", "width": 6356, "height": 3133 }
  ]
}
```

  `width` / `height` sont ceux de l'original (le ratio est tout ce qu'on lit).
  L'ordre du tableau **est** l'ordre de la curation.
- Idempotent : une image déjà présente avec le bon nom n'est pas retéléchargée
  sauf `--force`. `public/curation/` et `curation.json` sont **commités** (le
  site est statique, le build ne doit dépendre de rien de vivant).
- Le README de DESIGN-FOLIO gagne une ligne dans le tableau des scripts.

### 5. Outillage

- `tools/shoot.mjs` : option `--gallery` qui, en plus, épingle
  `galleryOverride` sur `[0.02, 0.06, 0.1, 0.5, 0.9, 0.94, 0.98]` et sort
  `g002.png`… Le contrôle du repos existant doit rester vert (`npm run
  shoot:v2` inchangé, le spacer plus long ne touche pas au repos).
- `npm run flow` échantillonne `progressOverride` : la galerie n'y est pas,
  et c'est accepté (elle avance en ligne droite dans un tunnel périodique,
  pas de transit à mesurer). Le noter dans le commentaire de tête de flow.mjs.

## Ce qui ne change pas

- `index.html`, `main.js`, `style.css` (sauf rien) : figés.
- La caméra orthographique, la règle d'encrage, la plongée, le retour de
  plongée : intacts. Le test : `npm run shoot:v2` vert avant et après.
- Aucune requête tierce au runtime (règle brand) : les photos viennent de
  `public/`, la police reste Inter auto-hébergée.

## Vérification attendue avant de dire « fini »

1. `npm run curation` : 31 fichiers dans `public/curation/`, JSON valide.
2. `npm run dev` puis `npm run shoot:v2` : contrôle du repos vert, wedge
   assertée.
3. `node tools/shoot.mjs --url http://localhost:5180/v2.html --gallery --out
   tools/shots/gallery` : les frames g002 / g098 montrent le conduit cobalt
   et le tunnel blanc **avec les mêmes arêtes**, g050 montre des photos sur
   les quatre parois, aucune erreur console.
4. Scroll arrière depuis la galerie : on ressort par où on est entré, sans
   saut (fonction pure).
5. Retour de plongée « Photography » depuis le menu : atterrit toujours face
   aux marches (le remap `scrollFor` est bon).
6. Un commit par pièce (§4, §1+2, §3, §5), messages en français, identité
   git du dépôt (Alexandre Matencio, déjà configurée — ne rien forcer).
