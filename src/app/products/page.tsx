"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { baht, thaiDate, CATEGORY_LABEL } from "@/lib/format";

interface ProductSummary {
  key: string; // normalizedName — ใช้เป็น react key และดึงประวัติ
  name: string;
  category: string | null;
  buyCount: number;
  totalQty: number;
  unit: string | null;
  totalSpent: number;
  avgUnitCost: number; // ต้นทุนเฉลี่ยถ่วงน้ำหนักตามปริมาณ
  lastPrice: number;
  lastDate: string | null;
  minPrice: number;
  maxPrice: number;
}

export default function ProductsPage() {
  const items = useLiveQuery(() => db.items.toArray(), []);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");

  const products = useMemo(() => {
    if (!items) return null;
    const map = new Map<string, ProductSummary & { _lastTs: string }>();
    for (const it of items) {
      if (!it.normalizedName) continue;
      const key = it.normalizedName;
      const cur = map.get(key);
      const date = it.docDate ?? "";
      if (!cur) {
        map.set(key, {
          key,
          name: it.description,
          category: it.category ?? null,
          buyCount: 1,
          totalQty: it.quantity,
          unit: it.unit,
          totalSpent: it.amount,
          avgUnitCost: 0,
          lastPrice: it.unitPrice,
          lastDate: it.docDate,
          minPrice: it.unitPrice,
          maxPrice: it.unitPrice,
          _lastTs: date,
        });
      } else {
        cur.buyCount += 1;
        cur.totalQty += it.quantity;
        cur.totalSpent += it.amount;
        cur.minPrice = Math.min(cur.minPrice, it.unitPrice);
        cur.maxPrice = Math.max(cur.maxPrice, it.unitPrice);
        if (date >= cur._lastTs) {
          cur._lastTs = date;
          cur.lastPrice = it.unitPrice;
          cur.lastDate = it.docDate;
          cur.name = it.description;
          cur.unit = it.unit ?? cur.unit;
          cur.category = it.category ?? cur.category;
        }
      }
    }
    const list = [...map.values()].map((p) => ({
      ...p,
      avgUnitCost: p.totalQty > 0 ? p.totalSpent / p.totalQty : p.lastPrice,
    }));
    return list.sort((a, b) => b.totalSpent - a.totalSpent);
  }, [items]);

  // ประวัติการซื้อต่อสินค้า (ล่าสุดก่อน) สำหรับ drill-down
  const history = useMemo(() => {
    const m = new Map<string, NonNullable<typeof items>>();
    for (const it of items ?? []) {
      if (!it.normalizedName) continue;
      const arr = m.get(it.normalizedName) ?? [];
      arr.push(it);
      m.set(it.normalizedName, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (b.docDate ?? "").localeCompare(a.docDate ?? ""));
    }
    return m;
  }, [items]);

  const filtered = useMemo(() => {
    if (!products) return [];
    const q = search.toLowerCase();
    return products.filter((p) => {
      if (category && p.category !== category) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, search, category]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>ต้นทุนต่อสินค้า</h1>
          <p className="page-sub">
            รวมจากรายการในใบกำกับภาษีทั้งหมด {products?.length ?? 0} รายการ
          </p>
        </div>
      </div>

      <div className="row mt-2">
        <div className="field" style={{ flex: 1 }}>
          <input
            placeholder="ค้นหาสินค้า/วัตถุดิบ"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field" style={{ width: 150 }}>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">ทุกหมวด</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {products && filtered.length === 0 && (
        <div className="empty">
          <div className="big">📦</div>
          <p>ยังไม่มีข้อมูลสินค้า — สแกนใบกำกับภาษีก่อน</p>
        </div>
      )}

      <div className="stack mt-4">
        {filtered.map((p) => {
          const priceChanged =
            p.buyCount > 1 && Math.abs(p.maxPrice - p.minPrice) > 0.005;
          const hist = history.get(p.key) ?? [];
          return (
            <div key={p.key} className="card">
              <div className="row spread">
                <div className="title" style={{ fontWeight: 600 }}>
                  {p.name}
                </div>
                <div className="amount">{baht(p.totalSpent)} ฿</div>
              </div>
              <div className="muted small mt-2">
                ซื้อ {p.buyCount} ครั้ง · รวม {p.totalQty.toLocaleString("th-TH")}{" "}
                {p.unit ?? "หน่วย"} · ล่าสุด {thaiDate(p.lastDate)}
              </div>
              <div className="row wrap mt-2" style={{ gap: 6 }}>
                {p.category && (
                  <span className="badge badge-neutral">
                    {CATEGORY_LABEL[p.category] ?? p.category}
                  </span>
                )}
                <span className="badge badge-neutral">
                  เฉลี่ย {baht(p.avgUnitCost)} ฿/{p.unit ?? "หน่วย"}
                </span>
                <span className="badge badge-accent">
                  ล่าสุด {baht(p.lastPrice)} ฿
                </span>
                {priceChanged && (
                  <span className="badge badge-warn">
                    ช่วงราคา {baht(p.minPrice)}–{baht(p.maxPrice)} ฿
                  </span>
                )}
              </div>
              {hist.length > 0 && (
                <details className="mt-2">
                  <summary className="muted small" style={{ cursor: "pointer" }}>
                    ดูประวัติการซื้อ ({hist.length} ครั้ง)
                  </summary>
                  <div className="table-wrap mt-2">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>วันที่</th>
                          <th>ผู้ขาย</th>
                          <th className="num">จำนวน</th>
                          <th className="num">ราคา/หน่วย</th>
                          <th className="num">รวม</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hist.slice(0, 10).map((h) => (
                          <tr key={h.id}>
                            <td>{thaiDate(h.docDate)}</td>
                            <td>{h.sellerName ?? "—"}</td>
                            <td className="num">
                              {h.quantity} {h.unit ?? ""}
                            </td>
                            <td className="num">{baht(h.unitPrice)}</td>
                            <td className="num">{baht(h.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {hist.length > 10 && (
                    <p className="muted small mt-2">แสดง 10 ครั้งล่าสุดจาก {hist.length}</p>
                  )}
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
