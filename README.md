# weedtycoon-backend

Backend Node.js du tycoon. Source de vérité pour cash, plantes, génétique, leaderboard. Anti-cheat server-authoritative.

## Stack

- **Node.js 20+** (ES modules)
- **Express 4** — HTTP routing
- **better-sqlite3** — DB sync, embedded, suffit largement pour 10k joueurs
- **jsonwebtoken** — JWT session tokens
- **helmet** — security headers

## Setup local

```bash
cd my_project_2-backend
cp .env.example .env
# Edite .env, génère les secrets avec :
#   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
npm install
npm run migrate
npm run dev
```

Le serveur écoute sur `http://localhost:3000`. Health check : `GET /health`.

## Endpoints (M0/M1)

### Auth
- `POST /auth/steam` — body `{ ticket, steamid }` → renvoie `{ token, expiresIn }`
- `POST /auth/refresh` — header `Authorization: Bearer <token>` → renvoie un nouveau token

### Player state
- `POST /api/player/load` — auth required → renvoie l'état complet du joueur
- `POST /api/player/save` — auth required, body `{ nonce, state }` → persiste

### Plant actions
- `POST /api/plant/sow` — auth, body `{ nonce, slotId, seedType }` → crée la plante côté serveur
- `POST /api/plant/trigger-flowering` — auth, body `{ nonce, plantId }` → switch flo (photoperiod)
- `POST /api/plant/harvest` — auth, body `{ nonce, plantId }` → calcule yield, retourne signé

### Health
- `GET /health` — `{ status: "ok", uptime }` pour monitoring

## Sécurité

Toutes les routes `/api/*` exigent un JWT valide. Le JWT contient le `steamid` qui sert d'identité.

Chaque action mutante (`/api/*` POST) requiert un `nonce` monotone par joueur. Les replays sont rejetés.

Le RNG du breeding (M2+) vit ici, jamais côté client. Seed = `hash(steamid, parent1_id, parent2_id, server_secret)`.

## Deploy

Voir `scripts/deploy.sh` (à venir). En attendant, sur la VM IONOS :

```bash
git clone <repo> /opt/weedtycoon-backend
cd /opt/weedtycoon-backend
npm ci --omit=dev
cp .env.example .env  # éditer
npm run migrate
# Lancer avec systemd (cf docs/systemd-service.md à venir)
```
