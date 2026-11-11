"use client";

import { useState } from "react";

const HINT = ["แตะรูปเพื่อขยาย", "แตะอีกครั้งเพื่อขยายเพิ่ม", "แตะเพื่อย่อกลับ"];

// รูปต้นฉบับที่แตะเพื่อขยายได้ 3 ระดับ: พอดีกรอบ → เต็มความกว้าง → 2.5 เท่า (เลื่อนดูได้)
// ต้องมีเพราะบิลยาวย่อพอดีกรอบแล้วตัวเลขเล็กจนเทียบไม่ได้ และแอปปิดการซูมสองนิ้วของหน้าเว็บไว้
export default function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const [level, setLevel] = useState(0);
  return (
    <div>
      <div className={`zoom-wrap zoom-${level}`}>
        <img
          src={src}
          alt={alt}
          onClick={() => setLevel((l) => (l + 1) % 3)}
        />
      </div>
      <p className="caption mt-2" style={{ textAlign: "center" }}>
        🔍 {HINT[level]}
      </p>
    </div>
  );
}
