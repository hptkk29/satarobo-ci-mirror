// [SNC-QD-*] — QUYẾT ĐỊNH CỦA OWNER cho 7 lead legacy (23/10/2026): bộ lập kế hoạch THUẦN (không DB). Tầng DB: tests/finance/sua-nguoi-chot-db.test.ts [SNC-DB-17..19].
//
// Mỗi ca "từ chối" đều có đối chứng dương (cùng hiện trường, sửa đúng MỘT chỗ ⇒ đổi được). Mã nhân viên trong ca là mã TEST; ca [SNC-QD-12] dùng đúng bảng
// `QUYET_DINH_OWNER_2310` + hình dạng 7 lead PROD để chứng minh kết quả mong đợi (6 đổi · 1 giữ · 0 xem tay · 0 INVALID).
import { describe, expect, it } from "vitest";
import {
  lapKeHoachSuaNguoiChot,
  nguoiChotMoiTheoLead,
  quyetDinhGhiSuaNguoiChot,
  type DauVaoKeHoach,
  type DongKeHoach,
  type DonLienQuan,
  type HangLead,
  type HangNguoiDung,
} from "./sua-nguoi-chot";
import { MA_NV_DIEU, MA_NV_VAN, QUYET_DINH_OWNER_2310, type QuyetDinhOwner } from "./sua-nguoi-chot-quyet-dinh";

const CS1 = "cs-1";
const CS2 = "cs-2";
const T_IMPORT = new Date("2026-08-07T09:07:41.000Z");
const T_CHUYEN = new Date("2026-09-03T08:18:04.000Z");

const nguoi = (id: string, name: string, o: Partial<HangNguoiDung> = {}): HangNguoiDung => ({
  id,
  name,
  vaiTro: ["SALES_CSM"],
  centerId: CS1,
  hoatDong: true,
  daXoa: false,
  trangThaiNhanSu: "ACTIVE",
  maNhanVien: null,
  ...o,
});

const ADMIN = "u-admin";
const KIET = "u-kiet";
const TOAI = "u-toai";
const DIEU = "u-dieu";
const VAN = "u-van";
const LIEN = "u-lien";
const DIEU_GV = "u-dieu-giaovien";

const NGUOI: HangNguoiDung[] = [
  nguoi(ADMIN, "Admin", { vaiTro: ["SUPER_ADMIN"], centerId: null, trangThaiNhanSu: null }),
  nguoi(KIET, "Hoàng Phan Tuấn Kiệt", { vaiTro: ["SUPER_ADMIN", "TEACHER"], centerId: CS2, maNhanVien: "TEST.KIET" }),
  nguoi(TOAI, "Phan Thành Toại", { vaiTro: ["TRAINING", "TEACHER"], centerId: CS1, maNhanVien: "TEST.TOAI" }),
  nguoi(DIEU, "Huỳnh Thị Diệu", { centerId: CS1, maNhanVien: MA_NV_DIEU }),
  nguoi(VAN, "Tô Thị Thuý Vân", { centerId: CS2, maNhanVien: MA_NV_VAN }),
  nguoi(LIEN, "Lê Thị Phương Liên", { centerId: CS2, maNhanVien: "TEST.LIEN" }),
  // Trùng tên gọi «Diệu» với Sale thật nhưng là GIÁO VIÊN, không mã nhân viên: bằng chứng rằng planner KHÔNG chọn người theo tên.
  nguoi(DIEU_GV, "Đoàn Thị Mỹ Diệu", { vaiTro: ["TEACHER"], centerId: CS1 }),
];

function lead(id: string, o: Partial<HangLead> = {}): HangLead {
  return { id, convertedById: KIET, assignedToId: null, centerId: CS2, note: null, convertedAt: T_CHUYEN, createdAt: new Date("2026-08-01T00:00:00Z"), deletedAt: null, ...o };
}
const don = (orderId: string, leadId: string, o: Partial<DonLienQuan> = {}): DonLienQuan => ({
  orderId,
  code: `ORD-${orderId}`,
  centerId: CS2,
  leadId,
  duong: "DA_NOI",
  thuTong: 5_016_000,
  ky: ["2026-10"],
  ...o,
});
const khoaRong = { leadCoSoMoi: new Set<string>(), leadCoDongKyDaDuyet: new Set<string>(), kyDaDuyet: new Set<string>() };

