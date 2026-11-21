// [SLW-*] — LƯỚI GHIM MÃ NGUỒN cho T06: sổ lượt chỉ ghi ở MỘT nơi, và mọi đường vòng đời lượt gọi nó ĐÚNG CHỖ.
//
// Hành vi đã có test thật trên Postgres (`tests/hoc-bu/so-luot.test.ts`, `phi-hoc-bu.test.ts`). Thứ chúng KHÔNG canh: một đường xếp /
// gỡ / điểm danh MỚI (hay một đường cũ bị sửa) quên gọi sổ — mọi test hành vi của đường đó vẫn xanh vì sổ không phải thứ nó khẳng định,
// và lỗi chỉ lộ ra ở checker TV-33 sau khi dữ liệu đã lệch. Cách làm theo CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN": bóc chú thích,
// neo chuỗi HẸP vào LỜI GỌI, khẳng định THỨ TỰ (luật rollback: cổng đứng trước phép ghi) và đếm số lần khớp.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");
const ma = (p: string) => boChuThich(doc(p));
/** Thân của một hàm top-level (async function ten( … đến hàm/khai báo top-level kế tiếp). */
function than(src: string, ten: string): string {
  const m = new RegExp(`(?:^|\\n)(?:export )?async function ${ten}\\(`).exec(src);
  expect(m, `không thấy hàm ${ten}`).not.toBeNull();
  const dau = m!.index;
  const ke = src.slice(dau + 10).search(/\n(?:\/\*\*|export (?:async )?function|(?:async )?function|export const|const|type|interface) /);
  return src.slice(dau, ke === -1 ? undefined : dau + 10 + ke);
}
const vi = (s: string, x: string) => {
  const i = s.indexOf(x);
  expect(i, `không thấy "${x}"`).toBeGreaterThanOrEqual(0);
  return i;
};
const dem = (s: string, x: string) => s.split(x).length - 1;

