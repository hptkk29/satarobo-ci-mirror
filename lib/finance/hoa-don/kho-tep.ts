import "server-only";
import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, r2DaCauHinh } from "@/lib/storage/r2-client";
import { TIEN_TO_TEP_HOA_DON, type TepTrongKho } from "./tep-mo-coi";

// =============================================================================
// KHO TỆP HOÁ ĐƠN ĐIỆN TỬ — bucket R2 RIÊNG (docs/ke-toan-hoa-don/PLAN.md §6).
//
// 🔴 `R2_BUCKET_NAME` gắn custom domain cdn.satarobo.vn: mọi object tải được VÔ DANH. URL ký chứa
// nguyên khoá, ai có URL là ghép sang CDN tải vĩnh viễn. Tệp hoá đơn mang MST, địa chỉ, email khách
// ⇒ kho riêng, và getter NÉM chứ không lùi: một đường "tạm dùng bucket công khai" chạy đúng lúc
// thử và rò trên prod.
//
// Khuôn: `lib/calls/kho-ghi-am.ts` (bản đầy đủ nhất). Khác ở một chỗ có chủ đích: so trùng đủ BỐN
// bucket (công khai · chat · đào tạo · ghi âm) — ba bản cũ không đối xứng.
//
// ⚠️ Phải đi qua `getR2Client()` chung: nó đặt `requestChecksumCalculation: "WHEN_REQUIRED"`. Dựng
// S3Client riêng thì URL PUT ký sẵn mang CRC32 của body rỗng, R2 từ chối, trình duyệt báo như CORS.
// =============================================================================

export class HoaDonKhoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HoaDonKhoConfigError";
  }
}

const BUCKET_KHAC: readonly (readonly [string, string])[] = [
  ["R2_BUCKET_NAME", "bucket CÔNG KHAI (cdn.satarobo.vn) — tệp hoá đơn sẽ tải được vô danh"],
  ["R2_CHAT_BUCKET_NAME", "bucket ảnh chat"],
  ["R2_ELEARNING_BUCKET_NAME", "bucket đào tạo nội bộ"],
  ["R2_CALL_BUCKET_NAME", "bucket ghi âm cuộc gọi"],
];

/** Tên bucket hoá đơn. NÉM `HoaDonKhoConfigError` khi thiếu hoặc trùng bucket của module khác. */
export function getHoaDonBucket(): string {
  const bucket = (process.env.R2_INVOICE_BUCKET_NAME ?? "").trim();
  if (!bucket) {
    throw new HoaDonKhoConfigError(
      "R2_INVOICE_BUCKET_NAME chưa đặt — kho hoá đơn chưa cấu hình (docs/ke-toan-hoa-don/PLAN.md §6)",
    );
  }
  for (const [env, nhan] of BUCKET_KHAC) {
    const khac = (process.env[env] ?? "").trim();
    if (khac && khac === bucket) {
      throw new HoaDonKhoConfigError(`R2_INVOICE_BUCKET_NAME trùng ${env} — ${nhan}. Phải là bucket riêng.`);
    }
  }
  return bucket;
}

/**
 * Hỏi trước khi làm gì — KHÔNG ném. Đủ bucket hợp lệ + client R2 CHUNG dựng được.
 *
 * ⚠️ Vế thứ hai hỏi `r2DaCauHinh()` chứ không tự liệt kê biến: mọi phép ký URL ở đây đi qua
 * `getR2Client()`, mà client đó đòi cả `R2_BUCKET_NAME` + `R2_PUBLIC_URL`. Bản cũ chỉ hỏi ba khoá
 * truy cập ⇒ trả `true`, màn vẽ nút tải, route ký URL thì ném ⇒ 503 (smoke GĐ 7, 26/09/2026).
 */
export function khoHoaDonDaCauHinh(): boolean {
  try {
    getHoaDonBucket();
  } catch {
    return false;
  }
  return r2DaCauHinh();
}

export type LoaiTep = "pdf" | "xml";

/** Trần cỡ tệp (byte). XML hoá đơn điện tử vài chục KB; PDF có ảnh logo/chữ ký vài trăm KB. */
export const TRAN_CO_TEP: Record<LoaiTep, number> = {
  pdf: 10 * 1024 * 1024,
  xml: 2 * 1024 * 1024,
};

