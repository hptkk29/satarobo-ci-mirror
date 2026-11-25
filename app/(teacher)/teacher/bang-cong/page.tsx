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
import { docCongOCuaNguoi } from "@/lib/phan-cong/cong-o-db";
import { docBaoCaoCuaToi } from "@/lib/parttime/bao-cao-thang-db";
import { docNhatKySuaCuaToi } from "@/lib/parttime/sua-buoi-da-qua-db";
import { DieuChinhBuoi, KhoanTru } from "./_components/khoi-parttime";
import { ManBangCong, tuDongCa, tuOCong } from "./_components/man-bang-cong";
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
  dungDongBangCong,
  tomTatCongThang,

} from "@/lib/cham-cong/bang-cong-gv";
import { congDayCuaNguoi } from "@/lib/cham-cong/cong-day";
import { docKyLuatMoi } from "@/lib/phan-cong/ky-luat-db";
import { luatKy, ngayBatDauLuatMoi } from "@/lib/phan-cong/cong-o";
import { chamTheoPhanCong } from "@/lib/parttime/cham-theo-phan-cong";
import { tongViec } from "@/lib/parttime/viec-ngay";
import { docCoSoCoPhanCong, docLoaiHopDong, docViecParttime } from "@/lib/parttime/viec-ngay-db";
import { hienTongPhanCong, type TongPhanCongHien } from "@/lib/cham-cong/dong-theo-phan-cong";
import { loadBuoiDay, loadLoaiCongDay } from "@/lib/cham-cong/cong-day-db";
import { scopedDb } from "@/lib/db-scope";
import {
  WR_KIND_LABEL,
  WR_STATUS_LABEL,
  type WorkRequestKindV,
  type WorkRequestStatusV,
} from "@/lib/work-request";
import { cn } from "@/lib/utils";
import { dieuKienBuoiTinhCong } from "@/lib/lms/session-ownership";
import { XacNhanCongCuaToi } from "@/components/cham-cong/xac-nhan-cong-cua-toi";
import { docBangCongCuaToi, xacNhanCongDangBat } from "@/lib/cham-cong/xac-nhan-cong";
import { caseCuaGiaoVien } from "@/lib/hoc-bu/case-doc";

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



