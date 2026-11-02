import express, { Request, Response } from 'express';
import cors from 'cors';
import { db } from '../db/database.js';
import { calculateSimplifiedDebts } from '../services/debtOptimizer.js';
import crypto from 'crypto';

export function createApiServer() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Helper to validate Telegram WebApp initData (optional/mockable in dev)
  function validateTelegramInitData(initData: string, botToken: string): boolean {
    if (!botToken || botToken.startsWith('123456:')) return true; // Dev mode mock
    try {
      const urlParams = new URLSearchParams(initData);
      const hash = urlParams.get('hash');
      urlParams.delete('hash');
      const paramsList: string[] = [];
      urlParams.sort();
      urlParams.forEach((val, key) => paramsList.push(`${key}=${val}`));
      const dataCheckString = paramsList.join('\n');
      const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
      const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
      return calculatedHash === hash;
    } catch {
      return false;
    }
  }

  // Get user groups
  app.get('/api/users/:userId/groups', (req: Request, res: Response) => {
    const userId = Number(req.params.userId);
    const groups = db.prepare(`
      SELECT g.* FROM groups g
      JOIN group_members gm ON g.id = gm.group_id
      WHERE gm.user_id = ?
    `).all(userId);
    res.json({ success: true, groups });
  });

  // Create new group
  app.post('/api/groups', (req: Request, res: Response) => {
    const { title, userId, userName } = req.body;
    if (!title || !userId) {
      return res.status(400).json({ success: false, error: 'Missing title or userId' });
    }

    // Ensure user exists
    db.prepare(`
      INSERT OR IGNORE INTO users (id, first_name) VALUES (?, ?)
    `).run(userId, userName || 'User');

    const result = db.prepare(`
      INSERT INTO groups (title, created_by) VALUES (?, ?)
    `).run(title, userId);

    const groupId = result.lastInsertRowid;

    db.prepare(`
      INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)
    `).run(groupId, userId);

    res.json({ success: true, groupId });
  });

  // Get group details, members, expenses & debt settlement
  app.get('/api/groups/:groupId/details', (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);

    const group = db.prepare(`SELECT * FROM groups WHERE id = ?`).get(groupId);
    if (!group) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    const members = db.prepare(`
      SELECT u.id, u.first_name as firstName, u.last_name as lastName, u.username
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = ?
    `).all(groupId) as any[];

    const expensesRaw = db.prepare(`
      SELECT e.*, u.first_name as paidByName
      FROM expenses e
      JOIN users u ON e.paid_by_user_id = u.id
      WHERE e.group_id = ?
      ORDER BY e.created_at DESC
    `).all(groupId) as any[];

    const expenses = expensesRaw.map((exp) => {
      const splits = db.prepare(`
        SELECT user_id as userId, owed_amount as owedAmount
        FROM expense_splits WHERE expense_id = ?
      `).all(exp.id);
      return {
        id: exp.id,
        groupId: exp.group_id,
        paidByUserId: exp.paid_by_user_id,
        paidByName: exp.paidByName,
        amount: exp.amount,
        description: exp.description,
        category: exp.category,
        createdAt: exp.created_at,
        splits,
      };
    });

    const simplifiedDebts = calculateSimplifiedDebts(members, expenses);

    res.json({
      success: true,
      group,
      members,
      expenses,
      simplifiedDebts,
    });
  });

  // Add expense
  app.post('/api/expenses', (req: Request, res: Response) => {
    const { groupId, paidByUserId, amount, description, category, splitUserIds } = req.body;

    if (!groupId || !paidByUserId || !amount || !description) {
      return res.status(400).json({ success: false, error: 'Missing required expense fields' });
    }

    const splits = splitUserIds && splitUserIds.length > 0 ? splitUserIds : 
      db.prepare(`SELECT user_id FROM group_members WHERE group_id = ?`).all(groupId).map((m: any) => m.user_id);

    const splitAmount = amount / splits.length;

    const transaction = db.transaction(() => {
      const expRes = db.prepare(`
        INSERT INTO expenses (group_id, paid_by_user_id, amount, description, category)
        VALUES (?, ?, ?, ?, ?)
      `).run(groupId, paidByUserId, amount, description, category || 'Общие');

      const expenseId = expRes.lastInsertRowid;

      const insertSplit = db.prepare(`
        INSERT INTO expense_splits (expense_id, user_id, owed_amount) VALUES (?, ?, ?)
      `);

      splits.forEach((userId: number) => {
        insertSplit.run(expenseId, userId, splitAmount);
      });

      return expenseId;
    });

    const expenseId = transaction();
    res.json({ success: true, expenseId });
  });

  // Join group
  app.post('/api/groups/join', (req: Request, res: Response) => {
    const { groupId, userId, userName } = req.body;
    if (!groupId || !userId) {
      return res.status(400).json({ success: false, error: 'Missing groupId or userId' });
    }

    db.prepare(`
      INSERT OR IGNORE INTO users (id, first_name) VALUES (?, ?)
    `).run(userId, userName || 'User');

    db.prepare(`
      INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)
    `).run(groupId, userId);

    res.json({ success: true });
  });

  return app;
}
