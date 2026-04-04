#!/system/bin/sh
# Headwolf F8 KPM OC Manager - Service Script v8.1
# Reads CPU OPP from kernel module (CSRAM), GPU OPP from /proc/gpufreqv2
# Restores OC config (CPU/GPU/DRAM/IO/UFS) and scaling limits from saved config
MODDIR=${0%/*}
CONFIG_DIR="/data/adb/modules/f8_kpm_oc_manager"
CONFIG_FILE="${CONFIG_DIR}/oc_config.json"
CPU_OPP_FILE="${CONFIG_DIR}/cpu_opp_table"
GPU_OPP_FILE="${CONFIG_DIR}/gpu_opp_table"
CPU_RAW_FILE="${CONFIG_DIR}/cpu_raw_dump"
UFS_HCI_PATH="/sys/devices/platform/11270000.ufshci"

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

json_str() {
    grep -o "\"$1\":\"[^\"]*\"" "${CONFIG_FILE}" 2>/dev/null | head -1 | sed 's/.*:"\(.*\)"/\1/'
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

# ─── Restore DRAM min freq floor from config ─────────────────────────────
DRAM_DEVFREQ="/sys/class/devfreq/mtk-dvfsrc-devfreq"
if [ -f "${CONFIG_FILE}" ] && [ -d "${DRAM_DEVFREQ}" ]; then
    dram_min=$(json_int dram_min_freq)
    if [ -n "${dram_min}" ] && [ "${dram_min}" -gt 0 ] 2>/dev/null; then
        echo "${dram_min}" | tee "${DRAM_DEVFREQ}/min_freq" > /dev/null 2>&1
        cur_dram=$(cat "${DRAM_DEVFREQ}/cur_freq" 2>/dev/null)
        logi "DRAM min_freq floor set: target=${dram_min} cur=${cur_dram}"
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

# Late-boot relift (T+45 s): re-apply OC constraints after vendor services
# (powerhal, fpsgo, thermal_engine) finish initializing and may have issued
# freq_qos MAX requests capped at the stock max frequency.  This pass also
# ensures cluster_qos_ptr is populated in the kernel module so the
# freq_qos_update_request kprobe can start intercepting future stock-cap writes.

# ─── Write Gaming Monitor Daemon Script ──────────────────────────────────
GAMING_SCRIPT="${CONFIG_DIR}/gaming_monitor.sh"
cat > "${GAMING_SCRIPT}" << 'GDEOF'
#!/system/bin/sh
CFG="/data/adb/modules/f8_kpm_oc_manager/oc_config.json"
PID_F="/data/adb/modules/f8_kpm_oc_manager/gaming_monitor.pid"
KS="/sys/module/kpm_oc/parameters/"
DRAM_DF="/sys/class/devfreq/mtk-dvfsrc-devfreq"

echo $$ > "$PID_F"
BOOSTED=0

while true; do
    games=$(grep -o '"gaming_apps":"[^"]*"' "$CFG" 2>/dev/null | sed 's/"gaming_apps":"//;s/"$//')
    [ -z "$games" ] && sleep 5 && continue

    FG=$(dumpsys activity activities 2>/dev/null | grep 'mResumedActivity' | head -1 | sed 's|.*u0 ||;s|/.*||;s| .*||')
    [ -z "$FG" ] && FG=$(dumpsys window 2>/dev/null | grep 'mCurrentFocus' | tail -1 | sed 's|.*{[^ ]* [^ ]* ||;s|/.*||;s|}.*||')

    IS_GAMING=0
    OIFS=$IFS; IFS=','
    for app in $games; do
        [ "$FG" = "$app" ] && IS_GAMING=1 && break
    done
    IFS=$OIFS

    if [ "$IS_GAMING" = "1" ] && [ "$BOOSTED" = "0" ]; then
        # Apply Performance preset
        echo 3800000 > /sys/devices/system/cpu/cpufreq/policy0/scaling_max_freq 2>/dev/null
        echo 3800000 > /sys/devices/system/cpu/cpufreq/policy4/scaling_max_freq 2>/dev/null
        echo 4000000 > /sys/devices/system/cpu/cpufreq/policy7/scaling_max_freq 2>/dev/null
        echo 1 > "${KS}cpu_oc_apply" 2>/dev/null
        echo 1 > "${KS}gpu_oc_apply" 2>/dev/null
        # GPU cdev lock
        for cd in /sys/class/thermal/cooling_device*/; do
            t=$(cat "${cd}type" 2>/dev/null)
            case "$t" in *mali*|*gpu*|*GPU*|*GED*) echo 0 > "${cd}cur_state" 2>/dev/null;; esac
        done
        echo 6400000000 > "${DRAM_DF}/min_freq" 2>/dev/null
        log -t "KPM_OC" "Gaming boost ON: $FG"
        BOOSTED=1
    elif [ "$IS_GAMING" = "0" ] && [ "$BOOSTED" = "1" ]; then
        # Revert to saved power mode
        pm=$(grep -o '"power_mode":[0-9]*' "$CFG" 2>/dev/null | grep -o '[0-9]*$')
        pm=${pm:-1}
        case $pm in
            0) # Battery Save
                echo 1600000 > /sys/devices/system/cpu/cpufreq/policy0/scaling_max_freq 2>/dev/null
                echo 2000000 > /sys/devices/system/cpu/cpufreq/policy4/scaling_max_freq 2>/dev/null
                echo 2000000 > /sys/devices/system/cpu/cpufreq/policy7/scaling_max_freq 2>/dev/null
                echo 800000000 > "${DRAM_DF}/min_freq" 2>/dev/null
                ;;
            *) # Normal or Performance — use config values
                for p in 0 4 7; do
                    mv=$(grep -o "\"cpu_max_${p}\":[0-9]*" "$CFG" 2>/dev/null | grep -o '[0-9]*$')
                    [ -n "$mv" ] && echo "$mv" > "/sys/devices/system/cpu/cpufreq/policy${p}/scaling_max_freq" 2>/dev/null
                done
                dm=$(grep -o '"dram_min_freq":[0-9]*' "$CFG" 2>/dev/null | grep -o '[0-9]*$')
                [ -n "$dm" ] && echo "$dm" > "${DRAM_DF}/min_freq" 2>/dev/null
                ;;
        esac
        log -t "KPM_OC" "Gaming boost OFF: reverted to mode=$pm"
        BOOSTED=0
    fi
    sleep 5
