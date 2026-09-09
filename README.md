# Yam Web — Appel audio/vidéo WebRTC (frontend)

Frontend web (JavaScript vanilla) de **Yam**, une application d'appels audio et vidéo
en temps réel basée sur **WebRTC**, avec signalisation via **Reverb (WebSocket)**.

## Fonctionnalités

- Appels **audio** et **vidéo** en temps réel (WebRTC)
- Écran d'appel entrant avec sonnerie, vibration et notification push (FCM)
- Historique des appels (manqués / passés)
- Gestion des contacts
- Interface responsive (mobile + desktop)
- Mode SPA (`index.html`) et version multi-pages (`pages/`)

## Architecture

| Fichier | Rôle |
|---------|------|
| `index.html` | Structure et interface de la SPA ; charge les modules `spa-*.js` |
| `js/spa-core.js` | État partagé, configuration locale et références DOM |
| `js/spa-auth.js` | Inscription, connexion, session Sanctum et déconnexion |
| `js/spa-network.js` | Configuration runtime, Reverb/Pusher et état réseau |
| `js/spa-calls.js` | Appels entrants/sortants, WebRTC et signaling |
| `js/spa-contacts.js` | Contacts, recherche utilisateurs, historique et interactions UI |
| `js/spa-push.js` | Enregistrement FCM/Web Push |
| `js/spa-bootstrap.js` | Démarrage contrôlé de la SPA |
| `pages/` | Version multi-pages (login, contacts, dial, call, incoming-call…) |
| `js/call.js` | Logique WebRTC de l'appel sortant |
| `js/push.js` | Notifications push FCM (Service Worker) |
| `js/peer-config.js` | Configuration ICE (STUN/TURN) |
| `sw.js` | Service Worker (push + cache) |

Les modules SPA utilisent volontairement des scripts classiques (sans build
Node) afin de rester compatibles avec le déploiement statique actuel. Leur
ordre de chargement dans `index.html` est significatif : `core`, `auth`,
`network`, `calls`, `contacts`, `push`, puis `bootstrap`.

## Configuration

Les clés Firebase (web) et la clé VAPID publique sont des **clés publiques** par
conception (destinées à être exposées côté client). Elles sont configurées dans
`js/push.js` et `index.html`.

La configuration runtime (Reverb, TURN) est chargée dynamiquement depuis le
backend via `GET /api/v1/config` — aucune clé secrète n'est codée en dur côté client.

## Backend

Le backend Laravel associé est disponible dans le repo séparé
[`yam-api`](https://github.com/Daniel-the-one/yam-api).

## Déploiement

Le frontend est servi par le backend Laravel (dossier `public/`). Voir le README
du repo `yam-api` pour le déploiement complet.
