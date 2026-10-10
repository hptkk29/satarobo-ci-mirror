// lib/leads/lead-export.ts — G-03 · dựng nội dung tệp Excel của DANH SÁCH LEAD.
//
// THUẦN: không Prisma client, không `xlsx`, không `server-only` — Vitest chạy được
// không cần DB (cùng khuôn `lib/reports/converted-leads-export.ts` của C-04). Việc
// đọc DB + ghi tệp nằm ở `app/api/admin/leads/export/route.ts`.
//
// ┌─ Ba luật của tệp này, đừng nới ────────────────────────────────────────────────┐
// │ 1. KHÔNG NHẬN TÊN THÔ. `buildLeadExportSheet` chỉ nhận `LeadExportLead` mà      │
// │    route đã cho đi qua `maskLeadPiiFields` ở SERVER. Thêm một tham số kiểu       │
// │    "tên phụ huynh chưa che" vào đây là mở lại đúng lỗ mà tầng che đang bịt, và   │
// │    lần này dữ liệu rời khỏi hệ thống trong một tệp KHÔNG THU HỒI ĐƯỢC.           │
// │ 2. BỘ CỘT CỐ ĐỊNH (chốt kỹ thuật 24/08/2026, OQ-G12) — tách hẳn khỏi tuỳ chọn    │
// │    cột G-04. Tuỳ chọn cột chỉ đổi MÀN HÌNH. Tệp là thứ người ta đối chiếu với    │
// │    nhau: hai người xuất cùng bộ lọc phải ra tệp cùng cấu trúc, kể cả khi quyền   │
// │    xem PII của họ khác nhau.                                                    │
// │ 3. KHÔNG CẮT CÂM. Chạm trần quét thì tệp phải nói ra CÒN THIẾU BAO NHIÊU DÒNG,   │
// │    ngay trong sheet dữ liệu. Người cầm tệp không nhìn thấy màn hình — họ chỉ có  │
// │    tệp, và một tệp thiếu khách mà không cảnh báo sẽ được đọc thành "cơ sở này    │
// │    chỉ có ngần này khách".                                                      │
// └───────────────────────────────────────────────────────────────────────────────┘
import type { LeadStatus, Prisma } from "@prisma/client";
import { ALL_LEAD_STATUSES, leadStatusLabel } from "@/lib/leads/status";
import { formatDayKeyDMY, vnDayKey } from "@/lib/students/birthday-dates";
import { phoneSearchTerm } from "@/lib/phone";

/**
 * Bộ cột CỐ ĐỊNH của tệp xuất — giữ nguyên 15 cột của bản CSV cũ để người đang có
 * công thức Excel dựng sẵn trên tệp cũ không phải làm lại.
 *
 * ⚠️ Đổi/chèn/bỏ cột ở đây là đổi cấu trúc tệp mà người dùng đã dựng công thức lên —
 * coi như một thay đổi có thông báo, không phải sửa vặt.
 */
export const LEAD_EXPORT_COLUMNS = [
  "ID",
  "Phụ huynh",
  "SĐT",
  "Email",
  "Tên con",
  "Tuổi",
  "Trạng thái",
  "Nguồn",
  "UTM Source",
  "UTM Medium",
  "UTM Campaign",
  "Cơ sở",
  "Phụ trách",
  "Ghi chú",
  "Ngày đăng ký",
] as const;

/**
 * Số dòng đọc về mỗi lượt. Đọc theo LÔ (con trỏ `cursor`) chứ không một `findMany`
 * khổng lồ: một truy vấn 20.000 dòng kèm `include` giữ nguyên cả tập trong bộ nhớ
 * Postgres lẫn Node cùng lúc, và trên gói serverless nó là đường chết bộ nhớ.
 */
export const LEAD_EXPORT_BATCH_SIZE = 2_000;

/**
 * TRẦN CỨNG của một lượt xuất. Không phải "cắt cho gọn" — đây là hàng rào chống một
 * lượt bấm nút kéo cả bảng `Lead` vào bộ nhớ hàm serverless rồi nén thành tệp vượt
 * giới hạn kích thước phản hồi.
 *
 * KHÁC HẲN trần cũ (`take: 5000`) ở đúng một điểm, và đó là toàn bộ điểm của G-03:
 * chạm trần thì tệp NÓI RA còn thiếu bao nhiêu dòng (xem
 * {@link leadExportTruncationWarning}), chứ không im lặng.
 */
export const LEAD_EXPORT_MAX_ROWS = 20_000;

export type LeadExportCell = string | number;

