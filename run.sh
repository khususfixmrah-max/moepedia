#!/bin/bash

# ============================================
# RUN SCRIPT DIGITAL PEDIA H2H
# Dengan Cloudflare Tunnel Otomatis
# ============================================

export NODE_ENV=production
export PORT=3000

# Warna untuk log
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
RESET='\033[0m'

clear
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}║                                                            ║${RESET}"
echo -e "${CYAN}║${YELLOW}      🚀 DIGITAL PEDIA H2H PAYMENT GATEWAY 🚀          ${CYAN}║${RESET}"
echo -e "${CYAN}║                                                            ║${RESET}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${RESET}"
echo ""

# Cek Cloudflare Tunnel Token
if [ -n "$CF_TUNNEL_TOKEN" ]; then
    echo -e "${YELLOW}[INFO] Cloudflare Tunnel Token ditemukan${RESET}"
    
    # Download cloudflared jika belum ada
    if [ ! -f "./cloudflared" ]; then
        echo -e "${YELLOW}[INFO] Mendownload cloudflared...${RESET}"
        curl -L -# https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
        chmod +x cloudflared
        echo -e "${GREEN}[SUCCESS] Cloudflared downloaded${RESET}"
    fi
    
    # Jalankan tunnel
    echo -e "${YELLOW}[INFO] Menjalankan Cloudflare Tunnel...${RESET}"
    ./cloudflared tunnel run --token $CF_TUNNEL_TOKEN > /tmp/cf_tunnel.log 2>&1 &
    
    sleep 3
    if pgrep -f "cloudflared tunnel run" > /dev/null; then
        echo -e "${GREEN}[SUCCESS] Tunnel berjalan${RESET}"
    else
        echo -e "${RED}[ERROR] Gagal menjalankan tunnel${RESET}"
    fi
else
    echo -e "${YELLOW}[INFO] CF_TUNNEL_TOKEN tidak diset, melewati tunnel${RESET}"
fi

# Install dependencies
if [ -f "package.json" ]; then
    echo -e "${YELLOW}[INFO] Menginstall dependencies...${RESET}"
    npm install --production
    echo -e "${GREEN}[SUCCESS] Dependencies installed${RESET}"
fi

# Jalankan server
echo -e "${GREEN}[INFO] Menjalankan server di port ${PORT}...${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
exec node index.js