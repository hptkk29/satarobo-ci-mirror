// hub-sessions-tab.tsx — Tab "Điểm danh" của Class Hub.
//
// Bảng buổi giàu thông tin (port SessionsTab reference TeachUI):
// BUỔI HỌC ("Buổi 1 - HP1 - Bàn Tay Ma Thuật" + Phòng) / NGÀY·GIỜ /
// ĐIỂM DANH (Có mặt X/Y) / TRẠNG THÁI / THAO TÁC.
// 25/08 — gộp cột "Buổi" (chỉ in "Buổi 1") vào cột "Buổi học" (vốn in hằng "Buổi học"
// vì ClassSession.topic gần như luôn null); tên bài nay lấy từ giáo trình.
//
// 21/08 — thứ tự hiển thị KHÔNG còn là "ngày mới nhất trước": buổi đã xong cả ba việc
// (điểm danh + nhận xét đủ HV + có ảnh) lùi xuống DƯỚI, phần còn nợ việc và các buổi
// sắp tới nằm trên, xếp theo số buổi tăng dần (lib/lms/session-order).
// 07/09 (D0) — cột TRẠNG THÁI đọc `ClassSession.status`, KHÔNG suy từ ba việc nữa. Ba
// việc chỉ còn quyết định THỨ TỰ và mức sẵn-sàng-chốt. Xem `nhanTrangThaiBuoi`.
// Có mặt = PRESENT + LATE (khớp FEEDBACK_ATTENDED_STATUSES). "canMark" = buổi đã tới
// ngày (≤ hết hôm nay giờ VN) → buổi tương lai khoá "Chưa tới giờ".
//
// Đọc qua withMakeupException(actorGiangDay(actor)) như lop/page.tsx (GV dạy bù liên cơ sở vẫn thấy
// đúng buổi). Caller đã guard classId ∈ assignedClassIds. THAO TÁC link ?classId&
// sessionId (query-only) → về level (c) AttendancePanel của page.tsx.
import Link from "next/link";
import { CalendarX2, ClipboardCheck, CircleCheck, Clock } from "lucide-react";
import type { AttendanceStatus } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { actorGiangDay, withMakeupException } from "@/lib/db-scope";
import { rosterWhere } from "@/lib/enrollment-scope";
import { sessionAttendanceState } from "@/lib/lms/attendance-pending";
import { summarizeSessionFeedback } from "@/lib/lms/session-feedback-roster";
import {
  attendanceCoversRoster,
  buildSessionMediaCoverage,
  buildSessionNumberMap,
  mediaCoversAttendees,
  SESSION_MEDIA_SELECT,
  isSessionSettled,
  isSessionWorkComplete,
  nhanTrangThaiBuoi,
  sortSessionsForWork,
  thieuDanhSach,
} from "@/lib/lms/session-order";
import { deriveSessionLabel } from "@/lib/lms/session-project-name";
import { EmptyState } from "../../_components/ui/empty-state";
import { BuoiPill } from "../../_components/ui/session-status-pill";
import { ChotBuoiGV } from "./chot-buoi-gv";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

// 21/08 — CÓ `year` (xem ghi chú cùng nội dung ở hub-reviews-tab).
const dayFmt = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh (UTC+7, không DST)

/** Mốc hết ngày hôm nay (giờ VN) dạng UTC — để biết buổi "đã tới ngày". */
function vnTodayEndMs(now = new Date()): number {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const startUtc =
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) -
    VN_OFFSET_MS;
  return startUtc + 24 * 60 * 60 * 1000;
}

const ATTENDED: AttendanceStatus[] = ["PRESENT", "LATE"];

/** studentId của học viên ĐI HỌC (PRESENT/LATE) trong một buổi — em vắng không tính. */
function attendedIdsOf(
  rows: { studentId: string; status: string }[],
): string[] {
  return rows
    .filter((a) => ATTENDED.includes(a.status as AttendanceStatus))
    .map((a) => a.studentId);
}

