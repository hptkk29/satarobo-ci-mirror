import "server-only";
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, r2DaCauHinh } from "@/lib/storage/r2-client";
import {
  KHOA_TEP_BAO_LUU_RE,
  MIME_TEP_BAO_LUU,
  TRAN_CO_TEP_BAO_LUU,
  vanTayBaoLuu,
  type LoaiTepBaoLuu,
} from "@/lib/bao-luu/tep";
import { TIEN_TO_TEP_BAO_LUU, type TepTrongKho } from "@/lib/bao-luu/tep-mo-coi";

// =============================================================================
// KHO TỆP BẢO LƯU — bucket R2 RIÊNG (chốt 07/10/2026: "đơn có dữ liệu cá nhân nên KHÔNG được dùng URL
// công khai … URL ký có hạn ngắn, kiểm quyền `bao-luu:view` khi xem và `bao-luu:create` khi tải lên").
//
// Đơn bảo lưu quét + minh chứng ốm đau mang tên trẻ em, tình trạng sức khoẻ, chữ ký phụ huynh. Bucket
// `R2_BUCKET_NAME` gắn custom domain cdn.satarobo.vn nên MỌI object tải được vô danh — và "thư mục private"
// trong bucket công khai không tồn tại: quyền công khai là của CẢ bucket. Vì vậy kho riêng, và getter NÉM
// chứ không lùi về bucket chung: một đường "tạm dùng bucket công khai" chạy đúng lúc thử và rò trên prod.
//
// Khuôn: `lib/finance/hoa-don/kho-tep.ts`. ⚠️ Phải đi qua `getR2Client()` chung (đặt
// `requestChecksumCalculation: "WHEN_REQUIRED"`) — dựng S3Client riêng thì URL PUT ký sẵn mang CRC32 của
// body rỗng, R2 từ chối, trình duyệt báo như lỗi CORS.
//
// Phần THUẦN (loại tệp, khoá, vân tay) ở `lib/bao-luu/tep.ts` để test không cần R2.
// =============================================================================

export class BaoLuuKhoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaoLuuKhoConfigError";
  }
}

const BUCKET_KHAC: readonly (readonly [string, string])[] = [
  ["R2_BUCKET_NAME", "bucket CÔNG KHAI (cdn.satarobo.vn) — đơn bảo lưu sẽ tải được vô danh"],
  ["R2_CHAT_BUCKET_NAME", "bucket ảnh chat"],
  ["R2_ELEARNING_BUCKET_NAME", "bucket đào tạo nội bộ"],
  ["R2_INVOICE_BUCKET_NAME", "bucket hoá đơn điện tử"],
];

/** Tên bucket bảo lưu. NÉM `BaoLuuKhoConfigError` khi thiếu hoặc trùng bucket của module khác. */
export function getBaoLuuBucket(): string {
  const bucket = (process.env.R2_BAOLUU_BUCKET_NAME ?? "").trim();
  if (!bucket) {
    throw new BaoLuuKhoConfigError("R2_BAOLUU_BUCKET_NAME chưa đặt — kho tệp bảo lưu chưa cấu hình");
  }
  for (const [env, nhan] of BUCKET_KHAC) {
    const khac = (process.env[env] ?? "").trim();
    if (khac && khac === bucket) {
      throw new BaoLuuKhoConfigError(`R2_BAOLUU_BUCKET_NAME trùng ${env} — ${nhan}. Phải là bucket riêng.`);
    }
  }
  return bucket;
}

/** Hỏi trước khi làm gì — KHÔNG ném. Bucket hợp lệ VÀ client R2 chung dựng được (xem `r2DaCauHinh`). */
export function khoBaoLuuDaCauHinh(): boolean {
  try {
    getBaoLuuBucket();
  } catch {
    return false;
  }
  return r2DaCauHinh();
}

/** URL PUT ký sẵn. CHỈ ký `ContentType`. TTL BẮT BUỘC (luật 7). Cỡ thật được kiểm ở `xacMinhTepBaoLuu`. */
export async function kyUrlTaiLenBaoLuu(khoa: string, loai: LoaiTepBaoLuu, ttlGiay: number): Promise<string> {
  if (!KHOA_TEP_BAO_LUU_RE.test(khoa)) throw new Error("Khoá tệp bảo lưu không hợp lệ");
  const cmd = new PutObjectCommand({ Bucket: getBaoLuuBucket(), Key: khoa, ContentType: MIME_TEP_BAO_LUU[loai] });
  return getSignedUrl(getR2Client(), cmd, { expiresIn: ttlGiay });
}

/**
 * URL GET ký sẵn. TTL BẮT BUỘC. Người gọi PHẢI đã (1) kiểm quyền + cơ sở, (2) ghi audit TRƯỚC khi gọi.
 *
 * ⚠️ NÉM nếu khoá sai hình dạng: khoá đọc từ DB, và nếu một đường ghi nào đó từng nhận khoá tuỳ ý từ
 * trình duyệt thì đây là chỗ cuối cùng ngăn ký URL cho một object KHÔNG phải tệp bảo lưu.
 */
