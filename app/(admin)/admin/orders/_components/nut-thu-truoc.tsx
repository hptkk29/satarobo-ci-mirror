"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HandCoins, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { SO_NGAY_HAN_CON_LAI_MAC_DINH } from "@/lib/orders/thu-truoc";
import { vnAddDays, vnYmd } from "@/lib/time/vn";
import { thuTruocAction } from "../_thu-truoc-actions";

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const hanMacDinh = () => vnYmd(vnAddDays(new Date(), SO_NGAY_HAN_CON_LAI_MAC_DINH));

/**
 * Nút "Thu trước (cọc)" trên trang đơn — xem `lib/orders/thu-truoc.ts` (quyết định 30/10/2026).
 *
 * `lyDoKhong` do MÁY CHỦ tính cùng hàm `lyDoKhongThuTruocDuoc` với cổng thật: khác `null` ⇒ nút KHOÁ và nói lý do
 * (luật 12 — không vẽ một nút chắc chắn bị từ chối). Prop BẮT BUỘC (luật 11): thiếu nó thì nút sáng ở đơn không thu trước được.
 */
export function NutThuTruoc({ orderId, tongDon, lyDoKhong }: { orderId: string; tongDon: number; lyDoKhong: string | null }) {
  const router = useRouter();
  const [mo, setMo] = useState(false);
  const [soTien, setSoTien] = useState<number | null>(null);
  const [hanConLai, setHanConLai] = useState<string>(hanMacDinh);
  const [dangLuu, batDau] = useTransition();

  const hopLe = soTien !== null && Number.isInteger(soTien) && soTien > 0 && soTien < tongDon && hanConLai !== "";
  const conLai = hopLe ? tongDon - soTien : null;

  function luu() {
    if (!hopLe || soTien === null) return;
    batDau(async () => {
      const kq = await thuTruocAction({ orderId, soTien, hanConLai });
      if (!kq.ok) {
        toast.error(kq.error);
        return;
      }
      toast.success(`Đã tạo phiếu thu trước ${vnd(kq.soTien)}. Xuất QR ở dòng «Đợt 1» trong bảng phiếu thu.`);
      setMo(false);
      setSoTien(null);
      setHanConLai(hanMacDinh());
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button type="button" size="sm" variant="outline" disabled={lyDoKhong !== null} onClick={() => setMo(true)} className="min-h-11 sm:min-h-9">
        <HandCoins className="mr-1.5 h-4 w-4" aria-hidden />
        Thu trước (cọc)
      </Button>
      {lyDoKhong !== null && <span className="min-w-0 text-xs text-muted-foreground">{lyDoKhong}</span>}

      <Dialog open={mo} onOpenChange={(v) => !dangLuu && setMo(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thu trước (cọc)</DialogTitle>
            <DialogDescription>
              Khách đóng trước một phần học phí. Hệ thống tách đơn thành hai phiếu thu: <b>cọc</b> đúng số này (xuất QR để khách quét) và <b>còn lại</b>.
              Cọc đến hạn hôm nay; phần còn lại có hạn đóng bên dưới (quá hạn thì hệ thống nhắc nợ như mọi khoản).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="thu-truoc-so-tien">Số tiền thu trước (đồng)</Label>
            <MoneyInput id="thu-truoc-so-tien" name="soTien" value={soTien} onValueChange={setSoTien} min={0} max={tongDon} suffix="đ" autoFocus />
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm tabular-nums">
              <dt className="text-muted-foreground">Tổng đơn</dt>
              <dd className="text-right font-medium">{vnd(tongDon)}</dd>
              <dt className="text-muted-foreground">Còn lại sau thu trước</dt>
              <dd className="text-right font-medium">{conLai !== null ? vnd(conLai) : "—"}</dd>
            </dl>
            <Label htmlFor="thu-truoc-han">Hạn đóng phần còn lại</Label>
            <Input id="thu-truoc-han" type="date" value={hanConLai} onChange={(e) => setHanConLai(e.target.value)} className="min-h-11 sm:min-h-9" />
            {soTien !== null && !(Number.isInteger(soTien) && soTien > 0 && soTien < tongDon) && (
              <p role="alert" className="text-xs text-state-danger-ink">
                Số tiền phải lớn hơn 0 và nhỏ hơn tổng đơn.
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setMo(false)} disabled={dangLuu}>
              Đóng
            </Button>
            <Button type="button" onClick={luu} disabled={!hopLe || dangLuu}>
              {dangLuu ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              Tạo phiếu thu trước
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
