import "server-only";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, r2DaCauHinh } from "@/lib/storage/r2-client";
import { bucketTuSachHopLe, getTuSachBucket } from "./bucket-pdf";
import type { KhoTep } from "./tai";

/**
 * Kho R2 thật cho `xinLinkTai` — bucket RIÊNG `R2_TU_SACH_BUCKET_NAME` (không công khai; xem `bucket-pdf.ts`).
 * Chưa đặt / trùng bucket khác ⇒ `daCauHinh()` = false ⇒ «đang cập nhật» (KHÔNG lùi về bucket công khai).
 * Link ký ép tải về (`attachment`) với tên tệp ASCII an toàn.
 */
export const khoTepR2: KhoTep = {
  daCauHinh: () => bucketTuSachHopLe() && r2DaCauHinh(),
  async tonTai(khoa) {
    try {
      await getR2Client().send(new HeadObjectCommand({ Bucket: getTuSachBucket(), Key: khoa }));
      return true;
    } catch (err) {
      const ma = (err as { $metadata?: { httpStatusCode?: number }; name?: string }).$metadata?.httpStatusCode;
      if (ma === 404 || (err as { name?: string }).name === "NotFound") return false;
      throw err;
    }
  },
  kyLinkTai(khoa, tenTep, ttlGiay) {
    const lenh = new GetObjectCommand({
      Bucket: getTuSachBucket(),
      Key: khoa,
      ResponseContentType: "application/pdf",
      ResponseContentDisposition: `attachment; filename="${tenTep}"`,
    });
    return getSignedUrl(getR2Client(), lenh, { expiresIn: ttlGiay });
  },
};
