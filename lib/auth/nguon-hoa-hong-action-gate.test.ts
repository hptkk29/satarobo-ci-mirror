// @vitest-environment node
/**
 * [NHH-H-GATE-*] — LƯỚI GHIM MÃ NGUỒN: mọi Server Action của tab Chính sách + tab Nguồn phải gác quyền Ở ĐẦU HÀM bằng một khoá CÓ THẬT.
 *
 * Luật cứng CLAUDE.md #5: «Server Actions VẪN phải auth() + assertCan(...) ngay đầu function (layout gate là chưa đủ)». Ma trận chạy thật nằm ở
 * `tests/hoa-hong/ma-tran-quyen-hanh-dong.spec.ts` (Postgres, cần DB) — lưới này là phần THUẦN chạy trong `pnpm test:unit` và canh hai thứ mà ma trận
 * không canh được:
 *   1. một action MỚI thêm vào các tệp này mà quên cổng: ma trận chỉ gọi những action nó biết tên, còn lưới này liệt kê MỌI `export async function`
 *      trong tệp và đòi khai báo từng cái (action lạ ⇒ đỏ);
 *   2. khoá quyền gõ sai chính tả: `checkPermission("source:view")` KHÔNG ném lỗi, nó chỉ trả `false` cho MỌI người ⇒ tính năng chết câm (luật 11 của
 *      CLAUDE.md, cùng họ bug «cờ không ai truyền»). Mỗi khoá phải ∈ `ALL_ACTIONS` và có ít nhất một vai giữ trong `ROLE_SEED`.
 *
 * Quy tắc «ở đầu hàm» (đo trên mã đã BỎ chú thích — luật 11): lời gọi cổng quyền đầu tiên phải đứng TRƯỚC mọi `await` khác ngoài `auth()`.
 *
 * Ngoại lệ DUY NHẤT có chủ đích: `doiNguonLeadAction` — quyền đổi nguồn phụ thuộc TỪNG lead (cơ sở nào, đã thu tiền chưa) nên cổng nằm trong
 * `doiNguonLead` qua `kiemQuyen`. Lưới ghim đúng điều đó: action phải TRUYỀN `kiemQuyen: ... checkPermission(` xuống, và `doiNguonLead` phải gọi
 * `kiemQuyen(` (xem `lib/nguon/doi-nguon-lead.ts`) — gỡ một trong hai là action đổi nguồn mà không ai kiểm quyền.
 *
 * Đã CẤY (luật 14): gỡ cổng khỏi từng action ⇒ đỏ đúng ca; đổi `sources:view` thành `source:view` ⇒ đỏ.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ALL_ACTIONS } from "@/lib/auth/permissions";
import { ROLE_SEED } from "../../prisma/seed-roles";

const TEP = [
  "app/(admin)/admin/nguon-hoa-hong/chinh-sach/_actions.ts",
  "app/(admin)/admin/nguon-hoa-hong/nguon/_actions.ts",
  "app/(admin)/admin/leads/nguon-actions.ts",
  "app/(admin)/admin/nguon-hoa-hong/nguon/_actions-chup-lai.ts",
] as const;

/** Khoá mà từng action PHẢI gác (gõ tay từ 05 §1.2 — không suy từ mã). `null` = ngoại lệ có chủ đích (xem đầu tệp). */
const CONG: Record<string, readonly string[] | null> = {
  luuNhapAction: ["commission_policies:manage"],
  kiemHangRaoAction: ["commission_policies:view"],
  kichHoatAction: ["commission_policies:activate"],
  huyNhapAction: ["commission_policies:manage"],
  thuTinhAction: ["commission_policies:manage"], // PR10 thử tính — CHỈ ĐỌC nhưng cùng key với nút «Chạy thử»
  luuPageMappingAction: ["sources:manage"],
  taoNguonAction: ["sources:manage"], // SPEC nguồn động §4 — ghi danh mục nguồn
  suaNguonAction: ["sources:manage"],
  doiTrangThaiNguonAction: ["sources:manage"],
  moGanNguonAction: ["sources:view"],
  timNguoiGioiThieuAction: ["leads:create", "leads:overwrite", "sources:override-after-payment", "sources:manage"],
  doiNguonLeadAction: null,
  boSungSalePhuHuynhAction: null, // cùng ngoại lệ với doiNguonLeadAction (quyền theo TỪNG lead) — xem [NHH-H-GATE-05b]
  chupLaiChuNguonAction: ["sources:manage", "commission_policies:activate"], // W3 — HAI cổng thật (đổi chủ đã chụp = đổi ai nhận tiền); xem [NHH-H-GATE-09]
};