/**
 * Một lead như route đọc về — ĐÃ đi qua `maskLeadPiiFields`.
 *
 * Cố ý KHÔNG có cờ `canViewPii` trong kiểu này: nếu hàm dựng sheet biết về quyền thì
 * sớm muộn sẽ có người truyền bản thô kèm cờ và quên bật cờ.
 */
export type LeadExportLead = {
  id: string;
  parentName: string;
  phone: string;
  email: string | null;
  childName: string | null;
  childAge: number | null;
  status: LeadStatus;
  source: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  note: string | null;
  createdAt: Date;
  center: { name: string } | null;
  assignedTo: { name: string | null } | null;
};

/** Nhãn mở đầu khối cuối sheet — để không ai kéo chuột chọn nhầm nó vào danh sách. */
const NHAN_KHOI_CUOI = "— GHI CHÚ (không phải dòng khách) —";

/** Ngày hiển thị dd/mm/yyyy theo GIỜ VN. Máy chạy ở UTC, `toLocaleDateString` của
 *  máy sẽ lùi một ngày với mọi lead tạo trước 7h sáng giờ VN. */
function ngayVn(d: Date): string {
  return formatDayKeyDMY(vnDayKey(d));
}

function so(n: number): string {
  return n.toLocaleString("vi-VN");
}

/** Dòng rỗng đủ số cột — giữ sheet vuông vắn. */
function dongTrong(): LeadExportCell[] {
  return Array.from({ length: LEAD_EXPORT_COLUMNS.length }, () => "");
}

/** Dòng của khối cuối: chữ ở cột A, các cột còn lại để trống. */
function dongKhoiCuoi(nhan: string): LeadExportCell[] {
  const r = dongTrong();
  r[0] = nhan;
  return r;
}

/**
 * Câu cảnh báo "tệp này THIẾU khách", hoặc `null` khi tệp đủ.
 *
 * Nói ĐÚNG con số còn thiếu chứ không nói chung chung "có thể bị cắt": người cầm tệp
 * phải quyết định được ngay là thu hẹp bộ lọc rồi xuất lại, hay tệp đang cầm là đủ.
 *
 * Điều kiện cố ý là `totalMatching > exported` chứ KHÔNG phải "đã chạm trần". Hai cách
 * chỉ khác nhau ở một tình huống: có người xoá mềm một lead trong khoảng giữa lượt đếm
 * và lượt đọc ⇒ cảnh báo thừa. Chọn cảnh báo thừa, vì chiều sai kia — vòng đọc theo lô
 * dừng sớm vì một lỗi nào đó mà tệp vẫn im lặng — chính là thứ G-03 sinh ra để diệt.
 */
export function leadExportTruncationWarning(
  totalMatching: number,
  exported: number,
): string | null {
  const thieu = totalMatching - exported;
  if (thieu <= 0) return null;
  return (
    `⚠ TỆP NÀY BỊ CẮT: bộ lọc đang khớp ${so(totalMatching)} khách nhưng một lượt xuất ` +
    `chỉ mang được ${so(exported)} dòng, nên tệp THIẾU ${so(thieu)} khách. ` +
    "Đừng dùng tệp này để kết luận tổng số khách. Thu hẹp khoảng ngày, chọn một cơ sở " +
    "hoặc một trạng thái rồi xuất lại thành nhiều tệp."
  );
}

/**
 * Sheet dữ liệu: 1 dòng tiêu đề + mỗi lead 1 dòng + (nếu bị cắt) khối cảnh báo cuối.
 *
 * MỘT DÒNG = MỘT PHIẾU PHỤ HUYNH, y như danh sách trên màn. ⚠️ Cột "Tên con" là ô
 * `Lead.childName` cũ — phiếu có nhiều con (`LeadChild`, G-07) hiện vẫn chỉ ra một
 * dòng với một tên. Bổ cột theo từng con là việc của G-03-1, không nằm trong đợt này.
 */
