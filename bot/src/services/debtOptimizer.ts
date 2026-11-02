export interface DebtTransaction {
  fromUserId: number;
  fromName: string;
  toUserId: number;
  toName: string;
  amount: number;
}

interface UserBalance {
  userId: number;
  name: string;
  balance: number;
}

export function calculateSimplifiedDebts(
  members: { id: number; firstName: string; lastName?: string }[],
  expenses: {
    id: number;
    paidByUserId: number;
    amount: number;
    splits: { userId: number; owedAmount: number }[];
  }[]
): DebtTransaction[] {
  const memberMap = new Map<number, string>();
  const balances = new Map<number, number>();

  members.forEach((m) => {
    const fullName = [m.firstName, m.lastName].filter(Boolean).join(' ');
    memberMap.set(m.id, fullName || `User ${m.id}`);
    balances.set(m.id, 0);
  });

  // Calculate net balances
  // Paid amount increases balance; owed amount decreases balance
  expenses.forEach((exp) => {
    const payerCurrent = balances.get(exp.paidByUserId) || 0;
    balances.set(exp.paidByUserId, payerCurrent + exp.amount);

    exp.splits.forEach((split) => {
      const debtorCurrent = balances.get(split.userId) || 0;
      balances.set(split.userId, debtorCurrent - split.owedAmount);
    });
  });

  const creditors: UserBalance[] = [];
  const debtors: UserBalance[] = [];

  balances.forEach((balance, userId) => {
    const name = memberMap.get(userId) || `User ${userId}`;
    // Round to avoid floating point issues
    const rounded = Math.round(balance * 100) / 100;
    if (rounded > 0.01) {
      creditors.push({ userId, name, balance: rounded });
    } else if (rounded < -0.01) {
      debtors.push({ userId, name, balance: Math.abs(rounded) });
    }
  });

  const transactions: DebtTransaction[] = [];

  let cIdx = 0;
  let dIdx = 0;

  while (cIdx < creditors.length && dIdx < debtors.length) {
    const creditor = creditors[cIdx];
    const debtor = debtors[dIdx];

    const settleAmount = Math.min(creditor.balance, debtor.balance);
    const roundedAmount = Math.round(settleAmount * 100) / 100;

    if (roundedAmount > 0) {
      transactions.push({
        fromUserId: debtor.userId,
        fromName: debtor.name,
        toUserId: creditor.userId,
        toName: creditor.name,
        amount: roundedAmount,
      });
    }

    creditor.balance -= settleAmount;
    debtor.balance -= settleAmount;

    if (creditor.balance < 0.01) cIdx++;
    if (debtor.balance < 0.01) dIdx++;
  }

  return transactions;
}
