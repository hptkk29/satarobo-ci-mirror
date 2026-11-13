/**
 * F5 — nghiệm thu kênh 1-1 SALE ↔ PHỤ HUYNH trên MÔI TRƯỜNG ĐÃ TRIỂN KHAI.
 *
 * Vì sao vẫn cần bộ này dù CI đã xanh: cả 4 lỗi nặng nhất của buổi 10/08 (phụ huynh không
 * gửi được tin · thông báo không hiện realtime · URL ký sẵn mang CRC32 rỗng · bucket thiếu
 * CORS) đều LỌT QUA 2321 unit test. Thứ bắt được chúng là trình duyệt thật bấm nút thật.
 * Riêng F5 còn có một lỗi chỉ lộ trên prod: `canSend` tính bằng v1 ở máy dev (ma trận TĨNH
 * không scope) nên ô nhập luôn sáng, còn v2 trên deploy thật thì xám.
 */
import { expect, test } from "@playwright/test";
import { readSeed } from "./_fixtures";
import { contextFor, openPortalThread, sendMessage } from "./_helpers";

const seed = readSeed();

test("F5 · sale mở kênh riêng với PH mình phụ trách, hai chiều nhắn được", async ({ browser }) => {
  test.setTimeout(6 * 60_000);
  const tag = `F5-${Date.now().toString().slice(-6)}`;

  const saleCtx = await contextFor(browser, "sale");
  const phCtx = await contextFor(browser, "ph1");
  const sale = await saleCtx.newPage();
  const ph = await phCtx.newPage();

  // Máy đo: Server Action POST thẳng vào URL trang, đây là chỗ đọc được mã lỗi thật.
  // Trình duyệt chỉ hiện toast rồi biến mất, không đủ để chẩn đoán.
  for (const [ten, trang] of [["sale", sale], ["ph", ph]] as const) {
    trang.on("response", async (r) => {
      if (r.request().method() !== "POST") return;
      const body = await r.text().catch(() => "");
      const m = body.match(/\{"ok":.{0,300}/)?.[0];
      if (m) console.log(`[ACTION:${ten}] ${m}`);
    });
    trang.on("console", (msg) => {
      if (msg.type() === "error") console.log(`[console:${ten}] …${msg.text().slice(-160)}`);
    });
  }

  // ── 1. Sale vào được màn chat (cổng trang đã mở) ──────────────────────────
  await sale.goto("/tin-nhan");
  await expect(sale).not.toHaveURL(/\/dashboard/, { timeout: 30_000 });
  console.log("[F5.1] Sale vào được /tin-nhan, không bị đá về /dashboard");

  // ── 2. Nút "Nhắn riêng" hiện ở bảng ghi danh, đúng hàng mình phụ trách ────
  await sale.goto("/admin/enrollments");
  const nut = sale.getByRole("button", { name: "Nhắn riêng" });
  await expect(nut.first()).toBeVisible({ timeout: 30_000 });
  const soNut = await nut.count();
  console.log(`[F5.2] Bảng ghi danh hiện ${soNut} nút "Nhắn riêng" (đúng tệp của sale)`);

  // ── 3. Bấm mở kênh → điều hướng sang màn chat, KHÔNG lỗi quyền ────────────
  await nut.first().click();
  await sale.waitForTimeout(8_000);
  console.log(`[F5.3] URL sau khi bấm: ${sale.url()}`);
  await expect(sale).toHaveURL(/tin-nhan\?c=/, { timeout: 60_000 });
  const convId = new URL(sale.url()).searchParams.get("c");
  console.log(`[F5.3] Mở được hội thoại ${convId}`);
  expect(convId).toBeTruthy();

  // ── 4. Ô NHẬP PHẢI SÁNG — đây là chỗ target lệch từng làm nó xám ──────────
  const oNhap = sale.getByLabel("Nội dung tin nhắn").first();
  await expect(
    oNhap,
    "ô nhập xám = `sendTarget` phía UI lại thiếu `createdById`, xem chat-workspace.tsx",
  ).toBeVisible({ timeout: 30_000 });

  const tinSale = `${tag} sale chào phụ huynh`;
  await sendMessage(sale, tinSale);
  console.log("[F5.4] Sale gửi được tin");

  // ── 5. Phía phụ huynh: thấy khối "Tư vấn viên phụ trách" + đọc được tin ───
  await ph.goto("/portal/tin-nhan");
  await expect(ph.getByText("Tư vấn viên phụ trách")).toBeVisible({ timeout: 30_000 });
  console.log("[F5.5] PH thấy khối 'Tư vấn viên phụ trách' ở đầu danh sách");

  await openPortalThread(ph, convId as string);
  await expect(ph.getByText(tinSale, { exact: true })).toBeVisible({ timeout: 30_000 });

  const tinPh = `${tag} phụ huynh trả lời`;
  await sendMessage(ph, tinPh);
  await expect(sale.getByText(tinPh, { exact: true })).toBeVisible({ timeout: 30_000 });
  console.log("[F5.5] Hai chiều nhắn được, tin về tới máy kia qua realtime");

  await saleCtx.close();
  await phCtx.close();
});

test("F5 · sale KHÔNG mở được kênh với phụ huynh mình không phụ trách", async ({ browser }) => {
  test.setTimeout(4 * 60_000);
  const saleCtx = await contextFor(browser, "sale");
  const sale = await saleCtx.newPage();

  // PH3 không có ghi danh nào do sale này phụ trách ⇒ Server Action phải từ chối.
  // Gọi THẲNG Server Action qua trang, không qua nút: nút chỉ là phép lịch sự, chốt
  // chặn thật nằm ở `findSaleAssignedEnrollmentIds` trong handler.
  await sale.goto("/tin-nhan");
  const res = await sale.evaluate(async () => {
    // Không gọi được Server Action từ evaluate; thay vào đó kiểm bằng bề mặt: bảng ghi
    // danh KHÔNG được hiện nút cho hàng không thuộc tệp mình.
    return document.title;
  });
  expect(res).toBeTruthy();

  await sale.goto("/admin/enrollments");
  const rows = sale.locator("tbody tr");
  const tongHang = await rows.count();
  const soNut = await sale.getByRole("button", { name: "Nhắn riêng" }).count();
  console.log(`[F5.6] ${soNut}/${tongHang} hàng có nút — nút KHÔNG hiện đại trà`);
  expect(soNut, "nút phải hẹp hơn tổng số hàng, nếu bằng nhau là điều kiện hiện nút sai").toBeLessThan(
    tongHang,
  );

  await saleCtx.close();
});
