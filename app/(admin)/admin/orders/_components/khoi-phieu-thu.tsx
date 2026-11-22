import { Download, FileText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/**
 * Khối «Phiếu thu» ở trang chi tiết đơn (12/11/2026) — đặt NGAY TRÊN khối «Hoá đơn điện tử».
 *
 * Người đọc là SALE: câu họ hỏi là «khách đóng tiền rồi, tôi lấy tờ xác nhận ở đâu để gửi phụ huynh (Zalo)». Mỗi lần thu đã được
 * kế toán xác nhận (có số phiếu) là một dòng + một nút tải PDF. Lần thu CHƯA xác nhận không có phiếu — nói rõ lý do thay vì ẩn đi,
 * để Sale không tưởng hệ thống mất khoản.
 *
 * Cố ý KHÔNG vẽ khi đơn chưa có lần thu nào (khối rỗng là nhiễu). Danh sách, không bảng: cột phải hẹp — bảng 4 cột là cuộn ngang.
 * Server component: chỉ link tải; quyền và cách ly cơ sở do route kiểm (`orders/[id]/phieu-thu/[paymentId]/route.ts`).
 */

export type DongPhieuThu = {
  paymentId: string;
  soTien: number;
  /** dd/mm/yyyy theo lịch VN — ngày thu. */
  ngayThu: string;
  /** Số phiếu (RCP-…) — `null` = kế toán chưa xác nhận. */
  maPhieu: string | null;
};

const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

export function KhoiPhieuThu({ orderId, dong }: { orderId: string; dong: readonly DongPhieuThu[] }) {
  if (dong.length === 0) return null;
  const coPhieu = dong.filter((d) => d.maPhieu).length;
  return (
    <section
      id="phieu-thu"
      aria-labelledby="phieu-thu-tieu-de"
      className="scroll-mt-4 rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="phieu-thu-tieu-de" className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <FileText aria-hidden className="h-4 w-4" />
          Phiếu thu
        </h2>
        <p className="text-xs tabular-nums text-muted-foreground">
          {coPhieu}/{dong.length} lần thu đã có phiếu
        </p>
      </div>
      <ul className="divide-y divide-border">
        {dong.map((d) => (
          <li key={d.paymentId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-sm font-semibold tabular-nums text-foreground">{tien(d.soTien)}</p>
              <p className="break-words text-xs text-muted-foreground">
                Thu {d.ngayThu}
                {d.maPhieu ? ` · Số ${d.maPhieu}` : ""}
              </p>
            </div>
            {d.maPhieu ? (
              <a
                href={`/orders/${orderId}/phieu-thu/${d.paymentId}`}
                target="_blank"
                rel="noopener"
                aria-label={`Tải PDF phiếu thu ${d.maPhieu}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Download aria-hidden /> Tải PDF
              </a>
            ) : (
              <p className="text-xs text-state-warning-ink">Chờ kế toán xác nhận — chưa có phiếu</p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Phiếu thu xác nhận đã nhận tiền, đứng tên pháp nhân của cơ sở thu. Không phải hoá đơn GTGT.
      </p>
    </section>
  );
}
