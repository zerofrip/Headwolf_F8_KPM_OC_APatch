/* ═══════════════════════════════════════════════════════════════════════
   KPM OC Manager v7.5 — Application Logic
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
  const CONFIG_FILE = `${CONFIG_DIR}/oc_config.json`;
  const CPU_OPP_FILE = `${CONFIG_DIR}/cpu_opp_table`;
  const GPU_OPP_FILE = `${CONFIG_DIR}/gpu_opp_table`;
  const GPU_DEVFREQ_PATH_FILE = `${CONFIG_DIR}/gpu_devfreq_path`;
  const GPU_DEVFREQ_FALLBACK = '/sys/class/devfreq/13000000.mali';
  const DRAM_DEVFREQ = '/sys/class/devfreq/mtk-dvfsrc-devfreq';
  const DRAM_DATA_RATE = '/sys/bus/platform/drivers/dramc_drv/dram_data_rate';
  const DRAM_TYPE_PATH = '/sys/bus/platform/drivers/dramc_drv/dram_type';
  const VCORE_UV_PATH = '/sys/class/regulator/regulator.74/microvolts';
  const IO_BLOCK_DEVS = ['sda', 'sdb', 'sdc'];   // UFS namespaces
  const IO_READ_AHEAD_OPTIONS = [128, 256, 512, 1024, 2048];
  const IO_SCHEDULER_OPTIONS = ['none', 'mq-deadline', 'kyber', 'bfq'];
  const IO_RQ_AFFINITY_OPTIONS = [
    { value: 0, label: '0 — None' },
    { value: 1, label: '1 — CPU group' },
    { value: 2, label: '2 — Same CPU' },
  ];
  const IO_NOMERGES_OPTIONS = [
    { value: 0, label: '0 — Merge all' },
    { value: 1, label: '1 — No front' },
    { value: 2, label: '2 — No merge' },
  ];
  const UFS_HCI_GLOB = '/sys/devices/platform/11270000.ufshci';  // MT6897 primary UFSHCI

  const CPU_POLICIES = [0, 4, 7];
  const CLUSTER_NAMES = { 0: 'LITTLE (0-3)', 4: 'big (4-6)', 7: 'PRIME (7)' };
  const CLUSTER_CORES = { 0: 'Cortex-A520', 4: 'Cortex-A720', 7: 'Cortex-A720' };

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
      ufsHciPath: '',    // resolved ufshci sysfs path
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

    for (const [, list] of cpuMap) {
      list.sort((a, b) => a.freq - b.freq);
    }
    return cpuMap;
  }

  function parseGpuOppTable(raw) {
    const entries = [];
    const lines = raw.trim().split('\n');

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
        modified: false, isNew: false, removing: false,
      });
    }

    entries.sort((a, b) => a.freq - b.freq);
    return entries;
  }

  function parseGpuPreParsed(raw) {
    const entries = [];
    const items = raw.trim().split('|').filter(s => s.length > 0);
    for (const item of items) {
      const parts = item.split(':');
      if (parts.length !== 4 || parts[0] !== 'GPU') continue;
      const freq = parseInt(parts[2], 10);
      const volt = parseInt(parts[3], 10);
      if (isNaN(freq) || isNaN(volt)) continue;
      entries.push({
        freq, volt, vsram: 0,
        origFreq: freq, origVolt: volt,
        modified: false, isNew: false, removing: false,
      });
    }
    entries.sort((a, b) => a.freq - b.freq);
    return entries;
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
    const maxFreq = entries.length > 0 ? Math.max(...entries.map(e => e.freq)) : 0;
    const maxFreqStr = maxFreq > 0 ? formatFreqKHz(maxFreq) : '—';

    const freqOptions = (cluster.freqs || []).map(f =>
      `<option value="${f}">${formatFreqKHz(f)}</option>`
    ).join('');

    let html = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span class="icon">⚡</span>
            CPU ${name}
            <span style="font-size:0.75rem;color:var(--text-muted);margin-left:4px">${core}</span>
          </div>
          <div>
            <span class="card-badge cpu">${entries.length} OPPs</span>
            <span class="info-chip freq" style="margin-left:4px">Max: ${maxFreqStr}</span>
          </div>
        </div>

        <div class="config-row">
          <div><div class="config-label">Max Freq</div></div>
          <select class="config-input freq-limit-select" id="cpu-max-freq-${cluster.id}"
                  data-policy="${cluster.id}" data-type="max">
            ${freqOptions}
          </select>
        </div>
        <div class="config-row">
          <div><div class="config-label">Min Freq</div></div>
          <select class="config-input freq-limit-select" id="cpu-min-freq-${cluster.id}"
                  data-policy="${cluster.id}" data-type="min">
            ${freqOptions}
          </select>
        </div>

        <div class="opp-table-wrapper">
          <table class="opp-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Freq (MHz)</th>
                <th>Voltage (µV)</th>
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
                    ${entry.modified || entry.isNew ? `<button class="btn-icon restore" title="Restore" onclick="window.OC.restoreRow('CPU', ${cluster.id}, ${idx})">↩</button>` : ''}
                    <button class="btn-icon danger" title="Remove" onclick="window.OC.removeRow('CPU', ${cluster.id}, ${idx})">✕</button>
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
            <input type="number" class="cell-input" placeholder="Freq (MHz)" id="add-cpu-freq-${cluster.id}">
            <input type="number" class="cell-input" placeholder="Voltage (µV)" id="add-cpu-volt-${cluster.id}">
            <button class="btn btn-success btn-sm" onclick="window.OC.confirmAddEntry('CPU', ${cluster.id})">✓</button>
            <button class="btn btn-secondary btn-sm" onclick="window.OC.toggleAddForm('CPU', ${cluster.id})">✕</button>
          </div>
        </div>
        <div class="btn-group">
          <button class="btn btn-secondary btn-sm" onclick="window.OC.toggleAddForm('CPU', ${cluster.id})">
            + Add Entry
          </button>
        </div>
      </div>`;

    return html;
  }

  /* ─── Render GPU Card ─────────────────────────────────────────────── */
  function renderGpuCard() {
    const entries = state.gpuEntries;
    const maxFreq = entries.length > 0 ? Math.max(...entries.map(e => e.freq)) : 0;
    const maxFreqStr = maxFreq > 0 ? formatFreqKHz(maxFreq) : '—';

    let html = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span class="icon">🎮</span>
            GPU · Mali
          </div>
          <div>
            <span class="card-badge gpu">${entries.length} OPPs</span>
            <span class="info-chip volt" style="margin-left:4px">Max: ${maxFreqStr}</span>
          </div>
        </div>

        <div class="opp-table-wrapper">
          <table class="opp-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Freq (MHz)</th>
                <th>Voltage (µV)</th>
                <th>VSRAM (µV)</th>
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
                    ${entry.modified || entry.isNew ? `<button class="btn-icon restore" title="Restore" onclick="window.OC.restoreRow('GPU', 0, ${idx})">↩</button>` : ''}
                    <button class="btn-icon danger" title="Remove" onclick="window.OC.removeRow('GPU', 0, ${idx})">✕</button>
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
            <input type="number" class="cell-input" placeholder="Freq (MHz)" id="add-gpu-freq-0">
            <input type="number" class="cell-input" placeholder="Voltage (µV)" id="add-gpu-volt-0">
            <button class="btn btn-success btn-sm" onclick="window.OC.confirmAddEntry('GPU', 0)">✓</button>
            <button class="btn btn-secondary btn-sm" onclick="window.OC.toggleAddForm('GPU', 0)">✕</button>
          </div>
        </div>
        <div class="btn-group">
          <button class="btn btn-secondary btn-sm" onclick="window.OC.toggleAddForm('GPU', 0)">
            + Add Entry
          </button>
        </div>
      </div>`;

    return html;
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
            DRAM · ${r.dramType || 'LPDDR'}
          </div>
          <div>
            <span class="card-badge ram">${r.availableFreqs.length} OPPs</span>
            <span class="info-chip ram" style="margin-left:4px">${r.governor || '—'}</span>
          </div>
        </div>

        <!-- Status Grid -->
        <div class="ram-status-grid">
          <div class="ram-stat-item">
            <span class="ram-stat-label">Data Rate</span>
            <span class="ram-stat-value">${r.dataRate > 0 ? r.dataRate + ' MT/s' : '—'}</span>
          </div>
          <div class="ram-stat-item">
            <span class="ram-stat-label">Vcore</span>
            <span class="ram-stat-value">${r.vcoreUv > 0 ? (r.vcoreUv / 1000).toFixed(0) + ' mV' : '—'}</span>
          </div>
          <div class="ram-stat-item">
            <span class="ram-stat-label">Current Freq</span>
            <span class="ram-stat-value">${r.curFreq > 0 ? formatFreqHz(r.curFreq) : '—'}</span>
          </div>
          <div class="ram-stat-item">
            <span class="ram-stat-label">Min Floor</span>
            <span class="ram-stat-value ${r.minFreq > r.availableFreqs[0] ? '' : 'muted'}">${r.minFreq > 0 ? formatFreqHz(r.minFreq) : '—'}</span>
          </div>
        </div>

        <!-- Min Freq Floor Selector -->
        <div class="config-row">
          <div><div class="config-label">Min Freq Floor</div></div>
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
                <th>#</th>
                <th>Frequency</th>
                <th>Data Rate</th>
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
                  ${isCurrent ? '<span class="info-chip ram">Active</span>' : ''}
                  ${isFloor ? '<span class="info-chip freq">Floor</span>' : ''}
                </td>
              </tr>`;
    });

    html += `
            </tbody>
          </table>
        </div>

        <div style="padding:8px 12px;font-size:0.72rem;color:var(--text-muted);line-height:1.4">
          ℹ️ Min Freq Floor locks DRAM at or above the selected frequency.
          Vcore voltage is automatically managed by DVFSRC and increases with higher DRAM OPPs.
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
      `<option value="${o.value}" ${o.value === s.rqAffinity ? 'selected' : ''}>${o.label}</option>`
    ).join('');

    /* nomerges select */
    const nomOptions = IO_NOMERGES_OPTIONS.map(o =>
      `<option value="${o.value}" ${o.value === s.nomerges ? 'selected' : ''}>${o.label}</option>`
    ).join('');

    let html = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span class="icon">💾</span>
            UFS · Block Devices
          </div>
          <span class="card-badge storage">${s.devices.length} devs</span>
        </div>

        <!-- Status Grid -->
        <div class="storage-status-grid">
          <div class="storage-stat-item">
            <span class="storage-stat-label">Scheduler</span>
            <span class="storage-stat-value">${rep ? rep.scheduler || '—' : '—'}</span>
          </div>
          <div class="storage-stat-item">
            <span class="storage-stat-label">Queue Depth</span>
            <span class="storage-stat-value muted">${rep ? (rep.nrRequests > 0 ? rep.nrRequests : '—') : '—'}</span>
          </div>
          <div class="storage-stat-item">
            <span class="storage-stat-label">Read-Ahead</span>
            <span class="storage-stat-value">${s.devices.map(d => d.readAheadKb + ' KB').join(' / ')}</span>
          </div>
          <div class="storage-stat-item">
            <span class="storage-stat-label">UFS Type</span>
            <span class="storage-stat-value muted">UFS 3.1</span>
          </div>
        </div>

        <div class="storage-section-label">Block Queue Tuning</div>

        <!-- Scheduler Selector -->
        <div class="config-row">
          <div>
            <div class="config-label">I/O Scheduler</div>
            <div class="config-hint">Requires elevator; <code>none</code> = HW dispatch (default)</div>
          </div>
          <select class="config-input freq-limit-select" id="storage-scheduler"
                  onchange="window.OC.onStorageSchedulerChange(this)">
            ${schedOptions}
          </select>
        </div>

        <!-- Read-Ahead Selector -->
        <div class="config-row">
          <div>
            <div class="config-label">Read-Ahead (all devs)</div>
            <div class="config-hint">Sequential pre-fetch buffer. ↑ seq read, ↓ random I/O</div>
          </div>
          <select class="config-input freq-limit-select" id="storage-read-ahead"
                  onchange="window.OC.onStorageReadAheadChange(this)">
            ${readAheadOptions}
          </select>
        </div>

        <!-- rq_affinity Selector -->
        <div class="config-row">
          <div>
            <div class="config-label">RQ Affinity</div>
            <div class="config-hint">Completion CPU affinity. 2 = force same CPU (lowest latency)</div>
          </div>
          <select class="config-input freq-limit-select" id="storage-rq-affinity"
                  onchange="window.OC.onStorageFieldChange('rqAffinity', this)">
            ${rqaOptions}
          </select>
        </div>

        <!-- nomerges Selector -->
        <div class="config-row">
          <div>
            <div class="config-label">I/O Merges</div>
            <div class="config-hint">Merge adjacent I/O requests. 0 = merge (best throughput)</div>
          </div>
          <select class="config-input freq-limit-select" id="storage-nomerges"
                  onchange="window.OC.onStorageFieldChange('nomerges', this)">
            ${nomOptions}
          </select>
        </div>

        <!-- Toggle row: iostats + add_random -->
        <div class="config-row">
          <div>
            <div class="config-label">I/O Stats</div>
            <div class="config-hint">Collect /proc/diskstats. Off = less overhead</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="storage-iostats" ${s.iostats ? 'checked' : ''}
                   onchange="window.OC.onStorageToggle('iostats', this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="config-row">
          <div>
            <div class="config-label">Entropy Feed</div>
            <div class="config-hint">Feed disk timings to /dev/random. Off = less overhead</div>
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
                <th>Device</th>
                <th>Sched</th>
                <th>RA</th>
                <th>Queue</th>
                <th>Merge</th>
                <th>Affin</th>
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
    html += `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span class="icon">🔧</span>
            UFS Controller · ufshcd
          </div>
          <span class="card-badge storage">11270000</span>
        </div>

        <div class="storage-status-grid">
          <div class="storage-stat-item">
            <span class="storage-stat-label">Write Booster</span>
            <span class="storage-stat-value${s.wbOn === 1 ? '' : ' muted'}">${s.wbOn === -1 ? 'N/A' : (s.wbOn ? 'ON' : 'OFF')}</span>
          </div>
          <div class="storage-stat-item">
            <span class="storage-stat-label">Clock Gating</span>
            <span class="storage-stat-value muted">${s.clkgateEnable === -1 ? 'N/A' : (s.clkgateEnable ? 'ON' : 'OFF')}</span>
          </div>
          <div class="storage-stat-item">
            <span class="storage-stat-label">CLK Gate Delay</span>
            <span class="storage-stat-value muted">${s.clkgateDelay > 0 ? s.clkgateDelay + ' ms' : '—'}</span>
          </div>
          <div class="storage-stat-item">
            <span class="storage-stat-label">HCI Address</span>
            <span class="storage-stat-value muted" style="font-size:0.72rem">0x11270000</span>
          </div>
        </div>`;

    if (s.wbOn !== -1) {
      html += `
        <div class="config-row">
          <div>
            <div class="config-label">Write Booster</div>
            <div class="config-hint">UFS WB — accelerates burst writes using SLC cache</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="storage-wb-on" ${s.wbOn ? 'checked' : ''}
                   onchange="window.OC.onStorageToggle('wbOn', this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>`;
    }

    html += `
        <div style="padding:8px 12px;font-size:0.72rem;color:var(--text-muted);line-height:1.4">
          ℹ️ Block queue attrs from kernel ELF analysis (42 attrs, 16 writable).
          <strong style="color:var(--text-secondary)">nr_requests</strong> requires an active elevator (returns EINVAL with <code>none</code>).
          Scheduler switch may require kernel support.
        </div>
      </div>`;

    return html;
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
              <p>No CPU data loaded.<br>Tap "Reload" to read OPP tables.</p>
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
              <p>No GPU data loaded.<br>Tap "Reload" to read OPP tables.</p>
            </div>
          </div>`;
      } else {
        gpuContainer.innerHTML = renderGpuCard();
      }
    }

    const ramContainer = document.getElementById('ram-devices');
    if (ramContainer) {
      if (state.ram.availableFreqs.length === 0) {
        ramContainer.innerHTML = `
          <div class="card">
            <div class="empty-state">
              <div class="icon">🧠</div>
              <p>No RAM data loaded.<br>Tap "Reload" to read DRAM info.</p>
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
              <p>No storage data loaded.<br>Tap "Reload" to read block device info.</p>
            </div>
          </div>`;
      } else {
        storageContainer.innerHTML = renderStorageCard();
      }
    }
  }

  /* ─── Data Loading ────────────────────────────────────────────────── */
  async function loadData() {
    showToast('Loading OPP data...', 'info');

    const modCheck = await exec(`lsmod 2>/dev/null | grep kpm_oc`);
    state.moduleLoaded = modCheck.errno === 0 && modCheck.stdout.includes('kpm_oc');
    updateModuleStatus();

    // --- CPU Data ---
    let cpuMap = new Map();

    const cpuRes = await exec(`cat ${KS_PARAMS}opp_table 2>/dev/null`);
    if (cpuRes.stdout.trim().length > 5 && cpuRes.stdout.includes('CPU:')) {
      cpuMap = parseCpuOppTable(cpuRes.stdout);
    }

    if (cpuMap.size === 0) {
      const fileRes = await exec(`cat ${CPU_OPP_FILE} 2>/dev/null`);
      if (fileRes.stdout.trim().length > 5 && fileRes.stdout.includes('CPU:')) {
        cpuMap = parseCpuOppTable(fileRes.stdout);
      }
    }

    state.cpuClusters = [];
    for (const policy of CPU_POLICIES) {
      const freqRes = await exec(`cat /sys/devices/system/cpu/cpufreq/policy${policy}/scaling_available_frequencies 2>/dev/null`);
      const freqs = freqRes.stdout.trim()
        ? freqRes.stdout.trim().split(/\s+/).map(f => parseInt(f, 10)).filter(f => !isNaN(f)).sort((a, b) => a - b)
        : [];

      const maxRes = await exec(`cat /sys/devices/system/cpu/cpufreq/policy${policy}/scaling_max_freq 2>/dev/null`);
      const minRes = await exec(`cat /sys/devices/system/cpu/cpufreq/policy${policy}/scaling_min_freq 2>/dev/null`);

      state.cpuClusters.push({
        id: policy,
        entries: cpuMap.get(policy) || [],
        freqs,
        curMax: parseInt(maxRes.stdout.trim(), 10) || (freqs.length > 0 ? freqs[freqs.length - 1] : 0),
        curMin: parseInt(minRes.stdout.trim(), 10) || (freqs.length > 0 ? freqs[0] : 0),
      });
    }

    // --- GPU Data ---
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

    state.originalCpu = JSON.parse(JSON.stringify(state.cpuClusters));
    state.originalGpu = JSON.parse(JSON.stringify(state.gpuEntries));

    // --- RAM Data ---
    const ramAvailRes = await exec(`cat ${DRAM_DEVFREQ}/available_frequencies 2>/dev/null`);
    const ramFreqs = ramAvailRes.stdout.trim()
      ? ramAvailRes.stdout.trim().split(/\s+/).map(f => parseInt(f, 10)).filter(f => !isNaN(f) && f > 0).sort((a, b) => a - b)
      : [];

    const ramCurRes = await exec(`cat ${DRAM_DEVFREQ}/cur_freq 2>/dev/null`);
    const ramMinRes = await exec(`cat ${DRAM_DEVFREQ}/min_freq 2>/dev/null`);
    const ramMaxRes = await exec(`cat ${DRAM_DEVFREQ}/max_freq 2>/dev/null`);
    const ramGovRes = await exec(`cat ${DRAM_DEVFREQ}/governor 2>/dev/null`);
    const ramRateRes = await exec(`cat ${DRAM_DATA_RATE} 2>/dev/null`);
    const ramTypeRes = await exec(`cat ${DRAM_TYPE_PATH} 2>/dev/null`);
    const vcoreRes = await exec(`cat ${VCORE_UV_PATH} 2>/dev/null`);

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

    renderAll();
    const cpuCount = state.cpuClusters.reduce((s, c) => s + c.entries.length, 0);
    showToast(`Loaded: CPU ${cpuCount} OPPs, GPU ${state.gpuEntries.length} OPPs, RAM ${ramFreqs.length} OPPs`, 'success');
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
      const [wbRes, cgEnRes, cgDelRes] = await Promise.all([
        exec(`cat ${hciPath}/wb_on 2>/dev/null`),
        exec(`cat ${hciPath}/clkgate_enable 2>/dev/null`),
        exec(`cat ${hciPath}/clkgate_delay_ms 2>/dev/null || cat ${hciPath}/clkgate_delay 2>/dev/null`),
      ]);
      const wbVal = parseInt(wbRes.stdout.trim(), 10);
      const cgVal = parseInt(cgEnRes.stdout.trim(), 10);
      const cgDel = parseInt(cgDelRes.stdout.trim(), 10);
      state.storage.wbOn = isNaN(wbVal) ? -1 : wbVal;
      state.storage.clkgateEnable = isNaN(cgVal) ? -1 : cgVal;
      state.storage.clkgateDelay = isNaN(cgDel) ? 0 : cgDel;
    }

    /* Use config values for user-selected fields; fall back to first device's current value */
    const cfgRes = await exec(`cat ${CONFIG_FILE} 2>/dev/null`);
    if (cfgRes.stdout) {
      const cfg = cfgRes.stdout;
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
      const wbM = cfg.match(/"ufs_wb_on":([0-9]+)/);
      if (wbM) state.storage.wbOn = parseInt(wbM[1], 10);
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
      badge.innerHTML = '<span class="status-dot"></span> Module Active';
    } else {
      badge.className = 'status-badge offline';
      badge.innerHTML = '<span class="status-dot"></span> Module Not Loaded';
    }
  }

  /* ─── Scan & Reload ───────────────────────────────────────────────── */
  async function scanAndLoad() {
    showToast('Reloading OPP data...', 'info');
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
      showToast('Invalid value', 'error');
      return;
    }

    /* freq inputs display MHz — convert to KHz for internal state */
    if (field === 'freq' && isMhz) {
      if (newValue > 10000) {
        showToast('MHz単位で入力してください（例: 3500）', 'error');
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

    if (isNaN(freq) || freq <= 0) { showToast('Invalid frequency', 'error'); return; }
    if (isNaN(volt) || volt <= 0) { showToast('Invalid voltage', 'error'); return; }
    if (freq > 10000) { showToast('MHz単位で入力してください（例: 3500）', 'error'); return; }

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
    showToast(`New ${type} OPP added (${formatFreqKHz(freq)})`, 'success');
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
      showToast(`Error: ${label} — ${res.stderr || 'errno=' + res.errno}`, 'error');
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
  async function applyAll() {
    showToast('Applying changes...', 'info');
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

      /* Apply CPU OC when:
       * - The max entry is a newly added OPP (isNew), OR
       * - The max entry's freq or voltage was modified, OR
       * - The max entry's freq is above stock origMax (covers re-apply after reload)
       * The kernel module patches CSRAM LUT[0] + cpufreq policy max.
       */
      if (maxEntry && (maxEntry.isNew || maxEntry.modified || maxEntry.freq > origMax)) {
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

      /* After OC apply, the kernel module patches LUT + lifts freq_qos.
       * Re-read scaling_available_frequencies (now includes OC freq) and
       * scaling_max_freq (now lifted to OC target) for each cluster.
       * Then set scaling_max_freq to the OC target and update the UI.
       */
      await new Promise(r => setTimeout(r, 300));
      for (const cluster of state.cpuClusters) {
        const freqRes = await exec(`cat /sys/devices/system/cpu/cpufreq/policy${cluster.id}/scaling_available_frequencies 2>/dev/null`);
        if (freqRes.stdout.trim()) {
          cluster.freqs = freqRes.stdout.trim().split(/\s+/)
            .map(f => parseInt(f, 10)).filter(f => !isNaN(f)).sort((a, b) => a - b);
        }

        /* Set scaling_max_freq to the OC target (the max entry we just applied) */
        const active = cluster.entries.filter(e => !e.removing);
        const maxEntry = active.length > 0
          ? active.reduce((m, e) => e.freq > m.freq ? e : m)
          : null;
        if (maxEntry && maxEntry.freq > 0) {
          const applied = await ensureCpuMax(cluster.id, maxEntry.freq);
          cluster.curMax = applied > 0 ? applied : maxEntry.freq;
        }

        /* Re-read actual value to confirm */
        const maxRes = await exec(`cat /sys/devices/system/cpu/cpufreq/policy${cluster.id}/scaling_max_freq 2>/dev/null`);
        const actualMax = parseInt(maxRes.stdout.trim(), 10);
        if (actualMax > 0) cluster.curMax = actualMax;
      }

      /* Keep selects/chips in sync with post-apply OC values. */
      renderAll();
    }

    /* CPU: per-LUT voltage overrides via kernel module (CSRAM direct write).
     * Format: "cluster:lut_idx:volt_uv cluster:lut_idx:volt_uv ..."
     * Cluster mapping: policy0→0(L), policy4→1(B), policy7→2(P)
     * NOTE: CSRAM LUT is stored in DESCENDING freq order (index 0 = highest),
     * but WebUI entries are sorted ASCENDING. Convert index accordingly.
     */
    {
      const clusterIdxMap = { 0: 0, 4: 1, 7: 2 };
      const voltOverrides = [];
      for (const cluster of state.cpuClusters) {
        const ci = clusterIdxMap[cluster.id];
        if (ci === undefined) continue;
        const activeEntries = cluster.entries.filter(e => !e.removing);
        const entryCount = activeEntries.length;
        for (let i = 0; i < cluster.entries.length; i++) {
          const entry = cluster.entries[i];
          if (!entry.removing && (entry.modified || entry.isNew) &&
              entry.volt !== entry.origVolt) {
            /* Reverse index: WebUI ascending [0]=lowest → CSRAM descending [N-1] */
            const lutIdx = entryCount - 1 - i;
            voltOverrides.push(`${ci}:${lutIdx}:${entry.volt}`);
          }
        }
      }
      if (voltOverrides.length > 0) {
        const overrideStr = voltOverrides.join(' ');
        await execChecked(
          `echo '${overrideStr}' > ${KS_PARAMS}cpu_volt_override`,
          'cpu_volt_override');
        anyOcApplied = true;
      }
    }

    /* --- GPU OC: detect top entry above stock max, apply via kpm_oc --- */
    const activeGpu = state.gpuEntries.filter(e => !e.removing);
    const gpuMax = activeGpu.length > 0
      ? activeGpu.reduce((m, e) => e.freq > m.freq ? e : m)
      : null;
    const origGpuMax = state.originalGpu.length > 0
      ? Math.max(...state.originalGpu.map(e => e.freq))
      : 0;

    if (gpuMax && (gpuMax.isNew || gpuMax.modified || gpuMax.freq > origGpuMax)) {
      /* gpu_target_* expects OPP-table units (gpufreqv2 value, not µV) */
      const voltStep = Math.round(gpuMax.volt / 10);
      const vsramStep = gpuMax.vsram > 0 ? Math.round(gpuMax.vsram / 10) : voltStep;
      await execChecked(`echo ${gpuMax.freq} > ${KS_PARAMS}gpu_target_freq`, 'gpu freq');
      await execChecked(`echo ${voltStep} > ${KS_PARAMS}gpu_target_volt`, 'gpu volt');
      await execChecked(`echo ${vsramStep} > ${KS_PARAMS}gpu_target_vsram`, 'gpu vsram');
      await execChecked(`echo 1 > ${KS_PARAMS}gpu_oc_apply`, 'gpu_oc_apply');
      await ensureGpuMax(gpuMax.freq);
      anyOcApplied = true;
    }

    /* GPU: per-OPP voltage overrides via kernel module (direct memory patch).
     * Bypasses driver fix_custom_freq_volt validation (DVFSState, volt clamp).
     * Format: "opp_idx:volt:vsram opp_idx:volt:vsram ..."
     */
    {
      const voltOverrides = [];
      for (let i = 0; i < state.gpuEntries.length; i++) {
        const entry = state.gpuEntries[i];
        if (!entry.removing && (entry.modified || entry.isNew) &&
            entry.volt !== entry.origVolt) {
          const voltStep = Math.round(entry.volt / 10);
          const vsramStep = entry.vsram > 0 ? Math.round(entry.vsram / 10) : voltStep;
          voltOverrides.push(`${i}:${voltStep}:${vsramStep}`);
        }
      }
      if (voltOverrides.length > 0) {
        const overrideStr = voltOverrides.join(' ');
        await execChecked(
          `echo '${overrideStr}' > ${KS_PARAMS}gpu_volt_override`,
          'gpu_volt_override');
        anyOcApplied = true;
      }
    }

    /* --- RAM: set DRAM min_freq floor via devfreq --- */
    const ramMinTarget = state.ram.selectedMinFreq;
    if (ramMinTarget > 0 && ramMinTarget !== state.originalRamMinFreq) {
      /* Use tee because shell redirect can fail in some su contexts */
      const ramRes = await exec(`echo ${ramMinTarget} | tee ${DRAM_DEVFREQ}/min_freq`);
      if (ramRes.errno === 0) {
        state.ram.minFreq = ramMinTarget;
        state.originalRamMinFreq = ramMinTarget;
        /* Re-read cur_freq and vcore after change */
        const newCur = await exec(`cat ${DRAM_DEVFREQ}/cur_freq 2>/dev/null`);
        const newVcore = await exec(`cat ${VCORE_UV_PATH} 2>/dev/null`);
        const newRate = await exec(`cat ${DRAM_DATA_RATE} 2>/dev/null`);
        state.ram.curFreq = parseInt(newCur.stdout.trim(), 10) || state.ram.curFreq;
        state.ram.vcoreUv = parseInt(newVcore.stdout.trim(), 10) || state.ram.vcoreUv;
        const rateMatch = newRate.stdout.match(/(\d+)/);
        if (rateMatch) state.ram.dataRate = parseInt(rateMatch[1], 10);
        showToast(`DRAM min floor → ${formatFreqHz(ramMinTarget)}`, 'success');
        renderAll();
      } else {
        showToast(`DRAM min_freq write failed: ${ramRes.stderr}`, 'error');
      }
      anyOcApplied = true;
    }

    await saveConfig();

    /* --- Storage: apply all block queue + UFS controller settings --- */
    const sto = state.storage;
    if (sto.devices.length > 0) {
      const results = [];

      for (const dev of sto.devices) {
        const base = `/sys/block/${dev.name}/queue`;

        /* Read-Ahead */
        if (sto.readAheadKb > 0 && dev.readAheadKb !== sto.readAheadKb) {
          const r = await exec(`echo ${sto.readAheadKb} > ${base}/read_ahead_kb 2>&1; echo $?`);
          if (r.stdout.trim().endsWith('0') || r.errno === 0) {
            dev.readAheadKb = sto.readAheadKb;
          }
        }

        /* Scheduler — write only if user selected a different one */
        if (sto.scheduler && dev.scheduler !== sto.scheduler) {
          const r = await exec(`echo ${sto.scheduler} > ${base}/scheduler 2>&1`);
          if (r.errno === 0 && !r.stderr.trim()) {
            dev.scheduler = sto.scheduler;
          } else {
            results.push(`sched:${r.stderr.trim().substring(0, 40)}`);
          }
        }

        /* nomerges */
        if (dev.nomerges !== sto.nomerges) {
          await exec(`echo ${sto.nomerges} > ${base}/nomerges 2>/dev/null`);
          dev.nomerges = sto.nomerges;
        }

        /* rq_affinity */
        if (dev.rqAffinity !== sto.rqAffinity) {
          await exec(`echo ${sto.rqAffinity} > ${base}/rq_affinity 2>/dev/null`);
          dev.rqAffinity = sto.rqAffinity;
        }

        /* iostats */
        if (dev.iostats !== sto.iostats) {
          await exec(`echo ${sto.iostats} > ${base}/iostats 2>/dev/null`);
          dev.iostats = sto.iostats;
        }

        /* add_random */
        if (dev.addRandom !== sto.addRandom) {
          await exec(`echo ${sto.addRandom} > ${base}/add_random 2>/dev/null`);
          dev.addRandom = sto.addRandom;
        }
      }

      /* UFS Write Booster */
      if (sto.ufsHciPath && sto.wbOn >= 0) {
        await exec(`echo ${sto.wbOn} > ${sto.ufsHciPath}/wb_on 2>/dev/null`);
      }

      showToast(`Storage: RA=${sto.readAheadKb}K sched=${sto.scheduler} rqa=${sto.rqAffinity} nom=${sto.nomerges}${sto.wbOn >= 0 ? ' WB=' + (sto.wbOn ? 'ON' : 'OFF') : ''}`, 'success');
      renderAll();
    }

    /* Read back results from kernel module for user feedback */
    if (anyOcApplied) {
      const cpuRes = await exec(`cat ${KS_PARAMS}cpu_oc_result 2>/dev/null`);
      const gpuRes = await exec(`cat ${KS_PARAMS}gpu_oc_result 2>/dev/null`);
      const cpuVoltRes = await exec(`cat ${KS_PARAMS}cpu_volt_ov_result 2>/dev/null`);
      const gpuVoltRes = await exec(`cat ${KS_PARAMS}gpu_volt_ov_result 2>/dev/null`);
      const details = [
        cpuRes.stdout.trim(),
        gpuRes.stdout.trim(),
        cpuVoltRes.stdout.trim(),
        gpuVoltRes.stdout.trim(),
      ].filter(s => s && s !== 'NOOP' && s !== '(null)').join(' | ');
      showToast(`Applied & saved! ${details}`, 'success');
    } else {
      showToast('Settings saved!', 'success');
    }
  }

  /* ─── Save Config ─────────────────────────────────────────────────── */
  async function saveConfig() {
    /* Read current kpm_oc OC params from sysfs (post-apply state) */
    const ocRaw = await exec(
      `echo "$(cat ${KS_PARAMS}cpu_oc_l_freq 2>/dev/null || echo 0)` +
      ` $(cat ${KS_PARAMS}cpu_oc_l_volt 2>/dev/null || echo 0)` +
      ` $(cat ${KS_PARAMS}cpu_oc_b_freq 2>/dev/null || echo 0)` +
      ` $(cat ${KS_PARAMS}cpu_oc_b_volt 2>/dev/null || echo 0)` +
      ` $(cat ${KS_PARAMS}cpu_oc_p_freq 2>/dev/null || echo 0)` +
      ` $(cat ${KS_PARAMS}cpu_oc_p_volt 2>/dev/null || echo 0)` +
      ` $(cat ${KS_PARAMS}gpu_target_freq 2>/dev/null || echo 0)` +
      ` $(cat ${KS_PARAMS}gpu_target_volt 2>/dev/null || echo 0)` +
      ` $(cat ${KS_PARAMS}gpu_target_vsram 2>/dev/null || echo 0)"`
    );
    const oc = ocRaw.stdout.trim().split(/\s+/).map(v => parseInt(v, 10) || 0);

    /* Flat config — easy to parse from shell without jq */
    const config = {
      version: 7,
      cpu_oc_l_freq:  oc[0] || 0,
      cpu_oc_l_volt:  oc[1] || 0,
      cpu_oc_b_freq:  oc[2] || 0,
      cpu_oc_b_volt:  oc[3] || 0,
      cpu_oc_p_freq:  oc[4] || 0,
      cpu_oc_p_volt:  oc[5] || 0,
      gpu_oc_freq:    oc[6] || 0,
      gpu_oc_volt:    oc[7] || 0,
      gpu_oc_vsram:   oc[8] || 0,
    };

    /* Add scaling limits */
    for (const cluster of state.cpuClusters) {
      /* Persist resolved runtime values to avoid stale select fallback. */
      config[`cpu_max_${cluster.id}`] = parseInt(cluster.curMax, 10) || 0;
      config[`cpu_min_${cluster.id}`] = parseInt(cluster.curMin, 10) || 0;
    }

    /* Add DRAM min freq floor */
    config.dram_min_freq = state.ram.selectedMinFreq || 0;

    /* Add storage / I/O settings */
    config.io_read_ahead_kb = state.storage.readAheadKb || 2048;
    config.io_scheduler = state.storage.scheduler || 'none';
    config.io_nomerges = state.storage.nomerges || 0;
    config.io_rq_affinity = state.storage.rqAffinity ?? 2;
    config.io_iostats = state.storage.iostats ?? 1;
    config.io_add_random = state.storage.addRandom || 0;
    if (state.storage.wbOn >= 0) config.ufs_wb_on = state.storage.wbOn;

    config.saved_at = new Date().toISOString();

    const json = JSON.stringify(config);
    await exec(`mkdir -p ${CONFIG_DIR} && printf '%s' '${json.replace(/'/g, "'\\''")}' > ${CONFIG_FILE}`);
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
    applyAll,
    scanAndLoad,
    loadData,
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
  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    loadData();
    loadStorageData().then(() => renderAll());
  });

})();
