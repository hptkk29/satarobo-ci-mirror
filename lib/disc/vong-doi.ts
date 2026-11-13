/**
 * Vòng đời dữ liệu DISC — hết hạn (retention) và xoá theo yêu cầu. THUẦN theo cổng store (tiêm vào).
 *
 * Luật:
 *  - Bài CHƯA nhận (PENDING_CLAIM) quá `retainUntil` ⇒ EXPIRED + XOÁ nội dung nhạy cảm (tên/năm sinh
 *    của trẻ, điểm, email, mã băm). Dòng "bia mộ" giữ lại id/phoneKey/mốc thời gian để đối soát — không
 *    còn thông tin về trẻ.
 *  - Bài đã CLAIMED thuộc về tài khoản chủ; hết hạn ở đây KHÔNG áp (xoá của chủ đi qua cổng portal).
 *  - Xoá theo yêu cầu (người giữ SĐT đã qua OTP + mã nhận): cùng bộ đếm thử sai với việc nhận bài.
 *
 * `chayHetHan` là hàm; cron gọi nó ở `app/api/cron/disc-het-han` (không phụ thuộc cờ DISC_ENABLED —
 * tắt tính năng KHÔNG được làm dừng việc xoá dữ liệu trẻ đã hết hạn).
 */
import { canonicalPhone } from "@/lib/phone";
import { TOI_DA_LAN_THU_MA } from "./chinh-sach";
import { bamMaNhan, chuanHoaMaNhan, type MaNhanStore } from "./luu";
import { layKhoaDisc, phoneKeyTuSdtChuan } from "./phone-key";

/** Dữ liệu ghi đè khi xoá nội dung nhạy cảm — MỘT nguồn cho hết hạn, từ chối, xoá theo yêu cầu. */
export const NOI_DUNG_BI_XOA = {
  // `reportSnapshot` không còn là nơi lưu kết quả (một nguồn: DiscSubject.result, bị xoá cùng lúc ở mọi
  // đường xoá). Cột còn lại chỉ để tương thích: luôn ghi {} và dọn {} ở đây cho cả dòng đời cũ.
  reportSnapshot: {},
  payloadHash: null,
  emailTo: null,
  emailVerifyTokenHash: null,
  downloadTokenHash: null,
  downloadTokenExpires: null,
  claimCodeHash: null,
} as const;

export function daHetHanChuaNhan(b: { claimStatus: string; retainUntil: Date; deletedAt: Date | null }, now: Date): boolean {
  return b.claimStatus === "PENDING_CLAIM" && b.deletedAt === null && b.retainUntil.getTime() <= now.getTime();
}

export type VongDoiStore = {
  /** Id các bài PENDING_CLAIM, chưa xoá, `retainUntil <= now`. Tối đa `gioiHan`. */
  timHetHan: (now: Date, gioiHan: number) => Promise<string[]>;
  /** Một transaction: xoá DiscSubject + EXPIRED + `deletedAt` + `NOI_DUNG_BI_XOA`. Trả số dòng đổi. */
  danhDauHetHan: (ids: string[], now: Date) => Promise<number>;
};

export const GIOI_HAN_MOI_LO = 200;
export const TOI_DA_SO_LO = 25;

/** Chạy theo lô cho tới khi hết việc hoặc chạm trần số lô (chặn vòng lặp vô hạn khi store lỗi). */
export async function chayHetHan(p: { store: VongDoiStore; now: Date; gioiHanMoiLo?: number; toiDaSoLo?: number }): Promise<{ daXuLy: number; soLo: number }> {
  const gioiHan = p.gioiHanMoiLo ?? GIOI_HAN_MOI_LO;
  const toiDa = p.toiDaSoLo ?? TOI_DA_SO_LO;
  let daXuLy = 0;
  let soLo = 0;
  while (soLo < toiDa) {
    const ids = await p.store.timHetHan(p.now, gioiHan);
    if (!ids.length) break;
    soLo++;
    const n = await p.store.danhDauHetHan(ids, p.now);
    daXuLy += n;
    if (n === 0) break; // không tiến triển ⇒ dừng, đừng quay mãi cùng một lô
  }
  return { daXuLy, soLo };
}

export type KetQuaXoa = { ok: true; submissionId: string } | { ok: false; loi: "KHONG_CO_PHIEN_XAC_MINH" | "MA_KHONG_KHOP" };

/**
 * Xoá bài chưa nhận theo yêu cầu. `phoneKeyDaXacMinh` do tầng OTP trả về. Cần cả mã nhận (cùng lý do
 * như nhận bài: chỉ giữ SĐT chưa đủ chứng minh là người tạo bài). Người gõ nhầm số nhận được thư/ZNS
 * không có mã ⇒ họ yêu cầu xoá qua kênh hỗ trợ, không qua đường này.
 */
