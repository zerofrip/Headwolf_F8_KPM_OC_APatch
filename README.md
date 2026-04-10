# Headwolf F8 OC Manager (APatch Module)

APatch/KernelSU module (v10.7) providing CPU, GPU, DRAM, Storage overclocking/tuning, thermal mitigation, governor-based power profiles, and auto gaming mode for the Headwolf F8 tablet (MT8792 / Dimensity 8300).

## Features

- **CPU OPP Reader** — Displays per-cluster DVFS data (freq + volt) read from CSRAM via `kpm_oc.ko`. Live sysfs read — always reflects current CSRAM state without requiring a rescan
- **CPU Overclocking** — Patches CSRAM LUT[0] per cluster and updates the Linux cpufreq policy ceiling at runtime
- **CPU Per-LUT Voltage Override** — Direct CSRAM writes for any LUT entry, bypassing stock voltage constraints. Original values saved and restored on `clear`
- **MCUPM CSRAM Countermeasure** *(v7.2)* — kprobes on `scmi_cpufreq_fast_switch` and `scmi_cpufreq_set_target` resync OC voltages into CSRAM immediately before every CPU DVFS transition, preventing MCUPM firmware from reverting them between relift cycles
- **GPU Overclocking** — Patches the GPU default + working OPP tables in kernel memory; module parameter default is 1900 MHz @ 1150.4 mV (overridden by `conf/gpu_oc.json` on boot)
- **GPU Per-OPP Voltage Override** — Direct memory writes for any GPU OPP entry, bypassing vendor `fix_custom_freq_volt` validation (DVFSState check, volt clamp). Original values saved and restored on `clear`
- **GPUEB OPP Countermeasure** *(v7.2)* — kprobe on `__gpufreq_generic_commit_gpu` re-patches GPU OPP voltages immediately before every GPU DVFS commit, preventing GPUEB firmware from reverting OC voltage to stock
- **GPU PLL Direct Programming** *(v8.0)* — kretprobe on `gpufreq_commit` reprograms MFG PLL CON1 after GPUEB commits above-stock OC frequency
- **GPU OPP Table** — Displays GPU OPP entries from `/proc/gpufreqv2` — Controls DRAM minimum frequency via DVFSRC devfreq, locking LPDDR5X at higher OPPs for sustained memory bandwidth. Vcore automatically scales with frequency
- **Storage / UFS Tuning** *(v7.5)* — Per-device block queue tuning (I/O scheduler, read-ahead, rq_affinity, nomerges, iostats, entropy feed) and UFS controller settings (Write Booster, clock gating on/delay, auto-hibernate timer, RPM/SPM power levels). UFS version detected dynamically from `specification_version` (UFS 4.0 on this device). Uses `printf|tee` writes for ufshcd sysfs compatibility (`echo >` blocked by kernel `O_CREAT` check)
- **Thermal Mitigation** *(v7.6)* — Per-component thermal controls: CPU trip point raising (Soft +15°C / Hard +30°C + cdev lock), GPU cooling device lock (Soft) and OPP pinning via `fix_target_opp_index` (Hard)
- **Governor-Based Profiles** *(v10.5+)* — Each CPU frequency governor (schedutil, performance, powersave, ondemand, conservative, userspace) stores its own preset of CPU OC targets, scaling limits, DRAM floor, and thermal modes. Switching governors applies the saved preset automatically. Localized governor names and usage descriptions displayed in EN/JA
- **Auto Gaming Mode** *(v8.0)* — Foreground app detection with automatic max-OC boost for user-selected apps. Includes app selector with icon display, background monitoring daemon, and auto-revert when the gaming app exits. Works independently across all governor profiles
- **CPU Tuning** *(v9.5+)* — schedutil up/down rate limits, cpuidle max state, energy-aware scheduling, child-runs-first, uclamp top-app min, FPSGO boost/rescue toggles
- **GPU Tuning** *(v9.5+)* — Mali-G720 DVFS period, idle hysteresis, shader power-off delay, command stream group period, power policy, and per-driver property overrides (LTO, pilot shaders, AFBC, CRC, IDVS, pre-rotation, Vulkan HWUI/RenderEngine)
- **Display Tuning** *(v9.5+)* — Fixed/adaptive refresh rate mode (60/90/120/144 Hz), animation scale factors, PQ controls (color saturation, sharpness, ultra resolution, DRE, HDR, HFG), display idle timeout
- **Multi-Language WebUI** *(v8.0)* — Browser-based interface with 6 tabs (CPU / GPU / RAM / Storage / Profile / Display), i18n support (English / 日本語), language switcher in header. Per-section Apply buttons; changes are instantaneous without affecting other sections
- **Configuration Persistence** *(v9.0)* — All settings saved to per-section JSON files under `conf/` (12 files); automatically restored on boot via `insmod` params and sysfs writes. Legacy single-file `oc_config.json` is auto-migrated on first boot

