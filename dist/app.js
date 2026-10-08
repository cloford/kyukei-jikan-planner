import { calculateAllocatedBreaks, validateJobs } from './calculation.js';

const MIN_TIME = 6 * 60;
const MAX_TIME = 21 * 60;
const PX_PER_MINUTE = 104 / 60;
const AXIS_PADDING = 24;
const STORAGE_PREFIX = 'break-planner-v1:';
const MIN_BREAK_STORAGE_KEY = 'break-planner:min-break-minutes';
const $ = (id) => document.getElementById(id);
const refs = Object.fromEntries([
  'dateInput', 'jobsButton', 'jobCount', 'addButton', 'undoButton', 'resetButton',
  'settingsButton', 'settingsDialog', 'closeSettingsButton', 'minBreakSelect',
  'summary', 'outsideNotice', 'editBanner', 'editInstruction', 'cancelEditButton',
  'feedback', 'timeline', 'rulerLayer', 'timelineLane', 'breakLayer', 'jobLayer', 'timeLabelLayer',
  'ghostLayer', 'pointerGuide', 'guideTime', 'dragReadout',
  'jobsSheet', 'closeSheetButton', 'jobList', 'sheetAddButton',
  'resetDialog', 'cancelResetButton', 'confirmResetButton',
].map((id) => [id, $(id)]));

function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function fmt(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
function parseTime(value) {
  if (value === '24:00') return 1440;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return NaN;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : NaN;
}
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const snap = (value) => clamp(Math.round(value / 5) * 5, MIN_TIME, MAX_TIME);
const copyJobs = (jobs) => jobs.map((job) => ({ ...job }));
function loadMinBreakMinutes() {
  try {
    const value = Number(localStorage.getItem(MIN_BREAK_STORAGE_KEY));
    return Number.isInteger(value) && value >= 10 && value <= 40 && value % 5 === 0 ? value : 30;
  } catch { return 30; }
}
function fmtDuration(minutes) {
  return minutes >= 60 ? `${Math.floor(minutes / 60)}時間${minutes % 60}分` : `${minutes}分`;
}
const state = { date: localToday(), jobs: [], undo: [], edit: null, drag: null, feedback: '', suppressTapUntil: 0, minBreakMinutes: loadMinBreakMinutes() };

function loadDay(date) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + date) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.map((job, index) => ({
      id: String(job?.id ?? `saved-${index}`),
      name: typeof job?.name === 'string' ? job.name : '',
      start: typeof job?.start === 'number' ? job.start : NaN,
      end: typeof job?.end === 'number' ? job.end : NaN,
    }));
  } catch { return []; }
}
function saveDay() {
  try { localStorage.setItem(STORAGE_PREFIX + state.date, JSON.stringify(state.jobs)); }
  catch { state.feedback = 'このブラウザでは保存できません。'; }
}
function remember() {
  state.undo.push(copyJobs(state.jobs));
  if (state.undo.length > 30) state.undo.shift();
}
function setJobs(next) {
  remember();
  state.jobs = next;
  state.feedback = '';
  saveDay();
  render();
}
function sortedJobs() {
  return [...state.jobs].sort((a, b) =>
    (Number.isFinite(a.start) ? a.start : Infinity) - (Number.isFinite(b.start) ? b.start : Infinity)
    || String(a.id).localeCompare(String(b.id)));
}
function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function isOutside(job) {
  return Number.isFinite(job.start) && Number.isFinite(job.end)
    && (job.start < MIN_TIME || job.end > MAX_TIME);
}
function isOnAxis(job) {
  return Number.isFinite(job.start) && Number.isFinite(job.end)
    && job.start >= MIN_TIME && job.end <= MAX_TIME && job.end > job.start;
}
function setFeedback(message) {
  state.feedback = message;
  refs.feedback.textContent = message;
}

