// tests/manual/p3b-bam-thu.ts — BẤM THỬ THẬT các thao tác P3b trên trình duyệt (không có e2e nào phủ hai màn này):
// GV "Xác nhận nhận" + "Nhận cả N buổi" (kèm phiên bản), QLCS "Gửi lại nhắc" — rồi đối chiếu DB.
// Chỉ chạy trên DB đo local `satarobo_p3b_ui` (đã nạp `p3b-du-lieu-do.ts`), `next start` ở BASE_URL.
//   DATABASE_URL=…/satarobo_p3b_ui BASE_URL=http://localhost:3200 UAT_PASSWORD=… pnpm exec tsx tests/manual/p3b-bam-thu.ts
import "../../scripts/_cho-phep-server-only";
import { chromium, type Page } from "@playwright/test";
import { db } from "@/lib/db";
import { dongBoNgay } from "@/lib/parttime/dong-bo";
import { laDbCucBo } from "@/lib/security/url-db-cuc-bo";
import { login } from "../e2e/_helpers/auth";

const URL = process.env.DATABASE_URL ?? "";
if (!laDbCucBo(URL) || !URL.includes("satarobo_p3b_ui")) throw new Error("Chỉ chạy trên DB đo local satarobo_p3b_ui");
const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const PASS = process.env.UAT_PASSWORD ?? "";
if (PASS.length < 8) throw new Error("thiếu UAT_PASSWORD");

async function toast(page: Page, re: RegExp) {
  await page.getByText(re).first().waitFor({ timeout: 30_000 });
}

async function main() {
  const gv = await db.user.findFirstOrThrow({ where: { email: "uat.giaovien@satarobo.vn" }, select: { id: true } });
  const ql = await db.user.findFirstOrThrow({ where: { email: "uat.giamdoc@satarobo.vn" }, select: { id: true, name: true } });
  // Hai buổi MỚI cho lớp của GV ⇒ nhóm có ≥ 2 buổi chờ (để có nút "Nhận cả N buổi").
  const lop = await db.class.findFirstOrThrow({ where: { classCode: "P3B-L0" }, select: { id: true, centerId: true } });
  // Ngày MỚI mỗi lượt chạy (sau buổi muộn nhất đang có) ⇒ chạy lại được nhiều lần.
  const cuoi = await db.classSession.findFirst({ where: { classId: lop.id }, orderBy: { date: "desc" }, select: { date: true } });
  const moc = (cuoi?.date ?? new Date("2026-11-08T10:30:00Z")).getTime();
  const moi: string[] = [];
  for (const n of [7, 9]) {
    const s = await db.classSession.create({ data: { classId: lop.id, centerId: lop.centerId, status: "SCHEDULED", date: new Date(moc + n * 86_400_000) }, select: { id: true } });
    moi.push(s.id);
  }
  // Một buổi LẺ ở lớp khác mà GV là trợ giảng ⇒ nhóm 1 buổi (chỉ có nút "Xác nhận nhận").
  const lopTa = await db.class.findFirstOrThrow({ where: { classCode: "P3B-L4" }, select: { id: true, centerId: true } });
  const le = await db.classSession.create({ data: { classId: lopTa.id, centerId: lopTa.centerId, status: "SCHEDULED", date: new Date(moc + 8 * 86_400_000) }, select: { id: true } });
  moi.push(le.id);
  await dongBoNgay(moi.map((id) => ({ sourceType: "CLASS_SESSION" as const, sourceId: id })), "TAO_BUOI", { id: ql.id, name: ql.name ?? "QLCS" });
  const daNhanTruoc = await db.staffAssignmentAcceptance.count({ where: { userId: gv.id } });
  const choTruoc = await db.sessionStaffAssignment.count({ where: { userId: gv.id, status: "WAITING_ACCEPTANCE" } });

  const browser = await chromium.launch();
  // ── GV ──
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 900 } });
    const page = await ctx.newPage();
    await login(page, { email: "uat.giaovien@satarobo.vn", password: PASS, callbackUrl: "/teacher/phan-cong", timeout: 120_000 });
    await page.goto(`${BASE}/teacher/phan-cong?tab=can-xac-nhan`, { waitUntil: "load" });
    const nhanHet = page.getByRole("button", { name: /^Nhận cả \d+ buổi$/ }).first();
    await nhanHet.waitFor({ timeout: 60_000 });
    await nhanHet.click();
    await toast(page, /Đã nhận \d+ buổi/);
    console.log("GV: Nhận cả lớp — OK (toast)");
    await page.goto(`${BASE}/teacher/phan-cong?tab=can-xac-nhan`, { waitUntil: "load" });
    const le = page.getByRole("button", { name: "Xác nhận nhận" }).first();
    if (await le.count()) {
      await le.click();
      await toast(page, /Đã nhận phân công/);
      console.log("GV: Xác nhận nhận (lẻ) — OK (toast)");
    } else console.log("GV: không còn buổi lẻ chờ nhận");
    await ctx.close();
  }
  const daNhanSau = await db.staffAssignmentAcceptance.count({ where: { userId: gv.id } });
  const choSau = await db.sessionStaffAssignment.count({ where: { userId: gv.id, status: "WAITING_ACCEPTANCE" } });
  console.log(`DB: xác nhận của GV ${daNhanTruoc} → ${daNhanSau}; chờ nhận ${choTruoc} → ${choSau}`);
  if (daNhanSau - daNhanTruoc < 2) throw new Error("Không thấy đủ dòng xác nhận mới trong DB");

  // ── QLCS: gửi lại nhắc cho một phân công đang chờ ──
  const truocNhac = await db.auditLog.count({ where: { action: "PT_ACCEPTANCE_REMINDED" } });
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, { email: "uat.giamdoc@satarobo.vn", password: PASS, callbackUrl: "/admin/cham-cong/phan-cong", timeout: 120_000 });
    await page.goto(`${BASE}/admin/cham-cong/phan-cong?tuan=2026-11-02&loc=cho-xac-nhan`, { waitUntil: "load" });
    await page.getByRole("button", { name: /^Xử lý/ }).first().click();
    const nut = page.getByRole("button", { name: "Gửi lại nhắc" }).first();
    await nut.waitFor({ timeout: 30_000 });
    await nut.click();
    await toast(page, /Đã gửi lại nhắc xác nhận/);
    console.log("QLCS: Gửi lại nhắc — OK (toast)");
    await ctx.close();
  }
  const sauNhac = await db.auditLog.count({ where: { action: "PT_ACCEPTANCE_REMINDED" } });
  const tb = await db.staffNotification.count({ where: { dedupeKey: { startsWith: "parttime.nhac:" } } });
  console.log(`DB: audit PT_ACCEPTANCE_REMINDED ${truocNhac} → ${sauNhac}; thông báo parttime.nhac: ${tb}`);
  if (sauNhac !== truocNhac + 1 || tb < 1) throw new Error("Không thấy audit / thông báo nhắc trong DB");
  await browser.close();
  console.log("XANH: mọi thao tác bấm thật đều ghi đúng xuống DB");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
