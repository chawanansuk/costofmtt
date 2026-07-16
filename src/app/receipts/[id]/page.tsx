"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db, deleteReceipt } from "@/lib/db";
import { baht, thaiDate, DOC_TYPE_LABEL } from "@/lib/format";

export default function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const receiptId = Number(id);
  const router = useRouter();

  // ค่าเริ่มต้น null = กำลังโหลด, undefined = ไม่พบเอกสาร
  const receipt = useLiveQuery(() => db.receipts.get(receiptId), [receiptId], null);
  const items = useLiveQuery(
    () => db.items.where("receiptId").equals(receiptId).toArray(),
    [receiptId]
  );

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

  if (receipt === null) return null;
  if (!receipt) {
    return (
      <div className="empty">
        <div className="big">🔍</div>
        <p>ไม่พบเอกสารนี้</p>
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
        <button className="btn btn-danger btn-sm" onClick={handleDelete}>
          ลบ
        </button>
      </div>

      <div className="row wrap mt-2" style={{ gap: 6 }}>
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

      <div className="card mt-3">
        <div className="card-title">ข้อมูลเอกสาร</div>
        <table className="data">
          <tbody>
            <tr><td className="muted">เลขที่เอกสาร</td><td className="num">{receipt.docNumber ?? "—"}</td></tr>
            <tr><td className="muted">เลขผู้เสียภาษีผู้ขาย</td><td className="num">{receipt.sellerTaxId ?? "—"}</td></tr>
            <tr><td className="muted">สาขา</td><td className="num">{receipt.sellerBranch ?? "—"}</td></tr>
            <tr><td className="muted">ผู้ซื้อ</td><td className="num">{receipt.buyerName ?? "—"}</td></tr>
            {receipt.notes && (
              <tr><td className="muted">หมายเหตุ</td><td className="num">{receipt.notes}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {items && items.length > 0 && (
        <div className="card mt-3">
          <div className="card-title">รายการสินค้า</div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>รายการ</th>
                  <th className="num">จำนวน</th>
                  <th className="num">ราคา/หน่วย</th>
                  <th className="num">รวม</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.description}</td>
                    <td className="num">
                      {it.quantity} {it.unit ?? ""}
                    </td>
                    <td className="num">{baht(it.unitPrice)}</td>
                    <td className="num">{baht(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card mt-3">
        <div className="card-title">ยอดเงิน</div>
        <table className="data">
          <tbody>
            <tr><td className="muted">ยอดก่อน VAT</td><td className="num">{baht(receipt.subtotal)} ฿</td></tr>
            {receipt.discount > 0 && (
              <tr><td className="muted">ส่วนลด</td><td className="num">-{baht(receipt.discount)} ฿</td></tr>
            )}
            <tr><td className="muted">VAT</td><td className="num">{baht(receipt.vatAmount)} ฿</td></tr>
            <tr>
              <td style={{ fontWeight: 700 }}>ยอดสุทธิ</td>
              <td className="num" style={{ fontWeight: 700, fontSize: "1.05rem" }}>
                {baht(receipt.total)} ฿
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {receipt.warnings.length > 0 && (
        <div className="alert alert-warn mt-3">
          <strong>ข้อสังเกตตอนสแกน:</strong>
          <ul>
            {receipt.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {imageUrl && (
        <div className="card mt-3">
          <div className="card-title">รูปต้นฉบับ</div>
          <img src={imageUrl} alt="ใบกำกับภาษีต้นฉบับ" className="preview-img" />
        </div>
      )}
    </div>
  );
}
