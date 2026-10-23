// Ca [GKC-*] — LƯỚI GHIM dây nối của #666: Chuyển đổi đơn PHẢI gắn khoản đã thu vào ghi danh.
//
// Hành vi (khoản gắn đúng bé, đơn phạm vi, người cấp cơ sở…) do `tests/finance/chuyen-doi-gan-khoan.test.ts` đo trên Postgres
// thật. Tệp này canh thứ test hành vi KHÔNG canh được: gỡ LỜI GỌI khỏi action thì không ca nào của một hàm thuần đỏ — chỉ
// việc đọc chính mã nguồn mới thấy. Luật 11: bóc chú thích trước khi soi · neo LỜI GỌI (không neo tên — dòng `import` cũng chứa
// tên) · khẳng định cả SỐ LẦN khớp. Luật 8: đã cấy thử — xem khối "BƯỚC CẤY" cuối tệp.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { soDongKhoaChuaChuyen } from "./gan-khoan-sau-chuyen-doi";

const ACTION = "app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts";
const HELPER = "lib/finance/gan-khoan-sau-chuyen-doi.ts";

/** Bóc khối `/* *\/` TRƯỚC rồi mới bóc `//` (thứ tự ngược `[BCD-01]`; `(^|[^:])` giữ `https://`). */
function docMa(duong: string): string {
  return readFileSync(resolve(process.cwd(), duong), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const dem = (s: string, re: RegExp) => s.match(new RegExp(re.source, "g"))?.length ?? 0;

describe("[GKC-01] soDongKhoaChuaChuyen — đếm dòng KHOÁ HỌC chưa có ghi danh", () => {
  const khoa = { courseId: "k1" };
  it("không dòng nào ⇒ 0; mọi dòng khoá đã chuyển ⇒ 0", () => {
    expect(soDongKhoaChuaChuyen([])).toBe(0);
    expect(soDongKhoaChuaChuyen([{ enrollmentId: "g1", metadata: khoa }])).toBe(0);
  });
  it("dòng khoá chưa chuyển ⇒ tính; hai bé chuyển một ⇒ 1", () => {
    expect(
      soDongKhoaChuaChuyen([
        { enrollmentId: "g1", metadata: khoa },
        { enrollmentId: null, metadata: { courseId: "k2" } },
      ]),
    ).toBe(1);
  });
  it("dòng KHÔNG phải khoá học (không courseId / metadata lạ) không chặn việc gắn", () => {
    expect(
      soDongKhoaChuaChuyen([
        { enrollmentId: null, metadata: null },
        { enrollmentId: null, metadata: {} },
        { enrollmentId: null, metadata: [] },
        { enrollmentId: null, metadata: { courseId: "" } },
        { enrollmentId: "g1", metadata: khoa },
      ]),
    ).toBe(0);
  });
});

describe("[GKC-02] action gọi bước gắn ĐÚNG MỘT lần, TRONG transaction, SAU khi tạo ghi danh", () => {
  const ma = docMa(ACTION);
  const iGoi = ma.indexOf("ganKhoanSauChuyenDoi(tx");

  it("đúng một LỜI GỌI `ganKhoanSauChuyenDoi(tx` (không tính dòng import)", () => {
    expect(dem(ma, /\bganKhoanSauChuyenDoi\s*\(\s*tx\b/)).toBe(1);
    expect(iGoi).toBeGreaterThan(-1);
  });
  it("nằm giữa phần mở transaction và khối `catch` của nó — rơi ra ngoài là mất tính nguyên tử với ghi danh", () => {
    expect(iGoi).toBeGreaterThan(ma.indexOf("sdb.$transaction("));
    expect(iGoi).toBeLessThan(ma.lastIndexOf("} catch (e)"));
  });
  it("đứng SAU lệnh gán `OrderItem.enrollmentId` (mọi ghi danh đã tạo) và TRƯỚC nhật ký CONVERT + lời hích sau commit", () => {
    expect(iGoi).toBeGreaterThan(ma.indexOf("tx.orderItem.update("));
    expect(iGoi).toBeLessThan(ma.indexOf('action: "CONVERT"'));
    // `main` chưa có lời hích quyền học (module `lib/entitlements/hich` chưa lên prod) ⇒ chỉ ép thứ tự khi nó có mặt.
    const iHich = ma.indexOf("hichCapQuyenHocChoDon(");
    if (iHich !== -1) expect(iGoi).toBeLessThan(iHich);
  });
  it("kết quả được ghi vào nhật ký CONVERT (kế toán lần ngược được vì sao khoản chưa gắn)", () => {
    expect(ma).toMatch(/newValues:\s*\{[\s\S]*?\bganKhoan\b/);
  });
});

describe("[GKC-03] helper: cổng 'còn dòng chưa chuyển' ĐỨNG TRƯỚC lời gọi hàm gắn, và loại khoản đã xác nhận thay vì ném", () => {
  const ma = docMa(HELPER);
  const iGoiGan = ma.search(/\bganGhiDanhChoKhoanCuaDon\s*\(\s*tx\b/);

  it("đúng một lời gọi `ganGhiDanhChoKhoanCuaDon(tx`", () => {
    expect(dem(ma, /\bganGhiDanhChoKhoanCuaDon\s*\(\s*tx\b/)).toBe(1);
  });
  it("cổng `soDongKhoaChuaChuyen(` chạy TRƯỚC lời gọi gắn", () => {
    // Neo `= soDongKhoaChuaChuyen(dong)`: phần ĐỊNH NGHĨA hàm (`function soDongKhoaChuaChuyen(\n dong: …`) cũng khớp
    // `soDongKhoaChuaChuyen(` + `dong` — cấy thử (G3) cho thấy neo hẹp hơn thì lưới vẫn xanh khi cổng bị vô hiệu.
    expect(dem(ma, /=\s*soDongKhoaChuaChuyen\s*\(\s*dong\s*\)/)).toBe(1);
    const iCong = ma.search(/=\s*soDongKhoaChuaChuyen\s*\(\s*dong\s*\)/);
    expect(iCong).toBeGreaterThan(-1);
    expect(iCong).toBeLessThan(iGoiGan);
  });
  it('truyền `khoanDaXacNhan: "BO_QUA"` (mặc định của hàm gắn là NÉM — gỡ dòng này là một khoản xác nhận làm hỏng cả lượt chuyển đổi)', () => {
    expect(dem(ma, /khoanDaXacNhan:\s*"BO_QUA"/)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BƯỚC CẤY — luật 8. Kết quả thật ghi ở commit message / PR.
//  1. [GKC-02] đổi lời gọi ở action thành một biến giả (hoặc dời nó ra sau `} catch (e)`) → phải ĐỎ.
//  2. [GKC-02] dời lời gọi lên TRƯỚC `tx.orderItem.update(` → phải ĐỎ.
//  3. [GKC-03] đổi `"BO_QUA"` thành `"NEM"` → phải ĐỎ.
//  4. [GKC-03] đặt cổng `soDongKhoaChuaChuyen(` sau lời gọi gắn → phải ĐỎ.
// ═══════════════════════════════════════════════════════════════════════════
