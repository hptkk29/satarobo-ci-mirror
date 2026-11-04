// [SNC-*] — SỬA `Lead.convertedById` LEGACY: bộ lập kế hoạch THUẦN (không DB). Tầng DB + cổng ghi: tests/finance/sua-nguoi-chot-*.test.ts.
//
// Mỗi ca dựng MỘT hiện trường tối thiểu rồi đọc đúng dòng kế hoạch của lead đó; ca nào kiểm «từ chối» đều có đối chứng dương (cùng hiện trường, thêm bằng chứng ⇒ ĐỔI được).
import { describe, expect, it } from "vitest";
import {
  chuanHoaTen,
  dongDauRaSuaNguoiChot,
  docTenSaleTuGhiChu,
  demE2,
  lapKeHoachSuaNguoiChot,
  nguoiChotMoiTheoLead,
  phanTichChinhSachE2,
  phanTichKeHoachSha,
  phanTichSoNguyen,
  quyetDinhGhiSuaNguoiChot,
  tenGoi,
  type ChinhSachE2,
  type DauVaoKeHoach,
  type DonLienQuan,
  type HangHanhDong,
  type HangLead,
  type HangLichSu,
  type HangNguoiDung,
} from "./sua-nguoi-chot";
import { dongHoanTacTuAudit } from "./sua-nguoi-chot-audit";

const T_IMPORT = new Date("2026-08-07T01:13:57.000Z");
const TRUOC_IMPORT = new Date("2026-08-05T03:00:00.000Z");
const SAU_IMPORT = new Date("2026-08-08T03:00:00.000Z");
const CS1 = "cs-1";
const CS2 = "cs-2";
const ADMIN = "u-admin";
const DAO_TAO = "u-daotao";

const nguoi = (id: string, name: string, o: Partial<HangNguoiDung> = {}): HangNguoiDung => ({
  id,
  name,
  vaiTro: ["SALES_CSM"],
  centerId: CS2,
  hoatDong: true,
  daXoa: false,
  trangThaiNhanSu: null,
  maNhanVien: null,
  ...o,
});

const NGUOI_MAC_DINH: HangNguoiDung[] = [
  nguoi(ADMIN, "Admin", { vaiTro: ["SUPER_ADMIN"], centerId: null }),
  nguoi(DAO_TAO, "Toại", { vaiTro: ["TRAINING", "TEACHER"], centerId: CS1 }),
  nguoi("u-lien", "Nguyễn Thị Liên", { centerId: CS2 }),
  nguoi("u-van", "Trần Thị Vân", { centerId: CS2 }),
  nguoi("u-dieu", "Lê Diệu", { centerId: CS1 }),
];

const ghiChu = (ten: string | null) => (ten === null ? "Ghi chú khác" : `[Import ĐK Excel] Sales: ${ten} · Nguồn: Ads`);

function lead(id: string, o: Partial<HangLead> = {}): HangLead {
  return { id, convertedById: ADMIN, assignedToId: "u-lien", centerId: CS1, note: ghiChu("Liên"), convertedAt: T_IMPORT, createdAt: new Date("2026-08-06T01:00:00.000Z"), deletedAt: null, ...o };
}
const don = (orderId: string, leadId: string, o: Partial<DonLienQuan> = {}): DonLienQuan => ({ orderId, code: `ORD-${orderId}`, centerId: CS2, leadId, duong: "NOI_DON_MOT", thuTong: 10_000_000, ky: ["2026-06"], ...o });
const lichSu = (id: string, leadId: string, changedById: string | null, luc: Date, toStatus = "DA_DANG_KY"): HangLichSu => ({ id, leadId, changedById, toStatus, luc });

function dauVao(o: Partial<DauVaoKeHoach> & { leadId?: string; actorImport?: string } = {}): DauVaoKeHoach {
  const id = o.leadId ?? "L1";
  return {
    leads: o.leads ?? [lead(id)],
    imports: o.imports ?? [{ leadId: id, actorId: o.actorImport ?? ADMIN, luc: T_IMPORT }],
    lichSu: o.lichSu ?? [],
    hanhDong: o.hanhDong ?? [],
    leadNgoaiMau: o.leadNgoaiMau ?? [],
    nguoiDung: o.nguoiDung ?? NGUOI_MAC_DINH,
    don: o.don ?? [don("o1", id)],
    khoa: o.khoa ?? { leadCoSoMoi: new Set(), leadCoDongKyDaDuyet: new Set(), kyDaDuyet: new Set() },
    quyetDinhOwner: o.quyetDinhOwner ?? [],
    leadQuyetDinh: o.leadQuyetDinh ?? [],
  };
}
/** Các ca CŨ đo luật khác (cơ sở, tên trùng, khoá…) nên mặc định ĐỔI được E2 một nguồn; ca về chính sách ở nhóm [SNC-6x] nói rõ chính sách. */
const lap = (i: DauVaoKeHoach, p: ChinhSachE2 = "DOI_MOT_NGUON") => lapKeHoachSuaNguoiChot(i, p);
const docLap = (leadId: string, nguoi: string, luc: Date, loai: HangHanhDong["loai"] = "HOAT_DONG"): HangHanhDong => ({ leadId, nguoi, luc, loai });
const dong1 = (i: DauVaoKeHoach, id = "L1", p: ChinhSachE2 = "DOI_MOT_NGUON") => lap(i, p).dong.find((d) => d.leadId === id)!;

