"use client";

// app/(admin)/admin/nguon-hoa-hong/so/_components/nut-doi-ky-sau.tsx — nút "Dời sang kỳ sau" ở MỘT dòng hàng chờ (tab Sổ) + hộp thoại lý do.
//
// Component này KHÔNG tự xét hàng chờ nào dời được: trang chỉ vẽ nó khi `d.doiDuoc` (cùng hàm `lyDoKhongDoiDuoc` mà điều phối server kiểm — luật 12) VÀ người xem giữ
// `commission_periods:manage` (đúng key mà `doiHangChoSangKySauAction` kiểm). Server vẫn kiểm lại tất cả: bấm lén một hàng chờ không dời được bị từ chối ở đó.
//
// Hộp thoại nêu HỆ QUẢ trước khi bấm: hàng chờ KHÔNG bị xoá, không sinh dòng sổ — chỉ thôi chặn kỳ hiện tại và chặn kỳ kế tiếp. Lý do ≥ LY_DO_TOI_THIEU ký tự (ghi nhật ký kiểm toán).
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarClock, Loader2 } from "lucide-react";

import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, TEXTAREA } from "@/components/admin/nguon-hoa-hong/classes";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { kyHienThi } from "@/lib/hoa-hong/dinh-dang";
import { LY_DO_TOI_THIEU } from "@/lib/hoa-hong/kieu";
import { cn } from "@/lib/utils";

import { doiHangChoSangKySauAction } from "../../ky/_actions";

/** Nút nhỏ trong ô bảng (cao 32px) — nút 36px của `BTN_OUTLINE` làm dòng bảng cao hơn dòng không có nút. */
const NUT_NHO =
  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

export function NutDoiKySau({ holdId, tenMa, kyChan }: { holdId: string; tenMa: string; kyChan: string | null }) {
  const router = useRouter();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [dang, batDau] = useTransition();
  const id = useId();
  const kyNhan = kyChan ? kyHienThi(kyChan) : null;
  const du = lyDo.trim().length >= LY_DO_TOI_THIEU;

  const dong = () => {
    if (dang) return;
    setMo(false);
    setLyDo("");
    setLoi(null);
  };
  const gui = () => {
    setLoi(null);
    batDau(async () => {
      const r = await doiHangChoSangKySauAction({ holdId, lyDo });
      if (r.ok) {
        toast.success(r.thongBao);
        setMo(false);
        setLyDo("");
        router.refresh();
      } else setLoi(r.loi);
    });
  };

  return (
    <>
      <button type="button" data-doi-ky-sau={holdId} className={NUT_NHO} onClick={() => setMo(true)}>
        <CalendarClock aria-hidden className="h-3.5 w-3.5" />
        Dời sang kỳ sau
      </button>
      <Dialog open={mo} onOpenChange={(o) => !o && dong()}>
        <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Dời hàng chờ “{tenMa}” sang kỳ sau?</DialogTitle>
            <DialogDescription>
              {kyNhan ? `Hàng chờ thôi chặn khoá kỳ ${kyNhan} và chuyển sang chặn kỳ kế tiếp của cùng cơ sở` : "Hàng chờ chuyển sang chặn kỳ kế tiếp của cùng cơ sở"}. Không xoá hàng chờ, không sinh dòng sổ nào — khi giải xong ở kỳ sau,
              dòng hoa hồng sinh ra vào kỳ đang mở lúc đó.
            </DialogDescription>
          </DialogHeader>
          <div>
            <label htmlFor={`${id}-ly-do`} className={NHAN_O}>
              Lý do dời <span className="text-state-danger-ink">*</span>
            </label>
            <textarea
              id={`${id}-ly-do`}
              value={lyDo}
              onChange={(e) => setLyDo(e.target.value)}
              rows={2}
              maxLength={1000}
              aria-invalid={loi ? true : undefined}
              aria-describedby={`${id}-ghi-chu`}
              placeholder="vd: chờ văn bản quy định của BGĐ, chưa kịp ban hành"
              className={TEXTAREA}
            />
            <p id={`${id}-ghi-chu`} className={cn("mt-1 text-xs", !du && lyDo.length > 0 ? "text-state-danger-ink" : "text-muted-foreground")}>
              Từ {LY_DO_TOI_THIEU} ký tự — ghi vào nhật ký kiểm toán.
            </p>
            {loi && (
              <p role="alert" className={LOI_O}>
                {loi}
              </p>
            )}
          </div>
          <DialogFooter>
            <button type="button" className={BTN_OUTLINE} disabled={dang} onClick={dong}>
              Quay lại
            </button>
            <button type="button" data-xac-nhan="DOI_KY_SAU" className={BTN_PRIMARY} disabled={dang || !du} onClick={gui}>
              {dang && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              Dời sang kỳ sau
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