/** Lead «ngoài mẫu» (không BACKFILL_IMPORT) cho một quyết định. Mặc định: Kiệt chốt, CS2, Vân làm việc. */
function hienTruong(qd: readonly QuyetDinhOwner[], o: Partial<DauVaoKeHoach> & { l?: Partial<HangLead>; d?: Partial<DonLienQuan> } = {}): DauVaoKeHoach {
  const id = qd[0]?.leadId ?? "L1";
  const l = lead(id, o.l);
  return {
    leads: o.leads ?? [],
    imports: o.imports ?? [],
    lichSu: o.lichSu ?? [],
    hanhDong: o.hanhDong ?? [],
    leadNgoaiMau: o.leadNgoaiMau ?? [],
    nguoiDung: o.nguoiDung ?? NGUOI,
    don: o.don ?? [don("o1", id, o.d)],
    khoa: o.khoa ?? khoaRong,
    quyetDinhOwner: qd,
    leadQuyetDinh: o.leadQuyetDinh ?? [l],
  };
}
const lap = (i: DauVaoKeHoach) => lapKeHoachSuaNguoiChot(i, "GIU_XEM_TAY");
const dong1 = (i: DauVaoKeHoach, id: string) => lap(i).dong.find((d) => d.leadId === id)!;
const DOI_VAN: QuyetDinhOwner[] = [{ leadId: "L1", hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_NV_VAN } }];
const DOI_DIEU: QuyetDinhOwner[] = [{ leadId: "L1", hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_NV_DIEU } }];

