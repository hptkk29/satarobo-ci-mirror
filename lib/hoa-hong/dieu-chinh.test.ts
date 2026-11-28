// @vitest-environment node
/**
 * [NHH-ADJ-*] — PHÉP TÍNH THUẦN của điều chỉnh sổ (PR5b): chênh lệch khi khoản thu bị rút / khoản hoàn bị bác, cổng giải hàng chờ, và ánh xạ tầng cũ → vai mới.
 * THUẦN: không DB. Ca DB (thật) ở `tests/hoa-hong/so-dieu-chinh.spec.ts`.
 */
import { describe, expect, it } from "vitest";

import { batGiaiHangCho, chenhDaoSach, chenhKhoiPhucHoan, kiemGiaiHangCho } from "./dieu-chinh";
import { khoaNguoi } from "./khoa-so";
import { vaiCuaTangCu } from "./legacy-reversal";
import { tinhChenhTheoNguoi } from "./o-tinh";

const SALE = khoaNguoi("SALE", "USER", "u-sale");
const QLCS = khoaNguoi("CENTER_MANAGER", "USER", "u-ql");
const MKT = khoaNguoi("MARKETING", "USER", "u-mkt");

describe("[NHH-ADJ-01] chenhDaoSach — khoản thu rút khỏi thực thu ⇒ đảo SẠCH số ròng từng người", () => {
  it("chênh = −ròng; người ròng 0 không có dòng; sắp tất định theo khoá", () => {
    const r = chenhDaoSach(
      new Map([
        [QLCS, 200_000],
        [SALE, 400_000],
        [MKT, 0],
      ]),
    );
    expect(r.map((c) => [c.key, c.chenh])).toEqual([
      [QLCS, -200_000],
      [SALE, -400_000],
    ]);
  });

  it("ròng ÂM (đã đảo quá) ⇒ vẫn đảo về 0 (chênh dương) — không bỏ sót; ô trống ⇒ rỗng", () => {
    expect(chenhDaoSach(new Map([[SALE, -30]]))[0]!.chenh).toBe(30);
    expect(chenhDaoSach(new Map())).toEqual([]);
  });

  it("đảo sạch rồi cộng lại = 0 đúng từng người (không lệch 1đ)", () => {
    const rong = new Map([
      [SALE, 119_999],
      [QLCS, 60_001],
    ]);
    const tong = new Map(rong);
    for (const c of chenhDaoSach(rong)) tong.set(c.key, (tong.get(c.key) ?? 0) + c.chenh);
    expect([...tong.values()]).toEqual([0, 0]);
  });
});

describe("[NHH-ADJ-02] chenhKhoiPhucHoan — khoản HOÀN bị bác ⇒ trả lại đúng số đã thu hồi", () => {
  it("chênh = −Σ REVERSAL của người đó (REVERSAL âm ⇒ chênh dương); gộp nhiều dòng cùng người", () => {
    const r = chenhKhoiPhucHoan([
      { key: SALE, amount: -120_000 },
      { key: SALE, amount: -30_000 },
      { key: QLCS, amount: -60_000 },
    ]);
    expect(r.map((c) => [c.key, c.chenh])).toEqual([
      [QLCS, 60_000],
      [SALE, 150_000],
    ]);
  });

  it("Σ = 0 ⇒ không có dòng", () => {
    expect(chenhKhoiPhucHoan([{ key: SALE, amount: 0 }])).toEqual([]);
  });
});

describe("[NHH-ADJ-03] tinhChenhTheoNguoi — MỘT chỗ tính chênh cho phát hiện và cho đường ghi", () => {
  it("kỳ vọng − ròng, hai phía vắng = 0, chỉ người chênh ≠ 0, sắp theo khoá", () => {
    const r = tinhChenhTheoNguoi(
      new Map([
        [SALE, 100],
        [MKT, 60_000],
      ]),
      new Map([
        [SALE, 100],
        [QLCS, 40],
      ]),
    );
    expect(r).toEqual([
      { key: QLCS, chenh: -40, kyVong: 0, rong: 40 },
      { key: MKT, chenh: 60_000, kyVong: 60_000, rong: 0 },
    ]);
  });
});

describe("[NHH-ADJ-04] kiemGiaiHangCho — cổng giải hàng chờ", () => {
  it("chỉ INPUT_DRIFT và PAYMENT_WITHDRAWN giải được, và chỉ khi còn OPEN", () => {
    expect(kiemGiaiHangCho({ code: "INPUT_DRIFT", trangThai: "OPEN", quyetDinh: "AP_DUNG" })).toBeNull();
    expect(kiemGiaiHangCho({ code: "PAYMENT_WITHDRAWN", trangThai: "OPEN", quyetDinh: "GIU_NGUYEN" })).toBeNull();
    expect(kiemGiaiHangCho({ code: "INPUT_DRIFT", trangThai: "RESOLVED", quyetDinh: "AP_DUNG" })).toMatch(/đã được xử lý/);
    expect(kiemGiaiHangCho({ code: "INPUT_DRIFT", trangThai: "DISMISSED", quyetDinh: "AP_DUNG" })).toMatch(/đã được xử lý/);
    for (const code of ["CAP_EXCEEDED", "POLICY_OVERLAP", "MANUAL_REVIEW_REQUIRED", "INTERNAL_TRANSFER", "NEGATIVE_WITHOUT_ORIGIN", "NO_ORG_UNIT", "CHO_HOC_VIEN"] as const) {
      expect(kiemGiaiHangCho({ code, trangThai: "OPEN", quyetDinh: "AP_DUNG" }), code).toMatch(/không giải bằng/);
    }
  });

  it("quyết định lạ bị từ chối; batGiaiHangCho NÉM HoaHongError (không trả giá trị)", () => {
    expect(kiemGiaiHangCho({ code: "INPUT_DRIFT", trangThai: "OPEN", quyetDinh: "TU_DONG" as never })).toMatch(/không hợp lệ/);
    expect(() => batGiaiHangCho({ code: "INPUT_DRIFT", trangThai: "RESOLVED", quyetDinh: "AP_DUNG" })).toThrowError(
      expect.objectContaining({ ma: "HANG_CHO_KHONG_GIAI_DUOC" }),
    );
  });
});

describe("[NHH-ADJ-05] vaiCuaTangCu — LEGACY_REVERSAL ánh xạ tầng cũ → vai mới (04 §6.7)", () => {
  it("SALE→SALE · SALE_ADMIN→SALE_ADMIN · QL_TT→CENTER_MANAGER · QC→MARKETING", () => {
    expect(vaiCuaTangCu("SALE")).toBe("SALE");
    expect(vaiCuaTangCu("SALE_ADMIN")).toBe("SALE_ADMIN");
    expect(vaiCuaTangCu("QL_TT")).toBe("CENTER_MANAGER");
    expect(vaiCuaTangCu("QC")).toBe("MARKETING");
  });

  it("TRIAL_TEACHER KHÔNG có vai thu hồi (engine cũ chưa bao giờ thu hồi tầng này — 04 Q10); tầng lạ ⇒ null", () => {
    expect(vaiCuaTangCu("TRIAL_TEACHER")).toBeNull();
    expect(vaiCuaTangCu("KHONG_CO")).toBeNull();
  });
});
