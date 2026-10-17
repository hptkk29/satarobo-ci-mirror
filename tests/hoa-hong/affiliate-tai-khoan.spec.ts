// @vitest-environment node
/**
 * [ATK-DB-*] — TÀI KHOẢN TRUY CẬP CỔNG CỦA ĐỐI TÁC (User ↔ AffiliateParty) + CÔNG TẮC HIỆN SỐ TIỀN trên Postgres THẬT (AFF-L3a; docs/source-commission/closeout/l3a-doi-tac-tai-khoan.md).
 *
 * Mục tiêu: (1) quan hệ nhiều–nhiều đúng và gỡ / tạm ngừng THẬT SỰ chặn cổng (không bị cột legacy `Affiliate.userId` hoàn tác); (2) cổng đối tác CHỈ thấy dữ liệu của Party mình qua bảng nối (CROSS-USER);
 * (3) số tiền hoa hồng CHỈ xuống trình duyệt khi cấu hình cho phép — kiểm bằng PAYLOAD thật, không bằng giao diện. Mọi ca "không thấy X" có ĐỐI CHỨNG DƯƠNG.
 *
 *   [ATK-DB-01] BACKFILL từ `Affiliate.userId`: dòng hợp lệ → ĐẠI DIỆN ACTIVE; null / user không tồn tại → không; chạy lại KHÔNG đổi gì và KHÔNG đè dòng đã gỡ (đọc CHÍNH khối SQL trong migration)
 *   [ATK-DB-02] vòng đời: liên kết · một người đại diện (đua!) · đổi đại diện · gỡ KHÔNG xoá gì · liên kết lại = mở lại dòng cũ · tạm ngừng / mở lại · khoá lạc quan · lý do ≥ 10 ký tự · tài khoản không hợp lệ · nhận nuôi liên kết cũ
 *   [ATK-DB-03] nhiều–nhiều: một User nhiều Party; một Party nhiều User; menu ≡ trang ở MỌI trạng thái
 *   [ATK-DB-04] CROSS-USER qua bảng nối + cột legacy KHÔNG hoàn tác gỡ / tạm ngừng
 *   [ATK-DB-05] TRANG dựng bằng dữ liệu thật: tạm ngừng ⇒ 404 (còn Party khác thì chỉ thấy Party khác); mở lại ⇒ vào lại
 *   [ATK-DB-06] SỐ TIỀN: mặc định ẨN; campaign > loại > mặc định; hỗn hợp (một campaign hiện, một ẩn); payload JSON + HTML thật không chứa số bị ẩn
 *   [ATK-DB-07] audit CÙNG giao dịch, không PII; CHECK / UNIQUE của migration chặn THẬT bằng SQL trực tiếp
 *   [ATK-DB-08] ô tìm tài khoản: tối thiểu 3 ký tự, trần 8, che liên hệ, loại nhân viên / bị khoá / đã liên kết; danh sách tài khoản che PII theo `coTheXemLienHe`; tự giới thiệu so MỌI tài khoản còn gắn
 *   [ATK-DB-09] ghi cờ hiện tiền: `partnerCanViewAmount` của campaign (cả khi đang chạy) và loại được lưu + vào nhật ký
 *   [ATK-DB-10] onboarding: checklist đọc từ DB thật khớp cổng; ghi danh được / không được theo cổng; nguồn thiếu cấu hình hiện «cần xem tay»
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng fixture (tiền tố AFRX/ATKX), chạy được MỘT MÌNH. LUẬT 19: ngày tuyệt đối. KHÔNG `resetDb()`.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  // Trang cổng có form «Tạo link» (client, dùng useRouter) — dựng ở đây chỉ để render được HTML; hành vi của nó: affiliate-nhieu-website.spec.ts.
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("@/app/(portal)/portal/gioi-thieu/_actions", () => ({ taoLinkCuaToiAction: async () => ({ ok: false, loi: "mock" }), taoQrCuaToiAction: async () => ({ ok: false, loi: "mock" }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => React.createElement("a", { href, ...rest }, children),
}));
vi.setConfig({ testTimeout: 90_000 });

import GioiThieuPage from "../../app/(portal)/portal/gioi-thieu/page";
import { coGioiThieuChoNguoiDung, docGioiThieuCuaToi } from "../../lib/affiliate/doc-cua-toi";
import { docOnboardingDoiTac } from "../../lib/affiliate/doc-ho-so-doi-tac";
import { suaCampaign } from "../../lib/affiliate/ghi-campaign";
import { suaLoai } from "../../lib/affiliate/ghi-loai-nhan";
import { doiTrangThaiDoiTac } from "../../lib/affiliate/ghi-doi-tac";
import { partyIdsVaoDuoc, timUserDeLienKet, docTruyCapCuaDoiTac, userIdsGanVoiDoiTac } from "../../lib/affiliate/tai-khoan-truy-cap";
import { doiDaiDien, goLienKet, lienKetUser, moLaiCong, tamNgungCong } from "../../lib/affiliate/tai-khoan-truy-cap-ghi";
import { db } from "../../lib/db";
import { clearSettingsCache } from "../../lib/settings/service";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { donKichBan, dungKichBan, type KichBan } from "./_kich-ban";
import { donAffiliateFx, dungChuoi, taoClick, taoDoiTac, taoLead, taoReferral, themDongSo } from "./_affiliate-so-fx";

if (!RUN_DB_TESTS) console.warn(`[ATK-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = new Date("2026-11-05T03:00:00.000Z");
const LUC = new Date("2026-10-10T03:00:00.000Z");
const NGUOI = { userId: "atkx-nguoi-ghi", ten: "ATKX Marketing Hội sở" };
const LY_DO = "Đã trao đổi với đối tác, đóng cổng tạm thời";
const cuaToi: KichBan[] = [];
let dem = 0;

async function batCo(bat: boolean, nguon = true): Promise<void> {
  await db.systemSetting.deleteMany({ where: { key: "affiliate.enabled" } });
  await datCoNguon({ ...CO_NGUON_DAY_DU, enabled: nguon }, { "affiliate.enabled": bat });
}

async function taoNguoi(ten: string, p: { role?: "PARENT" | "SALES_CSM" | "TEACHER"; roles?: ("PARENT" | "SALES_CSM" | "TEACHER")[] } = {}) {
  dem += 1;
  return seedUser({ email: `atkx-${ten}-${Date.now().toString(36)}-${dem}@ci.test`, role: p.role ?? "PARENT", roles: p.roles, name: `PH ATKX ${ten}`, phone: null });
}

/** Một học viên cho phụ huynh — cổng phụ huynh chỉ mở cho tài khoản có ít nhất một con. */
const cho1Con = (parentUserId: string) => db.student.create({ data: { name: `ATKX Bé ${dem}-${Date.now()}`, parentUserId } });

/** Một đối tác ACTIVE trơn (loại + campaign + link) không gắn User nào. */
const dungP = (ten = "Đối tác ATKX") => dungChuoi({ tenDoiTac: ten, userId: null });

const lienKet = (partyId: string, userId: string, vai: "REPRESENTATIVE" | "MEMBER") => lienKetUser({ nguoi: NGUOI, vao: { partyId, userId, vai }, now: NOW });
const dongCua = (partyId: string) => db.affiliatePartyUser.findMany({ where: { partyId }, orderBy: { createdAt: "asc" } });
const rowCua = (partyId: string, userId: string) => db.affiliatePartyUser.findUniqueOrThrow({ where: { partyId_userId: { partyId, userId } } });
const cotCu = async (partyId: string) => (await db.affiliate.findUniqueOrThrow({ where: { id: partyId }, select: { userId: true } })).userId;

