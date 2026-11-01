// @vitest-environment node
/**
 * [AFR-PT-DB-*] — TRANG «GIỚI THIỆU» CỦA CỔNG ĐỐI TÁC (`/portal/gioi-thieu`) trên Postgres THẬT (AFF-P3 H3; docs/source-commission/12 §9).
 *
 * Mục tiêu duy nhất của bộ này: đối tác A KHÔNG BAO GIỜ thấy dữ liệu của đối tác B, và không ai thấy thông tin khách. Mọi ca "không thấy X" có ĐỐI CHỨNG DƯƠNG (A thấy phần của A — luật 11),
 * và các số của A/B cố ý KHÁC NHAU (5 ≠ 7 lượt bấm, 100.000 ≠ 700.000đ) để việc trộn hai bên lộ ra thành số sai chứ không trùng khớp may mắn.
 *
 *   [AFR-PT-DB-01] CROSS-USER hai chiều: A chỉ thấy link / lượt bấm / referral / hoa hồng của A; B chỉ của B; JSON của A không chứa token, tên, id của B (và ngược lại)
 *   [AFR-PT-DB-02] KHÔNG PII: JSON không chứa tên / SĐT (0… lẫn 84…) / email khách, SĐT / email đối tác, id nội bộ (đối tác, campaign, lead); không khoá nào tên phone/email/leadId/orderId/studentId
 *   [AFR-PT-DB-03] R10 · D1: dòng referral CHỈ {ngày, chương trình} — không trạng thái, không mã hồ sơ; [03b] BẤT BIẾN khi đổi trạng thái / đổi `now`
 *   [AFR-PT-DB-04] CỜ: cờ Affiliate tắt ⇒ null / không menu; cờ nguồn tắt (cờ affiliate bật) ⇒ cũng null; bật cả hai ⇒ có (đối chứng); tài khoản KHÔNG phải đối tác ⇒ null dù cờ bật
 *   [AFR-PT-DB-05] một tài khoản có NHIỀU hồ sơ đối tác ⇒ gộp đúng các hồ sơ của MÌNH, không lẫn của A / B
 *   [AFR-PT-DB-06] hồ sơ đã kết thúc vẫn xem được lịch sử (kèm trạng thái); link đã thu hồi không có địa chỉ
 *   [AFR-PT-DB-07] TRANG dựng bằng dữ liệu thật: HTML của A có link của A, KHÔNG có token / tên của B, không PII; cờ tắt ⇒ 404; không phải đối tác ⇒ 404; chưa đăng nhập / không phải PARENT ⇒ /login
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng fixture (tiền tố AFRX, tài khoản `afrx-pt-*`). LUẬT 19: ngày tuyệt đối. KHÔNG `resetDb()`; sổ bất biến nên dọn bằng `donKichBan`.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const PHIEN = vi.hoisted(() => ({ session: null as null | { user: { id: string; role: string } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => PHIEN.session }));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT:${u}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  // Trang này có form «Tạo link» (client, dùng useRouter) — dựng ở đây chỉ để render được HTML; hành vi của nó có bộ test riêng.
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
// Server Action của cổng kéo next-auth/Prisma qua form tạo link và nút QR; trang chỉ cần chúng tồn tại. Hành vi thật của chúng: affiliate-nhieu-website.spec.ts.
vi.mock("@/app/(portal)/portal/gioi-thieu/_actions", () => ({ taoLinkCuaToiAction: async () => ({ ok: false, loi: "mock" }), taoQrCuaToiAction: async () => ({ ok: false, loi: "mock" }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => React.createElement("a", { href, ...rest }, children),
}));
vi.setConfig({ testTimeout: 90_000 });

import GioiThieuPage from "../../app/(portal)/portal/gioi-thieu/page";
import { coGioiThieuChoNguoiDung, docGioiThieuCuaToi } from "../../lib/affiliate/doc-cua-toi";
import { maRutGonPhieu } from "../../lib/affiliate/ghi-referral-dau-vao";
import { db } from "../../lib/db";
import { clearSettingsCache } from "../../lib/settings/service";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { donKichBan, dungKichBan, type KichBan } from "./_kich-ban";
import { donAffiliateFx, dungChuoi, KHACH, taoClick, taoDoiTac, taoLead, taoReferral, themDongSo, type Chuoi } from "./_affiliate-so-fx";

if (!RUN_DB_TESTS) console.warn(`[AFR-PT-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = new Date("2026-11-05T03:00:00.000Z");
const LUC = new Date("2026-10-10T03:00:00.000Z");
const cuaToi: KichBan[] = [];
let dem = 0;

async function batCo(bat: boolean, nguon = true): Promise<void> {
  await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } }); // `datCoNguon` chỉ xoá khoá `nguon.*`; khoá thêm phải tự gỡ trước khi tạo lại
  await datCoNguon({ ...CO_NGUON_DAY_DU, enabled: nguon }, { "affiliate.enabled": bat });
}

async function taoNguoi(ten: string) {
  dem += 1;
  return seedUser({ email: `afrx-pt-${ten}-${Date.now().toString(36)}-${dem}@ci.test`, role: "PARENT", name: `PH AFRX ${ten}`, phone: null });
}

type Fx = Awaited<ReturnType<typeof dungHienTruong>>;

/**
 * A (userId=ua) và B (userId=ub) cùng ở MỘT campaign nhưng khác đối tác. Số liệu cố ý khác nhau:
 *   A: 5 lượt bấm OK + 1 lỗi · referral VALID×2 (1 đã chốt) + REJECTED_DUPLICATE×1 TRỎ VỀ PHIẾU CỦA B · sổ: 100.000 PENDING
 *   B: 7 lượt bấm OK · referral VALID×1 · sổ: 700.000 PAID + 0 khác
 */
