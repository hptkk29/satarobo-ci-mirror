"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FileText, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChuThich } from "@/components/admin/ui/chu-thich";
import type { KhoiNguoiMua } from "@/lib/finance/hoa-don/khoi-nguoi-mua";
import { luuThongTinHoaDonAction } from "../_actions";

/**
 * Khối "Người mua trên hoá đơn" của màn đơn hàng.
 *
 * VÌ SAO LÀ MỘT KHỐI RIÊNG, không nhét vào "Thông tin khách hàng": hai khối trả lời hai
 * câu hỏi khác nhau. "Khách hàng" là người hệ thống liên lạc; "người mua trên hoá đơn" là
 * người ĐỨNG TÊN trên một tờ giấy pháp lý, và trên hoá đơn thật 1C26MNV-13 hai người đó
 * KHÁC NHAU (người mua "Phan Thị Hồng", học viên "Nguyễn Đức Huy Hoàng"). Trộn chung là
 * mời người dùng sửa thông tin liên hệ khi họ chỉ định sửa tên trên hoá đơn.
 */
/** Cặp nhãn/giá trị — cùng hình thức với các khối khác ở cột phải của trang đơn. */
function O({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {nhan}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function ThongTinHoaDon({
  orderId,
  khoi,
  updatedAt,
  canManage,
}: {
  orderId: string;
  /**
   * View-model dựng + che ở SERVER (`khoiNguoiMuaHoaDon`) từ đơn THẬT. Thiếu `orders:view-pii` ⇒ MST /
   * CCCD / địa chỉ / email đã che, và `giaTriSua = null` ⇒ KHÔNG có nút Sửa (29/09 — PLAN GĐ 7 mục 12).
   */
  khoi: KhoiNguoiMua;
  updatedAt: string;
  canManage: boolean;
}) {
  const [mo, setMo] = useState(false);
  const [isPending, startTransition] = useTransition();
  const sua = khoi.giaTriSua;
  const [form, setForm] = useState({
    invoiceBuyerName: sua?.invoiceBuyerName ?? "",
    invoiceCompanyName: sua?.invoiceCompanyName ?? "",
    invoiceTaxCode: sua?.invoiceTaxCode ?? "",
    invoiceEmail: sua?.invoiceEmail ?? "",
  });

  const thieu = khoi.thieu;
  const sanSang = thieu.chan.length === 0;
  // Đã có ai khai ô nào chưa — phần lớn phụ huynh KHÔNG xin hoá đơn, nên "chưa khai gì"
  // là trạng thái BÌNH THƯỜNG. Màn im lặng ở ca đó thay vì treo cảnh báo trên mọi đơn.
  const daKhai = khoi.daKhai;
  // Nút Sửa chỉ khi có quyền sửa VÀ thấy giá trị thật: form khởi tạo bằng bản đã che thì Lưu là ghi đè
  // dữ liệu thật bằng chuỗi đã che (luật 12 — nút mà action chắc chắn từ chối là lời hứa suông).
  const moSua = canManage && sua != null;

  function luu() {
    startTransition(async () => {
      const res = await luuThongTinHoaDonAction(orderId, form, updatedAt);
      if (res.ok) {
        toast.success("Đã lưu thông tin hoá đơn");
        // GĐ 8 — đơn đang có hoá đơn: tờ đã có KHÔNG tự đổi theo ô vừa sửa ⇒ nói ra.
        if (res.canhBao) toast.warning(res.canhBao);
        setMo(false);
      } else {
        toast.error(
          res.error === "STALE_WRITE"
            ? "Người khác vừa sửa đơn này — tải lại trang rồi thử lại"
            : res.error,
        );
      }
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <FileText className="h-4 w-4" aria-hidden />
          Người mua trên hoá đơn
          <ChuThich
            nhan="Khối này dùng để làm gì"
            noiDung={
              "Thông tin in ở khối 'người mua' của hoá đơn GTGT. KHÔNG bắt buộc: phần lớn " +
              "phụ huynh không xin hoá đơn, và khối này sửa được bất cứ lúc nào — kể cả sau " +
              "khi đơn đã hoàn tất — rồi xuất hoá đơn gửi khách. Người mua có thể KHÁC người " +
              "đặt đơn (bố đặt, hoá đơn ghi tên mẹ); ô nào để trống thì lấy theo thông tin " +
              "khách hàng ở khối trên. Hệ thống KHÔNG tự phát hành hoá đơn: nó dựng đúng bộ " +
              "số để kế toán nạp vào MISA/VIN, nơi cấp Mã CQT và ký số."
            }
          />
        </h2>
        {/* KHÔNG có nhãn "bắt buộc" ở đây. Chủ dự án chốt 14/09: hoá đơn là TUỲ KHÁCH —
            có người cần, có người không — nên khối này không bao giờ được đọc thành "đơn
            đang sai". Ba trạng thái, và trạng thái hay gặp nhất (chưa ai hỏi hoá đơn) là
            một câu trung tính, không màu cảnh báo. */}
        {sanSang ? (
          <Badge className="bg-state-success-soft text-state-success-ink hover:bg-state-success-soft">
            Xuất hoá đơn được
          </Badge>
        ) : daKhai ? (
          <Badge className="bg-state-warning-soft text-state-warning-ink hover:bg-state-warning-soft">
            Cần bổ sung {thieu.chan.length} mục để xuất
          </Badge>
        ) : (
          <Badge variant="outline" className="whitespace-nowrap font-normal">
            Chưa cần hoá đơn
          </Badge>
        )}
        {moSua && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => setMo(true)}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Sửa
          </Button>
        )}
      </div>

      {/* MỘT cột, cùng lối nhãn/giá trị với các khối khác ở cột phải: khối này sống ở
          cột ~23rem, chia đôi ở đó thì "Phạm Thuý Anh (theo tên khách hàng)" xuống ba
          dòng cạnh một ô "—". */}
      <dl className="grid grid-cols-1 gap-3">
        <O nhan="Họ tên người mua">
          <span className="font-medium">{khoi.hoTen || "—"}</span>
          {khoi.hoTenTheoKhach && (
            <span className="ml-1 text-xs text-muted-foreground">
              (theo tên khách hàng)
            </span>
          )}
        </O>
        <O nhan="Tên đơn vị">{khoi.tenDonVi ?? "—"}</O>
        <O nhan="Mã số thuế">
          <span className="tabular-nums">{khoi.maSoThue ?? "—"}</span>
        </O>
        <O nhan="CCCD/Hộ chiếu">
          <span className="tabular-nums">{khoi.cccd ?? "—"}</span>
        </O>
        <O nhan="Địa chỉ">{khoi.diaChi ?? "—"}</O>
        <O nhan="Email nhận hoá đơn">
          {khoi.email ?? "—"}
          {khoi.emailTheoKhach && (
            <span className="ml-1 text-xs text-muted-foreground">
              (theo email khách hàng)
            </span>
          )}
        </O>
      </dl>

      <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs">
        {!daKhai && !sanSang && (
          <p className="text-muted-foreground">
            Khách chưa hỏi hoá đơn thì để trống — điền lúc nào cũng được, kể cả
            sau khi đơn đã hoàn tất.
          </p>
        )}
        {thieu.chan.length > 0 && daKhai && (
          <p className="text-state-warning-ink">
            <span className="font-semibold">Cần bổ sung để xuất:</span>{" "}
            {thieu.chan.join(" · ")}
          </p>
        )}
        {thieu.chan.length > 0 && !daKhai && (
          <p className="text-muted-foreground">
            <span className="font-semibold">Khi cần xuất sẽ phải có:</span>{" "}
            {thieu.chan.join(" · ")}
          </p>
        )}
        {thieu.nhac.length > 0 && (
          <p className="text-muted-foreground">
            <span className="font-semibold">Nên có:</span>{" "}
            {thieu.nhac.join(" · ")}
          </p>
        )}
      </div>

      {!khoi.xemPii && (
        <p className="mt-2 text-xs text-muted-foreground">
          Mã số thuế, CCCD, địa chỉ và email đã che — cần quyền xem thông tin khách để xem đủ và sửa.
        </p>
      )}

      {moSua && (
      <Dialog open={mo} onOpenChange={setMo}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Thông tin người mua trên hoá đơn</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Chỉ điền khi khách cần hoá đơn — sửa được bất cứ lúc nào, kể cả sau
              khi đơn đã hoàn tất. Để trống ô nào thì hoá đơn lấy theo thông tin
              khách hàng của đơn; địa chỉ và CCCD sửa ở khối Thông tin khách hàng.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="hd-ten">Họ tên người mua</Label>
              <Input
                id="hd-ten"
                value={form.invoiceBuyerName}
                placeholder={sua?.goiYTen ?? "Theo tên khách hàng"}
                onChange={(e) =>
                  setForm((f) => ({ ...f, invoiceBuyerName: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hd-donvi">Tên đơn vị (khi xuất cho công ty)</Label>
              <Input
                id="hd-donvi"
                value={form.invoiceCompanyName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, invoiceCompanyName: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hd-mst">Mã số thuế / CCCD chủ hộ</Label>
              <Input
                id="hd-mst"
                inputMode="numeric"
                value={form.invoiceTaxCode}
                onChange={(e) =>
                  setForm((f) => ({ ...f, invoiceTaxCode: e.target.value }))
                }
              />
              {form.invoiceCompanyName.trim() &&
                !form.invoiceTaxCode.trim() && (
                  <p className="text-xs text-state-warning-ink">
                    Đã ghi tên đơn vị thì bắt buộc có mã số thuế — hoá đơn công
                    ty thiếu MST là hoá đơn không hợp lệ.
                  </p>
                )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hd-email">Email nhận hoá đơn điện tử</Label>
              <Input
                id="hd-email"
                type="email"
                value={form.invoiceEmail}
                placeholder={sua?.goiYEmail ?? "Theo email khách hàng"}
                onChange={(e) =>
                  setForm((f) => ({ ...f, invoiceEmail: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMo(false)}
              disabled={isPending}
            >
              Huỷ
            </Button>
            <Button onClick={luu} disabled={isPending}>
              Lưu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}
    </section>
  );
}
