// lib/reports/converted-leads-export.ts — C-04 · dựng nội dung tệp Excel của bảng C-03.
//
// THUẦN: không Prisma, không `xlsx`, không `server-only` — Vitest chạy được không cần
// DB (cùng khuôn `lib/crm/commission-export.ts`). Việc ghi tệp nằm ở route
// `app/api/admin/dashboard-qlcs/lead-chuyen-doi-export/route.ts`.
//
// ┌─ Ba luật của tệp này, đừng nới ─────────────────────────────────────────────────┐
// │ 1. KHÔNG đọc dữ liệu thô. Hàm chỉ nhận `ConvertedLeadReport` — thứ mà            │
// │    `getConvertedLeadRows` đã cho đi qua `maskLeadPiiFields` ở SERVER. Thêm một    │
// │    tham số "tên phụ huynh chưa che" vào đây là mở lại đúng lỗ mà C-03 đã bịt, và  │
// │    lần này dữ liệu rời khỏi hệ thống trong một tệp không thu hồi được.            │
// │ 2. BỘ CỘT CỐ ĐỊNH (chốt kỹ thuật 24/08/2026, OQ-G12). Không có quyền xem tiền     │
// │    KHÔNG làm bớt cột — hai ô tiền đổi thành ghi chú "ẩn". Bỏ hẳn cột thì hai      │
// │    người xuất cùng một bộ lọc ra hai file khác cấu trúc, và mọi công thức Excel   │
// │    dựng sẵn trên file đó gãy.                                                    │
// │ 3. Mọi thứ màn hình PHẢI nói ra thì tệp cũng phải nói ra: khối đối soát ba mảnh,  │
// │    cảnh báo cắt trần, số học sinh chốt trước ngày vào hệ thống. Người cầm tệp     │
// │    không nhìn thấy màn hình — họ chỉ có tệp.                                     │
// └────────────────────────────────────────────────────────────────────────────────┘
import { formatDayKeyDMY, vnDayKey } from "@/lib/students/birthday-dates";
import {
  formatDaysToClose,
  formatRevenueShare,
  type ConvertedLeadReport,
} from "@/lib/reports/converted-leads";

/**
 * Bộ cột CỐ ĐỊNH của tệp xuất. Thứ tự 10 cột đầu bám đúng thứ tự trên màn C-03; cột
 * cuối là đường dẫn ngược về phiếu (trên màn nó là cái link ở cột tên).
 *
 * ⚠️ Đổi/chèn/bỏ cột ở đây là đổi cấu trúc tệp mà người dùng đã dựng công thức lên —
 * coi như một thay đổi có thông báo, không phải sửa vặt.
 */
export const CONVERTED_LEAD_EXPORT_COLUMNS = [
  "Học sinh",
  "Phụ huynh",
  "Khoá học",
  "Cơ sở",
  "Sale phụ trách",
  "Giá trị (thực thu, VND)",
  "% tổng doanh thu",
  "Vào hệ thống",
  "Chốt",
  "Thời gian chốt",
  "Đường dẫn phiếu",
] as const;

/** Vị trí hai ô tiền — khai một lần để khối đối soát và test không tự đếm tay. */
export const CONVERTED_LEAD_EXPORT_MONEY_COL =
  CONVERTED_LEAD_EXPORT_COLUMNS.indexOf("Giá trị (thực thu, VND)");
export const CONVERTED_LEAD_EXPORT_SHARE_COL =
  CONVERTED_LEAD_EXPORT_COLUMNS.indexOf("% tổng doanh thu");

/**
 * Nội dung hai ô tiền khi người xuất KHÔNG có `payments:view`.
 *
 * Cố ý là một câu, không phải ô trống và tuyệt đối không phải số 0: một cột tiền toàn
 * số 0 trong Excel được đọc thành "doanh thu bằng 0" chứ không ai đọc ra "người xuất
 * thiếu quyền", và con số đó sẽ đi tiếp vào báo cáo gửi lên trên.
 */
export const O_TIEN_AN = "(ẩn — người xuất không có quyền xem thanh toán)";

/** Nhãn mở đầu khối cuối sheet — để không ai cộng nhầm nó vào danh sách học sinh. */
const NHAN_KHOI_CUOI = "— GHI CHÚ & ĐỐI SOÁT (không phải dòng học sinh) —";

const CANH_BAO_CAT =
  "⚠ DANH SÁCH BỊ CẮT: khoảng đang lọc có nhiều học sinh chốt hơn mức bảng đọc về, " +
  "nên tệp này THIẾU học sinh. Thu hẹp khoảng ngày hoặc chọn ít cơ sở hơn rồi xuất lại.";

const CANH_BAO_CAT_TIEN =
  "⚠ Số bút toán trong khoảng này vượt mức quét, nên cột giá trị của TỪNG DÒNG có thể " +
  "thiếu. Dòng “Tổng thực thu của kỳ” vẫn đúng — hãy tin dòng đó, đừng cộng nhẩm các dòng trên.";

export type ConvertedLeadExportCell = string | number;