describe("[SNC-QD-01..03] đổi sang Vân · đổi sang Diệu · giữ nguyên", () => {
  it("[SNC-QD-01] REASSIGN → Vân: lead ngoài mẫu do Kiệt chốt, người nhận giải từ MÃ NHÂN VIÊN ra đúng User.id; không còn là MANUAL_REVIEW", () => {
    const d = dong1(hienTruong(DOI_VAN), "L1");
    expect(d).toMatchObject({
      loai: "REASSIGN",
      oldConvertedById: KIET,
      newConvertedById: VAN,
      reasonCode: "OWNER_QUYET_DINH_DOI_NGUOI_CHOT",
      evidenceClass: "OWNER_QUYET_DINH",
      confidence: "OWNER",
      campusCheck: "MATCH",
    });
    expect(d.saleEvidence).toBe(`OWNER:${MA_NV_VAN};UNG_VIEN:${VAN}`);
    // đối chứng: KHÔNG có quyết định + lead nằm ở nhóm ngoài mẫu ⇒ xem tay (đúng hiện trạng trước quyết định)
    const khong = lap({ ...hienTruong([]), imports: [{ leadId: "LX", actorId: KIET, luc: T_IMPORT }], leads: [lead("LX")], don: [don("ox", "LX"), don("o1", "L1")], leadNgoaiMau: [lead("L1")] });
    expect(khong.dong.find((x) => x.leadId === "L1")).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: "NGOAI_MAU_NGUOI_CHOT_LA_TAI_KHOAN_IMPORT" });
    const co = lap({ ...hienTruong(DOI_VAN), imports: [{ leadId: "LX", actorId: KIET, luc: T_IMPORT }], leads: [lead("LX")], don: [don("ox", "LX"), don("o1", "L1")], leadNgoaiMau: [lead("L1")] });
    expect(co.dong.filter((x) => x.leadId === "L1")).toHaveLength(1); // quyết định THAY dòng ngoài mẫu, không thêm dòng thứ hai
    expect(co.dong.find((x) => x.leadId === "L1")).toMatchObject({ loai: "REASSIGN", newConvertedById: VAN });
    expect(co.tom).toMatchObject({ ngoaiMau: 0, ownerDoi: 1, ownerGiu: 0 });
  });

  it("[SNC-QD-02] REASSIGN → Diệu: (a) lead BACKFILL của Toại đang ALREADY_CORRECT (Excel gọi tên Toại) ⇒ nay đổi sang Diệu; (b) lead ngoài mẫu do Admin chốt, cơ sở CS1", () => {
    const note = "[Import ĐK Excel] Sales: Toại · Nguồn: Giới thiệu";
    const lt = lead("L1", { convertedById: TOAI, assignedToId: TOAI, centerId: CS1, note });
    const i = { ...hienTruong([], { leads: [lt], imports: [{ leadId: "L1", actorId: TOAI, luc: T_IMPORT }], don: [don("o1", "L1", { centerId: CS1 })] }) };
    // trước quyết định: ca «Toại» — đã đúng, MEDIUM, không ghi
    expect(dong1(i, "L1")).toMatchObject({ loai: "ALREADY_CORRECT", reasonCode: "EXCEL_SALES_TRUNG_NGUOI_CHOT", confidence: "MEDIUM" });
    const sau = { ...i, quyetDinhOwner: DOI_DIEU, leadQuyetDinh: [lt] };
    expect(dong1(sau, "L1")).toMatchObject({ loai: "REASSIGN", oldConvertedById: TOAI, newConvertedById: DIEU, evidenceClass: "OWNER_QUYET_DINH", confidence: "OWNER", campusCheck: "MATCH", sourceActor: TOAI });
    // (b)
    const b = dong1(hienTruong(DOI_DIEU, { l: { convertedById: ADMIN, centerId: CS1, assignedToId: DIEU }, d: { centerId: CS1 } }), "L1");
    expect(b).toMatchObject({ loai: "REASSIGN", oldConvertedById: ADMIN, newConvertedById: DIEU });
    // KHÔNG đụng assignedToId/convertedAt: dòng kế hoạch chỉ có người chốt cũ/mới; người được gán của lead (Toại) vẫn còn trong dữ liệu đầu vào, không trong dòng ghi
    expect(Object.keys(dong1(sau, "L1")).sort()).toEqual(
      ["campusCheck", "confidence", "evidenceClass", "leadId", "loai", "newConvertedById", "oldConvertedById", "reasonCode", "saleEvidence", "soDon", "sourceActor", "thuTong"].sort(),
    );
  });

  it("[SNC-QD-03] GIỮ NGUYÊN: ALREADY_CORRECT, không dòng GHI, người chốt không đổi, không xem tay — kể cả khi lead đang ở nhóm ngoài mẫu", () => {
    const qd: QuyetDinhOwner[] = [{ leadId: "L1", hanhDong: "GIU_NGUYEN" }];
    const kh = lap({ ...hienTruong(qd), imports: [{ leadId: "LX", actorId: KIET, luc: T_IMPORT }], leads: [lead("LX")], don: [don("ox", "LX"), don("o1", "L1")], leadNgoaiMau: [lead("L1")] });
    const d = kh.dong.find((x) => x.leadId === "L1")!;
    expect(d).toMatchObject({ loai: "ALREADY_CORRECT", reasonCode: "OWNER_QUYET_DINH_GIU_NGUYEN", evidenceClass: "OWNER_GIU_NGUYEN", confidence: "OWNER", oldConvertedById: KIET, newConvertedById: KIET });
    expect(kh.dong.filter((x) => x.leadId === "L1")).toHaveLength(1);
    expect(kh.tom).toMatchObject({ ownerGiu: 1, ownerDoi: 0, ngoaiMau: 0 });
    expect(kh.dongDauRa.some((r) => r.includes("|L1|"))).toBe(false); // không nằm trong dòng GHI/ký
    expect(nguoiChotMoiTheoLead(kh.dong).has("L1")).toBe(false);
    // dòng vẫn nằm trong sha (chữ ký phủ phân loại): đổi quyết định ⇒ sha đổi
    const doi = lap({ ...hienTruong(DOI_VAN), imports: [{ leadId: "LX", actorId: KIET, luc: T_IMPORT }], leads: [lead("LX")], don: [don("ox", "LX"), don("o1", "L1")], leadNgoaiMau: [lead("L1")] });
    expect(doi.sha).not.toBe(kh.sha);
  });
});

