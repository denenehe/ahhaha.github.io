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

// --- DOM ELEMENTS ---
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const loginButton = document.getElementById('login-button');
const passwordInput = document.getElementById('user-password-input');
const loginError = document.getElementById('login-error');
const appTitle = document.getElementById('app-title');
const loginTitle = document.getElementById('login-title');
const tableGridContainer = document.getElementById('table-grid-container');
const orderModal = document.getElementById('order-modal');
const menuModal = document.getElementById('menu-modal');
const cashbookModal = document.getElementById('cashbook-modal');
const productSelect = document.getElementById('product-select');
const existingOrderDetails = document.getElementById('existing-order-details');
const addItemsSection = document.getElementById('add-items-section');
const confirmOrderBtn = document.getElementById('confirm-order-btn');
const settleOrderBtn = document.getElementById('settle-order-btn');

// --- HELPERS: HASH / VERIFY ---
async function sha256(text) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function verifyPassword(entered, stored) {
  if (!stored) return false;
  if (stored.startsWith('sha256:')) {
    const h = await sha256(entered);
    return h === stored.slice(7);
  }
  return entered === stored; // backward compatibility
}

// --- EVENTS ---
document.addEventListener('DOMContentLoaded', initApp);
loginButton.addEventListener('click', () => handleLogin());
passwordInput.addEventListener('keyup', (e) => e.key === 'Enter' && handleLogin());
document.getElementById('menu-btn').addEventListener('click', showMenuModal);
document.getElementById('cashbook-btn').addEventListener('click', showCashbookModal);
document.getElementById('close-order-modal').addEventListener('click', () => orderModal.style.display = 'none');
document.getElementById('close-menu-modal').addEventListener('click', () => menuModal.style.display = 'none');
document.getElementById('close-cashbook-modal').addEventListener('click', () => cashbookModal.style.display = 'none');
document.getElementById('add-to-order-btn').addEventListener('click', addProductToOrder);
document.getElementById('add-custom-item-btn').addEventListener('click', addCustomItemToOrder);
confirmOrderBtn.addEventListener('click', confirmOrder);
settleOrderBtn.addEventListener('click', settleAndPayOrder);
document.getElementById('add-expense-btn').addEventListener('click', addExpense);

// --- INIT ---
function initApp() {
  loginButton.disabled = true; // enable after config loads

  db.ref('config').on('value', (snapshot) => {
    config = snapshot.val() || {};
    configReady = true;
    updateUIBasedOnConfig();
    loginButton.disabled = false;
  });

  db.ref('products').on('value', (snapshot) => {
    products = snapshot.val() || {};
    populateProductSelect();
    populateMenuList();
  });

  db.ref('tables').on('value', (snapshot) => {
    tables = snapshot.val() || {};
    renderTables();
    if (orderModal.style.display === 'flex' && currentTableId) {
      renderExistingOrder();
    }
  });

  db.ref('dailyBook/expenses').on('value', (snapshot) => renderCashbook(snapshot.val() || {}));
}

// --- CORE UI ---
function updateUIBasedOnConfig() {
  appTitle.textContent = config.coffeehouseName || 'Coffeehouse';
  loginTitle.textContent = `${config.coffeehouseName || 'Cafe'} Login`;
  if (config.isLoginEnabled) {
    loginScreen.style.display = 'flex';
    appContainer.classList.add('hidden');
  } else {
    loginScreen.style.display = 'none';
    appContainer.classList.remove('hidden');
  }
}

// --- AUTH ---
async function handleLogin() {
  if (!configReady) {
    loginError.textContent = 'Config is still loading. Please try again.';
    return;
  }
  const enteredPassword = passwordInput.value;
  const ok = await verifyPassword(enteredPassword, config.userPassword);
  if (ok) {
    loginScreen.style.display = 'none';
    appContainer.classList.remove('hidden');
    loginError.textContent = '';
    passwordInput.value = '';
  } else {
    loginError.textContent = 'Incorrect password.';
  }
}

// --- TABLES ---
function renderTables() {
  tableGridContainer.innerHTML = '';
  const ids = tables ? Object.keys(tables).sort() : [];
  if (ids.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No tables configured.';
    tableGridContainer.appendChild(p);
    return;
  }
  ids.forEach(tableId => {
    const table = tables[tableId];
    const tableBtn = document.createElement('button');
    tableBtn.className = `table-btn ${table.status || 'free'}`;
    tableBtn.textContent = table.name || tableId;
    tableBtn.dataset.tableId = tableId;
    tableBtn.addEventListener('click', () => openOrderModal(tableId));
    tableGridContainer.appendChild(tableBtn);
  });
}

function openOrderModal(tableId) {
  currentTableId = tableId;
  const table = tables[tableId];

  if ((table.status || 'free') === 'free') {
    db.ref(`tables/${tableId}/status`).set('ordering');
  }

  document.getElementById('order-modal-title').textContent = `${table.name} Order`;
  renderExistingOrder();

  if (table.status === 'confirmed') {
    addItemsSection.style.display = 'none';
    confirmOrderBtn.style.display = 'none';
    settleOrderBtn.style.display = 'inline-block';
  } else {
    addItemsSection.style.display = 'block';
    confirmOrderBtn.style.display = 'inline-block';
    settleOrderBtn.style.display = 'none';
  }

  orderModal.style.display = 'flex';
}

function renderExistingOrder() {
  existingOrderDetails.innerHTML = '';
  const order = tables[currentTableId]?.order;
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

    if ((tables[currentTableId].status || '') !== 'confirmed') {
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '×';
      removeBtn.className = 'remove-item-btn';
      removeBtn.onclick = () => removeItemFromOrder(itemId);
      li.appendChild(removeBtn);
    }
    orderList.appendChild(li);
    total += qty * price;
  });

  existingOrderDetails.appendChild(orderList);
  const totalEl = document.createElement('h3');
  totalEl.textContent = `Total: $${total.toFixed(2)}`;
  existingOrderDetails.appendChild(totalEl);
}

