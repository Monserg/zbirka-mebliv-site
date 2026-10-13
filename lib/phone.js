// Український номер для заявок. Ті самі правила, що в формі (site/main.js).
// Приймає «+38 (093) 299-44-55», «+380932994455», «380932994455», «0932994455».
// Номер: 0 + код оператора чи міста (3–9) + ще 8 цифр, разом 10 цифр.

export const TASK_MIN = 4; // мінімум символів у «Що зробити»

export function normalizePhone(value) {
  let d = String(value || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("380")) d = d.slice(2);
  if (!/^0[3-9]\d{8}$/.test(d)) return null;
  return `+38 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}
