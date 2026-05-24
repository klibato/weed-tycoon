# Radio deploy — push v0.1.5

Workflow pour déployer les nouvelles routes radio + uploader les .ogg sur la VM IONOS.

## 1. Commit + push le code (depuis local)

```bash
cd ~/Documents/"s&box projects"/my_project_2-backend
git add .gitignore src/ public/radio/.gitkeep DEPLOY-radio.md
git commit -m "feat: radio playlist endpoint + static .ogg serving"
git push origin main
```

Les .ogg sont gitignorés (trop gros pour git), uploadés séparément via scp.

## 2. Pull + restart le service (sur la VM)

```bash
ssh hamza@217.160.192.117
cd /opt/weedtycoon-backend
git pull
npm ci --omit=dev   # au cas où nouvelles deps (ici pas de new dep, mais safe)

# Créer le dossier qui contiendra les .ogg
sudo -u hamza mkdir -p /opt/weedtycoon-backend/public/radio
```

## 3. Upload les .ogg (depuis local)

```bash
scp ~/Documents/"s&box projects"/my_project_2-backend/public/radio/*.ogg \
    hamza@217.160.192.117:/opt/weedtycoon-backend/public/radio/
```

Vérifie côté VM :

```bash
ssh hamza@217.160.192.117 "ls -lh /opt/weedtycoon-backend/public/radio/"
# Devrait montrer 4 fichiers : whispers_jazz_noir, go_home, i_chase_the_devil, alborosie_waan_the_herb
```

## 4. Ajoute la baseUrl prod au .env (sur la VM)

```bash
ssh hamza@217.160.192.117
sudo nano /opt/weedtycoon-backend/.env

# Ajoute :
RADIO_BASE_URL=https://api.klbtcorp.cloud/radio/static
RADIO_STATIC_DIR=/opt/weedtycoon-backend/public/radio
```

## 5. Whitelist le dossier dans systemd (sur la VM)

Le service tourne en `ProtectSystem=strict`. Le `public/radio/` doit être readable mais c'est juste read donc OK par défaut. Pas de modif nécessaire au service.

Restart :

```bash
sudo systemctl restart weedtycoon-backend
sudo systemctl status weedtycoon-backend
```

## 6. Validation

```bash
# Sanity check côté serveur
curl -s https://api.klbtcorp.cloud/radio/playlist | jq

# Doit retourner :
# {
#   "ok": true,
#   "tracks": [
#     {"id":"whispers_jazz_noir","title":"Whispers & Jazz","artist":"Vintage 1940s Noir","url":"https://api.klbtcorp.cloud/radio/static/whispers_jazz_noir.ogg","durationSec":3600},
#     ...
#   ]
# }

# Healthcheck fichiers
curl -s https://api.klbtcorp.cloud/radio/health | jq

# Sanity check d'un fichier .ogg (devrait return 206 Partial Content ou 200, et un Content-Type audio/ogg)
curl -sI https://api.klbtcorp.cloud/radio/static/go_home.ogg | head -5
```

## 7. (Optionnel, plus tard) nginx serve les .ogg directement

Pour soulager Node de servir les gros fichiers, ajoute un location nginx avant le proxy generic :

```nginx
# Dans /etc/nginx/sites-available/weedtycoon, AVANT le `location /` :
location /radio/static/ {
    alias /opt/weedtycoon-backend/public/radio/;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Cache-Control "public, max-age=3600" always;
    access_log off;
}
```

Puis `sudo nginx -t && sudo systemctl reload nginx`.
