// @vitest-environment node
/**
 * AI LEAD — MA TRẬN QUYỀN bằng RBAC THẬT trên Postgres: `seedRoles` thật + `UserOrgRole` thật + `resolveActorUncached` thật (KHÔNG actor viết tay).
 *
 * Vì sao: các ca phạm vi ở duyet/ngoai-le dùng `actorQlcs/actorHoiSo` dựng literal — chứng minh được logic dịch vụ nhưng KHÔNG chứng minh seed cấp đúng quyền cho đúng vai
 * (fixture «Hội sở có review» thậm chí không tồn tại trong seed). Bộ này ghim ĐÚNG thứ production dùng: bảng `RolePermission` do seed ghi → `buildActor` → `can()`/`scopedDb`.
 *
 * Mã ca [AMQ-*]. Cơ sở FRANCHISEE (nhượng quyền) = OrgUnit của CS2 đặt `relationshipType = FRANCHISEE`.
 * ⚠️ Tự SKIP khi không có Postgres test. Bảng dữ liệu dùng tiền tố `AMQ_` và dọn theo tiền tố.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { RUN_DB_TESTS, assertTenDbTest } from "../_helpers/db-gate";
import { seedOrgUnits } from "../../prisma/seed-orgunit";
import { seedRoles } from "../../prisma/seed-roles";
import { resolveActorUncached, type Actor } from "../../lib/auth/actor";
import { can } from "../../lib/permissions/can";

const db = new PrismaClient();
const CO_BANG = RUN_DB_TESTS && (await db.aiLeadDraft.count().then(() => true).catch(() => false));
if (!CO_BANG) console.warn("[ai-lead ma-tran-quyen] SKIP: không có Postgres test hoặc chưa có bảng AiLead*.");

const P = "AMQ_";
const QUYEN = ["ai-leads:view", "ai-leads:review", "ai-leads:configure", "ai-leads:policy", "ai-integration:view", "ai-integration:manage"] as const;
type Quyen = (typeof QUYEN)[number];

/** Ma trận MONG ĐỢI — chép từ chính sách (design §3 + chú thích seed-roles): ai giữ quyền nào. Thêm/đổi quyền ở seed mà không sửa bảng này ⇒ đỏ. */
const MONG_DOI: Record<string, Record<Quyen, boolean>> = {
  SUPER_ADMIN: { "ai-leads:view": true, "ai-leads:review": true, "ai-leads:configure": true, "ai-leads:policy": true, "ai-integration:view": true, "ai-integration:manage": true },
  HO_MARKETING: { "ai-leads:view": true, "ai-leads:review": false, "ai-leads:configure": true, "ai-leads:policy": false, "ai-integration:view": true, "ai-integration:manage": false },
  HO_SALE: { "ai-leads:view": false, "ai-leads:review": false, "ai-leads:configure": false, "ai-leads:policy": false, "ai-integration:view": false, "ai-integration:manage": false },
  CENTER_MANAGER: { "ai-leads:view": true, "ai-leads:review": true, "ai-leads:configure": false, "ai-leads:policy": false, "ai-integration:view": false, "ai-integration:manage": false },
  CENTER_SALES_CSM: { "ai-leads:view": false, "ai-leads:review": false, "ai-leads:configure": false, "ai-leads:policy": false, "ai-integration:view": false, "ai-integration:manage": false },
};

