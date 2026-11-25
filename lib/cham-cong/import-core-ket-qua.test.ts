// [TKQ-*] — `tomKetQuaNhap`: kết quả của service ghi ô → bộ đếm màn nhập file (T04).
// Màn nhập file hiển thị các con số này; trước T04 chúng được đếm rải rác trong vòng lặp ghi, nay dồn về MỘT hàm thuần.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} })); // lõi nhập file kéo theo service ghi ô; hàm đang test không chạm DB

import { tomKetQuaNhap, type ApplyResult } from "@/lib/cham-cong/import-core";
import type { KetQuaO } from "@/lib/cham-cong/ghi-o";

const NGAY = new Date(Date.UTC(2026, 9, 12));
const O = (ket: KetQuaO["ket"], extra: Partial<KetQuaO> = {}): KetQuaO => ({
  userId: "u1",
  workDate: NGAY,
  ket,
  truoc: null,
  sau: null,
  canhBao: [],
  ...extra,
});
const DONG = { displayName: "An", ngayTrongThang: 12, code: "CG", homeUnit: "CS1" };

const boDemMoi = (): ApplyResult["assignments"] => ({
  created: 0,
  cancelled: 0,
  unchanged: 0,
  keptManual: 0,
  skippedNoMapping: 0,
  skippedNoPermission: 0,
  unknownCode: 0,
  skippedKyDaChot: 0,
  skippedCoSoLa: 0,
});

function chay(ketQua: KetQuaO[], lenh = DONG) {
  const assignments = boDemMoi();
  const changedDays: { userId: string; workDate: Date }[] = [];
  const mappedUserIds = new Set<string>();
  const warnings: string[] = [];
  tomKetQuaNhap({
    ketQua,
    lenhTheoO: new Map([["u1|2026-10-12", lenh]]),
    sheetName: "T10",
    assignments,
    changedDays,
    mappedUserIds,
    warnings,
  });
  return { assignments, changedDays, mappedUserIds, warnings };
}

describe("[TKQ] tomKetQuaNhap — mỗi kết quả của service đếm đúng một chỗ", () => {
  it("[TKQ-01] TAO ⇒ created +1, ngày bị đổi, người được tính là đã ánh xạ", () => {
    const r = chay([O("TAO")]);
    expect(r.assignments.created).toBe(1);
    expect(r.assignments.cancelled).toBe(0);
    expect(r.changedDays).toEqual([{ userId: "u1", workDate: NGAY }]);
    expect([...r.mappedUserIds]).toEqual(["u1"]);
  });

  it("[TKQ-02] THAY ⇒ huỷ ô cũ VÀ tạo ô mới (cả hai bộ đếm cùng nhích), ngày bị đổi", () => {
    const r = chay([O("THAY")]);
    expect(r.assignments.cancelled).toBe(1);
    expect(r.assignments.created).toBe(1);
    expect(r.changedDays).toHaveLength(1);
  });

  it("[TKQ-03] XOA ⇒ chỉ huỷ, KHÔNG tạo; ngày bị đổi; người KHÔNG tính là đã ánh xạ (ô trống không chứng minh gì)", () => {
    const r = chay([O("XOA")]);
    expect(r.assignments.cancelled).toBe(1);
    expect(r.assignments.created).toBe(0);
    expect(r.changedDays).toHaveLength(1);
    expect(r.mappedUserIds.size).toBe(0);
  });

  it("[TKQ-04] GIU: có ô ⇒ unchanged +1 và đã ánh xạ; không ô (trống cả hai phía) ⇒ KHÔNG đếm gì", () => {
    const co = chay([O("GIU", { sau: { id: "a", templateCode: "CG", centerId: "c1" } })]);
    expect(co.assignments.unchanged).toBe(1);
    expect(co.changedDays).toEqual([]);
    expect(co.mappedUserIds.has("u1")).toBe(true);
    const khong = chay([O("GIU")]);
    expect(khong.assignments.unchanged).toBe(0);
    expect(khong.mappedUserIds.size).toBe(0);
  });

  it("[TKQ-05] BO_QUA: mỗi lý do vào ĐÚNG bộ đếm của nó, và không bộ đếm nào khác nhích", () => {
    const dem = (lyDo: NonNullable<KetQuaO["lyDo"]>) => chay([O("BO_QUA", { lyDo })]);
    expect(dem("O_DUOC_BAO_VE").assignments.keptManual).toBe(1);
    expect(dem("KHONG_QUYEN_CO_SO_CU").assignments.skippedNoPermission).toBe(1);
    expect(dem("KHONG_QUYEN_CO_SO_MOI").assignments.skippedNoPermission).toBe(1);
    expect(dem("MA_KHONG_CO").assignments.unknownCode).toBe(1);
    expect(dem("KY_DA_CHOT").assignments.skippedKyDaChot).toBe(1);
    expect(dem("CO_SO_LA").assignments.skippedCoSoLa).toBe(1);
    // QUA_KHU không có cổng ở nhập file ⇒ không đếm gì, không ngày bị đổi.
    const qk = dem("QUA_KHU");
    expect(Object.values(qk.assignments).every((v) => v === 0)).toBe(true);
    expect(qk.changedDays).toEqual([]);
    // Mỗi lý do chỉ nhích ĐÚNG MỘT bộ đếm (tổng = 1), không làm ngày bị đổi hay người được ánh xạ.
    for (const l of ["O_DUOC_BAO_VE", "KHONG_QUYEN_CO_SO_CU", "MA_KHONG_CO", "KY_DA_CHOT", "CO_SO_LA"] as const) {
      const r = dem(l);
      expect(Object.values(r.assignments).reduce((a, b) => a + b, 0), l).toBe(1);
      expect(r.changedDays, l).toEqual([]);
      expect(r.mappedUserIds.size, l).toBe(0);
    }
  });

  it("[TKQ-06] cảnh báo: mã lạ và khối lạ có câu nêu rõ người + ngày + mã/khối; cảnh báo của resolvePlace được nối thêm", () => {
    const ma = chay([O("BO_QUA", { lyDo: "MA_KHONG_CO", canhBao: ["x"] })], { ...DONG, code: "ZZ" });
    expect(ma.warnings).toHaveLength(2);
    expect(ma.warnings[0]).toBe('T10: "An" ngày 12: x');
    expect(ma.warnings[1]).toContain('mã "ZZ" không có trong danh mục');
    const khoi = chay([O("BO_QUA", { lyDo: "CO_SO_LA" })], { ...DONG, homeUnit: "CS9" });
    expect(khoi.warnings).toHaveLength(1);
    expect(khoi.warnings[0]).toContain('khối "CS9" không ánh xạ được sang cơ sở');
    // Lý do không cần giải thích thêm thì KHÔNG phát cảnh báo.
    expect(chay([O("BO_QUA", { lyDo: "KY_DA_CHOT" })]).warnings).toEqual([]);
  });

  it("[TKQ-07] nhiều ô cộng dồn, không ghi đè nhau", () => {
    const assignments = boDemMoi();
    tomKetQuaNhap({
      ketQua: [O("TAO"), O("THAY", { userId: "u2" })],
      lenhTheoO: new Map([
        ["u1|2026-10-12", DONG],
        ["u2|2026-10-12", { ...DONG, displayName: "Bình" }],
      ]),
      sheetName: "T10",
      assignments,
      changedDays: [],
      mappedUserIds: new Set(),
      warnings: [],
    });
    expect(assignments.created).toBe(2);
    expect(assignments.cancelled).toBe(1);
  });
});
