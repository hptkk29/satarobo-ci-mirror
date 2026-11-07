// @vitest-environment node
/**
 * [NHH-MACA-*] — LƯỚI MÃ CA KHÔNG TRÙNG GIỮA CÁC TỆP (module Nguồn lead & Hoa hồng).
 *
 * VÌ SAO CÓ: luật 14 (CLAUDE.md) bảo cấy lỗi rồi "so ĐÚNG TẬP MÃ CA đỏ với tập mong đợi". Mã ca mà hai tệp cùng dùng với hai nghĩa khác
 * nhau làm bước so ấy nhập nhằng: thấy `[NHH-PER-04]` đỏ thì không biết đang đỏ ca nào. Đợt rà R4 (gt0, 10/10/2026) tìm ra bốn trường hợp thật:
 *   · `[NHH-PER-04]` (cutover.spec: convert trong tháng sổ mới) ↔ (so-giua-chung.spec: TINH_CO_LOI)  ⇒ ca sau đổi `04d`
 *   · `[NHH-SO-W11b]` (so-day-noi: bảng nhãn mã) ↔ (hang-cho.test: số hàng chờ của tab Sổ)            ⇒ ca sau đổi `W11c`
 *   · `[NHH-W13]` (chinh-sach-wiring: khoá advisory) ↔ (so-cai-wiring: vòng sửa sau rà độc lập)        ⇒ ca sau đổi `W15`
 *   · va chạm LIÊN MODULE: `[MD-01..07]` của lib/legal-content.test.ts (origin/test) ↔ `[MD-01..08]` của tests/hoa-hong/nguon-dong-mac-dinh.spec.ts ⇒ module
 *     đổi tiền tố `MDN-`; và `[NGD-01..06]` của components/admin/nguon-hoa-hong/nguon-danh-muc-ui.test.tsx ↔ lib/orders/nguong-duyet.test.ts +
 *     lib/finance/nhap-giao-dich-sheet.test.ts ⇒ module đổi `NDM-`.
 *
 * ĐO GÌ: một mã `[X]` đứng ĐẦU tiêu đề `describe`/`it`/`test` xuất hiện ở ≥ 2 TỆP khác nhau, trong đó có ≥ 1 tệp của module (đường dẫn chứa
 * `nguon` hoặc `hoa-hong`). Mã trùng TRONG một tệp là họ mã (`[NHH-POL-01b]` ×5 ca) — không đo.
 *
 * ⚠️ ĐÂY LÀ LƯỚI "BẬC THANG" (ratchet), KHÔNG PHẢI LƯỚI NGHĨA: tiêu đề khác nhau không chứng minh hai ca khác luật (cùng một luật tầng thuần và tầng
 * DB luôn có tiêu đề khác nhau), và máy không phân xử được. Nên: những mã đã dùng ở ≥ 2 tệp tại thời điểm 10/10/2026 được KHAI TƯỜNG MINH bên dưới
 * (`TANG_THUAN_VA_DB`, `CHUA_PHAN_XU`); mã MỚI trùng giữa hai tệp ⇒ đỏ, người viết đổi mã hoặc thêm vào danh sách kèm lý do. Danh sách không mục:
 * mã hết trùng mà vẫn nằm trong danh sách ⇒ đỏ (để danh sách co lại theo thời gian).
 *
 * ⚠️ ĐỎ SAU KHI GỘP NHÁNH KHÔNG CÓ NGHĨA LÀ AI LÀM SAI: hai nhánh song song mỗi bên thêm một ca thuần + một ca DB cùng mã (thói quen đúng của module —
 * một luật, hai tầng) thì từng nhánh xanh, bản gộp mới thấy mã nằm ở ≥ 2 tệp mà chưa khai. Cách xử lý: đọc hai tiêu đề; cùng một luật ⇒ thêm mã vào
 * `TANG_THUAN_VA_DB` kèm lý do trong commit; khác luật ⇒ đổi mã một bên (đừng để hai nghĩa chung một mã).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Cặp "cùng luật, hai tầng" (một tệp thuần + một tệp DB/e2e, mã = số luật trong 05) mà reviewer R4 (gt0 mục 4) ĐÃ ĐỌC tiêu đề và chấp nhận:
 *  `NHH-COM-14` · `NHH-COM-20` · `NHH-DSP-02d` · `NHH-POL-04/05/06/08/09`, cộng `NHH-POL-04c` (W5 đổi mã ca GV Trial-trong-trần của so-luong-nguon.spec
 *  cho khớp tien.test — cùng luật). CHỈ thêm mã vào đây khi đã đọc hai tiêu đề và thấy cùng một luật; ghi lý do trong commit. */
const TANG_THUAN_VA_DB: readonly string[] = [
  "[NHH-COM-14]",
  "[NHH-COM-20]",
  "[NHH-DSP-02d]",
  "[NHH-POL-04]",
  "[NHH-POL-04c]",
  "[NHH-POL-05]",
  "[NHH-POL-06]",
  "[NHH-POL-08]",
  "[NHH-POL-09]",
];

