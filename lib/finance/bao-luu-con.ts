// lib/finance/bao-luu-con.ts — BẢO LƯU MỘT CON: phần TIỀN. THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN F2 · US-18 "Bảo lưu và học lại"
//
//   *"Là Sale, tôi muốn bảo lưu một con trong khi các con khác vẫn học và đóng tiền, để
//   giữ tiền của con đó mà không tính quá hạn."*
//
// ⚠️ **F2 KHÔNG DỰNG CƠ CHẾ BẢO LƯU THỨ HAI.** Đo trước khi viết (luật 12) — bốn trong
// năm điều kiện nghiệm thu của US-18 ĐÃ CÓ SẴN trong repo:
//
//   · AC1 (ghi danh PAUSED)        → `StudentReserve` + `reserveStudentAction`
//                                    (`app/(admin)/admin/students/_actions.ts`) và
//                                    `approveReserveRequest` (`lib/students/reserve-service.ts`);
//   · AC4 (học lại)                → `resumeStudentReserveAction`;
//   · AC5 (quá ngày → nhắc sale,
//          KHÔNG tự dừng)          → cron `reserve-expiry` (`app/api/cron/reserve-expiry`);
//   · AC3 (ưu đãi anh em giữ nguyên) → ĐÚNG SẴN vì PHIÊN E chốt *"mất ưu đãi: KHÔNG làm,
//                                    thay bằng CẢNH BÁO"* ⇒ không đường nào tự sửa ưu đãi,
//                                    nên bảo lưu không chạm được vào nó. Ghim bằng test.
//
// Còn lại đúng **AC2** — và đó là toàn bộ việc của F2:
//
//   *"Đợt chưa tới hạn dời hạn theo số ngày bảo lưu; không có đợt nào của con đó thành
//   QUA_HAN trong thời gian PAUSED."*
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO KHÔNG THÊM `OrderItemStatus.PAUSED`
//
// Cám dỗ đầu tiên là chép `PAUSED` xuống `OrderItem.status` cho giống `STOPPED` (PHIÊN D).
// Bỏ hướng đó sau khi đo, vì ba lý do:
//
//   1. **`StudentReserve` đã là nguồn sự thật**, và chính nó ghi trong chú thích của mình:
//      *"suspendedUntil mô hình hoá qua `StudentReserve.expectedEndAt` (đã có, không nhân
//      đôi field)"*. Thêm cột thứ hai là mở một đường LỆCH — và đường lệch ấy sẽ lệch, vì
//      có tới BA cửa bảo lưu (màn học viên · duyệt yêu cầu phụ huynh · học lại) mà chỉ cần
//      một cửa quên ghi.
//   2. `STOPPED` **phải** nằm trên `OrderItem` vì nó ĐỔI PHÉP TÍNH (`usedValue` thay học
//      phí gốc). `PAUSED` KHÔNG đổi số nào: bé bảo lưu vẫn nợ nguyên học phí — chỉ cái
//      ĐỒNG HỒ được giữ lại. Trạng thái không đổi số thì không cần nằm trong sổ tiền.
//   3. Phép suy "bé này đang bảo lưu" cần một điều kiện mà một cột boolean không mang nổi:
//      lượt bảo lưu có thể nhắm **một ghi danh** (`StudentReserve.enrollmentId`) hoặc
//      **cả học viên** (`enrollmentId = NULL`). Xem `dongNaoDangBaoLuu` dưới.
//
// ⚠️ **Đổi lại, thứ CẦN ghi xuống sổ là PHÉP DỜI HẠN đã áp** — không phải trạng thái.
// Hai cột mới trên `PaymentRequest` (`pauseShiftReserveId` · `pauseShiftDays`) trả lời
// đúng hai câu mà `StudentReserve` không trả lời được: *"đợt này đã được dời chưa, vì lượt
// bảo lưu nào"* (chống dời hai lần) và *"dời bao nhiêu ngày"* (để màn hình nói thật).

import { vnDateOnly } from "@/lib/time/vn";

/** Một đợt thu của con, chỉ phần cần cho phép dời hạn. */
export type DotDeDoiHan = {
  id: string;
  installmentNo: number;
  dueDate: Date | null;
  status: "PENDING" | "PARTIAL" | "PAID" | "VOID";
  /** Lượt bảo lưu ĐÃ dời đợt này (`PaymentRequest.pauseShiftReserveId`). */
  pauseShiftReserveId: string | null;
  /** Tổng số ngày đợt này đã bị dời vì bảo lưu. */
  pauseShiftDays: number | null;
};

