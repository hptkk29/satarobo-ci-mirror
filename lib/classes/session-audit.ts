// lib/classes/session-audit.ts — SOÁT dãy buổi học có khớp "ngày khai giảng + lịch học".
//
// VÌ SAO CÓ FILE NÀY (sự cố prod 08/08/2026 — lớp `sata3.15h45-17h15.T7.CS1-201`):
// Buổi học chỉ được XẾP MỘT LẦN (lúc duyệt lớp), sau đó không đường nào tính lại. Lớp
// được tạo 06/08 với ngày khai giảng 26/07 (Chủ nhật) nên buổi đầu rơi vào T7 kế tiếp
// (01/08). Ngày 08/08 admin sửa khai giảng về 27/06 — `endDate` được tính lại nhưng 48
// buổi vẫn nằm nguyên 01/08/2026 → 26/06/2027, lệch đúng 5 tuần. Không có cảnh báo nào,
// và nút "Sinh buổi học" trả "ok" mà không làm gì (đã có buổi ⇒ bỏ qua im lặng).
//
// Hàm ở đây THUẦN (không đụng DB) để test được không cần Postgres và dùng chung được cho
// server action, script rà soát và UI.

import { computePhasedSessionDates, type SchedulePhase } from "@/lib/classes/phases";
import { vnHm } from "@/lib/classes/slots";
import { vnYmd } from "@/lib/time/vn";

export type SessionAuditSeverity =
  /** Khớp lịch. */
  | "OK"
  /** Lớp chưa khai lịch (không đủ dữ kiện để soát). */
  | "NO_SCHEDULE"
  /** Lớp đã/đang chạy mà chưa có buổi nào. */
  | "NO_SESSIONS"
  /** Buổi ĐẦU TIÊN không rơi đúng ngày khai giảng theo lịch — dãy bị neo sai. */
  | "ANCHOR_WRONG"
  /** Neo đúng nhưng có buổi ở giữa lệch (thường do đổi lịch giữa khoá). */
  | "DRIFT";

export interface SessionAuditRow {
  id: string;
  actual: Date;
  /** Ngày lẽ ra phải rơi vào; null = dãy chuẩn không đủ chỗ. */
  expected: Date | null;
  /** true = lệch NGÀY (không chỉ lệch giờ). */
  dateOff: boolean;
  timeOff: boolean;
  /**
   * T03: buổi do NGƯỜI đặt tay (`ClassSession.manualOverride`). Nó KHÔNG tham gia phép so với lịch — lệch lịch là ý đồ, không
   * phải lỗi — và ngày của nó được coi là ngày bị chiếm (các buổi còn lại xếp vòng quanh, giống bộ lập kế hoạch).
   */
  chinhTay?: boolean;
}

export interface SessionSeriesAudit {
  severity: SessionAuditSeverity;
  expectedFirst: Date | null;
  actualFirst: Date | null;
  wrongDateCount: number;
  wrongTimeCount: number;
  /** Số buổi do người đặt tay (không tính vào lệch). */
  soBuoiChinhTay: number;
  /** Vị trí buổi lệch đầu tiên (1-based); 0 = không lệch. */
  firstOffSeq: number;
  /** Câu mô tả tiếng Việt cho UI; null khi OK. */
  message: string | null;
  rows: SessionAuditRow[];
}

export interface SessionAuditInput {
  /** Mốc quét = 00:00 giờ VN của ngày khai giảng. null = lớp chưa có ngày khai giảng. */
  from: Date | null;
  /** Lịch hiệu lực (lớp chưa lập kế hoạch → 1 giai đoạn mở suy từ lịch phẳng). */
  phases: readonly SchedulePhase[];
  /** Ngày nghỉ "YYYY-MM-DD" theo lịch VN. */
  holidays: Set<string>;
  /** Buổi đã sinh, sắp theo ngày tăng dần. */
  sessions: readonly { id: string; date: Date; status: string; manualOverride?: boolean }[];
  /** Trạng thái lớp — để phân biệt "chưa tới lúc sinh buổi" với "quên sinh buổi". */
  classStatus: string;
}

const RUNNING_STATUS = new Set(["ACTIVE", "COMPLETED"]);

const OK: SessionSeriesAudit = {
  severity: "OK",
  expectedFirst: null,
  actualFirst: null,
  wrongDateCount: 0,
  wrongTimeCount: 0,
  soBuoiChinhTay: 0,
  firstOffSeq: 0,
  message: null,
  rows: [],
};

const fmt = (d: Date) => `${vnYmd(d)} ${vnHm(d)}`;

/**
 * So dãy buổi ĐANG CÓ với dãy buổi ĐÚNG (tính từ ngày khai giảng theo lịch, trừ ngày nghỉ).
 *
 * Buổi đã HUỶ không tham gia phép so: nó không chiếm chỗ trong giáo trình và cũng không
 * được sinh lại — đếm vào sẽ báo lệch oan cho toàn bộ phần đuôi.
 */