/** Mime ký vào URL PUT — trình duyệt PHẢI gửi đúng header này, không thì R2 403. */
export const MIME_TEP: Record<LoaiTep, string> = {
  pdf: "application/pdf",
  xml: "application/xml",
};

// Mã cơ sở / orderId / uuid chỉ gồm chữ-số-gạch: không cho khoá thoát khỏi thư mục đơn.
const AN_TOAN = /^[A-Za-z0-9_-]+$/;

/** `hoa-don/<mã cơ sở>/<năm>/<orderId>/<uuid>.<pdf|xml>` — NÉM nếu thành phần nào không an toàn. */
export function khoaTepHoaDon(input: {
  centerCode: string;
  orderId: string;
  loai: LoaiTep;
  nam: number;
  uuid: string;
}): string {
  const { centerCode, orderId, loai, nam, uuid } = input;
  for (const [ten, v] of [
    ["mã cơ sở", centerCode],
    ["mã đơn", orderId],
    ["uuid", uuid],
  ] as const) {
    if (!AN_TOAN.test(v)) throw new Error(`Khoá tệp hoá đơn: ${ten} không hợp lệ`);
  }
  if (!Number.isInteger(nam) || nam < 2000 || nam > 2999) throw new Error("Khoá tệp hoá đơn: năm không hợp lệ");
  return `hoa-don/${centerCode}/${nam}/${orderId}/${uuid}.${loai}`;
}

/**
 * Khoá này có đúng là tệp của ĐƠN này ở CƠ SỞ này không. Bước xác minh và bước tạo hoá đơn PHẢI
 * hỏi — khoá đến từ trình duyệt, và không hỏi thì kế toán cơ sở A gắn được tệp nằm dưới đơn của
 * cơ sở B vào hoá đơn của mình.
 */
export function khoaThuocDon(khoa: string, centerCode: string, orderId: string): boolean {
  if (khoa.includes("..")) return false;
  if (!AN_TOAN.test(centerCode) || !AN_TOAN.test(orderId)) return false;
  return new RegExp(`^hoa-don/${centerCode}/\\d{4}/${orderId}/[A-Za-z0-9_-]+\\.(pdf|xml)$`).test(khoa);
}

/**
 * Vân tay tệp — tin BYTE, không tin đuôi hay mime trình duyệt khai.
 *   · PDF: `%PDF-` ở byte 0.
 *   · XML: sau UTF-8 BOM (EF BB BF) và khoảng trắng tuỳ chọn, ký tự đầu tiên là `<`. Không đòi
 *     `<?xml`: tệp XML hoá đơn của phần mềm khác nhau có tệp bỏ khai báo đầu.
 */
export function vanTayHoaDon(loai: LoaiTep, dau: Uint8Array): boolean {
  if (loai === "pdf") {
    const MAU = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
    return MAU.every((b, i) => dau[i] === b);
  }
  let i = 0;
  if (dau[0] === 0xef && dau[1] === 0xbb && dau[2] === 0xbf) i = 3;
  while (i < dau.length && (dau[i] === 0x20 || dau[i] === 0x09 || dau[i] === 0x0a || dau[i] === 0x0d)) i++;
  return dau[i] === 0x3c; // <
}

/**
 * URL PUT ký sẵn. CHỈ ký `ContentType`: ký thêm ContentLength / checksum / metadata mà trình duyệt
 * không gửi đúng thì R2 trả 403 và trình duyệt báo như lỗi CORS. Hệ quả: URL không giới hạn được cỡ
 * ⇒ cổng cỡ thật nằm ở `xacMinhTepHoaDon`. TTL BẮT BUỘC (luật 7 — không mặc định).
 */
export async function kyUrlTaiLenHoaDon(khoa: string, contentType: string, ttlGiay: number): Promise<string> {
  const cmd = new PutObjectCommand({ Bucket: getHoaDonBucket(), Key: khoa, ContentType: contentType });
  return getSignedUrl(getR2Client(), cmd, { expiresIn: ttlGiay });
}

