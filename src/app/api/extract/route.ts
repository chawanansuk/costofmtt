import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedReceipt, ExtractResponse } from "@/lib/types";
import { validateExtraction } from "@/lib/validate";

export const maxDuration = 60;

const MODEL = process.env.EXTRACT_MODEL || "claude-opus-4-8";
const ALLOWED_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
// จำกัด payload ~8MB (base64 พองขึ้น ~33% จากไฟล์จริง)
const MAX_BASE64_LENGTH = 11_000_000;

// กันยิงถล่ม: จำกัดต่อ IP ต่อนาที (in-memory ต่อ instance — ชั้นแรกพอสำหรับแอปส่วนตัว)
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 8;
const rateHits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  if (rateHits.size > 2000) rateHits.clear(); // กัน map โตไม่จำกัด
  const recent = (rateHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX_REQUESTS) {
    rateHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  rateHits.set(ip, recent);
  return false;
}

const SYSTEM_PROMPT = `คุณคือระบบอ่านข้อมูลจากภาพเอกสารการค้าของไทย (ใบกำกับภาษี ใบเสร็จ ใบส่งของ ใบเสนอขาย บิลเขียนมือ ฯลฯ) ให้สกัดข้อมูลอย่างแม่นยำที่สุดตามกติกาต่อไปนี้:

1. อ่านค่า "ตามที่ปรากฏจริง" เท่านั้น ห้ามเดา ห้ามแปลภาษา ห้ามเติมข้อมูลที่ไม่มีในภาพ ค่าที่อ่านไม่ได้/ไม่มี ให้เป็น null และใส่คำอธิบายใน warnings
2. เลขไทย (๐-๙) ให้แปลงเป็นเลขอารบิก
3. วันที่ ตอบรูปแบบ YYYY-MM-DD โดยตีความปีดังนี้: ปี 25xx = พ.ศ. ให้ลบ 543 (เช่น 2569→2026), ปีสองหลัก xx = พ.ศ. 25xx (เช่น 69 = 2569→2026), ปี 20xx = ค.ศ. อยู่แล้วใช้ตามนั้น รูปแบบไทยมักเป็น วัน/เดือน/ปี หรือ วัน.เดือน.ปี
4. เลขประจำตัวผู้เสียภาษี: ตอบเป็นตัวเลข 13 หลักติดกันไม่มีขีด
5. ประเภทเอกสาร: "tax_invoice_full" = มีคำว่าใบกำกับภาษี (เต็มรูป มีชื่อ-ที่อยู่ผู้ซื้อ), "tax_invoice_abb" = ใบกำกับภาษีอย่างย่อ/ABB, "receipt" = ใบเสร็จรับเงิน/บิลเงินสด, "delivery_note" = ใบส่งของ/ใบส่งสินค้า, "temp_delivery" = ใบส่งของชั่วคราว, "quotation" = ใบเสนอขาย/ใบเสนอราคา, "goods_loan" = ใบยืมสินค้า, "billing_note" = ใบวางบิล/ใบแจ้งหนี้, "handwritten_bill" = บิลเขียนมือบนกระดาษ, "other" = อื่นๆ (เอกสารที่เป็นทั้งใบส่งของ/ใบกำกับภาษีในใบเดียว ให้ถือเป็น tax_invoice_full)
6. ผู้ซื้อ vs ผู้ขาย: ช่อง "ลูกค้า/นามลูกค้า/ในนาม" คือผู้ซื้อ ส่วนหัวกระดาษ/ตราประทับ/ชื่อบริษัทผู้ออกเอกสารคือผู้ขาย ถ้าระบุชื่อร้านผู้ซื้อมาให้ในคำสั่ง: ชื่อนั้นเป็น buyer เสมอ ห้ามใส่เป็น seller เด็ดขาด — บิลเขียนมือที่มีแต่ชื่อร้านผู้ซื้อ ให้ seller เป็น null ถ้าผู้ขายระบุแค่ตัวย่อ/โค้ด (เช่น V-N, CST) ให้ใช้ตัวย่อนั้นเป็นชื่อผู้ขาย
7. line_items: เก็บทุกบรรทัดสินค้า/บริการ ตาม description ที่พิมพ์จริง ห้ามรวมบรรทัดส่วนลด/ยอดรวมเข้าเป็นสินค้า amount ของแต่ละบรรทัดใช้ตามคอลัมน์จำนวนเงินที่พิมพ์ (ซึ่งมักเป็นยอดสุทธิหลังส่วนลดของบรรทัดแล้ว เช่นกรณีส่วนลดซ้อน "30+25%") ห้ามคำนวณเองจาก ราคา×จำนวน
8. ตัวเขียนมือที่แก้/เพิ่มบนเอกสาร (เช่น ขีดฆ่ายอด เขียนส่วนลดเงินสด -2% แล้วเขียนยอดใหม่) ถือเป็นการแก้ไขที่มีผลจริง: ให้ total เป็นยอดสุดท้ายหลังแก้ และอธิบายการแก้ไขใน notes
9. ตัวเลขเงิน: ตอบเป็น number ไม่มี comma, subtotal = มูลค่าก่อน VAT ตามที่พิมพ์ (หรือยอดรวมรายการถ้าไม่มี VAT), discount = ส่วนลดท้ายบิล (บาท ไม่ใช่ %), vat_amount = จำนวน VAT ตามที่พิมพ์, total = ยอดสุทธิที่ต้องชำระจริง
10. ก่อนตอบ ตรวจทานความสอดคล้องของยอดเงิน โดยยอมรับได้หลายแบบ: ผลรวมรายการ ≈ subtotal, หรือ ผลรวมรายการ − discount ≈ total (กรณีราคารวม VAT), หรือ subtotal − discount + vat_amount ≈ total ถ้าไม่เข้าเคสไหนเลยให้อ่านซ้ำ และถ้ายังไม่ตรงให้ระบุใน warnings
11. สถานะการจ่ายเงิน (paid): true ถ้ามีตราประทับ/ข้อความ "จ่ายเงินแล้ว/ชำระแล้ว/เงินสด(จ่ายแล้ว)", false ถ้าเป็นเครดิต/ระบุวันครบกำหนดและไม่มีหลักฐานว่าจ่ายแล้ว, null ถ้าไม่ทราบ และ due_date = วันครบกำหนดชำระ/กำหนดชำระ ถ้ามี
12. จัดหมวดหมู่ต้นทุนให้แต่ละรายการ (category): "raw_material" = วัตถุดิบ/ส่วนผสมที่นำไปผลิต, "merchandise" = สินค้าสำเร็จรูปซื้อมาขายต่อ, "packaging" = บรรจุภัณฑ์ ถุง กล่อง, "supplies" = วัสดุสิ้นเปลือง ของใช้ในร้าน, "equipment" = อุปกรณ์/เครื่องมือ/เครื่องใช้, "shipping" = ค่าขนส่ง, "utilities" = ค่าน้ำ ไฟ เน็ต โทรศัพท์, "service_other" = ค่าบริการหรืออื่นๆ ถ้าไม่แน่ใจให้เป็น null
13. confidence: "high" = ภาพชัด อ่านได้ครบ, "medium" = อ่านได้ส่วนใหญ่แต่บางจุดไม่แน่ใจ, "low" = ภาพมัว/ลายมืออ่านยาก/ไม่แน่ใจหลายจุด — บิลเขียนมือให้ไม่เกิน "medium" เสมอ
14. warnings เขียนเป็นภาษาไทยสั้นๆ`;

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "record_receipt",
  description:
    "บันทึกข้อมูลที่อ่านได้จากภาพใบกำกับภาษี/ใบเสร็จ เรียกครั้งเดียวด้วยข้อมูลครบทุกช่อง",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "document_type", "seller", "buyer", "doc_number", "doc_date",
      "line_items", "subtotal", "discount", "vat_rate", "vat_amount",
      "total", "payment_method", "paid", "due_date", "notes",
      "confidence", "warnings",
    ],
    properties: {
      document_type: {
        type: "string",
        enum: [
          "tax_invoice_full", "tax_invoice_abb", "receipt", "delivery_note",
          "temp_delivery", "quotation", "goods_loan", "billing_note",
          "handwritten_bill", "other",
        ],
      },
      seller: {
        type: "object",
        additionalProperties: false,
        required: ["name", "tax_id", "branch", "address"],
        properties: {
          name: { type: ["string", "null"] },
          tax_id: { type: ["string", "null"], description: "13 หลักติดกัน" },
          branch: { type: ["string", "null"], description: "เช่น สำนักงานใหญ่ หรือ สาขาที่ 00002" },
          address: { type: ["string", "null"] },
        },
      },
      buyer: {
        type: "object",
        additionalProperties: false,
        required: ["name", "tax_id", "branch", "address"],
        properties: {
          name: { type: ["string", "null"] },
          tax_id: { type: ["string", "null"] },
          branch: { type: ["string", "null"] },
          address: { type: ["string", "null"] },
        },
      },
      doc_number: { type: ["string", "null"] },
      doc_date: { type: ["string", "null"], description: "YYYY-MM-DD ค.ศ." },
      line_items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["description", "quantity", "unit", "unit_price", "amount", "category"],
          properties: {
            description: { type: "string" },
            quantity: { type: ["number", "null"] },
            unit: { type: ["string", "null"] },
            unit_price: { type: ["number", "null"] },
            amount: { type: ["number", "null"] },
            category: {
              type: ["string", "null"],
              enum: [
                "raw_material", "merchandise", "packaging", "supplies",
                "equipment", "shipping", "utilities", "service_other", null,
              ],
            },
          },
        },
      },
      subtotal: { type: ["number", "null"] },
      discount: { type: ["number", "null"] },
      vat_rate: { type: ["number", "null"] },
      vat_amount: { type: ["number", "null"] },
      total: { type: ["number", "null"] },
      payment_method: { type: ["string", "null"] },
      paid: { type: ["boolean", "null"] },
      due_date: { type: ["string", "null"], description: "วันครบกำหนดชำระ YYYY-MM-DD ค.ศ." },
      notes: { type: ["string", "null"] },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      warnings: { type: "array", items: { type: "string" } },
    },
  },
};

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY" },
      { status: 500 }
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "ส่งรูปถี่เกินไป กรุณารอ 1 นาทีแล้วลองใหม่" },
      { status: 429 }
    );
  }

  // ถ้าตั้ง APP_PASSCODE ไว้ ต้องส่งรหัสมาด้วยทุกครั้ง (ตั้งรหัสได้ในหน้าตั้งค่า)
  const passcode = process.env.APP_PASSCODE;
  if (passcode && req.headers.get("x-app-passcode") !== passcode) {
    return NextResponse.json(
      { error: "ต้องใส่รหัสผ่านแอปให้ถูกต้องก่อนใช้งาน — ตั้งได้ที่หน้า ตั้งค่า" },
      { status: 401 }
    );
  }

  let body: { image?: string; mediaType?: string; buyerHint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const { image, mediaType, buyerHint } = body;
  if (!image || typeof image !== "string") {
    return NextResponse.json({ error: "ไม่พบข้อมูลรูปภาพ" }, { status: 400 });
  }
  if (image.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: "รูปใหญ่เกินไป (จำกัด ~8MB)" }, { status: 413 });
  }
  const mt = (mediaType || "image/jpeg") as (typeof ALLOWED_MEDIA)[number];
  if (!ALLOWED_MEDIA.includes(mt)) {
    return NextResponse.json({ error: "ชนิดไฟล์รูปไม่รองรับ" }, { status: 400 });
  }

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "record_receipt" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mt, data: image },
            },
            {
              type: "text",
              text:
                "อ่านข้อมูลจากภาพเอกสารการค้านี้ แล้วเรียก record_receipt" +
                (buyerHint && typeof buyerHint === "string" && buyerHint.length <= 200
                  ? ` — ชื่อร้านผู้ซื้อ (ร้านของเรา) คือ "${buyerHint}" ถ้าพบชื่อนี้ในเอกสารให้เป็น buyer เสมอ ห้ามเป็น seller`
                  : ""),
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) {
      return NextResponse.json(
        { error: "AI ไม่สามารถอ่านข้อมูลจากภาพนี้ได้ กรุณาลองใหม่" },
        { status: 502 }
      );
    }

    const data = toolUse.input as ExtractedReceipt;
    const validation = validateExtraction(data);

    const result: ExtractResponse = {
      data,
      validation,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "API key ไม่ถูกต้อง" }, { status: 500 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "ใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่" },
        { status: 429 }
      );
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return NextResponse.json(
        { error: "เชื่อมต่อบริการ AI ไม่ได้ กรุณาลองใหม่" },
        { status: 502 }
      );
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API error:", err.status, err.message);
      return NextResponse.json(
        { error: "บริการ AI ขัดข้อง กรุณาลองใหม่" },
        { status: 502 }
      );
    }
    console.error("extract error:", err);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดภายใน" }, { status: 500 });
  }
}
