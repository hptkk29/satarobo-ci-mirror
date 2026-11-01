/**
 * LỊCH SỬ TƯƠNG TÁC LEAD — nơi DUY NHẤT biến một sự việc thành CÂU CHO NGƯỜI ĐỌC.
 *
 * Chủ dự án 18/09/2026: "bất cứ hành động gì của sale khi tương tác với lead đều ghi lại
 * vào lịch sử tương tác (ví dụ: đổi trạng thái, xếp lớp trial, tạo đơn, add lớp...)" —
 * và khi chọn cách lưu: **"chọn 1 nhưng cần chuyển sang ngôn ngữ người dùng"**.
 *
 * ── VÌ SAO LÀ MỘT TỆP THUẦN, KHÔNG PHẢI CHUỖI GHÉP TẠI CHỖ ─────────────────────────────
 * Panel lịch sử là thứ quản lý cơ sở đọc mỗi ngày để biết Sale đã làm gì. Nếu mỗi đường
 * ghi tự ghép chuỗi thì cùng một việc sẽ có ba cách diễn đạt, và không ai kiểm được câu
 * nào lọt ra tiếng máy ("ENROLL_OK", "status=CONFIRMED"). Gom về đây để:
 *   · `tsc` BẮT BUỘC phủ hết mọi nhánh (union có dấu phân biệt + `switch` không `default`),
 *     nên thêm một việc mới mà quên viết câu là LỖI BIÊN DỊCH, không phải dòng trống;
 *   · test thuần đọc được từng câu — không cần DB;
 *   · nhãn trạng thái lấy từ sổ nhãn dùng chung (`lib/labels`, `lib/leads/status`) chứ
 *     không chép tay, nên đổi nhãn một chỗ là đổi cả lịch sử.
 *
 * ⚠️ KHÔNG đọc đồng hồ trong tệp này (luật 19). Mốc thời gian nào cần in ra thì ĐƯỢC
 * TRUYỀN VÀO dưới dạng `Date`.
 */
import type { EnrollmentStatus, OrderStatus } from "@prisma/client";
import { ENROLLMENT_STATUS, ORDER_STATUS } from "@/lib/labels/registry";
import { vnParts } from "@/lib/time/vn";

/** Mã việc — đi vào `metadata.viec`, là thứ panel dùng để chọn nhãn + biểu tượng. */
export type MaViec = SuKienLead["viec"];

export type SuKienLead =
  // ── nhóm LỚP TRẢI NGHIỆM ────────────────────────────────────────────────────────────
  | { viec: "trial.xep-lop"; tenCon: string; tenLop: string }
  | { viec: "trial.go-lop"; tenCon: string; tenLop: string; lyDo?: string | null }
  /**
   * 23/09/2026 — mô hình case: một lớp (một ngày × một khung) chứa nhiều case. Bé vào/ra
   * MỘT case mà vẫn ở trong lớp là hai việc riêng với xếp/gỡ LỚP. `gio` là chuỗi
   * "HH:MM–HH:MM" của case (cùng lý do với `trial.doi-lich`: không ghép thành `Date`).
   */
  | { viec: "trial.xep-case"; tenCon: string; tenLop: string; gio: string }
  | { viec: "trial.go-case"; tenCon: string; tenLop: string; gio: string }
  | { viec: "trial.diem-danh"; tenCon: string; tenLop: string; coMat: boolean; ngay: Date }
  /**
   * Dời lịch một buổi. Giờ đi RIÊNG dưới dạng chuỗi, không nhét vào `Date`:
   * `TrialClassSession.date` là `@db.Date` (không mang giờ) còn giờ nằm ở hai cột chuỗi
   * `startTime`/`endTime`. Ghép chúng thành `Date` là tự tay dựng một mốc không có trong
   * DB, rồi in ra một giờ mà không cột nào chịu trách nhiệm.
   */
  | {
      viec: "trial.doi-lich";
      tenLop: string;
      ngayTruoc: Date;
      gioTruoc: string;
      ngaySau: Date;
      gioSau: string;
      lyDo?: string | null;
    }
  | { viec: "trial.huy-buoi"; tenLop: string; ngay: Date; lyDo?: string | null }
  | { viec: "trial.huy-lop"; tenLop: string; lyDo?: string | null }
  // ── nhóm ĐƠN HÀNG + CHUYỂN ĐỔI ──────────────────────────────────────────────────────
  | { viec: "don.tao"; maDon: string; tongTien: number }
  | { viec: "don.doi-trang-thai"; maDon: string; tu: OrderStatus | null; den: OrderStatus }
  | { viec: "don.sua-ghi-chu"; maDon: string }
  /**
   * Chốt lead thành học viên.
   *
   * CỐ Ý không mang số tiền: `convertLeadV2` chỉ trả về `studentIds`/`enrollmentIds`, nên
   * muốn in tiền thì phải tự tra đơn của lead — và lượt tra đó trả về MỌI đơn của lead
   * chứ không riêng đơn vừa sinh, tức in ra một con số không thuộc việc vừa làm. Tiền đã
   * có dòng riêng (`don.tao`) do chính đường tạo đơn ghi, đúng số của đúng đơn.
   */
  | { viec: "chuyen-doi"; tenCon: readonly string[] }
  // ── nhóm GHI DANH / XẾP LỚP CHÍNH THỨC ──────────────────────────────────────────────
  | { viec: "ghi-danh.them"; tenCon: string; tenLop: string }
  | {
      viec: "ghi-danh.doi-trang-thai";
      tenCon: string;
      tenLop: string;
      tu: EnrollmentStatus | null;
      den: EnrollmentStatus;
    }
  | { viec: "ghi-danh.chuyen-lop"; tenCon: string; lopCu: string; lopMoi: string }
  | { viec: "ghi-danh.go"; tenCon: string; tenLop: string; lyDo?: string | null }
  // ── nhóm HỒ SƠ LEAD + VIỆC CẦN LÀM + CON ────────────────────────────────────────────
  | { viec: "ho-so.sua"; truong: readonly string[] }
  | { viec: "con.them"; tenCon: string }
  | { viec: "con.sua"; tenCon: string; truong: readonly string[] }
  | { viec: "con.go"; tenCon: string }
  | { viec: "viec.tao"; tieuDe: string; hanChot: Date }
  | { viec: "viec.xong"; tieuDe: string };