/** Mã đã trùng giữa ≥ 2 tệp lúc 10/10/2026 mà CHƯA AI phân xử là cùng luật hay va chạm: cặp thuần↔DB chưa đọc tiêu đề, nhiều tệp thuần, họ mã giao diện
 *  `NHH-FE-*`. Vài cặp nhìn đã KHÁC nghĩa (vd `NHH-COM-13` · `NHH-POL-09b` · `NHH-TRX-08` · `NHH-UI-TB-01` · `NHH-UI-TN-09`) — việc rà tiếp là đổi mã rồi
 *  xoá khỏi đây. Thu hẹp dần, đừng thêm. */
const CHUA_PHAN_XU: readonly string[] = [
  "[DYN]",
  "[NHH-COM-03]",
  "[NHH-COM-06]",
  "[NHH-COM-09]",
  "[NHH-COM-11]",
  "[NHH-COM-13]",
  "[NHH-COM-14b]",
  "[NHH-COM-18]",
  "[NHH-DSP-05c]",
  "[NHH-DSP-05d]",
  "[NHH-DSP-V1]",
  "[NHH-FE-04]",
  "[NHH-FE-05]",
  "[NHH-FE-06]",
  "[NHH-FE-07]",
  "[NHH-FE-09]",
  "[NHH-FE-09b]",
  "[NHH-FE-09d]",
  "[NHH-FE-10b]",
  "[NHH-FE-NAV-LB]",
  "[NHH-PER-03]",
  "[NHH-PER-03e]",
  "[NHH-PER-08]",
  "[NHH-POL-02]",
  "[NHH-POL-03]",
  "[NHH-POL-04b]",
  "[NHH-POL-06b]",
  "[NHH-POL-09b]",
  "[NHH-POL-10]",
  "[NHH-SRC-11]",
  "[NHH-SRC-16]",
  "[NHH-SRC-17]",
  "[NHH-SRC-21b]",
  "[NHH-TRX-07]",
  "[NHH-TRX-07b]",
  "[NHH-TRX-08]",
  "[NHH-UI-TB-01]",
  "[NHH-UI-TN-09]",
];

const DA_KHAI = new Set<string>([...TANG_THUAN_VA_DB, ...CHUA_PHAN_XU]);

