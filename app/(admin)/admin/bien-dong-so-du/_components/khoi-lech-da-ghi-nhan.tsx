// Khối "đã ghi nhận nhưng file ghi khác" trong panel Import POS (GĐ3, docs/pos-gd3-thiet-ke.md §8).
//
// Trình bày THUẦN (không state, không action) — panel truyền `ketQua.lech` đã cộng qua các lô.
// · Tông CẢNH BÁO, không tông lỗi: không có gì hỏng, sổ vẫn đúng — chỉ file ghi khác thứ đã vào sổ.
// · Luật 12: KHÔNG có nút. Không hành động nào tự động làm được ở đây; điều chỉnh (nếu cần) đi bằng gỡ
//   gắn / hoàn của luồng hiện có — đúng câu khu cảnh báo thẻ POS đang dùng.
// · Cùng khuôn với khối "Dòng lỗi" ngay trên nó (viền + nền nhạt + chữ -ink, mã giao dịch phông đơn
//   cách) — người đọc đã quen một khuôn, đừng bắt họ học khuôn thứ hai.
import { AlertTriangle } from "lucide-react";

import { gomLechTheoGiaoDich, type LechDong } from "@/lib/payments/pos/lech-da-ghi-nhan";

/** Số GIAO DỊCH liệt kê; phần còn lại gói trong "… và N giao dịch khác" (cùng mức khối dòng lỗi). */
const HIEN_TOI_DA = 20;

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

function moTa(l: LechDong): string {
  return l.truong === "soTien"
    ? `Số tiền: đã ghi ${l.daGhiNhan}đ · file ${l.trongFile}đ`
    : `Trạng thái: đã ghi ${l.daGhiNhan} · file ${l.trongFile}`;
}

export function KhoiLechDaGhiNhan({ lech }: { lech: readonly LechDong[] }) {
  if (lech.length === 0) return null;
  // Tiêu đề, danh sách và dòng "… và N khác" cùng MỘT đơn vị: giao dịch (rà đối kháng GĐ3). Mã TRƯỚC bản
  // vá cắt theo MỤC (giao dịch × trường) ⇒ "15 giao dịch" · 10 mã · "… và 10 khác" — tự mâu thuẫn.
  const theoGiaoDich = gomLechTheoGiaoDich(lech);
  return (
    <section
      aria-labelledby="pos-lech-da-ghi-nhan"
      className="rounded-xl border border-state-warning bg-state-warning-soft px-4 py-3"
    >
      <h4
        id="pos-lech-da-ghi-nhan"
        className="flex items-start gap-2 text-xs font-semibold leading-relaxed text-state-warning-ink"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {fmt(theoGiaoDich.length)} giao dịch đã ghi nhận nhưng file ghi khác — sổ không đổi
        </span>
      </h4>
      {/* Mã (32 ký tự) một dòng, phép so một dòng: chung một dòng thì phép so bị bẻ giữa chừng
          ("đã ghi / 3.168.000đ") ở cả 1280 lẫn 375px (smoke 06/10/2026). */}
      <ul className="mt-2 space-y-2 pl-6">
        {theoGiaoDich.slice(0, HIEN_TOI_DA).map((g) => (
          <li key={g.maGiaoDich} className="text-xs leading-relaxed text-state-warning-ink">
            <span className="block break-all font-mono">{g.maGiaoDich}</span>
            {g.muc.map((l) => (
              <span key={l.truong} className="block tabular-nums">
                {moTa(l)}
              </span>
            ))}
          </li>
        ))}
        {theoGiaoDich.length > HIEN_TOI_DA && (
          <li className="text-xs text-state-warning-ink">
            … và {fmt(theoGiaoDich.length - HIEN_TOI_DA)} giao dịch khác
          </li>
        )}
      </ul>
      <p className="mt-2 pl-6 text-xs leading-relaxed text-state-warning-ink">
        Kiểm lại với Techcombank. Cần sửa thì gỡ gắn / hoàn bằng luồng hiện có — hệ thống không tự sửa số đã ghi.
      </p>
    </section>
  );
}
