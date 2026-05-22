# Deploy on VM (IONOS, vierge Ubuntu 24.04)

Bootstrap d'une VM vierge → backend prod en TLS, end-to-end. Tout dans `scripts/`.

## 0. Avant de commencer

- VM Ubuntu 24.04 LTS, accès root SSH ou root password
- Domaine pointant en A record vers l'IP de la VM (ex `api.tondomaine.com`)
- 2GB RAM minimum (better-sqlite3 build natif consomme un peu)

## 1. Bootstrap système (run en root)

SSH en root, puis :

```bash
# Récupère le script depuis le repo
wget https://raw.githubusercontent.com/klibato/weed-tycoon/main/scripts/setup-vm.sh
chmod +x setup-vm.sh

# Run — installe Node 20 + nginx + certbot + ufw + fail2ban + steamcmd + .NET 8
# + crée l'user 'hamza' + clone le repo dans /opt/weedtycoon-backend + npm ci
./setup-vm.sh
```

Le script est **idempotent** : tu peux le re-run pour pull les updates.

## 2. SSH key pour l'user `hamza`

Encore en root :

```bash
mkdir -p /home/hamza/.ssh
# Colle ta clé publique (depuis ta machine : cat ~/.ssh/id_ed25519.pub)
nano /home/hamza/.ssh/authorized_keys
chown -R hamza:hamza /home/hamza/.ssh
chmod 700 /home/hamza/.ssh
chmod 600 /home/hamza/.ssh/authorized_keys
```

Teste depuis ta machine locale : `ssh hamza@<ip>`. Une fois confirmé que ça marche, désactive SSH root :

```bash
# Dans /etc/ssh/sshd_config :
#   PermitRootLogin no
#   PasswordAuthentication no
nano /etc/ssh/sshd_config
systemctl restart ssh
```

## 3. Configure le .env

```bash
sudo -u hamza nano /opt/weedtycoon-backend/.env
```

Remplis :

```env
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
DB_PATH=/opt/weedtycoon-backend/data/weedtycoon.db

# Génère avec : node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=<64 chars hex>
HMAC_RESPONSE_SECRET=<un autre 64 chars hex, DIFFÉRENT>

JWT_EXPIRES_IN=1h
STEAM_API_KEY=<ta clé depuis steamcommunity.com/dev/apikey>
STEAM_APP_ID=<App ID Steam une fois publié, sinon 0>
STEAM_AUTH_BYPASS=false  # IMPORTANT : false en prod
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=120
```

## 4. Migrate la DB

```bash
sudo -u hamza bash -c "cd /opt/weedtycoon-backend && npm run migrate"
```

Crée les tables (players, plants, strains, etc.).

## 5. systemd service

```bash
sudo cp /opt/weedtycoon-backend/scripts/weedtycoon-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now weedtycoon-backend
sudo systemctl status weedtycoon-backend
```

Logs en live :

```bash
journalctl -u weedtycoon-backend -f
```

Test local :

```bash
curl http://127.0.0.1:3000/health
# → {"status":"ok","uptimeSec":...}
```

## 6. nginx reverse proxy + Let's Encrypt TLS

```bash
sudo cp /opt/weedtycoon-backend/scripts/nginx-weedtycoon.conf /etc/nginx/sites-available/weedtycoon
# Édite le fichier pour mettre ton vrai domaine à la place de YOUR_DOMAIN_HERE
sudo nano /etc/nginx/sites-available/weedtycoon

sudo ln -s /etc/nginx/sites-available/weedtycoon /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # ferme le default
sudo nginx -t                              # vérifie la conf
sudo systemctl reload nginx

# Émet le cert TLS via Let's Encrypt
sudo certbot --nginx -d api.tondomaine.com  # remplace par ton domaine
# Pose toutes les questions (email, agree, redirect HTTPS → yes)
```

Cert renewal auto via certbot.timer (installé par défaut). Test :

```bash
sudo certbot renew --dry-run
```

## 7. Validation finale

Depuis ta machine locale :

```bash
curl https://api.tondomaine.com/health
# → {"status":"ok","uptimeSec":..., "env":"production"}
```

Si tu vois ça, **le backend est live en prod**. 🎉

## Update du code après push

Sur la VM :

```bash
sudo -u hamza bash -c "cd /opt/weedtycoon-backend && git pull && npm ci --omit=dev && npm run migrate"
sudo systemctl restart weedtycoon-backend
```

(Ou re-run `./setup-vm.sh` qui fait la même chose, idempotent.)
