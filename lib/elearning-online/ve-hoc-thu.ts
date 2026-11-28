import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { getSigningSecret } from "@/lib/security/signing-key";
import { banDuocLucNay } from "./danh-muc-cong-khai";
import { laKhoaVideoOnlineHopLe } from "./video-khoa";

/**
 * E-LEARNING ONLINE — VÉ VIDEO HỌC THỬ (FREE MODE, D1): xem bài video đánh dấu "học thử" KHÔNG cần đăng nhập. Hợp đồng quyền cho lớp phát video (A ký URL R2 / HTTP).
 *
 * Vì sao KHÔNG dùng lại `ve-media.ts`: vé trả phí chứng minh "học viên X có QUYỀN HỌC bài này"; vé học thử chứng minh "bài này đang CÔNG KHAI". Hai lời khẳng định khác nhau,
 * nên khoá ký có TIỀN TỐ MIỀN riêng (`onl-media-free-v1.`) — vé học thử KHÔNG bao giờ qua được `docVe` của vé trả phí và ngược lại (không "nâng" vé công khai thành quyền học).
 *
 * Bất biến (mỗi cái có ca DB riêng — `tests/elearning/onl-ve-hoc-thu-db.test.ts`):
 * 1. Chỉ cấp cho bài: VIDEO · `freePreview` · không ẩn · chương không ẩn · thuộc bản ĐANG PHÁT HÀNH · khoá đang bán công khai (cùng `banDuocLucNay` với danh mục công khai).
 *    Bài trả phí / ẩn / khoá chưa bán / không tồn tại ⇒ CÙNG mã `KHONG_TIM_THAY` (không lộ bài trả phí có tồn tại).
 * 2. Vé KHÔNG chứa khoá media; khoá chỉ rời DB khi `kiemVeHocThu` thành công VÀ nằm trong vùng `online/video/` (chống "phục vụ hộ" video giáo trình/bài nộp/phôi).
 * 3. Mỗi LẦN dùng vé, điều kiện công khai được hỏi LẠI: Đào tạo bỏ cờ học thử / ẩn bài / tạm ngừng bán / lưu trữ sau khi cấp vé ⇒ vé vô hiệu NGAY.
 * 4. Vé NGẮN HẠN (mặc định 60 giây, trần 120 — ngắn hơn vé trả phí vì không có định danh để truy vết), ký HMAC-SHA256 bằng khoá chung (≥ 32 ký tự; thiếu ⇒ NÉM LỖI).
 *    Vé học thử KHÔNG mang định danh người xem (không có): giới hạn tần suất theo IP/thiết bị là việc của lớp HTTP (A) — E không tự chế cơ chế đó.
 * 5. Vé gắn `versionId` đang phát hành lúc cấp: phát hành bản mới đổi bài/xoá video ⇒ vé cũ không khớp ⇒ vô hiệu (không phát video của bản đã gỡ).
 *
 * ⚠️ Đây vẫn CHỈ là lớp quyền. Kho video có kiểm soát (ký URL R2, chặn truy cập trực tiếp) là hạ tầng của A (BLOCKED_INFRA) — xem docs/elearning/E-R2-PRIVATE-VIDEO-CONTRACT.md.
 */

type Db = PrismaClient;
export const TTL_VE_HOC_THU_GIAY = 60;
export const TTL_VE_HOC_THU_TOI_DA = 120;

/** `u` = tài khoản đã đăng nhập mà vé gắn với (OD06=A, Free Mode dùng ĐĂNG NHẬP HIỆN TẠI). Vé không có `u` = vé công khai cũ (không còn dùng cho Free Mode đăng nhập). */
type NoiDungVeHocThu = { v: 1; k: "free"; c: string; ver: string; l: string; x: number; n: string; u?: string };

const b64 = (b: Buffer) => b.toString("base64url");
const ky = (payloadB64: string) => createHmac("sha256", getSigningSecret()).update(`onl-media-free-v1.${payloadB64}`).digest();

export function kyVeHocThu(nd: Omit<NoiDungVeHocThu, "v" | "k" | "n">, nonce: string = b64(randomBytes(9))): string {
  const payload = b64(Buffer.from(JSON.stringify({ v: 1, k: "free", ...nd, n: nonce } satisfies NoiDungVeHocThu)));
  return `${payload}.${b64(ky(payload))}`;
}