describe("[SNC-01..] quyết định từng lead", () => {
  it("[SNC-01] E1 — Sale tự chuyển DA_DANG_KY TRƯỚC import ⇒ REASSIGN, HIGH, lớp E1", () => {
    const d = dong1(dauVao({ leads: [lead("L1", { note: null, assignedToId: null })], lichSu: [lichSu("h1", "L1", "u-van", TRUOC_IMPORT)] }));
    expect(d).toMatchObject({ loai: "REASSIGN", oldConvertedById: ADMIN, newConvertedById: "u-van", confidence: "HIGH", evidenceClass: "E1_SALE_TU_CHUYEN_TRANG_THAI", campusCheck: "MATCH" });
    expect(d.saleEvidence).toBe("LSH:u-van");
    expect(d.sourceActor).toBe(ADMIN);
  });

  it("[SNC-02] E2 — Excel «Sales: Liên» ∧ = assignedToId ∧ cùng cơ sở, CÓ bằng chứng độc lập (Liên tự có hành động trên lead TRƯỚC import) ⇒ REASSIGN, HIGH, lớp E2 ĐỘC LẬP", () => {
    const d = dong1(dauVao({ hanhDong: [docLap("L1", "u-lien", TRUOC_IMPORT)] }), "L1", "GIU_XEM_TAY");
    expect(d).toMatchObject({ loai: "REASSIGN", newConvertedById: "u-lien", evidenceClass: "E2_EXCEL_SALES_VA_BANG_CHUNG_DOC_LAP", confidence: "HIGH", campusCheck: "MATCH" });
    expect(d.saleEvidence).toBe("EXCEL:liên+DOC_LAP:HOAT_DONG");
  });

  it("[SNC-03] không có bằng chứng nào ⇒ CLEAR về NULL, mã KHONG_CO_BANG_CHUNG (fail-closed, KHÔNG đoán)", () => {
    const d = dong1(dauVao({ leads: [lead("L1", { note: null, assignedToId: "u-lien" })] }));
    expect(d).toMatchObject({ loai: "CLEAR", newConvertedById: null, reasonCode: "KHONG_CO_BANG_CHUNG", confidence: "NA" });
  });

  it("[SNC-04] đã đúng: người chốt KHÔNG phải người import mà là Sale hợp lệ ⇒ ALREADY_CORRECT, không ghi", () => {
    const i = dauVao({ leads: [lead("L1", { convertedById: "u-van" })] });
    const kh = lap(i);
    expect(kh.dong[0]).toMatchObject({ loai: "ALREADY_CORRECT", reasonCode: "NGUOI_CHOT_LA_SALE_HOP_LE", newConvertedById: "u-van" });
    expect(kh.soGhi).toBe(0);
  });

  it("[SNC-04b] người chốt khác người import NHƯNG không phải Sale hợp lệ ⇒ MANUAL_REVIEW (không ghi, không đoán)", () => {
    const d = dong1(dauVao({ leads: [lead("L1", { convertedById: DAO_TAO })] }));
    expect(d).toMatchObject({ loai: "MANUAL_REVIEW", newConvertedById: DAO_TAO });
  });

  it("[SNC-05] lead KHÔNG có dòng BACKFILL_IMPORT ⇒ không vào kế hoạch (không dòng, không BỎ QUA)", () => {
    const kh = lap({ ...dauVao(), imports: [] });
    expect(kh.dong).toEqual([]);
    expect(kh.boQua).toEqual([]);
    expect(kh.soGhi).toBe(0);
  });

  it("[SNC-05b] có BACKFILL_IMPORT nhưng KHÔNG đơn liên quan ⇒ BỎ QUA (KHONG_CO_DON_LIEN_QUAN); lead đã xoá ⇒ LEAD_DA_XOA", () => {
    const kh = lap({
      ...dauVao({ leads: [lead("L1"), lead("L2", { deletedAt: new Date("2026-09-01T00:00:00Z") })], imports: [{ leadId: "L1", actorId: ADMIN, luc: T_IMPORT }, { leadId: "L2", actorId: ADMIN, luc: T_IMPORT }], don: [don("o2", "L2")] }),
    });
    expect(kh.dong).toEqual([]);
    expect(kh.boQua).toEqual([
      { leadId: "L1", reasonCode: "KHONG_CO_DON_LIEN_QUAN" },
      { leadId: "L2", reasonCode: "LEAD_DA_XOA" },
    ]);
  });

  it("[SNC-06] người nhận KHÔNG hợp lệ ⇒ không đổi sang họ: Sale Excel đã xoá / đã nghỉ / không hoạt động ⇒ CLEAR NGUOI_BAN_DA_NGHI; đối chứng dương: hợp lệ ⇒ REASSIGN", () => {
    const ds: Array<[string, Partial<HangNguoiDung>]> = [
      ["đã xoá", { daXoa: true }],
      ["không hoạt động", { hoatDong: false }],
      ["nhân sự RESIGNED", { trangThaiNhanSu: "RESIGNED" }],
      ["nhân sự TERMINATED", { trangThaiNhanSu: "TERMINATED" }],
    ];
    for (const [ten, loi] of ds) {
      const nd = NGUOI_MAC_DINH.map((u) => (u.id === "u-lien" ? { ...u, ...loi } : u));
      expect(dong1(dauVao({ nguoiDung: nd })), ten).toMatchObject({ loai: "CLEAR", newConvertedById: null, reasonCode: "NGUOI_BAN_DA_NGHI" });
    }
    expect(dong1(dauVao())).toMatchObject({ loai: "REASSIGN" });
  });

  it("[SNC-06b] E1: người tự chuyển trạng thái không còn hợp lệ ⇒ KHÔNG tính bằng chứng (CLEAR); đối chứng dương: còn hợp lệ ⇒ REASSIGN", () => {
    const base = { leads: [lead("L1", { note: null, assignedToId: null })], lichSu: [lichSu("h1", "L1", "u-van", TRUOC_IMPORT)] };
    const nghi = NGUOI_MAC_DINH.map((u) => (u.id === "u-van" ? { ...u, trangThaiNhanSu: "RESIGNED" } : u));
    expect(dong1(dauVao({ ...base, nguoiDung: nghi }))).toMatchObject({ loai: "CLEAR", reasonCode: "KHONG_CO_BANG_CHUNG" });
    expect(dong1(dauVao(base))).toMatchObject({ loai: "REASSIGN", newConvertedById: "u-van" });
  });

  it("[SNC-07] tên trùng hai Sale hợp lệ ⇒ CLEAR TRUNG_TEN_NHAN_SU; đối chứng dương: chỉ còn một ⇒ REASSIGN", () => {
    const hai = [...NGUOI_MAC_DINH, nguoi("u-lien2", "Phạm Liên", { centerId: CS2 })];
    expect(dong1(dauVao({ nguoiDung: hai }))).toMatchObject({ loai: "CLEAR", reasonCode: "TRUNG_TEN_NHAN_SU" });
    expect(dong1(dauVao())).toMatchObject({ loai: "REASSIGN" });
  });

  it("[SNC-08] sai cơ sở: E2 một mình ⇒ CLEAR SAI_CO_SO; E1 (Sale tự bấm) là bằng chứng độc lập ⇒ vẫn REASSIGN nhưng campusCheck = MISMATCH", () => {
    const donCs1 = [don("o1", "L1", { centerId: CS1 })]; // Liên ở CS2
    expect(dong1(dauVao({ don: donCs1 }))).toMatchObject({ loai: "CLEAR", reasonCode: "SAI_CO_SO", campusCheck: "MISMATCH" });
    const e1 = dauVao({ don: donCs1, leads: [lead("L1", { note: null, assignedToId: null })], lichSu: [lichSu("h1", "L1", "u-lien", TRUOC_IMPORT)] });
    expect(dong1(e1)).toMatchObject({ loai: "REASSIGN", newConvertedById: "u-lien", campusCheck: "MISMATCH", evidenceClass: "E1_SALE_TU_CHUYEN_TRANG_THAI" });
  });

  it("[SNC-08b] không rõ cơ sở đơn (centerId null) ⇒ E2 một mình bị CLEAR KHONG_RO_CO_SO", () => {
    expect(dong1(dauVao({ don: [don("o1", "L1", { centerId: null })] }))).toMatchObject({ loai: "CLEAR", reasonCode: "KHONG_RO_CO_SO", campusCheck: "UNKNOWN" });
  });

  it("[SNC-09] Excel ghi người KHÁC người được gán (ca «My → Liên») ⇒ CLEAR EXCEL_KHAC_NGUOI_DUOC_GAN, không chọn bên nào", () => {
    const nd = [...NGUOI_MAC_DINH, nguoi("u-my", "Võ My", { centerId: CS2, hoatDong: false, daXoa: true })];
    // Excel «My» → duy nhất là tài khoản ĐÃ XOÁ ⇒ NGUOI_BAN_DA_NGHI
    expect(dong1(dauVao({ leads: [lead("L1", { note: ghiChu("My"), assignedToId: "u-lien" })], nguoiDung: nd }))).toMatchObject({ loai: "CLEAR", reasonCode: "NGUOI_BAN_DA_NGHI", newConvertedById: null });
    // Excel «Vân» (hợp lệ, duy nhất) nhưng lead đang gán Liên ⇒ khác người được gán
    expect(dong1(dauVao({ leads: [lead("L1", { note: ghiChu("Vân"), assignedToId: "u-lien" })] }))).toMatchObject({ loai: "CLEAR", reasonCode: "EXCEL_KHAC_NGUOI_DUOC_GAN" });
  });

  it("[SNC-09b] Excel không khớp nhân sự nào ⇒ CLEAR EXCEL_KHONG_KHOP_NHAN_SU; nhiều tên khác nhau trong ghi chú ⇒ CLEAR EXCEL_NHIEU_TEN_KHAC_NHAU", () => {
    expect(dong1(dauVao({ leads: [lead("L1", { note: ghiChu("Zxy") })] }))).toMatchObject({ loai: "CLEAR", reasonCode: "EXCEL_KHONG_KHOP_NHAN_SU" });
    const hai = `${ghiChu("Liên")}\n${ghiChu("Vân")}`;
    expect(dong1(dauVao({ leads: [lead("L1", { note: hai })] }))).toMatchObject({ loai: "CLEAR", reasonCode: "EXCEL_NHIEU_TEN_KHAC_NHAU" });
  });

  it("[SNC-10] E1 và E2 chỉ về HAI người khác nhau ⇒ CLEAR BANG_CHUNG_MAU_THUAN; E1 nhiều người ⇒ CLEAR E1_NHIEU_NGUOI_CHUYEN_TRANG_THAI; đồng thuận ⇒ REASSIGN lớp E1_E2", () => {
    const e1van = [lichSu("h1", "L1", "u-van", TRUOC_IMPORT)];
    expect(dong1(dauVao({ lichSu: e1van }))).toMatchObject({ loai: "CLEAR", reasonCode: "BANG_CHUNG_MAU_THUAN" });
    expect(dong1(dauVao({ lichSu: [lichSu("h1", "L1", "u-van", TRUOC_IMPORT), lichSu("h2", "L1", "u-lien", TRUOC_IMPORT)], leads: [lead("L1", { note: null })] }))).toMatchObject({ loai: "CLEAR", reasonCode: "E1_NHIEU_NGUOI_CHUYEN_TRANG_THAI" });
    expect(dong1(dauVao({ lichSu: [lichSu("h1", "L1", "u-lien", TRUOC_IMPORT)] }))).toMatchObject({ loai: "REASSIGN", newConvertedById: "u-lien", evidenceClass: "E1_E2_DONG_THUAN" });
  });

  it("[SNC-10b] E1 chỉ tính lịch sử TRƯỚC import và do người KHÁC người import; sau import / chính người import / trạng thái khác ⇒ không phải bằng chứng", () => {
    const base = { leads: [lead("L1", { note: null, assignedToId: null })] };
    for (const h of [lichSu("h1", "L1", "u-van", SAU_IMPORT), lichSu("h2", "L1", ADMIN, TRUOC_IMPORT), lichSu("h3", "L1", "u-van", TRUOC_IMPORT, "DANG_CHAM_SOC"), lichSu("h4", "L1", null, TRUOC_IMPORT), lichSu("h5", "L1", DAO_TAO, TRUOC_IMPORT)]) {
      expect(dong1(dauVao({ ...base, lichSu: [h] })), h.id).toMatchObject({ loai: "CLEAR", reasonCode: "KHONG_CO_BANG_CHUNG" });
    }
  });

  it("[SNC-11] ca «Toại»: người import được Excel gọi tên là Sale ∧ là người được gán ⇒ ALREADY_CORRECT (MEDIUM), KHÔNG xoá", () => {
    const i = dauVao({ leads: [lead("L1", { convertedById: DAO_TAO, assignedToId: DAO_TAO, note: ghiChu("Toại") })], actorImport: DAO_TAO });
    expect(dong1(i)).toMatchObject({ loai: "ALREADY_CORRECT", reasonCode: "EXCEL_SALES_TRUNG_NGUOI_CHOT", confidence: "MEDIUM", newConvertedById: DAO_TAO });
    // đối chứng: đổi tên Excel khác ⇒ không còn «trùng» ⇒ xoá
    const khac = dauVao({ leads: [lead("L1", { convertedById: DAO_TAO, assignedToId: DAO_TAO, note: ghiChu("Vân") })], actorImport: DAO_TAO });
    expect(dong1(khac).loai).not.toBe("ALREADY_CORRECT");
  });

  it("[SNC-12] người chốt đang NULL ⇒ ALREADY_CORRECT (đã fail-closed); id người chốt treo ⇒ INVALID", () => {
    expect(dong1(dauVao({ leads: [lead("L1", { convertedById: null })] }))).toMatchObject({ loai: "ALREADY_CORRECT", reasonCode: "DA_BO_TRONG_FAIL_CLOSED" });
    const kh = lap(dauVao({ leads: [lead("L1", { convertedById: "u-ma" })] }));
    expect(kh.dong[0]).toMatchObject({ loai: "INVALID", reasonCode: "NGUOI_CHOT_KHONG_TON_TAI" });
    expect(kh.tom.khongHopLe).toBe(1);
  });

  it("[SNC-13] Unicode: Excel NFD «Liên» khớp User.name NFC; hoa/thường và khoảng trắng thừa", () => {
    const nfd = "Liên"; // L-i-e-◌̂-n
    expect(nfd).not.toBe("Liên");
    expect(chuanHoaTen(nfd)).toBe(chuanHoaTen("Liên"));
    expect(docTenSaleTuGhiChu(`[Import ĐK Excel] Sales:   ${nfd.toUpperCase()}  · Nguồn: Ads`)).toEqual(["liên"]);
    expect(tenGoi("  Nguyễn  Thị  LIÊN ")).toBe("liên");
    expect(dong1(dauVao({ leads: [lead("L1", { note: ghiChu(nfd) })] }))).toMatchObject({ loai: "REASSIGN", newConvertedById: "u-lien" });
  });
});

