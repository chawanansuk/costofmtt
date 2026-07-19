"use client";

import { useState } from "react";
import { baht } from "@/lib/format";

// กราฟแท่งซีรีส์เดียว (ต้นทุนรายเดือน) — สี #10805a ผ่านการตรวจ
// lightness/chroma/contrast บนพื้นขาวด้วย palette validator แล้ว
const BAR_COLOR = "#10805a";

export interface BarDatum {
  label: string;
  value: number;
}

export default function BarChart({
  data,
  ariaLabel,
}: {
  data: BarDatum[];
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 640;
  const H = 220;
  const M = { top: 26, right: 8, bottom: 26, left: 8 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const max = Math.max(...data.map((d) => d.value), 1);
  const step = plotW / data.length;
  const barW = Math.min(40, step * 0.68);
  const r = 4;

  const gridYs = [0.25, 0.5, 0.75, 1].map((f) => M.top + plotH * (1 - f));
  const maxIdx = data.reduce((mi, d, i) => (d.value > data[mi].value ? i : mi), 0);

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseLeave={() => setHover(null)}
      >
        {gridYs.map((y, i) => (
          <line key={i} x1={M.left} x2={W - M.right} y1={y} y2={y} stroke="#eceae3" strokeWidth={1} />
        ))}
        <line
          x1={M.left} x2={W - M.right}
          y1={M.top + plotH} y2={M.top + plotH}
          stroke="#d8d5cc" strokeWidth={1}
        />
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 3 : 0, (d.value / max) * plotH);
          const x = M.left + step * i + (step - barW) / 2;
          const y = M.top + plotH - h;
          const isHover = hover === i;
          const showLabel = isHover || (hover === null && i === maxIdx && d.value > 0);
          return (
            <g key={d.label}>
              {/* hit target กว้างกว่าแท่งจริง */}
              <rect
                x={M.left + step * i} y={M.top} width={step} height={plotH + M.bottom}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
              {h > 0 && (
                <path
                  d={`M ${x} ${y + Math.min(r, h)}
                      Q ${x} ${y} ${x + r} ${y}
                      L ${x + barW - r} ${y}
                      Q ${x + barW} ${y} ${x + barW} ${y + Math.min(r, h)}
                      L ${x + barW} ${M.top + plotH}
                      L ${x} ${M.top + plotH} Z`}
                  fill={BAR_COLOR}
                  opacity={hover === null || isHover ? 1 : 0.45}
                  pointerEvents="none"
                />
              )}
              {showLabel && (
                <text
                  x={x + barW / 2} y={y - 7}
                  textAnchor="middle"
                  fontSize={12} fontWeight={600} fill="#1f2a26"
                >
                  {baht(d.value)}
                </text>
              )}
              <text
                x={M.left + step * i + step / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize={11.5}
                fill={isHover ? "#1f2a26" : "#93a09a"}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>

      <details className="mt-2">
        <summary className="muted small" style={{ cursor: "pointer" }}>
          ดูเป็นตาราง
        </summary>
        <table className="data mt-2">
          <thead>
            <tr>
              <th>เดือน</th>
              <th className="num">ต้นทุน (บาท)</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                <td className="num">{baht(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
