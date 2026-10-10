// components/admin/nguon-hoa-hong/audit-timeline.tsx — DÒNG THỜI GIAN CHỈ ĐỌC của lịch sử (06 §5.5, §7 `AuditTimeline`).
//
// Dùng chung cho ba tab con (Đổi nguồn · Lịch sử chính sách · Nhật ký) và cho phần "Lịch sử" trong Sheet khiếu nại. Mỗi mục: AI · LÚC NÀO · làm gì · cũ → mới · lý do.
// KHÔNG có nút nào: không sửa, không xoá (lưới `[NHH-FRD-08]`: module không bao giờ ghi vào AuditLog).
//
// Hình: danh sách dọc, đường kẻ 1px bên trái nối các mục (không phải viền màu dày), mỗi mục một dòng tiêu đề + dòng người/giờ + các cặp đổi. Không thẻ lồng thẻ.
// Mục dài (lý do, cặp đổi) tự xuống dòng; tiêu đề thì cắt khi quá hẹp để dòng không nhảy chiều cao.
import { ngayGioVN } from "@/lib/hoa-hong/dinh-dang";
import { cn } from "@/lib/utils";

export type MucThoiGian = {
  id: string;
  luc: Date;
  /** Việc đã làm — "Đổi nguồn", "Quyết định". Đã là chữ người đọc được (không mã enum). */
  tieuDe: string;
  /** Đối tượng + mã ngắn ("Lead · A1B2C3"); bỏ trống khi cả dòng thời gian cùng nói về một đối tượng (Sheet). */
  doiTuong?: string;
  nguoi: string;
  thayDoi?: readonly { truong: string; cu: string; moi: string }[];
  lyDo?: string | null;
};

export function AuditTimeline({ muc, className }: { muc: readonly MucThoiGian[]; className?: string }) {
  return (
    <ol className={cn("relative ml-1.5 border-l border-foreground/25", className)} aria-label="Lịch sử">
      {muc.map((m) => (
        <li key={m.id} className="relative pb-4 pl-5 last:pb-0">
          {/* Chấm nối vào đường kẻ: 7px, đặc, đủ tương phản trên nền thẻ — là mốc thời gian, không phải trang trí (bản đầu cùng màu viền nên gần như vô hình). */}
          <span aria-hidden className="absolute -left-[4px] top-[7px] h-[7px] w-[7px] rounded-full bg-foreground/45" />
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-foreground">
            <span className="font-semibold">{m.tieuDe}</span>
            {m.doiTuong && <span className="text-muted-foreground">{m.doiTuong}</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {m.nguoi} · <time dateTime={m.luc.toISOString()}>{ngayGioVN(m.luc)}</time>
          </p>
          {m.thayDoi && m.thayDoi.length > 0 && (
            <dl className="mt-1.5 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
              {m.thayDoi.map((t) => (
                <div key={t.truong} className="contents">
                  <dt className="truncate text-muted-foreground" title={t.truong}>
                    {t.truong}
                  </dt>
                  <dd className="break-words text-foreground">
                    {/* Giá trị cũ rỗng (mục TẠO): in giá trị mới, không in "— → X". */}
                    {t.cu === "—" ? (
                      t.moi
                    ) : (
                      <>
                        <span className="text-muted-foreground">{t.cu}</span> <span aria-label="đổi thành">→</span> {t.moi}
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {m.lyDo && <p className="mt-1.5 break-words text-sm text-foreground">Lý do: {m.lyDo}</p>}
        </li>
      ))}
    </ol>
  );
}
