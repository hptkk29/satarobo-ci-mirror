// lib/hoc-bu/toan-ven.ts — KIỂM TOÀN VẸN DỮ LIỆU HỌC BÙ (T01, 07/10/2026). THUẦN, không chạm DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TÁCH THUẦN: hai nửa của checker có hai cách hỏng khác nhau.
//   · NỬA ĐỌC (`toan-ven-db.ts`) hỏng khi schema đổi — `tsc` bắt, DB test bắt.
//   · NỬA LUẬT (file này) hỏng khi LUẬT sai — ca "dữ liệu mẫu → đúng mã lỗi" bắt, không cần Postgres.
// Gộp làm một thì mỗi ca test phải dựng cả đồ thị bản ghi, và ca nào thiếu fixture thì lặng lẽ
// không bao giờ chạm tới luật nó định canh.
//
// ─────────────────────────────────────────────────────────────────────────────
// NGUYÊN TẮC (chốt 07/10/2026, mục 11 của bản duyệt):
//   · CHỈ ĐỌC. Không luật nào ghi, không luật nào "sửa luôn".
//   · KHÔNG ĐOÁN trạng thái lịch sử. Muốn nói "AUTO_FIXABLE" thì phải có BẰNG CHỨNG trong dữ liệu
//     (nhật ký audit), không phải một suy luận hợp lý. Không đủ bằng chứng ⇒ NEEDS_MANUAL_REVIEW.
//   · Luật nào CHƯA chạy được (vì phần nền chưa có) thì khai rõ ở `LUAT_HOAN` kèm task sẽ làm —
//     báo cáo in chúng ra. Báo cáo im lặng về một luật chưa chạy trông y hệt "luật chạy và sạch".
//
// Phân loại mỗi phát hiện (cùng bộ từ với kế hoạch di trú):
//   SAFE                 — chỉ để biết, không cần làm gì
//   AUTO_FIXABLE         — có phép sửa tất định, an toàn; script vá (T15) được phép làm sau khi duyệt
//   NEEDS_MANUAL_REVIEW  — có người phải nhìn vào và quyết
//   INVALID              — bản ghi không thể hợp lệ ở trạng thái này; phải huỷ/khôi phục có lý do
import { buoiBuTuCase, lechSoVoiBanChot, type BuoiBuTrongKy } from "@/lib/cham-cong/buoi-bu-ky";
import { overlaps, type Slot } from "@/lib/lms/scheduling";
import { vnDateAt, vnYmd } from "@/lib/time/vn";

export type MucNghiemTrong = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type PhanLoai = "SAFE" | "AUTO_FIXABLE" | "NEEDS_MANUAL_REVIEW" | "INVALID";

export type ThucThe =
  | "MakeupNeed"
  | "MakeupCase"
  | "MakeupCaseStudent"
  | "Attendance"
  | "ClassSession"
  | "OrderItem"
  | "ParentRequest"
  | "MakeupCreditAccount";

// ─── Danh mục luật ───────────────────────────────────────────────────────────────────────────

/** Luật ĐANG chạy. Thêm luật mới = thêm một dòng ở đây + một hàm bên dưới + một ca test. */
export const LUAT = {
  "TV-01": "Dòng cần bù mồ côi buổi vắng gốc (buổi đã bị xoá)",
  "TV-02": "Dòng cần bù trỏ bài không còn tồn tại",
  "TV-03": "Bài của dòng cần bù thiếu hoặc lệch buổi gốc",
  "TV-04": "Dòng cần bù trỏ dòng phí không còn tồn tại",
  "TV-05": "Đơn phí đã huỷ/hoàn/xoá nhưng dòng đã vào case hoặc đã bù xong",
  "TV-06": "Vừa miễn phí ngoại lệ vừa còn đơn phí sống chưa thu đủ",
  "TV-07": "Đơn phí bù mồ côi (không dòng nào trỏ tới) mà vẫn đang sống",
  "TV-08": "Buổi vắng chưa có dòng cần bù",
  "TV-09": "Dòng chờ bù của khoá TẮT học bù (vô hình trên màn)",
  "TV-10": "Case không còn bé nào nhưng vẫn \"sắp dạy\"",
  "TV-11": "Case kẹt: hết bé chờ điểm danh nhưng chưa được chốt",
  "TV-12": "Case ở tương lai nhưng đã có bé được điểm danh",
  "TV-13": "Case quá giờ mà còn bé chưa điểm danh",
  "TV-14": "Bé trong case lệch nhóm so với case (cơ sở / khoá / bài)",
  "TV-15": "Trạng thái dòng cần bù lệch với bản ghi trong case",
  "TV-16": "Dòng đã bù xong nhưng không có buổi bù có mặt tương ứng",
  "TV-17": "Cờ đã dùng lượt lệch trạng thái dòng / bản ghi trong case",
  "TV-18": "Case trỏ giáo viên / phòng / bài / khoá không còn hoặc không hoạt động",
  "TV-19": "Bé đang chờ trong case thuộc lớp đã huỷ hoặc xoá",
  "TV-20": "Buổi gốc đã bị ghi đè sang \"có mặt\" sau khi bù",
  "TV-21": "Nhãn học bù trên điểm danh gốc lệch với dòng cần bù",
  "TV-22": "Dòng đã bù xong nhưng buổi gốc không có bản ghi điểm danh",
  "TV-23": "Buổi lớp trùng (cùng lớp, cùng thời điểm)",
  "TV-24": "Buổi lớp trùng ngày (cùng lớp, hai buổi trong một ngày)",
  "TV-25": "Case trùng giờ giáo viên",
  "TV-26": "Case trùng giờ phòng",
  "TV-27": "Case trùng lịch học của học viên",
  "TV-28": "Đơn xin bù của phụ huynh còn mở nhưng dòng không còn chờ",
  "TV-30": "Khoá lưu trên dòng cần bù lệch khoá của lớp",
  "TV-31": "Dòng nguồn ABSENCE chưa liên kết đúng điểm danh gốc",
  "TV-32": "Số trên tài khoản lượt bù khác tổng bút toán của nó",
  "TV-33": "Lượt ĐANG GIỮ trên sổ lệch số mục case đang chờ bằng lượt",
  "TV-34": "Lượt ĐÃ TIÊU trên sổ lệch số dòng đã bù bằng lượt",
  "TV-35": "Học viên đang giữ/đã tiêu lượt bù nhưng chưa có tài khoản trong sổ",
  "TV-40": "Case chưa được nâng lên mô hình nhiều bài (thiếu bộ bài / bé tham gia / mục chưa nối bé)",
  "TV-41": "Hai tầng điểm danh (bé ↔ bài) lệch nhau",
  "TV-42": "Bộ bài của case sai luật hoặc mục mang bài ngoài bộ bài",
  "TV-43": "Trạng thái case không khớp trạng thái chốt suy từ các bé",
  "TV-51": "Học viên không còn ghi danh hiệu lực ở khoá nhưng vẫn còn nợ buổi bù / đang xếp case (nghỉ học · chuyển đi · đã hoàn thành khoá)",
  "TV-50": "Đã xếp case / đã bù bằng phí nhưng phí thu thiếu (hoàn một phần) — suất không còn cơ sở tiền",
  "TV-93": "Công dạy bù ngoài bản chốt kỳ công (kỳ đã chốt không khớp các case đã dạy)",
} as const;
export type MaLuat = keyof typeof LUAT;

/** Luật CHƯA chạy, và vì sao. Báo cáo in ra — im lặng là nói dối. */
export const LUAT_HOAN = [
  {
    ma: "TV-91",
    ten: "Khung ca tuần lệch lưới phân ca tháng",
    task: "T04",
    lyDo: "Cần bản xem trước của bộ sinh lưới sau khi gom ba đường ghi ô ca về một service.",
  },
  {
    ma: "TV-92",
    ten: "Buổi lớp tương lai lệch mẫu lịch (ClassSchedulePhase)",
    task: "T03",
    lyDo: "Cần cờ manualOverride để phân biệt buổi chỉnh tay với buổi lệch thật.",
  },
] as const;

export type Finding = {
  luat: MaLuat;
  nghiemTrong: MucNghiemTrong;
  phanLoai: PhanLoai;
  thucThe: ThucThe;
  id: string;
  hocVien?: string;
  lyDo: string;
  deXuat: string;
  /** Id liên quan (buổi, case, đơn…) — cho script vá và cho người đọc lần theo. */
  lienQuan?: Record<string, string>;
};

// ─── Hình dạng dữ liệu đầu vào ───────────────────────────────────────────────────────────────

export type NeedRow = {
  id: string;
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
  courseId: string;
  choPhepHocBu: boolean;
  lopDaXoa: boolean;
  lopDaHuy: boolean;
  centerId: string | null;
  missedSessionId: string;
  missedLessonId: string | null;
  status: "PENDING" | "SCHEDULED" | "COMPLETED" | "CANCELLED";
  makeupSessionId: string | null;
  usedQuota: boolean;
  waivedAt: Date | null;
  feeOrderItemId: string | null;
  freeApprovedAt: Date | null;
  createdAt: Date;
  /** Lúc dòng được chốt COMPLETED — mốc chặn bằng chứng audit của TV-20 (nhật ký SAU mốc đã mang trạng thái bị ghi đè). */
  completedAt: Date | null;
  /** T05 — nguồn của dòng. SYSTEM_MIGRATION = mọi dòng có TRƯỚC T05 (chưa phân loại — T15). */
  sourceType: "ABSENCE" | "ORDER_CONVERSION" | "MANUAL" | "SYSTEM_MIGRATION" | "OTHER";
  /**
   * Nhãn nguồn của chương trình BẢO LƯU (`MakeupNeed.nguon`). `PHUC_HOC` (BR-22) = buổi bù sinh khi phục học vào lớp đi trước: bé CHƯA TỪNG vào buổi đó
   * nên KHÔNG có điểm danh gốc theo thiết kế (như ORDER_CONVERSION), và miễn phí (không lượt, không phí). BẮT BUỘC khai (luật 7).
   */
  nguon: string | null;
  /** T05 — điểm danh gốc làm phát sinh dòng (null với ORDER_CONVERSION/MANUAL và dòng cũ chưa liên kết). */
  originalAttendanceId: string | null;
  /** T05 — khoá LƯU trên dòng (cột `MakeupNeed.courseId`); `courseId` ở trên là khoá của LỚP. Hai số này phải bằng nhau (TV-30). */
  courseIdCuaDong: string;
};

/** T06 — một tài khoản lượt bù kèm TỔNG bút toán của nó (hai số phải bằng nhau — TV-32). */
export type SoLuotRow = {
  id: string;
  studentId: string;
  studentName: string;
  courseId: string;
  granted: number;
  held: number;
  consumed: number;
  tongBut: { granted: number; held: number; consumed: number };
};

export type CaseStudentRow = {
  id: string;
  makeupNeedId: string;
  status: "PLACED" | "PRESENT" | "ABSENT";
  dungLuot: boolean;
  /** T07 — mục thuộc bé tham gia nào (null = mục đời cũ chưa nâng cấp). Mục đã GỠ (status RELEASED) không được đưa vào đây. */
  participantId?: string | null;
  /** T07 — kết quả tầng 2 của mục. */
  result?: "PLANNED" | "COMPLETED" | "NOT_COMPLETED" | "RELEASED";
  /** T07 — bài của mục (chụp từ dòng cần bù lúc xếp). */
  lessonId?: string | null;
};

/** T07 — bé tham gia case (tầng 1 của điểm danh). */
export type ParticipantRow = {
  id: string;
  studentId: string;
  attendanceStatus: "PENDING" | "PRESENT" | "ABSENT" | "REMOVED";
};

