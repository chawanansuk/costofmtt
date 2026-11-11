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

export const CATEGORY_LABEL: Record<string, string> = {
  raw_material: "วัตถุดิบ",
  merchandise: "สินค้าเพื่อขาย",
  packaging: "บรรจุภัณฑ์",
  supplies: "วัสดุสิ้นเปลือง",
  equipment: "อุปกรณ์/เครื่องมือ",
  shipping: "ค่าขนส่ง",
  utilities: "ค่าสาธารณูปโภค",
  service_other: "ค่าบริการ/อื่นๆ",
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  tax_invoice_full: "ใบกำกับภาษีเต็มรูป",
  tax_invoice_abb: "ใบกำกับภาษีอย่างย่อ",
  receipt: "ใบเสร็จรับเงิน",
  delivery_note: "ใบส่งของ",
  temp_delivery: "ใบส่งของชั่วคราว",
  quotation: "ใบเสนอขาย",
  goods_loan: "ใบยืมสินค้า",
  billing_note: "ใบวางบิล/ใบแจ้งหนี้",
  handwritten_bill: "บิลเขียนมือ",
  other: "เอกสารอื่น",
};

// เอกสารชั่วคราวที่มักมีใบกำกับภาษีจริงตามมาภายหลัง (เสี่ยงบันทึกซ้ำ)
export const TEMP_DOC_TYPES = new Set([
  "temp_delivery",
  "quotation",
  "goods_loan",
  "delivery_note",
  "billing_note",
]);

// เอกสารที่ยัง "ไม่ใช่การซื้อ" — ใบเสนอราคายังไม่ตกลงซื้อ ใบยืมสินค้ายังไม่ได้จ่าย
// ต้องไม่ถูกนับรวมเป็นต้นทุนหรือราคาสินค้า ไม่งั้นตัวเลขจะเพี้ยน
export const NON_COST_DOC_TYPES = new Set(["quotation", "goods_loan"]);

export function isCostDocument(documentType: string): boolean {
  return !NON_COST_DOC_TYPES.has(documentType);
}

// วันนี้ตามเวลาเครื่อง (YYYY-MM-DD) — ห้ามใช้ toISOString() เพราะเป็นเวลา UTC
// ที่ไทย (UTC+7) ช่วงเที่ยงคืนถึง 7 โมงเช้าจะได้วันที่ของเมื่อวาน
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// รับเฉพาะวันที่ YYYY-MM-DD ที่มีอยู่จริง — ปี พ.ศ. (25xx) แปลงเป็น ค.ศ. ให้
// ค่าอื่นคืน null เพราะวันที่เพี้ยนจะทำให้ยอดรายเดือน/กราฟ/วันครบกำหนดผิดทั้งระบบ
export function cleanIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  let y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y >= 2400 && y <= 2700) y -= 543;
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
  const daysInMonth = new Date(y, mo, 0).getDate();
  if (d > daysInMonth) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// เลขผู้เสียภาษี: ถ้าครบ 13 หลักเก็บเป็นตัวเลขล้วน (ตัดขีด/เว้นวรรค) ให้เทียบใบซ้ำได้ตรงกัน
export function cleanTaxId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 13) return digits;
  return raw.trim() || null;
}

// ค้นหาแบบไม่สนตัวพิมพ์ ช่องว่าง และขีดคั่น — พิมพ์ "ws9010" ต้องเจอ "WS-9010" และ "WS 9010"
// (บิลแต่ละเจ้าพิมพ์รหัสสินค้าไม่เหมือนกัน)
const squash = (text: string) => text.toLowerCase().replace(/[\s\-_./]+/g, "");

export function matchesSearch(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  if (haystack.toLowerCase().includes(q)) return true;
  const sq = squash(q);
  return sq !== "" && squash(haystack).includes(sq);
}
