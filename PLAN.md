# 📋 แผนพัฒนาแอป "CostSnap" — ถ่ายรูปใบกำกับภาษี ให้ AI อ่านค่า และบันทึกต้นทุนสินค้า

> เอกสารฉบับนี้คือแผนละเอียดก่อนลงมือพัฒนา ครอบคลุมการวิจัยแนวทางปัจจุบัน สถาปัตยกรรม
> โมเดลข้อมูล กติกาการตรวจสอบตามกฎหมายภาษีไทย ไปจนถึงไอเดียต่อยอดในอนาคต

---

## 1. เป้าหมายของแอป

| เป้าหมาย | รายละเอียด |
|---|---|
| หลัก | ถ่ายรูป/อัปโหลดใบกำกับภาษี → AI อ่านค่าอัตโนมัติ → ผู้ใช้ตรวจทาน → บันทึกเป็นต้นทุนสินค้า |
| รอง | สรุปต้นทุนรายเดือน/รายผู้ขาย/รายหมวด, ติดตามราคาต้นทุนต่อสินค้า, สรุป VAT ซื้อที่ขอคืนได้ |
| ผู้ใช้เป้าหมาย | ร้านค้า/SME ที่ซื้อวัตถุดิบหรือสินค้าเข้าร้านและได้รับใบกำกับภาษี/ใบเสร็จ |
| อุปกรณ์ | มือถือเป็นหลัก (ถ่ายรูปหน้างาน) + เดสก์ท็อป (ดูรายงาน) |

## 2. ผลการวิจัยแนวทางที่ใช้ในปัจจุบัน (Research)

### 2.1 เทคโนโลยีอ่านเอกสารภาษาไทยที่มีในตลาด