export type DoiHanMotDot = {
  id: string;
  installmentNo: number;
  hanCu: Date;
  hanMoi: Date;
  /** Cộng dồn — bé bảo lưu hai lượt thì đợt mang tổng cả hai. */
  tongNgayDaDoi: number;
};

export type KeHoachDoiHan = {
  soNgay: number;
  doi: DoiHanMotDot[];
  /** Đợt KHÔNG dời, kèm lý do — để màn hình và nhật ký nói thật thay vì im lặng. */
  boQua: { id: string; installmentNo: number; vi: LyDoBoQua }[];
};

export type LyDoBoQua =
  /** Đợt đã đóng xong hoặc đã huỷ — không còn hạn nào để dời. */
  | "DA_XONG"
  /** Đợt không có hạn ⇒ không có gì để dời (cron nhắc nợ cũng không nhắc nó). */
  | "KHONG_CO_HAN"
  /** Hạn đã QUA trước khi bảo lưu — nợ trễ từ trước, bảo lưu không xoá việc đã xảy ra. */
  | "DA_QUA_HAN_TRUOC"
  /** Chính lượt bảo lưu này đã dời đợt này rồi — bấm lại không dời thêm. */
  | "DA_DOI_ROI";

const MS_NGAY = 24 * 60 * 60 * 1000;

/**
 * Số ngày của một lượt bảo lưu — đếm theo **NGÀY LỊCH giờ VN**, không theo hiệu số mili giây.
 *
 * ⚠️ Đây không phải chi tiết làm đẹp. `startedAt` là `now()` (có giờ, thường là giữa buổi
 * chiều) còn `expectedEndAt` từ ô chọn ngày là **nửa đêm**. Lấy hiệu mili giây rồi:
 *   · `Math.floor` → bảo lưu 22/09 → 22/10 ra **29** ngày;
 *   · `Math.ceil`  → cùng ca ấy ra **30**, nhưng ca 22/09 00:00 → 22/10 00:00 vẫn 30, và
 *     một `startedAt` lệch vài giây sang hôm trước lại thành **31**.
 * Người vận hành gõ "30 ngày" và phải nhận đúng 30 ngày. Đếm theo ngày lịch cho ra 30 ở
 * MỌI giờ trong ngày, nên nó là phép đếm duy nhất không phụ thuộc lúc ai bấm nút.
 *
 * ⚠️ Giờ VN, không giờ máy: Vercel chạy UTC. `vnDateOnly` ép về nửa đêm VN (`lib/time/vn.ts`).
 *
 * Trả `0` khi ngày quay lại không sau ngày bắt đầu — người gọi hiểu là "không có gì để dời".
 */
export function soNgayBaoLuu(startedAt: Date, expectedEndAt: Date | null): number {
  if (!expectedEndAt) return 0;
  const a = vnDateOnly(startedAt).getTime();
  const b = vnDateOnly(expectedEndAt).getTime();
  return b > a ? Math.round((b - a) / MS_NGAY) : 0;
}

/** Cộng `n` ngày vào một mốc, GIỮ NGUYÊN giờ-phút của mốc đó. */
function congNgay(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_NGAY);
}

/**
 * Đợt nào được dời hạn, dời tới đâu — và đợt nào KHÔNG, vì sao.
 *
 * ⚠️ `moc` (thời điểm bảo lưu) là THAM SỐ, không `new Date()` (luật 19): phép này quyết định
 * "hạn đã qua chưa", nên một hàm rơi về đồng hồ thật là một ca test hẹn giờ nổ.
 *
 * ⚠️ **Đợt ĐÃ quá hạn trước lúc bảo lưu thì KHÔNG dời** — đây là quyết định, không phải sơ
 * suất. AC2 nói rõ *"đợt CHƯA TỚI HẠN dời hạn"*. Bảo lưu là giữ đồng hồ lại từ HÔM NAY; nó
 * không xoá việc phụ huynh đã trễ hạn từ tuần trước. Dời cả đợt đã trễ là âm thầm tha một
 * khoản nợ trễ — và sổ sẽ không còn chỗ nào nhớ rằng nó từng trễ.
 */
