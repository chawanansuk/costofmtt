"use client";

import { useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { baht, thaiDate, monthKey, DOC_TYPE_LABEL } from "@/lib/format";

function ReceiptsList() {
  const params = useSearchParams();
  const justSaved = params.get("saved") === "1";

  const [search, setSearch] = useState("");
  const [month, setMonth] = useState<string>("");
  const [docType, setDocType] = useState<string>("");
  const [vatOnly, setVatOnly] = useState(false);

  const receipts = useLiveQuery(
    () => db.receipts.orderBy("createdAt").reverse().toArray(),
    []
  );

  const months = useMemo(() => {
    if (!receipts) return [];
    const set = new Set(receipts.map((r) => monthKey(r.docDate, r.createdAt)));
    return [...set].sort().reverse();
  }, [receipts]);

  const filtered = useMemo(() => {
    if (!receipts) return [];
    return receipts.filter((r) => {
      if (month && monthKey(r.docDate, r.createdAt) !== month) return false;
      if (docType && r.documentType !== docType) return false;
      if (vatOnly && !r.vatClaimable) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.sellerName ?? ""} ${r.docNumber ?? ""} ${r.notes ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [receipts, search, month, docType, vatOnly]);

  const sum = filtered.reduce((s, r) => s + r.total, 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>เอกสารทั้งหมด</h1>
          <p className="page-sub">
            {filtered.length} ใบ · รวม {baht(sum)} บาท
          </p>
        </div>
        <Link href="/scan" className="btn btn-primary btn-sm">
          + สแกน
        </Link>
      </div>

      {justSaved && <div className="alert alert-ok mt-2">✓ บันทึกเรียบร้อยแล้ว</div>}

      <div className="row mt-3">
        <div className="field" style={{ flex: 1 }}>
          <input
            placeholder="ค้นหาผู้ขาย / เลขที่เอกสาร"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field" style={{ width: 130 }}>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">ทุกเดือน</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row mt-2">
        <div className="field" style={{ flex: 1 }}>
          <select value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">ทุกประเภทเอกสาร</option>
            {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <button
          className={`btn btn-sm ${vatOnly ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setVatOnly((v) => !v)}
        >
          {vatOnly ? "✓ " : ""}เฉพาะขอคืน VAT ได้
        </button>
      </div>

      <div className="mt-4">
        {receipts && filtered.length === 0 && (
          <div className="empty">
            <div className="big">🧾</div>
            <p>ยังไม่มีเอกสาร{search || month ? "ที่ตรงเงื่อนไข" : ""}</p>
            {!search && !month && (
              <Link href="/scan" className="btn btn-primary mt-3">
                📷 สแกนใบแรกเลย
              </Link>
            )}
          </div>
        )}
        {filtered.map((r) => (
          <Link key={r.id} href={`/receipts/${r.id}`} className="list-item">
            <div style={{ minWidth: 0 }}>
              <div className="title">{r.sellerName ?? "(ไม่ระบุผู้ขาย)"}</div>
              <div className="meta">
                {thaiDate(r.docDate)} · {DOC_TYPE_LABEL[r.documentType]}
                {r.docNumber ? ` · เลขที่ ${r.docNumber}` : ""}
              </div>
              <div className="row wrap mt-2" style={{ gap: 6 }}>
                {r.vatClaimable && <span className="badge badge-ok">ขอคืน VAT ได้</span>}
                {r.confidence === "low" && (
                  <span className="badge badge-warn">ควรตรวจทาน</span>
                )}
              </div>
            </div>
            <div className="amount">{baht(r.total)} ฿</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function ReceiptsPage() {
  return (
    <Suspense>
      <ReceiptsList />
    </Suspense>
  );
}