export type KetQuaDocVeHocThu = { ok: true; nd: NoiDungVeHocThu } | { ok: false; ma: "VE_SAI_DINH_DANG" | "VE_SAI_CHU_KY" | "VE_HET_HAN" };

/** Đọc + kiểm chữ ký + hạn. Không chạm DB. */
export function docVeHocThu(token: string, now: Date): KetQuaDocVeHocThu {
  const m = /^([A-Za-z0-9_-]{20,1000})\.([A-Za-z0-9_-]{43})$/.exec(token ?? "");
  if (!m) return { ok: false, ma: "VE_SAI_DINH_DANG" };
  const [, payload, sig] = m as unknown as [string, string, string];
  const dung = ky(payload);
  const co = Buffer.from(sig, "base64url");
  if (co.length !== dung.length || !timingSafeEqual(co, dung)) return { ok: false, ma: "VE_SAI_CHU_KY" };
  let nd: NoiDungVeHocThu;
  try {
    nd = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as NoiDungVeHocThu;
  } catch {
    return { ok: false, ma: "VE_SAI_DINH_DANG" };
  }
  if (nd?.v !== 1 || nd.k !== "free" || typeof nd.c !== "string" || typeof nd.ver !== "string" || typeof nd.l !== "string" || typeof nd.x !== "number") return { ok: false, ma: "VE_SAI_DINH_DANG" };
  if (nd.u !== undefined && (typeof nd.u !== "string" || nd.u.length === 0)) return { ok: false, ma: "VE_SAI_DINH_DANG" };
  if (now.getTime() >= nd.x * 1000) return { ok: false, ma: "VE_HET_HAN" };
  return { ok: true, nd };
}

/** MỘT truy vấn cho cả cấp vé và kiểm vé: bài VIDEO học thử còn CÔNG KHAI không. Không lộ lý do (trả null chung). */
async function timBaiHocThuVideo(db: Db, where: { slug: string } | { id: string }, lessonStableId: string, now: Date) {
  const k = await db.onlCourse.findFirst({
    where: { ...where, deletedAt: null, publishedVersionId: { not: null }, saleStatus: { in: ["ON_SALE", "SCHEDULED"] } },
    select: { id: true, saleStatus: true, saleOpensAt: true, publishedVersionId: true },
  });
  if (!k?.publishedVersionId || !banDuocLucNay(k.saleStatus, k.saleOpensAt, now)) return null;
  const b = await db.onlLesson.findFirst({
    where: { versionId: k.publishedVersionId, stableId: lessonStableId, kind: "VIDEO", freePreview: true, hidden: false, chapter: { hidden: false } },
    select: { contentJson: true },
  });
  if (!b) return null;
  return { courseId: k.id, versionId: k.publishedVersionId, mediaRef: (b.contentJson as { mediaRef?: unknown } | null)?.mediaRef };
}

export type KetQuaCapVeHocThu = { ok: true; ve: string; hetHanLuc: Date } | { ok: false; ma: "KHONG_TIM_THAY" | "CHUA_CO_VIDEO" | "MEDIA_NGOAI_VUNG" };

export async function capVeHocThu(db: Db, input: { slug: string; lessonStableId: string; now: Date; ttlGiay?: number }): Promise<KetQuaCapVeHocThu> {
  const b = await timBaiHocThuVideo(db, { slug: input.slug }, input.lessonStableId, input.now);
  if (!b) return { ok: false, ma: "KHONG_TIM_THAY" };
  if (!b.mediaRef) return { ok: false, ma: "CHUA_CO_VIDEO" };
  if (!laKhoaVideoOnlineHopLe(b.mediaRef)) return { ok: false, ma: "MEDIA_NGOAI_VUNG" };
  const ttl = Math.min(Math.max(Math.floor(input.ttlGiay ?? TTL_VE_HOC_THU_GIAY), 10), TTL_VE_HOC_THU_TOI_DA);
  const x = Math.floor(input.now.getTime() / 1000) + ttl;
  return { ok: true, ve: kyVeHocThu({ c: b.courseId, ver: b.versionId, l: input.lessonStableId, x }), hetHanLuc: new Date(x * 1000) };
}

export type KetQuaKiemVeHocThu = { ok: true; mediaRef: string; courseId: string; lessonStableId: string } | { ok: false; ma: "VE_SAI_DINH_DANG" | "VE_SAI_CHU_KY" | "VE_HET_HAN" | "KHONG_TIM_THAY" | "VE_KHONG_KHOP_BAN" | "CHUA_CO_VIDEO" | "MEDIA_NGOAI_VUNG" | "VE_CAN_TAI_KHOAN" };