export function buildLeadExportSheet(args: {
  /** ĐÃ che PII ở route. Xem luật 1 ở đầu tệp. */
  leads: readonly LeadExportLead[];
  /** Tổng số lead khớp bộ lọc (đếm ở DB) — dùng để biết tệp có bị cắt không. */
  totalMatching: number;
}): LeadExportCell[][] {
  const { leads, totalMatching } = args;

  const rows: LeadExportCell[][] = [[...LEAD_EXPORT_COLUMNS]];

  for (const l of leads) {
    rows.push([
      l.id,
      l.parentName,
      l.phone,
      l.email ?? "",
      l.childName ?? "",
      // Tuổi trống phải là Ô TRỐNG. Số 0 trong Excel được đọc thành "bé 0 tuổi";
      // không ai đọc ra "chưa nhập", và `AVERAGE()` thì nuốt luôn số 0 đó.
      l.childAge ?? "",
      leadStatusLabel(l.status),
      l.source ?? "",
      l.utmSource ?? "",
      l.utmMedium ?? "",
      l.utmCampaign ?? "",
      l.center?.name ?? "",
      l.assignedTo?.name ?? "",
      l.note ?? "",
      ngayVn(l.createdAt),
    ]);
  }

  // Cảnh báo nằm TRONG sheet dữ liệu (không chỉ ở sheet thông tin) vì đa số người mở
  // tệp chỉ nhìn sheet đầu tiên rồi kéo xuống cuối để xem "hết bao nhiêu dòng".
  const canhBao = leadExportTruncationWarning(totalMatching, leads.length);
  if (canhBao) {
    rows.push(dongTrong(), dongKhoiCuoi(NHAN_KHOI_CUOI), dongKhoiCuoi(canhBao));
  }

  return rows;
}

/** Bộ lọc đang áp dụng, ở dạng ĐÃ GIẢI (tên cơ sở/tên sale, không phải id). */
export type LeadExportFilterEcho = {
  status?: LeadStatus;
  q?: string;
  centerName?: string;
  assignedToName?: string;
  source?: string;
  dateFrom?: string;
  dateTo?: string;
  /** `false` = ô tìm KHÔNG quét cột SĐT (người xuất thiếu `leads:view-pii`). */
  canSearchPhoneApplied?: boolean;
};

/**
 * Sheet "Thông tin xuất": bộ lọc đang áp dụng, trạng thái che dữ liệu, cảnh báo cắt,
 * và dòng watermark truy vết.
 *
 * Thiếu sheet này thì một tệp Excel rời hệ thống chỉ là một bảng số không ngữ cảnh:
 * hai tệp cùng tên nhưng khác bộ lọc không phân biệt được, và người nhận không biết
 * mình đang cầm bản đã che hay bản đầy đủ.
 */
export function buildLeadExportInfoSheet(args: {
  totalMatching: number;
  exported: number;
  filters: LeadExportFilterEcho;
  canViewPii: boolean;
  /** `exportWatermark(...)` — dựng ở route vì cần session. */
  watermark: string;
}): LeadExportCell[][] {
  const { filters: f, canViewPii } = args;
  const TAT_CA = "Tất cả";

  const rows: LeadExportCell[][] = [
    ["Bảng", "Danh sách lead (Admin · /leads)"],
    [
      "Đơn vị mỗi dòng",
      "MỘT PHIẾU PHỤ HUYNH. Cột “Tên con” là ô tên con trên phiếu; phiếu khai nhiều " +
        "con vẫn chỉ ra một dòng.",
    ],
    ["Trạng thái", f.status ? leadStatusLabel(f.status) : TAT_CA],
    [
      "Khoảng ngày (theo ngày lead vào hệ thống)",
      f.dateFrom || f.dateTo
        ? `${f.dateFrom ? formatDayKeyDMY(f.dateFrom) : "không giới hạn"} – ` +
          `${f.dateTo ? formatDayKeyDMY(f.dateTo) : "không giới hạn"}`
        : TAT_CA,
    ],
    ["Cơ sở", f.centerName || `${TAT_CA} cơ sở trong phạm vi của người xuất`],
    ["Sale phụ trách", f.assignedToName || TAT_CA],
    ["Nguồn", f.source || TAT_CA],
    ["Từ khoá tìm", f.q || "(không tìm)"],
    ["Số khách khớp bộ lọc", args.totalMatching],
    ["Số dòng trong tệp", args.exported],
    [
      "Tên / SĐT / email / ghi chú của phụ huynh",
      canViewPii
        ? "Hiện nguyên văn — người xuất có quyền xem PII lead (leads:view-pii)."
        : "ĐÃ CHE (người xuất không có quyền leads:view-pii). Đây KHÔNG phải thông tin " +
          "liên hệ thật của khách; đừng dùng tệp này để gọi điện.",
    ],
  ];

  // Thiếu quyền PII thì ô tìm cố ý KHÔNG quét cột SĐT (chống dò số). Phải nói ra,
  // nếu không người dùng gõ số vào ô tìm, thấy tệp rỗng, và kết luận sai là "hệ
  // thống không có khách nào mang số này".
  if (f.canSearchPhoneApplied === false && f.q) {
    rows.push([
      "Lưu ý về ô tìm",
      "Lượt tìm này KHÔNG tìm theo số điện thoại (người xuất không có quyền " +
        "leads:view-pii). Từ khoá chỉ dò trên tên phụ huynh và tên con.",
    ]);
  }

  const canhBao = leadExportTruncationWarning(args.totalMatching, args.exported);
  if (canhBao) rows.push(["Cảnh báo", canhBao]);

  rows.push(["Watermark", args.watermark]);
  return rows;
}

