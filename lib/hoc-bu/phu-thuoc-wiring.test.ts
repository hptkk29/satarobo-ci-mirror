// [PTW-*] — LƯỚI GHIM MÃ NGUỒN cho T14: xoá cứng đi qua cổng phụ thuộc, hoàn tiền một phần đi qua sự kiện, điều kiện xếp bằng phí tính theo SỐ TIỀN.
//
// Test hành vi (`tests/hoc-bu/phu-thuoc.test.ts`, `hoan-mot-phan.test.ts`) chứng minh cổng chặn đúng và xét lại đúng. Thứ nó KHÔNG canh: một đường xoá cứng MỚI
// (buổi / bài / điểm danh / đơn) mọc ra mà không qua cổng, đường hoàn tiền mới quên phát sự kiện, hay điều kiện "phí đủ" bị rút về chỉ-nhìn-trạng-thái-đơn.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");
const ma = (p: string) => boChuThich(doc(p));
function than(src: string, ten: string): string {
  const m = new RegExp(`(?:^|\\n)(?:export )?async function ${ten}\\(`).exec(src);
  expect(m, `không thấy hàm ${ten}`).not.toBeNull();
  const dau = m!.index;
  const ke = src.slice(dau + 10).search(/\n(?:\/\*\*|export (?:async )?function|(?:async )?function|export const|const|type|interface) /);
  return src.slice(dau, ke === -1 ? undefined : dau + 10 + ke);
}
function tepTs(dir: string): string[] {
  const ra: string[] = [];
  for (const t of readdirSync(resolve(process.cwd(), dir))) {
    const d = join(dir, t);
    if (statSync(resolve(process.cwd(), d)).isDirectory()) ra.push(...tepTs(d));
    else if (/\.tsx?$/.test(t) && !/\.test\.tsx?$/.test(t)) ra.push(d.split("\\").join("/"));
  }
  return ra;
}

