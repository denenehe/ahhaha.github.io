// --- FIREBASE CONFIG ---
const firebaseConfig = {
  apiKey: "AIzaSyDRWum4vdyATWOJbAYpFCru-my7rQdw-Ss",
  authDomain: "cafe-90be8.firebaseapp.com",
  databaseURL: "https://cafe-90be8-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "cafe-90be8",
  storageBucket: "cafe-90be8.firebasestorage.app",
  messagingSenderId: "315040770744",
  appId: "1:315040770744:web:723a11d987480b1fbf624d",
};

let db;
let adminConfig = {};
let configReady = false;

// Dirty tracking (opsiyonel)
let dirty = { settings: false, products: new Set() };
let productsCache = {};

// Admin login refs
let adminLoginScreen, adminPanel;
let adminPasswordInput, adminLoginButton, adminLoginError, loginStatus;

// Admin panel refs
let tableListContainer, productListContainer;
let coffeehouseNameInput, loginToggle, userPasswordInput, adminPasswordChangeInput;
let unsavedBanner, saveAllBtn, discardAllBtn;

// Monthly analysis
const MONTH_NAMES = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
let aggregates = {};
let availableYears = [];
let selectedYear = null;
let selectedMonth = null;
let monthlyChart = null;

let revenuesCache = {}; // archive/revenues
let salesCache = {};    // archive/sales

// THEME (grafiklerle senkron)
const THEMES = ['light','dark','latte','forest','contrast'];
function getCssVar(name, fallback='#000'){ try{ return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; }catch{ return fallback; } }
function syncChartTheme(){
  if (typeof Chart === 'undefined') return;
  const text = getCssVar('--text', '#111');
  const grid = getCssVar('--border', '#e5e7eb');
  Chart.defaults.color = text;
  Chart.defaults.borderColor = grid;
  if (monthlyChart){
    monthlyChart.options.scales.x.ticks.color = text;
    monthlyChart.options.scales.y.ticks.color = text;
    monthlyChart.options.scales.x.grid.color  = grid;
    monthlyChart.options.scales.y.grid.color  = grid;
    if (monthlyChart.options.plugins?.legend?.labels) monthlyChart.options.plugins.legend.labels.color = text;
    if (monthlyChart.options.plugins?.tooltip){ monthlyChart.options.plugins.tooltip.titleColor = text; monthlyChart.options.plugins.tooltip.bodyColor = text; }
    monthlyChart.update('none');
  }
}
function applyTheme(t){ document.documentElement.setAttribute('data-theme', t); try{ localStorage.setItem('theme', t); }catch{} syncChartTheme(); }
function initTheme(){ let t='light'; try{ t = localStorage.getItem('theme') || 'light'; }catch{} if(!THEMES.includes(t)) t='light'; applyTheme(t); }

// ---------- Helpers ----------
function qs(id){ return document.getElementById(id); }
function extractNumber(str, fallback = 0) { const m = String(str || '').match(/(\d+)/); return m ? parseInt(m[1], 10) : fallback; }
function tableSort([idA, tblA], [idB, tblB]) {
  const numA = extractNumber(tblA?.name, extractNumber(idA, 0));
  const numB = extractNumber(tblB?.name, extractNumber(idB, 0));
  return numA - numB;
}

// (Sadece eski kayıtları doğrulamak için) SHA-256 -> hex
async function sha256Hex(text){
  if (crypto?.subtle){
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
  }
  return null;
}

/** Şifre doğrulama:
 * - DB "sha:" / "sha256:" ile başlıyorsa: hash karşılaştır
 * - "plain:" ile başlıyorsa: düz karşılaştır (prefix'i at)
 * - prefix yoksa: düz karşılaştır (DB’de ne yazıyorsa o)
 */
async function verifyPassword(entered, stored){
  if (!stored) return false;
  const s = String(stored);
  if (s.startsWith('sha:') || s.startsWith('sha256:')){
    const digest = s.replace(/^sha256?:/,'');
    const enteredDigest = await sha256Hex(entered);
    return !!enteredDigest && enteredDigest === digest;
  }
  if (s.startsWith('plain:')) return entered === s.slice(6);
  return entered === s; // düz metin
}

function money(n){ n = Number(n || 0); return n.toLocaleString('tr-TR', { style:'currency', currency:'TRY', minimumFractionDigits:2 }); }
function fmtDateTR(d){ return d.toLocaleDateString('tr-TR', { day:'2-digit', month:'long', year:'numeric' }); }

