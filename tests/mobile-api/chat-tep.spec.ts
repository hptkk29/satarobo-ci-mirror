import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const kho = vi.hoisted(() => ({
  // `daoLanHai` / `hongLanHai`: mô phỏng ĐỐI TƯỢNG ĐỔI GIỮA HAI LẦN ĐỌC (đường app kiểm trước ở `kiemTepTruocKhiGui`, lõi gửi tin kiểm lại) — chứng minh lớp kiểm thứ hai có thật và ánh xạ đúng mã.
  doiTuong: new Map<string, { size: number; contentType: string; byte?: number[]; daoLanHai?: number[]; hongLanHai?: boolean }>(),
  lanDoc: new Map<string, number>(),
  lanHead: new Map<string, number>(),
  cauHinh: true,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/settings/service", async (goc) => ({ ...(await goc<typeof import("@/lib/settings/service")>()), getSetting: vi.fn(async () => false) }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});
// Kho chat GIẢ trong bộ nhớ — không gọi R2 thật. Mô phỏng: chưa cấu hình ⇒ ném (đúng như `getChatBucket`), URL ký chỉ là chuỗi thử.
vi.mock("@/lib/storage/chat-storage", () => ({
  ChatStorageConfigError: class extends Error {},
  getChatBucket: () => {
    if (!kho.cauHinh) throw new Error("R2_CHAT_BUCKET_NAME chưa đặt");
    return "bucket-chat-rieng-test";
  },
  isChatBucketConfigured: () => kho.cauHinh,
  signChatPutUrl: async (key: string, ct: string, ttl: number) => `https://r2.test.invalid/put/${encodeURIComponent(key)}?ct=${encodeURIComponent(ct)}&ttl=${ttl}`,
  signChatGetUrl: async (key: string, ttl: number) => `https://r2.test.invalid/get/${encodeURIComponent(key)}?ttl=${ttl}`,
  headChatObject: async (key: string) => {
    const n = (kho.lanHead.get(key) ?? 0) + 1;
    kho.lanHead.set(key, n);
    const o = kho.doiTuong.get(key);
    if (o?.hongLanHai && n >= 2) throw new Error("R2 down (lần hai)");
    return o ?? null;
  },
  // V8.19: byte đầu của đối tượng THẬT (mặc định = chữ ký PNG; ca «nội dung giả» ghi đè).
  docByteDauChat: async (key: string) => {
    const o = kho.doiTuong.get(key);
    const n = (kho.lanDoc.get(key) ?? 0) + 1;
    kho.lanDoc.set(key, n);
    if (o?.daoLanHai && n >= 2) return new Uint8Array(o.daoLanHai);
    return o ? new Uint8Array(o.byte ?? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) : null;
  },
}));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as urlGet } from "@/app/api/mobile/v1/chat/attachments/[attachmentId]/url/route";
import { POST as veTepPost } from "@/app/api/mobile/v1/chat/conversations/[conversationId]/attachments/tickets/route";
import { DELETE as thuHoiDelete } from "@/app/api/mobile/v1/chat/conversations/[conversationId]/messages/[messageId]/route";
import { GET as tinGet, POST as tinPost } from "@/app/api/mobile/v1/chat/conversations/[conversationId]/messages/route";
import { POST as dongYChat } from "@/app/api/mobile/v1/chat/policy/accept/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { resolveActor } from "@/lib/auth/actor";
import { sendChatMessageAsActor } from "@/lib/chat/messages";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [CHT] V8.18 G5 — ĐÍNH KÈM ẢNH TRONG CHAT (bọc domain web `lib/chat/attachments`), Postgres thật + kho chat GIẢ (không R2 thật).
 *   [CHT-01] vé tải lên: ảnh thật OK (khoá do SERVER dựng, URL PUT ký, không URL công khai); MIME khai lệch ruột tệp / tệp không phải ảnh / quá 10 MB / quá 5 tệp bị từ chối; người ngoài hội thoại 404; chế độ học sinh 403; kho chưa cấu hình 503
 *   [CHT-02] gửi tin kèm ảnh: chưa tải lên / sai cỡ / sai loại / khoá của hội thoại khác / path traversal / lặp khoá ⇒ 422; đúng ⇒ 200 + id đính kèm; tái dùng khoá ở tin khác ⇒ 422; gửi lại cùng khoaGuiLai ⇒ trungLap (không kiểm lại)
 *   [CHT-03] danh sách tin có tepDinhKem; người ngoài 404; thu hồi tin ⇒ không còn đính kèm trong danh sách VÀ không cấp được URL (404)
 *   [CHT-04] URL đọc: thành viên 5 phút + no-store; phụ huynh khác / id lạ / id sai dạng ⇒ cùng 404; chế độ học sinh ⇒ 403
 *   [CHT-05] chỉ ảnh không chữ được; rỗng hoàn toàn ⇒ 400; không có URL công khai (cdn/R2_PUBLIC_URL) ở bất kỳ phản hồi nào
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "cht-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.102.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
const A = (k: string) => `${NS}${k}`;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64");
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0]).toString("base64"); // "MZ" — tệp thực thi đổi tên .png

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

