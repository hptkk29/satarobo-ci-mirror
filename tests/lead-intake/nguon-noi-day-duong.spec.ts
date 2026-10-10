// @vitest-environment node
/**
 * PR2 "NỐI DÂY INTAKE" — các đường B, C, D, E chạy ĐÚNG HANDLER THẬT trên Postgres LOCAL (không giả lập building-block):
 *
 *   B  `POST /api/leads`                        [NHH-SRC-07b]  · trùng SĐT [NHH-SRC-09b]
 *   C  `createLeadManual` (server action)       [NHH-SRC-07c]  · H21 nhãn 'Nhập tay' ⇒ xem tay
 *   D  `POST /api/admin/import/leads`           [NHH-SRC-07d]  · gộp lead cũ ⇒ NHAP_EXCEL [NHH-SRC-21b]
 *   E  `POST /api/admin/import/leads/registered` [NHH-SRC-07e] · chặn nhãn lạ [NHH-SRC-22c]
 *   cổng hiệu năng                               [NHH-SRC-07e-perf]
 *   cách ly cơ sở của TRA (T11)                  [NHH-SRC-10b]
 *   SRC-21a                                      [NHH-SRC-21a] `updateLeadFields` khi cờ BẬT
 *
 * Mỗi đường có ĐỐI CHỨNG cờ TẮT = 0 bản ghi mới (luật: ca chỉ khẳng định sự vắng mặt luôn đạt khi tính năng hỏng hoàn toàn).
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `NDAYD_` (tên) và danh sách SĐT cố định của bộ này.
 * ⚠️ LUẬT 18: mỗi ca tự dựng cờ + dữ liệu của mình.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SESS = vi.hoisted(() => ({
  current: null as null | { user: { id: string; role: string; roles: string[]; centerId: string | null; name: string; email: string } },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => SESS.current }));
vi.mock("next/cache", async (orig) => ({
  ...(await orig<typeof import("next/cache")>()),
  revalidatePath: () => {},
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.9.9.9" }),
}));
vi.mock("@/lib/tracking", () => ({ sendMetaCapi: async () => {}, sendGa4Event: async () => {} }));

import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { db } from "../../lib/db";
import { scopedDb } from "../../lib/db-scope";
import { resolveActorUncached } from "../../lib/auth/actor";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { POST as leadsPost } from "../../app/api/leads/route";
import { POST as importPost } from "../../app/api/admin/import/leads/route";
import { POST as registeredPost } from "../../app/api/admin/import/leads/registered/route";
import { createLeadManual, updateLeadFields } from "../../app/(admin)/admin/leads/actions";
import { doiNguonLeadAction } from "../../app/(admin)/admin/leads/nguon-actions";
import { chuanBiQuyNguon, ghiQuyNguonTheoLo, type DauVaoNoiDay } from "../../lib/nguon/noi-day";
import { thuThapTinHieuTheoLo, type DbKhongScope } from "../../lib/nguon/thu-thap-tin-hieu";
import { KHONG_CO_TIN_HIEU_NGUON } from "../../lib/nguon/tin-hieu";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon, datEpChonNguonCoSo, type IdNhom } from "./_nguon-fixture";
import { clearSettingsCache } from "../../lib/settings/service";

const RUN = RUN_DB_TESTS;
const P = "NDAYD_";
const CASE = 90_000;

const SDT = {
  b: "0903000001",
  bDup: "0903000002",
  c: "0903000003",
  d1: "0903000004",
  d2: "0903000005",
  d3: "0903000006",
  dCu: "0903000007",
  e1: "0903000008",
  e2: "0903000009",
  eLa: "0903000010",
  nv: "0903000011",
  crossDaMat: "0903000012",
  s21: "0903000013",
  dNv: "0903000014",
} as const;
const TAT_CA_SDT = Object.values(SDT);
const bienThe = (s: string) => [s, `84${s.slice(1)}`];

/**
 * `POST /api/leads` có rate-limit THEO IP (`public.leadRateLimitMax`, mặc định 5 / 60 giây) và các ca gọi handler THẬT không gửi
 * `x-forwarded-for` nên mọi lượt cùng một IP. Bộ này đã gọi nó 5 lần trước ca [09b] — đúng bằng trần — nên chỉ cần thêm MỘT ca
 * gọi `/api/leads` ở phía trước là lượt thứ hai của [09b] nhận 429 (không có trường `duplicate`) và ca đỏ với thông báo chẳng nói
 * gì về rate-limit. Nâng trần cho riêng bộ này (luật 18: không mượn sức chứa còn thừa của ca trước).
 */
const RATE_LIMIT_KEY = "public.leadRateLimitMax";
async function nangTranRateLimit(): Promise<void> {
  await db.systemSetting.deleteMany({ where: { key: RATE_LIMIT_KEY } });
  await db.systemSetting.create({ data: { key: RATE_LIMIT_KEY, valueJson: 100 } });
  clearSettingsCache();
}

/** Xoá user của bộ này KÈM vai (`UserOrgRole`, không FK) và dòng sổ lượt chia — xem ghi chú ở `nguon-noi-day.spec.ts` (`don()`). */
async function xoaNguoiDung(): Promise<void> {
  // Sổ lượt chia lead (`LeadRotationTurn`) là bảng KHÔNG có FK tới User và KHÔNG tự dọn: xoá user mà để lại dòng sổ thì `layPoolDangBat`
  // vẫn đưa user ma vào danh sách ứng viên, `autoAssignNewLead` chọn trúng nó và nổ `Lead_assignedToId_fkey` ở ca SAU (có thể là ca của
  // tệp khác). Đo được khi cấy lỗi (luật 18): thêm MỘT ca POST /api/leads vào đầu tệp làm lệch pha vòng chia và ca [09b] đỏ 3/3.
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
  await db.leadRotationTurn.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

async function don(): Promise<void> {
  const leads = await db.lead.findMany({
    where: { OR: [{ parentName: { startsWith: P } }, { phone: { in: TAT_CA_SDT.flatMap(bienThe) } }] },
    select: { id: true },
  });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } }); // FK Cascade kéo quy nguồn + touchpoint
  }
  await xoaNguoiDung();
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: "NDAYDAFF" } } });
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
  await db.systemSetting.deleteMany({ where: { key: RATE_LIMIT_KEY } });
}

