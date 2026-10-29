/**
 * [NDA-P*] — nội dung bản ghi audit MỨC LƯỢT của lệnh GHI nối đơn ↔ lead (THUẦN, không DB). Hành vi ghi vào AuditLog có ca DB [NDA-01..03] (tests/finance).
 */
import { describe, expect, it } from "vitest";
import { nguonChayTuEnv } from "./di-tru-nguon-chay";
import { dungBanGhiLuotNoiDon, HANH_DONG_NOI_DON_LUOT, khoaLuotChayNoiDon } from "./noi-don-audit";

const BAT_DAU = new Date("2026-10-15T03:00:00.000Z");
const NGUON_CHAY = { actor: "nguoi-dispatch", triggeringActor: "nguoi-bam-lai", runId: "123", runAttempt: "2" };

describe("[NDA-P] bản ghi mức lượt của nối đơn", () => {
  it("[NDA-P1] ra ĐÚNG các khoá: chế độ APPLY · dryRun false · bắt đầu · N đã duyệt · số thực nối · bỏ qua · người bấm", () => {
    const nd = dungBanGhiLuotNoiDon({ luot: { batDauLuc: BAT_DAU, nguonChay: NGUON_CHAY }, soDuyet: 5, soKeHoach: 5, daNoi: 4, boQua: 1 });
    expect(nd).toEqual({
      cheDo: "APPLY",
      dryRun: false,
      batDauLuc: "2026-10-15T03:00:00.000Z",
      expectedCount: 5,
      soKeHoach: 5,
      actualCount: 4,
      boQua: 1,
      khop: true,
      nguonChay: NGUON_CHAY,
    });
    expect(HANH_DONG_NOI_DON_LUOT).toBe("NOI_LEAD_LUOT_CHAY");
  });

  it("[NDA-P2] khop chỉ đúng khi (nối + bỏ qua) = N; lệch thì nói lệch", () => {
    const f = (daNoi: number, boQua: number) => dungBanGhiLuotNoiDon({ luot: { batDauLuc: BAT_DAU, nguonChay: NGUON_CHAY }, soDuyet: 3, soKeHoach: 3, daNoi, boQua }).khop;
    expect(f(3, 0)).toBe(true);
    expect(f(2, 1)).toBe(true);
    expect(f(2, 0)).toBe(false);
    expect(f(3, 1)).toBe(false);
  });

  it("[NDA-P3] `nguonChay` luôn ra đủ BỐN khoá (null khi ngoài Actions) và KHÔNG mang khoá lạ", () => {
    const ngoai = nguonChayTuEnv({});
    const nd = dungBanGhiLuotNoiDon({ luot: { batDauLuc: BAT_DAU, nguonChay: { ...ngoai, laKhoaLa: "x" } as typeof ngoai }, soDuyet: 1, soKeHoach: 1, daNoi: 1, boQua: 0 });
    expect(nd.nguonChay).toEqual({ actor: null, triggeringActor: null, runId: null, runAttempt: null });
  });

  it("[NDA-P4] mốc bắt đầu rác (Invalid Date / không phải Date) ⇒ NÉM, không ghi «Invalid Date» vào audit", () => {
    const f = (batDauLuc: Date) => () => dungBanGhiLuotNoiDon({ luot: { batDauLuc, nguonChay: NGUON_CHAY }, soDuyet: 1, soKeHoach: 1, daNoi: 1, boQua: 0 });
    expect(f(new Date("khong-phai-ngay"))).toThrow(/batDauLuc/);
    expect(f("2026-10-15" as unknown as Date)).toThrow(/batDauLuc/);
  });

  it("[NDA-P5] khoá thực thể theo (run id, lần chạy): Re-run là KHOÁ KHÁC; ngoài Actions có khoá cố định", () => {
    expect(khoaLuotChayNoiDon(NGUON_CHAY)).toBe("luot:123:2");
    expect(khoaLuotChayNoiDon({ ...NGUON_CHAY, runAttempt: "3" })).toBe("luot:123:3");
    expect(khoaLuotChayNoiDon(nguonChayTuEnv({}))).toBe("luot:khong-co-run:1");
  });

  it("[NDA-P6] lõi KHÔNG đọc đồng hồ: cùng đầu vào ⇒ cùng nội dung ở hai lần gọi", () => {
    const a = dungBanGhiLuotNoiDon({ luot: { batDauLuc: BAT_DAU, nguonChay: NGUON_CHAY }, soDuyet: 2, soKeHoach: 2, daNoi: 2, boQua: 0 });
    const b = dungBanGhiLuotNoiDon({ luot: { batDauLuc: BAT_DAU, nguonChay: NGUON_CHAY }, soDuyet: 2, soKeHoach: 2, daNoi: 2, boQua: 0 });
    expect(a).toEqual(b);
  });
});
