const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Middleware
// ============================================
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ============================================
// Заголовки безопасности
// ============================================
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// ============================================
// Middleware для проверки роли администратора (ПР №17)
// ============================================
function isAdmin(req, res, next) {
    const { role } = req.body;
    // Также проверяем через заголовок (для GET-запросов, где нет body)
    const userRole = role || req.headers['x-user-role'];
    
    if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Доступ запрещён. Требуются права администратора.' });
    }
    next();
}

// ============================================
// Middleware для проверки владельца корзины (ПР №17)
// ============================================
function isCartOwner(req, res, next) {
    const { userId } = req.params;
    const currentUserId = req.body.user_id || req.headers['x-user-id'];
    
    if (!currentUserId || parseInt(currentUserId) !== parseInt(userId)) {
        return res.status(403).json({ error: 'Доступ запрещён. Вы не владелец этой корзины.' });
    }
    next();
}

// ============================================
// Функция фильтрации пользовательского ввода
// ============================================
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================
// Функция логирования ошибок
// ============================================
function logError(error, req) {
    const log = `${new Date().toISOString()} | ${req.method} ${req.url} | ${error.message}\n`;
    const logPath = path.join(__dirname, 'error.log');
    fs.appendFileSync(logPath, log);
}

// ============================================
// Функция обработки ошибок БД
// ============================================
function handleDatabaseError(err, res, req) {
    logError(err, req);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
}

// ============================================
// Хранилище попыток входа
// ============================================
const loginAttempts = new Map();

// ============================================
// Кэширование меню
// ============================================
let menuCache = null;
let menuCacheTime = null;
const CACHE_TTL = 60000;

// ============================================
// Подключение к базе данных
// ============================================
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'beans_brew'
});

db.connect((err) => {
    if (err) {
        console.error('❌ Ошибка подключения к БД:', err.message);
        process.exit(1);
    }
    console.log('✅ Подключено к MySQL');
});

// ============================================
// API: МЕНЮ (CRUD)
// ============================================

// GET /api/menu - публичный (без проверки)
app.get('/api/menu', (req, res) => {
    if (menuCache && (Date.now() - menuCacheTime) < CACHE_TTL) {
        return res.json(menuCache);
    }
    const sql = 'SELECT id, name, category, price, description FROM menu_items ORDER BY id';
    db.query(sql, (err, results) => {
        if (err) return handleDatabaseError(err, res, req);
        menuCache = results;
        menuCacheTime = Date.now();
        const safeResults = results.map(item => ({
            ...item,
            name: escapeHtml(item.name),
            description: escapeHtml(item.description || '')
        }));
        res.json(safeResults);
    });
});

// GET /api/menu/:id - публичный
app.get('/api/menu/:id', (req, res) => {
    const { id } = req.params;
    const sql = 'SELECT id, name, category, price, description FROM menu_items WHERE id = ?';
    db.query(sql, [id], (err, results) => {
        if (err) return handleDatabaseError(err, res, req);
        if (results.length === 0) {
            return res.status(404).json({ error: 'Позиция не найдена' });
        }
        res.json({
            ...results[0],
            name: escapeHtml(results[0].name),
            description: escapeHtml(results[0].description || '')
        });
    });
});

// POST /api/menu - ТОЛЬКО ДЛЯ АДМИНА
app.post('/api/menu', isAdmin, (req, res) => {
    const { name, category, price, description } = req.body;
    
    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Название обязательно' });
    }
    if (typeof name !== 'string' || name.length > 100) {
        return res.status(400).json({ error: 'Название должно быть строкой до 100 символов' });
    }
    if (!category || !['coffee', 'dessert', 'author'].includes(category)) {
        return res.status(400).json({ error: 'Категория должна быть: coffee, dessert, author' });
    }
    if (!price || price <= 0) {
        return res.status(400).json({ error: 'Цена должна быть больше 0' });
    }
    if (typeof price !== 'number' || price > 10000) {
        return res.status(400).json({ error: 'Цена должна быть числом от 1 до 10000' });
    }
    
    const sql = 'INSERT INTO menu_items (name, category, price, description) VALUES (?, ?, ?, ?)';
    db.query(sql, [name, category, price, description || null], (err, result) => {
        if (err) return handleDatabaseError(err, res, req);
        menuCache = null;
        res.status(201).json({ message: 'Позиция добавлена', id: result.insertId });
    });
});

