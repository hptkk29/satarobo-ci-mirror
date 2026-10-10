// lib/org/center-bridge.test.ts — BẢNG PHÂN LOẠI có bỏ sót bảng nào không.
//
// VÌ SAO CÓ FILE NÀY (nó KHÔNG thay `[US-07-IT-08b]`):
// Lưới hiện có, `findUnclassifiedTables()`, hỏi `information_schema` nên chỉ chạy
// khi có Postgres — nó nằm trong bộ e2e a0 (`tests/e2e/a0/orgunit-dual-write.spec.ts`).
// Bảng mới thêm ở một nhánh khác thì lưới đó chỉ đỏ SAU KHI người vận hành chạy
// migration, tức muộn hơn lúc gây ra lỗi nhiều ngày. Bộ dưới đây hỏi THẲNG schema
// Prisma (`Prisma.dmmf`), không cần DB, nên đỏ ngay trong `pnpm test:unit`.
//
// ⚠️ Điểm mù đã biết của cách này: `Prisma.dmmf` đọc từ Prisma Client ĐÃ SINH.
// Thêm model vào `schema.prisma` mà chưa chạy `prisma generate` thì lưới dmmf im
// lặng — đó là lý do ca `[ZC-DB-03]` assert TƯỜNG MINH theo tên model chứ không
// chỉ dựa vào vòng lặp dmmf.
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  BACKFILL_SPECS,
  BACKFILL_SPEC_BY_MODEL,
  DUAL_WRITE_MODELS,
  PR_A_MODELS,
} from "@/lib/org/center-bridge";
import { SCOPED_MODELS, SCOPE_EXEMPT } from "@/lib/db-scope";

/** Tên mọi model Prisma có ĐỦ CẢ HAI cột — đúng điều kiện `discoverDualColumnTables()`. */
function modelsCoDuHaiCot(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter(
      (m) =>
        m.fields.some((f) => f.name === "centerId") &&
        m.fields.some((f) => f.name === "orgUnitId"),
    )
    .map((m) => m.name);
}

describe("bảng phân loại centerId ↔ orgUnitId", () => {
  it("[ZC-DB-03] ZaloCrmNick/ZaloCrmThread đã khai BACKFILL_SPECS", () => {
    // Không khai ⇒ cron đối soát đêm (`/api/cron/orgunit-drift`) lặng lẽ BỎ QUA hai
    // bảng này, và ghi kép `centerId → orgUnitId` KHÔNG bật (DUAL_WRITE_MODELS suy
    // tự động từ đây) ⇒ lệch tích luỹ vô hình cho tới ngày P4 cutover.
    for (const model of ["ZaloCrmNick", "ZaloCrmThread"]) {
      const spec = BACKFILL_SPEC_BY_MODEL.get(model);
      expect(spec, `${model} chưa khai trong BACKFILL_SPECS`).toBeDefined();
      // `scoped` là cờ MÔ TẢ — nó phải khớp với chỗ model thật sự được khai ở
      // lib/db-scope.ts, nếu không thì bảng phân loại nói một đằng, cách ly làm một nẻo.
      expect(spec?.scoped, `${model}: scoped phải là false (nằm ở SCOPE_EXEMPT)`).toBe(
        false,
      );
      expect(DUAL_WRITE_MODELS.has(model), `${model} phải được ghi kép`).toBe(true);
    }
  });

  it("[ZC-DB-03b] cờ `scoped` của MỌI spec khớp với lib/db-scope.ts", () => {
    // Lệch ở đây là kiểu lỗi không bao giờ văng ra: báo cáo đối soát in "scoped: true"
    // trong khi scopedDb không lọc gì, nên người đọc báo cáo tưởng đã được che.
    for (const spec of BACKFILL_SPECS) {
      const thatSuScoped = SCOPED_MODELS.has(spec.model);
      // Model chưa có trong Prisma Client đã sinh vẫn phải khai đúng ở một trong hai
      // tập — nhưng chỉ so cờ khi nó được phân loại, để lưới này không đỏ vì lý do khác.
      if (!thatSuScoped && !SCOPE_EXEMPT.has(spec.model)) continue;
      expect(spec.scoped, `${spec.model}: cờ scoped lệch với lib/db-scope.ts`).toBe(
        thatSuScoped,
      );
    }
  });

  it("[ZC-DB-03c] không model nào có đủ 2 cột mà thiếu phân loại (bản THUẦN của US-07-IT-08b)", () => {
    const daKhai = new Set<string>([...BACKFILL_SPECS.map((s) => s.model), ...PR_A_MODELS]);
    const bosot = modelsCoDuHaiCot().filter((m) => !daKhai.has(m));
    expect(bosot).toEqual([]);
  });

  it("BACKFILL_SPECS không khai trùng model", () => {
    const ten = BACKFILL_SPECS.map((s) => s.model);
    expect(ten.length).toBe(new Set(ten).size);
  });
});
