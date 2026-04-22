#!/system/bin/sh
# suspend_trace_extract.sh - Extract KPMTRACE from the post-crash ramoops log
#
# Run this AFTER a watchdog-induced reboot caused by the tracer being armed.
# It reads console-ramoops-0 (the previous boot's log preserved in pstore),
# filters out everything except the KPMTRACE lines near the end, and prints
# a summary of which device's PM callback had the LAST "enter" line WITHOUT
# a matching "exit" line — that device is the hanging suspend path.

TAG="KPM_TRACE_EXTRACT"
# Use /data/local/tmp instead of /sdcard: under `su` the /sdcard FUSE mount
# is usually not visible (different mount namespace vs the adb shell user).
OUT="/data/local/tmp/kpm_trace_last_crash.txt"

if [ "$(id -u)" != 0 ]; then
    echo "[$TAG] ERROR: must run as root (su)"; exit 1
fi

if [ ! -r /sys/fs/pstore/console-ramoops-0 ]; then
    echo "[$TAG] No console-ramoops-0 — either no crash since boot, or pstore not mounted"
    ls /sys/fs/pstore/
    exit 1
fi

cp /sys/fs/pstore/console-ramoops-0 "$OUT"
chmod 644 "$OUT" 2>/dev/null
echo "[$TAG] Saved previous-boot ramoops to $OUT ($(wc -c < "$OUT") bytes)"

echo
echo "[$TAG] === ALL KPMPHASE lines (post-noirq pipeline; the crash tail) ==="
grep "KPMPHASE" "$OUT"
echo
echo "[$TAG] === Last 40 KPMNOIRQ lines (per-device noirq phase, filtered) ==="
grep "KPMNOIRQ" "$OUT" | tail -40
echo
echo "[$TAG] === Last 40 KPMTRACE lines (dpm_run_callback tracer) ==="
grep "KPMTRACE" "$OUT" | tail -40

echo
echo "[$TAG] === KPMPHASE: unmatched enters (PRIMARY post-noirq hang candidate) ==="
grep "KPMPHASE:" "$OUT" | awk '
  {
    # [  T.TTT ][ TXXXX] KPMPHASE: enter <fn>
    # $1 $2        $3     $4       $5    $6
    action = $5
    fn = $6
    if (action == "enter") {
      idx++
      fn_arr[idx] = fn
      pending[idx] = 1
      last = idx
    } else if (action == "exit") {
      for (k=last; k>=1; k--) {
        if (pending[k] == 1 && fn_arr[k] == fn) {
          pending[k] = 0
          break
        }
      }
    }
  }
  END {
    cnt = 0
    for (k=1; k<=last; k++) {
      if (pending[k] == 1) {
        printf "UNMATCHED #%d fn=%s\n", k, fn_arr[k]
        cnt++
      }
    }
    printf "Total unmatched KPMPHASE enters: %d (of %d entries)\n", cnt, last
  }
'

echo
echo "[$TAG] === KPMNOIRQ: unmatched enters (secondary noirq-phase candidate) ==="
grep "KPMNOIRQ:" "$OUT" | awk '
  {
    # Field layout after timestamps:
    # [   T.TTT ][ TXXXX] KPMNOIRQ: enter dev=<name> drv=<drv>
    # $1 $2        $3      $4        $5    $6        $7
    action = $5
    dev = $6
    drv = $7
    sub(/^dev=/, "", dev)
    sub(/^drv=/, "", drv)
    if (action == "enter") {
      idx++
      dev_arr[idx] = dev
      drv_arr[idx] = drv
      pending[idx] = 1
      last = idx
    } else if (action == "exit") {
      for (k=last; k>=1; k--) {
        if (pending[k] == 1 && dev_arr[k] == dev) {
          pending[k] = 0
          break
        }
      }
    }
  }
  END {
    cnt = 0
    for (k=1; k<=last; k++) {
      if (pending[k] == 1) {
        printf "UNMATCHED #%d dev=%s drv=%s\n", k, dev_arr[k], drv_arr[k]
        cnt++
      }
    }
    printf "Total unmatched KPMNOIRQ enters: %d (of %d entries)\n", cnt, last
  }
'

echo
echo "[$TAG] === KPMTRACE: unmatched enters (dpm_run_callback tracer) ==="
# Android's toybox awk does NOT support match(..., array).  Use sed to extract
# the dev= field, then a LIFO pairing walk in pure shell/awk.  Lines that
# begin with "KPMTRACE: enter dev=<name>" are pushed onto a list; each
# "KPMTRACE: exit dev=<name>" pops the most recent matching entry.  Anything
# left over at the end is unmatched.
grep "KPMTRACE:" "$OUT" | awk '
  {
    # [  T.TTT ][ TXXXX] KPMTRACE: enter dev=<name> info=<info> cb=<cb>
    # $1 $2        $3     $4       $5   $6          $7           $8
    action = $5
    dev = $6
    rest = ""
    for (i=7; i<=NF; i++) rest = rest " " $i
    sub(/^dev=/, "", dev)
    if (action == "enter") {
      idx++
      dev_arr[idx] = dev
      rest_arr[idx] = rest
      pending[idx] = 1
      last_enter = idx
    } else if (action == "exit") {
      # find the most recent unmatched entry with same device name
      for (k=last_enter; k>=1; k--) {
        if (pending[k] == 1 && dev_arr[k] == dev) {
          pending[k] = 0
          break
        }
      }
    }
  }
  END {
    cnt = 0
    for (k=1; k<=last_enter; k++) {
      if (pending[k] == 1) {
        printf "UNMATCHED (#%d) dev=%s%s\n", k, dev_arr[k], rest_arr[k]
        cnt++
      }
    }
    printf "Total unmatched enters: %d (of %d entries)\n", cnt, last_enter
  }
'

echo
echo "[$TAG] === Final 30 lines of ramoops (crash tail) ==="
tail -30 "$OUT"

echo
echo "[$TAG] === Context around final trace lines: ==="
grep -E "KPMNOIRQ|KPMTRACE|scp_suspend|dpmaif_suspend|drv3_suspend|uarthub|tfa_time_sync|atf_time_sync|noirq|Unable to handle|Watchdog|WDT" "$OUT" | tail -60

echo
echo "[$TAG] Full ramoops saved at $OUT — pull with:"
echo "  adb pull $OUT"