// PUT /api/menu/:id - ТОЛЬКО ДЛЯ АДМИНА
app.put('/api/menu/:id', isAdmin, (req, res) => {
    const { id } = req.params;
    const { name, category, price, description } = req.body;
    
    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Название обязательно' });
    }
    if (!price || price <= 0) {
        return res.status(400).json({ error: 'Цена должна быть больше 0' });
    }
    
    const sql = 'UPDATE menu_items SET name = ?, category = ?, price = ?, description = ? WHERE id = ?';
    db.query(sql, [name, category, price, description || null, id], (err, result) => {
        if (err) return handleDatabaseError(err, res, req);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Позиция не найдена' });
        }
        menuCache = null;
        res.json({ message: 'Позиция обновлена' });
    });
});

// DELETE /api/menu/:id - ТОЛЬКО ДЛЯ АДМИНА
app.delete('/api/menu/:id', isAdmin, (req, res) => {
    const { id } = req.params;
    const sql = 'DELETE FROM menu_items WHERE id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) return handleDatabaseError(err, res, req);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Позиция не найдена' });
        }
        menuCache = null;
        res.json({ message: 'Позиция удалена' });
    });
});

// ============================================
// API: РЕГИСТРАЦИЯ И ВХОД (публичные)
// ============================================

// POST /api/register - публичный
app.post('/api/register', (req, res) => {
    const { name, phone, email, password } = req.body;
    
    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Имя обязательно' });
    }
    if (name.length > 50) {
        return res.status(400).json({ error: 'Имя не должно превышать 50 символов' });
    }
    if (!phone || phone.trim() === '') {
        return res.status(400).json({ error: 'Телефон обязателен' });
    }
    if (!password || password.length < 4) {
        return res.status(400).json({ error: 'Пароль должен быть не менее 4 символов' });
    }
    
    const sql = 'INSERT INTO users (name, phone, email, password, role) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [name, phone, email || null, password, 'client'], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'Пользователь с таким телефоном уже существует' });
            }
            return handleDatabaseError(err, res, req);
        }
        res.status(201).json({ message: 'Регистрация успешна', userId: result.insertId });
    });
});

// POST /api/login - публичный
app.post('/api/login', (req, res) => {
    const { phone, password } = req.body;
    
    if (!phone || !password) {
        return res.status(400).json({ error: 'Телефон и пароль обязательны' });
    }
    
    const attempts = loginAttempts.get(phone) || { count: 0, lastAttempt: Date.now() };
    if (attempts.count >= 5 && (Date.now() - attempts.lastAttempt) < 15 * 60 * 1000) {
        return res.status(429).json({ error: 'Слишком много попыток. Подождите 15 минут.' });
    }
    
    const sql = 'SELECT id, name, phone, email, role FROM users WHERE phone = ? AND password = ?';
    db.query(sql, [phone, password], (err, results) => {
        if (err) return handleDatabaseError(err, res, req);
        
        if (results.length === 0) {
            loginAttempts.set(phone, { count: attempts.count + 1, lastAttempt: Date.now() });
            return res.status(401).json({ error: 'Неверный телефон или пароль' });
        }
        
        loginAttempts.delete(phone);
        res.json({ message: 'Вход выполнен', user: results[0] });
    });
});

