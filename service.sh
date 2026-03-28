#!/system/bin/sh
# Headwolf F8 KPM OC Manager - Service Script v3.1
# Reads CPU OPP from kernel module (CSRAM), GPU OPP from /proc/gpufreqv2
MODDIR=${0%/*}
CONFIG_DIR="/data/adb/modules/f8_kpm_oc_manager"
CONFIG_FILE="${CONFIG_DIR}/oc_config.json"
CPU_OPP_FILE="${CONFIG_DIR}/cpu_opp_table"
GPU_OPP_FILE="${CONFIG_DIR}/gpu_opp_table"
CPU_RAW_FILE="${CONFIG_DIR}/cpu_raw_dump"

mkdir -p "${CONFIG_DIR}" 2>/dev/null

# Load the compiled KPM module into the kernel
insmod ${MODDIR}/kpm_oc.ko 2>/dev/null

# Wait for module to initialize and auto-scan
sleep 2

# Ensure sysfs parameters are accessible
chmod 644 /sys/module/kpm_oc/parameters/opp_table 2>/dev/null
chmod 644 /sys/module/kpm_oc/parameters/raw 2>/dev/null

# Export CPU OPP table from kernel module (CSRAM data: CPU:policy:freq_khz:raw32|...)
CPU_RAW=$(cat /sys/module/kpm_oc/parameters/opp_table 2>/dev/null)
if [ -z "${CPU_RAW}" ] || [ "${CPU_RAW}" = "READY" ]; then
    echo 1 > /sys/module/kpm_oc/parameters/apply 2>/dev/null
    sleep 1
    CPU_RAW=$(cat /sys/module/kpm_oc/parameters/opp_table 2>/dev/null)
fi
echo "${CPU_RAW}" > "${CPU_OPP_FILE}" 2>/dev/null

# Export raw hex dump for debugging
RAW_DUMP=$(cat /sys/module/kpm_oc/parameters/raw 2>/dev/null)
echo "${RAW_DUMP}" > "${CPU_RAW_FILE}" 2>/dev/null

log -t "KPM_OC" "CPU OPP: $(echo "${CPU_RAW}" | wc -c) bytes, raw: $(echo "${RAW_DUMP}" | wc -c) bytes"

# Export GPU OPP table from /proc/gpufreqv2 (format: GPU:0:freq_khz:volt_uv|...)
GPU_DATA=""
if [ -f /proc/gpufreqv2/gpu_working_opp_table ]; then
    while IFS= read -r line; do
        freq=$(echo "${line}" | sed -n 's/.*freq: *\([0-9]*\).*/\1/p')
        volt=$(echo "${line}" | sed -n 's/.*volt: *\([0-9]*\).*/\1/p')
        if [ -n "${freq}" ] && [ -n "${volt}" ]; then
            volt_uv=$((volt * 10))
            if [ -n "${GPU_DATA}" ]; then
                GPU_DATA="${GPU_DATA}|GPU:0:${freq}:${volt_uv}"
            else
                GPU_DATA="GPU:0:${freq}:${volt_uv}"
            fi
        fi
    done < /proc/gpufreqv2/gpu_working_opp_table
fi
echo "${GPU_DATA}" > "${GPU_OPP_FILE}" 2>/dev/null
log -t "KPM_OC" "GPU OPP table exported: $(echo "${GPU_DATA}" | wc -c) bytes"

# Store GPU devfreq path for WebUI
GPU_DEVFREQ=""
for path in /sys/class/devfreq/*mali*; do
    if [ -d "${path}" ]; then
        GPU_DEVFREQ="${path}"
        break
    fi
done
if [ -n "${GPU_DEVFREQ}" ]; then
    echo "${GPU_DEVFREQ}" > "${CONFIG_DIR}/gpu_devfreq_path" 2>/dev/null
fi

log -t "KPM_OC" "Service script v3.1 completed. Module loaded."
