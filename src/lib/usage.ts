import { db } from "./db";
import type { UsageRecord } from "./types";

// ราคา Claude Opus 4.8 ต่อ 1 ล้าน token (USD) — ปรับได้ถ้าเปลี่ยนโมเดล
export const PRICE_USD_PER_MTOK = { input: 5, output: 25 };
// อัตราแลกเปลี่ยนโดยประมาณสำหรับแสดงผลเป็นเงินบาท
export const USD_TO_THB = 36;

export function costTHB(u: { inputTokens: number; outputTokens: number }): number {
  const usd =
    (u.inputTokens / 1_000_000) * PRICE_USD_PER_MTOK.input +
    (u.outputTokens / 1_000_000) * PRICE_USD_PER_MTOK.output;
  return usd * USD_TO_THB;
}

// บันทึกการใช้ AI 1 ครั้ง (ไม่ให้ error บังแอปหลัก ถ้าบันทึกไม่ได้ก็ข้าม)
export async function recordUsage(
  kind: UsageRecord["kind"],
  usage: { input_tokens: number; output_tokens: number } | undefined,
  model = "claude-opus-4-8"
): Promise<void> {
  if (!usage) return;
  try {
    await db.usage.add({
      at: Date.now(),
      kind,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      model,
    });
  } catch {
    // ไม่สำคัญพอที่จะทำให้การสแกนล้มเหลว
  }
}

export interface UsageSummary {
  monthScans: number;
  monthAsks: number;
  monthCostTHB: number;
  totalScans: number;
  totalCostTHB: number;
  avgPerScanTHB: number;
}

export function summarizeUsage(records: UsageRecord[]): UsageSummary {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let monthScans = 0;
  let monthAsks = 0;
  let monthCostTHB = 0;
  let totalScans = 0;
  let totalCostTHB = 0;
  let scanCostTHB = 0;

  for (const r of records) {
    const c = costTHB(r);
    totalCostTHB += c;
    if (r.kind === "extract") {
      totalScans += 1;
      scanCostTHB += c;
    }
    if (r.at >= monthStart) {
      monthCostTHB += c;
      if (r.kind === "extract") monthScans += 1;
      else monthAsks += 1;
    }
  }
  return {
    monthScans,
    monthAsks,
    monthCostTHB,
    totalScans,
    totalCostTHB,
    avgPerScanTHB: totalScans > 0 ? scanCostTHB / totalScans : 0,
  };
}
