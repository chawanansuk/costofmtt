"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", icon: "🏠", label: "หน้าหลัก" },
  { href: "/receipts", icon: "🧾", label: "เอกสาร" },
  { href: "/scan", icon: "📷", label: "สแกน", cta: true },
  { href: "/products", icon: "📦", label: "สินค้า" },
  { href: "/settings", icon: "⚙️", label: "ตั้งค่า" },
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    <nav className="navbar">
      <div className="navbar-inner">
        {TABS.map((t) => {
          const active =
            t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`nav-item ${t.cta ? "scan-cta" : ""} ${active ? "active" : ""}`}
            >
              <span className="ico">{t.icon}</span>
              <span>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
