// lib/portal/yeu-cau-bao-luu.test.ts — C12 (nghiệm thu bảo lưu vòng 2): nhãn + nội dung chuông cho yêu cầu 'Bảo lưu' của phụ huynh. THUẦN.
import { describe, expect, it } from "vitest";
import { nhanTrangThaiYeuCau, REQUEST_STATUS_LABEL } from "./request-labels";
import { noiDungChuongBaoLuu } from "./parent-request-notify";

describe("[C12-NHAN] nhanTrangThaiYeuCau", () => {
  it("[C12-NHAN-01] RESERVE đã được lập hồ sơ (APPROVED + reserveId) ⇒ 'Đã xử lý', KHÔNG 'Đã duyệt' (hồ sơ còn chờ duyệt)", () => {
    expect(nhanTrangThaiYeuCau({ type: "RESERVE", status: "APPROVED", reserveId: "r1" })).toBe("Đã xử lý");
  });
  it("[C12-NHAN-02] mọi trường hợp khác giữ NHÃN CŨ: RESERVE APPROVED không reserveId (duyệt tay); loại khác dù có reserveId; trạng thái khác", () => {
    expect(nhanTrangThaiYeuCau({ type: "RESERVE", status: "APPROVED", reserveId: null })).toBe(REQUEST_STATUS_LABEL.APPROVED);
    expect(nhanTrangThaiYeuCau({ type: "RESERVE", status: "APPROVED" })).toBe(REQUEST_STATUS_LABEL.APPROVED);
    expect(nhanTrangThaiYeuCau({ type: "OTHER", status: "APPROVED", reserveId: "r1" })).toBe(REQUEST_STATUS_LABEL.APPROVED);
    expect(nhanTrangThaiYeuCau({ type: "RESERVE", status: "PENDING", reserveId: null })).toBe(REQUEST_STATUS_LABEL.PENDING);
    expect(nhanTrangThaiYeuCau({ type: "RESERVE", status: "REJECTED", reserveId: "r1" })).toBe(REQUEST_STATUS_LABEL.REJECTED);
  });
});

describe("[C12-CHUONG] noiDungChuongBaoLuu", () => {
  it("[C12-CHUONG-01] chuông tạo mới nêu việc cần làm và trỏ vào hàng đợi đã lọc loại + trạng thái", () => {
    const c = noiDungChuongBaoLuu("An", false);
    expect(c.title).toBe("Phụ huynh xin bảo lưu — cần lập hồ sơ");
    expect(c.body).toMatch(/Lập hồ sơ bảo lưu/);
    expect(c.href).toBe("/parent-requests?type=RESERVE&status=PENDING");
  });
  it("[C12-CHUONG-02] chuông nhắc 12 giờ khác chuông tạo mới; thiếu tên học viên thì vẫn đọc được", () => {
    expect(noiDungChuongBaoLuu(null, true).title).toMatch(/^Nhắc:/);
    expect(noiDungChuongBaoLuu(null, true).body).toMatch(/học viên/);
  });
});

// ── LƯỚI GHIM MÃ NGUỒN (luật 11: neo hẹp, bỏ chú thích, đếm số lần) ──────────────────────────────────────────────────────────────────────
// Phép chuyển yêu cầu phải là `updateMany` CÓ ĐIỀU KIỆN `status: "PENDING"` + `count === 0 ⇒ throw`: hai người lập từ một yêu cầu cho HAI ghi danh khác nhau
// cùng qua cổng đọc, và chỉ phép ghi có điều kiện mới ngăn hồ sơ thứ hai (chỉ mục "một ghi danh một hồ sơ mở" không chặn vì ghi danh khác nhau).
// Test hành vi không dựng được cuộc đua này một cách ổn định, nên ghim bằng văn bản mã.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("[C12-W] lập từ yêu cầu PH: phép chuyển trạng thái có điều kiện (chống đua)", () => {
  const ma = readFileSync(resolve(process.cwd(), "lib/bao-luu/dich-vu.ts"), "utf8")
    .split("\n")
    .filter((d) => !d.trimStart().startsWith("//"))
    .join("\n");

  it("[C12-W1] đúng MỘT phép updateMany lên parentRequest, where có `status: \"PENDING\"`, và đổi 0 dòng ⇒ throw", () => {
    const goi = ma.match(/parentRequest\.updateMany\(\{\s*where:\s*\{[^}]*\}/g) ?? [];
    expect(goi).toHaveLength(1);
    expect(goi[0]).toMatch(/status:\s*"PENDING"/);
    expect(ma).toMatch(/chuyen\.count === 0\) throw new LoiNhieu/);
  });
});
