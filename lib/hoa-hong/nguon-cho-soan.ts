// lib/hoa-hong/nguon-cho-soan.ts — NGUỒN trong ô «Nhóm nguồn» của trình soạn chính sách: trạng thái hiện cho người soạn + chọn sẵn từ `?nguon=`. THUẦN, an toàn cho client.
//
// Vì sao có tệp này: danh sách nguồn của trình soạn từng chỉ lấy nguồn ACTIVE. Nguồn do admin tạo bằng giao diện thì có thể Nháp / Ngừng / ngoài khoảng hiệu lực, và bản nháp chính sách
// của một nguồn đã ngừng sẽ mở ra với ô chọn TRẮNG (giá trị không còn trong danh sách), còn bản tóm tắt in «?». Trạng thái nguồn tính MỘT lần ở máy chủ (client không đọc đồng hồ —
// luật 19) rồi chuyển xuống dạng khoá; chữ hiển thị ở `lib/nguon/nhan-hien-thi.ts`.
//
// ⚠️ Hai thứ KHÁC nhau, đừng gộp: cổng kích hoạt (guardrail) chỉ hỏi `status = ACTIVE` (`dangHoatDong`); khoảng hiệu lực chỉ chặn việc CHỌN nguồn cho lead MỚI
// (`lib/nguon/hieu-luc-nguon.ts`) — lead cũ vẫn mang nguồn và vẫn được tính hoa hồng. Nên nguồn ACTIVE nhưng ngoài khoảng hiệu lực vẫn kích hoạt được chính sách: ở đây chỉ NÓI ra, không chặn.
import type { SourceReferrerRequirement, SourceStatus } from "@prisma/client";

import { trongKhoangHieuLuc } from "@/lib/nguon/hieu-luc-nguon";
import { NHAN_TRANG_THAI_NGUON, type KhoaTrangThaiNguon } from "@/lib/nguon/nhan-hien-thi";

export type { KhoaTrangThaiNguon };

/** `now` BẮT BUỘC (luật 19). Biên như `trongKhoangHieuLuc`: bắt đầu ĐÓNG, kết thúc MỞ. */
export function khoaTrangThaiNguon(n: { status: SourceStatus; effectiveFrom: Date | null; effectiveTo: Date | null }, now: Date): KhoaTrangThaiNguon {
  switch (n.status) {
    case "DRAFT":
      return "NHAP";
    case "INACTIVE":
      return "NGUNG";
    case "ARCHIVED":
      return "LUU_TRU";
    case "ACTIVE": {
      if (trongKhoangHieuLuc(n, now)) return "HOAT_DONG";
      return n.effectiveFrom !== null && now.getTime() < n.effectiveFrom.getTime() ? "CHUA_HIEU_LUC" : "HET_HAN";
    }
  }
}

/**
 * Nguồn này có qua được cổng `NGUON_KHONG_HOAT_DONG` của guardrail không — ĐÚNG điều kiện `status = ACTIVE` (ba khoá đầu). Nguồn khác ⇒ chọn nó thì kích hoạt bị chặn,
 * nên ô chọn không mời chọn (trừ khi bản nháp ĐANG mang nó — xem `cac-buoc.tsx`).
 */
export function nguonQuaCongHoatDong(k: KhoaTrangThaiNguon): boolean {
  return k === "HOAT_DONG" || k === "CHUA_HIEU_LUC" || k === "HET_HAN";
}

/** Một nguồn như trình soạn thấy. Mọi thứ đã serialize được (không Date, không Map). */
export type NguonSoan = {
  id: string;
  code: string;
  name: string;
  /** `LeadSourceGroup.commissionEnabled` — «tham gia hoa hồng theo nguồn». false ⇒ các dòng THU HÚT của chính sách riêng của nguồn không chạy và không kích hoạt được (dòng EXCLUDE thì có). */
  coHoaHong: boolean;
  trangThai: KhoaTrangThaiNguon;
  /** Hạn «kết thúc chọn cho lead mới» (ISO, chỉ để in khi `HET_HAN`/`CHUA_HIEU_LUC`). */
  hieuLucTu: string | null;
  hieuLucDen: string | null;
  /** Đã khai `ownerEmployeeId` — đầu vào của vai «người phụ trách nguồn». */
  coNguoiPhuTrach: boolean;
  referrerRequirement: SourceReferrerRequirement;
};

/**
 * `?nguon=<mã>` từ trang chi tiết nguồn → id nhóm để chọn sẵn. Chỉ chọn sẵn khi mã CÓ trong danh sách, nguồn qua được cổng hoạt động, và không phải mã hệ thống «UNKNOWN»
 * (nguồn hệ thống gán, không có chính sách riêng). Mã lạ / nguồn ngừng / Nháp / lưu trữ ⇒ `null`: trình soạn mở ở phạm vi chung, KHÔNG chọn sẵn một nguồn mà bấm Kích hoạt sẽ bị chặn.
 */
export function nguonChonSanTuMa(ma: string | null | undefined, ds: readonly NguonSoan[]): NguonSoan | null {
  const m = (ma ?? "").trim();
  if (m === "" || m === "UNKNOWN") return null;
  const n = ds.find((x) => x.code === m);
  return n && nguonQuaCongHoatDong(n.trangThai) ? n : null;
}

/** Chữ một dòng trong ô chọn: «Tên — có/không tham gia hoa hồng theo nguồn · trạng thái (nếu không phải đang hoạt động)». */
export function nhanLuaChonNguon(n: Pick<NguonSoan, "name" | "coHoaHong" | "trangThai">): string {
  const hoaHong = n.coHoaHong ? "có hoa hồng theo nguồn" : "không tham gia hoa hồng theo nguồn";
  const trangThai = n.trangThai === "HOAT_DONG" ? "" : ` · ${NHAN_TRANG_THAI_NGUON[n.trangThai]}`;
  return `${n.name} — ${hoaHong}${trangThai}`;
}
