import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { guardRequest, anthropicErrorResponse } from "@/lib/apiguard";

export const maxDuration = 60;

const MODEL = process.env.EXTRACT_MODEL || "claude-opus-5";
const MAX_QUESTION = 500;
const MAX_SUMMARY = 400_000; // ~100k tokens เผื่อร้านที่ข้อมูลเยอะ

const SYSTEM_PROMPT = `คุณคือผู้ช่วยวิเคราะห์ต้นทุนสินค้าให้ร้านค้าไทย ผู้ใช้เป็นเจ้าของร้าน ตอบเป็นภาษาไทยที่เข้าใจง่าย

กติกา:
1. ตอบจากข้อมูล JSON ที่ให้มาเท่านั้น ห้ามเดาหรือแต่งตัวเลขที่ไม่มีในข้อมูล
2. ถ้าข้อมูลไม่พอตอบ ให้บอกตรงๆ ว่าไม่มีข้อมูลส่วนไหน และแนะนำว่าต้องสแกนอะไรเพิ่ม
3. ตอบสั้น ตรงประเด็น ขึ้นต้นด้วยคำตอบก่อนแล้วค่อยขยาย ไม่ต้องเกริ่น
4. อ้างตัวเลขจริงเสมอ ใส่หน่วยบาท และใส่ comma หลักพัน (เช่น 29,158.20 บาท)
5. ถ้าเทียบราคา/แนวโน้ม ให้บอกส่วนต่างเป็นทั้งบาทและเปอร์เซ็นต์
6. ถ้าเห็นประเด็นที่เจ้าของร้านควรรู้ (ของแพงขึ้นผิดปกติ บิลใกล้ครบกำหนด ผู้ขายที่ซื้อเยอะจนน่าต่อรอง) ให้เสริมท้ายสั้นๆ
7. ห้ามแนะนำเรื่องภาษีเชิงกฎหมาย ให้บอกว่าควรปรึกษานักบัญชี
8. ตอบเป็นข้อความธรรมดา ใช้ bullet ได้ ไม่ต้องใส่ตาราง markdown ที่ซับซ้อน`;

export async function POST(req: NextRequest) {
  const denied = guardRequest(req);
  if (denied) return denied;

  let body: { question?: string; summary?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary : "";
  if (!question) {
    return NextResponse.json({ error: "กรุณาพิมพ์คำถาม" }, { status: 400 });
  }
  if (question.length > MAX_QUESTION) {
    return NextResponse.json({ error: "คำถามยาวเกินไป" }, { status: 400 });
  }
  if (!summary || summary.length > MAX_SUMMARY) {
    return NextResponse.json(
      { error: "ข้อมูลร้านไม่ถูกต้องหรือมากเกินไป" },
      { status: 400 }
    );
  }

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `ข้อมูลร้าน (JSON):\n${summary}\n\nคำถามของเจ้าของร้าน: ${question}`,
        },
      ],
    });

    const answer = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!answer) {
      return NextResponse.json(
        { error: "AI ตอบไม่ได้ กรุณาลองถามใหม่" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      answer,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    });
  } catch (err) {
    return anthropicErrorResponse(err, Anthropic);
  }
}
