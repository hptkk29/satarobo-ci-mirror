// lib/portal/tien-do-pham-vi.ts — TIẾN ĐỘ CỔNG PHỤ HUYNH THEO PHẠM VI ĐÃ ĐĂNG KÝ (QĐ-16, QĐ-54). THUẦN, không chạm DB.
//
// Một adapter mỏng giữa cổng phụ huynh và `tienDoTheoPhamVi` (lib/entitlements): đường cũ tính xong TRƯỚC, hàm ở đây chỉ quyết
// "thay con số cũ bằng con số theo quyền học hay không" và dịch kết quả ra thứ màn hình đọc. Mọi `import` từ `lib/entitlements` của
// phía cổng phụ huynh nằm ở hai tệp này (`-db` là nơi hỏi cờ) — để lưới `chua-noi.test.ts` đếm được.
//
// ── QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN (sổ quyết định E:\ba-src\decisions.md) ────────────────────────────────────────────────────
//   QĐ-54  site phụ huynh HIỂN THỊ các buổi trước khi con vào lớp, nhãn "ngoài phạm vi đăng ký", KHÔNG tính vào tiến độ / chuyên cần.
//   QĐ-16  học vượt hiển thị RIÊNG và được tính là đã học bài tương ứng (nó đã nằm trong sổ cái ⇒ trong `attended`).
//
// ── LUẬT ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
//  1. KHÔNG ÁP DỤNG ⇒ TRẢ CHÍNH ĐỐI TƯỢNG CŨ (`toBe`), không sao chép, không thêm trường. Các trường mới (`hocVuot`, nhãn buổi) chỉ
//     tồn tại trên nhánh theo-phạm-vi, nên hình dạng của đường cũ không đổi một byte.
//  2. ÁP DỤNG khi và chỉ khi: có ĐÚNG hai điều — (a) ít nhất một quyền học `ACTIVE` của (học viên, khoá, cơ sở của lớp); (b) MỌI buổi
//     đã diễn ra và mọi dòng điểm danh của lớp đều xác định được "bài thứ mấy". Thiếu (b) mà vẫn áp dụng thì hàm thuần lặng lẽ
//     BỎ buổi chưa ghim giáo trình ⇒ đếm thiếu (fixture test 19/10 có đúng 12 buổi như vậy). Không chắc thì giữ số cũ.
//  3. TẬP TRẠNG THÁI ĐƯỢC TÍNH ≠ CỔNG. Cổng là "có ACTIVE" (đúng yêu cầu); còn tập tính phải gồm cả `EXHAUSTED` và `COMPLETED`, nếu
//     không thì lần MUA TIẾP (EXHAUSTED → COMPLETED) làm 12 buổi đã trả của gói trước tụt thành "ngoài phạm vi" và biến khỏi "đã học".
//  4. NHÃN BUỔI VÀ SỐ ĐẾM CÙNG MỘT VỊ TỪ: buổi bị gắn "ngoài phạm vi" ⇔ `tienDoTheoPhamVi` không đếm nó (`laBaiTrongPhamVi`). Hai nơi
//     tự viết hai điều kiện là cách phụ huynh thấy nhãn "ngoài phạm vi" ở đúng buổi mà số "đã học" lại có đếm.
//  5. NHÃN CHỮ chỉ lấy từ `nhanLyDo` (lib/entitlements/roster.ts). Không chép chuỗi "ngoài phạm vi đăng ký" ở nơi nào khác.
import {
  computeAttendanceSummary,
  type AttendanceSummary,
} from "@/lib/attendance/summary";
import type { AttendanceStatusValue, MakeupStatusValue } from "@/lib/labels";
import { nhanLyDo, type QuyenHocChoRoster } from "@/lib/entitlements/roster";
import { phanLoaiBai } from "@/lib/entitlements/tieu-thu";
import { tienDoTheoPhamVi, type TienDoCoSo, type TienDoTheoPhamVi } from "@/lib/entitlements/tien-do-theo-pham-vi";
import type { TrangThaiQuyenHoc } from "@/lib/entitlements/trang-thai";
import { soBuoiTheoLoTrinh } from "@/lib/lms/session-order";

/**
 * Trạng thái quyền học được TÍNH vào tiến độ. Xem luật 3. `FROZEN` / `EXPIRED` / `STOPPED` / `SEAT_HOLD` CỐ Ý chưa nằm ở đây — chưa có
 * quyết định cho chúng (câu hỏi mở trong PR); quyền học ở các trạng thái đó không bị tính, không bị coi là LEGACY nếu còn ACTIVE khác.
 */
export const TRANG_THAI_TINH_PORTAL: ReadonlySet<TrangThaiQuyenHoc> = new Set<TrangThaiQuyenHoc>(["ACTIVE", "EXHAUSTED", "COMPLETED"]);

