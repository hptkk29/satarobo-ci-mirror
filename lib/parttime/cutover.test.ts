// [CUT-*] phân loại cutover (`cutover.ts`, thuần). Phần đọc DB + nhập thật: tests/cham-cong/parttime-cutover-cong-cu.spec.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { docThamSo } from "./chinh-sach";
import { phanLoaiCutover, tongHopCutover, type BuoiCutover } from "./cutover";

const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
const TS = docThamSo(JSON.parse(/'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql)![1]));

const b = (p: Partial<BuoiCutover> = {}): BuoiCutover => ({
  sessionId: "s1",
  centerId: "cs1",
  centerCode: "CS1",
  classId: "lop1",
  classCode: "CS1.SATA4.26.001",
  courseId: "k4",
  tenKhoa: "Sata 4",
  sessionType: null,
  ngay: "2026-11-02",
  gioBatDau: "18:00",
  gioKetThuc: "19:30",
  mainId: "gv",
  mainLaDayThay: false,
  taId: null,
  soHocVien: 5,
  taGhiDe: null,
  phanCong: [],
  ...p,
});
const xet = (p: Partial<BuoiCutover> = {}) => phanLoaiCutover(b(p), { thamSo: TS, ghiDe: [] });

describe("[CUT] phân loại cutover", () => {
  it("[CUT-01] buổi sạch chưa có phân công ⇒ READY_TO_IMPORT, nhập đúng GV đứng chính", () => {
    expect(xet()).toMatchObject({ nhom: "READY_TO_IMPORT", nhan: [], chinh: "READY_TO_IMPORT", chinhSach: "CHUAN", seNhap: [{ role: "MAIN_TEACHER", userId: "gv" }] });
  });

  it("[CUT-02] thiếu GV đứng chính ⇒ MISSING_MAIN, không nhập gì", () => {
    expect(xet({ mainId: null })).toMatchObject({ nhom: "MISSING_MAIN", seNhap: [] });
  });

  it("[CUT-03] Q9: TA bắt buộc (Sata4 ≥ 9 HV) mà lớp không có TA ⇒ nhãn MISSING_TA, VẪN nhập GV đứng chính; ghi đè QLCS 'không cần' ⇒ hết nhãn", () => {
    const r = xet({ soHocVien: 9 });
    expect(r).toMatchObject({ nhom: "READY_TO_IMPORT", nhan: ["MISSING_TA"], chinh: "MISSING_TA", yeuCauTA: "REQUIRED", seNhap: [{ role: "MAIN_TEACHER", userId: "gv" }] });
    expect(xet({ soHocVien: 9, taGhiDe: false }).nhan).toEqual([]);
    expect(xet({ soHocVien: 9, taId: "ta" })).toMatchObject({ nhan: [], seNhap: [{ role: "MAIN_TEACHER" }, { role: "TEACHING_ASSISTANT", userId: "ta" }] });
  });

  it("[CUT-04] Q1: 60' / 120' ⇒ nhãn NON_STANDARD_DURATION (chính sách NEEDS_POLICY_DECISION) nhưng VẪN nhập (phân công không phải số tiết)", () => {
    expect(xet({ gioKetThuc: "19:00" })).toMatchObject({ nhom: "READY_TO_IMPORT", nhan: ["NON_STANDARD_DURATION"], chinhSach: "NEEDS_POLICY_DECISION", thoiLuongDayPhut: 60 });
    expect(xet({ gioBatDau: "09:45", gioKetThuc: "11:45" })).toMatchObject({ nhan: ["NON_STANDARD_DURATION", "AMBIGUOUS_SHIFT"], chinh: "NON_STANDARD_DURATION", thoiLuongDayPhut: 120 });
  });

  it("[CUT-05] Q2: khung phải có mặt (chuẩn bị + dạy) vượt ca ⇒ nhãn AMBIGUOUS_SHIFT, vẫn nhập; khung trọn trong T ⇒ không nhãn", () => {
    expect(xet({ gioBatDau: "10:00", gioKetThuc: "11:30" }).nhan).toEqual([]); // 09:50–11:30 trọn trong S 07:45–11:30
    expect(xet({ gioBatDau: "10:05", gioKetThuc: "11:35" })).toMatchObject({ nhan: ["AMBIGUOUS_SHIFT"], nhom: "READY_TO_IMPORT" });
    expect(xet({ gioBatDau: "20:00", gioKetThuc: "21:00" }).nhan).toEqual(["NON_STANDARD_DURATION"]); // 19:50–21:00 trong T
  });

  it("[CUT-06] đã có phân công: chưa nhận ⇒ PENDING_ACCEPTANCE (chỉ nhập vai còn thiếu); nhận đủ ⇒ ACCEPTED; GV đã TỪ CHỐI không nhập lại", () => {
    const cho = { userId: "gv", role: "MAIN_TEACHER" as const, status: "WAITING_ACCEPTANCE", assignmentType: "CUTOVER", daNhan: false };
    expect(xet({ phanCong: [cho], taId: "ta" })).toMatchObject({ nhom: "PENDING_ACCEPTANCE", seNhap: [{ role: "TEACHING_ASSISTANT", userId: "ta" }] });
    expect(xet({ phanCong: [{ ...cho, status: "ACCEPTED", daNhan: true }] })).toMatchObject({ nhom: "ACCEPTED", seNhap: [] });
    const tuChoi = { ...cho, status: "DECLINED" };
    expect(xet({ phanCong: [tuChoi] })).toMatchObject({ nhom: "MISSING_MAIN", lyDo: ["MAIN_MAC_DINH_DA_TU_CHOI"], seNhap: [] });
  });

  it("[CUT-07] phân công TAY lệch GV mặc định ⇒ REVIEW, không ghi đè", () => {
    expect(xet({ phanCong: [{ userId: "khac", role: "MAIN_TEACHER", status: "WAITING_ACCEPTANCE", assignmentType: "MANUAL", daNhan: false }] })).toMatchObject({ nhom: "REVIEW", seNhap: [] });
  });

  it("[CUT-08] INVALID: ngoài SR.QD.238 · thiếu cơ sở · thiếu giờ · lớp không khoá", () => {
    expect(phanLoaiCutover(b(), { thamSo: null, ghiDe: [] })).toMatchObject({ nhom: "INVALID", lyDo: ["NGOAI_SR_QD_238"] });
    expect(xet({ centerId: null })).toMatchObject({ nhom: "INVALID", lyDo: ["THIEU_CO_SO"] });
    expect(xet({ gioKetThuc: null })).toMatchObject({ nhom: "INVALID", lyDo: ["THIEU_GIO"] });
    expect(xet({ courseId: null })).toMatchObject({ nhom: "INVALID", lyDo: ["LOP_KHONG_KHOA"] });
  });

  it("[CUT-09] tổng hợp: một buổi một nhóm chính; nhãn đếm riêng; theo cơ sở", () => {
    const ds = [xet(), xet({ sessionId: "s2", soHocVien: 9 }), xet({ sessionId: "s3", centerCode: "CS2", gioKetThuc: "19:00" }), xet({ sessionId: "s4", mainId: null })];
    const t = tongHopCutover(ds);
    expect(t.tong).toBe(4);
    expect(t.chinh).toEqual({ READY_TO_IMPORT: 1, MISSING_TA: 1, NON_STANDARD_DURATION: 1, MISSING_MAIN: 1 });
    expect(Object.values(t.chinh).reduce((a, x) => a + x, 0)).toBe(4);
    expect(t.nhan).toEqual({ MISSING_TA: 1, NON_STANDARD_DURATION: 1 });
    expect(t.seNhap).toBe(3);
    expect(t.theoCoSo.CS2).toMatchObject({ tong: 1, chinh: { NON_STANDARD_DURATION: 1 } });
  });
});
