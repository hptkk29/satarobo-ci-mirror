import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { getSigningSecret } from "@/lib/security/signing-key";
import { kiemTraTruyCapChoPhuHuynh } from "./hoc-tap";
import { laKhoaVideoOnlineHopLe } from "./video-khoa";
import { kiemTraTruyCapNoiDungDb, type MaTruyCapDb } from "./quyen-hoc-db";

/**
 * E-LEARNING ONLINE — VÉ MEDIA NGẮN HẠN cho video TRẢ PHÍ (hợp đồng §6).
 *
 * ⚠️ File này CHỈ là lớp QUYỀN + chữ ký vé; không có byte video nào đi qua đây. Lớp PHÁT (V8.44) là `video-phat.ts` + `video-phat-http.ts` (proxy R2 có Range, vé phát
 * mang thêm `p`/`b`/`m`). Vé chỉ chứng minh "người này có quyền xem bài này LÚC NÀY"; KHÔNG phải DRM — không ngăn được người đang xem ghi/quay lại luồng.
 *
 * Bất biến:
 * 1. Vé chỉ cấp qua `kiemTraTruyCapChoPhuHuynh` (sở hữu phụ huynh + quyền + hạn + thu hồi + thứ tự mở bài + không xem lại) — một cổng, không cổng riêng.
 * 2. Vé KHÔNG chứa khoá media. Khoá media chỉ rời DB khi `kiemVeMedia` thành công, và chỉ cho lớp phát video (server) — không bao giờ tới trình duyệt.
 * 3. Mỗi LẦN dùng vé, cổng truy cập được hỏi LẠI: thu hồi/hết hạn quyền sau khi cấp vé ⇒ vé vô hiệu NGAY (vé 2 phút không phải lý do để bỏ kiểm).
 * 4. Vé ngắn hạn (mặc định 120 giây, trần 300), ký HMAC-SHA256 bằng khoá ký chung của hệ thống (≥32 ký tự, thiếu ⇒ NÉM LỖI, không ký bằng khoá yếu).
 */

type Db = PrismaClient;
export const TTL_VE_GIAY = 120;
export const TTL_VE_TOI_DA = 300;

/**
 * Trường TUỲ CHỌN `p`/`b`/`m` (V8.44 — vé PHÁT video, `video-phat.ts`): người xem (phụ huynh) · phiên bản khoá đang chạy lúc cấp · loại vé (`HV` trả phí / `CK` học thử công khai).
 * Vé đời cũ (`capVeMedia`) không mang chúng; đường PHÁT từ chối vé thiếu `m` nên vé "đổi khoá media" không bao giờ phát được video.
 */
export type NoiDungVe = { v: 1; e: string; s: string; c: string; l: string; x: number; n: string; p?: string; b?: string; m?: "HV" | "CK" };

const b64 = (b: Buffer) => b.toString("base64url");
const ky = (payloadB64: string) => createHmac("sha256", getSigningSecret()).update(`onl-media-v1.${payloadB64}`).digest();

export function kyVe(nd: Omit<NoiDungVe, "v" | "n">, nonce: string = b64(randomBytes(9))): string {
  const payload = b64(Buffer.from(JSON.stringify({ v: 1, ...nd, n: nonce } satisfies NoiDungVe)));
  return `${payload}.${b64(ky(payload))}`;
}

export type KetQuaDocVe = { ok: true; nd: NoiDungVe } | { ok: false; ma: "VE_SAI_DINH_DANG" | "VE_SAI_CHU_KY" | "VE_HET_HAN" };

/** Đọc + kiểm chữ ký + hạn. Không chạm DB. So chữ ký bằng `timingSafeEqual`. */
export function docVe(token: string, now: Date): KetQuaDocVe {
  const m = /^([A-Za-z0-9_-]{20,1000})\.([A-Za-z0-9_-]{43})$/.exec(token ?? "");
  if (!m) return { ok: false, ma: "VE_SAI_DINH_DANG" };
  const [, payload, sig] = m as unknown as [string, string, string];
  const dung = ky(payload);
  const co = Buffer.from(sig, "base64url");
  if (co.length !== dung.length || !timingSafeEqual(co, dung)) return { ok: false, ma: "VE_SAI_CHU_KY" };
  let nd: NoiDungVe;
  try {
    nd = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as NoiDungVe;
  } catch {
    return { ok: false, ma: "VE_SAI_DINH_DANG" };
  }
  if (nd?.v !== 1 || typeof nd.e !== "string" || typeof nd.s !== "string" || typeof nd.c !== "string" || typeof nd.l !== "string" || typeof nd.x !== "number") return { ok: false, ma: "VE_SAI_DINH_DANG" };
  if ((nd.p !== undefined && typeof nd.p !== "string") || (nd.b !== undefined && typeof nd.b !== "string") || (nd.m !== undefined && nd.m !== "HV" && nd.m !== "CK")) return { ok: false, ma: "VE_SAI_DINH_DANG" };
  if (now.getTime() >= nd.x * 1000) return { ok: false, ma: "VE_HET_HAN" };
  return { ok: true, nd };
}

