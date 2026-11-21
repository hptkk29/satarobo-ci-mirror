/**
 * Lưu kết quả DISC (PRD v2.0 §Bước 3–4) — dịch vụ THUẦN theo cổng `DiscStore` (tiêm vào),
 * nên luật nghiệp vụ test được không cần DB. Bản Prisma nằm ở `store-prisma.ts`.
 *
 * Bất biến:
 *  1. KHÔNG chạm bảng User/Lead để quyết định gì về SĐT — nên phản hồi không thể là oracle dò
 *     "SĐT đã có tài khoản chưa" (P0.4). Phản hồi cùng hình cho SĐT mới/cũ.
 *  2. Idempotent theo `idempotencyKey` (≥22 ký tự base64url): bấm lặp/mạng chập chờn ⇒ MỘT dòng, MỘT lead,
 *     MỘT email. Phát lại chỉ hợp lệ khi bản ghi còn PENDING_CLAIM, chưa xoá, chưa hết hạn, cùng SĐT VÀ
 *     `payloadHash` (HMAC các trường có nghĩa) khớp; khác một điều kiện ⇒ `LUU_THAT_BAI`, KHÔNG xoay
 *     token, KHÔNG nói "đã lưu" (F-01/F-02).
 *  3. Chỉ trả `ok` sau khi `store.taoHoacLayTheoKhoa` đã ghi xong. Lỗi ghi ⇒ `ok:false`
 *     (giao diện KHÔNG được nói "đã lưu").
 *  4. Lưu ở PENDING_CLAIM. KHÔNG tự gắn User. Nhận bài = SĐT đã qua OTP + mã nhận + thách đố năm sinh
 *     của con (xem `nhan.ts`) — chỉ OTP SĐT không đủ, vì ai cũng gõ được SĐT người khác ở màn Lưu.
 *  5. Email: không có ⇒ trạng thái NONE. Có ⇒ VERIFICATION_REQUIRED (chưa xác minh thì KHÔNG
 *     gửi báo cáo có thông tin trẻ). Sau khi lưu, `deps.guiEmail` xếp MỘT thư chỉ chứa liên kết xác
 *     minh; lời thông báo trả về theo kết quả THẬT của nó (xếp được ⇒ "sẽ gửi liên kết"; không ⇒ nói
 *     thẳng "chưa gửi được"). Không bao giờ khẳng định đã gửi báo cáo.
 *  6. Token tải PDF lần đầu: sinh ngẫu nhiên, lưu HASH, hạn ngắn, trả plaintext đúng một lần.
 *  7. CHỐNG TIN ĐIỂM CLIENT (quyết định D1): engine chạy Ở SERVER. Client lấy bộ đề qua
 *     `POST /api/disc/bo-de`, gửi CÂU TRẢ LỜI THÔ; server chọn bộ đề từ hồ sơ, tự chấm bằng
 *     `layEngine().cham()` rồi BỎ câu trả lời thô — chỉ điểm đi tiếp (không store nào nhận câu trả lời).
 *     Chưa có engine ⇒ `ENGINE_CHUA_SAN_SANG`. Điểm do client gửi chỉ được nhận qua MỘT cổng thử
 *     nghiệm (`choPhepTinDiemClient`) không bao giờ mở ở production.
 *  8. `phoneKey` lưu DB = HMAC (`phone-key.ts`), không phải SĐT. SĐT chuẩn hoá chỉ đi vào cổng CRM (lead)
 *     trong bộ nhớ.
 *  9. Một nguồn lưu kết quả: `DiscSubject.result`. KHÔNG có văn bản tự do (`tomTat`) từ client.
 * 10. Trần bài mới (DB) là lưới thứ hai sau bộ đếm tần suất của route (F-03). Có HAI trần (N6): theo cặp (SĐT, IP băm) và
 *     một trần cứng cao hơn theo SĐT — xem `chinh-sach.ts`. Trần cứng trả `LUU_THAT_BAI` (không phân biệt được với lỗi khác).
 * 11. Khoá băm = `layKhoaDisc()` (DISC_PEPPER riêng, rơi về secret ký chung); phiên bản khoá ghi vào dòng (N9).
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { canonicalPhone } from "@/lib/phone";
import { laProductionThat, type BienMoiTruong } from "@/lib/security/client-ip";
import {
  CUA_SO_DEM_BAI_THEO_SDT_MS,
  DO_DAI_TOI_DA_KHOA_IDEM,
  DO_DAI_TOI_THIEU_KHOA_IDEM,
  MAU_KHOA_IDEM,
  NGAY_GIU_BAI_CHUA_NHAN,
  TOI_DA_BAI_MOI_THEO_CAP,
  TOI_DA_BAI_MOI_THEO_SDT_TRAN_CUNG,
  TOI_DA_CAU_TRA_LOI,
  TOI_DA_LAN_THU_MA,
  chienDichHopLe,
} from "./chinh-sach";
import { layEngine, type DiscEngine, type TraLoiTho } from "./engine";
import { kiemTraDiaChi, type DiaChiKhai } from "./dia-chi";
import { kiemTraHoSo, namHienTaiVN } from "./ho-so";
import { ipKeyTuIp, layKhoaDisc, phienBanPepper, phoneKeyTuSdtChuan } from "./phone-key";
import { thongBaoSauLuu, type KetQuaLinkXacMinh, type ThongBaoSauLuu, type TrangThaiEmail } from "./thong-bao";

// Giữ đường import cũ (`@/lib/disc/luu`) cho các tệp đã dùng; nguồn thật ở `chinh-sach.ts`.
export { NGAY_GIU_BAI_CHUA_NHAN, TOI_DA_CAU_TRA_LOI, TOI_DA_LAN_THU_MA };

export const PHIEN_BAN_DONG_Y = "disc-consent-2026-11-v1";
export const HAN_TOKEN_TAI_PHUT = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Cổng thử nghiệm "tin điểm client"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ RỦI RO: bật cổng này thì server LƯU điểm do client tự khai, không chấm lại — ai gọi API cũng
 * bịa được kết quả. Chỉ dùng cho test/UAT với dữ liệu GIẢ khi engine chưa có. Điều kiện (tất cả):
 *   DISC_TEST_TRUST_CLIENT_SCORES === "true"  VÀ  NODE_ENV !== "production"  VÀ  không phải prod thật
 * (VERCEL_ENV/CI — `laProductionThat`). Mặc định TẮT; production luôn TẮT dù biến có bị đặt nhầm.
 */
