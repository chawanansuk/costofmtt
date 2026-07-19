// โครงข้อมูลที่ AI สกัดจากภาพใบกำกับภาษี — ต้องตรงกับ JSON schema ใน /api/extract
export type DocumentType =
  | "tax_invoice_full"
  | "tax_invoice_abb"
  | "receipt"
  | "delivery_note"
  | "temp_delivery" // ใบส่งของชั่วคราว — ใบกำกับภาษีจริงมักตามมาทีหลัง
  | "quotation" // ใบเสนอขาย
  | "goods_loan" // ใบยืมสินค้า
  | "billing_note" // ใบวางบิล/ใบแจ้งหนี้
  | "handwritten_bill" // บิลเขียนมือ
  | "other";

export interface Party {
  name: string | null;
  tax_id: string | null;
  branch: string | null;
  address: string | null;
}

// หมวดหมู่ต้นทุน — ให้ AI จัดหมวดตอนสกัด และผู้ใช้แก้ได้ในฟอร์ม
export type CostCategory =
  | "raw_material"
  | "merchandise"
  | "packaging"
  | "supplies"
  | "equipment"
  | "shipping"
  | "utilities"
  | "service_other";

export interface LineItem {
  description: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  amount: number | null;
  category: CostCategory | null;
}

export interface ExtractedReceipt {
  document_type: DocumentType;
  seller: Party;
  buyer: Party;
  doc_number: string | null;
  doc_date: string | null; // YYYY-MM-DD (ค.ศ.)
  line_items: LineItem[];
  subtotal: number | null;
  discount: number | null;
  vat_rate: number | null;
  vat_amount: number | null;
  total: number | null;
  payment_method: string | null;
  paid: boolean | null; // true = มีตรา/ข้อความจ่ายเงินแล้ว, false = เครดิต/ยังไม่จ่าย, null = ไม่ทราบ
  due_date: string | null; // วันครบกำหนดชำระ (YYYY-MM-DD ค.ศ.)
  notes: string | null;
  confidence: "high" | "medium" | "low";
  warnings: string[];
}

// ผลตรวจสอบหลังสกัด
export interface ValidationResult {
  sellerTaxIdValid: boolean | null; // null = ไม่มีเลขให้ตรวจ
  itemsSumOk: boolean | null;
  totalMathOk: boolean | null;
  vatMathOk: boolean | null;
  fullInvoiceComplete: boolean; // ครบตามมาตรา 86/4 (เฉพาะใบเต็มรูป)
  missingFields: string[];
  vatClaimable: boolean;
}

export interface ExtractResponse {
  data: ExtractedReceipt;
  validation: ValidationResult;
  usage?: { input_tokens: number; output_tokens: number };
}

// เรคคอร์ดที่บันทึกลง IndexedDB
export interface ReceiptRecord {
  id?: number;
  createdAt: number; // epoch ms
  docDate: string | null;
  docNumber: string | null;
  documentType: DocumentType;
  sellerName: string | null;
  sellerTaxId: string | null;
  sellerBranch: string | null;
  sellerAddress: string | null;
  buyerName: string | null;
  buyerTaxId: string | null;
  paymentMethod: string | null;
  paid: boolean | null;
  dueDate: string | null;
  subtotal: number;
  discount: number;
  vatAmount: number;
  total: number;
  vatClaimable: boolean;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  notes: string | null;
  imageBlob?: Blob;
  imageType?: string;
}

export interface ItemRecord {
  id?: number;
  receiptId: number;
  docDate: string | null;
  sellerName: string | null;
  description: string;
  normalizedName: string; // สำหรับ group ต้นทุนต่อสินค้า
  quantity: number;
  unit: string | null;
  unitPrice: number;
  amount: number;
  category: CostCategory | null;
}
