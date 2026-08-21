import { NextRequest, NextResponse } from "next/server";

// ด่านป้องกัน API ที่ใช้ร่วมกันทุก endpoint ที่เรียก AI:
// ตรวจว่ามีคีย์, จำกัดจำนวนครั้งต่อ IP, และรหัสผ่านแอป (ถ้าตั้งไว้)
const RATE_WINDOW_MS = 60_000;
// 20/นาที เผื่อพนักงานหลายคนใช้งานหลัง WiFi ร้านเดียวกัน (IP เดียวกัน)
const RATE_MAX_REQUESTS = 20;
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

/** คืน NextResponse ถ้าถูกปฏิเสธ, คืน null ถ้าผ่าน */
export function guardRequest(req: NextRequest): NextResponse | null {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY" },
      { status: 500 }
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "ใช้งานถี่เกินไป กรุณารอ 1 นาทีแล้วลองใหม่" },
      { status: 429 }
    );
  }

  const passcode = process.env.APP_PASSCODE;
  if (passcode && req.headers.get("x-app-passcode") !== passcode) {
    return NextResponse.json(
      { error: "ต้องใส่รหัสผ่านแอปให้ถูกต้องก่อนใช้งาน — ตั้งได้ที่หน้า ตั้งค่า" },
      { status: 401 }
    );
  }
  return null;
}

/** แปลง error จาก Anthropic เป็นข้อความไทยที่ผู้ใช้เข้าใจ */
export function anthropicErrorResponse(err: unknown, Anthropic: {
  AuthenticationError: new (...a: never[]) => Error;
  RateLimitError: new (...a: never[]) => Error;
  APIConnectionError: new (...a: never[]) => Error;
  APIError: new (...a: never[]) => Error;
}): NextResponse {
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
    console.error("Anthropic API error:", err);
    return NextResponse.json({ error: "บริการ AI ขัดข้อง กรุณาลองใหม่" }, { status: 502 });
  }
  console.error("unexpected error:", err);
  return NextResponse.json({ error: "เกิดข้อผิดพลาดภายใน" }, { status: 500 });
}