export function keHoachDoiHan(input: {
  dot: readonly DotDeDoiHan[];
  startedAt: Date;
  expectedEndAt: Date | null;
  /** Lượt bảo lưu đang áp — khoá chống dời hai lần. */
  reserveId: string;
  /** Thời điểm coi là "bây giờ" khi hỏi hạn đã qua chưa. Thường = `startedAt`. */
  moc: Date;
}): KeHoachDoiHan {
  const soNgay = soNgayBaoLuu(input.startedAt, input.expectedEndAt);
  const doi: DoiHanMotDot[] = [];
  const boQua: KeHoachDoiHan["boQua"] = [];

  for (const d of input.dot) {
    const bo = (vi: LyDoBoQua) => boQua.push({ id: d.id, installmentNo: d.installmentNo, vi });

    if (d.status === "PAID" || d.status === "VOID") {
      bo("DA_XONG");
      continue;
    }
    if (!d.dueDate) {
      bo("KHONG_CO_HAN");
      continue;
    }
    if (d.pauseShiftReserveId === input.reserveId) {
      bo("DA_DOI_ROI");
      continue;
    }
    if (d.dueDate.getTime() < input.moc.getTime()) {
      bo("DA_QUA_HAN_TRUOC");
      continue;
    }
    // `soNgay === 0` (không khai ngày quay lại, hoặc khai ngày không sau ngày bắt đầu) đi
    // vào đây và ra `hanMoi === hanCu`. Người gọi KHÔNG ghi gì — xem `coViecPhaiLam`.
    doi.push({
      id: d.id,
      installmentNo: d.installmentNo,
      hanCu: d.dueDate,
      hanMoi: congNgay(d.dueDate, soNgay),
      tongNgayDaDoi: (d.pauseShiftDays ?? 0) + soNgay,
    });
  }

  return { soNgay, doi, boQua };
}

/**
 * Kế hoạch này có gì để GHI không.
 *
 * ⚠️ Tách ra thành hàm riêng thay vì để người gọi tự hỏi `doi.length > 0`: bảo lưu KHÔNG
 * khai ngày quay lại vẫn cho ra một danh sách `doi` đầy đủ với `hanMoi === hanCu`. Người
 * gọi hỏi sai câu sẽ ghi một lượt `UPDATE` không đổi gì cùng một dòng nhật ký nói rằng có
 * dời — tức sổ nói dối một chuyện vô hại, đúng loại dối khó gỡ nhất về sau.
 */
export function coViecPhaiLam(ke: KeHoachDoiHan): boolean {
  return ke.soNgay > 0 && ke.doi.length > 0;
}

/** Một lượt bảo lưu đang có hiệu lực, đã quy về từng dòng hàng. */
export type BaoLuuCuaDong = {
  orderItemId: string;
  reserveId: string;
  startedAt: Date;
  expectedEndAt: Date | null;
};

/**
 * Dòng hàng nào của đơn đang thuộc một lượt bảo lưu còn hiệu lực. THUẦN — người gọi nạp dữ
 * liệu, hàm chỉ ghép.
 *
 * ⚠️ **Điều kiện ghép có HAI vế, và vế thứ hai là vế dễ quên:**
 *
 *   `reserve.enrollmentId === null`  ⇒ bảo lưu CẢ HỌC VIÊN  ⇒ khớp mọi ghi danh của em đó;
 *   `reserve.enrollmentId === X`     ⇒ bảo lưu MỘT ghi danh ⇒ chỉ khớp đúng ghi danh X.
 *
 * Bỏ vế hai là bé học hai khoá, bảo lưu một khoá, và đợt của **khoá còn đang học** cũng
 * được dời hạn + được tha quá hạn. Đó là ca thật: repo có 77/170 học viên học ≥2 lớp.
 */
export function dongNaoDangBaoLuu(input: {
  /** Dòng hàng của đơn, kèm ghi danh và học viên của nó (`null` = dòng chưa nối ghi danh). */
  dong: readonly {
    orderItemId: string;
    enrollmentId: string | null;
    studentId: string | null;
  }[];
  /** Lượt bảo lưu CÒN HIỆU LỰC của các học viên nói trên. */
  luot: readonly {
    id: string;
    studentId: string;
    enrollmentId: string | null;
    startedAt: Date;
    expectedEndAt: Date | null;
  }[];
}): Map<string, BaoLuuCuaDong> {
  const ra = new Map<string, BaoLuuCuaDong>();
  for (const d of input.dong) {
    // Dòng chưa nối ghi danh thì không suy được nó thuộc em nào ⇒ KHÔNG coi là bảo lưu.
    // Fail-closed theo chiều đúng: nhầm thành "đang bảo lưu" là tha quá hạn cho một khoản
    // không ai xin tha.
    if (!d.studentId) continue;
    const khop = input.luot.find(
      (l) =>
        l.studentId === d.studentId &&
        (l.enrollmentId === null || l.enrollmentId === d.enrollmentId),
    );
    if (!khop) continue;
    ra.set(d.orderItemId, {
      orderItemId: d.orderItemId,
      reserveId: khop.id,
      startedAt: khop.startedAt,
      expectedEndAt: khop.expectedEndAt,
    });
  }
  return ra;
}
