// lib/finance/hoa-don/bam-nguoi-mua.ts — dấu vân tay của khối NGƯỜI MUA. THUẦN (chỉ `node:crypto`).
//
// PLAN §2.2 `nguoiMuaHashLucIn`: kế toán tải phiếu chờ (②) rồi sang MISA làm hoá đơn — có thể hàng
// giờ sau mới quay lại xác nhận (⑤). Trong khoảng đó sale sửa MST / tên đơn vị trên đơn thì hoá đơn
// đã xuất mang thông tin CŨ. Hai đầu so dấu này để CẢNH BÁO (không chặn — hoá đơn đã nằm ở MISA).
//
// Tách khỏi `nguoi-mua.ts` vì tệp đó được component client import (`thong-tin-hoa-don.tsx`) —
// kéo `node:crypto` vào bundle trình duyệt là vỡ build.

import { createHash } from "node:crypto";
import type { NguoiMuaHoaDon } from "./nguoi-mua";

/** Chuẩn hoá khoảng trắng + chữ hoa/thường — sửa "Công ty  ABC" thành "Công ty ABC" không phải đổi người mua. */
function chuan(v: string | null): string {
  return (v ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function bamNguoiMua(nm: NguoiMuaHoaDon): string {
  // Mảng CÓ THỨ TỰ qua JSON — ghép chuỗi trần thì ("ab","") và ("a","b") ra cùng một dấu.
  const truong = [nm.hoTen, nm.tenDonVi, nm.maSoThue, nm.diaChi, nm.cccd, nm.email, nm.dienThoai].map(chuan);
  // 05/11/2026 — mã khách hàng CHỈ vào dấu khi có. Thêm phần tử thứ 8 vô điều kiện sẽ đổi dấu của MỌI hoá đơn
  // đã có (mã trống ⇒ "" ở cuối mảng) và đánh «người mua đã sửa sau khi in» oan lên tất cả. Lưới `[BNM-MA-*]`.
  if (chuan(nm.maKhachHang) !== "") truong.push(chuan(nm.maKhachHang));
  return createHash("sha256").update(JSON.stringify(truong)).digest("hex").slice(0, 32);
}
