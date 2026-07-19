// บีบอัดรูปฝั่ง client ก่อนส่งให้ AI: ย่อด้านยาวสุดเหลือ ~2000px, JPEG q=0.85
// ใหญ่พอให้อ่านตัวเลขบนใบกำกับภาษีได้ แต่ประหยัด token/แบนด์วิดท์
const MAX_EDGE = 2000;
const QUALITY = 0.85;

export interface CompressedImage {
  blob: Blob;
  dataUrl: string; // สำหรับ preview
  base64: string; // เฉพาะเนื้อ base64 (ไม่มี prefix)
  mediaType: string;
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("บีบอัดรูปไม่สำเร็จ"))),
      "image/jpeg",
      QUALITY
    )
  );

  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  return {
    blob,
    dataUrl,
    base64: dataUrl.split(",")[1],
    mediaType: "image/jpeg",
  };
}
