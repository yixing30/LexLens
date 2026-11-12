/* Frame scripts ask only for the top-level site's hostname. No page text leaves the extension. */
(function () {
  const api = globalThis.chrome ?? globalThis.browser;
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'lexlens:top-host') return;
    try {
      const hostname = new URL(sender.tab?.url || sender.url).hostname;
      sendResponse({ hostname });
    } catch { sendResponse({ hostname: '' }); }
  });
})();
