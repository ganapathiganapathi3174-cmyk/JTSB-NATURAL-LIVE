export function computePaymentAnalytics(users, topups) {
  const approvedPayments = users.filter(u => u.payment_status === 'approved');
  const approvedTopups = topups.filter(t => t.status === 'approved');

  const seenTids = new Set();
  const uniqueTopups = approvedTopups.filter(t => {
    const tid = t.transactionId || '';
    if (!tid) return true;
    if (seenTids.has(tid)) return false;
    seenTids.add(tid);
    return true;
  });

  const totalPaymentAmount = approvedPayments.reduce((s, u) => s + (Number(u.user_entered_amount) || 120), 0);
  const totalTopupAmount = uniqueTopups.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const totalCollectionAmount = totalPaymentAmount + totalTopupAmount;

  const totalTransactions = approvedPayments.length + uniqueTopups.length;
  const averagePaymentValue = totalTransactions > 0 ? totalCollectionAmount / totalTransactions : 0;

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const monthStr = todayStr.substring(0, 7);
  const yearStr = todayStr.substring(0, 4);

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekStartStr = weekStart.toISOString();

  function isToday(d) { return d && d.startsWith(todayStr); }
  function isThisWeek(d) { return d && d >= weekStartStr; }
  function isThisMonth(d) { return d && d.startsWith(monthStr); }
  function isThisYear(d) { return d && d.startsWith(yearStr); }

  function getAmount(p) { return Number(p.user_entered_amount) || 120; }
  function getTopupAmount(t) { return Number(t.amount) || 0; }
  function getApprovedAt(u) { return u.approved_at || u.approvedDate || ''; }
  function getTopupApprovedAt(t) { return t.approvedAt || ''; }

  const todayCollection = approvedPayments.filter(u => isToday(getApprovedAt(u))).reduce((s, u) => s + getAmount(u), 0)
    + uniqueTopups.filter(t => isToday(getTopupApprovedAt(t))).reduce((s, t) => s + getTopupAmount(t), 0);

  const weekCollection = approvedPayments.filter(u => isThisWeek(getApprovedAt(u))).reduce((s, u) => s + getAmount(u), 0)
    + uniqueTopups.filter(t => isThisWeek(getTopupApprovedAt(t))).reduce((s, t) => s + getTopupAmount(t), 0);

  const monthCollection = approvedPayments.filter(u => isThisMonth(getApprovedAt(u))).reduce((s, u) => s + getAmount(u), 0)
    + uniqueTopups.filter(t => isThisMonth(getTopupApprovedAt(t))).reduce((s, t) => s + getTopupAmount(t), 0);

  const yearCollection = approvedPayments.filter(u => isThisYear(getApprovedAt(u))).reduce((s, u) => s + getAmount(u), 0)
    + uniqueTopups.filter(t => isThisYear(getTopupApprovedAt(t))).reduce((s, t) => s + getTopupAmount(t), 0);

  const allEntries = [
    ...approvedPayments.map(u => ({
      type: 'payment',
      userId: u.id,
      userName: u.name || '',
      transactionId: u.utr_number || '—',
      amount: getAmount(u),
      paymentDate: u.user_entered_date || getApprovedAt(u),
      approvalStatus: 'Approved',
      approvedAt: getApprovedAt(u),
    })),
    ...uniqueTopups.map(t => ({
      type: 'topup',
      userId: t.userId || '',
      userName: t.userName || '',
      transactionId: t.transactionId || '—',
      amount: getTopupAmount(t),
      paymentDate: getTopupApprovedAt(t) || t.createdAt || '',
      approvalStatus: 'Approved',
      approvedAt: getTopupApprovedAt(t) || '',
    })),
  ].sort((a, b) => (b.approvedAt || '').localeCompare(a.approvedAt || ''));

  return {
    totalCollectionAmount,
    totalApprovedPayments: totalTransactions,
    approvedPaymentsCount: approvedPayments.length,
    approvedTopupsCount: uniqueTopups.length,
    todayCollection,
    weekCollection,
    monthCollection,
    yearCollection,
    totalPaymentAmount,
    totalTopupAmount,
    averagePaymentValue,
    allEntries,
  };
}
