import { describe, it, expect } from "vitest";
import type { ScopedDb } from "@/lib/actions/factory";
import { napTongQuanHocTap } from "./dashboard-view";

// Đồng hồ đóng băng (luật 19).
const NOW = new Date("2026-10-25T03:00:00.000Z");
const ngay = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

type Goi = { bang: string; ham: string };

/** DB giả CHỈ đếm lời gọi — thứ cần chứng minh là số truy vấn KHÔNG tăng theo số khoá. */
function dbGia(soKhoa: number, bai: { kind: string } | null) {
  const goi: Goi[] = [];
  const dem = <T,>(bang: string, ham: string, kq: T) => async () => {
    goi.push({ bang, ham });
    return kq;
  };
  const dong = Array.from({ length: soKhoa }, (_, i) => ({
    id: `e${i}`,
    courseId: `c${i}`,
    status: i === 0 ? "IN_PROGRESS" : "NOT_STARTED",
    dueAt: ngay(i + 1),
    progressPercent: i === 0 ? 40 : 0,
  }));
  const db = {
    trnEnrollment: { findMany: dem("trnEnrollment", "findMany", dong) },
    trnCourse: {
      findMany: dem(
        "trnCourse",
        "findMany",
        dong.map((d) => ({ id: d.courseId, title: `Khoá ${d.courseId}` })),
      ),
    },
    trnCertificate: { findMany: dem("trnCertificate", "findMany", []) },
    trnLessonProgress: {
      findFirst: dem(
        "trnLessonProgress",
        "findFirst",
        bai ? { lessonId: "l1", lesson: { title: "Bài 1", kind: bai.kind } } : null,
      ),
    },
  } as unknown as ScopedDb;
  return { db, goi };
}

describe("[DV-01] napTongQuanHocTap — số truy vấn cố định, không N+1", () => {
  it("1 khoá và 100 khoá cùng số lời gọi DB", async () => {
    const a = dbGia(1, { kind: "READ" });
    const b = dbGia(100, { kind: "READ" });
    await napTongQuanHocTap(a.db, "u1", NOW);
    await napTongQuanHocTap(b.db, "u1", NOW);
    expect(b.goi.length).toBe(a.goi.length);
    // Chặn trên cứng: 2 (khoá) + 1 (chứng nhận; tên khoá chỉ khi có chứng nhận) + 1 (bài đang học).
    expect(a.goi.length).toBeLessThanOrEqual(5);
  });

  it("khoá rỗng: không truy vấn 'bài đang học', mọi thứ về 0, không ném", async () => {
    const { db, goi } = dbGia(0, null);
    const r = await napTongQuanHocTap(db, "u1", NOW);
    expect(r.tiepTuc).toBeNull();
    expect(r.kpi.tong).toBe(0);
    expect(r.viecCanLam).toEqual([]);
    expect(goi.some((g) => g.bang === "trnLessonProgress")).toBe(false);
  });
});

describe("[DV-02] 'Tiếp tục học' — vào thẳng bài chỉ khi bài có màn cho người học", () => {
  it("bài đọc → link thẳng vào bài", async () => {
    const { db } = dbGia(3, { kind: "READ" });
    const r = await napTongQuanHocTap(db, "u1", NOW);
    expect(r.tiepTuc?.khoa.enrollmentId).toBe("e0");
    expect(r.tiepTuc?.href).toBe("/elearning/hoc/e0/l1");
    expect(r.tiepTuc?.bai).toMatchObject({ title: "Bài 1", moDuoc: true });
  });

  it("buổi trực tiếp (không có màn người học) → về đề cương", async () => {
    const { db } = dbGia(3, { kind: "LIVE_SESSION" });
    const r = await napTongQuanHocTap(db, "u1", NOW);
    expect(r.tiepTuc?.href).toBe("/elearning/hoc/e0");
  });

  it("chưa chạm bài nào → về đề cương, bai = null", async () => {
    const { db } = dbGia(3, null);
    const r = await napTongQuanHocTap(db, "u1", NOW);
    expect(r.tiepTuc?.href).toBe("/elearning/hoc/e0");
    expect(r.tiepTuc?.bai).toBeNull();
  });
});
