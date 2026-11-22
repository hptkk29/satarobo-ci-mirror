// @vitest-environment node
/**
 * AI LEAD — «NGOẠI LỆ» (`ngoai-le.ts`) trên POSTGRES THẬT, `taoLeadTuHoSo` + `ingestIntakeLead` THẬT (chỉ ca [NLE-30] đặt ingest ném lỗi để ép đường lỗi hạ tầng).
 *
 * Những thứ test thuần KHÔNG chứng minh được và bug ở đó không văng lỗi:
 *   1. HÀM THUẦN `phanLoaiNgoaiLe` và mệnh đề `where` gửi lên Postgres là HAI cài đặt của cùng một định nghĩa «quá hạn» — [NLE-02] đối chiếu từng hồ sơ.
 *   2. CÁCH LY CƠ SỞ khi GHI (scopedDb không che write): QLCS cơ sở B gọi thẳng cho hồ sơ cơ sở A; hồ sơ `centerId = NULL` chỉ Hội sở.
 *   3. ĐUA: hai người cùng «Thử lại» ⇒ ĐÚNG MỘT lead, ĐÚNG MỘT lần ghi.
 *   4. «Đã xử lý» không được im lặng nói dối khi lead vẫn vô chủ.
 *
 * ⚠️ Tự SKIP khi không có Postgres test. Thấy SKIP nghĩa là CHƯA KIỂM ĐƯỢC GÌ.
 * `resolveActor` được thay bằng bảng tra trong bộ nhớ (RBAC có test riêng; ở đây cần điều khiển ĐÚNG hình dạng actor). `getSetting` KHÔNG mock — dùng giá trị mặc định thật.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../../lib/auth/actor";
import { RUN_DB_TESTS, assertTenDbTest } from "../_helpers/db-gate";
import { actorChiXem, actorHoiSo, actorQlcs } from "../../lib/ai-lead/dich-vu/ho-tro-test-duyet";
import { phanLoaiNgoaiLe } from "../../lib/ai-lead/dich-vu/ngoai-le-thuan";
import { P, PAGE, PHONE_NOI_DIA, db, donDep, dungNen, taoHoSo, taoHoiThoai, type Nen } from "./_nen-c";

const bang = vi.hoisted(() => ({ actors: new Map<string, unknown>() }));
const ing = vi.hoisted(() => ({ nem: false }));

// Nguồn «ai là người duyệt của cơ sở» được kiểm bằng RBAC THẬT ở ma-tran-quyen.spec ([AMQ-08]). Ở đây các ca thử CỔNG LỌC ứng viên (can() + phạm vi) trên actor giả lập, với tập đầu vào là
// các tài khoản fixture khai bằng cột vai cũ — nên thay đúng nguồn ấy bằng truy vấn cột vai cũ (không phải UserOrgRole) để giữ nguyên ý nghĩa các ca.
vi.mock("../../lib/ai-lead/dich-vu/nguoi-duyet-co-so", async () => {
  const { db: csdl } = await import("./_nen-c");
  return {
    nguoiDuyetCoSo: async (centerId: string): Promise<string[]> =>
      (await csdl.user.findMany({ where: { isActive: true, deletedAt: null, roles: { has: "CENTER_MANAGER" }, centerId }, select: { id: true } })).map((u) => u.id),
  };
});
vi.mock("@/lib/auth/actor", async (goc) => ({
  ...(await goc<typeof import("../../lib/auth/actor")>()),
  resolveActor: vi.fn(async (id: string) => bang.actors.get(id)),
}));
vi.mock("@/lib/lead/intake/ingest", async (goc) => {
  const m = await goc<typeof import("@/lib/lead/intake/ingest")>();
  return {
    ...m,
    ingestIntakeLead: vi.fn(async (...a: Parameters<typeof m.ingestIntakeLead>) => {
      if (ing.nem) throw new Error("hạ tầng sập giả lập — kèm SĐT 0905123456");
      return m.ingestIntakeLead(...a);
    }),
  };
});

const CO_BANG = RUN_DB_TESTS && (await db.aiLeadDraft.count().then(() => true).catch(() => false));
if (!CO_BANG) console.warn("[ai-lead ngoai-le] SKIP: không có Postgres test hoặc chưa có bảng AiLead*.");

const NOW = new Date("2026-11-07T10:00:00.000Z");
const QUA = new Date(NOW.getTime() - 3_600_000);
const SAU = new Date(NOW.getTime() + 3_600_000);
const PHONE_THAT = `84${PHONE_NOI_DIA[0].slice(1)}`;
const LY_DO = "Kiểm thử: đã đối chiếu với hồ sơ";

describe.skipIf(!CO_BANG)("[NLE] ngoai-le.ts — DB thật", () => {
  let nen: Nen;
  let svc: typeof import("../../lib/ai-lead/dich-vu/ngoai-le");
  let qlA: Actor;
  let qlA2: Actor;
  let qlB: Actor;
  let ho: Actor;
  const ten = (a: Actor) => ({ actor: a, ten: `Tên ${a.userId}` });
  const doc = (id: string) => db.aiLeadDraft.findUniqueOrThrow({ where: { id } });
  const soAudit = (id: string, action: string) => db.auditLog.count({ where: { entityId: id, action } });
  const soLead = (id: string) => db.lead.count({ where: { eventId: `ailead:${id}` } });
  let conv = 0;
  const hoiThoai = () => taoHoiThoai(nen, `e${++conv}`);
  const taoSe = async (id: string, o: Parameters<typeof taoHoSo>[1] = {}) => {
    const d = await taoHoSo(nen, { id: `${P}${id}`, state: "SYSTEM_EXCEPTION", convId: await hoiThoai(), ...o });
    return db.aiLeadDraft.update({ where: { id: d.id }, data: { resultNote: "INGEST_NEM_LOI" } });
  };
  /** Hồ sơ ASSIGNMENT_PENDING THẬT: chạy `taoLeadTuHoSo` thật rồi ép lead về «chưa có chủ». */
  const taoAp = async (id: string, phone: string = PHONE_NOI_DIA[0]) => {
    // SĐT khác nhau ⇒ lead khác nhau (cùng SĐT ⇒ STAFF gộp vào một lead, và `assignedToId: null` bên dưới đè lên hồ sơ trước).
    const d = await taoHoSo(nen, { id: `${P}${id}`, convId: await hoiThoai(), phone });
    const { taoLeadTuHoSo } = await import("../../lib/ai-lead/dich-vu/tao-lead");
    const kq = await taoLeadTuHoSo(d.id, { actor: qlA, tu: "STAFF", tenNguoi: "QL" });
    if (!kq.ok || !kq.leadId) throw new Error("dựng ASSIGNMENT_PENDING thất bại");
    await db.lead.update({ where: { id: kq.leadId }, data: { assignedToId: null } });
    await db.aiLeadDraft.update({ where: { id: d.id }, data: { state: "ASSIGNMENT_PENDING", closedAt: null } });
    return { draft: await doc(d.id), leadId: kq.leadId };
  };

  beforeAll(async () => {
    assertTenDbTest();
    svc = await import("../../lib/ai-lead/dich-vu/ngoai-le");
  });
  beforeEach(async () => {
    nen = await dungNen();
    qlA = actorQlcs(`${P}qlA`, [nen.centerA]);
    qlA2 = actorQlcs(`${P}qlA2`, [nen.centerA]);
    qlB = actorQlcs(`${P}qlB`, [nen.centerB]);
    ho = actorHoiSo(`${P}ho`);
    bang.actors.clear();
    ing.nem = false;
    for (const a of [qlA, qlA2, qlB, ho]) bang.actors.set(a.userId, a);
  }, 60_000);
  afterAll(async () => {
    await db.staffNotification.deleteMany({ where: { dedupeKey: { startsWith: `ai_lead.draft:${P}` } } });
    await donDep();
    await db.$disconnect();
  });

  // ── 1. DANH SÁCH ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("danh sách", () => {
    it("[NLE-01] đủ ba loại; hồ sơ bình thường / đã đóng KHÔNG xuất hiện; mỗi loại đúng nhãn", async () => {
      await taoSe("se1");
      await taoHoSo(nen, { id: `${P}ap1`, state: "ASSIGNMENT_PENDING", convId: await hoiThoai() });
      await taoHoSo(nen, { id: `${P}qh1`, state: "WAITING_QLCS", slaClaimDueAt: QUA, convId: await hoiThoai() });
      await taoHoSo(nen, { id: `${P}ok1`, state: "WAITING_QLCS", slaClaimDueAt: SAU, slaResolveDueAt: SAU, convId: await hoiThoai() });
      await taoHoSo(nen, { id: `${P}xong1`, state: "COMPLETED", slaClaimDueAt: QUA, convId: await hoiThoai() });
      await taoHoSo(nen, { id: `${P}tc1`, state: "REJECTED", slaClaimDueAt: QUA, convId: await hoiThoai() });
      const kq = await svc.danhSachNgoaiLe(qlA, {}, true, NOW);
      const mine = kq.hang.filter((h) => h.id.startsWith(P));
      expect(Object.fromEntries(mine.map((h) => [h.id, h.loai]))).toEqual({
        [`${P}se1`]: "SYSTEM_EXCEPTION",
        [`${P}ap1`]: "ASSIGNMENT_PENDING",
        [`${P}qh1`]: "QUA_HAN_SLA",
      });
      expect(mine.map((h) => h.loai)).toEqual(["SYSTEM_EXCEPTION", "ASSIGNMENT_PENDING", "QUA_HAN_SLA"]); // nặng trước
      expect(kq.dem).toMatchObject({ SYSTEM_EXCEPTION: 1, ASSIGNMENT_PENDING: 1, QUA_HAN_SLA: 1 });
      expect(kq.tong).toBe(3);
      expect(mine.find((h) => h.id === `${P}se1`)!.lyDo.ma).toBe("INGEST_NEM_LOI");
    });

    it("[NLE-02] ĐỊNH NGHĨA QUÁ HẠN chỉ MỘT: tập hồ sơ do Postgres trả về ≡ tập hồ sơ hàm thuần phân loại là ngoại lệ, cùng loại (ma trận trạng thái × người nhận × hạn)", async () => {
      const ca: Array<[string, Parameters<typeof taoHoSo>[1]]> = [
        ["m1", { state: "COLLECTING", slaClaimDueAt: QUA }],
        ["m2", { state: "PENDING_INFO", slaResolveDueAt: QUA }],
        ["m3", { state: "WAITING_QLCS", slaClaimDueAt: QUA }],
        ["m4", { state: "WAITING_QLCS", claimedById: qlA.userId, slaClaimDueAt: QUA }], // đã có người nhận ⇒ hạn NHẬN không còn nghĩa
        ["m5", { state: "IN_PROGRESS", claimedById: qlA.userId, slaClaimDueAt: QUA, slaResolveDueAt: QUA }],
        ["m6", { state: "IN_PROGRESS", claimedById: qlA.userId, slaResolveDueAt: SAU }],
        ["m7", { state: "READY_FOR_REVIEW", slaClaimDueAt: SAU, slaResolveDueAt: SAU }],
        ["m8", { state: "READY_FOR_REVIEW" }],
        ["m9", { state: "SYSTEM_EXCEPTION", slaResolveDueAt: QUA }],
        ["m10", { state: "ASSIGNMENT_PENDING", slaResolveDueAt: QUA }],
        ["m11", { state: "COMPLETED", slaClaimDueAt: QUA, slaResolveDueAt: QUA }],
        ["m12", { state: "REJECTED", slaClaimDueAt: QUA }],
        ["m13", { state: "EXPIRED", slaClaimDueAt: QUA }],
        ["m14", { state: "WAITING_QLCS", slaClaimDueAt: NOW }], // đúng biên: chưa quá hạn
      ];
      for (const [id, o] of ca) await taoHoSo(nen, { id: `${P}${id}`, convId: await hoiThoai(), ...o });
      const dong = await db.aiLeadDraft.findMany({ where: { id: { startsWith: P } } });
      const mongDoi = new Map(dong.map((d) => [d.id, phanLoaiNgoaiLe(d, NOW)]));
      const kq = await svc.danhSachNgoaiLe(ho, {}, true, NOW);
      const thuc = new Map(kq.hang.filter((h) => h.id.startsWith(P)).map((h) => [h.id, h.loai]));
      expect(Object.fromEntries(thuc)).toEqual(Object.fromEntries([...mongDoi].filter(([, l]) => l !== null)));
      // Số đếm từng loại cũng PHẢI bằng số hồ sơ hàm thuần xếp vào loại đó (không đếm hai lần một hồ sơ vừa lỗi vừa quá hạn — m9).
      for (const loai of ["SYSTEM_EXCEPTION", "ASSIGNMENT_PENDING", "QUA_HAN_SLA"] as const) {
        expect(kq.dem[loai], loai).toBe([...mongDoi.values()].filter((l) => l === loai).length);
      }
      expect(thuc.size).toBe(6); // m1 m2 m3 m5 (quá hạn) + m9 (lỗi) + m10 (chờ phân công) — không rỗng nên ca không đạt vì lý do sai
    });

    it("[NLE-03] CÁCH LY: QLCS thấy hồ sơ cơ sở mình; hồ sơ chưa biết cơ sở chỉ Hội sở thấy", async () => {
      await taoSe("a");
      await taoSe("b", { centerId: nen.centerB, campusCenterId: nen.centerB, campusCode: "ATB" });
      await taoSe("n", { centerId: null, campusCenterId: null, campusCode: null });
      const ids = async (a: Actor) => (await svc.danhSachNgoaiLe(a, {}, true, NOW)).hang.filter((h) => h.id.startsWith(P)).map((h) => h.id).sort();
      expect(await ids(qlA)).toEqual([`${P}a`]);
      expect(await ids(qlB)).toEqual([`${P}b`]);
      expect(await ids(ho)).toEqual([`${P}a`, `${P}b`, `${P}n`]);
      // số đếm cũng đi qua phạm vi — không rò số lượng của cơ sở khác
      expect((await svc.danhSachNgoaiLe(qlA, {}, true, NOW)).dem.SYSTEM_EXCEPTION).toBe(1);
    });

    it("[NLE-04] PII: thiếu quyền xem PII ⇒ tên che ở SERVER, không SĐT nào; resultNote lạ KHÔNG bị in lại; có quyền ⇒ thấy tên thật", async () => {
      const d = await taoSe("p1");
      await db.aiLeadDraft.update({ where: { id: d.id }, data: { resultNote: `PrismaClientKnownRequestError phone=${PHONE_THAT} Nguyễn Thị Lan` } });
      const kin = await svc.danhSachNgoaiLe(qlA, {}, false, NOW);
      const json = JSON.stringify(kin);
      expect(json).not.toContain(PHONE_THAT);
      expect(json).not.toContain(PHONE_NOI_DIA[0]);
      expect(json).not.toContain("Nguyễn Thị Lan");
      expect(json).not.toContain("Prisma");
      expect(kin.hang.find((h) => h.id === d.id)!.lyDo.ma).toBeNull();
      // đối chứng DƯƠNG: có quyền thì tên thật hiện ra (nếu không, ca trên đạt vì lý do sai)
      const mo = await svc.danhSachNgoaiLe(qlA, {}, true, NOW);
      expect(mo.hang.find((h) => h.id === d.id)!.fbName).toBe("Nguyễn Thị Lan");
      expect(JSON.stringify(mo)).not.toContain(PHONE_THAT);
    });

    it("[NLE-05] bộ lọc: loại · Page · cơ sở · mã hồ sơ (đếm từng loại theo các bộ lọc còn lại)", async () => {
      await taoSe("l1abcdef");
      await taoHoSo(nen, { id: `${P}l2`, state: "ASSIGNMENT_PENDING", convId: await hoiThoai() });
      const ids = async (loc: Parameters<typeof svc.danhSachNgoaiLe>[1]) => (await svc.danhSachNgoaiLe(qlA, loc, true, NOW)).hang.map((h) => h.id).sort();
      expect(await ids({ loai: "ASSIGNMENT_PENDING" })).toEqual([`${P}l2`]);
      expect(await ids({ loai: "SYSTEM_EXCEPTION" })).toEqual([`${P}l1abcdef`]);
      expect(await ids({ loai: "QUA_HAN_SLA" })).toEqual([]);
      expect(await ids({ q: "l1abcdef" })).toEqual([`${P}l1abcdef`]);
      expect(await ids({ pageId: "Page-khac" })).toEqual([]);
      expect(await ids({ pageId: PAGE })).toHaveLength(2);
      expect(await ids({ coSoId: nen.centerB })).toEqual([]);
      const dem = (await svc.danhSachNgoaiLe(qlA, { q: "l1abcdef" }, true, NOW)).dem;
      expect(dem).toMatchObject({ SYSTEM_EXCEPTION: 1, ASSIGNMENT_PENDING: 0 });
    });

    it("[NLE-06] dòng mang nút ĐÚNG với quyền & người giữ: view-only không nút; người khác giữ ⇒ nút tối kèm tên; ứng viên giao = quản lý khác của cơ sở", async () => {
      const ql2 = await db.user.create({ data: { name: `${P}Quản lý A2`, email: `${P.toLowerCase()}ql2@example.test`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: nen.centerA } });
      bang.actors.set(ql2.id, actorQlcs(ql2.id, [nen.centerA])); // ứng viên chỉ hiện khi actor RBAC v2 của họ thật sự có `ai-leads:review` tại cơ sở (FIX-01)
      try {
        await taoSe("b1");
        await taoSe("b2", { claimedById: qlA2.userId });
        const xem = actorChiXem(`${P}xem`, [nen.centerA]);
        const rXem = (await svc.danhSachNgoaiLe(xem, {}, true, NOW)).hang.find((h) => h.id === `${P}b1`)!;
        expect([rXem.coQuyenXuLy, rXem.nut.thuLai.hien, rXem.nut.giaoNguoi.hien]).toEqual([false, false, false]);
        const r = (await svc.danhSachNgoaiLe(qlA, {}, true, NOW)).hang;
        const b1 = r.find((h) => h.id === `${P}b1`)!;
        expect(b1.nut.thuLai).toMatchObject({ hien: true, bat: true });
        expect(b1.ungVien.map((u) => u.id)).toContain(ql2.id);
        expect(b1.ungVien.map((u) => u.id)).not.toContain(qlA.userId);
        const b2 = r.find((h) => h.id === `${P}b2`)!;
        expect(b2.nut.thuLai).toMatchObject({ hien: true, bat: false });
        expect(b2.nut.giaoNguoi.bat).toBe(false);
      } finally {
        await db.user.delete({ where: { id: ql2.id } });
      }
    });

    it("[NLE-07] ASSIGNMENT_PENDING: dòng biết lead đã có người phụ trách chưa ⇒ nút «Đánh dấu» sáng/tối đúng", async () => {
      const { draft, leadId } = await taoAp("ap-dong");
      const hang = async () => (await svc.danhSachNgoaiLe(qlA, {}, true, NOW)).hang.find((h) => h.id === draft.id)!;
      expect((await hang()).leadDaCoNguoi).toBe(false);
      expect((await hang()).nut.danhDauDaXuLy).toMatchObject({ hien: true, bat: false });
      expect((await hang()).lyDo.cau).toContain("chưa có sale");
      const sale = await db.user.create({ data: { name: `${P}Sale`, email: `${P.toLowerCase()}sale@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: nen.centerA } });
      try {
        await db.lead.update({ where: { id: leadId }, data: { assignedToId: sale.id } });
        expect((await hang()).leadDaCoNguoi).toBe(true);
        expect((await hang()).nut.danhDauDaXuLy.bat).toBe(true);
        // Nút sáng thì câu lý do cũng phải nói «đã có sale» — không còn nói «chưa có sale» (cùng một sự thật).
        expect((await hang()).lyDo.cau).toContain("đã có sale");
        expect((await hang()).lyDo.cau).not.toContain("chưa có sale");
      } finally {
        await db.lead.update({ where: { id: leadId }, data: { assignedToId: null } });
        await db.user.delete({ where: { id: sale.id } });
      }
    });
  });

  // ── 2. THỬ LẠI TẠO LEAD ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("thử lại tạo lead", () => {
    it("[NLE-10] hồ sơ lỗi, đủ điều kiện ⇒ ĐÚNG MỘT lead, hồ sơ ra khỏi hàng đợi, người thử lại nhận hồ sơ, audit có LÝ DO, lỗi cũ được xoá", async () => {
      const d = await taoSe("t1");
      const kq = await svc.thuLaiTaoLead(ten(qlA), { draftId: d.id, version: d.version, lyDo: LY_DO });
      expect(kq.ok).toBe(true);
      const sau = await doc(d.id);
      expect(["COMPLETED", "ASSIGNMENT_PENDING"]).toContain(sau.state);
      expect(sau).toMatchObject({ claimedById: qlA.userId, resultNote: null });
      expect(sau.leadId).not.toBeNull();
      expect(await soLead(d.id)).toBe(1);
      const au = await db.auditLog.findMany({ where: { entityId: d.id, action: "RETRY_CREATE_LEAD" } });
      expect(au).toHaveLength(1);
      expect(au[0]!.reason).toBe(LY_DO);
      expect(JSON.stringify(au[0]!.oldValues)).toContain("INGEST_NEM_LOI");
      expect(JSON.stringify(au)).not.toContain(PHONE_THAT);
      // đã ra khỏi danh sách ngoại lệ (trừ khi CRM không chia được sale ⇒ chuyển sang loại ASSIGNMENT_PENDING)
      const con = (await svc.danhSachNgoaiLe(qlA, {}, true, NOW)).hang.filter((h) => h.id === d.id);
      expect(con.every((h) => h.loai === "ASSIGNMENT_PENDING")).toBe(true);
    });

    it("[NLE-11] IDEMPOTENT: bấm lần hai (version cũ) ⇒ OK «đã có lead», không lead thứ hai, không audit thứ hai, version không đổi", async () => {
      const d = await taoSe("t2");
      const k1 = await svc.thuLaiTaoLead(ten(qlA), { draftId: d.id, version: d.version, lyDo: LY_DO });
      const giua = await doc(d.id);
      const k2 = await svc.thuLaiTaoLead(ten(qlA2), { draftId: d.id, version: d.version, lyDo: LY_DO });
      expect(k1.ok && k1.data.daCoLead).toBe(false);
      expect(k2).toMatchObject({ ok: true, data: { leadId: giua.leadId, daCoLead: true } });
      expect(await soLead(d.id)).toBe(1);
      expect(await soAudit(d.id, "RETRY_CREATE_LEAD")).toBe(1);
      expect((await doc(d.id)).version).toBe(giua.version);
    });

    it("[NLE-12] ĐUA: hai QLCS cùng thử lại với cùng version ⇒ ĐÚNG MỘT lead, đúng MỘT lần ghi, một người thắng", async () => {
      const d = await taoSe("t3");
      const kq = await Promise.all([
        svc.thuLaiTaoLead(ten(qlA), { draftId: d.id, version: d.version, lyDo: LY_DO }),
        svc.thuLaiTaoLead(ten(qlA2), { draftId: d.id, version: d.version, lyDo: LY_DO }),
      ]);
      expect(kq.filter((k) => k.ok && !k.data.daCoLead)).toHaveLength(1);
      for (const k of kq) {
        if (!k.ok) expect(["XUNG_DOT_PHIEN_BAN", "DA_NGUOI_KHAC_NHAN", "TRANG_THAI_KHONG_HOP_LE"]).toContain(k.error.code);
      }
      expect(await soLead(d.id)).toBe(1);
      expect(await soAudit(d.id, "RETRY_CREATE_LEAD")).toBe(1);
      expect([qlA.userId, qlA2.userId]).toContain((await doc(d.id)).claimedById);
    });

    it("[NLE-13] ASSIGNMENT_PENDING KHÔNG bị thử lại: không ingest, không lead mới, không audit, version giữ nguyên", async () => {
      const { draft } = await taoAp("t4");
      const truocLead = await db.lead.count({ where: { eventId: { startsWith: `ailead:${P}` } } });
      const truocAudit = await db.auditLog.count({ where: { entityId: draft.id } });
      const kq = await svc.thuLaiTaoLead(ten(qlA), { draftId: draft.id, version: draft.version, lyDo: LY_DO });
      expect(kq).toMatchObject({ ok: true, data: { daCoLead: true } });
      expect(await db.lead.count({ where: { eventId: { startsWith: `ailead:${P}` } } })).toBe(truocLead);
      expect(await db.auditLog.count({ where: { entityId: draft.id } })).toBe(truocAudit);
      expect(await doc(draft.id)).toMatchObject({ state: "ASSIGNMENT_PENDING", version: draft.version });
    });

    it("[NLE-14] trạng thái khác SYSTEM_EXCEPTION (chờ duyệt thường, đã từ chối) ⇒ từ chối, DB y nguyên", async () => {
      const ready = await taoHoSo(nen, { id: `${P}t5`, state: "READY_FOR_REVIEW", convId: await hoiThoai() });
      const rej = await taoHoSo(nen, { id: `${P}t6`, state: "REJECTED", convId: await hoiThoai() });
      expect(await svc.thuLaiTaoLead(ten(qlA), { draftId: ready.id, version: ready.version, lyDo: LY_DO })).toMatchObject({ ok: false, error: { code: "TRANG_THAI_KHONG_HOP_LE" } });
      expect(await svc.thuLaiTaoLead(ten(qlA), { draftId: rej.id, version: rej.version, lyDo: LY_DO })).toMatchObject({ ok: false, error: { code: "TRANG_THAI_KHONG_HOP_LE" } });
      expect(await doc(ready.id)).toMatchObject({ state: "READY_FOR_REVIEW", version: ready.version, claimedById: null });
      expect(await soLead(ready.id)).toBe(0);
      expect(await db.auditLog.count({ where: { entityId: { in: [ready.id, rej.id] } } })).toBe(0);
    });

    it("[NLE-15] THIẾU điều kiện (không SĐT) ⇒ từ chối TRƯỚC khi ghi: vẫn SYSTEM_EXCEPTION, không nhận hồ sơ, không audit, không lead", async () => {
      const d = await taoSe("t7", { phone: null });
      const kq = await svc.thuLaiTaoLead(ten(qlA), { draftId: d.id, version: d.version, lyDo: LY_DO });
      expect(kq).toMatchObject({ ok: false, error: { code: "THIEU_DIEU_KIEN" } });
      expect(await doc(d.id)).toMatchObject({ state: "SYSTEM_EXCEPTION", claimedById: null, version: d.version });
      expect(await soAudit(d.id, "RETRY_CREATE_LEAD")).toBe(0);
      expect(await soLead(d.id)).toBe(0);
    });

    it("[NLE-16] LÝ DO bắt buộc ≥10 ký tự SAU khi cắt khoảng trắng — máy chủ kiểm lại; chưa đủ ⇒ DB y nguyên", async () => {
      const d = await taoSe("t8");
      for (const lyDo of ["", "ngắn", "          ", "   chín kýtự   "]) {
        expect(await svc.thuLaiTaoLead(ten(qlA), { draftId: d.id, version: d.version, lyDo })).toMatchObject({ ok: false, error: { code: "DU_LIEU_KHONG_HOP_LE", field: "lyDo" } });
      }
      expect(await svc.thuLaiTaoLead(ten(qlA), { draftId: d.id, version: d.version, lyDo: "x".repeat(501) })).toMatchObject({ ok: false, error: { code: "DU_LIEU_KHONG_HOP_LE" } });
      expect(await doc(d.id)).toMatchObject({ state: "SYSTEM_EXCEPTION", version: d.version });
      expect(await soAudit(d.id, "RETRY_CREATE_LEAD")).toBe(0);
    });

    it("[NLE-17] người KHÁC đang giữ ⇒ DA_NGUOI_KHAC_NHAN; version cũ ⇒ XUNG_DOT_PHIEN_BAN; DB y nguyên", async () => {
      const d = await taoSe("t9", { claimedById: qlA2.userId });
      expect(await svc.thuLaiTaoLead(ten(qlA), { draftId: d.id, version: d.version, lyDo: LY_DO })).toMatchObject({ ok: false, error: { code: "DA_NGUOI_KHAC_NHAN" } });
      const e = await taoSe("t10");
      expect(await svc.thuLaiTaoLead(ten(qlA), { draftId: e.id, version: e.version + 3, lyDo: LY_DO })).toMatchObject({ ok: false, error: { code: "XUNG_DOT_PHIEN_BAN" } });
      expect(await doc(d.id)).toMatchObject({ state: "SYSTEM_EXCEPTION", version: d.version, claimedById: qlA2.userId });
      expect(await doc(e.id)).toMatchObject({ state: "SYSTEM_EXCEPTION", version: e.version, claimedById: null });
      expect(await db.auditLog.count({ where: { entityId: { in: [d.id, e.id] } } })).toBe(0);
    });

    it("[NLE-18] cơ sở không còn nhận khách ⇒ CO_SO_KHONG_HOP_LE, hồ sơ về hàng chờ thường (READY_FOR_REVIEW) và KHÔNG còn trong ngoại lệ; thông báo NÓI ĐÚNG điều đó", async () => {
      const d = await taoSe("t11");
      await db.aiLeadCampusPublication.updateMany({ where: { pageId: PAGE, campusCenterId: nen.centerA }, data: { acceptingLeads: false } });
      const kq = await svc.thuLaiTaoLead(ten(qlA), { draftId: d.id, version: d.version, lyDo: LY_DO });
      expect(kq).toMatchObject({ ok: false, error: { code: "CO_SO_KHONG_HOP_LE" } });
      expect(!kq.ok && kq.error.message).toContain("Hồ sơ chờ AI");
      expect(await doc(d.id)).toMatchObject({ state: "READY_FOR_REVIEW", leadId: null });
      expect(await soLead(d.id)).toBe(0);
      expect((await svc.danhSachNgoaiLe(qlA, {}, true, NOW)).hang.some((h) => h.id === d.id)).toBe(false);
    });

    it("[NLE-30] ingest ném lỗi hạ tầng ⇒ LOI_INGEST, hồ sơ QUAY LẠI SYSTEM_EXCEPTION (vẫn trong ngoại lệ) kèm mã mới, lỗi KHÔNG lộ SĐT; thử lại lần sau (hết lỗi) thành công", async () => {
      const d = await taoSe("t12");
      ing.nem = true;
      const k1 = await svc.thuLaiTaoLead(ten(qlA), { draftId: d.id, version: d.version, lyDo: LY_DO });
      expect(k1).toMatchObject({ ok: false, error: { code: "LOI_INGEST" } });
      expect(JSON.stringify(k1)).not.toContain("0905123456");
      const giua = await doc(d.id);
      expect(giua).toMatchObject({ state: "SYSTEM_EXCEPTION", resultNote: "INGEST_NEM_LOI", leadId: null, claimedById: qlA.userId });
      expect(await soLead(d.id)).toBe(0);
      expect((await svc.danhSachNgoaiLe(qlA, {}, true, NOW)).hang.some((h) => h.id === d.id && h.loai === "SYSTEM_EXCEPTION")).toBe(true);
      ing.nem = false;
      const k2 = await svc.thuLaiTaoLead(ten(qlA), { draftId: d.id, version: giua.version, lyDo: LY_DO });
      expect(k2.ok).toBe(true);
      expect(await soLead(d.id)).toBe(1);
      expect(await soAudit(d.id, "RETRY_CREATE_LEAD")).toBe(2);
    });
  });

  // ── 3. ĐÁNH DẤU ĐÃ XỬ LÝ ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("đánh dấu đã xử lý", () => {
    async function sale() {
      return db.user.create({ data: { name: `${P}Sale`, email: `${P.toLowerCase()}sale2@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: nen.centerA } });
    }

    it("[NLE-20] lead VẪN chưa có người phụ trách ⇒ từ chối (LEAD_CHUA_CO_NGUOI), hồ sơ y nguyên, không audit", async () => {
      const { draft } = await taoAp("c1");
      const kq = await svc.danhDauDaXuLy(ten(qlA), { draftId: draft.id, version: draft.version, lyDo: LY_DO });
      expect(kq).toMatchObject({ ok: false, error: { code: "LEAD_CHUA_CO_NGUOI" } });
      expect(await doc(draft.id)).toMatchObject({ state: "ASSIGNMENT_PENDING", version: draft.version, closedAt: null });
      expect(await soAudit(draft.id, "CLOSE_EXCEPTION")).toBe(0);
    });

    it("[NLE-21] lead đã có sale ⇒ đóng: COMPLETED + closedAt + audit kèm lý do; KHÔNG đổi người phụ trách lead; bấm lại ⇒ OK idempotent, không audit thứ hai", async () => {
      const { draft, leadId } = await taoAp("c2");
      const s = await sale();
      try {
        await db.lead.update({ where: { id: leadId }, data: { assignedToId: s.id } });
        const k = await svc.danhDauDaXuLy(ten(qlA2), { draftId: draft.id, version: draft.version, lyDo: LY_DO });
        expect(k).toMatchObject({ ok: true, data: { state: "COMPLETED", leadId } });
        const sau = await doc(draft.id);
        expect(sau.state).toBe("COMPLETED");
        expect(sau.closedAt).not.toBeNull();
        expect(sau.version).toBe(draft.version + 1);
        expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).assignedToId).toBe(s.id);
        const au = await db.auditLog.findMany({ where: { entityId: draft.id, action: "CLOSE_EXCEPTION" } });
        expect(au).toHaveLength(1);
        expect(au[0]).toMatchObject({ reason: LY_DO, actorId: qlA2.userId });
        expect(await svc.danhDauDaXuLy(ten(qlA), { draftId: draft.id, version: draft.version, lyDo: LY_DO })).toMatchObject({ ok: true, data: { state: "COMPLETED" } });
        expect(await soAudit(draft.id, "CLOSE_EXCEPTION")).toBe(1);
      } finally {
        await db.lead.update({ where: { id: leadId }, data: { assignedToId: null } });
        await db.user.delete({ where: { id: s.id } });
      }
    });

    it("[NLE-22] ĐUA: hai người cùng đánh dấu ⇒ đúng MỘT lần ghi; version cũ ⇒ XUNG_DOT; hồ sơ SYSTEM_EXCEPTION ⇒ TRANG_THAI_KHONG_HOP_LE", async () => {
      const { draft, leadId } = await taoAp("c3");
      const s = await sale();
      try {
        await db.lead.update({ where: { id: leadId }, data: { assignedToId: s.id } });
        expect(await svc.danhDauDaXuLy(ten(qlA), { draftId: draft.id, version: draft.version + 4, lyDo: LY_DO })).toMatchObject({ ok: false, error: { code: "XUNG_DOT_PHIEN_BAN" } });
        const kq = await Promise.all([
          svc.danhDauDaXuLy(ten(qlA), { draftId: draft.id, version: draft.version, lyDo: LY_DO }),
          svc.danhDauDaXuLy(ten(qlA2), { draftId: draft.id, version: draft.version, lyDo: LY_DO }),
        ]);
        // Người thua: hoặc đọc lại thấy COMPLETED ⇒ OK idempotent, hoặc đọc TRƯỚC khi người thắng ghi ⇒ CAS đổi 0 dòng ⇒ XUNG_DOT. Cả hai đều không ghi lần hai.
        expect(kq.filter((k) => k.ok).length).toBeGreaterThanOrEqual(1);
        for (const k of kq) if (!k.ok) expect(k.error.code).toBe("XUNG_DOT_PHIEN_BAN");
        expect(await soAudit(draft.id, "CLOSE_EXCEPTION")).toBe(1);
        const se = await taoSe("c4");
        expect(await svc.danhDauDaXuLy(ten(qlA), { draftId: se.id, version: se.version, lyDo: LY_DO })).toMatchObject({ ok: false, error: { code: "TRANG_THAI_KHONG_HOP_LE" } });
        expect(await doc(se.id)).toMatchObject({ state: "SYSTEM_EXCEPTION", version: se.version });
      } finally {
        await db.lead.update({ where: { id: leadId }, data: { assignedToId: null } });
        await db.user.delete({ where: { id: s.id } });
      }
    });

    it("[NLE-23] lý do ngắn ⇒ DU_LIEU_KHONG_HOP_LE, hồ sơ y nguyên", async () => {
      const { draft, leadId } = await taoAp("c5");
      const s = await sale();
      try {
        await db.lead.update({ where: { id: leadId }, data: { assignedToId: s.id } });
        expect(await svc.danhDauDaXuLy(ten(qlA), { draftId: draft.id, version: draft.version, lyDo: "xong rồi" })).toMatchObject({ ok: false, error: { code: "DU_LIEU_KHONG_HOP_LE" } });
        expect(await doc(draft.id)).toMatchObject({ state: "ASSIGNMENT_PENDING", version: draft.version });
      } finally {
        await db.lead.update({ where: { id: leadId }, data: { assignedToId: null } });
        await db.user.delete({ where: { id: s.id } });
      }
    });
  });

  // ── 4. GIAO NGƯỜI ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("giao người", () => {
    it("[NLE-40] hồ sơ lỗi ⇒ giao cho quản lý hợp lệ (chính `chuyenNguoi`); hồ sơ ASSIGNMENT_PENDING ⇒ từ chối; người ngoài cơ sở ⇒ từ chối", async () => {
      const nhan = await db.user.create({ data: { name: `${P}Người nhận`, email: `${P.toLowerCase()}nhan@example.test`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: nen.centerA } });
      bang.actors.set(nhan.id, actorQlcs(nhan.id, [nen.centerA]));
      try {
        const se = await taoSe("g1");
        expect(await svc.giaoNguoi(ten(qlA), { draftId: se.id, version: se.version, nguoiNhanId: qlB.userId })).toMatchObject({ ok: false, error: { code: "NGUOI_NHAN_KHONG_HOP_LE" } });
        const k = await svc.giaoNguoi(ten(qlA), { draftId: se.id, version: se.version, nguoiNhanId: nhan.id });
        expect(k).toMatchObject({ ok: true, data: { state: "IN_PROGRESS" } });
        expect((await doc(se.id)).claimedById).toBe(nhan.id);
        const { draft } = await taoAp("g2");
        expect(await svc.giaoNguoi(ten(qlA), { draftId: draft.id, version: draft.version, nguoiNhanId: nhan.id })).toMatchObject({ ok: false, error: { code: "TRANG_THAI_KHONG_HOP_LE" } });
        expect(await doc(draft.id)).toMatchObject({ state: "ASSIGNMENT_PENDING", version: draft.version });
      } finally {
        await db.staffNotification.deleteMany({ where: { userId: nhan.id } });
        await db.user.delete({ where: { id: nhan.id } });
      }
    });
  });

  // ── 5. GHI KHÔNG VƯỢT PHẠM VI / QUYỀN ──────────────────────────────────────────────────────────────────────────────────────────────────
  describe("phạm vi & quyền khi GHI", () => {
    it("[NLE-50] QLCS cơ sở B gọi thẳng cho hồ sơ cơ sở A ⇒ KHONG_TIM_THAY ở MỌI hành động ghi; DB y nguyên, không lead, không audit", async () => {
      const se = await taoSe("s1");
      const { draft: ap } = await taoAp("s2");
      const kq = await Promise.all([
        svc.thuLaiTaoLead(ten(qlB), { draftId: se.id, version: se.version, lyDo: LY_DO }),
        svc.danhDauDaXuLy(ten(qlB), { draftId: ap.id, version: ap.version, lyDo: LY_DO }),
        svc.giaoNguoi(ten(qlB), { draftId: se.id, version: se.version, nguoiNhanId: qlA.userId }),
      ]);
      for (const k of kq) expect(k).toMatchObject({ ok: false, error: { code: "KHONG_TIM_THAY" } });
      expect(await doc(se.id)).toMatchObject({ state: "SYSTEM_EXCEPTION", claimedById: null, version: se.version });
      expect(await doc(ap.id)).toMatchObject({ state: "ASSIGNMENT_PENDING", version: ap.version });
      expect(await soLead(se.id)).toBe(0);
      expect(await db.auditLog.count({ where: { entityId: se.id } })).toBe(0);
    });

    it("[NLE-51] hồ sơ chưa biết cơ sở (centerId NULL): QLCS ⇒ KHONG_TIM_THAY; Hội sở ⇒ thao tác được (đối chứng dương)", async () => {
      const n = await taoSe("s3", { centerId: null });
      expect(await svc.thuLaiTaoLead(ten(qlA), { draftId: n.id, version: n.version, lyDo: LY_DO })).toMatchObject({ ok: false, error: { code: "KHONG_TIM_THAY" } });
      expect(await doc(n.id)).toMatchObject({ state: "SYSTEM_EXCEPTION", version: n.version });
      expect((await svc.thuLaiTaoLead(ten(ho), { draftId: n.id, version: n.version, lyDo: LY_DO })).ok).toBe(true);
    });

    it("[NLE-52] chỉ có quyền XEM ⇒ KHONG_CO_QUYEN ở mọi hành động ghi; DB y nguyên", async () => {
      const xem = actorChiXem(`${P}xem`, [nen.centerA]);
      bang.actors.set(xem.userId, xem);
      const se = await taoSe("s4");
      const { draft: ap } = await taoAp("s5");
      const kq = await Promise.all([
        svc.thuLaiTaoLead(ten(xem), { draftId: se.id, version: se.version, lyDo: LY_DO }),
        svc.danhDauDaXuLy(ten(xem), { draftId: ap.id, version: ap.version, lyDo: LY_DO }),
        svc.giaoNguoi(ten(xem), { draftId: se.id, version: se.version, nguoiNhanId: qlA.userId }),
      ]);
      for (const k of kq) expect(k).toMatchObject({ ok: false, error: { code: "KHONG_CO_QUYEN" } });
      expect(await doc(se.id)).toMatchObject({ state: "SYSTEM_EXCEPTION", version: se.version });
      expect(await soLead(se.id)).toBe(0);
    });
  });
  // ── 7. FIX-04: TỰ ĐÓNG ASSIGNMENT_PENDING khi lead đã có sale (cron ai-lead-don-dep) ────────────────────────────────────────────────
  describe("[NLE-AUTO] cron tự đóng ngoại lệ chờ phân công", () => {
    const chay = async () => (await import("../../lib/ai-lead/dich-vu/don-dep")).chayDonDep({ dongHo: () => NOW });
    const nguoi: string[] = [];
    const taoSale = async (h: string, o: { isActive?: boolean } = {}) => {
      const u = await db.user.create({ data: { name: `${P}Sale ${h}`, email: `${P.toLowerCase()}sale${h}@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: nen.centerA, isActive: o.isActive ?? true } });
      nguoi.push(u.id);
      return u;
    };
    afterEach(async () => {
      await db.staffNotification.deleteMany({ where: { dedupeKey: { startsWith: `ai_lead.sla:${P}` } } });
      await db.lead.updateMany({ where: { assignedToId: { in: nguoi } }, data: { assignedToId: null } });
      await db.user.deleteMany({ where: { id: { in: nguoi.splice(0) } } });
    });

    it("[NLE-AUTO-01] lead ĐÃ có sale hợp lệ ⇒ COMPLETED + closedAt + version+1 + audit hệ thống; lead KHÔNG đổi (không đổi chủ), hồ sơ không bị xoá", async () => {
      const sale = await taoSale("a");
      const { draft, leadId } = await taoAp("auto1");
      await db.lead.update({ where: { id: leadId }, data: { assignedToId: sale.id } });
      const truoc = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
      const kq = await chay();
      expect(kq).toMatchObject({ ok: true, assignmentDong: 1, loi: [] });
      const sau = await doc(draft.id);
      expect(sau).toMatchObject({ state: "COMPLETED", leadId, version: draft.version + 1 });
      expect(sau.closedAt).toEqual(NOW);
      const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead.assignedToId).toBe(sale.id);
      expect(lead.updatedAt).toEqual(truoc.updatedAt); // không chạm lead
      const log = await db.auditLog.findMany({ where: { entityId: draft.id, action: "CLOSE_EXCEPTION_AUTO" } });
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ actorId: null, module: "ai-lead", oldValues: { state: "ASSIGNMENT_PENDING" }, newValues: { state: "COMPLETED", leadId, assignedToId: sale.id } });
      expect(await db.auditLog.count({ where: { entityId: draft.id, action: "CLOSE_EXCEPTION" } })).toBe(0); // không giả làm thao tác tay
    });

    it("[NLE-AUTO-02] chưa xác minh được thì Ở NGUYÊN hàng chờ: lead chưa chủ · chủ đã nghỉ · lead đã xoá mềm · hồ sơ không gắn lead ⇒ không đóng, không audit", async () => {
      const nghi = await taoSale("nghi", { isActive: false });
      const a = (await taoAp("auto2a", PHONE_NOI_DIA[1])).draft; // chưa chủ
      const b = await taoAp("auto2b", PHONE_NOI_DIA[2]);
      await db.lead.update({ where: { id: b.leadId }, data: { assignedToId: nghi.id } }); // chủ đã nghỉ
      const saleOk = await taoSale("ok");
      const c = await taoAp("auto2c", PHONE_NOI_DIA[3]);
      await db.lead.update({ where: { id: c.leadId }, data: { assignedToId: saleOk.id, deletedAt: NOW } }); // lead đã xoá
      const d = await taoHoSo(nen, { id: `${P}auto2d`, state: "ASSIGNMENT_PENDING", convId: await hoiThoai() }); // không có leadId
      const kq = await chay();
      expect(kq).toMatchObject({ ok: true, assignmentDong: 0, loi: [] });
      for (const id of [a.id, b.draft.id, c.draft.id, d.id]) {
        expect((await doc(id)).state, id).toBe("ASSIGNMENT_PENDING");
        expect(await soAudit(id, "CLOSE_EXCEPTION_AUTO"), id).toBe(0);
      }
    });

    it("[NLE-AUTO-03] chỉ đóng đúng hồ sơ đủ điều kiện trong một lô trộn; trạng thái khác (SYSTEM_EXCEPTION…) không bị đụng; chạy lại ⇒ 0 (idempotent)", async () => {
      const sale = await taoSale("lo");
      const dung = await taoAp("auto3a", PHONE_NOI_DIA[1]);
      await db.lead.update({ where: { id: dung.leadId }, data: { assignedToId: sale.id } });
      const chua = (await taoAp("auto3b", PHONE_NOI_DIA[2])).draft;
      const se = await taoSe("auto3c");
      await db.aiLeadDraft.update({ where: { id: se.id }, data: { leadId: dung.leadId } }); // dù trỏ tới lead đã có chủ, SYSTEM_EXCEPTION không phải việc của giai đoạn này
      expect(await chay()).toMatchObject({ assignmentDong: 1 });
      expect((await doc(dung.draft.id)).state).toBe("COMPLETED");
      expect((await doc(chua.id)).state).toBe("ASSIGNMENT_PENDING");
      expect((await doc(se.id)).state).toBe("SYSTEM_EXCEPTION");
      expect(await chay()).toMatchObject({ assignmentDong: 0 });
      expect(await soAudit(dung.draft.id, "CLOSE_EXCEPTION_AUTO")).toBe(1);
    });

    it("[NLE-AUTO-04] tranh chấp: hai cron chạy CÙNG LÚC và đóng tay chạy xen ⇒ đúng MỘT lần đóng, đúng một dòng audit đóng (tự động HOẶC tay), không lỗi", async () => {
      const sale = await taoSale("race");
      const { draft, leadId } = await taoAp("auto4");
      await db.lead.update({ where: { id: leadId }, data: { assignedToId: sale.id } });
      const kq = await Promise.all([chay(), chay(), svc.danhDauDaXuLy(ten(qlA), { draftId: draft.id, version: draft.version, lyDo: LY_DO })]);
      expect((kq[0] as { ok: boolean }).ok && (kq[1] as { ok: boolean }).ok).toBe(true);
      const sau = await doc(draft.id);
      expect(sau.state).toBe("COMPLETED");
      expect(sau.version).toBe(draft.version + 1); // chỉ MỘT lần tăng version
      const tong = (await soAudit(draft.id, "CLOSE_EXCEPTION_AUTO")) + (await soAudit(draft.id, "CLOSE_EXCEPTION"));
      expect(tong).toBe(1);
    });

    it("[NLE-AUTO-05] hồ sơ tự đóng biến khỏi danh sách ngoại lệ nhưng LỊCH SỬ còn nguyên; hồ sơ chưa đủ điều kiện vẫn hiện", async () => {
      const sale = await taoSale("ds");
      const dong = await taoAp("auto5a", PHONE_NOI_DIA[1]);
      await db.lead.update({ where: { id: dong.leadId }, data: { assignedToId: sale.id } });
      const giu = (await taoAp("auto5b", PHONE_NOI_DIA[2])).draft;
      const truoc = (await svc.danhSachNgoaiLe(qlA, {}, true, NOW)).hang.map((h) => h.id);
      expect(truoc).toEqual(expect.arrayContaining([dong.draft.id, giu.id]));
      await chay();
      const sau = (await svc.danhSachNgoaiLe(qlA, {}, true, NOW)).hang.map((h) => h.id);
      expect(sau).not.toContain(dong.draft.id);
      expect(sau).toContain(giu.id);
      expect(await db.aiLeadDraft.count({ where: { id: dong.draft.id } })).toBe(1);
    });

    it("[NLE-AUTO-06] ĐÓI: ≥ 200 hồ sơ chờ phân công mà lead VẪN vô chủ (cũ hơn, ở lại hàng chờ mãi) KHÔNG được che mất hồ sơ MỚI hơn có lead đã có sale — cron phải đi qua trang đầu", async () => {
      const sale = await taoSale("doi");
      const SO_KET = 201; // > một trang (TRAN_MOI_LUOT = 200)
      const ketIds: string[] = [];
      for (let i = 0; i < SO_KET; i++) {
        const d = await taoHoSo(nen, { id: `${P}ket${String(i).padStart(3, "0")}`, state: "ASSIGNMENT_PENDING", convId: await hoiThoai(), phone: PHONE_NOI_DIA[1] });
        ketIds.push(d.id);
      }
      // Lead giả: các hồ sơ kẹt trỏ tới lead KHÔNG tồn tại ⇒ giai đoạn không đóng được (đúng hình dạng «lead vô chủ ở lại hàng chờ»).
      await db.aiLeadDraft.updateMany({ where: { id: { in: ketIds } }, data: { leadId: "lead_khong_ton_tai" } });
      const dung = await taoAp("auto6dung", PHONE_NOI_DIA[2]);
      await db.lead.update({ where: { id: dung.leadId }, data: { assignedToId: sale.id } });
      // Hồ sơ kẹt CŨ hơn hồ sơ đủ điều kiện: nếu giai đoạn chỉ lấy MỘT trang 200 theo `updatedAt` tăng dần thì hồ sơ đủ điều kiện nằm ngoài trang và không bao giờ được xét.
      await db.$executeRawUnsafe(`UPDATE "AiLeadDraft" SET "updatedAt" = $1 WHERE id LIKE $2`, new Date(NOW.getTime() - 3 * 24 * 3_600_000), `${P}ket%`);
      await db.$executeRawUnsafe(`UPDATE "AiLeadDraft" SET "updatedAt" = $1 WHERE id = $2`, new Date(NOW.getTime() - 3_600_000), dung.draft.id);
      const kq = await chay();
      expect(kq).toMatchObject({ ok: true, assignmentDong: 1, loi: [], catNgan: 0 });
      expect((await doc(dung.draft.id)).state).toBe("COMPLETED");
      expect(await db.aiLeadDraft.count({ where: { id: { in: ketIds }, state: "ASSIGNMENT_PENDING" } })).toBe(SO_KET); // hồ sơ kẹt KHÔNG bị đụng
    }, 60_000);
  });
});
