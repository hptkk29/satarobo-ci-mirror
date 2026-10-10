// components/admin/nguon-hoa-hong/vi-sao-noi-dung.tsx — THÂN của ngăn "Vì sao con số này" (06 §2.3). Thuần trình bày, không state.
//
// Một danh sách định nghĩa (`<dl>`) DỌC theo thứ tự nhân quả: cột nhãn cố định 9rem, cột giá trị co giãn, số `tabular-nums`.
// Không biểu đồ, không thẻ. Dưới danh sách: điều chỉnh liên quan (gốc ↔ điều chỉnh, kỳ hiệu lực ≠ kỳ ghi sổ) và dòng thời gian.
//
// Tiền âm in '−' và tô danger-ink (cùng quy ước với bảng sổ). Ngày giờ theo giờ Việt Nam.
import { CornerDownRight, TriangleAlert } from "lucide-react";

import type { ViSaoDayDu } from "@/lib/hoa-hong/vi-sao-day-du";
import { ngayGioHienThi } from "@/lib/hoa-hong/vi-sao-day-du";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

export const TIEN_AM = "text-state-danger-ink";

export function TienDong({ soTien, className }: { soTien: number; className?: string }) {
  return <span className={cn("tabular-nums", soTien < 0 && TIEN_AM, className)}>{dinhDangDong(soTien)}</span>;
}

export function ViSaoNoiDung({
  du,
  dangXem,
  onXemDong,
}: {
  du: ViSaoDayDu;
  /** Dòng đang xem (để đánh dấu trong danh sách điều chỉnh). Không cần khi chỉ hiển thị. */
  dangXem?: string;
  /** Có ⇒ mỗi dòng liên quan khác dòng đang xem có nút "Xem dòng này". */
  onXemDong?: (id: string) => void;
}) {
  return (
    <div className="space-y-6 px-5 py-5">
      <div>
        <p className="text-xl font-semibold leading-tight">
          <TienDong soTien={du.tomTat.soTien} />
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{du.tieuDe}</p>
      </div>

      {du.canhBao.length > 0 && (
        <ul className="space-y-1.5 rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
          {du.canhBao.map((c) => (
            <li key={c} className="flex items-start gap-2">
              <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}

      <dl className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
        {du.muc.map((m) => (
          <div key={m.nhan} className="contents">
            <dt className="text-sm text-muted-foreground sm:pt-px">{m.nhan}</dt>
            <dd className="min-w-0 text-sm text-foreground">
              <span className="break-words font-medium tabular-nums">{m.giaTri}</span>
              {m.ghiChu && <span className="mt-0.5 block break-words text-xs text-muted-foreground">{m.ghiChu}</span>}
            </dd>
          </div>
        ))}
      </dl>

      {du.dieuChinh.length > 0 && (
        <section aria-labelledby="vs-dieu-chinh">
          <h3 id="vs-dieu-chinh" className="mb-2 border-t border-border pt-4 text-sm font-semibold">
            Điều chỉnh liên quan
          </h3>
          <ul className="space-y-2.5">
            {du.dieuChinh.map((d) => {
              const laDongNay = d.laDongNay || d.id === dangXem;
              return (
                <li key={d.id} className="text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-start gap-1.5">
                      {d.muiTen ? (
                        <CornerDownRight aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <span aria-hidden className="w-4 shrink-0" />
                      )}
                      <span className="min-w-0 break-words">
                        {d.nhan}
                        {laDongNay ? <span className="ml-1.5 text-xs text-muted-foreground">(đang xem)</span> : null}
                      </span>
                    </span>
                    <TienDong soTien={d.soTien} className="shrink-0 font-medium" />
                  </div>
                  <p className="ml-[1.375rem] text-xs text-muted-foreground">
                    {d.ky}
                    {d.lyDo ? ` · ${d.lyDo}` : ""}
                  </p>
                  {onXemDong && !laDongNay && (
                    <button
                      type="button"
                      onClick={() => onXemDong(d.id)}
                      className="ml-[1.375rem] mt-0.5 text-xs font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Xem dòng này
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="vs-thoi-gian">
        <h3 id="vs-thoi-gian" className="mb-2 border-t border-border pt-4 text-sm font-semibold">
          Dòng thời gian
        </h3>
        <ol className="space-y-2">
          {du.thoiGian.map((t, i) => (
            <li key={`${t.luc}-${i}`} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 text-sm">
              <span className="text-xs tabular-nums text-muted-foreground sm:pt-0.5">{ngayGioHienThi(t.luc)}</span>
              <span className="min-w-0 break-words">
                {t.nhan}
                {t.nguoi ? <span className="text-muted-foreground"> · {t.nguoi}</span> : null}
                {t.lyDo ? <span className="block text-xs text-muted-foreground">{t.lyDo}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
