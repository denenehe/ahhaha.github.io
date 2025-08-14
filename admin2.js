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

// --- DOM ELEMENTS ---
const adminLoginScreen = document.getElementById('admin-login-screen');
const adminPanel = document.getElementById('admin-panel');
const adminPasswordInput = document.getElementById('admin-password-input');
const adminLoginButton = document.getElementById('admin-login-button');
const adminLoginError = document.getElementById('admin-login-error');

let adminConfig = {};
let configReady = false;

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
  return entered === stored; // backward compatibility (plain text)
}

// --- EVENTS ---
document.addEventListener('DOMContentLoaded', initAdmin);
adminLoginButton.addEventListener('click', () => handleAdminLogin());
adminPasswordInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') handleAdminLogin(); });

document.getElementById('save-settings-btn').addEventListener('click', saveGeneralSettings);
document.getElementById('add-table-btn').addEventListener('click', addTable);
document.getElementById('add-product-btn').addEventListener('click', addProduct);
document.getElementById('reset-daily-btn').addEventListener('click', resetDailyData);

// --- INIT ---
function initAdmin() {
  adminLoginButton.disabled = true; // enable after config loads
  db.ref('config').on('value', (snapshot) => {
    adminConfig = snapshot.val() || {};
    configReady = true;
    adminLoginButton.disabled = false;
  });
}

// --- AUTH ---
async function handleAdminLogin() {
  if (!configReady) {
    adminLoginError.textContent = 'Config is still loading. Please try again.';
    return;
  }
  const ok = await verifyPassword(adminPasswordInput.value, adminConfig.adminPassword);
  if (ok) {
    adminLoginScreen.style.display = 'none';
    adminPanel.classList.remove('hidden');
    loadAdminPanelData();
    adminLoginError.textContent = '';
  } else {
    adminLoginError.textContent = 'Incorrect admin password.';
  }
}

// --- LOAD ADMIN DATA ---
function loadAdminPanelData() {
  document.getElementById('coffeehouse-name-input').value = adminConfig.coffeehouseName || '';
  document.getElementById('login-toggle').checked = !!adminConfig.isLoginEnabled;
  document.getElementById('user-password-input').value = (adminConfig.userPassword?.startsWith('sha256:')) ? '' : (adminConfig.userPassword || '');

  db.ref('tables').on('value', snap => renderTableManagement(snap.val()));
  db.ref('products').on('value', snap => renderProductManagement(snap.val()));
  db.ref('dailyBook').on('value', snap => calculateAnalysis(snap.val()));
}

// --- TABLE MGMT ---
function renderTableManagement(tables) {
  const container = document.getElementById('table-management-list');
  container.innerHTML = '';
  if (!tables) return;

  Object.keys(tables).sort().forEach(tableId => {
    const table = tables[tableId];
    const itemDiv = document.createElement('div');
    itemDiv.className = 'table-item';
    itemDiv.innerHTML = `
      <span>${table.name}</span>
      <button class="danger-btn" data-id="${tableId}">Remove</button>
    `;
    itemDiv.querySelector('button').addEventListener('click', () => removeTable(tableId));
    container.appendChild(itemDiv);
  });
}

function addTable() {
  const newTableId = `table${Date.now()}`;
  const tableCount = document.querySelectorAll('.table-item').length;
  db.ref(`tables/${newTableId}`).set({
    name: `Table ${tableCount + 1}`,
    order: null,
    status: 'free'
  }).catch(e => alert(`Error: ${e.message}`));
}

function removeTable(tableId) {
  if (confirm('Are you sure you want to remove this table?')) {
    db.ref(`tables/${tableId}`).remove().catch(e => alert(`Error: ${e.message}`));
  }
}

// --- PRODUCT MGMT ---
function renderProductManagement(products) {
  const container = document.getElementById('product-management-list');
  container.innerHTML = '';
  if (!products) return;

  Object.keys(products).forEach(productId => {
    const product = products[productId] || {};
    const price = Number(product.price ?? 0);
    const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;

    const itemDiv = document.createElement('div');
    itemDiv.className = 'product-item';
    itemDiv.dataset.productId = productId;
    itemDiv.innerHTML = `
      <div>
        <input type="text" value="${product.name ?? ''}" data-field="name" placeholder="Name">
        <input type="number" value="${price.toFixed(2)}" data-field="price" placeholder="Price" step="0.01">
        <input type="number" value="${stock}" data-field="stock" placeholder="Stock">
      </div>
      <div>
        <button class="save-product-btn" data-id="${productId}">Update</button>
        <button class="danger-btn remove-product-btn" data-id="${productId}">Remove</button>
      </div>
    `;
    container.appendChild(itemDiv);
  });

  container.querySelectorAll('.save-product-btn').forEach(btn =>
    btn.addEventListener('click', (e) => updateProduct(e.target.dataset.id)));

  container.querySelectorAll('.remove-product-btn').forEach(btn =>
    btn.addEventListener('click', (e) => removeProduct(e.target.dataset.id)));
}

