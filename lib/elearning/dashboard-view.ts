import type { ScopedDb } from "@/lib/actions/factory";
import { baiTheoLuot, type BaiCuaLuot } from "@/lib/elearning/ban-cua-luot";
import { napKhoaCuaToi } from "@/lib/elearning/course-view";
import { coManChoNguoiHoc, nguoiHocTuLamDuoc } from "@/lib/elearning/lesson-kind";
import { demConHieuLuc, napChungNhanCuaToi, type ChungNhanCuaToi } from "@/lib/elearning/certificate-mine";
import { moTaThoiLuongBai } from "@/lib/elearning/de-cuong-pure";
import { napBaiXongTheoLuot, tienDoCuaLuot } from "@/lib/elearning/tien-do-bat-buoc";
import {
  chonBaiTiepTheoTongQuan,
  chonTiepTuc,
  chuConLai,
  nhomViecCanLam,
  tinhKpi,
  uocConLaiGiay,
  type Kpi,
  type KhoaRut,
  type NhomViec,
} from "@/lib/elearning/dashboard-pure";

/**
 * TỔNG QUAN HỌC TẬP của một người — dữ liệu cho trang chủ khu.
 *
 * ⚠️ SỐ TRUY VẤN CỐ ĐỊNH, KHÔNG THEO SỐ KHOÁ: `napKhoaCuaToi` (2) + chứng nhận (2) + tối đa 1 truy vấn "bài đang
 * học" của DUY NHẤT khoá được chọn để tiếp tục + 3 truy vấn GỘP "n/m bài bắt buộc" (bài theo khoá · phiên bản xuất bản · bài đã xong theo lượt;
 * chỉ khi có khoá). Thêm một truy vấn theo từng khoá ở đây là biến trang chủ thành N+1
 * (kiểm: `lib/elearning/dashboard-view.test.ts` đếm lời gọi với 1 khoá và 100 khoá; trần 8 đặt có chủ đích 18/11/2026).
 *
 * ⚠️ Mọi số liệu suy từ dữ liệu thật; không có KPI cố định hay "mẫu" nào.
 */
export type BaiDangHoc = {
  lessonId: string;
  title: string;
  kind: string;
  moDuoc: boolean;
  /** "Video · 12 phút" — `null` khi không có số đo thật. */
  moTaThoiLuong: string | null;
  /** Độ dài video thật (giây) — `null` khi không phải video hoặc chưa đo. */
  thoiLuongGiay: number | null;
  /** Video YouTube không công khai (chỉ là CỜ; mã video không ra khỏi máy chủ). */
  nguonYoutube: boolean;
  /** Thứ tự 1-based trong các bài bắt buộc; `null` nếu bài không bắt buộc. */
  viTri: number | null;
};

/** n/m bài BẮT BUỘC của MỘT lượt (cùng định nghĩa với đề cương — `tinhTienDoBatBuoc`). */
export type TienDoBai = { xong: number; tong: number };

export type TongQuanHocTap = {
  khoa: KhoaRut[];
  kpi: Kpi;
  chungNhanConHieuLuc: number;
  tiepTuc: {
    khoa: KhoaRut;
    bai: BaiDangHoc | null;
    href: string;
    /** "còn khoảng 1 giờ 10 phút" — CHỈ khi mọi bài bắt buộc còn lại đều là video có độ dài thật. */
    conLai: string | null;
  } | null;
  viecCanLam: NhomViec[];
  /** Theo `enrollmentId`. Khoá chưa có bài nào ⇒ không có khoá trong map (không bịa "0/0"). */
  tienDoBai: Record<string, TienDoBai>;
  /** Tối đa 3 chứng nhận mới nhất (kèm trạng thái) cho khối "Chứng nhận" — danh sách đầy đủ ở màn riêng. */
  chungNhanGanDay: ChungNhanCuaToi[];
};

