#!/system/bin/sh
# Headwolf F8 KPM OC Manager - Service Script v4.0
# Reads CPU OPP from kernel module (CSRAM), GPU OPP from /proc/gpufreqv2
# Restores OC config (CPU/GPU) and scaling limits from saved config
# Optional: safe-ish boot-time reload of GPUFreq modules with patched core ko
MODDIR=${0%/*}
CONFIG_DIR="/data/adb/modules/f8_kpm_oc_manager"
CONFIG_FILE="${CONFIG_DIR}/oc_config.json"
CPU_OPP_FILE="${CONFIG_DIR}/cpu_opp_table"
GPU_OPP_FILE="${CONFIG_DIR}/gpu_opp_table"
CPU_RAW_FILE="${CONFIG_DIR}/cpu_raw_dump"
GPU_RELOAD_FLAG="${MODDIR}/enable_gpufreq_reload"
GPU_PATCHED_CORE_KO="${MODDIR}/mtk_gpufreq_mt6897_1450.ko"
GPU_EXPECT_MIN_TOP_KHZ=1450000
GPU_VENDOR_DIR="/vendor/lib/modules"
GPU_VENDOR_CORE_KO="${GPU_VENDOR_DIR}/mtk_gpufreq_mt6897.ko"
GPU_VENDOR_WRAPPER_KO="${GPU_VENDOR_DIR}/mtk_gpufreq_wrapper.ko"
GPU_VENDOR_PWRTHROTTLE_KO="${GPU_VENDOR_DIR}/mtk_gpu_power_throttling.ko"
GPU_VENDOR_HAL_KO="${GPU_VENDOR_DIR}/mtk_gpu_hal.ko"

mkdir -p "${CONFIG_DIR}" 2>/dev/null

logi() {
    log -t "KPM_OC" "$1"
}

is_loaded() {
    cat /proc/modules 2>/dev/null | grep -q "^$1 "
}

unload_mod() {
    mod="$1"
    if is_loaded "${mod}"; then
        rmmod "${mod}" 2>/dev/null
    fi
}

load_mod() {
    ko="$1"
    [ -f "${ko}" ] || return 1
    insmod "${ko}" 2>/dev/null
}

verify_gpu_top_freq() {
    top_line=$(cat /proc/gpufreqv2/gpu_working_opp_table 2>/dev/null | head -1)
    top_freq=$(echo "${top_line}" | sed -n 's/.*freq: *\([0-9]*\).*/\1/p')
    [ -n "${top_freq}" ] && [ "${top_freq}" -ge "${GPU_EXPECT_MIN_TOP_KHZ}" ]
}

reload_gpufreq_modules() {
    # Opt-in only. Create ${MODDIR}/enable_gpufreq_reload to activate.
    if [ ! -f "${GPU_RELOAD_FLAG}" ]; then
        return 0
    fi

    if [ ! -f "${GPU_PATCHED_CORE_KO}" ]; then
        logi "GPU reload skipped: patched ko not found (${GPU_PATCHED_CORE_KO})"
        return 0
    fi

    logi "GPU reload: start"

    # Unload in reverse dependency order. If core cannot unload, abort safely.
    unload_mod "mtk_gpu_hal"
    unload_mod "mtk_gpu_power_throttling"
    unload_mod "mtk_gpufreq_wrapper"
    unload_mod "mtk_gpufreq_mt6897"

    if is_loaded "mtk_gpufreq_mt6897"; then
        logi "GPU reload aborted: mtk_gpufreq_mt6897 still in use"
        return 0
    fi

    # Load patched core first, then vendor companions.
    if ! load_mod "${GPU_PATCHED_CORE_KO}"; then
        logi "GPU reload failed: cannot load patched core"
        # Best-effort restore original
        load_mod "${GPU_VENDOR_CORE_KO}" || true
        load_mod "${GPU_VENDOR_WRAPPER_KO}" || true
        load_mod "${GPU_VENDOR_PWRTHROTTLE_KO}" || true
        load_mod "${GPU_VENDOR_HAL_KO}" || true
        return 0
    fi

    load_mod "${GPU_VENDOR_WRAPPER_KO}" || true
    load_mod "${GPU_VENDOR_PWRTHROTTLE_KO}" || true
    load_mod "${GPU_VENDOR_HAL_KO}" || true
    sleep 1

    if verify_gpu_top_freq; then
        logi "GPU reload success: top OPP is ${GPU_EXPECT_MIN_TOP_KHZ} KHz or higher"
    else
        logi "GPU reload verification failed (< ${GPU_EXPECT_MIN_TOP_KHZ} KHz), rolling back"
        unload_mod "mtk_gpu_hal"
        unload_mod "mtk_gpu_power_throttling"
        unload_mod "mtk_gpufreq_wrapper"
        unload_mod "mtk_gpufreq_mt6897"
        load_mod "${GPU_VENDOR_CORE_KO}" || true
        load_mod "${GPU_VENDOR_WRAPPER_KO}" || true
        load_mod "${GPU_VENDOR_PWRTHROTTLE_KO}" || true
        load_mod "${GPU_VENDOR_HAL_KO}" || true
    fi
}

# Optional early GPUFreq reload attempt (does nothing unless flag file exists)
reload_gpufreq_modules

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
fi

# GPU OC is applied automatically on module load (kpm_oc_init calls set_gpu_oc()).
# CPU OC is applied if config params were passed via insmod.
GPU_OC_RES=$(cat /sys/module/kpm_oc/parameters/gpu_oc_result 2>/dev/null)
logi "GPU OC result (auto on load): ${GPU_OC_RES}"
CPU_OC_RES=$(cat /sys/module/kpm_oc/parameters/cpu_oc_result 2>/dev/null)
[ -n "${CPU_OC_RES}" ] && logi "CPU OC result (auto on load): ${CPU_OC_RES}"

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

logi "Service script v4.0 completed. Module loaded."
