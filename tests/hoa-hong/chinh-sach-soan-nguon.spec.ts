// @vitest-environment node
/**
 * [CSN-DB-*] — DỮ LIỆU CHO Ô «NHÓM NGUỒN» CỦA TRÌNH SOẠN CHÍNH SÁCH, trên Postgres THẬT (E2a, 09/10/2026).
 *
 * Nguồn do admin TẠO BẰNG DỊCH VỤ GHI DANH MỤC (không seed tay) → `docDuLieuSoan` (đường đọc thật của trang soạn) phải trả đúng trạng thái, cờ hoa hồng, người phụ trách và kiểu người
 * giới thiệu — vì UI (ô chọn · ghi chú · gợi ý vai) dựng từ đúng những trường này. Test thuần của UI giả lập dữ liệu; chỉ ca này chứng minh dữ liệu THẬT mang đủ hình dạng đó.
 *
 *   [CSN-DB-01] mỗi trạng thái nguồn → đúng khoá: hoạt động · hết hạn · chưa hiệu lực · nháp · ngừng · lưu trữ; UNKNOWN không có mặt
 *   [CSN-DB-02] cờ «tham gia hoa hồng», người phụ trách, kiểu người giới thiệu đi theo dòng master (không theo mã)
 *   [CSN-DB-03] vai master mang `resolverKey` (hai vai mới có khoá riêng) và `isAcquisition` khớp master
 *   [CSN-DB-04] gợi ý vai × nguồn trên dữ liệu thật KHỚP guardrail thật: nguồn thiếu chủ + chính sách vai SOURCE_OWNER ⇒ cả hai cùng báo; có chủ ⇒ cả hai cùng im
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: tự dựng, chạy ĐƯỢC MỘT MÌNH trên DB trống đã migrate + seed vai. LUẬT 19: ngày tuyệt đối.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { docDuLieuSoan } from "../../lib/hoa-hong/chinh-sach-doc";
import { goiYVaiVoiNguon } from "../../lib/hoa-hong/goi-y-nguoi-huong";
import { MASTER_VAI_HUONG } from "../../lib/hoa-hong/vai-huong";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { donKichBan, dungKichBan, lamNhanVien, nguoiKyHo, type KichBan } from "./_kich-ban";
import { baoDamNguoiPhuTrach, chinhSachNguonQuaService, chiTietChanKichHoat, doiTrangThaiNguon, donNguoiPhuTrach, lamSachChinhSach, rule, taoNguon } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[CSN-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NHAN = "fx-csn";
// Mỗi lượt chạy một hậu tố riêng: `lamNhanVien` TẠO Employee mới theo userId, nên email cố định ⇒ lượt chạy lại va `employeeCode` (luật 18: chạy được nhiều lần trên cùng DB).
const LUOT = Date.now().toString(36);
const NOW = new Date("2026-10-09T03:00:00.000Z");
const LY_DO = "Chủ dự án chốt ngày 09/10/2026";
const cuaToi: KichBan[] = [];
let admin: { userId: string; ten: string };
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
  commissionEnabled: true,
  ownerOrgUnitId: null,
  ownerEmployeeId: null,
  effectiveFrom: null,
  effectiveTo: null,
} as const;

async function taoNguonCsn(hau: string, ghi: Record<string, unknown> = {}) {
  stamp += 1;
  const code = `CSN_${hau}_${Date.now().toString(36).toUpperCase()}${stamp}`;
  const r = await taoNguon({ nguoi: admin, vao: { ...MAU, code, name: `CSN ${hau}`, ...ghi } });
  if (!r.ok) throw new Error(`taoNguon(${hau}): ${r.truong}: ${r.loi}`);
  return { id: r.id, code: r.code };
}
const moiNhat = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).updatedAt;

describe.skipIf(!RUN_DB_TESTS)("[CSN-DB] dữ liệu soạn chính sách × nguồn do admin tạo", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO"], vai: ["HO_ACCOUNTANT"] });
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    clearSettingsCache();
    const u = await seedUser({ email: `${NHAN}-admin@ci.test`, role: "MARKETING", name: `${NHAN}-admin`, phone: null });
    admin = { userId: u.id, ten: `${NHAN}-admin` };
  }, 120_000);

  afterAll(async () => {
    await donKichBan(cuaToi);
    // [CSN-DB-04] gán người phụ trách cho MỌI cơ sở (nhãn NHAN) — phải dọn, nếu không các spec sau đòi «chưa khai người» sẽ đỏ khi chạy chung một DB (NHH-POL-09, NHH-RES-DB-02, NHH-SEED-DB-05).
    await donNguoiPhuTrach(NHAN);
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "CSN_" } } });
    await db.auditLog.deleteMany({ where: { entityType: "LeadSourceGroup", actorName: { startsWith: NHAN } } });
    await damBaoDanhMucGoc(db);
  }, 90_000);

  it("[CSN-DB-01] mỗi trạng thái nguồn → đúng khoá trạng thái; UNKNOWN không có mặt; hạn tính theo `now` truyền vào (không đồng hồ thật)", async () => {
    const ho = (await nguoiKyHo()).quyen;
    const hd = await taoNguonCsn("HD");
    const het = await taoNguonCsn("HET", { effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: new Date("2026-06-01T00:00:00.000Z") });
    const chua = await taoNguonCsn("CHUA", { effectiveFrom: new Date("2026-12-01T00:00:00.000Z"), effectiveTo: null });
    const nhap = await taoNguonCsn("NHAP", { trangThai: "DRAFT" });
    const ngung = await taoNguonCsn("NGUNG");
    expect((await doiTrangThaiNguon({ nguoi: admin, id: ngung.id, updatedAtDaThay: await moiNhat(ngung.id), den: "INACTIVE", lyDo: LY_DO })).ok).toBe(true);
    const luuTru = await taoNguonCsn("LT");
    expect((await doiTrangThaiNguon({ nguoi: admin, id: luuTru.id, updatedAtDaThay: await moiNhat(luuTru.id), den: "INACTIVE", lyDo: LY_DO })).ok).toBe(true);
    expect((await doiTrangThaiNguon({ nguoi: admin, id: luuTru.id, updatedAtDaThay: await moiNhat(luuTru.id), den: "ARCHIVED", lyDo: LY_DO })).ok).toBe(true);

    const dl = await docDuLieuSoan(ho, NOW);
    const t = (x: { code: string }) => dl.nhomNguon.find((n) => n.code === x.code)?.trangThai;
    expect(t(hd)).toBe("HOAT_DONG");
    expect(t(het)).toBe("HET_HAN");
    expect(t(chua)).toBe("CHUA_HIEU_LUC");
    expect(t(nhap)).toBe("NHAP");
    expect(t(ngung)).toBe("NGUNG");
    expect(t(luuTru)).toBe("LUU_TRU");
    expect(dl.nhomNguon.map((n) => n.code)).not.toContain("UNKNOWN");
    // cùng dữ liệu, `now` khác ⇒ trạng thái đổi: nguồn «hết hạn» ngày 01/06 còn HOẠT ĐỘNG nếu hỏi vào 01/03 (hạn là hàm của `now`, không của đồng hồ)
    const som = await docDuLieuSoan(ho, new Date("2026-03-01T03:00:00.000Z"));
    expect(som.nhomNguon.find((n) => n.code === het.code)?.trangThai).toBe("HOAT_DONG");
  });

  it("[CSN-DB-02] cờ hoa hồng · người phụ trách · kiểu người giới thiệu đi theo dòng master", async () => {
    const ho = (await nguoiKyHo()).quyen;
    const chuUser = await seedUser({ email: `${NHAN}-${LUOT}-chu@ci.test`, role: "SALES_CSM", name: `${NHAN}-chu`, phone: null });
    const employeeId = await lamNhanVien(chuUser.id, `${NHAN}-chu`);
    const a = await taoNguonCsn("TAT", { commissionEnabled: false });
    const b = await taoNguonCsn("CHU", { ownerEmployeeId: employeeId, referrerRequirement: "PARENT" });
    const dl = await docDuLieuSoan(ho, NOW);
    expect(dl.nhomNguon.find((n) => n.code === a.code)).toMatchObject({ coHoaHong: false, coNguoiPhuTrach: false, referrerRequirement: "NONE" });
    expect(dl.nhomNguon.find((n) => n.code === b.code)).toMatchObject({ coHoaHong: true, coNguoiPhuTrach: true, referrerRequirement: "PARENT" });
  });

  it("[CSN-DB-03] vai master mang resolverKey + isAcquisition khớp MASTER_VAI_HUONG (hai vai mới có khoá riêng)", async () => {
    const ho = (await nguoiKyHo()).quyen;
    const dl = await docDuLieuSoan(ho, NOW);
    for (const m of MASTER_VAI_HUONG) {
      const v = dl.vai.find((x) => x.code === m.code);
      expect(v, m.code).toMatchObject({ resolverType: m.resolverType, resolverKey: m.resolverKey, isAcquisition: m.isAcquisition });
    }
    expect(dl.vai.find((v) => v.code === "REFERRER_PARENT_SALE")?.resolverKey).toBe("REFERRER_PARENT_SALE");
    expect(dl.vai.find((v) => v.code === "SOURCE_OWNER")?.resolverType).toBe("SOURCE_OWNER");
  });

  it("[CSN-DB-04] gợi ý vai × nguồn KHỚP guardrail thật trên dữ liệu thật: nguồn thiếu chủ ⇒ cả hai báo NGUON_CHUA_CO_NGUOI_PHU_TRACH; có chủ ⇒ cả hai im", async () => {
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    const k = await dungKichBan("csn04", { rules: [{ vai: "SALE", rate: 0.04 }] });
    cuaToi.push(k);
    const ho = (await nguoiKyHo()).quyen;
    const chuUser = await seedUser({ email: `${NHAN}-${LUOT}-chu4@ci.test`, role: "SALES_CSM", name: `${NHAN}-chu4`, phone: null });
    const employeeId = await lamNhanVien(chuUser.id, `${NHAN}-chu4`);
    const thieu = await taoNguonCsn("THIEU");
    const du = await taoNguonCsn("DU", { ownerEmployeeId: employeeId });

    for (const [nguon, coLoi] of [[thieu, true], [du, false]] as const) {
      const cs = await chinhSachNguonQuaService(k, { hau: nguon.code.toLowerCase(), sourceGroupId: nguon.id, rules: [rule("SOURCE_OWNER", 0.015)] });
      const chan = (await chiTietChanKichHoat(cs.versionId)).map((x) => x.ma);
      const dl = await docDuLieuSoan(ho, NOW);
      const goiY = goiYVaiVoiNguon({ vai: dl.vai.filter((v) => v.code === "SOURCE_OWNER"), phamVi: { loai: "SOURCE_GROUP", sourceGroupId: nguon.id }, nguon: dl.nhomNguon }).map((x) => x.ma);
      expect(chan.includes("NGUON_CHUA_CO_NGUOI_PHU_TRACH"), nguon.code).toBe(coLoi);
      expect(goiY.includes("NGUON_CHUA_CO_NGUOI_PHU_TRACH"), nguon.code).toBe(coLoi);
    }
  });
});