function renderRuler() {
  refs.rulerLayer.replaceChildren();
  for (let hour = 6; hour <= 21; hour += 1) {
    const row = document.createElement('div'); row.className = 'hour-row';
    row.style.top = `${AXIS_PADDING + (hour * 60 - MIN_TIME) * PX_PER_MINUTE}px`;
    const label = document.createElement('span'); label.className = 'hour-label'; label.textContent = `${String(hour).padStart(2, '0')}:00`;
    const line = document.createElement('span'); line.className = 'hour-line';
    row.append(label, line); refs.rulerLayer.append(row);
    if (hour === 21) continue;
    const half = document.createElement('div'); half.className = 'half-row';
    half.style.top = `${AXIS_PADDING + (hour * 60 + 30 - MIN_TIME) * PX_PER_MINUTE}px`;
    const halfLabel = document.createElement('span'); halfLabel.className = 'hour-label'; halfLabel.textContent = `${String(hour).padStart(2, '0')}:30`;
    const halfLine = document.createElement('span'); halfLine.className = 'hour-line';
    half.append(halfLabel, halfLine); refs.rulerLayer.append(half);
  }
}
function makeBlock(className, start, end) {
  const block = document.createElement(className === 'job-block' ? 'button' : 'div');
  block.className = `time-item ${className}`;
  block.style.top = `${(start - MIN_TIME) * PX_PER_MINUTE}px`;
  block.style.height = `${Math.max(1, (end - start) * PX_PER_MINUTE)}px`;
  if (block.tagName === 'BUTTON') block.type = 'button';
  return block;
}
function placeTimeLabels(items) {
  refs.timeLabelLayer.replaceChildren();
  const compact = items.filter((item) => item.end - item.start < 20)
    .sort((a, b) => a.start - b.start);
  const labels = [];
  let nextTop = 0;
  for (const item of compact) {
    const center = ((item.start + item.end) / 2 - MIN_TIME) * PX_PER_MINUTE;
    const top = Math.max(nextTop, Math.round(center - 9));
    labels.push({ item, top });
    nextTop = top + 20;
  }
  const excess = Math.max(0, nextTop - 1560);
  if (excess) for (const label of labels) label.top -= excess;
  for (const { item, top } of labels) {
    const pill = document.createElement('span');
    pill.className = `edge-time-label ${item.kind}`;
    pill.style.top = `${top}px`;
    pill.textContent = `${fmt(item.start)}–${fmt(item.end)}`;
    refs.timeLabelLayer.append(pill);
    for (const other of items) {
      const barTop = (other.start - MIN_TIME) * PX_PER_MINUTE;
      const barBottom = (other.end - MIN_TIME) * PX_PER_MINUTE;
      if (barTop < top + 19 && barBottom > top) other.block.classList.add('with-time-rail');
    }
  }
}
function renderTimeline(result) {
  refs.breakLayer.replaceChildren(); refs.jobLayer.replaceChildren(); refs.timeLabelLayer.replaceChildren(); refs.ghostLayer.replaceChildren();
  refs.timelineLane.classList.toggle('is-editing', !!state.edit);
  const items = [];
  if (!state.drag && result.status === 'valid') {
    result.breaks.forEach((item, index) => {
      const start = Math.max(item.start, MIN_TIME), end = Math.min(item.end, MAX_TIME);
      if (end <= start) return;
      const block = makeBlock('break-block', start, end);
      block.setAttribute('aria-label', `休憩${index + 1} ${fmt(item.start)}から${fmt(item.end)}`);
      const label = document.createElement('span'); label.className = 'break-name'; label.textContent = `休憩${index + 1}`;
      const time = document.createElement('span'); time.className = 'break-time'; time.textContent = `${fmt(item.start)}–${fmt(item.end)}`;
      block.append(label, time); refs.breakLayer.append(block);
      if (end - start < 20) block.classList.add('compact-time');
      items.push({ block, start, end, kind: 'break' });
    });
  }
  sortedJobs().forEach((job, index) => {
    if (!isOnAxis(job)) return;
    const block = makeBlock('job-block', job.start, job.end);
    block.dataset.id = job.id;
    block.setAttribute('aria-label', `${job.name || `案件${index + 1}`} ${fmt(job.start)}から${fmt(job.end)}。タップして編集`);
    if (state.edit?.type === 'adjust' && state.edit.id === job.id) block.classList.add('is-editing');
    if (state.drag?.id === job.id) block.classList.add('is-dragging');
    const name = document.createElement('span'); name.className = 'job-name'; name.textContent = job.name || `案件${index + 1}`;
    const time = document.createElement('span'); time.className = 'job-time'; time.textContent = `${fmt(job.start)}–${fmt(job.end)}`;
    if (job.end - job.start < 20) block.classList.add('compact-time');
    if (job.end - job.start < 10) block.classList.add('micro-time');
    const startHandle = document.createElement('span'); startHandle.className = 'resize-handle start'; startHandle.dataset.handle = 'start'; startHandle.setAttribute('aria-hidden', 'true');
    const endHandle = document.createElement('span'); endHandle.className = 'resize-handle end'; endHandle.dataset.handle = 'end'; endHandle.setAttribute('aria-hidden', 'true');
    block.append(startHandle, name, time, endHandle);
    block.addEventListener('click', () => {
      if (Date.now() < state.suppressTapUntil || state.edit) return;
      openSheet(job.id);
    });
    refs.jobLayer.append(block);
    items.push({ block, start: job.start, end: job.end, kind: 'job' });
  });
  placeTimeLabels(items);
}
function renderSummary(result) {
  refs.summary.className = 'compact-summary';
  refs.summary.replaceChildren();
  refs.summary.hidden = !state.jobs.length;
  if (!state.jobs.length) return;
  if (state.drag) {
    refs.summary.textContent = '時刻を調整中';
    return;
  }
  if (result.status === 'invalid') {
    refs.summary.classList.add('invalid');
    refs.summary.textContent = '入力エラー · 案件一覧で時刻を修正';
    return;
  }
  if (result.status === 'impossible') refs.summary.classList.add('impossible');
  const confinement = document.createElement('div'); confinement.className = 'summary-stat';
  const confinementLabel = document.createElement('span'); confinementLabel.textContent = '拘束時間';
  const confinementValue = document.createElement('strong'); confinementValue.textContent = fmtDuration(result.confinementMinutes);
  confinement.append(confinementLabel, confinementValue);
  const plan = document.createElement('div'); plan.className = 'summary-plan';
  plan.textContent = result.status === 'valid' ? `休憩案 ${result.count}回 · 合計 ${result.totalMinutes}分` : '成立しません';
  refs.summary.append(confinement, plan);
}
function renderNotices() {
  const outside = state.jobs.filter((job) => !isOnAxis(job));
  refs.outsideNotice.replaceChildren();
  refs.outsideNotice.hidden = outside.length === 0;
  if (outside.length) {
    const message = document.createElement('span');
    message.textContent = `時間軸に表示できない案件が${outside.length}件あります（範囲外・時刻エラー）。保存した内容は残っています。`;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '時刻を修正';
    button.addEventListener('click', () => openSheet(outside[0].id));
    refs.outsideNotice.append(message, button);
  }
  refs.editBanner.hidden = !state.edit;
  if (state.edit) {
    refs.editInstruction.textContent = state.edit.type === 'create'
      ? '追加モード：空白を縦になぞって時刻を決めてください。左の時刻欄からスクロールできます。'
      : '編集モード：帯を動かすか、上下のつまみで長さを調整してください。10分以下で離すと削除します。';
  }
  refs.feedback.textContent = state.feedback;
  refs.undoButton.disabled = state.undo.length === 0;
  refs.resetButton.disabled = state.jobs.length === 0;
  refs.jobCount.textContent = String(state.jobs.length);
}
function render() {
  const result = calculateAllocatedBreaks(state.jobs, state.minBreakMinutes);
  renderSummary(result);
  renderTimeline(result);
  renderNotices();
  if (refs.jobsSheet.open) renderSheet(result);
}

