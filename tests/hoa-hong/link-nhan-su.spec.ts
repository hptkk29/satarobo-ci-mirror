// @vitest-environment node
/**
 * [LNS-DB-*] «Link giới thiệu của tôi» của NHÂN SỰ (`lib/affiliate/doi-tac-nhan-su.ts`) — Postgres thật.
 *
 * Hình dạng dữ liệu theo PROD (đo 21/11/2026): đối tác nhân sự gắn `Affiliate.employeeId`, KHÔNG gắn `userId`, 0 dòng `AffiliatePartyUser`; một đối tác có membership ĐÃ KẾT THÚC và 0 link (ca Kiệt).
 * Cấu hình suy từ DỮ LIỆU: bộ này trỏ `nguon.nhomNhanSuMacDinh` vào một nhóm nguồn RIÊNG (dựng bởi `dungChuoi`) để không phụ thuộc campaign của bộ khác.
 *
 *   Luồng chủ dự án chốt 21/11/2026: quy định ⇒ «Tôi đồng ý» ⇒ vào LUÔN, KHÔNG có bước duyệt (đảo bản 20/11 «membership chờ duyệt»).
 *
 *   [LNS-DB-01] tài khoản KHÔNG có hồ sơ nhân sự ⇒ KHONG_NHAN_SU; đồng ý ⇒ từ chối; tạo link bằng membership của người khác ⇒ «không tìm thấy».
 *   [LNS-DB-02] chưa tham gia ⇒ quy định đọc số của campaign; đồng ý ⇒ đối tác (mã = mã NV, employeeId, userId TRỐNG) + membership ĐANG HOẠT ĐỘNG ngay + dấu đồng ý; đồng ý lại không đẻ thêm.
 *   [LNS-DB-03] đồng ý xong ⇒ tạo link được ngay, link hiện trong danh sách, xin QR được.
 *   [LNS-DB-04] CHÉO NGƯỜI: B dùng membership / id link của A ⇒ «không tìm thấy» / null; đối chứng dương: B tạo được link của CHÍNH B.
 *   [LNS-DB-05] nhân sự ĐÃ NGHỈ ⇒ KHONG_NHAN_SU, không đồng ý được, không tạo được link (kể cả bằng membership của chính mình).
 *   [LNS-DB-06] TẠM NGỪNG hồ sơ / tư cách ⇒ BI_CHAN; «đồng ý» KHÔNG mở lại; `phatLink` chặn tạo link.
 *   [LNS-DB-07] ca Kiệt: đối tác có sẵn + membership ĐÃ KẾT THÚC ⇒ đồng ý = ĐANG HOẠT ĐỘNG, không tạo đối tác thứ hai.
 *   [LNS-DB-08] cấu hình KHÔNG ra đúng một ⇒ quyDinh null + đồng ý bị từ chối.
 *   [LNS-DB-09] loại đặt «cần duyệt» vẫn vào thẳng; dữ liệu kẹt «chờ duyệt» của luồng cũ ⇒ đồng ý là thông.
 *   [LNS-DB-10] tab «Khách mang về»: SĐT che, không lộ số đầy đủ / id lead; chéo người (đối chứng dương); tìm phải đủ số.
 *   [LNS-DB-12] «Dòng hoa hồng»: CHỈ dòng giới thiệu của chính mình (vai nhân sự giới thiệu theo hồ sơ NV + dòng trả cho hồ sơ giới thiệu), KHÔNG dòng Sale của cùng người,
 *               KHÔNG dòng của người khác (đối chứng dương: B thấy dòng của B); tổng đã nhận / đang chờ; SĐT che; lọc trạng thái; tìm đủ số.
 *   [LNS-DB-11] thu hồi link CỦA CHÍNH MÌNH: B không thu hồi được link của A (đối chứng: A thu hồi được); thu hồi xong ⇒ link chết (QR từ chối), «cấp link mới» tạo được link mới cùng trang.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import { docCauHinhNhanSu, docLinkChoQrNhanSu, docLinkGioiThieuCuaToi, LOI_CHUA_CAU_HINH, LOI_KHONG_NHAN_SU, LY_DO_HO_SO_TAM_NGUNG, LY_DO_THAM_GIA_TAM_NGUNG, taoLinkNhanSu, thamGiaLinkGioiThieu, thuHoiLinkNhanSu } from "../../lib/affiliate/doi-tac-nhan-su";
import { chePhoneThuNhap, docKhachMangVeNhanSu } from "../../lib/nguon/thu-nhap-them";
import { cheSdtDongHH, docHoaHongGioiThieuNhanSu } from "../../lib/nguon/hoa-hong-gioi-thieu";
import { damBaoToChuc } from "../lead-intake/_nguon-fixture";
import { donSoCai } from "./_kich-ban";
import { db } from "../../lib/db";
import { clearSettingsCache } from "../../lib/settings/service";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, datCoNguon } from "../lead-intake/_nguon-fixture";
import { donAffiliateFx, dungChuoi, hau, KHACH, taoLead, taoReferral, themDongSo, type Chuoi } from "./_affiliate-so-fx";

if (!RUN_DB_TESTS) console.warn(`[LNS-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = new Date("2026-11-21T03:00:00.000Z");
const TIEN_TO_EMAIL = "lns-db-";
let x: Chuoi;
let nhomCode: string;

async function taoTaiKhoan(ten: string) {
  return seedUser({ email: `${TIEN_TO_EMAIL}${ten}-${hau().toLowerCase()}@ci.test`, role: "SALES_CSM", name: `NV LNS ${ten}`, phone: null });
}
async function lamNhanSu(userId: string, ma: string, status: "ACTIVE" | "RESIGNED" = "ACTIVE") {
  const e = await db.employee.create({ data: { employeeCode: `SR.NV.LNS${ma}${hau()}`, fullName: `Nhân sự LNS ${ma}`, jobTitle: "Sale", department: "KINH_DOANH", status } });
  await db.user.update({ where: { id: userId }, data: { employeeId: e.id } });
  return e;
}
const nguoi = (u: { id: string }) => ({ userId: u.id, ten: "NV LNS" });
const trangDich = async () => db.affiliateLandingPage.findFirstOrThrow({ where: { siteId: x.site.id }, select: { id: true, pathPattern: true } });
async function vaoTaoLink(membershipId: string) {
  const t = await trangDich();
  return { membershipId, siteId: x.site.id, landingPageId: t.id, landingPath: t.pathPattern, label: null };
}
async function doiTacCua(employeeId: string) {
  return db.affiliate.findFirstOrThrow({ where: { employeeId, status: { not: "ENDED" } }, select: { id: true, code: true, userId: true, status: true } });
}
async function memCua(partyId: string) {
  return db.affiliateMembership.findUniqueOrThrow({ where: { partyId_campaignId: { partyId, campaignId: x.campaign.id } }, select: { id: true, status: true } });
}

describe.skipIf(!RUN_DB_TESTS)("[LNS-DB] link giới thiệu của nhân sự — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    vi.stubEnv("AFFILIATE_PUBLIC_ORIGIN", "https://test.satarobo.vn");
    x = await dungChuoi({ tenCampaign: "Chiến dịch LNS nhân sự" });
    nhomCode = (await db.leadSourceGroup.findUniqueOrThrow({ where: { id: x.nhomId }, select: { code: true } })).code;
    // Loại đối tác nhân sự: KHÔNG cần duyệt, nguồn mặc định = nhóm nhân sự của bộ này. Đúng một loại + đúng một campaign ⇒ cấu hình hợp lệ.
    await db.affiliateType.update({ where: { id: x.loai.id }, data: { requiresApproval: false, isActive: true, defaultSourceGroupId: x.nhomId } });
    await datCoNguon({ ...CO_NGUON_DAY_DU, affiliate: true }, { "nguon.nhomNhanSuMacDinh": nhomCode });
  }, 180_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    // Đối tác do LÕI tạo (mã = mã NV, không mang tiền tố AFRX của fixture) + ca Kiệt: gỡ link → membership → nhãn → đối tác TRƯỚC khi fixture xoá campaign (FK Restrict).
    const nvIds = (await db.employee.findMany({ where: { employeeCode: { startsWith: "SR.NV.LNS" } }, select: { id: true } })).map((e) => e.id);
    const dtIds = (await db.affiliate.findMany({ where: { employeeId: { in: nvIds } }, select: { id: true } })).map((d) => d.id);
    await donSoCai(); // [LNS-DB-12] ghi dòng sổ (bất biến) ⇒ cắt bảng sổ như mọi bộ sổ khác, TRƯỚC khi gỡ đối tác (FK Restrict)
    await db.affiliateReferral.deleteMany({ where: { partyId: { in: dtIds } } });
    await db.affiliateTrackingAsset.deleteMany({ where: { partyId: { in: dtIds } } });
    await db.affiliateMembership.deleteMany({ where: { partyId: { in: dtIds } } });
    await db.affiliate.deleteMany({ where: { id: { in: dtIds } } });
    await db.affiliateCampaign.deleteMany({ where: { code: { startsWith: "LNS_THUA_" } } });
    await donAffiliateFx();
    const u = await db.user.findMany({ where: { email: { startsWith: TIEN_TO_EMAIL } }, select: { id: true, employeeId: true } });
    await db.user.deleteMany({ where: { id: { in: u.map((v) => v.id) } } });
    await db.employee.deleteMany({ where: { employeeCode: { startsWith: "SR.NV.LNS" } } });
    await db.systemSetting.deleteMany({ where: { key: { in: ["affiliate.enabled"] } } });
    await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
    clearSettingsCache();
  }, 180_000);

  it("[LNS-DB-01] không có hồ sơ nhân sự ⇒ không thấy gì, không tham gia được, không tạo link được", async () => {
    expect(await docCauHinhNhanSu()).not.toBeNull(); // đối chứng: cấu hình của bộ đang hợp lệ — ca này đỏ vì THIẾU NHÂN SỰ, không vì cấu hình
    const u = await taoTaiKhoan("khong-nv");
    expect(await docLinkGioiThieuCuaToi(u.id, NOW)).toEqual({ loai: "KHONG_NHAN_SU" });
    expect(await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: false, loi: LOI_KHONG_NHAN_SU });
    const kq = await taoLinkNhanSu({ nguoi: nguoi(u), vao: await vaoTaoLink(x.mem.id), now: NOW });
    expect(kq).toMatchObject({ ok: false, truong: "membershipId" });
  });

  it("[LNS-DB-02] chưa tham gia ⇒ màn quy định (số của CHƯƠNG TRÌNH); đồng ý ⇒ đối tác + membership ĐANG HOẠT ĐỘNG NGAY (không duyệt) + dấu đồng ý; đồng ý lại ⇒ không đẻ thêm", async () => {
    const u = await taoTaiKhoan("a");
    const nv = await lamNhanSu(u.id, "A");
    const camp = await db.affiliateCampaign.findUniqueOrThrow({ where: { id: x.campaign.id }, select: { cookieWindowDays: true, protectWindowDays: true } });
    expect(await docLinkGioiThieuCuaToi(u.id, NOW)).toMatchObject({ loai: "CHUA_THAM_GIA", quyDinh: { nhoKhachNgay: camp.cookieWindowDays, baoVeNgay: camp.protectWindowDays } });

    expect(await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: true });
    const dt = await doiTacCua(nv.id);
    expect(dt.code).toBe(nv.employeeCode.replace(/[^A-Z0-9]/g, ""));
    expect(dt.userId).toBeNull(); // đúng hình prod: gắn hồ sơ nhân sự, không gắn tài khoản
    expect(dt.status).toBe("ACTIVE");
    expect((await memCua(dt.id)).status).toBe("ACTIVE"); // KHÔNG chờ duyệt
    expect(await db.auditLog.count({ where: { entityType: "Affiliate", entityId: dt.id, action: "AFFILIATE_NHAN_SU_DONG_Y_QUY_DINH" } })).toBe(1);
    expect(await docLinkGioiThieuCuaToi(u.id, NOW)).toMatchObject({ loai: "DA_THAM_GIA", link: [] });

    expect(await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: true });
    expect(await db.affiliate.count({ where: { employeeId: nv.id } })).toBe(1);
    expect(await db.affiliateMembership.count({ where: { partyId: dt.id } })).toBe(1);
  });

  it("[LNS-DB-03] đồng ý xong ⇒ tạo link được NGAY (không bước duyệt), có trong danh sách, xin QR được", async () => {
    const u = await taoTaiKhoan("c");
    const nv = await lamNhanSu(u.id, "C");
    await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW });
    const mem = await memCua((await doiTacCua(nv.id)).id);
    const kq = await taoLinkNhanSu({ nguoi: nguoi(u), vao: await vaoTaoLink(mem.id), now: NOW });
    expect(kq.ok).toBe(true);
    const id = kq.ok ? kq.id : "";
    const d = await docLinkGioiThieuCuaToi(u.id, NOW);
    expect(d.loai).toBe("DA_THAM_GIA");
    if (d.loai !== "DA_THAM_GIA") return;
    expect(d.link.map((l) => l.id)).toEqual([id]);
    expect(d.link[0]!.lienKetNgan).toMatch(/^https:\/\/test\.satarobo\.vn\/r\//);
    expect(d.taoLink.chuongTrinh.map((c) => c.membershipId)).toEqual([mem.id]);
    expect(await docLinkChoQrNhanSu(u.id, id)).toMatchObject({ status: "ACTIVE" });
  });

  it("[LNS-DB-04] CHÉO NGƯỜI: B không dùng được membership / link của A; B tạo được link của CHÍNH B", async () => {
    const ua = await taoTaiKhoan("x");
    const nva = await lamNhanSu(ua.id, "X");
    const ub = await taoTaiKhoan("y");
    const nvb = await lamNhanSu(ub.id, "Y");
    for (const u of [ua, ub]) await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW });
    const [dta, dtb] = [await doiTacCua(nva.id), await doiTacCua(nvb.id)];
    const [mema, memb] = [await memCua(dta.id), await memCua(dtb.id)];
    const linkA = await taoLinkNhanSu({ nguoi: nguoi(ua), vao: await vaoTaoLink(mema.id), now: NOW });
    expect(linkA.ok).toBe(true);

    expect(await taoLinkNhanSu({ nguoi: nguoi(ub), vao: await vaoTaoLink(mema.id), now: NOW })).toMatchObject({ ok: false, truong: "membershipId" });
    expect(await docLinkChoQrNhanSu(ub.id, linkA.ok ? linkA.id : "")).toBeNull();
    expect(await db.affiliateTrackingAsset.count({ where: { partyId: dtb.id } })).toBe(0);
    // đối chứng dương: cùng đường, đúng chủ
    expect((await taoLinkNhanSu({ nguoi: nguoi(ub), vao: await vaoTaoLink(memb.id), now: NOW })).ok).toBe(true);
    const b = await docLinkGioiThieuCuaToi(ub.id, NOW);
    expect(b.loai === "DA_THAM_GIA" && b.link.every((l) => l.id !== (linkA.ok ? linkA.id : ""))).toBe(true);
  });

  it("[LNS-DB-05] nhân sự ĐÃ NGHỈ ⇒ KHONG_NHAN_SU và không tạo được link bằng membership của chính mình", async () => {
    const u = await taoTaiKhoan("nghi");
    const nv = await lamNhanSu(u.id, "N");
    await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW });
    const mem = await memCua((await doiTacCua(nv.id)).id);
    expect((await taoLinkNhanSu({ nguoi: nguoi(u), vao: await vaoTaoLink(mem.id), now: NOW })).ok).toBe(true); // đối chứng: còn làm thì tạo được
    await db.employee.update({ where: { id: nv.id }, data: { status: "RESIGNED" } });
    expect(await docLinkGioiThieuCuaToi(u.id, NOW)).toEqual({ loai: "KHONG_NHAN_SU" });
    expect(await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: false, loi: LOI_KHONG_NHAN_SU });
    expect(await taoLinkNhanSu({ nguoi: nguoi(u), vao: await vaoTaoLink(mem.id), now: NOW })).toMatchObject({ ok: false, truong: "membershipId" });
  });

  it("[LNS-DB-06] TẠM NGỪNG (hồ sơ hoặc tư cách) là lệnh dừng của quản lý ⇒ BI_CHAN, «đồng ý» KHÔNG mở lại, `phatLink` chặn tạo link", async () => {
    const u = await taoTaiKhoan("ngung");
    const nv = await lamNhanSu(u.id, "S");
    await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW });
    const dt = await doiTacCua(nv.id);
    const mem = await memCua(dt.id);
    await db.affiliate.update({ where: { id: dt.id }, data: { status: "SUSPENDED", isActive: false } });
    expect(await taoLinkNhanSu({ nguoi: nguoi(u), vao: await vaoTaoLink(mem.id), now: NOW })).toMatchObject({ ok: false });
    expect(await db.affiliateTrackingAsset.count({ where: { partyId: dt.id } })).toBe(0);
    expect(await docLinkGioiThieuCuaToi(u.id, NOW)).toMatchObject({ loai: "BI_CHAN", lyDo: LY_DO_HO_SO_TAM_NGUNG });
    expect(await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: false, loi: LY_DO_HO_SO_TAM_NGUNG });
    expect((await doiTacCua(nv.id)).status).toBe("SUSPENDED");

    await db.affiliate.update({ where: { id: dt.id }, data: { status: "ACTIVE", isActive: true } });
    await db.affiliateMembership.update({ where: { id: mem.id }, data: { status: "SUSPENDED" } });
    expect(await docLinkGioiThieuCuaToi(u.id, NOW)).toMatchObject({ loai: "BI_CHAN", lyDo: LY_DO_THAM_GIA_TAM_NGUNG });
    expect(await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: false, loi: LY_DO_THAM_GIA_TAM_NGUNG });
    expect((await memCua(dt.id)).status).toBe("SUSPENDED");
  });

  it("[LNS-DB-07] ca Kiệt: đối tác có sẵn + membership ĐÃ KẾT THÚC ⇒ màn quy định; đồng ý ⇒ ĐANG HOẠT ĐỘNG, không tạo đối tác thứ hai", async () => {
    const u = await taoTaiKhoan("kiet");
    const nv = await lamNhanSu(u.id, "K");
    const dt = await db.affiliate.create({ data: { code: `LNSK${hau()}`, name: "Kiệt LNS", status: "ACTIVE", isActive: true, typeId: x.loai.id, employeeId: nv.id } });
    await db.affiliateMembership.create({ data: { partyId: dt.id, campaignId: x.campaign.id, status: "ENDED", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: new Date("2026-02-01T00:00:00.000Z") } });
    expect(await docLinkGioiThieuCuaToi(u.id, NOW)).toMatchObject({ loai: "CHUA_THAM_GIA" });
    expect(await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: true });
    expect((await memCua(dt.id)).status).toBe("ACTIVE");
    expect(await db.affiliate.count({ where: { employeeId: nv.id } })).toBe(1);
  });

  it("[LNS-DB-08] cấu hình không ra ĐÚNG MỘT campaign ⇒ màn quy định không có nút (quyDinh null) + đồng ý bị từ chối (không đoán)", async () => {
    const u = await taoTaiKhoan("cauhinh");
    await lamNhanSu(u.id, "H");
    const thua = await db.affiliateCampaign.create({ data: { code: `LNS_THUA_${hau()}`, name: "Campaign thừa LNS", status: "ACTIVE", cookieWindowDays: 30, protectWindowDays: 90, defaultSourceGroupId: x.nhomId } });
    try {
      expect(await docCauHinhNhanSu()).toBeNull();
      expect(await docLinkGioiThieuCuaToi(u.id, NOW)).toMatchObject({ loai: "CHUA_THAM_GIA", quyDinh: null });
      expect(await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: false, loi: LOI_CHUA_CAU_HINH });
    } finally {
      await db.affiliateCampaign.update({ where: { id: thua.id }, data: { status: "ENDED" } });
    }
    expect(await docCauHinhNhanSu()).not.toBeNull(); // đối chứng: gỡ campaign thừa ⇒ cấu hình hợp lệ lại
  });

  it("[LNS-DB-09] loại đối tác ĐẶT «CẦN DUYỆT» (hình test.satarobo.vn) VẪN vào thẳng; dữ liệu kẹt của luồng cũ (hồ sơ + membership chờ duyệt) ⇒ đồng ý là thông", async () => {
    await db.affiliateType.update({ where: { id: x.loai.id }, data: { requiresApproval: true } });
    try {
      const u = await taoTaiKhoan("canduyet");
      const nv = await lamNhanSu(u.id, "D");
      expect(await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW })).toEqual({ ok: true });
      const dt = await doiTacCua(nv.id);
      expect(dt.status).toBe("ACTIVE");
      expect((await memCua(dt.id)).status).toBe("ACTIVE");

      const u2 = await taoTaiKhoan("ket");
      const nv2 = await lamNhanSu(u2.id, "J");
      const dt2 = await db.affiliate.create({ data: { code: `LNSJ${hau()}`, name: "Kẹt LNS", status: "PENDING", isActive: false, typeId: x.loai.id, employeeId: nv2.id } });
      await db.affiliateMembership.create({ data: { partyId: dt2.id, campaignId: x.campaign.id, status: "PENDING", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
      expect(await docLinkGioiThieuCuaToi(u2.id, NOW)).toMatchObject({ loai: "CHUA_THAM_GIA" });
      expect(await thamGiaLinkGioiThieu({ nguoi: nguoi(u2), now: NOW })).toEqual({ ok: true });
      expect((await doiTacCua(nv2.id)).status).toBe("ACTIVE");
      expect((await memCua(dt2.id)).status).toBe("ACTIVE");
    } finally {
      await db.affiliateType.update({ where: { id: x.loai.id }, data: { requiresApproval: false } });
    }
  });

  it("[LNS-DB-10] tab «Khách mang về»: A thấy khách của link mình (SĐT CHE, không lộ số đầy đủ); B KHÔNG thấy khách của A; tìm bằng ĐỦ số thì ra", async () => {
    const ua = await taoTaiKhoan("ka");
    const nva = await lamNhanSu(ua.id, "KA");
    const ub = await taoTaiKhoan("kb");
    await lamNhanSu(ub.id, "KB");
    for (const u of [ua, ub]) await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW });
    const dta = await doiTacCua(nva.id);
    const mema = await memCua(dta.id);
    const link = await taoLinkNhanSu({ nguoi: nguoi(ua), vao: await vaoTaoLink(mema.id), now: NOW });
    if (!link.ok) throw new Error(link.loi);
    const lead = await taoLead({ centerId: null });
    await taoReferral({ partyId: dta.id, campaignId: x.campaign.id, membershipId: mema.id, assetId: link.id, nhomId: x.nhomId, status: "VALID", luc: NOW, centerId: null, leadId: lead.id });

    const a = await docKhachMangVeNhanSu({ userId: ua.id });
    expect(a.tongLead).toBe(1);
    expect(a.khach).toHaveLength(1);
    expect(a.khach[0]).toMatchObject({ tenPhuHuynh: KHACH.ten, soDienThoaiChe: chePhoneThuNhap(KHACH.sdt) });
    const json = JSON.stringify(a);
    expect(json).not.toContain(KHACH.sdt);
    expect(json).not.toContain(KHACH.sdt84);
    expect(json).not.toContain(lead.id);
    expect((await docKhachMangVeNhanSu({ userId: ua.id, q: KHACH.sdt })).khach).toHaveLength(1);
    expect((await docKhachMangVeNhanSu({ userId: ua.id, q: KHACH.sdt.slice(0, 6) })).khach).toHaveLength(0); // gõ thiếu số ⇒ không dò được

    const b = await docKhachMangVeNhanSu({ userId: ub.id });
    expect(b).toMatchObject({ tongLead: 0, khach: [] });
  });

  it("[LNS-DB-12] «Dòng hoa hồng»: chỉ dòng GIỚI THIỆU của chính mình; tổng; SĐT che; lọc; chéo người", async () => {
    await damBaoToChuc({ donVi: ["HO", "CS1"] });
    const ou = await db.orgUnit.findFirstOrThrow({ where: { code: "CS1", deletedAt: null, centerId: { not: null } }, select: { id: true, centerId: true } });
    const co = { centerId: ou.centerId!, orgUnitId: ou.id };
    const ua = await taoTaiKhoan("hha");
    const nva = await lamNhanSu(ua.id, "HHA");
    const ub = await taoTaiKhoan("hhb");
    const nvb = await lamNhanSu(ub.id, "HHB");
    for (const u of [ua, ub]) await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW });
    const dta = await doiTacCua(nva.id);
    const lead = await taoLead({ centerId: co.centerId });

    await themDongSo({ ...co, campaignId: null, vai: "REFERRER_EMPLOYEE", nguoiId: ua.id, employeeId: nva.id, ten: "A", amount: 30_000, payout: "PENDING", leadId: lead.id });
    await themDongSo({ ...co, campaignId: x.campaign.id, vai: "AFFILIATE", nguoiId: dta.id, ten: "A", amount: 20_000, payout: "PAID" });
    await themDongSo({ ...co, campaignId: null, vai: "SALE", nguoiId: ua.id, employeeId: nva.id, ten: "A", amount: 99_999, payout: "PENDING" }); // A hưởng ở vai SALE (engine ghi cả hồ sơ NV — `quet-khoan.ts`) ⇒ KHÔNG thuộc màn này
    await themDongSo({ ...co, campaignId: null, vai: "REFERRER_EMPLOYEE", nguoiId: ub.id, employeeId: nvb.id, ten: "B", amount: 7_000, payout: "APPROVED" });

    const a = await docHoaHongGioiThieuNhanSu({ userId: ua.id });
    expect(a).toMatchObject({ daNhan: 20_000, dangCho: 30_000, soChoDuyet: 1, soChoChi: 0 });
    expect(a.dong.map((d) => d.hoaHong).sort((m, n) => m - n)).toEqual([20_000, 30_000]);
    const coKhach = a.dong.find((d) => d.hoaHong === 30_000)!;
    expect(coKhach).toMatchObject({ phuHuynh: KHACH.ten, sdtChe: cheSdtDongHH(KHACH.sdt), trangThai: "CHO_DUYET", muc: "1%" });
    const json = JSON.stringify(a);
    expect(json).not.toContain(KHACH.sdt);
    expect(json).not.toContain(KHACH.sdt84);
    expect(json).not.toContain(lead.id);

    expect((await docHoaHongGioiThieuNhanSu({ userId: ua.id, trangThai: "DA_TRA" })).dong.map((d) => d.hoaHong)).toEqual([20_000]);
    expect((await docHoaHongGioiThieuNhanSu({ userId: ua.id, q: KHACH.sdt })).dong.map((d) => d.hoaHong)).toEqual([30_000]);
    expect((await docHoaHongGioiThieuNhanSu({ userId: ua.id, q: KHACH.sdt.slice(0, 6) })).dong).toHaveLength(0);

    const b = await docHoaHongGioiThieuNhanSu({ userId: ub.id });
    expect(b.dong.map((d) => d.hoaHong)).toEqual([7_000]); // đối chứng dương: B thấy dòng của B, không thấy dòng của A
    expect(b).toMatchObject({ daNhan: 0, dangCho: 7_000, soChoChi: 1 });

    const khongNv = await taoTaiKhoan("hh-khong-nv");
    expect(await docHoaHongGioiThieuNhanSu({ userId: khongNv.id })).toMatchObject({ dong: [], daNhan: 0, dangCho: 0 });
  });

  it("[LNS-DB-11] thu hồi link CỦA CHÍNH MÌNH; người khác không thu hồi được; thu hồi xong cấp link mới được", async () => {
    const ua = await taoTaiKhoan("ta");
    const nva = await lamNhanSu(ua.id, "TA");
    const ub = await taoTaiKhoan("tb");
    await lamNhanSu(ub.id, "TB");
    for (const u of [ua, ub]) await thamGiaLinkGioiThieu({ nguoi: nguoi(u), now: NOW });
    const mema = await memCua((await doiTacCua(nva.id)).id);
    const link = await taoLinkNhanSu({ nguoi: nguoi(ua), vao: await vaoTaoLink(mema.id), now: NOW });
    if (!link.ok) throw new Error(link.loi);

    expect(await thuHoiLinkNhanSu({ nguoi: nguoi(ub), id: link.id, now: NOW })).toMatchObject({ ok: false, truong: "id" });
    expect((await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: link.id }, select: { status: true } })).status).toBe("ACTIVE");

    expect(await thuHoiLinkNhanSu({ nguoi: nguoi(ua), id: link.id, now: NOW })).toMatchObject({ ok: true });
    expect(await docLinkChoQrNhanSu(ua.id, link.id)).toMatchObject({ status: "REVOKED" });
    const d = await docLinkGioiThieuCuaToi(ua.id, NOW);
    expect(d.loai === "DA_THAM_GIA" && d.link.find((l) => l.id === link.id)?.hoatDong).toBe(false);
    expect(await thuHoiLinkNhanSu({ nguoi: nguoi(ua), id: link.id, now: NOW })).toMatchObject({ ok: false }); // thu hồi lần hai ⇒ từ chối

    const moi = await taoLinkNhanSu({ nguoi: nguoi(ua), vao: await vaoTaoLink(mema.id), now: NOW });
    expect(moi.ok).toBe(true);
    expect(moi.ok && moi.id !== link.id).toBe(true);
  });
});
