// ==============================
// app2.js  (FULL WORKING VERSION)
// ==============================

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

// --- INITIALIZE FIREBASE ---
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// --- GLOBALS ---
let currentTableId = null;
let config = {}, products = {}, tables = {};
let configReady = false;
let isBusy = false; // işlem kilidi

// --- THEME (cihaza özel - localStorage) ---
const THEMES = ['light', 'dark', 'latte', 'forest', 'contrast'];
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('theme', t); } catch (_) {}
}
function initTheme() {
  let t = 'light';
  try { t = localStorage.getItem('theme') || 'light'; } catch (_) {}
  if (!THEMES.includes(t)) t = 'light';
  applyTheme(t);
}

// --- HELPERS: HASH / VERIFY ---
async function sha256(text) {
  if (!(crypto && crypto.subtle && isSecureContext)) return `plain:${text}`;
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function verifyPassword(entered, stored) {
  if (!stored) return false;
  if (stored.startsWith('sha256:') && crypto?.subtle && isSecureContext) {
    const h = await sha256(entered);
    return h === stored.slice(7);
  }
  return entered === stored;
}

// --- UTILS ---
function extractNumber(str, fallback = 0) {
  const m = String(str || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : fallback;
}
function tableSort([idA, tblA], [idB, tblB]) {
  const numA = extractNumber(tblA?.name, extractNumber(idA, 0));
  const numB = extractNumber(tblB?.name, extractNumber(idB, 0));
  return numA - numB;
}
function setBusy(btn, flag) {
  isBusy = flag;
  if (btn) btn.disabled = flag;
}
function bind(id, type, handler) {
  const el = document.getElementById(id);
  if (el && typeof handler === 'function') el.addEventListener(type, handler);
  return el;
}

// --- DOM refs (initApp içinde doldurulacak) ---
let loginScreen, appContainer, loginButton, passwordInput, loginError, appTitle, loginTitle;
let tableGridContainer, orderModal, menuModal, cashbookModal, productSelect, existingOrderDetails;
let addItemsSection, confirmOrderBtn, undoConfirmBtn, settleOrderBtn;

// --- BOOT ---
document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
  // DOM cache
  loginScreen = document.getElementById('login-screen');
  appContainer = document.getElementById('app-container');
  loginButton = document.getElementById('login-button');
  passwordInput = document.getElementById('user-password-input');
  loginError = document.getElementById('login-error');
  appTitle = document.getElementById('app-title');
  loginTitle = document.getElementById('login-title');
  tableGridContainer = document.getElementById('table-grid-container');
  orderModal = document.getElementById('order-modal');
  menuModal = document.getElementById('menu-modal');
  cashbookModal = document.getElementById('cashbook-modal');
  productSelect = document.getElementById('product-select');
  existingOrderDetails = document.getElementById('existing-order-details');
  addItemsSection = document.getElementById('add-items-section');
  confirmOrderBtn = document.getElementById('confirm-order-btn');
  undoConfirmBtn = document.getElementById('undo-confirm-btn');
  settleOrderBtn = document.getElementById('settle-order-btn');

  initTheme();
  if (loginButton) loginButton.disabled = true;

  // Realtime listeners
  db.ref('config').on('value', (snapshot) => {
    config = snapshot.val() || {};
    configReady = true;
    updateUIBasedOnConfig();
    if (loginButton) loginButton.disabled = false;
  });

  db.ref('products').on('value', (snapshot) => {
    products = snapshot.val() || {};
    populateProductSelect();
    populateMenuList();
  });

  db.ref('tables').on('value', (snapshot) => {
    tables = snapshot.val() || {};
    renderTables();
    if (orderModal && orderModal.style.display === 'flex' && (orderModal.dataset.tableId || currentTableId)) {
      renderExistingOrder();
    }
  });

  db.ref('dailyBook/expenses').on('value', (snapshot) => renderCashbook(snapshot.val() || {}));

  // Static buttons (safe bind)
  bind('menu-btn', 'click', showMenuModal);
  bind('cashbook-btn', 'click', showCashbookModal);
  bind('close-order-modal', 'click', () => { if (orderModal) orderModal.style.display = 'none'; });
  bind('close-menu-modal', 'click', () => { if (menuModal) menuModal.style.display = 'none'; });
  bind('close-cashbook-modal', 'click', () => { if (cashbookModal) cashbookModal.style.display = 'none'; });
  bind('add-to-order-btn', 'click', addProductToOrder);
  bind('add-custom-item-btn', 'click', addCustomItemToOrder);     // <-- tanımlı ve güvenli
  bind('add-expense-btn', 'click', addExpense);

  // Login
  bind('login-button', 'click', handleLogin);
  if (passwordInput) {
    passwordInput.addEventListener('keyup', (e) => e.key === 'Enter' && handleLogin());
  }

  // Theme
  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const idx = THEMES.indexOf(current);
      const next = THEMES[(idx + 1) % THEMES.length];
      applyTheme(next);
    });
  }

  // Modal içi event delegation (Confirm/Undo/Settle)
  if (orderModal && !orderModal._bound) {
    orderModal.addEventListener('click', (e) => {
      const c = e.target.closest('#confirm-order-btn');
      const u = e.target.closest('#undo-confirm-btn');
      const s = e.target.closest('#settle-order-btn');
      if (c) confirmOrder(e);
      else if (u) undoConfirmOrder(e);
      else if (s) settleAndPayOrder(e);
    });
    orderModal._bound = true;
  }
}

