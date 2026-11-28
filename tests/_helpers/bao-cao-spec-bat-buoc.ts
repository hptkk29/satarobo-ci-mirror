// tests/_helpers/bao-cao-spec-bat-buoc.ts — reporter vitest cho các spec BẮT BUỘC (quyền giao hàng, huỷ đơn, quyền hoàn tiền Online — M8 P1 mục 8).
// Gắn bằng cờ dòng lệnh ở bước CI: `pnpm test:online-bat-buoc-db --reporter=./tests/_helpers/bao-cao-spec-bat-buoc.ts`.
//
// Vì sao cần thêm ngoài `bao-cao-db-bat-buoc.ts`: các spec này tự `describe.skipIf(!RUN)` ⇒ DB không tới được hay tên DB lạ là SKIP và vitest vẫn
// thoát 0. Reporter cũ chỉ đỏ khi CẢ tệp không ca nào chạy; ở đây KHÔNG được phép skip MỘT ca nào, và mọi tệp trong danh sách PHẢI có mặt
// (lệnh lọc nhiều tệp: một tệp đổi tên/xoá thì vitest lặng lẽ chạy các tệp còn lại và thoát 0). `it.fails` đạt tính là «passed».
// Không dùng khi lọc `-t` ở máy (ca ngoài bộ lọc là «skip»).
import type { Reporter, TestModule } from "vitest/node";

/** Bỏ/đổi tên một dòng ở đây là đổi cổng CI — lưới `[CI-DB-08]` đòi script `test:online-bat-buoc-db` khớp đúng danh sách này. */
export const SPEC_BAT_BUOC = [
  "tests/mobile-api/online-van-hanh-giao-quyen.spec.ts", // [VHQ] quyền giao hàng (PII người nhận, đổi trạng thái)
  "tests/mobile-api/online-van-hanh-giao.spec.ts", // [VH] vận hành giao hàng
  "tests/mobile-api/online-huy-hoan-dua.spec.ts", // [DUA] đua huỷ đơn / tiền vào / mã giảm
  "tests/mobile-api/online-hoan-tien-admin-quyen.spec.ts", // [HTQ] quyền Admin API hoàn tiền Online
  "tests/mobile-api/online-van-hanh-giao-trang-thai.spec.ts", // [VHT] chặn chuyển trạng thái giao hàng sai + nhật ký
  "tests/mobile-api/online-thao-tac-tien-quyen.spec.ts", // [TTO] quyền thao tác tiền / trạng thái trên đơn Online
  "tests/mobile-api/online-tien-ve-man-doi-soat.spec.ts", // [MDS] tiền về trên đơn Online đã huỷ vẫn hiện ở màn đối soát
] as const;

export type KetQuaCa = { ten: string; trangThai: string };
export type KetQuaTepBatBuoc = { tep: string; ca: readonly KetQuaCa[] };

/** Thuần — để test không cần chạy vitest lồng vitest. */
export function xetSpecBatBuoc(daChay: readonly KetQuaTepBatBuoc[], batBuoc: readonly string[]): { ok: boolean; loi: string[] } {
  const loi: string[] = [];
  if (batBuoc.length === 0) loi.push("danh sách spec bắt buộc rỗng — cổng không canh gì.");
  for (const spec of batBuoc) {
    const tep = daChay.filter((t) => {
      const p = t.tep.replace(/\\/g, "/");
      return p === spec || p.endsWith(`/${spec}`);
    });
    if (tep.length === 0) {
      loi.push(`${spec}: KHÔNG được chạy (đổi tên, xoá, hay lọt khỏi bộ lọc lệnh).`);
      continue;
    }
    const ca = tep.flatMap((t) => t.ca);
    if (ca.length === 0) loi.push(`${spec}: 0 ca (lỗi nạp tệp?).`);
    const khongChay = ca.filter((c) => c.trangThai !== "passed" && c.trangThai !== "failed");
    if (khongChay.length > 0) loi.push(`${spec}: ${khongChay.length}/${ca.length} ca KHÔNG chạy (skip/todo/pending), vd «${khongChay[0]!.ten}».`);
  }
  return { ok: loi.length === 0, loi };
}

export default class BaoCaoSpecBatBuoc implements Reporter {
  onTestRunEnd(modules: ReadonlyArray<TestModule>) {
    const kq = xetSpecBatBuoc(
      modules.map((m) => ({ tep: m.moduleId, ca: [...m.children.allTests()].map((t) => ({ ten: t.name, trangThai: t.result().state })) })),
      SPEC_BAT_BUOC,
    );
    if (kq.ok) {
      console.log(`[spec-bat-buoc] đạt — ${SPEC_BAT_BUOC.length} tệp bắt buộc đều có mặt, 0 ca bị skip.`);
      return;
    }
    for (const l of kq.loi) console.error(`[spec-bat-buoc] ĐỎ — ${l}`);
    process.exitCode = 1;
  }
}
