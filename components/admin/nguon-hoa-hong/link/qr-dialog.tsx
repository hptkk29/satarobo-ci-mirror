"use client";

// components/admin/nguon-hoa-hong/link/qr-dialog.tsx — hộp thoại hiện MÃ QR của một link + nút «Tải về (SVG)».
//
// QR được dựng Ở MÁY CHỦ (`taoQrAction`, gác `affiliate_links:manage`) khi người dùng bấm «QR» — thư viện `qrcode` không vào bundle trình duyệt, và token đầy đủ không nằm sẵn trong props của
// người chỉ xem. Hình hiện bằng <img src="data:image/svg+xml;base64,…"> (KHÔNG `dangerouslySetInnerHTML`); «Tải về» là thẻ <a download> trỏ cùng data-URI. Nội dung QR là địa chỉ NGẮN
// `<gốc cấu hình>/r/<mã>` (hiện bên dưới để người in biết quét ra gì) — không có thông tin cá nhân.
import { Download, Loader2, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, NUT_CHAN } from "../classes";

export type KetQuaQrGiaoDien = { ok: true; dataUri: string; tenTep: string; lienKetNgan: string } | { ok: false; loi: string; truong?: string };

/** `kq === null` = đang dựng. Nơi gọi (bảng) gọi `taoQr` trong trình xử lý bấm nút — không dùng effect để tải dữ liệu. */
export function QrDialog({ tenDoiTac, kq, dong }: { tenDoiTac: string; kq: KetQuaQrGiaoDien | null; dong: () => void }) {
  return (
    <Dialog open onOpenChange={(m) => !m && dong()}>
      <DialogContent showCloseButton={false} className="admin-scope sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Mã QR giới thiệu</DialogTitle>
          <DialogDescription>{tenDoiTac}</DialogDescription>
        </DialogHeader>

        {kq === null && (
          <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            Đang dựng mã QR…
          </div>
        )}
        {kq !== null && !kq.ok && (
          <div role="alert" className="flex items-start gap-3 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
            <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">{kq.loi}</p>
          </div>
        )}
        {kq !== null && kq.ok && (
          <div className="space-y-3">
            <img src={kq.dataUri} alt={`Mã QR giới thiệu của ${tenDoiTac}`} className="mx-auto h-56 w-56 rounded-lg border border-border bg-white p-2" />
            <p className="break-all text-center font-mono text-xs text-muted-foreground">{kq.lienKetNgan}</p>
          </div>
        )}

        <DialogFooter>
          <button type="button" onClick={dong} className={cn(BTN_OUTLINE, NUT_CHAN)}>
            Đóng
          </button>
          {kq !== null && kq.ok && (
            <a href={kq.dataUri} download={kq.tenTep} className={cn(BTN_PRIMARY, NUT_CHAN)}>
              <Download aria-hidden className="h-4 w-4" />
              Tải về (SVG)
            </a>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