/** Tên tệp mang ngày xuất (giờ VN) để hai lần xuất khác ngày không đè nhau. */
export function leadExportFileName(now: Date): string {
  return `danh-sach-lead_${vnDayKey(now)}.xlsx`;
}

/** Tham số lọc thô, đã bóc khỏi query string. */
export type LeadExportFilterInput = {
  status?: string;
  q?: string;
  centerId?: string;
  assignedToId?: string;
  source?: string;
  dateFrom?: string;
  dateTo?: string;
  /**
   * 🔴 Người xuất có được tìm theo SĐT không (`leads:view-pii` và không bị che
   * trường `phone`). `false` ⇒ nhánh `phone` BIẾN MẤT khỏi truy vấn.
   *
   * Không phải chuyện thẩm mỹ: quản lý cơ sở có `leads:export` nhưng KHÔNG có
   * `leads:view-pii` (gỡ 22/08/2026). Để nguyên nhánh này là họ gõ một số vào ô
   * tìm, tệp trả về đúng một dòng, và thế là xác nhận được "số này của phụ huynh
   * nào" — dù tên trong tệp đã che. Màn `/leads` đã chặn đúng chỗ này (NỢ #11);
   * đường xuất phải chặn giống hệt, nếu không nó là cửa sau của chính màn đó.
   */
  canSearchPhone: boolean;
};

/**
 * Dựng `where` cho lượt xuất — CÙNG ngữ nghĩa với bộ lọc của trang `/leads`, để tệp
 * khớp thứ đang hiện trên màn.
 *
 * ⚠️ KHÔNG có mệnh đề cách ly cơ sở ở đây: `Lead` ∈ `SCOPED_MODELS`, `scopedDb(actor)`
 * tự chèn `centerId IN visibleCenterIds`. Tự thêm một mệnh đề cơ sở thứ hai ở đây là
 * dựng hàng rào thứ hai để rồi có ngày hai hàng rào lệch nhau.
 *
 * ⚠️ Trang `/leads` còn một nhánh nữa mà hàm này CỐ Ý không có: thu hẹp về "lead của
 * tôi" cho người chỉ có `leads:view-own`. Đường xuất đòi `leads:view-all` nên nhánh
 * đó không bao giờ tới lượt — thêm vào là code chết trông như đang bảo vệ điều gì đó.
 */
export function buildLeadExportWhere(f: LeadExportFilterInput): Prisma.LeadWhereInput {
  const q = f.q?.trim() || undefined;
  // SĐT lưu 2 dạng (0… cũ / 84… mới) — tìm theo phần lõi để không sót. Xem lib/phone.ts.
  const qPhone = q ? (phoneSearchTerm(q) ?? q) : undefined;

  const status =
    f.status && (ALL_LEAD_STATUSES as string[]).includes(f.status)
      ? (f.status as LeadStatus)
      : undefined;

  const centerId = f.centerId?.trim() || undefined;
  const assignedToId = f.assignedToId?.trim() || undefined;
  const source = f.source?.trim() || undefined;
  const dateFrom = f.dateFrom?.trim() || undefined;
  const dateTo = f.dateTo?.trim() || undefined;

  // Hai biểu thức `new Date(...)` dưới đây CỐ Ý chép nguyên từ `app/(admin)/admin/
  // leads/page.tsx`. Chúng diễn giải ngày theo múi giờ của MÁY CHẠY, không phải giờ
  // VN — một điểm lệch đã biết của trang. Sửa ở đây mà không sửa trang là tệp và màn
  // hình cho hai tập khác nhau ở hai lead đầu/cuối khoảng, loại lệch không ai đối
  // soát ra. Muốn sửa thì sửa cả hai trong một lượt.
  const createdAt: Prisma.DateTimeFilter | undefined =
    dateFrom || dateTo
      ? {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59`) } : {}),
        }
      : undefined;

  return {
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(centerId ? { centerId } : {}),
    ...(assignedToId ? { assignedToId } : {}),
    ...(source ? { source: { contains: source, mode: "insensitive" as const } } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(q
      ? {
          OR: [
            { parentName: { contains: q, mode: "insensitive" as const } },
            ...(f.canSearchPhone && qPhone ? [{ phone: { contains: qPhone } }] : []),
            { childName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}
