#!/bin/sh
# Servidor estático local (ES modules exigem http, não file://).
cd "$(dirname "$0")" || exit 1
PORT="${1:-8080}"
echo "Oxy-Red · gêmeo digital em http://localhost:$PORT"
python3 -m http.server "$PORT"
