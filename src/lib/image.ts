// บีบอัดรูปฝั่ง client ก่อนส่งให้ AI: ย่อด้านยาวสุดเหลือ 2560px, JPEG q=0.85
// Opus 4.8 รองรับภาพความละเอียดสูงถึง 2576px ด้านยาว — ใช้ให้เต็มเพดาน
// เพื่อให้อ่านตัวเลข/ลายมือบนบิลไทยที่ตัวหนังสือเล็กได้แม่นขึ้น
const MAX_EDGE = 2560;
const QUALITY = 0.85;

// สำเนาที่เก็บลงเครื่องไม่ต้องละเอียดเท่าที่ส่งให้ AI — แค่พอให้คนอ่านทานกับบิลได้
// 1600px q=0.72 เล็กกว่าราว 3–4 เท่า ช่วยให้เก็บได้เป็นพันใบโดยไม่เต็มพื้นที่
const ARCHIVE_EDGE = 1600;
const ARCHIVE_QUALITY = 0.72;

export interface CompressedImage {
  blob: Blob; // สำเนาสำหรับเก็บลงเครื่อง (เล็ก)
  dataUrl: string; // สำหรับ preview
  base64: string; // เฉพาะเนื้อ base64 ความละเอียดเต็ม (ส่งให้ AI)
  mediaType: string;
}

function drawToBlob(
  source: ImageBitmap,
  maxEdge: number,
  quality: number
): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
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
  const bitmap = await createImageBitmap(file);
  try {
    const full = await drawToBlob(bitmap, MAX_EDGE, QUALITY);
    const archive = await drawToBlob(bitmap, ARCHIVE_EDGE, ARCHIVE_QUALITY);
    const fullUrl = await toDataUrl(full);
    return {
      blob: archive,
      dataUrl: await toDataUrl(archive),
      base64: fullUrl.split(",")[1],
      mediaType: "image/jpeg",
    };
  } finally {
    bitmap.close();
  }
}

/** ย่อรูปที่เก็บไว้แล้วให้เล็กลง — ใช้กับเอกสารเก่าที่บันทึกรูปความละเอียดเต็มไว้ */
export async function shrinkStoredImage(blob: Blob): Promise<Blob | null> {
  const bitmap = await createImageBitmap(blob);
  try {
    if (Math.max(bitmap.width, bitmap.height) <= ARCHIVE_EDGE) return null;
    const smaller = await drawToBlob(bitmap, ARCHIVE_EDGE, ARCHIVE_QUALITY);
    return smaller.size < blob.size ? smaller : null;
  } finally {
    bitmap.close();
  }
}