async function dungNguoiDung(vai: "SUPER_ADMIN" | "SALES_CSM", coSo: "CS1" | null) {
  const email = `${P}${vai.toLowerCase()}@example.test`;
  const centerId = coSo ? (await db.center.findUniqueOrThrow({ where: { code: coSo }, select: { id: true } })).id : null;
  const u = await db.user.create({
    data: { name: `${P}${vai}`, email, role: vai, roles: [vai], centerId, isActive: true },
    select: { id: true },
  });
  // Quyền thật của actor (RBAC v2) đến từ UserOrgRole, không phải User.role: SUPER_ADMIN neo tại HO (cross-center), Sale neo tại CS1.
  const [donVi, maVai] = vai === "SUPER_ADMIN" ? ["HO", "SUPER_ADMIN"] : [coSo!, "CENTER_SALES_CSM"];
  const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: donVi }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: maVai }, select: { id: true } });
  // `effectiveFrom` ĐỂ MẶC ĐỊNH = `now()` của Postgres, mà đồng hồ DB đi TRƯỚC `Date.now()` của Node tới ~1,3 ms (đo 400 lượt: 398 lượt DB nhanh hơn) —
  // gọi ngay sau khi cấp vai thì `effectiveFrom <= now` có thể SAI và vai chưa hiệu lực. Đo được: [NHH-SRC-16h] đỏ ngẫu nhiên ~3% (luật 19).
  await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: role.id, grantedById: "ndayd", effectiveFrom: new Date(Date.now() - 3_600_000) } });
  SESS.current = { user: { id: u.id, role: vai, roles: [vai], centerId, name: `${P}${vai}`, email } };
  return { id: u.id, centerId };
}

const jsonReq = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const tin = (leadId: string) =>
  db.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: {
      source: true,
      attribution: { include: { group: { select: { code: true } }, originalGroup: { select: { code: true } } } },
      touchpoints: { orderBy: { occurredAt: "asc" } },
    },
  });
const theoSdt = (s: string) => db.lead.findFirst({ where: { phone: { in: bienThe(s) }, deletedAt: null }, select: { id: true, source: true } });

