// [PT1-*] Nền Công Parttime (SR.QD.238) — phần THUẦN: tham số chính sách, Rank theo ngày, buổi vận hành,
// luật phân công + xác nhận nhận lớp. Ràng buộc DB (chỉ mục từng phần, trigger bất biến) ở
// tests/cham-cong/parttime-nen.spec.ts (Postgres thật).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { chinhSachTaiNgay, docThamSo, donGiaMain, phutTrongNgay, type BanChinhSach } from "./chinh-sach";
import { rankTaiNgay } from "./rank";
import { loaiHoatDong } from "./buoi";
import {
  canTroGiang,
  chuyenTrangThai,
  doiDangKe,
  trangThaiNhanLuc,
  TRANG_THAI_SONG,
  xacNhanConHieuLuc,
  type NghiaVu,
  laTaBatBuoc,
  yeuCauTroGiangThuan,
} from "./phan-cong";

/** Tham số SR.QD.238 đọc THẲNG từ migration — để ca test so với đúng thứ sẽ có trong DB, không với bản chép tay. */
function thamSoTrongMigration(): unknown {
  const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
  const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
  if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
  return JSON.parse(m[1]);
}

describe("[PT1-CS] tham số chính sách", () => {
  it("[PT1-CS-01] tham số SR.QD.238 trong migration đúng văn bản: 100' = 10' + 90', ca S/C/T, tối đa 2 tiết, đơn giá", () => {
    const t = docThamSo(thamSoTrongMigration());
    if (t.loai !== "SR_QD_238") throw new Error("sai loại");
    expect(t.tiet).toEqual({ chuanBiPhut: 10, dayPhut: 90, chuanPhut: 100 });
    expect(t.ca).toEqual([
      { ma: "S", tu: "07:45", den: "11:30" },
      { ma: "C", tu: "13:45", den: "17:30" },
      { ma: "T", tu: "17:15", den: "21:00" },
    ]);
    expect(t.toiDaTietMoiCa).toBe(2);
    expect([1, 2, 3, 4].map((r) => donGiaMain(t, r))).toEqual([120_000, 140_000, 160_000, 200_000]);
    expect(t.donGia).toMatchObject({ troGiang: 80_000, trucCa: 90_000, nuaCaTruc: 45_000 });
    expect(t.rankMacDinh).toBe(1);
  });

  it("[PT1-CS-02] tham số tự mâu thuẫn ⇒ NÉM (không chạy bộ tính trên số đoán)", () => {
    const goc = thamSoTrongMigration() as Record<string, unknown>;
    expect(() => docThamSo({ ...goc, tiet: { chuanBiPhut: 10, dayPhut: 90, chuanPhut: 120 } })).toThrow(/≠ tiết/);
    expect(() => docThamSo({ ...goc, donGia: { ...(goc.donGia as object), nuaCaTruc: 50_000 } })).toThrow(/nửa ca/);
    expect(() => docThamSo({ loai: "LA" })).toThrow();
  });

  const DS: BanChinhSach[] = [
    { id: "a", code: "LEGACY", hieuLucTu: "2000-01-01", hieuLucDen: "2026-10-14", thamSo: { loai: "LEGACY" } },
    { id: "b", code: "SR.QD.238", hieuLucTu: "2026-10-15", hieuLucDen: null, thamSo: docThamSo(thamSoTrongMigration()) },
  ];

  it("[PT1-CS-03] [30] ranh giới hiệu lực: 14/10 LEGACY, 15/10 SR.QD.238 — không hồi tố", () => {
    expect(chinhSachTaiNgay(DS, "2026-10-14")?.code).toBe("LEGACY");
    expect(chinhSachTaiNgay(DS, "2026-10-15")?.code).toBe("SR.QD.238");
    expect(chinhSachTaiNgay(DS, "2027-03-01")?.code).toBe("SR.QD.238");
  });

  it("[PT1-CS-04] hai bản chồng nhau ⇒ NÉM; không bản nào phủ ⇒ null", () => {
    const chong = [...DS, { ...DS[1], id: "c", code: "X", hieuLucTu: "2026-10-01" }];
    expect(() => chinhSachTaiNgay(chong, "2026-10-20")).toThrow(/Hai bản chính sách/);
    expect(chinhSachTaiNgay([DS[1]], "2026-10-01")).toBeNull();
    expect(() => chinhSachTaiNgay(DS, "15/10/2026")).toThrow();
  });

  it("[PT1-CS-05] phutTrongNgay", () => {
    expect(phutTrongNgay("07:45")).toBe(465);
    expect(phutTrongNgay("21:00")).toBe(1260);
    expect(() => phutTrongNgay("7h45")).toThrow();
  });
});