describe("[SNC-2x] khoá hoa hồng ⇒ KHÔNG ghi, chuyển xem tay", () => {
  const kho = (o: Partial<DauVaoKeHoach["khoa"]>) => ({ leadCoSoMoi: new Set<string>(), leadCoDongKyDaDuyet: new Set<string>(), kyDaDuyet: new Set<string>(), ...o });
  it.each([
    ["sổ mới có dòng", kho({ leadCoSoMoi: new Set(["L1"]) }), "SO_MOI", [don("o1", "L1")]],
    ["CommissionLine của kỳ APPROVED", kho({ leadCoDongKyDaDuyet: new Set(["L1"]) }), "DONG_KY_DA_DUYET", [don("o1", "L1")]],
    ["thu của đơn ĐÃ NỐI nằm trong kỳ APPROVED", kho({ kyDaDuyet: new Set(["2026-06"]) }), "THU_TRONG_KY_DA_DUYET", [don("o1", "L1", { duong: "DA_NOI" })]],
  ])("[SNC-20] %s ⇒ MANUAL_REVIEW COMMISSION_DA_KHOA_%s, người chốt giữ nguyên", (_t, khoa, ma, donL) => {
    const kh = lap(dauVao({ khoa, don: donL }));
    expect(kh.dong[0]).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: `COMMISSION_DA_KHOA_${ma}`, newConvertedById: ADMIN });
    expect(kh.soGhi).toBe(0);
    expect(kh.soXemTay).toBe(1);
  });

  it("[SNC-21] đối chứng dương: kỳ APPROVED mà đơn CHƯA nối (noi-don MOT) ⇒ KHÔNG khoá (đổi người chốt chưa đổi gì với đơn chưa có lead — cổng APPROVED của noi-don lo phần nối)", () => {
    const kh = lap(dauVao({ khoa: kho({ kyDaDuyet: new Set(["2026-06"]) }) }));
    expect(kh.dong[0]!.loai).toBe("REASSIGN");
  });

  it("[SNC-22] khoá cũng chặn dòng CLEAR (không chỉ REASSIGN)", () => {
    const kh = lap(dauVao({ leads: [lead("L1", { note: null })], khoa: kho({ leadCoSoMoi: new Set(["L1"]) }) }));
    expect(kh.dong[0]).toMatchObject({ loai: "MANUAL_REVIEW" });
  });

  it("[SNC-23] khoá không đụng lead đã ĐÚNG (ALREADY_CORRECT giữ nguyên, không bị đẩy xem tay)", () => {
    const kh = lap(dauVao({ leads: [lead("L1", { convertedById: "u-van" })], khoa: kho({ leadCoSoMoi: new Set(["L1"]) }) }));
    expect(kh.dong[0]!.loai).toBe("ALREADY_CORRECT");
  });
});