export type CaseRow = {
  id: string;
  centerId: string;
  courseId: string;
  lessonId: string;
  /** Nửa đêm UTC của ngày VN (hình dạng cột `@db.Date`). */
  date: Date;
  startTime: string;
  endTime: string;
  roomId: string | null;
  teacherId: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  students: CaseStudentRow[];
  /** T07 — bộ bài của case theo thứ tự (rỗng/undefined = case đời cũ chưa nâng cấp: coi như chỉ có `lessonId`). */
  lessonIds?: readonly string[];
  /** T07 — bé tham gia (undefined = case đời cũ chưa nâng cấp). */
  participants?: readonly ParticipantRow[];
};

export type SessionRef = {
  id: string;
  classId: string;
  date: Date;
  lessonId: string | null;
  status: string;
};

export type AttendanceRow = {
  id: string;
  sessionId: string;
  studentId: string;
  status: string;
  makeupStatus: "NONE" | "NEEDS_MAKEUP" | "MADE_UP";
};

export type VangChuaCoDong = {
  sessionId: string;
  studentId: string;
  studentName: string;
  className: string;
  status: string;
  /** MADE_UP = nhân viên đã đánh dấu "đã học bù" ngay ở lưới điểm danh — hợp lệ, không cần dòng cần bù. */
  makeupStatus: "NONE" | "NEEDS_MAKEUP" | "MADE_UP";
  ngayVn: string;
  choPhepHocBu: boolean;
  lopDaXoa: boolean;
};

export type DonPhi = {
  itemId: string;
  orderId: string;
  orderCode: string;
  orderStatus: string;
  orderDaXoa: boolean;
  tongTien: number;
  daThu: number;
  /** Đơn còn sống = chưa huỷ / hoàn / xoá. */
};

export type DonPhiMoCoi = DonPhi & { hocVienId: string | null; tenDong: string };

export type DonPhHuyMo = {
  id: string;
  studentId: string;
  sessionId: string | null;
  status: string;
};

export type NhomBuoiTrung = {
  classId: string;
  /** Thời điểm trùng (ISO) — nhóm theo (lớp, thời điểm). */
  luc: string;
  buoi: {
    id: string;
    soDiemDanh: number;
    soNhanXet: number;
    /** Số bản ghi KHÁC trỏ vào buổi (bài tập, ảnh, đánh giá, đơn phụ huynh, dòng cần bù, dấu học bù cũ…). */
    soThamChieu: number;
    trangThai: string;
    taoLuc: Date;
  }[];
};

export type NhomBuoiTrungNgay = {
  classId: string;
  ngayVn: string;
  buoiIds: string[];
};

export type SessionSlot = Slot & { classId: string; id: string };

/** Một lần admin sửa điểm danh của một bé: trạng thái TRƯỚC (`cu`) và SAU (`moi`); null = bé không có trong ảnh chụp. */
export type BangChungDiemDanh = { luc: Date; cu: string | null; moi: string | null };

export type Snapshot = {
  needs: NeedRow[];
  cases: CaseRow[];
  /** Buổi gốc của các dòng cần bù. */
  buoiGoc: SessionRef[];
  lessonIdsConTon: Set<string>;
  roomIdsConTon: Set<string>;
  courseIdsConTon: Set<string>;
  /** Giáo viên của case: id → còn hoạt động không. Vắng khoá = không tìm thấy user. */
  gvHoatDong: Map<string, boolean>;
  diemDanh: AttendanceRow[];
  vangChuaCoDong: VangChuaCoDong[];
  donPhi: DonPhi[];
  donPhiMoCoi: DonPhiMoCoi[];
  donPh: DonPhHuyMo[];
  buoiTrung: NhomBuoiTrung[];
  buoiTrungNgay: NhomBuoiTrungNgay[];
  /** Slot các buổi lớp ở cửa sổ ngày của các case — dựng bằng `rowsToSlots` ở nửa đọc. */
  slotBuoi: SessionSlot[];
  /** studentId → các lớp đang học. */
  lopCuaHocVien: Map<string, string[]>;
  /**
   * Nhật ký sửa điểm danh theo `${sessionId}|${studentId}`, xếp THEO THỜI GIAN. Chỉ nhật ký
   * `attendance.edited` (admin) mang giá trị cũ/mới; đường điểm danh của giáo viên chỉ ghi `{count}`
   * và điểm danh bù (chính thứ bị cáo buộc ghi đè) không ghi audit. Vì vậy chỉ nhật ký TRƯỚC
   * `completedAt` của dòng mới nói được trạng thái trước lúc bị ghi đè.
   */
  bangChungVangGoc: Map<string, BangChungDiemDanh[]>;
  /** T06 — sổ lượt: mọi tài khoản + tổng bút toán. */
  soLuot: SoLuotRow[];
  /** T14 — các cặp `${studentId}|${courseId}` CÒN ghi danh hiệu lực (ACTIVE · CONFIRMED · STUDYING · PAUSED, chưa xoá mềm) — suy từ chính các dòng cần bù. */
  ghiDanhHieuLuc: Set<string>;
  /** T12 — mọi kỳ công ĐÃ CHỐT và các buổi bù mà bản chốt ghi (undefined = bản chốt cũ không có trường `buoiBu`). */
  kyDaChot: KyDaChotRow[];
};

export type KyDaChotRow = {
  centerId: string;
  /** "YYYY-MM". */
  periodKey: string;
  banChotBuoiBu: readonly BuoiBuTrongKy[] | undefined;
};

export type TuyChon = {
  now: Date;
  /** Chỉ xét buổi vắng / case từ ngày này (YYYY-MM-DD, giờ VN). */
  tuNgayYmd: string;
};

export type KetQua = {
  findings: Finding[];
  /** Luật nào đã chạy và ra bao nhiêu — kể cả luật ra 0. */
  demTheoLuat: Record<MaLuat, number>;
  /** Số dòng luồng cũ (có `makeupSessionId`) bị bỏ qua có chủ đích. */
  boQuaLuongCu: number;
};

// ─── Tiện ích ────────────────────────────────────────────────────────────────────────────────

const laVang = (status: string) => status !== "PRESENT" && status !== "LATE";
const khoa = (a: string, b: string) => `${a}|${b}`;
const NGHIEM_TRONG: Record<MucNghiemTrong, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const ymdCuaCase = (c: CaseRow) => c.date.toISOString().slice(0, 10);

function gioCase(c: CaseRow): { startAt: Date; endAt: Date } {
  const [y, m, d] = ymdCuaCase(c).split("-").map(Number);
  const [sh, sm] = c.startTime.split(":").map(Number);
  const [eh, em] = c.endTime.split(":").map(Number);
  return {
    startAt: vnDateAt(y!, m! - 1, d!, sh!, sm!),
    endAt: vnDateAt(y!, m! - 1, d!, eh!, em!),
  };
}

/** Dựng một phát hiện — chỗ duy nhất, để sau này thêm trường chung (vd. cờ ngoại lệ) không phải sửa 30 nơi. */
function tao(f: Finding): Finding {
  return f;
}

// ─── Các luật ────────────────────────────────────────────────────────────────────────────────

type Ctx = {
  s: Snapshot;
  o: TuyChon;
  needTheoId: Map<string, NeedRow>;
  buoiTheoId: Map<string, SessionRef>;
  phiTheoItem: Map<string, DonPhi>;
  diemDanhTheoCap: Map<string, AttendanceRow>;
  caseSVTheoNeed: Map<string, { c: CaseRow; sv: CaseStudentRow }[]>;
  donPhiThamChieu: Set<string>;
};

function donPhiConSong(p: DonPhi): boolean {
  return !p.orderDaXoa && p.orderStatus !== "CANCELLED" && p.orderStatus !== "REFUNDED";
}

function dungCtx(s: Snapshot, o: TuyChon): Ctx {
  const caseSVTheoNeed = new Map<string, { c: CaseRow; sv: CaseStudentRow }[]>();
  for (const c of s.cases) {
    for (const sv of c.students) {
      const ds = caseSVTheoNeed.get(sv.makeupNeedId) ?? [];
      ds.push({ c, sv });
      caseSVTheoNeed.set(sv.makeupNeedId, ds);
    }
  }
  return {
    s,
    o,
    needTheoId: new Map(s.needs.map((n) => [n.id, n])),
    buoiTheoId: new Map(s.buoiGoc.map((b) => [b.id, b])),
    phiTheoItem: new Map(s.donPhi.map((p) => [p.itemId, p])),
    diemDanhTheoCap: new Map(s.diemDanh.map((a) => [khoa(a.studentId, a.sessionId), a])),
    caseSVTheoNeed,
    donPhiThamChieu: new Set(s.needs.map((n) => n.feeOrderItemId).filter((x): x is string => !!x)),
  };
}

/** Dòng của luồng CŨ (xếp vào buổi lớp khác) — không có bản ghi trong case, nên luật case bỏ qua. */
const laLuongCu = (n: NeedRow) => n.makeupSessionId !== null;

function luatMoCoiBuoi({ s, buoiTheoId }: Ctx): Finding[] {
  return s.needs
    .filter((n) => !buoiTheoId.has(n.missedSessionId))
    .map((n) =>
      tao({
        luat: "TV-01",
        nghiemTrong: "HIGH",
        phanLoai: "INVALID",
        thucThe: "MakeupNeed",
        id: n.id,
        hocVien: n.studentName,
        lyDo: `Buổi vắng gốc ${n.missedSessionId} không còn (bị xoá). Dòng mất nhãn buổi, không còn gì để nối lại.`,
        deXuat: "Huỷ có lý do ở /hoc-bu nếu dòng đang chờ; nếu đã vào case thì gỡ khỏi case trước. Không tự xoá dòng.",
        lienQuan: { buoiGoc: n.missedSessionId, lop: n.classId },
      }),
    );
}

function luatBai({ s, buoiTheoId }: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const n of s.needs) {
    if (n.status === "CANCELLED") continue;
    const buoi = buoiTheoId.get(n.missedSessionId);
    if (n.missedLessonId && !s.lessonIdsConTon.has(n.missedLessonId)) {
      out.push(
        tao({
          luat: "TV-02",
          nghiemTrong: "HIGH",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupNeed",
          id: n.id,
          hocVien: n.studentName,
          lyDo: `Bài ${n.missedLessonId} của dòng không còn trong giáo trình — không gom được vào case.`,
          deXuat: "Đối chiếu buổi gốc: nếu buổi vẫn trỏ một bài còn sống thì cập nhật bài; nếu không, người quản lý quyết.",
          lienQuan: { bai: n.missedLessonId, buoiGoc: n.missedSessionId },
        }),
      );
      continue;
    }
    // Dòng đã bù xong và dòng luồng CŨ không bao giờ vào bước gom case — "thiếu / lệch bài" vô nghĩa với
    // chúng, mà báo ra thì bắt người dọn sửa lịch sử của một dòng đã đóng. TV-02 (con trỏ hỏng) ở trên vẫn chạy.
    if (n.status === "COMPLETED" || laLuongCu(n)) continue;
    if (!buoi) continue; // TV-01 đã báo
    if (n.missedLessonId === null) {
      const coBaiGoc = buoi.lessonId !== null && s.lessonIdsConTon.has(buoi.lessonId);
      out.push(
        tao({
          luat: "TV-03",
          nghiemTrong: "MEDIUM",
          phanLoai: coBaiGoc ? "AUTO_FIXABLE" : "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupNeed",
          id: n.id,
          hocVien: n.studentName,
          lyDo: coBaiGoc
            ? "Dòng chưa ghi bài nhưng buổi gốc đã có bài — không gom được vào case."
            : "Cả dòng lẫn buổi gốc đều chưa có bài — dòng không bao giờ xếp được vào case.",
          deXuat: coBaiGoc
            ? `Điền missedLessonId = ${buoi.lessonId} (điền chỗ trống, không đổi giá trị đã có).`
            : "Gán bài cho buổi gốc ở màn buổi học, rồi điền lại bài cho dòng.",
          lienQuan: { buoiGoc: n.missedSessionId, ...(buoi.lessonId ? { baiBuoiGoc: buoi.lessonId } : {}) },
        }),
      );
    } else if (buoi.lessonId !== null && buoi.lessonId !== n.missedLessonId) {
      out.push(
        tao({
          luat: "TV-03",
          nghiemTrong: "MEDIUM",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupNeed",
          id: n.id,
          hocVien: n.studentName,
          lyDo: `Bài của dòng (${n.missedLessonId}) khác bài hiện tại của buổi gốc (${buoi.lessonId}) — buổi đã đổi bài sau khi dòng được tạo.`,
          deXuat: "Người quản lý chọn bài đúng; dòng đã vào case thì kiểm lại nhóm bài của case.",
          lienQuan: { buoiGoc: n.missedSessionId, baiDong: n.missedLessonId, baiBuoiGoc: buoi.lessonId },
        }),
      );
    }
  }
  return out;
}

