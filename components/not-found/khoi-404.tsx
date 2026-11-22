import Image from "next/image";
import { LoiThoat404 } from "@/components/not-found/loi-thoat-404";

/**
 * Thân trang 404 theo artifact "Sata Robo — Website mới" (board NotFound). Dùng ở HAI nơi:
 *  - `app/(public)/not-found.tsx` — `notFound()` bắn từ trang public (đã có thanh trên + chân trang của layout);
 *  - `app/not-found.tsx` — URL không khớp route nào (không có layout nhóm ⇒ tự dựng khung).
 *
 * KHÔNG hoạt ảnh (luật client-site): `.no-anim` tắt vòng xoay chữ "0", chữ chuyển màu và hình dán.
 * Server Component thuần: host chỉ đọc ở trình duyệt, bên trong `LoiThoat404` (xem lib/routing/dich-den-404.ts).
 */
export function Khoi404() {
  return (
    <section
      className="sec gridbg no-anim"
      style={{ minHeight: "70vh", display: "flex", alignItems: "center", position: "relative", overflow: "hidden" }}
    >
      <div className="glow" aria-hidden="true" style={{ width: "700px", height: "700px", left: "50%", top: "-200px", marginLeft: "-350px" }} />
      <div className="wrap" style={{ textAlign: "center", position: "relative" }}>
        <div className="nf" aria-hidden="true">
          <span className="grad">4</span>
          <span className="o" />
          <span className="grad">4</span>
        </div>
        <div style={{ position: "relative", height: 0 }}>
          <Image
            className="hide-sm"
            src="/pub/933e29639ed926731a405c5e0289c62d.webp"
            alt=""
            aria-hidden="true"
            width={558}
            height={842}
            style={{ height: "auto", position: "absolute", zIndex: 3, filter: "drop-shadow(0 16px 20px rgba(0,0,0,.35))", left: "50%", top: "-250px", width: "120px", marginLeft: "250px" }}
          />
        </div>
        <h1 style={{ fontSize: "clamp(26px,3vw,40px)", marginTop: "10px" }}>Ối, robot lạc đường rồi!</h1>
        {/* Tiêu đề phụ mang đúng tên trang lỗi: máy đọc màn hình và các ca e2e (zalocrm-gate, hoc-bu-theo-vai, affiliate…) nhận ra «đây là 404». */}
        <h2 style={{ fontSize: "15px", fontWeight: 600, marginTop: "8px", color: "var(--muted)" }}>Không tìm thấy trang</h2>
        <p className="lead" style={{ margin: "12px auto 0", maxWidth: "560px", color: "var(--muted)" }}>
          Trang ba mẹ tìm không tồn tại hoặc đã được chuyển đi. Thử một trong các lối dưới đây nhé.
        </p>
        <LoiThoat404 />
      </div>
    </section>
  );
}
