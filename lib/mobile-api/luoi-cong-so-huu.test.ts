import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * [LCS] LƯỚI GHIM MÃ NGUỒN cho API di động (M1, 18/11/2026) — chạy trong `test:unit` (KHÔNG cần Postgres), vì bộ `tests/mobile-api` kiểm quyền sở hữu bằng DB
 * và CHƯA nối CI (`scripts/ci/ci-guong-du-bo.test.ts`). Sinh ra từ kiểm toán M1: `[YCM-G1]` chỉ kiểm route CÓ GỌI cổng, KHÔNG kiểm BÊN TRONG cổng — bỏ
 * `parentUserId` khỏi câu tra ở `so-huu.ts` thì mọi phụ huynh đọc được mọi học viên mà không ca nào đỏ.
 *   [LCS-01] `kiemHocVienCuaPhuHuynh` tra ĐỦ ba điều kiện: id · parentUserId · deletedAt:null (và `parentUserId` lấy từ tham số, không từ client)
 *   [LCS-02] mọi route dưới `students/[studentId]/**` đi qua `chayTheoHocVien` (hoặc tự gọi `kiemHocVienCuaPhuHuynh`) — không route nào cầm `studentId` trần
 *   [LCS-03] ba route POST kiểm cờ TRƯỚC khi đọc thân (cờ tắt ⇒ 404, không lộ lược đồ). V8.17: cờ → xác thực → … → đọc thân; nay do các cổng `chay*CoThan` làm (xem `[AUT-G1-W]`)
 *   [LCS-04] không route di động nào nhận điểm số / trạng thái hoàn thành / số tiền từ client
 */
const GOC = resolve(process.cwd(), "app/api/mobile/v1");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function cacTepRoute(d: string, ra: string[] = []): string[] {
  for (const t of readdirSync(d)) {
    const p = join(d, t);
    if (statSync(p).isDirectory()) cacTepRoute(p, ra);
    else if (t === "route.ts") ra.push(p);
  }
  return ra;
}

describe("API di động — lưới cổng và quyền sở hữu", () => {
  it("[LCS-01] kiemHocVienCuaPhuHuynh tra đủ id + parentUserId + deletedAt", () => {
    const ma = boChuThich(readFileSync(resolve(process.cwd(), "lib/mobile-api/so-huu.ts"), "utf8"));
    expect(ma).toMatch(/db\.student\.findFirst\(\{\s*where:\s*\{\s*id:\s*studentId,\s*parentUserId,\s*deletedAt:\s*null\s*\}/);
    // chỉ một nơi tạo MaHocVienDaKiem
    expect((ma.match(/as MaHocVienDaKiem/g) ?? []).length).toBe(1);
  });

  it("[LCS-02] mọi route theo học viên đi qua cổng sở hữu", () => {
    const tep = cacTepRoute(join(GOC, "students")).filter((p) => p.includes("[studentId]"));
    expect(tep.length).toBeGreaterThanOrEqual(13);
    for (const t of tep) {
      const ma = boChuThich(readFileSync(t, "utf8"));
      const qua = /chayTheoHocVien(CoThan|TrongThan)?\(/.test(ma) || /kiemHocVienCuaPhuHuynh\(/.test(ma);
      expect(qua, `${t} không đi qua cổng sở hữu`).toBe(true);
      // không dùng studentId trần để tra DB
      expect(/db\.[a-zA-Z]+\.(find|update|delete|create)\w*\([^)]*studentId/.test(ma), `${t} tra DB bằng studentId trần`).toBe(false);
    }
  });

  it("[LCS-03] ba route POST kiểm cờ trước khi đọc thân", () => {
    for (const rel of ["notifications/read/route.ts", "students/[studentId]/center-feedback/route.ts", "students/[studentId]/requests/route.ts"]) {
      const ma = boChuThich(readFileSync(join(GOC, rel), "utf8"));
      const post = ma.slice(ma.indexOf("export async function POST"));
      // route KHÔNG tự đọc thân; chỉ đi qua cổng có thân — cổng đó tự kiểm cờ rồi xác thực rồi mới đọc (kiểm ở khối dưới)
      expect(post, `${rel}: phải qua cổng CoThan`).toMatch(/chay(DaDangNhap|ChoPhuHuynh|TheoHocVien)CoThan\(/);
      expect(post.includes("docThanJson("), `${rel}: không được tự đọc thân trước xác thực`).toBe(false);
    }
    // và mỗi cổng CoThan kiểm cờ TRƯỚC (cờ tắt ⇒ 404) rồi mới tới xác thực/đọc thân
    const cong = boChuThich(readFileSync(resolve(process.cwd(), "lib/mobile-api/cong.ts"), "utf8"));
    for (const ten of ["chayDaDangNhapCoThan", "chayChoPhuHuynhCoThan", "chayTheoHocVienCoThan"]) {
      const than = cong.slice(cong.indexOf(`export async function ${ten}`));
      const hamNay = than.slice(0, than.indexOf("\n}\n"));
      expect(hamNay.indexOf("motMobileTat()"), `${ten} thiếu motMobileTat()`).toBeGreaterThan(-1);
      expect(hamNay.indexOf("motMobileTat()"), `${ten}: cờ phải đứng TRƯỚC đọc thân`).toBeLessThan(hamNay.indexOf("docThanCoTran("));
    }
  });

  it("[LCS-04] không route nào đọc điểm / hoàn thành / số tiền từ thân client", () => {
    const cam = /\b(score|diem|point|diemSo|completed|isCompleted|hoanThanh|amount|soTien|price)\b/;
    for (const t of cacTepRoute(GOC)) {
      const ma = boChuThich(readFileSync(t, "utf8"));
      expect(cam.test(ma), `${t} nhắc tới trường tin-client nhạy cảm`).toBe(false);
    }
    for (const rel of ["schema/auth.ts", "schema/yeu-cau.ts"]) {
      const ma = boChuThich(readFileSync(resolve(process.cwd(), "lib/mobile-api", rel), "utf8"));
      expect(cam.test(ma), `${rel} nhận trường tin-client nhạy cảm`).toBe(false);
    }
  });
});
