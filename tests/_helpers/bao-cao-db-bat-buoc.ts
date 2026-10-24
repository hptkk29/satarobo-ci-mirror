// tests/_helpers/bao-cao-db-bat-buoc.ts — reporter vitest cho CỔNG DB BẮT BUỘC (chấm công / Parttime / học bù / mục db
// của ci-rieng). Gắn bằng cờ dòng lệnh ở bước CI — `--reporter=./tests/_helpers/bao-cao-db-bat-buoc.ts` — chứ không qua
// `reporters` của config: script `pnpm test:*-db` truyền `--reporter=verbose`, và cờ dòng lệnh THAY HẲN `reporters` của config.
//
// Vì sao (18/10/2026): bộ DB tự skip khi DATABASE_URL không trỏ Postgres cục bộ (`isLocal ? describe : describe.skip`,
// `tests/_helpers/db-gate.ts`). Skip hết thì vitest thoát 0 — "xanh" mà không ca nào chạm Postgres. Reporter này đỏ khi:
//   · 0 tệp test;
//   · một tệp KHÔNG có ca nào chạy (mọi ca skip / todo) — đúng hình dạng "DB không tới được ⇒ skip câm";
// Không dùng khi lọc `-t` ở máy (ca không khớp bộ lọc cũng là "skip").
import type { Reporter, TestModule } from "vitest/node";

export type KetQuaTep = { tep: string; trangThai: readonly string[] };

/** Thuần — để test không cần chạy vitest lồng vitest. */
export function xetKetQuaDb(tep: readonly KetQuaTep[]): { ok: boolean; loi: string[] } {
  if (tep.length === 0) return { ok: false, loi: ["0 tệp test — cổng DB không chạy gì."] };
  const loi = tep
    .filter((t) => !t.trangThai.some((s) => s === "passed" || s === "failed"))
    .map((t) => `${t.tep}: ${t.trangThai.length} ca, 0 ca chạy (skip/todo toàn bộ — DB không tới được?)`);
  return { ok: loi.length === 0, loi };
}

export default class BaoCaoDbBatBuoc implements Reporter {
  onTestRunEnd(modules: ReadonlyArray<TestModule>) {
    const kq = xetKetQuaDb(modules.map((m) => ({ tep: m.moduleId, trangThai: [...m.children.allTests()].map((t) => t.result().state) })));
    if (kq.ok) {
      console.log(`[cong-db] đạt — ${modules.length} tệp, mỗi tệp có ≥ 1 ca chạy thật.`);
      return;
    }
    for (const l of kq.loi) console.error(`[cong-db] ĐỎ — ${l}`);
    process.exitCode = 1;
  }
}