function luatPhi({ s, phiTheoItem, donPhiThamChieu, caseSVTheoNeed }: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const n of s.needs) {
    if (!n.feeOrderItemId) continue;
    const p = phiTheoItem.get(n.feeOrderItemId);
    if (!p) {
      out.push(
        tao({
          luat: "TV-04",
          nghiemTrong: "HIGH",
          phanLoai: "INVALID",
          thucThe: "MakeupNeed",
          id: n.id,
          hocVien: n.studentName,
          lyDo: `Dòng trỏ đơn phí ${n.feeOrderItemId} không còn trong bảng đơn. Màn đọc ra "chưa có phí" và cho tạo thêm một đơn thứ hai.`,
          deXuat: "Kiểm tra đơn có bị xoá cứng không; nếu phí đã thu thì phải đối soát với kế toán trước khi gỡ con trỏ.",
          lienQuan: { dongPhi: n.feeOrderItemId },
        }),
      );
      continue;
    }
    const song = donPhiConSong(p);
    // Phí chỉ là CƠ SỞ xếp bé khi bé không được miễn phí và không vào case bằng lượt. Nếu có lượt/miễn phí
    // thì đơn phí chết chỉ là con trỏ cũ vô hại — đừng bắt người dọn gỡ bé khỏi case mà bé có quyền ở đó.
    const hangCase = (caseSVTheoNeed.get(n.id) ?? []).find((x) => x.sv.status !== "ABSENT");
    const phiKhongLaCoSo = n.freeApprovedAt !== null || hangCase?.sv.dungLuot === true;
    if (!song && phiKhongLaCoSo && (n.status === "SCHEDULED" || n.status === "COMPLETED")) {
      out.push(
        tao({
          luat: "TV-05",
          nghiemTrong: "LOW",
          phanLoai: "SAFE",
          thucThe: "MakeupNeed",
          id: n.id,
          hocVien: n.studentName,
          lyDo: `Đơn phí ${p.orderCode} đã huỷ/hoàn/xoá nhưng bé ${n.freeApprovedAt !== null ? "được miễn phí" : "vào case bằng lượt"} — con trỏ phí cũ vô hại.`,
          deXuat: "Không cần làm gì; T06 sẽ gỡ con trỏ khi đưa phí vào sổ.",
          lienQuan: { donPhi: p.orderId },
        }),
      );
    } else if (!song && (n.status === "SCHEDULED" || n.status === "COMPLETED")) {
      out.push(
        tao({
          luat: "TV-05",
          nghiemTrong: "HIGH",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupNeed",
          id: n.id,
          hocVien: n.studentName,
          lyDo: `Đơn phí ${p.orderCode} đã ${p.orderDaXoa ? "bị xoá" : p.orderStatus === "REFUNDED" ? "hoàn tiền" : "huỷ"} nhưng dòng đang ở trạng thái ${n.status}${n.status === "SCHEDULED" ? " (bé vẫn nằm trong case)" : " (đã học)"}.`,
          deXuat:
            n.status === "SCHEDULED"
              ? "Quyết định nghiệp vụ 07/10: bé chưa học phải được gỡ khỏi case và dòng về chờ phí. Làm ở T06, không tự sửa ở đây."
              : "Bé đã học: không đảo kết quả. Ghi nhận ngoại lệ tài chính cho kế toán.",
          lienQuan: { donPhi: p.orderId, trangThaiDon: p.orderDaXoa ? "DELETED" : p.orderStatus },
        }),
      );
    } else if (!song && n.status === "PENDING") {
      out.push(
        tao({
          luat: "TV-05",
          nghiemTrong: "LOW",
          phanLoai: "SAFE",
          thucThe: "MakeupNeed",
          id: n.id,
          hocVien: n.studentName,
          lyDo: `Đơn phí ${p.orderCode} đã huỷ/hoàn; dòng còn chờ nên tự về "cần thu phí" ở lần đọc kế tiếp.`,
          deXuat: "Không cần làm gì.",
          lienQuan: { donPhi: p.orderId },
        }),
      );
    }
    // T14 — phí đã thu bị hoàn MỘT PHẦN: đơn vẫn sống (TV-05 không bắt) nhưng đã thu < tổng ⇒ suất xếp case / đã học bằng phí mất cơ sở tiền. "Đủ điều kiện" là
    // `đã thu ≥ tổng` (cùng phép với danh sách), không chỉ trạng thái đơn.
    if (song && n.freeApprovedAt === null && !phiKhongLaCoSo && p.daThu < p.tongTien && (n.status === "SCHEDULED" || n.status === "COMPLETED")) {
      const chuaHoc = n.status === "SCHEDULED";
      out.push(
        tao({
          luat: "TV-50",
          nghiemTrong: chuaHoc ? "HIGH" : "MEDIUM",
          phanLoai: chuaHoc ? "AUTO_FIXABLE" : "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupNeed",
          id: n.id,
          hocVien: n.studentName,
          lyDo: `Phí ${p.orderCode} mới thu ${p.daThu.toLocaleString("vi-VN")}đ / ${p.tongTien.toLocaleString("vi-VN")}đ (đã bị hoàn một phần) nhưng dòng đang ở trạng thái ${n.status}${chuaHoc ? " — bé vẫn nằm trong case chưa học" : " — bé đã học"}.`,
          deXuat: chuaHoc
            ? "Chạy lại xét hoàn một phần cho đơn này (`xetLaiHoanMotPhan`): gỡ bé khỏi case, dòng về chờ thu phí, báo Sale thu bổ sung. Có dry-run ở T15."
            : "Bé đã học: không đảo kết quả. Kế toán đối soát khoản hoàn (thu bổ sung hay ghi nhận ngoại lệ).",
          lienQuan: { donPhi: p.orderId, daThu: String(p.daThu), tongTien: String(p.tongTien) },
        }),
      );
    }
    if (song && n.freeApprovedAt !== null && p.daThu < p.tongTien) {
      out.push(
        tao({
          luat: "TV-06",
          nghiemTrong: "MEDIUM",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupNeed",
          id: n.id,
          hocVien: n.studentName,
          lyDo: `Dòng đã được MIỄN PHÍ nhưng đơn phí ${p.orderCode} (${p.tongTien.toLocaleString("vi-VN")}đ) còn sống, mới thu ${p.daThu.toLocaleString("vi-VN")}đ — phụ huynh vẫn quét QR đóng được.`,
          deXuat: "Huỷ đơn phí chưa thu (nếu đã thu thì hoàn qua kế toán). Thao tác ở T06.",
          lienQuan: { donPhi: p.orderId },
        }),
      );
    }
  }
  for (const p of s.donPhiMoCoi) {
    if (donPhiThamChieu.has(p.itemId) || !donPhiConSong(p)) continue;
    out.push(
      tao({
        luat: "TV-07",
        nghiemTrong: "HIGH",
        phanLoai: "NEEDS_MANUAL_REVIEW",
        thucThe: "OrderItem",
        id: p.itemId,
        lyDo: `Đơn phí bù ${p.orderCode} (${p.tongTien.toLocaleString("vi-VN")}đ, ${p.orderStatus}) không dòng cần bù nào trỏ tới nhưng vẫn sống — có phiếu thu + QR, phụ huynh trả được tiền vào đơn không ai thấy.${p.daThu > 0 ? ` ĐÃ THU ${p.daThu.toLocaleString("vi-VN")}đ.` : ""}`,
        deXuat: "Đối chiếu với dòng cần bù cùng học viên: thường là đơn thừa do bấm tạo phí hai lần. Chưa thu thì huỷ; đã thu thì kế toán quyết.",
        lienQuan: { donPhi: p.orderId, ...(p.hocVienId ? { hocVien: p.hocVienId } : {}) },
      }),
    );
  }
  return out;
}

function luatBuoiVangChuaCoDong({ s }: Ctx): Finding[] {
  const dongCoSan = new Set(s.needs.map((n) => khoa(n.studentId, n.missedSessionId)));
  return s.vangChuaCoDong
    // MADE_UP: nhân viên đã đánh dấu "đã học bù" ngay ở lưới điểm danh — hợp lệ và KHÔNG sinh dòng
    // (cùng định nghĩa với scripts/bu-vang-tu-ngay.ts, chính script mà đề xuất bên dưới trỏ tới).
    .filter(
      (v) =>
        v.choPhepHocBu &&
        !v.lopDaXoa &&
        v.makeupStatus !== "MADE_UP" &&
        !dongCoSan.has(khoa(v.studentId, v.sessionId)),
    )
    .map((v) =>
      tao({
        luat: "TV-08",
        nghiemTrong: "MEDIUM",
        phanLoai: "AUTO_FIXABLE",
        thucThe: "Attendance",
        id: `${v.sessionId}|${v.studentId}`,
        hocVien: v.studentName,
        lyDo: `Vắng (${v.status}) buổi ${v.ngayVn} lớp ${v.className} nhưng không có dòng cần bù — học viên không lên màn Học bù.`,
        deXuat: "Tạo dòng cần bù (scripts/bu-vang-tu-ngay.ts đã làm đúng việc này, có --expect).",
        lienQuan: { buoiGoc: v.sessionId, hocVien: v.studentId },
      }),
    );
}

function luatKhoaTat({ s }: Ctx): Finding[] {
  return s.needs
    .filter((n) => n.status === "PENDING" && !n.choPhepHocBu && !n.lopDaXoa)
    .map((n) =>
      tao({
        luat: "TV-09",
        nghiemTrong: "LOW",
        phanLoai: "SAFE",
        thucThe: "MakeupNeed",
        id: n.id,
        hocVien: n.studentName,
        lyDo: "Khoá của lớp TẮT học bù nên dòng này không hiện trên màn — tồn tại nhưng vô hình.",
        deXuat: "Không cần làm gì; nếu khoá được bật lại học bù thì dòng hiện ra.",
        lienQuan: { lop: n.classId },
      }),
    );
}

