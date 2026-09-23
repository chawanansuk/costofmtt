"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_TABS, isActiveTab } from "@/lib/nav";

// แถบเมนูล่าง — แสดงเฉพาะจอเล็กกว่า 1024px (ซ่อนด้วย CSS เมื่อมีเมนูด้านข้าง)
export default function NavBar() {
  const pathname = usePathname();
  return (
    <nav className="navbar">
      <div className="navbar-inner">
        {NAV_TABS.map((t) => {
          const active = isActiveTab(t.href, pathname);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`nav-item ${t.cta ? "scan-cta" : ""} ${active ? "active" : ""}`}
            >
              <span className="ico" aria-hidden="true">{t.icon}</span>
              <span>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
