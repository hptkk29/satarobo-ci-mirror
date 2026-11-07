// Lưới ghim DÂY NỐI của luồng "xuất nhận xét buổi gửi phụ huynh" (28/10/2026): quyền ở nút (hồ sơ học viên) và quyền ở
// route PDF phải CÙNG MỘT quyền — vẽ nút bằng quyền này mà route gác quyền khác là lời hứa suông (luật 12), và không
// ca hành vi nào đỏ vì route/page chạm DB + phiên. Neo vào lời gọi, không neo vào chỗ đặt `await`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const dem = (s: string, re: RegExp) => (s.match(new RegExp(re.source, "g")) ?? []).length;

describe("[NXG-W] xuất nhận xét buổi gửi phụ huynh: nút và route cùng một quyền", () => {
  it("[NXG-W1] route PDF admin gác `session-feedback:share` và đọc qua scopedDb (không db trần)", () => {
    const f = doc("app/api/admin/reports/nhan-xet-buoi/route.ts");
    expect(dem(f, /checkPermission\("session-feedback:share"\)/)).toBe(1);
    expect(f).toMatch(/scopedDb\(actor\)/);
    expect(f).not.toMatch(/from "@\/lib\/db"/);
    // Cách ly cơ sở: học viên VÀ buổi đều phải đọc qua client đã scope.
    expect(dem(f, /sdb\.student\.findFirst\(/)).toBe(1);
    expect(dem(f, /sdb\.classSession\.findMany\(/)).toBe(1);
    expect(dem(f, /sdb\.studentSessionFeedback\.findMany\(/)).toBe(1);
  });

  it("[NXG-W2] hồ sơ học viên truyền cờ nút = đúng quyền share", () => {
    const f = doc("app/(admin)/admin/students/[id]/edit/page.tsx");
    expect(dem(f, /checkPermission\("session-feedback:share"\)/)).toBe(1);
    expect(f).toMatch(/choPhepLayVe=\{layNhanXetVe\}/);
  });

  it("[NXG-W3] nút mở đúng route; khối chỉ vẽ nút khi được phép; không còn nút sao chép chữ", () => {
    const nut = doc("app/(admin)/admin/students/_components/ho-so/nut-xuat-nhan-xet.tsx");
    expect(nut).not.toMatch(/clipboard/);
    expect(nut).toMatch(/dungDuongDanXuat\(/);
    expect(doc("lib/students/xuat-nhan-xet.ts")).toMatch(/\/api\/admin\/reports\/nhan-xet-buoi\?/);
    expect(doc("app/(admin)/admin/students/_components/ho-so/nhan-xet-va-hoc-ba.tsx")).toMatch(
      /choPhepLayVe && \(\s*<NutXuatNhanXet/,
    );
  });

  it("[NXG-W4] route site GV dựng PDF qua hàm dùng chung; route admin qua hàm gộp nhiều buổi", () => {
    expect(doc("app/(teacher)/teacher/nhan-xet/pdf/[sessionId]/[studentId]/route.ts")).toMatch(
      /sessionEvalPdfResponse\(/,
    );
    expect(doc("app/api/admin/reports/nhan-xet-buoi/route.ts")).toMatch(/sessionEvalBundlePdfResponse\(/);
  });

  it("[NXG-W5] route admin chỉ nhận phiếu của ĐÚNG học viên được hỏi; thiếu một phiếu là từ chối cả lượt; có trần", () => {
    const f = doc("app/api/admin/reports/nhan-xet-buoi/route.ts");
    expect(f).toMatch(/where: \{ id: \{ in: feedbackIds \}, studentId \}/);
    expect(f).toMatch(/fbs\.length !== feedbackIds\.length/);
    expect(f).toMatch(/feedbackIds\.length > TOI_DA_BUOI_MOT_LAN/);
  });
});
