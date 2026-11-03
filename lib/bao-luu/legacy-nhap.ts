// lib/bao-luu/legacy-nhap.ts — NHẬP CA "BẢO LƯU CŨ" (LEGACY) vào quy chế SR.QD.236. THUẦN, không DB. PHIÊN 8 (K14, chốt 08/10/2026).
//
// Ba nhóm lấy từ báo cáo chỉ-đọc `docs/bao-luu/legacy-3-nhom.sql`:
//   A — dòng `StudentReserve` CŨ còn mở (chưa duyệt theo quy chế: `approvedAt = NULL`): bổ sung đơn + ngày bắt đầu thực tế (+ gắn ghi danh nếu dòng cũ cả-học-viên);
//   B — ghi danh `PAUSED` KHÔNG có hồ sơ (đi đường tắt): tạo hồ sơ LEGACY;
//   C — ghi danh đang học nhưng 4 buổi gần nhất vắng hết, chưa hồ sơ ("thoả thuận cũ"): tạo hồ sơ LEGACY VÀ chuyển ghi danh sang PAUSED.
//
// ⚠️ Nhập xong, ca ấy là hồ sơ ĐỜI MỚI (`approvedAt ≠ NULL`): bé rời danh sách lớp / nhóm chat theo BR-13, cron `/api/cron/bao-luu` xử lý hạn, cổng phụ huynh
// đổi nhãn. Vì vậy mọi ca đều phải qua BẢN XEM TRƯỚC (cùng hàm này) và việc ghi là một giao dịch tất-cả-hoặc-không.
//
// Luật (chủ dự án chốt 08/10):
//   · hạn = `pause.effectiveDate` + `enrollment.suspendMaxMonths` THÁNG LỊCH (BR-28; KHÔNG tính từ ngày bắt đầu). Chưa có ngày hiệu lực ⇒ CHẶN hết;
//   · bắt buộc đơn đã ký (BR-07, cả LEGACY); ngày bắt đầu thực tế do người nhập, không ở tương lai;
//   · LEGACY tính là MỘT lần đã dùng (Q3, BR-08) — nên ca nhập vào có thể làm ghi danh hết lượt xin bảo lưu mới: báo trước, không chặn.

import { hanToiDaBaoLuu } from "@/lib/bao-luu/tran-bao-luu";
import { laKhoaTepBaoLuu } from "@/lib/bao-luu/tep";
import { parseVnYmd, vnStartOfDay, vnYmd } from "@/lib/time/vn";

export type NhomLegacy = "A" | "B" | "C";
export const NHOM_LEGACY: readonly NhomLegacy[] = ["A", "B", "C"];
export const TRAN_CA_MOI_LUOT = 50;

/** Một ca người dùng chọn nhập. */
export type CaNhap = {
  nhom: NhomLegacy;
  studentId: string;
  /** B, C: bắt buộc. A: bắt buộc khi dòng cũ chưa gắn ghi danh (cả-học-viên); nếu dòng đã gắn thì phải TRÙNG. */
  enrollmentId: string | null;
  /** Chỉ nhóm A. */
  reserveId: string | null;
  /** `yyyy-MM-dd` giờ VN — ngày bé THỰC SỰ bắt đầu nghỉ. */
  ngayBatDau: string;
  applicationFileKey: string | null;
};

/** Sự thật đọc từ DB cho MỘT ca — người gọi (lớp DB) nạp, hàm thuần chỉ phán xử. */
export type SuThat = {
  flagBat: boolean;
  reserve: { id: string; studentId: string; enrollmentId: string | null; isActive: boolean; endedAt: Date | null; approvedAt: Date | null } | null;
  enrollment: { id: string; studentId: string; status: string; deletedAt: Date | null; khoaChoPhepBaoLuu: boolean } | null;
  /** Ghi danh này đã có hồ sơ MỞ nào phủ chưa (kể cả dòng cũ cả-học-viên) — trừ chính `reserve` đang xử lý ở nhóm A. */
  daCoHoSoMoPhu: boolean;
  /** `demLanDaDung` của ghi danh. */
  soLanDaDung: number;
  maxPerEnrollment: number;
};

export type BoiCanh = { effectiveDate: string; maxMonths: number; now: Date };

