'use strict';

const SLOTS = ['morning', 'noon', 'evening', 'bedtime'];
const SLOT_LABELS = { morning: '早', noon: '中', evening: '晚', bedtime: '睡前' };
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// 藥丸 icon（白名單沒有藥丸）。用 currentColor 讓 light/dark 自動跟。
const PILL_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>';

/* ─────────────── 純邏輯（不碰 DOM，匯出供測試） ─────────────── */

function toLocalDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function dateKeyToLocalDate(key) {
  const parts = String(key).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function addDays(dateKey, n) {
  const base = dateKeyToLocalDate(dateKey);
  base.setDate(base.getDate() + n);
  return toLocalDateKey(base);
}

function enabledSlots(course) {
  if (!course || !course.slots) return [];
  return SLOTS.filter((s) => course.slots[s] && course.slots[s].enabled);
}

function courseDates(course) {
  if (!course || !course.startDate || !course.days || course.days < 1) return [];
  const out = [];
  for (let i = 0; i < course.days; i++) out.push(addDays(course.startDate, i));
  return out;
}

function dayIndexOf(course, dateKey) {
  const idx = courseDates(course).indexOf(dateKey);
  return idx === -1 ? null : idx + 1;
}

function countDoses(course, taken) {
  const slots = enabledSlots(course);
  const dates = courseDates(course);
  let done = 0;
  for (const dk of dates) {
    const rec = (taken && taken[dk]) || {};
    for (const s of slots) if (rec[s]) done++;
  }
  return { done, total: slots.length * dates.length };
}

function courseStatus(course, dateKey) {
  const dates = courseDates(course);
  if (dates.length === 0) return 'none';
  if (dateKey < dates[0]) return 'before';
  if (dateKey > dates[dates.length - 1]) return 'after';
  return 'active';
}

function todayPlan(course, taken, dateKey) {
  const slots = enabledSlots(course).map((s) => ({
    slot: s,
    label: SLOT_LABELS[s],
    dose: course.slots[s].dose || '',
    taken: !!(taken && taken[dateKey] && taken[dateKey][s]),
  }));
  return {
    status: courseStatus(course, dateKey),
    dayIndex: dayIndexOf(course, dateKey),
    days: course ? course.days : 0,
    slots,
  };
}

function remainingToday(course, taken, dateKey) {
  if (courseStatus(course, dateKey) !== 'active') return 0;
  const rec = (taken && taken[dateKey]) || {};
  return enabledSlots(course).filter((s) => !rec[s]).length;
}

// 跨所有藥加總今天還沒吃的劑數。taken 以 medId 分組。
function remainingTodayAll(medications, taken, dateKey) {
  if (!Array.isArray(medications)) return 0;
  let n = 0;
  for (const med of medications) {
    n += remainingToday(med, (taken && taken[med.id]) || {}, dateKey);
  }
  return n;
}

// 把存檔資料正規成 { medications: [], taken: { medId: { date: { slot } } } }。
// 相容 v1.0.0 的單一療程格式（course + taken{date:{slot}}），migrate 不丟使用者紀錄。
// makeId 注入以利測試。
function migrateData(stored, makeId) {
  if (!stored || typeof stored !== 'object') return { medications: [], taken: {} };
  if (Array.isArray(stored.medications)) {
    return {
      medications: stored.medications,
      taken: stored.taken && typeof stored.taken === 'object' ? stored.taken : {},
    };
  }
  if (stored.course && typeof stored.course === 'object') {
    const id = makeId();
    return {
      medications: [{ ...stored.course, id }],
      taken: { [id]: stored.taken && typeof stored.taken === 'object' ? stored.taken : {} },
    };
  }
  return { medications: [], taken: {} };
}

/* ─────────────── i18n（en / zh-TW / zh-CN） ─────────────── */

function resolveLocale(locale) {
  const l = String(locale || '').toLowerCase();
  if (l.startsWith('en')) return 'en';
  if (l === 'zh-cn' || l.startsWith('zh-hans') || l === 'zh-sg') return 'zh-CN';
  return 'zh-TW';
}

function enWeekday(dk) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateKeyToLocalDate(dk).getDay()];
}