export interface DongDiemDanhPhamVi {
  /** Bài thứ mấy của lộ trình (`soBuoiTheoLoTrinh`), `null` = buổi chưa ghim giáo trình. */
  readonly lessonOrder: number | null;
  readonly status: AttendanceStatusValue;
  readonly makeupStatus: MakeupStatusValue | null;
}

/** Mọi thứ cần để tính tiến độ theo phạm vi cho MỘT lớp của MỘT học viên. Do `tien-do-pham-vi-db.ts` dựng. */
export interface PhamViLop {
  readonly classId: string;
  readonly courseId: string;
  /** Quyền học của (học viên, khoá) ĐÃ lọc theo cơ sở của lớp, đã loại VOIDED và quyền chưa chốt phạm vi. */
  readonly quyenHoc: readonly QuyenHocChoRoster[];
  /** Bài của các buổi đã diễn ra tới HẾT NGÀY hôm nay (VN) — mốc của "đang học buổi X", cùng mốc `getStudentClassProgress`. */
  readonly baiDenHetNgay: readonly number[];
  /** Bài của các buổi đã diễn ra tới THỜI ĐIỂM HIỆN TẠI, đã bỏ buổi trong khoảng bảo lưu — mốc của chuyên cần, cùng mốc `attendanceSummary`. */
  readonly baiDenBayGio: readonly number[];
  /** Bài mà học viên vắng và chưa bù. */
  readonly baiVangKhongBu: readonly number[];
  /** Dòng điểm danh (buổi chưa huỷ, ngoài khoảng bảo lưu) kèm số bài. */
  readonly diemDanh: readonly DongDiemDanhPhamVi[];
  /** Số buổi/bài mà buổi đã diễn ra hoặc dòng điểm danh KHÔNG xác định được số bài. > 0 ⇒ giữ đường cũ. */
  readonly buoiKhongCoBai: number;
  /** Số bài đã học vượt (dòng sổ cái nguồn CATCH_UP còn hiệu lực) — HIỂN THỊ RIÊNG, đã nằm trong `attended`. */
  readonly hocVuot: number;
}

/** Bài thứ mấy của lộ trình ứng với một buổi (plan.order+1, không plan thì lesson.order) — cùng cách sổ cái điểm danh đếm bài. */
export function baiCuaBuoi(b: { plan?: { order: number } | null; lesson?: { order: number | null } | null }): number | null {
  return soBuoiTheoLoTrinh({ planOrder: b.plan?.order ?? null, lessonOrder: b.lesson?.order ?? null });
}

const TIEN_DO_RONG: TienDoCoSo = { total: 0, attended: 0, remaining: 0, absentNoMakeup: 0, sessionsHeld: 0, currentSession: 0 };

/** Điều kiện ÁP DỤNG theo phạm vi (luật 2). */
export function laApDung(pv: PhamViLop | undefined): pv is PhamViLop {
  return !!pv && pv.buoiKhongCoBai === 0 && pv.quyenHoc.some((q) => q.status === "ACTIVE");
}

/** Quyền học nào được tính. */
const duocTinh = (pv: PhamViLop): readonly QuyenHocChoRoster[] =>
  pv.quyenHoc.filter((q) => q.status !== "VOIDED" && TRANG_THAI_TINH_PORTAL.has(q.status));

/** CÙNG vị từ với `tienDoTheoPhamVi`: bài nằm trong phạm vi của ít nhất một quyền học được tính (không bỏ qua, không ân hạn). */
export function laBaiTrongPhamVi(pv: PhamViLop, lessonOrder: number): boolean {
  return duocTinh(pv).some((q) => phanLoaiBai(q, lessonOrder) === "TRONG_PHAM_VI");
}

/** Số liệu theo phạm vi của một lớp, hoặc `null` khi không áp dụng. `moc` chọn mốc "đã diễn ra" (xem `PhamViLop`). */
export function soLieuPhamVi(pv: PhamViLop | undefined, moc: "HET_NGAY" | "BAY_GIO"): TienDoTheoPhamVi<TienDoCoSo> | null {
  if (!laApDung(pv)) return null;
  const r = tienDoTheoPhamVi(TIEN_DO_RONG, pv.quyenHoc, {
    trangThaiTinh: TRANG_THAI_TINH_PORTAL,
    baiDaDienRa: moc === "HET_NGAY" ? pv.baiDenHetNgay : pv.baiDenBayGio,
    baiVangKhongBu: pv.baiVangKhongBu,
  });
  return r === TIEN_DO_RONG ? null : (r as TienDoTheoPhamVi<TienDoCoSo>);
}

export type TienDoPortal<T extends TienDoCoSo> = T | (TienDoTheoPhamVi<T> & { readonly hocVuot: number });

/**
 * "Đang học buổi X / tổng · đã học · còn lại" của một lớp. `base` là kết quả ĐƯỜNG CŨ (đã tính xong); không áp dụng ⇒ trả chính `base`.
 * Áp dụng ⇒ mọi trường khác của `base` được giữ (generic), thêm `theoPhamVi`, `anHan`, `hocVuot`.
 */