describe("[PT1-RK] Rank theo ngày hiệu lực", () => {
  it("[PT1-RK-01] không lịch sử ⇒ Rank mặc định của chính sách (Rank 1)", () => {
    expect(rankTaiNgay([], "2026-10-20", 1)).toEqual({ rank: 1, nguon: "MAC_DINH" });
  });
  it("[PT1-RK-02] đổi Rank KHÔNG làm đổi ngày đã qua", () => {
    const ls = [
      { rank: 1, hieuLucTu: "2026-10-15" },
      { rank: 2, hieuLucTu: "2026-11-01" },
    ];
    expect(rankTaiNgay(ls, "2026-10-31", 1).rank).toBe(1);
    expect(rankTaiNgay(ls, "2026-11-01", 1).rank).toBe(2);
    expect(rankTaiNgay(ls, "2026-10-14", 3)).toEqual({ rank: 3, nguon: "MAC_DINH" });
  });
  it("[PT1-RK-03] rank ngoài 1–4 ⇒ NÉM", () => {
    expect(() => rankTaiNgay([{ rank: 5, hieuLucTu: "2026-10-15" }], "2026-10-20", 1)).toThrow();
  });
});

describe("[PT1-BU] buổi vận hành", () => {
  it("[PT1-BU-01] [10] Trial luôn TRIAL (không phải tiết đứng chính); case VUOT ⇒ ADVANCE; case khác ⇒ MAKEUP", () => {
    expect(loaiHoatDong("TRIAL_SESSION", null)).toBe("TRIAL");
    expect(loaiHoatDong("MAKEUP_CASE", "VUOT")).toBe("ADVANCE");
    expect(loaiHoatDong("MAKEUP_CASE", "BU")).toBe("MAKEUP");
    expect(loaiHoatDong("MAKEUP_CASE", null)).toBe("MAKEUP");
    expect(loaiHoatDong("CLASS_SESSION", "VUOT")).toBe("REGULAR_CLASS");
  });
});

describe("[PT1-PC] phân công + xác nhận nhận lớp", () => {
  const nv: NghiaVu = {
    sourceType: "CLASS_SESSION",
    sourceId: "s1",
    centerId: "cs1",
    role: "MAIN_TEACHER",
    ngay: "2026-10-20",
    gioBatDau: "18:00",
    gioKetThuc: "19:30",
  };

  it("[PT1-PC-01] trạng thái sống khớp đúng WHERE của chỉ mục từng phần trong migration", () => {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const where = /"SessionStaffAssignment_live_main_key"[\s\S]*?IN \(([^)]*)\)/.exec(sql)?.[1] ?? "";
    const tuSql = [...where.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect([...tuSql].sort()).toEqual([...TRANG_THAI_SONG].sort());
  });

  it("[PT1-PC-02] [1][2] GV nhận ⇒ ACCEPTED; từ chối ⇒ DECLINED; trạng thái kết thúc không đi tiếp", () => {
    expect(chuyenTrangThai("WAITING_ACCEPTANCE", "ACCEPTED").ok).toBe(true);
    expect(chuyenTrangThai("WAITING_ACCEPTANCE", "DECLINED").ok).toBe(true);
    expect(chuyenTrangThai("DECLINED", "ACCEPTED").ok).toBe(false);
    expect(chuyenTrangThai("COMPLETED", "ACTIVE").ok).toBe(false);
    expect(chuyenTrangThai("PROPOSED", "ACCEPTED").ok).toBe(false);
  });

  it("[PT1-PC-03] [5] đổi lịch / vai / cơ sở / buổi là ĐÁNG KỂ; không đổi gì ⇒ rỗng", () => {
    expect(doiDangKe(nv, { ...nv })).toEqual([]);
    expect(doiDangKe(nv, { ...nv, gioBatDau: "17:30" })).toEqual(["gioBatDau"]);
    expect(doiDangKe(nv, { ...nv, role: "TEACHING_ASSISTANT", centerId: "cs2" })).toEqual(["centerId", "role"]);
  });

  it("[PT1-PC-04] [5] xác nhận của phiên bản cũ KHÔNG còn hiệu lực; từ chối không bao giờ là hiệu lực", () => {
    const xs = [{ assignmentVersion: 1, decision: "ACCEPTED" as const }];
    expect(xacNhanConHieuLuc(xs, 1)).not.toBeNull();
    expect(xacNhanConHieuLuc(xs, 2)).toBeNull();
    expect(xacNhanConHieuLuc([{ assignmentVersion: 2, decision: "DECLINED" }], 2)).toBeNull();
  });

  it("[PT1-PC-05] PL02: Sata3 ≥ 7, Sata4–7 ≥ 9 HV ⇒ TA bắt buộc; khoá khác ⇒ null (QLCS quyết, KHÔNG phải 'không cần')", () => {
    const ng = [
      { khoa: "Sata3", tuHocVien: 7 },
      { khoa: "Sata4", tuHocVien: 9 },
      { khoa: "Sata7", tuHocVien: 9 },
    ];
    expect(canTroGiang("Sata3 — Ươm Mầm Tài Năng", 7, ng)?.batBuoc).toBe(true);
    expect(canTroGiang("Sata3 — Ươm Mầm Tài Năng", 6, ng)?.batBuoc).toBe(false);
    expect(canTroGiang("SATA 4", 9, ng)?.batBuoc).toBe(true);
    expect(canTroGiang("Sata4 — Bứt Phá", 8, ng)?.batBuoc).toBe(false);
    expect(canTroGiang("Sata1", 20, ng)).toBeNull();
    expect(canTroGiang("Luyện thi RoboSim", 20, ng)).toBeNull();
  });

  it("[PT1-PC-06] [1][3][4] đủ người ⇔ mọi vai bắt buộc đã nhận; không hardcode 2 người", () => {
    const main = (daNhan: boolean, status = "WAITING_ACCEPTANCE" as const) => ({ role: "MAIN_TEACHER" as const, status, daNhan });
    const ta = (daNhan: boolean) => ({ role: "TEACHING_ASSISTANT" as const, status: "WAITING_ACCEPTANCE" as const, daNhan });
    expect(trangThaiNhanLuc([main(true)], false)).toBe("STAFFING_CONFIRMED");
    expect(trangThaiNhanLuc([main(true), ta(false)], true)).toBe("PARTIALLY_ACCEPTED");
    expect(trangThaiNhanLuc([main(true), ta(true)], true)).toBe("STAFFING_CONFIRMED");
    expect(trangThaiNhanLuc([main(true)], true)).toBe("STAFFING_DRAFT");
    expect(trangThaiNhanLuc([], false)).toBe("STAFFING_DRAFT");
    expect(trangThaiNhanLuc([main(false)], false)).toBe("WAITING_ACCEPTANCE");
    // Phân công đã bị từ chối / thay không tính là có người: không còn ai ⇒ REJECTED; còn TA mà MAIN từ chối ⇒ cần phân lại.
    expect(trangThaiNhanLuc([{ role: "MAIN_TEACHER", status: "DECLINED", daNhan: false }], false)).toBe("STAFFING_REJECTED");
    expect(trangThaiNhanLuc([{ role: "MAIN_TEACHER", status: "DECLINED", daNhan: false }, ta(true)], true)).toBe("NEEDS_REASSIGNMENT");
    // Người dạy thay từ chối (MAIN cũ đã REPLACED) ⇒ cần phân lại, KHÔNG phải "bác cả đội hình".
    expect(trangThaiNhanLuc([{ role: "MAIN_TEACHER", status: "REPLACED", daNhan: false }, { role: "MAIN_TEACHER", status: "DECLINED", daNhan: false }], false)).toBe("NEEDS_REASSIGNMENT");
    expect(trangThaiNhanLuc([main(false, "PROPOSED" as never)], false)).toBe("STAFFING_DRAFT");
  });
});

