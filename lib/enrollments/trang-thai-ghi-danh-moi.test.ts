// [TGM-*] Ghi danh mới vào lớp: lớp ĐANG CHẠY ⇒ "Đang học"; lớp chưa khai giảng ⇒ trạng thái riêng của từng
// đường (chủ dự án chốt 11/10/2026 — ca prod CS2-26-57AWRE, xem đầu lib/enrollments/trang-thai-ghi-danh-moi.ts).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ClassStatus } from "@prisma/client";
import { mocThoiGianGhiDanhMoi, trangThaiGhiDanhMoi, type KhiLopChuaChay } from "./trang-thai-ghi-danh-moi";
import { ENROLLMENT_ACTIVE_STATUS_LIST, STUDYING_ENROLLMENT_STATUSES } from "@/lib/enrollment-status";

const MOI_TRANG_THAI_LOP: ClassStatus[] = ["ACTIVE", "PLANNED", "RECRUITING", "PENDING_APPROVAL", "COMPLETED", "CANCELLED"];

const nguon = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/^\s*\/\/.*$/gm, "");

describe("[TGM] trạng thái ghi danh mới theo trạng thái lớp", () => {
  it("[TGM-01] CHỈ lớp ACTIVE ⇒ STUDYING; mọi trạng thái lớp khác ⇒ đúng trạng thái đường đó khai", () => {
    for (const khi of ["PENDING", "CONFIRMED"] as KhiLopChuaChay[]) {
      for (const lop of MOI_TRANG_THAI_LOP) {
        expect(trangThaiGhiDanhMoi(lop, khi), `${lop}/${khi}`).toBe(lop === "ACTIVE" ? "STUDYING" : khi);
      }
    }
  });

  it("[TGM-02] STUDYING là trạng thái giáo viên THẤY và danh sách in 'Đang học'; PENDING thì không (đối chứng)", () => {
    expect(ENROLLMENT_ACTIVE_STATUS_LIST).toContain("STUDYING");
    expect(STUDYING_ENROLLMENT_STATUSES).toContain("STUDYING");
    expect(ENROLLMENT_ACTIVE_STATUS_LIST).not.toContain("PENDING");
  });

  it("[TGM-03] mốc thời gian: STUDYING ⇒ confirmedAt + startedAt; CONFIRMED ⇒ confirmedAt; PENDING ⇒ không gì", () => {
    const luc = new Date("2026-10-11T03:00:00Z");
    expect(mocThoiGianGhiDanhMoi("STUDYING", luc)).toEqual({ confirmedAt: luc, startedAt: luc });
    expect(mocThoiGianGhiDanhMoi("CONFIRMED", luc)).toEqual({ confirmedAt: luc });
    expect(mocThoiGianGhiDanhMoi("PENDING", luc)).toEqual({});
  });

  it("[TGM-W1] enrollStudent (/enrollments/new): trạng thái tính từ lớp, lớp chưa chạy ⇒ PENDING; không còn PENDING gõ cứng", () => {
    const s = nguon("app/(admin)/admin/enrollments/_actions.ts");
    const fn = s.slice(s.indexOf("export async function enrollStudent("), s.indexOf("const ChangeStatusSchema"));
    expect(fn.match(/trangThaiGhiDanhMoi\(cls\.status as ClassStatus, "PENDING"\)/g)).toHaveLength(1);
    expect(fn.match(/status: trangThaiMoi,/g)).toHaveLength(2); // dữ liệu tạo + AuditLog
    expect(fn).toMatch(/\.\.\.mocThoiGianGhiDanhMoi\(trangThaiMoi, new Date\(\)\)/);
    expect(fn).not.toMatch(/status: "PENDING"/);
  });

  it("[TGM-W2] enrollGroupIntoClass (nhóm lớp): đọc status lớp, lớp chưa chạy ⇒ CONFIRMED; không còn CONFIRMED gõ cứng", () => {
    const s = nguon("app/(admin)/admin/class-groups/_actions.ts");
    const fn = s.slice(s.indexOf("export async function enrollGroupIntoClass("));
    const than = fn.slice(0, fn.indexOf("\nexport async function", 10) === -1 ? undefined : fn.indexOf("\nexport async function", 10));
    expect(than).toMatch(/select: \{ id: true, courseId: true, classGroupId: true, centerId: true, status: true \}/);
    expect(than.match(/trangThaiGhiDanhMoi\(cls\.status, "CONFIRMED"\)/g)).toHaveLength(1);
    expect(than).toMatch(/status: trangThaiMoi, \.\.\.mocThoiGianGhiDanhMoi\(trangThaiMoi, new Date\(\)\)/);
    expect(than).not.toMatch(/status: "CONFIRMED"/);
  });

  it("[TGM-W3] chuyenLopTrongTx (chuyển lớp / đổi khoá): theo status lớp ĐÍCH, chưa chạy ⇒ CONFIRMED", () => {
    const s = nguon("lib/enrollments/chuyen-lop.ts");
    const fn = s.slice(s.indexOf("export async function chuyenLopTrongTx("));
    expect(fn.match(/trangThaiGhiDanhMoi\(lop\.status, "CONFIRMED"\)/g)).toHaveLength(1);
    const tao = fn.slice(fn.indexOf("tx.enrollment.create("), fn.indexOf("tx.enrollment.update("));
    expect(tao).toMatch(/status: trangThaiMoi,\n\s*\.\.\.mocThoiGianGhiDanhMoi\(trangThaiMoi, new Date\(\)\)/);
    expect(tao).not.toMatch(/status: "CONFIRMED"/);
  });
});
