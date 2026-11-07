import { Download, FileText } from "lucide-react";
import type { KhoiPhanPhoiPhuHuynh } from "@/lib/finance/hoa-don/phan-phoi-db";

/**
 * «Hoá đơn điện tử» dưới học phí của CON ĐANG XEM (Invoice Hub S10, chỉ đọc).
 *
 * Phụ huynh chỉ thấy hoá đơn đã được trung tâm phát hành và có bản PDF để tải — không có bản nháp, bản đã thay, hay bản thử.
 * Dữ liệu đã dựng + kiểm sở hữu ở server (`docHoaDonChoPhuHuynh`); component này không tự lấy gì, không mang mã học viên hay tên con.
 * Cờ của cơ sở TẮT và chưa có hoá đơn nào ⇒ không vẽ gì (như chưa từng có). Giữ phong cách `portal-v2`: thẻ bo tròn, chữ nhỏ, vùng bấm ≥ 44px.
 */

function vnd(n: number): string {
  return n.toLocaleString("vi-VN") + " đ";
}

export function HoaDonDienTuPhuHuynh({ khoi }: { khoi: KhoiPhanPhoiPhuHuynh }) {
  if (!khoi.bat && khoi.dong.length === 0) return null;
  return (
    <section id="hoa-don-dien-tu" aria-labelledby="hoa-don-dien-tu-tieu-de" className="portal-v2 mx-auto w-full max-w-6xl space-y-3">
      <h2 id="hoa-don-dien-tu-tieu-de" className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
        <FileText className="size-4 text-primary" aria-hidden /> Hoá đơn điện tử
      </h2>
      <div className="divide-y divide-border rounded-2xl border border-border bg-card">
        {khoi.dong.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Chưa có hoá đơn điện tử nào. Hoá đơn sẽ hiện ở đây sau khi trung tâm phát hành cho khoản học phí đã thanh toán.
          </p>
        ) : (
          khoi.dong.map((d) => (
            <div key={d.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-bold text-foreground">{d.tieuDe}</p>
                <p className="mt-0.5 break-words text-xs font-medium text-muted-foreground">
                  {[d.kyHieu ? `Ký hiệu ${d.kyHieu}` : null, d.ngayLabel ? `Ngày ${d.ngayLabel}` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              <p className="shrink-0 text-sm font-bold tabular-nums text-foreground">{vnd(d.soTien)}</p>
              <a
                href={d.taiPdf}
                target="_blank"
                rel="noopener"
                aria-label={`Tải PDF ${d.tieuDe}`}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border px-4 text-sm font-bold text-primary hover:bg-muted"
              >
                <Download className="size-4" aria-hidden /> Tải PDF
              </a>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
