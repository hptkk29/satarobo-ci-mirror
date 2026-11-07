import type { Metadata } from "next";
import { headers } from "next/headers";
import { laBotXemTruoc } from "@/lib/affiliate/bot-xem-truoc";
import { ipChoRateLimit } from "@/lib/security/client-ip";
import { xuLyMoTrang } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-cong-khai";
import { phuThuocThat } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-cong-khai-db";
import { FormThongTinNguoiMua } from "./_components/form-thong-tin-nguoi-mua";
import { ThongBaoLienKet } from "./_components/thong-bao-lien-ket";

// Trang CÔNG KHAI cho phụ huynh tự điền thông tin người mua hoá đơn (Invoice Hub đợt 2, S11). Quét QR bằng điện thoại, KHÔNG đăng nhập: quyền = cầm đúng liên kết `<id>.<token>`.
//
// Đây KHÔNG phải trang marketing: không JSON-LD, không breadcrumb, không analytics riêng, không animation, không robots (noindex,nofollow), không Referer (liên kết mang bí mật).
// Mọi cổng (bot, rate-limit, cơ sở, cờ, token) ở `xuLyMoTrang` — xem đầu `lib/finance/hoa-don/yeu-cau-nguoi-mua-cong-khai.ts`. Trang KHÔNG hiện mã đơn / số tiền: chỉ các ô người mua, điền sẵn từ đơn / hồ sơ / lead (trừ hai ô CCCD — [03/11/2026]).
// `force-dynamic`: mở trang CÓ tác dụng phụ (tăng số lần mở) nên tuyệt đối không được cache; Next gửi `Cache-Control: no-store` cho trang động.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Thông tin xuất hoá đơn",
  description: "Điền thông tin người mua để Sata Robo xuất hoá đơn điện tử.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default async function TrangThongTinHoaDon({ params }: { params: Promise<{ ma: string }> }) {
  const { ma } = await params;
  const h = await headers();
  const kq = await xuLyMoTrang({ ma, ip: ipChoRateLimit(h), laBot: laBotXemTruoc(h.get("user-agent"), "GET"), now: new Date() }, phuThuocThat());

  // `pb-28` trên di động: thanh CTA dính đáy của site công khai không được che nút «Gửi thông tin».
  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-28 pt-8 lg:pb-12">
      {kq.kieu === "FORM" ? (
        <FormThongTinNguoiMua ma={ma} datTruoc={kq.o} />
      ) : (
        <ThongBaoLienKet
          tieuDe={kq.kieu === "KHOA" ? "Liên kết đang tạm khoá" : kq.kieu === "QUA_NHANH" ? "Bạn thao tác hơi nhanh" : kq.kieu === "LOI_TAM" ? "Hệ thống đang bận" : "Liên kết không còn hiệu lực"}
          noiDung={kq.thongDiep}
        />
      )}
    </div>
  );
}
