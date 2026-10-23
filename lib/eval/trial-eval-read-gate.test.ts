// 27/08 — ĐỌC phiếu đánh giá buổi trải nghiệm phải TÁCH khỏi quyền ĐIỀN phiếu.
//
// Lỗi người dùng báo: giáo viên chấm xong, tài khoản Sale mở màn Lớp Trial ra KHÔNG
// thấy phiếu. Nguyên nhân: `loadTrialSessionEvalAction` (đường ĐỌC) gọi
// `gateTrialFill` — cổng của đường GHI. Cổng đó chỉ cho SUPER_ADMIN · TRAINING ·
// CENTER_MANAGER cùng cơ sở · TEACHER của lớp/buổi/ca. `CENTER_SALES_CSM` không nằm
// trong danh sách nên bấm "Phiếu đánh giá buổi học" chỉ nhận toast "Không có quyền
// điền phiếu buổi học thử này" và khối phiếu trống trơn.
//
// Đây ĐÚNG lớp lỗi mà GĐ4 đã sửa một lần cho điểm danh (`trials:attendance` tách khỏi
// `trials:feedback`) — lần này lọt ở đường ĐỌC. Sale phải đọc được phiếu vì đó là căn
// cứ để chốt với phụ huynh; Sale vẫn KHÔNG được chấm.
//
// Không gọi được action thật ở lane unit (cần auth + Postgres) nên quét nguồn, y như
// `app/(admin)/admin/lop-trial/_lib/permissions.test.ts` vẫn làm.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const SRC = fs.readFileSync("lib/eval/session-eval-actions.ts", "utf8");

/** Cắt lấy thân một hàm theo tên, tới `\n}` ở cột 0. */
function thanHam(ten: string): string {
  const i = SRC.indexOf(`function ${ten}(`);
  expect(i, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  const j = SRC.indexOf("\n}", i);
  return SRC.slice(i, j);
}

describe("[BUG-2708] Sale đọc được phiếu đánh giá buổi trải nghiệm", () => {
  it("đường ĐỌC không dùng cổng của đường GHI", () => {
    const doc = thanHam("loadTrialSessionEvalAction");
    expect(doc, "loadTrialSessionEvalAction vẫn gọi gateTrialFill — đúng lỗi đã báo").not.toMatch(
      /gateTrialFill\(/,
    );
    expect(doc, "loadTrialSessionEvalAction phải đi qua cổng đọc riêng").toMatch(
      /gateTrialRead\(/,
    );
  });

  it("đường GHI vẫn giữ cổng chặt — nới đọc KHÔNG được kéo theo nới ghi", () => {
    expect(thanHam("saveTrialSessionEvalAction")).toMatch(/gateTrialFill\(/);
  });

  it("cổng đọc gác bằng quyền + cách ly cơ sở, không so vai bằng tay", () => {
    const doc = thanHam("gateTrialRead");
    // Luật cứng #1: mọi kiểm tra quyền đi qua can()/checkPermission, cấm so vai/centerId.
    expect(doc, "cổng đọc phải kiểm quyền trials:view").toMatch(/trials:view/);
    expect(doc, "cổng đọc phải qua passesScope — thiếu là đọc được lớp cơ sở khác").toMatch(
      /passesScope\(/,
    );
    expect(doc, "cổng đọc KHÔNG được so vai bằng hasRole").not.toMatch(/hasRole\(/);
  });

  it("cổng đọc KHÔNG đòi trials:feedback — đó là quyền chấm, không phải quyền xem", () => {
    expect(thanHam("gateTrialRead")).not.toMatch(/trials:feedback/);
  });
});
