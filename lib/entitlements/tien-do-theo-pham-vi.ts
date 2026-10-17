// lib/entitlements/tien-do-theo-pham-vi.ts — SỐ "ĐÃ HỌC / CÒN LẠI" THEO QUYỀN HỌC, không theo `Course.totalSessions`. THUẦN.
//
// 🔴 CHƯA CÓ NƠI NÀO GỌI. Hôm nay "đã học / còn lại" của phụ huynh và giáo viên có ít nhất SÁU nguồn tự đếm
// (`getStudentClassProgress`, `attendanceSummary*`, `lib/progress.ts`, `report-card-v2`, `demBuoi`, `renewal.ts`),
// mẫu số đều là số buổi cả khoá. Gói lẻ (12/24/36 buổi) làm mẫu số đó sai. Hàm này là MỘT adapter: nhận con số của
// đường cũ (`base`) và thay bằng con số theo quyền học — để các nơi tự đếm gọi vào, không phải nơi nào cũng tự tính lại.
//
// Ranh giới (để cắm được vào nhiều kiểu `base`): đầu vào `base` chỉ cần CÓ sáu trường của `TienDoCoSo` — cấu trúc của
// `StudentProgress` — và mọi trường khác được giữ nguyên (generic). File này KHÔNG import `lib/students/progress` (nó kéo `db`).
//
// ⚠️ DANH SÁCH QUYỀN HỌC RỖNG, HOẶC KHÔNG CÁI NÀO ĐƯỢC TÍNH ⇒ TRẢ CHÍNH `base`: đường cũ nguyên vẹn (LEGACY). Đây là chỗ
// dễ vỡ lặng lẽ: học viên chỉ còn quyền học ĐÃ ĐÓNG (`COMPLETED`/`EXPIRED`/`STOPPED`) mà người gọi không đưa các trạng thái
// đó vào `trangThaiTinh` sẽ bị coi là LEGACY và hiện lại mẫu số cả khoá. Vì vậy `trangThaiTinh` là tham số BẮT BUỘC —
// người gọi nói rõ "những trạng thái nào là phạm vi đang tính" thay vì thừa hưởng một mặc định nào đó. `VOIDED` thì không
// bao giờ được tính, dù có đưa vào. Quyền học chưa chốt phạm vi (`start/end` còn null — `AWAITING_PLACEMENT`) không thể
// đưa vào hàm này; người gọi lọc trước.
//
// BÀI THUỘC PHẠM VI = `phanLoaiBai(q, L) === "TRONG_PHAM_VI"`: nằm trong [start, end] và KHÔNG bị bỏ qua. Bài ân hạn và
// bài ngoài phạm vi không phải "đã diễn ra" của gói này; buổi vắng ở bài TRƯỚC phạm vi không tính là vắng.
import { phanLoaiBai, tinhConLai } from "./tieu-thu";
import type { QuyenHocChoRoster } from "./roster";
import type { TrangThaiQuyenHoc } from "./trang-thai";

/** Sáu trường của `StudentProgress` (lib/students/progress.ts) — tái khai báo để không kéo `db` vào hàm thuần. */
export interface TienDoCoSo {
  readonly total: number;
  readonly attended: number;
  readonly remaining: number;
  readonly absentNoMakeup: number;
  readonly sessionsHeld: number;
  readonly currentSession: number;
}

export interface SuThatLop {
  /** Những trạng thái quyền học được tính vào tiến độ. Bắt buộc, không mặc định (xem đầu file). */
  readonly trangThaiTinh: ReadonlySet<TrangThaiQuyenHoc>;
  /** Số bài giáo trình mà lớp đã dạy (buổi sống, đã diễn ra theo lịch thực). Trùng lặp được phép. */
  readonly baiDaDienRa: readonly number[];
  /** Số bài mà học viên VẮNG và chưa bù. Trùng lặp được phép. */
  readonly baiVangKhongBu: readonly number[];
}

export interface AnHanTienDo {
  readonly duocCap: number;
  readonly daDung: number;
  readonly conLai: number;
  /** Có quyền học đang hết số buổi mà còn ân hạn. */
  readonly dangAnHan: boolean;
}

export type TienDoTheoPhamVi<T extends TienDoCoSo> = T & { readonly theoPhamVi: true; readonly anHan: AnHanTienDo };

export function tienDoTheoPhamVi<T extends TienDoCoSo>(
  base: T,
  quyenHoc: readonly QuyenHocChoRoster[],
  thuc: SuThatLop,
): T | TienDoTheoPhamVi<T> {
  const tinh = quyenHoc.filter((q) => q.status !== "VOIDED" && thuc.trangThaiTinh.has(q.status));
  if (tinh.length === 0) return base;

  const trongPhamVi = (bai: number) => tinh.some((q) => phanLoaiBai(q, bai) === "TRONG_PHAM_VI");
  const dem = (ds: readonly number[]) => new Set(ds.filter(trongPhamVi)).size;

  const total = tinh.reduce((s, q) => s + q.purchaseSessions, 0);
  const attended = tinh.reduce((s, q) => s + q.consumedSessions, 0);
  const remaining = tinh.reduce((s, q) => s + Math.max(0, tinhConLai(q, q.consumedSessions)), 0);
  const sessionsHeld = dem(thuc.baiDaDienRa);
  const absentNoMakeup = dem(thuc.baiVangKhongBu);
  // Cùng kết quả với `computeStudentProgress`: buổi đang học = buổi kế tiếp chưa diễn ra; hết thì dừng ở tổng.
  const currentSession = total === 0 ? 0 : Math.min(total, sessionsHeld + 1);

  const duocCap = tinh.reduce((s, q) => s + q.graceSessionsGranted, 0);
  const daDung = tinh.reduce((s, q) => s + q.graceSessionsUsed, 0);
  const dangAnHan = tinh.some((q) => q.status === "EXHAUSTED" && q.graceSessionsUsed < q.graceSessionsGranted);

  return {
    ...base,
    total,
    attended,
    remaining,
    absentNoMakeup,
    sessionsHeld,
    currentSession,
    theoPhamVi: true,
    anHan: { duocCap, daDung, conLai: Math.max(0, duocCap - daDung), dangAnHan },
  };
}
