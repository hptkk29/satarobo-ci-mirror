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
import { toAddressOptions, toNameOptions } from "@/lib/address/vn-address";
import { sach, NHAN_O, type FormNguoiMua, type KhoaForm } from "@/lib/finance/hoa-don/form-nguoi-mua";
import type { KhoiNguoiMua } from "@/lib/finance/hoa-don/khoi-nguoi-mua";
import { luuThongTinHoaDonAction } from "../_actions";
import { DiaChiHoaDon, type DanhMucDiaChi } from "./dia-chi-hoa-don";

/**
 * Khối "Người mua trên hoá đơn" của màn đơn hàng.
 *
 * VÌ SAO LÀ MỘT KHỐI RIÊNG, không nhét vào "Thông tin khách hàng": hai khối trả lời hai
 * câu hỏi khác nhau. "Khách hàng" là người hệ thống liên lạc; "người mua trên hoá đơn" là
 * người ĐỨNG TÊN trên một tờ giấy pháp lý, và trên hoá đơn thật 1C26MNV-13 hai người đó
 * KHÁC NHAU (người mua "Phan Thị Hồng", học viên "Nguyễn Đức Huy Hoàng"). Trộn chung là
 * mời người dùng sửa thông tin liên hệ khi họ chỉ định sửa tên trên hoá đơn.
 *
 * 01/11/2026 — nhập đủ TÁM ô (học viên + ba/mẹ), điền sẵn từ đơn → hồ sơ học viên / phiếu lead, và
 * bấm Lưu thì đồng bộ ngược sang hồ sơ. Luật: `lib/finance/hoa-don/form-nguoi-mua.ts`.
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

/** Một ô nhập + hai dòng nhắc nguồn: «điền sẵn từ hồ sơ» và «hồ sơ đang ghi …» (khi khác). */
function Truong({
  khoa,
  form,
  hoSo,
  nguon,
  datGiaTri,
  type,
  inputMode,
  className,
}: {
  khoa: KhoaForm;
  form: FormNguoiMua;
  hoSo: FormNguoiMua;
  nguon: Record<KhoaForm, "don" | "ho-so" | "trong">;
  datGiaTri: (k: KhoaForm, v: string) => void;
  type?: string;
  inputMode?: "numeric" | "tel" | "email";
  className?: string;
}) {
  const giaTriHoSo = sach(hoSo[khoa]);
  const khacHoSo = giaTriHoSo !== "" && giaTriHoSo !== sach(form[khoa]);
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label htmlFor={`hd-${khoa}`}>{NHAN_O[khoa]}</Label>
      <Input
        id={`hd-${khoa}`}
        type={type}
        inputMode={inputMode}
        value={form[khoa]}
        onChange={(e) => datGiaTri(khoa, e.target.value)}
      />
      {nguon[khoa] === "ho-so" && sach(form[khoa]) === giaTriHoSo && (
        <p className="text-xs text-muted-foreground">Điền sẵn từ hồ sơ — bấm Lưu để ghi vào đơn.</p>
      )}
      {khacHoSo && nguon[khoa] !== "ho-so" && (
        <p className="text-xs text-muted-foreground">
          Hồ sơ đang ghi: <span className="font-medium text-foreground">{giaTriHoSo}</span>{" "}
          <button
            type="button"
            className="text-primary underline underline-offset-2"
            onClick={() => datGiaTri(khoa, giaTriHoSo)}
          >
            Dùng giá trị hồ sơ
          </button>
        </p>
      )}
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
  const [form, setForm] = useState<FormNguoiMua | null>(null);
  /** Form lúc MỞ hộp thoại — gửi lại để máy chủ biết ô nào người dùng thật sự SỬA. */
  const [banDau, setBanDau] = useState<FormNguoiMua | null>(null);
  const [danhMuc, setDanhMuc] = useState<DanhMucDiaChi | null>(null);

  const thieu = khoi.thieu;
  const sanSang = thieu.chan.length === 0;
  // Đã có ai khai ô nào chưa — phần lớn phụ huynh KHÔNG xin hoá đơn, nên "chưa khai gì"
  // là trạng thái BÌNH THƯỜNG. Màn im lặng ở ca đó thay vì treo cảnh báo trên mọi đơn.
  const daKhai = khoi.daKhai;
  // Nút Sửa chỉ khi có quyền sửa VÀ thấy giá trị thật: form khởi tạo bằng bản đã che thì Lưu là ghi đè
  // dữ liệu thật bằng chuỗi đã che (luật 12 — nút mà action chắc chắn từ chối là lời hứa suông).
  const moSua = canManage && sua != null;

  function moHop() {
    if (!sua) return;
    // Luôn nạp lại từ props MỚI NHẤT — sau một lượt lưu, trang đã làm mới và form cũ không còn đúng.
    setForm({ ...sua.form });
    setBanDau({ ...sua.form });
    setMo(true);
    if (!danhMuc) {
      // Nạp lười: bộ danh mục ~vài trăm KB, chỉ cần khi thật sự mở hộp thoại.
      void import("vietnam-address-data")
        .then(({ provinces, getWardsByProvince }) =>
          setDanhMuc({
            provinces: toAddressOptions(provinces),
            wardsOf: (ma) => toNameOptions(getWardsByProvince(ma)),
          }),
        )
        .catch(() => setDanhMuc(null));
    }
  }

  const datGiaTri = (k: KhoaForm, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  function luu() {
    if (!form || !banDau) return;
    startTransition(async () => {
      const res = await luuThongTinHoaDonAction(orderId, { form, banDau }, updatedAt);
      if (res.ok) {
        const dongBo = res.dongBo;
        const noiDen = dongBo.muc === "HOC_VIEN" ? "hồ sơ học viên" : dongBo.muc === "LEAD" ? "phiếu lead" : null;
        toast.success(
          noiDen && dongBo.daGhi.length > 0
            ? `Đã lưu thông tin hoá đơn và cập nhật ${noiDen}`
            : "Đã lưu thông tin hoá đơn",
        );
        // Ô không ghi được sang hồ sơ — nói rõ, đừng để người dùng tưởng đã đồng bộ.
        if (dongBo.boQua.length > 0) {
          toast.warning(
            `Chưa ghi sang hồ sơ: ${[...new Set(dongBo.boQua.map((b) => NHAN_O[b.khoa]))].join(", ")} — ${dongBo.boQua[0]!.lyDo}`,
          );
        }
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
              "Thông tin in ở khối 'người mua' của hoá đơn GTGT: học viên và ba/mẹ. KHÔNG bắt buộc: " +
              "phần lớn phụ huynh không xin hoá đơn, và khối này sửa được bất cứ lúc nào — kể cả sau " +
              "khi đơn đã hoàn tất — rồi xuất hoá đơn gửi khách. Ô nào hồ sơ học viên / phiếu lead đã " +
              "có thì được điền sẵn, khỏi nhập lại; sửa ở đây thì hồ sơ cũng đổi theo. Hệ thống " +
              "KHÔNG tự phát hành hoá đơn: nó dựng đúng bộ số để kế toán nạp vào MISA/VIN, nơi cấp " +
              "Mã CQT và ký số."
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
          <Button size="sm" variant="outline" className="ml-auto" onClick={moHop}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Sửa
          </Button>
        )}
      </div>

      {/* MỘT cột, cùng lối nhãn/giá trị với các khối khác ở cột phải: khối này sống ở
          cột ~23rem, chia đôi ở đó thì giá trị dài xuống ba dòng cạnh một ô "—". */}
      <dl className="grid grid-cols-1 gap-3">
        {khoi.o.map((o) => (
          <O key={o.khoa} nhan={o.nhan}>
            <span className={o.khoa === "hocVienCccd" || o.khoa === "phuHuynhCccd" || o.khoa === "phuHuynhSdt" || o.khoa === "donViMst" ? "tabular-nums" : undefined}>
              {o.giaTri ?? "—"}
            </span>
            {o.nguon === "ho-so" && o.giaTri && (
              <span className="ml-1 text-xs text-muted-foreground">(từ hồ sơ — chưa lưu vào đơn)</span>
            )}
          </O>
        ))}
      </dl>

      <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs">
        {khoi.soODangTheoHoSo > 0 && (
          <p className="text-muted-foreground">
            <span className="font-semibold">{khoi.soODangTheoHoSo} mục</span> đang lấy từ{" "}
            {khoi.noiGhi === "LEAD" ? "phiếu lead" : "hồ sơ học viên"} — tờ hoá đơn chỉ đọc thứ đã lưu trên đơn.
            {moSua ? " Bấm Sửa → Lưu để ghi vào đơn." : ""}
          </p>
        )}
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
          Ngày sinh, CCCD, SĐT, địa chỉ và email đã che — cần quyền xem thông tin khách để xem đủ và sửa.
        </p>
      )}

      {moSua && sua && form && banDau && (
        <Dialog open={mo} onOpenChange={setMo}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Thông tin người mua trên hoá đơn</DialogTitle>
            </DialogHeader>
            <div className="space-y-5">
              <p className="text-xs text-muted-foreground">
                Ô nào hồ sơ học viên / phiếu lead đã có thì được điền sẵn — giữ nguyên hoặc sửa. Bấm Lưu: thông
                tin ghi vào đơn này, và ô bạn vừa sửa (hoặc ô hồ sơ còn trống) được cập nhật sang hồ sơ. Ô để
                trống KHÔNG xoá gì ở hồ sơ.
              </p>

              <fieldset className="space-y-3">
                <legend className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Học viên</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Truong khoa="hocVienTen" form={form} hoSo={sua.hoSo} nguon={sua.nguon} datGiaTri={datGiaTri} className="sm:col-span-2" />
                  <Truong khoa="hocVienNgaySinh" type="date" form={form} hoSo={sua.hoSo} nguon={sua.nguon} datGiaTri={datGiaTri} />
                  <Truong khoa="hocVienCccd" inputMode="numeric" form={form} hoSo={sua.hoSo} nguon={sua.nguon} datGiaTri={datGiaTri} />
                </div>
                <DiaChiHoaDon
                  danhMuc={danhMuc}
                  tinh={form.tinh}
                  phuong={form.phuong}
                  diaChi={form.diaChi}
                  onChange={(p) => setForm((f) => (f ? { ...f, ...p } : f))}
                />
                {(sach(sua.hoSo.tinh) || sach(sua.hoSo.phuong) || sach(sua.hoSo.diaChi)) &&
                  [sua.hoSo.diaChi, sua.hoSo.phuong, sua.hoSo.tinh].map(sach).join("|") !==
                    [form.diaChi, form.phuong, form.tinh].map(sach).join("|") && (
                    <p className="text-xs text-muted-foreground">
                      Hồ sơ đang ghi:{" "}
                      <span className="font-medium text-foreground">
                        {[sua.hoSo.diaChi, sua.hoSo.phuong, sua.hoSo.tinh].map(sach).filter(Boolean).join(", ")}
                      </span>{" "}
                      <button
                        type="button"
                        className="text-primary underline underline-offset-2"
                        onClick={() =>
                          setForm((f) =>
                            f ? { ...f, tinh: sua.hoSo.tinh, phuong: sua.hoSo.phuong, diaChi: sua.hoSo.diaChi } : f,
                          )
                        }
                      >
                        Dùng địa chỉ hồ sơ
                      </button>
                    </p>
                  )}
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Ba / mẹ</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Truong khoa="phuHuynhTen" form={form} hoSo={sua.hoSo} nguon={sua.nguon} datGiaTri={datGiaTri} className="sm:col-span-2" />
                  <Truong khoa="phuHuynhSdt" inputMode="tel" form={form} hoSo={sua.hoSo} nguon={sua.nguon} datGiaTri={datGiaTri} />
                  <Truong khoa="phuHuynhCccd" inputMode="numeric" form={form} hoSo={sua.hoSo} nguon={sua.nguon} datGiaTri={datGiaTri} />
                  <Truong khoa="phuHuynhEmail" type="email" inputMode="email" form={form} hoSo={sua.hoSo} nguon={sua.nguon} datGiaTri={datGiaTri} className="sm:col-span-2" />
                </div>
              </fieldset>

              {/* Tuỳ chọn — hai ô này chỉ có trên hoá đơn (không có chỗ ở hồ sơ), và là điều kiện
                  để xuất hoá đơn CÔNG TY (cùng nguồn dữ liệu MISA); gỡ đi là hỏng ca đang chạy. */}
              <details className="rounded-lg border border-border px-3 py-2" open={sach(form.donViTen) !== "" || sach(form.donViMst) !== ""}>
                <summary className="cursor-pointer text-sm font-medium">Xuất cho công ty (tuỳ chọn)</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Truong khoa="donViTen" form={form} hoSo={sua.hoSo} nguon={sua.nguon} datGiaTri={datGiaTri} />
                  <Truong khoa="donViMst" inputMode="numeric" form={form} hoSo={sua.hoSo} nguon={sua.nguon} datGiaTri={datGiaTri} />
                </div>
                {sach(form.donViTen) !== "" && sach(form.donViMst) === "" && (
                  <p className="mt-2 text-xs text-state-warning-ink">
                    Đã ghi tên đơn vị thì bắt buộc có mã số thuế — hoá đơn công ty thiếu MST là hoá đơn không hợp lệ.
                  </p>
                )}
              </details>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMo(false)} disabled={isPending}>
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
