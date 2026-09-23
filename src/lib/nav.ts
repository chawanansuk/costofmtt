// เมนูหลักของแอป — ใช้ร่วมกันทั้งแถบล่าง (มือถือ) และเมนูด้านข้าง (เดสก์ท็อป)
export interface NavTab {
  href: string;
  icon: string;
  label: string;
  /** ปุ่มสแกนเป็นปุ่มเด่นกลางแถบล่างบนมือถือ */
  cta?: boolean;
}

export const NAV_TABS: NavTab[] = [
  { href: "/", icon: "🏠", label: "หน้าหลัก" },
  { href: "/receipts", icon: "🧾", label: "เอกสาร" },
  { href: "/scan", icon: "📷", label: "สแกน", cta: true },
  { href: "/products", icon: "📦", label: "สินค้า" },
  { href: "/settings", icon: "⚙️", label: "ตั้งค่า" },
];

export function isActiveTab(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
