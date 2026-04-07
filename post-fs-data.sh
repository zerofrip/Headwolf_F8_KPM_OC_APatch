#!/system/bin/sh
# post-fs-data.sh - Runs before zygote/SurfaceFlinger
# Sets SurfaceFlinger properties for adaptive refresh rate support.

MODDIR="${0%/*}"
CONF_DIR="/data/adb/modules/f8_kpm_oc_manager/conf"
CONF_DISPLAY="${CONF_DIR}/display_tuning.json"

# Only set SF properties when adaptive refresh mode is requested
refresh_mode="fixed"
if [ -f "${CONF_DISPLAY}" ]; then
    refresh_mode=$(cat "${CONF_DISPLAY}" | grep -o '"refresh_mode":"[^"]*"' | cut -d'"' -f4)
fi

if [ "${refresh_mode}" = "adaptive" ]; then
    resetprop ro.surface_flinger.use_content_detection_for_refresh_rate 1
    resetprop ro.surface_flinger.set_idle_timer_ms 2000
fi
