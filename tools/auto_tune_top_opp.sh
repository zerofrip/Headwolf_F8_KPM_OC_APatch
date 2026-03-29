#!/system/bin/sh
# Auto tune top OPP for CPU/GPU and apply best stable setting.
# Run in a context that can write /sys and /proc/gpufreqv2 (APatch WebUI or module service context).

set -eu

LOG_TAG="KPM_OC_TUNE"
OUT_DIR="/data/adb/modules/f8_kpm_oc_manager"
OUT_FILE="${OUT_DIR}/tune_result.txt"
mkdir -p "${OUT_DIR}" 2>/dev/null || true

logi() {
  echo "$1"
  log -t "${LOG_TAG}" "$1" 2>/dev/null || true
}

must_write() {
  value="$1"
  path="$2"
  if ! echo "$value" > "$path" 2>/dev/null; then
    logi "WRITE_FAIL ${path} <= ${value}"
    return 1
  fi
  return 0
}

bench_once() {
  # 8-way parallel CPU hash workload. Lower elapsed ms is better.
  start=$(date +%s%N)
  i=0
  while [ "$i" -lt 8 ]; do
    (
      toybox dd if=/dev/zero bs=1M count=256 2>/dev/null | sha1sum >/dev/null
    ) &
    i=$((i + 1))
  done
  wait
  end=$(date +%s%N)
  echo $(((end - start) / 1000000))
}

# 1) Pin CPU clusters to max frequency for max-performance run.
for p in 0 4 7; do
  maxf=$(cat "/sys/devices/system/cpu/cpufreq/policy${p}/scaling_available_frequencies" 2>/dev/null | awk '{print $1}')
  if [ -n "${maxf}" ]; then
    must_write "${maxf}" "/sys/devices/system/cpu/cpufreq/policy${p}/scaling_max_freq" || true
    must_write "${maxf}" "/sys/devices/system/cpu/cpufreq/policy${p}/scaling_min_freq" || true
  fi
done

# 2) Read current top GPU OPP.
line=$(cat /proc/gpufreqv2/gpu_working_opp_table 2>/dev/null | head -1)
if [ -z "${line}" ]; then
  logi "GPU_TABLE_READ_FAIL"
  exit 1
fi

gpu_freq=$(echo "${line}" | sed -n 's/.*freq: *\([0-9]*\).*/\1/p')
gpu_volt=$(echo "${line}" | sed -n 's/.*volt: *\([0-9]*\).*/\1/p')

if [ -z "${gpu_freq}" ] || [ -z "${gpu_volt}" ]; then
  logi "GPU_TOP_PARSE_FAIL line=${line}"
  exit 1
fi

# 3) Try voltage candidates around the top OPP voltage.
# gpufreq step unit: 10uV.
v0=${gpu_volt}
v1=$((gpu_volt + 625))
v2=$((gpu_volt + 1250))
v3=$((gpu_volt + 1875))

best_v="${v0}"
best_ms=0

for v in "${v0}" "${v1}" "${v2}" "${v3}"; do
  # Fix top OPP index if interface is available.
  if [ -e /proc/gpufreqv2/fix_target_opp_index ]; then
    must_write "0" /proc/gpufreqv2/fix_target_opp_index || true
  fi

  # Set custom top freq/volt pair.
  if ! must_write "${gpu_freq} ${v}" /proc/gpufreqv2/fix_custom_freq_volt; then
    logi "GPU_VOLT_SET_FAIL v=${v}"
    continue
  fi

  # Warmup + measurement
  bench_once >/dev/null
  ms=$(bench_once)

  logi "CANDIDATE freq=${gpu_freq} volt_step=${v} elapsed_ms=${ms}"

  if [ "${best_ms}" -eq 0 ] || [ "${ms}" -lt "${best_ms}" ]; then
    best_ms="${ms}"
    best_v="${v}"
  fi
done

# 4) Apply best result.
if [ -e /proc/gpufreqv2/fix_target_opp_index ]; then
  must_write "0" /proc/gpufreqv2/fix_target_opp_index || true
fi
must_write "${gpu_freq} ${best_v}" /proc/gpufreqv2/fix_custom_freq_volt || true

{
  echo "gpu_top_freq_khz=${gpu_freq}"
  echo "gpu_top_volt_step=${best_v}"
  echo "gpu_top_volt_uv=$((best_v * 10))"
  echo "best_elapsed_ms=${best_ms}"
  date -Iseconds | sed 's/^/applied_at=/'
} > "${OUT_FILE}"

logi "BEST freq=${gpu_freq} volt_step=${best_v} elapsed_ms=${best_ms}"
logi "RESULT_FILE=${OUT_FILE}"