function luatCase({ s, o, needTheoId }: Ctx): Finding[] {
  const out: Finding[] = [];
  const homNay = vnYmd(o.now);
  for (const c of s.cases) {
    const choDiem = c.students.filter((x) => x.status === "PLACED");
    const daDiem = c.students.filter((x) => x.status !== "PLACED");
    if (c.status === "SCHEDULED") {
      if (c.students.length === 0) {
        out.push(
          tao({
            luat: "TV-10",
            nghiemTrong: "HIGH",
            phanLoai: "AUTO_FIXABLE",
            thucThe: "MakeupCase",
            id: c.id,
            lyDo: "Case đang \"sắp dạy\" nhưng không còn bé nào — hiện trên lịch giáo viên, không ai dạy.",
            deXuat: "Đặt CANCELLED (đúng phép huỷ case: không bé nào cần trả về hàng chờ).",
            lienQuan: { giaoVien: c.teacherId },
          }),
        );
      } else if (choDiem.length === 0) {
        const coMat = c.students.some((x) => x.status === "PRESENT");
        out.push(
          tao({
            luat: "TV-11",
            nghiemTrong: "CRITICAL",
            phanLoai: "AUTO_FIXABLE",
            thucThe: "MakeupCase",
            id: c.id,
            lyDo: `Mọi bé đã điểm danh (${c.students.length}) nhưng case vẫn "sắp dạy" — không bao giờ sinh công dạy cho giáo viên và không có nút nào thoát được.`,
            deXuat: `Chốt đúng như phép đóng case: ${coMat ? "COMPLETED (có ít nhất một bé có mặt)" : "CANCELLED (không bé nào có mặt)"}.`,
            lienQuan: { giaoVien: c.teacherId },
          }),
        );
      }
      const g = gioCase(c);
      if (choDiem.length > 0 && g.endAt.getTime() < o.now.getTime()) {
        out.push(
          tao({
            luat: "TV-13",
            nghiemTrong: "MEDIUM",
            phanLoai: "NEEDS_MANUAL_REVIEW",
            thucThe: "MakeupCase",
            id: c.id,
            lyDo: `Case ${ymdCuaCase(c)} ${c.startTime}–${c.endTime} đã qua giờ nhưng còn ${choDiem.length} bé chưa điểm danh — lượt đang bị giữ, giáo viên chưa có công.`,
            deXuat: "Người quản lý nhắc giáo viên điểm danh, hoặc huỷ case nếu buổi không diễn ra.",
            lienQuan: { giaoVien: c.teacherId },
          }),
        );
      }
    }
    if (ymdCuaCase(c) > homNay && daDiem.length > 0) {
      out.push(
        tao({
          luat: "TV-12",
          nghiemTrong: "HIGH",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupCase",
          id: c.id,
          lyDo: `Case ngày ${ymdCuaCase(c)} chưa tới nhưng đã có ${daDiem.length} bé được điểm danh — tiêu lượt và sinh công trước giờ.`,
          deXuat: "Xác minh buổi có diễn ra không; nếu không, cần đảo điểm danh (T07 sẽ có đường sửa có audit).",
          lienQuan: { giaoVien: c.teacherId },
        }),
      );
    }
    if (c.status === "CANCELLED") continue;
    for (const sv of c.students) {
      const n = needTheoId.get(sv.makeupNeedId);
      if (!n) continue;
      const lech: string[] = [];
      if (n.centerId !== c.centerId) lech.push(`cơ sở (dòng ${n.centerId ?? "—"} ≠ case ${c.centerId})`);
      if (n.courseId !== c.courseId) lech.push("khoá");
      const baiCase = c.lessonIds && c.lessonIds.length > 0 ? c.lessonIds : [c.lessonId];
      if (!n.missedLessonId || !baiCase.includes(n.missedLessonId)) lech.push(`bài (dòng ${n.missedLessonId ?? "—"} ngoài bộ bài của case ${baiCase.join(", ")})`);
      if (lech.length > 0) {
        out.push(
          tao({
            luat: "TV-14",
            nghiemTrong: "HIGH",
            phanLoai: "NEEDS_MANUAL_REVIEW",
            thucThe: "MakeupCaseStudent",
            id: sv.id,
            hocVien: n.studentName,
            lyDo: `Bé nằm trong case nhưng lệch nhóm: ${lech.join("; ")}. Luật gom bé chỉ chặn lúc xếp, không chặn khi buổi gốc hay lớp đổi sau đó.`,
            deXuat: "Gỡ bé khỏi case nếu chưa điểm danh, hoặc ghi nhận ngoại lệ có chủ ý.",
            lienQuan: { case: c.id, dong: n.id },
          }),
        );
      }
    }
    // TV-18 — tham chiếu không FK
    const loi: string[] = [];
    const coGv = s.gvHoatDong.get(c.teacherId);
    if (coGv === undefined) loi.push(`giáo viên ${c.teacherId} không còn trong hệ thống`);
    // GV nghỉ việc sau khi case ĐÃ CHỐT là lịch sử, không phải hỏng — chỉ case còn chờ dạy mới cần đổi người.
    else if (coGv === false && c.status === "SCHEDULED") loi.push("giáo viên đã ngừng hoạt động");
    for (const b of c.lessonIds && c.lessonIds.length > 0 ? c.lessonIds : [c.lessonId]) {
      if (!s.lessonIdsConTon.has(b)) loi.push(`bài ${b} không còn`);
    }
    if (c.roomId && !s.roomIdsConTon.has(c.roomId)) loi.push(`phòng ${c.roomId} không còn`);
    if (!s.courseIdsConTon.has(c.courseId)) loi.push(`khoá ${c.courseId} không còn`);
    if (loi.length > 0) {
      out.push(
        tao({
          luat: "TV-18",
          nghiemTrong: coGv === undefined ? "HIGH" : "MEDIUM",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupCase",
          id: c.id,
          lyDo: `Case trỏ thứ không còn hợp lệ: ${loi.join("; ")}. Cột của case không có khoá ngoại nên DB không chặn.`,
          deXuat:
            c.status === "SCHEDULED"
              ? "Đổi giáo viên / phòng cho case (T07 thêm đường sửa case); hiện chỉ huỷ và tạo lại được."
              : "Case đã chốt: KHÔNG đổi người dạy / phòng (công dạy đã tính theo case). Chỉ ghi nhận tham chiếu hỏng.",
          lienQuan: { giaoVien: c.teacherId },
        }),
      );
    }
  }
  return out;
}

/**
 * T07 — ba luật cho mô hình "case nhiều bài + điểm danh hai tầng". Chỉ chạy trên case ĐÃ NÂNG (có `participants`); case đời cũ chưa nâng
 * (mục chưa nối bé) chỉ bị báo một dòng TV-40 mức thấp — `nangCapCase` / script backfill xử lý, và các luật cũ vẫn đọc được qua bản gương `status`.
 *
 *  · TV-40: case có mục SỐNG chưa nối bé tham gia, hoặc chưa có bộ bài — chưa nâng cấp lên mô hình T07. AUTO_FIXABLE (tất định).
 *  · TV-41: hai tầng điểm danh lệch nhau — bé chờ mà mục đã có kết quả, bé đã điểm danh mà còn mục chờ, bé vắng/bị gỡ mà còn mục sống.
 *  · TV-42: bộ bài sai luật (quá 3 bài, hoặc bài chính của case không phải bài đầu bộ), hoặc mục mang bài ngoài bộ bài của case.
 *  · TV-43: trạng thái case không khớp trạng thái chốt suy từ các bé (vd. COMPLETED nhưng mọi bé vắng ⇒ phải là NO_SHOW).
 */
function luatCaseNhieuBai({ s }: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const c of s.cases) {
    if (c.status === "CANCELLED" && (c.participants?.length ?? 0) === 0) continue;
    const bai = c.lessonIds ?? [];
    const be = c.participants;
    const chuaNoi = c.students.filter((m) => (m.participantId ?? null) === null);
    if (be === undefined || be.length === 0 || bai.length === 0 || chuaNoi.length > 0) {
      if (c.students.length > 0 && c.status !== "CANCELLED") {
        out.push(
          tao({
            luat: "TV-40",
            nghiemTrong: "LOW",
            phanLoai: "AUTO_FIXABLE",
            thucThe: "MakeupCase",
            id: c.id,
            lyDo: `Case chưa được nâng lên mô hình nhiều bài: ${bai.length === 0 ? "chưa có bộ bài; " : ""}${be === undefined || be.length === 0 ? "chưa có bé tham gia; " : ""}${chuaNoi.length > 0 ? `${chuaNoi.length} mục chưa nối bé` : ""}.`,
            deXuat: "Chạy scripts/hoc-bu-case-v2-backfill.ts (dry-run trước) hoặc để hệ thống nâng khi case được chạm tới.",
            lienQuan: { giaoVien: c.teacherId },
          }),
        );
      }
      continue;
    }
    // TV-42 — bộ bài
    const loiBai: string[] = [];
    if (bai.length > 3) loiBai.push(`${bai.length} bài (tối đa 3)`);
    if (bai[0] !== c.lessonId) loiBai.push(`bài chính ${c.lessonId} không phải bài đầu bộ (${bai[0] ?? "—"})`);
    for (const m of c.students) {
      if (m.lessonId && !bai.includes(m.lessonId)) loiBai.push(`mục ${m.id} học bài ${m.lessonId} ngoài bộ bài của case`);
    }
    if (loiBai.length > 0) {
      out.push(
        tao({
          luat: "TV-42",
          nghiemTrong: "HIGH",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupCase",
          id: c.id,
          lyDo: `Bộ bài của case sai luật: ${loiBai.join("; ")}.`,
          deXuat: "Sửa bộ bài của case (suaCase) hoặc gỡ mục lệch; không tự sửa vì không biết bài nào mới là đúng.",
          lienQuan: { giaoVien: c.teacherId },
        }),
      );
    }
    // TV-41 — hai tầng
    const theoBe = new Map(be.map((b) => [b.id, b]));
    for (const m of c.students) {
      const b = m.participantId ? theoBe.get(m.participantId) : undefined;
      if (!b || !m.result) continue;
      const loi: string[] = [];
      if (b.attendanceStatus === "PENDING" && m.result !== "PLANNED") loi.push(`bé chờ điểm danh nhưng mục đã là ${m.result}`);
      if ((b.attendanceStatus === "PRESENT") && m.result === "PLANNED") loi.push("bé có mặt nhưng mục còn chờ kết quả");
      if (b.attendanceStatus === "ABSENT" && m.result !== "RELEASED") loi.push(`bé vắng buổi bù nhưng mục còn ${m.result}`);
      if (b.attendanceStatus === "REMOVED" && m.result !== "RELEASED") loi.push(`bé đã bị gỡ nhưng mục còn ${m.result}`);
      if (loi.length > 0) {
        out.push(
          tao({
            luat: "TV-41",
            nghiemTrong: "CRITICAL",
            phanLoai: "INVALID",
            thucThe: "MakeupCaseStudent",
            id: m.id,
            lyDo: `Hai tầng điểm danh lệch nhau: ${loi.join("; ")}.`,
            deXuat: "Không sửa tự động — tra audit của bé trong case rồi chốt lại bằng đường sửa điểm danh.",
            lienQuan: { case: c.id, be: b.id, giaoVien: c.teacherId },
          }),
        );
      }
    }
    // TV-43 — trạng thái case
    const song = be.filter((b) => b.attendanceStatus !== "REMOVED");
    const cho = song.some((b) => b.attendanceStatus === "PENDING");
    const coMat = song.some((b) => b.attendanceStatus === "PRESENT");
    const mong: CaseRow["status"] | null =
      song.length === 0 ? "CANCELLED" : cho ? "SCHEDULED" : coMat ? "COMPLETED" : "NO_SHOW";
    if (c.status !== mong) {
      out.push(
        tao({
          luat: "TV-43",
          nghiemTrong: c.status === "SCHEDULED" ? "HIGH" : "MEDIUM",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupCase",
          id: c.id,
          lyDo: `Case đang ${c.status} nhưng các bé cho thấy phải là ${mong} (${song.length} bé còn lại, ${cho ? "còn bé chờ điểm danh" : coMat ? "có bé có mặt" : "mọi bé vắng"}).`,
          deXuat: `Chốt lại case thành ${mong} bằng đường điểm danh/sửa điểm danh để công dạy và lịch sử khớp nhau.`,
          lienQuan: { giaoVien: c.teacherId },
        }),
      );
    }
  }
  return out;
}

