import Image from "next/image";
import { cn } from "@/lib/utils";

// components/public/huy-hieu-bo-cong-thuong.tsx — HUY HIỆU "ĐÃ THÔNG BÁO" của Bộ Công Thương.
//
// ─────────────────────────────────────────────────────────────────────────────
// Hồ sơ nền tảng TMĐT kinh doanh trực tiếp của satarobo.vn đã được xác nhận thông báo
// (Luật Thương mại điện tử 122/2025/QH15, khoản 1 Điều 14). Huy hiệu là dấu hiệu công khai
// việc đó, và nó CHỈ có nghĩa khi bấm được về đúng trang tra cứu của Bộ.
//
// ⚠️ ẢNH TỰ LƯU, KHÔNG trỏ thẳng `fileserver.online.gov.vn` — ba lý do đo được ở
//    `next.config.ts` (đo 14/10/2026):
//  1. `images.remotePatterns` chỉ khai `cdn.satarobo.vn` · `images.unsplash.com`
//     · `img.youtube.com` (wildcard R2 đã gỡ 29/10/2026 vì lý do bảo mật). `next/image` với host lạ NÉM LỖI lúc
//     chạy, không phải lúc build — tức trang gãy trên prod mà CI vẫn xanh.
//  2. `img-src` của CSP cũng không có host đó. Hôm nay header còn là
//     `Content-Security-Policy-Report-Only` nên **chưa chặn**, nhưng đợt S2 bật chặn thật
//     là huy hiệu biến mất IM LẶNG — không lỗi, không test đỏ, chỉ mất dấu hiệu pháp lý.
//  3. Ảnh nằm trên máy chủ của Bộ; máy đó chậm hay đổi đường dẫn là chân trang mình thủng.
//
//    Ảnh gốc tải từ `https://fileserver.online.gov.vn/uploads/Resources/iconxacnhan/
//    DaThongBao.png` ngày 14/10/2026 (PNG 230×86, 18.060 byte), lưu nguyên vẹn tại
//    `public/brand/bo-cong-thuong-da-thong-bao.png` — KHÔNG sửa ảnh.
//
// ⚠️ ĐƯỜNG DẪN TRA CỨU LÀ PHẦN MANG NGHĨA PHÁP LÝ. Đổi mã nền tảng trong URL là trỏ người
//    đọc sang hồ sơ của đơn vị khác. Mã này gắn với chính pháp nhân Sata Robo.
// ─────────────────────────────────────────────────────────────────────────────

/** Trang tra cứu hồ sơ nền tảng của Sata Robo trên cổng online.gov.vn. */
export const BCT_LINK_TRA_CUU =
  "https://online.gov.vn/nen-tang/2de2d7b7-15d6-4b1c-85b0-7807945b3f95";

/** Ảnh huy hiệu tự lưu (bản gốc của Bộ, không chỉnh sửa). */
export const BCT_ANH_HUY_HIEU = "/brand/bo-cong-thuong-da-thong-bao.png";

export function HuyHieuBoCongThuong({ className }: { className?: string }) {
  return (
    <a
      href={BCT_LINK_TRA_CUU}
      target="_blank"
      rel="noopener noreferrer"
      title="Đã thông báo với Bộ Công Thương"
      className={cn("inline-block", className)}
    >
      <Image
        src={BCT_ANH_HUY_HIEU}
        alt="Đã thông báo với Bộ Công Thương"
        width={118}
        height={44}
        className="h-11 w-auto"
        // Chân trang nằm dưới màn hình đầu; để `lazy` (mặc định) cho khỏi tranh băng thông
        // với ảnh trong khung nhìn đầu tiên.
        sizes="118px"
      />
    </a>
  );
}