## Structure

```text
├── module.prop                     # APatch module metadata (v10.7)
├── kpm_oc.ko                       # Compiled kernel module (v8.1)
├── service.sh                      # Boot-time service
├── icon_extractor.dex              # DEX for app icon extraction (ActivityThread → Bitmap → base64)
├── conf.default/                   # Default config files (seeded on first install)
│   ├── cpu_oc.json                 # CPU OC freq/volt per cluster (L/B/P)
│   ├── gpu_oc.json                 # GPU OC freq/volt/vsram
│   ├── cpu_scaling.json            # CPU scaling min/max per policy
│   ├── cpu_tuning.json             # schedutil rates, cpuidle, sched, uclamp, FPSGO
│   ├── gpu_tuning.json             # Mali DVFS period, hysteresis, power policy, driver props
│   ├── display_tuning.json         # Refresh rate mode, PQ settings, animation scales
│   ├── dram.json                   # DRAM minimum frequency
│   ├── io.json                     # I/O scheduler settings
│   ├── ufs.json                    # UFS write booster + controller settings
│   ├── thermal.json                # CPU/GPU thermal modes
│   ├── profile.json                # Active governor, auto gaming, gaming apps, governor presets
│   └── proximity.json              # Vestigial stub — proximity hardware not present on this device
├── conf/                           # Active config (per-user, persisted across reboots)
│   └── (same files as conf.default/)
├── tools/                          # Build-time Java tools (ProbeAPI, SetDisplayMode, icon extractor sources)
│   └── dex_out/classes.dex         # Compiled DEX deployed on-device for icon extraction
└── webroot/
    ├── index.html                  # WebUI shell (CPU/GPU/RAM/Storage/Profile/Display tabs)
    ├── i18n.js                     # Internationalization module (EN / JA), governor name/desc strings
    ├── app.js                      # Application logic (APatch ksu.exec API, OC via kpm_oc sysfs + devfreq + block I/O + thermal + gaming + display)
    └── style.css                   # Dark glassmorphism design system
```

## Boot Flow (`service.sh`)

1. **Migrate legacy config** — If `oc_config.json` exists and `conf/cpu_oc.json` does not, extract values into split files under `conf/` and rename old file to `.bak.v9`
2. **Seed defaults** — Copy any missing `conf/*.json` from `conf.default/`
3. Parse `conf/cpu_oc.json` + `conf/gpu_oc.json` for saved OC params and build `insmod` parameter string
4. Load `kpm_oc.ko` with OC params (e.g. `insmod kpm_oc.ko cpu_oc_p_freq=4000000 gpu_target_freq=1900000 ...`)
   - CPU CSRAM auto-scan runs on init
   - GPU OC auto-applies on init
   - CPU OC auto-applies if any `cpu_oc_*_freq` param is nonzero
