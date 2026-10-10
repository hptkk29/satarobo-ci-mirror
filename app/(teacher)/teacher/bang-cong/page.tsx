// app/(teacher)/teacher/bang-cong/page.tsx — #06 (L6): "Bảng công" site GV.
//
// ⚠️ ĐÍNH CHÍNH CHÚ THÍCH CŨ. Bản trước viết: *"Bố cục theo reference TeachUI: 4 StatCard
// (Số ca · Buổi dạy · Tổng giờ công · Ngày nghỉ)"*. BỐN THẺ ĐÓ KHÔNG CÒN — chúng bị thay ở
// bộ chốt 15/09/2026 và chú thích không được sửa theo, nên nó đã mô tả một màn không tồn
// tại. Chú thích không phải bằng chứng; ai đọc nó mà không mở trang sẽ đi tìm nhầm chỗ.
//
// BỐ CỤC THẬT (chốt 10/09, dựng 15/09) — hai tầng, đọc từ trên xuống:
//   1. BỐN SỐ luôn hiện: Công tháng (thực/chuẩn) · Ngày đã đi làm · Đi muộn & Về sớm ·
//      Ngày nghỉ phép. Đây là thứ người ta mở trang để xem, không phải bới ra.
//   2. KHỐI GẤP LẠI (`<details>` thuần, không JS): nghỉ tách loại · giờ làm/kế hoạch ·
//      ngày có vấn đề · đơn của tôi · công dạy (chỉ GV). Tự MỞ SẴN khi có việc phải làm —
//      gấp một vấn đề vào trong là giấu nó.
//   3. Bảng CHI TIẾT CA gộp 3 loại: Dạy (ClassSession) · Trải nghiệm (TrialClassSession) ·
//      Ca làm (ShiftRegistration). Tiêu đề bảng PHẢI khai nó gộp ba loại — xem chỗ đó.
//
// Chọn tháng qua ?thang=YYYY-MM; lọc ngày cần xử lý qua ?loc=co.
//
// 🔴 LUẬT 12b — mọi con số ở đây đọc từ ĐÚNG hàm admin đọc (`getMyAttendanceDays` →
// `gopNgayCong` → `tomTatCongThang`; công dạy qua `loadBuoiDay` + `congDayCuaNguoi`).
// Đây là lần thứ TƯ site GV được thêm cột số; ba lần trước đều tự dựng lại và đều sai.
//
// L5 chấm công v3 (06/09/2026): ca làm đọc từ lưới ShiftAssignment (Quản lý xếp), công
// ngày từ StaffAttendanceDay (engine tính theo ca — T-01), đơn từ là WorkRequest nộp ở
// /teacher/don-tu. Giờ dạy/trải nghiệm vẫn là ước tính từ khung giờ (không phải công).
//
// 🔴 Vá 10/09/2026 — LẦN THỨ BA site GV dựng lại con số của admin. Hai bug cùng gốc:
//   · ngày nghỉ X/P hiện "Ca làm · theo nơi làm" (lọc bằng `isLeave`, mà X mang isLeave=false);
//   · Trạng thái in "Đã làm" cho MỌI dòng quá khứ vì `done = dateKey < todayKey`.
// `getMyAttendanceDays` VỐN đã được gọi ở màn này — nhưng chỉ để cộng một con tổng, còn từng
// dòng thì tự suy từ ngày. Nay mọi ô số/nhãn đi qua `lib/cham-cong/nhan-ca.ts` (dùng chung với
// admin) và đọc thẳng `StaffAttendanceDay` — KHÔNG có phép tính thứ hai ở đây.
//
// Nguồn (own-rows): getMyAssignments/getMyAttendanceDays (lib/cham-cong/my-schedule) ·
// getTeacherTrialSessions (lib/lms/teacher-schedule); buổi dạy qua
// withMakeupException (dạy thay/bù liên cơ sở). ⚠️ Câu 46: chỉ tên lớp/cơ sở + giờ — không HV/PH.
import Link from "next/link";
import {
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
} from "lucide-react";
import type { SessionStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, withMakeupException } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import {
  getTeacherTrialSessions,
} from "@/lib/lms/teacher-schedule";
import {
  getMyAssignments,
  getMyAttendanceDays,
  getMyPeriod,
} from "@/lib/cham-cong/my-schedule";
import {
  NHAN_TRANG_THAI,
  type TrangThaiNgay,
} from "@/lib/cham-cong/nhan-ca";
import {
  CO_CAN_XU_LY,
  dungDongBangCong,
  tomTatCongThang,
  type LoaiOCa,
} from "@/lib/cham-cong/bang-cong-gv";
import { congDayCuaNguoi } from "@/lib/cham-cong/cong-day";
import { moTaMoc } from "@/lib/cham-cong/sua-gio-quet";
import { loadBuoiDay, loadLoaiCongDay } from "@/lib/cham-cong/cong-day-db";
import { FlagList } from "@/components/cham-cong/ui/flag-chip";
import { scopedDb } from "@/lib/db-scope";
import {
  WR_KIND_LABEL,
  WR_STATUS_LABEL,
  type WorkRequestKindV,
  type WorkRequestStatusV,
} from "@/lib/work-request";
import { cn } from "@/lib/utils";
import { dieuKienBuoiTinhCong } from "@/lib/lms/session-ownership";
import { PageHeader } from "../_components/ui/page-header";
import { EmptyState } from "../_components/ui/empty-state";
import { caseCuaGiaoVien } from "@/lib/hoc-bu/case-doc";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import {
  fmtMin,
  TongHopCongThang,
} from "@/components/cham-cong/ui/tong-hop-cong-thang";