/** Mã ca đứng ĐẦU tiêu đề của describe/it/test (nháy đơn · kép · backtick; chịu `.skipIf(…)` `.runIf(…)` `.fails` `.skip` `.only`). */
export function trichMaCa(src: string): string[] {
  const re = /\b(?:describe|it|test)(?:\.(?:fails|skip|each|only|todo|skipIf\([^)]*\)|runIf\([^)]*\)))*\s*\(\s*["'`]\s*(\[[A-Za-z0-9_-]+\])/g;
  return [...src.matchAll(re)].map((m) => m[1] as string);
}

export type MaDung = Map<string, Set<string>>;

export function gomMaTheoTep(tep: ReadonlyArray<{ duongDan: string; noiDung: string }>): MaDung {
  const ra: MaDung = new Map();
  for (const t of tep) {
    for (const ma of trichMaCa(t.noiDung)) {
      if (!ra.has(ma)) ra.set(ma, new Set());
      ra.get(ma)!.add(t.duongDan);
    }
  }
  return ra;
}

const laTepModule = (p: string): boolean => /nguon(?!g)|hoa-hong/.test(p);

/** Mã dùng ở ≥ 2 tệp trong đó có tệp module. */
export function maTrungGiuaTep(m: MaDung): Map<string, string[]> {
  const ra = new Map<string, string[]>();
  for (const [ma, tep] of m) {
    if (tep.size >= 2 && [...tep].some(laTepModule)) ra.set(ma, [...tep].sort());
  }
  return ra;
}

function tatCaTepTest(): Array<{ duongDan: string; noiDung: string }> {
  const lenh = (args: string[]): string[] =>
    execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split(/\r?\n/)
      .filter((d) => /\.(test|spec)\.(ts|tsx)$/.test(d));
  const ds = [
    ...new Set([...lenh(["ls-files", "--", "*.test.ts", "*.test.tsx", "*.spec.ts", "*.spec.tsx"]), ...lenh(["ls-files", "--others", "--exclude-standard", "--", "*.test.ts", "*.test.tsx", "*.spec.ts", "*.spec.tsx"])]),
  ].filter((d) => existsSync(resolve(process.cwd(), d)));
  return ds.map((d) => ({ duongDan: d, noiDung: readFileSync(resolve(process.cwd(), d), "utf8") }));
}

describe("[NHH-MACA-01] bộ trích mã ca tự chứng minh", () => {
  it("nhận describe/it/test, nháy đơn/kép/backtick, skipIf/fails/skip; chỉ nhận mã ĐỨNG ĐẦU tiêu đề", () => {
    const mau = [
      'describe("[MACA-MAU-A1] nhóm", () => {',
      "  it('[MACA-MAU-A2] ca', () => {});",
      "  it(`[MACA-MAU-A3] ca`, () => {});",
      '  it.skipIf(!RUN)("[MACA-MAU-A4] ca DB", async () => {});',
      '  it.fails("[MACA-MAU-A5] ghim", () => {});',
      '  test.skip("[MACA-MAU-A6] ca", () => {});',
      '  it("không có mã", () => {});',
      '  it("giữa tiêu đề có [MACA-MAU-A7] nhưng không đứng đầu", () => {});',
      '  it(\n    "[MACA-MAU-A8] tiêu đề xuống dòng", () => {});',
    ].join("\n");
    expect(trichMaCa(mau)).toEqual(["[MACA-MAU-A1]", "[MACA-MAU-A2]", "[MACA-MAU-A3]", "[MACA-MAU-A4]", "[MACA-MAU-A5]", "[MACA-MAU-A6]", "[MACA-MAU-A8]"]);
  });

  it("đối chứng dương: cùng mã ở hai tệp ⇒ bị báo; cùng mã TRONG một tệp (họ mã) ⇒ không; hai tệp ngoài module ⇒ không", () => {
    const tep = [
      { duongDan: "lib/hoa-hong/a.test.ts", noiDung: 'it("[MACA-MAU-X1] một", () => {}); it("[MACA-MAU-X1] hai", () => {}); it("[MACA-MAU-Y1] y", () => {});' },
      { duongDan: "tests/hoa-hong/a.spec.ts", noiDung: 'it("[MACA-MAU-X1] tầng DB", () => {});' },
      { duongDan: "lib/lop-khac/b.test.ts", noiDung: 'it("[MACA-MAU-Z1] z", () => {});' },
      { duongDan: "lib/lop-khac/c.test.ts", noiDung: 'it("[MACA-MAU-Z1] z lần hai", () => {});' },
    ];
    const trung = maTrungGiuaTep(gomMaTheoTep(tep));
    expect([...trung.keys()]).toEqual(["[MACA-MAU-X1]"]);
    expect(trung.get("[MACA-MAU-X1]")).toEqual(["lib/hoa-hong/a.test.ts", "tests/hoa-hong/a.spec.ts"]);
  });
});

describe("[NHH-MACA-02] mã ca của module không trùng giữa các tệp (ngoài danh sách đã khai)", () => {
  const tep = tatCaTepTest();
  const m = gomMaTheoTep(tep);
  const trung = maTrungGiuaTep(m);

  it("quét ĐƯỢC tệp (không quét rỗng): đủ nhiều tệp test và mã, kể cả tệp của module", () => {
    expect(tep.length).toBeGreaterThan(500);
    expect(m.size).toBeGreaterThan(1500);
    expect(tep.filter((t) => laTepModule(t.duongDan)).length).toBeGreaterThan(100);
  });

  it("0 mã MỚI trùng giữa hai tệp (báo mã: tệp, tệp)", () => {
    const moi = [...trung].filter(([ma]) => !DA_KHAI.has(ma)).map(([ma, ds]) => `${ma}: ${ds.join(" · ")}`);
    expect(moi).toEqual([]);
  });

  it("danh sách KHÔNG MỤC: mã đã khai mà hết trùng ⇒ xoá khỏi danh sách", () => {
    const het = [...DA_KHAI].filter((ma) => !trung.has(ma));
    expect(het).toEqual([]);
  });

  it("hai danh sách không giẫm nhau và không có mã lặp", () => {
    expect(new Set(TANG_THUAN_VA_DB).size).toBe(TANG_THUAN_VA_DB.length);
    expect(new Set(CHUA_PHAN_XU).size).toBe(CHUA_PHAN_XU.length);
    expect(DA_KHAI.size).toBe(TANG_THUAN_VA_DB.length + CHUA_PHAN_XU.length);
  });

  it("[NHH-MACA-03] các va chạm đã sửa KHÔNG quay lại: PER-04 · SO-W11b · FE-CS-03e · W13 · tiền tố MD- và NGD- của module", () => {
    for (const ma of ["[NHH-PER-04]", "[NHH-SO-W11b]", "[NHH-W13]"]) {
      expect(trung.has(ma), `${ma} lại trùng: ${(trung.get(ma) ?? []).join(" · ")}`).toBe(false);
    }
    // mã dùng hai lần trong cùng một tệp với hai nghĩa (03e) không đo ở lưới tệp; kiểm trực tiếp trên tệp đó
    const bang = tep.find((t) => t.duongDan === "app/(admin)/admin/nguon-hoa-hong/chinh-sach/_components/bang.test.tsx");
    expect(bang, "bang.test.tsx của chính sách không còn trong cây").toBeDefined();
    expect(trichMaCa(bang!.noiDung).filter((x) => x === "[NHH-FE-CS-03e]")).toHaveLength(1);
    // module không còn dùng tiền tố của module khác
    const dungMd = tep.filter((t) => laTepModule(t.duongDan)).flatMap((t) => trichMaCa(t.noiDung).filter((x) => /^\[(?:MD|NGD)-\d+/.test(x)).map((x) => `${x} @ ${t.duongDan}`));
    expect(dungMd).toEqual([]);
  });
});
