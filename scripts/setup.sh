#!/bin/bash
# OnesiBox Device Setup Script
# Run this on a fresh Raspberry Pi OS installation

set -e

echo "=== OnesiBox Device Setup ==="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo ./setup.sh)"
  exit 1
fi

echo ""
echo "Step 1: Updating system..."
apt update && apt upgrade -y

echo ""
echo "Step 2: Installing Node.js 20 LTS..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi
echo "Node.js version: $(node --version)"

echo ""
echo "Step 3: Installing Chromium and display dependencies..."
apt install -y \
  chromium \
  xserver-xorg \
  x11-xserver-utils \
  xinit \
  openbox \
  xdotool

echo ""
echo "Step 4: Installing audio tools..."
apt install -y alsa-utils

echo ""
echo "Step 5: Installing webcam tools..."
apt install -y v4l-utils

echo ""
echo "Step 6: Creating onesibox user..."
if ! id "onesibox" &>/dev/null; then
  useradd -m -s /bin/bash onesibox
  usermod -aG video,audio,input onesibox
fi

echo ""
echo "Step 7: Setting up application directory..."
mkdir -p /opt/onesibox
mkdir -p /var/log/onesibox
chown -R onesibox:onesibox /opt/onesibox
chown -R onesibox:onesibox /var/log/onesibox

echo ""
echo "Step 8: Installing OnesiBox application..."
if [ -d "/opt/onesibox/src" ]; then
  echo "Application already installed, updating..."
  cd /opt/onesibox
  git pull origin main || true
else
  echo "Fresh installation..."
  # Clone would happen here in production
  # git clone https://github.com/onesiphorus-team/onesibox-client.git /opt/onesibox
fi

if [ -f "/opt/onesibox/package.json" ]; then
  cd /opt/onesibox
  npm install --production
fi

echo ""
echo "Step 9: Setting up systemd service..."
cp /opt/onesibox/scripts/onesibox.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable onesibox

echo ""
echo "Step 10: Configuring auto-login..."
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/override.conf << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin onesibox --noclear %I \$TERM
EOF

echo ""
echo "Step 11: Configuring X autostart..."
su - onesibox -c 'mkdir -p ~/.config/openbox'
su - onesibox -c 'cp /opt/onesibox/scripts/start-kiosk.sh ~/.config/openbox/autostart'
su - onesibox -c 'echo "[[ -z \$DISPLAY && \$XDG_VTNR -eq 1 ]] && startx" >> ~/.bash_profile'

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Copy config.json.example to config.json and edit with your settings"
echo "2. Reboot the device: sudo reboot"
echo "3. The device should boot to the standby screen"
echo ""
