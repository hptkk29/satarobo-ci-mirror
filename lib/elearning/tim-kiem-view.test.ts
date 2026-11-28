/** [TKV-*] Nguồn tìm kiếm: số truy vấn cố định, chỉ chọn TIÊU ĐỀ (không nội dung). Ngày TUYỆT ĐỐI (luật 19). */
import { describe, expect, it } from "vitest";
import type { ScopedDb } from "@/lib/actions/factory";
import { napNguonTimKiem } from "./tim-kiem-view";

const NOW = new Date("2026-11-17T03:00:00.000Z");

function dbGia(soKhoa: number, soBaiMoiKhoa: number) {
  const goi: { bang: string; select: Record<string, unknown> | undefined }[] = [];
  const dem =
    <T,>(bang: string, kq: T) =>
    async (a?: { select?: Record<string, unknown> }) => {
      goi.push({ bang, select: a?.select });
      return kq;
    };
  const dong = Array.from({ length: soKhoa }, (_, i) => ({
    id: `e${i}`,
    courseId: `c${i}`,
    status: "IN_PROGRESS",
    dueAt: null,
    progressPercent: 10,
    createdAt: NOW,
    completedAt: null,
  }));
  const bai = dong.flatMap((d) =>
    Array.from({ length: soBaiMoiKhoa }, (_, j) => ({
      id: `${d.courseId}-b${j}`,
      title: `Bài ${j}`,
      kind: "READ",
      orderIndex: j,
      module: { courseId: d.courseId, orderIndex: 0 },
    })),
  );
  const db = {
    trnEnrollment: { findMany: dem("trnEnrollment", dong) },
    trnCourse: { findMany: dem("trnCourse", dong.map((d) => ({ id: d.courseId, title: `Khoá ${d.courseId}` }))) },
    // B-11b — bản đang phát hành mỗi khoá (không có bản ⇒ đọc cây sống).
    trnCourseVersion: { findMany: dem("trnCourseVersion", []) },
    trnLesson: { findMany: dem("trnLesson", bai) },
    trnLessonProgress: { findMany: dem("trnLessonProgress", [{ enrollmentId: "e0", lessonId: "c0-b0", status: "DONE" }]) },
    trnCertificate: { findMany: dem("trnCertificate", []) },
  } as unknown as ScopedDb;
  return { db, goi };
}

describe("[TKV-01] số truy vấn cố định", () => {
  it("1 khoá và 50 khoá (mỗi khoá 5 bài) cùng số lời gọi DB", async () => {
    const a = dbGia(1, 5);
    const b = dbGia(50, 5);
    await napNguonTimKiem(a.db, "u", NOW);
    await napNguonTimKiem(b.db, "u", NOW);
    expect(b.goi.length).toBe(a.goi.length);
    expect(a.goi.length).toBeLessThanOrEqual(7);
  });
  it("không khoá nào ⇒ không truy vấn bài / tiến độ", async () => {
    const { db, goi } = dbGia(0, 0);
    expect(await napNguonTimKiem(db, "u", NOW)).toEqual([]);
    expect(goi.some((g) => g.bang === "trnLesson" || g.bang === "trnLessonProgress")).toBe(false);
  });
});

describe("[TKV-02] chỉ lấy TIÊU ĐỀ — không nội dung bài/câu hỏi (luật cứng #7)", () => {
  it("truy vấn bài chỉ chọn id/title/kind/module — không contentMd, không examId", async () => {
    const { db, goi } = dbGia(2, 2);
    await napNguonTimKiem(db, "u", NOW);
    const sel = goi.find((g) => g.bang === "trnLesson")!.select!;
    expect(Object.keys(sel).sort()).toEqual(["id", "kind", "module", "orderIndex", "title"]);
  });
});

describe("[TKV-03] kết quả", () => {
  it("mỗi bài kèm ngữ cảnh khoá + trạng thái; bài đã xong ghi 'đã xong'", async () => {
    const { db } = dbGia(1, 2);
    const r = await napNguonTimKiem(db, "u", NOW);
    const b0 = r.find((x) => x.id === "bai-e0-c0-b0")!;
    expect(b0.nguCanh).toContain("đã xong");
    expect(b0.href).toBe("/elearning/hoc/e0/c0-b0");
    expect(r.find((x) => x.id === "bai-e0-c0-b1")!.nguCanh).toContain("chưa học");
    expect(r.filter((x) => x.loai === "khoa")).toHaveLength(1);
  });
});
