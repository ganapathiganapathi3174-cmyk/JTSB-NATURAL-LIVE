function extract(ocrResult) {
  const fields = ocrResult && ocrResult.fields ? ocrResult.fields : {};
  const raw = ocrResult && ocrResult.raw ? ocrResult.raw : '';
  return {
    amount: fields.amount !== null && fields.amount !== undefined ? { value: fields.amount, confidence: ocrResult.fieldDetails?.amount?.votes > 1 ? 'high' : 'medium' } : null,
    utr: fields.utr ? { value: fields.utr, confidence: ocrResult.fieldDetails?.utr?.votes > 1 ? 'high' : 'medium' } : null,
    upi: fields.upi ? { value: fields.upi, confidence: ocrResult.fieldDetails?.upi?.votes > 1 ? 'high' : 'medium' } : null,
    name: fields.name ? { value: fields.name, confidence: ocrResult.fieldDetails?.name?.votes > 1 ? 'high' : 'medium' } : null,
    date: fields.date ? { value: fields.date, confidence: ocrResult.fieldDetails?.date?.votes > 1 ? 'high' : 'medium' } : null,
    time: fields.time ? { value: fields.time, confidence: ocrResult.fieldDetails?.time?.votes > 1 ? 'high' : 'medium' } : null,
    status: fields.status ? { value: fields.status, confidence: ocrResult.fieldDetails?.status?.votes > 1 ? 'high' : 'medium' } : null,
  };
}

module.exports = { extract };
