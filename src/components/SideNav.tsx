"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { NAV_TABS, isActiveTab } from "@/lib/nav";

// เมนูด้านข้าง — แสดงเฉพาะจอ ≥1024px (ซ่อนด้วย CSS บนมือถือ)
export default function SideNav() {
  const pathname = usePathname();
  const [shop, setShop] = useState("ร้านของฉัน");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("costsnap:myshop");
      if (saved) setShop(saved);
    } catch {
      // เบราว์เซอร์บล็อก localStorage — ใช้ค่าเริ่มต้น
    }
  }, []);

  const counts = useLiveQuery(
    async () => ({ receipts: await db.receipts.count(), items: await db.items.count() }),
    []
  );

  return (
    <aside className="app-sidebar">
      <Link href="/" className="sidebar-brand">
        <span className="sidebar-mark" aria-hidden="true">CS</span>
        <span className="sidebar-name">CostSnap</span>
      </Link>

      <nav className="sidebar-nav" aria-label="เมนูหลัก">
        {NAV_TABS.map((t) => {
          const active = isActiveTab(t.href, pathname);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`sidebar-item ${active ? "active" : ""}`}
            >
              <span className="ico" aria-hidden="true">{t.icon}</span>
              <span>{t.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="who">{shop}</div>
        <div className="sub">
          {counts ? `${counts.receipts} ใบ · ${counts.items} รายการสินค้า` : "กำลังโหลด…"}
        </div>
      </div>
    </aside>
  );
}
