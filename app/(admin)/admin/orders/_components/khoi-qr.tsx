"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Maximize2, QrCode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { KhoiYeuCauNguoiMua } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-doc-db";
import { capLaiYeuCauNguoiMuaAction, huyYeuCauNguoiMuaAction, taoYeuCauNguoiMuaAction } from "../_actions-nguoi-mua";
import { NutXuatLien } from "./nut-xuat-lien";

// Dải «Mã QR cho phụ huynh tự điền» NẰM TRONG thẻ «Người mua trên hoá đơn» (Invoice Hub, chủ dự án chốt 03/11/2026: «gộp hai thẻ vì trùng chức năng»).
//
// Trước đây đây là một thẻ riêng («Thông tin người mua qua mã QR») có bảng ô riêng + nút «Áp dụng vào đơn» + nút «Nhập thay phụ huynh». NAY:
//  · phụ huynh gửi xong là dữ liệu vào ĐƠN ngay (ai ghi sau thì thắng) ⇒ không còn bảng ô riêng và không còn bước «Áp dụng»; thẻ cha hiện các ô, dải này chỉ lo CÁI MÃ + TRẠNG THÁI;
//  · nút «Nhập thay PH» / «Sửa» là MỘT nút ở đầu thẻ cha (mở hộp thoại «Người mua trên hoá đơn») — không nằm ở đây.
// Chỉ được vẽ khi cờ theo cơ sở bật VÀ người xem trong phạm vi xử lý yêu cầu: trang quyết định, `yeuCau === undefined` ⇒ thẻ cha không vẽ dải này.
// Mã QR / liên kết CHỈ hiện ngay sau khi tạo (token thô không được lưu ở đâu cả); tải lại trang thì chỉ còn trạng thái — muốn mã mới thì «Cấp lại».

type Moi = { id: string; lienKet: string; qr: string; hetHanLuc: string };

const gio = (iso: string) => new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });

/** Nhãn trạng thái ở đầu dải — MỘT nơi quyết định, để chữ và nút không lệch nhau. */
export function nhanTrangThaiQr(y: KhoiYeuCauNguoiMua | null): string {
  if (!y) return "Chưa tạo mã";
  if (y.trangThai === "DANG_MO") return y.guiLuc ? "Phụ huynh đã gửi" : y.linkHetHan ? "Mã đã hết hạn" : "Đang chờ phụ huynh";
  if (y.trangThai === "DA_AP_DUNG") return "Đã xuất / đã đóng";
  if (y.trangThai === "THU_HOI") return "Đã thu hồi";
  return "Đã hết hạn";
}

