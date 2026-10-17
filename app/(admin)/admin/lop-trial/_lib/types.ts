// app/(admin)/admin/lop-trial/_lib/types.ts — GĐ2.
//
// Type THUẦN dùng chung giữa Server Component và Client Component của màn "Lớp Trial".
// KHÔNG import Prisma runtime ở đây: file này bị client component kéo theo, mà kéo
// Prisma vào bundle client là lỗi build câm ở Next.
//
// Quy ước xuyên suốt màn: mọi `Date` đã được server đổi sang chuỗi trước khi truyền
// xuống client (ISO cho mốc thời gian, "YYYY-MM-DD" cho cột chỉ mang nghĩa NGÀY).

import type { TrangThaiLop } from "@/lib/trial/trang-thai-lop";

/** Kết quả chuẩn của mọi server action trong màn này. */
export type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string; overCapacity?: boolean };

/**
 * Kết quả một phép hỏi quyền, ĐÃ QUY SẴN Ở SERVER và truyền xuống client.
 *
 * Mang theo LÝ DO chứ không phải boolean trần: một nút ẩn im lặng và một nút bấm vào
 * mới báo lỗi đều bắt người dùng tự đoán. Nút bị khoá phải nói được vì sao nó khoá
 * (luật 12 — affordance phải nói thật). Nguồn: `lib/trial/quyen-case.ts`.
 */
export type KetQuyenRow = { duoc: true } | { duoc: false; lyDo: string };

// ─── Mặt phẳng V2: lớp trải nghiệm ───────────────────────────────────────────

export type TrialClassStatusV2 = "OPEN" | "RUNNING" | "COMPLETED" | "CANCELLED";
export type TrialSessionStatusV2 = "SCHEDULED" | "COMPLETED" | "CANCELLED";
export type TrialEnrollmentStatusV2 = "ACTIVE" | "COMPLETED" | "WITHDRAWN";
export type TrialAttendanceMark = "PRESENT" | "ABSENT";

/** Một dòng ở bảng danh sách lớp. */
export type ClassRow = {
  id: string;
  code: string;
  name: string;
  status: TrialClassStatusV2;
  /** 28/08 — giờ ở CẤP LỚP đã thôi dùng; giờ thật nằm ở từng buổi. `null` = lớp mới. */
  startTime: string | null;
  endTime: string | null;
  /**
   * Tên các con đang xếp trong lớp (ghi danh còn ACTIVE), theo thứ tự xếp vào.
   *
   * 18/09/2026 — chủ dự án: "sau khi add học viên thì hiển thị ra 1 cột học viên nào,
   * bỏ cột sĩ số đi". Cột này THAY cột "Sĩ số": `hocVien.length` đã là sĩ số, nên hai
   * cột cạnh nhau chỉ là một con số nói hai lần. `capacity`/`activeUsed` gỡ khỏi type
   * luôn — để `tsc` chỉ ra ngay nếu còn chỗ nào đọc, chứ không để lại trường chết.
   */
  hocVien: string[];
  /**
   * NGÀY mở lớp, dạng "YYYY-MM-DD" — `null` với lớp tạo TRƯỚC 22/09/2026.
   *
   * Sale chọn lớp THEO NGÀY hẹn khách, nên đây là cột họ đọc đầu tiên. Lớp cũ hiện
   * gạch chứ không ẩn đi: chúng vẫn đang chạy và vẫn xếp học viên được.
   */
  ngayMo: string | null;
  /** Khung giờ lớp mở, ví dụ "17:30–21:00". `null` với lớp cũ. */
  khungGio: string | null;
  /**
   * Sale phụ trách lớp. `null` = không suy ra được (lớp cũ, chưa có con nào xếp vào).
   *
   * `suyTuLead = true` nghĩa là tên này KHÔNG phải người tạo lớp (lớp tạo trước
   * 18/09/2026 nên `createdById` là NULL) mà suy từ Sale phụ trách lead của các con
   * trong lớp. Panel PHẢI nói rõ điều đó — nhãn không được nhận vơ (luật 12).
   *
   * `soSaleKhac` > 0 khi lớp chứa con của NHIỀU Sale khác nhau (chỉ xảy ra ở nhánh suy
   * từ lead). Hiện một tên và im về những người còn lại là nói dối bằng cách bỏ bớt.
   */
  sale: { ten: string; suyTuLead: boolean; soSaleKhac: number } | null;
  /**
   * 23/09 — "Sale có case trial": tên những người đã MỞ case còn sống trong lớp, theo
   * thứ tự case. Rỗng ⇒ màn rơi về `sale` (suy từ lead) cho lớp cũ không lưu người mở.
   */
  saleCase: string[];
  /** Số case còn sống (không tính case đã huỷ). */
  soCase: number;
  /**
   * Case SCHEDULED sớm nhất từ hôm nay trở đi — ngày "YYYY-MM-DD" + giờ. `null` = không
   * còn case nào sắp tới.
   */
  caseKeTiep: { ngay: string; gio: string } | null;
  /** Trạng thái HIỂN THỊ (`lib/trial/trang-thai-lop.ts`) — ngày lớp đã qua là "Đã đóng". */
  trangThai: TrangThaiLop;
};

