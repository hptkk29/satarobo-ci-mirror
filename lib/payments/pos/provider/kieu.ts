// lib/payments/pos/provider/kieu.ts — HỢP ĐỒNG của tầng PROVIDER phiếu thu thẻ (GĐ1 POS). THUẦN.
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §2. Provider CHỈ BÁO máy/ngân hàng thấy gì (T3) — đúng số hay
// lệch số do `thuTheoPhieuGop` quyết theo `conPhaiThuCuaPhieu` LÚC KHỚP, không do provider so.
//
// ⚠️ Zod là NGUỒN KIỂU, và `xuLyKetQuaPos` chạy `docKetQuaPos` trên MỌI kết quả trước khi tin: một
// provider (hôm nay đọc file, mai gọi API) trả trường hỏng thì đó là PROVIDER_ERROR `KET_QUA_HONG`,
// không phải một lần ghi tiền theo dữ liệu rác.
//
// ⚠️ KHÔNG có `raw` (T13): không lưu thì không có chỗ cho PII rò. KHÔNG có tên chủ thẻ ở bất kỳ
// trường nào; số thẻ đi qua `cheSoThe` (lưới cuối — như `dongPosSchema`).
import { z } from "zod";
import { cheSoThe, type NguonDuLieuPos } from "../kieu";

export const POS_CHECK_KINDS = [
  "PAID",
  "PAID_AMOUNT_MISMATCH",
  "FAILED",
  "NOT_FOUND",
  "CANCELLED_AFTER_PAID",
  "PROVIDER_ERROR",
] as const;
export type PosCheckKind = (typeof POS_CHECK_KINDS)[number];

/** Kết quả một lượt hỏi máy/ngân hàng. Provider chỉ BÁO; tiền do hệ thống quyết (T3). */
export const posCheckResultSchema = z.object({
  kind: z.enum(POS_CHECK_KINDS),
  /** = "Mã giao dịch" của file = khoá `BankTransaction.providerTxnId`. Cùng regex `dongPosSchema`. */
  providerTxnId: z
    .string()
    .regex(/^[0-9A-Za-z]{8,64}$/)
    .optional(),
  amount: z.number().int().optional(),
  /** ISO 8601 có +07:00 (giờ quẹt — Q-C). */
  paidAt: z.string().max(64).optional(),
  /** Mã chuẩn chi. */
  approvalCode: z.string().max(64).nullable().optional(),
  // `transform` đặt TRONG `optional()` để khoá vẫn là tuỳ chọn ở kiểu suy ra (z.infer).
  cardMasked: z
    .string()
    .max(64)
    .transform((v) => cheSoThe(v))
    .nullable()
    .optional(),
  /** Mã thiết bị. */
  terminalCode: z.string().max(128).nullable().optional(),
  reasonCode: z.string().max(64).optional(),
  /** [T13] Ghi chú NGUYÊN VĂN máy ghi — HỆ THỐNG tự `tachMaPos` (D2), không tin provider tách hộ. */
  dienGiai: z.string().max(4000).nullable().optional(),
  /** [T13] NOT_FOUND: lần nhập dữ liệu cuối + giờ giao dịch mới nhất có trong dữ liệu (ISO +07:00). */
  duLieuCapNhatLuc: z.string().max(64).nullable().optional(),
  gdMoiNhatLuc: z.string().max(64).nullable().optional(),
  /**
   * [Rà đối kháng 06/10/2026] NOT_FOUND mà dữ liệu CÓ dòng mang mã nhưng trạng thái CHƯA NGÃ NGŨ
   * (không "Thành công", không "Thất bại" — vd "Đang xử lý", hoặc chữ lạ) — mã đã chuẩn hoá
   * (`maTrangThaiPos`). Fail-closed (Q-I): KHÔNG gọi là thất bại ⇒ không mời quẹt lại một khoản có
   * thể đang bị trừ thẻ.
   */
  trangThaiTreo: z.string().max(64).optional(),
  /** [T13] Số giao dịch THÀNH CÔNG khác cùng mã, chưa thuộc phiếu POS nào — cảnh báo thu đôi. */
  giaoDichKhac: z.number().int().min(0).optional(),
  /** [GĐ4 T16] Nhãn cơ sở ("CS1") cho câu D9 "Tạm mất kết nối Techcombank CSx". */
  coSo: z.string().max(32).optional(),
  /**
   * [GĐ4 T6] Lượt SALE: máy đồng bộ chưa trả lời job trong 8″ ⇒ chỉ tin PAID; còn lại NOT_FOUND + cờ này ⇒ câu
   * "chưa trả lời kịp — ĐỪNG cho quẹt lại" (dữ liệu chưa tươi: "Thất bại — cho quẹt lại" có thể là trừ thẻ lần hai).
   */
  dongBoChuaXong: z.boolean().optional(),
  /**
   * [Rà đối kháng bản gộp GĐ3 × GĐ4 — RVG-01] Chế độ AGENT: máy đồng bộ của phiếu có dòng BỊ TỪ CHỐI (dấu nguồn
   * `tuChoi`) trong cửa sổ đọc mà CHƯA có dòng POS nào cùng mã giao dịch ⇒ NOT_FOUND / FAILED trần là nói sai ("chưa
   * thấy" · "cho quẹt lại" — lần quẹt của sale có thể CHÍNH là dòng bị từ chối, khách đã bị trừ thẻ) ⇒ NOT_FOUND + cờ
   * này ⇒ câu "không đọc được — ĐỪNG cho quẹt lại".
   */
  dongBiTuChoi: z.boolean().optional(),
  /** [GĐ4 T27] Dữ liệu đọc ở chế độ nào — câu NOT_FOUND / "Đang xử lý" phải đúng nguồn (luật 12). */
  cheDoNguon: z.enum(["FILE", "AGENT"]).optional(),
  /**
   * [Rà đối kháng GĐ4 — RV-09] Nhãn nguồn của DỮ LIỆU provider vừa đọc (`BankTransaction.rawPayload.nguon` khi pha
   * tiền ghi). Vắng ⇒ `provider.nguonDuLieu`. Provider chọn chế độ theo dữ liệu (`TcbPortalAgentProvider`) báo
   * `SMARTPOS` ở chế độ FILE — bản đầu gắn TCB_PORTAL cho giao dịch file của cơ sở không hề có agent.
   */
  nguonDuLieu: z.enum(["SMARTPOS", "TCB_API", "FAKE", "TCB_PORTAL"]).optional(),
});
export type PosCheckResult = z.infer<typeof posCheckResultSchema>;

