type TxRow = { type: string; occurredAt: Date | string };

export type ScoreResult = {
  score: number;
  level: string;
  factors: {
    daysTracking: number;
    hasSeparatedCash: boolean;
    hasExpenses: boolean;
    hasMerchandise: boolean;
    streak: number;
  };
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function computeScore(txs: TxRow[]): ScoreResult {
  const uniqueDays = new Set(txs.map((t) => dayKey(new Date(t.occurredAt))));
  const daysTracking = uniqueDays.size;

  const hasSeparatedCash = txs.some((t) => t.type === 'casa');
  const hasExpenses = txs.some((t) => t.type === 'gasto');
  const hasMerchandise = txs.some((t) => t.type === 'mercaderia');

  // Consecutive-day streak ending today
  let streak = 0;
  const check = new Date();
  check.setHours(0, 0, 0, 0);
  while (uniqueDays.has(dayKey(check))) {
    streak++;
    check.setDate(check.getDate() - 1);
  }

  let score = 0;
  score += Math.min(40, daysTracking * 2);   // consistency, up to 40 pts
  if (hasSeparatedCash) score += 20;          // separates business/home cash
  if (hasExpenses) score += 20;               // records expenses
  score += Math.min(20, streak);              // streak bonus

  score = Math.min(100, score);

  const level =
    score >= 91 ? 'Excelente' :
    score >= 71 ? 'Bueno' :
    score >= 41 ? 'Medio' :
    'Empezando';

  return { score, level, factors: { daysTracking, hasSeparatedCash, hasExpenses, hasMerchandise, streak } };
}
