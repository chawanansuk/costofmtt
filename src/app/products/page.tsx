"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { baht, thaiDate, CATEGORY_LABEL, isCostDocument } from "@/lib/format";
import {
  useCostBasis,
  itemUnitCost,
  itemAmount,
  COST_BASIS_LABEL,
} from "@/lib/costbasis";

interface SellerRow {
  seller: string;
  qty: number;
  spent: number;
  avg: number; // ต้นทุนเฉลี่ยถ่วงน้ำหนักตามปริมาณของผู้ขายรายนี้
  last: number;
  lastDate: string | null;
  times: number;
}

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
  // ใบเสนอราคา/ใบยืมสินค้ายังไม่ใช่ราคาที่จ่ายจริง ไม่เอามาคิดต้นทุน
  const nonCostIds = useLiveQuery(async () => {
    const rs = await db.receipts.toArray();
    return new Set(
      rs.filter((r) => !isCostDocument(r.documentType)).map((r) => r.id!)
    );
  }, []);
  const basis = useCostBasis();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");

  const products = useMemo(() => {
    if (!items) return null;
    const map = new Map<string, ProductSummary & { _lastTs: string }>();
    for (const it of items) {
      if (!it.normalizedName) continue;
      if (nonCostIds?.has(it.receiptId)) continue;
      // ของแถมนับเป็นจำนวนที่ได้รับด้วย → ต้นทุนเฉลี่ยต่อหน่วยต่ำลงตามจริง
      const qty = it.quantity + (it.freeQuantity ?? 0);
      const price = itemUnitCost(it, basis);
      const spent = itemAmount(it, basis);
      // รวมกลุ่มด้วย ชื่อ+หน่วย — สินค้าเดียวกันคนละหน่วย (เช่น ลัง กับ สำรับ)
      // ราคาต่อหน่วยต่างกันมาก ห้ามเฉลี่ยข้ามหน่วย
      const key = `${it.normalizedName}|${it.unit ?? ""}`;
      const cur = map.get(key);
      const date = it.docDate ?? "";
      if (!cur) {
        map.set(key, {
          key,
          name: it.description,
          category: it.category ?? null,
          buyCount: 1,
          totalQty: qty,
          unit: it.unit,
          totalSpent: spent,
          avgUnitCost: 0,
          lastPrice: price,
          lastDate: it.docDate,
          minPrice: it.isFreebie ? Infinity : price,
          maxPrice: it.isFreebie ? 0 : price,
          _lastTs: date,
        });
      } else {
        cur.buyCount += 1;
        cur.totalQty += qty;
        cur.totalSpent += spent;
        if (!it.isFreebie) {
          cur.minPrice = Math.min(cur.minPrice, price);
          cur.maxPrice = Math.max(cur.maxPrice, price);
        }
        if (date >= cur._lastTs && !it.isFreebie) {
          cur._lastTs = date;
          cur.lastPrice = price;
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
      minPrice: Number.isFinite(p.minPrice) ? p.minPrice : p.lastPrice,
      maxPrice: p.maxPrice > 0 ? p.maxPrice : p.lastPrice,
    }));
    return list.sort((a, b) => b.totalSpent - a.totalSpent);
  }, [items, basis, nonCostIds]);

  // ประวัติการซื้อต่อสินค้า (ล่าสุดก่อน) สำหรับ drill-down — key เดียวกับด้านบน
  const history = useMemo(() => {
    const m = new Map<string, NonNullable<typeof items>>();
    for (const it of items ?? []) {
      if (nonCostIds?.has(it.receiptId)) continue;
      if (!it.normalizedName) continue;
      const key = `${it.normalizedName}|${it.unit ?? ""}`;
      const arr = m.get(key) ?? [];
      arr.push(it);
      m.set(key, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (b.docDate ?? "").localeCompare(a.docDate ?? ""));
    }
    return m;
  }, [items, nonCostIds]);

  // เทียบราคาสินค้าเดียวกันระหว่างผู้ขาย — ใช้ต้นทุนเฉลี่ยถ่วงน้ำหนักตามปริมาณ
  // เพราะบางเจ้าขายทีละน้อยราคาแพงกว่า การเทียบราคาล่าสุดอย่างเดียวจะหลอกตา
  const sellerCompare = useMemo(() => {
    // saving = ถ้าซื้อจากเจ้าถูกสุดทั้งหมด จะประหยัดได้เท่าไร
    const out = new Map<string, { rows: SellerRow[]; saving: number }>();
    for (const [key, list] of history) {
      const bySeller = new Map<string, SellerRow & { _ts: string }>();
      for (const it of list) {
        if (it.isFreebie) continue; // ของแถมล้วนไม่ใช่ราคาซื้อ
        const qty = it.quantity + (it.freeQuantity ?? 0);
        const spent = itemAmount(it, basis);
        if (qty <= 0 || spent <= 0) continue;
        const name = it.sellerName ?? "(ไม่ระบุผู้ขาย)";
        const d = it.docDate ?? "";
        const cur = bySeller.get(name);
        if (!cur) {
          bySeller.set(name, {
            seller: name, qty, spent, avg: spent / qty,
            last: itemUnitCost(it, basis), lastDate: it.docDate, times: 1, _ts: d,
          });
        } else {
          cur.qty += qty;
          cur.spent += spent;
          cur.times += 1;
          if (d >= cur._ts) {
            cur._ts = d;
            cur.last = itemUnitCost(it, basis);
            cur.lastDate = it.docDate;
          }
        }
      }
      if (bySeller.size < 2) continue;
      const rows = [...bySeller.values()]
        .map((r) => ({ ...r, avg: r.spent / r.qty }))
        .sort((a, b) => a.avg - b.avg);
      const cheapest = rows[0].avg;
      const saving = rows.reduce((s, r) => s + (r.avg - cheapest) * r.qty, 0);
      out.set(key, { rows, saving });
    }
    return out;
  }, [history, basis]);

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
            รวมจากรายการในใบกำกับภาษีทั้งหมด {products?.length ?? 0} รายการ ·
            ต้นทุน<strong>{COST_BASIS_LABEL[basis]}</strong> (เปลี่ยนได้ในหน้าตั้งค่า)
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
          const cmp = sellerCompare.get(p.key);
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
              {cmp && (
                <details className="mt-2" open>
                  <summary
                    className="small"
                    style={{ cursor: "pointer", color: "var(--primary)", fontWeight: 600 }}
                  >
                    🏷️ เทียบราคา {cmp.rows.length} เจ้า — ถูกสุด{" "}
                    {cmp.rows[0].seller} ({baht(cmp.rows[0].avg)} ฿)
                  </summary>
                  <div className="table-wrap mt-2">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>ผู้ขาย</th>
                          <th className="num">เฉลี่ย/{p.unit ?? "หน่วย"}</th>
                          <th className="num">ล่าสุด</th>
                          <th className="num">แพงกว่าถูกสุด</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cmp.rows.map((r, i) => {
                          const diff = r.avg - cmp.rows[0].avg;
                          const pct = cmp.rows[0].avg > 0 ? (diff / cmp.rows[0].avg) * 100 : 0;
                          return (
                            <tr key={r.seller}>
                              <td>
                                {i === 0 ? "🥇 " : ""}
                                {r.seller}
                                <div className="small muted">
                                  ซื้อ {r.times} ครั้ง · รวม {baht(r.qty)} {p.unit ?? ""}
                                </div>
                              </td>
                              <td className="num">{baht(r.avg)}</td>
                              <td className="num">
                                {baht(r.last)}
                                <div className="small muted">{thaiDate(r.lastDate)}</div>
                              </td>
                              <td
                                className="num"
                                style={{ color: i === 0 ? "var(--ok)" : "var(--danger)" }}
                              >
                                {i === 0 ? "ถูกสุด" : `+${baht(diff)} (${pct.toFixed(1)}%)`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {cmp.saving >= 1 && (
                    <p className="small mt-2" style={{ color: "var(--ok)" }}>
                      💡 ถ้าซื้อจาก {cmp.rows[0].seller} ทั้งหมดในปริมาณเท่าเดิม
                      จะประหยัดได้ราว <strong>{baht(cmp.saving)} บาท</strong>
                    </p>
                  )}
                </details>
              )}

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
                              {h.freeQuantity ? (
                                <div className="small" style={{ color: "var(--ok)" }}>
                                  + แถม {h.freeQuantity}
                                </div>
                              ) : null}
                              {h.isFreebie && (
                                <div className="small" style={{ color: "var(--ok)" }}>ของแถม</div>
                              )}
                            </td>
                            <td className="num">{baht(itemUnitCost(h, basis))}</td>
                            <td className="num">{baht(itemAmount(h, basis))}</td>
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
