// @vitest-environment node
/**
 * [PHT-DB-*] PHỤ HUYNH TỰ THAM GIA chương trình giới thiệu (`lib/affiliate/doi-tac-phu-huynh.ts`) — Postgres thật.
 *
 * Chủ dự án chốt 25/11/2026: phụ huynh cũng phải đồng ý quy định, và tự lấy link được — KHÔNG cần Admin thêm làm đối tác, KHÔNG có bước duyệt.
 * Cấu hình suy từ DỮ LIỆU: nguồn kiểu PARENT ⇒ đúng một loại đang bật + đúng một campaign đang chạy có nguồn mặc định là nó. Bộ này đổi nhóm nguồn RIÊNG của fixture sang PARENT.
 *
 *   [PHT-DB-01] chương trình phụ huynh CHƯA mở (nguồn của campaign không phải PARENT) ⇒ trang KHONG_CO, không menu, đồng ý bị từ chối, KHÔNG tạo hồ sơ nào.
 *   [PHT-DB-02] mở ⇒ menu có + trang hiện quy định (số của CHƯƠNG TRÌNH); đồng ý ⇒ hồ sơ ACTIVE (loại «cần duyệt» vẫn vào thẳng) + tài khoản là NGƯỜI ĐẠI DIỆN + membership ACTIVE
 *               + dấu đồng ý; trang thành DOI_TAC; đồng ý lại KHÔNG đẻ thêm; mã KHÔNG chứa SĐT.
 *   [PHT-DB-03] đồng ý xong ⇒ tạo link được ngay bằng chính lõi của cổng (`tuTaoLink`).
 *   [PHT-DB-04] tài khoản NHÂN VIÊN ⇒ từ chối TRƯỚC khi tạo gì (0 hồ sơ mồ côi).
 *   [PHT-DB-05] TẠM NGỪNG hồ sơ tự tạo ⇒ BI_CHAN; đồng ý KHÔNG mở lại, KHÔNG tạo hồ sơ thứ hai. Cổng bị tạm ngừng ⇒ cũng BI_CHAN.
 *   [PHT-DB-06] phụ huynh ĐÃ là đối tác (Admin thêm) ⇒ trang DOI_TAC như cũ, đồng ý không đụng gì.
 *   [PHT-DB-07] cờ Affiliate tắt ⇒ KHONG_CO + không menu (đối chứng: bật lại ⇒ có).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import { coMucGioiThieu, docCauHinhPhuHuynh, docTrangGioiThieuPhuHuynh, LOI_CHUA_CAU_HINH_PH, LY_DO_PH_BI_CHAN, thamGiaGioiThieuPhuHuynh } from "../../lib/affiliate/doi-tac-phu-huynh";
import { tuTaoLink } from "../../lib/affiliate/tu-tao-link";
import { db } from "../../lib/db";
import { clearSettingsCache } from "../../lib/settings/service";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, datCoNguon } from "../lead-intake/_nguon-fixture";
import { donAffiliateFx, dungChuoi, hau, type Chuoi } from "./_affiliate-so-fx";

if (!RUN_DB_TESTS) console.warn(`[PHT-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = new Date("2026-11-25T03:00:00.000Z");
const TIEN_TO_EMAIL = "pht-db-";
let demSdt = 0;
/** SĐT riêng mỗi tài khoản (`User.phone` UNIQUE) — 10 số, đầu 09. */
const sdtMoi = () => `0977${String(Date.now() % 10000).padStart(4, "0")}${String(++demSdt).padStart(2, "0")}`;
let x: Chuoi;

async function taoPhuHuynh(ten: string, role: "PARENT" | "SALES_CSM" = "PARENT") {
  return seedUser({ email: `${TIEN_TO_EMAIL}${ten}-${hau().toLowerCase()}@ci.test`, role, name: `PH PHT ${ten}`, phone: sdtMoi() });
}
const nguoi = (u: { id: string }) => ({ userId: u.id, ten: "PH PHT" });
const hoSoTuTao = (userId: string) => db.affiliate.findMany({ where: { createdById: userId }, select: { id: true, code: true, status: true, typeId: true, phone: true } });

async function moChuongTrinh(mo: boolean) {
  await db.leadSourceGroup.update({ where: { id: x.nhomId }, data: { referrerRequirement: mo ? "PARENT" : "NONE" } });
}

