#!/system/bin/sh
# Headwolf F8 KPM OC Manager — Install/Update Script
# Preserves user configuration across module updates.

SKIPUNZIP=0
# MODPATH is set by APatch/Magisk to the staging directory
# e.g. /data/adb/modules_update/f8_kpm_oc_manager/

MODULE_ID="f8_kpm_oc_manager"
OLD_DIR="/data/adb/modules/${MODULE_ID}"

ui_print "━━━ Headwolf F8 OC Manager ━━━"

# ─── Preserve existing config on update ───────────────────────────────────
if [ -d "${OLD_DIR}/conf" ]; then
    ui_print "- Preserving saved configuration..."
    mkdir -p "${MODPATH}/conf"
    cp -af "${OLD_DIR}/conf/." "${MODPATH}/conf/"
    ui_print "  → $(ls "${MODPATH}/conf/" 2>/dev/null | wc -l) config files restored"
fi

# Also preserve legacy config if it exists and hasn't been migrated
if [ -f "${OLD_DIR}/oc_config.json" ] && [ ! -f "${MODPATH}/conf/cpu_oc.json" ]; then
    cp -af "${OLD_DIR}/oc_config.json" "${MODPATH}/oc_config.json"
    ui_print "  → Legacy config preserved for migration"
fi

# Preserve cached OPP tables (avoids blank UI on first boot after update)
for f in cpu_opp_table gpu_opp_table cpu_raw_dump gpu_devfreq_path; do
    if [ -f "${OLD_DIR}/${f}" ]; then
        cp -af "${OLD_DIR}/${f}" "${MODPATH}/${f}"
    fi
done

ui_print "- Installation complete"
