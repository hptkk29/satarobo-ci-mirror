// @vitest-environment node
/**
 * [FUI-DB-*] — ĐỌC cho biểu mẫu Tạo / Sửa nguồn + danh sách có thao tác (`lib/nguon/doc-form-nguon.ts`, `docDanhMucNguon`) trên Postgres THẬT.
 *
 *   [FUI-DB-01] danh sách: mang nhóm nguồn · hoa hồng nguồn · cửa sổ riêng · hiệu lực · mốc khoá lạc quan; lọc theo nhóm; nguồn hết hạn vẫn ACTIVE nhưng `chonDuoc=false`; nháp/ngừng/lưu trữ vẫn đọc được
 *   [FUI-DB-02] biểu mẫu TẠO: tự gác `sources:manage` (vai chỉ-xem bị từ chối, vai quản lý đọc được); thứ tự gợi ý nằm SAU nguồn cuối; cây đơn vị cắt theo tầm nhìn
 *   [FUI-DB-03] biểu mẫu SỬA: nguồn lạ ⇒ null; ảnh nguồn đủ trường; «đích mặc định của quy nguồn» đúng; cờ «dính tiền» đúng (chính sách riêng · rule SOURCE_OWNER); đơn vị đang gán luôn có mặt
 *   [FUI-DB-04] ĐỒNG THUẬN màn hình ↔ cổng ghi: với cùng một lượt sửa, `phanTichSua` (màn hình) và `suaNguon` (máy chủ) cùng nói ĐƯỢC / KHÔNG ĐƯỢC, cùng ô lỗi — trên nguồn tự tạo, nguồn đã dùng, nguồn hệ thống, UNKNOWN
 *   [FUI-DB-05] nút trạng thái ≡ cổng: mọi nút `thaoTacTrangThai` vẽ ra thì `doiTrangThaiNguon` THẬT nhận; mọi lý do «không có nút» thì cổng thật cũng từ chối
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng. LUẬT 19: ngày tuyệt đối. Tệp chạy được MỘT MÌNH trên DB trống đã migrate + seed vai.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { PermissionError } from "../../lib/auth/can";
import { docDanhMucNguon } from "../../lib/nguon/doc-danh-muc";
import { docFormSuaNguon, docFormTaoNguon, docMaDichMacDinh } from "../../lib/nguon/doc-form-nguon";
import { bienFormSua, formTuNguon, phanTichSua, thaoTacTrangThai, type BoiCanhSua, type GiaTriForm } from "../../lib/nguon/form-nguon";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { actorCua, D, donKichBan, dungKichBan, ganNguon, ganVai, themChinhSachNhom, type KichBan } from "./_kich-ban";
import { doiTrangThaiNguon, lamSachChinhSach, suaNguon, taoNguon } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[FUI-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NHAN = "fx-fui";
const NOW = D("2026-10-09");
const LY_DO = "Chủ dự án chốt ngày 09/10/2026";
const cuaToi: KichBan[] = [];
let admin: { userId: string; ten: string };
let adminId = "";
let stamp = 0;

const MAU = {
  name: "Nguồn thử",
  description: null,
  sourceType: "MARKETING",
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  sortOrder: 400,
  trangThai: "ACTIVE",
  attributionWindowDays: null,
  commissionEnabled: false,
  ownerOrgUnitId: null,
  ownerEmployeeId: null,
  effectiveFrom: null,
  effectiveTo: null,
} as const;

async function taoNguonFui(hau: string, ghi: Record<string, unknown> = {}) {
  stamp += 1;
  const code = `FUI_${hau}_${Date.now().toString(36).toUpperCase()}${stamp}`;
  const r = await taoNguon({ nguoi: admin, vao: { ...MAU, code, name: `FUI ${hau}`, ...ghi } });
  if (!r.ok) throw new Error(`taoNguon(${hau}): ${r.truong}: ${r.loi}`);
  return { id: r.id, code: r.code };
}
const moiNhat = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).updatedAt;
const boiCanhMau = (p: Partial<BoiCanhSua> = {}): BoiCanhSua => ({
  laDichMacDinh: false,
  nowIso: NOW.toISOString(),
  coQuyenKichHoat: true,
  dinhTien: { chinhSachRieng: false, coDongThuHutRieng: false, ruleChuNguonBatKy: false, ruleChuChay: false },
  ...p,
});

describe.skipIf(!RUN_DB_TESTS)("[FUI-DB] biểu mẫu + danh sách nguồn — đọc trên Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["HO_MARKETING", "CENTER_MANAGER", "CENTER_SALES_CSM"] });
    await damBaoDanhMucGoc(db);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datCoNguon(CO_NGUON_DAY_DU);
    const u = await seedUser({ email: `${NHAN}-admin@ci.test`, role: "MARKETING", name: `${NHAN}-admin`, phone: null });
    adminId = u.id;
    // chạy lại trên cùng DB: seedUser là upsert (cùng userId) nên vai cũ còn lại làm `ganVai` đụng khoá duy nhất — dọn trước để spec chạy được nhiều lần (luật 18)
    await db.userOrgRole.deleteMany({ where: { userId: u.id } });
    admin = { userId: u.id, ten: `${NHAN}-admin` };
    const ho = await db.orgUnit.findFirstOrThrow({ where: { code: "HO", deletedAt: null }, select: { id: true } });
    await ganVai(u.id, ho.id, "HO_MARKETING");
  }, 120_000);

  afterAll(async () => {
    await donKichBan(cuaToi);
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "FUI_" } } });
    await db.auditLog.deleteMany({ where: { entityType: "LeadSourceGroup", actorName: { startsWith: NHAN } } });
    await damBaoDanhMucGoc(db);
  }, 90_000);

  it("[FUI-DB-01] danh sách: nhóm · hoa hồng nguồn · cửa sổ riêng · hiệu lực · mốc khoá lạc quan; lọc theo nhóm; hết hạn ≠ chọn được; nháp/ngừng vẫn đọc được", async () => {
    const actor = await actorCua(adminId);
    const a = await taoNguonFui("A", { commissionEnabled: true, attributionWindowDays: 45 });
    const het = await taoNguonFui("H", { sourceType: "EVENT", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: new Date("2026-02-01T00:00:00.000Z") });
    const nhap = await taoNguonFui("N", { trangThai: "DRAFT", sourceType: "PARTNER" });
    const ngung = await taoNguonFui("G", { sourceType: "PARTNER" });
    const r = await doiTrangThaiNguon({ nguoi: admin, id: ngung.id, updatedAtDaThay: await moiNhat(ngung.id), den: "INACTIVE", lyDo: LY_DO });
    expect(r.ok).toBe(true);

    const tat = await docDanhMucNguon(actor, { now: NOW, trangThai: null, coSoId: null });
    const theoMa = new Map(tat.dong.map((d) => [d.code, d]));
    expect(theoMa.get(a.code)).toMatchObject({ sourceType: "MARKETING", commissionEnabled: true, attributionWindowDays: 45, effectiveFrom: null, effectiveTo: null, chonDuoc: true, status: "ACTIVE" });
    expect(theoMa.get(a.code)!.capNhatLuc).toBe((await moiNhat(a.id)).toISOString());
    // hết hạn: vẫn ACTIVE (admin chưa ngừng) nhưng lead MỚI không chọn được — màn hình phải nói được điều đó
    expect(theoMa.get(het.code)).toMatchObject({ status: "ACTIVE", chonDuoc: false, effectiveTo: "2026-02-01T00:00:00.000Z" });
    expect(theoMa.get(nhap.code)).toMatchObject({ status: "DRAFT", chonDuoc: false });
    expect(theoMa.get(ngung.code)).toMatchObject({ status: "INACTIVE", chonDuoc: false });
    // nguồn hệ thống mặc định cũng mang nhóm: PAID_ADS = MARKETING có hoa hồng; WALK_IN = OFFLINE không
    expect(theoMa.get("PAID_ADS")).toMatchObject({ sourceType: "MARKETING", commissionEnabled: true });
    expect(theoMa.get("WALK_IN")).toMatchObject({ sourceType: "OFFLINE", commissionEnabled: false });

    // lọc theo nhóm
    const partner = await docDanhMucNguon(actor, { now: NOW, trangThai: null, loai: "PARTNER", coSoId: null });
    const maPartner = partner.dong.map((d) => d.code);
    expect(maPartner).toEqual(expect.arrayContaining([nhap.code, ngung.code, "PARTNER"]));
    expect(maPartner).not.toContain(a.code);
    expect(partner.dong.every((d) => d.sourceType === "PARTNER")).toBe(true);
    // lọc nhóm ∧ trạng thái
    const nhapPartner = await docDanhMucNguon(actor, { now: NOW, trangThai: "DRAFT", loai: "PARTNER", coSoId: null });
    expect(nhapPartner.dong.map((d) => d.code)).toContain(nhap.code);
    expect(nhapPartner.dong.map((d) => d.code)).not.toContain(ngung.code);
    // loai vắng / null = mọi nhóm
    const moi = await docDanhMucNguon(actor, { now: NOW, trangThai: null, loai: null, coSoId: null });
    expect(moi.dong.length).toBe(tat.dong.length);
  });

  it("[FUI-DB-02] biểu mẫu TẠO: tự gác sources:manage; thứ tự gợi ý sau nguồn cuối; cây đơn vị theo tầm nhìn", async () => {
    // vai CHỈ-XEM (CENTER_MANAGER có sources:view, không có sources:manage) bị từ chối — ĐỐI CHỨNG DƯƠNG ở dưới
    const k = await dungKichBan("fui02");
    cuaToi.push(k);
    await ganVai(k.qlcs.id, k.ouId, "CENTER_MANAGER");
    const xem = await actorCua(k.qlcs.id);
    await expect(docFormTaoNguon(xem)).rejects.toBeInstanceOf(PermissionError);
    await expect(docFormSuaNguon(xem, "PAID_ADS")).rejects.toBeInstanceOf(PermissionError);

    const actor = await actorCua(adminId);
    const maxThuTu = (await db.leadSourceGroup.aggregate({ where: { code: { not: "UNKNOWN" } }, _max: { sortOrder: true } }))._max.sortOrder!;
    const tao = await docFormTaoNguon(actor);
    expect(tao.thuTuGoiY).toBe(Math.min(maxThuTu + 10, 9998));
    expect(tao.cuaSoMacDinhNgay).toBe(90);
    const ma = tao.donVi.map((d) => d.ma);
    expect(ma).toEqual(expect.arrayContaining(["HO", "CS1", "CS2"]));
    // cây theo đường dẫn: cha đứng trước con, độ sâu tăng dần
    const ho = tao.donVi.find((d) => d.ma === "HO")!;
    const cs1 = tao.donVi.find((d) => d.ma === "CS1")!;
    expect(tao.donVi.indexOf(ho)).toBeLessThan(tao.donVi.indexOf(cs1));
    expect(cs1.doSau).toBeGreaterThan(ho.doSau);

    // người KHÔNG ở tầng Hội sở: chỉ thấy cây con của mình (actor dựng từ actor thật, hạ cờ tầng + thu hẹp tầm nhìn)
    const cs1Id = cs1.id;
    const hep = { ...actor, isSuperAdmin: false, isHoLevel: false, visibleOrgUnitIds: [cs1Id] };
    const thay = await docFormTaoNguon(hep);
    expect(thay.donVi.map((d) => d.id)).toEqual([cs1Id]);
  });

  it("[FUI-DB-03] biểu mẫu SỬA: mã lạ ⇒ null; ảnh nguồn đủ trường; đích mặc định; cờ «dính tiền»; đơn vị đang gán luôn có mặt", async () => {
    await lamSachChinhSach();
    const actor = await actorCua(adminId);
    expect(await docFormSuaNguon(actor, "KHONG_CO_NGUON_NAY")).toBeNull();

    const cs2 = await db.orgUnit.findFirstOrThrow({ where: { code: "CS2", deletedAt: null }, select: { id: true } });
    const n = await taoNguonFui("S", { attributionWindowDays: 30, ownerOrgUnitId: cs2.id, requiresNote: true });
    const sach = (await docFormSuaNguon(actor, n.code))!;
    expect(sach.nguon).toMatchObject({
      id: n.id,
      code: n.code,
      sourceType: "MARKETING",
      referrerRequirement: "NONE",
      requiresNote: true,
      selectable: true,
      status: "ACTIVE",
      isSystem: false,
      attributionWindowDays: 30,
      commissionEnabled: false,
      ownerOrgUnitId: cs2.id,
      ownerEmployee: null,
      effectiveFrom: null,
      effectiveTo: null,
    });
    expect(sach.nguon.capNhatLuc).toBe((await moiNhat(n.id)).toISOString());
    expect(sach.nguon.daDung.daDung).toBe(false);
    expect(sach.boiCanh).toEqual({ laDichMacDinh: false, dinhTien: { chinhSachRieng: false, coDongThuHutRieng: false, ruleChuNguonBatKy: false, ruleChuChay: false } });

    // đích mặc định của quy nguồn: PAID_ADS (luật quảng cáo) có; nguồn tự tạo không
    expect((await docFormSuaNguon(actor, "PAID_ADS"))!.boiCanh.laDichMacDinh).toBe(true);
    expect(await docMaDichMacDinh()).toEqual(expect.arrayContaining(["PAID_ADS", "UNKNOWN"]));
    expect(await docMaDichMacDinh()).not.toContain(n.code);

    // đơn vị đang gán nằm ngoài tầm nhìn vẫn có mặt (ô chọn không âm thầm bỏ giá trị đang lưu)
    const cs1 = await db.orgUnit.findFirstOrThrow({ where: { code: "CS1", deletedAt: null }, select: { id: true } });
    const hep = { ...actor, isSuperAdmin: false, isHoLevel: false, visibleOrgUnitIds: [cs1.id] };
    const ngoai = await docFormSuaNguon(hep, n.code);
    expect(ngoai!.donVi.map((d) => d.id).sort()).toEqual([cs1.id, cs2.id].sort());

    // «dính tiền»: chính sách riêng ACTIVE của nguồn ⇒ chinhSachRieng; rule SOURCE_OWNER ⇒ ruleChuNguonBatKy
    const k = await dungKichBan("fui03");
    cuaToi.push(k);
    await themChinhSachNhom(k, n.code, [{ vai: "MARKETING", rate: 0.005 }]);
    // chính sách riêng chỉ có dòng MARKETING 0,5% ⇒ có dòng THU HÚT (tắt cờ sẽ làm nó ngừng chạy im lặng)
    expect((await docFormSuaNguon(actor, n.code))!.boiCanh.dinhTien).toEqual({ chinhSachRieng: true, coDongThuHutRieng: true, ruleChuNguonBatKy: false, ruleChuChay: false });
    const m = await taoNguonFui("S2");
    expect((await docFormSuaNguon(actor, m.code))!.boiCanh.dinhTien.chinhSachRieng).toBe(false); // chính sách của nguồn khác không tính
    await themChinhSachNhom(k, m.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    // rule chủ nguồn ở BẤT KỲ nguồn nào: với nguồn thứ ba chưa có chính sách riêng, cờ rule-chủ vẫn bật (rule chung trả cho chủ của mọi nguồn)
    const p = await taoNguonFui("S3");
    // …nhưng rule riêng của nguồn KHÁC không CHẠY trên nguồn này (`ruleChuChay` chỉ nhìn rule chung + rule của chính nó)
    expect((await docFormSuaNguon(actor, p.code))!.boiCanh.dinhTien).toEqual({ chinhSachRieng: false, coDongThuHutRieng: false, ruleChuNguonBatKy: true, ruleChuChay: false });
  });

  /**
   * [FUI-DB-04] Cổng được cho ăn bằng thứ ĐƯỜNG THẬT cho nó ăn (luật 9): ca không gõ tay đầu vào của màn hình, mà dựng ảnh nguồn từ chính hàm đọc rồi hỏi cả hai cổng.
   * Màn hình nói «được» mà máy chủ từ chối = nút nói dối; ngược lại = người dùng bị chặn oan.
   */
  it("[FUI-DB-04] màn hình (phanTichSua) và cổng ghi (suaNguon) cùng nói ĐƯỢC / KHÔNG ĐƯỢC, cùng ô lỗi", async () => {
    await lamSachChinhSach();
    const actor = await actorCua(adminId);
    const k = await dungKichBan("fui04");
    cuaToi.push(k);
    const daDungNg = await taoNguonFui("P2", { referrerRequirement: "NONE" });
    await ganNguon(k, daDungNg.code); // nguồn ĐÃ DÙNG: có attribution
    const walkIn = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "WALK_IN" }, select: { name: true } });
    const unknownTen = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "UNKNOWN" }, select: { name: true } });

    // `moi` = nguồn tự tạo MỚI cho từng ca (ca thành công đổi mã / tên / cửa sổ thì ca sau không được thừa hưởng); `co` = mã nguồn có sẵn.
    /** `ky` (tuỳ chọn) = kết cục MONG ĐỢI của máy chủ. Bảng này vốn đo ĐỒNG THUẬN màn hình ↔ máy chủ; hàng nào cần ghim LUẬT (không chỉ đồng thuận) thì khai `ky`. */
    type Ca = { ten: string; nguon: { moi: string } | { co: string }; sua: (g: GiaTriForm, code: string) => Partial<GiaTriForm>; ky?: boolean };
    const caS: Ca[] = [
      { ten: "đổi tên nguồn sạch", nguon: { moi: "P1" }, sua: () => ({ name: "Tên khác hẳn" }) },
      { ten: "đổi cửa sổ nguồn sạch, THIẾU lý do", nguon: { moi: "P3" }, sua: () => ({ attributionWindowDays: "30" }) },
      { ten: "đổi cửa sổ nguồn sạch, đủ lý do", nguon: { moi: "P4" }, sua: () => ({ attributionWindowDays: "30", lyDo: LY_DO }) },
      { ten: "đổi mã nguồn sạch", nguon: { moi: "P5" }, sua: (_g, code) => ({ code: `${code}_V2`, lyDo: LY_DO }) },
      { ten: "đổi mã nguồn ĐÃ DÙNG", nguon: { co: daDungNg.code }, sua: (_g, code) => ({ code: `${code}_V2`, lyDo: LY_DO }) },
      { ten: "đổi cách xác định nguồn ĐÃ DÙNG", nguon: { co: daDungNg.code }, sua: () => ({ referrerRequirement: "PARENT", lyDo: LY_DO }) },
      { ten: "đổi cách xác định nguồn CHƯA dùng", nguon: { moi: "P6" }, sua: () => ({ referrerRequirement: "EMPLOYEE", lyDo: LY_DO }) },
      { ten: "hết hạn không sau bắt đầu", nguon: { moi: "P7" }, sua: () => ({ effectiveFrom: "2027-02-01", effectiveTo: "2027-01-01", lyDo: LY_DO }) },
      { ten: "đặt hiệu lực hợp lệ", nguon: { moi: "P8" }, sua: () => ({ effectiveFrom: "2027-01-01", effectiveTo: "2027-02-01", lyDo: LY_DO }) },
      { ten: "hệ thống WALK_IN: đổi mã", nguon: { co: "WALK_IN" }, sua: () => ({ code: "WALK_IN_2", lyDo: LY_DO }) },
      { ten: "hệ thống WALK_IN: đổi tên", nguon: { co: "WALK_IN" }, sua: () => ({ name: "Khách tự đến (đổi tên)" }) },
      { ten: "hệ thống WALK_IN: đổi nhóm nguồn", nguon: { co: "WALK_IN" }, sua: () => ({ sourceType: "MARKETING", lyDo: LY_DO }) },
      { ten: "UNKNOWN: bật hoa hồng nguồn", nguon: { co: "UNKNOWN" }, sua: () => ({ commissionEnabled: true, lyDo: LY_DO }) },
      // Siết 09/10 (Q2): UNKNOWN chỉ đổi được tên · mô tả · thứ tự. ĐỐI CHỨNG DƯƠNG đi liền: nguồn hệ thống KHÁC (WALK_IN) vẫn đổi được cửa sổ — cái khoá không lan ra cả nhóm hệ thống.
      { ten: "UNKNOWN: đặt cửa sổ ghi công", nguon: { co: "UNKNOWN" }, sua: () => ({ attributionWindowDays: "30", lyDo: LY_DO }), ky: false },
      { ten: "UNKNOWN: đổi tên (đối chứng dương)", nguon: { co: "UNKNOWN" }, sua: () => ({ name: "Không rõ nguồn (đổi tên thử)" }), ky: true },
      { ten: "hệ thống WALK_IN: đặt cửa sổ ghi công (đối chứng dương)", nguon: { co: "WALK_IN" }, sua: () => ({ attributionWindowDays: "30", lyDo: LY_DO }), ky: true },
      { ten: "PAID_ADS (đích mặc định): tắt chọn", nguon: { co: "PAID_ADS" }, sua: () => ({ selectable: false, lyDo: LY_DO }) },
      { ten: "PAID_ADS (đích mặc định): đặt hạn", nguon: { co: "PAID_ADS" }, sua: () => ({ effectiveTo: "2027-06-01", lyDo: LY_DO }) },
      { ten: "thứ tự ngoài khoảng", nguon: { moi: "P9" }, sua: () => ({ sortOrder: "99999" }) },
    ];
    for (const ca of caS) {
      const code = "moi" in ca.nguon ? (await taoNguonFui(ca.nguon.moi)).code : ca.nguon.co;
      const view = (await docFormSuaNguon(actor, code))!;
      const goc = formTuNguon(view.nguon);
      const form = { ...goc, ...ca.sua(goc, code) };
      const ptich = phanTichSua({ form, goc, nguon: view.nguon, boiCanh: boiCanhMau({ ...view.boiCanh }) });
      const mayChu = await suaNguon({
        nguoi: admin,
        id: view.nguon.id,
        updatedAtDaThay: new Date(view.nguon.capNhatLuc),
        vao: bienFormSua(form, goc).vao,
        lyDo: bienFormSua(form, goc).lyDo,
      });
      const manHinhDuoc = Object.keys(ptich.loi).length === 0 && ptich.chanLuu === null;
      if (ca.ky !== undefined) expect(mayChu.ok, `${ca.ten}: luật nói ${ca.ky ? "ĐƯỢC" : "KHÔNG ĐƯỢC"}`).toBe(ca.ky);
      expect(mayChu.ok, `${ca.ten}: màn hình ${manHinhDuoc ? "ĐƯỢC" : "KHÔNG"} vs máy chủ ${mayChu.ok ? "ĐƯỢC" : mayChu.truong + ": " + mayChu.loi}`).toBe(manHinhDuoc);
      if (!mayChu.ok) {
        // cùng ô: lỗi của máy chủ phải rơi vào ĐÚNG ô mà màn hình đã tô đỏ
        const o = mayChu.truong === "trangThai" ? "lyDo" : mayChu.truong;
        expect(Object.keys(ptich.loi), `${ca.ten}: ô lỗi`).toContain(o);
      }
    }
    // ca đổi tên / đổi cửa sổ nguồn hệ thống đã THÀNH CÔNG ở máy chủ: trả về nguyên trạng cho bộ chạy sau
    await db.leadSourceGroup.update({ where: { code: "WALK_IN" }, data: { name: walkIn.name, attributionWindowDays: null } });
    await db.leadSourceGroup.update({ where: { code: "UNKNOWN" }, data: { name: unknownTen.name } });
  });

  it("[FUI-DB-05] nút trạng thái ≡ cổng ghi: mọi nút vẽ ra thì cổng THẬT nhận; mọi «không có nút» thì cổng THẬT cũng từ chối", async () => {
    const actor = await actorCua(adminId);
    const dich = new Set(await docMaDichMacDinh());
    const mauCa = [await taoNguonFui("T1"), await taoNguonFui("T2", { trangThai: "DRAFT" }), { code: "WALK_IN" }, { code: "PAID_ADS" }, { code: "UNKNOWN" }];
    for (const m of mauCa) {
      const view = (await docFormSuaNguon(actor, m.code))!;
      const goc = view.nguon;
      const { duoc, khongDuoc } = thaoTacTrangThai({
        nguon: { code: goc.code, isSystem: goc.isSystem, status: goc.status, ownerEmployeeId: goc.ownerEmployee?.id ?? null },
        dichMacDinh: dich,
        dinhTien: { chinhSachRieng: view.boiCanh.dinhTien.chinhSachRieng, ruleChuChay: view.boiCanh.dinhTien.ruleChuChay },
        coQuyenKichHoat: true,
        now: NOW,
      });
      for (const t of duoc) {
        // dựng lại trạng thái gốc trước mỗi thử để các thử không đè lên nhau
        await db.leadSourceGroup.update({ where: { id: goc.id }, data: { status: goc.status } });
        const hienTai = await db.leadSourceGroup.findUniqueOrThrow({ where: { id: goc.id } });
        const r = await doiTrangThaiNguon({ nguoi: admin, id: goc.id, updatedAtDaThay: hienTai.updatedAt, den: t.den, lyDo: LY_DO });
        expect(r.ok, `${m.code}: nút «${t.nhan}» (${goc.status}→${t.den}) bị cổng từ chối: ${r.ok ? "" : r.loi}`).toBe(true);
        await db.leadSourceGroup.update({ where: { id: goc.id }, data: { status: goc.status } });
      }
      for (const c of khongDuoc) {
        const hienTai = await db.leadSourceGroup.findUniqueOrThrow({ where: { id: goc.id } });
        const r = await doiTrangThaiNguon({ nguoi: admin, id: goc.id, updatedAtDaThay: hienTai.updatedAt, den: c.den, lyDo: LY_DO });
        expect(r.ok, `${m.code}: «${c.nhan}» bị ẩn nhưng cổng lại nhận`).toBe(false);
        if (!r.ok) expect(r.loi).toBe(c.lyDo); // câu hiển thị thay nút = CHÍNH câu cổng ghi trả
      }
    }
    // dọn: trả về trạng thái gốc cho các nguồn hệ thống
    await damBaoDanhMucGoc(db);
  });
});
