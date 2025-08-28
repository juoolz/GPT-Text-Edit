// options.js
// Manage API key, model, and up to five saved prompts (name + text)

const apiKeyEl = document.getElementById('apiKey');
const modelEl = document.getElementById('model');
const promptsWrap = document.getElementById('prompts');
const addPromptBtn = document.getElementById('addPromptBtn');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');
const tmpl = document.getElementById('promptRowTmpl');

function showStatus(msg) {
  statusEl.textContent = msg;
  setTimeout(() => (statusEl.textContent = ''), 1500);
}

function buildRow(item = { name: '', text: '' }) {
  const node = tmpl.content.firstElementChild.cloneNode(true);
  const nameEl = node.querySelector('.pname');
  const textEl = node.querySelector('.ptext');
  const remBtn = node.querySelector('.remove');
  nameEl.value = item.name || '';
  textEl.value = item.text || '';
  remBtn.addEventListener('click', () => {
    node.remove();
    enforceLimit();
  });
  return node;
}

function enforceLimit() {
  const rows = promptsWrap.querySelectorAll('.prompt-row');
  addPromptBtn.disabled = rows.length >= 5;
}

async function load() {
  const { apiKey = '', model = 'gpt-4o-mini', prompts = [] } = await chrome.storage.sync.get(['apiKey', 'model', 'prompts']);
  apiKeyEl.value = apiKey;
  // Ensure the saved model is selectable even if not in the default list
  const savedModel = model || 'gpt-4o-mini';
  const hasOption = Array.from(modelEl.options).some(o => o.value === savedModel);
  if (!hasOption) {
    const opt = document.createElement('option');
    opt.value = savedModel;
    opt.textContent = `${savedModel} (saved)`;
    modelEl.appendChild(opt);
  }
  modelEl.value = savedModel;
  promptsWrap.innerHTML = '';
  (Array.isArray(prompts) ? prompts : []).slice(0, 5).forEach((p) => {
    promptsWrap.appendChild(buildRow(p));
  });
  enforceLimit();
}

async function save() {
  const rows = Array.from(promptsWrap.querySelectorAll('.prompt-row'));
  const prompts = rows.map((row) => ({
    name: row.querySelector('.pname').value.trim(),
    text: row.querySelector('.ptext').value.trim()
  })).filter(p => p.name || p.text).slice(0, 5);
  await chrome.storage.sync.set({
    apiKey: apiKeyEl.value.trim(),
    model: modelEl.value.trim() || 'gpt-4o-mini',
    prompts
  });
  showStatus('Saved');
}

addPromptBtn.addEventListener('click', () => {
  if (addPromptBtn.disabled) return;
  promptsWrap.appendChild(buildRow());
  enforceLimit();
});

saveBtn.addEventListener('click', save);

load();
