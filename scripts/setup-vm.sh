#!/usr/bin/env bash
# =============================================================================
# Weed Tycoon — VPS Setup Script (Ubuntu 24.04)
# =============================================================================
# Usage (en tant que root) :
#   curl -fsSL https://... | bash    (plus tard quand on aura un repo)
# OU pour l'instant, paste ce fichier dans /root/setup-vm.sh et :
#   chmod +x /root/setup-vm.sh
#   ./setup-vm.sh
#
# IDEMPOTENT : tu peux le re-run, il skippe ce qui est déjà fait.
# NE TOUCHE PAS au SSH config — on fait le hardening après en interactif.
# =============================================================================

set -euo pipefail

# === CONFIG (édite si besoin) ===
USERNAME="${USERNAME:-hamza}"
TIMEZONE="${TIMEZONE:-Europe/Paris}"
# ================================

log() { echo -e "\n\033[1;36m==> $1\033[0m"; }

# -----------------------------------------------------------------------------
log "1/9 System update + timezone"
# -----------------------------------------------------------------------------
timedatectl set-timezone "$TIMEZONE" || true
apt update
DEBIAN_FRONTEND=noninteractive apt -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" upgrade -y

# -----------------------------------------------------------------------------
log "2/9 Essential packages"
# -----------------------------------------------------------------------------
apt install -y \
    curl wget git unzip \
    build-essential \
    ufw fail2ban \
    nginx \
    certbot python3-certbot-nginx \
    htop ncdu \
    ca-certificates gnupg lsb-release \
    software-properties-common

# -----------------------------------------------------------------------------
log "3/9 Non-root user '$USERNAME'"
# -----------------------------------------------------------------------------
if ! id "$USERNAME" &>/dev/null; then
    adduser --disabled-password --gecos "" "$USERNAME"
    echo ""
    echo "⚠ User '$USERNAME' created WITHOUT a password (SSH key login only)."
    echo "  Si tu veux un password : passwd $USERNAME"
fi
usermod -aG sudo "$USERNAME"
# Préserve la home permissions
chown -R "$USERNAME:$USERNAME" "/home/$USERNAME"
mkdir -p "/home/$USERNAME/.ssh"
chmod 700 "/home/$USERNAME/.ssh"
chown "$USERNAME:$USERNAME" "/home/$USERNAME/.ssh"

# -----------------------------------------------------------------------------
log "4/9 Firewall (ufw)"
# -----------------------------------------------------------------------------
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp     # HTTP (cert renewal + redirect)
ufw allow 443/tcp    # HTTPS (backend nginx)
ufw allow 27015/udp  # sbox-server game port (default)
ufw allow 27016/udp  # sbox-server query port (default)
ufw --force enable
ufw status verbose

# -----------------------------------------------------------------------------
log "5/9 fail2ban (anti brute-force SSH)"
# -----------------------------------------------------------------------------
systemctl enable --now fail2ban
fail2ban-client status sshd || true

# -----------------------------------------------------------------------------
log "6/9 Node.js 20 LTS"
# -----------------------------------------------------------------------------
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* && "$(node -v)" != v22* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi
node -v
npm -v

# -----------------------------------------------------------------------------
log "7/9 Backend clone + install"
# -----------------------------------------------------------------------------
DEPLOY_DIR="/opt/weedtycoon-backend"
REPO_URL="${REPO_URL:-https://github.com/klibato/weed-tycoon.git}"

# Clone en root (a tous les droits sur /opt), puis chown vers $USERNAME.
# Évite le "Permission denied" du sudo -u hamza dans /opt.
# safe.directory exception : sinon git refuse les ops root sur un repo chown'd hamza.
git config --global --add safe.directory "$DEPLOY_DIR"

if [[ ! -d "$DEPLOY_DIR/.git" ]]; then
    rm -rf "$DEPLOY_DIR" 2>/dev/null || true
    git clone "$REPO_URL" "$DEPLOY_DIR"
else
    git -C "$DEPLOY_DIR" pull --ff-only
fi
chown -R "$USERNAME:$USERNAME" "$DEPLOY_DIR"

# Install deps (omit dev pour prod). better-sqlite3 nécessite build-essential déjà installé.
# HOME nécessaire pour que npm écrive son cache + tmp ; -H force l'env de l'user.
# Fallback : si package-lock.json absent (premier deploy), utilise npm install pour le générer.
if [[ -f "$DEPLOY_DIR/package-lock.json" ]]; then
    sudo -u "$USERNAME" -H bash -c "cd '$DEPLOY_DIR' && npm ci --omit=dev --no-audit --no-fund"
else
    sudo -u "$USERNAME" -H bash -c "cd '$DEPLOY_DIR' && npm install --omit=dev --no-audit --no-fund"
fi

# Init .env si pas déjà présent (Hamza édite ensuite manuellement pour les secrets)
if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
    sudo -u "$USERNAME" cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
    echo "⚠ .env créé depuis le template — EDITE-LE pour mettre tes vrais secrets :"
    echo "    nano $DEPLOY_DIR/.env"
    echo "    # JWT_SECRET, HMAC_RESPONSE_SECRET → générer avec :"
    echo "    #   node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
fi

# Crée le dossier data pour SQLite si pas présent
sudo -u "$USERNAME" mkdir -p "$DEPLOY_DIR/data"

# -----------------------------------------------------------------------------
log "8/9 SteamCMD (pour sbox dedicated server plus tard)"
# -----------------------------------------------------------------------------
if ! command -v steamcmd &>/dev/null; then
    add-apt-repository -y multiverse
    dpkg --add-architecture i386
    apt update
    echo steam steam/question select "I AGREE" | debconf-set-selections
    echo steam steam/license note '' | debconf-set-selections
    DEBIAN_FRONTEND=noninteractive apt install -y steamcmd
fi

# -----------------------------------------------------------------------------
log "9/9 .NET 8 Runtime (requis pour sbox-server sur Linux)"
# -----------------------------------------------------------------------------
if ! command -v dotnet &>/dev/null; then
    wget -q https://packages.microsoft.com/config/ubuntu/24.04/packages-microsoft-prod.deb -O /tmp/ms-prod.deb
    dpkg -i /tmp/ms-prod.deb
    rm /tmp/ms-prod.deb
    apt update
    apt install -y dotnet-runtime-8.0
fi
dotnet --list-runtimes

# -----------------------------------------------------------------------------
echo ""
echo "============================================================"
echo "✅ Base install DONE."
echo ""
echo "Prochaines étapes (à faire en interactif avec Claude) :"
echo "  1. Coller ta clé SSH publique dans /home/$USERNAME/.ssh/authorized_keys"
echo "  2. Tester login : ssh $USERNAME@<ip>"
echo "  3. Désactiver root SSH + password auth"
echo "  4. Cloner le backend dans /opt/weedtycoon-backend"
echo "  5. Setup DuckDNS subdomain + nginx + Let's Encrypt"
echo "  6. systemd service pour backend"
echo ""
echo "Logs ufw : sudo ufw status verbose"
echo "Logs fail2ban : sudo fail2ban-client status sshd"
echo "============================================================"