const SOLUOT = "lib/hoc-bu/so-luot.ts";
const CASE = "lib/hoc-bu/case-db.ts";
const GHI_SO = /\bmakeupCredit(Account|Entry)\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(/g;

describe("[SLW] T06 — sổ lượt: một nơi ghi, mọi đường vòng đời đi qua nó", { timeout: 30_000 }, () => {
  it("[SLW-01] kiểm kê: ghi `MakeupCreditAccount`/`MakeupCreditEntry` CHỈ ở `so-luot.ts` (3 lời gọi) — không chỗ nào khác trong app/ + lib/", () => {
    const tep = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "app/**/*.ts", "app/**/*.tsx", "lib/**/*.ts", "lib/**/*.tsx"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter((f) => f && !/\.(test|spec)\.tsx?$/.test(f));
    expect(tep.length, "quét ra quá ít tệp — sai cwd? lưới đang không chạm tới gì").toBeGreaterThan(500);
    const thuc: Record<string, number> = {};
    const tho: string[] = [];
    for (const f of tep) {
      const src = boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));
      const n = (src.match(GHI_SO) ?? []).length;
      if (n > 0) thuc[f] = n;
      if (/(UPDATE|INSERT INTO|DELETE FROM)\s+"MakeupCredit(Account|Entry)"/i.test(src)) tho.push(f);
    }
    // 3 = tạo tài khoản (createMany), tạo bút toán (createMany), cập nhật số tài khoản (update).
    expect(Object.keys(thuc), "ghi sổ lượt ngoài so-luot.ts").toEqual([SOLUOT]);
    expect(thuc[SOLUOT]).toBe(3);
    expect(tho, "SQL thô ghi sổ lượt").toEqual([]);
  });

  it("[SLW-02] mọi bút toán đi qua MỘT hàm (`ghiNhieuButToan`) và nó KIỂM TRÙNG khoá chống lặp TRƯỚC khi áp", () => {
    const s = ma(SOLUOT);
    const g = than(s, "ghiNhieuButToan");
    expect(dem(g, "makeupCreditEntry.createMany")).toBe(1);
    expect(vi(g, "makeupCreditEntry.findMany")).toBeLessThan(vi(g, "apButToan("));
    expect(vi(g, "apButToan(")).toBeLessThan(vi(g, "makeupCreditEntry.createMany"));
    // createMany KHÔNG skipDuplicates: trùng sau khi đã lọc là lỗi thật chứ không phải chạy lại.
    expect(g).not.toMatch(/skipDuplicates/);
    expect(vi(g, "makeupCreditEntry.createMany")).toBeLessThan(vi(g, "makeupCreditAccount.update"));
  });

  it("[SLW-03] hàng tài khoản bị KHOÁ (`FOR UPDATE`) trước khi đọc số; tạo tài khoản đứng TRƯỚC khoá", () => {
    const k = than(ma(SOLUOT), "khoaTaiKhoan");
    expect(vi(k, "makeupCreditAccount.createMany")).toBeLessThan(vi(k, "FOR UPDATE"));
    expect(k).toMatch(/FOR UPDATE/);
    // Chỉ khởi tạo (replay dữ liệu cũ) khi chính lượt này tạo hàng.
    expect(k).toMatch(/moi\.count !== 1\) return tk/);
  });

  it("[SLW-04] xếp case: KHỞI TẠO sổ → tạo mục case → GIỮ lượt (thứ tự là luật: khởi tạo sau sẽ tự bù lượt cho chính mục vừa tạo)", () => {
    const g = than(ma(CASE), "ghiBeVaoCase");
    const a = vi(g, "khoaTaiKhoan(");
    const b = vi(g, "makeupCaseStudent.createManyAndReturn");
    const c = vi(g, "giuLuot(");
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(dem(g, "giuLuot(")).toBe(1);
    // Chỉ mục xếp BẰNG LƯỢT mới giữ lượt.
    expect(g).toMatch(/\.filter\(\(m\) => m\.dungLuot\)/);
  });

  it("[SLW-05] gỡ bé / huỷ case: NHẢ lượt TRƯỚC khi xoá mục case (sổ cần thấy mục để phát lại lượt đang giữ của dữ liệu cũ)", () => {
    // T07: mục bị gỡ KHÔNG bị xoá (giữ làm lịch sử — RELEASED), nên "nhả TRƯỚC khi xoá" thành "nhả TRƯỚC khi đổi kết quả mục":
    // `doiKetQuaMuc` gọi sổ lượt (theo bảng `chuyenMuc`) rồi mới `makeupCaseStudent.updateMany`. Mọi đường gỡ / huỷ đều đi qua nó.
    const s = ma(CASE);
    const dd = ma("lib/hoc-bu/case-diem-danh-db.ts");
    const doi = than(dd, "doiKetQuaMuc");
    expect(vi(doi, "nhaLuot(")).toBeLessThan(vi(doi, "makeupCaseStudent.updateMany"));
    expect(vi(doi, "daoTieuLuot(")).toBeLessThan(vi(doi, "makeupCaseStudent.updateMany"));
    expect(doi).toContain('case "NHA":');
    expect(s).not.toMatch(/makeupCaseStudent\.(delete|deleteMany)\(/);
    expect(dd).not.toMatch(/makeupCaseStudent\.(delete|deleteMany)\(/);
    // Nút "Gỡ", đường xét lại khi đơn phí đổi và "Huỷ case" đều dùng CHÍNH các hàm dùng chung — không bản chép riêng.
    expect(than(s, "goKhoiCase")).toMatch(/nhaMucTrongTx\(/);
    expect(than(s, "goBeKhoiCaseTrongTx")).toMatch(/nhaMucTrongTx\(/);
    expect(than(s, "goBeKhoiCase")).toMatch(/nhaMucTrongTx\(/);
    expect(than(s, "huyCase")).toMatch(/doiKetQuaMuc\(/);
  });

  it("[SLW-06] điểm danh bù: có mặt ⇒ TIÊU, vắng ⇒ NHẢ — trong giao dịch, SAU khoá case, TRƯỚC khi đổi trạng thái mục case", () => {
    // T07: sổ lượt được gọi từ `doiKetQuaMuc` theo BẢNG `chuyenMuc` (chỉ mục xếp bằng lượt mới có việc với sổ: `luot("…")` ⇒ KHONG khi
    // `dungLuot = false`), SAU khoá case (ở `ganDiemDanhBeTrongTx`), TRƯỚC khi đổi kết quả mục.
    const g = ma("lib/hoc-bu/case-diem-danh-db.ts");
    const chung = than(g, "ganDiemDanhBeTrongTx");
    const dd = than(g, "doiKetQuaMuc");
    expect(vi(chung, 'FROM "MakeupCase" WHERE id')).toBeLessThan(vi(chung, "doiKetQuaMuc("));
    const tieu = vi(dd, "tieuLuot(");
    const nha = vi(dd, "nhaLuot(");
    const doi = vi(dd, "makeupCaseStudent.updateMany");
    expect(tieu).toBeLessThan(doi);
    expect(nha).toBeLessThan(doi);
    expect(dd).toContain("daGiu: true");
    expect(dd).toContain("daGiu: false");
    expect(ma("lib/hoc-bu/case-nhieu-bai-thuan.ts")).toContain("const luot = (v: ViecLuot): ViecLuot => (dungLuot ? v : \"KHONG\");");
  });

  it("[SLW-07] màn danh sách ĐỌC SỔ khi có tài khoản và dùng CHUNG hàm công thức với sổ (không bản đếm thứ hai)", () => {
    const ds = ma("lib/hoc-bu/danh-sach-db.ts");
    expect(ds).toMatch(/docSoLuot\(/);
    expect(ds).toMatch(/tongLuotCongThuc\(/);
    expect(ds).toMatch(/tk \? tk\.granted/);
    expect(ds).not.toMatch(/tongLuotBu\(/); // phép đếm thô chỉ còn ở luot-cong-thuc-db.ts
    expect(ma("lib/hoc-bu/so-luot.ts")).toMatch(/tongLuotCongThuc\(/);
    // Màn đọc KHÔNG tạo tài khoản.
    expect(ds).not.toMatch(/khoaTaiKhoan|makeupCreditAccount\.(create|update)/);
  });

  it("[SLW-08] miễn phí: khoá ĐƠN đứng ĐẦU transaction, rồi mới VOID tiền; đơn phí chỉ huỷ khi PENDING_PAYMENT và chưa có tiền", () => {
    const m = than(ma(CASE), "mienPhiBu");
    const tx = vi(m, "db.$transaction(");
    expect(vi(m, "khoaDonTrongTx(tx")).toBeGreaterThan(tx);
    expect(vi(m, "khoaDonTrongTx(tx")).toBeLessThan(vi(m, 'FROM "MakeupNeed"'));
    expect(vi(m, "khoaDonTrongTx(tx")).toBeLessThan(vi(m, "voidTienKhiHuyDonTrongTx("));
    expect(vi(m, "phi.daThu > 0")).toBeLessThan(vi(m, "order.updateMany"));
    expect(vi(m, 'phi.orderStatus !== "PENDING_PAYMENT"')).toBeLessThan(vi(m, "order.updateMany"));
    // Mọi cổng từ chối đứng TRƯỚC phép ghi đầu tiên (luật rollback).
    expect(vi(m, "phi.daThu > 0")).toBeLessThan(vi(m, "order.updateMany"));
    expect(m).toMatch(/where: \{ id: phi\.orderId, status: "PENDING_PAYMENT" \}/);
  });

  it("[SLW-09] huỷ/hoàn đơn PHÁT sự kiện `order.voided` TRONG transaction (có khoá chống lặp) và handler đã đăng ký", () => {
    const a = ma("app/(admin)/admin/orders/_actions.ts");
    const body = than(a, "changeOrderStatusAction");
    const tx = vi(body, "sdb.$transaction(");
    const ev = vi(body, 'publishEvent(\n        "order.voided"');
    expect(ev).toBeGreaterThan(tx);
    expect(body).toMatch(/dedupeKey: `order\.voided:\$\{orderId\}:\$\{parsed\.data\.toStatus\}`/);
    expect(body).toMatch(/\{ tx, dedupeKey/);
    expect(ev).toBeGreaterThan(vi(body, "voidTienKhiHuyDonTrongTx("));
    expect(body).toMatch(/toStatus === "CANCELLED" \|\| parsed\.data\.toStatus === "REFUNDED"/);
    expect(ma("lib/events/register.ts")).toMatch(/registerHocBuDonDoiHandlers\(\)/);
    expect(ma("lib/_handlers/hoc-bu-don-doi.ts")).toMatch(/on\("order\.voided"/);
  });

  it("[SLW-10] huỷ không bù: ĐỌC phí SAU phép huỷ và lỗi đọc không làm hỏng phép huỷ; kết quả mang lời nhắn", () => {
    const h = than(ma("app/(admin)/admin/hoc-bu/_actions.ts"), "huyBuoiCanBuAction");
    expect(vi(h, "$transaction(")).toBeLessThan(vi(h, "canhBaoPhiKhiHuy("));
    expect(h).toMatch(/canhBaoPhiKhiHuy\([^)]*\)\.catch\(\(\) => null\)/);
    expect(h).toMatch(/canhBao \? \{ ok: true, canhBao \}/);
  });
});