const SO_CHUNG_NHAN_TREN_TONG_QUAN = 3;

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
  // Tiến độ n/m + bài của MỌI lượt đi trước (ba truy vấn gộp) để chọn đúng "bài tiếp theo" theo thứ tự phiên bản đã ghim.
  const { tienDoBai, theoLuot, xongCuaLuot } = await napTienDoBai(db, userId, khoa);

  let tiepTuc: TongQuanHocTap["tiepTuc"] = null;
  if (chon) {
    // Bài người này chạm gần nhất mà CHƯA xong. Một dòng, đúng khoá được chọn.
    const dong = await db.trnLessonProgress.findFirst({
      where: { enrollmentId: chon.enrollmentId, userId, status: { not: "DONE" } },
      orderBy: { lastActivityAt: "desc" },
      select: { lessonId: true },
    });
    const ds: readonly BaiCuaLuot[] = theoLuot.get(chon.enrollmentId) ?? [];
    const daXongBai = xongCuaLuot.get(chon.enrollmentId) ?? new Set<string>();
    const chonBai = chonBaiTiepTheoTongQuan(ds, daXongBai, dong?.lessonId ?? null);
    const bai: BaiDangHoc | null = chonBai
      ? {
          lessonId: chonBai.bai.id,
          title: chonBai.bai.title,
          kind: chonBai.bai.kind,
          moDuoc: coManChoNguoiHoc(chonBai.bai.kind),
          // Số câu bài kiểm tra cần truy vấn riêng ⇒ không nạp ở tổng quan (null ⇒ chỉ nói loại bài, không bịa số).
          moTaThoiLuong: moTaThoiLuongBai(chonBai.bai.kind, {
            durationSec: chonBai.bai.thoiLuongGiay ?? null,
            minReadSeconds: chonBai.bai.minReadSeconds ?? null,
            soCau: null,
          }),
          thoiLuongGiay: chonBai.bai.kind === "VIDEO" ? (chonBai.bai.thoiLuongGiay ?? null) : null,
          nguonYoutube: chonBai.bai.nguonYoutube === true,
          viTri: chonBai.viTri,
        }
      : null;
    // Vào thẳng bài khi bài có màn dành cho người học; còn lại về đề cương (nơi giải thích vì sao chưa mở được).
    const href =
      bai && bai.moDuoc && nguoiHocTuLamDuoc(bai.kind)
        ? `/elearning/hoc/${chon.enrollmentId}/${bai.lessonId}`
        : `/elearning/hoc/${chon.enrollmentId}`;
    const giay = uocConLaiGiay(ds, daXongBai);
    tiepTuc = { khoa: chon, bai, href, conLai: giay === null ? null : chuConLai(giay) };
  }

  return {
    tienDoBai,
    chungNhanGanDay: chungNhan.slice(0, SO_CHUNG_NHAN_TREN_TONG_QUAN),
    khoa,
    kpi: tinhKpi(khoa, now),
    chungNhanConHieuLuc: demConHieuLuc(chungNhan),
    tiepTuc,
    viecCanLam: nhomViecCanLam(khoa, now),
  };
}

/**
 * "n/m bài BẮT BUỘC" cho MỌI khoá trong danh sách bằng BA truy vấn gộp (không theo từng khoá): bài (chưa xoá) của các khoá ·
 * phiên bản xuất bản (cờ bắt buộc) · bài `DONE` của người này trong các lượt. CÙNG định nghĩa với `napDeCuongKhoa`
 * (`tinhTienDoBatBuoc`) — hai màn không được in hai mẫu số cho một khoá. Khoá không có bài bắt buộc nào thì KHÔNG có mặt.
 */
async function napTienDoBai(
  db: ScopedDb,
  userId: string,
  khoa: readonly { enrollmentId: string; courseId: string; courseVersionId: string | null }[],
): Promise<{
  tienDoBai: Record<string, TienDoBai>;
  theoLuot: Map<string, BaiCuaLuot[]>;
  xongCuaLuot: Map<string, Set<string>>;
}> {
  if (khoa.length === 0) return { tienDoBai: {}, theoLuot: new Map(), xongCuaLuot: new Map() };
  // B-11b — tập bài + cờ bắt buộc theo PHIÊN BẢN mà từng lượt đã ghim (cùng quy tắc với đề cương và bước cuộn tiến độ khoá).
  const [theoLuot, xongCuaLuot] = await Promise.all([
    baiTheoLuot(db, khoa, { soDo: true }),
    napBaiXongTheoLuot(db, userId, khoa.map((k) => k.enrollmentId)),
  ]);
  const ra: Record<string, TienDoBai> = {};
  for (const k of khoa) {
    const ds = theoLuot.get(k.enrollmentId) ?? [];
    const r = tienDoCuaLuot(ds, xongCuaLuot.get(k.enrollmentId) ?? new Set());
    if (r.tong > 0) ra[k.enrollmentId] = r;
  }
  return { tienDoBai: ra, theoLuot, xongCuaLuot };
}
