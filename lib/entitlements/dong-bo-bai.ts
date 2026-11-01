// lib/entitlements/dong-bo-bai.ts — "BÀI L CỦA BÉ CÓ ĐƯỢC ĐẾM VÀO SỔ CÁI KHÔNG": quyết định THUẦN, HỘI TỤ. Chưa ai gọi.
//
// Vì sao không "tăng/giảm theo sự kiện": `huyGhiNhanBai` huỷ theo (quyền học, bài) mà KHÔNG nhìn nguồn của dòng. Hậu quả
// đo được trên giấy: học bù xong → giáo viên lưu lại lưới (vẫn VẮNG) → "điểm danh bị sửa" → huỷ NHẦM dòng MAKEUP.
// Chuỗi vắng → bù → sửa có mặt → hoàn bù cũng lệch. Sửa tận gốc: mỗi lần đồng bộ TÍNH LẠI từ bằng chứng hiện có, rồi mới
// ghi/huỷ cho khớp. Hai lần đồng bộ liên tiếp luôn cho cùng kết quả (`[SCP-16]`).
//
// BẰNG CHỨNG (cho bài L của một học viên trên một khoá):
//   · có Attendance `PRESENT`/`LATE` ở BẤT KỲ buổi lớp chính nào của khoá mang số bài L  → nguồn `CLASS`;
//   · có mục học bù HOÀN TẤT cho bài L (buổi vắng đã bù)                                   → nguồn `MAKEUP`;
//   · có mục học vượt HOÀN TẤT cho bài L (không có Attendance — quyết định HB-13)          → nguồn `CATCH_UP`.
// Ưu tiên khi có nhiều bằng chứng: CLASS > MAKEUP > CATCH_UP (có mặt ở lớp chính là nguồn gốc).
//
// DÒNG SỔ CÁI KHÔNG DO BẰNG CHỨNG SINH RA (`MANUAL` do người ghi, `GRACE` do ngưỡng ân hạn) thì hàm này KHÔNG ĐỤNG TỚI:
// thiếu bằng chứng điểm danh không phải lý do để huỷ chúng, và dòng đã bị vô hiệu cũng không tự bật lại.
//
// Hàm KHÔNG biết dòng mới ghi sẽ là tiêu thụ hay ân hạn (`GRACE`) — đó là việc của `quyetDinhGhiNhan` khi người gọi
// thật sự ghi. `GHI`/`BAT_LAI` chỉ nói "bài này phải được đếm, với nguồn bằng chứng này".
import { PRESENT_STATUSES } from "@/lib/labels";
import type { NguonSoCai } from "./tieu-thu";

export type NguonBangChung = "CLASS" | "MAKEUP" | "CATCH_UP";

/** Dòng `StudyEntitlementUsage` hiện có của (quyền học, bài). `null` = chưa có dòng. */
export interface DongSoCaiHienCo {
  readonly source: NguonSoCai;
  readonly voidedAt: Date | null;
}

export interface BangChungBai {
  /** `Attendance.status` của học viên ở MỌI buổi lớp chính của khoá mang đúng số bài này (chuỗi thô từ DB). */
  readonly trangThaiDiemDanh: readonly string[];
  /** Có mục học bù HOÀN TẤT cho bài này. */
  readonly hocBuHoanTat: boolean;
  /** Có mục học vượt HOÀN TẤT cho bài này. */
  readonly hocVuotHoanTat: boolean;
}

export type QuyetDinhDongBoBai =
  | { readonly hanhDong: "GHI"; readonly nguon: NguonBangChung }
  | { readonly hanhDong: "BAT_LAI"; readonly nguon: NguonBangChung }
  | { readonly hanhDong: "HUY" }
  | { readonly hanhDong: "GIU" }
  | { readonly hanhDong: "BO_QUA"; readonly lyDo: "KHONG_CO_BANG_CHUNG" | "DONG_THU_CONG" };

/** Nguồn của dòng do chính cơ chế bằng chứng sinh ra — chỉ những dòng này hàm được phép huỷ/bật lại. */
const NGUON_DO_BANG_CHUNG: ReadonlySet<NguonSoCai> = new Set<NguonSoCai>(["CLASS", "MAKEUP", "CATCH_UP"]);

function nguonBangChung(b: BangChungBai): NguonBangChung | null {
  // `PRESENT_STATUSES` kiểu `Set<AttendanceStatusValue>`; chuỗi thô từ DB nên ép kiểu để tra — giá trị lạ tra ra false.
  if (b.trangThaiDiemDanh.some((s) => (PRESENT_STATUSES as ReadonlySet<string>).has(s))) return "CLASS";
  if (b.hocBuHoanTat) return "MAKEUP";
  if (b.hocVuotHoanTat) return "CATCH_UP";
  return null;
}

export function quyetDinhDongBoBai(vao: { dong: DongSoCaiHienCo | null; bangChung: BangChungBai }): QuyetDinhDongBoBai {
  const { dong, bangChung } = vao;
  const nguon = nguonBangChung(bangChung);

  if (dong === null) {
    return nguon ? { hanhDong: "GHI", nguon } : { hanhDong: "BO_QUA", lyDo: "KHONG_CO_BANG_CHUNG" };
  }

  if (!NGUON_DO_BANG_CHUNG.has(dong.source)) {
    return dong.voidedAt === null ? { hanhDong: "GIU" } : { hanhDong: "BO_QUA", lyDo: "DONG_THU_CONG" };
  }

  if (dong.voidedAt === null) return nguon ? { hanhDong: "GIU" } : { hanhDong: "HUY" };
  return nguon ? { hanhDong: "BAT_LAI", nguon } : { hanhDong: "BO_QUA", lyDo: "KHONG_CO_BANG_CHUNG" };
}