export default async function TeacherTimesheetPage({
  searchParams,
}: {
  searchParams: Promise<{ thang?: string; loc?: string; o?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate

  const sp = await searchParams;
  const todayUtc = vnTodayUtc();
  const todayKey = isoKey(todayUtc);
  const thisMonth = startOfMonthUtc(todayUtc);
  const monthStart = parseThang(sp.thang) ?? thisMonth;
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
  // P2.2 — xác nhận / khiếu nại công tháng đang xem. Công tắc TẮT ⇒ không đọc, không vẽ.
  const bangXacNhan = (await xacNhanCongDangBat()) ? await docBangCongCuaToi(session.user.id, monthKey(monthStart), new Date()) : [];

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

  // ── GV PARTTIME TÍNH THEO PHÂN CÔNG (chủ dự án chốt 08/11/2026) ──────────────────────
  // Từ mốc `shift.parttimeLuatCongMoiTuKy` (01/11/2026), GV `contractType = PARTTIME`: công = VIỆC THEO PHÂN CÔNG — đọc bằng CHÍNH hàm
  // Bảng công ngày admin đọc (`docViecParttime` → engine Lương dự kiến của màn Phân công), gộp MỌI cơ sở có việc của mình (luật 12b).
  // Ô ca lịch rảnh + công ô ca của những ngày đó KHÔNG vào bảng, KHÔNG vào tóm tắt tháng. Trước mốc / FULLTIME: y nguyên.
  const dauThangKey = isoKey(monthStart);
  const cuoiThangKey = isoKey(new Date(nextMonth.getTime() - 86_400_000));
  const [tuKyLuatMoi, loaiHopDong] = await Promise.all([
    docKyLuatMoi(),
    docLoaiHopDong([session.user.id]).then((m) => m.get(session.user.id) ?? null),
  ]);
  const apDungPhanCong = (ngay: string) =>
    chamTheoPhanCong({ contractType: loaiHopDong, ngay, tuKy: tuKyLuatMoi });
  // Mốc là NGÀY BẮT ĐẦU ⇒ tháng có ngày đi theo phân công ⇔ ngày cuối tháng đi theo phân công; cả tháng ⇔ ngày đầu tháng cũng vậy.
  const thangCoPhanCong = apDungPhanCong(cuoiThangKey);
  const caThangTheoPhanCong = thangCoPhanCong && apDungPhanCong(dauThangKey);
  const viecPhanCong = thangCoPhanCong
    ? (
        await docViecParttime({
          centerIds: await docCoSoCoPhanCong(session.user.id, dauThangKey, cuoiThangKey),
          tu: dauThangKey,
          den: cuoiThangKey,
          now: new Date(),
          userIds: [session.user.id],
        })
      ).filter((v) => apDungPhanCong(v.ngay))
    : [];
  const tongPhanCong: { toiHomNay: TongPhanCongHien; caThang: TongPhanCongHien } | null = thangCoPhanCong
    ? {
        toiHomNay: hienTongPhanCong(tongViec(viecPhanCong.filter((v) => v.ngay <= todayKey))),
        caThang: hienTongPhanCong(tongViec(viecPhanCong)),
      }
    : null;

  // ── Ô CÔNG + CÔNG THÁNG PARTTIME (09/11/2026 — thay hai màn đã gỡ khỏi menu: "Ô công cần xem", "Công tháng của tôi") ─────────────
  // Ô công: CÙNG loader màn Công parttime tháng của QLCS (`docCongOCuaNguoi`), tới HẾT tháng — ô từ hôm nay trở đi hiện "Hôm nay / Sắp tới"
  // (mã đã có từ lịch phân công; trạng thái quét chưa đọc). Kỳ đi luật cũ ⇒ không có ô. Muộn / sớm / khoản trừ: `docBaoCaoCuaToi` (cùng
  // lớp đọc màn QLCS). `userId` luôn từ PHIÊN.
  const thangKey = monthKey(monthStart);
  const [oCong, baoCao, nhatKy] = await Promise.all([
    luatKy(thangKey, tuKyLuatMoi) !== "CU" ? docCongOCuaNguoi({ userId: session.user.id, periodKey: thangKey, den: cuoiThangKey }) : null,
    docBaoCaoCuaToi({ userId: session.user.id, thang: thangKey, now: new Date() }),
    docNhatKySuaCuaToi({ userId: session.user.id, tu: dauThangKey, den: cuoiThangKey }),
  ]);
  const oThang = oCong?.o ?? [];
  const dongBaoCao = baoCao.tongHop[0] ?? null;
  // Khung ô công (phân công) khi tháng có ô công HOẶC GV parttime theo phân công; còn lại khung theo ca (chủ dự án 10/11/2026 phương án 2).
  const coKhoiParttime = oThang.length > 0 || tongPhanCong !== null;
  const loc: "can-xem" | "phan-anh" | "tat-ca" = sp.o === "phan-anh" || sp.o === "can-xem" ? sp.o : "tat-ca";
  const hrefLoc = (l: "can-xem" | "phan-anh" | "tat-ca") => {
    const q = new URLSearchParams();
    if (sp.thang) q.set("thang", sp.thang);
    if (l !== "tat-ca") q.set("o", l);
    return `?${q.toString()}#chi-tiet`;
  };
  const soNgayThang = Number(cuoiThangKey.slice(8, 10));
  const ngayDaQuaKy = todayKey < dauThangKey ? 0 : todayKey > cuoiThangKey ? soNgayThang : Number(todayKey.slice(8, 10));

  const tomTat = tomTatCongThang({
    // Ngày đi theo phân công: công ô ca KHÔNG vào tóm tắt (đã bỏ hẳn cho nhóm này).
    ngay: myDays.filter((d) => !(thangCoPhanCong && apDungPhanCong(isoKey(d.date)))).map((d) => d.gop),
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
    theoPhanCong: thangCoPhanCong ? { apDung: apDungPhanCong, viec: viecPhanCong } : null,
  });

  // ── Dựng MÔ HÌNH HIỂN THỊ rồi giao cho khung thiết kế (`man-bang-cong.tsx`) — trang không vẽ gì riêng. ───────────────────────────
  const khoanTru = dongBaoCao ? <KhoanTru bc={baoCao} r={dongBaoCao} /> : null;
  const dieuChinh = <DieuChinhBuoi ds={nhatKy} />;
  const kq = coKhoiParttime
    ? tuOCong({
        o: oThang,
        homNay: todayKey,
        tong: tongPhanCong,
        tenCoSo: new Map((oCong?.coSo ?? []).map((c) => [c.id, c.ten])),
        loc,
        phanTruoc:
          tongPhanCong && !caThangTheoPhanCong ? (
            <>Tiết / trực tính theo phân công từ {viDate(ngayBatDauLuatMoi(tuKyLuatMoi) ?? cuoiThangKey)}; ngày trước mốc tính công theo ca.</>
          ) : tongPhanCong ? (
            <>
              Tiền dự kiến tới hôm nay <b className="text-primary-ink">{tongPhanCong.toiHomNay.tien}</b>
              {tongPhanCong.caThang.tienSo !== tongPhanCong.toiHomNay.tienSo ? ` · cả tháng ${tongPhanCong.caThang.tien}` : ""} — chưa phải phiếu lương.
              {tongPhanCong.toiHomNay.ghiChu.map((g) => ` ${g}.`)}
              {buoiQuaHan > 0 && (
                <>
                  {" "}
                  {buoiQuaHan} buổi dạy đã qua chưa chốt —{" "}
                  <Link href="/teacher/diem-danh" className="font-semibold text-primary-ink underline">
                    điểm danh / chốt buổi
                  </Link>
                  .
                </>
              )}
            </>
          ) : null,
        khoanTru,
        dieuChinh,
      })
    : tuDongCa({
        rows,
        tomTat,
        homNay: todayKey,
        loc,
        hrefDon: canRequestAdjust ? "/teacher/don-tu?type=TIMESHEET_FIX" : null,
        buoiQuaHan,
        congDay: congDay.dong,
        khoanTru,
        dieuChinh,
        donTu: myRequests.map((r) => ({
          key: r.id,
          tren: `${WR_KIND_LABEL[r.kind as WorkRequestKindV] ?? r.kind}${r.fromDate ? ` · ${dateFmt.format(r.fromDate)}` : ""}`,
          duoi: r.reviewNote ? `Phản hồi: ${r.reviewNote}` : r.reason,
          chip: (
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", REQ_STATUS_CLS[r.status as WorkRequestStatusV])}>
              {WR_STATUS_LABEL[r.status as WorkRequestStatusV]}
            </span>
          ),
        })),
      });

  return (
    <ManBangCong
      m={kq.m}
      thangKey={thangKey}
      homNay={todayKey}
      hrefThang={(t) => `?thang=${t}`}
      ky={{
        khoa: kyCong.status === "LOCKED",
        khoaLuc: kyCong.lockedAt ? viDate(dayKeyFmt.format(kyCong.lockedAt)) : null,
        daQua: ngayDaQuaKy,
        soNgay: soNgayThang,
        soCanXem: kq.soCanXem,
      }}
      hrefLoc={hrefLoc}
      loc={loc}
      demLoc={kq.dem}
      hanhDongDau={
        canRequestAdjust ? (
          <Link
            href="/teacher/don-tu?type=TIMESHEET_FIX"
            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 pointer-coarse:h-11"
          >
            Đơn chỉnh công
          </Link>
        ) : null
      }
      phuLuc={<XacNhanCongCuaToi bang={bangXacNhan} />}
    />
  );
}