5. Restore CPU scaling limits (`scaling_min_freq` / `scaling_max_freq`) from `conf/cpu_scaling.json`
6. Run one extra CPU/GPU relift pass from config to survive vendor-side runtime refreshes
7. Log CPU/GPU OC results
8. Restore DRAM min freq floor via DVFSRC devfreq from `conf/dram.json`
9. Export CPU OPP data from `opp_table` sysfs → `cpu_opp_table` file
10. Export GPU OPP data from `/proc/gpufreqv2/gpu_working_opp_table` → `gpu_opp_table` file
11. Detect GPU devfreq sysfs path (`/sys/class/devfreq/*mali*`)
12. Write `gaming_monitor.sh` daemon script to `CONFIG_DIR`
13. Launch background late-boot relift at T+45 s:
    - Re-applies CPU/GPU OC, restores `scaling_max_freq`, re-sets DRAM min freq floor
    - Applies thermal mitigation (CPU trip point raising + GPU cooling device lock) per saved mode from `conf/thermal.json`
    - Applies I/O block queue tuning (scheduler, read-ahead, rq_affinity, nomerges, iostats, add_random) from `conf/io.json` to all UFS block devices
    - Restores UFS controller settings (Write Booster, clock gating, auto-hibernate, RPM/SPM levels) from `conf/ufs.json`
    - Applies GPU tuning parameters (DVFS period, idle hysteresis, power policy, Mali driver props) from `conf/gpu_tuning.json`
    - Applies CPU tuning parameters (schedutil rates, cpuidle, sched flags, uclamp, FPSGO) from `conf/cpu_tuning.json`
    - Applies display settings (refresh rate, animation scales, PQ) from `conf/display_tuning.json`
    - Starts `gaming_monitor.sh` daemon if `auto_gaming=1` in `conf/profile.json` and gaming apps are configured

### Config Persistence (v9.0 — Split Files)

The WebUI saves OC settings to per-section JSON files under `/data/adb/modules/f8_kpm_oc_manager/conf/`.
On first install, `conf.default/*.json` is copied to `conf/` as the initial config;
subsequent module updates preserve the user's customized values.
Legacy single-file `oc_config.json` is auto-migrated to split files on first boot.

| File | Keys | Example |
|------|------|---------|
| `cpu_oc.json` | `cpu_oc_{l,b,p}_{freq,volt}` | `{"cpu_oc_p_freq":4000000,"cpu_oc_p_volt":1150000,...}` |
| `gpu_oc.json` | `gpu_oc_{freq,volt,vsram}` | `{"gpu_oc_freq":1900000,"gpu_oc_volt":115040,"gpu_oc_vsram":95000}` |
| `cpu_scaling.json` | `cpu_{max,min}_{0,4,7}` | `{"cpu_max_0":3800000,"cpu_min_0":480000,...}` |
| `cpu_tuning.json` | `sugov_{up,down}_rate_limit_us`, `cpuidle_max_state`, `sched_{energy_aware,child_runs_first}`, `uclamp_top_app_min`, `fpsgo_{boost_ta,rescue_enable}` | `{"sugov_up_rate_limit_us":1000,...}` |
| `gpu_tuning.json` | `gpu_dvfs_period_ms`, `gpu_idle_hysteresis_ms`, `gpu_shader_pwroff_ms`, `gpu_power_policy`, `gpu_csg_period_ms`, Mali driver props | `{"gpu_dvfs_period_ms":100,...}` |
| `display_tuning.json` | `refresh_mode`, `peak_refresh_rate`, `min_refresh_rate`, animation scales, PQ flags | `{"refresh_mode":"fixed","peak_refresh_rate":144,...}` |
| `dram.json` | `dram_min_freq` | `{"dram_min_freq":6400000000}` |
| `io.json` | `io_{read_ahead_kb,scheduler,...}` | `{"io_read_ahead_kb":2048,"io_scheduler":"none",...}` |
| `ufs.json` | `ufs_wb_on`, `ufs_clkgate_enable`, `ufs_clkgate_delay_ms`, `ufs_auto_hibern8`, `ufs_rpm_lvl`, `ufs_spm_lvl` | `{"ufs_wb_on":1,"ufs_clkgate_enable":1,"ufs_clkgate_delay_ms":10,"ufs_auto_hibern8":0,"ufs_rpm_lvl":3,"ufs_spm_lvl":3}` |
| `thermal.json` | `cpu_thermal_mode`, `gpu_thermal_mode` | `{"cpu_thermal_mode":0,"gpu_thermal_mode":0}` |
| `profile.json` | `governor`, `governor_profiles`, `auto_gaming`, `gaming_apps` | `{"governor":"schedutil","governor_profiles":{...},"auto_gaming":0,"gaming_apps":""}` |

