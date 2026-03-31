# Headwolf F8 OC Manager (APatch Module)

APatch/KernelSU module (service.sh v7.2) providing CPU and GPU overclocking for the Headwolf F8 tablet (MT8792 / Dimensity 8300).

## Features

- **CPU OPP Reader** — Displays per-cluster DVFS data (freq + volt) read from CSRAM via `kpm_oc.ko`
- **CPU Overclocking** — Patches CSRAM LUT[0] per cluster and updates the Linux cpufreq policy ceiling at runtime
- **CPU Per-LUT Voltage Override** — Direct CSRAM writes for any LUT entry, bypassing stock voltage constraints. Original values saved and restored on `clear`
- **MCUPM CSRAM Countermeasure** *(v7.2)* — kprobes on `mtk_cpufreq_hw_fast_switch` and `mtk_cpufreq_hw_target_index` resync OC voltages into CSRAM immediately before every CPU DVFS transition, preventing MCUPM firmware from reverting them between relift cycles
- **GPU Overclocking** — Patches the GPU default + working OPP tables in kernel memory; defaults to 1450 MHz on boot
- **GPU Per-OPP Voltage Override** — Direct memory writes for any GPU OPP entry, bypassing vendor `fix_custom_freq_volt` validation (DVFSState check, volt clamp). Original values saved and restored on `clear`
- **GPUEB OPP Countermeasure** *(v7.2)* — kprobe on `__gpufreq_generic_commit_gpu` re-patches GPU OPP voltages immediately before every GPU DVFS commit, preventing GPUEB firmware from reverting OC voltage to stock
- **GPU Module Reload** *(opt-in)* — Replaces `mtk_gpufreq_mt6897.ko` with a pre-patched binary that encodes the new top OPP, bypassing GPUEB re-initialization
- **GPU OPP Table** — Displays GPU OPP entries from `/proc/gpufreqv2`
- **WebUI** — Browser-based interface for CPU/GPU OC: add new OPP entries, adjust freq/volt per entry, set scaling limits, one-tap apply
- **Configuration Persistence** — OC params and scaling limits saved to `oc_config.json`; automatically restored on boot via `insmod` params and sysfs writes

## Structure