// ── BA VIỆC CỐ Ý KHÔNG CÓ Ở ĐÂY ───────────────────────────────────────────────────────
// "giao lead cho Sale" · "bật/tắt chia sẻ lead" · "đổi trạng thái lead" — cả ba ĐÃ được
// repo ghi vào lịch sử từ trước, ở chính đường ghi của chúng:
//   · `manualAssignLead` (`lib/lead/auto-assign.ts`) — ghi "Gán tay cho <tên>";
//   · `toggleLeadShareAction` và `updateLeadStatus` (`app/(admin)/admin/leads/actions.ts`).
// Thêm mã việc cho chúng ở đây là ghi ĐÔI cùng một sự việc, hoặc để lại từ vựng không
// đường gọi nào dùng — mà từ vựng chết thì `tsc` không bắt được, nó chỉ ngồi đó đến khi có
// người tưởng nó đang chạy. Muốn gộp câu chữ của ba việc ấy về đây thì phải GỠ đường ghi
// cũ trong cùng một lượt, không phải thêm song song.
// ⚠️ Riêng ba dòng cũ ấy mang `metadata.system` (marker của MÁY) chứ không phải `heThong`
// — xem chú thích dài ở `./ghi.ts` trước khi định thống nhất marker.

/** Nhãn ngắn hiện trên panel (thay nhãn "Ghi chú" vốn dành cho ghi chú người gõ tay). */
export const NHAN_VIEC: Record<MaViec, string> = {
  "trial.xep-lop": "Xếp lớp trải nghiệm",
  "trial.go-lop": "Gỡ khỏi lớp trải nghiệm",
  "trial.xep-case": "Xếp vào case trải nghiệm",
  "trial.go-case": "Gỡ khỏi case trải nghiệm",
  "trial.diem-danh": "Điểm danh trải nghiệm",
  "trial.doi-lich": "Đổi lịch trải nghiệm",
  "trial.huy-buoi": "Huỷ buổi trải nghiệm",
  "trial.huy-lop": "Huỷ lớp trải nghiệm",
  "don.tao": "Tạo đơn",
  "don.doi-trang-thai": "Đổi trạng thái đơn",
  "don.sua-ghi-chu": "Sửa ghi chú đơn",
  "chuyen-doi": "Chuyển đổi thành học viên",
  "ghi-danh.them": "Xếp vào lớp",
  "ghi-danh.doi-trang-thai": "Đổi trạng thái ghi danh",
  "ghi-danh.chuyen-lop": "Chuyển lớp",
  "ghi-danh.go": "Gỡ khỏi lớp",
  "ho-so.sua": "Sửa hồ sơ",
  "con.them": "Thêm con",
  "con.sua": "Sửa thông tin con",
  "con.go": "Gỡ con",
  "viec.tao": "Tạo việc cần làm",
  "viec.xong": "Hoàn thành việc",
};

