/* ═══════════════════════════════════════════════════════════════════════
   KPM OC Manager v2.0 — Application Logic
   ═══════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  /* ─── Constants ───────────────────────────────────────────────────── */
  const KS_PARAMS = '/sys/module/kpm_oc/parameters/';
  const CONFIG_DIR = '/data/adb/modules/f8_kpm_oc_manager';
  const CONFIG_FILE = `${CONFIG_DIR}/oc_config.json`;

  /* ─── State ───────────────────────────────────────────────────────── */
  const state = {
    activeTab: 'cpu',
    moduleLoaded: false,
    cpuClusters: [],
    gpuEntries: [],
    originalCpu: [],
    originalGpu: [],
    pendingChanges: [],
    settings: {
      cpu_oc_percent: 0,
      cpu_uvolt_offset: 0,
      gpu_oc_percent: 0,
      gpu_uvolt_offset: 0,
    },
  };

  /* ─── Shell Command Execution ─────────────────────────────────────── */
  async function exec(cmd) {
    return new Promise((resolve) => {
      // APatch / KernelSU WebUI API
      if (typeof ksu !== 'undefined' && ksu.exec) {
        ksu.exec(cmd, '{}', (result) => {
          try {
            const obj = JSON.parse(result);
            resolve({ errno: obj.errno || 0, stdout: obj.out || '', stderr: obj.err || '' });
          } catch {
            resolve({ errno: 0, stdout: result, stderr: '' });
          }
        });
      } else {
        // Desktop mock for development
        console.log('[MOCK] exec:', cmd);
        resolve(getMockResponse(cmd));
      }
    });
  }

  /* ─── Mock Data for Desktop Preview ───────────────────────────────── */
  function getMockResponse(cmd) {
    if (cmd.includes('cat') && cmd.includes('opp_table')) {
      return {
        errno: 0,
        stdout: 'CPU:0:500000000:850000|CPU:0:850000000:900000|CPU:0:1000000000:950000|CPU:0:1200000000:1000000|CPU:0:1400000000:1050000|CPU:0:1600000000:1100000|CPU:0:1800000000:1150000|CPU:0:2000000000:1200000|CPU:1:500000000:850000|CPU:1:850000000:900000|CPU:1:1200000000:975000|CPU:1:1600000000:1050000|CPU:1:2000000000:1125000|CPU:1:2200000000:1200000|CPU:1:2400000000:1275000|GPU:0:300000000:700000|GPU:0:400000000:750000|GPU:0:500000000:800000|GPU:0:600000000:850000|GPU:0:700000000:900000|GPU:0:800000000:950000',
        stderr: ''
      };
    }
    if (cmd.includes('cat') && cmd.includes('cpu_oc_percent'))
      return { errno: 0, stdout: '0', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('cpu_uvolt_offset'))
      return { errno: 0, stdout: '0', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('gpu_oc_percent'))
      return { errno: 0, stdout: '0', stderr: '' };
    if (cmd.includes('cat') && cmd.includes('gpu_uvolt_offset'))
      return { errno: 0, stdout: '0', stderr: '' };
    if (cmd.includes('scaling_available_frequencies'))
      return { errno: 0, stdout: '500000 850000 1000000 1200000 1400000 1600000 1800000 2000000', stderr: '' };
    if (cmd.includes('available_frequencies'))
      return { errno: 0, stdout: '300000000 400000000 500000000 600000000 700000000 800000000', stderr: '' };
    return { errno: 0, stdout: '', stderr: '' };
  }

  /* ─── OPP Data Parsing ────────────────────────────────────────────── */
  function parseOppTable(raw) {
    const entries = raw.trim().split('|').filter(s => s.length > 0);
    const cpuMap = new Map();
    const gpuList = [];

    for (const entry of entries) {
      const parts = entry.split(':');
      if (parts.length !== 4) continue;

      const [type, clusterId, freqStr, uvoltStr] = parts;
      const freq = parseInt(freqStr, 10);
      const uvolt = parseInt(uvoltStr, 10);

      if (isNaN(freq) || isNaN(uvolt)) continue;

      const item = {
        type,
        clusterId: parseInt(clusterId, 10),
        freq,
        uvolt,
        origFreq: freq,
        origUvolt: uvolt,
        modified: false,
        isNew: false,
        removing: false,
      };

      if (type === 'CPU') {
        if (!cpuMap.has(item.clusterId)) cpuMap.set(item.clusterId, []);
        cpuMap.get(item.clusterId).push(item);
      } else if (type === 'GPU') {
        gpuList.push(item);
      }
    }

    // Sort each cluster by frequency
    for (const [, list] of cpuMap) {
      list.sort((a, b) => a.freq - b.freq);
    }
    gpuList.sort((a, b) => a.freq - b.freq);

    return { cpuMap, gpuList };
  }

  /* ─── Sysfs Fallback: Read CPU Frequencies ────────────────────────── */
  async function readCpuFreqsSysfs() {
    const cpuMap = new Map();
    for (let policy = 0; policy < 8; policy++) {
      const path = `/sys/devices/system/cpu/cpufreq/policy${policy}`;
      const res = await exec(`cat ${path}/scaling_available_frequencies 2>/dev/null`);
      if (res.errno !== 0 || !res.stdout.trim()) continue;

      const freqs = res.stdout.trim().split(/\s+/).map(f => parseInt(f, 10) * 1000);
      const clusterId = policy;

      if (!cpuMap.has(clusterId)) cpuMap.set(clusterId, []);
      for (const freq of freqs) {
        cpuMap.get(clusterId).push({
          type: 'CPU', clusterId, freq, uvolt: 0,
          origFreq: freq, origUvolt: 0, modified: false, isNew: false, removing: false,
        });
      }
    }
    return cpuMap;
  }

  /* ─── Sysfs Fallback: Read GPU Frequencies ────────────────────────── */
  async function readGpuFreqsSysfs() {
    const gpuList = [];
    const paths = [
      '/sys/class/devfreq',
    ];

    // Find GPU devfreq device
    const findRes = await exec(`ls /sys/class/devfreq/ 2>/dev/null | head -10`);
    if (findRes.stdout) {
      const devfreqDevices = findRes.stdout.trim().split('\n');
      for (const dev of devfreqDevices) {
        const freqRes = await exec(`cat /sys/class/devfreq/${dev}/available_frequencies 2>/dev/null`);
        if (freqRes.stdout && freqRes.stdout.trim()) {
          const devNameLower = dev.toLowerCase();
          if (devNameLower.includes('gpu') || devNameLower.includes('mali') ||
              devNameLower.includes('sgpu') || devNameLower.includes('pvr')) {
            const freqs = freqRes.stdout.trim().split(/\s+/).map(f => parseInt(f, 10));
            for (const freq of freqs) {
              gpuList.push({
                type: 'GPU', clusterId: 0, freq, uvolt: 0,
                origFreq: freq, origUvolt: 0, modified: false, isNew: false, removing: false,
              });
            }
            break;
          }
        }
      }
    }

    gpuList.sort((a, b) => a.freq - b.freq);
    return gpuList;
  }

  /* ─── Format Helpers ──────────────────────────────────────────────── */
  function formatFreq(hz) {
    if (hz >= 1000000000) return (hz / 1000000000).toFixed(2) + ' GHz';
    if (hz >= 1000000) return (hz / 1000000).toFixed(0) + ' MHz';
    if (hz >= 1000) return (hz / 1000).toFixed(0) + ' KHz';
    return hz + ' Hz';
  }

  function formatVolt(uv) {
    if (uv === 0) return 'N/A';
    if (uv >= 1000000) return (uv / 1000000).toFixed(3) + ' V';
    if (uv >= 1000) return (uv / 1000).toFixed(1) + ' mV';
    return uv + ' µV';
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

  /* ─── Render OPP Table ────────────────────────────────────────────── */
  function renderOppTable(entries, containerId, type, clusterId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!entries || entries.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="icon">${type === 'CPU' ? '⚡' : '🎮'}</div>
          <p>No OPP entries found.<br>Tap "Scan & Load" to read from kernel.</p>
        </div>`;
      return;
    }

    const maxFreq = Math.max(...entries.map(e => e.freq));

    let html = `
      <div class="opp-table-wrapper">
        <table class="opp-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Frequency</th>
              <th>Voltage</th>
              <th style="width:28px"></th>
              <th style="width:60px"></th>
            </tr>
          </thead>
          <tbody>`;

    entries.forEach((entry, idx) => {
      const rowClass = entry.removing ? 'removing' :
                       entry.isNew ? 'new-entry' :
                       entry.modified ? (type === 'GPU' ? 'modified gpu-row' : 'modified') : '';
      const pct = maxFreq > 0 ? (entry.freq / maxFreq * 100) : 0;
      const barClass = type === 'GPU' ? 'gpu' : 'cpu';

      html += `
        <tr class="${rowClass}" data-idx="${idx}">
          <td><span class="cell-static" style="color:var(--text-muted)">${idx + 1}</span></td>
          <td>
            <input type="number" class="cell-input" value="${entry.freq}"
                   data-field="freq" data-type="${type}" data-cluster="${clusterId}" data-idx="${idx}"
                   onchange="window.OC.onCellChange(this)">
            <div class="freq-bar" style="margin-top:3px">
              <div class="freq-bar-fill ${barClass}" style="width:${pct}%"></div>
            </div>
          </td>
          <td>
            <input type="number" class="cell-input" value="${entry.uvolt}"
                   data-field="uvolt" data-type="${type}" data-cluster="${clusterId}" data-idx="${idx}"
                   onchange="window.OC.onCellChange(this)">
          </td>
          <td>
            <div class="info-chip freq">${formatFreq(entry.freq)}</div>
          </td>
          <td>
            <div class="row-actions">
              ${entry.modified || entry.isNew ? `<button class="btn-icon restore" title="Restore" onclick="window.OC.restoreRow('${type}', ${clusterId}, ${idx})">↩</button>` : ''}
              <button class="btn-icon danger" title="Remove" onclick="window.OC.removeRow('${type}', ${clusterId}, ${idx})">✕</button>
            </div>
          </td>
        </tr>`;
    });

    html += `
          </tbody>
        </table>
      </div>`;

    container.innerHTML = html;
  }

  /* ─── Render All ──────────────────────────────────────────────────── */
  function renderAll() {
    // CPU clusters
    const cpuContainer = document.getElementById('cpu-clusters');
    if (cpuContainer) {
      if (state.cpuClusters.length === 0) {
        cpuContainer.innerHTML = `
          <div class="card">
            <div class="empty-state">
              <div class="icon">⚡</div>
              <p>No CPU data loaded.<br>Tap "Scan & Load" to read OPP tables from the kernel.</p>
            </div>
          </div>`;
      } else {
        let html = '';
        state.cpuClusters.forEach((cluster, ci) => {
          const clusterNames = ['LITTLE', 'big', 'PRIME', 'Ultra'];
          const clusterName = clusterNames[ci] || `Cluster ${cluster.id}`;
          const entryCount = cluster.entries.length;
          const maxFreqStr = entryCount > 0 ? formatFreq(Math.max(...cluster.entries.map(e => e.freq))) : 'N/A';

          html += `
            <div class="card">
              <div class="card-header">
                <div class="card-title">
                  <span class="icon">⚡</span>
                  CPU ${clusterName}
                </div>
                <div>
                  <span class="card-badge cpu">${entryCount} OPPs</span>
                  <span class="info-chip freq" style="margin-left:4px">Max: ${maxFreqStr}</span>
                </div>
              </div>
              <div id="cpu-table-${cluster.id}"></div>
              <div id="cpu-add-form-${cluster.id}" class="add-form">
                <div class="add-form-row">
                  <input type="number" class="cell-input" placeholder="Freq (Hz)" id="add-cpu-freq-${cluster.id}">
                  <input type="number" class="cell-input" placeholder="Voltage (µV)" id="add-cpu-uvolt-${cluster.id}">
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
        });
        cpuContainer.innerHTML = html;

        // Render tables
        state.cpuClusters.forEach(cluster => {
          renderOppTable(cluster.entries, `cpu-table-${cluster.id}`, 'CPU', cluster.id);
        });
      }
    }

    // GPU
    const gpuContainer = document.getElementById('gpu-devices');
    if (gpuContainer) {
      if (state.gpuEntries.length === 0) {
        gpuContainer.innerHTML = `
          <div class="card">
            <div class="empty-state">
              <div class="icon">🎮</div>
              <p>No GPU data loaded.<br>Tap "Scan & Load" to read OPP tables from the kernel.</p>
            </div>
          </div>`;
      } else {
        const entryCount = state.gpuEntries.length;
        const maxFreqStr = entryCount > 0 ? formatFreq(Math.max(...state.gpuEntries.map(e => e.freq))) : 'N/A';

        gpuContainer.innerHTML = `
          <div class="card">
            <div class="card-header">
              <div class="card-title">
                <span class="icon">🎮</span>
                GPU (Mali)
              </div>
              <div>
                <span class="card-badge gpu">${entryCount} OPPs</span>
                <span class="info-chip volt" style="margin-left:4px">Max: ${maxFreqStr}</span>
              </div>
            </div>
            <div id="gpu-table-0"></div>
            <div id="gpu-add-form-0" class="add-form">
              <div class="add-form-row">
                <input type="number" class="cell-input" placeholder="Freq (Hz)" id="add-gpu-freq-0">
                <input type="number" class="cell-input" placeholder="Voltage (µV)" id="add-gpu-uvolt-0">
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

        renderOppTable(state.gpuEntries, 'gpu-table-0', 'GPU', 0);
      }
    }

    // Settings
    updateSettingsUI();
  }

  function updateSettingsUI() {
    const fields = ['cpu_oc_percent', 'cpu_uvolt_offset', 'gpu_oc_percent', 'gpu_uvolt_offset'];
    fields.forEach(f => {
      const el = document.getElementById(f);
      if (el) el.value = state.settings[f];
    });
  }

  /* ─── Data Loading ────────────────────────────────────────────────── */
  async function loadData() {
    showToast('Loading OPP data...', 'info');

    // Read module status
    const modCheck = await exec(`cat ${KS_PARAMS}opp_table 2>/dev/null`);
    state.moduleLoaded = modCheck.errno === 0 && modCheck.stdout.trim().length > 0 && !modCheck.stdout.includes('No such file');

    updateModuleStatus();

    let cpuMap = new Map();
    let gpuList = [];

    if (state.moduleLoaded && modCheck.stdout.trim().length > 5) {
      // Parse structured data from kernel module
      const parsed = parseOppTable(modCheck.stdout);
      cpuMap = parsed.cpuMap;
      gpuList = parsed.gpuList;
    }

    // If kernel module has no data, try sysfs fallback
    if (cpuMap.size === 0) {
      cpuMap = await readCpuFreqsSysfs();
    }
    if (gpuList.length === 0) {
      gpuList = await readGpuFreqsSysfs();
    }

    // Store state
    state.cpuClusters = [];
    for (const [clusterId, entries] of cpuMap) {
      state.cpuClusters.push({ id: clusterId, entries: [...entries] });
    }
    state.cpuClusters.sort((a, b) => a.id - b.id);

    state.gpuEntries = [...gpuList];

    // Store originals for restore
    state.originalCpu = JSON.parse(JSON.stringify(state.cpuClusters));
    state.originalGpu = JSON.parse(JSON.stringify(state.gpuEntries));

    // Load settings
    await loadSettings();

    renderAll();
    showToast('OPP data loaded successfully', 'success');
  }

  async function loadSettings() {
    const fields = ['cpu_oc_percent', 'cpu_uvolt_offset', 'gpu_oc_percent', 'gpu_uvolt_offset'];
    for (const field of fields) {
      const res = await exec(`cat ${KS_PARAMS}${field} 2>/dev/null`);
      if (res.stdout && !res.stdout.includes('No such file')) {
        const val = parseInt(res.stdout.trim(), 10);
        if (!isNaN(val)) state.settings[field] = val;
      }
    }
  }

  function updateModuleStatus() {
    const badge = document.getElementById('module-status');
    if (badge) {
      if (state.moduleLoaded) {
        badge.className = 'status-badge online';
        badge.innerHTML = '<span class="status-dot"></span> Module Active';
      } else {
        badge.className = 'status-badge offline';
        badge.innerHTML = '<span class="status-dot"></span> Module Not Loaded';
      }
    }
  }

  /* ─── Scan & Reload ───────────────────────────────────────────────── */
  async function scanAndLoad() {
    showToast('Triggering kernel OPP scan...', 'info');
    await exec(`echo 1 > ${KS_PARAMS}apply 2>/dev/null`);
    await new Promise(r => setTimeout(r, 500));
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
      if (cluster && cluster.entries[idx]) entry = cluster.entries[idx];
    } else if (type === 'GPU') {
      entry = state.gpuEntries[idx];
    }

    if (!entry) return;

    entry[field] = newValue;
    entry.modified = (entry.freq !== entry.origFreq || entry.uvolt !== entry.origUvolt);

    input.classList.toggle('modified', entry.modified);

    // Mark row
    const row = input.closest('tr');
    if (row) {
      row.classList.toggle('modified', entry.modified && !entry.isNew);
      if (type === 'GPU') row.classList.toggle('gpu-row', entry.modified);
    }
  }

  /* ─── Add Entry ───────────────────────────────────────────────────── */
  function toggleAddForm(type, clusterId) {
    const form = document.getElementById(`${type.toLowerCase()}-add-form-${clusterId}`);
    if (form) form.classList.toggle('visible');
  }

  function confirmAddEntry(type, clusterId) {
    const freqInput = document.getElementById(`add-${type.toLowerCase()}-freq-${clusterId}`);
    const uvoltInput = document.getElementById(`add-${type.toLowerCase()}-uvolt-${clusterId}`);

    if (!freqInput || !uvoltInput) return;

    const freq = parseInt(freqInput.value, 10);
    const uvolt = parseInt(uvoltInput.value, 10);

    if (isNaN(freq) || freq <= 0) {
      showToast('Invalid frequency value', 'error');
      return;
    }
    if (isNaN(uvolt) || uvolt <= 0) {
      showToast('Invalid voltage value', 'error');
      return;
    }

    const newEntry = {
      type, clusterId, freq, uvolt,
      origFreq: 0, origUvolt: 0,
      modified: false, isNew: true, removing: false,
    };

    if (type === 'CPU') {
      const cluster = state.cpuClusters.find(c => c.id === clusterId);
      if (cluster) {
        cluster.entries.push(newEntry);
        cluster.entries.sort((a, b) => a.freq - b.freq);
      }
    } else {
      state.gpuEntries.push(newEntry);
      state.gpuEntries.sort((a, b) => a.freq - b.freq);
    }

    // Clear inputs and hide form
    freqInput.value = '';
    uvoltInput.value = '';
    toggleAddForm(type, clusterId);

    renderAll();
    showToast(`New ${type} OPP entry added (${formatFreq(freq)})`, 'success');
  }

  /* ─── Remove Entry ────────────────────────────────────────────────── */
  function removeRow(type, clusterId, idx) {
    if (type === 'CPU') {
      const cluster = state.cpuClusters.find(c => c.id === clusterId);
      if (cluster && cluster.entries[idx]) {
        if (cluster.entries[idx].isNew) {
          cluster.entries.splice(idx, 1);
        } else {
          cluster.entries[idx].removing = !cluster.entries[idx].removing;
        }
      }
    } else {
      if (state.gpuEntries[idx]) {
        if (state.gpuEntries[idx].isNew) {
          state.gpuEntries.splice(idx, 1);
        } else {
          state.gpuEntries[idx].removing = !state.gpuEntries[idx].removing;
        }
      }
    }
    renderAll();
  }

  /* ─── Restore Entry ───────────────────────────────────────────────── */
  function restoreRow(type, clusterId, idx) {
    if (type === 'CPU') {
      const cluster = state.cpuClusters.find(c => c.id === clusterId);
      const origCluster = state.originalCpu.find(c => c.id === clusterId);
      if (cluster && cluster.entries[idx]) {
        if (cluster.entries[idx].isNew) {
          cluster.entries.splice(idx, 1);
        } else if (origCluster && origCluster.entries[idx]) {
          cluster.entries[idx].freq = origCluster.entries[idx].freq;
          cluster.entries[idx].uvolt = origCluster.entries[idx].uvolt;
          cluster.entries[idx].modified = false;
          cluster.entries[idx].removing = false;
        }
      }
    } else {
      if (state.gpuEntries[idx]) {
        if (state.gpuEntries[idx].isNew) {
          state.gpuEntries.splice(idx, 1);
        } else if (state.originalGpu[idx]) {
          state.gpuEntries[idx].freq = state.originalGpu[idx].freq;
          state.gpuEntries[idx].uvolt = state.originalGpu[idx].uvolt;
          state.gpuEntries[idx].modified = false;
          state.gpuEntries[idx].removing = false;
        }
      }
    }
    renderAll();
  }

  /* ─── Apply All Changes ───────────────────────────────────────────── */
  async function applyAll() {
    showToast('Applying changes...', 'info');
    let errorCount = 0;

    // Apply global settings
    const settingsFields = {
      cpu_oc_percent: document.getElementById('cpu_oc_percent'),
      cpu_uvolt_offset: document.getElementById('cpu_uvolt_offset'),
      gpu_oc_percent: document.getElementById('gpu_oc_percent'),
      gpu_uvolt_offset: document.getElementById('gpu_uvolt_offset'),
    };

    for (const [key, el] of Object.entries(settingsFields)) {
      if (!el) continue;
      const val = parseInt(el.value, 10) || 0;
      state.settings[key] = val;
      const res = await exec(`echo ${val} > ${KS_PARAMS}${key} 2>/dev/null`);
      if (res.stderr) errorCount++;
    }

    // Process per-entry changes
    const allEntries = [];

    // CPU changes
    for (const cluster of state.cpuClusters) {
      for (const entry of cluster.entries) {
        if (entry.removing && !entry.isNew) {
          await exec(`echo "CPU:${entry.clusterId}:${entry.origFreq}" > ${KS_PARAMS}opp_remove 2>/dev/null`);
        } else if (entry.isNew) {
          await exec(`echo "CPU:${entry.clusterId}:${entry.freq}:${entry.uvolt}" > ${KS_PARAMS}opp_add 2>/dev/null`);
          allEntries.push(`CPU:${entry.clusterId}:${entry.freq}:${entry.uvolt}`);
        } else if (entry.modified) {
          await exec(`echo "CPU:${entry.clusterId}:${entry.origFreq}:${entry.freq}:${entry.uvolt}" > ${KS_PARAMS}opp_modify 2>/dev/null`);
        }
      }
    }

    // GPU changes
    for (const entry of state.gpuEntries) {
      if (entry.removing && !entry.isNew) {
        await exec(`echo "GPU:${entry.clusterId}:${entry.origFreq}" > ${KS_PARAMS}opp_remove 2>/dev/null`);
      } else if (entry.isNew) {
        await exec(`echo "GPU:${entry.clusterId}:${entry.freq}:${entry.uvolt}" > ${KS_PARAMS}opp_add 2>/dev/null`);
        allEntries.push(`GPU:${entry.clusterId}:${entry.freq}:${entry.uvolt}`);
      } else if (entry.modified) {
        await exec(`echo "GPU:${entry.clusterId}:${entry.origFreq}:${entry.freq}:${entry.uvolt}" > ${KS_PARAMS}opp_modify 2>/dev/null`);
      }
    }

    // Trigger full rescan
    await exec(`echo 1 > ${KS_PARAMS}apply 2>/dev/null`);

    // Save config for persistence across reboots
    await saveConfig(allEntries);

    if (errorCount > 0) {
      showToast(`Applied with ${errorCount} warning(s)`, 'error');
    } else {
      showToast('All changes applied successfully!', 'success');
    }

    // Reload data to reflect actual state
    await new Promise(r => setTimeout(r, 500));
    await loadData();
  }

  /* ─── Save Config for Boot Persistence ────────────────────────────── */
  async function saveConfig(customOpps) {
    const config = {
      cpu_oc_percent: state.settings.cpu_oc_percent,
      cpu_uvolt_offset: state.settings.cpu_uvolt_offset,
      gpu_oc_percent: state.settings.gpu_oc_percent,
      gpu_uvolt_offset: state.settings.gpu_uvolt_offset,
      custom_opps: customOpps.join('|'),
      saved_at: new Date().toISOString(),
    };

    const json = JSON.stringify(config);
    await exec(`mkdir -p ${CONFIG_DIR} && echo '${json}' > ${CONFIG_FILE}`);
  }

  /* ─── Settings Change Handler ─────────────────────────────────────── */
  function onSettingChange(field) {
    const el = document.getElementById(field);
    if (el) {
      state.settings[field] = parseInt(el.value, 10) || 0;
    }
  }

  /* ─── Public API (exposed to HTML onclick handlers) ───────────────── */
  window.OC = {
    onCellChange,
    toggleAddForm,
    confirmAddEntry,
    removeRow,
    restoreRow,
    applyAll,
    scanAndLoad,
    onSettingChange,
    loadData,
  };

  /* ─── Init ────────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    loadData();
  });

})();
