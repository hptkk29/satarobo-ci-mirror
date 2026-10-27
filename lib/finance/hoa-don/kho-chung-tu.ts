import "server-only";
import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client } from "@/lib/storage/r2-client";
import { getHoaDonBucket, xoaTepHoaDon } from "./kho-tep";
import { laLoaiTepChungTu, MIME_TEP_CHUNG_TU, TRAN_CO_TEP_CHUNG_TU, vanTayChungTu, type LoaiTepChungTu } from "./chung-tu-ngan-hang";

// lib/finance/hoa-don/kho-chung-tu.ts — KHO TỆP CHỨNG TỪ NGÂN HÀNG (P7-E, 06/11/2026).
//
// Dùng LẠI đúng kho riêng của hoá đơn (`getHoaDonBucket`: bucket riêng, getter NÉM khi trùng bucket công khai `cdn.satarobo.vn` — tệp
// sao kê mang số tài khoản, tên người chuyển nên TUYỆT ĐỐI không để vô danh), tiền tố riêng `chung-tu-ngan-hang/`. Tải lên theo ba bước như
// hoá đơn: ký URL PUT (server) → trình duyệt PUT thẳng R2 → server XÁC MINH BYTE. Tải về: URL GET ký 300 giây, người gọi ghi audit TRƯỚC.
// Luật khoá/hình dạng/vân tay nằm ở `chung-tu-ngan-hang.ts` (thuần, có test); tệp này chỉ nói chuyện với R2.

/** Mime ký vào URL PUT. CHỈ ký `ContentType` (ký thêm checksum/độ dài mà trình duyệt không gửi đúng thì R2 trả 403 như lỗi CORS). */
export async function kyUrlTaiLenChungTu(khoa: string, loai: LoaiTepChungTu, ttlGiay: number): Promise<string> {
  const cmd = new PutObjectCommand({ Bucket: getHoaDonBucket(), Key: khoa, ContentType: MIME_TEP_CHUNG_TU[loai] });
  return getSignedUrl(getR2Client(), cmd, { expiresIn: ttlGiay });
}

/** URL GET ký sẵn, tải về ĐÚNG tên tệp (attachment — không cho trình duyệt mở inline trong trang admin). TTL BẮT BUỘC. */
export async function kyUrlTaiVeChungTu(khoa: string, tenTep: string, ttlGiay: number): Promise<string> {
  const ascii = tenTep.replace(/[^A-Za-z0-9._-]/g, "_");
  const cmd = new GetObjectCommand({
    Bucket: getHoaDonBucket(),
    Key: khoa,
    ResponseContentDisposition: `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(tenTep)}`,
  });
  return getSignedUrl(getR2Client(), cmd, { expiresIn: ttlGiay });
}

export type KetQuaXacMinhChungTu =
  | { ok: true; co: number; sha256: string }
  | { ok: false; ma: "KHONG_THAY" | "QUA_LON" | "SAI_LOAI"; thongDiep: string };

/**
 * Xác minh tệp trình duyệt vừa PUT: HEAD lấy cỡ THẬT → chặn trần (chưa đọc thân) → GET toàn thân → vân tay → sha256. Quá lớn / sai loại
 * thì DỌN tệp khỏi kho (không để rác mang số tài khoản nằm lại). Người gọi PHẢI đã kiểm `khoaThuocKhoan` trước.
 */
export async function xacMinhTepChungTu(input: { khoa: string; loai: LoaiTepChungTu }): Promise<KetQuaXacMinhChungTu> {
  if (!laLoaiTepChungTu(input.loai)) return { ok: false, ma: "SAI_LOAI", thongDiep: "Loại tệp không hợp lệ" };
  const s3 = getR2Client();
  const Bucket = getHoaDonBucket();
  let co: number;
  try {
    const dau = await s3.send(new HeadObjectCommand({ Bucket, Key: input.khoa }));
    co = Number(dau.ContentLength ?? NaN);
  } catch {
    return { ok: false, ma: "KHONG_THAY", thongDiep: "Không thấy tệp trên kho — tải lên lại" };
  }
  if (!Number.isFinite(co)) return { ok: false, ma: "KHONG_THAY", thongDiep: "Không đọc được cỡ tệp — tải lên lại" };
  if (co > TRAN_CO_TEP_CHUNG_TU) {
    await xoaTepHoaDon(input.khoa).catch(() => undefined);
    return { ok: false, ma: "QUA_LON", thongDiep: `Tệp vượt ${Math.round(TRAN_CO_TEP_CHUNG_TU / 1024 / 1024)} MB` };
  }
  let than: Uint8Array;
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket, Key: input.khoa }));
    than = (await r.Body?.transformToByteArray()) ?? new Uint8Array();
  } catch {
    return { ok: false, ma: "KHONG_THAY", thongDiep: "Không đọc được tệp trên kho — tải lên lại" };
  }
  if (than.length === 0 || !vanTayChungTu(input.loai, than)) {
    await xoaTepHoaDon(input.khoa).catch(() => undefined);
    return { ok: false, ma: "SAI_LOAI", thongDiep: `Tệp không phải ${input.loai.toUpperCase()} hợp lệ` };
  }
  return { ok: true, co: than.length, sha256: createHash("sha256").update(than).digest("hex") };
}
