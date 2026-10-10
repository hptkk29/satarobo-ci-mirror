"use client";

// components/cham-cong/request-form.tsx — FORM NỘP ĐƠN dùng chung cho MỌI nhân sự.
//
// Vì sao file này tồn tại: site admin (`/don-tu/cua-toi`) và site giáo viên (`/teacher/don-tu`)
// nộp CÙNG 10 loại đơn qua CÙNG một Server Action. Hai bản form riêng là hai bộ luật client lệch
// nhau — người này nộp được, người kia bị chặn, mà không ai biết vì sao.
//
// THIẾT KẾ LẠI 06/10/2026 (chủ dự án: *"các đơn nộp cũng thiết kế lại cho người dùng dễ sử dụng
// hơn, thêm chữ i nhỏ giải thích cho từng trường hợp đơn"*). Ba bước trên MỘT cột (đọc tốt ở
// 375px, panel rộng thì lưới thẻ chia hai cột theo `@container`):
//   1. Chọn loại — thẻ có biểu tượng + nhãn + mô tả một dòng + chữ "i" (`ChuILoaiDon`). Chọn xong
//      thẻ thu lại thành một dòng "đã chọn" + nút "Đổi loại", để phần điền không bị đẩy xuống.
//   2. Điền — CHỈ ô của loại đã chọn, nhãn nói rõ nghĩa, gợi ý trong ô, lỗi tại chỗ bằng câu dễ
//      hiểu. Lỗi nào server CHẮC CHẮN sẽ trả (thứ tự mốc giờ, báo trước của loại nghỉ, dạy thay
//      thiếu người) thì kiểm NGAY ở đây bằng đúng luật server.
//   3. Tóm tắt trước khi gửi — "Bạn xin: …" + "Khi được duyệt: …" dựng bằng `lib/cham-cong/
//      tom-tat-don.ts`, cùng hàm màn duyệt của QLCS dùng ⇒ người nộp đọc đúng câu quản lý sẽ đọc.
//
// DỄ VỠ:
// 1. File này site GV mount ⇒ KHÔNG import `components/admin/**`, và CHỈ dùng token `:root`
//    (`.teacher-root` không có `--primary-soft`; `--primary-ink` ở `:root` là màu CAM, không tím).
// 2. Lỗi phải hiện TẠI Ô (`aria-invalid` + dòng chữ dưới ô), không chỉ bằng toast: toast biến mất
//    sau vài giây và người dùng còn lại một form không nói chỗ nào sai.
// 3. Payload gửi `submitRequestAction` giữ nguyên từng khoá — server suy `detail`/cơ sở nhận đơn
//    từ đúng bộ khoá này. TIMESHEET_FIX gửi 4 mốc `requestedInAt/OutAt/In2At/Out2At` (06/10/2026).
// 4. `preset` (`?type=`) mở form với loại đã chọn; `presetDate` (`?date=`) điền sẵn ngày.
import { nhanPhut } from "@/lib/cham-cong/dong-phut-don";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { vnYmd } from "@/lib/time/vn";
import {
  WR_CATEGORIES,
  WR_KIND_GIAI_THICH,
  WR_KIND_LABEL,
  diffHours,
  isClassKind,
  isRangeKind,
  isSingleKind,
  maNghiTrenLuoi,
  type WorkRequestKindV,
} from "@/lib/work-request";
import { submitRequestAction } from "@/lib/cham-cong/request-actions";
import type { RequestFormOptions } from "@/lib/cham-cong/request-form-data";
import { NHAN_VI_TRI_MOC, cheDoChoDon, kiemDanhSachMoc, soMocCuaCa } from "@/lib/cham-cong/sua-gio-quet";
import { khiDuyetSe, noiDungXin, soNgayDon, type DonDeTomTat } from "@/lib/cham-cong/tom-tat-don";
import { ChuILoaiDon, IconLoaiDon } from "@/components/cham-cong/ui/loai-don";

/** Ô nhập cao 44px — form này chạy trên điện thoại của giáo viên, không chỉ trên máy bàn. */
const FIELD =
  "h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring aria-[invalid=true]:border-state-danger";
const BTN_PRIMARY =
  "inline-flex h-12 items-center justify-center gap-1.5 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex h-12 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50";
const BTN_NHO =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted";

/** Khoá ô có thể báo lỗi. Thứ tự mảng = thứ tự ưu tiên khi cuộn/đọc lỗi đầu tiên. */
const ERROR_ORDER = [
  "kind",
  "centerId",
  "classId",
  "fromDate",
  "toDate",
  "newTemplateId",
  "targetUserId",
  "leaveTypeId",
  "thoiLuong",
  "gio",
  "moc",
  "destination",
  "reason",
] as const;
type ErrorKey = (typeof ERROR_ORDER)[number];
type Errors = Partial<Record<ErrorKey, string>>;

/** "YYYY-MM-DD" ⇒ Date nửa đêm UTC — cùng hình dạng cột `@db.Date` mà hàm tóm tắt/kiểm mốc đọc. */
function ngay(ymd: string): Date | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? new Date(`${ymd}T00:00:00Z`) : null;
}

