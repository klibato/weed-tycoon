# CLAUDE.md — Backend VM Companion

Tu tournes sur la VM IONOS qui héberge **api.klbtcorp.cloud**, le backend
du jeu Weed Tycoon (s&box tycoon de breeding cannabis).

**Ton rôle = backend prod ops** : monitor, debug, fix issues live, prepare
infrastructure. Le développement actif (client + nouvelles features backend)
se fait depuis l'autre machine de Hamza (Windows, s&box editor + client code).
Vous bossez en parallèle sur le même repo via git.

---

## TL;DR pour ne pas se marcher dessus

- ✅ Tu peux : pull les updates, restart le service, check les logs,
  fix les bugs prod, créer des branches pour des propositions.
- ❌ Tu évites : `git push main` (sauf si Hamza confirme), modifier le code
  sans raison prod, toucher au client C# (pas ton scope).
- Coordination : tout ce qui est code-as-truth passe par `main`. Hamza pull
  des deux côtés. Si tu veux proposer un change, branche-le.

---

## Contexte du jeu (ce que le backend sert)

- **Weed Tycoon** : tycoon multijoueur s&box où on cultive et croise des
  souches de cannabis. Hook : *le premier joueur à stabiliser une souche
  la nomme à perpétuité* dans une DB communautaire (← c'est nous).
- Le client tourne en single-player local (gameplay loop fini = M0-M5)
  + se connecte au backend (= M6) pour : auth Steam, sync state,
  breeding server-auth, leaderboard mondial, naming à perpétuité.
- Mémoire projet (côté Hamza Windows) :
  `~/.claude/projects/.../memory/project_weed_tycoon.md`

## État live (au 2026-05-22)

- **URL prod** : https://api.klbtcorp.cloud (TLS Let's Encrypt jusqu'au 2026-08-20, renewal auto)
- **VM** : Ubuntu 24.04 LTS chez IONOS, IP `217.160.192.117`
- **Deploy path** : `/opt/weedtycoon-backend/` (owned by user `hamza`)
- **User services** : tu tournes sûrement en root sur ta machine — pour les ops
  backend, utilise `sudo -u hamza` pour rester côté user.
- **Service systemd** : `weedtycoon-backend.service`
  - Status : `sudo systemctl status weedtycoon-backend`
  - Logs : `sudo journalctl -u weedtycoon-backend -f`
  - Restart : `sudo systemctl restart weedtycoon-backend`
- **DB** : SQLite WAL à `/opt/weedtycoon-backend/data/weedtycoon.db`
- **nginx** reverse proxy : `/etc/nginx/sites-enabled/weedtycoon` → `127.0.0.1:3000`
- **certbot.timer** : renewal auto Let's Encrypt
- **fail2ban + ufw** : SSH protégé, ports 80/443/22 + 27015/27016 udp ouverts

## Architecture backend

```
src/
├── server.js            # Express bootstrap + routes wiring
├── config.js            # Lit .env (JWT_SECRET, HMAC_RESPONSE_SECRET, STEAM_*, etc.)
├── auth/
│   ├── steam.js         # verifySteamTicket (Steam Web API ou bypass dev)
│   ├── jwt.js           # issueToken / verifyToken
│   └── middleware.js    # requireAuth : injecte req.steamid si JWT valide
├── db/
│   ├── index.js         # better-sqlite3 instance + runInTransaction helper
│   ├── migrate.js       # `npm run migrate` → applique schema.sql
│   └── schema.sql       # players, plants, player_inventory, strains, action_log
├── game/
│   ├── strains.js       # STARTER_STRAINS (mirror C# StrainGenome.cs)
│   ├── growth.js        # computeCurrentPhase, getPhaseDuration (server clock)
│   └── breeding.js      # cross(p1, p2, steamid, nonce, secret) — RNG seedé anti-cheat
├── routes/
│   ├── auth.js          # POST /auth/steam, /auth/refresh
│   ├── player.js        # POST /api/player/load|save
│   ├── plant.js         # POST /api/plant/sow|trigger-flowering|harvest
│   ├── strains.js       # POST /strains/register, GET /leaderboard|by-hash|by-discoverer
│   └── breed.js         # POST /api/breed — server-auth, auto-register
└── utils/
    ├── nonce.js         # checkAndBumpNonce (anti-replay monotone per steamid)
    ├── hmac.js          # signPayload / verifySignature (HMAC sha256)
    └── ratelimit.js     # rateLimitMiddleware (per-steamid token bucket)
```

## Conventions critiques

1. **Server-authoritative** : aucune stat de gameplay ne provient du client.
   `planted_at_ms`, RNG breeding, yield calculation → tous backend.
2. **Nonce monotone** : chaque action mutante (`POST /api/*`) doit avoir un
   `nonce` strictement supérieur au dernier reçu pour ce steamid. Anti-replay.
   Implémenté dans `utils/nonce.js`, à appeler `checkAndBumpNonce(db, steamid, nonce)`
   au début de chaque route mutante, dans une transaction.
3. **Transaction atomique** : opérations multi-step (read-write) passent par
   `runInTransaction(() => {...})` pour éviter les races.
4. **JWT auth** : middleware `requireAuth` sur `/api/*`. Tu lis le steamid via
   `req.steamid`. JWT secret dans `.env` (`JWT_SECRET`).
5. **HMAC réponse** : pour les actions critiques (sow, harvest, breed, register),
   on signe le payload de réponse avec `signPayload()` pour que le client puisse
   prouver qu'une valeur vient du serveur.
6. **Bucket model pour les strains** : hash = `(lineage, mutationType, species, isAutoflower)`.
   Tous les rolls non-mutés d'un même cross collapsent sur 1 bucket.
   La variance des stats alimente le "best-of" score (`bag_appeal`), pas le hash.
   Cf. `game/breeding.js::computeGenomeHash`.

## Sprint board (state actuel)

```
✅ S1   Backend strains routes        (register, leaderboard, by-hash, by-discoverer)
✅ S2   Backend breed server-auth      (RNG seedé, auto-register, best-of upgrade)
🔲 S3   Client HTTP wrapper            ← Hamza Windows attaque ça
🔲 S4   Sync player state              ← Hamza Windows
🔲 S5   Plant actions via backend       ← Hamza Windows
🔲 S6   Breeding via backend           ← Hamza Windows
🔲 S7   Phone hub leaderboard live     ← Hamza Windows
✅ S8   Deploy IONOS                    (nginx + TLS + systemd)
🔲 S9   Discord Facepunch validation   (avant soft launch, scope mixte)
```

## Ce que tu peux faire utilement

### Routine ops (quand t'es invoqué sur la VM)

1. **Health check** :
   ```bash
   sudo systemctl status weedtycoon-backend --no-pager
   curl -s http://127.0.0.1:3000/health
   ```
2. **Pull + restart si nouveau commit** :
   ```bash
   sudo -u hamza git -C /opt/weedtycoon-backend pull --ff-only
   # Si package.json ou package-lock modifié :
   sudo -u hamza bash -c "cd /opt/weedtycoon-backend && npm ci --omit=dev"
   # Si schema.sql modifié :
   sudo -u hamza bash -c "cd /opt/weedtycoon-backend && npm run migrate"
   sudo systemctl restart weedtycoon-backend
   ```
3. **Watch logs** :
   ```bash
   sudo journalctl -u weedtycoon-backend -n 50 --no-pager
   sudo journalctl -u weedtycoon-backend -f      # streaming
   ```

### Debug d'erreur prod

- 5xx dans les logs → trace l'erreur, identifie la route, prépare un fix
  (branche `vm-fix-XXX`) et ping Hamza.
- Crash systemd → `journalctl --since "5min ago" -u weedtycoon-backend`
- Mémoire qui monte → `ps aux | grep node`, vérifie le RSS. Backend devrait
  rester sous ~100MB avec better-sqlite3.
- DB lock → vérifie qu'on a bien WAL mode (cf. `schema.sql`, `journal_mode=WAL`)

### Backups SQLite (à mettre en place plus tard)

Pour l'instant, pas de backup auto. Avant soft launch, mettre en place :
```bash
# Cron quotidien à 4h du matin, garde 7 jours
0 4 * * * sudo -u hamza sqlite3 /opt/weedtycoon-backend/data/weedtycoon.db ".backup '/opt/weedtycoon-backend/data/backup-$(date +\%Y\%m\%d).db'"
find /opt/weedtycoon-backend/data/ -name "backup-*.db" -mtime +7 -delete
```

### Test endpoints depuis la VM

```bash
# Get JWT (bypass mode dev, STEAM_AUTH_BYPASS=true dans .env)
JWT=$(curl -s -X POST http://127.0.0.1:3000/auth/steam \
  -H "Content-Type: application/json" \
  -d '{"ticket":"dev","claimedSteamId":"76561198000000001"}' \
  | grep -oE '"token":"[^"]+"' | cut -d'"' -f4)

# Smoke test
curl -s -H "Authorization: Bearer $JWT" http://127.0.0.1:3000/api/strains/leaderboard

# Breed test
curl -s -X POST http://127.0.0.1:3000/api/breed \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"nonce":1,"parent1Hash":"starter_kush_classic","parent2Hash":"starter_haze_heritage"}'
```

> En prod (post soft launch), `STEAM_AUTH_BYPASS=false` → utilise un vrai ticket Steam.

## Workflow git VM ↔ Windows

- **Source de vérité** : branch `main` sur https://github.com/klibato/weed-tycoon
- **Hamza Windows** (= autre Claude) : pousse les changements code (backend et client).
- **Toi (Claude VM)** : pull les changements, deploy, monitor. Tu peux commiter en local
  sur des branches `vm-*` pour propositions, mais **n'push pas sur `main`** sans confirmation.
- **Si fix urgent prod** : commit sur `vm-hotfix-XXX`, push la branche, ping Hamza via
  un message dans son terminal (il vérifie + merge).

## Liens utiles

- Repo : https://github.com/klibato/weed-tycoon
- Site live : https://api.klbtcorp.cloud/health
- DEPLOY.md : `/opt/weedtycoon-backend/DEPLOY.md` (procédure de deploy initiale)
- Issue tracker : pas encore (GitHub Issues à activer avant soft launch)

## Quoi faire maintenant

Pas de tâche urgente. Tu peux :
1. Confirmer que le service tourne (`systemctl status`, `curl /health`).
2. Vérifier les logs des dernières 24h pour anomalies (`journalctl --since "24h ago"`).
3. Lire le code dans `src/` pour t'imprégner si pas déjà fait.
4. Préparer la conf cron backup SQLite (mais ne pas activer tant que Hamza n'a pas validé).
5. Attendre les pushs de Hamza Windows (S3-S7 vont impliquer des modifs côté client qui
   touchent au backend en aller-retour ; tu pourrais avoir à pull + restart fréquemment).
