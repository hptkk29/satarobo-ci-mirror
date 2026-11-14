import "server-only";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getHoaDonBucket } from "@/lib/finance/hoa-don/kho-tep";
import { getR2Client } from "@/lib/storage/r2-client";

/**
 * URL GET ký sẵn để XEM tệp PDF hoá đơn ngay trong trình duyệt (tab mới) — KHÔNG ép tải.
 *
 * `kyUrlTaiVeHoaDon` (lib/finance/hoa-don/kho-tep.ts) cố ý đặt `attachment` nên không dùng cho «Xem»; hàm này ký cùng bucket riêng
 * (`getHoaDonBucket`, KHÔNG dùng bucket công khai) với `inline` + `application/pdf`. TTL BẮT BUỘC (luật 7). Người gọi phải ghi
 * audit TRƯỚC khi gọi hàm này và đã kiểm `khoHoaDonDaCauHinh()`.
 */
export async function kyUrlXemPdfHoaDon(khoa: string, ttlGiay: number): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: getHoaDonBucket(),
    Key: khoa,
    ResponseContentDisposition: "inline",
    ResponseContentType: "application/pdf",
  });
  return getSignedUrl(getR2Client(), cmd, { expiresIn: ttlGiay });
}
