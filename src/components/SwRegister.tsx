"use client";

import { useEffect } from "react";

export default function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    // ขอสิทธิ์ persistent storage — กันเบราว์เซอร์ลบ IndexedDB เอง
    // (สำคัญมากบน iOS ที่เคลียร์ storage ของเว็บที่ไม่ได้เปิดนาน)
    navigator.storage?.persist?.().catch(() => {});
  }, []);
  return null;
}
