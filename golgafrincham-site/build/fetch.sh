#!/usr/bin/env bash
# Daily data refresh. Polite by design: one fetch per file per day, with mirror
# fallback. If every source fails, the previously committed data stays in place
# and the site keeps working.
set -u
UA="satellite-tracker-refresh/1.0 (GitHub Pages daily rebuild; contact via repo issues)"
CT="https://celestrak.org/NORAD/elements/gp.php"
MIR_A="https://raw.githubusercontent.com/astrion-tech/celestrak-mirror/main"
MIR_S="https://raw.githubusercontent.com/satvisorcom/satvisor-data/master/celestrak/tle"

get () { curl --fail -sS --retry 3 --retry-delay 8 -A "$UA" -o "$2" "$1"; }

tle_ok () { # $1=file $2=min element sets
  [ -s "$1" ] && [ "$(grep -c '^1 ' "$1")" -ge "$2" ] && ! grep -qi '<html' "$1"
}
csv_ok () { head -1 "$1" 2>/dev/null | grep -q '^OBJECT_NAME,'; }

fetch_tle () { # $1=dest $2=min $3...=urls
  local dest="$1" min="$2"; shift 2
  for url in "$@"; do
    if get "$url" /tmp/f.$$ && tle_ok /tmp/f.$$ "$min"; then
      mv /tmp/f.$$ "$dest"; echo "OK   $dest  <-  $url"; return 0
    fi
    echo "skip $url"
  done
  echo "KEEP $dest (all sources failed)"; rm -f /tmp/f.$$; return 0
}

mkdir -p data/groups
fetch_tle data/active.tle 8000 "$CT?GROUP=active&FORMAT=tle" "$MIR_S/active.tle"
for g in stations gps-ops glo-ops galileo beidou weather resource science military; do
  fetch_tle "data/groups/$g.tle" 5 "$CT?GROUP=$g&FORMAT=tle" "$MIR_A/tle/$g.tle"
done
if get "https://celestrak.org/pub/satcat.csv" /tmp/sc.$$ && csv_ok /tmp/sc.$$; then
  mv /tmp/sc.$$ data/satcat.csv; echo "OK   data/satcat.csv"
elif get "$MIR_A/satcat/satcat.csv" /tmp/sc.$$ && csv_ok /tmp/sc.$$; then
  mv /tmp/sc.$$ data/satcat.csv; echo "OK   data/satcat.csv (mirror)"
else
  echo "KEEP data/satcat.csv"; rm -f /tmp/sc.$$
fi
exit 0
