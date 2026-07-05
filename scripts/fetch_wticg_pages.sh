#!/usr/bin/env bash
# Download the SOL/SBC pages of every WTICG paper into scripts/wticg_cache/, so
# scripts/build_wticg_stats.py can read author affiliations from their OJS
# citation_author_institution meta tags. Idempotent: skips pages already cached.
#
# The URL list (scripts/wticg_cache/_urls.txt, "<id> <url>" per line) is derived
# from scripts/sbseg_data.json by build_wticg_stats.py's WTICG section filter.
set -euo pipefail
cd "$(dirname "$0")/.."
CACHE=scripts/wticg_cache
mkdir -p "$CACHE"

python3 - <<'PY'
import json, re, unicodedata
def fold(s):
    s = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower().strip()
NAME = "Workshop de Trabalhos de Iniciação Científica e de Graduação"
d = json.load(open("scripts/sbseg_data.json", encoding="utf-8"))
rows = []
for ed in d["estendido"]:
    for sec in ed["sections"]:
        if fold(sec.get("section", "")) == fold(NAME):
            for p in sec.get("papers", []):
                m = re.search(r"/view/(\d+)", p.get("url") or "")
                if m:
                    rows.append(m.group(1) + " " + p["url"])
open("scripts/wticg_cache/_urls.txt", "w").write("\n".join(rows) + "\n")
print("urls:", len(rows))
PY

n=0
while read -r id url; do
  [ -z "$id" ] && continue
  f="$CACHE/$id.html"
  if [ -s "$f" ] && grep -q citation_author "$f"; then continue; fi
  curl -s -m 40 -A "Mozilla/5.0 (research; CESeg community map)" "$url" -o "$f"
  n=$((n + 1))
  sleep 0.3
done < "$CACHE/_urls.txt"
echo "downloaded $n new page(s); cached total: $(ls "$CACHE"/*.html | wc -l)"
