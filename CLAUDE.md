# Duel de Mages

Jeu web multijoueur (2-3 joueurs) à tours simultanés. Monorepo pnpm :
- `packages/shared` : moteur pur (`resolveRound`, `validatePlan`, `viewFor`/`resultFor` pour filtrer les secrets) + contrat socket (`protocol.ts`).
- `packages/server` : Fastify + socket.io, salles en mémoire (`rooms.ts`), sert `packages/client/dist`. Lancé en prod avec `tsx`.
- `packages/client` : Vite + React. Les pièces de l'arène sont positionnées en `left`/`top` (pas `transform`) pour que `scale`/animations restent relatifs à la case ; les paddings en % doivent être divisés par `var(--n)`.

## Règles (moteur `engine.ts`)
- Ordre d'un step : boucliers → mouvements/téléports → bourrasques (poussée, même résolution des conflits via `settleMoves`) → pièges déclenchés puis pose pièges/glace → boules de feu et météores → dégâts/morts.
- Fin de manche (ajoutée au dernier step) : -1 PV sur la lave (bouclier inutile), puis fonte de la glace (`expires` = manche suivante).
- Sorts à recharge (`COOLDOWNS`, 1×/manche) : `PlayerState.ready[type]` = première manche où il redevient disponible.
- Mode Chaos : le serveur tire `rollBonus()` et applique `startRound(game, bonus)` à chaque planification ; `slotsFor`/`maxFireballs` dépendent du bonus.
- `RoundResult.start` = état avant la manche (animation + historique). Tout ce qui sort vers un client passe par `viewFor`/`resultFor`.

## Commandes
- `pnpm test` (vitest, 3 packages), `pnpm lint`, `pnpm test:smoke` (3 clients socket jouent une partie complète + vérif anti-fuite).
- `PLANNING_MS` / `REVEAL_MS` surchargent les durées côté serveur.

## Déploiement
- Render : service `srv-db92i0navr4c73cqhs5g`, https://duel-de-mages.onrender.com (plan free, se met en veille).
- L'auto-deploy ne se déclenche PAS (repo public cloné sans l'app GitHub Render) : après `git push`, déclencher via l'API :
  `curl -X POST -H "Authorization: Bearer $(security find-generic-password -s render-api-key -w)" -H "Content-Type: application/json" -d '{}' https://api.render.com/v1/services/srv-db92i0navr4c73cqhs5g/deploys`
- Un redéploiement efface les salles en cours (stockage en mémoire).
