// lib/portal/tien-do-pham-vi.test.ts — [PVP] TIẾN ĐỘ CỔNG PHỤ HUYNH THEO PHẠM VI (hàm thuần, không DB).
//
// Thứ cần chứng minh (yêu cầu 19/10/2026):
//   (a) không áp dụng ⇒ CHÍNH đối tượng cũ (`toBe`), không thêm trường nào;
//   (b) có cờ nhưng không có quyền học ACTIVE ⇒ cũng thế;
//   (c) quyền 12 buổi giữa khoá: bài trước phạm vi có nhãn, KHÔNG vào tiến độ / chuyên cần, vắng ở bài trước phạm vi không thành "vắng";
//   (d) hai lớp / hai khoá không lẫn quyền học của nhau;
//   (e) học vượt hiển thị RIÊNG và đã nằm trong "đã học".
import { describe, expect, it } from "vitest";
import type { AttendanceSummary } from "@/lib/attendance/summary";
import { nhanLyDo, type QuyenHocChoRoster } from "@/lib/entitlements/roster";
import type { TrangThaiQuyenHoc } from "@/lib/entitlements/trang-thai";
import {
  diemDanhKetQua,
  laApDung,
  laBaiTrongPhamVi,
  nhanBuoiPhamVi,
  soLieuPhamVi,
  tienDoPortal,
  tomTatDiemDanhPortal,
  type PhamViLop,
} from "./tien-do-pham-vi";

const qh = (o: Partial<QuyenHocChoRoster> & { start: number; end: number }): QuyenHocChoRoster => ({
  id: `qh-${o.start}`,
  status: "ACTIVE",
  purchaseSessions: o.end - o.start + 1,
  startLessonOrder: o.start,
  endLessonOrder: o.end,
  baiBoQua: [],
  freeMakeupSessions: 0,
  graceSessionsGranted: 0,
  consumedSessions: 0,
  graceSessionsUsed: 0,
  ...o,
});

const bai = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const pvLop = (o: Partial<PhamViLop> & { quyenHoc: readonly QuyenHocChoRoster[] }): PhamViLop => ({
  classId: "lop-1",
  courseId: "khoa-1",
  baiDenHetNgay: bai(1, 20),
  baiDenBayGio: bai(1, 20),
  baiVangKhongBu: [],
  diemDanh: [],
  buoiKhongCoBai: 0,
  hocVuot: 0,
  ...o,
});

/** Đường cũ: số cả khoá 48 buổi, đã học 7, lớp đã dạy 20. */
const cu = { total: 48, attended: 7, remaining: 41, absentNoMakeup: 2, sessionsHeld: 20, currentSession: 21, ghiChu: "trường lạ giữ nguyên" };
const tomTatCu: AttendanceSummary = { total: 48, daDienRa: 20, attended: 7, absent: 2, needMakeup: 1, madeUp: 0 };
const ketQuaCu = { totalSessions: 20, attendedSessions: 7, attendanceRate: 35, tenKhac: "x" };

const gioiThieu12 = qh({ start: 13, end: 24, consumedSessions: 3 });

