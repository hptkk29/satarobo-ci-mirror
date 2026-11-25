import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { canVoHieuTaiKhoan, laDaNghi } from "./nghi-viec";

const GOC = join(__dirname, "..", "..");
const doc = (p: string) => readFileSync(join(GOC, p), "utf8");

describe("canVoHieuTaiKhoan — nghỉ việc thì tài khoản chết theo", () => {
  it("ACTIVE → RESIGNED / TERMINATED ⇒ vô hiệu hoá", () => {
    expect(canVoHieuTaiKhoan("ACTIVE", "RESIGNED")).toBe(true);
    expect(canVoHieuTaiKhoan("ACTIVE", "TERMINATED")).toBe(true);
  });

  it("ON_LEAVE (tạm nghỉ sản/ốm) KHÔNG phải nghỉ việc — tài khoản giữ nguyên", () => {
    // Nhầm chỗ này là khoá tài khoản của người đang nghỉ thai sản.
    expect(canVoHieuTaiKhoan("ACTIVE", "ON_LEAVE")).toBe(false);
    expect(laDaNghi("ON_LEAVE")).toBe(false);
  });

  it("sửa hồ sơ của người VỐN ĐÃ nghỉ ⇒ KHÔNG bump lại", () => {
    // Đổi tên / đổi ngày kết thúc của hồ sơ đã nghỉ không phải sự kiện nghỉ việc;
    // bump `tokenVersion` lần nữa là vô nghĩa, tài khoản đã chết từ lần trước.
    expect(canVoHieuTaiKhoan("RESIGNED", "RESIGNED")).toBe(false);
    expect(canVoHieuTaiKhoan("TERMINATED", "RESIGNED")).toBe(false);
  });

  it("MỘT CHIỀU: đã nghỉ → đi làm lại KHÔNG tự bật tài khoản", () => {
    // Mở lại quyền truy cập là quyết định riêng, phải có người bấm ở màn tài khoản.
    // Tự động bật lại là biến một lần sửa nhầm trạng thái thành một lần cấp quyền.
    expect(canVoHieuTaiKhoan("RESIGNED", "ACTIVE")).toBe(false);
  });

  it("thiếu dữ liệu (undefined/null) ⇒ không làm gì", () => {
    expect(canVoHieuTaiKhoan(undefined, undefined)).toBe(false);
    expect(canVoHieuTaiKhoan(null, null)).toBe(false);
    expect(canVoHieuTaiKhoan("ACTIVE", undefined)).toBe(false);
  });
});

describe("cắm đúng chỗ trong màn nhân sự", () => {
  const F = "app/(admin)/admin/nhan-su/actions.ts";

  it("gọi cổng sau khi ĐÃ ghi hồ sơ, dùng snapshot before/after", () => {
    const src = doc(F);
    expect(src).toContain(
      "canVoHieuTaiKhoan(auditBefore?.status, auditAfter?.status)",
    );
    // Phải nằm SAU lượt ghi hồ sơ: hồ sơ là việc chính, khoá tài khoản là hệ quả.
    expect(
      src.indexOf("await sdb.employee.update({ where: { id }, data })"),
    ).toBeLessThan(src.indexOf("canVoHieuTaiKhoan("));
  });

  it("vô hiệu hoá phải bump tokenVersion — không thì JWT cũ vẫn sống tới hạn", () => {
    const src = doc(F);
    const than = src.slice(
      src.indexOf("canVoHieuTaiKhoan("),
      src.indexOf("ĐƠN VỊ NẰM Ở HAI BẢNG"),
    );
    expect(than).toContain("isActive: false");
    expect(than).toContain("tokenVersion: { increment: 1 }");
  });

  it("hỏng thì để lại dấu, và KHÔNG làm hỏng lượt sửa hồ sơ", () => {
    const src = doc(F);
    const than = src.slice(
      src.indexOf("canVoHieuTaiKhoan("),
      src.indexOf("ĐƠN VỊ NẰM Ở HAI BẢNG"),
    );
    expect(than).toContain("DEACTIVATE_ON_OFFBOARD");
    expect(than).toContain("catch");
  });
});
