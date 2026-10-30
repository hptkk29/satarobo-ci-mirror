// @vitest-environment node
/**
 * AI LEAD — BỘ QUY TẮC CÓ VERSION (Rule Builder) trên POSTGRES THẬT: chụp phiên bản sau mỗi lần đổi cột, lưu SLA/thông báo, ràng buộc thu hẹp, khôi phục có kiểm lại thế giới sống,
 * bất biến của phiên bản cũ, đua nhau. Mã ca [BQD-*]. Phần thuần (schema/engine): lib/ai-lead/dich-vu/bo-quy-tac.test.ts.
 *
 * ⚠️ Bảng `AiLeadRuleSet` toàn cục: mỗi ca bắt đầu từ bảng TRỐNG (xoá hết) — chỉ chạy trên DB test (assertTenDbTest). Tự SKIP khi không có Postgres.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, assertTenDbTest } from "../_helpers/db-gate";
import { PAGE, P, db, donDep, dungNen, type Nen } from "./_nen-c";

const CO_BANG = RUN_DB_TESTS && (await db.aiLeadRuleSet.count().then(() => true).catch(() => false));
if (!CO_BANG) console.warn("[ai-lead bo-quy-tac] SKIP: không có Postgres test hoặc chưa có bảng AiLeadRuleSet (prisma migrate deploy).");

const NG = { userId: `${P}ng`, userName: "BQD Tester" };
const LY_DO = "Kiểm thử bộ quy tắc có version";
/** Phiên bản bộ quy tắc hiện hành (0 = chưa có) — mô phỏng «phiên bản người sửa đã thấy lúc mở màn». */
const BV = async (): Promise<number> => (await db.aiLeadRuleSet.aggregate({ _max: { version: true } }))._max.version ?? 0;

