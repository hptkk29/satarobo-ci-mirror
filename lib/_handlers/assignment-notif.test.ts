import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * [AN] V8.1 — lưới ghim dây nối thông báo giao/chấm bài tập (hành vi thật ở tests/mobile-api/thong-bao-bai-tap.spec.ts [TBBT-DB]).
 *   [AN-W1] giao bài của giáo viên phát `assignment.assigned` TRONG transaction tạo bài
 *   [AN-W2] chấm hàng loạt + chấm từng bài (nhanh / rubric) đều phát `assignment.graded` TRONG transaction chấm (3 chỗ)
 *   [AN-W3] handler đã đăng ký; không gửi push, không cộng SataCoin, không đưa điểm vào nội dung
 */
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const doc = (p: string) => bo(readFileSync(resolve(process.cwd(), p), "utf8"));
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("[AN] dây nối thông báo bài tập", () => {
  it("[AN-W1] giao bài ⇒ publishEvent(assignment.assigned) sau tx.assignment.create, cùng tx", () => {
    const s = doc("app/(teacher)/teacher/cham-bai/_actions.ts");
    const i = s.indexOf("tx.assignment.create(");
    const j = s.indexOf('publishEvent("assignment.assigned"');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(s.slice(j, j + 260)).toMatch(/\{ tx: tx as unknown as Prisma\.TransactionClient, dedupeKey:/);
  });

  it("[AN-W6] V8.24: cả hai handler bài tập chặn theo cờ «Bài tập & bài thi» (một chỗ, cùng công tắc với route/menu)", () => {
    const h = doc("lib/_handlers/assignment-notif.ts");
    expect(dem(h, /mucBaiTapBaiThiDangHien\(\)/g)).toBe(2);
    expect(h).toMatch(/onAssignmentAssignedNotif[^{]*\{\s*if \(!mucBaiTapBaiThiDangHien\(\)\) return;/);
    expect(h).toMatch(/onAssignmentGradedNotif[^{]*\{\s*if \(!mucBaiTapBaiThiDangHien\(\)\) return;/);
  });

  it("[AN-W2] chấm bài ⇒ publishEvent(assignment.graded) trong tx — đủ 3 đường", () => {
    const t = doc("app/(teacher)/teacher/cham-bai/_actions.ts");
    expect(dem(t, /publishEvent\("assignment\.graded"/g)).toBe(1);
    expect(t.slice(t.indexOf('publishEvent("assignment.graded"'))).toMatch(/^[^;]*\{ tx: tx as unknown as Prisma\.TransactionClient, dedupeKey:/);
    const a = doc("app/(admin)/admin/assignments/_actions.ts");
    expect(dem(a, /publishEvent\("assignment\.graded"/g)).toBe(2);
    expect(dem(a, /assignment\.graded[^;]*\{ tx: tx as unknown as Prisma\.TransactionClient, dedupeKey:/g)).toBe(2);
  });

  it("[AN-W4] V8.2: yêu cầu được xử lý ⇒ publishEvent(parent_request.handled) TRONG transaction ở CẢ HAI đường duyệt; handler đã đăng ký; tin học sinh theo danh sách cho phép", () => {
    const a = doc("app/(admin)/admin/parent-requests/actions.ts");
    // V8.19: cả hai đường đi qua `doiTrangThaiYeuCau` (ghi CÓ ĐIỀU KIỆN PENDING + phát sự kiện trong cùng giao dịch ở lib/yeu-cau-ph/da-xu-ly.ts) — không còn phát tay.
    expect(dem(a, /doiTrangThaiYeuCau\(/g)).toBe(2);
    expect(dem(a, /tx\.parentRequest\.update\(/g)).toBe(0);
    const dx = doc("lib/yeu-cau-ph/da-xu-ly.ts");
    expect(dem(dx, /publishEvent\("parent_request\.handled"[^;]*\{ tx, dedupeKey: khoaSuKienDaXuLy\(/g)).toBe(1);
    expect(doc("lib/events/register.ts")).toContain("registerYeuCauXuLyNotifHandlers();");
    const h = doc("lib/_handlers/yeu-cau-xu-ly-notif.ts");
    expect(h).toContain('on("parent_request.handled"');
    expect(h).not.toMatch(/\bresponse\b/); // không đưa phản hồi nhân viên vào nội dung
    expect(h).not.toMatch(/sataCoin|satacoin|webPush|fcm|apns|sendPush/i);
    const s = doc("lib/mobile-api/dich-vu/thong-bao-hoc-sinh.ts");
    expect(s).toContain("TIEN_TO_TIN_HOC_SINH");
    expect(s).not.toMatch(/audience: "STUDENT", studentId: hs \}/); // không lấy «mọi STUDENT»
  });

  it("[AN-W5] V8.5: duyệt ảnh ⇒ publishEvent(media.approved) TRONG transaction, CHỈ khi APPROVED; handler đã đăng ký; học sinh được báo qua danh sách cho phép", () => {
    const a = doc("app/(admin)/admin/media/actions.ts");
    expect(dem(a, /publishEvent\("media\.approved"/g)).toBe(1);
    expect(a).toMatch(/if \(input\.decision === "APPROVED"\) \{\s*await publishEvent\("media\.approved"[^;]*\{ tx: tx as unknown as Prisma\.TransactionClient, dedupeKey:/);
    expect(doc("lib/events/register.ts")).toContain("registerAnhDuyetNotifHandlers();");
    const h = doc("lib/_handlers/anh-duyet-notif.ts");
    expect(h).toContain('on("media.approved"');
    expect(h).toContain('status: "GRANTED"'); // lọc theo đồng ý ảnh
    expect(h).toContain('m.status !== "APPROVED"'); // không tin payload
    expect(h).not.toMatch(/fileUrl|fileName|caption|sataCoin|webPush|fcm|apns/i); // không lộ tệp, không coin, không push
    expect(doc("lib/mobile-api/dich-vu/thong-bao-hoc-sinh.ts")).toContain('"media.approved:"');
  });

  it("[AN-W3] handler đăng ký; không push / coin / điểm", () => {
    expect(doc("lib/events/register.ts")).toContain("registerAssignmentNotifHandlers();");
    const h = doc("lib/_handlers/assignment-notif.ts");
    expect(h).toContain('on("assignment.assigned"');
    expect(h).toContain('on("assignment.graded"');
    expect(h).not.toMatch(/sataCoin|satacoin|webPush|fcm|apns|sendPush/i);
    expect(h).not.toMatch(/\bscore\b/); // không đọc/ghi điểm vào nội dung
  });
});
