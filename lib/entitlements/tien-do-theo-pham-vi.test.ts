import { describe, expect, it } from "vitest";
import type { QuyenHocChoRoster } from "./roster";
import type { TrangThaiQuyenHoc } from "./trang-thai";
import { tienDoTheoPhamVi, type TienDoCoSo } from "./tien-do-theo-pham-vi";

const base: TienDoCoSo & { ghiChu: string } = {
  total: 48,
  attended: 20,
  remaining: 28,
  absentNoMakeup: 4,
  sessionsHeld: 30,
  currentSession: 31,
  ghiChu: "trường lạ của người gọi phải được giữ nguyên",
};

const DANG_TINH = new Set<TrangThaiQuyenHoc>(["ACTIVE", "EXHAUSTED", "SEAT_HOLD", "COMPLETED", "STOPPED"]);

const qh = (o: Partial<QuyenHocChoRoster> & { start: number; end: number }): QuyenHocChoRoster => ({
  id: "qh-1",
  status: "ACTIVE",
  purchaseSessions: o.end - o.start + 1,
  startLessonOrder: o.start,
  endLessonOrder: o.end,
  baiBoQua: [],
  freeMakeupSessions: 0,
  graceSessionsGranted: 2,
  consumedSessions: 0,
  graceSessionsUsed: 0,
  ...o,
});

