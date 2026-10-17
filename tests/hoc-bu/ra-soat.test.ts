// tests/hoc-bu/ra-soat.test.ts — màn "Rà soát dữ liệu Học bù": `docRaSoat` trên Postgres THẬT.
// Chứng minh: (1) gọi tên đúng dữ liệu hỏng dựng tay, cùng kết quả với đường script (cùng `chayToanVen`); (2) KHÔNG ghi một dòng nào (đếm dòng + `updatedAt` trước/sau);
// (3) chạy được trên DB sạch (không phát hiện nào của fixture).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docRaSoat } from "@/lib/hoc-bu/ra-soat-db";
import { dung, don, id, luc, needId } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[RSD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-t07-";
const cuaFixture = (f: { id: string; lienQuan?: Record<string, string> }) => f.id.includes(T) || Object.values(f.lienQuan ?? {}).some((v) => v.includes(T));
const NOW = luc(15, 18, 45);

async function chupDb() {
  const [need, cs, att, audit, event] = await Promise.all([
    db.makeupNeed.findMany({ orderBy: { id: "asc" }, select: { id: true, updatedAt: true, missedLessonId: true, status: true } }),
    db.makeupCase.count(),
    db.attendance.count(),
    db.auditLog.count(),
    db.domainEvent.count(),
  ]);
  return { need: need.map((n) => `${n.id}|${n.updatedAt.toISOString()}|${n.missedLessonId}|${n.status}`), cs, att, audit, event };
}

describe.skipIf(!RUN_DB_TESTS)("[RSD] docRaSoat — chỉ đọc", () => {
  beforeEach(() => dung());
  afterAll(async () => {
    await don();
  });

  it("[RSD-01] thế giới sạch của fixture ⇒ không phát hiện nào thuộc fixture", async () => {
    const { ketQua } = await docRaSoat(NOW);
    expect(ketQua.findings.filter(cuaFixture)).toEqual([]);
  });

  it("[RSD-02] dữ liệu hỏng dựng tay ⇒ gọi tên đúng dòng, kèm nhóm gốc; kết quả khớp đường script", async () => {
    await db.makeupNeed.update({ where: { id: needId("A", 5) }, data: { missedLessonId: null } });
    const { ketQua, tuNgayYmd } = await docRaSoat(NOW);
    const f = ketQua.findings.filter(cuaFixture).filter((x) => x.luat === "TV-03");
    expect(f.map((x) => [x.id, x.phanLoai])).toEqual([[needId("A", 5), "AUTO_FIXABLE"]]);
    expect(f[0]!.nhomGoc).toBe(`dong:${needId("A", 5)}`);
    expect(tuNgayYmd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Cùng bộ luật với đường script: đếm theo luật của CẢ HAI lượt (cùng DB, cùng đồng hồ) phải bằng nhau.
    const { docSnapshot } = await import("@/lib/hoc-bu/toan-ven-db");
    const { chayToanVen } = await import("@/lib/hoc-bu/toan-ven");
    const o = { now: NOW, tuNgayYmd };
    const dung2 = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return chayToanVen(await docSnapshot(tx, o), o);
      },
      { timeout: 60_000, isolationLevel: "RepeatableRead" },
    );
    expect(ketQua.demTheoLuat).toEqual(dung2.demTheoLuat);
    expect(ketQua.findings.map((x) => `${x.luat}:${x.id}`)).toEqual(dung2.findings.map((x) => `${x.luat}:${x.id}`));
  });

  it("[RSD-03] KHÔNG GHI: đếm dòng + `updatedAt` các bảng chính y nguyên sau khi rà soát (kể cả lúc có phát hiện)", async () => {
    await db.makeupNeed.update({ where: { id: needId("A", 5) }, data: { missedLessonId: null } });
    const truoc = await chupDb();
    await docRaSoat(NOW);
    await docRaSoat(NOW); // chạy hai lần: lần hai cũng không ghi (không "đánh dấu đã rà")
    expect(await chupDb()).toEqual(truoc);
    // id fixture vẫn dùng để dọn: không có tiền tố dư trong audit.
    expect(await db.auditLog.count({ where: { entityId: { startsWith: id("") } } })).toBe(0);
  });
});
