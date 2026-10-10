// app/(admin)/admin/students/_components/ho-so/dia-chi.ts — phần THUẦN của ô địa chỉ 2 cấp
// trên hồ sơ học viên. Tách khỏi `dia-chi-picker.tsx` để test không cần React.
//
// ĐẢO 26/09/2026 — chủ dự án: "phải lấy danh sách địa chỉ tỉnh/tp, phường/xã MỚI, không lấy
// thông tin cũ nữa". Bản 25/09 giữ tên đang lưu thành option tạm "… (dữ liệu cũ)" để một lượt
// lưu không xoá mất địa chỉ; hệ quả là hồ sơ nào lưu "Đà Nẵng" (danh mục ghi "Tp Đà Nẵng") cũng
// hiện một tỉnh cũ. Nay:
//   · ô chỉ có danh mục MỚI (34 tỉnh/thành, phường/xã sau 01/07/2025) — không option tạm;
//   · tên cũ được DỊCH sang danh mục mới khi dịch được tất định (`maTinhMoi` / `tenPhuongMoi`
//     ở lib/address/vn-address.ts: bỏ tiền tố "TP", tỉnh đã sáp nhập → tỉnh nhận sáp nhập);
//   · không dịch được thì ô TRỐNG + một dòng nhắc chọn lại — không in tên cũ ra.
// Lượt lưu kế tiếp ghi đúng thứ đang hiện (form so với giá trị ĐANG LƯU, không so với giá trị
// đã dịch — xem `student-form.tsx`), nên DB không còn giữ chữ mà màn hình không cho thấy.
// Lưới: `dia-chi.test.ts` ([DC-*]).

import type { ComboboxOption } from "@/components/ui/combobox";
import { maTinhMoi, tenPhuongMoi } from "@/lib/address/vn-address";

/** Mã tỉnh MỚI ứng với tên tỉnh đang lưu (đã dịch nếu là tên cũ), hoặc null. */
export function tinhBanDau(
  provinces: readonly ComboboxOption[],
  cityDangLuu: string | null | undefined,
): string | null {
  return maTinhMoi(
    provinces.map((p) => ({ id: p.value, name: p.label })),
    cityDangLuu,
  );
}

/** Tên tỉnh cần lưu ứng với một mã trong danh mục. */
export function tenTinhTuGiaTri(
  provinces: readonly ComboboxOption[],
  value: string | null,
): string {
  if (!value) return "";
  return provinces.find((p) => p.value === value)?.label ?? "";
}

/**
 * Tên phường/xã MỚI ứng với tên đang lưu, trong danh mục phường của tỉnh đang chọn (value =
 * CHÍNH TÊN, xem `toNameOptions`). Không có trong danh mục mới ⇒ "" (ô trống, chọn lại).
 */
export function phuongBanDau(
  wards: readonly ComboboxOption[],
  wardDangLuu: string | null | undefined,
): string {
  return (
    tenPhuongMoi(
      wards.map((w) => ({ id: w.value, name: w.value })),
      wardDangLuu,
    ) ?? ""
  );
}

/** Địa chỉ đang lưu có phần nào KHÔNG còn trong danh mục mới (để hiện dòng nhắc). */
export function diaChiCanChonLai(input: {
  cityDangLuu: string | null | undefined;
  wardDangLuu: string | null | undefined;
  maTinh: string | null;
  phuong: string;
}): { tinh: boolean; phuong: boolean } {
  const coTinh = !!(input.cityDangLuu ?? "").trim();
  const coPhuong = !!(input.wardDangLuu ?? "").trim();
  return {
    tinh: coTinh && input.maTinh === null,
    phuong: coPhuong && input.phuong === "",
  };
}