async function dungHienTruong() {
  const k = await dungKichBan("afrpt", { coLead: false, rules: [{ vai: "SALE", rate: 0.04 }] });
  cuaToi.push(k);
  const ua = await taoNguoi("a");
  const ub = await taoNguoi("b");
  const x: Chuoi = await dungChuoi({ tenCampaign: "Chiến dịch AFRX Cổng", userId: ua.id, tenDoiTac: "Đối tác AFRX Một" });
  // L3a: số tiền hoa hồng mặc định ẨN ở cổng. Bộ này đo CÁCH LY và PII của dữ liệu tiền nên bật hiện tiền ở campaign (ca ẨN / HIỆN / hỗn hợp nằm ở tests/hoa-hong/affiliate-tai-khoan.spec.ts).
  await db.affiliateCampaign.update({ where: { id: x.campaign.id }, data: { partnerCanViewAmount: true } });
  const pb = await taoDoiTac({ campaign: x.campaign, loai: x.loai.id, ten: "Đối tác AFRX Hai", userId: ub.id, site: x.site });
  const co = { centerId: k.centerId, orgUnitId: k.ouId };
  const nenA = { partyId: x.doiTac.id, campaignId: x.campaign.id, membershipId: x.mem.id, assetId: x.asset.id, nhomId: x.nhomId };
  const nenB = { partyId: pb.doiTac.id, campaignId: x.campaign.id, membershipId: pb.mem.id, assetId: pb.asset.id, nhomId: x.nhomId };

  for (let i = 0; i < 5; i++) await taoClick({ assetId: x.asset.id, campaignId: x.campaign.id, partyId: x.doiTac.id, outcome: "OK", luc: LUC });
  await taoClick({ assetId: x.asset.id, campaignId: x.campaign.id, partyId: x.doiTac.id, outcome: "LINK_DA_THU_HOI", luc: LUC });
  for (let i = 0; i < 7; i++) await taoClick({ assetId: pb.asset.id, campaignId: x.campaign.id, partyId: pb.doiTac.id, outcome: "OK", luc: LUC });

  const leadA1 = await taoLead({ centerId: k.centerId, daDangKy: true });
  const leadA2 = await taoLead({ centerId: k.centerId, daDangKy: false });
  const leadB = await taoLead({ centerId: k.centerId, daDangKy: true });
  await taoReferral({ ...nenA, status: "VALID", luc: LUC, ...co, leadId: leadA1.id });
  await taoReferral({ ...nenA, status: "VALID", luc: LUC, ...co, leadId: leadA2.id });
  await taoReferral({ ...nenA, status: "REJECTED_DUPLICATE", luc: LUC, ...co, leadId: leadB.id }); // trỏ về phiếu của NGƯỜI GHI NHẬN TRƯỚC (đối tác B)
  await taoReferral({ ...nenB, status: "VALID", luc: LUC, ...co, leadId: leadB.id });

  await themDongSo({ ...co, campaignId: x.campaign.id, vai: "AFFILIATE", nguoiId: x.doiTac.id, ten: x.doiTac.name, amount: 100_000, payout: "PENDING" });
  await themDongSo({ ...co, campaignId: x.campaign.id, vai: "AFFILIATE", nguoiId: pb.doiTac.id, ten: pb.doiTac.name, amount: 700_000, payout: "PAID" });
  await themDongSo({ ...co, campaignId: x.campaign.id, vai: "SALE", nguoiId: k.sale.id, ten: "Sale", amount: 40_000, payout: "PENDING" }); // của nhân sự — không bao giờ lọt vào cổng đối tác
  return { k, ua, ub, x, pb, leadA1, leadA2, leadB };
}

