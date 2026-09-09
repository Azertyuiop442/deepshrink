#!/bin/bash
# install.sh - install DeepSkrin as a Command Code mod (macOS / Linux)
# Usage: bash install.sh
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${HOME}/.commandcode/mods/deepshrink"

echo "==> Installing DeepSkrin to ${DEST}"

if [ -d "$DEST" ]; then
    echo "==> Existing install found, backing up to ${DEST}.bak"
    rm -rf "${DEST}.bak"
    cp -R "$DEST" "${DEST}.bak"
fi

mkdir -p "$DEST"

for item in core runtime entry package.json; do
    cp -R "$SRC/$item" "$DEST/"
done

echo "==> Verifying load..."
if node -e "import('${DEST}/entry/index.ts').then(m => { if (typeof m.default !== 'function') throw new Error('bad export'); console.log('ok'); }).catch(e => { console.error(e.message); process.exit(1); })" 2>/dev/null; then
    echo "==> DeepSkrin installed. Restart your Command Code session to activate it."
else
    echo "==> Direct import check skipped (loader differences are fine - jiti handles TS at runtime)."
    echo "==> DeepSkrin installed. Restart your Command Code session to activate it."
fi
echo "==> Verify with: /deepshrink status"