export const metadata = { title: "Bảng công | Giáo viên Sata Robo" };

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function vnTodayUtc(now = new Date()): Date {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  return new Date(
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()),
  );
}
function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonthsUtc(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
function toVnInstant(dayUtc: Date): Date {
  return new Date(dayUtc.getTime() - VN_OFFSET_MS);
}
const two = (n: number) => String(n).padStart(2, "0");
function monthKey(monthStart: Date): string {
  return `${monthStart.getUTCFullYear()}-${two(monthStart.getUTCMonth() + 1)}`;
}
function parseThang(raw?: string): Date | null {
  if (!raw || !/^\d{4}-\d{2}$/.test(raw)) return null;
  const [y, m] = raw.split("-").map(Number);
  if (y < 2000 || y > 2100 || m < 1 || m > 12) return null;
  return new Date(Date.UTC(y, m - 1, 1));
}

function parseHHmm(s: string | null): number | null {
  if (!s || !/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}
/** Giờ (số) giữa 2 mốc "HH:mm" — thiếu/không hợp lệ → 0. */
function hoursBetween(start: string | null, end: string | null): number {
  const a = parseHHmm(start);
  const b = parseHHmm(end);
  if (a === null || b === null || b <= a) return 0;
  return (b - a) / 60;
}
const fmtHours = (h: number) =>
  h.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
/** "sáng" (<12) · "chiều" (12–17) · "tối" (≥17) từ giờ bắt đầu — đặt tên "Ca dạy …". */
function shiftOfDay(start: string | null): string {
  const m = parseHHmm(start);
  if (m === null) return "";
  if (m < 12 * 60) return "sáng";
  if (m < 17 * 60) return "chiều";
  return "tối";
}

/** "YYYY-MM-DD" theo giờ VN cho cột Timestamptz. */
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
});
function isoKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "2026-08-03" → "03/08/2026". Đảo chuỗi thuần, không đụng múi giờ. */
function viDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}
/* Ngày HIỂN THỊ trong bảng công — dd/mm/yyyy. (`isoKey`/`dayKeyFmt` ở trên vẫn
   giữ ISO vì chúng là KHOÁ tra bản đồ, không phải chữ cho người đọc.)
   timeZone UTC là cố ý: cột `date` kiểu @db.Date, đổi múi giờ sẽ lệch một ngày. */