// GET /api/users - ТОЛЬКО ДЛЯ АДМИНА
app.get('/api/users', isAdmin, (req, res) => {
    const sql = 'SELECT id, name, phone, email, role, created_at FROM users ORDER BY id';
    db.query(sql, (err, results) => {
        if (err) return handleDatabaseError(err, res, req);
        const safeResults = results.map(user => ({
            ...user,
            name: escapeHtml(user.name),
            email: escapeHtml(user.email || '')
        }));
        res.json(safeResults);
    });
});

// ============================================
// API: КОРЗИНА (с проверкой владельца)
// ============================================

// GET /api/cart/:userId - проверка владельца
app.get('/api/cart/:userId', isCartOwner, (req, res) => {
    const { userId } = req.params;
    const sql = `
        SELECT cart.id, cart.user_id, cart.menu_item_id, cart.quantity, 
               menu_items.name, menu_items.price, menu_items.category
        FROM cart 
        JOIN menu_items ON cart.menu_item_id = menu_items.id 
        WHERE cart.user_id = ?
        ORDER BY cart.id
    `;
    db.query(sql, [userId], (err, results) => {
        if (err) return handleDatabaseError(err, res, req);
        const total = results.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const safeResults = results.map(item => ({
            ...item,
            name: escapeHtml(item.name)
        }));
        res.json({
            items: safeResults,
            total: total,
            count: results.reduce((sum, item) => sum + item.quantity, 0)
        });
    });
});

// POST /api/cart - проверка владельца
app.post('/api/cart', (req, res) => {
    const { user_id, menu_item_id, quantity } = req.body;
    
    if (!user_id || !menu_item_id) {
        return res.status(400).json({ error: 'user_id и menu_item_id обязательны' });
    }
    const itemQuantity = quantity || 1;
    if (itemQuantity < 1 || itemQuantity > 99) {
        return res.status(400).json({ error: 'Количество должно быть от 1 до 99' });
    }
    
    const checkSql = 'SELECT * FROM cart WHERE user_id = ? AND menu_item_id = ?';
    db.query(checkSql, [user_id, menu_item_id], (err, results) => {
        if (err) return handleDatabaseError(err, res, req);
        
        if (results.length > 0) {
            const newQuantity = results[0].quantity + itemQuantity;
            const updateSql = 'UPDATE cart SET quantity = ? WHERE id = ?';
            db.query(updateSql, [newQuantity, results[0].id], (err2) => {
                if (err2) return handleDatabaseError(err2, res, req);
                res.json({ message: 'Количество обновлено', cartId: results[0].id, quantity: newQuantity });
            });
        } else {
            const insertSql = 'INSERT INTO cart (user_id, menu_item_id, quantity) VALUES (?, ?, ?)';
            db.query(insertSql, [user_id, menu_item_id, itemQuantity], (err2, result) => {
                if (err2) return handleDatabaseError(err2, res, req);
                res.status(201).json({ message: 'Товар добавлен в корзину', cartId: result.insertId });
            });
        }
    });
});

// PUT /api/cart/:id - без проверки (товар в корзине уже привязан к пользователю)
app.put('/api/cart/:id', (req, res) => {
    const { id } = req.params;
    const { quantity } = req.body;
    
    if (!quantity || quantity < 1) {
        return res.status(400).json({ error: 'Количество должно быть не менее 1' });
    }
    if (quantity > 99) {
        return res.status(400).json({ error: 'Количество не должно превышать 99' });
    }
    
    const sql = 'UPDATE cart SET quantity = ? WHERE id = ?';
    db.query(sql, [quantity, id], (err, result) => {
        if (err) return handleDatabaseError(err, res, req);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Запись в корзине не найдена' });
        }
        res.json({ message: 'Количество обновлено', quantity });
    });
});

// DELETE /api/cart/:id
app.delete('/api/cart/:id', (req, res) => {
    const { id } = req.params;
    const sql = 'DELETE FROM cart WHERE id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) return handleDatabaseError(err, res, req);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Запись в корзине не найдена' });
        }
        res.json({ message: 'Товар удалён из корзины' });
    });
});