const STRINGS = {
  'zh-TW': {
    title: '用藥記錄', addLong: '＋ 新增藥物', addShort: '＋ 新增', manage: '管理 / 看全部',
    formAdd: '新增藥物', formEdit: '編輯藥物', fName: '藥名', phName: '例如 中藥包（選填）',
    fStart: '開始日', fDays: '用藥期間（天）', slotsAndDose: '時段與劑量',
    phDose: '劑量，例如 1 包', fNote: '附註（注意事項）', phNote: '注意事項，例如 飯後吃、避免與某藥同服',
    save: '儲存', cancel: '取消', needSlot: '至少選一個用藥時段',
    stActive: '進行中', stBefore: '未開始', stAfter: '已結束',
    overallProgress: '整體進度', doseUnit: ' 劑', dateCol: '日期',
    edit: '編輯', del: '刪除', delConfirm: '確定刪除？', noSlots: '沒有啟用任何時段', unnamed: '未命名',
    emptyView: '還沒有任何藥，點右上角「新增藥物」開始',
    notStartedMeta: ' · 尚未開始', endedMeta: ' · 已結束',
    slots: { morning: '早', noon: '中', evening: '晚', bedtime: '睡前' },
    summary: (count, remain) => count === 0 ? '還沒有藥'
      : count + ' 種藥' + (remain > 0 ? ' · 今天還有 ' + remain + ' 劑要吃' : ' · 今天都吃完了'),
    dayBadge: (i, n) => '第 ' + i + ' / ' + n + ' 天',
    dayMeta: (i) => ' · 第 ' + i + ' 天',
    rangeMeta: (s, e, d) => s + ' 至 ' + e + ' · 共 ' + d + ' 天',
    startMeta: (s) => s + ' 開始',
    dateLabel: (dk) => shortDate(dk) + ' 週' + WEEKDAYS[dateKeyToLocalDate(dk).getDay()],
  },
  en: {
    title: 'Medication', addLong: '+ Add medication', addShort: '+ Add', manage: 'Manage / view all',
    formAdd: 'Add medication', formEdit: 'Edit medication', fName: 'Name', phName: 'e.g. Antibiotics (optional)',
    fStart: 'Start date', fDays: 'Duration (days)', slotsAndDose: 'Times & doses',
    phDose: 'Dose, e.g. 1 pill', fNote: 'Note', phNote: 'e.g. take after meals, avoid with X',
    save: 'Save', cancel: 'Cancel', needSlot: 'Pick at least one time slot',
    stActive: 'Active', stBefore: 'Upcoming', stAfter: 'Finished',
    overallProgress: 'Progress', doseUnit: ' doses', dateCol: 'Date',
    edit: 'Edit', del: 'Delete', delConfirm: 'Confirm delete?', noSlots: 'No time slots enabled', unnamed: 'Unnamed',
    emptyView: 'No medications yet. Tap "Add medication" to start.',
    notStartedMeta: ' · Upcoming', endedMeta: ' · Finished',
    slots: { morning: 'Morn', noon: 'Noon', evening: 'Eve', bedtime: 'Bed' },
    summary: (count, remain) => count === 0 ? 'No medications yet'
      : count + (count > 1 ? ' medications' : ' medication')
        + (remain > 0 ? ' · ' + remain + (remain > 1 ? ' doses' : ' dose') + ' left today' : ' · all done today'),
    dayBadge: (i, n) => 'Day ' + i + ' / ' + n,
    dayMeta: (i) => ' · Day ' + i,
    rangeMeta: (s, e, d) => s + '–' + e + ' · ' + d + ' days',
    startMeta: (s) => 'Starts ' + s,
    dateLabel: (dk) => shortDate(dk) + ' ' + enWeekday(dk),
  },
  'zh-CN': {
    title: '用药记录', addLong: '＋ 新增药物', addShort: '＋ 新增', manage: '管理 / 看全部',
    formAdd: '新增药物', formEdit: '编辑药物', fName: '药名', phName: '例如 中药包（选填）',
    fStart: '开始日', fDays: '用药期间（天）', slotsAndDose: '时段与剂量',
    phDose: '剂量，例如 1 包', fNote: '附注（注意事项）', phNote: '注意事项，例如 饭后吃、避免与某药同服',
    save: '保存', cancel: '取消', needSlot: '至少选一个用药时段',
    stActive: '进行中', stBefore: '未开始', stAfter: '已结束',
    overallProgress: '整体进度', doseUnit: ' 剂', dateCol: '日期',
    edit: '编辑', del: '删除', delConfirm: '确定删除？', noSlots: '没有启用任何时段', unnamed: '未命名',
    emptyView: '还没有任何药，点右上角「新增药物」开始',
    notStartedMeta: ' · 尚未开始', endedMeta: ' · 已结束',
    slots: { morning: '早', noon: '中', evening: '晚', bedtime: '睡前' },
    summary: (count, remain) => count === 0 ? '还没有药'
      : count + ' 种药' + (remain > 0 ? ' · 今天还有 ' + remain + ' 剂要吃' : ' · 今天都吃完了'),
    dayBadge: (i, n) => '第 ' + i + ' / ' + n + ' 天',
    dayMeta: (i) => ' · 第 ' + i + ' 天',
    rangeMeta: (s, e, d) => s + ' 至 ' + e + ' · 共 ' + d + ' 天',
    startMeta: (s) => s + ' 开始',
    dateLabel: (dk) => shortDate(dk) + ' 周' + WEEKDAYS[dateKeyToLocalDate(dk).getDay()],
  },
};

