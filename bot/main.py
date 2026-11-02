import os
import sqlite3
import asyncio
import logging
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.filters import Command

load_dotenv()

PORT = int(os.getenv("PORT", 3000))
BOT_TOKEN = os.getenv("BOT_TOKEN", "123456:ABC-DEF")
WEBAPP_URL = os.getenv("WEBAPP_URL", "http://localhost:5173")
DB_NAME = "database.sqlite"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- DATABASE SETUP ---
def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS group_members (
        group_id INTEGER,
        user_id INTEGER,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, user_id),
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        paid_by_user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        description TEXT NOT NULL,
        category TEXT DEFAULT 'Общие',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (paid_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS expense_splits (
        expense_id INTEGER,
        user_id INTEGER,
        owed_amount REAL NOT NULL,
        PRIMARY KEY (expense_id, user_id),
        FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    """)
    conn.commit()
    conn.close()
    logger.info("SQLite database initialized.")

init_db()

# --- DEBT OPTIMIZATION ALGORITHM ---
def calculate_simplified_debts(members, expenses):
    member_map = {m["id"]: f"{m['firstName']} {m.get('lastName', '')}".strip() or f"User {m['id']}" for m in members}
    balances = {m["id"]: 0.0 for m in members}

    for exp in expenses:
        payer = exp["paidByUserId"]
        amount = exp["amount"]
        if payer in balances:
            balances[payer] += amount

        for split in exp["splits"]:
            uid = split["userId"]
            owed = split["owedAmount"]
            if uid in balances:
                balances[uid] -= owed

    creditors = []
    debtors = []

    for uid, bal in balances.items():
        rounded = round(bal, 2)
        name = member_map.get(uid, f"User {uid}")
        if rounded > 0.01:
            creditors.append({"userId": uid, "name": name, "balance": rounded})
        elif rounded < -0.01:
            debtors.append({"userId": uid, "name": name, "balance": abs(rounded)})

    transactions = []
    c_idx = 0
    d_idx = 0

    while c_idx < len(creditors) and d_idx < len(debtors):
        creditor = creditors[c_idx]
        debtor = debtors[d_idx]

        settle = min(creditor["balance"], debtor["balance"])
        rounded_amt = round(settle, 2)

        if rounded_amt > 0:
            transactions.append({
                "fromUserId": debtor["userId"],
                "fromName": debtor["name"],
                "toUserId": creditor["userId"],
                "toName": creditor["name"],
                "amount": rounded_amt
            })

        creditor["balance"] -= settle
        debtor["balance"] -= settle

        if creditor["balance"] < 0.01:
            c_idx += 1
        if debtor["balance"] < 0.01:
            d_idx += 1

    return transactions

# --- FASTAPI APP ---
app = FastAPI(title="Splitwise Telegram Bot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class GroupCreate(BaseModel):
    title: str
    userId: int
    userName: Optional[str] = "User"

class ExpenseCreate(BaseModel):
    groupId: int
    paidByUserId: int
    amount: float
    description: str
    category: Optional[str] = "Общие"
    splitUserIds: Optional[List[int]] = None

class JoinGroup(BaseModel):
    groupId: int
    userId: int
    userName: Optional[str] = "User"

@app.get("/api/users/{user_id}/groups")
def get_user_groups(user_id: int):
    conn = get_db()
    groups = conn.execute("""
        SELECT g.* FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = ?
    """, (user_id,)).fetchall()
    conn.close()
    return {"success": True, "groups": [dict(g) for g in groups]}

@app.post("/api/groups")
def create_group(data: GroupCreate):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT OR IGNORE INTO users (id, first_name) VALUES (?, ?)", (data.userId, data.userName))
    cursor.execute("INSERT INTO groups (title, created_by) VALUES (?, ?)", (data.title, data.userId))
    group_id = cursor.lastrowid
    cursor.execute("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)", (group_id, data.userId))
    conn.commit()
    conn.close()
    return {"success": True, "groupId": group_id}

@app.get("/api/groups/{group_id}/details")
def get_group_details(group_id: int):
    conn = get_db()
    group = conn.execute("SELECT * FROM groups WHERE id = ?", (group_id,)).fetchone()
    if not group:
        conn.close()
        raise HTTPException(status_code=404, detail="Group not found")

    members_raw = conn.execute("""
        SELECT u.id, u.first_name as firstName, u.last_name as lastName, u.username
        FROM group_members gm
        JOIN users u ON gm.user_id = u.id
        WHERE gm.group_id = ?
    """, (group_id,)).fetchall()
    members = [dict(m) for m in members_raw]

    expenses_raw = conn.execute("""
        SELECT e.*, u.first_name as paidByName
        FROM expenses e
        JOIN users u ON e.paid_by_user_id = u.id
        WHERE e.group_id = ?
        ORDER BY e.created_at DESC
    """, (group_id,)).fetchall()

    expenses = []
    for exp in expenses_raw:
        exp_dict = dict(exp)
        splits_raw = conn.execute("""
            SELECT user_id as userId, owed_amount as owedAmount
            FROM expense_splits WHERE expense_id = ?
        """, (exp_dict["id"],)).fetchall()
        exp_dict["splits"] = [dict(s) for s in splits_raw]
        expenses.append(exp_dict)

    conn.close()
    simplified_debts = calculate_simplified_debts(members, expenses)

    return {
        "success": True,
        "group": dict(group),
        "members": members,
        "expenses": expenses,
        "simplifiedDebts": simplified_debts
    }

@app.post("/api/expenses")
def add_expense(data: ExpenseCreate):
    conn = get_db()
    cursor = conn.cursor()

    splits = data.splitUserIds
    if not splits:
        members = cursor.execute("SELECT user_id FROM group_members WHERE group_id = ?", (data.groupId,)).fetchall()
        splits = [m["user_id"] for m in members]

    if not splits:
        conn.close()
        raise HTTPException(status_code=400, detail="No members in group to split expense")

    split_amount = data.amount / len(splits)

    cursor.execute("""
        INSERT INTO expenses (group_id, paid_by_user_id, amount, description, category)
        VALUES (?, ?, ?, ?, ?)
    """, (data.groupId, data.paidByUserId, data.amount, data.description, data.category))
    expense_id = cursor.lastrowid

    for uid in splits:
        cursor.execute("""
            INSERT INTO expense_splits (expense_id, user_id, owed_amount) VALUES (?, ?, ?)
        """, (expense_id, uid, split_amount))

    conn.commit()
    conn.close()
    return {"success": True, "expenseId": expense_id}

@app.post("/api/groups/join")
def join_group(data: JoinGroup):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT OR IGNORE INTO users (id, first_name) VALUES (?, ?)", (data.userId, data.userName))
    cursor.execute("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)", (data.groupId, data.userId))
    conn.commit()
    conn.close()
    return {"success": True}

# --- TELEGRAM BOT (AIOGRAM) ---
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

def db_ensure_user(user):
    if not user:
        return
    conn = get_db()
    conn.execute("""
        INSERT INTO users (id, username, first_name, last_name)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            username=excluded.username,
            first_name=excluded.first_name,
            last_name=excluded.last_name
    """, (user.id, user.username, user.first_name, user.last_name))
    conn.commit()
    conn.close()

@dp.message(Command("start"))
async def cmd_start(message: Message):
    db_ensure_user(message.from_user)
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📊 Открыть Mini App", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])
    await message.answer(
        f"👋 Привет, {message.from_user.first_name}!\n\n"
        "Я бот для совместного учета расходов и долгов (Splitwise).\n\n"
        "✨ **Команды:**\n"
        "• `/newgroup <название>` — создать группу\n"
        "• `/add <сумма> <описание>` — добавить расход\n"
        "• `/debts` — баланс и расчет долгов\n\n"
        "Нажми кнопку ниже, чтобы открыть Mini App! 👇",
        parse_mode="Markdown",
        reply_markup=keyboard
    )

@dp.message(Command("newgroup"))
async def cmd_newgroup(message: Message):
    db_ensure_user(message.from_user)
    title = message.text.replace("/newgroup", "").strip()
    if not title:
        await message.answer("⚠️ Укажите название группы. Пример: `/newgroup Поездка`", parse_mode="Markdown")
        return

    user_id = message.from_user.id
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO groups (title, created_by) VALUES (?, ?)", (title, user_id))
    group_id = cursor.lastrowid
    cursor.execute("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)", (group_id, user_id))
    conn.commit()
    conn.close()

    group_url = f"{WEBAPP_URL}?groupId={group_id}"
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"📊 Открыть '{title}'", web_app=WebAppInfo(url=group_url))]
    ])

    await message.answer(f"🎉 Группа **'{title}'** создана!\nID группы: `{group_id}`", parse_mode="Markdown", reply_markup=keyboard)

@dp.message(Command("debts"))
async def cmd_debts(message: Message):
    db_ensure_user(message.from_user)
    user_id = message.from_user.id

    conn = get_db()
    last_group = conn.execute("""
        SELECT g.id, g.title FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = ?
        ORDER BY g.created_at DESC LIMIT 1
    """, (user_id,)).fetchone()

    if not last_group:
        conn.close()
        await message.answer("У вас нет групп. Создайте группу командой `/newgroup <название>`", parse_mode="Markdown")
        return

    group_id = last_group["id"]
    group_title = last_group["title"]

    members_raw = conn.execute("""
        SELECT u.id, u.first_name as firstName, u.last_name as lastName
        FROM group_members gm
        JOIN users u ON gm.user_id = u.id
        WHERE gm.group_id = ?
    """, (group_id,)).fetchall()
    members = [dict(m) for m in members_raw]

    expenses_raw = conn.execute("SELECT * FROM expenses WHERE group_id = ?", (group_id,)).fetchall()
    expenses = []
    for e in expenses_raw:
        splits = conn.execute("SELECT user_id as userId, owed_amount as owedAmount FROM expense_splits WHERE expense_id = ?", (e["id"],)).fetchall()
        expenses.append({
            "paidByUserId": e["paid_by_user_id"],
            "amount": e["amount"],
            "splits": [dict(s) for s in splits]
        })
    conn.close()

    debts = calculate_simplified_debts(members, expenses)

    if not debts:
        await message.answer(f"🤝 В группе **'{group_title}'** все долги закрыты!", parse_mode="Markdown")
        return

    text = f"💰 **Баланс в группе '{group_title}':**\n\n"
    for d in debts:
        text += f"• **{d['fromName']}** ➡️ **{d['amount']:.2f} ₽** ➡️ **{d['toName']}**\n"

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📊 Открыть Mini App", web_app=WebAppInfo(url=f"{WEBAPP_URL}?groupId={group_id}"))]
    ])
    await message.answer(text, parse_mode="Markdown", reply_markup=keyboard)

@dp.message(Command("add"))
async def cmd_add(message: Message):
    db_ensure_user(message.from_user)
    user_id = message.from_user.id
    parts = message.text.replace("/add", "").strip().split(" ", 1)

    if len(parts) < 2:
        await message.answer("⚠️ Формат: `/add <сумма> <описание>`\nПример: `/add 1200 Обед в кафе`", parse_mode="Markdown")
        return

    try:
        amount = float(parts[0])
    except ValueError:
        await message.answer("⚠️ Неверная сумма.")
        return

    description = parts[1]

    conn = get_db()
    last_group = conn.execute("""
        SELECT g.id, g.title FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = ?
        ORDER BY g.created_at DESC LIMIT 1
    """, (user_id,)).fetchone()

    if not last_group:
        conn.close()
        await message.answer("Сначала создайте группу с помощью `/newgroup <название>`", parse_mode="Markdown")
        return

    group_id = last_group["id"]
    group_title = last_group["title"]

    members = conn.execute("SELECT user_id FROM group_members WHERE group_id = ?", (group_id,)).fetchall()
    member_ids = [m["user_id"] for m in members]
    split_amount = amount / len(member_ids) if member_ids else amount

    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO expenses (group_id, paid_by_user_id, amount, description, category)
        VALUES (?, ?, ?, ?, 'Общие')
    """, (group_id, user_id, amount, description))
    exp_id = cursor.lastrowid

    for uid in member_ids:
        cursor.execute("INSERT INTO expense_splits (expense_id, user_id, owed_amount) VALUES (?, ?, ?)", (exp_id, uid, split_amount))

    conn.commit()
    conn.close()

    await message.answer(
        f"✅ Расход записан в группу **'{group_title}'**!\n"
        f"💳 Сумма: **{amount:.2f} ₽**\n"
        f"📝 {description}\n"
        f"👥 Разделено на {len(member_ids)} участн. (~{split_amount:.2f} ₽ на каждого)",
        parse_mode="Markdown"
    )

async def main():
    import uvicorn
    # Run FastAPI in background task or run bot alongside
    logger.info("Starting FastAPI & Telegram Bot...")
    
    # We can run uvicorn server in a separate task or start bot polling
    config = uvicorn.Config(app, host="0.0.0.0", port=PORT, log_level="info")
    server = uvicorn.Server(config)

    # Start bot polling and FastAPI concurrently
    await asyncio.gather(
        server.serve(),
        dp.start_polling(bot)
    )

if __name__ == "__main__":
    asyncio.run(main())
