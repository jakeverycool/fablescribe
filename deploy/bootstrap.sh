#!/usr/bin/env bash
# Fablescribe — Hetzner box bootstrap script
# Run ONCE on a fresh Ubuntu 22.04 / 24.04 box to install Docker, set up the
# deploy directory, and pre-stage the compose + caddy files.
#
# Usage (from your local machine):
#   scp deploy/bootstrap.sh root@<box_ip>:/tmp/
#   ssh root@<box_ip> 'bash /tmp/bootstrap.sh'
#
# Then upload the env file:
#   scp deploy/.env.dev root@<dev_box_ip>:/opt/fablescribe/.env
#   scp deploy/.env.prod root@<prod_box_ip>:/opt/fablescribe/.env

set -euo pipefail

DEPLOY_DIR="/opt/fablescribe"
DEPLOY_USER="deploy"

echo "==> Updating apt"
apt-get update
apt-get upgrade -y

echo "==> Installing Docker"
if ! command -v docker > /dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Installing extras"
apt-get install -y curl ca-certificates git ufw fail2ban

echo "==> Configuring firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Creating deploy user"
if ! id "$DEPLOY_USER" &> /dev/null; then
  useradd -m -s /bin/bash "$DEPLOY_USER"
  usermod -aG docker "$DEPLOY_USER"
  mkdir -p "/home/$DEPLOY_USER/.ssh"
  # Copy root's authorized_keys so the same key can deploy
  if [ -f /root/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/"
    chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
    chmod 700 "/home/$DEPLOY_USER/.ssh"
    chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
  fi
fi

echo "==> Creating deploy directory"
mkdir -p "$DEPLOY_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_DIR"

echo "==> Bootstrap complete"
echo ""
echo "Next steps:"
echo "  1. Upload the deploy files:"
echo "     scp deploy/docker-compose.yml deploy/Caddyfile deploy/deploy.sh \\"
echo "         deploy@<box_ip>:$DEPLOY_DIR/"
echo "  2. Upload the env file (NEVER commit this):"
echo "     scp deploy/.env.dev deploy@<dev_box_ip>:$DEPLOY_DIR/.env"
echo "  3. Make scripts executable:"
echo "     ssh deploy@<box_ip> 'chmod +x $DEPLOY_DIR/deploy.sh'"
echo "  4. Run the first deploy:"
echo "     ssh deploy@<box_ip> '$DEPLOY_DIR/deploy.sh'"
