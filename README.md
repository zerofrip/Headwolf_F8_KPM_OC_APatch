# Headwolf F8 OC Manager (APatch Module)

APatch/KernelSU module (v8.0) providing CPU, GPU, DRAM, Storage overclocking/tuning, thermal mitigation, power profiles, and auto gaming mode for the Headwolf F8 tablet (MT8792 / Dimensity 8300).

## Features

- **CPU OPP Reader** — Displays per-cluster DVFS data (freq + volt) read from CSRAM via `kpm_oc.ko`. Live sysfs read — always reflects current CSRAM state without requiring a rescan
- **CPU Overclocking** — Patches CSRAM LUT[0] per cluster and updates the Linux cpufreq policy ceiling at runtime
- **CPU Per-LUT Voltage Override** — Direct CSRAM writes for any LUT entry, bypassing stock voltage constraints. Original values saved and restored on `clear`
- **MCUPM CSRAM Countermeasure** *(v7.2)* — kprobes on `scmi_cpufreq_fast_switch` and `scmi_cpufreq_set_target` resync OC voltages into CSRAM immediately before every CPU DVFS transition, preventing MCUPM firmware from reverting them between relift cycles
- **GPU Overclocking** — Patches the GPU default + working OPP tables in kernel memory; module parameter default is 1900 MHz @ 1150.4 mV (overridden by `oc_config.json` on boot)
- **GPU Per-OPP Voltage Override** — Direct memory writes for any GPU OPP entry, bypassing vendor `fix_custom_freq_volt` validation (DVFSState check, volt clamp). Original values saved and restored on `clear`
- **GPUEB OPP Countermeasure** *(v7.2)* — kprobe on `__gpufreq_generic_commit_gpu` re-patches GPU OPP voltages immediately before every GPU DVFS commit, preventing GPUEB firmware from reverting OC voltage to stock
- **GPU PLL Direct Programming** *(v8.0)* — kretprobe on `gpufreq_commit` reprograms MFG PLL CON1 after GPUEB commits above-stock OC frequency
- **GPU OPP Table** — Displays GPU OPP entries from `/proc/gpufreqv2`
- **DRAM Frequency Floor** *(v7.3)* — Controls DRAM minimum frequency via DVFSRC devfreq, locking LPDDR5X at higher OPPs for sustained memory bandwidth. Vcore automatically scales with frequency
- **Storage / UFS Tuning** *(v7.5)* — Per-device block queue tuning (I/O scheduler, read-ahead, rq_affinity, nomerges, iostats, entropy feed) and UFS controller settings (Write Booster, clock gating)
- **Thermal Mitigation** *(v7.6)* — Per-component thermal controls: CPU trip point raising (Soft +15°C / Hard +30°C + cdev lock), GPU cooling device lock (Soft) and OPP pinning via `fix_target_opp_index` (Hard)
- **Power Profiles** *(v8.0)* — Three selectable power modes (Battery Save / Normal / Performance) that control CPU scaling limits, DRAM floor, and thermal mitigation as a single preset
- **Auto Gaming Mode** *(v8.0)* — Foreground app detection with automatic Performance OC boost for user-selected apps. Includes app selector with icon display, background monitoring daemon, and auto-revert when the gaming app exits. Works independently across all power modes
- **Multi-Language WebUI** *(v8.0)* — Browser-based interface with 5 tabs (CPU / GPU / RAM / Storage / Profile), i18n support (English / 日本語), language switcher in header: add new OPP entries, adjust freq/volt per entry, set scaling limits, DRAM freq floor selector, I/O tuning, thermal controls, power mode switching, gaming app selector with icons, one-tap apply
- **Configuration Persistence** — OC params, scaling limits, DRAM min freq, I/O/UFS settings, thermal modes, power profile, and gaming app list saved to `oc_config.json`; automatically restored on boot via `insmod` params and sysfs writes

## Structure

```text
├── module.prop                     # APatch module metadata
├── kpm_oc.ko                       # Compiled kernel module (v8.0)
├── service.sh                      # Boot-time service (v8.0)
├── oc_config.default.json          # Default config (seeded on first install)
└── webroot/
    ├── index.html                  # WebUI shell (CPU/GPU/RAM/Storage/Profile tabs)
    ├── i18n.js                     # Internationalization module (EN / JA)
    ├── app.js                      # Application logic (APatch ksu.exec API, OC via kpm_oc sysfs + devfreq + block I/O + thermal + gaming)
    └── style.css                   # Dark glassmorphism design system
```

