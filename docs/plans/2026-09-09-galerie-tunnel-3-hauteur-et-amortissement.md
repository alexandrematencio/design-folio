# Galerie-tunnel, suite 3 — la bonne hauteur avant, et un ride sans à-coups

Brief d'exécution, 2026-09-09 (nuit). Suite de
`2026-09-09-galerie-tunnel-2-couture-et-banking.md`, après la deuxième revue
d'Alexandre.

## Ce qu'Alexandre a vu

1. **La caméra se redresse dans le couloir.** Une fois dans la vision tunnel
   elle remonte un peu pour se mettre au centre. C'est `RECENTRE` dans
   `Gallery.js` : l'œil quitte la ride line (`RIDE_DROP` 0,15 sous l'axe) pour
   le centre sur les premiers 10 % du trajet. Il ne veut **aucun** ajustement
   visible une fois dedans : la caméra doit être à la bonne hauteur **dès
   l'alignement sur l'axe, avant d'avancer vers le conduit**.
2. **Deux mouvements de caméra sont « rugueux »**, brutaux, « comme s'il n'y
   avait pas d'amortissement ». Il ne dit pas lesquels. Ce qu'il veut :
   l'ensemble du ride comme un **roller coaster lent** — un train ne peut pas
   prendre un virage sec, donc tous les angles sont doux, rien d'exagéré.
   « Comme si tu conduisais Daisy. »

## A. La hauteur — sur l'axe, du parking à la sortie

- `JOURNEY.RIDE_DROP` passe à **0** : la ride line EST l'axe du conduit. Le
  parking d'ALIGN, la bouche, la traversée, la porte, le couloir : tout est
  concentrique, plus rien à recentrer. Le commentaire « driver's eye » de
  `boreFrame()` et le README (« La traversée du trou ») sont à corriger : la
  raison de cette valeur est partie, la prose qui la justifiait aussi.
- `RECENTRE` et le terme `rise` de `Gallery.update` disparaissent (pas mis à
  zéro : supprimés, avec leur commentaire).
- Conséquence à vérifier : `progressPastExit`, la couture, `SEAM_SPEED`, les
  photos placées relativement à la couture — tout est dérivé, ça doit suivre
  sans retouche ; le prouver par les mêmes mesures que la suite 2 (écart
  caméra/point analytique à P = 0, marche du scroll à travers la porte).

## B. L'amortissement — mesurer d'abord, lisser ensuite

Le film est une fonction pure du scroll, et Lenis lisse déjà le scroll dans le
temps (`lerp: 0.075`). Ce que le visiteur sent comme « pas d'amortissement »,
ce sont donc les **ruptures d'accélération** des courbes elles-mêmes : les
phases sont C1 (smoothstep : vitesse nulle aux bords) mais pas C2 —
l'accélération saute à chaque couture de phase, et un train ne fait pas ça.

### 1. La jauge d'accélération (`tools/flow.mjs --accel`, ou `tools/jerk.mjs`)

`flow.mjs` mesure la différence d'image par pas (la vitesse du film). Ajouter
la **différence de cette différence** entre pas consécutifs (l'accélération
du film), sur le voyage ET sur le plateau comme `flow` le fait déjà. Sortie :
médiane, et les **8 plus forts pics** avec leur progress (ou leur t), chacun
étiqueté par la phase où il tombe (ALIGN, MORPH_IN, TRAVERSE, porte, plateau,
MORPH_OUT/SWEEP, LAND, orbite). Lancer **avant tout changement** et garder
la sortie : c'est la liste des endroits rugueux, et c'est probablement là que
sont les deux d'Alexandre. Les nommer dans le rapport.

### 2. Les corrections, dans cet ordre, la jauge relancée après chacune

a. **Quintique partout dans le voyage.** Dans `Scene.js`, le `win()` de
   `#applyJourney`, les fenêtres du banking, `GAZE_IN`, `STITCH`, la crane
   (`sin(π·wOut)`) : passer de smoothstep (cubique, C1) à **smootherstep**
   (`6t⁵ − 15t⁴ + 10t³`, C2 : vitesse ET accélération nulles aux bords).
   ⚠️ **Ne pas toucher `utils.js` / `orbitPose`** : `index.html` est figé et
   partage ce fichier ; l'orbite et le reveal de v1 ne changent pas. Ajouter
   `smootherstep` à côté de `smoothstep` dans utils.js est permis, y
   remplacer un usage ne l'est pas.
b. **La porte sans freinage.** Aujourd'hui `TRAVERSE` freine vers `axisEnd`
   et la porte est franchie à 43 % de la vitesse de pointe, puis le couloir
   réaccélère : un changement de signe de l'accélération dans l'embrasure —
   c'est un à-coup, même doux. Refaire le pacing de la traversée en trois
   morceaux C2 : une respiration à l'entrée (accélération depuis le parking
   sur la fenêtre `MORPH_IN`, déjà là), **vitesse constante** de la bouche
   jusqu'à P et au-delà, et la décélération vers `axisEnd` seulement
   **après** P (dans ce qui reste de `TRAVERSE` avant `MORPH_OUT`). Le
   couloir reprend alors à la vitesse de croisière du conduit, `SEAM_SPEED`
   devient 1 ou s'en approche, et la rampe de 10 % du couloir n'a plus de
   raison d'être (à supprimer si `SEAM_SPEED` ≈ 1). P reste résolu (0,1
   largeur après la sortie).
c. **Les coutures de phase.** Sur la liste des pics : `STITCH` (0,05 de
   l'étape, le slerp sur le regard vivant de l'orbite au départ d'ALIGN), la
   bascule ALIGN → MORPH_IN, TRAVERSE → SWEEP/MORPH_OUT (deux fenêtres
   ouvertes au même h, chacune C2 mais leur somme part d'un coup), `LAND`.
   Allonger ou chevaucher ce qu'il faut, une couture à la fois, la jauge
   entre chaque. Une couture n'est bonne que si son pic descend.
d. **Le banking.** Le roulis suit la courbure ; avec des fenêtres quintiques
   la courbure devient C1 et le roulis aussi. Si un pic reste au bord d'un
   virage, élargir l'ε de la différence centrée (0,002 → 0,01) : c'est un
   filtre passe-bas gratuit et sans état.
e. **Lenis en dernier recours.** Ne baisser `lerp` que si les courbes seules
   ne suffisent pas, et dire pourquoi : ça ralentit tout le site, repos
   compris, et ce n'est pas ce qu'il demande.

### 3. La barre

- Jauge de flux (`flow`) : toujours ≤ 6× la croisière.
- Jauge d'accélération : les 8 pics d'avant doivent descendre ; rapporter
  le tableau avant/après pic par pic, avec la phase. Pas de cible chiffrée
  a priori — on la fixe sur la mesure d'avant, c'est le premier relevé.
- Aucun pic nouveau créé par une correction (une couture allongée en crée
  parfois une autre plus loin).

## Vérification attendue

1. `npm run shoot:v2` vert.
2. Porte : `door058` / `door061` / `g002` refaits — caméra au centre du
   carré, symétrie haut/bas à l'œil ET au pixel (distance des arêtes
   supérieure et inférieure au centre du cadre).
3. Marche du scroll par pas constants à travers la porte : **plus de creux**
   dans l'embrasure, vitesse plate de la bouche au couloir.
4. Tableau accélération avant/après, flux avant/après.
5. Marche arrière depuis le couloir : symétrique.
6. Deux commits : la hauteur, puis l'amortissement. Messages en français.
   Commentaires de code en anglais, le pourquoi et le mesuré.