// --- CORE UI ---
function updateUIBasedOnConfig() {
  if (appTitle) appTitle.textContent = config.coffeehouseName || 'Coffeehouse';
  if (loginTitle) loginTitle.textContent = `${config.coffeehouseName || 'Cafe'} Login`;
  if (config.isLoginEnabled) {
    if (loginScreen) loginScreen.style.display = 'flex';
    if (appContainer) appContainer.classList.add('hidden');
  } else {
    if (loginScreen) loginScreen.style.display = 'none';
    if (appContainer) appContainer.classList.remove('hidden');
  }
}

// --- AUTH ---
async function handleLogin() {
  if (!configReady) {
    if (loginError) loginError.textContent = 'Config is still loading. Please try again.';
    return;
  }
  const enteredPassword = passwordInput ? passwordInput.value : '';
  const ok = await verifyPassword(enteredPassword, config.userPassword);
  if (ok) {
    if (loginScreen) loginScreen.style.display = 'none';
    if (appContainer) appContainer.classList.remove('hidden');
    if (loginError) loginError.textContent = '';
    if (passwordInput) passwordInput.value = '';
  } else {
    if (loginError) loginError.textContent = 'Incorrect password.';
  }
}

// --- TABLES ---
function renderTables() {
  if (!tableGridContainer) return;
  tableGridContainer.innerHTML = '';

  const entries = tables ? Object.entries(tables) : [];
  if (entries.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No tables configured.';
    tableGridContainer.appendChild(p);
    return;
  }

  entries
    .sort(tableSort)
    .forEach(([tableId, table]) => {
      const tableBtn = document.createElement('button');
      tableBtn.className = `table-btn ${table.status || 'free'}`;
      tableBtn.textContent = table.name || tableId;
      tableBtn.dataset.tableId = tableId;

      // Çift tıklama ile masa adı
      tableBtn.addEventListener('dblclick', () => {
        const newName = prompt('Masa adını değiştir:', table.name || tableId);
        if (newName && newName.trim()) {
          db.ref(`tables/${tableId}/name`).set(newName.trim());
        }
      });

      tableBtn.addEventListener('click', () => openOrderModal(tableId));
      tableGridContainer.appendChild(tableBtn);
    });
}

// --- MODAL (snapshot ile senkron açılır) ---
async function openOrderModal(tableId) {
  currentTableId = tableId;
  if (orderModal) orderModal.dataset.tableId = tableId;

  // En güncel tabloyu çek
  const snap = await db.ref(`tables/${tableId}`).once('value');
  const tableLatest = snap.val() || tables[tableId] || {};

  // Yerel state’i senkronla
  tables[tableId] = { ...(tables[tableId] || {}), ...tableLatest };

  // İlk girişte 'free' ise 'ordering'e çek
  if ((tableLatest.status || 'free') === 'free') {
    await db.ref(`tables/${tableId}/status`).set('ordering');
    tables[tableId].status = 'ordering';
  }

  const titleEl = document.getElementById('order-modal-title');
  if (titleEl) titleEl.textContent = `${tables[tableId].name || tableId} Order`;

  renderExistingOrder();

  const isConfirmed = tables[tableId].status === 'confirmed';
  if (addItemsSection) addItemsSection.style.display = isConfirmed ? 'none' : 'block';
  if (confirmOrderBtn) confirmOrderBtn.style.display = isConfirmed ? 'none' : 'inline-block';
  if (undoConfirmBtn) undoConfirmBtn.style.display = isConfirmed ? 'inline-block' : 'none';
  if (settleOrderBtn) settleOrderBtn.style.display = isConfirmed ? 'inline-block' : 'none';

  if (orderModal) orderModal.style.display = 'flex';
}

