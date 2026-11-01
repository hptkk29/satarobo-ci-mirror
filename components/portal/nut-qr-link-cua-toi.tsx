"use client";

// components/portal/nut-qr-link-cua-toi.tsx — nút «Mã QR» của một link CỦA CHÍNH đối tác (AFF-WEB).
//
// QR dựng Ở MÁY CHỦ khi BẤM (`taoQrCuaToiAction`): thư viện `qrcode` không vào bundle trình duyệt, và máy chủ tự kiểm link thuộc đối tác đang đăng nhập (id gửi lên chỉ là chỉ dẫn, không phải quyền).
// Hình hiện bằng <img src="data:image/svg+xml;base64,…"> (KHÔNG `dangerouslySetInnerHTML`); «Tải về» là thẻ <a download> trỏ cùng data-URI. Không dùng effect để tải dữ liệu.
// Hàm gọi máy chủ được TIÊM (`taoQr`) cho test.
import { useState } from "react";
import { Download, Loader2, QrCode, TriangleAlert } from "lucide-react";

import { taoQrCuaToiAction, type KetQuaQrCuaToi } from "@/app/(portal)/portal/gioi-thieu/_actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type TaoQr = (i: { id: string }) => Promise<KetQuaQrCuaToi>;
const TAO_QR_MAC_DINH: TaoQr = (i) => taoQrCuaToiAction(i);

const NUT =
  "inline-flex h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:h-9";

export function NutQrLinkCuaToi({ id, nhan, taoQr = TAO_QR_MAC_DINH }: { id: string; nhan: string; taoQr?: TaoQr }) {
  const [mo, setMo] = useState(false);
  const [kq, setKq] = useState<KetQuaQrCuaToi | null>(null);

  async function bam() {
    setMo(true);
    setKq(null);
    let r: KetQuaQrCuaToi;
    try {
      r = await taoQr({ id });
    } catch {
      r = { ok: false, loi: "Không dựng được QR lúc này. Thử lại sau ít giây." };
    }
    setKq(r);
  }

  return (
    <>
      <button type="button" onClick={() => void bam()} aria-label={`Xem mã QR của ${nhan}`} className={NUT}>
        <QrCode aria-hidden className="size-4" />
        Mã QR
      </button>
      {mo && (
        <Dialog open onOpenChange={(m) => !m && setMo(false)}>
          <DialogContent showCloseButton={false} className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Mã QR giới thiệu</DialogTitle>
              <DialogDescription>{nhan}</DialogDescription>
            </DialogHeader>
            {kq === null && (
              <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 aria-hidden className="size-4 animate-spin" />
                Đang dựng mã QR…
              </div>
            )}
            {kq !== null && !kq.ok && (
              <div role="alert" className="flex items-start gap-3 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <p className="min-w-0 flex-1">{kq.loi}</p>
              </div>
            )}
            {kq !== null && kq.ok && (
              <div className="space-y-3">
                <img src={kq.dataUri} alt={`Mã QR giới thiệu: ${nhan}`} className="mx-auto h-56 w-56 rounded-lg border border-border bg-white p-2" />
                <p className="break-all text-center font-mono text-xs text-muted-foreground">{kq.lienKetNgan}</p>
              </div>
            )}
            <DialogFooter>
              <button type="button" onClick={() => setMo(false)} className={NUT}>
                Đóng
              </button>
              {kq !== null && kq.ok && (
                <a href={kq.dataUri} download={kq.tenTep} className={NUT}>
                  <Download aria-hidden className="size-4" />
                  Tải về (SVG)
                </a>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
