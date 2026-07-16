"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { baht, thaiDate } from "@/lib/format";

interface ProductSummary {
  name: string;
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
          name: it.description,
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
        }
      }
    }
    const list = [...map.values()].map((p) => ({
      ...p,
      avgUnitCost: p.totalQty > 0 ? p.totalSpent / p.totalQty : p.lastPrice,
    }));
    return list.sort((a, b) => b.totalSpent - a.totalSpent);
  }, [items]);

  const filtered = useMemo(() => {
    if (!products) return [];
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, search]);

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

      <div className="field mt-2">
        <input
          placeholder="ค้นหาสินค้า/วัตถุดิบ"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
          return (
            <div key={p.name + p.lastDate} className="card">
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
