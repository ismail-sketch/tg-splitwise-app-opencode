# 📊 Telegram Splitwise App (Bot + Telegram Mini App)

Полнофункциональный трекер совместных расходов и долгов для Telegram, состоящий из асинхронного Telegram-бота и интерактивного Telegram Mini App (TMA).

## 🚀 Стек технологий

- **Backend / Bot:** Python 3, FastAPI, aiogram 3, SQLite (встроенная база данных без внешних компиляций).
- **Frontend / Mini App:** React, Vite, TypeScript, Tailwind CSS, Telegram WebApp SDK.
- **Алгоритмы:** Алгоритм минимизации и упрощения взаимных долгов (Splitwise Debt Simplification).

---

## 📁 Структура проекта

```
tg-splitwise-app/
├── bot/                # Python бэкенд, FastAPI REST API и aiogram бот
│   ├── main.py         # Основной файл запуска бэкенда и бота
│   ├── requirements.txt# Зависимости Python
│   └── database.sqlite # SQLite база данных
└── webapp/             # React + Vite Telegram Mini App фронтенд
    ├── src/
    │   ├── App.tsx     # Главный интерфейс Mini App (балансы, графики, долги)
    │   └── ...
    ├── package.json
    └── vite.config.ts
```

---

## ⚙️ Инструкция по запуску

### 1. Запуск Backend (Бот + API)

1. Перейдите в папку `bot/`:
   ```bash
   cd bot
   ```
2. Установите зависимости:
   ```bash
   pip install -r requirements.txt
   ```
3. Создайте файл `.env` на основе примера или настройте переменные:
   - `BOT_TOKEN` — токен вашего Telegram-бота от `@BotFather`
   - `WEBAPP_URL` — URL вашего Mini App (например, `http://localhost:5173`)
4. Запустите бэкенд:
   ```bash
   python main.py
   ```

### 2. Запуск Telegram Mini App (Фронтенд)

1. Перейдите в папку `webapp/`:
   ```bash
   cd webapp
   ```
2. Установите зависимости:
   ```bash
   npm install
   ```
3. Запустите dev-сервер:
   ```bash
   npm run dev
   ```
4. Откройте локальный адрес (обычно `http://localhost:5173`) в браузере или привяжите к WebApp в BotFather.
