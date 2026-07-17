"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { compressImage, type CompressedImage } from "@/lib/image";
import type { ExtractResponse, ExtractedReceipt } from "@/lib/types";
import { findDuplicate } from "@/lib/db";
import { addReceipt } from "@/lib/save";
import ReceiptForm from "@/components/ReceiptForm";

type Phase = "idle" | "preparing" | "extracting" | "review" | "saving";

export default function ScanPage() {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [queue, setQueue] = useState<CompressedImage[]>([]);
  const [index, setIndex] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [extracted, setExtracted] = useState<ExtractedReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const current = queue[index] ?? null;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    // snapshot ก่อน เพราะ input จะถูกเคลียร์ค่าหลังเรียก
    const fileList = Array.from(files);
    setError(null);
    setPhase("preparing");
    try {
      const imgs: CompressedImage[] = [];
      for (const f of fileList) {
        imgs.push(await compressImage(f));
      }
      setQueue(imgs);
      setIndex(0);
      setSavedCount(0);
      await extractAt(imgs, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "เตรียมรูปไม่สำเร็จ");
      setPhase("idle");
    }
  }

  async function extractAt(imgs: CompressedImage[], i: number) {
    const img = imgs[i];
    setDuplicateWarning(null);
    setExtracted(null);
    setPhase("extracting");
    try {
      const savedPasscode =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("costsnap:passcode")
          : null;
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(savedPasscode ? { "x-app-passcode": savedPasscode } : {}),
        },
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
      setPhase("review"); // ให้ผู้ใช้เลือกข้ามหรือลองใหม่ได้
    }
  }

  async function goNext(saved: boolean) {
    if (saved) setSavedCount((c) => c + 1);
    setError(null);
    const next = index + 1;
    if (next < queue.length) {
      setIndex(next);
      await extractAt(queue, next);
    } else {
      const total = savedCount + (saved ? 1 : 0);
      if (total > 0) {
        router.push("/receipts?saved=1");
      } else {
        reset();
      }
    }
  }

  async function handleSave(data: ExtractedReceipt) {
    if (!current) return;
    setPhase("saving");
    try {
      await addReceipt(data, { blob: current.blob, mediaType: current.mediaType });
      await goNext(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      setPhase("review");
    }
  }

  function reset() {
    setPhase("idle");
    setQueue([]);
    setIndex(0);
    setSavedCount(0);
    setExtracted(null);
    setError(null);
    setDuplicateWarning(null);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>สแกนใบกำกับภาษี</h1>
          <p className="page-sub">
            {queue.length > 1 && phase !== "idle"
              ? `ใบที่ ${index + 1} จาก ${queue.length}${savedCount ? ` · บันทึกแล้ว ${savedCount}` : ""}`
              : "ถ่ายรูปหรือเลือกรูป (เลือกหลายใบพร้อมกันได้) แล้วให้ AI อ่านค่า"}
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger mt-2">
          {error}
          {phase === "review" && !extracted && current && (
            <div className="row mt-2">
              <button className="btn btn-secondary btn-sm" onClick={() => extractAt(queue, index)}>
                ลองอ่านใหม่
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => goNext(false)}>
                ข้ามใบนี้
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "idle" && (
        <div className="stack mt-3">
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
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
            🖼️ เลือกรูปจากเครื่อง (หลายใบได้)
          </button>

          <div className="card">
            <div className="card-title">เคล็ดลับให้ AI อ่านแม่น</div>
            <ul className="muted small" style={{ marginLeft: 18 }}>
              <li>วางใบบนพื้นเรียบ แสงสว่างพอ ไม่มีเงาบัง</li>
              <li>ถ่ายให้เห็นทั้งใบ ตัวเลขยอดเงินคมชัด</li>
              <li>ใบยาว (สลิปห้าง) ให้ถ่ายแนวตั้งเต็มใบ</li>
              <li>สแกนหลายใบ: เลือกรูปทีเดียว แล้วตรวจทานทีละใบ</li>
              <li>AI อ่านเสร็จแล้ว จะมีหน้าตรวจทานก่อนบันทึกเสมอ</li>
            </ul>
          </div>
        </div>
      )}

      {(phase === "preparing" || phase === "extracting") && (
        <div className="card mt-3">
          <div className="row" style={{ justifyContent: "center", padding: 20, flexDirection: "column" }}>
            <div className="spinner" />
            <p className="muted mt-3">
              {phase === "preparing"
                ? "กำลังเตรียมรูป…"
                : `AI กำลังอ่านข้อมูล${queue.length > 1 ? `ใบที่ ${index + 1}/${queue.length}` : ""}… (ราว 10–30 วินาที)`}
            </p>
          </div>
          {current && <img src={current.dataUrl} alt="ใบกำกับภาษี" className="preview-img mt-3" />}
        </div>
      )}

      {(phase === "review" || phase === "saving") && extracted && current && (
        <div className="stack mt-3">
          <details className="card">
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.9rem" }}>
              🖼️ ดูรูปต้นฉบับเทียบ
            </summary>
            <img src={current.dataUrl} alt="ใบกำกับภาษี" className="preview-img mt-3" />
          </details>
          <ReceiptForm
            key={index}
            initial={extracted}
            saving={phase === "saving"}
            duplicateWarning={duplicateWarning}
            onSave={handleSave}
            onCancel={() => (queue.length > 1 ? goNext(false) : reset())}
            cancelLabel={queue.length > 1 ? "ข้ามใบนี้" : "ยกเลิก"}
          />
        </div>
      )}
    </div>
  );
}
