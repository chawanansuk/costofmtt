"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db, deleteReceipt } from "@/lib/db";
import { updateReceipt } from "@/lib/save";
import { billSummary, round2 } from "@/lib/cost";
import {
  useCostBasis,
  itemUnitCost,
  itemAmount,
  COST_BASIS_LABEL,
} from "@/lib/costbasis";
import type { ExtractedReceipt } from "@/lib/types";
import { baht, thaiDate, DOC_TYPE_LABEL, CATEGORY_LABEL } from "@/lib/format";
import ReceiptForm from "@/components/ReceiptForm";
import ZoomableImage from "@/components/ZoomableImage";

export default function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const receiptId = Number(id);
  const router = useRouter();

  // ค่าเริ่มต้น null = กำลังโหลด, undefined = ไม่พบเอกสาร
  // id ใน URL ไม่ใช่ตัวเลข (ลิงก์เสีย) → ถือว่าไม่พบ ไม่ส่งเข้า IndexedDB ซึ่งจะ throw
  const validId = Number.isInteger(receiptId) && receiptId > 0;
  const receipt = useLiveQuery(
    () => (validId ? db.receipts.get(receiptId) : undefined),
    [receiptId],
    null
  );
  const items = useLiveQuery(
    () => (validId ? db.items.where("receiptId").equals(receiptId).toArray() : []),
    [receiptId]
  );

  // ยอดสรุปที่ไล่ย้อนจากยอดสุทธิ+VAT เสมอ จึงกระทบยอดกันได้ทุกใบ
  const money = billSummary({
    subtotal: receipt?.subtotal ?? null,
    discount: receipt?.discount ?? null,
    vatAmount: receipt?.vatAmount ?? null,
    total: receipt?.total ?? null,
    itemsSum: 0,
  });

  const basis = useCostBasis();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  useEffect(() => {
    if (receipt?.imageBlob) {
      const url = URL.createObjectURL(receipt.imageBlob);
      setImageUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [receipt?.imageBlob]);

  async function handleDelete() {
    if (!confirm("ลบเอกสารนี้และรายการสินค้าทั้งหมดในใบนี้?")) return;
    await deleteReceipt(receiptId);
    router.push("/receipts");
  }

  async function handleUpdate(data: ExtractedReceipt) {
    setSaving(true);
    setSaveErr(null);
    try {
      await updateReceipt(receiptId, data);
      setEditing(false);
      setSaveMsg("บันทึกการแก้ไขแล้ว");
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSaving(false);
    }
  }

  // จ่ายบิลแล้ว กดทีเดียวจบ ไม่ต้องเข้าโหมดแก้ไขทั้งใบ
  async function setPaid(paid: boolean) {
    setSaveErr(null);
    try {
      await db.receipts.update(receiptId, { paid });
      setSaveMsg(paid ? "ทำเครื่องหมายว่าจ่ายแล้ว" : "เปลี่ยนกลับเป็นค้างจ่ายแล้ว");
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ กรุณาลองใหม่");
    }
  }

  if (receipt === null) return null;
  if (!receipt) {
    return (
      <div className="empty">
        <div className="big">🔍</div>
        <p>ไม่พบเอกสารนี้</p>
      </div>
    );
  }

  // โหมดแก้ไข: ประกอบข้อมูลจากเรคคอร์ดกลับเป็นโครง ExtractedReceipt ให้ฟอร์มเดิมใช้ได้
  if (editing && items) {
    const initial: ExtractedReceipt = {
      document_type: receipt.documentType,
      seller: {
        name: receipt.sellerName,
        tax_id: receipt.sellerTaxId,
        branch: receipt.sellerBranch,
        address: receipt.sellerAddress ?? null,
      },
      buyer: {
        name: receipt.buyerName,
        tax_id: receipt.buyerTaxId ?? null,
        branch: null,
        address: null,
      },
      doc_number: receipt.docNumber,
      doc_date: receipt.docDate,
      // แตกของแถมกลับเป็นบรรทัดของตัวเอง เพื่อให้บันทึกซ้ำได้ต้นทุนเท่าเดิม
      line_items: items.flatMap((it) => [
        {
          description: it.description,
          quantity: it.quantity,
          unit: it.unit,
          unit_price: it.quantity > 0 ? round2(it.amount / it.quantity) : it.unitPrice,
          amount: it.amount,
          category: it.category ?? null,
        },
        ...(it.freeQuantity
          ? [
              {
                description: `${it.description} (แถม)`,
                quantity: it.freeQuantity,
                unit: it.unit,
                unit_price: 0,
                amount: 0,
                category: it.category ?? null,
              },
            ]
          : []),
      ]),
      subtotal: receipt.subtotal,
      discount: receipt.discount || null,
      vat_rate: receipt.vatAmount > 0 ? 7 : null,
      vat_amount: receipt.vatAmount || null,
      total: receipt.total,
      payment_method: receipt.paymentMethod ?? null,
      paid: receipt.paid ?? null,
      due_date: receipt.dueDate ?? null,
      notes: receipt.notes,
      confidence: receipt.confidence,
      warnings: receipt.warnings ?? [],
    };
    return (
      <div>
        <div className="page-header">
          <h1>แก้ไขเอกสาร</h1>
        </div>
        {saveErr && <div className="alert alert-danger mt-2">{saveErr}</div>}
        <ReceiptForm
          initial={initial}
          saving={saving}
          onSave={handleUpdate}
          onCancel={() => setEditing(false)}
          saveLabel="บันทึกการแก้ไข"
          excludeReceiptId={receiptId}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{receipt.sellerName ?? "(ไม่ระบุผู้ขาย)"}</h1>
          <p className="page-sub">
            {thaiDate(receipt.docDate)} · {DOC_TYPE_LABEL[receipt.documentType]}
          </p>
        </div>
        <div className="row" style={{ gap: "var(--space-2)" }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
            แก้ไข
          </button>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>
            ลบ
          </button>
        </div>
      </div>

      {saveMsg && <div className="alert alert-ok mt-3">✓ {saveMsg}</div>}
      {saveErr && <div className="alert alert-danger mt-3">{saveErr}</div>}

      <div className="row wrap mt-3" style={{ gap: "var(--space-2)" }}>
        {receipt.paid === false && (
          <span className="badge badge-danger">
            ค้างจ่าย{receipt.dueDate ? ` · ครบกำหนด ${thaiDate(receipt.dueDate)}` : ""}
          </span>
        )}
        {receipt.paid === true && <span className="badge badge-ok">จ่ายแล้ว ✓</span>}
        {receipt.vatClaimable ? (
          <span className="badge badge-ok">ใช้ขอคืน VAT ซื้อได้</span>
        ) : (
          <span className="badge badge-neutral">ไม่เข้าเงื่อนไขขอคืน VAT</span>
        )}
        <span
          className={`badge ${
            receipt.confidence === "high"
              ? "badge-ok"
              : receipt.confidence === "medium"
              ? "badge-warn"
              : "badge-danger"
          }`}
        >
          ความมั่นใจ AI: {receipt.confidence === "high" ? "สูง" : receipt.confidence === "medium" ? "กลาง" : "ต่ำ"}
        </span>
      </div>

      <div className="card mt-4">
        <div className="row spread">
          <span className="card-title" style={{ marginBottom: 0 }}>ยอดสุทธิที่จ่ายจริง</span>
          <span
            className="num"
            style={{ fontSize: "var(--fs-h1)", lineHeight: "var(--lh-h1)", fontWeight: 700 }}
          >
            {baht(money.total)} ฿
          </span>
        </div>
      </div>

      {receipt.paid === false && (
        <button className="btn btn-primary btn-block mt-3" onClick={() => setPaid(true)}>
          ✓ จ่ายบิลนี้แล้ว
        </button>
      )}
      {receipt.paid === true && (
        <button className="btn btn-secondary btn-sm mt-3" onClick={() => setPaid(false)}>
          เปลี่ยนกลับเป็นค้างจ่าย
        </button>
      )}

      <div className="grid-2 mt-4">
        <div>

      {items && items.length > 0 && (
            <div className="card">
              <div className="card-head">
                <span className="card-title">รายการสินค้า · {items.length} รายการ</span>
                <span className="card-action">ต้นทุน{COST_BASIS_LABEL[basis]}</span>
              </div>

              {/* เดสก์ท็อป: ตาราง */}
              <div className="table-wrap only-desktop">
                <table className="data">
                  <thead>
                    <tr>
                      <th>รายการ</th>
                      <th className="num">จำนวน</th>
                      <th className="num">ต้นทุน/หน่วย</th>
                      <th className="num">รวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id}>
                        <td>
                          {it.description}
                          {it.category && (
                            <div className="mt-2">
                              <span className="badge badge-neutral">{CATEGORY_LABEL[it.category]}</span>
                            </div>
                          )}
                        </td>
                        <td className="num">
                          {it.quantity} {it.unit ?? ""}
                          {it.freeQuantity ? (
                            <div className="caption" style={{ color: "var(--state-success)" }}>
                              + แถม {it.freeQuantity} {it.unit ?? ""}
                            </div>
                          ) : null}
                          {it.isFreebie && (
                            <div className="caption" style={{ color: "var(--state-success)" }}>ของแถม</div>
                          )}
                        </td>
                        <td className="num" style={{ fontWeight: 600 }}>
                          {baht(itemUnitCost(it, basis))}
                          {basis === "inc" && it.unitPriceIncVat != null && (
                            <div className="caption">ก่อน VAT {baht(it.unitPrice)}</div>
                          )}
                        </td>
                        <td className="num" style={{ fontWeight: 600 }}>{baht(itemAmount(it, basis))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* มือถือ: การ์ดต่อรายการ — เห็นตัวเลขครบโดยไม่ต้องเลื่อนแนวนอน */}
              <div className="only-mobile">
                {items.map((it) => (
                  <div key={it.id} className="item-card" style={{ boxShadow: "none" }}>
                    <div className="name">{it.description}</div>
                    <div className="figs">
                      <div className="fig">
                        <span className="k">จำนวน</span>
                        <span className="v">{it.quantity} {it.unit ?? ""}</span>
                        {it.freeQuantity ? (
                          <span className="sub" style={{ color: "var(--state-success)" }}>
                            + แถม {it.freeQuantity}
                          </span>
                        ) : null}
                        {it.isFreebie && (
                          <span className="sub" style={{ color: "var(--state-success)" }}>ของแถม</span>
                        )}
                      </div>
                      <div className="fig">
                        <span className="k">ต้นทุน/หน่วย</span>
                        <span className="v cost">{baht(itemUnitCost(it, basis))}</span>
                        {basis === "inc" && it.unitPriceIncVat != null && (
                          <span className="sub">ก่อน VAT {baht(it.unitPrice)}</span>
                        )}
                      </div>
                      <div className="fig">
                        <span className="k">รวม</span>
                        <span className="v">{baht(itemAmount(it, basis))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-title">ยอดเงิน</div>
            <div className="kv">
              {money.discount > 0 && (
                <>
                  <div className="kv-row">
                    <span className="k">ราคาสินค้า (ก่อนลด)</span>
                    <span className="v">{baht(money.gross)} ฿</span>
                  </div>
                  <div className="kv-row">
                    <span className="k">ส่วนลดท้ายบิล</span>
                    <span className="v neg">−{baht(money.discount)} ฿</span>
                  </div>
                </>
              )}
              <div className="kv-row">
                <span className="k">ยอดก่อน VAT</span>
                <span className="v">{baht(money.netBeforeVat)} ฿</span>
              </div>
              <div className="kv-row">
                <span className="k">VAT</span>
                <span className="v">{baht(money.vat)} ฿</span>
              </div>
              <div className="kv-row total">
                <span className="k">ยอดสุทธิ</span>
                <span className="v">{baht(money.total)} ฿</span>
              </div>
            </div>
          </div>
        </div>

        {/* ---------- คอลัมน์ข้าง ---------- */}
        <div>
          <div className="card">
            <div className="card-title">ข้อมูลเอกสาร</div>
            <div className="kv">
              <div className="kv-row"><span className="k">เลขที่เอกสาร</span><span className="v">{receipt.docNumber ?? "—"}</span></div>
              <div className="kv-row"><span className="k">วันที่</span><span className="v">{thaiDate(receipt.docDate)}</span></div>
              <div className="kv-row"><span className="k">เลขผู้เสียภาษีผู้ขาย</span><span className="v">{receipt.sellerTaxId ?? "—"}</span></div>
              <div className="kv-row"><span className="k">สาขา</span><span className="v">{receipt.sellerBranch ?? "—"}</span></div>
              <div className="kv-row"><span className="k">ผู้ซื้อ</span><span className="v">{receipt.buyerName ?? "—"}</span></div>
              {receipt.paymentMethod && (
                <div className="kv-row"><span className="k">วิธีชำระเงิน</span><span className="v">{receipt.paymentMethod}</span></div>
              )}
              {receipt.notes && (
                <div className="kv-row"><span className="k">หมายเหตุ</span><span className="v">{receipt.notes}</span></div>
              )}
            </div>
          </div>

          {(receipt.warnings?.length ?? 0) > 0 && (
            <div className="alert alert-warn">
              <strong>ข้อสังเกตตอนสแกน:</strong>
              <ul>
                {receipt.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {imageUrl && (
            <div className="card">
              <div className="card-title">รูปต้นฉบับ</div>
              <ZoomableImage src={imageUrl} alt="ใบกำกับภาษีต้นฉบับ" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