## Boot Flow (`service.sh`)

1. Parse `oc_config.json` for saved OC params (CPU + GPU + DRAM + I/O + UFS + thermal + gaming) and build `insmod` parameter string
2. Load `kpm_oc.ko` with OC params (e.g. `insmod kpm_oc.ko cpu_oc_p_freq=4000000 gpu_target_freq=1900000 ...`)
   - CPU CSRAM auto-scan runs on init
   - GPU OC auto-applies on init
   - CPU OC auto-applies if any `cpu_oc_*_freq` param is nonzero
3. Restore CPU scaling limits (`scaling_min_freq` / `scaling_max_freq`) from config
4. Run one extra CPU/GPU relift pass from config to survive vendor-side runtime refreshes
5. Log CPU/GPU OC results
6. Restore DRAM min freq floor via DVFSRC devfreq (`/sys/class/devfreq/mtk-dvfsrc-devfreq/min_freq`)
7. Export CPU OPP data from `opp_table` sysfs → `cpu_opp_table` file
8. Export GPU OPP data from `/proc/gpufreqv2/gpu_working_opp_table` → `gpu_opp_table` file
9. Detect GPU devfreq sysfs path (`/sys/class/devfreq/*mali*`)
10. Write `gaming_monitor.sh` daemon script to `CONFIG_DIR`
11. Launch background late-boot relift at T+45 s:
    - Re-applies CPU/GPU OC, restores `scaling_max_freq`, re-sets DRAM min freq floor
    - Applies thermal mitigation (CPU trip point raising + GPU cooling device lock) per saved mode
    - Applies I/O block queue tuning (scheduler, read-ahead, rq_affinity, nomerges, iostats, add_random) to all UFS block devices
    - Restores UFS controller settings (Write Booster)
    - Starts `gaming_monitor.sh` daemon if `auto_gaming=1` and gaming apps are configured

### Config Persistence

The WebUI saves OC settings to `/data/adb/modules/f8_kpm_oc_manager/oc_config.json` as a flat JSON.
On first install the bundled `oc_config.default.json` is seeded as the initial config;
subsequent module updates preserve the user's customized values.

```json
{
  "version": 9,
  "cpu_oc_l_freq": 3800000, "cpu_oc_l_volt": 1050000,
  "cpu_oc_b_freq": 3800000, "cpu_oc_b_volt": 1100000,
  "cpu_oc_p_freq": 4000000, "cpu_oc_p_volt": 1150000,
  "gpu_oc_freq": 1900000,   "gpu_oc_volt": 115040, "gpu_oc_vsram": 95000,
  "cpu_max_0": 3800000, "cpu_min_0": 480000,
  "cpu_max_4": 3800000, "cpu_min_4": 400000,
  "cpu_max_7": 4000000, "cpu_min_7": 400000,
  "dram_min_freq": 6400000000,
  "io_read_ahead_kb": 2048, "io_scheduler": "none",
  "io_nomerges": 0, "io_rq_affinity": 2,
  "io_iostats": 1, "io_add_random": 0,
  "ufs_wb_on": 1,
  "cpu_thermal_mode": 0, "gpu_thermal_mode": 0,
  "power_mode": 1,
  "auto_gaming": 0, "gaming_apps": ""
}
```

`service.sh` parses this with lightweight `grep` (no `jq` needed) and passes values as `insmod` params.

## Multi-Language Support (i18n)

The WebUI supports multiple languages via a lightweight i18n module (`i18n.js`):

| Language | Code | Flag |
|----------|------|------|
| English | `en` | 🇺🇸 |
| 日本語 | `ja` | 🇯🇵 |

- Language is auto-detected from `navigator.language` on first visit
- User selection is persisted in `localStorage` (`kpm_oc_lang` key)
- Language switcher (flag buttons) is displayed in the header
- All UI strings (labels, tooltips, toast messages, validation errors) are translated
- Static HTML strings use `data-i18n` attributes; dynamic strings use `I18n.t(key, params)` with `{placeholder}` interpolation

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