describe("[SNC-QD-04..05] người nhận phải giải ra ĐÚNG MỘT Sale hợp lệ cùng cơ sở — không thì INVALID và cổng ghi từ chối cả lượt", () => {
  const nguoiBo = (id: string) => NGUOI.filter((u) => u.id !== id);
  const thuLai = (kh: ReturnType<typeof lap>) => quyetDinhGhiSuaNguoiChot({ soDuyet: kh.soGhi, soDuyetXemTay: kh.soXemTay, keHoachSha: kh.sha, kh, ghiDuoc: true });

  const CA: Array<[string, Partial<DauVaoKeHoach> & { l?: Partial<HangLead> }, string]> = [
    ["mã nhân viên không khớp ai", { nguoiDung: nguoiBo(VAN) }, "QUYET_DINH_NGUOI_NHAN_KHONG_GIAI_QUYET_DUOC_DUY_NHAT"],
    ["mã nhân viên khớp HAI tài khoản", { nguoiDung: [...NGUOI, nguoi("u-van-2", "Tô Thị Thuý Vân (bản 2)", { centerId: CS2, maNhanVien: MA_NV_VAN })] }, "QUYET_DINH_NGUOI_NHAN_KHONG_GIAI_QUYET_DUOC_DUY_NHAT"],
    ["người nhận đã nghỉ (RESIGNED)", { nguoiDung: NGUOI.map((u) => (u.id === VAN ? { ...u, trangThaiNhanSu: "RESIGNED" } : u)) }, "QUYET_DINH_NGUOI_NHAN_KHONG_PHAI_SALE_HOP_LE"],
    ["người nhận không còn hoạt động", { nguoiDung: NGUOI.map((u) => (u.id === VAN ? { ...u, hoatDong: false } : u)) }, "QUYET_DINH_NGUOI_NHAN_KHONG_PHAI_SALE_HOP_LE"],
    ["người nhận không phải Sale (vai TEACHER)", { nguoiDung: NGUOI.map((u) => (u.id === VAN ? { ...u, vaiTro: ["TEACHER"] } : u)) }, "QUYET_DINH_NGUOI_NHAN_KHONG_PHAI_SALE_HOP_LE"],
    ["người nhận khác cơ sở với lead/đơn", { nguoiDung: NGUOI.map((u) => (u.id === VAN ? { ...u, centerId: CS1 } : u)) }, "QUYET_DINH_SAI_CO_SO"],
    ["người nhận không rõ cơ sở", { nguoiDung: NGUOI.map((u) => (u.id === VAN ? { ...u, centerId: null } : u)) }, "QUYET_DINH_KHONG_RO_CO_SO"],
    ["đơn liên quan ở cơ sở khác (dù lead cùng cơ sở)", { don: [don("o1", "L1", { centerId: CS1 })] }, "QUYET_DINH_SAI_CO_SO"],
    ["lead ở cơ sở khác (dù đơn cùng cơ sở với người nhận)", { l: { centerId: CS1 } }, "QUYET_DINH_SAI_CO_SO"],
    ["lead không có hàng (không đọc được)", { leadQuyetDinh: [] }, "QUYET_DINH_LEAD_KHONG_TON_TAI"],
    ["lead đã xoá", { l: { deletedAt: new Date("2026-09-30T00:00:00Z") } }, "QUYET_DINH_LEAD_DA_XOA"],
    ["người chốt hiện tại là id treo", { l: { convertedById: "u-khong-co" } }, "NGUOI_CHOT_KHONG_TON_TAI"],
  ];
  it.each(CA)("[SNC-QD-04] %s ⇒ INVALID (%s)", (_ten, o, ma) => {
    const kh = lap(hienTruong(DOI_VAN, o));
    const khongCoHang = o.leadQuyetDinh !== undefined && o.leadQuyetDinh.length === 0; // không đọc được lead ⇒ không biết người chốt
    expect(kh.dong.find((d) => d.leadId === "L1")).toMatchObject({ loai: "INVALID", reasonCode: ma, newConvertedById: khongCoHang ? null : (o.l?.convertedById ?? KIET) });
    expect(kh.tom.khongHopLe).toBe(1);
    expect(kh.soGhi).toBe(0);
    const r = thuLai(kh);
    expect(r.ok).toBe(false);
    // đối chứng dương: hiện trường chuẩn ⇒ đổi được và cổng cho qua
    const tot = lap(hienTruong(DOI_VAN));
    expect(tot.dong[0]).toMatchObject({ loai: "REASSIGN", newConvertedById: VAN });
    expect(thuLai(tot)).toEqual({ ok: true });
  });

  it("[SNC-QD-05] KHÔNG chọn người theo TÊN: tài khoản trùng tên gọi «Diệu» (giáo viên, không mã) và Sale cùng tên khác mã đều bị bỏ qua; chỉ mã nhân viên quyết định", () => {
    const nd = [...NGUOI, nguoi("u-dieu-khac", "Huỳnh Thị Diệu", { centerId: CS1, maNhanVien: "TEST.DIEU2" })]; // CÙNG tên đầy đủ, KHÁC mã
    const d = dong1(hienTruong(DOI_DIEU, { nguoiDung: nd, l: { centerId: CS1, convertedById: ADMIN }, d: { centerId: CS1 } }), "L1");
    expect(d).toMatchObject({ loai: "REASSIGN", newConvertedById: DIEU });
    // người nhận chỉ có tên (không mã) ⇒ không giải được
    const nd2 = NGUOI.map((u) => (u.id === DIEU ? { ...u, maNhanVien: null } : u));
    expect(dong1(hienTruong(DOI_DIEU, { nguoiDung: nd2, l: { centerId: CS1, convertedById: ADMIN }, d: { centerId: CS1 } }), "L1")).toMatchObject({ loai: "INVALID" });
    // mã rỗng không khớp tài khoản nào (kể cả tài khoản không có mã)
    const rong: QuyetDinhOwner[] = [{ leadId: "L1", hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: "" } }];
    expect(dong1(hienTruong(rong), "L1")).toMatchObject({ loai: "INVALID", reasonCode: "QUYET_DINH_NGUOI_NHAN_KHONG_GIAI_QUYET_DUOC_DUY_NHAT" });
  });
});

