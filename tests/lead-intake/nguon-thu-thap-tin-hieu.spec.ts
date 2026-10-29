// @vitest-environment node
/**
 * PR2 — TẦNG ĐỌC của resolver (`thuThapTinHieuTheoLo`) trên Postgres LOCAL thật, KHÔNG qua handler: mỗi ca nuôi hàm đúng thứ
 * nó nuốt rồi đọc `TinHieuQuyNguon` ra. Sinh ra từ lượt cấy lỗi (luật 14): CHÍN phép cấy vào tệp này từng cho 0 ca đỏ vì
 * mọi ca DB cũ đi qua handler và chỉ nhìn vào attribution cuối — những nhánh dưới đây (biên hiệu lực của vai, nhân sự đã
 * nghỉ, lead đã xoá mềm, aff đã tắt…) không có đường nào trong handler làm chúng lộ ra.
 *
 *   [NHH-SRC-TT-01]  vai theo THỜI ĐIỂM: biên `effectiveFrom` (gồm) và `effectiveTo` (loại)
 *   [NHH-SRC-TT-02]  UserOrgRole không ACTIVE (SUSPENDED/EXPIRED) không đóng góp vai
 *   [NHH-SRC-TT-03]  picker: chỉ ACTIVE/ON_LEAVE được claim MỚI (D13)
 *   [NHH-SRC-TT-04]  mã NV trên phiếu: nhân viên đã nghỉ ⇒ KHÔNG giải (maNvKhongGiai); ACTIVE ⇒ giải
 *   [NHH-SRC-TT-05]  người nhập: phiên đăng nhập THẮNG mã NV trên phiếu
 *   [NHH-SRC-TT-06]  kế thừa theo SĐT bỏ qua lead đã XOÁ MỀM · [TT-06b] so theo canonical (0907… ≡ 84907…)
 *   [NHH-SRC-TT-07]  mã giới thiệu của đối tác đã TẮT không hợp lệ
 *   [NHH-SRC-TT-08]  SĐT nhân viên: MỌI status (kể cả đã nghỉ), cả hai nguồn (Employee.phone · User.phone), so canonical
 *   [NHH-SRC-TT-09]  SĐT người giới thiệu trùng SĐT khách
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `TTH` và danh sách SĐT cố định. LUẬT 18: mỗi ca tự dựng hiện trường.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { chuanHoaMaNhanVien } from "../../lib/nguon/ma-nhan-vien";
import { thuThapTinHieuTheoLo, type DauVaoTinHieu } from "../../lib/nguon/thu-thap-tin-hieu";
import { KHONG_CO_TIN_HIEU_NGUON } from "../../lib/nguon/tin-hieu";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon, type IdNhom } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "TTH";
const CASE = 60_000;

const SDT = {
  khach: "0907000001",
  khach2: "0907000002",
  nvNghi: "0907000003",
  nvUser: "0907000004",
  nguoiGt: "0907000005",
  xoaMem: "0907000006",
  trong: "0907000099",
} as const;
const TAT_CA = Object.values(SDT);
const bienThe = (s: string) => [s, `84${s.slice(1)}`];

async function don(): Promise<void> {
  const leads = await db.lead.findMany({
    where: { OR: [{ parentName: { startsWith: P } }, { phone: { in: TAT_CA.flatMap(bienThe) } }] },
    select: { id: true },
  });
  if (leads.length > 0) await db.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } }); // FK Cascade kéo quy nguồn
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await db.user.deleteMany({ where: { email: { startsWith: P } } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: P } } });
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
}

const T0 = new Date("2026-07-01T00:00:00.000Z");
const T1 = new Date("2026-08-01T00:00:00.000Z");
const lui = (d: Date, ms: number) => new Date(d.getTime() + ms);

function dong(over: Partial<DauVaoTinHieu> = {}): DauVaoTinHieu {
  return {
    bayGio: new Date("2026-10-08T03:00:00.000Z"),
    duongVao: "nhap-tay",
    conversionEntry: null,
    nhanKhai: null,
    laNhapExcel: false,
    sdtKhach: null,
    maNvNguoiNhap: null,
    nguoiNhapUserId: null,
    nhanSuGioiThieuEmployeeId: null,
    phuHuynhGioiThieu: null,
    ref: null,
    refSau: [],
    quangCao: KHONG_CO_TIN_HIEU_NGUON.quangCao,
    utm: KHONG_CO_TIN_HIEU_NGUON.utm,
    pageId: null,
    ...over,
  };
}

describe.skipIf(!RUN)("PR2 — thuThapTinHieuTheoLo (tầng đọc) trên DB thật", () => {
  let nhom: IdNhom;
  let cs1 = "";
  let cs1Ou = "";
  let vaiSale = "";
  let seq = 0;

  async function dungNhanVien(
    hau: string,
    over: { status?: "ACTIVE" | "ON_LEAVE" | "RESIGNED" | "TERMINATED"; phone?: string | null } = {},
  ) {
    seq += 1;
    return db.employee.create({
      data: {
        employeeCode: `${P}.NV.${String(seq).padStart(2, "0")}${hau}`,
        fullName: `${P} ${hau}`,
        jobTitle: "Tư vấn",
        department: "TUYEN_SINH",
        centerId: cs1,
        isActive: (over.status ?? "ACTIVE") === "ACTIVE",
        status: over.status ?? "ACTIVE",
        phone: over.phone ?? null,
      },
      select: { id: true, employeeCode: true },
    });
  }

  async function dungUser(hau: string, employeeId: string | null, phone: string | null = null) {
    seq += 1;
    return db.user.create({
      data: {
        name: `${P} ${hau}`,
        email: `${P}-${hau}-${seq}@example.test`,
        role: "SALES_CSM",
        roles: ["SALES_CSM"],
        centerId: cs1,
        employeeId,
        phone,
        isActive: true,
      },
      select: { id: true },
    });
  }

  async function gan(userId: string, tuyChon: { from: Date; to: Date | null; status?: "ACTIVE" | "SUSPENDED" | "EXPIRED" }) {
    await db.userOrgRole.create({
      data: {
        userId,
        orgUnitId: cs1Ou,
        roleId: vaiSale,
        effectiveFrom: tuyChon.from,
        effectiveTo: tuyChon.to,
        status: tuyChon.status ?? "ACTIVE",
        grantedById: "tth",
      },
    });
  }

  // Tự dựng Center/OrgUnit CS1 + vai (luật 18) — không mượn của bộ chạy trước.
  beforeAll(async () => {
    await damBaoToChuc({ donVi: ["HO", "CS1"], vai: ["CENTER_SALES_CSM"] });
  }, 120_000);

  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    cs1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    cs1Ou = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    vaiSale = (await db.roleDef.findUniqueOrThrow({ where: { code: "CENTER_SALES_CSM" }, select: { id: true } })).id;
    void nhom;
  }, CASE);

  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 120_000);

  it("[NHH-SRC-TT-01] vai theo THỜI ĐIỂM: effectiveFrom GỒM biên, effectiveTo LOẠI biên (một lô bốn dòng quanh hai biên)", async () => {
    const e = await dungNhanVien("A");
    const u = await dungUser("a", e.id);
    await gan(u.id, { from: T0, to: T1 });
    const r = await thuThapTinHieuTheoLo(db, [
      dong({ nguoiNhapUserId: u.id, bayGio: lui(T0, -1) }), // ngay trước hiệu lực
      dong({ nguoiNhapUserId: u.id, bayGio: T0 }), //          đúng mốc bắt đầu ⇒ CÓ
      dong({ nguoiNhapUserId: u.id, bayGio: lui(T1, -1) }), // 1ms trước mốc hết ⇒ CÓ
      dong({ nguoiNhapUserId: u.id, bayGio: T1 }), //          đúng mốc hết ⇒ KHÔNG (hết hạn là thuộc tính resolver, loại biên)
    ]);
    expect(r.tin.map((t) => t.nguoiNhap?.roleCodes ?? null)).toEqual([[], ["CENTER_SALES_CSM"], ["CENTER_SALES_CSM"], []]);
  }, CASE);

  it("[NHH-SRC-TT-02] UserOrgRole SUSPENDED/EXPIRED không đóng góp vai; đối chứng dương: ACTIVE thì có", async () => {
    const e = await dungNhanVien("B");
    const u = await dungUser("b", e.id);
    await gan(u.id, { from: T0, to: null, status: "SUSPENDED" });
    const luc = new Date("2026-10-08T03:00:00.000Z");
    const treo = await thuThapTinHieuTheoLo(db, [dong({ nguoiNhapUserId: u.id, bayGio: luc })]);
    expect(treo.tin[0]!.nguoiNhap?.roleCodes).toEqual([]);
    await db.userOrgRole.updateMany({ where: { userId: u.id }, data: { status: "EXPIRED" } });
    const het = await thuThapTinHieuTheoLo(db, [dong({ nguoiNhapUserId: u.id, bayGio: luc })]);
    expect(het.tin[0]!.nguoiNhap?.roleCodes).toEqual([]);
    await db.userOrgRole.updateMany({ where: { userId: u.id }, data: { status: "ACTIVE" } });
    const ok = await thuThapTinHieuTheoLo(db, [dong({ nguoiNhapUserId: u.id, bayGio: luc })]);
    expect(ok.tin[0]!.nguoiNhap?.roleCodes).toEqual(["CENTER_SALES_CSM"]);
  }, CASE);

  it("[NHH-SRC-TT-03] picker: nhân sự RESIGNED/TERMINATED KHÔNG được claim MỚI (D13); ACTIVE và ON_LEAVE thì được", async () => {
    const act = await dungNhanVien("ACT");
    const nghiPhep = await dungNhanVien("LV", { status: "ON_LEAVE" });
    const nghi = await dungNhanVien("RS", { status: "RESIGNED" });
    const duoi = await dungNhanVien("TM", { status: "TERMINATED" });
    const r = await thuThapTinHieuTheoLo(
      db,
      [act, nghiPhep, nghi, duoi].map((x) => dong({ nhanSuGioiThieuEmployeeId: x.id })),
    );
    expect(r.tin.map((t) => t.nhanSuGioiThieu?.employeeId ?? null)).toEqual([act.id, nghiPhep.id, null, null]);
  }, CASE);

  it("[NHH-SRC-TT-04] mã NV trên phiếu: nhân viên ACTIVE/ON_LEAVE ⇒ giải ra người nhập; đã NGHỈ ⇒ KHÔNG giải, mã được báo ở maNvKhongGiai", async () => {
    const act = await dungNhanVien("MA");
    const nghi = await dungNhanVien("MB", { status: "RESIGNED" });
    const r = await thuThapTinHieuTheoLo(db, [dong({ maNvNguoiNhap: act.employeeCode }), dong({ maNvNguoiNhap: nghi.employeeCode })]);
    expect(r.tin[0]!.nguoiNhap?.employeeId).toBe(act.id);
    expect(r.tin[0]!.maNvKhongGiai).toBeNull();
    expect(r.tin[1]!.nguoiNhap).toBeNull();
    expect(r.tin[1]!.maNvKhongGiai).toBe(chuanHoaMaNhanVien(nghi.employeeCode));
  }, CASE);

  it("[NHH-SRC-TT-05] người nhập: PHIÊN đăng nhập thắng mã NV trên phiếu (cả hai cùng có, hai người khác nhau)", async () => {
    const phien = await dungNhanVien("PH");
    const tren = await dungNhanVien("PM");
    const u = await dungUser("ph", phien.id);
    const r = await thuThapTinHieuTheoLo(db, [dong({ nguoiNhapUserId: u.id, maNvNguoiNhap: tren.employeeCode })]);
    expect(r.tin[0]!.nguoiNhap?.employeeId).toBe(phien.id);
    expect(r.tin[0]!.maNvKhongGiai).toBeNull();
    // Đối chứng dương: không có phiên ⇒ mã trên phiếu mới được dùng.
    const khongPhien = await thuThapTinHieuTheoLo(db, [dong({ maNvNguoiNhap: tren.employeeCode })]);
    expect(khongPhien.tin[0]!.nguoiNhap?.employeeId).toBe(tren.id);
  }, CASE);

  it("[NHH-SRC-TT-06] kế thừa theo SĐT bỏ qua lead đã XOÁ MỀM; đối chứng dương: gỡ xoá mềm ⇒ kế thừa", async () => {
    const l = await db.lead.create({
      data: { parentName: `${P} cũ`, phone: SDT.xoaMem, status: "DA_MAT", deletedAt: new Date("2026-09-01T00:00:00.000Z") },
      select: { id: true },
    });
    await db.leadAttribution.create({
      data: { leadId: l.id, groupId: nhom.PARENT_REFERRAL, originalGroupId: nhom.PARENT_REFERRAL, identificationMethod: "MANUAL", matchedRule: "KHAI_TAY", reasonText: "gốc" },
    });
    const xoa = await thuThapTinHieuTheoLo(db, [dong({ sdtKhach: SDT.xoaMem })]);
    expect(xoa.tin[0]!.keThua).toBeNull();
    await db.lead.update({ where: { id: l.id }, data: { deletedAt: null } });
    const ok = await thuThapTinHieuTheoLo(db, [dong({ sdtKhach: SDT.xoaMem })]);
    expect(ok.tin[0]!.keThua?.leadId).toBe(l.id);
  }, CASE);

  it("[NHH-SRC-TT-06b] kế thừa theo SĐT so theo CANONICAL: lead lưu `0907…` vẫn kế thừa khi phiếu mới gõ `84907…`/`+84907…` (và ngược lại)", async () => {
    // Cấy `leadTheoSdt.get(phoneKey(r.sdtKhach))` → `get(r.sdtKhach)`: đo prod 03/08 có CẢ HAI dạng (99 lead `0…` / 8 lead `84…`), nên
    // cùng một khách gõ khác dạng sẽ mất nguồn gốc IM LẶNG — đúng thứ kế thừa sinh ra để chống.
    const l = await db.lead.create({ data: { parentName: `${P} dạng 0`, phone: SDT.khach, status: "DA_MAT" }, select: { id: true } });
    await db.leadAttribution.create({
      data: { leadId: l.id, groupId: nhom.PARENT_REFERRAL, originalGroupId: nhom.PARENT_REFERRAL, identificationMethod: "MANUAL", matchedRule: "KHAI_TAY", reasonText: "gốc" },
    });
    const quocTe = `84${SDT.khach.slice(1)}`;
    const r = await thuThapTinHieuTheoLo(db, [dong({ sdtKhach: SDT.khach }), dong({ sdtKhach: quocTe }), dong({ sdtKhach: `+${quocTe}` }), dong({ sdtKhach: SDT.trong })]);
    expect(r.tin.map((t) => t.keThua?.leadId ?? null)).toEqual([l.id, l.id, l.id, null]);
    // Chiều ngược: lead lưu `84…`, phiếu mới gõ `0…`.
    await db.lead.update({ where: { id: l.id }, data: { phone: quocTe } });
    const nguoc = await thuThapTinHieuTheoLo(db, [dong({ sdtKhach: SDT.khach })]);
    expect(nguoc.tin[0]!.keThua?.leadId).toBe(l.id);
  }, CASE);

  it("[DYN-NC-07] kế thừa theo SĐT chép NGUYÊN VĂN bản chụp `signals.nguon` của hàng gốc (anhChup.nguon); bản chụp VẮNG hoặc HỎNG ⇒ null (hàng mới sẽ chụp lại từ nhóm lúc này)", async () => {
    // Cấy: `docAnhChup` luôn trả `nguon: null` ⇒ ca «hợp lệ» đỏ (kế thừa mất bản chụp, hàng mới đọc chủ nguồn SỐNG).
    const l = await db.lead.create({ data: { parentName: `${P} bản chụp`, phone: SDT.khach2, status: "DA_MAT" }, select: { id: true } });
    const ghi = (signals: object | null) =>
      db.leadAttribution.upsert({
        where: { leadId: l.id },
        create: { leadId: l.id, groupId: nhom.PARENT_REFERRAL, originalGroupId: nhom.PARENT_REFERRAL, identificationMethod: "MANUAL", matchedRule: "KHAI_TAY", reasonText: "gốc", ...(signals ? { signals } : {}) },
        update: { signals: signals ?? undefined },
      });
    const doc = async () => (await thuThapTinHieuTheoLo(db, [dong({ sdtKhach: SDT.khach2 })])).tin[0]!.keThua!.anhChup.nguon;
    await ghi({ nguon: { cuaSoNgay: 45, chuNhanVienId: "E-LUC-GHI" } });
    expect(await doc()).toEqual({ cuaSoNgay: 45, chuNhanVienId: "E-LUC-GHI" });
    await ghi({ duongVao: "nhap-tay" });
    expect(await doc(), "hàng gốc chưa có bản chụp (di trú)").toBeNull();
    await ghi({ nguon: { cuaSoNgay: "x" } });
    expect(await doc(), "bản chụp hỏng không được kế thừa").toBeNull();
  }, CASE);

  it("[DYN-NC-08] người nhập (D12) được giải từ PHIÊN ĐĂNG NHẬP lẫn MÃ NV trên phiếu: cả hai ra `nguoiNhap` với mã NV + đơn vị (để ghi dấu vết «ai nhập»); không gì ⇒ null; KHÔNG còn đầu vào «chủ lead lúc tạo»", async () => {
    // Cấy: bỏ nhánh phiên (`if (u?.employeeId) nguoiNhap = giaiNguoi(...)`) ⇒ tin[0] mất người nhập (đỏ).
    const nv = await dungNhanVien("cl");
    const u = await dungUser("cl", nv.id);
    const r = await thuThapTinHieuTheoLo(db, [dong({ nguoiNhapUserId: u.id }), dong({ maNvNguoiNhap: nv.employeeCode }), dong()]);
    expect(r.tin[0]!.nguoiNhap).toMatchObject({ employeeId: nv.id, employeeCode: nv.employeeCode });
    expect(r.tin[1]!.nguoiNhap).toMatchObject({ employeeId: nv.id, employeeCode: nv.employeeCode });
    expect(r.tin[2]!.nguoiNhap).toBeNull();
    expect("chuLeadLucTao" in r.tin[0]!).toBe(false);
  }, CASE);

  it("[NHH-SRC-TT-07] mã giới thiệu: đối tác ĐANG HOẠT ĐỘNG ⇒ hợp lệ; đối tác đã TẮT ⇒ hopLe=false (mã vẫn được ghi lại)", async () => {
    const aff = await db.affiliate.create({ data: { code: `${P}OK1`, name: `${P} aff`, isActive: true }, select: { id: true } });
    await db.affiliate.create({ data: { code: `${P}OFF`, name: `${P} aff tắt`, isActive: false } });
    const r = await thuThapTinHieuTheoLo(db, [dong({ ref: `${P}OK1` }), dong({ ref: `${P}OFF` }), dong({ ref: `${P}KHONGCO` })]);
    expect(r.tin[0]!.ref).toEqual({ code: `${P}OK1`, hopLe: true, affiliateId: aff.id });
    expect(r.tin[1]!.ref).toEqual({ code: `${P}OFF`, hopLe: false, affiliateId: null });
    expect(r.tin[2]!.ref?.hopLe).toBe(false);
  }, CASE);

  it("[NHH-SRC-TT-08] SĐT nhân viên: MỌI status (đã nghỉ vẫn tính) và CẢ User.phone; so canonical (0907… ≡ 84907…)", async () => {
    await dungNhanVien("NV", { status: "RESIGNED", phone: SDT.nvNghi });
    const eU = await dungNhanVien("NU");
    await dungUser("nu", eU.id, `84${SDT.nvUser.slice(1)}`);
    const r = await thuThapTinHieuTheoLo(db, [
      dong({ sdtKhach: SDT.nvNghi }), //                      Employee.phone, nhân viên đã nghỉ
      dong({ sdtKhach: SDT.nvUser }), //                      User.phone (lưu dạng 84…, khách gõ 0…)
      dong({ sdtKhach: `84${SDT.nvNghi.slice(1)}` }), //      cùng số, dạng quốc tế
      dong({ sdtKhach: SDT.trong }), //                       đối chứng âm: số không của ai
      dong({ sdtKhach: null }), //                            không SĐT ⇒ không bao giờ trùng
    ]);
    expect(r.tin.map((t) => t.sdtTrungNhanVien)).toEqual([true, true, true, false, false]);
  }, CASE);

  it("[NHH-SRC-TT-09] SĐT người giới thiệu (picker) trùng SĐT khách ⇒ cờ bật; khác số ⇒ tắt", async () => {
    const gt = await dungNhanVien("GT", { phone: SDT.nguoiGt });
    const r = await thuThapTinHieuTheoLo(db, [
      dong({ sdtKhach: SDT.nguoiGt, nhanSuGioiThieuEmployeeId: gt.id }),
      dong({ sdtKhach: SDT.khach2, nhanSuGioiThieuEmployeeId: gt.id }),
      dong({ sdtKhach: SDT.nguoiGt }), // không có picker ⇒ không có người giới thiệu để trùng
    ]);
    expect(r.tin.map((t) => t.sdtNguoiGioiThieuTrungKhach)).toEqual([true, false, false]);
  }, CASE);
});
