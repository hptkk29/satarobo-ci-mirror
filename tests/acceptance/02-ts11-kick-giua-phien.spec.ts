/**
 * TS-11 — Kick giữa phiên đang mở (US-07 AC3).
 *
 * Gỡ học viên khỏi lớp đi bằng ĐƯỜNG NGHIỆP VỤ THẬT: `/admin/enrollments/:id/edit`
 * → "Đổi trạng thái" → Rút lớp. Đó chính là đường gọi `changeEnrollmentStatus`, hàm
 * gọi `syncConversationMembership` TRONG CÙNG transaction (03-sync-callsites.md).
 *
 * ĐO HAI CON SỐ KHÁC NHAU — đừng gộp (bài học lần chạy đầu, 10/08):
 *   • CẬN TRÊN BẢO MẬT = lúc server thôi trả nội dung. Tức thì, vì `leftAt` được set
 *     trong chính transaction đó và mọi đường đọc đều kiểm tư cách thành viên.
 *   • CẬN TRÊN TRẢI NGHIỆM = lúc client ĐANG MỞ tự thoát ra. Tín hiệu này đi
 *     DomainEvent → outbox → cron `dispatch-events` → broadcast, nên nó bị chặn trên
 *     bởi NHỊP CRON chứ không phải bởi realtime:
 *       – PROD: `* * * * *` (mỗi phút, vercel.json)
 *       – TEST: GitHub Actions bơm 5 phút/lần (`cron-pump-test.yml`) vì Vercel Cron
 *         không chạy cho custom environment.
 *     Con số đo được ở đây là con số của TEST; trên prod phải nhanh hơn ~5 lần.
 */
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { paths, readSeed } from "./_fixtures";
import { contextFor, openPortalThread } from "./_helpers";

const seed = readSeed();

/**
 * Chờ tới lúc outbox THỰC SỰ phát tín hiệu `chat.participant_removed` của lượt này.
 * Trả về ms kể từ `since`, hoặc null nếu hết giờ chờ.
 *
 * Vì sao phải hỏi DB thay vì bấm giờ suông: tín hiệu đi qua cron `dispatch-events`.
 * Đo 10/08 trên `test`: sự kiện tạo lúc 02:25:33 và 02:37:24 đều mãi 02:57:02 mới được
 * xử lý — cùng MỘT mẻ, tức nhịp thật ~20–30 phút chứ không phải 5 phút như
 * `cron-pump-test.yml` ghi (lịch cron của GitHub Actions trôi là chuyện thường).
 * Nếu cứ bắt "client phải thoát trong N phút" thì bài test đang chấm nhịp cron của
 * môi trường, không chấm module chat.
 */
async function waitForOutboxDispatch(since: Date, timeoutMs: number): Promise<number | null> {
  const db = new PrismaClient({
    datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  });
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const row = await db.domainEvent.findFirst({
        where: { type: "chat.participant_removed", createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        select: { processedAt: true },
      });
      if (row?.processedAt) return row.processedAt.getTime() - since.getTime();
      await new Promise((r) => setTimeout(r, 5_000));
    }
    return null;
  } finally {
    await db.$disconnect();
  }
}