/** Số ngày từ `a` tới `b` (cả hai "YYYY-MM-DD"). */
function cachNgay(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function RequestForm({
  options,
  preset,
  presetDate,
  onClose,
  className,
}: {
  options: RequestFormOptions;
  preset?: WorkRequestKindV | null;
  /** `?date=` từ lịch ca: mở form là ngày đã điền sẵn, đỡ một lần gõ và đỡ chọn nhầm ngày. */
  presetDate?: string | null;
  onClose: () => void;
  className?: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [pending, start] = useTransition();
  const showClass = options.myClasses.length > 0;
  // Miễn chấm công ⇒ server chỉ nhận đơn lớp. Bày thẻ loại mà bấm Gửi chắc chắn bị từ chối là
  // lời hứa suông (luật 12) — chỉ bày nhóm lớp.
  const categories = WR_CATEGORIES.filter(
    (c) => (c.key !== "class" || showClass) && (!options.timesheetExempt || c.key === "class"),
  );
  const [kind, setKind] = useState<WorkRequestKindV | null>(preset ?? null);
  const [doiLoai, setDoiLoai] = useState(false);
  const [homNay] = useState(() => vnYmd(new Date()));
  const [fromDate, setFromDate] = useState(presetDate ?? "");
  const [toDate, setToDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [lateType, setLateType] = useState<"Đi muộn" | "Về sớm">("Đi muộn");
  const [destination, setDestination] = useState("");
  const [classId, setClassId] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [newTemplateId, setNewTemplateId] = useState("");
  const [targetTemplateId, setTargetTemplateId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState(options.leaveTypes[0]?.id ?? "");
  // Thời lượng nghỉ (đợt 7–8) — nghỉ phép + nghỉ bù. Khác "cả ngày" ⇒ một ngày, có thể kèm khung giờ.
  const [thoiLuong, setThoiLuong] = useState<"FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOURLY">("FULL_DAY");
  const [moc, setMoc] = useState<string[]>(["", "", "", ""]);
  const [soO, setSoO] = useState<2 | 4>(() => soOMacDinh(presetDate ?? ""));
  const [centerId, setCenterId] = useState(options.defaultCenter?.id ?? "");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const isClass = kind ? isClassKind(kind) : false;
  const single = kind ? isSingleKind(kind) : false;
  const range = kind ? isRangeKind(kind) : false;
  const coThoiLuong = kind === "LEAVE" || kind === "COMP_LEAVE";
  const nghiMotPhan = coThoiLuong && thoiLuong !== "FULL_DAY";
  const needsCenterPick = !options.defaultCenter;
  const teachersOnly = options.colleagues.filter((c) => c.isTeacher);
  const idOf = (k: ErrorKey | string) => `${uid}-${k}`;
  const showPicker = kind === null || doiLoai;

  /** Ca của ngày đã chọn: `biet=false` = ngoài cửa sổ đã nạp ⇒ không đoán. */
  function caCuaNgay(ymd: string): { biet: boolean; ca: { code: string; soCap: number | null } | null } {
    const { tu, den, ca } = options.caTheoNgay;
    if (!ngay(ymd) || ymd < tu || ymd > den) return { biet: false, ca: null };
    return { biet: true, ca: ca[ymd] ?? null };
  }
  /** Ca hai buổi (4 lần quét) thì mở sẵn 4 ô — đúng số mốc "đủ bộ" của ca đó. */
  function soOMacDinh(ymd: string): 2 | 4 {
    const c = caCuaNgay(ymd);
    return c.biet && soMocCuaCa(c.ca?.soCap ?? null) === 4 ? 4 : 2;
  }

  function pickKind(k: WorkRequestKindV) {
    setKind(k);
    setDoiLoai(false);
    // Đổi loại thì xoá lỗi cũ — ô báo đỏ của loại vừa rời khỏi không còn nghĩa gì.
    setErrors({});
  }

  function doiNgay(v: string) {
    setFromDate(v);
    if (kind === "TIMESHEET_FIX" && soOMacDinh(v) === 4) setSoO(4);
  }

  // ── Dữ liệu suy ra (dùng chung cho kiểm lỗi, tóm tắt và payload) ───────────────────────
  const caNgay = caCuaNgay(fromDate);
  const mocGui = moc.slice(0, soO).map((m) => (m.trim() ? m.trim() : null));
  const coMoc = mocGui.some(Boolean);
  const kiemMoc = kind === "TIMESHEET_FIX" && ngay(fromDate) && coMoc
    ? kiemDanhSachMoc(ngay(fromDate)!, mocGui, "GHI_THEM") // cùng chế độ server kiểm lúc nộp
    : null;
  const cheDo =
    kind === "TIMESHEET_FIX" && caNgay.biet && coMoc ? cheDoChoDon(mocGui, soMocCuaCa(caNgay.ca?.soCap ?? null)) : null;
  const leave = options.leaveTypes.find((l) => l.id === leaveTypeId) ?? null;
  // Luật server (`submitAttendanceRequest`): loại nghỉ có `noticeDays` mà nộp sát ngày ⇒ phải có
  // người làm thay. Kiểm ở đây để báo TẠI Ô trước khi gửi.
  const nghiSatNgay =
    kind === "LEAVE" && leave?.noticeDays != null && ngay(fromDate) !== null && cachNgay(homNay, fromDate) < leave.noticeDays;
  // Đơn có KHUNG GIỜ BẮT BUỘC: tăng ca · làm ngày nghỉ / lễ (đợt 9) · chấm ngoài địa điểm (đợt 10).
  const coKhungBatBuoc = kind === "OT" || kind === "HOLIDAY_WORK" || kind === "OUTSIDE_ATTENDANCE";
  const gioOt = coKhungBatBuoc ? diffHours(startTime, endTime) : null;
  const who = options.colleagues.find((t) => t.id === targetUserId)?.name ?? null;
  const newCode = options.templates.find((t) => t.id === newTemplateId)?.code ?? null;
  const targetCode = options.templates.find((t) => t.id === targetTemplateId)?.code ?? null;
  const soNgay = range && ngay(fromDate) ? soNgayDon(ngay(fromDate), ngay(toDate || fromDate)) : null;

  function detailOf(): string | null {
    let detail: string | null = null;
    if (kind === "BUSINESS_TRIP" && destination.trim()) detail = `Nơi đến: ${destination.trim()}`;
    if (kind === "OUTSIDE_ATTENDANCE" && destination.trim()) detail = `Địa điểm: ${destination.trim()}`;
    if (kind === "LATE_EARLY") detail = lateType;
    if (kind === "SUB_TEACH") detail = who ? `Người dạy thay: ${who}` : null;
    if (kind === "SHIFT_SWAP") {
      detail = [newCode ? `Ca mới: ${newCode}` : "", who ? `Người nhận: ${who}` : ""].filter(Boolean).join(" · ") || null;
    }
    if (kind === "LEAVE" && who) detail = `Người làm thay: ${who}`;
    return detail;
  }

  const donTomTat: DonDeTomTat | null = kind
    ? {
        kind,
        fromDate: ngay(fromDate),
        toDate: range ? ngay(toDate || fromDate) : null,
        startTime: startTime || null,
        endTime: coKhungBatBuoc || kind === "REMOTE" || (coThoiLuong && thoiLuong === "HOURLY") ? endTime || null : null,
        className: isClass ? (options.myClasses.find((c) => c.id === classId)?.name ?? null) : null,
        detail: detailOf(),
        moc: kind === "TIMESHEET_FIX" ? mocGui : [],
        leaveName: kind === "LEAVE" ? (leave?.name ?? null) : null,
        leavePaidRatio: kind === "LEAVE" ? (leave?.paidRatio ?? null) : null,
        leaveDurationType: coThoiLuong ? thoiLuong : null,
        newShiftCode: kind === "SHIFT_SWAP" ? newCode : null,
        targetName: kind === "SUB_TEACH" || kind === "SHIFT_SWAP" || kind === "LEAVE" ? who : null,
        targetShiftCode: (kind === "SHIFT_SWAP" || kind === "LEAVE") && who ? targetCode : null,
      }
    : null;

  function validate(): Errors {
    const e: Errors = {};
    if (!kind) {
      e.kind = "Chọn loại đơn bạn muốn nộp";
      return e;
    }
    if (needsCenterPick && !centerId) e.centerId = "Chọn cơ sở sẽ duyệt đơn này";
    if (isClass && !classId) e.classId = "Chọn lớp";
    if (!fromDate) e.fromDate = isClass ? "Chọn ngày của buổi dạy" : range ? "Chọn ngày bắt đầu" : "Chọn ngày";
    if (range && fromDate && toDate && toDate < fromDate) e.toDate = "Ngày kết thúc không được trước ngày bắt đầu";
    if (range && soNgay !== null && soNgay > 63) e.toDate = "Một đơn tối đa 62 ngày — tách thành nhiều đơn";
    if (kind === "SHIFT_SWAP" && !newTemplateId) e.newTemplateId = "Chọn ca mới bạn muốn làm";
    if (kind === "SUB_TEACH" && !targetUserId) {
      e.targetUserId = "Chọn người dạy thay — thiếu người thay thì quản lý không duyệt được";
    }
    if (kind === "LEAVE" && !leaveTypeId) e.leaveTypeId = "Chọn loại nghỉ";
    if (coThoiLuong && thoiLuong === "HOURLY") {
      if (!startTime || !endTime) e.gio = "Nghỉ theo giờ: nhập giờ bắt đầu và giờ kết thúc";
      else if (endTime <= startTime) e.gio = "Giờ kết thúc phải sau giờ bắt đầu";
    }
    if (kind === "COMP_LEAVE" && options.soDuNghiBuPhut <= 0) {
      e.thoiLuong = "Quỹ nghỉ bù của bạn đang bằng 0 — chưa có thời gian tích luỹ để nghỉ bù";
    }
    if (nghiSatNgay && !targetUserId) {
      e.targetUserId = `“${leave!.name}” cần báo trước ${leave!.noticeDays} ngày. Nộp sát ngày thì chọn người làm thay — hoặc chọn loại nghỉ đột xuất (ốm, ma chay, thai sản).`;
    }
    if (coKhungBatBuoc) {
      if (!startTime || !endTime) e.gio = "Nhập giờ bắt đầu và giờ kết thúc";
      else if (gioOt === null) e.gio = "Giờ kết thúc phải sau giờ bắt đầu";
    }
    if (kind === "OUTSIDE_ATTENDANCE" && !destination.trim()) e.destination = "Ghi địa điểm bạn sẽ chấm công";
    // Làm từ xa một phần ngày (đợt 5): khai giờ thì phải đủ hai đầu và đúng chiều.
    if (kind === "REMOTE" && (startTime || endTime)) {
      if (!startTime || !endTime) e.gio = "Khai đủ giờ bắt đầu và giờ kết thúc — hoặc để trống cả hai nếu làm từ xa cả ngày";
      else if (endTime <= startTime) e.gio = "Giờ kết thúc phải sau giờ bắt đầu";
    }
    if (kind === "LATE_EARLY" && !startTime) {
      e.gio = lateType === "Đi muộn" ? "Nhập giờ bạn dự kiến đến" : "Nhập giờ bạn dự kiến về";
    }
    if (kind === "TIMESHEET_FIX") {
      if (!coMoc) e.moc = "Điền ít nhất một mốc giờ đúng";
      else if (kiemMoc && !kiemMoc.ok) e.moc = kiemMoc.error;
    }
    if (!reason.trim()) e.reason = "Viết ngắn gọn lý do để quản lý nắm";
    return e;
  }

  function submit() {
    const found = validate();
    setErrors(found);
    const firstKey = ERROR_ORDER.find((k) => found[k]);
    if (firstKey || !kind) {
      if (firstKey) {
        toast.error(found[firstKey]!);
        document.getElementById(idOf(firstKey))?.focus();
      }
      return;
    }

    start(async () => {
      const res = await submitRequestAction({
        kind,
        fromDate: fromDate || null,
        // Nghỉ một phần ca chỉ một ngày — không gửi "đến ngày" để máy chủ lấy đúng ngày bắt đầu.
        toDate: range && !nghiMotPhan ? toDate || null : null,
        startTime: startTime || null,
        endTime: endTime || null,
        className: isClass ? (options.myClasses.find((c) => c.id === classId)?.name ?? null) : null,
        classId: isClass ? classId || null : null,
        targetUserId: kind === "SUB_TEACH" || kind === "SHIFT_SWAP" || kind === "LEAVE" ? targetUserId || null : null,
        requesterNewTemplateId: kind === "SHIFT_SWAP" ? newTemplateId || null : null,
        targetNewTemplateId: (kind === "SHIFT_SWAP" || kind === "LEAVE") && targetUserId ? targetTemplateId || null : null,
        leaveTypeId: kind === "LEAVE" ? leaveTypeId || null : null,
        requestedInAt: kind === "TIMESHEET_FIX" ? (mocGui[0] ?? null) : null,
        requestedOutAt: kind === "TIMESHEET_FIX" ? (mocGui[1] ?? null) : null,
        requestedIn2At: kind === "TIMESHEET_FIX" ? (mocGui[2] ?? null) : null,
        requestedOut2At: kind === "TIMESHEET_FIX" ? (mocGui[3] ?? null) : null,
        chosenCenterId: needsCenterPick ? centerId || null : null,
        leaveDurationType: coThoiLuong ? thoiLuong : null,
        detail: detailOf(),
        reason: reason.trim(),
      });
      if (res.ok) {
        toast.success(res.note ? `Đã gửi đơn — ${res.note}` : "Đã gửi đơn — chờ quản lý duyệt");
        onClose();
        router.refresh();
      } else toast.error(res.error);
    });
  }

  const dateField = (label: string, hint?: string) => (
    <Field id={idOf("fromDate")} label={label} hint={hint} required error={errors.fromDate}>
      <input
        id={idOf("fromDate")}
        type="date"
        value={fromDate}
        onChange={(e) => doiNgay(e.target.value)}
        required
        aria-invalid={errors.fromDate ? true : undefined}
        className={FIELD}
      />
      <DocNgay value={fromDate} />
    </Field>
  );

  /** "Ca của bạn ngày này" — chỉ in khi BIẾT (ngày trong cửa sổ đã nạp). */
  const caHienTai = fromDate && caNgay.biet && (
    <p className="rounded-lg bg-muted px-3 py-2 text-xs text-foreground">
      {caNgay.ca ? (
        <>
          Ca của bạn ngày này: <b className="font-mono">{caNgay.ca.code}</b>
          {soMocCuaCa(caNgay.ca.soCap) === 4 ? " — ca hai buổi (4 lần quét)" : " — một buổi (quét vào + ra)"}
        </>
      ) : (
        "Ngày này bạn chưa được xếp ca."
      )}
    </p>
  );

  // Thời lượng nghỉ (đợt 7–8) — dùng chung cho Nghỉ phép và Nghỉ bù.
  const NHAN_THOI_LUONG = { FULL_DAY: "Cả ngày", HALF_DAY_AM: "Nửa buổi sáng", HALF_DAY_PM: "Nửa buổi chiều", HOURLY: "Theo giờ" } as const;
  const thoiLuongField = coThoiLuong ? (
    <>
      <Field id={idOf("thoiLuong")} label="Thời lượng" required error={errors.thoiLuong} className="@md:col-span-2">
        <div role="radiogroup" aria-label="Thời lượng nghỉ" className="grid grid-cols-2 gap-2 @md:grid-cols-4">
          {(["FULL_DAY", "HALF_DAY_AM", "HALF_DAY_PM", "HOURLY"] as const).map((v, i) => (
            <button
              key={v}
              id={i === 0 ? idOf("thoiLuong") : undefined}
              type="button"
              role="radio"
              aria-checked={thoiLuong === v}
              onClick={() => setThoiLuong(v)}
              className={cn(
                "h-11 rounded-lg border text-sm font-semibold transition-colors",
                thoiLuong === v
                  ? "border-primary text-foreground ring-1 ring-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {NHAN_THOI_LUONG[v]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {kind === "COMP_LEAVE" ? `Quỹ nghỉ bù hiện có: ${nhanPhut(Math.max(0, options.soDuNghiBuPhut))}. ` : ""}
          {nghiMotPhan
            ? "Ca giữ nguyên — chỉ thời gian nghỉ được miễn chấm công, phần còn lại vẫn chấm như thường. Một ngày mỗi đơn."
            : kind === "COMP_LEAVE"
              ? "Nghỉ trọn ca của ngày đó."
              : "Nghỉ trọn các ngày đã chọn."}
        </p>
      </Field>
      {thoiLuong === "HOURLY" && (
        <Field id={idOf("gio")} label="Nghỉ từ – đến" required error={errors.gio} className="@md:col-span-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              id={idOf("gio")}
              type="time"
              aria-label="Nghỉ từ giờ"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              aria-invalid={errors.gio ? true : undefined}
              className={FIELD}
            />
            <input
              type="time"
              aria-label="Nghỉ đến giờ"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              aria-invalid={errors.gio ? true : undefined}
              className={FIELD}
            />
          </div>
        </Field>
      )}
    </>
  ) : null;

  const nguoiOptions = (ds: { id: string; name: string }[], empty: string) => (
    <>
      <option value="">{empty}</option>
      {ds.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </>
  );

  return (
    // `@container`: form này sống trong panel bên phải (Sheet) ở admin và inline ở site GV, mà bề
    // ngang panel KHÔNG liên quan gì tới bề ngang cửa sổ — mọi ngưỡng bên trong đo theo CHÍNH
    // KHỐI NÀY (`@md` ≈ 448px). Ở 375px tất cả là MỘT cột.
    <div className={cn("@container rounded-xl border border-border bg-card p-4 @md:p-5", className)}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-base font-bold text-foreground">Tạo đơn mới</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng form tạo đơn"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {options.timesheetExempt && (
        <p className="mb-4 rounded-lg bg-state-warning-soft p-3 text-sm text-state-warning-ink">
          {showClass
            ? "Bạn thuộc diện miễn chấm công — chỉ cần nộp đơn liên quan lớp học."
            : "Bạn thuộc diện miễn chấm công và chưa phụ trách lớp nào — không có loại đơn nào cần nộp."}
        </p>
      )}

      <div className="space-y-6">
        {/* ── BƯỚC 1: CHỌN LOẠI ─────────────────────────────────────────────────────── */}
        <section aria-labelledby={idOf("b1")}>
          <BuocTieuDe id={idOf("b1")} so={1} chu="Bạn muốn xin gì?" />
          {showPicker ? (
            // `radiogroup`: trình đọc màn hình nghe "đang chọn 1 trong N". Chữ "i" là nút RIÊNG
            // đứng cạnh thẻ (nút lồng nút là HTML hỏng) và nó tự chặn lan bấm.
            <div role="radiogroup" aria-label="Loại đơn" id={idOf("kind")} tabIndex={-1} className="space-y-4">
              {categories.map((cat) => (
                <div key={cat.key}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat.label}</p>
                  <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
                    {cat.kinds.map((k) => {
                      const on = kind === k;
                      return (
                        <div key={k} className="relative">
                          <button
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => pickKind(k)}
                            className={cn(
                              "flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card p-3 pr-12 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              on ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted",
                            )}
                          >
                            <IconLoaiDon kind={k} />
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-foreground">{WR_KIND_LABEL[k]}</span>
                              <span className="block text-xs text-muted-foreground">{WR_KIND_GIAI_THICH[k].moTaNgan}</span>
                            </span>
                          </button>
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                            <ChuILoaiDon kind={k} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {errors.kind && (
                <p role="alert" className="text-sm text-state-danger-ink">
                  {errors.kind}
                </p>
              )}
            </div>
          ) : (
            kind && (
              <div className="flex items-center gap-3 rounded-xl border border-primary bg-card p-3 ring-1 ring-primary">
                <IconLoaiDon kind={kind} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
                    {WR_KIND_LABEL[kind]}
                    <ChuILoaiDon kind={kind} />
                  </span>
                  <span className="block text-xs text-muted-foreground">{WR_KIND_GIAI_THICH[kind].moTaNgan}</span>
                </span>
                <button type="button" onClick={() => setDoiLoai(true)} className={BTN_NHO}>
                  Đổi loại
                </button>
              </div>
            )
          )}
        </section>

        {kind && (
          <>
            {/* ── BƯỚC 2: ĐIỀN ─────────────────────────────────────────────────────────── */}
            <section aria-labelledby={idOf("b2")} className="space-y-4">
              <BuocTieuDe id={idOf("b2")} so={2} chu="Điền thông tin" />

              {needsCenterPick ? (
                <Field
                  id={idOf("centerId")}
                  label="Cơ sở sẽ duyệt đơn"
                  hint="Bạn thuộc Hội sở — chọn cơ sở nơi bạn làm ngày đó; Quản lý cơ sở ấy sẽ duyệt."
                  required
                  error={errors.centerId}
                >
                  <select
                    id={idOf("centerId")}
                    value={centerId}
                    onChange={(e) => setCenterId(e.target.value)}
                    required
                    aria-invalid={errors.centerId ? true : undefined}
                    className={FIELD}
                  >
                    <option value="">- Chọn cơ sở -</option>
                    {options.centers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Đơn gửi tới Quản lý của <strong className="text-foreground">{options.defaultCenter?.label}</strong>{" "}
                  (cơ sở bạn làm ngày đó). Nên nộp trước ít nhất {options.noticeDays} ngày — nộp sát ngày vẫn gửi
                  được nhưng đơn mang cờ “Nộp muộn”.
                </p>
              )}

              <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
                {isClass && (
                  <>
                    <Field id={idOf("classId")} label="Lớp" required error={errors.classId}>
                      <select
                        id={idOf("classId")}
                        value={classId}
                        onChange={(e) => setClassId(e.target.value)}
                        required
                        aria-invalid={errors.classId ? true : undefined}
                        className={FIELD}
                      >
                        <option value="">- Chọn lớp bạn phụ trách -</option>
                        {options.myClasses.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {dateField(kind === "CLASS_CHANGE" ? "Áp dụng từ ngày" : "Ngày của buổi dạy")}
                    {kind === "SUB_TEACH" && (
                      <Field
                        id={idOf("targetUserId")}
                        label="Người dạy thay"
                        hint="Đồng nghiệp đã nhận dạy thay buổi này."
                        required
                        error={errors.targetUserId}
                        className="@md:col-span-2"
                      >
                        <select
                          id={idOf("targetUserId")}
                          value={targetUserId}
                          onChange={(e) => setTargetUserId(e.target.value)}
                          required
                          aria-invalid={errors.targetUserId ? true : undefined}
                          className={FIELD}
                        >
                          {nguoiOptions(teachersOnly, "- Chọn giáo viên dạy thay -")}
                        </select>
                      </Field>
                    )}
                  </>
                )}

                {kind === "SHIFT_SWAP" && (
                  <>
                    {dateField("Ngày cần đổi ca")}
                    <Field id={idOf("newTemplateId")} label="Ca mới bạn muốn làm" required error={errors.newTemplateId}>
                      <select
                        id={idOf("newTemplateId")}
                        value={newTemplateId}
                        onChange={(e) => setNewTemplateId(e.target.value)}
                        required
                        aria-invalid={errors.newTemplateId ? true : undefined}
                        className={FIELD}
                      >
                        <option value="">- Chọn ca -</option>
                        {options.templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.code} — {t.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="@md:col-span-2">{caHienTai}</div>
                    <Field id={idOf("swapTarget")} label="Đổi với đồng nghiệp (không bắt buộc)">
                      <select
                        id={idOf("swapTarget")}
                        value={targetUserId}
                        onChange={(e) => setTargetUserId(e.target.value)}
                        className={FIELD}
                      >
                        {nguoiOptions(options.colleagues, "- Không đổi với ai -")}
                      </select>
                    </Field>
                    {targetUserId && (
                      <Field
                        id={idOf("swapTargetTemplate")}
                        label="Ca đồng nghiệp sẽ làm"
                        hint="Không chọn thì lịch của đồng nghiệp GIỮ NGUYÊN — quản lý tự xếp."
                      >
                        <select
                          id={idOf("swapTargetTemplate")}
                          value={targetTemplateId}
                          onChange={(e) => setTargetTemplateId(e.target.value)}
                          className={FIELD}
                        >
                          <option value="">- Không chọn (giữ nguyên lịch của họ) -</option>
                          {options.templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.code} — {t.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                  </>
                )}

                {single && (
                  <>
                    {dateField(kind === "TIMESHEET_FIX" ? "Ngày cần chỉnh công" : "Ngày")}
                    {kind === "COMP_LEAVE" && thoiLuongField}
                    {kind === "LATE_EARLY" && (
                      <>
                        <fieldset>
                          <legend className="mb-1 block text-sm font-semibold text-foreground">Bạn sẽ</legend>
                          <div role="radiogroup" aria-label="Đi muộn hay về sớm" className="grid grid-cols-2 gap-2">
                            {(["Đi muộn", "Về sớm"] as const).map((v) => (
                              <button
                                key={v}
                                type="button"
                                role="radio"
                                aria-checked={lateType === v}
                                onClick={() => setLateType(v)}
                                className={cn(
                                  "h-11 rounded-lg border text-sm font-semibold transition-colors",
                                  lateType === v
                                    ? "border-primary text-foreground ring-1 ring-primary"
                                    : "border-border text-muted-foreground hover:bg-muted",
                                )}
                              >
                                {v}
                              </button>
                            ))}
                          </div>
                        </fieldset>
                        <Field
                          id={idOf("gio")}
                          label={lateType === "Đi muộn" ? "Giờ bạn dự kiến đến" : "Giờ bạn dự kiến về"}
                          required
                          error={errors.gio}
                        >
                          <input
                            id={idOf("gio")}
                            type="time"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            aria-invalid={errors.gio ? true : undefined}
                            className={FIELD}
                          />
                        </Field>
                      </>
                    )}
                    {coKhungBatBuoc && (
                      <Field
                        id={idOf("gio")}
                        label={kind === "OT" ? "Làm thêm từ – đến" : kind === "HOLIDAY_WORK" ? "Làm việc từ – đến" : "Chấm ngoài địa điểm từ – đến"}
                        required
                        error={errors.gio}
                      >
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            id={idOf("gio")}
                            type="time"
                            aria-label="Bắt đầu làm thêm"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            aria-invalid={errors.gio ? true : undefined}
                            className={FIELD}
                          />
                          <input
                            type="time"
                            aria-label="Kết thúc làm thêm"
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            aria-invalid={errors.gio ? true : undefined}
                            className={FIELD}
                          />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {gioOt !== null
                            ? `= ${gioOt} giờ${kind === "OT" ? " làm thêm" : ""}`
                            : kind === "OUTSIDE_ATTENDANCE"
                              ? "Chỉ trong khung này (cộng dung sai vài chục phút) mới chấm ngoài điểm chấm được."
                              : "Hệ thống tự tính số giờ."}
                        </p>
                      </Field>
                    )}
                    {kind === "TIMESHEET_FIX" && (
                      <div className="space-y-3 @md:col-span-2">
                        {caHienTai}
                        <fieldset
                          id={idOf("moc")}
                          tabIndex={-1}
                          aria-describedby={errors.moc || (kiemMoc && !kiemMoc.ok) ? idOf("moc-err") : undefined}
                        >
                          <legend className="mb-1 block text-sm font-semibold text-foreground">
                            Giờ đúng của ngày đó <span className="text-state-danger-ink" aria-hidden>*</span>
                          </legend>
                          <p className="mb-2 text-xs text-muted-foreground">
                            Điền theo thứ tự trong ngày. Quên một đầu thì chỉ điền ô đó.
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            {NHAN_VI_TRI_MOC.slice(0, soO).map((nhan, i) => (
                              <label key={nhan} className="block">
                                <span className="mb-1 block text-xs font-semibold text-foreground">{nhan}</span>
                                <input
                                  type="time"
                                  value={moc[i]}
                                  onChange={(e) => setMoc((m) => m.map((x, j) => (j === i ? e.target.value : x)))}
                                  aria-invalid={kiemMoc && !kiemMoc.ok ? true : undefined}
                                  className={FIELD}
                                />
                              </label>
                            ))}
                          </div>
                          {(errors.moc || (kiemMoc && !kiemMoc.ok)) && (
                            <p id={idOf("moc-err")} role="alert" className="mt-1 text-xs text-state-danger-ink">
                              {kiemMoc && !kiemMoc.ok ? kiemMoc.error : errors.moc}
                            </p>
                          )}
                          <div className="mt-2">
                            {soO === 2 ? (
                              <button type="button" className={BTN_NHO} onClick={() => setSoO(4)}>
                                <Plus className="h-4 w-4" aria-hidden /> Thêm buổi 2 (Vào 2 · Ra 2)
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={BTN_NHO}
                                onClick={() => {
                                  setSoO(2);
                                  setMoc((m) => [m[0]!, m[1]!, "", ""]);
                                }}
                              >
                                Bỏ buổi 2
                              </button>
                            )}
                          </div>
                        </fieldset>
                        {coMoc && (
                          <p
                            className={cn(
                              "rounded-lg px-3 py-2 text-xs",
                              cheDo === "GHI_DE"
                                ? "bg-state-warning-soft text-state-warning-ink"
                                : "bg-state-info-soft text-state-info-ink",
                            )}
                          >
                            {cheDo === "GHI_DE"
                              ? "Bạn điền ĐỦ mốc của ca ⇒ khi duyệt, các mốc này THAY toàn bộ lượt quét cũ của ngày (lượt cũ giữ để xem, không còn tính công)."
                              : cheDo === "GHI_THEM"
                                ? "Chưa đủ mốc của ca ⇒ khi duyệt, hệ thống chỉ THÊM các mốc này; lượt quét cũ vẫn tính công."
                                : "Điền đủ mốc của ca thì khi duyệt sẽ thay lượt quét cũ; điền thiếu thì chỉ thêm mốc."}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}

                {range && (
                  <>
                    {dateField(kind === "LEAVE" && nghiMotPhan ? "Ngày nghỉ" : "Từ ngày")}
                    {!(kind === "LEAVE" && nghiMotPhan) && (
                    <Field
                      id={idOf("toDate")}
                      label="Đến ngày"
                      hint="Chỉ một ngày thì để trống."
                      error={errors.toDate}
                    >
                      {/* `min` = ngày bắt đầu: bộ chọn ngày tự chặn khoảng ngược. */}
                      <input
                        id={idOf("toDate")}
                        type="date"
                        value={toDate}
                        min={fromDate || undefined}
                        onChange={(e) => setToDate(e.target.value)}
                        aria-invalid={errors.toDate ? true : undefined}
                        className={FIELD}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {soNgay !== null ? `Tổng cộng ${soNgay} ngày` : "Chưa chọn ngày"}
                      </p>
                    </Field>
                    )}
                    {kind === "LEAVE" && thoiLuongField}
                    {kind === "LEAVE" && (
                      <>
                        <Field
                          id={idOf("leaveTypeId")}
                          label="Loại nghỉ"
                          required
                          error={errors.leaveTypeId}
                          className="@md:col-span-2"
                        >
                          <select
                            id={idOf("leaveTypeId")}
                            value={leaveTypeId}
                            onChange={(e) => setLeaveTypeId(e.target.value)}
                            aria-invalid={errors.leaveTypeId ? true : undefined}
                            className={FIELD}
                          >
                            {options.leaveTypes.length === 0 && <option value="">- Chưa có loại nghỉ -</option>}
                            {options.leaveTypes.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                                {l.paidRatio === 0 ? " (không lương)" : ""}
                              </option>
                            ))}
                          </select>
                          {leave && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {maNghiTrenLuoi(leave.paidRatio) === "P" ? "Có lương — ghi mã P." : "Không lương — ghi mã X."}{" "}
                              {leave.noticeDays != null
                                ? `Cần báo trước ${leave.noticeDays} ngày (nộp sát ngày phải có người làm thay).`
                                : "Không cần báo trước."}
                            </p>
                          )}
                        </Field>
                        <Field
                          id={idOf("targetUserId")}
                          label={nghiSatNgay ? "Người làm thay" : "Người làm thay (không bắt buộc)"}
                          required={nghiSatNgay}
                          error={errors.targetUserId}
                        >
                          <select
                            id={idOf("targetUserId")}
                            value={targetUserId}
                            onChange={(e) => setTargetUserId(e.target.value)}
                            aria-invalid={errors.targetUserId ? true : undefined}
                            className={FIELD}
                          >
                            {nguoiOptions(options.colleagues, "- Không có -")}
                          </select>
                        </Field>
                        {targetUserId && (
                          <Field
                            id={idOf("leaveTargetTemplate")}
                            label="Ca người làm thay (ngày đầu)"
                            hint="Không chọn thì người làm thay KHÔNG được xếp ca tự động."
                          >
                            <select
                              id={idOf("leaveTargetTemplate")}
                              value={targetTemplateId}
                              onChange={(e) => setTargetTemplateId(e.target.value)}
                              className={FIELD}
                            >
                              <option value="">- Không chọn -</option>
                              {options.templates.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.code} — {t.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                        )}
                      </>
                    )}
                    {kind === "REMOTE" && (
                      <Field
                        id={idOf("gio")}
                        label="Khung giờ (không bắt buộc)"
                        hint="Để trống = làm từ xa cả ngày. Khai giờ thì chỉ trong khung đó mới chấm ngoài văn phòng được."
                        error={errors.gio}
                        className="@md:col-span-2"
                      >
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            id={idOf("gio")}
                            type="time"
                            aria-label="Làm từ xa từ giờ"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            aria-invalid={errors.gio ? true : undefined}
                            className={FIELD}
                          />
                          <input
                            type="time"
                            aria-label="Làm từ xa đến giờ"
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            aria-invalid={errors.gio ? true : undefined}
                            className={FIELD}
                          />
                        </div>
                      </Field>
                    )}
                  </>
                )}
                {/* Ô nơi đến / địa điểm đứng NGOÀI hai khối một-ngày / nhiều-ngày: công tác là loại nhiều
                    ngày, chấm công ngoài địa điểm là loại MỘT ngày — đặt trong khối `range` (bản đầu) thì
                    loại sau không bao giờ thấy ô mà form + server vẫn bắt buộc ⇒ không gửi được đơn (luật 12;
                    soát giao diện 375px 08/10 bắt được). Lưới: [DT-F1] `request-form-dia-diem.test.tsx`. */}
                {(kind === "BUSINESS_TRIP" || kind === "OUTSIDE_ATTENDANCE") && (
                  <Field
                    id={idOf("destination")}
                    label={kind === "BUSINESS_TRIP" ? "Nơi đến" : "Địa điểm"}
                    required={kind === "OUTSIDE_ATTENDANCE"}
                    error={errors.destination}
                    className="@md:col-span-2"
                  >
                    <input
                      id={idOf("destination")}
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      placeholder={kind === "BUSINESS_TRIP" ? "VD: Cơ sở 2, Nhà thi đấu Tiên Sơn" : "VD: Cửa hàng linh kiện Hoà Khánh"}
                      aria-invalid={errors.destination ? true : undefined}
                      className={FIELD}
                    />
                  </Field>
                )}
              </div>

              <Field id={idOf("reason")} label="Lý do" required error={errors.reason}>
                <textarea
                  id={idOf("reason")}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder={WR_KIND_GIAI_THICH[kind].goiYLyDo}
                  required
                  maxLength={3000}
                  aria-invalid={errors.reason ? true : undefined}
                  className={cn(FIELD, "h-auto resize-y py-2")}
                />
              </Field>
            </section>

            {/* ── BƯỚC 3: TÓM TẮT ──────────────────────────────────────────────────────── */}
            {donTomTat && (
              <section aria-labelledby={idOf("b3")} className="space-y-2">
                <BuocTieuDe id={idOf("b3")} so={3} chu="Kiểm tra trước khi gửi" />
                <div className="space-y-1.5 rounded-xl border border-border bg-muted/40 p-3 text-sm">
                  <p className="text-foreground">
                    <b>Bạn xin:</b> {noiDungXin(donTomTat, { cheDo })}.
                  </p>
                  <p className="text-muted-foreground">
                    <b className="text-foreground">Khi được duyệt:</b> {khiDuyetSe(donTomTat, "bạn", { cheDo })}.
                  </p>
                </div>
              </section>
            )}
          </>
        )}

        <div className="flex flex-col-reverse gap-2 @md:flex-row @md:justify-end">
          <button type="button" className={BTN_OUTLINE} disabled={pending} onClick={onClose}>
            Huỷ
          </button>
          {/* Chưa chọn loại thì KHÔNG vẽ nút Gửi — bấm vào chỉ để ăn lỗi "chọn loại" là lời hứa
              suông (luật 12); người dùng còn tưởng đã gửi được đơn rỗng. */}
          {kind && (
            <button type="button" className={BTN_PRIMARY} onClick={submit} disabled={pending}>
              <Send className="h-4 w-4" aria-hidden /> {pending ? "Đang gửi…" : "Gửi đơn"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BuocTieuDe({ id, so, chu }: { id: string; so: number; chu: string }) {
  return (
    <h4 id={id} className="mb-2 flex items-center gap-2 text-sm font-bold text-foreground">
      <span
        aria-hidden
        className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
      >
        {so}
      </span>
      {chu}
    </h4>
  );
}

/**
 * Đọc lại ngày đã chọn theo dd/mm/yyyy, ngay dưới ô ngày.
 *
 * Vì sao (QA site GV vòng 1, BUG-035 — mang sang khi gộp `main` 07/09/2026):
 * `<input type="date">` hiển thị theo locale của TRÌNH DUYỆT, nên máy đặt tiếng Anh
 * ra "08/28/2026" kèm gợi ý "mm/dd/yyyy" giữa một ứng dụng toàn tiếng Việt. Người
 * quen dd/mm rất dễ gõ 08/09 khi định nói "8 tháng 9" mà hệ hiểu là "9 tháng 8" —
 * với đơn từ thì sai ngày là sai công.
 *
 * KHÔNG tự dựng lịch riêng: `type="date"` đọc được bằng bàn phím, có lịch hệ điều
 * hành trên di động, và trình đọc màn hình hiểu sẵn.
 */
function DocNgay({ value }: { value: string }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {m ? `Ngày đã chọn: ${m[3]}/${m[2]}/${m[1]}` : "Chưa chọn ngày"}
    </p>
  );
}

/** Nhãn + ô + dòng lỗi. Lỗi nằm NGAY DƯỚI ô nó nói tới — không chỉ toast. */
function Field({
  id,
  label,
  hint,
  required,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-foreground">
        {label}
        {required && (
          <span className="text-state-danger-ink" aria-hidden>
            {" "}
            *
          </span>
        )}
      </label>
      {hint && <p className="mb-1 text-xs text-muted-foreground">{hint}</p>}
      {children}
      {error && (
        <p role="alert" className="mt-1 text-xs text-state-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
