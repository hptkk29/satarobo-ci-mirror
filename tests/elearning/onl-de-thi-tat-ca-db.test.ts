// @vitest-environment node
/**
 * [ONL-DT-ALL-*] Danh sách đề kiểm tra ONLINE của mọi khoá (phần "Đề của khoá online" ở màn Đề thi nội bộ) — Postgres thật.
 * Miền Online tách bạch: chỉ đọc `OnlAssessment`; KHÔNG đọc `TrnExam` (đối chứng: một đề nội bộ có thật không được lọt vào); khoá đã gỡ không hiện.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { docDeThiOnlineTatCa } from "../../lib/elearning-online/danh-gia-db";
import { taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_ONLDT_";
async function don() {
  await db.trnExam.deleteMany({ where: { title: { startsWith: P } } });
  await donBangOnl(db);
}

describe.skipIf(!RUN_DB_TESTS)("[ONL-DT-ALL] đề online mọi khoá (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-DT-ALL-01] 🔴 mới nhất trước, `tong` là số thật (trần take chỉ cắt dòng), kèm tên khoá + số câu/lượt; KHÔNG lẫn đề nội bộ; khoá đã gỡ không hiện", async () => {
    const khoa = async (ten: string) => {
      const t = await taoKhoa(db, { code: `CI-ONLDT-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`, name: `${P}${ten}`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
      if (!t.ok) throw new Error(t.thongBao);
      return t.courseId;
    };
    const k1 = await khoa("Khoá một");
    const k2 = await khoa("Khoá hai");
    const kGo = await khoa("Khoá đã gỡ");
    const de = (courseId: string, title: string, status: "DRAFT" | "ACTIVE", ngayTruoc: number) =>
      db.onlAssessment.create({
        data: { courseId, kind: "QUIZ", title: `${P}${title}`, passPercent: 70, timeLimitMin: 20, maxAttempts: 2, status, createdAt: new Date(Date.now() - ngayTruoc * 86_400_000) },
        select: { id: true },
      });
    await de(k1, "Đề cũ", "ACTIVE", 5);
    await de(k2, "Đề mới", "DRAFT", 1);
    await de(kGo, "Đề của khoá đã gỡ", "ACTIVE", 2);
    await db.onlCourse.update({ where: { id: kGo }, data: { deletedAt: new Date() } });
    // đối chứng: đề NỘI BỘ có thật
    await db.trnExam.create({ data: { title: `${P}Đề nội bộ`, durationMin: 10, passScore: 1, maxScore: 1, isActive: true } });

    const r = await docDeThiOnlineTatCa(db);
    const cua = r.dong.filter((d) => d.title.startsWith(P));
    expect(cua.map((d) => d.title)).toEqual([`${P}Đề mới`, `${P}Đề cũ`]); // mới nhất trước; khoá đã gỡ KHÔNG hiện; đề nội bộ KHÔNG lọt vào
    expect(cua[0]).toMatchObject({ status: "DRAFT", passPercent: 70, timeLimitMin: 20, maxAttempts: 2, courseId: k2 });
    expect(cua[0]!.course.name).toBe(`${P}Khoá hai`);
    expect(cua[0]!._count).toEqual({ questions: 0, attempts: 0 });
    expect(r.tong).toBeGreaterThanOrEqual(2);
    const cat = await docDeThiOnlineTatCa(db, { take: 1 });
    expect(cat.dong).toHaveLength(1);
    expect(cat.tong).toBe(r.tong); // trần chỉ cắt dòng, KHÔNG cắt số đếm
    expect((await docDeThiOnlineTatCa(db, { take: 0 })).dong).toHaveLength(1); // chặn dưới
    expect(JSON.stringify(r)).not.toContain("Đề nội bộ");
  }, 120_000);
});
