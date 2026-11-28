import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/settings/service", async (goc) => ({ ...(await goc<typeof import("@/lib/settings/service")>()), getSetting: vi.fn(async () => false) }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as dsGet } from "@/app/api/mobile/v1/chat/conversations/route";
import { GET as thanhVienGet } from "@/app/api/mobile/v1/chat/conversations/[conversationId]/members/route";
import { DELETE as thuHoiDelete } from "@/app/api/mobile/v1/chat/conversations/[conversationId]/messages/[messageId]/route";
import { GET as tinGet, POST as tinPost } from "@/app/api/mobile/v1/chat/conversations/[conversationId]/messages/route";
import { GET as gvGet } from "@/app/api/mobile/v1/chat/teachers/route";
import { POST as dmPost } from "@/app/api/mobile/v1/chat/dm/route";
import { POST as docPost } from "@/app/api/mobile/v1/chat/conversations/[conversationId]/read/route";
import { POST as dongYChat } from "@/app/api/mobile/v1/chat/policy/accept/route";
import { GET as quyDinhChatGet } from "@/app/api/mobile/v1/chat/policy/route";
import { GET as chuaDocGet } from "@/app/api/mobile/v1/chat/unread/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [CHAT-DB] V8.5 — chat phụ huynh trên app (bọc domain chat của web), Postgres thật:
 *   [CHAT-DB-01] cờ MOBILE_CHAT_ENABLED tắt ⇒ 404 mọi route; chưa đồng ý quy định chat ⇒ 403 CHAT_POLICY_REQUIRED (đọc + ghi); đồng ý idempotent (giữ mốc đầu)
 *   [CHAT-DB-02] danh sách: chỉ hội thoại của MÌNH, chưa đọc đúng, tin cuối; nhà khác không thấy; tổng chưa đọc khớp web
 *   [CHAT-DB-03] tin nhắn: phân trang con trỏ (không sót/trùng), tên người gửi, KHÔNG SĐT/email; hội thoại của nhà khác / không tồn tại / id lạ ⇒ cùng 404
 *   [CHAT-DB-04] gửi: ghi đúng bảng của web; idempotent theo khoaGuiLai; kiểm lược đồ (rỗng/quá dài/trường lạ/tệp đính kèm); trả lời tin của hội thoại khác ⇒ 400; lưu trữ/khoá ⇒ 409
 *   [CHAT-DB-05] CHUYỂN LỚP / đổi giáo viên (web gỡ thành viên `leftAt`) ⇒ app mất quyền NGAY: đọc/gửi/đánh dấu đọc ⇒ 404, biến khỏi danh sách; vào lại ⇒ có lại
 *   [CHAT-DB-06] đánh dấu đã đọc: chưa đọc về 0, idempotent, ghi mốc; nhà khác 404; huy hiệu cập nhật
 *   [CHAT-DB-07] thu hồi tin của chính mình ≤15 phút; tin người khác / quá hạn / đã gỡ ⇒ từ chối; tin không thuộc hội thoại trong đường dẫn ⇒ 404; sau thu hồi người nhận thấy «Tin nhắn đã được gỡ»
 *   [CHAT-DB-08] thành viên: tên + nhãn vai, KHÔNG `contact`; nhà khác 404
 *   [CHAT-DB-10] «Nhắn cô thầy»: mở/mở lại hội thoại riêng với giáo viên ĐANG DẠY con; một cặp một hội thoại (idempotent); giáo viên không dạy con mình / người lạ ⇒ 404; nhắn qua hội thoại riêng; B không vào được hội thoại riêng của A
 *   [CHAT-DB-11] giáo viên nhận tin: gộp MỌI nhóm lớp đang mở (nhiều con/lớp, một giáo viên một dòng kèm các lớp); rời nhóm / nhóm lưu trữ ⇒ biến mất; chỉ tên + id; nhà khác không thấy
 *   [CHAT-DB-09] cách ly: phụ huynh B không đọc/gửi/đánh dấu/thu hồi trong hội thoại của A (HTTP-route level)
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "chat-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.93.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const A = (k: string) => `${NS}${k}`;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  const cs = await db.conversation.findMany({ where: { title: { startsWith: NS } }, select: { id: true } });
  const cids = cs.map((c) => c.id);
  await db.messageAttachment.deleteMany({ where: { message: { conversationId: { in: cids } } } });
  await db.message.deleteMany({ where: { conversationId: { in: cids } } });
  await db.conversationParticipant.deleteMany({ where: { conversationId: { in: cids } } });
  await db.conversation.deleteMany({ where: { id: { in: cids } } });
  await db.chatPolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.class.deleteMany({ where: { id: { startsWith: NS } } });
  await db.course.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[CHAT-DB] chat phụ huynh — Postgres thật", () => {
  const ids: Record<string, string> = {};
  const S1 = A("s1");
  const S3 = A("s3");
  let tA = "";
  let tB = "";
  let CV = ""; // hội thoại nhóm lớp (A + GV)
  let CV2 = ""; // hội thoại của B + GV
  const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ conversationId: id, ...extra }) as never });
  const lay = (tok: string, id: string, q = "") => tinGet(req("GET", `/api/mobile/v1/chat/conversations/${id}/messages${q}`, undefined, bearer(tok)), ctx(id));
  const gui = (tok: string, id: string, than: unknown) => tinPost(req("POST", `/api/mobile/v1/chat/conversations/${id}/messages`, than, bearer(tok)), ctx(id));
  const doc = (tok: string, id: string, than: unknown) => docPost(req("POST", `/api/mobile/v1/chat/conversations/${id}/read`, than, bearer(tok)), ctx(id));
  const ds = (tok: string) => dsGet(req("GET", "/api/mobile/v1/chat/conversations", undefined, bearer(tok)));
  const tinGoc = (cid: string, sender: string | null, body: string, o: Record<string, unknown> = {}) => db.message.create({ data: { id: randomUUID(), conversationId: cid, senderId: sender, kind: "CHAT", body, ...o } as never });

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.MOBILE_CHAT_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, vai: "PARENT" | "TEACHER", sdt: string) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${vai === "TEACHER" ? "Cô" : "PH"} ${k}`, phone: sdt, password: hash, role: vai, roles: [vai] } as never, select: { id: true } })).id);
    await mk("A", "PARENT", "84966980001");
    await mk("B", "PARENT", "84966980002");
    await mk("GV", "TEACHER", "84966980003");
    await db.center.create({ data: { id: A("cs"), name: "Cơ sở CHAT", slug: A("cs"), address: "Địa chỉ" } });
    await db.course.create({ data: { id: A("kh"), name: "Khoá CHAT", slug: A("kh"), totalSessions: 12 } });
    for (const l of ["l1", "l2"]) await db.class.create({ data: { id: A(l), name: `Lớp ${l}`, classCode: A(l), courseId: A("kh"), centerId: A("cs"), status: "ACTIVE", isActive: true, startTime: "18:00", teacherId: ids.GV } as never });
    await db.student.create({ data: { id: S1, name: "An", parentUserId: ids.A, centerId: A("cs") } as never });
    await db.student.create({ data: { id: S3, name: "Cường", parentUserId: ids.B, centerId: A("cs") } as never });
    await db.enrollment.create({ data: { id: A("dk1"), studentId: S1, classId: A("l1"), courseId: A("kh"), status: "ACTIVE", centerId: A("cs") } as never });
    await db.enrollment.create({ data: { id: A("dk3"), studentId: S3, classId: A("l2"), courseId: A("kh"), status: "ACTIVE", centerId: A("cs") } as never });
    const hoiThoai = async (lop: string, parents: string[]) => {
      const c = await db.conversation.create({ data: { id: randomUUID(), type: "CLASS_GROUP", status: "ACTIVE", centerId: A("cs"), subjectType: "CLASS", subjectId: lop, title: `${NS}${lop}` } as never });
      await db.conversationParticipant.create({ data: { conversationId: c.id, userId: ids.GV!, role: "OWNER", derivedFrom: "CLASS_TEACHER" } as never });
      for (const p of parents) await db.conversationParticipant.create({ data: { conversationId: c.id, userId: p, role: "MEMBER", derivedFrom: "CLASS_STUDENT_PARENT" } as never });
      return c.id;
    };
    CV = await hoiThoai(A("l1"), [ids.A!]);
    CV2 = await hoiThoai(A("l2"), [ids.B!]);
    const dn = async (sdt: string, n: number) => {
      const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9c00-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      return ((await json(r)).data as { accessToken: string }).accessToken;
    };
    tA = await dn("0966980001", 1);
    tB = await dn("0966980002", 2);
    for (const t of [tA, tB]) await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
  }, 120_000);
  afterAll(don);

  it("[CHAT-DB-01] cờ tắt ⇒ 404; chưa đồng ý quy định chat ⇒ 403; đồng ý idempotent", async () => {
    process.env.MOBILE_CHAT_ENABLED = "false";
    try {
      expect(await ma(await ds(tA))).toEqual([404, "NOT_FOUND"]);
      expect(await ma(await quyDinhChatGet(req("GET", "/api/mobile/v1/chat/policy", undefined, bearer(tA))))).toEqual([404, "NOT_FOUND"]);
    } finally {
      process.env.MOBILE_CHAT_ENABLED = "true";
    }
    for (const r of [await ds(tA), await lay(tA, CV), await gui(tA, CV, { noiDung: "x", khoaGuiLai: randomUUID() }), await doc(tA, CV, { tinCuoiId: null }), await chuaDocGet(req("GET", "/api/mobile/v1/chat/unread", undefined, bearer(tA)))]) {
      expect(await ma(r)).toEqual([403, "CHAT_POLICY_REQUIRED"]);
    }
    const q = (await json(await quyDinhChatGet(req("GET", "/api/mobile/v1/chat/policy", undefined, bearer(tA))))).data;
    expect([q.daDongY, typeof q.phienBan, q.noiDung.length > 0]).toEqual([false, "string", true]);
    expect((await dongYChat(req("POST", "/api/mobile/v1/chat/policy/accept", {}, bearer(tA)))).status).toBe(200);
    const m1 = await db.chatPolicyAcceptance.findFirst({ where: { userId: ids.A }, select: { acceptedAt: true } });
    expect((await dongYChat(req("POST", "/api/mobile/v1/chat/policy/accept", {}, bearer(tA)))).status).toBe(200);
    expect((await db.chatPolicyAcceptance.findFirst({ where: { userId: ids.A }, select: { acceptedAt: true } }))?.acceptedAt).toEqual(m1?.acceptedAt);
    expect((await json(await quyDinhChatGet(req("GET", "/api/mobile/v1/chat/policy", undefined, bearer(tA))))).data.daDongY).toBe(true);
    await dongYChat(req("POST", "/api/mobile/v1/chat/policy/accept", {}, bearer(tB)));
  });

  it("[CHAT-DB-02] danh sách + chưa đọc", async () => {
    await tinGoc(CV, ids.GV!, "Chào cả lớp, tuần này có bài mới.");
    await tinGoc(CV, ids.GV!, "Nhớ mang robot nhé.");
    await db.conversationParticipant.update({ where: { conversationId_userId: { conversationId: CV, userId: ids.A! } }, data: { unreadCount: 2 } });
    await db.conversation.update({ where: { id: CV }, data: { lastMessageAt: new Date() } });
    const d = (await json(await ds(tA))).data;
    expect(d.muc.map((m: { id: string }) => m.id)).toEqual([CV]);
    expect([d.muc[0].loai, d.muc[0].chuaDoc, d.muc[0].trangThai, d.tongChuaDoc]).toEqual(["NHOM_LOP", 2, "DANG_MO", 2]);
    expect(d.muc[0].tinCuoi.laCuaToi).toBe(false);
    expect((await json(await chuaDocGet(req("GET", "/api/mobile/v1/chat/unread", undefined, bearer(tA))))).data.chuaDoc).toBe(2);
    expect((await json(await ds(tB))).data.muc.map((m: { id: string }) => m.id)).toEqual([CV2]); // B chỉ thấy hội thoại của B
  });

  it("[CHAT-DB-03] tin nhắn: phân trang con trỏ, không SĐT/email, cách ly 404", async () => {
    for (let i = 0; i < 40; i++) await tinGoc(CV, ids.GV!, `Tin số ${i}`, { createdAt: new Date(Date.now() - (60 - i) * 1000) });
    const p1 = (await json(await lay(tA, CV, "?soLuong=30"))).data;
    expect([p1.tin.length, p1.coTrangTruoc, typeof p1.conTro]).toEqual([30, true, "string"]);
    const p2 = (await json(await lay(tA, CV, `?soLuong=30&truoc=${encodeURIComponent(p1.conTro)}`))).data;
    const idP1 = new Set(p1.tin.map((t: { id: string }) => t.id));
    expect(p2.tin.some((t: { id: string }) => idP1.has(t.id))).toBe(false); // không trùng giữa hai trang
    expect(p1.tin.length + p2.tin.length).toBe(42); // 2 + 40 tin gốc, không sót
    expect(p2.coTrangTruoc).toBe(false);
    expect(p1.tin[0].nguoiGui.ten).toBe("Cô GV");
    expect(p1.tin[0].laCuaToi).toBe(false);
    const txt = JSON.stringify(p1);
    expect(txt).not.toMatch(/84966980|@seed\.invalid|phone|email|contact/i);
    expect(await ma(await lay(tB, CV))).toEqual([404, "NOT_FOUND"]); // hội thoại của nhà khác
    expect(await ma(await lay(tA, randomUUID()))).toEqual([404, "NOT_FOUND"]); // không tồn tại
    expect(await ma(await lay(tA, "khong-phai-uuid"))).toEqual([404, "NOT_FOUND"]);
    for (const q of ["?soLuong=0", "?soLuong=51", "?khac=1"]) expect((await lay(tA, CV, q)).status, q).toBe(400);
  });

  it("[CHAT-DB-04] gửi tin: idempotent, lược đồ, trả lời, lưu trữ/khoá", async () => {
    const k1 = randomUUID();
    const r = await gui(tA, CV, { noiDung: "  Em xin phép hỏi bài tập ạ  ", khoaGuiLai: k1 });
    expect(r.status).toBe(200);
    const m = (await json(r)).data;
    expect([m.noiDung, m.laCuaToi, m.trungLap, m.khoaGuiLai]).toEqual(["Em xin phép hỏi bài tập ạ", true, false, k1]);
    const goc = await db.message.findMany({ where: { conversationId: CV, senderId: ids.A }, select: { id: true, body: true, clientMsgId: true } });
    expect(goc).toHaveLength(1); // ghi đúng bảng của web
    const lai = await gui(tA, CV, { noiDung: "Em xin phép hỏi bài tập ạ", khoaGuiLai: k1 });
    const laiD = (await json(lai)).data;
    expect([lai.status, laiD.trungLap, laiD.id]).toEqual([200, true, m.id]);
    expect(await db.message.count({ where: { conversationId: CV, senderId: ids.A } })).toBe(1);
    for (const x of [{ noiDung: "", khoaGuiLai: randomUUID() }, { noiDung: "x".repeat(4001), khoaGuiLai: randomUUID() }, { noiDung: "ok", khoaGuiLai: "khong-uuid" }, { noiDung: "ok", khoaGuiLai: randomUUID(), attachments: [] }, { noiDung: "ok", khoaGuiLai: randomUUID(), senderId: ids.GV }, { khoaGuiLai: randomUUID() }]) {
      expect(await ma(await gui(tA, CV, x)), JSON.stringify(x).slice(0, 60)).toEqual([400, "VALIDATION"]);
    }
    const tinCuaB = await tinGoc(CV2, ids.GV!, "tin ở hội thoại của B");
    expect((await gui(tA, CV, { noiDung: "trả lời lẫn hội thoại", khoaGuiLai: randomUUID(), traLoiId: tinCuaB.id })).status).toBe(400);
    expect((await gui(tA, CV, { noiDung: "trả lời đúng", khoaGuiLai: randomUUID(), traLoiId: goc[0]!.id })).status).toBe(200);
    await db.conversation.update({ where: { id: CV }, data: { status: "ARCHIVED" } });
    expect(await ma(await gui(tA, CV, { noiDung: "gửi vào lớp đã kết thúc", khoaGuiLai: randomUUID() }))).toEqual([409, "CHAT_KHONG_GUI_DUOC"]);
    expect((await lay(tA, CV)).status).toBe(200); // lưu trữ vẫn ĐỌC được
    await db.conversation.update({ where: { id: CV }, data: { status: "LOCKED" } });
    expect(await ma(await gui(tA, CV, { noiDung: "gửi vào hội thoại khoá", khoaGuiLai: randomUUID() }))).toEqual([409, "CHAT_KHONG_GUI_DUOC"]);
    await db.conversation.update({ where: { id: CV }, data: { status: "ACTIVE" } });
    expect(await ma(await gui(tB, CV, { noiDung: "B chen vào hội thoại của A", khoaGuiLai: randomUUID() }))).toEqual([404, "NOT_FOUND"]);
    expect(await db.message.count({ where: { conversationId: CV, senderId: ids.B } })).toBe(0);
  });

  it("[CHAT-DB-05] chuyển lớp / đổi giáo viên ⇒ app mất quyền NGAY; vào lại ⇒ có lại", async () => {
    const tv = { where: { conversationId_userId: { conversationId: CV, userId: ids.A! } } };
    await db.conversationParticipant.update({ ...tv, data: { leftAt: new Date() } }); // web: syncConversationMembership gỡ thành viên
    expect(await ma(await lay(tA, CV))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await gui(tA, CV, { noiDung: "vẫn còn nhắn được?", khoaGuiLai: randomUUID() }))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await doc(tA, CV, { tinCuoiId: null }))).toEqual([404, "NOT_FOUND"]);
    expect((await json(await ds(tA))).data.muc.map((m: { id: string }) => m.id)).not.toContain(CV);
    expect(await ma(await thanhVienGet(req("GET", `/api/mobile/v1/chat/conversations/${CV}/members`, undefined, bearer(tA)), ctx(CV)))).toEqual([404, "NOT_FOUND"]);
    await db.conversationParticipant.update({ ...tv, data: { leftAt: null } });
    expect((await lay(tA, CV)).status).toBe(200);
  });

  it("[CHAT-DB-06] đánh dấu đã đọc", async () => {
    await db.conversationParticipant.update({ where: { conversationId_userId: { conversationId: CV, userId: ids.A! } }, data: { unreadCount: 3 } });
    const cuoi = (await db.message.findFirst({ where: { conversationId: CV }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } }))!.id;
    const r = await doc(tA, CV, { tinCuoiId: cuoi });
    expect([r.status, (await json(r)).data.chuaDoc]).toEqual([200, 0]);
    const tv = await db.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: CV, userId: ids.A! } }, select: { unreadCount: true, lastReadMessageId: true, lastReadAt: true } });
    expect([tv?.unreadCount, tv?.lastReadMessageId, tv?.lastReadAt !== null]).toEqual([0, cuoi, true]);
    expect((await doc(tA, CV, { tinCuoiId: cuoi })).status).toBe(200); // idempotent
    expect(await ma(await doc(tB, CV, { tinCuoiId: cuoi }))).toEqual([404, "NOT_FOUND"]);
    for (const x of [{}, { tinCuoiId: "x" }, { tinCuoiId: cuoi, khac: 1 }]) expect((await doc(tA, CV, x)).status, JSON.stringify(x)).toBe(400);
    expect((await json(await chuaDocGet(req("GET", "/api/mobile/v1/chat/unread", undefined, bearer(tA))))).data.chuaDoc).toBe(0);
  });

  it("[CHAT-DB-07] thu hồi tin của mình ≤15 phút", async () => {
    const thuHoi = (tok: string, cid: string, mid: string) => thuHoiDelete(req("DELETE", `/api/mobile/v1/chat/conversations/${cid}/messages/${mid}`, undefined, bearer(tok)), ctx(cid, { messageId: mid }));
    const k = randomUUID();
    const m = (await json(await gui(tA, CV, { noiDung: "gửi nhầm, thu hồi", khoaGuiLai: k }))).data;
    const tinGV = await tinGoc(CV, ids.GV!, "tin của giáo viên");
    const r = await thuHoi(tA, CV, m.id);
    expect([r.status, (await json(r)).data]).toEqual([200, { daGo: true }]);
    expect((await json(await lay(tB, CV2))).ok).toBe(true);
    const sau = (await json(await lay(tA, CV))).data.tin.find((t: { id: string }) => t.id === m.id);
    expect([sau.daGo, sau.noiDung]).toEqual([true, "Tin nhắn đã được gỡ"]);
    expect((await thuHoi(tA, CV, m.id)).status).toBe(409); // đã gỡ
    expect((await thuHoi(tA, CV, tinGV.id)).status).toBe(403); // tin của người khác
    expect((await db.message.findUnique({ where: { id: tinGV.id }, select: { deletedAt: true } }))?.deletedAt).toBeNull();
    const cu = await tinGoc(CV, ids.A!, "tin cũ 20 phút", { createdAt: new Date(Date.now() - 20 * 60_000), clientMsgId: randomUUID() });
    expect(await ma(await thuHoi(tA, CV, cu.id))).toEqual([409, "CHAT_KHONG_GUI_DUOC"]); // quá 15 phút
    const m2 = (await json(await gui(tA, CV, { noiDung: "tin dùng thử đường dẫn sai", khoaGuiLai: randomUUID() }))).data;
    expect((await thuHoi(tA, CV2, m2.id)).status).toBe(404); // tin không thuộc hội thoại trong đường dẫn (A không thuộc CV2)
    expect((await db.message.findUnique({ where: { id: m2.id }, select: { deletedAt: true } }))?.deletedAt).toBeNull();
    // Người dùng thuộc CẢ HAI hội thoại: đường dẫn trỏ hội thoại khác với tin ⇒ vẫn 404 và tin KHÔNG bị gỡ (kiểm trước khi ghi)
    const cv3 = await db.conversation.create({ data: { id: randomUUID(), type: "DM_TEACHER_PARENT", status: "ACTIVE", centerId: A("cs"), subjectType: "NONE", dmKey: `${NS}dm-${randomUUID()}`, title: `${NS}cv3` } as never });
    await db.conversationParticipant.create({ data: { conversationId: cv3.id, userId: ids.A!, role: "MEMBER", derivedFrom: "CLASS_STUDENT_PARENT" } as never });
    expect((await thuHoi(tA, cv3.id, m2.id)).status).toBe(404);
    expect((await db.message.findUnique({ where: { id: m2.id }, select: { deletedAt: true } }))?.deletedAt).toBeNull();
  });

  it("[CHAT-DB-08] thành viên không lộ liên hệ", async () => {
    const r = await thanhVienGet(req("GET", `/api/mobile/v1/chat/conversations/${CV}/members`, undefined, bearer(tA)), ctx(CV));
    expect(r.status).toBe(200);
    const d = (await json(r)).data.muc as Array<{ id: string; ten: string; vaiTro: string; laToi: boolean }>;
    expect(d.map((x) => x.vaiTro).sort()).toEqual(["Giáo viên", "PH của An"].sort());
    expect(d.find((x) => x.laToi)?.id).toBe(ids.A);
    expect((d as unknown as Array<{ vaiTro: string; giaoVien: boolean }>).filter((x) => x.giaoVien).map((x) => x.vaiTro)).toEqual(["Giáo viên"]); // cờ giáo viên để «Nhắn cô thầy»
    expect(JSON.stringify(d)).not.toMatch(/84966980|@seed|phone|email|contact/i);
    expect((await thanhVienGet(req("GET", `/api/mobile/v1/chat/conversations/${CV}/members`, undefined, bearer(tB)), ctx(CV))).status).toBe(404);
  });

  it("[CHAT-DB-10] «Nhắn cô thầy»", async () => {
    const mo = (tok: string, than: unknown) => dmPost(req("POST", "/api/mobile/v1/chat/dm", than, bearer(tok)));
    const r = await mo(tA, { giaoVienId: ids.GV });
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect([d.trangThai, d.taoMoi, typeof d.hoiThoaiId]).toEqual(["DANG_MO", true, "string"]);
    expect(d.id).toBe(d.hoiThoaiId); // V8.19: app đọc `id` (real-adapter moChatRieng) — bí danh cùng giá trị
    const lai = (await json(await mo(tA, { giaoVienId: ids.GV }))).data;
    expect([lai.hoiThoaiId, lai.taoMoi]).toEqual([d.hoiThoaiId, false]); // một cặp một hội thoại
    expect(await db.conversation.count({ where: { type: "DM_TEACHER_PARENT", participants: { some: { userId: ids.A } } } })).toBeGreaterThanOrEqual(1);
    // nhắn qua hội thoại riêng; hội thoại riêng hiện trong danh sách với loại RIENG_GIAO_VIEN
    expect((await gui(tA, d.hoiThoaiId, { noiDung: "Thưa cô, con xin nghỉ buổi mai ạ", khoaGuiLai: randomUUID() })).status).toBe(200);
    const ds2 = (await json(await ds(tA))).data.muc as Array<{ id: string; loai: string }>;
    expect(ds2.find((m) => m.id === d.hoiThoaiId)?.loai).toBe("RIENG_GIAO_VIEN");
    // B không vào được hội thoại riêng của A
    expect((await lay(tB, d.hoiThoaiId)).status).toBe(404);
    expect((await gui(tB, d.hoiThoaiId, { noiDung: "chen vào", khoaGuiLai: randomUUID() })).status).toBe(404);
    // giáo viên KHÔNG dạy con của B? (GV dạy cả hai lớp ⇒ B cũng được); người lạ / chính mình / id rỗng ⇒ 404 hoặc 400
    expect((await mo(tA, { giaoVienId: ids.B })).status).toBe(404); // phụ huynh khác, không phải giáo viên dạy con
    expect((await mo(tA, { giaoVienId: "khong-co-nguoi-nay" })).status).toBe(404);
    expect((await mo(tA, { giaoVienId: ids.A })).status).toBeGreaterThanOrEqual(400);
    for (const x of [{}, { giaoVienId: "" }, { giaoVienId: ids.GV, kind: "SALE_PARENT" }]) expect((await mo(tA, x)).status, JSON.stringify(x)).toBe(400);
    expect((await dmPost(req("POST", "/api/mobile/v1/chat/dm", { giaoVienId: ids.GV }))).status).toBe(401);
  });

  it("[CHAT-DB-11] danh sách giáo viên nhận tin", async () => {
    const gv = (tok: string) => gvGet(req("GET", "/api/mobile/v1/chat/teachers", undefined, bearer(tok)));
    const r = await gv(tA);
    expect(r.status).toBe(200);
    const muc = (await json(r)).data.muc as Array<{ giaoVienId: string; ten: string; lop: string[] }>;
    expect(muc.map((m) => m.giaoVienId)).toEqual([ids.GV]);
    expect(muc[0]!.lop.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(muc)).not.toMatch(/@seed|8496698|0966980|phone|email/i);
    // nhiều lớp cùng một giáo viên ⇒ vẫn MỘT dòng, gộp tên lớp
    const cv4 = await db.conversation.create({ data: { id: randomUUID(), type: "CLASS_GROUP", status: "ACTIVE", centerId: A("cs"), subjectType: "CLASS", subjectId: A("l3"), title: `${NS}lop-hai` } as never });
    await db.conversationParticipant.create({ data: { conversationId: cv4.id, userId: ids.GV!, role: "OWNER", derivedFrom: "CLASS_TEACHER" } as never });
    const pA = await db.conversationParticipant.create({ data: { conversationId: cv4.id, userId: ids.A!, role: "MEMBER", derivedFrom: "CLASS_STUDENT_PARENT" } as never });
    const m2 = (await json(await gv(tA))).data.muc as Array<{ giaoVienId: string; lop: string[] }>;
    expect(m2.length).toBe(1);
    expect(m2[0]!.lop).toContain(`${NS}lop-hai`);
    // rời nhóm lớp hai ⇒ tên lớp đó biến khỏi danh sách; nhóm lưu trữ ⇒ không tính
    await db.conversationParticipant.update({ where: { id: pA.id }, data: { leftAt: new Date() } });
    expect(((await json(await gv(tA))).data.muc[0] as { lop: string[] }).lop).not.toContain(`${NS}lop-hai`);
    await db.conversationParticipant.update({ where: { id: pA.id }, data: { leftAt: null } });
    await db.conversation.update({ where: { id: cv4.id }, data: { status: "ARCHIVED" } });
    expect(((await json(await gv(tA))).data.muc[0] as { lop: string[] }).lop).not.toContain(`${NS}lop-hai`);
    // nhà khác chỉ thấy giáo viên của nhóm mình; không đăng nhập 401; cờ tắt 404
    expect(((await json(await gv(tB))).data.muc as Array<{ giaoVienId: string }>).map((m) => m.giaoVienId)).toEqual([ids.GV]);
    expect((await gvGet(req("GET", "/x"))).status).toBe(401);
    process.env.MOBILE_CHAT_ENABLED = "false";
    try {
      expect((await gv(tA)).status).toBe(404);
    } finally {
      process.env.MOBILE_CHAT_ENABLED = "true";
    }
  });

  it("[CHAT-DB-09] cách ly: B không đọc/gửi/đọc-dấu/thu hồi trong hội thoại của A (HTTP-route)", async () => {
    const tinA = await tinGoc(CV, ids.A!, "tin riêng của A", { clientMsgId: randomUUID() });
    expect((await lay(tB, CV)).status).toBe(404);
    expect((await gui(tB, CV, { noiDung: "xin chào", khoaGuiLai: randomUUID() })).status).toBe(404);
    expect((await doc(tB, CV, { tinCuoiId: null })).status).toBe(404);
    expect((await thuHoiDelete(req("DELETE", `/api/mobile/v1/chat/conversations/${CV}/messages/${tinA.id}`, undefined, bearer(tB)), ctx(CV, { messageId: tinA.id }))).status).toBe(404);
    expect((await db.message.findUnique({ where: { id: tinA.id }, select: { deletedAt: true } }))?.deletedAt).toBeNull();
    expect((await lay("", CV)).status).toBe(401);
  });
});
