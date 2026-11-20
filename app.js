(() => {
  'use strict';

  const STORAGE_KEY = 'croquis-rampe-v1';
  const form = document.querySelector('#projectForm');
  const canvas = document.querySelector('#drawingCanvas');
  const canvasWrap = document.querySelector('#canvasWrap');
  const ctx = canvas.getContext('2d');
  const inkCanvas = document.createElement('canvas');
  const inkCtx = inkCanvas.getContext('2d');

  const state = {
    tool: 'pen',
    color: '#14324b',
    width: 4,
    grid: true,
    actions: [],
    redo: [],
    activeAction: null,
    pointerId: null
  };

  let saveTimer = null;
  let deferredInstallPrompt = null;
  let toastTimer = null;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function todayLocal() {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  function normalizePoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  function formData() {
    return Object.fromEntries(new FormData(form).entries());
  }

  function applyFormData(data = {}) {
    [...form.elements].forEach((element) => {
      if (element.name && Object.prototype.hasOwnProperty.call(data, element.name)) {
        element.value = data[element.name] ?? '';
      }
    });
  }

  function serialize() {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      project: formData(),
      drawing: {
        actions: state.actions,
        grid: state.grid,
        color: state.color,
        width: state.width
      }
    };
  }

  function saveNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
      $('#saveStatus').textContent = `Sauvegardé à ${new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
    } catch (error) {
      $('#saveStatus').textContent = 'Sauvegarde impossible';
      showToast('L’espace de sauvegarde de cet appareil est indisponible.');
    }
  }

  function scheduleSave() {
    $('#saveStatus').textContent = 'Sauvegarde…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 350);
  }

  function restore() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      form.elements.date.value = todayLocal();
      return;
    }
    try {
      const saved = JSON.parse(raw);
      applyFormData(saved.project);
      state.actions = Array.isArray(saved.drawing?.actions) ? saved.drawing.actions : [];
      state.grid = saved.drawing?.grid !== false;
      state.color = saved.drawing?.color || state.color;
      state.width = Number(saved.drawing?.width) || state.width;
      $('#gridToggle').checked = state.grid;
      $('#colorPicker').value = state.color;
      $('#lineWidth').value = String(state.width);
      if (!form.elements.date.value) form.elements.date.value = todayLocal();
      $('#saveStatus').textContent = 'Croquis restauré';
    } catch (error) {
      form.elements.date.value = todayLocal();
      showToast('La sauvegarde précédente n’a pas pu être restaurée.');
    }
  }

  function resizeCanvas() {
    const rect = canvasWrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      inkCanvas.width = width;
      inkCanvas.height = height;
      render();
    }
  }

  function drawGrid(target, width, height) {
    target.save();
    target.fillStyle = '#fbfdff';
    target.fillRect(0, 0, width, height);
    if (state.grid) {
      const minor = Math.max(18, Math.round(width / 46));
      target.lineWidth = 1;
      for (let x = 0; x <= width; x += minor) {
        target.strokeStyle = x % (minor * 5) === 0 ? '#cedbe4' : '#e8eef2';
        target.beginPath(); target.moveTo(x + .5, 0); target.lineTo(x + .5, height); target.stroke();
      }
      for (let y = 0; y <= height; y += minor) {
        target.strokeStyle = y % (minor * 5) === 0 ? '#cedbe4' : '#e8eef2';
        target.beginPath(); target.moveTo(0, y + .5); target.lineTo(width, y + .5); target.stroke();
      }
    }
    target.restore();
  }

  function pxPoint(point, width, height) {
    return { x: point.x * width, y: point.y * height };
  }

  function drawAction(target, action, width, height) {
    target.save();
    const scale = Math.min(width, height) / 650;
    const lineWidth = Math.max(1.3, action.width * scale);
    target.lineCap = 'round';
    target.lineJoin = 'round';
    target.strokeStyle = action.color;
    target.fillStyle = action.color;
    target.lineWidth = lineWidth;

    if (action.type === 'stroke' || action.type === 'erase') {
      if (!action.points?.length) { target.restore(); return; }
      if (action.type === 'erase') {
        target.globalCompositeOperation = 'destination-out';
        target.lineWidth = lineWidth * 4;
      }
      const first = pxPoint(action.points[0], width, height);
      target.beginPath(); target.moveTo(first.x, first.y);
      if (action.points.length === 1) target.lineTo(first.x + .01, first.y + .01);
      for (let i = 1; i < action.points.length; i += 1) {
        const p = pxPoint(action.points[i], width, height);
        target.lineTo(p.x, p.y);
      }
      target.stroke();
    } else if (action.type === 'line' || action.type === 'arrow') {
      const start = pxPoint(action.start, width, height);
      const end = pxPoint(action.end, width, height);
      target.beginPath(); target.moveTo(start.x, start.y); target.lineTo(end.x, end.y); target.stroke();
      if (action.type === 'arrow') {
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const head = Math.max(12, lineWidth * 4.2);
        target.beginPath();
        target.moveTo(end.x, end.y);
        target.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
        target.moveTo(end.x, end.y);
        target.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
        target.stroke();
      }
    } else if (action.type === 'text') {
      const point = pxPoint(action.point, width, height);
      const fontSize = Math.max(13, (action.fontSize || 20) * scale);
      target.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
      target.textBaseline = 'top';
      const lines = String(action.text).split('\n');
      lines.forEach((line, index) => target.fillText(line, point.x, point.y + index * fontSize * 1.25));
    }
    target.restore();
  }

  function renderTo(targetCanvas, width = targetCanvas.width, height = targetCanvas.height) {
    const target = targetCanvas.getContext('2d');
    target.clearRect(0, 0, width, height);
    drawGrid(target, width, height);

    const temp = targetCanvas === canvas ? inkCanvas : document.createElement('canvas');
    if (temp.width !== width) temp.width = width;
    if (temp.height !== height) temp.height = height;
    const tempCtx = temp.getContext('2d');
    tempCtx.clearRect(0, 0, width, height);
    [...state.actions, ...(state.activeAction ? [state.activeAction] : [])].forEach((action) => drawAction(tempCtx, action, width, height));
    target.drawImage(temp, 0, 0);
  }

  function render() {
    renderTo(canvas);
    $('#undoButton').disabled = state.actions.length === 0;
    $('#redoButton').disabled = state.redo.length === 0;
  }

  function selectTool(tool) {
    state.tool = tool;
    $$('.tool').forEach((button) => {
      const active = button.dataset.tool === tool;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    canvas.style.cursor = tool === 'text' ? 'text' : 'crosshair';
  }

  function pointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const point = normalizePoint(event);

    if (state.tool === 'text') {
      const text = window.prompt('Texte à ajouter au croquis :');
      if (text?.trim()) {
        state.actions.push({ type: 'text', point, text: text.trim(), color: state.color, width: state.width, fontSize: 22 });
        state.redo = [];
        render();
        scheduleSave();
      }
      return;
    }

    state.pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    if (state.tool === 'pen' || state.tool === 'eraser') {
      state.activeAction = {
        type: state.tool === 'eraser' ? 'erase' : 'stroke',
        points: [point], color: state.color, width: state.width
      };
    } else {
      state.activeAction = { type: state.tool, start: point, end: point, color: state.color, width: state.width };
    }
    render();
  }

  function pointerMove(event) {
    if (state.pointerId !== event.pointerId || !state.activeAction) return;
    event.preventDefault();
    const point = normalizePoint(event);
    if (state.activeAction.type === 'stroke' || state.activeAction.type === 'erase') {
      const previous = state.activeAction.points[state.activeAction.points.length - 1];
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (distance > .0015) state.activeAction.points.push(point);
    } else {
      state.activeAction.end = point;
    }
    render();
  }

  function pointerUp(event) {
    if (state.pointerId !== event.pointerId || !state.activeAction) return;
    event.preventDefault();
    if (state.activeAction.type === 'line' || state.activeAction.type === 'arrow') {
      const length = Math.hypot(state.activeAction.end.x - state.activeAction.start.x, state.activeAction.end.y - state.activeAction.start.y);
      if (length < .005) { state.activeAction = null; state.pointerId = null; render(); return; }
    }
    state.actions.push(state.activeAction);
    state.activeAction = null;
    state.pointerId = null;
    state.redo = [];
    render();
    scheduleSave();
  }

  function undo() {
    if (!state.actions.length) return;
    state.redo.push(state.actions.pop());
    render(); scheduleSave();
  }

  function redo() {
    if (!state.redo.length) return;
    state.actions.push(state.redo.pop());
    render(); scheduleSave();
  }

  function clearDrawing() {
    if (!state.actions.length || !window.confirm('Effacer tout le dessin? Les informations du chantier seront conservées.')) return;
    state.actions = [];
    state.redo = [];
    render(); scheduleSave();
  }

  function newProject() {
    if (!window.confirm('Créer un nouveau croquis? Le croquis actuel et ses informations seront effacés de cet appareil.')) return;
    form.reset();
    form.elements.date.value = todayLocal();
    state.actions = [];
    state.redo = [];
    state.grid = true;
    $('#gridToggle').checked = true;
    localStorage.removeItem(STORAGE_KEY);
    render(); saveNow();
    showToast('Nouveau croquis créé.');
  }

  function displayValue(value) {
    return String(value || '').trim() || '—';
  }

  function formatDate(value) {
    if (!value) return '—';
    const parts = value.split('-').map(Number);
    if (parts.length !== 3) return value;
    return new Intl.DateTimeFormat('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(parts[0], parts[1] - 1, parts[2]));
  }

  function makeExportCanvas() {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = 1600;
    exportCanvas.height = 1100;
    renderTo(exportCanvas);
    return exportCanvas;
  }

  function finalize() {
    const data = formData();
    const mapping = {
      Client: data.client,
      Project: data.project,
      Address: data.address,
      PreparedBy: data.preparedBy,
      Configuration: data.configuration,
      Material: data.material,
      Length: data.length,
      Width: data.width,
      Height: data.height,
      Notes: data.notes
    };
    Object.entries(mapping).forEach(([id, value]) => { $(`#summary${id}`).textContent = displayValue(value); });
    $('#summaryDate').textContent = formatDate(data.date);
    $('#summaryImage').src = makeExportCanvas().toDataURL('image/png');
    saveNow();
    $('#editorView').hidden = true;
    $('#finalView').hidden = false;
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.title = `${displayValue(data.project) === '—' ? 'Croquis de rampe' : data.project} – Croquis de rampe`;
  }

  function backToEditor() {
    $('#finalView').hidden = true;
    $('#editorView').hidden = false;
    document.title = 'Croquis de rampe';
    requestAnimationFrame(resizeCanvas);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function safeFileName() {
    const data = formData();
    const source = data.project || data.client || 'croquis-rampe';
    return source.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'croquis-rampe';
  }

  function downloadImage() {
    const link = document.createElement('a');
    link.download = `${safeFileName()}.png`;
    link.href = makeExportCanvas().toDataURL('image/png');
    link.click();
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function bindEvents() {
    form.addEventListener('input', scheduleSave);
    $$('.tool').forEach((button) => button.addEventListener('click', () => selectTool(button.dataset.tool)));
    $('#colorPicker').addEventListener('input', (event) => { state.color = event.target.value; scheduleSave(); });
    $('#lineWidth').addEventListener('change', (event) => { state.width = Number(event.target.value); scheduleSave(); });
    $('#gridToggle').addEventListener('change', (event) => { state.grid = event.target.checked; render(); scheduleSave(); });
    $('#undoButton').addEventListener('click', undo);
    $('#redoButton').addEventListener('click', redo);
    $('#clearButton').addEventListener('click', clearDrawing);
    $('#newProjectButton').addEventListener('click', newProject);
    $('#finalizeButton').addEventListener('click', finalize);
    $('#backButton').addEventListener('click', backToEditor);
    $('#downloadButton').addEventListener('click', downloadImage);
    $('#printButton').addEventListener('click', () => window.print());
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('beforeunload', saveNow);
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) { event.preventDefault(); redo(); }
    });

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      $('#installButton').hidden = false;
    });
    $('#installButton').addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      $('#installButton').hidden = true;
    });
    window.addEventListener('appinstalled', () => showToast('Application installée.'));
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('./service-worker.js');
    } catch (error) {
      console.warn('Mode hors ligne non disponible', error);
    }
  }

  restore();
  bindEvents();
  selectTool('pen');
  requestAnimationFrame(resizeCanvas);
  registerServiceWorker();
})();
