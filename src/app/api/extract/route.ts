import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedReceipt, ExtractResponse } from "@/lib/types";
import { validateExtraction } from "@/lib/validate";

export const maxDuration = 60;

const MODEL = process.env.EXTRACT_MODEL || "claude-opus-4-8";
const ALLOWED_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
// จำกัด payload ~8MB (base64 พองขึ้น ~33% จากไฟล์จริง)
const MAX_BASE64_LENGTH = 11_000_000;

const SYSTEM_PROMPT = `คุณคือระบบอ่านข้อมูลจากภาพใบกำกับภาษี/ใบเสร็จของไทย ให้สกัดข้อมูลอย่างแม่นยำที่สุดตามกติกาต่อไปนี้:

1. อ่านค่า "ตามที่พิมพ์จริง" เท่านั้น ห้ามเดา ห้ามแปลภาษา ห้ามเติมข้อมูลที่ไม่มีในภาพ ค่าที่อ่านไม่ได้/ไม่มี ให้เป็น null และใส่คำอธิบายใน warnings
2. เลขไทย (๐-๙) ให้แปลงเป็นเลขอารบิก
3. วันที่: ถ้าเป็นปีพุทธศักราช (พ.ศ. เช่น 2568/2569 หรือปีสองหลักเช่น 68) ให้แปลงเป็นคริสต์ศักราชก่อน (พ.ศ. - 543) แล้วตอบรูปแบบ YYYY-MM-DD
4. เลขประจำตัวผู้เสียภาษี: ตอบเป็นตัวเลข 13 หลักติดกันไม่มีขีด
5. ประเภทเอกสาร: "tax_invoice_full" = มีคำว่าใบกำกับภาษี (เต็มรูป มีชื่อ-ที่อยู่ผู้ซื้อ), "tax_invoice_abb" = ใบกำกับภาษีอย่างย่อ/ABB, "receipt" = ใบเสร็จ/บิลเงินสดที่ไม่ใช่ใบกำกับภาษี, "delivery_note" = ใบส่งของ, "other" = อื่นๆ
6. line_items: เก็บทุกบรรทัดสินค้า/บริการ ตาม description ที่พิมพ์จริง ห้ามรวมบรรทัดส่วนลด/ยอดรวมเข้าเป็นสินค้า ถ้ามีส่วนลดให้ใส่ใน discount
7. ตัวเลขเงิน: ตอบเป็น number ไม่มี comma, subtotal = ยอดก่อน VAT (หรือยอดรวมถ้าไม่มี VAT), vat_amount = จำนวน VAT ตามที่พิมพ์, total = ยอดสุทธิที่ต้องชำระ
8. ก่อนตอบ ให้ตรวจทานว่า ผลรวม line_items ใกล้เคียง subtotal และ subtotal - discount + vat_amount ≈ total ถ้าไม่ตรงให้อ่านซ้ำอย่างละเอียด และถ้ายังไม่ตรงให้ระบุใน warnings
9. confidence: "high" = ภาพชัด อ่านได้ครบ, "medium" = อ่านได้ส่วนใหญ่แต่บางจุดไม่แน่ใจ, "low" = ภาพมัว/ไม่ครบ/ไม่แน่ใจหลายจุด
10. warnings เขียนเป็นภาษาไทยสั้นๆ`;

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
      "total", "payment_method", "notes", "confidence", "warnings",
    ],
    properties: {
      document_type: {
        type: "string",
        enum: ["tax_invoice_full", "tax_invoice_abb", "receipt", "delivery_note", "other"],
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
          required: ["description", "quantity", "unit", "unit_price", "amount"],
          properties: {
            description: { type: "string" },
            quantity: { type: ["number", "null"] },
            unit: { type: ["string", "null"] },
            unit_price: { type: ["number", "null"] },
            amount: { type: ["number", "null"] },
          },
        },
      },
      subtotal: { type: ["number", "null"] },
      discount: { type: ["number", "null"] },
      vat_rate: { type: ["number", "null"] },
      vat_amount: { type: ["number", "null"] },
      total: { type: ["number", "null"] },
      payment_method: { type: ["string", "null"] },
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

  let body: { image?: string; mediaType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const { image, mediaType } = body;
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
              text: "อ่านข้อมูลจากภาพใบกำกับภาษี/ใบเสร็จนี้ แล้วเรียก record_receipt",
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