/** Bỏ chú thích khối + dòng (không đụng `://` trong chuỗi). */
export function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Thân hàm `export async function <ten>(...) { ... }` — đếm ngoặc, chịu được `{}` trong kiểu tham số. */
export function thanHam(src: string, ten: string): string | null {
  const bat = src.indexOf(`export async function ${ten}(`);
  if (bat < 0) return null;
  let i = src.indexOf("(", bat);
  let sau = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") sau++;
    else if (src[i] === ")" && --sau === 0) break;
  }
  const mo = src.indexOf("{", i);
  let dem = 0;
  for (let j = mo; j < src.length; j++) {
    if (src[j] === "{") dem++;
    else if (src[j] === "}" && --dem === 0) return src.slice(mo + 1, j);
  }
  return null;
}

/** Thân của `async function <ten>(` KHÔNG export (helper nội bộ của tệp action). */
export function thanHamThuong(src: string, ten: string): string | null {
  const bat = src.indexOf(`async function ${ten}(`);
  if (bat < 0) return null;
  const mo = src.indexOf("{", src.indexOf(")", bat));
  let dem = 0;
  for (let j = mo; j < src.length; j++) {
    if (src[j] === "{") dem++;
    else if (src[j] === "}" && --dem === 0) return src.slice(mo + 1, j);
  }
  return null;
}

