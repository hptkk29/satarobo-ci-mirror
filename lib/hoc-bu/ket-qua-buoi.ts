// lib/hoc-bu/ket-qua-buoi.ts — MÔ HÌNH ĐỌC DUY NHẤT "buổi vắng này đã bù chưa, bù thế nào" (T08, 08/10/2026). THUẦN, không chạm DB.
//
// Mọi màn hiển thị kết quả học bù của MỘT buổi gốc (điểm danh admin, điểm danh site GV, hồ sơ học viên, cổng phụ huynh ở T11) đọc qua ĐÂY —
// không màn nào tự suy từ `Attendance.makeupStatus` hay từ trạng thái case nữa. Lý do: hai nguồn đó trả lời hai câu hỏi khác nhau.
//   · `makeupStatus` là DẤU (MADE_UP / NEEDS_MAKEUP), không biết bù ngày nào, ai dạy, đánh giá gì, đã thử mấy lần;
//   · case chỉ biết cả buổi, không biết bài nào của bé đã xong.
// Mô hình T07 (mục = một buổi vắng trong một case) mới trả lời được cả ba.
//
// LUẬT (chốt 08/10/2026, mục T08 của bản duyệt):
//   · Điểm danh GỐC không bao giờ đổi vì học bù: "Vắng có phép" vẫn là "Vắng có phép"; nhãn học bù là PHẦN THÊM ("Vắng có phép ✓ Đã học bù ngày …").
//   · KẾT QUẢ HIỆN TẠI = lần bù THÀNH CÔNG (COMPLETED) mới nhất; nếu chưa có thì lần ĐÃ XẾP đang chờ. KHÔNG bao giờ lấy một lần vắng cũ làm kết quả hiện tại
//     (một buổi từng xếp mà bé vắng, rồi xếp lại và bù xong ⇒ hiện "đã bù", lần vắng nằm ở lịch sử).
//   · LỊCH SỬ liệt kê MỌI lần thử theo thời gian (kể cả lần vắng, lần chưa xong, lần bị gỡ) — để người xem hiểu vì sao còn nợ.
//   · Dòng không có điểm danh gốc (chuyển đổi đơn, tạo tay) vẫn đọc được — mô hình đi từ DÒNG CẦN BÙ, không từ bản ghi điểm danh.
import { normalizeEvalRatings } from "@/lib/lms/session-eval-rubric";
import type { MakeupItemResult } from "@prisma/client";

export type LoaiLanBu =
  | "DA_XONG" // bé có mặt và học XONG bài này
  | "CHUA_XONG" // bé có mặt nhưng CHƯA xong bài này
  | "VANG_BUOI_BU" // bé được xếp nhưng VẮNG buổi bù
  | "DA_XEP" // đã xếp, buổi bù chưa diễn ra / chưa điểm danh
  | "DA_GO"; // bị gỡ khỏi case trước khi điểm danh (không phải một lần thử thật — UI thường ẩn)

export type LanBu = {
  mucId: string;
  caseId: string;
  loai: LoaiLanBu;
  /** Ngày buổi bù (`@db.Date`, nửa đêm UTC của ngày VN) và khung giờ. */
  ngay: Date;
  gioBatDau: string;
  gioKetThuc: string;
  giaoVienId: string;
  phongId: string | null;
  /** Cơ sở của buổi bù (có thể khác cơ sở của lớp gốc nếu case ở cơ sở khác). */
  coSoId: string;
  lessonId: string | null;
  /** Đánh giá của giáo viên cho RIÊNG bài này (không phải nhận xét của buổi gốc). */
  danhGia: string | null;
  /** Bảng 9 tiêu chí của CÙNG phiếu (đã chuẩn hoá đủ 9 khoá, mức 1–5); null = phiếu chưa chấm bảng. Cùng bản ghi với `danhGia`. */
  phieu: Record<string, number> | null;
  hoanTatLuc: Date | null;
};

/**
 * KHONG_CAN_BU = không có dòng cần bù · DA_HUY_KHONG_BU = quản lý CHỦ Ý huỷ (có `waivedAt`) · KHONG_CON_CAN_BU = dòng tự thu hồi vì buổi gốc đã được
 * sửa sang "có mặt" (huỷ KHÔNG do người quyết định bù hay không).
 */
export type TrangThaiBu = "KHONG_CAN_BU" | "CHO_XEP" | "DA_XEP" | "DA_BU" | "DA_HUY_KHONG_BU" | "KHONG_CON_CAN_BU";

