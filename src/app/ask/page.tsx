"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { buildShopSummary } from "@/lib/summary";
import { recordUsage } from "@/lib/usage";

const EXAMPLES = [
  "เดือนนี้ต้นทุนรวมเท่าไหร่ เทียบเดือนที่แล้วเป็นยังไง",
  "สินค้าตัวไหนราคาขึ้นมากที่สุด",
  "ซื้อจากเจ้าไหนมากที่สุด และควรต่อรองราคาตัวไหน",
  "มีบิลไหนใกล้ครบกำหนดจ่ายบ้าง",
  "สินค้าตัวไหนซื้อบ่อยที่สุด ต้นทุนเฉลี่ยเท่าไหร่",
];

export default function AskPage() {
  const receiptCount = useLiveQuery(() => db.receipts.count(), []);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    setAsked(text);
    try {
      const { json } = await buildShopSummary();
      const passcode = localStorage.getItem("costsnap:passcode");
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(passcode ? { "x-app-passcode": passcode } : {}),
        },
        body: JSON.stringify({ question: text, summary: json }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ถาม AI ไม่สำเร็จ");
      setAnswer(data.answer);
      await recordUsage("ask", data.usage);
    } catch (e) {
      setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
    } finally {
      setBusy(false);
    }
  }

  if (receiptCount === 0) {
    return (
      <div>
        <div className="page-header">
          <h1>ถาม AI</h1>
        </div>
        <div className="empty card">
          <div className="big">🤖</div>
          <p>ยังไม่มีข้อมูลให้วิเคราะห์ — สแกนใบกำกับภาษีก่อน</p>
          <Link href="/scan" className="btn btn-primary mt-3">
            📷 ไปสแกน
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>ถาม AI</h1>
          <p className="page-sub">
            ถามอะไรก็ได้เกี่ยวกับต้นทุน ผู้ขาย และราคาสินค้าของร้าน
          </p>
        </div>
      </div>

      <div className="card">
        <div className="field">
          <textarea
            rows={3}
            placeholder="เช่น เดือนนี้สินค้าตัวไหนแพงขึ้นบ้าง"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(question);
            }}
          />
        </div>
        <button
          className="btn btn-primary btn-block mt-3"
          disabled={busy || !question.trim()}
          onClick={() => ask(question)}
        >
          {busy ? "กำลังวิเคราะห์…" : "ถาม AI"}
        </button>
      </div>

      {!answer && !busy && (
        <div className="card mt-3">
          <div className="card-title">ลองถามแบบนี้</div>
          <div className="stack" style={{ display: "grid", gap: 8 }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                className="btn btn-secondary btn-sm"
                style={{ textAlign: "left", justifyContent: "flex-start" }}
                onClick={() => {
                  setQuestion(ex);
                  ask(ex);
                }}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="alert alert-danger mt-3">{error}</div>}

      {busy && (
        <div className="card mt-3">
          <div
            className="row"
            style={{ justifyContent: "center", padding: 20, flexDirection: "column" }}
          >
            <div className="spinner" />
            <p className="muted mt-3">AI กำลังอ่านข้อมูลร้านและวิเคราะห์…</p>
          </div>
        </div>
      )}

      {answer && (
        <div className="card mt-3">
          {asked && <div className="card-title">ถาม: {asked}</div>}
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{answer}</div>
          <hr className="divider" />
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setAnswer(null);
              setQuestion("");
            }}
          >
            ถามคำถามใหม่
          </button>
        </div>
      )}

      <p className="muted small mt-4">
        🔒 ระบบส่งเฉพาะ<strong>ตัวเลขสรุป</strong>ของร้าน (ยอดรายเดือน ผู้ขาย
        ราคาสินค้า) ไปให้ AI วิเคราะห์ — ไม่ส่งรูปภาพเอกสาร
        และคำตอบเป็นเพียงตัวช่วย ไม่ใช่คำแนะนำทางบัญชี/ภาษี
      </p>
    </div>
  );
}