```text
├── module.prop                     # APatch module metadata
├── kpm_oc.ko                       # Compiled kernel module (v7.2)
├── mtk_gpufreq_mt6897_1450.ko      # Pre-patched GPU freq driver (optional, 1450 MHz top)
├── service.sh                      # Boot-time service (v7.0)
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
3. Load `kpm_oc.ko` with OC params (e.g. `insmod kpm_oc.ko cpu_oc_p_freq=3500000 gpu_target_freq=1500000 ...`)
   - CPU CSRAM auto-scan runs on init
   - GPU OC auto-applies on init
   - CPU OC auto-applies if any `cpu_oc_*_freq` param is nonzero
4. Restore CPU scaling limits (`scaling_min_freq` / `scaling_max_freq`) from config
5. Run one extra CPU/GPU relift pass from config to survive vendor-side runtime refreshes
6. Log CPU/GPU OC results
7. Export CPU OPP data from `opp_table` sysfs → `cpu_opp_table` file
8. Export GPU OPP data from `/proc/gpufreqv2/gpu_working_opp_table` → `gpu_opp_table` file
9. Detect GPU devfreq sysfs path (`/sys/class/devfreq/*mali*`)

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

### CPU Per-LUT Voltage Override (v7.0)

Directly patches any CSRAM LUT entry, bypassing stock voltage constraints. Original values are saved on first override and restored when `clear` is written.

| Parameter | Description |
|-----------|-------------|
| `cpu_volt_override` | Write `cl:idx:volt_uv ...` (cluster:lut_index:voltage_µV) |
| `cpu_volt_ov_result` | Result string (read-only) |

```bash
# Override B cluster LUT[5] to 900000 µV
echo '1:5:900000' > /sys/module/kpm_oc/parameters/cpu_volt_override
# cpu_volt_ov_result: B[5]=900000uV

# Clear all overrides (restores original CSRAM values)
echo clear > /sys/module/kpm_oc/parameters/cpu_volt_override
```

## GPU Overclocking

### Method A — Runtime memory patch (default, no reboot)

`kpm_oc.ko` patches `g_gpu_default_opp_table[0]` and the working table at runtime.
A lifetime GPU relift kthread re-runs all GPU patches every 500 ms,
so GPU power-cycle / runtime table refreshes do not silently drop OC back to stock.
The GPUEB kprobe countermeasure (v7.2) additionally re-patches OPP voltages
immediately before every GPU DVFS commit, eliminating the window where GPUEB
could revert the voltage between relift cycles.
Default target on boot: **1450 MHz @ 87500 (= 875.0 mV)**.

```bash
echo 1467000 > /sys/module/kpm_oc/parameters/gpu_target_freq
echo   91875 > /sys/module/kpm_oc/parameters/gpu_target_volt
echo   91875 > /sys/module/kpm_oc/parameters/gpu_target_vsram
echo 1 > /sys/module/kpm_oc/parameters/gpu_oc_apply
cat /sys/module/kpm_oc/parameters/gpu_oc_result
# OK:patched=3,freq=1450000->1467000,...
```

Notes:

- `patched=3` is the normal success state on this device: `default_opp[0]` + `working_table[0]` were patched. `signed_table` may be unavailable at runtime and is not required for the common success path. `patched=11` (`3 | 8`) means per-OPP voltage overrides are also active.
- Some apps (for example Franco Kernel Manager) may still display **1400 MHz** as GPU max because they read the stock devfreq `max_freq` node. The effective OC state should be checked via `/proc/gpufreqv2/gpu_working_opp_table` and `gpu_oc_result`.
- Writing `/sys/class/devfreq/13000000.mali/max_freq` is best-effort only on this target. It may remain stock even while the GPU working OPP table has been overclocked successfully.

### GPU Per-OPP Voltage Override (v7.0)

Directly patches any GPU OPP entry in both `g_gpu_default_opp_table` and the working table, bypassing the vendor `fix_custom_freq_volt` function which rejects writes when DVFSState validation fails (GPU powered off) or voltage is clamped.

| Parameter | Description |
|-----------|-------------|
| `gpu_volt_override` | Write `idx:volt[:vsram] ...` (10µV step units, same as gpufreqv2) |
| `gpu_volt_ov_result` | Result string (read-only) |

Overrides are persisted by the GPU relift kthread (500 ms interval) and survive GPU power-cycles.

```bash
# Override OPP[1] to 90000 (= 900.0 mV)
echo '1:90000:90000' > /sys/module/kpm_oc/parameters/gpu_volt_override

# Override multiple OPPs at once
echo '0:95000:95000 1:85000:85000 2:84000:84000' > /sys/module/kpm_oc/parameters/gpu_volt_override

# Clear all overrides (restores original default_opp_table values)
echo clear > /sys/module/kpm_oc/parameters/gpu_volt_override

# Verify
cat /proc/gpufreqv2/gpu_working_opp_table | head -5
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
| CPU per-LUT volt override | `echo 'cl:idx:volt_uv ...' > /sys/module/kpm_oc/parameters/cpu_volt_override` |
| GPU OC re-apply | `echo 1 > /sys/module/kpm_oc/parameters/gpu_oc_apply` |
| GPU per-OPP volt override | `echo 'idx:volt[:vsram] ...' > /sys/module/kpm_oc/parameters/gpu_volt_override` |
| CPU max freq | `echo <khz> > /sys/devices/system/cpu/cpufreq/policy{0,4,7}/scaling_max_freq` |
| CPU min freq | `echo <khz> > /sys/devices/system/cpu/cpufreq/policy{0,4,7}/scaling_min_freq` |
| GPU fixed OPP index | `echo <idx> > /proc/gpufreqv2/fix_target_opp_index` |

## Data Sources

| Data | Source |
|------|--------|
| CPU freq + volt | `kpm_oc.ko` → `opp_table` sysfs |
| CPU available freqs | `/sys/devices/system/cpu/cpufreq/policy{0,4,7}/scaling_available_frequencies` |
| GPU freq + volt + vsram | `/proc/gpufreqv2/gpu_working_opp_table` |
| GPU status | `/proc/gpufreqv2/gpufreq_status` |
| CPU volt override result | `kpm_oc.ko` → `cpu_volt_ov_result` sysfs |
| GPU volt override result | `kpm_oc.ko` → `gpu_volt_ov_result` sysfs |

For runtime verification, prefer the gpufreqv2 proc nodes over generic kernel-manager UI labels.

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
