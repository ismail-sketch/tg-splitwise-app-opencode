import dotenv from 'dotenv';
import { initDatabase } from './db/database.js';
import { createApiServer } from './api/server.js';
import { createTelegramBot } from './bot/bot.js';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = process.env.WEBAPP_URL || 'http://localhost:5173';

async function main() {
  console.log('🚀 Starting Telegram Splitwise Backend...');

  // Initialize SQLite database
  initDatabase();

  // Create Express API server
  const app = createApiServer();
  app.listen(PORT, () => {
    console.log(`🌐 API server running on http://localhost:${PORT}`);
  });

  // Start Telegram Bot
  if (BOT_TOKEN && !BOT_TOKEN.startsWith('123456:')) {
    const bot = createTelegramBot(BOT_TOKEN, WEBAPP_URL);
    bot.start({
      onStart: (botInfo) => {
        console.log(`🤖 Telegram Bot @${botInfo.username} started successfully!`);
      },
    });
  } else {
    console.log('⚠️ BOT_TOKEN not set or is mock token. Bot polling disabled (API mode active).');
  }
}

main().catch((err) => {
  console.error('❌ Failed to start server:', err);
});
