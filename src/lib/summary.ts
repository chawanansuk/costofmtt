import { db } from "./db";
import { CATEGORY_LABEL, DOC_TYPE_LABEL, monthKey } from "./format";

// สร้าง "สรุปข้อมูลร้าน" แบบกระชับสำหรับส่งให้ AI ตอบคำถาม
// ส่งเฉพาะตัวเลขที่สรุปแล้ว ไม่ส่งรูปภาพ และจำกัดขนาดไม่ให้เปลืองโทเคน
const MAX_MONTHS = 12;
const MAX_SELLERS = 30;
const MAX_PRODUCTS = 150;
const MAX_UNPAID = 25;

const r2 = (v: number) => Math.round(v * 100) / 100;

export async function buildShopSummary(): Promise<{
  json: string;
  counts: { receipts: number; products: number };
}> {
  const [receipts, items] = await Promise.all([
    db.receipts.toArray(),
    db.items.toArray(),
  ]);

  // ---- สรุปรายเดือน ----
  const months = new Map<
    string,
    { ต้นทุนรวม: number; จำนวนใบ: number; vatขอคืนได้: number }
  >();
  const sellers = new Map<
    string,
    { ยอดรวม: number; จำนวนใบ: number; ล่าสุด: string | null }
  >();
  const unpaid: {
    ผู้ขาย: string;
    ยอด: number;
    ครบกำหนด: string | null;
    ประเภท: string;
  }[] = [];

  for (const rc of receipts) {
    const mk = monthKey(rc.docDate, rc.createdAt);
    const m = months.get(mk) ?? { ต้นทุนรวม: 0, จำนวนใบ: 0, vatขอคืนได้: 0 };
    m.ต้นทุนรวม += rc.total;
    m.จำนวนใบ += 1;
    if (rc.vatClaimable) m.vatขอคืนได้ += rc.vatAmount;
    months.set(mk, m);

    const name = rc.sellerName ?? "(ไม่ระบุผู้ขาย)";
    const sv = sellers.get(name) ?? { ยอดรวม: 0, จำนวนใบ: 0, ล่าสุด: null };
    sv.ยอดรวม += rc.total;
    sv.จำนวนใบ += 1;
    if (!sv.ล่าสุด || (rc.docDate ?? "") > sv.ล่าสุด) sv.ล่าสุด = rc.docDate;
    sellers.set(name, sv);

    if (rc.paid === false) {
      unpaid.push({
        ผู้ขาย: name,
        ยอด: r2(rc.total),
        ครบกำหนด: rc.dueDate,
        ประเภท: DOC_TYPE_LABEL[rc.documentType] ?? rc.documentType,
      });
    }
  }

  // ---- สรุปต่อสินค้า (ชื่อ+หน่วย เหมือนหน้าสินค้า) ----
  const products = new Map<
    string,
    {
      ชื่อ: string;
      หน่วย: string | null;
      หมวด: string | null;
      ครั้งที่ซื้อ: number;
      จำนวนรวม: number;
      ยอดซื้อรวม: number;
      ราคาล่าสุด: number;
      ซื้อล่าสุด: string | null;
      ราคาต่ำสุด: number;
      ราคาสูงสุด: number;
      _ts: string;
    }
  >();
  for (const it of items) {
    if (!it.normalizedName) continue;
    const qty = it.quantity + (it.freeQuantity ?? 0); // ของแถมนับเป็นของที่ได้รับ
    const key = `${it.normalizedName}|${it.unit ?? ""}`;
    const d = it.docDate ?? "";
    const cur = products.get(key);
    if (!cur) {
      products.set(key, {
        ชื่อ: it.description,
        หน่วย: it.unit,
        หมวด: it.category ? CATEGORY_LABEL[it.category] ?? it.category : null,
        ครั้งที่ซื้อ: 1,
        จำนวนรวม: qty,
        ยอดซื้อรวม: it.amount,
        ราคาล่าสุด: it.unitPrice,
        ซื้อล่าสุด: it.docDate,
        ราคาต่ำสุด: it.unitPrice,
        ราคาสูงสุด: it.unitPrice,
        _ts: d,
      });
    } else {
      cur.ครั้งที่ซื้อ += 1;
      cur.จำนวนรวม += qty;
      cur.ยอดซื้อรวม += it.amount;
      cur.ราคาต่ำสุด = Math.min(cur.ราคาต่ำสุด, it.unitPrice);
      cur.ราคาสูงสุด = Math.max(cur.ราคาสูงสุด, it.unitPrice);
      if (d >= cur._ts && !it.isFreebie) {
        cur._ts = d;
        cur.ราคาล่าสุด = it.unitPrice;
        cur.ซื้อล่าสุด = it.docDate;
        cur.ชื่อ = it.description;
        cur.หมวด = it.category ? CATEGORY_LABEL[it.category] ?? it.category : cur.หมวด;
      }
    }
  }

  const productList = [...products.values()]
    .sort((a, b) => b.ยอดซื้อรวม - a.ยอดซื้อรวม)
    .slice(0, MAX_PRODUCTS)
    .map((p) => ({
      ชื่อ: p.ชื่อ,
      หน่วย: p.หน่วย,
      หมวด: p.หมวด,
      ครั้งที่ซื้อ: p.ครั้งที่ซื้อ,
      จำนวนรวม: r2(p.จำนวนรวม),
      ยอดซื้อรวม: r2(p.ยอดซื้อรวม),
      ต้นทุนเฉลี่ยต่อหน่วย: p.จำนวนรวม > 0 ? r2(p.ยอดซื้อรวม / p.จำนวนรวม) : null,
      ราคาล่าสุด: r2(p.ราคาล่าสุด),
      ราคาต่ำสุด: r2(p.ราคาต่ำสุด),
      ราคาสูงสุด: r2(p.ราคาสูงสุด),
      ซื้อล่าสุด: p.ซื้อล่าสุด,
    }));

  const payload = {
    หมายเหตุ:
      "ต้นทุนต่อหน่วยคือราคาที่จ่ายจริง หักส่วนลดท้ายบิลและรวมของแถมในการหารแล้ว หน่วยเป็นบาท",
    วันที่ปัจจุบัน: new Date().toISOString().slice(0, 10),
    สรุปรายเดือน: [...months.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, MAX_MONTHS)
      .map(([เดือน, v]) => ({
        เดือน,
        ต้นทุนรวม: r2(v.ต้นทุนรวม),
        จำนวนใบ: v.จำนวนใบ,
        vatขอคืนได้: r2(v.vatขอคืนได้),
      })),
    ผู้ขาย: [...sellers.entries()]
      .sort((a, b) => b[1].ยอดรวม - a[1].ยอดรวม)
      .slice(0, MAX_SELLERS)
      .map(([ชื่อ, v]) => ({ ชื่อ, ยอดรวม: r2(v.ยอดรวม), จำนวนใบ: v.จำนวนใบ, ล่าสุด: v.ล่าสุด })),
    สินค้า: productList,
    บิลค้างจ่าย: unpaid
      .sort((a, b) => (a.ครบกำหนด ?? "9999").localeCompare(b.ครบกำหนด ?? "9999"))
      .slice(0, MAX_UNPAID),
  };

  return {
    json: JSON.stringify(payload),
    counts: { receipts: receipts.length, products: products.size },
  };
}
