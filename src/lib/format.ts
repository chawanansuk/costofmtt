export function baht(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function thaiDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function monthKey(iso: string | null, fallbackMs?: number): string {
  if (iso && /^\d{4}-\d{2}/.test(iso)) return iso.slice(0, 7);
  const d = fallbackMs ? new Date(fallbackMs) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("th-TH", { month: "short", year: "2-digit" });
}

export const DOC_TYPE_LABEL: Record<string, string> = {
  tax_invoice_full: "ใบกำกับภาษีเต็มรูป",
  tax_invoice_abb: "ใบกำกับภาษีอย่างย่อ",
  receipt: "ใบเสร็จรับเงิน",
  delivery_note: "ใบส่งของ",
  other: "เอกสารอื่น",
};