describe("[PTW] T14 — cổng phụ thuộc, hoàn một phần, điều kiện phí", { timeout: 30_000 }, () => {
  it("[PTW-01] bốn đường xoá cứng gọi `kiemPhuThuocHocBu` / `demDongBuTroToiDon` TRƯỚC phép xoá, đúng loại", () => {
    const buoi = than(ma("app/(admin)/admin/sessions/_actions.ts"), "deleteSession");
    expect(buoi.indexOf('kiemPhuThuocHocBu("BUOI", [id])')).toBeGreaterThan(-1);
    expect(buoi.indexOf('kiemPhuThuocHocBu("BUOI", [id])')).toBeLessThan(buoi.indexOf("classSession.delete("));
    const dd = than(ma("app/(admin)/admin/attendance/_actions.ts"), "deleteAttendance");
    expect(dd.indexOf('kiemPhuThuocHocBu("DIEM_DANH", [id])')).toBeGreaterThan(-1);
    expect(dd.indexOf('kiemPhuThuocHocBu("DIEM_DANH", [id])')).toBeLessThan(dd.indexOf("attendance.delete("));
    const bai = than(ma("app/(admin)/admin/curriculums/_actions.ts"), "deleteLesson");
    expect(bai.indexOf('kiemPhuThuocHocBu("BAI", [id])')).toBeGreaterThan(-1);
    expect(bai.indexOf('kiemPhuThuocHocBu("BAI", [id])')).toBeLessThan(bai.indexOf("lesson.delete("));
    const don = ma("lib/orders/xoa-don-db.ts");
    expect(don).toContain("demDongBuTroToiDon(orderId),");
    expect(don).toContain("soDongHocBu,");
    expect(ma("lib/orders/xoa-don-huy.ts")).toContain("if (d.soDongHocBu > 0)");
  });

  it("[PTW-02] KIỂM KÊ: mọi `.classSession/.lesson/.attendance/.order(Item).delete(Many)` trong app/ và lib/ là một trong năm vị trí đã biết — đường xoá cứng MỚI phải qua cổng này", () => {
    const re = /\.(classSession|lesson|attendance|order|orderItem)\.(delete|deleteMany)\(/g;
    const tim: string[] = [];
    for (const f of [...tepTs("app"), ...tepTs("lib")]) {
      const n = (ma(f).match(re) ?? []).length;
      if (n > 0) tim.push(`${f}:${n}`);
    }
    expect(tim.sort()).toEqual(
      [
        "app/(admin)/admin/attendance/_actions.ts:1",
        "app/(admin)/admin/curriculums/_actions.ts:1",
        "app/(admin)/admin/sessions/_actions.ts:1",
        "lib/orders/xoa-don-db.ts:2",
      ].sort(),
    );
  });

  it("[PTW-03] hoàn tiền: CẢ HAI đường tạo dòng âm (`refundPayment`, chi hoàn tiền) phát `payment.refunded` TRONG giao dịch, sau khi tạo dòng hoàn", () => {
    const rp = than(ma("lib/finance/payment.ts"), "refundPayment");
    expect(rp.indexOf("tx.payment.create(")).toBeGreaterThan(-1);
    expect(rp.indexOf('publishEvent("payment.refunded"')).toBeGreaterThan(rp.indexOf("tx.payment.create("));
    expect(rp).toContain("{ tx, dedupeKey: `payment.refunded:${ref.id}` }");
    const ch = ma("lib/finance/chi-hoan-tien.ts");
    expect(ch.indexOf('publishEvent("payment.refunded"')).toBeGreaterThan(ch.indexOf("tx.payment.create("));
    expect(ch).toContain("{ tx, dedupeKey: `payment.refunded:${paymentIds[0]}` }");
    // Mọi nơi trong lib/ tạo dòng hoàn (`accountantStatus: "REFUNDED"` + amount âm) phải là một trong hai nơi trên.
    const tao = tepTs("lib")
      .filter((f) => /accountantStatus:\s*"REFUNDED"/.test(ma(f)) && /payment\.create\(/.test(ma(f)))
      .sort();
    expect(tao).toEqual(["lib/finance/chi-hoan-tien.ts", "lib/finance/payment.ts"]);
  });

  it("[PTW-04] handler `payment.refunded` đã đăng ký và gọi xét lại; xét lại chỉ động tới đơn CÒN SỐNG mà đã thu < tổng", () => {
    const h = ma("lib/_handlers/hoc-bu-don-doi.ts");
    expect(h).toContain('on("payment.refunded", onPaymentRefunded);');
    expect(h).toContain("xetLaiHoanMotPhan({ orderId, paymentId })");
    const d = than(ma("lib/hoc-bu/don-doi-db.ts"), "xetLaiSauKhiHoanMotPhan");
    expect(d).toContain("if (!phi || !donPhiConSong(phi) || phi.daThu >= phi.tongTien) return kq;");
    expect(d).toContain("docDongDuaVaoPhi(tx, phiItems.map((i) => i.id))"); // suất miễn phí không dựa vào tiền ⇒ bị lọc ở truy vấn dưới
    expect(ma("lib/hoc-bu/don-doi-db.ts")).toContain("freeApprovedAt: null, status: { in: [\"SCHEDULED\", \"COMPLETED\"] }");
    // Đã học thì KHÔNG gỡ khỏi case: nhánh gỡ chỉ cho SCHEDULED.
    const x = than(ma("lib/hoc-bu/don-doi-db.ts"), "xuLyDongMatPhi");
    expect(x).toContain('if (d.status === "SCHEDULED") {');
  });

  it("[PTW-05] điều kiện 'phí đủ' tính theo SỐ TIỀN (đã thu ≥ tổng), không chỉ trạng thái đơn — ở danh sách, ở xét lại, ở checker", () => {
    expect(ma("lib/hoc-bu/danh-sach-db.ts")).toContain("daThuDu: (thuTheoDon.get(p.order.id) ?? 0) >= p.order.totalAmount");
    const t = ma("lib/hoc-bu/toan-ven.ts");
    expect(t).toContain('"TV-50"');
    expect(t).toContain('luat: "TV-50"');
    expect(t).toContain("p.daThu < p.tongTien && (n.status === \"SCHEDULED\" || n.status === \"COMPLETED\")");
  });

  it("[PTW-06] tin 'cần thu phí' của thu thiếu khoá theo KHOẢN HOÀN (mỗi lần hoàn là sự việc mới); lần hết lượt đầu giữ khoá theo dòng", () => {
    const t = ma("lib/hoc-bu/thong-bao-thuan.ts");
    expect(t).toContain("canThuPhi: (makeupNeedId: string, moc?: string | null) =>");
    const d = than(ma("lib/hoc-bu/don-doi-db.ts"), "xetLaiSauKhiHoanMotPhan");
    expect(d).toContain("moc: p.paymentId, thieu: kq.conThieu");
    expect(d).toContain('if (d.status === "SCHEDULED") {');
  });
});