const dateFmt = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

const REQ_STATUS_CLS: Record<WorkRequestStatusV, string> = {
  PENDING: "bg-state-warning-soft text-state-warning-ink",
  APPROVED: "bg-state-success-soft text-state-success-ink",
  REJECTED: "bg-state-danger-soft text-state-danger-ink",
  WITHDRAWN: "bg-muted text-muted-foreground",
  CANCEL_REQUESTED: "bg-state-warning-soft text-state-warning-ink",
  CANCELLED: "bg-muted text-muted-foreground",
};

const TYPE_TONE: Record<LoaiOCa, string> = {
  Dạy: "bg-state-info-soft text-state-info-ink",
  "Trải nghiệm": "bg-primary-soft text-primary-ink",
  "Học bù": "bg-state-warning-soft text-state-warning-ink",
  "Ca làm": "bg-muted text-muted-foreground",
  Nghỉ: "bg-muted text-muted-foreground",
  "Nghỉ phép": "bg-state-warning-soft text-state-warning-ink",
};

/** Tông của chip Trạng thái. Chỉ "Đã làm" được nhuộm xanh — nhãn khẳng định thì phải có chứng. */
const TRANG_THAI_TONE: Record<TrangThaiNgay, string> = {
  DA_LAM: "bg-state-success-soft text-state-success-ink",
  SAP_TOI: "bg-state-info-soft text-state-info-ink",
  NGHI: "bg-muted text-muted-foreground",
  CHUA_CHAM: "bg-state-warning-soft text-state-warning-ink",
  CHUA_TINH: "bg-muted text-muted-foreground",
  CHUA_CHOT: "bg-state-warning-soft text-state-warning-ink",
};

