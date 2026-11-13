"use client";

import { useRef } from "react";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { usePub3d } from "@/components/public/pub-design/use-pub-3d";

// Hero `space-lab` của trang chủ, rút gọn đúng cấu trúc artifact: canvas `.space-cv` ở khung ngoài (header), poster
// `.space-poster` trong `.hero-mid`; poster mờ đi (`gone`) khi cảnh đã vẽ xong khung đầu.
export function HeroKiem3D() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mid = useRef<HTMLDivElement>(null);
  const { ready, khongCo3D } = usePub3d(canvas, { kind: "space", model: "gift", anchor: mid, baseYaw: -0.25 });
  return (
    <header className="gridbg space-hero" style={{ position: "relative", overflow: "hidden", borderBottom: "1px solid var(--line)" }}>
      <div className="space-sky" aria-hidden="true" />
      <canvas ref={canvas} className="space-cv" role="img" aria-label="Phòng thí nghiệm không gian 3D: linh vật Sata Robo" data-linh3d={khongCo3D ? "poster" : ready ? "3d" : "cho"} />
      <div className="wrap" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <div className="hero-grid">
          <div className="hero-col" />
          <div className="hero-mid" ref={mid}>
            <PubAnh
              id="55b19affb2175edef52469129f9b4339"
              alt=""
              aria-hidden="true"
              sizes="340px"
              priority
              className={ready && !khongCo3D ? "space-poster gone" : "space-poster"}
            />
          </div>
          <div className="hero-col right" />
        </div>
      </div>
    </header>
  );
}