export type KeHoachCa = {
  hanhDong: "CAP_NHAT_DONG_CU" | "TAO_MOI";
  startedAt: Date;
  han: Date;
  quaHan: boolean;
  soNgayQuaHan: number;
  /** Ghi danh có bị chuyển sang PAUSED không (chỉ nhóm C). */
  chuyenGhiDanhSangPaused: boolean;
  enrollmentId: string;
};

export type KetQuaCa = { loi: string[]; canhBao: string[]; ke: KeHoachCa | null };

const NGAY_MS = 86_400_000;
const TRANG_THAI_DANG_HOC = ["ACTIVE", "STUDYING"] as const;

/** `yyyy-MM-dd` THẬT (chuỗi "2026-13-45" bị `parseVnYmd` cuốn chiếu thành ngày khác nên phải in ngược lại để so). */
export function ngayThat(s: string): Date | null {
  const d = parseVnYmd(s);
  return d && vnYmd(d) === s ? d : null;
}

export function lapKeHoachCa(ca: CaNhap, st: SuThat, b: BoiCanh): KetQuaCa {
  const loi: string[] = [];
  const canhBao: string[] = [];

  // ── Cổng toàn cục ──
  if (!st.flagBat) loi.push("Cơ sở chưa bật bảo lưu (pause.enabled) — bật cờ trước khi nhập ca cũ.");
  const hieuLuc = b.effectiveDate ? ngayThat(b.effectiveDate) : null;
  if (!b.effectiveDate) {
    loi.push("Chưa khai Ngày hiệu lực quy chế bảo lưu (Cấu hình vận hành → tab Học viên) — hạn của ca LEGACY tính từ ngày đó nên chưa nhập được.");
  } else if (!hieuLuc) {
    loi.push("Ngày hiệu lực quy chế bảo lưu trong cấu hình không hợp lệ.");
  }

  // ── Đơn + ngày bắt đầu ──
  if (!ca.applicationFileKey) loi.push("Thiếu đơn bảo lưu đã ký (BR-07 bắt buộc cả ca cũ).");
  else if (!laKhoaTepBaoLuu(ca.applicationFileKey)) loi.push("Khoá tệp đơn không hợp lệ.");
  const dau = ngayThat(ca.ngayBatDau);
  let startedAt: Date | null = null;
  if (!dau) {
    loi.push("Ngày bắt đầu nghỉ thực tế không hợp lệ.");
  } else {
    startedAt = vnStartOfDay(dau);
    if (startedAt.getTime() > vnStartOfDay(b.now).getTime()) loi.push("Ngày bắt đầu nghỉ không được ở tương lai.");
  }

  // ── Theo nhóm ──
  let enrollmentId = ca.enrollmentId;
  let hanhDong: KeHoachCa["hanhDong"] = "TAO_MOI";
  let chuyenPaused = false;

  if (ca.nhom === "A") {
    hanhDong = "CAP_NHAT_DONG_CU";
    const r = st.reserve;
    if (!ca.reserveId || !r || r.id !== ca.reserveId) {
      loi.push("Không tìm thấy dòng bảo lưu cũ cần bổ sung.");
    } else {
      if (r.studentId !== ca.studentId) loi.push("Dòng bảo lưu không thuộc học viên này.");
      if (!r.isActive || r.endedAt) loi.push("Dòng bảo lưu đã kết thúc — không còn là ca đang mở.");
      if (r.approvedAt) loi.push("Dòng bảo lưu này đã được xử lý theo quy chế (đã duyệt) — không nhập lại.");
      if (r.enrollmentId && ca.enrollmentId && r.enrollmentId !== ca.enrollmentId) loi.push("Dòng bảo lưu đã gắn ghi danh khác với ghi danh đã chọn.");
      enrollmentId = r.enrollmentId ?? ca.enrollmentId;
      if (!enrollmentId) loi.push("Dòng bảo lưu cũ chưa gắn ghi danh — chọn ghi danh (khoá) mà hồ sơ này áp dụng.");
    }
  } else {
    if (!enrollmentId) loi.push("Chưa chọn ghi danh.");
    if (ca.reserveId) loi.push("Nhóm B/C không có dòng bảo lưu cũ để bổ sung.");
  }

  const gd = st.enrollment;
  if (enrollmentId) {
    if (!gd || gd.id !== enrollmentId || gd.deletedAt) {
      loi.push("Không tìm thấy ghi danh.");
    } else {
      if (gd.studentId !== ca.studentId) loi.push("Ghi danh không thuộc học viên này.");
      if (ca.nhom === "B" && gd.status !== "PAUSED") loi.push("Ghi danh không ở trạng thái Tạm dừng — không thuộc nhóm B.");
      if (ca.nhom === "C") {
        if (!(TRANG_THAI_DANG_HOC as readonly string[]).includes(gd.status)) loi.push("Ghi danh không còn ở trạng thái đang học — không thuộc nhóm C.");
        else chuyenPaused = true;
      }
      if (ca.nhom === "A" && gd.status !== "PAUSED" && !(TRANG_THAI_DANG_HOC as readonly string[]).includes(gd.status)) {
        loi.push("Ghi danh không ở trạng thái đang học hoặc Tạm dừng.");
      }
      if (ca.nhom === "A" && (TRANG_THAI_DANG_HOC as readonly string[]).includes(gd.status)) chuyenPaused = true;
      if (!gd.khoaChoPhepBaoLuu) canhBao.push("Khoá học này đang tắt bảo lưu (allowPause) — vẫn nhập được vì ca đã xảy ra, nhưng khoá cần được Đào tạo xác nhận.");
    }
    if (ca.nhom !== "A" && st.daCoHoSoMoPhu) loi.push("Ghi danh đã có hồ sơ bảo lưu đang mở (kể cả dòng cũ cả-học-viên) — không nhập chồng.");
    if (ca.nhom === "A" && st.daCoHoSoMoPhu) loi.push("Ghi danh đã chọn đã có hồ sơ bảo lưu mở khác.");
    if (st.soLanDaDung + 1 > st.maxPerEnrollment) {
      canhBao.push(
        `Ghi danh đã dùng ${st.soLanDaDung}/${st.maxPerEnrollment} lần bảo lưu; ca LEGACY tính là một lần (Q3) nên sau khi nhập sẽ không xin thêm được.`,
      );
    }
  }

  if (loi.length > 0 || !hieuLuc || !startedAt || !enrollmentId) return { loi, canhBao, ke: null };

  const han = hanToiDaBaoLuu(hieuLuc, b.maxMonths);
  const quaMs = b.now.getTime() - han.getTime();
  if (quaMs > 0) {
    canhBao.push(
      `Hạn bảo lưu (${vnYmd(han)}) đã QUA ${Math.floor(quaMs / NGAY_MS)} ngày: ở lần chạy cron kế tiếp hồ sơ sẽ chuyển Quá hạn và Sale được nhắc liên hệ phụ huynh.`,
    );
  }
  if (chuyenPaused) canhBao.push("Ghi danh sẽ chuyển sang Tạm dừng và bé rời danh sách lớp / nhóm chat lớp từ ngày bắt đầu.");
  else if (ca.nhom !== "A" || (gd && gd.status === "PAUSED")) canhBao.push("Bé rời danh sách lớp / nhóm chat lớp theo quy chế từ ngày bắt đầu (các buổi từ ngày đó không tính vắng).");

  return {
    loi,
    canhBao,
    ke: {
      hanhDong,
      startedAt,
      han,
      quaHan: quaMs > 0,
      soNgayQuaHan: quaMs > 0 ? Math.floor(quaMs / NGAY_MS) : 0,
      chuyenGhiDanhSangPaused: chuyenPaused,
      enrollmentId,
    },
  };
}

/** Cả lô: trùng ghi danh trong cùng lô là lỗi (hai hồ sơ cho một ghi danh), vượt trần số ca là lỗi. Trả lỗi cấp lô. */
export function kiemLo(cas: readonly CaNhap[]): string[] {
  const loi: string[] = [];
  if (cas.length === 0) loi.push("Chưa chọn ca nào.");
  if (cas.length > TRAN_CA_MOI_LUOT) loi.push(`Mỗi lượt nhập tối đa ${TRAN_CA_MOI_LUOT} ca.`);
  const thay = new Set<string>();
  for (const c of cas) {
    if (!c.enrollmentId) continue;
    if (thay.has(c.enrollmentId)) loi.push("Có hai ca cùng một ghi danh trong lượt nhập.");
    thay.add(c.enrollmentId);
  }
  return [...new Set(loi)];
}
