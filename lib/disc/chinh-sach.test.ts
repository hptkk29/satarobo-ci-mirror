import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHIEN_DICH_CHO_PHEP,
  CHIEN_DICH_MAC_DINH,
  CUA_SO_DEM_BAI_THEO_SDT_MS,
  DO_DAI_TOI_THIEU_KHOA_IDEM,
  NGAY_GIU_BAI_CHUA_NHAN,
  TOI_DA_BAI_MOI_THEO_CAP,
  TOI_DA_BAI_MOI_THEO_SDT_TRAN_CUNG,
  chienDichHopLe,
} from "./chinh-sach";

describe("[DISC-CS-01] chính sách", () => {
  it("chiến dịch: trong danh sách trắng giữ nguyên; lạ / sai kiểu / khác hoa-thường ⇒ mặc định", () => {
    for (const c of CHIEN_DICH_CHO_PHEP) expect(chienDichHopLe(c)).toBe(c);
    for (const x of ["DOI-TAC", "disc", "DISC ", "", undefined, null, 1, "DISC_ZALO;DROP"]) expect(chienDichHopLe(x)).toBe(CHIEN_DICH_MAC_DINH);
    expect(CHIEN_DICH_CHO_PHEP).toContain(CHIEN_DICH_MAC_DINH);
  });
  it("hằng số ở mức đã chốt trong thiết kế", () => {
    expect(DO_DAI_TOI_THIEU_KHOA_IDEM).toBe(22);
    expect(TOI_DA_BAI_MOI_THEO_CAP).toBe(5);
    expect(TOI_DA_BAI_MOI_THEO_SDT_TRAN_CUNG).toBe(30);
    // N6: trần cứng phải CAO hơn trần cặp — nếu bằng nhau thì quay về đúng lỗi cũ (một SĐT bị khoá bởi 5 bài).
    expect(TOI_DA_BAI_MOI_THEO_SDT_TRAN_CUNG).toBeGreaterThan(TOI_DA_BAI_MOI_THEO_CAP * 2);
    expect(CUA_SO_DEM_BAI_THEO_SDT_MS).toBe(24 * 3_600_000);
    expect(NGAY_GIU_BAI_CHUA_NHAN).toBe(90);
  });
  it("client import được: tệp KHÔNG kéo node:crypto / server-only (neo vào lời import, đã bỏ chú thích)", () => {
    const ma = readFileSync(resolve(process.cwd(), "lib/disc/chinh-sach.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(ma).not.toMatch(/from\s+["'](node:|server-only)/);
    expect(ma).not.toMatch(/^\s*import\s/m);
  });
});