describe("[SNC-QD-06..09] idempotent · chỉ chạm lead được chỉ định · trôi trạng thái · khoá hoa hồng · bảng sai", () => {
  const BA: QuyetDinhOwner[] = [
    { leadId: "A", hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_NV_DIEU } },
    { leadId: "B", hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_NV_VAN } },
    { leadId: "C", hanhDong: "GIU_NGUYEN" },
  ];
  /** A: BACKFILL, Toại chốt (CS1) · B: ngoài mẫu, Kiệt chốt (CS2) · C: ngoài mẫu, Kiệt (giữ) · E: lead KHÔNG có quyết định, BACKFILL, không bằng chứng ⇒ CLEAR · F: Sale hợp lệ chốt. */
  function bo(qd: readonly QuyetDinhOwner[]): DauVaoKeHoach {
    const A = lead("A", { convertedById: TOAI, assignedToId: TOAI, centerId: CS1 });
    const B = lead("B", { convertedById: KIET, centerId: CS2 });
    const C = lead("C", { convertedById: KIET, centerId: CS2 });
    const E = lead("E", { convertedById: ADMIN, centerId: CS2 });
    const F = lead("F", { convertedById: LIEN, centerId: CS2 });
    return {
      leads: [A, E, F],
      imports: [
        { leadId: "A", actorId: TOAI, luc: T_IMPORT },
        { leadId: "E", actorId: ADMIN, luc: T_IMPORT },
        { leadId: "F", actorId: ADMIN, luc: T_IMPORT },
      ],
      lichSu: [],
      hanhDong: [],
      leadNgoaiMau: [B, C],
      nguoiDung: NGUOI,
      don: [don("oa", "A", { centerId: CS1 }), don("ob", "B"), don("oc", "C"), don("oe", "E"), don("of", "F")],
      khoa: khoaRong,
      quyetDinhOwner: qd,
      leadQuyetDinh: [A, B, C],
    };
  }
  /** Mô phỏng ĐÃ GHI: áp dòng GHI vào mọi nhóm lead của đầu vào. */
  function apDung(i: DauVaoKeHoach, dong: readonly DongKeHoach[]): DauVaoKeHoach {
    const moi = nguoiChotMoiTheoLead(dong);
    const va = (l: HangLead): HangLead => (moi.has(l.id) ? { ...l, convertedById: moi.get(l.id) ?? null } : l);
    return { ...i, leads: i.leads.map(va), leadNgoaiMau: i.leadNgoaiMau.map(va), leadQuyetDinh: i.leadQuyetDinh.map(va) };
  }

  it("[SNC-QD-06] IDEMPOTENT: áp kế hoạch rồi lập lại ⇒ 0 dòng GHI; dòng quyết định thành ALREADY_CORRECT «đã áp dụng»; lead GIỮ vẫn nguyên", () => {
    const i = bo(BA);
    const kh = lap(i);
    expect(kh.soGhi).toBe(3); // A→Diệu, B→Vân, E→NULL (luật cũ)
    const sau = lap(apDung(i, kh.dong));
    expect(sau.soGhi).toBe(0);
    expect(sau.soXemTay).toBe(0);
    expect(sau.dong.find((d) => d.leadId === "A")).toMatchObject({ loai: "ALREADY_CORRECT", reasonCode: "OWNER_QUYET_DINH_DA_AP_DUNG", newConvertedById: DIEU });
    expect(sau.dong.find((d) => d.leadId === "B")).toMatchObject({ loai: "ALREADY_CORRECT", reasonCode: "OWNER_QUYET_DINH_DA_AP_DUNG", newConvertedById: VAN });
    expect(sau.dong.find((d) => d.leadId === "C")).toMatchObject({ loai: "ALREADY_CORRECT", reasonCode: "OWNER_QUYET_DINH_GIU_NGUYEN", newConvertedById: KIET });
    expect(sau.dongDauRa).toHaveLength(1); // chỉ còn dòng PLAN
    // lần chạy thứ ba vẫn y hệt (tất định)
    expect(lap(apDung(apDung(i, kh.dong), sau.dong)).sha).toBe(sau.sha);
  });

  it("[SNC-QD-07] CHỈ chạm lead được chỉ định: bỏ bảng quyết định thì dòng của MỌI lead khác y hệt; dòng GHI của quyết định chỉ nằm ở lead trong bảng", () => {
    const co = lap(bo(BA));
    const khong = lap(bo([]));
    const khacBang = (d: DongKeHoach) => !BA.some((q) => q.leadId === d.leadId);
    expect(co.dong.filter(khacBang)).toEqual(khong.dong.filter(khacBang));
    expect(co.boQua).toEqual(khong.boQua);
    const ghi = [...nguoiChotMoiTheoLead(co.dong).keys()].sort();
    expect(ghi).toEqual(["A", "B", "E"]); // E do luật cũ (CLEAR), KHÔNG do bảng
    expect(co.dong.filter((d) => d.evidenceClass.startsWith("OWNER_")).map((d) => d.leadId)).toEqual(["A", "B", "C"]);
    // lead ngoài bảng ở nhóm ngoài mẫu (nếu có) vẫn xem tay: thêm lead G ngoài mẫu KHÔNG có quyết định
    const g = lead("G", { convertedById: ADMIN, centerId: CS2 });
    const i = bo(BA);
    const them = lap({ ...i, leadNgoaiMau: [...i.leadNgoaiMau, g], don: [...i.don, don("og", "G")] });
    expect(them.dong.find((d) => d.leadId === "G")).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: "NGOAI_MAU_NGUOI_CHOT_LA_TAI_KHOAN_IMPORT" });
  });

  it("[SNC-QD-08] trôi trạng thái: người chốt ĐÃ là một Sale hợp lệ KHÁC người nhận ⇒ XEM TAY, không ghi đè; đối chứng dương: người chốt là tài khoản quản trị ⇒ đổi", () => {
    const i = bo(BA);
    const troi = lap({ ...i, leadQuyetDinh: i.leadQuyetDinh.map((l) => (l.id === "B" ? { ...l, convertedById: LIEN } : l)) });
    expect(troi.dong.find((d) => d.leadId === "B")).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: "QUYET_DINH_NGUOI_CHOT_DA_DOI_SANG_SALE_KHAC", newConvertedById: LIEN });
    expect(troi.soGhi).toBe(2);
    expect(lap(i).dong.find((d) => d.leadId === "B")).toMatchObject({ loai: "REASSIGN" });
    // người chốt hiện tại NULL (đã hold) ⇒ vẫn đổi được theo quyết định
    const hold = lap({ ...i, leadQuyetDinh: i.leadQuyetDinh.map((l) => (l.id === "B" ? { ...l, convertedById: null } : l)) });
    expect(hold.dong.find((d) => d.leadId === "B")).toMatchObject({ loai: "REASSIGN", oldConvertedById: null, newConvertedById: VAN });
  });

  it("[SNC-QD-08b] dấu vết hoa hồng ĐÃ KHOÁ (sổ mới · dòng kỳ APPROVED · thu trong kỳ APPROVED) ⇒ XEM TAY như mọi dòng khác; đối chứng dương: không khoá ⇒ đổi", () => {
    const khoas = [
      { ...khoaRong, leadCoSoMoi: new Set(["B"]) },
      { ...khoaRong, leadCoDongKyDaDuyet: new Set(["B"]) },
      { ...khoaRong, kyDaDuyet: new Set(["2026-10"]) },
    ];
    const ma = ["COMMISSION_DA_KHOA_SO_MOI", "COMMISSION_DA_KHOA_DONG_KY_DA_DUYET", "COMMISSION_DA_KHOA_THU_TRONG_KY_DA_DUYET"];
    khoas.forEach((k, n) => {
      const kh = lap({ ...bo(BA), khoa: k });
      expect(kh.dong.find((d) => d.leadId === "B"), ma[n]).toMatchObject({ loai: "MANUAL_REVIEW", reasonCode: ma[n] });
      expect(nguoiChotMoiTheoLead(kh.dong).has("B")).toBe(false);
    });
    expect(lap(bo(BA)).dong.find((d) => d.leadId === "B")).toMatchObject({ loai: "REASSIGN" });
  });

  it("[SNC-QD-09] bảng quyết định sai ⇒ NÉM LỖI (không đoán): hai quyết định cho cùng một lead · leadId rỗng", () => {
    const trung: QuyetDinhOwner[] = [...BA, { leadId: "A", hanhDong: "GIU_NGUYEN" }];
    expect(() => lap(bo(trung))).toThrow(/lead A có hơn một quyết định/);
    const rong: QuyetDinhOwner[] = [{ leadId: "", hanhDong: "GIU_NGUYEN" }];
    expect(() => lap(bo(rong))).toThrow(/leadId rỗng/);
  });
});

