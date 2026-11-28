// "Đề nghị đào tạo" của người học — phần THUẦN: chọn quý, nhãn trạng thái, dòng thời gian của phiếu.
// Không import React/DB ⇒ test được bằng Vitest.
//
// ⚠️ Chỉ vẽ trạng thái MÔ HÌNH HIỆN CÓ biết: NEW / APPROVED (training-need.ts cố ý tối giản, Q14 chưa chốt — BLOCKERS B-06).
// KHÔNG có "đang xem", "từ chối", "rút" ở đây: chưa có cột/enum/action thì vẽ ra là hứa suông (luật 12).

import type { NhomMau } from "./nhom-mau-trang-thai";

const QUY = /^(\d{4})-Q([1-4])$/;

/** "2027-Q1" → "Q1/2027"; chuỗi không đúng dạng thì giữ nguyên (không đoán). */
export function nhanQuy(q: string): string {
  const m = QUY.exec(q);
  return m ? `Q${m[2]}/${m[1]}` : q;
}

/** Quý đang diễn ra + `soQuy - 1` quý kế tiếp, theo giờ VN. `gia tri` đúng dạng schema yêu cầu (`2026-Q3`). */
export function cacQuyDeNghi(now: Date, soQuy = 6): { gia: string; nhan: string }[] {
  const vn = new Date(now.getTime() + 7 * 3_600_000); // UTC+7 không DST
  let nam = vn.getUTCFullYear();
  let quy = Math.floor(vn.getUTCMonth() / 3) + 1;
  const ra: { gia: string; nhan: string }[] = [];
  for (let i = 0; i < soQuy; i += 1) {
    const gia = `${nam}-Q${quy}`;
    ra.push({ gia, nhan: nhanQuy(gia) });
    quy += 1;
    if (quy > 4) {
      quy = 1;
      nam += 1;
    }
  }
  return ra;
}

export type TrangThaiPhieu = "NEW" | "APPROVED";

/** Nhãn người học đọc được. Trạng thái lạ in nguyên mã, không đoán. */
export function nhanTrangThaiPhieu(status: string): { nhan: string; nhom: NhomMau } {
  if (status === "APPROVED") return { nhan: "Đã duyệt", nhom: "da-duyet" };
  if (status === "NEW") return { nhan: "Chờ duyệt", nhom: "chu-y" };
  return { nhan: status, nhom: "chua-bat-dau" };
}

export type BuocThoiGian = { id: string; nhan: string; chiTiet: string | null; thoiDiem: Date | null; xong: boolean };

/**
 * Dòng thời gian CHỈ gồm những gì dữ liệu biết:
 *  1. Đã gửi (luôn có — `createdAt`);
 *  2. Đã duyệt (khi `APPROVED`, kèm người duyệt + ngày nếu có) — nếu chưa: "Chờ phòng Đào tạo xem xét";
 *  3. Thành chương trình (khi phiếu đã gắn ≥ 1 chương trình).
 * Không có bước "đang xem" / "từ chối" (chưa có dữ liệu — Q14).
 */
export function dongThoiGianPhieu(p: {
  createdAt: Date;
  status: string;
  approvedAt: Date | null;
  nguoiDuyet: string | null;
  tenChuongTrinh: readonly string[];
}): BuocThoiGian[] {
  const duyet = p.status === "APPROVED";
  const buoc: BuocThoiGian[] = [
    { id: "gui", nhan: "Đã gửi", chiTiet: null, thoiDiem: p.createdAt, xong: true },
    duyet
      ? { id: "duyet", nhan: "Đã duyệt", chiTiet: p.nguoiDuyet ? `Bởi ${p.nguoiDuyet}` : null, thoiDiem: p.approvedAt, xong: true }
      : { id: "duyet", nhan: "Chờ phòng Đào tạo xem xét", chiTiet: null, thoiDiem: null, xong: false },
  ];
  if (duyet) {
    buoc.push(
      p.tenChuongTrinh.length > 0
        ? { id: "chuong-trinh", nhan: "Đã thành chương trình", chiTiet: p.tenChuongTrinh.join(", "), thoiDiem: null, xong: true }
        : { id: "chuong-trinh", nhan: "Chờ lập chương trình", chiTiet: null, thoiDiem: null, xong: false },
    );
  }
  return buoc;
}