function luatTrangThaiDong({ s, needTheoId, caseSVTheoNeed }: Ctx): { out: Finding[]; boQua: number } {
  const out: Finding[] = [];
  let boQua = 0;
  // Bản ghi trong case → dòng.
  for (const c of s.cases) {
    for (const sv of c.students) {
      const n = needTheoId.get(sv.makeupNeedId);
      if (!n) continue;
      const lech15: string[] = [];
      if (sv.status === "PLACED" && n.status !== "SCHEDULED") {
        lech15.push(`dòng cần bù ở trạng thái ${n.status} (phải là SCHEDULED)`);
      }
      // Case đã chốt/huỷ mà bé vẫn "chờ": không giáo viên nào còn điểm danh được, dòng thì có thể vẫn SCHEDULED.
      if (sv.status === "PLACED" && c.status !== "SCHEDULED") {
        lech15.push(`case đã ${c.status === "COMPLETED" ? "chốt COMPLETED" : "huỷ"} nên không ai điểm danh bé được nữa`);
      }
      if (lech15.length > 0) {
        out.push(
          tao({
            luat: "TV-15",
            nghiemTrong: "CRITICAL",
            phanLoai: "INVALID",
            thucThe: "MakeupCaseStudent",
            id: sv.id,
            hocVien: n.studentName,
            lyDo: `Bé đang chờ điểm danh trong case ${c.id} nhưng ${lech15.join("; ")}. Điểm danh bù sau đó (nếu có) sẽ ghi đè trạng thái dòng.`,
            deXuat: "Không sửa tự động. Đối chiếu nguyên nhân (thường là huỷ lớp chạm dòng mà không chạm case), rồi quyết gỡ bé hoặc khôi phục dòng.",
            lienQuan: { case: c.id, dong: n.id },
          }),
        );
      }
    }
  }
  // Một dòng chỉ được chờ ở MỘT case đang dạy. Chỉ mục từng phần `MakeupCaseStudent_need_placed_key` chặn
  // ở DB nhưng nó sống ngoài schema.prisma — thiếu nó (chưa chạy migration, hay `migrate diff` xoá nhầm)
  // thì không còn gì chặn, và hai case cùng "chờ" một bé sẽ cùng điểm danh nó.
  for (const n of s.needs) {
    const cho = (caseSVTheoNeed.get(n.id) ?? []).filter((x) => x.sv.status === "PLACED" && x.c.status === "SCHEDULED");
    if (cho.length > 1) {
      out.push(
        tao({
          luat: "TV-15",
          nghiemTrong: "CRITICAL",
          phanLoai: "INVALID",
          thucThe: "MakeupNeed",
          id: n.id,
          hocVien: n.studentName,
          lyDo: `Dòng đang chờ ĐỒNG THỜI ở ${cho.length} case (${cho.map((x) => x.c.id).join(", ")}) — chỉ mục chống trùng PLACED có thể đã mất.`,
          deXuat: "Không sửa tự động. Kiểm chỉ mục MakeupCaseStudent_need_placed_key rồi gỡ bé khỏi các case thừa.",
          lienQuan: { dong: n.id },
        }),
      );
    }
  }
  for (const n of s.needs) {
    const trongCase = caseSVTheoNeed.get(n.id) ?? [];
    if (n.status === "SCHEDULED") {
      if (laLuongCu(n)) {
        boQua++;
        continue;
      }
      if (!trongCase.some((x) => x.sv.status === "PLACED")) {
        const daCoMat = trongCase.some((x) => x.sv.status === "PRESENT");
        out.push(
          tao({
            luat: "TV-15",
            nghiemTrong: "HIGH",
            phanLoai: daCoMat ? "NEEDS_MANUAL_REVIEW" : "AUTO_FIXABLE",
            thucThe: "MakeupNeed",
            id: n.id,
            hocVien: n.studentName,
            lyDo: daCoMat
              ? "Dòng ở SCHEDULED nhưng bé đã được điểm danh CÓ MẶT trong case — điểm danh ghi xong mà dòng chưa chốt."
              : "Dòng ở SCHEDULED nhưng không có bản ghi nào đang chờ trong case — bé không còn ở đâu để được dạy.",
            deXuat: daCoMat
              ? "Người quản lý xác nhận bé đã học thật rồi chốt COMPLETED + usedQuota theo dungLuot."
              : "Đặt về PENDING, usedQuota=false (đúng phép gỡ bé khỏi case).",
            lienQuan: trongCase[0] ? { case: trongCase[0].c.id } : undefined,
          }),
        );
      }
    }
    if (n.status === "COMPLETED") {
      if (laLuongCu(n)) {
        boQua++;
      } else if (!trongCase.some((x) => x.sv.status === "PRESENT")) {
        out.push(
          tao({
            luat: "TV-16",
            nghiemTrong: "MEDIUM",
            phanLoai: "NEEDS_MANUAL_REVIEW",
            thucThe: "MakeupNeed",
            id: n.id,
            hocVien: n.studentName,
            lyDo: "Dòng đã BÙ XONG nhưng không có buổi bù nào mà bé có mặt, và cũng không dấu vết luồng cũ — không truy được bù ở đâu.",
            deXuat: "Tra audit/ghi chú của dòng; nếu không có bằng chứng thì quản lý quyết trả về chờ bù hay giữ nguyên.",
          }),
        );
      }
    }
    // TV-17 — cờ lượt
    const coPresentDungLuot = trongCase.some((x) => x.sv.status === "PRESENT" && x.sv.dungLuot);
    if (n.usedQuota && n.status !== "COMPLETED") {
      out.push(
        tao({
          luat: "TV-17",
          nghiemTrong: "HIGH",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupNeed",
          id: n.id,
          hocVien: n.studentName,
          lyDo: `Dòng đã tính là TIÊU lượt (usedQuota) nhưng trạng thái là ${n.status}, chưa bù xong — bé mất lượt mà chưa học.`,
          deXuat: "Xem lịch sử điểm danh bù; nếu bé không học thì trả lượt (T06 sẽ ghi bút toán RELEASE).",
        }),
      );
    } else if (n.status === "COMPLETED" && coPresentDungLuot && !n.usedQuota) {
      out.push(
        tao({
          luat: "TV-17",
          nghiemTrong: "MEDIUM",
          phanLoai: "AUTO_FIXABLE",
          thucThe: "MakeupNeed",
          id: n.id,
          hocVien: n.studentName,
          lyDo: "Bé đã học bù bằng lượt (dungLuot) nhưng cờ usedQuota chưa bật — lượt không bị trừ, tổng lượt còn dư ảo.",
          deXuat: "Bật usedQuota=true cho dòng.",
        }),
      );
    }
  }
  return { out, boQua };
}

function luatLopHuy({ s, needTheoId }: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const c of s.cases) {
    for (const sv of c.students) {
      if (sv.status !== "PLACED") continue;
      const n = needTheoId.get(sv.makeupNeedId);
      if (!n || n.status !== "SCHEDULED") continue; // lệch trạng thái đã vào TV-15
      if (n.lopDaHuy || n.lopDaXoa) {
        out.push(
          tao({
            luat: "TV-19",
            nghiemTrong: "HIGH",
            phanLoai: "NEEDS_MANUAL_REVIEW",
            thucThe: "MakeupCaseStudent",
            id: sv.id,
            hocVien: n.studentName,
            lyDo: `Lớp ${n.className} đã ${n.lopDaXoa ? "xoá" : "huỷ"} mà bé vẫn đang chờ học bù trong case ${c.id}.`,
            deXuat:
              "Quyết định 07/10: KHÔNG huỷ mù (T05 đã BỎ cascade huỷ lớp) — dòng GIỮ NGUYÊN khi huỷ lớp. Xem `hocBuConMo` trong nhật ký huỷ lớp (ai còn nợ, còn học khoá đó ở lớp khác không) rồi quản lý quyết từng dòng ở /admin/hoc-bu: gỡ khỏi case, hoặc Huỷ có lý do.",
            lienQuan: { case: c.id, dong: n.id, lop: n.classId },
          }),
        );
      }
    }
  }
  return out;
}

