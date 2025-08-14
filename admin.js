// --- YOUR FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyDRWum4vdyATWOJbAYpFCru-my7rQdw-Ss",
    authDomain: "cafe-90be8.firebaseapp.com",
    databaseURL: "https://cafe-90be8-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "cafe-90be8",
    storageBucket: "cafe-90be8.firebasestorage.app",
    messagingSenderId: "315040770744",
    appId: "1:315040770744:web:723a11d987480b1fbf624d",
};

// --- INITIALIZE FIREBASE AND GET DB REFERENCE ---
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// --- DOM ELEMENTS ---
const adminLoginScreen = document.getElementById('admin-login-screen');
const adminPanel = document.getElementById('admin-panel');
const adminPasswordInput = document.getElementById('admin-password-input');
const adminLoginButton = document.getElementById('admin-login-button');
const adminLoginError = document.getElementById('admin-login-error');

// --- STATE ---
let adminConfig = {};

// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', initAdmin);
adminLoginButton.addEventListener('click', handleAdminLogin);
adminPasswordInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') handleAdminLogin();
});

document.getElementById('save-settings-btn').addEventListener('click', saveGeneralSettings);
document.getElementById('add-table-btn').addEventListener('click', addTable);
document.getElementById('add-product-btn').addEventListener('click', addProduct);
document.getElementById('reset-daily-btn').addEventListener('click', resetDailyData);

// --- INITIALIZATION ---
function initAdmin() {
    db.ref('config').on('value', (snapshot) => {
        adminConfig = snapshot.val() || {};
    });
}

function handleAdminLogin() {
    if (adminPasswordInput.value === adminConfig.adminPassword) {
        adminLoginScreen.style.display = 'none';
        adminPanel.classList.remove('hidden');
        loadAdminPanelData();
    } else {
        adminLoginError.textContent = 'Incorrect admin password.';
    }
}

function loadAdminPanelData() {
    document.getElementById('coffeehouse-name-input').value = adminConfig.coffeehouseName || '';
    document.getElementById('login-toggle').checked = adminConfig.isLoginEnabled || false;
    document.getElementById('user-password-input').value = adminConfig.userPassword || '';
    
    db.ref('tables').on('value', snapshot => renderTableManagement(snapshot.val()));
    db.ref('products').on('value', snapshot => renderProductManagement(snapshot.val()));
    db.ref('dailyBook').on('value', snapshot => calculateAnalysis(snapshot.val()));
}

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

function renderProductManagement(products) {
    const container = document.getElementById('product-management-list');
    container.innerHTML = '';
    if (!products) return;

    Object.keys(products).forEach(productId => {
        const product = products[productId];
        const itemDiv = document.createElement('div');
        itemDiv.className = 'product-item';
        itemDiv.innerHTML = `
            <div>
                <input type="text" value="${product.name}" data-id="${productId}" data-field="name" placeholder="Name">
                <input type="number" value="${product.price.toFixed(2)}" data-id="${productId}" data-field="price" placeholder="Price" step="0.01">
                <input type="number" value="${product.stock}" data-id="${productId}" data-field="stock" placeholder="Stock">
            </div>
            <div>
                <button class="save-product-btn" data-id="${productId}">Update</button>
                <button class="danger-btn remove-product-btn" data-id="${productId}">Remove</button>
            </div>
        `;
        container.appendChild(itemDiv);
    });

    container.querySelectorAll('.save-product-btn').forEach(btn => btn.addEventListener('click', (e) => updateProduct(e.target.dataset.id)));
    container.querySelectorAll('.remove-product-btn').forEach(btn => btn.addEventListener('click', (e) => removeProduct(e.target.dataset.id)));
}

function calculateAnalysis(dailyBook) {
    const revenueEl = document.getElementById('total-revenue');
    const expensesEl = document.getElementById('total-expenses');
    const profitEl = document.getElementById('total-profit');
    
    let totalRevenue = 0;
    if (dailyBook && dailyBook.revenue) {
        totalRevenue = Object.values(dailyBook.revenue).reduce((sum, item) => sum + item.amount, 0);
    }

    let totalExpenses = 0;
    if (dailyBook && dailyBook.expenses) {
        totalExpenses = Object.values(dailyBook.expenses).reduce((sum, item) => sum + item.amount, 0);
    }
    
    const totalProfit = totalRevenue - totalExpenses;

    revenueEl.textContent = totalRevenue.toFixed(2);
    expensesEl.textContent = totalExpenses.toFixed(2);
    profitEl.textContent = totalProfit.toFixed(2);
}

function saveGeneralSettings() {
    const newConfig = {
        coffeehouseName: document.getElementById('coffeehouse-name-input').value,
        isLoginEnabled: document.getElementById('login-toggle').checked,
        userPassword: document.getElementById('user-password-input').value
    };

    const newAdminPass = document.getElementById('admin-password-change-input').value.trim();
    if (newAdminPass) {
        newConfig.adminPassword = newAdminPass;
    }

    db.ref('config').update(newConfig)
        .then(() => {
            alert('Settings saved successfully!');
            document.getElementById('admin-password-change-input').value = '';
        })
        .catch(error => alert(`Error: ${error.message}`));
}

function addTable() {
    const newTableId = `table${Date.now()}`;
    const tableCount = document.querySelectorAll('.table-item').length;
    db.ref(`tables/${newTableId}`).set({
        name: `Table ${tableCount + 1}`,
        order: null,
        status: 'free'
    });
}

function removeTable(tableId) {
    if (confirm('Are you sure you want to remove this table?')) {
        db.ref(`tables/${tableId}`).remove();
    }
}

function addProduct() {
    const name = document.getElementById('new-product-name').value;
    const price = parseFloat(document.getElementById('new-product-price').value);
    const stock = parseInt(document.getElementById('new-product-stock').value);

    if (!name || isNaN(price) || isNaN(stock)) {
        alert('Please fill all product fields correctly.');
        return;
    }
    const newProductId = `prod${Date.now()}`;
    db.ref(`products/${newProductId}`).set({ name, price, stock })
        .then(() => {
            document.getElementById('new-product-name').value = '';
            document.getElementById('new-product-price').value = '';
            document.getElementById('new-product-stock').value = '';
        });
}

function updateProduct(productId) {
    const container = document.querySelector(`.product-item:has(button[data-id="${productId}"])`);
    const nameInput = container.querySelector(`input[data-field="name"]`);
    const priceInput = container.querySelector(`input[data-field="price"]`);
    const stockInput = container.querySelector(`input[data-field="stock"]`);

    const updates = {
        name: nameInput.value,
        price: parseFloat(priceInput.value),
        stock: parseInt(stockInput.value)
    };

    db.ref(`products/${productId}`).update(updates)
        .then(() => alert(`Product ${updates.name} updated.`))
        .catch(error => alert(`Error: ${error.message}`));
}

function removeProduct(productId) {
    if (confirm('Are you sure you want to remove this product?')) {
        db.ref(`products/${productId}`).remove();
    }
}

function resetDailyData() {
    if (confirm('ARE YOU SURE? This will reset all revenue and expenses for the day to zero.')) {
        db.ref('dailyBook').set({
            expenses: null,
            revenue: null
        }).then(() => alert('Daily data has been reset.'));
    }
}