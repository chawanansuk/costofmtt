import { NextRequest, NextResponse } from "next/server";
import { guardRequest } from "@/lib/apiguard";

// ตรวจว่าเครื่องนี้ใช้ AI ได้ไหม (คีย์ของเซิร์ฟเวอร์ + รหัสผ่านแอป) โดยไม่เรียก AI — ไม่มีค่าใช้จ่าย
// หน้าตั้งค่าเรียกตอนบันทึกรหัส จะได้รู้ทันทีว่ารหัสถูก ไม่ต้องรอไปเจอตอนสแกน
export async function POST(req: NextRequest) {
  const denied = guardRequest(req);
  if (denied) return denied;
  return NextResponse.json({ ok: true, passcodeRequired: Boolean(process.env.APP_PASSCODE) });
}