describe("[SNC-3x] tất định · idempotent · chữ ký phủ phân loại", () => {
  function nhieuLead(): DauVaoKeHoach {
    const ids = ["L3", "L1", "L2", "L4"];
    return {
      leads: [lead("L1"), lead("L2", { note: null }), lead("L3", { convertedById: "u-van" }), lead("L4", { note: ghiChu("Vân"), assignedToId: "u-van" })],
      imports: ids.map((id) => ({ leadId: id, actorId: ADMIN, luc: T_IMPORT })),
      lichSu: [],
      hanhDong: [],
      leadNgoaiMau: [],
      nguoiDung: NGUOI_MAC_DINH,
      don: ids.map((id) => don(`o-${id}`, id)),
      khoa: { leadCoSoMoi: new Set(), leadCoDongKyDaDuyet: new Set(), kyDaDuyet: new Set() },
      quyetDinhOwner: [],
      leadQuyetDinh: [],
    };
  }

  it("[SNC-30] digest TẤT ĐỊNH: xáo thứ tự mọi mảng đầu vào ⇒ cùng sha và cùng dòng ký", () => {
    const a = lap(nhieuLead());
    const i = nhieuLead();
    const b = lap({
      ...i,
      leads: [...i.leads].reverse(),
      imports: [...i.imports].reverse(),
      nguoiDung: [...i.nguoiDung].reverse(),
      don: [...i.don].reverse(),
    });
    expect(b.sha).toBe(a.sha);
    expect(b.dongDauRa).toEqual(a.dongDauRa);
    expect(a.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[SNC-31] sha ĐỔI khi một dòng đổi phân loại (kể cả dòng KHÔNG ghi) — và dòng PLAN mang sha + số đếm nên chữ ký phủ cả phần xem tay", () => {
    const a = lap(nhieuLead());
    const i = nhieuLead();
    const doi = lap({ ...i, leads: i.leads.map((l) => (l.id === "L3" ? { ...l, convertedById: ADMIN } : l)) }); // L3: ALREADY → ghi
    expect(doi.sha).not.toBe(a.sha);
    const plan = a.dongDauRa[0]!;
    expect(plan).toBe(`sua-nguoi-chot/v1|PLAN|${a.sha}|scope=4|write=${a.soGhi}|review=${a.soXemTay}|invalid=0|e2=DOI_MOT_NGUON`);
    // L1 từ «ghi» thành «xem tay»: số `write`/`review` trong dòng PLAN đổi, dù dòng xem tay KHÔNG nằm trong dòng ký
    const khoaMoi = { leadCoSoMoi: new Set(["L1"]), leadCoDongKyDaDuyet: new Set<string>(), kyDaDuyet: new Set<string>() };
    const khac = lap({ ...i, khoa: khoaMoi });
    expect(khac.dongDauRa[0]).not.toBe(plan);
  });

  it("[SNC-31b] sha phủ cả dòng KHÔNG ghi: đổi MỘT dòng ALREADY_CORRECT (không đổi số đếm, không đổi dòng GHI) vẫn làm sha và dòng PLAN đổi", () => {
    const a = lap(nhieuLead());
    const i = nhieuLead();
    const b = lap({ ...i, leads: i.leads.map((l) => (l.id === "L3" ? { ...l, convertedById: "u-lien" } : l)) }); // L3 vẫn ALREADY_CORRECT, người chốt khác
    expect(b.dong.find((d) => d.leadId === "L3")!.loai).toBe("ALREADY_CORRECT");
    expect(b.soGhi).toBe(a.soGhi);
    expect(b.soXemTay).toBe(a.soXemTay);
    expect(b.dongDauRa.slice(1)).toEqual(a.dongDauRa.slice(1)); // dòng GHI y hệt
    expect(b.sha).not.toBe(a.sha);
    expect(b.dongDauRa[0]).not.toBe(a.dongDauRa[0]);
  });

  it("[SNC-32] dòng ký = PLAN + ĐÚNG các dòng GHI, sắp theo leadId; mỗi dòng đủ 11 trường, không `|` thừa, không PII", () => {
    const kh = lap(nhieuLead());
    expect(kh.dongDauRa.length).toBe(1 + kh.soGhi);
    const ghi = kh.dongDauRa.slice(1);
    const idLead = ghi.map((d) => d.split("|")[2]!);
    expect([...idLead].sort()).toEqual(idLead);
    for (const d of ghi) {
      const t = d.split("|");
      expect(t).toHaveLength(11);
      expect(t[0]).toBe("sua-nguoi-chot/v1");
      expect(["REASSIGN", "CLEAR"]).toContain(t[1]);
    }
    expect(dongDauRaSuaNguoiChot(kh.dong, kh.sha, kh.chinhSachE2)).toEqual(kh.dongDauRa);
  });

  it("[SNC-33] IDEMPOTENT: áp kế hoạch vào dữ liệu rồi lập lại ⇒ 0 dòng GHI, mọi dòng ghi cũ thành ALREADY_CORRECT", () => {
    const i = nhieuLead();
    const kh = lap(i);
    expect(kh.soGhi).toBeGreaterThan(0);
    const moi = nguoiChotMoiTheoLead(kh.dong);
    const sau = lap({ ...i, leads: i.leads.map((l) => (moi.has(l.id) ? { ...l, convertedById: moi.get(l.id) ?? null } : l)) });
    expect(sau.soGhi).toBe(0);
    expect(sau.tom.seDoi).toBe(0);
    expect(sau.tom.seXoaVeXemTay).toBe(0);
    for (const d of kh.dong.filter((x) => x.loai === "REASSIGN" || x.loai === "CLEAR")) {
      expect(sau.dong.find((x) => x.leadId === d.leadId)!.loai).toBe("ALREADY_CORRECT");
    }
  });

  it("[SNC-34] tóm tắt khớp dòng: tổng phạm vi = đã đúng + đổi + xoá + xem tay + hỏng", () => {
    const t = lap(nhieuLead()).tom;
    expect(t.tongPhamVi).toBe(t.daDung + t.seDoi + t.seXoaVeXemTay + t.xemTay + t.khongHopLe);
  });
});

describe("[SNC-4x] cổng ghi — số đếm · sha · kết nối", () => {
  const kh = lap({ ...dauVao(), imports: [{ leadId: "L1", actorId: ADMIN, luc: T_IMPORT }] });
  const ok = { soDuyet: kh.soGhi, soDuyetXemTay: kh.soXemTay, keHoachSha: kh.sha, kh, ghiDuoc: true as boolean | null };
  it("[SNC-40] đủ ba số và khớp ⇒ ok", () => {
    expect(quyetDinhGhiSuaNguoiChot(ok)).toEqual({ ok: true });
  });
  it.each([
    ["thiếu --expect", { soDuyet: null }, "--expect="],
    ["--expect lệch", { soDuyet: kh.soGhi + 1 }, "≠ số đã duyệt"],
    ["thiếu --expect-review", { soDuyetXemTay: null }, "--expect-review="],
    ["--expect-review lệch", { soDuyetXemTay: kh.soXemTay + 1 }, "XEM TAY"],
    ["thiếu --ke-hoach-sha", { keHoachSha: null }, "--ke-hoach-sha="],
    ["sha sai khuôn", { keHoachSha: "abc" }, "--ke-hoach-sha="],
    ["sha lệch", { keHoachSha: "0".repeat(64) }, "sha của kế hoạch"],
    ["kết nối chỉ đọc", { ghiDuoc: false }, "chỉ đọc"],
  ])("[SNC-41] %s ⇒ từ chối", (_t, ghi, mau) => {
    const r = quyetDinhGhiSuaNguoiChot({ ...ok, ...ghi });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.loi).toContain(mau);
  });
  it("[SNC-42] kế hoạch có INVALID ⇒ từ chối dù ba số khớp", () => {
    const hong = lap(dauVao({ leads: [lead("L1", { convertedById: "u-ma" })] }));
    const r = quyetDinhGhiSuaNguoiChot({ soDuyet: hong.soGhi, soDuyetXemTay: hong.soXemTay, keHoachSha: hong.sha, kh: hong, ghiDuoc: true });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.loi).toContain("INVALID");
  });
  it("[SNC-43] phân tích tham số: chỉ chữ số thập phân thuần; sha 64 hex thường", () => {
    expect(phanTichSoNguyen(["--expect=12"], "expect")).toBe(12);
    expect(phanTichSoNguyen([], "expect")).toBeNull();
    for (const x of ["--expect=", "--expect=0x2", "--expect=1e1", "--expect= 2", "--expect=-1"]) expect(Number.isNaN(phanTichSoNguyen([x], "expect"))).toBe(true);
    expect(phanTichSoNguyen(["--expect-review=3"], "expect")).toBeNull(); // không nhầm tiền tố
    expect(phanTichKeHoachSha([`--ke-hoach-sha=${"A".repeat(64)}`])).toBe("a".repeat(64));
    expect(phanTichKeHoachSha(["--ke-hoach-sha=zz"])).toBe("");
    expect(phanTichKeHoachSha([])).toBeNull();
  });
});

