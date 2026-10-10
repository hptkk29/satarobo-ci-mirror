/**
 * Ca [CBX-W1..W2] — LƯỚI GHIM DÂY NỐI: cảnh báo của route nhập lead Excel đi KÊNH RIÊNG (`warnings`), không lẫn vào `errors`.
 *
 * Sự cố (10/10/2026): route đẩy 5 loại câu "dòng đã được tạo nhưng cần xem" vào CHUNG mảng `errors` với tiền tố "⚠️", trong khi
 * `ImportOutcome` chỉ biết tiền tố "ℹ️" là vô hại ⇒ nhập 10 dòng, 3 mã NV sai ra "Tạo mới 10 | Lỗi 3 | 3 dòng KHÔNG được ghi" dù cả 10
 * lead đã vào (cùng kiểu sự cố 03/08 → người nhập tưởng hỏng, nhập lại, nhân đôi lead).
 *
 * Vì sao cần lưới đọc MÃ NGUỒN dù đã có ca hành vi: ca hành vi ([EMNV-D11], [EMNV-D12]) chạm Postgres nên SKIP khi không có DB (job
 * `Unit tests` của CI không dựng Postgres). Lưới này chạy ở MỌI nơi. Luật 11: bỏ chú thích trước khi so (chú thích giải thích bản vá
 * chứa đúng chuỗi "⚠️" đang cấm), neo biểu thức hẹp, không cờ /s, đếm SỐ LẦN khớp, có đối chứng dương.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (d: string) => boChuThich(readFileSync(resolve(process.cwd(), d), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

/** Mọi lời gọi `<ten>.push(` kèm phần thân (cân ngoặc). */
function cacLoiPush(ma: string, ten: string): string[] {
  const ra: string[] = [];
  for (const m of ma.matchAll(new RegExp(`\\b${ten}\\.push\\(`, "g"))) {
    let sau = 0;
    const bat = m.index! + m[0].length - 1;
    for (let i = bat; i < ma.length; i++) {
      if (ma[i] === "(") sau++;
      else if (ma[i] === ")" && --sau === 0) {
        ra.push(ma.slice(bat, i + 1));
        break;
      }
    }
  }
  return ra;
}

const ROUTE = "app/api/admin/import/leads/route.ts";
const IMPORTER = "components/admin/ExcelImporter.tsx";

