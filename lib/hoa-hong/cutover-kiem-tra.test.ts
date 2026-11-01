// @vitest-environment node
/**
 * [CUT-P*] — PRECHECK của đặt mốc cutover: bốn điều kiện bằng chứng là MỘT PHẦN của cổng `quyetDinhDatMoc` (THUẦN).
 *
 * Luật 11/14: mỗi điều kiện có ca RIÊNG và đối chứng dương cạnh nó — một ca chỉ khẳng định «bị chặn» luôn đạt khi cổng đã hỏng thành «chặn mọi thứ»;
 * một ca chỉ khẳng định «được qua» luôn đạt khi cổng đã gỡ. Ca DB (đường thật, khoá advisory, audit) ở `tests/hoa-hong/cutover-hanh-dong.spec.ts`.
 */
import { describe, expect, it } from "vitest";

import { loaiHanhDongDatMoc, quyetDinhDatMoc, type DauVaoDatMoc } from "./cutover";
import { KHONG_DO_BANG_CHUNG, MA_CHAN_PRECHECK, cacChanPrecheck, hanhDongCanPrecheck, type BangChungDoDuoc } from "./cutover-kiem-tra";

const SACH: BangChungDoDuoc = { invalidAttribution: 0, holdNghiemTrongDuKien: 0, unexpectedDelta: 0, diTruChuaSanSang: false };
const NEN: DauVaoDatMoc = {
  cu: null,
  moi: "2026-12",
  thangHienTai: "2026-10",
  coBangKeTuMoi: false,
  kyApprovedThieuManifest: [],
  soDongSoMoiBiAnhHuong: 0,
  ...SACH,
};
const q = (o: Partial<DauVaoDatMoc>) => quyetDinhDatMoc({ ...NEN, ...o });

