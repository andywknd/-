#!/usr/bin/env bash
# Установка/обновление бота @digtunnelbot на VPS (Ubuntu 22.04/24.04).
# Запуск:  bash <(curl -fsSL https://raw.githubusercontent.com/andywknd/-/main/bot/install.sh)
# Штампик и другие сервисы не трогает: всё ставится в /opt/digtunnel, свой пользователь, свой сервис,
# в nginx добавляется только отдельный server-блок для адреса статистики.
set -euo pipefail

REPO="https://github.com/andywknd/-.git"
DIR="/opt/digtunnel"
SVC_USER="digtunnel"

echo "==> 1/6 Пакеты (1–2 минуты)"
NEED=""
command -v git >/dev/null || NEED="$NEED git"
command -v curl >/dev/null || NEED="$NEED curl"
python3 -c "import venv, ensurepip" 2>/dev/null || NEED="$NEED python3-venv python3-pip"
if [ -n "$NEED" ]; then
  echo "    ставлю:$NEED"
  for i in $(seq 1 60); do fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || break; echo "    apt занят, жду ($i)..."; sleep 5; done
  apt-get update -q || true
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q $NEED
else
  echo "    всё нужное уже есть"
fi

echo "==> 2/6 Код"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin main && git -C "$DIR" reset -q --hard origin/main
else
  rm -rf "$DIR"; git clone -q --depth 1 "$REPO" "$DIR"
fi

echo "==> 3/6 Python-окружение"
[ -x "$DIR/venv/bin/python" ] || python3 -m venv "$DIR/venv"
"$DIR/venv/bin/pip" install -q -r "$DIR/bot/requirements.txt"

echo "==> 4/6 Настройки и токен"
ENV="$DIR/bot/.env"
if [ ! -f "$ENV" ] && [ -f /opt/digtunnel-env ]; then cp /opt/digtunnel-env "$ENV"; fi
if [ "${1:-}" = "--token" ] && [ -f "$ENV" ]; then
  read -r -p "Вставь НОВЫЙ токен бота из BotFather и нажми Enter: " TOKEN </dev/tty
  TOKEN="$(echo "$TOKEN" | tr -d '[:space:]')"
  sed -i "s|^BOT_TOKEN=.*|BOT_TOKEN=$TOKEN|" "$ENV"
  echo "    токен заменён"
fi
if [ ! -f "$ENV" ]; then
  echo
  read -r -p "Вставь токен бота @digtunnelbot из BotFather и нажми Enter: " TOKEN </dev/tty
  TOKEN="$(echo "$TOKEN" | tr -d '[:space:]')"
  cat > "$ENV" <<EOF
BOT_TOKEN=$TOKEN
GAME_URL=https://andywknd.github.io/-/
APP_SHORT=play
BOT_USERNAME=digtunnelbot
ADMINS=643643
EOF
fi

echo "==> 5/6 HTTPS-адрес для статистики"
IP="$(curl -4 -fsS --max-time 8 https://api.ipify.org || curl -4 -fsS --max-time 8 https://ifconfig.me || true)"
API_URL=""
if [ -n "$IP" ]; then
  HOST="${IP//./-}.sslip.io"
  PORT80="$(ss -ltnp '( sport = :80 )' 2>/dev/null | tail -n +2 || true)"
  if echo "$PORT80" | grep -q caddy; then
    # На сервере уже работает Caddy (например, для Штампика) — добавляем свой адрес в его конфиг
    CF="$(systemctl cat caddy 2>/dev/null | grep -o -- '--config [^ ]*' | head -1 | cut -d' ' -f2)"; CF="${CF:-/etc/caddy/Caddyfile}"
    if [ -f "$CF" ] && ! grep -q '^[[:space:]]*{[[:space:]]*"' "$CF"; then
      if ! grep -q "$HOST" "$CF"; then
        cp "$CF" "$CF.bak-digtunnel"
        printf '\n# digtunnel: статистика игры «Докопаться до Америки»\n%s {\n\thandle /api/* {\n\t\treverse_proxy 127.0.0.1:8090\n\t}\n\trespond 404\n}\n' "$HOST" >> "$CF"
      fi
      if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
        systemctl reload caddy && API_URL="https://$HOST/api" && echo "    ✅ адрес добавлен в Caddy: $API_URL (сертификат Caddy получит сам за ~1 минуту)"
      else
        echo "    ⚠️ Caddy не принял конфиг — возвращаю как было"; [ -f "$CF.bak-digtunnel" ] && cp "$CF.bak-digtunnel" "$CF"
      fi
    else
      echo "    ⚠️ Не нашёл Caddyfile — статистика из игры будет выключена"
    fi
  elif [ -n "$PORT80" ] && ! echo "$PORT80" | grep -q nginx; then
    echo "    ⚠️ Порт 80 занят не nginx — пропускаю HTTPS. Игра и бот работают, статистика из игры будет выключена."
    echo "$PORT80" | head -3
  else
    command -v nginx >/dev/null || { echo "    ставлю nginx"; DEBIAN_FRONTEND=noninteractive apt-get install -y -q nginx; }
    mkdir -p /var/www/digtunnel-acme
    echo 'limit_req_zone $binary_remote_addr zone=digapi:10m rate=20r/s;' > /etc/nginx/conf.d/digtunnel-zone.conf
    grep -q "worker_connections 768;" /etc/nginx/nginx.conf && sed -i 's/worker_connections 768;/worker_connections 4096;/' /etc/nginx/nginx.conf || true
    SITE=/etc/nginx/sites-available/digtunnel
    if [ ! -f "$SITE" ] || ! grep -q "ssl_certificate" "$SITE"; then
      cat > "$SITE" <<EOF