function removeItemFromOrder(itemId) {
  const itemPath = `tables/${currentTableId}/order/items/${itemId}`;
  db.ref(itemPath).remove();

  const order = tables[currentTableId]?.order;
  if (!order || !order.items) return;

  const remainingItemIds = Object.keys(order.items).filter(id => id !== itemId);
  if (remainingItemIds.length === 0) {
    db.ref(`tables/${currentTableId}/status`).set('free');
    db.ref(`tables/${currentTableId}/order`).remove();
  }
}

// --- ORDERING ---
function populateProductSelect() {
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
  const selectedProductId = productSelect.value;
  const quantityToAdd = Number.parseInt(document.getElementById('quantity-input').value, 10);
  const notes = document.getElementById('order-notes').value.trim();

  if (!selectedProductId || !Number.isFinite(quantityToAdd) || quantityToAdd < 1) {
    alert('Please select a product and a valid quantity.');
    return;
  }

  const product = products[selectedProductId];
  if (!product) {
    alert('Selected product is no longer available.');
    return;
  }

  const order = tables[currentTableId]?.order;
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
    const itemPath = `tables/${currentTableId}/order/items/${existingItemId}/quantity`;
    db.ref(itemPath).set(newQuantity);
  } else {
    const orderItem = {
      name: product.name,
      price: Number(product.price || 0),
      quantity: quantityToAdd,
      productId: selectedProductId,
      notes: notes
    };
    db.ref(`tables/${currentTableId}/order/items/${Date.now()}`).set(orderItem);
  }

  productSelect.value = '';
  document.getElementById('quantity-input').value = 1;
  document.getElementById('order-notes').value = '';
}

function addCustomItemToOrder() {
  const name = document.getElementById('custom-item-name').value.trim();
  const price = Number.parseFloat(document.getElementById('custom-item-price').value);
  if (!name || !Number.isFinite(price) || price <= 0) return;

  const orderItem = { name, price, quantity: 1, isCustom: true, notes: '' };
  db.ref(`tables/${currentTableId}/order/items/${Date.now()}`).set(orderItem);
  document.getElementById('custom-item-name').value = '';
  document.getElementById('custom-item-price').value = '';
}

function confirmOrder() {
  const table = tables[currentTableId];
  if (!table?.order?.items) {
    alert('Cannot confirm an empty order. Please add items first.');
    return;
  }

  // Validate stock & product existence
  for (const itemId in table.order.items) {
    const item = table.order.items[itemId];
    if (!item.isCustom && item.productId) {
      const prod = products[item.productId];
      if (!prod) {
        alert(`Product not found: ${item.name}.`);
        return;
      }
      const currentStock = Number(prod.stock || 0);
      if (currentStock < Number(item.quantity || 0)) {
        alert(`Not enough stock for ${item.name}. Only ${currentStock} left.`);
        return;
      }
    }
  }

  // Build stock updates
  const stockUpdates = {};
  for (const itemId in table.order.items) {
    const item = table.order.items[itemId];
    if (!item.isCustom && item.productId) {
      const newStock = Number(products[item.productId].stock || 0) - Number(item.quantity || 0);
      stockUpdates[`/products/${item.productId}/stock`] = newStock;
    }
  }

  db.ref().update(stockUpdates)
    .then(() => db.ref(`tables/${currentTableId}/status`).set('confirmed'))
    .then(() => { orderModal.style.display = 'none'; })
    .catch(e => alert(`Error: ${e.message}`));
}

function settleAndPayOrder() {
  const table = tables[currentTableId];
  if ((table?.status || '') !== 'confirmed') {
    alert('This order has not been confirmed yet.');
    return;
  }

  let orderTotal = 0;
  const items = table?.order?.items || {};
  Object.values(items).forEach(item => {
    orderTotal += Number(item.price || 0) * Number(item.quantity || 0);
  });

  db.ref('dailyBook/revenue').push().set({
    amount: orderTotal,
    table: table.name,
    timestamp: Date.now()
  });

  db.ref(`tables/${currentTableId}`).set({
    name: table.name,
    order: null,
    status: 'free'
  }).then(() => {
    orderModal.style.display = 'none';
  }).catch(e => alert(`Error: ${e.message}`));
}

// --- MENU / CASHBOOK ---
function showMenuModal() {
  menuModal.style.display = 'flex';
}

function populateMenuList() {
  const menuList = document.getElementById('menu-list');
  menuList.innerHTML = '';
  Object.values(products || {}).forEach(product => {
    const li = document.createElement('li');
    const price = Number(product?.price ?? 0);
    li.textContent = `${product.name} - $${price.toFixed(2)}`;
    menuList.appendChild(li);
  });
}

function showCashbookModal() {
  cashbookModal.style.display = 'flex';
}

function renderCashbook(expenses) {
  const listDiv = document.getElementById('cashbook-list');
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
  const name = document.getElementById('expense-name').value.trim();
  const amount = Number.parseFloat(document.getElementById('expense-amount').value);
  if (!name || !Number.isFinite(amount) || amount <= 0) {
    alert('Please enter a valid expense name and amount.');
    return;
  }
  db.ref('dailyBook/expenses').push().set({ name, amount })
    .then(() => {
      document.getElementById('expense-name').value = '';
      document.getElementById('expense-amount').value = '';
    })
    .catch(e => alert(`Error: ${e.message}`));
}