Applying writes to CSRAM LUT[0] and updates `cpuinfo_max_freq` / `policy->max` so the scheduler and governor can target the new ceiling. The freq_table update always targets index 0 (highest OPP in descending LUT), ensuring correct re-OC after underclock.

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

### Runtime memory patch (default, no reboot)

`kpm_oc.ko` patches `g_gpu_default_opp_table[0]` and the working table at runtime.
A lifetime GPU relift kthread re-runs all GPU patches every 500 ms,
so GPU power-cycle / runtime table refreshes do not silently drop OC back to stock.
The GPUEB kprobe countermeasure (v7.2) additionally re-patches OPP voltages
immediately before every GPU DVFS commit, eliminating the window where GPUEB
could revert the voltage between relift cycles.
The kretprobe on `gpufreq_commit` (v8.0) additionally reprograms MFG PLL CON1
when GPUEB commits an above-stock OC frequency.
Default target on boot: **1900 MHz @ 115040 (= 1150.4 mV)** (bare module parameter default; `oc_config.json` overrides this on boot).

```bash
echo 1900000 > /sys/module/kpm_oc/parameters/gpu_target_freq
echo  115040 > /sys/module/kpm_oc/parameters/gpu_target_volt
echo   95000 > /sys/module/kpm_oc/parameters/gpu_target_vsram
echo 1 > /sys/module/kpm_oc/parameters/gpu_oc_apply
cat /sys/module/kpm_oc/parameters/gpu_oc_result
# OK:patched=3,freq=1400000->1900000,...
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

## DRAM Overclocking

DRAM frequency is controlled via the standard Linux devfreq interface exposed by `mtk-dvfsrc-devfreq`. No kernel module changes are required — sysfs writes are sufficient.

- **DRAM type**: LPDDR5X (Micron, 4 channels)
- **Devfreq path**: `/sys/class/devfreq/mtk-dvfsrc-devfreq/`
- **Governor**: `userspace` (supports `set_freq`, `min_freq`, `max_freq`)
- **Vcore**: Auto-managed by DVFSRC regulator; scales automatically with DRAM OPP level (read-only via `/sys/class/regulator/regulator.74/microvolts`)

### Available DRAM OPPs

| Data Rate (MHz) | devfreq freq (Hz) |
|------------------|--------------------|
| 800              | 800000000          |
| 1600             | 1600000000         |
| 1866             | 1866000000         |
| 2133             | 2133000000         |
| 3094             | 3094000000         |
| 4100             | 4100000000         |
| 5500             | 5500000000         |
| 6400             | 6400000000         |

### Usage

```sh
# Set min frequency floor to 6400 MHz (lock DRAM at max OPP)
echo 6400000000 | tee /sys/class/devfreq/mtk-dvfsrc-devfreq/min_freq

# Read current frequency
cat /sys/class/devfreq/mtk-dvfsrc-devfreq/cur_freq

# Verify actual data rate
cat /sys/bus/platform/drivers/dramc_drv/dram_data_rate

# Read current Vcore voltage (µV)
cat /sys/class/regulator/regulator.74/microvolts

