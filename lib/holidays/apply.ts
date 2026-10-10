import "server-only";
import { db } from "@/lib/db";
import { ymdVN } from "@/lib/classes/schedule";
import { enqueueEmail } from "@/lib/email/queue";
import { vnAddDays, vnStartOfDay, vnYmd } from "@/lib/time/vn";
import { luiLichLop } from "@/lib/classes/lui-lich";

// =============================================================================
// P1-f — khi THÊM/SỬA ngày nghỉ (Holiday): lớp có buổi rơi đúng ngày nghỉ thì DỜI CẢ
// DÃY buổi chưa diễn ra LÙI MỘT NHỊP (27/09/2026 — xem `./cuon-chieu.ts`), giữ nguyên
// thứ tự buổi/bài; buổi đã có dữ liệu giữ ngày. Một email cho GV mỗi lớp (best-effort).
// =============================================================================

function expandRange(start: Date, end: Date | null): Set<string> {
  const set = new Set<string>();
  // Ngày nghỉ khớp theo LỊCH VN (server Vercel chạy UTC — xem `@/lib/time/vn`).
  // QA 21/07 (B3 — root cause chính): `last = cur` (CÙNG object) khi end=null →
  // vòng while tăng cur đồng thời tăng last → LẶP VÔ HẠN với mọi ngày nghỉ 1
  // ngày (crash "Set maximum size exceeded", bị try/catch nuốt → không dời buổi
  // nào bao giờ). Nay `vnAddDays` trả object MỚI nên không còn bí danh. Giữ
  // guard 400 ngày như expandHolidaySet.
  let cur = vnStartOfDay(start);
  const last = end ? vnStartOfDay(end) : cur;
  let guard = 0;
  while (cur <= last && guard < 400) {
    guard++;
    set.add(ymdVN(cur));
    cur = vnAddDays(cur, 1);
  }
  return set;
}

export { suyThuHopLe } from "./thu-hop-le";

export async function applyHolidayShift(holiday: {
  date: Date;
  endDate: Date | null;
  centerId: string | null;
}, actor: { id: string; name: string }): Promise<{ shifted: number; affectedClasses: number }> {
  const range = expandRange(holiday.date, holiday.endDate);
  const now = new Date();
  const todayStart = vnStartOfDay(now);

  // QA 21/07 (B3) — holiday.date lưu 00:00 UTC nên `lte: holiday.date` tạo cửa sổ
  // RỖNG: buổi 09:00 VN (=02:00Z) đã bị loại ngay từ query → không buổi nào được
  // dời. Nới cửa sổ ±1 ngày đệm múi giờ; khớp CHÍNH XÁC theo ngày-local do filter
  // `range.has(ymdVN(...))` bên dưới quyết định.
  const windowStart = new Date(holiday.date);
  windowStart.setDate(windowStart.getDate() - 1);
  const windowEnd = new Date(holiday.endDate ?? holiday.date);
  windowEnd.setDate(windowEnd.getDate() + 2);

  // Buổi tương lai rơi đúng ngày nghỉ (chỉ lớp đang hoạt động + đúng cơ sở nếu có).
  const sessions = await db.classSession.findMany({
    where: {
      status: "SCHEDULED",
      date: { gte: windowStart, lt: windowEnd },
      class: {
        deletedAt: null,
        ...(holiday.centerId ? { centerId: holiday.centerId } : {}),
      },
    },
    select: {
      id: true,
      date: true,
      classId: true,
      class: {
        select: {
          id: true,
          name: true,
          scheduleDays: true,
          centerId: true,
          teacher: { select: { name: true, email: true } },
          // 07/08 — lớp có kế hoạch nhiều giai đoạn: thứ VÀ giờ đổi theo giai đoạn, nên
          // không được dùng scheduleDays (bản sao của giai đoạn đang hiệu lực) để tìm
          // ngày dời — sẽ chọn nhầm thứ mà giai đoạn hiện tại không hề có lớp.
          schedulePhases: {
            orderBy: { effectiveFrom: "asc" },
            select: {
              effectiveFrom: true,
              effectiveTo: true,
              slots: { select: { weekday: true, startTime: true, endTime: true } },
            },
          },
        },
      },
    },
  });
  const affected = sessions.filter((s) => range.has(ymdVN(s.date)) && s.date >= todayStart);
  if (affected.length === 0) return { shifted: 0, affectedClasses: 0 };

  // Tập ngày nghỉ TOÀN BỘ (để khi dời không rơi vào ngày nghỉ khác). Lấy cả
  // holiday toàn hệ thống (centerId null) + cùng cơ sở của lớp được xử lý ở dưới.
  // ── 27/09/2026 — DỜI CẢ DÃY LÙI MỘT NHỊP, theo từng lớp ─────────────────────────────────
  // ~~Bản cũ dời RIÊNG buổi trùng ngày nghỉ sang "ngày trống đầu tiên"~~ — dãy buổi đã xếp
  // kín tới cuối khoá nên bài của buổi bị nghỉ (`ClassSession.lessonId`) rơi xuống cuối khoá.
  // Luật dùng chung với "Nghỉ & lùi lịch" của từng lớp: `lib/classes/lui-lich.ts`.
  const lopIds = [...new Set(affected.map((s) => s.classId))];
  let shifted = 0;
  let affectedClasses = 0;
  for (const classId of lopIds) {
    const lop = affected.find((s) => s.classId === classId)!.class;
    const kq = await luiLichLop({
      classId,
      ngayNghi: range,
      actor,
      lyDo: `Ngày nghỉ ${[...range].join(", ")}`,
    });
    if (kq.moves.length === 0) continue;
    shifted += kq.moves.length;
    affectedClasses++;

    // Một email cho GV mỗi lớp (best-effort), không phải mỗi buổi một email.
    const email = lop.teacher?.email;
    if (email) {
      const dauTien = kq.moves.reduce((a, m) => (m.oldDate < a.oldDate ? m : a), kq.moves[0]!);
      await enqueueEmail({
        to: email,
        toName: lop.teacher?.name ?? undefined,
        templateKey: "HOLIDAY_SHIFT",
        vars: {
          teacherName: lop.teacher?.name ?? "thầy/cô",
          className: lop.name,
          oldDate: vnYmd(dauTien.oldDate),
          newDate: vnYmd(dauTien.newDate),
        },
        subject: `Dời lịch do nghỉ — lớp ${lop.name}`,
        bodyText:
          `Lớp ${lop.name} nghỉ ngày ${[...range].join(", ")}. Các buổi từ ngày đó lùi một nhịp ` +
          `(${kq.moves.length} buổi); buổi cuối khoá nay là ${kq.cuoiMoi ? vnYmd(kq.cuoiMoi) : "—"}.`,
        context: { type: "HOLIDAY_SHIFT", id: classId },
      }).catch(() => {});
    }
  }

  return { shifted, affectedClasses };
}
