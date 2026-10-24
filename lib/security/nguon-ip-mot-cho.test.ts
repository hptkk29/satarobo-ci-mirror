// lib/security/nguon-ip-mot-cho.test.ts — LƯỚI QUÉT CÂY: IP khách chỉ được đọc ở MỘT chỗ.
//
// Sự cố gốc (28/09/2026): prod + test chuyển sang VPS sau Caddy. Caddy đặt IP khách vào CUỐI
// `X-Forwarded-For` và để NGUYÊN mọi header khách gửi. Trong khi đó 17 chỗ trong mã tự đọc
// header IP theo kiểu thời Vercel — phần lớn lấy phần tử ĐẦU của XFF (`split(",")[0]`), tức phần
// tử do KHÁCH viết — nên chặn tần suất webhook / form lead / OTP đổi khoá theo ý kẻ tấn công,
// và nhật ký (AuditLog, chấm công, SCORM, chấp nhận chính sách) ghi IP do kẻ tấn công chọn.
//
// Luật: IP khách đi qua `lib/security/client-ip.ts` (`ipChoRateLimit` cho khoá chặn — fail-open;
// `ipKhachHang` cho nhật ký — null khi không rõ). Allowlist IP có hàm riêng fail-closed
// (`lib/security/ip-nguon-tin-cay.ts`) vì với nó IP là căn cứ CHO QUA. Cả ba dùng CHUNG
// `lib/security/nen-tang.ts` để biết nền tảng nào đặt header nào.
//
// ⚠️ Lưới văn bản (luật 11) — ba biện pháp:
//   · bỏ chú thích TRƯỚC khi soi (chú thích giải thích bản vá chứa đúng các tên header);
//   · bộ soi là hàm THUẦN có ca riêng cho vế BẮT và vế CHO QUA;
//   · danh sách cho phép phải tự chứng minh: mỗi mục phải CÒN khớp (không thì nó là cửa hậu
//     chờ người sau nhét mã vào), và phép quét phải chạm đủ nhiều tệp (sai cwd = 0 tệp = xanh giả).
// `nen-tang.ts` KHÔNG nằm trong danh sách: nó không đọc header nào, chỉ đọc env.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Header mang IP khách (hoặc giả làm thế). So khớp ĐÚNG TÊN trong dấu nháy. */
const TEN_HEADER_IP = [
  "x-forwarded-for",
  "x-real-ip",
  "x-vercel-forwarded-for",
  "x-e2e-client-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "x-client-ip",
  "x-cluster-client-ip",
  "forwarded",
];

const MAU_HEADER = new RegExp(`(["'\`])(?:${TEN_HEADER_IP.join("|")})\\1`, "i");
/** `ipAddress()` của @vercel/functions đọc x-real-ip; hằng HEADER_IP_E2E là tên header gián tiếp. */
const MAU_KHAC = /\bipAddress\s*\(|\bHEADER_IP_E2E\b/;

function boChuThich(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[\s;{}(),])\/\/.*$/gm, "$1");
}

/** Số dòng (đã bỏ chú thích) đọc header IP. 0 = sạch. */
export function soLanDocHeaderIp(src: string): number {
  return boChuThich(src)
    .split("\n")
    .filter((d) => MAU_HEADER.test(d) || MAU_KHAC.test(d)).length;
}

const GOC = ["lib", "app", "components"];
const TEP_GOC = ["proxy.ts", "middleware.ts", "instrumentation.ts", "instrumentation-client.ts"];
const DUOC_PHEP = new Map<string, string>([
  ["lib/security/client-ip.ts", "nguồn IP DUY NHẤT cho chặn tần suất + nhật ký"],
  ["lib/security/ip-nguon-tin-cay.ts", "IP nguồn cho allowlist IP — FAIL-CLOSED vì là căn cứ cho qua"],
]);

function laTepMa(ten: string): boolean {
  return /\.(ts|tsx|mts|mjs|js|cjs)$/.test(ten) && !/\.(test|spec)\.(ts|tsx)$/.test(ten);
}

function quet(): { trung: Map<string, number>; soTep: number } {
  const trung = new Map<string, number>();
  let soTep = 0;
  const xem = (p: string) => {
    soTep += 1;
    const n = soLanDocHeaderIp(fs.readFileSync(p, "utf8"));
    if (n > 0) trung.set(path.relative(process.cwd(), p).split(path.sep).join("/"), n);
  };
  const di = (thuMuc: string) => {
    for (const e of fs.readdirSync(thuMuc, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(thuMuc, e.name);
      if (e.isDirectory()) di(p);
      else if (laTepMa(e.name)) xem(p);
    }
  };
  for (const g of GOC) di(path.resolve(process.cwd(), g));
  for (const t of TEP_GOC) {
    const p = path.resolve(process.cwd(), t);
    if (fs.existsSync(p)) xem(p);
  }
  return { trung, soTep };
}

describe("[IPH] IP khách chỉ đọc ở một chỗ", () => {
  it("[IPH-01] bộ soi: bắt mọi dạng đọc header IP, bỏ qua chú thích và header không mang IP", () => {
    expect(soLanDocHeaderIp('const ip = h.get("x-forwarded-for")?.split(",")[0];')).toBe(1);
    expect(soLanDocHeaderIp("req.headers.get('X-Real-IP')")).toBe(1);
    expect(soLanDocHeaderIp("h.get(`x-vercel-forwarded-for`)")).toBe(1);
    expect(soLanDocHeaderIp('h.get("cf-connecting-ip")')).toBe(1);
    expect(soLanDocHeaderIp("const ip = ipAddress(req);")).toBe(1);
    expect(soLanDocHeaderIp("h.get(HEADER_IP_E2E)")).toBe(1);
    // Chú thích — dòng, khối, cuối dòng, JSX — không tính.
    expect(soLanDocHeaderIp('// h.get("x-forwarded-for")\nconst a = 1;')).toBe(0);
    expect(soLanDocHeaderIp('/* lấy "x-real-ip" */ const a = 1;')).toBe(0);
    expect(soLanDocHeaderIp('const ip = ipKhachHang(h); // thay "x-forwarded-for"')).toBe(0);
    expect(soLanDocHeaderIp('<div>{/* "x-real-ip" */}</div>')).toBe(0);
    // Header KHÔNG mang IP khách.
    expect(soLanDocHeaderIp('h.get("x-forwarded-proto"); h.get("x-forwarded-host");')).toBe(0);
    // Chuỗi URL có // không bị nhầm là chú thích.
    expect(soLanDocHeaderIp('const u = "https://a.b"; h.get("x-real-ip");')).toBe(1);
  });

  it("[IPH-02] cây mã thật: không tệp nào ngoài danh sách cho phép đọc header IP", () => {
    const { trung, soTep } = quet();
    expect(soTep, "quét ra quá ít tệp — sai cwd? lưới đang không chạm cây thật").toBeGreaterThan(1000);
    const sai = [...trung.keys()].filter((t) => !DUOC_PHEP.has(t)).sort();
    expect(
      sai,
      "đọc header IP thẳng ⇒ trên VPS khách tự viết được. Dùng ipChoRateLimit / ipKhachHang (lib/security/client-ip.ts)",
    ).toEqual([]);
  });

  it("[IPH-03] danh sách cho phép không mục: mỗi mục còn tồn tại và CÒN đọc header", () => {
    const { trung } = quet();
    for (const [tep, lyDo] of DUOC_PHEP) {
      expect(trung.get(tep) ?? 0, `${tep} (${lyDo}) không còn đọc header — gỡ khỏi danh sách`).toBeGreaterThan(0);
    }
  });
});
