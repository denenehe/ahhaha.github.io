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

// --- GLOBAL VARIABLES ---
let currentTableId = null;
let config = {}, products = {}, tables = {};

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

// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', initApp);
loginButton.addEventListener('click', handleLogin);
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

// --- INITIALIZATION ---
function initApp() {
    db.ref('config').on('value', (snapshot) => {
        config = snapshot.val() || {};
        updateUIBasedOnConfig();
    });
    db.ref('products').on('value', (snapshot) => {
        products = snapshot.val() || {};
        populateProductSelect();
        populateMenuList();
    });

    // --- MODIFIED: This listener is now smarter ---
    db.ref('tables').on('value', (snapshot) => {
        tables = snapshot.val() || {};
        renderTables(); // Always re-render the main table grid

        // --- THIS IS THE FIX ---
        // If the order modal is currently open, refresh its content too!
        if (orderModal.style.display === 'flex' && currentTableId) {
            renderExistingOrder();
        }
        // --- END OF FIX ---
    });
    
    db.ref('dailyBook/expenses').on('value', (snapshot) => renderCashbook(snapshot.val() || {}));
}

// --- CORE FUNCTIONS ---
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

function handleLogin() {
    const enteredPassword = passwordInput.value;
    if (enteredPassword === config.userPassword) {
        loginScreen.style.display = 'none';
        appContainer.classList.remove('hidden');
        loginError.textContent = '';
        passwordInput.value = '';
    } else {
        loginError.textContent = 'Incorrect password.';
    }
}

function renderTables() {
    tableGridContainer.innerHTML = '';
    Object.keys(tables).sort().forEach(tableId => {
        const table = tables[tableId];
        const tableBtn = document.createElement('button');
        tableBtn.className = `table-btn ${table.status}`;
        tableBtn.textContent = table.name;
        tableBtn.dataset.tableId = tableId;
        tableBtn.addEventListener('click', () => openOrderModal(tableId));
        tableGridContainer.appendChild(tableBtn);
    });
}

function populateProductSelect() {
    productSelect.innerHTML = '<option value="">-- Select a product --</option>';
    Object.keys(products).forEach(prodId => {
        const product = products[prodId];
        const option = document.createElement('option');
        option.value = prodId;

        if (product.stock > 0) {
            option.textContent = `${product.name} - $${product.price.toFixed(2)}`;
        } else {
            option.textContent = `${product.name} (OUT OF STOCK)`;
            option.disabled = true;
        }
        productSelect.appendChild(option);
    });
}

function openOrderModal(tableId) {
    currentTableId = tableId;
    const table = tables[tableId];

    if (table.status === 'free') {
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
        const listItem = document.createElement('li');
        
        const displayName = item.notes ? `${item.name} (${item.notes})` : item.name;
        listItem.textContent = `${item.quantity} x ${displayName} @ $${item.price.toFixed(2)} each`;
        
        if (tables[currentTableId].status !== 'confirmed') {
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.className = 'remove-item-btn';
            removeBtn.onclick = () => removeItemFromOrder(itemId);
            listItem.appendChild(removeBtn);
        }

        orderList.appendChild(listItem);
        total += item.quantity * item.price;
    });

    existingOrderDetails.innerHTML = '';
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

function addProductToOrder() {
    const selectedProductId = productSelect.value;
    const quantityToAdd = parseInt(document.getElementById('quantity-input').value);
    const notes = document.getElementById('order-notes').value.trim();

    if (!selectedProductId || quantityToAdd < 1) {
        alert('Please select a product and a valid quantity.');
        return;
    }

    const product = products[selectedProductId];
    const order = tables[currentTableId]?.order;
    let itemExists = false;
    let existingItemId = null;
    let newQuantity = 0;

    if (order && order.items) {
        for (const itemId in order.items) {
            const currentItem = order.items[itemId];
            if (currentItem.productId === selectedProductId && currentItem.notes === notes) {
                itemExists = true;
                existingItemId = itemId;
                newQuantity = currentItem.quantity + quantityToAdd;
                break;
            }
        }
    }

    if (itemExists) {
        const itemPath = `tables/${currentTableId}/order/items/${existingItemId}/quantity`;
        db.ref(itemPath).set(newQuantity);
    } 
    else {
        const orderItem = {
            name: product.name,
            price: product.price,
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
    const price = parseFloat(document.getElementById('custom-item-price').value);
    if (!name || isNaN(price) || price <= 0) return;

    const orderItem = { name, price, quantity: 1, isCustom: true, notes: '' };
    db.ref(`tables/${currentTableId}/order/items/${Date.now()}`).set(orderItem);
    document.getElementById('custom-item-name').value = '';
    document.getElementById('custom-item-price').value = '';
}

function confirmOrder() {
    const table = tables[currentTableId];
    if (!table.order || !table.order.items) {
        alert('Cannot confirm an empty order. Please add items first.');
        return;
    }

    const stockUpdates = {};
    let isStockSufficient = true;

    for (const itemId in table.order.items) {
        const item = table.order.items[itemId];
        if (!item.isCustom && item.productId) {
            const currentStock = products[item.productId].stock;
            if (currentStock < item.quantity) {
                alert(`Not enough stock for ${item.name}. Only ${currentStock} left.`);
                isStockSufficient = false;
                break;
            }
        }
    }

    if (!isStockSufficient) {
        return;
    }

    for (const itemId in table.order.items) {
        const item = table.order.items[itemId];
        if (!item.isCustom && item.productId) {
            const newStock = products[item.productId].stock - item.quantity;
            stockUpdates[`/products/${item.productId}/stock`] = newStock;
        }
    }
    
    db.ref().update(stockUpdates);

    db.ref(`tables/${currentTableId}/status`).set('confirmed').then(() => {
        orderModal.style.display = 'none';
    });
}

function settleAndPayOrder() {
    const table = tables[currentTableId];
    if (table.status !== 'confirmed') {
        alert('This order has not been confirmed yet.');
        return;
    }

    let orderTotal = 0;
    Object.values(table.order.items).forEach(item => {
        orderTotal += item.price * item.quantity;
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
    });
}

function showMenuModal() {
    menuModal.style.display = 'flex';
}

function populateMenuList() {
    const menuList = document.getElementById('menu-list');
    menuList.innerHTML = '';
    Object.values(products).forEach(product => {
        const li = document.createElement('li');
        li.textContent = `${product.name} - $${product.price.toFixed(2)}`;
        menuList.appendChild(li);
    });
}

function showCashbookModal() {
    cashbookModal.style.display = 'flex';
}

function renderCashbook(expenses) {
    const listDiv = document.getElementById('cashbook-list');
    listDiv.innerHTML = '<h4>Today\'s Expenses</h4>';
    if (Object.keys(expenses).length === 0) {
        listDiv.innerHTML += '<p>No expenses recorded today.</p>';
        return;
    }
    const ul = document.createElement('ul');
    Object.values(expenses).forEach(exp => {
        const li = document.createElement('li');
        li.textContent = `${exp.name}: $${exp.amount.toFixed(2)}`;
        ul.appendChild(li);
    });
    listDiv.appendChild(ul);
}

function addExpense() {
    const name = document.getElementById('expense-name').value.trim();
    const amount = parseFloat(document.getElementById('expense-amount').value);
    if (!name || isNaN(amount) || amount <= 0) {
        alert('Please enter a valid expense name and amount.');
        return;
    }
    db.ref('dailyBook/expenses').push().set({ name, amount })
        .then(() => {
            document.getElementById('expense-name').value = '';
            document.getElementById('expense-amount').value = '';
        });
}