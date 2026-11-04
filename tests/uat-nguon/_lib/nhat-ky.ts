// tests/uat-nguon/_lib/nhat-ky.ts — GHI BẰNG CHỨNG từng ca UAT: `uat-evidence/<ID>.json` + ảnh `uat-evidence/<ID>/NN-ten-<rộng>.png`.
//
// Mỗi ca có một NHẬT KÝ gồm các BƯỚC KIỂM; mỗi bước ghi đủ: ai (actor) · làm gì · đầu vào · kỳ vọng · thực tế · đạt/không · lúc nào.
// Đạt = `true`, không đạt = `false`, `null` = chỉ ghi nhận thông tin (không tính vào kết quả).
//
// Bốn kết quả của một ca — KHÔNG gộp BLOCKED vào PASS:
//   PASS     mọi bước kiểm đạt.
//   FAIL     có bước không đạt, hoặc ca ném lỗi/hết giờ.
//   BLOCKED  tiền đề của môi trường không có (cờ tắt, thiếu dữ liệu…) — KHÔNG kết luận được gì về tính năng. Ghi rõ lý do.
//   SKIP     ca chờ fixture của lane khác (khai bằng `test.skip` ở tệp riêng) — không có nhật ký, chỉ có trong tổng kết.
//
// Nhật ký được GHI NGAY KHI KẾT THÚC CA (kể cả khi ca đỏ) và luôn đi qua `cheBiMatSau` — mật khẩu UAT không bao giờ vào tệp.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { cheBiMatSau, type MoiTruongUat } from "./an-toan";

export type KetQuaCa = "PASS" | "FAIL" | "BLOCKED";

export type BuocKiem = {
  n: number;
  actor: string;
  action: string;
  input: unknown;
  expected: unknown;
  actual: unknown;
  /** true = đạt · false = không đạt · null = chỉ ghi nhận. */
  pass: boolean | null;
  timestamp: string;
  screenshots: string[];
};

export type BangChungCa = {
  id: string;
  title: string;
  result: KetQuaCa;
  reason: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  env: { origin: string; runCode: string; runId: string | null; sha: string | null };
  actors: string[];
  steps: BuocKiem[];
  screenshots: string[];
  violations: string[];
  errors: string[];
};

/** Thư mục gốc bằng chứng (tương đối cwd, hoặc tuyệt đối nếu `UAT_EVIDENCE_DIR` là đường tuyệt đối). */
export const thuMucBangChung = (env: NodeJS.ProcessEnv): string => env.UAT_EVIDENCE_DIR?.trim() || "uat-evidence";

const lamSlug = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48);

class CaBiChan extends Error {
  constructor(public lyDo: string) {
    super(`BLOCKED: ${lyDo}`);
  }
}

export class NhatKyCa {
  private steps: BuocKiem[] = [];
  private anh: string[] = [];
  private actors = new Set<string>();
  private viPham: string[] = [];
  private lyDoChan: string | null = null;
  private demAnh = 0;
  private readonly batDau: Date;

  constructor(
    readonly id: string,
    private readonly tieuDe: string,
    private readonly env: MoiTruongUat,
    private readonly dot: string,
    private readonly thuMuc: string,
    private readonly biMat: readonly string[],
    private readonly testInfo: TestInfo,
    bayGio: Date,
  ) {
    this.batDau = bayGio;
  }

  /** Ghi một bước kiểm; không đạt ⇒ test đỏ NHƯNG ca vẫn chạy tiếp (expect.soft) để bằng chứng đủ. */
  buoc(b: { actor: string; action: string; input?: unknown; expected: unknown; actual: unknown; pass: boolean | null; screenshots?: string[] }): void {
    this.actors.add(b.actor);
    this.steps.push({
      n: this.steps.length + 1,
      actor: b.actor,
      action: b.action,
      input: b.input ?? null,
      expected: b.expected,
      actual: b.actual,
      pass: b.pass,
      timestamp: new Date().toISOString(),
      screenshots: b.screenshots ?? [],
    });
    if (b.pass !== null) {
      const msg = `[${this.id}] ${b.actor} · ${b.action}\n  kỳ vọng: ${JSON.stringify(b.expected)}\n  thực tế: ${JSON.stringify(b.actual)}`;
      expect.soft(b.pass, cheBiMatSau(msg, this.biMat)).toBe(true);
    }
  }

  /** Chỉ ghi nhận (không ảnh hưởng kết quả). */
  thongTin(actor: string, action: string, actual: unknown, input?: unknown): void {
    this.buoc({ actor, action, input, expected: "(chỉ ghi nhận)", actual, pass: null });
  }

  /** Một request bị cổng host chặn — luôn làm ca đỏ. */
  ghiViPham(msg: string): void {
    this.viPham.push(msg);
    expect.soft(false, `[${this.id}] request bị chặn ngoài môi trường test: ${msg}`).toBe(true);
  }