describe.skipIf(!RUN_DB_TESTS)("[ATK-DB] tài khoản truy cập cổng đối tác — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM", "CENTER_MANAGER"] });
  }, 180_000);

  afterAll(async () => {
    await donKichBan(cuaToi);
    await db.student.deleteMany({ where: { name: { startsWith: "ATKX" } } });
    await donAffiliateFx();
    await db.user.deleteMany({ where: { email: { startsWith: "atkx-" } } });
    await db.systemSetting.deleteMany({ where: { key: { in: ["affiliate.enabled"] } } });
    await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
    clearSettingsCache();
  }, 180_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it("[ATK-DB-01] BACKFILL: chạy ĐÚNG khối SQL của migration — hợp lệ → ĐẠI DIỆN ACTIVE; null / user không có → không; chạy lại không đổi gì và không đè dòng đã gỡ", async () => {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261025111500_affiliate_tai_khoan_truy_cap/migration.sql"), "utf8");
    const khoi = sql.slice(sql.indexOf("-- BACKFILL:BEGIN") + "-- BACKFILL:BEGIN".length, sql.indexOf("-- BACKFILL:END"));
    expect(khoi).toContain("ON CONFLICT");
    expect(khoi).toContain('JOIN "User"'); // chỉ userId hợp lệ
    // Giới hạn vào fixture của bộ này (khối SQL gốc quét MỌI Affiliate — chạy nguyên văn sẽ thêm dòng cho đối tác của bộ khác); chỉ thêm MỘT điều kiện, phần còn lại nguyên văn.
    const GOC = 'WHERE a."userId" IS NOT NULL';
    expect(khoi.split(GOC).length - 1).toBe(1);
    const chay = () => db.$executeRawUnsafe(khoi.replace(GOC, `${GOC} AND a."code" LIKE 'AFRX%'`));

    const u1 = await taoNguoi("bf1");
    const hopLe = await dungP("Đối tác BF hợp lệ");
    const mo = await dungP("Đối tác BF user không tồn tại");
    const trong = await dungP("Đối tác BF không user");
    await db.affiliate.update({ where: { id: hopLe.doiTac.id }, data: { userId: u1.id } });
    await db.affiliate.update({ where: { id: mo.doiTac.id }, data: { userId: "atkx-user-khong-ton-tai" } });
    const ids = [hopLe.doiTac.id, mo.doiTac.id, trong.doiTac.id];
    const dong = () => db.affiliatePartyUser.findMany({ where: { partyId: { in: ids } } });

    await chay();
    const lan1 = await dong();
    expect(lan1).toHaveLength(1);
    expect(lan1[0]).toMatchObject({ partyId: hopLe.doiTac.id, userId: u1.id, role: "REPRESENTATIVE", status: "ACTIVE", revokedAt: null });
    expect(await partyIdsVaoDuoc(u1.id)).toEqual([hopLe.doiTac.id]); // đối chứng dương: cổng vào được

    await chay();
    const lan2 = await dong();
    expect(lan2.map((r) => r.id)).toEqual(lan1.map((r) => r.id)); // idempotent: cùng dòng, không thêm
    expect(lan2).toHaveLength(1);

    // đã gỡ (vì lý do nào đó) thì chạy lại KHÔNG phục hồi
    await db.affiliatePartyUser.update({ where: { id: lan1[0]!.id }, data: { status: "REVOKED", statusReason: LY_DO, revokedAt: LUC } });
    await chay();
    const lan3 = await dong();
    expect(lan3).toHaveLength(1);
    expect(lan3[0]).toMatchObject({ status: "REVOKED" });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it("[ATK-DB-02a] liên kết: đại diện + thành viên; cột legacy = người đại diện; nhật ký CÙNG giao dịch, KHÔNG PII", async () => {
    const x = await dungP();
    const ua = await taoNguoi("dd");
    const ub = await taoNguoi("tv");
    const r1 = await lienKet(x.doiTac.id, ua.id, "REPRESENTATIVE");
    expect(r1).toMatchObject({ ok: true, viec: "TAO" });
    expect(await cotCu(x.doiTac.id)).toBe(ua.id);
    const r2 = await lienKet(x.doiTac.id, ub.id, "MEMBER");
    expect(r2).toMatchObject({ ok: true, viec: "TAO" });
    expect(await cotCu(x.doiTac.id)).toBe(ua.id); // thành viên không đổi cột legacy
    expect((await dongCua(x.doiTac.id)).map((r) => [r.userId, r.role, r.status])).toEqual([
      [ua.id, "REPRESENTATIVE", "ACTIVE"],
      [ub.id, "MEMBER", "ACTIVE"],
    ]);
    const au = await db.auditLog.findMany({ where: { entityType: "AffiliatePartyUser", entityId: { in: (await dongCua(x.doiTac.id)).map((r) => r.id) } } });
    expect(au.map((a) => a.action).sort()).toEqual(["AFFILIATE_TRUY_CAP_LIEN_KET", "AFFILIATE_TRUY_CAP_LIEN_KET"]);
    const json = JSON.stringify(au);
    for (const cam of [ua.email, ub.email, "0988777666", x.doiTac.email as string]) expect(json, cam).not.toContain(cam);
    expect(json).toContain(ua.id); // đối chứng dương: id tài khoản có mặt (nhật ký không rỗng)
  });

  it("[ATK-DB-02b] MỘT người đại diện chưa gỡ: liên kết đại diện thứ hai bị từ chối bằng câu chỉ đường, DB KHÔNG đổi; ĐUA hai lượt cùng lúc ⇒ đúng một thắng", async () => {
    const x = await dungP();
    const ua = await taoNguoi("dd1");
    const ub = await taoNguoi("dd2");
    await lienKet(x.doiTac.id, ua.id, "REPRESENTATIVE");
    const truoc = await dongCua(x.doiTac.id);
    const r = await lienKet(x.doiTac.id, ub.id, "REPRESENTATIVE");
    expect(r).toMatchObject({ ok: false, truong: "vai" });
    if (!r.ok) expect(r.loi).toContain("Đổi người đại diện");
    expect(await dongCua(x.doiTac.id)).toEqual(truoc);
    expect(await cotCu(x.doiTac.id)).toBe(ua.id);

    // đua: đối tác MỚI, hai tài khoản cùng xin làm đại diện
    const y = await dungP();
    const u1 = await taoNguoi("dua1");
    const u2 = await taoNguoi("dua2");
    const [a, b] = await Promise.all([lienKet(y.doiTac.id, u1.id, "REPRESENTATIVE"), lienKet(y.doiTac.id, u2.id, "REPRESENTATIVE")]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const dd = (await dongCua(y.doiTac.id)).filter((r) => r.role === "REPRESENTATIVE" && r.status !== "REVOKED");
    expect(dd).toHaveLength(1);
    expect(await cotCu(y.doiTac.id)).toBe(dd[0]!.userId);
  });

  it("[ATK-DB-02c] ĐỔI người đại diện: người cũ thành thành viên, người mới là đại diện, cột legacy theo người mới; điều kiện bị từ chối ⇒ DB không đổi", async () => {
    const x = await dungP();
    const ua = await taoNguoi("c-a");
    const ub = await taoNguoi("c-b");
    const uc = await taoNguoi("c-c");
    await lienKet(x.doiTac.id, ua.id, "REPRESENTATIVE");
    await lienKet(x.doiTac.id, ub.id, "MEMBER");
    await lienKet(x.doiTac.id, uc.id, "MEMBER");

    // người mới đang TẠM NGỪNG ⇒ từ chối, không đổi gì
    const rc = await rowCua(x.doiTac.id, uc.id);
    expect(await tamNgungCong({ nguoi: NGUOI, vao: { id: rc.id, updatedAtDaThay: rc.updatedAt.toISOString(), lyDo: LY_DO }, now: NOW })).toMatchObject({ ok: true });
    const truoc = await dongCua(x.doiTac.id);
    const rc2 = await rowCua(x.doiTac.id, uc.id);
    const tuChoi = await doiDaiDien({ nguoi: NGUOI, vao: { partyId: x.doiTac.id, id: rc2.id, updatedAtDaThay: rc2.updatedAt.toISOString() }, now: NOW });
    expect(tuChoi).toMatchObject({ ok: false });
    expect(await dongCua(x.doiTac.id)).toEqual(truoc);

    // đối chứng dương: thành viên ACTIVE ⇒ đổi được
    const rb = await rowCua(x.doiTac.id, ub.id);
    const ok = await doiDaiDien({ nguoi: NGUOI, vao: { partyId: x.doiTac.id, id: rb.id, updatedAtDaThay: rb.updatedAt.toISOString() }, now: NOW });
    expect(ok).toMatchObject({ ok: true });
    expect((await rowCua(x.doiTac.id, ua.id)).role).toBe("MEMBER");
    expect((await rowCua(x.doiTac.id, ub.id)).role).toBe("REPRESENTATIVE");
    expect(await cotCu(x.doiTac.id)).toBe(ub.id);
    expect((await dongCua(x.doiTac.id)).filter((r) => r.role === "REPRESENTATIVE" && r.status !== "REVOKED")).toHaveLength(1);
  });

  it("[ATK-DB-02d] GỠ liên kết: dòng REVOKED + lý do + revokedAt, cột legacy về null (không rơi sang thành viên); Party, membership, link, referral, sổ KHÔNG bị đụng", async () => {
    const k = await dungKichBan("atkd", { coLead: false, rules: [{ vai: "SALE", rate: 0.04 }] });
    cuaToi.push(k);
    const x = await dungP();
    const ua = await taoNguoi("g-a");
    const ub = await taoNguoi("g-b");
    await lienKet(x.doiTac.id, ua.id, "REPRESENTATIVE");
    await lienKet(x.doiTac.id, ub.id, "MEMBER");
    const lead = await taoLead({ centerId: k.centerId, daDangKy: true });
    await taoReferral({ partyId: x.doiTac.id, campaignId: x.campaign.id, membershipId: x.mem.id, assetId: x.asset.id, nhomId: x.nhomId, status: "VALID", luc: LUC, centerId: k.centerId, orgUnitId: k.ouId, leadId: lead.id });
    await themDongSo({ centerId: k.centerId, orgUnitId: k.ouId, campaignId: x.campaign.id, vai: "AFFILIATE", nguoiId: x.doiTac.id, ten: x.doiTac.name, amount: 55_000 });
    const kiemKe = async () => ({
      party: await db.affiliate.count({ where: { id: x.doiTac.id } }),
      mem: await db.affiliateMembership.count({ where: { partyId: x.doiTac.id } }),
      asset: await db.affiliateTrackingAsset.count({ where: { partyId: x.doiTac.id } }),
      rf: await db.affiliateReferral.count({ where: { partyId: x.doiTac.id } }),
      so: await db.commissionTransaction.count({ where: { beneficiaryAffiliateId: x.doiTac.id } }),
      lead: await db.lead.count({ where: { id: lead.id } }),
    });
    const truoc = await kiemKe();
    expect(truoc).toEqual({ party: 1, mem: 1, asset: 1, rf: 1, so: 1, lead: 1 }); // đối chứng dương: có dữ liệu để mà "bị xoá"

    const ra = await rowCua(x.doiTac.id, ua.id);
    // lý do ngắn / thiếu ⇒ từ chối, không đổi
    for (const lyDo of [null, "ngắn", "         "]) {
      const r = await goLienKet({ nguoi: NGUOI, vao: { id: ra.id, updatedAtDaThay: ra.updatedAt.toISOString(), lyDo }, now: NOW });
      expect(r, String(lyDo)).toMatchObject({ ok: false, truong: "lyDo" });
    }
    expect(await rowCua(x.doiTac.id, ua.id)).toMatchObject({ status: "ACTIVE", revokedAt: null });
    expect(await cotCu(x.doiTac.id)).toBe(ua.id);

    const r = await goLienKet({ nguoi: NGUOI, vao: { id: ra.id, updatedAtDaThay: ra.updatedAt.toISOString(), lyDo: LY_DO }, now: NOW });
    expect(r).toMatchObject({ ok: true });
    const sau = await rowCua(x.doiTac.id, ua.id);
    expect(sau).toMatchObject({ status: "REVOKED", statusReason: LY_DO, statusChangedById: NGUOI.userId });
    expect(sau.revokedAt).not.toBeNull();
    expect(await cotCu(x.doiTac.id)).toBeNull(); // không rơi sang thành viên ub
    expect((await rowCua(x.doiTac.id, ub.id)).status).toBe("ACTIVE");
    expect(await kiemKe()).toEqual(truoc); // KHÔNG xoá gì
    expect(await partyIdsVaoDuoc(ua.id)).toEqual([]);
    expect(await partyIdsVaoDuoc(ub.id)).toEqual([x.doiTac.id]); // đối chứng dương
  });

  it("[ATK-DB-02e] liên kết LẠI tài khoản đã gỡ = MỞ LẠI đúng dòng cũ (cùng id), xoá dấu gỡ, vai theo lần chọn mới", async () => {
    const x = await dungP();
    const ua = await taoNguoi("l-a");
    await lienKet(x.doiTac.id, ua.id, "REPRESENTATIVE");
    const goc = await rowCua(x.doiTac.id, ua.id);
    await goLienKet({ nguoi: NGUOI, vao: { id: goc.id, updatedAtDaThay: goc.updatedAt.toISOString(), lyDo: LY_DO }, now: NOW });
    const r = await lienKet(x.doiTac.id, ua.id, "MEMBER");
    expect(r).toMatchObject({ ok: true, viec: "MO_LAI", id: goc.id });
    expect(await dongCua(x.doiTac.id)).toHaveLength(1); // không dòng trùng
    expect(await rowCua(x.doiTac.id, ua.id)).toMatchObject({ role: "MEMBER", status: "ACTIVE", revokedAt: null, statusReason: null });
    expect(await cotCu(x.doiTac.id)).toBeNull(); // mở lại làm thành viên ⇒ không phải đại diện
    // đang liên kết rồi mà liên kết nữa ⇒ từ chối
    expect(await lienKet(x.doiTac.id, ua.id, "MEMBER")).toMatchObject({ ok: false, truong: "userId" });
  });

  it("[ATK-DB-02f] TẠM NGỪNG / MỞ LẠI cổng: lý do ≥ 10 ký tự; khoá lạc quan; mở lại kiểm lại tài khoản; dữ liệu giữ nguyên", async () => {
    const x = await dungP();
    const ua = await taoNguoi("t-a");
    await lienKet(x.doiTac.id, ua.id, "MEMBER");
    const r0 = await rowCua(x.doiTac.id, ua.id);
    expect(await tamNgungCong({ nguoi: NGUOI, vao: { id: r0.id, updatedAtDaThay: r0.updatedAt.toISOString(), lyDo: "ngắn" }, now: NOW })).toMatchObject({ ok: false, truong: "lyDo" });
    // khoá lạc quan: mốc cũ ⇒ "vừa được người khác thay đổi", DB không đổi
    expect(await tamNgungCong({ nguoi: NGUOI, vao: { id: r0.id, updatedAtDaThay: new Date("2020-01-01T00:00:00.000Z").toISOString(), lyDo: LY_DO }, now: NOW })).toMatchObject({ ok: false, truong: "vuaDoi" });
    expect((await rowCua(x.doiTac.id, ua.id)).status).toBe("ACTIVE");

    const ok = await tamNgungCong({ nguoi: NGUOI, vao: { id: r0.id, updatedAtDaThay: r0.updatedAt.toISOString(), lyDo: LY_DO }, now: NOW });
    expect(ok).toMatchObject({ ok: true });
    const r1 = await rowCua(x.doiTac.id, ua.id);
    expect(r1).toMatchObject({ status: "SUSPENDED", statusReason: LY_DO, revokedAt: null });
    expect(await partyIdsVaoDuoc(ua.id)).toEqual([]);
    // dùng lại mốc CŨ lần nữa ⇒ vuaDoi (mốc đã nhích)
    expect(await moLaiCong({ nguoi: NGUOI, vao: { id: r0.id, updatedAtDaThay: r0.updatedAt.toISOString(), lyDo: null }, now: NOW })).toMatchObject({ ok: false, truong: "vuaDoi" });

    // tài khoản bị khoá trong lúc đang tạm ngừng ⇒ mở lại bị từ chối
    await db.user.update({ where: { id: ua.id }, data: { accountStatus: "DISABLED" } });
    expect(await moLaiCong({ nguoi: NGUOI, vao: { id: r1.id, updatedAtDaThay: r1.updatedAt.toISOString(), lyDo: null }, now: NOW })).toMatchObject({ ok: false, truong: "userId" });
    expect((await rowCua(x.doiTac.id, ua.id)).status).toBe("SUSPENDED");
    await db.user.update({ where: { id: ua.id }, data: { accountStatus: "ACTIVE" } });
    expect(await moLaiCong({ nguoi: NGUOI, vao: { id: r1.id, updatedAtDaThay: r1.updatedAt.toISOString(), lyDo: null }, now: NOW })).toMatchObject({ ok: true });
    expect(await rowCua(x.doiTac.id, ua.id)).toMatchObject({ status: "ACTIVE", statusReason: null });
    expect(await partyIdsVaoDuoc(ua.id)).toEqual([x.doiTac.id]);
  });

  it("[ATK-DB-02g] tài khoản KHÔNG liên kết được (nhân viên · phụ huynh kiêm nhân viên · bị khoá · đã xoá · không tồn tại) và đối tác ENDED ⇒ từ chối, DB không đổi; đối chứng dương: phụ huynh thường qua", async () => {
    const x = await dungP();
    const nv = await taoNguoi("nv", { role: "SALES_CSM" });
    const kiem = await taoNguoi("kiem", { role: "PARENT", roles: ["PARENT", "TEACHER"] });
    const khoa = await taoNguoi("khoa");
    await db.user.update({ where: { id: khoa.id }, data: { accountStatus: "DISABLED" } });
    const xoa = await taoNguoi("xoa");
    await db.user.update({ where: { id: xoa.id }, data: { deletedAt: new Date("2026-10-01T00:00:00.000Z") } });
    for (const [ten, id] of [["nhân viên", nv.id], ["kiêm nhân viên", kiem.id], ["bị khoá", khoa.id], ["đã xoá", xoa.id], ["không tồn tại", "atkx-khong-co"]] as const) {
      expect(await lienKet(x.doiTac.id, id, "MEMBER"), ten).toMatchObject({ ok: false, truong: "userId" });
    }
    expect(await dongCua(x.doiTac.id)).toHaveLength(0);

    const tot = await taoNguoi("tot");
    expect(await lienKet(x.doiTac.id, tot.id, "MEMBER")).toMatchObject({ ok: true }); // đối chứng dương

    const y = await dungP();
    const ph = await taoNguoi("ph");
    await db.affiliate.update({ where: { id: y.doiTac.id }, data: { status: "ENDED", isActive: false } });
    expect(await lienKet(y.doiTac.id, ph.id, "MEMBER")).toMatchObject({ ok: false, truong: "partyId" });
    expect(await dongCua(y.doiTac.id)).toHaveLength(0);
    expect(await lienKet("atkx-doi-tac-khong-co", ph.id, "MEMBER")).toMatchObject({ ok: false, truong: "partyId" });
  });

  it("[ATK-DB-02h] NHẬN NUÔI liên kết cũ: Party có `Affiliate.userId` gắn bằng SQL (chưa có dòng nối) — thêm một tài khoản qua màn mới KHÔNG tước quyền của người cũ", async () => {
    const x = await dungP();
    const cu = await taoNguoi("nuoi-cu");
    const moi = await taoNguoi("nuoi-moi");
    await db.affiliate.update({ where: { id: x.doiTac.id }, data: { userId: cu.id } });
    expect(await dongCua(x.doiTac.id)).toHaveLength(0);
    expect(await partyIdsVaoDuoc(cu.id)).toEqual([x.doiTac.id]); // đường lùi legacy còn sống

    expect(await lienKet(x.doiTac.id, moi.id, "MEMBER")).toMatchObject({ ok: true });
    const dong = await dongCua(x.doiTac.id);
    expect(dong.map((r) => [r.userId, r.role, r.status]).sort()).toEqual([[cu.id, "REPRESENTATIVE", "ACTIVE"], [moi.id, "MEMBER", "ACTIVE"]].sort());
    expect(await cotCu(x.doiTac.id)).toBe(cu.id); // KHÔNG bị ghi null
    expect(await partyIdsVaoDuoc(cu.id)).toEqual([x.doiTac.id]);
    const au = await db.auditLog.findMany({ where: { action: "AFFILIATE_TRUY_CAP_NHAN_NUOI", entityId: { in: dong.map((r) => r.id) } } });
    expect(au).toHaveLength(1);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it("[ATK-DB-03] NHIỀU–NHIỀU: một User đại diện nhiều Party, một Party nhiều User; menu ≡ trang ở MỌI trạng thái", async () => {
    await batCo(true);
    const x = await dungP("Đối tác ATKX Một");
    const y = await dungP("Đối tác ATKX Hai");
    const ua = await taoNguoi("nn-a");
    const ub = await taoNguoi("nn-b");
    await lienKet(x.doiTac.id, ua.id, "REPRESENTATIVE");
    await lienKet(y.doiTac.id, ua.id, "REPRESENTATIVE"); // cùng một User đại diện cả hai Party
    await lienKet(x.doiTac.id, ub.id, "MEMBER"); // Party x có hai User
    for (let i = 0; i < 3; i++) await taoClick({ assetId: x.asset.id, campaignId: x.campaign.id, partyId: x.doiTac.id, outcome: "OK", luc: LUC });
    for (let i = 0; i < 4; i++) await taoClick({ assetId: y.asset.id, campaignId: y.campaign.id, partyId: y.doiTac.id, outcome: "OK", luc: LUC });

    expect((await partyIdsVaoDuoc(ua.id)).sort()).toEqual([x.doiTac.id, y.doiTac.id].sort());
    expect(await partyIdsVaoDuoc(ub.id)).toEqual([x.doiTac.id]);
    const a = await docGioiThieuCuaToi(ua.id, NOW);
    const b = await docGioiThieuCuaToi(ub.id, NOW);
    expect(a!.doiTac.map((d) => d.ten).sort()).toEqual(["Đối tác ATKX Hai", "Đối tác ATKX Một"]);
    expect(a!.luotBam.hopLe).toBe(7); // 3 + 4
    expect(b!.doiTac.map((d) => d.ten)).toEqual(["Đối tác ATKX Một"]);
    expect(b!.luotBam.hopLe).toBe(3); // chỉ Party x
    expect(JSON.stringify(b)).not.toContain(y.token); // đối chứng ÂM: B không thấy link của y

    // menu ≡ trang ở mọi trạng thái
    const khac = await taoNguoi("nn-khac");
    const trangThai = async (id: string) => [await coGioiThieuChoNguoiDung(id), (await docGioiThieuCuaToi(id, NOW)) !== null] as const;
    for (const id of [ua.id, ub.id, khac.id]) {
      const [menu, trang] = await trangThai(id);
      expect(menu, id).toBe(trang);
    }
    expect((await trangThai(khac.id))[0]).toBe(false);
    expect((await trangThai(ua.id))[0]).toBe(true);
    // tạm ngừng ub ⇒ cả menu lẫn trang cùng tắt
    const rb = await rowCua(x.doiTac.id, ub.id);
    await tamNgungCong({ nguoi: NGUOI, vao: { id: rb.id, updatedAtDaThay: rb.updatedAt.toISOString(), lyDo: LY_DO }, now: NOW });
    expect(await trangThai(ub.id)).toEqual([false, false]);
    expect((await trangThai(ua.id))[0]).toBe(true);
  });

  it("[ATK-DB-04] CROSS-USER qua bảng nối: A chỉ thấy phần của A, B chỉ của B; cột legacy KHÔNG hoàn tác gỡ / tạm ngừng; dữ liệu gắn bằng SQL (chưa qua màn mới) vẫn vào được", async () => {
    await batCo(true);
    const x = await dungP("Đối tác ATKX A");
    const y = await dungP("Đối tác ATKX B");
    const ua = await taoNguoi("cu-a");
    const ub = await taoNguoi("cu-b");
    await lienKet(x.doiTac.id, ua.id, "REPRESENTATIVE");
    await lienKet(y.doiTac.id, ub.id, "REPRESENTATIVE");
    for (let i = 0; i < 5; i++) await taoClick({ assetId: x.asset.id, campaignId: x.campaign.id, partyId: x.doiTac.id, outcome: "OK", luc: LUC });
    for (let i = 0; i < 7; i++) await taoClick({ assetId: y.asset.id, campaignId: y.campaign.id, partyId: y.doiTac.id, outcome: "OK", luc: LUC });

    const a = await docGioiThieuCuaToi(ua.id, NOW);
    const b = await docGioiThieuCuaToi(ub.id, NOW);
    expect(a!.luotBam.hopLe).toBe(5);
    expect(b!.luotBam.hopLe).toBe(7);
    expect(JSON.stringify(a)).not.toContain(y.token);
    expect(JSON.stringify(a)).toContain(x.token); // đối chứng dương
    expect(JSON.stringify(b)).not.toContain(x.token);

    // GỠ người đại diện của A: cột legacy đã về null NHƯNG kể cả khi ai đó ghi lại cột cũ bằng tay, dòng REVOKED vẫn thắng
    const ra = await rowCua(x.doiTac.id, ua.id);
    await goLienKet({ nguoi: NGUOI, vao: { id: ra.id, updatedAtDaThay: ra.updatedAt.toISOString(), lyDo: LY_DO }, now: NOW });
    expect(await docGioiThieuCuaToi(ua.id, NOW)).toBeNull();
    await db.affiliate.update({ where: { id: x.doiTac.id }, data: { userId: ua.id } }); // "hoàn tác" bằng cột legacy
    expect(await docGioiThieuCuaToi(ua.id, NOW)).toBeNull(); // dòng REVOKED CHẶN đường lùi
    expect(await coGioiThieuChoNguoiDung(ua.id)).toBe(false);

    // tạm ngừng cũng thế
    const rb = await rowCua(y.doiTac.id, ub.id);
    await tamNgungCong({ nguoi: NGUOI, vao: { id: rb.id, updatedAtDaThay: rb.updatedAt.toISOString(), lyDo: LY_DO }, now: NOW });
    await db.affiliate.update({ where: { id: y.doiTac.id }, data: { userId: ub.id } });
    expect(await docGioiThieuCuaToi(ub.id, NOW)).toBeNull();

    // dữ liệu CŨ chưa có dòng nối: đường lùi legacy còn sống (đối chứng dương của đường lùi)
    const z = await dungP("Đối tác ATKX Z");
    const uz = await taoNguoi("cu-z");
    await db.affiliate.update({ where: { id: z.doiTac.id }, data: { userId: uz.id } });
    expect((await docGioiThieuCuaToi(uz.id, NOW))!.doiTac.map((d) => d.ten)).toEqual(["Đối tác ATKX Z"]);
  });

  it("[ATK-DB-05] TRANG dựng bằng dữ liệu thật: tạm ngừng ⇒ 404 (còn Party khác thì chỉ thấy Party khác); mở lại ⇒ vào lại; đã gỡ ⇒ 404", async () => {
    await batCo(true);
    const x = await dungP("Đối tác ATKX Trang Một");
    const y = await dungP("Đối tác ATKX Trang Hai");
    const ua = await taoNguoi("tr-a");
    await lienKet(x.doiTac.id, ua.id, "REPRESENTATIVE");
    await lienKet(y.doiTac.id, ua.id, "REPRESENTATIVE");
    PHIEN.session = { user: { id: ua.id, role: "PARENT" } };

    const html0 = renderToStaticMarkup(await GioiThieuPage());
    expect(html0).toContain(x.token);
    expect(html0).toContain(y.token); // đối chứng dương: thấy cả hai

    const rx = await rowCua(x.doiTac.id, ua.id);
    await tamNgungCong({ nguoi: NGUOI, vao: { id: rx.id, updatedAtDaThay: rx.updatedAt.toISOString(), lyDo: LY_DO }, now: NOW });
    const html1 = renderToStaticMarkup(await GioiThieuPage());
    expect(html1).toContain(y.token);
    expect(html1).not.toContain(x.token); // chỉ Party bị ngừng biến mất

    const ry = await rowCua(y.doiTac.id, ua.id);
    await tamNgungCong({ nguoi: NGUOI, vao: { id: ry.id, updatedAtDaThay: ry.updatedAt.toISOString(), lyDo: LY_DO }, now: NOW });
    await expect(GioiThieuPage()).rejects.toThrow("NOT_FOUND"); // hết Party ⇒ 404
    expect(await coGioiThieuChoNguoiDung(ua.id)).toBe(false);

    const rx2 = await rowCua(x.doiTac.id, ua.id);
    await moLaiCong({ nguoi: NGUOI, vao: { id: rx2.id, updatedAtDaThay: rx2.updatedAt.toISOString(), lyDo: null }, now: NOW });
    const html2 = renderToStaticMarkup(await GioiThieuPage());
    expect(html2).toContain(x.token);
    expect(html2).not.toContain(y.token);

    const rx3 = await rowCua(x.doiTac.id, ua.id);
    await goLienKet({ nguoi: NGUOI, vao: { id: rx3.id, updatedAtDaThay: rx3.updatedAt.toISOString(), lyDo: LY_DO }, now: NOW });
    await expect(GioiThieuPage()).rejects.toThrow("NOT_FOUND");
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  /** Hai campaign cho CÙNG đối tác với số tiền ĐẶC TRƯNG (không trùng nhau, không trùng số nào khác) để việc lộ một số hiện ra ngay. */
  async function dungTien(p: { campaignTrue?: boolean | null; campaignHai?: boolean | null; loai?: boolean | null }) {
    const k = await dungKichBan("atkt", { coLead: false, rules: [{ vai: "SALE", rate: 0.04 }] });
    cuaToi.push(k);
    const co = { centerId: k.centerId, orgUnitId: k.ouId };
    const x = await dungP("Đối tác ATKX Tiền");
    const u = await taoNguoi("tien");
    await lienKet(x.doiTac.id, u.id, "REPRESENTATIVE");
    await db.affiliateCampaign.update({ where: { id: x.campaign.id }, data: { partnerCanViewAmount: p.campaignTrue ?? null } });
    await db.affiliateType.update({ where: { id: x.loai.id }, data: { partnerCanViewAmount: p.loai ?? null } });
    // campaign thứ hai cho CÙNG đối tác
    const camp2 = await db.affiliateCampaign.create({
      data: { code: `AFRX_C2${Date.now().toString(36).toUpperCase()}${dem}`, name: "Campaign ATKX Hai", status: "ACTIVE", defaultSourceGroupId: x.nhomId, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), partnerCanViewAmount: p.campaignHai ?? null, sites: { create: { siteId: x.site.id } } },
    });
    await themDongSo({ ...co, campaignId: x.campaign.id, vai: "AFFILIATE", nguoiId: x.doiTac.id, ten: x.doiTac.name, amount: 1_234_567, payout: "PENDING" });
    await themDongSo({ ...co, campaignId: camp2.id, vai: "AFFILIATE", nguoiId: x.doiTac.id, ten: x.doiTac.name, amount: 7_654_321, payout: "PAID" });
    const lead = await taoLead({ centerId: k.centerId, daDangKy: true });
    await taoReferral({ partyId: x.doiTac.id, campaignId: x.campaign.id, membershipId: x.mem.id, assetId: x.asset.id, nhomId: x.nhomId, status: "VALID", luc: LUC, ...co, leadId: lead.id });
    return { k, x, u, camp2 };
  }
  const CAM_A = ["1234567", "1.234.567", "1,234,567"];
  const CAM_B = ["7654321", "7.654.321", "7,654,321"];
  const chua = (s: string, ds: string[]) => ds.some((d) => s.includes(d));

  it("[ATK-DB-06a] MẶC ĐỊNH ẨN: không ai khai ⇒ `hoaHong` null; JSON và HTML KHÔNG chứa số tiền nào; trạng thái referral vẫn có (đối chứng dương)", async () => {
    await batCo(true);
    const f = await dungTien({});
    const d = await docGioiThieuCuaToi(f.u.id, NOW);
    expect(d).not.toBeNull();
    expect(d!.hoaHong).toBeNull();
    expect(d!.hoaHongMotPhan).toBe(false);
    const json = JSON.stringify(d);
    expect(chua(json, [...CAM_A, ...CAM_B])).toBe(false);
    expect(json).not.toMatch(/"(soTien|choChi|daChi|daGhiSo|tien|trangThaiChi)"/);
    expect(d!.referral.theoTrangThai.VALID).toBe(1); // đối chứng dương: phần không phải tiền vẫn xuống
    expect(d!.link.length).toBeGreaterThan(0);

    PHIEN.session = { user: { id: f.u.id, role: "PARENT" } };
    const html = renderToStaticMarkup(await GioiThieuPage());
    expect(chua(html, [...CAM_A, ...CAM_B])).toBe(false);
    expect(html).toContain("data-khong-hien-tien"); // trang NÓI THẬT là số tiền không hiển thị
    expect(html).not.toContain("Hoa hồng chờ chi");
    expect(html).toContain(f.x.token); // đối chứng dương: trang vẫn dựng
  });

  it("[ATK-DB-06b] thứ tự phân giải: campaign > loại > mặc định — quét các tổ hợp (campaign một, campaign hai, loại) và đo ĐÚNG số nào lộ", async () => {
    await batCo(true);
    // [campaign một, campaign hai, loại] → [thấy số 1.234.567 ?, thấy số 7.654.321 ?]
    const bang: [boolean | null, boolean | null, boolean | null, boolean, boolean][] = [
      [null, null, true, true, true], // chỉ loại bật ⇒ cả hai hiện
      [null, null, false, false, false],
      [true, null, null, true, false], // chỉ campaign một bật
      [null, true, null, false, true],
      [true, null, false, true, false], // campaign BẬT thắng loại TẮT (campaign hai theo loại ⇒ ẩn)
      [false, false, true, false, false], // campaign TẮT thắng loại BẬT
      [false, null, true, false, true], // hỗn hợp: một tắt tường minh, một theo loại bật
      [true, true, null, true, true],
    ];
    for (const [c1, c2, loai, thay1, thay2] of bang) {
      const f = await dungTien({ campaignTrue: c1, campaignHai: c2, loai });
      const d = await docGioiThieuCuaToi(f.u.id, NOW);
      const ten = `c1=${c1} c2=${c2} loại=${loai}`;
      const json = JSON.stringify(d);
      expect(chua(json, CAM_A), `${ten}: số 1.234.567`).toBe(thay1);
      expect(chua(json, CAM_B), `${ten}: số 7.654.321`).toBe(thay2);
      if (!thay1 && !thay2) {
        expect(d!.hoaHong, ten).toBeNull();
        expect(d!.hoaHongMotPhan, ten).toBe(false);
      } else {
        expect(d!.hoaHong, ten).not.toBeNull();
        expect(d!.hoaHongMotPhan, ten).toBe(!(thay1 && thay2)); // còn khoản bị ẩn ⇒ nói là chỉ một phần
        // tổng chỉ gồm khoản được phép
        const mong = (thay1 ? 1_234_567 : 0) + (thay2 ? 7_654_321 : 0);
        expect(d!.hoaHong!.daGhiSo, ten).toBe(mong);
      }
    }
  });

  it("[ATK-DB-06c] HỖN HỢP: campaign một HIỆN, campaign hai ẨN ⇒ trang có số của campaign một, KHÔNG có số của campaign hai, kèm ghi chú «chỉ gồm các chương trình có hiển thị»", async () => {
    await batCo(true);
    const f = await dungTien({ campaignTrue: true, campaignHai: false });
    PHIEN.session = { user: { id: f.u.id, role: "PARENT" } };
    const html = renderToStaticMarkup(await GioiThieuPage());
    expect(chua(html, CAM_A)).toBe(true); // đối chứng dương
    expect(chua(html, CAM_B)).toBe(false);
    expect(html).toContain("data-hoa-hong-mot-phan");
    const d = await docGioiThieuCuaToi(f.u.id, NOW);
    expect(d!.hoaHong!.theoTrangThai.PENDING).toEqual({ soDong: 1, tien: 1_234_567 });
    expect(d!.hoaHong!.theoTrangThai.PAID).toEqual({ soDong: 0, tien: 0 }); // khoản PAID 7.654.321 ở campaign ẩn
    expect(d!.hoaHong!.gan.map((h) => h.soTien)).toEqual([1_234_567]);
  });

  it("[ATK-DB-06d] chưa có khoản nào + campaign cho phép hiện ⇒ khối tiền hiện SỐ 0 (không biến mất); chỉ có khoản BỊ ẨN ⇒ null (không hiện số 0 sai)", async () => {
    await batCo(true);
    const x = await dungP("Đối tác ATKX Trống");
    const u = await taoNguoi("trong");
    await lienKet(x.doiTac.id, u.id, "REPRESENTATIVE");
    await db.affiliateCampaign.update({ where: { id: x.campaign.id }, data: { partnerCanViewAmount: true } });
    const d = await docGioiThieuCuaToi(u.id, NOW);
    expect(d!.hoaHong).toMatchObject({ choChi: 0, daChi: 0, daGhiSo: 0, gan: [] });

    await db.affiliateCampaign.update({ where: { id: x.campaign.id }, data: { partnerCanViewAmount: false } });
    expect((await docGioiThieuCuaToi(u.id, NOW))!.hoaHong).toBeNull(); // campaign tắt ⇒ không có khối
    // có khoản nhưng bị ẩn: vẫn null, KHÔNG phải «0»
    const k = await dungKichBan("atkh", { coLead: false, rules: [{ vai: "SALE", rate: 0.04 }] });
    cuaToi.push(k);
    await themDongSo({ centerId: k.centerId, orgUnitId: k.ouId, campaignId: x.campaign.id, vai: "AFFILIATE", nguoiId: x.doiTac.id, ten: x.doiTac.name, amount: 9_999_111 });
    const an = await docGioiThieuCuaToi(u.id, NOW);
    expect(an!.hoaHong).toBeNull();
    expect(JSON.stringify(an)).not.toContain("9999111");
  });

  it("[ATK-DB-06e] CROSS-USER cho tiền: số tiền của Party khác KHÔNG lọt vào dù cùng campaign được phép hiện", async () => {
    await batCo(true);
    const f = await dungTien({ campaignTrue: true, campaignHai: true });
    const khac = await dungP("Đối tác ATKX Người Khác");
    const uk = await taoNguoi("tien-khac");
    await lienKet(khac.doiTac.id, uk.id, "REPRESENTATIVE");
    await db.affiliateCampaign.update({ where: { id: khac.campaign.id }, data: { partnerCanViewAmount: true } });
    await themDongSo({ centerId: f.k.centerId, orgUnitId: f.k.ouId, campaignId: khac.campaign.id, vai: "AFFILIATE", nguoiId: khac.doiTac.id, ten: khac.doiTac.name, amount: 4_242_424 });
    const a = await docGioiThieuCuaToi(f.u.id, NOW);
    const b = await docGioiThieuCuaToi(uk.id, NOW);
    expect(JSON.stringify(a)).not.toContain("4242424");
    expect(JSON.stringify(b)).not.toContain("1234567");
    expect(JSON.stringify(b)).not.toContain("7654321");
    expect(b!.hoaHong!.daGhiSo).toBe(4_242_424); // đối chứng dương
    expect(a!.hoaHong!.daGhiSo).toBe(1_234_567 + 7_654_321);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it("[ATK-DB-07] CHECK / UNIQUE của migration chặn THẬT bằng SQL trực tiếp (đi vòng qua tầng ứng dụng)", async () => {
    const x = await dungP();
    const ua = await taoNguoi("ck-a");
    const ub = await taoNguoi("ck-b");
    const co = { partyId: x.doiTac.id, userId: ua.id };
    // tạm ngừng / gỡ mà không có lý do ≥ 10 ký tự
    await expect(db.affiliatePartyUser.create({ data: { ...co, status: "SUSPENDED" } })).rejects.toThrow(/ly_do_chk|check constraint/i);
    await expect(db.affiliatePartyUser.create({ data: { ...co, status: "SUSPENDED", statusReason: "ngắn" } })).rejects.toThrow(/ly_do_chk|check constraint/i);
    // REVOKED ⇔ có revokedAt
    await expect(db.affiliatePartyUser.create({ data: { ...co, status: "REVOKED", statusReason: LY_DO } })).rejects.toThrow(/go_chk|check constraint/i);
    await expect(db.affiliatePartyUser.create({ data: { ...co, status: "ACTIVE", revokedAt: LUC } })).rejects.toThrow(/go_chk|check constraint/i);
    expect(await dongCua(x.doiTac.id)).toHaveLength(0);
    // đối chứng dương: dòng hợp lệ qua
    await db.affiliatePartyUser.create({ data: { ...co, status: "SUSPENDED", statusReason: LY_DO } });
    await db.affiliatePartyUser.create({ data: { partyId: x.doiTac.id, userId: ub.id, status: "REVOKED", statusReason: LY_DO, revokedAt: LUC } });
    // UNIQUE (party, user)
    await expect(db.affiliatePartyUser.create({ data: { ...co } })).rejects.toThrow(/Unique constraint|unique/i);
    // Party có dòng truy cập thì KHÔNG xoá cứng được — FK của CHÍNH bảng nối là Restrict (đo trên Party trơn, không membership, để lỗi không đến từ bảng khác)
    const tron = await db.affiliate.create({ data: { code: `AFRX_R${Date.now().toString(36).toUpperCase()}${dem}`, name: "Đối tác ATKX trơn", status: "ACTIVE", isActive: true } });
    await db.affiliatePartyUser.create({ data: { partyId: tron.id, userId: ub.id } });
    await expect(db.affiliate.delete({ where: { id: tron.id } })).rejects.toThrow(/AffiliatePartyUser_partyId_fkey/);
    expect(await db.affiliate.count({ where: { id: tron.id } })).toBe(1);
    // xoá User thì dòng truy cập đi theo, Party còn nguyên
    await db.user.delete({ where: { id: ua.id } });
    expect(await dongCua(x.doiTac.id)).toHaveLength(1);
    expect(await db.affiliate.count({ where: { id: x.doiTac.id } })).toBe(1);
    // RLS đã bật
    const rls = await db.$queryRaw<{ relrowsecurity: boolean }[]>`SELECT relrowsecurity FROM pg_class WHERE relname = 'AffiliatePartyUser'`;
    expect(rls[0]?.relrowsecurity).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it("[ATK-DB-08a] ô tìm: dưới 3 ký tự ⇒ rỗng; che liên hệ; loại nhân viên / bị khoá / đã liên kết; trần 8; đối chứng dương: tìm thấy phụ huynh hợp lệ", async () => {
    const x = await dungP();
    const tag = `Zq${Date.now().toString(36)}`;
    const ph: Awaited<ReturnType<typeof taoNguoi>>[] = [];
    for (let i = 0; i < 10; i++) ph.push(await seedUser({ email: `atkx-tim-${tag}-${i}@ci.test`, role: "PARENT", name: `${tag} Phụ huynh ${i}`, phone: null }));
    const nv = await seedUser({ email: `atkx-tim-${tag}-nv@ci.test`, role: "SALES_CSM", name: `${tag} Nhân viên`, phone: null });
    const khoa = await seedUser({ email: `atkx-tim-${tag}-khoa@ci.test`, role: "PARENT", name: `${tag} Bị khoá`, phone: null });
    await db.user.update({ where: { id: khoa.id }, data: { accountStatus: "DISABLED" } });
    await cho1Con(ph[0]!.id);

    expect(await timUserDeLienKet({ partyId: x.doiTac.id, q: "Zq" })).toEqual([]); // dưới 3 ký tự
    expect(await timUserDeLienKet({ partyId: x.doiTac.id, q: "   " })).toEqual([]);
    const kq = await timUserDeLienKet({ partyId: x.doiTac.id, q: tag });
    expect(kq.length).toBe(8); // trần 8 dù có 10 phụ huynh khớp
    const ids = kq.map((u) => u.userId);
    expect(ids).not.toContain(nv.id);
    expect(ids).not.toContain(khoa.id);
    const json = JSON.stringify(kq);
    for (const cam of ph.map((p) => p.email)) expect(json, cam).not.toContain(cam); // email đã che
    expect(json).toMatch(/\*/); // đối chứng dương: có chuỗi đã che
    // đã liên kết với CHÍNH đối tác này ⇒ không hiện lại (nhưng với đối tác KHÁC thì có)
    await lienKet(x.doiTac.id, ph[0]!.id, "MEMBER");
    expect((await timUserDeLienKet({ partyId: x.doiTac.id, q: tag })).map((u) => u.userId)).not.toContain(ph[0]!.id);
    const y = await dungP();
    const sangY = await timUserDeLienKet({ partyId: y.doiTac.id, q: tag });
    expect(sangY.map((u) => u.userId)).toContain(ph[0]!.id);
    // nói THẬT về cổng: có con ⇒ vào được; chưa có con ⇒ cảnh báo
    expect(sangY.find((u) => u.userId === ph[0]!.id)).toMatchObject({ soHocVien: 1, vaoDuocCong: true, lyDoKhongVao: null });
    expect(sangY.find((u) => u.userId === ph[1]!.id)).toMatchObject({ soHocVien: 0, vaoDuocCong: false });
    // ký tự đại diện LIKE không khớp mọi dòng
    expect(await timUserDeLienKet({ partyId: x.doiTac.id, q: "%%%" })).toEqual([]);
    expect(await timUserDeLienKet({ partyId: x.doiTac.id, q: "___" })).toEqual([]);
  });

  it("[ATK-DB-08b] danh sách tài khoản của đối tác: CHE theo `coTheXemLienHe`; nói THẬT cổng có vào được không (có con / chưa có con / tạm ngừng / đã gỡ)", async () => {
    const x = await dungP();
    const ua = await taoNguoi("ds-a");
    const ub = await taoNguoi("ds-b");
    const uc = await taoNguoi("ds-c");
    const sdt = `849${String(Date.now()).slice(-8)}`;
    await db.user.update({ where: { id: ua.id }, data: { phone: sdt } });
    await cho1Con(ua.id);
    await lienKet(x.doiTac.id, ua.id, "REPRESENTATIVE");
    await lienKet(x.doiTac.id, ub.id, "MEMBER");
    await lienKet(x.doiTac.id, uc.id, "MEMBER");
    const rc = await rowCua(x.doiTac.id, uc.id);
    await tamNgungCong({ nguoi: NGUOI, vao: { id: rc.id, updatedAtDaThay: rc.updatedAt.toISOString(), lyDo: LY_DO }, now: NOW });

    const che = await docTruyCapCuaDoiTac({ partyId: x.doiTac.id, doiTacKetThuc: false, coTheXemLienHe: false });
    const that = await docTruyCapCuaDoiTac({ partyId: x.doiTac.id, doiTacKetThuc: false, coTheXemLienHe: true });
    const jChe = JSON.stringify(che);
    expect(jChe).not.toContain(ua.email);
    expect(jChe).not.toContain(sdt);
    expect(JSON.stringify(that)).toContain(ua.email); // đối chứng dương: người có quyền thấy bản thật
    const theo = (rows: typeof che, id: string) => rows.find((r) => r.userId === id)!;
    expect(theo(che, ua.id)).toMatchObject({ soHocVien: 1, vaoDuocCong: true, lyDoKhongVao: null });
    expect(theo(che, ub.id)).toMatchObject({ soHocVien: 0, vaoDuocCong: false });
    expect(theo(che, ub.id).lyDoKhongVao).toContain("Chưa liên kết học viên");
    expect(theo(che, uc.id)).toMatchObject({ trangThai: "SUSPENDED", vaoDuocCong: false, lyDoKhongVao: "Cổng đang tạm ngừng." });
  });

  it("[ATK-DB-08c] tự giới thiệu so MỌI tài khoản còn gắn (ACTIVE + SUSPENDED + legacy chưa có dòng nối), KHÔNG so tài khoản đã gỡ", async () => {
    const x = await dungP();
    const ua = await taoNguoi("tg-a");
    const ub = await taoNguoi("tg-b");
    const uc = await taoNguoi("tg-c");
    await lienKet(x.doiTac.id, ua.id, "REPRESENTATIVE");
    await lienKet(x.doiTac.id, ub.id, "MEMBER");
    await lienKet(x.doiTac.id, uc.id, "MEMBER");
    const rb = await rowCua(x.doiTac.id, ub.id);
    await tamNgungCong({ nguoi: NGUOI, vao: { id: rb.id, updatedAtDaThay: rb.updatedAt.toISOString(), lyDo: LY_DO }, now: NOW });
    const rc = await rowCua(x.doiTac.id, uc.id);
    await goLienKet({ nguoi: NGUOI, vao: { id: rc.id, updatedAtDaThay: rc.updatedAt.toISOString(), lyDo: LY_DO }, now: NOW });
    expect((await userIdsGanVoiDoiTac(x.doiTac.id)).sort()).toEqual([ua.id, ub.id].sort());
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it("[ATK-DB-09] cờ hiện tiền được LƯU qua hàm ghi thật: campaign (kể cả ĐANG CHẠY, không đòi lý do) và loại; vào nhật ký `changedFields`; không đổi ⇒ không audit", async () => {
    const x = await dungP();
    const c0 = await db.affiliateCampaign.findUniqueOrThrow({ where: { id: x.campaign.id } });
    expect(c0.status).toBe("ACTIVE");
    expect(c0.partnerCanViewAmount).toBeNull();
    const r1 = await suaCampaign({ nguoi: NGUOI, id: c0.id, updatedAtDaThay: c0.updatedAt, vao: { partnerCanViewAmount: true }, lyDo: null, now: NOW });
    expect(r1).toMatchObject({ ok: true, doi: true, truongDoi: ["partnerCanViewAmount"] });
    expect((await db.affiliateCampaign.findUniqueOrThrow({ where: { id: c0.id } })).partnerCanViewAmount).toBe(true);
    const au = await db.auditLog.findMany({ where: { entityType: "AffiliateCampaign", entityId: c0.id, action: "CAMPAIGN_SUA" } });
    expect(au).toHaveLength(1);
    expect(au[0]!.changedFields).toEqual(["partnerCanViewAmount"]);
    // gửi lại cùng giá trị ⇒ không đổi, không audit
    const c1 = await db.affiliateCampaign.findUniqueOrThrow({ where: { id: c0.id } });
    const r2 = await suaCampaign({ nguoi: NGUOI, id: c0.id, updatedAtDaThay: c1.updatedAt, vao: { partnerCanViewAmount: true }, lyDo: null, now: NOW });
    expect(r2).toMatchObject({ ok: true, doi: false });
    expect(await db.auditLog.count({ where: { entityType: "AffiliateCampaign", entityId: c0.id, action: "CAMPAIGN_SUA" } })).toBe(1);
    // đang chạy: một tham số GHI NHẬN vẫn bị chặn (đối chứng: cổng sửa campaign không bị nới ngoài cờ hiển thị)
    const c2 = await db.affiliateCampaign.findUniqueOrThrow({ where: { id: c0.id } });
    expect(await suaCampaign({ nguoi: NGUOI, id: c0.id, updatedAtDaThay: c2.updatedAt, vao: { cookieWindowDays: 7 }, lyDo: null, now: NOW })).toMatchObject({ ok: false });

    const l0 = await db.affiliateType.findUniqueOrThrow({ where: { id: x.loai.id } });
    expect(l0.partnerCanViewAmount).toBeNull();
    const chung = { name: l0.name, description: l0.description, defaultSourceGroupId: l0.defaultSourceGroupId, requiresApproval: l0.requiresApproval, sortOrder: l0.sortOrder };
    // biểu mẫu KHÔNG gửi ô này ⇒ không đổi
    expect(await suaLoai({ nguoi: NGUOI, id: l0.id, updatedAtDaThay: l0.updatedAt, vao: { ...chung } })).toMatchObject({ ok: true, doi: false });
    const l1 = await db.affiliateType.findUniqueOrThrow({ where: { id: x.loai.id } });
    expect(await suaLoai({ nguoi: NGUOI, id: l1.id, updatedAtDaThay: l1.updatedAt, vao: { ...chung, partnerCanViewAmount: true } })).toMatchObject({ ok: true, doi: true, truongDoi: ["partnerCanViewAmount"] });
    expect((await db.affiliateType.findUniqueOrThrow({ where: { id: x.loai.id } })).partnerCanViewAmount).toBe(true);
    const l2 = await db.affiliateType.findUniqueOrThrow({ where: { id: x.loai.id } });
    // gửi null tường minh ⇒ về mặc định
    expect(await suaLoai({ nguoi: NGUOI, id: l2.id, updatedAtDaThay: l2.updatedAt, vao: { ...chung, partnerCanViewAmount: null } })).toMatchObject({ ok: true, doi: true });
    expect((await db.affiliateType.findUniqueOrThrow({ where: { id: x.loai.id } })).partnerCanViewAmount).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it("[ATK-DB-10] ONBOARDING đọc từ DB thật: checklist khớp cổng; nguồn thiếu cấu hình ⇒ «cần xem tay»; ghi danh được / bị chặn theo cổng; ứng viên không gồm campaign đã ở trong", async () => {
    const x = await dungP("Đối tác ATKX Onboarding");
    // campaign ứng viên: không có nguồn mặc định, không quy tắc ⇒ XEM TAY (loại cũng không có nguồn mặc định)
    const trong = await db.affiliateCampaign.create({ data: { code: `AFRX_C3${Date.now().toString(36).toUpperCase()}${dem}`, name: "Campaign ATKX Trống nguồn", status: "DRAFT" } });
    const ended = await db.affiliateCampaign.create({ data: { code: `AFRX_C4${Date.now().toString(36).toUpperCase()}${dem}`, name: "Campaign ATKX Đã kết thúc", status: "ENDED" } });

    let h = (await docOnboardingDoiTac({ partyId: x.doiTac.id, now: NOW }))!;
    expect(h.chuongTrinh.map((c) => c.campaign.id)).toEqual([x.campaign.id]);
    expect(h.sanSang.sanSang).toBe(true); // đối chứng dương: đối tác ACTIVE + membership ACTIVE + campaign ACTIVE + website bật + trang đích
    expect(h.sanSang.theoChuongTrinh[0]!.websiteDungDuoc.length).toBe(1);
    const ids = h.ungVien.map((u) => u.campaignId);
    expect(ids).toContain(trong.id);
    expect(ids).not.toContain(x.campaign.id); // đã ở trong
    expect(ids).not.toContain(ended.id); // campaign đã kết thúc không nhận thành viên
    const uv = h.ungVien.find((u) => u.campaignId === trong.id)!;
    expect(uv.nguon.loai).toBe("XEM_TAY");
    expect(uv.lyDoChan).toBeNull(); // đối tác ACTIVE + campaign nháp ⇒ ghi danh được
    expect(h.chuongTrinh[0]!.nguon.loai).toBe("NGUON"); // campaign chính có nguồn mặc định
    expect(h.buoc.find((b) => b.ma === "PHAT_LINK")!.trangThai).toBe("XONG");
    expect(h.buoc.find((b) => b.ma === "TAI_KHOAN")!.trangThai).toBe("TUY_CHON");

    // website tắt ⇒ checklist CHƯA, lý do là nhãn của cổng; buoc PHAT_LINK CHUA
    await db.affiliateSite.update({ where: { id: x.site.id }, data: { status: "INACTIVE" } });
    h = (await docOnboardingDoiTac({ partyId: x.doiTac.id, now: NOW }))!;
    expect(h.sanSang.sanSang).toBe(false);
    expect(h.sanSang.theoChuongTrinh[0]!.lyDo).toContain("Website không còn ở trạng thái hoạt động.");
    expect(h.buoc.find((b) => b.ma === "PHAT_LINK")!.trangThai).toBe("CHUA");
    await db.affiliateSite.update({ where: { id: x.site.id }, data: { status: "ACTIVE" } });

    // đối tác PENDING ⇒ ghi danh bị chặn (câu của cổng) và bước ghi danh là CHẶN
    await db.affiliate.update({ where: { id: x.doiTac.id }, data: { status: "PENDING", isActive: false } });
    h = (await docOnboardingDoiTac({ partyId: x.doiTac.id, now: NOW }))!;
    expect(h.ungVien.find((u) => u.campaignId === trong.id)!.lyDoChan).toContain("đang hoạt động");
    expect(h.sanSang.sanSang).toBe(false);
    expect(h.sanSang.theoChuongTrinh[0]!.lyDo).toContain("Đối tác không còn ở trạng thái hoạt động.");

    // duyệt lại bằng hàm thật ⇒ ghi danh được và có tài khoản ⇒ bước TÀI KHOẢN XONG
    const dt = await db.affiliate.findUniqueOrThrow({ where: { id: x.doiTac.id } });
    expect(await doiTrangThaiDoiTac({ nguoi: NGUOI, id: dt.id, updatedAtDaThay: dt.updatedAt, den: "ACTIVE", lyDo: null, now: NOW })).toMatchObject({ ok: true });
    const u = await taoNguoi("ob");
    await lienKet(x.doiTac.id, u.id, "REPRESENTATIVE");
    h = (await docOnboardingDoiTac({ partyId: x.doiTac.id, now: NOW }))!;
    expect(h.buoc.find((b) => b.ma === "TAI_KHOAN")!.trangThai).toBe("XONG");
    expect(h.ungVien.find((v) => v.campaignId === trong.id)!.lyDoChan).toBeNull();

    expect(await docOnboardingDoiTac({ partyId: "atkx-khong-co", now: NOW })).toBeNull();
    void taoDoiTac;
  });
});
