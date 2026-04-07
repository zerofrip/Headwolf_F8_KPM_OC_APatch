/* ═══════════════════════════════════════════════════════════════════════
   KPM OC Manager — i18n (Internationalization) Module
   Lightweight key-based translation with localStorage persistence.
   ═══════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const STORAGE_KEY = 'kpm_oc_lang';
  const DEFAULT_LANG = 'en';

  /* ─── Translation Dictionaries ───────────────────────────────────── */
  const translations = {
    /* ════════════════════  English  ════════════════════ */
    en: {
      /* Header */
      'header.title': 'OC Manager',
      'header.subtitle': 'Headwolf F8 · Dimensity 8300',
      'header.checking': 'Checking...',
      'header.module_active': 'Module Active',
      'header.module_not_loaded': 'Module Not Loaded',

      /* Tabs */
      'tab.cpu': 'CPU',
      'tab.gpu': 'GPU',
      'tab.ram': 'RAM',
      'tab.storage': 'Storage',
      'tab.profile': 'Profile',

      /* Buttons */
      'btn.reload': 'Reload',
      'btn.apply': 'Apply Changes',
      'btn.add_entry': '+ Add Entry',
      'btn.select_apps': '+ Select Apps',
      'btn.close': 'Close',
      'btn.refresh_temps': '↻ Temps',

      /* CPU */
      'cpu.cluster_title': 'CPU {name}',
      'cpu.opps': '{n} OPPs',
      'cpu.max_label': 'Max: {freq}',
      'cpu.max_freq': 'Max Freq',
      'cpu.min_freq': 'Min Freq',
      'cpu.th.index': '#',
      'cpu.th.freq': 'Freq (MHz)',
      'cpu.th.voltage': 'Voltage (µV)',
      'cpu.no_data': 'No CPU data loaded.',
      'cpu.no_data_hint': 'Tap "Reload" to read OPP tables.',
      'cpu.add_freq_placeholder': 'Freq (MHz)',
      'cpu.add_volt_placeholder': 'Voltage (µV)',
      'cpu.opp_added': 'New CPU OPP added ({freq})',
      'cpu.mhz_input_error': 'Enter in MHz (e.g. 3500)',

      /* GPU */
      'gpu.title': 'GPU · Mali',
      'gpu.max_label': 'Max: {freq}',
      'gpu.th.index': '#',
      'gpu.th.freq': 'Freq (MHz)',
      'gpu.th.voltage': 'Voltage (µV)',
      'gpu.th.vsram': 'VSRAM (µV)',
      'gpu.no_data': 'No GPU data loaded.',
      'gpu.no_data_hint': 'Tap "Reload" to read OPP tables.',
      'gpu.add_freq_placeholder': 'Freq (MHz)',
      'gpu.add_volt_placeholder': 'Voltage (µV)',
      'gpu.opp_added': 'New GPU OPP added ({freq})',

      /* GPU Tuning */
      'gpu_tuning.title': 'GPU Tuning · Mali kbase',
      'gpu_tuning.dvfs_period': 'DVFS Period',
      'gpu_tuning.dvfs_period_hint': 'GPU DVFS polling interval (ms). Lower = faster freq response',
      'gpu_tuning.idle_hysteresis': 'Idle Hysteresis',
      'gpu_tuning.idle_hysteresis_hint': 'Time GPU stays awake after idle (ms). Higher = less wake latency',
      'gpu_tuning.shader_pwroff': 'Shader Poweroff Timeout',
      'gpu_tuning.shader_pwroff_hint': 'MCU/shader core poweroff delay (ms). Higher = less core wake latency',
      'gpu_tuning.power_policy': 'Power Policy',
      'gpu_tuning.power_policy_hint': 'coarse_demand = normal DVFS; always_on = no power gating (⚠ battery drain)',
      'gpu_tuning.csg_period': 'CSG Scheduling Period',
      'gpu_tuning.csg_period_hint': 'Command stream group scheduling interval (ms). Lower = faster dispatch',
      'gpu_tuning.vulkan_section': 'Vulkan / HWUI',
      'gpu_tuning.vulkan_hwui': 'Vulkan HWUI',
      'gpu_tuning.vulkan_hwui_hint': 'Use Vulkan for Android UI rendering (ro.hwui.use_vulkan). May cause glitches',
      'gpu_tuning.vulkan_renderengine': 'Vulkan RenderEngine',
      'gpu_tuning.vulkan_renderengine_hint': 'Use Vulkan for SurfaceFlinger (debug.renderengine.backend=skiavk)',
      'gpu_tuning.stock': 'Stock',
      'gpu_tuning.tuned': 'Tuned',
      'gpu_tuning.mali_driver_section': 'Mali Driver Config',
      'gpu_tuning.cmar_latency': 'Latency Optimization',
      'gpu_tuning.cmar_latency_hint': 'CMAR render manager latency optimization. Reduces frame latency',
      'gpu_tuning.disable_shader_lto': 'Disable Shader LTO',
      'gpu_tuning.disable_shader_lto_hint': 'Disable shader link-time optimization. May speed up shader compile',
      'gpu_tuning.disable_pilot_shaders': 'Disable Pilot Shaders',
      'gpu_tuning.disable_pilot_shaders_hint': 'Disable pilot shader pre-compilation stage',
      'gpu_tuning.disable_pipeline_cache': 'Disable Pipeline Cache',
      'gpu_tuning.disable_pipeline_cache_hint': 'Disable graphics pipeline cache. ⚠ Increases shader compile time',
      'gpu_tuning.disable_subpass_cache': 'Disable Subpass Cache',
      'gpu_tuning.disable_subpass_cache_hint': 'Disable subpass cache. ⚠ May hurt Vulkan render-pass performance',
      'gpu_tuning.disable_surface_afbc': 'Disable Surface AFBC',
      'gpu_tuning.disable_surface_afbc_hint': 'Disable AFBC compression for surfaces. Increases bandwidth usage',
      'gpu_tuning.disable_texture_afbc': 'Disable Texture AFBC',
      'gpu_tuning.disable_texture_afbc_hint': 'Disable AFBC compression for textures. ⚠ High bandwidth impact',
      'gpu_tuning.disable_crc': 'Disable CRC',
      'gpu_tuning.disable_crc_hint': 'Disable CRC checksums. Saves cycles at cost of error detection',
      'gpu_tuning.disable_idvs': 'Disable IDVS',
      'gpu_tuning.disable_idvs_hint': 'Disable Index-Driven Vertex Shading. ⚠ Reduces geometry throughput',
      'gpu_tuning.prerotate': 'Pre-rotation',
      'gpu_tuning.prerotate_hint': 'Enable surface pre-rotation for landscape apps. Can reduce composition cost',

      /* CPU Tuning */
      'cpu_tuning.title': 'CPU Tuning · Driver',
      'cpu_tuning.governor_section': 'Governor (sugov_ext)',
      'cpu_tuning.up_rate_limit': 'Up Rate Limit',
      'cpu_tuning.up_rate_limit_hint': 'Delay before scaling up frequency (µs). Lower = faster ramp-up',
      'cpu_tuning.down_rate_limit': 'Down Rate Limit',
      'cpu_tuning.down_rate_limit_hint': 'Delay before scaling down frequency (µs). Higher = stays at high freq longer',
      'cpu_tuning.idle_section': 'CPU Idle',
      'cpu_tuning.cpuidle_max_state': 'Max Idle State',
      'cpu_tuning.cpuidle_max_state_hint': 'Deepest allowed idle state. Lower = less latency, more power usage',
      'cpu_tuning.sched_section': 'Scheduler',
      'cpu_tuning.energy_aware': 'Energy Aware Scheduling',
      'cpu_tuning.energy_aware_hint': 'EAS: balance power vs performance. OFF = pure performance scheduling',
      'cpu_tuning.child_runs_first': 'Child Runs First',
      'cpu_tuning.child_runs_first_hint': 'Forked child process runs before parent. Can improve app launch speed',
      'cpu_tuning.uclamp_min': 'Uclamp Top-App Min',
      'cpu_tuning.uclamp_min_hint': 'Minimum utilization clamp for foreground apps (0-1024). Higher = forces higher freq',
      'cpu_tuning.fpsgo_section': 'FPSGO (Frame Boost)',
      'cpu_tuning.fpsgo_boost_ta': 'Boost Touch Accelerate',
      'cpu_tuning.fpsgo_boost_ta_hint': 'Enable touch acceleration boost via FPSGO. Boosts CPU on touch events',
      'cpu_tuning.fpsgo_rescue': 'Rescue Mode',
      'cpu_tuning.fpsgo_rescue_hint': 'Emergency frequency boost when frames are about to drop',

      /* Display Tuning */
      'tab.display': 'Display',
      'display.title': 'Display Tuning · MTKDEV',
      'display.refresh_section': 'Refresh Rate',
      'display.refresh_mode': 'Mode',
      'display.refresh_mode_hint': 'Fixed locks refresh rate. Adaptive runs at peak during touch and drops to min on idle (requires reboot to switch mode)',
      'display.mode_fixed': 'Fixed',
      'display.mode_adaptive': 'Adaptive',
      'display.fixed_rr_hint': 'Locked refresh rate (peak = min)',
      'display.adaptive_peak_hint': 'Maximum refresh rate during touch/animation',
      'display.adaptive_min_hint': 'Idle refresh rate floor (90 or 120 Hz). 60 Hz unavailable in adaptive mode due to OEM vote constraint',
      'display.peak_rr': 'Peak Refresh Rate',
      'display.peak_rr_hint': 'Maximum display refresh rate. Higher = smoother, more power usage',
      'display.min_rr': 'Min Refresh Rate',
      'display.min_rr_hint': 'Minimum refresh rate floor. Set equal to peak to lock refresh rate',
      'display.animation_section': 'Animation',
      'display.animator': 'Animator Duration',
      'display.animator_hint': 'Animation speed multiplier. 0 = instant, 0.5 = fast, 1.0 = normal',
      'display.transition': 'Transition Duration',
      'display.transition_hint': 'Activity transition animation speed. 0 = instant',
      'display.window': 'Window Duration',
      'display.window_hint': 'Window animation speed. 0 = instant',
      'display.pq_section': 'Picture Quality (MTK PQ)',
      'display.color_sat': 'Color Saturation',
      'display.color_sat_hint': 'SurfaceFlinger color saturation boost. 1.0 = native, higher = more vivid',
      'display.sharpness': 'Sharpness',
      'display.sharpness_hint': 'MTK display sharpness level',
      'display.shp_low': 'Low',
      'display.shp_mid': 'Mid',
      'display.shp_high': 'High',
      'display.ultra_res': 'Ultra Resolution',
      'display.ultra_res_hint': 'MTK super-resolution upscaling for video content',
      'display.dre': 'Dynamic Range (DRE)',
      'display.dre_hint': 'Dynamic Range Enhancement — adaptive contrast and brightness',
      'display.hdr_adaptive': 'HDR Adaptive TM',
      'display.hdr_adaptive_hint': 'Adaptive tone mapping for HDR10/HDR10+ content',
      'display.hfg': 'Film Grain (HFG)',
      'display.hfg_hint': 'High Frequency Grain — adds film-like texture to video. Higher = more grain',
      'display.hfg_low': 'Low',
      'display.hfg_high': 'High',
      'display.power_section': 'Power',
      'display.idle_time': 'Display Idle Time',
      'display.idle_time_hint': 'Time before display enters low-power idle mode (ms). Lower = faster idle',

      /* RAM */
      'ram.title': 'DRAM · {type}',
      'ram.data_rate': 'Data Rate',
      'ram.vcore': 'Vcore',
      'ram.current_freq': 'Current Freq',
      'ram.min_floor': 'Min Floor',
      'ram.min_freq_floor': 'Min Freq Floor',
      'ram.th.index': '#',
      'ram.th.frequency': 'Frequency',
      'ram.th.data_rate': 'Data Rate',
      'ram.active': 'Active',
      'ram.floor': 'Floor',
      'ram.no_data': 'No RAM data loaded.',
      'ram.no_data_hint': 'Tap "Reload" to read DRAM info.',
      'ram.info_hint': 'Min Freq Floor locks DRAM at or above the selected frequency. Vcore voltage is automatically managed by DVFSRC and increases with higher DRAM OPPs.',
      'ram.dram_min_toast': 'DRAM min floor → {freq}',
      'ram.dram_min_fail': 'DRAM min_freq write failed: {err}',

      /* Storage */
      'storage.title': 'UFS · Block Devices',
      'storage.devs': '{n} devs',
      'storage.scheduler': 'Scheduler',
      'storage.queue_depth': 'Queue Depth',
      'storage.read_ahead': 'Read-Ahead',
      'storage.ufs_type': 'UFS Type',
      'storage.block_queue_tuning': 'Block Queue Tuning',
      'storage.io_scheduler': 'I/O Scheduler',
      'storage.io_scheduler_hint': 'Requires elevator; <code>none</code> = HW dispatch (default)',
      'storage.read_ahead_all': 'Read-Ahead (all devs)',
      'storage.read_ahead_hint': 'Sequential pre-fetch buffer. ↑ seq read, ↓ random I/O',
      'storage.rq_affinity': 'RQ Affinity',
      'storage.rq_affinity_hint': 'Completion CPU affinity. 2 = force same CPU (lowest latency)',
      'storage.io_merges': 'I/O Merges',
      'storage.io_merges_hint': 'Merge adjacent I/O requests. 0 = merge (best throughput)',
      'storage.io_stats': 'I/O Stats',
      'storage.io_stats_hint': 'Collect /proc/diskstats. Off = less overhead',
      'storage.entropy_feed': 'Entropy Feed',
      'storage.entropy_feed_hint': 'Feed disk timings to /dev/random. Off = less overhead',
      'storage.th.device': 'Device',
      'storage.th.sched': 'Sched',
      'storage.th.ra': 'RA',
      'storage.th.queue': 'Queue',
      'storage.th.merge': 'Merge',
      'storage.th.affin': 'Affin',
      'storage.no_data': 'No storage data loaded.',
      'storage.no_data_hint': 'Tap "Reload" to read block device info.',
      'storage.ufs_controller': 'UFS Controller · ufshcd',
      'storage.write_booster': 'Write Booster',
      'storage.clock_gating': 'Clock Gating',
      'storage.clk_gate_delay': 'CLK Gate Delay',
      'storage.clk_gate_hint': 'Gate UFS clocks during idle to save power',
      'storage.clk_gate_delay_hint': 'Idle time (ms) before gating clocks',
      'storage.auto_hibern8': 'Auto Hibernate8',
      'storage.auto_hibern8_hint': 'Idle timer (µs) for UFS link Hibern8. 0 = disabled',
      'storage.rpm_lvl': 'Runtime PM Level',
      'storage.rpm_lvl_hint': 'Device/Link power state during runtime idle',
      'storage.spm_lvl': 'System PM Level',
      'storage.spm_lvl_hint': 'Device/Link power state during system suspend',
      'storage.hci_address': 'HCI Address',
      'storage.wb_hint': 'UFS WB — accelerates burst writes using SLC cache',
      'storage.ufs_info_hint': 'UFS HCI tuning. clkscale_enable / wb_buf_flush not writable on this device.',
      'storage.info_hint': 'Block queue attrs from kernel ELF analysis (42 attrs, 16 writable). <strong style="color:var(--text-secondary)">nr_requests</strong> requires an active elevator (returns EINVAL with <code>none</code>). Scheduler switch may require kernel support.',
      'storage.toast': 'Storage: RA={ra}K sched={sched} rqa={rqa} nom={nom}',

      /* RQ Affinity options */
      'storage.rqa.none': '0 — None',
      'storage.rqa.group': '1 — CPU group',
      'storage.rqa.same': '2 — Same CPU',

      /* Nomerges options */
      'storage.nom.merge_all': '0 — Merge all',
      'storage.nom.no_front': '1 — No front',
      'storage.nom.no_merge': '2 — No merge',

      /* Thermal */
      'thermal.title': 'Thermal Mitigation',
      'thermal.off': 'Off',
      'thermal.soft': 'Soft',
      'thermal.hard': 'Hard',
      'thermal.throttle_mode': 'Throttle Mode',
      'thermal.tap_refresh': 'Tap ↻ to read temperatures',
      'thermal.cpu_desc_off': 'Normal — standard kernel thermal management',
      'thermal.cpu_desc_soft': 'Soft — re-applies KPM OC freq_qos limits; kprobe already intercepts thermal freq reductions',
      'thermal.cpu_desc_hard': 'Hard — re-applies OC limits and tries to lock CPU thermal cooling states to 0',
      'thermal.gpu_desc_off': 'Normal — standard kernel thermal management',
      'thermal.gpu_desc_soft': 'Soft — GPU devfreq cooling device locked to state 0 (prevents GPUEB throttle injection)',
      'thermal.gpu_desc_hard': 'Hard — GPU pinned at max OPP (1900 MHz) via GPUEB fix_target; no DVFS during benchmark',
      'thermal.gpu_fix_banner': '⚠ GPU OPP pinned at 1900 MHz — set Off and Apply Changes to release DVFS.',
      'thermal.cpu_info': "🔒 On this device, KPM OC's freq_qos kprobe already intercepts thermal freq reductions. Soft/Hard re-apply OC limits and attempt to lock CPU cooling states. Reboot restores kernel defaults.",
      'thermal.gpu_info': '🔒 Soft: locks GPU devfreq cooling device to state 0 — prevents GPUEB thermal throttle injection. Hard: additionally pins GPU at OPP0 (1900 MHz) bypassing all DVFS. Use Hard for benchmarks; disable with Off + Apply to restore.',
      'thermal.toast': 'Thermal: {details}',
      'thermal.cpu_restamped': 'CPU OC re-stamped',
      'thermal.cooling_locked': '+cooling locked',
      'thermal.gpu_cdevs_locked': 'GPU cdevs locked',
      'thermal.gpu_opp_pinned': 'GPU OPP pinned at 1900 MHz',
      'thermal.gpu_pin_released': 'GPU pin released',

      /* Profile */
      'profile.power_mode': 'Power Mode',
      'profile.mode_warning': '⚠ Switching mode updates CPU scaling limits, DRAM floor, and thermal settings. Tap <strong>Apply Changes</strong> to activate.',
      'profile.auto_gaming': 'Auto Gaming Mode',
      'profile.gaming_boost_active': '🎮 Gaming boost active: {app}',
      'profile.monitoring': '👁 Monitoring foreground app...',
      'profile.gaming_idle': '⏸ Auto Gaming enabled — starts on Apply',
      'profile.gaming_desc': 'Selected apps automatically trigger Performance OC when in foreground. Works across all power modes. A background daemon keeps monitoring after WebUI closes.',
      'profile.gaming_apps': 'Gaming Apps ({n})',
      'profile.no_apps_selected': 'No apps selected',
      'profile.installed_apps': 'Installed Apps',
      'profile.search_apps': 'Search apps...',
      'profile.loading_apps': 'Loading installed apps...',
      'profile.no_apps_found': 'No apps found',
      'profile.apps_count': '{total} apps · {selected} selected',

      /* Power presets */
      'preset.battery_save': 'Battery Save',
      'preset.battery_desc': 'Reduced clocks · max battery life',
      'preset.normal': 'Normal',
      'preset.normal_desc': 'OC as configured · balanced',
      'preset.performance': 'Performance',
      'preset.performance_desc': 'Max OC · thermal mitigation · DRAM max',

      /* Toast / status messages */
      'toast.applying': 'Applying changes...',
      'toast.loading': 'Loading OPP data...',
      'toast.reloading': 'Reloading OPP data...',
      'toast.loaded': 'Loaded: CPU {cpu} OPPs, GPU {gpu} OPPs, RAM {ram} OPPs',
      'toast.applied_saved': 'Applied & saved! {details}',
      'toast.saved': 'Settings saved!',
      'toast.error': 'Error: {label} — {err}',
      'toast.invalid_value': 'Invalid value',
      'toast.invalid_freq': 'Invalid frequency',
      'toast.invalid_volt': 'Invalid voltage',
      'toast.gaming_boost_on': '🎮 Gaming boost: {app}',
      'toast.gaming_boost_off': 'Gaming boost off — reverting',

      /* Misc */
      'misc.restore': 'Restore',
      'misc.remove': 'Remove',
      'misc.on': 'ON',
      'misc.off': 'OFF',
      'misc.na': 'N/A',
      'misc.lang': 'Language',
    },

    /* ════════════════════  日本語  ════════════════════ */
    ja: {
      /* Header */
      'header.title': 'OC Manager',
      'header.subtitle': 'Headwolf F8 · Dimensity 8300',
      'header.checking': '確認中...',
      'header.module_active': 'モジュール動作中',
      'header.module_not_loaded': 'モジュール未ロード',

      /* Tabs */
      'tab.cpu': 'CPU',
      'tab.gpu': 'GPU',
      'tab.ram': 'RAM',
      'tab.storage': 'ストレージ',
      'tab.profile': 'プロファイル',

      /* Buttons */
      'btn.reload': '再読み込み',
      'btn.apply': '設定を適用',
      'btn.add_entry': '+ エントリ追加',
      'btn.select_apps': '+ アプリ選択',
      'btn.close': '閉じる',
      'btn.refresh_temps': '↻ 温度',

      /* CPU */
      'cpu.cluster_title': 'CPU {name}',
      'cpu.opps': '{n} OPPs',
      'cpu.max_label': '最大: {freq}',
      'cpu.max_freq': '最大周波数',
      'cpu.min_freq': '最小周波数',
      'cpu.th.index': '#',
      'cpu.th.freq': '周波数 (MHz)',
      'cpu.th.voltage': '電圧 (µV)',
      'cpu.no_data': 'CPUデータが読み込まれていません。',
      'cpu.no_data_hint': '「再読み込み」をタップしてOPPテーブルを読み込んでください。',
      'cpu.add_freq_placeholder': '周波数 (MHz)',
      'cpu.add_volt_placeholder': '電圧 (µV)',
      'cpu.opp_added': 'CPU OPPを追加しました ({freq})',
      'cpu.mhz_input_error': 'MHz単位で入力してください（例: 3500）',

      /* GPU */
      'gpu.title': 'GPU · Mali',
      'gpu.max_label': '最大: {freq}',
      'gpu.th.index': '#',
      'gpu.th.freq': '周波数 (MHz)',
      'gpu.th.voltage': '電圧 (µV)',
      'gpu.th.vsram': 'VSRAM (µV)',
      'gpu.no_data': 'GPUデータが読み込まれていません。',
      'gpu.no_data_hint': '「再読み込み」をタップしてOPPテーブルを読み込んでください。',
      'gpu.add_freq_placeholder': '周波数 (MHz)',
      'gpu.add_volt_placeholder': '電圧 (µV)',
      'gpu.opp_added': 'GPU OPPを追加しました ({freq})',

      /* GPU Tuning */
      'gpu_tuning.title': 'GPUチューニング · Mali kbase',
      'gpu_tuning.dvfs_period': 'DVFS周期',
      'gpu_tuning.dvfs_period_hint': 'GPU DVFSポーリング間隔 (ms)。低い = 周波数応答が速い',
      'gpu_tuning.idle_hysteresis': 'アイドルヒステリシス',
      'gpu_tuning.idle_hysteresis_hint': 'アイドル後GPUが起動状態を維持する時間 (ms)。高い = 復帰レイテンシが低い',
      'gpu_tuning.shader_pwroff': 'シェーダ電源オフタイムアウト',
      'gpu_tuning.shader_pwroff_hint': 'MCU/シェーダコアの電源オフ遅延 (ms)。高い = コア復帰レイテンシが低い',
      'gpu_tuning.power_policy': '電力ポリシー',
      'gpu_tuning.power_policy_hint': 'coarse_demand = 通常DVFS; always_on = パワーゲーティング無効 (⚠ バッテリー消費増)',
      'gpu_tuning.csg_period': 'CSGスケジューリング周期',
      'gpu_tuning.csg_period_hint': 'コマンドストリームグループのスケジューリング間隔 (ms)。低い = ディスパッチが速い',
      'gpu_tuning.vulkan_section': 'Vulkan / HWUI',
      'gpu_tuning.vulkan_hwui': 'Vulkan HWUI',
      'gpu_tuning.vulkan_hwui_hint': 'Android UIレンダリングにVulkanを使用 (ro.hwui.use_vulkan)。不具合の可能性あり',
      'gpu_tuning.vulkan_renderengine': 'Vulkan RenderEngine',
      'gpu_tuning.vulkan_renderengine_hint': 'SurfaceFlingerにVulkanを使用 (debug.renderengine.backend=skiavk)',
      'gpu_tuning.stock': 'ストック',
      'gpu_tuning.tuned': 'チューニング済',
      'gpu_tuning.mali_driver_section': 'Maliドライバ設定',
      'gpu_tuning.cmar_latency': 'レイテンシ最適化',
      'gpu_tuning.cmar_latency_hint': 'CMARレンダーマネージャのレイテンシ最適化。フレームレイテンシを低減',
      'gpu_tuning.disable_shader_lto': 'シェーダLTO無効化',
      'gpu_tuning.disable_shader_lto_hint': 'シェーダのリンク時最適化を無効化。コンパイル時間が短縮される場合あり',
      'gpu_tuning.disable_pilot_shaders': 'パイロットシェーダ無効化',
      'gpu_tuning.disable_pilot_shaders_hint': 'パイロットシェーダの事前コンパイル段階を無効化',
      'gpu_tuning.disable_pipeline_cache': 'パイプラインキャッシュ無効化',
      'gpu_tuning.disable_pipeline_cache_hint': 'グラフィックスパイプラインキャッシュを無効化。⚠ コンパイル時間増加',
      'gpu_tuning.disable_subpass_cache': 'サブパスキャッシュ無効化',
      'gpu_tuning.disable_subpass_cache_hint': 'サブパスキャッシュを無効化。⚠ Vulkanレンダーパス性能低下の可能性',
      'gpu_tuning.disable_surface_afbc': 'Surface AFBC無効化',
      'gpu_tuning.disable_surface_afbc_hint': 'サーフェスのAFBC圧縮を無効化。帯域幅使用量が増加',
      'gpu_tuning.disable_texture_afbc': 'Texture AFBC無効化',
      'gpu_tuning.disable_texture_afbc_hint': 'テクスチャのAFBC圧縮を無効化。⚠ 帯域幅への影響大',
      'gpu_tuning.disable_crc': 'CRC無効化',
      'gpu_tuning.disable_crc_hint': 'CRCチェックサムを無効化。エラー検出を犠牲にサイクルを節約',
      'gpu_tuning.disable_idvs': 'IDVS無効化',
      'gpu_tuning.disable_idvs_hint': 'Index-Driven Vertex Shadingを無効化。⚠ ジオメトリスループット低下',
      'gpu_tuning.prerotate': 'プリローテーション',
      'gpu_tuning.prerotate_hint': '横向きアプリのサーフェスプリローテーションを有効化。コンポジションコスト低減の可能性',

      /* CPU Tuning */
      'cpu_tuning.title': 'CPUチューニング · ドライバ',
      'cpu_tuning.governor_section': 'ガバナー (sugov_ext)',
      'cpu_tuning.up_rate_limit': 'アップレートリミット',
      'cpu_tuning.up_rate_limit_hint': '周波数スケールアップ前の遅延 (µs)。低い = 高速なランプアップ',
      'cpu_tuning.down_rate_limit': 'ダウンレートリミット',
      'cpu_tuning.down_rate_limit_hint': '周波数スケールダウン前の遅延 (µs)。高い = 高周波数を長く維持',
      'cpu_tuning.idle_section': 'CPUアイドル',
      'cpu_tuning.cpuidle_max_state': '最大アイドルステート',
      'cpu_tuning.cpuidle_max_state_hint': '許可される最深アイドル状態。低い = 低レイテンシ、高消費電力',
      'cpu_tuning.sched_section': 'スケジューラ',
      'cpu_tuning.energy_aware': 'エナジーアウェアスケジューリング',
      'cpu_tuning.energy_aware_hint': 'EAS: 省電力と性能のバランス。OFF = 純粋な性能優先スケジューリング',
      'cpu_tuning.child_runs_first': 'チャイルドランファースト',
      'cpu_tuning.child_runs_first_hint': 'fork後の子プロセスを親より先に実行。アプリ起動速度改善の可能性',
      'cpu_tuning.uclamp_min': 'Uclamp Top-App 最小値',
      'cpu_tuning.uclamp_min_hint': 'フォアグラウンドアプリの最小利用率クランプ (0-1024)。高い = 高周波数を強制',
      'cpu_tuning.fpsgo_section': 'FPSGO (フレームブースト)',
      'cpu_tuning.fpsgo_boost_ta': 'タッチアクセラレーションブースト',
      'cpu_tuning.fpsgo_boost_ta_hint': 'FPSGOによるタッチ加速ブースト有効化。タッチ時にCPUをブースト',
      'cpu_tuning.fpsgo_rescue': 'レスキューモード',
      'cpu_tuning.fpsgo_rescue_hint': 'フレームドロップ直前の緊急周波数ブースト',

      /* Display Tuning */
      'tab.display': 'ディスプレイ',
      'display.title': 'ディスプレイチューニング · MTKDEV',
      'display.refresh_section': 'リフレッシュレート',
      'display.refresh_mode': 'モード',
      'display.refresh_mode_hint': '固定はリフレッシュレートをロック。可変はタッチ時にピークで動作しアイドルで最小に降下（モード切替は再起動が必要）',
      'display.mode_fixed': '固定',
      'display.mode_adaptive': '可変',
      'display.fixed_rr_hint': 'リフレッシュレート固定（最大 = 最小）',
      'display.adaptive_peak_hint': 'タッチ/アニメーション時の最大リフレッシュレート',
      'display.adaptive_min_hint': 'アイドル時のリフレッシュレート下限（90 / 120 Hz）。OEM制約により60Hzは可変モードで使用不可',
      'display.peak_rr': '最大リフレッシュレート',
      'display.peak_rr_hint': 'ディスプレイの最大リフレッシュレート。高い = 滑らか、消費電力増',
      'display.min_rr': '最小リフレッシュレート',
      'display.min_rr_hint': '最小リフレッシュレート下限。最大と同じ = 固定',
      'display.animation_section': 'アニメーション',
      'display.animator': 'アニメーター速度',
      'display.animator_hint': 'アニメーション速度係数。0 = 無効、0.5 = 高速、1.0 = 通常',
      'display.transition': '画面遷移速度',
      'display.transition_hint': 'Activity遷移アニメーション速度。0 = 無効',
      'display.window': 'ウィンドウ速度',
      'display.window_hint': 'ウィンドウアニメーション速度。0 = 無効',
      'display.pq_section': '画質 (MTK PQ)',
      'display.color_sat': '色彩強度',
      'display.color_sat_hint': 'SurfaceFlinger色彩強度。1.0 = ネイティブ、高い = より鮮やか',
      'display.sharpness': 'シャープネス',
      'display.sharpness_hint': 'MTKディスプレイシャープネスレベル',
      'display.shp_low': '低',
      'display.shp_mid': '中',
      'display.shp_high': '高',
      'display.ultra_res': 'ウルトラレゾリューション',
      'display.ultra_res_hint': 'MTK超解像度アップスケーリング（動画用）',
      'display.dre': 'ダイナミックレンジ (DRE)',
      'display.dre_hint': 'ダイナミックレンジエンハンスメント — 適応的なコントラストと輝度',
      'display.hdr_adaptive': 'HDR適応TM',
      'display.hdr_adaptive_hint': 'HDR10/HDR10+コンテンツの適応トーンマッピング',
      'display.hfg': 'フィルムグレイン (HFG)',
      'display.hfg_hint': '動画にフィルム調テクスチャを追加。高い = より多いグレイン',
      'display.hfg_low': '低',
      'display.hfg_high': '高',
      'display.power_section': '電力',
      'display.idle_time': 'ディスプレイアイドル時間',
      'display.idle_time_hint': 'ディスプレイが低電力アイドルモードに入るまでの時間 (ms)。低い = 早期省電力',

      /* RAM */
      'ram.title': 'DRAM · {type}',
      'ram.data_rate': 'データレート',
      'ram.vcore': 'Vcore',
      'ram.current_freq': '現在の周波数',
      'ram.min_floor': '最小フロア',
      'ram.min_freq_floor': '最小周波数フロア',
      'ram.th.index': '#',
      'ram.th.frequency': '周波数',
      'ram.th.data_rate': 'データレート',
      'ram.active': '動作中',
      'ram.floor': 'フロア',
      'ram.no_data': 'RAMデータが読み込まれていません。',
      'ram.no_data_hint': '「再読み込み」をタップしてDRAM情報を読み込んでください。',
      'ram.info_hint': '最小周波数フロアは、DRAMを選択した周波数以上にロックします。Vcore電圧はDVFSRCによって自動管理され、DRAM OPPが高くなるほど増加します。',
      'ram.dram_min_toast': 'DRAM最小フロア → {freq}',
      'ram.dram_min_fail': 'DRAM min_freq書き込み失敗: {err}',

      /* Storage */
      'storage.title': 'UFS · ブロックデバイス',
      'storage.devs': '{n} デバイス',
      'storage.scheduler': 'スケジューラ',
      'storage.queue_depth': 'キュー深度',
      'storage.read_ahead': '先読み',
      'storage.ufs_type': 'UFSタイプ',
      'storage.block_queue_tuning': 'ブロックキュー調整',
      'storage.io_scheduler': 'I/Oスケジューラ',
      'storage.io_scheduler_hint': 'エレベータが必要; <code>none</code> = HWディスパッチ（デフォルト）',
      'storage.read_ahead_all': '先読み（全デバイス）',
      'storage.read_ahead_hint': 'シーケンシャルプリフェッチバッファ。↑ 順次読取, ↓ ランダムI/O',
      'storage.rq_affinity': 'RQアフィニティ',
      'storage.rq_affinity_hint': '完了CPUアフィニティ。2 = 同一CPU強制（最低レイテンシ）',
      'storage.io_merges': 'I/Oマージ',
      'storage.io_merges_hint': '隣接I/Oリクエストをマージ。0 = マージ（最高スループット）',
      'storage.io_stats': 'I/O統計',
      'storage.io_stats_hint': '/proc/diskstatsの収集。OFF = オーバーヘッド低減',
      'storage.entropy_feed': 'エントロピー供給',
      'storage.entropy_feed_hint': 'ディスクタイミングを/dev/randomに供給。OFF = オーバーヘッド低減',
      'storage.th.device': 'デバイス',
      'storage.th.sched': 'スケジュ',
      'storage.th.ra': '先読',
      'storage.th.queue': 'キュー',
      'storage.th.merge': 'マージ',
      'storage.th.affin': 'アフィ',
      'storage.no_data': 'ストレージデータが読み込まれていません。',
      'storage.no_data_hint': '「再読み込み」をタップしてブロックデバイス情報を読み込んでください。',
      'storage.ufs_controller': 'UFSコントローラ · ufshcd',
      'storage.write_booster': 'ライトブースタ',
      'storage.clock_gating': 'クロックゲーティング',
      'storage.clk_gate_delay': 'CLKゲート遅延',
      'storage.clk_gate_hint': 'アイドル時にUFSクロックをゲートして省電力化',
      'storage.clk_gate_delay_hint': 'クロックゲートまでのアイドル時間(ms)',
      'storage.auto_hibern8': '自動Hibernate8',
      'storage.auto_hibern8_hint': 'UFSリンクHibern8のアイドルタイマー(µs)。0 = 無効',
      'storage.rpm_lvl': 'ランタイムPMレベル',
      'storage.rpm_lvl_hint': 'ランタイムアイドル時のデバイス/リンク電源状態',
      'storage.spm_lvl': 'システムPMレベル',
      'storage.spm_lvl_hint': 'システムサスペンド時のデバイス/リンク電源状態',
      'storage.hci_address': 'HCIアドレス',
      'storage.wb_hint': 'UFS WB — SLCキャッシュを使用してバースト書込みを高速化',
      'storage.ufs_info_hint': 'UFS HCIチューニング。clkscale_enable / wb_buf_flush はこのデバイスでは書込不可。',
      'storage.info_hint': 'カーネルELF分析によるブロックキュー属性（42属性、16書込可能）。<strong style="color:var(--text-secondary)">nr_requests</strong>はアクティブなエレベータが必要（<code>none</code>でEINVALを返す）。スケジューラの切替にはカーネルサポートが必要な場合があります。',
      'storage.toast': 'ストレージ: RA={ra}K sched={sched} rqa={rqa} nom={nom}',

      /* RQ Affinity options */
      'storage.rqa.none': '0 — なし',
      'storage.rqa.group': '1 — CPUグループ',
      'storage.rqa.same': '2 — 同一CPU',

      /* Nomerges options */
      'storage.nom.merge_all': '0 — 全マージ',
      'storage.nom.no_front': '1 — フロントなし',
      'storage.nom.no_merge': '2 — マージなし',

      /* Thermal */
      'thermal.title': '温度制御',
      'thermal.off': 'オフ',
      'thermal.soft': 'ソフト',
      'thermal.hard': 'ハード',
      'thermal.throttle_mode': 'スロットルモード',
      'thermal.tap_refresh': '↻ をタップして温度を読み取り',
      'thermal.cpu_desc_off': '通常 — 標準カーネル温度管理',
      'thermal.cpu_desc_soft': 'ソフト — KPM OCのfreq_qos制限を再適用; kprobeは既に温度による周波数低下を傍受',
      'thermal.cpu_desc_hard': 'ハード — OC制限を再適用し、CPU温度冷却ステートを0にロック',
      'thermal.gpu_desc_off': '通常 — 標準カーネル温度管理',
      'thermal.gpu_desc_soft': 'ソフト — GPU devfreq冷却デバイスをステート0にロック（GPUEBスロットル注入を防止）',
      'thermal.gpu_desc_hard': 'ハード — GPUをGPUEB fix_targetで最大OPP (1900 MHz)に固定; ベンチマーク中DVFSなし',
      'thermal.gpu_fix_banner': '⚠ GPU OPPが1900 MHzに固定中 — オフに設定して「設定を適用」でDVFSを解放してください。',
      'thermal.cpu_info': '🔒 このデバイスでは、KPM OCのfreq_qos kprobeが温度による周波数低下を傍受しています。ソフト/ハードはOC制限を再適用し、CPU冷却ステートのロックを試みます。再起動でカーネルデフォルトに復元されます。',
      'thermal.gpu_info': '🔒 ソフト: GPU devfreq冷却デバイスをステート0にロック — GPUEBの温度スロットル注入を防止。ハード: 追加でGPUをOPP0 (1900 MHz)に固定し全DVFSをバイパス。ベンチマーク用。オフ + 適用で復元。',
      'thermal.toast': '温度制御: {details}',
      'thermal.cpu_restamped': 'CPU OC再適用',
      'thermal.cooling_locked': '+冷却ロック',
      'thermal.gpu_cdevs_locked': 'GPU冷却デバイスロック',
      'thermal.gpu_opp_pinned': 'GPU OPPを1900 MHzに固定',
      'thermal.gpu_pin_released': 'GPU固定解除',

      /* Profile */
      'profile.power_mode': '電力モード',
      'profile.mode_warning': '⚠ モード切替によりCPUスケーリング制限、DRAMフロア、温度設定が更新されます。<strong>設定を適用</strong>をタップして有効にしてください。',
      'profile.auto_gaming': 'オートゲーミングモード',
      'profile.gaming_boost_active': '🎮 ゲーミングブースト作動中: {app}',
      'profile.monitoring': '👁 フォアグラウンドアプリを監視中...',
      'profile.gaming_idle': '⏸ オートゲーミング有効 — 適用で開始',
      'profile.gaming_desc': '選択したアプリがフォアグラウンドの時、自動的にパフォーマンスOCが適用されます。全電力モードで動作します。WebUI終了後もバックグラウンドデーモンが監視を続けます。',
      'profile.gaming_apps': 'ゲーミングアプリ ({n})',
      'profile.no_apps_selected': 'アプリ未選択',
      'profile.installed_apps': 'インストール済みアプリ',
      'profile.search_apps': 'アプリを検索...',
      'profile.loading_apps': 'インストール済みアプリを読み込み中...',
      'profile.no_apps_found': 'アプリが見つかりません',
      'profile.apps_count': '{total} アプリ · {selected} 選択中',

      /* Power presets */
      'preset.battery_save': 'バッテリーセーブ',
      'preset.battery_desc': 'クロック低減 · バッテリー寿命最大',
      'preset.normal': 'ノーマル',
      'preset.normal_desc': '設定通りのOC · バランス型',
      'preset.performance': 'パフォーマンス',
      'preset.performance_desc': '最大OC · 温度制御 · DRAM最大',

      /* Toast / status messages */
      'toast.applying': '設定を適用中...',
      'toast.loading': 'OPPデータを読み込み中...',
      'toast.reloading': 'OPPデータを再読み込み中...',
      'toast.loaded': '読込完了: CPU {cpu} OPPs, GPU {gpu} OPPs, RAM {ram} OPPs',
      'toast.applied_saved': '適用・保存完了！ {details}',
      'toast.saved': '設定を保存しました！',
      'toast.error': 'エラー: {label} — {err}',
      'toast.invalid_value': '無効な値です',
      'toast.invalid_freq': '無効な周波数です',
      'toast.invalid_volt': '無効な電圧です',
      'toast.gaming_boost_on': '🎮 ゲーミングブースト: {app}',
      'toast.gaming_boost_off': 'ゲーミングブースト終了 — 復元中',

      /* Misc */
      'misc.restore': '復元',
      'misc.remove': '削除',
      'misc.on': 'ON',
      'misc.off': 'OFF',
      'misc.na': 'N/A',
      'misc.lang': '言語',
    },
  };

  /* ─── Available Languages ────────────────────────────────────────── */
  const availableLanguages = [
    { code: 'en', label: 'English',  flag: '🇺🇸' },
    { code: 'ja', label: '日本語',   flag: '🇯🇵' },
  ];

  /* ─── Current Language ───────────────────────────────────────────── */
  let currentLang = DEFAULT_LANG;

  function detectLanguage() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && translations[saved]) return saved;
    const nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
    if (nav.startsWith('ja')) return 'ja';
    return DEFAULT_LANG;
  }

  currentLang = detectLanguage();

  /* ─── Translation Function ──────────────────────────────────────── */

  /**
   * t(key, params) — Translate key with optional interpolation.
   *   t('cpu.opps', { n: 5 })  →  "5 OPPs"
   *   t('header.title')        →  "OC Manager"
   */
  function t(key, params) {
    const dict = translations[currentLang] || translations[DEFAULT_LANG];
    let str = dict[key];
    if (str === undefined) {
      const fallback = translations[DEFAULT_LANG];
      str = fallback[key];
    }
    if (str === undefined) return key; // key itself as fallback
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
      }
    }
    return str;
  }

  /* ─── Language Setter ───────────────────────────────────────────── */
  function setLanguage(lang) {
    if (!translations[lang]) return;
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }

  function getLanguage() {
    return currentLang;
  }

  function getAvailableLanguages() {
    return availableLanguages;
  }

  /* ─── Public API ─────────────────────────────────────────────────── */
  window.I18n = {
    t,
    setLanguage,
    getLanguage,
    getAvailableLanguages,
  };

})();