function luatBuoiGoc({ s, diemDanhTheoCap, caseSVTheoNeed }: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const n of s.needs) {
    const a = diemDanhTheoCap.get(khoa(n.studentId, n.missedSessionId));
    const trongCase = caseSVTheoNeed.get(n.id) ?? [];
    const baiXong = n.status === "COMPLETED" && trongCase.some((x) => x.sv.status === "PRESENT");

    // ORDER_CONVERSION (học vượt) và PHUC_HOC (phục học vào lớp đi trước) KHÔNG có điểm danh gốc theo thiết kế: bé chưa từng vào lớp ở buổi đó.
    if (n.status === "COMPLETED" && !a && !laLuongCu(n) && n.sourceType !== "ORDER_CONVERSION" && n.nguon !== "PHUC_HOC") {
      out.push(
        tao({
          luat: "TV-22",
          nghiemTrong: "HIGH",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupNeed",
          id: n.id,
          hocVien: n.studentName,
          lyDo: `Dòng đã bù xong (nguồn ${n.sourceType}) nhưng buổi gốc KHÔNG có bản ghi điểm danh của bé. Bù xong cập nhật 0 dòng, buổi gốc không phản ánh gì.`,
          deXuat:
            n.sourceType === "SYSTEM_MIGRATION"
              ? "Dòng có TRƯỚC T05 nên chưa biết nguồn: nếu là học vượt từ chuyển đổi đơn thì phân loại ORDER_CONVERSION ở T15 (dry-run + --expect) rồi dòng này hết báo."
              : "Nguồn không phải ORDER_CONVERSION mà buổi gốc không có điểm danh: xem dòng được tạo từ đâu, hoặc điểm danh gốc đã bị xoá.",
          lienQuan: { buoiGoc: n.missedSessionId },
        }),
      );
    }
    if (!a) continue;

    if (baiXong && !laVang(a.status)) {
      // Chỉ nhật ký TRƯỚC lúc dòng chốt COMPLETED mới nói được trạng thái trước khi bị ghi đè; nhật ký sau
      // đó đã mang trạng thái bị ghi đè. AUTO_FIXABLE chỉ khi MỌI mốc trong nhật ký ấy cùng MỘT trạng thái
      // vắng — hai trạng thái khác nhau (ABSENT rồi admin sửa EXCUSED…) là phải hỏi người, KHÔNG đoán.
      const nhatKy = s.bangChungVangGoc.get(khoa(n.missedSessionId, n.studentId)) ?? [];
      const moc = n.completedAt?.getTime();
      const truocKhiXong = moc === undefined ? [] : nhatKy.filter((e) => e.luc.getTime() <= moc);
      const cacTrangThai = [
        ...new Set(truocKhiXong.flatMap((e) => [e.cu, e.moi]).filter((x): x is string => x !== null)),
      ];
      const chungCu = cacTrangThai.length === 1 ? cacTrangThai[0]! : undefined;
      const coBangChung = chungCu !== undefined && laVang(chungCu);
      out.push(
        tao({
          luat: "TV-20",
          nghiemTrong: "HIGH",
          phanLoai: coBangChung ? "AUTO_FIXABLE" : "NEEDS_MANUAL_REVIEW",
          thucThe: "Attendance",
          id: `${n.missedSessionId}|${n.studentId}`,
          hocVien: n.studentName,
          lyDo: `Buổi gốc đang ghi ${a.status} (makeupStatus=${a.makeupStatus}) dù bé ĐÃ VẮNG và học bù xong — điểm danh bù ĐỜI CŨ ghi đè trạng thái vắng bằng có mặt (chốt 29/09; quyết định 07/10 đảo lại: điểm danh gốc phải giữ nguyên vắng).${
            coBangChung
              ? ` Nhật ký audit trước lúc bù xong chỉ có một trạng thái: ${chungCu}.`
              : cacTrangThai.length > 1
                ? ` Nhật ký audit trước lúc bù xong có NHIỀU trạng thái (${cacTrangThai.join(", ")}) — không biết cái nào là cái ngay trước khi bị ghi đè.`
                : " Không có nhật ký audit giữ trạng thái vắng gốc."
          }`,
          deXuat: coBangChung
            ? `Khôi phục status=${chungCu} từ nhật ký (bằng chứng: attendance.edited). Giữ makeupStatus theo dòng cần bù.`
            : "KHÔNG ĐOÁN trạng thái vắng gốc (có phép hay không phép). Đối chiếu phiếu xin nghỉ / ghi chú, hoặc hỏi giáo viên lớp gốc.",
          lienQuan: { buoiGoc: n.missedSessionId, hocVien: n.studentId, dong: n.id },
        }),
      );
      continue; // TV-21 sẽ lặp lại cùng nguyên nhân
    }

    // Dòng bị huỷ HÀNG LOẠT khi lớp bị huỷ/xoá (không có waivedAt) mà nhãn điểm danh vẫn "cần bù" — khác hẳn
    // "ai đó sửa vắng→có mặt rồi lại vắng". Quyết định 07/10: huỷ lớp không được cascade; T10 đánh giá từng bé.
    const doLopHuy =
      n.status === "CANCELLED" && n.waivedAt === null && (n.lopDaHuy || n.lopDaXoa) && a.makeupStatus === "NEEDS_MAKEUP";
    const lech: string | null =
      a.makeupStatus === "NEEDS_MAKEUP" && n.status === "COMPLETED"
        ? "Điểm danh gốc ghi \"cần bù\" nhưng dòng đã bù xong"
        : a.makeupStatus === "MADE_UP" && n.status !== "COMPLETED"
          ? `Điểm danh gốc ghi "đã bù" nhưng dòng ở trạng thái ${n.status}`
          : a.makeupStatus === "NEEDS_MAKEUP" && n.status === "CANCELLED" && n.waivedAt !== null
            ? "Điểm danh gốc còn \"cần bù\" dù dòng đã được huỷ không bù"
            : a.makeupStatus === "NEEDS_MAKEUP" && n.status === "CANCELLED" && n.waivedAt === null
              ? doLopHuy
                ? "Điểm danh gốc ghi \"cần bù\" nhưng dòng đã bị huỷ HÀNG LOẠT khi lớp bị huỷ/xoá — bé không còn dòng nào theo dõi mà hồ sơ vẫn nói còn nợ buổi"
                : "Điểm danh gốc ghi \"cần bù\" nhưng dòng đã bị TỰ huỷ (khi ai đó sửa vắng→có mặt) rồi buổi lại bị đánh vắng — bé biến khỏi màn Học bù mà hồ sơ vẫn nói còn nợ buổi"
              : null;
    if (lech) {
      // Huỷ CHỦ Ý (có lý do) thì nhãn cũ chỉ là cache chậm; huỷ TỰ ĐỘNG mà buổi lại vắng là bé mất khỏi màn.
      const nhe = n.status === "CANCELLED" && n.waivedAt !== null;
      out.push(
        tao({
          luat: "TV-21",
          nghiemTrong: nhe ? "LOW" : doLopHuy ? "MEDIUM" : "HIGH",
          phanLoai: nhe ? "SAFE" : "NEEDS_MANUAL_REVIEW",
          thucThe: "Attendance",
          id: `${n.missedSessionId}|${n.studentId}`,
          hocVien: n.studentName,
          lyDo: `${lech}. Hồ sơ học viên và màn điểm danh gốc đọc cột này nên hiển thị sai.`,
          deXuat: nhe
            ? "Không gấp: T08 đổi mọi màn sang đọc kết quả học bù từ dòng cần bù, cột này chỉ còn là bản cache."
            : doLopHuy
              ? "Chưa sửa ở đây: T10 đánh giá phụ thuộc từng học viên khi lớp bị huỷ (ghi danh, lượt, phí) rồi mới quyết mở lại dòng hay ghi nhận không bù."
              : "Đối chiếu từng dòng rồi quyết nguồn đúng (dòng cần bù thường đúng).",
          lienQuan: { buoiGoc: n.missedSessionId, dong: n.id },
        }),
      );
    }
  }
  return out;
}

/**
 * T05 — hai luật do cột mới bật được.
 *  · TV-30: `MakeupNeed.courseId` (lưu lúc tạo) lệch `Class.courseId`. Nhóm case ghép theo cột này, nên lệch là xếp nhầm khoá. Cột được
 *    backfill từ lớp và ghi bởi service từ lớp ⇒ chỉ lệch khi ai đó đổi khoá của lớp SAU khi dòng đã tạo, hoặc ghi tay.
 *  · TV-31: dòng nguồn ABSENCE mà buổi gốc CÓ điểm danh của bé, nhưng `originalAttendanceId` null hoặc trỏ bản ghi khác. Gặp khi điểm danh
 *    bị xoá rồi tạo lại (FK SET NULL) — AUTO_FIXABLE: trỏ lại bản ghi hiện có. Dòng SYSTEM_MIGRATION (trước T05) KHÔNG xét: liên kết cho
 *    chúng làm ở T15 cùng phân loại nguồn, không phải lỗi của dữ liệu mới.
 */
function luatChuanHoaDong({ s, diemDanhTheoCap }: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const n of s.needs) {
    if (n.courseIdCuaDong !== n.courseId) {
      out.push(
        tao({
          luat: "TV-30",
          nghiemTrong: "MEDIUM",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupNeed",
          id: n.id,
          hocVien: n.studentName,
          lyDo: `Dòng lưu khoá ${n.courseIdCuaDong} nhưng lớp ${n.className} đang thuộc khoá ${n.courseId}.`,
          deXuat: "Xác định khoá nào đúng (lớp có bị đổi khoá sau khi dòng được tạo không) rồi sửa MỘT bên; đừng để hai bên khác nhau — nhóm case ghép theo cột của dòng.",
          lienQuan: { lop: n.classId },
        }),
      );
    }
    if (n.sourceType === "ABSENCE") {
      const a = diemDanhTheoCap.get(khoa(n.studentId, n.missedSessionId));
      if (a && n.originalAttendanceId !== a.id) {
        out.push(
          tao({
            luat: "TV-31",
            nghiemTrong: "LOW",
            phanLoai: "AUTO_FIXABLE",
            thucThe: "MakeupNeed",
            id: n.id,
            hocVien: n.studentName,
            lyDo: n.originalAttendanceId
              ? "Dòng nguồn ABSENCE trỏ một bản ghi điểm danh KHÁC với bản ghi hiện có của (học viên, buổi gốc)."
              : "Dòng nguồn ABSENCE chưa liên kết điểm danh gốc dù buổi gốc có bản ghi điểm danh của bé (thường do điểm danh bị xoá rồi tạo lại).",
            deXuat: `Đặt originalAttendanceId = ${a.id}.`,
            lienQuan: { buoiGoc: n.missedSessionId, diemDanh: a.id },
          }),
        );
      }
    }
  }
  return out;
}

/**
 * T06 — bốn luật của SỔ LƯỢT. Sổ là sự thật về "còn mấy lượt"; các luật này ghim nó vào hai nơi từng là sự thật cũ:
 *  · TV-32: số trên tài khoản ≠ tổng bút toán. DB cấm sửa bút toán (trigger) nên chỉ lệch khi ai đó sửa thẳng tài khoản bằng SQL.
 *  · TV-33: `held` ≠ số mục case ĐANG CHỜ (PLACED) xếp bằng lượt của (học viên, khoá). Gặp khi mục case bị xoá không qua đường nhả
 *    (xoá buổi/lớp/dòng bằng cascade — T14) hoặc đường xếp mới quên giữ lượt.
 *  · TV-34: `consumed` ≠ số dòng đã tiêu lượt (`usedQuota`).
 *  · TV-35: có lượt đang giữ/đã tiêu (dữ liệu trước T06) mà CHƯA có tài khoản — chưa nhập vào sổ. LOW, AUTO_FIXABLE: script
 *    `scripts/so-luot-khoi-tao.ts` nhập (dry-run mặc định).
 * Khoá của (học viên, khoá) lấy từ cột LƯU trên dòng (`courseIdCuaDong`) — cùng cột mà sổ dùng.
 */
function luatSoLuot({ s, needTheoId }: Ctx): Finding[] {
  const out: Finding[] = [];
  const dangGiu = new Map<string, number>();
  const daTieu = new Map<string, number>();
  const ten = new Map<string, string>();
  for (const c of s.cases) {
    for (const sv of c.students) {
      if (sv.status !== "PLACED" || !sv.dungLuot) continue;
      const n = needTheoId.get(sv.makeupNeedId);
      if (!n) continue;
      const k = khoa(n.studentId, n.courseIdCuaDong);
      dangGiu.set(k, (dangGiu.get(k) ?? 0) + 1);
      ten.set(k, n.studentName);
    }
  }
  for (const n of s.needs) {
    if (!n.usedQuota) continue;
    const k = khoa(n.studentId, n.courseIdCuaDong);
    daTieu.set(k, (daTieu.get(k) ?? 0) + 1);
    ten.set(k, n.studentName);
  }
  const coTaiKhoan = new Set<string>();
  for (const a of s.soLuot) {
    const k = khoa(a.studentId, a.courseId);
    coTaiKhoan.add(k);
    const lienQuan = { taiKhoan: a.id, khoa: a.courseId };
    if (a.granted !== a.tongBut.granted || a.held !== a.tongBut.held || a.consumed !== a.tongBut.consumed) {
      out.push(
        tao({
          luat: "TV-32",
          nghiemTrong: "CRITICAL",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupCreditAccount",
          id: a.id,
          hocVien: a.studentName,
          lyDo: `Tài khoản ghi cấp/giữ/tiêu = ${a.granted}/${a.held}/${a.consumed} nhưng tổng bút toán là ${a.tongBut.granted}/${a.tongBut.held}/${a.tongBut.consumed}.`,
          deXuat: "Đối chiếu từng bút toán (sổ là sự thật, không sửa được); đặt lại số tài khoản theo tổng bút toán sau khi xác nhận không ai ghi tay.",
          lienQuan,
        }),
      );
    }
    const giu = dangGiu.get(k) ?? 0;
    if (a.held !== giu) {
      out.push(
        tao({
          luat: "TV-33",
          nghiemTrong: "HIGH",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupCreditAccount",
          id: a.id,
          hocVien: a.studentName,
          lyDo: `Sổ đang giữ ${a.held} lượt nhưng có ${giu} mục case đang chờ xếp bằng lượt.`,
          deXuat: a.held > giu ? "Nhả phần giữ thừa (RELEASE kèm lý do) — thường do mục case bị xoá không qua đường nhả." : "Giữ bù (HOLD) cho mục case chưa có lượt — thường do một đường xếp mới quên giữ.",
          lienQuan,
        }),
      );
    }
    const tieu = daTieu.get(k) ?? 0;
    if (a.consumed !== tieu) {
      out.push(
        tao({
          luat: "TV-34",
          nghiemTrong: "HIGH",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupCreditAccount",
          id: a.id,
          hocVien: a.studentName,
          lyDo: `Sổ ghi đã tiêu ${a.consumed} lượt nhưng có ${tieu} dòng cần bù đánh dấu đã tiêu lượt.`,
          deXuat: "Xác định bên nào đúng (bé có thật sự học bù bằng lượt không) rồi ghi ADJUSTMENT hoặc sửa cờ usedQuota của dòng.",
          lienQuan,
        }),
      );
    }
  }
  for (const k of new Set([...dangGiu.keys(), ...daTieu.keys()])) {
    if (coTaiKhoan.has(k)) continue;
    const [studentId, courseId] = k.split("|");
    out.push(
      tao({
        luat: "TV-35",
        nghiemTrong: "LOW",
        phanLoai: "AUTO_FIXABLE",
        thucThe: "MakeupCreditAccount",
        id: k,
        hocVien: ten.get(k),
        lyDo: `Học viên có ${dangGiu.get(k) ?? 0} lượt đang giữ và ${daTieu.get(k) ?? 0} lượt đã tiêu (dữ liệu trước T06) nhưng chưa có tài khoản trong sổ.`,
        deXuat: "Chạy scripts/so-luot-khoi-tao.ts (dry-run mặc định, --ap-dung --expect=N) để nhập vào sổ.",
        lienQuan: { hocVien: studentId!, khoa: courseId! },
      }),
    );
  }
  return out;
}

