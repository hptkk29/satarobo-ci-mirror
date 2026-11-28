// [CI-DB-R*] — luật THUẦN của reporter cổng DB bắt buộc (tests/_helpers/bao-cao-db-bat-buoc.ts). Phần chạy thật (vitest
// lồng vitest, bước CI có gắn reporter) nằm ở scripts/ci/cong-db-khong-rong.test.ts.
import { describe, expect, it } from "vitest";
import { xetKetQuaDb } from "./bao-cao-db-bat-buoc";

describe("[CI-DB-R] reporter cổng DB bắt buộc", () => {
  it("[CI-DB-R1] 0 tệp ⇒ ĐỎ", () => {
    expect(xetKetQuaDb([]).ok).toBe(false);
  });

  it("[CI-DB-R2] một tệp skip TOÀN BỘ (DB không tới được) ⇒ ĐỎ, nêu đích danh tệp", () => {
    const kq = xetKetQuaDb([
      { tep: "tests/cham-cong/a.spec.ts", trangThai: ["passed", "passed"] },
      { tep: "tests/cham-cong/b.spec.ts", trangThai: ["skipped", "skipped"] },
    ]);
    expect(kq.ok).toBe(false);
    expect(kq.loi).toHaveLength(1);
    expect(kq.loi[0]).toContain("tests/cham-cong/b.spec.ts");
  });

  it("[CI-DB-R3] tệp chỉ có todo ⇒ ĐỎ (0 ca chạy)", () => {
    expect(xetKetQuaDb([{ tep: "x.spec.ts", trangThai: ["pending"] }]).ok).toBe(false);
  });

  it("[CI-DB-R4] đối chứng dương: mỗi tệp ≥ 1 ca chạy (kể cả ca ĐỎ — vitest tự báo đỏ) ⇒ reporter không thêm lỗi", () => {
    const kq = xetKetQuaDb([
      { tep: "a.spec.ts", trangThai: ["passed", "skipped"] },
      { tep: "b.spec.ts", trangThai: ["failed"] },
    ]);
    expect(kq).toEqual({ ok: true, loi: [] });
  });
});
