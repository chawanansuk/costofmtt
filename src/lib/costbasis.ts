"use client";

import { useEffect, useState } from "react";
import type { ItemRecord } from "./types";

// ต้นทุนสินค้าจะคิดแบบไหน
//   "inc" = รวม VAT — เงินที่จ่ายออกไปจริงต่อหน่วย (ค่าเริ่มต้น)
//   "ex"  = ก่อน VAT — สำหรับร้านที่จดทะเบียนและขอคืนภาษีซื้อได้
//           (ถ้าขอคืน VAT แล้วยังเอา VAT มาบวกต้นทุนอีก เท่ากับคิดต้นทุนซ้ำ)
export type CostBasis = "inc" | "ex";

export const COST_BASIS_KEY = "costsnap:costBasis";

export function readCostBasis(): CostBasis {
  try {
    return localStorage.getItem(COST_BASIS_KEY) === "ex" ? "ex" : "inc";
  } catch {
    return "inc";
  }
}

/** อ่านค่าหลัง mount เท่านั้น (localStorage ไม่มีตอน prerender) */
export function useCostBasis(): CostBasis {
  const [basis, setBasis] = useState<CostBasis>("inc");
  useEffect(() => {
    setBasis(readCostBasis());
    const onChange = () => setBasis(readCostBasis());
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  }, []);
  return basis;
}

// เอกสารเก่าที่บันทึกก่อนมีฟีเจอร์นี้จะไม่มีช่องรวม VAT — ใช้ค่าก่อน VAT แทน
export function itemUnitCost(it: ItemRecord, basis: CostBasis): number {
  return basis === "inc" ? it.unitPriceIncVat ?? it.unitPrice : it.unitPrice;
}

export function itemAmount(it: ItemRecord, basis: CostBasis): number {
  return basis === "inc" ? it.amountIncVat ?? it.amount : it.amount;
}

export const COST_BASIS_LABEL: Record<CostBasis, string> = {
  inc: "รวม VAT",
  ex: "ก่อน VAT",
};