export async function kyUrlTaiVeBaoLuu(khoa: string, ttlGiay: number): Promise<string> {
  if (!KHOA_TEP_BAO_LUU_RE.test(khoa)) throw new Error("Khoá tệp bảo lưu không hợp lệ — từ chối ký");
  const cmd = new GetObjectCommand({ Bucket: getBaoLuuBucket(), Key: khoa });
  return getSignedUrl(getR2Client(), cmd, { expiresIn: ttlGiay });
}

export type KetQuaXacMinhBaoLuu =
  | { ok: true; co: number }
  | { ok: false; ma: "KHONG_THAY" | "QUA_LON" | "SAI_LOAI"; thongDiep: string };

/**
 * Xác minh tệp trình duyệt vừa PUT: HEAD lấy cỡ THẬT (chặn trần trước khi đọc thân) → đọc 16 byte đầu →
 * vân tay. Sai loại/quá lớn thì KHÔNG xoá ở đây (Phiên 3 gọi dọn khi huỷ hồ sơ); trả lý do để từ chối.
 */
export async function xacMinhTepBaoLuu(input: { khoa: string; loai: LoaiTepBaoLuu }): Promise<KetQuaXacMinhBaoLuu> {
  if (!KHOA_TEP_BAO_LUU_RE.test(input.khoa)) {
    return { ok: false, ma: "SAI_LOAI", thongDiep: "Khoá tệp không hợp lệ" };
  }
  const s3 = getR2Client();
  const Bucket = getBaoLuuBucket();
  let co: number;
  try {
    const dau = await s3.send(new HeadObjectCommand({ Bucket, Key: input.khoa }));
    co = Number(dau.ContentLength ?? NaN);
  } catch {
    return { ok: false, ma: "KHONG_THAY", thongDiep: "Không thấy tệp trên kho — tải lên lại" };
  }
  if (!Number.isFinite(co)) return { ok: false, ma: "KHONG_THAY", thongDiep: "Không đọc được cỡ tệp — tải lên lại" };
  if (co > TRAN_CO_TEP_BAO_LUU) return { ok: false, ma: "QUA_LON", thongDiep: "Tệp quá lớn" };
  let dau16: Uint8Array;
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket, Key: input.khoa, Range: "bytes=0-15" }));
    dau16 = (await r.Body?.transformToByteArray()) ?? new Uint8Array();
  } catch {
    return { ok: false, ma: "KHONG_THAY", thongDiep: "Không đọc được tệp — tải lên lại" };
  }
  if (!vanTayBaoLuu(input.loai, dau16)) {
    return { ok: false, ma: "SAI_LOAI", thongDiep: "Nội dung tệp không đúng loại đã khai" };
  }
  return { ok: true, co };
}

/** Trần số trang một lượt liệt kê (1000 khoá/trang) — kho lớn hơn thì lượt sau xét tiếp, `catNgang = true`. */
export const TRAN_TRANG_LIET_KE_BAO_LUU = 100;

/** Liệt kê tệp của luồng tải lên bảo lưu — CHỈ bucket bảo lưu (getter NÉM khi trùng bucket khác), CHỈ tiền tố `bao-luu/`. */
export async function lietKeTepBaoLuu(): Promise<{ tep: TepTrongKho[]; catNgang: boolean }> {
  const s3 = getR2Client();
  const Bucket = getBaoLuuBucket();
  const tep: TepTrongKho[] = [];
  let token: string | undefined;
  let trang = 0;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: TIEN_TO_TEP_BAO_LUU, ContinuationToken: token }));
    for (const o of r.Contents ?? []) {
      if (o.Key) tep.push({ khoa: o.Key, lastModified: o.LastModified ?? null });
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
    trang += 1;
  } while (token && trang < TRAN_TRANG_LIET_KE_BAO_LUU);
  return { tep, catNgang: Boolean(token) };
}

/**
 * Xoá một lô khoá trong bucket bảo lưu (≤1000 khoá/lệnh). NÉM nếu có khoá sai hình dạng — lớp chặn thứ hai sau bộ chọn, để một lỗi ở
 * tầng trên không xoá được thứ không phải tệp bảo lưu. `loi` = số khoá kho báo không xoá được (không tính vào `daXoa`).
 */
export async function xoaNhieuTepBaoLuu(khoa: readonly string[]): Promise<{ daXoa: number; loi: number }> {
  if (khoa.some((k) => !KHOA_TEP_BAO_LUU_RE.test(k))) throw new Error("Xoá tệp bảo lưu: có khoá sai hình dạng");
  const s3 = getR2Client();
  const Bucket = getBaoLuuBucket();
  let daXoa = 0;
  let loi = 0;
  for (let i = 0; i < khoa.length; i += 1000) {
    const lo = khoa.slice(i, i + 1000);
    const r = await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: lo.map((Key) => ({ Key })), Quiet: true } }));
    const hong = r.Errors?.length ?? 0;
    loi += hong;
    daXoa += lo.length - hong;
  }
  return { daXoa, loi };
}
