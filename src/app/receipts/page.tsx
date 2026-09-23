"use client";

import { useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { baht, thaiDate, monthKey, DOC_TYPE_LABEL, isCostDocument } from "@/lib/format";

function ReceiptsList() {
  const params = useSearchParams();
  const justSaved = params.get("saved") === "1";

  const [search, setSearch] = useState("");
  const [month, setMonth] = useState<string>("");
  const [docType, setDocType] = useState<string>("");
  const [vatOnly, setVatOnly] = useState(false);
  const [unpaidOnly, setUnpaidOnly] = useState(false);

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
      if (unpaidOnly && r.paid !== false) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.sellerName ?? ""} ${r.docNumber ?? ""} ${r.notes ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [receipts, search, month, docType, vatOnly, unpaidOnly]);

  const sum = filtered.reduce((s, r) => s + r.total, 0);

  const badgesFor = (r: (typeof filtered)[number]) => (
    <>
      {r.paid === false && (
        <span className="badge badge-danger">
          ค้างจ่าย{r.dueDate ? ` · ${thaiDate(r.dueDate)}` : ""}
        </span>
      )}
      {r.vatClaimable && <span className="badge badge-ok">ขอคืน VAT ได้</span>}
      {!isCostDocument(r.documentType) && (
        <span className="badge badge-neutral">ไม่นับเป็นต้นทุน</span>
      )}
      {r.confidence === "low" && <span className="badge badge-warn">ควรตรวจทาน</span>}
    </>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>เอกสารทั้งหมด</h1>
          <p className="page-sub">
            {filtered.length} ใบ · รวม {baht(sum)} บาท
          </p>
        </div>
        <Link href="/scan" className="btn btn-primary">
          📷 สแกนใบกำกับภาษี
        </Link>
      </div>

      {justSaved && <div className="alert alert-ok mt-3">✓ บันทึกเรียบร้อยแล้ว</div>}

      {/* ---------- ตัวกรอง ---------- */}
      <div className="row mt-3">
        <div className="field" style={{ flex: 1 }}>
          <input
            placeholder="ค้นหาผู้ขาย / เลขที่เอกสาร"
            aria-label="ค้นหาผู้ขายหรือเลขที่เอกสาร"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field" style={{ width: 150 }}>
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="กรองตามเดือน">
            <option value="">ทุกเดือน</option>
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="field only-desktop" style={{ width: 200 }}>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} aria-label="กรองตามประเภทเอกสาร">
            <option value="">ทุกประเภทเอกสาร</option>
            {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="chip-row mt-3">
        <button
          className={`chip ${vatOnly ? "active" : ""}`}
          aria-pressed={vatOnly}
          onClick={() => setVatOnly((v) => !v)}
        >
          ขอคืน VAT ได้
        </button>
        <button
          className={`chip ${unpaidOnly ? "active" : ""}`}
          aria-pressed={unpaidOnly}
          onClick={() => setUnpaidOnly((v) => !v)}
        >
          ค้างจ่าย
        </button>
        <div className="field only-mobile" style={{ flex: 1, minWidth: 150 }}>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} aria-label="กรองตามประเภทเอกสาร">
            <option value="">ทุกประเภทเอกสาร</option>
            {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {receipts && filtered.length === 0 && (
        <div className="empty card mt-4">
          <div className="big">🧾</div>
          <p>ยังไม่มีเอกสาร{search || month || docType || vatOnly || unpaidOnly ? "ที่ตรงเงื่อนไข" : ""}</p>
          {!search && !month && (
            <Link href="/scan" className="btn btn-primary mt-4">
              📷 สแกนใบแรกเลย
            </Link>
          )}
        </div>
      )}

      {/* ---------- เดสก์ท็อป: ตาราง เทียบข้ามใบได้ ---------- */}
      {filtered.length > 0 && (
        <div className="card only-desktop mt-4" style={{ padding: "var(--space-2)" }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>ผู้ขาย</th>
                  <th>วันที่</th>
                  <th>ประเภท</th>
                  <th>สถานะ</th>
                  <th className="num">ยอดสุทธิ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/receipts/${r.id}`} style={{ fontWeight: 600 }}>
                        {r.sellerName ?? "(ไม่ระบุผู้ขาย)"}
                      </Link>
                      {r.docNumber && <div className="caption">เลขที่ {r.docNumber}</div>}
                    </td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{thaiDate(r.docDate)}</td>
                    <td className="muted">{DOC_TYPE_LABEL[r.documentType]}</td>
                    <td>
                      <div className="row wrap" style={{ gap: "var(--space-2)" }}>{badgesFor(r)}</div>
                    </td>
                    <td className="num" style={{ fontWeight: 600, fontSize: "var(--fs-h4)" }}>
                      {baht(r.total)} ฿
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- มือถือ: การ์ด แตะง่าย อ่านครบ ---------- */}
      <div className="only-mobile mt-4">
        {filtered.map((r) => (
          <Link key={r.id} href={`/receipts/${r.id}`} className="item-card" style={{ display: "block", color: "inherit" }}>
            <div className="row top spread">
              <div style={{ minWidth: 0 }}>
                <div className="name">{r.sellerName ?? "(ไม่ระบุผู้ขาย)"}</div>
                <div className="caption mt-2">
                  {thaiDate(r.docDate)} · {DOC_TYPE_LABEL[r.documentType]}
                  {r.docNumber ? ` · ${r.docNumber}` : ""}
                </div>
              </div>
              <div
                className="num"
                style={{ fontWeight: 600, fontSize: "var(--fs-h3)", whiteSpace: "nowrap" }}
              >
                {baht(r.total)} ฿
              </div>
            </div>
            <div className="row wrap mt-3" style={{ gap: "var(--space-2)" }}>{badgesFor(r)}</div>
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
