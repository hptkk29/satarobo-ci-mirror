// tests/hoc-bu/ket-qua-buoi.test.ts — T08: MÔ HÌNH ĐỌC kết quả học bù của một buổi gốc, trên Postgres THẬT.
//
// Hợp đồng cần chứng minh bằng dữ liệu thật (luật thuần đã có ở `lib/hoc-bu/ket-qua-buoi.test.ts`):
//   · điểm danh GỐC không đổi vì học bù (status "Vắng có phép", lý do vắng, nhận xét của buổi gốc đứng nguyên);
//   · bài nào xong thì buổi gốc TƯƠNG ỨNG hiện "đã bù" kèm đánh giá; bài chưa xong vẫn còn nợ;
//   · lần vắng cũ không bị lấy làm kết quả hiện tại; sửa điểm danh bù đảo thì buổi gốc đổi NGAY;
//   · dòng không có điểm danh gốc (chuyển đổi đơn) không làm sập đường đọc;
//   · các màn dùng CHUNG đường đọc (roster điểm danh admin + site GV, hồ sơ học viên).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { diemDanhBe, suaDiemDanhBe } from "@/lib/hoc-bu/case-db";
import { docKetQuaBuoi } from "@/lib/hoc-bu/ket-qua-buoi-db";
import { khoaCapBuoi, nhanKetHop } from "@/lib/hoc-bu/ket-qua-buoi";
import { buildSessionAttendanceRows } from "@/lib/attendance/roster";
import { getStudentAbsences } from "@/lib/students/progress";
import {
  ADMIN,
  BAI,
  CS,
  GV,
  HV,
  KHOA,
  LOP,
  NOW,
  beCua,
  buoiGoc,
  diemDanh,
  don,
  dongAtt,
  dung,
  id,
  luc,
  needId,
  sach,
  tao,
  tatCa,
} from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[KQBD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const doc = (cap: { sessionId: string; studentId: string }[]) => docKetQuaBuoi(db, cap);
const cap = (hv: keyof typeof HV, b: 5 | 6 | 7 | 8) => ({ sessionId: buoiGoc(b), studentId: HV[hv] });
const key = (hv: keyof typeof HV, b: 5 | 6 | 7 | 8) => khoaCapBuoi(buoiGoc(b), HV[hv]);

describe.skipIf(!RUN_DB_TESTS)("[KQBD] mô hình đọc kết quả học bù — T08", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[KQBD-01] NGHIỆM THU: A xong bài 5,6, chưa xong 7 ⇒ buổi gốc 5,6 'đã bù' kèm đánh giá + ngày bù; 7 còn nợ nhưng lịch sử thấy lần chưa xong; ĐIỂM DANH GỐC KHÔNG ĐỔI", async () => {
    const c = await tao(tatCa("A"));
    // Trước khi bù: cả ba buổi chờ xếp / đã xếp.
    const truoc = await doc([cap("A", 5), cap("A", 6), cap("A", 7)]);
    for (const b of [5, 6, 7] as const) expect(truoc.get(key("A", b))).toMatchObject({ trangThai: "DA_XEP", hienTai: { loai: "DA_XEP", gioBatDau: "18:00" } });
    const gocTruoc = await db.attendance.findMany({ where: { studentId: HV.A }, orderBy: { sessionId: "asc" } });

    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "NOT_COMPLETED" });
    const kq = await doc([cap("A", 5), cap("A", 6), cap("A", 7)]);
    const k5 = kq.get(key("A", 5))!;
    expect(k5).toMatchObject({ trangThai: "DA_BU", nhan: "Đã học bù ngày 15/10/2026", khongKhop: false });
    expect(k5.hienTai).toMatchObject({ loai: "DA_XONG", danhGia: "Đánh giá A5", caseId: c, giaoVienId: GV, lessonId: BAI[5] });
    expect(kq.get(key("A", 6))!.hienTai).toMatchObject({ loai: "DA_XONG", danhGia: "Đánh giá A6", lessonId: BAI[6] });
    const k7 = kq.get(key("A", 7))!;
    expect(k7).toMatchObject({ trangThai: "CHO_XEP", hienTai: null, nhan: "Chờ xếp học bù" });
    expect(k7.lichSu.map((l) => [l.loai, l.danhGia])).toEqual([["CHUA_XONG", "Đánh giá A7"]]);
    // Mỗi bài tương ứng ĐÚNG buổi gốc của nó (không lẫn bài 6 sang buổi 5).
    expect(k5.hienTai!.lessonId).not.toBe(kq.get(key("A", 6))!.hienTai!.lessonId);

    // Điểm danh gốc: trạng thái + lý do vắng + dấu cần bù của buổi 7 đứng nguyên; chỉ `makeupStatus` của buổi ĐÃ XONG đổi sang MADE_UP (dấu cũ, không phải status).
    const gocSau = await db.attendance.findMany({ where: { studentId: HV.A }, orderBy: { sessionId: "asc" } });
    expect(gocSau.map((a) => [a.status, a.absenceReason])).toEqual(gocTruoc.map((a) => [a.status, a.absenceReason]));
    expect(await dongAtt("A", 7)).toMatchObject({ status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP" });
    expect(await db.studentSessionFeedback.count({ where: { studentId: HV.A } })).toBe(0);
    // Nhãn ghép: điểm danh gốc đi nguyên + phần học bù.
    expect(nhanKetHop("Vắng có phép", k5)).toBe("Vắng có phép ✓ Đã học bù ngày 15/10/2026");
    expect(nhanKetHop("Vắng có phép", k7)).toBe("Vắng có phép · Chờ xếp học bù");
    await sach();
  });

  it("[KQBD-02] lần VẮNG cũ không bị lấy làm kết quả: vắng buổi bù ⇒ vẫn nợ (lịch sử có lần vắng); xếp lại ⇒ DA_XEP trỏ lần MỚI; bù xong ⇒ DA_BU trỏ lần xong, lịch sử đủ cả hai", async () => {
    const c1 = await tao([needId("C", 7)]);
    await diemDanh(c1, "C", false);
    const vang = (await doc([cap("C", 7)])).get(key("C", 7))!;
    expect(vang).toMatchObject({ trangThai: "CHO_XEP", hienTai: null });
    expect(vang.lichSu.map((l) => l.loai)).toEqual(["VANG_BUOI_BU"]);

    const c2 = await tao([needId("C", 7)], { ymd: "2026-10-16" });
    const xep = (await doc([cap("C", 7)])).get(key("C", 7))!;
    expect(xep.trangThai).toBe("DA_XEP");
    expect(xep.hienTai).toMatchObject({ caseId: c2, loai: "DA_XEP" });
    expect(xep.lichSu.map((l) => l.loai)).toEqual(["VANG_BUOI_BU", "DA_XEP"]);

    await diemDanh(c2, "C", true, { 7: "COMPLETED" }, luc(16, 18, 30));
    const xong = (await doc([cap("C", 7)])).get(key("C", 7))!;
    expect(xong).toMatchObject({ trangThai: "DA_BU", nhan: "Đã học bù ngày 16/10/2026" });
    expect(xong.hienTai).toMatchObject({ caseId: c2, loai: "DA_XONG" });
    expect(xong.lichSu.map((l) => l.loai)).toEqual(["VANG_BUOI_BU", "DA_XONG"]);
    expect(xong.khongKhop).toBe(false);
  });

  it("[KQBD-03] sửa điểm danh bù có mặt→vắng (đảo) ⇒ buổi gốc đổi NGAY: từ 'đã bù' về 'chờ xếp', lần đó thành VANG_BUOI_BU; vắng→có mặt ⇒ trở lại đã bù", async () => {
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    expect((await doc([cap("C", 7)])).get(key("C", 7))!.trangThai).toBe("DA_BU");
    const be = await beCua(c, "C");
    await suaDiemDanhBe(ADMIN, { participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null, phienBan: be.version, lyDo: "Bé thực ra vắng buổi bù", now: NOW, ten: "QL" });
    const dao = (await doc([cap("C", 7)])).get(key("C", 7))!;
    expect(dao).toMatchObject({ trangThai: "CHO_XEP", hienTai: null, khongKhop: false });
    expect(dao.lichSu.map((l) => l.loai)).toEqual(["VANG_BUOI_BU"]);
    expect(await dongAtt("C", 7)).toMatchObject({ status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP" });
    // Đối chứng hai chiều: sửa ngược lại thì buổi gốc về "đã bù".
    const be2 = await beCua(c, "C");
    const muc = await db.makeupCaseStudent.findMany({ where: { participantId: be2.id, status: "ABSENT" } });
    await suaDiemDanhBe(ADMIN, {
      participantId: be2.id,
      coMat: true,
      ketQuaMuc: { [muc[0]!.id]: { ketQua: "COMPLETED", danhGia: "Có tới" } },
      nhanXetChung: null,
      phienBan: be2.version,
      lyDo: "Bé có tới, chọn nhầm",
      now: NOW,
      ten: "QL",
    });
    const lai = (await doc([cap("C", 7)])).get(key("C", 7))!;
    expect(lai.trangThai).toBe("DA_BU");
    expect(lai.hienTai).toMatchObject({ loai: "DA_XONG", danhGia: "Có tới" });
    expect(lai.lichSu.map((l) => l.loai)).toEqual(["VANG_BUOI_BU", "DA_XONG"]);
  });

  it("[KQBD-04] dòng KHÔNG có điểm danh gốc (chuyển đổi đơn, tạo tay) vẫn đọc được — không sập, không bịa; cặp không có dòng ⇒ KHONG_CAN_BU", async () => {
    // Buổi 8 của lớp, bé C KHÔNG có bản ghi điểm danh; dòng cần bù sinh từ chuyển đổi đơn.
    await db.makeupNeed.create({
      data: {
        id: id("need-conv"), studentId: HV.C, classId: LOP, centerId: CS, courseId: KHOA, sourceType: "ORDER_CONVERSION", originalAttendanceId: null,
        missedSessionId: buoiGoc(8), missedLessonId: BAI[8], status: "PENDING", createdAt: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
    expect(await db.attendance.count({ where: { sessionId: buoiGoc(8), studentId: HV.C } })).toBe(0);
    const kq = await doc([cap("C", 8), cap("B", 8), cap("A", 5)]);
    expect(kq.get(key("C", 8))).toMatchObject({ trangThai: "CHO_XEP", needId: id("need-conv"), lichSu: [], khongKhop: false });
    expect(kq.get(key("B", 8))).toMatchObject({ trangThai: "KHONG_CAN_BU", needId: null, nhan: "" }); // B không vắng buổi 8
    expect(kq.size).toBe(3); // đủ khoá cho mọi cặp được hỏi
    // Xếp + bù xong cũng đọc được dù không có điểm danh gốc để đánh dấu (phép cập nhật nhãn trên điểm danh gốc khớp 0 dòng, không ném).
    const c = await tao([id("need-conv")]);
    const be = await beCua(c, "C");
    const muc = await db.makeupCaseStudent.findFirstOrThrow({ where: { participantId: be.id } });
    await diemDanhBe(null, { participantId: be.id, coMat: true, ketQuaMuc: { [muc.id]: { ketQua: "COMPLETED", danhGia: "Bù theo chuyển đổi đơn" } }, nhanXetChung: null, chiGiaoVien: GV, now: NOW });
    const xong = (await doc([cap("C", 8)])).get(key("C", 8))!;
    expect(xong).toMatchObject({ trangThai: "DA_BU", khongKhop: false });
    expect(xong.hienTai).toMatchObject({ loai: "DA_XONG", danhGia: "Bù theo chuyển đổi đơn" });
    expect(await db.attendance.count({ where: { sessionId: buoiGoc(8), studentId: HV.C } })).toBe(0); // không bịa điểm danh gốc
  });

  it("[KQBD-05] DÙNG CHUNG đường đọc: roster điểm danh (admin + site GV) và hồ sơ học viên hiện cùng kết quả; điểm danh gốc trong roster KHÔNG đổi", async () => {
    const c = await tao(tatCa("A"));
    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "NOT_COMPLETED" });
    const { rows } = await buildSessionAttendanceRows(ADMIN, buoiGoc(5));
    const a = rows.find((r) => r.studentId === HV.A)!;
    expect(a.existing).toMatchObject({ status: "ABSENT_EXCUSED", makeupStatus: "MADE_UP" });
    expect(a.ketQuaBu).toEqual({ trangThai: "DA_BU", nhan: "✓ Đã học bù ngày 15/10/2026", danhGia: "Đánh giá A5", coPhieu: false }); // fixture chỉ có chữ (đường cũ) ⇒ chưa có bảng 9 tiêu chí
    // Bé khác không vắng buổi này ⇒ không có kết quả bù để hiện.
    expect(rows.filter((r) => r.studentId !== HV.A).every((r) => r.ketQuaBu === null)).toBe(true);

    const r7 = (await buildSessionAttendanceRows(ADMIN, buoiGoc(7))).rows.find((r) => r.studentId === HV.A)!;
    expect(r7.existing).toMatchObject({ status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP" });
    expect(r7.ketQuaBu).toMatchObject({ trangThai: "CHO_XEP", nhan: "Chờ xếp học bù" });

    const vang = await getStudentAbsences(HV.A);
    expect(vang).toHaveLength(3);
    const theoBuoi = new Map(vang.map((v) => [v.sessionId, v]));
    expect(theoBuoi.get(buoiGoc(5))!.ketQuaBu).toMatchObject({ trangThai: "DA_BU", danhGia: "Đánh giá A5" });
    expect(theoBuoi.get(buoiGoc(7))!.ketQuaBu).toMatchObject({ trangThai: "CHO_XEP" });
    // Trạng thái điểm danh của hồ sơ cũng nguyên.
    expect(vang.every((v) => v.status === "ABSENT_EXCUSED")).toBe(true);
  });

  it("[KQBD-06] dòng huỷ: quản lý chủ ý huỷ (waivedAt) ≠ buổi gốc sửa sang có mặt (tự thu hồi) — hai câu khác nhau; luồng cũ 'đã bù' không báo lệch", async () => {
    await db.makeupNeed.update({ where: { id: needId("B", 6) }, data: { status: "CANCELLED", waivedAt: new Date("2026-10-02T00:00:00.000Z"), waivedReason: "Phụ huynh xin không bù" } });
    await db.makeupNeed.update({ where: { id: needId("B", 7) }, data: { status: "CANCELLED" } });
    await db.makeupNeed.update({ where: { id: needId("A", 5) }, data: { status: "COMPLETED", makeupSessionId: buoiGoc(6) } }); // luồng cũ: bù ở buổi lớp khác
    const kq = await doc([cap("B", 6), cap("B", 7), cap("A", 5)]);
    expect(kq.get(key("B", 6))).toMatchObject({ trangThai: "DA_HUY_KHONG_BU", nhan: "Đã huỷ — không bù" });
    expect(kq.get(key("B", 7))).toMatchObject({ trangThai: "KHONG_CON_CAN_BU", nhan: "Không còn cần bù" });
    expect(kq.get(key("A", 5))).toMatchObject({ trangThai: "DA_BU", hienTai: null, khongKhop: false });
  });
});
