// lib/portal/buoi-hoc-pham-vi.test.ts — [PVC] ĐẾM BUỔI CỦA LỊCH TUẦN / BUỔI HỌC CỦA HỌC SINH THEO PHẠM VI (hàm thuần, không DB).
//
// `demBuoiTheoPhamVi` là chỗ DUY NHẤT quyết định "done / total / remaining" của hai màn lấy số từ danh sách buổi (lịch tuần, Buổi học của học
// sinh). Thứ cần chứng minh:
//   (a) không lớp nào áp dụng ⇒ trả ĐÚNG kết quả của `demBuoi` (từng con số) — đường cũ không đổi một byte;
//   (b) lớp áp dụng đếm theo GÓI, lấy từ `soLieuPhamVi(.., "BAY_GIO")` — cùng nguồn với mẫu số chuyên cần;
//   (c) con học nhiều lớp: cộng THEO TỪNG LỚP, lớp không áp dụng vẫn đếm bằng `demBuoi` của riêng nó (buổi huỷ không vào mẫu số);
//   (d) quyền học của lớp này không bị đem sang lớp khác.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { classSession: { findMany: vi.fn() } } }));

import type { QuyenHocChoRoster } from "@/lib/entitlements/roster";
import { demBuoi, demBuoiTheoPhamVi, type BuoiHoc } from "./buoi-hoc";
import type { PhamViLop } from "./tien-do-pham-vi";

const buoi = (id: string, classId: string, o: { daDienRa?: boolean; daHuy?: boolean } = {}): BuoiHoc => ({
  id,
  classId,
  soBuoi: 1,
  soBuoiLoTrinh: 1,
  nhanSoBuoi: "Buổi 1",
  nhanDayDu: "Buổi 1",
  tieuDe: "",
  ngayISO: "2026-10-01T00:00:00.000Z",
  nhanNgay: "01/10/2026",
  nhanNgayNgan: "01/10",
  nhanThu: "Thứ 5",
  nhanGio: "19:00",
  daHuy: o.daHuy ?? false,
  daDienRa: !(o.daHuy ?? false) && (o.daDienRa ?? false),
  homNay: false,
});

const lop = (classId: string, n: number, daQua: number): BuoiHoc[] =>
  Array.from({ length: n }, (_, i) => buoi(`${classId}-${i + 1}`, classId, { daDienRa: i < daQua }));

const qh = (start: number, end: number, o: Partial<QuyenHocChoRoster> = {}): QuyenHocChoRoster => ({
  id: `qh-${start}`,
  status: "ACTIVE",
  purchaseSessions: end - start + 1,
  startLessonOrder: start,
  endLessonOrder: end,
  baiBoQua: [],
  freeMakeupSessions: 0,
  graceSessionsGranted: 0,
  consumedSessions: 3,
  graceSessionsUsed: 0,
  ...o,
});

const bai = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const pv = (classId: string, o: Partial<PhamViLop> = {}): PhamViLop => ({
  classId,
  courseId: `khoa-${classId}`,
  quyenHoc: [qh(13, 24)],
  baiDenHetNgay: bai(1, 18),
  baiDenBayGio: bai(1, 18),
  baiVangKhongBu: [],
  diemDanh: [],
  buoiKhongCoBai: 0,
  hocVuot: 0,
  ...o,
});