export type KetQuaBuoi = {
  sessionId: string;
  studentId: string;
  needId: string | null;
  trangThai: TrangThaiBu;
  /** Lần thành công mới nhất (DA_BU) hoặc lần đã xếp đang chờ (DA_XEP); null với CHO_XEP / KHONG_CAN_BU / DA_HUY_KHONG_BU. */
  hienTai: LanBu | null;
  /** Mọi lần thử theo thứ tự thời gian tăng dần. */
  lichSu: LanBu[];
  /** Câu NGẮN cho người đọc, vd. "Đã học bù ngày 15/10/2026" — KHÔNG gồm nhãn điểm danh gốc (xem `nhanKetHop`). */
  nhan: string;
  /** Dòng cần bù nói "đã bù xong" nhưng không có lần COMPLETED nào (hoặc ngược lại) và KHÔNG phải luồng cũ ⇒ dữ liệu lệch, cần người nhìn. */
  khongKhop: boolean;
};

// ── Dữ liệu vào (hình dạng của câu đọc) ─────────────────────────────────────────────────────────────────────────────
export type MucDoc = {
  id: string;
  result: MakeupItemResult;
  /** Bản gương cũ: ABSENT = bé vắng buổi bù, RELEASED = bị gỡ. Chỉ để phân biệt hai nghĩa của result RELEASED. */
  status: "PLACED" | "PRESENT" | "ABSENT" | "RELEASED";
  lessonId: string | null;
  teacherEvaluation: string | null;
  /** Bảng 9 tiêu chí đã lưu (JSON thô, null = chưa chấm). BẮT BUỘC khai (luật 7) — quên `select` cột này là phiếu mất bảng ở buổi gốc mà không lỗi nào báo. */
  evaluationRubric: unknown;
  completedAt: Date | null;
  createdAt: Date;
  case: {
    id: string;
    status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
    date: Date;
    startTime: string;
    endTime: string;
    teacherId: string;
    roomId: string | null;
    centerId: string;
  };
};

export type DongDoc = {
  id: string;
  studentId: string;
  missedSessionId: string;
  status: "PENDING" | "SCHEDULED" | "COMPLETED" | "CANCELLED";
  waivedAt: Date | null;
  /** Dòng của luồng cũ (xếp vào buổi lớp khác) — không có mục trong case. */
  makeupSessionId: string | null;
  muc: readonly MucDoc[];
};

/** `Date` (nửa đêm UTC của ngày VN) → `dd/MM/yyyy`. Tự cắt từ ISO để không phụ thuộc múi giờ máy chạy. */
export function ymdSangDmy(d: Date): string {
  const [y, m, ng] = d.toISOString().slice(0, 10).split("-");
  return `${ng}/${m}/${y}`;
}

function loaiCuaMuc(m: MucDoc): LoaiLanBu {
  switch (m.result) {
    case "COMPLETED":
      return "DA_XONG";
    case "NOT_COMPLETED":
      return "CHUA_XONG";
    case "RELEASED":
      return m.status === "ABSENT" ? "VANG_BUOI_BU" : "DA_GO";
    case "PLANNED":
      // Mục còn chờ trong case đã HUỶ là dữ liệu hỏng (huỷ case nhả mục) — không coi là đang chờ.
      return m.case.status === "CANCELLED" ? "DA_GO" : "DA_XEP";
  }
}

const thuTu = (a: MucDoc, b: MucDoc) =>
  a.case.date.getTime() - b.case.date.getTime() ||
  a.case.startTime.localeCompare(b.case.startTime) ||
  a.createdAt.getTime() - b.createdAt.getTime() ||
  a.id.localeCompare(b.id);

function lanBu(m: MucDoc): LanBu {
  return {
    mucId: m.id,
    caseId: m.case.id,
    loai: loaiCuaMuc(m),
    ngay: m.case.date,
    gioBatDau: m.case.startTime,
    gioKetThuc: m.case.endTime,
    giaoVienId: m.case.teacherId,
    phongId: m.case.roomId,
    coSoId: m.case.centerId,
    lessonId: m.lessonId,
    danhGia: m.teacherEvaluation,
    phieu: m.evaluationRubric === null || m.evaluationRubric === undefined ? null : normalizeEvalRatings(m.evaluationRubric),
    hoanTatLuc: m.result === "COMPLETED" ? m.completedAt : null,
  };
}