describe("[SNC-5x] hoàn tác từ audit (chỉ dựng dòng)", () => {
  it("[SNC-50] dựng dòng ngược từ audit mức lead; bản ghi hỏng/không đúng mã lý do bị đếm vào `hong`, không đoán", () => {
    const r = dongHoanTacTuAudit([
      { entityId: "L2", oldValues: { convertedById: ADMIN }, newValues: { convertedById: "u-van", reasonCode: "LEGACY_BACKFILL_CONVERTER_FIX" } },
      { entityId: "L1", oldValues: { convertedById: DAO_TAO }, newValues: { convertedById: null, reasonCode: "LEGACY_BACKFILL_CONVERTER_FIX" } },
      { entityId: "L9", oldValues: null, newValues: { convertedById: "x", reasonCode: "LEGACY_BACKFILL_CONVERTER_FIX" } },
      { entityId: "L8", oldValues: { convertedById: "a" }, newValues: { convertedById: "b", reasonCode: "KHAC" } },
      { entityId: "L7", oldValues: { convertedById: 5 }, newValues: { convertedById: "b", reasonCode: "LEGACY_BACKFILL_CONVERTER_FIX" } },
    ]);
    expect(r.dong).toEqual([
      { leadId: "L1", hienTaiMongDoi: null, hoanVe: DAO_TAO },
      { leadId: "L2", hienTaiMongDoi: "u-van", hoanVe: ADMIN },
    ]);
    expect(r.hong).toBe(3);
  });
});

