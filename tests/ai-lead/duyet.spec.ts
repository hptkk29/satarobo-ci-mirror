// @vitest-environment node
/**
 * AI LEAD — DỊCH VỤ XỬ LÝ HỒ SƠ CHỜ (`duyet.ts`) trên POSTGRES THẬT.
 *
 * Bốn thứ mà test thuần KHÔNG chứng minh được và bug ở đó không văng lỗi, chỉ lộ khi có khiếu nại:
 *   1. CÁCH LY CƠ SỞ khi GHI (scopedDb không che write — QLCS CS-B gọi thẳng action cho hồ sơ CS-A).
 *   2. ĐUA: hai QLCS cùng nhận/duyệt ⇒ một người thắng, một lead.
 *   3. PII: SĐT/tên che ở server, ô tìm không thành kênh dò, audit không giữ SĐT thật.
 *   4. KHOÁ LẠC QUAN: ghi bằng version cũ ⇒ bị từ chối, không ghi đè.
 *
 * ⚠️ Tự SKIP khi không có Postgres test. Thấy SKIP nghĩa là CHƯA KIỂM ĐƯỢC GÌ.
 * `resolveActor` (đọc UserOrgRole) và `getSetting` được thay bằng bảng tra trong bộ nhớ — RBAC/cài đặt có test riêng; ở đây cần điều khiển ĐÚNG hình dạng actor.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../../lib/auth/actor";
import { RUN_DB_TESTS, assertTenDbTest } from "../_helpers/db-gate";
import { actorChiXem, actorHoiSo, actorQlcs } from "../../lib/ai-lead/dich-vu/ho-tro-test-duyet";
import { MA_NGUON, P, PAGE, PHONE_NOI_DIA, db, donDep, dungNen, taoHoSo, taoHoiThoai, type Nen } from "./_nen-c";

const bang = vi.hoisted(() => ({ actors: new Map<string, unknown>(), caiDat: new Map<string, unknown>() }));

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
vi.mock("@/lib/settings/service", async (goc) => ({
  ...(await goc<typeof import("../../lib/settings/service")>()),
  getSetting: vi.fn(async (k: string) => (bang.caiDat.has(k) ? bang.caiDat.get(k) : true)),
}));

const CO_BANG = RUN_DB_TESTS && (await db.aiLeadDraft.count().then(() => true).catch(() => false));
if (!CO_BANG) console.warn("[ai-lead duyet] SKIP: không có Postgres test hoặc chưa có bảng AiLead*.");

const NOW = new Date("2026-11-07T10:00:00.000Z");
const PHONE_THAT = `84${PHONE_NOI_DIA[0].slice(1)}`;

describe.skipIf(!CO_BANG)("[DYT] duyet.ts — DB thật", () => {
  let nen: Nen;
  let svc: typeof import("../../lib/ai-lead/dich-vu/duyet");
  let qlA: Actor;
  let qlA2: Actor;
  let qlB: Actor;
  let ho: Actor;
  const ten = (a: Actor) => ({ actor: a, ten: `Tên ${a.userId}` });

  beforeAll(async () => {
    assertTenDbTest();
    svc = await import("../../lib/ai-lead/dich-vu/duyet");
  });
  beforeEach(async () => {
    nen = await dungNen();
    qlA = actorQlcs(`${P}qlA`, [nen.centerA]);
    qlA2 = actorQlcs(`${P}qlA2`, [nen.centerA]);
    qlB = actorQlcs(`${P}qlB`, [nen.centerB]);
    ho = actorHoiSo(`${P}ho`);
    bang.actors.clear();
    bang.caiDat.clear();
    bang.caiDat.set("nguon.bangNguonTheoPage", { [PAGE]: { groupCode: MA_NGUON } }); // `getSetting` được thay bằng bảng tra («mọi khoá = true») — bảng nguồn theo Page phải là đối tượng thật
    for (const a of [qlA, qlA2, qlB, ho]) bang.actors.set(a.userId, a);
  }, 60_000);
  afterAll(async () => {
    await donDep();
    await db.$disconnect();
  });

  const doc = (id: string) => db.aiLeadDraft.findUniqueOrThrow({ where: { id } });

  // ── 1. DANH SÁCH: cách ly + PII ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("danh sách", () => {
    it("[DYT-01] QLCS chỉ thấy hồ sơ cơ sở mình; hồ sơ chưa biết cơ sở chỉ Hội sở thấy", async () => {
      await taoHoSo(nen, { id: `${P}a1` });
      await taoHoSo(nen, { id: `${P}b1`, centerId: nen.centerB, campusCenterId: nen.centerB, campusCode: "ATB", convId: await taoHoiThoai(nen, "b1") });
      await taoHoSo(nen, { id: `${P}n1`, centerId: null, campusCenterId: null, campusCode: null, convId: await taoHoiThoai(nen, "n1") });
      const ids = async (a: Actor) => (await svc.danhSach(a, {}, true, NOW)).hang.filter((h) => h.id.startsWith(P)).map((h) => h.id).sort();
      expect(await ids(qlA)).toEqual([`${P}a1`]);
      expect(await ids(qlB)).toEqual([`${P}b1`]);
      expect(await ids(ho)).toEqual([`${P}a1`, `${P}b1`, `${P}n1`]);
    });

    it("[DYT-02] thiếu quyền xem PII: SĐT + tên che ở SERVER, không chuỗi thật nào trong kết quả", async () => {
      await taoHoSo(nen, { id: `${P}p1` });
      const kq = await svc.danhSach(qlA, {}, false, NOW);
      const h = kq.hang.find((x) => x.id === `${P}p1`)!;
      expect(h.phone).not.toBe(PHONE_THAT);
      expect(h.phone).toMatch(/x/);
      expect(h.fbName).not.toBe("Nguyễn Thị Lan");
      const json = JSON.stringify(kq);
      expect(json).not.toContain(PHONE_THAT);
      expect(json).not.toContain(PHONE_NOI_DIA[0]);
      expect(json).not.toContain("Nguyễn Thị Lan");
      // đối chứng DƯƠNG: có quyền thì thấy thật
      const co = (await svc.danhSach(qlA, {}, true, NOW)).hang.find((x) => x.id === `${P}p1`)!;
      expect(co.phone).toBe(PHONE_THAT);
      expect(co.fbName).toBe("Nguyễn Thị Lan");
    });

    it("[DYT-03] ô tìm: không có quyền PII thì tìm theo SĐT/tên KHÔNG ra gì (không dò được); tìm theo mã hồ sơ vẫn được; có quyền thì tìm đủ số mới ra", async () => {
      await taoHoSo(nen, { id: `${P}s1abcdef` });
      const tim = async (q: string, pii: boolean) => (await svc.danhSach(qlA, { q }, pii, NOW)).hang.length;
      expect(await tim(PHONE_NOI_DIA[0], false)).toBe(0);
      expect(await tim(PHONE_THAT, false)).toBe(0);
      expect(await tim("Nguyễn", false)).toBe(0);
      expect(await tim("s1abcdef", false)).toBe(1);
      expect(await tim(PHONE_NOI_DIA[0], true)).toBe(1);
      expect(await tim("Nguyễn", true)).toBe(1);
      expect(await tim("090010", true)).toBe(0); // SĐT chỉ khớp ĐỦ SỐ, không khớp một phần
    });

    it("[DYT-04] bộ lọc: «mở» bỏ hồ sơ kết thúc; «của tôi» · «chưa nhận» · quá hạn SLA theo `now` truyền vào", async () => {
      const qua = new Date(NOW.getTime() - 3_600_000);
      const sau = new Date(NOW.getTime() + 3_600_000);
      await taoHoSo(nen, { id: `${P}f-mo`, state: "WAITING_QLCS", slaClaimDueAt: qua, slaResolveDueAt: sau });
      await taoHoSo(nen, { id: `${P}f-xong`, state: "REJECTED", convId: await taoHoiThoai(nen, "f2") });
      await taoHoSo(nen, { id: `${P}f-toi`, state: "IN_PROGRESS", claimedById: qlA.userId, slaResolveDueAt: sau, convId: await taoHoiThoai(nen, "f3") });
      await taoHoSo(nen, { id: `${P}f-quahan`, state: "IN_PROGRESS", claimedById: qlA2.userId, slaResolveDueAt: qua, convId: await taoHoiThoai(nen, "f4") });
      const ids = async (loc: Parameters<typeof svc.danhSach>[1]) => (await svc.danhSach(qlA, loc, true, NOW)).hang.map((h) => h.id).sort();
      expect(await ids({})).toEqual([`${P}f-mo`, `${P}f-quahan`, `${P}f-toi`]);
      expect(await ids({ trangThai: "tat-ca" })).toHaveLength(4);
      expect(await ids({ trangThai: "REJECTED" })).toEqual([`${P}f-xong`]);
      expect(await ids({ nguoiXuLy: "toi" })).toEqual([`${P}f-toi`]);
      expect(await ids({ nguoiXuLy: "chua-nhan" })).toEqual([`${P}f-mo`]);
      // quá hạn: f-mo (chưa nhận, quá hạn nhận) + f-quahan (quá hạn xử lý); f-toi còn hạn
      expect(await ids({ quaHanSla: true })).toEqual([`${P}f-mo`, `${P}f-quahan`]);
    });
  });

  // ── 2. CHI TIẾT ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("chi tiết", () => {
    it("[DYT-05] hồ sơ cơ sở khác ⇒ null (cùng kết quả với «không có»); trong phạm vi ⇒ che PII + PSID rút gọn + dòng thời gian", async () => {
      const hs = await taoHoSo(nen, { id: `${P}c1` });
      expect(await svc.chiTiet(qlB, hs.id, true, NOW)).toBeNull();
      expect(await svc.chiTiet(qlA, `${P}khong-co`, true, NOW)).toBeNull();
      const ct = await svc.chiTiet(qlA, hs.id, false, NOW);
      expect(ct).not.toBeNull();
      const json = JSON.stringify(ct);
      expect(json).not.toContain(PHONE_THAT);
      expect(json).not.toContain("Nguyễn Thị Lan");
      expect(json).not.toContain("psid-bi-mat"); // PSID đầy đủ không bao giờ ra khỏi dịch vụ
      expect(ct!.psidRutGon.startsWith("…")).toBe(true);
      expect(ct!.coSoCoThe.map((c) => c.id)).toEqual([nen.centerA]); // chỉ cơ sở TRONG phạm vi
      expect(ct!.nguonTen).toBe("AGENT_XAC_MINH");
    });
  });

  // ── 3. NHẬN XỬ LÝ ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("nhận xử lý", () => {
    it("[DYT-06] nhận được; bấm đúp không lỗi/không tăng version; người khác ⇒ DA_NGUOI_KHAC_NHAN", async () => {
      const hs = await taoHoSo(nen, { id: `${P}n-1` });
      const k1 = await svc.nhanXuLy(ten(qlA), { draftId: hs.id, version: hs.version });
      expect(k1).toMatchObject({ ok: true, data: { state: "IN_PROGRESS", version: hs.version + 1 } });
      const k2 = await svc.nhanXuLy(ten(qlA), { draftId: hs.id, version: hs.version });
      expect(k2).toMatchObject({ ok: true, data: { version: hs.version + 1 } });
      const k3 = await svc.nhanXuLy(ten(qlA2), { draftId: hs.id, version: hs.version + 1 });
      expect(k3).toMatchObject({ ok: false, error: { code: "DA_NGUOI_KHAC_NHAN" } });
      expect(await doc(hs.id)).toMatchObject({ claimedById: qlA.userId, state: "IN_PROGRESS", version: hs.version + 1 });
      expect(await db.auditLog.count({ where: { entityId: hs.id, action: "CLAIM" } })).toBe(1);
    });

    it("[DYT-07] ĐUA: hai QLCS cùng nhận với cùng version ⇒ ĐÚNG MỘT người thắng, hồ sơ chỉ có một chủ", async () => {
      const hs = await taoHoSo(nen, { id: `${P}n-2` });
      const kq = await Promise.all([
        svc.nhanXuLy(ten(qlA), { draftId: hs.id, version: hs.version }),
        svc.nhanXuLy(ten(qlA2), { draftId: hs.id, version: hs.version }),
      ]);
      expect(kq.filter((k) => k.ok)).toHaveLength(1);
      const thua = kq.find((k) => !k.ok)!;
      expect(thua.ok === false && ["XUNG_DOT_PHIEN_BAN", "DA_NGUOI_KHAC_NHAN"].includes(thua.error.code)).toBe(true);
      const sau = await doc(hs.id);
      expect([qlA.userId, qlA2.userId]).toContain(sau.claimedById);
      expect(sau.version).toBe(hs.version + 1);
    });

    it("[DYT-08] version cũ ⇒ XUNG_DOT_PHIEN_BAN, DB không đổi", async () => {
      const hs = await taoHoSo(nen, { id: `${P}n-3` });
      const k = await svc.nhanXuLy(ten(qlA), { draftId: hs.id, version: hs.version + 5 });
      expect(k).toMatchObject({ ok: false, error: { code: "XUNG_DOT_PHIEN_BAN" } });
      expect(await doc(hs.id)).toMatchObject({ claimedById: null, version: hs.version });
    });

    it("[DYT-09] GHI KHÔNG VƯỢT PHẠM VI: QLCS cơ sở B gọi thẳng cho hồ sơ cơ sở A ⇒ KHONG_TIM_THAY ở MỌI hành động ghi, DB y nguyên", async () => {
      const hs = await taoHoSo(nen, { id: `${P}n-4` });
      const v = hs.version;
      const kq = await Promise.all([
        svc.nhanXuLy(ten(qlB), { draftId: hs.id, version: v }),
        svc.botSung(ten(qlB), { draftId: hs.id, version: v, fbName: "Kẻ lạ sửa tên" }),
        svc.duyet(ten(qlB), { draftId: hs.id, version: v }),
        svc.tuChoi(ten(qlB), { draftId: hs.id, version: v, lyDo: "không phải việc của tôi" }),
        svc.chuyenNguoi(ten(qlB), { draftId: hs.id, version: v, nguoiNhanId: qlA.userId }),
        svc.traHoSo(ten(qlB), { draftId: hs.id, version: v }),
        svc.baoDaNhanTrongPageInbox(ten(qlB), { draftId: hs.id, version: v }),
      ]);
      for (const k of kq) expect(k).toMatchObject({ ok: false, error: { code: "KHONG_TIM_THAY" } });
      expect(await doc(hs.id)).toMatchObject({ state: "READY_FOR_REVIEW", claimedById: null, fbName: "Nguyễn Thị Lan", version: v });
      expect(await db.lead.count({ where: { eventId: `ailead:${hs.id}` } })).toBe(0);
      expect(await db.auditLog.count({ where: { entityId: hs.id } })).toBe(0);
    });

    it("[DYT-10] chỉ có quyền XEM (không review) ⇒ KHONG_CO_QUYEN", async () => {
      const xem = actorChiXem(`${P}xem`, [nen.centerA]);
      bang.actors.set(xem.userId, xem);
      const hs = await taoHoSo(nen, { id: `${P}n-5` });
      expect(await svc.nhanXuLy(ten(xem), { draftId: hs.id, version: hs.version })).toMatchObject({ ok: false, error: { code: "KHONG_CO_QUYEN" } });
      expect(await svc.duyet(ten(xem), { draftId: hs.id, version: hs.version })).toMatchObject({ ok: false, error: { code: "KHONG_CO_QUYEN" } });
    });

    it("[DYT-10b] hồ sơ chưa kết thúc nhưng Agent còn đang thu thập (COLLECTING) ⇒ không nhận/sửa/duyệt được; đã kết thúc ⇒ không nhận", async () => {
      const a = await taoHoSo(nen, { id: `${P}n-6a`, state: "COLLECTING" });
      const b = await taoHoSo(nen, { id: `${P}n-6b`, state: "EXPIRED", convId: await taoHoiThoai(nen, "n6b") });
      for (const h of [a, b]) {
        expect(await svc.nhanXuLy(ten(qlA), { draftId: h.id, version: h.version })).toMatchObject({ ok: false, error: { code: "TRANG_THAI_KHONG_HOP_LE" } });
        expect(await svc.botSung(ten(qlA), { draftId: h.id, version: h.version, fbName: "X" })).toMatchObject({ ok: false, error: { code: "TRANG_THAI_KHONG_HOP_LE" } });
        expect(await svc.duyet(ten(qlA), { draftId: h.id, version: h.version })).toMatchObject({ ok: false, error: { code: "TRANG_THAI_KHONG_HOP_LE" } });
      }
    });
  });

  // ── 4. BỔ SUNG ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("bổ sung", () => {
    it("[DYT-11] sửa tên + SĐT: dấu nhân viên ở evidence.staff, mid của Agent còn nguyên, version tăng, tự nhận hồ sơ", async () => {
      const hs = await taoHoSo(nen, { id: `${P}b-1`, fbNameSource: "CUSTOMER_STATED" });
      const k = await svc.botSung(ten(qlA), { draftId: hs.id, version: hs.version, fbName: "Trần Văn Nam", phone: "0912 345 678" });
      expect(k).toMatchObject({ ok: true, data: { version: hs.version + 1, state: "IN_PROGRESS", thieu: [] } });
      const sau = await doc(hs.id);
      expect(sau).toMatchObject({ fbName: "Trần Văn Nam", phoneCanonical: "84912345678", claimedById: qlA.userId, fbNameSource: "CUSTOMER_STATED" });
      const ev = sau.evidence as { phoneMessageMid?: string; staff?: { fbName?: { v: string; by: string }; phone?: { v: string } } };
      expect(ev.phoneMessageMid).toBe("mid.sdt"); // khoá của Agent KHÔNG bị ghi đè
      expect(ev.staff?.fbName).toMatchObject({ v: "Trần Văn Nam", by: qlA.userId });
      expect(ev.staff?.phone?.v).toBe("84912345678");
    });

    it("[DYT-12] audit trước/sau ĐÃ CHE: không có SĐT thật, không có họ tên đầy đủ trong AuditLog", async () => {
      const hs = await taoHoSo(nen, { id: `${P}b-2` });
      await svc.botSung(ten(qlA), { draftId: hs.id, version: hs.version, fbName: "Trần Văn Nam", phone: "0912345678" });
      const logs = await db.auditLog.findMany({ where: { entityId: hs.id, action: "STAFF_UPDATE" } });
      expect(logs).toHaveLength(1);
      const json = JSON.stringify(logs);
      for (const thang of ["84912345678", "0912345678", PHONE_THAT, PHONE_NOI_DIA[0], "Trần Văn Nam", "Nguyễn Thị Lan"]) expect(json, thang).not.toContain(thang);
      expect(json).toContain("STAFF_VERIFIED");
    });

    it("[DYT-13] xác nhận GIỮ NGUYÊN tên («tôi đã đối chiếu») cũng ghi dấu xác minh ⇒ duyệt được hồ sơ mà tên do khách tự gõ", async () => {
      const hs = await taoHoSo(nen, { id: `${P}b-3`, fbNameSource: "CUSTOMER_STATED" });
      expect(await svc.duyet(ten(qlA), { draftId: hs.id, version: hs.version })).toMatchObject({ ok: false, error: { code: "THIEU_DIEU_KIEN" } });
      const b = await svc.botSung(ten(qlA), { draftId: hs.id, version: hs.version, fbName: "Nguyễn Thị Lan" });
      expect(b.ok).toBe(true);
      const v = b.ok ? b.data.version : 0;
      const d = await svc.duyet(ten(qlA), { draftId: hs.id, version: v });
      expect(d.ok).toBe(true);
      expect(await db.lead.count({ where: { eventId: `ailead:${hs.id}` } })).toBe(1);
    });

    it.each([
      ["SĐT sai", { phone: "123" }, "phone"],
      ["tên rỗng", { fbName: "   " }, "fbName"],
    ])("[DYT-14] %s ⇒ DU_LIEU_KHONG_HOP_LE kèm field, DB không đổi", async (_t, input, field) => {
      const hs = await taoHoSo(nen, { id: `${P}b-4` });
      const k = await svc.botSung(ten(qlA), { draftId: hs.id, version: hs.version, ...input });
      expect(k).toMatchObject({ ok: false, error: { code: "DU_LIEU_KHONG_HOP_LE", field } });
      expect(await doc(hs.id)).toMatchObject({ version: hs.version, claimedById: null });
    });

    it("[DYT-15] đổi CƠ SỞ: sang cơ sở NGOÀI phạm vi (QLCS A chọn B) ⇒ CO_SO_KHONG_HOP_LE; cơ sở chưa xuất bản/ngừng nhận ⇒ cũng từ chối; Hội sở chọn B được và cơ sở xử lý đi theo", async () => {
      const hs = await taoHoSo(nen, { id: `${P}b-5` });
      expect(await svc.botSung(ten(qlA), { draftId: hs.id, version: hs.version, campusCenterId: nen.centerB })).toMatchObject({ ok: false, error: { code: "CO_SO_KHONG_HOP_LE" } });
      await db.aiLeadCampusPublication.updateMany({ where: { pageId: PAGE, campusCenterId: nen.centerB }, data: { acceptingLeads: false } });
      expect(await svc.botSung(ten(ho), { draftId: hs.id, version: hs.version, campusCenterId: nen.centerB })).toMatchObject({ ok: false, error: { code: "CO_SO_KHONG_HOP_LE" } });
      await db.aiLeadCampusPublication.updateMany({ where: { pageId: PAGE, campusCenterId: nen.centerB }, data: { acceptingLeads: true } });
      const k = await svc.botSung(ten(ho), { draftId: hs.id, version: hs.version, campusCenterId: nen.centerB });
      expect(k.ok).toBe(true);
      const sau = await doc(hs.id);
      expect(sau).toMatchObject({ campusCenterId: nen.centerB, centerId: nen.centerB, campusCode: "ATB" });
      expect(sau.orgUnitId).not.toBe(hs.orgUnitId); // ghi kép orgUnitId đi theo cơ sở mới
      // QLCS A không còn thấy hồ sơ (đã sang cơ sở B)
      expect(await svc.chiTiet(qlA, hs.id, true, NOW)).toBeNull();
    });

    it("[DYT-16] phiên bản cũ ⇒ XUNG_DOT_PHIEN_BAN, không ghi đè", async () => {
      const hs = await taoHoSo(nen, { id: `${P}b-6` });
      await svc.botSung(ten(qlA), { draftId: hs.id, version: hs.version, fbName: "Lần một" });
      const k = await svc.botSung(ten(qlA), { draftId: hs.id, version: hs.version, fbName: "Lần hai (dựa trên bản cũ)" });
      expect(k).toMatchObject({ ok: false, error: { code: "XUNG_DOT_PHIEN_BAN" } });
      expect((await doc(hs.id)).fbName).toBe("Lần một");
    });
  });

  // ── 5. DUYỆT ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("duyệt", () => {
    it("[DYT-17] duyệt ⇒ một lead, hồ sơ có leadId; bấm đúp ⇒ cùng lead, không lead thứ hai", async () => {
      const hs = await taoHoSo(nen, { id: `${P}d-1` });
      const k1 = await svc.duyet(ten(qlA), { draftId: hs.id, version: hs.version });
      expect(k1.ok).toBe(true);
      const k2 = await svc.duyet(ten(qlA), { draftId: hs.id, version: hs.version }); // version cũ — bấm đúp từ trang chưa tải lại
      expect(k2).toMatchObject({ ok: true, data: { daCoLead: true } });
      if (k1.ok && k2.ok) expect(k2.data.leadId).toBe(k1.data.leadId);
      expect(await db.lead.count({ where: { eventId: `ailead:${hs.id}` } })).toBe(1);
      expect((await doc(hs.id)).leadId).not.toBeNull();
    });

    it("[DYT-18] ĐUA: hai QLCS cùng duyệt một hồ sơ ⇒ ĐÚNG MỘT lead", async () => {
      const hs = await taoHoSo(nen, { id: `${P}d-2` });
      const kq = await Promise.all([
        svc.duyet(ten(qlA), { draftId: hs.id, version: hs.version }),
        svc.duyet(ten(qlA2), { draftId: hs.id, version: hs.version }),
      ]);
      expect(await db.lead.count({ where: { eventId: `ailead:${hs.id}` } })).toBe(1);
      expect(kq.filter((k) => k.ok).length).toBeGreaterThanOrEqual(1);
      for (const k of kq) if (!k.ok) expect(["XUNG_DOT_PHIEN_BAN", "DA_NGUOI_KHAC_NHAN"]).toContain(k.error.code);
    });

    it("[DYT-19] hồ sơ đang do người KHÁC giữ ⇒ không duyệt được; thiếu điều kiện ⇒ THIEU_DIEU_KIEN nói rõ thiếu gì, 0 lead", async () => {
      const giu = await taoHoSo(nen, { id: `${P}d-3`, state: "IN_PROGRESS", claimedById: qlA2.userId });
      expect(await svc.duyet(ten(qlA), { draftId: giu.id, version: giu.version })).toMatchObject({ ok: false, error: { code: "DA_NGUOI_KHAC_NHAN" } });
      const thieu = await taoHoSo(nen, { id: `${P}d-4`, phone: null, convId: await taoHoiThoai(nen, "d4") });
      const k = await svc.duyet(ten(qlA), { draftId: thieu.id, version: thieu.version });
      expect(k).toMatchObject({ ok: false, error: { code: "THIEU_DIEU_KIEN" } });
      expect(k.ok === false && k.error.message).toContain("Số điện thoại");
      expect(await db.lead.count({ where: { eventId: { in: [`ailead:${giu.id}`, `ailead:${thieu.id}`] } } })).toBe(0);
    });

    it("[DYT-20] version cũ ⇒ XUNG_DOT_PHIEN_BAN (không duyệt dựa trên dữ liệu người duyệt chưa thấy)", async () => {
      const hs = await taoHoSo(nen, { id: `${P}d-5` });
      const k = await svc.duyet(ten(qlA), { draftId: hs.id, version: hs.version - 1 });
      expect(k).toMatchObject({ ok: false, error: { code: "XUNG_DOT_PHIEN_BAN" } });
      expect(await db.lead.count({ where: { eventId: `ailead:${hs.id}` } })).toBe(0);
    });
  });

  // ── 6. TỪ CHỐI ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("từ chối", () => {
    it("[DYT-21] BẮT BUỘC lý do (≥5 ký tự); có lý do ⇒ REJECTED + lý do vào hồ sơ + audit; từ chối lần hai ⇒ TRANG_THAI_KHONG_HOP_LE", async () => {
      const hs = await taoHoSo(nen, { id: `${P}t-1` });
      for (const lyDo of ["", "    ", "abc"]) {
        expect(await svc.tuChoi(ten(qlA), { draftId: hs.id, version: hs.version, lyDo }), `lyDo="${lyDo}"`).toMatchObject({ ok: false, error: { code: "DU_LIEU_KHONG_HOP_LE", field: "lyDo" } });
      }
      expect((await doc(hs.id)).state).toBe("READY_FOR_REVIEW");
      const k = await svc.tuChoi(ten(qlA), { draftId: hs.id, version: hs.version, lyDo: "Khách hỏi cho vui, không có nhu cầu" });
      expect(k).toMatchObject({ ok: true, data: { state: "REJECTED" } });
      const sau = await doc(hs.id);
      expect(sau).toMatchObject({ state: "REJECTED", rejectedReason: "Khách hỏi cho vui, không có nhu cầu" });
      expect(sau.closedAt).not.toBeNull();
      const au = await db.auditLog.findFirstOrThrow({ where: { entityId: hs.id, action: "REJECT" } });
      expect(au.reason).toBe("Khách hỏi cho vui, không có nhu cầu");
      expect(await svc.tuChoi(ten(qlA), { draftId: hs.id, version: hs.version + 1, lyDo: "lần hai cũng có lý do" })).toMatchObject({ ok: false, error: { code: "TRANG_THAI_KHONG_HOP_LE" } });
      expect(await db.lead.count({ where: { eventId: `ailead:${hs.id}` } })).toBe(0);
    });
  });

  // ── 7. TRẢ / CHUYỂN ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("trả hồ sơ & chuyển người", () => {
    it("[DYT-22] trả hồ sơ: chỉ người đang giữ; đủ điều kiện ⇒ READY_FOR_REVIEW, thiếu ⇒ WAITING_QLCS", async () => {
      const du = await taoHoSo(nen, { id: `${P}r-1`, state: "IN_PROGRESS", claimedById: qlA.userId });
      const thieu = await taoHoSo(nen, { id: `${P}r-2`, state: "IN_PROGRESS", claimedById: qlA.userId, phone: null, convId: await taoHoiThoai(nen, "r2") });
      expect(await svc.traHoSo(ten(qlA2), { draftId: du.id, version: du.version })).toMatchObject({ ok: false });
      expect(await svc.traHoSo(ten(qlA), { draftId: du.id, version: du.version })).toMatchObject({ ok: true, data: { state: "READY_FOR_REVIEW" } });
      expect(await svc.traHoSo(ten(qlA), { draftId: thieu.id, version: thieu.version })).toMatchObject({ ok: true, data: { state: "WAITING_QLCS" } });
      expect((await doc(du.id)).claimedById).toBeNull();
    });

    it("[DYT-23] chuyển người: người nhận hợp lệ ⇒ chuyển + thông báo KHÔNG chứa tên/SĐT khách; người không có quyền / khác cơ sở / không hoạt động / chính mình ⇒ từ chối", async () => {
      const nhan = await db.user.create({ data: { name: `${P}Người nhận`, email: `${P.toLowerCase()}nhan@example.test`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: nen.centerA } });
      const nghi = await db.user.create({ data: { name: `${P}Đã nghỉ`, email: `${P.toLowerCase()}nghi@example.test`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: nen.centerA, isActive: false } });
      bang.actors.set(nhan.id, actorQlcs(nhan.id, [nen.centerA]));
      bang.actors.set(nghi.id, actorQlcs(nghi.id, [nen.centerA]));
      const hs = await taoHoSo(nen, { id: `${P}x-1`, state: "IN_PROGRESS", claimedById: qlA.userId });
      const v = hs.version;
      expect(await svc.chuyenNguoi(ten(qlA), { draftId: hs.id, version: v, nguoiNhanId: qlA.userId })).toMatchObject({ ok: false, error: { code: "NGUOI_NHAN_KHONG_HOP_LE" } });
      expect(await svc.chuyenNguoi(ten(qlA), { draftId: hs.id, version: v, nguoiNhanId: qlB.userId })).toMatchObject({ ok: false, error: { code: "NGUOI_NHAN_KHONG_HOP_LE" } }); // không thấy hồ sơ cơ sở A
      expect(await svc.chuyenNguoi(ten(qlA), { draftId: hs.id, version: v, nguoiNhanId: nghi.id })).toMatchObject({ ok: false, error: { code: "NGUOI_NHAN_KHONG_HOP_LE" } });
      expect(await svc.chuyenNguoi(ten(qlA), { draftId: hs.id, version: v, nguoiNhanId: "khong-ton-tai" })).toMatchObject({ ok: false, error: { code: "NGUOI_NHAN_KHONG_HOP_LE" } });
      expect((await doc(hs.id)).claimedById).toBe(qlA.userId);
      // người KHÁC (không giữ) không chuyển được hồ sơ của người khác
      expect(await svc.chuyenNguoi(ten(qlA2), { draftId: hs.id, version: v, nguoiNhanId: nhan.id })).toMatchObject({ ok: false, error: { code: "DA_NGUOI_KHAC_NHAN" } });
      const k = await svc.chuyenNguoi(ten(qlA), { draftId: hs.id, version: v, nguoiNhanId: nhan.id });
      expect(k).toMatchObject({ ok: true, data: { state: "IN_PROGRESS" } });
      expect((await doc(hs.id)).claimedById).toBe(nhan.id);
      const tb = await db.staffNotification.findMany({ where: { dedupeKey: `ai_lead.draft:${hs.id}` } });
      expect(tb).toHaveLength(1);
      expect(tb[0]).toMatchObject({ userId: nhan.id, href: `/ai-lead/${hs.id}` });
      expect(`${tb[0]!.title} ${tb[0]!.body}`).not.toMatch(/Nguyễn|0905|84905|0900/);
      await db.staffNotification.deleteMany({ where: { userId: { in: [nhan.id, nghi.id] } } });
      await db.user.deleteMany({ where: { id: { in: [nhan.id, nghi.id] } } });
    });

    it("[DYT-23b] cổng người nhận phía máy chủ theo VAI: Hội sở CÓ review ⇒ nhận; Hội sở chỉ-xem · Sale (không `ai-leads:*`) · nhân viên cơ sở khác (kể cả cơ sở nhượng quyền) ⇒ từ chối, hồ sơ không đổi người giữ", async () => {
      const mk = (h: string) => db.user.create({ data: { name: `${P}${h}`, email: `${P.toLowerCase()}${h.toLowerCase()}@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: nen.centerA } });
      const [hoCo, hoXem, sale, khac] = await Promise.all([mk("hoCo"), mk("hoXem"), mk("sale"), mk("khacCS")]);
      bang.actors.set(hoCo.id, actorHoiSo(hoCo.id));
      bang.actors.set(hoXem.id, actorHoiSo(hoXem.id, ["ai-leads:view"]));
      bang.actors.set(sale.id, actorHoiSo(sale.id, ["leads:view"]));
      bang.actors.set(khac.id, actorQlcs(khac.id, [nen.centerB])); // cơ sở nhượng quyền / cơ sở khác: không thấy hồ sơ của cơ sở A
      const hs = await taoHoSo(nen, { id: `${P}x-23b`, state: "IN_PROGRESS", claimedById: qlA.userId });
      for (const tu of [hoXem, sale, khac]) {
        expect(await svc.chuyenNguoi(ten(qlA), { draftId: hs.id, version: hs.version, nguoiNhanId: tu.id }), tu.name ?? "").toMatchObject({ ok: false, error: { code: "NGUOI_NHAN_KHONG_HOP_LE" } });
      }
      expect((await doc(hs.id)).claimedById).toBe(qlA.userId);
      expect(await svc.chuyenNguoi(ten(qlA), { draftId: hs.id, version: hs.version, nguoiNhanId: hoCo.id })).toMatchObject({ ok: true });
      expect((await doc(hs.id)).claimedById).toBe(hoCo.id);
      const ids = [hoCo.id, hoXem.id, sale.id, khac.id];
      await db.staffNotification.deleteMany({ where: { userId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
    });

    it("[DYT-24] ứng viên chuyển = quản lý của cơ sở xử lý, trừ chính mình; hồ sơ ngoài phạm vi ⇒ rỗng", async () => {
      const nhan = await db.user.create({ data: { name: `${P}Quản lý A2`, email: `${P.toLowerCase()}ql2@example.test`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: nen.centerA } });
      bang.actors.set(nhan.id, actorQlcs(nhan.id, [nen.centerA])); // ứng viên chỉ hiện khi actor RBAC v2 của họ thật sự có `ai-leads:review` tại cơ sở (FIX-01)
      const hs = await taoHoSo(nen, { id: `${P}x-2` });
      const ds = await svc.ungVienChuyen(ten(qlA), hs.id);
      expect(ds.map((u) => u.id)).toContain(nhan.id);
      expect(ds.map((u) => u.id)).not.toContain(qlA.userId);
      expect(await svc.ungVienChuyen(ten(qlB), hs.id)).toEqual([]);
      await db.user.delete({ where: { id: nhan.id } });
    });

    it("[DYT-24b] ứng viên chuyển CHỈ gồm người mà máy chủ sẽ nhận: có `ai-leads:review` VÀ thấy hồ sơ — Giáo vụ (CENTER_MANAGER cũ nhưng không có review), người chỉ-xem, người cơ sở khác, người nghỉ đều bị loại; mỗi ứng viên đều qua `chuyenNguoi`", async () => {
      const mk = (hau: string, extra: { isActive?: boolean; centerId?: string } = {}) =>
        db.user.create({ data: { name: `${P}${hau}`, email: `${P.toLowerCase()}${hau.toLowerCase()}@example.test`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: extra.centerId ?? nen.centerA, isActive: extra.isActive ?? true } });
      const tot = await mk("QL tốt");
      const giaoVu = await mk("Giáo vụ CS1"); // nằm trong tập quản lý cơ sở cũ (roles) nhưng actor RBAC v2 KHÔNG có review
      const chiXem = await mk("Chỉ xem");
      const khacCoSo = await mk("QL cơ sở B", { centerId: nen.centerA }); // actor neo ở CS-B ⇒ không thấy hồ sơ CS-A
      const nghi = await mk("Đã nghỉ", { isActive: false });
      bang.actors.set(tot.id, actorQlcs(tot.id, [nen.centerA]));
      bang.actors.set(giaoVu.id, { ...actorQlcs(giaoVu.id, [nen.centerA]), permissions: [] });
      bang.actors.set(chiXem.id, actorChiXem(chiXem.id, [nen.centerA]));
      bang.actors.set(khacCoSo.id, actorQlcs(khacCoSo.id, [nen.centerB]));
      bang.actors.set(nghi.id, actorQlcs(nghi.id, [nen.centerA]));
      const hs = await taoHoSo(nen, { id: `${P}x-24b`, state: "IN_PROGRESS", claimedById: qlA.userId });
      const ids = (await svc.ungVienChuyen(ten(qlA), hs.id)).map((u) => u.id);
      expect(ids).toContain(tot.id);
      for (const loai of [giaoVu, chiXem, khacCoSo, nghi]) expect(ids, loai.name ?? "").not.toContain(loai.id);
      // Bất biến: mọi ứng viên được liệt kê đều qua được cổng thật của `chuyenNguoi` (không có người "hiện ra rồi bị từ chối").
      for (const id of ids) {
        const kq = await svc.chuyenNguoi(ten(qlA), { draftId: hs.id, version: (await doc(hs.id)).version, nguoiNhanId: id });
        expect(kq, id).toMatchObject({ ok: true });
        await db.aiLeadDraft.update({ where: { id: hs.id }, data: { claimedById: qlA.userId } }); // trả lại cho qlA để thử người kế
      }
      await db.staffNotification.deleteMany({ where: { userId: { in: [tot.id, giaoVu.id, chiXem.id, khacCoSo.id, nghi.id] } } });
      await db.user.deleteMany({ where: { id: { in: [tot.id, giaoVu.id, chiXem.id, khacCoSo.id, nghi.id] } } });
    });
  });

  // ── 8. BÁO ĐÃ NHẬN TRONG PAGE INBOX (OD-11) ───────────────────────────────────────────────────────────────────────────────────────────
  describe("báo đã nhận trong Page Inbox", () => {
    async function dung(ownerState: "AI_ACTIVE" | "HANDOFF_REQUESTED" | "TAKEOVER_PENDING", hauTo: string, nguon?: "AGENT_REPORTED" | "STAFF_ATTESTED") {
      const convId = await taoHoiThoai(nen, hauTo, { ownerState });
      if (nguon) await db.aiLeadConversation.update({ where: { id: convId }, data: { takeoverConfirmSource: nguon } });
      return taoHoSo(nen, { id: `${P}o-${hauTo}`, convId, state: "WAITING_QLCS" });
    }
    const owner = async (hs: { conversationId: string }) => db.aiLeadConversation.findUniqueOrThrow({ where: { id: hs.conversationId } });

    it("[DYT-25] mặc định (cần Agent xác nhận) ⇒ TAKEOVER_PENDING, nguồn STAFF_ATTESTED — KHÔNG lên HUMAN_ACTIVE", async () => {
      const hs = await dung("HANDOFF_REQUESTED", "o1");
      const k = await svc.baoDaNhanTrongPageInbox(ten(qlA), { draftId: hs.id, version: hs.version });
      expect(k).toMatchObject({ ok: true, data: { ownerState: "TAKEOVER_PENDING" } });
      expect(await owner(hs)).toMatchObject({ ownerState: "TAKEOVER_PENDING", takeoverConfirmSource: "STAFF_ATTESTED", staffClaimedById: qlA.userId });
      expect((await owner(hs)).takeoverConfirmedAt).not.toBeNull();
      expect(await doc(hs.id)).toMatchObject({ claimedById: qlA.userId, state: "IN_PROGRESS" });
    });

    it("[DYT-26] tham số «không cần Agent xác nhận» ⇒ HUMAN_ACTIVE; Agent đã báo trước (AGENT_REPORTED) ⇒ HUMAN_ACTIVE giữ nguồn Agent", async () => {
      bang.caiDat.set("ai.takeoverNeedsAgentConfirmation", false);
      const a = await dung("HANDOFF_REQUESTED", "o2");
      expect(await svc.baoDaNhanTrongPageInbox(ten(qlA), { draftId: a.id, version: a.version })).toMatchObject({ ok: true, data: { ownerState: "HUMAN_ACTIVE" } });
      bang.caiDat.set("ai.takeoverNeedsAgentConfirmation", true);
      const b = await dung("HANDOFF_REQUESTED", "o3", "AGENT_REPORTED");
      expect(await svc.baoDaNhanTrongPageInbox(ten(qlA), { draftId: b.id, version: b.version })).toMatchObject({ ok: true, data: { ownerState: "HUMAN_ACTIVE" } });
      expect((await owner(b)).takeoverConfirmSource).toBe("AGENT_REPORTED");
    });

    it("[DYT-27] hội thoại còn AI_ACTIVE (Agent đang giữ) ⇒ từ chối, hội thoại KHÔNG đổi", async () => {
      const hs = await dung("AI_ACTIVE", "o4");
      const k = await svc.baoDaNhanTrongPageInbox(ten(qlA), { draftId: hs.id, version: hs.version });
      expect(k).toMatchObject({ ok: false, error: { code: "HOI_THOAI_KHONG_HOP_LE" } });
      expect(await owner(hs)).toMatchObject({ ownerState: "AI_ACTIVE", takeoverConfirmSource: null });
    });
  });
});