describe("[PVP] tiến độ cổng phụ huynh theo phạm vi — hàm thuần", () => {
  describe("(a)+(b) không áp dụng ⇒ trả CHÍNH đối tượng cũ", () => {
    it("[PVP-01] không có dữ liệu phạm vi (cờ tắt / đường cũ) ⇒ mọi hàm trả đúng tham chiếu cũ, nhãn buổi là undefined", () => {
      expect(tienDoPortal(cu, undefined)).toBe(cu);
      expect(tomTatDiemDanhPortal(tomTatCu, undefined)).toBe(tomTatCu);
      expect(diemDanhKetQua(ketQuaCu, undefined)).toBe(ketQuaCu);
      expect(nhanBuoiPhamVi(undefined, 5)).toBeUndefined();
      expect(soLieuPhamVi(undefined, "HET_NGAY")).toBeNull();
    });

    it("[PVP-02] có quyền học nhưng KHÔNG cái nào ACTIVE (chờ xếp lớp / hết buổi / đã đóng) ⇒ đường cũ", () => {
      for (const status of ["AWAITING_PLACEMENT", "EXHAUSTED", "COMPLETED", "FROZEN", "STOPPED", "EXPIRED", "SEAT_HOLD"] as TrangThaiQuyenHoc[]) {
        const pv = pvLop({ quyenHoc: [qh({ start: 13, end: 24, status })] });
        expect(laApDung(pv), status).toBe(false);
        expect(tienDoPortal(cu, pv), status).toBe(cu);
        expect(tomTatDiemDanhPortal(tomTatCu, pv), status).toBe(tomTatCu);
        expect(nhanBuoiPhamVi(pv, 5), status).toBeUndefined();
      }
    });

    it("[PVP-03] danh sách quyền học rỗng ⇒ đường cũ", () => {
      const pv = pvLop({ quyenHoc: [] });
      expect(tienDoPortal(cu, pv)).toBe(cu);
      expect(nhanBuoiPhamVi(pv, 5)).toBeUndefined();
    });

    it("[PVP-04] một buổi đã diễn ra không xác định được số bài ⇒ GIỮ đường cũ (hàm thuần sẽ lặng lẽ bỏ buổi đó ⇒ đếm thiếu)", () => {
      const pv = pvLop({ quyenHoc: [gioiThieu12], buoiKhongCoBai: 1 });
      expect(laApDung(pv)).toBe(false);
      expect(tienDoPortal(cu, pv)).toBe(cu);
      expect(tomTatDiemDanhPortal(tomTatCu, pv)).toBe(tomTatCu);
      expect(diemDanhKetQua(ketQuaCu, pv)).toBe(ketQuaCu);
      expect(nhanBuoiPhamVi(pv, 5)).toBeUndefined();
    });

    it("[PVP-05] một quyền VOIDED không kéo đường cũ sang nhánh mới", () => {
      const pv = pvLop({ quyenHoc: [qh({ start: 1, end: 12, status: "VOIDED" })] });
      expect(tienDoPortal(cu, pv)).toBe(cu);
    });
  });

  describe("(c) quyền 12 buổi giữa khoá (bài 13–24), lớp đã dạy bài 1–20", () => {
    const pv = pvLop({
      quyenHoc: [gioiThieu12],
      baiVangKhongBu: [5, 16], // 5 = trước phạm vi, 16 = trong phạm vi
      diemDanh: [
        { lessonOrder: 5, status: "ABSENT_UNEXCUSED", makeupStatus: "NONE" },
        { lessonOrder: 14, status: "PRESENT", makeupStatus: "NONE" },
        { lessonOrder: 15, status: "PRESENT", makeupStatus: "NONE" },
        { lessonOrder: 16, status: "ABSENT_UNEXCUSED", makeupStatus: "NONE" },
        { lessonOrder: 17, status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP" },
      ],
    });

    it("[PVP-06] tiến độ: tổng = 12 (gói), không phải 48; chỉ bài 13–20 là 'đã diễn ra'; giữ nguyên trường lạ của đường cũ", () => {
      const r = tienDoPortal(cu, pv);
      expect(r).toMatchObject({
        total: 12,
        attended: 3, // sổ cái
        remaining: 9,
        sessionsHeld: 8, // 13..20
        currentSession: 9,
        absentNoMakeup: 1, // chỉ bài 16; bài 5 trước phạm vi KHÔNG thành vắng
        theoPhamVi: true,
        hocVuot: 0,
        ghiChu: "trường lạ giữ nguyên",
      });
    });

    it("[PVP-07] chuyên cần: mẫu số là buổi TRONG phạm vi; vắng ở bài 5 không tính; chờ bù tính đúng một", () => {
      const r = tomTatDiemDanhPortal(tomTatCu, pv) as AttendanceSummary;
      expect(r).toMatchObject({ total: 12, daDienRa: 8, attended: 3, absent: 1, needMakeup: 1, madeUp: 0 });
      // % chuyên cần = attended / daDienRa = 3/8, KHÔNG phải 7/20 của đường cũ.
    });

    it("[PVP-08] trang Kết quả: 'Điểm danh x/y' lấy cùng nguồn; trường khác của p được giữ", () => {
      const r = diemDanhKetQua(ketQuaCu, pv);
      expect(r).toMatchObject({ totalSessions: 8, attendedSessions: 3, attendanceRate: 38, tenKhac: "x" });
    });

    it("[PVP-09] hai thẻ trên cùng màn hình cùng một 'đã học': tiến độ == chuyên cần == Kết quả", () => {
      const a = tienDoPortal(cu, pv).attended;
      const b = (tomTatDiemDanhPortal(tomTatCu, pv) as AttendanceSummary).attended;
      const c = diemDanhKetQua(ketQuaCu, pv).attendedSessions;
      expect([a, b, c]).toEqual([3, 3, 3]);
    });

    it("[PVP-10] bài trước phạm vi có nhãn 'ngoài phạm vi đăng ký' (một nguồn: nhanLyDo) kèm dải bài; bài trong phạm vi thì không", () => {
      expect(nhanBuoiPhamVi(pv, 5)).toEqual({ ngoaiPhamVi: true, nhan: nhanLyDo("NGOAI_PHAM_VI", { start: 13, end: 24 }) });
      expect(nhanBuoiPhamVi(pv, 5)?.nhan).toMatch(/ngoài phạm vi đăng ký/i);
      expect(nhanBuoiPhamVi(pv, 14)).toEqual({ ngoaiPhamVi: false, nhan: null });
      expect(nhanBuoiPhamVi(pv, 30)).toEqual({ ngoaiPhamVi: true, nhan: nhanLyDo("NGOAI_PHAM_VI", { start: 13, end: 24 }) });
    });

    it("[PVP-11] buổi chưa ghim giáo trình (số bài chưa biết) ⇒ không nhãn, không bị coi là ngoài phạm vi", () => {
      expect(nhanBuoiPhamVi(pv, null)).toEqual({ ngoaiPhamVi: false, nhan: null });
    });

    it("[PVP-12] NHÃN ⇔ SỐ ĐẾM, từng bài: buổi gắn 'ngoài phạm vi' đúng là buổi 'đã diễn ra' KHÔNG đếm — hai nơi cùng một vị từ", () => {
      const tatCa = bai(1, 30);
      const pvTatCa = pvLop({ quyenHoc: [gioiThieu12], baiDenHetNgay: tatCa, baiDenBayGio: tatCa });
      const demDuoc = soLieuPhamVi(pvTatCa, "HET_NGAY")!.sessionsHeld;
      const khongNhan = tatCa.filter((b) => nhanBuoiPhamVi(pvTatCa, b)?.ngoaiPhamVi === false);
      expect(khongNhan).toEqual(tatCa.filter((b) => laBaiTrongPhamVi(pvTatCa, b)));
      expect(khongNhan.length).toBe(demDuoc);
      expect(khongNhan).toEqual(bai(13, 24));
    });
  });

  describe("(c2) các loại bài không tính", () => {
    it("[PVP-13] bài bỏ qua (vượt trần học vượt) ⇒ ngoài phạm vi với chữ riêng, không đếm", () => {
      const pv = pvLop({ quyenHoc: [qh({ start: 1, end: 12, baiBoQua: [1, 2, 3] })], baiDenHetNgay: bai(1, 6), baiDenBayGio: bai(1, 6) });
      expect(nhanBuoiPhamVi(pv, 2)).toEqual({ ngoaiPhamVi: true, nhan: nhanLyDo("BO_QUA") });
      expect(soLieuPhamVi(pv, "HET_NGAY")!.sessionsHeld).toBe(3); // 4,5,6
    });

    it("[PVP-14] bài ân hạn ⇒ không đếm nhưng CHƯA có chữ (chưa có quyết định) — nhan null, ngoaiPhamVi true", () => {
      const pv = pvLop({ quyenHoc: [qh({ start: 1, end: 12, graceSessionsGranted: 2 })], baiDenHetNgay: bai(1, 13), baiDenBayGio: bai(1, 13) });
      expect(nhanBuoiPhamVi(pv, 13)).toEqual({ ngoaiPhamVi: true, nhan: null });
      expect(laBaiTrongPhamVi(pv, 13)).toBe(false);
      expect(soLieuPhamVi(pv, "HET_NGAY")!.sessionsHeld).toBe(12);
    });
  });

  describe("MUA TIẾP: gói trước đã đóng vẫn là phạm vi (cổng là 'có ACTIVE', tập tính rộng hơn)", () => {
    const truoc = qh({ start: 1, end: 12, status: "COMPLETED", consumedSessions: 12 });
    const sau = qh({ start: 13, end: 24, consumedSessions: 2 });
    const pv = pvLop({ quyenHoc: [truoc, sau], baiDenHetNgay: bai(1, 15), baiDenBayGio: bai(1, 15) });

    it("[PVP-15] COMPLETED 1–12 + ACTIVE 13–24 ⇒ tổng 24, đã học 14, bài 1–12 KHÔNG bị gắn 'ngoài phạm vi'", () => {
      expect(tienDoPortal(cu, pv)).toMatchObject({ total: 24, attended: 14, remaining: 10, sessionsHeld: 15 });
      expect(nhanBuoiPhamVi(pv, 3)).toEqual({ ngoaiPhamVi: false, nhan: null });
      expect(nhanBuoiPhamVi(pv, 30)?.nhan).toBe(nhanLyDo("NGOAI_PHAM_VI")); // hai quyền ⇒ không nêu dải
    });

    it("[PVP-16] nếu chỉ còn gói COMPLETED + EXHAUSTED (không ACTIVE) ⇒ đường cũ (đúng yêu cầu: cổng là ACTIVE)", () => {
      const pv2 = pvLop({ quyenHoc: [truoc, qh({ start: 13, end: 24, status: "EXHAUSTED", consumedSessions: 12 })] });
      expect(tienDoPortal(cu, pv2)).toBe(cu);
    });
  });

  describe("(e) học vượt hiển thị RIÊNG, đã tính là đã học", () => {
    it("[PVP-17] hocVuot đi kèm nhánh theo phạm vi; 'đã học' đã bao gồm nó (không cộng thêm)", () => {
      // FULL 48, vào lớp ở bài 6, học vượt bài 1–2: sổ cái consumed = 2 (CATCH_UP) + 3 (lớp) = 5.
      const q = qh({ start: 1, end: 48, consumedSessions: 5, graceSessionsGranted: 0 });
      const pv = pvLop({ quyenHoc: [q], baiDenHetNgay: bai(1, 8), baiDenBayGio: bai(1, 8), hocVuot: 2 });
      expect(tienDoPortal(cu, pv)).toMatchObject({ total: 48, attended: 5, hocVuot: 2 });
      expect(tomTatDiemDanhPortal(tomTatCu, pv)).toMatchObject({ attended: 5, hocVuot: 2 });
    });

    it("[PVP-18] học vượt không có dòng điểm danh ⇒ 'đã học' vẫn là sổ cái (nếu đếm từ điểm danh sẽ ra 3 và lệch thẻ kia)", () => {
      const q = qh({ start: 1, end: 48, consumedSessions: 5 });
      const pv = pvLop({
        quyenHoc: [q],
        baiDenHetNgay: bai(1, 8),
        baiDenBayGio: bai(1, 8),
        hocVuot: 2,
        diemDanh: bai(6, 8).map((b) => ({ lessonOrder: b, status: "PRESENT" as const, makeupStatus: null })),
      });
      expect((tomTatDiemDanhPortal(tomTatCu, pv) as AttendanceSummary).attended).toBe(tienDoPortal(cu, pv).attended);
      expect(tienDoPortal(cu, pv).attended).toBe(5);
    });

    it("[PVP-19] không có học vượt ⇒ hocVuot = 0 (trường có mặt nhưng bằng 0 — màn hình không in)", () => {
      expect(tienDoPortal(cu, pvLop({ quyenHoc: [gioiThieu12] }))).toMatchObject({ hocVuot: 0 });
    });
  });

  describe("(d) hai lớp / hai khoá không lẫn", () => {
    it("[PVP-20] mỗi lớp có PhamViLop riêng: cùng một đường cũ, hai quyền học khác nhau ⇒ hai kết quả độc lập", () => {
      const a = pvLop({ classId: "lop-a", courseId: "k-a", quyenHoc: [qh({ start: 1, end: 12, consumedSessions: 4 })] });
      const b = pvLop({ classId: "lop-b", courseId: "k-b", quyenHoc: [qh({ start: 25, end: 36, consumedSessions: 9 })] });
      expect(tienDoPortal(cu, a)).toMatchObject({ total: 12, attended: 4 });
      expect(tienDoPortal(cu, b)).toMatchObject({ total: 12, attended: 9 });
      // Dùng nhầm quyền học của lớp kia sẽ ra số khác ⇒ bài 5 của lớp B là 'ngoài phạm vi', của lớp A thì không.
      expect(nhanBuoiPhamVi(a, 5)?.ngoaiPhamVi).toBe(false);
      expect(nhanBuoiPhamVi(b, 5)?.ngoaiPhamVi).toBe(true);
    });
  });
});