export type KetQuaCapVe = { ok: true; ve: string; hetHanLuc: Date } | { ok: false; ma: MaTruyCapDb | "SAI_PHU_HUYNH" | "BAI_KHONG_PHAI_VIDEO" | "CHUA_CO_VIDEO" | "MEDIA_NGOAI_VUNG" };

export async function capVeMedia(db: Db, input: { parentUserId: string; studentId: string; courseId: string; lessonStableId: string; now: Date; ttlGiay?: number }): Promise<KetQuaCapVe> {
  const cong = await kiemTraTruyCapChoPhuHuynh(db, input);
  if (!cong.ok) return { ok: false, ma: cong.ma };
  const khoa = await db.onlCourse.findUniqueOrThrow({ where: { id: input.courseId }, select: { publishedVersionId: true } });
  const bai = await db.onlLesson.findUnique({ where: { versionId_stableId: { versionId: khoa.publishedVersionId!, stableId: input.lessonStableId } }, select: { kind: true, contentJson: true } });
  if (!bai || bai.kind !== "VIDEO") return { ok: false, ma: "BAI_KHONG_PHAI_VIDEO" };
  const refBai = (bai.contentJson as { mediaRef?: string } | null)?.mediaRef;
  if (!refBai) return { ok: false, ma: "CHUA_CO_VIDEO" };
  if (!laKhoaVideoOnlineHopLe(refBai)) return { ok: false, ma: "MEDIA_NGOAI_VUNG" }; // dòng cũ/ghi tay trỏ ra ngoài vùng Online ⇒ không cấp vé
  const q = await db.onlEntitlement.findUniqueOrThrow({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } }, select: { id: true } });
  const ttl = Math.min(Math.max(Math.floor(input.ttlGiay ?? TTL_VE_GIAY), 10), TTL_VE_TOI_DA);
  const x = Math.floor(input.now.getTime() / 1000) + ttl;
  return { ok: true, ve: kyVe({ e: q.id, s: input.studentId, c: input.courseId, l: input.lessonStableId, x }), hetHanLuc: new Date(x * 1000) };
}

export type KetQuaKiemVe = { ok: true; mediaRef: string; studentId: string; courseId: string; lessonStableId: string } | { ok: false; ma: "VE_SAI_DINH_DANG" | "VE_SAI_CHU_KY" | "VE_HET_HAN" | MaTruyCapDb | "BAI_KHONG_PHAI_VIDEO" | "CHUA_CO_VIDEO" | "VE_KHONG_KHOP_QUYEN" | "MEDIA_NGOAI_VUNG" };

/**
 * DÀNH CHO LỚP PHÁT VIDEO (server, KHÔNG phải trình duyệt): đổi vé lấy khoá media. Hỏi LẠI cổng truy cập (thu hồi/hết hạn sau khi cấp ⇒ từ chối).
 * Vé gắn `entitlementId`: quyền bị xoá/đổi chủ ⇒ `VE_KHONG_KHOP_QUYEN`.
 */
export async function kiemVeMedia(db: Db, token: string, now: Date): Promise<KetQuaKiemVe> {
  const r = docVe(token, now);
  if (!r.ok) return r;
  const { nd } = r;
  const q = await db.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId: nd.s, courseId: nd.c } }, select: { id: true } });
  if (!q || q.id !== nd.e) return { ok: false, ma: "VE_KHONG_KHOP_QUYEN" };
  const cong = await kiemTraTruyCapNoiDungDb(db, { studentId: nd.s, courseId: nd.c, lessonStableId: nd.l, now });
  if (!cong.ok) return { ok: false, ma: cong.ma };
  const khoa = await db.onlCourse.findUniqueOrThrow({ where: { id: nd.c }, select: { publishedVersionId: true } });
  const bai = await db.onlLesson.findUnique({ where: { versionId_stableId: { versionId: khoa.publishedVersionId!, stableId: nd.l } }, select: { kind: true, contentJson: true } });
  if (!bai || bai.kind !== "VIDEO") return { ok: false, ma: "BAI_KHONG_PHAI_VIDEO" };
  const ref = (bai.contentJson as { mediaRef?: string } | null)?.mediaRef;
  if (!ref) return { ok: false, ma: "CHUA_CO_VIDEO" };
  if (!laKhoaVideoOnlineHopLe(ref)) return { ok: false, ma: "MEDIA_NGOAI_VUNG" }; // khoá KHÔNG bao giờ rời DB nếu nằm ngoài vùng Online (kho dùng chung với video giáo trình/SCORM/bài nộp)
  return { ok: true, mediaRef: ref, studentId: nd.s, courseId: nd.c, lessonStableId: nd.l };
}
