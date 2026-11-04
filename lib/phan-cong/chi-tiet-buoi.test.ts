// [GD7-*] GĐ7 — luật thuần của panel Phân công gộp: lý do thay / gỡ, ngày đã qua, chữ tầng XÁC NHẬN theo luật kỳ.
// Mốc tuyệt đối, không đồng hồ thật (luật 19); mỗi ca xanh khi chạy một mình.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { laNgayDaQua, LY_DO_DOI_TOI_THIEU, lyDoThieuKhiDoi, lyDoKhongGiaoDuoc } from "./giao-go";
import { nhanXacNhanBuoi } from "./chi-tiet-buoi";

describe("lyDoThieuKhiDoi — thay / gỡ người đang giữ vai cần lý do", () => {
  it("[GD7-01] giao vào vai TRỐNG ⇒ không cần lý do", () => {
    expect(lyDoThieuKhiDoi({ boUserId: null, lyDo: null })).toBeNull();
    expect(lyDoThieuKhiDoi({ boUserId: null, lyDo: "" })).toBeNull();
  });
  it("[GD7-02] thay / gỡ người đang giữ ⇒ thiếu hoặc ngắn hơn ngưỡng (đếm SAU khi bỏ khoảng trắng) là bị chặn; đủ ngưỡng thì qua", () => {
    expect(LY_DO_DOI_TOI_THIEU).toBe(5);
    expect(lyDoThieuKhiDoi({ boUserId: "u1", lyDo: null })).toMatch(/lý do/);
    expect(lyDoThieuKhiDoi({ boUserId: "u1", lyDo: "    abcd    " })).toMatch(/lý do/);
    expect(lyDoThieuKhiDoi({ boUserId: "u1", lyDo: " ốm đi " })).toBeNull();
  });
});

describe("laNgayDaQua — cùng phép so với cổng máy chủ", () => {
  it("[GD7-03] trước hôm nay ⇒ đã qua; HÔM NAY vẫn sửa được (xếp lại trong ngày là việc thường)", () => {
    expect(laNgayDaQua("2026-11-03", "2026-11-04")).toBe(true);
    expect(laNgayDaQua("2026-11-04", "2026-11-04")).toBe(false);
    expect(laNgayDaQua("2026-11-05", "2026-11-04")).toBe(false);
  });
  it("[GD7-04] panel và máy chủ không lệch: cổng máy chủ `lyDoKhongGiaoDuoc` dùng CHÍNH `laNgayDaQua` (một hàm, không chép phép so)", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/phan-cong/giao-go.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect((src.match(/if \(laNgayDaQua\(p\.ngay, p\.homNay\)\) return/g) ?? []).length).toBe(1);
    expect(src).not.toMatch(/p\.ngay < p\.homNay/);
    expect(lyDoKhongGiaoDuoc({ ngay: "2026-11-03", homNay: "2026-11-04", trangThaiKy: null })).toMatch(/đã qua/);
  });
});

describe("nhanXacNhanBuoi — tầng XÁC NHẬN rẽ theo luật kỳ", () => {
  const goc = { lyDo: null, kyKhoa: false } as const;
  it("[GD7-05] luật CŨ: chưa ai quyết ⇒ 'Chưa xác nhận' — KHÔNG suy xác nhận từ kế hoạch", () => {
    expect(nhanXacNhanBuoi({ ...goc, luat: "CU", quyetDinh: null, donVi: null })).toMatchObject({ nhan: "Chưa xác nhận", tone: "muted" });
  });
  it("[GD7-06] luật CŨ: ba quyết định + đơn vị CŨ (lệch sau xác nhận) nói đúng thứ đã xảy ra", () => {
    expect(nhanXacNhanBuoi({ ...goc, luat: "CU", quyetDinh: "CONFIRMED", donVi: "CONFIRMED" })).toMatchObject({ nhan: "Đã xác nhận", tone: "success" });
    expect(nhanXacNhanBuoi({ ...goc, luat: "CU", quyetDinh: "REJECTED", donVi: null })).toMatchObject({ nhan: "Không xác nhận", tone: "danger" });
    expect(nhanXacNhanBuoi({ ...goc, luat: "CU", quyetDinh: "NEEDS_INFO", donVi: null })).toMatchObject({ nhan: "Cần bổ sung", tone: "warning" });
    // Đơn vị CŨ thắng quyết định cũ: dữ liệu đã đổi sau khi xác nhận ⇒ không được nói "Đã xác nhận".
    expect(nhanXacNhanBuoi({ ...goc, luat: "CU", quyetDinh: "CONFIRMED", donVi: "STALE" })).toMatchObject({ nhan: "Xác nhận đã cũ", tone: "warning" });
  });
  it("[GD7-07] luật MỚI: không có bước xác nhận tay — kỳ mở ⇒ 'Tính tự động theo ô'; đã ghi cứng ⇒ 'Đã ghi công'; kỳ chốt mà không có đơn vị ⇒ cảnh báo", () => {
    expect(nhanXacNhanBuoi({ ...goc, luat: "MOI", quyetDinh: null, donVi: null })).toMatchObject({ nhan: "Tính tự động theo ô", tone: "info" });
    expect(nhanXacNhanBuoi({ ...goc, luat: "MOI", quyetDinh: null, donVi: "CONFIRMED" })).toMatchObject({ nhan: "Đã ghi công", tone: "success" });
    expect(nhanXacNhanBuoi({ ...goc, luat: "MOI", quyetDinh: null, donVi: null, kyKhoa: true })).toMatchObject({ nhan: "Không có đơn vị công", tone: "warning" });
    // Một quyết định tay còn sót của kỳ luật mới KHÔNG được đọc là "Đã xác nhận".
    expect(nhanXacNhanBuoi({ ...goc, luat: "MOI", quyetDinh: "CONFIRMED", donVi: null }).nhan).not.toBe("Đã xác nhận");
  });
});
