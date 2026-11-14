import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isDiscEnabled } from "@/lib/flags";
import { layEngine } from "@/lib/disc/engine";
import { ensureDiscEngine } from "@/lib/disc/engine-dang-ky";
import { HanhTrinhDisc } from "@/components/disc/hanh-trinh";
import { ManDangHoanThien } from "@/components/disc/man-dang-hoan-thien";
import { Ic } from "@/components/public/disc/bieu-tuong";
import "@/app/(public)/pub-design/disc.css";

// Cờ đọc từ env lúc CHẠY: trang phải động. Đây là màn làm bài (chứa dữ liệu trẻ) nên không cho lập chỉ mục.
export const dynamic = "force-dynamic";

// F-15: tiêu đề tab TRUNG TÍNH và cố định (không bao giờ chứa tên/SĐT/mã), không lập chỉ mục, không rò referrer.
// URL của màn này cũng không mang định danh nào (không query, không mã) — GA4/Meta Pixel gắn ở layout gốc có
// thể ghi nhận lượt xem trang, nên điều duy nhất ở đây được phép lọt ra là đường dẫn tĩnh `/disc/bat-dau`.
export const metadata: Metadata = {
  title: "Làm bài khám phá DISC | Sata Robo",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function DiscBatDauPage() {
  if (!isDiscEnabled()) notFound();
  ensureDiscEngine();

  // Động cơ chạy ở SERVER: chính SERVER này quyết định hiển thị "đang hoàn thiện" (không dựng bài giả).
  // Máy khách không có động cơ; nếu động cơ biến mất giữa chừng, POST /api/disc/bo-de trả 503
  // ENGINE_CHUA_SAN_SANG và `HanhTrinhDisc` cũng rơi về cùng màn này.
  // Giao diện CHÉP từ artifact "Disc-LamBai": đầu trang (đường dẫn + tiêu đề + 3 chip) rồi khung làm bài hai cột.
  return (
    <>
      <header className="subhero gridbg">
        <div className="glow" aria-hidden="true" style={{ width: "560px", height: "560px", right: "-140px", top: "-260px" }}></div>
        <div className="wrap dj-top" style={{ position: "relative", zIndex: "2" }}>
          <nav className="crumb" aria-label="Breadcrumb">
            <Link href="/">Trang chủ</Link>
            <span aria-hidden="true">/</span>
            <Link href="/disc">Khám phá DISC</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Làm bài</span>
          </nav>
          <h1>
            Làm bài <span className="grad">khám phá DISC</span>
          </h1>
          <div className="chips" style={{ marginTop: "14px" }}>
            <span className="chip">
              <Ic ten="dongHo" size={15} /> Khoảng <b>15–20 phút</b>
            </span>
            <span className="chip">
              <Ic ten="nguoi" size={15} /> Ba/mẹ làm trước, <b>con</b> làm sau
            </span>
            <span className="chip">
              <Ic ten="khoa" size={15} /> Không cần đăng nhập
            </span>
          </div>
        </div>
      </header>
      <section className="sec" style={{ paddingTop: "clamp(28px,3.6vw,48px)" }}>
        <div className="wrap">{layEngine() === null ? <ManDangHoanThien /> : <HanhTrinhDisc />}</div>
      </section>
    </>
  );
}