/**
 * Đọc mã việc ra khỏi `metadata` của một dòng lịch sử.
 *
 * Dùng ở panel để biết dòng này do HỆ THỐNG ghi (⇒ lấy nhãn ở `NHAN_VIEC`) hay là ghi chú
 * người gõ tay (⇒ giữ nhãn "Ghi chú"). Trả `null` cho mọi thứ không nhận ra — kể cả một mã
 * việc đã bị xoá khỏi mã nguồn ở bản sau: dòng cũ trên DB vẫn còn, và nó phải rơi về nhãn
 * chung chứ không được làm vỡ trang.
 */
export function docMaViec(metadata: unknown): MaViec | null {
  const o = doiTuong(metadata);
  const v = o?.viec;
  return typeof v === "string" && v in NHAN_VIEC ? (v as MaViec) : null;
}

/**
 * Dòng này có phải do hệ thống ghi (dù không nhận ra mã việc) không?
 *
 * Hai marker, hai nghĩa — xem chú thích dài ở `./ghi.ts`:
 *   · `heThong` — SALE làm, hệ thống chép lại hộ (mọi dòng sinh từ `ghiTuongTacLead`).
 *   · `system`  — MÁY làm (auto-chia lead, `lib/lead/auto-assign.ts`). Dòng cũ dạng này
 *                 đang hiện trên panel với nhãn "Ghi chú", tức trông như có người gõ tay.
 *
 * Dùng cho việc DUY NHẤT là gắn dấu "tự động" trên panel. Đừng dùng nó để quyết định
 * nghiệp vụ: gộp hai marker lại là đổi hành vi auto-chia lead.
 */
export function laDongHeThong(metadata: unknown): boolean {
  const o = doiTuong(metadata);
  return o?.heThong === true || o?.system === true;
}

