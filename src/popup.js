(function () {
  'use strict';
  const api = globalThis.chrome?.storage?.local ? globalThis.chrome : globalThis.browser;
  const core = globalThis.LexLensCore;
  let settings;
  let floatingButtonEnabled = false;
  let hostname = '';
  let tabId;
  let tabUrl = '';
  let statusRequest = 0;
  let pollTimer;
  let activationAttempted = false;
  let rescanAttempted = false;
  const status = document.getElementById('status');
  const saveStatus = document.getElementById('save-status');
  const markedCount = document.getElementById('marked-count');
  const activeSite = document.getElementById('active-site');
  const liveState = document.getElementById('live-state');
  function connectionState(label) { liveState.textContent = label; }
  function message(text) { status.textContent = text; }
  function get(keys) { return new Promise(resolve => api.storage.local.get(keys, x => resolve(x || {}))); }
  function set(value) { return new Promise(resolve => api.storage.local.set(value, resolve)); }
  function activeTab() { return new Promise(resolve => api.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0]))); }
  function render() {
    document.getElementById('en-on').checked = settings.enabled.en;
    document.getElementById('en-level').value = settings.levels.en;
    document.getElementById('density').value = settings.density;
    document.getElementById('english-evidence').value = settings.englishEvidence;
    document.getElementById('include-current-level').checked = settings.includeCurrentLevel;
    document.getElementById('floating-button').checked = floatingButtonEnabled;
    const siteOff = document.getElementById('site-off');
    siteOff.checked = !!hostname && settings.disabledSites.includes(hostname);
    siteOff.disabled = !hostname;
    document.getElementById('site-label').textContent = hostname || '此页面不支持网站开关';
    activeSite.textContent = hostname || '当前页面不可读取';
    document.getElementById('reading').disabled = !tabId;
  }
  function checkPage(attempt = 0) {
    if (!attempt) clearTimeout(pollTimer);
    const request = ++statusRequest;
    if (!tabId || (!/^https?:/.test(tabUrl) && tabUrl !== api.runtime.getURL('src/selftest.html'))) {
      connectionState('此页不可用');
      message('此页面不支持扩展。请在 Chrome 中打开普通 http 或 https 网页。');
      return;
    }
    if (!attempt) message('正在检测网页脚本…');
    api.tabs.sendMessage(tabId, { type: 'lexlens:status' }, response => {
      const failed = !!api.runtime.lastError || !response?.ok;
      if (request !== statusRequest) return;
      if (failed) {
        connectionState('连接中');
        if (!activationAttempted && /^https?:/.test(tabUrl) && api.scripting) {
          activationAttempted = true;
          message('正在当前网页启动 LexLens…');
          Promise.resolve()
            .then(() => api.scripting.insertCSS({ target: { tabId }, files: ['src/content.css'] }))
            .then(() => api.scripting.executeScript({
              target: { tabId }, files: ['data/english-levels.js', 'data/english-inline.js', 'data/english-auto.js', 'src/core.js', 'src/content.js']
            }))
            .then(() => checkPage())
            .catch(() => message('无法在此页启动 LexLens。请确认它是 Chrome 中的普通网页，并检查扩展的当前网站访问权限。'));
          return;
        }
        message('未检测到 LexLens。请在 Chrome 的扩展详情中将“网站访问权限”设为“在所有网站上”，然后刷新此网页。');
        return;
      }
      const counts = `上方释义 ${response.marked || 0} 处`;
      markedCount.textContent = String(response.marked || 0);
      connectionState(response.siteDisabled || !response.englishEnabled ? '已暂停' : response.scanning || !response.ready ? '扫描中' : '本机运行');
      if (!response.ready || response.scanning) {
        message(`LexLens 已连接，正在扫描网页（${counts}）…`);
        if (attempt < 20) pollTimer = setTimeout(() => checkPage(attempt + 1), 500);
      } else if (response.siteDisabled) {
        message('LexLens 已连接，但此网站已关闭标注。');
      } else if (!response.englishEnabled) {
        message('LexLens 已连接，但英语标注已关闭。');
      } else if (response.marked) {
        message(`LexLens 已运行（${response.englishEvidence === 'sourced' ? '词表分级' : '包含粗略估计'}），${counts}。`);
      } else if (!rescanAttempted) {
        rescanAttempted = true;
        message('未发现标注，正在重新扫描网页…');
        api.tabs.sendMessage(tabId, { type: 'lexlens:rescan' }, result => {
          const failedRescan = !!api.runtime.lastError || !result?.ok;
          if (request !== statusRequest) return;
          if (failedRescan) message('页面脚本可能仍是旧版本。请刷新这个网页，再点击“重新扫描”。');
          else pollTimer = setTimeout(() => checkPage(1), 500);
        });
      } else {
        message('仍无标注 · 请检查英语开关、等级或网页文字。');
      }
    });
  }
  async function save() {
    rescanAttempted = false;
    await set({ settings });
    saveStatus.textContent = '设置已保存';
    setTimeout(() => checkPage(), 700);
  }
  const englishLevel = document.getElementById('en-level');
  for (const level of core.LEVELS.en) {
    const option = document.createElement('option'); option.value = level; option.textContent = level; englishLevel.append(option);
  }
  document.getElementById('en-on').addEventListener('change', async event => { settings.enabled.en = event.target.checked; await save(); });
  englishLevel.addEventListener('change', async event => { settings.levels.en = event.target.value; await save(); });
  document.getElementById('density').addEventListener('change', async event => { settings.density = event.target.value; await save(); });
  document.getElementById('english-evidence').addEventListener('change', async event => { settings.englishEvidence = event.target.value; await save(); });
  document.getElementById('include-current-level').addEventListener('change', async event => { settings.includeCurrentLevel = event.target.checked; await save(); });
  document.getElementById('floating-button').addEventListener('change', async event => {
    floatingButtonEnabled = event.target.checked;
    await set({ floatingButtonEnabled });
    saveStatus.textContent = floatingButtonEnabled ? '网页浮动按钮已开启' : '网页浮动按钮已关闭';
  });
  document.getElementById('site-off').addEventListener('change', async event => {
    settings.disabledSites = settings.disabledSites.filter(site => site !== hostname);
    if (event.target.checked) settings.disabledSites.push(hostname);
    await save();
  });
  document.getElementById('reading').addEventListener('click', () => {
    if (!tabId) return;
    api.tabs.sendMessage(tabId, { type: 'lexlens:reading' }, response => {
      if (api.runtime.lastError || !response?.ok) message('此页面不支持标注或阅读视图。');
      else window.close();
    });
  });
  document.getElementById('options').addEventListener('click', () => api.runtime.openOptionsPage());
  document.getElementById('selftest').addEventListener('click', () => {
    api.tabs.create({ url: api.runtime.getURL('src/selftest.html') });
    window.close();
  });
  document.getElementById('check-page').addEventListener('click', () => {
    if (!tabId) return;
    rescanAttempted = true;
    message('正在重新扫描网页…');
    api.tabs.sendMessage(tabId, { type: 'lexlens:rescan' }, result => {
      if (api.runtime.lastError || !result?.ok) message('无法重新扫描。请先刷新网页，再打开 LexLens。');
      else checkPage();
    });
  });
  Promise.all([get(['settings', 'floatingButtonEnabled']), activeTab()]).then(([value, tab]) => {
    settings = core.normalizeSettings(value.settings);
    floatingButtonEnabled = value.floatingButtonEnabled === true;
    tabId = tab?.id;
    tabUrl = tab?.url || '';
    try { if (/^https?:$/.test(new URL(tabUrl).protocol)) hostname = new URL(tabUrl).hostname; } catch { /* restricted page */ }
    render();
    checkPage();
  });
})();
