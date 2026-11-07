// lib/cham-cong/huy-don-mo-ta.ts — "Khi duyệt huỷ sẽ: …" (đợt 11 đơn từ). THUẦN, dùng được ở client.
//
// LUẬT 12: câu này là LỜI HỨA của nút "Duyệt huỷ" — phải nói đúng việc `HOAN_TAC_DON` (don/hoan-tac.ts)
// làm cho từng loại, kể cả loại KHÔNG tự hoàn tác được. Lưới `[HUY-W*]` (huy-don.test.ts) ghim từng
// câu vào đúng handler.
import type { WorkRequestKindV } from "@/lib/work-request";

type DonMoTa = {
  kind: WorkRequestKindV;
  leaveDurationType: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOURLY" | null;
  /** Ảnh chụp hệ quả lúc duyệt — đơn NGHỈ BUỔI DẠY có hai hình (huỷ buổi / giữ buổi + GV thay), câu mô tả phải theo hình. */
  appliedEffect?: unknown;
};

const doiTuong = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/**
 * Đơn NGHỈ BUỔI DẠY được duyệt theo hình "GIỮ buổi + GV dạy thay" (không huỷ buổi, không buổi bù) — ảnh chụp mang
 * `giuBuoi` + `sessionId` + `gvDayThay.sau` (cùng hình với đơn Dạy thay để `huyDayThay` dùng lại). MỘT chỗ quyết hình:
 * `HOAN_TAC_DON.CLASS_OFF`, `coAnhChupHoanTac` và `khiDuyetHuySe` cùng gọi hàm này — lệch là nút hứa một việc server từ chối.
 */
export function laNghiGiuBuoiGvThay(appliedEffect: unknown): boolean {
  const e = doiTuong(appliedEffect);
  return e.giuBuoi === true && typeof e.sessionId === "string" && typeof doiTuong(e.gvDayThay).sau === "string";
}

const motPhan = (d: DonMoTa) => d.leaveDurationType === "HALF_DAY_AM" || d.leaveDurationType === "HALF_DAY_PM" || d.leaveDurationType === "HOURLY";

const HOAN_PHEP = "; phần đã trừ vào quỹ phép năm lúc duyệt (nếu có) được hoàn lại đúng số phút";

