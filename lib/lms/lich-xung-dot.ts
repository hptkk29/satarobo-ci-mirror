// lib/lms/lich-xung-dot.ts — LÕI THUẦN của kiểm tra TRÙNG LỊCH đa nguồn (T09, 08/10/2026). Không chạm DB.
//
// Trước T09 "trùng lịch" có BA bản, mỗi bản nhìn một tập nguồn khác nhau:
//   · lớp chính (`lib/lms/schedule-conflict.ts`)  — chỉ thấy `ClassSession`; GV + phòng; KHÔNG có học viên;
//   · lớp trial (`lop-trial/_lib/queries.ts`)     — trial + lớp chính; chỉ GV; chỉ để vẽ "note đỏ";
//   · case học bù (`case-db.ts`)                   — KHÔNG kiểm gì; chỉ checker T01 (TV-25/26/27) nhìn lại sau khi đã ghi.
// Hệ quả (HB-28): lớp chính và lớp trial không thấy `MakeupCase`, nên xếp một buổi lớp lên đúng giờ của một case đã chốt là qua;
// và case học bù được xếp chồng lên GV/phòng/học viên đang bận mà không ai nói.
//
// Tệp này là phần dùng CHUNG: kiểu dữ liệu một "mục lịch bận", phép so trùng, và cách dựng câu nói cho người dùng. Đọc DB nằm ở
// `lib/lms/schedule-conflict.ts` (đã có sẵn, mở rộng chứ không dựng engine thứ hai). `overlaps` vẫn là primitive của
// `lib/lms/scheduling.ts` — checker T01 cũng dùng nó.
//
// QUY TẮC TRÙNG (không đổi): hai khoảng nửa-mở giao nhau ⇔  a.start < b.end  VÀ  b.start < a.end.
//   18:00–19:00 và 19:00–20:00  ⇒ KHÔNG trùng.      18:00–19:00 và 18:59–20:00  ⇒ TRÙNG.
import { overlaps } from "@/lib/lms/scheduling";
import { vnDateAt, vnParts } from "@/lib/time/vn";

/** Ba nguồn lịch có thật trong repo. Thêm nguồn mới = thêm một giá trị ở đây + một hàm đọc ở `schedule-conflict.ts`. */
export type NguonLich = "CLASS_SESSION" | "TRIAL_CLASS_SESSION" | "MAKEUP_CASE";
export const NGUON_LICH: readonly NguonLich[] = ["CLASS_SESSION", "TRIAL_CLASS_SESSION", "MAKEUP_CASE"];

/** Một khoảng thời gian đang BẬN, kèm đủ dữ liệu để người gọi tự dựng câu nói. */
export type MucLich = {
  nguon: NguonLich;
  /** id của bản ghi nguồn (ClassSession.id · TrialClassSession.id · MakeupCase.id). */
  id: string;
  /** Tên để hiện: tên lớp / tên lớp trải nghiệm / "Case dạy bù". KHÔNG bao giờ rỗng. */
  tieuDe: string;
  startAt: Date;
  endAt: Date;
  teacherId: string | null;
  roomId: string | null;
  /** Cơ sở của nguồn — để người gọi quyết định được hiện tên hay ẩn danh (xem `dungThongDiep`). */
  centerId: string | null;
  /** Lớp chứa buổi (chỉ `CLASS_SESSION`) — dùng cho `exclude: { type: "CLASS" }`. */
  classId: string | null;
};

/** Mục bận của MỘT học viên: cùng hình dạng + khoá học viên. */
export type MucLichHocVien = MucLich & { hocVienId: string };

/**
 * Loại một thứ khỏi phép so (đang SỬA chính nó — không được trùng với chính nó):
 *   · `{ type: <nguồn>, id }` — đúng một bản ghi;
 *   · `{ type: "CLASS", id }` — MỌI buổi của một lớp (double-book chỉ có nghĩa GIỮA hai lớp; buổi cùng lớp dùng chung GV/phòng
 *     là bình thường).
 */
export type LoaiTru = { type: NguonLich | "CLASS"; id: string };

export type YeuCauLich = {
  startAt: Date;
  endAt: Date;
  teacherId?: string | null;
  roomId?: string | null;
  /** Học viên cần kiểm (xếp case / thêm bé vào case). Bỏ trống ⇒ không kiểm chiều học viên. */
  studentIds?: readonly string[];
};

export type XungDot = Pick<MucLich, "nguon" | "id" | "tieuDe" | "startAt" | "endAt" | "teacherId" | "roomId" | "centerId" | "classId">;

export type XungDotHocVien = { studentId: string; xungDot: XungDot[] };

export type KetQuaXungDot = {
  teacherConflicts: XungDot[];
  roomConflicts: XungDot[];
  /** CHỈ những học viên bị trùng (không có phần tử rỗng); thứ tự theo `studentIds` của yêu cầu. */
  studentConflicts: XungDotHocVien[];
  coXungDot: boolean;
};

