/**
 * tests/e2e/_helpers/affiliate-hien-truong.ts — HIỆN TRƯỜNG DÙNG CHUNG cho các spec Playwright của cổng đối tác Affiliate (lane L4):
 * `tests/e2e/a0/affiliate-cong-doi-tac.spec.ts` (portal + PII + cờ) và `tests/e2e/a0/affiliate-375.spec.ts` (smoke 375px).
 *
 * Tái dùng fixture của bộ vitest `tests/hoa-hong/_affiliate-so-fx.ts` (chuỗi nguồn → website → campaign → loại → đối tác → thành viên → link, referral, lượt bấm, dòng sổ)
 * và `tests/lead-intake/_nguon-fixture.ts` (danh mục nguồn gốc). KHÔNG dựng lại một bản thứ hai.
 *
 * ── HAI BẪY ĐÃ ĐO, vì sao tệp này tồn tại ────────────────────────────────────────────────────────────────────────────
 *  1. `resetDb()` TRUNCATE cả dữ liệu mà MIGRATION nạp (danh mục nguồn `UNKNOWN`, vai nhận hoa hồng `AFFILIATE`/`SALE`) — `themDongSo` `findFirstOrThrow` trên chúng. `damBaoNenDuLieu` dựng lại.
 *  2. CỜ NẰM TRONG BỘ NHỚ ĐỆM CỦA CHÍNH SERVER NEXT (`unstable_cache`, 300 giây). Tiến trình test ghi `SystemSetting` thẳng DB rồi `clearSettingsCache()` thì `safeUpdateTag` NGOÀI
 *     request context bỏ qua êm ⇒ server giữ giá trị cũ tới 5 phút, và ca "cờ tắt ⇒ 404" xanh/đỏ ngẫu nhiên. `lamMoiBoNhoCauHinh` đi đúng ĐƯỜNG THẬT (Server Action lưu cấu hình ở
 *     `/admin/cau-hinh-van-hanh`, chạy `updateTag` trong context action) bằng một lần lưu vô hại vào `nguon.cuaSoGhiCongNgay` — tag `settings` bị xoá cho MỌI khoá, nên server đọc lại DB.
 */
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { db } from "../../../lib/db";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { lienKetUser, moLaiCong, tamNgungCong } from "../../../lib/affiliate/tai-khoan-truy-cap-ghi";
import { clearSettingsCache } from "../../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, datCoNguon } from "../../lead-intake/_nguon-fixture";
import { KHACH, dungChuoi, quenIdDaNho, taoClick, taoDoiTac, taoLead, taoReferral, themDongSo, type Chuoi } from "../../hoa-hong/_affiliate-so-fx";
import { login } from "./auth";
import { resetDb, seedOrg, seedRoles, seedUser } from "./seed";

export const ADMIN_EMAIL = "aff-l4-admin@ci.test";
const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const NGUOI_GHI = { userId: "aff-l4-nguoi-ghi", ten: "AFF-L4 Marketing Hội sở" };
export const LUC = new Date("2026-10-10T03:00:00.000Z");
export const NOW = new Date("2026-11-05T03:00:00.000Z");
/** Mốc tạo referral của fixture: ĐỦ CŨ so với đồng hồ thật (lớp che kết quả 7 ngày của R9·N1 đo bằng `new Date()` của server) — ngày TUYỆT ĐỐI, luật 19. */
export const LUC_REFERRAL = new Date("2026-09-01T03:00:00.000Z");

/**
 * Chuỗi đặc trưng BỔ SUNG của khách giới thiệu (ngoài `KHACH` của fixture chung: tên · SĐT 0… / 84… · email) — PHẢI vắng mặt trong mọi phản hồi của cổng đối tác.
 * `ghiChuSale` nằm trong `Lead.note`; `hocPhi` là tổng của đơn của chính lead đó.
 */
export const KHACH_THEM = { ghiChuSale: "GHICHU-NOIBO-SALE-AFFL4", hocPhi: 7_654_321 } as const;

// ── Nền dữ liệu ────────────────────────────────────────────────────────────────────────────────────────────────────