function renderExistingOrder() {
  if (!existingOrderDetails) return;
  existingOrderDetails.innerHTML = '';
  const tableId = (orderModal && orderModal.dataset.tableId) || currentTableId;
  const order = tables[tableId]?.order;
  if (!order || !order.items) {
    existingOrderDetails.innerHTML = '<p>No items added yet.</p>';
    return;
  }

  const orderList = document.createElement('ul');
  orderList.className = 'item-list';
  let total = 0;

  Object.keys(order.items).forEach(itemId => {
    const item = order.items[itemId];
    const price = Number(item?.price ?? 0);
    const qty = Number(item?.quantity ?? 0);
    const displayName = item?.notes ? `${item.name} (${item.notes})` : item.name;

    const li = document.createElement('li');
    li.textContent = `${qty} x ${displayName} @ $${price.toFixed(2)} each`;

    if ((tables[tableId].status || '') !== 'confirmed') {
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '×';
      removeBtn.className = 'remove-item-btn';
      removeBtn.addEventListener('click', () => removeItemFromOrder(itemId));
      li.appendChild(removeBtn);
    }
    orderList.appendChild(li);
    total += qty * price;
  });

  existingOrderDetails.appendChild(orderList);
  const totalEl = document.createElement('h3');
  totalEl.textContent = `Total: ${total.toFixed(2)} $`;
  existingOrderDetails.appendChild(totalEl);
}

function removeItemFromOrder(itemId) {
  const tableId = (orderModal && orderModal.dataset.tableId) || currentTableId;
  const itemPath = `tables/${tableId}/order/items/${itemId}`;
  db.ref(itemPath).remove();

  const order = tables[tableId]?.order;
  if (!order || !order.items) return;

  const remainingItemIds = Object.keys(order.items).filter(id => id !== itemId);
  if (remainingItemIds.length === 0) {
    db.ref(`tables/${tableId}/status`).set('free');
    db.ref(`tables/${tableId}/order`).remove();
  }
}

// --- ORDERING ---
function populateProductSelect() {
  if (!productSelect) return;
  productSelect.innerHTML = '<option value="">-- Select a product --</option>';
  Object.keys(products || {}).forEach(prodId => {
    const product = products[prodId] || {};
    const stock = Number(product?.stock ?? 0);
    const price = Number(product?.price ?? 0);

    const option = document.createElement('option');
    option.value = prodId;

    if (stock > 0) {
      option.textContent = `${product.name} - $${price.toFixed(2)}`;
    } else {
      option.textContent = `${product.name} (OUT OF STOCK)`;
      option.disabled = true;
    }
    productSelect.appendChild(option);
  });
}