export const KHONG_XUNG_DOT: KetQuaXungDot = {
  teacherConflicts: [],
  roomConflicts: [],
  studentConflicts: [],
  coXungDot: false,
};

const rutGon = (m: MucLich): XungDot => ({
  nguon: m.nguon,
  id: m.id,
  tieuDe: m.tieuDe,
  startAt: m.startAt,
  endAt: m.endAt,
  teacherId: m.teacherId,
  roomId: m.roomId,
  centerId: m.centerId,
  classId: m.classId,
});

/** Mục này có bị `loaiTru` loại không. */
export function biLoaiTru(m: Pick<MucLich, "nguon" | "id" | "classId">, loaiTru: readonly LoaiTru[]): boolean {
  return loaiTru.some((x) => (x.type === "CLASS" ? m.classId !== null && m.classId === x.id : x.type === m.nguon && x.id === m.id));
}

/**
 * Khoảng thời gian của một bản ghi lưu NGÀY + "HH:mm" (case dạy bù, buổi trial): `date` là cột `@db.Date` = nửa đêm UTC của NGÀY VN,
 * còn giờ là đồng hồ VN. Dựng bằng `vnDateAt` chứ không bằng constructor local (Date local lệch 7 tiếng giữa máy dev và VPS).
 * Giờ không đọc được ⇒ null (không đoán — người gọi bỏ mục đó khỏi phép so thay vì chặn oan).
 */
