// @vitest-environment node
/** [SKT-*] Tab của màn Soạn khoá — suy từ PHIÊN BẢN, không từ cột trạng thái của khoá. */
import { describe, expect, it } from "vitest";
import { cacTabCuaKhoa, demTheoTab, nhanChinhCuaKhoa, type KhoaDeXep } from "./soan-khoa-tab";

const k = (status: KhoaDeXep["status"], ...ban: KhoaDeXep["banTrangThai"]): KhoaDeXep => ({ status, banTrangThai: ban });

describe("[SKT-01] cacTabCuaKhoa", () => {
  it("🔴 'Chờ duyệt' / 'Đã duyệt' tới từ PHIÊN BẢN (khoá vẫn status DRAFT) — nếu suy từ status khoá thì hai tab này luôn rỗng", () => {
    expect(cacTabCuaKhoa(k("DRAFT", "PENDING_REVIEW"))).toEqual(["cho-duyet"]);
    expect(cacTabCuaKhoa(k("DRAFT", "APPROVED"))).toEqual(["da-duyet"]);
  });
  it("khoá mới tạo (chưa phiên bản) ⇒ Nháp; đã phát hành ⇒ Đang phát hành; lưu trữ ⇒ Lưu trữ", () => {
    expect(cacTabCuaKhoa(k("DRAFT"))).toEqual(["nhap"]);
    expect(cacTabCuaKhoa(k("PUBLISHED", "PUBLISHED"))).toEqual(["phat-hanh"]);
    expect(cacTabCuaKhoa(k("ARCHIVED", "ARCHIVED"))).toEqual(["luu-tru"]);
  });
  it("khoá đang phát hành CÓ bản nháp sửa dở ⇒ thuộc CẢ hai tab (sự thật của dữ liệu)", () => {
    expect(cacTabCuaKhoa(k("PUBLISHED", "PUBLISHED", "DRAFT"))).toEqual(["nhap", "phat-hanh"]);
  });
  it("khoá đã phát hành, không bản nháp ⇒ KHÔNG ở tab Nháp (đối chứng)", () => {
    expect(cacTabCuaKhoa(k("PUBLISHED", "PUBLISHED"))).not.toContain("nhap");
  });
});

describe("[SKT-02] nhanChinhCuaKhoa", () => {
  it("ưu tiên việc đang cần làm: chờ duyệt > đã duyệt > nháp > trạng thái khoá", () => {
    expect(nhanChinhCuaKhoa(k("PUBLISHED", "PUBLISHED", "DRAFT", "PENDING_REVIEW")).id).toBe("PENDING_REVIEW");
    expect(nhanChinhCuaKhoa(k("DRAFT", "APPROVED")).id).toBe("APPROVED");
    expect(nhanChinhCuaKhoa(k("PUBLISHED", "PUBLISHED", "DRAFT")).nhan).toBe("Đang phát hành · có bản nháp");
    expect(nhanChinhCuaKhoa(k("PUBLISHED", "PUBLISHED")).id).toBe("PUBLISHED");
    expect(nhanChinhCuaKhoa(k("ARCHIVED", "ARCHIVED")).id).toBe("ARCHIVED");
  });
});

describe("[SKT-03] demTheoTab", () => {
  it("đếm theo tab (một khoá có thể được đếm hai lần)", () => {
    const d = demTheoTab([k("DRAFT"), k("DRAFT", "PENDING_REVIEW"), k("PUBLISHED", "PUBLISHED", "DRAFT"), k("ARCHIVED", "ARCHIVED")]);
    expect(d).toEqual({ nhap: 2, "cho-duyet": 1, "da-duyet": 0, "phat-hanh": 1, "luu-tru": 1 });
  });
});
