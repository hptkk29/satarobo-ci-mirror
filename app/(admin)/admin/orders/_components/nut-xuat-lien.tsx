"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { XemTruocXuatLien } from "@/lib/finance/hoa-don/xuat-lien";
import { xemTruocXuatLienAction, xuatLienAction, type KetQuaXuatLienAction } from "../_actions-nguoi-mua";

// Nút «Xuất liền» của SALE (BGĐ đổi yêu cầu 09/11/2026) trong dải mã QR của trang đơn.
//
// Dùng khi phụ huynh ĐÃ gửi thông tin xuất hoá đơn và CẦN hoá đơn ngay: bấm ⇒ hộp «Đối chiếu trước khi xuất» liệt kê ĐẦY ĐỦ người mua, học viên, email nhận, từng lần thu và số tiền, để Sale đọc lại
// với phụ huynh. Chỉ khi Sale tick «đã đối chiếu» mới bấm «Xuất hoá đơn ngay» được. Hoá đơn đã phát hành KHÔNG xoá được — đó là lý do hộp này có mặt.
// Phụ huynh không cần liền thì KHÔNG bấm: hoá đơn đi cùng lô cuối ngày 23h30 (xem dòng chữ phía trên nút).
// Máy chủ dựng LẠI xem trước lúc xuất và so dấu: thông tin đổi giữa chừng ⇒ từ chối, Sale mở lại hộp (không xuất thứ Sale chưa thấy).

type Buoc = { kieu: "DONG" } | { kieu: "DANG_TAI" } | { kieu: "XEM"; xt: Extract<XemTruocXuatLien, { ok: true }> } | { kieu: "XONG"; kq: Extract<KetQuaXuatLienAction, { ok: true }> } | { kieu: "LOI"; thongDiep: string };