describe.skipIf(!CO_BANG)("[AMQ] ma trận quyền AI Lead — RBAC thật", () => {
  const actor: Record<string, Actor> = {};
  let cs1: string;
  let cs2: string;
  const idHoSo: Record<"cs1" | "cs2" | "chuaBiet", string> = { cs1: `${P}d-cs1`, cs2: `${P}d-cs2`, chuaBiet: `${P}d-null` };
  // Spec này DỰNG cơ sở + cây tổ chức; DB test dùng chung với các spec sau (dong-thoi, cau-hinh-db…) nên phải TRẢ NGUYÊN những gì nó tạo ra,
  // không thì OrgUnit/Center còn sót làm P2002 ở spec khác (đo 28/10: 7 ca đỏ vì đúng lý do này).
  let orgUnitCoTruoc = new Set<string>();
  let centerCoTruoc = new Set<string>();
  let franchiseTruoc: { id: string; relationshipType: string | null } | null = null;

  async function don() {
    await db.aiLeadDraft.deleteMany({ where: { id: { startsWith: P } } });
    await db.aiLeadConversation.deleteMany({ where: { pageId: { startsWith: P } } });
    await db.aiLeadAgent.deleteMany({ where: { name: { startsWith: P } } });
    const ids = (await db.user.findMany({ where: { email: { startsWith: P.toLowerCase() } }, select: { id: true } })).map((u) => u.id);
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } }); // UserOrgRole.userId là cột trần (không quan hệ Prisma)
    await db.user.deleteMany({ where: { email: { startsWith: P.toLowerCase() } } });
  }

  beforeAll(async () => {
    assertTenDbTest();
    await don();
    orgUnitCoTruoc = new Set((await db.orgUnit.findMany({ select: { id: true } })).map((x) => x.id));
    centerCoTruoc = new Set((await db.center.findMany({ select: { id: true } })).map((x) => x.id));
    for (const [code, name] of [["CS1", "AMQ Cơ sở 1"], ["CS2", "AMQ Cơ sở 2 (nhượng quyền)"]] as const) {
      await db.center.upsert({ where: { code }, update: { isActive: true }, create: { code, name, slug: code.toLowerCase(), address: "1 Đường Thử", isActive: true } });
    }
    await seedOrgUnits(db, ["HO", "CS1", "CS2"]);
    await seedRoles(db);
    const ou = async (code: string) => db.orgUnit.findFirstOrThrow({ where: { code }, select: { id: true, centerId: true } });
    const [ho, u1, u2] = [await ou("HO"), await ou("CS1"), await ou("CS2")];
    cs1 = u1.centerId!;
    cs2 = u2.centerId!;
    franchiseTruoc = await db.orgUnit.findUniqueOrThrow({ where: { id: u2.id }, select: { id: true, relationshipType: true } });
    await db.orgUnit.update({ where: { id: u2.id }, data: { relationshipType: "FRANCHISEE" } });

    const tao = async (khoa: string, role: string, noiNeo: { id: string }, legacy: "SUPER_ADMIN" | "MARKETING" | "SALES_CSM" | "CENTER_MANAGER") => {
      const u = await db.user.create({ data: { name: `${P}${khoa}`, email: `${P.toLowerCase()}${khoa.toLowerCase()}@example.test`, role: legacy, roles: [legacy] } });
      const r = await db.roleDef.findUniqueOrThrow({ where: { code: role }, select: { id: true } });
      // effectiveFrom lùi 1 phút: `resolveActor` lọc `effectiveFrom <= now` theo đồng hồ NODE, còn `@default(now())` là đồng hồ DB — lệch vài ms là vai biến mất (ca flaky đã gặp).
      await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: noiNeo.id, roleId: r.id, grantedById: u.id, effectiveFrom: new Date(Date.now() - 60_000) } });
      actor[khoa] = await resolveActorUncached(u.id);
    };
    await tao("SUPER_ADMIN", "SUPER_ADMIN", ho, "SUPER_ADMIN");
    await tao("HO_MARKETING", "HO_MARKETING", ho, "MARKETING");
    await tao("HO_SALE", "HO_SALE", ho, "SALES_CSM");
    await tao("CM_CS1", "CENTER_MANAGER", u1, "CENTER_MANAGER");
    await tao("CM_CS2", "CENTER_MANAGER", u2, "CENTER_MANAGER"); // QLCS của cơ sở NHƯỢNG QUYỀN
    await tao("SALE_CS1", "CENTER_SALES_CSM", u1, "SALES_CSM");

    // Hồ sơ: CS1, CS2 (nhượng quyền), chưa biết cơ sở.
    const agent = await db.aiLeadAgent.create({ data: { name: `${P}agent`, environment: "TEST" } });
    for (const [k, centerId] of [["cs1", cs1], ["cs2", cs2], ["chuaBiet", null]] as const) {
      const conv = await db.aiLeadConversation.create({ data: { agentId: agent.id, pageId: `${P}PAGE`, psid: `${P}psid-${k}` } });
      await db.aiLeadDraft.create({ data: { id: idHoSo[k], conversationId: conv.id, intent: "CONSULTATION_REQUEST", state: "READY_FOR_REVIEW", centerId } });
    }
  }, 120_000);

  afterAll(async () => {
    await don();
    if (franchiseTruoc && orgUnitCoTruoc.has(franchiseTruoc.id)) {
      await db.orgUnit.update({ where: { id: franchiseTruoc.id }, data: { relationshipType: franchiseTruoc.relationshipType as never } });
    }
    // OrgUnit/Center do spec này tạo: xoá con trước cha (depth giảm dần).
    const moi = await db.orgUnit.findMany({ where: { id: { notIn: [...orgUnitCoTruoc] } }, select: { id: true }, orderBy: { depth: "desc" } });
    for (const o of moi) await db.orgUnit.delete({ where: { id: o.id } });
    await db.center.deleteMany({ where: { id: { notIn: [...centerCoTruoc] } } });
    await db.$disconnect();
  });

  const vai = (khoa: string): string => (khoa.startsWith("CM_") ? "CENTER_MANAGER" : khoa.startsWith("SALE_") ? "CENTER_SALES_CSM" : khoa);

  it("[AMQ-08] NGƯỜI NHẬN thông báo/ứng viên giao của MỘT cơ sở = người giữ ai-leads:review NEO TẠI cơ sở đó (RBAC thật): QLCS của cơ sở ấy có; QLCS cơ sở khác / Sale / vai Hội sở / tài khoản chỉ có cột vai cũ KHÔNG", async () => {
    const { nguoiDuyetCoSo } = await import("../../lib/ai-lead/dich-vu/nguoi-duyet-co-so");
    const idCuaKhoa = async (khoa: string) => (await db.user.findFirstOrThrow({ where: { email: `${P.toLowerCase()}${khoa.toLowerCase()}@example.test` }, select: { id: true } })).id;
    // tài khoản CHỈ có cột vai cũ (roles has CENTER_MANAGER + centerId) — không UserOrgRole nào
    const cotCu = await db.user.create({ data: { name: `${P}cotcu`, email: `${P.toLowerCase()}cotcu@example.test`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: cs1 } });
    // Năm cách MỘT QLCS đang neo ĐÚNG đơn vị CS1 nhưng KHÔNG còn hiệu lực — mỗi cách tắt đúng một điều kiện của truy vấn (đối chứng ÂM; đối chứng dương là cm1 bên dưới).
    const dv1 = await db.orgUnit.findFirstOrThrow({ where: { centerId: cs1 }, select: { id: true } });
    const vaiQlcs = await db.roleDef.findUniqueOrThrow({ where: { code: "CENTER_MANAGER" }, select: { id: true } });
    const phut = (p: number) => new Date(Date.now() + p * 60_000);
    const khongHieuLuc: Record<string, string> = {};
    for (const [khoa, cachLam] of [
      ["het-han", { vai: { effectiveFrom: phut(-120), effectiveTo: phut(-60) }, user: {} }],
      ["chua-toi-han", { vai: { effectiveFrom: phut(60) }, user: {} }],
      ["tam-dung", { vai: { effectiveFrom: phut(-60), status: "SUSPENDED" as const }, user: {} }],
      ["tai-khoan-khoa", { vai: { effectiveFrom: phut(-60) }, user: { isActive: false } }],
      ["tai-khoan-xoa", { vai: { effectiveFrom: phut(-60) }, user: { deletedAt: phut(-30) } }],
    ] as const) {
      const u = await db.user.create({ data: { name: `${P}${khoa}`, email: `${P.toLowerCase()}${khoa}@example.test`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], ...cachLam.user } });
      await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: dv1.id, roleId: vaiQlcs.id, grantedById: u.id, ...cachLam.vai } });
      khongHieuLuc[khoa] = u.id;
    }
    const choCs1 = await nguoiDuyetCoSo(cs1, new Date());
    const choCs2 = await nguoiDuyetCoSo(cs2, new Date());
    for (const [khoa, id] of Object.entries(khongHieuLuc)) expect(choCs1, `${khoa} không còn hiệu lực ⇒ không nhận`).not.toContain(id);
    // KHÔNG so bằng nhau: cùng cơ sở dữ liệu còn chứa người dùng của các bộ test khác (CI chạy chat-db → nen-db → lead-intake → ai-lead trên MỘT DB) — họ cũng là QLCS hợp lệ của cơ sở.
    // Ca khẳng định cái thuộc về NÓ: QLCS của mình CÓ ở đúng cơ sở, KHÔNG có ở cơ sở kia.
    const cm1 = await idCuaKhoa("CM_CS1");
    const cm2 = await idCuaKhoa("CM_CS2");
    expect(choCs1).toContain(cm1);
    expect(choCs2).toContain(cm2);
    expect(choCs1, "QLCS cơ sở 2 không nhận ở cơ sở 1").not.toContain(cm2);
    expect(choCs2, "QLCS cơ sở 1 không nhận ở cơ sở 2").not.toContain(cm1);
    expect(choCs1).not.toContain(cotCu.id); // cột vai cũ không đủ — không mở được màn AI Lead thì không nhận chuông
    for (const khoa of ["SALE_CS1", "HO_SALE", "HO_MARKETING", "SUPER_ADMIN"]) {
      const id = await idCuaKhoa(khoa);
      expect(choCs1, khoa).not.toContain(id);
      expect(choCs2, khoa).not.toContain(id);
    }
    expect(await nguoiDuyetCoSo("khong-ton-tai", new Date())).toEqual([]); // cơ sở không có OrgUnit ⇒ rỗng (không đoán)
  });

  it("[AMQ-01] bảng 6 quyền × 5 vai khớp ĐÚNG ma trận mong đợi (can() trên actor dựng từ seed thật, không target)", () => {
    for (const khoa of Object.keys(actor)) {
      for (const q of QUYEN) {
        const co = can(actor[khoa]!, q, q.startsWith("ai-leads") ? { centerId: cs1 } : undefined);
        expect(co, `${khoa} · ${q}`).toBe(MONG_DOI[vai(khoa)]![q]);
      }
    }
  });

  it("[AMQ-02] CÁCH LY CƠ SỞ khi GHI: quyền ai-leads:* là GLOBAL (can() KHÔNG phân biệt cơ sở — chủ ý, xem chú thích seed-roles), nên cách ly nằm ở passesScope(): QLCS chỉ qua được hồ sơ của cơ sở MÌNH (kể cả nhượng quyền ↔ sở hữu); hồ sơ chưa biết cơ sở chỉ vai Hội sở qua", async () => {
    const { passesScope } = await import("../../lib/db-scope");
    const hs = async (k: keyof typeof idHoSo) => db.aiLeadDraft.findUniqueOrThrow({ where: { id: idHoSo[k] } });
    const [h1, h2, h0] = [await hs("cs1"), await hs("cs2"), await hs("chuaBiet")];
    const qua = (a: Actor) => [h1, h2, h0].map((h) => passesScope("AiLeadDraft", h, a));
    expect(qua(actor.CM_CS1!)).toEqual([true, false, false]);
    expect(qua(actor.CM_CS2!)).toEqual([false, true, false]);
    expect(qua(actor.HO_MARKETING!)).toEqual([true, true, true]);
    expect(qua(actor.SUPER_ADMIN!)).toEqual([true, true, true]);
    // can() GLOBAL cố ý không đổi theo cơ sở — nếu có ngày nó bắt đầu phân biệt, ca này đỏ để người sửa biết mô hình cách ly đã đổi.
    expect(can(actor.CM_CS1!, "ai-leads:review", { centerId: cs2 })).toBe(true);
  });

  it("[AMQ-03] scopedDb(actor).aiLeadDraft: QLCS CS1 chỉ thấy hồ sơ CS1; QLCS nhượng quyền CS2 chỉ thấy CS2; hồ sơ CHƯA BIẾT cơ sở KHÔNG hiện cho QLCS nào", async () => {
    const { scopedDb } = await import("../../lib/db-scope");
    const thay = async (a: Actor) => (await scopedDb(a).aiLeadDraft.findMany({ where: { id: { startsWith: P } }, select: { id: true } })).map((d) => d.id).sort();
    expect(await thay(actor.CM_CS1!)).toEqual([idHoSo.cs1]);
    expect(await thay(actor.CM_CS2!)).toEqual([idHoSo.cs2]);
  });

  it("[AMQ-04] vai Hội sở có ai-leads:view (HO_MARKETING) và Quản trị tối cao thấy CẢ ba hồ sơ (kể cả chưa biết cơ sở và cơ sở nhượng quyền)", async () => {
    const { scopedDb } = await import("../../lib/db-scope");
    const thay = async (a: Actor) => (await scopedDb(a).aiLeadDraft.findMany({ where: { id: { startsWith: P } }, select: { id: true } })).map((d) => d.id).sort();
    const tatCa = Object.values(idHoSo).sort();
    expect(await thay(actor.HO_MARKETING!)).toEqual(tatCa);
    expect(await thay(actor.SUPER_ADMIN!)).toEqual(tatCa);
  });

  it("[AMQ-05] vai KHÔNG có ai-leads:view (HO_SALE, Sale cơ sở) không qua được cổng quyền ở mọi cơ sở — cổng thật là can(), không phải scopedDb", () => {
    for (const k of ["HO_SALE", "SALE_CS1"]) {
      for (const centerId of [cs1, cs2, null]) {
        for (const q of ["ai-leads:view", "ai-leads:review", "ai-leads:configure"] as const) {
          expect(can(actor[k]!, q, centerId === null ? undefined : { centerId }), `${k} · ${q} · ${centerId}`).toBe(false);
        }
      }
    }
  });

  it("[AMQ-06] ĐẶC TẢ HÀNH VI (đo 28/10/2026, không phải mong muốn): scopedDb KHÔNG tự chặn vai thiếu quyền model — HO_SALE (không có ai-leads:view) vẫn thấy cả 3 hồ sơ, Sale CS1 thấy hồ sơ CS1 ⇒ can() ở trang/action là hàng rào DUY NHẤT", async () => {
    const { scopedDb } = await import("../../lib/db-scope");
    const thay = async (a: Actor) => (await scopedDb(a).aiLeadDraft.findMany({ where: { id: { startsWith: P } }, select: { id: true } })).length;
    // Hệ quả: mọi đường đọc hồ sơ AI qua scopedDb PHẢI đứng sau can('ai-leads:view') (xem [AMQ-07] và các ca *-ACT-02). Nếu sau này scopedDb được siết fail-closed thì ca này ĐỎ — khi đó đổi số mong đợi về 0, đó là cải thiện.
    const hoSale = await thay(actor.HO_SALE!);
    const saleCs1 = await thay(actor.SALE_CS1!);
    expect({ hoSale, saleCs1 }).toEqual({ hoSale: 3, saleCs1: 1 });
  });

  it("[AMQ-07] mọi trang/Server Action đọc hồ sơ AI qua scopedDb đều có kiểm quyền TRƯỚC (lưới đọc mã nguồn: page-gates cho trang; vaoCong/checkAnyPermission cho action)", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const goc = resolve(process.cwd(), "app/(admin)/admin/ai-lead");
    const trang: string[] = [];
    const duyet = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) duyet(p);
        else if (/^page\.tsx$/.test(e.name)) trang.push(p);
      }
    };
    duyet(goc);
    expect(trang.length).toBeGreaterThanOrEqual(5);
    for (const p of trang) {
      const ma = readFileSync(p, "utf8");
      // Mỗi trang phải: đăng nhập (auth()) và gác bằng PAGE_GATES / checkPermission / redirect khi thiếu quyền.
      expect(ma, p).toMatch(/await auth\(\)/);
      expect(ma, p).toMatch(/PAGE_GATES|checkPermission|checkAnyPermission|can\(/);
    }
  });
});