/** DÀNH CHO LỚP PHÁT VIDEO (server, KHÔNG phải trình duyệt): đổi vé học thử lấy khoá media. Hỏi LẠI điều kiện công khai + bản phát hành. */
export async function kiemVeHocThu(db: Db, token: string, now: Date): Promise<KetQuaKiemVeHocThu> {
  const r = docVeHocThu(token, now);
  if (!r.ok) return r;
  const { nd } = r;
  // Vé đã gắn tài khoản (Free Mode đăng nhập) KHÔNG được dùng ở đường công khai: tách miền dùng để vé của người này không "rơi" sang người khác.
  if (nd.u !== undefined) return { ok: false, ma: "VE_CAN_TAI_KHOAN" };
  const b = await timBaiHocThuVideo(db, { id: nd.c }, nd.l, now);
  if (!b) return { ok: false, ma: "KHONG_TIM_THAY" };
  if (b.versionId !== nd.ver) return { ok: false, ma: "VE_KHONG_KHOP_BAN" };
  if (!b.mediaRef) return { ok: false, ma: "CHUA_CO_VIDEO" };
  if (!laKhoaVideoOnlineHopLe(b.mediaRef)) return { ok: false, ma: "MEDIA_NGOAI_VUNG" };
  return { ok: true, mediaRef: b.mediaRef, courseId: nd.c, lessonStableId: nd.l };
}

// ───────── FREE MODE ĐĂNG NHẬP (Owner OD06=A, 25/11/2026) ─────────
// Free Mode dùng ĐĂNG NHẬP HIỆN TẠI (không loại tài khoản mới, không truy cập ẩn danh): người dùng đã đăng nhập (do A xác thực, truyền `taiKhoanId`) được xem các bài Đào tạo ĐÃ CHỌN
// (`freePreview`) của khoá ĐANG BÁN mà KHÔNG cần quyền học. Mọi thứ khác vẫn cần quyền (`kiemTraTruyCapNoiDungDb`).
//  · Không định nghĩa hạn mức / bộ nội dung Free: bộ bài do Đào tạo bật cờ `freePreview`; không giới hạn số bài/lượt vì Owner chưa chốt (câu hỏi mở — xem docs).
//  · CHỈ bài VIDEO và READ. Bài ASSIGNMENT/QUIZ/FINAL_EXAM cần lượt làm gắn quyền học (nháp/chấm/chứng nhận đều theo quyền) ⇒ KHÔNG phục vụ qua Free Mode dù bị gắn cờ.
//  · Vé video gắn `u` = tài khoản: tài khoản khác dùng lại vé ⇒ từ chối. Không lộ khoá media trong vé, không trả khoá media ở bất kỳ kết quả công khai nào.
//  · Bài trả phí: không cấp vé (`KHONG_TIM_THAY` cùng mã với slug lạ — không lộ bài nào tồn tại).

const LOAI_BAI_MIEN_PHI = ["VIDEO", "READ"] as const;

export type KetQuaBaiMienPhi =
  | { ok: true; bai: { stableId: string; title: string; kind: "VIDEO" | "READ"; courseId: string; versionId: string; /** CHỈ bài READ; bài VIDEO không bao giờ trả khoá media (dùng vé). */ noiDung: unknown } }
  | { ok: false; ma: "CHUA_DANG_NHAP" | "KHONG_TIM_THAY" };

