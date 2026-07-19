"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { ExtractedReceipt, LineItem, CostCategory } from "@/lib/types";
import { validateExtraction, normalizeItemName } from "@/lib/validate";
import { baht, thaiDate, DOC_TYPE_LABEL, CATEGORY_LABEL, TEMP_DOC_TYPES } from "@/lib/format";

interface Props {
  initial: ExtractedReceipt;
  saving?: boolean;
  duplicateWarning?: string | null;
  onSave: (data: ExtractedReceipt) => void;
  onCancel: () => void;
  cancelLabel?: string;
  saveLabel?: string;
  // โหมดแก้ไข: ไม่เอารายการของใบตัวเองมาเทียบราคา
  excludeReceiptId?: number;
}

// เตือนเมื่อราคา/หน่วยแพงกว่าการซื้อครั้งก่อนเกินเกณฑ์นี้
const PRICE_ALERT_THRESHOLD = 0.1;

const numOrNull = (s: string): number | null => {
  if (s.trim() === "") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
};

export default function ReceiptForm({
  initial,
  saving,
  duplicateWarning,
  onSave,
  onCancel,
  cancelLabel = "ยกเลิก",
  saveLabel,
  excludeReceiptId,
}: Props) {
  const [data, setData] = useState<ExtractedReceipt>(initial);
  const validation = useMemo(() => validateExtraction(data), [data]);

  // เทียบราคากับการซื้อครั้งล่าสุดของสินค้าเดียวกัน (ชื่อ+หน่วยเดียวกัน)
  const allItems = useLiveQuery(() => db.items.toArray(), []);
  const priceAlerts = useMemo(() => {
    if (!allItems) return [];
    const alerts: {
      name: string;
      unit: string | null;
      prev: number;
      now: number;
      pct: number;
      prevDate: string | null;
    }[] = [];
    for (const it of data.line_items) {
      const qty = it.quantity ?? 1;
      const now =
        it.amount != null && qty > 0 ? it.amount / qty : it.unit_price;
      if (now == null || now <= 0) continue;
      const key = normalizeItemName(it.description);
      if (!key) continue;
      const prev = allItems
        .filter(
          (p) =>
            p.normalizedName === key &&
            (p.unit ?? "") === (it.unit ?? "") &&
            (excludeReceiptId == null || p.receiptId !== excludeReceiptId)
        )
        .sort((a, b) => (b.docDate ?? "").localeCompare(a.docDate ?? ""))[0];
      if (!prev || prev.unitPrice <= 0) continue;
      const pct = (now - prev.unitPrice) / prev.unitPrice;
      if (pct >= PRICE_ALERT_THRESHOLD) {
        alerts.push({
          name: it.description,
          unit: it.unit,
          prev: prev.unitPrice,
          now,
          pct: pct * 100,
          prevDate: prev.docDate,
        });
      }
    }
    return alerts;
  }, [allItems, data.line_items, excludeReceiptId]);

  const set = (patch: Partial<ExtractedReceipt>) =>
    setData((d) => ({ ...d, ...patch }));
  const setSeller = (patch: Partial<ExtractedReceipt["seller"]>) =>
    setData((d) => ({ ...d, seller: { ...d.seller, ...patch } }));
  const setBuyer = (patch: Partial<ExtractedReceipt["buyer"]>) =>
    setData((d) => ({ ...d, buyer: { ...d.buyer, ...patch } }));
  const setItem = (i: number, patch: Partial<LineItem>) =>
    setData((d) => ({
      ...d,
      line_items: d.line_items.map((it, j) => (j === i ? { ...it, ...patch } : it)),
    }));
  const removeItem = (i: number) =>
    setData((d) => ({ ...d, line_items: d.line_items.filter((_, j) => j !== i) }));
  const addItem = () =>
    setData((d) => ({
      ...d,
      line_items: [
        ...d.line_items,
        { description: "", quantity: 1, unit: null, unit_price: null, amount: null, category: null },
      ],
    }));

  const itemsSum = data.line_items.reduce((s, it) => s + (it.amount ?? 0), 0);

  return (
    <div className="stack">
      {data.warnings.length > 0 && (
        <div className="alert alert-warn">
          <strong>ข้อสังเกตจาก AI:</strong>
          <ul>
            {data.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {duplicateWarning && (
        <div className="alert alert-danger">⚠️ {duplicateWarning}</div>
      )}

      {priceAlerts.length > 0 && (
        <div className="alert alert-warn">
          <strong>📈 ราคาแพงขึ้นจากครั้งก่อน:</strong>
          <ul>
            {priceAlerts.map((a, i) => (
              <li key={i}>
                {a.name}: {baht(a.prev)} → {baht(a.now)} ฿/{a.unit ?? "หน่วย"}{" "}
                (+{a.pct.toFixed(0)}%
                {a.prevDate ? ` เทียบ ${thaiDate(a.prevDate)}` : ""})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="row wrap">
        <span
          className={`badge ${
            data.confidence === "high"
              ? "badge-ok"
              : data.confidence === "medium"
              ? "badge-warn"
              : "badge-danger"
          }`}
        >
          ความมั่นใจของ AI:{" "}
          {data.confidence === "high" ? "สูง" : data.confidence === "medium" ? "ปานกลาง" : "ต่ำ — ตรวจทานให้ละเอียด"}
        </span>
        {validation.sellerTaxIdValid === false && (
          <span className="badge badge-danger">เลขผู้เสียภาษีผู้ขายไม่ผ่านการตรวจ</span>
        )}
        {validation.sellerTaxIdValid === true && (
          <span className="badge badge-ok">เลขผู้เสียภาษีถูกต้อง ✓</span>
        )}
        {validation.totalMathOk === false && (
          <span className="badge badge-warn">ยอดเงินไม่สอดคล้องกัน — ตรวจตัวเลข</span>
        )}
        {validation.vatClaimable ? (
          <span className="badge badge-ok">ใช้ขอคืน VAT ซื้อได้</span>
        ) : (
          <span className="badge badge-neutral">ไม่เข้าเงื่อนไขขอคืน VAT</span>
        )}
        {data.paid === false && (
          <span className="badge badge-accent">ยังไม่จ่าย (เครดิต)</span>
        )}
        {TEMP_DOC_TYPES.has(data.document_type) && (
          <span className="badge badge-warn">
            ใบชั่วคราว — ถ้าใบกำกับภาษีจริงตามมา ให้สแกนแทนแล้วลบใบนี้
          </span>
        )}
      </div>

      {validation.missingFields.length > 0 && (
        <div className="alert alert-warn">
          ใบกำกับภาษีเต็มรูปยังขาด: {validation.missingFields.join(", ")}
        </div>
      )}

      <div className="card">
        <div className="card-title">เอกสาร</div>
        <div className="form-grid">
          <div className="field">
            <label>ประเภทเอกสาร</label>
            <select
              value={data.document_type}
              onChange={(e) =>
                set({ document_type: e.target.value as ExtractedReceipt["document_type"] })
              }
            >
              {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>เลขที่เอกสาร</label>
            <input
              value={data.doc_number ?? ""}
              onChange={(e) => set({ doc_number: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>วันที่ (ค.ศ.)</label>
            <input
              type="date"
              value={data.doc_date ?? ""}
              onChange={(e) => set({ doc_date: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>วิธีชำระเงิน</label>
            <input
              value={data.payment_method ?? ""}
              onChange={(e) => set({ payment_method: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>สถานะจ่ายเงิน</label>
            <select
              value={data.paid === true ? "paid" : data.paid === false ? "unpaid" : ""}
              onChange={(e) =>
                set({
                  paid:
                    e.target.value === "paid"
                      ? true
                      : e.target.value === "unpaid"
                      ? false
                      : null,
                })
              }
            >
              <option value="">— ไม่ระบุ —</option>
              <option value="paid">จ่ายแล้ว ✓</option>
              <option value="unpaid">ยังไม่จ่าย (เครดิต)</option>
            </select>
          </div>
          <div className="field">
            <label>วันครบกำหนดชำระ</label>
            <input
              type="date"
              value={data.due_date ?? ""}
              onChange={(e) => set({ due_date: e.target.value || null })}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">ผู้ขาย</div>
        <div className="form-grid">
          <div className="field full">
            <label>ชื่อผู้ขาย</label>
            <input
              value={data.seller.name ?? ""}
              onChange={(e) => setSeller({ name: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>เลขผู้เสียภาษี (13 หลัก)</label>
            <input
              inputMode="numeric"
              value={data.seller.tax_id ?? ""}
              onChange={(e) => setSeller({ tax_id: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>สาขา</label>
            <input
              value={data.seller.branch ?? ""}
              onChange={(e) => setSeller({ branch: e.target.value || null })}
            />
          </div>
          <div className="field full">
            <label>ที่อยู่</label>
            <input
              value={data.seller.address ?? ""}
              onChange={(e) => setSeller({ address: e.target.value || null })}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">ผู้ซื้อ (ร้านเรา)</div>
        <div className="form-grid">
          <div className="field">
            <label>ชื่อผู้ซื้อ</label>
            <input
              value={data.buyer.name ?? ""}
              onChange={(e) => setBuyer({ name: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>เลขผู้เสียภาษีผู้ซื้อ</label>
            <input
              inputMode="numeric"
              value={data.buyer.tax_id ?? ""}
              onChange={(e) => setBuyer({ tax_id: e.target.value || null })}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row spread">
          <div className="card-title" style={{ marginBottom: 0 }}>
            รายการสินค้า ({data.line_items.length})
          </div>
          <button className="btn btn-secondary btn-sm" onClick={addItem}>
            + เพิ่มรายการ
          </button>
        </div>
        <div className="table-wrap mt-3">
          <table className="data">
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>รายการ</th>
                <th className="num">จำนวน</th>
                <th>หน่วย</th>
                <th className="num">ราคา/หน่วย</th>
                <th className="num">รวม</th>
                <th>หมวดหมู่</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.line_items.map((it, i) => (
                <tr key={i}>
                  <td>
                    <input
                      style={{ width: "100%", minWidth: 150 }}
                      className="cell-input"
                      value={it.description}
                      onChange={(e) => setItem(i, { description: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      style={{ width: 64, textAlign: "right" }}
                      inputMode="decimal"
                      value={it.quantity ?? ""}
                      onChange={(e) => setItem(i, { quantity: numOrNull(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      style={{ width: 64 }}
                      value={it.unit ?? ""}
                      onChange={(e) => setItem(i, { unit: e.target.value || null })}
                    />
                  </td>
                  <td>
                    <input
                      style={{ width: 88, textAlign: "right" }}
                      inputMode="decimal"
                      value={it.unit_price ?? ""}
                      onChange={(e) => setItem(i, { unit_price: numOrNull(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      style={{ width: 96, textAlign: "right" }}
                      inputMode="decimal"
                      value={it.amount ?? ""}
                      onChange={(e) => setItem(i, { amount: numOrNull(e.target.value) })}
                    />
                  </td>
                  <td>
                    <select
                      style={{ minWidth: 120 }}
                      value={it.category ?? ""}
                      onChange={(e) =>
                        setItem(i, {
                          category: (e.target.value || null) as CostCategory | null,
                        })
                      }
                    >
                      <option value="">— ไม่ระบุ —</option>
                      {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      className="btn btn-danger btn-sm"
                      title="ลบรายการ"
                      onClick={() => removeItem(i)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small mt-2">
          รวมรายการ: {baht(itemsSum)} บาท
          {validation.itemsSumOk === false && (
            <span style={{ color: "var(--warn)" }}> — ไม่ตรงกับยอดก่อน VAT ด้านล่าง</span>
          )}
        </p>
      </div>

      <div className="card">
        <div className="card-title">ยอดเงิน</div>
        <div className="form-grid">
          <div className="field">
            <label>ยอดก่อน VAT (บาท)</label>
            <input
              className="num"
              inputMode="decimal"
              value={data.subtotal ?? ""}
              onChange={(e) => set({ subtotal: numOrNull(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>ส่วนลด (บาท)</label>
            <input
              className="num"
              inputMode="decimal"
              value={data.discount ?? ""}
              onChange={(e) => set({ discount: numOrNull(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>VAT (บาท)</label>
            <input
              className="num"
              inputMode="decimal"
              value={data.vat_amount ?? ""}
              onChange={(e) => set({ vat_amount: numOrNull(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>ยอดสุทธิ (บาท)</label>
            <input
              className="num"
              inputMode="decimal"
              value={data.total ?? ""}
              onChange={(e) => set({ total: numOrNull(e.target.value) })}
            />
          </div>
          <div className="field full">
            <label>หมายเหตุ</label>
            <input
              value={data.notes ?? ""}
              onChange={(e) => set({ notes: e.target.value || null })}
            />
          </div>
        </div>
      </div>

      <div className="row">
        <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          {cancelLabel}
        </button>
        <button
          className="btn btn-primary btn-block"
          onClick={() => onSave(data)}
          disabled={saving || (data.total == null && itemsSum === 0)}
        >
          {saving
            ? "กำลังบันทึก…"
            : saveLabel ?? `บันทึกต้นทุน ${baht(data.total ?? itemsSum)} บาท`}
        </button>
      </div>
    </div>
  );
}
