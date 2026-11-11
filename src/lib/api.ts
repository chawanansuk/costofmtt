"use client";

// เรียก API ของเราเอง (ฝั่ง client) — แนบรหัสผ่านแอป และแปลงทุกความผิดพลาดเป็นข้อความไทยที่บอกว่าต้องทำอะไรต่อ
// เวลาเกินกำหนด/ไฟล์ใหญ่เกิน Vercel จะตอบเป็นหน้า HTML ไม่ใช่ JSON — ถ้าเรียก res.json() ตรงๆ
// ผู้ใช้จะเห็นแค่ "Unexpected token ... is not valid JSON" ซึ่งไม่รู้ว่าต้องแก้อะไร

const STATUS_MESSAGE: Record<number, string> = {
  401: "ต้องใส่รหัสผ่านแอปให้ถูกต้องก่อนใช้งาน — ตั้งได้ที่หน้า ตั้งค่า",
  413: "รูปใหญ่เกินไป — ลองถ่ายใหม่ให้เห็นเฉพาะตัวบิล หรือครอปขอบออก",
  429: "ใช้งานถี่เกินไป กรุณารอ 1 นาทีแล้วลองใหม่",
  504: "AI ใช้เวลาอ่านนานเกินกำหนด — กดลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้ถ่ายใกล้ขึ้นหรือแบ่งบิลยาวเป็นสองรูป",
};

// status = 0 หมายถึงไปไม่ถึงเซิร์ฟเวอร์ (เน็ตหลุด)
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function postApi<T>(path: string, body: unknown, fallbackError: string): Promise<T> {
  let passcode: string | null = null;
  try {
    passcode = localStorage.getItem("costsnap:passcode");
  } catch {
    // เบราว์เซอร์บล็อก localStorage — ส่งโดยไม่มีรหัส
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // percent-encode: header รับได้แค่ Latin-1 ถ้ารหัสมีอักษรไทย fetch จะ throw ทันที
        ...(passcode ? { "x-app-passcode": encodeURIComponent(passcode) } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่", 0);
  }

  let json: { error?: string } | null = null;
  try {
    json = await res.json();
  } catch {
    // ไม่ใช่ JSON = หน้า error ของ Vercel (timeout, ไฟล์ใหญ่เกิน ฯลฯ)
  }

  if (!res.ok || !json) {
    throw new ApiError(
      json?.error || STATUS_MESSAGE[res.status] || `${fallbackError} (รหัส ${res.status})`,
      res.status
    );
  }
  return json as T;
}
