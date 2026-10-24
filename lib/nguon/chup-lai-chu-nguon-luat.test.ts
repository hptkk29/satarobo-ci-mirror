// @vitest-environment node
/**
 * [CCN-01..05] — LUẬT THUẦN của «chụp lại chủ nguồn» (`chup-lai-chu-nguon-luat.ts`). Không DB.
 *
 *   [CCN-01] `phanLoaiChuChup`: chỉ ba lý do (thiếu chủ · nghỉ việc · hồ sơ không còn); chủ còn làm (ACTIVE · ON_LEAVE) và chủ = chủ hiện tại KHÔNG thuộc diện
 *   [CCN-02] tập «nghỉ» là CHÍNH `TRANG_THAI_NGHI` của engine (không bản thứ hai)
 *   [CCN-03] `kiemChuHienTai`: chưa khai · nghỉ · chưa tài khoản ⇒ từ chối; ACTIVE/ON_LEAVE + có tài khoản ⇒ qua
 *   [CCN-04] `kiemLyDoChupLai`: ≥ 10 ký tự SAU trim
 *   [CCN-05] hằng số lô: cỡ lô của action ≤ trần
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TRANG_THAI_NGHI } from "@/lib/hoa-hong/nguoi-huong";
import { CO_LO_CHUP_LAI, CO_LO_TOI_DA, kiemChuHienTai, kiemLyDoChupLai, phanLoaiChuChup } from "./chup-lai-chu-nguon-luat";

const NHAN_SU = new Map<string, string>([
  ["lam", "ACTIVE"],
  ["nghiPhep", "ON_LEAVE"],
  ["nghiViec", "RESIGNED"],
  ["duoiViec", "TERMINATED"],
]);
const HIEN_TAI = "chuMoi";
const phanLoai = (chuChup: string | null, chuHienTai = HIEN_TAI) => phanLoaiChuChup({ chuChup, chuHienTai, trangThaiNhanSu: NHAN_SU });

describe("[CCN-01] phanLoaiChuChup", () => {
  it("chụp null ⇒ THIEU_CHU", () => expect(phanLoai(null)).toBe("THIEU_CHU"));
  it("chủ đã chụp nghỉ việc / bị cho nghỉ ⇒ CHU_NGHI_VIEC", () => {
    expect(phanLoai("nghiViec")).toBe("CHU_NGHI_VIEC");
    expect(phanLoai("duoiViec")).toBe("CHU_NGHI_VIEC");
  });
  it("chủ đã chụp không còn hồ sơ ⇒ CHU_KHONG_CON_HO_SO", () => expect(phanLoai("daXoa")).toBe("CHU_KHONG_CON_HO_SO"));
  it("chủ đã chụp CÒN LÀM (ACTIVE · ON_LEAVE) ⇒ KHÔNG thuộc diện (không hồi tố tiền đã chốt)", () => {
    expect(phanLoai("lam")).toBeNull();
    expect(phanLoai("nghiPhep")).toBeNull();
  });
  it("chủ đã chụp = chủ hiện tại ⇒ không thuộc diện, kể cả khi người ấy đã nghỉ (chụp lại sang chính họ là vô nghĩa)", () => {
    expect(phanLoai("nghiViec", "nghiViec")).toBeNull();
    expect(phanLoai(HIEN_TAI)).toBeNull();
  });
  it("đối chứng dương: ba lý do đều xuất hiện trên cùng một bảng", () => {
    const lyDo = new Set([phanLoai(null), phanLoai("nghiViec"), phanLoai("daXoa")]);
    expect(lyDo).toEqual(new Set(["THIEU_CHU", "CHU_NGHI_VIEC", "CHU_KHONG_CON_HO_SO"]));
  });
});

describe("[CCN-02] tập «nghỉ» là của engine", () => {
  it("mọi trạng thái engine coi là nghỉ đều thuộc diện; mọi trạng thái còn lại thì không", () => {
    for (const tt of ["RESIGNED", "TERMINATED", "ACTIVE", "ON_LEAVE"]) {
      const m = new Map([["x", tt]]);
      const ra = phanLoaiChuChup({ chuChup: "x", chuHienTai: HIEN_TAI, trangThaiNhanSu: m });
      expect(ra === "CHU_NGHI_VIEC", tt).toBe(TRANG_THAI_NGHI.has(tt));
    }
    expect(TRANG_THAI_NGHI.size).toBeGreaterThan(0);
  });
  it("tệp luật KHÔNG tự gõ tên trạng thái nghỉ (gõ lại là có bản thứ hai)", () => {
    const ma = readFileSync(resolve(process.cwd(), "lib/nguon/chup-lai-chu-nguon-luat.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
      .join("\n");
    expect(ma).not.toMatch(/["']RESIGNED["']/);
    expect(ma).not.toMatch(/["']TERMINATED["']/);
    expect(ma).toMatch(/TRANG_THAI_NGHI/);
  });
});

describe("[CCN-03] kiemChuHienTai", () => {
  it("chưa khai chủ ⇒ từ chối, nói làm gì", () => expect(kiemChuHienTai(null)).toMatch(/Sửa nguồn/));
  it("đã nghỉ ⇒ từ chối", () => {
    expect(kiemChuHienTai({ status: "RESIGNED", coTaiKhoan: true })).toMatch(/nghỉ việc/);
    expect(kiemChuHienTai({ status: "TERMINATED", coTaiKhoan: true })).toMatch(/nghỉ việc/);
  });
  it("chưa có tài khoản ⇒ từ chối (chụp xong vẫn treo)", () => expect(kiemChuHienTai({ status: "ACTIVE", coTaiKhoan: false })).toMatch(/tài khoản/));
  it("ACTIVE · ON_LEAVE + có tài khoản ⇒ qua", () => {
    expect(kiemChuHienTai({ status: "ACTIVE", coTaiKhoan: true })).toBeNull();
    expect(kiemChuHienTai({ status: "ON_LEAVE", coTaiKhoan: true })).toBeNull();
  });
});

describe("[CCN-04] kiemLyDoChupLai", () => {
  it("rỗng · null · undefined · 9 ký tự · toàn khoảng trắng ⇒ từ chối", () => {
    for (const v of [null, undefined, "", "   ", "123456789", "  12345678  "]) expect(kiemLyDoChupLai(v), String(v)).not.toBeNull();
  });
  it("đúng 10 ký tự SAU trim ⇒ qua", () => {
    expect(kiemLyDoChupLai("1234567890")).toBeNull();
    expect(kiemLyDoChupLai("   1234567890  ")).toBeNull();
  });
});

describe("[CCN-05] cỡ lô", () => {
  it("cỡ lô của action nằm trong (0, trần]", () => {
    expect(CO_LO_CHUP_LAI).toBeGreaterThan(0);
    expect(CO_LO_CHUP_LAI).toBeLessThanOrEqual(CO_LO_TOI_DA);
  });
});
