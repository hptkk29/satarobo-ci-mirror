import type { ScopedDb } from "@/lib/actions/factory";
import { napChungNhanCuaToi } from "@/lib/elearning/certificate-mine";
import { baiTheoLuot } from "@/lib/elearning/ban-cua-luot";
import { napKhoaCuaToi } from "@/lib/elearning/course-view";
import { dongHan, trangThaiHienThi } from "@/lib/elearning/dashboard-pure";
import { coManChoNguoiHoc, NHAN_LOAI_BAI } from "@/lib/elearning/lesson-kind";
import type { KetQuaTim } from "@/lib/elearning/tim-kiem-pure";

/**
 * NGUỒN TÌM KIẾM của một người: khoá được giao, bài trong các khoá đó, chứng nhận của chính họ.
 *
 * ⚠️ Cùng tầm nhìn với ĐỀ CƯƠNG KHOÁ: bài nào hiện ở đề cương của lượt học thì mới tìm ra (lượt đã thu hồi bị loại từ
 * `napKhoaCuaToi`; bài đã xoá mềm bị loại ở truy vấn). Chỉ lấy TIÊU ĐỀ + loại bài + trạng thái — không nội dung bài, không câu hỏi.
 *
 * SỐ TRUY VẤN CỐ ĐỊNH (6) bất kể số khoá/bài: khoá (2) + bài (1) + tiến độ bài (1) + chứng nhận (2). Khoá theo `userId` tường minh
 * ở từng truy vấn người dùng — `scopedDb` chặn chéo cơ sở nhưng KHÔNG chặn đồng nghiệp cùng cơ sở đọc của nhau.
 */
export async function napNguonTimKiem(db: ScopedDb, userId: string, now: Date): Promise<KetQuaTim[]> {
  const [khoa, chungNhan] = await Promise.all([napKhoaCuaToi(db, userId), napChungNhanCuaToi(db, userId, now)]);
  const ketQua: KetQuaTim[] = [];

  for (const k of khoa) {
    const tt = trangThaiHienThi(k, now).nhan;
    const han = dongHan(k, now);
    ketQua.push({
      loai: "khoa",
      id: `khoa-${k.enrollmentId}`,
      tieuDe: k.tenKhoa,
      nguCanh: [tt, `${k.progressPercent}%`, han?.chu].filter(Boolean).join(" · "),
      href: `/elearning/hoc/${k.enrollmentId}`,
    });
  }

  if (khoa.length > 0) {
    const maLuot = khoa.map((k) => k.enrollmentId);
    // B-11b — bài của MỖI lượt theo phiên bản nó đã ghim: bài của bản nháp / bản tách chưa phát hành không bao giờ tìm ra được.
    const [theoLuot, tienDo] = await Promise.all([
      baiTheoLuot(db, khoa),
      db.trnLessonProgress.findMany({
        where: { userId, enrollmentId: { in: maLuot } },
        select: { enrollmentId: true, lessonId: true, status: true },
      }),
    ]);
    const tienDoCua = new Map(tienDo.map((t) => [`${t.enrollmentId}|${t.lessonId}`, t.status]));
    // Một khoá có thể có nhiều lượt (học lại): mỗi lượt đang hiện trong "Khoá của tôi" cho ra bài của nó.
    for (const k of khoa) {
      for (const b of theoLuot.get(k.enrollmentId) ?? []) {
        const st = tienDoCua.get(`${k.enrollmentId}|${b.id}`);
        const trangThai = st === "DONE" ? "đã xong" : st ? "đang học" : "chưa học";
        const mo = coManChoNguoiHoc(b.kind);
        ketQua.push({
          loai: "bai",
          id: `bai-${k.enrollmentId}-${b.id}`,
          tieuDe: b.title,
          nguCanh: `${k.tenKhoa} · ${NHAN_LOAI_BAI[b.kind] ?? b.kind} · ${trangThai}`,
          // Bài có màn cho người học thì vào thẳng; còn lại về đề cương (nơi giải thích vì sao chưa mở) — như "Tiếp tục học".
          href: mo ? `/elearning/hoc/${k.enrollmentId}/${b.id}` : `/elearning/hoc/${k.enrollmentId}`,
        });
      }
    }
  }

  for (const c of chungNhan) {
    ketQua.push({
      loai: "chung-nhan",
      id: `cn-${c.id}`,
      tieuDe: c.tenKhoa,
      nguCanh: `Số hiệu ${c.certCode}`,
      href: `/elearning/chung-nhan-cua-toi/${encodeURIComponent(c.certCode)}`,
    });
  }
  return ketQua;
}