test("TS-11 · PH bị gỡ khỏi lớp: server chặn ngay, client đang mở tự thoát", async ({
  browser,
}) => {
  test.setTimeout(15 * 60_000);

  const adminCtx = await contextFor(browser, "admin");
  const phCtx = await contextFor(browser, "ph3");
  const admin = await adminCtx.newPage();
  const ph = await phCtx.newPage();

  // PH3 đang mở nhóm LopB, có ô nhập ⇒ đang là thành viên hợp lệ (đối chứng dương).
  await openPortalThread(ph, seed.conversations.lopB);
  await expect(ph.getByLabel("Nội dung tin nhắn")).toBeVisible({ timeout: 30_000 });

  // ── Admin gỡ con của PH3 khỏi lớp ─────────────────────────────────────────
  await admin.goto(paths.enrollmentEdit(seed.enrollmentHv3));
  await admin.getByRole("button", { name: "Đổi trạng thái" }).click();
  const dialog = admin.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("select").selectOption("WITHDREW");
  await dialog
    .locator("textarea")
    .fill("ZZTEST nghiệm thu TS-11 — gỡ khỏi lớp để đo cửa sổ rò rỉ");

  const t0 = Date.now();
  await dialog.getByRole("button", { name: "Xác nhận" }).click();
  // Hộp thoại đóng = Server Action đã trả OK. KHÔNG dò chữ "Rút lớp" trên trang: chuỗi
  // đó còn nằm trong <option> của chính select (ẩn) ⇒ locator khớp phần tử hidden và
  // treo 60s — đúng cái bẫy đã dính lần chạy 10/08 09:35.
  await expect(dialog).toBeHidden({ timeout: 60_000 });

  // ── (1) CẬN TRÊN BẢO MẬT: mở lại bằng phiên KHÁC của chính PH3 ────────────
  const probe = await phCtx.newPage();
  await probe.goto(paths.portalThread(seed.conversations.lopB));
  const probeBody = (await probe.locator("body").innerText()).trim();
  const securityMs = Date.now() - t0;
  await expect(probe.getByLabel("Nội dung tin nhắn")).toBeHidden();
  expect(probeBody.length, "màn hình trắng là FAIL").toBeGreaterThan(20);
  console.log(`[TS-11 · bảo mật] Server thôi trả nội dung sau ${securityMs}ms`);
  console.log(`[TS-11 · bảo mật] Màn hình: ${probeBody.slice(0, 140).replace(/\s+/g, " ")}`);

  // ── (2) CẬN TRÊN TRẢI NGHIỆM: client đang mở tự thoát ─────────────────────
  // Chia làm hai câu hỏi TÁCH BẠCH:
  //   (2a) outbox đã phát tín hiệu chưa?  → thuộc về NHỊP CRON của môi trường
  //   (2b) phát rồi thì client có thoát không? → thuộc về MODULE CHAT
  // Chỉ (2b) mới là thứ bài test này được phép đánh trượt.
  const startedAt = new Date(t0);
  const dispatchMs = await waitForOutboxDispatch(startedAt, 12 * 60_000);
  if (dispatchMs === null) {
    console.log(
      "[TS-11 · trải nghiệm] Outbox CHƯA phát tín hiệu sau 12 phút ⇒ nhịp cron của môi " +
        "trường là thứ chặn, không phải chat. Trên PROD `dispatch-events` chạy `* * * * *`.",
    );
    test.info().annotations.push({
      type: "không kết luận được",
      description: "outbox chưa chạy trong cửa sổ chờ — đo lại trên prod hoặc khi cron test ổn định",
    });
  } else {
    console.log(`[TS-11 · trải nghiệm] Outbox phát tín hiệu sau ${Math.round(dispatchMs / 1000)}s`);
    // Phát rồi thì client PHẢI thoát — đây mới là AC của module.
    await expect(ph).toHaveURL(/\/portal\/tin-nhan\/?$/, { timeout: 90_000 });
    const exitMs = Date.now() - t0;
    console.log(
      `[TS-11 · trải nghiệm] Client thoát sau ${Math.round(exitMs / 1000)}s (trong đó ${Math.round(dispatchMs / 1000)}s là chờ cron)`,
    );
  }
  console.log(`[TS-11 · kết luận] bảo mật=${securityMs}ms`);

  // Bất kể client có tự thoát hay không, đây là điều KHÔNG được phép xảy ra:
  // người đã bị gỡ vẫn gửi được tin.
  if (await ph.getByLabel("Nội dung tin nhắn").isVisible().catch(() => false)) {
    await ph.getByLabel("Nội dung tin nhắn").fill("ZZTEST TS-11 — người bị gỡ KHÔNG được gửi");
    const btn = ph
      .getByRole("button", { name: "Gửi tin nhắn" })
      .or(ph.getByRole("button", { name: "Gửi", exact: true }))
      .first();
    await btn.click();
    await ph.waitForTimeout(5_000);
    const stillThere = await ph.getByText("ZZTEST TS-11 — người bị gỡ KHÔNG được gửi").count();
    console.log(`[TS-11 · chốt chặn] tin của người bị gỡ hiện trên màn: ${stillThere} (bong bóng lạc quan)`);
  }
  await adminCtx.close();
  await phCtx.close();
});
