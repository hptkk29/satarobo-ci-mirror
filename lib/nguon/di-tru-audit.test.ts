// [DTA-*] — nội dung hai bản ghi AuditLog của lệnh GHI backfill quy nguồn (bắt đầu + kết thúc). THUẦN: không DB, không đồng hồ (`batDauLuc` do nơi gọi truyền).
//
// Vì sao cần (§20, vòng UAT cuối): audit `DI_TRU_NGUON` chỉ có `soDuyet`/`nguonChay`. Còn thiếu: lượt chạy BẮT ĐẦU lúc nào, đây là APPLY hay dry-run, số kỳ vọng (`--expect`) và số THỰC GHI.
// Số thực ghi chỉ biết SAU vòng lô, mà bản ghi đầu nằm trong lô đầu (không có chuyện đã ghi mà thiếu dấu vết) ⇒ cần bản ghi THỨ HAI, action riêng, ghi sau vòng lô.
//
//   [DTA-01] bắt đầu: luotChay đủ {cheDo APPLY, dryRun false, batDauLuc ISO, expectedCount, expectedReviewCount}; khoá cũ (soDuyet…) giữ nguyên
//   [DTA-02] kết thúc HOAN_TAT: actualCount = số GHI THẬT của lượt này (không phải kế hoạch); khop phản ánh ghi+đã có+đã xoá = expectedCount
//   [DTA-03] kết thúc DUNG_GIUA_CHUNG: mang nguyên nhân (đã che) + số lô đã commit; khop = false
//   [DTA-04] nguonChay luôn đủ BỐN khoá, ở cả hai bản ghi (chạy lại không mất dấu ai bấm)
//   [DTA-05] batDauLuc không hợp lệ ⇒ ném TRƯỚC khi dựng (lượt ghi không bao giờ mang mốc rác)
//   [DTA-06] hai hằng action khác nhau (đếm "lượt có ghi" theo action không lẫn với bản ghi kết thúc)
import { describe, expect, it } from "vitest";

import { HANH_DONG_DI_TRU_BAT_DAU, HANH_DONG_DI_TRU_KET_THUC, dungKetThucDiTru, dungLuotChayDiTru } from "./di-tru-audit";

const BAT_DAU = new Date("2026-10-12T01:02:03.456Z");
const CHAY_LAI = { actor: "nguoi-dispatch", triggeringActor: "nguoi-chay-lai", runId: "9001", runAttempt: "2" } as const;

const luot = () => dungLuotChayDiTru({ batDauLuc: BAT_DAU, soDuyet: 40, soDuyetReview: 3, nguonChay: CHAY_LAI });

describe("[DTA] audit lượt chạy backfill quy nguồn", () => {
  it("[DTA-01] bắt đầu: luotChay đủ năm trường, batDauLuc là ISO của mốc truyền vào", () => {
    expect(luot()).toEqual({
      cheDo: "APPLY",
      dryRun: false,
      batDauLuc: "2026-10-12T01:02:03.456Z",
      expectedCount: 40,
      expectedReviewCount: 3,
    });
  });

  it("[DTA-02] kết thúc HOAN_TAT: actualCount là số GHI THẬT; khop = (ghi + đã có + đã xoá) bằng expectedCount", () => {
    const kt = dungKetThucDiTru({ luot: luot(), nguonChay: CHAY_LAI, trangThai: "HOAN_TAT", ghi: 38, daCo: 1, daXoa: 1, soLo: 2, soLoKeHoach: 2, nguyenNhan: null });
    expect(kt).toMatchObject({
      trangThai: "HOAN_TAT",
      luotChay: { cheDo: "APPLY", dryRun: false, batDauLuc: "2026-10-12T01:02:03.456Z", expectedCount: 40 },
      actualCount: 38,
      daCo: 1,
      daXoa: 1,
      soLo: 2,
      soLoKeHoach: 2,
      khop: true,
    });
    // lệch: kế hoạch 40 mà phân loại chỉ ra 39 dòng ⇒ khop = false (script in cảnh báo cùng phép so)
    expect(dungKetThucDiTru({ luot: luot(), nguonChay: CHAY_LAI, trangThai: "HOAN_TAT", ghi: 37, daCo: 1, daXoa: 1, soLo: 2, soLoKeHoach: 2, nguyenNhan: null }).khop).toBe(false);
  });

  it("[DTA-03] kết thúc DUNG_GIUA_CHUNG: nguyên nhân + số lô đã commit đi cùng, khop = false", () => {
    const kt = dungKetThucDiTru({ luot: luot(), nguonChay: CHAY_LAI, trangThai: "DUNG_GIUA_CHUNG", ghi: 3, daCo: 0, daXoa: 0, soLo: 1, soLoKeHoach: 3, nguyenNhan: "khoá ngoại" });
    expect(kt).toMatchObject({ trangThai: "DUNG_GIUA_CHUNG", actualCount: 3, soLo: 1, soLoKeHoach: 3, nguyenNhan: "khoá ngoại", khop: false });
  });

  it("[DTA-04] nguonChay đủ bốn khoá ở cả hai bản ghi; chạy lại giữ cả người dispatch lẫn người bấm + lần chạy", () => {
    const kt = dungKetThucDiTru({ luot: luot(), nguonChay: CHAY_LAI, trangThai: "HOAN_TAT", ghi: 40, daCo: 0, daXoa: 0, soLo: 1, soLoKeHoach: 1, nguyenNhan: null });
    expect(kt.nguonChay).toEqual(CHAY_LAI);
    expect(Object.keys(kt.nguonChay as object).sort()).toEqual(["actor", "runAttempt", "runId", "triggeringActor"]);
    // ngoài Actions: bốn null vẫn có mặt (không vắng khoá)
    const ngoai = dungKetThucDiTru({ luot: luot(), nguonChay: { actor: null, triggeringActor: null, runId: null, runAttempt: null }, trangThai: "HOAN_TAT", ghi: 0, daCo: 0, daXoa: 0, soLo: 0, soLoKeHoach: 0, nguyenNhan: null });
    expect(ngoai.nguonChay).toEqual({ actor: null, triggeringActor: null, runId: null, runAttempt: null });
  });

  it("[DTA-05] batDauLuc không hợp lệ ⇒ ném (không bao giờ ghi audit mang mốc rác)", () => {
    expect(() => dungLuotChayDiTru({ batDauLuc: new Date("khong-phai-ngay"), soDuyet: 1, soDuyetReview: 0, nguonChay: CHAY_LAI })).toThrow(/batDauLuc/);
  });

  it("[DTA-06] hai action khác nhau", () => {
    expect(HANH_DONG_DI_TRU_BAT_DAU).toBe("DI_TRU_NGUON");
    expect(HANH_DONG_DI_TRU_KET_THUC).toBe("DI_TRU_NGUON_KET_THUC");
  });
});