/** Câu "Khi duyệt huỷ sẽ: …" — không chấm cuối. */
export function khiDuyetHuySe(d: DonMoTa): string {
  switch (d.kind) {
    case "SHIFT_SWAP":
      return "khôi phục lịch ca như trước khi duyệt (cả người nhận ca, nếu có) rồi tính lại công. Ô ca đã bị sửa lại sau khi duyệt thì không tự hoàn tác được";
    case "LEAVE":
      // P2.1A — `huyNghiPhep` (don/hoan-tac.ts) gọi `hoanPhepKhiHuy` ở CẢ HAI nhánh: phần đã trừ quỹ phép năm lúc
      // duyệt được hoàn đúng số phút (kể cả khi công tắc sổ phép đã tắt sau đó). Câu hứa phải nói ra (nghiệm thu 11/10:
      // toast sau khi bấm có "Hoàn quỹ phép 960 phút" mà câu TRƯỚC khi bấm im lặng).
      return motPhan(d)
        ? `bỏ phần nghỉ khỏi ngày đó — thời gian nghỉ lại phải chấm công như thường — rồi tính lại công${HOAN_PHEP}`
        : `khôi phục lịch ca của những ngày nghỉ (và của người làm thay, nếu có) rồi tính lại công${HOAN_PHEP}. Ô ca đã bị sửa lại sau khi duyệt thì không tự hoàn tác được`;
    case "TIMESHEET_FIX":
      return "thôi tính các mốc giờ chỉnh tay của đơn (không xoá), trả các lượt quét cũ về như trước, rồi tính lại công. Giờ đã bị sửa lại lần nữa thì không tự hoàn tác được";
    case "COMP_LEAVE":
      return "hoàn đúng số phút đã trừ vào quỹ nghỉ bù; ngày đó lại phải chấm công như thường";
    case "OT":
    case "HOLIDAY_WORK":
      return "bỏ khung đã duyệt khỏi bảng công (phút được tính về 0) và trừ lại phần đã cộng vào quỹ nghỉ bù nếu có. Người nộp đã dùng phần quỹ đó thì không huỷ được";
    case "SUB_TEACH":
      return "gỡ giáo viên dạy thay khỏi buổi học, trả buổi về như trước. Buổi đã qua hoặc đã điểm danh / có nhận xét thì không huỷ được";
    case "CLASS_OFF":
      // Hình "giữ buổi + GV dạy thay": hoàn tác bằng `huyDayThay`; hình cũ: `huyNghiBuoiDay` (don/hoan-tac.ts).
      if (laNghiGiuBuoiGvThay(d.appliedEffect)) {
        return "gỡ giáo viên dạy thay khỏi buổi học, trả buổi về cho giáo viên xin nghỉ như trước khi duyệt. Buổi đã qua hoặc đã điểm danh / có nhận xét thì không huỷ được";
      }
      return "khôi phục buổi học đã huỷ và gỡ buổi bù mà đơn đã thêm cuối lịch. Buổi bù đã diễn ra / đã có điểm danh, nhận xét, ảnh… hoặc lịch đã bị sửa sau khi duyệt thì không huỷ được";
    case "CLASS_CHANGE":
      return "chỉ đổi trạng thái đơn — đơn này không đổi gì trên lịch";
    case "LATE_EARLY":
    case "REMOTE":
    case "BUSINESS_TRIP":
    case "OUTSIDE_ATTENDANCE":
      return "đơn hết hiệu lực rồi tính lại công những ngày đó — lượt chấm công thật vẫn giữ nguyên";
  }
}

/**
 * Nút "Xin huỷ" có hiện không — MỘT chỗ cho hai màn "Đơn của tôi" lẫn cổng server (`yeuCauHuyDon`):
 * nút hiện ⇔ server nhận (luật 12). Đơn duyệt theo luật cũ (không dấu `effectVersion`), hoặc thiếu
 * ảnh chụp mà loại đó cần để hoàn tác, thì yêu cầu huỷ chắc chắn bị từ chối.
 */
export function coTheXinHuy(d: DonMoTa & { status: string; effectVersion: number | null; appliedEffect: unknown }): boolean {
  return d.status === "APPROVED" && (d.effectVersion ?? 0) >= 1 && coAnhChupHoanTac(d);
}

/**
 * Đơn ghi lưới / lượt quét / buổi học cần ẢNH CHỤP lúc duyệt mới hoàn tác được (`don/hoan-tac.ts`).
 * Đơn duyệt trên môi trường test ở đợt 1–3 mang `effectVersion = 1` nhưng chưa có các khoá này —
 * hiện nút cho chúng là hứa một việc "Duyệt huỷ" chắc chắn từ chối (luật 12).
 */
export function coAnhChupHoanTac(d: DonMoTa & { appliedEffect: unknown }): boolean {
  const e = d.appliedEffect && typeof d.appliedEffect === "object" ? (d.appliedEffect as Record<string, unknown>) : {};
  if (d.kind === "SHIFT_SWAP" || (d.kind === "LEAVE" && !motPhan(d))) return Array.isArray(e.o);
  if (d.kind === "TIMESHEET_FIX") return typeof e.soDongMoi === "number" && Array.isArray(e.thayThe);
  if (d.kind === "SUB_TEACH") return typeof e.sessionId === "string";
  // Nghỉ buổi dạy duyệt TRƯỚC khi có liên kết buổi bù ↔ đơn + ảnh chụp phiên bản: không giả định được.
  if (d.kind === "CLASS_OFF") {
    return laNghiGiuBuoiGvThay(e) || (typeof e.buoiBu === "string" && !!e.phienBan && typeof e.phienBan === "object");
  }
  return true;
}