function luatBuoiTrung({ s }: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const g of s.buoiTrung) {
    // "Mang dữ liệu" = điểm danh, nhận xét, HOẶC bất kỳ bản ghi nào khác trỏ vào buổi (bài tập, ảnh, đánh giá,
    // đơn phụ huynh, dòng cần bù, dấu học bù cũ), HOẶC buổi đã bắt đầu/hoàn tất (công dạy tính theo trạng thái).
    // Huỷ một buổi "trống" mà thực ra có người trỏ vào là mất dữ liệu mà script vá không biết.
    const coDuLieu = g.buoi.filter(
      (b) => b.soDiemDanh > 0 || b.soNhanXet > 0 || b.soThamChieu > 0 || b.trangThai !== "SCHEDULED",
    );
    const tuVa = coDuLieu.length <= 1;
    const giu = coDuLieu[0] ?? [...g.buoi].sort((x, y) => x.taoLuc.getTime() - y.taoLuc.getTime())[0]!;
    out.push(
      tao({
        luat: "TV-23",
        nghiemTrong: "HIGH",
        phanLoai: tuVa ? "AUTO_FIXABLE" : "NEEDS_MANUAL_REVIEW",
        thucThe: "ClassSession",
        id: g.buoi.map((b) => b.id).join(","),
        lyDo: `Lớp ${g.classId} có ${g.buoi.length} buổi cùng thời điểm ${g.luc}. ${
          tuVa
            ? `Chỉ ${coDuLieu.length} buổi mang dữ liệu (điểm danh/nhận xét/tham chiếu/đã bắt đầu).`
            : `${coDuLieu.length} buổi đều đã mang dữ liệu (điểm danh/nhận xét/tham chiếu/đã bắt đầu) — phải gộp tay.`
        }`,
        deXuat: tuVa
          ? `Giữ buổi ${giu.id} (${coDuLieu.length ? "đang mang dữ liệu" : "tạo sớm nhất"}), huỷ các buổi còn lại. Xoá cứng bị chặn.`
          : "Người quản lý chọn buổi giữ rồi chuyển điểm danh/nhận xét sang nó trước khi huỷ buổi thừa.",
        lienQuan: { lop: g.classId, giu: giu.id },
      }),
    );
  }
  for (const g of s.buoiTrungNgay) {
    out.push(
      tao({
        luat: "TV-24",
        nghiemTrong: "MEDIUM",
        phanLoai: "NEEDS_MANUAL_REVIEW",
        thucThe: "ClassSession",
        id: g.buoiIds.join(","),
        lyDo: `Lớp ${g.classId} có ${g.buoiIds.length} buổi trong ngày ${g.ngayVn} ở các giờ khác nhau. Có thể là học dồn hợp lệ hoặc buổi sinh trùng.`,
        deXuat: "Đối chiếu kế hoạch lịch của lớp trước khi quyết.",
        lienQuan: { lop: g.classId },
      }),
    );
  }
  return out;
}

function luatXungDot({ s, o, needTheoId }: Ctx): Finding[] {
  const out: Finding[] = [];
  const cacCase = s.cases.filter((c) => c.status !== "CANCELLED" && ymdCuaCase(c) >= o.tuNgayYmd);
  const slotCase = new Map<string, Slot & { id: string }>();
  for (const c of cacCase) {
    const g = gioCase(c);
    slotCase.set(c.id, { id: `case:${c.id}`, teacherId: c.teacherId, roomId: c.roomId, ...g });
  }
  const daBao = new Set<string>();
  for (const c of cacCase) {
    const me = slotCase.get(c.id)!;
    const ngay = ymdCuaCase(c);

    for (const b of s.slotBuoi) {
      if (!overlaps(b, me)) continue;
      if (b.teacherId && b.teacherId === me.teacherId) {
        out.push(
          tao({
            luat: "TV-25",
            nghiemTrong: "HIGH",
            phanLoai: "NEEDS_MANUAL_REVIEW",
            thucThe: "MakeupCase",
            id: c.id,
            lyDo: `Giáo viên ${c.teacherId} dạy case ${ngay} ${c.startTime}–${c.endTime} trùng buổi lớp ${b.classId} (buổi ${b.id}).`,
            deXuat: "Đổi giờ / giáo viên (T07 thêm đường sửa case; T09 chặn từ lúc xếp).",
            lienQuan: { buoiLop: b.id, giaoVien: c.teacherId },
          }),
        );
      }
      if (b.roomId && me.roomId && b.roomId === me.roomId) {
        out.push(
          tao({
            luat: "TV-26",
            nghiemTrong: "HIGH",
            phanLoai: "NEEDS_MANUAL_REVIEW",
            thucThe: "MakeupCase",
            id: c.id,
            lyDo: `Phòng ${me.roomId} của case ${ngay} ${c.startTime}–${c.endTime} trùng buổi lớp ${b.classId} (buổi ${b.id}).`,
            deXuat: "Đổi phòng hoặc giờ (T07/T09).",
            lienQuan: { buoiLop: b.id, phong: me.roomId },
          }),
        );
      }
    }

    for (const d of cacCase) {
      if (d.id >= c.id) continue; // mỗi cặp một lần
      const other = slotCase.get(d.id)!;
      if (!overlaps(me, other)) continue;
      const cap = `${d.id}|${c.id}`;
      if (me.teacherId && me.teacherId === other.teacherId && !daBao.has(`t|${cap}`)) {
        daBao.add(`t|${cap}`);
        out.push(
          tao({
            luat: "TV-25",
            nghiemTrong: "HIGH",
            phanLoai: "NEEDS_MANUAL_REVIEW",
            thucThe: "MakeupCase",
            id: c.id,
            lyDo: `Giáo viên ${c.teacherId} bị xếp hai case trùng giờ: ${c.id} và ${d.id} (${ngay}).`,
            deXuat: "Đổi giờ hoặc giáo viên một trong hai case.",
            lienQuan: { caseKhac: d.id, giaoVien: c.teacherId },
          }),
        );
      }
      if (me.roomId && me.roomId === other.roomId && !daBao.has(`r|${cap}`)) {
        daBao.add(`r|${cap}`);
        out.push(
          tao({
            luat: "TV-26",
            nghiemTrong: "HIGH",
            phanLoai: "NEEDS_MANUAL_REVIEW",
            thucThe: "MakeupCase",
            id: c.id,
            lyDo: `Phòng ${me.roomId} bị xếp hai case trùng giờ: ${c.id} và ${d.id} (${ngay}).`,
            deXuat: "Đổi phòng hoặc giờ một trong hai case.",
            lienQuan: { caseKhac: d.id, phong: me.roomId },
          }),
        );
      }
    }

    // Học viên: bé còn phải ở đó (PLACED / PRESENT); bé đã vắng thì không còn xung đột.
    for (const sv of c.students) {
      if (sv.status === "ABSENT") continue;
      const need = needTheoId.get(sv.makeupNeedId);
      if (!need) continue;
      const lop = new Set(s.lopCuaHocVien.get(need.studentId) ?? []);
      for (const b of s.slotBuoi) {
        if (!lop.has(b.classId) || !overlaps(b, me)) continue;
        out.push(
          tao({
            luat: "TV-27",
            nghiemTrong: "MEDIUM",
            phanLoai: "NEEDS_MANUAL_REVIEW",
            thucThe: "MakeupCaseStudent",
            id: sv.id,
            hocVien: need.studentName,
            lyDo: `${need.studentName} có buổi lớp ${b.classId} (buổi ${b.id}) trùng case ${ngay} ${c.startTime}–${c.endTime}.`,
            deXuat: "Đổi giờ case hoặc gỡ bé khỏi case.",
            lienQuan: { case: c.id, buoiLop: b.id, hocVien: need.studentId },
          }),
        );
      }
      for (const d of cacCase) {
        if (d.id >= c.id) continue; // mỗi cặp case một lần
        if (!overlaps(me, slotCase.get(d.id)!)) continue;
        const cungBe = d.students.some(
          (x) => x.status !== "ABSENT" && needTheoId.get(x.makeupNeedId)?.studentId === need.studentId,
        );
        if (cungBe) {
          out.push(
            tao({
              luat: "TV-27",
              nghiemTrong: "MEDIUM",
              phanLoai: "NEEDS_MANUAL_REVIEW",
              thucThe: "MakeupCaseStudent",
              id: sv.id,
              hocVien: need.studentName,
              lyDo: `${need.studentName} nằm trong hai case trùng giờ: ${c.id} và ${d.id}.`,
              deXuat: "Gỡ bé khỏi một trong hai case.",
              lienQuan: { case: c.id, caseKhac: d.id, hocVien: need.studentId },
            }),
          );
        }
      }
    }
  }
  return out;
}

function luatDonPh({ s }: Ctx): Finding[] {
  const needTheoCap = new Map(s.needs.map((n) => [khoa(n.studentId, n.missedSessionId), n]));
  const out: Finding[] = [];
  for (const r of s.donPh) {
    if (!r.sessionId) continue;
    // APPROVED là trạng thái CUỐI của đơn xin bù — không còn đường nào "đóng" nó, và trần 10 đơn của cổng
    // phụ huynh chỉ đếm PENDING. Đơn đã duyệt mà dòng sau đó xếp/bù/huỷ là cuối đời bình thường, không phải treo.
    if (r.status !== "PENDING") continue;
    const n = needTheoCap.get(khoa(r.studentId, r.sessionId));
    if (n && n.status === "PENDING") continue;
    out.push(
      tao({
        luat: "TV-28",
        nghiemTrong: "MEDIUM",
        phanLoai: "NEEDS_MANUAL_REVIEW",
        thucThe: "ParentRequest",
        id: r.id,
        lyDo: n
          ? `Đơn xin bù còn ${r.status} nhưng dòng cần bù tương ứng đã ${n.status === "SCHEDULED" ? "được xếp case" : n.status === "COMPLETED" ? "bù xong" : "huỷ"} — đơn treo, vẫn đếm vào trần 10 đơn của phụ huynh.`
          : "Đơn xin bù còn mở nhưng không tìm thấy dòng cần bù cho buổi đó.",
        deXuat: "Đóng đơn với phản hồi phù hợp. Từ T11 hệ thống tự đóng đơn khi dòng đổi trạng thái (`dongYeuCauPhuHuynh`); đơn còn treo là đơn tồn từ trước T11 hoặc tạo ngoài đường chuẩn.",
        lienQuan: { hocVien: r.studentId, buoiGoc: r.sessionId },
      }),
    );
  }
  return out;
}

/**
 * T12 — công dạy bù ngoài bản chốt kỳ công. Kỳ đã chốt là con số đã trả/đã duyệt: case dạy xong SAU khi chốt (hoặc bị sửa/huỷ sau chốt)
 * không được tự lọt vào bản chốt, nên phải có người nhìn. Luật KHÔNG ghi gì — mở lại kỳ hay bù công là việc của kế toán/BLĐ.
 */