/** TRUNCATE rồi dựng lại những gì migration nạp mà bộ này cần (xem bẫy 1 ở đầu tệp). */
export async function damBaoNenDuLieu(): Promise<{ adminId: string }> {
  await resetDb();
  // TRUNCATE xoá cả `User` ⇒ mọi phiên đã nhớ (cookie JWT trỏ id người dùng cũ) thành phiên chết. Worker chạy nhiều spec nối tiếp giữ biến module nên phải quên chúng cùng lúc.
  phienQuanTri = null;
  phienDaCo.clear();
  quenIdDaNho();
  await seedOrg(["HO", "CS1", "CS2"]);
  await seedRoles();
  await damBaoDanhMucGoc(db);
  for (const [code, name, resolverKey, isAcquisition, sortOrder] of [
    ["SALE", "Sale (người chốt đơn)", "LEAD_CONVERTED_BY", false, 10],
    ["AFFILIATE", "Cộng tác viên / đối tác", "AFFILIATE", true, 80],
  ] as const) {
    await db.beneficiaryRole.upsert({
      where: { code },
      update: {},
      create: { code, name, resolverType: code === "SALE" ? "TRANSACTION_ROLE" : "DIRECT_PERSON", resolverKey, isAcquisition, isSystem: true, isActive: true, sortOrder },
    });
  }
  // SUPER_ADMIN đứng ở HO: `actor.isSuperAdmin` suy từ `UserOrgRole`, không từ `User.role` (xem tests/e2e/a0/bang-cuon-ngang.spec.ts).
  const admin = await seedUser({ email: ADMIN_EMAIL, role: "SUPER_ADMIN", name: "Quản trị AFF-L4" });
  const ho = await db.orgUnit.findFirstOrThrow({ where: { code: "HO" }, select: { id: true } });
  const vai = await db.roleDef.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" }, select: { id: true } });
  await assignUserOrgRole(SA, { userId: admin.id, orgUnitId: ho.id, roleId: vai.id, reason: "e2e affiliate L4" });
  return { adminId: admin.id };
}

/** Ghi cờ THẲNG DB. Server chỉ thấy sau `lamMoiBoNhoCauHinh` (bẫy 2). */
export async function datCoTrongDb(c: { nguon: boolean; affiliate: boolean }): Promise<void> {
  await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
  await datCoNguon({ ...CO_NGUON_DAY_DU, enabled: c.nguon }, { "affiliate.enabled": c.affiliate });
  clearSettingsCache();
}

/**
 * Buộc SERVER đọc lại cấu hình từ DB: đăng nhập quản trị, lưu một ô vô hại (`nguon.cuaSoGhiCongNgay`) qua Server Action thật.
 * Gọi SAU `datCoTrongDb`. Dùng trình duyệt RIÊNG để không đụng phiên đang đăng nhập của ca.
 */
let phienQuanTri: Awaited<ReturnType<BrowserContext["storageState"]>> | null = null;
export async function lamMoiBoNhoCauHinh(browser: Browser): Promise<void> {
  // Đăng nhập QUẢN TRỊ đúng MỘT lần rồi dùng lại phiên: cổng chặn dò mật khẩu cho phép 5 lượt/phút theo ĐỊNH DANH (không chữa được bằng tách IP) — một ca đổi cờ 4 lần là chạm trần.
  const ctx = await browser.newContext(phienQuanTri ? { storageState: phienQuanTri } : {});
  try {
    const p = await ctx.newPage();
    if (!phienQuanTri) {
      await login(p, { email: ADMIN_EMAIL, timeout: 120_000 });
      phienQuanTri = await ctx.storageState();
    }
    await p.goto("/admin/cau-hinh-van-hanh?tab=khach-hang", { timeout: 120_000 });
    const o = p.getByLabel("Cửa sổ ghi công nguồn", { exact: true });
    await expect(o).toBeVisible({ timeout: 60_000 });
    const hienTai = Number(await o.inputValue());
    // Giá trị luôn KHÁC giá trị đang hiện (kể cả khi ô hiện số từ bộ nhớ đệm cũ) ⇒ luôn có thay đổi để lưu.
    await o.fill(String(hienTai >= 100 && hienTai < 200 ? hienTai + 1 : 100));
    await p.getByLabel("Lý do thay đổi: Cửa sổ ghi công nguồn").fill("e2e AFF-L4: làm mới bộ nhớ đệm cấu hình của server");
    await p.getByRole("button", { name: "Lưu", exact: true }).first().click();
    await expect(p.getByText("Đã lưu: Cửa sổ ghi công nguồn")).toBeVisible({ timeout: 60_000 });
  } finally {
    await ctx.close();
  }
}

/** Đặt cờ rồi buộc server nhận — một bước cho ca. */
export async function datCoVaLamMoi(browser: Browser, c: { nguon: boolean; affiliate: boolean }): Promise<void> {
  await datCoTrongDb(c);
  await lamMoiBoNhoCauHinh(browser);
}

