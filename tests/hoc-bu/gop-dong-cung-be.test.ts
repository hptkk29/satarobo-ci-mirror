// tests/hoc-bu/gop-dong-cung-be.test.ts — HB-GOP [13/10/2026]: tạo MỘT case nhiều bài thì dòng cần bù của CHÍNH các bé ở những bài ấy đi theo case.
//
// Chủ dự án: "tạo 1 case nhiều buổi, ví dụ buổi 1 + buổi 2, thì case cần bù của buổi 2 phải mất và gộp chung với case dạy bù của buổi 1".
// Trước đây người xếp phải tự tích đủ từng dòng; dòng quên tích vẫn "chờ bù" dù bé đã học đúng bài ấy trong case.
//
// Chạy:  pnpm test:hoc-bu-db      (`pnpm test:unit` trần sẽ SKIP — thiếu ALLOW_DB_RESET)
// Fixture: A vắng 5,6,7 · B vắng 6,7 · C vắng 7 · D vắng 8, cùng khoá + cùng cơ sở (`_case-nhieu-bai-fixture.ts`).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { BAI, HV, don, dung, mucCua, need, needId, sach, so, tao } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[GOP] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const mucTrongCase = (caseId: string) => db.makeupCaseStudent.findMany({ where: { caseId, result: { not: "RELEASED" } }, select: { makeupNeedId: true, lessonId: true } });
const nhatKyTao = async (caseId: string) =>
  (await db.auditLog.findFirstOrThrow({ where: { module: "hoc-bu", entityId: caseId, action: "hoc-bu.tao-case" } })).newValues as { needIds: string[]; gopThem?: string[] };

describe.skipIf(!RUN_DB_TESTS)("[GOP] gộp dòng cần bù cùng bé khi tạo case nhiều bài", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[GOP-01] chọn dòng bài 5 của A + thêm bài 6 vào bộ bài ⇒ dòng bài 6 của A đi theo case (biến khỏi cần bù), dòng bài 7 (ngoài bộ bài) ở lại; nhật ký ghi rõ dòng được gộp", async () => {
    const c = await tao([needId("A", 5)], { lessonIds: [BAI[5], BAI[6]] });
    expect((await need("A", 5)).status).toBe("SCHEDULED");
    expect((await need("A", 6)).status).toBe("SCHEDULED"); // được gộp — không còn là một dòng chờ riêng
    expect((await need("A", 7)).status).toBe("PENDING"); // bài 7 không thuộc bộ bài
    expect((await mucTrongCase(c)).map((m) => m.makeupNeedId).sort()).toEqual([needId("A", 5), needId("A", 6)].sort());
    expect((await mucCua(c, "A", 6)).dungLuot).toBe(true);
    expect(await so("A")).toEqual({ granted: 3, held: 2, consumed: 0, con: 1 }); // mỗi dòng gộp giữ MỘT lượt như dòng được chọn
    const nk = await nhatKyTao(c);
    expect(nk.gopThem).toEqual([needId("A", 6)]);
    expect([...nk.needIds].sort()).toEqual([needId("A", 5), needId("A", 6)].sort());
    await sach();
  });

  it("[GOP-02] KHÔNG thêm bài (bộ bài chỉ gồm bài của dòng được chọn) ⇒ không gộp gì: dòng bài 6, 7 của A ở lại danh sách cần bù như cũ", async () => {
    const c = await tao([needId("A", 5)]);
    expect((await mucTrongCase(c)).map((m) => m.makeupNeedId)).toEqual([needId("A", 5)]);
    expect((await need("A", 6)).status).toBe("PENDING");
    expect((await need("A", 7)).status).toBe("PENDING");
    expect((await nhatKyTao(c)).gopThem).toBeUndefined();
    expect(await so("A")).toEqual({ granted: 3, held: 1, consumed: 0, con: 2 });
  });

  it("[GOP-03] CHỈ gộp dòng của bé ĐÃ ĐƯỢC CHỌN: bé khác vắng cùng bài trong bộ bài (B6, B7, C7) không bị kéo vào case", async () => {
    const c = await tao([needId("A", 5)], { lessonIds: [BAI[5], BAI[6], BAI[7]] });
    expect((await mucTrongCase(c)).map((m) => m.makeupNeedId).sort()).toEqual([needId("A", 5), needId("A", 6), needId("A", 7)].sort());
    for (const [hv, b] of [["B", 6], ["B", 7], ["C", 7]] as const) expect((await need(hv, b)).status).toBe("PENDING");
    expect(await db.makeupCaseParticipant.count({ where: { caseId: c, studentId: { in: [HV.B, HV.C] } } })).toBe(0);
    await sach();
  });

  it("[GOP-04] hết lượt: bé còn 1 lượt ⇒ dòng được chọn vẫn xếp được, dòng bài 6 KHÔNG gộp (ở lại cần bù) và việc tạo case không bị lỗi", async () => {
    await dung({ A: 1, B: 3, C: 3, D: 3 });
    const c = await tao([needId("A", 5)], { lessonIds: [BAI[5], BAI[6]] });
    expect((await need("A", 5)).status).toBe("SCHEDULED");
    expect((await need("A", 6)).status).toBe("PENDING"); // gộp sẽ cần lượt thứ hai mà bé chỉ còn một
    expect((await mucTrongCase(c)).map((m) => m.makeupNeedId)).toEqual([needId("A", 5)]);
    expect(await so("A")).toEqual({ granted: 1, held: 1, consumed: 0, con: 0 });
    expect((await nhatKyTao(c)).gopThem).toBeUndefined();
    await sach();
  });

  it("[GOP-05] hai bé cùng được gộp: A (5,6,7) và B (6,7) chọn dòng đầu của mỗi bé + bộ bài 5-6-7 ⇒ cả năm dòng nằm trong MỘT case, không dòng nào ở lại", async () => {
    const c = await tao([needId("A", 5), needId("B", 6)], { lessonIds: [BAI[5], BAI[6], BAI[7]] });
    expect((await mucTrongCase(c)).length).toBe(5);
    for (const [hv, b] of [["A", 5], ["A", 6], ["A", 7], ["B", 6], ["B", 7]] as const) expect((await need(hv, b)).status).toBe("SCHEDULED");
    expect((await need("C", 7)).status).toBe("PENDING");
    expect([...(await nhatKyTao(c)).gopThem!].sort()).toEqual([needId("A", 6), needId("A", 7), needId("B", 7)].sort());
    await sach();
  });
});