/** Một buổi của lớp, kèm bản đồ điểm danh đã lưu. */
export type SessionRow = {
  id: string;
  seq: number;
  /** ISO của mốc UTC-midnight (cột `@db.Date`). */
  date: string;
  startTime: string;
  endTime: string;
  status: TrialSessionStatusV2;
  /** 28/08 — giáo viên dạy BUỔI NÀY. Lớp không còn cột giáo viên; đây là nguồn duy nhất. */
  teacherId: string | null;
  /** Phòng của BUỔI NÀY. */
  roomId: string | null;

  /**
   * 23/09/2026 — AI TẠO case này. `null` = buổi tạo trước hôm đó (cột không backfill).
   *
   * Chỉ để HIỂN THỊ và để server quy ra quyền. Client KHÔNG tự so `createdById === me`
   * để bật/tắt nút: luật sống ở `lib/trial/quyen-case.ts` và server đã quy sẵn thành
   * `quyenSua`/`quyenXoa` dưới đây. Hai bản của một luật là bản sẽ trôi lệch.
   */
  createdById: string | null;
  /** Tên người tạo case, đã tra từ `User`. `null` = case cũ hoặc tài khoản đã xoá. */
  nguoiTao: string | null;
  /** Server đã quy sẵn: người đang xem có sửa được giờ/phòng/GV của case này không. */
  quyenSua: KetQuyenRow;
  /** Server đã quy sẵn: có xoá được case này không (cổng thứ hai — xem `quyenXoaCase`). */
  quyenXoa: KetQuyenRow;
  /**
   * Server đã quy sẵn: có DỜI GIỜ / NGÀY case này được không (`quyenDoiGioCase`). Khác
   * `quyenSua`: chủ case giữ khách của Sale khác vẫn đổi được phòng / giáo viên, nhưng
   * không dời được giờ hẹn của phụ huynh người khác.
   */
  quyenDoiGio: KetQuyenRow;
  /**
   * Server đã quy sẵn (`quyenDiemDanhCase`): người đang xem có ĐIỂM DANH + HOÀN TẤT
   * case này được không. Chủ dự án 23/09: Sale không làm thay Sale khác (lớp theo khung).
   */
  quyenDiemDanh: KetQuyenRow;
  /** trialEnrollmentId → điểm danh đã lưu. Không có khoá = chưa điểm danh em đó. */
  attendance: Record<string, { status: TrialAttendanceMark; note: string | null }>;
  /**
   * trialEnrollmentId → giáo viên ĐÃ chấm phiếu rubric cho em đó Ở BUỔI NÀY.
   * Không có khoá = chưa chấm.
   *
   * Theo TỪNG BUỔI chứ không theo ca: GĐ4 khoá phiếu bằng cặp (ca, buổi) nên một ca có
   * nhiều phiếu. Gộp về mức ca là dòng buổi 1 sáng nút "Xuất PDF" nhờ phiếu của buổi 2.
   */
  danhGia: Record<string, true>;
  /**
   * 29/09/2026 — giáo viên của case VẮNG vì đơn nghỉ / đổi ca đã duyệt
   * (`lib/trial/gv-vang-case.ts`). `null` = không có bằng chứng vắng. Có giá trị ⇒ case
   * hiện nhãn "cần đổi GV" và KHÔNG nhận thêm bé (server chặn cùng luật).
   */
  gvVang: { lyDo: string } | null;
};

