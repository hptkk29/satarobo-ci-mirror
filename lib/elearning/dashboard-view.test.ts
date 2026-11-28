import { describe, it, expect } from "vitest";
import type { ScopedDb } from "@/lib/actions/factory";
import { napTongQuanHocTap } from "./dashboard-view";

// Đồng hồ đóng băng (luật 19).
const NOW = new Date("2026-10-25T03:00:00.000Z");
const ngay = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

type Goi = { bang: string; ham: string };

/** DB giả CHỈ đếm lời gọi — thứ cần chứng minh là số truy vấn KHÔNG tăng theo số khoá. */
function dbGia(soKhoa: number, bai: { kind: string } | null, soBaiMoiKhoa = 4, tuyChon: { khongBatBuoc?: string[] } = {}) {
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
        // Bài người này chạm gần nhất = bài thứ 3 của khoá (c0-b2); các bài c0-b0, c0-b1 đã DONE (findMany bên dưới).
        bai ? { lessonId: "c0-b2" } : null,
      ),
      // "n/m bài": bài DONE của người này — 2 bài xong ở lượt e0.
      findMany: dem("trnLessonProgress", "findMany", [
        { enrollmentId: "e0", lessonId: "c0-b0" },
        { enrollmentId: "e0", lessonId: "c0-b1" },
      ]),
    },
    // Phiên bản xuất bản: chỉ khai bài KHÔNG bắt buộc (mặc định mọi bài đều bắt buộc).
    // B-11b — bản đang phát hành mỗi khoá (một truy vấn), rồi DÒNG của các bản đó (chỉ khi có bản). Bản chưa chụp (vân tay rỗng) ⇒ đọc cây sống, cờ bắt buộc lấy từ dòng.
    trnCourseVersion: {
      findMany: dem("trnCourseVersion", "findMany", tuyChon.khongBatBuoc ? [{ id: "v0", courseId: "c0" }] : []),
    },
    trnCourseVersionLesson: {
      findMany: dem(
        "trnCourseVersionLesson",
        "findMany",
        (tuyChon.khongBatBuoc ?? []).map((id) => ({ versionId: "v0", required: false, contentHash: "", lesson: { id, title: id, kind: "READ", module: { orderIndex: 0 } } })),
      ),
    },
    // "n/m bài": mỗi khoá có đúng 4 bài.
    trnLesson: {
      findMany: dem(
        "trnLesson",
        "findMany",
        dong.flatMap((d) =>
          Array.from({ length: soBaiMoiKhoa }, (_, j) => ({
            id: `${d.courseId}-b${j}`,
            title: `Bài ${j}`,
            // Bài thứ 3 (j = 2) mang loại của kịch bản; số đo THẬT như cột TrnLesson.
            kind: j === 2 ? (bai?.kind ?? "READ") : "READ",
            orderIndex: j,
            durationSec: j === 2 && bai?.kind === "VIDEO" ? 720 : null,
            minReadSeconds: 60,
            youtubeId: j === 2 && bai?.kind === "VIDEO" ? "abcdefghijk" : null,
            module: { courseId: d.courseId, orderIndex: 0 },
          })),
        ),
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
    // Chặn trên cứng: 2 (khoá) + 1 (chứng nhận; tên khoá chỉ khi có chứng nhận) + 1 (bài đang học) + 3 (n/m bài bắt buộc, gộp) = 7;
    // trần 8 chừa MỘT lượt dự phòng. Trước 18/11/2026 trần là 5 — nâng có chủ đích cho khối "n/m bài"; phép so 1-vs-100 ở trên mới là
    // lưới chống N+1 thật.
    expect(a.goi.length).toBeLessThanOrEqual(8);
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

describe("[DV-03] 'n/m bài' và khối chứng nhận", () => {
  it("n/m theo từng lượt từ HAI truy vấn gộp; thời lượng bài đang học lấy từ số đo thật", async () => {
    const { db } = dbGia(3, { kind: "VIDEO" });
    const r = await napTongQuanHocTap(db, "u1", NOW);
    expect(r.tienDoBai).toEqual({ e0: { xong: 2, tong: 4 }, e1: { xong: 0, tong: 4 }, e2: { xong: 0, tong: 4 } });
    expect(r.tiepTuc?.bai?.moTaThoiLuong).toBe("Video · 12 phút");
  });
  it("bài KHÔNG bắt buộc không tính vào n lẫn m (cùng định nghĩa với đề cương)", async () => {
    // lượt e0 xong b0, b1; b1 không bắt buộc ⇒ n = 1, m = 3
    const r = await napTongQuanHocTap(dbGia(1, { kind: "READ" }, 4, { khongBatBuoc: ["c0-b1"] }).db, "u1", NOW);
    expect(r.tienDoBai).toEqual({ e0: { xong: 1, tong: 3 } });
  });
  it("bài đọc: nói đúng nghĩa 'đọc tối thiểu'; buổi trực tiếp không có số đo ⇒ null (không bịa)", async () => {
    expect((await napTongQuanHocTap(dbGia(1, { kind: "READ" }).db, "u1", NOW)).tiepTuc?.bai?.moTaThoiLuong).toBe("Bài đọc · đọc tối thiểu 1 phút");
    // Buổi trực tiếp không còn được chọn làm "bài tiếp theo" (xem DV-02); số đo không-bịa của nó do `moTaThoiLuongBai` canh (de-cuong-pure.test).
  });
  it("khoá CHƯA có bài nào ⇒ không có mục n/m (không bịa '0/0')", async () => {
    const r = await napTongQuanHocTap(dbGia(2, { kind: "READ" }, 0).db, "u1", NOW);
    expect(r.tienDoBai).toEqual({});
  });
  it("không khoá ⇒ không có tiến độ bài và không chứng nhận", async () => {
    const r = await napTongQuanHocTap(dbGia(0, null).db, "u1", NOW);
    expect(r.tienDoBai).toEqual({});
    expect(r.chungNhanGanDay).toEqual([]);
  });
});

describe("[DV-02] 'Tiếp tục học' — vào thẳng bài chỉ khi bài có màn cho người học", () => {
  it("bài đọc → link thẳng vào bài", async () => {
    const { db } = dbGia(3, { kind: "READ" });
    const r = await napTongQuanHocTap(db, "u1", NOW);
    expect(r.tiepTuc?.khoa.enrollmentId).toBe("e0");
    expect(r.tiepTuc?.href).toBe("/elearning/hoc/e0/c0-b2");
    expect(r.tiepTuc?.bai).toMatchObject({ title: "Bài 2", moDuoc: true, viTri: 3 });
  });

  it("buổi trực tiếp (không có màn người học) → về đề cương", async () => {
    const { db } = dbGia(3, { kind: "LIVE_SESSION" });
    const r = await napTongQuanHocTap(db, "u1", NOW);
    // Bài 3 là buổi trực tiếp (chỉ giảng viên điểm danh) ⇒ "Học tiếp" nhảy sang bài tự làm được kế tiếp (c0-b3), như Đề cương.
    expect(r.tiepTuc?.href).toBe("/elearning/hoc/e0/c0-b3");
  });

  it("chưa chạm bài nào → bài BẮT BUỘC đầu tiên chưa xong theo thứ tự khoá (bài 3 trên 4: hai bài đầu đã DONE)", async () => {
    const { db } = dbGia(3, null);
    const r = await napTongQuanHocTap(db, "u1", NOW);
    expect(r.tiepTuc?.href).toBe("/elearning/hoc/e0/c0-b2");
    expect(r.tiepTuc?.bai).toMatchObject({ lessonId: "c0-b2", viTri: 3 });
  });

  it("khoá chưa có bài nào → bai = null, về đề cương", async () => {
    const r = await napTongQuanHocTap(dbGia(1, null, 0).db, "u1", NOW);
    expect(r.tiepTuc?.bai).toBeNull();
    expect(r.tiepTuc?.href).toBe("/elearning/hoc/e0");
  });

  it("video YouTube: chỉ ra CỜ nguồn + độ dài thật, KHÔNG lộ mã video; còn lại có bài không phải video ⇒ không bịa 'còn khoảng'", async () => {
    const r = await napTongQuanHocTap(dbGia(1, { kind: "VIDEO" }).db, "u1", NOW);
    expect(r.tiepTuc?.bai).toMatchObject({ nguonYoutube: true, thoiLuongGiay: 720 });
    expect(JSON.stringify(r)).not.toContain("abcdefghijk");
    // Bài 4 (j = 3) là bài đọc ⇒ không đo được tổng thời gian còn lại.
    expect(r.tiepTuc?.conLai).toBeNull();
  });
});