/** Kết quả hỏng ⇒ coi như lỗi provider có mã — KHÔNG ném, KHÔNG đi ghi tiền. */
export const KET_QUA_HONG: PosCheckResult = { kind: "PROVIDER_ERROR", reasonCode: "KET_QUA_HONG" };

/** Đọc một kết quả provider qua schema; hỏng ⇒ `PROVIDER_ERROR KET_QUA_HONG`. */
export function docKetQuaPos(raw: unknown): PosCheckResult {
  const r = posCheckResultSchema.safeParse(raw);
  return r.success ? r.data : { ...KET_QUA_HONG };
}

/** Phần của phiếu POS mà provider được thấy — không có gì của khách. */
export type IntentDeKiem = {
  id: string;
  code5: string;
  amount: number;
  createdAt: Date;
  expiresAt: Date;
  centerId: string;
  posTerminalId: string | null;
  /**
   * Giao dịch phiếu này ĐÃ nhận (nếu có) — provider ưu tiên trả lại CHÍNH giao dịch ấy, để lượt
   * kiểm sau không đổi sang một giao dịch khác cùng mã và lật trạng thái phiếu.
   */
  bankTransactionId: string | null;
};

export interface PosProvider {
  /** GĐ4: `TCB_AGENT` = provider chọn FILE/AGENT theo dữ liệu (`provider/tcb-agent.ts`). */
  readonly ten: "FAKE" | "TCB_FILE" | "TCB_API" | "TCB_AGENT";
  /** Nguồn dữ liệu ghi vào `BankTransaction.rawPayload.nguon` (D5: MỘT provider `CARD_POS`). */
  readonly nguonDuLieu: NguonDuLieuPos;
  /** `now` BẮT BUỘC (luật 19). KHÔNG ném — lỗi ⇒ `{ kind: "PROVIDER_ERROR", reasonCode }`. */
  checkStatus(intent: IntentDeKiem, now: Date): Promise<PosCheckResult>;
  /** Để chỗ GĐ sau: đẩy đơn sang máy (SmartPOS order push). */
  pushOrder?(intent: IntentDeKiem): Promise<void>;
  /** Để chỗ GĐ sau: webhook ngân hàng → danh sách kết quả. */
  parseWebhook?(body: unknown): Promise<PosCheckResult[]>;
}