server {
    listen 80;
    server_name $HOST;
    server_tokens off;
    location /.well-known/acme-challenge/ { root /var/www/digtunnel-acme; }
    location /api/ {
        limit_req zone=digapi burst=100 nodelay;
        client_max_body_size 32k;
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 10s;
    }
    location / { return 404; }
}
EOF
    fi
    ln -sf "$SITE" /etc/nginx/sites-enabled/digtunnel
    if nginx -t >/dev/null 2>&1; then systemctl reload nginx || systemctl restart nginx; else
      echo "    ⚠️ nginx -t не прошёл, убираю свой конфиг"; rm -f /etc/nginx/sites-enabled/digtunnel /etc/nginx/conf.d/digtunnel-zone.conf; nginx -t; HOST=""; fi
    if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi
    if [ -n "${HOST:-}" ]; then
      if grep -q "ssl_certificate" "$SITE"; then
        echo "    сертификат уже есть"; API_URL="https://$HOST/api"
      else
        command -v certbot >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -q certbot python3-certbot-nginx
        if certbot --nginx -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email --redirect >/tmp/digtunnel-certbot.log 2>&1; then
          echo "    ✅ сертификат Let's Encrypt получен"; API_URL="https://$HOST/api"
        else
          echo "    Let's Encrypt не дал сертификат (лимиты sslip.io), пробую ZeroSSL…"
          [ -x /root/.acme.sh/acme.sh ] || curl -fsSL https://get.acme.sh | sh -s email="digtunnel@$HOST" >/dev/null 2>&1
          mkdir -p /etc/ssl/digtunnel
          if /root/.acme.sh/acme.sh --issue --server zerossl -d "$HOST" -w /var/www/digtunnel-acme >/tmp/digtunnel-acme.log 2>&1 || /root/.acme.sh/acme.sh --list | grep -q "$HOST"; then
            /root/.acme.sh/acme.sh --install-cert -d "$HOST" --key-file /etc/ssl/digtunnel/key.pem --fullchain-file /etc/ssl/digtunnel/full.pem --reloadcmd "systemctl reload nginx" >/dev/null 2>&1
            cat >> "$SITE" <<EOF
server {
    listen 443 ssl;
    server_name $HOST;
    server_tokens off;
    ssl_certificate /etc/ssl/digtunnel/full.pem;
    ssl_certificate_key /etc/ssl/digtunnel/key.pem;
    location /api/ {
        limit_req zone=digapi burst=100 nodelay;
        client_max_body_size 32k;
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 10s;
    }
    location / { return 404; }
}
EOF
            nginx -t && systemctl reload nginx && { echo "    ✅ сертификат ZeroSSL получен"; API_URL="https://$HOST/api"; }
          else
            echo "    ⚠️ HTTPS не получился (лог: /tmp/digtunnel-certbot.log, /tmp/digtunnel-acme.log). Бот работает, статистика из игры выключена."
          fi
        fi
      fi
    fi
  fi
fi
sed -i '/^API_URL=/d' "$ENV"; [ -n "$API_URL" ] && echo "API_URL=$API_URL" >> "$ENV"
cp "$ENV" /opt/digtunnel-env; chmod 600 /opt/digtunnel-env

echo "==> 6/6 Сервис"
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
chown -R "$SVC_USER":"$SVC_USER" "$DIR/bot"
chmod 600 "$ENV"
cat > /etc/systemd/system/digtunnel-bot.service <<EOF
[Unit]
Description=digtunnelbot (Telegram)
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC_USER
WorkingDirectory=$DIR/bot
ExecStart=$DIR/venv/bin/python $DIR/bot/bot.py
Restart=always
RestartSec=3
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$DIR/bot

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q digtunnel-bot
systemctl restart digtunnel-bot
sleep 4
systemctl --no-pager --lines=6 status digtunnel-bot || true
echo
if [ -n "$API_URL" ]; then
  for i in $(seq 1 12); do curl -fsS --max-time 5 "$API_URL/health" >/dev/null 2>&1 && break; echo "    жду сертификат ($i/12)…"; sleep 10; done
  curl -fsS --max-time 5 "$API_URL/health" >/dev/null 2>&1 && echo "✅ Статистика доступна: $API_URL" || echo "⚠️ $API_URL пока не отвечает — проверь через пару минут: curl $API_URL/health"
fi
echo "✅ Готово. Логи: journalctl -u digtunnel-bot -f"
echo "Дальше: напиши боту /links и перешли ответ Claude."
