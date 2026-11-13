import { NoiDungTrong } from "@/components/portal/sticker";
import { Download, Eye, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HoaDonHienThi } from "@/lib/portal/hoa-don-phu-huynh-thuan";
import { vnd } from "@/lib/portal/tong-quan-thuan";

// Cổng phụ huynh — mục «Hoá đơn» của trang Học phí (03/11/2026). Trang cha CHỈ vẽ mục này khi phụ huynh CÓ NHU CẦU hoá đơn (đã khai
// người mua — `docMucHoaDon`); không nhu cầu ⇒ không vẽ gì, kể cả trạng thái rỗng. Chỉ vẽ hoá đơn kế toán ĐÃ XUẤT (đã chốt, còn hiệu lực,
// không phải bản mô phỏng) — việc lọc nằm ở `lib/portal/hoa-don-phu-huynh-thuan.ts`, component này KHÔNG tự lọc.
// Nút tải là liên kết thật tới `/portal/hoa-don/<id>/tai-ve` (route kiểm sở hữu + ghi nhật ký). Không có tệp ⇒ không vẽ nút.

const CARD = "rounded-[18px] border border-border bg-card";
const NUT_TAI =
  "inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-[13px] font-semibold text-[var(--sr-purple-text)] transition-colors hover:bg-[var(--sr-tint-purple)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-purple-text)]";

export function HoaDonPhuHuynh({ items }: { items: HoaDonHienThi[] }) {
  return (
    <section id="hoa-don" aria-labelledby="hoa-don-tieu-de" className="flex scroll-mt-20 flex-col gap-3">
      <h2 id="hoa-don-tieu-de" className="text-xl font-bold">
        Hoá đơn
      </h2>
      {items.length === 0 ? (
        <NoiDungTrong ten="may-tinh" className="rounded-[18px] border-2 border-dashed border-border px-5 py-6 text-sm text-[var(--sr-ink-muted)]">
          Hoá đơn sẽ hiện ở đây khi hệ thống xuất xong.
        </NoiDungTrong>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((h) => (
            <li key={h.id} className={cn(CARD, "flex flex-wrap items-center gap-x-5 gap-y-3 p-4 min-[560px]:p-5")}>
              <span
                aria-hidden="true"
                className="flex size-10 flex-none items-center justify-center rounded-full bg-[var(--sr-tint-purple)] text-[var(--sr-purple-text)]"
              >
                <FileText className="size-5" />
              </span>
              <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
                <div className="text-[15px] font-bold">{h.tieuDe}</div>
                {h.phu ? <div className="text-xs text-[var(--sr-ink-muted)]">{h.phu}</div> : null}
                {h.khoa ? <div className="text-xs text-[var(--sr-ink-muted)]">{h.khoa}</div> : null}
              </div>
              <div className="flex flex-none flex-col items-start gap-2 min-[560px]:items-end">
                <div className="text-base font-bold">{vnd(h.tongTien)}</div>
                {h.hrefPdf || h.hrefXml ? (
                  <div className="flex flex-wrap gap-2">
                    {h.hrefXemPdf ? (
                      <a href={h.hrefXemPdf} target="_blank" rel="noopener noreferrer" className={NUT_TAI}>
                        <Eye className="size-4" aria-hidden="true" />
                        Xem
                      </a>
                    ) : null}
                    {h.hrefPdf ? (
                      <a href={h.hrefPdf} className={NUT_TAI}>
                        <Download className="size-4" aria-hidden="true" />
                        Tải về
                      </a>
                    ) : null}
                    {h.hrefXml ? (
                      <a href={h.hrefXml} className={NUT_TAI}>
                        <Download className="size-4" aria-hidden="true" />
                        Tải XML
                      </a>
                    ) : null}
                  </div>
                ) : h.tepDangChuanBi ? (
                  <div className="text-xs text-[var(--sr-ink-muted)]">Tệp hoá đơn đang được chuẩn bị — vui lòng quay lại sau.</div>
                ) : (
                  <div className="text-xs text-[var(--sr-ink-muted)]">Chưa có tệp để tải.</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
