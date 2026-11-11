"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import {
  baht, thaiDate, monthKey, monthLabel, CATEGORY_LABEL, isCostDocument, todayISO,
} from "@/lib/format";
import { useCostBasis, itemAmount, COST_BASIS_LABEL } from "@/lib/costbasis";
import BarChart from "@/components/BarChart";
import BackupReminder from "@/components/BackupReminder";

function lastMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export default function DashboardPage() {
  const receipts = useLiveQuery(() => db.receipts.toArray(), []);
  const items = useLiveQuery(() => db.items.toArray(), []);
  const basis = useCostBasis();

  const stats = useMemo(() => {
    if (!receipts) return null;
    const thisMonth = monthKey(null);
    const byMonth = new Map<string, number>();
    let monthCost = 0;
    let monthVat = 0;
    let monthCount = 0;
    const bySeller = new Map<string, number>();
    // ใบเสนอราคา/ใบยืมสินค้ายังไม่ใช่การซื้อ — ไม่นับเป็นต้นทุน
    const costReceipts = receipts.filter((r) => isCostDocument(r.documentType));
    const skipped = receipts.length - costReceipts.length;
    // ต้นทุนตามฐานที่ผู้ใช้เลือก: รวม VAT = ยอดสุทธิ, ก่อน VAT = ฐานภาษี
    const amountOf = (r: (typeof receipts)[number]) =>
      basis === "inc" ? r.total : r.subtotal;

    for (const r of costReceipts) {
      const mk = monthKey(r.docDate, r.createdAt);
      byMonth.set(mk, (byMonth.get(mk) ?? 0) + amountOf(r));
      if (mk === thisMonth) {
        monthCost += amountOf(r);
        monthCount += 1;
        if (r.vatClaimable) monthVat += r.vatAmount;
      }
      const seller = r.sellerName ?? "(ไม่ระบุ)";
      bySeller.set(seller, (bySeller.get(seller) ?? 0) + amountOf(r));
    }

    const chart = lastMonths(6).map((mk) => ({
      label: monthLabel(mk),
      value: byMonth.get(mk) ?? 0,
    }));

    const topSellers = [...bySeller.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const recent = [...receipts]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);

    // บิลค้างจ่าย (ซื้อเครดิต) — เรียงตามวันครบกำหนดใกล้สุดก่อน
    const unpaid = costReceipts
      .filter((r) => r.paid === false)
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
    const unpaidTotal = unpaid.reduce((s, r) => s + r.total, 0);

    // ต้นทุนตามหมวดหมู่เดือนนี้ (อิงเดือนของใบที่รายการนั้นสังกัด)
    const receiptMonth = new Map<number, string>();
    for (const r of costReceipts) {
      if (r.id != null) receiptMonth.set(r.id, monthKey(r.docDate, r.createdAt));
    }
    const byCategory = new Map<string, number>();
    for (const it of items ?? []) {
      if (receiptMonth.get(it.receiptId) !== thisMonth) continue;
      const key = it.category ?? "uncategorized";
      byCategory.set(key, (byCategory.get(key) ?? 0) + itemAmount(it, basis));
    }
    const categories = [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, total]) => ({
        key,
        label: key === "uncategorized" ? "ไม่ระบุหมวด" : CATEGORY_LABEL[key] ?? key,
        total,
      }));
    const categoryMax = Math.max(...categories.map((c) => c.total), 1);

    return {
      monthCost, monthVat, monthCount, chart, topSellers, recent,
      totalCount: receipts.length, categories, categoryMax,
      unpaid, unpaidTotal, skipped,
    };
  }, [receipts, items, basis]);


  const today = todayISO();
  const monthTitle = monthLabel(monthKey(null));

  if (stats && stats.totalCount === 0) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>ภาพรวมต้นทุน</h1>
            <p className="page-sub">บันทึกต้นทุนสินค้าจากใบกำกับภาษี</p>
          </div>
        </div>
        <div className="empty card">
          <div className="big">🧾</div>
          <h2>เริ่มบันทึกต้นทุนใบแรก</h2>
          <p className="muted mt-3">
            ถ่ายรูปใบกำกับภาษีหรือใบเสร็จ แล้วให้ AI อ่านค่าให้อัตโนมัติ
            <br />
            ตรวจทานแล้วบันทึก — ข้อมูลเก็บอยู่บนเครื่องของคุณ
          </p>
          <Link href="/scan" className="btn btn-primary btn-lg mt-4">
            📷 สแกนใบกำกับภาษี
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>ภาพรวมต้นทุน</h1>
          <p className="page-sub">{monthTitle} · ข้อมูลเก็บบนเครื่องนี้</p>
        </div>
        <Link href="/scan" className="btn btn-primary">
          📷 สแกนใบกำกับภาษี
        </Link>
      </div>

      <BackupReminder />

      {/* มือถือ: ยอดหลักเป็นการ์ดเด่น อ่านได้ทันทีที่เปิดแอป */}
      <div className="hero-stat only-mobile">
        <div className="label">ต้นทุนเดือนนี้ · {monthTitle}</div>
        <div className="value">{stats ? baht(stats.monthCost) : "…"}</div>
        <div className="hint">
          บาท · {COST_BASIS_LABEL[basis]} · {stats?.monthCount ?? 0} ใบ
        </div>
      </div>

      <div className="stat-grid mt-3">
        <div className="stat only-desktop">
          <div className="label">ต้นทุนเดือนนี้</div>
          <div className="value">{stats ? baht(stats.monthCost) : "…"}</div>
          <div className="hint">บาท · {COST_BASIS_LABEL[basis]}</div>
        </div>
        <div className="stat">
          <div className="label">VAT ซื้อขอคืนได้</div>
          <div className="value">{stats ? baht(stats.monthVat) : "…"}</div>
          <div className="hint">บาท · เดือนนี้</div>
        </div>
        <div className={`stat ${stats && stats.unpaidTotal > 0 ? "is-alert" : ""}`}>
          <div className="label">ค้างจ่าย</div>
          <div className="value">{stats ? baht(stats.unpaidTotal) : "…"}</div>
          <div className="hint">บาท · {stats?.unpaid.length ?? 0} ใบ</div>
        </div>
        <div className="stat only-desktop">
          <div className="label">เอกสารเดือนนี้</div>
          <div className="value">{stats?.monthCount ?? "…"}</div>
          <div className="hint">ใบ · ทั้งหมด {stats?.totalCount ?? 0} ใบ</div>
        </div>
      </div>

      {stats && stats.skipped > 0 && (
        <p className="muted small mt-3">
          ไม่นับใบเสนอราคา/ใบยืมสินค้า {stats.skipped} ใบ เป็นต้นทุน (ยังดูได้ในหน้าเอกสาร)
        </p>
      )}

      <div className="grid-2 side-first mt-5">
        {/* ---------- คอลัมน์หลัก ---------- */}
        <div>
          {stats && (
            <div className="card">
              <div className="card-head">
                <div className="card-title">ต้นทุนย้อนหลัง 6 เดือน (บาท)</div>
              </div>
              <BarChart data={stats.chart} ariaLabel="กราฟต้นทุนรายเดือนย้อนหลัง 6 เดือน" />
            </div>
          )}

          {stats && stats.categories.length > 0 && (
            <div className="card">
              <div className="card-title">ต้นทุนตามหมวดหมู่ · เดือนนี้</div>
              <div style={{ display: "grid", gap: "var(--space-3)" }}>
                {stats.categories.map((c) => (
                  <div key={c.key}>
                    <div className="row spread small">
                      <span>{c.label}</span>
                      <span className="num" style={{ fontWeight: 600 }}>
                        {baht(c.total)} ฿
                      </span>
                    </div>
                    <div className="bar-track mt-2">
                      <div
                        className="bar-fill"
                        style={{ width: `${Math.max(2, (c.total / stats.categoryMax) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats && stats.recent.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div className="card-title">เอกสารล่าสุด</div>
                <Link href="/receipts" className="card-action">ดูทั้งหมด →</Link>
              </div>
              <div className="kv">
                {stats.recent.map((r) => (
                  <Link key={r.id} href={`/receipts/${r.id}`} className="kv-row">
                    <span className="k" style={{ color: "var(--text-primary)" }}>
                      <span style={{ fontWeight: 600 }}>{r.sellerName ?? "(ไม่ระบุผู้ขาย)"}</span>
                      <span className="caption" style={{ display: "block" }}>
                        {thaiDate(r.docDate)}
                      </span>
                    </span>
                    <span className="v" style={{ fontWeight: 600 }}>{baht(r.total)} ฿</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ---------- คอลัมน์ข้าง ---------- */}
        <div>
          <Link href="/ask" className="card" style={{ display: "block", background: "var(--brand-primary)", borderColor: "var(--brand-primary)" }}>
            <div style={{ color: "#fff", fontSize: "var(--fs-h3)", fontWeight: 600 }}>
              🤖 ถาม AI เกี่ยวกับต้นทุน
            </div>
            <div className="mt-2" style={{ color: "#bcd6cb", fontSize: "var(--fs-body-sm)" }}>
              เช่น &quot;เดือนนี้อะไรแพงขึ้นบ้าง&quot; · &quot;ควรต่อรองเจ้าไหน&quot;
            </div>
          </Link>

          {stats && stats.unpaid.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div className="card-title">บิลค้างจ่าย</div>
                <span className="badge badge-danger">{stats.unpaid.length} ใบ</span>
              </div>
              <div
                className="num"
                style={{ fontSize: "var(--fs-h2)", lineHeight: "var(--lh-h2)", fontWeight: 700, color: "var(--state-error)" }}
              >
                {baht(stats.unpaidTotal)} ฿
              </div>
              <div className="kv mt-3">
                {stats.unpaid.slice(0, 5).map((r) => {
                  const overdue = r.dueDate != null && r.dueDate < today;
                  return (
                    <Link key={r.id} href={`/receipts/${r.id}`} className="kv-row">
                      <span className="k" style={{ color: "var(--text-primary)" }}>
                        {r.sellerName ?? "(ไม่ระบุผู้ขาย)"}
                        <span
                          className="caption"
                          style={{ display: "block", color: overdue ? "var(--state-error)" : "var(--state-warning)" }}
                        >
                          {r.dueDate
                            ? `${overdue ? "เลยกำหนด! " : "ครบกำหนด "}${thaiDate(r.dueDate)}`
                            : "ไม่ระบุกำหนดชำระ"}
                        </span>
                      </span>
                      <span className="v" style={{ fontWeight: 600 }}>{baht(r.total)} ฿</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {stats && stats.topSellers.length > 0 && (
            <div className="card">
              <div className="card-title">ผู้ขายที่ซื้อมากที่สุด</div>
              <div className="kv">
                {stats.topSellers.map(([name, total]) => (
                  <div key={name} className="kv-row">
                    <span className="k">{name}</span>
                    <span className="v" style={{ fontWeight: 600 }}>{baht(total)} ฿</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
