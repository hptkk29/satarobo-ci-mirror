/**
 * [EL-NM-*] Ánh xạ trạng thái → nhóm màu. Lưới chính: mọi giá trị của mọi enum TRẠNG THÁI trong schema.prisma phải có khai
 * báo — thêm trạng thái mà quên khai thì đỏ ở đây, không phải một chấm xám lặng lẽ trên màn.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ENUM_TRANG_THAI,
  NHOM_MAC_DINH,
  NHOM_MAU,
  daKhaiTrangThai,
  nhomCoMat,
  nhomMauCuaTrangThai,
} from "@/lib/elearning/nhom-mau-trang-thai";

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");

/** Giá trị của một enum trong schema. */
function giaTriEnum(ten: string): string[] {
  const m = new RegExp(`enum ${ten}\\s*\\{([^}]*)\\}`).exec(SCHEMA);
  if (!m) throw new Error(`Không thấy enum ${ten} trong schema.prisma`);
  return m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l) => l.split(/\s+/)[0]);
}

describe("[EL-NM-01] khai ĐỦ mọi giá trị của mọi enum trạng thái đã đăng ký", () => {
  it("đã đăng ký ≥ 15 enum (chống lưới rỗng)", () => {
    expect(ENUM_TRANG_THAI.length).toBeGreaterThanOrEqual(15);
  });

  it.each(ENUM_TRANG_THAI)("%s: mọi giá trị trong schema đều được khai", (ten) => {
    const chuaKhai = giaTriEnum(ten).filter((v) => !daKhaiTrangThai(ten, v));
    expect(chuaKhai, `${ten} thiếu: ${chuaKhai.join(", ")}`).toEqual([]);
  });
});

describe("[EL-NM-02] nhóm màu", () => {
  it("cùng giá trị, khác enum ⇒ khác nghĩa: REVOKED của chứng nhận là lỗi, của lượt giao là trung tính", () => {
    expect(nhomMauCuaTrangThai("TrnCertStatus", "REVOKED")).toBe("tre-loi");
    expect(nhomMauCuaTrangThai("TrnAssignmentStatus", "REVOKED")).toBe("chua-bat-dau");
  });

  it("trạng thái lạ rơi nhóm mặc định, không ném lỗi, và `daKhai` phân biệt được", () => {
    expect(nhomMauCuaTrangThai("TrnEnrollmentStatus", "SAO_HOA")).toBe(NHOM_MAC_DINH);
    expect(daKhaiTrangThai("TrnEnrollmentStatus", "SAO_HOA")).toBe(false);
    expect(daKhaiTrangThai("TrnEnrollmentStatus", "OVERDUE")).toBe(true);
  });

  it("có ĐỦ năm nhóm theo HANDOFF và mọi nhóm đều được dùng ít nhất một lần", () => {
    expect(NHOM_MAU.map((n) => n.id)).toEqual(["on", "chu-y", "tre-loi", "chua-bat-dau", "da-duyet"]);
    const dung = new Set<string>();
    for (const ten of ENUM_TRANG_THAI) for (const v of giaTriEnum(ten)) dung.add(nhomMauCuaTrangThai(ten, v));
    expect([...dung].sort()).toEqual(NHOM_MAU.map((n) => n.id).sort());
  });

  it("nhomCoMat chỉ giữ nhóm xuất hiện, theo thứ tự chuẩn", () => {
    expect(nhomCoMat(["da-duyet", "on", "on"]).map((n) => n.id)).toEqual(["on", "da-duyet"]);
    expect(nhomCoMat([])).toEqual([]);
  });
});
