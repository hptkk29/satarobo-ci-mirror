/**
 * [DISC-PEPPER-*] MỘT khoá băm cho phoneKey + mã nhận ở MỌI đường (lưu · nhận · xoá).
 *
 * Sự cố bắt được ở review 01/11/2026 (N15): /luu và /xoa dùng `layKhoaDisc()` nhưng nhận bài
 * (`nhan.ts`, `nhan-prisma.ts`) còn dùng `getSigningSecret()`. Test từng bên đều xanh vì đều tiêm
 * khoá/mock; đặt `DISC_PEPPER` là mọi lượt nhận thất bại IM LẶNG. Lưới này ghim dây nối.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { layKhoaDisc } from "./phone-key";
import { bamMaNhan } from "./luu";

const doc = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("[DISC-PEPPER-01] đường nhận dùng cùng khoá với đường lưu", () => {
  it("nhan.ts và nhan-prisma.ts lấy khoá từ layKhoaDisc, không còn getSigningSecret", () => {
    for (const f of ["lib/disc/nhan.ts", "lib/disc/nhan-prisma.ts"]) {
      const s = doc(f);
      expect(s, f).toMatch(/layKhoaDisc/);
      expect(s, f).not.toMatch(/getSigningSecret/);
    }
  });
});

describe("[DISC-PEPPER-02] đặt DISC_PEPPER làm khoá đổi, băm đổi theo (đối chứng cho ca trên)", () => {
  const cu = process.env.DISC_PEPPER;
  const cuSecret = process.env.NEXTAUTH_SECRET;
  beforeEach(() => {
    // Tự đủ điều kiện: không phụ thuộc env của máy/hook (khoá mặc định cần ≥32 ký tự).
    process.env.NEXTAUTH_SECRET = "khoa-ky-gia-chi-dung-cho-test-pepper-0123456789";  // gitleaks:allow
  });
  afterEach(() => {
    if (cu === undefined) delete process.env.DISC_PEPPER;
    else process.env.DISC_PEPPER = cu;
    if (cuSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = cuSecret;
  });
  it("khoá không đặt ≠ khoá đặt ⇒ băm mã nhận khác nhau (nếu một đường quên dùng nó thì lệch)", () => {
    delete process.env.DISC_PEPPER;
    const a = bamMaNhan("ABCDEFGHJK", layKhoaDisc());
    process.env.DISC_PEPPER = "pepper-gia-chi-dung-cho-test-0123456789";
    const b = bamMaNhan("ABCDEFGHJK", layKhoaDisc());
    expect(a).not.toBe(b);
  });
});
