// สร้างไอคอน PNG สำหรับ PWA (iOS ไม่รองรับไอคอน SVG) — วาด raster ตรงๆ แล้ว encode PNG เอง
// รัน: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function encodePng(size, pixels /* RGBA Uint8Array */) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // scanlines พร้อม filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels
      .subarray(y * size * 4, (y + 1) * size * 4)
      .forEach((v, i) => (raw[y * (size * 4 + 1) + 1 + i] = v));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG = hex("#155e4a");
const PAPER = hex("#f6f4ef");
const LINE = hex("#8aa79b");
const ACCENT = hex("#d97742");

// วาดไอคอน: พื้นเขียวมุมมน + กระดาษใบเสร็จ + เส้นข้อความ + วงกลมส้ม
function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const s = size / 64; // สเกลจาก viewBox 64
  const inRounded = (x, y, x0, y0, w, h, r) => {
    if (x < x0 || x >= x0 + w || y < y0 || y >= y0 + h) return false;
    const cx = Math.max(x0 + r, Math.min(x, x0 + w - r));
    const cy = Math.max(y0 + r, Math.min(y, y0 + h - r));
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= x0 + r && x < x0 + w - r) || (y >= y0 + r && y < y0 + h - r)
      ? (Math.max(0, Math.abs(x - (x0 + w / 2)) - (w / 2 - r)) ** 2 +
          Math.max(0, Math.abs(y - (y0 + h / 2)) - (h / 2 - r)) ** 2) <= r * r
      : false;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = null;
      if (inRounded(x, y, 0, 0, size, size, 14 * s)) c = BG;
      if (c && inRounded(x, y, 16 * s, 10 * s, 32 * s, 44 * s, 4 * s)) c = PAPER;
      if (c === PAPER) {
        // เส้นหัวเอกสาร + เส้นรายการ
        const bands = [
          [16 * s, 19 * s, 21 * s, 43 * s, BG],
          [23 * s, 25.5 * s, 21 * s, 35 * s, LINE],
          [29 * s, 31.5 * s, 21 * s, 39 * s, LINE],
          [35 * s, 37.5 * s, 21 * s, 33 * s, LINE],
        ];
        for (const [y0, y1, x0, x1, col] of bands) {
          if (y >= y0 && y < y1 && x >= x0 && x < x1) c = col;
        }
      }
      // วงกลมส้ม
      if (c && (x - 40 * s) ** 2 + (y - 41 * s) ** 2 <= (7 * s) ** 2) c = ACCENT;
      if (c) {
        const i = (y * size + x) * 4;
        px[i] = c[0];
        px[i + 1] = c[1];
        px[i + 2] = c[2];
        px[i + 3] = 255;
      }
    }
  }
  return px;
}

mkdirSync("public", { recursive: true });
for (const size of [180, 192, 512]) {
  const name = size === 180 ? "public/apple-touch-icon.png" : `public/icon-${size}.png`;
  writeFileSync(name, encodePng(size, drawIcon(size)));
  console.log("wrote", name);
}
