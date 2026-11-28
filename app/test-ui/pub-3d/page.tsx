import { PubRoot } from "@/components/public/pub-root";
import { Linh3D } from "@/components/public/pub-design/linh-3d";
import { HeroKiem3D } from "./hero-kiem";

// /test-ui/pub-3d — trang KIỂM cảnh 3D của giao diện public V2 (noindex, như /test-ui). Chứa đúng hai cụm mà artifact dùng:
// (1) hero `spacelab.js` (canvas ở khung ngoài + poster ở `.hero-mid`), (2) trang con `viewer2.js` (`Linh3D`).
// Playwright `tests/e2e/pub/linh-3d.spec.ts` dựa vào trang này để chứng minh canvas WebGL vẽ thật.
export const dynamic = "force-static";
export const metadata = { title: "Kiểm 3D — Sata Robo", robots: { index: false, follow: false } };

export default function Trang() {
  return (
    <PubRoot>
      <HeroKiem3D />
      <section className="sec">
        <div className="wrap" style={{ position: "relative", minHeight: 520 }}>
          <Linh3D
            model="heart"
            className="m3w m3-about"
            style={{ position: "absolute", left: "24%", right: "24%", top: 0, bottom: 0 }}
            pedestal
            cameraZ={3.6}
            scrollSpin
            lift={0.04}
            baseYaw={-0.2}
            poster={{
              id: "2e4a9309e1a6bfcb633b68ee102428e9",
              alt: "Linh vật 3D Sata Robo",
              sizes: "(max-width: 860px) 70vw, 340px",
              className: "float",
              style: { position: "absolute", left: "50%", top: "50%", translate: "-50% -50%", height: "auto", zIndex: 3, width: "70%" },
            }}
          />
        </div>
      </section>
    </PubRoot>
  );
}