/** Câu ngắn theo trạng thái + lần hiện tại. */
export function nhanTuKetQua(trangThai: TrangThaiBu, hienTai: LanBu | null): string {
  switch (trangThai) {
    case "KHONG_CAN_BU":
      return "";
    case "CHO_XEP":
      return "Chờ xếp học bù";
    case "DA_XEP":
      return hienTai ? `Đã xếp học bù ngày ${ymdSangDmy(hienTai.ngay)} lúc ${hienTai.gioBatDau}` : "Đã xếp học bù";
    case "DA_BU":
      return hienTai ? `Đã học bù ngày ${ymdSangDmy(hienTai.ngay)}` : "Đã học bù";
    case "DA_HUY_KHONG_BU":
      return "Đã huỷ — không bù";
    case "KHONG_CON_CAN_BU":
      return "Không còn cần bù";
  }
}

/**
 * Kết quả học bù của MỘT buổi gốc của MỘT học viên. `dong = null` = không có dòng cần bù (đi học, hay buổi không cần bù).
 * Thuần: cùng đầu vào cho cùng đầu ra; KHÔNG đọc điểm danh gốc — nên đổi trạng thái điểm danh gốc không làm đổi kết quả ở đây.
 */
export function dungKetQuaBuoi(p: { sessionId: string; studentId: string; dong: DongDoc | null }): KetQuaBuoi {
  const { sessionId, studentId, dong } = p;
  if (!dong) {
    return { sessionId, studentId, needId: null, trangThai: "KHONG_CAN_BU", hienTai: null, lichSu: [], nhan: "", khongKhop: false };
  }
  const muc = [...dong.muc].sort(thuTu);
  const lichSu = muc.map(lanBu);
  const trangThai: TrangThaiBu =
    dong.status === "COMPLETED"
      ? "DA_BU"
      : dong.status === "SCHEDULED"
        ? "DA_XEP"
        : dong.status === "CANCELLED"
          ? dong.waivedAt !== null
            ? "DA_HUY_KHONG_BU"
            : "KHONG_CON_CAN_BU"
          : "CHO_XEP";

  let hienTai: LanBu | null = null;
  if (trangThai === "DA_BU") {
    // Lần THÀNH CÔNG mới nhất — không phải lần thử cuối cùng (một lần vắng cũ hay một lần chưa xong không bao giờ che nó).
    hienTai = [...lichSu].reverse().find((l) => l.loai === "DA_XONG") ?? null;
  } else if (trangThai === "DA_XEP") {
    hienTai = [...lichSu].reverse().find((l) => l.loai === "DA_XEP") ?? null;
  }

  const coLanXong = lichSu.some((l) => l.loai === "DA_XONG");
  const laLuongCu = dong.makeupSessionId !== null;
  const khongKhop =
    !laLuongCu &&
    ((trangThai === "DA_BU" && !coLanXong) || (trangThai !== "DA_BU" && coLanXong) || (trangThai === "DA_XEP" && hienTai === null));

  return { sessionId, studentId, needId: dong.id, trangThai, hienTai, lichSu, nhan: nhanTuKetQua(trangThai, hienTai), khongKhop };
}

/**
 * Nhãn GHÉP cho màn điểm danh / hồ sơ: nhãn điểm danh GỐC + phần học bù. Điểm danh gốc đi nguyên (không bị thay bằng "đã bù").
 *   "Vắng có phép" + DA_BU  ⇒ "Vắng có phép ✓ Đã học bù ngày 15/10/2026"
 *   "Vắng có phép" + CHO_XEP ⇒ "Vắng có phép · Chờ xếp học bù"
 */
export function nhanKetHop(nhanGoc: string, kq: KetQuaBuoi | null | undefined): string {
  if (!kq || kq.trangThai === "KHONG_CAN_BU") return nhanGoc;
  const them = kq.nhan;
  if (!them) return nhanGoc;
  return kq.trangThai === "DA_BU" ? `${nhanGoc} ✓ ${them}` : `${nhanGoc} · ${them}`;
}

/** Dạng GỌN, chỉ chuỗi — đi qua ranh giới server→client / server action mà không mang `Date`. `null` = không có gì để hiện. */
export type KetQuaBuoiGon = { trangThai: TrangThaiBu; nhan: string; danhGia: string | null; coPhieu: boolean };

export function gonKetQua(kq: KetQuaBuoi | null | undefined): KetQuaBuoiGon | null {
  if (!kq || kq.trangThai === "KHONG_CAN_BU") return null;
  return {
    trangThai: kq.trangThai,
    nhan: kq.trangThai === "DA_BU" ? `✓ ${kq.nhan}` : kq.nhan,
    danhGia: kq.hienTai?.danhGia ?? null,
    coPhieu: kq.hienTai?.phieu != null,
  };
}

export const khoaCapBuoi = (sessionId: string, studentId: string): string => `${sessionId}|${studentId}`;