describe("[SNC-6x] E2 một nguồn · chính sách · ngoài mẫu · CLEAR giữ được `convertedAt`", () => {
  const E2_CHUA_DOC_LAP = () => dauVao(); // lead mặc định: Excel «Liên» = người được gán, KHÔNG hành động độc lập nào

  it("[SNC-60] E2 MỘT NGUỒN (Excel «Sales» và assignedToId cùng gốc, không bằng chứng độc lập) + chính sách mặc định ⇒ CLEAR (hold), KHÔNG HIGH; ứng viên vẫn hiện để người xem", () => {
    const d = dong1(E2_CHUA_DOC_LAP(), "L1", "GIU_XEM_TAY");
    expect(d).toMatchObject({ loai: "CLEAR", newConvertedById: null, reasonCode: "E2_MOT_NGUON_CHO_DOI_CHIEU", evidenceClass: "E2_MOT_NGUON", confidence: "NA" });
    expect(d.saleEvidence).toBe("EXCEL:liên;UNG_VIEN:u-lien");
    const t = lap(E2_CHUA_DOC_LAP(), "GIU_XEM_TAY").tom;
    expect(t).toMatchObject({ e2Tong: 1, e2DocLap: 0, e2MotNguon: 1, e2MoHo: 0 });
  });

  it("[SNC-61] bằng chứng độc lập: mỗi loại dấu vết (hoạt động · audit · gán lịch sử · gán nhật ký) của CHÍNH người đó TRƯỚC import ⇒ HIGH; sau import / của người khác / lúc import ⇒ KHÔNG tính", () => {
    for (const loai of ["HOAT_DONG", "AUDIT", "GAN_LICH_SU", "GAN_NHAT_KY"] as const) {
      const d = dong1(dauVao({ hanhDong: [docLap("L1", "u-lien", TRUOC_IMPORT, loai)] }), "L1", "GIU_XEM_TAY");
      expect(d, loai).toMatchObject({ loai: "REASSIGN", newConvertedById: "u-lien", confidence: "HIGH", evidenceClass: "E2_EXCEL_SALES_VA_BANG_CHUNG_DOC_LAP" });
      expect(d.saleEvidence, loai).toContain(`DOC_LAP:${loai}`);
    }
    // đúng tại mốc import: tính (<=)
    expect(dong1(dauVao({ hanhDong: [docLap("L1", "u-lien", T_IMPORT)] }), "L1", "GIU_XEM_TAY").loai).toBe("REASSIGN");
    for (const h of [docLap("L1", "u-lien", SAU_IMPORT), docLap("L1", "u-van", TRUOC_IMPORT), docLap("L1", ADMIN, TRUOC_IMPORT), docLap("L2", "u-lien", TRUOC_IMPORT)]) {
      expect(dong1(dauVao({ hanhDong: [h] }), "L1", "GIU_XEM_TAY"), JSON.stringify(h)).toMatchObject({ loai: "CLEAR", reasonCode: "E2_MOT_NGUON_CHO_DOI_CHIEU" });
    }
  });

  it("[SNC-62] chính sách DOI_MOT_NGUON ⇒ REASSIGN nhưng confidence = MEDIUM (không HIGH); chính sách đi vào dòng PLAN và vào sha", () => {
    const giu = lap(E2_CHUA_DOC_LAP(), "GIU_XEM_TAY");
    const doi = lap(E2_CHUA_DOC_LAP(), "DOI_MOT_NGUON");
    expect(doi.dong[0]).toMatchObject({ loai: "REASSIGN", newConvertedById: "u-lien", confidence: "MEDIUM", evidenceClass: "E2_MOT_NGUON" });
    expect(giu.dongDauRa[0]).toMatch(/\|e2=GIU_XEM_TAY$/);
    expect(doi.dongDauRa[0]).toMatch(/\|e2=DOI_MOT_NGUON$/);
    expect(doi.sha).not.toBe(giu.sha);
    expect(doi.dongDauRa).not.toEqual(giu.dongDauRa); // artifact ký cho chính sách này không dùng được cho chính sách kia
  });

  it("[SNC-63] E1 vẫn là bằng chứng độc lập HIGH bất kể chính sách E2; E2 KHÔNG đủ (Excel khác người gán / sai cơ sở) thuộc `e2MoHo`", () => {
    const e1 = dauVao({ leads: [lead("L1", { note: null, assignedToId: null })], lichSu: [lichSu("h1", "L1", "u-van", TRUOC_IMPORT)] });
    expect(dong1(e1, "L1", "GIU_XEM_TAY")).toMatchObject({ loai: "REASSIGN", confidence: "HIGH", evidenceClass: "E1_SALE_TU_CHUYEN_TRANG_THAI" });
    expect(lap(e1, "GIU_XEM_TAY").tom).toMatchObject({ e2Tong: 0 });
    const khacGan = lap(dauVao({ leads: [lead("L1", { note: ghiChu("Vân"), assignedToId: "u-lien" })] }), "GIU_XEM_TAY").tom;
    expect(khacGan).toMatchObject({ e2Tong: 1, e2DocLap: 0, e2MotNguon: 0, e2MoHo: 1 });
    const saiCoSo = lap(dauVao({ don: [don("o1", "L1", { centerId: CS1 })], hanhDong: [docLap("L1", "u-lien", TRUOC_IMPORT)] }), "GIU_XEM_TAY");
    expect(saiCoSo.dong[0]).toMatchObject({ loai: "CLEAR", reasonCode: "SAI_CO_SO", evidenceClass: "E2_SAI_CO_SO" }); // độc lập nhưng SAI CƠ SỞ vẫn bị giữ
    expect(saiCoSo.tom.e2MoHo).toBe(1);
  });

  it("[SNC-64] `demE2`: chỉ đếm dòng KHÔNG phải ALREADY_CORRECT, theo LỚP bằng chứng; ca «Toại» không vào E2", () => {
    const toai = dauVao({ leads: [lead("L1", { convertedById: DAO_TAO, assignedToId: DAO_TAO, note: ghiChu("Toại") })], actorImport: DAO_TAO });
    expect(demE2(lap(toai, "GIU_XEM_TAY").dong)).toEqual({ e2Tong: 0, e2DocLap: 0, e2MotNguon: 0, e2MoHo: 0 });
  });

  it("[SNC-65] chính sách ngoài danh sách ⇒ ném (không rơi về mặc định); phân tích tham số: không truyền = giu, giá trị lạ = null", () => {
    expect(() => lapKeHoachSuaNguoiChot(dauVao(), "TUY_TIEN" as ChinhSachE2)).toThrow(/chinhSachE2/);
    expect(phanTichChinhSachE2([])).toBe("GIU_XEM_TAY");
    expect(phanTichChinhSachE2(["--e2-mot-nguon=giu"])).toBe("GIU_XEM_TAY");
    expect(phanTichChinhSachE2(["--e2-mot-nguon=doi"])).toBe("DOI_MOT_NGUON");
    for (const x of ["--e2-mot-nguon=", "--e2-mot-nguon=DOI", "--e2-mot-nguon=true", "--e2-mot-nguon=doi "]) expect(phanTichChinhSachE2([x]), x).toBeNull();
  });

  it("[SNC-66] NGOÀI MẪU: lead KHÔNG qua BACKFILL_IMPORT mà do tài khoản người-chạy-import chốt, có đơn ⇒ MANUAL_REVIEW (không ghi); không đơn ⇒ BỎ QUA; người chốt không phải người import / lead có import row / lead đã xoá ⇒ không phải ngoài mẫu", () => {
    const ngoai = (id: string, o: Partial<HangLead> = {}) => lead(id, { convertedById: ADMIN, ...o });
    const i = dauVao({
      leadNgoaiMau: [ngoai("N1"), ngoai("N2"), ngoai("N3", { convertedById: "u-van" }), ngoai("L1"), ngoai("N5", { deletedAt: new Date("2026-09-01T00:00:00Z") })],
      don: [don("o1", "L1"), don("on1", "N1"), don("on3", "N3"), don("on5", "N5")],
    });
    const kh = lap(i, "GIU_XEM_TAY");
    const n1 = kh.dong.find((d) => d.leadId === "N1")!;
    expect(n1).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: "NGOAI_MAU_NGUOI_CHOT_LA_TAI_KHOAN_IMPORT", newConvertedById: ADMIN, evidenceClass: "KHONG_QUA_BACKFILL_IMPORT" });
    expect(kh.dong.filter((d) => d.leadId.startsWith("N")).map((d) => d.leadId)).toEqual(["N1"]);
    expect(kh.dong.filter((d) => d.leadId === "L1")).toHaveLength(1); // L1 có import row: chỉ một dòng, không nhân đôi
    expect(kh.boQua).toContainEqual({ leadId: "N2", reasonCode: "KHONG_CO_DON_LIEN_QUAN" });
    expect(kh.tom.ngoaiMau).toBe(1);
    expect(kh.soGhi).toBe(1); // chỉ L1; N1 KHÔNG bao giờ vào dòng GHI
    expect(kh.dongDauRa.some((d) => d.includes("|N1|"))).toBe(false);
  });

  it("[SNC-67] CLEAR chỉ ghi được khi `convertedAt` còn (đó là tín hiệu «người chốt chưa xác định» mà guard Sale-phụ-trách-PH dựa vào); thiếu ⇒ MANUAL_REVIEW; REASSIGN không đòi", () => {
    const khongBang = dauVao({ leads: [lead("L1", { note: null, convertedAt: null })] });
    expect(dong1(khongBang)).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: "CLEAR_KHONG_GIU_DUOC_VI_CONVERTEDAT_NULL", newConvertedById: ADMIN });
    expect(lap(khongBang).soGhi).toBe(0);
    // đối chứng dương: có convertedAt ⇒ CLEAR; REASSIGN không bị đòi
    expect(dong1(dauVao({ leads: [lead("L1", { note: null })] })).loai).toBe("CLEAR");
    expect(dong1(dauVao({ leads: [lead("L1", { convertedAt: null })], hanhDong: [docLap("L1", "u-lien", TRUOC_IMPORT)] }), "L1", "GIU_XEM_TAY").loai).toBe("REASSIGN");
  });
});