function openSheet(focusId = null) {
  renderSheet(calculateAllocatedBreaks(state.jobs, state.minBreakMinutes));
  if (!refs.jobsSheet.open) refs.jobsSheet.showModal();
  if (focusId) {
    const card = [...refs.jobList.querySelectorAll('.job-card')].find((element) => element.dataset.id === focusId);
    card?.scrollIntoView({ block: 'nearest' });
  }
}
function makeSheetButton(text, className, onClick, label) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = className; button.textContent = text;
  if (label) button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}
function renderSheet(result) {
  refs.jobList.replaceChildren();
  if (!state.jobs.length) {
    const empty = document.createElement('div'); empty.className = 'sheet-empty';
    empty.textContent = '案件はまだありません。時間軸から追加できます。';
    refs.jobList.append(empty); return;
  }
  sortedJobs().forEach((job, index) => {
    const errors = result.errors.filter((error) => String(error.id) === String(job.id));
    const card = document.createElement('div');
    card.className = `job-card${errors.length ? ' has-error' : ''}${isOutside(job) ? ' outside' : ''}`;
    card.dataset.id = job.id;
    const top = document.createElement('div'); top.className = 'job-card-top';
    const badge = document.createElement('span'); badge.className = 'order-badge'; badge.textContent = String(index + 1);
    const name = document.createElement('input'); name.className = 'name-input'; name.type = 'text'; name.maxLength = 60;
    name.value = job.name; name.placeholder = `案件${index + 1}`; name.setAttribute('aria-label', `案件${index + 1}の名前`);
    name.addEventListener('change', () => setJobs(state.jobs.map((item) => item.id === job.id ? { ...item, name: name.value.trim() } : item)));
    const del = makeSheetButton('×', 'delete-button', () => setJobs(state.jobs.filter((item) => item.id !== job.id)), `${job.name || `案件${index + 1}`}を削除`);
    top.append(badge, name, del); card.append(top);
    const row = document.createElement('div'); row.className = 'time-row';
    for (const field of ['start', 'end']) {
      if (field === 'end') { const sep = document.createElement('span'); sep.className = 'time-separator'; sep.textContent = '→'; row.append(sep); }
      const label = document.createElement('label'); label.className = 'time-field'; label.textContent = field === 'start' ? '開始' : '終了';
      const input = document.createElement('input'); input.type = 'time'; input.step = '300'; input.min = '06:00'; input.max = '21:00';
      input.value = Number.isFinite(job[field]) && job[field] < 1440 ? fmt(job[field]) : '';
      input.setAttribute('aria-label', `${job.name || `案件${index + 1}`}の${field === 'start' ? '開始' : '終了'}時刻`);
      if (errors.some((error) => error.field === field) || job[field] < MIN_TIME || job[field] > MAX_TIME) input.setAttribute('aria-invalid', 'true');
      input.addEventListener('change', () => {
        const value = parseTime(input.value);
        if (Number.isFinite(value) && (value < MIN_TIME || value > MAX_TIME)) {
          setFeedback('06:00から21:00までの時刻を入力してください。');
          input.value = Number.isFinite(job[field]) && job[field] < 1440 ? fmt(job[field]) : '';
          return;
        }
        setJobs(state.jobs.map((item) => item.id === job.id ? { ...item, [field]: value } : item));
      });
      label.append(input); row.append(label);
    }
    card.append(row);
    if (isOutside(job)) {
      const note = document.createElement('p'); note.className = 'job-note';
      note.textContent = '表示範囲外です。開始・終了を06:00–21:00に修正してください。';
      card.append(note);
    }
    if (errors.length) {
      const note = document.createElement('p'); note.className = 'job-note error';
      note.textContent = [...new Set(errors.map((error) => error.message))].join(' ');
      card.append(note);
    }
    const actions = document.createElement('div'); actions.className = 'job-card-actions';
    const edit = makeSheetButton('時間軸で編集', 'edit-on-axis', () => startAdjust(job.id));
    edit.disabled = !isOnAxis(job);
    actions.append(edit); card.append(actions);
    refs.jobList.append(card);
  });
}
function startCreate() {
  if (refs.jobsSheet.open) refs.jobsSheet.close();
  state.edit = { type: 'create' };
  state.feedback = '';
  render();
}
function startAdjust(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job || !isOnAxis(job)) { setFeedback('表示範囲外の案件は一覧の時刻欄から修正してください。'); return; }
  if (refs.jobsSheet.open) refs.jobsSheet.close();
  state.edit = { type: 'adjust', id };
  state.feedback = '';
  render();
}
function finishEdit() {
  state.edit = null;
  state.drag = null;
  refs.ghostLayer.replaceChildren();
  hideDragIndicators();
  render();
}

