#!/usr/bin/env bash
# Bumpne zdieľaný ?v= cache-bust token vo VŠETKÝCH <script>/<link> tagoch naraz.
# Použitie: scripts/bump_cache_token.sh [novy-token]
# Bez argumentu vygeneruje token z dátumu a času (YYYYMMDD-HHMMSS).
# Token ikony (lizard-icon.png) je zámerne samostatný a nemení sa.
set -euo pipefail
cd "$(dirname "$0")/.."
HTML=frontend/trading_dashboard.html

cur=$(sed -n 's/.*dashboard\.css?v=\([A-Za-z0-9_-]*\).*/\1/p' "$HTML" | head -1)
if [ -z "$cur" ]; then
  echo "ERROR: nenašiel som aktuálny token na dashboard.css tagu v $HTML" >&2
  exit 1
fi
new="${1:-$(date +%Y%m%d-%H%M%S)}"
if [ "$new" = "$cur" ]; then
  echo "Token už je $cur — nič nemením."
  exit 0
fi
sed -i "s/?v=${cur}/?v=${new}/g" "$HTML"
count=$(grep -c "?v=${new}" "$HTML")
echo "Token: ${cur} -> ${new} (${count} tagov)"
