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
    payday: 1,
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

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function clampPayday(year, month, payday) {
  return Math.min(payday, daysInMonth(year, month));
}

// Pay period containing dateStr: starts on `payday` of a month, ends the day before
// the next occurrence of `payday`. Clamped to the last day of shorter months.
function getPeriodForDate(dateStr, payday) {
  const date = new Date(dateStr + 'T00:00:00');
  const year = date.getFullYear();
  const month = date.getMonth();
  const thisMonthPayday = clampPayday(year, month, payday);

  let startYear = year;
  let startMonth = month;
  if (date.getDate() < thisMonthPayday) {
    startMonth -= 1;
    if (startMonth < 0) {
      startMonth = 11;
      startYear -= 1;
    }
  }
  const start = new Date(startYear, startMonth, clampPayday(startYear, startMonth, payday));

  let endYear = startYear;
  let endMonth = startMonth + 1;
  if (endMonth > 11) {
    endMonth = 0;
    endYear += 1;
  }
  const end = new Date(endYear, endMonth, clampPayday(endYear, endMonth, payday));
  end.setDate(end.getDate() - 1);

  return { start, end };
}

function getPreviousPeriodRange(payday) {
  const currentPeriod = getPeriodForDate(todayStr(), payday);
  const prevEnd = new Date(currentPeriod.start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  return getPeriodForDate(toDateStr(prevEnd), payday);
}

function formatRangeLabel(range) {
  const s = `${range.start.getMonth() + 1}/${range.start.getDate()}`;
  const e = `${range.end.getMonth() + 1}/${range.end.getDate()}`;
  return `${s}～${e}`;
}

// Billable range within the pay period containing today, clamped to [startDate, yesterday].
// Today itself isn't counted yet — a day's spending only locks in once it's over.
function getBillableRange(startDate, payday) {
  const today = new Date(todayStr() + 'T00:00:00');
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const period = getPeriodForDate(todayStr(), payday);
  const start = new Date(startDate + 'T00:00:00');

  const effectiveStart = start > period.start ? start : period.start;
  const effectiveEnd = yesterday < period.end ? yesterday : period.end;
  if (effectiveStart > effectiveEnd) return null;

  return { start: effectiveStart, end: effectiveEnd };
}

function expensesInRange(expenses, range) {
  if (!range) return [];
  const startStr = toDateStr(range.start);
  const endStr = toDateStr(range.end);
  return expenses.filter((e) => e.date >= startStr && e.date <= endStr);
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
const paydayInput = document.getElementById('paydayInput');
const workAllowanceInput = document.getElementById('workAllowanceInput');
const offAllowanceInput = document.getElementById('offAllowanceInput');
const mealBudgetInput = document.getElementById('mealBudgetInput');
const shiftAnchorInput = document.getElementById('shiftAnchorInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const balanceLabelEl = document.getElementById('balanceLabel');
const balanceAmountEl = document.getElementById('balanceAmount');
const balanceDetailEl = document.getElementById('balanceDetail');
const prevPeriodInfoEl = document.getElementById('prevPeriodInfo');
const mealBalanceLabelEl = document.getElementById('mealBalanceLabel');
const mealBalanceAmountEl = document.getElementById('mealBalanceAmount');
const mealBalanceDetailEl = document.getElementById('mealBalanceDetail');
const prevMealPeriodInfoEl = document.getElementById('prevMealPeriodInfo');
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
  const totalDaysInMonth = daysInMonth(year, month);
  const startOffset = firstDay.getDay(); // 0 = Sunday

  calendarGrid.innerHTML = '';

  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell empty';
    calendarGrid.appendChild(empty);
  }

  for (let day = 1; day <= totalDaysInMonth; day++) {
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
  paydayInput.value = settings.payday;
  workAllowanceInput.value = settings.workAllowance;
  offAllowanceInput.value = settings.offAllowance;
  mealBudgetInput.value = settings.mealBudget;
  shiftAnchorInput.value = settings.shiftAnchorDate;
  document.querySelector(`input[name="shiftAnchorType"][value="${settings.shiftAnchorType}"]`).checked = true;

  const expenses = loadRecords(STORAGE_KEYS.expenses);
  const period = getPeriodForDate(todayStr(), settings.payday);
  const range = getBillableRange(settings.startDate, settings.payday);
  const periodExpenses = expensesInRange(expenses, range);

  const { total: totalAllowance, days, workDays, offDays } = sumAllowanceForRange(range, settings, overrides);
  const dailySpent = periodExpenses
    .filter((e) => (e.category || 'daily') !== 'meal')
    .reduce((sum, e) => sum + Number(e.amount), 0);
  const balance = totalAllowance - dailySpent;

  balanceLabelEl.textContent = `本期累積額度（${formatRangeLabel(period)}）`;
  balanceAmountEl.textContent = formatMoney(balance);
  balanceAmountEl.classList.toggle('negative', balance < 0);
  balanceDetailEl.textContent = `已累積至前一天共 ${days} 天（上班 ${workDays} 天 x $${settings.workAllowance} + 休假 ${offDays} 天 x $${settings.offAllowance}）= $${formatMoney(totalAllowance)}，已花費 $${formatMoney(dailySpent)}`;

  const mealSpent = periodExpenses
    .filter((e) => (e.category || 'daily') === 'meal')
    .reduce((sum, e) => sum + Number(e.amount), 0);
  const mealBalance = Number(settings.mealBudget || 0) - mealSpent;

  mealBalanceLabelEl.textContent = `本期大餐額度（${formatRangeLabel(period)}）`;
  mealBalanceAmountEl.textContent = formatMoney(mealBalance);
  mealBalanceAmountEl.classList.toggle('negative', mealBalance < 0);
  mealBalanceDetailEl.textContent = `本期額度 $${formatMoney(Number(settings.mealBudget || 0))}，已花費（至前一天）$${formatMoney(mealSpent)}`;

  const isPayday = toDateStr(period.start) === todayStr();
  prevPeriodInfoEl.textContent = '';
  prevPeriodInfoEl.classList.remove('negative', 'positive');
  prevMealPeriodInfoEl.textContent = '';
  prevMealPeriodInfoEl.classList.remove('negative', 'positive');

  if (isPayday) {
    const prevPeriod = getPreviousPeriodRange(settings.payday);
    const prevExpenses = expensesInRange(expenses, prevPeriod);
    const prevDailySpent = prevExpenses
      .filter((e) => (e.category || 'daily') !== 'meal')
      .reduce((sum, e) => sum + Number(e.amount), 0);
    const prevAllowance = sumAllowanceForRange(prevPeriod, settings, overrides);
    const prevBalance = prevAllowance.total - prevDailySpent;
    prevPeriodInfoEl.textContent = `上一期（${formatRangeLabel(prevPeriod)}）結餘：$${formatMoney(prevBalance)}`;
    prevPeriodInfoEl.classList.toggle('negative', prevBalance < 0);
    prevPeriodInfoEl.classList.toggle('positive', prevBalance >= 0);

    const prevMealSpent = prevExpenses
      .filter((e) => (e.category || 'daily') === 'meal')
      .reduce((sum, e) => sum + Number(e.amount), 0);
    const prevMealBalance = Number(settings.mealBudget || 0) - prevMealSpent;
    prevMealPeriodInfoEl.textContent = `上一期（${formatRangeLabel(prevPeriod)}）結餘：$${formatMoney(prevMealBalance)}`;
    prevMealPeriodInfoEl.classList.toggle('negative', prevMealBalance < 0);
    prevMealPeriodInfoEl.classList.toggle('positive', prevMealBalance >= 0);
  }

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
  const payday = Math.min(31, Math.max(1, Number(paydayInput.value || 1)));
  saveSettings({
    startDate: startDateInput.value || todayStr(),
    payday,
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