// Gün yardımcıları
function todayKey(d = new Date()){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function isSameDay(ts, ref = new Date()){ const d = new Date(Number(ts||0)); return d.getFullYear()===ref.getFullYear() && d.getMonth()===ref.getMonth() && d.getDate()===ref.getDate(); }
function openResetModal(){ const m = qs('reset-modal'); if (m) m.style.display='flex'; }
function closeResetModal(){ const m=qs('reset-modal'); if (m) m.style.display='none'; const i=qs('reset-confirm-input'); if (i) i.value=''; const b=qs('reset-confirm-btn'); if (b) b.disabled=true; }
function endDayOpenConfirm(){ if (confirm('Günü bitirmek istiyor musunuz? Bugünkü veriler arşive kaydedilecek ve günlük sayfa sıfırlanacaktır.')) endDayArchiveAndClear(); }

// --- extra refs for monthly UI ---
let yearSelect, monthsRow, monthTotalEl, monthBestDayEl, monthBestProductEl, monthDailyListEl;

// ---------- Init & Auth ----------
function initAdmin(){
  db.ref('config').on('value', (snap)=>{ adminConfig = snap.val() || {}; configReady = true; setLoginStatus('Ayarlar yüklendi.'); },
                         (err)=> setLoginStatus('Ayarlar alınamadı: ' + (err?.message || err)));
}

async function handleAdminLogin(){
  if (!configReady) setLoginStatus('Ayarlar henüz hazır değil; giriş denemesi yapılıyor…');
  const pwd = adminPasswordInput?.value || '';
  const ok = await verifyPassword(pwd, adminConfig.adminPassword || '');
  if (ok){
    adminLoginScreen.style.display = 'none';
    adminPanel.classList.remove('hidden');
    adminLoginError.textContent = '';
    loadAdminPanelData();
  } else {
    if (!configReady || !adminConfig.adminPassword){
      adminLoginError.textContent = 'Şifre doğrulaması yapılamadı. Biraz sonra tekrar deneyin.';
      setLoginStatus('Ayarlar yüklenince giriş yapabilirsiniz.');
    } else {
      adminLoginError.textContent = 'Hatalı admin şifresi.';
    }
  }
}
function setLoginStatus(msg){ if (loginStatus) loginStatus.textContent = msg || ''; }

// ---------- Panel Data ----------
function loadAdminPanelData(){
  // General
  coffeehouseNameInput.value = adminConfig.coffeehouseName || '';
  loginToggle.checked = !!adminConfig.isLoginEnabled;
  // Güvenlik: alanları boş göster; doldurursan değişir
  userPasswordInput.value = '';
  adminPasswordChangeInput.value = '';

  // Tablolar
  db.ref('tables').on('value', snap => renderTableManagement(snap.val()));

  // Ürünler
  db.ref('products').on('value', snap => { productsCache = snap.val() || {}; renderProductManagement(productsCache); });

  // Günlük
  db.ref('dailyBook').on('value', snap => calculateDailyAnalysis(snap.val()));

  // Aylık (ARŞİV)
  db.ref('archive/revenues').on('value', snap => { revenuesCache = snap.val() || {}; rebuildAggregatesAndRender(); });
  db.ref('archive/sales').on('value', snap => { salesCache = snap.val() || {}; rebuildAggregatesAndRender(); });

  // Year selector change
  yearSelect.addEventListener('change', () => {
    selectedYear = Number(yearSelect.value);
    if (!Number.isFinite(selectedYear)) selectedYear = null;
    renderMonthsRow(); renderMonthlyChart(); renderMonthDetails();
  });

  // Buttons & events
  qs('save-settings-btn').addEventListener('click', () => saveGeneralSettings(true));
  qs('add-table-btn').addEventListener('click', addTable);
  qs('add-product-btn').addEventListener('click', addProduct); // <-- YENİ EKLENEN SATIR
  qs('end-day-btn').addEventListener('click', endDayOpenConfirm);
  qs('reset-daily-btn').addEventListener('click', openResetModal);

  // Reset modal içi
  qs('reset-cancel-btn').addEventListener('click', closeResetModal);
  qs('close-reset-modal').addEventListener('click', closeResetModal);
  qs('reset-confirm-input').addEventListener('input', (e)=>{ qs('reset-confirm-btn').disabled = (e.target.value.trim().toUpperCase() !== 'ONAYLA'); });
  qs('reset-confirm-btn').addEventListener('click', confirmHardResetToday);

  // Tema butonu (varsa)
  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) themeBtn.addEventListener('click', ()=>{ const cur=document.documentElement.getAttribute('data-theme')||'light'; const i=THEMES.indexOf(cur); applyTheme(THEMES[(i+1)%THEMES.length]); });

  // Settings değişikliği (banner)
  ;[coffeehouseNameInput, loginToggle, userPasswordInput, adminPasswordChangeInput].forEach(el=>{
    el.addEventListener('input', ()=>{ dirty.settings = true; updateUnsavedBanner(); });
    el.addEventListener('change', ()=>{ dirty.settings = true; updateUnsavedBanner(); });
  });

  // --- Event Delegation ---

  // Masa sil
  tableListContainer.addEventListener('click', (e)=>{
    const btn = e.target.closest('.remove-table-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;
    removeTable(id);
  });

  // Ürün güncelle/sil
  productListContainer.addEventListener('click', (e)=>{
    const saveBtn = e.target.closest('.save-product-btn');
    const delBtn  = e.target.closest('.remove-product-btn');
    if (saveBtn){
      const id = saveBtn.dataset.id;
      if (id) updateProduct(id, {silent:false});
    } else if (delBtn){
      const id = delBtn.dataset.id;
      if (id) removeProduct(id);
    }
  });
}

// ---------- DOM READY ----------
document.addEventListener('DOMContentLoaded', () => {
  initTheme(); // tema önce
  const app = firebase.initializeApp(firebaseConfig);
  db = firebase.database();

  // Cache DOM
  adminLoginScreen = qs('admin-login-screen');
  adminPanel = qs('admin-panel');
  adminPasswordInput = qs('admin-password-input');
  adminLoginButton = qs('admin-login-button');
  adminLoginError = qs('admin-login-error');
  loginStatus = qs('login-status');

  tableListContainer = qs('table-management-list');
  productListContainer = qs('product-management-list');

  coffeehouseNameInput = qs('coffeehouse-name-input');
  loginToggle = qs('login-toggle');
  userPasswordInput = qs('user-password-input');
  adminPasswordChangeInput = qs('admin-password-change-input');

  unsavedBanner = qs('unsaved-banner');
  saveAllBtn = qs('save-all-btn');
  discardAllBtn = qs('discard-all-btn');

  yearSelect = qs('year-select');
  monthsRow = qs('months-row');
  monthTotalEl = qs('month-total');
  monthBestDayEl = qs('month-best-day');
  monthBestProductEl = qs('month-best-product');
  monthDailyListEl = qs('month-daily-list');

  // Login handlers
  adminLoginButton.addEventListener('click', handleAdminLogin);
  adminPasswordInput.addEventListener('keyup', (e)=>{ if (e.key === 'Enter') handleAdminLogin(); });

  // Save/Discard toplu
  saveAllBtn.addEventListener('click', saveAllDirty);
  discardAllBtn.addEventListener('click', discardAllDirty);

  // Init
  initAdmin();
});

// ---------- Tables ----------
function renderTableManagement(tables){
  const c = tableListContainer; c.innerHTML = '';
  if (!tables) return;
  Object.entries(tables).sort(tableSort).forEach(([tableId, table])=>{
    const div = document.createElement('div');
    div.className = 'item-row table-item';
    div.innerHTML = `
      <span>${table.name}</span>
      <button class="danger-btn remove-table-btn" data-id="${tableId}">Kaldır</button>
    `;
    c.appendChild(div);
  });
}
function addTable(){
  const newTableId = `table${Date.now()}`;
  const count = tableListContainer.querySelectorAll('.item-row').length;
  db.ref(`tables/${newTableId}`).set({ name: `Masa ${count + 1}`, order: null, status: 'free' })
    .catch(e => alert(`Hata: ${e.message}`));
}
function removeTable(tableId){
  if (!tableId) return;
  if (confirm('Bu masayı silmek istediğinize emin misiniz?')){
    db.ref(`tables/${tableId}`).remove().catch(e=> alert(`Hata: ${e.message}`));
  }
}

// ---------- Products ----------
function renderProductManagement(products){
  const c = productListContainer; c.innerHTML = '';
  if (!products) return;
  Object.keys(products).forEach(productId=>{
    const p = products[productId] || {};
    const price = Number(p.price ?? 0);
    const stock = Number.isFinite(Number(p.stock)) ? Number(p.stock) : 0;
    const div = document.createElement('div');
    div.className = 'product-item item-row';
    div.dataset.productId = productId;
    div.innerHTML = `
      <div>
        <input type="text" value="${p.name ?? ''}" data-field="name" placeholder="Ad">
        <input type="number" value="${price.toFixed(2)}" data-field="price" placeholder="Fiyat" step="0.01">
        <input type="number" value="${stock}" data-field="stock" placeholder="Stok">
      </div>
      <div>
        <button class="save-product-btn" data-id="${productId}">Güncelle</button>
        <button class="danger-btn remove-product-btn" data-id="${productId}">Sil</button>
      </div>
    `;
    c.appendChild(div);
  });
}

// YENİ EKLENEN FONKSİYON
function addProduct() {
  const nameEl = qs('new-product-name');
  const priceEl = qs('new-product-price');
  const stockEl = qs('new-product-stock');

  const name = (nameEl.value || '').trim();
  const price = Number.parseFloat(priceEl.value);
  const stock = Number.parseInt(stockEl.value, 10);

  if (!name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(stock) || stock < 0) {
    alert('Lütfen geçerli bir ürün adı, fiyatı ve stok miktarı girin.');
    return;
  }

  const newProductId = `prod${Date.now()}`;
  const productData = { name, price, stock };

  db.ref(`products/${newProductId}`).set(productData)
    .then(() => {
      // Başarılı ekleme sonrası inputları temizle
      nameEl.value = '';
      priceEl.value = '';
      stockEl.value = '';
    })
    .catch(e => alert(`Hata: ${e.message}`));
}

function readProductRow(pid){
  const row = productListContainer.querySelector(`.product-item[data-product-id="${pid}"]`);
  if (!row) return null;
  const name  = (row.querySelector('input[data-field="name"]').value || '').trim();
  const price = Number.parseFloat(row.querySelector('input[data-field="price"]').value);
  const stock = Number.parseInt(row.querySelector('input[data-field="stock"]').value, 10);
  if (!name || !Number.isFinite(price) || !Number.isFinite(stock)) return null;
  return { name, price, stock };
}
function updateProduct(productId, {silent=true}={}){
  const payload = readProductRow(productId);
  if (!payload){ alert('Alanları doğru doldurun.'); return; }
  db.ref(`products/${productId}`).set(payload)
    .then(()=>{ if (!silent) alert('Ürün güncellendi.'); })
    .catch(e => alert(`Hata: ${e.message}`));
}
function removeProduct(productId){
  if (confirm('Bu ürünü silmek istiyor musunuz?')){
    db.ref(`products/${productId}`).remove()
      .catch(e => alert(`Hata: ${e.message}`));
  }
}

// ---------- Daily Analysis ----------
function calculateDailyAnalysis(dailyBook){
  const revenueEl = qs('total-revenue');
  const expensesEl = qs('total-expenses');
  const profitEl = qs('total-profit');
  const revenueObj = dailyBook?.revenue || {};
  const expensesObj = dailyBook?.expenses || {};
  const totalRevenue = Object.values(revenueObj).reduce((s, it) => s + Number(it?.amount || 0), 0);
  const totalExpenses = Object.values(expensesObj).reduce((s, it) => s + Number(it?.amount || 0), 0);
  revenueEl.textContent = totalRevenue.toFixed(2);
  expensesEl.textContent = totalExpenses.toFixed(2);
  profitEl.textContent = (totalRevenue - totalExpenses).toFixed(2);
}

// ---------- Monthly Analysis ----------
function rebuildAggregatesAndRender(){
  aggregates = {};
  const yearsSet = new Set();

  // Revenues
  Object.entries(revenuesCache || {}).forEach(([dayStr, r])=>{
    const ts = Number(r?.timestamp || 0);
    const amt = Number(r?.amount || 0);
    if ((!ts && !dayStr) || !Number.isFinite(amt)) return;
    const d = ts ? new Date(ts) : new Date(dayStr + 'T00:00:00');
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    yearsSet.add(y);
    if (!aggregates[y]) aggregates[y] = {};
    if (!aggregates[y][m]) aggregates[y][m] = { total:0, dayBuckets:{}, productQty:{} };
    aggregates[y][m].total += amt;
    const key = dayStr || d.toISOString().slice(0,10);
    aggregates[y][m].dayBuckets[key] = (aggregates[y][m].dayBuckets[key] || 0) + amt;
  });

  // Sales → best product by qty
  Object.values(salesCache || {}).forEach(s=>{
    const ts = Number(s?.timestamp || 0); if (!ts) return;
    const d = new Date(ts);
    const y = d.getFullYear(); const m = d.getMonth() + 1;
    yearsSet.add(y);
    if (!aggregates[y]) aggregates[y] = {};
    if (!aggregates[y][m]) aggregates[y][m] = { total:0, dayBuckets:{}, productQty:{} };
    if (!s.isCustom){
      const label = s.name || s.productId || 'Ürün';
      aggregates[y][m].productQty[label] = (aggregates[y][m].productQty[label] || 0) + Number(s.quantity || 0);
    }
  });

  availableYears = Array.from(yearsSet).sort((a,b)=>a-b);

  // Year select
  yearSelect.innerHTML = '';
  availableYears.forEach(y=>{ const opt=document.createElement('option'); opt.value=y; opt.textContent=y; yearSelect.appendChild(opt); });
  if (!selectedYear && availableYears.length){ selectedYear = availableYears.at(-1); yearSelect.value = String(selectedYear); }
  else if (selectedYear){ yearSelect.value = String(selectedYear); }

  if (!selectedMonth) selectedMonth = (new Date()).getMonth()+1;

  renderMonthsRow();
  renderMonthlyChart();
  renderMonthDetails();
}
function renderMonthsRow(){
  monthsRow.innerHTML = '';
  for (let i=1;i<=12;i++){
    const btn = document.createElement('button');
    btn.className = 'chip' + (i===selectedMonth ? ' active' : '');
    btn.textContent = MONTH_NAMES[i-1];
    btn.addEventListener('click', ()=>{ selectedMonth=i; renderMonthsRow(); renderMonthlyChart(); renderMonthDetails(); });
    monthsRow.appendChild(btn);
  }
}
function renderMonthlyChart(){
  const ctx = document.getElementById('monthly-chart'); if (!ctx) return;
  const data = new Array(12).fill(0);
  const yearAgg = aggregates[selectedYear] || {};
  for (let m=1;m<=12;m++) data[m-1] = Number(yearAgg[m]?.total || 0);

  if (monthlyChart){ monthlyChart.destroy(); monthlyChart = null; }

  const text = getCssVar('--text', '#000');
  const grid = getCssVar('--border', '#e5e7eb');

  monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: MONTH_NAMES, datasets: [{ label: `${selectedYear} Gelirleri`, data }] },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: text }, grid: { color: grid } },
        y: { beginAtZero: true, ticks: { color: text }, grid: { color: grid } }
      },
      plugins: {
        legend: { labels: { color: text } },
        tooltip: { titleColor: text, bodyColor: text }
      }
    }
  });
}
function renderMonthDetails(){
  const yearAgg = aggregates[selectedYear] || {};
  const agg = yearAgg[selectedMonth] || { total:0, dayBuckets:{}, productQty:{} };
  monthTotalEl.textContent = money(agg.total);

  if (Object.keys(agg.dayBuckets).length){
    const [dayStr, val] = Object.entries(agg.dayBuckets).sort((a,b)=> b[1]-a[1])[0];
    const d = new Date(dayStr + 'T00:00:00');
    monthBestDayEl.textContent = `${fmtDateTR(d)} (${money(val)})`;
  } else monthBestDayEl.textContent = '—';

  if (Object.keys(agg.productQty).length){
    const [name, qty] = Object.entries(agg.productQty).sort((a,b)=> b[1]-a[1])[0];
    monthBestProductEl.textContent = `${name} (${qty} adet)`;
  } else monthBestProductEl.textContent = '—';

  const days = Object.entries(agg.dayBuckets).sort((a,b)=> new Date(a[0]) - new Date(b[0]));
  if (days.length){
    const ul = document.createElement('ul');
    days.forEach(([dayStr, val])=>{
      const d = new Date(dayStr + 'T00:00:00'); const li = document.createElement('li');
      li.textContent = `${fmtDateTR(d)} — ${money(val)}`; ul.appendChild(li);
    });
    monthDailyListEl.innerHTML = '<h4>Günlük Dağılım</h4>'; monthDailyListEl.appendChild(ul);
  } else { monthDailyListEl.innerHTML = ''; }
}

