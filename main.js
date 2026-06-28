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

/* ─────────────── DOM 小工具 ─────────────── */

function h(tag, styles, text) {
  const el = document.createElement(tag);
  if (styles) Object.assign(el.style, styles);
  if (text != null) el.textContent = text;
  return el;
}

function makeInput(type, value) {
  const inp = document.createElement('input');
  inp.type = type;
  if (value != null) inp.value = value;
  Object.assign(inp.style, {
    padding: '5px 8px',
    fontSize: '13px',
    borderRadius: '6px',
    border: '1px solid var(--border, #d1d5db)',
    background: 'var(--background, white)',
    color: 'var(--foreground, #111827)',
    outline: 'none',
    boxSizing: 'border-box',
  });
  return inp;
}

function makeCheckbox(checked, onChange) {
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = checked;
  Object.assign(cb.style, {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
    outline: 'none',
    accentColor: 'var(--foreground, #111827)',
    flex: '0 0 auto',
  });
  cb.addEventListener('change', () => onChange(cb.checked));
  return cb;
}

function makeButton(label, primary) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  Object.assign(b.style, {
    padding: '6px 14px',
    fontSize: '13px',
    borderRadius: '6px',
    cursor: 'pointer',
    outline: 'none',
  });
  if (primary) {
    b.style.background = 'var(--foreground, #111827)';
    b.style.color = 'var(--background, white)';
    b.style.border = '1px solid transparent';
  } else {
    b.style.background = 'transparent';
    b.style.color = 'var(--foreground, #111827)';
    b.style.border = '1px solid var(--border, #d1d5db)';
  }
  return b;
}

function shortDate(dateKey) {
  const p = String(dateKey).split('-');
  return Number(p[1]) + '/' + Number(p[2]);
}

function weekdayLabel(dateKey) {
  return '週' + WEEKDAYS[dateKeyToLocalDate(dateKey).getDay()];
}

function thCell(text) {
  const th = h('th', {
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: '1px solid var(--border, #d1d5db)',
    color: 'var(--foreground-muted, #6b7280)',
    fontWeight: '500',
    whiteSpace: 'nowrap',
  }, text);
  return th;
}

