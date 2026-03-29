# Headwolf F8 OC Manager (APatch Module)

APatch/KernelSU module (service.sh v4.0) providing CPU and GPU overclocking for the Headwolf F8 tablet (MT8792 / Dimensity 8300).

## Features

- **CPU OPP Reader** — Displays per-cluster DVFS data (freq + volt) read from CSRAM via `kpm_oc.ko`
- **CPU Overclocking** — Patches CSRAM LUT[0] per cluster and updates the Linux cpufreq policy ceiling at runtime
- **GPU Overclocking** — Patches the GPU default + working OPP tables in kernel memory; defaults to 1450 MHz on boot
- **GPU Module Reload** *(opt-in)* — Replaces `mtk_gpufreq_mt6897.ko` with a pre-patched binary that encodes the new top OPP, bypassing GPUEB re-initialization
- **GPU OPP Table** — Displays GPU OPP entries from `/proc/gpufreqv2`
- **WebUI** — Browser-based interface for CPU/GPU OC: add new OPP entries, adjust freq/volt, set scaling limits, one-tap apply
- **Configuration Persistence** — OC params and scaling limits saved to `oc_config.json`; automatically restored on boot via `insmod` params and sysfs writes

## Structure

```
├── module.prop                     # APatch module metadata
├── kpm_oc.ko                       # Compiled kernel module (v6.5)
├── mtk_gpufreq_mt6897_1450.ko      # Pre-patched GPU freq driver (optional, 1450 MHz top)
├── service.sh                      # Boot-time service (v4.0)
├── tools/
│   ├── patch_mtk_gpufreq_1450.py   # Binary patcher: set custom top GPU OPP in .ko
│   └── auto_tune_top_opp.sh        # Helper: auto-selects top OPP for reload
└── webroot/
    ├── index.html                  # WebUI shell (CPU/GPU tabs)
    ├── app.js                      # Application logic (APatch ksu.exec API, OC via kpm_oc sysfs)
    └── style.css                    # Dark glassmorphism design system
```

## Boot Flow (`service.sh`)

1. **(opt-in)** Reload `mtk_gpufreq_mt6897.ko` with the patched binary (`enable_gpufreq_reload` flag file)
   - Unloads `mtk_gpu_hal` → `mtk_gpu_power_throttling` → `mtk_gpufreq_wrapper` → `mtk_gpufreq_mt6897`
   - Loads patched core, then vendor companions
   - Verifies `gpu_working_opp_table[0] ≥ 1450000 KHz`; rolls back if not
2. Parse `oc_config.json` for saved OC params (CPU + GPU) and build `insmod` parameter string
3. Load `kpm_oc.ko` with OC params (e.g. `insmod kpm_oc.ko cpu_oc_p_freq=3600000 gpu_target_freq=1500000 ...`)
   - CPU CSRAM auto-scan runs on init
   - GPU OC auto-applies on init
   - CPU OC auto-applies if any `cpu_oc_*_freq` param is nonzero
4. Restore CPU scaling limits (`scaling_min_freq` / `scaling_max_freq`) from config
5. Log CPU/GPU OC results
6. Export CPU OPP data from `opp_table` sysfs → `cpu_opp_table` file
7. Export GPU OPP data from `/proc/gpufreqv2/gpu_working_opp_table` → `gpu_opp_table` file
8. Detect GPU devfreq sysfs path (`/sys/class/devfreq/*mali*`)

### Config Persistence

The WebUI saves OC settings to `/data/adb/modules/f8_kpm_oc_manager/oc_config.json` as a flat JSON:

```json
{
  "version": 4,
  "cpu_oc_l_freq": 2400000, "cpu_oc_l_volt": 875000,
  "cpu_oc_b_freq": 0,       "cpu_oc_b_volt": 0,
  "cpu_oc_p_freq": 3600000, "cpu_oc_p_volt": 1100000,
  "gpu_oc_freq": 1500000,   "gpu_oc_volt": 91875, "gpu_oc_vsram": 91875,
  "cpu_max_0": 2400000, "cpu_min_0": 480000,
  "cpu_max_4": 3300000, "cpu_min_4": 400000,
  "cpu_max_7": 3600000, "cpu_min_7": 400000
}
```

`service.sh` parses this with lightweight `grep` (no `jq` needed) and passes values as `insmod` params.

## CPU Overclocking

The `kpm_oc.ko` module exposes per-cluster OC params under `/sys/module/kpm_oc/parameters/`:

