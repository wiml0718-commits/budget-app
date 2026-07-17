const STORAGE_KEYS = {
  settings: 'budget.settings',
  expenses: 'budget.expenses',
  travel: 'budget.travel',
  dayTypeOverrides: 'budget.dayTypeOverrides',
};

function toDateStr(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function todayStr() {
  return toDateStr(new Date());
}

function loadSettings() {
  const raw = localStorage.getItem(STORAGE_KEYS.settings);
  const defaults = {
    startDate: todayStr(),
    workAllowance: 0,
    offAllowance: 0,
    mealBudget: 0,
    shiftAnchorDate: todayStr(),
    shiftAnchorType: 'off',
  };
  if (raw) return { ...defaults, ...JSON.parse(raw) };
  return defaults;
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

function loadRecords(key) {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : [];
}

function saveRecords(key, records) {
  localStorage.setItem(key, JSON.stringify(records));
}

function loadOverrides() {
  const raw = localStorage.getItem(STORAGE_KEYS.dayTypeOverrides);
  return raw ? JSON.parse(raw) : {};
}

function saveOverrides(overrides) {
  localStorage.setItem(STORAGE_KEYS.dayTypeOverrides, JSON.stringify(overrides));
}

// 2-on/2-off rotation relative to the anchor date; anchor's own type is shiftAnchorType.
function computeShiftType(dateStr, anchorDate, anchorType) {
  const date = new Date(dateStr + 'T00:00:00');
  const anchor = new Date(anchorDate + 'T00:00:00');
  const diffDays = Math.round((date - anchor) / 86400000);
  const mod = ((diffDays % 4) + 4) % 4;
  const isAnchorPhase = mod === 0 || mod === 1;
  const otherType = anchorType === 'work' ? 'off' : 'work';
  return isAnchorPhase ? anchorType : otherType;
}

function getDayType(dateStr, settings, overrides) {
  return overrides[dateStr] || computeShiftType(dateStr, settings.shiftAnchorDate, settings.shiftAnchorType);
}

// Billable date range within monthDate's month, clamped to [startDate, today].
// Past months count in full (from startDate if later than month start); future months are null.
function getBillableRange(startDate, monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const start = new Date(startDate + 'T00:00:00');
  const today = new Date(todayStr() + 'T00:00:00');

  if (monthStart > today) return null;

  const effectiveStart = start > monthStart ? start : monthStart;
  const effectiveEnd = today < monthEnd ? today : monthEnd;
  if (effectiveStart > effectiveEnd) return null;

  return { start: effectiveStart, end: effectiveEnd };
}

function sumAllowanceForRange(range, settings, overrides) {
  const result = { total: 0, days: 0, workDays: 0, offDays: 0 };
  if (!range) return result;

  for (let d = new Date(range.start); d <= range.end; d.setDate(d.getDate() + 1)) {
    const type = getDayType(toDateStr(d), settings, overrides);
    if (type === 'work') {
      result.total += Number(settings.workAllowance || 0);
      result.workDays++;
    } else {
      result.total += Number(settings.offAllowance || 0);
      result.offDays++;
    }
    result.days++;
  }
  return result;
}

function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function formatMoney(n) {
  return n.toLocaleString('zh-TW');
}

// ---- Tabs ----
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// ---- Daily budget ----
const startDateInput = document.getElementById('startDateInput');
const workAllowanceInput = document.getElementById('workAllowanceInput');
const offAllowanceInput = document.getElementById('offAllowanceInput');
const mealBudgetInput = document.getElementById('mealBudgetInput');
const shiftAnchorInput = document.getElementById('shiftAnchorInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const balanceLabelEl = document.getElementById('balanceLabel');
const balanceAmountEl = document.getElementById('balanceAmount');
const balanceDetailEl = document.getElementById('balanceDetail');
const mealBalanceLabelEl = document.getElementById('mealBalanceLabel');
const mealBalanceAmountEl = document.getElementById('mealBalanceAmount');
const mealBalanceDetailEl = document.getElementById('mealBalanceDetail');
const expenseForm = document.getElementById('expenseForm');
const expenseDate = document.getElementById('expenseDate');
const expenseAmount = document.getElementById('expenseAmount');
const expenseNote = document.getElementById('expenseNote');
const expenseList = document.getElementById('expenseList');
const calendarTitle = document.getElementById('calendarTitle');
const calendarGrid = document.getElementById('calendarGrid');
const selectedDayLabel = document.getElementById('selectedDayLabel');
const prevMonthBtn = document.getElementById('prevMonthBtn');
const nextMonthBtn = document.getElementById('nextMonthBtn');
const shiftStatusLabel = document.getElementById('shiftStatusLabel');
const shiftWorkBtn = document.getElementById('shiftWorkBtn');
const shiftOffBtn = document.getElementById('shiftOffBtn');
const shiftResetBtn = document.getElementById('shiftResetBtn');

let selectedDate = todayStr();
let calendarMonth = new Date(`${selectedDate}T00:00:00`);
calendarMonth.setDate(1);

function renderCalendar(expenses, settings, overrides) {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  calendarTitle.textContent = `${year}年${month + 1}月`;

  const dailySpentByDate = {};
  const mealSpentByDate = {};
  expenses.forEach((e) => {
    if ((e.category || 'daily') === 'meal') {
      mealSpentByDate[e.date] = (mealSpentByDate[e.date] || 0) + Number(e.amount);
    } else {
      dailySpentByDate[e.date] = (dailySpentByDate[e.date] || 0) + Number(e.amount);
    }
  });

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstDay.getDay(); // 0 = Sunday

  calendarGrid.innerHTML = '';

  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell empty';
    calendarGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    if (dateStr === todayStr()) cell.classList.add('today');
    if (dateStr === selectedDate) cell.classList.add('selected');
    if (getDayType(dateStr, settings, overrides) === 'off') cell.classList.add('shift-off');
    if (overrides[dateStr]) cell.classList.add('shift-override');

    const spent = dailySpentByDate[dateStr];
    const mealSpent = mealSpentByDate[dateStr];
    cell.innerHTML = `
      <span class="cal-day-num">${day}</span>
      ${spent ? `<span class="cal-spent">$${formatMoney(spent)}</span>` : ''}
      ${mealSpent ? `<span class="cal-spent-meal">$${formatMoney(mealSpent)}</span>` : ''}`;

    cell.addEventListener('click', () => {
      selectedDate = dateStr;
      expenseDate.value = dateStr;
      renderDaily();
    });
    calendarGrid.appendChild(cell);
  }
}

function renderDaily() {
  const settings = loadSettings();
  const overrides = loadOverrides();
  startDateInput.value = settings.startDate;
  workAllowanceInput.value = settings.workAllowance;
  offAllowanceInput.value = settings.offAllowance;
  mealBudgetInput.value = settings.mealBudget;
  shiftAnchorInput.value = settings.shiftAnchorDate;
  document.querySelector(`input[name="shiftAnchorType"][value="${settings.shiftAnchorType}"]`).checked = true;

  const expenses = loadRecords(STORAGE_KEYS.expenses);
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const key = monthKey(year, month);
  const monthExpenses = expenses.filter((e) => e.date.startsWith(key));

  const range = getBillableRange(settings.startDate, calendarMonth);
  const { total: totalAllowance, days, workDays, offDays } = sumAllowanceForRange(range, settings, overrides);
  const dailySpent = monthExpenses
    .filter((e) => (e.category || 'daily') !== 'meal')
    .reduce((sum, e) => sum + Number(e.amount), 0);
  const balance = totalAllowance - dailySpent;

  balanceLabelEl.textContent = `${year}年${month + 1}月 累積額度`;
  balanceAmountEl.textContent = formatMoney(balance);
  balanceAmountEl.classList.toggle('negative', balance < 0);
  balanceDetailEl.textContent = `已累積 ${days} 天（上班 ${workDays} 天 x $${settings.workAllowance} + 休假 ${offDays} 天 x $${settings.offAllowance}）= $${formatMoney(totalAllowance)}，已花費 $${formatMoney(dailySpent)}`;

  const mealSpent = monthExpenses
    .filter((e) => (e.category || 'daily') === 'meal')
    .reduce((sum, e) => sum + Number(e.amount), 0);
  const mealBalance = Number(settings.mealBudget || 0) - mealSpent;

  mealBalanceLabelEl.textContent = `${year}年${month + 1}月 大餐額度`;
  mealBalanceAmountEl.textContent = formatMoney(mealBalance);
  mealBalanceAmountEl.classList.toggle('negative', mealBalance < 0);
  mealBalanceDetailEl.textContent = `本月額度 $${formatMoney(Number(settings.mealBudget || 0))}，已花費 $${formatMoney(mealSpent)}`;

  renderCalendar(expenses, settings, overrides);

  const selectedType = getDayType(selectedDate, settings, overrides);
  const isOverridden = Boolean(overrides[selectedDate]);
  shiftStatusLabel.textContent = `${selectedDate}：${selectedType === 'work' ? '上班' : '休假'}${isOverridden ? '（手動）' : '（自動）'}`;
  shiftResetBtn.disabled = !isOverridden;

  selectedDayLabel.textContent = `${selectedDate} 花費`;
  const dayExpenses = expenses.filter((e) => e.date === selectedDate);
  expenseList.innerHTML = '';
  if (dayExpenses.length === 0) {
    expenseList.innerHTML = '<li class="empty-hint">這天尚無花費紀錄</li>';
  } else {
    dayExpenses.forEach((e) => {
      const isMeal = (e.category || 'daily') === 'meal';
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="record-info">
          <span>${e.note || '（無備註）'}${isMeal ? '<span class="record-tag">大餐</span>' : ''}</span>
        </div>
        <div>
          <span class="record-amount ${isMeal ? 'category-meal' : 'category-daily'}">$${formatMoney(Number(e.amount))}</span>
          <button class="delete-btn" data-id="${e.id}">✕</button>
        </div>`;
      li.querySelector('.delete-btn').addEventListener('click', () => {
        const updated = loadRecords(STORAGE_KEYS.expenses).filter((x) => x.id !== e.id);
        saveRecords(STORAGE_KEYS.expenses, updated);
        renderDaily();
      });
      expenseList.appendChild(li);
    });
  }
}

prevMonthBtn.addEventListener('click', () => {
  calendarMonth.setMonth(calendarMonth.getMonth() - 1);
  renderDaily();
});

nextMonthBtn.addEventListener('click', () => {
  calendarMonth.setMonth(calendarMonth.getMonth() + 1);
  renderDaily();
});

saveSettingsBtn.addEventListener('click', () => {
  saveSettings({
    startDate: startDateInput.value || todayStr(),
    workAllowance: Number(workAllowanceInput.value || 0),
    offAllowance: Number(offAllowanceInput.value || 0),
    mealBudget: Number(mealBudgetInput.value || 0),
    shiftAnchorDate: shiftAnchorInput.value || todayStr(),
    shiftAnchorType: document.querySelector('input[name="shiftAnchorType"]:checked').value,
  });
  renderDaily();
});

function setDayOverride(dateStr, type) {
  const overrides = loadOverrides();
  overrides[dateStr] = type;
  saveOverrides(overrides);
  renderDaily();
}

shiftWorkBtn.addEventListener('click', () => setDayOverride(selectedDate, 'work'));
shiftOffBtn.addEventListener('click', () => setDayOverride(selectedDate, 'off'));
shiftResetBtn.addEventListener('click', () => {
  const overrides = loadOverrides();
  delete overrides[selectedDate];
  saveOverrides(overrides);
  renderDaily();
});

expenseForm.addEventListener('submit', (evt) => {
  evt.preventDefault();
  const category = document.querySelector('input[name="expenseCategory"]:checked').value;
  const records = loadRecords(STORAGE_KEYS.expenses);
  records.push({
    id: crypto.randomUUID(),
    date: expenseDate.value,
    amount: Number(expenseAmount.value),
    note: expenseNote.value.trim(),
    category,
  });
  saveRecords(STORAGE_KEYS.expenses, records);
  selectedDate = expenseDate.value;
  calendarMonth = new Date(`${selectedDate}T00:00:00`);
  calendarMonth.setDate(1);
  expenseForm.reset();
  expenseDate.value = selectedDate;
  renderDaily();
});

// ---- Travel fund ----
const travelForm = document.getElementById('travelForm');
const travelDate = document.getElementById('travelDate');
const travelAmount = document.getElementById('travelAmount');
const travelNote = document.getElementById('travelNote');
const travelList = document.getElementById('travelList');
const travelTotalEl = document.getElementById('travelTotal');

function renderTravel() {
  const records = loadRecords(STORAGE_KEYS.travel);
  const total = records.reduce((sum, r) => sum + Number(r.amount), 0);
  travelTotalEl.textContent = formatMoney(total);

  travelList.innerHTML = '';
  if (records.length === 0) {
    travelList.innerHTML = '<li class="empty-hint">尚無基金紀錄</li>';
  } else {
    [...records]
      .sort((a, b) => b.date.localeCompare(a.date))
      .forEach((r) => {
        const li = document.createElement('li');
        li.innerHTML = `
          <div class="record-info">
            <span>${r.note || '（無備註）'}</span>
            <span class="record-date">${r.date}</span>
          </div>
          <div>
            <span class="record-amount positive">$${formatMoney(Number(r.amount))}</span>
            <button class="delete-btn" data-id="${r.id}">✕</button>
          </div>`;
        li.querySelector('.delete-btn').addEventListener('click', () => {
          const updated = loadRecords(STORAGE_KEYS.travel).filter((x) => x.id !== r.id);
          saveRecords(STORAGE_KEYS.travel, updated);
          renderTravel();
        });
        travelList.appendChild(li);
      });
  }
}

travelForm.addEventListener('submit', (evt) => {
  evt.preventDefault();
  const records = loadRecords(STORAGE_KEYS.travel);
  records.push({
    id: crypto.randomUUID(),
    date: travelDate.value,
    amount: Number(travelAmount.value),
    note: travelNote.value.trim(),
  });
  saveRecords(STORAGE_KEYS.travel, records);
  travelForm.reset();
  travelDate.value = todayStr();
  renderTravel();
});

// ---- Init ----
expenseDate.value = todayStr();
travelDate.value = todayStr();
renderDaily();
renderTravel();
