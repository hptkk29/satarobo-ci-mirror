/**
 * [DISC-RT-*] LƯỚI GHIM MÃ NGUỒN cho F-15 (06-security-privacy): giao diện DISC không được để dữ liệu
 * của gia đình lọt ra ngoài qua URL, tiêu đề tab, analytics/pixel hay log.
 *
 * Neo vào LỜI GỌI, không vào import (luật 14 — một chuỗi trong dòng `import` làm lưới xanh giả), và
 * quét trên mã ĐÃ BỎ CHÚ THÍCH (chú thích giải thích bản vá thường chứa đúng chuỗi đang cấm).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();

function boChuThich(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\"'`])\/\/[^\n]*/gm, "$1")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
}

function lietKe(thuMuc: string, ketThuc: RegExp, boQua: RegExp): string[] {
  const ra: string[] = [];
  for (const ten of readdirSync(thuMuc)) {
    const d = join(thuMuc, ten);
    if (statSync(d).isDirectory()) ra.push(...lietKe(d, ketThuc, boQua));
    else if (ketThuc.test(ten) && !boQua.test(ten)) ra.push(d);
  }
  return ra;
}

/** Mọi tệp giao diện thật của DISC (không gồm test). */
function tepGiaoDien(): Array<{ tep: string; ma: string }> {
  const ds = [
    ...lietKe(resolve(GOC, "components/disc"), /\.(ts|tsx)$/, /\.test\./),
    ...lietKe(resolve(GOC, "app/(public)/disc"), /\.(ts|tsx)$/, /\.test\./),
  ];
  return ds.map((tep) => ({ tep, ma: boChuThich(readFileSync(tep, "utf8")) }));
}

