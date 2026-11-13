// tests/hoc-bu/them-bai-chi-buoi-vang.test.ts — [TBV] 20/10/2026: ô "Dạy thêm bài khác" khi tạo case CHỈ liệt kê buổi VẮNG đang chờ bù, không liệt kê cả giáo trình.
//
// Chủ dự án: "chỗ các bài dạy thêm vào buổi bù thì chỉ cho chọn các buổi vắng thôi không show full nữa".
// Đọc đi qua `docDongCanBuTheoKhoa` — cùng định nghĩa "đang chờ bù" với tab Cần bù (`whereCanBu`).
//
// Chạy:  pnpm test:hoc-bu-db      (`pnpm test:unit` trần sẽ SKIP — thiếu ALLOW_DB_RESET)
// Fixture: A vắng 5,6,7 · B vắng 6,7 · C vắng 7 · D vắng 8, cùng khoá + cùng cơ sở; khoá khác có `BAI_KHAC` (không bao giờ được hiện).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { scopedDb } from "@/lib/db-scope";
import { docDongCanBuTheoKhoa } from "@/lib/hoc-bu/danh-sach-db";
import { ADMIN, BAI, BAI_KHAC, CS, HV, KHOA, don, dung, needId, tao } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[TBV] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const doc = (p: { studentIds?: string[]; loaiTruBai?: string[]; chiCuaSale?: string | null } = {}) =>
  docDongCanBuTheoKhoa(scopedDb(ADMIN), { centerId: CS, courseId: KHOA, chiCuaSale: p.chiCuaSale ?? null, studentIds: p.studentIds, loaiTruBai: p.loaiTruBai });
const bai = (dong: { lessonId: string | null }[]) => [...new Set(dong.map((d) => d.lessonId))].sort();

describe.skipIf(!RUN_DB_TESTS)("[TBV] bài dạy thêm chỉ lấy từ buổi vắng đang chờ bù", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[TBV-01] chọn dòng bài 5 của A ⇒ bài thêm là CHỈ bài 6, 7 (buổi A cũng vắng); không có bài 8 (A không vắng), không có bài của khoá khác", async () => {
    const dong = await doc({ studentIds: [HV.A], loaiTruBai: [BAI[5]] });
    expect(bai(dong)).toEqual([BAI[6], BAI[7]].sort());
    expect(bai(dong)).not.toContain(BAI[8]);
    expect(bai(dong)).not.toContain(BAI_KHAC);
    // Mỗi dòng đúng bé A — không lẫn bé khác vắng cùng bài.
    expect(dong.every((d) => d.studentId === HV.A)).toBe(true);
  });

  it("[TBV-02] không khai bé ⇒ mọi bài có người vắng trong cơ sở + khoá (5,6,7,8), vẫn không có bài khoá khác", async () => {
    const dong = await doc();
    expect(bai(dong)).toEqual([BAI[5], BAI[6], BAI[7], BAI[8]].sort());
    expect(dong.filter((d) => d.lessonId === BAI[7]).map((d) => d.studentId).sort()).toEqual([HV.A, HV.B, HV.C].sort());
  });

  it("[TBV-03] dòng đã xếp vào case hoặc đã huỷ KHÔNG còn là buổi vắng chờ bù — không hiện", async () => {
    await tao([needId("A", 6)]);
    await db.makeupNeed.update({ where: { id: needId("A", 7) }, data: { status: "CANCELLED", waivedAt: new Date("2026-10-02T00:00:00Z"), waivedReason: "Phụ huynh không bù" } });
    const dong = await doc({ studentIds: [HV.A], loaiTruBai: [BAI[5]] });
    expect(dong).toEqual([]);
  });

  it("[TBV-04] phạm vi Sale đi theo: Sale không phụ trách bé nào ⇒ rỗng (không lộ buổi vắng của bé ngoài phạm vi)", async () => {
    expect(await doc({ chiCuaSale: "sale-khong-phu-trach-ai" })).toEqual([]);
    expect((await doc()).length).toBeGreaterThan(0);
  });

  it("[TBV-05] hết lượt ⇒ dòng vẫn trả về nhưng `xep.ok = false` — nơi gọi dùng đúng cờ này để KHÔNG đưa bài chỉ toàn dòng không xếp được vào ô chọn", async () => {
    await don();
    await dung({ A: 0, B: 3, C: 3, D: 3 });
    const dong = await doc({ studentIds: [HV.A], loaiTruBai: [BAI[5]] });
    expect(dong.length).toBe(2);
    expect(dong.every((d) => d.xep.ok === false)).toBe(true);
    const dongB = await doc({ studentIds: [HV.B] });
    expect(dongB.every((d) => d.xep.ok === true)).toBe(true);
  });
});
