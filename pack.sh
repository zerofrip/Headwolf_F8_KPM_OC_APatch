#!/usr/bin/env bash
# pack.sh — Package KPM_OC APatch module into KPM_OC_Module.zip
#
# Usage (from Headwolf_F8_KPM_OC_APatch/):
#   ./pack.sh [KERNEL_DIR=<path>] [OUT=<path/to/KPM_OC_Module.zip>]
#
# Defaults:
#   KERNEL_DIR = ../Headwolf_F8_KPM_OC_Kernel
#   OUT        = ./KPM_OC_Module.zip
#
# The newly built kpm_oc.ko in KERNEL_DIR is copied here before zipping.
# Run build.sh in the kernel repo first to produce an up-to-date .ko.
#
# Files included in the zip:
#   module.prop, customize.sh, post-fs-data.sh, service.sh
#   kpm_oc.ko, icon_extractor.dex
#   conf.default/   (default JSON config files)
#   webroot/        (WebUI: index.html, app.js, i18n.js, style.css)
#
# Files excluded:
#   .git/, .gitignore, README.md, update.json
#   tools/  (Java/class source files, development only)
#   kpm_oc.ko:Zone.Identifier  (Windows alternate data stream)
#   KPM_OC_Module.zip  (the output file itself)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KERNEL_DIR="${KERNEL_DIR:-}"
OUT="${OUT:-}"

# Parse key=value positional arguments
for arg in "$@"; do
    case "$arg" in
        KERNEL_DIR=*) KERNEL_DIR="${arg#KERNEL_DIR=}" ;;
        OUT=*)        OUT="${arg#OUT=}" ;;
        *) echo "WARNING: Unknown argument: $arg" ;;
    esac
done

# Defaults
if [[ -z "$KERNEL_DIR" ]]; then
    KERNEL_DIR="$(cd "${SCRIPT_DIR}/../Headwolf_F8_KPM_OC_Kernel" && pwd)"
fi
if [[ -z "$OUT" ]]; then
    OUT="${SCRIPT_DIR}/KPM_OC_Module.zip"
fi

# ── Validate paths ────────────────────────────────────────────────────────────
if [[ ! -d "$KERNEL_DIR" ]]; then
    echo "ERROR: KERNEL_DIR='$KERNEL_DIR' does not exist."
    exit 1
fi

KO_SRC="${KERNEL_DIR}/kpm_oc.ko"
if [[ ! -f "$KO_SRC" ]]; then
    echo "ERROR: kpm_oc.ko not found at '${KO_SRC}'."
    echo "  Run build.sh in the kernel repo first to build the kernel module."
    exit 1
fi

# ── Copy freshly built .ko from kernel repo ───────────────────────────────────
KO_DST="${SCRIPT_DIR}/kpm_oc.ko"
if [[ ! -f "$KO_DST" ]] || [[ "$KO_SRC" -nt "$KO_DST" ]]; then
    echo "Copying kpm_oc.ko <- ${KERNEL_DIR}/"
    cp -f "$KO_SRC" "$KO_DST"
else
    echo "kpm_oc.ko is up-to-date."
fi

# ── Assemble zip ──────────────────────────────────────────────────────────────
OUT_TMP="${OUT}.tmp.$$"

# Remove stale temp file on exit
trap 'rm -f "$OUT_TMP"' EXIT

echo "Creating ${OUT} ..."

cd "$SCRIPT_DIR"

zip -r9 "$OUT_TMP" \
    module.prop \
    customize.sh \
    post-fs-data.sh \
    service.sh \
    kpm_oc.ko \
    icon_extractor.dex \
    conf.default/ \
    webroot/

mv "$OUT_TMP" "$OUT"
trap - EXIT

SIZE=$(du -sh "$OUT" | cut -f1)
echo ""
echo "Done: ${OUT}  (${SIZE})"
echo ""
echo "Contents:"
zip -sf "$OUT" | sed 's/^/  /'
