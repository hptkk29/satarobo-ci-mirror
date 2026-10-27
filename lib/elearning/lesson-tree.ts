import type { ScopedDb } from "@/lib/actions/factory";
import { coManChoNguoiHoc, NHAN_LOAI_BAI } from "@/lib/elearning/lesson-kind";

/**
 * CÂY CHƯƠNG/BÀI cho khung học (cột trái của trình học) — CHỈ ĐỌC, KHÔNG quyết điều kiện hoàn thành.
 *
 * ⚠️ Trạng thái từng bài lấy NGUYÊN từ `TrnLessonProgress.status` (server ghi qua heartbeat/nộp bài/điểm danh). Khung học chỉ
 * VẼ nó; "bài xong khi nào" vẫn do video-heartbeat / reading-heartbeat / chấm bài / điểm danh quyết như cũ.
 *
 * Hai truy vấn chạy song song, KHÔNG phụ thuộc số bài (không N+1).
 */
export type BaiTrongCay = {
  lessonId: string;
  title: string;
  kind: string;
  nhanLoai: string;
  /** `true` = loại bài này có màn dành cho người học (xem `lesson-kind.ts`). */
  moDuoc: boolean;
  trangThai: "CHUA_HOC" | "DANG_HOC" | "XONG";
};

export type ChuongTrongCay = { moduleId: string; title: string; bai: BaiTrongCay[] };

export type CayBaiHoc = {
  chuong: ChuongTrongCay[];
  /** Danh sách phẳng theo thứ tự chương → bài. */
  phang: BaiTrongCay[];
  soBai: number;
  soXong: number;
};

export async function napCayBaiHoc(
  db: ScopedDb,
  input: { enrollmentId: string; courseId: string },
): Promise<CayBaiHoc> {
  const [modules, tienDo] = await Promise.all([
    db.trnModule.findMany({
      where: { courseId: input.courseId },
      orderBy: { orderIndex: "asc" },
      select: {
        id: true,
        title: true,
        lessons: {
          where: { deletedAt: null },
          orderBy: { orderIndex: "asc" },
          select: { id: true, title: true, kind: true },
        },
      },
    }),
    db.trnLessonProgress.findMany({
      where: { enrollmentId: input.enrollmentId },
      select: { lessonId: true, status: true },
    }),
  ]);
  return dungCay(modules, tienDo);
}

/** Phần THUẦN của `napCayBaiHoc` — tách ra để test không cần DB. */
export function dungCay(
  modules: readonly {
    id: string;
    title: string;
    lessons: readonly { id: string; title: string; kind: string }[];
  }[],
  tienDo: readonly { lessonId: string; status: string }[],
): CayBaiHoc {
  const tt = new Map(tienDo.map((t) => [t.lessonId, t.status]));
  const chuong: ChuongTrongCay[] = modules.map((m) => ({
    moduleId: m.id,
    title: m.title,
    bai: m.lessons.map((b) => {
      const s = tt.get(b.id);
      return {
        lessonId: b.id,
        title: b.title,
        kind: b.kind,
        nhanLoai: NHAN_LOAI_BAI[b.kind] ?? b.kind,
        moDuoc: coManChoNguoiHoc(b.kind),
        trangThai: s === "DONE" ? "XONG" : s ? "DANG_HOC" : "CHUA_HOC",
      };
    }),
  }));
  const phang = chuong.flatMap((c) => c.bai);
  return { chuong, phang, soBai: phang.length, soXong: phang.filter((b) => b.trangThai === "XONG").length };
}

/**
 * Bài trước / bài sau của `lessonId` — CHỈ tính các bài có màn cho người học (bỏ buổi trực tiếp: bấm "Bài sau"
 * mà rơi vào màn "không có gì để xem" là lời hứa suông). `viTri` = thứ tự 1-based trong các bài mở được; 0 nếu bài hiện
 * tại không nằm trong danh sách.
 */
export function langGieng(
  phang: readonly BaiTrongCay[],
  lessonId: string,
): { truoc: BaiTrongCay | null; sau: BaiTrongCay | null; viTri: number; tong: number } {
  const mo = phang.filter((b) => b.moDuoc || b.lessonId === lessonId);
  const i = mo.findIndex((b) => b.lessonId === lessonId);
  if (i < 0) return { truoc: null, sau: null, viTri: 0, tong: mo.length };
  // `mo` đã loại bài không có màn người học (trừ chính bài đang xem), nên láng giềng là phần tử kề trong `mo`.
  return { truoc: mo[i - 1] ?? null, sau: mo[i + 1] ?? null, viTri: i + 1, tong: mo.length };
}

/**
 * Bài nên mở khi bấm "Tiếp tục học" ở đề cương: bài ĐANG DỞ đầu tiên; không có thì bài CHƯA HỌC đầu tiên; chỉ xét bài có màn cho
 * người học. Hết bài ⇒ `null` (khoá đã học xong hoặc chỉ còn buổi trực tiếp). Dùng cho cả `BaiTrongDeCuong` lẫn `BaiTrongCay`.
 */
export function chonBaiTiepTheo<
  T extends { lessonId: string; moDuoc: boolean; trangThai: "CHUA_HOC" | "DANG_HOC" | "XONG" },
>(phang: readonly T[]): T | null {
  const mo = phang.filter((b) => b.moDuoc && b.trangThai !== "XONG");
  return mo.find((b) => b.trangThai === "DANG_HOC") ?? mo[0] ?? null;
}
