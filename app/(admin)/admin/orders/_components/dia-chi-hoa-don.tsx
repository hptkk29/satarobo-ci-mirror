"use client";

// Ô «Địa chỉ nơi ở» của khối người mua trên hoá đơn — Tỉnh/Thành → Phường/Xã (danh mục MỚI hiệu lực
// 01/07/2025) + địa chỉ chi tiết. ĐIỀU KHIỂN HOÀN TOÀN (không ô ẩn) vì nằm trong hộp thoại có state, khác
// `students/_components/ho-so/dia-chi-picker.tsx` là ô uncontrolled của form HTML.
//
// LƯU TÊN (cột `Order.customerCity` / `customerWard`), không lưu mã — cùng quy ước với hồ sơ HV và lead
// nên ba nơi ra cùng một chuỗi và đồng bộ được (`lib/students/dong-bo-lead.ts`).
//
// Tên đang lưu mà KHÔNG dịch được sang danh mục mới (vd "Tp Đà Nẵng" kiểu cũ) thì giữ nguyên chữ đó nếu
// người dùng không đụng tới — chỉ nhắc chọn lại. Xoá thầm là mất dữ liệu trên một tờ giấy pháp lý.

import { useMemo } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { maTinhMoi, tenPhuongMoi } from "@/lib/address/vn-address";

export type DanhMucDiaChi = {
  provinces: ComboboxOption[];
  /** Phường/xã của một tỉnh (value = CHÍNH TÊN). */
  wardsOf: (maTinh: string) => ComboboxOption[];
};

export function DiaChiHoaDon({
  danhMuc,
  tinh,
  phuong,
  diaChi,
  onChange,
}: {
  /** `null` ⇒ danh mục chưa nạp xong: ô tỉnh/phường tạm là ô gõ tay. */
  danhMuc: DanhMucDiaChi | null;
  tinh: string;
  phuong: string;
  diaChi: string;
  onChange: (p: Partial<{ tinh: string; phuong: string; diaChi: string }>) => void;
}) {
  const maTinh = useMemo(
    () => (danhMuc ? maTinhMoi(danhMuc.provinces.map((p) => ({ id: p.value, name: p.label })), tinh) : null),
    [danhMuc, tinh],
  );
  const phuongOptions = useMemo(
    () => (danhMuc && maTinh ? danhMuc.wardsOf(maTinh) : []),
    [danhMuc, maTinh],
  );
  const phuongHienTai = useMemo(
    () => (phuongOptions.length > 0 ? tenPhuongMoi(phuongOptions.map((w) => ({ id: w.value, name: w.value })), phuong) : null),
    [phuongOptions, phuong],
  );
  const tinhCanChonLai = danhMuc != null && tinh.trim() !== "" && !maTinh;
  const phuongCanChonLai = danhMuc != null && maTinh != null && phuong.trim() !== "" && !phuongHienTai;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="hd-tinh">Tỉnh / Thành phố</Label>
        {danhMuc ? (
          <Combobox
            id="hd-tinh"
            options={danhMuc.provinces}
            value={maTinh}
            onValueChange={(ma) => {
              const ten = danhMuc.provinces.find((p) => p.value === ma)?.label ?? "";
              // Đổi tỉnh thì phường cũ chắc chắn sai — xoá, đừng để một cặp tỉnh/phường không tồn tại trôi xuống DB.
              onChange({ tinh: ten, phuong: "" });
            }}
            placeholder={tinh && !maTinh ? tinh : "Tìm tỉnh/thành…"}
            emptyText="Không tìm thấy tỉnh/thành"
            className="h-10 border-border bg-card sm:h-9"
          />
        ) : (
          <Input id="hd-tinh" value={tinh} onChange={(e) => onChange({ tinh: e.target.value })} />
        )}
        {tinhCanChonLai && (
          <p className="text-xs text-state-warning-ink">
            Đang lưu «{tinh}» — không có trong danh mục mới. Để nguyên thì giữ chữ này; muốn đổi thì chọn lại.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="hd-phuong">Phường / Xã</Label>
        {danhMuc && maTinh ? (
          <Combobox
            id="hd-phuong"
            options={phuongOptions}
            value={phuongHienTai}
            onValueChange={(v) => onChange({ phuong: v ?? "" })}
            placeholder={phuong && !phuongHienTai ? phuong : "Tìm phường/xã…"}
            emptyText="Không tìm thấy phường/xã"
            className="h-10 border-border bg-card sm:h-9"
          />
        ) : (
          <Input
            id="hd-phuong"
            value={phuong}
            disabled={danhMuc != null && !maTinh && tinh.trim() === ""}
            placeholder={danhMuc != null && !maTinh && tinh.trim() === "" ? "Chọn tỉnh/thành trước" : undefined}
            onChange={(e) => onChange({ phuong: e.target.value })}
          />
        )}
        {phuongCanChonLai && (
          <p className="text-xs text-state-warning-ink">
            Đang lưu «{phuong}» — không còn trong danh mục sau sáp nhập. Để nguyên thì giữ chữ này.
          </p>
        )}
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="hd-diachi">Địa chỉ chi tiết (số nhà, đường)</Label>
        <Input
          id="hd-diachi"
          value={diaChi}
          autoComplete="street-address"
          onChange={(e) => onChange({ diaChi: e.target.value })}
        />
      </div>
    </div>
  );
}