export function tienDoPortal<T extends TienDoCoSo>(base: T, pv: PhamViLop | undefined): TienDoPortal<T> {
  if (!laApDung(pv)) return base;
  const r = tienDoTheoPhamVi(base, pv.quyenHoc, {
    trangThaiTinh: TRANG_THAI_TINH_PORTAL,
    baiDaDienRa: pv.baiDenHetNgay,
    baiVangKhongBu: pv.baiVangKhongBu,
  });
  if (r === base) return base;
  return { ...(r as TienDoTheoPhamVi<T>), hocVuot: pv.hocVuot };
}

export type TomTatDiemDanhPortal = AttendanceSummary | (AttendanceSummary & { readonly hocVuot: number });

/**
 * 5 chỉ số điểm danh của một lớp. Không áp dụng ⇒ trả chính `base`.
 *
 * `attended` lấy từ MỘT nguồn duy nhất — sổ cái quyền học, cùng nguồn với thẻ "Đã học" ở `tienDoPortal` (nếu lấy từ dòng điểm danh thì
 * học vượt, vốn không có dòng điểm danh, rơi mất và hai thẻ trên cùng màn hình lệch nhau). Vắng / chờ bù / đã bù đếm từ dòng điểm danh
 * NẰM TRONG phạm vi, cùng vị từ với tiến độ.
 */
export function tomTatDiemDanhPortal(base: AttendanceSummary, pv: PhamViLop | undefined): TomTatDiemDanhPortal {
  const so = soLieuPhamVi(pv, "BAY_GIO");
  if (!so || !pv) return base;
  const trongPhamVi = pv.diemDanh.filter((d) => d.lessonOrder !== null && laBaiTrongPhamVi(pv, d.lessonOrder));
  const dem = computeAttendanceSummary({
    totalLessons: so.total,
    sessionsHeld: so.sessionsHeld,
    attendances: trongPhamVi.map((d) => ({ status: d.status, makeupStatus: d.makeupStatus })),
  });
  return {
    total: so.total,
    daDienRa: so.sessionsHeld,
    attended: so.attended,
    absent: dem.absent,
    needMakeup: dem.needMakeup,
    madeUp: dem.madeUp,
    hocVuot: pv.hocVuot,
  };
}

/** Khối "Điểm danh x/y · %" của trang Kết quả (`lib/progress.ts`). Không áp dụng ⇒ trả chính `p`. */
export function diemDanhKetQua<P extends { totalSessions: number; attendedSessions: number; attendanceRate: number }>(
  p: P,
  pv: PhamViLop | undefined,
): P {
  const so = soLieuPhamVi(pv, "BAY_GIO");
  if (!so) return p;
  return {
    ...p,
    totalSessions: so.sessionsHeld,
    attendedSessions: so.attended,
    attendanceRate: so.sessionsHeld > 0 ? Math.round((so.attended / so.sessionsHeld) * 100) : 0,
  };
}

export interface NhanBuoiPhamVi {
  /** `true` ⇔ buổi này KHÔNG được tính vào tiến độ / chuyên cần. */
  readonly ngoaiPhamVi: boolean;
  /** Chữ hiện cho phụ huynh, hoặc `null` (buổi trong phạm vi, hoặc chưa có quyết định về chữ — xem dưới). */
  readonly nhan: string | null;
}

/**
 * Nhãn cho MỘT buổi trong danh sách lịch học. `undefined` ⇒ đường cũ (không thêm gì vào hàng buổi).
 *
 * · bài thuộc phạm vi ⇒ không nhãn · số bài chưa biết ⇒ không nhãn (không đoán)
 * · NGOAI_PHAM_VI ⇒ `nhanLyDo("NGOAI_PHAM_VI")`, kèm dải bài khi chỉ có MỘT quyền học được tính
 * · BO_QUA ⇒ `nhanLyDo("BO_QUA")`
 * · AN_HAN ⇒ ngoài phạm vi (không đếm) nhưng CHƯA có chữ — chưa ai quyết phải nói gì với phụ huynh về buổi ân hạn.
 */
export function nhanBuoiPhamVi(pv: PhamViLop | undefined, lessonOrder: number | null): NhanBuoiPhamVi | undefined {
  if (!laApDung(pv)) return undefined;
  if (lessonOrder === null || laBaiTrongPhamVi(pv, lessonOrder)) return { ngoaiPhamVi: false, nhan: null };
  const tinh = duocTinh(pv);
  const loai = new Set(tinh.map((q) => phanLoaiBai(q, lessonOrder)));
  if (loai.has("BO_QUA")) return { ngoaiPhamVi: true, nhan: nhanLyDo("BO_QUA") };
  if (loai.has("AN_HAN")) return { ngoaiPhamVi: true, nhan: null };
  const dai = tinh.length === 1 ? { start: tinh[0].startLessonOrder, end: tinh[0].endLessonOrder } : undefined;
  return { ngoaiPhamVi: true, nhan: nhanLyDo("NGOAI_PHAM_VI", dai) };
}