describe.skipIf(!RUN_DB_TESTS)("[PHT-DB] phụ huynh tự tham gia — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    x = await dungChuoi({ tenCampaign: "Chiến dịch PHT phụ huynh" });
    // Loại «CẦN DUYỆT» có chủ đích: tự tham gia phải vào thẳng dù loại đặt duyệt.
    await db.affiliateType.update({ where: { id: x.loai.id }, data: { requiresApproval: true, isActive: true, defaultSourceGroupId: x.nhomId } });
    await datCoNguon({ ...CO_NGUON_DAY_DU, affiliate: true });
  }, 180_000);

  afterAll(async () => {
    const u = await db.user.findMany({ where: { email: { startsWith: TIEN_TO_EMAIL } }, select: { id: true } });
    const uid = u.map((v) => v.id);
    const dtIds = (await db.affiliate.findMany({ where: { createdById: { in: uid } }, select: { id: true } })).map((d) => d.id);
    await db.affiliateTrackingAsset.deleteMany({ where: { partyId: { in: dtIds } } });
    await db.affiliateMembership.deleteMany({ where: { partyId: { in: dtIds } } });
    await db.affiliatePartyUser.deleteMany({ where: { OR: [{ partyId: { in: dtIds } }, { userId: { in: uid } }] } });
    await db.affiliate.deleteMany({ where: { id: { in: dtIds } } });
    await donAffiliateFx();
    await db.user.deleteMany({ where: { id: { in: uid } } });
    await db.systemSetting.deleteMany({ where: { key: { in: ["affiliate.enabled"] } } });
    await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
    clearSettingsCache();
  }, 180_000);

  it("[PHT-DB-01] chương trình CHƯA mở ⇒ KHONG_CO, không menu, đồng ý bị từ chối, không tạo gì", async () => {
    await moChuongTrinh(false);
    const u = await taoPhuHuynh("chua-mo");
    expect(await docCauHinhPhuHuynh()).toBeNull();
    expect(await docTrangGioiThieuPhuHuynh(u.id, NOW)).toEqual({ loai: "KHONG_CO" });
    expect(await coMucGioiThieu(u.id)).toBe(false);
    expect(await thamGiaGioiThieuPhuHuynh({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: false, loi: LOI_CHUA_CAU_HINH_PH });
    expect(await hoSoTuTao(u.id)).toHaveLength(0);
    await moChuongTrinh(true);
    expect(await docCauHinhPhuHuynh()).toEqual({ typeId: x.loai.id, campaignId: x.campaign.id }); // đối chứng dương
  });

  it("[PHT-DB-02] mở ⇒ quy định; đồng ý ⇒ hồ sơ ACTIVE + đại diện + membership ACTIVE + dấu đồng ý; đồng ý lại không đẻ thêm", async () => {
    await moChuongTrinh(true);
    const u = await taoPhuHuynh("a");
    expect(await coMucGioiThieu(u.id)).toBe(true);
    expect(await docTrangGioiThieuPhuHuynh(u.id, NOW)).toMatchObject({ loai: "CHUA_THAM_GIA", quyDinh: { nhoKhachNgay: 30, baoVeNgay: 90 } });

    expect(await thamGiaGioiThieuPhuHuynh({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: true });
    const ds = await hoSoTuTao(u.id);
    expect(ds).toHaveLength(1);
    const dt = ds[0]!;
    expect(dt).toMatchObject({ status: "ACTIVE", typeId: x.loai.id }); // loại «cần duyệt» vẫn vào thẳng
    expect(dt.code).toMatch(/^PH[2-9A-HJKMNP-Z]{6}$/);
    const sdt = (await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { phone: true } })).phone!;
    expect(dt.code).not.toContain(sdt.slice(-4)); // mã KHÔNG suy từ SĐT (mã nằm trong link gửi đi)
    const dong = await db.affiliatePartyUser.findUniqueOrThrow({ where: { partyId_userId: { partyId: dt.id, userId: u.id } }, select: { role: true, status: true } });
    expect(dong).toEqual({ role: "REPRESENTATIVE", status: "ACTIVE" });
    const mem = await db.affiliateMembership.findUniqueOrThrow({ where: { partyId_campaignId: { partyId: dt.id, campaignId: x.campaign.id } }, select: { status: true } });
    expect(mem.status).toBe("ACTIVE");
    expect(await db.auditLog.count({ where: { entityType: "Affiliate", entityId: dt.id, action: "AFFILIATE_PHU_HUYNH_DONG_Y_QUY_DINH" } })).toBe(1);
    expect((await docTrangGioiThieuPhuHuynh(u.id, NOW)).loai).toBe("DOI_TAC");

    expect(await thamGiaGioiThieuPhuHuynh({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: true });
    expect(await hoSoTuTao(u.id)).toHaveLength(1);
  });

  it("[PHT-DB-03] đồng ý xong ⇒ tạo link được ngay bằng lõi của cổng", async () => {
    await moChuongTrinh(true);
    const u = await taoPhuHuynh("link");
    expect(await thamGiaGioiThieuPhuHuynh({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: true });
    const dt = (await hoSoTuTao(u.id))[0]!;
    const mem = await db.affiliateMembership.findUniqueOrThrow({ where: { partyId_campaignId: { partyId: dt.id, campaignId: x.campaign.id } }, select: { id: true } });
    const trang = await db.affiliateLandingPage.findFirstOrThrow({ where: { siteId: x.site.id }, select: { id: true, pathPattern: true } });
    const kq = await tuTaoLink({ nguoi: nguoi(u), vao: { membershipId: mem.id, siteId: x.site.id, landingPageId: trang.id, landingPath: trang.pathPattern, label: null }, now: NOW });
    expect(kq).toMatchObject({ ok: true });
    expect(await db.affiliateTrackingAsset.count({ where: { partyId: dt.id, status: "ACTIVE" } })).toBe(1);
  });

  it("[PHT-DB-04] tài khoản NHÂN VIÊN ⇒ từ chối trước khi tạo gì", async () => {
    await moChuongTrinh(true);
    const u = await taoPhuHuynh("nv", "SALES_CSM");
    const kq = await thamGiaGioiThieuPhuHuynh({ nguoi: nguoi(u), now: NOW });
    expect(kq.ok).toBe(false);
    expect(await hoSoTuTao(u.id)).toHaveLength(0);
  });

  it("[PHT-DB-05] tạm ngừng hồ sơ tự tạo / tạm ngừng cổng ⇒ BI_CHAN; đồng ý không mở lại, không tạo hồ sơ thứ hai", async () => {
    await moChuongTrinh(true);
    const u = await taoPhuHuynh("chan");
    expect(await thamGiaGioiThieuPhuHuynh({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: true });
    const dt = (await hoSoTuTao(u.id))[0]!;

    // (a) cổng bị tạm ngừng (đối tác còn ACTIVE)
    await db.affiliatePartyUser.update({ where: { partyId_userId: { partyId: dt.id, userId: u.id } }, data: { status: "SUSPENDED", statusReason: "Tạm ngừng để thử nghiệm PHT" } });
    expect(await docTrangGioiThieuPhuHuynh(u.id, NOW)).toEqual({ loai: "BI_CHAN", lyDo: LY_DO_PH_BI_CHAN });
    expect(await thamGiaGioiThieuPhuHuynh({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: false, loi: LY_DO_PH_BI_CHAN });
    expect(await hoSoTuTao(u.id)).toHaveLength(1);

    // (b) hồ sơ bị tạm ngừng, cổng bị gỡ
    await db.affiliatePartyUser.update({ where: { partyId_userId: { partyId: dt.id, userId: u.id } }, data: { status: "REVOKED", statusReason: "Gỡ liên kết để thử nghiệm PHT", revokedAt: NOW } });
    await db.affiliate.update({ where: { id: dt.id }, data: { status: "SUSPENDED" } });
    expect(await docTrangGioiThieuPhuHuynh(u.id, NOW)).toEqual({ loai: "BI_CHAN", lyDo: LY_DO_PH_BI_CHAN });
    expect(await thamGiaGioiThieuPhuHuynh({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: false, loi: LY_DO_PH_BI_CHAN });
    expect(await hoSoTuTao(u.id)).toHaveLength(1);
    expect((await db.affiliate.findUniqueOrThrow({ where: { id: dt.id }, select: { status: true } })).status).toBe("SUSPENDED");
  });

  it("[PHT-DB-06] đã là đối tác (Admin thêm) ⇒ DOI_TAC như cũ; đồng ý không đụng gì", async () => {
    await moChuongTrinh(true);
    const u = await taoPhuHuynh("co-san");
    await db.affiliatePartyUser.create({ data: { partyId: x.doiTac.id, userId: u.id, role: "MEMBER", status: "ACTIVE", grantedAt: NOW } });
    expect((await docTrangGioiThieuPhuHuynh(u.id, NOW)).loai).toBe("DOI_TAC");
    expect(await thamGiaGioiThieuPhuHuynh({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: true });
    expect(await hoSoTuTao(u.id)).toHaveLength(0);
    await db.affiliatePartyUser.deleteMany({ where: { userId: u.id } });
  });

  it("[PHT-DB-07] cờ Affiliate tắt ⇒ KHONG_CO + không menu; bật lại ⇒ có", async () => {
    await moChuongTrinh(true);
    const u = await taoPhuHuynh("co");
    await datCoNguon({ ...CO_NGUON_DAY_DU, affiliate: false });
    expect(await coMucGioiThieu(u.id)).toBe(false);
    expect(await docTrangGioiThieuPhuHuynh(u.id, NOW)).toEqual({ loai: "KHONG_CO" });
    await datCoNguon({ ...CO_NGUON_DAY_DU, affiliate: true });
    expect(await coMucGioiThieu(u.id)).toBe(true);
  });
});