// ---------- Settings Save / Dirty ----------
async function saveGeneralSettings(silent=false){
  // Mevcut config temel alınır, yalnızca dolu alanlar güncellenir
  const newCfg = {
    coffeehouseName: coffeehouseNameInput.value || '',
    isLoginEnabled: !!loginToggle.checked,
    userPassword: adminConfig.userPassword || '',   // default: eskisi
    adminPassword: adminConfig.adminPassword || ''  // default: eskisi
  };

  // DİKKAT: Artık DÜZ METİN kaydediyoruz (hash yok, prefix yok)
  const userRaw = userPasswordInput.value;   // TRIM YOK — ne yazdıysan o
  const adminRaw = adminPasswordChangeInput.value; // TRIM YOK

  if (userRaw !== '') newCfg.userPassword = userRaw;
  if (adminRaw !== '') newCfg.adminPassword = adminRaw;

  db.ref('config').set(newCfg).then(()=>{
    adminConfig = newCfg; // local'ı da güncelle
    dirty.settings = false; updateUnsavedBanner();
    // Güvenlik için inputları temizle
    userPasswordInput.value = '';
    adminPasswordChangeInput.value = '';
    if (!silent) alert('Ayarlar kaydedildi.');
  }).catch(e=> alert(`Hata: ${e.message}`));
}
function saveAllDirty(){ if (dirty.settings) saveGeneralSettings(true); dirty.products.clear(); dirty.settings=false; updateUnsavedBanner(); }
function discardAllDirty(){
  coffeehouseNameInput.value = adminConfig.coffeehouseName || '';
  loginToggle.checked = !!adminConfig.isLoginEnabled;
  userPasswordInput.value = '';
  adminPasswordChangeInput.value = '';
  dirty.products.clear(); dirty.settings = false; updateUnsavedBanner();
}
function updateUnsavedBanner(){ const shouldShow = dirty.settings || dirty.products.size > 0; unsavedBanner.classList.toggle('show', !!shouldShow); }

