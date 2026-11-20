(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const storage = window.CroquisStorage;
  const canvas = $('#drawingCanvas');
  const ctx = canvas.getContext('2d', { alpha: true });
  const FORM_IDS = ['title', 'client', 'projectDate', 'jobsite', 'address', 'section', 'railingColor', 'material', 'configuration', 'notes'];

  const state = {
    currentId: null,
    createdAt: null,
    revision: 0,
    tool: 'pen',
    actions: [],
    redo: [],
    drawing: false,
    preview: null,
    dirty: false,
    grid: true,
    autoSaveTimer: null,
    savedCount: 0,
    draftRestored: false,
    pendingTextPoint: null
  };

  function todayLocal() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function escapeFileName(value) {
    return (value || 'croquis-rampe').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'croquis-rampe';
  }

  function formatDateTime(value) {
    if (!value) return '—';
    try { return new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
    catch { return value; }
  }

  function formatProjectDate(value) {
    if (!value) return '—';
    try { return new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)); }
    catch { return value; }
  }

  function showToast(message, type = '') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`.trim();
    toast.textContent = message;
    $('#toastRegion').append(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  function setSaveStatus(text, status = 'neutral') {
    $('#saveStatus').textContent = text;
    const indicator = $('#storageIndicator');
    indicator.classList.toggle('warning', status === 'warning');
  }

  function getFormData() {
    const form = {};
    FORM_IDS.forEach(id => { form[id] = $(`#${id}`).value; });
    return form;
  }

  function setFormData(form = {}) {
    FORM_IDS.forEach(id => {
      const element = $(`#${id}`);
      element.value = form[id] ?? (id === 'projectDate' ? todayLocal() : id === 'material' ? 'Aluminium' : '');
    });
  }

  function getMeasurements() {
    return $$('.measurement-row').map(row => ({
      label: row.querySelector('[data-measure-label]').value.trim(),
      value: row.querySelector('[data-measure-value]').value.trim()
    })).filter(item => item.label || item.value);
  }

  function addMeasurement(measurement = { label: '', value: '' }, silent = false) {
    const row = document.createElement('div');
    row.className = 'measurement-row';
    const label = document.createElement('input');
    label.type = 'text'; label.placeholder = 'Mesure'; label.dataset.measureLabel = ''; label.value = measurement.label || '';
    label.setAttribute('aria-label', 'Nom de la mesure');
    const value = document.createElement('input');
    value.type = 'text'; value.placeholder = 'Ex. 96 po'; value.dataset.measureValue = ''; value.value = measurement.value || '';
    value.setAttribute('aria-label', 'Valeur de la mesure');
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'remove-measurement'; remove.textContent = '×'; remove.title = 'Supprimer cette mesure';
    remove.addEventListener('click', () => { row.remove(); markDirty(); });
    [label, value].forEach(input => input.addEventListener('input', markDirty));
    row.append(label, value, remove);
    $('#measurements').append(row);
    if (!silent) { label.focus(); markDirty(); }
  }

  function setMeasurements(items = []) {
    $('#measurements').replaceChildren();
    const rows = items.length ? items : [
      { label: 'Longueur', value: '' },
      { label: 'Hauteur', value: '' },
      { label: 'Espacement poteaux', value: '' }
    ];
    rows.forEach(item => addMeasurement(item, true));
  }

  function collectData() {
    return {
      form: getFormData(),
      measurements: getMeasurements(),
      drawing: {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        grid: state.grid,
        actions: clone(state.actions)
      },
      app: {
        schemaVersion: window.CROQUIS_SCHEMA_VERSION,
        lastEditedAt: new Date().toISOString()
      }
    };
  }

  function applyData(data = {}) {
    setFormData(data.form || {});
    setMeasurements(data.measurements || []);
    state.actions = clone(data.drawing?.actions || []);
    state.redo = [];
    state.grid = data.drawing?.grid !== false;
    $('#gridToggle').checked = state.grid;
    $('#canvasFrame').classList.toggle('grid-visible', state.grid);
    renderCanvas();
    updateUndoRedo();
  }

  function makeDraft() {
    return {
      schemaVersion: window.CROQUIS_SCHEMA_VERSION,
      currentId: state.currentId,
      createdAt: state.createdAt,
      revision: state.revision,
      dirty: state.dirty,
      data: collectData()
    };
  }

  function markDirty() {
    state.dirty = true;
    setSaveStatus(state.currentId ? 'Modifications en attente…' : 'Brouillon automatique…');
    updateCurrentLabel();
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(autoSave, 850);
  }

  async function autoSave() {
    const draft = makeDraft();
    const draftSaved = storage.saveDraft(draft);
    if (!draftSaved) {
      setSaveStatus('Espace local insuffisant', 'warning');
      return;
    }
    if (state.currentId && $('#title').value.trim()) {
      try {
        await persistCurrent(false, true);
        state.dirty = false;
        setSaveStatus(`Sauvegarde auto • ${new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}`);
      } catch (error) {
        console.error(error);
        setSaveStatus('Sauvegarde automatique impossible', 'warning');
      }
    } else {
      setSaveStatus('Brouillon conservé sur cet appareil');
    }
  }

  function updateCurrentLabel() {
    const title = $('#title').value.trim() || 'Nouveau croquis';
    $('#currentSketchLabel').textContent = `${title}${state.dirty ? ' •' : ''}`;
  }

  async function persistCurrent(notify = true, automatic = false) {
    const title = $('#title').value.trim();
    if (!title) throw new Error('Donnez un nom au croquis.');
    const now = new Date().toISOString();
    const id = state.currentId || storage.makeId();
    const data = collectData();
    const record = {
      id,
      title,
      client: data.form.client,
      jobsite: data.form.jobsite,
      section: data.form.section,
      projectDate: data.form.projectDate,
      thumbnail: createExportCanvas({ width: 240, height: 152, grid: false }).toDataURL('image/jpeg', .72),
      createdAt: state.createdAt || now,
      updatedAt: now,
      revision: state.currentId ? state.revision + 1 : 1,
      data,
      sync: { state: 'local-only', localRevision: state.currentId ? state.revision + 1 : 1, sharePointItemId: null, lastSyncedAt: null }
    };
    const saved = await storage.put(record);
    state.currentId = saved.id;
    state.createdAt = saved.createdAt;
    state.revision = saved.revision;
    state.dirty = false;
    storage.saveDraft(makeDraft());
    updateCurrentLabel();
    await refreshCount();
    if (notify && !automatic) showToast('Croquis enregistré sur cet appareil.', 'success');
    return saved;
  }

  function openSaveDialog() {
    const suggested = $('#title').value.trim() || [$('#client').value.trim(), $('#section').value.trim()].filter(Boolean).join(' — ') || 'Nouveau croquis';
    $('#saveTitle').value = suggested;
    $('#saveDialog').showModal();
    requestAnimationFrame(() => { $('#saveTitle').focus(); $('#saveTitle').select(); });
  }

  async function requestSave() {
    if (!$('#title').value.trim()) { openSaveDialog(); return; }
    try { await persistCurrent(true); }
    catch (error) { showToast(error.message || 'Impossible d’enregistrer le croquis.', 'error'); }
  }

  function resetSketch(force = false) {
    if (!force && state.dirty && !confirm('Créer un nouveau croquis? Le brouillon actuel sera remplacé.')) return;
    state.currentId = null;
    state.createdAt = null;
    state.revision = 0;
    state.actions = [];
    state.redo = [];
    state.dirty = false;
    state.grid = true;
    setFormData({ projectDate: todayLocal(), material: 'Aluminium' });
    setMeasurements();
    $('#gridToggle').checked = true;
    $('#canvasFrame').classList.add('grid-visible');
    renderCanvas();
    updateUndoRedo();
    storage.clearDraft();
    storage.saveDraft(makeDraft());
    updateCurrentLabel();
    setSaveStatus('Nouveau brouillon local');
    showEditView();
  }

  function pointerPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height))
    };
  }

  function drawingStyle() {
    return { color: $('#strokeColor').value, width: Number($('#strokeWidth').value) };
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    const point = pointerPoint(event);
    if (state.tool === 'text') {
      state.pendingTextPoint = point;
      $('#canvasText').value = '';
      $('#textDialog').showModal();
      requestAnimationFrame(() => $('#canvasText').focus());
      return;
    }
    state.drawing = true;
    const style = drawingStyle();
    state.preview = state.tool === 'pen' || state.tool === 'eraser'
      ? { type: state.tool, points: [point], ...style }
      : { type: state.tool, start: point, end: point, ...style };
    renderCanvas();
  }

  function onPointerMove(event) {
    if (!state.drawing || !state.preview) return;
    event.preventDefault();
    const point = pointerPoint(event);
    if (state.preview.points) {
      const previous = state.preview.points[state.preview.points.length - 1];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) > 1.5) state.preview.points.push(point);
    } else state.preview.end = point;
    renderCanvas();
  }

  function onPointerUp(event) {
    if (!state.drawing || !state.preview) return;
    event.preventDefault();
    const action = state.preview;
    state.drawing = false;
    state.preview = null;
    const meaningful = action.points ? action.points.length > 1 : Math.hypot(action.end.x - action.start.x, action.end.y - action.start.y) > 3;
    if (meaningful) {
      state.actions.push(action);
      state.redo = [];
      markDirty();
    }
    renderCanvas();
    updateUndoRedo();
  }

  function drawAction(target, action, scaleX = 1, scaleY = 1) {
    target.save();
    target.lineCap = 'round';
    target.lineJoin = 'round';
    target.strokeStyle = action.color || '#12344d';
    target.fillStyle = action.color || '#12344d';
    target.lineWidth = Math.max(1, (action.width || 4) * Math.min(scaleX, scaleY));
    if (action.type === 'eraser') target.globalCompositeOperation = 'destination-out';

    if (action.type === 'pen' || action.type === 'eraser') {
      const points = action.points || [];
      if (points.length) {
        target.beginPath();
        target.moveTo(points[0].x * scaleX, points[0].y * scaleY);
        for (let i = 1; i < points.length; i++) target.lineTo(points[i].x * scaleX, points[i].y * scaleY);
        target.stroke();
      }
    } else if (action.type === 'line' || action.type === 'arrow') {
      const sx = action.start.x * scaleX, sy = action.start.y * scaleY;
      const ex = action.end.x * scaleX, ey = action.end.y * scaleY;
      target.beginPath(); target.moveTo(sx, sy); target.lineTo(ex, ey); target.stroke();
      if (action.type === 'arrow') {
        const angle = Math.atan2(ey - sy, ex - sx);
        const head = Math.max(12, 18 * Math.min(scaleX, scaleY) + target.lineWidth);
        target.beginPath();
        target.moveTo(ex, ey);
        target.lineTo(ex - head * Math.cos(angle - Math.PI / 6), ey - head * Math.sin(angle - Math.PI / 6));
        target.moveTo(ex, ey);
        target.lineTo(ex - head * Math.cos(angle + Math.PI / 6), ey - head * Math.sin(angle + Math.PI / 6));
        target.stroke();
      }
    } else if (action.type === 'text') {
      target.globalCompositeOperation = 'source-over';
      const fontSize = (action.fontSize || 28) * Math.min(scaleX, scaleY);
      target.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
      target.textBaseline = 'top';
      target.fillText(action.text || '', action.point.x * scaleX, action.point.y * scaleY);
    }
    target.restore();
  }

  function renderCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    [...state.actions, ...(state.preview ? [state.preview] : [])].forEach(action => drawAction(ctx, action));
    $('#canvasFrame').classList.toggle('has-drawing', state.actions.length > 0 || !!state.preview);
  }

  function drawGrid(target, width, height) {
    target.save();
    target.strokeStyle = 'rgba(60, 125, 154, .12)';
    target.lineWidth = 1;
    const minor = width / 60;
    for (let x = 0; x <= width; x += minor) { target.beginPath(); target.moveTo(x, 0); target.lineTo(x, height); target.stroke(); }
    for (let y = 0; y <= height; y += minor) { target.beginPath(); target.moveTo(0, y); target.lineTo(width, y); target.stroke(); }
    target.strokeStyle = 'rgba(60, 125, 154, .18)';
    const major = minor * 4;
    for (let x = 0; x <= width; x += major) { target.beginPath(); target.moveTo(x, 0); target.lineTo(x, height); target.stroke(); }
    for (let y = 0; y <= height; y += major) { target.beginPath(); target.moveTo(0, y); target.lineTo(width, y); target.stroke(); }
    target.restore();
  }

  function createExportCanvas(options = {}) {
    const output = document.createElement('canvas');
    output.width = options.width || canvas.width;
    output.height = options.height || canvas.height;
    const out = output.getContext('2d');
    out.fillStyle = '#fff'; out.fillRect(0, 0, output.width, output.height);
    if (options.grid ?? state.grid) drawGrid(out, output.width, output.height);
    const scaleX = output.width / canvas.width, scaleY = output.height / canvas.height;
    const layer = document.createElement('canvas');
    layer.width = output.width;
    layer.height = output.height;
    const layerContext = layer.getContext('2d');
    state.actions.forEach(action => drawAction(layerContext, action, scaleX, scaleY));
    out.drawImage(layer, 0, 0);
    return output;
  }

  function updateUndoRedo() {
    $('#undoBtn').disabled = state.actions.length === 0;
    $('#redoBtn').disabled = state.redo.length === 0;
  }

  function undo() {
    const action = state.actions.pop();
    if (!action) return;
    state.redo.push(action); renderCanvas(); updateUndoRedo(); markDirty();
  }

  function redo() {
    const action = state.redo.pop();
    if (!action) return;
    state.actions.push(action); renderCanvas(); updateUndoRedo(); markDirty();
  }

  function clearDrawing() {
    if (!state.actions.length || !confirm('Effacer tout le dessin? Les informations du chantier seront conservées.')) return;
    state.actions = []; state.redo = []; renderCanvas(); updateUndoRedo(); markDirty();
  }

  function setTool(tool) {
    state.tool = tool;
    $$('.tool').forEach(button => {
      const active = button.dataset.tool === tool;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    canvas.style.cursor = tool === 'text' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair';
  }

  function addFinalCell(container, label, value) {
    if (!value) return;
    const cell = document.createElement('div'); cell.className = 'detail-cell';
    const caption = document.createElement('span'); caption.textContent = label;
    const content = document.createElement('strong'); content.textContent = value;
    cell.append(caption, content); container.append(cell);
  }

  function buildFinalView() {
    const data = collectData();
    $('#finalTitle').textContent = data.form.title || 'Croquis de rampe';
    $('#finalDate').textContent = formatProjectDate(data.form.projectDate);
    const details = $('#finalDetails'); details.replaceChildren();
    addFinalCell(details, 'Client', data.form.client);
    addFinalCell(details, 'Chantier', data.form.jobsite);
    addFinalCell(details, 'Adresse', data.form.address);
    addFinalCell(details, 'Section', data.form.section);
    addFinalCell(details, 'Couleur', data.form.railingColor);
    addFinalCell(details, 'Matériau', data.form.material);
    addFinalCell(details, 'Configuration', data.form.configuration);
    $('#finalImage').src = createExportCanvas({ grid: state.grid }).toDataURL('image/png');
    const measures = $('#finalMeasurements'); measures.replaceChildren();
    data.measurements.forEach(item => {
      const chip = document.createElement('div'); chip.className = 'measure-chip';
      const strong = document.createElement('strong'); strong.textContent = item.label || 'Mesure';
      chip.append(strong, document.createTextNode(` : ${item.value || '—'}`)); measures.append(chip);
    });
    const notes = $('#finalNotes');
    notes.textContent = data.form.notes ? `Notes : ${data.form.notes}` : '';
    notes.hidden = !data.form.notes;
  }

  function showFinalView() {
    buildFinalView();
    $('#editView').hidden = true; $('#finalView').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showEditView() {
    $('#finalView').hidden = true; $('#editView').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadPng() {
    createExportCanvas({ grid: state.grid }).toBlob(blob => {
      if (blob) downloadBlob(blob, `${escapeFileName($('#title').value)}.png`);
    }, 'image/png');
  }

  async function refreshCount() {
    try {
      const items = await storage.list();
      state.savedCount = items.length;
      $('#sketchCount').textContent = items.length;
    } catch (error) { console.error(error); }
  }

  function makeLibraryCard(item) {
    const card = document.createElement('article'); card.className = 'sketch-card'; card.dataset.id = item.id;
    const image = document.createElement('img'); image.className = 'sketch-thumbnail'; image.alt = ''; image.src = item.thumbnail || 'icons/placeholder.svg';
    const info = document.createElement('div'); info.className = 'sketch-info';
    const title = document.createElement('h3'); title.textContent = item.title;
    const meta = document.createElement('div'); meta.className = 'sketch-meta';
    [item.client, item.jobsite, item.section, `Modifié ${formatDateTime(item.updatedAt)}`].filter(Boolean).forEach(text => { const span = document.createElement('span'); span.textContent = text; meta.append(span); });
    info.append(title, meta);
    const actions = document.createElement('div'); actions.className = 'sketch-actions';
    [['Ouvrir', 'open'], ['Dupliquer', 'duplicate'], ['Supprimer', 'delete']].forEach(([label, action]) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = `card-button ${action}`; button.dataset.action = action; button.textContent = label; actions.append(button);
    });
    card.append(image, info, actions); return card;
  }

  async function renderLibrary() {
    let items = await storage.list();
    const query = $('#librarySearch').value.trim().toLocaleLowerCase('fr-CA');
    if (query) items = items.filter(item => [item.title, item.client, item.jobsite, item.section, item.data?.form?.address].join(' ').toLocaleLowerCase('fr-CA').includes(query));
    const sort = $('#librarySort').value;
    items.sort((a, b) => sort === 'title-asc' ? a.title.localeCompare(b.title, 'fr-CA') : sort === 'updated-asc' ? new Date(a.updatedAt) - new Date(b.updatedAt) : new Date(b.updatedAt) - new Date(a.updatedAt));
    $('#libraryList').replaceChildren(...items.map(makeLibraryCard));
    $('#libraryList').hidden = items.length === 0;
    $('#emptyLibrary').hidden = items.length !== 0;
    const estimate = await storage.getEstimate();
    if (estimate?.quota) {
      const used = estimate.usage || 0;
      $('#libraryStorageNote').textContent = `${(used / 1024 / 1024).toFixed(1)} Mo utilisés localement`;
    }
  }

  async function openLibrary() {
    await renderLibrary();
    $('#libraryDialog').showModal();
  }

  async function loadSketch(id) {
    const item = await storage.get(id);
    if (!item) throw new Error('Croquis introuvable.');
    state.currentId = item.id;
    state.createdAt = item.createdAt;
    state.revision = item.revision || 1;
    state.dirty = false;
    applyData(item.data);
    storage.saveDraft(makeDraft());
    updateCurrentLabel();
    setSaveStatus(`Ouvert • ${formatDateTime(item.updatedAt)}`);
    $('#libraryDialog').close();
    showEditView();
    showToast(`« ${item.title} » est ouvert.`, 'success');
  }

  async function duplicateSketch(id) {
    const original = await storage.get(id);
    if (!original) return;
    const now = new Date().toISOString();
    const copy = clone(original);
    copy.id = storage.makeId(); copy.title = `${original.title} — copie`; copy.createdAt = now; copy.updatedAt = now; copy.revision = 1;
    copy.sync = { state: 'local-only', localRevision: 1, sharePointItemId: null, lastSyncedAt: null };
    await storage.put(copy);
    await refreshCount(); await renderLibrary();
    showToast('Copie créée.', 'success');
  }

  async function deleteSketch(id) {
    const item = await storage.get(id);
    if (!item || !confirm(`Supprimer définitivement « ${item.title} » de cet appareil?`)) return;
    await storage.delete(id);
    if (state.currentId === id) {
      state.currentId = null; state.createdAt = null; state.revision = 0; state.dirty = true;
      storage.saveDraft(makeDraft()); updateCurrentLabel();
    }
    await refreshCount(); await renderLibrary();
    showToast('Croquis supprimé.', 'success');
  }

  async function exportBackup() {
    const payload = await storage.exportBackup();
    const text = JSON.stringify(payload, null, 2);
    downloadBlob(new Blob([text], { type: 'application/json' }), `sauvegarde-croquis-rampe-${todayLocal()}.json`);
    showToast(`${payload.count} croquis exporté${payload.count === 1 ? '' : 's'}.`, 'success');
  }

  async function importBackupFile(file) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const report = await storage.importBackup(payload);
      await refreshCount(); await renderLibrary();
      showToast(`Import terminé : ${report.added} ajouté(s), ${report.updated} mis à jour, ${report.skipped} ignoré(s).`, 'success');
    } catch (error) { showToast(error.message || 'Import impossible.', 'error'); }
    $('#importBackupInput').value = '';
  }

  async function restoreDraft() {
    const draft = storage.loadDraft();
    if (!draft?.data) { resetSketch(true); return; }
    state.currentId = draft.currentId || null;
    state.createdAt = draft.createdAt || null;
    state.revision = Number(draft.revision) || 0;
    state.dirty = !!draft.dirty;
    applyData(draft.data);
    state.draftRestored = true;
    updateCurrentLabel();
    setSaveStatus(state.dirty ? 'Brouillon restauré automatiquement' : 'Dernier croquis restauré');
  }

  async function initializeStorageStatus() {
    await storage.ready;
    const persistedBefore = await storage.isPersisted();
    const persisted = persistedBefore || await storage.requestPersistence();
    const indicator = $('#storageIndicator');
    if (storage.mode === 'localstorage') {
      indicator.innerHTML = '<span class="status-dot"></span> Mode local compatible';
      indicator.classList.add('warning');
    } else {
      indicator.innerHTML = `<span class="status-dot"></span> Stockage local ${persisted ? 'durable' : 'actif'}`;
    }
  }

  function bindEvents() {
    FORM_IDS.forEach(id => $(`#${id}`).addEventListener('input', markDirty));
    $('#title').addEventListener('input', updateCurrentLabel);
    $('#addMeasurementBtn').addEventListener('click', () => addMeasurement());
    $('#newBtn').addEventListener('click', () => resetSketch());
    $('#saveBtn').addEventListener('click', requestSave);
    $('#finalSaveBtn').addEventListener('click', requestSave);
    $('#libraryBtn').addEventListener('click', openLibrary);
    $('#undoBtn').addEventListener('click', undo);
    $('#redoBtn').addEventListener('click', redo);
    $('#clearBtn').addEventListener('click', clearDrawing);
    $$('.tool').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
    $('#strokeWidth').addEventListener('input', () => { $('#strokeWidthOutput').value = $('#strokeWidth').value; });
    $('#gridToggle').addEventListener('change', event => { state.grid = event.target.checked; $('#canvasFrame').classList.toggle('grid-visible', state.grid); markDirty(); });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    $('#downloadPngBtn').addEventListener('click', downloadPng);
    $('#printBtn').addEventListener('click', () => { buildFinalView(); window.print(); });
    $('#finalPrintBtn').addEventListener('click', () => window.print());
    $('#finalizeBtn').addEventListener('click', showFinalView);
    $('#backToEditBtn').addEventListener('click', showEditView);

    $('#saveForm').addEventListener('submit', async event => {
      event.preventDefault();
      const title = $('#saveTitle').value.trim();
      if (!title) { $('#saveTitle').reportValidity(); return; }
      $('#title').value = title;
      $('#saveDialog').close();
      try { await persistCurrent(true); }
      catch (error) { showToast(error.message || 'Sauvegarde impossible.', 'error'); }
    });
    $('#cancelSaveTop').addEventListener('click', () => $('#saveDialog').close());
    $('#cancelSaveBtn').addEventListener('click', () => $('#saveDialog').close());

    $('#textForm').addEventListener('submit', event => {
      event.preventDefault();
      const text = $('#canvasText').value.trim();
      if (!text || !state.pendingTextPoint) return;
      const style = drawingStyle();
      state.actions.push({ type: 'text', text, point: state.pendingTextPoint, fontSize: Math.max(22, style.width * 6), ...style });
      state.redo = []; state.pendingTextPoint = null;
      $('#textDialog').close(); renderCanvas(); updateUndoRedo(); markDirty();
    });
    $('#cancelTextTop').addEventListener('click', () => $('#textDialog').close());
    $('#cancelTextBtn').addEventListener('click', () => $('#textDialog').close());
    $('#textDialog').addEventListener('close', () => { state.pendingTextPoint = null; });

    $('#librarySearch').addEventListener('input', renderLibrary);
    $('#librarySort').addEventListener('change', renderLibrary);
    $('#libraryList').addEventListener('click', async event => {
      const button = event.target.closest('[data-action]');
      const card = event.target.closest('.sketch-card');
      if (!button || !card) return;
      try {
        if (button.dataset.action === 'open') await loadSketch(card.dataset.id);
        if (button.dataset.action === 'duplicate') await duplicateSketch(card.dataset.id);
        if (button.dataset.action === 'delete') await deleteSketch(card.dataset.id);
      } catch (error) { showToast(error.message || 'Action impossible.', 'error'); }
    });
    $('#exportBackupBtn').addEventListener('click', exportBackup);
    $('#importBackupBtn').addEventListener('click', () => $('#importBackupInput').click());
    $('#importBackupInput').addEventListener('change', event => importBackupFile(event.target.files[0]));

    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); requestSave(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) { event.preventDefault(); redo(); }
    });

    window.addEventListener('beforeunload', () => { clearTimeout(state.autoSaveTimer); storage.saveDraft(makeDraft()); });
    window.addEventListener('online', () => showToast('Connexion Internet rétablie. L’application demeure locale.', 'success'));
    window.addEventListener('offline', () => showToast('Mode hors ligne actif. Vos croquis restent disponibles.'));
  }

  async function init() {
    bindEvents();
    setTool('pen');
    await initializeStorageStatus();
    await restoreDraft();
    await refreshCount();
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(error => console.warn('Service worker non enregistré', error)));
    }
  }

  init().catch(error => {
    console.error(error);
    showToast('L’application n’a pas pu démarrer correctement. Rechargez la page.', 'error');
  });
})();
