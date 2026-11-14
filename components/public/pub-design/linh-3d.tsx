"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PubAnh } from "./pub-anh";
import { usePub3d } from "./use-pub-3d";
import type { MoHinh3D } from "./pub-3d-thuan";

/**
 * Linh vật 3D của TRANG CON (bộ xem `viewer2.js`) — chép đúng cụm artifact:
 *   <div class="m3w m3-xxx" style="…vị trí…"> <canvas …/> {poster khi chưa vẽ xong / không có 3D} </div>
 * Poster tĩnh CHỈ là giai đoạn chờ trước khi khung đầu của cảnh 3D được vẽ (và dự phòng khi chế độ nhẹ /
 * giảm chuyển động / không WebGL): sau khi `ready` poster bị GỠ khỏi DOM, không ở lại.
 *
 * Cấu hình `model/baseYaw/pedestal/cameraZ/scrollSpin/lift` lấy ĐÚNG `const M = {...}` trong `startMascot()` của
 * `<Trang>.dc.html`; `className`/`style` lấy từ thẻ `<div class="m3w …">` của trang.
 *
 * Hero TRANG CHỦ (spacelab.js, canvas nằm trong `header` còn poster nằm trong `.hero-mid`) dùng thẳng hook
 * `usePub3d({ kind: "space", … })` trong component hero — xem docs/public-redesign/NEN-PUBLIC-V2.md.
 */
export interface Linh3DProps {
  model: MoHinh3D;
  className?: string;
  style?: CSSProperties;
  baseYaw?: number;
  pedestal?: boolean;
  cameraZ?: number;
  scrollSpin?: boolean;
  lift?: number;
  ariaLabel?: string;
  poster: {
    /** Mã ảnh trong `public/pub` (xem ASSET-MAP của artifact). */
    id: string;
    alt: string;
    sizes: string;
    className?: string;
    style?: CSSProperties;
    priority?: boolean;
  };
}

export function Linh3D({ model, className = "m3w", style, baseYaw, pedestal, cameraZ, scrollSpin, lift, ariaLabel = "Linh vật 3D Sata Robo", poster }: Linh3DProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { ready, khongCo3D } = usePub3d(canvas, { kind: "viewer", model, baseYaw, pedestal, cameraZ, scrollSpin, lift });
  // Cross-fade: khi khung đầu của canvas đã vẽ (`ready`) poster mờ đi .6s CÙNG LÚC canvas hiện dần (hook đặt opacity),
  // rồi mới gỡ poster khỏi DOM — không lóe trống, không nhảy.
  const [daGo, setDaGo] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => setDaGo(true), 700);
    return () => window.clearTimeout(t);
  }, [ready]);
  const hienPoster = khongCo3D || !daGo;
  return (
    <div className={className} style={style} data-linh3d={khongCo3D ? "poster" : ready ? "3d" : "cho"}>
      <canvas ref={canvas} role="img" aria-label={ariaLabel} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", zIndex: 3 }} />
      {hienPoster && <PubAnh id={poster.id} alt={poster.alt} sizes={poster.sizes} className={poster.className} style={{ ...poster.style, opacity: ready && !khongCo3D ? 0 : 1, transition: "opacity .6s ease" }} priority={poster.priority} />}
    </div>
  );
}
