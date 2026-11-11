"use client";

import { useEffect, useState, type InputHTMLAttributes } from "react";

export function parseNum(text: string): number | null {
  const t = text.replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const show = (v: number | null) => (v == null ? "" : String(v));

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: number | null;
  onChange: (value: number | null) => void;
}

// ช่องกรอกตัวเลขที่เก็บ "ข้อความที่กำลังพิมพ์" แยกจากค่าตัวเลข
// ถ้าผูก value กับตัวเลขตรงๆ พิมพ์ "12." จะถูกแปลงเป็น 12 แล้วจุดหายทันที — พิมพ์ทศนิยมไม่ได้เลย
export default function NumInput({ value, onChange, ...rest }: Props) {
  const [text, setText] = useState(show(value));
  // ค่าเปลี่ยนจากข้างนอก (กดเกลี่ยยอด, ลบแถว) → แสดงค่าใหม่
  // แต่ถ้าตรงกับที่พิมพ์ค้างอยู่ ("12." = 12) ไม่แตะ ไม่งั้นจะลบสิ่งที่ผู้ใช้กำลังพิมพ์
  useEffect(() => {
    setText((cur) => (parseNum(cur) === value ? cur : show(value)));
  }, [value]);
  return (
    <input
      inputMode="decimal"
      {...rest}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseNum(e.target.value));
      }}
    />
  );
}
