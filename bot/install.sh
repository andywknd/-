#!/usr/bin/env bash
# Установка/обновление бота @digtunnelbot на VPS (Ubuntu 22.04/24.04).
# Запуск:  bash <(curl -fsSL https://raw.githubusercontent.com/andywknd/-/main/bot/install.sh)
set -euo pipefail

REPO="https://github.com/andywknd/-.git"
DIR="/opt/digtunnel"

echo "==> Пакеты (1–2 минуты)"
NEED=""
command -v git >/dev/null || NEED="$NEED git"
python3 -c "import venv, ensurepip" 2>/dev/null || NEED="$NEED python3-venv python3-pip"
if [ -n "$NEED" ]; then
  echo "    ставлю:$NEED"
  # ждём, если apt занят автообновлением
  for i in $(seq 1 60); do fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || break; echo "    apt занят, жду ($i)..."; sleep 5; done
  apt-get update -q || true
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q $NEED
else
  echo "    всё нужное уже есть"
fi

echo "==> Код"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin main && git -C "$DIR" reset -q --hard origin/main
else
  rm -rf "$DIR"; git clone -q --depth 1 "$REPO" "$DIR"
fi

echo "==> Python-окружение"
python3 -m venv "$DIR/venv"
"$DIR/venv/bin/pip" install -q -r "$DIR/bot/requirements.txt"

ENV="$DIR/bot/.env"
if [ ! -f "$ENV" ] && [ -f /opt/digtunnel-env ]; then cp /opt/digtunnel-env "$ENV"; fi
if [ ! -f "$ENV" ]; then
  echo
  read -r -p "Вставь токен бота @digtunnelbot из BotFather: " TOKEN </dev/tty
  cat > "$ENV" <<EOF
BOT_TOKEN=$TOKEN
GAME_URL=https://andywknd.github.io/-/
APP_SHORT=play
BOT_USERNAME=digtunnelbot
ADMINS=643643
EOF
  chmod 600 "$ENV"
fi
cp "$ENV" /opt/digtunnel-env   # копия переживёт переустановку

echo "==> Сервис systemd"
cat > /etc/systemd/system/digtunnel-bot.service <<EOF
[Unit]
Description=digtunnelbot (Telegram)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$DIR/bot
ExecStart=$DIR/venv/bin/python $DIR/bot/bot.py
Restart=always
RestartSec=3
User=root
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q digtunnel-bot
systemctl restart digtunnel-bot
sleep 4
systemctl --no-pager --lines=8 status digtunnel-bot || true
echo
echo "✅ Готово. Логи: journalctl -u digtunnel-bot -f"
