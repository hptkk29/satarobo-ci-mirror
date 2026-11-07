// @vitest-environment node
// lib/orders/ke-hoach-da-bo.test.ts — KẾ HOẠCH THANH TOÁN CHIA ĐỢT ĐÃ BỎ [chủ dự án, 20/10/2026].
//
// Hành vi (action tạo đơn từ chối `keHoachDot`, đơn cũ vẫn thu được đợt) đã có ca riêng:
//   · tạo đơn từ chối, TRƯỚC mọi truy vấn:  lib/orders/pham-vi/cong-tao-don.test.ts  [ĐSC-08e/08f/10d]
//   · Postgres thật:                          tests/finance/don-pham-vi-ke-hoach-dot-db.test.ts  [P-D-DB-02/05/05b], don-pham-vi-db.test.ts [ĐSC-DB-07] [P6-DB-03]
//   · màn chi tiết:                           app/(admin)/admin/orders/_components/khoi-ke-hoach-don.test.tsx [P-D-10*]
//   · schema giữ khoá:                        lib/validators/order-ke-hoach.test.ts [VKH-*]
//
// Tệp này là LƯỚI GHIM DÂY NỐI cho phần hành vi KHÔNG chứng minh được: gỡ lời gọi cổng hay mọc lại đường ghi kế hoạch mà không
// ca hành vi nào đỏ (action chạm DB/phiên). Theo luật 11 của CLAUDE.md: bóc chú thích TRƯỚC khi đếm, neo biểu thức hẹp, đếm SỐ LẦN,
// KHÔNG neo vào chỗ đặt `await`. Mỗi ca dưới đây đã được CẤY LẠI LỖI (xem báo cáo PR).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";
import { LY_DO_DA_BO_KE_HOACH_DOT, lyDoTuChoiKeHoachDot } from "./ke-hoach-da-bo";

const doc = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;
/** Thân của một hàm export `export async function ten(` — tới dòng `}` ở cột 0. */
function thanHam(src: string, ten: string): string {
  const bat = src.indexOf(`export async function ${ten}(`);
  if (bat < 0) throw new Error(`không thấy hàm ${ten}`);
  const het = src.slice(bat).search(/\n\}\n/);
  if (het < 0) throw new Error(`không đóng được hàm ${ten}`);
  return src.slice(bat, bat + het + 2);
}

const ACTIONS = "app/(admin)/admin/orders/_actions.ts";

describe("[KHDC-01] lyDoTuChoiKeHoachDot — vị từ thuần", () => {
  it("rỗng ⇒ null; không rỗng ⇒ đúng một câu dùng chung cho máy chủ và màn hình", () => {
    expect(lyDoTuChoiKeHoachDot(undefined)).toBeNull();
    expect(lyDoTuChoiKeHoachDot(null)).toBeNull();
    expect(lyDoTuChoiKeHoachDot([])).toBeNull();
    expect(lyDoTuChoiKeHoachDot([{}])).toBe(LY_DO_DA_BO_KE_HOACH_DOT);
    expect(lyDoTuChoiKeHoachDot([{}, {}, {}, {}, {}])).toBe(LY_DO_DA_BO_KE_HOACH_DOT);
  });
});