/**
 * Đăng nhập MỘT lần cho mỗi tài khoản rồi nạp lại cookie phiên vào các trang sau. Cổng chặn dò mật khẩu cho 5 lượt/phút theo ĐỊNH DANH (tách IP không chữa được vế này — xem `_helpers/auth.ts`),
 * mà một bộ ca nối tiếp đăng nhập cùng một đối tác ở MỌI ca ⇒ ca thứ 6 trong một phút ở lại `/login` không một lỗi nào.
 */
const phienDaCo = new Map<string, Awaited<ReturnType<BrowserContext["storageState"]>>>();
export async function dangNhapCoNho(page: Page, email: string): Promise<void> {
  const cu = phienDaCo.get(email);
  if (cu) {
    await page.context().addCookies(cu.cookies);
    return;
  }
  await login(page, { email, timeout: 120_000 });
  phienDaCo.set(email, await page.context().storageState());
}

// ── Người + đối tác ────────────────────────────────────────────────────────────────────────────────────────────────

let dem = 0;
export type PhuHuynh = { id: string; email: string; hocVienId: string };

/** Phụ huynh + (mặc định) một học viên — cổng phụ huynh chỉ mở cho tài khoản có ít nhất một con. */
export async function taoPhuHuynh(ten: string, p: { coHocVien?: boolean } = {}): Promise<PhuHuynh> {
  dem += 1;
  const email = `aff-l4-${ten}-${Date.now().toString(36)}-${dem}@ci.test`;
  const u = await seedUser({ email, role: "PARENT", name: `PH AFFL4 ${ten}`, phone: null });
  let hocVienId = "";
  if (p.coHocVien !== false) {
    const hv = await db.student.create({ data: { name: `HV AFFL4 ${ten}`, parentUserId: u.id }, select: { id: true } });
    hocVienId = hv.id;
  }
  return { id: u.id, email, hocVienId };
}

/** Liên kết tài khoản với đối tác bằng ĐƯỜNG GHI THẬT của L3a (bảng nối), không gán cột legacy. */
export async function lienKet(partyId: string, userId: string, vai: "REPRESENTATIVE" | "MEMBER" = "REPRESENTATIVE"): Promise<void> {
  const kq = await lienKetUser({ nguoi: NGUOI_GHI, vao: { partyId, userId, vai }, now: NOW });
  if (!kq.ok) throw new Error(`lienKetUser: ${kq.loi}`);
}

export async function datTrangThaiCong(partyId: string, userId: string, trangThai: "ACTIVE" | "SUSPENDED"): Promise<void> {
  const row = await db.affiliatePartyUser.findUniqueOrThrow({ where: { partyId_userId: { partyId, userId } } });
  const vao = { id: row.id, updatedAtDaThay: row.updatedAt.toISOString(), lyDo: "e2e AFF-L4 đổi trạng thái cổng" };
  const kq = trangThai === "SUSPENDED" ? await tamNgungCong({ nguoi: NGUOI_GHI, vao, now: NOW }) : await moLaiCong({ nguoi: NGUOI_GHI, vao, now: NOW });
  if (!kq.ok) throw new Error(`datTrangThaiCong(${trangThai}): ${kq.loi}`);
}

export type HienTruong = Awaited<ReturnType<typeof dungHienTruongDoiTac>>;

/**
 * Hai đối tác A và B trong CÙNG MỘT campaign, mỗi bên một tài khoản phụ huynh có học viên, số liệu cố ý KHÁC NHAU để trộn hai bên lộ ra thành số sai:
 *   A: 5 lượt bấm OK + 1 lỗi · referral VALID×2 (1 đã chốt) · sổ AFFILIATE nhiều trạng thái (số lẻ đặc trưng)
 *   B: 7 lượt bấm OK · referral VALID×1 · sổ 700.000 PAID
 * `partnerCanViewAmount` của campaign để NULL (mặc định ẨN) — ca nào cần hiện thì tự bật.
 */
