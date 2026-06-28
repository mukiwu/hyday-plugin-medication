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
    this._data = { course: null, taken: {} };
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
        width: 300,
        maxHeight: 460,
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

  _remainingBadge() {
    const n = remainingToday(this._data.course, this._data.taken, this._todayKey());
    return n > 0 ? n : undefined;
  }

  // 把任意來源的 course 補成完整形狀，缺欄位給安全預設。
  // 防 data.json 被舊版寫過或手改造成缺 slots 而在設定表單炸掉。
  _normalizeCourse(course) {
    if (!course || typeof course !== 'object') return null;
    const slots = {};
    for (const s of SLOTS) {
      const v = course.slots && course.slots[s];
      slots[s] = {
        enabled: !!(v && v.enabled),
        dose: v && typeof v.dose === 'string' ? v.dose : '',
      };
    }
    const days = Math.min(366, Math.max(1, Math.floor(Number(course.days)) || 1));
    return {
      name: typeof course.name === 'string' ? course.name : '',
      startDate: typeof course.startDate === 'string' ? course.startDate : this._todayKey(),
      days,
      slots,
    };
  }

  async _loadData() {
    const stored = await this.app.storage.load();
    if (stored && typeof stored === 'object') {
      this._data = {
        course: this._normalizeCourse(stored.course),
        taken: stored.taken && typeof stored.taken === 'object' ? stored.taken : {},
      };
    }
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

  _setTaken(dateKey, slot, value) {
    const day = { ...(this._data.taken[dateKey] || {}) };
    if (value) day[slot] = true; else delete day[slot];
    const taken = { ...this._data.taken };
    if (Object.keys(day).length > 0) taken[dateKey] = day; else delete taken[dateKey];
    this._data = { ...this._data, taken };
    void this._saveData();
    this._renderAll();
  }

  _saveCourse(course) {
    this._data = { ...this._data, course: this._normalizeCourse(course) };
    void this._saveData();
    this._renderAll();
  }

  /* 設定表單，panel 與 view 共用。存檔後呼叫 onDone。 */
  _mountSetupForm(container, onDone) {
    const c = this._data.course;
    const draft = {
      name: c ? c.name : '',
      startDate: c ? c.startDate : this._todayKey(),
      days: c ? c.days : 7,
      slots: c && c.slots
        ? JSON.parse(JSON.stringify(c.slots))
        : {
            morning: { enabled: true, dose: '' },
            noon: { enabled: false, dose: '' },
            evening: { enabled: true, dose: '' },
            bedtime: { enabled: false, dose: '' },
          },
    };
    // 確保四個 key 都在（舊資料防禦）
    for (const s of SLOTS) if (!draft.slots[s]) draft.slots[s] = { enabled: false, dose: '' };

    const form = h('div', { display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' });

    form.appendChild(h('div', {
      fontSize: '14px', fontWeight: '600', color: 'var(--foreground, #111827)',
    }, c ? '編輯用藥療程' : '設定用藥療程'));

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

    const saveBtn = makeButton('儲存', true);
    saveBtn.style.width = '100%';
    saveBtn.style.marginTop = '4px';
    saveBtn.addEventListener('click', () => {
      const days = Math.max(1, Math.floor(Number(daysInput.value)) || 1);
      draft.days = days;
      draft.name = nameInput.value.trim();
      draft.startDate = startInput.value || this._todayKey();
      if (enabledSlots(draft).length === 0) {
        this.app.ui.showNotice('至少選一個用藥時段', { type: 'warning' });
        return;
      }
      for (const s of SLOTS) if (!draft.slots[s].enabled) draft.slots[s].dose = '';
      this._saveCourse(draft);
      onDone();
    });
    form.appendChild(saveBtn);

    container.appendChild(form);
    return () => {};
  }

  /* nav bar 面板：今日打勾 + 設定入口。 */
  _mountPanel(container, _close) {
    let editing = !this._data.course;

    const render = () => {
      container.replaceChildren();
      Object.assign(container.style, {
        display: 'flex', flexDirection: 'column', gap: '10px',
        padding: '14px', boxSizing: 'border-box',
      });

      if (editing) {
        this._mountSetupForm(container, () => { editing = false; render(); });
        return;
      }

      const course = this._data.course;
      const today = this._todayKey();
      const plan = todayPlan(course, this._data.taken, today);

      const header = h('div', {
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px',
      });
      header.appendChild(h('div', {
        fontSize: '14px', fontWeight: '600', color: 'var(--foreground, #111827)',
      }, course.name || '用藥記錄'));
      if (plan.status === 'active') {
        header.appendChild(h('div', {
          fontSize: '13px', color: 'var(--foreground-muted, #6b7280)', whiteSpace: 'nowrap',
        }, '第 ' + plan.dayIndex + ' / ' + plan.days + ' 天'));
      }
      container.appendChild(header);

      if (plan.status === 'before') {
        container.appendChild(h('div', {
          fontSize: '13px', color: 'var(--foreground-muted, #6b7280)',
        }, '療程 ' + shortDate(course.startDate) + ' 開始'));
      } else if (plan.status === 'after') {
        container.appendChild(h('div', {
          fontSize: '13px', color: 'var(--foreground-muted, #6b7280)',
        }, '療程已結束，共 ' + course.days + ' 天'));
      } else if (plan.status === 'active') {
        const list = h('div', { display: 'flex', flexDirection: 'column', gap: '6px' });
        for (const sp of plan.slots) {
          const row = h('label', {
            display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
          });
          row.appendChild(makeCheckbox(sp.taken, (checked) => this._setTaken(today, sp.slot, checked)));
          row.appendChild(h('span', {
            width: '32px', fontSize: '14px', color: 'var(--foreground, #111827)',
          }, sp.label));
          const dose = h('span', {
            flex: '1', fontSize: '13px',
            color: sp.taken ? 'var(--foreground-muted, #6b7280)' : 'var(--foreground, #111827)',
            textDecoration: sp.taken ? 'line-through' : 'none',
          }, sp.dose || '');
          row.appendChild(dose);
          list.appendChild(row);
        }
        container.appendChild(list);

        const doneToday = plan.slots.filter((x) => x.taken).length;
        container.appendChild(h('div', {
          fontSize: '13px', color: 'var(--foreground-muted, #6b7280)',
        }, '今天 ' + doneToday + ' / ' + plan.slots.length + ' 劑'));
      }

      const footer = h('div', { display: 'flex', gap: '8px', marginTop: '2px' });
      const allBtn = makeButton('全部', false);
      allBtn.style.flex = '1';
      allBtn.addEventListener('click', () => { if (this._view) this._view.open(); });
      const setBtn = makeButton('設定', false);
      setBtn.style.flex = '1';
      setBtn.addEventListener('click', () => { editing = true; render(); });
      footer.appendChild(allBtn);
      footer.appendChild(setBtn);
      container.appendChild(footer);
    };

    const unregister = this._registerRender(render);
    render();
    return () => { unregister(); };
  }

  /* 側邊欄全螢幕：整段療程表格。 */
  _mountView(container) {
    let editing = false;

    const render = () => {
      // 打勾會整張重繪，先存住捲動位置，重繪後還原，免得跳回頂端。
      const prevScroll = container.scrollTop;
      container.replaceChildren();
      Object.assign(container.style, {
        height: '100%', overflow: 'auto', boxSizing: 'border-box',
        padding: '24px', color: 'var(--foreground, #111827)',
      });

      const course = this._data.course;
      if (!course || editing) {
        const wrap = h('div', { maxWidth: '420px', margin: '0 auto' });
        container.appendChild(wrap);
        this._mountSetupForm(wrap, () => { editing = false; render(); });
        return;
      }

      const today = this._todayKey();
      const dates = courseDates(course);
      const slots = enabledSlots(course);
      const totals = countDoses(course, this._data.taken);

      const head = h('div', {
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: '12px', marginBottom: '16px',
      });
      const headLeft = h('div', { display: 'flex', flexDirection: 'column', gap: '4px' });
      headLeft.appendChild(h('div', { fontSize: '18px', fontWeight: '600' }, course.name || '用藥記錄'));
      headLeft.appendChild(h('div', {
        fontSize: '13px', color: 'var(--foreground-muted, #6b7280)',
      }, shortDate(course.startDate) + ' 至 ' + shortDate(dates[dates.length - 1]) + '，共 ' + course.days + ' 天'));
      head.appendChild(headLeft);
      const editBtn = makeButton('設定', false);
      editBtn.addEventListener('click', () => { editing = true; render(); });
      head.appendChild(editBtn);
      container.appendChild(head);

      const progWrap = h('div', { marginBottom: '20px' });
      progWrap.appendChild(h('div', {
        fontSize: '13px', color: 'var(--foreground-muted, #6b7280)', marginBottom: '6px',
      }, '整體進度 ' + totals.done + ' / ' + totals.total + ' 劑'));
      const bar = h('div', {
        height: '8px', borderRadius: '4px',
        background: 'var(--border, #e5e7eb)', overflow: 'hidden',
      });
      const pct = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;
      bar.appendChild(h('div', { height: '100%', width: pct + '%', background: 'var(--foreground, #111827)' }));
      progWrap.appendChild(bar);
      container.appendChild(progWrap);

      if (slots.length === 0) {
        container.appendChild(h('div', {
          fontSize: '14px', color: 'var(--foreground-muted, #6b7280)',
        }, '尚未設定任何用藥時段，點右上角設定'));
        return;
      }

      const table = h('table', { borderCollapse: 'collapse', width: '100%', fontSize: '13px' });
      const thead = document.createElement('thead');
      const htr = document.createElement('tr');
      htr.appendChild(thCell('日期'));
      for (const s of slots) {
        const dose = course.slots[s].dose ? ' · ' + course.slots[s].dose : '';
        htr.appendChild(thCell(SLOT_LABELS[s] + dose));
      }
      thead.appendChild(htr);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
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
          const rec = this._data.taken[dk] || {};
          cell.appendChild(makeCheckbox(!!rec[s], (checked) => this._setTaken(dk, s, checked)));
          tr.appendChild(cell);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      container.appendChild(table);
      container.scrollTop = prevScroll;
    };

    const unregister = this._registerRender(render);
    render();
    return () => { unregister(); };
  }
}

module.exports = MedicationPlugin;
Object.assign(module.exports, {
  SLOTS, SLOT_LABELS, toLocalDateKey, addDays, enabledSlots, courseDates,
  dayIndexOf, countDoses, courseStatus, todayPlan, remainingToday,
});
