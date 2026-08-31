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
| `index.html` | Application SPA (contacts, historique, appel intégré) |
| `pages/` | Version multi-pages (login, contacts, dial, call, incoming-call…) |
| `js/call.js` | Logique WebRTC de l'appel sortant |
| `js/push.js` | Notifications push FCM (Service Worker) |
| `js/peer-config.js` | Configuration ICE (STUN/TURN) |
| `sw.js` | Service Worker (push + cache) |

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