describe("[CUT-P01] mỗi điều kiện precheck chặn ĐÚNG mã của nó — với đối chứng dương", () => {
  it("[CUT-P01] đối chứng dương: cả bốn đạt ⇒ qua (DAT_LAN_DAU)", () => {
    expect(q({})).toEqual({ ok: true, hanhDong: "DAT_LAN_DAU" });
  });

  it.each([
    ["Invalid > 0", { invalidAttribution: 3 }, "CO_INVALID_NGUON"],
    ["hold nghiêm trọng dự kiến > 0", { holdNghiemTrongDuKien: 2 }, "CO_HOLD_DU_KIEN"],
    ["chênh ngoài dự kiến > 0", { unexpectedDelta: 1 }, "CO_CHENH_BAT_NGO"],
    ["di trú chưa sẵn sàng", { diTruChuaSanSang: true }, "DI_TRU_CHUA_SAN_SANG"],
  ] as const)("[CUT-P01] TỪ CHỐI %s — mã %s, và CHỈ điều kiện đó (ba điều kiện còn lại đạt)", (_ten, o, ma) => {
    const r = q(o);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.ma).toBe(ma);
      expect(r.lyDo.length).toBeGreaterThan(20);
    }
  });

  it("[CUT-P01] ranh giới: ĐÚNG 1 lead Invalid / 1 hàng chờ / 1 dòng chênh / 1 đồng là đủ chặn (không phải «nhiều hơn một»)", () => {
    expect(q({ invalidAttribution: 1 }).ok).toBe(false);
    expect(q({ holdNghiemTrongDuKien: 1 }).ok).toBe(false);
    expect(q({ unexpectedDelta: 1 }).ok).toBe(false);
  });

  it("[CUT-P01h] câu chặn hàng chờ nói THẬT: số đếm là MỌI hàng chờ dự kiến (kể cả mềm), không phải «nghiêm trọng» — và 0 hàng chờ thì không có câu đó", () => {
    const [chan] = cacChanPrecheck({ invalidAttribution: 0, holdNghiemTrongDuKien: 3, unexpectedDelta: 0, diTruChuaSanSang: false });
    expect(chan!.ma).toBe("CO_HOLD_DU_KIEN");
    expect(chan!.lyDo).toContain("kể cả hàng chờ mềm");
    expect(chan!.lyDo).not.toContain("nghiêm trọng");
    expect(cacChanPrecheck({ invalidAttribution: 0, holdNghiemTrongDuKien: 0, unexpectedDelta: 0, diTruChuaSanSang: false })).toEqual([]);
  });

  it("[CUT-P01] áp cho CẢ dời sớm (DOI_SOM), không riêng đặt lần đầu", () => {
    expect(q({ cu: "2027-01", moi: "2026-12" })).toEqual({ ok: true, hanhDong: "DOI_SOM" });
    expect(q({ cu: "2027-01", moi: "2026-12", unexpectedDelta: 2 })).toMatchObject({ ok: false, ma: "CO_CHENH_BAT_NGO" });
  });

  it("[CUT-P01] nhiều điều kiện cùng hỏng ⇒ cổng báo cái ĐẦU theo thứ tự cố định (Invalid → hàng chờ → chênh → di trú); danh sách đầy đủ do `cacChanPrecheck`", () => {
    const hong: BangChungDoDuoc = { invalidAttribution: 2, holdNghiemTrongDuKien: 3, unexpectedDelta: 4, diTruChuaSanSang: true };
    expect(q(hong)).toMatchObject({ ok: false, ma: "CO_INVALID_NGUON" });
    expect(cacChanPrecheck(hong).map((x) => x.ma)).toEqual(["CO_INVALID_NGUON", "CO_HOLD_DU_KIEN", "CO_CHENH_BAT_NGO", "DI_TRU_CHUA_SAN_SANG"]);
  });

  it("[CUT-P01] mỗi vấn đề chặn nói RÕ ba thứ: lý do có số · ai sửa · sửa ở đâu", () => {
    const ds = cacChanPrecheck({ invalidAttribution: 12, holdNghiemTrongDuKien: 7, unexpectedDelta: 5, diTruChuaSanSang: true }, { thieuBangQuyNguon: false, thieuDanhMuc: ["X"], noiDonNhieu: 4 });
    expect(ds).toHaveLength(4);
    for (const d of ds) {
      expect(d.aiSua.length, d.ma).toBeGreaterThan(5);
      expect(d.noiSua.length, d.ma).toBeGreaterThan(10);
    }
    expect(ds[0]!.lyDo).toContain("12");
    expect(ds[1]!.lyDo).toContain("7");
    expect(ds[2]!.lyDo).toContain("5");
    expect(ds[3]!.lyDo).toMatch(/thiếu 1 dòng danh mục/);
    expect(ds[3]!.lyDo).toMatch(/4 đơn/);
  });
});

describe("[CUT-P01b] «KHÔNG ĐO» là CHẶN — không bao giờ rơi về 0", () => {
  it("[CUT-P01b] cả bốn `null` ⇒ THIEU_BANG_CHUNG cho DAT_LAN_DAU lẫn DOI_SOM (đối chứng: cùng đầu vào, bốn số bằng 0 ⇒ qua)", () => {
    expect(q({ ...KHONG_DO_BANG_CHUNG })).toMatchObject({ ok: false, ma: "THIEU_BANG_CHUNG" });
    expect(q({ cu: "2027-01", moi: "2026-12", ...KHONG_DO_BANG_CHUNG })).toMatchObject({ ok: false, ma: "THIEU_BANG_CHUNG" });
    expect(q({})).toMatchObject({ ok: true });
  });

  it.each([
    ["invalidAttribution", { invalidAttribution: null }],
    ["holdNghiemTrongDuKien", { holdNghiemTrongDuKien: null }],
    ["unexpectedDelta", { unexpectedDelta: null }],
    ["diTruChuaSanSang", { diTruChuaSanSang: null }],
  ] as const)("[CUT-P01b] chỉ MỘT trường `%s` thiếu (ba trường kia đạt) cũng chặn", (_t, o) => {
    expect(q(o)).toMatchObject({ ok: false, ma: "THIEU_BANG_CHUNG" });
  });
});

