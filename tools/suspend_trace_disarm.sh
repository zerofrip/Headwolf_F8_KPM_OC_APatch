#!/system/bin/sh
# suspend_trace_disarm.sh - Restore the safe sleep-guard state
#
# Use this after a production sleep test that did NOT crash the device.
# It disables the tracer and re-acquires the f8_sleep_reboot_guard wakelock
# so normal operation returns to the "no deep sleep" stable configuration.

TAG="KPM_TRACE_DISARM"
log_ln() { echo "[$TAG] $*"; log -t "$TAG" "$*"; }

if [ "$(id -u)" != 0 ]; then
    echo "[$TAG] ERROR: must run as root (su)"; exit 1
fi

echo N > /sys/module/kpm_oc/parameters/suspend_trace_enabled 2>/dev/null && \
    log_ln "suspend_trace_enabled = N"

echo 0 > /sys/power/pm_print_times 2>/dev/null
echo 0 > /sys/power/pm_debug_messages 2>/dev/null
log_ln "pm_print_times / pm_debug_messages cleared"

# Restore the cpuidle max state from cpu_tuning.json (re-enable every state
# the user permits; during diagnostic sleep tests we may have capped the
# deepest state to cluster-off, but for normal operation the full idle
# ladder up to system-bus (rc=6) is safe and yields better idle power).
CONF="/data/adb/modules/f8_kpm_oc_manager/conf/cpu_tuning.json"
if [ -f "$CONF" ]; then
    idle_max=$(grep -o '"cpuidle_max_state":[0-9]*' "$CONF" 2>/dev/null | \
                head -1 | grep -o '[0-9]*$')
    [ -z "$idle_max" ] && idle_max=6
    for cpu in 0 1 2 3 4 5 6 7; do
        base="/sys/devices/system/cpu/cpu${cpu}/cpuidle"
        [ -d "$base" ] || continue
        for s in 0 1 2 3 4 5 6 7 8 9; do
            sp="${base}/state${s}"
            [ -d "$sp" ] || break
            if [ "$s" -gt "$idle_max" ]; then
                echo 1 > "${sp}/disable" 2>/dev/null
            else
                echo 0 > "${sp}/disable" 2>/dev/null
            fi
        done
    done
    log_ln "cpuidle max_state restored to ${idle_max}"
fi

echo f8_sleep_reboot_guard > /sys/power/wake_lock 2>/dev/null && \
    log_ln "Re-acquired f8_sleep_reboot_guard wakelock"

log_ln "Disarmed.  Device is back to the stable 'no deep sleep' guard state."
