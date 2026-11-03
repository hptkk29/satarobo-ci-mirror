/**
 * [HDM-DB] ẨN MỤC ĐÃ ĐÓNG KHỎI DANH SÁCH MẶC ĐỊNH — Postgres thật (chủ dự án 28/10/2026: «PROD không được hiện data rác»).
 *
 * Bốn danh sách của tab Affiliate đều mặc định chỉ hiện mục ĐANG DÙNG; mục đã đóng nằm sau chip riêng (đối tác `ENDED` · campaign `ENDED` · link `REVOKED`)
 * hoặc nút «Hiện cả loại đã ngừng» (loại `isActive = false`). Dữ liệu và audit KHÔNG đổi — chỉ đổi cái màn hình hiện mặc định.
 *
 *   [HDM-DB-01] đối tác: không chọn trạng thái ⇒ KHÔNG có `ENDED`; chọn `ENDED` ⇒ thấy; số chip theo trạng thái vẫn đếm đủ (để chip «Đã kết thúc (n)» đúng)
 *   [HDM-DB-02] campaign: như trên với `ENDED`
 *   [HDM-DB-03] link: như trên với `REVOKED`
 *   [HDM-DB-04] loại: `hienDaNgung:false` ⇒ ẩn loại ngừng, `tong` khớp số hàng; `hienDaNgung:true` ⇒ thấy đủ; `soDaNgung` đếm cả khi đang ẩn
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `FXHDM`; chỉ chạy trên Postgres cục bộ không phải DB đang phục vụ dev server.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import type { Actor } from "../../lib/auth/actor";
import { db } from "../../lib/db";
import { laDbCucBo } from "../../lib/security/url-db-cuc-bo";
import { LY_DO_BO_QUA, RUN_DB_TESTS } from "../_helpers/db-gate";
import { docDanhSachCampaign } from "../../lib/affiliate/doc-campaign";
import { KICH_THUOC_TRANG_AFFILIATE, docDanhSachDoiTac, docDanhSachLoai } from "../../lib/affiliate/doc-doi-tac";
import { docDanhSachLink } from "../../lib/affiliate/doc-link";
import { sinhToken } from "../../lib/affiliate/token";

if (!RUN_DB_TESTS) console.warn(`[HDM-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "fxhdm";
const MA = "FXHDM";
const NOW = new Date("2026-10-28T03:00:00.000Z");

let dem = 0;
const hau = () => `${Date.now().toString(36).toUpperCase()}${(dem += 1)}`;

async function assertDbThu(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!laDbCucBo(url)) throw new Error("[HDM-DB] TỪ CHỐI: DATABASE_URL không trỏ Postgres cục bộ (hoặc là tunnel VPS).");
  const r = await db.$queryRaw<{ ten: string }[]>`select current_database() as ten`;
  const ten = r[0]?.ten ?? "";
  if (/^(satarobo_local|satarobo_dev)/.test(ten)) throw new Error(`[HDM-DB] TỪ CHỐI: database "${ten}" là DB đang phục vụ dev server.`);
}

async function don(): Promise<void> {
  const ds = await db.affiliate.findMany({ where: { code: { startsWith: MA } }, select: { id: true } });
  const ids = ds.map((x) => x.id);
  await db.affiliateTrackingAsset.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateMembership.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliate.deleteMany({ where: { id: { in: ids } } });
  await db.affiliateCampaign.deleteMany({ where: { code: { startsWith: MA } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: MA } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: MA } } });
}

const actor = { isSuperAdmin: true, visibleCenterIds: "ALL", centerScope: "ALL", roles: [], permissions: [] } as unknown as Actor;
const LOC = { trang: 1, kichThuoc: KICH_THUOC_TRANG_AFFILIATE, trangThai: null, loaiMa: null, tuKhoa: P, coTheXemLienHe: true } as const;

describe.skipIf(!RUN_DB_TESTS)("[HDM-DB] danh sách Affiliate mặc định ẨN mục đã đóng — Postgres thật", () => {
  beforeEach(async () => {
    await assertDbThu();
    await don();
  }, 60_000);
  afterAll(async () => {
    await don();
  }, 60_000);

  it("[HDM-DB-01] đối tác: mặc định KHÔNG hiện ENDED; chọn ENDED thì thấy; số chip theo trạng thái vẫn đếm đủ", async () => {
    const loai = await db.affiliateType.create({ data: { code: `${MA}_L${hau()}`, name: `Loại ${P}` } });
    const dangDung = await db.affiliate.create({ data: { code: `${MA}_A${hau()}`, name: `${P} đang dùng`, status: "ACTIVE", isActive: true, typeId: loai.id } });
    const choDuyet = await db.affiliate.create({ data: { code: `${MA}_P${hau()}`, name: `${P} chờ duyệt`, status: "PENDING", isActive: false, typeId: loai.id } });
    const daDong = await db.affiliate.create({ data: { code: `${MA}_E${hau()}`, name: `${P} đã kết thúc`, status: "ENDED", isActive: false, typeId: loai.id } });

    const macDinh = await docDanhSachDoiTac(actor, { ...LOC });
    const ids = macDinh.dong.map((d) => d.id);
    expect(ids).toContain(dangDung.id); // đối chứng dương: đang dùng THẤY
    expect(ids).toContain(choDuyet.id);
    expect(ids).not.toContain(daDong.id);
    expect(macDinh.tong).toBe(2); // phân trang khớp tập đang hiển thị

    const rieng = await docDanhSachDoiTac(actor, { ...LOC, trangThai: "ENDED" });
    expect(rieng.dong.map((d) => d.id)).toEqual([daDong.id]);
    // chip «Đã kết thúc (n)» vẫn đếm đủ khi đang ở mặc định (người dùng còn thấy đường vào mục đã đóng)
    expect(macDinh.theoTrangThai.ENDED).toBe(1);
    expect(macDinh.theoTrangThai.ACTIVE + macDinh.theoTrangThai.PENDING).toBe(macDinh.tong);
  });

  it("[HDM-DB-02] campaign: mặc định KHÔNG hiện ENDED; chọn ENDED thì thấy; đếm theo trạng thái đủ", async () => {
    const dang = await db.affiliateCampaign.create({ data: { code: `${MA}_C${hau()}`, name: `${P} chạy`, status: "ACTIVE" } });
    const tamDung = await db.affiliateCampaign.create({ data: { code: `${MA}_C${hau()}`, name: `${P} tạm dừng`, status: "PAUSED" } });
    const ketThuc = await db.affiliateCampaign.create({ data: { code: `${MA}_C${hau()}`, name: `${P} kết thúc`, status: "ENDED" } });

    const macDinh = await docDanhSachCampaign({ trangThai: null, trang: 1, kichThuoc: 1000 });
    const ma = macDinh.dong.map((d) => d.code);
    expect(ma).toContain(dang.code);
    expect(ma).toContain(tamDung.code);
    expect(ma).not.toContain(ketThuc.code);
    const rieng = await docDanhSachCampaign({ trangThai: "ENDED", trang: 1, kichThuoc: 1000 });
    expect(rieng.dong.map((d) => d.code)).toContain(ketThuc.code);
    expect(macDinh.demTheoTrangThai.ENDED).toBeGreaterThanOrEqual(1);
  });

  it("[HDM-DB-03] link: mặc định KHÔNG hiện REVOKED; chọn REVOKED thì thấy; số chip trạng thái đủ", async () => {
    const loai = await db.affiliateType.create({ data: { code: `${MA}_L${hau()}`, name: `Loại ${P}` } });
    const dt = await db.affiliate.create({ data: { code: `${MA}_A${hau()}`, name: `${P} đối tác`, status: "ACTIVE", isActive: true, typeId: loai.id } });
    const host = `${P}-${hau().toLowerCase()}.example.test`;
    const site = await db.affiliateSite.create({ data: { code: `${MA}_S${hau()}`, name: `Web ${P}`, baseUrl: `https://${host}`, allowedDomains: [host], status: "ACTIVE" } });
    const camp = await db.affiliateCampaign.create({ data: { code: `${MA}_C${hau()}`, name: `${P} campaign`, status: "ACTIVE" } });
    const mem = await db.affiliateMembership.create({ data: { partyId: dt.id, campaignId: camp.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
    const base = { partyId: dt.id, membershipId: mem.id, campaignId: camp.id, siteId: site.id, landingPath: "/", type: "LINK" as const };
    const song = await db.affiliateTrackingAsset.create({ data: { ...base, publicToken: sinhToken(), status: "ACTIVE" } });
    const thuHoi = await db.affiliateTrackingAsset.create({ data: { ...base, publicToken: sinhToken(), status: "REVOKED", revokedAt: new Date("2026-10-28T02:00:00.000Z"), revokedReason: "fixture đã thu hồi" } });

    const loc = { trang: 1, kichThuoc: 25, campaignMa: camp.code, doiTacMa: dt.code, coTheXemDayDu: true, gocLinkNgan: "https://satarobo.vn", gocNhinDoiTac: false, now: NOW } as const;
    const macDinh = await docDanhSachLink({ ...loc, trangThai: null });
    const tokens = macDinh.dong.map((d) => d.token);
    expect(tokens).toContain(song.publicToken);
    expect(tokens).not.toContain(thuHoi.publicToken);
    expect(macDinh.tong).toBe(1);
    const rieng = await docDanhSachLink({ ...loc, trangThai: "REVOKED" });
    expect(rieng.dong.map((d) => d.token)).toEqual([thuHoi.publicToken]);
    expect(macDinh.theoTrangThai.REVOKED).toBe(1);
    // ĐỐI CHỨNG: góc nhìn ĐỐI TÁC (cổng đối tác) KHÔNG bị ẩn — họ vẫn thấy link đã thu hồi của mình ([AFR-PT-DB-06]).
    const goc = await docDanhSachLink({ ...loc, trangThai: null, gocNhinDoiTac: true });
    expect(goc.dong.map((d) => d.token).sort()).toEqual([song.publicToken, thuHoi.publicToken].sort());
  });

  it("[HDM-DB-04] loại: hienDaNgung=false ẩn loại ngừng và `tong` khớp số hàng; hienDaNgung=true thấy đủ; `soDaNgung` đếm cả khi đang ẩn", async () => {
    const dung = await db.affiliateType.create({ data: { code: `${MA}_L${hau()}`, name: `Loại ${P} dùng`, isActive: true } });
    const ngung = await db.affiliateType.create({ data: { code: `${MA}_L${hau()}`, name: `Loại ${P} ngừng`, isActive: false } });

    const an = await docDanhSachLoai({ trang: 1, kichThuoc: 1000, hienDaNgung: false });
    expect(an.dong.map((d) => d.id)).toContain(dung.id);
    expect(an.dong.map((d) => d.id)).not.toContain(ngung.id);
    expect(an.tong).toBe(an.dong.length);
    expect(an.soDaNgung).toBeGreaterThanOrEqual(1);

    const hien = await docDanhSachLoai({ trang: 1, kichThuoc: 1000, hienDaNgung: true });
    expect(hien.dong.map((d) => d.id)).toEqual(expect.arrayContaining([dung.id, ngung.id]));
    expect(hien.tong).toBe(hien.dong.length);
    expect(hien.tong).toBe(an.tong + an.soDaNgung);
  });
});
