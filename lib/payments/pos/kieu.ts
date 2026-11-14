// lib/payments/pos/kieu.ts — HỢP ĐỒNG KIỂU của tầng import giao dịch thẻ SmartPOS. THUẦN.
//
// ⚠️ KHÔNG import prisma / db ở đây: file này chạy được trong TRÌNH DUYỆT (màn import đọc file
// ở client rồi mới gửi lên) lẫn ở server. Thiết kế: `docs/pos-the-smartpos.md`.
//
// Mọi agent/tầng dùng chung các tên dưới đây — đổi tên là vỡ hợp đồng.
import { z } from "zod";

/** `BankTransaction.provider` của giao dịch thẻ. `Payment.method` tương ứng là `"card_pos"`. */
export const PROVIDER_THE_POS = "CARD_POS" as const;

/**
 * GĐ1 POS (06/10/2026) — NGUỒN DỮ LIỆU của một giao dịch thẻ, ghi vào
 * `BankTransaction.rawPayload.nguon`. D5: mọi nguồn dùng CHUNG provider `CARD_POS` (khoá chống
 * trùng `(provider, providerTxnId)` phải là một) — nguồn chỉ là nhãn để truy vết.
 */
export type NguonDuLieuPos = "SMARTPOS" | "TCB_API" | "FAKE" | "TCB_PORTAL";
// 07/10/2026 — GĐ4 POS: `TCB_PORTAL` = dòng do máy đồng bộ (Chrome extension đọc merchant portal) đưa vào.

/**
 * GĐ1 POS — kết quả TIỀN của MỘT dòng thanh toán thẻ, do thân dòng chung (`khopGiaoDichThe` /
 * `nhapLoPos`) trả ra. Người gọi dịch sang trạng thái của mình (phiếu POS: `quyetPhieuPos`).
 * Thiết kế: docs/pos-gd1-thiet-ke.md §3.2.
 */
export type KetQuaTienThe =
  /** Lượt NÀY ghi tiền: `thuTheoPhieuGop` DA_CHIA. */
  | { loai: "DA_CHIA"; btId: string; billId: string; orderId: string }
  /**
   * Giao dịch đã rời hàng chờ từ TRƯỚC (khớp máy / gắn tay / bỏ qua) — gồm TRUNG đọc lại.
   * `huySauGhiNhan` (rà đối kháng 06/10/2026, D7): giao dịch đã MATCHED mà dữ liệu nay mang tín hiệu
   * hủy/hoàn (cột Hoàn/Hủy · dòng hủy/hoàn trỏ tới). BẮT BUỘC (luật 7) — bản trước mất tín hiệu này
   * ở nhánh ĐÃ KHOÁ nên phiếu POS báo xanh "Đã ghi nhận" cho một lần quẹt đã hoàn về thẻ khách.
   */
  | { loai: "DA_KHOA"; btId: string | null; trangThaiBt: "MATCHED" | "IGNORED" | null; huySauGhiNhan: boolean }
  /** Giao dịch nằm hàng chờ tay. `LECH_SO` mang số để nói "máy X, phiếu cần Y". */
  | {
      loai: "CHO_TAY";
      btId: string | null;
      lyDo: "LECH_SO" | "KHAC";
      ghiChu: string;
      conPhaiThu: number | null;
    }
  /** Thất bại / hủy-hoàn TOÀN PHẦN — không tiền nào ở lại. */
  | { loai: "BO_QUA"; btId: string | null; lyDo: string }
  /** Q-G: hoàn MỘT PHẦN — giao dịch IGNORED + cảnh báo, kế toán điều chỉnh. */
  | { loai: "CHAN_HOAN_MOT_PHAN"; btId: string; lyDo: string };