function addProductToOrder() {
  const selectedProductId = productSelect ? productSelect.value : '';
  const qtyEl = document.getElementById('quantity-input');
  const notesEl = document.getElementById('order-notes');

  const quantityToAdd = Number.parseInt(qtyEl?.value || '1', 10);
  const notes = (notesEl?.value || '').trim();

  if (!selectedProductId || !Number.isFinite(quantityToAdd) || quantityToAdd < 1) {
    alert('Please select a product and a valid quantity.');
    return;
  }

  const product = products[selectedProductId];
  if (!product) {
    alert('Selected product is no longer available.');
    return;
  }

  const tableId = (orderModal && orderModal.dataset.tableId) || currentTableId;
  const order = tables[tableId]?.order;
  let itemExists = false;
  let existingItemId = null;
  let newQuantity = 0;

  if (order && order.items) {
    for (const itemId in order.items) {
      const currentItem = order.items[itemId];
      if (currentItem.productId === selectedProductId && (currentItem.notes || '') === notes) {
        itemExists = true;
        existingItemId = itemId;
        newQuantity = Number(currentItem.quantity || 0) + quantityToAdd;
        break;
      }
    }
  }

  if (itemExists) {
    const itemPath = `tables/${tableId}/order/items/${existingItemId}/quantity`;
    db.ref(itemPath).set(newQuantity);
  } else {
    const orderItem = {
      name: product.name,
      price: Number(product.price || 0),
      quantity: quantityToAdd,
      productId: selectedProductId,
      notes: notes
    };
    db.ref(`tables/${tableId}/order/items/${Date.now()}`).set(orderItem);
  }

  if (productSelect) productSelect.value = '';
  if (qtyEl) qtyEl.value = 1;
  if (notesEl) notesEl.value = '';
}

// --- CUSTOM ITEM (HATANIN KAYNAĞI OLAN FONKSİYON: ARTIK VAR) ---
function addCustomItemToOrder() {
  const tableId = (orderModal && orderModal.dataset.tableId) || currentTableId;
  if (!tableId) { alert('Table not selected.'); return; }

  const nameEl = document.getElementById('custom-item-name');
  const priceEl = document.getElementById('custom-item-price');
  const name = (nameEl?.value || '').trim();
  const price = Number.parseFloat(priceEl?.value || '');

  if (!name || !Number.isFinite(price) || price <= 0) {
    alert('Please enter a valid custom item name and price.');
    return;
  }

  const item = { name, price: Number(price), quantity: 1, isCustom: true, notes: '' };
  db.ref(`tables/${tableId}/order/items/${Date.now()}`).set(item)
    .then(() => {
      if (nameEl) nameEl.value = '';
      if (priceEl) priceEl.value = '';
      renderExistingOrder();
    })
    .catch(e => alert(`Error: ${e.message}`));
}

// --- CONFIRM / UNDO / PAY (snapshot + UI tazeleme) ---
async function confirmOrder() {
  if (isBusy) return;
  setBusy(confirmOrderBtn, true);

  const tableId = (orderModal && orderModal.dataset.tableId) || currentTableId;
  if (!tableId) { alert('Table not selected.'); setBusy(confirmOrderBtn, false); return; }

  try {
    const [tableSnap, productsSnap] = await Promise.all([
      db.ref(`tables/${tableId}`).once('value'),
      db.ref('products').once('value')
    ]);
    const tableNow = tableSnap.val();
    const productsNow = productsSnap.val() || {};

    if (!tableNow?.order?.items) {
      alert('Cannot confirm an empty order. Please add items first.');
      return;
    }

    // Stok kontrolü
    for (const itemId in tableNow.order.items) {
      const item = tableNow.order.items[itemId];
      if (!item.isCustom && item.productId) {
        const prod = productsNow[item.productId];
        if (!prod) { alert(`Product not found: ${item.name}.`); return; }
        const currentStock = Number(prod.stock || 0);
        if (currentStock < Number(item.quantity || 0)) {
          alert(`Not enough stock for ${item.name}. Only ${currentStock} left.`);
          return;
        }
      }
    }

    // Stok düş
    const stockUpdates = {};
    for (const itemId in tableNow.order.items) {
      const item = tableNow.order.items[itemId];
      if (!item.isCustom && item.productId) {
        const newStock = Number(productsNow[item.productId].stock || 0) - Number(item.quantity || 0);
        stockUpdates[`/products/${item.productId}/stock`] = newStock;
      }
    }

    await db.ref().update(stockUpdates);
    await db.ref(`tables/${tableId}/status`).set('confirmed');

    // Yerel state + UI
    tables[tableId] = { ...(tables[tableId] || {}), ...tableNow, status: 'confirmed' };
    await openOrderModal(tableId);
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    setBusy(confirmOrderBtn, false);
  }
}

