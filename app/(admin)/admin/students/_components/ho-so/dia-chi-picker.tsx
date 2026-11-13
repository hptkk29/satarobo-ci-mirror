"use client";

// Ô địa chỉ 2 CẤP của hồ sơ học viên — Tỉnh/Thành → Phường/Xã, danh mục hiệu lực 01/07/2025
// (cùng gói với phiếu lead `leads/_components/lead-form.tsx`, để một gia đình khai ở hai màn ra
// cùng một chuỗi — và từ 26/09 hai màn còn ĐỒNG BỘ nhau, xem lib/students/dong-bo-lead.ts).
// LƯU TÊN (ô ẩn `city` / `ward`), không lưu mã.
//
// 26/09/2026 — CHỈ danh mục MỚI (chủ dự án: "không lấy thông tin cũ nữa"). Tên cũ dịch được
// thì hiện tên mới; không dịch được thì ô trống + dòng nhắc chọn lại. Luật: `dia-chi.ts`.
//
// Danh sách phường nạp LƯỜI (`import()` khi đổi tỉnh); phường của tỉnh đang lưu do trang
// nạp sẵn ở server (`initialWards`) để mở hồ sơ ra là đổi được phường ngay.

import { useMemo, useState } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { toNameOptions } from "@/lib/address/vn-address";
import { diaChiCanChonLai, phuongBanDau, tenTinhTuGiaTri, tinhBanDau } from "./dia-chi";
import { O_NHAP, Truong } from "./o-nhap";

const O_COMBO = "h-10 border-border bg-card sm:h-9";

export function DiaChiPicker({
  provinces,
  initialWards,
  city,
  ward,
  address,
}: {
  provinces: ComboboxOption[];
  /** Phường/xã của tỉnh (MỚI) ứng với tên tỉnh đang lưu — trang nạp bằng `maTinhMoi`. */
  initialWards: ComboboxOption[];
  city: string | null;
  ward: string | null;
  address: string | null;
}) {
  const maBanDau = useMemo(() => tinhBanDau(provinces, city), [provinces, city]);
  const phuongDau = useMemo(() => phuongBanDau(initialWards, ward), [initialWards, ward]);
  const [tinhDangChon, setTinhDangChon] = useState<string | null>(maBanDau);
  const [cityName, setCityName] = useState(() => tenTinhTuGiaTri(provinces, maBanDau));
  const [wardName, setWardName] = useState(phuongDau);
  const [wardOptions, setWardOptions] = useState<ComboboxOption[]>(initialWards);
  const [dangTai, setDangTai] = useState(false);
  const [loiTai, setLoiTai] = useState(false);
  const [daChonLai, setDaChonLai] = useState({ tinh: false, phuong: false });

  const coDanhMuc = provinces.length > 0;
  const canChonLai = diaChiCanChonLai({
    cityDangLuu: city,
    wardDangLuu: ward,
    maTinh: maBanDau,
    phuong: phuongDau,
  });

  function chonTinh(next: string | null) {
    if (next === tinhDangChon) return;
    setTinhDangChon(next);
    setCityName(tenTinhTuGiaTri(provinces, next));
    setDaChonLai((d) => ({ ...d, tinh: true }));
    // Đổi tỉnh thì phường cũ chắc chắn sai — xoá, đừng để một cặp tỉnh/phường không tồn
    // tại trôi xuống DB.
    setWardName("");
    setWardOptions([]);
    setLoiTai(false);
    if (!next) return;
    setDangTai(true);
    void import("vietnam-address-data")
      // `toNameOptions`, KHÔNG `toAddressOptions`: cột `Student.ward` chứa TÊN.
      .then(({ getWardsByProvince }) => setWardOptions(toNameOptions(getWardsByProvince(next))))
      .catch(() => {
        setWardOptions([]);
        setLoiTai(true);
      })
      .finally(() => setDangTai(false));
  }

  const khoaPhuong = coDanhMuc && (!tinhDangChon || dangTai);

  const nhacTinh =
    canChonLai.tinh && !daChonLai.tinh
      ? "Tỉnh/thành đang lưu không có trong danh mục mới (34 tỉnh/thành từ 01/07/2025) — chọn lại."
      : undefined;
  const nhacPhuong = loiTai
    ? "Không tải được danh sách phường/xã — chọn lại tỉnh để thử lại."
    : canChonLai.phuong && !canChonLai.tinh && !daChonLai.tinh && !daChonLai.phuong
      ? "Phường/xã đang lưu không còn trong danh mục sau sáp nhập — chọn lại."
      : undefined;

  return (
    <div className="grid gap-4 @lg:grid-cols-2 @4xl:grid-cols-3">
      <input type="hidden" name="city" value={cityName} />
      <input type="hidden" name="ward" value={wardName} />

      <Truong id="hv-city" nhan="Tỉnh / Thành phố" phu={nhacTinh}>
        {coDanhMuc ? (
          <Combobox
            id="hv-city"
            options={provinces}
            value={tinhDangChon}
            onValueChange={chonTinh}
            placeholder="Tìm tỉnh/thành…"
            emptyText="Không tìm thấy tỉnh/thành"
            className={O_COMBO}
          />
        ) : (
          // Trang quên truyền danh mục ⇒ vẫn cho gõ tay thay vì khoá cứng ô.
          <input
            id="hv-city"
            value={cityName}
            onChange={(e) => setCityName(e.target.value)}
            className={O_NHAP}
            autoComplete="address-level1"
          />
        )}
      </Truong>

      <Truong id="hv-ward" nhan="Phường / Xã" phu={nhacPhuong}>
        {coDanhMuc ? (
          <Combobox
            id="hv-ward"
            options={wardOptions}
            value={wardName || null}
            onValueChange={(v) => {
              setWardName(v ?? "");
              setDaChonLai((d) => ({ ...d, phuong: true }));
            }}
            disabled={khoaPhuong}
            placeholder={
              !tinhDangChon ? "Chọn tỉnh/thành trước" : dangTai ? "Đang tải…" : "Tìm phường/xã…"
            }
            emptyText="Không tìm thấy phường/xã"
            className={O_COMBO}
          />
        ) : (
          <input
            id="hv-ward"
            value={wardName}
            onChange={(e) => setWardName(e.target.value)}
            className={O_NHAP}
          />
        )}
      </Truong>

      <Truong id="hv-address" nhan="Địa chỉ chi tiết" className="@lg:col-span-2 @4xl:col-span-1">
        <input
          id="hv-address"
          name="address"
          defaultValue={address ?? ""}
          placeholder="Số nhà, tên đường"
          autoComplete="street-address"
          className={O_NHAP}
        />
      </Truong>
    </div>
  );
}