export default async function TeacherTimesheetPage({
  searchParams,
}: {
  searchParams: Promise<{ thang?: string; loc?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate

  const sp = await searchParams;
  const todayUtc = vnTodayUtc();
  const todayKey = isoKey(todayUtc);
  const thisMonth = startOfMonthUtc(todayUtc);
  const monthStart = parseThang(sp.thang) ?? thisMonth;
  // Bộ lọc "ngày cần xử lý" sống trong URL, không trong state — trang này là RSC, và một
  // đường dẫn chia sẻ được thì người ta gửi cho quản lý được.
  const locCo = sp.loc === "co";
  const hrefThang = (loc: string | null) => {
    const q = new URLSearchParams();
    if (sp.thang) q.set("thang", sp.thang);
    if (loc) q.set("loc", loc);
    const t = q.toString();
    return t ? `?${t}` : "?";
  };
  const nextMonth = addMonthsUtc(monthStart, 1);

  const actor = await resolveActor(session.user.id);
  const xdb = withMakeupException(actorGiangDay(actor));
  const classIds = [...actor.assignedClassIds];

  // L5 chấm công v3: ca làm đọc từ lưới ShiftAssignment; công ngày từ StaffAttendanceDay;
  // đơn từ (chỉnh công, đổi ca, nghỉ…) là WorkRequest — nộp ở /teacher/don-tu.
  const canRequestAdjust = await checkPermission("hr_attendance:checkin", {
    centerId: session.user.centerId ?? "hoi-so",
  });
  const sdb = scopedDb(actorGiangDay(actor));

  const [sessions, trials, buoiBu, shiftRows, myDays, myRequests] =
    await Promise.all([
      // Buổi lớp trong tháng (mọi trạng thái trừ hủy) — lớp mình / thực dạy.
      xdb.classSession.findMany({
        where: {
          status: { not: "CANCELLED" },
          date: { gte: toVnInstant(monthStart), lt: toVnInstant(nextMonth) },
          // ⚠️ Trước 08/09/2026 thiếu nhánh `substituteTeacherId`: buổi được xếp dạy
          // thay KHÔNG hiện trên bảng công của chính người dạy thay. Luật ở MỘT chỗ:
          // `dieuKienBuoiTinhCong` (`lib/lms/session-ownership.ts`) — và nó cố ý KHÁC
          // `isSessionOwnedByTeacher`: quyền xem ≠ công đứng lớp.
          ...dieuKienBuoiTinhCong(session.user.id, classIds),
        },
        select: {
          id: true,
          date: true,
          status: true,
          class: {
            select: {
              name: true,
              startTime: true,
              endTime: true,
              center: { select: { name: true } },
            },
          },
        },
        orderBy: { date: "asc" },
        take: 500,
      }),
      getTeacherTrialSessions(session.user.id, monthStart, nextMonth),
      caseCuaGiaoVien(session.user.id, monthStart, nextMonth),
      getMyAssignments(session.user.id, monthStart, nextMonth),
      getMyAttendanceDays(session.user.id, monthStart, nextMonth),
      sdb.workRequest.findMany({
        where: {
          requesterId: session.user.id,
          fromDate: { gte: monthStart, lt: nextMonth },
        },
        select: {
          id: true,
          kind: true,
          status: true,
          fromDate: true,
          requestedInAt: true,
          requestedOutAt: true,
          requestedIn2At: true,
          requestedOut2At: true,
          reason: true,
          reviewNote: true,
          applyError: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
  // ── Kỳ công của tháng đang xem ────────────────────────────────────────────────
  // `standardUnits` là MẪU SỐ của thẻ "Công thực tế / công chuẩn", và nó sống ở
  // `AttendancePeriod` theo (cơ sở × kỳ) — không phải theo người.
  //
  // ⚠️ Đi qua `getMyPeriod` (own-rows) chứ KHÔNG qua `scopedDb`: xem chú thích ở hàm đó.
  // Bản đầu tra bằng `sdb` và thẻ in "Chưa lập kỳ" cho một kỳ ĐÃ lập — vì giáo viên thiếu
  // `UserOrgRole` thì `scopedDb` lọc sạch và trả `null`, không phân biệt được "chưa có"
  // với "không được xem".
  //
  // `standardUnits` vẫn CÓ THỂ null thật (kế toán chưa điền) — lúc đó in "—", không in 0.
  const kyCong = await getMyPeriod(session.user.id, monthKey(monthStart));

  // ĐƠN của tôi trong tháng, đếm theo trạng thái. Đây là NGOẠI LỆ duy nhất của ràng buộc
  // "mọi số đọc từ StaffAttendanceDay": đơn là một sự việc riêng, không phải lượt quét —
  // và nó KHÔNG phải `StaffTimeLog`, tức không mở lại đường đã sinh ra bug nơi chịu công.
  const donTheoTrangThai = myRequests.reduce(
    (a, r) => {
      if (r.status === "PENDING") a.choDuyet += 1;
      else if (r.status === "REJECTED") a.tuChoi += 1;
      else if (r.status === "APPROVED" && r.kind === "TIMESHEET_FIX")
        a.daDuyetChinhCong += 1;
      return a;
    },
    { choDuyet: 0, daDuyetChinhCong: 0, tuChoi: 0 },
  );

  const tomTat = tomTatCongThang({
    ngay: myDays.map((d) => d.gop),
    kyKhoa: monthKey(monthStart),
    congChuan: kyCong.standardUnits,
    kyTrangThai: kyCong.status,
    kyChotLuc: kyCong.lockedAt,
    homNay: todayKey,
    dauThang: isoKey(monthStart),
    cuoiThang: isoKey(new Date(nextMonth.getTime() - 86_400_000)),
    don: donTheoTrangThai,
  });

  // CÔNG DẠY — đọc bằng ĐÚNG đường admin dùng (`loadBuoiDay` + `congDayCuaNguoi`), tách theo
  // từng `TeachingCreditType` vì mỗi loại một hệ số. Không tự đếm `rows` ở trang này.
  const [buoiDayThat, danhMucCongDay] = await Promise.all([
    loadBuoiDay([session.user.id], monthStart, nextMonth),
    loadLoaiCongDay(),
  ]);
  const congDay = congDayCuaNguoi(buoiDayThat, danhMucCongDay);

  // BUỔI QUÁ HẠN CHƯA CHỐT — "việc phải làm", nên nó đi kèm ĐƯỜNG ĐI, không chỉ con số.
  //
  // Phạm vi: ĐÚNG tháng đang xem (cùng `sessions` mà bảng dưới dùng), không phải mọi thời
  // gian — hai phạm vi khác nhau trên cùng một màn là cách chắc chắn để người ta cộng nhầm.
  // Nhãn nói rõ "trong tháng này".
  //
  // `IN_PROGRESS` CỐ Ý cũng tính: buổi mở ra rồi bỏ dở vẫn là buổi chưa chốt, và với người
  // dạy thì việc phải làm y hệt. Chỉ `COMPLETED` mới là xong (`CANCELLED` đã bị loại từ truy vấn).
  const buoiQuaHan = sessions.filter(
    (s) =>
      (s.status as SessionStatus) !== "COMPLETED" &&
      dayKeyFmt.format(s.date) < todayKey,
  ).length;


  // ── Chuẩn hoá về CA rows ──────────────────────────────────────────────────────
  // 🔴 Phép nối "ngày công đã tính × ca đã xếp" nằm ở `lib/cham-cong/bang-cong-gv.ts`, KHÔNG
  // ở đây. Trang chỉ chuyển dữ liệu về hình dạng của hàm đó rồi in ra. Đây là chỗ đã ba lần
  // đẻ ra một bản tính thứ hai cho con số admin đã có (luật 12b).
  const rows = dungDongBangCong({
    buoi: [
      ...sessions.map((s) => {
        const hrs = hoursBetween(s.class.startTime, s.class.endTime);
        return {
          key: `d-${s.id}`,
          ngay: dayKeyFmt.format(s.date),
          loai: "Dạy" as const,
          ten: `Ca dạy ${shiftOfDay(s.class.startTime)}`.trim(),
          phu:
            [s.class.name, s.class.center?.name].filter(Boolean).join(" · ") || null,
          gio:
            s.class.startTime && s.class.endTime
              ? `${s.class.startTime}–${s.class.endTime}`
              : "—",
          soGio: hrs > 0 ? hrs : null,
          hoanTat: (s.status as SessionStatus) === "COMPLETED",
        };
      }),
      ...trials.map((t) => {
        const hrs = hoursBetween(t.startTime, t.endTime);
        return {
          key: `t-${t.id}`,
          ngay: isoKey(t.date),
          loai: "Trải nghiệm" as const,
          ten: t.trialClassName,
          phu: null,
          gio: `${t.startTime}–${t.endTime}`,
          soGio: hrs > 0 ? hrs : null,
          hoanTat: t.status === "COMPLETED",
        };
      }),
      // Case dạy bù (docs/hoc-bu/DAC-TA.md) — cùng nguồn `caseCuaGiaoVien` với màn Lịch.
      ...buoiBu.map((b) => {
        const hrs = hoursBetween(b.startTime, b.endTime);
        return {
          key: `b-${b.id}`,
          ngay: isoKey(b.date),
          loai: "Học bù" as const,
          ten: `Học bù · ${b.khoa}`,
          phu: b.buoi,
          gio: `${b.startTime}–${b.endTime}`,
          soGio: hrs > 0 ? hrs : null,
          hoanTat: b.status === "COMPLETED",
        };
      }),
    ],
    ca: shiftRows.map((r) => ({
      ngay: isoKey(r.date),
      ma: r.code,
      ten: r.name,
      kind: r.kind,
      noi: r.centerLabel,
      gio: r.timeLabel,
    })),
    cong: myDays.map((d) => ({
      ngay: isoKey(d.date),
      phutLam: d.worked,
      cong: d.units,
      flags: d.flags,
      ma: d.code,
    })),
    homNay: todayKey,
  });

  // Bộ lọc của thẻ "Ngày cần xử lý". Dùng ĐÚNG tập cờ mà thẻ đếm (`CO_CAN_XU_LY`) —
  // hai danh sách rời nhau là cách chắc chắn để thẻ nói "3" mà bảng lọc ra 5 dòng.
  const dongHienThi = locCo
    ? rows.filter((r) => r.flags.some((f) => CO_CAN_XU_LY.has(f)))
    : rows;

  // Đếm theo LOẠI cho câu khai phạm vi của tiêu đề bảng.
  //
  // ⚠️ Phải đứng SAU `rows` — bản đầu đặt nó lên trước và `tsc` KHÔNG bắt: lời gọi
  // `rows.filter` nằm trong callback của `.map`, nên bộ kiểm tra "dùng trước khi khai báo"
  // không nhìn thấy, còn lúc chạy thì nổ `ReferenceError`. Typecheck xanh không phải bằng
  // chứng thứ tự đúng.
  //
  // Đếm trên `rows` (TOÀN THÁNG) chứ không `dongHienThi`: câu này khai phạm vi của bảng
  // đầy đủ; phần bị lọc đã nói ở "N / M" trong tiêu đề. Bỏ loại 0 dòng — "0 trải nghiệm"
  // không nói thêm gì.
  const demTheoLoai = (["Dạy", "Trải nghiệm", "Học bù", "Ca làm"] as const)
    .map((nhan) => ({ nhan, n: rows.filter((r) => r.loai === nhan).length }))
    .filter((d) => d.n > 0);


  const monthLabel = `Tháng ${monthStart.getUTCMonth() + 1}/${monthStart.getUTCFullYear()}`;

  return (
    <div>
      <PageHeader
        title="Bảng công"
        subtitle="Công, giờ làm và ngày nghỉ của bạn theo từng tháng. Số ở đây đọc cùng nguồn với bảng công của quản lý — giờ dạy là ước tính từ khung giờ lớp, không phải công."
        actions={
          canRequestAdjust ? (
            <Link
              href="/teacher/don-tu?type=TIMESHEET_FIX"
              className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-dark"
            >
              Đơn chỉnh công
            </Link>
          ) : null
        }
      />

      <div className="space-y-6">
        {/* Chọn tháng */}
        <div className="flex flex-wrap items-center gap-2">
          <NavLink
            href={`?thang=${monthKey(addMonthsUtc(monthStart, -1))}`}
            aria="Tháng trước"
          >
            <ChevronLeft className="h-4 w-4" />
          </NavLink>
          <NavLink href={`?thang=${monthKey(nextMonth)}`} aria="Tháng sau">
            <ChevronRight className="h-4 w-4" />
          </NavLink>
          <Link
            href="?"
            scroll={false}
            className="ml-1 inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted/50"
          >
            Tháng này
          </Link>
          <p className="ml-2 text-base font-bold text-foreground">
            {monthLabel}
          </p>
        </div>

        {/* Khối tổng hợp KHÔNG dựng ở đây — nó là `components/cham-cong/ui/
            tong-hop-cong-thang.tsx`, dùng chung với màn "Lịch ca của tôi" bên admin (nơi
            Sale/Kế toán/Quản lý xem công của CHÍNH họ). Một bản, hai màn: dựng bản thứ hai
            là tạo thêm một chỗ để hai màn in hai con số cho cùng một ô — luật 12b. */}
        <TongHopCongThang
          tomTat={tomTat}
          nhanThang={monthLabel}
          nhanChotLuc={tomTat.kyChotLuc ? dayKeyFmt.format(tomTat.kyChotLuc) : undefined}
          hrefLoc={locCo ? hrefThang(null) : hrefThang("co")}
          dangLoc={locCo}
          congDay={congDay.dong}
          buoiQuaHan={buoiQuaHan}
          hrefBuoiQuaHan="/teacher/diem-danh"
          // Màu nhấn do SITE quyết — file dùng chung không được mang `primary-*`
          // (`docs/cham-cong/DESIGN-CHAM-CONG-ADMIN.md`). Ở đây là cam của site GV.
          lopNhanManh="text-primary-ink"
          lopLink="text-primary-ink"
        />

        {/* ══ CHI TIẾT CA ══════════════════════════════════════════════════════
            ⚠️ NHÃN ĐÃ TỪNG SAI — chủ dự án 15/09: *"'Số ca 34' không nói ra nó gộp buổi dạy
            + trải nghiệm."*

            Con số này gộp BA loại dòng: `Dạy` (ClassSession) · `Trải nghiệm`
            (TrialClassSession) · `Ca làm` (ShiftAssignment). Nên nó KHÔNG bằng con số
            "buổi" ở khối Công dạy phía trên, và cũng không bằng "ngày có ca" — ba thước đo
            khác nhau đứng chung một màn.

            Hai số gần giống nhau mà không nhãn thì sẽ có người sửa cho khớp, và sửa nhầm
            cái đang đúng (đúng lý do bảng kỳ công của admin không dám đặt tên cột là "Dạy"
            trần). Nên phần đếm theo loại in NGAY trong tiêu đề, không giấu vào tooltip. */}
        <section className="space-y-3" aria-labelledby="chi-tiet-ca">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2
              id="chi-tiet-ca"
              className="text-sm font-bold tracking-wide text-muted-foreground uppercase"
            >
              Chi tiết ca ({dongHienThi.length}
              {locCo ? ` / ${rows.length}` : ""})
            </h2>
            {/* Khai PHẠM VI ngay cạnh con số: gộp những loại nào, mỗi loại mấy dòng.
                Đếm trên `rows` (TOÀN THÁNG) chứ không trên `dongHienThi` — khi đang lọc,
                câu này nói về cái bảng ĐẦY ĐỦ, và con số bị lọc đã có ở "N / M" bên trên. */}
            <p className="text-xs leading-snug font-normal text-muted-foreground normal-case">
              {/* `{" "}` TƯỜNG MINH: JSX nuốt khoảng trắng ở cuối dòng trước khi xuống dòng,
                  nên bản đầu in ra "26 ca làm— một NGÀY" dính liền. Ảnh chụp bắt, tsc không. */}
              gộp {demTheoLoai.map((d) => `${d.n} ${d.nhan.toLowerCase()}`).join(" · ")}{" "}
              — một NGÀY có thể có nhiều dòng, nên số này khác &ldquo;ngày có ca&rdquo; và
              khác &ldquo;buổi&rdquo; ở khối Công dạy
            </p>
            {/* Đang lọc thì PHẢI nói ra và phải có đường thoát — bảng thiếu dòng mà không
                giải thích là dạng nói dối im lặng tệ nhất ở màn số liệu. */}
            {locCo && (
              <span className="inline-flex items-center gap-2 rounded-full bg-state-warning-soft px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-state-warning-ink">
                Đang lọc: ngày cần xử lý
                <Link
                  href={hrefThang(null)}
                  scroll={false}
                  className="underline underline-offset-2"
                >
                  bỏ lọc
                </Link>
              </span>
            )}
          </div>
          {dongHienThi.length === 0 ? (
            <EmptyState
              icon={CalendarX2}
              title={
                locCo
                  ? "Không ngày nào trong tháng này cần xử lý."
                  : "Không có ca dạy, trải nghiệm hay ca làm nào trong tháng này."
              }
            />
          ) : (
            <div className="t-card overflow-hidden">
              <PhanTrangBang cuonNgang khoaGhiNho="gv-bang-cong">
                <table className="min-w-[1000px] w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      <th scope="col" className="px-4 py-3">
                        Ca
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Loại
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Ngày
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Giờ
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Giờ dạy
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Giờ làm
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Công
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Cờ
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Trạng thái
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dongHienThi.map((r) => (
                      <tr
                        key={r.key}
                        className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                      >
                        <td className="px-4 py-3">
                          <p className="font-semibold text-foreground">
                            {r.ten}
                          </p>
                          {r.phu && (
                            <p className="text-xs text-muted-foreground">
                              {r.phu}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                              TYPE_TONE[r.loai],
                            )}
                          >
                            {r.loai}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                          {viDate(r.ngay)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-foreground">
                          {r.gio}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-semibold text-foreground">
                          {r.soGio != null ? (
                            `${fmtHours(r.soGio)}h`
                          ) : (
                            <span className="font-normal text-muted-foreground">
                              —
                            </span>
                          )}
                        </td>
                        {/* Giờ làm + Công: đọc thẳng StaffAttendanceDay — CÙNG số admin hiện. */}
                        <td className="px-4 py-3 whitespace-nowrap tabular-nums text-foreground">
                          {r.phutLam != null ? (
                            fmtMin(r.phutLam)
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-semibold tabular-nums text-foreground">
                          {r.cong != null ? (
                            r.cong
                          ) : (
                            <span className="font-normal text-muted-foreground">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <FlagList codes={r.flags} />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                              TRANG_THAI_TONE[r.trangThai],
                            )}
                          >
                            {NHAN_TRANG_THAI[r.trangThai]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </PhanTrangBang>
            </div>
          )}
        </section>

        {/* Đơn từ của mình trong tháng (chấm công v3 — WorkRequest) */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">
            Đơn từ trong tháng ({myRequests.length})
          </h2>
          {myRequests.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Chưa có đơn nào cho tháng này."
            />
          ) : (
            <ul className="space-y-2">
              {myRequests.map((r) => (
                <li key={r.id} className="t-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">
                      {WR_KIND_LABEL[r.kind as WorkRequestKindV] ?? r.kind}
                      {r.fromDate ? ` · ${dateFmt.format(r.fromDate)}` : ""}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        REQ_STATUS_CLS[r.status as WorkRequestStatusV],
                      )}
                    >
                      {WR_STATUS_LABEL[r.status as WorkRequestStatusV]}
                    </span>
                  </div>
                  {/* Đủ 4 mốc (06/10/2026) — cùng hàm mô tả với màn duyệt và thông báo. */}
                  {(r.requestedInAt || r.requestedOutAt || r.requestedIn2At || r.requestedOut2At) && (
                    <p className="mt-1 text-sm text-foreground">
                      Đề nghị:{" "}
                      {moTaMoc([r.requestedInAt, r.requestedOutAt, r.requestedIn2At, r.requestedOut2At])}
                    </p>
                  )}
                  <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">
                    {r.reason}
                  </p>
                  {r.reviewNote && (
                    <p className="mt-2 rounded-lg bg-muted/50 p-2 text-sm text-muted-foreground">
                      Phản hồi: {r.reviewNote}
                    </p>
                  )}
                  {r.status === "PENDING" && r.applyError && (
                    <p className="mt-2 text-xs text-state-danger-ink">
                      Lần duyệt gần nhất không áp được: {r.applyError}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Nút lùi/tiến tháng — `scroll={false}`: đổi tháng chỉ đổi ?thang= của CHÍNH trang này,
 *  để mặc định thì App Router cuộn vọt lên đầu, mất chỗ đang xem trong bảng chi tiết ca. */
function NavLink({
  href,
  aria,
  children,
}: {
  href: string;
  aria: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={aria}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted/50"
    >
      {children}
    </Link>
  );
}
