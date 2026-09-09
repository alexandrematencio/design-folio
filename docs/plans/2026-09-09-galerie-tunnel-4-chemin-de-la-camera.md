# Galerie-tunnel, suite 4 — le chemin de la caméra

Brief d'exécution, 2026-09-09 (soir). Suite de
`2026-09-09-galerie-tunnel-3-hauteur-et-amortissement.md`, après la troisième
revue d'Alexandre. Exécuté le jour même ; le compte rendu est dans le README,
« Le chemin de la caméra : un seul lacet, une seule montée ».

## Ce qu'Alexandre a vu

Le principe : « comme dans un avion de ligne, l'utilisateur ne doit pas
renverser son verre d'eau presque plein ». Tous les axes doivent se compenser,
tout angle doit être ample, aucun mouvement brusque — et un scroll rapide rend
les mouvements plus aigus, donc ils doivent être amples au départ.

1. **À la sortie du tunnel** : la caméra se retourne, continue un peu vers
   l'arrière du logo (à gauche à l'écran), se reprend, repart dans la bonne
   direction, monte d'un cran, puis continue son ascension vers le repos.
   Il veut : la caméra monte tout droit, se retourne sur elle-même en même
   temps qu'elle continue vers son point de départ — chemin linéaire sur
   l'ascension finale — et retrouve la page en face d'elle.
2. **Sur l'approche**, après le menu, dans la préparation à entrer dans le
   tunnel : trop d'angles, trop de mouvements brusques.

## Méthode

Relever d'abord (`az`, `el`, roulis de la caméra de rendu sur 400 pas de la
boucle), nommer les deux plaintes dans les nombres, corriger, relever à
nouveau, jauge de flux et d'accélération avant/après, contrôle du repos.

## Ce qui a été fait

- Balayage de sortie **à gauche**, le sens de l'orbite (le lacet ne se
  renverse plus, le roulis ne change plus de signe).
- Le balayage poursuit la **ligne de centre et le zoom vivants** de l'orbite,
  pas seulement son regard.
- **Rampe de retour** de l'orbite (`TRAVEL_RETURN`) démarrée dès la fin du
  drain de perspective — une seule montée de la sortie au repos. Option
  `travelReturn` ajoutée à côté dans `orbitPose` ; v1 intact.
- **ALIGN réécrit dans l'espace image** (lacet C2 au taux de l'orbite,
  tangage et centre en quintiques, position dérivée) ; plus de bezier, plus
  de roulis sur ALIGN.
- Fondu du roulis avant LAND élargi (`EDGE_OUT` 0,15) ; chargement du
  balayage re-mesuré et adouci.

## Vérification

`npm run flow -- --accel` (relatif : `FAIL` sur le pas de la porte, inchangé
en absolu, croisière plus basse), `npm run shoot:v2` (repos PASS), planches-
contact 0,18 → 0,44 et 0,63 → 0,87 sur la mise en page large.
