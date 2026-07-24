/**
 * StudyNotes AI v2 — no API keys, photo OCR, export, history
 */

const API_BASE = '';
const HISTORY_KEY = 'studynotes_history_v2';

const elements = {
  html: document.documentElement,
  sidebar: document.getElementById('sidebar'),
  sidebarOverlay: document.getElementById('sidebarOverlay'),
  sidebarClose: document.getElementById('sidebarClose'),
  menuBtn: document.getElementById('menuBtn'),
  themeToggle: document.getElementById('themeToggle'),
  newChatBtn: document.getElementById('newChatBtn'),
  chatContainer: document.getElementById('chatContainer'),
  messages: document.getElementById('messages'),
  welcomeMessage: document.getElementById('welcomeMessage'),
  notesForm: document.getElementById('notesForm'),
  notesInput: document.getElementById('notesInput'),
  sendBtn: document.getElementById('sendBtn'),
  depthSelect: document.getElementById('depthSelect'),
  ollamaToggle: document.getElementById('ollamaToggle'),
  flashcardBtn: document.getElementById('flashcardBtn'),
  imageInput: document.getElementById('imageInput'),
  scanBtn: document.getElementById('scanBtn'),
  imagePreview: document.getElementById('imagePreview'),
  previewImg: document.getElementById('previewImg'),
  ocrStatus: document.getElementById('ocrStatus'),
  clearImageBtn: document.getElementById('clearImageBtn'),
  historyList: document.getElementById('historyList'),
  providerStatus: document.getElementById('providerStatus'),
  toast: document.getElementById('toast'),
};

const state = {
  isGenerating: false,
  abortController: null,
  imageFile: null,
  lastAssistantMarkdown: '',
  flashcardMode: false,
};

function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) elements.html.setAttribute('data-theme', saved);
  else if (window.matchMedia('(prefers-color-scheme: light)').matches) elements.html.setAttribute('data-theme', 'light');
}