describe("[SNC-QD-11..12] bảng THẬT của owner (23/10/2026) — ghim nguyên văn + chạy qua planner trên hình dạng 7 lead PROD", () => {
  const BANG = Object.fromEntries(QUYET_DINH_OWNER_2310.map((q) => [q.leadId, q]));

  it("[SNC-QD-11] đúng 7 quyết định, mỗi lead một lần: 6 đổi (Vân 1 · Diệu 5) + 1 giữ nguyên; người nhận chọn theo MÃ NHÂN VIÊN (không id, không tên)", () => {
    expect(QUYET_DINH_OWNER_2310).toHaveLength(7);
    expect(new Set(QUYET_DINH_OWNER_2310.map((q) => q.leadId)).size).toBe(7);
    const ids = QUYET_DINH_OWNER_2310.map((q) => q.leadId);
    expect(ids).toEqual([...ids].sort()); // sắp tăng dần ⇒ diff bảng dễ review
    expect(BANG["cmvah7qgn06qhpb042hp2br4e"]).toEqual({ leadId: "cmvah7qgn06qhpb042hp2br4e", hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_NV_VAN } });
    for (const id of ["cmtbi8ee1000b59896lbuoqhk", "cmskk6cs000013to4a5vmn0kd", "cmshf1vr30006adw16giej2mz", "cmshf1w50001wadw1rop4509k", "cmshf1vr20002adw1i5tfsyrh"]) {
      expect(BANG[id], id).toEqual({ leadId: id, hanhDong: "DOI_NGUOI_CHOT", nguoiNhan: { maNhanVien: MA_NV_DIEU } });
    }
    expect(BANG["cmtbdd55f000112xdhdmlk4e8"]).toEqual({ leadId: "cmtbdd55f000112xdhdmlk4e8", hanhDong: "GIU_NGUYEN" });
    expect([MA_NV_DIEU, MA_NV_VAN]).toEqual(["CS1.NV.002", "CS2.NV.002"]);
    expect(JSON.stringify(QUYET_DINH_OWNER_2310)).not.toMatch(/Diệu|Vân|Kiệt|Toại|u-|cmrd/); // không tên hiển thị, không id người dùng
  });

  it("[SNC-QD-12] hình dạng PROD: 3 lead Toại (BACKFILL, CS1) + 4 lead ngoài mẫu ⇒ 6 REASSIGN (5 Diệu, 1 Vân) · 1 giữ · 0 xem tay · 0 INVALID; dòng ký = PLAN + 6; cổng cho qua với --expect=6 --expect-review=0", () => {
    const note = "[Import ĐK Excel] Sales: Toại · Nguồn: Giới thiệu";
    const T = ["cmshf1vr20002adw1i5tfsyrh", "cmshf1vr30006adw16giej2mz", "cmshf1w50001wadw1rop4509k"].map((id) => lead(id, { convertedById: TOAI, assignedToId: TOAI, centerId: CS1, note }));
    const O1 = lead("cmskk6cs000013to4a5vmn0kd", { convertedById: ADMIN, assignedToId: DIEU, centerId: CS1 });
    const O2 = lead("cmtbdd55f000112xdhdmlk4e8", { convertedById: KIET, assignedToId: LIEN, centerId: CS2 });
    const O3 = lead("cmtbi8ee1000b59896lbuoqhk", { convertedById: KIET, assignedToId: DIEU, centerId: CS1 });
    const O4 = lead("cmvah7qgn06qhpb042hp2br4e", { convertedById: KIET, assignedToId: VAN, centerId: CS2 });
    const khac = lead("Lkhac", { convertedById: ADMIN, centerId: CS2 }); // một lead BACKFILL khác của Admin để Admin/Kiệt cùng là «tài khoản import»
    const khac2 = lead("Lkhac2", { convertedById: KIET, centerId: CS2 });
    const i: DauVaoKeHoach = {
      leads: [...T, khac, khac2],
      imports: [...T.map((l) => ({ leadId: l.id, actorId: TOAI, luc: T_IMPORT })), { leadId: "Lkhac", actorId: ADMIN, luc: T_IMPORT }, { leadId: "Lkhac2", actorId: KIET, luc: T_IMPORT }],
      lichSu: [],
      hanhDong: [],
      leadNgoaiMau: [O1, O2, O3, O4],
      nguoiDung: NGUOI,
      don: [
        ...T.map((l, n) => don(`ot${n}`, l.id, { centerId: CS1, duong: "NOI_DON_MOT" })),
        don("o1", O1.id, { centerId: CS1 }),
        don("o2a", O2.id, { thuTong: 0 }),
        don("o2b", O2.id, { thuTong: 0 }),
        don("o3", O3.id, { centerId: CS1 }),
        don("o4", O4.id),
        don("ok", "Lkhac", { thuTong: 0 }),
        don("ok2", "Lkhac2", { thuTong: 0 }),
      ],
      khoa: khoaRong,
      quyetDinhOwner: QUYET_DINH_OWNER_2310,
      leadQuyetDinh: [...T, O1, O2, O3, O4],
    };
    const kh = lap(i);
    const dich = (id: string) => kh.dong.find((d) => d.leadId === id)!;
    for (const id of T.map((l) => l.id).concat([O1.id, O3.id])) expect(dich(id), id).toMatchObject({ loai: "REASSIGN", newConvertedById: DIEU, evidenceClass: "OWNER_QUYET_DINH" });
    expect(dich(O4.id)).toMatchObject({ loai: "REASSIGN", oldConvertedById: KIET, newConvertedById: VAN });
    expect(dich(O2.id)).toMatchObject({ loai: "ALREADY_CORRECT", reasonCode: "OWNER_QUYET_DINH_GIU_NGUYEN", newConvertedById: KIET });
    expect(kh.tom).toMatchObject({ ownerDoi: 6, ownerGiu: 1, khongHopLe: 0, xemTay: 0, ngoaiMau: 0 });
    // 6 dòng GHI do bảng owner + 2 dòng CLEAR của Lkhac/Lkhac2 (luật cũ, không bằng chứng) — chúng KHÔNG thuộc bảng
    expect(kh.dong.filter((d) => d.loai === "REASSIGN" && d.evidenceClass === "OWNER_QUYET_DINH")).toHaveLength(6);
    expect(kh.dong.filter((d) => d.loai === "CLEAR").map((d) => d.leadId)).toEqual(["Lkhac", "Lkhac2"]);
    expect(kh.soGhi).toBe(8);
    expect(kh.soXemTay).toBe(0);
    expect(kh.dongDauRa[0]).toMatch(/\|review=0\|invalid=0\|e2=GIU_XEM_TAY$/);
    // lead ngoài bảng (Lkhac/Lkhac2) KHÔNG được bảng chạm tới: dòng của chúng y hệt khi bỏ bảng
    const khong = lap({ ...i, quyetDinhOwner: [], leadQuyetDinh: [] });
    for (const id of ["Lkhac", "Lkhac2"]) expect(dich(id)).toEqual(khong.dong.find((d) => d.leadId === id));
    // cổng ghi: đúng số → qua; lệch số → từ chối
    const ok = quyetDinhGhiSuaNguoiChot({ soDuyet: kh.soGhi, soDuyetXemTay: 0, keHoachSha: kh.sha, kh, ghiDuoc: true });
    expect(ok).toEqual({ ok: true });
    expect(quyetDinhGhiSuaNguoiChot({ soDuyet: kh.soGhi - 1, soDuyetXemTay: 0, keHoachSha: kh.sha, kh, ghiDuoc: true }).ok).toBe(false);
    expect(quyetDinhGhiSuaNguoiChot({ soDuyet: kh.soGhi, soDuyetXemTay: 1, keHoachSha: kh.sha, kh, ghiDuoc: true }).ok).toBe(false);
  });
});
