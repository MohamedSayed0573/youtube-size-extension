(function() {
  const defaultSettings = { autoPrefetch: true, ttlHours: 6, showBadge: true, showLength: true, resolutions: ["480p", "720p", "1080p", "1440p"] };

  function $(id) { return document.getElementById(id); }

  async function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }
  async function storageSet(items) {
    return new Promise((resolve) => chrome.storage.local.set(items, resolve));
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function setResCheckboxes(arr) {
    const set = new Set(arr || []);
    const ids = [
      ["res_144", "144p"],
      ["res_240", "240p"],
      ["res_360", "360p"],
      ["res_480", "480p"],
      ["res_720", "720p"],
      ["res_1080", "1080p"],
      ["res_1440", "1440p"],
    ];
    for (const [id, label] of ids) {
      const el = $(id);
      if (el) el.checked = set.has(label);
    }
  }

  function getSelectedRes() {
    const res = [];
    if ($('res_1440')?.checked) res.push('1440p');
    if ($('res_240')?.checked) res.push('240p');
    if ($('res_360')?.checked) res.push('360p');
    if ($('res_480')?.checked) res.push('480p');
    if ($('res_720')?.checked) res.push('720p');
    if ($('res_1080')?.checked) res.push('1080p');
    return res;
  }

  async function load() {
    try {
      const obj = await storageGet(['ytSize_settings']);
      const s = obj && obj.ytSize_settings ? obj.ytSize_settings : {};
      const cfg = Object.assign({}, defaultSettings, s);
      $('autoPrefetch').checked = !!cfg.autoPrefetch;
      $('ttlHours').value = String(cfg.ttlHours);
      $('showBadge').checked = !!cfg.showBadge;
      if (document.getElementById('showLength')) {
        $('showLength').checked = cfg.showLength !== false; // default true
      }
      setResCheckboxes(cfg.resolutions || defaultSettings.resolutions);
    } catch (_) { /* ignore */ }
  }

  async function save() {
    const ttl = clamp(parseInt($('ttlHours').value, 10) || defaultSettings.ttlHours, 1, 48);
    let selected = getSelectedRes();
    const obj = {
      autoPrefetch: !!$('autoPrefetch').checked,
      ttlHours: ttl,
      showBadge: !!$('showBadge').checked,
      showLength: !!$('showLength')?.checked,
      resolutions: selected,
    };
    const st = $('status');
    if (!selected || selected.length === 0) {
      // enforce at least one resolution; fall back to defaults
      obj.resolutions = defaultSettings.resolutions.slice();
      st.textContent = 'At least one resolution is required. Reset to defaults (480p, 720p, 1080p, 1440p).';
      setTimeout(() => { st.textContent = ''; }, 3000);
    }
    await storageSet({ ytSize_settings: obj });
    st.textContent = 'Saved';
    setTimeout(() => { st.textContent = ''; }, 1500);
  }

  async function resetDefaults() {
    await storageSet({ ytSize_settings: defaultSettings });
    await load();
    const st = $('status');
    st.textContent = 'Reset to defaults';
    setTimeout(() => { st.textContent = ''; }, 1500);
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('save').addEventListener('click', save);
    $('reset').addEventListener('click', resetDefaults);
  });
})();