export function KhoiQr({ orderId, yeuCau }: { orderId: string; yeuCau: KhoiYeuCauNguoiMua | null }) {
  const [dangChay, chay] = useTransition();
  const [moi, setMoi] = useState<Moi | null>(null);
  const [phongTo, setPhongTo] = useState(false);

  const dangMo = yeuCau?.trangThai === "DANG_MO";

  function tao() {
    chay(async () => {
      const r = await taoYeuCauNguoiMuaAction(orderId);
      if (r.ok) setMoi({ id: r.id, lienKet: r.lienKet, qr: r.qr, hetHanLuc: r.hetHanLuc });
      else toast.error(r.error);
    });
  }
  function capLai() {
    if (!yeuCau) return;
    chay(async () => {
      const r = await capLaiYeuCauNguoiMuaAction(orderId, yeuCau.id);
      if (r.ok) {
        setMoi({ id: r.id, lienKet: r.lienKet, qr: r.qr, hetHanLuc: r.hetHanLuc });
        toast.success("Đã cấp mã mới — mã cũ không còn dùng được");
      } else toast.error(r.error);
    });
  }
  function huy() {
    if (!yeuCau) return;
    chay(async () => {
      const r = await huyYeuCauNguoiMuaAction(orderId, yeuCau.id, "Nhân viên thu hồi mã QR");
      if (r.ok) {
        setMoi(null);
        setPhongTo(false);
        toast.success("Đã thu hồi mã QR");
      } else toast.error(r.error);
    });
  }
  async function saoChep(s: string) {
    try {
      await navigator.clipboard.writeText(s);
      toast.success("Đã sao chép liên kết");
    } catch {
      toast.error("Không sao chép được — thử lại hoặc bấm «Phóng to» để phụ huynh quét mã");
    }
  }

  return (
    <div className="@container mt-4 space-y-3 border-t border-border pt-3" aria-label="Mã QR cho phụ huynh tự điền">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <QrCode className="h-4 w-4" aria-hidden />
          Mã QR cho phụ huynh tự điền
        </h3>
        <Badge variant="outline" className="whitespace-nowrap font-normal">
          {nhanTrangThaiQr(yeuCau)}
        </Badge>
      </div>

      {moi && (
        <div className="grid gap-4 rounded-lg border border-state-warning/40 bg-state-warning-soft p-3 @md:grid-cols-[auto_1fr]">
          <img src={moi.qr} alt="Mã QR để phụ huynh mở biểu mẫu thông tin người mua" className="mx-auto h-44 w-44 rounded bg-white p-1 @md:mx-0" />
          <div className="min-w-0 space-y-3 text-sm">
            <p className="font-medium text-state-warning-ink">Mã chỉ hiện lần này — tải lại trang sẽ không xem lại được. Hết hạn lúc {gio(moi.hetHanLuc)}.</p>
            <div className="flex flex-col gap-2 @md:flex-row @md:flex-wrap @md:items-center">
              <Button type="button" size="sm" onClick={() => setPhongTo(true)}>
                <Maximize2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Phóng to để phụ huynh quét
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => saoChep(moi.lienKet)}>
                <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Sao chép liên kết
              </Button>
            </div>
          </div>
        </div>
      )}

      {moi && (
        <Dialog open={phongTo} onOpenChange={setPhongTo}>
          <DialogContent className="max-w-[min(94vw,32rem)]">
            <DialogHeader>
              <DialogTitle>Đưa mã này cho phụ huynh quét</DialogTitle>
            </DialogHeader>
            <img src={moi.qr} alt="Mã QR phóng to để phụ huynh quét bằng điện thoại" className="mx-auto aspect-square w-full max-w-[min(80vw,26rem)] rounded-lg bg-white p-3" />
            <p className="text-center text-sm text-muted-foreground">Mở camera điện thoại và hướng vào mã. Mã hết hạn lúc {gio(moi.hetHanLuc)}.</p>
          </DialogContent>
        </Dialog>
      )}

      {!yeuCau || !dangMo ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            {yeuCau?.trangThai === "DA_AP_DUNG"
              ? "Thông tin phụ huynh gửi đã vào đơn và mã đã đóng."
              : yeuCau
                ? "Mã trước không còn dùng được."
                : "Chưa tạo mã. Phần lớn phụ huynh không xin hoá đơn — chỉ tạo khi có yêu cầu."}
          </p>
          <Button type="button" size="sm" onClick={tao} disabled={dangChay}>
            {yeuCau ? "Tạo mã mới" : "Tạo mã QR cho phụ huynh"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground" role="status">
            {yeuCau.guiLuc
              ? `Phụ huynh gửi lúc ${gio(yeuCau.guiLuc)} — thông tin đã vào các ô phía trên. ${yeuCau.linkHetHan ? "Mã đã hết hạn." : "Phụ huynh gửi lại được tới khi mã hết hạn; lần gửi sau ghi đè lần trước."}`
              : yeuCau.linkHetHan
                ? "Mã đã hết hạn — phụ huynh chưa gửi gì. Cấp lại mã nếu cần."
                : `Đang chờ phụ huynh quét mã (hết hạn lúc ${gio(yeuCau.hetHanLuc)}). Chưa gửi thì các ô phía trên lấy từ hồ sơ.`}
          </p>
          {/* [09/11/2026 — BGĐ đổi] Hai đường: «Xuất liền» (Sale bấm, sau khi đối chiếu với phụ huynh) hoặc đi cùng lô cuối ngày 23h30. KHÔNG còn «tự xuất sau n giờ». */}
          {yeuCau.coTheXuatLien && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3" data-testid="xuat-hoa-don">
              <p className="text-sm text-foreground">
                {yeuCau.xuatLoLuc ? (
                  <>
                    Phụ huynh chưa cần liền: hoá đơn sẽ được xuất cùng lô cuối ngày lúc <span className="font-semibold" data-testid="xuat-lo-luc">{gio(yeuCau.xuatLoLuc)}</span> (nếu tiền đã được kế toán xác nhận). Còn thời gian để đối chiếu và sửa thông tin.
                  </>
                ) : (
                  <>Phụ huynh chưa cần liền: hoá đơn sẽ đi cùng lô cuối ngày 23h30 khi lô được bật.</>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <NutXuatLien orderId={orderId} />
                <span className="text-xs text-muted-foreground">Chỉ bấm khi phụ huynh cần hoá đơn ngay — bạn sẽ đối chiếu thông tin trước khi xuất.</span>
              </div>
            </div>
          )}
          {yeuCau.dangKhoa && <p className="text-sm text-state-warning-ink">Mã đang tạm khoá do nhập sai nhiều lần. Có thể cấp lại mã mới.</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={capLai} disabled={dangChay}>
              Cấp lại mã
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={huy} disabled={dangChay}>
              Thu hồi
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
