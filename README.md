# 📊 Telegram Splitwise App (Бот + Telegram Mini App)

Совместный трекер расходов и долгов для Telegram в формате гибридного бота и Telegram Mini App (TMA).

## 🚀 Стек технологий

- **Backend / Bot:** Node.js, TypeScript, [grammY](https://grammy.dev/) (Telegram Bot Framework), Express/Fastify API, SQLite (`better-sqlite3` / Kysely / Drizzle)
- **Frontend / Mini App:** React, Vite, TypeScript, Tailwind CSS, `@telegram-apps/sdk`
- **Алгоритмы:** Упрощение графа долгов (Debt Settlement Algorithm), учет категорий и валют

## 📁 Структура проекта

```
tg-splitwise-app/
├── bot/               # Бэкенд бота и API для Telegram Mini App
│   ├── src/
│   │   ├── bot/       # Команды и диалоги бота grammY
│   │   ├── api/       # REST API для связи с Mini App
│   │   ├── db/        # База данных SQLite и миграции
│   │   └── services/  # Расчет долгов, аналитика, валюты
│   └── package.json
├── webapp/            # Фронтенд Telegram Mini App (React + Vite)
│   ├── src/
│   │   ├── components/# Интерактивные графики, списки расходов, формы
│   │   ├── hooks/     # Telegram WebApp SDK хуки
│   │   └── api/       # Запросы к бэкенду
│   └── package.json
└── README.md
```

## 🛠 Подключение к GitHub

Чтобы привязать этот локальный репозиторий к GitHub:

1. Создайте новый репозиторий на GitHub (например, `tg-splitwise-app`).
2. В терминале выполните команды:
```bash
git remote add origin https://github.com/ВАШ_USERNAME/tg-splitwise-app.git
git branch -M main
git push -u origin main
```