export async function xoaBangMa(p: {
  /** SĐT CHUẨN HOÁ do tầng OTP trả về; hàm tự đổi sang `phoneKey` HMAC. */
  sdtDaXacMinh: string | null;
  maNhan: unknown;
  store: MaNhanStore;
  now: Date;
  khoaBam?: () => string;
}): Promise<KetQuaXoa> {
  const sdt = p.sdtDaXacMinh ? canonicalPhone(p.sdtDaXacMinh) : null;
  if (!sdt) return { ok: false, loi: "KHONG_CO_PHIEN_XAC_MINH" };
  const ma = chuanHoaMaNhan(p.maNhan);
  if (!ma) return { ok: false, loi: "MA_KHONG_KHOP" };
  const khoa = (p.khoaBam ?? layKhoaDisc)();
  const r = await p.store.thuBangMa({
    phoneKey: phoneKeyTuSdtChuan(sdt, khoa),
    maHash: bamMaNhan(ma, khoa),
    now: p.now,
    toiDaLanThu: TOI_DA_LAN_THU_MA,
    hanhDong: { loai: "XOA" },
  });
  return r ? { ok: true, submissionId: r.submissionId } : { ok: false, loi: "MA_KHONG_KHOP" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bài ĐÃ NHẬN (CLAIMED) — chủ tự xoá, tự tải, và hạn lưu CẤU HÌNH (S-01)
// ─────────────────────────────────────────────────────────────────────────────

/** Chuỗi người dùng phải gõ/gửi ở bước xác nhận thứ hai. Server từ chối nếu thiếu — nút "một chạm" không tồn tại. */
export const CHUOI_XAC_NHAN_XOA = "XOA";

/**
 * Hạn lưu bài CLAIMED (ngày) từ env `DISC_HAN_LUU_CLAIMED_NGAY`.
 * ⚠️ Con số này là QUYẾT ĐỊNH PHÁP LÝ (06-security-privacy) — mã KHÔNG tự đặt: không khai ⇒ `null` = KHÔNG hết hạn.
 * Giá trị không phải số nguyên dương ⇒ cũng `null` (fail-an-toàn theo hướng không xoá nhầm dữ liệu của chủ).
 */
export function hanLuuClaimedNgay(env: Record<string, string | undefined> = process.env): number | null {
  const raw = env.DISC_HAN_LUU_CLAIMED_NGAY?.trim();
  if (!raw || !/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

export type VongDoiClaimedStore = {
  /** Id bài CLAIMED, chưa xoá, mốc nhận (`claimedAt` ?? `createdAt`) <= `truocMoc`. Tối đa `gioiHan`. */
  timHetHanClaimed: (truocMoc: Date, gioiHan: number) => Promise<string[]>;
  /** Một transaction: xoá nội dung như xoá của chủ nhưng trạng thái EXPIRED. Điều kiện lặp lại trong phép ghi. */
  danhDauHetHanClaimed: (ids: string[], truocMoc: Date, now: Date) => Promise<number>;
};

/** Cron: chỉ làm việc khi hạn được cấu hình. Chưa cấu hình ⇒ `{ batHan: false }`, KHÔNG đụng dữ liệu. */
export async function chayHetHanClaimed(p: {
  store: VongDoiClaimedStore;
  now: Date;
  hanNgay: number | null;
  gioiHanMoiLo?: number;
  toiDaSoLo?: number;
}): Promise<{ batHan: boolean; daXuLy: number; soLo: number }> {
  if (p.hanNgay === null) return { batHan: false, daXuLy: 0, soLo: 0 };
  const truocMoc = new Date(p.now.getTime() - p.hanNgay * 86_400_000);
  const gioiHan = p.gioiHanMoiLo ?? GIOI_HAN_MOI_LO;
  const toiDa = p.toiDaSoLo ?? TOI_DA_SO_LO;
  let daXuLy = 0;
  let soLo = 0;
  while (soLo < toiDa) {
    const ids = await p.store.timHetHanClaimed(truocMoc, gioiHan);
    if (!ids.length) break;
    soLo++;
    const n = await p.store.danhDauHetHanClaimed(ids, truocMoc, p.now);
    daXuLy += n;
    if (n === 0) break;
  }
  return { batHan: true, daXuLy, soLo };
}

export type XoaCuaChuStore = {
  /**
   * Xoá bài CLAIMED của `userId` (một bài nếu có `id`, ngược lại tất cả) trong MỘT transaction: DiscSubject, nội dung
   * nhạy cảm, hàng đợi/nhật ký email của bài, gỡ liên kết lead, đánh dấu REVOKED + `consentWithdrawnAt`, ghi audit.
   * Trả số bài đã xoá (0 = không có gì thuộc user này ⇒ cũng là kết quả của id lạ/của người khác/đã xoá).
   */
  xoaBaiCuaChu: (p: { userId: string; id: string | null; now: Date }) => Promise<number>;
};

export type KetQuaXoaCuaChu = { ok: true; soBai: number } | { ok: false; loi: "CHUA_XAC_NHAN" | "ID_KHONG_HOP_LE" | "KHONG_CO_GI_DE_XOA" };

/**
 * Xoá kết quả của CHÍNH người đăng nhập. `userId` do tầng gọi lấy từ PHIÊN. Bước xác nhận thứ hai là
 * `xacNhan === "XOA"` kiểm Ở SERVER. Idempotent: lần hai không còn bài ⇒ `KHONG_CO_GI_DE_XOA` (không lỗi, không ghi gì).
 */
export async function xoaKetQuaCuaToi(p: { userId: string; id?: unknown; xacNhan: unknown; store: XoaCuaChuStore; now: Date }): Promise<KetQuaXoaCuaChu> {
  if (p.xacNhan !== CHUOI_XAC_NHAN_XOA) return { ok: false, loi: "CHUA_XAC_NHAN" };
  let id: string | null = null;
  if (p.id !== undefined && p.id !== null) {
    if (typeof p.id !== "string" || p.id.length < 1 || p.id.length > 64) return { ok: false, loi: "ID_KHONG_HOP_LE" };
    id = p.id;
  }
  const soBai = await p.store.xoaBaiCuaChu({ userId: p.userId, id, now: p.now });
  return soBai > 0 ? { ok: true, soBai } : { ok: false, loi: "KHONG_CO_GI_DE_XOA" };
}