describe.skipIf(!RUN_DB_TESTS)("[AFR-PT-DB] cổng đối tác — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    // Gốc link ngắn do CẤU HÌNH quyết (AFF-WEB): đọc từ env lúc chạy — test đặt một gốc của môi trường test để `lienKetNgan` có mặt.
    vi.stubEnv("AFFILIATE_PUBLIC_ORIGIN", "https://test.satarobo.vn");
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM", "CENTER_MANAGER"] });
  }, 180_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await donKichBan(cuaToi);
    await donAffiliateFx();
    await db.user.deleteMany({ where: { email: { startsWith: "afrx-pt-" } } });
    await db.systemSetting.deleteMany({ where: { key: { in: ["affiliate.enabled"] } } });
    await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
    clearSettingsCache();
  }, 180_000);

  it("[AFR-PT-DB-01] CROSS-USER hai chiều: A chỉ thấy phần của A, B chỉ của B; JSON của bên này không chứa token / tên / id của bên kia", async () => {
    await batCo(true);
    const f: Fx = await dungHienTruong();
    const a = await docGioiThieuCuaToi(f.ua.id, NOW);
    const b = await docGioiThieuCuaToi(f.ub.id, NOW);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    // đối chứng dương: mỗi bên thấy ĐÚNG phần của mình
    expect(a!.luotBam).toEqual({ hopLe: 5, khongDung: 1 });
    expect(b!.luotBam).toEqual({ hopLe: 7, khongDung: 0 });
    expect(a!.referral).toMatchObject({ tong: 3, daDangKy: 1 });
    // R10 · D1: cổng đối tác KHÔNG có số đếm theo trạng thái (không bao giờ là bộ dò «SĐT nào đã có trong CRM») — chỉ tổng.
    expect(Object.keys(a!.referral).sort()).toEqual(["daDangKy", "gan", "tong"]);
    expect(b!.referral).toMatchObject({ tong: 1, daDangKy: 1 });
    expect(a!.hoaHong!.theoTrangThai.PENDING).toEqual({ soDong: 1, tien: 100_000 });
    expect(a!.hoaHong!.choChi).toBe(100_000);
    expect(a!.hoaHong!.daChi).toBe(0);
    expect(b!.hoaHong!.theoTrangThai.PAID).toEqual({ soDong: 1, tien: 700_000 });
    expect(b!.hoaHong!.choChi).toBe(0);
    expect(b!.hoaHong!.daChi).toBe(700_000);
    expect(a!.link.map((l) => l.lienKetNgan)).toEqual([expect.stringContaining(f.x.token)]);
    expect(b!.link.map((l) => l.lienKetNgan)).toEqual([expect.stringContaining(f.pb.token)]);

    // đối chứng ÂM: bên này không chứa dấu vết của bên kia
    const ja = JSON.stringify(a);
    const jb = JSON.stringify(b);
    for (const cam of [f.pb.token, f.pb.doiTac.name, f.pb.doiTac.code, f.pb.doiTac.id, f.ub.id, "700000"]) expect(ja, `A chứa ${cam}`).not.toContain(cam);
    for (const cam of [f.x.token, f.x.doiTac.name, f.x.doiTac.code, f.x.doiTac.id, f.ua.id, "100000"]) expect(jb, `B chứa ${cam}`).not.toContain(cam);
    // dòng SALE (nhân sự) của cùng campaign không lọt vào hoa hồng của A
    expect(a!.hoaHong!.gan.map((h) => h.soTien)).toEqual([100_000]);
  });

  it("[AFR-PT-DB-02] KHÔNG PII: không tên / SĐT (0… lẫn 84…) / email khách, không SĐT / email đối tác, không id nội bộ, không khoá nhạy cảm", async () => {
    await batCo(true);
    const f = await dungHienTruong();
    const a = await docGioiThieuCuaToi(f.ua.id, NOW);
    const json = JSON.stringify(a);
    expect(json.length).toBeGreaterThan(300); // đối chứng dương: có dữ liệu thật để mà rò
    for (const cam of [KHACH.ten, KHACH.sdt, KHACH.sdt84, KHACH.email, "0988777666", "afrx.example.com", f.leadA1.id, f.leadA2.id, f.leadB.id, f.x.doiTac.id, f.x.campaign.id, f.k.sale.id, f.k.centerId]) {
      expect(json, `chứa ${cam}`).not.toContain(cam);
    }
    expect(json).not.toMatch(/"(phone|email|parentName|leadId|orderId|studentId|paymentId|sourceSnapshot|resolutionReason|evidence|campaignId|partyId)"/);
    // đối chứng dương: thứ được phép CÓ mặt
    expect(json).toContain(f.x.campaign.name);
    expect(json).toContain(f.x.doiTac.name);
  });

  it("[AFR-PT-DB-03] R10 · D1 — mỗi dòng referral của cổng đối tác CHỈ có {ngày, chương trình}: không trạng thái, không mã hồ sơ (cả lượt HỢP LỆ của chính A lẫn lượt «trùng» trỏ về phiếu của B)", async () => {
    await batCo(true);
    const f = await dungHienTruong();
    const a = await docGioiThieuCuaToi(f.ua.id, NOW);
    expect(a!.referral.gan).toHaveLength(3); // đối chứng dương: 2 hợp lệ + 1 trùng đều xuống
    for (const dong of a!.referral.gan) expect(Object.keys(dong).sort()).toEqual(["campaign", "luc"]);
    const json = JSON.stringify(a);
    for (const ma of [maRutGonPhieu(f.leadA1.id), maRutGonPhieu(f.leadA2.id), maRutGonPhieu(f.leadB.id)]) expect(json, `mã hồ sơ ${ma}`).not.toContain(ma);
    for (const t of ["REJECTED_DUPLICATE", "REJECTED", "MANUAL_REVIEW", "DISPUTED"]) expect(json, t).not.toContain(t);
  });

  it("[AFR-PT-DB-03b] R10 · D1 — BẤT BIẾN: đổi trạng thái referral (hợp lệ · trùng · từ chối · xem tay · tranh chấp) hoặc đổi `now` (0 ngày … 1 năm) KHÔNG làm đổi MỘT byte của {tổng, dòng gần đây, cột «referral» ở từng link} — không còn bit nào để đọc, kể cả kẻ kiên nhẫn", async () => {
    await batCo(true);
    const f = await dungHienTruong();
    const NGAY = 24 * 60 * 60 * 1000;
    // `createdAt` do DB đóng bằng đồng hồ THẬT ⇒ ghim về `LUC` để mọi so sánh theo ngày tuyệt đối (luật 19).
    await db.affiliateReferral.updateMany({ where: { partyId: f.x.doiTac.id }, data: { createdAt: LUC } });
    const doc = async (now: Date) => {
      const a = await docGioiThieuCuaToi(f.ua.id, now);
      return JSON.stringify({ tong: a!.referral.tong, gan: a!.referral.gan, soTheoLink: a!.link.map((l) => l.soReferral) });
    };
    const goc = await doc(new Date(LUC.getTime() + 2 * NGAY));
    expect(JSON.parse(goc).soTheoLink.reduce((t: number, n: number) => t + n, 0), "đối chứng dương: cột link đếm MỌI lượt (2 hợp lệ + 1 trùng), không chỉ lượt hợp lệ").toBe(3);
    expect(JSON.parse(goc).tong).toBe(3);

    for (const ngay of [0, 7, 8, 30, 365]) expect(await doc(new Date(LUC.getTime() + ngay * NGAY)), `now = +${ngay} ngày`).toBe(goc);

    for (const t of ["VALID", "REJECTED", "REJECTED_DUPLICATE", "MANUAL_REVIEW", "DISPUTED"] as const) {
      // ràng buộc DB: bị từ chối ⇔ có `rejectedAt` (AffiliateReferral_tu_choi_chk)
      await db.affiliateReferral.updateMany({ where: { partyId: f.x.doiTac.id }, data: { status: t, rejectedAt: t === "REJECTED" || t === "REJECTED_DUPLICATE" ? LUC : null } });
      expect(await doc(new Date(LUC.getTime() + 30 * NGAY)), `tất cả referral = ${t}`).toBe(goc);
    }
  });

  it("[AFR-PT-DB-04] CỜ: affiliate tắt ⇒ null / không menu; nguồn tắt (affiliate bật) ⇒ cũng null; bật cả hai ⇒ có; tài khoản không phải đối tác ⇒ null dù cờ bật", async () => {
    const f = await dungHienTruong();
    const khac = await taoNguoi("khong-phai-doi-tac");

    await batCo(true);
    expect(await coGioiThieuChoNguoiDung(f.ua.id)).toBe(true); // đối chứng dương
    expect(await docGioiThieuCuaToi(f.ua.id, NOW)).not.toBeNull();
    expect(await coGioiThieuChoNguoiDung(khac.id)).toBe(false); // không phải đối tác
    expect(await docGioiThieuCuaToi(khac.id, NOW)).toBeNull();

    await batCo(false);
    expect(await coGioiThieuChoNguoiDung(f.ua.id)).toBe(false);
    expect(await docGioiThieuCuaToi(f.ua.id, NOW)).toBeNull();

    await batCo(true, false); // affiliate bật nhưng công tắc tổng của module Nguồn tắt
    expect(await coGioiThieuChoNguoiDung(f.ua.id)).toBe(false);
    expect(await docGioiThieuCuaToi(f.ua.id, NOW)).toBeNull();

    await batCo(true);
    expect(await coGioiThieuChoNguoiDung(f.ua.id)).toBe(true); // bật lại ⇒ có lại (cờ không để lại trạng thái)
  });

  it("[AFR-PT-DB-05] một tài khoản có NHIỀU hồ sơ đối tác ⇒ gộp đúng các hồ sơ của MÌNH, không lẫn của A / B", async () => {
    await batCo(true);
    const f = await dungHienTruong();
    const ud = await taoNguoi("d");
    const d1 = await taoDoiTac({ campaign: f.x.campaign, loai: f.x.loai.id, ten: "Đối tác AFRX D1", userId: ud.id, site: f.x.site });
    const d2 = await taoDoiTac({ campaign: f.x.campaign, loai: f.x.loai.id, ten: "Đối tác AFRX D2", userId: ud.id, site: f.x.site });
    const co = { centerId: f.k.centerId, orgUnitId: f.k.ouId };
    for (let i = 0; i < 2; i++) await taoClick({ assetId: d1.asset.id, campaignId: f.x.campaign.id, partyId: d1.doiTac.id, outcome: "OK", luc: LUC });
    for (let i = 0; i < 3; i++) await taoClick({ assetId: d2.asset.id, campaignId: f.x.campaign.id, partyId: d2.doiTac.id, outcome: "OK", luc: LUC });
    await themDongSo({ ...co, campaignId: f.x.campaign.id, vai: "AFFILIATE", nguoiId: d1.doiTac.id, ten: d1.doiTac.name, amount: 11_000, payout: "PENDING" });
    await themDongSo({ ...co, campaignId: f.x.campaign.id, vai: "AFFILIATE", nguoiId: d2.doiTac.id, ten: d2.doiTac.name, amount: 22_000, payout: "PAID" });

    const d = await docGioiThieuCuaToi(ud.id, NOW);
    expect(d!.doiTac.map((x) => x.ten).sort()).toEqual(["Đối tác AFRX D1", "Đối tác AFRX D2"]);
    expect(d!.luotBam.hopLe).toBe(5);
    expect(d!.link).toHaveLength(2);
    expect(d!.hoaHong).toMatchObject({ choChi: 11_000, daChi: 22_000, daGhiSo: 33_000 });
    const json = JSON.stringify(d);
    for (const cam of [f.x.token, f.pb.token, f.x.doiTac.name, f.pb.doiTac.name]) expect(json, cam).not.toContain(cam);
  });

  it("[AFR-PT-DB-06] hồ sơ đã kết thúc vẫn xem được lịch sử (kèm trạng thái); link đã thu hồi không có địa chỉ", async () => {
    await batCo(true);
    const f = await dungHienTruong();
    await db.affiliate.update({ where: { id: f.x.doiTac.id }, data: { status: "ENDED", isActive: false } });
    await db.affiliateTrackingAsset.update({ where: { id: f.x.asset.id }, data: { status: "REVOKED", revokedAt: LUC, revokedReason: "fixture thu hồi AFRX" } });
    const a = await docGioiThieuCuaToi(f.ua.id, NOW);
    expect(a!.doiTac[0]!.trangThai).toBe("ENDED");
    expect(a!.hoaHong!.choChi).toBe(100_000); // lịch sử vẫn đọc được
    expect(a!.link).toHaveLength(1);
    expect(a!.link[0]).toMatchObject({ hoatDong: false, lienKetNgan: null, lienKetTrucTiep: null });
    expect(JSON.stringify(a)).not.toContain(f.x.token); // thu hồi ⇒ token không còn xuống trình duyệt
  });

  it("[AFR-PT-DB-07] TRANG dựng bằng dữ liệu thật: HTML của A có link của A, KHÔNG có token / tên của B hay PII; cờ tắt ⇒ 404; không phải đối tác ⇒ 404; chưa đăng nhập / không phải PARENT ⇒ /login", async () => {
    await batCo(true);
    const f = await dungHienTruong();
    const khac = await taoNguoi("khong-phai-doi-tac-2");

    PHIEN.session = { user: { id: f.ua.id, role: "PARENT" } };
    const html = renderToStaticMarkup(await GioiThieuPage());
    expect(html).toContain(f.x.token); // đối chứng dương: link của A
    expect(html).toContain(f.x.campaign.name);
    for (const cam of [f.pb.token, f.pb.doiTac.name, KHACH.ten, KHACH.sdt, KHACH.email, f.leadB.id]) expect(html, cam).not.toContain(cam);

    // cùng trang nhưng đăng nhập là B ⇒ chỉ có token của B
    PHIEN.session = { user: { id: f.ub.id, role: "PARENT" } };
    const htmlB = renderToStaticMarkup(await GioiThieuPage());
    expect(htmlB).toContain(f.pb.token);
    expect(htmlB).not.toContain(f.x.token);

    // không phải đối tác ⇒ 404
    PHIEN.session = { user: { id: khac.id, role: "PARENT" } };
    await expect(GioiThieuPage()).rejects.toThrow("NOT_FOUND");

    // cờ tắt ⇒ 404 cho cả đối tác thật
    await batCo(false);
    PHIEN.session = { user: { id: f.ua.id, role: "PARENT" } };
    await expect(GioiThieuPage()).rejects.toThrow("NOT_FOUND");
    await batCo(true);

    // chưa đăng nhập / không phải PARENT
    PHIEN.session = null;
    await expect(GioiThieuPage()).rejects.toThrow("REDIRECT:/login");
    PHIEN.session = { user: { id: f.ua.id, role: "SUPER_ADMIN" } };
    await expect(GioiThieuPage()).rejects.toThrow("REDIRECT:/login");
    PHIEN.session = null;
  });
});