export async function HubSessionsTab({
  actor,
  classId,
  timeLabel,
}: {
  actor: Actor;
  classId: string;
  timeLabel: string;
}) {
  const xdb = withMakeupException(actorGiangDay(actor));

  const [sessions, cls, allSessions] = await Promise.all([
    xdb.classSession.findMany({
      where: { classId },
      select: {
        id: true,
        date: true,
        topic: true,
        status: true,
        room: { select: { code: true, name: true } },
        // 25/08 — nguồn NHÃN BUỔI "Buổi 1 - HP1 - Bàn Tay Ma Thuật"
        // (lib/lms/session-project-name · deriveSessionLabel).
        plan: { select: { customTitle: true, order: true } },
        lesson: { select: { order: true, title: true, moduleCode: true } },
      },
      // ⚠️ GIỮ `desc` + `take: 60` — cửa sổ "buổi gần đây". Thứ tự HIỂN THỊ do
      // sortSessionsForWork quyết định sau khi query (lib/lms/session-order).
      orderBy: { date: "desc" },
      take: 60,
    }),
    xdb.class.findUnique({
      where: { id: classId },
      select: {
        // `_count` và danh sách bên dưới nay dùng CHUNG rosterWhere. Đây chính là hai
        // truy vấn cách nhau 9 dòng trong CÙNG một file mà lại lọc khác nhau — mẫu số
        // hiển thị "Đi học X/Y" và mẫu số của attendanceCoversRoster đếm hai tập khác
        // nhau, nên một buổi có thể vừa in "12/12" vừa không bao giờ được coi là điểm
        // danh xong. Chủ dự án chốt 03/09: đổi cả con số cho khớp.
        _count: { select: { enrollments: { where: rosterWhere("dang-hoc") } } },
        // Danh sách studentId của sĩ số — dùng cho "điểm danh xong chưa".
        enrollments: {
          where: rosterWhere("dang-hoc"),
          select: { studentId: true },
        },
      },
    }),
    // R1 — số buổi tính trên TOÀN BỘ buổi của lớp, không phải cửa sổ 60 dòng trên.
    xdb.classSession.findMany({
      where: { classId },
      select: { id: true, date: true },
    }),
  ]);
  const rosterCount = cls?._count.enrollments ?? 0;
  const rosterIds = (cls?.enrollments ?? []).map((e) => e.studentId);
  const numberOf = buildSessionNumberMap(allSessions);

  // Điểm danh theo buổi: buổi có ≥1 bản ghi = đã điểm danh; đếm PRESENT+LATE = có mặt.
  // Kèm nhận xét + ảnh để biết buổi nào ĐÃ XONG VIỆC (quyết định thứ tự hiển thị).
  const ids = sessions.map((s) => s.id);
  const [att, fbRows, mediaRows] = ids.length
    ? await Promise.all([
        xdb.attendance.findMany({
          where: { sessionId: { in: ids } },
          select: { sessionId: true, studentId: true, status: true },
        }),
        xdb.studentSessionFeedback.findMany({
          where: { classSessionId: { in: ids } },
          select: { classSessionId: true, studentId: true },
        }),
        // Ảnh: tính cả DRAFT/PENDING, chỉ loại REJECTED (xem hub-reviews-tab).
        xdb.classSessionMedia.findMany({
          where: { classSessionId: { in: ids }, status: { not: "REJECTED" } },
          select: SESSION_MEDIA_SELECT,
        }),
      ])
    : [[], [], []];
  const presentBy = new Map<string, number>();
  const attBySession = new Map<
    string,
    { studentId: string; status: string }[]
  >();
  const markedBySession = new Map<string, Set<string>>();
  for (const a of att) {
    const marked = markedBySession.get(a.sessionId) ?? new Set<string>();
    marked.add(a.studentId);
    markedBySession.set(a.sessionId, marked);
    const list = attBySession.get(a.sessionId) ?? [];
    list.push({ studentId: a.studentId, status: a.status });
    attBySession.set(a.sessionId, list);
  }
  const rosterIdSet = new Set(rosterIds);
  // Tử số "Đi học X/Y" chỉ đếm em trong sĩ số — học viên HỌC BÙ từ lớp khác cũng sinh
  // bản ghi nên trước đây X vượt được quá Y.
  for (const [sessionId, rowsOfSession] of attBySession) {
    presentBy.set(
      sessionId,
      rowsOfSession.filter(
        (r) =>
          ATTENDED.includes(r.status as AttendanceStatus) &&
          rosterIdSet.has(r.studentId),
      ).length,
    );
  }
  // "Xong" = điểm danh PHỦ ĐỦ sĩ số. Trước đây chỉ cần một bản ghi bất kỳ — buổi có
  // đúng một phiếu xin nghỉ đã duyệt liền hiện pill xanh kèm "Đi học 0/12".
  const doneSet = new Set(
    sessions
      .filter(
        (s) =>
          sessionAttendanceState({
            markedStudentIds: markedBySession.get(s.id) ?? new Set<string>(),
            rosterStudentIds: rosterIds,
          }) === "DU",
      )
      .map((s) => s.id),
  );
  const fbBySession = new Map<string, string[]>();
  for (const f of fbRows) {
    const list = fbBySession.get(f.classSessionId) ?? [];
    list.push(f.studentId);
    fbBySession.set(f.classSessionId, list);
  }
  // Ai đã có ảnh, theo TỪNG buổi (lib/lms/session-order).
  const mediaBy = buildSessionMediaCoverage(mediaRows);
  const todayEnd = vnTodayEndMs();

  if (sessions.length === 0) {
    return <EmptyState icon={CalendarX2} title="Lớp chưa có buổi học nào." />;
  }

  // R1/R2 — số buổi + "đã xong cả 3 việc"; buổi còn nợ việc và buổi sắp tới lên trên.
  // Sort ở server, TRƯỚC <PhanTrangBang> (component phân trang trên mảng đã nhận).
  const rows = sortSessionsForWork(
    sessions.map((s) => {
      const stat = summarizeSessionFeedback(
        attBySession.get(s.id) ?? [],
        fbBySession.get(s.id) ?? [],
      );
      const markedIds = (attBySession.get(s.id) ?? []).map((a) => a.studentId);
      // Ba việc của giáo viên (chốt 21/08): điểm danh đủ sĩ số · nhận xét đủ học viên đi
      // học · ảnh/video đủ học viên đi học. Đủ cả ba = buổi HOÀN TẤT.
      const work = {
        attendanceDone: attendanceCoversRoster(markedIds, rosterIds),
        feedbackDone: stat.complete,
        photoDone: mediaCoversAttendees({
          attendedStudentIds: attendedIdsOf(attBySession.get(s.id) ?? []),
          taggedStudentIds: mediaBy.get(s.id)?.tagged ?? [],
          hasClassWide: mediaBy.get(s.id)?.classWide ?? false,
        }),
      };
      return {
        s,
        no: numberOf.get(s.id) ?? null,
        // Đủ ba việc = SẴN SÀNG CHỐT, không phải "đã chốt" (D0). Khác `complete` bên
        // dưới, vốn còn gộp buổi đã huỷ và lớp không còn ai học (không có việc để làm).
        workDone: isSessionWorkComplete(work),
        // D1 — danh sách việc còn thiếu, để tooltip nút "Chốt buổi" nói đúng thứ tiếng
        // với câu server trả về (cùng nguồn `thieuDanhSach`).
        thieu: thieuDanhSach(work),
        complete: isSessionSettled({
          cancelled: s.status === "CANCELLED",
          rosterEmpty: rosterIds.length === 0,
          work,
        }),
      };
    }),
    // 08/09 — SẮP THEO NGÀY, không theo số buổi. Nhãn nay là số LỘ TRÌNH
    // (`soBuoiTheoLoTrinh`), sắp theo nó thì buổi 25/06 mang nhãn "Buổi 43" rơi
    // xuống sau buổi 12/09 "Buổi 19". Xem `lib/lms/session-order.ts`.
    (r) => ({ thoiGian: new Date(r.s.date).getTime(), complete: r.complete }),
  );

  return (
    <div className="t-card overflow-hidden">
      <PhanTrangBang cuonNgang khoaGhiNho="gv-lop-buoi-hoc">
        <table className="min-w-[720px] w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <th scope="col" className="px-5 py-3">
                Buổi học
              </th>
              <th scope="col" className="px-5 py-3">
                Ngày · Giờ
              </th>
              <th scope="col" className="px-5 py-3">
                Điểm danh
              </th>
              <th scope="col" className="px-5 py-3">
                Trạng thái
              </th>
              <th scope="col" className="px-5 py-3 text-right">
                <span className="sr-only">Thao tác</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, no, workDone, thieu }) => {
              const canMark =
                s.date.getTime() <= todayEnd && s.status !== "CANCELLED";
              const done = doneSet.has(s.id);
              const present = presentBy.get(s.id) ?? 0;
              const roomLabel = s.room?.code ?? s.room?.name ?? null;
              return (
                <tr
                  key={s.id}
                  className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                >
                  <td className="px-5 py-3.5">
                    <p className="font-semibold text-foreground">
                      {deriveSessionLabel({
                        sessionNumber: no,
                        planTitle: s.plan?.customTitle,
                        planOrder: s.plan?.order,
                        lessonTitle: s.lesson?.title,
                        lessonOrder: s.lesson?.order,
                        moduleCode: s.lesson?.moduleCode,
                        topic: s.topic,
                      }) || "Buổi học"}
                    </p>
                    {roomLabel && (
                      <p className="text-xs text-muted-foreground">
                        Phòng {roomLabel}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <p className="text-foreground">{dayFmt.format(s.date)}</p>
                    {timeLabel && (
                      <p className="text-xs text-muted-foreground">
                        {timeLabel}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    {done ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-state-success-soft px-2.5 py-1 text-xs font-semibold text-state-success-ink">
                        <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                        {/* "Đi học": tử số gồm cả Đi muộn — xem BUG-017. */}
                        Đi học {present}/{rosterCount}
                      </span>
                    ) : !canMark ? (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                        Chưa diễn ra
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-state-warning-soft px-2.5 py-1 text-xs font-semibold text-state-warning-ink">
                        Chưa điểm danh
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    {/* D0 — nhãn ĐỌC TỪ `s.status`, không suy từ ba việc. Xem
                        `nhanTrangThaiBuoi` để biết vì sao (2 COMPLETED / 287 SCHEDULED). */}
                    <BuoiPill
                      nhan={nhanTrangThaiBuoi({
                        status: s.status,
                        daQuaNgay: s.date.getTime() <= todayEnd,
                        workDone,
                      })}
                    />
                  </td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    {!canMark ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" aria-hidden /> Chưa tới
                        giờ
                      </span>
                    ) : (
                      <div className="inline-flex items-center justify-end gap-2">
                        {/* D1 — nút chốt buổi ngay tại đây. Trước 07/09 nút này CHỈ có ở
                            màn admin, mà giáo viên thuần bị đá khỏi host admin ⇒ không ai
                            bấm được (prod: 2 COMPLETED / 287 SCHEDULED). Buổi đã chốt thì
                            component tự ẩn. */}
                        {s.status !== "COMPLETED" &&
                          s.status !== "CANCELLED" && (
                            <ChotBuoiGV
                              sessionId={s.id}
                              sanSang={workDone}
                              thieu={thieu}
                            />
                          )}
                        <Link
                          href={`?classId=${classId}&sessionId=${s.id}`}
                          className={
                            done
                              ? "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                              : "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white outline-none transition-colors hover:bg-primary-darker focus-visible:ring-2 focus-visible:ring-ring"
                          }
                        >
                          <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
                          {done ? "Xem buổi" : "Điểm danh"}
                        </Link>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </PhanTrangBang>
    </div>
  );
}
