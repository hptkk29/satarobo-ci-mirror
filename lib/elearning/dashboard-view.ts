import type { ScopedDb } from "@/lib/actions/factory";
import { napKhoaCuaToi } from "@/lib/elearning/course-view";
import { coManChoNguoiHoc } from "@/lib/elearning/lesson-kind";
import { demConHieuLuc, napChungNhanCuaToi } from "@/lib/elearning/certificate-mine";
import {
  chonTiepTuc,
  nhomViecCanLam,
  tinhKpi,
  type Kpi,
  type KhoaRut,
  type NhomViec,
} from "@/lib/elearning/dashboard-pure";

/**
 * TỔNG QUAN HỌC TẬP của một người — dữ liệu cho trang chủ khu.
 *
 * ⚠️ SỐ TRUY VẤN CỐ ĐỊNH, KHÔNG THEO SỐ KHOÁ: `napKhoaCuaToi` (2) + chứng nhận (2) + tối đa 1 truy vấn "bài đang
 * học" của DUY NHẤT khoá được chọn để tiếp tục. Thêm một truy vấn theo từng khoá ở đây là biến trang chủ thành N+1
 * (kiểm: `tests/elearning/dashboard-view.test.ts` đếm lời gọi với 1 khoá và 100 khoá).
 *
 * ⚠️ Mọi số liệu suy từ dữ liệu thật; không có KPI cố định hay "mẫu" nào.
 */
export type BaiDangHoc = { lessonId: string; title: string; kind: string; moDuoc: boolean };

export type TongQuanHocTap = {
  khoa: KhoaRut[];
  kpi: Kpi;
  chungNhanConHieuLuc: number;
  tiepTuc: { khoa: KhoaRut; bai: BaiDangHoc | null; href: string } | null;
  viecCanLam: NhomViec[];
};

export async function napTongQuanHocTap(
  db: ScopedDb,
  userId: string,
  now: Date,
): Promise<TongQuanHocTap> {
  const [khoa, chungNhan] = await Promise.all([
    napKhoaCuaToi(db, userId),
    napChungNhanCuaToi(db, userId, now),
  ]);

  const chon = chonTiepTuc(khoa);
  let tiepTuc: TongQuanHocTap["tiepTuc"] = null;
  if (chon) {
    // Bài người này chạm gần nhất mà CHƯA xong. Một dòng, đúng khoá được chọn.
    const dong = await db.trnLessonProgress.findFirst({
      where: { enrollmentId: chon.enrollmentId, userId, status: { not: "DONE" } },
      orderBy: { lastActivityAt: "desc" },
      select: { lessonId: true, lesson: { select: { title: true, kind: true } } },
    });
    const bai: BaiDangHoc | null = dong
      ? {
          lessonId: dong.lessonId,
          title: dong.lesson.title,
          kind: dong.lesson.kind,
          moDuoc: coManChoNguoiHoc(dong.lesson.kind),
        }
      : null;
    // Vào thẳng bài khi bài có màn dành cho người học; còn lại về đề cương (nơi giải thích vì sao chưa mở được).
    const href =
      bai && bai.moDuoc
        ? `/elearning/hoc/${chon.enrollmentId}/${bai.lessonId}`
        : `/elearning/hoc/${chon.enrollmentId}`;
    tiepTuc = { khoa: chon, bai, href };
  }

  return {
    khoa,
    kpi: tinhKpi(khoa, now),
    chungNhanConHieuLuc: demConHieuLuc(chungNhan),
    tiepTuc,
    viecCanLam: nhomViecCanLam(khoa, now),
  };
}