describe("[CUT-P03] chỉ DAT_LAN_DAU và DOI_SOM đòi precheck", () => {
  const HONG: Partial<DauVaoDatMoc> = { invalidAttribution: 9, holdNghiemTrongDuKien: 9, unexpectedDelta: 9, diTruChuaSanSang: true };

  it("[CUT-P03] DOI_MUON và GO KHÔNG đòi precheck: bốn số hỏng (hoặc `null`) vẫn được — giữ nguyên cổng «không có dòng sổ mới»", () => {
    expect(q({ cu: "2026-10", moi: "2026-12", thangHienTai: "2026-11", ...HONG })).toEqual({ ok: true, hanhDong: "DOI_MUON" });
    expect(q({ cu: "2026-10", moi: null, ...HONG })).toEqual({ ok: true, hanhDong: "GO" });
    expect(q({ cu: "2026-10", moi: "2026-12", thangHienTai: "2026-11", ...KHONG_DO_BANG_CHUNG })).toEqual({ ok: true, hanhDong: "DOI_MUON" });
    expect(q({ cu: "2026-10", moi: null, ...KHONG_DO_BANG_CHUNG })).toEqual({ ok: true, hanhDong: "GO" });
  });

  it("[CUT-P03] đối chứng dương: CÙNG bốn số hỏng mà là đặt lần đầu / dời sớm ⇒ bị chặn", () => {
    expect(q({ ...HONG }).ok).toBe(false);
    expect(q({ cu: "2027-01", moi: "2026-12", ...HONG }).ok).toBe(false);
  });

  it("[CUT-P03] cổng nghiệp vụ cũ của DOI_MUON / GO vẫn chặn (precheck không thay thế chúng)", () => {
    expect(q({ cu: "2026-10", moi: "2026-12", thangHienTai: "2026-11", soDongSoMoiBiAnhHuong: 2 })).toMatchObject({ ok: false, ma: "CO_DONG_SO_MOI" });
    expect(q({ cu: "2026-10", moi: null, soDongSoMoiBiAnhHuong: 2 })).toMatchObject({ ok: false, ma: "CO_DONG_SO_MOI" });
  });
});

describe("[CUT-P04] hành động nào sẽ xảy ra — quyết TRƯỚC khi giữ khoá", () => {
  it.each([
    [null, "2026-12", "DAT_LAN_DAU"],
    ["2027-01", "2026-12", "DOI_SOM"],
    ["2026-10", "2026-12", "DOI_MUON"],
    ["2026-10", null, "GO"],
  ] as const)("[CUT-P04] %s → %s ⇒ %s", (cu, moi, hd) => {
    expect(loaiHanhDongDatMoc(cu, moi)).toBe(hd);
  });

  it("[CUT-P04] không đổi gì / sai dạng ⇒ null (cổng sẽ nói lý do); `hanhDongCanPrecheck` đúng hai hành động", () => {
    expect(loaiHanhDongDatMoc("2026-12", "2026-12")).toBeNull();
    expect(loaiHanhDongDatMoc(null, null)).toBeNull();
    expect(loaiHanhDongDatMoc(null, "2026-13")).toBeNull();
    expect((["DAT_LAN_DAU", "DOI_SOM", "DOI_MUON", "GO", null] as const).filter(hanhDongCanPrecheck)).toEqual(["DAT_LAN_DAU", "DOI_SOM"]);
  });

  it("[CUT-P04] mỗi mã chặn precheck có trong tập đóng `MA_CHAN_PRECHECK` (không mã nào được tạo ngoài tập)", () => {
    const hong: BangChungDoDuoc = { invalidAttribution: 1, holdNghiemTrongDuKien: 1, unexpectedDelta: 1, diTruChuaSanSang: true };
    for (const d of [...cacChanPrecheck(hong), ...cacChanPrecheck(KHONG_DO_BANG_CHUNG)]) expect(MA_CHAN_PRECHECK as readonly string[]).toContain(d.ma);
  });
});