describe("[PT2-TA] yêu cầu trợ giảng — một luật cho dịch vụ ghi và màn tuần", () => {
  const nguong = [{ khoa: "Sata3", tuHocVien: 7 }, { khoa: "Sata4", tuHocVien: 9 }];
  it("[PT2-TA-01] PL02: Sata 3 từ 7 HV, Sata 4 từ 9 HV; dưới ngưỡng / khoá ngoài bảng / ngày LEGACY ⇒ OPTIONAL", () => {
    expect(yeuCauTroGiangThuan({ ghiDe: null, tenKhoa: "Sata 3", soHocVien: 7, nguong })).toBe("REQUIRED");
    expect(yeuCauTroGiangThuan({ ghiDe: null, tenKhoa: "Sata 3", soHocVien: 6, nguong })).toBe("OPTIONAL");
    expect(yeuCauTroGiangThuan({ ghiDe: null, tenKhoa: "Sata 4", soHocVien: 8, nguong })).toBe("OPTIONAL");
    expect(yeuCauTroGiangThuan({ ghiDe: null, tenKhoa: "Lập trình Robot", soHocVien: 20, nguong })).toBe("OPTIONAL");
    expect(yeuCauTroGiangThuan({ ghiDe: null, tenKhoa: "Sata 3", soHocVien: 20, nguong: null })).toBe("OPTIONAL");
  });
  it("[PT2-TA-02] QLCS ghi đè thắng PL02 theo CẢ hai chiều", () => {
    expect(yeuCauTroGiangThuan({ ghiDe: false, tenKhoa: "Sata 3", soHocVien: 12, nguong })).toBe("OVERRIDDEN_OPTIONAL");
    expect(yeuCauTroGiangThuan({ ghiDe: true, tenKhoa: "Lập trình Robot", soHocVien: 3, nguong })).toBe("OVERRIDDEN_REQUIRED");
    expect(laTaBatBuoc("OVERRIDDEN_REQUIRED") && laTaBatBuoc("REQUIRED")).toBe(true);
    expect(laTaBatBuoc("OVERRIDDEN_OPTIONAL") || laTaBatBuoc("OPTIONAL")).toBe(false);
  });
});
