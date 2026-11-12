(function () {
  'use strict';
  const api = globalThis.chrome?.storage?.local ? globalThis.chrome : globalThis.browser;
  const core = globalThis.LexLensCore;
  const recordList = document.getElementById('records');
  const siteList = document.getElementById('sites');
  const status = document.getElementById('status');
  function get(keys) { return new Promise(resolve => api.storage.local.get(keys, x => resolve(x || {}))); }
  function set(value) { return new Promise(resolve => api.storage.local.set(value, resolve)); }
  async function render() {
    const data = await get(['settings', 'records']);
    recordList.replaceChildren(); siteList.replaceChildren();
    const records = data.records || {};
    if (!Object.keys(records).length) { const li = document.createElement('li'); li.textContent = '暂无记录'; recordList.append(li); }
    for (const [key, value] of Object.entries(records).sort()) {
      const li = document.createElement('li');
      const label = document.createElement('span'); label.textContent = `${key}：${value === 'known' ? '已认识' : '仍不认识'} `;
      const remove = document.createElement('button'); remove.textContent = '删除';
      remove.onclick = async () => { delete records[key]; await set({ records }); status.textContent = '记录已删除'; render(); };
      li.append(label, remove); recordList.append(li);
    }
    const settings = core.normalizeSettings(data.settings);
    if (!settings.disabledSites.length) { const li = document.createElement('li'); li.textContent = '暂无网站'; siteList.append(li); }
    for (const site of settings.disabledSites) {
      const li = document.createElement('li');
      const label = document.createElement('span'); label.textContent = `${site} `;
      const remove = document.createElement('button'); remove.textContent = '重新开启';
      remove.onclick = async () => { settings.disabledSites = settings.disabledSites.filter(x => x !== site); await set({ settings }); status.textContent = '网站标注已开启'; render(); };
      li.append(label, remove); siteList.append(li);
    }
  }
  document.getElementById('clear-records').onclick = async () => { await set({ records: {} }); status.textContent = '个人记录已清空'; render(); };
  render();
})();
