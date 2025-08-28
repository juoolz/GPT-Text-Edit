// popup.js
// - Loads selection for active tab
// - Loads API key, model, and saved prompts
// - Sends request to OpenAI chat completions
// - Sends replacement back to content script

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getSelectionForTab(tabId) {
  const res = await chrome.runtime.sendMessage({ type: 'getSelectionForTab', tabId });
  return res?.selection || '';
}

async function loadSettings() {
  const { apiKey = '', model = 'gpt-4o-mini', prompts = [] } = await chrome.storage.sync.get(['apiKey', 'model', 'prompts']);
  return { apiKey, model, prompts: Array.isArray(prompts) ? prompts.slice(0, 5) : [] };
}

function renderPromptChips(container, prompts, promptInput) {
  container.innerHTML = '';
  for (const p of prompts) {
    const btn = document.createElement('button');
    btn.textContent = p.name || 'Prompt';
    btn.title = p.text || '';
    btn.addEventListener('click', () => {
      const sep = promptInput.value.trim() ? '\n' : '';
      promptInput.value = (promptInput.value + sep + (p.text || '')).trim();
      promptInput.dispatchEvent(new Event('input'));
    });
    container.appendChild(btn);
  }
}

async function callOpenAI({ apiKey, model, selection, prompt }) {
  const messages = [
    { role: 'system', content: 'You are a helpful assistant that refines text. Keep meaning, improve clarity, tone, and grammar. Return only the refined text unless explicitly asked otherwise.' },
    { role: 'user', content: `${prompt ? `Instruction: ${prompt}\n` : ''}Original:\n${selection}` }
  ];
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, messages, temperature: 0.2 })
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('No content in OpenAI response');
  return text;
}

document.addEventListener('DOMContentLoaded', async () => {
  const selectedTextEl = document.getElementById('selectedText');
  const promptEl = document.getElementById('prompt');
  const savedPromptsEl = document.getElementById('savedPrompts');
  const sendBtn = document.getElementById('sendBtn');
  const replaceBtn = document.getElementById('replaceBtn');
  const clearBtn = document.getElementById('clearBtn');
  const aiResultEl = document.getElementById('aiResult');
  const copyBtn = document.getElementById('copyBtn');
  const openOptions = document.getElementById('openOptions');

  const tab = await getActiveTab();
  const selection = tab?.id != null ? await getSelectionForTab(tab.id) : '';
  selectedTextEl.value = selection;

  const settings = await loadSettings();
  renderPromptChips(savedPromptsEl, settings.prompts, promptEl);

  function setBusy(busy) {
    sendBtn.disabled = busy;
    replaceBtn.disabled = busy || !aiResultEl.value.trim();
  }

  function updateReplaceEnabled() {
    replaceBtn.disabled = !aiResultEl.value.trim();
  }

  aiResultEl.addEventListener('input', updateReplaceEnabled);

  openOptions.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  clearBtn.addEventListener('click', () => {
    aiResultEl.value = '';
    updateReplaceEnabled();
  });

  copyBtn.addEventListener('click', async () => {
    const txt = aiResultEl.value;
    if (!txt) return;
    try { await navigator.clipboard.writeText(txt); } catch {}
  });

  sendBtn.addEventListener('click', async () => {
    const apiKey = settings.apiKey.trim();
    if (!apiKey) {
      aiResultEl.value = 'Missing API key. Set it in Options.';
      return;
    }
    const model = (settings.model || 'gpt-4o-mini').trim();
    const prompt = promptEl.value.trim();
    const sel = selectedTextEl.value.trim();
    if (!sel) {
      aiResultEl.value = 'No selected text to refine.';
      return;
    }
    setBusy(true);
    aiResultEl.value = 'Thinking…';
    try {
      const out = await callOpenAI({ apiKey, model, selection: sel, prompt });
      aiResultEl.value = out;
    } catch (e) {
      aiResultEl.value = String(e?.message || e);
    } finally {
      setBusy(false);
      updateReplaceEnabled();
    }
  });

  replaceBtn.addEventListener('click', async () => {
    const out = aiResultEl.value.trim();
    if (!out || tab?.id == null) return;
    try {
      await chrome.runtime.sendMessage({ type: 'replaceSelectionInTab', tabId: tab.id, text: out });
      window.close();
    } catch (e) {
      // leave popup open on failure
    }
  });
});

