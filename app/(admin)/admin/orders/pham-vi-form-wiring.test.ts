// @vitest-environment node
/**
 * LƯỚI GHIM DÂY NỐI của giao diện tạo đơn theo phạm vi học (luật 11: prop cờ mà không ai truyền = lỗi CÂM).
 *
 * Hành vi của form đã có ca riêng (`order-create-form-pham-vi.test.tsx`); lưới này canh phần hành vi KHÔNG chứng minh được:
 *   · trang `/orders/new` thật sự TRUYỀN bảng cờ theo cơ sở, và dựng nó bằng hàm máy chủ (không gõ tay, không biết khoá cờ);
 *   · form KHAI prop ấy là bắt buộc — quên truyền thì `tsc` đỏ, không phải "mọi cơ sở tắt" trong im lặng;
 *   · quyết định ẩn khối kế hoạch và bỏ `keHoachDot` đi qua CÙNG một chế độ (`giaoDien`), không rẽ riêng ở hai nơi;
 *   · action xem trước gác trước khi đọc, chỉ đọc, và đi qua đường xem trước (không phải cổng tạo đơn lần hai).
 * Neo vào BIỂU THỨC (không neo vào chỗ đặt `await`) và đếm số lần khớp; đã bỏ chú thích trước khi so (luật 11 — chú thích giải
 * thích bản vá thường chứa đúng chuỗi đang canh).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), "utf8")
    .replace(/\r\n/g, "\n")
    // Bỏ chú thích khối và chú thích dòng (dòng chỉ có chú thích hoặc đuôi dòng sau khoảng trắng).
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const TRANG = "app/(admin)/admin/orders/new/page.tsx";
const FORM = "app/(admin)/admin/orders/_components/order-create-form.tsx";
const ACTION = "app/(admin)/admin/orders/_pham-vi-actions.ts";
const KHOI = "app/(admin)/admin/orders/_components/khoi-pham-vi.tsx";
const CREATE = "app/(admin)/admin/orders/_actions.ts";

describe("[P6-W1] trang tạo đơn TRUYỀN bảng cờ theo cơ sở", () => {
  const trang = doc(TRANG);
  it("[PB-W1] dựng bảng bằng hàm máy chủ trên ĐÚNG và ĐỦ danh sách cơ sở của form, rồi truyền xuống form", () => {
    // Neo ĐẾN dấu đóng ngoặc: chặn `.map((c) => c.id).slice(0, 1)` hay mọi phép cắt danh sách cơ sở [PB-W1].
    expect(dem(trang, /docCoSoBatPhamVi\(data\.centers\.map\(\(c\) => c\.id\)\)/g)).toBe(1);
    expect(dem(trang, /phamViBatTheoCoSo=\{phamViBatTheoCoSo\}/g)).toBe(1);
  });
  it("không biết khoá cờ và không tự đọc cờ", () => {
    expect(trang).not.toMatch(/laThuHocPhiTheoPhamViBat|getSetting\(["']billing\./);
  });
});

describe("[P6-W2] form: prop bắt buộc + một chế độ duy nhất quyết định cả hiển thị lẫn payload", () => {
  const form = doc(FORM);
  it("prop KHAI bắt buộc (không `?`, không mặc định) và được destructure", () => {
    expect(dem(form, /phamViBatTheoCoSo: Record<string, boolean>;/g)).toBe(1);
    expect(form).not.toMatch(/phamViBatTheoCoSo\s*\?:/);
    expect(form).not.toMatch(/phamViBatTheoCoSo\s*=\s*[{[]/);
    expect(dem(form, /^\s{2}phamViBatTheoCoSo,$/gm)).toBe(1);
  });
  it("chế độ tính MỘT chỗ bằng vị từ dùng chung, cờ lấy từ bảng của máy chủ", () => {
    expect(dem(form, /phanLoaiGiaoDienDon\(\{/g)).toBe(1);
    expect(form).toMatch(/phamViBat: orderCenterId != null && phamViBatTheoCoSo\[orderCenterId\] === true/);
  });
  it("khối kế hoạch nhiều đợt chỉ hiện khi KHÔNG theo phạm vi; khối phạm vi thay chỗ nó", () => {
    expect(dem(form, /\{!theoPhamVi && \(\s*<section/g)).toBe(1);
    expect(dem(form, /\{theoPhamVi && \(\s*<KhoiThuTheoPhamVi/g)).toBe(1);
  });
  it("`keHoachDot` đi qua chonKeHoachDotGui(giaoDien, …) và là chỗ DUY NHẤT dựng nó", () => {
    expect(dem(form, /keHoachDot:/g)).toBe(1);
    expect(dem(form, /keHoachDot: chonKeHoachDotGui\(\s*giaoDien,/g)).toBe(1);
  });
  it("cổng 'kế hoạch lệch / thiếu hạn' không chặn lưu vì khối đã ẩn", () => {
    expect(dem(form, /if \(khoaKeHoach == null && !theoPhamVi\) \{/g)).toBe(1);
  });
  it("payload xem trước và payload tạo đơn dựng bằng CÙNG một hàm dòng", () => {
    expect(dem(form, /dungItemDon\(/g)).toBeGreaterThanOrEqual(3); // định nghĩa + tạo đơn + xem trước
    expect(dem(form, /dong\.map\(\(d\) => dungItemDon\(d, orderType\)\)/g)).toBe(1);
    expect(dem(form, /dungItemDon\(d, orderType, 0\)/g)).toBe(1);
  });
  it("form không đọc cờ và không gọi cổng tạo đơn ngoài createOrderManualAction", () => {
    expect(form).not.toMatch(/laThuHocPhiTheoPhamViBat|getSetting\(["']billing\.|apDungMoHinhPhamVi/);
    expect(dem(form, /createOrderManualAction\(/g)).toBe(1);
  });
});

describe("[P6-W3] action xem trước: gác trước khi đọc, chỉ đọc, đi đường xem trước", () => {
  const goc = readFileSync(resolve(process.cwd(), ACTION), "utf8");
  const act = doc(ACTION);
  it("tệp 'use server'", () => {
    expect((goc.charCodeAt(0) === 0xfeff ? goc.slice(1) : goc).trimStart().startsWith('"use server"')).toBe(true);
  });
  it("auth → checkPermission(\"orders:create\") → (parse) → passesScope đứng TRƯỚC câu đọc đầu tiên", () => {
    const iAuth = act.indexOf("await auth()");
    const iQuyen = act.indexOf('checkPermission("orders:create")');
    const iScope = act.indexOf("passesScope(");
    const iDoc = act.indexOf(".findMany(");
    expect(iAuth).toBeGreaterThan(-1);
    expect(iQuyen).toBeGreaterThan(iAuth);
    expect(iScope).toBeGreaterThan(iQuyen);
    expect(iDoc).toBeGreaterThan(iScope);
  });
  it("không có phép ghi và không import db trần", () => {
    expect(act).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    expect(act).not.toMatch(/\$transaction|\$executeRaw|\$queryRaw|writeAudit|publishEvent/);
    expect(act).not.toMatch(/from "@\/lib\/db"/);
  });
  it("gọi xemTruocMoHinhPhamVi, KHÔNG gọi cổng tạo đơn apDungMoHinhPhamVi", () => {
    expect(dem(act, /xemTruocMoHinhPhamVi\(/g)).toBe(1);
    expect(act).not.toMatch(/apDungMoHinhPhamVi\(/);
  });
  it("[đối chứng] createOrderManualAction vẫn là nơi DUY NHẤT gọi apDungMoHinhPhamVi (một lời gọi)", () => {
    expect(dem(doc(CREATE), /apDungMoHinhPhamVi\(/g)).toBe(1);
  });
});

describe("[P6-W4] khối hiển thị không tự gọi máy chủ", () => {
  it("khoi-pham-vi.tsx không import action nào", () => {
    const khoi = doc(KHOI);
    expect(khoi).not.toMatch(/_actions|_pham-vi-actions|"use server"/);
  });
});
