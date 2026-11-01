// components/admin/nguon-hoa-hong/hang-rao-bar.tsx — THANH HÀNG RÀO (06 §5.2, PRD §73): danh sách kiểm cố định cạnh form, mỗi dòng
// ✓/✕/– kèm LÝ DO. Trình bày thuần: dữ liệu đến từ `dungHangRao` (lib/hoa-hong/hang-rao-ui.ts), kết quả thật từ MÁY CHỦ.
//
// Ba trạng thái dòng, mỗi trạng thái có CHỮ cho trình đọc màn hình (màu không phải nghĩa duy nhất):
//   · đạt ✓ (success)  · chưa đạt ✕ (danger, kèm lý do nguyên văn từ máy chủ)  · chưa kiểm – (muted).
// "Chưa kiểm" KHÔNG bao giờ vẽ như đạt: chưa lưu nháp thì máy chủ chưa kiểm gì, và dòng ✓ ở đó là lời hứa suông.
// Không có trạng thái "đang tải" riêng: nút Kiểm lại có `pending`, danh sách giữ kết quả cũ cho đến khi có kết quả mới.
import { CircleCheck, CircleX, Minus, RefreshCw, TriangleAlert } from "lucide-react";

import type { DongHangRao, HangRao } from "@/lib/hoa-hong/hang-rao-ui";
import { cn } from "@/lib/utils";

import { BTN_OUTLINE } from "./classes";
import { KhoiVuotTran } from "./khoi-vuot-tran";

function Icon({ d }: { d: DongHangRao }) {
  if (d.trangThai === "dat") return <CircleCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-state-success-ink" />;
  if (d.trangThai === "khong-dat") return <CircleX aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-state-danger-ink" />;
  return <Minus aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
}

const CHU_TRANG_THAI: Record<DongHangRao["trangThai"], string> = {
  dat: "đạt",
  "khong-dat": "chưa đạt",
  "chua-kiem": "chưa kiểm",
};

export function HangRaoBar({
  hangRao,
  coQuyenSuaTran,
  onKiemLai,
  dangKiem,
  moTaChuaKiem,
  className,
}: {
  hangRao: HangRao;
  /**
   * Người xem có quyền SỬA ô «Trần tổng hoa hồng» (`settings:edit`) không — quyết liên kết «Mở Cấu hình vận hành» ở dòng trần. BẮT BUỘC, không mặc định (luật 7): mặc định nào cũng sai
   * chiều (true mời người không có quyền bấm vào màn từ chối; false giấu lối ra của admin).
   */
  coQuyenSuaTran: boolean;
  /** Không truyền ⇒ không vẽ nút Kiểm lại (vd trang chi tiết chỉ đọc). */
  onKiemLai?: () => void;
  dangKiem?: boolean;
  /** Dòng nói VÌ SAO chưa kiểm ("Lưu nháp để máy chủ kiểm…"). */
  moTaChuaKiem?: string;
  className?: string;
}) {
  const khongDat = hangRao.dong.filter((d) => d.trangThai === "khong-dat").length;
  const dat = hangRao.dong.filter((d) => d.trangThai === "dat").length;
  return (
    <aside aria-label="Điều kiện kích hoạt" className={cn("rounded-xl border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Điều kiện kích hoạt</h2>
        {hangRao.chuaKiem ? (
          <span className="text-xs font-medium text-muted-foreground">Chưa kiểm</span>
        ) : (
          <span
            className={cn("text-xs font-semibold tabular-nums", khongDat > 0 ? "text-state-danger-ink" : "text-state-success-ink")}
            aria-label={khongDat > 0 ? `${khongDat} điều kiện chưa đạt` : "Đạt mọi điều kiện"}
          >
            {khongDat > 0 ? `${khongDat} chưa đạt` : `Đạt ${dat}/${hangRao.dong.length}`}
          </span>
        )}
      </div>

      {hangRao.chuaKiem && moTaChuaKiem && <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">{moTaChuaKiem}</p>}

      <ul className="divide-y divide-border/60">
        {hangRao.dong.map((d) => (
          <li key={d.ma} className="flex gap-2.5 px-4 py-2.5">
            <Icon d={d} />
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm", d.trangThai === "khong-dat" ? "font-medium text-foreground" : "text-foreground")}>
                {d.nhan}
                <span className="sr-only"> — {CHU_TRANG_THAI[d.trangThai]}</span>
              </p>
              {d.huongXuLy ? (
                <>
                  <KhoiVuotTran huongXuLy={d.huongXuLy} coQuyenSuaTran={coQuyenSuaTran} className="mt-2" />
                  {/* Lý do nguyên văn của máy chủ (ngữ cảnh nào vượt) giữ lại nhưng gập: ba con số và lối ra đã nằm ở khối trên. */}
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Chi tiết các ngữ cảnh vượt</summary>
                    {d.lyDo.map((l, i) => (
                      <p key={i} className="mt-1 break-words text-state-danger-ink">
                        {l}
                      </p>
                    ))}
                  </details>
                </>
              ) : (
                d.lyDo.map((l, i) => (
                  <p key={i} className="mt-1 break-words text-xs text-state-danger-ink">
                    {l}
                  </p>
                ))
              )}
              {d.ghiChu && <p className="mt-0.5 text-xs text-muted-foreground">{d.ghiChu}</p>}
            </div>
          </li>
        ))}
      </ul>

      {hangRao.canhBao.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-state-warning-ink">
            <TriangleAlert aria-hidden className="h-4 w-4 shrink-0" />
            Cảnh báo — cần xác nhận khi kích hoạt
          </p>
          {hangRao.canhBao.map((c) => (
            <p key={c.ma + c.thongBao} className="mt-1 break-words text-xs text-foreground">
              {c.thongBao}
            </p>
          ))}
        </div>
      )}

      {onKiemLai && (
        <div className="border-t border-border px-4 py-3">
          <button type="button" onClick={onKiemLai} disabled={dangKiem} className={cn(BTN_OUTLINE, "w-full justify-center")}>
            <RefreshCw aria-hidden className={cn("h-4 w-4", dangKiem && "animate-spin")} />
            {dangKiem ? "Đang kiểm…" : "Kiểm lại"}
          </button>
        </div>
      )}
    </aside>
  );
}
