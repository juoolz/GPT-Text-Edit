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
  const { apiKey = '', model = 'gpt-4o-mini', prompts = [], outputFormat = 'html' } = await chrome.storage.sync.get(['apiKey', 'model', 'prompts', 'outputFormat']);
  return { apiKey, model, prompts: Array.isArray(prompts) ? prompts.slice(0, 5) : [], outputFormat };
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

async function callOpenAI({ apiKey, model, selection, prompt, outputFormat }) {
  const messages = [
    (function(){
      if (outputFormat === 'markdown') {
        return { role: 'system', content: 'You are a helpful assistant that refines text. Keep meaning, improve clarity, tone, and grammar. Return only the refined content in clean Markdown (headings, lists, bold/italic, links). Do not include HTML or code fences.' };
      }
      if (outputFormat === 'plain') {
        return { role: 'system', content: 'You are a helpful assistant that refines text. Keep meaning, improve clarity, tone, and grammar. Return only plain text with no Markdown or HTML. Preserve line breaks where useful.' };
      }
      // default: html
      return { role: 'system', content: 'You are a helpful assistant that refines text. Keep meaning, improve clarity, tone, and grammar. When using formatting (headings, bullet lists, bold/italic, links), output clean, minimal HTML using only <p>, <br>, <ul>, <ol>, <li>, <strong>, <em>, and <a>. Do not return Markdown. Do not include <html> or <body> wrappers. Return only the refined content.' };
    })(),
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
  const outputFormatEl = document.getElementById('outputFormat');
  const formatSection = document.getElementById('formatSection');

  const tab = await getActiveTab();
  const selection = tab?.id != null ? await getSelectionForTab(tab.id) : '';
  selectedTextEl.value = selection;

  const settings = await loadSettings();
  renderPromptChips(savedPromptsEl, settings.prompts, promptEl);
  outputFormatEl.value = settings.outputFormat || 'html';
  outputFormatEl.addEventListener('change', async () => {
    const val = outputFormatEl.value;
    await chrome.storage.sync.set({ outputFormat: val });
  });

  // Query capability to replace on this tab and hide UI if not possible
  async function updateReplaceCapability() {
    try {
      if (tab?.id == null) return;
      const res = await chrome.runtime.sendMessage({ type: 'canReplaceInTab', tabId: tab.id });
      const canReplace = !!res?.canReplace;
      replaceBtn.style.display = canReplace ? '' : 'none';
      formatSection.style.display = canReplace ? '' : 'none';
    } catch (e) {
      // If check fails, leave Replace visible to avoid blocking users
    }
  }
  updateReplaceCapability();

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
      const out = await callOpenAI({ apiKey, model, selection: sel, prompt, outputFormat: outputFormatEl.value || 'html' });
      aiResultEl.value = out;
    } catch (e) {
      aiResultEl.value = String(e?.message || e);
    } finally {
      setBusy(false);
      updateReplaceEnabled();
    }
  });

  function looksLikeHTML(s) {
    // naive check for HTML tags
    return /<\w+[\s\S]*>/m.test(s);
  }

  function looksLikeMarkdown(s) {
    // simple signals of markdown formatting
    if (/^\s{0,3}#{1,6}\s+\S/m.test(s)) return true; // headings
    if (/^\s{0,3}(?:-|\+|\*)\s+\S/m.test(s)) return true; // unordered list
    if (/^\s{0,3}\d+\.\s+\S/m.test(s)) return true; // ordered list
    if (/\*\*[^\n]+\*\*/.test(s) || /__[^\n]+__/.test(s)) return true; // bold
    if (/(?:^|\s)_(?:[^_\n]+)_(?:\s|$)/.test(s) || /(?:^|\s)\*(?:[^*\n]+)\*(?:\s|$)/.test(s)) return true; // italics
    if (/\[[^\]]+\]\([^\)]+\)/.test(s)) return true; // links
    return false;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Minimal markdown -> HTML converter for lists, emphasis, headings, links
  function markdownToHtml(md) {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    function flushParagraph(buf) {
      if (!buf.length) return;
      out.push(`<p>${inline(buf.join('\n'))}</p>`);
      buf.length = 0;
    }
    function inline(text) {
      // links [text](url)
      text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+\"([^\"]+)\")?\)/g, (m, t, url) => `<a href="${escapeHtml(url)}">${escapeHtml(t)}</a>`);
      // bold then italics
      text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                 .replace(/__([^_]+)__/g, '<strong>$1</strong>');
      text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
                 .replace(/_([^_]+)_/g, '<em>$1</em>');
      // escape remaining angle brackets
      // Do this last: escape only angle brackets not already part of tags we created
      // A simple approach: temporarily mask tags we created
      const MASK = '\u0000';
      text = text.replace(/<\/(?:strong|em|a)>/g, (m) => MASK + m)
                 .replace(/<(?:strong|em|a)(?:\s+[^>]*)?>/g, (m) => MASK + m)
                 .replace(/</g, '&lt;').replace(/>/g, '&gt;')
                 .replace(new RegExp(MASK + '(<[^>]+>)', 'g'), '$1');
      // line breaks inside paragraphs
      text = text.replace(/\n/g, '<br>');
      return text;
    }
    function parseList(startIndex, ordered) {
      const tag = ordered ? 'ol' : 'ul';
      const li = [];
      let idx = startIndex;
      const itemRegex = ordered ? /^\s{0,3}(\d+)\.\s+(.*)$/ : /^\s{0,3}(?:-|\+|\*)\s+(.*)$/;
      while (idx < lines.length) {
        const m = lines[idx].match(itemRegex);
        if (!m) break;
        let content = m[1] && ordered ? m[2] : m[1] ? m[1] : m[0].replace(/^\s{0,3}(?:-|\+|\*)\s+/, '');
        // collect following indented lines as part of the same li
        const buf = [content];
        let j = idx + 1;
        while (j < lines.length && /^\s{4,}\S/.test(lines[j])) {
          buf.push(lines[j].replace(/^\s{4}/, ''));
          j++;
        }
        li.push(`<li>${inline(buf.join('\n'))}</li>`);
        idx = j;
      }
      out.push(`<${tag}>${li.join('')}</${tag}>`);
      return idx;
    }
    const pbuf = [];
    while (i < lines.length) {
      const line = lines[i];
      // blank line -> end paragraph
      if (!line.trim()) {
        flushParagraph(pbuf);
        i++;
        continue;
      }
      // headings
      const h = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
      if (h) {
        flushParagraph(pbuf);
        const level = Math.min(6, h[1].length);
        out.push(`<h${level}>${inline(h[2])}</h${level}>`);
        i++;
        continue;
      }
      // ordered list
      if (/^\s{0,3}\d+\.\s+\S/.test(line)) {
        flushParagraph(pbuf);
        i = parseList(i, true);
        continue;
      }
      // unordered list
      if (/^\s{0,3}(?:-|\+|\*)\s+\S/.test(line)) {
        flushParagraph(pbuf);
        i = parseList(i, false);
        continue;
      }
      // default: accumulate paragraph
      pbuf.push(line);
      i++;
    }
    flushParagraph(pbuf);
    return out.join('');
  }

  function textToHtmlParagraphs(text) {
    const paras = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`);
    return paras.join('');
  }

  replaceBtn.addEventListener('click', async () => {
    const out = aiResultEl.value.trim();
    if (!out || tab?.id == null) return;
    const format = (outputFormatEl.value || 'html');
    let maybeHtml;
    if (format === 'html') {
      if (looksLikeHTML(out)) maybeHtml = out;
      else if (looksLikeMarkdown(out)) maybeHtml = markdownToHtml(out);
      else maybeHtml = textToHtmlParagraphs(out);
    } else if (format === 'markdown') {
      maybeHtml = markdownToHtml(out);
    } else {
      // plain: send no HTML and let content script insert raw text
      maybeHtml = undefined;
    }
    try {
      await chrome.runtime.sendMessage({ type: 'replaceSelectionInTab', tabId: tab.id, text: out, html: maybeHtml, format });
      window.close();
    } catch (e) {
      // leave popup open on failure
    }
  });
});