# Reset to default (allow DVFSRC to scale freely)
echo 800000000 | tee /sys/class/devfreq/mtk-dvfsrc-devfreq/min_freq
```

> **Note**: Shell redirect (`>`) does not work under APatch su context for devfreq sysfs; use `tee` instead.

## Thermal Mitigation

The WebUI's Thermal section (in CPU/GPU cards) provides per-component thermal controls to prevent performance throttling under sustained load.

### CPU Thermal Modes

| Mode | Description |
|------|-------------|
| Off (0) | Stock thermal behavior |
| Soft (1) | Raise all CPU-related thermal zone trip points by +15°C |
| Hard (2) | Raise trip points by +30°C + lock cpufreq cooling devices to state 0 |

### GPU Thermal Modes

| Mode | Description |
|------|-------------|
| Off (0) | Stock thermal behavior |
| Soft (1) | Lock GPU/Mali/GED cooling devices to state 0 (prevent frequency capping) |
| Hard (2) | Soft + pin GPU at OPP index 0 via `fix_target_opp_index` |

Settings are persisted in `oc_config.json` (`cpu_thermal_mode`, `gpu_thermal_mode`) and restored on boot via the late-boot relift pass.

## Power Profiles

Three selectable power modes that apply preset CPU scaling limits, DRAM floor, and thermal settings as a single tap.

| Mode | CPU Max (L/B/P) | DRAM Floor | Thermal |
|------|------------------|------------|---------|
| 🔋 Battery Save | 1600 / 2000 / 2000 MHz | 800 MHz | Off |
| ⚡ Normal | As configured | As configured | Off |
| 🚀 Performance | 3800 / 3800 / 4000 MHz | 6400 MHz | Soft |

- **Battery Save** reduces clock ceilings for maximum battery life. After `Apply Changes`, scaling limits are re-enforced to override the OC values.
- **Normal** uses the saved OC config values without modification.
- **Performance** applies maximum OC + thermal mitigation + DRAM at max OPP.

Switching modes updates the UI state immediately; tap **Apply Changes** to activate on hardware.

## Auto Gaming Mode

Automatic Performance OC boost when user-selected apps are in the foreground. Works independently across all power modes.

### How It Works

1. **Select apps** — Profile tab → enable Auto Gaming toggle → "+ Select Apps" to browse installed 3rd-party apps with icons, search, and batch selection
2. **Apply** — "Apply Changes" saves the config, starts the WebUI foreground monitor (5-second polling), and launches a persistent background daemon
3. **Auto boost** — When a selected app enters the foreground, Performance preset is applied (max CPU/GPU OC, DRAM 6400 MHz, GPU cdev lock)
4. **Auto revert** — When the gaming app exits foreground, the current power mode preset is restored

### App Selector

- Lists all installed 3rd-party apps via `pm list packages -3`
- App labels loaded asynchronously via `dumpsys package` parsing
- App icons loaded in batches via custom DEX-based icon extractor (ActivityThread → getResourcesForApplication → Bitmap → PNG → base64)
- Real-time search filter by app name or package name
- Selected apps shown as chips with mini icons in the profile card

### Monitoring Architecture

| Component | Scope | Method |
|-----------|-------|--------|
| WebUI JS polling | While WebUI is open | `setInterval` every 5s, `dumpsys activity` foreground check |
| `gaming_monitor.sh` daemon | Persistent (survives WebUI close) | Shell loop every 5s, PID file at `CONFIG_DIR/gaming_monitor.pid` |

The daemon is started by `service.sh` on boot (if `auto_gaming=1`) and can be restarted/stopped from the WebUI via `Apply Changes`.

### Foreground Detection

```sh
# Primary: Activity Manager
dumpsys activity activities | grep mResumedActivity | head -1 | sed 's|.*u0 ||;s|/.*||'