function doiTuong(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// ── bút pháp dùng chung ───────────────────────────────────────────────────────────────

/**
 * "20/09" — ngày theo giờ VN. KHÔNG đọc đồng hồ (nhận `Date` từ caller).
 *
 * ⚠️ `vnParts().month` là **0-11** (cố ý giống `Date.getMonth`), nên phải `+1`. Bản đầu
 * của hàm này viết `p.month` trần và in tháng 9 thành "08" — sai lặng, không ném lỗi.
 */
function ngay(d: Date): string {
  const p = vnParts(d);
  return `${String(p.day).padStart(2, "0")}/${String(p.month + 1).padStart(2, "0")}`;
}

/** "5.200.000đ" — cùng bút pháp với email/PDF (`formatVndPlain(x, false)`). */
function tien(n: number): string {
  return `${n.toLocaleString("vi-VN")}đ`;
}

/** Đuôi " Lý do: …" chỉ khi có lý do thật; ô rỗng KHÔNG sinh đuôi treo lơ lửng. */
function duoiLyDo(lyDo?: string | null): string {
  const s = (lyDo ?? "").trim();
  return s ? ` Lý do: ${s}.` : "";
}

/** Liệt kê trường đã sửa: "tên phụ huynh, email và 2 trường khác". */
function kePhepLiet(ds: readonly string[]): string {
  const sach = ds.map((s) => s.trim()).filter(Boolean);
  if (sach.length === 0) return "";
  if (sach.length <= 3) return sach.join(", ");
  return `${sach.slice(0, 2).join(", ")} và ${sach.length - 2} trường khác`;
}

const nhanDon = (s: OrderStatus | null) => (s ? ORDER_STATUS.label(s) : "—");
const nhanGhiDanh = (s: EnrollmentStatus | null) => (s ? ENROLLMENT_STATUS.label(s) : "—");

/**
 * MỘT sự việc → MỘT câu tiếng Việt đọc được.
 *
 * `switch` này KHÔNG có `default`: thêm nhánh vào `SuKienLead` mà quên viết câu là lỗi
 * biên dịch (`tsc` báo thiếu `return`), chứ không phải một dòng lịch sử trống trên màn
 * hình người dùng.
 */
export function moTaTuongTac(sk: SuKienLead): string {
  switch (sk.viec) {
    case "trial.xep-lop":
      return `Xếp ${sk.tenCon} vào lớp trải nghiệm ${sk.tenLop}.`;
    case "trial.go-lop":
      return `Gỡ ${sk.tenCon} khỏi lớp trải nghiệm ${sk.tenLop}.${duoiLyDo(sk.lyDo)}`;
    case "trial.xep-case":
      return `Xếp ${sk.tenCon} vào case ${sk.gio} của lớp trải nghiệm ${sk.tenLop}.`;
    case "trial.go-case":
      // Bé VẪN ở trong lớp — câu phải nói rõ điều đó, kẻo người đọc lịch sử tưởng bé đã
      // rời lớp (việc đó có dòng riêng, "trial.go-lop").
      return `Gỡ ${sk.tenCon} khỏi case ${sk.gio} của lớp trải nghiệm ${sk.tenLop} — bé vẫn trong lớp, chờ xếp case khác.`;
    case "trial.diem-danh":
      return `${sk.tenCon} ${sk.coMat ? "có mặt" : "vắng"} buổi trải nghiệm ngày ${ngay(
        sk.ngay,
      )} (lớp ${sk.tenLop}).`;
    case "trial.doi-lich":
      return `Đổi lịch buổi trải nghiệm lớp ${sk.tenLop}: ${ngay(sk.ngayTruoc)} ${
        sk.gioTruoc
      } → ${ngay(sk.ngaySau)} ${sk.gioSau}.${duoiLyDo(sk.lyDo)}`;
    case "trial.huy-buoi":
      return `Huỷ buổi trải nghiệm ngày ${ngay(sk.ngay)} của lớp ${sk.tenLop}.${duoiLyDo(
        sk.lyDo,
      )}`;
    case "trial.huy-lop":
      return `Huỷ lớp trải nghiệm ${sk.tenLop}, con đang xếp ở lớp này được gỡ ra.${duoiLyDo(
        sk.lyDo,
      )}`;
    case "don.tao":
      return `Tạo đơn ${sk.maDon}, tổng ${tien(sk.tongTien)}.`;
    case "don.doi-trang-thai":
      return `Đơn ${sk.maDon}: ${nhanDon(sk.tu)} → ${nhanDon(sk.den)}.`;
    case "don.sua-ghi-chu":
      return `Sửa ghi chú đơn ${sk.maDon}.`;
    case "chuyen-doi": {
      const ds = kePhepLiet(sk.tenCon);
      const n = sk.tenCon.filter((t) => t.trim()).length;
      return ds
        ? `Chốt lead thành học viên: ${n} học viên (${ds}).`
        : "Chốt lead thành học viên.";
    }
    case "ghi-danh.them":
      return `Xếp ${sk.tenCon} vào lớp ${sk.tenLop}.`;
    case "ghi-danh.doi-trang-thai":
      return `Ghi danh của ${sk.tenCon} ở lớp ${sk.tenLop}: ${nhanGhiDanh(
        sk.tu,
      )} → ${nhanGhiDanh(sk.den)}.`;
    case "ghi-danh.chuyen-lop":
      return `Chuyển ${sk.tenCon} từ lớp ${sk.lopCu} sang lớp ${sk.lopMoi}.`;
    case "ghi-danh.go":
      return `Gỡ ${sk.tenCon} khỏi lớp ${sk.tenLop}.${duoiLyDo(sk.lyDo)}`;
    case "ho-so.sua": {
      const ds = kePhepLiet(sk.truong);
      return ds ? `Sửa hồ sơ lead: ${ds}.` : "Sửa hồ sơ lead.";
    }
    case "con.them":
      return `Thêm con vào lead: ${sk.tenCon}.`;
    case "con.sua": {
      const ds = kePhepLiet(sk.truong);
      return ds ? `Sửa thông tin con ${sk.tenCon}: ${ds}.` : `Sửa thông tin con ${sk.tenCon}.`;
    }
    case "con.go":
      return `Gỡ con ${sk.tenCon} khỏi lead.`;
    case "viec.tao":
      return `Tạo việc cần làm "${sk.tieuDe}", hạn ${ngay(sk.hanChot)}.`;
    case "viec.xong":
      return `Hoàn thành việc "${sk.tieuDe}".`;
  }
}
