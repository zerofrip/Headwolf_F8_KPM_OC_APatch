#!/system/bin/sh
# suspend_probe.sh - Controlled live suspend test for Headwolf F8
#
# Goal:
#   Reproduce the sleep-watchdog reboot in a SUPERVISED way so the kpm_oc
#   suspend tracer (suspend_trace_enabled) and PM core verbose logging
#   (pm_print_times) capture the exact device whose noirq callback hangs.
#
# Safety measures:
#   * RTC wakealarm is armed FIRST so that even if the device enters the
#     buggy suspend path and completes, it will auto-resume in <timeout>
#     seconds.
#   * If the device truly hangs, the hardware watchdog will still reset
#     it — but on next boot the trace lines WILL be in console-ramoops.
#   * A cancellation wakelock is re-acquired immediately after the test
#     so normal operation goes right back to the stable "no deep sleep"
#     configuration.
#
# Usage (run from adb shell su):
#   sh /data/adb/modules/f8_kpm_oc_manager/tools/suspend_probe.sh [SECONDS]
#
# SECONDS defaults to 20 (total RTC timeout).  The script will first
# release the f8_sleep_reboot_guard wakelock, then write "freeze" to
# /sys/power/state, then re-acquire the guard on return.

set -u

SECONDS_ARG="${1:-20}"
TAG="KPM_SUSPEND_PROBE"
LOG_MARK="KPMPROBE-$(date +%Y%m%d-%H%M%S)"

log_ln() { echo "[$TAG] $*"; log -t "$TAG" "$*"; }

if [ "$(id -u)" != 0 ]; then
    echo "[$TAG] ERROR: must run as root (su)"; exit 1
fi

# ─── Preconditions ────────────────────────────────────────────────────────
if ! grep -q "^kpm_oc " /proc/modules 2>/dev/null; then
    log_ln "ERROR: kpm_oc module is not loaded"; exit 1
fi

if [ ! -w /sys/module/kpm_oc/parameters/suspend_trace_enabled ]; then
    log_ln "ERROR: kpm_oc does not expose suspend_trace_enabled — rebuild module"
    exit 1
fi

if [ ! -w /sys/class/rtc/rtc0/wakealarm ]; then
    log_ln "ERROR: /sys/class/rtc/rtc0/wakealarm not writable"; exit 1
fi

if [ ! -w /sys/power/state ]; then
    log_ln "ERROR: /sys/power/state not writable"; exit 1
fi

# ─── Mark kernel log so we can isolate this test cycle ────────────────────
echo "=== $LOG_MARK ===" > /dev/kmsg 2>/dev/null
log_ln "Probe start: mark=$LOG_MARK rtc=${SECONDS_ARG}s"

# ─── Enable PM verbose + tracer ───────────────────────────────────────────
echo 1 > /sys/power/pm_print_times 2>/dev/null && \
    log_ln "pm_print_times = 1"
echo 1 > /sys/power/pm_debug_messages 2>/dev/null && \
    log_ln "pm_debug_messages = 1"

# Force mem_sleep = s2idle (this target only supports s2idle anyway)
if [ -w /sys/power/mem_sleep ]; then
    echo s2idle > /sys/power/mem_sleep 2>/dev/null
    log_ln "mem_sleep = $(cat /sys/power/mem_sleep 2>/dev/null)"
fi

echo Y > /sys/module/kpm_oc/parameters/suspend_trace_enabled 2>/dev/null
TRACE_STATE=$(cat /sys/module/kpm_oc/parameters/suspend_trace_enabled 2>/dev/null)
log_ln "kpm_oc suspend_trace_enabled = $TRACE_STATE"

# ─── Release the sleep-reboot guard wakelock so suspend can proceed ──────
GUARD_ACTIVE=0
if grep -q "^f8_sleep_reboot_guard" /sys/power/wake_lock 2>/dev/null; then
    GUARD_ACTIVE=1
fi
if [ "$GUARD_ACTIVE" = "1" ]; then
    echo f8_sleep_reboot_guard > /sys/power/wake_unlock 2>/dev/null
    log_ln "Released f8_sleep_reboot_guard wakelock (was active)"
fi

# Also release userspace wakelocks known to block suspend aggressively
for w in PowerManagerService.Display PowerManagerService.WakeLocks \
         sensor_client wlan audio_pcm_wl; do
    echo "$w" > /sys/power/wake_unlock 2>/dev/null
done

# ─── Arm RTC wakealarm BEFORE entering suspend (safety net) ──────────────
echo 0 > /sys/class/rtc/rtc0/wakealarm 2>/dev/null
NOW=$(cat /proc/driver/rtc 2>/dev/null | grep "rtc_time" | head -1)
WAKE_TS=$(($(date +%s) + SECONDS_ARG))
echo "$WAKE_TS" > /sys/class/rtc/rtc0/wakealarm 2>/dev/null
log_ln "RTC wakealarm armed for +${SECONDS_ARG}s (epoch=$WAKE_TS)"

# ─── Enter freeze (s2idle) ────────────────────────────────────────────────
echo "=== $LOG_MARK : entering freeze ===" > /dev/kmsg 2>/dev/null
log_ln "Entering /sys/power/state = freeze now ..."
SUSPEND_START=$(date +%s.%N)
echo freeze > /sys/power/state 2>/dev/null
SUSPEND_END=$(date +%s.%N)
ELAPSED=$(awk "BEGIN{printf \"%.2f\", $SUSPEND_END - $SUSPEND_START}")
echo "=== $LOG_MARK : returned from freeze after ${ELAPSED}s ===" \
    > /dev/kmsg 2>/dev/null
log_ln "Returned from freeze after ${ELAPSED}s"

# ─── Restore the sleep-reboot guard so normal op is stable again ──────────
if [ "$GUARD_ACTIVE" = "1" ]; then
    echo f8_sleep_reboot_guard > /sys/power/wake_lock 2>/dev/null
    log_ln "Re-acquired f8_sleep_reboot_guard wakelock"
fi

# ─── Dump relevant trace from dmesg ───────────────────────────────────────
log_ln "=== Last KPMTRACE lines (use this to identify hanging device) ==="
dmesg 2>/dev/null | grep -E "KPMTRACE|PM:|suspend|resume|$LOG_MARK" | \
    tail -200 | while IFS= read -r ln; do echo "[$TAG] $ln"; done

log_ln "=== Check for previous-boot console-ramoops ==="
if [ -r /sys/fs/pstore/console-ramoops-0 ]; then
    log_ln "(present — if this test caused a silent reset, reboot and inspect)"
fi

log_ln "Probe end: mark=$LOG_MARK"
