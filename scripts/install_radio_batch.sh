#!/bin/bash
# Batch installer pour radio tracks depuis YouTube.
#
# Edit URLS=() ci-dessous avec tes liens, puis :
#   bash /opt/weedtycoon-backend/scripts/install_radio_batch.sh
#
# Le script :
#   1. yt-dlp --no-playlist sur chaque URL (skip mass-download de playlists)
#   2. Renomme .ogg en slugs ASCII lowercase
#   3. Vire les .webm orphelins (yt-dlp interrompu)
#   4. Bust le cache backend pour visibilité immédiate

set -u
cd /opt/weedtycoon-backend/public/radio || exit 1

URLS=(
	"https://www.youtube.com/watch?v=3-bkyiAmpxo"
	"https://www.youtube.com/watch?v=XJ-IpdLeJeU"
	"https://www.youtube.com/watch?v=Zgdk16PQstY"
	"https://www.youtube.com/watch?v=zNPXnAVyAUA"
	"https://www.youtube.com/watch?v=oSlbdF-9mH0"
	"https://www.youtube.com/watch?v=UR9Cj5UyVbM"
	"https://www.youtube.com/watch?v=AKcrxYZwdI8"
	"https://www.youtube.com/watch?v=ytudcaxmiS8"
	"https://www.youtube.com/watch?v=G8dpfudMaD4"
	"https://www.youtube.com/watch?v=Zqi-0fZJEkI"
	"https://www.youtube.com/watch?v=AkWXXGe49cw"
	"https://www.youtube.com/watch?v=V1bFr2SWP1I"
	"https://www.youtube.com/watch?v=dR1EwP_ppes"
	"https://www.youtube.com/watch?v=tOwuXkPIl-s"
)

echo "===== Downloading ${#URLS[@]} tracks ====="
for url in "${URLS[@]}"; do
	echo ""
	echo "--- $url"
	yt-dlp --no-playlist -x --audio-format vorbis --audio-quality 5 \
		-o "%(title)s.%(ext)s" "$url" || echo "  FAILED, continuing..."
done

echo ""
echo "===== Renaming to ASCII slugs ====="
shopt -s nullglob
for f in *.ogg; do
	new=$(echo "$f" \
		| sed -E 's/\[[^]]*\]//g' \
		| sed -E 's/\([^)]*\)//g' \
		| sed -E 's/[^a-zA-Z0-9.]/_/g' \
		| tr 'A-Z' 'a-z' \
		| sed -E 's/__+/_/g' \
		| sed -E 's/^_+//' \
		| sed -E 's/_+\.ogg$/.ogg/')
	if [ "$f" != "$new" ] && [ -n "$new" ] && [ "$new" != ".ogg" ]; then
		if [ -e "$new" ]; then
			echo "  SKIP '$f' (target '$new' already exists)"
		else
			echo "  '$f' -> '$new'"
			mv -- "$f" "$new"
		fi
	fi
done

echo ""
echo "===== Clean orphan .webm files ====="
rm -fv *.webm 2>/dev/null || true

echo ""
echo "===== Bust cache ====="
curl -s -X POST https://api.klbtcorp.cloud/radio/refresh
echo ""

echo ""
echo "===== Final list ====="
ls -lh