describe("[KHDC-02] createOrderManualAction: cổng `keHoachDot` đứng TRƯỚC mọi truy vấn và mọi phép ghi", () => {
  const src = doc(ACTIONS);
  const than = thanHam(src, "createOrderManualAction");

  it("đúng MỘT lời gọi cổng, trả `ok:false` bằng chính câu của nó", () => {
    expect(dem(than, /lyDoTuChoiKeHoachDot\(data\.keHoachDot\)/g)).toBe(1);
    expect(dem(than, /if \(loiKeHoachDot\) return \{ ok: false as const, error: loiKeHoachDot \};/g)).toBe(1);
  });

  it("đứng SAU `safeParse` (cần dữ liệu đã parse) và TRƯỚC truy vấn đầu tiên / phép ghi đầu tiên / cổng sở hữu lead", () => {
    const cong = than.indexOf("lyDoTuChoiKeHoachDot(data.keHoachDot)");
    const parse = than.indexOf("orderCreateManualSchema.safeParse(input)");
    expect(parse).toBeGreaterThan(-1);
    expect(cong).toBeGreaterThan(parse);
    const truocCong = than.slice(parse, cong);
    // Từ lúc parse tới cổng chỉ được có `const data = parsed.data;` — không truy vấn, không ghi.
    expect(truocCong).not.toMatch(/\bawait\b|\.(create|update|updateMany|delete|deleteMany|upsert|findFirst|findMany|findUnique)\(|\$transaction/);
    // Và trước các mốc đầu tiên của hàm: cổng sở hữu lead, getSetting, giao dịch tạo đơn.
    for (const moc of ["checkOrderCreateOwnership(", "getSetting(", "$transaction(", "apDungMoHinhPhamVi("]) {
      const i = than.indexOf(moc);
      expect(i, moc).toBeGreaterThan(cong);
    }
  });

  it("KHÔNG còn đường ghi kế hoạch sau khi tạo đơn: không `recordInstallmentPlan`, không `canhBaoKeHoach`, không `dotsGhiTuForm`", () => {
    expect(dem(src, /recordInstallmentPlan/g)).toBe(0);
    expect(dem(src, /canhBaoKeHoach/g)).toBe(0);
    expect(dem(src, /dotsGhiTuForm/g)).toBe(0);
  });
});

describe("[KHDC-03] recordOrderInstallmentsAction chỉ còn là cổng từ chối; màn đơn không mọc lại đường sửa kế hoạch", () => {
  it("action: gác đăng nhập rồi trả câu chung — không đọc DB, không gọi lõi ghi kế hoạch", () => {
    const than = thanHam(doc(ACTIONS), "recordOrderInstallmentsAction");
    expect(than).toContain("LY_DO_DA_BO_KE_HOACH_DOT");
    expect(than).not.toMatch(/\b(db|sdb|scopedDb|tx)\b|recordInstallmentPlan|\$transaction|\.(create|update|updateMany|upsert)\(/);
    expect(dem(than, /return \{ ok: false, error: LY_DO_DA_BO_KE_HOACH_DOT \};/g)).toBe(1);
  });

  it("màn chi tiết: `OrderInstallmentsView` không có ô/nút sửa kế hoạch, không gọi action ghi kế hoạch; vẫn có lối thu đợt cũ", () => {
    const t = doc("app/(admin)/admin/orders/_components/order-payment-section.tsx");
    expect(t).not.toMatch(/recordOrderInstallmentsAction|useKeHoachDot|KeHoachDotEditor|Lưu kế hoạch|Thiết lập kế hoạch|Sửa kế hoạch/);
    expect(t).toContain("markOrderInstallmentPaidAction"); // đối chứng dương: đợt cũ vẫn thu được
    expect(dem(t, /Đánh dấu đã đóng/g)).toBe(1);
  });

  it("không tệp nào dưới app/ + components/ + lib/ còn import khối nhập kế hoạch cũ hay gọi action đã khoá", () => {
    const co: string[] = [];
    const di = (d: string) => {
      for (const ten of readdirSync(d)) {
        if (ten === "node_modules" || ten === ".next") continue;
        const p = join(d, ten);
        if (statSync(p).isDirectory()) di(p);
        else if (/\.(ts|tsx)$/.test(ten)) co.push(p);
      }
    };
    for (const g of ["app", "components", "lib"]) di(resolve(process.cwd(), g));
    // Phép quét phải THẤY tệp: rỗng là lưới chết mà vẫn xanh.
    expect(co.length).toBeGreaterThan(500);
    const loi: string[] = [];
    for (const f of co) {
      if (f.endsWith(".test.ts") || f.endsWith(".test.tsx")) continue;
      const s = readFileSync(f, "utf8");
      if (!s.includes("ke-hoach-dot-editor") && !s.includes("recordOrderInstallmentsAction")) continue;
      if (/ke-hoach-dot-editor/.test(s) && !f.endsWith("ke-hoach-da-bo.test.ts")) loi.push(`${f}: import khối nhập kế hoạch cũ`);
      // Chỉ định nghĩa trong _actions.ts mới được nhắc tên action đã khoá (ngoài chú thích).
      if (/recordOrderInstallmentsAction/.test(s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")) && !f.replace(/\\/g, "/").endsWith("orders/_actions.ts")) {
        loi.push(`${f}: gọi action kế hoạch đã khoá`);
      }
    }
    expect(loi).toEqual([]);
  }, 30_000);
});