/** Một học viên trong lớp trải nghiệm (một "ca" trải nghiệm). */
export type EnrollmentRow = {
  id: string;
  leadChildId: string | null;
  childName: string;
  parentName: string | null;
  phone: string | null;
  leadId: string | null;
  status: TrialEnrollmentStatusV2;
  // ─── GĐ3 ───────────────────────────────────────────────────────────────────
  /** Buổi ca này đang được xếp vào. null = chưa xếp buổi nào. */
  scheduledSessionId: string | null;
  /** Sale ĐỀ XUẤT. Chỉ còn ý nghĩa khi Đào tạo chưa chốt. */
  gvDeXuatId: string | null;
  /** Đào tạo PHÂN CÔNG. Có giá trị = đã chốt, Sale không sửa đề xuất được nữa. */
  gvPhanCongId: string | null;
  /** Số lần ca này đã bị dời lịch. */
  rescheduleCount: number;

  // ─── 23/09/2026 — ai gỡ được bé này ────────────────────────────────────────
  /**
   * Tên Sale đang phụ trách lead của bé. `null` = lead chưa ai phụ trách hoặc đã xoá.
   * Hiện trên dòng để người xếp lịch biết phải hỏi ai, và ghép vào câu từ chối.
   */
  saleTen: string | null;
  /**
   * Server đã quy sẵn bằng `quyenGoHocVien`. KHÔNG truyền `assignedToId` thô xuống
   * client rồi để client tự so: `laLeadCuaToi` còn đọc cờ chia sẻ lead (`isLeadSharing
   * Enabled`) vốn chỉ có ở server, nên bản client sẽ lệch đúng vào ca bật cờ.
   */
  quyenGo: KetQuyenRow;
  /** Server đã quy sẵn bằng `quyenChuyenCase` — cùng luật với `quyenGo`, câu chữ nói về CHUYỂN. */
  quyenChuyen: KetQuyenRow;

  // ─── 26/09/2026 — khoá học của bé (`lib/trial/khoa-truoc-case.ts`) ─────────────
  /**
   * Khoá HIỆU LỰC của bé (`khoaHieuLucCuaBe`: khoá của bé, trống thì khoá quan tâm của
   * lead) — giá trị của ô chọn khoá, và là thứ giáo viên thấy.
   */
  khoaHocId: string | null;
  /** `khoaHocId` đang lấy từ khoá quan tâm của LEAD (bé chưa có khoá riêng). */
  khoaTuLead: boolean;
  /**
   * Tên khoá để HIỂN THỊ: khoá của bé; bé chưa có thì khoá của LỚP (chỉ lớp cũ còn cột
   * này). `null` = không biết khoá gì — màn in "Chưa chọn khoá".
   */
  khoaHocTen: string | null;
};

/** Một lựa chọn trong ô "Khoá học" của bé. */
export type KhoaHocOption = { id: string; name: string };

/** Ứng viên trả về từ ô tìm học viên. */
export type Candidate = {
  leadChildId: string;
  childName: string;
  parentName: string | null;
  phone: string | null;
  leadStatus: string;
};

/** Lựa chọn cho dropdown (giáo viên, phòng, cơ sở, lớp chính thức). */
export type Option = { id: string; name: string };

/**
 * Phòng học kèm cơ sở sở hữu. `centerId === null` = phòng DÙNG CHUNG (không gắn cơ
 * sở nào) nên luôn được phép chọn.
 *
 * Mọi dropdown phòng BẮT BUỘC lọc theo cơ sở của đối tượng đang sửa — đổ hết phòng
 * của mọi cơ sở là mời người dùng xếp buổi CS1 vào phòng CS2, và lỗi đó chỉ lộ ra
 * khi có người tới lớp.
 */
export type RoomOption = Option & { centerId: string | null };

// ─── Mặt phẳng V1: lịch hẹn học thử ──────────────────────────────────────────

export type BookingStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "ATTENDED"
  | "MISSED"
  | "POSTPONED"
  | "ENROLLED"
  | "REJECTED";

/** Một buổi hẹn học thử 1-1 gắn thẳng vào lead. */
export type BookingRow = {
  id: string;
  leadId: string;
  parentName: string | null;
  phone: string | null;
  childName: string | null;
  /** Cơ sở của buổi hẹn — dùng để lọc dropdown phòng. null = buổi chưa gán cơ sở. */
  centerId: string | null;
  centerName: string | null;
  status: BookingStatus;
  /**
   * Giờ hẹn theo ĐỒNG HỒ VN, dạng "YYYY-MM-DDTHH:mm" — đúng định dạng
   * `<input type="datetime-local">` cần.
   *
   * ⚠️ CỐ Ý không truyền ISO xuống client: màn cũ dựng chuỗi này bằng
   * `date.getFullYear()`… của MÁY NGƯỜI DÙNG, nên máy đặt múi giờ khác +07 sẽ
   * hiện sai giờ rồi lưu đè sai luôn. Nay server tính bằng `vnParts` và client
   * chỉ hiển thị nguyên văn.
   */
  scheduledAtVn: string;
  teacherId: string | null;
  teacherName: string | null;
  roomId: string | null;
  classId: string | null;
  notes: string | null;
};