function pointerMinute(event) {
  const rect = refs.timelineLane.getBoundingClientRect();
  return clamp(MIN_TIME + (event.clientY - rect.top) / PX_PER_MINUTE, MIN_TIME, MAX_TIME);
}
function hideDragIndicators() {
  refs.dragReadout.hidden = true;
  refs.pointerGuide.hidden = true;
}
function showGhost(drag, event) {
  refs.ghostLayer.replaceChildren();
  const ghost = makeBlock('ghost-block', drag.start, drag.end);
  const deleting = drag.type !== 'create' && drag.type !== 'move' && drag.end - drag.start <= 10;
  if (deleting) ghost.classList.add('delete-preview');
  ghost.textContent = deleting ? '削除' : '';
  refs.ghostLayer.append(ghost);

  const pointed = snap(pointerMinute(event));
  refs.pointerGuide.hidden = false;
  refs.pointerGuide.style.top = `${(pointed - MIN_TIME) * PX_PER_MINUTE}px`;
  refs.guideTime.textContent = fmt(pointed);

  refs.dragReadout.hidden = false;
  refs.dragReadout.classList.toggle('delete-preview', deleting);
  refs.dragReadout.replaceChildren();
  const times = document.createElement('strong'); times.textContent = `${fmt(drag.start)}–${fmt(drag.end)}`;
  const detail = document.createElement('span');
  detail.textContent = deleting ? `指を離すと削除 · ${drag.end - drag.start}分` : `長さ ${drag.end - drag.start}分`;
  refs.dragReadout.append(times, detail);
  const toolbarBottom = document.querySelector('.control-strip').getBoundingClientRect().bottom;
  const bannerBottom = state.edit ? refs.editBanner.getBoundingClientRect().bottom : 0;
  const minTop = Math.min(window.innerHeight - 88, Math.max(toolbarBottom, bannerBottom) + 8);
  let top = event.clientY >= minTop + 115 ? event.clientY - 112 : event.clientY + 68;
  if (top > window.innerHeight - 88) top = event.clientY - 112;
  refs.dragReadout.style.top = `${clamp(top, minTop, window.innerHeight - 88)}px`;
}
function updateDrag(event) {
  const drag = state.drag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const minute = pointerMinute(event);
  const delta = Math.round((minute - drag.origin) / 5) * 5;
  if (drag.type === 'create') {
    drag.start = snap(Math.min(drag.origin, minute));
    drag.end = snap(Math.max(drag.origin, minute));
  } else if (drag.type === 'move') {
    const length = drag.original.end - drag.original.start;
    drag.start = clamp(drag.original.start + delta, MIN_TIME, MAX_TIME - length);
    drag.end = drag.start + length;
  } else if (drag.type === 'start') {
    drag.start = clamp(drag.original.start + delta, MIN_TIME, drag.original.end);
    drag.end = drag.original.end;
  } else {
    drag.start = drag.original.start;
    drag.end = clamp(drag.original.end + delta, drag.original.start, MAX_TIME);
  }
  showGhost(drag, event);
}
function endDrag(event) {
  const drag = state.drag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  updateDrag(event);
  try { refs.timelineLane.releasePointerCapture(event.pointerId); } catch { /* Capture may already be gone. */ }
  state.suppressTapUntil = Date.now() + 500;
  state.drag = null;
  state.edit = null;
  refs.ghostLayer.replaceChildren();
  hideDragIndicators();
  if (drag.type === 'create') {
    if (drag.end - drag.start < 10) { state.feedback = '10分以上なぞってください。'; render(); return; }
    const next = [...state.jobs, { id: newId(), name: '', start: drag.start, end: drag.end }];
    const validation = validateJobs(next);
    if (!validation.valid) { state.feedback = validation.errors[0].message; render(); return; }
    setJobs(next); return;
  }
  if ((drag.type === 'start' || drag.type === 'end') && drag.end - drag.start <= 10) {
    setJobs(state.jobs.filter((job) => job.id !== drag.id));
    setFeedback('案件を削除しました。「元に戻す」で復元できます。');
    return;
  }
  if (drag.original.start === drag.start && drag.original.end === drag.end) { render(); return; }
  const next = state.jobs.map((job) => job.id === drag.id ? { ...job, start: drag.start, end: drag.end } : job);
  const validation = validateJobs(next);
  if (!validation.valid) {
    state.feedback = validation.errors.find((error) => String(error.id) === String(drag.id))?.message || validation.errors[0].message;
    render(); return;
  }
  setJobs(next);
}

