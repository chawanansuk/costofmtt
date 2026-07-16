"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { compressImage, type CompressedImage } from "@/lib/image";
import type { ExtractResponse, ExtractedReceipt } from "@/lib/types";
import { db, findDuplicate } from "@/lib/db";
import { validateExtraction, normalizeItemName } from "@/lib/validate";
import ReceiptForm from "@/components/ReceiptForm";

type Phase = "idle" | "processing" | "review" | "saving";

export default function ScanPage() {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [image, setImage] = useState<CompressedImage | null>(null);
  const [extracted, setExtracted] = useState<ExtractedReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setDuplicateWarning(null);
    setPhase("processing");
    try {
      const img = await compressImage(file);
      setImage(img);

      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: img.base64, mediaType: img.mediaType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "อ่านข้อมูลไม่สำเร็จ");

      const { data } = json as ExtractResponse;
      setExtracted(data);

      const dup = await findDuplicate(data.seller.tax_id, data.doc_number);
      if (dup) {
        setDuplicateWarning(
          `อาจเป็นใบซ้ำ: เลขที่ ${dup.docNumber} ของ ${dup.sellerName ?? "ผู้ขายรายนี้"} ถูกบันทึกไว้แล้ว`
        );
      }
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
      setPhase("idle");
    }
  }

  async function handleSave(data: ExtractedReceipt) {
    if (!image) return;
    setPhase("saving");
    try {
      const validation = validateExtraction(data);
      const itemsSum = data.line_items.reduce((s, it) => s + (it.amount ?? 0), 0);
      const total = data.total ?? itemsSum;

      await db.transaction("rw", db.receipts, db.items, async () => {
        const receiptId = await db.receipts.add({
          createdAt: Date.now(),
          docDate: data.doc_date,
          docNumber: data.doc_number,
          documentType: data.document_type,
          sellerName: data.seller.name,
          sellerTaxId: data.seller.tax_id,
          sellerBranch: data.seller.branch,
          buyerName: data.buyer.name,
          subtotal: data.subtotal ?? total,
          discount: data.discount ?? 0,
          vatAmount: data.vat_amount ?? 0,
          total,
          vatClaimable: validation.vatClaimable,
          confidence: data.confidence,
          warnings: data.warnings,
          notes: data.notes,
          imageBlob: image.blob,
          imageType: image.mediaType,
        });

        await db.items.bulkAdd(
          data.line_items
            .filter((it) => it.description.trim() !== "")
            .map((it) => ({
              receiptId: receiptId as number,
              docDate: data.doc_date,
              sellerName: data.seller.name,
              description: it.description,
              normalizedName: normalizeItemName(it.description),
              quantity: it.quantity ?? 1,
              unit: it.unit,
              unitPrice:
                it.unit_price ?? (it.amount != null && it.quantity ? it.amount / it.quantity : it.amount ?? 0),
              amount: it.amount ?? 0,
            }))
        );
      });

      router.push("/receipts?saved=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      setPhase("review");
    }
  }

  function reset() {
    setPhase("idle");
    setImage(null);
    setExtracted(null);
    setError(null);
    setDuplicateWarning(null);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>สแกนใบกำกับภาษี</h1>
          <p className="page-sub">ถ่ายรูปหรือเลือกรูป แล้วให้ AI อ่านค่าให้อัตโนมัติ</p>
        </div>
      </div>

      {error && <div className="alert alert-danger mt-2">{error}</div>}

      {phase === "idle" && (
        <div className="stack mt-3">
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <button
            className="btn btn-primary btn-lg btn-block"
            onClick={() => cameraRef.current?.click()}
          >
            📷 ถ่ายรูปใบกำกับภาษี
          </button>
          <button
            className="btn btn-secondary btn-lg btn-block"
            onClick={() => galleryRef.current?.click()}
          >
            🖼️ เลือกรูปจากเครื่อง
          </button>

          <div className="card">
            <div className="card-title">เคล็ดลับให้ AI อ่านแม่น</div>
            <ul className="muted small" style={{ marginLeft: 18 }}>
              <li>วางใบบนพื้นเรียบ แสงสว่างพอ ไม่มีเงาบัง</li>
              <li>ถ่ายให้เห็นทั้งใบ ตัวเลขยอดเงินคมชัด</li>
              <li>ใบยาว (สลิปห้าง) ให้ถ่ายแนวตั้งเต็มใบ</li>
              <li>AI อ่านเสร็จแล้ว จะมีหน้าตรวจทานก่อนบันทึกเสมอ</li>
            </ul>
          </div>
        </div>
      )}

      {phase === "processing" && (
        <div className="card mt-3">
          <div className="row" style={{ justifyContent: "center", padding: 20, flexDirection: "column" }}>
            <div className="spinner" />
            <p className="muted mt-3">AI กำลังอ่านข้อมูลจากรูป… (ราว 10–30 วินาที)</p>
          </div>
          {image && <img src={image.dataUrl} alt="ใบกำกับภาษี" className="preview-img mt-3" />}
        </div>
      )}

      {(phase === "review" || phase === "saving") && extracted && image && (
        <div className="stack mt-3">
          <details className="card">
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.9rem" }}>
              🖼️ ดูรูปต้นฉบับเทียบ
            </summary>
            <img src={image.dataUrl} alt="ใบกำกับภาษี" className="preview-img mt-3" />
          </details>
          <ReceiptForm
            initial={extracted}
            saving={phase === "saving"}
            duplicateWarning={duplicateWarning}
            onSave={handleSave}
            onCancel={reset}
          />
        </div>
      )}
    </div>
  );
}
