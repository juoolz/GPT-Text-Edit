// contentScript.js
// Adds a floating ✨ button near current text selection to open the popup
// Receives replacement text and swaps it into the original selection

(function () {
  let buttonEl = null;
  let lastRange = null;
  let lastSelectionText = "";
  let hideTimer = null;

  function ensureButton() {
    if (buttonEl) return buttonEl;
    buttonEl = document.createElement('button');
    buttonEl.textContent = '✨';
    buttonEl.setAttribute('type', 'button');
    Object.assign(buttonEl.style, {
      position: 'fixed',
      zIndex: 2147483647,
      padding: '2px 6px',
      fontSize: '14px',
      lineHeight: '18px',
      borderRadius: '12px',
      border: '1px solid rgba(0,0,0,0.2)',
      background: '#fff',
      color: '#333',
      boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
      cursor: 'pointer',
      display: 'none'
    });
    buttonEl.title = 'Refine with AI';
    buttonEl.addEventListener('mousedown', (e) => {
      // Prevent selection from clearing on button press
      e.preventDefault();
    });
    buttonEl.addEventListener('click', onButtonClick);
    document.documentElement.appendChild(buttonEl);
    return buttonEl;
  }

  function onSelectionChange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      scheduleHide();
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const text = sel.toString();
    if (!text.trim()) {
      scheduleHide();
      return;
    }
    lastRange = range.cloneRange();
    lastSelectionText = text;
    const btn = ensureButton();
    const padding = 6;
    const top = Math.max(0, rect.top + window.scrollY - 28);
    const left = Math.max(0, rect.left + window.scrollX + rect.width + padding);
    btn.style.top = `${top}px`;
    btn.style.left = `${left}px`;
    btn.style.display = 'block';
  }

  function scheduleHide() {
    if (!buttonEl) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      buttonEl.style.display = 'none';
    }, 300);
  }

  async function onButtonClick() {
    const text = (window.getSelection()?.toString() || lastSelectionText || '').trim();
    if (!text) return;
    try {
      await chrome.runtime.sendMessage({ type: 'selectionFromContent', text });
    } catch (e) {
      // ignore
    }
  }

  function escapeHTML(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function simpleTextToHTML(text) {
    // Convert plain text to basic HTML: paragraphs and <br>
    const paras = text.split(/\n{2,}/).map(p => `<p>${escapeHTML(p).replace(/\n/g, '<br>')}</p>`);
    return paras.join('');
  }

  function insertHTMLAtRange(range, html) {
    // Try execCommand first (many editors hook into it)
    const ok = document.execCommand && document.execCommand('insertHTML', false, html);
    if (ok) return true;
    // Fallback: use Range to insert a DocumentFragment
    const frag = range.createContextualFragment(html);
    range.deleteContents();
    range.insertNode(frag);
    // Move caret to end of inserted content
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(range.endContainer);
      r.collapse(false);
      sel.addRange(r);
    }
    return true;
  }

  function insertTextAtRange(range, text) {
    // Prefer execCommand insertText for editor integrations
    const ok = document.execCommand && document.execCommand('insertText', false, text);
    if (ok) return true;
    // Fallback to range operations
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      const r = document.createRange();
      r.setStartAfter(node);
      r.collapse(true);
      sel.addRange(r);
    }
    return true;
  }

  function replaceInContentEditable(text, html, format) {
    const sel = window.getSelection();
    let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if ((!range || sel.isCollapsed) && lastRange) {
      // Try to restore last known range
      sel.removeAllRanges();
      sel.addRange(lastRange);
      range = sel.getRangeAt(0);
    }
    if (!range) return false;
    if (format === 'plain') {
      return insertTextAtRange(range, text);
    }
    const htmlToInsert = (typeof html === 'string' && html.trim()) ? html : simpleTextToHTML(text);
    return insertHTMLAtRange(range, htmlToInsert);
  }

  function replaceInInputOrTextarea(el, text) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start == null || end == null) return false;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    el.value = before + text + after;
    const pos = before.length + text.length;
    el.selectionStart = el.selectionEnd = pos;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'replaceSelection') {
      const text = String(msg.text ?? '');
      const html = typeof msg.html === 'string' ? msg.html : undefined;
      const format = typeof msg.format === 'string' ? msg.format : undefined;
      // Try input/textarea first if focused
      const active = document.activeElement;
      const isTextControl = active && (active.tagName === 'TEXTAREA' ||
        (active.tagName === 'INPUT' && /^(text|search|url|tel|password|email)$/i.test(active.type)));
      let ok = false;
      if (isTextControl) {
        ok = replaceInInputOrTextarea(active, text);
      }
      if (!ok) ok = replaceInContentEditable(text, html, format);
      sendResponse({ ok });
      return true;
    }
    return undefined;
  });

  document.addEventListener('selectionchange', onSelectionChange, { passive: true });
  document.addEventListener('mouseup', onSelectionChange, { passive: true });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') scheduleHide();
  });
})();
