import { z } from "zod";

/**
 * ONLINE EXAM P0 — HỢP ĐỒNG HTTP THẬT (V8.45, Workstream A, nối lõi E `lib/elearning-online/luot-nhap-db.ts`).
 *
 * Thay HOÀN TOÀN hợp đồng nháp cũ (CAS một `version` cho cả lượt, header `Idempotency-Key`, 409 `DRAFT_VERSION_CONFLICT`, cổng `CongNhapLuotOnline` + 503):
 * lõi E lưu nháp THEO TỪNG CÂU với `baseRevision` + `requestId` (client sinh MỘT lần cho MỘT thao tác lưu, gửi lại ĐÚNG requestId khi retry).
 * Xung đột phiên bản là HTTP 200 + `ketQua: "CONFLICT"|"AHEAD"` TỪNG CÂU — không bao giờ là 4xx cho cả yêu cầu.
 *
 * Tệp này THUẦN (không DB, không import lõi E): chỉ lược đồ + kiểu DTO. Phần nối lõi nằm ở `dich-vu/online-hoc.ts` (tệp DUY NHẤT được import `@/lib/elearning-online`, lưới `[MIEN-A-01]`).
 */

/** Trần cứng của lược đồ lõi E (`luuNhapSchema`): 100 câu/yêu cầu; thực tế trần cấu hình là `toiDaCauMoiYeuCau` (mặc định 50). */
export const TRAN_SO_CAU_MOI_YEU_CAU = 100;

export const luuNhapSchema = z.strictObject({
  /** 8–100 ký tự (vd UUID). Sinh MỘT lần cho MỘT thao tác lưu; gửi lại ĐÚNG giá trị này khi retry (máy chủ trả lại đúng kết quả cũ, không ghi hai lần). Payload khác ⇒ requestId MỚI. */
  requestId: z.string().trim().min(8).max(100),
  /** Mã thiết bị (tuỳ chọn, ghi nhận). */
  deviceId: z.string().trim().min(1).max(100).optional(),
  /** CÁC CÂU ĐỔI (không phải cả bài). `baseRevision` = revision máy chủ mà app đang giữ cho câu đó (0 = chưa có nháp). */
  items: z
    .array(
      z.strictObject({
        questionId: z.string().min(1).max(60),
        /** Hình dạng theo dạng câu (13 dạng) — do lõi E kiểm (`kiemDapAnNhap`). Sai ⇒ chỉ CÂU ĐÓ bị `SAI_KIEU`, câu khác vẫn lưu. */
        answer: z.unknown(),
        baseRevision: z.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1)
    .max(TRAN_SO_CAU_MOI_YEU_CAU),
});
export type LuuNhapInput = z.infer<typeof luuNhapSchema>;

export type KetQuaCauDto =
  | { questionId: string; ketQua: "SAVED"; revision: number; savedAt: string }
  | { questionId: string; ketQua: "CONFLICT" | "AHEAD"; serverRevision: number; serverAnswer: unknown; serverSavedAt: string | null }
  | { questionId: string; ketQua: "SAI_KIEU" | "CAU_KHONG_THUOC_LUOT"; ma: "DAP_AN_KHONG_HOP_LE" | "CAU_KHONG_THUOC_LUOT"; thongBao: string }
  | { questionId: string; ketQua: "KHONG_XAC_DINH"; thongBao: string };

export type TrangThaiLuot = "IN_PROGRESS" | "SUBMITTED" | "GRADED" | "EXPIRED" | "INTERRUPTED";

/** 200 của PUT draft. `items` CÙNG THỨ TỰ yêu cầu. Chỉ câu `SAVED` mới được coi là ĐÃ LƯU. */
export type LuuNhapDto = {
  /** true ⇔ cùng (lượt, requestId) đã ghi trước đó — kết quả cũ được trả lại. */
  daGuiLai: boolean;
  trangThai: TrangThaiLuot;
  /** Giờ MÁY CHỦ — app chỉ hiển thị, KHÔNG quyết định hết giờ. */
  serverNow: string;
  hetGioLuc: string | null;
  giayConLai: number | null;
  draftRevision: number;
  items: KetQuaCauDto[];
  soCauDaLuu: number;
  /** Số câu bị từ chối riêng (SAI_KIEU / CAU_KHONG_THUOC_LUOT / KHONG_XAC_DINH). */
  soCauTuChoi: number;
};

export type GianDoanDto = { thuHoiLuc: string; trangThai: "OPEN" | "COMPENSATED" | "NO_COMPENSATION_NEEDED" | "CAP_REACHED" | "PENDING_REVIEW" | "DENIED" };
export type LuotThayTheDto = { trangThai: "AVAILABLE" | "USED" | string; luotThayTheId: string | null };
export type LuotConLaiDto = { daDung: number; luotThayTheDangCho: number; toiDa: null; conLai: null };

/** GET …/status — nhẹ (KHÔNG có đề/đáp án). `coKetQua=false` với INTERRUPTED/EXPIRED: KHÔNG phải trượt, KHÔNG có điểm. */
export type TrangThaiLuotDto = {
  luotId: string;
  soLuot: number;
  trangThai: TrangThaiLuot;
  serverNow: string;
  hetGioLuc: string | null;
  giayConLai: number | null;
  draftRevision: number;
  coKetQua: boolean;
  /** Lượt do máy chủ tự chốt theo nháp khi hết giờ (`lyDoChot = DEADLINE_AUTO`). */
  tuDongNop: boolean;
  lyDoChot: string | null;
  gianDoan: GianDoanDto | null;
  luotThayThe: LuotThayTheDto | null;
  luotConLai: LuotConLaiDto;
};

/** GET …/draft — TIẾP TỤC: trạng thái + nháp đã được máy chủ ACK + đề (CHỈ khi đang IN_PROGRESS; không đáp án đúng). */
export type NhapLuotDto = TrangThaiLuotDto & {
  nhap: { questionId: string; revision: number; savedAt: string; dapAn: unknown }[];
  de: Record<string, unknown> | null;
};
