# Headwolf F8 OC Manager (APatch Module)

APatch/KernelSU module (v3.2) providing a WebUI for CPU/GPU overclock management on the Headwolf F8 tablet (Dimensity 8300).

## Features

- **CPU OPP Table** — Displays per-cluster frequency/voltage data read from CSRAM via the kernel module (`kpm_oc.ko`)
- **GPU OPP Table** — Displays GPU OPP entries (freq + volt + VSRAM) from `/proc/gpufreqv2`
- **Frequency Limits** — Per-cluster min/max frequency control via `scaling_max_freq` / `scaling_min_freq`
- **GPU Voltage Control** — Apply custom freq/volt pairs via `fix_custom_freq_volt`
- **Table Editing** — Add, modify, or remove OPP entries with instant visual feedback
- **Configuration Persistence** — Settings saved as JSON to `/data/adb/modules/f8_kpm_oc_manager/oc_config.json`

## Structure

```
├── module.prop          # APatch module metadata (v3.2)
├── kpm_oc.ko            # Compiled kernel module (CSRAM LUT reader)
├── service.sh           # Boot-time service: loads kpm_oc.ko, exports OPP data
└── webroot/
    ├── index.html       # WebUI shell (CPU/GPU tabs)
    ├── app.js           # Application logic (KernelSU ksu.exec API)
    └── style.css        # Dark glassmorphism design system
```

## Data Flow

### Boot (`service.sh`)
1. Loads `kpm_oc.ko` via `insmod` (auto-scans CSRAM)
2. Reads CPU OPP from `/sys/module/kpm_oc/parameters/opp_table` → saves to `cpu_opp_table`
3. Reads raw debug data from `/sys/module/kpm_oc/parameters/raw` → saves to `cpu_raw_dump`
4. Parses GPU OPP from `/proc/gpufreqv2/gpu_working_opp_table` → saves to `gpu_opp_table`
5. Detects GPU devfreq path (`/sys/class/devfreq/*mali*`)

### WebUI (`app.js`)
Uses the KernelSU/APatch `ksu.exec()` JavaScript bridge (callback-name API) to:
1. Read CPU OPP from sysfs parameter or cached file
2. Read GPU OPP from `/proc/gpufreqv2` or cached file
3. Read available frequencies and current limits per policy
4. Apply frequency limits and GPU custom voltage via shell commands

## Data Sources

| Data | Source | Format |
|------|--------|--------|
| CPU freq + volt (CSRAM LUT) | `kpm_oc.ko` sysfs → `opp_table` | `CPU:policy:freq_khz:volt_uv` |
| CPU raw debug | `kpm_oc.ko` sysfs → `raw` | Hex dump: `lut_val/em_val` per entry |
| CPU available frequencies | `/sys/devices/system/cpu/cpufreq/policy{0,4,7}/` | Space-separated KHz |
| GPU freq + volt + VSRAM | `/proc/gpufreqv2/gpu_working_opp_table` | `[idx] freq: N, volt: N, vsram: N` |

## Control Interfaces

| Action | Interface |
|--------|-----------|
| CPU max freq | `echo <khz> > /sys/devices/system/cpu/cpufreq/policy{N}/scaling_max_freq` |
| CPU min freq | `echo <khz> > /sys/devices/system/cpu/cpufreq/policy{N}/scaling_min_freq` |
| GPU custom volt | `echo "<freq> <volt_step>" > /proc/gpufreqv2/fix_custom_freq_volt` |
| CSRAM rescan | `echo 1 > /sys/module/kpm_oc/parameters/apply` |

## Installation

1. Build `kpm_oc.ko` from [Headwolf_F8_KPM_OC_Kernel](https://github.com/zerofrip/Headwolf_F8_KPM_OC_Kernel)
2. Place `kpm_oc.ko` in this module's root directory
3. ZIP the module directory and flash via APatch / KernelSU manager

## Requirements

- Headwolf F8 tablet (MT8792 / Dimensity 8300)
- Android 14, kernel 6.1 GKI
- APatch or KernelSU with WebUI support

## License

GPL-2.0
