#!/system/bin/sh
# Headwolf F8 KPM OC Manager - Service Script v9.0
# Reads CPU OPP from kernel module (CSRAM), GPU OPP from /proc/gpufreqv2
# Restores OC config (CPU/GPU/DRAM/IO/UFS) and scaling limits from saved config
# v9.0: Split config into per-section JSON files under conf/
MODDIR=${0%/*}
CONFIG_DIR="/data/adb/modules/f8_kpm_oc_manager"
CPU_OPP_FILE="${CONFIG_DIR}/cpu_opp_table"
GPU_OPP_FILE="${CONFIG_DIR}/gpu_opp_table"
CPU_RAW_FILE="${CONFIG_DIR}/cpu_raw_dump"
UFS_HCI_PATH="/sys/devices/platform/11270000.ufshci"

# ─── Split config paths ──────────────────────────────────────────────────
CONF_DIR="${CONFIG_DIR}/conf"
CONF_CPU_OC="${CONF_DIR}/cpu_oc.json"
CONF_GPU_OC="${CONF_DIR}/gpu_oc.json"
CONF_CPU_SCALING="${CONF_DIR}/cpu_scaling.json"
CONF_DRAM="${CONF_DIR}/dram.json"
CONF_IO="${CONF_DIR}/io.json"
CONF_UFS="${CONF_DIR}/ufs.json"
CONF_THERMAL="${CONF_DIR}/thermal.json"
CONF_PROFILE="${CONF_DIR}/profile.json"

# Legacy single-file config (for migration)
OLD_CONFIG_FILE="${CONFIG_DIR}/oc_config.json"

mkdir -p "${CONF_DIR}" 2>/dev/null

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

# ─── JSON helpers (second arg = file path) ────────────────────────────────
json_int() {
    grep -o "\"$1\":[0-9]*" "$2" 2>/dev/null | head -1 | grep -o '[0-9]*$'
}

json_str() {
    grep -o "\"$1\":\"[^\"]*\"" "$2" 2>/dev/null | head -1 | sed 's/.*:"\(.*\)"/\1/'
}

# ─── Migrate from legacy single-file config to split files ────────────────
migrate_legacy_config() {
    [ -f "${OLD_CONFIG_FILE}" ] || return 0
    [ -f "${CONF_CPU_OC}" ] && return 0   # already migrated

    logi "Migrating legacy oc_config.json to split conf/ files..."
    local o="${OLD_CONFIG_FILE}"
    _oi() { local v; v=$(grep -o "\"$1\":[0-9]*" "${o}" 2>/dev/null | head -1 | grep -o '[0-9]*$'); echo "${v:-0}"; }
    _os() { grep -o "\"$1\":\"[^\"]*\"" "${o}" 2>/dev/null | head -1 | sed 's/.*:"\(.*\)"/\1/'; }

    printf '{"cpu_oc_l_freq":%s,"cpu_oc_l_volt":%s,"cpu_oc_b_freq":%s,"cpu_oc_b_volt":%s,"cpu_oc_p_freq":%s,"cpu_oc_p_volt":%s}\n' \
        "$(_oi cpu_oc_l_freq)" "$(_oi cpu_oc_l_volt)" "$(_oi cpu_oc_b_freq)" "$(_oi cpu_oc_b_volt)" "$(_oi cpu_oc_p_freq)" "$(_oi cpu_oc_p_volt)" > "${CONF_CPU_OC}"
    printf '{"gpu_oc_freq":%s,"gpu_oc_volt":%s,"gpu_oc_vsram":%s}\n' \
        "$(_oi gpu_oc_freq)" "$(_oi gpu_oc_volt)" "$(_oi gpu_oc_vsram)" > "${CONF_GPU_OC}"
    printf '{"cpu_max_0":%s,"cpu_min_0":%s,"cpu_max_4":%s,"cpu_min_4":%s,"cpu_max_7":%s,"cpu_min_7":%s}\n' \
        "$(_oi cpu_max_0)" "$(_oi cpu_min_0)" "$(_oi cpu_max_4)" "$(_oi cpu_min_4)" "$(_oi cpu_max_7)" "$(_oi cpu_min_7)" > "${CONF_CPU_SCALING}"
    printf '{"dram_min_freq":%s}\n' "$(_oi dram_min_freq)" > "${CONF_DRAM}"
    printf '{"io_read_ahead_kb":%s,"io_scheduler":"%s","io_nomerges":%s,"io_rq_affinity":%s,"io_iostats":%s,"io_add_random":%s}\n' \
        "$(_oi io_read_ahead_kb)" "$(_os io_scheduler)" "$(_oi io_nomerges)" "$(_oi io_rq_affinity)" "$(_oi io_iostats)" "$(_oi io_add_random)" > "${CONF_IO}"
    printf '{"ufs_wb_on":%s}\n' "$(_oi ufs_wb_on)" > "${CONF_UFS}"
    printf '{"cpu_thermal_mode":%s,"gpu_thermal_mode":%s}\n' "$(_oi cpu_thermal_mode)" "$(_oi gpu_thermal_mode)" > "${CONF_THERMAL}"
    printf '{"power_mode":%s,"auto_gaming":%s,"gaming_apps":"%s"}\n' \
        "$(_oi power_mode)" "$(_oi auto_gaming)" "$(_os gaming_apps)" > "${CONF_PROFILE}"

    mv "${OLD_CONFIG_FILE}" "${OLD_CONFIG_FILE}.bak.v9"
    logi "Migration complete. Old config backed up."
    unset -f _oi _os
}

# ─── Seed defaults on first install ───────────────────────────────────────
seed_default_conf() {
    local defaults="${MODDIR}/conf.default"
    [ -d "${defaults}" ] || return 0
    for src in "${defaults}"/*.json; do
        [ -f "${src}" ] || continue
        local name=$(basename "${src}")
        local dst="${CONF_DIR}/${name}"
        if [ ! -f "${dst}" ]; then
            cp "${src}" "${dst}"
            logi "Seeded default: ${name}"
        fi
    done
}

migrate_legacy_config
seed_default_conf

INSMOD_PARAMS=""
if [ -f "${CONF_CPU_OC}" ]; then
    for key in cpu_oc_l_freq cpu_oc_l_volt cpu_oc_b_freq cpu_oc_b_volt \
               cpu_oc_p_freq cpu_oc_p_volt; do
        v=$(json_int "${key}" "${CONF_CPU_OC}")
        [ -n "$v" ] && [ "$v" != "0" ] && INSMOD_PARAMS="${INSMOD_PARAMS} ${key}=${v}"
    done
fi
if [ -f "${CONF_GPU_OC}" ]; then
    # GPU OC: config keys → module param names
    v=$(json_int gpu_oc_freq "${CONF_GPU_OC}");  [ -n "$v" ] && [ "$v" != "0" ] && INSMOD_PARAMS="${INSMOD_PARAMS} gpu_target_freq=$v"
    v=$(json_int gpu_oc_volt "${CONF_GPU_OC}");  [ -n "$v" ] && [ "$v" != "0" ] && INSMOD_PARAMS="${INSMOD_PARAMS} gpu_target_volt=$v"
    v=$(json_int gpu_oc_vsram "${CONF_GPU_OC}"); [ -n "$v" ] && [ "$v" != "0" ] && INSMOD_PARAMS="${INSMOD_PARAMS} gpu_target_vsram=$v"
fi
logi "OC config loaded:${INSMOD_PARAMS:-" (none)"}"

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
if [ -f "${CONF_CPU_SCALING}" ]; then
    for policy in 0 4 7; do
        max_val=$(json_int "cpu_max_${policy}" "${CONF_CPU_SCALING}")
        min_val=$(json_int "cpu_min_${policy}" "${CONF_CPU_SCALING}")
        if [ -n "$min_val" ] && [ "$min_val" -gt 0 ] 2>/dev/null; then
            echo "$min_val" > /sys/devices/system/cpu/cpufreq/policy${policy}/scaling_min_freq 2>/dev/null
        fi
        if [ -n "$max_val" ] && [ "$max_val" -gt 0 ] 2>/dev/null; then
            echo "$max_val" > /sys/devices/system/cpu/cpufreq/policy${policy}/scaling_max_freq 2>/dev/null
        fi
    done
    logi "CPU scaling limits restored from config"
fi

    # CPU OC relift pass: vendor constraints can race and clamp first write.
    # Re-run cpu_oc_apply, then restore scaling_max once more.
if [ -f "${CONF_CPU_OC}" ]; then
    cpu_oc_enabled=0
    for key in cpu_oc_l_freq cpu_oc_b_freq cpu_oc_p_freq; do
        v=$(json_int "${key}" "${CONF_CPU_OC}")
        if [ -n "${v}" ] && [ "${v}" -gt 0 ] 2>/dev/null; then
            cpu_oc_enabled=1
            break
        fi
    done

    if [ "${cpu_oc_enabled}" = "1" ]; then
        echo 1 > /sys/module/kpm_oc/parameters/cpu_oc_apply 2>/dev/null
        sleep 1
        if [ -f "${CONF_CPU_SCALING}" ]; then
            for policy in 0 4 7; do
                max_val=$(json_int "cpu_max_${policy}" "${CONF_CPU_SCALING}")
                if [ -n "${max_val}" ] && [ "${max_val}" -gt 0 ] 2>/dev/null; then
                    echo "$max_val" > /sys/devices/system/cpu/cpufreq/policy${policy}/scaling_max_freq 2>/dev/null
                fi
            done
        fi
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
if [ -f "${CONF_GPU_OC}" ]; then
    gpu_freq=$(json_int gpu_oc_freq "${CONF_GPU_OC}")
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
if [ -f "${CONF_DRAM}" ] && [ -d "${DRAM_DEVFREQ}" ]; then
    dram_min=$(json_int dram_min_freq "${CONF_DRAM}")
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
CONF="/data/adb/modules/f8_kpm_oc_manager/conf"
PID_F="/data/adb/modules/f8_kpm_oc_manager/gaming_monitor.pid"
KS="/sys/module/kpm_oc/parameters/"
DRAM_DF="/sys/class/devfreq/mtk-dvfsrc-devfreq"

echo $$ > "$PID_F"
BOOSTED=0

# Escape cgroup v2 freezer — Android freezes background UIDs
echo $$ > /sys/fs/cgroup/cgroup.procs 2>/dev/null
echo $$ > /dev/cpuset/cgroup.procs 2>/dev/null
echo $$ > /dev/blkio/cgroup.procs 2>/dev/null
echo $$ > /dev/cpuctl/cgroup.procs 2>/dev/null

_ji() { grep -o "\"$1\":[0-9]*" "$2" 2>/dev/null | head -1 | grep -o '[0-9]*$'; }
_js() { grep -o "\"$1\":\"[^\"]*\"" "$2" 2>/dev/null | head -1 | sed 's/.*:"\(.*\)"/\1/'; }

while true; do
    games=$(_js gaming_apps "$CONF/profile.json")
    [ -z "$games" ] && sleep 5 && continue

    FG=$(dumpsys activity activities 2>/dev/null | grep 'ResumedActivity' | head -1 | sed 's|.*u0 ||;s|/.*||;s| .*||')
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
        pm=$(_ji power_mode "$CONF/profile.json")
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
                    mv=$(_ji "cpu_max_${p}" "$CONF/cpu_scaling.json")
                    [ -n "$mv" ] && echo "$mv" > "/sys/devices/system/cpu/cpufreq/policy${p}/scaling_max_freq" 2>/dev/null
                done
                dm=$(_ji dram_min_freq "$CONF/dram.json")
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
        max_val=$(json_int "cpu_max_${policy}" "${CONF_CPU_SCALING}")
        [ -n "${max_val}" ] && [ "${max_val}" -gt 0 ] 2>/dev/null && \
            echo "${max_val}" > "/sys/devices/system/cpu/cpufreq/policy${policy}/scaling_max_freq" 2>/dev/null
    done
    echo 1 > /sys/module/kpm_oc/parameters/gpu_oc_apply 2>/dev/null

    # ─── Thermal mitigation ───────────────────────────────────────────────
    cpu_thermal_mode=$(json_int cpu_thermal_mode "${CONF_THERMAL}")
    gpu_thermal_mode=$(json_int gpu_thermal_mode "${CONF_THERMAL}")
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
    dram_min=$(json_int dram_min_freq "${CONF_DRAM}")
    if [ -n "${dram_min}" ] && [ "${dram_min}" -gt 0 ] 2>/dev/null; then
        echo "${dram_min}" | tee "${DRAM_DEVFREQ}/min_freq" > /dev/null 2>&1
    fi
    logi "Late-boot relift completed"

    # ─── Restore I/O & UFS settings on all UFS block devices ─────────────
    io_read_ahead=$(json_int io_read_ahead_kb "${CONF_IO}")
    io_scheduler=$(json_str io_scheduler "${CONF_IO}")
    io_nomerges=$(json_int io_nomerges "${CONF_IO}")
    io_rq_affinity=$(json_int io_rq_affinity "${CONF_IO}")
    io_iostats=$(json_int io_iostats "${CONF_IO}")
    io_add_random=$(json_int io_add_random "${CONF_IO}")

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
        ufs_wb=$(json_int ufs_wb_on "${CONF_UFS}")
        [ -n "${ufs_wb}" ] && echo "${ufs_wb}" > "${UFS_HCI_PATH}/wb_on" 2>/dev/null && \
            logi "UFS Write Booster = ${ufs_wb}"
    fi

    # ─── Auto Gaming Monitor Daemon ──────────────────────────────────────
    auto_gaming=$(json_int auto_gaming "${CONF_PROFILE}")
    gaming_apps_str=$(json_str gaming_apps "${CONF_PROFILE}")
    if [ "${auto_gaming}" = "1" ] && [ -n "${gaming_apps_str}" ]; then
        # Kill stale daemon if running
        [ -f "${CONFIG_DIR}/gaming_monitor.pid" ] && kill "$(cat "${CONFIG_DIR}/gaming_monitor.pid" 2>/dev/null)" 2>/dev/null
        sh "${GAMING_SCRIPT}" &
        logi "Gaming monitor daemon started (PID $!)"
    fi
} &

logi "Service script v9.0 completed. Module loaded."
