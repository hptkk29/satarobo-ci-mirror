"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Maximize2, QrCode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChuThich } from "@/components/admin/ui/chu-thich";
import type { KhoiYeuCauNguoiMua } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-doc-db";
import { apDungYeuCauNguoiMuaAction, capLaiYeuCauNguoiMuaAction, huyYeuCauNguoiMuaAction, taoYeuCauNguoiMuaAction } from "../_actions-nguoi-mua";

// Khối «Thông tin người mua qua mã QR» của màn đơn hàng (Invoice Hub S11). KHÔNG phải màn mới: nằm ngay dưới «Người mua trên hoá đơn».
// Chỉ được vẽ khi cờ theo cơ sở bật VÀ người xem trong phạm vi xử lý yêu cầu — trang quyết định, component chỉ nhận cờ `duocPhep` đã tính ở server.
// Mã QR / liên kết CHỈ hiện ngay sau khi tạo (token thô không được lưu ở đâu cả); tải lại trang thì chỉ còn trạng thái — muốn mã mới thì «Cấp lại».
//
// [02/11/2026 — chủ dự án]
//  · «Phóng to»: ảnh QR 160px quá nhỏ để đưa phụ huynh quét ngay tại quầy ⇒ nút mở hộp thoại ảnh LỚN.
//  · Liên kết KHÔNG in ra nữa (chuỗi dài vô ích): chỉ có nút «Sao chép liên kết».
//  · «Nhập thay phụ huynh» mở thẳng hộp thoại «Người mua trên hoá đơn» (cùng 8 ô, cùng đường ghi + đồng bộ hồ sơ) thay vì một biểu mẫu thu nhỏ riêng ở đây —
//    MỘT đường ghi dữ liệu người mua trên đơn, không có luật thứ hai để lệch. Khối này chỉ còn xem trạng thái + áp dụng dữ liệu phụ huynh đã gửi.

const TEN_LOAI: Record<string, string> = { CA_NHAN: "Cá nhân", DOANH_NGHIEP: "Doanh nghiệp" };
const TEN_NGUON = { PHU_HUYNH: "Phụ huynh nhập", SALE_NHAP_THAY: "Nhân viên nhập thay" } as const;

/** Nhãn ô — theo LOẠI người mua (cá nhân: ba/mẹ + học viên; doanh nghiệp: đơn vị). */
const NHAN_O_CA_NHAN: Record<string, string> = {
  loai: "Loại người mua",
  ten: "Họ và tên ba/mẹ",
  cccd: "Số CCCD ba/mẹ",
  sdt: "SĐT ba/mẹ",
  diaChi: "Địa chỉ",
  email: "Email nhận hoá đơn",
  tenHocVien: "Họ và tên học viên",
  ngaySinhHocVien: "Ngày sinh học viên",
  cccdHocVien: "Số CCCD học viên",
};
const NHAN_O_DOANH_NGHIEP: Record<string, string> = {
  loai: "Loại người mua",
  ten: "Tên doanh nghiệp",
  maSoThue: "Mã số thuế",
  diaChi: "Địa chỉ",
  email: "Email nhận hoá đơn",
};
/** Thứ tự hiển thị theo loại. Ô BẮT BUỘC thiếu thì ghi «Chưa có»; ô tuỳ chọn thiếu ghi «—». */
const THU_TU_CA_NHAN = ["loai", "ten", "cccd", "sdt", "diaChi", "email", "tenHocVien", "ngaySinhHocVien", "cccdHocVien"] as const;
const THU_TU_DOANH_NGHIEP = ["loai", "ten", "maSoThue", "diaChi", "email"] as const;
const BAT_BUOC_CA_NHAN: ReadonlySet<string> = new Set(["loai", "ten", "cccd", "diaChi"]);
const BAT_BUOC_DOANH_NGHIEP: ReadonlySet<string> = new Set(["loai", "ten", "maSoThue", "diaChi", "email"]);
const TABULAR: ReadonlySet<string> = new Set(["cccd", "sdt", "cccdHocVien", "ngaySinhHocVien", "maSoThue"]);

