// บีบอัดรูปฝั่ง client ก่อนส่งให้ AI: ย่อด้านยาวสุดเหลือ 2560px, JPEG q=0.85
// Opus 4.8 รองรับภาพความละเอียดสูงถึง 2576px ด้านยาว — ใช้ให้เต็มเพดาน
// เพื่อให้อ่านตัวเลข/ลายมือบนบิลไทยที่ตัวหนังสือเล็กได้แม่นขึ้น
const MAX_EDGE = 2560;
const QUALITY = 0.85;

// สำเนาที่เก็บลงเครื่องไม่ต้องละเอียดเท่าที่ส่งให้ AI — แค่พอให้คนอ่านทานกับบิลได้
// 1600px q=0.72 เล็กกว่าราว 3–4 เท่า ช่วยให้เก็บได้เป็นพันใบโดยไม่เต็มพื้นที่
const ARCHIVE_EDGE = 1600;
const ARCHIVE_QUALITY = 0.72;

// Vercel ปฏิเสธ request ที่ใหญ่เกิน 4.5MB ก่อนถึงโค้ดเรา — รูปบิลที่มีรายละเอียดเยอะ (กระดาษมีลาย/แสงเงา)
// ที่ 2560px อาจเกินได้ เผื่อที่ไว้ให้ base64 ไม่เกิน ~3MB แล้วลดคุณภาพทีละขั้นจนกว่าจะพอดี
const MAX_UPLOAD_BASE64 = 3_000_000;
const UPLOAD_STEPS: [edge: number, quality: number][] = [
  [MAX_EDGE, QUALITY],
  [MAX_EDGE, 0.75],
  [2200, 0.75],
  [1900, 0.7],
  [1600, 0.7],
];

export interface CompressedImage {
  blob: Blob; // สำเนาสำหรับเก็บลงเครื่อง (เล็ก)
  dataUrl: string; // สำหรับ preview
  base64: string; // เฉพาะเนื้อ base64 ความละเอียดเต็ม (ส่งให้ AI)
  mediaType: string;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

function loadViaImgElement(file: Blob): Promise<Decoded> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () =>
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

// เบราว์เซอร์บางรุ่น (โดยเฉพาะ iPhone iOS เก่า) ไม่รองรับ option หมุนตาม EXIF ของ createImageBitmap
// แล้ว throw ทันที — ไล่ลองจากวิธีที่ดีที่สุดลงมา แทนที่จะล้มทั้งการสแกน
async function decodeImage(file: Blob): Promise<Decoded> {
  const fromBitmap = (b: ImageBitmap): Decoded => ({
    source: b,
    width: b.width,
    height: b.height,
    close: () => b.close(),
  });
  try {
    return fromBitmap(await createImageBitmap(file, { imageOrientation: "from-image" }));
  } catch {}
  try {
    return fromBitmap(await createImageBitmap(file)); // เบราว์เซอร์ปัจจุบันหมุนตาม EXIF ให้อยู่แล้ว
  } catch {}
  try {
    return await loadViaImgElement(file); // <img> หมุนตาม EXIF เสมอ
  } catch {
    throw new Error(
      "เปิดไฟล์รูปนี้ไม่ได้ — ถ้าเป็นไฟล์ HEIC ให้ตั้งกล้อง iPhone เป็น \"เข้ากันได้มากที่สุด\" หรือแคปหน้าจอรูปแล้วส่งแทน"
    );
  }
}

function drawToBlob(
  source: Decoded,
  maxEdge: number,
  quality: number
): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source.source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("บีบอัดรูปไม่สำเร็จ"))),
      "image/jpeg",
      quality
    )
  );
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function compressImage(file: File): Promise<CompressedImage> {
  // หมุนตาม EXIF เสมอ — รูปจากกล้องมือถือมักเก็บแนวตั้งเป็น metadata ถ้าไม่หมุน AI จะได้รูปนอน
  const img = await decodeImage(file);
  try {
    let base64 = "";
    for (const [edge, quality] of UPLOAD_STEPS) {
      const full = await drawToBlob(img, edge, quality);
      base64 = (await toDataUrl(full)).split(",")[1];
      if (base64.length <= MAX_UPLOAD_BASE64) break;
    }
    const archive = await drawToBlob(img, ARCHIVE_EDGE, ARCHIVE_QUALITY);
    return {
      blob: archive,
      dataUrl: await toDataUrl(archive),
      base64,
      mediaType: "image/jpeg",
    };
  } finally {
    img.close();
  }
}

/** ย่อรูปที่เก็บไว้แล้วให้เล็กลง — ใช้กับเอกสารเก่าที่บันทึกรูปความละเอียดเต็มไว้ */
export async function shrinkStoredImage(blob: Blob): Promise<Blob | null> {
  const img = await decodeImage(blob);
  try {
    if (Math.max(img.width, img.height) <= ARCHIVE_EDGE) return null;
    const smaller = await drawToBlob(img, ARCHIVE_EDGE, ARCHIVE_QUALITY);
    return smaller.size < blob.size ? smaller : null;
  } finally {
    img.close();
  }
}
