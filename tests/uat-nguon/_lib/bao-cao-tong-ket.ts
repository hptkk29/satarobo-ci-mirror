// tests/uat-nguon/_lib/bao-cao-tong-ket.ts — reporter: gom MỌI ca (kể cả ca SKIP chờ fixture, không có nhật ký) thành
// `uat-evidence/_tong-ket.json` + `_tong-ket.md`. Chỉ ĐỌC kết quả Playwright và các tệp `<ID>.json` đã ghi; không chứa bí mật.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { FullConfig, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import { maCaTuTen } from "./an-toan";
import { thuMucBangChung } from "./nhat-ky";

type Dong = { id: string; title: string; result: "PASS" | "FAIL" | "BLOCKED" | "SKIP" | "INTERRUPTED"; reason: string | null; file: string };

export default class BaoCaoTongKet implements Reporter {
  private dong: Dong[] = [];
  private dir = thuMucBangChung(process.env);

  onBegin(_config: FullConfig, _suite: Suite): void {
    mkdirSync(this.dir, { recursive: true });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const id = maCaTuTen(test.title) ?? test.title;
    let ketQua: Dong["result"];
    let lyDo: string | null = null;
    const tepNhatKy = join(this.dir, `${id}.json`);
    const nhatKy = existsSync(tepNhatKy)
      ? (JSON.parse(readFileSync(tepNhatKy, "utf8")) as { result?: string; reason?: string | null })
      : null;
    if (result.status === "skipped") {
      ketQua = nhatKy?.result === "BLOCKED" ? "BLOCKED" : "SKIP";
      lyDo = nhatKy?.reason ?? test.annotations.find((an) => an.type === "cho-fixture")?.description ?? null;
    } else if (result.status === "passed") {
      ketQua = "PASS";
    } else if (result.status === "interrupted") {
      ketQua = "INTERRUPTED";
    } else {
      ketQua = "FAIL";
      lyDo = nhatKy?.reason ?? result.error?.message?.split("\n")[0] ?? null;
    }
    this.dong.push({ id, title: test.title, result: ketQua, reason: lyDo, file: test.location.file.split(/[\\/]/).pop() ?? "" });
  }

  onEnd(): void {
    const dem = (k: Dong["result"]) => this.dong.filter((d) => d.result === k).length;
    const tong = {
      total: this.dong.length,
      PASS: dem("PASS"),
      FAIL: dem("FAIL"),
      BLOCKED: dem("BLOCKED"),
      SKIP: dem("SKIP"),
      INTERRUPTED: dem("INTERRUPTED"),
    };
    const sapXep = [...this.dong].sort((a, b) => a.id.localeCompare(b.id));
    writeFileSync(join(this.dir, "_tong-ket.json"), JSON.stringify({ origin: process.env.UAT_BASE_URL ?? null, runCode: process.env.UAT_RUN_CODE ?? null, tong, cases: sapXep }, null, 2), "utf8");
    const md = [
      `## UAT Nguồn — kết quả (đợt \`${process.env.UAT_RUN_CODE ?? "?"}\`)`,
      "",
      `Tổng ${tong.total} · PASS ${tong.PASS} · FAIL ${tong.FAIL} · BLOCKED ${tong.BLOCKED} · SKIP ${tong.SKIP}${tong.INTERRUPTED ? ` · INTERRUPTED ${tong.INTERRUPTED}` : ""}`,
      "",
      "| Mã ca | Kết quả | Ghi chú |",
      "|---|---|---|",
      ...sapXep.map((d) => `| ${d.id} | ${d.result} | ${(d.reason ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 200)} |`),
      "",
      "BLOCKED = tiền đề môi trường không có (không kết luận được); SKIP = chờ fixture của lane khác. Không tính BLOCKED/SKIP là đạt.",
    ].join("\n");
    writeFileSync(join(this.dir, "_tong-ket.md"), md, "utf8");
  }
}
