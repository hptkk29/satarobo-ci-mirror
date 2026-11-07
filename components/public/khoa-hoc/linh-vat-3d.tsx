"use client";

import { useRef, type CSSProperties } from "react";
import { usePub3d } from "../pub-design/use-pub-3d";
import { Anh } from "./anh";

/**
 * Linh vật 3D của trang Khoá học (bộ xem `viewer2.js`, three@0.149) — cùng cụm với `Linh3D` của nền
 * (components/public/pub-design/linh-3d.tsx) nhưng poster lấy từ `public/images/khoa-hoc` (ảnh này chưa có trong
 * `public/pub`). Cấu hình = ĐÚNG `const M = {…}` trong `startMascot()` của Courses.dc.html.
 * Poster chỉ là giai đoạn chờ + dự phòng (chế độ nhẹ / giảm chuyển động / không WebGL): `ready` ⇒ gỡ poster.
 */
export function LinhVat3D({ poster, style }: { poster: { id: string; alt: string; sizes: string; className?: string; style?: CSSProperties }; style?: CSSProperties }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { ready, khongCo3D } = usePub3d(canvas, { kind: "viewer", model: "gift", baseYaw: -0.2, pedestal: true, cameraZ: 3.6, scrollSpin: true, lift: 0.04 });
  const hienPoster = khongCo3D || !ready;
  return (
    <div className="m3w" style={style} data-linh3d={khongCo3D ? "poster" : ready ? "3d" : "cho"}>
      <canvas ref={canvas} role="img" aria-label="Linh vật 3D Sata Robo" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", zIndex: 3 }} />
      {hienPoster && <Anh h={poster.id} alt={poster.alt} sizes={poster.sizes} className={poster.className} style={poster.style} />}
    </div>
  );
}
