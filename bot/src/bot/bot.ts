import { Bot, InlineKeyboard } from 'grammy';
import { db } from '../db/database.js';
import { calculateSimplifiedDebts } from '../services/debtOptimizer.js';
import dotenv from 'dotenv';

dotenv.config();

export function createTelegramBot(token: string, webAppUrl: string) {
  const bot = new Bot(token);

  // Helper to ensure user is registered in DB
  const ensureUser = (ctx: any) => {
    if (!ctx.from) return;
    const { id, username, first_name, last_name } = ctx.from;
    db.prepare(`
      INSERT INTO users (id, username, first_name, last_name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username=excluded.username,
        first_name=excluded.first_name,
        last_name=excluded.last_name
    `).run(id, username || null, first_name || '', last_name || null);
  };

  // /start command
  bot.command('start', async (ctx) => {
    ensureUser(ctx);

    const keyboard = new InlineKeyboard().webApp('📊 Открыть Mini App', webAppUrl);

    await ctx.reply(
      `👋 Привет, ${ctx.from?.first_name || 'друг'}!\n\n` +
      `Я бот для совместного учета расходов и долгов (Splitwise для Telegram).\n\n` +
      `✨ **Что я умею:**\n` +
      `• Делить общие чеки в поездках, кафе и вечеринках\n` +
      `• Автоматически рассчитывать и минимизировать долги\n` +
      `• Показывать детальную аналитику в Telegram Mini App\n\n` +
      `📝 **Быстрые команды:**\n` +
      `• /newgroup <название> — создать группу расходов\n` +
      `• /add <сумма> <описание> — добавить быстрый расход\n` +
      `• /debts — посмотреть, кто кому должен\n\n` +
      `Нажми кнопку ниже, чтобы открыть интерактивное приложение! 👇`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  });

  // /newgroup <title>
  bot.command('newgroup', async (ctx) => {
    ensureUser(ctx);
    const title = ctx.match?.trim();

    if (!title) {
      return ctx.reply('⚠️ Пожалуйста, укажите название группы.\nПример: `/newgroup Поездка на Алтай`', {
        parse_mode: 'Markdown',
      });
    }

    const userId = ctx.from!.id;
    const res = db.prepare(`
      INSERT INTO groups (title, created_by) VALUES (?, ?)
    `).run(title, userId);

    const groupId = res.lastInsertRowid;

    db.prepare(`
      INSERT INTO group_members (group_id, user_id) VALUES (?, ?)
    `).run(groupId, userId);

    const groupUrl = `${webAppUrl}?groupId=${groupId}`;
    const keyboard = new InlineKeyboard().webApp(`📊 Открыть "${title}"`, groupUrl);

    await ctx.reply(
      `🎉 Группа **"${title}"** успешно создана!\nID группы: \`${groupId}\`\n\n` +
      `Пригласите друзей в группу или откройте приложение для управления.`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  });

  // /debts [groupId]
  bot.command('debts', async (ctx) => {
    ensureUser(ctx);
    const userId = ctx.from!.id;

    // Find the latest group user belongs to, or specific ID
    const arg = ctx.match?.trim();
    let groupId = arg ? Number(arg) : null;

    if (!groupId) {
      const lastGroup = db.prepare(`
        SELECT g.id, g.title FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = ?
        ORDER BY g.created_at DESC LIMIT 1
      `).get(userId) as any;

      if (!lastGroup) {
        return ctx.reply('У вас пока нет активных групп. Создайте группу с помощью /newgroup <название>');
      }
      groupId = lastGroup.id;
    }

    const group = db.prepare(`SELECT * FROM groups WHERE id = ?`).get(groupId) as any;
    if (!group) {
      return ctx.reply('Группа не найдена.');
    }

    const members = db.prepare(`
      SELECT u.id, u.first_name as firstName, u.last_name as lastName
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = ?
    `).all(groupId) as any[];

    const expensesRaw = db.prepare(`
      SELECT * FROM expenses WHERE group_id = ?
    `).all(groupId) as any[];

    const expenses = expensesRaw.map((e) => ({
      id: e.id,
      paidByUserId: e.paid_by_user_id,
      amount: e.amount,
      splits: db.prepare(`SELECT user_id as userId, owed_amount as owedAmount FROM expense_splits WHERE expense_id = ?`).all(e.id) as any[],
    }));

    const debts = calculateSimplifiedDebts(members, expenses);

    if (debts.length === 0) {
      return ctx.reply(`🤝 В группе **"${group.title}"** все долги закрыты! Никто никому ничего не должен.`, {
        parse_mode: 'Markdown',
      });
    }

    let message = `💰 **Взаиморасчеты в группе "${group.title}":**\n\n`;
    debts.forEach((d) => {
      message += `• **${d.fromName}** ➡️ переводит **${d.amount.toFixed(2)} ₽** ➡️ **${d.toName}**\n`;
    });

    const keyboard = new InlineKeyboard().webApp('📊 Подробнее в Mini App', `${webAppUrl}?groupId=${groupId}`);

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  // /add <amount> <description>
  bot.command('add', async (ctx) => {
    ensureUser(ctx);
    const userId = ctx.from!.id;
    const text = ctx.match?.trim() || '';
    const parts = text.split(' ');

    const amount = parseFloat(parts[0]);
    const description = parts.slice(1).join(' ');

    if (isNaN(amount) || !description) {
      return ctx.reply(
        '⚠️ Неверный формат команды.\nПример: `/add 1500 Пицца и напитки`',
        { parse_mode: 'Markdown' }
      );
    }

    const lastGroup = db.prepare(`
      SELECT g.id, g.title FROM groups g
      JOIN group_members gm ON g.id = gm.group_id
      WHERE gm.user_id = ?
      ORDER BY g.created_at DESC LIMIT 1
    `).get(userId) as any;

    if (!lastGroup) {
      return ctx.reply('Сначала создайте группу с помощью `/newgroup <название>`.', { parse_mode: 'Markdown' });
    }

    const members = db.prepare(`SELECT user_id FROM group_members WHERE group_id = ?`).all(lastGroup.id) as any[];
    const splitAmount = amount / (members.length || 1);

    const tx = db.transaction(() => {
      const expRes = db.prepare(`
        INSERT INTO expenses (group_id, paid_by_user_id, amount, description, category)
        VALUES (?, ?, ?, ?, 'Общие')
      `).run(lastGroup.id, userId, amount, description);

      const expId = expRes.lastInsertRowid;
      const insertSplit = db.prepare(`
        INSERT INTO expense_splits (expense_id, user_id, owed_amount) VALUES (?, ?, ?)
      `);

      members.forEach((m) => {
        insertSplit.run(expId, m.user_id, splitAmount);
      });
    });

    tx();

    await ctx.reply(
      `✅ Расход записан в группу **"${lastGroup.title}"**!\n` +
      `💳 Сумма: **${amount.toFixed(2)} ₽**\n` +
      `📝 Описание: ${description}\n` +
      `👥 Разделено между: ${members.length} участн. (~${splitAmount.toFixed(2)} ₽ на каждого)`,
      { parse_mode: 'Markdown' }
    );
  });

  return bot;
}