function tdCell(text) {
  return h('td', {
    padding: '8px 10px',
    borderBottom: '1px solid var(--border-subtle, #e5e7eb)',
  }, text || '');
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
  }

  async onload() {
    await this._loadData();

    this._statusItem = this.app.ui.addStatusBarItem({
      id: 'medication',
      label: '用藥記錄',
      icon: PILL_ICON,
      position: 'navBar',
      order: 8,
      badge: () => this._remainingBadge(),
      panel: {
        width: 320,
        maxHeight: 480,
        mount: (el, close) => this._mountPanel(el, close),
      },
    });
    this._handles.push(this._statusItem);

    this._view = this.app.ui.registerView({
      id: 'medication-table',
      title: '用藥記錄',
      mount: (el) => this._mountView(el),
    });
    this._handles.push(this._view);

    this._handles.push(
      this.app.ui.addSidebarItem({
        id: 'medication',
        label: '用藥記錄',
        icon: PILL_ICON,
        order: 30,
        onClick: () => { if (this._view) this._view.open(); },
        badge: () => this._remainingBadge(),
      }),
    );
  }

  async onunload() {
    for (const handle of this._handles) {
      try { handle.dispose(); } catch (e) { void e; }
    }
    this._handles = [];
    this._renders.clear();
    this._view = null;
    this._statusItem = null;
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

  // 把任意 medication 補成完整形狀，缺欄位給安全預設、補 id。
  _normalizeMedication(med) {
    if (!med || typeof med !== 'object') return null;
    const slots = {};
    for (const s of SLOTS) {
      const v = med.slots && med.slots[s];
      slots[s] = {
        enabled: !!(v && v.enabled),
        dose: v && typeof v.dose === 'string' ? v.dose : '',
      };
    }
    const days = Math.min(366, Math.max(1, Math.floor(Number(med.days)) || 1));
    return {
      id: typeof med.id === 'string' && med.id ? med.id : this._makeId(),
      name: typeof med.name === 'string' ? med.name : '',
      startDate: typeof med.startDate === 'string' ? med.startDate : this._todayKey(),
      days,
      slots,
    };
  }

  async _loadData() {
    const stored = await this.app.storage.load();
    const migrated = migrateData(stored, () => this._makeId());
    const medications = migrated.medications
      .map((m) => this._normalizeMedication(m))
      .filter(Boolean);
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
  _mountSetupForm(container, opts) {
    const o = opts || {};
    const existing = o.medId ? this._data.medications.find((m) => m.id === o.medId) : null;
    const draft = {
      id: existing ? existing.id : undefined,
      name: existing ? existing.name : '',
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

    const form = h('div', { display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' });
    form.appendChild(h('div', {
      fontSize: '14px', fontWeight: '600', color: 'var(--foreground, #111827)',
    }, existing ? '編輯藥物' : '新增藥物'));

    const makeField = (labelText, inputEl) => {
      const wrap = h('label', {
        display: 'flex', flexDirection: 'column', gap: '4px',
        fontSize: '13px', color: 'var(--foreground-muted, #6b7280)',
      });
      wrap.appendChild(h('span', null, labelText));
      inputEl.style.width = '100%';
      wrap.appendChild(inputEl);
      return wrap;
    };

    const nameInput = makeInput('text', draft.name);
    nameInput.placeholder = '例如 抗生素（選填）';
    form.appendChild(makeField('藥名', nameInput));

    const startInput = makeInput('date', draft.startDate);
    form.appendChild(makeField('開始日', startInput));

    const daysInput = makeInput('number', String(draft.days));
    daysInput.min = '1';
    form.appendChild(makeField('用藥期間（天）', daysInput));

    form.appendChild(h('div', {
      fontSize: '13px', color: 'var(--foreground-muted, #6b7280)', marginTop: '2px',
    }, '時段與劑量'));

    const slotsWrap = h('div', { display: 'flex', flexDirection: 'column', gap: '8px' });
    for (const s of SLOTS) {
      const row = h('div', { display: 'flex', alignItems: 'center', gap: '8px' });
      const doseInput = makeInput('text', draft.slots[s].dose);
      doseInput.placeholder = '劑量，例如 1 顆';
      doseInput.style.flex = '1';
      doseInput.disabled = !draft.slots[s].enabled;
      doseInput.style.opacity = draft.slots[s].enabled ? '1' : '0.45';
      doseInput.addEventListener('input', () => { draft.slots[s].dose = doseInput.value; });

      const cb = makeCheckbox(draft.slots[s].enabled, (checked) => {
        draft.slots[s].enabled = checked;
        doseInput.disabled = !checked;
        doseInput.style.opacity = checked ? '1' : '0.45';
      });

      row.appendChild(cb);
      row.appendChild(h('span', {
        width: '32px', fontSize: '13px', color: 'var(--foreground, #111827)',
      }, SLOT_LABELS[s]));
      row.appendChild(doseInput);
      slotsWrap.appendChild(row);
    }
    form.appendChild(slotsWrap);

    const btnRow = h('div', { display: 'flex', gap: '8px', marginTop: '4px' });
    const saveBtn = makeButton('儲存', true);
    saveBtn.style.flex = '1';
    saveBtn.addEventListener('click', () => {
      draft.days = Math.max(1, Math.floor(Number(daysInput.value)) || 1);
      draft.name = nameInput.value.trim();
      draft.startDate = startInput.value || this._todayKey();
      if (enabledSlots(draft).length === 0) {
        this.app.ui.showNotice('至少選一個用藥時段', { type: 'warning' });
        return;
      }
      for (const s of SLOTS) if (!draft.slots[s].enabled) draft.slots[s].dose = '';
      this._addOrUpdateMedication(draft);
      if (typeof o.onDone === 'function') o.onDone();
    });
    btnRow.appendChild(saveBtn);

    if (typeof o.onCancel === 'function') {
      const cancelBtn = makeButton('取消', false);
      cancelBtn.style.flex = '0 0 auto';
      cancelBtn.addEventListener('click', () => o.onCancel());
      btnRow.appendChild(cancelBtn);
    }
    form.appendChild(btnRow);

    container.appendChild(form);
    return () => {};
  }

  /* nav bar 面板：列出所有藥、今天各自打勾 + 新增 + 管理入口。 */
  _mountPanel(container, _close) {
    // null = 清單；{ medId } = 表單（medId 省略代表新增）
    let formState = this._data.medications.length === 0 ? { medId: undefined } : null;

    const render = () => {
      container.replaceChildren();
      Object.assign(container.style, {
        display: 'flex', flexDirection: 'column', gap: '12px',
        padding: '14px', boxSizing: 'border-box',
      });

      if (formState) {
        this._mountSetupForm(container, {
          medId: formState.medId,
          onDone: () => { formState = null; render(); },
          onCancel: this._data.medications.length > 0
            ? () => { formState = null; render(); }
            : undefined,
        });
        return;
      }

      const today = this._todayKey();
      const meds = this._data.medications;

      const header = h('div', {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
      });
      header.appendChild(h('div', {
        fontSize: '14px', fontWeight: '600', color: 'var(--foreground, #111827)',
      }, '用藥記錄'));
      const addBtn = makeButton('+ 新增', false);
      addBtn.style.padding = '3px 10px';
      addBtn.addEventListener('click', () => { formState = { medId: undefined }; render(); });
      header.appendChild(addBtn);
      container.appendChild(header);

      const list = h('div', { display: 'flex', flexDirection: 'column', gap: '14px' });
      for (const med of meds) {
        const plan = todayPlan(med, this._data.taken[med.id] || {}, today);
        const block = h('div', { display: 'flex', flexDirection: 'column', gap: '6px' });

        const titleRow = h('div', {
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px',
        });
        titleRow.appendChild(h('div', {
          fontSize: '13px', fontWeight: '600', color: 'var(--foreground, #111827)',
        }, med.name || '未命名'));
        if (plan.status === 'active') {
          titleRow.appendChild(h('div', {
            fontSize: '13px', color: 'var(--foreground-muted, #6b7280)', whiteSpace: 'nowrap',
          }, '第 ' + plan.dayIndex + ' / ' + plan.days + ' 天'));
        }
        block.appendChild(titleRow);

        if (plan.status === 'before') {
          block.appendChild(h('div', {
            fontSize: '13px', color: 'var(--foreground-muted, #6b7280)',
          }, shortDate(med.startDate) + ' 開始'));
        } else if (plan.status === 'after') {
          block.appendChild(h('div', {
            fontSize: '13px', color: 'var(--foreground-muted, #6b7280)',
          }, '療程已結束'));
        } else if (plan.status === 'active') {
          for (const sp of plan.slots) {
            const row = h('label', {
              display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
            });
            row.appendChild(makeCheckbox(sp.taken, (checked) => this._setTaken(med.id, today, sp.slot, checked)));
            row.appendChild(h('span', {
              width: '32px', fontSize: '14px', color: 'var(--foreground, #111827)',
            }, sp.label));
            row.appendChild(h('span', {
              flex: '1', fontSize: '13px',
              color: sp.taken ? 'var(--foreground-muted, #6b7280)' : 'var(--foreground, #111827)',
              textDecoration: sp.taken ? 'line-through' : 'none',
            }, sp.dose || ''));
            block.appendChild(row);
          }
        }
        list.appendChild(block);
      }
      container.appendChild(list);

      const footer = h('div', { display: 'flex', gap: '8px', marginTop: '2px' });
      const manageBtn = makeButton('管理 / 看全部', false);
      manageBtn.style.flex = '1';
      manageBtn.addEventListener('click', () => { if (this._view) this._view.open(); });
      footer.appendChild(manageBtn);
      container.appendChild(footer);
    };

    const unregister = this._registerRender(render);
    render();
    return () => { unregister(); };
  }

  /* 側邊欄開的內容區畫面：多種藥，每種一張卡（含完整療程表格）+ 新增 / 編輯 / 刪除。 */
  _mountView(container) {
    // null = 清單；{ medId } = 表單（medId 省略代表新增）
    let formState = null;

    const render = () => {
      const prevScroll = container.scrollTop;
      container.replaceChildren();
      Object.assign(container.style, {
        height: '100%', overflow: 'auto', boxSizing: 'border-box',
        padding: '24px', color: 'var(--foreground, #111827)',
      });

      if (formState) {
        const wrap = h('div', { maxWidth: '420px', margin: '0 auto' });
        container.appendChild(wrap);
        this._mountSetupForm(wrap, {
          medId: formState.medId,
          onDone: () => { formState = null; render(); },
          onCancel: () => { formState = null; render(); },
        });
        return;
      }

      const today = this._todayKey();
      const meds = this._data.medications;

      const head = h('div', {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '12px', marginBottom: '20px',
      });
      head.appendChild(h('div', { fontSize: '20px', fontWeight: '600' }, '用藥記錄'));
      const addBtn = makeButton('+ 新增藥物', true);
      addBtn.addEventListener('click', () => { formState = { medId: undefined }; render(); });
      head.appendChild(addBtn);
      container.appendChild(head);

      if (meds.length === 0) {
        container.appendChild(h('div', {
          textAlign: 'center', color: 'var(--foreground-muted, #6b7280)',
          fontSize: '14px', padding: '60px 0',
        }, '還沒有任何藥，點右上角「新增藥物」開始'));
        container.scrollTop = prevScroll;
        return;
      }

      const stack = h('div', { display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '760px' });
      for (const med of meds) {
        stack.appendChild(this._renderMedCard(med, today, (action, id) => {
          if (action === 'edit') { formState = { medId: id }; render(); }
          else if (action === 'delete') { this._deleteMedication(id); }
        }));
      }
      container.appendChild(stack);
      container.scrollTop = prevScroll;
    };

    const unregister = this._registerRender(render);
    render();
    return () => { unregister(); };
  }

  /* 單一藥的卡片：標頭（名稱/狀態/編輯/刪除）+ 進度條 + 完整療程表格。 */
  _renderMedCard(med, today, onAction) {
    const card = h('div', {
      border: '1px solid var(--border-subtle, #e5e7eb)', borderRadius: '10px', padding: '16px',
    });

    const dates = courseDates(med);
    const slots = enabledSlots(med);
    const totals = countDoses(med, this._data.taken[med.id] || {});
    const status = courseStatus(med, today);

    const head = h('div', {
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: '12px', marginBottom: '12px',
    });
    const left = h('div', { display: 'flex', flexDirection: 'column', gap: '3px' });
    left.appendChild(h('div', { fontSize: '15px', fontWeight: '600' }, med.name || '未命名'));
    let sub = dates.length > 0
      ? shortDate(med.startDate) + ' 至 ' + shortDate(dates[dates.length - 1]) + '，共 ' + med.days + ' 天'
      : '';
    if (status === 'active') sub += ' · 第 ' + dayIndexOf(med, today) + ' 天';
    else if (status === 'before') sub += ' · 尚未開始';
    else if (status === 'after') sub += ' · 已結束';
    left.appendChild(h('div', { fontSize: '13px', color: 'var(--foreground-muted, #6b7280)' }, sub));
    head.appendChild(left);

    const actions = h('div', { display: 'flex', gap: '6px', flex: '0 0 auto' });
    const editBtn = makeButton('編輯', false);
    editBtn.style.padding = '4px 10px';
    editBtn.addEventListener('click', () => onAction('edit', med.id));
    actions.appendChild(editBtn);

    const delBtn = makeButton('刪除', false);
    delBtn.style.padding = '4px 10px';
    let confirming = false;
    let confirmTimer = null;
    const resetDel = () => {
      confirming = false;
      delBtn.textContent = '刪除';
      delBtn.style.color = 'var(--foreground, #111827)';
      delBtn.style.borderColor = 'var(--border, #d1d5db)';
      if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
    };
    delBtn.addEventListener('click', () => {
      if (!confirming) {
        confirming = true;
        delBtn.textContent = '確定刪除？';
        delBtn.style.color = 'var(--danger-text, #b91c1c)';
        delBtn.style.borderColor = 'var(--danger-text, #b91c1c)';
        confirmTimer = setTimeout(resetDel, 3000);
        return;
      }
      onAction('delete', med.id);
    });
    actions.appendChild(delBtn);
    head.appendChild(actions);
    card.appendChild(head);

    const progWrap = h('div', { marginBottom: '14px' });
    progWrap.appendChild(h('div', {
      fontSize: '13px', color: 'var(--foreground-muted, #6b7280)', marginBottom: '6px',
    }, '進度 ' + totals.done + ' / ' + totals.total + ' 劑'));
    const bar = h('div', {
      height: '6px', borderRadius: '3px', background: 'var(--border, #e5e7eb)', overflow: 'hidden',
    });
    const pct = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;
    bar.appendChild(h('div', { height: '100%', width: pct + '%', background: 'var(--foreground, #111827)' }));
    progWrap.appendChild(bar);
    card.appendChild(progWrap);

    if (slots.length === 0) {
      card.appendChild(h('div', {
        fontSize: '13px', color: 'var(--foreground-muted, #6b7280)',
      }, '沒有啟用任何時段'));
      return card;
    }

    const tableWrap = h('div', { overflowX: 'auto' });
    const table = h('table', { borderCollapse: 'collapse', width: '100%', fontSize: '13px' });
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    htr.appendChild(thCell('日期'));
    for (const s of slots) {
      const dose = med.slots[s].dose ? ' · ' + med.slots[s].dose : '';
      htr.appendChild(thCell(SLOT_LABELS[s] + dose));
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const takenForMed = this._data.taken[med.id] || {};
    for (const dk of dates) {
      const tr = document.createElement('tr');
      if (dk === today) tr.style.background = 'color-mix(in srgb, var(--foreground) 7%, transparent)';
      const dcell = tdCell(shortDate(dk) + ' ' + weekdayLabel(dk));
      dcell.style.whiteSpace = 'nowrap';
      dcell.style.color = dk === today ? 'var(--foreground, #111827)' : 'var(--foreground-muted, #6b7280)';
      if (dk === today) dcell.style.fontWeight = '600';
      tr.appendChild(dcell);
      for (const s of slots) {
        const cell = tdCell('');
        cell.style.textAlign = 'center';
        const rec = takenForMed[dk] || {};
        cell.appendChild(makeCheckbox(!!rec[s], (checked) => this._setTaken(med.id, dk, s, checked)));
        tr.appendChild(cell);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    card.appendChild(tableWrap);

    return card;
  }
}

module.exports = MedicationPlugin;
Object.assign(module.exports, {
  SLOTS, SLOT_LABELS, toLocalDateKey, addDays, enabledSlots, courseDates,
  dayIndexOf, countDoses, courseStatus, todayPlan, remainingToday,
  remainingTodayAll, migrateData,
});