/**
 * Che số thẻ: MỌI dãy 13–19 chữ số (cho phép một dấu cách / chấm / gạch giữa hai chữ số) nằm
 * BẤT KỲ ĐÂU trong chuỗi ⇒ còn 6 đầu + 4 cuối. File của ngân hàng đã che sẵn; hàm này là lưới
 * cuối cho mọi đường vào (file lạ, client cũ, POST dựng tay) — số thẻ đầy đủ không được vào hệ
 * thống dưới bất kỳ lý do nào. `dongPosSchema` gọi nó ở SERVER, không chỉ ở màn đọc file.
 *
 * Bản cũ chỉ bắt chuỗi TOÀN chữ số sau khi bỏ `[\s-]`, nên `4111.1111.1111.1111` và
 * `VISA 4111111111111111` lọt nguyên (ca `[POS-K01]`).
 */
export function cheSoThe(s: string): string {
  return s.replace(/\d(?:[\s.-]?\d){12,18}/g, (khop) => {
    const so = khop.replace(/\D/g, "");
    return so.slice(0, 6) + "*".repeat(so.length - 10) + so.slice(-4);
  });
}

/**
 * Một dòng của file "Danh sách giao dịch V2" (merchant.techcombank.com) SAU khi đọc.
 *
 * ⚠️ CỐ Ý KHÔNG có "Tên chủ thẻ" và mọi cột khác ngoài danh sách dưới — dữ liệu chủ thẻ
 * không được vào hệ thống. `soTheMasked` là số thẻ ĐÃ CHE (tầng đọc che thêm nếu lọt số đầy đủ).
 */
export const dongPosSchema = z.object({
  maGiaoDich: z.string().regex(/^[0-9A-Za-z]{8,64}$/),
  loaiGiaoDich: z.string(),
  hinhThuc: z.string(),
  trangThai: z.string(),
  soTien: z.number().int(),
  /** ISO 8601 có offset +07:00, vd `2026-09-29T17:31:35+07:00`. */
  thoiGian: z.string(),
  dienGiai: z.string().max(4000),
  maChuanChi: z.string().nullable(),
  maGiaoDichThe: z.string().nullable(),
  maGiaoDichGoc: z.string().nullable(),
  trangThaiHoanHuy: z.string().nullable(),
  maDonHang: z.string().nullable(),
  maQuay: z.string().nullable(),
  maThietBi: z.string().nullable(),
  soTheMasked: z
    .string()
    .nullable()
    .transform((v) => (v === null ? null : cheSoThe(v))),
  loaiThe: z.string().nullable(),
  maHachToan: z.string().nullable(),
  phiGiaoDich: z.number().int().nullable(),
});

export type DongPos = z.infer<typeof dongPosSchema>;

/** ISO 8601 CÓ múi giờ tường minh (`Z` hoặc `±hh:mm`), giây + phần nghìn giây tuỳ chọn. */
const ISO_CO_MUI = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * GĐ3 POS (06/10/2026, V3) — chuỗi là MỘT thời điểm tuyệt đối CÓ THẬT: đúng dạng ISO có múi giờ,
 * ngày/giờ/múi nằm trong khoảng hợp lệ.
 *
 * Vì sao không chỉ `!isNaN(new Date(s))`: chuỗi KHÔNG múi (`2026-09-29T10:00:00`) được `new Date`
 * đọc theo giờ MÁY CHỦ — VPS chạy UTC ⇒ lệch 7 tiếng, quẹt 0h–7h bị ghi sang ngày trước. Và `new Date`
 * của V8 CUỘN ngày vô lý (`2026-02-30` ⇒ 02/03) và nhận `24:00` (đo 06/10/2026, Node 26) ⇒ so lại từng
 * thành phần. KHÔNG ép riêng `+07:00`: mọi chuỗi có múi đều là một thời điểm đúng (V3).
 */
export function laThoiDiemCoMui(s: string): boolean {
  const m = ISO_CO_MUI.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const u = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  const dungThanhPhan =
    u.getUTCFullYear() === y &&
    u.getUTCMonth() === mo - 1 &&
    u.getUTCDate() === d &&
    u.getUTCHours() === h &&
    u.getUTCMinutes() === mi &&
    u.getUTCSeconds() === se;
  if (!dungThanhPhan) return false;
  if (m[7] !== undefined && (Number(m[7]) > 14 || Number(m[8]) > 59)) return false;
  return !Number.isNaN(new Date(s).getTime());
}

