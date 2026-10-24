"use client";

// BẢNG CÓ PHÂN TRANG — dùng chung cho MỌI site (admin/portal/teacher/public).
//
// Vì sao có: mọi bảng trong hệ đang đổ HẾT dữ liệu ra một trang. Một cơ sở vài trăm học
// viên là trang dài mấy màn hình, và muốn xem thứ nằm DƯỚI bảng thì phải cuộn qua toàn bộ
// bảng — đúng thứ chủ dự án phản ánh 11/08/2026.
//
// ⚠️ CẮT Ở TẦNG HIỂN THỊ, KHÔNG PHẢI TẦNG TRUY VẤN. Component nhận về MẢNG DÒNG đã dựng
// sẵn (`ReactNode[]` — Server Component truyền thẳng sang được) rồi chỉ vẽ trang hiện tại.
// Nghĩa là:
//   · Sửa một bảng = đổi đúng khối `<table>`, không phải viết lại truy vấn + searchParams
//     của trang đó ⇒ đổi được cả trăm bảng mà không đụng vào tầng dữ liệu.
//   · Bấm sang trang là TỨC THÌ, không round-trip server.
//   · NHƯNG nó KHÔNG làm truy vấn nhẹ đi. Bảng nào lớn tới mức nặng truy vấn (lead, học
//     viên toàn hệ) thì vẫn phải phân trang ở tầng DB — xem `/admin/leads` làm mẫu.
//
// Trạng thái để ở CLIENT, không nhét vào URL: đổi số dòng/trang là việc xem, không phải
// việc điều hướng — nhét vào URL thì mỗi lần bấm là một lần render lại server, và nút Back
// của trình duyệt biến thành nút "lùi một trang bảng".

import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DieuHuongTrang } from "@/components/ui/dieu-huong-trang";
import { cn } from "@/lib/utils";

// Hằng số ở module LÁ (không "use client") để Server Component dùng được — xem
// lib/ui/phan-trang.ts. Re-export ở đây cho caller cũ khỏi phải sửa.
export { MUC_SO_DONG, SO_DONG_MAC_DINH } from "@/lib/ui/phan-trang";
import { MUC_SO_DONG, SO_DONG_MAC_DINH } from "@/lib/ui/phan-trang";

const KHOA_LUU = "satarobo:bang:soDong";

export type BangPhanTrangProps = {
  /** Nội dung `<thead>` — thường là một `<tr>`. */
  head: ReactNode;
  /** MỘT phần tử = MỘT `<tr>`. Đã dựng sẵn ở phía gọi (server hoặc client đều được). */
  rows: ReactNode[];
  /** Số cột — để ô "không có dữ liệu" trải hết bảng. */
  colSpan: number;
  /** Hiện trong dòng đếm: "120 học viên". Mặc định "dòng". */
  tenDonVi?: string;
  /** Nội dung khi bảng rỗng. Mặc định một dòng chữ mờ. */
  trong?: ReactNode;
  /**
   * Khoá ghi nhớ số dòng/trang người dùng chọn (localStorage). Bỏ trống thì nhớ chung cho
   * mọi bảng — chọn 50 ở màn học viên thì màn lớp cũng 50, đó là hành vi MONG MUỐN: người
   * dùng chọn "tôi thích xem 50" chứ không chọn cho từng bảng.
   */
  khoaGhiNho?: string;
  soDongMacDinh?: number;
  className?: string;
  tableClassName?: string;
  theadClassName?: string;
  tbodyClassName?: string;
};

export function BangPhanTrang({
  head,
  rows,
  colSpan,
  tenDonVi = "dòng",
  trong,
  khoaGhiNho,
  soDongMacDinh = SO_DONG_MAC_DINH,
  className,
  tableClassName,
  theadClassName,
  tbodyClassName,
}: BangPhanTrangProps) {
  const [soDong, setSoDong] = useState(soDongMacDinh);
  const [trang, setTrang] = useState(1);
  const idSelect = useId();
  const khoa = khoaGhiNho ? `${KHOA_LUU}:${khoaGhiNho}` : KHOA_LUU;

  // Đọc lựa chọn cũ SAU khi mount — đọc lúc render đầu là lệch server/client (hydrate).
  useEffect(() => {
    // localStorage có thể NÉM (Safari chế độ riêng tư, trình duyệt chặn lưu trữ) — hỏng
    // chỗ ghi nhớ tuỳ chọn thì thôi dùng mặc định, đừng làm vỡ cả bảng.
    try {
      const luu = Number(window.localStorage?.getItem(khoa));
      if (MUC_SO_DONG.includes(luu as (typeof MUC_SO_DONG)[number])) setSoDong(luu);
    } catch {
      /* bỏ qua */
    }
  }, [khoa]);

  const tong = rows.length;
  const soTrang = Math.max(1, Math.ceil(tong / soDong));

  // Dữ liệu đổi (lọc/tìm kiếm ở phía trên) làm số trang co lại → đang đứng ở trang 7 mà
  // chỉ còn 2 trang thì bảng trắng trơn, người dùng tưởng mất dữ liệu. Xử bằng cách KẸP
  // ngay lúc đọc (`Math.min` ở dưới) thay vì `useEffect` gọi `setTrang` — effect ấy tạo
  // thêm một vòng render mà không đổi gì người dùng thấy được, và đã bị đột biến bắt là
  // code chết (11/08/2026).

  const trangHienTai = useMemo(() => {
    const dau = (Math.min(trang, soTrang) - 1) * soDong;
    return rows.slice(dau, dau + soDong);
  }, [rows, trang, soTrang, soDong]);

  function doiSoDong(n: number) {
    setSoDong(n);
    setTrang(1); // đang ở trang 5 với 10 dòng, đổi sang 100 dòng thì trang 5 không tồn tại
    try {
      window.localStorage?.setItem(khoa, String(n));
    } catch {
      /* bỏ qua — xem ghi chú ở useEffect */
    }
  }

  const tu = tong === 0 ? 0 : (Math.min(trang, soTrang) - 1) * soDong + 1;
  const den = Math.min(tong, Math.min(trang, soTrang) * soDong);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="overflow-x-auto">
        <table className={cn("w-full text-sm", tableClassName)}>
          <thead className={theadClassName}>{head}</thead>
          <tbody className={tbodyClassName}>
            {tong === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-10 text-center text-muted-foreground">
                  {trong ?? "Chưa có dữ liệu."}
                </td>
              </tr>
            ) : (
              trangHienTai.map((r, i) => <Fragment key={i}>{r}</Fragment>)
            )}
          </tbody>
        </table>
      </div>

      {/* Thanh điều khiển ẩn khi bảng ngắn hơn mức nhỏ nhất — đừng bày nút bấm vô dụng. */}
      {tong > MUC_SO_DONG[0] && (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <label htmlFor={idSelect} className="whitespace-nowrap">
              Hiển thị
            </label>
            <select
              id={idSelect}
              value={soDong}
              onChange={(e) => doiSoDong(Number(e.target.value))}
              className="h-8 rounded-lg border border-border bg-background py-0 pl-2 pr-7 text-sm text-foreground outline-none focus:border-primary"
            >
              {MUC_SO_DONG.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="whitespace-nowrap">
              / {tong} {tenDonVi}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap tabular-nums">
              {tu}–{den} · trang {Math.min(trang, soTrang)}/{soTrang}
            </span>
            <DieuHuongTrang trang={Math.min(trang, soTrang)} soTrang={soTrang} onDoi={setTrang} />
          </div>
        </div>
      )}
    </div>
  );
}
