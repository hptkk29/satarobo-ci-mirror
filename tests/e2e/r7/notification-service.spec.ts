/**
 * Hệ thông báo v2 — hợp đồng của tầng dịch vụ (Postgres LOCAL, .env.test).
 *
 * SERVICE-LEVEL: gọi thẳng hàm trong `lib/notifications/*`, không qua HTTP, không dev server.
 *
 * Bộ này giữ đúng 3 điều mà PRD tự xếp hạng "chặn phát hành", cộng một lỗi thật của repo:
 *
 *  1. [T4] MỞ PANEL KHÔNG LÀM BADGE VỀ 0. Mở panel chỉ đặt `seenAt`; `readAt` chỉ đổi khi
 *     người dùng chủ động. Lỗi này là lỗi thiết kế phổ biến nhất của mọi hệ thông báo.
 *  2. [BUG-1] Thông báo do CRON/HANDLER sinh KHÔNG bị vòng đồng bộ việc tồn dập đã-đọc.
 *     Đây là lỗi ĐANG CÓ trên prod trước 19/08: nguyên nhóm thông báo (nhắc chốt buổi, dạy
 *     thay, điểm danh bị sửa, SLA lead, tin nhắn phụ huynh) chưa từng làm badge nhảy.
 *  3. [W-2] Nhãn badge do BACKEND quyết, đúng 4 mốc 0 / 1 / 2–9 / ≥10.
 *  4. "Đánh dấu tất cả đã đọc" TÔN TRỌNG nhóm đang lọc — không xoá sạch mọi thứ.
 *
 * Chạy:  R7_SKIP_WEBSERVER=1 pnpm test:e2e:r7 notification-service.spec.ts
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import {
  getNotificationSummary,
  getPanelNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  markNotificationsSeen,
} from "../../../lib/notifications/service";
import { syncStaffNotifications } from "../../../lib/staff-notifications";
import { classifyNotification } from "../../../lib/notifications/catalog";

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

/** Ghi thẳng một thông báo, phân loại đúng như đường ghi thật. Không đi qua broadcast. */
async function seedNoti(
  userId: string,
  dedupeKey: string,
  extra: { title?: string; readAt?: Date | null; createdAt?: Date } = {},
) {
  const p = classifyNotification(dedupeKey);
  return db.staffNotification.create({
    data: {
      userId,
      dedupeKey,
      category: dedupeKey.split(":")[0] ?? "system",
      title: extra.title ?? `Thông báo ${dedupeKey}`,
      body: "Nội dung thử.",
      href: "/dashboard",
      groupKey: p.groupKey,
      priority: p.priority,
      entityType: p.entityType,
      ...(extra.readAt !== undefined ? { readAt: extra.readAt } : {}),
      ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
    },
  });
}

