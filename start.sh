#!/usr/bin/env bash
# Arranca Stellar Combat: compila si hace falta, levanta el servidor y abre el navegador.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[stellar-combat] Instalando dependencias..."
  npm install --no-fund --no-audit
fi

if [ ! -d client/dist ]; then
  echo "[stellar-combat] Compilando el cliente..."
  npm run build
fi

echo "[stellar-combat] Arrancando servidor en http://localhost:3000 (Ctrl+C para salir)"
npm start &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://localhost:3000" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

xdg-open "http://localhost:3000" >/dev/null 2>&1 || true
wait $SERVER_PID
