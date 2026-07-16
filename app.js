const STORAGE_KEYS = {
  settings: 'budget.settings',
  expenses: 'budget.expenses',
  travel: 'budget.travel',
};

function todayStr() {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

function loadSettings() {
  const raw = localStorage.getItem(STORAGE_KEYS.settings);
  const defaults = { dailyAllowance: 0, startDate: todayStr(), mealBudget: 0 };
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

// Days "billable" within monthDate's month, clamped to [startDate, today].
// Past months count in full (from startDate if later than month start); future months count as 0.
function daysElapsedInMonth(startDate, monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const start = new Date(startDate + 'T00:00:00');
  const today = new Date(todayStr() + 'T00:00:00');

  if (monthStart > today) return 0;

  const effectiveStart = start > monthStart ? start : monthStart;
  const effectiveEnd = today < monthEnd ? today : monthEnd;
  if (effectiveStart > effectiveEnd) return 0;

  return Math.floor((effectiveEnd - effectiveStart) / 86400000) + 1;
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
const dailyAllowanceInput = document.getElementById('dailyAllowanceInput');
const startDateInput = document.getElementById('startDateInput');
const mealBudgetInput = document.getElementById('mealBudgetInput');
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

let selectedDate = todayStr();
let calendarMonth = new Date(`${selectedDate}T00:00:00`);
calendarMonth.setDate(1);

function renderCalendar(expenses) {
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
  dailyAllowanceInput.value = settings.dailyAllowance;
  startDateInput.value = settings.startDate;
  mealBudgetInput.value = settings.mealBudget;

  const expenses = loadRecords(STORAGE_KEYS.expenses);
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const key = monthKey(year, month);
  const monthExpenses = expenses.filter((e) => e.date.startsWith(key));

  const days = daysElapsedInMonth(settings.startDate, calendarMonth);
  const totalAllowance = days * Number(settings.dailyAllowance || 0);
  const dailySpent = monthExpenses
    .filter((e) => (e.category || 'daily') !== 'meal')
    .reduce((sum, e) => sum + Number(e.amount), 0);
  const balance = totalAllowance - dailySpent;

  balanceLabelEl.textContent = `${year}年${month + 1}月 累積額度`;
  balanceAmountEl.textContent = formatMoney(balance);
  balanceAmountEl.classList.toggle('negative', balance < 0);
  balanceDetailEl.textContent = `已累積 ${days} 天 x $${settings.dailyAllowance} = $${formatMoney(totalAllowance)}，已花費 $${formatMoney(dailySpent)}`;

  const mealSpent = monthExpenses
    .filter((e) => (e.category || 'daily') === 'meal')
    .reduce((sum, e) => sum + Number(e.amount), 0);
  const mealBalance = Number(settings.mealBudget || 0) - mealSpent;

  mealBalanceLabelEl.textContent = `${year}年${month + 1}月 大餐額度`;
  mealBalanceAmountEl.textContent = formatMoney(mealBalance);
  mealBalanceAmountEl.classList.toggle('negative', mealBalance < 0);
  mealBalanceDetailEl.textContent = `本月額度 $${formatMoney(Number(settings.mealBudget || 0))}，已花費 $${formatMoney(mealSpent)}`;

  renderCalendar(expenses);

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
    dailyAllowance: Number(dailyAllowanceInput.value || 0),
    startDate: startDateInput.value || todayStr(),
    mealBudget: Number(mealBudgetInput.value || 0),
  });
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