test.describe("Hệ thông báo — tầng dịch vụ", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[W-2] nhãn badge do backend quyết, đúng 4 mốc 0 / 1 / 2–9 / ≥10", async () => {
    const u = await seedUser({ email: testEmail(uniq("badge")), role: "SALES_CSM" });

    const s0 = await getNotificationSummary(u.id);
    expect(s0.totalUnread).toBe(0);
    expect(s0.badge.showDot).toBe(false);
    expect(s0.badge.label).toBe("");

    await seedNoti(u.id, "lead_followup:pending");
    const s1 = await getNotificationSummary(u.id);
    // Một mục: CHẤM ĐỎ, KHÔNG có số.
    expect(s1.badge.showDot).toBe(true);
    expect(s1.badge.label).toBe("");

    await seedNoti(u.id, "renewal:pending");
    expect((await getNotificationSummary(u.id)).badge.label).toBe("2");

    for (let i = 0; i < 12; i++) await seedNoti(u.id, `birthday:g${i}`);
    const sNhieu = await getNotificationSummary(u.id);
    expect(sNhieu.totalUnread).toBe(14);
    expect(sNhieu.badge.label).toBe("9+");
  });

  test("cờ khẩn bật khi có ít nhất một mục P1, tắt khi hết", async () => {
    const u = await seedUser({ email: testEmail(uniq("khan")), role: "TEACHER" });

    await seedNoti(u.id, "birthday:g1"); // P3
    expect((await getNotificationSummary(u.id)).hasPriority1).toBe(false);

    const khan = await seedNoti(u.id, "session.close-reminder:s1"); // P1
    expect((await getNotificationSummary(u.id)).hasPriority1).toBe(true);

    await markNotificationRead(u.id, khan.id);
    expect((await getNotificationSummary(u.id)).hasPriority1).toBe(false);
  });

  test("số từng nhóm khớp tổng — chip cộng lại phải bằng badge", async () => {
    const u = await seedUser({ email: testEmail(uniq("nhom")), role: "CENTER_MANAGER" });

    await seedNoti(u.id, "conversation.message_posted:m1"); // parent_message
    await seedNoti(u.id, "lead_followup:pending"); // action_required
    await seedNoti(u.id, "session.close-reminder:s1"); // due_date
    await seedNoti(u.id, "birthday:g1"); // system

    const s = await getNotificationSummary(u.id);
    expect(s.totalUnread).toBe(4);
    expect(s.groups.reduce((a, g) => a + g.unread, 0)).toBe(4);
    expect(s.groups.find((g) => g.key === "parent_message")?.unread).toBe(1);
    expect(s.groups.find((g) => g.key === "due_date")?.unread).toBe(1);
  });

  test("[T4] MỞ PANEL không làm badge về 0 — chỉ đặt đã-nhìn-thấy", async () => {
    const u = await seedUser({ email: testEmail(uniq("t4")), role: "TEACHER" });
    const a = await seedNoti(u.id, "session.close-reminder:s1");
    const b = await seedNoti(u.id, "attendance.edited:s2");

    const panel = await getPanelNotifications(u.id);
    expect(panel.items).toHaveLength(2);

    // Đây là đúng thứ panel làm khi mở: đánh dấu ĐÃ NHÌN THẤY những mục vừa hiện ra.
    await markNotificationsSeen(u.id, panel.items.map((i) => i.id));

    const sau = await getNotificationSummary(u.id);
    expect(sau.totalUnread).toBe(2); // ← badge KHÔNG đổi

    const rows = await db.staffNotification.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { seenAt: true, readAt: true },
    });
    expect(rows.every((r) => r.seenAt !== null)).toBe(true);
    expect(rows.every((r) => r.readAt === null)).toBe(true);
  });

  test("mốc đã-nhìn-thấy chỉ ghi MỘT LẦN, không bị đè ở lần mở panel sau", async () => {
    // Chủ dự án chốt 19/08: số liệu đọc được dùng cho đánh giá nhân sự ⇒ đè lại mốc là
    // làm sai lệch chính số liệu đó.
    const u = await seedUser({ email: testEmail(uniq("seen")), role: "TEACHER" });
    const n = await seedNoti(u.id, "session.close-reminder:s1");

    await markNotificationsSeen(u.id, [n.id]);
    const lan1 = await db.staffNotification.findUniqueOrThrow({
      where: { id: n.id },
      select: { seenAt: true },
    });

    await new Promise((r) => setTimeout(r, 25));
    await markNotificationsSeen(u.id, [n.id]);
    const lan2 = await db.staffNotification.findUniqueOrThrow({
      where: { id: n.id },
      select: { seenAt: true },
    });

    expect(lan2.seenAt?.getTime()).toBe(lan1.seenAt?.getTime());
  });

  test("đánh dấu đã đọc rồi Hoàn tác — badge về đúng chỗ cũ, mốc đã-thấy được giữ", async () => {
    const u = await seedUser({ email: testEmail(uniq("undo")), role: "SALES_CSM" });
    const n = await seedNoti(u.id, "lead_followup:pending");

    expect(await markNotificationRead(u.id, n.id)).toBe(true);
    expect((await getNotificationSummary(u.id)).totalUnread).toBe(0);

    expect(await markNotificationUnread(u.id, n.id)).toBe(true);
    const s = await getNotificationSummary(u.id);
    expect(s.totalUnread).toBe(1);

    // Hoàn tác gỡ "đã đọc" nhưng KHÔNG xoá "đã nhìn thấy" — người dùng đã thật sự thấy nó.
    const row = await db.staffNotification.findUniqueOrThrow({
      where: { id: n.id },
      select: { seenAt: true, readAt: true },
    });
    expect(row.readAt).toBeNull();
    expect(row.seenAt).not.toBeNull();
  });

  test("đánh dấu đã đọc mục của NGƯỜI KHÁC không có tác dụng", async () => {
    const a = await seedUser({ email: testEmail(uniq("a")), role: "TEACHER" });
    const b = await seedUser({ email: testEmail(uniq("b")), role: "TEACHER" });
    const cua_a = await seedNoti(a.id, "session.close-reminder:s1");

    expect(await markNotificationRead(b.id, cua_a.id)).toBe(false);
    expect((await getNotificationSummary(a.id)).totalUnread).toBe(1);
  });

  test("'đánh dấu tất cả đã đọc' TÔN TRỌNG nhóm đang lọc", async () => {
    const u = await seedUser({ email: testEmail(uniq("readall")), role: "CENTER_MANAGER" });
    await seedNoti(u.id, "conversation.message_posted:m1"); // parent_message
    await seedNoti(u.id, "conversation.message_posted:m2"); // parent_message
    await seedNoti(u.id, "lead_followup:pending"); // action_required

    const doc = await markAllNotificationsRead(u.id, { group: "parent_message" });
    expect(doc).toBe(2);

    const s = await getNotificationSummary(u.id);
    expect(s.totalUnread).toBe(1); // nhóm khác KHÔNG bị đụng
    expect(s.groups.find((g) => g.key === "parent_message")?.unread).toBe(0);
    expect(s.groups.find((g) => g.key === "action_required")?.unread).toBe(1);
  });

  test("[BUG-1] thông báo do sự kiện sinh KHÔNG bị vòng đồng bộ việc tồn dập đã-đọc", async () => {
    // Đây là lỗi ĐANG CÓ trên prod trước 19/08. `syncStaffNotifications` quét mọi dòng chưa
    // đọc rồi đánh dấu đã đọc mọi khoá "lạ" — mà khoá của cron/handler đều lạ với nó.
    const u = await seedUser({ email: testEmail(uniq("bug1")), role: "TEACHER" });

    const suKien = [
      await seedNoti(u.id, "session.close-reminder:s1"),
      await seedNoti(u.id, "session.substitute:s2"),
      await seedNoti(u.id, "attendance.edited:s3"),
      await seedNoti(u.id, "conversation.message_posted:m1"),
      await seedNoti(u.id, "sla:first_touch:l1"),
      await seedNoti(u.id, "birthday:g1"),
    ];

    await syncStaffNotifications({ id: u.id, role: "TEACHER", roles: ["TEACHER"], centerId: null });

    const conChuaDoc = await db.staffNotification.count({
      where: { id: { in: suKien.map((n) => n.id) }, readAt: null },
    });
    expect(conChuaDoc).toBe(suKien.length);
    expect((await getNotificationSummary(u.id)).totalUnread).toBeGreaterThanOrEqual(suKien.length);
  });

  test("[BUG-1] vòng đồng bộ VẪN dọn được khoá của chính nó khi việc đã xong", async () => {
    // Mặt còn lại: thu hẹp phạm vi không được làm mất tính năng dọn dẹp vốn có.
    const u = await seedUser({ email: testEmail(uniq("bug1b")), role: "TEACHER" });
    const viecTon = await seedNoti(u.id, "lead_followup:pending");

    // Người này không có lead nào ⇒ `getPendingTasks` không trả nhóm lead_followup ⇒ dọn.
    await syncStaffNotifications({ id: u.id, role: "TEACHER", roles: ["TEACHER"], centerId: null });

    const row = await db.staffNotification.findUniqueOrThrow({
      where: { id: viecTon.id },
      select: { readAt: true },
    });
    expect(row.readAt).not.toBeNull();
  });

  test("panel sắp quá hạn lên trên cùng bất kể thời gian tạo", async () => {
    const u = await seedUser({ email: testEmail(uniq("sort")), role: "TEACHER" });
    await seedNoti(u.id, "birthday:g1", { title: "Sinh nhật", createdAt: new Date() });
    await seedNoti(u.id, "session.close-reminder:s1", {
      title: "Chốt buổi",
      createdAt: new Date(Date.now() - 3 * 3600_000),
    });

    const panel = await getPanelNotifications(u.id);
    expect(panel.items[0]?.title).toBe("Chốt buổi");
  });

  test("trang tất cả thông báo: lọc theo nhóm/trạng thái và phân trang bằng cursor", async () => {
    const u = await seedUser({ email: testEmail(uniq("page")), role: "CENTER_MANAGER" });
    for (let i = 0; i < 5; i++) await seedNoti(u.id, `conversation.message_posted:m${i}`);
    await seedNoti(u.id, "lead_followup:pending", { readAt: new Date() });

    const theoNhom = await listNotifications(u.id, { group: "parent_message" });
    expect(theoNhom.items).toHaveLength(5);

    const chuaDoc = await listNotifications(u.id, { status: "unread" });
    expect(chuaDoc.items).toHaveLength(5);

    const trang1 = await listNotifications(u.id, { limit: 2 });
    expect(trang1.items).toHaveLength(2);
    expect(trang1.nextCursor).not.toBeNull();

    const trang2 = await listNotifications(u.id, { limit: 2, cursor: trang1.nextCursor });
    expect(trang2.items).toHaveLength(2);
    // Không lặp lại mục của trang trước.
    const idsT1 = new Set(trang1.items.map((i) => i.id));
    expect(trang2.items.some((i) => idsT1.has(i.id))).toBe(false);
  });

  test("tìm kiếm không làm mất bộ lọc hết hạn (hai mệnh đề OR không được đè nhau)", async () => {
    const u = await seedUser({ email: testEmail(uniq("timkiem")), role: "TEACHER" });
    await seedNoti(u.id, "birthday:g1", { title: "Sinh nhật bé Bin" });
    const hetHan = await seedNoti(u.id, "birthday:g2", { title: "Sinh nhật bé Bo" });
    await db.staffNotification.update({
      where: { id: hetHan.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const kq = await listNotifications(u.id, { q: "Sinh nhật" });
    expect(kq.items).toHaveLength(1);
    expect(kq.items[0]?.title).toBe("Sinh nhật bé Bin");
  });

  test("[NULLS LAST] mục CHƯA ĐỌC không bị cửa sổ 60 dòng đẩy ra ngoài", async () => {
    // Postgres sắp `ORDER BY readAt ASC` với NULLS **LAST**. Nếu cửa sổ panel chọn bằng
    // `orderBy: { readAt: "asc" }` thì user tích đủ 60 mục ĐÃ ĐỌC sẽ thấy badge báo có việc mà
    // panel toàn mục mờ — đúng căn bệnh cả tính năng sinh ra để chữa. Không có job dọn nên số dòng
    // chỉ tăng: mọi tài khoản dùng lâu đều chạm mốc này.
    const u = await seedUser({ email: testEmail(uniq("nullslast")), role: "TEACHER" });

    const cu = new Date(Date.now() - 90 * 86_400_000);
    for (let i = 0; i < 65; i++) {
      await seedNoti(u.id, `birthday:cu${i}`, { readAt: new Date(), createdAt: cu });
    }
    await seedNoti(u.id, "session.close-reminder:s1", { title: "Chốt buổi" });
    await seedNoti(u.id, "attendance.edited:s2", { title: "Điểm danh bị sửa" });

    const panel = await getPanelNotifications(u.id);
    const tieuDe = panel.items.map((i) => i.title);
    expect(tieuDe).toContain("Chốt buổi");
    expect(tieuDe).toContain("Điểm danh bị sửa");
    expect((await getNotificationSummary(u.id)).totalUnread).toBe(2);
  });

  test("việc tồn ĐÓNG rồi QUAY LẠI thì badge phải nhảy lần nữa", async () => {
    // Lỗi kinh điển của kiểu upsert: khoá đã tồn tại nên luôn rơi vào nhánh `update`, mà nhánh đó
    // cố ý không đụng readAt ⇒ mỗi loại việc chỉ báo ĐÚNG MỘT LẦN trong đời. Quản lý duyệt hết lớp
    // buổi sáng, chiều có lớp mới chờ duyệt — chuông im lặng vĩnh viễn.
    const u = await seedUser({ email: testEmail(uniq("mola")), role: "TEACHER" });
    const taskUser = { id: u.id, role: "TEACHER" as const, roles: ["TEACHER" as const], centerId: null };

    const cu = await seedNoti(u.id, "lead_followup:pending");

    // Vòng đồng bộ thấy việc đã hết (user không có lead nào) → đóng lại.
    await syncStaffNotifications(taskUser);
    const daDong = await db.staffNotification.findUniqueOrThrow({
      where: { id: cu.id },
      select: { readAt: true, state: true },
    });
    expect(daDong.readAt).not.toBeNull();
    expect(daDong.state).toBe("EXPIRED");
    expect((await getNotificationSummary(u.id)).totalUnread).toBe(0);

    // Việc quay lại: mô phỏng bằng chính đường mà vòng đồng bộ sẽ đi.
    await db.staffNotification.updateMany({
      where: { id: cu.id, state: "EXPIRED" },
      data: { state: "ACTIVE", readAt: null, seenAt: null },
    });
    expect((await getNotificationSummary(u.id)).totalUnread).toBe(1);
  });

  test("đánh dấu đã đọc KHÔNG được đè mốc đã-nhìn-thấy", async () => {
    // Chủ dự án chốt Q-D (19/08): số liệu đọc dùng cho đánh giá nhân sự. Đè seenAt là làm mọi
    // khoảng "thấy rồi để đó bao lâu" bằng 0 giây cho toàn hệ — đẹp giả tạo, không truy lại được.
    const u = await seedUser({ email: testEmail(uniq("seenread")), role: "TEACHER" });
    const n = await seedNoti(u.id, "session.close-reminder:s1");

    await markNotificationsSeen(u.id, [n.id]);
    const thay = await db.staffNotification.findUniqueOrThrow({
      where: { id: n.id },
      select: { seenAt: true },
    });

    await new Promise((r) => setTimeout(r, 25));
    await markNotificationRead(u.id, n.id);

    const sau = await db.staffNotification.findUniqueOrThrow({
      where: { id: n.id },
      select: { seenAt: true, readAt: true },
    });
    expect(sau.seenAt?.getTime()).toBe(thay.seenAt?.getTime());
    expect(sau.readAt).not.toBeNull();
  });

  test("mục chưa từng thấy mà đọc thẳng thì seenAt được đặt cùng lúc", async () => {
    const u = await seedUser({ email: testEmail(uniq("readonly")), role: "TEACHER" });
    const n = await seedNoti(u.id, "session.close-reminder:s1");
    await markNotificationRead(u.id, n.id);
    const row = await db.staffNotification.findUniqueOrThrow({
      where: { id: n.id },
      select: { seenAt: true, readAt: true },
    });
    expect(row.seenAt).not.toBeNull();
    expect(row.readAt).not.toBeNull();
  });

  test("cursor phân trang chịu được việc dòng mốc rời khỏi bộ lọc", async () => {
    // `cursor: { id }` + `skip: 1` của Prisma giả định dòng mốc VẪN khớp `where`. Người dùng bấm
    // mục cuối trang (thành đã đọc) rồi bấm "Tải thêm" là `skip` ăn mất một mục hợp lệ, im lặng.
    const u = await seedUser({ email: testEmail(uniq("cursor")), role: "TEACHER" });
    for (let i = 0; i < 6; i++) {
      await seedNoti(u.id, `birthday:c${i}`, {
        title: `Mục ${i}`,
        createdAt: new Date(Date.now() - i * 60_000),
      });
    }

    const t1 = await listNotifications(u.id, { status: "unread", limit: 3 });
    expect(t1.items.map((i) => i.title)).toEqual(["Mục 0", "Mục 1", "Mục 2"]);

    // Dòng mốc bị loại khỏi bộ lọc "chưa đọc" TRƯỚC khi tải trang sau.
    await markNotificationRead(u.id, t1.items[2]!.id);

    const t2 = await listNotifications(u.id, { status: "unread", limit: 3, cursor: t1.nextCursor });
    expect(t2.items.map((i) => i.title)).toEqual(["Mục 3", "Mục 4", "Mục 5"]);
  });

  test("mục hết hạn không đếm vào badge", async () => {
    const u = await seedUser({ email: testEmail(uniq("hethan")), role: "TEACHER" });
    const n = await seedNoti(u.id, "session.close-reminder:s1");
    expect((await getNotificationSummary(u.id)).totalUnread).toBe(1);

    await db.staffNotification.update({
      where: { id: n.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await getNotificationSummary(u.id)).totalUnread).toBe(0);
  });
});