All files are minified single-line JSON (no spaces around colons) for compatibility with lightweight `grep`-based parsing — no `jq` needed.

```bash
# service.sh reads values with:
json_int() { grep -o "\"$1\":[0-9]*" "$2" | head -1 | grep -o '[0-9]*$'; }
json_str() { grep -o "\"$1\":\"[^\"]*\"" "$2" | head -1 | sed 's/.*:"\(.*\)"/\1/'; }

# Example:
json_int cpu_oc_p_freq /data/adb/modules/f8_kpm_oc_manager/conf/cpu_oc.json
# → 4000000
```

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
Default target on boot: **1900 MHz @ 115040 (= 1150.4 mV)** (bare module parameter default; `conf/gpu_oc.json` overrides this on boot).

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

Settings are persisted in `conf/thermal.json` (`cpu_thermal_mode`, `gpu_thermal_mode`) and restored on boot via the late-boot relift pass.

## Governor-Based Profiles

Each CPU frequency governor stores its own preset of CPU OC targets, scaling limits, DRAM minimum frequency, and thermal modes. Switching governors from the Profile tab applies the saved preset automatically; if no preset has been saved for a governor, a built-in default is used.

| Governor | Icon | Typical Use |
|----------|------|-------------|
| `schedutil` | ⚡ | Default — frequency tracks CPU utilisation via EAS |
| `performance` | 🚀 | Pins all CPUs at max frequency (maximum performance) |
| `powersave` | 🔋 | Pins all CPUs at min frequency (minimum power) |
| `ondemand` | 📊 | Aggressive ramp-up based on CPU load sampling |
| `conservative` | 🛡️ | Gradual ramp-up/down, lower power than ondemand |
| `userspace` | 🎛️ | Manual frequency control via `scaling_setspeed` |

Each governor profile stores:

| Field | Description |
|-------|-------------|
| `cpu_oc_{l,b,p}_{freq,volt}` | Per-cluster OC target KHz / µV |
| `cpu_{max,min}_{0,4,7}` | cpufreq scaling ceiling / floor per policy |
| `dram_min` | DRAM devfreq minimum frequency floor (Hz) |
| `cpu_thermal` / `gpu_thermal` | Thermal mitigation mode (0=Off / 1=Soft / 2=Hard) |

- **Battery Save** — use `powersave` governor with reduced scaling limits and no thermal mitigation
- **Normal** — use `schedutil` with the saved OC config and no thermal mitigation
- **Performance** — use `performance` governor with max OC (4000 MHz P-cluster) + Soft thermal + DRAM 6400 MHz

Switching tabs and tapping **Apply** saves the profile and applies it to hardware immediately.

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

The WebUI's Storage tab provides per-device block queue tuning and UFS controller settings. All settings are persisted in `conf/io.json` and `conf/ufs.json`, and restored on boot via the late-boot relift pass (T+45 s).

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

### UFS Controller (ufshcd at `soc/112b0000.ufshci`)

UFS 4.0 (Samsung, `specification_version` = `0x0400`). All six parameters below are writable via the ufshcd sysfs interface.

> **Important**: Shell redirects (`echo X > /sys/...`) fail on ufshcd sysfs attributes because the kernel blocks the `O_CREAT` flag. Use `printf '%s' X | tee /sys/path` instead.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `wb_on` | Write Booster — SLC cache for burst writes | 1 (ON) |
| `clkgate_enable` | Clock gating — saves power when UFS link is idle | 1 (ON) |
| `clkgate_delay_ms` | Idle time (ms) before clock gating activates | 10 |
| `auto_hibern8` | Auto Hibernate8 idle timer (µs); 0 = disabled | 0 |
| `rpm_lvl` | Runtime PM power level (0–5; 3 = Sleep/Hibern8) | 3 |
| `spm_lvl` | System PM power level (0–5; 3 = Sleep/Hibern8) | 3 |

PM level values: `0`=None, `1`=Active, `2`=Standby, `3`=Sleep/Hibern8, `4`=Power Down, `5`=Max.

