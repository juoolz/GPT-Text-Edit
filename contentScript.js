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

  function replaceInContentEditable(text) {
    const sel = window.getSelection();
    let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if ((!range || sel.isCollapsed) && lastRange) {
      // Try to restore last known range
      sel.removeAllRanges();
      sel.addRange(lastRange);
      range = sel.getRangeAt(0);
    }
    if (!range) return false;
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    // Move caret after inserted text
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
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
      // Try input/textarea first if focused
      const active = document.activeElement;
      const isTextControl = active && (active.tagName === 'TEXTAREA' ||
        (active.tagName === 'INPUT' && /^(text|search|url|tel|password|email)$/i.test(active.type)));
      let ok = false;
      if (isTextControl) {
        ok = replaceInInputOrTextarea(active, text);
      }
      if (!ok) ok = replaceInContentEditable(text);
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