# Fallback: Window Manager
dumpsys window | grep mCurrentFocus | tail -1 | sed 's|.*{[^ ]* [^ ]* ||;s|/.*||;s|}.*||'
```

## Storage / UFS Tuning

The WebUI's Storage tab provides per-device block queue tuning and UFS controller settings. All settings are persisted in `oc_config.json` and restored on boot via the late-boot relift pass (T+45 s).

### Block Queue Parameters

Applied to all UFS block devices (`/sys/block/sd{a,b,c}/queue/`):

| Parameter | Description | Default |
|-----------|-------------|---------|
| `scheduler` | I/O scheduler (`none` = HW dispatch) | `none` |
| `read_ahead_kb` | Sequential pre-fetch buffer (KB) | 2048 |
| `rq_affinity` | Completion CPU affinity (2 = force same CPU) | 2 |
| `nomerges` | I/O merge policy (0 = merge for best throughput) | 0 |
| `iostats` | Collect `/proc/diskstats` (0 = less overhead) | 1 |
| `add_random` | Feed disk timings to `/dev/random` | 0 |

### UFS Controller (ufshcd at 0x11270000)

| Parameter | Description | Default |
|-----------|-------------|---------|
| `wb_on` | Write Booster — SLC cache for burst writes | 1 (ON) |

> **Note**: `nr_requests` and `scheduler` switching may be limited on hardware-queue UFS devices. `nr_requests` returns EACCES on this device.

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
| DRAM min freq floor | `echo <hz> \| tee /sys/class/devfreq/mtk-dvfsrc-devfreq/min_freq` |
| DRAM max freq ceil  | `echo <hz> \| tee /sys/class/devfreq/mtk-dvfsrc-devfreq/max_freq` |
| I/O read-ahead | `echo <kb> > /sys/block/sd*/queue/read_ahead_kb` |
| UFS Write Booster | `echo {0,1} > /sys/devices/platform/11270000.ufshci/wb_on` |
| CPU thermal trip raise | Write to `/sys/class/thermal/thermal_zone*/trip_point_*_temp` |
| GPU cdev lock | `echo 0 > /sys/class/thermal/cooling_device*/cur_state` (gpu/mali types) |
| GPU OPP pin | `echo 0 > /proc/gpufreqv2/fix_target_opp_index` |
| Gaming daemon start | `nohup sh <CONFIG_DIR>/gaming_monitor.sh &` |
| Gaming daemon stop | `kill $(cat <CONFIG_DIR>/gaming_monitor.pid)` |

## Data Sources

| Data | Source |
|------|--------|
| CPU freq + volt | `kpm_oc.ko` → `opp_table` sysfs (live CSRAM read) |
| CPU raw hex dump | `kpm_oc.ko` → `raw` sysfs (live CSRAM read) |
| CPU available freqs | `/sys/devices/system/cpu/cpufreq/policy{0,4,7}/scaling_available_frequencies` |
| GPU freq + volt + vsram | `/proc/gpufreqv2/gpu_working_opp_table` |
| GPU status | `/proc/gpufreqv2/gpufreq_status` |
| CPU volt override result | `kpm_oc.ko` → `cpu_volt_ov_result` sysfs |
| GPU volt override result | `kpm_oc.ko` → `gpu_volt_ov_result` sysfs |
| DRAM cur freq | `/sys/class/devfreq/mtk-dvfsrc-devfreq/cur_freq` |
| DRAM available freqs | `/sys/class/devfreq/mtk-dvfsrc-devfreq/available_frequencies` |
| DRAM data rate | `/sys/bus/platform/drivers/dramc_drv/dram_data_rate` |
| DRAM type | `/sys/bus/platform/drivers/dramc_drv/dram_type` |
| Vcore voltage | `/sys/class/regulator/regulator.74/microvolts` |
| Block queue attrs | `/sys/block/sd{a,b,c}/queue/{scheduler,read_ahead_kb,...}` |
| UFS controller | `/sys/devices/platform/11270000.ufshci/{wb_on,clkgate_enable,...}` |
| Thermal zones | `/sys/class/thermal/thermal_zone*/type`, `temp`, `trip_point_*_temp` |
| Cooling devices | `/sys/class/thermal/cooling_device*/type`, `max_state`, `cur_state` |
| Installed apps | `pm list packages -3` |
| App labels | `dumpsys package` (nonLocalizedLabel field) |
| App icons | DEX-based icon extractor (ActivityThread → getResourcesForApplication → Bitmap → PNG → base64) |
| Foreground app | `dumpsys activity activities` / `dumpsys window` |

For runtime verification, prefer the gpufreqv2 proc nodes over generic kernel-manager UI labels.

## Installation

1. Build `kpm_oc.ko` from [Headwolf_F8_KPM_OC_Kernel](https://github.com/zerofrip/Headwolf_F8_KPM_OC_Kernel)
2. Place `kpm_oc.ko` in the module root directory
3. ZIP the module directory and flash via APatch / KernelSU manager

## Requirements

- Headwolf F8 tablet (MT8792 / Dimensity 8300)
- Android 14, kernel 6.1 GKI
- APatch or KernelSU with WebUI support

## Author

**zerofrip** — [github.com/zerofrip](https://github.com/zerofrip)

## License

This project is licensed under **GPL-2.0**.

### Third-Party Licenses

| Component | License |
|-----------|---------|
| [Inter](https://github.com/rsms/inter) font | [SIL Open Font License 1.1](https://scripts.sil.org/OFL) |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) font | [SIL Open Font License 1.1](https://scripts.sil.org/OFL) |

Fonts are loaded dynamically from Google Fonts and are not bundled in this repository.