> **Note**: `nr_requests` and `clkscale_enable` are not writable on this device — `nr_requests` returns EACCES (hardware queue, no kernel-side queue), and `clkscale_enable` has a different SELinux label (`device_create_file` path). `enable_wb_buf_flush` returns `-EOPNOTSUPP` at the kernel driver level.

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
| UFS Write Booster | `printf '%s' {0,1} \| tee /sys/devices/platform/soc/112b0000.ufshci/wb_on` |
| UFS Clock Gate | `printf '%s' {0,1} \| tee /sys/devices/platform/soc/112b0000.ufshci/clkgate_enable` |
| UFS Clock Gate delay | `printf '%s' <ms> \| tee /sys/devices/platform/soc/112b0000.ufshci/clkgate_delay_ms` |
| UFS Auto Hibernate8 | `printf '%s' <us> \| tee /sys/devices/platform/soc/112b0000.ufshci/auto_hibern8` |
| UFS RPM level | `printf '%s' {0-5} \| tee /sys/devices/platform/soc/112b0000.ufshci/rpm_lvl` |
| UFS SPM level | `printf '%s' {0-5} \| tee /sys/devices/platform/soc/112b0000.ufshci/spm_lvl` |
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
| UFS controller | `/sys/devices/platform/soc/112b0000.ufshci/{wb_on,clkgate_enable,clkgate_delay_ms,auto_hibern8,rpm_lvl,spm_lvl}` |
| Thermal zones | `/sys/class/thermal/thermal_zone*/type`, `temp`, `trip_point_*_temp` |
| Cooling devices | `/sys/class/thermal/cooling_device*/type`, `max_state`, `cur_state` |
| Installed apps | `pm list packages -3` |
| App labels | `dumpsys package` (nonLocalizedLabel field) |
| App icons | DEX-based icon extractor (ActivityThread → getResourcesForApplication → Bitmap → PNG → base64) |
| Foreground app | `dumpsys activity activities` / `dumpsys window` |

For runtime verification, prefer the gpufreqv2 proc nodes over generic kernel-manager UI labels.

## Not Implemented / Known Limitations

### DT2W (Double Tap to Wake)

Double-tap-to-wake gesture support was investigated and a working prototype was confirmed (kprobe on `nvt_bootloader_reset` pre-handler), but it was removed for the following reasons:

- **Touch driver in vendor module** — The NT36523 touch controller driver (`nvt_ts`) is compiled into a vendor kernel module. Its internal symbols (`nvt_bootloader_reset`, `nvt_ts_resume`, etc.) are not exported to the GKI kernel. Kprobe registration depends on `kallsyms_lookup_name` at runtime and succeeds only when the vendor module loads first; this is not guaranteed.
- **`nvt_ts_pm_resume()` does not fire** — This device uses a DRM notifier-only path for display power management. The standard `pm_suspend` / `pm_resume` callbacks in the NT36523 driver are never invoked, so the documented gesture-mode API (writing to gesture registers in the resume path) does not work. DT2W requires a lower-level workaround.
- **Fragile kprobe workaround** — The working implementation used a pre-handler kprobe on `nvt_bootloader_reset` to re-arm the gesture EINT before the firmware reset cleared it. The correct timing relies on `nvt_ts_resume()` → `nvt_bootloader_reset()` → gesture EINT re-arm, which is an undocumented internal order that can change silently across vendor OTA updates.
- **GKI CFI / KCFI constraints** — GKI 6.1 is built with `CONFIG_CFI_CLANG=y`. Kprobing non-exported vendor module functions can produce KCFI type hash mismatches and trigger an immediate kernel panic and boot loop. Handlers must be carefully annotated `__nocfi`, and even then, indirect calls through kallsyms-resolved pointers carry risk.

### Proximity Sensor

The Headwolf F8 does not have a proximity sensor. There is no proximity sensor IC wired to the SoC on this hardware revision and no corresponding devicetree node is defined. Any code path that reads a proximity sensor event source returns no data. The `conf/proximity.json` file is a vestigial stub left from an earlier exploration and is not used at runtime.

---

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