refs.timelineLane.addEventListener('pointerdown', (event) => {
  if (!state.edit || state.drag || !event.isPrimary || event.button !== 0) return;
  const block = event.target.closest('.job-block');
  if (state.edit.type === 'create' && block) { setFeedback('空白の時間帯をなぞってください。'); return; }
  if (state.edit.type === 'adjust' && block?.dataset.id !== state.edit.id) return;
  if (state.edit.type === 'adjust' && !block) return;
  const job = block ? state.jobs.find((item) => item.id === block.dataset.id) : null;
  const handle = event.target.closest('.resize-handle')?.dataset.handle;
  const type = state.edit.type === 'create' ? 'create' : (handle || 'move');
  const minute = pointerMinute(event);
  state.drag = {
    pointerId: event.pointerId, type, id: job?.id, original: job ? { ...job } : null,
    origin: minute, start: job?.start ?? snap(minute), end: job?.end ?? snap(minute),
  };
  refs.timelineLane.setPointerCapture(event.pointerId);
  refs.breakLayer.replaceChildren();
  if (block) block.classList.add('is-dragging');
  refs.summary.textContent = '時刻を調整中';
  state.feedback = ''; refs.feedback.textContent = '';
  showGhost(state.drag, event);
  event.preventDefault();
});
refs.timelineLane.addEventListener('pointermove', updateDrag);
refs.timelineLane.addEventListener('pointerup', endDrag);
refs.timelineLane.addEventListener('pointercancel', () => finishEdit());

