// @vitest-environment node
// [HKC-*] Kho tệp hoá đơn CỤC BỘ (chỉ dev): tắt cứng ở production, không đi ra ngoài thư mục.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { docTepKhoCucBo, duongDanTrongKho, thuMucKhoCucBo } from "@/lib/portal/hoa-don-kho-cuc-bo";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kho-hd-"));
  mkdirSync(join(dir, "hoa-don", "x"), { recursive: true });
  writeFileSync(join(dir, "hoa-don", "x", "a.pdf"), "PDFDATA");
  writeFileSync(join(tmpdir(), "ngoai-kho.txt"), "BIMAT");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("[HKC-01] công tắc", () => {
  it("không đặt biến ⇒ null; đặt biến (dev/test) ⇒ đường tuyệt đối của thư mục", () => {
    vi.stubEnv("PORTAL_HOA_DON_KHO_CUC_BO", "");
    expect(thuMucKhoCucBo()).toBeNull();
    vi.stubEnv("PORTAL_HOA_DON_KHO_CUC_BO", dir);
    expect(thuMucKhoCucBo()).toBe(resolve(dir));
  });
  it("production ⇒ LUÔN null dù biến có đặt (tắt cứng)", () => {
    vi.stubEnv("PORTAL_HOA_DON_KHO_CUC_BO", dir);
    vi.stubEnv("NODE_ENV", "production");
    expect(thuMucKhoCucBo()).toBeNull();
  });
});

describe("[HKC-02] không thoát ra ngoài thư mục", () => {
  it("khoá hợp lệ ⇒ đường trong thư mục; `..`, tuyệt đối, rỗng, NUL, chính thư mục ⇒ null", () => {
    expect(duongDanTrongKho(dir, "hoa-don/x/a.pdf")).toBe(resolve(dir, "hoa-don/x/a.pdf"));
    for (const k of ["../ngoai-kho.txt", "hoa-don/../../ngoai-kho.txt", join(tmpdir(), "ngoai-kho.txt"), "", "a\0b", ".", "hoa-don/.."]) {
      expect(duongDanTrongKho(dir, k), JSON.stringify(k)).toBeNull();
    }
  });
  it("thư mục anh em trùng tiền tố (`kho-hd-x` vs `kho-hd-xy`) không bị coi là nằm trong", () => {
    expect(duongDanTrongKho(dir, `../${dir.split(/[\\/]/).pop()}-anh-em/a.pdf`)).toBeNull();
  });
});

describe("[HKC-03] đọc tệp", () => {
  it("có tệp ⇒ byte; không có ⇒ null; khoá thoát thư mục ⇒ null (KHÔNG đọc được tệp ngoài kho)", async () => {
    expect((await docTepKhoCucBo(dir, "hoa-don/x/a.pdf"))?.toString()).toBe("PDFDATA");
    expect(await docTepKhoCucBo(dir, "hoa-don/x/khong-co.pdf")).toBeNull();
    expect(await docTepKhoCucBo(dir, "../ngoai-kho.txt")).toBeNull();
  });
});