/** Học viên ĐÃ ĐĂNG NHẬP xem một bài miễn phí. `slug` hoặc `courseId`. Không chạm quyền học. */
export async function kiemTraTruyCapBaiMienPhi(db: Db, input: { taiKhoanId: string; courseId?: string; slug?: string; lessonStableId: string; now: Date }): Promise<KetQuaBaiMienPhi> {
  if (!input.taiKhoanId) return { ok: false, ma: "CHUA_DANG_NHAP" };
  if (!input.courseId && !input.slug) return { ok: false, ma: "KHONG_TIM_THAY" };
  const k = await db.onlCourse.findFirst({
    where: { ...(input.courseId ? { id: input.courseId } : { slug: input.slug! }), deletedAt: null, publishedVersionId: { not: null }, saleStatus: { in: ["ON_SALE", "SCHEDULED"] } },
    select: { id: true, saleStatus: true, saleOpensAt: true, publishedVersionId: true },
  });
  if (!k?.publishedVersionId || !banDuocLucNay(k.saleStatus, k.saleOpensAt, input.now)) return { ok: false, ma: "KHONG_TIM_THAY" };
  const b = await db.onlLesson.findFirst({
    where: { versionId: k.publishedVersionId, stableId: input.lessonStableId, freePreview: true, hidden: false, kind: { in: [...LOAI_BAI_MIEN_PHI] }, chapter: { hidden: false } },
    select: { stableId: true, title: true, kind: true, contentJson: true },
  });
  if (!b) return { ok: false, ma: "KHONG_TIM_THAY" };
  return { ok: true, bai: { stableId: b.stableId, title: b.title, kind: b.kind as "VIDEO" | "READ", courseId: k.id, versionId: k.publishedVersionId, noiDung: b.kind === "READ" ? b.contentJson : null } };
}

export type KetQuaCapVeDangNhap = KetQuaCapVeHocThu | { ok: false; ma: "CHUA_DANG_NHAP" };

/** Cấp vé video học thử GẮN TÀI KHOẢN. Điều kiện bài = như `capVeHocThu`; thêm: phải có `taiKhoanId`. */
export async function capVeHocThuDangNhap(db: Db, input: { taiKhoanId: string; slug: string; lessonStableId: string; now: Date; ttlGiay?: number }): Promise<KetQuaCapVeDangNhap> {
  if (!input.taiKhoanId) return { ok: false, ma: "CHUA_DANG_NHAP" };
  const b = await timBaiHocThuVideo(db, { slug: input.slug }, input.lessonStableId, input.now);
  if (!b) return { ok: false, ma: "KHONG_TIM_THAY" };
  if (!b.mediaRef) return { ok: false, ma: "CHUA_CO_VIDEO" };
  if (!laKhoaVideoOnlineHopLe(b.mediaRef)) return { ok: false, ma: "MEDIA_NGOAI_VUNG" };
  const ttl = Math.min(Math.max(Math.floor(input.ttlGiay ?? TTL_VE_HOC_THU_GIAY), 10), TTL_VE_HOC_THU_TOI_DA);
  const x = Math.floor(input.now.getTime() / 1000) + ttl;
  return { ok: true, ve: kyVeHocThu({ c: b.courseId, ver: b.versionId, l: input.lessonStableId, x, u: input.taiKhoanId }), hetHanLuc: new Date(x * 1000) };
}

export type KetQuaKiemVeDangNhap = Exclude<KetQuaKiemVeHocThu, { ok: false; ma: "VE_CAN_TAI_KHOAN" }> | { ok: false; ma: "VE_KHONG_DUNG_TAI_KHOAN" | "VE_THIEU_TAI_KHOAN" | "CHUA_DANG_NHAP" };

/** LỚP PHÁT VIDEO (server): đổi vé gắn tài khoản lấy khoá media. Vé phải ĐÚNG tài khoản đang đăng nhập; hỏi LẠI điều kiện bài + bản phát hành như `kiemVeHocThu`. */
export async function kiemVeHocThuDangNhap(db: Db, token: string, taiKhoanId: string, now: Date): Promise<KetQuaKiemVeDangNhap> {
  if (!taiKhoanId) return { ok: false, ma: "CHUA_DANG_NHAP" };
  const r = docVeHocThu(token, now);
  if (!r.ok) return r;
  const { nd } = r;
  if (nd.u === undefined) return { ok: false, ma: "VE_THIEU_TAI_KHOAN" };
  if (nd.u !== taiKhoanId) return { ok: false, ma: "VE_KHONG_DUNG_TAI_KHOAN" };
  const b = await timBaiHocThuVideo(db, { id: nd.c }, nd.l, now);
  if (!b) return { ok: false, ma: "KHONG_TIM_THAY" };
  if (b.versionId !== nd.ver) return { ok: false, ma: "VE_KHONG_KHOP_BAN" };
  if (!b.mediaRef) return { ok: false, ma: "CHUA_CO_VIDEO" };
  if (!laKhoaVideoOnlineHopLe(b.mediaRef)) return { ok: false, ma: "MEDIA_NGOAI_VUNG" };
  return { ok: true, mediaRef: b.mediaRef, courseId: nd.c, lessonStableId: nd.l };
}
