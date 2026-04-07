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
UFS_HCI_PATH="/sys/devices/platform/soc/112b0000.ufshci"
MALI_SYSFS="/sys/devices/platform/soc/13000000.mali"
MALI_DEBUGFS="/sys/kernel/debug/mali0"

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
CONF_GPU_TUNING="${CONF_DIR}/gpu_tuning.json"
CONF_CPU_TUNING="${CONF_DIR}/cpu_tuning.json"
CONF_DISPLAY="${CONF_DIR}/display_tuning.json"

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

json_float() {
    grep -o "\"$1\":[0-9.]*" "$2" 2>/dev/null | head -1 | sed 's/.*://'
}

json_str() {
    grep -o "\"$1\":\"[^\"]*\"" "$2" 2>/dev/null | head -1 | sed 's/.*:"\(.*\)"/\1/'
}

# Read int from nested JSON object: json_nested_int <parent> <key> <file>
# e.g. {"mali_driver":{"cmar_optimize_for_latency":1}} → json_nested_int mali_driver cmar_optimize_for_latency file
json_nested_int() {
    local parent_block
    parent_block=$(sed -n 's/.*"'"$1"'":{\([^}]*\)}.*/\1/p' "$3" 2>/dev/null | head -1)
    [ -z "${parent_block}" ] && return
    echo "${parent_block}" | grep -o "\"$2\":[0-9]*" | head -1 | grep -o '[0-9]*$'
}

