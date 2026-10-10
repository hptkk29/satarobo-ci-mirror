// lib/portal/buoi-hoc.ts — MỘT nguồn duy nhất trả lời "buổi học nào, buổi thứ mấy"
// cho toàn bộ cổng phụ huynh + học viên.
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao có file này (06/09/2026 — chủ dự án: "lấy đúng data từng buổi học để trả về
// cho đúng buổi học hiện tại cho phụ huynh và học viên xem")
//
// Trước file này, portal có SÁU cách đếm buổi khác nhau, và chỉ một cách khớp thứ mà
// giáo viên/quản lý đang nhìn:
//
//   lib/portal/feedback.ts            → buildSessionNumberMap  ✔ đúng (vá 21/08)
//   lib/portal/schedule.ts            → Lesson.order           ✘
//   lib/portal/photos.ts              → Lesson.order           ✘
//   lib/portal/student-sessions.ts    → Lesson.order + khử trùng theo lesson
//                                       + bỏ buổi chưa gắn giáo án               ✘✘✘
//   lib/portal/student-assignments.ts → Lesson.order + hai lỗi trên              ✘✘✘
//   lib/portal/student-home.ts        → mượn hai cái trên                        ✘
//
// Ba khiếm khuyết ĐỘC LẬP, mỗi cái tự nó đủ làm phụ huynh đọc sai:
//
// 1. `Lesson.order` KHÔNG PHẢI số buổi. lib/lms/session-order.ts nói thẳng điều đó, và
//    luồng huỷ buổi chứng minh: `cancelSession` (lib/classes/adjust.ts) đặt buổi gốc
//    thành CANCELLED rồi TẠO buổi bù mang **cùng lessonId**. Lớp lập tức có hai buổi
//    cùng `Lesson.order = 5`. Giáo viên thấy "Buổi 5 (huỷ)" và "Buổi 6 (bù)"; portal in
//    "Buổi 5" cho cả hai.
//
// 2. Khử trùng theo `lesson.id` giữ bản ghi ĐẦU theo ngày — tức đúng cái buổi ĐÃ HUỶ —
//    và VỨT buổi bù đi. Phụ huynh mất hẳn một buổi học có thật khỏi danh sách.
//
// 3. `where: { lessonId: { not: null } }` xoá sạch buổi chưa gắn giáo án. Sinh ra nhiều
//    hơn tưởng: `generateClassSessions` gán `lessonIds[i] ?? null` nên mọi buổi vượt quá
//    số bài của giáo trình đều null, và màn "Thêm buổi" của admin
//    (app/(admin)/admin/sessions/_actions.ts) cho phép bỏ trống ô Giáo án. Lớp chưa ghim
//    giáo trình thì trang "Buổi học" của học viên TRỐNG TRƠN dù lớp đang chạy.
//
// ⚠️ Dữ liệu seed UAT ở máy dev KHÔNG lộ được nhóm lỗi này: đo 06/09 trên
// `satarobo_test` — 609/609 buổi có lessonId, 0 buổi CANCELLED, 0 lớp có lesson trùng,
// và `Lesson.order` khớp hạng-theo-ngày ở cả 609 buổi. Muốn thấy lỗi phải có dữ liệu
// bẩn như prod.
//
// ─────────────────────────────────────────────────────────────────────────────
// LUẬT CỦA FILE NÀY
//
// · Số buổi = `buildSessionNumberMap` — hạng theo NGÀY trong TỪNG lớp, tính trên TOÀN BỘ
//   buổi kể cả buổi đã huỷ. Caller PHẢI nạp đủ buổi của lớp (`napBuoiCuaLop` lo việc đó).
// · Không buổi nào bị loại khỏi danh sách vì thiếu giáo án. Thiếu tên bài thì nhãn rút
//   gọn dần (`deriveSessionLabel`), không biến mất.
// · "Đã diễn ra" = `date <= now` và buổi không huỷ — ĐÚNG định nghĩa mà
//   `lib/attendance/summary.ts` dùng cho `daDienRa`, để con số trên thẻ ở trang chủ và
//   con số trong danh sách buổi không bao giờ chọi nhau.
// · Ngày/thứ/"hôm nay" tính theo lịch VN (`lib/time/vn.ts`), không theo TZ máy chạy —
//   Vercel chạy UTC.
//
// Phần TÍNH TOÁN là hàm thuần (test bảng biên được, không cần DB); chỉ `napBuoiCuaLop`
// chạm Prisma.
// ─────────────────────────────────────────────────────────────────────────────
import "server-only";

import { db } from "@/lib/db";
import {
  buildSessionNumberMap,
  soBuoiTheoLoTrinh,
  nhanSoBuoi as nhanSoBuoiTheoNguon,
} from "@/lib/lms/session-order";
import { deriveSessionLabel, deriveSessionTitle } from "@/lib/lms/session-project-name";
import { vnParts, vnYmd } from "@/lib/time/vn";

/** `0=CN … 6=T7` → nhãn ngắn tiếng Việt. */
const THU = ["CN", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"] as const;

const hai = (n: number) => String(n).padStart(2, "0");

/** Hàng buổi học thô — đúng những cột `napBuoiCuaLop` select. */
export type BuoiRow = {
  id: string;
  classId: string;
  date: Date;
  status: string;
  topic?: string | null;
  lesson?: {
    order?: number | null;
    title?: string | null;
    moduleCode?: string | null;
  } | null;
  plan?: { customTitle?: string | null; order?: number | null } | null;
};

export type BuoiHoc = {
  id: string;
  classId: string;
  /**
   * Buổi thứ mấy của lớp tính theo NGÀY. Dùng để SẮP XẾP và để trả lời "buổi thứ mấy
   * đã học" — KHÔNG dùng in nhãn: buổi bị dời ngày có số này khác số bài.
   */
  soBuoi: number;
  /**
   * Bài thứ mấy của LỘ TRÌNH (`plan.order + 1` → `Lesson.order`), `null` khi lớp
   * không có nguồn nào. ⚠️ Đây mới là con số ĐI CÙNG `nhanDayDu` — nơi nào in số buổi
   * cạnh tên bài thì phải lấy trường này, không phải `soBuoi`. Xem
   * `docs/dieu-tra-lech-bai-hoc.md`.
   */
  soBuoiLoTrinh: number | null;
  /** `Buổi 5`, hoặc `Buổi 5 (theo lịch)` khi chỉ tra được số theo ngày, hoặc `—`. */
  nhanSoBuoi: string;
  /** `Buổi 5 - HP2 - Họa Sĩ Robot` — rút gọn dần khi thiếu mảnh. */
  nhanDayDu: string;
  /** Tên bài TRẦN (`Họa Sĩ Robot`) — chuỗi rỗng khi lớp chưa ghim giáo trình. */
  tieuDe: string;
  ngayISO: string;
  /**
   * Ngày/thứ ĐÃ ĐỊNH DẠNG theo lịch VN, tính ở SERVER.
   *
   * Vì sao không để component tự format: `components/portal/schedule-page.tsx` và
   * `student/home-page.tsx` là Server Component, mà Vercel chạy UTC — `getDate()` /
   * `getDay()` / `toDateString()` trong đó trả lời theo giờ UTC. Phụ huynh mở portal
   * lúc 06:00 sáng giờ VN (23:00Z hôm trước) thì buổi học CHIỀU NAY không được gắn
   * nhãn "Hôm nay", đúng lúc người ta cần nó nhất.
   */
  nhanNgay: string;
  /** `dd/MM` — cho ô hẹp. */
  nhanNgayNgan: string;
  /** `Thứ 7` / `CN`. */
  nhanThu: string;
  /** `19:00` giờ VN — giờ BẮT ĐẦU ghi trên chính buổi. */
  nhanGio: string;
  daHuy: boolean;
  /** Buổi đã diễn ra tính tới `now` (buổi huỷ luôn false). */
  daDienRa: boolean;
  /** Ngày của buổi trùng ngày hôm nay theo LỊCH VN. */
  homNay: boolean;
};

/**
 * Dựng danh sách buổi đã đánh số + đặt nhãn, xếp theo ngày tăng dần.
 *
 * ⚠️ `rows` phải là TOÀN BỘ buổi của các lớp liên quan. Truyền một cửa sổ đã lọc
 * (theo ngày, theo `lessonId != null`, theo `take`) là ra số buổi SAI — đúng cái lỗi
 * file này sinh ra để đóng.
 */
export function dungDanhSachBuoi(rows: BuoiRow[], now: Date): BuoiHoc[] {
  const soBuoiCua = buildSessionNumberMap(
    rows.map((r) => ({ id: r.id, classId: r.classId, date: r.date })),
  );
  const homNayYmd = vnYmd(now);
  const mocNay = now.getTime();

  return rows
    .map((r) => {
      const soBuoi = soBuoiCua.get(r.id) ?? 0;
      const soLoTrinh = soBuoiTheoLoTrinh({
        planOrder: r.plan?.order ?? null,
        lessonOrder: r.lesson?.order ?? null,
      });
      const nguon = {
        sessionNumber: soBuoi > 0 ? soBuoi : null,
        planTitle: r.plan?.customTitle ?? null,
        planOrder: r.plan?.order ?? null,
        lessonTitle: r.lesson?.title ?? null,
        lessonOrder: r.lesson?.order ?? null,
        topic: r.topic ?? null,
        moduleCode: r.lesson?.moduleCode ?? null,
      };
      const daHuy = r.status === "CANCELLED";
      const p = vnParts(r.date);
      return {
        id: r.id,
        classId: r.classId,
        soBuoi,
        soBuoiLoTrinh: soLoTrinh,
        nhanSoBuoi: nhanSoBuoiTheoNguon({
          loTrinh: soLoTrinh,
          lich: soBuoi > 0 ? soBuoi : null,
        }),
        nhanDayDu: deriveSessionLabel(nguon),
        tieuDe: deriveSessionTitle(nguon),
        ngayISO: r.date.toISOString(),
        nhanNgay: `${hai(p.day)}/${hai(p.month + 1)}/${p.year}`,
        nhanNgayNgan: `${hai(p.day)}/${hai(p.month + 1)}`,
        nhanThu: THU[p.weekday] ?? "",
        nhanGio: `${hai(p.hour)}:${hai(p.minute)}`,
        daHuy,
        daDienRa: !daHuy && r.date.getTime() <= mocNay,
        homNay: vnYmd(r.date) === homNayYmd,
      };
    })
    .sort(
      (a, b) => Date.parse(a.ngayISO) - Date.parse(b.ngayISO) || a.id.localeCompare(b.id),
    );
}

export type BuoiMocThoiGian = {
  /** Buổi của HÔM NAY (chưa huỷ) — buổi mà phụ huynh đang quan tâm nhất. */
  homNay: BuoiHoc | null;
  /** Buổi chưa huỷ gần nhất ĐÃ diễn ra — nơi có nhận xét/ảnh mới nhất. */
  ganNhat: BuoiHoc | null;
  /** Buổi chưa huỷ đầu tiên CHƯA diễn ra. */
  tiepTheo: BuoiHoc | null;
  /**
   * "Buổi học hiện tại" để làm tiêu điểm màn hình.
   * Hôm nay có buổi → buổi đó. Không thì buổi vừa học xong. Lớp chưa khai giảng thì
   * buổi sắp tới. Cả ba trống ⇒ null (lớp chưa có buổi nào).
   */
  hienTai: BuoiHoc | null;
};

/**
 * Chọn các mốc thời gian từ danh sách đã dựng.
 *
 * Buổi HUỶ không bao giờ được chọn: nó vẫn giữ chỗ trong cách ĐÁNH SỐ (để "Buổi 7" hôm
 * nay vẫn là "Buổi 7" tuần sau) nhưng không phải buổi học có thật để trỏ phụ huynh tới.
 */
export function chonMocBuoi(list: BuoiHoc[]): BuoiMocThoiGian {
  const song = list.filter((b) => !b.daHuy);
  // Buổi hôm nay: ưu tiên buổi CHƯA tới giờ (lớp chiều mà xem lúc sáng); không có thì
  // buổi đã bắt đầu (đang học / vừa tan) — vẫn là "buổi hôm nay" trong mắt phụ huynh.
  const cuaHomNay = song.filter((b) => b.homNay);
  const homNay =
    cuaHomNay.find((b) => !b.daDienRa) ?? cuaHomNay[cuaHomNay.length - 1] ?? null;
  const daQua = song.filter((b) => b.daDienRa);
  const ganNhat = daQua[daQua.length - 1] ?? null;
  const tiepTheo = song.find((b) => !b.daDienRa) ?? null;
  return { homNay, ganNhat, tiepTheo, hienTai: homNay ?? ganNhat ?? tiepTheo };
}

/** Đếm buổi cho các con số tiến độ — cùng quy ước với lib/attendance/summary.ts. */
export function demBuoi(list: BuoiHoc[]): {
  tong: number;
  daDienRa: number;
  conLai: number;
} {
  // Buổi HUỶ không nằm trong mẫu số: không tính học, không tính vắng
  // (computeAttendanceSummary bỏ qua chúng) — mẫu số ở đây phải khớp.
  const song = list.filter((b) => !b.daHuy);
  const daDienRa = song.filter((b) => b.daDienRa).length;
  return { tong: song.length, daDienRa, conLai: song.length - daDienRa };
}

// ── Tầng chạm DB ─────────────────────────────────────────────────────────────

/**
 * TOÀN BỘ buổi của các lớp truyền vào — không lọc theo ngày, không lọc theo giáo án,
 * không `take`. Đó là điều kiện để `buildSessionNumberMap` ra số đúng.
 *
 * Buổi CANCELLED cũng được nạp: chúng giữ chỗ trong cách đánh số. Nơi gọi lọc bỏ khi
 * hiển thị (`chonMocBuoi` và `demBuoi` đã tự lọc).
 */
export async function napBuoiCuaLop(classIds: string[], now: Date): Promise<BuoiHoc[]> {
  if (classIds.length === 0) return [];
  const rows = await db.classSession.findMany({
    where: { classId: { in: classIds } },
    orderBy: { date: "asc" },
    select: {
      id: true,
      classId: true,
      date: true,
      status: true,
      topic: true,
      plan: { select: { customTitle: true, order: true } },
      lesson: { select: { order: true, title: true, moduleCode: true } },
    },
  });
  return dungDanhSachBuoi(rows, now);
}