// ---------- Gün Sonu & Sıfırlama ----------
async function endDayArchiveAndClear(){
  try{
    const [dailySnap, salesSnap] = await Promise.all([ db.ref('dailyBook').once('value'), db.ref('sales').once('value') ]);
    const daily = dailySnap.val() || {}; const sales = salesSnap.val() || {};
    const today = new Date();
    const revenueArr = Object.values(daily.revenue || {}).filter(x => !x.timestamp || isSameDay(x.timestamp, today));
    const expenseArr = Object.values(daily.expenses || {}).filter(x => !x.timestamp || isSameDay(x.timestamp, today));
    const totalRevenue = revenueArr.reduce((s, r)=> s + Number(r.amount||0), 0);
    const totalExpenses = expenseArr.reduce((s, e)=> s + Number(e.amount||0), 0);
    const profit = totalRevenue - totalExpenses;
    const ts = Date.now();
    const dayStr = todayKey(today);

    await db.ref(`archive/revenues/${dayStr}`).set({ amount: totalRevenue, expenses: totalExpenses, profit, timestamp: ts });

    const updates = {};
    Object.entries(sales).forEach(([key, s])=>{
      if (isSameDay(s.timestamp, today)) {
        const newKey = db.ref('archive/sales').push().key;
        updates[`archive/sales/${newKey}`] = { ...s, archivedDate: dayStr };
        updates[`sales/${key}`] = null;
      }
    });
    updates['dailyBook'] = { expenses: {}, revenue: {} };

    await db.ref().update(updates);
    alert('Gün başarıyla bitirildi. Veriler arşive kaydedildi ve günlük temizlendi.');
  }catch(e){ alert('Günü bitirme sırasında hata: ' + e.message); }
}