refs.addButton.addEventListener('click', startCreate);
refs.sheetAddButton.addEventListener('click', startCreate);
refs.cancelEditButton.addEventListener('click', finishEdit);
refs.jobsButton.addEventListener('click', () => openSheet());
refs.settingsButton.addEventListener('click', () => refs.settingsDialog.showModal());
refs.closeSettingsButton.addEventListener('click', () => refs.settingsDialog.close());
refs.settingsDialog.addEventListener('click', (event) => { if (event.target === refs.settingsDialog) refs.settingsDialog.close(); });
refs.minBreakSelect.addEventListener('change', () => {
  const value = Number(refs.minBreakSelect.value);
  if (!Number.isInteger(value) || value < 10 || value > 40 || value % 5 !== 0) return;
  state.minBreakMinutes = value;
  try { localStorage.setItem(MIN_BREAK_STORAGE_KEY, String(value)); }
  catch { setFeedback('このブラウザでは設定を保存できません。'); }
  render();
});
refs.closeSheetButton.addEventListener('click', () => refs.jobsSheet.close());
refs.jobsSheet.addEventListener('click', (event) => { if (event.target === refs.jobsSheet) refs.jobsSheet.close(); });
refs.undoButton.addEventListener('click', () => {
  if (!state.undo.length) return;
  state.jobs = state.undo.pop();
  state.edit = null; state.feedback = '';
  saveDay(); render();
});
refs.resetButton.addEventListener('click', () => { if (state.jobs.length) refs.resetDialog.showModal(); });
refs.cancelResetButton.addEventListener('click', () => refs.resetDialog.close());
refs.confirmResetButton.addEventListener('click', () => {
  refs.resetDialog.close();
  state.edit = null;
  state.drag = null;
  hideDragIndicators();
  setJobs([]);
  setFeedback('この日をリセットしました。「元に戻す」で復元できます。');
});
refs.dateInput.addEventListener('change', () => {
  if (!refs.dateInput.value) return;
  state.date = refs.dateInput.value;
  state.jobs = loadDay(state.date);
  state.undo = []; state.edit = null; state.drag = null; state.feedback = '';
  hideDragIndicators();
  render();
});
refs.dateInput.value = state.date;
refs.minBreakSelect.value = String(state.minBreakMinutes);
state.jobs = loadDay(state.date);
renderRuler();
render();