describe.skipIf(!CO_BANG)("[BQD] bộ quy tắc có version — DB thật", () => {
  let nen: Nen;
  let ch: typeof import("../../lib/ai-lead/dich-vu/cau-hinh");
  let rs: typeof import("../../lib/ai-lead/dich-vu/bo-quy-tac-db");

  const hienHanh = () => rs.docBoHienHanh();
  const soPhienBan = () => db.aiLeadRuleSet.count();
  const cot = (pageId = PAGE) => db.aiLeadAgentPage.findUniqueOrThrow({ where: { agentId_pageId: { agentId: nen.agentId, pageId } } });
  const themPage = (pageId = PAGE) => db.aiLeadAgentPage.create({ data: { agentId: nen.agentId, pageId } });

  beforeAll(async () => {
    assertTenDbTest();
    ch = await import("../../lib/ai-lead/dich-vu/cau-hinh");
    rs = await import("../../lib/ai-lead/dich-vu/bo-quy-tac-db");
  });
  beforeEach(async () => {
    await db.aiLeadRuleSet.deleteMany({});
    await db.auditLog.deleteMany({ where: { module: "ai-lead", actorId: NG.userId } });
    nen = await dungNen();
    await themPage();
  }, 60_000);
  afterAll(async () => {
    await db.aiLeadRuleSet.deleteMany({});
    await db.auditLog.deleteMany({ where: { module: "ai-lead", actorId: NG.userId } });
    await donDep();
    await db.$disconnect();
  });

  it("[BQD-01] chưa đổi gì ⇒ chưa có phiên bản; lần đổi cột ĐẦU TIÊN tạo phiên bản 1 chụp cả cấu hình có sẵn (ROUTE + AUTO)", async () => {
    expect(await hienHanh()).toBeNull();
    await db.aiLeadAgentPage.update({ where: { agentId_pageId: { agentId: nen.agentId, pageId: PAGE } }, data: { routingCenterId: nen.centerA } }); // cấu hình có từ TRƯỚC Rule Builder
    expect((await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: true, lyDo: LY_DO })).ok).toBe(true);
    const h = (await hienHanh())!;
    expect(h.version).toBe(1);
    expect(h.bo.rules).toEqual(
      expect.arrayContaining([
        { kind: "ROUTE_PAGE_TO_CAMPUS", agentId: nen.agentId, pageId: PAGE, centerId: nen.centerA },
        { kind: "AUTO_CREATE", agentId: nen.agentId, pageId: PAGE, enabled: true },
      ]),
    );
    expect(h.reason).toBe(LY_DO);
  });

  it("[BQD-02] mỗi hành động đổi cột chụp phiên bản MỚI kèm audit; cột và phiên bản luôn khớp nhau", async () => {
    await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerA });
    await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: true, lyDo: LY_DO });
    await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerB });
    expect(await soPhienBan()).toBe(3);
    const h = (await hienHanh())!;
    const c = await cot();
    expect(c.routingCenterId).toBe(nen.centerB);
    expect(c.autoCreate).toBe(true);
    expect(h.bo.rules.find((r) => r.kind === "ROUTE_PAGE_TO_CAMPUS")).toMatchObject({ centerId: nen.centerB });
    expect(await db.auditLog.count({ where: { module: "ai-lead", entityType: "AiLeadRuleSet", actorId: NG.userId } })).toBe(3);
  });

  it("[BQD-03] đổi sang đúng giá trị đang có ⇒ không tạo phiên bản thừa; tắt tự tạo ⇒ quy tắc AUTO biến khỏi phiên bản mới; thêm/gỡ Page cũng được chụp", async () => {
    await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: true, lyDo: LY_DO });
    await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: false, lyDo: LY_DO });
    expect((await hienHanh())!.bo.rules.some((r) => r.kind === "AUTO_CREATE")).toBe(false);
    const truoc = await soPhienBan();
    expect((await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: false, lyDo: LY_DO })).ok).toBe(false); // Page đã tắt: dịch vụ từ chối, không chụp
    expect(await soPhienBan()).toBe(truoc);
    const them = await ch.themPageChoAgent(NG, { agentId: nen.agentId, pageId: "104500000000555", routingCenterId: nen.centerA });
    expect(them.ok).toBe(true);
    expect((await hienHanh())!.bo.rules).toEqual(expect.arrayContaining([{ kind: "ROUTE_PAGE_TO_CAMPUS", agentId: nen.agentId, pageId: "104500000000555", centerId: nen.centerA }]));
    expect((await ch.goPageKhoiAgent(NG, { agentId: nen.agentId, pageId: "104500000000555", lyDo: LY_DO })).ok).toBe(true);
    expect((await hienHanh())!.bo.rules.some((r) => r.kind === "ROUTE_PAGE_TO_CAMPUS" && r.pageId === "104500000000555")).toBe(false);
  });

  it("[BQD-04] lưu SLA + thông báo: giữ nguyên ROUTE/AUTO; nội dung giống hệt ⇒ từ chối; sai định dạng / cơ sở không tồn tại ⇒ từ chối và KHÔNG tạo phiên bản", async () => {
    await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: true, lyDo: LY_DO });
    const rules = [
      { kind: "SLA", scope: { type: "DEFAULT" }, claimMinutes: 30, resolveMinutes: 240 },
      { kind: "SLA", scope: { type: "CAMPUS", centerId: nen.centerA }, claimMinutes: 15, resolveMinutes: 120 },
      { kind: "NOTIFY", event: "SLA_CLAIM_OVERDUE", centerId: null, afterMinutes: 0, to: ["CENTER_MANAGER"] },
      { kind: "NOTIFY", event: "SLA_CLAIM_OVERDUE", centerId: null, afterMinutes: 60, to: ["HO_REVIEWERS"] },
    ];
    const r1 = await ch.luuSlaThongBao(NG, { baseVersion: await BV(), rules, lyDo: LY_DO });
    expect(r1.ok).toBe(true);
    const h = (await hienHanh())!;
    expect(h.bo.rules.filter((r) => r.kind === "SLA")).toHaveLength(2);
    expect(h.bo.rules.filter((r) => r.kind === "NOTIFY")).toHaveLength(2);
    expect(h.bo.rules.some((r) => r.kind === "AUTO_CREATE")).toBe(true); // không bị mất
    const n = await soPhienBan();
    const giong = await ch.luuSlaThongBao(NG, { baseVersion: await BV(), rules: [...rules].reverse(), lyDo: LY_DO });
    expect(giong).toMatchObject({ ok: false, error: expect.stringMatching(/giống hệt/) });
    const hong: unknown[][] = [
      [{ kind: "SLA", scope: { type: "DEFAULT" }, claimMinutes: 300, resolveMinutes: 30 }],
      [{ kind: "NOTIFY", event: "INCIDENT", centerId: null, afterMinutes: 0, to: ["u_abc"] }],
      [{ kind: "SLA", scope: { type: "CAMPUS", centerId: "cm0khongtontaiaaaaaaaaaa" }, claimMinutes: 30, resolveMinutes: 60 }],
      [{ kind: "ROUTE_PAGE_TO_CAMPUS", agentId: nen.agentId, pageId: PAGE, centerId: nen.centerA }], // màn này chỉ lưu SLA/NOTIFY
    ];
    for (const x of hong) expect((await ch.luuSlaThongBao(NG, { baseVersion: await BV(), rules: x, lyDo: LY_DO })).ok, JSON.stringify(x)).toBe(false);
    expect(await soPhienBan()).toBe(n);
  });

  it("[BQD-05] ràng buộc thu hẹp: chỉ khi Page đang BẬT tự tạo; lưu ⇒ nằm trong phiên bản; không đổi cột autoCreate; giống hệt ⇒ từ chối; cơ sở ngừng ⇒ từ chối", async () => {
    const tat = await ch.datRangBuocTuTao(NG, { baseVersion: await BV(), agentId: nen.agentId, pageId: PAGE, requireConsent: true, campusCenterIds: [], lyDo: LY_DO });
    expect(tat).toMatchObject({ ok: false, error: expect.stringMatching(/TẮT tự tạo lead/) });
    await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: true, lyDo: LY_DO });
    const ok = await ch.datRangBuocTuTao(NG, { baseVersion: await BV(), agentId: nen.agentId, pageId: PAGE, requireConsent: true, campusCenterIds: [nen.centerA], lyDo: LY_DO });
    expect(ok.ok).toBe(true);
    expect((await hienHanh())!.bo.rules.find((r) => r.kind === "AUTO_CREATE")).toMatchObject({ requireConsent: true, campusCenterIds: [nen.centerA] });
    expect((await cot()).autoCreate).toBe(true);
    expect((await ch.datRangBuocTuTao(NG, { baseVersion: await BV(), agentId: nen.agentId, pageId: PAGE, requireConsent: true, campusCenterIds: [nen.centerA], lyDo: LY_DO })).ok).toBe(false);
    // ràng buộc KHÔNG mất khi đổi cơ sở nhận (chụp lại từ cột nhưng giữ ràng buộc của phiên bản trước)
    await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerB });
    expect((await hienHanh())!.bo.rules.find((r) => r.kind === "AUTO_CREATE")).toMatchObject({ requireConsent: true, campusCenterIds: [nen.centerA] });
    await db.center.update({ where: { id: nen.centerB }, data: { isActive: false } });
    try {
      const ngung = await ch.datRangBuocTuTao(NG, { baseVersion: await BV(), agentId: nen.agentId, pageId: PAGE, requireConsent: false, campusCenterIds: [nen.centerB], lyDo: LY_DO });
      expect(ngung).toMatchObject({ ok: false, error: expect.stringMatching(/ngừng hoạt động/) });
    } finally {
      await db.center.update({ where: { id: nen.centerB }, data: { isActive: true } });
    }
  });

  it("[BQD-06] khôi phục: ghi lại CỘT theo phiên bản cũ + phiên bản MỚI (savedFromVersion); phiên bản cũ KHÔNG đổi một byte; Page không có quy tắc về mặc định an toàn", async () => {
    await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerA }); // v1
    await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: true, lyDo: LY_DO }); // v2
    await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerB }); // v3
    const v1Truoc = await db.aiLeadRuleSet.findUniqueOrThrow({ where: { version: 1 } });
    const xem = await ch.khoiPhucBoQuyTac(NG, { version: 1, lyDo: LY_DO, xemTruoc: true }, true);
    expect(xem).toMatchObject({ ok: true, thayDoi: expect.arrayContaining([expect.objectContaining({ truong: "autoCreate", tu: true, sang: false })]) });
    expect(await soPhienBan()).toBe(3); // xem trước không ghi gì
    expect((await cot()).autoCreate).toBe(true);
    const kq = await ch.khoiPhucBoQuyTac(NG, { version: 1, lyDo: LY_DO }, true);
    expect(kq).toMatchObject({ ok: true, version: 4 });
    const c = await cot();
    expect([c.routingCenterId, c.autoCreate]).toEqual([nen.centerA, false]);
    const v4 = await db.aiLeadRuleSet.findUniqueOrThrow({ where: { version: 4 } });
    expect(v4.savedFromVersion).toBe(1);
    expect(await db.aiLeadRuleSet.findUniqueOrThrow({ where: { version: 1 } })).toEqual(v1Truoc);
    expect(await db.auditLog.count({ where: { module: "ai-lead", entityType: "AiLeadRuleSet", action: "AI_LEAD_BO_QUY_TAC_KHOI_PHUC" } })).toBe(1);
  });

  it("[BQD-13] KHOÁ LẠC QUAN: lưu SLA/thông báo hoặc ràng buộc từ ảnh chụp CŨ ⇒ từ chối, nói rõ phải tải lại, không ghi đè thay đổi của người khác (review độc lập 28/10: lost update)", async () => {
    await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerA }); // v1
    await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: true, lyDo: LY_DO }); // v2
    const daThay = await BV(); // cả hai người cùng mở màn ở phiên bản này
    const sla = (phut: number) => [{ kind: "SLA", scope: { type: "DEFAULT" }, claimMinutes: phut, resolveMinutes: phut * 2 }];
    expect((await ch.luuSlaThongBao(NG, { baseVersion: daThay, rules: sla(10), lyDo: LY_DO })).ok).toBe(true); // người A lưu → v3
    const n = await soPhienBan();
    const b = await ch.luuSlaThongBao(NG, { baseVersion: daThay, rules: sla(99), lyDo: LY_DO }); // người B còn cầm ảnh cũ
    expect(b).toMatchObject({ ok: false, error: expect.stringMatching(/người khác thay đổi.*phiên bản 3.*phiên bản 2.*Tải lại/) });
    const rb = await ch.datRangBuocTuTao(NG, { baseVersion: daThay, agentId: nen.agentId, pageId: PAGE, requireConsent: true, campusCenterIds: [], lyDo: LY_DO });
    expect(rb).toMatchObject({ ok: false, error: expect.stringMatching(/người khác thay đổi/) });
    expect(await soPhienBan()).toBe(n); // không phiên bản nào được ghi
    expect((await hienHanh())!.bo.rules.find((r) => r.kind === "SLA")).toMatchObject({ claimMinutes: 10 }); // bản của A còn nguyên
    // đối chứng dương: B tải lại (phiên bản mới) rồi lưu ⇒ được
    expect((await ch.luuSlaThongBao(NG, { baseVersion: await BV(), rules: sla(99), lyDo: LY_DO })).ok).toBe(true);
    // chưa có phiên bản nào: baseVersion 0 hợp lệ, khác 0 thì không
    await db.aiLeadRuleSet.deleteMany({});
    expect((await ch.luuSlaThongBao(NG, { baseVersion: 5, rules: sla(10), lyDo: LY_DO })).ok).toBe(false);
    expect((await ch.luuSlaThongBao(NG, { baseVersion: 0, rules: sla(10), lyDo: LY_DO })).ok).toBe(true);
  });

  it("[BQD-14] KHOÁ LẠC QUAN nằm TRONG lần chụp (TOCTOU): người khác commit XEN GIỮA sau khi giao dịch đã đọc phiên bản cũ ⇒ vẫn bị từ chối, không ghi đè (review độc lập 28/10)", async () => {
    const { chupBoQuyTac, PhienBanLech } = rs;
    await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerA }); // v1
    await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: true, lyDo: LY_DO }); // v2
    const n = await soPhienBan();
    let loi: unknown = null;
    await db
      .$transaction(async (tx) => {
        const daThay = (await tx.aiLeadRuleSet.findFirst({ orderBy: { version: "desc" }, select: { version: true } }))!.version; // «cổng kiểm riêng» đọc 2
        // người B commit phiên bản 3 NGOÀI giao dịch này, sau lần đọc ở trên
        await db.aiLeadRuleSet.create({ data: { version: 3, reason: "B commit xen giữa", payload: { rules: [] }, hash: "b", publishedById: NG.userId } });
        await chupBoQuyTac(tx, NG, { lyDo: LY_DO, hanhDong: "TEST", baseVersion: daThay });
      })
      .catch((e) => {
        loi = e;
      });
    expect(loi).toBeInstanceOf(PhienBanLech);
    expect(await soPhienBan()).toBe(n + 1); // chỉ phiên bản của B; lần chụp của A đã rollback
  });

  it("[BQD-15] PHIÊN BẢN MỚI NHẤT HỎNG: đổi cấu hình để lại Page đang BẬT tự tạo ⇒ từ chối (không xoá lặng lẽ ràng buộc); TẮT tự tạo vẫn được; KHÔI PHỤC từ bản tốt vẫn được; màn Quy tắc báo phienBanHong (review độc lập 28/10)", async () => {
    await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerA }); // v1
    await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: true, lyDo: LY_DO }); // v2 (auto bật)
    await db.aiLeadRuleSet.create({ data: { version: 3, reason: "hỏng có chủ đích", payload: { rules: [{ kind: "LA" }] }, hash: "x", publishedById: NG.userId } });
    expect((await ch.docBoQuyTacView()).phienBanHong).toBe(3);
    const n = await soPhienBan();
    const doi = await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerB });
    expect(doi).toMatchObject({ ok: false, error: expect.stringMatching(/Phiên bản 3 .*hỏng/) });
    expect(await soPhienBan()).toBe(n);
    expect((await cot()).routingCenterId).toBe(nen.centerA); // cột không đổi
    // khôi phục từ bản tốt (v2) KHÔNG bị chặn: ràng buộc lấy từ chính bản được khôi phục
    expect((await ch.khoiPhucBoQuyTac(NG, { version: 2, lyDo: LY_DO }, true)).ok).toBe(true);
    expect((await ch.docBoQuyTacView()).phienBanHong).toBeNull();
    // hỏng lần nữa: TẮT tự tạo (không còn Page nào bật) vẫn chụp được
    await db.aiLeadRuleSet.create({ data: { version: 99, reason: "hỏng lần hai", payload: { rules: [{ kind: "LA" }] }, hash: "y", publishedById: NG.userId } });
    expect((await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: false, lyDo: LY_DO })).ok).toBe(true);
    expect((await cot()).autoCreate).toBe(false);
  });

  it("[BQD-12] khôi phục KHÔNG được BẬT lại tự tạo lead nếu người gọi thiếu ai-integration:manage (review độc lập 28/10: vòng qua cổng riêng của datTuTaoLeadChoPage); chiều TẮT luôn được", async () => {
    await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerA }); // v1
    await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: true, lyDo: LY_DO }); // v2: BẬT
    await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: false, lyDo: LY_DO }); // v3: TẮT
    const n = await soPhienBan();
    expect((await cot()).autoCreate).toBe(false);
    // thiếu quyền: cả xem trước lẫn thật đều bị từ chối, cột và phiên bản không đổi
    for (const xemTruoc of [true, false]) {
      const kq = await ch.khoiPhucBoQuyTac(NG, { version: 2, lyDo: LY_DO, xemTruoc }, false);
      expect(kq, JSON.stringify(kq)).toMatchObject({ ok: false, error: expect.stringMatching(/ai-integration:manage/) });
    }
    expect((await cot()).autoCreate).toBe(false);
    expect(await soPhienBan()).toBe(n);
    // đủ quyền: khôi phục BẬT được
    expect(await ch.khoiPhucBoQuyTac(NG, { version: 2, lyDo: LY_DO }, true)).toMatchObject({ ok: true });
    expect((await cot()).autoCreate).toBe(true);
    // chiều TẮT không cần quyền manage: khôi phục v1 (không bật) khi đang bật
    expect(await ch.khoiPhucBoQuyTac(NG, { version: 1, lyDo: LY_DO }, false)).toMatchObject({ ok: true });
    expect((await cot()).autoCreate).toBe(false);
  });

  it("[BQD-16] khôi phục KHÔNG làm sống lại quy tắc AUTO của Page ĐÃ GỠ (quy tắc mồ côi)", async () => {
    await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerA }); // v1
    await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: true, lyDo: LY_DO }); // v2: có AUTO của PAGE
    const trong = (await hienHanh())!.bo.rules.filter((r) => r.kind === "AUTO_CREATE");
    expect(trong).toHaveLength(1);
    expect((await ch.goPageKhoiAgent(NG, { agentId: nen.agentId, pageId: PAGE, lyDo: LY_DO })).ok).toBe(true); // v3: Page bị gỡ
    expect((await hienHanh())!.bo.rules.some((r) => r.kind === "AUTO_CREATE")).toBe(false);
    const kp = await ch.khoiPhucBoQuyTac(NG, { version: 2, lyDo: LY_DO }, true);
    // Page không còn: phiên bản mới không mang lại quy tắc AUTO mồ côi (hoặc «giống hệt» nếu không còn gì đổi)
    const sau = (await hienHanh())!.bo.rules;
    expect(sau.some((r) => r.kind === "AUTO_CREATE" && r.pageId === PAGE)).toBe(false);
    expect(kp.ok || /giống hệt/.test((kp as { error?: string }).error ?? "")).toBe(true);
  });

  it("[BQD-07] khôi phục KIỂM LẠI thế giới sống: cơ sở trong phiên bản cũ đã ngừng ⇒ từ chối, nêu rõ, không đổi cột, không tạo phiên bản", async () => {
    await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerA }); // v1
    await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerB }); // v2
    await db.center.update({ where: { id: nen.centerA }, data: { isActive: false } });
    try {
      const kq = await ch.khoiPhucBoQuyTac(NG, { version: 1, lyDo: LY_DO }, true);
      expect(kq).toMatchObject({ ok: false, error: expect.stringMatching(/không còn khớp.*ngừng hoạt động/) });
      expect((await cot()).routingCenterId).toBe(nen.centerB);
      expect(await soPhienBan()).toBe(2);
    } finally {
      await db.center.update({ where: { id: nen.centerA }, data: { isActive: true } });
    }
    expect(await ch.khoiPhucBoQuyTac(NG, { version: 99, lyDo: LY_DO }, true)).toMatchObject({ ok: false, error: expect.stringMatching(/Không tìm thấy/) });
  });

  it("[BQD-08] khôi phục phiên bản GIỐNG HỆT hiện hành ⇒ từ chối; payload hỏng ⇒ từ chối và docBoHienHanh rơi về null (không làm sập Gateway)", async () => {
    await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerA }); // v1
    expect(await ch.khoiPhucBoQuyTac(NG, { version: 1, lyDo: LY_DO }, true)).toMatchObject({ ok: false, error: expect.stringMatching(/giống hệt/) });
    await db.aiLeadRuleSet.create({ data: { version: 2, reason: "hỏng có chủ đích", payload: { rules: [{ kind: "LA" }] }, hash: "x", publishedById: NG.userId } });
    expect(await rs.docBoHienHanh()).toBeNull();
    expect(await ch.khoiPhucBoQuyTac(NG, { version: 2, lyDo: LY_DO }, true)).toMatchObject({ ok: false, error: expect.stringMatching(/không đọc được/) });
  });

  it("[BQD-09] ĐUA: hai hành động đổi cột chạy song song ⇒ không bao giờ hai phiên bản trùng số; mỗi bên hoặc thành công hoặc báo 'tải lại'; cột cuối khớp phiên bản cuối", async () => {
    await themPage("104500000000556");
    const kq = await Promise.allSettled([
      ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerA }),
      ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: "104500000000556", routingCenterId: nen.centerB }),
      ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: true, lyDo: LY_DO }),
    ]);
    for (const k of kq) {
      expect(k.status).toBe("fulfilled");
      if (k.status === "fulfilled" && !k.value.ok) expect(k.value.error).toMatch(/tải lại/);
    }
    const ds = await db.aiLeadRuleSet.findMany({ orderBy: { version: "asc" } });
    expect(ds.map((d) => d.version)).toEqual(ds.map((_, i) => i + 1)); // liên tục, không lỗ, không trùng
    const h = (await hienHanh())!;
    const c1 = await cot();
    const c2 = await cot("104500000000556");
    // phiên bản CUỐI phải phản ánh đúng cột sau khi mọi giao dịch xong nếu bên ghi sau chụp sau (không có "cập nhật mất")
    const route = (p: string) => h.bo.rules.find((r) => r.kind === "ROUTE_PAGE_TO_CAMPUS" && r.pageId === p);
    if (c1.routingCenterId) expect(route(PAGE)).toMatchObject({ centerId: c1.routingCenterId });
    if (c2.routingCenterId) expect(route("104500000000556")).toMatchObject({ centerId: c2.routingCenterId });
  });

  it("[BQD-11] CƠ SỞ THẬT CÓ ID LÀ SLUG (PROD: co-so-hoang-dieu…): đặt cơ sở nhận · chụp phiên bản · SLA theo cơ sở · ràng buộc cơ sở · khôi phục đều chạy với slug (lỗi CRITICAL do review độc lập 28/10)", async () => {
    const SLUG = "bqd-co-so-slug";
    await db.orgUnit.deleteMany({ where: { code: `${P}SLUG` } });
    await db.center.deleteMany({ where: { id: SLUG } });
    await db.center.create({ data: { id: SLUG, code: "BQS", name: `${P}Cơ sở slug`, slug: SLUG, address: "9 Đường Slug", isActive: true } });
    await db.orgUnit.create({ data: { type: "CENTER", code: `${P}SLUG`, name: `${P}OrgUnit slug`, centerId: SLUG, path: `/${P.toLowerCase()}slug/`, depth: 2, isActive: true } });
    try {
      expect((await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: SLUG })).ok).toBe(true);
      expect((await cot()).routingCenterId).toBe(SLUG);
      expect((await hienHanh())!.bo.rules.find((r) => r.kind === "ROUTE_PAGE_TO_CAMPUS")).toMatchObject({ centerId: SLUG });
      await ch.datTuTaoLeadChoPage(NG, { agentId: nen.agentId, pageId: PAGE, bat: true, lyDo: LY_DO });
      expect((await ch.datRangBuocTuTao(NG, { baseVersion: await BV(), agentId: nen.agentId, pageId: PAGE, requireConsent: false, campusCenterIds: [SLUG], lyDo: LY_DO })).ok).toBe(true);
      const luu = await ch.luuSlaThongBao(NG, { baseVersion: await BV(),
        rules: [
          { kind: "SLA", scope: { type: "CAMPUS", centerId: SLUG }, claimMinutes: 10, resolveMinutes: 100 },
          { kind: "NOTIFY", event: "SLA_CLAIM_OVERDUE", centerId: SLUG, afterMinutes: 30, to: ["HO_REVIEWERS"] },
        ],
        lyDo: LY_DO,
      });
      expect(luu.ok, JSON.stringify(luu)).toBe(true);
      // khôi phục một phiên bản cũ vẫn kiểm lại thế giới sống với slug và ghi cột đúng
      await ch.datCoSoNhanMacDinh(NG, { agentId: nen.agentId, pageId: PAGE, routingCenterId: nen.centerA });
      const kp = await ch.khoiPhucBoQuyTac(NG, { version: 1, lyDo: LY_DO }, true);
      expect(kp.ok, JSON.stringify(kp)).toBe(true);
      expect((await cot()).routingCenterId).toBe(SLUG);
    } finally {
      await db.aiLeadAgentPage.updateMany({ where: { routingCenterId: SLUG }, data: { routingCenterId: null } });
      await db.aiLeadRuleSet.deleteMany({});
      await db.orgUnit.deleteMany({ where: { code: `${P}SLUG` } });
      await db.center.deleteMany({ where: { id: SLUG } });
    }
  });

  it("[BQD-10] BẤT BIẾN: mã sản phẩm không có đường nào UPDATE/DELETE bảng AiLeadRuleSet (chỉ create + đọc)", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const dem = (dir: string, re: RegExp): number => {
      let n = 0;
      for (const e of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) n += dem(p, re);
        else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) n += (readFileSync(resolve(process.cwd(), p), "utf8").match(re) ?? []).length;
      }
      return n;
    };
    for (const d of ["lib/ai-lead", "app/(admin)/admin/ai-lead", "app/api"]) {
      expect(dem(d, /aiLeadRuleSet\.(update|updateMany|delete|deleteMany|upsert)\(/g), d).toBe(0);
    }
  });
  it("[BQD-17] TỔNG GỘP (định tuyến sinh từ cột Page + SLA/thông báo) vượt trần 300 ⇒ câu lỗi tiếng Việt, KHÔNG ném, KHÔNG tạo phiên bản; bớt dưới trần ⇒ lưu được (đối chứng dương)", async () => {
    // 295 SLA theo Page (tập con SLA+thông báo = 295 ≤ 300 nên qua cổng schema của màn hình) + 10 Page có cơ sở nhận ⇒ 10 quy tắc ROUTE sinh từ cột ⇒ tổng 305.
    const ids = Array.from({ length: 295 }, (_, i) => `1046${String(i).padStart(11, "0")}`);
    await db.aiLeadAgentPage.createMany({ data: ids.map((pageId, i) => ({ agentId: nen.agentId, pageId, routingCenterId: i < 10 ? nen.centerA : null })) });
    const rules = ids.map((pageId) => ({ kind: "SLA", scope: { type: "PAGE", pageId }, claimMinutes: 30, resolveMinutes: 240 }));
    const truoc = await soPhienBan();
    const r = await ch.luuSlaThongBao(NG, { baseVersion: await BV(), rules, lyDo: LY_DO });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tối đa 300 quy tắc/);
    expect(await soPhienBan(), "không tạo phiên bản khi từ chối").toBe(truoc);
    const ok = await ch.luuSlaThongBao(NG, { baseVersion: await BV(), rules: rules.slice(0, 280), lyDo: LY_DO });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
  }, 60_000);
});
