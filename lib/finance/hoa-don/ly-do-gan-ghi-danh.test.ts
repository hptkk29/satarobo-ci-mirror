// Ca [LDG-*] — câu "vì sao chưa gắn được ghi danh" (GĐ 8b) + [GHD-W1] lưới ghim dây nối của action.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cauBoQuaGan } from "./ly-do-gan-ghi-danh";

const ctx = { tenBe: "Nguyễn Bé Một", soGhiDanh: 2, soBe: 2, khoaHoaDon: null };

describe("[LDG] câu lý do chưa gắn được", () => {
  it("[LDG-01] không câu nào đẩy người dùng sang màn Thanh toán để GẮN (đường đó từ chối đơn lập từ lead)", () => {
    for (const ma of ["KHONG_HOC_VIEN", "KHONG_GHI_DANH", "KHONG_KHOP", "MO_HO", "NGOAI_TAM", "PHAI_TACH_DA_KHOA"] as const) {
      expect(cauBoQuaGan(ma, ctx)).not.toMatch(/Thanh toán/);
    }
    expect(cauBoQuaGan("MO_HO", ctx)).toBe("Bé Nguyễn Bé Một có 2 ghi danh cùng khoá — hệ thống không đoán; báo Quản trị hệ thống");
  });

  it("[LDG-02] khoản phải tách mà đang bị khoá: việc cần làm theo TRẠNG THÁI hoá đơn đang giữ", () => {
    expect(cauBoQuaGan("PHAI_TACH_DA_KHOA", { ...ctx, khoaHoaDon: { trangThai: "NHAP", so: "1C26TSR-127" } })).toBe(
      "Khoản phải chia cho 2 bé nhưng đang nằm trong hoá đơn nháp 1C26TSR-127 — gỡ bản nháp, gắn ghi danh rồi tải lại hoá đơn",
    );
    expect(cauBoQuaGan("PHAI_TACH_DA_KHOA", { ...ctx, khoaHoaDon: { trangThai: "DA_XAC_NHAN", so: "1C26TSR-128" } })).toMatch(
      /đã nằm trong hoá đơn 1C26TSR-128 .* huỷ hoá đơn, gắn ghi danh rồi xuất lại/,
    );
    expect(cauBoQuaGan("PHAI_TACH_DA_KHOA", { ...ctx, khoaHoaDon: { trangThai: "KHONG_XUAT", so: "" } })).toMatch(/gỡ dấu, gắn ghi danh/);
  });
});

describe("[GHD-W1] màn hoá đơn gắn qua lõi dựng-lại-có-dấu, KHÔNG qua action của màn Thanh toán", () => {
  // Bỏ chú thích trước khi so — chú thích ở action nhắc đúng tên hàm đang cấm (luật 11).
  const ma = readFileSync(resolve(process.cwd(), "app/(admin)/admin/payments/hoa-don/_actions.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

  it("gọi `ganGhiDanhTuManHoaDon(` đúng một lần, không nhắc `ganGhiDanhChoKhoanAction`", () => {
    expect(ma.match(/ganGhiDanhTuManHoaDon\(/g)?.length).toBe(1);
    expect(ma).not.toMatch(/ganGhiDanhChoKhoanAction/);
  });

  it("gửi dấu kế hoạch người bấm đã xem vào lõi (không tự dựng dấu ở action)", () => {
    expect(ma).toMatch(/dauKeHoach: v\.dauKeHoach/);
    expect(ma).not.toMatch(/dauKeHoachGan\(/);
  });
});
