import React, { useEffect, useState } from 'react';

// Telegram WebApp types
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initDataUnsafe?: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
          };
        };
        ready(): void;
        expand(): void;
        close(): void;
        themeParams?: {
          bg_color?: string;
          text_color?: string;
          button_color?: string;
          button_text_color?: string;
        };
      };
    };
  }
}

const API_BASE = 'http://localhost:3000/api';

export default function App() {
  const [user, setUser] = useState<{ id: number; firstName: string; userName: string }>({
    id: 12345,
    firstName: 'Тест Пользователь',
    userName: 'testuser',
  });

  const [groups, setGroups] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [groupDetails, setGroupDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Modal & form states
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Общие');
  const [newGroupTitle, setNewGroupTitle] = useState('');

  useEffect(() => {
    // Init Telegram WebApp
    if (window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand();

      const tgUser = tg.initDataUnsafe?.user;
      if (tgUser) {
        setUser({
          id: tgUser.id,
          firstName: tgUser.first_name,
          userName: tgUser.username || 'user',
        });
      }
    }

    // Check URL params for groupId
    const params = new URLSearchParams(window.location.search);
    const gId = params.get('groupId');
    if (gId) {
      setSelectedGroupId(Number(gId));
    }
  }, []);

  // Fetch user groups
  useEffect(() => {
    if (!user.id) return;
    fetch(`${API_BASE}/users/${user.id}/groups`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setGroups(data.groups);
          if (!selectedGroupId && data.groups.length > 0) {
            setSelectedGroupId(data.groups[0].id);
          }
        }
      })
      .catch((err) => console.error('Failed to fetch groups:', err));
  }, [user.id]);

  // Fetch group details
  useEffect(() => {
    if (!selectedGroupId) return;
    setLoading(true);
    fetch(`${API_BASE}/groups/${selectedGroupId}/details`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setGroupDetails(data);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch group details:', err);
        setLoading(false);
      });
  }, [selectedGroupId]);

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupTitle.trim()) return;

    fetch(`${API_BASE}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newGroupTitle,
        userId: user.id,
        userName: user.firstName,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setNewGroupTitle('');
          setShowNewGroup(false);
          setSelectedGroupId(data.groupId);
          // Refresh groups
          return fetch(`${API_BASE}/users/${user.id}/groups`);
        }
      })
      .then((res) => res?.json())
      .then((data) => {
        if (data?.success) setGroups(data.groups);
      })
      .catch((err) => console.error('Failed to create group:', err));
  };

  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !description || !selectedGroupId) return;

    fetch(`${API_BASE}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: selectedGroupId,
        paidByUserId: user.id,
        amount: parseFloat(amount),
        description,
        category,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setAmount('');
          setDescription('');
          setShowAddExpense(false);
          // Refresh group details
          return fetch(`${API_BASE}/groups/${selectedGroupId}/details`);
        }
      })
      .then((res) => res?.json())
      .then((data) => {
        if (data?.success) setGroupDetails(data);
      })
      .catch((err) => console.error('Failed to add expense:', err));
  };

  return (
    <div className="max-w-md mx-auto min-h-screen p-4 pb-20 flex flex-col">
      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-xl font-bold">📊 Splitwise TMA</h1>
          <p className="text-xs text-gray-500">Привет, {user.firstName}!</p>
        </div>
        <button
          onClick={() => setShowNewGroup(true)}
          className="bg-blue-600 text-white text-xs px-3 py-2 rounded-lg font-medium shadow hover:bg-blue-700 transition"
        >
          + Новая группа
        </button>
      </header>

      {/* Group selector */}
      {groups.length > 0 && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Активная группа</label>
          <select
            value={selectedGroupId || ''}
            onChange={(e) => setSelectedGroupId(Number(e.target.value))}
            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Main Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : groupDetails ? (
        <div className="space-y-6 flex-1">
          {/* Simplified Debts Card */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              ⚖️ Оптимальные взаиморасчеты
            </h2>
            {groupDetails.simplifiedDebts.length === 0 ? (
              <p className="text-sm text-green-600 font-medium">Все долги закрыты! Никто никому ничего не должен 🎉</p>
            ) : (
              <div className="space-y-2.5">
                {groupDetails.simplifiedDebts.map((debt: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between bg-gray-50 p-2.5 rounded-xl text-sm">
                    <span className="font-semibold text-red-600">{debt.fromName}</span>
                    <div className="text-center">
                      <span className="text-xs text-gray-400 block">переводит</span>
                      <span className="font-bold text-gray-900">{debt.amount.toFixed(2)} ₽</span>
                    </div>
                    <span className="font-semibold text-green-600">{debt.toName}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Members list */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="text-sm font-bold text-gray-700 mb-2">👥 Участники ({groupDetails.members.length})</h2>
            <div className="flex flex-wrap gap-2">
              {groupDetails.members.map((m: any) => (
                <span key={m.id} className="bg-blue-50 text-blue-700 text-xs px-2.5 py-1 rounded-full font-medium">
                  {m.firstName} {m.lastName || ''}
                </span>
              ))}
            </div>
          </div>

          {/* Expenses history */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-sm font-bold text-gray-700">📜 История расходов</h2>
              <button
                onClick={() => setShowAddExpense(true)}
                className="bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg font-medium shadow hover:bg-green-700 transition"
              >
                + Добавить расход
              </button>
            </div>

            {groupDetails.expenses.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">В этой группе пока нет расходов.</p>
            ) : (
              <div className="space-y-3">
                {groupDetails.expenses.map((exp: any) => (
                  <div key={exp.id} className="flex justify-between items-center border-b border-gray-50 pb-2.5">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{exp.description}</p>
                      <p className="text-xs text-gray-400">
                        Оплатил: <span className="font-medium text-gray-600">{exp.paidByName}</span> • {exp.category}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-gray-900">{exp.amount.toFixed(2)} ₽</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-20">
          <p className="text-gray-500 mb-4">У вас нет выбранной группы или вы еще не состоите ни в одной группе.</p>
          <button
            onClick={() => setShowNewGroup(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium"
          >
            Создать первую группу
          </button>
        </div>
      )}

      {/* Add Expense Modal */}
      {showAddExpense && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-4">➕ Добавить новый расход</h3>
            <form onSubmit={handleAddExpense} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Сумма (₽)</label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="1500"
                  required
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Описание</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Продукты в супермаркете"
                  required
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Категория</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Общие">Общие</option>
                  <option value="Еда & Кафе">Еда & Кафе</option>
                  <option value="Транспорт">Транспорт</option>
                  <option value="Жилье">Жилье</option>
                  <option value="Развлечения">Развлечения</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddExpense(false)}
                  className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-200 transition"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition shadow"
                >
                  Добавить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Group Modal */}
      {showNewGroup && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-4">👥 Создать группу расходов</h3>
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Название группы</label>
                <input
                  type="text"
                  value={newGroupTitle}
                  onChange={(e) => setNewGroupTitle(e.target.value)}
                  placeholder="Поездка в горы"
                  required
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewGroup(false)}
                  className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-200 transition"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition shadow"
                >
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