  /** Chụp ảnh ở kích thước hiện tại của trang. Trả đường dẫn tương đối thư mục bằng chứng. */
  async chup(page: Page, ten: string, tuyChon: { fullPage?: boolean; hau?: string } = {}): Promise<string> {
    this.demAnh += 1;
    const tep = `${String(this.demAnh).padStart(2, "0")}-${lamSlug(ten)}${tuyChon.hau ? `-${tuyChon.hau}` : ""}.png`;
    const tuongDoi = `${this.id}/${tep}`;
    const tuyetDoi = join(this.thuMuc, this.id, tep);
    mkdirSync(dirname(tuyetDoi), { recursive: true });
    await page.screenshot({ path: tuyetDoi, fullPage: tuyChon.fullPage ?? true });
    this.anh.push(tuongDoi);
    return tuongDoi;
  }

  /** Chụp ở 375 / 768 / 1280 / 1920 rồi trả khung về 1280×800. Trả đường dẫn các ảnh. */
  async chupDaKichThuoc(page: Page, ten: string): Promise<string[]> {
    const kt: ReadonlyArray<readonly [number, number]> = [
      [375, 812],
      [768, 1024],
      [1280, 800],
      [1920, 1080],
    ];
    const ra: string[] = [];
    for (const [w, h] of kt) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(350);
      ra.push(await this.chup(page, ten, { hau: String(w) }));
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    return ra;
  }

  /** Tiền đề không có ⇒ ghi BLOCKED và dừng ca (không đỏ, không xanh). */
  biChan(lyDo: string): never {
    this.lyDoChan = lyDo;
    this.steps.push({
      n: this.steps.length + 1,
      actor: "(hệ thống)",
      action: "Kiểm tiền đề của môi trường",
      input: null,
      expected: "tiền đề có mặt",
      actual: lyDo,
      pass: null,
      timestamp: new Date().toISOString(),
      screenshots: [],
    });
    this.testInfo.skip(true, `BLOCKED: ${lyDo}`);
    throw new CaBiChan(lyDo); // không tới được (skip ném trước) — giữ cho kiểu `never`
  }

  /** Ghi tệp bằng chứng. Gọi ở teardown của fixture, SAU khi trạng thái test đã biết. */
  ketThuc(): BangChungCa {
    const ketThuc = new Date();
    const loi = this.testInfo.errors.map((e) => e.message ?? "").filter(Boolean);
    const hong = this.testInfo.status !== undefined && this.testInfo.status !== "passed" && this.testInfo.status !== "skipped";
    const result: KetQuaCa = this.lyDoChan !== null ? "BLOCKED" : hong || this.steps.some((s) => s.pass === false) || this.viPham.length > 0 ? "FAIL" : "PASS";
    const bang: BangChungCa = {
      id: this.id,
      title: this.tieuDe,
      result,
      reason: this.lyDoChan ?? (result === "FAIL" ? (loi[0]?.split("\n")[0] ?? "xem steps") : null),
      startedAt: this.batDau.toISOString(),
      finishedAt: ketThuc.toISOString(),
      durationMs: ketThuc.getTime() - this.batDau.getTime(),
      env: { origin: this.env.origin, runCode: this.dot, runId: process.env.GITHUB_RUN_ID ?? null, sha: process.env.GITHUB_SHA?.slice(0, 12) ?? null },
      actors: [...this.actors],
      steps: this.steps,
      screenshots: this.anh,
      violations: this.viPham,
      errors: loi,
    };
    const tep = join(this.thuMuc, `${this.id}.json`);
    mkdirSync(dirname(tep), { recursive: true });
    writeFileSync(tep, JSON.stringify(cheBiMatSau(bang, this.biMat), null, 2), "utf8");
    return bang;
  }
}

/**
 * Thu hẹp kiểu + chặn ca khi thiếu tiền đề: `canCo(ca, href, "lý do")` ⇒ nếu `href` là null/undefined/false thì ca BLOCKED (ném), sau đó TS biết `href` có giá trị.
 * Vì sao không dùng thẳng `if (!href) ca.biChan(…)`: `biChan` trả `never` nhưng TypeScript chỉ thu hẹp kiểu qua lời gọi của hàm có CHÚ THÍCH KIỂU RÕ — còn `ca` ở đây là tham số fixture Playwright (suy ra kiểu), nên
 * không thu hẹp và mọi dòng dùng giá trị sau đó báo `string | null`.
 */
export function canCo<T>(ca: NhatKyCa, gia: T, lyDo: string): asserts gia is NonNullable<T> {
  if (gia === null || gia === undefined || (gia as unknown) === false) ca.biChan(lyDo);
}