/** Mẫu cấm: mỗi mục là một LỜI GỌI/biểu thức làm dữ liệu lọt ra ngoài. */
export const MAU_CAM: Array<{ ten: string; re: RegExp }> = [
  { ten: "đặt tiêu đề tab động (có thể chứa tên trẻ)", re: /document\.title\s*=/ },
  { ten: "GA4 gtag()", re: /\bgtag\s*\(/ },
  { ten: "Meta Pixel fbq()", re: /\bfbq\s*\(/ },
  { ten: "dataLayer", re: /\bdataLayer\b/ },
  { ten: "sendBeacon", re: /\bsendBeacon\s*\(/ },
  { ten: "console.* (không log dữ liệu trẻ)", re: /\bconsole\.\w+\s*\(/ },
  { ten: "đọc/ghi query hoặc hash của URL", re: /\b(location\.(search|hash)|URLSearchParams|useSearchParams)\b/ },
  { ten: "đổi URL bằng history/router", re: /\b(history\.(pushState|replaceState)|router\.(push|replace))\s*\(/ },
  { ten: "href động (template) có thể mang định danh", re: /href=\{\s*`[^`]*\$\{/ },
  { ten: "captureException/Sentry thô", re: /\b(captureException|captureMessage)\s*\(/ },
];

describe("[DISC-RT-01] giao diện DISC không để dữ liệu gia đình lọt ra ngoài", () => {
  const tep = tepGiaoDien();
  it("quét được tệp thật (không phải quét rỗng)", () => {
    expect(tep.length).toBeGreaterThan(10);
    expect(tep.some((t) => t.tep.endsWith("hanh-trinh.tsx"))).toBe(true);
    expect(tep.some((t) => t.tep.replace(/\\/g, "/").endsWith("disc/bat-dau/page.tsx"))).toBe(true);
  });
  for (const m of MAU_CAM) {
    it(`không có: ${m.ten}`, () => {
      const vi = tep.filter((t) => m.re.test(t.ma)).map((t) => t.tep.replace(GOC, ""));
      expect(vi).toEqual([]);
    });
  }
  it("bộ so khớp THẬT SỰ bắt: mỗi mẫu cấm khớp ít nhất một mẫu vi phạm tổng hợp", () => {
    const vd: Record<string, string> = {
      "document.title": 'document.title = ho.hoTen + " | DISC";',
      gtag: 'gtag("event", "disc_done");',
      fbq: 'fbq("track", "Lead");',
      dataLayer: "window.dataLayer.push({});",
      sendBeacon: 'navigator.sendBeacon("/x", d);',
      console: "console.log(body);",
      query: "const q = new URLSearchParams(location.search);",
      history: 'router.push("/x");',
      href: "<a href={`/kich-hoat?ma=${ma}`}>",
      sentry: "Sentry.captureException(e);",
    };
    const khop = Object.values(vd).map((v) => MAU_CAM.some((m) => m.re.test(boChuThich(v))));
    expect(khop.every(Boolean)).toBe(true);
  });
  it("bộ bỏ chú thích không làm mất lời gọi thật và không đếm chú thích", () => {
    expect(boChuThich("// document.title = x\nconst a = 1;")).not.toMatch(/document\.title/);
    expect(boChuThich("/* gtag( */ const a = 1;")).not.toMatch(/gtag/);
    expect(boChuThich('const a = "https://x.vn"; gtag("e");')).toMatch(/gtag\(/);
  });
});

describe("[DISC-RT-03] «Nhớ trên máy này»: bản nháp vẫn không có tên; liên hệ chỉ ghi ở MỘT chỗ và chỉ của người lớn", () => {
  const ban = boChuThich(readFileSync(resolve(GOC, "components/disc/ban-nhap.ts"), "utf8"));
  const hanhTrinh = boChuThich(readFileSync(resolve(GOC, "components/disc/hanh-trinh.tsx"), "utf8"));
  const kho = boChuThich(readFileSync(resolve(GOC, "lib/lien-he-da-nho.ts"), "utf8"));
  it("bản nháp (ban-nhap.ts) không import và không gọi kho liên hệ", () => {
    expect(ban).not.toMatch(/lien-he-da-nho|ghiLienHeDaNho|KHOA_LIEN_HE_DA_NHO/);
  });
  it("trong giao diện DISC chỉ hanh-trinh.tsx GHI liên hệ — đúng MỘT lời gọi, và nằm sau khi máy chủ báo ok", () => {
    const tep = tepGiaoDien();
    const goi = tep.filter((t) => /\bghiLienHeDaNho\s*\(/.test(t.ma)).map((t) => t.tep.replace(GOC, "").replace(/\\/g, "/"));
    expect(goi).toEqual(["/components/disc/hanh-trinh.tsx"]);
    expect((hanhTrinh.match(/\bghiLienHeDaNho\s*\(/g) ?? []).length).toBe(1);
    expect(hanhTrinh.indexOf("if (r.ok)")).toBeGreaterThan(-1);
    expect(hanhTrinh.indexOf("ghiLienHeDaNho(")).toBeGreaterThan(hanhTrinh.indexOf("if (r.ok)"));
  });
  it("lời gọi ghi chỉ truyền liên hệ người lớn: không có hocSinh / tenHocSinh / traLoi / diem trong đối số", () => {
    const dau = hanhTrinh.indexOf("const moi =");
    expect(dau).toBeGreaterThan(-1);
    const doan = hanhTrinh.slice(dau, hanhTrinh.indexOf("ghiLienHeDaNho(", dau));
    expect(doan).toMatch(/hoSoHopLe\.phuHuynh\.hoTen/);
    expect(doan).not.toMatch(/hocSinh|traLoi|diem|bacHoc/);
  });
  it("kho liên hệ chỉ có trường của người lớn (không có trường nào nói về bé / điểm / câu trả lời)", () => {
    expect(kho).not.toMatch(/hocSinh|tenHocSinh|bacHoc|traLoi|diem|ketQua|namSinh/);
  });
});

describe("[DISC-RT-02] mã nhận không đi vào URL hay nơi đo lường", () => {
  const manThanhCong = readFileSync(resolve(GOC, "components/disc/man-thanh-cong.tsx"), "utf8");
  const ma = boChuThich(manThanhCong);
  it("liên kết nhận kết quả là hằng số, không nối mã", () => {
    expect(ma).toMatch(/DUONG_DAN_NHAN_KET_QUA\s*=\s*"\/kich-hoat\?disc=1"/);
    expect(ma).not.toMatch(/kich-hoat[^"'`\n]*\$\{/);
  });
  it("chỉ DUY NHẤT chỗ ghi mã là ghiMaNhanLocal (một lời gọi)", () => {
    expect((ma.match(/\bghiMaNhanLocal\s*\(/g) ?? []).length).toBe(1);
    expect(ma).not.toMatch(/\b(sessionStorage|document\.cookie)\b/);
  });
});