type Moi = { id: string; lienKet: string; qr: string; hetHanLuc: string };

const gio = (iso: string) => new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
const nhanTenO = (laDn: boolean, o: string) => (laDn ? NHAN_O_DOANH_NGHIEP : NHAN_O_CA_NHAN)[o] ?? o;

export function YeuCauNguoiMua({
  orderId,
  khoi,
  onNhapThay,
}: {
  orderId: string;
  khoi: KhoiYeuCauNguoiMua | null;
  /**
   * Mở hộp thoại «Người mua trên hoá đơn» để nhân viên nhập thay phụ huynh. `undefined` = người xem KHÔNG mở được hộp thoại đó (thiếu quyền sửa / xem thông tin khách) ⇒ KHÔNG vẽ nút
   * (luật 12: nút mà hộp thoại không mở được là lời hứa suông) và nói lý do.
   */
  onNhapThay?: () => void;
}) {
  const [dangChay, chay] = useTransition();
  const [moi, setMoi] = useState<Moi | null>(null);
  const [phongTo, setPhongTo] = useState(false);
  const [canGhiDe, setCanGhiDe] = useState<string | null>(null);

  const dangMo = khoi?.trangThai === "DANG_MO";
  const daGui = dangMo && khoi.guiLuc !== null;
  const laDn = khoi?.o.loai?.giaTri === "DOANH_NGHIEP";
  const thuTu = laDn ? THU_TU_DOANH_NGHIEP : THU_TU_CA_NHAN;
  const batBuoc = laDn ? BAT_BUOC_DOANH_NGHIEP : BAT_BUOC_CA_NHAN;

  function tao() {
    chay(async () => {
      const r = await taoYeuCauNguoiMuaAction(orderId);
      if (r.ok) setMoi({ id: r.id, lienKet: r.lienKet, qr: r.qr, hetHanLuc: r.hetHanLuc });
      else toast.error(r.error);
    });
  }
  function capLai() {
    if (!khoi) return;
    chay(async () => {
      const r = await capLaiYeuCauNguoiMuaAction(orderId, khoi.id);
      if (r.ok) {
        setMoi({ id: r.id, lienKet: r.lienKet, qr: r.qr, hetHanLuc: r.hetHanLuc });
        toast.success("Đã cấp mã mới — mã cũ không còn dùng được");
      } else toast.error(r.error);
    });
  }
  function huy() {
    if (!khoi) return;
    chay(async () => {
      const r = await huyYeuCauNguoiMuaAction(orderId, khoi.id, "Nhân viên thu hồi mã QR");
      if (r.ok) {
        setMoi(null);
        setPhongTo(false);
        toast.success("Đã thu hồi mã QR");
      } else toast.error(r.error);
    });
  }
  function apDung(ghiDe: boolean) {
    if (!khoi) return;
    chay(async () => {
      const r = await apDungYeuCauNguoiMuaAction(orderId, khoi.id, ghiDe);
      if (r.ok) {
        setCanGhiDe(null);
        setMoi(null);
        setPhongTo(false);
        toast.success("Đã áp dụng vào thông tin hoá đơn của đơn");
        if (r.hoaDonConHieuLuc.length > 0) toast.warning("Đơn đã có hoá đơn: hoá đơn đó KHÔNG tự đổi, thông tin mới chỉ dùng cho hoá đơn tạo sau.");
      } else if (r.ma === "DON_DA_DOI") setCanGhiDe(r.error);
      else toast.error(r.error);
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
    <section className="@container rounded-xl border border-border bg-card p-4 sm:p-5" aria-labelledby="yc-nguoi-mua-tieu-de">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="yc-nguoi-mua-tieu-de" className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <QrCode className="h-4 w-4" aria-hidden />
          Thông tin người mua qua mã QR
          <ChuThich
            nhan="Khối này dùng để làm gì"
            noiDung={
              "Phụ huynh quét mã QR bằng điện thoại để tự điền thông tin người mua hoá đơn (họ tên, CCCD, địa chỉ… — không cần đăng nhập). " +
              "Hoặc bạn nhập thay phụ huynh bằng hộp thoại «Người mua trên hoá đơn». Mã chỉ hiện MỘT lần ngay sau khi tạo và hết hạn sau vài giờ; hết hạn hoặc lỡ tay thì «Cấp lại». " +
              "Bấm «Áp dụng vào đơn» khi đủ thông tin: hệ thống chép sang khối «Người mua trên hoá đơn». Hệ thống không phát hành hoá đơn."
            }
          />
        </h2>
        {khoi && (
          <Badge variant="outline" className="whitespace-nowrap font-normal">
            {khoi.trangThai === "DANG_MO" ? (daGui ? "Phụ huynh đã gửi" : khoi.linkHetHan ? "Mã đã hết hạn" : "Đang chờ phụ huynh") : khoi.trangThai === "DA_AP_DUNG" ? "Đã áp dụng" : khoi.trangThai === "THU_HOI" ? "Đã thu hồi" : "Đã hết hạn"}
          </Badge>
        )}
      </div>

      {moi && (
        <div className="mb-4 grid gap-4 rounded-lg border border-state-warning/40 bg-state-warning-soft p-3 @md:grid-cols-[auto_1fr]">
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

      {!khoi || !dangMo ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            {khoi?.trangThai === "DA_AP_DUNG" ? "Thông tin đã được áp dụng vào đơn." : khoi ? "Mã trước không còn dùng được." : "Chưa tạo mã. Phần lớn phụ huynh không xin hoá đơn — chỉ tạo khi có yêu cầu."}
          </p>
          <Button type="button" size="sm" onClick={tao} disabled={dangChay}>
            {khoi ? "Tạo mã mới" : "Tạo mã QR cho phụ huynh"}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-3 @md:grid-cols-2">
            {thuTu.map((k) => {
              const o = khoi.o[k];
              return (
                <div key={k} className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{nhanTenO(laDn, k)}</dt>
                  <dd className="mt-0.5 break-words text-sm text-foreground">
                    {o ? (
                      <>
                        <span className={TABULAR.has(k) ? "tabular-nums" : undefined}>{k === "loai" ? (TEN_LOAI[o.giaTri] ?? o.giaTri) : o.giaTri}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{TEN_NGUON[o.nguon]}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{batBuoc.has(k) ? "Chưa có" : "—"}</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          {!khoi.duDay && (
            <p className="text-sm text-muted-foreground" role="status">
              Chưa đủ để áp dụng{khoi.thieu.length > 0 ? ` — còn thiếu: ${khoi.thieu.map((o) => nhanTenO(laDn, o)).join(", ")}` : ""}
              {khoi.sai.length > 0 ? `; chưa hợp lệ: ${khoi.sai.map((o) => nhanTenO(laDn, o)).join(", ")}` : ""}.
            </p>
          )}
          {khoi.dangKhoa && <p className="text-sm text-state-warning-ink">Mã đang tạm khoá do nhập sai nhiều lần. Có thể cấp lại mã mới.</p>}
          {canGhiDe && (
            <div className="rounded-lg border border-state-warning/40 bg-state-warning-soft p-3 text-sm" role="alert">
              <p className="text-state-warning-ink">{canGhiDe}</p>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => apDung(true)} disabled={dangChay}>
                Ghi đè và áp dụng
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => apDung(false)} disabled={dangChay || !khoi.duDay}>
              Áp dụng vào đơn
            </Button>
            {onNhapThay && (
              <Button type="button" size="sm" variant="outline" onClick={onNhapThay} disabled={dangChay}>
                Nhập thay phụ huynh
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={capLai} disabled={dangChay}>
              Cấp lại mã
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={huy} disabled={dangChay}>
              Thu hồi
            </Button>
          </div>
          {!onNhapThay && <p className="text-xs text-muted-foreground">Nhập thay phụ huynh cần quyền sửa đơn và quyền xem thông tin khách (để mở hộp thoại «Người mua trên hoá đơn»).</p>}
        </div>
      )}
    </section>
  );
}