function luatCongDayBu({ s }: Ctx): Finding[] {
  const out: Finding[] = [];
  const caseTheoId = new Map(s.cases.map((c) => [c.id, c]));
  for (const ky of s.kyDaChot) {
    const trongKy = s.cases.filter((c) => c.centerId === ky.centerId && ymdCuaCase(c).slice(0, 7) === ky.periodKey);
    const hienTai = buoiBuTuCase(
      trongKy.map((c) => ({ id: c.id, teacherId: c.teacherId, date: c.date, startTime: c.startTime, endTime: c.endTime, status: c.status })),
    );
    for (const l of lechSoVoiBanChot(ky.banChotBuoiBu, hienTai)) {
      const c = caseTheoId.get(l.caseId);
      const kyNoi = `kỳ ${ky.periodKey} (đã chốt)`;
      const lyDo =
        l.loai === "BAN_CHOT_TRUOC_T12"
          ? `Case đã dạy trong ${kyNoi} nhưng bản chốt này lập trước khi bản chốt ghi buổi dạy bù — không đối chiếu được công dạy bù đã tính hay chưa.`
          : l.loai === "NGOAI_BAN_CHOT"
            ? `Case đã dạy trong ${kyNoi} nhưng bản chốt không ghi buổi này — công dạy bù của giáo viên chưa nằm trong kỳ đã chốt.`
            : l.loai === "DOI_SAU_CHOT"
              ? `Case trong ${kyNoi} đổi giáo viên / trạng thái / giờ SAU khi chốt — bản chốt và dữ liệu hiện tại lệch nhau.`
              : `Bản chốt ${kyNoi} có buổi dạy bù này nhưng hiện case không còn có công (bị huỷ / điểm danh sửa lại / không còn bản ghi).`;
      out.push(
        tao({
          luat: "TV-93",
          nghiemTrong: l.loai === "BAN_CHOT_TRUOC_T12" ? "MEDIUM" : "HIGH",
          phanLoai: "NEEDS_MANUAL_REVIEW",
          thucThe: "MakeupCase",
          id: l.caseId,
          lyDo,
          deXuat:
            l.loai === "BAN_CHOT_TRUOC_T12"
              ? "Chỉ để biết: kỳ chốt trước T12. Nếu kỳ đó có tính công dạy bù, đối chiếu tay với màn Công dạy; không cần mở lại kỳ."
              : "Kế toán/BLĐ quyết: mở lại kỳ để chốt lại, hoặc bù/trừ công ở kỳ đang mở (có ghi chú). Hệ thống KHÔNG tự sửa bản chốt.",
          lienQuan: {
            ...(c ? { giaoVien: c.teacherId, ngay: ymdCuaCase(c) } : {}),
            ky: ky.periodKey,
            coSo: ky.centerId,
            loai: l.loai,
          },
        }),
      );
    }
  }
  return out;
}

/**
 * T14 — học viên đã RỜI khoá (nghỉ học · chuyển đi · hoàn thành) mà dòng cần bù còn mở. KHÔNG tự huỷ: dòng là nợ học của bé, và "nợ của người đã nghỉ có còn
 * bù không" là quyết định nghiệp vụ chưa chốt (cùng tinh thần quyết định 10 về huỷ lớp). Luật chỉ NÊU RA để quản lý quyết. Bảo lưu (PAUSED) vẫn thuộc lớp nên không
 * bị nêu; chuyển lớp CÙNG khoá thì còn ghi danh ở lớp mới nên cũng không.
 */
function luatGhiDanh({ s }: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const n of s.needs) {
    if (n.status !== "PENDING" && n.status !== "SCHEDULED") continue;
    if (n.lopDaXoa) continue; // lớp đã xoá: TV-19 / luật huỷ lớp đã nói
    if (s.ghiDanhHieuLuc.has(khoa(n.studentId, n.courseIdCuaDong))) continue;
    const dangXep = n.status === "SCHEDULED";
    out.push(
      tao({
        luat: "TV-51",
        nghiemTrong: dangXep ? "MEDIUM" : "LOW",
        phanLoai: "NEEDS_MANUAL_REVIEW",
        thucThe: "MakeupNeed",
        id: n.id,
        hocVien: n.studentName,
        lyDo: `Học viên không còn ghi danh hiệu lực ở khoá này (nghỉ học / chuyển đi / đã hoàn thành) nhưng dòng cần bù còn ${dangXep ? "đang xếp trong case" : "chờ xếp"}.`,
        deXuat: dangXep
          ? "Quản lý quyết: vẫn cho học bù (giữ nguyên) hoặc gỡ bé khỏi case chưa học rồi huỷ dòng có lý do. Hệ thống KHÔNG tự gỡ — dòng là nợ học của bé."
          : "Quản lý quyết: còn bù tiếp (bé quay lại / hoàn thành khoá nhưng còn nợ) hay huỷ dòng có lý do ở /hoc-bu. Hệ thống KHÔNG tự huỷ.",
        lienQuan: { hocVien: n.studentId, khoa: n.courseIdCuaDong },
      }),
    );
  }
  return out;
}

// ─── Điểm vào ────────────────────────────────────────────────────────────────────────────────

export function chayToanVen(s: Snapshot, o: TuyChon): KetQua {
  const ctx = dungCtx(s, o);
  const trangThai = luatTrangThaiDong(ctx);
  const findings = [
    ...luatMoCoiBuoi(ctx),
    ...luatBai(ctx),
    ...luatPhi(ctx),
    ...luatBuoiVangChuaCoDong(ctx),
    ...luatKhoaTat(ctx),
    ...luatCase(ctx),
    ...luatCaseNhieuBai(ctx),
    ...trangThai.out,
    ...luatLopHuy(ctx),
    ...luatBuoiGoc(ctx),
    ...luatChuanHoaDong(ctx),
    ...luatSoLuot(ctx),
    ...luatBuoiTrung(ctx),
    ...luatXungDot(ctx),
    ...luatDonPh(ctx),
    ...luatGhiDanh(ctx),
    ...luatCongDayBu(ctx),
  ].sort(
    (a, b) =>
      NGHIEM_TRONG[a.nghiemTrong] - NGHIEM_TRONG[b.nghiemTrong] ||
      a.luat.localeCompare(b.luat) ||
      a.id.localeCompare(b.id),
  );
  const dem = Object.fromEntries((Object.keys(LUAT) as MaLuat[]).map((m) => [m, 0])) as Record<MaLuat, number>;
  for (const f of findings) dem[f.luat]++;
  return { findings, demTheoLuat: dem, boQuaLuongCu: trangThai.boQua };
}

// ─── Báo cáo ─────────────────────────────────────────────────────────────────────────────────

export type MetaBaoCao = {
  db: string;
  nhanh: string;
  luc: string;
  tuNgayYmd: string;
  /** Người dùng DB đã kết nối + có quyền GHI bảng cần bù không — lớp tự khai như các báo cáo anh em. */
  nguoiDung?: string;
  coQuyenGhi?: boolean;
};

/**
 * Chuỗi lấy từ DB đi vào markdown: bỏ xuống dòng và vô hiệu mọi dấu dựng liên kết / ảnh / thẻ HTML.
 * Tên bé đi từ form lead công khai (`childName`) qua Sale thành `Student.name`, nên nó là đầu vào
 * không tin cậy — workflow lại đưa nguyên tệp này lên job summary, nơi markdown được dựng thật.
 */
const tho = (x: string) => x.replace(/[\r\n]+/g, " ").replace(/([\\`[\]<>])/g, "\\$1");

const NHAN_NGHIEM_TRONG: MucNghiemTrong[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const NHAN_PHAN_LOAI: PhanLoai[] = ["AUTO_FIXABLE", "NEEDS_MANUAL_REVIEW", "INVALID", "SAFE"];

/**
 * Báo cáo markdown. Mỗi luật in tối đa `toiDaMoiLuat` dòng — danh sách đầy đủ ở bản JSON. Luật ra 0
 * vẫn có dòng trong bảng luật: "đã chạy và sạch" khác hẳn "chưa chạy".
 */
export function dungBaoCao(r: KetQua, meta: MetaBaoCao, toiDaMoiLuat = 40): string {
  const L: string[] = [];
  const nghiem = r.findings.filter((f) => f.nghiemTrong === "CRITICAL" || f.nghiemTrong === "HIGH").length;
  L.push("# Kiểm toàn vẹn dữ liệu Học bù (chỉ đọc)");
  L.push("");
  L.push(
    `DB \`${meta.db}\`${meta.nguoiDung ? ` · user \`${meta.nguoiDung}\`` : ""}${
      meta.coQuyenGhi === undefined ? "" : ` · ghi được: ${meta.coQuyenGhi ? "CÓ" : "KHÔNG"}`
    } · nhánh \`${meta.nhanh}\` · ${meta.luc} · xét từ ${meta.tuNgayYmd}`,
  );
  L.push("");
  L.push(
    nghiem === 0
      ? `**Kết luận: KHÔNG có phát hiện CRITICAL/HIGH** (${r.findings.length} phát hiện mức thấp hơn).`
      : `**Kết luận: CẦN XỬ LÝ — ${nghiem} phát hiện CRITICAL/HIGH** trên tổng ${r.findings.length}.`,
  );
  L.push("");
  L.push("## Tổng hợp theo mức × phân loại");
  L.push("");
  L.push(`| | ${NHAN_PHAN_LOAI.join(" | ")} | Tổng |`);
  L.push(`| --- | ${NHAN_PHAN_LOAI.map(() => "---:").join(" | ")} | ---: |`);
  for (const m of NHAN_NGHIEM_TRONG) {
    const hang = NHAN_PHAN_LOAI.map((p) => r.findings.filter((f) => f.nghiemTrong === m && f.phanLoai === p).length);
    L.push(`| ${m} | ${hang.join(" | ")} | ${hang.reduce((a, b) => a + b, 0)} |`);
  }
  L.push("");
  L.push("## Luật đã chạy");
  L.push("");
  L.push("| Mã | Luật | Phát hiện |");
  L.push("| --- | --- | ---: |");
  for (const m of Object.keys(LUAT) as MaLuat[]) L.push(`| ${m} | ${LUAT[m]} | ${r.demTheoLuat[m]} |`);
  L.push("");
  if (r.boQuaLuongCu > 0) {
    L.push(`Bỏ qua có chủ đích ${r.boQuaLuongCu} dòng của luồng học bù CŨ (có \`makeupSessionId\`): chúng không có bản ghi trong case nên luật case không áp dụng.`);
    L.push("");
  }
  L.push("## Luật CHƯA chạy");
  L.push("");
  L.push("| Mã | Luật | Làm ở | Vì sao chưa |");
  L.push("| --- | --- | --- | --- |");
  for (const h of LUAT_HOAN) L.push(`| ${h.ma} | ${h.ten} | ${h.task} | ${h.lyDo} |`);
  L.push("");
  for (const m of Object.keys(LUAT) as MaLuat[]) {
    const ds = r.findings.filter((f) => f.luat === m);
    if (ds.length === 0) continue;
    L.push(`## ${m} — ${LUAT[m]} (${ds.length})`);
    L.push("");
    for (const f of ds.slice(0, toiDaMoiLuat)) {
      L.push(
        `- **${f.nghiemTrong} · ${f.phanLoai}** · ${f.thucThe} \`${f.id}\`${f.hocVien ? ` · ${tho(f.hocVien)}` : ""}`,
      );
      L.push(`  - ${tho(f.lyDo)}`);
      L.push(`  - Đề xuất: ${tho(f.deXuat)}`);
    }
    if (ds.length > toiDaMoiLuat) L.push(`- … và ${ds.length - toiDaMoiLuat} phát hiện nữa (xem bản JSON).`);
    L.push("");
  }
  return L.join("\n");
}
