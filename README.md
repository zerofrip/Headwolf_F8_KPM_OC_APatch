# Headwolf F8 OC Manager (APatch Module)

APatch/KernelSU module providing a WebUI for CPU/GPU overclock management on the Headwolf F8 tablet (Dimensity 8300).

## Features

- **CPU OPP Table** — Displays per-cluster frequency/voltage data read from CSRAM via the kernel module
- **GPU OPP Table** — Displays all 65 GPU OPP entries (freq + volt + VSRAM) from `/proc/gpufreqv2`
- **Frequency Limits** — Per-cluster min/max frequency control via `scaling_max_freq` / `scaling_min_freq`
- **GPU Voltage Control** — Apply custom freq/volt pairs via `fix_custom_freq_volt`
- **Table Editing** — Add, modify, or remove OPP entries with instant visual feedback
- **Boot Persistence** — Settings saved as JSON and restored on boot

## Structure

```
├── module.prop          # APatch module metadata
├── service.sh           # Boot-time service: loads kpm_oc.ko, exports OPP data
└── webroot/
    ├── index.html       # WebUI shell (CPU/GPU tabs)
    ├── app.js           # Application logic (data loading, rendering, controls)
    └── style.css        # Dark glassmorphism design system
```

## Data Sources

| Data | Source | Format |
|------|--------|--------|
| CPU freq + volt (CSRAM LUT) | `kpm_oc.ko` sysfs → `opp_table` | `CPU:policy:freq_khz:volt_uv` |
| CPU available frequencies | `/sys/devices/system/cpu/cpufreq/policy{0,4,7}/` | Space-separated KHz |
| GPU freq + volt + VSRAM | `/proc/gpufreqv2/gpu_working_opp_table` | `[idx] freq: N, volt: N, vsram: N` |

## Control Interfaces

| Action | Interface |
|--------|-----------|
| CPU freq limit | `echo <khz> > /sys/devices/system/cpu/cpufreq/policy{N}/scaling_max_freq` |
| GPU custom volt | `echo "<freq> <volt_step>" > /proc/gpufreqv2/fix_custom_freq_volt` |

## Installation

1. Build `kpm_oc.ko` from [Headwolf_F8_KPM_OC_Kernel](https://github.com/zerofrip/Headwolf_F8_KPM_OC_Kernel)
2. Place `kpm_oc.ko` in this module's root directory
3. Flash the module via APatch / KernelSU manager

## Requirements

- Headwolf F8 tablet (MT8792 / Dimensity 8300)
- Android 14, kernel 6.1 GKI
- APatch or KernelSU with WebUI support

## License

GPL-2.0
