(function () {
  'use strict';
  const api = globalThis.chrome?.storage?.local ? globalThis.chrome : globalThis.browser;
  const core = globalThis.LexLensCore;
  const grammar = globalThis.LexLensGrammar;
  if (!api?.storage?.local || !core || !document.documentElement) return;
  if (globalThis.__lexlensContentLoaded) return;
  globalThis.__lexlensContentLoaded = true;

  const SKIP = 'script,style,noscript,code,pre,kbd,samp,textarea,input,select,option,svg,canvas,math,rt,ruby:not(.lexlens-mark),[contenteditable],[role="textbox"],[aria-hidden="true"],#lexlens-ui-host';
  const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,figcaption,button,label,summary,caption,dt,dd,nav,header,footer,div,section,article,main';
  const BRIDGE_BREAK = 'br,hr,script,style,noscript,code,pre,kbd,samp,textarea,input,select,svg,canvas,math,[contenteditable],[hidden],[aria-hidden="true"]';
  const wrappers = new Set();
  const pending = new Set();
  const observedRoots = new Set();
  let settings = core.normalizeSettings();
  let records = {};
  let observer;
  let scheduled = false;
  let uiHost;
  let shadow;
  let detail;
  let layoutTimer;
  let englishLookupPromise;
  let englishDetailPromise;
  let englishDetails = {};
  let translatorPromise;
  let selectionTimer;
  let touchPoint;
  let siteHostname = location.hostname;
  let ready = false;
  let floatingButtonEnabled = false;
  let floatingButtonY = 1;
  let suppressFloatingClick = false;

  function siteDisabled() { return settings.disabledSites.includes(siteHostname); }
  function topHostname() {
    if (window === window.top) return Promise.resolve(location.hostname);
    try { return Promise.resolve(window.top.location.hostname); } catch { /* cross-origin frame */ }
    if (!api.runtime.sendMessage) return Promise.resolve(location.hostname);
    return new Promise(resolve => api.runtime.sendMessage({ type: 'lexlens:top-host' }, response => {
      // A frame still works if the browser cannot disclose the top URL.
      void api.runtime.lastError;
      resolve(response?.hostname || location.hostname);
    }));
  }
  function storeGet(keys) {
    return new Promise(resolve => api.storage.local.get(keys, value => resolve(value || {})));
  }
  function storeSet(value) { return new Promise(resolve => api.storage.local.set(value, resolve)); }
  function observe() {
    observedRoots.add(document.documentElement);
    for (const root of observedRoots) {
      if (root !== document.documentElement && !root.host?.isConnected) { observedRoots.delete(root); continue; }
      observer?.observe(root, { subtree: true, childList: true, characterData: true });
    }
  }
  function muted(fn) {
    observer?.disconnect();
    try { fn(); } finally { observe(); }
  }
  function isEligible(node, allowWhitespace = false) {
    const parent = node.parentElement;
    if (!parent || !(allowWhitespace ? node.textContent : node.textContent?.trim()) || parent.closest(SKIP) || parent.closest('.lexlens-mark')) return false;
    if (parent.isContentEditable || parent.closest('[hidden]')) return false;
    let element = parent;
    while (element && element !== document.documentElement) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      element = element.parentElement;
    }
    return parent.getClientRects().length > 0;
  }
  function blockFor(node) {
    const parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : node.nodeType === Node.ELEMENT_NODE ? node : node.host;
    return parent?.closest?.(BLOCKS) || parent;
  }
  function watchShadow(root) {
    if (observedRoots.has(root)) { queueTree(root); return; }
    observedRoots.add(root);
    const style = document.createElement('style');
    style.dataset.lexlensStyle = '';
    style.textContent = `ruby.lexlens-mark{ruby-position:over;cursor:pointer}ruby.lexlens-mark rt{color:#17448f;background:#fffdf0;font-size:clamp(9px,.5em,12px);font-weight:650;line-height:1.15;white-space:nowrap}span.lexlens-continuation{cursor:pointer}.lexlens-mark:focus-visible{outline:2px solid #184fba;outline-offset:3px}`;
    root.append(style);
    root.addEventListener('click', event => {
      const mark = event.target.closest?.('.lexlens-mark');
      if (!mark) return;
      event.preventDefault(); event.stopPropagation();
      openMark(mark);
    }, true);
    root.addEventListener('keydown', event => {
      const mark = event.target.closest?.('.lexlens-mark');
      if (!mark || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      openMark(mark);
    }, true);
    observer?.observe(root, { subtree: true, childList: true, characterData: true });
    queueTree(root);
  }
  function queueTree(root) {
    if (root.nodeType === Node.TEXT_NODE) { const block = blockFor(root); if (block) pending.add(block); return; }
    if (![Node.ELEMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(root.nodeType) || root.closest?.('#lexlens-ui-host')) return;
    if (root.shadowRoot) watchShadow(root.shadowRoot);
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) watchShadow(element.shadowRoot);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const block = blockFor(walker.currentNode);
      if (block) pending.add(block);
    }
  }
  function schedule() {
    if (scheduled || siteDisabled()) return;
    scheduled = true;
    const callback = deadline => {
      scheduled = false;
      const blocks = [...pending];
      blocks.sort((a, b) => priority(a) - priority(b));
      let count = 0;
      for (const block of blocks) {
        if (count >= 40 || (count >= 8 && deadline?.timeRemaining?.() < 2)) break;
        pending.delete(block);
        if (block.isConnected) annotateBlock(block);
        count++;
      }
      if (pending.size) schedule();
      if (count) requestLayoutCheck();
    };
    if (typeof window.requestIdleCallback === 'function') requestIdleCallback(callback, { timeout: 600 });
    else setTimeout(() => callback(), 30);
  }
  function priority(block) {
    const rect = block.getBoundingClientRect();
    if (!rect) return Infinity;
    if (rect.bottom >= -300 && rect.top <= innerHeight + 600) return Math.abs(rect.top);
    return 100000 + Math.abs(rect.top - innerHeight);
  }
  function makeRuby(original, item) {
    const ruby = document.createElement('ruby');
    ruby.className = 'lexlens-mark';
    ruby.tabIndex = 0;
    ruby.setAttribute('role', 'button');
    ruby.setAttribute('aria-label', `${item.text}，${item.gloss}，查看详细释义`);
    ruby.dataset.original = original;
    ruby.dataset.item = JSON.stringify(item);
    const rb = document.createElement('rb');
    rb.textContent = original;
    const rt = document.createElement('rt');
    rt.textContent = item.gloss;
    ruby.append(rb, rt);
    return ruby;
  }
  function makeContinuation(original, item) {
    const span = document.createElement('span');
    span.className = 'lexlens-mark lexlens-continuation';
    span.tabIndex = 0;
    span.setAttribute('role', 'button');
    span.setAttribute('aria-label', `${item.text}，${item.gloss}，查看详细释义`);
    span.dataset.original = original;
    span.dataset.item = JSON.stringify(item);
    span.textContent = original;
    return span;
  }
  function sourceText(block) {
    const segments = [];
    let text = '';
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (blockFor(node) !== block || !isEligible(node, true)) {
        if (node.textContent && !text.endsWith('\0')) text += '\0';
        continue;
      }
      segments.push({ node, start: text.length, end: text.length + node.textContent.length });
      text += node.textContent;
    }
    return { text, segments };
  }
  function bridgeAllowed(item, segments) {
    const first = segments.find(x => item.start >= x.start && item.start < x.end);
    const last = segments.find(x => item.end > x.start && item.end <= x.end);
    if (!first || !last) return false;
    if (first === last) return true;
    const range = document.createRange();
    range.setStart(first.node, item.start - first.start);
    range.setEnd(last.node, item.end - last.start);
    return !range.cloneContents().querySelector(BRIDGE_BREAK);
  }
  function restoreWithin(block, all = false) {
    const parents = new Set();
    for (const mark of block.querySelectorAll('.lexlens-mark')) {
      if (!wrappers.has(mark)) continue;
      if (!all && blockFor(mark.parentElement) !== block) continue;
      parents.add(mark.parentNode);
      const original = mark.querySelector('rb')?.textContent ?? mark.textContent;
      mark.replaceWith(document.createTextNode(original));
      wrappers.delete(mark);
    }
    for (const parent of parents) parent.normalize();
  }
  function annotateBlock(block) {
    muted(() => restoreWithin(block));
    const { text, segments } = sourceText(block);
    if (!segments.length) return;
    const found = core.candidates(text, settings, records).filter(item => bridgeAllowed(item, segments));
    if (!found.length) return;
    const byNode = new Map();
    for (const item of found) {
      let part = 0;
      for (const segment of segments) {
        const start = Math.max(item.start, segment.start);
        const end = Math.min(item.end, segment.end);
        if (start >= end) continue;
        if (!segment.node.textContent.slice(start - segment.start, end - segment.start).trim()) continue;
        const list = byNode.get(segment.node) || [];
        list.push({ start: start - segment.start, end: end - segment.start, item, first: part++ === 0 });
        byNode.set(segment.node, list);
      }
    }
    muted(() => {
      for (const [node, parts] of byNode) {
        const original = node.textContent;
        const fragment = document.createDocumentFragment();
        let index = 0;
        for (const part of parts) {
          if (part.start > index) fragment.append(document.createTextNode(original.slice(index, part.start)));
          const piece = original.slice(part.start, part.end);
          const mark = part.first ? makeRuby(piece, part.item) : makeContinuation(piece, part.item);
          wrappers.add(mark);
          fragment.append(mark);
          index = part.end;
        }
        if (index < original.length) fragment.append(document.createTextNode(original.slice(index)));
        node.replaceWith(fragment);
      }
    });
  }
  function restore() {
    muted(() => {
      for (const root of observedRoots) restoreWithin(root, true);
      wrappers.clear();
    });
  }
  function refresh() {
    const readerOpen = !!shadow?.querySelector('.reader');
    pending.clear();
    closeDetail();
    shadow?.querySelector('.lookup-action')?.remove();
    shadow?.querySelector('.banner')?.remove();
    if (!siteDisabled()) { queueTree(document.body || document.documentElement); schedule(); }
    else restore();
    if (window === window.top && !siteDisabled() && document.querySelector('ruby:not(.lexlens-mark)')) showBanner('网页已有注音，原位叠加释义可能碰撞；请使用独立阅读视图。');
    if (readerOpen) openReader();
    syncFloatingMenu();
  }
  function onMutations(mutations) {
    let changed = false;
    let removedSubtree = false;
    for (const mutation of mutations) {
      if (mutation.target.nodeType === Node.ELEMENT_NODE && mutation.target.closest?.('#lexlens-ui-host')) continue;
      if (mutation.type === 'characterData') {
        const block = blockFor(mutation.target);
        if (block) { pending.add(block); changed = true; }
      } else {
        const block = blockFor(mutation.target);
        if (block) { pending.add(block); changed = true; }
        for (const added of mutation.addedNodes) { queueTree(added); changed = true; }
        for (const removed of mutation.removedNodes) {
          if (removed.nodeType === Node.ELEMENT_NODE) {
            removedSubtree = true;
            if (wrappers.has(removed)) wrappers.delete(removed);
            for (const mark of removed.querySelectorAll('.lexlens-mark')) wrappers.delete(mark);
          }
        }
      }
    }
    if (removedSubtree) for (const mark of wrappers) if (!mark.isConnected) wrappers.delete(mark);
    if (changed) schedule();
  }
  function ensureUi() {
    if (uiHost) return;
    uiHost = document.createElement('div');
    uiHost.id = 'lexlens-ui-host';
    document.documentElement.append(uiHost);
    shadow = uiHost.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { font: 15px/1.5 system-ui,-apple-system,sans-serif; color:#15243c; }
      * { box-sizing:border-box; }
      [hidden] { display:none !important; }
      button,a { font:inherit; }
      button { cursor:pointer; border:1px solid #a7b8d2; background:#fff; color:#183f79; border-radius:7px; padding:6px 10px; }
      button:focus-visible,a:focus-visible { outline:2px solid #1458bf; outline-offset:2px; }
      .panel { position:fixed; z-index:2147483647; width:min(460px,calc(100vw - 24px)); max-height:min(58vh,540px); overflow:auto; overscroll-behavior:contain; background:#fff; border:1px solid #a9b8d0; border-radius:14px; box-shadow:0 12px 35px #14203b44; padding:16px 18px 18px; }
      .panel h2 { margin:0 56px 3px 0; font-size:20px; line-height:1.3; overflow-wrap:anywhere; }
      .panel p { margin:7px 0; }
      .panel .section-title { font-size:14px; font-weight:700; margin:12px 0 5px; }
      .panel .source-text { max-height:4.5em; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; color:#44516a; }
      .panel .translation { white-space:pre-wrap; overflow-wrap:anywhere; font-size:16px; line-height:1.65; }
      .panel .pronunciation { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin:5px 0 8px; }
      .panel .pronunciation button { padding:3px 7px; font-size:13px; }
      .panel .entry-line { white-space:pre-wrap; overflow-wrap:anywhere; margin:4px 0; line-height:1.55; }
      .panel .primary-gloss { font-size:16px; line-height:1.55; }
      .panel .lookup-tabs { display:flex; gap:4px; border-bottom:1px solid #d8e0eb; margin:10px 0 12px; }
      .panel .lookup-tabs button { border:0; border-bottom:3px solid transparent; border-radius:0; color:#52617b; padding:7px 12px; }
      .panel .lookup-tabs button[aria-selected="true"] { color:#17448f; border-bottom-color:#17448f; font-weight:700; }
      .panel.grammar-panel { background:#faf9f3; border-color:#c5d5c7; color:#193e32; }
      .grammar-panel h2 { font:700 21px/1.25 Georgia,"Songti SC",serif; color:#19483a; }
      .grammar-panel .close { border-color:#c4d3c4; color:#22543f; border-radius:50%; }
      .grammar-panel .lookup-tabs { border-bottom-color:#d5e0d5; }
      .grammar-panel .lookup-tabs button { color:#587365; }
      .grammar-panel .lookup-tabs button[aria-selected="true"] { color:#205842; border-bottom-color:#b86343; }
      .grammar-intro { margin:4px 0 12px !important; color:#687d70; font-size:12px; }
      .grammar-sentence { padding:10px 0; border-top:1px solid #dce5db; }
      .panel.grammar-panel .grammar-sentence summary { color:#245640; font-size:13px; line-height:1.45; overflow-wrap:anywhere; }
      .grammar-sentence[open] summary { margin-bottom:9px; }
      .grammar-original { max-height:none !important; margin:0 0 10px !important; color:#263f34 !important; font-size:14px; line-height:1.6; }
      .grammar-outline { margin:8px 0 10px; padding:9px 10px; border:1px solid #d8e2d6; border-radius:8px; background:#fffefa; }
      .grammar-outline strong { display:block; margin-bottom:4px; color:#245640; font-size:12px; }
      .grammar-outline p { margin:3px 0; color:#405b4b; font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
      .grammar-outline b { color:#a35639; }
      .grammar-finding { margin:8px 0; padding:8px 10px; border-left:3px solid #bc6845; border-radius:0 7px 7px 0; background:#f0f3eb; }
      .grammar-finding strong { display:block; margin-bottom:3px; color:#184b39; font-size:13px; }
      .grammar-finding .evidence { display:inline-block; margin-bottom:4px; color:#9f5639; font-size:12px; font-weight:700; overflow-wrap:anywhere; }
      .grammar-finding p { margin:3px 0; color:#3f5a4a; font-size:12px; line-height:1.5; }
      .grammar-empty { color:#61766a; font-size:12px; line-height:1.55; }
      .panel details { border-top:1px solid #e2e7ef; padding:8px 0; }
      .panel details summary { cursor:pointer; color:#17448f; font-weight:600; }
      .panel details[open] summary { margin-bottom:8px; }
      .panel .close { position:sticky; float:right; top:0; margin:-2px -4px 0 8px; padding:4px 9px; background:#fff; }
      .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
      .meta { color:#4d5970; font-size:12px; }
      .banner { position:fixed; right:12px; bottom:12px; max-width:min(400px,calc(100vw - 24px)); background:#fffdf0; color:#15243c; border:1px solid #b8a866; border-radius:9px; padding:10px 12px; box-shadow:0 5px 20px #14203b33; }
      :host([data-floating="true"]) .banner { right:76px; }
      .banner button { margin-left:8px; }
      .float-button { display:grid; place-items:center; position:fixed; z-index:2147483646; right:16px; width:48px; height:48px; padding:6px; border:1px solid #bfd0c0; border-radius:50%; background:#fbfaf3; box-shadow:0 0 0 4px #fbfaf3b8,0 9px 22px #173a3035; touch-action:none; user-select:none; transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease; }
      .float-button img { display:block; width:100%; height:100%; pointer-events:none; }
      .float-button:hover,.float-button[aria-expanded="true"] { border-color:#b96343; box-shadow:0 0 0 4px #fbfaf3db,0 12px 27px #173a3045; transform:translateY(-2px); }
      .float-button:active { transform:translateY(0) scale(.97); }
      .float-menu { position:fixed; z-index:2147483646; right:76px; width:min(302px,calc(100vw - 88px)); max-height:calc(100dvh - 24px); overflow:auto; overscroll-behavior:contain; padding:0 16px 13px; border:1px solid #d0d8cb; border-radius:16px; background:#f8f8f2; color:#193b32; box-shadow:0 17px 45px #142b2540,0 2px 7px #142b251a; font:13px/1.4 system-ui,-apple-system,"PingFang SC",sans-serif; animation:float-menu-enter .2s ease-out both; }
      .float-menu button:focus-visible,.float-menu select:focus-visible,.float-menu input:focus-visible,.float-button:focus-visible { outline:2px solid #a95d3e; outline-offset:2px; }
      .float-menu .float-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin:0 -16px 7px; padding:14px 16px 12px; color:#f4f6ed; background:#19483b; border-radius:15px 15px 0 0; }
      .float-menu .float-eyebrow { display:block; margin-bottom:4px; color:#bad7c2; font:700 9px/1.2 system-ui,sans-serif; letter-spacing:.14em; }
      .float-menu h2 { margin:0; color:#f9f7ed; font:700 21px/1.15 Georgia,"Songti SC",serif; letter-spacing:-.04em; }
      .float-menu .float-close { flex:none; display:grid; place-items:center; width:28px; height:28px; padding:0; border:1px solid #ffffff70; border-radius:50%; background:#ffffff15; color:#fff; font:20px/1 system-ui,sans-serif; }
      .float-menu .float-close:hover { background:#ffffff33; }
      .float-menu label { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:42px; margin:0; border-bottom:1px solid #e1e6dc; color:#274d3f; font-size:12px; font-weight:600; }
      .float-menu label:has(select) { min-height:48px; }
      .float-menu select { min-width:116px; max-width:59%; font:650 12px/1.2 system-ui,sans-serif; padding:7px 8px; border:1px solid #cbd8cb; border-radius:8px; background:#fffefa; color:#174235; }
      .float-menu input[type="checkbox"] { appearance:none; position:relative; flex:none; width:34px; height:20px; margin:0; border:1px solid #bccbc0; border-radius:20px; background:#dbe2d8; cursor:pointer; transition:background .2s ease,border-color .2s ease; }
      .float-menu input[type="checkbox"]::after { content:""; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:#fff; box-shadow:0 1px 3px #0003; transition:transform .2s ease; }
      .float-menu input[type="checkbox"]:checked { background:#24634f; border-color:#24634f; }
      .float-menu input[type="checkbox"]:checked::after { transform:translateX(14px); }
      .float-menu .float-actions { display:flex; gap:7px; margin-top:13px; }
      .float-menu .float-actions button { flex:1 1 0; min-width:0; padding:9px 5px; border-radius:8px; border-color:#cad7ca; background:#fffefa; color:#245342; font-size:11px; font-weight:700; transition:transform .18s ease,background .18s ease; }
      .float-menu .float-actions button:first-child { border-color:#bc6845; background:#bc6845; color:#fff; }
      .float-menu .float-actions button:hover { transform:translateY(-2px); background:#edf2e9; }
      .float-menu .float-actions button:first-child:hover { background:#a95737; }
      .float-menu .float-hint { margin:10px 0 0; color:#718277; font-size:10px; line-height:1.45; }
      @keyframes float-menu-enter { from { opacity:0; transform:translateY(6px) scale(.985); } to { opacity:1; transform:none; } }
      @media (max-width:420px) { .float-menu label:has(select) { align-items:stretch; flex-direction:column; gap:5px; padding:7px 0; } .float-menu select { max-width:100%; width:100%; } }
      @media (prefers-reduced-motion:reduce) { .float-button,.float-menu,.float-menu input[type="checkbox"],.float-menu input[type="checkbox"]::after,.float-menu .float-actions button { animation:none; transition:none; } }
      .reader { position:fixed; inset:0; overflow:auto; background:#f8f7f2; color:#17263a; z-index:2; }
      .reader-head { position:sticky; top:0; background:#fff; border-bottom:1px solid #ccd3dd; padding:12px max(20px,calc((100vw - 760px)/2)); display:flex; gap:12px; align-items:center; justify-content:space-between; }
      .reader-main { max-width:760px; margin:auto; padding:16px 20px 80px; font:20px/2.2 system-ui,-apple-system,sans-serif; }
      .reader-main p { margin:0 0 1.15em; white-space:pre-wrap; overflow-wrap:anywhere; }
      .reader-main ruby { ruby-position:over; cursor:pointer; }
      .reader-main rt { font-size:10px; color:#17448f; background:#fffdf0; white-space:nowrap; }
      .reader .panel { z-index:3; }
      @media (max-width:600px) {
        .panel { left:0 !important; right:0; top:auto !important; bottom:0; width:100vw; max-height:72dvh; border-radius:16px 16px 0 0; padding:18px 18px max(18px,env(safe-area-inset-bottom)); font-size:16px; }
        .panel .translation,.panel .primary-gloss { font-size:17px; }
      }
    `;
    shadow.append(style);
    shadow.addEventListener('click', event => {
      const ruby = event.target.closest?.('.lexlens-mark');
      if (!ruby) return;
      event.preventDefault(); event.stopPropagation();
      openMark(ruby);
    });
    shadow.addEventListener('keydown', event => {
      const ruby = event.target.closest?.('.lexlens-mark');
      if (!ruby || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      openMark(ruby);
    });
    shadow.addEventListener('pointerdown', event => {
      if (detail?.isConnected && !detail.contains(event.target)) closeDetail();
    }, true);
  }
  function floatingRange() { return { min: 12, max: Math.max(12, innerHeight - 60) }; }
  function positionFloatingButton() {
    const button = shadow?.querySelector('.float-button');
    if (!button) return;
    const { min, max } = floatingRange();
    const top = min + (max - min) * floatingButtonY;
    button.style.top = `${top}px`;
    const menu = shadow.querySelector('.float-menu');
    if (menu) menu.style.top = `${Math.max(12, Math.min(top - 90, innerHeight - menu.offsetHeight - 12))}px`;
  }
  function closeFloatingMenu() {
    shadow?.querySelector('.float-menu')?.remove();
    shadow?.querySelector('.float-button')?.setAttribute('aria-expanded', 'false');
  }
  function syncFloatingMenu() {
    const menu = shadow?.querySelector('.float-menu');
    if (!menu) return;
    menu.querySelector('[data-setting="english"]').checked = settings.enabled.en;
    menu.querySelector('[data-setting="level"]').value = settings.levels.en;
    menu.querySelector('[data-setting="density"]').value = settings.density;
    menu.querySelector('[data-setting="current"]').checked = settings.includeCurrentLevel;
    menu.querySelector('[data-setting="site"]').checked = siteDisabled();
  }
  function openFloatingMenu() {
    if (shadow.querySelector('.float-menu')) { closeFloatingMenu(); return; }
    const menu = document.createElement('section');
    menu.className = 'float-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'LexLens 快捷设置');
    const head = document.createElement('div'); head.className = 'float-head';
    const heading = document.createElement('div');
    const eyebrow = document.createElement('span'); eyebrow.className = 'float-eyebrow'; eyebrow.textContent = 'LEXLENS / QUICK ACCESS';
    const title = document.createElement('h2'); title.textContent = '网页快捷设置';
    heading.append(eyebrow, title);
    const close = document.createElement('button'); close.className = 'float-close'; close.textContent = '×'; close.setAttribute('aria-label', '关闭快捷设置'); close.onclick = closeFloatingMenu;
    head.append(heading, close); menu.append(head);
    const addRow = (labelText, control) => {
      const label = document.createElement('label');
      const span = document.createElement('span'); span.textContent = labelText;
      label.append(span, control); menu.append(label);
      return control;
    };
    const english = document.createElement('input'); english.type = 'checkbox'; english.dataset.setting = 'english';
    english.onchange = () => { settings.enabled.en = english.checked; void storeSet({ settings }); };
    addRow('英语标注', english);
    const level = document.createElement('select'); level.dataset.setting = 'level';
    for (const name of core.LEVELS.en) { const option = document.createElement('option'); option.value = name; option.textContent = name; level.append(option); }
    level.onchange = () => { settings.levels.en = level.value; void storeSet({ settings }); };
    addRow('已掌握等级', level);
    const density = document.createElement('select'); density.dataset.setting = 'density';
    for (const [value, name] of [['light', '少量提示'], ['standard', '标准'], ['all', '全部标注']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = name; density.append(option);
    }
    density.onchange = () => { settings.density = density.value; void storeSet({ settings }); };
    addRow('标注密度', density);
    const current = document.createElement('input'); current.type = 'checkbox'; current.dataset.setting = 'current';
    current.onchange = () => { settings.includeCurrentLevel = current.checked; void storeSet({ settings }); };
    addRow('也显示所选等级', current);
    const site = document.createElement('input'); site.type = 'checkbox'; site.dataset.setting = 'site';
    site.onchange = () => {
      settings.disabledSites = settings.disabledSites.filter(name => name !== siteHostname);
      if (site.checked) settings.disabledSites.push(siteHostname);
      void storeSet({ settings });
    };
    addRow('关闭此网站标注', site);
    const actions = document.createElement('div'); actions.className = 'float-actions';
    const reader = document.createElement('button'); reader.textContent = '独立阅读视图'; reader.onclick = () => { closeFloatingMenu(); openReader(); };
    const rescan = document.createElement('button'); rescan.textContent = '重新扫描'; rescan.onclick = () => { closeFloatingMenu(); refresh(); };
    actions.append(reader, rescan); menu.append(actions);
    const hint = document.createElement('p'); hint.className = 'float-hint'; hint.textContent = '按住右侧按钮可上下拖动，位置会自动保存。'; menu.append(hint);
    shadow.append(menu);
    shadow.querySelector('.float-button').setAttribute('aria-expanded', 'true');
    syncFloatingMenu();
    positionFloatingButton();
    close.focus();
  }
  function createFloatingButton() {
    const button = document.createElement('button');
    button.className = 'float-button';
    button.type = 'button';
    const mark = document.createElement('img');
    mark.src = api.runtime.getURL('icons/mark.svg');
    mark.alt = '';
    button.append(mark);
    button.setAttribute('aria-label', 'LexLens 快捷设置，可上下拖动');
    button.setAttribute('aria-expanded', 'false');
    button.title = 'LexLens 快捷设置 · 上下拖动调整位置';
    let drag = null;
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      drag = { id: event.pointerId, startY: event.clientY, startTop: button.getBoundingClientRect().top, moved: false };
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(event.clientY - drag.startY) < 5) return;
      drag.moved = true;
      const { min, max } = floatingRange();
      const top = Math.max(min, Math.min(max, drag.startTop + event.clientY - drag.startY));
      floatingButtonY = max === min ? 1 : (top - min) / (max - min);
      positionFloatingButton();
    });
    const finishDrag = event => {
      if (!drag || event.pointerId !== drag.id) return;
      if (drag.moved) {
        suppressFloatingClick = event.type === 'pointerup';
        void storeSet({ floatingButtonY });
      }
      drag = null;
    };
    button.addEventListener('pointerup', finishDrag);
    button.addEventListener('pointercancel', finishDrag);
    button.addEventListener('click', () => {
      if (suppressFloatingClick) { suppressFloatingClick = false; return; }
      openFloatingMenu();
    });
    button.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const { min, max } = floatingRange();
      const delta = event.key === 'ArrowUp' ? -24 : 24;
      const top = Math.max(min, Math.min(max, min + (max - min) * floatingButtonY + delta));
      floatingButtonY = max === min ? 1 : (top - min) / (max - min);
      positionFloatingButton();
      void storeSet({ floatingButtonY });
    });
    return button;
  }
  function syncFloatingButton() {
    if (window !== window.top) return;
    if (!floatingButtonEnabled) {
      closeFloatingMenu();
      shadow?.querySelector('.float-button')?.remove();
      if (uiHost) uiHost.dataset.floating = 'false';
      return;
    }
    ensureUi();
    uiHost.dataset.floating = 'true';
    if (!shadow.querySelector('.float-button')) shadow.append(createFloatingButton());
    positionFloatingButton();
  }
  function closeDetail() { detail?.remove(); detail = null; }
  function openMark(mark) {
    const item = JSON.parse(mark.dataset.item);
    if (item.kind === 'dictionary') {
      const range = document.createRange();
      range.selectNodeContents(mark);
      openLookup(item.lemma, mark.getBoundingClientRect(), item, mark.closest('a[href]')?.href,
        sourceSentence(range, item.text));
    }
    else openDetail(mark, item);
  }
  function positionPanel(panel, rect) {
    if (innerWidth <= 600) return;
    const width = panel.getBoundingClientRect().width || 460;
    const height = panel.getBoundingClientRect().height || 300;
    panel.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    const below = innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const top = below >= Math.min(height, 280) || below >= above
      ? rect.bottom + 8 : rect.top - height - 8;
    panel.style.top = `${Math.max(12, Math.min(top, innerHeight - height - 12))}px`;
  }
  function openDetail(ruby, item) {
    ensureUi();
    closeDetail();
    detail = document.createElement('section');
    detail.className = 'panel';
    detail.setAttribute('role', 'dialog');
    detail.setAttribute('aria-label', `${item.text} 的释义`);
    positionPanel(detail, ruby.getBoundingClientRect());
    const heading = document.createElement('h2'); heading.textContent = `${item.text} · ${item.gloss}`;
    const close = document.createElement('button'); close.className = 'close'; close.textContent = '关闭'; close.setAttribute('aria-label', '关闭释义'); close.onclick = closeDetail;
    const explanation = document.createElement('p'); explanation.textContent = item.detail;
    const meta = document.createElement('p'); meta.className = 'meta';
    meta.textContent = `原形：${item.lemma} · ${item.type} · 等级：${item.level} · 等级依据：${item.levelSource || '人工估计'} · 释义来源：${item.source}`;
    const actions = document.createElement('div'); actions.className = 'actions';
    for (const [value, label] of [['known', '已认识'], ['unknown', '仍不认识']]) {
      const button = document.createElement('button'); button.textContent = label;
      button.onclick = async () => {
        records[`${item.lang}:${item.lemma}:${item.senseId}`] = value;
        await storeSet({ records });
        refresh();
      };
      actions.append(button);
    }
    const link = ruby.closest('a[href]');
    if (link && /^(https?:|mailto:)$/.test(new URL(link.href).protocol)) {
      const open = document.createElement('a');
      open.href = link.href; open.target = '_blank'; open.rel = 'noopener noreferrer';
      open.textContent = '打开原链接'; actions.append(open);
    }
    detail.append(heading, close, explanation, meta, actions);
    shadow.append(detail);
    positionPanel(detail, ruby.getBoundingClientRect());
    close.focus();
  }
  function loadEnglishLookup() {
    if (!englishLookupPromise) {
      const url = api.runtime?.getURL
        ? api.runtime.getURL('data/english-lookup.json')
        : new URL('../data/english-lookup.json', location.href).href;
      englishLookupPromise = fetch(url).then(response => {
        if (!response.ok) throw new Error('local dictionary unavailable');
        return response.json();
      }).then(data => { core.setEnglishLookupData(data); return true; }).catch(() => {
        englishLookupPromise = null;
        return false;
      });
    }
    return englishLookupPromise;
  }
  function loadEnglishDetails() {
    if (!englishDetailPromise) {
      const url = api.runtime?.getURL
        ? api.runtime.getURL('data/english-detail.json')
        : new URL('../data/english-detail.json', location.href).href;
      englishDetailPromise = fetch(url).then(response => {
        if (!response.ok) throw new Error('local dictionary detail unavailable');
        return response.json();
      }).then(data => { englishDetails = data; return true; }).catch(() => false);
    }
    return englishDetailPromise;
  }
  function speakEnglish(text, lang, status) {
    if (!('speechSynthesis' in window)) { status.textContent = '此浏览器不支持朗读。'; return; }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.88;
    const voices = speechSynthesis.getVoices();
    utterance.voice = voices.find(voice => voice.lang.toLowerCase() === lang.toLowerCase()) || null;
    if (!utterance.voice) {
      status.textContent = `未找到${lang === 'en-GB' ? '英式' : '美式'}语音，使用浏览器默认英语发音。`;
    } else status.textContent = '';
    utterance.onerror = () => { status.textContent = '朗读失败，请检查浏览器的语音设置。'; };
    speechSynthesis.speak(utterance);
  }
  function sourceSentence(range, query) {
    if (!range || /\s/.test(query)) return '';
    const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    const block = start?.closest?.('p,li,blockquote,figcaption,td,th,h1,h2,h3,h4,h5,h6') || start;
    if (!block || block.closest?.('#lexlens-ui-host')) return '';
    const plainText = fragment => {
      fragment.querySelectorAll('rt,script,style').forEach(node => node.remove());
      return fragment.textContent?.replace(/\s+/g, ' ').trim() || '';
    };
    const clone = block.cloneNode(true);
    const text = plainText(clone);
    const prefix = document.createRange();
    prefix.selectNodeContents(block);
    prefix.setEnd(range.startContainer, range.startOffset);
    const expectedAt = plainText(prefix.cloneContents()).length;
    const lower = text.toLocaleLowerCase('en');
    const needle = query.toLocaleLowerCase('en');
    let at = lower.slice(expectedAt, expectedAt + query.length) === needle
      ? expectedAt : lower.indexOf(needle, Math.max(0, expectedAt - 2));
    if (at < 0) at = lower.indexOf(needle);
    if (at < 0) return '';
    const left = Math.max(0, text.slice(0, at).search(/[^.!?。！？]*$/));
    const after = text.slice(at + query.length).search(/[.!?。！？]/);
    const right = after < 0 ? text.length : at + query.length + after + 1;
    const from = right - left <= 300 ? left : Math.max(left, Math.min(at - 120, right - 300));
    return text.slice(from, Math.min(right, from + 300)).trim();
  }
  function createTranslator(status) {
    if (!translatorPromise) {
      translatorPromise = Translator.create({
        sourceLanguage: 'en', targetLanguage: 'zh',
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', event => {
            status.textContent = `正在下载本地翻译语言包：${Math.round(event.loaded * 100)}%`;
          });
        }
      }).catch(error => { translatorPromise = null; throw error; });
    }
    return translatorPromise;
  }
  async function showTranslation(text, container) {
    const status = document.createElement('p'); status.className = 'meta';
    container.append(status);
    if (typeof Translator === 'undefined') {
      status.textContent = '此浏览器暂不支持本地英中整段翻译。词典释义仍可使用。';
      return;
    }
    async function translate() {
      status.textContent = '正在本机翻译…';
      try {
        const translator = await createTranslator(status);
        const translated = await translator.translate(text);
        if (!container.isConnected) return;
        status.remove();
        const result = document.createElement('p'); result.className = 'translation';
        result.textContent = translated;
        container.append(result);
      } catch (error) {
        status.textContent = `本地翻译暂不可用：${error?.message || '请稍后重试'}`;
      }
    }
    try {
      const availability = await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'zh' });
      if (!container.isConnected) return;
      if (availability === 'available') { await translate(); return; }
      if (availability === 'downloadable' || availability === 'downloading') {
        status.textContent = '首次翻译需要下载浏览器本地语言包。';
        const button = document.createElement('button');
        button.textContent = '下载并翻译';
        button.onclick = () => { button.remove(); void translate(); };
        container.append(button);
      } else status.textContent = '此设备暂不支持浏览器本地英中翻译。';
    } catch (error) { status.textContent = `无法检查本地翻译能力：${error?.message || '未知错误'}`; }
  }
  function showGrammar(text, container) {
    const intro = document.createElement('p'); intro.className = 'grammar-intro';
    intro.textContent = '按原文标出可辨认的语法线索；复杂句需结合上下文核对。分析仅在本机进行。';
    container.append(intro);
    const sentences = grammar?.analyze(text) || [];
    if (!sentences.length) {
      const empty = document.createElement('p'); empty.className = 'grammar-empty';
      empty.textContent = '没有可分析的英文句子。'; container.append(empty);
      return;
    }
    sentences.forEach((sentence, index) => {
      const section = document.createElement(sentences.length > 1 ? 'details' : 'section');
      section.className = 'grammar-sentence';
      if (sentences.length > 1) {
        section.open = index === 0;
        const summary = document.createElement('summary');
        summary.textContent = `句 ${index + 1} · ${sentence.text.slice(0, 76)}${sentence.text.length > 76 ? '…' : ''}`;
        section.append(summary);
      }
      const original = document.createElement('p'); original.className = 'source-text grammar-original';
      original.textContent = sentence.text; section.append(original);
      if (sentence.outline) {
        const outline = document.createElement('div'); outline.className = 'grammar-outline';
        const title = document.createElement('strong'); title.textContent = '先拆句'; outline.append(title);
        for (const part of sentence.outline) {
          const row = document.createElement('p');
          const label = document.createElement('b'); label.textContent = `${part.role} · `;
          row.append(label, document.createTextNode(part.text)); outline.append(row);
        }
        section.append(outline);
      }
      if (!sentence.findings.length) {
        const empty = document.createElement('p'); empty.className = 'grammar-empty';
        empty.textContent = '未识别到足够明确的固定结构。可先找主要动作，再看修饰语与连接词。';
        section.append(empty);
      }
      for (const finding of sentence.findings) {
        const item = document.createElement('div'); item.className = 'grammar-finding';
        const name = document.createElement('strong'); name.textContent = finding.name;
        const evidence = document.createElement('span'); evidence.className = 'evidence'; evidence.textContent = `原文线索：${finding.evidence}`;
        const explanation = document.createElement('p'); explanation.textContent = finding.explanation;
        const reading = document.createElement('p'); reading.textContent = `阅读方法：${finding.reading}`;
        item.append(name, evidence, explanation, reading); section.append(item);
      }
      container.append(section);
    });
  }
  async function openLookup(query, rect, profileItem = null, linkHref = null, example = '') {
    ensureUi();
    closeDetail();
    const word = /^[A-Za-z][A-Za-z'-]*$/.test(query) && query.length <= 80;
    detail = document.createElement('section');
    detail.className = 'panel';
    detail.setAttribute('role', 'dialog');
    detail.setAttribute('aria-label', word ? '查词与翻译' : '语法与翻译');
    if (!word) detail.classList.add('grammar-panel');
    const heading = document.createElement('h2'); heading.textContent = word ? query : '语法与翻译';
    const close = document.createElement('button'); close.className = 'close'; close.textContent = '关闭'; close.setAttribute('aria-label', '关闭查询'); close.onclick = closeDetail;
    detail.append(close, heading);
    const dictionary = document.createElement('div');
    dictionary.id = 'lexlens-lookup-dictionary';
    dictionary.setAttribute('role', 'tabpanel');
    const translateBox = document.createElement('div');
    translateBox.id = 'lexlens-lookup-translation';
    translateBox.setAttribute('role', 'tabpanel');
    if (!word) {
      const grammarBox = document.createElement('div'); grammarBox.id = 'lexlens-lookup-grammar'; grammarBox.setAttribute('role', 'tabpanel');
      const tabs = document.createElement('div'); tabs.className = 'lookup-tabs'; tabs.setAttribute('role', 'tablist');
      const grammarTab = document.createElement('button'); grammarTab.textContent = '语法'; grammarTab.setAttribute('role', 'tab'); grammarTab.setAttribute('aria-controls', grammarBox.id);
      const transTab = document.createElement('button'); transTab.textContent = '翻译'; transTab.setAttribute('role', 'tab'); transTab.setAttribute('aria-controls', translateBox.id);
      const original = document.createElement('p'); original.className = 'source-text'; original.textContent = query;
      translateBox.append(original);
      let translationStarted = false;
      const selectTab = name => {
        const isGrammar = name === 'grammar';
        grammarTab.setAttribute('aria-selected', String(isGrammar));
        transTab.setAttribute('aria-selected', String(!isGrammar));
        grammarBox.hidden = !isGrammar;
        translateBox.hidden = isGrammar;
        detail.scrollTop = 0;
        if (!isGrammar && !translationStarted) { translationStarted = true; void showTranslation(query, translateBox); }
      };
      grammarTab.onclick = () => selectTab('grammar');
      transTab.onclick = () => selectTab('translation');
      tabs.append(grammarTab, transTab);
      detail.append(tabs, grammarBox, translateBox);
      showGrammar(query, grammarBox);
      selectTab('grammar');
      shadow.append(detail);
      positionPanel(detail, rect);
      close.focus();
      return;
    }
    const pron = document.createElement('div'); pron.className = 'pronunciation';
    const phoneticLabel = document.createElement('span'); phoneticLabel.className = 'meta'; phoneticLabel.textContent = '正在读取音标…';
    const speechStatus = document.createElement('p'); speechStatus.className = 'meta';
    pron.append(phoneticLabel);
    for (const [lang, label] of [['en-GB', '🔊 英式'], ['en-US', '🔊 美式']]) {
      const button = document.createElement('button'); button.textContent = label;
      button.setAttribute('aria-label', `${query} ${label.slice(3)}发音`);
      button.onclick = () => speakEnglish(query, lang, speechStatus);
      pron.append(button);
    }
    detail.append(pron, speechStatus);
    const tabs = document.createElement('div'); tabs.className = 'lookup-tabs'; tabs.setAttribute('role', 'tablist');
    const dictTab = document.createElement('button'); dictTab.textContent = '词典'; dictTab.setAttribute('role', 'tab'); dictTab.setAttribute('aria-controls', dictionary.id);
    const transTab = document.createElement('button'); transTab.textContent = '翻译'; transTab.setAttribute('role', 'tab'); transTab.setAttribute('aria-controls', translateBox.id);
    let translationStarted = false;
    function selectTab(name) {
      const isDictionary = name === 'dictionary';
      dictTab.setAttribute('aria-selected', String(isDictionary));
      transTab.setAttribute('aria-selected', String(!isDictionary));
      dictionary.hidden = !isDictionary;
      translateBox.hidden = isDictionary;
      detail.scrollTop = 0;
      if (!isDictionary && !translationStarted) {
        translationStarted = true;
        void showTranslation(query, translateBox);
      }
    }
    dictTab.onclick = () => selectTab('dictionary');
    transTab.onclick = () => selectTab('translation');
    tabs.append(dictTab, transTab);
    detail.append(tabs, dictionary, translateBox);
    selectTab('dictionary');
    shadow.append(detail);
    positionPanel(detail, rect);
    close.focus();
    const loading = document.createElement('p'); loading.textContent = '正在读取本地词典…'; dictionary.append(loading);
    const [lookupLoaded] = await Promise.all([loadEnglishLookup(), loadEnglishDetails()]);
    if (!detail?.isConnected || detail.querySelector('h2') !== heading) return;
    const matches = core.lookup(query);
    loading.remove();
    const extra = englishDetails[query.toLocaleLowerCase('en')];
    const phonetic = extra?.[0];
    const definition = extra?.[1];
    phoneticLabel.textContent = phonetic ? `/${phonetic}/` : '暂无音标';
    const parts = [...new Set((matches.map(item => item.detail).join('\n') + '\n' + (definition || ''))
      .match(/(?:^|\n)(?:n|v|vi|vt|adj|adv|a|prep|conj|pron|interj|num|art)\./gim)?.map(value => value.trim().slice(0, -1).toLowerCase()) || [])];
    if (parts.length) {
      const part = document.createElement('p'); part.className = 'meta';
      part.textContent = `词性：${parts.join(' / ')}`;
      dictionary.append(part);
    }
    const primary = matches.find(item => item.recordable !== false) || matches[0];
    if (!primary) {
      const empty = document.createElement('p');
      empty.textContent = lookupLoaded ? '本地词典未收录此表达。' : '本地词典暂时无法读取。';
      dictionary.append(empty);
      if (!lookupLoaded) {
        const retry = document.createElement('button'); retry.textContent = '重试读取词典';
        retry.onclick = () => { void openLookup(query, rect, profileItem, linkHref, example); };
        dictionary.append(retry);
      }
      if (example && example.toLocaleLowerCase('en') !== query.toLocaleLowerCase('en')) {
        const title = document.createElement('p'); title.className = 'section-title'; title.textContent = '原句中文参考';
        const original = document.createElement('p'); original.className = 'source-text'; original.textContent = example;
        const note = document.createElement('p'); note.className = 'meta';
        note.textContent = '按网页原句进行本机翻译，有助于理解语境；不能当作该词的可靠词典释义。';
        const contextual = document.createElement('div');
        dictionary.append(title, original, note, contextual);
        void showTranslation(example, contextual);
      } else {
        const note = document.createElement('p'); note.className = 'meta';
        note.textContent = '没有可用原句，单独翻译词语可能有歧义。可切换“翻译”查看本机译文。';
        dictionary.append(note);
      }
    } else {
      const title = document.createElement('p'); title.className = 'section-title'; title.textContent = '中文释义';
      const lines = primary.detail.split('\n').map(line => line.trim()).filter(Boolean);
      const preview = lines.slice(0, 2).join('；').slice(0, 140);
      const gloss = document.createElement('p'); gloss.className = 'entry-line primary-gloss'; gloss.textContent = preview;
      const note = document.createElement('p'); note.className = 'meta';
      note.textContent = primary.recordable === false ? '词典常见义，未按当前句义消歧。' : '请结合网页原句核对词义。';
      dictionary.append(title, gloss, note);
      if (preview !== primary.detail) {
        const full = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = '完整中文释义';
        const content = document.createElement('p'); content.className = 'entry-line'; content.textContent = primary.detail;
        full.append(summary, content); dictionary.append(full);
      }
      const others = matches.filter(item => item !== primary);
      if (others.length) {
        const more = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = `更多词义（${others.length}）`;
        more.append(summary);
        for (const item of others) {
          const content = document.createElement('p'); content.className = 'entry-line'; content.textContent = item.detail;
          more.append(content);
        }
        dictionary.append(more);
      }
    }
    if (definition) {
      const en = document.createElement('details');
      const label = document.createElement('summary'); label.textContent = '英文释义';
      const content = document.createElement('p'); content.className = 'entry-line'; content.textContent = definition;
      en.append(label, content); dictionary.append(en);
    }
    if (example) {
      const sentence = document.createElement('details');
      const label = document.createElement('summary'); label.textContent = '例句（网页原句）';
      const content = document.createElement('p'); content.className = 'entry-line'; content.textContent = example;
      sentence.append(label, content); dictionary.append(sentence);
    }
    if (primary || profileItem || linkHref) {
      const info = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = '等级、来源与学习记录';
      info.append(summary);
      const item = profileItem || primary;
      if (item) {
        const meta = document.createElement('p'); meta.className = 'meta';
        meta.textContent = `${item.lemma} · ${item.type} · 等级：${item.level} · 等级依据：${item.levelSource || '人工估计'} · 释义来源：${item.source}`;
        info.append(meta);
      }
      const actions = document.createElement('div'); actions.className = 'actions';
      const recordItem = profileItem || (primary?.recordable !== false ? primary : null);
      if (recordItem) {
        for (const [value, label] of [['known', '已认识'], ['unknown', '仍不认识']]) {
          const button = document.createElement('button'); button.textContent = label;
          button.onclick = async () => {
            const key = `${recordItem.lang}:${recordItem.lemma}:${recordItem.senseId}`;
            records[key] = value === 'unknown' && recordItem.senseId === 'manual_unknown'
              ? { state: 'unknown', gloss: recordItem.gloss, type: recordItem.type, level: recordItem.level }
              : value;
            await storeSet({ records }); refresh();
          };
          actions.append(button);
        }
      } else if (primary?.lang === 'en') {
        const key = `en:${query.toLocaleLowerCase('en')}:manual_unknown`;
        const button = document.createElement('button'); button.textContent = '仍不认识，标注此词';
        button.onclick = async () => {
          const gloss = primary.gloss.replace(/^(?:n|v|vi|vt|adj|adv|a|prep|conj|pron)\.\s*/iu, '')
            .split(/[；;，,\n]/u)[0].trim().slice(0, 16);
          if (!gloss) return;
          records[key] = { state: 'unknown', gloss, type: primary.type, level: primary.level };
          await storeSet({ records }); refresh();
        };
        actions.append(button);
      }
      if (linkHref && /^(https?:|mailto:)$/.test(new URL(linkHref).protocol)) {
        const open = document.createElement('a'); open.href = linkHref; open.target = '_blank'; open.rel = 'noopener noreferrer';
        open.textContent = '打开原链接'; actions.append(open);
      }
      info.append(actions); dictionary.append(info);
    }
    positionPanel(detail, rect);
  }
  function showSelectionLookup() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const selected = range.cloneContents();
    selected.querySelectorAll('rt,script,style,#lexlens-ui-host').forEach(node => node.remove());
    selected.querySelectorAll('p,li,blockquote,br').forEach(node => node.append(document.createTextNode(' ')));
    const query = selected.textContent?.trim().replace(/\s+/g, ' ');
    if (!query || query.length > 3000 || !/[A-Za-z]/.test(query)) return;
    const parent = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
    if (parent?.closest?.('input,textarea,[contenteditable],[role="textbox"],#lexlens-ui-host')) return;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    void openLookup(query, rect, null, null, sourceSentence(range, query));
  }
  function wordAtPoint(x, y) {
    const range = document.caretRangeFromPoint?.(x, y) || (() => {
      const point = document.caretPositionFromPoint?.(x, y);
      if (!point) return null;
      const result = document.createRange(); result.setStart(point.offsetNode, point.offset); result.collapse(true); return result;
    })();
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return;
    const node = range.startContainer;
    if (node.parentElement?.closest(SKIP)) return;
    const text = node.textContent;
    let start = range.startOffset;
    let end = start;
    while (start > 0 && /[A-Za-z'-]/.test(text[start - 1])) start--;
    while (end < text.length && /[A-Za-z'-]/.test(text[end])) end++;
    const word = text.slice(start, end).replace(/^['-]+|['-]+$/g, '');
    if (!word) return;
    range.setStart(node, start); range.setEnd(node, end);
    return { word, range };
  }
  function showBanner(message, readingButton = true) {
    ensureUi();
    shadow.querySelector('.banner')?.remove();
    const banner = document.createElement('div'); banner.className = 'banner'; banner.setAttribute('role', 'status');
    const span = document.createElement('span'); span.textContent = message; banner.append(span);
    if (readingButton) {
      const button = document.createElement('button'); button.textContent = '独立阅读视图'; button.onclick = openReader; banner.append(button);
    }
    const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', '关闭提示'); close.onclick = () => banner.remove(); banner.append(close);
    shadow.append(banner);
  }
  function requestLayoutCheck() {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(checkLayout, 250);
  }
  function glossBounds(rt) {
    let left = 4;
    let right = innerWidth - 4;
    for (let parent = rt.parentElement?.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      if (!/^(hidden|clip|auto|scroll)$/.test(getComputedStyle(parent).overflowX)) continue;
      const rect = parent.getBoundingClientRect();
      left = Math.max(left, rect.left + 2);
      right = Math.min(right, rect.right - 2);
    }
    return { left, right };
  }
  function fitGloss(rt) {
    rt.style.removeProperty('position');
    rt.style.removeProperty('left');
    rt.style.removeProperty('max-width');
    rt.style.removeProperty('white-space');
    rt.style.removeProperty('overflow-wrap');
    const bounds = glossBounds(rt);
    const available = bounds.right - bounds.left;
    if (available < 24) return false;
    let rect = rt.getBoundingClientRect();
    if (rect.width > available) {
      rt.style.maxWidth = `${available}px`;
      rt.style.whiteSpace = 'normal';
      rt.style.overflowWrap = 'anywhere';
      rect = rt.getBoundingClientRect();
    }
    const shift = rect.left < bounds.left ? bounds.left - rect.left
      : rect.right > bounds.right ? bounds.right - rect.right : 0;
    if (shift) {
      rt.style.position = 'relative';
      rt.style.left = `${shift}px`;
      rect = rt.getBoundingClientRect();
    }
    return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
  }
  function checkLayout() {
    const annotations = [...wrappers].filter(x => x.isConnected).map(x => x.querySelector('rt')).filter(rt => {
      if (!rt) return false;
      const rect = rt.parentElement.getBoundingClientRect();
      return rect.bottom >= 0 && rect.top <= innerHeight && rect.right >= 0 && rect.left <= innerWidth;
    });
    let clipped = false;
    for (const rt of annotations) if (!fitGloss(rt)) clipped = true;
    if (clipped) {
      showBanner('部分行间释义仍受网页裁剪，可在独立阅读视图中查看。');
      shadow.querySelector('.banner').dataset.kind = 'layout';
      return;
    }
    for (let i = 0; i < annotations.length; i++) {
      const a = annotations[i].getBoundingClientRect();
      for (let j = i + 1; j < Math.min(i + 8, annotations.length); j++) {
        if (blockFor(annotations[i].parentElement) !== blockFor(annotations[j].parentElement)) continue;
        const b = annotations[j].getBoundingClientRect();
        if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) {
          showBanner('相邻释义发生拥挤，请使用独立阅读视图。');
          shadow.querySelector('.banner').dataset.kind = 'layout';
          return;
        }
      }
    }
    shadow?.querySelector('.banner[data-kind="layout"]')?.remove();
  }
  function readingBlocks() {
    const groups = new Map();
    const roots = [document.body, ...[...observedRoots].filter(root => root.host?.isConnected)];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (!parent || !node.textContent || parent.closest('rt,#lexlens-ui-host')) continue;
        const block = parent.closest('p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,figcaption,button,a,label') || parent;
        if (parent.closest(SKIP.replace(',rt', '').replace(',ruby:not(.lexlens-mark)', ''))) {
          if (node.textContent.trim()) groups.set(block, (groups.get(block) || '') + '\0');
          continue;
        }
        if (!parent.getClientRects().length) continue;
        groups.set(block, (groups.get(block) || '') + node.textContent);
      }
    }
    return [...groups.values()].flatMap(x => x.split('\0').map(part => part.trim()).filter(Boolean));
  }
  function appendAnnotated(parent, text) {
    const found = siteDisabled() ? [] : core.candidates(text, settings, records);
    let index = 0;
    for (const item of found) {
      if (item.start > index) parent.append(document.createTextNode(text.slice(index, item.start)));
      parent.append(makeRuby(text.slice(item.start, item.end), item));
      index = item.end;
    }
    parent.append(document.createTextNode(text.slice(index)));
  }
  function openReader() {
    ensureUi(); closeDetail(); closeFloatingMenu();
    shadow.querySelector('.reader')?.remove();
    const blocks = readingBlocks();
    const reader = document.createElement('div'); reader.className = 'reader'; reader.setAttribute('role', 'dialog'); reader.setAttribute('aria-label', '独立阅读视图');
    const head = document.createElement('div'); head.className = 'reader-head';
    const title = document.createElement('strong'); title.textContent = `${document.title || '当前网页'} · 独立阅读视图`;
    const close = document.createElement('button'); close.textContent = '返回网页'; close.onclick = () => reader.remove();
    head.append(title, close);
    const main = document.createElement('main'); main.className = 'reader-main';
    const note = document.createElement('p'); note.className = 'meta';
    note.textContent = '仅展示此页可读取的文字；图片、画布及嵌入内容不在阅读视图中。'; main.append(note);
    for (const text of blocks) { const p = document.createElement('p'); appendAnnotated(p, text); main.append(p); }
    reader.append(head, main); shadow.append(reader); close.focus();
  }
  document.addEventListener('click', event => {
    const ruby = event.target.closest?.('.lexlens-mark');
    if (!ruby || !ruby.isConnected) return;
    event.preventDefault(); event.stopPropagation();
    openMark(ruby);
  }, true);
  document.addEventListener('pointerdown', event => {
    if (detail?.isConnected && !event.composedPath().includes(uiHost)) {
      closeDetail();
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
    }
    if (shadow?.querySelector('.float-menu') && !event.composedPath().includes(uiHost)) closeFloatingMenu();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeDetail(); closeFloatingMenu(); shadow?.querySelector('.lookup-action')?.remove(); shadow?.querySelector('.reader')?.remove(); return; }
    const ruby = event.target.closest?.('.lexlens-mark');
    if (ruby && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); event.stopPropagation(); openMark(ruby);
    }
  }, true);
  document.addEventListener('mouseup', event => {
    if ((uiHost && event.composedPath().includes(uiHost)) || event.target.closest?.('.lexlens-mark')) return;
    setTimeout(showSelectionLookup, 0);
  });
  document.addEventListener('keyup', event => {
    if (event.key !== 'Escape' && !(uiHost && event.composedPath().includes(uiHost))) setTimeout(showSelectionLookup, 0);
  });
  document.addEventListener('touchstart', event => {
    if (event.touches.length !== 1 || (uiHost && event.composedPath().includes(uiHost))) return;
    const touch = event.touches[0];
    touchPoint = { x: touch.clientX, y: touch.clientY };
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      if (window.getSelection()?.toString().trim()) { showSelectionLookup(); return; }
      const hit = wordAtPoint(touchPoint.x, touchPoint.y);
      if (hit) void openLookup(hit.word, hit.range.getBoundingClientRect(), null, null, sourceSentence(hit.range, hit.word));
    }, 550);
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (!touchPoint || !event.touches.length) return;
    const touch = event.touches[0];
    if (Math.hypot(touch.clientX - touchPoint.x, touch.clientY - touchPoint.y) > 12) clearTimeout(selectionTimer);
  }, { passive: true });
  document.addEventListener('touchend', () => {
    clearTimeout(selectionTimer);
    setTimeout(showSelectionLookup, 0);
  }, { passive: true });
  window.addEventListener('resize', () => { requestLayoutCheck(); positionFloatingButton(); }, { passive: true });
  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'lexlens:reading') { openReader(); sendResponse({ ok: true }); }
    if (message?.type === 'lexlens:rescan') { refresh(); sendResponse({ ok: true }); }
    if (message?.type === 'lexlens:status') sendResponse({
      ok: true,
      ready,
      scanning: pending.size > 0 || scheduled,
      marked: [...wrappers].filter(x => x.isConnected && x.tagName === 'RUBY').length,
      siteDisabled: siteDisabled(),
      englishEnabled: settings.enabled.en,
      englishLevel: settings.levels.en,
      englishEvidence: settings.englishEvidence,
      density: settings.density
    });
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) settings = core.normalizeSettings(changes.settings.newValue);
    if (changes.records) records = changes.records.newValue || {};
    if (changes.settings || changes.records) refresh();
    if (changes.floatingButtonEnabled) {
      floatingButtonEnabled = changes.floatingButtonEnabled.newValue === true;
      syncFloatingButton();
    }
    if (changes.floatingButtonY) {
      const value = changes.floatingButtonY.newValue;
      floatingButtonY = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
      positionFloatingButton();
    }
  });
  observer = new MutationObserver(onMutations);
  Promise.all([storeGet(['settings', 'records', 'floatingButtonEnabled', 'floatingButtonY']), topHostname()]).then(([value, hostname]) => {
    siteHostname = hostname;
    settings = core.normalizeSettings(value.settings);
    records = value.records || {};
    floatingButtonEnabled = value.floatingButtonEnabled === true;
    floatingButtonY = Number.isFinite(value.floatingButtonY) ? Math.max(0, Math.min(1, value.floatingButtonY)) : 1;
    observe();
    ready = true;
    syncFloatingButton();
    if (siteDisabled()) return;
    queueTree(document.body || document.documentElement); schedule();
    if (window === window.top && document.querySelector('ruby:not(.lexlens-mark)')) showBanner('网页已有注音，原位叠加释义可能碰撞；请使用独立阅读视图。');
  });
})();
