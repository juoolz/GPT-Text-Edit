// background.js (service worker)
// - Creates context menu on install
// - Bridges messages between popup and content script
// - Stores the most recent selection per tab
// - Attempts to open the popup after user gesture

const selectionsByTab = new Map(); // tabId -> { text: string, ts: number }

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "refine-with-ai",
    title: "Refine with AI",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "refine-with-ai" && info.selectionText && tab && tab.id != null) {
    selectionsByTab.set(tab.id, { text: info.selectionText, ts: Date.now() });
    tryOpenPopup();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "selectionFromContent") {
        // Save selection for the sender's tab and open popup
        const tabId = sender?.tab?.id;
        if (tabId != null && typeof msg.text === "string" && msg.text.trim()) {
          selectionsByTab.set(tabId, { text: msg.text, ts: Date.now() });
          await tryOpenPopup();
          sendResponse({ ok: true });
          return;
        }
        sendResponse({ ok: false, error: "No selection or tab" });
        return;
      }

      if (msg?.type === "getSelectionForTab") {
        const { tabId } = msg;
        const entry = selectionsByTab.get(tabId ?? -1);
        sendResponse({ ok: true, selection: entry?.text || "" });
        return;
      }

      if (msg?.type === "replaceSelectionInTab") {
        const { tabId, text } = msg;
        if (tabId == null) {
          sendResponse({ ok: false, error: "Missing tabId" });
          return;
        }
        await chrome.tabs.sendMessage(tabId, { type: "replaceSelection", text });
        sendResponse({ ok: true });
        return;
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  // Indicate we will respond asynchronously
  return true;
});

async function tryOpenPopup() {
  try {
    if (chrome.action && chrome.action.openPopup) {
      await chrome.action.openPopup();
    }
  } catch (e) {
    // Some environments may disallow programmatic popup open if not clearly a user gesture
    // Silently ignore; user can click the action icon to open manually.
  }
}