export async function dungHienTruongDoiTac() {
  const ua = await taoPhuHuynh("a");
  const ub = await taoPhuHuynh("b");
  const x: Chuoi = await dungChuoi({ tenCampaign: "Chiến dịch AFRX Cổng L4", userId: null, tenDoiTac: "Đối tác AFRX Một" });
  const pb = await taoDoiTac({ campaign: x.campaign, loai: x.loai.id, ten: "Đối tác AFRX Hai", userId: null, site: x.site });
  await lienKet(x.doiTac.id, ua.id);
  await lienKet(pb.doiTac.id, ub.id);

  const trungTam = await db.center.findFirstOrThrow({ where: { code: "CS1" }, select: { id: true } });
  const donVi = await db.orgUnit.findFirstOrThrow({ where: { code: "CS1" }, select: { id: true } });
  const co = { centerId: trungTam.id, orgUnitId: donVi.id };
  const nenA = { partyId: x.doiTac.id, campaignId: x.campaign.id, membershipId: x.mem.id, assetId: x.asset.id, nhomId: x.nhomId };
  const nenB = { partyId: pb.doiTac.id, campaignId: x.campaign.id, membershipId: pb.mem.id, assetId: pb.asset.id, nhomId: x.nhomId };

  for (let i = 0; i < 5; i++) await taoClick({ assetId: x.asset.id, campaignId: x.campaign.id, partyId: x.doiTac.id, outcome: "OK", luc: LUC });
  await taoClick({ assetId: x.asset.id, campaignId: x.campaign.id, partyId: x.doiTac.id, outcome: "LINK_DA_THU_HOI", luc: LUC });
  for (let i = 0; i < 7; i++) await taoClick({ assetId: pb.asset.id, campaignId: x.campaign.id, partyId: pb.doiTac.id, outcome: "OK", luc: LUC });

  // Khách THẬT của A (đã đăng ký, có đơn học phí + ghi chú nội bộ của Sale) và của B — chuỗi đặc trưng để assert VẮNG MẶT.
  const leadA1 = await taoLead({ centerId: trungTam.id, daDangKy: true });
  await db.lead.update({ where: { id: leadA1.id }, data: { note: KHACH_THEM.ghiChuSale } });
  await db.order.create({
    data: { code: `ORD-AFFL4-${Date.now().toString(36)}`, type: "COURSE", customerName: KHACH.ten, customerPhone: KHACH.sdt, totalAmount: KHACH_THEM.hocPhi, leadId: leadA1.id, centerId: trungTam.id },
  });
  const leadA2 = await taoLead({ centerId: trungTam.id, daDangKy: false });
  const leadB = await taoLead({ centerId: trungTam.id, daDangKy: true });
  await taoReferral({ ...nenA, status: "VALID", luc: LUC_REFERRAL, ...co, leadId: leadA1.id });
  await taoReferral({ ...nenA, status: "VALID", luc: LUC_REFERRAL, ...co, leadId: leadA2.id });
  await taoReferral({ ...nenB, status: "VALID", luc: LUC_REFERRAL, ...co, leadId: leadB.id });

  return { ua, ub, x, pb, leadA1, leadA2, leadB, co, trungTam, donVi };
}

/** Bốn dòng sổ của A — mỗi trạng thái chi một số LẺ riêng để đối chiếu từng ô; và một dòng 700.000 của B. */
export const TIEN_A = { PENDING: 123_457, APPROVED: 234_568, EXPORTED: 345_679, PAID: 456_790 } as const;
export const TIEN_B = 707_070;

export async function themSoCuaA(f: HienTruong): Promise<void> {
  const co = { ...f.co, campaignId: f.x.campaign.id, vai: "AFFILIATE" as const };
  for (const [payout, amount] of Object.entries(TIEN_A) as [keyof typeof TIEN_A, number][]) {
    await themDongSo({ ...co, nguoiId: f.x.doiTac.id, ten: f.x.doiTac.name, amount, payout, luc: LUC });
  }
  await themDongSo({ ...co, nguoiId: f.pb.doiTac.id, ten: f.pb.doiTac.name, amount: TIEN_B, payout: "PAID", luc: LUC });
}

export async function datHienTien(campaignId: string, giaTri: boolean | null): Promise<void> {
  await db.affiliateCampaign.update({ where: { id: campaignId }, data: { partnerCanViewAmount: giaTri } });
}

// ── Đọc phản hồi MÁY CHỦ ───────────────────────────────────────────────────────────────────────────────────────────

export type PhanHoiCong = { trangThai: number; html: string; rsc: string };

/**
 * Lấy THÂN phản hồi của máy chủ cho `/portal/gioi-thieu` bằng HAI đường: HTML đầy đủ (gồm `self.__next_f` — payload RSC nhúng) và luồng RSC thuần (`RSC: 1`).
 * Dùng chung cookie phiên của `page` (page.request). Đây là thứ rời máy chủ — ẩn ở UI mà vẫn nằm đây là LỘ.
 */
export async function layPhanHoiCong(page: Page, duong = "/portal/gioi-thieu"): Promise<PhanHoiCong> {
  const html = await page.request.get(duong, { maxRedirects: 0 });
  const rsc = await page.request.get(duong, { headers: { RSC: "1" }, maxRedirects: 0 });
  return { trangThai: html.status(), html: await html.text(), rsc: await rsc.text() };
}