export function khoangTuNgayGio(
  ngay: Date,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): { startAt: Date; endAt: Date } | null {
  const doc = (t: string | null | undefined): [number, number] | null => {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((t ?? "").trim());
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const s = doc(startTime);
  const e = doc(endTime);
  if (!s || !e) return null;
  const [y, mo, d] = ngay.toISOString().slice(0, 10).split("-").map(Number);
  const startAt = vnDateAt(y!, mo! - 1, d!, s[0], s[1]);
  const endAt = vnDateAt(y!, mo! - 1, d!, e[0], e[1]);
  return endAt > startAt ? { startAt, endAt } : null;
}

/**
 * Phép so trùng THUẦN. `muc` là các khoảng bận của GV/phòng; `mucHocVien` là các khoảng bận của từng học viên trong yêu cầu.
 * Chỉ so khi yêu cầu CÓ khoá tương ứng (GV/phòng/học viên) — không có khoá thì không có chiều đó. Trả TẤT CẢ trùng, không chỉ trùng đầu tiên,
 * sắp theo giờ bắt đầu rồi theo id (ổn định giữa hai lần chạy).
 */
export function timXungDot(
  dl: { muc: readonly MucLich[]; mucHocVien: readonly MucLichHocVien[] },
  yeuCau: YeuCauLich,
  loaiTru: readonly LoaiTru[] = [],
): KetQuaXungDot {
  const theoGio = (a: XungDot, b: XungDot) => a.startAt.getTime() - b.startAt.getTime() || a.id.localeCompare(b.id);
  const khung = { startAt: yeuCau.startAt, endAt: yeuCau.endAt };

  const teacherConflicts: XungDot[] = [];
  const roomConflicts: XungDot[] = [];
  for (const m of dl.muc) {
    if (biLoaiTru(m, loaiTru) || !overlaps(m, khung)) continue;
    if (yeuCau.teacherId && m.teacherId === yeuCau.teacherId) teacherConflicts.push(rutGon(m));
    if (yeuCau.roomId && m.roomId === yeuCau.roomId) roomConflicts.push(rutGon(m));
  }

  const studentConflicts: XungDotHocVien[] = [];
  for (const studentId of new Set(yeuCau.studentIds ?? [])) {
    const xungDot = dl.mucHocVien
      .filter((m) => m.hocVienId === studentId && !biLoaiTru(m, loaiTru) && overlaps(m, khung))
      .map(rutGon)
      // Một học viên có thể hiện qua hai đường (vd. lớp chính VÀ case của chính lớp đó) — gộp theo (nguồn, id).
      .filter((x, i, ds) => ds.findIndex((y) => y.nguon === x.nguon && y.id === x.id) === i)
      .sort(theoGio);
    if (xungDot.length > 0) studentConflicts.push({ studentId, xungDot });
  }
  teacherConflicts.sort(theoGio);
  roomConflicts.sort(theoGio);
  return {
    teacherConflicts,
    roomConflicts,
    studentConflicts,
    coXungDot: teacherConflicts.length + roomConflicts.length + studentConflicts.length > 0,
  };
}

// ─── Câu nói cho người dùng ─────────────────────────────────────────────────────────────────────

const gio2 = (n: number) => String(n).padStart(2, "0");
/** "18:00–19:30" theo đồng hồ VN. */
export function khungGioVn(startAt: Date, endAt: Date): string {
  const a = vnParts(startAt);
  const b = vnParts(endAt);
  return `${gio2(a.hour)}:${gio2(a.minute)}–${gio2(b.hour)}:${gio2(b.minute)}`;
}

function cumNguon(x: XungDot, anDanh: boolean): string {
  if (anDanh) {
    // Nguồn thuộc cơ sở người xem KHÔNG đọc được: chỉ nói LOẠI việc, không nói tên lớp (cùng nguyên tắc `lop-trial/_lib/queries.ts`:
    // một câu cảnh báo không được thành đường đọc dữ liệu liên cơ sở).
    return x.nguon === "CLASS_SESSION" ? "một buổi lớp chính" : x.nguon === "TRIAL_CLASS_SESSION" ? "một buổi lớp trải nghiệm" : "một case dạy bù";
  }
  return x.nguon === "CLASS_SESSION" ? `lớp ${x.tieuDe}` : x.nguon === "TRIAL_CLASS_SESSION" ? `lớp trải nghiệm ${x.tieuDe}` : `${x.tieuDe}`;
}

export type TenThamChieu = {
  giaoVien: (id: string) => string | undefined;
  phong: (id: string) => string | undefined;
  hocVien: (id: string) => string | undefined;
};

/**
 * Câu nói cho TỪNG trùng, theo mẫu của chủ dự án:
 *   "GV Nguyễn A đang có lớp Robotics 6A từ 18:00–19:30."
 *   "Phòng R01 đang được dùng bởi lớp Robotics 7B từ 18:00–19:30."
 *   "Nguyễn B đang có lịch học Robotics 6A từ 18:00–19:30."
 * `anDanh(centerId)` = true ⇒ nguồn thuộc cơ sở người xem không đọc được, chỉ nói loại việc. Mặc định KHÔNG ẩn (người gọi đã được phép).
 */
export function dungThongDiep(
  kq: KetQuaXungDot,
  ten: TenThamChieu,
  anDanh: (centerId: string | null) => boolean = () => false,
): string[] {
  const ra: string[] = [];
  for (const x of kq.teacherConflicts) {
    const tenGv = x.teacherId ? ten.giaoVien(x.teacherId) : undefined;
    ra.push(`${tenGv ? `GV ${tenGv}` : "Giáo viên"} đang có ${cumNguon(x, anDanh(x.centerId))} từ ${khungGioVn(x.startAt, x.endAt)}.`);
  }
  for (const x of kq.roomConflicts) {
    const ph = (x.roomId && ten.phong(x.roomId)) || "đã chọn";
    ra.push(`Phòng ${ph} đang được dùng bởi ${cumNguon(x, anDanh(x.centerId))} từ ${khungGioVn(x.startAt, x.endAt)}.`);
  }
  for (const h of kq.studentConflicts) {
    const tenHv = ten.hocVien(h.studentId);
    const ai = tenHv ? `Học viên ${tenHv}` : "Học viên";
    for (const x of h.xungDot) {
      const an = anDanh(x.centerId);
      // Case dạy bù đọc được thì nói "lịch học bù"; ẩn danh thì chỉ nói LOẠI việc. Lớp chính / trial: "lịch học <nguồn>".
      const noi = x.nguon === "MAKEUP_CASE" ? (an ? cumNguon(x, true) : "lịch học bù") : `lịch học ${cumNguon(x, an)}`;
      ra.push(`${ai} đang có ${noi} từ ${khungGioVn(x.startAt, x.endAt)}.`);
    }
  }
  return ra;
}

/**
 * Bản KẾT QUẢ an toàn để đưa ra ngoài (trong lỗi, trong phản hồi): nguồn thuộc cơ sở người xem KHÔNG đọc được bị gỡ tên lớp / tên case /
 * cơ sở / id — chỉ còn LOẠI nguồn và GIỜ bận (đủ để tự xử lý), cùng id giáo viên / phòng / học viên của CHÍNH thứ đang được xếp (không phải
 * dữ liệu của cơ sở khác). Phép kiểm vẫn BLOCK như thường: quyền xem KHÔNG được biến thành "không thấy ⇒ coi như không bận".
 */
export function anDanhKetQua(kq: KetQuaXungDot, anDanh: (centerId: string | null) => boolean): KetQuaXungDot {
  const gu = (x: XungDot): XungDot =>
    anDanh(x.centerId) ? { ...x, id: "", tieuDe: cumNguon(x, true), centerId: null, classId: null } : x;
  return {
    ...kq,
    teacherConflicts: kq.teacherConflicts.map(gu),
    roomConflicts: kq.roomConflicts.map(gu),
    studentConflicts: kq.studentConflicts.map((h) => ({ ...h, xungDot: h.xungDot.map(gu) })),
  };
}
