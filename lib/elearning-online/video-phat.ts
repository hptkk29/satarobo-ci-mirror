import type { PrismaClient } from "@prisma/client";
import { isOnlineVideoBucketConfigured } from "@/lib/storage/online-video-storage";
import { timBaiHocThuCongKhai } from "./danh-muc-cong-khai";
import { kiemTraTruyCapChoPhuHuynh } from "./hoc-tap";
import { httpTheoMaLoi } from "./hoc-vien-dto";
import { kiemKhoaVideo } from "./khoa-video";
import type { MaTruyCapDb } from "./quyen-hoc-db";
import { docVe, kyVe, TTL_VE_GIAY, TTL_VE_TOI_DA } from "./ve-media";

/**
 * E-LEARNING ONLINE — PHÁT VIDEO TRẢ PHÍ / HỌC THỬ: cấp VÉ PHÁT và kiểm VÉ PHÁT (V8.44). Lớp DB; HTTP + R2 ở `video-phat-http.ts`.
 *
 * Dùng LẠI, không dựng cơ chế thứ hai: chữ ký/đọc vé = `ve-media.ts` (`kyVe`/`docVe`, cùng khoá ký, cùng HMAC); cổng quyền = `kiemTraTruyCapChoPhuHuynh`
 * (sở hữu phụ huynh + quyền + hạn + thu hồi + bài ẩn + thứ tự mở + không xem lại); luật "học thử" = `timBaiHocThuCongKhai` (cùng vị từ với JSON học thử).
 *
 * Bất biến (mỗi cái có ca `[VP-*]` ở `tests/elearning/onl-video-phat-db.test.ts`):
 * 1. Vé KHÔNG chứa khoá media/đường dẫn R2: khoá được tra từ DB (bản ĐANG CHẠY) ở MỖI lượt phát. URL phát chỉ mang vé.
 * 2. Vé gắn: người xem (`p` phụ huynh + `s` học viên) · khoá `c` · bài `l` · PHIÊN BẢN đang chạy lúc cấp `b` · quyền `e` · loại `m`. Đổi một trường ⇒ chữ ký sai.
 * 3. Vé ngắn (mặc định 120 s, trần 300 s — cùng hằng số `ve-media.ts`). Phát video bằng Range nên MỘT vé dùng được nhiều lượt trong hạn; vé hết hạn ⇒ app xin vé mới.
 * 4. MỖI lượt phát hỏi LẠI cổng (`kiemVePhat`): thu hồi / hết hạn quyền / đổi phiên bản / bỏ đánh dấu học thử SAU khi cấp vé ⇒ cắt ngay, không chờ vé hết hạn.
 *    Ngoại lệ DUY NHẤT: `DA_HOAN_THANH_KHONG_XEM_LAI` KHÔNG cắt vé đã cấp. Lý do: chính lúc phát, app báo % xem; chạm ngưỡng ⇒ bài COMPLETED ⇒ nếu cổng "không cho
 *    xem lại" cắt luôn thì người học bị đứng hình ở đoạn cuối và không tua lại được. "Không xem lại" chặn MỞ LẠI bài — chặn ở lúc CẤP vé (cổng đầy đủ, không ngoại lệ).
 * 5. Vé công khai (`CK`) chỉ cấp cho bài học thử; không có học viên/quyền. Vé đời cũ của `capVeMedia` (không có `m`) KHÔNG phát được.
 * 6. Khoá media phải qua `kiemKhoaVideo` = BỌC hàm của Core E `laKhoaVideoOnlineHopLe` (vùng `online/video/`, `video-khoa.ts` — chuẩn DUY NHẤT, không có vùng thứ hai)
 *    — sai ⇒ `KHOA_VIDEO_KHONG_HOP_LE`, không bao giờ thử đọc R2.
 */

type Db = PrismaClient;

/** TTL vé phát: dùng đúng hằng số của vé media (120 s / trần 300 s) — đổi MỘT chỗ ở `ve-media.ts`. */
export const TTL_PHAT_GIAY = TTL_VE_GIAY;
export const TTL_PHAT_TOI_DA = TTL_VE_TOI_DA;
/** Gợi ý cho app: xin vé mới khi còn lại ≤ phần này của TTL (app còn thời gian đổi URL + tua lại vị trí cũ). */
export const TI_LE_LAM_MOI = 0.2;

export type MaLoiPhat =
  | MaTruyCapDb
  | "SAI_PHU_HUYNH"
  | "BAI_KHONG_PHAI_VIDEO"
  | "CHUA_CO_VIDEO"
  | "KHOA_VIDEO_KHONG_HOP_LE"
  | "KHO_VIDEO_CHUA_CAU_HINH"
  | "KHONG_TIM_THAY"
  | "VE_SAI_DINH_DANG"
  | "VE_SAI_CHU_KY"
  | "VE_HET_HAN"
  | "VE_KHONG_KHOP_QUYEN"
  | "VE_PHIEN_BAN_CU";