async function confirmHardResetToday(){
  try{
    const today = new Date(); const dayStr = todayKey(today);
    const [_, salesSnap, revArcSnap, salesArcSnap] = await Promise.all([
      db.ref('dailyBook').once('value'),
      db.ref('sales').once('value'),
      db.ref('archive/revenues').once('value'),
      db.ref('archive/sales').once('value'),
    ]);

    const updates = {};
    updates['dailyBook'] = { expenses:{}, revenue:{} };

    const sales = salesSnap.val() || {};
    Object.entries(sales).forEach(([k, s])=>{ if (isSameDay(s.timestamp, today)) updates[`sales/${k}`] = null; });

    const revArc = revArcSnap.val() || {};
    if (revArc[dayStr]) updates[`archive/revenues/${dayStr}`] = null;

    const salesArc = salesArcSnap.val() || {};
    Object.entries(salesArc).forEach(([k, s])=>{
      if ((s.archivedDate && s.archivedDate === dayStr) || isSameDay(s.timestamp, today)) updates[`archive/sales/${k}`] = null;
    });

    await db.ref().update(updates);
    closeResetModal();
    alert('Bugünün verileri grafikten de kaldırılarak tamamen silindi.');
  }catch(e){ alert('Sıfırlama hatası: ' + e.message); }
}