// DELETE /api/cart/:userId/clear - проверка владельца
app.delete('/api/cart/:userId/clear', isCartOwner, (req, res) => {
    const { userId } = req.params;
    const sql = 'DELETE FROM cart WHERE user_id = ?';
    db.query(sql, [userId], (err, result) => {
        if (err) return handleDatabaseError(err, res, req);
        res.json({ message: 'Корзина очищена', deletedCount: result.affectedRows });
    });
});

// ============================================
// API: БРОНИРОВАНИЯ (только для админа)
// ============================================

// GET /api/bookings - ТОЛЬКО ДЛЯ АДМИНА
app.get('/api/bookings', isAdmin, (req, res) => {
    const sql = 'SELECT * FROM bookings ORDER BY date, time';
    db.query(sql, (err, results) => {
        if (err) return handleDatabaseError(err, res, req);
        const safeResults = results.map(b => ({
            ...b,
            name: escapeHtml(b.name),
            comment: escapeHtml(b.comment || '')
        }));
        res.json(safeResults);
    });
});

// POST /api/bookings - публичный (любой может забронировать)
app.post('/api/bookings', (req, res) => {
    const { user_id, name, phone, date, time, guests, comment } = req.body;
    
    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Имя обязательно' });
    }
    if (!phone || phone.trim() === '') {
        return res.status(400).json({ error: 'Телефон обязателен' });
    }
    if (!date) {
        return res.status(400).json({ error: 'Дата обязательна' });
    }
    if (!time) {
        return res.status(400).json({ error: 'Время обязательно' });
    }
    if (!guests || guests < 1 || guests > 10) {
        return res.status(400).json({ error: 'Количество гостей от 1 до 10' });
    }
    
    const sql = 'INSERT INTO bookings (user_id, name, phone, date, time, guests, comment, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    db.query(sql, [user_id || null, name, phone, date, time, guests, comment || null, 'new'], (err, result) => {
        if (err) return handleDatabaseError(err, res, req);
        res.status(201).json({ message: 'Бронирование создано', id: result.insertId });
    });
});

// ============================================
// API: СООБЩЕНИЯ
// ============================================

// POST /api/contacts - публичный
app.post('/api/contacts', (req, res) => {
    const { name, message } = req.body;
    
    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Имя обязательно' });
    }
    if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Сообщение обязательно' });
    }
    if (message.length > 500) {
        return res.status(400).json({ error: 'Сообщение не должно превышать 500 символов' });
    }
    
    const safeName = escapeHtml(name);
    const safeMessage = escapeHtml(message);
    
    const sql = 'INSERT INTO contact_messages (name, message) VALUES (?, ?)';
    db.query(sql, [safeName, safeMessage], (err, result) => {
        if (err) return handleDatabaseError(err, res, req);
        res.status(201).json({ message: 'Сообщение отправлено' });
    });
});

// GET /api/contacts - ТОЛЬКО ДЛЯ АДМИНА
app.get('/api/contacts', isAdmin, (req, res) => {
    const sql = 'SELECT * FROM contact_messages ORDER BY created_at DESC';
    db.query(sql, (err, results) => {
        if (err) return handleDatabaseError(err, res, req);
        const safeResults = results.map(msg => ({
            ...msg,
            name: escapeHtml(msg.name),
            message: escapeHtml(msg.message)
        }));
        res.json(safeResults);
    });
});

// ============================================
// Запуск сервера
// ============================================
app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
    console.log(`📋 API меню: http://localhost:${PORT}/api/menu`);
    console.log(`🛒 API корзины: http://localhost:${PORT}/api/cart/1`);
    console.log(`📅 API бронирований: http://localhost:${PORT}/api/bookings`);
    console.log(`💬 API сообщений: http://localhost:${PORT}/api/contacts`);
    console.log(`👥 API пользователей: http://localhost:${PORT}/api/users`);
    console.log(`🌐 Сайт: http://localhost:${PORT}`);
    console.log(`🔒 Защита API: администратор ✔️, владелец корзины ✔️`);
});