const HTTP_RIENG: Readonly<Record<string, number>> = {
  KHOA_VIDEO_KHONG_HOP_LE: 409, // dữ liệu bài hỏng (khoá media sai chính sách) — lỗi của nội dung, không phải của người xem
  KHO_VIDEO_CHUA_CAU_HINH: 503,
  KHONG_TIM_THAY: 404,
  VE_PHIEN_BAN_CU: 401, // khoá vừa phát hành bản mới: xin vé mới
};
/** Mã lỗi phát → HTTP. Mã của lõi E dùng bảng của E (`httpTheoMaLoi`); mã lạ ⇒ 500 (không đoán 4xx). */
export function httpPhat(ma: string): number {
  return Object.prototype.hasOwnProperty.call(HTTP_RIENG, ma) ? HTTP_RIENG[ma]! : httpTheoMaLoi(ma);
}

export type LoaiPhat = "TRA_PHI" | "HOC_THU";
export type KetQuaCapPhat =
  | { ok: true; ve: string; hetHanLuc: Date; ttlGiay: number; loai: LoaiPhat; loaiTep: string }
  | { ok: false; ma: MaLoiPhat };

const mediaRefCua = (contentJson: unknown): unknown => (contentJson as { mediaRef?: unknown } | null)?.mediaRef;
const kepTtl = (ttlGiay: number | undefined) => Math.min(Math.max(Math.floor(ttlGiay ?? TTL_PHAT_GIAY), 10), TTL_PHAT_TOI_DA);

/** Chọn khoá media của một bài VIDEO theo chính sách. Dùng chung cho cấp vé (kiểm sớm) và kiểm vé (khoá thật dùng để đọc R2). */
function khoaCuaBai(bai: { kind: string; contentJson: unknown } | null): { ok: true; khoa: string; contentType: string } | { ok: false; ma: "BAI_KHONG_TON_TAI" | "BAI_KHONG_PHAI_VIDEO" | "CHUA_CO_VIDEO" | "KHOA_VIDEO_KHONG_HOP_LE" } {
  if (!bai) return { ok: false, ma: "BAI_KHONG_TON_TAI" };
  if (bai.kind !== "VIDEO") return { ok: false, ma: "BAI_KHONG_PHAI_VIDEO" };
  const ref = mediaRefCua(bai.contentJson);
  if (typeof ref !== "string" || ref.length === 0) return { ok: false, ma: "CHUA_CO_VIDEO" };
  const k = kiemKhoaVideo(ref);
  return k.ok ? k : { ok: false, ma: "KHOA_VIDEO_KHONG_HOP_LE" };
}

/** CẤP VÉ PHÁT cho học viên có quyền (phụ huynh sở hữu). Qua CỔNG ĐẦY ĐỦ của E — không ngoại lệ. */
export async function capVePhatHocVien(db: Db, input: { parentUserId: string; studentId: string; courseId: string; lessonStableId: string; now: Date; ttlGiay?: number }): Promise<KetQuaCapPhat> {
  const cong = await kiemTraTruyCapChoPhuHuynh(db, input);
  if (!cong.ok) return { ok: false, ma: cong.ma };
  const khoa = await db.onlCourse.findUnique({ where: { id: input.courseId }, select: { publishedVersionId: true } });
  if (!khoa?.publishedVersionId) return { ok: false, ma: "KHOA_CHUA_PHAT_HANH" };
  const bai = await db.onlLesson.findUnique({ where: { versionId_stableId: { versionId: khoa.publishedVersionId, stableId: input.lessonStableId } }, select: { kind: true, contentJson: true } });
  const k = khoaCuaBai(bai);
  if (!k.ok) return { ok: false, ma: k.ma };
  if (!isOnlineVideoBucketConfigured()) return { ok: false, ma: "KHO_VIDEO_CHUA_CAU_HINH" };
  const q = await db.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } }, select: { id: true } });
  if (!q) return { ok: false, ma: "KHONG_CO_QUYEN" };
  const ttl = kepTtl(input.ttlGiay);
  const x = Math.floor(input.now.getTime() / 1000) + ttl;
  return {
    ok: true,
    ve: kyVe({ e: q.id, s: input.studentId, c: input.courseId, l: input.lessonStableId, x, p: input.parentUserId, b: khoa.publishedVersionId, m: "HV" }),
    hetHanLuc: new Date(x * 1000),
    ttlGiay: ttl,
    loai: "TRA_PHI",
    loaiTep: k.contentType,
  };
}

/** CẤP VÉ PHÁT CÔNG KHAI cho bài học thử (không cần đăng nhập). Bài trả phí / ẩn / khoá không công khai ⇒ CÙNG một `KHONG_TIM_THAY`. */
export async function capVePhatHocThu(db: Db, input: { slug: string; lessonStableId: string; now: Date; ttlGiay?: number }): Promise<KetQuaCapPhat> {
  const b = await timBaiHocThuCongKhai(db, input.slug, input.lessonStableId);
  if (!b) return { ok: false, ma: "KHONG_TIM_THAY" };
  const k = khoaCuaBai(b);
  if (!k.ok) return { ok: false, ma: k.ma === "BAI_KHONG_TON_TAI" ? "KHONG_TIM_THAY" : k.ma };
  if (!isOnlineVideoBucketConfigured()) return { ok: false, ma: "KHO_VIDEO_CHUA_CAU_HINH" };
  const ttl = kepTtl(input.ttlGiay);
  const x = Math.floor(input.now.getTime() / 1000) + ttl;
  return { ok: true, ve: kyVe({ e: "", s: "", c: b.courseId, l: b.stableId, x, b: b.versionId, m: "CK" }), hetHanLuc: new Date(x * 1000), ttlGiay: ttl, loai: "HOC_THU", loaiTep: k.contentType };
}

