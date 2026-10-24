// @vitest-environment node
/**
 * [PVG-W*] — LƯỚI GHIM MÃ NGUỒN cho PHẠM VI GHI (N9 mở rộng). Hành vi đã có ca Postgres (`[PVG-01..03]`); lưới này canh thứ ca hành vi KHÔNG bắt được: «một đường GHI mới
 * dùng `passesScope` trần». Neo hẹp, bỏ chú thích TRƯỚC khi đếm, đếm SỐ LẦN (luật 11).
 *
 *   [PVG-W1] mỗi đường GHI đã biết gác bằng `coQuyenTaiCoSo` với ĐÚNG khoá của nó, đúng số chỗ
 *   [PVG-W2] chỉ MỘT định nghĩa «giữ khoá tại cơ sở» (vòng lặp `p.action !== key` nằm ở lib/auth/quyen-tai-co-so.ts và nơi nào khác cũng không chép)
 *   [PVG-W3] TRIPWIRE: mọi tệp trong lib/hoa-hong + lib/affiliate gọi `passesScope` trên model hoa hồng / affiliate phải hoặc gọi `coQuyenTaiCoSo`/`coQuyenQuanLyKyTai`/`coQuyenXuLyTai`,
 *            hoặc nằm trong danh sách NGOẠI LỆ có lý do — thêm đường ghi mới mà quên gác là đỏ ở đây
 *   [PVG-W4] đổi nguồn LEAD (`doiNguonLead` + nút `docChoGanNguon`): cùng hỏi ba khoá GHI nguồn qua `kiemQuyenGhiTaiCoSo` (= kiemQuyen VÀ coQuyenTaiCoSo tại cơ sở của lead), không `p.kiemQuyen(` trần
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const boChuThich = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const doc = (p: string): string => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n"));
const dem = (s: string, mau: RegExp): number => (s.match(new RegExp(mau.source, mau.flags.includes("g") ? mau.flags : `${mau.flags}g`)) ?? []).length;

describe("[PVG-W] phạm vi GHI = giữ ĐÚNG khoá tại cơ sở", () => {
  it("[PVG-W1] mỗi đường ghi đã biết gác bằng coQuyenTaiCoSo với đúng khoá, đúng số chỗ", () => {
    // đề xuất: khoá theo NGUỒN GỐC (`khoa`), cơ sở của ĐỀ XUẤT
    expect(dem(doc("lib/hoa-hong/duyet-de-xuat.ts"), /coQuyenTaiCoSo\(nguoi\.quyen, khoa, req\.centerId\)/g)).toBe(1);
    // khiếu nại: người xử lý (cổng chung) + người được GIAO LẠI
    const kn = doc("lib/hoa-hong/khieu-nai.ts");
    expect(dem(kn, /coQuyenTaiCoSo\(nguoi\.quyen, KEY_DUYET_KHIEU_NAI, d\.centerId\)/g)).toBe(1);
    expect(dem(kn, /coQuyenTaiCoSo\(a, KEY_DUYET_KHIEU_NAI, d\.centerId\)/g)).toBe(1);
    // referral: xử lý (lần đọc ngoài + lần đọc lại trong giao dịch) + khai tay lên phiếu
    const rf = doc("lib/affiliate/ghi-referral-xu-ly.ts");
    expect(dem(rf, /coQuyenTaiCoSo\(p\.actor, KHOA_QUYEN_XU_LY_REFERRAL, thay\.centerId\)/g)).toBe(1);
    expect(dem(rf, /coQuyenTaiCoSo\(p\.actor, KHOA_QUYEN_XU_LY_REFERRAL, cu\.centerId\)/g)).toBe(1);
    expect(dem(rf, /coQuyenTaiCoSo\(p\.actor, KHOA_QUYEN_XU_LY_REFERRAL, lead\.centerId\)/g)).toBe(1);
    // kỳ: định nghĩa tab Kỳ/hàng chờ ủy quyền cho hàm chung
    expect(dem(doc("lib/hoa-hong/ky-service.ts"), /return coQuyenTaiCoSo\(actor, KEY_XU_LY_HANG_CHO, centerId\)/g)).toBe(1);
  });

  it("[PVG-W2] chỉ MỘT định nghĩa «giữ khoá tại cơ sở»", () => {
    expect(dem(doc("lib/auth/quyen-tai-co-so.ts"), /p\.action !== key/g)).toBe(1);
    for (const f of ["lib/hoa-hong/ky-service.ts", "lib/hoa-hong/duyet-de-xuat.ts", "lib/hoa-hong/khieu-nai.ts", "lib/hoa-hong/hang-cho-xu-ly-service.ts", "lib/affiliate/ghi-referral-xu-ly.ts"]) {
      expect(dem(doc(f), /p\.action !== /g), f).toBe(0);
    }
  });

  it("[PVG-W3] TRIPWIRE: tệp gọi passesScope trên model hoa hồng / affiliate đều có cổng khoá-tại-cơ-sở, trừ ngoại lệ có lý do", () => {
    const MODEL = /passesScope\("(Commission[A-Za-z]*|Affiliate[A-Za-z]*|StudentTransaction)"/;
    const GATE = /coQuyenTaiCoSo\(|coQuyenQuanLyKyTai\(|coQuyenXuLyTai\(/;
    // Ngoại lệ ĐÃ BIẾT: `giaiHangCho` chỉ được gọi từ service hàng chờ — nơi đã gác `coQuyenXuLyTai` trước (HCX-W1 ghim «nơi DUY NHẤT gọi giaiHangCho»).
    const NGOAI_LE = new Set(["lib/hoa-hong/giai-hang-cho.ts"]);
    const thieu: string[] = [];
    for (const thuMuc of ["lib/hoa-hong", "lib/affiliate"]) {
      for (const ten of readdirSync(resolve(process.cwd(), thuMuc))) {
        if (!ten.endsWith(".ts") || ten.endsWith(".test.ts")) continue;
        const duongDan = `${thuMuc}/${ten}`;
        const src = doc(duongDan);
        if (MODEL.test(src) && !GATE.test(src) && !NGOAI_LE.has(duongDan)) thieu.push(duongDan);
      }
    }
    expect(thieu, "đường GHI dùng passesScope trần (nhìn thấy ≠ được ghi) — thêm coQuyenTaiCoSo(actor, <khoá ghi>, centerId)").toEqual([]);
    // ngoại lệ phải còn đúng là «bare passesScope + không có cổng» — hết đúng thì gỡ khỏi danh sách (không để ngoại lệ chết)
    for (const f of NGOAI_LE) expect(MODEL.test(doc(f)) && !GATE.test(doc(f)), f).toBe(true);
  });

  it("[PVG-W4] đổi nguồn LEAD: cổng GHI (doi-nguon-lead) và NÚT (doc-gan-nguon) cùng hỏi quyền qua kiemQuyenGhiTaiCoSo, không còn p.kiemQuyen trần; hàm bọc đòi coQuyenTaiCoSo tại cơ sở của lead", () => {
    const BA_KHOA = ["leads:overwrite", "sources:override-after-payment", "sources:manage"];
    // (tệp, tên biến lead truyền vào hàm bọc)
    for (const [f, lead] of [["lib/nguon/doi-nguon-lead.ts", "lead"], ["lib/nguon/doc-gan-nguon.ts", "l"]] as const) {
      const src = doc(f);
      expect(dem(src, new RegExp(`const kiemQuyen = kiemQuyenGhiTaiCoSo\\(p\\.actor, p\\.kiemQuyen, ${lead}\\);`, "g")), `${f}: đúng MỘT lần bọc`).toBe(1);
      expect(dem(src, /\bp\.kiemQuyen\s*\(/g), `${f}: không còn hỏi quyền TRẦN qua p.kiemQuyen(`).toBe(0);
      for (const k of BA_KHOA) expect(dem(src, new RegExp(`(?<![.\\w])kiemQuyen\\("${k}", target\\)`, "g")), `${f}: ${k}`).toBe(1);
    }
    // hàm bọc: một cổng coQuyenTaiCoSo, đúng khoá đang hỏi, cơ sở của LEAD; bảng ba khoá lấy từ KHOA_QUYEN_DOI_NGUON (không chép chuỗi)
    const bo = doc("lib/nguon/quyen-ghi-tai-co-so.ts");
    expect(dem(bo, /coQuyenTaiCoSo\(actor, action, lead\.centerId\)/g)).toBe(1);
    expect(dem(bo, /KHOA_GHI_NGUON\.has\(action\)/g)).toBe(1);
    for (const k of ["truocThuc", "sauThuc", "khoa"]) expect(dem(bo, new RegExp(`KHOA_QUYEN_DOI_NGUON\\.${k}`, "g")), k).toBe(1);
    // tripwire: không tệp nào khác trong lib/nguon + màn lead hỏi một khoá GHI nguồn bằng kiemQuyen trần
    const la: string[] = [];
    for (const thuMuc of ["lib/nguon", "app/(admin)/admin/leads"]) {
      for (const ten of readdirSync(resolve(process.cwd(), thuMuc))) {
        if (!ten.endsWith(".ts") && !ten.endsWith(".tsx")) continue;
        const duongDan = `${thuMuc}/${ten}`;
        if (ten.endsWith(".test.ts") || ["lib/nguon/doi-nguon-lead.ts", "lib/nguon/doc-gan-nguon.ts"].includes(duongDan)) continue;
        if (/kiemQuyen\(\s*"(leads:overwrite|sources:override-after-payment|sources:manage)"/.test(doc(duongDan))) la.push(duongDan);
      }
    }
    expect(la, "tệp hỏi khoá GHI nguồn bằng kiemQuyen trần (nhìn thấy ≠ được ghi) — dùng kiemQuyenGhiTaiCoSo").toEqual([]);
  });
});