/** Ngày hiển thị dd/mm/yyyy theo giờ VN — cùng cách màn C-03 hiển thị. */
function ngayVn(d: Date): string {
  return formatDayKeyDMY(vnDayKey(d));
}

/** Dòng rỗng đủ số cột — giữ sheet vuông vắn. */
function dongTrong(): ConvertedLeadExportCell[] {
  return Array.from({ length: CONVERTED_LEAD_EXPORT_COLUMNS.length }, () => "");
}

/** Dòng của khối cuối: nhãn ở cột A, (tuỳ chọn) tiền + tỷ lệ ở đúng hai cột tiền. */
function dongKhoiCuoi(
  nhan: string,
  tien?: number,
  tyLe?: string,
): ConvertedLeadExportCell[] {
  const r = dongTrong();
  r[0] = nhan;
  if (tien !== undefined) r[CONVERTED_LEAD_EXPORT_MONEY_COL] = tien;
  if (tyLe !== undefined) r[CONVERTED_LEAD_EXPORT_SHARE_COL] = tyLe;
  return r;
}

/**
 * Sheet dữ liệu: 1 dòng tiêu đề + mỗi học sinh 1 dòng + khối ghi chú/đối soát ở cuối.
 *
 * MỘT DÒNG = MỘT HỌC SINH, y như màn hình: một phụ huynh cho hai con đi học ra hai
 * dòng cùng tên phụ huynh. Câu đó được nhắc lại ở sheet thông tin vì người mở tệp
 * không đọc được dòng mô tả trên màn.
 *
 * ⚠️ `report.rows` đã che PII rồi (`getConvertedLeadRows` → `buildConvertedLeadRows` →
 * `maskLeadPiiFields`). Hàm này KHÔNG được nhận thêm nguồn tên nào khác.
 */
export function buildConvertedLeadExportSheet(args: {
  report: ConvertedLeadReport;
  centerNameById: ReadonlyMap<string, string>;
  /** Tiền tố tuyệt đối của trang chi tiết lead, ví dụ `https://admin.satarobo.vn/leads`. */
  leadUrlBase: string;
}): ConvertedLeadExportCell[][] {
  const { report, centerNameById, leadUrlBase } = args;
  const coTien = report.revenue !== null;

  const rows: ConvertedLeadExportCell[][] = [[...CONVERTED_LEAD_EXPORT_COLUMNS]];

  for (const r of report.rows) {
    rows.push([
      r.childName || "(chưa có tên)",
      r.parentName || "",
      r.courseName ?? "",
      r.centerId ? (centerNameById.get(r.centerId) ?? r.centerId) : "Chưa gán cơ sở",
      r.assignedToName ?? "Chưa phân công",
      // Thiếu quyền ⇒ câu "ẩn". Có quyền mà bằng 0 ⇒ Ô TRỐNG, không phải số 0: sự thật
      // là "chưa có khoản nào của em rơi vào kỳ đang lọc", còn số 0 là khẳng định "đã
      // thu 0 đồng". Ô trống vẫn cho `SUM()` ra đúng vì Excel bỏ qua ô trống.
      !coTien ? O_TIEN_AN : r.revenue ? r.revenue : "",
      !coTien ? O_TIEN_AN : formatRevenueShare(r.revenueShare),
      ngayVn(r.enteredAt),
      ngayVn(r.closedAt),
      formatDaysToClose(r.daysToClose),
      `${leadUrlBase}/${r.leadId}`,
    ]);
  }

  // ── Khối cuối ────────────────────────────────────────────────────────────────
  // Cảnh báo + đối soát nằm TRONG sheet dữ liệu (không chỉ ở sheet thông tin) vì đa số
  // người mở tệp chỉ nhìn sheet đầu tiên. Nhãn `NHAN_KHOI_CUOI` cắt rõ ranh giới để
  // không ai kéo chuột chọn nhầm mấy dòng này vào danh sách học sinh.
  const khoi: ConvertedLeadExportCell[][] = [];
  if (report.truncated) khoi.push(dongKhoiCuoi(CANH_BAO_CAT));
  if (report.revenue?.truncated) khoi.push(dongKhoiCuoi(CANH_BAO_CAT_TIEN));
  if (report.invalidDurationCount > 0) {
    khoi.push(
      dongKhoiCuoi(
        `⚠ ${report.invalidDurationCount} học sinh có thời điểm chốt TRƯỚC thời điểm vào hệ ` +
          "thống (dữ liệu chuyển đổi cũ) — cột “Thời gian chốt” của họ để ghi chú thay vì số âm.",
      ),
    );
  }

  if (report.revenue) {
    const tong = report.revenue.totalRevenue;
    const tyLe = (v: number) => formatRevenueShare(tong > 0 ? v / tong : null);
    khoi.push(
      dongKhoiCuoi(
        "Thực thu của các học sinh trong bảng (cộng đúng những dòng ở trên)",
        report.revenue.rowsRevenue,
        tyLe(report.revenue.rowsRevenue),
      ),
      dongKhoiCuoi(
        "Học sinh chốt ở kỳ khác / chưa đánh dấu chốt — tiền về trong kỳ này nhưng em đó " +
          "chốt kỳ trước (trả góp, đóng theo đợt) hoặc chưa có mốc chốt",
        report.revenue.otherChildRevenue,
        tyLe(report.revenue.otherChildRevenue),
      ),
      // Dòng BẮT BUỘC. Bỏ nó là Σ cột tiền của tệp thấp hơn doanh thu kỳ ở tab Tài
      // chính, và người cầm tệp không có gì để hiểu vì sao.
      dongKhoiCuoi(
        "Chưa quy được về học sinh — đơn chưa nối được về một đứa trẻ cụ thể (đơn tạo " +
          "trước 24/08/2026, đơn chung nhiều con, đơn bán học cụ). Tiền là thật, chỉ chưa biết ghi cho ai.",
        report.revenue.unassignedRevenue,
        tyLe(report.revenue.unassignedRevenue),
      ),
      dongKhoiCuoi(
        "Tổng thực thu của kỳ (phải khớp ô “Doanh thu” của tab Tài chính)",
        tong,
        tong > 0 ? "100,0%" : "—",
      ),
    );
  }

  if (khoi.length > 0) {
    rows.push(dongTrong(), dongKhoiCuoi(NHAN_KHOI_CUOI), ...khoi);
  }

  return rows;
}