async function undoConfirmOrder() {
  if (isBusy) return;
  setBusy(undoConfirmBtn, true);

  const tableId = (orderModal && orderModal.dataset.tableId) || currentTableId;
  if (!tableId) { alert('Table not selected.'); setBusy(undoConfirmBtn, false); return; }

  try {
    const [tableSnap, productsSnap] = await Promise.all([
      db.ref(`tables/${tableId}`).once('value'),
      db.ref('products').once('value')
    ]);
    const tableNow = tableSnap.val() || {};
    const productsNow = productsSnap.val() || {};
    const items = tableNow?.order?.items || {};

    const stockUpdates = {};
    for (const itemId in items) {
      const item = items[itemId];
      if (!item.isCustom && item.productId) {
        const pid = item.productId;
        const newStock = Number(productsNow[pid]?.stock || 0) + Number(item.quantity || 0);
        stockUpdates[`/products/${pid}/stock`] = newStock;
      }
    }

    await db.ref().update(stockUpdates);
    await db.ref(`tables/${tableId}/status`).set('ordering');

    tables[tableId] = { ...(tables[tableId] || {}), ...tableNow, status: 'ordering' };
    await openOrderModal(tableId);
  } catch (err) {
    alert(`Undo failed: ${err.message}`);
  } finally {
    setBusy(undoConfirmBtn, false);
  }
}

function settleAndPayOrder() {
  const tableId = (orderModal && orderModal.dataset.tableId) || currentTableId;
  const table = tables[tableId];
  if ((table?.status || '') !== 'confirmed') {
    alert('This order has not been confirmed yet.');
    return;
  }

  let orderTotal = 0;
  const items = table?.order?.items || {};
  Object.values(items).forEach(item => {
    orderTotal += Number(item.price || 0) * Number(item.quantity || 0);
  });

  const now = Date.now();
  db.ref('dailyBook/revenue').push().set({
    amount: orderTotal,
    table: table.name,
    timestamp: now
  });

  // Aylık analiz için satış kalemlerini kaydet
  Object.values(items).forEach(item => {
    db.ref('sales').push().set({
      productId: item.productId || null,
      name: item.name,
      quantity: Number(item.quantity || 0),
      price: Number(item.price || 0),
      isCustom: !!item.isCustom,
      table: table.name,
      timestamp: now
    });
  });

  db.ref(`tables/${tableId}`).set({
    name: table.name,
    order: null,
    status: 'free'
  }).then(() => {
    if (orderModal) orderModal.style.display = 'none';
  }).catch(e => alert(`Error: ${e.message}`));
}

// --- MENU / CASHBOOK ---
function showMenuModal() { if (menuModal) menuModal.style.display = 'flex'; }
function populateMenuList() {
  const menuList = document.getElementById('menu-list');
  if (!menuList) return;
  menuList.innerHTML = '';
  Object.values(products || {}).forEach(product => {
    const li = document.createElement('li');
    const price = Number(product?.price ?? 0);
    li.textContent = `${product.name} - $${price.toFixed(2)}`;
    menuList.appendChild(li);
  });
}

function showCashbookModal() { if (cashbookModal) cashbookModal.style.display = 'flex'; }
function renderCashbook(expenses) {
  const listDiv = document.getElementById('cashbook-list');
  if (!listDiv) return;
  listDiv.innerHTML = '<h4>Today\'s Expenses</h4>';
  const keys = Object.keys(expenses || {});
  if (keys.length === 0) {
    listDiv.innerHTML += '<p>No expenses recorded today.</p>';
    return;
  }
  const ul = document.createElement('ul');
  keys.forEach(k => {
    const exp = expenses[k];
    const amount = Number(exp?.amount ?? 0);
    const li = document.createElement('li');
    li.textContent = `${exp.name}: $${amount.toFixed(2)}`;
    ul.appendChild(li);
  });
  listDiv.appendChild(ul);
}

function addExpense() {
  const nameEl = document.getElementById('expense-name');
  const amountEl = document.getElementById('expense-amount');
  const name = (nameEl?.value || '').trim();
  const amount = Number.parseFloat(amountEl?.value || '');
  if (!name || !Number.isFinite(amount) || amount <= 0) {
    alert('Please enter a valid expense name and amount.');
    return;
  }
  db.ref('dailyBook/expenses').push().set({ name, amount })
    .then(() => {
      if (nameEl) nameEl.value = '';
      if (amountEl) amountEl.value = '';
    })
    .catch(e => alert(`Error: ${e.message}`));
}
