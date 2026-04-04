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
      'storage.hci_address': 'HCI Address',
      'storage.wb_hint': 'UFS WB — accelerates burst writes using SLC cache',
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
      'storage.hci_address': 'HCIアドレス',
      'storage.wb_hint': 'UFS WB — SLCキャッシュを使用してバースト書込みを高速化',
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