/**
 * Sheet "Thông tin xuất": bộ lọc đang áp dụng, trạng thái che dữ liệu, cảnh báo, và
 * dòng watermark truy vết.
 *
 * Có sheet này thì hai tệp cùng tên nhưng khác bộ lọc vẫn phân biệt được, và người
 * nhận tệp biết mình đang cầm bản đã che hay bản đầy đủ. Thiếu nó, một tệp Excel rời
 * hệ thống là một bảng số không có ngữ cảnh.
 */
export function buildConvertedLeadExportInfoSheet(args: {
  report: ConvertedLeadReport;
  /** `YYYY-MM-DD` ĐÃ chuẩn hoá của bộ lọc chung A-02 (đã kẹp ngày tương lai). */
  dateFromStr: string;
  dateToStr: string;
  /** Tên cơ sở ĐANG lọc, theo đúng thứ tự hiển thị. */
  centerNames: readonly string[];
  isAllCenters: boolean;
  canViewPii: boolean;
  /** `exportWatermark(...)` — dựng ở route vì cần session. */
  watermark: string;
}): (string | number)[][] {
  const { report, canViewPii } = args;
  const coTien = report.revenue !== null;

  const rows: (string | number)[][] = [
    ["Bảng", "C-03 — Lead đã chuyển đổi (Dashboard QLCS · tab Kinh doanh)"],
    [
      "Đơn vị mỗi dòng",
      "MỘT HỌC SINH đã chốt (ghi danh thành học viên) — không phải một phiếu phụ huynh. " +
        "Một phụ huynh cho hai con đi học sẽ ra hai dòng cùng tên phụ huynh.",
    ],
    [
      "Khoảng ngày",
      `${formatDayKeyDMY(args.dateFromStr)} – ${formatDayKeyDMY(args.dateToStr)} — lọc theo ` +
        "thời điểm chốt (KHÔNG phải ngày tiền về).",
    ],
    [
      "Cơ sở",
      args.isAllCenters
        ? `Tất cả cơ sở trong phạm vi của người xuất: ${args.centerNames.join(", ")}`
        : args.centerNames.join(", "),
    ],
    ["Số dòng học sinh", report.rows.length],
    [
      "Tên phụ huynh / học sinh",
      canViewPii
        ? "Hiện nguyên văn — người xuất có quyền xem PII lead (leads:view-pii)."
        : "ĐÃ CHE (người xuất không có quyền leads:view-pii). Đây KHÔNG phải tên thật của khách.",
    ],
    [
      "Cột tiền",
      coTien
        ? "Thực thu trong kỳ, đã trừ hoàn tiền và điều chỉnh. Ô TRỐNG = chưa có khoản nào " +
          "của học sinh đó rơi vào khoảng đang lọc (không phải “đã thu 0 đồng”)."
        : "ẨN — người xuất không có quyền xem thanh toán (payments:view).",
    ],
  ];

  if (report.truncated) rows.push(["Cảnh báo", CANH_BAO_CAT]);
  if (report.revenue?.truncated) rows.push(["Cảnh báo", CANH_BAO_CAT_TIEN]);
  if (report.invalidDurationCount > 0) {
    rows.push([
      "Cảnh báo",
      `${report.invalidDurationCount} học sinh có thời điểm chốt trước thời điểm vào hệ thống ` +
        "(dữ liệu chuyển đổi cũ) — cột “Thời gian chốt” của họ để ghi chú thay vì số âm.",
    ]);
  }

  rows.push(["Watermark", args.watermark]);
  return rows;
}

/** Tên tệp mang khoảng ngày, để hai lần xuất khác kỳ không đè nhau trong thư mục Tải về. */
export function convertedLeadExportFileName(
  dateFromStr: string,
  dateToStr: string,
): string {
  return `lead-da-chuyen-doi_${dateFromStr}_${dateToStr}.xlsx`;
}