export function auditSessionSeries(input: SessionAuditInput): SessionSeriesAudit {
  const live = input.sessions
    .filter((s) => s.status !== "CANCELLED")
    .slice()
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const hasSchedule = input.phases.some((p) => p.slots.length > 0);
  if (!hasSchedule || !input.from) {
    return live.length === 0
      ? OK
      : {
          ...OK,
          severity: "NO_SCHEDULE",
          actualFirst: live[0].date,
          message: "Lớp chưa khai đủ ngày khai giảng + lịch học nên không đối chiếu được buổi.",
        };
  }

  if (live.length === 0) {
    // Lớp mới lên kế hoạch thì chưa cần buổi — chỉ báo khi lớp đã/đang chạy.
    if (!RUNNING_STATUS.has(input.classStatus)) return OK;
    return {
      ...OK,
      severity: "NO_SESSIONS",
      message:
        "Lớp đang hoạt động nhưng CHƯA có buổi học nào — bấm “Sinh buổi học” để xếp theo ngày khai giảng.",
    };
  }

  // 27/09/2026 — ngày có buổi ĐÃ HUỶ là ngày lớp KHÔNG học ("Nghỉ & lùi lịch" theo lớp để lại
  // đúng một buổi huỷ ở đó). Chỉ bỏ buổi huỷ khỏi phép so mà vẫn coi ngày của nó là ngày học
  // thì mọi lớp đã nghỉ một buổi bị báo lệch oan cho toàn bộ phần đuôi.
  const ngayKhongHoc = new Set(input.holidays);
  for (const s of input.sessions) if (s.status === "CANCELLED") ngayKhongHoc.add(vnYmd(s.date));

  // T03: buổi do người đặt tay đứng NGOÀI phép so và CHIẾM ngày của nó — đúng cách bộ lập kế hoạch đối xử với buổi khoá. Không
  // làm thế thì một buổi chủ ý dời đi (hoặc thêm tay) bị báo lệch mãi, và nó còn đẩy lệch cả phần đuôi chỉ vì vị trí xếp hạng đổi.
  const chinhTay = live.filter((s) => s.manualOverride === true);
  const theoLich = live.filter((s) => s.manualOverride !== true);
  for (const s of chinhTay) ngayKhongHoc.add(vnYmd(s.date));

  const { dates: expected } = computePhasedSessionDates({
    from: input.from,
    count: theoLich.length,
    phases: input.phases,
    holidays: ngayKhongHoc,
  });

  const rowTheoLich: SessionAuditRow[] = theoLich.map((s, i) => {
    const exp = expected[i] ?? null;
    const dateOff = exp !== null && vnYmd(exp) !== vnYmd(s.date);
    const timeOff = exp !== null && !dateOff && vnHm(exp) !== vnHm(s.date);
    return { id: s.id, actual: s.date, expected: exp, dateOff, timeOff };
  });
  const rowChinhTay: SessionAuditRow[] = chinhTay.map((s) => ({
    id: s.id,
    actual: s.date,
    expected: null,
    dateOff: false,
    timeOff: false,
    chinhTay: true,
  }));
  // Hiển thị theo thứ tự ngày thật của cả dãy.
  const rows = [...rowTheoLich, ...rowChinhTay].sort((a, b) => a.actual.getTime() - b.actual.getTime());

  const wrongDateCount = rows.filter((r) => r.dateOff).length;
  const wrongTimeCount = rows.filter((r) => r.timeOff).length;
  const firstOff = rows.findIndex((r) => r.dateOff || r.timeOff);
  const expectedFirst = expected[0] ?? null;
  const actualFirst = theoLich[0]?.date ?? live[0].date;
  const soBuoiChinhTay = chinhTay.length;

  if (wrongDateCount === 0 && wrongTimeCount === 0) {
    return { ...OK, expectedFirst, actualFirst, soBuoiChinhTay, rows };
  }

  // Neo sai = buổi ĐẦU TIÊN THEO LỊCH (bỏ buổi chỉnh tay) lệch ngày.
  const anchorWrong = rowTheoLich[0]?.dateOff === true;
  const base: SessionSeriesAudit = {
    severity: anchorWrong ? "ANCHOR_WRONG" : "DRIFT",
    expectedFirst,
    actualFirst,
    wrongDateCount,
    wrongTimeCount,
    soBuoiChinhTay,
    firstOffSeq: firstOff + 1,
    message: null,
    rows,
  };

  if (anchorWrong) {
    return {
      ...base,
      message:
        `Buổi 1 đang là ${fmt(actualFirst)} nhưng theo ngày khai giảng + lịch học phải là ` +
        `${expectedFirst ? fmt(expectedFirst) : "?"} — cả dãy ${live.length} buổi bị neo sai ` +
        `(${wrongDateCount} buổi lệch ngày). Bấm “Xếp lại buổi theo lịch” để sửa.`,
    };
  }
  return {
    ...base,
    message:
      `Buổi ${base.firstOffSeq} trở đi lệch so với lịch hiện tại ` +
      `(${wrongDateCount} buổi lệch ngày, ${wrongTimeCount} buổi lệch giờ). ` +
      `Thường gặp khi lớp đổi lịch giữa khoá — kiểm tra rồi xếp lại nếu cần.`,
  };
}
