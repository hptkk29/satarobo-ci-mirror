/**
 * [SPN-*] — test KHÔNG được sinh tiến trình con bằng `pnpm` (đỏ giả vì môi trường, không phải vì mã).
 *
 * Vì sao: `pnpm exec …` tự kiểm trạng thái `node_modules`; khi nó thấy lệch (worktree liên kết `node_modules`, lockfile mới…) nó tự đòi `pnpm install` rồi HUỶ giữa chừng vì không có TTY
 * (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`). Ca test spawn nó đỏ với thông báo của pnpm chứ không phải của script đang thử — đo 11/10/2026: 12 ca của
 * `tests/finance/noi-don-ve-lead-script.test.ts` + 5 ca của `tests/lead-intake/nguon-di-tru-script.spec.ts` đỏ giả, xanh ngay khi gọi thẳng `node node_modules/tsx/dist/cli.mjs`
 * (khuôn đã có ở `lib/uat/nap-server-only.test.ts`, `tests/hoc-bu/toan-ven.test.ts`).
 *
 * Soi LUẬT («test không spawn pnpm»), không soi tệp cụ thể: tệp test mới spawn pnpm cũng đỏ ở đây. Neo vào LỜI GỌI spawn* có đối số đầu là tên công cụ — chú thích nhắc lệnh không khớp.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();

function duyet(thuMuc: string, ra: string[]): void {
  for (const t of readdirSync(resolve(GOC, thuMuc))) {
    if (t === "node_modules" || t === ".next") continue;
    const duong = join(thuMuc, t);
    if (statSync(resolve(GOC, duong)).isDirectory()) duyet(duong, ra);
    else if (/\.(?:test|spec)\.tsx?$/.test(t)) ra.push(duong);
  }
}

/** Bóc chú thích — lưới soi MÃ, không soi lời kể về mã. */
function boChuThich(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Tên công cụ dựng từ MẢNH và regex dựng từ mảnh để CHÍNH tệp này không tự khớp (bài học các lưới grep-mã-nguồn trước).
const TEN = `p${"npm"}`;
const LOI_GOI = new RegExp(String.raw`\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\(\s*["'` + "`" + String.raw`]${TEN}\b`);
const chuanHoa = (t: string) => t.split("\\").join("/");

describe("[SPN] test không sinh tiến trình con bằng pnpm", () => {
  const tep: string[] = [];
  duyet("tests", tep);
  duyet("lib", tep);
  // KHÔNG quét `scripts/`: test ở đó (vd bộ lưới CI gương) mang CHUỖI MẪU chứa lời gọi spawn làm dữ liệu thử cho bộ so khớp khác, và tệp này không được nhắc literal tới chúng
  // (lưới `[CIG-RIENG-01]` đòi mọi tệp nhắc đường dẫn ngoài ảnh chụp gương phải khai riêng).

  it("[SPN-1] quét ĐƯỢC tệp test (chống lưới quét rỗng): thấy chính tệp này và nhiều tệp khác — cả trên bản chụp gương (chỉ có một phần cây)", () => {
    expect(tep.length).toBeGreaterThan(20);
    expect(tep.map(chuanHoa)).toContain("lib/uat/khong-spawn-pnpm.test.ts");
  });

  it("[SPN-2] 0 tệp test gọi spawn*/exec* với đối số đầu là tên công cụ đó", () => {
    const viPham = tep.filter((t) => LOI_GOI.test(boChuThich(readFileSync(resolve(GOC, t), "utf8"))));
    expect(viPham).toEqual([]);
  });

  it("[SPN-3] đối chứng dương: bộ so khớp THẤY một lời gọi mẫu (không thì SPN-2 xanh vì regex hỏng)", () => {
    // Mẫu dựng từ TEN (không gõ nguyên văn) để chính tệp này không tự khớp ở SPN-2.
    expect(TEN).toBe(["p", "n", "p", "m"].join("")); // đúng tên công cụ, không phải một tên khác cũng "nhất quán"
    expect(LOI_GOI.test(`const r = spawnSync("${TEN}", ["exec", "tsx", "x.ts"]);`)).toBe(true);
    expect(LOI_GOI.test(`execFileSync('${TEN}', ['exec'])`)).toBe(true);
    expect(LOI_GOI.test('spawnSync(process.execPath, [resolve(GOC, "node_modules/tsx/dist/cli.mjs"), "x.ts"])')).toBe(false);
    expect(LOI_GOI.test(`// ghi chú: ${TEN} exec tsx scripts/x.ts`)).toBe(false);
  });
});