| แนวทาง | ตัวอย่าง | จุดแข็ง | จุดอ่อน |
|---|---|---|---|
| OCR เฉพาะทางไทย (API สำเร็จรูป) | [iApp Thai Receipt OCR](https://iapp.co.th/docs/thai-document-optical-character-recognition/receipt), [TurboLens](https://www.turbolens.io/capabilities/thai-invoice-ocr-processing) | เทรนกับใบเสร็จไทยโดยตรง รองรับลายมือ | ผูกกับ vendor, schema ตายตัว, ปรับแต่งยาก |
| Open-source Vision LM ไทย | [Typhoon OCR](https://opentyphoon.ai/model/typhoon-ocr) ([paper](https://arxiv.org/html/2601.14722v1)) | โอเพนซอร์ส, เข้าใจเอกสารไทยดี (dataset มี bill/invoice ~8.7%) | ต้อง host เอง, คุณภาพ reasoning ต่ำกว่า frontier model |
| **Vision LLM + Structured Output** (แนวทางที่เลือก) | Claude Vision + JSON Schema | ความแม่นยำสูงบนภาพจริงที่เบี้ยว/มัว/มีเงา เพราะโมเดล "เข้าใจ" layout, ปรับ schema ได้อิสระ, ตรวจ logic ได้ (เช่น เช็คว่ายอดรวมถูกต้อง), ไม่ต้อง train | ค่า API ต่อรูป (~0.01–0.05 USD), ต้องต่อเน็ต |

### 2.2 Best practices จากอุตสาหกรรม (สรุปจากแหล่งอ้างอิงท้ายหัวข้อ)

1. **บังคับ schema** — ใช้ structured output / strict tool use ให้ได้ JSON ที่ valid เสมอ ไม่ต้อง parse ข้อความอิสระ
2. **Human-in-the-loop** — AI อ่านแล้วให้คนตรวจทานก่อนบันทึกเสมอ (หน้าจอ review + confidence)
3. **Validation ซ้อนอีกชั้น** — ตรวจเลขผู้เสียภาษี (check digit), ตรวจสมการเงิน (ยอดก่อน VAT + VAT = ยอดรวม), ตรวจผลรวมรายการ
4. **สั่งให้คงค่าตามที่พิมพ์** — "return values exactly as printed, do not translate" กันโมเดลแปลง/แปลค่าเอง
5. **เก็บภาพต้นฉบับคู่กับข้อมูล** — เพื่อการตรวจสอบย้อนหลัง (audit trail) ตามหลักบัญชี
6. **ตรวจจับใบซ้ำ** — ผู้ขายเดียวกัน + เลขที่เอกสารเดียวกัน = เตือนว่าอาจบันทึกซ้ำ
7. **บีบอัดรูปฝั่ง client ก่อนส่ง** — ลด latency/ค่าใช้จ่าย โดยยังคงความละเอียดพอให้อ่านตัวเลขได้ (ยาวสุด ~2000px, JPEG q≈0.85)

แหล่งอ้างอิง: [Unstract Receipt OCR Guide 2026](https://unstract.com/blog/unstract-receipt-ocr-scanner-api/), [ReceiptSync AI-Powered Receipt Scanning](https://receiptsync.net/blog/ai-powered-receipt-scanning-complete-guide), [Vision LLM Invoice Extraction](https://invoicedataextraction.com/blog/vision-llm-invoice-extraction-python), [Structured Outputs with Claude](https://www.vtechz.com/structured-outputs-with-claude-extract-json-from-any-document/), [Document Intelligence with LLMs](https://virtido.com/blog/document-intelligence-llm-extraction-guide)

### 2.3 ข้อกำหนดใบกำกับภาษีเต็มรูปตามมาตรา 86/4 แห่งประมวลรัษฎากร

ใช้เป็นเกณฑ์ตรวจความครบถ้วนของเอกสาร (แอปจะเตือนถ้าขาด):

1. คำว่า **"ใบกำกับภาษี"** ในที่เห็นเด่นชัด
2. **ชื่อ ที่อยู่ และเลขประจำตัวผู้เสียภาษีอากรของผู้ขาย** (ผู้ประกอบการจดทะเบียน)
3. **ชื่อ ที่อยู่ของผู้ซื้อ**
4. **หมายเลขลำดับของใบกำกับภาษี** (และเล่มที่ ถ้ามี)
5. **ชื่อ ชนิด ประเภท ปริมาณ และมูลค่า** ของสินค้า/บริการ
6. **จำนวนภาษีมูลค่าเพิ่ม** ที่คำนวณจากมูลค่า โดยแยกออกจากมูลค่าให้ชัดแจ้ง
7. **วัน เดือน ปี ที่ออก**ใบกำกับภาษี
8. ข้อความอื่นตามที่อธิบดีกำหนด (เช่น "สาขาที่ออกใบกำกับภาษี", เลขสาขา)

หมายเหตุ: **ใบกำกับภาษีอย่างย่อ (ABB)** ตามมาตรา 86/6 ไม่ต้องมีชื่อผู้ซื้อ — ใช้ขอคืน VAT ซื้อไม่ได้
แต่ยังใช้บันทึกต้นทุนได้ → แอปต้องแยกประเภทเอกสารให้

อ้างอิง: [กรมสรรพากร — มาตรา 86/4 และ 86/6](https://www.rd.go.th/fileadmin/images/image_pramoun/mata86_4_6.pdf), [คู่มือใบกำกับภาษี กรมสรรพากร](https://www.rd.go.th/fileadmin/user_upload/ebook/taxinvoice.pdf), [iTAX pedia](https://www.itax.in.th/pedia/%E0%B9%83%E0%B8%9A%E0%B8%81%E0%B8%B3%E0%B8%81%E0%B8%B1%E0%B8%9A%E0%B8%A0%E0%B8%B2%E0%B8%A9%E0%B8%B5/)

### 2.4 การตรวจเลขประจำตัวผู้เสียภาษี 13 หลัก (check digit)

เลข 13 หลักของไทยตรวจสอบได้ด้วยสูตร mod 11: นำหลักที่ 1–12 คูณน้ำหนัก 13,12,...,2 รวมกัน
แล้ว check digit = (11 − (ผลรวม mod 11)) mod 10 ต้องเท่ากับหลักที่ 13 → ใช้กรอง OCR ที่อ่านเลขผิดได้ทันที

---

## 3. สถาปัตยกรรมที่เลือก

```
┌─────────── มือถือ / เดสก์ท็อป (PWA) ───────────┐
│ Next.js 15 (App Router, TypeScript)             │
│                                                 │
│  📷 Scan page ── บีบอัดรูป (canvas) ──┐         │
│  ✏️ Review form (แก้ไข/ตรวจทาน)       │         │
│  📊 Dashboard + รายงาน                │         │
│  📦 Product costs (ต้นทุนต่อสินค้า)     │         │
│  💾 IndexedDB (Dexie) ← เก็บข้อมูล+รูป │         │
│         offline-first, ข้อมูลอยู่ที่เครื่องผู้ใช้ │         │
└───────────────────────────┬─────────────────────┘
                            │ POST /api/extract (รูป base64)
                            ▼
┌──────────── Next.js API Route (server) ─────────┐
│ @anthropic-ai/sdk → claude-opus-4-8 (vision)    │
│  - strict tool use → JSON ตาม schema เสมอ        │
│  - system prompt เฉพาะทางใบกำกับภาษีไทย           │
│  - ตรวจ check digit + สมการเงิน ก่อนส่งกลับ        │
└─────────────────────────────────────────────────┘
```

### เหตุผลของการตัดสินใจสำคัญ

| ประเด็น | ตัดสินใจ | เหตุผล |
|---|---|---|
| แพลตฟอร์ม | **PWA (Next.js)** ไม่ใช่ native app | ใช้กล้องผ่าน `capture="environment"` ได้, deploy ครั้งเดียวใช้ได้ทุกเครื่อง, ติดตั้งลงหน้าจอโฮมได้, ไม่ต้องผ่าน App Store |
| AI Model | **claude-opus-4-8** (vision) | ความแม่นยำสูงสุดบนเอกสารไทยจริง อ่าน layout ตารางได้ เข้าใจบริบท (เช่น แยก "ส่วนลด" ออกจากรายการสินค้า) |
| การได้ JSON | **strict tool use** (`strict: true` + `tool_choice` บังคับ) | การันตี JSON valid ตาม schema 100% ไม่ต้องเดา/retry parse |
| ฐานข้อมูล | **IndexedDB (Dexie) ฝั่ง client** | ข้อมูลการเงินอยู่ที่เครื่องผู้ใช้ (privacy), ใช้ offline ได้, ไม่ต้องมี auth/DB server ใน v1 — มี export/backup JSON + CSV ครบ |
| รูปภาพ | เก็บ Blob ใน IndexedDB คู่กับข้อมูล | audit trail ตามหลักบัญชี เรียกดูย้อนหลังได้ |
| ภาษา UI | ไทยทั้งหมด | ผู้ใช้เป้าหมายเป็นร้านค้าไทย |

## 4. โมเดลข้อมูล

### 4.1 Schema ที่ให้ AI สกัด (Extraction Schema)

```jsonc
{
  "document_type": "tax_invoice_full | tax_invoice_abb | receipt | delivery_note | other",
  "seller": { "name": "", "tax_id": "13 หลัก", "branch": "สำนักงานใหญ่/สาขาที่ n", "address": "" },
  "buyer":  { "name": "", "tax_id": "", "address": "" },
  "doc_number": "", "doc_date": "YYYY-MM-DD (แปลง พ.ศ.→ค.ศ.)",
  "line_items": [
    { "description": "ตามที่พิมพ์", "quantity": 0, "unit": "", "unit_price": 0, "amount": 0 }
  ],
  "subtotal": 0, "discount": 0, "vat_rate": 7, "vat_amount": 0, "total": 0,
  "payment_method": "", "notes": "",
  "confidence": "high | medium | low",
  "warnings": ["ข้อความเตือน เช่น ตัวเลขอ่านยาก/ภาพมัว"]
}
```

กติกาใน system prompt: อ่านค่าตามที่พิมพ์จริง (ห้ามแปล/ห้ามเดา), เลขไทย→อารบิก,
วันที่ พ.ศ. → ค.ศ., ค่าที่อ่านไม่ได้ให้เป็น null พร้อม warning, ตรวจสมการเงินก่อนตอบ

### 4.2 ตารางใน IndexedDB

- **receipts** — เอกสาร 1 ใบ: ข้อมูลที่สกัด + สถานะตรวจทาน + `imageBlob` + ผล validation
- **items** (index แยก) — บรรทัดสินค้า: อ้างถึง receiptId, ชื่อสินค้า normalize แล้ว, จำนวน, ราคา/หน่วย → ใช้ทำรายงานต้นทุนต่อสินค้า

### 4.3 Validation หลังสกัด (ทำที่ server ก่อนส่งกลับ + ย้ำที่ client)

1. เลขผู้เสียภาษีผู้ขายผ่าน check digit หรือไม่
2. `sum(line_items.amount) ≈ subtotal` (คลาดเคลื่อน ≤ 1 บาท)
3. `subtotal − discount + vat_amount ≈ total` และ `vat_amount ≈ (subtotal−discount) × 7%`
4. ความครบถ้วนตามมาตรา 86/4 (สำหรับใบเต็มรูป) → แจ้ง "ขอคืน VAT ซื้อได้/ไม่ได้"
5. ใบซ้ำ: seller.tax_id + doc_number ตรงกับที่เคยบันทึก → เตือน

## 5. หน้าจอและ Flow

1. **/ (แดชบอร์ด)** — การ์ดสรุป: ต้นทุนเดือนนี้, VAT ซื้อเดือนนี้, จำนวนใบ; กราฟแท่งต้นทุนรายเดือน; Top ผู้ขาย; ใบล่าสุด
2. **/scan** — ถ่ายรูป/เลือกรูป (หลายใบต่อเนื่องได้) → บีบอัด → ส่งสกัด → **หน้า review**: ฟอร์มเต็มแก้ไขได้ทุกช่อง + รูปเทียบข้างกัน + ป้าย validation → บันทึก
3. **/receipts** — รายการทั้งหมด ค้นหา/กรองตามเดือน/ผู้ขาย → หน้า detail (ดูรูป, แก้ไข, ลบ)
4. **/products** — สรุปต่อสินค้า: ซื้อทั้งหมดกี่ครั้ง/กี่หน่วย, ต้นทุนเฉลี่ยถ่วงน้ำหนัก, ราคาล่าสุด, ราคาต่ำสุด-สูงสุด
5. **/settings** — Export CSV (เปิดใน Excel ได้, มี BOM), Backup/Restore JSON, ลบข้อมูลทั้งหมด

## 6. ความปลอดภัย & Privacy

- API key อยู่ฝั่ง server เท่านั้น (`ANTHROPIC_API_KEY` env var) — client ไม่เห็น
- ข้อมูลการเงิน + รูป อยู่ใน IndexedDB บนเครื่องผู้ใช้ ไม่ผ่าน DB กลาง
- จำกัดขนาดรูปที่รับ (≤ ~8MB หลังบีบอัด) และ validate payload ที่ API route

## 7. แผนงาน (ทำใน commit นี้ = Phase 1 ทั้งหมด)

- [x] วิจัย + แผน (ไฟล์นี้)
- [ ] โครง Next.js + design system (มือถือเป็นหลัก, ธีมไทย อ่านง่าย)
- [ ] API `/api/extract` (Claude vision + strict schema + validation)
- [ ] หน้า Scan + บีบอัดรูป + Review form
- [ ] Dexie DB + หน้า Receipts / detail
- [ ] Dashboard + กราฟ + หน้า Products
- [ ] Export CSV / Backup / Restore
- [ ] PWA manifest + build ผ่าน + push

## 8. ไอเดียต่อยอด (Phase ถัดไป)

| ไอเดีย | คุณค่า |
|---|---|
| **e-Tax Invoice (XML/PDF)** — รับไฟล์ e-Tax จากอีเมลแล้ว parse ตรง ไม่ต้อง OCR | แม่นยำ 100% ตามเทรนด์สรรพากรที่ผลัก e-Tax |
| **ซิงก์หลายเครื่อง / หลายผู้ใช้** — เพิ่ม backend (Postgres + auth) sync จาก IndexedDB | ทีมงานหลายคนช่วยกันสแกน |
| **LINE Bot** — ส่งรูปเข้า LINE แล้วบันทึกให้อัตโนมัติ | ร้านค้าไทยใช้ LINE เป็นหลัก |
| **จัดหมวดอัตโนมัติ + ผูกสินค้า** — ให้ AI จับคู่ line item เข้า master product + หมวดบัญชี | รายงานแม่นขึ้น ลดงาน manual |
| **ส่งออกเข้าโปรแกรมบัญชี** — FlowAccount / PEAK / Express / ภ.พ.30 | ปิดงบได้จริง |
| **แจ้งเตือนราคาผิดปกติ** — ต้นทุนวัตถุดิบขึ้นเกิน X% เทียบครั้งก่อน | ช่วยตัดสินใจต่อรอง/เปลี่ยนเจ้า |
| **Batch scan + ประมวลผลคิว** — ถ่ายรวดเดียว 20 ใบ ประมวลผลเบื้องหลัง | ประหยัดเวลา |
| **คำนวณต้นทุนต่อเมนู/สูตร (BOM)** — ผูกวัตถุดิบเข้าสูตรอาหาร ได้ต้นทุนต่อจาน | สำหรับร้านอาหารโดยเฉพาะ |
