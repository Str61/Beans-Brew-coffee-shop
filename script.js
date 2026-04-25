// ============================================
// Глобальные переменные
// ============================================
let currentUser = null;

// ============================================
// Функции входа и регистрации
// ============================================

// Регистрация
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('regName').value;
    const phone = document.getElementById('regPhone').value;
    const password = document.getElementById('regPassword').value;

    const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, password })
    });

    const data = await response.json();
    if (response.ok) {
        alert('Регистрация успешна! Теперь войдите.');
        closeRegisterModal();
        openLoginModal();
    } else {
        alert(data.error);
    }
});

// Вход
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('loginPhone').value;
    const password = document.getElementById('loginPassword').value;

    const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password })
    });

    const data = await response.json();
    if (response.ok) {
        currentUser = data.user;
        alert(`Добро пожаловать, ${currentUser.name}!`);
        closeLoginModal();
        updateAuthUI();
        loadCart();
    } else {
        alert(data.error);
    }
});

// Выход
function logout() {
    currentUser = null;
    updateAuthUI();
    alert('Вы вышли из системы');
}

// Обновление UI в зависимости от авторизации
function updateAuthUI() {
    const authButtons = document.getElementById('authButtons');
    const userInfo = document.getElementById('userInfo');
    const cartCount = document.getElementById('cartCount');

    if (currentUser) {
        if (authButtons) authButtons.style.display = 'none';
        if (userInfo) {
            userInfo.style.display = 'flex';
            document.getElementById('userName').innerText = currentUser.name;
        }
        if (cartCount) cartCount.style.display = 'flex';
        loadCart();
    } else {
        if (authButtons) authButtons.style.display = 'flex';
        if (userInfo) userInfo.style.display = 'none';
        if (cartCount) cartCount.style.display = 'none';
    }
}

// ============================================
// Функции корзины
// ============================================

async function addToCart(menuItemId) {
    if (!currentUser) {
        alert('Сначала войдите в систему');
        openLoginModal();
        return;
    }

    const response = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: currentUser.id,
            menu_item_id: menuItemId,
            quantity: 1
        })
    });

    if (response.ok) {
        alert('Товар добавлен в корзину');
        loadCart();
    } else {
        const error = await response.json();
        alert(error.error);
    }
}

async function loadCart() {
    if (!currentUser) return;

    const response = await fetch(`/api/cart-full/${currentUser.id}`);
    const data = await response.json();

    // Обновляем счётчик на иконке корзины
    const cartCount = document.getElementById('cartCount');
    if (cartCount) cartCount.innerText = data.count;

    // Обновляем содержимое корзины в модальном окне
    const cartItems = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');
    if (cartItems) {
        cartItems.innerHTML = data.items.map(item => `
            <div class="cart-item" data-id="${item.id}">
                <span class="cart-item-name">${item.name}</span>
                <span class="cart-item-price">${item.price} ₽</span>
                <div class="cart-item-quantity">
                    <button onclick="updateCartItemQuantity(${item.id}, ${item.quantity - 1})">-</button>
                    <span>${item.quantity}</span>
                    <button onclick="updateCartItemQuantity(${item.id}, ${item.quantity + 1})">+</button>
                </div>
                <span class="cart-item-total">${item.price * item.quantity} ₽</span>
                <button class="cart-item-remove" onclick="removeCartItem(${item.id})">🗑</button>
            </div>
        `).join('');
        if (cartTotal) cartTotal.innerText = data.total;
    }
}

async function updateCartItemQuantity(cartId, newQuantity) {
    if (newQuantity < 1) {
        removeCartItem(cartId);
        return;
    }
    await fetch(`/api/cart/${cartId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: newQuantity })
    });
    loadCart();
}

async function removeCartItem(cartId) {
    await fetch(`/api/cart/${cartId}`, { method: 'DELETE' });
    loadCart();
}

async function clearCart() {
    if (!confirm('Очистить всю корзину?')) return;
    await fetch(`/api/cart/${currentUser.id}/clear`, { method: 'DELETE' });
    loadCart();
}

// ============================================
// Функции бронирования
// ============================================

document.getElementById('bookingForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('bookingName').value;
    const phone = document.getElementById('bookingPhone').value;
    const date = document.getElementById('bookingDate').value;
    const time = document.getElementById('bookingTime').value;
    const guests = document.getElementById('bookingGuests').value;
    const comment = document.getElementById('bookingComment').value;

    const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: currentUser?.id || null,
            name, phone, date, time, guests, comment
        })
    });

    const data = await response.json();
    if (response.ok) {
        alert('Бронирование создано!');
        document.getElementById('bookingForm').reset();
    } else {
        alert(data.error);
    }
});

// ============================================
// Функции сообщений из контактов
// ============================================

document.getElementById('contactForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('contactName').value;
    const message = document.getElementById('contactMessage').value;

    const response = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, message })
    });

    if (response.ok) {
        alert('Сообщение отправлено!');
        document.getElementById('contactForm').reset();
    } else {
        const error = await response.json();
        alert(error.error);
    }
});

// ============================================
// Модальные окна
// ============================================

function openLoginModal() {
    document.getElementById('loginModal').style.display = 'flex';
}

function closeLoginModal() {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('loginForm')?.reset();
}

function openRegisterModal() {
    closeLoginModal();
    document.getElementById('registerModal').style.display = 'flex';
}

function closeRegisterModal() {
    document.getElementById('registerModal').style.display = 'none';
    document.getElementById('registerForm')?.reset();
}

function openCartModal() {
    if (!currentUser) {
        alert('Сначала войдите в систему');
        openLoginModal();
        return;
    }
    loadCart();
    document.getElementById('cartModal').style.display = 'flex';
}

function closeCartModal() {
    document.getElementById('cartModal').style.display = 'none';
}

// Закрытие модальных окон при клике вне области
window.onclick = (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
};

// ============================================
// Инициализация после загрузки страницы
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // Проверяем, есть ли сохранённый пользователь в sessionStorage
    const savedUser = sessionStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        updateAuthUI();
        loadCart();
    }
});

// Сохраняем пользователя при входе
function updateAuthUI() {
    const authButtons = document.getElementById('authButtons');
    const userInfo = document.getElementById('userInfo');
    const cartCount = document.getElementById('cartCount');

    if (currentUser) {
        sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
        if (authButtons) authButtons.style.display = 'none';
        if (userInfo) {
            userInfo.style.display = 'flex';
            const userNameSpan = document.getElementById('userName');
            if (userNameSpan) userNameSpan.innerText = currentUser.name;
        }
        if (cartCount) cartCount.style.display = 'flex';
        loadCart();
    } else {
        sessionStorage.removeItem('currentUser');
        if (authButtons) authButtons.style.display = 'flex';
        if (userInfo) userInfo.style.display = 'none';
        if (cartCount) cartCount.style.display = 'none';
    }
}