/* ─────────────── 樣式（注入一次，scoped 在 .medp 底下，全用 Hyday theme token） ─────────────── */

const STYLE_ID = 'medp-styles';
const MEDP_CSS = `
.medp {
  --mp-accent: var(--hyday-teal, #0e7c6b);
  --mp-fg: var(--foreground, #1f2937);
  --mp-soft: var(--foreground-soft, #6b7280);
  --mp-muted: var(--foreground-muted, #9ca3af);
  --mp-line: var(--border-subtle, #e5e7eb);
  --mp-card: var(--background, #ffffff);
  --mp-sunken: color-mix(in srgb, var(--foreground, #111) 5%, transparent);
  --mp-accent-soft: color-mix(in srgb, var(--hyday-teal, #0e7c6b) 13%, transparent);
  --mp-ok: var(--success-text, #0f8a5f);
  --mp-ok-soft: color-mix(in srgb, var(--success-text, #0f8a5f) 14%, transparent);
  --mp-warn: var(--warning-text, #9a6b16);
  --mp-warn-soft: color-mix(in srgb, var(--warning-text, #9a6b16) 13%, transparent);
  --mp-danger: var(--danger-text, #b3261e);
  color: var(--mp-fg);
  font-size: 13px;
  line-height: 1.5;
  padding: 28px;
}
.medp.panel { padding: 14px; }
.medp * { box-sizing: border-box; }
.medp-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 22px; }
.medp.panel .medp-head { margin-bottom: 14px; }
.medp-title { font-size: 20px; font-weight: 700; letter-spacing: .01em; }
.medp.panel .medp-title { font-size: 14px; }
.medp-title small { display: block; font-size: 13px; font-weight: 400; color: var(--mp-muted); margin-top: 3px; letter-spacing: 0; }
.medp.panel .medp-title small { font-size: 12px; margin-top: 1px; }
.medp-add { font-size: 13px; font-weight: 600; color: #fff; background: var(--mp-accent); border: none; padding: 9px 15px; border-radius: 10px; cursor: pointer; outline: none; transition: filter .15s; box-shadow: 0 4px 12px -5px color-mix(in srgb, var(--hyday-teal, #0e7c6b) 70%, transparent); }
.medp.panel .medp-add { padding: 5px 11px; }
.medp-add:hover { filter: brightness(1.07); }
.medp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; align-items: start; }
.medp.panel .medp-grid { grid-template-columns: 1fr; gap: 14px; }
.medp-card { background: var(--mp-card); border: 1px solid var(--mp-line); border-radius: 14px; padding: 18px 18px 10px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
.medp.panel .medp-card { padding: 14px 14px 6px; }
.medp-chead { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.medp-name { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.medp.panel .medp-name { font-size: 14px; }
.medp-pill { font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
.medp-pill.live { background: var(--mp-ok-soft); color: var(--mp-ok); }
.medp-pill.soon { background: var(--mp-accent-soft); color: var(--mp-accent); }
.medp-pill.done { background: var(--mp-sunken); color: var(--mp-muted); }
.medp-meta { font-size: 13px; color: var(--mp-soft); margin-top: 4px; }
.medp-acts { display: flex; gap: 6px; flex: 0 0 auto; }
.medp-btn { font-size: 13px; color: var(--mp-soft); background: transparent; border: 1px solid var(--mp-line); padding: 4px 11px; border-radius: 8px; cursor: pointer; outline: none; transition: .15s; }
.medp-btn:hover { border-color: var(--mp-muted); color: var(--mp-fg); }
.medp-btn.armed { color: var(--mp-danger); border-color: color-mix(in srgb, var(--danger-text, #b3261e) 45%, transparent); }
.medp-note { background: var(--mp-warn-soft); color: var(--mp-warn); border-radius: 10px; padding: 9px 12px; margin: 13px 0 2px; line-height: 1.55; white-space: pre-wrap; }
.medp.panel .medp-note { margin: 6px 0; }
.medp-prog { margin: 14px 0 2px; }
.medp-prog-top { display: flex; justify-content: space-between; color: var(--mp-soft); margin-bottom: 6px; }
.medp-prog-top b { color: var(--mp-accent); font-weight: 700; font-variant-numeric: tabular-nums; }
.medp-bar { height: 7px; border-radius: 99px; background: var(--mp-sunken); overflow: hidden; }
.medp-bar > i { display: block; height: 100%; border-radius: 99px; background: var(--mp-accent); transition: width .3s ease; }
.medp-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
.medp-table th { font-size: 12px; font-weight: 600; color: var(--mp-muted); text-align: center; padding: 8px 6px; border-bottom: 1px solid var(--mp-line); }
.medp-table th.d { text-align: left; }
.medp-table th .dose { display: block; font-size: 11px; font-weight: 500; color: var(--mp-muted); margin-top: 1px; }
.medp-table td { padding: 9px 6px; text-align: center; border-bottom: 1px solid var(--mp-line); }
.medp-table tr:last-child td { border-bottom: none; }
.medp-table td.d { text-align: left; font-size: 13px; color: var(--mp-soft); white-space: nowrap; }
.medp-table tbody tr:hover td { background: var(--mp-sunken); }
.medp-table tr.today td { background: var(--mp-accent-soft); }
.medp-table tr.today:hover td { background: var(--mp-accent-soft); }
.medp-table tr.today td.d { color: var(--mp-accent); font-weight: 700; box-shadow: inset 3px 0 0 var(--mp-accent); }
.medp-chk { width: 18px; height: 18px; border-radius: 6px; border: 1.5px solid var(--border, #d1d5db); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; outline: none; transition: .13s; vertical-align: middle; }
.medp-chk:hover { border-color: var(--mp-accent); }
.medp-chk::after { content: ''; width: 4px; height: 8px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg) scale(0); transition: transform .13s; margin-top: -1px; }
.medp-chk[aria-checked="true"] { background: var(--mp-accent); border-color: var(--mp-accent); }
.medp-chk[aria-checked="true"]::after { transform: rotate(45deg) scale(1); }
.medp-day { display: flex; align-items: center; gap: 9px; padding: 4px 0; }
.medp-day .lbl { width: 30px; font-size: 14px; }
.medp-day .dose { flex: 1; font-size: 13px; color: var(--mp-fg); }
.medp-day .dose.taken { text-decoration: line-through; color: var(--mp-muted); }
.medp-footer { margin-top: 10px; }
.medp-manage { width: 100%; font-size: 13px; color: var(--mp-soft); background: transparent; border: 1px solid var(--mp-line); padding: 7px; border-radius: 9px; cursor: pointer; outline: none; transition: .15s; }
.medp-manage:hover { border-color: var(--mp-muted); color: var(--mp-fg); }
.medp-empty { text-align: center; color: var(--mp-muted); font-size: 14px; padding: 64px 0; }
.medp-form { display: flex; flex-direction: column; gap: 13px; max-width: 440px; margin: 0 auto; }
.medp.panel .medp-form { max-width: none; }
.medp-form h2 { font-size: 15px; font-weight: 700; }
.medp-field { display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: var(--mp-soft); }
.medp-sublabel { font-size: 13px; color: var(--mp-muted); margin-top: 2px; }
.medp-input, .medp-textarea { width: 100%; padding: 7px 10px; font-size: 13px; border: 1px solid var(--border, #d1d5db); border-radius: 8px; background: var(--background, #fff); color: var(--mp-fg); outline: none; font-family: inherit; transition: border-color .15s; }
.medp-input:focus, .medp-textarea:focus { border-color: var(--mp-accent); }
.medp-input.off { opacity: .45; }
.medp-textarea { resize: vertical; line-height: 1.5; min-height: 60px; }
.medp-slots { display: flex; flex-direction: column; gap: 8px; }
.medp-slot { display: flex; align-items: center; gap: 9px; }
.medp-slot .lbl { width: 44px; font-size: 13px; }
.medp-slot .medp-input { flex: 1; }
.medp-form-btns { display: flex; gap: 8px; margin-top: 4px; }
.medp-save { flex: 1; font-size: 13px; font-weight: 600; color: #fff; background: var(--mp-accent); border: none; padding: 9px; border-radius: 9px; cursor: pointer; outline: none; }
.medp-save:hover { filter: brightness(1.07); }
.medp-cancel { font-size: 13px; color: var(--mp-soft); background: transparent; border: 1px solid var(--mp-line); padding: 9px 14px; border-radius: 9px; cursor: pointer; outline: none; }
`;

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = MEDP_CSS;
  document.head.appendChild(style);
}

