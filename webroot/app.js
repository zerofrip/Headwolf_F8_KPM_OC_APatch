/* ═══════════════════════════════════════════════════════════════════════
   KPM OC Manager v7.6 — Application Logic
   Headwolf F8 · Dimensity 8300 (MT8792 / MT6897)
   CPU: CSRAM LUT via kpm_oc.ko (mtk-cpufreq-hw domains)
   GPU: /proc/gpufreqv2 interface
   Storage: UFS block queue + ufshcd controller tuning
   ═══════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  /* ─── Constants ───────────────────────────────────────────────────── */
  const KS_PARAMS = '/sys/module/kpm_oc/parameters/';
  const CONFIG_DIR = '/data/adb/modules/f8_kpm_oc_manager';
  const CONF_DIR = `${CONFIG_DIR}/conf`;
  const CONF_CPU_OC = `${CONF_DIR}/cpu_oc.json`;
  const CONF_GPU_OC = `${CONF_DIR}/gpu_oc.json`;
  const CONF_GPU_TUNING = `${CONF_DIR}/gpu_tuning.json`;
  const CONF_CPU_TUNING = `${CONF_DIR}/cpu_tuning.json`;
  const CONF_DISPLAY = `${CONF_DIR}/display_tuning.json`;
  const CONF_CPU_SCALING = `${CONF_DIR}/cpu_scaling.json`;
  const CONF_DRAM = `${CONF_DIR}/dram.json`;
  const CONF_IO = `${CONF_DIR}/io.json`;
  const CONF_UFS = `${CONF_DIR}/ufs.json`;
  const CONF_THERMAL = `${CONF_DIR}/thermal.json`;
  const CONF_PROFILE = `${CONF_DIR}/profile.json`;
  const CPU_OPP_FILE = `${CONFIG_DIR}/cpu_opp_table`;
  const GPU_OPP_FILE = `${CONFIG_DIR}/gpu_opp_table`;
  const GPU_DEVFREQ_PATH_FILE = `${CONFIG_DIR}/gpu_devfreq_path`;
  const GPU_DEVFREQ_FALLBACK = '/sys/class/devfreq/13000000.mali';
  const MALI_SYSFS = '/sys/devices/platform/soc/13000000.mali';
  const DRAM_DEVFREQ = '/sys/class/devfreq/mtk-dvfsrc-devfreq';
  const DRAM_DATA_RATE = '/sys/bus/platform/drivers/dramc_drv/dram_data_rate';
  const DRAM_TYPE_PATH = '/sys/bus/platform/drivers/dramc_drv/dram_type';
  const VCORE_UV_PATH = '/sys/class/regulator/regulator.74/microvolts';
  const IO_BLOCK_DEVS = ['sda', 'sdb', 'sdc'];   // UFS namespaces
  const IO_READ_AHEAD_OPTIONS = [128, 256, 512, 1024, 2048];
  const IO_SCHEDULER_OPTIONS = ['none', 'mq-deadline', 'kyber', 'bfq'];
  const IO_RQ_AFFINITY_OPTIONS = [
    { value: 0, labelKey: 'storage.rqa.none' },
    { value: 1, labelKey: 'storage.rqa.group' },
    { value: 2, labelKey: 'storage.rqa.same' },
  ];
  const IO_NOMERGES_OPTIONS = [
    { value: 0, labelKey: 'storage.nom.merge_all' },
    { value: 1, labelKey: 'storage.nom.no_front' },
    { value: 2, labelKey: 'storage.nom.no_merge' },
  ];
  const UFS_HCI_GLOB = '/sys/devices/platform/soc/112b0000.ufshci';  // MT6897 primary UFSHCI

  const CPU_POLICIES = [0, 4, 7];
  const CLUSTER_NAMES = { 0: 'LITTLE (0-3)', 4: 'big (4-6)', 7: 'PRIME (7)' };
  const CLUSTER_CORES = { 0: 'Cortex-A520', 4: 'Cortex-A720', 7: 'Cortex-A720' };

  /* i18n shorthand */
  const t = window.I18n.t;

  const POWER_PRESETS = []; // legacy — kept for compat; governor-based profiles replace these

  const GOVERNOR_ICONS = {
    schedutil: '⚡', performance: '🚀', powersave: '🔋', ondemand: '📊',
    conservative: '🛡️', userspace: '🎛️',
  };
  const GOVERNOR_DEFAULT_PROFILE = {
    cpu_oc_l_freq: 3800000, cpu_oc_l_volt: 1050000,
    cpu_oc_b_freq: 3800000, cpu_oc_b_volt: 1100000,
    cpu_oc_p_freq: 4000000, cpu_oc_p_volt: 1150000,
    cpu_max_0: 3800000, cpu_min_0: 480000,
    cpu_max_4: 3800000, cpu_min_4: 400000,
    cpu_max_7: 4000000, cpu_min_7: 400000,
    dram_min: 0,
    cpu_thermal: 0, gpu_thermal: 0,
  };

  /* ─── State ───────────────────────────────────────────────────────── */
  const state = {
    activeTab: 'cpu',
    moduleLoaded: false,
    cpuClusters: [],
    gpuEntries: [],
    originalCpu: [],
    originalGpu: [],
    ram: {
      dataRate: 0,          // MHz (from dramc driver)
      dramType: '',         // e.g. "LPDDR5X"
      vcoreUv: 0,           // µV
      curFreq: 0,           // Hz (devfreq)
      minFreq: 0,           // Hz (devfreq)
      maxFreq: 0,           // Hz (devfreq)
      availableFreqs: [],   // Hz array
      governor: '',
      selectedMinFreq: 0,   // user selection (Hz)
    },
    originalRamMinFreq: 0,
    storage: {
      devices: [],       // [{ name, scheduler, readAheadKb, nrRequests, nomerges, rqAffinity, iostats, addRandom }]
      readAheadKb: 2048, // user-selected value (applied to all devices)
      scheduler: 'none', // user-selected scheduler
      nomerges: 0,       // 0=merge, 1=no front, 2=no merge
      rqAffinity: 2,     // 0=none, 1=group, 2=same CPU
      iostats: 1,        // 0=off, 1=on
      addRandom: 0,      // 0=off, 1=on
      // UFS controller (ufshcd)
      wbOn: -1,          // Write Booster (-1=unknown, 0=off, 1=on)
      clkgateEnable: -1, // Clock gating (-1=unknown, 0=off, 1=on)
      clkgateDelay: 0,   // Clock gating delay (ms)
      autoHibern8: -1,   // Auto Hibernate8 timer µs (-1=unknown, 0=off)
      rpmLvl: -1,        // Runtime PM level (-1=unknown, 0-5)
      spmLvl: -1,        // System PM level (-1=unknown, 0-5)
      ufsHciPath: '',    // resolved ufshci sysfs path
      ufsVersion: '',    // e.g. "UFS 4.0" (read from device_descriptor/specification_version)
    },
    thermal: {
      cpuMode: 0,       // 0=off, 1=soft (trip +15°C), 2=hard (trip +30°C + lock cdevs)
      gpuMode: 0,       // 0=off, 1=soft (lock GPU cdevs), 2=hard (pin OPP0 via fix_target)
      temps: {},        // { zone_type_string: temp_celsius }
      gpuFixActive: false,    // true when fix_target_opp_index=0 is held
      cpuOrigTrips: [], // [{path, origTemp}] — captured on first loadThermalData for undo
    },
    gpuTuning: {
      dvfsPeriod: 100,          // ms (stock: 100)
      idleHysteresis: 5000,     // ms (stock: 5000)
      shaderPwroff: 800,        // ms (stock: 800)
      powerPolicy: 'coarse_demand',
      csgPeriod: 100,           // ms (stock: 100)
      vulkanHwui: 0,            // 0=off, 1=on
      vulkanRenderengine: 0,    // 0=off, 1=on
      maliDriver: {             // MALI_PLATFORM_CONFIG / vendor.mali.* keys
        cmarOptimizeForLatency: 0,  // bool: render manager latency opt
        glesDisableShaderLto: 0,    // bool: disable shader LTO
        glesDisablePilotShaders: 0, // bool: disable pilot shaders
        glesDisableGraphicsPipelineCache: 0, // bool: disable pipeline cache
        glesDisableSubpassCache: 0, // bool: disable subpass cache
        schedRtThreadPriority: 0,   // int: RT thread priority (0=default)
        optimizationLevel: 0,       // int: compiler opt level (0=default)
        glesDisableSurfaceAfbc: 0,  // bool: disable surface AFBC
        glesDisableTextureAfbc: 0,  // bool: disable texture AFBC
        glesDisableCrc: 0,          // bool: disable CRC
        glesDisableIdvs: 0,         // bool: disable IDVS
        maliPrerotate: 0,           // bool: enable pre-rotation
      },
      loaded: false,            // true after first read from device
    },
    cpuTuning: {
      sugovUpRate: 1000,        // µs (stock: 1000)
      sugovDownRate: 1000,      // µs (stock: 1000)
      cpuidleMaxState: 6,       // 0-6 (stock: 6 = all states enabled)
      schedEnergyAware: 1,      // 0=off, 1=on (stock: 1)
      schedChildRunsFirst: 0,   // 0=off, 1=on (stock: 0)
      uclampTopAppMin: 0,       // 0-1024 (stock: 0)
      fpsgoBoostTa: 0,          // 0=off, 1=on (stock: 0)
      fpsgoRescueEnable: 0,     // 0=off, 1=on (stock: 0)
      loaded: false,
    },
    displayTuning: {
      refreshMode: 'fixed',     // 'fixed' | 'adaptive'
      peakRefreshRate: 144,     // 60/90/120/144
      minRefreshRate: 144,      // 60/90/120/144 (auto-derived in adaptive mode)
      animatorDuration: 1.0,    // 0/0.5/1.0
      transitionDuration: 1.0,  // 0/0.5/1.0
      windowDuration: 1.0,      // 0/0.5/1.0
      colorSaturation: 1.1,     // 0.8-1.3
      sharpnessIdx: 2,          // 0-3
      ultraResolution: 1,       // 0=off, 1=on
      dreEnable: 1,             // 0=off, 1=on
      hdrAdaptive: 1,           // 0=off, 1=on
      hfgLevel: 2,              // 0/1/2
      displayIdleTime: 33,      // ms
      loaded: false,
    },
    profile: {
      governor: 'schedutil',
      availableGovernors: [],
      governorProfiles: {},   // { "schedutil": {...}, "performance": {...} }
      autoGaming: {
        enabled: false,
        apps: [],         // selected gaming app package names
        allApps: [],      // [{pkg, label}] all installed 3rd-party apps
        iconMap: {},      // { pkg: base64_png_string }
        loading: false,
        activeApp: '',    // current foreground package
        boosted: false,   // currently in gaming boost
        pollTimer: null,  // setInterval ID
        _selectorVisible: false,
        _searchQuery: '',
      },
    },
  };

  /* ─── Shell Command Execution ─────────────────────────────────────── */
  let _execCounter = 0;
  async function exec(cmd) {
    return new Promise((resolve, reject) => {
      if (typeof ksu !== 'undefined' && ksu.exec) {
        const cbName = `_ksu_exec_cb_${Date.now()}_${_execCounter++}`;
        window[cbName] = (errno, stdout, stderr) => {
          delete window[cbName];
          resolve({ errno: errno || 0, stdout: stdout || '', stderr: stderr || '' });
        };
        try {
          ksu.exec(cmd, '{}', cbName);
        } catch (e) {
          delete window[cbName];
          resolve({ errno: -1, stdout: '', stderr: e.message || '' });
        }
      } else {
        console.log('[MOCK] exec:', cmd);
        resolve(getMockResponse(cmd));
      }
    });
  }

  /* ─── Mock Data for Desktop Preview ───────────────────────────────── */
  function getMockResponse(cmd) {
    if (cmd.includes('opp_table') || cmd.includes('cpu_opp_table')) {
      return {
        errno: 0,
        stdout: 'CPU:0:480000:500000|CPU:0:600000:525000|CPU:0:700000:550000|CPU:0:1200000:612500|CPU:0:1600000:687500|CPU:0:2000000:793750|CPU:0:2200000:806250|CPU:4:400000:500000|CPU:4:800000:568750|CPU:4:1400000:668750|CPU:4:2000000:768750|CPU:4:2600000:856250|CPU:4:3200000:1006250|CPU:7:400000:487500|CPU:7:800000:550000|CPU:7:1400000:631250|CPU:7:2000000:731250|CPU:7:2800000:900000|CPU:7:3350000:1037500',
        stderr: ''
      };
    }
    if (cmd.includes('gpu_working_opp_table') || cmd.includes('gpu_opp_table')) {
      return {
        errno: 0,
        stdout: '[00] freq: 265000, volt: 57500, vsram: 75000\n[01] freq: 350000, volt: 60000, vsram: 75000\n[02] freq: 480000, volt: 63125, vsram: 75000\n[03] freq: 650000, volt: 68750, vsram: 75000\n[04] freq: 850000, volt: 75000, vsram: 75000\n[05] freq: 1000000, volt: 78125, vsram: 78125\n[06] freq: 1200000, volt: 81875, vsram: 81875\n[07] freq: 1400000, volt: 87500, vsram: 87500',
        stderr: ''
      };
    }
    if (cmd.includes('scaling_available_frequencies') && cmd.includes('policy0')) {
      return { errno: 0, stdout: '480000 650000 850000 1000000 1200000 1400000 1600000 1800000 2000000 2200000', stderr: '' };
    }
    if (cmd.includes('scaling_available_frequencies') && cmd.includes('policy4')) {
      return { errno: 0, stdout: '400000 550000 725000 850000 1000000 1200000 1400000 1600000 1800000 2000000 2200000 2400000 2600000 2800000 3000000 3200000', stderr: '' };
    }
    if (cmd.includes('scaling_available_frequencies') && cmd.includes('policy7')) {
      return { errno: 0, stdout: '400000 550000 725000 850000 1000000 1200000 1400000 1600000 1800000 2000000 2200000 2400000 2600000 2800000 3000000 3200000 3350000', stderr: '' };
    }
    if (cmd.includes('scaling_max_freq') && !cmd.includes('echo')) {
      if (cmd.includes('policy0')) return { errno: 0, stdout: '2200000', stderr: '' };
      if (cmd.includes('policy4')) return { errno: 0, stdout: '3200000', stderr: '' };
      if (cmd.includes('policy7')) return { errno: 0, stdout: '3350000', stderr: '' };
    }
    if (cmd.includes('scaling_min_freq') && !cmd.includes('echo')) {
      return { errno: 0, stdout: '400000', stderr: '' };
    }
    if (cmd.includes('lsmod') && cmd.includes('kpm_oc')) {
      return { errno: 0, stdout: 'kpm_oc 16384 0', stderr: '' };
    }
    if (cmd.includes('mtk-dvfsrc-devfreq/available_frequencies')) {
      return { errno: 0, stdout: '800000000 1600000000 1866000000 2133000000 3094000000 4100000000 5500000000 6400000000', stderr: '' };
    }
    if (cmd.includes('mtk-dvfsrc-devfreq/cur_freq')) {
      return { errno: 0, stdout: '6400000000', stderr: '' };
    }
    if (cmd.includes('mtk-dvfsrc-devfreq/min_freq')) {
      return { errno: 0, stdout: '800000000', stderr: '' };
    }
    if (cmd.includes('mtk-dvfsrc-devfreq/max_freq') && !cmd.includes('mali')) {
      return { errno: 0, stdout: '6400000000', stderr: '' };
    }
    if (cmd.includes('mtk-dvfsrc-devfreq/governor')) {
      return { errno: 0, stdout: 'userspace', stderr: '' };
    }
    if (cmd.includes('dram_data_rate')) {
      return { errno: 0, stdout: 'DRAM data rate = 6400', stderr: '' };
    }
    if (cmd.includes('dram_type')) {
      return { errno: 0, stdout: 'DRAM tpye = 8', stderr: '' };
    }
    if (cmd.includes('regulator.74/microvolts')) {
      return { errno: 0, stdout: '725000', stderr: '' };
    }
    /* Mock: block queue attributes */
    if (cmd.includes('/queue/scheduler')) {
      return { errno: 0, stdout: '[none] mq-deadline kyber bfq', stderr: '' };
    }
    if (cmd.includes('/queue/nomerges')) {
      return { errno: 0, stdout: '0', stderr: '' };
    }
    if (cmd.includes('/queue/rq_affinity')) {
      return { errno: 0, stdout: '2', stderr: '' };
    }
    if (cmd.includes('/queue/iostats')) {
      return { errno: 0, stdout: '1', stderr: '' };
    }
    if (cmd.includes('/queue/add_random')) {
      return { errno: 0, stdout: '0', stderr: '' };
    }
    if (cmd.includes('/queue/read_ahead_kb')) {
      return { errno: 0, stdout: '2048', stderr: '' };
    }
    if (cmd.includes('/queue/nr_requests')) {
      return { errno: 0, stdout: '63', stderr: '' };
    }
    /* Mock: UFS HCI attributes */
    if (cmd.includes('wb_on')) {
      return { errno: 0, stdout: '1', stderr: '' };
    }
    if (cmd.includes('clkgate_enable')) {
      return { errno: 0, stdout: '1', stderr: '' };
    }
    if (cmd.includes('clkgate_delay')) {
      return { errno: 0, stdout: '150', stderr: '' };
    }
    if (cmd.includes('11270000.ufshci')) {
      return { errno: 0, stdout: '/sys/devices/platform/11270000.ufshci', stderr: '' };
    }
    if (cmd.includes('thermal_zone') || cmd.includes('/thermal/')) {
      return {
        errno: 0,
        stdout: [
          'Z|cpu-thermal|62000',
          'Z|mtk-cpu-tz|68000',
          'Z|gpu-thermal|55000',
          'Z|battery-thermal|34000',
          'T|/sys/class/thermal/thermal_zone0/trip_point_0_temp|85000',
          'T|/sys/class/thermal/thermal_zone0/trip_point_1_temp|95000',
          'T|/sys/class/thermal/thermal_zone0/trip_point_2_temp|100000',
        ].join('\n'),
        stderr: '',
      };
    }
    if (cmd.includes('pm list packages -3')) {
      return {
        errno: 0,
        stdout: 'package:com.miHoYo.GenshinImpact\npackage:com.tencent.ig\npackage:com.supercell.clashofclans\npackage:com.activision.callofduty.shooter\npackage:com.garena.game.codm\npackage:com.innersloth.spacemafia\npackage:com.mojang.minecraftpe\npackage:com.roblox.client\npackage:com.mobile.legends\njp.naver.line.android\npackage:com.twitter.android\npackage:com.instagram.android\npackage:com.spotify.music',
        stderr: '',
      };
    }
    if (cmd.includes('IconExtractor -l')) {
      return {
        errno: 0,
        stdout: 'com.miHoYo.GenshinImpact|原神\ncom.tencent.ig|PUBG Mobile\ncom.supercell.clashofclans|クラッシュ・オブ・クラン\ncom.activision.callofduty.shooter|Call of Duty Mobile\ncom.garena.game.codm|COD Mobile Garena\ncom.innersloth.spacemafia|Among Us\ncom.mojang.minecraftpe|Minecraft\ncom.roblox.client|Roblox\ncom.mobile.legends|Mobile Legends\njp.naver.line.android|LINE\ncom.twitter.android|Twitter\ncom.instagram.android|Instagram\ncom.spotify.music|Spotify',
        stderr: '',
      };
    }
    if (cmd.includes('ResumedActivity') || cmd.includes('mCurrentFocus')) {
      return { errno: 0, stdout: 'com.android.launcher3', stderr: '' };
    }
    if (cmd.includes('IconExtractor')) {
      // Mock: return empty (icons not available in mock mode)
      return { errno: 0, stdout: '', stderr: '' };
    }
    return { errno: 0, stdout: '', stderr: '' };
  }

  /* ─── Data Parsing ────────────────────────────────────────────────── */

  /*
   * CPU OPP format from kpm_oc.ko v3.2:
   *   CPU:<policy>:<freq_khz>:<volt_uv>|...
   * Voltage is decoded in the kernel module from CSRAM LUT:
   *   volt_uv = ((raw32 & 0x9FFFFFFF) >> 12) * 10
   */
  function parseCpuOppTable(raw) {
    const cpuMap = new Map();
    const entries = raw.trim().split('|').filter(s => s.length > 0);

    for (const entry of entries) {
      const parts = entry.split(':');
      if (parts.length !== 4 || parts[0] !== 'CPU') continue;

      const policy = parseInt(parts[1], 10);
      const freq = parseInt(parts[2], 10);   // KHz
      const volt = parseInt(parts[3], 10);   // µV

      if (isNaN(freq) || freq <= 0) continue;

      if (!cpuMap.has(policy)) cpuMap.set(policy, []);
      cpuMap.get(policy).push({
        freq, volt: volt || 0,
        origFreq: freq, origVolt: volt || 0,
        modified: false, isNew: false, removing: false,
      });
    }

    for (const [policy, list] of cpuMap) {
      list.sort((a, b) => a.freq - b.freq);
      /* Deduplicate by frequency — can happen when OC patches LUT[0] to
       * an existing freq (e.g. after deleting the top OPP entry).
       * Keep the entry with the higher voltage (the OC-patched one). */
      const deduped = [];
      const seenFreq = new Set();
      for (const e of list) {
        if (seenFreq.has(e.freq)) {
          const prev = deduped.find(d => d.freq === e.freq);
          if (prev && e.volt > prev.volt) {
            Object.assign(prev, e);
          }
          continue;
        }
        seenFreq.add(e.freq);
        deduped.push(e);
      }
      cpuMap.set(policy, deduped);
    }
    return cpuMap;
  }

  function parseGpuOppTable(raw) {
    const entries = [];
    const lines = raw.trim().split('\n');

    let kernelIdx = 0;
    for (const line of lines) {
      const m = line.match(/freq:\s*(\d+),\s*volt:\s*(\d+)(?:,\s*vsram:\s*(\d+))?/);
      if (!m) continue;

      const freq = parseInt(m[1], 10);     // KHz
      const volt = parseInt(m[2], 10);     // gpufreqv2 step (×10 = µV)
      const vsram = m[3] ? parseInt(m[3], 10) : 0;

      entries.push({
        freq,
        volt: volt * 10,       // Convert to µV
        vsram: vsram * 10,     // Convert to µV
        origFreq: freq,
        origVolt: volt * 10,
        kernelIdx: kernelIdx,  // OPP index in kernel table (descending order)
        modified: false, isNew: false, removing: false,
      });
      kernelIdx++;
    }

    entries.sort((a, b) => a.freq - b.freq);
    /* Deduplicate by frequency — can happen when GPU OC patches OPP[0] to
     * an existing freq (e.g. after deleting the top OPP entry).
     * Keep the entry with the lower kernelIdx (closer to OPP[0]). */
    const deduped = [];
    const seenFreq = new Set();
    for (const e of entries) {
      if (seenFreq.has(e.freq)) continue;
      seenFreq.add(e.freq);
      deduped.push(e);
    }
    return deduped;
  }

  function parseGpuPreParsed(raw) {
    const entries = [];
    const items = raw.trim().split('|').filter(s => s.length > 0);
    let kernelIdx = 0;
    for (const item of items) {
      const parts = item.split(':');
      if (parts.length !== 4 || parts[0] !== 'GPU') continue;
      const freq = parseInt(parts[2], 10);
      const volt = parseInt(parts[3], 10);
      if (isNaN(freq) || isNaN(volt)) continue;
      entries.push({
        freq, volt, vsram: 0,
        origFreq: freq, origVolt: volt,
        kernelIdx: kernelIdx,  // OPP index in kernel table (descending order)
        modified: false, isNew: false, removing: false,
      });
      kernelIdx++;
    }
    entries.sort((a, b) => a.freq - b.freq);
    /* Deduplicate by frequency (same as parseGpuOppTable) */
    const deduped = [];
    const seenFreq = new Set();
    for (const e of entries) {
      if (seenFreq.has(e.freq)) continue;
      seenFreq.add(e.freq);
      deduped.push(e);
    }
    return deduped;
  }

  /* ─── Format Helpers ──────────────────────────────────────────────── */
  function formatFreqKHz(khz) {
    if (khz >= 1000000) return (khz / 1000000).toFixed(2) + ' GHz';
    if (khz >= 1000) return (khz / 1000).toFixed(0) + ' MHz';
    return khz + ' KHz';
  }

  function formatFreqHz(hz) {
    if (hz >= 1000000000) return (hz / 1000000).toFixed(0) + ' MHz';
    if (hz >= 1000000) return (hz / 1000000).toFixed(0) + ' MHz';
    return hz + ' Hz';
  }

  function formatVoltUv(uv) {
    if (!uv || uv === 0) return '—';
    if (uv >= 1000000) return (uv / 1000000).toFixed(4) + ' V';
    return (uv / 1000).toFixed(2) + ' mV';
  }

  const DRAM_TYPE_MAP = {
    0: 'Unknown', 5: 'LPDDR4', 6: 'LPDDR4X', 7: 'LPDDR5', 8: 'LPDDR5X',
  };

  /* ─── Toast Notifications ─────────────────────────────────────────── */
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = { success: '✓', error: '✗', info: 'ℹ' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /* ─── Tab Navigation ──────────────────────────────────────────────── */
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (tab === state.activeTab) return;
        state.activeTab = tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
        const target = document.querySelector(`.tab-content[data-tab="${tab}"]`);
        if (target) target.classList.add('active');
      });
    });
  }

  /* ─── Render CPU Cluster Card ─────────────────────────────────────── */
  function renderCpuCluster(cluster) {
    const name = CLUSTER_NAMES[cluster.id] || `Policy ${cluster.id}`;
    const core = CLUSTER_CORES[cluster.id] || '';
    const entries = cluster.entries;
    const activeEntries = entries.filter(e => !e.removing);
    const maxFreq = activeEntries.length > 0 ? Math.max(...activeEntries.map(e => e.freq)) : 0;
    const maxFreqStr = maxFreq > 0 ? formatFreqKHz(maxFreq) : '—';

    const freqOptions = (cluster.freqs || []).map(f =>
      `<option value="${f}">${formatFreqKHz(f)}</option>`
    ).join('');

    let html = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span class="icon">⚡</span>
            ${t('cpu.cluster_title', { name })}
            <span style="font-size:0.75rem;color:var(--text-muted);margin-left:4px">${core}</span>
          </div>
          <div>
            <span class="card-badge cpu">${t('cpu.opps', { n: entries.length })}</span>
            <span class="info-chip freq" style="margin-left:4px">${t('cpu.max_label', { freq: maxFreqStr })}</span>
          </div>
        </div>

        <div class="config-row">
          <div><div class="config-label">${t('cpu.max_freq')}</div></div>
          <select class="config-input freq-limit-select" id="cpu-max-freq-${cluster.id}"
                  data-policy="${cluster.id}" data-type="max">
            ${freqOptions}
          </select>
        </div>
        <div class="config-row">
          <div><div class="config-label">${t('cpu.min_freq')}</div></div>
          <select class="config-input freq-limit-select" id="cpu-min-freq-${cluster.id}"
                  data-policy="${cluster.id}" data-type="min">
            ${freqOptions}
          </select>
        </div>

        <div class="opp-table-wrapper">
          <table class="opp-table">
            <thead>
              <tr>
                <th>${t('cpu.th.index')}</th>
                <th>${t('cpu.th.freq')}</th>
                <th>${t('cpu.th.voltage')}</th>
                <th></th>
                <th style="width:60px"></th>
              </tr>
            </thead>
            <tbody>`;

    entries.forEach((entry, idx) => {
      const rowClass = entry.removing ? 'removing' :
                       entry.isNew ? 'new-entry' :
                       entry.modified ? 'modified' : '';
      const pct = maxFreq > 0 ? (entry.freq / maxFreq * 100) : 0;

      html += `
              <tr class="${rowClass}" data-idx="${idx}">
                <td><span class="cell-static" style="color:var(--text-muted)">${idx + 1}</span></td>
                <td>
                  <input type="number" class="cell-input" value="${Math.round(entry.freq / 1000)}"
                         data-field="freq" data-type="CPU" data-cluster="${cluster.id}" data-idx="${idx}"
                         data-unit="mhz"
                         onchange="window.OC.onCellChange(this)">
                  <div class="freq-bar" style="margin-top:3px">
                    <div class="freq-bar-fill cpu" style="width:${pct}%"></div>
                  </div>
                </td>
                <td>
                  <input type="number" class="cell-input" value="${entry.volt}"
                         data-field="volt" data-type="CPU" data-cluster="${cluster.id}" data-idx="${idx}"
                         onchange="window.OC.onCellChange(this)">
                </td>
                <td>
                  <div class="info-chip freq">${formatFreqKHz(entry.freq)}</div>
                  <div class="info-chip volt">${formatVoltUv(entry.volt)}</div>
                </td>
                <td>
                  <div class="row-actions">
                    ${entry.modified || entry.isNew ? `<button class="btn-icon restore" title="${t('misc.restore')}" onclick="window.OC.restoreRow('CPU', ${cluster.id}, ${idx})">↩</button>` : ''}
                    <button class="btn-icon danger" title="${t('misc.remove')}" onclick="window.OC.removeRow('CPU', ${cluster.id}, ${idx})">✕</button>
                  </div>
                </td>
              </tr>`;
    });

    html += `
            </tbody>
          </table>
        </div>

        <div id="cpu-add-form-${cluster.id}" class="add-form">
          <div class="add-form-row">
            <input type="number" class="cell-input" placeholder="${t('cpu.add_freq_placeholder')}" id="add-cpu-freq-${cluster.id}">
            <input type="number" class="cell-input" placeholder="${t('cpu.add_volt_placeholder')}" id="add-cpu-volt-${cluster.id}">
            <button class="btn btn-success btn-sm" onclick="window.OC.confirmAddEntry('CPU', ${cluster.id})">✓</button>
            <button class="btn btn-secondary btn-sm" onclick="window.OC.toggleAddForm('CPU', ${cluster.id})">✕</button>
          </div>
        </div>
        <div class="btn-group">
          <button class="btn btn-secondary btn-sm" onclick="window.OC.toggleAddForm('CPU', ${cluster.id})">
            ${t('btn.add_entry')}
          </button>
        </div>
      </div>`;

    return html;
  }

  /* ─── Render GPU Card ─────────────────────────────────────────────── */
  function renderGpuCard() {
    const entries = state.gpuEntries;
    const activeEntries = entries.filter(e => !e.removing);
    const maxFreq = activeEntries.length > 0 ? Math.max(...activeEntries.map(e => e.freq)) : 0;
    const maxFreqStr = maxFreq > 0 ? formatFreqKHz(maxFreq) : '—';

    let html = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span class="icon">🎮</span>
            ${t('gpu.title')}
          </div>
          <div>
            <span class="card-badge gpu">${t('cpu.opps', { n: entries.length })}</span>
            <span class="info-chip volt" style="margin-left:4px">${t('gpu.max_label', { freq: maxFreqStr })}</span>
          </div>
        </div>

        <div class="opp-table-wrapper">
          <table class="opp-table">
            <thead>
              <tr>
                <th>${t('gpu.th.index')}</th>
                <th>${t('gpu.th.freq')}</th>
                <th>${t('gpu.th.voltage')}</th>
                <th>${t('gpu.th.vsram')}</th>
                <th></th>
                <th style="width:60px"></th>
              </tr>
            </thead>
            <tbody>`;

    entries.forEach((entry, idx) => {
      const rowClass = entry.removing ? 'removing' :
                       entry.isNew ? 'new-entry' :
                       entry.modified ? 'modified gpu-row' : '';
      const pct = maxFreq > 0 ? (entry.freq / maxFreq * 100) : 0;

      html += `
              <tr class="${rowClass}" data-idx="${idx}">
                <td><span class="cell-static" style="color:var(--text-muted)">${idx + 1}</span></td>
                <td>
                  <input type="number" class="cell-input" value="${Math.round(entry.freq / 1000)}"
                         data-field="freq" data-type="GPU" data-cluster="0" data-idx="${idx}"
                         data-unit="mhz"
                         onchange="window.OC.onCellChange(this)">
                  <div class="freq-bar" style="margin-top:3px">
                    <div class="freq-bar-fill gpu" style="width:${pct}%"></div>
                  </div>
                </td>
                <td>
                  <input type="number" class="cell-input" value="${entry.volt}"
                         data-field="volt" data-type="GPU" data-cluster="0" data-idx="${idx}"
                         onchange="window.OC.onCellChange(this)">
                </td>
                <td>
                  <span class="cell-static" style="color:var(--text-secondary)">${entry.vsram > 0 ? formatVoltUv(entry.vsram) : '—'}</span>
                </td>
                <td>
                  <div class="info-chip freq">${formatFreqKHz(entry.freq)}</div>
                  <div class="info-chip volt">${formatVoltUv(entry.volt)}</div>
                </td>
                <td>
                  <div class="row-actions">
                    ${entry.modified || entry.isNew ? `<button class="btn-icon restore" title="${t('misc.restore')}" onclick="window.OC.restoreRow('GPU', 0, ${idx})">↩</button>` : ''}
                    <button class="btn-icon danger" title="${t('misc.remove')}" onclick="window.OC.removeRow('GPU', 0, ${idx})">✕</button>
                  </div>
                </td>
              </tr>`;
    });

    html += `
            </tbody>
          </table>
        </div>

        <div id="gpu-add-form-0" class="add-form">
          <div class="add-form-row">
            <input type="number" class="cell-input" placeholder="${t('gpu.add_freq_placeholder')}" id="add-gpu-freq-0">
            <input type="number" class="cell-input" placeholder="${t('gpu.add_volt_placeholder')}" id="add-gpu-volt-0">
            <button class="btn btn-success btn-sm" onclick="window.OC.confirmAddEntry('GPU', 0)">✓</button>
            <button class="btn btn-secondary btn-sm" onclick="window.OC.toggleAddForm('GPU', 0)">✕</button>
          </div>
        </div>
        <div class="btn-group">
          <button class="btn btn-secondary btn-sm" onclick="window.OC.toggleAddForm('GPU', 0)">
            ${t('btn.add_entry')}
          </button>
        </div>
      </div>`;

    return html;
  }

  /* ─── Render GPU Tuning Card ──────────────────────────────────────── */
  function renderGpuTuningCard() {
    const gt = state.gpuTuning;
    const STOCK = { dvfsPeriod: 100, idleHysteresis: 5000, shaderPwroff: 800, csgPeriod: 100 };

    function numRow(labelKey, hintKey, field, val, stockVal, min, max, step) {
      const isModified = val !== stockVal;
      return `
        <div class="setting-row">
          <div class="setting-label">
            <span>${t(labelKey)}</span>
            <span class="info-chip ${isModified ? 'volt' : ''}">${val} ms</span>
          </div>
          <div class="setting-hint">${t(hintKey)}</div>
          <div class="setting-control">
            <input type="range" class="slider" min="${min}" max="${max}" step="${step}"
                   value="${val}"
                   oninput="window.OC.setGpuTuning('${field}', parseInt(this.value)); this.nextElementSibling.textContent=this.value">
            <span class="slider-val">${val}</span>
            <span class="slider-label-stock">${t('gpu_tuning.stock')}: ${stockVal}</span>
          </div>
        </div>`;
    }

    const ppOptions = ['coarse_demand', 'always_on'];
    const ppHtml = ppOptions.map(pp =>
      `<button class="btn btn-sm ${gt.powerPolicy === pp ? 'btn-primary gpu-accent' : 'btn-secondary'}"
              onclick="window.OC.setGpuTuning('powerPolicy', '${pp}')">${pp}</button>`
    ).join('');

    function toggleRow(labelKey, hintKey, field, val) {
      return `
        <div class="setting-row">
          <div class="setting-label">
            <span>${t(labelKey)}</span>
          </div>
          <div class="setting-hint">${t(hintKey)}</div>
          <div class="setting-control">
            <button class="btn btn-sm ${val ? 'btn-primary gpu-accent' : 'btn-secondary'}"
                    onclick="window.OC.setGpuTuning('${field}', ${val ? 0 : 1})">
              ${val ? t('misc.on') : t('misc.off')}
            </button>
          </div>
        </div>`;
    }

    return `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title gpu">🎛️ ${t('gpu_tuning.title')}</h3>
        </div>
        <div class="card-body settings-list">
          ${numRow('gpu_tuning.dvfs_period', 'gpu_tuning.dvfs_period_hint', 'dvfsPeriod', gt.dvfsPeriod, STOCK.dvfsPeriod, 10, 200, 10)}
          ${numRow('gpu_tuning.idle_hysteresis', 'gpu_tuning.idle_hysteresis_hint', 'idleHysteresis', gt.idleHysteresis, STOCK.idleHysteresis, 1000, 50000, 1000)}
          ${numRow('gpu_tuning.shader_pwroff', 'gpu_tuning.shader_pwroff_hint', 'shaderPwroff', gt.shaderPwroff, STOCK.shaderPwroff, 100, 10000, 100)}
          <div class="setting-row">
            <div class="setting-label">
              <span>${t('gpu_tuning.power_policy')}</span>
            </div>
            <div class="setting-hint">${t('gpu_tuning.power_policy_hint')}</div>
            <div class="setting-control">
              <div class="btn-group">${ppHtml}</div>
            </div>
          </div>
          ${numRow('gpu_tuning.csg_period', 'gpu_tuning.csg_period_hint', 'csgPeriod', gt.csgPeriod, STOCK.csgPeriod, 10, 200, 10)}
          <div class="setting-divider"></div>
          <h4 class="setting-section-title">${t('gpu_tuning.mali_driver_section')}</h4>
          ${toggleRow('gpu_tuning.cmar_latency', 'gpu_tuning.cmar_latency_hint', 'maliDriver.cmarOptimizeForLatency', gt.maliDriver.cmarOptimizeForLatency)}
          ${toggleRow('gpu_tuning.disable_shader_lto', 'gpu_tuning.disable_shader_lto_hint', 'maliDriver.glesDisableShaderLto', gt.maliDriver.glesDisableShaderLto)}
          ${toggleRow('gpu_tuning.disable_pilot_shaders', 'gpu_tuning.disable_pilot_shaders_hint', 'maliDriver.glesDisablePilotShaders', gt.maliDriver.glesDisablePilotShaders)}
          ${toggleRow('gpu_tuning.disable_pipeline_cache', 'gpu_tuning.disable_pipeline_cache_hint', 'maliDriver.glesDisableGraphicsPipelineCache', gt.maliDriver.glesDisableGraphicsPipelineCache)}
          ${toggleRow('gpu_tuning.disable_subpass_cache', 'gpu_tuning.disable_subpass_cache_hint', 'maliDriver.glesDisableSubpassCache', gt.maliDriver.glesDisableSubpassCache)}
          ${toggleRow('gpu_tuning.disable_surface_afbc', 'gpu_tuning.disable_surface_afbc_hint', 'maliDriver.glesDisableSurfaceAfbc', gt.maliDriver.glesDisableSurfaceAfbc)}
          ${toggleRow('gpu_tuning.disable_texture_afbc', 'gpu_tuning.disable_texture_afbc_hint', 'maliDriver.glesDisableTextureAfbc', gt.maliDriver.glesDisableTextureAfbc)}
          ${toggleRow('gpu_tuning.disable_crc', 'gpu_tuning.disable_crc_hint', 'maliDriver.glesDisableCrc', gt.maliDriver.glesDisableCrc)}
          ${toggleRow('gpu_tuning.disable_idvs', 'gpu_tuning.disable_idvs_hint', 'maliDriver.glesDisableIdvs', gt.maliDriver.glesDisableIdvs)}
          ${toggleRow('gpu_tuning.prerotate', 'gpu_tuning.prerotate_hint', 'maliDriver.maliPrerotate', gt.maliDriver.maliPrerotate)}
          <div class="setting-divider"></div>
          <h4 class="setting-section-title">${t('gpu_tuning.vulkan_section')}</h4>
          ${toggleRow('gpu_tuning.vulkan_hwui', 'gpu_tuning.vulkan_hwui_hint', 'vulkanHwui', gt.vulkanHwui)}
          ${toggleRow('gpu_tuning.vulkan_renderengine', 'gpu_tuning.vulkan_renderengine_hint', 'vulkanRenderengine', gt.vulkanRenderengine)}
        </div>
      </div>`;
  }

  /* ─── Render CPU Tuning Card ──────────────────────────────────────── */
  function renderCpuTuningCard() {
    const ct = state.cpuTuning;
    const STOCK = { sugovUpRate: 1000, sugovDownRate: 1000, cpuidleMaxState: 6, uclampTopAppMin: 0 };

    function numRow(labelKey, hintKey, field, val, stockVal, min, max, step, unit) {
      const isModified = val !== stockVal;
      return `
        <div class="setting-row">
          <div class="setting-label">
            <span>${t(labelKey)}</span>
            <span class="info-chip ${isModified ? 'freq' : ''}">${val} ${unit}</span>
          </div>
          <div class="setting-hint">${t(hintKey)}</div>
          <div class="setting-control">
            <input type="range" class="slider" min="${min}" max="${max}" step="${step}"
                   value="${val}"
                   oninput="window.OC.setCpuTuning('${field}', parseInt(this.value)); this.nextElementSibling.textContent=this.value">
            <span class="slider-val">${val}</span>
            <span class="slider-label-stock">${t('gpu_tuning.stock')}: ${stockVal}</span>
          </div>
        </div>`;
    }

    function toggleRow(labelKey, hintKey, field, val) {
      return `
        <div class="setting-row">
          <div class="setting-label">
            <span>${t(labelKey)}</span>
          </div>
          <div class="setting-hint">${t(hintKey)}</div>
          <div class="setting-control">
            <button class="btn btn-sm ${val ? 'btn-primary' : 'btn-secondary'}"
                    onclick="window.OC.setCpuTuning('${field}', ${val ? 0 : 1})">
              ${val ? t('misc.on') : t('misc.off')}
            </button>
          </div>
        </div>`;
    }

    /* cpuidle state names for display */
    const idleStateNames = ['WFI (1µs)', 'cpuoff (180-377µs)', 'clusteroff (196-563µs)',
      'mcusysoff (861-1324µs)', 'system-mem (1583µs)', 'system-pll (1633µs)', 'system-bus (3383µs)'];
    const idleMaxLabel = ct.cpuidleMaxState <= 6
      ? `${ct.cpuidleMaxState} — ${idleStateNames[ct.cpuidleMaxState] || ''}`
      : `${ct.cpuidleMaxState}`;

    return `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">⚡ ${t('cpu_tuning.title')}</h3>
        </div>
        <div class="card-body settings-list">
          <h4 class="setting-section-title">${t('cpu_tuning.governor_section')}</h4>
          ${numRow('cpu_tuning.up_rate_limit', 'cpu_tuning.up_rate_limit_hint', 'sugovUpRate', ct.sugovUpRate, STOCK.sugovUpRate, 0, 5000, 100, 'µs')}
          ${numRow('cpu_tuning.down_rate_limit', 'cpu_tuning.down_rate_limit_hint', 'sugovDownRate', ct.sugovDownRate, STOCK.sugovDownRate, 0, 5000, 100, 'µs')}
          <div class="setting-divider"></div>
          <h4 class="setting-section-title">${t('cpu_tuning.idle_section')}</h4>
          <div class="setting-row">
            <div class="setting-label">
              <span>${t('cpu_tuning.cpuidle_max_state')}</span>
              <span class="info-chip ${ct.cpuidleMaxState !== STOCK.cpuidleMaxState ? 'freq' : ''}">${idleMaxLabel}</span>
            </div>
            <div class="setting-hint">${t('cpu_tuning.cpuidle_max_state_hint')}</div>
            <div class="setting-control">
              <input type="range" class="slider" min="0" max="6" step="1"
                     value="${ct.cpuidleMaxState}"
                     oninput="window.OC.setCpuTuning('cpuidleMaxState', parseInt(this.value))">
              <span class="slider-label-stock">${t('gpu_tuning.stock')}: 6</span>
            </div>
          </div>
          <div class="setting-divider"></div>
          <h4 class="setting-section-title">${t('cpu_tuning.sched_section')}</h4>
          ${toggleRow('cpu_tuning.energy_aware', 'cpu_tuning.energy_aware_hint', 'schedEnergyAware', ct.schedEnergyAware)}
          ${toggleRow('cpu_tuning.child_runs_first', 'cpu_tuning.child_runs_first_hint', 'schedChildRunsFirst', ct.schedChildRunsFirst)}
          ${numRow('cpu_tuning.uclamp_min', 'cpu_tuning.uclamp_min_hint', 'uclampTopAppMin', ct.uclampTopAppMin, STOCK.uclampTopAppMin, 0, 1024, 64, '')}
          <div class="setting-divider"></div>
          <h4 class="setting-section-title">${t('cpu_tuning.fpsgo_section')}</h4>
          ${toggleRow('cpu_tuning.fpsgo_boost_ta', 'cpu_tuning.fpsgo_boost_ta_hint', 'fpsgoBoostTa', ct.fpsgoBoostTa)}
          ${toggleRow('cpu_tuning.fpsgo_rescue', 'cpu_tuning.fpsgo_rescue_hint', 'fpsgoRescueEnable', ct.fpsgoRescueEnable)}
        </div>
      </div>`;
  }

  /* ─── Render Display Tuning Card ──────────────────────────────────── */
  function renderDisplayTuningCard() {
    const dt = state.displayTuning;
    const STOCK = { peakRefreshRate: 144, minRefreshRate: 144, animatorDuration: 1.0,
      transitionDuration: 1.0, windowDuration: 1.0, colorSaturation: 1.1,
      sharpnessIdx: 2, ultraResolution: 1, dreEnable: 1, hdrAdaptive: 1, hfgLevel: 2, displayIdleTime: 33 };

    const rrOpts = [60, 90, 120, 144];

    function selectRow(labelKey, hintKey, field, val, stockVal, options, unit) {
      const isModified = val !== stockVal;
      return `
        <div class="setting-row">
          <div class="setting-label">
            <span>${t(labelKey)}</span>
            <span class="info-chip ${isModified ? 'freq' : ''}">${val} ${unit}</span>
          </div>
          <div class="setting-hint">${t(hintKey)}</div>
          <div class="setting-control btn-row">
            ${options.map(o => `<button class="btn btn-sm ${o === val ? 'btn-primary' : 'btn-secondary'}"
              onclick="window.OC.setDisplayTuning('${field}', ${o})">${o}</button>`).join(' ')}
          </div>
        </div>`;
    }

    function sliderRow(labelKey, hintKey, field, val, stockVal, min, max, step, unit) {
      const isModified = val !== stockVal;
      const displayVal = typeof val === 'number' && val % 1 !== 0 ? val.toFixed(1) : val;
      return `
        <div class="setting-row">
          <div class="setting-label">
            <span>${t(labelKey)}</span>
            <span class="info-chip ${isModified ? 'freq' : ''}">${displayVal} ${unit}</span>
          </div>
          <div class="setting-hint">${t(hintKey)}</div>
          <div class="setting-control">
            <input type="range" class="slider" min="${min}" max="${max}" step="${step}"
                   value="${val}"
                   oninput="window.OC.setDisplayTuning('${field}', parseFloat(this.value)); this.nextElementSibling.textContent=parseFloat(this.value).toFixed(1)">
            <span class="slider-val">${displayVal}</span>
          </div>
        </div>`;
    }

    function toggleRow(labelKey, hintKey, field, val) {
      return `
        <div class="setting-row">
          <div class="setting-label"><span>${t(labelKey)}</span></div>
          <div class="setting-hint">${t(hintKey)}</div>
          <div class="setting-control">
            <button class="btn btn-sm ${val ? 'btn-primary' : 'btn-secondary'}"
                    onclick="window.OC.setDisplayTuning('${field}', ${val ? 0 : 1})">
              ${val ? t('misc.on') : t('misc.off')}
            </button>
          </div>
        </div>`;
    }

    const shpLabels = ['OFF', t('display.shp_low'), t('display.shp_mid'), t('display.shp_high')];
    const hfgLabels = ['OFF', t('display.hfg_low'), t('display.hfg_high')];

    return `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🖥️ ${t('display.title')}</h3>
        </div>
        <div class="card-body settings-list">
          <h4 class="setting-section-title">${t('display.refresh_section')}</h4>
          <div class="setting-row">
            <div class="setting-label">
              <span>${t('display.refresh_mode')}</span>
              <span class="info-chip ${dt.refreshMode !== 'fixed' ? 'freq' : ''}">${dt.refreshMode === 'adaptive' ? t('display.mode_adaptive') : t('display.mode_fixed')}</span>
            </div>
            <div class="setting-hint">${t('display.refresh_mode_hint')}</div>
            <div class="setting-control btn-row">
              <button class="btn btn-sm ${dt.refreshMode === 'fixed' ? 'btn-primary' : 'btn-secondary'}"
                onclick="window.OC.setDisplayTuning('refreshMode', 'fixed')">${t('display.mode_fixed')}</button>
              <button class="btn btn-sm ${dt.refreshMode === 'adaptive' ? 'btn-primary' : 'btn-secondary'}"
                onclick="window.OC.setDisplayTuning('refreshMode', 'adaptive')">${t('display.mode_adaptive')}</button>
            </div>
          </div>
          ${dt.refreshMode === 'fixed'
            ? selectRow('display.peak_rr', 'display.fixed_rr_hint', 'peakRefreshRate', dt.peakRefreshRate, STOCK.peakRefreshRate, rrOpts, 'Hz')
            : `${selectRow('display.peak_rr', 'display.adaptive_peak_hint', 'peakRefreshRate', dt.peakRefreshRate, STOCK.peakRefreshRate, rrOpts, 'Hz')}
               ${selectRow('display.min_rr', 'display.adaptive_min_hint', 'minRefreshRate', dt.minRefreshRate, 90, [90, 120], 'Hz')}`
          }
          <div class="setting-divider"></div>
          <h4 class="setting-section-title">${t('display.animation_section')}</h4>
          ${selectRow('display.animator', 'display.animator_hint', 'animatorDuration', dt.animatorDuration, STOCK.animatorDuration, [0, 0.5, 1.0], 'x')}
          ${selectRow('display.transition', 'display.transition_hint', 'transitionDuration', dt.transitionDuration, STOCK.transitionDuration, [0, 0.5, 1.0], 'x')}
          ${selectRow('display.window', 'display.window_hint', 'windowDuration', dt.windowDuration, STOCK.windowDuration, [0, 0.5, 1.0], 'x')}
          <div class="setting-divider"></div>
          <h4 class="setting-section-title">${t('display.pq_section')}</h4>
          ${sliderRow('display.color_sat', 'display.color_sat_hint', 'colorSaturation', dt.colorSaturation, STOCK.colorSaturation, 0.8, 1.3, 0.1, '')}
          <div class="setting-row">
            <div class="setting-label">
              <span>${t('display.sharpness')}</span>
              <span class="info-chip ${dt.sharpnessIdx !== STOCK.sharpnessIdx ? 'freq' : ''}">${shpLabels[dt.sharpnessIdx] || dt.sharpnessIdx}</span>
            </div>
            <div class="setting-hint">${t('display.sharpness_hint')}</div>
            <div class="setting-control btn-row">
              ${[0,1,2,3].map(i => `<button class="btn btn-sm ${i === dt.sharpnessIdx ? 'btn-primary' : 'btn-secondary'}"
                onclick="window.OC.setDisplayTuning('sharpnessIdx', ${i})">${shpLabels[i]}</button>`).join(' ')}
            </div>
          </div>
          ${toggleRow('display.ultra_res', 'display.ultra_res_hint', 'ultraResolution', dt.ultraResolution)}
          ${toggleRow('display.dre', 'display.dre_hint', 'dreEnable', dt.dreEnable)}
          ${toggleRow('display.hdr_adaptive', 'display.hdr_adaptive_hint', 'hdrAdaptive', dt.hdrAdaptive)}
          <div class="setting-row">
            <div class="setting-label">
              <span>${t('display.hfg')}</span>
              <span class="info-chip ${dt.hfgLevel !== STOCK.hfgLevel ? 'freq' : ''}">${hfgLabels[dt.hfgLevel] || dt.hfgLevel}</span>
            </div>
            <div class="setting-hint">${t('display.hfg_hint')}</div>
            <div class="setting-control btn-row">
              ${[0,1,2].map(i => `<button class="btn btn-sm ${i === dt.hfgLevel ? 'btn-primary' : 'btn-secondary'}"
                onclick="window.OC.setDisplayTuning('hfgLevel', ${i})">${hfgLabels[i]}</button>`).join(' ')}
            </div>
          </div>
          <div class="setting-divider"></div>
          <h4 class="setting-section-title">${t('display.power_section')}</h4>
          ${sliderRow('display.idle_time', 'display.idle_time_hint', 'displayIdleTime', dt.displayIdleTime, STOCK.displayIdleTime, 8, 100, 1, 'ms')}
        </div>
      </div>`;
  }

  /* ─── Render RAM Card ─────────────────────────────────────────────── */
  function renderRamCard() {
    const r = state.ram;
    const maxFreqHz = r.availableFreqs.length > 0 ? Math.max(...r.availableFreqs) : 0;

    const freqOptions = r.availableFreqs.map(f =>
      `<option value="${f}" ${f === r.selectedMinFreq ? 'selected' : ''}>${formatFreqHz(f)}</option>`
    ).join('');

    let html = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span class="icon">🧠</span>
            ${t('ram.title', { type: r.dramType || 'LPDDR' })}
          </div>
          <div>
            <span class="card-badge ram">${t('cpu.opps', { n: r.availableFreqs.length })}</span>
            <span class="info-chip ram" style="margin-left:4px">${r.governor || '—'}</span>
          </div>
        </div>

        <!-- Status Grid -->
        <div class="ram-status-grid">
          <div class="ram-stat-item">
            <span class="ram-stat-label">${t('ram.data_rate')}</span>
            <span class="ram-stat-value">${r.dataRate > 0 ? r.dataRate + ' MT/s' : '—'}</span>
          </div>
          <div class="ram-stat-item">
            <span class="ram-stat-label">${t('ram.vcore')}</span>
            <span class="ram-stat-value">${r.vcoreUv > 0 ? (r.vcoreUv / 1000).toFixed(0) + ' mV' : '—'}</span>
          </div>
          <div class="ram-stat-item">
            <span class="ram-stat-label">${t('ram.current_freq')}</span>
            <span class="ram-stat-value">${r.curFreq > 0 ? formatFreqHz(r.curFreq) : '—'}</span>
          </div>
          <div class="ram-stat-item">
            <span class="ram-stat-label">${t('ram.min_floor')}</span>
            <span class="ram-stat-value ${r.minFreq > r.availableFreqs[0] ? '' : 'muted'}">${r.minFreq > 0 ? formatFreqHz(r.minFreq) : '—'}</span>
          </div>
        </div>

        <!-- Min Freq Floor Selector -->
        <div class="config-row">
          <div><div class="config-label">${t('ram.min_freq_floor')}</div></div>
          <select class="config-input freq-limit-select" id="ram-min-freq"
                  onchange="window.OC.onRamMinFreqChange(this)">
            ${freqOptions}
          </select>
        </div>

        <!-- Available Frequencies Table -->
        <div class="opp-table-wrapper">
          <table class="opp-table">
            <thead>
              <tr>
                <th>${t('ram.th.index')}</th>
                <th>${t('ram.th.frequency')}</th>
                <th>${t('ram.th.data_rate')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>`;

    r.availableFreqs.forEach((freq, idx) => {
      const pct = maxFreqHz > 0 ? (freq / maxFreqHz * 100) : 0;
      const isCurrent = freq === r.curFreq;
      const isFloor = freq === r.minFreq;
      const dataRateMts = Math.round(freq / 1000000);
      const rowClass = isCurrent ? 'modified ram-row' : '';

      html += `
              <tr class="${rowClass}">
                <td><span class="cell-static" style="color:var(--text-muted)">${idx + 1}</span></td>
                <td>
                  <span class="cell-static">${formatFreqHz(freq)}</span>
                  <div class="freq-bar" style="margin-top:3px">
                    <div class="freq-bar-fill ram" style="width:${pct}%"></div>
                  </div>
                </td>
                <td><span class="cell-static">${dataRateMts} MT/s</span></td>
                <td>
                  ${isCurrent ? `<span class="info-chip ram">${t('ram.active')}</span>` : ''}
                  ${isFloor ? `<span class="info-chip freq">${t('ram.floor')}</span>` : ''}
                </td>
              </tr>`;
    });

    html += `
            </tbody>
          </table>
        </div>

        <div style="padding:8px 12px;font-size:0.72rem;color:var(--text-muted);line-height:1.4">
          ℹ️ ${t('ram.info_hint')}
        </div>
      </div>`;

    return html;
  }

  /* ─── Render Storage Card ─────────────────────────────────────────── */
  function renderStorageCard() {
    const s = state.storage;
    if (s.devices.length === 0) return '';

    const rep = s.devices[0]; // representative device for status grid

    /* Scheduler select — built from kernel-reported available schedulers */
    const schedOptions = (rep.availableSchedulers || IO_SCHEDULER_OPTIONS).map(v =>
      `<option value="${v}" ${v === s.scheduler ? 'selected' : ''}>${v}</option>`
    ).join('');

    /* Read-ahead select */
    const readAheadOptions = IO_READ_AHEAD_OPTIONS.map(v =>
      `<option value="${v}" ${v === s.readAheadKb ? 'selected' : ''}>${v} KB</option>`
    ).join('');

    /* rq_affinity select */
    const rqaOptions = IO_RQ_AFFINITY_OPTIONS.map(o =>
      `<option value="${o.value}" ${o.value === s.rqAffinity ? 'selected' : ''}>${t(o.labelKey)}</option>`
    ).join('');

    /* nomerges select */
    const nomOptions = IO_NOMERGES_OPTIONS.map(o =>
      `<option value="${o.value}" ${o.value === s.nomerges ? 'selected' : ''}>${t(o.labelKey)}</option>`
    ).join('');

    let html = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span class="icon">💾</span>
            ${t('storage.title')}
          </div>
          <span class="card-badge storage">${t('storage.devs', { n: s.devices.length })}</span>
        </div>

        <!-- Status Grid -->
        <div class="storage-status-grid">
          <div class="storage-stat-item">
            <span class="storage-stat-label">${t('storage.scheduler')}</span>
            <span class="storage-stat-value">${rep ? rep.scheduler || '—' : '—'}</span>
          </div>
          <div class="storage-stat-item">
            <span class="storage-stat-label">${t('storage.queue_depth')}</span>
            <span class="storage-stat-value muted">${rep ? (rep.nrRequests > 0 ? rep.nrRequests : '—') : '—'}</span>
          </div>
          <div class="storage-stat-item">
            <span class="storage-stat-label">${t('storage.read_ahead')}</span>
            <span class="storage-stat-value">${s.devices.map(d => d.readAheadKb + ' KB').join(' / ')}</span>
          </div>
          <div class="storage-stat-item">
            <span class="storage-stat-label">${t('storage.ufs_type')}</span>
            <span class="storage-stat-value muted">${s.ufsVersion || 'UFS 4.0'}</span>
          </div>
        </div>

        <div class="storage-section-label">${t('storage.block_queue_tuning')}</div>

        <!-- Scheduler Selector -->
        <div class="config-row">
          <div>
            <div class="config-label">${t('storage.io_scheduler')}</div>
            <div class="config-hint">${t('storage.io_scheduler_hint')}</div>
          </div>
          <select class="config-input freq-limit-select" id="storage-scheduler"
                  onchange="window.OC.onStorageSchedulerChange(this)">
            ${schedOptions}
          </select>
        </div>

        <!-- Read-Ahead Selector -->
        <div class="config-row">
          <div>
            <div class="config-label">${t('storage.read_ahead_all')}</div>
            <div class="config-hint">${t('storage.read_ahead_hint')}</div>
          </div>
          <select class="config-input freq-limit-select" id="storage-read-ahead"
                  onchange="window.OC.onStorageReadAheadChange(this)">
            ${readAheadOptions}
          </select>
        </div>

        <!-- rq_affinity Selector -->
        <div class="config-row">
          <div>
            <div class="config-label">${t('storage.rq_affinity')}</div>
            <div class="config-hint">${t('storage.rq_affinity_hint')}</div>
          </div>
          <select class="config-input freq-limit-select" id="storage-rq-affinity"
                  onchange="window.OC.onStorageFieldChange('rqAffinity', this)">
            ${rqaOptions}
          </select>
        </div>

        <!-- nomerges Selector -->
        <div class="config-row">
          <div>
            <div class="config-label">${t('storage.io_merges')}</div>
            <div class="config-hint">${t('storage.io_merges_hint')}</div>
          </div>
          <select class="config-input freq-limit-select" id="storage-nomerges"
                  onchange="window.OC.onStorageFieldChange('nomerges', this)">
            ${nomOptions}
          </select>
        </div>

        <!-- Toggle row: iostats + add_random -->
        <div class="config-row">
          <div>
            <div class="config-label">${t('storage.io_stats')}</div>
            <div class="config-hint">${t('storage.io_stats_hint')}</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="storage-iostats" ${s.iostats ? 'checked' : ''}
                   onchange="window.OC.onStorageToggle('iostats', this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="config-row">
          <div>
            <div class="config-label">${t('storage.entropy_feed')}</div>
            <div class="config-hint">${t('storage.entropy_feed_hint')}</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="storage-add-random" ${s.addRandom ? 'checked' : ''}
                   onchange="window.OC.onStorageToggle('addRandom', this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>

        <!-- Per-device table -->
        <div class="opp-table-wrapper">
          <table class="opp-table">
            <thead>
              <tr>
                <th>${t('storage.th.device')}</th>
                <th>${t('storage.th.sched')}</th>
                <th>${t('storage.th.ra')}</th>
                <th>${t('storage.th.queue')}</th>
                <th>${t('storage.th.merge')}</th>
                <th>${t('storage.th.affin')}</th>
              </tr>
            </thead>
            <tbody>`;

    for (const dev of s.devices) {
      html += `
              <tr>
                <td><span class="cell-static" style="font-family:var(--font-mono)">${dev.name}</span></td>
                <td><span class="info-chip storage">${dev.scheduler || '—'}</span></td>
                <td><span class="cell-static">${dev.readAheadKb > 0 ? dev.readAheadKb + 'K' : '—'}</span></td>
                <td><span class="cell-static" style="color:var(--text-muted)">${dev.nrRequests > 0 ? dev.nrRequests : '—'}</span></td>
                <td><span class="cell-static" style="color:var(--text-muted)">${dev.nomerges}</span></td>
                <td><span class="cell-static" style="color:var(--text-muted)">${dev.rqAffinity}</span></td>
              </tr>`;
    }

    html += `
            </tbody>
          </table>
        </div>
      </div>`;

    /* ─── UFS Controller Card ──────────────────────────────────────────── */
    const PM_LVL_LABELS = [
      '0 — Active/Active',
      '1 — Active/Hibern8',
      '2 — Sleep/Active',
      '3 — Sleep/Hibern8',
      '4 — PwrDown/Hibern8',
      '5 — PwrDown/Off',
    ];
    const rpmOpts = PM_LVL_LABELS.map((lbl, i) =>
      `<option value="${i}" ${i === s.rpmLvl ? 'selected' : ''}>${lbl}</option>`
    ).join('');
    const spmOpts = PM_LVL_LABELS.map((lbl, i) =>
      `<option value="${i}" ${i === s.spmLvl ? 'selected' : ''}>${lbl}</option>`
    ).join('');

    html += `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span class="icon">🔧</span>
            ${t('storage.ufs_controller')}
          </div>
          <span class="card-badge storage">112b0000</span>
        </div>

        <div class="storage-status-grid">
          <div class="storage-stat-item">
            <span class="storage-stat-label">${t('storage.ufs_type')}</span>
            <span class="storage-stat-value muted">${s.ufsVersion || 'UFS 4.0'}</span>
          </div>
          <div class="storage-stat-item">
            <span class="storage-stat-label">${t('storage.hci_address')}</span>
            <span class="storage-stat-value muted" style="font-size:0.72rem">0x112b0000</span>
          </div>
        </div>

        <!-- Write Booster toggle -->
        <div class="config-row">
          <div>
            <div class="config-label">${t('storage.write_booster')}</div>
            <div class="config-hint">${t('storage.wb_hint')}</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="ufs-wb-on" ${s.wbOn === 1 ? 'checked' : ''}
                   onchange="window.OC.onStorageToggle('wbOn', this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>

        <!-- Clock Gating toggle -->
        <div class="config-row">
          <div>
            <div class="config-label">${t('storage.clock_gating')}</div>
            <div class="config-hint">${t('storage.clk_gate_hint')}</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="ufs-clkgate" ${s.clkgateEnable === 1 ? 'checked' : ''}
                   onchange="window.OC.onStorageToggle('clkgateEnable', this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>

        <!-- Clock Gate Delay -->
        <div class="config-row">
          <div>
            <div class="config-label">${t('storage.clk_gate_delay')}</div>
            <div class="config-hint">${t('storage.clk_gate_delay_hint')}</div>
          </div>
          <input type="number" class="config-input" id="ufs-clkgate-delay"
                 style="width:80px;text-align:center" min="1" max="1000"
                 value="${s.clkgateDelay > 0 ? s.clkgateDelay : 10}"
                 onchange="state.storage.clkgateDelay = parseInt(this.value, 10) || 10">
        </div>

        <!-- Auto Hibernate8 -->
        <div class="config-row">
          <div>
            <div class="config-label">${t('storage.auto_hibern8')}</div>
            <div class="config-hint">${t('storage.auto_hibern8_hint')}</div>
          </div>
          <input type="number" class="config-input" id="ufs-auto-hibern8"
                 style="width:100px;text-align:center" min="0" max="100000"
                 value="${s.autoHibern8 >= 0 ? s.autoHibern8 : 0}"
                 onchange="state.storage.autoHibern8 = parseInt(this.value, 10) || 0">
        </div>

        <!-- Runtime PM Level -->
        <div class="config-row">
          <div>
            <div class="config-label">${t('storage.rpm_lvl')}</div>
            <div class="config-hint">${t('storage.rpm_lvl_hint')}</div>
          </div>
          <select class="config-input freq-limit-select" id="ufs-rpm-lvl"
                  onchange="state.storage.rpmLvl = parseInt(this.value, 10)">
            ${rpmOpts}
          </select>
        </div>

        <!-- System PM Level -->
        <div class="config-row">
          <div>
            <div class="config-label">${t('storage.spm_lvl')}</div>
            <div class="config-hint">${t('storage.spm_lvl_hint')}</div>
          </div>
          <select class="config-input freq-limit-select" id="ufs-spm-lvl"
                  onchange="state.storage.spmLvl = parseInt(this.value, 10)">
            ${spmOpts}
          </select>
        </div>

        <div style="padding:8px 12px;font-size:0.72rem;color:var(--text-muted);line-height:1.4">
          ℹ️ ${t('storage.ufs_info_hint')}
        </div>
      </div>`;

    return html;
  }

  /* ─── Render Profile Content ───────────────────────────────────────── */
  function renderProfileContent() {
    const gov = state.profile.governor;
    const ag = state.profile.autoGaming;
    const govs = state.profile.availableGovernors;
    const gp = state.profile.governorProfiles[gov] || GOVERNOR_DEFAULT_PROFILE;

    /* Governor selector cards */
    let govCards = '';
    govs.forEach(g => {
      const icon = GOVERNOR_ICONS[g] || '⚙️';
      const gName = t(`governor.${g}.name`, {}, g);
      govCards += `
        <div class="power-mode-card ${gov === g ? 'active' : ''}"
             onclick="window.OC.setGovernor('${g}')">
          <span class="pm-icon">${icon}</span>
          <span class="pm-label">${gName}</span>
        </div>`;
    });

    /* Governor description for currently selected governor */
    const govDescKey = `governor.${gov}.desc`;
    const govDesc = t(govDescKey, {}, '');

    // Gaming status
    let statusHtml = '';
    if (ag.enabled) {
      if (ag.boosted) {
        statusHtml = '<div class="gaming-status boosted">' + t('profile.gaming_boost_active', { app: ag.activeApp }) + '</div>';
      } else if (ag.pollTimer) {
        statusHtml = '<div class="gaming-status monitoring">' + t('profile.monitoring') + '</div>';
      } else {
        statusHtml = '<div class="gaming-status idle">' + t('profile.gaming_idle') + '</div>';
      }
    }

    // Selected apps chips
    const chips = ag.apps.length > 0
      ? ag.apps.map(function(pkg) {
          const app = ag.allApps.find(function(a) { return a.pkg === pkg; });
          const display = app && app.label !== pkg ? app.label : pkg.split('.').pop();
          const chipIcon = ag.iconMap[pkg]
            ? '<img class="chip-icon" src="data:image/png;base64,' + ag.iconMap[pkg] + '"> '
            : '';
          return '<span class="selected-app-chip" onclick="window.OC.removeGamingApp(\'' + pkg + '\')" title="' + pkg + '">' +
            chipIcon + display + ' <span class="chip-x">\u2715</span></span>';
        }).join('')
      : '<span style="color:var(--text-muted);font-size:0.78rem">' + t('profile.no_apps_selected') + '</span>';

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span class="icon">⚡</span>
            ${t('profile.governor')}
          </div>
          <span class="card-badge cpu">${gov}</span>
        </div>
        <div class="power-mode-grid">
          ${govCards}
        </div>
        ${govDesc ? `<div style="padding:6px 12px 2px;font-size:0.78rem;color:var(--text-secondary);line-height:1.5">
          💡 ${govDesc}
        </div>` : ''}
        <div style="padding:4px 12px 8px;font-size:0.72rem;color:var(--text-muted);line-height:1.5">
          ${t('profile.governor_hint')}
        </div>
      </div>

      <div class="card gaming-section">
        <div class="card-header">
          <div class="card-title">
            <span class="icon">\ud83c\udfae</span>
            ${t('profile.auto_gaming')}
          </div>
          <label class="toggle-switch">
            <input type="checkbox" ${ag.enabled ? 'checked' : ''}
                   onchange="window.OC.toggleAutoGaming(this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        ${statusHtml}
        <div style="padding:0 0 8px;font-size:0.75rem;color:var(--text-secondary);line-height:1.5">
          ${t('profile.gaming_desc')}
        </div>
        <div style="margin-bottom:8px">
          <div class="config-label" style="margin-bottom:6px">${t('profile.gaming_apps', { n: ag.apps.length })}</div>
          <div class="selected-apps">${chips}</div>
        </div>
        ${ag.enabled ? `
          <button class="btn btn-secondary btn-sm" style="width:100%"
                  onclick="window.OC.showAppSelector()">
            ${t('btn.select_apps')}
          </button>
        ` : ''}
      </div>`;
  }

  /* ─── Render App Selector ────────────────────────────────────────── */
  function renderAppSelector() {
    const ag = state.profile.autoGaming;
    if (!ag._selectorVisible) return '';

    const query = (ag._searchQuery || '').toLowerCase();
    const filtered = ag.allApps.filter(function(a) {
      return a.pkg.toLowerCase().includes(query) || a.label.toLowerCase().includes(query);
    });

    let listHtml = '';
    if (ag.loading) {
      listHtml = '<div class="app-list-loading">' + t('profile.loading_apps') + '</div>';
    } else if (filtered.length === 0) {
      listHtml = '<div class="app-list-empty">' + t('profile.no_apps_found') + '</div>';
    } else {
      listHtml = filtered.map(function(a) {
        const sel = ag.apps.includes(a.pkg);
        const iconHtml = ag.iconMap[a.pkg]
          ? '<img class="app-icon" src="data:image/png;base64,' + ag.iconMap[a.pkg] + '">'
          : '<div class="app-icon-placeholder">' + (a.label || a.pkg).charAt(0) + '</div>';
        return '<div class="app-item ' + (sel ? 'selected' : '') + '" ' +
          'onclick="window.OC.toggleGamingApp(\'' + a.pkg + '\')">' +
          iconHtml +
          '<div class="app-info">' +
          '<div class="app-label">' + a.label + '</div>' +
          '<div class="app-pkg">' + a.pkg + '</div>' +
          '</div>' +
          '<div class="app-check">' + (sel ? '\u2713' : '') + '</div>' +
          '</div>';
      }).join('');
    }

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span class="icon">\ud83d\udcf1</span>
            ${t('profile.installed_apps')}
          </div>
          <button class="btn btn-secondary btn-sm" style="padding:4px 10px"
                  onclick="window.OC.hideAppSelector()">\u2715 ${t('btn.close')}</button>
        </div>
        <div class="app-search-wrap">
          <span class="app-search-icon">\ud83d\udd0d</span>
          <input type="text" class="app-search-input"
                 placeholder="${t('profile.search_apps')}"
                 value="${ag._searchQuery || ''}"
                 oninput="window.OC.filterApps(this.value)">
        </div>
        <div class="app-list-container">
          ${listHtml}
        </div>
        <div style="padding:8px 12px;font-size:0.72rem;color:var(--text-muted)">
          ${t('profile.apps_count', { total: ag.allApps.length, selected: ag.apps.length })}
        </div>
      </div>`;
  }

  /* ─── Render Thermal Mitigation Card ─────────────────────────────── */
  function renderThermalCard(type) {
    const isGpu = type === 'gpu';
    const mode = isGpu ? state.thermal.gpuMode : state.thermal.cpuMode;
    const accentClass = isGpu ? 'gpu' : 'cpu';

    const relevantTemps = Object.entries(state.thermal.temps)
      .filter(([k]) => isGpu ? /gpu|mali/i.test(k) : !/gpu|mali/i.test(k));

    const tempChips = relevantTemps.length > 0
      ? relevantTemps.map(([k, v]) => {
          const name = k.replace(/mtk-|-thermal|-tz|_thermal/g, '').slice(0, 12) || k.slice(0, 12);
          const extraStyle = v >= 85
            ? 'border-color:var(--danger,#ef4444);color:var(--danger,#ef4444)'
            : v >= 70 ? 'border-color:#f59e0b;color:#f59e0b' : '';
          return `<span class="info-chip ${accentClass}"${extraStyle ? ` style="${extraStyle}"` : ''}>${name}:${v}°C</span>`;
        }).join('')
      : `<span style="color:var(--text-muted);font-size:0.75rem">${t('thermal.tap_refresh')}</span>`;

    const modeDescs = [
      t(isGpu ? 'thermal.gpu_desc_off' : 'thermal.cpu_desc_off'),
      t(isGpu ? 'thermal.gpu_desc_soft' : 'thermal.cpu_desc_soft'),
      t(isGpu ? 'thermal.gpu_desc_hard' : 'thermal.cpu_desc_hard'),
    ];

    const gpuFixBanner = isGpu && state.thermal.gpuFixActive
      ? `<div style="margin-bottom:8px;padding:5px 10px;font-size:0.72rem;` +
        `background:rgba(139,92,246,0.12);border-left:3px solid var(--gpu-accent,#8b5cf6);` +
        `border-radius:0 6px 6px 0;color:var(--gpu-accent,#8b5cf6)">` +
        `${t('thermal.gpu_fix_banner')}</div>`
      : '';

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span class="icon">🌡</span>
            ${t('thermal.title')}
            <span class="card-badge ${accentClass}" style="margin-left:6px">${[t('thermal.off'),t('thermal.soft'),t('thermal.hard')][mode] || t('thermal.off')}</span>
          </div>
          <button class="btn btn-secondary btn-sm" style="padding:4px 10px"
                  onclick="window.OC.refreshTemps()">${t('btn.refresh_temps')}</button>
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:4px;min-height:22px;margin-bottom:10px">
          ${tempChips}
        </div>

        ${gpuFixBanner}

        <div class="config-row">
          <div>
            <div class="config-label">${t('thermal.throttle_mode')}</div>
            <div class="config-hint">${modeDescs[mode] || modeDescs[0]}</div>
          </div>
          <select class="config-input freq-limit-select" style="min-width:88px"
                  onchange="window.OC.setThermalMode('${type}', +this.value)">
            <option value="0" ${mode === 0 ? 'selected' : ''}>${t('thermal.off')}</option>
            <option value="1" ${mode === 1 ? 'selected' : ''}>${t('thermal.soft')}</option>
            <option value="2" ${mode === 2 ? 'selected' : ''}>${t('thermal.hard')}</option>
          </select>
        </div>

        <div style="padding:4px 12px 8px;font-size:0.72rem;color:var(--text-muted);line-height:1.5">
          ${t(isGpu ? 'thermal.gpu_info' : 'thermal.cpu_info')}
        </div>
      </div>`;
  }

  /* ─── Render All ──────────────────────────────────────────────────── */
  function renderAll() {
    const cpuContainer = document.getElementById('cpu-clusters');
    if (cpuContainer) {
      if (state.cpuClusters.length === 0) {
        cpuContainer.innerHTML = `
          <div class="card">
            <div class="empty-state">
              <div class="icon">⚡</div>
              <p>${t('cpu.no_data')}<br>${t('cpu.no_data_hint')}</p>
            </div>
          </div>`;
      } else {
        cpuContainer.innerHTML = state.cpuClusters.map(c => renderCpuCluster(c)).join('');
        state.cpuClusters.forEach(cluster => {
          const maxSel = document.getElementById(`cpu-max-freq-${cluster.id}`);
          const minSel = document.getElementById(`cpu-min-freq-${cluster.id}`);
          if (maxSel && cluster.curMax) maxSel.value = cluster.curMax;
          if (minSel && cluster.curMin) minSel.value = cluster.curMin;
        });
      }
    }

    const gpuContainer = document.getElementById('gpu-devices');
    if (gpuContainer) {
      if (state.gpuEntries.length === 0) {
        gpuContainer.innerHTML = `
          <div class="card">
            <div class="empty-state">
              <div class="icon">🎮</div>
              <p>${t('gpu.no_data')}<br>${t('gpu.no_data_hint')}</p>
            </div>
          </div>`;
      } else {
        gpuContainer.innerHTML = renderGpuCard();
      }
    }

    // Thermal mitigation cards (CPU tab + GPU tab)
    const cpuThermalEl = document.getElementById('cpu-thermal-card');
    if (cpuThermalEl) cpuThermalEl.innerHTML = renderThermalCard('cpu');
    const gpuThermalEl = document.getElementById('gpu-thermal-card');
    if (gpuThermalEl) gpuThermalEl.innerHTML = renderThermalCard('gpu');

    const gpuTuningEl = document.getElementById('gpu-tuning-card');
    if (gpuTuningEl) gpuTuningEl.innerHTML = renderGpuTuningCard();

    const cpuTuningEl = document.getElementById('cpu-tuning-card');
    if (cpuTuningEl) cpuTuningEl.innerHTML = renderCpuTuningCard();

    const displayTuningEl = document.getElementById('display-tuning-card');
    if (displayTuningEl) displayTuningEl.innerHTML = renderDisplayTuningCard();

    const ramContainer = document.getElementById('ram-devices');
    if (ramContainer) {      if (state.ram.availableFreqs.length === 0) {
        ramContainer.innerHTML = `
          <div class="card">
            <div class="empty-state">
              <div class="icon">🧠</div>
              <p>${t('ram.no_data')}<br>${t('ram.no_data_hint')}</p>
            </div>
          </div>`;
      } else {
        ramContainer.innerHTML = renderRamCard();
      }
    }

    const storageContainer = document.getElementById('storage-devices');
    if (storageContainer) {
      if (state.storage.devices.length === 0) {
        storageContainer.innerHTML = `
          <div class="card">
            <div class="empty-state">
              <div class="icon">💾</div>
              <p>${t('storage.no_data')}<br>${t('storage.no_data_hint')}</p>
            </div>
          </div>`;
      } else {
        storageContainer.innerHTML = renderStorageCard();
      }
    }

    // Profile tab
    const profileEl = document.getElementById('profile-content');
    if (profileEl) profileEl.innerHTML = renderProfileContent();
  }

  /* ─── Data Loading ────────────────────────────────────────────────── */
  /* ─── Section-specific data loaders ─────────────────────────────────── */

  async function _loadCpuSection() {
    let cpuMap = new Map();
    const cpuRes = await exec(`cat ${KS_PARAMS}opp_table 2>/dev/null`);
    if (cpuRes.stdout.trim().length > 5 && cpuRes.stdout.includes('CPU:')) {
      cpuMap = parseCpuOppTable(cpuRes.stdout);
    }
    let cpuSparse = false;
    if (cpuMap.size > 0) {
      for (const [, list] of cpuMap) {
        if (list.length <= 1) { cpuSparse = true; break; }
      }
    }
    if (cpuMap.size === 0 || cpuSparse) {
      const fileRes = await exec(`cat ${CPU_OPP_FILE} 2>/dev/null`);
      if (fileRes.stdout.trim().length > 5 && fileRes.stdout.includes('CPU:')) {
        const fileMap = parseCpuOppTable(fileRes.stdout);
        if (fileMap.size > 0) cpuMap = fileMap;
      }
    }

    const [_cpuPolicyBatch, cpuConfRes] = await Promise.all([
      exec(CPU_POLICIES.map(p =>
        `echo "F${p}:$(cat /sys/devices/system/cpu/cpufreq/policy${p}/scaling_available_frequencies 2>/dev/null)";` +
        `echo "X${p}:$(cat /sys/devices/system/cpu/cpufreq/policy${p}/scaling_max_freq 2>/dev/null)";` +
        `echo "N${p}:$(cat /sys/devices/system/cpu/cpufreq/policy${p}/scaling_min_freq 2>/dev/null)"`
      ).join('; ')),
      exec(`cat ${CONF_CPU_OC} 2>/dev/null`),
    ]);
    const _pd = {};
    for (const line of _cpuPolicyBatch.stdout.split('\n')) {
      const m = line.match(/^([FXN])(\d+):(.*)$/);
      if (m) { if (!_pd[m[2]]) _pd[m[2]] = {}; _pd[m[2]][m[1]] = m[3].trim(); }
    }
    state.cpuClusters = CPU_POLICIES.map(policy => {
      const d = _pd[policy] || {};
      const freqs = d.F
        ? d.F.split(/\s+/).map(f => parseInt(f, 10)).filter(f => !isNaN(f)).sort((a, b) => a - b)
        : [];
      return {
        id: policy,
        entries: cpuMap.get(policy) || [],
        freqs,
        curMax: parseInt(d.X, 10) || (freqs.length > 0 ? freqs[freqs.length - 1] : 0),
        curMin: parseInt(d.N, 10) || (freqs.length > 0 ? freqs[0] : 0),
      };
    });
    state.originalCpu = JSON.parse(JSON.stringify(state.cpuClusters));

    /* Restore CPU config overrides */
    if (cpuConfRes.stdout.trim()) {
      try {
        const cpuConf = JSON.parse(cpuConfRes.stdout.trim());
        if (cpuConf.cpu_opp_table) {
          for (const cluster of state.cpuClusters) {
            const savedEntries = cpuConf.cpu_opp_table[cluster.id];
            if (!savedEntries || !Array.isArray(savedEntries)) continue;
            const savedFreqSet = new Set(savedEntries.map(s => s.freq));
            for (const entry of cluster.entries) {
              if (!savedFreqSet.has(entry.freq)) entry.removing = true;
            }
            for (const saved of savedEntries) {
              if (saved.origVolt !== undefined && saved.volt !== saved.origVolt) {
                const entry = cluster.entries.find(e => e.freq === saved.freq);
                if (entry) {
                  entry.origVolt = saved.origVolt;
                  entry.volt = saved.volt;
                  entry.modified = true;
                }
              }
            }
            cluster.entries = cluster.entries.filter(e => !e.removing);
          }
        }
      } catch (e) { /* ignore */ }
    }
  }

  async function _loadGpuSection() {
    state.gpuEntries = [];
    const gpuRes = await exec(`cat /proc/gpufreqv2/gpu_working_opp_table 2>/dev/null`);
    if (gpuRes.stdout.includes('freq:')) {
      state.gpuEntries = parseGpuOppTable(gpuRes.stdout);
    }
    if (state.gpuEntries.length === 0) {
      const gpuFileRes = await exec(`cat ${GPU_OPP_FILE} 2>/dev/null`);
      if (gpuFileRes.stdout.trim().length > 5) {
        if (gpuFileRes.stdout.includes('freq:')) {
          state.gpuEntries = parseGpuOppTable(gpuFileRes.stdout);
        } else if (gpuFileRes.stdout.includes('GPU:')) {
          state.gpuEntries = parseGpuPreParsed(gpuFileRes.stdout);
        }
      }
    }
    state.originalGpu = JSON.parse(JSON.stringify(state.gpuEntries));

    /* Restore GPU config overrides */
    const gpuConfRes = await exec(`cat ${CONF_GPU_OC} 2>/dev/null`);
    if (gpuConfRes.stdout.trim()) {
      try {
        const gpuConf = JSON.parse(gpuConfRes.stdout.trim());
        if (gpuConf.gpu_opp_table && gpuConf.gpu_opp_table.length > 0) {
          const savedGpuIdxSet = new Set(gpuConf.gpu_opp_table.map(s => s.kernelIdx));
          for (const entry of state.gpuEntries) {
            if (!savedGpuIdxSet.has(entry.kernelIdx)) entry.removing = true;
          }
          for (const saved of gpuConf.gpu_opp_table) {
            if (saved.origVolt !== undefined && saved.volt !== saved.origVolt) {
              const entry = state.gpuEntries.find(e => e.kernelIdx === saved.kernelIdx);
              if (entry) {
                entry.origVolt = saved.origVolt;
                entry.volt = saved.volt;
                if (saved.vsram) entry.vsram = saved.vsram;
                entry.modified = true;
              }
            }
          }
          state.gpuEntries = state.gpuEntries.filter(e => !e.removing);
        }
      } catch (e) { /* ignore */ }
    }
  }

  async function _loadGpuTuningSection() {
    const gt = state.gpuTuning;
    /* Read live values from device sysfs */
    const [dvfsRes, idleRes, pwroffRes, ppRes, csgRes] = await Promise.all([
      exec(`cat ${MALI_SYSFS}/dvfs_period 2>/dev/null`),
      exec(`cat ${MALI_SYSFS}/idle_hysteresis_time 2>/dev/null`),
      exec(`cat ${MALI_SYSFS}/mcu_shader_pwroff_timeout 2>/dev/null`),
      exec(`cat ${MALI_SYSFS}/power_policy 2>/dev/null`),
      exec(`cat ${MALI_SYSFS}/csg_scheduling_period 2>/dev/null`),
    ]);
    if (dvfsRes.stdout.trim()) gt.dvfsPeriod = parseInt(dvfsRes.stdout.trim(), 10) || gt.dvfsPeriod;
    if (idleRes.stdout.trim()) gt.idleHysteresis = parseInt(idleRes.stdout.trim(), 10) || gt.idleHysteresis;
    if (pwroffRes.stdout.trim()) gt.shaderPwroff = parseInt(pwroffRes.stdout.trim(), 10) || gt.shaderPwroff;
    if (ppRes.stdout.trim()) {
      const m = ppRes.stdout.match(/\[(\w+)\]/);
      gt.powerPolicy = m ? m[1] : ppRes.stdout.trim();
    }
    if (csgRes.stdout.trim()) gt.csgPeriod = parseInt(csgRes.stdout.trim(), 10) || gt.csgPeriod;

    /* Overlay saved config (used for vulkan toggles & mali driver which aren't readable from sysfs) */
    const cfgRes = await exec(`cat ${CONF_GPU_TUNING} 2>/dev/null`);
    if (cfgRes.stdout.trim()) {
      try {
        const cfg = JSON.parse(cfgRes.stdout.trim());
        if (cfg.mali_dvfs_period > 0) gt.dvfsPeriod = cfg.mali_dvfs_period;
        if (cfg.mali_idle_hysteresis_time > 0) gt.idleHysteresis = cfg.mali_idle_hysteresis_time;
        if (cfg.mali_shader_pwroff_timeout > 0) gt.shaderPwroff = cfg.mali_shader_pwroff_timeout;
        if (cfg.mali_power_policy) gt.powerPolicy = cfg.mali_power_policy;
        if (cfg.mali_csg_scheduling_period > 0) gt.csgPeriod = cfg.mali_csg_scheduling_period;
        gt.vulkanHwui = cfg.vulkan_hwui || 0;
        gt.vulkanRenderengine = cfg.vulkan_renderengine || 0;
        if (cfg.mali_driver) {
          const md = cfg.mali_driver;
          gt.maliDriver.cmarOptimizeForLatency = md.cmar_optimize_for_latency || 0;
          gt.maliDriver.glesDisableShaderLto = md.gles_disable_shader_lto || 0;
          gt.maliDriver.glesDisablePilotShaders = md.gles_disable_pilot_shaders || 0;
          gt.maliDriver.glesDisableGraphicsPipelineCache = md.gles_disable_graphics_pipeline_cache || 0;
          gt.maliDriver.glesDisableSubpassCache = md.gles_disable_subpass_cache || 0;
          gt.maliDriver.schedRtThreadPriority = md.sched_rt_thread_priority || 0;
          gt.maliDriver.optimizationLevel = md.optimization_level || 0;
          gt.maliDriver.glesDisableSurfaceAfbc = md.gles_disable_surface_afbc || 0;
          gt.maliDriver.glesDisableTextureAfbc = md.gles_disable_texture_afbc || 0;
          gt.maliDriver.glesDisableCrc = md.gles_disable_crc || 0;
          gt.maliDriver.glesDisableIdvs = md.gles_disable_idvs || 0;
          gt.maliDriver.maliPrerotate = md.mali_prerotate || 0;
        }
      } catch (e) { /* ignore parse errors */ }
    }
    gt.loaded = true;
  }

  async function _loadCpuTuningSection() {
    const ct = state.cpuTuning;
    /* Read live device values */
    const [upRes, downRes, easRes, childRes, uclampRes, fpsgoTaRes, fpsgoRescRes, idleRes, cfgRes] = await Promise.all([
      exec('cat /sys/devices/system/cpu/cpufreq/policy0/sugov_ext/up_rate_limit_us 2>/dev/null'),
      exec('cat /sys/devices/system/cpu/cpufreq/policy0/sugov_ext/down_rate_limit_us 2>/dev/null'),
      exec('cat /proc/sys/kernel/sched_energy_aware 2>/dev/null'),
      exec('cat /proc/sys/kernel/sched_child_runs_first 2>/dev/null'),
      exec('cat /dev/cpuctl/top-app/cpu.uclamp.min 2>/dev/null'),
      exec('cat /sys/kernel/fpsgo/fbt/boost_ta 2>/dev/null'),
      exec('cat /sys/kernel/fpsgo/fbt/rescue_enable 2>/dev/null'),
      exec('for s in 0 1 2 3 4 5 6; do d=$(cat /sys/devices/system/cpu/cpu0/cpuidle/state${s}/disable 2>/dev/null); [ -z "$d" ] && break; echo "${s}:${d}"; done'),
      exec(`cat ${CONF_CPU_TUNING} 2>/dev/null`),
    ]);
    if (upRes.stdout.trim()) ct.sugovUpRate = parseInt(upRes.stdout.trim(), 10) || ct.sugovUpRate;
    if (downRes.stdout.trim()) ct.sugovDownRate = parseInt(downRes.stdout.trim(), 10) || ct.sugovDownRate;
    if (easRes.stdout.trim()) ct.schedEnergyAware = parseInt(easRes.stdout.trim(), 10);
    if (childRes.stdout.trim()) ct.schedChildRunsFirst = parseInt(childRes.stdout.trim(), 10);
    if (uclampRes.stdout.trim()) {
      const pct = parseFloat(uclampRes.stdout.trim());
      ct.uclampTopAppMin = Math.round(pct / 100 * 1024);
    }
    if (fpsgoTaRes.stdout.trim()) ct.fpsgoBoostTa = parseInt(fpsgoTaRes.stdout.trim(), 10) || 0;
    if (fpsgoRescRes.stdout.trim()) ct.fpsgoRescueEnable = parseInt(fpsgoRescRes.stdout.trim(), 10) || 0;

    /* cpuidle max enabled state */
    let maxState = 6;
    for (const line of idleRes.stdout.split('\n')) {
      const m = line.match(/^(\d+):(\d+)$/);
      if (m && m[2] === '1') { maxState = parseInt(m[1], 10) - 1; break; }
    }
    ct.cpuidleMaxState = maxState >= 0 ? maxState : 0;

    /* Overlay saved config */
    if (cfgRes.stdout.trim()) {
      try {
        const cfg = JSON.parse(cfgRes.stdout.trim());
        if (cfg.sugov_up_rate_limit_us != null) ct.sugovUpRate = cfg.sugov_up_rate_limit_us;
        if (cfg.sugov_down_rate_limit_us != null) ct.sugovDownRate = cfg.sugov_down_rate_limit_us;
        if (cfg.cpuidle_max_state != null) ct.cpuidleMaxState = cfg.cpuidle_max_state;
        if (cfg.sched_energy_aware != null) ct.schedEnergyAware = cfg.sched_energy_aware;
        if (cfg.sched_child_runs_first != null) ct.schedChildRunsFirst = cfg.sched_child_runs_first;
        if (cfg.uclamp_top_app_min != null) ct.uclampTopAppMin = cfg.uclamp_top_app_min;
        if (cfg.fpsgo_boost_ta != null) ct.fpsgoBoostTa = cfg.fpsgo_boost_ta;
        if (cfg.fpsgo_rescue_enable != null) ct.fpsgoRescueEnable = cfg.fpsgo_rescue_enable;
      } catch (e) { /* ignore parse errors */ }
    }
    ct.loaded = true;
  }

  async function _loadDisplayTuningSection() {
    const dt = state.displayTuning;
    /* Read live values */
    const [peakRes, minRes, animRes, transRes, winRes, csatRes, shpRes, uresRes, dreRes, hdrRes, hfgRes, idleRes] = await Promise.all([
      exec('settings get system peak_refresh_rate 2>/dev/null'),
      exec('settings get system min_refresh_rate 2>/dev/null'),
      exec('settings get global animator_duration_scale 2>/dev/null'),
      exec('settings get global transition_animation_scale 2>/dev/null'),
      exec('settings get global window_animation_scale 2>/dev/null'),
      exec('getprop persist.sys.sf.color_saturation'),
      exec('getprop persist.vendor.sys.pq.shp.idx'),
      exec('getprop persist.vendor.sys.pq.ultrares.en'),
      exec('getprop persist.vendor.sys.pq.mdp.dre.en'),
      exec('getprop persist.vendor.sys.pq.hdr10.adaptive.en'),
      exec('getprop persist.vendor.sys.pq.hfg.en'),
      exec('cat /proc/displowpower/idletime 2>/dev/null'),
    ]);
    const pi = (r, d) => { const v = parseInt(r.stdout.trim(), 10); return isNaN(v) ? d : v; };
    const pf = (r, d) => { const v = parseFloat(r.stdout.trim()); return isNaN(v) ? d : v; };
    const ps = (r) => r.stdout.trim();

    if (ps(peakRes) && ps(peakRes) !== 'null') dt.peakRefreshRate = pi(peakRes, dt.peakRefreshRate);
    if (ps(minRes) && ps(minRes) !== 'null') dt.minRefreshRate = pi(minRes, dt.minRefreshRate);
    if (ps(animRes) && ps(animRes) !== 'null') dt.animatorDuration = pf(animRes, dt.animatorDuration);
    if (ps(transRes) && ps(transRes) !== 'null') dt.transitionDuration = pf(transRes, dt.transitionDuration);
    if (ps(winRes) && ps(winRes) !== 'null') dt.windowDuration = pf(winRes, dt.windowDuration);
    if (ps(csatRes)) dt.colorSaturation = pf(csatRes, dt.colorSaturation);
    if (ps(shpRes)) dt.sharpnessIdx = pi(shpRes, dt.sharpnessIdx);
    if (ps(uresRes)) dt.ultraResolution = pi(uresRes, dt.ultraResolution);
    if (ps(dreRes)) dt.dreEnable = pi(dreRes, dt.dreEnable);
    if (ps(hdrRes)) dt.hdrAdaptive = pi(hdrRes, dt.hdrAdaptive);
    if (ps(hfgRes)) dt.hfgLevel = pi(hfgRes, dt.hfgLevel);
    if (ps(idleRes)) dt.displayIdleTime = pi(idleRes, dt.displayIdleTime);

    /* Overlay saved config */
    const cfgRes = await exec(`cat ${CONF_DISPLAY} 2>/dev/null`);
    if (cfgRes.stdout.trim()) {
      try {
        const cfg = JSON.parse(cfgRes.stdout.trim());
        if (cfg.refresh_mode) dt.refreshMode = cfg.refresh_mode;
        if (cfg.peak_refresh_rate != null) dt.peakRefreshRate = cfg.peak_refresh_rate;
        if (cfg.min_refresh_rate != null) dt.minRefreshRate = cfg.min_refresh_rate;
        if (cfg.animator_duration != null) dt.animatorDuration = cfg.animator_duration;
        if (cfg.transition_duration != null) dt.transitionDuration = cfg.transition_duration;
        if (cfg.window_duration != null) dt.windowDuration = cfg.window_duration;
        if (cfg.color_saturation != null) dt.colorSaturation = cfg.color_saturation;
        if (cfg.sharpness_idx != null) dt.sharpnessIdx = cfg.sharpness_idx;
        if (cfg.ultra_resolution != null) dt.ultraResolution = cfg.ultra_resolution;
        if (cfg.dre_enable != null) dt.dreEnable = cfg.dre_enable;
        if (cfg.hdr_adaptive != null) dt.hdrAdaptive = cfg.hdr_adaptive;
        if (cfg.hfg_level != null) dt.hfgLevel = cfg.hfg_level;
        if (cfg.display_idle_time != null) dt.displayIdleTime = cfg.display_idle_time;
      } catch (e) { /* ignore */ }
    }
    /* Derive mode from peak/min if not explicitly saved */
    if (!dt.refreshMode || (dt.refreshMode !== 'fixed' && dt.refreshMode !== 'adaptive')) {
      dt.refreshMode = (dt.peakRefreshRate === dt.minRefreshRate) ? 'fixed' : 'adaptive';
    }
    dt.loaded = true;
  }

  async function _loadThermalSection() {
    const [, thermalCfgRes] = await Promise.all([
      loadThermalData(),
      exec(`cat ${CONF_THERMAL} 2>/dev/null`),
    ]);
    if (thermalCfgRes.stdout) {
      const cpuTM = thermalCfgRes.stdout.match(/"cpu_thermal_mode"\s*:\s*(\d+)/);
      const gpuTM = thermalCfgRes.stdout.match(/"gpu_thermal_mode"\s*:\s*(\d+)/);
      if (cpuTM) state.thermal.cpuMode = parseInt(cpuTM[1], 10) || 0;
      if (gpuTM) state.thermal.gpuMode = parseInt(gpuTM[1], 10) || 0;
    }
  }

  async function _loadRamSection() {
    const [ramAvailRes, ramCurRes, ramMinRes, ramMaxRes, ramGovRes, ramRateRes, ramTypeRes, vcoreRes] = await Promise.all([
      exec(`cat ${DRAM_DEVFREQ}/available_frequencies 2>/dev/null`),
      exec(`cat ${DRAM_DEVFREQ}/cur_freq 2>/dev/null`),
      exec(`cat ${DRAM_DEVFREQ}/min_freq 2>/dev/null`),
      exec(`cat ${DRAM_DEVFREQ}/max_freq 2>/dev/null`),
      exec(`cat ${DRAM_DEVFREQ}/governor 2>/dev/null`),
      exec(`cat ${DRAM_DATA_RATE} 2>/dev/null`),
      exec(`cat ${DRAM_TYPE_PATH} 2>/dev/null`),
      exec(`cat ${VCORE_UV_PATH} 2>/dev/null`),
    ]);
    const ramFreqs = ramAvailRes.stdout.trim()
      ? ramAvailRes.stdout.trim().split(/\s+/).map(f => parseInt(f, 10)).filter(f => !isNaN(f) && f > 0).sort((a, b) => a - b)
      : [];
    const rateMatch = ramRateRes.stdout.match(/(\d+)/);
    const typeMatch = ramTypeRes.stdout.match(/(\d+)/);
    const ramMinHz = parseInt(ramMinRes.stdout.trim(), 10) || 0;
    state.ram = {
      dataRate: rateMatch ? parseInt(rateMatch[1], 10) : 0,
      dramType: typeMatch ? (DRAM_TYPE_MAP[parseInt(typeMatch[1], 10)] || `Type ${typeMatch[1]}`) : '',
      vcoreUv: parseInt(vcoreRes.stdout.trim(), 10) || 0,
      curFreq: parseInt(ramCurRes.stdout.trim(), 10) || 0,
      minFreq: ramMinHz,
      maxFreq: parseInt(ramMaxRes.stdout.trim(), 10) || 0,
      availableFreqs: ramFreqs,
      governor: ramGovRes.stdout.trim(),
      selectedMinFreq: ramMinHz,
    };
    state.originalRamMinFreq = ramMinHz;
  }

  async function _loadProfileSection() {
    const [govListRes, govCurRes, profileCfgRes] = await Promise.all([
      exec('cat /sys/devices/system/cpu/cpufreq/policy0/scaling_available_governors 2>/dev/null'),
      exec('cat /sys/devices/system/cpu/cpufreq/policy0/scaling_governor 2>/dev/null'),
      exec(`cat ${CONF_PROFILE} 2>/dev/null`),
    ]);
    if (govListRes.stdout.trim()) {
      state.profile.availableGovernors = govListRes.stdout.trim().split(/\s+/);
    }
    if (govCurRes.stdout.trim()) {
      state.profile.governor = govCurRes.stdout.trim();
    }
    if (profileCfgRes.stdout) {
      try {
        const cfg = JSON.parse(profileCfgRes.stdout.trim());
        if (cfg.governor) state.profile.governor = cfg.governor;
        if (cfg.profiles && typeof cfg.profiles === 'object') {
          state.profile.governorProfiles = cfg.profiles;
        }
        if (cfg.auto_gaming !== undefined) {
          state.profile.autoGaming.enabled = cfg.auto_gaming === 1;
        }
        if (cfg.gaming_apps && typeof cfg.gaming_apps === 'string') {
          state.profile.autoGaming.apps = cfg.gaming_apps.split(',').filter(s => s.trim());
        }
      } catch (e) {
        /* Legacy format fallback */
        const agM = profileCfgRes.stdout.match(/"auto_gaming"\s*:\s*(\d+)/);
        const gaM = profileCfgRes.stdout.match(/"gaming_apps"\s*:\s*"([^"]*)"/);
        if (agM) state.profile.autoGaming.enabled = parseInt(agM[1], 10) === 1;
        if (gaM && gaM[1]) state.profile.autoGaming.apps = gaM[1].split(',').filter(s => s.trim());
      }
    }

    /* Ensure current governor has a profile entry */
    if (!state.profile.governorProfiles[state.profile.governor]) {
      state.profile.governorProfiles[state.profile.governor] = { ...GOVERNOR_DEFAULT_PROFILE };
      /* Populate from current cpu_oc / cpu_scaling configs if available */
      const [ocRes, scRes] = await Promise.all([
        exec(`cat ${CONF_CPU_OC} 2>/dev/null`),
        exec(`cat ${CONF_CPU_SCALING} 2>/dev/null`),
      ]);
      if (ocRes.stdout.trim()) {
        try {
          const oc = JSON.parse(ocRes.stdout.trim());
          const gp = state.profile.governorProfiles[state.profile.governor];
          for (const k of ['cpu_oc_l_freq','cpu_oc_l_volt','cpu_oc_b_freq','cpu_oc_b_volt','cpu_oc_p_freq','cpu_oc_p_volt']) {
            if (oc[k]) gp[k] = oc[k];
          }
        } catch (e) { /* ignore */ }
      }
      if (scRes.stdout.trim()) {
        try {
          const sc = JSON.parse(scRes.stdout.trim());
          const gp = state.profile.governorProfiles[state.profile.governor];
          for (const p of [0, 4, 7]) {
            if (sc[`cpu_max_${p}`]) gp[`cpu_max_${p}`] = sc[`cpu_max_${p}`];
            if (sc[`cpu_min_${p}`]) gp[`cpu_min_${p}`] = sc[`cpu_min_${p}`];
          }
        } catch (e) { /* ignore */ }
      }
    }
  }

  async function loadData() {
    showToast(t('toast.loading'), 'info');

    const modCheck = await exec(`lsmod 2>/dev/null | grep kpm_oc`);
    state.moduleLoaded = modCheck.errno === 0 && modCheck.stdout.includes('kpm_oc');
    updateModuleStatus();

    await Promise.all([
      _loadCpuSection(),
      _loadGpuSection(),
      _loadGpuTuningSection(),
      _loadCpuTuningSection(),
      _loadDisplayTuningSection(),
      _loadThermalSection(),
      _loadProfileSection(),
      _loadRamSection(),
    ]);

    renderAll();
    const cpuCount = state.cpuClusters.reduce((s, c) => s + c.entries.length, 0);
    showToast(t('toast.loaded', { cpu: cpuCount, gpu: state.gpuEntries.length, ram: state.ram.availableFreqs.length }), 'success');
  }

  /* ─── Storage Data Loading ────────────────────────────────────────── */
  async function loadStorageData() {
    const devices = [];
    for (const dev of IO_BLOCK_DEVS) {
      const base = `/sys/block/${dev}/queue`;
      const [schedRes, raRes, nrRes, nomRes, rqaRes, ioRes, arRes] = await Promise.all([
        exec(`cat ${base}/scheduler 2>/dev/null`),
        exec(`cat ${base}/read_ahead_kb 2>/dev/null`),
        exec(`cat ${base}/nr_requests 2>/dev/null`),
        exec(`cat ${base}/nomerges 2>/dev/null`),
        exec(`cat ${base}/rq_affinity 2>/dev/null`),
        exec(`cat ${base}/iostats 2>/dev/null`),
        exec(`cat ${base}/add_random 2>/dev/null`),
      ]);
      if (schedRes.stdout.trim() || raRes.stdout.trim()) {
        const schedMatch = schedRes.stdout.match(/\[([^\]]+)\]/);
        const schedAll = schedRes.stdout.trim().replace(/[\[\]]/g, '').split(/\s+/).filter(Boolean);
        devices.push({
          name: dev,
          scheduler: schedMatch ? schedMatch[1] : (schedRes.stdout.trim() || '—'),
          availableSchedulers: schedAll.length > 0 ? schedAll : IO_SCHEDULER_OPTIONS,
          readAheadKb: parseInt(raRes.stdout.trim(), 10) || 0,
          nrRequests: parseInt(nrRes.stdout.trim(), 10) || 0,
          nomerges: parseInt(nomRes.stdout.trim(), 10) || 0,
          rqAffinity: parseInt(rqaRes.stdout.trim(), 10) || 0,
          iostats: parseInt(ioRes.stdout.trim(), 10) || 0,
          addRandom: parseInt(arRes.stdout.trim(), 10) || 0,
        });
      }
    }

    /* Read UFS HCI path and controller attributes */
    const hciRes = await exec(`ls -d ${UFS_HCI_GLOB} 2>/dev/null | head -1`);
    const hciPath = hciRes.stdout.trim();
    if (hciPath) {
      state.storage.ufsHciPath = hciPath;
      const [wbRes, cgEnRes, cgDelRes, specVerRes, ahRes, rpmRes, spmRes] = await Promise.all([
        exec(`cat ${hciPath}/wb_on 2>/dev/null`),
        exec(`cat ${hciPath}/clkgate_enable 2>/dev/null`),
        exec(`cat ${hciPath}/clkgate_delay_ms 2>/dev/null || cat ${hciPath}/clkgate_delay 2>/dev/null`),
        exec(`cat ${hciPath}/device_descriptor/specification_version 2>/dev/null`),
        exec(`cat ${hciPath}/auto_hibern8 2>/dev/null`),
        exec(`cat ${hciPath}/rpm_lvl 2>/dev/null`),
        exec(`cat ${hciPath}/spm_lvl 2>/dev/null`),
      ]);
      const wbVal = parseInt(wbRes.stdout.trim(), 10);
      const cgVal = parseInt(cgEnRes.stdout.trim(), 10);
      const cgDel = parseInt(cgDelRes.stdout.trim(), 10);
      const ahVal = parseInt(ahRes.stdout.trim(), 10);
      const rpmVal = parseInt(rpmRes.stdout.trim(), 10);
      const spmVal = parseInt(spmRes.stdout.trim(), 10);
      state.storage.wbOn = isNaN(wbVal) ? -1 : wbVal;
      state.storage.clkgateEnable = isNaN(cgVal) ? -1 : cgVal;
      state.storage.clkgateDelay = isNaN(cgDel) ? 0 : cgDel;
      state.storage.autoHibern8 = isNaN(ahVal) ? -1 : ahVal;
      state.storage.rpmLvl = isNaN(rpmVal) ? -1 : rpmVal;
      state.storage.spmLvl = isNaN(spmVal) ? -1 : spmVal;
      const specRaw = specVerRes.stdout.trim(); // e.g. "0x0400"
      if (specRaw) {
        const v = parseInt(specRaw, 16);
        const major = (v >> 8) & 0xFF;
        const minor = (v >> 4) & 0x0F;
        state.storage.ufsVersion = `UFS ${major}.${minor}`;
      }
    }

    /* Use config values for user-selected fields; fall back to first device's current value */
    const ioCfgRes = await exec(`cat ${CONF_IO} 2>/dev/null`);
    if (ioCfgRes.stdout) {
      const cfg = ioCfgRes.stdout;
      const raM = cfg.match(/"io_read_ahead_kb":([0-9]+)/);
      if (raM) state.storage.readAheadKb = parseInt(raM[1], 10);
      const schedM = cfg.match(/"io_scheduler":"([^"]+)"/);
      if (schedM) state.storage.scheduler = schedM[1];
      const nomM = cfg.match(/"io_nomerges":([0-9]+)/);
      if (nomM) state.storage.nomerges = parseInt(nomM[1], 10);
      const rqaM = cfg.match(/"io_rq_affinity":([0-9]+)/);
      if (rqaM) state.storage.rqAffinity = parseInt(rqaM[1], 10);
      const ioM = cfg.match(/"io_iostats":([0-9]+)/);
      if (ioM) state.storage.iostats = parseInt(ioM[1], 10);
      const arM = cfg.match(/"io_add_random":([0-9]+)/);
      if (arM) state.storage.addRandom = parseInt(arM[1], 10);
    }
    const ufsCfgRes = await exec(`cat ${CONF_UFS} 2>/dev/null`);
    if (ufsCfgRes.stdout) {
      const uc = ufsCfgRes.stdout;
      const wbM = uc.match(/"ufs_wb_on":([0-9]+)/);
      if (wbM) state.storage.wbOn = parseInt(wbM[1], 10);
      const cgM = uc.match(/"ufs_clkgate_enable":([0-9]+)/);
      if (cgM) state.storage.clkgateEnable = parseInt(cgM[1], 10);
      const cdM = uc.match(/"ufs_clkgate_delay_ms":([0-9]+)/);
      if (cdM) state.storage.clkgateDelay = parseInt(cdM[1], 10);
      const ahM = uc.match(/"ufs_auto_hibern8":([0-9]+)/);
      if (ahM) state.storage.autoHibern8 = parseInt(ahM[1], 10);
      const rpM = uc.match(/"ufs_rpm_lvl":([0-9]+)/);
      if (rpM) state.storage.rpmLvl = parseInt(rpM[1], 10);
      const spM = uc.match(/"ufs_spm_lvl":([0-9]+)/);
      if (spM) state.storage.spmLvl = parseInt(spM[1], 10);
    }

    /* If no config value, inherit from first device */
    if (devices.length > 0) {
      const d0 = devices[0];
      if (!state.storage.readAheadKb) state.storage.readAheadKb = d0.readAheadKb || 2048;
      if (!state.storage.scheduler || state.storage.scheduler === 'none') state.storage.scheduler = d0.scheduler || 'none';
      if (state.storage.nomerges === undefined) state.storage.nomerges = d0.nomerges;
      if (state.storage.rqAffinity === undefined) state.storage.rqAffinity = d0.rqAffinity;
      if (state.storage.iostats === undefined) state.storage.iostats = d0.iostats;
      if (state.storage.addRandom === undefined) state.storage.addRandom = d0.addRandom;
    }
    state.storage.devices = devices;
  }

  function updateModuleStatus() {
    const badge = document.getElementById('module-status');
    if (!badge) return;
    if (state.moduleLoaded) {
      badge.className = 'status-badge online';
      badge.innerHTML = '<span class="status-dot"></span> ' + t('header.module_active');
    } else {
      badge.className = 'status-badge offline';
      badge.innerHTML = '<span class="status-dot"></span> ' + t('header.module_not_loaded');
    }
  }

  /* ─── Thermal Data Loading ────────────────────────────────────────── */
  async function loadThermalData() {
    // Use string concatenation to avoid JS template-literal ${} interpolation conflicts
    const cmd =
      'for f in /sys/class/thermal/thermal_zone*/; do' +
      ' type=$(cat "${f}type" 2>/dev/null); temp=$(cat "${f}temp" 2>/dev/null);' +
      ' case "$type" in *cpu*|*CPU*|*gpu*|*GPU*|*mali*|*batt*|*soc*|*skin*)' +
      ' echo "Z|${type}|${temp:-0}";; esac; done;' +
      ' for f in /sys/class/thermal/thermal_zone*/; do' +
      ' type=$(cat "${f}type" 2>/dev/null);' +
      ' case "$type" in *cpu*|*CPU*|*mtk*|*soc*|*skin*)' +
      ' for tp in "${f}"trip_point_*_temp; do' +
      ' [ -f "$tp" ] && t=$(cat "$tp" 2>/dev/null) && echo "T|${tp}|${t:-0}";' +
      ' done;; esac; done';
    const r = await exec(cmd);
    const temps = {};
    const trips = [];
    for (const line of r.stdout.split('\n')) {
      if (!line.trim()) continue;
      const p = line.split('|');
      if (p[0] === 'Z' && p.length >= 3) {
        temps[p[1]] = Math.round(parseInt(p[2], 10) / 1000);
      } else if (p[0] === 'T' && p.length >= 3) {
        trips.push({ path: p[1], origTemp: parseInt(p[2], 10) || 0 });
      }
    }
    state.thermal.temps = temps;
    // Store originals only once (before any modification)
    if (state.thermal.cpuOrigTrips.length === 0 && trips.length > 0) {
      state.thermal.cpuOrigTrips = trips;
    }
  }

  /* ─── Refresh Temps (no trip re-read, faster) ─────────────────────── */
  async function refreshTemps() {
    const cmd =
      'for f in /sys/class/thermal/thermal_zone*/; do' +
      ' type=$(cat "${f}type" 2>/dev/null); temp=$(cat "${f}temp" 2>/dev/null);' +
      ' case "$type" in *cpu*|*CPU*|*gpu*|*GPU*|*mali*|*batt*|*soc*|*skin*)' +
      ' echo "Z|${type}|${temp:-0}";; esac; done';
    const r = await exec(cmd);
    for (const line of r.stdout.split('\n')) {
      const p = line.split('|');
      if (p[0] === 'Z' && p.length >= 3) {
        state.thermal.temps[p[1]] = Math.round(parseInt(p[2], 10) / 1000);
      }
    }
    const cpuEl = document.getElementById('cpu-thermal-card');
    if (cpuEl) cpuEl.innerHTML = renderThermalCard('cpu');
    const gpuEl = document.getElementById('gpu-thermal-card');
    if (gpuEl) gpuEl.innerHTML = renderThermalCard('gpu');
  }

  /* ─── Set Thermal Mode ────────────────────────────────────────────── */
  function setThermalMode(type, mode) {
    if (type === 'gpu') state.thermal.gpuMode = mode;
    else state.thermal.cpuMode = mode;
    const el = document.getElementById(`${type}-thermal-card`);
    if (el) el.innerHTML = renderThermalCard(type);
  }

  /* ─── GPU Tuning Setter ───────────────────────────────────────────── */
  function setGpuTuning(field, value) {
    if (field.startsWith('maliDriver.')) {
      const subField = field.slice('maliDriver.'.length);
      state.gpuTuning.maliDriver[subField] = value;
    } else {
      state.gpuTuning[field] = value;
    }
    const el = document.getElementById('gpu-tuning-card');
    if (el) el.innerHTML = renderGpuTuningCard();
  }

  /* ─── CPU Tuning Setter ───────────────────────────────────────────── */
  function setCpuTuning(field, value) {
    state.cpuTuning[field] = value;
    const el = document.getElementById('cpu-tuning-card');
    if (el) el.innerHTML = renderCpuTuningCard();
  }

  /* ─── Display Tuning Setter ─────────────────────────────────────── */
  function setDisplayTuning(field, value) {
    const dt = state.displayTuning;
    dt[field] = value;
    /* In fixed mode, lock min = peak */
    if (field === 'refreshMode' && value === 'fixed') {
      dt.minRefreshRate = dt.peakRefreshRate;
    } else if (field === 'refreshMode' && value === 'adaptive') {
      dt.minRefreshRate = 90;
    } else if (field === 'peakRefreshRate' && dt.refreshMode === 'fixed') {
      dt.minRefreshRate = value;
    }
    const el = document.getElementById('display-tuning-card');
    if (el) el.innerHTML = renderDisplayTuningCard();
  }

  /* ─── Apply Thermal Mitigation ────────────────────────────────────── */
  async function applyThermal() {
    const cpuMode = state.thermal.cpuMode;
    const gpuMode = state.thermal.gpuMode;
    const msgs = [];

    /* ── CPU ── */
    if (cpuMode === 0) {
      // Restore original trip point temperatures (best-effort; may be read-only)
      if (state.thermal.cpuOrigTrips.length > 0) {
        for (const { path, origTemp } of state.thermal.cpuOrigTrips) {
          if (path && origTemp > 0) await exec('echo ' + origTemp + ' > ' + path + ' 2>/dev/null');
        }
      }
    } else {
      // Re-trigger KPM OC relift — freq_qos kprobe already intercepts thermal reductions
      await exec('echo 1 > /sys/module/kpm_oc/parameters/cpu_oc_apply 2>/dev/null');
      msgs.push(t('thermal.cpu_restamped'));
      // Best-effort trip point raise (writable on some kernels)
      const delta = cpuMode === 1 ? 15000 : 30000;
      const raiseCmd =
        'for tz in /sys/class/thermal/thermal_zone*/; do' +
        ' type=$(cat "${tz}type" 2>/dev/null);' +
        ' case "$type" in *cpu*|*CPU*|*soc*|*skin*)' +
        ' for f in "${tz}"trip_point_*_temp; do' +
        ' [ -f "$f" ] && t=$(cat "$f" 2>/dev/null) && [ -n "$t" ] && echo "$((t+' + delta + '))" > "$f" 2>/dev/null;' +
        ' done;; esac; done';
      await exec(raiseCmd);
      if (cpuMode >= 2) {
        // Lock CPU freq cooling devices to state 0 (no-op if absent)
        const lockCmd =
          'for cd in /sys/class/thermal/cooling_device*/; do' +
          ' type=$(cat "${cd}type" 2>/dev/null);' +
          ' case "$type" in *cpufreq*|*cpu-freq*|*cpu_freq*)' +
          ' echo 0 > "${cd}cur_state" 2>/dev/null;; esac; done';
        await exec(lockCmd);
        msgs.push(t('thermal.cooling_locked'));
      }
    }

    /* ── GPU ── */
    if (gpuMode === 0) {
      // Release OPP pin if it was held
      if (state.thermal.gpuFixActive) {
        await exec('echo -1 > /proc/gpufreqv2/fix_target_opp_index 2>/dev/null');
        state.thermal.gpuFixActive = false;
        msgs.push(t('thermal.gpu_pin_released'));
      }
    } else {
      // Lock GPU cooling devices to state 0
      const gpuLockCmd =
        'for cd in /sys/class/thermal/cooling_device*/; do' +
        ' type=$(cat "${cd}type" 2>/dev/null);' +
        ' case "$type" in *gpu*|*GPU*|*mali*|*Mali*|*GED*)' +
        ' echo 0 > "${cd}cur_state" 2>/dev/null;; esac; done';
      await exec(gpuLockCmd);
      msgs.push(t('thermal.gpu_cdevs_locked'));
      if (gpuMode >= 2 && !state.thermal.gpuFixActive) {
        await exec('echo 0 > /proc/gpufreqv2/fix_target_opp_index 2>/dev/null');
        state.thermal.gpuFixActive = true;
        msgs.push(t('thermal.gpu_opp_pinned'));
      }
    }

    if (msgs.length > 0) showToast(t('thermal.toast', { details: msgs.join(', ') }), 'success');

    const cpuEl = document.getElementById('cpu-thermal-card');
    if (cpuEl) cpuEl.innerHTML = renderThermalCard('cpu');
    const gpuEl = document.getElementById('gpu-thermal-card');
    if (gpuEl) gpuEl.innerHTML = renderThermalCard('gpu');
  }

  /* ─── Governor Selection ─────────────────────────────────────────────── */
  function setGovernor(gov) {
    /* Save current governor's in-memory profile before switching */
    state.profile.governor = gov;
    /* Ensure the selected governor has a profile */
    if (!state.profile.governorProfiles[gov]) {
      state.profile.governorProfiles[gov] = { ...GOVERNOR_DEFAULT_PROFILE };
    }
    renderAll();
  }

  function setGovProfile(key, value) {
    const gov = state.profile.governor;
    if (!state.profile.governorProfiles[gov]) {
      state.profile.governorProfiles[gov] = { ...GOVERNOR_DEFAULT_PROFILE };
    }
    state.profile.governorProfiles[gov][key] = value;
  }

  /** Quick hardware apply for gaming boost/un-boost (bypasses full applyAll flow) */
  async function applyPowerModeQuick(mode) {
    if (mode === 'performance') {
      /* Gaming boost ON: performance governor + max freq */
      for (const p of [0, 4, 7]) {
        await exec('echo performance > /sys/devices/system/cpu/cpufreq/policy' + p + '/scaling_governor 2>/dev/null');
      }
      await exec('echo 3800000 > /sys/devices/system/cpu/cpufreq/policy0/scaling_max_freq 2>/dev/null');
      await exec('echo 3800000 > /sys/devices/system/cpu/cpufreq/policy4/scaling_max_freq 2>/dev/null');
      await exec('echo 4000000 > /sys/devices/system/cpu/cpufreq/policy7/scaling_max_freq 2>/dev/null');
      await exec('echo 6400000000 > ' + DRAM_DEVFREQ + '/min_freq 2>/dev/null');
      state.thermal.cpuMode = 1;
      state.thermal.gpuMode = 1;
      await applyThermal();
      await exec('echo 1 > ' + KS_PARAMS + 'cpu_oc_apply 2>/dev/null');
      await exec('echo 1 > ' + KS_PARAMS + 'gpu_oc_apply 2>/dev/null');
    } else {
      /* Revert to saved governor + profile settings */
      const gov = state.profile.governor;
      const gp = state.profile.governorProfiles[gov] || GOVERNOR_DEFAULT_PROFILE;
      for (const p of [0, 4, 7]) {
        await exec('echo ' + gov + ' > /sys/devices/system/cpu/cpufreq/policy' + p + '/scaling_governor 2>/dev/null');
        if (gp[`cpu_max_${p}`] > 0) {
          await exec('echo ' + gp[`cpu_max_${p}`] + ' > /sys/devices/system/cpu/cpufreq/policy' + p + '/scaling_max_freq 2>/dev/null');
        }
      }
      if (gp.dram_min > 0) {
        await exec('echo ' + gp.dram_min + ' > ' + DRAM_DEVFREQ + '/min_freq 2>/dev/null');
      }
      state.thermal.cpuMode = gp.cpu_thermal || 0;
      state.thermal.gpuMode = gp.gpu_thermal || 0;
      await applyThermal();
    }
  }

  /* ─── Auto Gaming: App Loading ────────────────────────────────────── */
  async function loadInstalledApps() {
    const ag = state.profile.autoGaming;
    ag.loading = true;
    const selectorEl = document.getElementById('gaming-app-selector');
    if (selectorEl) selectorEl.innerHTML = renderAppSelector();

    // Fast: package names only
    const pkgRes = await exec('pm list packages -3 2>/dev/null | sed "s/package://" | sort');
    const pkgs = pkgRes.stdout.trim().split('\n').filter(function(p) { return p.trim().length > 0; });
    ag.allApps = pkgs.map(function(p) {
      var pkg = p.trim();
      return { pkg: pkg, label: pkg.split('.').pop() };
    });
    ag.loading = false;
    if (selectorEl) selectorEl.innerHTML = renderAppSelector();

    // Async: load localized labels via IconExtractor -l (uses device locale)
    var DEX = '/data/adb/modules/f8_kpm_oc_manager/icon_extractor.dex';
    var labelCmd = 'app_process -Djava.class.path=' + DEX + ' / IconExtractor -l ' + pkgs.join(' ') + ' 2>/dev/null';
    const labelRes = await exec(labelCmd);
    if (labelRes.stdout.trim()) {
      const labelMap = {};
      for (const line of labelRes.stdout.trim().split('\n')) {
        const sep = line.indexOf('|');
        if (sep < 0) continue;
        labelMap[line.substring(0, sep).trim()] = line.substring(sep + 1).trim();
      }
      for (const app of ag.allApps) {
        if (labelMap[app.pkg]) app.label = labelMap[app.pkg];
      }
      if (selectorEl) selectorEl.innerHTML = renderAppSelector();
    }

    // Async: load app icons (non-blocking)
    loadAppIcons();
  }

  /** Load app icons via app_process + icon_extractor.dex */
  async function loadAppIcons() {
    const ag = state.profile.autoGaming;
    if (ag.allApps.length === 0) return;

    var DEX = '/data/adb/modules/f8_kpm_oc_manager/icon_extractor.dex';
    var pkgs = ag.allApps.map(function(a) { return a.pkg; });

    // Single app_process invocation for all packages (startup is expensive)
    var cmd = 'app_process -Djava.class.path=' + DEX + ' / IconExtractor ' + pkgs.join(' ') + ' 2>/dev/null';
    var res = await exec(cmd);
    if (!res.stdout.trim()) return;

    var changed = false;
    for (var _i3 = 0, _lines = res.stdout.trim().split('\n'); _i3 < _lines.length; _i3++) {
      var line = _lines[_i3];
      var sep = line.indexOf('|');
      if (sep < 0) continue;
      var pkg = line.substring(0, sep);
      var b64 = line.substring(sep + 1);
      if (b64.length > 20) {
        ag.iconMap[pkg] = b64;
        changed = true;
      }
    }

    if (changed) {
      var container = document.querySelector('.app-list-container');
      if (container) {
        var scrollTop = container.scrollTop;
        var el = document.getElementById('gaming-app-selector');
        if (el && ag._selectorVisible) el.innerHTML = renderAppSelector();
        container = document.querySelector('.app-list-container');
        if (container) container.scrollTop = scrollTop;
      }
      var profileEl = document.getElementById('profile-content');
      if (profileEl) profileEl.innerHTML = renderProfileContent();
    }
  }

  function showAppSelector() {
    state.profile.autoGaming._selectorVisible = true;
    state.profile.autoGaming._searchQuery = '';
    if (state.profile.autoGaming.allApps.length === 0) {
      loadInstalledApps();
    }
    const el = document.getElementById('gaming-app-selector');
    if (el) el.innerHTML = renderAppSelector();
  }

  function hideAppSelector() {
    state.profile.autoGaming._selectorVisible = false;
    const el = document.getElementById('gaming-app-selector');
    if (el) el.innerHTML = '';
  }

  function filterApps(query) {
    state.profile.autoGaming._searchQuery = query;
    const listEl = document.querySelector('.app-list-container');
    const scrollTop = listEl ? listEl.scrollTop : 0;
    const el = document.getElementById('gaming-app-selector');
    if (el) el.innerHTML = renderAppSelector();
    const newListEl = document.querySelector('.app-list-container');
    if (newListEl) newListEl.scrollTop = scrollTop;
  }

  function toggleGamingApp(pkg) {
    const apps = state.profile.autoGaming.apps;
    const idx = apps.indexOf(pkg);
    if (idx >= 0) apps.splice(idx, 1);
    else apps.push(pkg);
    /* Save scroll position before re-render */
    const listEl = document.querySelector('.app-list-container');
    const scrollTop = listEl ? listEl.scrollTop : 0;
    const el = document.getElementById('gaming-app-selector');
    if (el) el.innerHTML = renderAppSelector();
    const profileEl = document.getElementById('profile-content');
    if (profileEl) profileEl.innerHTML = renderProfileContent();
    /* Restore scroll position after re-render */
    const newListEl = document.querySelector('.app-list-container');
    if (newListEl) newListEl.scrollTop = scrollTop;
  }

  function removeGamingApp(pkg) {
    const apps = state.profile.autoGaming.apps;
    const idx = apps.indexOf(pkg);
    if (idx >= 0) apps.splice(idx, 1);
    const listEl = document.querySelector('.app-list-container');
    const scrollTop = listEl ? listEl.scrollTop : 0;
    const profileEl = document.getElementById('profile-content');
    if (profileEl) profileEl.innerHTML = renderProfileContent();
    if (state.profile.autoGaming._selectorVisible) {
      const el = document.getElementById('gaming-app-selector');
      if (el) el.innerHTML = renderAppSelector();
    }
    const newListEl = document.querySelector('.app-list-container');
    if (newListEl) newListEl.scrollTop = scrollTop;
  }

  function toggleAutoGaming(enabled) {
    state.profile.autoGaming.enabled = enabled;
    if (!enabled) stopGamingMonitor();
    const el = document.getElementById('profile-content');
    if (el) el.innerHTML = renderProfileContent();
  }

  /* ─── Auto Gaming: Foreground Monitor ─────────────────────────────── */
  async function startGamingMonitor() {
    const ag = state.profile.autoGaming;
    if (ag.pollTimer) clearInterval(ag.pollTimer);
    if (!ag.enabled || ag.apps.length === 0) return;

    ag.pollTimer = setInterval(function() { checkForegroundApp(); }, 5000);
    await checkForegroundApp();
    const el = document.getElementById('profile-content');
    if (el) el.innerHTML = renderProfileContent();
  }

  function stopGamingMonitor() {
    const ag = state.profile.autoGaming;
    if (ag.pollTimer) {
      clearInterval(ag.pollTimer);
      ag.pollTimer = null;
    }
    if (ag.boosted) {
      ag.boosted = false;
      applyPowerModeQuick('revert');
    }
    const el = document.getElementById('profile-content');
    if (el) el.innerHTML = renderProfileContent();
  }

  async function checkForegroundApp() {
    const ag = state.profile.autoGaming;
    const fgCmd =
      'FG=""; ' +
      'FG=$(dumpsys activity activities 2>/dev/null | grep "ResumedActivity" | head -1 | ' +
      "sed 's|.*u0 ||;s|/.*||;s| .*||'); " +
      '[ -z "$FG" ] && FG=$(dumpsys window 2>/dev/null | grep "mCurrentFocus" | tail -1 | ' +
      "sed 's|.*{[^ ]* [^ ]* ||;s|/.*||;s|}.*||'); " +
      'echo "$FG"';
    const res = await exec(fgCmd);
    const fgPkg = res.stdout.trim();
    ag.activeApp = fgPkg;

    const isGaming = fgPkg && ag.apps.includes(fgPkg);
    if (isGaming && !ag.boosted) {
      ag.boosted = true;
      showToast(t('toast.gaming_boost_on', { app: fgPkg }), 'success');
      await applyPowerModeQuick('performance');
      const el = document.getElementById('profile-content');
      if (el) el.innerHTML = renderProfileContent();
    } else if (!isGaming && ag.boosted) {
      ag.boosted = false;
      showToast(t('toast.gaming_boost_off'), 'info');
      await applyPowerModeQuick('revert');
      const el = document.getElementById('profile-content');
      if (el) el.innerHTML = renderProfileContent();
    }
  }

  /* ─── Gaming Daemon Management ───────────────────────────────────── */
  async function restartGamingDaemon() {
    await exec(
      '[ -f ' + CONFIG_DIR + '/gaming_monitor.pid ] && kill $(cat ' + CONFIG_DIR + '/gaming_monitor.pid) 2>/dev/null;' +
      ' rm -f ' + CONFIG_DIR + '/gaming_monitor.pid;' +
      ' nohup sh ' + CONFIG_DIR + '/gaming_monitor.sh > /dev/null 2>&1 &'
    );
  }

  async function stopGamingDaemon() {
    await exec(
      '[ -f ' + CONFIG_DIR + '/gaming_monitor.pid ] && kill $(cat ' + CONFIG_DIR + '/gaming_monitor.pid) 2>/dev/null;' +
      ' rm -f ' + CONFIG_DIR + '/gaming_monitor.pid'
    );
  }

  /* ─── Scan & Reload ───────────────────────────────────────────────── */
  async function scanAndLoad() {
    showToast(t('toast.reloading'), 'info');
    if (state.moduleLoaded) {
      await reliftCpuConstraintsIfNeeded();
      await reliftGpuConstraintsIfNeeded();
      await exec(`echo 1 > ${KS_PARAMS}apply 2>/dev/null`);
      await new Promise(r => setTimeout(r, 500));
    }
    await loadData();
    await loadStorageData();
    renderAll();
  }

  /* ─── Cell Change Handler ─────────────────────────────────────────── */
  function onCellChange(input) {
    const type = input.dataset.type;
    const clusterId = parseInt(input.dataset.cluster, 10);
    const idx = parseInt(input.dataset.idx, 10);
    const field = input.dataset.field;
    const isMhz = input.dataset.unit === 'mhz';
    let newValue = parseInt(input.value, 10);

    if (isNaN(newValue) || newValue < 0) {
      showToast(t('toast.invalid_value'), 'error');
      return;
    }

    /* freq inputs display MHz — convert to KHz for internal state */
    if (field === 'freq' && isMhz) {
      if (newValue > 10000) {
        showToast(t('cpu.mhz_input_error'), 'error');
        return;
      }
      newValue = newValue * 1000;
    }

    let entry;
    if (type === 'CPU') {
      const cluster = state.cpuClusters.find(c => c.id === clusterId);
      if (cluster) entry = cluster.entries[idx];
    } else {
      entry = state.gpuEntries[idx];
    }
    if (!entry) return;

    entry[field] = newValue;
    entry.modified = (entry.freq !== entry.origFreq || entry.volt !== entry.origVolt);

    input.classList.toggle('modified', entry.modified);
    const row = input.closest('tr');
    if (row) {
      row.classList.toggle('modified', entry.modified && !entry.isNew);
      if (type === 'GPU') row.classList.toggle('gpu-row', entry.modified);
    }
  }

  /* ─── Storage Change Handlers ────────────────────────────────────── */
  function onStorageReadAheadChange(select) {
    state.storage.readAheadKb = parseInt(select.value, 10) || 2048;
  }

  function onStorageSchedulerChange(select) {
    state.storage.scheduler = select.value || 'none';
  }

  function onStorageFieldChange(field, select) {
    state.storage[field] = parseInt(select.value, 10) || 0;
  }

  function onStorageToggle(field, checked) {
    state.storage[field] = checked ? 1 : 0;
  }

  /* ─── RAM Min Freq Change Handler ──────────────────────────────────── */
  function onRamMinFreqChange(select) {
    state.ram.selectedMinFreq = parseInt(select.value, 10) || 0;
  }

  /* ─── Add / Remove / Restore ──────────────────────────────────────── */
  function toggleAddForm(type, clusterId) {
    const form = document.getElementById(`${type.toLowerCase()}-add-form-${clusterId}`);
    if (form) form.classList.toggle('visible');
  }

  function confirmAddEntry(type, clusterId) {
    const freqInput = document.getElementById(`add-${type.toLowerCase()}-freq-${clusterId}`);
    const voltInput = document.getElementById(`add-${type.toLowerCase()}-volt-${clusterId}`);
    if (!freqInput || !voltInput) return;

    let freq = parseInt(freqInput.value, 10);
    const volt = parseInt(voltInput.value, 10);

    if (isNaN(freq) || freq <= 0) { showToast(t('toast.invalid_freq'), 'error'); return; }
    if (isNaN(volt) || volt <= 0) { showToast(t('toast.invalid_volt'), 'error'); return; }
    if (freq > 10000) { showToast(t('cpu.mhz_input_error'), 'error'); return; }

    /* Input is in MHz — convert to KHz for internal state */
    freq = freq * 1000;

    const newEntry = {
      freq, volt, vsram: 0,
      origFreq: 0, origVolt: 0,
      modified: false, isNew: true, removing: false,
    };

    if (type === 'CPU') {
      const cluster = state.cpuClusters.find(c => c.id === clusterId);
      if (cluster) {
        cluster.entries.push(newEntry);
        cluster.entries.sort((a, b) => a.freq - b.freq);
        if (!cluster.freqs.includes(freq)) {
          cluster.freqs.push(freq);
          cluster.freqs.sort((a, b) => a - b);
        }
        if (!cluster.curMax || freq > cluster.curMax) {
          cluster.curMax = freq;
        }
      }
    } else {
      state.gpuEntries.push(newEntry);
      state.gpuEntries.sort((a, b) => a.freq - b.freq);
    }

    freqInput.value = '';
    voltInput.value = '';
    toggleAddForm(type, clusterId);
    renderAll();
    showToast(t(type === 'CPU' ? 'cpu.opp_added' : 'gpu.opp_added', { freq: formatFreqKHz(freq) }), 'success');
  }

  function removeRow(type, clusterId, idx) {
    if (type === 'CPU') {
      const cluster = state.cpuClusters.find(c => c.id === clusterId);
      if (!cluster || !cluster.entries[idx]) return;
      if (cluster.entries[idx].isNew) {
        cluster.entries.splice(idx, 1);
      } else {
        cluster.entries[idx].removing = !cluster.entries[idx].removing;
      }
    } else {
      if (!state.gpuEntries[idx]) return;
      if (state.gpuEntries[idx].isNew) {
        state.gpuEntries.splice(idx, 1);
      } else {
        state.gpuEntries[idx].removing = !state.gpuEntries[idx].removing;
      }
    }
    renderAll();
  }

  function restoreRow(type, clusterId, idx) {
    if (type === 'CPU') {
      const cluster = state.cpuClusters.find(c => c.id === clusterId);
      const origCluster = state.originalCpu.find(c => c.id === clusterId);
      if (!cluster || !cluster.entries[idx]) return;
      if (cluster.entries[idx].isNew) {
        cluster.entries.splice(idx, 1);
      } else if (origCluster && origCluster.entries[idx]) {
        cluster.entries[idx].freq = origCluster.entries[idx].freq;
        cluster.entries[idx].volt = origCluster.entries[idx].volt;
        cluster.entries[idx].modified = false;
        cluster.entries[idx].removing = false;
      }
    } else {
      if (!state.gpuEntries[idx]) return;
      if (state.gpuEntries[idx].isNew) {
        state.gpuEntries.splice(idx, 1);
      } else if (state.originalGpu[idx]) {
        state.gpuEntries[idx].freq = state.originalGpu[idx].freq;
        state.gpuEntries[idx].volt = state.originalGpu[idx].volt;
        state.gpuEntries[idx].modified = false;
        state.gpuEntries[idx].removing = false;
      }
    }
    renderAll();
  }

  /* ─── Exec with error check ───────────────────────────────────────── */
  async function execChecked(cmd, label) {
    const res = await exec(cmd);
    if (res.errno !== 0) {
      console.error(`[OC] ${label} FAILED (errno=${res.errno}): ${res.stderr}`);
      showToast(t('toast.error', { label, err: res.stderr || 'errno=' + res.errno }), 'error');
    }
    return res;
  }

  async function reliftCpuConstraintsIfNeeded() {
    const bRes = await exec(`cat ${KS_PARAMS}cpu_oc_b_freq 2>/dev/null`);
    const pRes = await exec(`cat ${KS_PARAMS}cpu_oc_p_freq 2>/dev/null`);
    const lRes = await exec(`cat ${KS_PARAMS}cpu_oc_l_freq 2>/dev/null`);
    const b = parseInt(bRes.stdout.trim(), 10) || 0;
    const p = parseInt(pRes.stdout.trim(), 10) || 0;
    const l = parseInt(lRes.stdout.trim(), 10) || 0;

    if (b > 0 || p > 0 || l > 0) {
      await execChecked(`echo 1 > ${KS_PARAMS}cpu_oc_apply`, 'cpu_oc_apply(relift)');
      await new Promise(r => setTimeout(r, 250));
    }
  }

  async function ensureCpuMax(policyId, target) {
    if (!target || target <= 0) return target;

    let actual = 0;
    for (let i = 0; i < 3; i++) {
      /* Best-effort: scaling_max_freq may not be writable in APatch context. */
      await exec(`echo ${target} > /sys/devices/system/cpu/cpufreq/policy${policyId}/scaling_max_freq 2>/dev/null`);
      const maxRes = await exec(`cat /sys/devices/system/cpu/cpufreq/policy${policyId}/scaling_max_freq 2>/dev/null`);
      actual = parseInt(maxRes.stdout.trim(), 10) || 0;
      if (actual >= target) return actual;

      await execChecked(`echo 1 > ${KS_PARAMS}cpu_oc_apply`, `cpu_oc_apply retry p${policyId}`);
      await new Promise(r => setTimeout(r, 250));
    }

    return actual;
  }

  async function resolveGpuDevfreqPath() {
    const fileRes = await exec(`cat ${GPU_DEVFREQ_PATH_FILE} 2>/dev/null`);
    const fromFile = (fileRes.stdout || '').trim();
    if (fromFile.startsWith('/sys/class/devfreq/')) {
      const chk = await exec(`[ -d '${fromFile}' ] && echo OK || echo NG`);
      if (chk.stdout.trim() === 'OK') return fromFile;
    }

    const chkFallback = await exec(`[ -d '${GPU_DEVFREQ_FALLBACK}' ] && echo OK || echo NG`);
    if (chkFallback.stdout.trim() === 'OK') return GPU_DEVFREQ_FALLBACK;

    return '';
  }

  async function ensureGpuMax(targetKHz) {
    if (!targetKHz || targetKHz <= 0) return 0;

    const targetHz = Math.round(targetKHz * 1000);
    let actual = 0;
    const devfreqPath = await resolveGpuDevfreqPath();
    if (!devfreqPath) return 0;

    for (let i = 0; i < 3; i++) {
      /* Best-effort: devfreq max_freq may not be writable in APatch context. */
      await exec(`echo ${targetHz} > ${devfreqPath}/max_freq 2>/dev/null`);
      const maxRes = await exec(`cat ${devfreqPath}/max_freq 2>/dev/null`);
      actual = parseInt(maxRes.stdout.trim(), 10) || 0;
      if (actual >= targetHz) return actual;

      await execChecked(`echo 1 > ${KS_PARAMS}gpu_oc_apply`, 'gpu_oc_apply retry');
      await new Promise(r => setTimeout(r, 250));
    }

    return actual;
  }

  async function reliftGpuConstraintsIfNeeded() {
    const fRes = await exec(`cat ${KS_PARAMS}gpu_target_freq 2>/dev/null`);
    const f = parseInt(fRes.stdout.trim(), 10) || 0;
    if (f <= 0) return;

    await execChecked(`echo 1 > ${KS_PARAMS}gpu_oc_apply`, 'gpu_oc_apply(relift)');
    await new Promise(r => setTimeout(r, 250));
  }

  /* ─── Apply All Changes ───────────────────────────────────────────── */
  /* ─── Section-specific apply functions ──────────────────────────────── */

  async function applyCpu() {
    showToast(t('toast.applying'), 'info');
    let anyOcApplied = false;

    /* --- CPU OC: detect entries above stock max, apply via kpm_oc --- */
    const clusterParamMap = { 0: 'l', 4: 'b', 7: 'p' };
    let cpuOcNeeded = false;
    let cpuReliftNeeded = false;

    for (const cluster of state.cpuClusters) {
      const key = clusterParamMap[cluster.id];
      if (!key) continue;

      const active = cluster.entries.filter(e => !e.removing);
      const maxEntry = active.length > 0
        ? active.reduce((m, e) => e.freq > m.freq ? e : m)
        : null;

      const origCluster = state.originalCpu.find(c => c.id === cluster.id);
      const origEntries = origCluster ? origCluster.entries : [];
      const origMax = origEntries.length > 0
        ? Math.max(...origEntries.map(e => e.freq))
        : 0;

      const anyRemoving = cluster.entries.some(e => e.removing);
      if (maxEntry && (maxEntry.isNew || maxEntry.modified || maxEntry.freq !== origMax || anyRemoving)) {
        await execChecked(`echo ${maxEntry.freq} > ${KS_PARAMS}cpu_oc_${key}_freq`, `CPU ${key} freq`);
        await execChecked(`echo ${maxEntry.volt} > ${KS_PARAMS}cpu_oc_${key}_volt`, `CPU ${key} volt`);
        cpuOcNeeded = true;
      }

      /* Scaling limits */
      const maxSel = document.getElementById(`cpu-max-freq-${cluster.id}`);
      const minSel = document.getElementById(`cpu-min-freq-${cluster.id}`);
      if (maxSel) {
        const v = parseInt(maxSel.value, 10);
        if (!isNaN(v) && v > 0) {
          const applied = await ensureCpuMax(cluster.id, v);
          cluster.curMax = applied > 0 ? applied : v;
          if (v > origMax) cpuReliftNeeded = true;
        }
      }
      if (minSel) {
        const v = parseInt(minSel.value, 10);
        if (!isNaN(v) && v > 0) {
          await execChecked(`echo ${v} > /sys/devices/system/cpu/cpufreq/policy${cluster.id}/scaling_min_freq`, `scaling_min p${cluster.id}`);
          cluster.curMin = v;
        }
      }
    }

    if (cpuOcNeeded || cpuReliftNeeded) {
      await execChecked(`echo 1 > ${KS_PARAMS}cpu_oc_apply`, 'cpu_oc_apply');
      anyOcApplied = true;

      await new Promise(r => setTimeout(r, 300));
      for (const cluster of state.cpuClusters) {
        const freqRes = await exec(`cat /sys/devices/system/cpu/cpufreq/policy${cluster.id}/scaling_available_frequencies 2>/dev/null`);
        if (freqRes.stdout.trim()) {
          cluster.freqs = freqRes.stdout.trim().split(/\s+/)
            .map(f => parseInt(f, 10)).filter(f => !isNaN(f)).sort((a, b) => a - b);
        }
        const active = cluster.entries.filter(e => !e.removing);
        const maxEntry = active.length > 0
          ? active.reduce((m, e) => e.freq > m.freq ? e : m)
          : null;
        if (maxEntry && maxEntry.freq > 0) {
          const applied = await ensureCpuMax(cluster.id, maxEntry.freq);
          cluster.curMax = applied > 0 ? applied : maxEntry.freq;
        }
        const maxRes = await exec(`cat /sys/devices/system/cpu/cpufreq/policy${cluster.id}/scaling_max_freq 2>/dev/null`);
        const actualMax = parseInt(maxRes.stdout.trim(), 10);
        if (actualMax > 0) cluster.curMax = actualMax;
      }
      renderAll();
    }

    /* CPU: per-LUT voltage overrides */
    {
      const clusterIdxMap = { 0: 0, 4: 1, 7: 2 };
      const voltOverrides = [];
      for (const cluster of state.cpuClusters) {
        const ci = clusterIdxMap[cluster.id];
        if (ci === undefined) continue;
        const activeEntries = cluster.entries.filter(e => !e.removing);
        const entryCount = activeEntries.length;
        let activeIdx = 0;
        for (let i = 0; i < cluster.entries.length; i++) {
          const entry = cluster.entries[i];
          if (entry.removing) continue;
          if ((entry.modified || entry.isNew) && entry.volt !== entry.origVolt) {
            const lutIdx = entryCount - 1 - activeIdx;
            voltOverrides.push(`${ci}:${lutIdx}:${entry.volt}`);
          }
          activeIdx++;
        }
      }
      if (voltOverrides.length > 0) {
        await execChecked(
          `echo '${voltOverrides.join(' ')}' > ${KS_PARAMS}cpu_volt_override`,
          'cpu_volt_override');
        anyOcApplied = true;
      }
    }

    await applyThermal();
    await applyCpuTuning();
    await exec(`mkdir -p ${CONF_DIR}`);
    await saveCpuConfig();
    await saveCpuTuningConfig();
    await saveThermalConfig();

    /* Reload CPU section to reflect applied changes */
    await _loadCpuSection();
    await _loadCpuTuningSection();
    await _loadThermalSection();
    renderAll();

    if (anyOcApplied) {
      const cpuRes     = await exec(`cat ${KS_PARAMS}cpu_oc_result 2>/dev/null`);
      const cpuVoltRes = await exec(`cat ${KS_PARAMS}cpu_volt_ov_result 2>/dev/null`);
      const details = [cpuRes.stdout.trim(), cpuVoltRes.stdout.trim()]
        .filter(s => s && s !== 'NOOP' && s !== '(null)').join(' | ');
      showToast(t('toast.applied_saved', { details }), 'success');
    } else {
      showToast(t('toast.saved'), 'success');
    }
  }

  /* ─── Apply GPU Tuning (Mali sysfs + driver config + Vulkan props) ── */
  async function applyGpuTuning() {
    const gt = state.gpuTuning;
    await exec(`echo ${gt.dvfsPeriod} > ${MALI_SYSFS}/dvfs_period 2>/dev/null`);
    await exec(`echo ${gt.idleHysteresis} > ${MALI_SYSFS}/idle_hysteresis_time 2>/dev/null`);
    await exec(`echo ${gt.shaderPwroff} > ${MALI_SYSFS}/mcu_shader_pwroff_timeout 2>/dev/null`);
    await exec(`echo ${gt.powerPolicy} > ${MALI_SYSFS}/power_policy 2>/dev/null`);
    await exec(`echo ${gt.csgPeriod} > ${MALI_SYSFS}/csg_scheduling_period 2>/dev/null`);

    /* Mali driver config via MALI_PLATFORM_CONFIG system property */
    const md = gt.maliDriver;
    const cfgParts = [];
    if (md.cmarOptimizeForLatency) cfgParts.push('CMAR_OPTIMIZE_FOR_LATENCY=1');
    if (md.glesDisableShaderLto) cfgParts.push('GLES_DISABLE_SHADER_LTO=1');
    if (md.glesDisablePilotShaders) cfgParts.push('GLES_DISABLE_PILOT_SHADERS=1');
    if (md.glesDisableGraphicsPipelineCache) cfgParts.push('GLES_DISABLE_GRAPHICS_PIPELINE_CACHE=1');
    if (md.glesDisableSubpassCache) cfgParts.push('GLES_DISABLE_SUBPASS_CACHE=1');
    if (md.glesDisableSurfaceAfbc) cfgParts.push('GLES_DISABLE_SURFACE_AFBC=1');
    if (md.glesDisableTextureAfbc) cfgParts.push('GLES_DISABLE_TEXTURE_AFBC=1');
    if (md.glesDisableCrc) cfgParts.push('GLES_DISABLE_CRC=1');
    if (md.glesDisableIdvs) cfgParts.push('GLES_DISABLE_IDVS=1');
    if (md.schedRtThreadPriority > 0) cfgParts.push('SCHED_RT_THREAD_PRIORITY=' + md.schedRtThreadPriority);
    if (md.optimizationLevel > 0) cfgParts.push('OPTIMIZATION_LEVEL=' + md.optimizationLevel);
    const cfgStr = cfgParts.join(':');
    await exec(`setprop vendor.mali.platform.config '${cfgStr}' 2>/dev/null`);
    if (md.maliPrerotate) {
      await exec(`setprop vendor.mali.prerotate 1 2>/dev/null`);
    } else {
      await exec(`setprop vendor.mali.prerotate '' 2>/dev/null`);
    }

    if (gt.vulkanHwui) {
      await exec('resetprop ro.hwui.use_vulkan true 2>/dev/null || setprop ro.hwui.use_vulkan true 2>/dev/null');
    } else {
      await exec('resetprop --delete ro.hwui.use_vulkan 2>/dev/null');
    }
    if (gt.vulkanRenderengine) {
      await exec('setprop debug.renderengine.backend skiavk 2>/dev/null');
    } else {
      await exec('setprop debug.renderengine.backend skiagl 2>/dev/null');
    }
  }

  async function applyGpu() {
    showToast(t('toast.applying'), 'info');
    let anyOcApplied = false;

    /* --- GPU OC: detect top entry above stock max, apply via kpm_oc --- */
    const activeGpu = state.gpuEntries.filter(e => !e.removing);
    const gpuMax = activeGpu.length > 0
      ? activeGpu.reduce((m, e) => e.freq > m.freq ? e : m)
      : null;
    const origGpuMax = state.originalGpu.length > 0
      ? Math.max(...state.originalGpu.map(e => e.freq))
      : 0;

    const anyGpuRemoving = state.gpuEntries.some(e => e.removing);
    if (gpuMax && (gpuMax.isNew || gpuMax.modified || gpuMax.freq !== origGpuMax || anyGpuRemoving)) {
      const voltStep  = Math.round(gpuMax.volt / 10);
      const vsramStep = gpuMax.vsram > 0 ? Math.round(gpuMax.vsram / 10) : voltStep;
      await execChecked(`echo ${gpuMax.freq} > ${KS_PARAMS}gpu_target_freq`, 'gpu freq');
      await execChecked(`echo ${voltStep} > ${KS_PARAMS}gpu_target_volt`, 'gpu volt');
      await execChecked(`echo ${vsramStep} > ${KS_PARAMS}gpu_target_vsram`, 'gpu vsram');
      await execChecked(`echo 1 > ${KS_PARAMS}gpu_oc_apply`, 'gpu_oc_apply');
      await ensureGpuMax(gpuMax.freq);
      anyOcApplied = true;
    }

    /* GPU: per-OPP voltage overrides */
    {
      const voltOverrides = [];
      for (const entry of state.gpuEntries) {
        if (!entry.removing && !entry.isNew && entry.modified &&
            entry.volt !== entry.origVolt &&
            entry.kernelIdx !== undefined) {
          const voltStep  = Math.round(entry.volt  / 10);
          const vsramStep = entry.vsram > 0 ? Math.round(entry.vsram / 10) : voltStep;
          voltOverrides.push(`${entry.kernelIdx}:${voltStep}:${vsramStep}`);
        }
      }
      if (voltOverrides.length > 0) {
        await execChecked(
          `echo '${voltOverrides.join(' ')}' > ${KS_PARAMS}gpu_volt_override`,
          'gpu_volt_override');
        anyOcApplied = true;
      }
    }

    await applyThermal();
    await applyGpuTuning();
    await exec(`mkdir -p ${CONF_DIR}`);
    await saveGpuConfig();
    await saveGpuTuningConfig();
    await saveThermalConfig();

    /* Reload GPU section to reflect applied changes */
    await _loadGpuSection();
    await _loadGpuTuningSection();
    await _loadThermalSection();
    renderAll();

    if (anyOcApplied) {
      const gpuRes     = await exec(`cat ${KS_PARAMS}gpu_oc_result 2>/dev/null`);
      const gpuVoltRes = await exec(`cat ${KS_PARAMS}gpu_volt_ov_result 2>/dev/null`);
      const details = [gpuRes.stdout.trim(), gpuVoltRes.stdout.trim()]
        .filter(s => s && s !== 'NOOP' && s !== '(null)').join(' | ');
      showToast(t('toast.applied_saved', { details }), 'success');
    } else {
      showToast(t('toast.saved'), 'success');
    }
  }

  async function applyDisplay() {
    showToast(t('toast.applying'), 'info');
    await applyDisplayTuning();
    await exec(`mkdir -p ${CONF_DIR}`);
    await saveDisplayTuningConfig();
    await _loadDisplayTuningSection();
    renderAll();
    showToast(t('toast.saved'), 'success');
  }

  async function applyRam() {
    showToast(t('toast.applying'), 'info');

    /* --- RAM: set DRAM min_freq floor via devfreq --- */
    const ramMinTarget = state.ram.selectedMinFreq;
    if (ramMinTarget > 0 && ramMinTarget !== state.originalRamMinFreq) {
      const ramRes = await exec(`echo ${ramMinTarget} | tee ${DRAM_DEVFREQ}/min_freq`);
      if (ramRes.errno === 0) {
        state.ram.minFreq = ramMinTarget;
        state.originalRamMinFreq = ramMinTarget;
        const newCur   = await exec(`cat ${DRAM_DEVFREQ}/cur_freq 2>/dev/null`);
        const newVcore = await exec(`cat ${VCORE_UV_PATH} 2>/dev/null`);
        const newRate  = await exec(`cat ${DRAM_DATA_RATE} 2>/dev/null`);
        state.ram.curFreq = parseInt(newCur.stdout.trim(), 10)   || state.ram.curFreq;
        state.ram.vcoreUv = parseInt(newVcore.stdout.trim(), 10) || state.ram.vcoreUv;
        const rateMatch = newRate.stdout.match(/(\d+)/);
        if (rateMatch) state.ram.dataRate = parseInt(rateMatch[1], 10);
        renderAll();
      } else {
        showToast(t('ram.dram_min_fail', { err: ramRes.stderr }), 'error');
        return;
      }
    }

    await exec(`mkdir -p ${CONF_DIR}`);
    await saveRamConfig();

    /* Reload RAM section to reflect applied changes */
    await _loadRamSection();
    renderAll();

    showToast(t('toast.saved'), 'success');
  }

  async function applyStorage() {
    showToast(t('toast.applying'), 'info');

    /* --- Storage: apply all block queue + UFS controller settings --- */
    const sto = state.storage;
    if (sto.devices.length > 0) {
      const results = [];

      for (const dev of sto.devices) {
        const base = `/sys/block/${dev.name}/queue`;

        if (sto.readAheadKb > 0 && dev.readAheadKb !== sto.readAheadKb) {
          const r = await exec(`echo ${sto.readAheadKb} > ${base}/read_ahead_kb 2>&1; echo $?`);
          if (r.stdout.trim().endsWith('0') || r.errno === 0) {
            dev.readAheadKb = sto.readAheadKb;
          }
        }

        if (sto.scheduler && dev.scheduler !== sto.scheduler) {
          const r = await exec(`echo ${sto.scheduler} > ${base}/scheduler 2>&1`);
          if (r.errno === 0 && !r.stderr.trim()) {
            dev.scheduler = sto.scheduler;
          } else {
            results.push(`sched:${r.stderr.trim().substring(0, 40)}`);
          }
        }

        if (dev.nomerges !== sto.nomerges) {
          await exec(`echo ${sto.nomerges} > ${base}/nomerges 2>/dev/null`);
          dev.nomerges = sto.nomerges;
        }

        if (dev.rqAffinity !== sto.rqAffinity) {
          await exec(`echo ${sto.rqAffinity} > ${base}/rq_affinity 2>/dev/null`);
          dev.rqAffinity = sto.rqAffinity;
        }

        if (dev.iostats !== sto.iostats) {
          await exec(`echo ${sto.iostats} > ${base}/iostats 2>/dev/null`);
          dev.iostats = sto.iostats;
        }

        if (dev.addRandom !== sto.addRandom) {
          await exec(`echo ${sto.addRandom} > ${base}/add_random 2>/dev/null`);
          dev.addRandom = sto.addRandom;
        }
      }

      await exec(`mkdir -p ${CONF_DIR}`);
      await saveStorageConfig();

      /* --- UFS HCI controller settings (use printf|tee to avoid shell redirect O_CREAT issue) --- */
      const hci = sto.ufsHciPath;
      if (hci) {
        const ufsWrites = [];
        if (sto.wbOn >= 0)           ufsWrites.push(exec(`printf ${sto.wbOn} | tee ${hci}/wb_on 2>/dev/null`));
        if (sto.clkgateEnable >= 0)  ufsWrites.push(exec(`printf ${sto.clkgateEnable} | tee ${hci}/clkgate_enable 2>/dev/null`));
        if (sto.clkgateDelay > 0)    ufsWrites.push(exec(`printf ${sto.clkgateDelay} | tee ${hci}/clkgate_delay_ms 2>/dev/null`));
        if (sto.autoHibern8 >= 0)    ufsWrites.push(exec(`printf ${sto.autoHibern8} | tee ${hci}/auto_hibern8 2>/dev/null`));
        if (sto.rpmLvl >= 0)         ufsWrites.push(exec(`printf ${sto.rpmLvl} | tee ${hci}/rpm_lvl 2>/dev/null`));
        if (sto.spmLvl >= 0)         ufsWrites.push(exec(`printf ${sto.spmLvl} | tee ${hci}/spm_lvl 2>/dev/null`));
        await Promise.all(ufsWrites);
      }

      /* Reload Storage section to reflect applied changes */
      await loadStorageData();
      renderAll();

      showToast(t('storage.toast', { ra: sto.readAheadKb, sched: sto.scheduler, rqa: sto.rqAffinity, nom: sto.nomerges }) + (sto.wbOn >= 0 ? ' WB=' + (sto.wbOn ? 'ON' : 'OFF') : ''), 'success');
    } else {
      showToast(t('toast.saved'), 'success');
    }
  }

  async function applyProfile() {
    showToast(t('toast.applying'), 'info');
    const gov = state.profile.governor;
    const gp = state.profile.governorProfiles[gov] || GOVERNOR_DEFAULT_PROFILE;

    /* 1. Set governor on all policies */
    for (const p of [0, 4, 7]) {
      await exec('echo ' + gov + ' > /sys/devices/system/cpu/cpufreq/policy' + p + '/scaling_governor 2>/dev/null');
    }

    /* 2. Apply CPU OC parameters from governor profile */
    const clusterKeys = { l: 0, b: 4, p: 7 };
    let ocNeeded = false;
    for (const [key, pid] of Object.entries(clusterKeys)) {
      const freq = gp[`cpu_oc_${key}_freq`] || 0;
      const volt = gp[`cpu_oc_${key}_volt`] || 0;
      if (freq > 0) {
        await exec('echo ' + freq + ' > ' + KS_PARAMS + 'cpu_oc_' + key + '_freq 2>/dev/null');
        await exec('echo ' + volt + ' > ' + KS_PARAMS + 'cpu_oc_' + key + '_volt 2>/dev/null');
        ocNeeded = true;
      }
    }
    if (ocNeeded) {
      await exec('echo 1 > ' + KS_PARAMS + 'cpu_oc_apply 2>/dev/null');
      await new Promise(r => setTimeout(r, 300));
    }

    /* 3. Apply scaling limits from governor profile */
    for (const p of [0, 4, 7]) {
      const maxF = gp[`cpu_max_${p}`] || 0;
      const minF = gp[`cpu_min_${p}`] || 0;
      if (minF > 0) await exec('echo ' + minF + ' > /sys/devices/system/cpu/cpufreq/policy' + p + '/scaling_min_freq 2>/dev/null');
      if (maxF > 0) await exec('echo ' + maxF + ' > /sys/devices/system/cpu/cpufreq/policy' + p + '/scaling_max_freq 2>/dev/null');
    }

    /* 4. DRAM min freq */
    if (gp.dram_min > 0) {
      await exec('echo ' + gp.dram_min + ' > ' + DRAM_DEVFREQ + '/min_freq 2>/dev/null');
    }

    /* 5. Thermal */
    state.thermal.cpuMode = gp.cpu_thermal || 0;
    state.thermal.gpuMode = gp.gpu_thermal || 0;
    await applyThermal();

    /* 6. Also update cpu_oc.json and cpu_scaling.json for service.sh boot compat */
    const cpuOcObj = {
      cpu_oc_l_freq: gp.cpu_oc_l_freq || 0, cpu_oc_l_volt: gp.cpu_oc_l_volt || 0,
      cpu_oc_b_freq: gp.cpu_oc_b_freq || 0, cpu_oc_b_volt: gp.cpu_oc_b_volt || 0,
      cpu_oc_p_freq: gp.cpu_oc_p_freq || 0, cpu_oc_p_volt: gp.cpu_oc_p_volt || 0,
    };
    await exec(`printf '%s' '${_esc(JSON.stringify(cpuOcObj))}' > ${CONF_CPU_OC}`);

    const scalingObj = {};
    for (const p of [0, 4, 7]) {
      scalingObj[`cpu_max_${p}`] = gp[`cpu_max_${p}`] || 0;
      scalingObj[`cpu_min_${p}`] = gp[`cpu_min_${p}`] || 0;
    }
    await exec(`printf '%s' '${_esc(JSON.stringify(scalingObj))}' > ${CONF_CPU_SCALING}`);

    /* 7. Gaming monitor + daemon */
    if (state.profile.autoGaming.enabled && state.profile.autoGaming.apps.length > 0) {
      await startGamingMonitor();
      await restartGamingDaemon();
    } else {
      stopGamingMonitor();
      await stopGamingDaemon();
    }

    await exec(`mkdir -p ${CONF_DIR}`);
    await saveProfileConfig();
    await saveThermalConfig();

    /* Reload to reflect applied changes */
    await _loadProfileSection();
    await _loadCpuSection();
    await _loadRamSection();
    await _loadThermalSection();
    renderAll();

    showToast(t('toast.saved'), 'success');
  }

  /* Legacy full-apply (applies all sections at once) */
  async function applyAll() {
    showToast(t('toast.applying'), 'info');
    let anyOcApplied = false;

    /* --- CPU OC --- */
    const clusterParamMap = { 0: 'l', 4: 'b', 7: 'p' };
    let cpuOcNeeded = false;
    let cpuReliftNeeded = false;

    for (const cluster of state.cpuClusters) {
      const key = clusterParamMap[cluster.id];
      if (!key) continue;

      const active = cluster.entries.filter(e => !e.removing);
      const maxEntry = active.length > 0
        ? active.reduce((m, e) => e.freq > m.freq ? e : m)
        : null;

      const origCluster = state.originalCpu.find(c => c.id === cluster.id);
      const origEntries = origCluster ? origCluster.entries : [];
      const origMax = origEntries.length > 0
        ? Math.max(...origEntries.map(e => e.freq))
        : 0;

      const anyRemoving = cluster.entries.some(e => e.removing);
      if (maxEntry && (maxEntry.isNew || maxEntry.modified || maxEntry.freq !== origMax || anyRemoving)) {
        await execChecked(`echo ${maxEntry.freq} > ${KS_PARAMS}cpu_oc_${key}_freq`, `CPU ${key} freq`);
        await execChecked(`echo ${maxEntry.volt} > ${KS_PARAMS}cpu_oc_${key}_volt`, `CPU ${key} volt`);
        cpuOcNeeded = true;
      }

      const maxSel = document.getElementById(`cpu-max-freq-${cluster.id}`);
      const minSel = document.getElementById(`cpu-min-freq-${cluster.id}`);
      if (maxSel) {
        const v = parseInt(maxSel.value, 10);
        if (!isNaN(v) && v > 0) {
          const applied = await ensureCpuMax(cluster.id, v);
          cluster.curMax = applied > 0 ? applied : v;
          if (v > origMax) cpuReliftNeeded = true;
        }
      }
      if (minSel) {
        const v = parseInt(minSel.value, 10);
        if (!isNaN(v) && v > 0) {
          await execChecked(`echo ${v} > /sys/devices/system/cpu/cpufreq/policy${cluster.id}/scaling_min_freq`, `scaling_min p${cluster.id}`);
          cluster.curMin = v;
        }
      }
    }

    if (cpuOcNeeded || cpuReliftNeeded) {
      await execChecked(`echo 1 > ${KS_PARAMS}cpu_oc_apply`, 'cpu_oc_apply');
      anyOcApplied = true;

      await new Promise(r => setTimeout(r, 300));
      for (const cluster of state.cpuClusters) {
        const freqRes = await exec(`cat /sys/devices/system/cpu/cpufreq/policy${cluster.id}/scaling_available_frequencies 2>/dev/null`);
        if (freqRes.stdout.trim()) {
          cluster.freqs = freqRes.stdout.trim().split(/\s+/)
            .map(f => parseInt(f, 10)).filter(f => !isNaN(f)).sort((a, b) => a - b);
        }
        const active = cluster.entries.filter(e => !e.removing);
        const maxEntry = active.length > 0
          ? active.reduce((m, e) => e.freq > m.freq ? e : m)
          : null;
        if (maxEntry && maxEntry.freq > 0) {
          const applied = await ensureCpuMax(cluster.id, maxEntry.freq);
          cluster.curMax = applied > 0 ? applied : maxEntry.freq;
        }
        const maxRes = await exec(`cat /sys/devices/system/cpu/cpufreq/policy${cluster.id}/scaling_max_freq 2>/dev/null`);
        const actualMax = parseInt(maxRes.stdout.trim(), 10);
        if (actualMax > 0) cluster.curMax = actualMax;
      }
      renderAll();
    }

    /* CPU: per-LUT voltage overrides */
    {
      const clusterIdxMap = { 0: 0, 4: 1, 7: 2 };
      const voltOverrides = [];
      for (const cluster of state.cpuClusters) {
        const ci = clusterIdxMap[cluster.id];
        if (ci === undefined) continue;
        const activeEntries = cluster.entries.filter(e => !e.removing);
        const entryCount = activeEntries.length;
        let activeIdx = 0;
        for (let i = 0; i < cluster.entries.length; i++) {
          const entry = cluster.entries[i];
          if (entry.removing) continue;
          if ((entry.modified || entry.isNew) && entry.volt !== entry.origVolt) {
            const lutIdx = entryCount - 1 - activeIdx;
            voltOverrides.push(`${ci}:${lutIdx}:${entry.volt}`);
          }
          activeIdx++;
        }
      }
      if (voltOverrides.length > 0) {
        await execChecked(
          `echo '${voltOverrides.join(' ')}' > ${KS_PARAMS}cpu_volt_override`,
          'cpu_volt_override');
        anyOcApplied = true;
      }
    }

    /* --- GPU OC --- */
    const activeGpu = state.gpuEntries.filter(e => !e.removing);
    const gpuMax = activeGpu.length > 0
      ? activeGpu.reduce((m, e) => e.freq > m.freq ? e : m)
      : null;
    const origGpuMax = state.originalGpu.length > 0
      ? Math.max(...state.originalGpu.map(e => e.freq))
      : 0;

    const anyGpuRemoving = state.gpuEntries.some(e => e.removing);
    if (gpuMax && (gpuMax.isNew || gpuMax.modified || gpuMax.freq !== origGpuMax || anyGpuRemoving)) {
      const voltStep  = Math.round(gpuMax.volt / 10);
      const vsramStep = gpuMax.vsram > 0 ? Math.round(gpuMax.vsram / 10) : voltStep;
      await execChecked(`echo ${gpuMax.freq} > ${KS_PARAMS}gpu_target_freq`, 'gpu freq');
      await execChecked(`echo ${voltStep} > ${KS_PARAMS}gpu_target_volt`, 'gpu volt');
      await execChecked(`echo ${vsramStep} > ${KS_PARAMS}gpu_target_vsram`, 'gpu vsram');
      await execChecked(`echo 1 > ${KS_PARAMS}gpu_oc_apply`, 'gpu_oc_apply');
      await ensureGpuMax(gpuMax.freq);
      anyOcApplied = true;
    }

    /* GPU: per-OPP voltage overrides */
    {
      const voltOverrides = [];
      for (const entry of state.gpuEntries) {
        if (!entry.removing && !entry.isNew && entry.modified &&
            entry.volt !== entry.origVolt &&
            entry.kernelIdx !== undefined) {
          const voltStep  = Math.round(entry.volt  / 10);
          const vsramStep = entry.vsram > 0 ? Math.round(entry.vsram / 10) : voltStep;
          voltOverrides.push(`${entry.kernelIdx}:${voltStep}:${vsramStep}`);
        }
      }
      if (voltOverrides.length > 0) {
        await execChecked(
          `echo '${voltOverrides.join(' ')}' > ${KS_PARAMS}gpu_volt_override`,
          'gpu_volt_override');
        anyOcApplied = true;
      }
    }

    /* --- RAM --- */
    const ramMinTarget = state.ram.selectedMinFreq;
    if (ramMinTarget > 0 && ramMinTarget !== state.originalRamMinFreq) {
      const ramRes = await exec(`echo ${ramMinTarget} | tee ${DRAM_DEVFREQ}/min_freq`);
      if (ramRes.errno === 0) {
        state.ram.minFreq = ramMinTarget;
        state.originalRamMinFreq = ramMinTarget;
        const newCur   = await exec(`cat ${DRAM_DEVFREQ}/cur_freq 2>/dev/null`);
        const newVcore = await exec(`cat ${VCORE_UV_PATH} 2>/dev/null`);
        const newRate  = await exec(`cat ${DRAM_DATA_RATE} 2>/dev/null`);
        state.ram.curFreq = parseInt(newCur.stdout.trim(), 10)   || state.ram.curFreq;
        state.ram.vcoreUv = parseInt(newVcore.stdout.trim(), 10) || state.ram.vcoreUv;
        const rateMatch = newRate.stdout.match(/(\d+)/);
        if (rateMatch) state.ram.dataRate = parseInt(rateMatch[1], 10);
        showToast(`DRAM min floor → ${formatFreqHz(ramMinTarget)}`, 'success');
        renderAll();
      } else {
        showToast(t('ram.dram_min_fail', { err: ramRes.stderr }), 'error');
      }
      anyOcApplied = true;
    }

    await applyThermal();
    await saveConfig();

    /* --- Storage --- */
    const sto = state.storage;
    if (sto.devices.length > 0) {
      const results = [];

      for (const dev of sto.devices) {
        const base = `/sys/block/${dev.name}/queue`;

        if (sto.readAheadKb > 0 && dev.readAheadKb !== sto.readAheadKb) {
          const r = await exec(`echo ${sto.readAheadKb} > ${base}/read_ahead_kb 2>&1; echo $?`);
          if (r.stdout.trim().endsWith('0') || r.errno === 0) {
            dev.readAheadKb = sto.readAheadKb;
          }
        }

        if (sto.scheduler && dev.scheduler !== sto.scheduler) {
          const r = await exec(`echo ${sto.scheduler} > ${base}/scheduler 2>&1`);
          if (r.errno === 0 && !r.stderr.trim()) {
            dev.scheduler = sto.scheduler;
          } else {
            results.push(`sched:${r.stderr.trim().substring(0, 40)}`);
          }
        }

        if (dev.nomerges !== sto.nomerges) {
          await exec(`echo ${sto.nomerges} > ${base}/nomerges 2>/dev/null`);
          dev.nomerges = sto.nomerges;
        }

        if (dev.rqAffinity !== sto.rqAffinity) {
          await exec(`echo ${sto.rqAffinity} > ${base}/rq_affinity 2>/dev/null`);
          dev.rqAffinity = sto.rqAffinity;
        }

        if (dev.iostats !== sto.iostats) {
          await exec(`echo ${sto.iostats} > ${base}/iostats 2>/dev/null`);
          dev.iostats = sto.iostats;
        }

        if (dev.addRandom !== sto.addRandom) {
          await exec(`echo ${sto.addRandom} > ${base}/add_random 2>/dev/null`);
          dev.addRandom = sto.addRandom;
        }
      }

      showToast(t('storage.toast', { ra: sto.readAheadKb, sched: sto.scheduler, rqa: sto.rqAffinity, nom: sto.nomerges }), 'success');

      /* --- UFS HCI controller settings (printf|tee avoids shell redirect O_CREAT issue) --- */
      const hci = sto.ufsHciPath;
      if (hci) {
        const ufsWrites = [];
        if (sto.wbOn >= 0)           ufsWrites.push(exec(`printf ${sto.wbOn} | tee ${hci}/wb_on 2>/dev/null`));
        if (sto.clkgateEnable >= 0)  ufsWrites.push(exec(`printf ${sto.clkgateEnable} | tee ${hci}/clkgate_enable 2>/dev/null`));
        if (sto.clkgateDelay > 0)    ufsWrites.push(exec(`printf ${sto.clkgateDelay} | tee ${hci}/clkgate_delay_ms 2>/dev/null`));
        if (sto.autoHibern8 >= 0)    ufsWrites.push(exec(`printf ${sto.autoHibern8} | tee ${hci}/auto_hibern8 2>/dev/null`));
        if (sto.rpmLvl >= 0)         ufsWrites.push(exec(`printf ${sto.rpmLvl} | tee ${hci}/rpm_lvl 2>/dev/null`));
        if (sto.spmLvl >= 0)         ufsWrites.push(exec(`printf ${sto.spmLvl} | tee ${hci}/spm_lvl 2>/dev/null`));
        await Promise.all(ufsWrites);
      }

      renderAll();
    }

    /* Governor: apply saved governor after OC apply */
    {
      const gov = state.profile.governor;
      for (const p of [0, 4, 7]) {
        await exec('echo ' + gov + ' > /sys/devices/system/cpu/cpufreq/policy' + p + '/scaling_governor 2>/dev/null');
      }
    }

    /* Gaming monitor + daemon */
    if (state.profile.autoGaming.enabled && state.profile.autoGaming.apps.length > 0) {
      await startGamingMonitor();
      await restartGamingDaemon();
    } else {
      stopGamingMonitor();
      await stopGamingDaemon();
    }

    /* Read back results from kernel module for user feedback */
    if (anyOcApplied) {
      const cpuRes     = await exec(`cat ${KS_PARAMS}cpu_oc_result 2>/dev/null`);
      const gpuRes     = await exec(`cat ${KS_PARAMS}gpu_oc_result 2>/dev/null`);
      const cpuVoltRes = await exec(`cat ${KS_PARAMS}cpu_volt_ov_result 2>/dev/null`);
      const gpuVoltRes = await exec(`cat ${KS_PARAMS}gpu_volt_ov_result 2>/dev/null`);
      const details = [
        cpuRes.stdout.trim(),
        gpuRes.stdout.trim(),
        cpuVoltRes.stdout.trim(),
        gpuVoltRes.stdout.trim(),
      ].filter(s => s && s !== 'NOOP' && s !== '(null)').join(' | ');
      showToast(t('toast.applied_saved', { details }), 'success');
    } else {
      showToast(t('toast.saved'), 'success');
    }
  }

  /* ─── Save Config — per-section helpers ─────────────────────────────── */

  /* shared escaper */
  const _esc = (s) => s.replace(/'/g, "'\\''");

  async function saveCpuConfig() {
    const clusterParamKeys = { 0: 'l', 4: 'b', 7: 'p' };
    const clusterIdxMap   = { 0: 0,   4: 1,   7: 2   };
    const clusterOc = {};
    for (const cluster of state.cpuClusters) {
      const key = clusterParamKeys[cluster.id];
      if (!key) continue;
      const active = cluster.entries.filter(e => !e.removing);
      const top = active.length > 0
        ? active.reduce((m, e) => e.freq > m.freq ? e : m)
        : null;
      clusterOc[key] = top ? { freq: top.freq, volt: top.volt } : { freq: 0, volt: 0 };
    }

    /* CPU OC — save OC target + full OPP table with modified voltages. */
    const cpuOcObj = {
      cpu_oc_l_freq:  clusterOc.l ? clusterOc.l.freq : 0,
      cpu_oc_l_volt:  clusterOc.l ? clusterOc.l.volt : 0,
      cpu_oc_b_freq:  clusterOc.b ? clusterOc.b.freq : 0,
      cpu_oc_b_volt:  clusterOc.b ? clusterOc.b.volt : 0,
      cpu_oc_p_freq:  clusterOc.p ? clusterOc.p.freq : 0,
      cpu_oc_p_volt:  clusterOc.p ? clusterOc.p.volt : 0,
      cpu_opp_overrides: [],
      cpu_opp_table: {},
    };
    for (const cluster of state.cpuClusters) {
      const ci = clusterIdxMap[cluster.id];
      if (ci === undefined) continue;
      const activeEntries = cluster.entries.filter(e => !e.removing);
      const entryCount = activeEntries.length;
      cpuOcObj.cpu_opp_table[cluster.id] = activeEntries.map(e => ({
        freq: e.freq, volt: e.volt, origVolt: e.origVolt,
      }));
      for (let ai = 0; ai < activeEntries.length; ai++) {
        const entry = activeEntries[ai];
        if ((entry.modified || entry.isNew) && entry.volt !== entry.origVolt) {
          const lutIdx = entryCount - 1 - ai;
          cpuOcObj.cpu_opp_overrides.push(`${ci}:${lutIdx}:${entry.volt}`);
        }
      }
    }
    await exec(`printf '%s' '${_esc(JSON.stringify(cpuOcObj))}' > ${CONF_CPU_OC}`);

    /* CPU Scaling */
    const scalingObj = {};
    for (const cluster of state.cpuClusters) {
      scalingObj[`cpu_max_${cluster.id}`] = parseInt(cluster.curMax, 10) || 0;
      scalingObj[`cpu_min_${cluster.id}`] = parseInt(cluster.curMin, 10) || 0;
    }
    await exec(`printf '%s' '${_esc(JSON.stringify(scalingObj))}' > ${CONF_CPU_SCALING}`);
  }

  async function saveGpuConfig() {
    const activeGpu = state.gpuEntries.filter(e => !e.removing);
    const gpuTop = activeGpu.length > 0
      ? activeGpu.reduce((m, e) => e.freq > m.freq ? e : m)
      : null;
    const gpuOcFreq  = gpuTop ? gpuTop.freq : 0;
    const gpuOcVolt  = gpuTop ? Math.round(gpuTop.volt / 10) : 0;
    const gpuOcVsram = gpuTop
      ? (gpuTop.vsram > 0 ? Math.round(gpuTop.vsram / 10) : gpuOcVolt)
      : 0;

    const gpuOcObj = {
      gpu_oc_freq:  gpuOcFreq,
      gpu_oc_volt:  gpuOcVolt,
      gpu_oc_vsram: gpuOcVsram,
      gpu_opp_overrides: [],
      gpu_opp_table: activeGpu.map(e => ({
        freq: e.freq, volt: e.volt, origVolt: e.origVolt,
        vsram: e.vsram || 0, kernelIdx: e.kernelIdx,
      })),
    };
    for (const entry of activeGpu) {
      if (!entry.isNew && entry.modified &&
          entry.volt !== entry.origVolt &&
          entry.kernelIdx !== undefined) {
        const voltStep  = Math.round(entry.volt  / 10);
        const vsramStep = entry.vsram > 0 ? Math.round(entry.vsram / 10) : voltStep;
        gpuOcObj.gpu_opp_overrides.push(`${entry.kernelIdx}:${voltStep}:${vsramStep}`);
      }
    }
    await exec(`printf '%s' '${_esc(JSON.stringify(gpuOcObj))}' > ${CONF_GPU_OC}`);
  }

  async function saveGpuTuningConfig() {
    const gt = state.gpuTuning;
    const md = gt.maliDriver;
    const obj = {
      mali_dvfs_period: gt.dvfsPeriod,
      mali_idle_hysteresis_time: gt.idleHysteresis,
      mali_shader_pwroff_timeout: gt.shaderPwroff,
      mali_power_policy: gt.powerPolicy,
      mali_csg_scheduling_period: gt.csgPeriod,
      vulkan_hwui: gt.vulkanHwui,
      vulkan_renderengine: gt.vulkanRenderengine,
      mali_driver: {
        cmar_optimize_for_latency: md.cmarOptimizeForLatency,
        gles_disable_shader_lto: md.glesDisableShaderLto,
        gles_disable_pilot_shaders: md.glesDisablePilotShaders,
        gles_disable_graphics_pipeline_cache: md.glesDisableGraphicsPipelineCache,
        gles_disable_subpass_cache: md.glesDisableSubpassCache,
        sched_rt_thread_priority: md.schedRtThreadPriority,
        optimization_level: md.optimizationLevel,
        gles_disable_surface_afbc: md.glesDisableSurfaceAfbc,
        gles_disable_texture_afbc: md.glesDisableTextureAfbc,
        gles_disable_crc: md.glesDisableCrc,
        gles_disable_idvs: md.glesDisableIdvs,
        mali_prerotate: md.maliPrerotate,
      },
    };
    await exec(`printf '%s' '${_esc(JSON.stringify(obj))}' > ${CONF_GPU_TUNING}`);
  }

  /* ─── Apply CPU Tuning (governor, cpuidle, scheduler, uclamp, FPSGO) ── */
  async function applyCpuTuning() {
    const ct = state.cpuTuning;

    /* sugov_ext rate limits — apply to all clusters */
    for (const p of [0, 4, 7]) {
      const base = `/sys/devices/system/cpu/cpufreq/policy${p}/sugov_ext`;
      await exec(`echo ${ct.sugovUpRate} > ${base}/up_rate_limit_us 2>/dev/null`);
      await exec(`echo ${ct.sugovDownRate} > ${base}/down_rate_limit_us 2>/dev/null`);
    }

    /* cpuidle: disable states above max */
    for (let cpu = 0; cpu < 8; cpu++) {
      for (let s = 0; s <= 6; s++) {
        const val = s > ct.cpuidleMaxState ? 1 : 0;
        await exec(`echo ${val} > /sys/devices/system/cpu/cpu${cpu}/cpuidle/state${s}/disable 2>/dev/null`);
      }
    }

    /* Scheduler */
    await exec(`echo ${ct.schedEnergyAware} > /proc/sys/kernel/sched_energy_aware 2>/dev/null`);
    await exec(`echo ${ct.schedChildRunsFirst} > /proc/sys/kernel/sched_child_runs_first 2>/dev/null`);

    /* Uclamp top-app min */
    const uclampPct = ct.uclampTopAppMin === 0 ? '0.00'
      : (ct.uclampTopAppMin / 1024 * 100).toFixed(2);
    await exec(`echo ${uclampPct} > /dev/cpuctl/top-app/cpu.uclamp.min 2>/dev/null`);

    /* FPSGO */
    await exec(`echo ${ct.fpsgoBoostTa} > /sys/kernel/fpsgo/fbt/boost_ta 2>/dev/null`);
    await exec(`echo ${ct.fpsgoRescueEnable} > /sys/kernel/fpsgo/fbt/rescue_enable 2>/dev/null`);
  }

  async function saveCpuTuningConfig() {
    const ct = state.cpuTuning;
    const obj = {
      sugov_up_rate_limit_us: ct.sugovUpRate,
      sugov_down_rate_limit_us: ct.sugovDownRate,
      cpuidle_max_state: ct.cpuidleMaxState,
      sched_energy_aware: ct.schedEnergyAware,
      sched_child_runs_first: ct.schedChildRunsFirst,
      uclamp_top_app_min: ct.uclampTopAppMin,
      fpsgo_boost_ta: ct.fpsgoBoostTa,
      fpsgo_rescue_enable: ct.fpsgoRescueEnable,
    };
    await exec(`printf '%s' '${_esc(JSON.stringify(obj))}' > ${CONF_CPU_TUNING}`);
  }

  /* ─── Apply Display Tuning (refresh, animation, PQ, idle) ──────── */
  async function applyDisplayTuning() {
    const dt = state.displayTuning;
    await exec(`settings put system peak_refresh_rate ${dt.peakRefreshRate} 2>/dev/null`);
    await exec(`settings put system min_refresh_rate ${dt.minRefreshRate} 2>/dev/null`);
    await exec(`settings put global animator_duration_scale ${dt.animatorDuration} 2>/dev/null`);
    await exec(`settings put global transition_animation_scale ${dt.transitionDuration} 2>/dev/null`);
    await exec(`settings put global window_animation_scale ${dt.windowDuration} 2>/dev/null`);
    await exec(`resetprop persist.sys.sf.color_saturation ${dt.colorSaturation} 2>/dev/null`);
    await exec(`resetprop persist.vendor.sys.pq.shp.idx ${dt.sharpnessIdx} 2>/dev/null`);
    await exec(`resetprop persist.vendor.sys.pq.ultrares.en ${dt.ultraResolution} 2>/dev/null`);
    await exec(`resetprop persist.vendor.sys.pq.mdp.dre.en ${dt.dreEnable} 2>/dev/null`);
    await exec(`resetprop persist.vendor.sys.pq.mdp.vp.dre.en ${dt.dreEnable} 2>/dev/null`);
    await exec(`resetprop persist.vendor.sys.pq.hdr10.adaptive.en ${dt.hdrAdaptive} 2>/dev/null`);
    await exec(`resetprop persist.vendor.sys.pq.hdr10p.adaptive.en ${dt.hdrAdaptive} 2>/dev/null`);
    await exec(`resetprop persist.vendor.sys.pq.hfg.en ${dt.hfgLevel} 2>/dev/null`);
    await exec(`echo ${dt.displayIdleTime} > /proc/displowpower/idletime 2>/dev/null`);
  }

  async function saveDisplayTuningConfig() {
    const dt = state.displayTuning;
    const obj = {
      refresh_mode: dt.refreshMode,
      peak_refresh_rate: dt.peakRefreshRate,
      min_refresh_rate: dt.minRefreshRate,
      animator_duration: dt.animatorDuration,
      transition_duration: dt.transitionDuration,
      window_duration: dt.windowDuration,
      color_saturation: dt.colorSaturation,
      sharpness_idx: dt.sharpnessIdx,
      ultra_resolution: dt.ultraResolution,
      dre_enable: dt.dreEnable,
      hdr_adaptive: dt.hdrAdaptive,
      hfg_level: dt.hfgLevel,
      display_idle_time: dt.displayIdleTime,
    };
    await exec(`printf '%s' '${_esc(JSON.stringify(obj))}' > ${CONF_DISPLAY}`);
  }

  async function saveRamConfig() {
    const dramJson = JSON.stringify({ dram_min_freq: state.ram.selectedMinFreq || 0 });
    await exec(`printf '%s' '${_esc(dramJson)}' > ${CONF_DRAM}`);
  }

  async function saveStorageConfig() {
    const ioJson = JSON.stringify({
      io_read_ahead_kb: state.storage.readAheadKb || 2048,
      io_scheduler:     state.storage.scheduler   || 'none',
      io_nomerges:      state.storage.nomerges    || 0,
      io_rq_affinity:   state.storage.rqAffinity  ?? 2,
      io_iostats:       state.storage.iostats      ?? 1,
      io_add_random:    state.storage.addRandom    || 0,
    });
    await exec(`printf '%s' '${_esc(ioJson)}' > ${CONF_IO}`);

    const ufsObj = {};
    if (state.storage.wbOn >= 0) ufsObj.ufs_wb_on = state.storage.wbOn;
    if (state.storage.clkgateEnable >= 0) ufsObj.ufs_clkgate_enable = state.storage.clkgateEnable;
    if (state.storage.clkgateDelay > 0) ufsObj.ufs_clkgate_delay_ms = state.storage.clkgateDelay;
    if (state.storage.autoHibern8 >= 0) ufsObj.ufs_auto_hibern8 = state.storage.autoHibern8;
    if (state.storage.rpmLvl >= 0) ufsObj.ufs_rpm_lvl = state.storage.rpmLvl;
    if (state.storage.spmLvl >= 0) ufsObj.ufs_spm_lvl = state.storage.spmLvl;
    await exec(`printf '%s' '${_esc(JSON.stringify(ufsObj))}' > ${CONF_UFS}`);
  }

  async function saveThermalConfig() {
    const thermalJson = JSON.stringify({
      cpu_thermal_mode: state.thermal.cpuMode,
      gpu_thermal_mode: state.thermal.gpuMode,
    });
    await exec(`printf '%s' '${_esc(thermalJson)}' > ${CONF_THERMAL}`);
  }

  async function saveProfileConfig() {
    const profileJson = JSON.stringify({
      governor:     state.profile.governor,
      auto_gaming:  state.profile.autoGaming.enabled ? 1 : 0,
      gaming_apps:  state.profile.autoGaming.apps.join(','),
      profiles:     state.profile.governorProfiles,
    });
    await exec(`printf '%s' '${_esc(profileJson)}' > ${CONF_PROFILE}`);
  }

  /* Full save — writes all section files at once */
  async function saveConfig() {
    await exec(`mkdir -p ${CONF_DIR}`);
    await saveCpuConfig();
    await saveGpuConfig();
    await saveGpuTuningConfig();
    await saveRamConfig();
    await saveStorageConfig();
    await saveThermalConfig();
    await saveProfileConfig();
  }

  /* ─── Public API ──────────────────────────────────────────────────── */
  window.OC = {
    onCellChange,
    onRamMinFreqChange,
    onStorageReadAheadChange,
    onStorageSchedulerChange,
    onStorageFieldChange,
    onStorageToggle,
    toggleAddForm,
    confirmAddEntry,
    removeRow,
    restoreRow,
    applyCpu,
    applyGpu,
    applyRam,
    applyStorage,
    applyDisplay,
    applyProfile,
    applyAll,
    scanAndLoad,
    loadData,
    refreshTemps,
    setThermalMode,
    applyThermal,
    setGpuTuning,
    setCpuTuning,
    setDisplayTuning,
    /* Profile & Gaming */
    setGovernor,
    setGovProfile,
    toggleAutoGaming,
    showAppSelector,
    hideAppSelector,
    filterApps,
    toggleGamingApp,
    removeGamingApp,
    startGamingMonitor,
    stopGamingMonitor,
    /* i18n */
    setLang,
    /* Diagnostic: run from browser console via OC.diagExec() */
    diagExec: async () => {
      const r = await exec('id -Z && cat /proc/self/attr/current && echo "---" && echo test_write > /sys/module/kpm_oc/parameters/cpu_oc_b_freq 2>&1; echo "exit=$?" && cat /sys/module/kpm_oc/parameters/cpu_oc_b_freq 2>&1');
      const msg = `exec context: errno=${r.errno}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
      console.log('[OC diag]', msg);
      showToast(msg.substring(0, 200), r.errno === 0 ? 'info' : 'error');
      return r;
    },
  };

  /* ─── Init ────────────────────────────────────────────────────────── */
  /* ─── i18n: Update static data-i18n elements ─────────────────────── */
  function updateStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = t(key);
    });
  }

  /* ─── Language Switcher ─────────────────────────────────────────── */
  function renderLangSwitcher() {
    const container = document.getElementById('lang-switcher');
    if (!container) return;
    const langs = window.I18n.getAvailableLanguages();
    const current = window.I18n.getLanguage();
    container.innerHTML = langs.map(l =>
      `<button class="lang-btn ${l.code === current ? 'active' : ''}" onclick="window.OC.setLang('${l.code}')">${l.flag}</button>`
    ).join('');
  }

  function setLang(code) {
    window.I18n.setLanguage(code);
    updateStaticI18n();
    renderLangSwitcher();
    updateModuleStatus();
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateStaticI18n();
    renderLangSwitcher();
    initTabs();
    loadData();
    loadStorageData().then(() => renderAll());
  });

})();
