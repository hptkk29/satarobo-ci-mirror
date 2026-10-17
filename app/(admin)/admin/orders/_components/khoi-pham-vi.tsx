"use client";

/**
 * KHỐI "THU THEO PHẠM VI HỌC" trên form tạo đơn — THAY khối "Kế hoạch thanh toán" khi đơn đi theo mô hình phạm vi.
 *
 * Chỉ HIỂN THỊ. Nó nhận kết quả xem trước (`xemTruocGiaPhamViAction`) đã tính sẵn và đẩy việc "áp giá" về form cha; không tự gọi
 * máy chủ, không tự quyết đơn có theo phạm vi hay không (quyết định đó nằm ở `phanLoaiGiaoDienDon`).
 *
 * Nói thật (luật 12): khối này KHÔNG hứa điều gì máy chủ không làm. Đơn giá đúng là số máy chủ tính; nút "Áp giá" chỉ điền số
 * đó vào ô Đơn giá — máy chủ vẫn tính lại và vẫn từ chối nếu số gửi lên lệch.
 */
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { KetQuaXemTruocPhamVi } from "@/lib/orders/pham-vi/xem-truoc";

export interface DongHienThi {
  readonly ten: string;
  readonly donGia: number;
}

const vnd = (n: number) => n.toLocaleString("vi-VN") + "đ";

export function KhoiThuTheoPhamVi({
  ketQua,
  dong,
  onApGia,
}: {
  /** `null` = đang tính (hoặc inputs vừa đổi, kết quả cũ chưa còn đúng). */
  ketQua: KetQuaXemTruocPhamVi | null;
  dong: readonly DongHienThi[];
  onApGia: () => void;
}) {
  const lech =
    ketQua?.ok === true && ketQua.kieu === "SCOPE" && ketQua.dong.length === dong.length
      ? dong.some((d, i) => d.donGia !== ketQua.dong[i]!.thanhTien)
      : false;

  return (
    <section
      data-testid="khoi-thu-theo-pham-vi"
      className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
        <CalendarClock className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        Thu theo phạm vi học
      </h2>
      <p className="rounded-lg border border-state-info-ink/25 bg-state-info-soft p-3 text-xs leading-relaxed text-state-info-ink">
        Đơn theo phạm vi học không dùng kế hoạch thanh toán nhiều đợt: khách trả theo số buổi đã chọn trên từng dòng.
        Đơn giá mỗi dòng do hệ thống tính (niêm yết theo mốc buổi, đã gồm giảm theo chính sách).
      </p>

      {ketQua === null && (
        <p role="status" className="text-xs text-muted-foreground">
          Đang tính giá theo phạm vi học…
        </p>
      )}

      {ketQua?.ok === false && (
        <p role="status" className="rounded-lg border border-state-warning-ink/30 bg-state-warning-soft p-3 text-xs leading-relaxed text-state-warning-ink">
          Chưa tính được giá theo phạm vi học ({ketQua.error}). Vẫn bấm Tạo đơn được — máy chủ sẽ tính lại và nói rõ nếu đơn giá chưa đúng.
        </p>
      )}

      {ketQua?.ok === true && ketQua.kieu === "REJECT" && (
        <div role="alert" className="rounded-lg border border-state-warning-ink/30 bg-state-warning-soft p-3 text-xs leading-relaxed text-state-warning-ink">
          <p className="font-semibold">Đơn này chưa lưu được theo phạm vi học</p>
          <p className="mt-1">{ketQua.thongBao}</p>
        </div>
      )}

      {ketQua?.ok === true && ketQua.kieu === "LEGACY" && (
        <p role="status" className="text-xs text-muted-foreground">
          Máy chủ không áp dụng phạm vi học cho đơn này — nếu thấy khối này, hãy tải lại trang trước khi tạo đơn.
        </p>
      )}

      {ketQua?.ok === true && ketQua.kieu === "SCOPE" && (
        <div className="space-y-2">
          <ul className="space-y-1 text-xs text-muted-foreground">
            {ketQua.dong.map((k, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="min-w-0">
                  {dong[i]?.ten || `Dòng ${i + 1}`} · {k.soBuoi} buổi · niêm yết{" "}
                  <span className="tabular-nums">{vnd(k.niemYet)}</span>, giảm {k.phanTramApDung}%
                </span>
                <b className="font-semibold tabular-nums text-foreground">{vnd(k.thanhTien)}</b>
              </li>
            ))}
          </ul>
          {lech ? (
            <div className="rounded-lg border border-state-warning-ink/30 bg-state-warning-soft p-3 text-xs leading-relaxed text-state-warning-ink">
              <p>Đơn giá đang nhập khác giá hệ thống tính — máy chủ sẽ từ chối nếu không khớp.</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onApGia}>
                Áp giá theo phạm vi học
              </Button>
            </div>
          ) : (
            <p className="text-xs text-state-success-ink">Đơn giá đã khớp giá hệ thống tính.</p>
          )}
        </div>
      )}
    </section>
  );
}
