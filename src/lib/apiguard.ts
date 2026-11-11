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
  if (passcode && !passcodeMatches(req.headers.get("x-app-passcode"), passcode)) {
    return NextResponse.json(
      { error: "ต้องใส่รหัสผ่านแอปให้ถูกต้องก่อนใช้งาน — ตั้งได้ที่หน้า ตั้งค่า" },
      { status: 401 }
    );
  }
  return null;
}

// เทียบโดยใช้เวลาเท่ากันทุกกรณี — ไม่ให้เดารหัสทีละตัวจากเวลาที่ตอบ
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// แอปส่งรหัสแบบ percent-encode (header รับได้แค่ตัวอักษร Latin-1 — รหัสภาษาไทยส่งตรงๆ ไม่ได้)
// รับแบบดิบด้วย เผื่อเครื่องที่ยังค้างแอปรุ่นเก่าใน cache
function passcodeMatches(header: string | null, passcode: string): boolean {
  if (header == null) return false;
  let decoded = header;
  try {
    decoded = decodeURIComponent(header);
  } catch {
    // ไม่ใช่ percent-encoding ที่ถูกต้อง — เทียบแบบดิบอย่างเดียว
  }
  return safeEqual(decoded, passcode) || safeEqual(header, passcode);
}

// เวลาทั้งหมดที่ยอมให้คุยกับ AI ต่อหนึ่งคำขอ — ต้องจบก่อน maxDuration ของ Vercel (300 วิ)
// ถ้าปล่อยให้ Vercel ตัดเอง ผู้ใช้จะได้หน้า error ของ Vercel แทนข้อความที่บอกว่าต้องทำอะไรต่อ
export const AI_DEADLINE_MS = 275_000;

export function startDeadline(ms = AI_DEADLINE_MS) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    elapsed: () => Date.now() - startedAt,
    stop: () => clearTimeout(timer),
  };
}

type ErrorClass = new (...a: never[]) => Error;

/** แปลง error จาก Anthropic เป็นข้อความไทยที่ผู้ใช้เข้าใจ */
export function anthropicErrorResponse(err: unknown, Anthropic: {
  AuthenticationError: ErrorClass;
  PermissionDeniedError: ErrorClass;
  RateLimitError: ErrorClass;
  BadRequestError: ErrorClass;
  APIUserAbortError: ErrorClass;
  APIConnectionTimeoutError: ErrorClass;
  APIConnectionError: ErrorClass;
  APIError: ErrorClass;
}): NextResponse {
  // หมดเวลา (เราตัดเองตาม AI_DEADLINE_MS หรือ SDK timeout) — ต้องมาก่อน APIConnectionError
  if (
    err instanceof Anthropic.APIUserAbortError ||
    err instanceof Anthropic.APIConnectionTimeoutError
  ) {
    return NextResponse.json(
      {
        error:
          "AI ใช้เวลานานเกินกำหนด — กดลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้ถ่ายใกล้ขึ้นหรือแบ่งบิลยาวเป็นสองรูป",
      },
      { status: 504 }
    );
  }
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    console.error("Anthropic auth error:", err);
    return NextResponse.json(
      { error: "API key ของบริการ AI ใช้ไม่ได้ (หมดอายุ/ถูกปิด/เครดิตหมด) — ต้องแก้ที่การตั้งค่าเซิร์ฟเวอร์" },
      { status: 500 }
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return NextResponse.json(
      { error: "ใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่" },
      { status: 429 }
    );
  }
  if (err instanceof Anthropic.BadRequestError) {
    console.error("Anthropic bad request:", err);
    return NextResponse.json(
      { error: "AI ไม่รับคำขอนี้ — ถ้าเป็นการสแกน ลองถ่ายรูปใหม่ (รูปอาจเสียหรือใหญ่เกิน)" },
      { status: 502 }
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
    const overloaded = (err as { status?: number }).status === 529;
    return NextResponse.json(
      {
        error: overloaded
          ? "บริการ AI มีผู้ใช้หนาแน่น กรุณารอ 1–2 นาทีแล้วลองใหม่"
          : "บริการ AI ขัดข้อง กรุณาลองใหม่",
      },
      { status: 502 }
    );
  }
  console.error("unexpected error:", err);
  return NextResponse.json({ error: "เกิดข้อผิดพลาดภายใน" }, { status: 500 });
}
