// @vitest-environment node
/**
 * [SRC-INT-82] — LEAD NHÃN CŨ ĐẠI DIỆN của đường tường minh `uat-nap-lead-cu-*` (lane F5, 20/10/2026) trên Postgres THẬT.
 *
 * Bối cảnh: DB TEST đã ĐẶT MỐC CUTOVER nên bộ nạp chung bỏ qua lead nhãn cũ ⇒ UAT không còn lead nào chưa quy nguồn để backfill. Ca này dựng ĐÚNG hiện trường đó (mốc đã đặt) rồi chứng minh đường mới:
 *
 *   [SRC-INT-82a] mốc cutover ĐÃ ĐẶT mà đường mới vẫn tạo đủ 16 lead (dry-run trước đó không ghi gì và báo SE_TAO cả 16); lead mang đúng nhãn · ngày · cơ sở · tiền tố; KHÔNG có quy nguồn / touchpoint
 *   [SRC-INT-82b] idempotent: nạp lần hai báo DA_CO 16 / 16, không sinh thêm dòng nào
 *   [SRC-INT-82c] đọc bằng đường ĐỌC THẬT của lượt vét lead cũ (`docDuLieuDiTru`): 16 lead vào kế hoạch, mỗi lead ra đúng nhóm + lý do xem tay, phân hoạch 8 tự động + 8 xem tay, 0 INVALID, 0 trùng SĐT
 *   [SRC-INT-82d] ĐỐI CHỨNG: `--den` đứng TRƯỚC ngày tạo ⇒ kế hoạch rỗng (ngày ở quá khứ là điều kiện để vào lượt vét, không phải trang trí)
 *   [SRC-INT-82e] không sửa / không xoá lead có sẵn (lead đối chứng giữ nguyên `updatedAt`); không đụng mốc cutover, cờ, chính sách
 *
 * LUẬT 18: toàn bộ luồng ở `beforeAll`, ca chỉ đọc kết quả. LUẬT 19: mọi ngày là mốc tuyệt đối. AN TOÀN DB: không `resetDb()` (cả thư mục dùng chung một DB); chỉ dọn đúng dải SĐT 09907 + lead đối chứng của ca này.
 * Chạy: `pnpm test:hoa-hong-db` (DB đã `migrate deploy`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { anhXaNhanCu, tomTatDiTru } from "../../lib/nguon/anh-xa-nhan-cu";
import { docDuLieuDiTru } from "../../lib/nguon/di-tru-db";
import { docMocCutover } from "../../lib/hoa-hong/cutover";
import { LEAD_CU_DAI_DIEN, TIEN_TO_NGUON_FINAL, lopLeadCuDaiDien, phoneLeadCuDaiDien } from "../../lib/uat/nguon-final";
import { napLeadCuDaiDien } from "../../lib/uat/nguon-final-lead-cu";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb } from "../e2e/_helpers/seed";
import { damBaoDanhMucGoc, damBaoToChuc } from "../lead-intake/_nguon-fixture";
import { datMocCutover } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[SRC-INT-82] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const MOC = "2031-05";
const DEN_SAU = new Date("2026-10-12T00:00:00.000Z");
const DEN_TRUOC = new Date("2026-09-01T00:00:00.000Z");
const PHONE_DOI_CHUNG = "0990800001";
const TEN_DOI_CHUNG = `${TIEN_TO_NGUON_FINAL} · F5 lead đối chứng`;
const DAI_SDT = LEAD_CU_DAI_DIEN.map((l) => phoneLeadCuDaiDien(l.ma));

async function don(): Promise<void> {
  const ls = await db.lead.findMany({ where: { phone: { in: [...DAI_SDT, PHONE_DOI_CHUNG] } }, select: { id: true } });
  const ids = ls.map((l) => l.id);
  if (ids.length > 0) {
    await db.leadTouchpoint.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadAttribution.deleteMany({ where: { leadId: { in: ids } } });
    await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
}

type Muc = Awaited<ReturnType<typeof napLeadCuDaiDien>>;
let cs1Id = "";
let mocTruoc: string | null = null;
let mocBanDau: string | null = null;
let mocSau: string | null = null;
let demDryRun = -1;
let dryRun: Muc;
let lan1: Muc;
let lan2: Muc;
let demSauLan1 = -1;
let demSauLan2 = -1;
let ketQuaDoc: { hang: Awaited<ReturnType<typeof docDuLieuDiTru>>["hang"]; daCoQuyNguon: number; trungSdt: Set<string> } | null = null;
let hangRongKhiDenTruoc = -1;
let phoneTheoId = new Map<string, string>();
let doiChungTruoc: { updatedAt: Date; source: string | null; deletedAt: Date | null } | null = null;
let doiChungSau: { updatedAt: Date; source: string | null; deletedAt: Date | null } | null = null;
const soSetting = { truoc: 0, sau: 0 };

const demLead = () => db.lead.count({ where: { phone: { in: DAI_SDT } } });
const nhomTrangThai = (m: Muc) => new Set(m.map((x) => x.trangThai));

describe.skipIf(!RUN_DB_TESTS)("[SRC-INT-82] lead nhãn cũ ĐẠI DIỆN — đường tường minh `uat-nap-lead-cu-*`", () => {
  beforeAll(async () => {
    assertTestDb();
    await don();
    await damBaoToChuc({ vai: [] });
    await damBaoDanhMucGoc(db);
    cs1Id = (await db.center.findFirstOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;

    // Hiện trường của DB TEST: mốc cutover ĐÃ ĐẶT + một lead có sẵn (đối chứng "không sửa lead có sẵn").
    mocBanDau = await docMocCutover(db);
    await datMocCutover(MOC);
    mocTruoc = await docMocCutover(db);
    await db.lead.create({ data: { parentName: TEN_DOI_CHUNG, phone: PHONE_DOI_CHUNG, status: "MOI", source: "Website", centerId: cs1Id, createdAt: new Date("2026-09-05T03:00:00.000Z") } });
    doiChungTruoc = await db.lead.findFirstOrThrow({ where: { phone: PHONE_DOI_CHUNG }, select: { updatedAt: true, source: true, deletedAt: true } });
    soSetting.truoc = await db.systemSetting.count();

    dryRun = await napLeadCuDaiDien({ apply: false, centerId: cs1Id });
    demDryRun = await demLead();
    lan1 = await napLeadCuDaiDien({ apply: true, centerId: cs1Id });
    demSauLan1 = await demLead();
    lan2 = await napLeadCuDaiDien({ apply: true, centerId: cs1Id });
    demSauLan2 = await demLead();

    // Đường ĐỌC THẬT của lượt vét lead cũ (cùng hàm báo cáo + lệnh ghi dùng), chỉ trong phạm vi lead của ca này.
    const leads = await db.lead.findMany({ where: { phone: { in: DAI_SDT } }, select: { id: true, phone: true } });
    phoneTheoId = new Map(leads.map((l) => [l.id, l.phone]));
    const leadIds = leads.map((l) => l.id);
    const doc = (den: Date) => db.$transaction((tx) => docDuLieuDiTru(tx, { coBangQuyNguon: true, phamVi: { leadIds }, den }));
    const r = await doc(DEN_SAU);
    ketQuaDoc = { hang: r.hang, daCoQuyNguon: r.daCoQuyNguon, trungSdt: r.trungSdt };
    hangRongKhiDenTruoc = (await doc(DEN_TRUOC)).hang.length;

    mocSau = await docMocCutover(db);
    doiChungSau = await db.lead.findFirstOrThrow({ where: { phone: PHONE_DOI_CHUNG }, select: { updatedAt: true, source: true, deletedAt: true } });
    soSetting.sau = await db.systemSetting.count();
  }, 300_000);

  afterAll(async () => {
    await don();
    await datMocCutover(mocBanDau);
  }, 120_000);

  it("[SRC-INT-82a] mốc cutover ĐÃ ĐẶT mà đường mới vẫn tạo đủ lead; dry-run không ghi gì; lead mang đúng nhãn · ngày · cơ sở · tên; KHÔNG có quy nguồn / touchpoint", async () => {
    expect(mocTruoc, "tiền đề: mốc đã đặt (đúng hiện trường DB TEST)").toBe(MOC);
    expect(dryRun).toHaveLength(LEAD_CU_DAI_DIEN.length);
    expect(nhomTrangThai(dryRun)).toEqual(new Set(["SE_TAO"]));
    expect(demDryRun, "dry-run không được ghi").toBe(0);
    expect(nhomTrangThai(lan1)).toEqual(new Set(["DA_TAO"]));
    expect(demSauLan1).toBe(LEAD_CU_DAI_DIEN.length);
    for (const lc of LEAD_CU_DAI_DIEN) {
      const l = await db.lead.findFirstOrThrow({ where: { phone: phoneLeadCuDaiDien(lc.ma), deletedAt: null }, select: { id: true, parentName: true, source: true, createdAt: true, centerId: true, status: true, attribution: { select: { id: true } } } });
      expect(l.source, lc.ma).toBe(lc.nhan);
      expect(l.createdAt.toISOString(), lc.ma).toBe(lc.taoLuc.toISOString());
      expect(l.centerId, lc.ma).toBe(cs1Id);
      expect(l.parentName.startsWith(TIEN_TO_NGUON_FINAL), lc.ma).toBe(true);
      expect(l.attribution, `${lc.ma} phải CHƯA có quy nguồn`).toBeNull();
      expect(await db.leadTouchpoint.count({ where: { leadId: l.id } }), `${lc.ma}: không touchpoint`).toBe(0);
    }
  });

  it("[SRC-INT-82b] idempotent: nạp lần hai báo DA_CO cho cả bộ và không sinh thêm lead nào", () => {
    expect(nhomTrangThai(lan2)).toEqual(new Set(["DA_CO"]));
    expect(lan2).toHaveLength(LEAD_CU_DAI_DIEN.length);
    expect(demSauLan2).toBe(demSauLan1);
  });

  it("[SRC-INT-82c] đọc bằng đường THẬT của lượt vét lead cũ: 16 lead vào kế hoạch, mỗi lead đúng nhóm + lý do xem tay; phân hoạch 8 tự động + 8 xem tay; 0 INVALID; 0 trùng SĐT; 0 đã có quy nguồn", () => {
    expect(ketQuaDoc).not.toBeNull();
    const { hang, daCoQuyNguon, trungSdt } = ketQuaDoc!;
    expect(hang).toHaveLength(LEAD_CU_DAI_DIEN.length);
    expect(daCoQuyNguon).toBe(0);
    expect(trungSdt.size).toBe(0);
    for (const h of hang) {
      const ma = LEAD_CU_DAI_DIEN.find((l) => phoneLeadCuDaiDien(l.ma) === phoneTheoId.get(h.leadId));
      expect(ma, `lead ${h.leadId} phải thuộc bộ`).toBeDefined();
      expect(h.kq.loai, ma!.ma).not.toBe("INVALID");
      if (h.kq.loai === "INVALID") continue;
      expect(h.kq.nhom, `${ma!.ma}: nhóm`).toBe(ma!.nhom);
      expect(h.kq.xemTay, `${ma!.ma}: xem tay`).toEqual(ma!.xemTay === null ? [] : [ma!.xemTay]);
      // đọc từ DB ra phải CÙNG kết quả với luật thuần trên dữ liệu fixture (không lệch ở cột createdAt / source / người nhập)
      expect(h.kq, ma!.ma).toEqual(anhXaNhanCu({ nhan: ma!.nhan, createdAt: ma!.taoLuc, affiliate: null, nguoiNhap: null, maNvTrongNote: null }, [], "EMPLOYEE_REFERRAL"));
    }
    const t = tomTatDiTru(hang, trungSdt);
    expect(t).toMatchObject({ total: 16, invalid: 0, duplicate: 0, unknown: 0, mapped: 8, manualReview: 8, seGhi: 16 });
    expect(t.xemTayTheoLyDo).toMatchObject({ THIEU_NGUOI: 4, MA_NV_KHONG_GIAI: 1, NHAN_CHOT_THEO_PHIEU: 3 });
    expect(LEAD_CU_DAI_DIEN.filter((l) => lopLeadCuDaiDien(l) === "AUTO")).toHaveLength(t.mapped);
  });

  it("[SRC-INT-82d] ĐỐI CHỨNG: `--den` đứng TRƯỚC ngày tạo ⇒ không lead nào vào kế hoạch (ngày tạo ở quá khứ là điều kiện để vào lượt vét)", () => {
    expect(hangRongKhiDenTruoc).toBe(0);
  });

  it("[SRC-INT-82e] không sửa / không xoá lead có sẵn; không đụng mốc cutover; không ghi SystemSetting nào", () => {
    expect(doiChungSau).toEqual(doiChungTruoc);
    expect(mocSau, "mốc cutover phải GIỮ NGUYÊN").toBe(MOC);
    expect(soSetting.sau, "không dòng cấu hình nào được thêm/bớt").toBe(soSetting.truoc);
  });
});