function removeStyles() {
  const existing = typeof document !== 'undefined' && document.getElementById(STYLE_ID);
  if (existing) existing.remove();
}

/* ─────────────── DOM 小工具 ─────────────── */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function makeInput(type, value) {
  const inp = el('input', 'medp-input');
  inp.type = type;
  if (value != null) inp.value = value;
  return inp;
}

// 自訂打勾框：圓角填色 + CSS 畫的勾。role=checkbox、可鍵盤操作。
function makeCheckbox(checked, onChange) {
  const cb = el('span', 'medp-chk');
  cb.setAttribute('role', 'checkbox');
  cb.setAttribute('tabindex', '0');
  cb.setAttribute('aria-checked', checked ? 'true' : 'false');
  const toggle = () => {
    const next = cb.getAttribute('aria-checked') !== 'true';
    cb.setAttribute('aria-checked', next ? 'true' : 'false');
    onChange(next);
  };
  cb.addEventListener('click', toggle);
  cb.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  });
  return cb;
}

function shortDate(dateKey) {
  const p = String(dateKey).split('-');
  return Number(p[1]) + '/' + Number(p[2]);
}

/* ─────────────── Plugin ─────────────── */

class MedicationPlugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    this._handles = [];
    this._data = { medications: [], taken: {} };
    this._renders = new Set();
    this._view = null;
    this._statusItem = null;
    this._locale = 'zh-TW';
  }

  _L() {
    return STRINGS[resolveLocale(this._locale)] || STRINGS['zh-TW'];
  }

  async onload() {
    injectStyles();
    if (this.app.i18n && this.app.i18n.locale) this._locale = this.app.i18n.locale;
    await this._loadData();
    const L = this._L();

    this._statusItem = this.app.ui.addStatusBarItem({
      id: 'medication',
      label: L.title,
      icon: PILL_ICON,
      position: 'navBar',
      order: 8,
      badge: () => this._remainingBadge(),
      panel: { width: 320, maxHeight: 480, mount: (elm, close) => this._mountPanel(elm, close) },
    });
    this._handles.push(this._statusItem);

    this._view = this.app.ui.registerView({
      id: 'medication-table',
      title: L.title,
      placement: 'content',
      mount: (elm) => this._mountView(elm),
    });
    this._handles.push(this._view);

    this._handles.push(
      this.app.ui.addSidebarItem({
        id: 'medication',
        label: L.title,
        icon: PILL_ICON,
        order: 30,
        onClick: () => { if (this._view) this._view.open(); },
        badge: () => this._remainingBadge(),
      }),
    );

    if (this.app.i18n && typeof this.app.i18n.onLocaleChange === 'function') {
      this._handles.push(this.app.i18n.onLocaleChange((loc) => {
        this._locale = loc;
        this._renderAll();
      }));
    }
  }

  async onunload() {
    for (const handle of this._handles) {
      try { handle.dispose(); } catch (e) { void e; }
    }
    this._handles = [];
    this._renders.clear();
    this._view = null;
    this._statusItem = null;
    removeStyles();
  }

  _makeId() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return 'med-' + crypto.randomUUID();
      }
    } catch (e) { void e; }
    return 'med-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  _remainingBadge() {
    const n = remainingTodayAll(this._data.medications, this._data.taken, this._todayKey());
    return n > 0 ? n : undefined;
  }

  _normalizeMedication(med) {
    if (!med || typeof med !== 'object') return null;
    const slots = {};
    for (const s of SLOTS) {
      const v = med.slots && med.slots[s];
      slots[s] = { enabled: !!(v && v.enabled), dose: v && typeof v.dose === 'string' ? v.dose : '' };
    }
    const days = Math.min(366, Math.max(1, Math.floor(Number(med.days)) || 1));
    return {
      id: typeof med.id === 'string' && med.id ? med.id : this._makeId(),
      name: typeof med.name === 'string' ? med.name : '',
      note: typeof med.note === 'string' ? med.note : '',
      startDate: typeof med.startDate === 'string' ? med.startDate : this._todayKey(),
      days,
      slots,
    };
  }

  async _loadData() {
    const stored = await this.app.storage.load();
    const migrated = migrateData(stored, () => this._makeId());
    const medications = migrated.medications.map((m) => this._normalizeMedication(m)).filter(Boolean);
    this._data = {
      medications,
      taken: migrated.taken && typeof migrated.taken === 'object' ? migrated.taken : {},
    };
  }

  async _saveData() {
    await this.app.storage.save(this._data);
  }

  _todayKey() {
    return toLocalDateKey(new Date());
  }

  _registerRender(fn) {
    this._renders.add(fn);
    return () => this._renders.delete(fn);
  }

  _renderAll() {
    for (const fn of this._renders) {
      try { fn(); } catch (e) { void e; }
    }
  }

  _setTaken(medId, dateKey, slot, value) {
    const byMed = { ...(this._data.taken[medId] || {}) };
    const day = { ...(byMed[dateKey] || {}) };
    if (value) day[slot] = true; else delete day[slot];
    if (Object.keys(day).length > 0) byMed[dateKey] = day; else delete byMed[dateKey];
    const taken = { ...this._data.taken };
    if (Object.keys(byMed).length > 0) taken[medId] = byMed; else delete taken[medId];
    this._data = { ...this._data, taken };
    void this._saveData();
    this._renderAll();
  }

  _addOrUpdateMedication(med) {
    const norm = this._normalizeMedication(med);
    if (!norm) return;
    const idx = this._data.medications.findIndex((m) => m.id === norm.id);
    const medications = [...this._data.medications];
    if (idx >= 0) medications[idx] = norm; else medications.push(norm);
    this._data = { ...this._data, medications };
    void this._saveData();
    this._renderAll();
  }

  _deleteMedication(medId) {
    const medications = this._data.medications.filter((m) => m.id !== medId);
    const taken = { ...this._data.taken };
    delete taken[medId];
    this._data = { ...this._data, medications, taken };
    void this._saveData();
    this._renderAll();
  }

  /* 設定表單：新增（opts.medId 省略）或編輯既有藥（opts.medId）。存完呼叫 onDone。 */
  _mountSetupForm(parent, opts) {
    const o = opts || {};
    const L = this._L();
    const existing = o.medId ? this._data.medications.find((m) => m.id === o.medId) : null;
    const draft = {
      id: existing ? existing.id : undefined,
      name: existing ? existing.name : '',
      note: existing ? (existing.note || '') : '',
      startDate: existing ? existing.startDate : this._todayKey(),
      days: existing ? existing.days : 7,
      slots: existing && existing.slots
        ? JSON.parse(JSON.stringify(existing.slots))
        : {
            morning: { enabled: true, dose: '' },
            noon: { enabled: false, dose: '' },
            evening: { enabled: true, dose: '' },
            bedtime: { enabled: false, dose: '' },
          },
    };
    for (const s of SLOTS) if (!draft.slots[s]) draft.slots[s] = { enabled: false, dose: '' };

    const form = el('div', 'medp-form');
    form.appendChild(el('h2', null, existing ? L.formEdit : L.formAdd));

    const field = (labelText, inputNode) => {
      const wrap = el('label', 'medp-field');
      wrap.appendChild(el('span', null, labelText));
      wrap.appendChild(inputNode);
      return wrap;
    };

    const nameInput = makeInput('text', draft.name);
    nameInput.placeholder = L.phName;
    form.appendChild(field(L.fName, nameInput));

    const startInput = makeInput('date', draft.startDate);
    form.appendChild(field(L.fStart, startInput));

    const daysInput = makeInput('number', String(draft.days));
    daysInput.min = '1';
    form.appendChild(field(L.fDays, daysInput));

    form.appendChild(el('div', 'medp-sublabel', L.slotsAndDose));
    const slotsWrap = el('div', 'medp-slots');
    for (const s of SLOTS) {
      const row = el('div', 'medp-slot');
      const doseInput = makeInput('text', draft.slots[s].dose);
      doseInput.placeholder = L.phDose;
      doseInput.disabled = !draft.slots[s].enabled;
      if (doseInput.disabled) doseInput.classList.add('off');
      doseInput.addEventListener('input', () => { draft.slots[s].dose = doseInput.value; });
      const cb = makeCheckbox(draft.slots[s].enabled, (v) => {
        draft.slots[s].enabled = v;
        doseInput.disabled = !v;
        doseInput.classList.toggle('off', !v);
      });
      row.appendChild(cb);
      row.appendChild(el('span', 'lbl', L.slots[s]));
      row.appendChild(doseInput);
      slotsWrap.appendChild(row);
    }
    form.appendChild(slotsWrap);

    const noteInput = el('textarea', 'medp-textarea');
    noteInput.value = draft.note;
    noteInput.placeholder = L.phNote;
    noteInput.rows = 3;
    noteInput.addEventListener('input', () => { draft.note = noteInput.value; });
    form.appendChild(field(L.fNote, noteInput));

    const btns = el('div', 'medp-form-btns');
    const saveBtn = el('button', 'medp-save', L.save);
    saveBtn.type = 'button';
    saveBtn.addEventListener('click', () => {
      draft.days = Math.max(1, Math.floor(Number(daysInput.value)) || 1);
      draft.name = nameInput.value.trim();
      draft.note = noteInput.value;
      draft.startDate = startInput.value || this._todayKey();
      if (enabledSlots(draft).length === 0) {
        this.app.ui.showNotice(L.needSlot, { type: 'warning' });
        return;
      }
      for (const s of SLOTS) if (!draft.slots[s].enabled) draft.slots[s].dose = '';
      this._addOrUpdateMedication(draft);
      if (typeof o.onDone === 'function') o.onDone();
    });
    btns.appendChild(saveBtn);
    if (typeof o.onCancel === 'function') {
      const cancelBtn = el('button', 'medp-cancel', L.cancel);
      cancelBtn.type = 'button';
      cancelBtn.addEventListener('click', () => o.onCancel());
      btns.appendChild(cancelBtn);
    }
    form.appendChild(btns);
    parent.appendChild(form);
  }

  /* nav bar 面板：列出所有藥、今天各自打勾 + 新增 + 管理入口。 */
  _mountPanel(container, _close) {
    let formState = this._data.medications.length === 0 ? { medId: undefined } : null;

    const render = () => {
      const L = this._L();
      const root = el('div', 'medp panel');

      if (formState) {
        this._mountSetupForm(root, {
          medId: formState.medId,
          onDone: () => { formState = null; render(); },
          onCancel: this._data.medications.length > 0 ? () => { formState = null; render(); } : undefined,
        });
        container.replaceChildren(root);
        return;
      }

      const today = this._todayKey();
      const meds = this._data.medications;

      const head = el('div', 'medp-head');
      head.appendChild(el('div', 'medp-title', L.title));
      const addBtn = el('button', 'medp-add', L.addShort);
      addBtn.type = 'button';
      addBtn.addEventListener('click', () => { formState = { medId: undefined }; render(); });
      head.appendChild(addBtn);
      root.appendChild(head);

      const grid = el('div', 'medp-grid');
      for (const med of meds) {
        const plan = todayPlan(med, this._data.taken[med.id] || {}, today);
        const block = el('div', 'medp-card');

        const chead = el('div', 'medp-chead');
        const name = el('div', 'medp-name', med.name || L.unnamed);
        if (plan.status === 'active') name.appendChild(el('span', 'medp-pill live', L.dayBadge(plan.dayIndex, plan.days)));
        else if (plan.status === 'before') name.appendChild(el('span', 'medp-pill soon', L.stBefore));
        else if (plan.status === 'after') name.appendChild(el('span', 'medp-pill done', L.stAfter));
        chead.appendChild(name);
        block.appendChild(chead);

        if (med.note) block.appendChild(el('div', 'medp-note', med.note));

        if (plan.status === 'before') {
          block.appendChild(el('div', 'medp-meta', L.startMeta(shortDate(med.startDate))));
        } else if (plan.status === 'active') {
          for (const sp of plan.slots) {
            const row = el('label', 'medp-day');
            row.appendChild(makeCheckbox(sp.taken, (v) => this._setTaken(med.id, today, sp.slot, v)));
            row.appendChild(el('span', 'lbl', L.slots[sp.slot]));
            row.appendChild(el('span', 'dose' + (sp.taken ? ' taken' : ''), sp.dose || ''));
            block.appendChild(row);
          }
        }
        grid.appendChild(block);
      }
      root.appendChild(grid);

      const footer = el('div', 'medp-footer');
      const manage = el('button', 'medp-manage', L.manage);
      manage.type = 'button';
      manage.addEventListener('click', () => { if (this._view) this._view.open(); });
      footer.appendChild(manage);
      root.appendChild(footer);

      container.replaceChildren(root);
    };

    const unregister = this._registerRender(render);
    render();
    return () => { unregister(); };
  }

  /* 側邊欄開的內容區畫面：多種藥，響應式並排，每種一張卡含完整療程表格。 */
  _mountView(container) {
    let formState = null;

    const render = () => {
      const L = this._L();
      const prevScroll = container.scrollTop;
      const root = el('div', 'medp');

      if (formState) {
        this._mountSetupForm(root, {
          medId: formState.medId,
          onDone: () => { formState = null; render(); },
          onCancel: () => { formState = null; render(); },
        });
        container.replaceChildren(root);
        return;
      }

      const today = this._todayKey();
      const meds = this._data.medications;
      const remain = remainingTodayAll(meds, this._data.taken, today);

      const head = el('div', 'medp-head');
      const title = el('div', 'medp-title', L.title);
      title.appendChild(el('small', null, L.summary(meds.length, remain)));
      head.appendChild(title);
      const addBtn = el('button', 'medp-add', L.addLong);
      addBtn.type = 'button';
      addBtn.addEventListener('click', () => { formState = { medId: undefined }; render(); });
      head.appendChild(addBtn);
      root.appendChild(head);

      if (meds.length === 0) {
        root.appendChild(el('div', 'medp-empty', L.emptyView));
        container.replaceChildren(root);
        container.scrollTop = prevScroll;
        return;
      }

      const grid = el('div', 'medp-grid');
      for (const med of meds) {
        grid.appendChild(this._renderMedCard(med, today, L, (action, id) => {
          if (action === 'edit') { formState = { medId: id }; render(); }
          else if (action === 'delete') { this._deleteMedication(id); }
        }));
      }
      root.appendChild(grid);

      container.replaceChildren(root);
      container.scrollTop = prevScroll;
    };

    const unregister = this._registerRender(render);
    render();
    return () => { unregister(); };
  }

  /* 單一藥的卡片：標頭（名稱/狀態/編輯/刪除）+ 附註 + 進度條 + 完整療程表格。 */
  _renderMedCard(med, today, L, onAction) {
    const card = el('div', 'medp-card');

    const dates = courseDates(med);
    const slots = enabledSlots(med);
    const totals = countDoses(med, this._data.taken[med.id] || {});
    const status = courseStatus(med, today);

    const chead = el('div', 'medp-chead');
    const left = el('div');
    const name = el('div', 'medp-name', med.name || L.unnamed);
    if (status === 'active') name.appendChild(el('span', 'medp-pill live', L.stActive));
    else if (status === 'before') name.appendChild(el('span', 'medp-pill soon', L.stBefore));
    else if (status === 'after') name.appendChild(el('span', 'medp-pill done', L.stAfter));
    left.appendChild(name);
    let sub = dates.length > 0
      ? L.rangeMeta(shortDate(med.startDate), shortDate(dates[dates.length - 1]), med.days)
      : '';
    if (status === 'active') sub += L.dayMeta(dayIndexOf(med, today));
    else if (status === 'before') sub += L.notStartedMeta;
    else if (status === 'after') sub += L.endedMeta;
    left.appendChild(el('div', 'medp-meta', sub));
    chead.appendChild(left);

    const acts = el('div', 'medp-acts');
    const editBtn = el('button', 'medp-btn', L.edit);
    editBtn.type = 'button';
    editBtn.addEventListener('click', () => onAction('edit', med.id));
    acts.appendChild(editBtn);
    const delBtn = el('button', 'medp-btn', L.del);
    delBtn.type = 'button';
    let armed = false;
    let armTimer = null;
    const disarm = () => {
      armed = false;
      delBtn.textContent = L.del;
      delBtn.classList.remove('armed');
      if (armTimer) { clearTimeout(armTimer); armTimer = null; }
    };
    delBtn.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        delBtn.textContent = L.delConfirm;
        delBtn.classList.add('armed');
        armTimer = setTimeout(disarm, 3000);
        return;
      }
      onAction('delete', med.id);
    });
    acts.appendChild(delBtn);
    chead.appendChild(acts);
    card.appendChild(chead);

    if (med.note) card.appendChild(el('div', 'medp-note', med.note));

    const prog = el('div', 'medp-prog');
    const progTop = el('div', 'medp-prog-top');
    progTop.appendChild(el('span', null, L.overallProgress));
    const right = el('span');
    right.appendChild(el('b', null, totals.done + ' / ' + totals.total));
    right.appendChild(document.createTextNode(L.doseUnit));
    progTop.appendChild(right);
    prog.appendChild(progTop);
    const bar = el('div', 'medp-bar');
    const fill = el('i');
    fill.style.width = (totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0) + '%';
    bar.appendChild(fill);
    prog.appendChild(bar);
    card.appendChild(prog);

    if (slots.length === 0) {
      card.appendChild(el('div', 'medp-meta', L.noSlots));
      return card;
    }

    const table = el('table', 'medp-table');
    const thead = el('thead');
    const htr = el('tr');
    htr.appendChild(el('th', 'd', L.dateCol));
    for (const s of slots) {
      const th = el('th', null, L.slots[s]);
      if (med.slots[s].dose) th.appendChild(el('span', 'dose', med.slots[s].dose));
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = el('tbody');
    const takenForMed = this._data.taken[med.id] || {};
    for (const dk of dates) {
      const tr = el('tr');
      if (dk === today) tr.className = 'today';
      tr.appendChild(el('td', 'd', L.dateLabel(dk)));
      for (const s of slots) {
        const td = el('td');
        const rec = takenForMed[dk] || {};
        td.appendChild(makeCheckbox(!!rec[s], (v) => this._setTaken(med.id, dk, s, v)));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    card.appendChild(table);

    return card;
  }
}

module.exports = MedicationPlugin;
Object.assign(module.exports, {
  SLOTS, SLOT_LABELS, toLocalDateKey, addDays, enabledSlots, courseDates,
  dayIndexOf, countDoses, courseStatus, todayPlan, remainingToday,
  remainingTodayAll, migrateData, resolveLocale, STRINGS,
});
