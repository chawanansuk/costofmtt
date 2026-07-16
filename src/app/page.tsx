"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { baht, thaiDate, monthKey, monthLabel } from "@/lib/format";
import BarChart from "@/components/BarChart";

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

  const stats = useMemo(() => {
    if (!receipts) return null;
    const thisMonth = monthKey(null);
    const byMonth = new Map<string, number>();
    let monthCost = 0;
    let monthVat = 0;
    let monthCount = 0;
    const bySeller = new Map<string, number>();

    for (const r of receipts) {
      const mk = monthKey(r.docDate, r.createdAt);
      byMonth.set(mk, (byMonth.get(mk) ?? 0) + r.total);
      if (mk === thisMonth) {
        monthCost += r.total;
        monthCount += 1;
        if (r.vatClaimable) monthVat += r.vatAmount;
      }
      const seller = r.sellerName ?? "(ไม่ระบุ)";
      bySeller.set(seller, (bySeller.get(seller) ?? 0) + r.total);
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

    return { monthCost, monthVat, monthCount, chart, topSellers, recent, totalCount: receipts.length };
  }, [receipts]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>CostSnap</h1>
          <p className="page-sub">บันทึกต้นทุนสินค้าจากใบกำกับภาษี</p>
        </div>
        <Link href="/scan" className="btn btn-primary btn-sm">
          📷 สแกน
        </Link>
      </div>

      {stats && stats.totalCount === 0 ? (
        <div className="empty card">
          <div className="big">🧾</div>
          <h2>เริ่มบันทึกต้นทุนใบแรก</h2>
          <p className="muted mt-2">
            ถ่ายรูปใบกำกับภาษีหรือใบเสร็จ แล้วให้ AI อ่านค่าให้อัตโนมัติ
            <br />
            ตรวจทานแล้วบันทึก — ข้อมูลเก็บอยู่บนเครื่องของคุณ
          </p>
          <Link href="/scan" className="btn btn-primary btn-lg mt-4">
            📷 สแกนใบกำกับภาษี
          </Link>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">ต้นทุนเดือนนี้</div>
              <div className="value">{stats ? baht(stats.monthCost) : "…"}</div>
              <div className="hint">บาท</div>
            </div>
            <div className="stat">
              <div className="label">VAT ซื้อขอคืนได้</div>
              <div className="value">{stats ? baht(stats.monthVat) : "…"}</div>
              <div className="hint">บาท (เดือนนี้)</div>
            </div>
            <div className="stat">
              <div className="label">เอกสารเดือนนี้</div>
              <div className="value">{stats?.monthCount ?? "…"}</div>
              <div className="hint">ใบ</div>
            </div>
            <div className="stat">
              <div className="label">เอกสารทั้งหมด</div>
              <div className="value">{stats?.totalCount ?? "…"}</div>
              <div className="hint">ใบ</div>
            </div>
          </div>

          {stats && (
            <div className="card mt-4">
              <div className="card-title">ต้นทุนย้อนหลัง 6 เดือน (บาท)</div>
              <BarChart data={stats.chart} ariaLabel="กราฟต้นทุนรายเดือนย้อนหลัง 6 เดือน" />
            </div>
          )}

          {stats && stats.topSellers.length > 0 && (
            <div className="card mt-4">
              <div className="card-title">ผู้ขายที่ซื้อมากที่สุด</div>
              <table className="data">
                <tbody>
                  {stats.topSellers.map(([name, total]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="num">{baht(total)} ฿</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {stats && stats.recent.length > 0 && (
            <div className="mt-4">
              <div className="row spread" style={{ marginBottom: 10 }}>
                <h2>เอกสารล่าสุด</h2>
                <Link href="/receipts" className="small">
                  ดูทั้งหมด →
                </Link>
              </div>
              {stats.recent.map((r) => (
                <Link key={r.id} href={`/receipts/${r.id}`} className="list-item">
                  <div>
                    <div className="title">{r.sellerName ?? "(ไม่ระบุผู้ขาย)"}</div>
                    <div className="meta">{thaiDate(r.docDate)}</div>
                  </div>
                  <div className="amount">{baht(r.total)} ฿</div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
