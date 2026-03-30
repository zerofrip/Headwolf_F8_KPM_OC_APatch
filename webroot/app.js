/* ═══════════════════════════════════════════════════════════════════════
   KPM OC Manager v3.2 — Application Logic
   Headwolf F8 · Dimensity 8300 (MT8792 / MT6897)
   CPU: CSRAM LUT via kpm_oc.ko (mtk-cpufreq-hw domains)
   GPU: /proc/gpufreqv2 interface
   ═══════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  /* ─── Constants ───────────────────────────────────────────────────── */
  const KS_PARAMS = '/sys/module/kpm_oc/parameters/';
  const CONFIG_DIR = '/data/adb/modules/f8_kpm_oc_manager';
  const CONFIG_FILE = `${CONFIG_DIR}/oc_config.json`;
  const CPU_OPP_FILE = `${CONFIG_DIR}/cpu_opp_table`;
  const GPU_OPP_FILE = `${CONFIG_DIR}/gpu_opp_table`;

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

  function formatVoltUv(uv) {
    if (!uv || uv === 0) return '—';
    if (uv >= 1000000) return (uv / 1000000).toFixed(4) + ' V';
    return (uv / 1000).toFixed(2) + ' mV';
  }

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
                <th>Freq (KHz)</th>
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
                  <input type="number" class="cell-input" value="${entry.freq}"
                         data-field="freq" data-type="CPU" data-cluster="${cluster.id}" data-idx="${idx}"
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
            <input type="number" class="cell-input" placeholder="Freq (KHz)" id="add-cpu-freq-${cluster.id}">
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
                <th>Freq (KHz)</th>
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
                  <input type="number" class="cell-input" value="${entry.freq}"
                         data-field="freq" data-type="GPU" data-cluster="0" data-idx="${idx}"
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
            <input type="number" class="cell-input" placeholder="Freq (KHz)" id="add-gpu-freq-0">
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

    renderAll();
    const cpuCount = state.cpuClusters.reduce((s, c) => s + c.entries.length, 0);
    showToast(`Loaded: CPU ${cpuCount} OPPs, GPU ${state.gpuEntries.length} OPPs`, 'success');
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
      await exec(`echo 1 > ${KS_PARAMS}apply 2>/dev/null`);
      await new Promise(r => setTimeout(r, 500));
    }
    await loadData();
  }

  /* ─── Cell Change Handler ─────────────────────────────────────────── */
  function onCellChange(input) {
    const type = input.dataset.type;
    const clusterId = parseInt(input.dataset.cluster, 10);
    const idx = parseInt(input.dataset.idx, 10);
    const field = input.dataset.field;
    const newValue = parseInt(input.value, 10);

    if (isNaN(newValue) || newValue < 0) {
      showToast('Invalid value', 'error');
      return;
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

  /* ─── Add / Remove / Restore ──────────────────────────────────────── */
  function toggleAddForm(type, clusterId) {
    const form = document.getElementById(`${type.toLowerCase()}-add-form-${clusterId}`);
    if (form) form.classList.toggle('visible');
  }

  function confirmAddEntry(type, clusterId) {
    const freqInput = document.getElementById(`add-${type.toLowerCase()}-freq-${clusterId}`);
    const voltInput = document.getElementById(`add-${type.toLowerCase()}-volt-${clusterId}`);
    if (!freqInput || !voltInput) return;

    const freq = parseInt(freqInput.value, 10);
    const volt = parseInt(voltInput.value, 10);

    if (isNaN(freq) || freq <= 0) { showToast('Invalid frequency', 'error'); return; }
    if (isNaN(volt) || volt <= 0) { showToast('Invalid voltage', 'error'); return; }

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
          await execChecked(`echo ${v} > /sys/devices/system/cpu/cpufreq/policy${cluster.id}/scaling_max_freq`, `scaling_max p${cluster.id}`);
          cluster.curMax = v;
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
          await execChecked(`echo ${maxEntry.freq} > /sys/devices/system/cpu/cpufreq/policy${cluster.id}/scaling_max_freq`, `post-apply scaling_max p${cluster.id}`);
          cluster.curMax = maxEntry.freq;
        }

        /* Re-read actual value to confirm */
        const maxRes = await exec(`cat /sys/devices/system/cpu/cpufreq/policy${cluster.id}/scaling_max_freq 2>/dev/null`);
        const actualMax = parseInt(maxRes.stdout.trim(), 10);
        if (actualMax > 0) cluster.curMax = actualMax;
      }

      /* Keep selects/chips in sync with post-apply OC values. */
      renderAll();
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
      anyOcApplied = true;
    }

    /* GPU: voltage-only tweaks on existing frequencies (safe for fix_custom_freq_volt) */
    for (const entry of state.gpuEntries) {
      if (entry.modified && !entry.isNew && !entry.removing &&
          entry.freq === entry.origFreq && entry.volt !== entry.origVolt) {
        const gpuVoltStep = Math.round(entry.volt / 10);
        await exec(`echo "${entry.freq} ${gpuVoltStep}" > /proc/gpufreqv2/fix_custom_freq_volt`);
      }
    }

    await saveConfig();

    /* Read back results from kernel module for user feedback */
    if (anyOcApplied) {
      const cpuRes = await exec(`cat ${KS_PARAMS}cpu_oc_result 2>/dev/null`);
      const gpuRes = await exec(`cat ${KS_PARAMS}gpu_oc_result 2>/dev/null`);
      const details = [cpuRes.stdout.trim(), gpuRes.stdout.trim()].filter(s => s).join(' | ');
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
      version: 4,
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
    config.saved_at = new Date().toISOString();

    const json = JSON.stringify(config);
    await exec(`mkdir -p ${CONFIG_DIR} && printf '%s' '${json.replace(/'/g, "'\\''")}' > ${CONFIG_FILE}`);
  }

  /* ─── Public API ──────────────────────────────────────────────────── */
  window.OC = {
    onCellChange,
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
  });

})();
