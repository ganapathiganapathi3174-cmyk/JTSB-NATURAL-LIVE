function record(order, status, fields, rules, reason) {
  return {
    at: new Date().toISOString(),
    engine: 'NUCLEAR',
    orderId: order && order.id,
    type: order && order.type,
    amount: order && order.amount,
    status,
    reason,
    fields: {
      amount: fields && fields.amount && fields.amount.value,
      utr: fields && fields.utr && fields.utr.value,
      upi: fields && fields.receiverUpi && fields.receiverUpi.value,
      name: fields && fields.receiverName && fields.receiverName.value,
      date: fields && fields.date && fields.date.value,
      time: fields && fields.time && fields.time.value,
      status: fields && fields.paymentStatus && fields.paymentStatus.value,
    },
    validation: rules && rules.results && rules.results.map(r => ({ field: r.field, pass: r.pass, reason: r.reason })),
  };
}

module.exports = { record };