/** Đường phát công khai (không phiên, không `Authorization`): VÉ trong query là chứng cứ duy nhất. App ghép với gốc API của nó. */
export const DUONG_PHAT = "/api/public/elearning-online/video/phat";

/** Phần `data` trả cho client khi cấp vé. KHÔNG có khoá media, kích thước tệp hay tên bucket. Ví dụ thật: `docs/mobile-integration/VIDEO-R2-API-V844.md`. */
export function dtoVePhat(k: Extract<KetQuaCapPhat, { ok: true }>) {
  return {
    loai: k.loai,
    duongPhat: `${DUONG_PHAT}?ve=${k.ve}`,
    hetHanLuc: k.hetHanLuc.toISOString(),
    /** Xin vé mới trước mốc này (còn ~20% TTL), đổi URL và tua lại vị trí đang xem — vé hết hạn thì mọi lượt Range sau đó ăn 401. */
    lamMoiTruocLuc: new Date(k.hetHanLuc.getTime() - Math.round(k.ttlGiay * 1000 * TI_LE_LAM_MOI)).toISOString(),
    ttlGiay: k.ttlGiay,
    loaiTep: k.loaiTep,
    hoTroRange: true as const,
  };
}

export type KetQuaKiemPhat = { ok: true; khoa: string; contentType: string; loai: LoaiPhat } | { ok: false; ma: MaLoiPhat };

/**
 * KIỂM VÉ PHÁT — gọi ở MỖI lượt phát (kể cả mỗi lượt Range). Trả KHOÁ R2 thật (chỉ cho lớp phát server). Xem bất biến 4.
 * Đọc: vé hợp lệ (chữ ký, hạn) → loại vé → quyền/học thử CÒN LÚC NÀY → phiên bản còn là bản đang chạy → khoá media hợp chính sách.
 */
export async function kiemVePhat(db: Db, token: string, now: Date): Promise<KetQuaKiemPhat> {
  const r = docVe(token, now);
  if (!r.ok) return r;
  const { nd } = r;
  if (!nd.m || typeof nd.b !== "string" || nd.b.length === 0) return { ok: false, ma: "VE_SAI_DINH_DANG" }; // vé đời cũ (`capVeMedia`) không phát được

  if (nd.m === "HV") {
    if (!nd.p) return { ok: false, ma: "VE_SAI_DINH_DANG" };
    const q = await db.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId: nd.s, courseId: nd.c } }, select: { id: true } });
    if (!q || q.id !== nd.e) return { ok: false, ma: "VE_KHONG_KHOP_QUYEN" };
    const cong = await kiemTraTruyCapChoPhuHuynh(db, { parentUserId: nd.p, studentId: nd.s, courseId: nd.c, lessonStableId: nd.l, now });
    if (!cong.ok && cong.ma !== "DA_HOAN_THANH_KHONG_XEM_LAI") return { ok: false, ma: cong.ma === "SAI_PHU_HUYNH" ? "VE_KHONG_KHOP_QUYEN" : cong.ma };
    const khoa = await db.onlCourse.findUnique({ where: { id: nd.c }, select: { publishedVersionId: true } });
    if (!khoa?.publishedVersionId) return { ok: false, ma: "KHOA_CHUA_PHAT_HANH" };
    if (khoa.publishedVersionId !== nd.b) return { ok: false, ma: "VE_PHIEN_BAN_CU" };
    const bai = await db.onlLesson.findUnique({ where: { versionId_stableId: { versionId: khoa.publishedVersionId, stableId: nd.l } }, select: { kind: true, contentJson: true } });
    const k = khoaCuaBai(bai);
    return k.ok ? { ok: true, khoa: k.khoa, contentType: k.contentType, loai: "TRA_PHI" } : { ok: false, ma: k.ma };
  }

  // CK — học thử công khai: hỏi LẠI đúng vị từ công khai bằng slug hiện tại của khoá.
  const kh = await db.onlCourse.findUnique({ where: { id: nd.c }, select: { slug: true } });
  if (!kh) return { ok: false, ma: "KHONG_TIM_THAY" };
  const b = await timBaiHocThuCongKhai(db, kh.slug, nd.l);
  if (!b) return { ok: false, ma: "KHONG_TIM_THAY" };
  if (b.versionId !== nd.b) return { ok: false, ma: "VE_PHIEN_BAN_CU" };
  const k = khoaCuaBai(b);
  return k.ok ? { ok: true, khoa: k.khoa, contentType: k.contentType, loai: "HOC_THU" } : { ok: false, ma: k.ma === "BAI_KHONG_TON_TAI" ? "KHONG_TIM_THAY" : k.ma };
}