/**
 * GĐ3 POS (06/10/2026, V3 + V4) — hợp đồng LỐI VÀO của hai action nhập file (`batDauNhapPosAction`,
 * `nhapLoPosAction`) VÀ của tầng đọc file (`docFilePos`): file nào màn nhận thì server cũng nhận.
 * Chặt hơn `dongPosSchema` ở hai điểm: `thoiGian` phải có múi giờ tường minh, mọi chuỗi có trần độ dài
 * (cùng mức `dongHuyPosSchema`; giá trị thật dài nhất đo được là `maDonHang`, 26 ký tự).
 *
 * ⚠️ KHÔNG siết `dongPosSchema`: nó dùng CHUNG với provider — `dongTuBanGhi` dựng `thoiGian: ""`,
 * `xu-ly-ket-qua.ts` parse kết quả provider bằng nó; siết ở đó là ném lỗi GIỮA pha tiền.
 */
export const dongPosNhapSchema = dongPosSchema.extend({
  thoiGian: z
    .string()
    .max(40)
    .refine(laThoiDiemCoMui, "phải là thời điểm ISO 8601 có múi giờ (Z hoặc ±hh:mm), vd 2026-09-29T17:31:35+07:00"),
  loaiGiaoDich: z.string().max(200),
  hinhThuc: z.string().max(200),
  trangThai: z.string().max(200),
  maChuanChi: z.string().max(64).nullable(),
  maGiaoDichThe: z.string().max(64).nullable(),
  maGiaoDichGoc: z.string().max(64).nullable(),
  trangThaiHoanHuy: z.string().max(200).nullable(),
  maDonHang: z.string().max(200).nullable(),
  maQuay: z.string().max(200).nullable(),
  maThietBi: z.string().max(200).nullable(),
  soTheMasked: z
    .string()
    .max(64)
    .nullable()
    .transform((v) => (v === null ? null : cheSoThe(v))),
  loaiThe: z.string().max(200).nullable(),
  maHachToan: z.string().max(200).nullable(),
});

/**
 * Bản TÓM của một dòng Hủy/Hoàn — màn import gửi kèm mỗi lô các dòng hủy của CẢ FILE trỏ vào
 * dòng thanh toán trong lô (cặp Thanh toán + Hủy có thể rơi vào hai lô).
 *
 * ⚠️ Server KHÔNG tin một danh sách "mã gốc bị hủy" do client tự tính: nó nhận các cột mà
 * `phanLoaiDongPos` cần rồi TỰ phân loại — dòng Hủy "Thất bại" hay hoàn MỘT PHẦN không được
 * làm gốc bị bỏ qua (ca `[POS-DB-14]`, `[POS-DB-15]`).
 */
export const dongHuyPosSchema = z.object({
  maGiaoDich: z.string().regex(/^[0-9A-Za-z]{8,64}$/),
  loaiGiaoDich: z.string().max(200),
  trangThai: z.string().max(200),
  soTien: z.number().int(),
  maGiaoDichGoc: z.string().max(64).nullable(),
  trangThaiHoanHuy: z.string().max(200).nullable(),
});

export type DongHuyPos = z.infer<typeof dongHuyPosSchema>;

/**
 * Tên header (dòng 1, đã trim) BẮT BUỘC có trong mỗi file. Tìm cột theo TÊN, không theo vị trí:
 * file thật có ~65 cột và ngân hàng đổi thứ tự cột không báo trước.
 */
export const COT_BAT_BUOC: readonly string[] = [
  "Mã giao dịch",
  "Loại giao dịch",
  "Hình thức thanh toán",
  "Trạng thái giao dịch",
  "Số tiền thanh toán",
  "Thời gian giao dịch",
  "Diễn giải đơn hàng",
  "Mã chuẩn chi",
  "Mã giao dịch thẻ",
  "Mã giao dịch gốc",
  "Trạng thái Hoàn/Hủy",
  "Mã đơn hàng",
  "Mã quầy thanh toán",
  "Mã thiết bị",
  "Số thẻ",
  "Loại thẻ",
  "Mã hạch toán",
  "Phí giao dịch",
];