# Extract JSON array of strings as space-separated values
# e.g. "key":["a","b","c"] → "a b c"
json_arr() {
    grep -o "\"$1\":\[\"[^]]*\]" "$2" 2>/dev/null | \
        sed 's/.*\[//;s/\]//;s/"//g;s/,/ /g'
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
    printf '{"ufs_wb_on":%s,"ufs_clkgate_enable":%s,"ufs_clkgate_delay_ms":%s,"ufs_auto_hibern8":%s,"ufs_rpm_lvl":%s,"ufs_spm_lvl":%s}\n' \
        "$(_oi ufs_wb_on)" "$(_oi ufs_clkgate_enable)" "$(_oi ufs_clkgate_delay_ms)" "$(_oi ufs_auto_hibern8)" "$(_oi ufs_rpm_lvl)" "$(_oi ufs_spm_lvl)" > "${CONF_UFS}"
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

# ─── Restore CPU voltage overrides from config ───────────────────────────
if [ -f "${CONF_CPU_OC}" ]; then
    cpu_ov=$(json_arr cpu_opp_overrides "${CONF_CPU_OC}")
    if [ -n "${cpu_ov}" ]; then
        echo "${cpu_ov}" > /sys/module/kpm_oc/parameters/cpu_volt_override 2>/dev/null
        cpu_ov_res=$(cat /sys/module/kpm_oc/parameters/cpu_volt_ov_result 2>/dev/null)
        logi "CPU volt overrides restored: ${cpu_ov_res}"
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

# ─── Restore GPU voltage overrides from config ───────────────────────────
if [ -f "${CONF_GPU_OC}" ]; then
    gpu_ov=$(json_arr gpu_opp_overrides "${CONF_GPU_OC}")
    if [ -n "${gpu_ov}" ]; then
        echo "${gpu_ov}" > /sys/module/kpm_oc/parameters/gpu_volt_override 2>/dev/null
        gpu_ov_res=$(cat /sys/module/kpm_oc/parameters/gpu_volt_ov_result 2>/dev/null)
        logi "GPU volt overrides restored: ${gpu_ov_res}"
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

# ─── GPU Mali kbase tuning (sysfs + debugfs) ─────────────────────────────
apply_gpu_tuning() {
    [ -f "${CONF_GPU_TUNING}" ] || return 0
    local mali="${MALI_SYSFS}"
    local dbg="${MALI_DEBUGFS}"

    # Mali kbase sysfs tunables
    local dvfs_period=$(json_int mali_dvfs_period "${CONF_GPU_TUNING}")
    local idle_hyst=$(json_int mali_idle_hysteresis_time "${CONF_GPU_TUNING}")
    local shader_pwroff=$(json_int mali_shader_pwroff_timeout "${CONF_GPU_TUNING}")
    local power_pol=$(json_str mali_power_policy "${CONF_GPU_TUNING}")
    local csg_period=$(json_int mali_csg_scheduling_period "${CONF_GPU_TUNING}")

    if [ -d "${mali}" ]; then
        [ -n "${dvfs_period}" ] && [ "${dvfs_period}" -gt 0 ] 2>/dev/null && \
            echo "${dvfs_period}" > "${mali}/dvfs_period" 2>/dev/null && \
            logi "Mali dvfs_period = ${dvfs_period}"
        [ -n "${idle_hyst}" ] && [ "${idle_hyst}" -gt 0 ] 2>/dev/null && \
            echo "${idle_hyst}" > "${mali}/idle_hysteresis_time" 2>/dev/null && \
            logi "Mali idle_hysteresis_time = ${idle_hyst}"
        [ -n "${shader_pwroff}" ] && [ "${shader_pwroff}" -gt 0 ] 2>/dev/null && \
            echo "${shader_pwroff}" > "${mali}/mcu_shader_pwroff_timeout" 2>/dev/null && \
            logi "Mali mcu_shader_pwroff_timeout = ${shader_pwroff}"
        [ -n "${power_pol}" ] && \
            echo "${power_pol}" > "${mali}/power_policy" 2>/dev/null && \
            logi "Mali power_policy = ${power_pol}"
        [ -n "${csg_period}" ] && [ "${csg_period}" -gt 0 ] 2>/dev/null && \
            echo "${csg_period}" > "${mali}/csg_scheduling_period" 2>/dev/null && \
            logi "Mali csg_scheduling_period = ${csg_period}"
    fi

    # Vulkan / HWUI system property overrides
    local vk_hwui=$(json_int vulkan_hwui "${CONF_GPU_TUNING}")
    local vk_render=$(json_int vulkan_renderengine "${CONF_GPU_TUNING}")
    if [ "${vk_hwui}" = "1" ] 2>/dev/null; then
        resetprop ro.hwui.use_vulkan true 2>/dev/null || setprop ro.hwui.use_vulkan true 2>/dev/null
        logi "Vulkan HWUI enabled"
    fi
    if [ "${vk_render}" = "1" ] 2>/dev/null; then
        setprop debug.renderengine.backend skiavk 2>/dev/null
        logi "RenderEngine backend = skiavk"
    fi

    # Mali driver config via vendor.mali.platform.config (MALI_PLATFORM_CONFIG)
    # Keys take effect at next GPU context creation (new app/activity launch).
    local cfg_parts=""
    local md_cmar=$(json_nested_int mali_driver cmar_optimize_for_latency "${CONF_GPU_TUNING}")
    local md_lto=$(json_nested_int mali_driver gles_disable_shader_lto "${CONF_GPU_TUNING}")
    local md_pilot=$(json_nested_int mali_driver gles_disable_pilot_shaders "${CONF_GPU_TUNING}")
    local md_pcache=$(json_nested_int mali_driver gles_disable_graphics_pipeline_cache "${CONF_GPU_TUNING}")
    local md_scache=$(json_nested_int mali_driver gles_disable_subpass_cache "${CONF_GPU_TUNING}")
    local md_safbc=$(json_nested_int mali_driver gles_disable_surface_afbc "${CONF_GPU_TUNING}")
    local md_tafbc=$(json_nested_int mali_driver gles_disable_texture_afbc "${CONF_GPU_TUNING}")
    local md_crc=$(json_nested_int mali_driver gles_disable_crc "${CONF_GPU_TUNING}")
    local md_idvs=$(json_nested_int mali_driver gles_disable_idvs "${CONF_GPU_TUNING}")
    local md_sched=$(json_nested_int mali_driver sched_rt_thread_priority "${CONF_GPU_TUNING}")
    local md_opt=$(json_nested_int mali_driver optimization_level "${CONF_GPU_TUNING}")
    local md_prerot=$(json_nested_int mali_driver mali_prerotate "${CONF_GPU_TUNING}")

    [ "${md_cmar}" = "1" ]   && cfg_parts="${cfg_parts:+${cfg_parts}:}CMAR_OPTIMIZE_FOR_LATENCY=1"
    [ "${md_lto}" = "1" ]    && cfg_parts="${cfg_parts:+${cfg_parts}:}GLES_DISABLE_SHADER_LTO=1"
    [ "${md_pilot}" = "1" ]  && cfg_parts="${cfg_parts:+${cfg_parts}:}GLES_DISABLE_PILOT_SHADERS=1"
    [ "${md_pcache}" = "1" ] && cfg_parts="${cfg_parts:+${cfg_parts}:}GLES_DISABLE_GRAPHICS_PIPELINE_CACHE=1"
    [ "${md_scache}" = "1" ] && cfg_parts="${cfg_parts:+${cfg_parts}:}GLES_DISABLE_SUBPASS_CACHE=1"
    [ "${md_safbc}" = "1" ]  && cfg_parts="${cfg_parts:+${cfg_parts}:}GLES_DISABLE_SURFACE_AFBC=1"
    [ "${md_tafbc}" = "1" ]  && cfg_parts="${cfg_parts:+${cfg_parts}:}GLES_DISABLE_TEXTURE_AFBC=1"
    [ "${md_crc}" = "1" ]    && cfg_parts="${cfg_parts:+${cfg_parts}:}GLES_DISABLE_CRC=1"
    [ "${md_idvs}" = "1" ]   && cfg_parts="${cfg_parts:+${cfg_parts}:}GLES_DISABLE_IDVS=1"
    [ -n "${md_sched}" ] && [ "${md_sched}" -gt 0 ] 2>/dev/null && \
        cfg_parts="${cfg_parts:+${cfg_parts}:}SCHED_RT_THREAD_PRIORITY=${md_sched}"
    [ -n "${md_opt}" ] && [ "${md_opt}" -gt 0 ] 2>/dev/null && \
        cfg_parts="${cfg_parts:+${cfg_parts}:}OPTIMIZATION_LEVEL=${md_opt}"

    if [ -n "${cfg_parts}" ]; then
        setprop vendor.mali.platform.config "${cfg_parts}" 2>/dev/null
        logi "vendor.mali.platform.config = ${cfg_parts}"
    else
        setprop vendor.mali.platform.config "" 2>/dev/null
    fi
    if [ "${md_prerot}" = "1" ]; then
        setprop vendor.mali.prerotate 1 2>/dev/null
        logi "vendor.mali.prerotate = 1"
    else
        setprop vendor.mali.prerotate "" 2>/dev/null
    fi
}
apply_gpu_tuning

# ─── CPU Tuning (governor, cpuidle, scheduler, uclamp, FPSGO) ────────────
apply_cpu_tuning() {
    [ -f "${CONF_CPU_TUNING}" ] || return 0

    local up_rate=$(json_int sugov_up_rate_limit_us "${CONF_CPU_TUNING}")
    local down_rate=$(json_int sugov_down_rate_limit_us "${CONF_CPU_TUNING}")
    local idle_max=$(json_int cpuidle_max_state "${CONF_CPU_TUNING}")
    local eas=$(json_int sched_energy_aware "${CONF_CPU_TUNING}")
    local child_first=$(json_int sched_child_runs_first "${CONF_CPU_TUNING}")
    local uclamp_min=$(json_int uclamp_top_app_min "${CONF_CPU_TUNING}")
    local fpsgo_ta=$(json_int fpsgo_boost_ta "${CONF_CPU_TUNING}")
    local fpsgo_rescue=$(json_int fpsgo_rescue_enable "${CONF_CPU_TUNING}")

    # sugov_ext rate limits (per cluster)
    for p in 0 4 7; do
        local ext="/sys/devices/system/cpu/cpufreq/policy${p}/sugov_ext"
        [ -d "${ext}" ] || continue
        [ -n "${up_rate}" ] && echo "${up_rate}" > "${ext}/up_rate_limit_us" 2>/dev/null
        [ -n "${down_rate}" ] && echo "${down_rate}" > "${ext}/down_rate_limit_us" 2>/dev/null
    done
    [ -n "${up_rate}" ] && logi "sugov_ext up_rate_limit_us = ${up_rate}"
    [ -n "${down_rate}" ] && logi "sugov_ext down_rate_limit_us = ${down_rate}"

    # cpuidle: disable deep states above max_state
    if [ -n "${idle_max}" ]; then
        for cpu in 0 1 2 3 4 5 6 7; do
            local base="/sys/devices/system/cpu/cpu${cpu}/cpuidle"
            [ -d "${base}" ] || continue
            for s in 0 1 2 3 4 5 6 7 8 9; do
                local sp="${base}/state${s}"
                [ -d "${sp}" ] || break
                if [ "${s}" -gt "${idle_max}" ]; then
                    echo 1 > "${sp}/disable" 2>/dev/null
                else
                    echo 0 > "${sp}/disable" 2>/dev/null
                fi
            done
        done
        logi "cpuidle max_state = ${idle_max}"
    fi

    # Scheduler parameters
    [ -n "${eas}" ] && echo "${eas}" > /proc/sys/kernel/sched_energy_aware 2>/dev/null && \
        logi "sched_energy_aware = ${eas}"
    [ -n "${child_first}" ] && echo "${child_first}" > /proc/sys/kernel/sched_child_runs_first 2>/dev/null && \
        logi "sched_child_runs_first = ${child_first}"

    # Uclamp: top-app min boost
    if [ -n "${uclamp_min}" ] && [ "${uclamp_min}" -ge 0 ] 2>/dev/null; then
        local uclamp_pct
        # Convert 0-1024 to 0.00-100.00 percentage string
        if [ "${uclamp_min}" -eq 0 ]; then
            uclamp_pct="0.00"
        else
            uclamp_pct=$(awk "BEGIN{printf \"%.2f\", ${uclamp_min}/1024*100}")
        fi
        echo "${uclamp_pct}" > /dev/cpuctl/top-app/cpu.uclamp.min 2>/dev/null && \
            logi "uclamp top-app min = ${uclamp_pct}% (${uclamp_min}/1024)"
    fi

    # FPSGO frame boost tuning
    [ -n "${fpsgo_ta}" ] && echo "${fpsgo_ta}" > /sys/kernel/fpsgo/fbt/boost_ta 2>/dev/null && \
        logi "fpsgo boost_ta = ${fpsgo_ta}"
    [ -n "${fpsgo_rescue}" ] && echo "${fpsgo_rescue}" > /sys/kernel/fpsgo/fbt/rescue_enable 2>/dev/null && \
        logi "fpsgo rescue_enable = ${fpsgo_rescue}"
}
apply_cpu_tuning

# ─── Display Tuning ──────────────────────────────────────────────────────
apply_display_tuning() {
    [ -f "${CONF_DISPLAY}" ] || return 0

    local rmode=$(cat "${CONF_DISPLAY}" | grep -o '"refresh_mode":"[^"]*"' | cut -d'"' -f4)
    local peak_rr=$(json_int peak_refresh_rate "${CONF_DISPLAY}")
    local min_rr=$(json_int min_refresh_rate "${CONF_DISPLAY}")
    local anim_dur=$(json_float animator_duration "${CONF_DISPLAY}")
    local trans_dur=$(json_float transition_duration "${CONF_DISPLAY}")
    local win_dur=$(json_float window_duration "${CONF_DISPLAY}")
    local color_sat=$(json_float color_saturation "${CONF_DISPLAY}")
    local shp_idx=$(json_int sharpness_idx "${CONF_DISPLAY}")
    local ultra_res=$(json_int ultra_resolution "${CONF_DISPLAY}")
    local dre_en=$(json_int dre_enable "${CONF_DISPLAY}")
    local hdr_adp=$(json_int hdr_adaptive "${CONF_DISPLAY}")
    local hfg=$(json_int hfg_level "${CONF_DISPLAY}")
    local idle_time=$(json_int display_idle_time "${CONF_DISPLAY}")

    # Refresh rate
    if [ "${rmode}" = "adaptive" ]; then
        # Adaptive: min must be >61 to bypass OEM DEFAULT_REFRESH_RATE vote (max=61)
        [ -z "${min_rr}" ] && min_rr=90
        [ "${min_rr}" -le 61 ] 2>/dev/null && min_rr=90
        logi "refresh_mode = adaptive"
    else
        # Fixed: lock min = peak
        [ -n "${peak_rr}" ] && min_rr="${peak_rr}"
    fi
    [ -n "${peak_rr}" ] && settings put system peak_refresh_rate "${peak_rr}" 2>/dev/null && \
        logi "peak_refresh_rate = ${peak_rr}"
    [ -n "${min_rr}" ] && settings put system min_refresh_rate "${min_rr}" 2>/dev/null && \
        logi "min_refresh_rate = ${min_rr}"

    # Animation scales
    [ -n "${anim_dur}" ] && settings put global animator_duration_scale "${anim_dur}" 2>/dev/null && \
        logi "animator_duration_scale = ${anim_dur}"
    [ -n "${trans_dur}" ] && settings put global transition_animation_scale "${trans_dur}" 2>/dev/null && \
        logi "transition_animation_scale = ${trans_dur}"
    [ -n "${win_dur}" ] && settings put global window_animation_scale "${win_dur}" 2>/dev/null && \
        logi "window_animation_scale = ${win_dur}"

    # Color saturation (SurfaceFlinger)
    [ -n "${color_sat}" ] && resetprop persist.sys.sf.color_saturation "${color_sat}" 2>/dev/null && \
        logi "color_saturation = ${color_sat}"

    # MTK PQ: sharpness
    [ -n "${shp_idx}" ] && resetprop persist.vendor.sys.pq.shp.idx "${shp_idx}" 2>/dev/null && \
        logi "sharpness idx = ${shp_idx}"

    # MTK PQ: ultra resolution
    [ -n "${ultra_res}" ] && resetprop persist.vendor.sys.pq.ultrares.en "${ultra_res}" 2>/dev/null && \
        logi "ultra_resolution = ${ultra_res}"

    # MTK PQ: DRE (Dynamic Range Enhancement)
    [ -n "${dre_en}" ] && resetprop persist.vendor.sys.pq.mdp.dre.en "${dre_en}" 2>/dev/null && \
        resetprop persist.vendor.sys.pq.mdp.vp.dre.en "${dre_en}" 2>/dev/null && \
        logi "DRE = ${dre_en}"

    # MTK PQ: HDR10 adaptive TM
    [ -n "${hdr_adp}" ] && resetprop persist.vendor.sys.pq.hdr10.adaptive.en "${hdr_adp}" 2>/dev/null && \
        resetprop persist.vendor.sys.pq.hdr10p.adaptive.en "${hdr_adp}" 2>/dev/null && \
        logi "HDR adaptive = ${hdr_adp}"

    # MTK PQ: HFG (high frequency grain)
    [ -n "${hfg}" ] && resetprop persist.vendor.sys.pq.hfg.en "${hfg}" 2>/dev/null && \
        logi "HFG = ${hfg}"

    # Display idle timeout
    [ -n "${idle_time}" ] && echo "${idle_time}" > /proc/displowpower/idletime 2>/dev/null && \
        logi "display idle time = ${idle_time} ms"
}
apply_display_tuning

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
        # GPU power_policy → always_on (eliminates power gating latency)
        echo always_on > /sys/devices/platform/soc/13000000.mali/power_policy 2>/dev/null
        echo 6400000000 > "${DRAM_DF}/min_freq" 2>/dev/null
        log -t "KPM_OC" "Gaming boost ON: $FG"
        BOOSTED=1
    elif [ "$IS_GAMING" = "0" ] && [ "$BOOSTED" = "1" ]; then
        # Revert to saved power mode
        pm=$(_ji power_mode "$CONF/profile.json")
        pm=${pm:-1}
        # Restore GPU power_policy from gpu_tuning config (default: coarse_demand)
        GP=$(_js mali_power_policy "$CONF/gpu_tuning.json")
        echo "${GP:-coarse_demand}" > /sys/devices/platform/soc/13000000.mali/power_policy 2>/dev/null
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

    # Re-apply voltage overrides after late relift
    if [ -f "${CONF_CPU_OC}" ]; then
        cpu_ov=$(grep -o '"cpu_opp_overrides":\["[^]]*\]' "${CONF_CPU_OC}" 2>/dev/null | \
            sed 's/.*\[//;s/\]//;s/"//g;s/,/ /g')
        [ -n "${cpu_ov}" ] && echo "${cpu_ov}" > /sys/module/kpm_oc/parameters/cpu_volt_override 2>/dev/null
    fi
    if [ -f "${CONF_GPU_OC}" ]; then
        gpu_ov=$(grep -o '"gpu_opp_overrides":\["[^]]*\]' "${CONF_GPU_OC}" 2>/dev/null | \
            sed 's/.*\[//;s/\]//;s/"//g;s/,/ /g')
        [ -n "${gpu_ov}" ] && echo "${gpu_ov}" > /sys/module/kpm_oc/parameters/gpu_volt_override 2>/dev/null
    fi

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
        ufs_cg=$(json_int ufs_clkgate_enable "${CONF_UFS}")
        ufs_cd=$(json_int ufs_clkgate_delay_ms "${CONF_UFS}")
        ufs_ah=$(json_int ufs_auto_hibern8 "${CONF_UFS}")
        ufs_rpm=$(json_int ufs_rpm_lvl "${CONF_UFS}")
        ufs_spm=$(json_int ufs_spm_lvl "${CONF_UFS}")
        # Use printf|tee to avoid shell redirect O_CREAT issue on sysfs
        [ -n "${ufs_wb}" ]  && printf '%s' "${ufs_wb}"  | tee "${UFS_HCI_PATH}/wb_on" > /dev/null 2>&1 && \
            logi "UFS Write Booster = ${ufs_wb}"
        [ -n "${ufs_cg}" ]  && printf '%s' "${ufs_cg}"  | tee "${UFS_HCI_PATH}/clkgate_enable" > /dev/null 2>&1 && \
            logi "UFS Clock Gating = ${ufs_cg}"
        [ -n "${ufs_cd}" ]  && printf '%s' "${ufs_cd}"  | tee "${UFS_HCI_PATH}/clkgate_delay_ms" > /dev/null 2>&1 && \
            logi "UFS CLK Gate Delay = ${ufs_cd} ms"
        [ -n "${ufs_ah}" ]  && printf '%s' "${ufs_ah}"  | tee "${UFS_HCI_PATH}/auto_hibern8" > /dev/null 2>&1 && \
            logi "UFS Auto Hibern8 = ${ufs_ah} us"
        [ -n "${ufs_rpm}" ] && printf '%s' "${ufs_rpm}" | tee "${UFS_HCI_PATH}/rpm_lvl" > /dev/null 2>&1 && \
            logi "UFS RPM Level = ${ufs_rpm}"
        [ -n "${ufs_spm}" ] && printf '%s' "${ufs_spm}" | tee "${UFS_HCI_PATH}/spm_lvl" > /dev/null 2>&1 && \
            logi "UFS SPM Level = ${ufs_spm}"
    fi

    # ─── Re-apply GPU Mali tuning (vendor services may reset sysfs) ──────
    apply_gpu_tuning

    # ─── Re-apply CPU tuning (vendor services may reset governor/cpuidle) ─
    apply_cpu_tuning

    # ─── Re-apply display tuning (vendor services may reset props) ────
    apply_display_tuning

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