done
GDEOF
chmod 755 "${GAMING_SCRIPT}"
logi "Gaming monitor script written to ${GAMING_SCRIPT}"

{
    sleep 45
    grep -q "^kpm_oc " /proc/modules 2>/dev/null || exit 0
    echo 1 > /sys/module/kpm_oc/parameters/cpu_oc_apply 2>/dev/null
    sleep 1
    for policy in 0 4 7; do
        max_val=$(json_int "cpu_max_${policy}")
        [ -n "${max_val}" ] && [ "${max_val}" -gt 0 ] 2>/dev/null && \
            echo "${max_val}" > "/sys/devices/system/cpu/cpufreq/policy${policy}/scaling_max_freq" 2>/dev/null
    done
    echo 1 > /sys/module/kpm_oc/parameters/gpu_oc_apply 2>/dev/null

    # ─── Thermal mitigation ───────────────────────────────────────────────
    cpu_thermal_mode=$(json_int cpu_thermal_mode)
    gpu_thermal_mode=$(json_int gpu_thermal_mode)
    cpu_thermal_mode=${cpu_thermal_mode:-0}
    gpu_thermal_mode=${gpu_thermal_mode:-0}

    if [ "${cpu_thermal_mode}" -gt 0 ] 2>/dev/null; then
        RAISE_DELTA=15000
        [ "${cpu_thermal_mode}" -ge 2 ] && RAISE_DELTA=30000
        for tz in /sys/class/thermal/thermal_zone*/; do
            type=$(cat "${tz}type" 2>/dev/null)
            case "${type}" in
                *cpu*|*CPU*|*soc*|*skin*)
                    for f in "${tz}"trip_point_*_temp; do
                        [ -f "${f}" ] || continue
                        t=$(cat "${f}" 2>/dev/null)
                        [ -n "${t}" ] && echo "$((t + RAISE_DELTA))" > "${f}" 2>/dev/null
                    done ;;
            esac
        done
        if [ "${cpu_thermal_mode}" -ge 2 ] 2>/dev/null; then
            for cd in /sys/class/thermal/cooling_device*/; do
                type=$(cat "${cd}type" 2>/dev/null)
                case "${type}" in
                    *cpufreq*|*cpu-freq*|*cpu_freq*)
                        echo 0 > "${cd}cur_state" 2>/dev/null ;;
                esac
            done
        fi
        logi "CPU thermal mitigation mode=${cpu_thermal_mode} applied (delta=${RAISE_DELTA}mC)"
    fi

    if [ "${gpu_thermal_mode}" -gt 0 ] 2>/dev/null; then
        for cd in /sys/class/thermal/cooling_device*/; do
            type=$(cat "${cd}type" 2>/dev/null)
            case "${type}" in
                *gpu*|*GPU*|*mali*|*Mali*|*GED*)
                    echo 0 > "${cd}cur_state" 2>/dev/null ;;
            esac
        done
        if [ "${gpu_thermal_mode}" -ge 2 ] 2>/dev/null; then
            echo 0 > /proc/gpufreqv2/fix_target_opp_index 2>/dev/null
        fi
        logi "GPU thermal mitigation mode=${gpu_thermal_mode} applied"
    fi

    # Re-apply DRAM min freq floor (vendor services may have reset it)
    dram_min=$(json_int dram_min_freq)
    if [ -n "${dram_min}" ] && [ "${dram_min}" -gt 0 ] 2>/dev/null; then
        echo "${dram_min}" | tee "${DRAM_DEVFREQ}/min_freq" > /dev/null 2>&1
    fi
    logi "Late-boot relift completed"

    # ─── Restore I/O & UFS settings on all UFS block devices ─────────────
    io_read_ahead=$(json_int io_read_ahead_kb)
    io_scheduler=$(json_str io_scheduler)
    io_nomerges=$(json_int io_nomerges)
    io_rq_affinity=$(json_int io_rq_affinity)
    io_iostats=$(json_int io_iostats)
    io_add_random=$(json_int io_add_random)

    for dev in /sys/block/sd*; do
        [ -d "${dev}/queue" ] || continue
        q="${dev}/queue"
        [ -n "${io_read_ahead}" ] && [ "${io_read_ahead}" -gt 0 ] 2>/dev/null && \
            echo "${io_read_ahead}" > "${q}/read_ahead_kb" 2>/dev/null
        [ -n "${io_scheduler}" ] && \
            echo "${io_scheduler}" > "${q}/scheduler" 2>/dev/null
        [ -n "${io_nomerges}" ] && \
            echo "${io_nomerges}" > "${q}/nomerges" 2>/dev/null
        [ -n "${io_rq_affinity}" ] && \
            echo "${io_rq_affinity}" > "${q}/rq_affinity" 2>/dev/null
        [ -n "${io_iostats}" ] && \
            echo "${io_iostats}" > "${q}/iostats" 2>/dev/null
        [ -n "${io_add_random}" ] && \
            echo "${io_add_random}" > "${q}/add_random" 2>/dev/null
    done
    logi "I/O tuning applied: ra=${io_read_ahead:-def} sched=${io_scheduler:-def} nom=${io_nomerges:-def} rqa=${io_rq_affinity:-def}"

    # ─── UFS controller (ufshcd) settings ────────────────────────────────
    if [ -d "${UFS_HCI_PATH}" ]; then
        ufs_wb=$(json_int ufs_wb_on)
        [ -n "${ufs_wb}" ] && echo "${ufs_wb}" > "${UFS_HCI_PATH}/wb_on" 2>/dev/null && \
            logi "UFS Write Booster = ${ufs_wb}"
    fi

    # ─── Auto Gaming Monitor Daemon ──────────────────────────────────────
    auto_gaming=$(json_int auto_gaming)
    gaming_apps_str=$(json_str gaming_apps)
    if [ "${auto_gaming}" = "1" ] && [ -n "${gaming_apps_str}" ]; then
        # Kill stale daemon if running
        [ -f "${CONFIG_DIR}/gaming_monitor.pid" ] && kill "$(cat "${CONFIG_DIR}/gaming_monitor.pid" 2>/dev/null)" 2>/dev/null
        sh "${GAMING_SCRIPT}" &
        logi "Gaming monitor daemon started (PID $!)"
    fi
} &

logi "Service script v8.0 completed. Module loaded."
