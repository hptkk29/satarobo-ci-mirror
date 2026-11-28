import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onParentRequestHandledNotif, registerYeuCauXuLyNotifHandlers } from "@/lib/_handlers/yeu-cau-xu-ly-notif";
import { dispatchPendingEvents } from "@/lib/events/dispatcher";
import { on } from "@/lib/events/registry";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { doiTrangThaiYeuCau, khoaSuKienDaXuLy } from "@/lib/yeu-cau-ph/da-xu-ly";

/**
 * [YCX-DB] V8.19 BR-REQ-02 — `doiTrangThaiYeuCau` trên Postgres thật (cùng helper bốn đường Bảo lưu / Học bù / duyệt bảo lưu / màn Yêu cầu dùng chung).
 *   [YCX-DB-01] PENDING→APPROVED ⇒ ĐÚNG MỘT DomainEvent `parent_request.handled` trong outbox, khoá = parent_request.handled:<id>:<handledAt>
 *   [YCX-DB-02] hai quản trị xử lý ĐỒNG THỜI (hai giao dịch thật) ⇒ một người thắng: một sự kiện, trạng thái của người thắng KHÔNG bị ghi đè
 *   [YCX-DB-03] sự kiện + thông báo: handler chạy hai lần (retry) ⇒ MỘT Notification, đúng học viên, không lộ phản hồi nhân viên
 *   [YCX-DB-04] giao dịch cuộn ngược ⇒ không có sự kiện, trạng thái cũ giữ nguyên (outbox cùng giao dịch)
 *   [YCX-DB-05] ghi lại cùng trạng thái / CANCELLED ⇒ không phát sự kiện mới
 *   [YCX-DB-07] V8.21 dispatcher THẬT: handler hỏng lần 1 ⇒ sự kiện KHÔNG mất (PENDING, attempts=1, lastError), lần 2 ⇒ DONE + đúng MỘT thông báo; tick thứ 3 không nhân đôi
 *   [YCX-DB-06] hàng loạt: chỉ dòng PENDING khớp `where` đổi; dòng của phụ huynh khác / đã xử lý KHÔNG bị đụng
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "ycx-";
const A = (k: string) => `${NS}${k}`;

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  await db.notification.deleteMany({ where: { OR: [{ dedupeKey: { startsWith: `parent_request.handled:${NS}` } }, { studentId: { startsWith: NS } }] } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `parent_request.handled:${NS}` } } });
  await db.parentRequest.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: us.map((u) => u.id) } } });
}
const sk = (id: string) => db.domainEvent.findMany({ where: { type: "parent_request.handled", dedupeKey: { startsWith: `parent_request.handled:${id}:` } }, select: { dedupeKey: true } });
const tao = (id: string, studentId: string, parentUserId: string, extra: Record<string, unknown> = {}) =>
  db.parentRequest.create({ data: { id: A(id), studentId, parentUserId, type: "MAKEUP", status: "PENDING", content: "Xin học bù", ...extra } as never });

describe.skipIf(!RUN)("[YCX-DB] ParentRequest đã xử lý ⇒ parent_request.handled — Postgres thật", () => {
  const u: Record<string, string> = {};
  beforeAll(async () => {
    await don();
    for (const k of ["a", "b"]) u[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: `8497${k === "a" ? "7700001" : "7700002"}`, password: "x", role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    await db.center.create({ data: { id: A("cs"), name: "CS YCX", slug: A("cs"), address: "Đ" } });
    await db.student.create({ data: { id: A("s1"), name: "An", parentUserId: u.a, centerId: A("cs") } as never });
    await db.student.create({ data: { id: A("s2"), name: "Bình", parentUserId: u.b, centerId: A("cs") } as never });
  }, 60_000);
  afterAll(don);

  it("[YCX-DB-01] PENDING→APPROVED ⇒ đúng MỘT sự kiện với khoá chuẩn", async () => {
    await tao("r1", A("s1"), u.a);
    const T = new Date();
    const n = await db.$transaction((tx) => doiTrangThaiYeuCau(tx, { id: A("r1"), status: "PENDING" }, { status: "APPROVED", handledAt: T, handledByName: "QL", response: "Bí mật nội bộ" }));
    expect(n).toBe(1);
    expect((await sk(A("r1"))).map((e) => e.dedupeKey)).toEqual([khoaSuKienDaXuLy(A("r1"), T)]);
  });

  it("[YCX-DB-02] hai quản trị đồng thời (giao dịch 1 GIỮ khoá dòng, giao dịch 2 đã đọc PENDING) ⇒ một sự kiện; quyết định người thắng không bị ghi đè", async () => {
    await tao("r2", A("s1"), u.a);
    let nha!: () => void;
    const cong = new Promise<void>((r) => (nha = r));
    // Giao dịch 1 ghi rồi GIỮ mở; giao dịch 2 bắt đầu SAU đó (đọc PENDING vì giao dịch 1 chưa commit), kẹt ở khoá dòng; thả giao dịch 1 ⇒ giao dịch 2 phải đổi 0 dòng.
    const t1 = db.$transaction(async (tx) => {
      const n = await doiTrangThaiYeuCau(tx, { id: A("r2"), status: "PENDING" }, { status: "APPROVED", handledAt: new Date(Date.now() - 5), handledByName: "QL1" });
      await cong;
      return n;
    });
    await new Promise((r) => setTimeout(r, 150));
    const t2 = db.$transaction((tx) => doiTrangThaiYeuCau(tx, { id: A("r2"), status: "PENDING" }, { status: "REJECTED", handledAt: new Date(), handledByName: "QL2" }));
    await new Promise((r) => setTimeout(r, 300));
    nha();
    const [x, y] = await Promise.all([t1, t2]);
    expect([x, y]).toEqual([1, 0]);
    const dong = await db.parentRequest.findUniqueOrThrow({ where: { id: A("r2") }, select: { status: true, handledByName: true } });
    expect([dong.status, dong.handledByName]).toEqual(["APPROVED", "QL1"]);
    expect(await sk(A("r2"))).toHaveLength(1);
  });

  it("[YCX-DB-03] retry handler ⇒ một Notification cho đúng học viên, không lộ phản hồi nhân viên", async () => {
    const ev = { id: A("ev"), type: "parent_request.handled", payload: { requestId: A("r1") } };
    await onParentRequestHandledNotif(ev);
    await onParentRequestHandledNotif(ev);
    const ds = await db.notification.findMany({ where: { dedupeKey: { startsWith: `parent_request.handled:${A("r1")}:` } }, select: { studentId: true, body: true } });
    expect(ds).toHaveLength(1);
    expect(ds[0]!.studentId).toBe(A("s1")); // không phải học viên của phụ huynh khác
    expect(ds[0]!.body).not.toContain("Bí mật");
  });

  it("[YCX-DB-04] cuộn ngược ⇒ không sự kiện, trạng thái cũ", async () => {
    await tao("r3", A("s1"), u.a);
    await expect(
      db.$transaction(async (tx) => {
        await doiTrangThaiYeuCau(tx, { id: A("r3") }, { status: "APPROVED", handledAt: new Date() });
        throw new Error("sau khi ghi, nghiệp vụ lỗi");
      }),
    ).rejects.toThrow();
    expect(await sk(A("r3"))).toHaveLength(0);
    expect((await db.parentRequest.findUniqueOrThrow({ where: { id: A("r3") }, select: { status: true } })).status).toBe("PENDING");
  });

  it("[YCX-DB-05] cùng trạng thái / CANCELLED ⇒ không phát thêm", async () => {
    const truoc = (await sk(A("r1"))).length;
    await db.$transaction((tx) => doiTrangThaiYeuCau(tx, { id: A("r1") }, { status: "APPROVED", handledAt: new Date(), response: "đổi lời phản hồi" }));
    expect((await sk(A("r1"))).length).toBe(truoc);
    await tao("r4", A("s1"), u.a);
    await db.$transaction((tx) => doiTrangThaiYeuCau(tx, { id: A("r4") }, { status: "CANCELLED", handledAt: new Date() }));
    expect(await sk(A("r4"))).toHaveLength(0);
  });

  it("[YCX-DB-06] hàng loạt: chỉ dòng PENDING khớp đổi, dòng khác không bị đụng", async () => {
    await tao("r5", A("s1"), u.a);
    await tao("r6", A("s2"), u.b);
    await tao("r7", A("s1"), u.a, { status: "REJECTED", handledAt: new Date(Date.now() - 86400000) });
    const n = await db.$transaction((tx) => doiTrangThaiYeuCau(tx, { studentId: A("s1"), type: "MAKEUP", status: "PENDING" }, { status: "REJECTED", handledAt: new Date() }));
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await db.parentRequest.findUniqueOrThrow({ where: { id: A("r5") }, select: { status: true } })).status).toBe("REJECTED");
    expect((await db.parentRequest.findUniqueOrThrow({ where: { id: A("r6") }, select: { status: true } })).status).toBe("PENDING"); // PH khác
    expect(await sk(A("r5"))).toHaveLength(1);
    expect(await sk(A("r6"))).toHaveLength(0);
    expect(await sk(A("r7"))).toHaveLength(0); // đã xử lý từ trước, không khớp where
  });

  it("[YCX-DB-07] dispatcher thật: một handler hỏng ⇒ sự kiện KHÔNG mất (retry) ⇒ lần sau DONE; thông báo vẫn đúng MỘT (dedupeKey)", async () => {
    registerYeuCauXuLyNotifHandlers();
    let lan = 0;
    on("parent_request.handled", async (e) => {
      // chỉ hỏng ĐÚNG MỘT LẦN và chỉ cho yêu cầu của ca này (các sự kiện của ca khác đang chờ trong cùng bảng)
      if (e.payload.requestId === A("r8") && lan++ === 0) throw new Error("handler phụ hỏng lần đầu"); // allSettled: handler thật vẫn chạy, sự kiện phải được thử lại
    });
    await tao("r8", A("s1"), u.a);
    const T = new Date();
    await db.$transaction((tx) => doiTrangThaiYeuCau(tx, { id: A("r8"), status: "PENDING" }, { status: "APPROVED", handledAt: T, handledByName: "QL" }));
    const dem = () => db.notification.count({ where: { dedupeKey: { startsWith: `parent_request.handled:${A("r8")}:` } } });
    const ev = () => db.domainEvent.findFirstOrThrow({ where: { dedupeKey: khoaSuKienDaXuLy(A("r8"), T) }, select: { status: true, attempts: true, lastError: true } });
    expect((await ev()).status).toBe("PENDING"); // commit xong, CHƯA ai gửi (đúng outbox)
    await dispatchPendingEvents({ flagOn: true, batchSize: 100_000 });
    const sau1 = await ev();
    expect([sau1.status, sau1.attempts]).toEqual(["PENDING", 1]); // có handler hỏng ⇒ KHÔNG đánh DONE, còn để thử lại
    expect(sau1.lastError).toContain("handler phụ hỏng lần đầu");
    expect(await dem()).toBe(1); // handler thật đã gửi
    await dispatchPendingEvents({ flagOn: true, batchSize: 100_000 }); // thử lại: handler phụ ổn, handler thật chạy lại ⇒ dedupe
    expect((await ev()).status).toBe("DONE");
    expect(await dem()).toBe(1); // KHÔNG nhân đôi
    await dispatchPendingEvents({ flagOn: true, batchSize: 100_000 }); // tick thừa
    expect(await dem()).toBe(1);
  });
});