describe("[CBX-W1] route nhập lead: cảnh báo ở `warnings`, lỗi dòng ở `errors`", () => {
  const ma = doc(ROUTE);

  it("không còn `errors.push(` nào mang tiền tố ⚠️ (cảnh báo lẫn vào lỗi)", () => {
    const lac = cacLoiPush(ma, "errors").filter((b) => b.includes("⚠️"));
    expect(lac, `cảnh báo nằm trong \`errors\`: ${lac.map((b) => b.slice(0, 60)).join(" | ")}`).toEqual([]);
  });

  it("đúng 5 `warnings.push(` trực tiếp: 2 lần đổ cảnh báo của NHÓM đã chắc chắn được ghi · mã NV không áp dụng · cờ nguồn tắt · thiếu quy nguồn", () => {
    expect(dem(ma, /\bwarnings\.push\(/g)).toBe(5);
    expect(dem(ma, /\bwarnings\.push\(\.\.\.g\.canhBao\)/g)).toBe(2);
    // Đối chứng dương: các câu cảnh báo THẬT có mặt (ở `warnings` trực tiếp hoặc ở hàng chờ theo nhóm `canhBaoDong`/`g.canhBao`), không ở `errors`.
    const w = [...cacLoiPush(ma, "warnings"), ...cacLoiPush(ma, "canhBaoDong"), ...cacLoiPush(ma, "g.canhBao")].join("\n");
    expect(w).toMatch(/Không tìm thấy sale/);
    expect(w).toMatch(/Mã NV giới thiệu không áp dụng/);
    expect(w).toMatch(/KHÁC NHAU/);
    expect(w).toMatch(/quản lý nguồn lead đang TẮT/);
    expect(w).toMatch(/KHÔNG có quy nguồn/);
  });

  it("[CBX-W3] cảnh báo THEO DÒNG/NHÓM (sale sai · mã NV sai) đi qua hàng chờ `g.canhBao` và chỉ đổ vào `warnings` SAU các cổng chặn dòng", () => {
    // Lỗi vòng 2 (M4): đẩy thẳng lúc đọc dòng ⇒ dòng bị chặn (ngoài phạm vi · gộp chéo cơ sở · chặn nguồn) mang cả Lỗi lẫn Cảnh báo.
    const truc = cacLoiPush(ma, "warnings").join("\n");
    expect(truc, "cảnh báo của dòng bị đẩy THẲNG vào `warnings`").not.toMatch(/Không tìm thấy sale|KHÁC NHAU|guard\.error|kq\.lyDo/);
    expect(dem(ma, /const canhBaoDong: ImportError\[\] = \[\];/g)).toBe(1); // hàng chờ CỤC BỘ của dòng — không phải bí danh của `warnings`
    expect(dem(ma, /\bcanhBaoDong\.push\(/g)).toBe(2); // sale không thấy · sale không hợp lệ
    expect(dem(ma, /\bg\.canhBao\.push\(\.\.\.canhBaoDong\)/g)).toBe(1);
    expect(dem(ma, /\bg\.canhBao\.push\(/g)).toBe(3); // + mã NV khác nhau · mã NV bỏ qua
    const at = (re: RegExp) => ma.search(re);
    // (1) sale: hàng chờ chỉ gắn vào nhóm SAU cổng phạm vi cơ sở của dòng
    const congDong = at(/!passesScope\("Lead", \{ centerId \}, actor\)/);
    expect(congDong).toBeGreaterThan(0);
    expect(at(/g\.canhBao\.push\(\.\.\.canhBaoDong\)/)).toBeGreaterThan(congDong);
    // (2) gộp: đổ cảnh báo + câu "không áp dụng" SAU cổng gộp chéo cơ sở
    const congGop = at(/!passesScope\("Lead", \{ centerId: ex\.centerId \}, actor\)/);
    expect(congGop).toBeGreaterThan(0);
    const dauDo = [...ma.matchAll(/\bwarnings\.push\(\.\.\.g\.canhBao\)/g)].map((m) => m.index!);
    expect(dauDo).toHaveLength(2);
    expect(dauDo[0]!).toBeGreaterThan(congGop);
    expect(at(/Mã NV giới thiệu không áp dụng/)).toBeGreaterThan(congGop);
    // (3) tạo: đổ cảnh báo SAU vòng chặn nguồn (`cb.chanNhap`)
    const chan = at(/errors\.push\(\{ row: g\.dongDau, error: cb\.chanNhap \}\)/);
    expect(chan).toBeGreaterThan(0);
    expect(dauDo[1]!).toBeGreaterThan(chan);
  });

  it("dòng BỊ CHẶN thật (`chanNhap`) vẫn ở `errors` — nó KHÔNG được tạo lead", () => {
    const e = cacLoiPush(ma, "errors");
    expect(e.filter((b) => /cb\.chanNhap/.test(b))).toHaveLength(1);
    expect(cacLoiPush(ma, "warnings").filter((b) => /chanNhap/.test(b))).toEqual([]);
  });

  it("cả hai lối trả về THÀNH CÔNG đều mang `warnings` (thiếu một lối = cảnh báo biến mất im lặng ở lối đó)", () => {
    expect(dem(ma, /NextResponse\.json\(\{\s*success:\s*0,\s*errors,\s*warnings\s*\}\)/g)).toBe(1);
    expect(dem(ma, /NextResponse\.json\(\{\s*success,\s*updated:\s*mergedLeads,\s*errors,\s*warnings\s*\}\)/g)).toBe(1);
  });

  it("[tự kiểm] bộ dò THẤY một cảnh báo bị đẩy ngược vào `errors`", () => {
    const xau = boChuThich('errors.push({ row: 2, error: `⚠️ Mã NV giới thiệu: x.` });\nwarnings.push({ row: 2, error: "y" });');
    expect(cacLoiPush(xau, "errors").filter((b) => b.includes("⚠️"))).toHaveLength(1);
    expect(cacLoiPush(xau, "warnings").filter((b) => b.includes("⚠️"))).toHaveLength(0);
  });
});

describe("[CBX-W2] ExcelImporter: có kênh `warnings` và bảng kết quả đọc nó", () => {
  const ma = doc(IMPORTER);

  it("`ImportResult` khai `warnings?:` (tuỳ chọn — các màn nhập khác không phải đổi)", () => {
    expect(dem(ma, /\bwarnings\?:\s*\{\s*row:\s*number;\s*error:\s*string\s*\}\[\];/g)).toBe(1);
  });

  it("`ImportOutcome` lấy cảnh báo từ `result.warnings` và KHÔNG suy cảnh báo từ tiền tố chuỗi", () => {
    expect(dem(ma, /const warnings = result\.warnings \?\? \[\];/g)).toBe(1);
    expect(dem(ma, /startsWith\("⚠️"\)/g)).toBe(0);
  });
});