describe("[PVC] demBuoiTheoPhamVi", () => {
  it("[PVC-01] không có dữ liệu phạm vi (Map rỗng) ⇒ đúng kết quả của demBuoi(list)", () => {
    const ds = lop("A", 30, 18);
    const r = demBuoiTheoPhamVi(ds, new Map());
    expect(r).toStrictEqual(demBuoi(ds));
    expect(r).toEqual({ tong: 30, daDienRa: 18, conLai: 12 });
  });

  it("[PVC-02] có khoá trong Map nhưng KHÔNG áp dụng (không quyền học ACTIVE / có buổi chưa ghim giáo trình) ⇒ đường cũ, từng con số", () => {
    const ds = lop("A", 30, 18);
    const khongQuyen = new Map([["A", pv("A", { quyenHoc: [qh(13, 24, { status: "EXHAUSTED" })] })]]);
    const chuaGhim = new Map([["A", pv("A", { buoiKhongCoBai: 1 })]]);
    expect(demBuoiTheoPhamVi(ds, khongQuyen)).toStrictEqual(demBuoi(ds));
    expect(demBuoiTheoPhamVi(ds, chuaGhim)).toStrictEqual(demBuoi(ds));
  });

  it("[PVC-03] lớp áp dụng: tổng = số buổi của GÓI, đã dạy = bài trong phạm vi đã diễn ra tới bây giờ, còn lại = phần gói chưa dạy tới", () => {
    const ds = lop("A", 30, 18);
    const r = demBuoiTheoPhamVi(ds, new Map([["A", pv("A")]]));
    expect(r).toEqual({ tong: 12, daDienRa: 6, conLai: 6 }); // bài 13..18 = 6
  });

  it("[PVC-04] mốc 'bây giờ' (BAY_GIO), không phải 'hết ngày': bài chỉ có trong baiDenHetNgay KHÔNG được tính đã dạy", () => {
    const ds = lop("A", 30, 18);
    const r = demBuoiTheoPhamVi(ds, new Map([["A", pv("A", { baiDenHetNgay: bai(1, 19), baiDenBayGio: bai(1, 18) })]]));
    expect(r.daDienRa).toBe(6);
  });

  it("[PVC-05] bài bù miễn phí làm 'đã dạy' vượt tổng ⇒ còn lại KHÔNG âm", () => {
    const ds = lop("A", 30, 30);
    const r = demBuoiTheoPhamVi(ds, new Map([["A", pv("A", { baiDenBayGio: bai(1, 30), quyenHoc: [qh(1, 2)] })]]));
    expect(r.conLai).toBe(0);
    expect(r.tong).toBe(2);
  });

  it("[PVC-06] HAI LỚP — một áp dụng, một không: cộng theo từng lớp; buổi HUỶ của lớp cũ không vào mẫu số", () => {
    const a = lop("A", 30, 18);
    const b = [...lop("B", 10, 4), buoi("B-huy", "B", { daHuy: true })];
    const r = demBuoiTheoPhamVi([...a, ...b], new Map([["A", pv("A")]]));
    expect(r).toEqual({ tong: 12 + 10, daDienRa: 6 + 4, conLai: 6 + 6 });
  });

  it("[PVC-07] quyền học gắn với lớp NÀO thì chỉ đổi số của lớp ĐÓ (khoá Map = classId)", () => {
    const a = lop("A", 30, 18);
    const b = lop("B", 30, 18);
    const chiB = demBuoiTheoPhamVi([...a, ...b], new Map([["B", pv("B")]]));
    const chiA = demBuoiTheoPhamVi([...a, ...b], new Map([["A", pv("A")]]));
    expect(chiB).toEqual(chiA); // đối xứng: mỗi lớp đúng một lần 12/6/6 + một lần 30/18/12
    expect(chiB).toEqual({ tong: 12 + 30, daDienRa: 6 + 18, conLai: 6 + 12 });
  });

  it("[PVC-08] lớp có dữ liệu phạm vi nhưng KHÔNG còn buổi nào trong danh sách vẫn được đếm theo gói", () => {
    const r = demBuoiTheoPhamVi([], new Map([["A", pv("A", { baiDenBayGio: [] })]]));
    expect(r).toEqual({ tong: 12, daDienRa: 0, conLai: 12 });
  });

  it("[PVC-09] học vượt KHÔNG cộng vào 'đã dạy' / 'còn lại' của lớp (nó nằm trong 'đã học' ở thẻ riêng, QĐ-16)", () => {
    const ds = lop("A", 30, 18);
    const khong = demBuoiTheoPhamVi(ds, new Map([["A", pv("A")]]));
    const co = demBuoiTheoPhamVi(ds, new Map([["A", pv("A", { hocVuot: 3 })]]));
    expect(co).toStrictEqual(khong);
    expect(co).toEqual({ tong: 12, daDienRa: 6, conLai: 6 });
  });
});