function addProduct() {
  const name = document.getElementById('new-product-name').value.trim();
  const price = Number.parseFloat(document.getElementById('new-product-price').value);
  const stock = Number.parseInt(document.getElementById('new-product-stock').value, 10);

  if (!name || !Number.isFinite(price) || !Number.isFinite(stock)) {
    alert('Please fill all product fields correctly.');
    return;
  }
  const newProductId = `prod${Date.now()}`;
  db.ref(`products/${newProductId}`).set({ name, price, stock })
    .then(() => {
      document.getElementById('new-product-name').value = '';
      document.getElementById('new-product-price').value = '';
      document.getElementById('new-product-stock').value = '';
    })
    .catch(e => alert(`Error: ${e.message}`));
}

function updateProduct(productId) {
  const container = document.querySelector(`.product-item[data-product-id="${productId}"]`);
  if (!container) return;

  const nameInput = container.querySelector(`input[data-field="name"]`);
  const priceInput = container.querySelector(`input[data-field="price"]`);
  const stockInput = container.querySelector(`input[data-field="stock"]`);

  const name = (nameInput.value || '').trim();
  const price = Number.parseFloat(priceInput.value);
  const stock = Number.parseInt(stockInput.value, 10);

  if (!name || !Number.isFinite(price) || !Number.isFinite(stock)) {
    alert('Please enter valid product data.');
    return;
  }

  const updates = { name, price, stock };
  db.ref(`products/${productId}`).update(updates)
    .then(() => alert(`Product ${updates.name} updated.`))
    .catch(error => alert(`Error: ${error.message}`));
}

function removeProduct(productId) {
  if (confirm('Are you sure you want to remove this product?')) {
    db.ref(`products/${productId}`).remove().catch(e => alert(`Error: ${e.message}`));
  }
}

// --- ANALYSIS / DAILY BOOK ---
function calculateAnalysis(dailyBook) {
  const revenueEl = document.getElementById('total-revenue');
  const expensesEl = document.getElementById('total-expenses');
  const profitEl = document.getElementById('total-profit');

  const revenueObj = dailyBook?.revenue || {};
  const expensesObj = dailyBook?.expenses || {};

  const totalRevenue = Object.values(revenueObj).reduce((sum, item) => sum + Number(item?.amount || 0), 0);
  const totalExpenses = Object.values(expensesObj).reduce((sum, item) => sum + Number(item?.amount || 0), 0);
  const totalProfit = totalRevenue - totalExpenses;

  revenueEl.textContent = totalRevenue.toFixed(2);
  expensesEl.textContent = totalExpenses.toFixed(2);
  profitEl.textContent = totalProfit.toFixed(2);
}

function resetDailyData() {
  if (confirm('ARE YOU SURE? This will reset all revenue and expenses for the day to zero.')) {
    db.ref('dailyBook').set({ expenses: {}, revenue: {} })
      .then(() => alert('Daily data has been reset.'))
      .catch(e => alert(`Error: ${e.message}`));
  }
}

// --- SAVE SETTINGS ---
async function saveGeneralSettings() {
  const newConfig = {
    coffeehouseName: document.getElementById('coffeehouse-name-input').value,
    isLoginEnabled: document.getElementById('login-toggle').checked,
  };

  // User password (hash if girilmişse)
  const userPass = document.getElementById('user-password-input').value.trim();
  if (userPass) {
    const h = await sha256(userPass);
    newConfig.userPassword = `sha256:${h}`;
  }

  // Admin password (hash if girilmişse)
  const newAdminPass = document.getElementById('admin-password-change-input').value.trim();
  if (newAdminPass) {
    const h = await sha256(newAdminPass);
    newConfig.adminPassword = `sha256:${h}`;
  }

  db.ref('config').update(newConfig)
    .then(() => {
      alert('Settings saved successfully!');
      document.getElementById('admin-password-change-input').value = '';
      if (userPass) document.getElementById('user-password-input').value = '';
    })
    .catch(error => alert(`Error: ${error.message}`));
}