function toggleTheme() {
  const next = elements.html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  elements.html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

function openSidebar() {
  elements.sidebar.classList.add('open');
  elements.sidebarOverlay.classList.add('active');
}

function closeSidebar() {
  elements.sidebar.classList.remove('open');
  elements.sidebarOverlay.classList.remove('active');
}

function showToast(msg) {
  elements.toast.textContent = msg;
  elements.toast.classList.remove('hidden');
  setTimeout(() => elements.toast.classList.add('hidden'), 2800);
}

function autoResizeTextarea() {
  const t = elements.notesInput;
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 220) + 'px';
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function parseMarkdown(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^## (.+)$/gm, '<h2 class="section-head">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  html = html
    .split(/\n\n+/)
    .map((block) => {
      block = block.trim();
      if (!block) return '';
      if (/^<(h2|ul|ol|hr)/.test(block)) return block;
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
  return html;
}

function createUserMessage(text, imageUrl) {
  const el = document.createElement('div');
  el.className = 'message message-user';
  let body = escapeHtml(text);
  if (imageUrl) {
    body = `<img class="user-note-image" src="${imageUrl}" alt="Uploaded notes" />` + (text ? `<p>${escapeHtml(text)}</p>` : '');
  }
  el.innerHTML = `<div class="avatar avatar-user">You</div><div class="message-content">${body}</div>`;
  return el;
}

function createAssistantMessage() {
  const message = document.createElement('div');
  message.className = 'message message-assistant';
  message.innerHTML = `
    <div class="avatar avatar-assistant">AI</div>
    <div class="message-content markdown-content">
      <div class="loading-dots"><span></span><span></span><span></span></div>
    </div>
    <div class="message-actions hidden">
      <button type="button" class="action-btn copy-btn">Copy all</button>
      <button type="button" class="action-btn export-btn">Export .md</button>
    </div>`;
  const contentEl = message.querySelector('.message-content');
  const actions = message.querySelector('.message-actions');
  message.querySelector('.copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(state.lastAssistantMarkdown).then(() => showToast('Copied to clipboard'));
  });
  message.querySelector('.export-btn').addEventListener('click', () => {
    const blob = new Blob([state.lastAssistantMarkdown], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `study-notes-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  return { message, contentEl, actions };
}

function createErrorMessage(errorText) {
  const el = document.createElement('div');
  el.className = 'message message-error';
  el.innerHTML = `<div class="avatar avatar-assistant">!</div><div class="message-content"><strong>Error:</strong> ${escapeHtml(errorText)}</div>`;
  return el;
}

function scrollToBottom(smooth = true) {
  elements.chatContainer.scrollTo({ top: elements.chatContainer.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function setGeneratingState(on) {
  elements.sendBtn.disabled = on;
  elements.sendBtn.classList.toggle('loading', on);
  elements.notesInput.disabled = on;
  elements.scanBtn.disabled = on || !state.imageFile;
}

function saveHistory(title, preview) {
  const items = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  items.unshift({ id: Date.now(), title, preview, at: new Date().toISOString() });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 12)));
  renderHistory();
}

function renderHistory() {
  const items = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  if (!items.length) {
    elements.historyList.innerHTML = '<li class="history-empty">No history yet</li>';
    return;
  }
  elements.historyList.innerHTML = items
    .map((it) => `<li><button type="button" data-id="${it.id}" class="history-item">${escapeHtml(it.title)}<small>${escapeHtml(it.preview.slice(0, 60))}…</small></button></li>`)
    .join('');
  elements.historyList.querySelectorAll('.history-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = items.find((x) => String(x.id) === btn.dataset.id);
      if (item) {
        elements.notesInput.value = item.preview;
        autoResizeTextarea();
        showToast('Loaded from history');
        closeSidebar();
      }
    });
  });
}

async function fetchHealth() {
  try {
    const r = await fetch(`${API_BASE}/api/health`);
    const data = await r.json();
    if (data.ollama_available) {
      elements.providerStatus.textContent = 'Local engine + Ollama ready';
      elements.ollamaToggle.disabled = false;
    } else {
      elements.providerStatus.textContent = 'Local engine (no API keys)';
      elements.ollamaToggle.checked = false;
    }
  } catch {
    elements.providerStatus.textContent = 'Backend offline';
  }
}

function setImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  state.imageFile = file;
  const url = URL.createObjectURL(file);
  elements.previewImg.src = url;
  elements.imagePreview.classList.remove('hidden');
  elements.scanBtn.disabled = false;
  elements.ocrStatus.textContent = 'Tap “Scan photo” to extract text';
}

function clearImage() {
  state.imageFile = null;
  elements.imageInput.value = '';
  elements.imagePreview.classList.add('hidden');
  elements.previewImg.src = '';
  elements.scanBtn.disabled = true;
  elements.ocrStatus.textContent = 'Ready to scan';
}

async function scanImageOCR() {
  if (!state.imageFile || typeof Tesseract === 'undefined') {
    showToast('OCR library still loading — wait a moment');
    return;
  }
  elements.scanBtn.disabled = true;
  elements.ocrStatus.textContent = 'Scanning text…';
  try {
    const { data } = await Tesseract.recognize(state.imageFile, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          elements.ocrStatus.textContent = `Scanning… ${Math.round((m.progress || 0) * 100)}%`;
        }
      },
    });
    const text = (data.text || '').trim();
    if (text.length < 5) {
      showToast('Could not read much text — try a clearer photo');
      elements.ocrStatus.textContent = 'Low text detected';
    } else {
      elements.notesInput.value = text;
      autoResizeTextarea();
      elements.ocrStatus.textContent = `Extracted ${text.length} characters`;
      showToast('Text extracted from photo');
    }
  } catch (e) {
    showToast('OCR failed: ' + e.message);
    elements.ocrStatus.textContent = 'Scan failed';
  } finally {
    elements.scanBtn.disabled = !state.imageFile;
  }
}

async function generateStudyNotes(notes, options = {}) {
  if (state.isGenerating) return;
  const trimmed = notes.trim();
  if (trimmed.length < 10) {
    showToast('Need at least 10 characters of notes');
    return;
  }

  state.isGenerating = true;
  state.abortController = new AbortController();
  setGeneratingState(true);
  elements.welcomeMessage?.classList.add('hidden');

  const imageUrl = options.imagePreviewUrl || null;
  elements.messages.appendChild(createUserMessage(trimmed.slice(0, 2000) + (trimmed.length > 2000 ? '…' : ''), imageUrl));
  scrollToBottom();

  const { message: assistantMessage, contentEl, actions } = createAssistantMessage();
  elements.messages.appendChild(assistantMessage);
  scrollToBottom();

  let fullContent = '';
  let hasStarted = false;

  try {
    const response = await fetch(`${API_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes: trimmed,
        depth: elements.depthSelect.value,
        prefer_ollama: elements.ollamaToggle.checked,
      }),
      signal: state.abortController.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `Request failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = 'message';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim();
        else if (line.startsWith('data:')) {
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;
          const data = JSON.parse(dataStr);
          if (eventType === 'delta' && data.content) {
            if (!hasStarted) {
              hasStarted = true;
              contentEl.innerHTML = '';
            }
            fullContent += data.content;
            contentEl.innerHTML = parseMarkdown(fullContent) + '<span class="typing-cursor"></span>';
            scrollToBottom(false);
          } else if (eventType === 'error') throw new Error(data.error || 'Stream error');
          else if (eventType === 'done') {
            contentEl.innerHTML = parseMarkdown(fullContent);
          }
          eventType = 'message';
        }
      }
    }

    state.lastAssistantMarkdown = fullContent;
    contentEl.innerHTML = parseMarkdown(fullContent);
    actions.classList.remove('hidden');
    elements.flashcardBtn.disabled = false;

    saveHistory(trimmed.slice(0, 40) + (trimmed.length > 40 ? '…' : ''), trimmed);
  } catch (err) {
    if (err.name === 'AbortError') contentEl.innerHTML = '<p><em>Cancelled.</em></p>';
    else {
      assistantMessage.remove();
      elements.messages.appendChild(createErrorMessage(err.message));
    }
  } finally {
    state.isGenerating = false;
    state.abortController = null;
    setGeneratingState(false);
    scrollToBottom();
  }
}

function toggleFlashcardMode() {
  state.flashcardMode = !state.flashcardMode;
  elements.flashcardBtn.classList.toggle('active', state.flashcardMode);
  document.querySelectorAll('.markdown-content h2').forEach((h) => {
    h.classList.toggle('flashcard-hidden', state.flashcardMode && h.textContent.includes('Answer'));
  });
  showToast(state.flashcardMode ? 'Flashcard mode: hide answers in quiz section manually while studying' : 'Flashcard mode off');
}

function resetChat() {
  if (state.abortController) state.abortController.abort();
  elements.messages.innerHTML = '';
  if (elements.welcomeMessage) {
    elements.welcomeMessage.classList.remove('hidden');
    elements.messages.appendChild(elements.welcomeMessage);
  }
  elements.notesInput.value = '';
  clearImage();
  autoResizeTextarea();
  state.lastAssistantMarkdown = '';
  elements.flashcardBtn.disabled = true;
  closeSidebar();
}

function initEventListeners() {
  elements.themeToggle.addEventListener('click', toggleTheme);
  elements.menuBtn.addEventListener('click', openSidebar);
  elements.sidebarClose.addEventListener('click', closeSidebar);
  elements.sidebarOverlay.addEventListener('click', closeSidebar);
  elements.newChatBtn.addEventListener('click', resetChat);
  elements.flashcardBtn.addEventListener('click', toggleFlashcardMode);
  elements.scanBtn.addEventListener('click', scanImageOCR);
  elements.clearImageBtn.addEventListener('click', clearImage);

  elements.imageInput.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) setImageFile(f);
  });

  elements.notesForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const notesCopy = elements.notesInput.value;
    const preview = state.imageFile ? URL.createObjectURL(state.imageFile) : null;
    elements.notesInput.value = '';
    autoResizeTextarea();
    generateStudyNotes(notesCopy, { imagePreviewUrl: preview });
    clearImage();
  });

  elements.notesInput.addEventListener('input', autoResizeTextarea);
  elements.notesInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      elements.notesForm.dispatchEvent(new Event('submit'));
    }
  });

  document.body.addEventListener('dragover', (e) => e.preventDefault());
  document.body.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) setImageFile(f);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initEventListeners();
  renderHistory();
  fetchHealth();
  autoResizeTextarea();
});
