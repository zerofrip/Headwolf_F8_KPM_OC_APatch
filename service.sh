#!/system/bin/sh
# Headwolf F8 KPM OC Manager - Service Script v7.2
# Reads CPU OPP from kernel module (CSRAM), GPU OPP from /proc/gpufreqv2
# Restores OC config (CPU/GPU) and scaling limits from saved config
MODDIR=${0%/*}
CONFIG_DIR="/data/adb/modules/f8_kpm_oc_manager"
CONFIG_FILE="${CONFIG_DIR}/oc_config.json"
CPU_OPP_FILE="${CONFIG_DIR}/cpu_opp_table"
GPU_OPP_FILE="${CONFIG_DIR}/gpu_opp_table"
CPU_RAW_FILE="${CONFIG_DIR}/cpu_raw_dump"

mkdir -p "${CONFIG_DIR}" 2>/dev/null

# On first install, seed user config from the bundled default.
# On module updates the existing oc_config.json is preserved so
# user-customised settings are not overwritten.
DEFAULT_CONFIG="${MODDIR}/oc_config.default.json"
if [ ! -f "${CONFIG_FILE}" ] && [ -f "${DEFAULT_CONFIG}" ]; then
    cp "${DEFAULT_CONFIG}" "${CONFIG_FILE}"
    logi "First install: seeded oc_config.json from bundled default"
fi

logi() {
    log -t "KPM_OC" "$1"
}

resolve_gpu_devfreq_path() {
    for path in /sys/class/devfreq/*mali*; do
        if [ -d "${path}" ]; then
            echo "${path}"
            return 0
        fi
    done
    return 1
}

# ─── Parse OC config for insmod params ───────────────────────────────────
# Flat JSON keys: cpu_oc_{l,b,p}_{freq,volt}, gpu_oc_{freq,volt,vsram}
json_int() {
    grep -o "\"$1\":[0-9]*" "${CONFIG_FILE}" 2>/dev/null | head -1 | grep -o '[0-9]*$'
}

INSMOD_PARAMS=""
if [ -f "${CONFIG_FILE}" ]; then
    for key in cpu_oc_l_freq cpu_oc_l_volt cpu_oc_b_freq cpu_oc_b_volt \
               cpu_oc_p_freq cpu_oc_p_volt; do
        v=$(json_int "${key}")
        [ -n "$v" ] && [ "$v" != "0" ] && INSMOD_PARAMS="${INSMOD_PARAMS} ${key}=${v}"
    done

    # GPU OC: config keys → module param names
    v=$(json_int gpu_oc_freq);  [ -n "$v" ] && [ "$v" != "0" ] && INSMOD_PARAMS="${INSMOD_PARAMS} gpu_target_freq=$v"
    v=$(json_int gpu_oc_volt);  [ -n "$v" ] && [ "$v" != "0" ] && INSMOD_PARAMS="${INSMOD_PARAMS} gpu_target_volt=$v"
    v=$(json_int gpu_oc_vsram); [ -n "$v" ] && [ "$v" != "0" ] && INSMOD_PARAMS="${INSMOD_PARAMS} gpu_target_vsram=$v"

    logi "OC config loaded:${INSMOD_PARAMS:-" (none)"}"
fi

# Load the compiled KPM module into the kernel
insmod ${MODDIR}/kpm_oc.ko${INSMOD_PARAMS} 2>/dev/null

# Wait for module to initialize and auto-scan
sleep 2

# Ensure sysfs parameters are accessible
chmod 644 /sys/module/kpm_oc/parameters/opp_table 2>/dev/null
chmod 644 /sys/module/kpm_oc/parameters/raw 2>/dev/null
chmod 644 /sys/module/kpm_oc/parameters/gpu_oc_result 2>/dev/null
chmod 644 /sys/module/kpm_oc/parameters/cpu_oc_result 2>/dev/null

# ─── Restore CPU scaling limits from config ──────────────────────────────
if [ -f "${CONFIG_FILE}" ]; then
    for policy in 0 4 7; do
        max_val=$(json_int "cpu_max_${policy}")
        min_val=$(json_int "cpu_min_${policy}")
        if [ -n "$min_val" ] && [ "$min_val" -gt 0 ] 2>/dev/null; then
            echo "$min_val" > /sys/devices/system/cpu/cpufreq/policy${policy}/scaling_min_freq 2>/dev/null
        fi
        if [ -n "$max_val" ] && [ "$max_val" -gt 0 ] 2>/dev/null; then
            echo "$max_val" > /sys/devices/system/cpu/cpufreq/policy${policy}/scaling_max_freq 2>/dev/null
        fi
    done
    logi "CPU scaling limits restored from config"

    # CPU OC relift pass: vendor constraints can race and clamp first write.
    # Re-run cpu_oc_apply, then restore scaling_max once more.
    cpu_oc_enabled=0
    for key in cpu_oc_l_freq cpu_oc_b_freq cpu_oc_p_freq; do
        v=$(json_int "${key}")
        if [ -n "${v}" ] && [ "${v}" -gt 0 ] 2>/dev/null; then
            cpu_oc_enabled=1
            break
        fi
    done

    if [ "${cpu_oc_enabled}" = "1" ]; then
        echo 1 > /sys/module/kpm_oc/parameters/cpu_oc_apply 2>/dev/null
        sleep 1
        for policy in 0 4 7; do
            max_val=$(json_int "cpu_max_${policy}")
            if [ -n "${max_val}" ] && [ "${max_val}" -gt 0 ] 2>/dev/null; then
                echo "$max_val" > /sys/devices/system/cpu/cpufreq/policy${policy}/scaling_max_freq 2>/dev/null
            fi
        done
        logi "CPU OC relift pass completed"
    fi
fi

# GPU OC is applied automatically on module load (kpm_oc_init calls set_gpu_oc()).
# CPU OC is applied if config params were passed via insmod.
GPU_OC_RES=$(cat /sys/module/kpm_oc/parameters/gpu_oc_result 2>/dev/null)
logi "GPU OC result (auto on load): ${GPU_OC_RES}"
CPU_OC_RES=$(cat /sys/module/kpm_oc/parameters/cpu_oc_result 2>/dev/null)
[ -n "${CPU_OC_RES}" ] && logi "CPU OC result (auto on load): ${CPU_OC_RES}"

# GPU relift pass: re-apply GPU OC and restore devfreq max ceiling.
if [ -f "${CONFIG_FILE}" ]; then
    gpu_freq=$(json_int gpu_oc_freq)
    if [ -n "${gpu_freq}" ] && [ "${gpu_freq}" -gt 0 ] 2>/dev/null; then
        echo 1 > /sys/module/kpm_oc/parameters/gpu_oc_apply 2>/dev/null
        sleep 1

        GPU_DEVFREQ=$(resolve_gpu_devfreq_path)
        if [ -n "${GPU_DEVFREQ}" ] && [ -w "${GPU_DEVFREQ}/max_freq" ]; then
            gpu_hz=$((gpu_freq * 1000))
            echo "${gpu_hz}" > "${GPU_DEVFREQ}/max_freq" 2>/dev/null
            cur_max=$(cat "${GPU_DEVFREQ}/max_freq" 2>/dev/null)
            logi "GPU relift pass: target=${gpu_hz} max_freq=${cur_max} path=${GPU_DEVFREQ}"
        else
            logi "GPU relift pass: devfreq max_freq not writable"
        fi
    fi
fi

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

logi "CPU OPP: $(echo "${CPU_RAW}" | wc -c) bytes, raw: $(echo "${RAW_DUMP}" | wc -c) bytes"

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
logi "GPU OPP table exported: $(echo "${GPU_DATA}" | wc -c) bytes"

# Store GPU devfreq path for WebUI
GPU_DEVFREQ="$(resolve_gpu_devfreq_path)"
if [ -n "${GPU_DEVFREQ}" ]; then
    echo "${GPU_DEVFREQ}" > "${CONFIG_DIR}/gpu_devfreq_path" 2>/dev/null
fi

logi "Service script v7.2 completed. Module loaded."
