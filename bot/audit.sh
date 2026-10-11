#!/usr/bin/env bash
# Быстрый аудит безопасности и нагрузки сервера. Ничего не меняет — только показывает.
# Запуск: bash <(curl -fsSL https://raw.githubusercontent.com/andywknd/-/main/bot/audit.sh)
echo "===== СИСТЕМА ====="
. /etc/os-release; echo "ОС: $PRETTY_NAME, ядро $(uname -r)"
echo "CPU: $(nproc) ядер · RAM: $(free -h | awk '/Mem/{print $2" всего, "$7" свободно"}') · диск: $(df -h / | awk 'NR==2{print $4" свободно из "$2}')"
echo "Нагрузка: $(cut -d' ' -f1-3 /proc/loadavg)"
echo "Ожидают обновления безопасности: $(apt list --upgradable 2>/dev/null | grep -c -i security)"
echo "Автообновления безопасности: $(systemctl is-enabled unattended-upgrades 2>/dev/null || echo нет)"
echo
echo "===== SSH ====="
sshd -T 2>/dev/null | grep -E "^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|maxauthtries) " || echo "sshd -T недоступен"
echo "Неудачных входов за сутки: $(journalctl -u ssh -u sshd --since '24 hours ago' 2>/dev/null | grep -c -E 'Failed password|Invalid user')"
echo "Ключей в authorized_keys: $(grep -c . /root/.ssh/authorized_keys 2>/dev/null || echo 0)"
echo
echo "===== ОТКРЫТЫЕ ПОРТЫ (слушают извне) ====="
ss -ltnpH | awk '{print $4, $6}' | grep -v -E '127\.0\.0\.1|\[::1\]' | sed 's/users:((//; s/,pid=.*//'
echo
echo "===== FIREWALL ====="
command -v ufw >/dev/null && ufw status | head -15 || echo "ufw не установлен"
echo "fail2ban: $(systemctl is-active fail2ban 2>/dev/null || echo не установлен)"
echo
echo "===== СЕРВИСЫ ====="
systemctl list-units --type=service --state=running --no-pager --no-legend | awk '{print $1}' | grep -v -E '^(systemd|dbus|cron|getty|serial|polkit|rsyslog|snapd|ModemManager|multipathd|udisks|networkd|user@|irqbalance|packagekit|qemu)' | head -25
echo
echo "===== digtunnel ====="
systemctl is-active digtunnel-bot 2>/dev/null && echo "бот: работает от пользователя $(ps -o user= -C python | head -1)"
[ -f /opt/digtunnel/bot/.env ] && echo ".env права: $(stat -c '%a %U' /opt/digtunnel/bot/.env)"
grep -h server_name /etc/nginx/sites-enabled/* 2>/dev/null | sort -u
journalctl -u digtunnel-bot --since '1 hour ago' --no-pager 2>/dev/null | grep -c -E 'ERROR|Traceback' | xargs echo "ошибок бота за час:"