const vnd = (n: number) => `${n.toLocaleString("vi-VN")} đ`;
const ngay = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const giay = (ms: number) => (ms < 1000 ? "dưới 1 giây" : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} giây`);

export function NutXuatLien({ orderId, disabled = false }: { orderId: string; disabled?: boolean }) {
  const [buoc, setBuoc] = useState<Buoc>({ kieu: "DONG" });
  const [daDoiChieu, setDaDoiChieu] = useState(false);
  const [dangChay, chay] = useTransition();

  const mo = buoc.kieu !== "DONG";
  function dong() {
    if (dangChay) return; // đang gửi lên nhà cung cấp: không đóng giữa chừng (kết quả vẫn phải hiện)
    setBuoc({ kieu: "DONG" });
    setDaDoiChieu(false);
  }
  function xem() {
    setDaDoiChieu(false);
    setBuoc({ kieu: "DANG_TAI" });
    chay(async () => {
      const r = await xemTruocXuatLienAction(orderId);
      setBuoc(r.ok ? { kieu: "XEM", xt: r } : { kieu: "LOI", thongDiep: r.error });
    });
  }
  function xuat(xt: Extract<XemTruocXuatLien, { ok: true }>) {
    chay(async () => {
      const r = await xuatLienAction(orderId, xt.dauVan);
      if (r.ok) {
        setBuoc({ kieu: "XONG", kq: r });
        toast.success("Đã xuất hoá đơn");
      } else setBuoc({ kieu: "LOI", thongDiep: r.error });
    });
  }

  return (
    <>
      <Button type="button" size="sm" onClick={xem} disabled={disabled || dangChay}>
        <Zap className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        Xuất liền
      </Button>
      <Dialog open={mo} onOpenChange={(m) => !m && dong()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={!dangChay}>
          {buoc.kieu === "DANG_TAI" ? (
            <>
              <DialogHeader>
                <DialogTitle>Đang chuẩn bị hộp đối chiếu…</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground" role="status">Đang đọc thông tin người mua và các lần thu của đơn.</p>
            </>
          ) : null}

          {buoc.kieu === "LOI" ? (
            <>
              <DialogHeader>
                <DialogTitle>Chưa xuất liền được</DialogTitle>
                <DialogDescription>Chưa có hoá đơn nào được tạo.</DialogDescription>
              </DialogHeader>
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm font-medium text-destructive">
                {buoc.thongDiep}
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" className="h-11" onClick={dong}>
                  Đóng
                </Button>
                <Button type="button" className="h-11" onClick={xem}>
                  Thử lại
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {buoc.kieu === "XONG" ? (
            <>
              <DialogHeader>
                <DialogTitle>{buoc.kq.daXuat > 0 ? "Đã xuất hoá đơn" : "Đã gửi lên nhà cung cấp"}</DialogTitle>
                <DialogDescription>Xử lý trong {giay(buoc.kq.mili)}.</DialogDescription>
              </DialogHeader>
              <ul className="space-y-1.5 text-sm" role="status">
                {buoc.kq.daXuat > 0 ? <li>✔ {buoc.kq.daXuat} hoá đơn đã được xác nhận trên hệ thống.</li> : null}
                {buoc.kq.dangPhatHanh > 0 ? <li>⏳ {buoc.kq.dangPhatHanh} hoá đơn đang chờ nhà cung cấp / kế toán ký — kết quả hiện ở màn Hoá đơn điện tử.</li> : null}
                {buoc.kq.daXuat > 0 ? (
                  <li>{buoc.kq.guiNgay ? "✔ Đã gửi hoá đơn tới email phụ huynh." : "⏳ Hoá đơn đã xếp hàng gửi email phụ huynh; thư đi ở nhịp gửi kế tiếp (trong vài phút)."}</li>
                ) : null}
                {buoc.kq.ghiChu.map((g, i) => (
                  <li key={i} className="text-muted-foreground">
                    ⚠ {g}
                  </li>
                ))}
              </ul>
              <DialogFooter>
                <Button type="button" className="h-11" onClick={dong}>
                  Xong
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {buoc.kieu === "XEM" ? (
            <>
              <DialogHeader>
                <DialogTitle>Đối chiếu trước khi xuất</DialogTitle>
                <DialogDescription>Đọc lại từng dòng với phụ huynh. Hoá đơn đã phát hành không xoá được — sai là phải huỷ và xuất lại.</DialogDescription>
              </DialogHeader>
              <dl className="space-y-3 text-sm">
                <Muc nhan={buoc.xt.nguoiMua.tenDonVi ? "Đơn vị (người mua)" : "Người mua"} giaTri={buoc.xt.nguoiMua.tenDonVi ?? buoc.xt.nguoiMua.hoTen} />
                {buoc.xt.nguoiMua.tenDonVi ? <Muc nhan="Người liên hệ" giaTri={buoc.xt.nguoiMua.hoTen} /> : null}
                <Muc nhan="Mã số thuế" giaTri={buoc.xt.nguoiMua.maSoThue} />
                <Muc nhan="Số CCCD" giaTri={buoc.xt.nguoiMua.cccd} />
                <Muc nhan="Địa chỉ" giaTri={buoc.xt.nguoiMua.diaChi} />
                <Muc nhan="Điện thoại" giaTri={buoc.xt.nguoiMua.dienThoai} />
                <Muc nhan="Mã khách hàng" giaTri={buoc.xt.nguoiMua.maKhachHang} />
                <Muc nhan="Học viên" giaTri={buoc.xt.hocVien} />
                <Muc nhan="Gửi hoá đơn tới email" giaTri={buoc.xt.emailNhan} thieu="Chưa có email — hoá đơn vẫn xuất, nhưng phải tải và gửi cho phụ huynh bằng Zalo" />
              </dl>
              <div className="rounded-lg border border-border">
                <p className="border-b border-border px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Sẽ xuất {buoc.xt.lanThu.length} hoá đơn (mỗi lần thu một hoá đơn)</p>
                <ul className="divide-y divide-border text-sm">
                  {buoc.xt.lanThu.map((l) => (
                    <li key={l.key} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 break-words">
                        {ngay(l.ngayThu)} · {l.nhanNguon}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{vnd(l.soTien)}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-3 bg-muted/40 px-3 py-2 font-semibold">
                    <span>Tổng</span>
                    <span className="tabular-nums">{vnd(buoc.xt.tongTien)}</span>
                  </li>
                </ul>
              </div>
              {buoc.xt.khongXuatLien.length > 0 ? (
                <div className="rounded-lg border border-state-warning/40 bg-state-warning-soft p-3 text-sm text-state-warning-ink" role="note">
                  <p className="font-medium">Các lần thu sau CHƯA xuất liền được (sẽ đi cùng lô 23h30 nếu đủ điều kiện):</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {buoc.xt.khongXuatLien.map((k, i) => (
                      <li key={i}>
                        {ngay(k.ngayThu)} · {vnd(k.soTien)} — {k.lyDo}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm leading-snug">
                <input type="checkbox" checked={daDoiChieu} onChange={(e) => setDaDoiChieu(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[#b45309]" />
                <span>Tôi đã đọc lại các thông tin trên với phụ huynh và đều đúng.</span>
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" className="h-11" onClick={dong} disabled={dangChay}>
                  Quay lại sửa
                </Button>
                <Button type="button" className="h-11" onClick={() => xuat(buoc.xt)} disabled={!daDoiChieu || dangChay}>
                  {dangChay ? "Đang xuất và gửi…" : "Xuất hoá đơn ngay"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Muc({ nhan, giaTri, thieu }: { nhan: string; giaTri: string | null; thieu?: string }) {
  if (!giaTri && !thieu) return null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{nhan}</dt>
      <dd className={giaTri ? "break-words font-medium" : "text-state-warning-ink"}>{giaTri ?? thieu}</dd>
    </div>
  );
}