export function choPhepTinDiemClient(env: BienMoiTruong = process.env): boolean {
  if (env.DISC_TEST_TRUST_CLIENT_SCORES !== "true") return false;
  if (env.NODE_ENV === "production") return false;
  if (laProductionThat(env)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mã nhận (claim code)
// ─────────────────────────────────────────────────────────────────────────────

/** 32 ký tự, không 0/O/1/I ⇒ 5 bit/ký tự; `byte & 31` đều (32 | 256) nên KHÔNG lệch phân phối. */
export const BANG_MA_NHAN = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
/** 10 ký tự × 5 bit = 50 bit entropy. */
export const DO_DAI_MA_NHAN = 10;

export function sinhMaNhan(nguonNgauNhien: (n: number) => Uint8Array = randomBytes): string {
  const b = nguonNgauNhien(DO_DAI_MA_NHAN);
  let ma = "";
  for (let i = 0; i < DO_DAI_MA_NHAN; i++) ma += BANG_MA_NHAN[b[i]! & 31];
  return ma;
}

/** Người dùng có thể gõ thường, có dấu cách/gạch ngang. Sai độ dài/ký tự ngoài bảng ⇒ null. */
export function chuanHoaMaNhan(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  if (s.length !== DO_DAI_MA_NHAN) return null;
  for (const c of s) if (!BANG_MA_NHAN.includes(c)) return null;
  return s;
}

/** "ABCDEFGHJK" ⇒ "ABCDE-FGHJK" để người dùng chép tay dễ hơn. Chỉ để HIỂN THỊ. */
export function hienThiMaNhan(ma: string): string {
  return ma.length === DO_DAI_MA_NHAN ? `${ma.slice(0, 5)}-${ma.slice(5)}` : ma;
}

/**
 * HMAC (không phải SHA trần): 50 bit dò được offline nếu lộ DB mà không có khoá. Khoá = `layKhoaDisc()` (DISC_PEPPER
 * riêng nếu đã đặt, rơi về secret ký chung — xem `phone-key.ts`). Đổi khoá ⇒ mọi mã nhận cũ vô hiệu.
 */
export function bamMaNhan(ma: string, khoa: string): string {
  return createHmac("sha256", khoa).update(`disc-claim-v1:${ma}`).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// payloadHash — băm các trường CÓ NGHĨA để phát hiện "cùng khoá, nội dung khác"
// ─────────────────────────────────────────────────────────────────────────────

/** JSON tất định: khoá object sắp xếp, nên thứ tự khoá của client không làm đổi hash. */
export function jsonOnDinh(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jsonOnDinh).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonOnDinh(o[k])}`)
    .join(",")}}`;
}

/**
 * HMAC (không phải SHA trần): tên con, năm sinh, câu trả lời đều ít entropy — hash trần cho phép kẻ có DB
 * xác nhận một giả thuyết hồ sơ. Miền băm riêng `disc-payload-v1`.
 */
export function bamPayload(truong: unknown, khoa: string): string {
  return createHmac("sha256", khoa).update(`disc-payload-v1:${jsonOnDinh(truong)}`).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Lược đồ vào
// ─────────────────────────────────────────────────────────────────────────────

const diemSo = z.number().min(0).max(100);
/**
 * Kết quả MỘT người = điểm + mã/phiên bản bộ đề. KHÔNG có văn bản tự do (đã bỏ `tomTat`, F-05): zod bỏ
 * khoá lạ, nên `tomTat` do client gửi — hay do engine trả — không bao giờ tới store.
 */
export const ketQuaNguoiSchema = z.object({
  diem: z.object({ D: diemSo, I: diemSo, S: diemSo, C: diemSo }),
  maBoDe: z.string().min(1).max(40),
  phienBanBoDe: z.string().min(1).max(40),
});

const traLoiThoSchema = z
  .record(z.string().min(1).max(40), z.number().finite().min(-1000).max(1000))
  .refine((o) => Object.keys(o).length > 0 && Object.keys(o).length <= TOI_DA_CAU_TRA_LOI, "Số câu trả lời không hợp lệ");

/** ĐƯỜNG THẬT: câu trả lời thô. Server tự chấm. */
export const baiNguoiSchema = z.object({
  maBoDe: z.string().min(1).max(40),
  traLoi: traLoiThoSchema,
});

export const luuSchema = z.object({
  idempotencyKey: z.string().min(DO_DAI_TOI_THIEU_KHOA_IDEM).max(DO_DAI_TOI_DA_KHOA_IDEM).regex(MAU_KHOA_IDEM),
  soDienThoai: z.string().min(1).max(32),
  email: z.string().trim().max(254).optional().nullable(),
  dongY: z.object({
    xuLyHoSo: z.literal(true),
    tiepThi: z.boolean(),
    /**
     * Hash SHA-256 (hex) của văn bản đồng ý mà giao diện ĐÃ hiển thị — do CLIENT khai. Hiện chưa có văn
     * bản pháp chế duyệt do server giữ (L-4) nên đây là lời khai, không phải bằng chứng đồng ý.
     */
    vanBanHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }),
  phuHuynh: z.unknown(),
  hocSinh: z.unknown(),
  /** Địa chỉ nơi ở (05/11/2026) — TUỲ CHỌN ở máy chủ (bản JS cũ trong tab trình duyệt không gửi), xác thực ở `kiemTraDiaChi`. */
  diaChi: z.unknown().optional(),
  /** ĐƯỜNG THẬT. */
  bai: z.object({ phuHuynh: baiNguoiSchema, hocSinh: baiNguoiSchema }).optional(),
  /** ĐƯỜNG THỬ NGHIỆM (dữ liệu GIẢ): bị BỎ QUA trừ khi `choPhepTinDiemClient()`. */
  ketQua: z
    .object({
      engineVersion: z.string().min(1).max(40),
      phuHuynh: ketQuaNguoiSchema,
      hocSinh: ketQuaNguoiSchema,
    })
    .optional(),
  chienDich: z.string().max(40).optional(),
});
export type LuuInput = z.infer<typeof luuSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Cổng lưu trữ
// ─────────────────────────────────────────────────────────────────────────────

export type TrangThaiNhan = "PENDING_CLAIM" | "CLAIMED" | "EXPIRED" | "REVOKED";

export type BanGhi = {
  id: string;
  phoneKey: string;
  emailStatus: TrangThaiEmail;
  emailTo: string | null;
  claimStatus: TrangThaiNhan;
  /** Đủ để dịch vụ quyết định replay có hợp lệ không (F-01/F-02). */
  payloadHash: string | null;
  deletedAt: Date | null;
  retainUntil: Date;
};

export type DiscStore = {
  /**
   * Ghi MỘT lần theo khoá; gặp khoá đã có (kể cả đua) ⇒ trả dòng cũ (đủ trường để quyết replay),
   * `taoMoi:false`. KHÔNG nhận câu trả lời thô — chỉ điểm đã chấm.
   */
  taoHoacLayTheoKhoa: (d: {
    idempotencyKey: string;
    /** HMAC (phone-key.ts), KHÔNG phải SĐT. */
    phoneKey: string;
    /** HMAC (miền `disc-ip-v1`) của IP người gõ — KHÔNG phải IP thô. Chỉ để đếm trần theo cặp (N6). */
    ipKey: string;
    /** Phiên bản khoá băm đã dùng (`phienBanPepper`) — để xoay khoá biết dòng nào băm bằng khoá nào (N9). */
    pepperVersion: string;
    payloadHash: string;
    emailTo: string | null;
    emailStatus: TrangThaiEmail;
    tiepThi: boolean;
    consentVersion: string;
    /** Từ `now` tiêm vào — store không đọc đồng hồ. */
    consentAt: Date;
    consentMarketingAt: Date | null;
    /** BO | ME | NGUOI_GIAM_HO — vai của người gõ/đồng ý. */
    consentSubjectRole: string;
    consentTextHash: string | null;
    engineVersion: string;
    campaign: string;
    tokenHash: string;
    tokenHetHan: Date;
    /** HMAC của mã nhận (plaintext KHÔNG vào store). */
    claimCodeHash: string;
    retainUntil: Date;
    nguoi: Array<{
      role: "PARENT" | "STUDENT";
      hoTen: string;
      namSinh: number;
      bacHoc: string | null;
      nguoiLonQuanSat: boolean;
      phienBanBoDe: string;
      ketQua: unknown;
    }>;
  }) => Promise<{ ban: BanGhi; taoMoi: boolean }>;
  /**
   * Xoay token tải + mã nhận cho lượt phát lại, MỘT phép ghi nguyên tử CÓ ĐIỀU KIỆN
   * (PENDING_CLAIM ∧ chưa xoá ∧ `retainUntil > now`). Trả `false` nếu không dòng nào đổi.
   * KHÔNG đặt lại `claimAttempts` (phát lại không được dùng để mở khoá).
   */
  xoayTokenTai: (id: string, tokenHash: string, hetHan: Date, claimCodeHash: string, now: Date) => Promise<boolean>;
  /**
   * Số bài có `consentAt >= tu`, MỌI trạng thái (kể cả đã xoá/hết hạn), TRỪ dòng mang `boQuaKhoa` — để lượt phát lại của
   * chính bài đã tạo không bị tính là "thêm một bài". Trả HAI số (N6): `theoCap` = bài của đúng cặp (phoneKey, ipKey);
   * `theoPhone` = bài của phoneKey ở MỌI IP (dòng đời cũ không có ipKey vẫn được tính ở số này).
   */
  demTheoPhone: (phoneKey: string, ipKey: string, tu: Date, boQuaKhoa: string) => Promise<{ theoCap: number; theoPhone: number }>;
};

/**
 * `soDienThoai` = SĐT CHUẨN HOÁ (84…) chỉ để tạo/ghép lead, đi trong bộ nhớ — không bao giờ vào bảng Disc*.
 * (Trước 02/11 trường này tên `phoneKey`; đổi tên để mọi nơi còn đọc `d.phoneKey` hỏng lúc biên dịch
 * thay vì âm thầm ghi HMAC vào Lead.phone.)
 */
export type CongCrm = (d: {
  submissionId: string;
  soDienThoai: string;
  tenPhuHuynh: string;
  email: string | null;
  /** Ô tích của NGƯỜI GÕ; adapter CRM cố ý không dùng nó (chủ số chưa xác thực — F-09). Không có tên con/điểm/năm sinh trong hợp đồng (F-13). */
  tiepThi: boolean;
  chienDich: string;
  /** Địa chỉ nơi ở của PHỤ HUYNH (phường/xã đã kiểm với danh mục) — để chia lead về cơ sở gần nhà. null = không khai. Không phải dữ liệu của con. */
  diaChi: DiaChiKhai | null;
}) => Promise<{ leadId: string | null }>;

/**
 * Kết quả xếp thư xác minh email. Cùng hình với `KetQuaGuiLink` (email.ts) cộng `THIEU_GOC` (không có gốc URL ứng dụng hợp lệ ⇒
 * KHÔNG đoán domain, KHÔNG gửi). Bản thật dựng ở route; `luu.ts` chỉ dịch kết quả thành lời thông báo trung thực.
 */
export type KetQuaGuiEmail = { ok: true } | { ok: false; loi: "KHONG_CAN" | "DA_GUI" | "QUA_HAN_MUC" | "XEP_HANG_THAT_BAI" | "THIEU_GOC" };

export type PhanHoiLuu =
  | {
      ok: true;
      submissionId: string;
      /** Plaintext, chỉ trả cho phiên vừa lưu. */
      tokenTai: string;
      /**
       * Mã nhận — hiện MỘT lần trên màn thành công/PDF; server chỉ giữ HASH. Sau 02/11 luôn là chuỗi
       * (phát lại chỉ hợp lệ khi bài còn chờ nhận); kiểu giữ `| null` để UI cũ không vỡ.
       */
      maNhan: string | null;
      thongBao: ThongBaoSauLuu;
    }
  | {
      ok: false;
      loi: "DU_LIEU_KHONG_HOP_LE" | "THIEU_HO_SO" | "LUU_THAT_BAI" | "ENGINE_CHUA_SAN_SANG" | "QUA_NHIEU_YEU_CAU";
      chiTiet?: Array<{ truong: string; thongBao: string }>;
    };

/** SHA-256 trần — chỉ cho TOKEN tải (192 bit ngẫu nhiên, không dò được). Mã nhận dùng `bamMaNhan`. */
export const bam = (s: string) => createHash("sha256").update(s).digest("hex");

export type LuuDeps = {
  store: DiscStore;
  crm: CongCrm;
  /**
   * BẮT BUỘC (không mặc định): thiếu nó là bài có email mà không ai gửi liên kết xác minh — còn lời thông báo thì vẫn hứa.
   * Chỉ được gọi khi bài CÓ email. Ném ⇒ coi là "chưa gửi được".
   */
  guiEmail: (submissionId: string, now: Date) => Promise<KetQuaGuiEmail>;
  now?: () => Date;
  sinhToken?: () => string;
  sinhMa?: () => string;
  /**
   * IP của người gọi (route lấy từ header qua `ipChoRateLimit`). BẮT BUỘC, không mặc định (luật 7): thiếu nó là mất trần theo
   * cặp (N6) mà không lỗi nào báo. Chỉ HMAC của nó đi vào DB. Không biết IP ⇒ truyền chuỗi cố định (ví dụ "unknown") — khi đó
   * mọi người gọi như vậy dùng chung MỘT thùng cặp, còn trần cứng theo SĐT vẫn chặn lạm dụng.
   */
  nguonIp: string;
  /** Khoá HMAC (mã nhận, phoneKey, payloadHash, ipKey). Mặc định: `layKhoaDisc` (DISC_PEPPER riêng, rơi về secret ký). */
  khoaBam?: () => string;
  /** Phiên bản của khoá trên (ghi vào dòng). Mặc định: `phienBanPepper()`. Test tiêm khi tiêm `khoaBam`. */
  phienBanPepper?: () => string;
  engine?: () => DiscEngine | null;
  choPhepTinDiemClient?: () => boolean;
};

type KetQuaNguoi = z.infer<typeof ketQuaNguoiSchema>;

const LOI_CHAM: Record<string, string> = {
  THIEU_CAU_TRA_LOI: "Còn thiếu câu trả lời",
  GIA_TRI_KHONG_HOP_LE: "Có câu trả lời không hợp lệ",
  BO_DE_KHONG_TON_TAI: "Bộ đề không tồn tại",
  // HL-1 của engine thật: chọn cùng một mức cho gần hết câu. Thông điệp riêng để người dùng biết phải làm gì (trước đây rơi về câu chung).
  TRA_LOI_PHANG: "Bài đang chọn gần như cùng một mức cho nhiều câu. Hãy đọc kỹ từng câu và chọn mức đúng nhất với thực tế — có câu đúng nhiều, có câu ít đúng.",
};

type KetQuaChamBai =
  | { ok: true; engineVersion: string; phuHuynh: KetQuaNguoi; hocSinh: KetQuaNguoi }
  | { ok: false; loi: "DU_LIEU_KHONG_HOP_LE" | "LUU_THAT_BAI" | "ENGINE_CHUA_SAN_SANG"; chiTiet?: Array<{ truong: string; thongBao: string }> };

/** Server tự chấm: chọn bộ đề từ hồ sơ (KHÔNG tin `maBoDe` của client) rồi `cham()`. */
function chamBaiTrenServer(
  engine: DiscEngine,
  bai: NonNullable<LuuInput["bai"]>,
  ph: { namSinh: number },
  hs: { namSinh: number; bacHoc: string },
  namNay: number,
): KetQuaChamBai {
  type MotNguoi =
    | { tag: "loi"; loi: Array<{ truong: string; thongBao: string }> }
    | { tag: "hong" }
    | { tag: "ok"; ketQua: KetQuaNguoi };
  const lam = (vai: "PH" | "HS", truong: string, b: { maBoDe: string; traLoi: TraLoiTho }, namSinh: number, bacHoc?: string): MotNguoi => {
    const bo = engine.chonBoDe({ vai, bacHoc, namSinh, namNay });
    if (!bo || bo.ma !== b.maBoDe) return { tag: "loi", loi: [{ truong: `${truong}.maBoDe`, thongBao: "Bộ đề không khớp hồ sơ" }] };
    const kq = engine.cham(bo.ma, b.traLoi);
    if (!kq.ok) return { tag: "loi", loi: [{ truong: `${truong}.traLoi`, thongBao: LOI_CHAM[kq.lyDo] ?? "Câu trả lời không hợp lệ" }] };
    const chuan = ketQuaNguoiSchema.safeParse(kq.ketQua);
    // Engine trả điểm ngoài khoảng ⇒ lỗi phía server, không phải lỗi của người dùng.
    if (!chuan.success) return { tag: "hong" };
    return { tag: "ok", ketQua: chuan.data };
  };
  const a = lam("PH", "bai.phuHuynh", bai.phuHuynh, ph.namSinh);
  const b = lam("HS", "bai.hocSinh", bai.hocSinh, hs.namSinh, hs.bacHoc);
  if (a.tag === "hong" || b.tag === "hong") return { ok: false, loi: "LUU_THAT_BAI" };
  const loi: Array<{ truong: string; thongBao: string }> = [];
  if (a.tag === "loi") loi.push(...a.loi);
  if (b.tag === "loi") loi.push(...b.loi);
  if (loi.length) return { ok: false, loi: "DU_LIEU_KHONG_HOP_LE", chiTiet: loi };
  if (a.tag !== "ok" || b.tag !== "ok") return { ok: false, loi: "LUU_THAT_BAI" };
  return { ok: true, engineVersion: engine.phienBan, phuHuynh: a.ketQua, hocSinh: b.ketQua };
}

/**
 * Phát lại có được phép xoay token không. TẤT CẢ điều kiện: cùng SĐT · còn chờ nhận · chưa xoá ·
 * chưa hết hạn · payload y hệt. Hàm thuần để test từng nhánh.
 */
export function replayHopLe(ban: BanGhi, phoneKey: string, payloadHash: string, now: Date): boolean {
  return (
    ban.phoneKey === phoneKey &&
    ban.claimStatus === "PENDING_CLAIM" &&
    ban.deletedAt === null &&
    ban.retainUntil.getTime() > now.getTime() &&
    ban.payloadHash !== null &&
    ban.payloadHash === payloadHash
  );
}

export async function luuKetQuaDisc(raw: unknown, deps: LuuDeps): Promise<PhanHoiLuu> {
  const now = (deps.now ?? (() => new Date()))();
  const p = luuSchema.safeParse(raw);
  if (!p.success) {
    return { ok: false, loi: "DU_LIEU_KHONG_HOP_LE", chiTiet: p.error.issues.map((i) => ({ truong: i.path.join("."), thongBao: i.message })) };
  }
  const d = p.data;

  const sdtChuan = canonicalPhone(d.soDienThoai);
  if (!sdtChuan) return { ok: false, loi: "DU_LIEU_KHONG_HOP_LE", chiTiet: [{ truong: "soDienThoai", thongBao: "Số điện thoại không hợp lệ" }] };

  const email = d.email && d.email.length ? d.email : null;
  if (email && !z.string().email().safeParse(email).success) {
    return { ok: false, loi: "DU_LIEU_KHONG_HOP_LE", chiTiet: [{ truong: "email", thongBao: "Email chưa đúng định dạng — vui lòng sửa hoặc để trống" }] };
  }

  const namNay = namHienTaiVN(now);
  const hoSo = kiemTraHoSo({ phuHuynh: d.phuHuynh, hocSinh: d.hocSinh }, namNay);
  if (!hoSo.ok) {
    return hoSo.thieu.length
      ? { ok: false, loi: "THIEU_HO_SO", chiTiet: hoSo.thieu.map((t) => ({ truong: t, thongBao: t === "PHU_HUYNH" ? "Còn thiếu hồ sơ phụ huynh" : "Còn thiếu hồ sơ học sinh" })) }
      : { ok: false, loi: "DU_LIEU_KHONG_HOP_LE", chiTiet: hoSo.loi };
  }
  const diaChi = kiemTraDiaChi(d.diaChi);
  if (!diaChi.ok) return { ok: false, loi: "DU_LIEU_KHONG_HOP_LE", chiTiet: diaChi.loi };
  // Dữ liệu ĐÃ parse + trim bởi `kiemTraHoSo` — không bao giờ dùng object thô của client (F-16).
  const ph = hoSo.phuHuynh;
  const hs = hoSo.hocSinh;

  // ── Xác định điểm: server chấm (đường thật) hoặc cổng thử nghiệm ────────────────
  let engineVersion: string;
  let kqPh: KetQuaNguoi;
  let kqHs: KetQuaNguoi;
  let nguonDiem: "SERVER" | "THU_NGHIEM";
  const engine = (deps.engine ?? layEngine)();
  if (engine) {
    if (!d.bai) return { ok: false, loi: "DU_LIEU_KHONG_HOP_LE", chiTiet: [{ truong: "bai", thongBao: "Thiếu câu trả lời" }] };
    // Có engine ⇒ `ketQua` (điểm client) bị BỎ QUA hoàn toàn, kể cả khi cổng thử nghiệm mở.
    const c = chamBaiTrenServer(engine, d.bai, ph, hs, namNay);
    if (!c.ok) return c.chiTiet ? { ok: false, loi: c.loi, chiTiet: c.chiTiet } : { ok: false, loi: c.loi };
    engineVersion = c.engineVersion;
    kqPh = c.phuHuynh;
    kqHs = c.hocSinh;
    nguonDiem = "SERVER";
  } else if (d.ketQua && (deps.choPhepTinDiemClient ?? (() => choPhepTinDiemClient()))()) {
    engineVersion = d.ketQua.engineVersion;
    kqPh = d.ketQua.phuHuynh;
    kqHs = d.ketQua.hocSinh;
    nguonDiem = "THU_NGHIEM";
  } else {
    // Chưa có engine ⇒ đường lưu dữ liệu THẬT bị khoá; KHÔNG nhận điểm client.
    return { ok: false, loi: "ENGINE_CHUA_SAN_SANG" };
  }

  const tokenTho = (deps.sinhToken ?? (() => randomBytes(24).toString("base64url")))();
  const maNhan = (deps.sinhMa ?? (() => sinhMaNhan()))();
  const khoa = (deps.khoaBam ?? layKhoaDisc)();
  const pepperVersion = (deps.phienBanPepper ?? (() => phienBanPepper()))();
  const phoneKey = phoneKeyTuSdtChuan(sdtChuan, khoa);
  const ipKey = ipKeyTuIp(deps.nguonIp, khoa);
  const trangThaiEmail: TrangThaiEmail = email ? "VERIFICATION_REQUIRED" : "NONE";
  const hetHanToken = new Date(now.getTime() + HAN_TOKEN_TAI_PHUT * 60_000);
  const chienDich = chienDichHopLe(d.chienDich);

  // Mọi trường CÓ NGHĨA của lượt lưu. Câu trả lời thô nằm trong hash (để phát hiện "khác nội dung") chứ
  // không bao giờ trong thứ lưu. Không gồm: idempotencyKey, thời điểm, token/mã.
  const payloadHash = bamPayload(
    {
      phoneKey,
      email,
      tiepThi: d.dongY.tiepThi,
      vanBanHash: d.dongY.vanBanHash ?? null,
      chienDich,
      ph,
      hs,
      nguonDiem,
      bai: nguonDiem === "SERVER" ? d.bai : null,
      diem: nguonDiem === "THU_NGHIEM" ? { kqPh, kqHs, engineVersion } : null,
    },
    khoa,
  );

  // Trần bài mới — lưới DB thứ hai (F-03/N6). Lỗi đếm ⇒ từ chối (fail-closed), không lưu mù.
  try {
    const tu = new Date(now.getTime() - CUA_SO_DEM_BAI_THEO_SDT_MS);
    const daCo = await deps.store.demTheoPhone(phoneKey, ipKey, tu, d.idempotencyKey);
    // Trần cứng TRƯỚC: trả LUU_THAT_BAI (Y HỆT lỗi chung) để không thành oracle "SĐT này đã bị dùng nhiều" từ IP sạch.
    if (daCo.theoPhone >= TOI_DA_BAI_MOI_THEO_SDT_TRAN_CUNG) return { ok: false, loi: "LUU_THAT_BAI" };
    if (daCo.theoCap >= TOI_DA_BAI_MOI_THEO_CAP) return { ok: false, loi: "QUA_NHIEU_YEU_CAU" };
  } catch {
    return { ok: false, loi: "LUU_THAT_BAI" };
  }

  let ket;
  try {
    ket = await deps.store.taoHoacLayTheoKhoa({
      idempotencyKey: d.idempotencyKey,
      phoneKey,
      ipKey,
      pepperVersion,
      payloadHash,
      emailTo: email,
      emailStatus: trangThaiEmail,
      tiepThi: d.dongY.tiepThi,
      consentVersion: PHIEN_BAN_DONG_Y,
      consentAt: now,
      consentMarketingAt: d.dongY.tiepThi ? now : null,
      consentSubjectRole: ph.vaiTro,
      consentTextHash: d.dongY.vanBanHash ?? null,
      engineVersion,
      campaign: chienDich,
      tokenHash: bam(tokenTho),
      tokenHetHan: hetHanToken,
      claimCodeHash: bamMaNhan(maNhan, khoa),
      retainUntil: new Date(now.getTime() + NGAY_GIU_BAI_CHUA_NHAN * 86_400_000),
      nguoi: [
        { role: "PARENT", hoTen: ph.hoTen, namSinh: ph.namSinh, bacHoc: null, nguoiLonQuanSat: false, phienBanBoDe: kqPh.phienBanBoDe, ketQua: kqPh },
        { role: "STUDENT", hoTen: hs.hoTen, namSinh: hs.namSinh, bacHoc: hs.bacHoc, nguoiLonQuanSat: hoSo.nguoiLonQuanSatHocSinh, phienBanBoDe: kqHs.phienBanBoDe, ketQua: kqHs },
      ],
    });
  } catch {
    // Không lộ lý do ra ngoài, không log nội dung (dữ liệu trẻ). Giao diện giữ bài ở máy và cho thử lại.
    return { ok: false, loi: "LUU_THAT_BAI" };
  }

  if (!ket.taoMoi) {
    // Phát lại cùng khoá: KHÔNG tạo lead lần nữa. Chỉ hợp lệ khi `replayHopLe`; mọi trường hợp
    // khác (SĐT khác, đã nhận/thu hồi/hết hạn/xoá, nội dung khác) ⇒ MỘT câu từ chối chung, KHÔNG xoay token.
    if (!replayHopLe(ket.ban, phoneKey, payloadHash, now)) return { ok: false, loi: "LUU_THAT_BAI" };
    let xoay: boolean;
    try {
      xoay = await deps.store.xoayTokenTai(ket.ban.id, bam(tokenTho), hetHanToken, bamMaNhan(maNhan, khoa), now);
    } catch {
      return { ok: false, loi: "LUU_THAT_BAI" };
    }
    if (!xoay) return { ok: false, loi: "LUU_THAT_BAI" };
    // Email: `guiLinkXacMinh` tự chống gửi trùng (token còn hạn ⇒ DA_GUI, không thêm thư). Lời thông báo theo kết quả THẬT.
    let thongBaoReplay: ThongBaoSauLuu;
    if (!email) {
      thongBaoReplay = thongBaoSauLuu({ email, trangThaiEmail });
    } else {
      const kq = await xepLinkXacMinh(deps, ket.ban.id, now);
      thongBaoReplay =
        kq === "KHONG_CAN"
          ? // Trạng thái email đã đổi sau lần lưu đầu (đã xác minh/đã xếp báo cáo): nói theo trạng thái ĐANG LƯU, không theo trạng thái lúc tạo.
            thongBaoSauLuu({ email, trangThaiEmail: ket.ban.emailStatus, linkXacMinh: "CHUA_GUI_DUOC" })
          : thongBaoSauLuu({ email, trangThaiEmail, linkXacMinh: kq });
    }
    return { ok: true, submissionId: ket.ban.id, tokenTai: tokenTho, maNhan, thongBao: thongBaoReplay };
  }

  // CRM: tốt nhất có thể, NGOÀI đường nóng — lỗi CRM không làm hỏng việc lưu (dữ liệu đã an toàn).
  // Adapter CRM tự ghi `leadId` vào bài (`datLeadChoBai`, crm.ts) — luu.ts KHÔNG ghi lần hai.
  try {
    await deps.crm({
      submissionId: ket.ban.id,
      soDienThoai: sdtChuan,
      tenPhuHuynh: ph.hoTen,
      email,
      tiepThi: d.dongY.tiepThi,
      chienDich,
      diaChi: diaChi.diaChi,
    });
  } catch {
    /* ghi nhận ở lớp gọi (không kèm dữ liệu cá nhân) */
  }

  // Email: chỉ khi bài CÓ email. Lời thông báo phản ánh kết quả xếp thư THẬT — không hứa điều chưa làm.
  let linkXacMinh: KetQuaLinkXacMinh | undefined;
  if (email) {
    const kq = await xepLinkXacMinh(deps, ket.ban.id, now);
    linkXacMinh = kq === "DA_XEP_HANG" ? "DA_XEP_HANG" : "CHUA_GUI_DUOC"; // KHONG_CAN ngay sau khi vừa tạo là bất thường ⇒ không hứa gì
  }
  const thongBao = thongBaoSauLuu({ email, trangThaiEmail, linkXacMinh });

  return { ok: true, submissionId: ket.ban.id, tokenTai: tokenTho, maNhan, thongBao };
}

/** Dịch kết quả `guiEmail` thành ba nhánh; ném/lỗi lạ ⇒ CHUA_GUI_DUOC (fail-closed về LỜI NÓI, không về dữ liệu). */
async function xepLinkXacMinh(deps: LuuDeps, submissionId: string, now: Date): Promise<KetQuaLinkXacMinh | "KHONG_CAN"> {
  try {
    const r = await deps.guiEmail(submissionId, now);
    if (r.ok || r.loi === "DA_GUI") return "DA_XEP_HANG";
    if (r.loi === "KHONG_CAN") return "KHONG_CAN";
    return "CHUA_GUI_DUOC";
  } catch {
    return "CHUA_GUI_DUOC";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mã nhận — CHỈ còn đường XOÁ
// ─────────────────────────────────────────────────────────────────────────────
// Nhận bài đã chuyển sang `nhan.ts` + `nhan-prisma.ts` (OTP + mã nhận + thách đố năm sinh của con — F-06). Đường nhận cũ
// `nhanBaiBangMa` + nhánh NHAN của `maNhanStore` (ngưỡng 5, KHÔNG thách đố) ĐÃ GỠ: không còn cách nào nhận bài chỉ bằng mã.

/** Hành động gắn với việc "dùng mã nhận" — hiện chỉ XOÁ. Thêm NHAN trở lại = mở đường nhận bỏ qua thách đố năm sinh. */
export type HanhDongMa = { loai: "XOA" };

export type MaNhanStore = {
  /**
   * MỘT thao tác nguyên tử. Mọi điều kiện nằm TRONG phép ghi (store Prisma làm trong một transaction):
   *  1. tăng `claimAttempts` cho các dòng PENDING_CLAIM của `phoneKey` còn dưới `toiDaLanThu`
   *     (không dòng nào tăng được ⇒ đã khoá ⇒ null — KHÔNG phân biệt với "sai mã");
   *  2. chỉ khi bước 1 tăng được: tìm dòng có `claimCodeHash` = maHash ∧ phoneKey khớp ∧ PENDING_CLAIM
   *     ∧ chưa xoá ∧ chưa hết hạn; áp `hanhDong` (xoá nội dung nhạy cảm).
   * Gửi song song N lượt đoán cũng chỉ được tối đa `toiDaLanThu` lượt chạm tới bước 2.
   * `phoneKey` ở đây là HMAC (phone-key.ts), không phải SĐT.
   */
  thuBangMa: (p: { phoneKey: string; maHash: string; now: Date; toiDaLanThu: number; hanhDong: HanhDongMa }) => Promise<{ submissionId: string } | null>;
};