const bai = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe("[TDP] tienDoTheoPhamVi — số liệu 'đã học / còn lại' theo QUYỀN HỌC, không theo Course.totalSessions", () => {
  it("[TDP-01] không có quyền học nào ⇒ trả CHÍNH đối tượng base (cùng tham chiếu) — đường cũ nguyên vẹn", () => {
    const r = tienDoTheoPhamVi(base, [], { trangThaiTinh: DANG_TINH, baiDaDienRa: bai(1, 30), baiVangKhongBu: [3] });
    expect(r).toBe(base);
  });

  it("[TDP-02] có quyền học nhưng KHÔNG cái nào thuộc tập trạng thái được tính ⇒ cũng trả base (người gọi quyết tập trạng thái)", () => {
    const cho = qh({ start: 13, end: 24, status: "AWAITING_PLACEMENT" });
    const huy = qh({ id: "qh-2", start: 25, end: 36, status: "VOIDED" });
    const r = tienDoTheoPhamVi(base, [cho, huy], { trangThaiTinh: DANG_TINH, baiDaDienRa: bai(1, 30), baiVangKhongBu: [] });
    expect(r).toBe(base);
  });

  it("[TDP-03] tổng = Σ số buổi đã mua của CHUỖI nối; đã học = Σ sổ cái; còn lại = mua − đã học − bỏ qua", () => {
    const q1 = qh({ id: "qh-1", start: 1, end: 12, status: "COMPLETED", consumedSessions: 12 });
    const q2 = qh({ id: "qh-2", start: 13, end: 36, consumedSessions: 7, baiBoQua: [13, 14] });
    const r = tienDoTheoPhamVi(base, [q1, q2], { trangThaiTinh: DANG_TINH, baiDaDienRa: bai(1, 20), baiVangKhongBu: [] });
    expect(r).toMatchObject({ total: 36, attended: 19, remaining: 15, theoPhamVi: true });
    // 36 − 12 − 7 − 2 = 15 : q1 còn 0, q2 còn 24 − 7 − 2 = 15
  });

  it("[TDP-04] 'đã diễn ra' CHỈ đếm bài NẰM TRONG phạm vi: lớp đã dạy 30 bài, phạm vi 13..24 ⇒ 12; bài bỏ qua không tính", () => {
    const q = qh({ start: 13, end: 24, consumedSessions: 3, baiBoQua: [13, 14, 15] });
    const r = tienDoTheoPhamVi(base, [q], { trangThaiTinh: DANG_TINH, baiDaDienRa: bai(1, 30), baiVangKhongBu: [] });
    expect(r).toMatchObject({ sessionsHeld: 9, total: 12, remaining: 6 });
  });

  it("[TDP-05] buổi TRƯỚC phạm vi không tính vắng cũng không tính đã học: vắng bài 5 (trước 13..24) bỏ qua, vắng bài 14 tính", () => {
    const q = qh({ start: 13, end: 24, consumedSessions: 2 });
    const r = tienDoTheoPhamVi(base, [q], { trangThaiTinh: DANG_TINH, baiDaDienRa: bai(1, 16), baiVangKhongBu: [5, 14, 30] });
    expect(r).toMatchObject({ absentNoMakeup: 1, attended: 2, sessionsHeld: 4 });
  });

  it("[TDP-06] số 'đã học' của base (đếm theo lớp, gồm cả buổi trước phạm vi) bị THAY bằng số từ sổ cái", () => {
    const q = qh({ start: 13, end: 24, consumedSessions: 8 });
    const r = tienDoTheoPhamVi(base, [q], { trangThaiTinh: DANG_TINH, baiDaDienRa: bai(1, 30), baiVangKhongBu: [] });
    expect(base.attended).toBe(20);
    expect(r).toMatchObject({ attended: 8 });
  });

  it("[TDP-07] bài ngoài phạm vi và bài ÂN HẠN không phải 'trong phạm vi' (bài 25, 26 sau end=24)", () => {
    const q = qh({ start: 13, end: 24, status: "EXHAUSTED", consumedSessions: 12, graceSessionsGranted: 2 });
    const r = tienDoTheoPhamVi(base, [q], { trangThaiTinh: DANG_TINH, baiDaDienRa: bai(1, 30), baiVangKhongBu: [25] });
    expect(r).toMatchObject({ sessionsHeld: 12, absentNoMakeup: 0, remaining: 0 });
  });

  it("[TDP-08] ÂN HẠN có nhãn riêng: đang ân hạn / còn bao nhiêu / chưa cấp", () => {
    const het = qh({ start: 13, end: 24, status: "EXHAUSTED", consumedSessions: 12, graceSessionsGranted: 2, graceSessionsUsed: 1 });
    const r1 = tienDoTheoPhamVi(base, [het], { trangThaiTinh: DANG_TINH, baiDaDienRa: [], baiVangKhongBu: [] });
    expect(r1).toMatchObject({ anHan: { duocCap: 2, daDung: 1, conLai: 1, dangAnHan: true } });

    const dangHoc = qh({ start: 13, end: 24, consumedSessions: 3 });
    const r2 = tienDoTheoPhamVi(base, [dangHoc], { trangThaiTinh: DANG_TINH, baiDaDienRa: [], baiVangKhongBu: [] });
    expect(r2).toMatchObject({ anHan: { duocCap: 2, daDung: 0, conLai: 2, dangAnHan: false } });

    const khongCap = qh({ start: 13, end: 24, status: "EXHAUSTED", consumedSessions: 12, graceSessionsGranted: 0 });
    const r3 = tienDoTheoPhamVi(base, [khongCap], { trangThaiTinh: DANG_TINH, baiDaDienRa: [], baiVangKhongBu: [] });
    expect(r3).toMatchObject({ anHan: { duocCap: 0, daDung: 0, conLai: 0, dangAnHan: false } });
  });

  it("[TDP-09] ân hạn dùng quá số được cấp (dữ liệu lệch) thì 'còn lại' không âm", () => {
    const q = qh({ start: 13, end: 24, status: "SEAT_HOLD", consumedSessions: 12, graceSessionsGranted: 2, graceSessionsUsed: 3 });
    const r = tienDoTheoPhamVi(base, [q], { trangThaiTinh: DANG_TINH, baiDaDienRa: [], baiVangKhongBu: [] });
    expect(r).toMatchObject({ anHan: { conLai: 0, dangAnHan: false } });
  });

  it("[TDP-10] 'đang học buổi X': theo đúng công thức của base (đã diễn ra + 1, không vượt tổng; tổng 0 ⇒ 0)", () => {
    const q = qh({ start: 13, end: 24, consumedSessions: 2 });
    const dau = tienDoTheoPhamVi(base, [q], { trangThaiTinh: DANG_TINH, baiDaDienRa: bai(1, 15), baiVangKhongBu: [] });
    expect(dau).toMatchObject({ sessionsHeld: 3, currentSession: 4 });
    const het = tienDoTheoPhamVi(base, [q], { trangThaiTinh: DANG_TINH, baiDaDienRa: bai(1, 40), baiVangKhongBu: [] });
    expect(het).toMatchObject({ sessionsHeld: 12, currentSession: 12 });
    const chua = tienDoTheoPhamVi(base, [q], { trangThaiTinh: DANG_TINH, baiDaDienRa: [], baiVangKhongBu: [] });
    expect(chua).toMatchObject({ sessionsHeld: 0, currentSession: 1 });
  });

  it("[TDP-11] tập trạng thái được tính là THAM SỐ: đưa AWAITING_PLACEMENT vào thì nó được tính vào tổng", () => {
    const cho = qh({ start: 13, end: 24, status: "AWAITING_PLACEMENT" });
    const them = new Set<TrangThaiQuyenHoc>([...DANG_TINH, "AWAITING_PLACEMENT"]);
    const r = tienDoTheoPhamVi(base, [cho], { trangThaiTinh: them, baiDaDienRa: [], baiVangKhongBu: [] });
    expect(r).toMatchObject({ total: 12, remaining: 12, attended: 0 });
  });

  it("[TDP-12] quyền học VOIDED không bao giờ được tính, kể cả khi người gọi lỡ đưa vào tập trạng thái", () => {
    const huy = qh({ start: 13, end: 24, status: "VOIDED", consumedSessions: 5 });
    const tatCa = new Set<TrangThaiQuyenHoc>([...DANG_TINH, "VOIDED"]);
    expect(tienDoTheoPhamVi(base, [huy], { trangThaiTinh: tatCa, baiDaDienRa: [], baiVangKhongBu: [] })).toBe(base);
  });

  it("[TDP-13] bài lặp trong danh sách đầu vào chỉ đếm một lần; trường lạ của base được giữ; đầu vào không bị đổi", () => {
    const q = qh({ start: 13, end: 24, consumedSessions: 1 });
    const baiDaDienRa = Object.freeze([13, 13, 14, 14, 14]);
    const baiVang = Object.freeze([14, 14]);
    const r = tienDoTheoPhamVi(Object.freeze({ ...base }), Object.freeze([q]), {
      trangThaiTinh: DANG_TINH,
      baiDaDienRa,
      baiVangKhongBu: baiVang,
    });
    expect(r).toMatchObject({ sessionsHeld: 2, absentNoMakeup: 1, ghiChu: base.ghiChu });
  });

  it("[TDP-14] hai quyền học chồng nhau ở một bài (dữ liệu lệch): bài đó chỉ đếm là 'đã diễn ra' một lần", () => {
    const a = qh({ id: "a", start: 1, end: 12, consumedSessions: 12, status: "COMPLETED" });
    const b = qh({ id: "b", start: 12, end: 23, consumedSessions: 0 });
    const r = tienDoTheoPhamVi(base, [a, b], { trangThaiTinh: DANG_TINH, baiDaDienRa: bai(1, 14), baiVangKhongBu: [] });
    expect(r).toMatchObject({ sessionsHeld: 14, total: 24 });
  });

  it("[TDP-15] một quyền học bị tiêu thụ QUÁ số đã mua (dữ liệu lệch) không được trừ vào 'còn lại' của quyền học khác", () => {
    // a: mua 12, tiêu thụ 14 ⇒ tự nó âm 2. b: mua 12, chưa học ⇒ còn 12. Tổng đúng là 12 — KHÔNG phải 10.
    // Fixture cố ý LỆCH (a âm, b dương): hai quyền cùng âm hay cùng 0 thì clamp ở từng quyền và clamp ở tổng ra cùng số.
    const a = qh({ id: "a", start: 1, end: 12, consumedSessions: 14, status: "COMPLETED" });
    const b = qh({ id: "b", start: 13, end: 24, consumedSessions: 0 });
    const r = tienDoTheoPhamVi(base, [a, b], { trangThaiTinh: DANG_TINH, baiDaDienRa: [], baiVangKhongBu: [] });
    expect(r).toMatchObject({ total: 24, attended: 14, remaining: 12 });
  });
});