| Parameter | Description |
|-----------|-------------|
| `cpu_oc_l_freq` | L cluster (policy0) target KHz (`0` = skip) |
| `cpu_oc_l_volt` | L cluster target µV (`0` = keep original) |
| `cpu_oc_b_freq` | B cluster (policy4) target KHz |
| `cpu_oc_b_volt` | B cluster target µV |
| `cpu_oc_p_freq` | P cluster (policy7) target KHz |
| `cpu_oc_p_volt` | P cluster target µV |
| `cpu_oc_apply` | Write `1` to apply |
| `cpu_oc_result` | Result string (read-only) |

Applying writes to CSRAM LUT[0] and updates `cpuinfo_max_freq` / `policy->max` so the scheduler and governor can target the new ceiling.

```bash
echo 3600000 > /sys/module/kpm_oc/parameters/cpu_oc_p_freq
echo 1100000 > /sys/module/kpm_oc/parameters/cpu_oc_p_volt
echo 1 > /sys/module/kpm_oc/parameters/cpu_oc_apply
# cpu_oc_result: P:3350000->3600000KHz@1100000uV
```

## GPU Overclocking

### Method A — Runtime memory patch (default, no reboot)

`kpm_oc.ko` patches `g_gpu_default_opp_table[0]` and the working table at runtime.
Default target on boot: **1450 MHz @ 87500 µV**.

```bash
echo 1467000 > /sys/module/kpm_oc/parameters/gpu_target_freq
echo  91875 > /sys/module/kpm_oc/parameters/gpu_target_volt
echo  91875 > /sys/module/kpm_oc/parameters/gpu_target_vsram
echo 1 > /sys/module/kpm_oc/parameters/gpu_oc_apply
cat /sys/module/kpm_oc/parameters/gpu_oc_result
# OK:patched=3,freq=1450000->1467000,...
```

### Method B — Binary-patched `.ko` reload (opt-in, persistent across GPUEB re-init)

1. Generate a patched GPU driver with `tools/patch_mtk_gpufreq_1450.py`:
   ```bash
   python3 tools/patch_mtk_gpufreq_1450.py \
       /vendor/lib/modules/mtk_gpufreq_mt6897.ko \
       mtk_gpufreq_mt6897_1450.ko \
       --new-top-freq 1450000
   ```
2. Place the output as `mtk_gpufreq_mt6897_1450.ko` in the module root
3. Create the flag file: `touch /data/adb/modules/f8_kpm_oc_manager/enable_gpufreq_reload`
4. Reboot — `service.sh` will replace the vendor driver on next boot

The generated file `mtk_gpufreq_mt6897_1450.ko` (1450 MHz) is included in this repository.

## Control Interfaces

| Action | Interface |
|--------|-----------|
| CPU CSRAM rescan | `echo 1 > /sys/module/kpm_oc/parameters/apply` |
| CPU OC apply | `echo 1 > /sys/module/kpm_oc/parameters/cpu_oc_apply` |
| GPU OC re-apply | `echo 1 > /sys/module/kpm_oc/parameters/gpu_oc_apply` |
| CPU max freq | `echo <khz> > /sys/devices/system/cpu/cpufreq/policy{0,4,7}/scaling_max_freq` |
| CPU min freq | `echo <khz> > /sys/devices/system/cpu/cpufreq/policy{0,4,7}/scaling_min_freq` |
| GPU custom volt | `echo "<freq> <volt_step>" > /proc/gpufreqv2/fix_custom_freq_volt` |
| GPU fixed OPP index | `echo <idx> > /proc/gpufreqv2/fix_target_opp_index` |

## Data Sources

| Data | Source |
|------|--------|
| CPU freq + volt | `kpm_oc.ko` → `opp_table` sysfs |
| CPU available freqs | `/sys/devices/system/cpu/cpufreq/policy{0,4,7}/scaling_available_frequencies` |
| GPU freq + volt + vsram | `/proc/gpufreqv2/gpu_working_opp_table` |
| GPU status | `/proc/gpufreqv2/gpufreq_status` |

## Installation

1. Build `kpm_oc.ko` from [Headwolf_F8_KPM_OC_Kernel](https://github.com/zerofrip/Headwolf_F8_KPM_OC_Kernel)
2. Place `kpm_oc.ko` in the module root directory
3. (Optional) Generate and place `mtk_gpufreq_mt6897_1450.ko` with `tools/patch_mtk_gpufreq_1450.py`
4. ZIP the module directory and flash via APatch / KernelSU manager

## Requirements

- Headwolf F8 tablet (MT8792 / Dimensity 8300)
- Android 14, kernel 6.1 GKI
- APatch or KernelSU with WebUI support

## License

GPL-2.0
