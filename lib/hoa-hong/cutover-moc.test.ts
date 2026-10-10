// @vitest-environment node
/**
 * [NHH-PER-03c0] — CỔNG ĐẶT / DỜI / GỠ MỐC CUTOVER (`quyetDinhDatMoc`, THUẦN). Bảng điều kiện ở 05 §2.2c bước 3. Ca DB (thật, một transaction, khoá advisory)
 * ở `tests/hoa-hong/cutover.spec.ts`.
 *
 * Mỗi ca là MỘT dòng của bảng cổng + đối chứng dương cạnh nó (luật 11 của CLAUDE.md "Affordance"): ca chỉ khẳng định SỰ VẮNG MẶT luôn đạt khi tính năng hỏng hoàn toàn.
 */
import { describe, expect, it } from "vitest";

import { quyetDinhDatMoc, type DauVaoDatMoc } from "./cutover";

const NEN: DauVaoDatMoc = {
  cu: null,
  moi: "2026-12",
  thangHienTai: "2026-10",
  coBangKeTuMoi: false,
  kyApprovedThieuManifest: [],
  soDongSoMoiBiAnhHuong: 0,
};
const q = (o: Partial<DauVaoDatMoc>) => quyetDinhDatMoc({ ...NEN, ...o });

describe("[NHH-PER-03c0] đặt LẦN ĐẦU (null → P)", () => {
  it("đối chứng dương: P ở tương lai · sạch bảng kê · mọi kỳ APPROVED có manifest ⇒ được", () => {
    expect(q({})).toEqual({ ok: true, hanhDong: "DAT_LAN_DAU" });
  });

  it.each([
    ["P = tháng hiện tại", { moi: "2026-10" }, "MOC_KHONG_O_TUONG_LAI"],
    ["P trong quá khứ", { moi: "2026-09" }, "MOC_KHONG_O_TUONG_LAI"],
    ["đã có bảng kê cũ cho tháng ≥ P (mọi trạng thái)", { coBangKeTuMoi: true }, "CO_BANG_KE_CU"],
    ["có kỳ APPROVED chưa có manifest", { kyApprovedThieuManifest: ["2026-09"] }, "THIEU_MANIFEST"],
  ] as const)("TỪ CHỐI: %s", (_ten, o, ma) => {
    const r = q(o);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ma).toBe(ma);
  });

  it("lời từ chối manifest NÊU kỳ nào thiếu (người vận hành biết phải dựng lại kỳ nào)", () => {
    const r = q({ kyApprovedThieuManifest: ["2026-08", "2026-09"] });
    expect(!r.ok && r.lyDo).toMatch(/2026-08, 2026-09/);
  });

  it("sai dạng ⇒ từ chối; không đổi ⇒ từ chối (MOC_KHONG_DOI), kể cả null → null", () => {
    expect(q({ moi: "2026-1" })).toMatchObject({ ok: false, ma: "MOC_SAI_DANG" });
    expect(q({ cu: "2026-12", moi: "2026-12" })).toMatchObject({ ok: false, ma: "MOC_KHONG_DOI" });
    expect(q({ cu: null, moi: null })).toMatchObject({ ok: false, ma: "MOC_KHONG_DOI" });
  });
});

describe("[NHH-PER-03c0] dời SỚM (P → P' < P) — như đặt lần đầu cho P' (gồm cổng manifest)", () => {
  it("đối chứng dương: P' ở tương lai, sạch ⇒ được", () => {
    expect(q({ cu: "2027-01", moi: "2026-12" })).toEqual({ ok: true, hanhDong: "DOI_SOM" });
  });

  it("TỪ CHỐI: P' không ở tương lai · có bảng kê cũ ≥ P' · thiếu manifest", () => {
    expect(q({ cu: "2026-12", moi: "2026-10" })).toMatchObject({ ok: false, ma: "MOC_KHONG_O_TUONG_LAI" });
    expect(q({ cu: "2027-01", moi: "2026-12", coBangKeTuMoi: true })).toMatchObject({ ok: false, ma: "CO_BANG_KE_CU" });
    expect(q({ cu: "2027-01", moi: "2026-12", kyApprovedThieuManifest: ["2026-09"] })).toMatchObject({ ok: false, ma: "THIEU_MANIFEST" });
  });
});

describe("[NHH-PER-03c0] dời MUỘN (P → P' > P) — CHỈ cổng dòng sổ mới trong [P, P')", () => {
  it("đối chứng dương: chưa có dòng sổ mới nào ở [P, P') ⇒ được (kể cả khi P đã ở quá khứ — chưa ghi gì thì dời được)", () => {
    expect(q({ cu: "2026-10", moi: "2026-12", thangHienTai: "2026-11" })).toEqual({ ok: true, hanhDong: "DOI_MUON" });
  });

  it("TỪ CHỐI khi đã có dòng sổ mới ở [P, P') — sẽ trả hai lần (đường cũ chốt lại được tháng mà sổ mới đã ghi)", () => {
    const r = q({ cu: "2026-10", moi: "2026-12", soDongSoMoiBiAnhHuong: 3 });
    expect(r).toMatchObject({ ok: false, ma: "CO_DONG_SO_MOI" });
    expect(!r.ok && r.lyDo).toMatch(/3 dòng/);
  });

  it("[NHH-PER-03c0] ranh giới SỐ DÒNG: đúng MỘT dòng sổ mới cũng đủ chặn dời muộn (không phải 'nhiều hơn một')", () => {
    expect(q({ cu: "2026-10", moi: "2026-12", soDongSoMoiBiAnhHuong: 1 })).toMatchObject({ ok: false, ma: "CO_DONG_SO_MOI" });
  });

  it("dời muộn KHÔNG bị cổng 'tương lai'/'manifest' của đặt lần đầu cản (đó là cổng của việc MỞ RỘNG vùng sổ mới)", () => {
    expect(q({ cu: "2026-10", moi: "2026-12", thangHienTai: "2026-11", kyApprovedThieuManifest: ["2026-08"], coBangKeTuMoi: true })).toEqual({ ok: true, hanhDong: "DOI_MUON" });
  });
});

describe("[NHH-PER-03c0] GỠ mốc (P → null)", () => {
  it("đối chứng dương: chưa có dòng sổ mới nào ⇒ gỡ được (rollback trước khi dùng — CUT-8)", () => {
    expect(q({ cu: "2026-10", moi: null })).toEqual({ ok: true, hanhDong: "GO" });
  });

  it("TỪ CHỐI khi đã có dòng sổ mới từ kỳ ≥ P (CUT-8: sau khi có dòng ⇒ chỉ tắt engine, sửa bằng điều chỉnh)", () => {
    expect(q({ cu: "2026-10", moi: null, soDongSoMoiBiAnhHuong: 1 })).toMatchObject({ ok: false, ma: "CO_DONG_SO_MOI" });
  });
});
