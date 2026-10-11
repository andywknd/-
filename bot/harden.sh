#!/usr/bin/env bash
# Защита SSH от подбора пароля. Штампик, Caddy и бота не трогает.
# Запуск:            bash <(curl -fsSL https://raw.githubusercontent.com/andywknd/-/main/bot/harden.sh)
# Только по ключу:   bash <(curl -fsSL https://raw.githubusercontent.com/andywknd/-/main/bot/harden.sh) --keys-only
set -euo pipefail
echo "==> fail2ban: бан IP на 1 час после 5 неудачных попыток входа"
command -v fail2ban-client >/dev/null || { apt-get update -q; DEBIAN_FRONTEND=noninteractive apt-get install -y -q fail2ban; }
cat > /etc/fail2ban/jail.d/digtunnel-sshd.local <<'J'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
bantime.increment = true
J
systemctl enable -q fail2ban; systemctl restart fail2ban
echo "==> SSH: не больше 3 попыток пароля за подключение"
mkdir -p /etc/ssh/sshd_config.d
echo "MaxAuthTries 3" > /etc/ssh/sshd_config.d/10-digtunnel.conf
if [ "${1:-}" = "--keys-only" ]; then
  if [ -s /root/.ssh/authorized_keys ]; then
    echo; echo "⚠️ Сейчас отключу вход по паролю. Убедись, что Termius входит по КЛЮЧУ (Host → Keys)."
    read -r -p "Напиши ДА, если уверен: " OK </dev/tty
    if [ "$OK" = "ДА" ]; then echo "PasswordAuthentication no" >> /etc/ssh/sshd_config.d/10-digtunnel.conf; echo "    вход по паролю отключён"; fi
  else echo "    ключей нет — вход по паролю оставляю"; fi
fi
sshd -t && systemctl reload ssh
sleep 2
echo; fail2ban-client status sshd | sed -n '1,8p'
echo "✅ Готово. Уже забаненные IP видны выше (Currently banned)."
