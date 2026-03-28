#!/system/bin/sh
# Headwolf F8 KPM OC Manager - Service Script v2.0
MODDIR=${0%/*}
CONFIG_DIR="/data/adb/modules/f8_kpm_oc_manager"
CONFIG_FILE="${CONFIG_DIR}/oc_config.json"

# Load the compiled KPM module into the kernel
insmod ${MODDIR}/kpm_oc.ko 2>/dev/null

# Wait for module to initialize
sleep 2

# Ensure sysfs parameters are accessible
chmod 644 /sys/module/kpm_oc/parameters/* 2>/dev/null

# Trigger initial OPP table scan (read-only export)
echo 1 > /sys/module/kpm_oc/parameters/apply 2>/dev/null

# Restore saved settings if config exists
if [ -f "${CONFIG_FILE}" ]; then
    # Parse and apply saved CPU settings
    CPU_OC=$(cat "${CONFIG_FILE}" 2>/dev/null | busybox sed -n 's/.*"cpu_oc_percent":\([0-9-]*\).*/\1/p')
    CPU_UV=$(cat "${CONFIG_FILE}" 2>/dev/null | busybox sed -n 's/.*"cpu_uvolt_offset":\([0-9-]*\).*/\1/p')
    GPU_OC=$(cat "${CONFIG_FILE}" 2>/dev/null | busybox sed -n 's/.*"gpu_oc_percent":\([0-9-]*\).*/\1/p')
    GPU_UV=$(cat "${CONFIG_FILE}" 2>/dev/null | busybox sed -n 's/.*"gpu_uvolt_offset":\([0-9-]*\).*/\1/p')

    [ -n "${CPU_OC}" ] && echo "${CPU_OC}" > /sys/module/kpm_oc/parameters/cpu_oc_percent
    [ -n "${CPU_UV}" ] && echo "${CPU_UV}" > /sys/module/kpm_oc/parameters/cpu_uvolt_offset
    [ -n "${GPU_OC}" ] && echo "${GPU_OC}" > /sys/module/kpm_oc/parameters/gpu_oc_percent
    [ -n "${GPU_UV}" ] && echo "${GPU_UV}" > /sys/module/kpm_oc/parameters/gpu_uvolt_offset

    # Apply custom OPP entries
    CUSTOM_OPPS=$(cat "${CONFIG_FILE}" 2>/dev/null | busybox sed -n 's/.*"custom_opps":"\([^"]*\)".*/\1/p')
    if [ -n "${CUSTOM_OPPS}" ]; then
        echo "${CUSTOM_OPPS}" | tr '|' '\n' | while read entry; do
            [ -n "${entry}" ] && echo "${entry}" > /sys/module/kpm_oc/parameters/opp_add 2>/dev/null
        done
    fi

    # Re-apply to rescan with new settings
    echo 1 > /sys/module/kpm_oc/parameters/apply 2>/dev/null

    log -t "KPM_OC" "Restored saved OC configuration"
fi

# Collect GPU devfreq path for WebUI sysfs fallback
GPU_DEVFREQ=""
for path in /sys/class/devfreq/*gpu* /sys/class/devfreq/*mali* /sys/class/devfreq/*sgpu*; do
    if [ -d "${path}" ] && [ -f "${path}/available_frequencies" ]; then
        GPU_DEVFREQ="${path}"
        break
    fi
done

# Export GPU devfreq path for WebUI
if [ -n "${GPU_DEVFREQ}" ]; then
    echo "${GPU_DEVFREQ}" > "${CONFIG_DIR}/gpu_devfreq_path" 2>/dev/null
fi

log -t "KPM_OC" "Service script completed. Module loaded."