describe.skipIf(!RUN)("[CHT] đính kèm ảnh chat — Postgres thật + kho chat giả", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  let tHs = "";
  let CV = "";
  let CV2 = "";
  const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ conversationId: id, ...extra }) as never });
  const ve = (tok: string, id: string, than: unknown) => veTepPost(req("POST", `/x`, than, tok ? bearer(tok) : undefined), ctx(id));
  const gui = (tok: string, id: string, than: unknown) => tinPost(req("POST", `/x`, than, bearer(tok)), ctx(id));
  const lay = (tok: string, id: string) => tinGet(req("GET", `/x`, undefined, bearer(tok)), ctx(id));
  const url = (tok: string, id: string) => urlGet(req("GET", `/x`, undefined, bearer(tok)), { params: Promise.resolve({ attachmentId: id }) as never });
  const tepHopLe = (o: Partial<{ tenTep: string; loaiMime: string; kichThuoc: number; dauTepBase64: string }> = {}) => ({ tenTep: "anh.png", loaiMime: "image/png", kichThuoc: 1234, dauTepBase64: PNG, ...o });
  /** Đi đủ hai bước thật: xin vé → «tải lên» (đặt đối tượng vào kho giả) → trả đúng thứ app sẽ gửi. */
  async function taiLen(tok: string, conv: string, o: { size?: number; ct?: string; boQua?: boolean; byte?: number[] } = {}) {
    const r = await ve(tok, conv, { tep: [tepHopLe()] });
    expect(r.status).toBe(200);
    const v = (await json(r)).data.ve[0] as { duongDanKho: string };
    if (!o.boQua) kho.doiTuong.set(v.duongDanKho, { size: o.size ?? 1234, contentType: o.ct ?? "image/png", ...(o.byte ? { byte: o.byte } : {}) });
    return { duongDanKho: v.duongDanKho, tenTep: "anh.png", loaiMime: "image/png", kichThuoc: 1234 };
  }

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.MOBILE_CHAT_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, vai: "PARENT" | "TEACHER", sdt: string) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${vai === "TEACHER" ? "Cô" : "PH"} ${k}`, phone: sdt, password: hash, role: vai, roles: [vai] } as never, select: { id: true } })).id);
    await mk("A", "PARENT", "84966920001");
    await mk("B", "PARENT", "84966920002");
    await mk("GV", "TEACHER", "84966920003");
    await db.center.create({ data: { id: A("cs"), name: "Cơ sở CHT", slug: A("cs"), address: "Địa chỉ" } });
    await db.course.create({ data: { id: A("kh"), name: "Khoá CHT", slug: A("kh"), totalSessions: 12 } });
    for (const l of ["l1", "l2"]) await db.class.create({ data: { id: A(l), name: `Lớp ${l}`, classCode: A(l), courseId: A("kh"), centerId: A("cs"), status: "ACTIVE", isActive: true, startTime: "18:00", teacherId: ids.GV } as never });
    await db.student.create({ data: { id: A("s1"), name: "An", parentUserId: ids.A, centerId: A("cs") } as never });
    await db.student.create({ data: { id: A("s3"), name: "Cường", parentUserId: ids.B, centerId: A("cs") } as never });
    await db.enrollment.create({ data: { id: A("dk1"), studentId: A("s1"), classId: A("l1"), courseId: A("kh"), status: "ACTIVE", centerId: A("cs") } as never });
    await db.enrollment.create({ data: { id: A("dk3"), studentId: A("s3"), classId: A("l2"), courseId: A("kh"), status: "ACTIVE", centerId: A("cs") } as never });
    const hoiThoai = async (lop: string, parents: string[]) => {
      const c = await db.conversation.create({ data: { id: randomUUID(), type: "CLASS_GROUP", status: "ACTIVE", centerId: A("cs"), subjectType: "CLASS", subjectId: lop, title: `${NS}${lop}` } as never });
      await db.conversationParticipant.create({ data: { conversationId: c.id, userId: ids.GV!, role: "OWNER", derivedFrom: "CLASS_TEACHER" } as never });
      for (const p of parents) await db.conversationParticipant.create({ data: { conversationId: c.id, userId: p, role: "MEMBER", derivedFrom: "CLASS_STUDENT_PARENT" } as never });
      return c.id;
    };
    CV = await hoiThoai(A("l1"), [ids.A!]);
    CV2 = await hoiThoai(A("l2"), [ids.B!]);
    const dn = async (sdt: string, n: number) => {
      const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9c10-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      return ((await json(r)).data as { accessToken: string }).accessToken;
    };
    tA = await dn("0966920001", 1);
    tB = await dn("0966920002", 2);
    tHs = await dn("0966920001", 3);
    for (const t of [tA, tB, tHs]) {
      await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
      await dongYChat(req("POST", "/x", {}, bearer(t)));
    }
    expect((await codePost(req("POST", "/x", { ma: "4827", xacNhan: "4827" }, bearer(tHs)))).status).toBe(200);
    expect((await enterPost(req("POST", "/x", { studentId: A("s1") }, bearer(tHs)))).status).toBe(200);
  }, 120_000);
  afterAll(async () => {
    kho.doiTuong.clear();
    await don();
  });

  it("[CHT-01] vé tải lên: ảnh thật OK; MIME giả / không phải ảnh / quá cỡ / quá số tệp bị từ chối; người ngoài 404; học sinh 403; kho chưa cấu hình 503", async () => {
    const r = await ve(tA, CV, { tep: [tepHopLe(), tepHopLe({ tenTep: "../../etc/passwd.png" })] });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const d = (await json(r)).data;
    expect(d.ve).toHaveLength(2);
    for (const v of d.ve) {
      expect(v.duongDanKho).toMatch(new RegExp(`^chat-attachments/${CV}/\\d{4}-\\d{2}/[0-9a-f-]{36}\\.png$`));
      expect(v.duongDanKho).not.toMatch(/passwd|\.\./); // khoá KHÔNG nhúng tên tệp của người dùng
      expect(v.uploadUrl).toMatch(/^https:\/\/r2\.test\.invalid\/put\//);
      expect(v).toMatchObject({ phuongThuc: "PUT", hetHanSauGiay: 300, loaiMime: "image/png" });
    }
    expect(d.ve[1].tenTep).toBe("passwd.png"); // tên hiển thị đã làm sạch đường dẫn
    expect(await ma(await ve(tA, CV, { tep: [tepHopLe({ dauTepBase64: EXE })] }))).toEqual([415, "TEP_KHONG_HOP_LE"]); // tệp thực thi đổi tên .png
    expect(await ma(await ve(tA, CV, { tep: [tepHopLe({ loaiMime: "image/jpeg" })] }))).toEqual([415, "TEP_KHONG_HOP_LE"]); // MIME khai lệch ruột (PNG khai JPEG)
    expect(await ma(await ve(tA, CV, { tep: [tepHopLe({ loaiMime: "application/pdf" })] }))).toEqual([415, "TEP_KHONG_HOP_LE"]);
    expect(await ma(await ve(tA, CV, { tep: [tepHopLe({ kichThuoc: 10 * 1024 * 1024 + 1 })] }))).toEqual([413, "TEP_KHONG_HOP_LE"]);
    expect((await ve(tA, CV, { tep: Array.from({ length: 6 }, () => tepHopLe()) })).status).toBe(400); // lược đồ: tối đa 5
    expect((await ve(tA, CV, { tep: [{ ...tepHopLe(), duongDanKho: "chat-attachments/x" }] })).status).toBe(400); // client KHÔNG tự đặt khoá (strict)
    expect(await ma(await ve(tB, CV, { tep: [tepHopLe()] }))).toEqual([404, "NOT_FOUND"]); // phụ huynh khác nhà
    expect(await ma(await ve(tA, randomUUID(), { tep: [tepHopLe()] }))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await ve(tHs, CV, { tep: [tepHopLe()] }))).toEqual([403, "FORBIDDEN"]); // chế độ học sinh không dùng chat
    expect((await ve("", CV, { tep: [tepHopLe()] })).status).toBe(401);
    kho.cauHinh = false;
    try {
      expect(await ma(await ve(tA, CV, { tep: [tepHopLe()] }))).toEqual([503, "MEDIA_CHUA_SAN_SANG"]); // KHÔNG rơi về bucket công khai
    } finally {
      kho.cauHinh = true;
    }
  });

  it("[CHT-02] gửi tin kèm ảnh: kiểm lại kho/khoá/cỡ/loại; tái dùng khoá ⇒ 422; gửi lại cùng khoá ⇒ trungLap", async () => {
    const chuaTai = await taiLen(tA, CV, { boQua: true });
    expect(await ma(await gui(tA, CV, { noiDung: "ảnh", khoaGuiLai: randomUUID(), tepDinhKem: [chuaTai] }))).toEqual([422, "TEP_KHONG_HOP_LE"]); // chưa tải lên xong
    const saiCo = await taiLen(tA, CV, { size: 999 });
    expect(await ma(await gui(tA, CV, { noiDung: "ảnh", khoaGuiLai: randomUUID(), tepDinhKem: [saiCo] }))).toEqual([422, "TEP_KHONG_HOP_LE"]); // đối tượng có thật nhưng cỡ KHÁC lời khai
    const saiLoai = await taiLen(tA, CV, { ct: "text/html" });
    expect(await ma(await gui(tA, CV, { noiDung: "ảnh", khoaGuiLai: randomUUID(), tepDinhKem: [saiLoai] }))).toEqual([422, "TEP_KHONG_HOP_LE"]); // Content-Type thật khác khai
    // V8.19: Content-Type khai ĐÚNG (image/png) nhưng NỘI DUNG THẬT là HTML/chương trình ⇒ 422 (không tin Content-Type, không tin 16 byte app gửi lúc xin vé)
    const noiDungGia = await taiLen(tA, CV, { byte: [0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0x3c, 0x73, 0x63, 0x72, 0x69, 0x70] });
    expect(await ma(await gui(tA, CV, { noiDung: "ảnh", khoaGuiLai: randomUUID(), tepDinhKem: [noiDungGia] }))).toEqual([422, "TEP_KHONG_HOP_LE"]);
    const exeGia = await taiLen(tA, CV, { byte: [0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00] });
    expect(await ma(await gui(tA, CV, { noiDung: "ảnh", khoaGuiLai: randomUUID(), tepDinhKem: [exeGia] }))).toEqual([422, "TEP_KHONG_HOP_LE"]);
    const cua2 = await taiLen(tB, CV2);
    expect(await ma(await gui(tA, CV, { noiDung: "ảnh", khoaGuiLai: randomUUID(), tepDinhKem: [cua2] }))).toEqual([422, "TEP_KHONG_HOP_LE"]); // khoá của HỘI THOẠI KHÁC
    const sau = await taiLen(tA, CV);
    for (const xau of [`chat-attachments/${CV}/../${CV2}/x.png`, `${sau.duongDanKho.replace("chat-attachments", "public-media")}`, "../../etc/passwd", ""]) {
      expect((await gui(tA, CV, { noiDung: "ảnh", khoaGuiLai: randomUUID(), tepDinhKem: [{ ...sau, duongDanKho: xau }] })).status, xau).toBe(xau === "" ? 400 : 422);
    }
    expect(await ma(await gui(tA, CV, { noiDung: "ảnh", khoaGuiLai: randomUUID(), tepDinhKem: [sau, sau] }))).toEqual([422, "TEP_KHONG_HOP_LE"]); // lặp khoá trong một tin
    expect(await db.messageAttachment.count({ where: { message: { conversationId: CV } } })).toBe(0); // KHÔNG tin nào lọt
    const khoa = randomUUID();
    const ok = await gui(tA, CV, { noiDung: "Ảnh bài vẽ", khoaGuiLai: khoa, tepDinhKem: [sau] });
    expect(ok.status).toBe(200);
    const d = (await json(ok)).data;
    expect(d).toMatchObject({ noiDung: "Ảnh bài vẽ", trungLap: false });
    expect(d.tepDinhKem).toHaveLength(1);
    expect(d.tepDinhKem[0]).toMatchObject({ tenTep: "anh.png", loaiMime: "image/png", kichThuoc: 1234 });
    expect(JSON.stringify(d)).not.toMatch(/chat-attachments|duongDanKho|storagePath/); // không lộ khoá kho ra ngoài vé
    const dung = await db.messageAttachment.findFirstOrThrow({ where: { messageId: d.id }, select: { storagePath: true } });
    expect(dung.storagePath).toBe(sau.duongDanKho);
    // tái dùng cùng khoá cho TIN KHÁC ⇒ 422
    expect(await ma(await gui(tA, CV, { noiDung: "dùng lại", khoaGuiLai: randomUUID(), tepDinhKem: [sau] }))).toEqual([422, "TEP_KHONG_HOP_LE"]);
    // gửi lại ĐÚNG khoá idempotent (mạng chập chờn) ⇒ trả tin cũ, không kiểm lại, không nhân đôi
    const lai = await gui(tA, CV, { noiDung: "Ảnh bài vẽ", khoaGuiLai: khoa, tepDinhKem: [sau] });
    expect(lai.status).toBe(200);
    expect((await json(lai)).data).toMatchObject({ trungLap: true, id: d.id });
    expect(await db.messageAttachment.count({ where: { message: { conversationId: CV } } })).toBe(1);
  });

  it("[CHT-03] danh sách tin có tepDinhKem; người ngoài 404; thu hồi tin ⇒ hết đính kèm và không cấp được URL", async () => {
    const t = await taiLen(tA, CV);
    const g = (await json(await gui(tA, CV, { noiDung: "", khoaGuiLai: randomUUID(), tepDinhKem: [t] }))).data; // CHỈ ảnh, không chữ
    let ds = (await json(await lay(tA, CV))).data.tin as Array<{ id: string; tepDinhKem: Array<{ id: string }> }>;
    const tin = ds.find((x) => x.id === g.id)!;
    expect(tin.tepDinhKem).toHaveLength(1);
    expect(await ma(await lay(tB, CV))).toEqual([404, "NOT_FOUND"]);
    expect((await url(tA, tin.tepDinhKem[0]!.id)).status).toBe(200);
    const h = await thuHoiDelete(req("DELETE", "/x", undefined, bearer(tA)), ctx(CV, { messageId: g.id }));
    expect(h.status).toBe(200);
    ds = (await json(await lay(tA, CV))).data.tin;
    expect(ds.find((x) => x.id === g.id)!.tepDinhKem).toEqual([]);
    expect(await ma(await url(tA, tin.tepDinhKem[0]!.id))).toEqual([404, "NOT_FOUND"]); // tin đã gỡ ⇒ không cấp URL mới (và không lộ «đã gỡ»)
  });

  it("[CHT-04] URL đọc: thành viên 5 phút + no-store; người khác / id lạ / id sai dạng ⇒ 404; học sinh 403", async () => {
    const t = await taiLen(tA, CV);
    const g = (await json(await gui(tA, CV, { noiDung: "xem", khoaGuiLai: randomUUID(), tepDinhKem: [t] }))).data;
    const id = g.tepDinhKem[0].id as string;
    const r = await url(tA, id);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const d = (await json(r)).data;
    expect(d).toMatchObject({ hetHanSauGiay: 300, tenTep: "anh.png", loaiMime: "image/png" });
    expect(d.url).toMatch(/^https:\/\/r2\.test\.invalid\/get\//);
    expect(await ma(await url(tB, id))).toEqual([404, "NOT_FOUND"]); // phụ huynh nhà khác (không phải thành viên)
    expect(await ma(await url(tA, randomUUID()))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await url(tA, "khong-phai-uuid"))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await url(tHs, id))).toEqual([403, "FORBIDDEN"]);
    expect((await urlGet(req("GET", "/x"), { params: Promise.resolve({ attachmentId: id }) as never })).status).toBe(401);
    // rời nhóm (web gỡ thành viên) ⇒ mất quyền NGAY
    await db.conversationParticipant.update({ where: { conversationId_userId: { conversationId: CV, userId: ids.A! } }, data: { leftAt: new Date() } });
    expect(await ma(await url(tA, id))).toEqual([404, "NOT_FOUND"]);
    await db.conversationParticipant.update({ where: { conversationId_userId: { conversationId: CV, userId: ids.A! } }, data: { leftAt: null } });
  });

  it("[CHT-05] chỉ ảnh không chữ được; rỗng hoàn toàn 400; không có URL công khai ở bất kỳ phản hồi nào", async () => {
    const t = await taiLen(tA, CV);
    const r = await gui(tA, CV, { noiDung: "", khoaGuiLai: randomUUID(), tepDinhKem: [t] });
    expect(r.status).toBe(200);
    expect((await gui(tA, CV, { noiDung: "", khoaGuiLai: randomUUID() })).status).toBe(400);
    expect((await gui(tA, CV, { noiDung: "", khoaGuiLai: randomUUID(), tepDinhKem: [] })).status).toBe(400);
    const tatCa = JSON.stringify([(await json(await ve(tA, CV, { tep: [tepHopLe()] }))).data, (await json(await lay(tA, CV))).data]);
    expect(tatCa).not.toMatch(/cdn\.satarobo|R2_PUBLIC_URL|r2\.dev|public-media/);
  });

  it("[CHT-06] SEC-06 — ĐƯỜNG WEB (lõi gửi tin dùng chung, cờ BẬT): HTML đổi tên .png bị TỪ CHỐI, không tạo tin; sai cỡ / chưa tải / ảnh thật thì đúng", async () => {
    process.env.CHAT_XAC_MINH_TEP_ENABLED = "true";
    try {
      await chatXacMinhBat();
    } finally {
      delete process.env.CHAT_XAC_MINH_TEP_ENABLED;
    }
  });

  async function chatXacMinhBat() {
    const HTML = Array.from("<html><script>alert(1)</script>").map((c) => c.charCodeAt(0));
    const actor = await resolveActor(ids.A!);
    const webGui = async (t: { duongDanKho: string; tenTep: string; loaiMime: string; kichThuoc: number }) =>
      sendChatMessageAsActor(actor!, "PH A", { conversationId: CV, body: "ảnh", clientMsgId: randomUUID(), attachments: [{ storagePath: t.duongDanKho, fileName: t.tenTep, mimeType: t.loaiMime, sizeBytes: t.kichThuoc }] });
    const truoc = await db.message.count({ where: { conversationId: CV } });
    const gia = await taiLen(tA, CV, { byte: HTML }); // Content-Type + cỡ KHỚP, chỉ ruột là HTML
    const r1 = await webGui(gia);
    expect([r1.ok, r1.ok ? null : r1.error.code, r1.ok ? null : r1.error.field]).toEqual([false, "ATTACHMENT_CONTENT_INVALID", "attachments"]);
    const saiCo = await taiLen(tA, CV, { size: 10 });
    const r2 = await webGui(saiCo);
    expect([r2.ok, r2.ok ? null : r2.error.code]).toEqual([false, "ATTACHMENT_SIZE_MISMATCH"]);
    const chua = await taiLen(tA, CV, { boQua: true });
    const r3 = await webGui(chua);
    expect([r3.ok, r3.ok ? null : r3.error.code]).toEqual([false, "ATTACHMENT_NOT_UPLOADED"]);
    expect(await db.message.count({ where: { conversationId: CV } })).toBe(truoc); // không tin nào lọt
    expect(await db.messageAttachment.count({ where: { storagePath: { in: [gia.duongDanKho, saiCo.duongDanKho, chua.duongDanKho] } } })).toBe(0);
    // đối chứng DƯƠNG: ảnh thật gửi được qua đường web
    const that = await taiLen(tA, CV);
    const r4 = await webGui(that);
    expect(r4.ok).toBe(true);
    expect(await db.message.count({ where: { conversationId: CV } })).toBe(truoc + 1);
  }

  it("[CHT-06b] SEC-06 — cờ TẮT (mặc định, hành vi PROD hiện tại): đường WEB giữ hành vi cũ (KHÔNG hỏi kho) — ghi lại để biết lỗ còn hở tới khi bật cờ; đường APP vẫn từ chối ruột giả (kiểm bắt buộc)", async () => {
    delete process.env.CHAT_XAC_MINH_TEP_ENABLED;
    const HTML = Array.from("<html><script>alert(1)</script>").map((c) => c.charCodeAt(0));
    const actor = await resolveActor(ids.A!);
    const gia = await taiLen(tA, CV, { byte: HTML });
    const web = await sendChatMessageAsActor(actor!, "PH A", { conversationId: CV, body: "ảnh", clientMsgId: randomUUID(), attachments: [{ storagePath: gia.duongDanKho, fileName: gia.tenTep, mimeType: gia.loaiMime, sizeBytes: gia.kichThuoc }] });
    expect(web.ok).toBe(true); // cờ tắt ⇒ web chưa chặn (lỗ SEC-06 còn mở ở PROD cho tới khi bật cờ)
    const giaApp = await taiLen(tA, CV, { byte: HTML });
    expect(await ma(await gui(tA, CV, { noiDung: "ảnh", khoaGuiLai: randomUUID(), tepDinhKem: [giaApp] }))).toEqual([422, "TEP_KHONG_HOP_LE"]);
  });

  it("[CHT-07] SEC-06 hàng rào THỨ HAI ở lõi gửi tin (đối tượng đổi giữa hai lần đọc): ruột đổi thành HTML ⇒ 422 TEP_KHONG_HOP_LE; kho sập ở lần đọc thứ hai ⇒ 503 MEDIA_CHUA_SAN_SANG; không tin nào lọt", async () => {
    process.env.CHAT_XAC_MINH_TEP_ENABLED = "true";
    try {
    const truoc = await db.message.count({ where: { conversationId: CV } });
    const dao = await taiLen(tA, CV);
    kho.doiTuong.get(dao.duongDanKho)!.daoLanHai = Array.from("<html><script>x</script>").map((c) => c.charCodeAt(0));
    expect(await ma(await gui(tA, CV, { noiDung: "ảnh", khoaGuiLai: randomUUID(), tepDinhKem: [dao] }))).toEqual([422, "TEP_KHONG_HOP_LE"]);
    const hong = await taiLen(tA, CV);
    kho.doiTuong.get(hong.duongDanKho)!.hongLanHai = true;
    expect(await ma(await gui(tA, CV, { noiDung: "ảnh", khoaGuiLai: randomUUID(), tepDinhKem: [hong] }))).toEqual([503, "MEDIA_CHUA_SAN_SANG"]);
    expect(await db.message.count({ where: { conversationId: CV } })).toBe(truoc);
    } finally {
      delete process.env.CHAT_XAC_MINH_TEP_ENABLED;
    }
  });
});