describe.skipIf(!RUN)("PR2 — nối dây các đường B/C/D/E bằng handler thật", () => {
  let nhom: IdNhom;

  // Tự dựng Center/OrgUnit CS1/CS2 + vai (luật 18) — không mượn của bộ chạy trước.
  beforeAll(async () => {
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["CENTER_SALES_CSM"] });
  }, 120_000);

  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await nangTranRateLimit();
    SESS.current = null;
  }, CASE);

  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 180_000);

  // ── B ─────────────────────────────────────────────────────────────────────────────────────────
  const bodyB = (phone: string, over: Record<string, unknown> = {}) => ({
    parentName: `${P}Khách web`,
    phone,
    source: "lien-he",
    eventId: `evt-${phone}-${Math.random().toString(36).slice(2, 10)}`,
    dongYChinhSachBaoMat: true,
    consentMarketing: false,
    timeOnPage: 30,
    ...over,
  });

  it("[NHH-SRC-07b] POST /api/leads ⇒ đúng 1 attribution; khách tự nhập không aff ⇒ nhóm Quảng cáo (D11) qua đường 'web'", async () => {
    const res = await leadsPost(jsonReq("/api/leads", bodyB(SDT.b)));
    expect(res.status).toBe(200);
    const l = await theoSdt(SDT.b);
    const t = await tin(l!.id);
    expect(t.source).toBe("lien-he"); // đường vào giữ nguyên (D6)
    expect(t.attribution!.group.code).toBe("PAID_ADS");
    expect(t.attribution!.matchedRule).toBe("DUONG_VAO_MAC_DINH");
    expect(t.attribution!.identificationMethod).toBe("SYSTEM_DEFAULT");
    expect(t.attribution!.conversionEntry).toBe("lien-he");
    expect(t.touchpoints).toHaveLength(0);
  }, CASE);

  it("[NHH-SRC-07b2] fbclid trên phiếu web ⇒ QUANG_CAO thắng đường vào; click-id nằm trong signals", async () => {
    await leadsPost(jsonReq("/api/leads", bodyB(SDT.b, { fbclid: "fbclid-abc123" })));
    const t = await tin((await theoSdt(SDT.b))!.id);
    expect(t.attribution!.matchedRule).toBe("QUANG_CAO");
    expect((t.attribution!.signals as { quangCao: { fbclid: string } }).quangCao.fbclid).toBe("fbclid-abc123");
  }, CASE);

  it("[NHH-SRC-07b3] mã giới thiệu `?ref=` trên phiếu web CHUYỂN thành tín hiệu nguồn: aff hợp lệ ⇒ AFF_CHUA_PHAN_LOAI + xem tay (không đoán loại), id aff nằm trong signals", async () => {
    // Cấy `ref: data.ref ?? null` → `ref: null` ở lời gọi chuẩn bị quy nguồn: lead vẫn gắn `affiliateId` (đường cũ) nên mọi ca cũ xanh,
    // nhưng nguồn mới không bao giờ biết đến người giới thiệu — hoa hồng giới thiệu sau này tính từ attribution sẽ rỗng.
    const aff = await db.affiliate.create({ data: { code: "NDAYDAFF1", name: `${P}aff`, isActive: true }, select: { id: true } });
    const res = await leadsPost(jsonReq("/api/leads", bodyB(SDT.b, { ref: "ndaydaff1" })));
    expect(res.status).toBe(200);
    const t = await tin((await theoSdt(SDT.b))!.id);
    expect(t.attribution!.matchedRule).toBe("AFF_CHUA_PHAN_LOAI");
    expect(t.attribution!.group.code).toBe("UNKNOWN");
    const s = t.attribution!.signals as { ref: { affiliateId: string; hopLe: boolean }; xemTay: string[] };
    expect(s.ref).toMatchObject({ affiliateId: aff.id, hopLe: true });
    expect(s.xemTay).toEqual(["AFF_CHUA_PHAN_LOAI"]);
  }, CASE);

  it("[NHH-SRC-07b-off] đối chứng: cờ TẮT ⇒ lead vẫn tạo, 0 attribution, 0 touchpoint", async () => {
    await datCoNguon({});
    const res = await leadsPost(jsonReq("/api/leads", bodyB(SDT.b)));
    expect(res.status).toBe(200);
    const t = await tin((await theoSdt(SDT.b))!.id);
    expect(t.attribution).toBeNull();
    expect(t.touchpoints).toHaveLength(0);
  }, CASE);

  it("[NHH-SRC-09b] POST /api/leads trùng SĐT ⇒ trả lead cũ; ref đến sau ⇒ touchpoint NHAP_LAI + REF_SAU, attribution cũ KHÔNG đổi", async () => {
    await leadsPost(jsonReq("/api/leads", bodyB(SDT.bDup)));
    const goc = (await theoSdt(SDT.bDup))!;
    const truoc = await tin(goc.id);
    const res = await leadsPost(jsonReq("/api/leads", bodyB(SDT.bDup, { ref: "ABCDEF12" })));
    const j = (await res.json()) as { duplicate?: boolean; leadId: string };
    expect(j.duplicate).toBe(true);
    expect(j.leadId).toBe(goc.id);
    const sau = await tin(goc.id);
    expect(sau.attribution!.groupId).toBe(truoc.attribution!.groupId);
    expect(sau.attribution!.attributedAt).toEqual(truoc.attribution!.attributedAt);
    expect(sau.touchpoints.map((t) => t.kind).sort()).toEqual(["NHAP_LAI", "REF_SAU"]);
  }, CASE);

  it("[NHH-SRC-09d] POST /api/leads trùng SĐT với fbclid khổng lồ ⇒ lead vẫn nhận (không mất khách), nhưng touchpoint chỉ giữ ≤ 200 ký tự (không bơm chuỗi lớn vào sổ)", async () => {
    await leadsPost(jsonReq("/api/leads", bodyB(SDT.bDup)));
    const goc = (await theoSdt(SDT.bDup))!;
    const res = await leadsPost(jsonReq("/api/leads", bodyB(SDT.bDup, { fbclid: "F".repeat(5000), gclid: "G".repeat(5000) })));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { duplicate?: boolean }).duplicate).toBe(true);
    const tp = (await tin(goc.id)).touchpoints.find((t) => t.kind === "NHAP_LAI")!;
    const qc = (tp.signals as { quangCao: { fbclid: string; gclid: string } }).quangCao;
    expect(qc.fbclid.length).toBe(200);
    expect(qc.gclid.length).toBe(200);
  }, CASE);

  it("[NHH-SRC-09c] POST /api/leads: khách cũ ĐÃ MẤT quay lại sau cửa sổ chống trùng ⇒ lead MỚI KẾ THỪA nguồn gốc của lead cũ (KE_THUA_SDT, original group giữ nguyên)", async () => {
    // Cấy `sdtKhach: data.phone` → `sdtKhach: null` ở lời gọi chuanBiQuyNguon của route: lead web quay lại mất nguồn gốc IM LẶNG
    // (rơi về đường vào mặc định) và mọi ca khác vẫn xanh vì chúng không có lead cũ DA_MAT.
    const cu = await db.lead.create({
      data: { parentName: `${P}Khách cũ`, phone: SDT.crossDaMat, status: "DA_MAT", createdAt: new Date("2025-01-01T00:00:00.000Z") },
      select: { id: true },
    });
    await db.leadAttribution.create({
      data: { leadId: cu.id, groupId: nhom.PARENT_REFERRAL, originalGroupId: nhom.PARENT_REFERRAL, identificationMethod: "MANUAL", matchedRule: "KHAI_TAY", reasonText: "gốc" },
    });
    const res = await leadsPost(jsonReq("/api/leads", bodyB(SDT.crossDaMat)));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { duplicate?: boolean; leadId: string };
    expect(j.duplicate).toBeUndefined();
    expect(j.leadId).not.toBe(cu.id);
    const t = await tin(j.leadId);
    expect(t.attribution!.matchedRule).toBe("KE_THUA_SDT");
    expect(t.attribution!.inheritedFromLeadId).toBe(cu.id);
    expect(t.attribution!.originalGroup.code).toBe("PARENT_REFERRAL");
  }, CASE);

  // ── C ─────────────────────────────────────────────────────────────────────────────────────────
  it("[NHH-SRC-07c] createLeadManual ⇒ đúng 1 attribution; nhãn mặc định 'Nhập tay' ⇒ MANUAL_REVIEW (H21), KHÔNG UNKNOWN", async () => {
    await dungNguoiDung("SUPER_ADMIN", null);
    const r = await createLeadManual({ parentName: `${P}Nhập tay`, phone: SDT.c });
    expect(r.ok, r.error).toBe(true);
    const t = await tin(r.id!);
    expect(t.source).toBe("Nhập tay");
    expect(t.attribution!.group.code).toBe("OTHER"); // ĐỀ XUẤT, không phải quyết định
    expect(t.attribution!.group.code).not.toBe("UNKNOWN");
    expect(t.attribution!.matchedRule).toBe("KHAI_TAY");
    const s = t.attribution!.signals as { coXemTay: boolean; xemTay: string[]; nhanGoc: string };
    expect(s.coXemTay).toBe(true);
    expect(s.xemTay).toContain("NHAN_CHOT_THEO_PHIEU");
    expect(s.nhanGoc).toBe("Nhập tay");
  }, CASE);

  it("[NHH-SRC-07c2] createLeadManual kèm mã campaign ⇒ QUANG_CAO thắng nhãn khai tay", async () => {
    await dungNguoiDung("SUPER_ADMIN", null);
    const r = await createLeadManual({ parentName: `${P}Có ads`, phone: SDT.c, campaignId: "CP-001", adId: "AD-9" });
    expect(r.ok, r.error).toBe(true);
    const t = await tin(r.id!);
    expect(t.attribution!.matchedRule).toBe("QUANG_CAO");
    expect(t.attribution!.group.code).toBe("PAID_ADS");
  }, CASE);

  it("[NHH-SRC-07c-off] đối chứng: cờ TẮT ⇒ createLeadManual vẫn tạo lead, 0 attribution", async () => {
    await datCoNguon({});
    await dungNguoiDung("SUPER_ADMIN", null);
    const r = await createLeadManual({ parentName: `${P}Nhập tay`, phone: SDT.c });
    expect(r.ok).toBe(true);
    expect((await tin(r.id!)).attribution).toBeNull();
  }, CASE);

  // ── D ─────────────────────────────────────────────────────────────────────────────────────────
  const dong = (phone: string, nguon: string, ten = `${P}Excel`) => ({
    "Tên phụ huynh": ten,
    SĐT: phone,
    Nguồn: nguon,
  });

  it("[NHH-SRC-07d] nhập Excel sự kiện: MỖI lead mới có đúng 1 attribution; nhãn 'Ads' ⇒ KHAI_TAY/SYSTEM_IMPORT; ô Nguồn trống ⇒ UNKNOWN", async () => {
    await dungNguoiDung("SUPER_ADMIN", null);
    const res = await importPost(
      jsonReq("/api/admin/import/leads", { rows: [dong(SDT.d1, "Ads"), dong(SDT.d2, ""), dong(SDT.d3, "Quản Lý Trung Tâm")] }),
    );
    const j = (await res.json()) as { success: number; errors: unknown[] };
    expect(j.success).toBe(3);
    const a1 = (await tin((await theoSdt(SDT.d1))!.id)).attribution!;
    expect(a1.group.code).toBe("PAID_ADS");
    expect(a1.identificationMethod).toBe("SYSTEM_IMPORT");
    const a2 = (await tin((await theoSdt(SDT.d2))!.id)).attribution!;
    expect(a2.group.code).toBe("UNKNOWN");
    const a3 = (await tin((await theoSdt(SDT.d3))!.id)).attribution!;
    expect(a3.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(a3.referrerMissing).toBe(true); // nhóm ✅ người, file không có cột người ⇒ THIEU_NGUOI
    expect(await db.leadAttribution.count({ where: { lead: { phone: { in: [SDT.d1, SDT.d2, SDT.d3].flatMap(bienThe) } } } })).toBe(3);
  }, CASE);

  it("[NHH-SRC-07d-loi] đường D: lỗi hệ thống ở bước quy nguồn bị NUỐT (lead vẫn tạo — T4) nhưng phản hồi có dòng cảnh báo cho người nhập", async () => {
    // Cấy bỏ khối `nguonLoiHeThong`: cả lô lead không có attribution mà phản hồi chỉ báo `success` — im lặng cho tới khi script di trú vét.
    await dungNguoiDung("SUPER_ADMIN", null);
    await db.leadSourceGroup.deleteMany({}); // danh mục gốc mất ⇒ bước thu thập NÉM (beforeEach của ca sau dựng lại)
    const res = await importPost(jsonReq("/api/admin/import/leads", { rows: [dong(SDT.d1, "Ads")] }));
    const j = (await res.json()) as { success: number; errors: { row: number; error: string }[]; warnings?: { row: number; error: string }[] };
    expect(j.success).toBe(1); // T4: lead KHÔNG bị chặn
    expect((j.warnings ?? []).some((e) => e.row === 0 && /KHÔNG có quy nguồn/.test(e.error))).toBe(true); // cảnh báo, không phải lỗi: lead đã được tạo
    expect(j.errors).toEqual([]);
    expect(await db.leadAttribution.count({ where: { lead: { phone: { in: bienThe(SDT.d1) } } } })).toBe(0);
  }, CASE);

  it("[NHH-SRC-07d-off] đối chứng: cờ TẮT ⇒ import vẫn tạo lead, 0 attribution, 0 touchpoint", async () => {
    await datCoNguon({});
    await dungNguoiDung("SUPER_ADMIN", null);
    const res = await importPost(jsonReq("/api/admin/import/leads", { rows: [dong(SDT.d1, "Ads")] }));
    expect(((await res.json()) as { success: number }).success).toBe(1);
    expect(await db.leadAttribution.count({ where: { lead: { phone: { in: bienThe(SDT.d1) } } } })).toBe(0);
    expect(await db.leadTouchpoint.count({ where: { lead: { phone: { in: bienThe(SDT.d1) } } } })).toBe(0);
  }, CASE);

  it("[NHH-SRC-22dD] đường D: cơ sở ĐÃ ép chọn + nhãn LẠ ⇒ DÒNG đó lỗi, không tạo lead; dòng nhãn hợp lệ cùng file vẫn tạo; cơ sở chưa ép chọn ⇒ qua (UNKNOWN + xem tay)", async () => {
    // Cấy `if (cb.bat && cb.chanNhap)` → `if (false && …)` ở route D: ca [22b'] chỉ chạy đường E nên đường D không có ai canh.
    await dungNguoiDung("SUPER_ADMIN", null);
    const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    await datEpChonNguonCoSo(ou.id, true);
    const hang = (phone: string, nguon: string) => ({ ...dong(phone, nguon), "Cơ sở (mã CS, để trống)": "CS1" });
    try {
      const res = await importPost(jsonReq("/api/admin/import/leads", { rows: [hang(SDT.d1, "Nguồn mới tinh"), hang(SDT.d2, "Ads")] }));
      const j = (await res.json()) as { success: number; errors: { row: number; error: string }[] };
      expect(j.success).toBe(1);
      expect(j.errors).toHaveLength(1);
      expect(j.errors[0]!.error).toMatch(/không có trong danh sách nguồn/);
      expect(await theoSdt(SDT.d1)).toBeNull();
      expect((await tin((await theoSdt(SDT.d2))!.id)).attribution!.group.code).toBe("PAID_ADS");

      // Đối chứng dương: cơ sở KHÔNG ép chọn ⇒ cùng dòng lạ được tạo, UNKNOWN + xem tay.
      await datEpChonNguonCoSo(ou.id, null);
      const ok = await importPost(jsonReq("/api/admin/import/leads", { rows: [hang(SDT.d1, "Nguồn mới tinh")] }));
      expect(((await ok.json()) as { success: number }).success).toBe(1);
      const a = (await tin((await theoSdt(SDT.d1))!.id)).attribution!;
      expect(a.group.code).toBe("UNKNOWN");
      expect((a.signals as { xemTay: string[] }).xemTay).toContain("NHAN_NGUON_LA");
    } finally {
      await datEpChonNguonCoSo(ou.id, null);
    }
  }, CASE);

  it("[NHH-SRC-21b] nhập lại lead ĐÃ CÓ + tick GHI ĐÈ + nhãn mới: cờ BẬT ⇒ attribution & Lead.source KHÔNG đổi, +1 touchpoint NHAP_EXCEL; cờ TẮT ⇒ nguồn bị đè như hôm nay", async () => {
    await dungNguoiDung("SUPER_ADMIN", null);
    // Lead có sẵn: nguồn 'Website' (#16 ⇒ WALK_IN), có attribution.
    const cu = await db.lead.create({
      data: { parentName: `${P}Cũ`, phone: SDT.dCu, status: "MOI", source: "Website" },
      select: { id: true },
    });
    await db.leadAttribution.create({
      data: { leadId: cu.id, groupId: nhom.WALK_IN, originalGroupId: nhom.WALK_IN, identificationMethod: "MANUAL", matchedRule: "KHAI_TAY", reasonText: "ca test" },
    });
    const goc = await tin(cu.id);

    const res = await importPost(jsonReq("/api/admin/import/leads", { rows: [dong(SDT.dCu, "Ads", `${P}Cũ`)], ghiDe: [0] }));
    expect(((await res.json()) as { updated: number }).updated).toBe(1);
    const sau = await tin(cu.id);
    expect(sau.source).toBe("Website"); // KHÔNG bị đè
    expect(sau.attribution!.groupId).toBe(goc.attribution!.groupId);
    expect(sau.attribution!.updatedAt).toEqual(goc.attribution!.updatedAt);
    expect(sau.touchpoints.map((t) => t.kind)).toEqual(["NHAP_EXCEL"]);
    expect((sau.touchpoints[0]!.signals as { nhanGoc: string }).nhanGoc).toBe("Ads");

    // Đối chứng dương: cờ TẮT ⇒ đúng hành vi cũ (đè `source`), 0 touchpoint mới.
    await datCoNguon({});
    await db.leadTouchpoint.deleteMany({ where: { leadId: cu.id } });
    await importPost(jsonReq("/api/admin/import/leads", { rows: [dong(SDT.dCu, "Ads", `${P}Cũ`)], ghiDe: [0] }));
    const tat = await tin(cu.id);
    expect(tat.source).toBe("Ads");
    expect(tat.touchpoints).toHaveLength(0);
  }, CASE);

  // ── E ─────────────────────────────────────────────────────────────────────────────────────────
  function fileDangKy(rows: { ten: string; sdt: string; nguon?: string }[]): File {
    const aoa = [
      ["Họ và Tên học viên", "Số điện thoại", "Cơ sở", "Lớp", ...(rows.some((r) => r.nguon) ? ["Nguồn"] : [])],
      ...rows.map((r) => [r.ten, r.sdt, "CS1: Nguyễn Hữu Thọ", "Lớp 3", ...(rows.some((x) => x.nguon) ? [r.nguon ?? ""] : [])]),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Tháng 7");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    return new File([buf], "dang-ky.xlsx");
  }
  const reqE = (f: File, mode: "dry-run" | "confirm") => {
    const fd = new FormData();
    fd.set("file", f);
    fd.set("mode", mode);
    return new NextRequest("http://localhost/api/admin/import/leads/registered", { method: "POST", body: fd });
  };

  it("[NHH-SRC-07e] nhập Excel ĐÃ ĐĂNG KÝ (đường lớn nhất): lead mới có đúng 1 attribution; nhãn mặc định 'Import Excel ĐK' ⇒ nhóm 6 + THIEU_NGUOI", async () => {
    await dungNguoiDung("SUPER_ADMIN", null);
    const res = await registeredPost(reqE(fileDangKy([{ ten: `${P}Bé E1`, sdt: SDT.e1 }, { ten: `${P}Bé E2`, sdt: SDT.e2 }]), "confirm"));
    const j = (await res.json()) as { ok: boolean; data: { daTaoLead: number } };
    expect(j.ok).toBe(true);
    expect(j.data.daTaoLead).toBe(2);
    for (const s of [SDT.e1, SDT.e2]) {
      const a = (await tin((await theoSdt(s))!.id)).attribution!;
      expect(a.group.code).toBe("EMPLOYEE_REFERRAL");
      expect(a.referrerMissing).toBe(true);
      expect(a.identificationMethod).toBe("SYSTEM_IMPORT");
    }
  }, CASE);

  it("[NHH-SRC-07e-off] đối chứng: cờ TẮT ⇒ vẫn tạo lead, 0 attribution", async () => {
    await datCoNguon({});
    await dungNguoiDung("SUPER_ADMIN", null);
    const res = await registeredPost(reqE(fileDangKy([{ ten: `${P}Bé E1`, sdt: SDT.e1 }]), "confirm"));
    expect(((await res.json()) as { data: { daTaoLead: number } }).data.daTaoLead).toBe(1);
    expect(await db.leadAttribution.count({ where: { lead: { phone: { in: bienThe(SDT.e1) } } } })).toBe(0);
  }, CASE);

  it("[NHH-SRC-07e-loi] đường E: lỗi hệ thống ở bước quy nguồn bị NUỐT (lead vẫn tạo — T4) nhưng người nhập THẤY: summary.nguonThieu = số dòng không có quy nguồn", async () => {
    // Cấy `nguonThieu: …` → `0`: cả lô vài nghìn lead không có attribution mà màn hình báo thành công, im lặng cho tới khi script di trú vét.
    await dungNguoiDung("SUPER_ADMIN", null);
    await db.leadSourceGroup.deleteMany({}); // danh mục gốc mất ⇒ bước thu thập NÉM (beforeEach của ca sau dựng lại)
    const f = fileDangKy([{ ten: `${P}Bé Loi`, sdt: SDT.e1 }]);
    const dry = (await (await registeredPost(reqE(f, "dry-run"))).json()) as { data: { nguonThieu: number } };
    expect(dry.data.nguonThieu).toBe(1);
    const conf = (await (await registeredPost(reqE(f, "confirm"))).json()) as { data: { daTaoLead: number } };
    expect(conf.data.daTaoLead).toBe(1); // T4: lead KHÔNG bị chặn vì quy nguồn lỗi
    expect(await db.leadAttribution.count({ where: { lead: { phone: { in: bienThe(SDT.e1) } } } })).toBe(0);
  }, CASE);

  it("[NHH-SRC-22b'] đường E: cơ sở ĐÃ ép chọn + nhãn LẠ ⇒ dry-run báo dòng bị chặn, confirm KHÔNG tạo lead; cơ sở chưa ép chọn ⇒ UNKNOWN + xem tay", async () => {
    await dungNguoiDung("SUPER_ADMIN", null);
    const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    await datEpChonNguonCoSo(ou.id, true);
    const f = fileDangKy([{ ten: `${P}Bé La`, sdt: SDT.eLa, nguon: "Nguồn mới tinh" }]);
    const dry = (await (await registeredPost(reqE(f, "dry-run"))).json()) as { data: { nguonBiChan: { nhan: string }[]; seTao: unknown[] } };
    expect(dry.data.nguonBiChan.map((x) => x.nhan)).toEqual(["Nguồn mới tinh"]);
    expect(dry.data.seTao).toHaveLength(0);
    const conf = (await (await registeredPost(reqE(f, "confirm"))).json()) as { data: { daTaoLead: number } };
    expect(conf.data.daTaoLead).toBe(0);
    expect(await theoSdt(SDT.eLa)).toBeNull();

    // Đối chứng dương: cùng file, cơ sở KHÔNG ép chọn ⇒ qua.
    await datEpChonNguonCoSo(ou.id, null);
    const ok = (await (await registeredPost(reqE(f, "confirm"))).json()) as { data: { daTaoLead: number } };
    expect(ok.data.daTaoLead).toBe(1);
    const a = (await tin((await theoSdt(SDT.eLa))!.id)).attribution!;
    expect(a.group.code).toBe("UNKNOWN");
    expect((a.signals as { nhanGoc: string }).nhanGoc).toBe("Nguồn mới tinh");
  }, CASE);

  // ── Cách ly cơ sở của TRA (T11) ─────────────────────────────────────────────────────────────────
  it("[NHH-SRC-10b] người nhập neo CS1 nhập Excel, SĐT khách trùng SĐT nhân viên CS2 ⇒ canhBao SDT_NHAN_VIEN (tra bằng db KHÔNG scope); HO-level cho cùng kết quả", async () => {
    const cs2 = await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } });
    await db.employee.create({
      data: { employeeCode: `${P}NV_CS2`, fullName: `${P}NV CS2`, jobTitle: "Tư vấn", department: "TUYEN_SINH", centerId: cs2.id, isActive: true, phone: SDT.nv },
    });
    await dungNguoiDung("SALES_CSM", "CS1");
    const res = await importPost(jsonReq("/api/admin/import/leads", { rows: [{ ...dong(SDT.nv, "Ads"), "Cơ sở (mã CS, để trống)": "CS1" }] }));
    expect(((await res.json()) as { success: number }).success).toBe(1);
    const a = (await tin((await theoSdt(SDT.nv))!.id)).attribution!;
    expect(a.canhBao).toEqual(["SDT_NHAN_VIEN"]);
    expect((a.signals as { xemTay: string[] }).xemTay).toContain("SDT_NHAN_VIEN");

    // Đối chứng dương: HO-level (SUPER_ADMIN) cho cùng kết quả.
    await db.lead.deleteMany({ where: { phone: { in: bienThe(SDT.nv) } } });
    await xoaNguoiDung();
    await dungNguoiDung("SUPER_ADMIN", null);
    await importPost(jsonReq("/api/admin/import/leads", { rows: [dong(SDT.nv, "Ads")] }));
    expect((await tin((await theoSdt(SDT.nv))!.id)).attribution!.canhBao).toEqual(["SDT_NHAN_VIEN"]);
  }, CASE);

  it("[NHH-SRC-10c] kế thừa: bản gốc DA_MAT ở CS2 thấy được khi tra bằng db KHÔNG scope, KHÔNG thấy khi tra qua client scope CS1 — vì sao T11 tồn tại", async () => {
    const cs2 = await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } });
    const goc = await db.lead.create({
      data: { parentName: `${P}CS2 cũ`, phone: SDT.crossDaMat, status: "DA_MAT", centerId: cs2.id },
      select: { id: true },
    });
    await db.leadAttribution.create({
      data: { leadId: goc.id, groupId: nhom.PARENT_REFERRAL, originalGroupId: nhom.PARENT_REFERRAL, identificationMethod: "MANUAL", matchedRule: "KHAI_TAY", reasonText: "gốc" },
    });
    const u = await dungNguoiDung("SALES_CSM", "CS1");
    const actor = await resolveActorUncached(u.id);
    const dauVao = (): DauVaoNoiDay => ({
      bayGio: new Date("2026-10-08T03:00:00.000Z"),
      duongVao: "import-excel",
      conversionEntry: null,
      nhanKhai: null,
      laNhapExcel: true,
      sdtKhach: SDT.crossDaMat,
      maNvNguoiNhap: null,
      nguoiNhapUserId: null,
      nhanSuGioiThieuEmployeeId: null,
      phuHuynhGioiThieu: null,
      ref: null,
      refSau: [],
      quangCao: KHONG_CO_TIN_HIEU_NGUON.quangCao,
      utm: KHONG_CO_TIN_HIEU_NGUON.utm,
      pageId: null,
      orgUnitId: null,
      centerId: null,
    });
    const khongScope = await thuThapTinHieuTheoLo(db, [dauVao()]);
    expect(khongScope.tin[0]!.keThua?.leadId).toBe(goc.id);
    // ĐỐI CHỨNG ÂM: cùng câu hỏi qua client đã bọc phạm vi CS1 ⇒ mất kế thừa IM LẶNG (kết quả rỗng vẫn là kết quả hợp lệ).
    const quaScope = await thuThapTinHieuTheoLo(scopedDb(actor) as unknown as DbKhongScope, [dauVao()]);
    expect(quaScope.tin[0]!.keThua).toBeNull();
  }, CASE);

  // ── SRC-21a ───────────────────────────────────────────────────────────────────────────────────
  it("[NHH-SRC-21a] updateLeadFields: cờ BẬT ⇒ đổi `source` bị TỪ CHỐI (attribution, Lead.source không đổi); gửi lại CÙNG giá trị thì lưu bình thường; cờ TẮT ⇒ như hôm nay", async () => {
    await dungNguoiDung("SUPER_ADMIN", null);
    const created = await createLeadManual({ parentName: `${P}Sửa`, phone: SDT.s21, source: "Ads" });
    expect(created.ok, created.error).toBe(true);
    const truoc = await tin(created.id!);

    const doi = await updateLeadFields(created.id!, { source: "Organic" });
    expect(doi.ok).toBe(false);
    expect(doi.error).toMatch(/Đổi nguồn/);
    const sau = await tin(created.id!);
    expect(sau.source).toBe("Ads");
    expect(sau.attribution!.groupId).toBe(truoc.attribution!.groupId);

    // Đối chứng dương 1: gửi lại CÙNG nguồn + sửa ô khác ⇒ lưu được (biểu mẫu luôn gửi cả phiếu).
    const giu = await updateLeadFields(created.id!, { source: "Ads", childName: "Bé Sửa" });
    expect(giu.ok, giu.error).toBe(true);
    expect((await db.lead.findUniqueOrThrow({ where: { id: created.id! }, select: { childName: true } })).childName).toBe("Bé Sửa");

    // Đối chứng dương 2: cờ TẮT ⇒ hành vi cũ — ghi thẳng `source`.
    await datCoNguon({});
    const tat = await updateLeadFields(created.id!, { source: "Organic" });
    expect(tat.ok, tat.error).toBe(true);
    expect((await tin(created.id!)).source).toBe("Organic");
  }, CASE);

  // ── Server Action đổi nguồn ───────────────────────────────────────────────────────────────────
  it("[NHH-SRC-16f] doiNguonLeadAction: chưa đăng nhập ⇒ từ chối; cờ TẮT ⇒ \"chưa được bật\" (không đổi gì); cờ BẬT ⇒ đổi + AuditLog; ô trống chuỗi rỗng = không chọn", async () => {
    await dungNguoiDung("SUPER_ADMIN", null);
    const t = await createLeadManual({ parentName: `${P}Đổi`, phone: SDT.s21, source: "Ads" });
    expect(t.ok, t.error).toBe(true);
    const dau = { leadId: t.id!, groupId: nhom.WALK_IN, employeeId: "", parentUserId: "", studentId: null, affiliateId: undefined, giaiTrinh: "", lyDo: "Khách xác nhận tự đến trung tâm" };

    const phien = SESS.current;
    SESS.current = null;
    expect(await doiNguonLeadAction(dau)).toMatchObject({ ok: false, error: "Chưa đăng nhập" });
    SESS.current = phien;

    // Cờ master TẮT ⇒ từ chối, KHÔNG đổi gì (quy nguồn cũ còn nguyên).
    await datCoNguon({});
    const tat = await doiNguonLeadAction(dau);
    expect(tat).toMatchObject({ ok: false });
    expect((tat as { error: string }).error).toMatch(/chưa được bật/);
    expect((await tin(t.id!)).attribution!.group.code).toBe("PAID_ADS");

    // Cờ BẬT ⇒ đổi; ô để trống dạng chuỗi rỗng / null / undefined được coi như KHÔNG chọn (nhóm WALK_IN không đòi người).
    await datCoNguon(CO_NGUON_DAY_DU);
    const ok = await doiNguonLeadAction(dau);
    expect(ok).toEqual({ ok: true, canDieuChinh: false });
    expect((await tin(t.id!)).attribution!.group.code).toBe("WALK_IN");
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: t.id!, module: "nguon-hoa-hong", action: "DOI_NGUON" } })).toBe(1);
  }, CASE);

  it("[NHH-SRC-16g] doiNguonLeadAction: Sale cơ sở CS1 đổi nguồn lead của CS2 ⇒ \"Lead không tồn tại\" (field lead), 0 AuditLog, không lộ nhóm", async () => {
    const cs2 = await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } });
    const l = await db.lead.create({ data: { parentName: `${P}CS2`, phone: SDT.d2, status: "MOI", centerId: cs2.id }, select: { id: true } });
    await db.leadAttribution.create({
      data: { leadId: l.id, groupId: nhom.PAID_ADS, originalGroupId: nhom.PAID_ADS, identificationMethod: "MANUAL", matchedRule: "KHAI_TAY", reasonText: "t" },
    });
    await dungNguoiDung("SALES_CSM", "CS1");
    const r = await doiNguonLeadAction({ leadId: l.id, groupId: nhom.WALK_IN, lyDo: "Khách xác nhận tự đến trung tâm" });
    expect(r).toEqual({ ok: false, error: "Lead không tồn tại.", field: "lead" });
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: l.id, module: "nguon-hoa-hong" } })).toBe(0);
    expect((await tin(l.id)).attribution!.group.code).toBe("PAID_ADS");
  }, CASE);

  it("[NHH-SRC-16h] doiNguonLeadAction: Sale CS1 đổi nguồn lead CS1 của chính cơ sở mình nhưng KHÔNG có leads:overwrite ⇒ từ chối trên field quyen (quyền hỏi qua can(), không phải tin client); đối chứng SUPER_ADMIN được", async () => {
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const l = await db.lead.create({ data: { parentName: `${P}CS1`, phone: SDT.d3, status: "MOI", centerId: cs1.id }, select: { id: true } });
    await db.leadAttribution.create({
      data: { leadId: l.id, groupId: nhom.PAID_ADS, originalGroupId: nhom.PAID_ADS, identificationMethod: "MANUAL", matchedRule: "KHAI_TAY", reasonText: "t" },
    });
    const dau = { leadId: l.id, groupId: nhom.WALK_IN, lyDo: "Khách xác nhận tự đến trung tâm" };
    await dungNguoiDung("SALES_CSM", "CS1");
    expect(await doiNguonLeadAction(dau)).toMatchObject({ ok: false, field: "quyen" });
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: l.id, module: "nguon-hoa-hong" } })).toBe(0);
    expect((await tin(l.id)).attribution!.group.code).toBe("PAID_ADS");
    // Đối chứng dương: cùng lead, người có quyền (SUPER_ADMIN) ⇒ đổi được.
    await xoaNguoiDung();
    await dungNguoiDung("SUPER_ADMIN", null);
    expect((await doiNguonLeadAction(dau)).ok).toBe(true);
  }, CASE);

  // ── Hiệu năng (T12) ───────────────────────────────────────────────────────────────────────────
  it("[NHH-SRC-07e-perf] số câu truy vấn của phần quy nguồn KHÔNG phụ thuộc số lead: nhập 5 và 75 lead ⇒ cùng một số câu (trần tuyệt đối ≤ 12, đo thật 7)", async () => {
    const dem = async (n: number): Promise<number> => {
      const log: string[] = [];
      const c = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
      (c as unknown as { $on: (e: "query", f: (q: { query: string }) => void) => void }).$on("query", (q) => log.push(q.query));
      try {
        const rows: DauVaoNoiDay[] = Array.from({ length: n }, (_, i) => ({
          bayGio: new Date("2026-10-08T03:00:00.000Z"),
          duongVao: "import-dang-ky",
          conversionEntry: "Import Excel ĐK",
          nhanKhai: "Import Excel ĐK",
          laNhapExcel: true,
          sdtKhach: `09031${String(i).padStart(5, "0")}`,
          maNvNguoiNhap: null,
          nguoiNhapUserId: null,
          nhanSuGioiThieuEmployeeId: null,
          phuHuynhGioiThieu: null,
          ref: i % 3 === 0 ? `REF${i}ABC` : null,
          refSau: [],
          quangCao: KHONG_CO_TIN_HIEU_NGUON.quangCao,
          utm: KHONG_CO_TIN_HIEU_NGUON.utm,
          pageId: null,
          orgUnitId: null,
          centerId: null,
        }));
        const cb = await chuanBiQuyNguon(c as unknown as DbKhongScope, rows);
        // phần GHI: tạo n lead trần rồi nối nguồn của chúng trong MỘT transaction.
        const ds = await c.$transaction(async (tx) => {
          const ids = await Promise.all(
            rows.map((r) =>
              tx.lead.create({ data: { parentName: `${P}Perf`, phone: r.sdtKhach!, status: "MOI" }, select: { id: true } }),
            ),
          );
          const nguon = ids.map((l, i) => ({ leadId: l.id, chuanBi: cb[i]! }));
          await ghiQuyNguonTheoLo(tx, nguon, null);
          return nguon;
        });
        // Chỉ đếm câu của PHẦN QUY NGUỒN (đọc các bảng tra + tra lead cùng SĐT + ghi hai bảng nguồn) — TRƯỚC khi test tự đếm lại.
        const cauQuyNguon = log.filter((q) =>
          /FROM "public"\."(LeadSourceGroup|LeadAttribution|LeadTouchpoint|Employee|User|UserOrgRole|Affiliate|FacebookPageMapping)"|INTO "public"\."(LeadAttribution|LeadTouchpoint)"|FROM "public"\."Lead" WHERE .*"phone" IN/.test(q),
        );
        expect(ds).toHaveLength(n);
        expect(await c.leadAttribution.count({ where: { lead: { parentName: `${P}Perf` } } })).toBe(n);
        return cauQuyNguon.length;
      } finally {
        await db.lead.deleteMany({ where: { parentName: `${P}Perf` } });
        await c.$disconnect();
      }
    };
    const nho = await dem(5);
    const lon = await dem(75);
    // Đo thật 08/10/2026 (PR2): 5 lead = 7 câu · 75 lead = 7 câu (đọc các bảng tra + tra lead cùng SĐT + hai câu `createMany`).
    expect(lon).toBe(nho); // KHÔNG phụ thuộc số lead (hình dạng N+1 ⇒ lon = 15 × nho)
    expect(lon).toBeLessThanOrEqual(12); // trần 03 §2.2b (≤ 12) — đo thật 7
    expect(lon).toBeGreaterThan(2); // đối chứng dương: bộ đếm THẤY được truy vấn (không đếm rỗng)
  }, 180_000);
});