/** Tên tệp cho Content-Disposition: bản ASCII dự phòng + bản UTF-8 (RFC 5987) cho tên có dấu. */
function contentDisposition(tenTep: string): string {
  const ascii = tenTep
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .replace(/[^A-Za-z0-9._ -]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(tenTep)}`;
}

/** URL GET ký sẵn, tải về ĐÚNG tên tệp. TTL BẮT BUỘC. Người gọi phải ghi audit TRƯỚC khi gọi hàm này. */
export async function kyUrlTaiVeHoaDon(khoa: string, tenTep: string, ttlGiay: number): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: getHoaDonBucket(),
    Key: khoa,
    ResponseContentDisposition: contentDisposition(tenTep),
  });
  return getSignedUrl(getR2Client(), cmd, { expiresIn: ttlGiay });
}

export async function xoaTepHoaDon(khoa: string): Promise<void> {
  await getR2Client().send(new DeleteObjectCommand({ Bucket: getHoaDonBucket(), Key: khoa }));
}

/** Trần số trang một lượt liệt kê (≤1000 khoá/trang) — chặn vòng lặp vô tận khi kho trả `IsTruncated` sai. */
export const TRAN_TRANG_LIET_KE = 100;

/**
 * Liệt kê tệp của luồng tải lên hoá đơn — CHỈ bucket hoá đơn (getter NÉM khi trùng bucket công khai),
 * CHỈ tiền tố `hoa-don/`. Dùng cho cron dọn tệp mồ côi (`don-tep-mo-coi.ts`); `catNgang` = chạm trần trang.
 */
export async function lietKeTepHoaDon(): Promise<{ tep: TepTrongKho[]; catNgang: boolean }> {
  const s3 = getR2Client();
  const Bucket = getHoaDonBucket();
  const tep: TepTrongKho[] = [];
  let token: string | undefined;
  let trang = 0;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: TIEN_TO_TEP_HOA_DON, ContinuationToken: token }));
    for (const o of r.Contents ?? []) {
      if (o.Key) tep.push({ khoa: o.Key, lastModified: o.LastModified ?? null });
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
    trang += 1;
  } while (token && trang < TRAN_TRANG_LIET_KE);
  return { tep, catNgang: Boolean(token) };
}

/**
 * Xoá một lô khoá trong bucket hoá đơn (DeleteObjects, ≤1000 khoá/lệnh). NÉM nếu có khoá nằm ngoài tiền
 * tố `hoa-don/` — lớp chặn thứ hai sau bộ chọn, để một lỗi ở tầng trên không xoá được thứ không phải
 * tệp hoá đơn. `loi` = số khoá kho báo không xoá được (không tính vào `daXoa`).
 */
export async function xoaNhieuTepHoaDon(khoa: readonly string[]): Promise<{ daXoa: number; loi: number }> {
  if (khoa.some((k) => !k.startsWith(TIEN_TO_TEP_HOA_DON))) {
    throw new Error("Xoá tệp hoá đơn: có khoá nằm ngoài tiền tố hoa-don/");
  }
  const s3 = getR2Client();
  const Bucket = getHoaDonBucket();
  let daXoa = 0;
  let loi = 0;
  for (let i = 0; i < khoa.length; i += 1000) {
    const lo = khoa.slice(i, i + 1000);
    const r = await s3.send(
      new DeleteObjectsCommand({ Bucket, Delete: { Objects: lo.map((Key) => ({ Key })), Quiet: true } }),
    );
    const hong = r.Errors?.length ?? 0;
    loi += hong;
    daXoa += lo.length - hong;
  }
  return { daXoa, loi };
}

export type KetQuaXacMinh =
  | { ok: true; co: number; sha256: string }
  | { ok: false; ma: "KHONG_THAY" | "QUA_LON" | "SAI_LOAI"; thongDiep: string };

/**
 * Xác minh tệp trình duyệt vừa PUT: HEAD lấy cỡ THẬT → chặn trần (chưa đọc thân) → GET toàn thân →
 * vân tay → sha256. Từ chối vì QUA_LON / SAI_LOAI thì DỌN tệp khỏi kho (không để rác mang PII nằm
 * lại). KHONG_THAY thì không xoá gì. Người gọi PHẢI đã kiểm `khoaThuocDon` trước.
 */
/**
 * Tệp còn nằm trong kho không — HEAD, không tải thân. Bước chốt hoá đơn hỏi TRƯỚC transaction
 * (PLAN §4 ⑤): chốt một hoá đơn mà tệp đã mất là hứa với khách một tờ không tải được.
 * Lỗi mạng / quyền cũng trả `false` — fail-closed, người dùng thử lại.
 */
export async function coTepTrongKho(khoa: string): Promise<boolean> {
  try {
    await getR2Client().send(new HeadObjectCommand({ Bucket: getHoaDonBucket(), Key: khoa }));
    return true;
  } catch {
    return false;
  }
}

export async function xacMinhTepHoaDon(input: { khoa: string; loai: LoaiTep }): Promise<KetQuaXacMinh> {
  const s3 = getR2Client();
  const Bucket = getHoaDonBucket();
  let co: number;
  try {
    const dau = await s3.send(new HeadObjectCommand({ Bucket, Key: input.khoa }));
    co = Number(dau.ContentLength ?? NaN);
  } catch {
    return { ok: false, ma: "KHONG_THAY", thongDiep: "Không thấy tệp trên kho — tải lên lại" };
  }
  if (!Number.isFinite(co)) {
    return { ok: false, ma: "KHONG_THAY", thongDiep: "Không đọc được cỡ tệp — tải lên lại" };
  }
  if (co > TRAN_CO_TEP[input.loai]) {
    await xoaTepHoaDon(input.khoa).catch(() => undefined);
    const mb = Math.round(TRAN_CO_TEP[input.loai] / 1024 / 1024);
    return { ok: false, ma: "QUA_LON", thongDiep: `Tệp vượt ${mb} MB` };
  }

  let than: Uint8Array;
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket, Key: input.khoa }));
    than = (await r.Body?.transformToByteArray()) ?? new Uint8Array();
  } catch {
    return { ok: false, ma: "KHONG_THAY", thongDiep: "Không đọc được tệp trên kho — tải lên lại" };
  }
  if (than.length === 0 || !vanTayHoaDon(input.loai, than)) {
    await xoaTepHoaDon(input.khoa).catch(() => undefined);
    return {
      ok: false,
      ma: "SAI_LOAI",
      thongDiep: input.loai === "pdf" ? "Tệp không phải PDF" : "Tệp không phải XML",
    };
  }
  return { ok: true, co: than.length, sha256: createHash("sha256").update(than).digest("hex") };
}

/**
 * Bước 1 MISA (30/09) — GHI tệp hệ thống tự tải từ MISA vào kho hoá đơn. CÙNG quy ước với luồng tải lên:
 * khoá `khoaTepHoaDon` (người gọi dựng), trần cỡ `TRAN_CO_TEP`, vân tay `vanTayHoaDon`, sha256 — nên
 * route tải về, lưới trùng tệp và cron dọn mồ côi đọc hai nguồn như nhau. Tin BYTE MISA trả, không tin
 * nhãn: sai loại / quá cỡ ⇒ `ok: false` và KHÔNG ghi gì vào kho.
 */
export async function luuTepHoaDon(input: {
  khoa: string;
  loai: LoaiTep;
  than: Uint8Array;
}): Promise<{ ok: true; co: number; sha256: string } | { ok: false; thongDiep: string }> {
  const { khoa, loai, than } = input;
  if (than.length === 0 || !vanTayHoaDon(loai, than)) {
    return { ok: false, thongDiep: loai === "pdf" ? "Tệp MISA trả về không phải PDF" : "Tệp MISA trả về không phải XML" };
  }
  if (than.length > TRAN_CO_TEP[loai]) return { ok: false, thongDiep: "Tệp MISA trả về vượt trần cỡ" };
  await getR2Client().send(
    new PutObjectCommand({ Bucket: getHoaDonBucket(), Key: khoa, Body: than, ContentType: MIME_TEP[loai] }),
  );
  return { ok: true, co: than.length, sha256: createHash("sha256").update(than).digest("hex") };
}
