#!/system/bin/sh
# suspend_trace_arm.sh - Arm kpm_oc suspend tracer for production sleep test
#
# Purpose:
#   The in-module tracer that logs every dpm_run_callback entry/exit during
#   a suspend cycle needs to be active when the REAL (unsupervised) sleep
#   happens — not just during a brief RTC-supervised freeze test — because
#   the USB wakeup source keeps aborting the freeze cycle before it reaches
#   the problematic noirq phase.
#
# Usage:
#   1. adb shell su -c "sh /data/adb/modules/f8_kpm_oc_manager/tools/suspend_trace_arm.sh"
#   2. Disconnect USB cable.
#   3. Turn the screen off.  Leave the device alone for several minutes.
#   4. If the device reboots silently, reconnect USB and run:
#        adb shell su -c "sh /data/adb/modules/f8_kpm_oc_manager/tools/suspend_trace_extract.sh"
#   5. If the device does NOT reboot, reconnect USB, wake it, and run
#      suspend_trace_disarm.sh to restore the normal sleep-guard wakelock.
#
# Safety: after arming, deep suspend IS allowed.  This deliberately removes
# the watchdog-prevention guard so we can trigger (and capture) the crash.

TAG="KPM_TRACE_ARM"
log_ln() { echo "[$TAG] $*"; log -t "$TAG" "$*"; }

if [ "$(id -u)" != 0 ]; then
    echo "[$TAG] ERROR: must run as root (su)"; exit 1
fi

if ! grep -q "^kpm_oc " /proc/modules 2>/dev/null; then
    log_ln "ERROR: kpm_oc not loaded"; exit 1
fi

if [ ! -w /sys/module/kpm_oc/parameters/suspend_trace_enabled ]; then
    log_ln "ERROR: kpm_oc build missing suspend_trace_enabled param"
    exit 1
fi

echo 1 > /sys/power/pm_print_times 2>/dev/null && \
    log_ln "pm_print_times = 1"
echo 1 > /sys/power/pm_debug_messages 2>/dev/null && \
    log_ln "pm_debug_messages = 1"

echo Y > /sys/module/kpm_oc/parameters/suspend_trace_enabled 2>/dev/null
log_ln "suspend_trace_enabled = $(cat /sys/module/kpm_oc/parameters/suspend_trace_enabled)"

# Release the sleep-reboot guard wakelock so the OS is allowed to enter
# real deep suspend.  This is the intentional risk window — if the bug
# reproduces, the device will watchdog-reboot.
if grep -q "^f8_sleep_reboot_guard" /sys/power/wake_lock 2>/dev/null; then
    echo f8_sleep_reboot_guard > /sys/power/wake_unlock 2>/dev/null
    log_ln "RELEASED f8_sleep_reboot_guard wakelock — DEEP SUSPEND NOW ALLOWED"
else
    log_ln "Guard wakelock was not active"
fi

log_ln "Tracer armed.  Procedure:"
log_ln "  1) disconnect the USB cable"
log_ln "  2) turn the screen off and wait several minutes"
log_ln "  3a) if device reboots, reconnect USB and run suspend_trace_extract.sh"
log_ln "  3b) if device survives, reconnect USB and run suspend_trace_disarm.sh"