const CONG_QUYEN =/\b(?:assertPermission|checkPermission|checkAnyPermission)\s*\(/;

/** Kết luận của MỘT thân hàm — hàm thuần để tự kiểm. */
export function kiemThan(than: string): { coAuth: boolean; congDauTien: number; awaitKhacDauTien: number; khoa: string[] } {
  const coAuth = /await\s+auth\s*\(\s*\)/.test(than);
  const m = CONG_QUYEN.exec(than);
  const congDauTien = m ? m.index : -1;
  // `await` đầu tiên KHÔNG phải của `auth()` và KHÔNG phải của chính lời gọi cổng.
  let awaitKhacDauTien = -1;
  const re = /\bawait\s+([A-Za-z_$][\w$.]*)/g;
  for (let x = re.exec(than); x; x = re.exec(than)) {
    const goi = x[1]!;
    if (goi === "auth" || /^(?:assertPermission|checkPermission|checkAnyPermission)$/.test(goi)) continue;
    awaitKhacDauTien = x.index;
    break;
  }
  const khoa: string[] = [];
  // Khoá = chuỗi literal (hoặc tên mảng hằng) trong ngoặc của lời gọi cổng.
  const reKhoa = /\b(?:assertPermission|checkPermission|checkAnyPermission)\s*\(\s*(?:"([^"]+)"|'([^']+)'|([A-Z_]+))/g;
  for (let k = reKhoa.exec(than); k; k = reKhoa.exec(than)) khoa.push(k[1] ?? k[2] ?? `#${k[3]}`);
  return { coAuth, congDauTien, awaitKhacDauTien, khoa };
}

const doc = (tep: string) => boChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
const VAI_GIU = (khoa: string) => ROLE_SEED.filter((r) => r.perms.some((p) => p.action === khoa)).map((r) => r.code);

describe("[NHH-H-GATE] Server Action của tab Chính sách + Nguồn gác quyền Ở ĐẦU HÀM bằng khoá có thật", () => {
  const nguon = Object.fromEntries(TEP.map((t) => [t, doc(t)]));

  it("[NHH-H-GATE-01] mọi `export async function` trong ba tệp đều được khai báo trong bảng cổng (action MỚI quên cổng ⇒ đỏ ở đây)", () => {
    const thay: string[] = [];
    for (const t of TEP) for (const m of nguon[t]!.matchAll(/export\s+async\s+function\s+(\w+)\s*\(/g)) thay.push(m[1]!);
    expect(thay.sort()).toEqual(Object.keys(CONG).sort());
  });

  for (const [ten, khoaMong] of Object.entries(CONG)) {
    if (khoaMong === null) continue;
    it(`[NHH-H-GATE-02] ${ten}: có auth(), cổng quyền ĐỨNG TRƯỚC mọi await khác, và gác đúng khoá`, () => {
      const tep = TEP.find((t) => thanHam(nguon[t]!, ten) !== null)!;
      expect(tep, `không thấy ${ten}`).toBeDefined();
      const k = kiemThan(thanHam(nguon[tep]!, ten)!);
      expect(k.coAuth, "thiếu await auth()").toBe(true);
      expect(k.congDauTien, "thiếu cổng quyền").toBeGreaterThanOrEqual(0);
      if (k.awaitKhacDauTien >= 0) expect(k.congDauTien, "cổng quyền phải đứng TRƯỚC await khác").toBeLessThan(k.awaitKhacDauTien);
      // Khoá: với action gác nhiều khoá (`timNguoi…`) khoá nằm trong mảng hằng — kiểm mảng hằng ở dưới.
      if (khoaMong.length === 1) expect(k.khoa, "sai khoá").toEqual([khoaMong[0]]);
    });
  }

  it("[NHH-H-GATE-03] khoá quyền có THẬT: ∈ ALL_ACTIONS và ≥ 1 vai giữ trong ROLE_SEED (gõ sai chính tả ⇒ checkPermission trả false cho MỌI người, không ném lỗi)", () => {
    for (const [ten, ks] of Object.entries(CONG)) {
      for (const khoa of ks ?? []) {
        expect(ALL_ACTIONS as readonly string[], `${ten}: ${khoa} không có trong ALL_ACTIONS`).toContain(khoa);
        expect(VAI_GIU(khoa).length, `${ten}: ${khoa} không vai nào giữ`).toBeGreaterThan(0);
      }
    }
  });

  it("[NHH-H-GATE-04] mảng khoá của ô chọn người khai ĐÚNG bốn khoá ghi nguồn (khớp bảng cổng) — thêm/bớt một khoá là nới/siết ai được tra người", () => {
    const m = nguon[TEP[2]]!.match(/const\s+KHOA_TIM_NGUOI\s*=\s*\[([^\]]*)\]/);
    expect(m, "không thấy KHOA_TIM_NGUOI").not.toBeNull();
    const trongMang = [...m![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
    expect(trongMang).toEqual([...CONG.timNguoiGioiThieuAction!].sort());
    // và hàm thật sự DÙNG mảng đó
    const k = kiemThan(thanHam(nguon[TEP[2]]!, "timNguoiGioiThieuAction")!);
    expect(k.khoa).toEqual(["#KHOA_TIM_NGUOI"]);
  });

  it("[NHH-H-GATE-05] ngoại lệ có chủ đích: doiNguonLeadAction TRUYỀN `kiemQuyen` (checkPermission thật) xuống doiNguonLead, và doiNguonLead GỌI `kiemQuyen(` — gỡ một đầu là đổi nguồn không ai kiểm quyền", () => {
    const than = thanHam(nguon[TEP[2]]!, "doiNguonLeadAction")!;
    expect(/await\s+auth\s*\(\s*\)/.test(than), "thiếu auth()").toBe(true);
    expect(/kiemQuyen\s*:\s*\(\s*\w+\s*,\s*\w+\s*\)\s*=>\s*checkPermission\s*\(\s*\w+\s*,\s*\w+\s*\)/.test(than), "action không truyền kiemQuyen → checkPermission").toBe(true);
    const lib = boChuThich(readFileSync(resolve(process.cwd(), "lib/nguon/doi-nguon-lead.ts"), "utf8"));
    const goi = [...lib.matchAll(/\bkiemQuyen\s*\(/g)].length;
    expect(goi, "doiNguonLead phải gọi kiemQuyen( ít nhất một lần").toBeGreaterThanOrEqual(1);
  });

  it("[NHH-H-GATE-05b] ngoại lệ thứ hai CÙNG LÝ DO: boSungSalePhuHuynhAction có auth(), TRUYỀN `kiemQuyen` → checkPermission thật xuống service, và service (`boSungSalePhuHuynh` → `doiNguonLead`) GỌI `kiemQuyen(` — gỡ một đầu là đường thoát hold không ai kiểm quyền", () => {
    const than = thanHam(nguon[TEP[2]]!, "boSungSalePhuHuynhAction")!;
    expect(/await\s+auth\s*\(\s*\)/.test(than), "thiếu auth()").toBe(true);
    expect(/kiemQuyen\s*:\s*\(\s*\w+\s*,\s*\w+\s*\)\s*=>\s*checkPermission\s*\(\s*\w+\s*,\s*\w+\s*\)/.test(than), "action không truyền kiemQuyen → checkPermission").toBe(true);
    expect([...than.matchAll(/\bboSungSaleTheoNhanSu\s*\(/g)].length, "action phải gọi boSungSaleTheoNhanSu đúng 1 lần").toBe(1);
    const cau = boChuThich(readFileSync(resolve(process.cwd(), "lib/nguon/bo-sung-sale-db.ts"), "utf8"));
    expect([...cau.matchAll(/\bboSungSalePhuHuynh\s*\(/g)].length, "cầu nối phải giao cho boSungSalePhuHuynh đúng 1 lần (không đường ghi thứ hai)").toBe(1);
    expect(/\b(?:db\.[a-zA-Z]+\.(?:create|update|upsert|delete)|\$transaction)/.test(cau), "cầu nối KHÔNG tự ghi DB").toBe(false);
    const lib = boChuThich(readFileSync(resolve(process.cwd(), "lib/nguon/doi-nguon-lead.ts"), "utf8"));
    const i = lib.indexOf("export async function boSungSalePhuHuynh(");
    expect(i, "không thấy boSungSalePhuHuynh").toBeGreaterThan(0);
    expect(/\bdoiNguonLead\s*\(/.test(lib.slice(i)), "boSungSalePhuHuynh phải đi qua doiNguonLead (nơi gọi kiemQuyen)").toBe(true);
  });

  it("[NHH-H-GATE-07] cờ tính năng: mọi action của tab đóng khi cờ tắt — Chính sách gọi `laEngineHoaHongBat()` SAU cổng quyền, Nguồn gọi `laQuanLyNguonBat()` (màn 404 mà action vẫn sống là lách màn)", () => {
    // Chính sách đi qua helper `engineDangBat()` (bọc `laEngineHoaHongBat` + fail-closed khi đọc cờ lỗi) — helper phải thật sự gọi hàm đọc cờ.
    const ENGINE = /\bengineDangBat\s*\(/;
    const NGUON = /\blaQuanLyNguonBat\s*\(/;
    const CO_CUA: Record<string, RegExp> = {
      luuNhapAction: ENGINE,
      kiemHangRaoAction: ENGINE,
      kichHoatAction: ENGINE,
      huyNhapAction: ENGINE,
      thuTinhAction: ENGINE,
      luuPageMappingAction: NGUON,
      taoNguonAction: NGUON,
      suaNguonAction: NGUON,
      doiTrangThaiNguonAction: NGUON,
      moGanNguonAction: NGUON,
      timNguoiGioiThieuAction: NGUON,
      doiNguonLeadAction: NGUON,
      boSungSalePhuHuynhAction: NGUON,
      chupLaiChuNguonAction: NGUON,
    };
    expect(Object.keys(CO_CUA).sort()).toEqual(Object.keys(CONG).sort());
    const helper = thanHamThuong(nguon[TEP[0]]!, "engineDangBat");
    expect(helper, "thiếu helper engineDangBat").not.toBeNull();
    expect(/\bawait\s+laEngineHoaHongBat\s*\(/.test(helper!), "helper phải gọi laEngineHoaHongBat()").toBe(true);
    expect(/catch\s*\{[^}]*return\s+false/.test(helper!), "helper phải fail-closed (lỗi đọc cờ ⇒ false)").toBe(true);
    for (const [ten, re] of Object.entries(CO_CUA)) {
      const tep = TEP.find((t) => thanHam(nguon[t]!, ten) !== null)!;
      const than = thanHam(nguon[tep]!, ten)!;
      expect([...than.matchAll(new RegExp(re.source, "g"))].length, `${ten}: phải gọi cổng cờ đúng 1 lần`).toBe(1);
      const iCo = re.exec(than)!.index;
      // Cờ đứng SAU cổng quyền (người không có quyền không biết cờ bật hay tắt) — trừ action gác quyền theo từng lead nằm trong lib.
      if (CONG[ten] !== null) expect(iCo, `${ten}: cờ phải đứng SAU cổng quyền`).toBeGreaterThan(kiemThan(than).congDauTien);
      // …và TRƯỚC resolveActor / nghiệp vụ.
      const iActor = than.indexOf("resolveActor(");
      if (iActor >= 0) expect(iCo, `${ten}: cờ phải đứng TRƯỚC resolveActor`).toBeLessThan(iActor);
    }
  });

  it("[NHH-H-GATE-08] MỌI khoá quyền của module gõ trong mã chạy thật (app · components · lib, ngoài test) đều ∈ ALL_ACTIONS — gõ sai `commission_policies:activte` không ném lỗi, nó làm nút chết với MỌI người", () => {
    const THU_MUC = ["app/(admin)/admin/nguon-hoa-hong", "app/(admin)/admin/leads", "components/admin/nguon-hoa-hong", "lib/nguon-hoa-hong", "lib/nguon", "lib/hoa-hong"];
    const DUOI = /\.(?:ts|tsx)$/;
    const tep: string[] = [];
    const duyet = (d: string) => {
      for (const e of readdirSync(resolve(process.cwd(), d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`;
        if (e.isDirectory()) duyet(rel);
        else if (DUOI.test(e.name) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(e.name)) tep.push(rel);
      }
    };
    THU_MUC.forEach(duyet);
    expect(tep.length, "quét không thấy tệp nào — lưới rỗng").toBeGreaterThan(40);

    const RE = /["'`]((?:sources|commission|commission_policies|commission_periods|commission_disputes):[a-z][a-z-]*)["'`]/g;
    // Khoá truyền thẳng vào hàm hỏi quyền — kể cả khi PREFIX gõ sai (`source:view`) nên regex theo tiền tố ở trên không thấy.
    const RE_GOI = /\b(?:checkPermission|assertPermission|scope\.has)\s*\(\s*["']([^"']+)["']/g;
    const lan = new Map<string, string[]>();
    for (const t of tep) {
      const vb = boChuThich(readFileSync(resolve(process.cwd(), t), "utf8"));
      for (const re of [RE, RE_GOI]) for (const m of vb.matchAll(re)) lan.set(m[1]!, [...(lan.get(m[1]!) ?? []), t]);
    }
    const la = [...lan.keys()].filter((k) => !(ALL_ACTIONS as readonly string[]).includes(k));
    expect(la.map((k) => `${k} ← ${lan.get(k)!.slice(0, 2).join(", ")}`)).toEqual([]);
    // đối chứng dương: quét THẤY các khoá thật (nếu regex hỏng thì tập này rỗng và phép kiểm trên xanh vô nghĩa)
    for (const k of ["sources:view", "sources:manage", "commission_policies:view", "commission_policies:activate", "commission:view-self"]) {
      expect([...lan.keys()], `quét không thấy ${k}`).toContain(k);
    }
  });

  it("[NHH-H-GATE-09] chupLaiChuNguonAction (W3) gác ĐÚNG HAI khoá, gõ literal, theo thứ tự, cả hai đứng TRƯỚC mọi await khác — thiếu một khoá là nút bấm rồi bị từ chối (hoặc tệ hơn: không bị)", () => {
    const tep = TEP[3];
    const than = thanHam(nguon[tep]!, "chupLaiChuNguonAction")!;
    expect(than, "không thấy chupLaiChuNguonAction").not.toBeNull();
    const k = kiemThan(than);
    expect(k.coAuth, "thiếu await auth()").toBe(true);
    expect(k.khoa, "phải đúng hai khoá, theo thứ tự").toEqual(["sources:manage", "commission_policies:activate"]);
    // Cổng THỨ HAI cũng phải đứng trước mọi await khác (kiemThan chỉ đo cổng đầu).
    const reCong = /await\s+checkPermission\s*\(\s*"([^"]+)"\s*\)/g;
    const congs = [...than.matchAll(reCong)];
    expect(congs.map((m) => m[1])).toEqual(["sources:manage", "commission_policies:activate"]);
    const iCongCuoi = congs[congs.length - 1]!.index!;
    const reAwait = /\bawait\s+([A-Za-z_$][\w$.]*)/g;
    for (let x = reAwait.exec(than); x; x = reAwait.exec(than)) {
      if (x[1] === "auth" || x[1] === "checkPermission") continue;
      expect(x.index, `await ${x[1]} đứng trước cổng thứ hai`).toBeGreaterThan(iCongCuoi);
    }
  });

  it("[NHH-H-GATE-06] hàm quyết định tự kiểm: thân thiếu cổng / cổng đứng sau await khác / thiếu auth bị bắt; thân đúng khuôn thì qua", () => {
    const dung = kiemThan(`const s = await auth(); if (!s) return 1; if (!(await checkPermission("sources:view"))) return 2; const x = await lam();`);
    expect(dung.coAuth).toBe(true);
    expect(dung.congDauTien).toBeGreaterThanOrEqual(0);
    expect(dung.congDauTien).toBeLessThan(dung.awaitKhacDauTien);
    expect(dung.khoa).toEqual(["sources:view"]);

    const sauAwait = kiemThan(`const s = await auth(); const x = await lam(); await assertPermission("sources:view");`);
    expect(sauAwait.congDauTien).toBeGreaterThan(sauAwait.awaitKhacDauTien);

    expect(kiemThan(`const x = await lam();`).congDauTien).toBe(-1);
    expect(kiemThan(`await checkPermission("sources:view");`).coAuth).toBe(false);
  });
});
