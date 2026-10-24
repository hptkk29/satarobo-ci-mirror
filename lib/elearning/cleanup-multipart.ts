import "server-only";
import { ListMultipartUploadsCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getR2Client } from "@/lib/storage/r2-client";
import { getElearningBucket } from "@/lib/storage/elearning-storage";

/**
 * EL-10 việc (6) — HUỶ CÁC LƯỢT TẢI NHIỀU PHẦN BỎ DỞ.
 *
 * Một lượt bị bỏ giữa chừng (đóng tab, mất mạng) để lại các phần đã tải trên R2
 * VĨNH VIỄN. R2 tính tiền chúng, và `ListObjectsV2` KHÔNG thấy chúng — chỉ
 * `ListMultipartUploads` mới thấy. Nên đây là loại rác không ai phát hiện bằng
 * mắt, chỉ thấy trên hoá đơn.
 *
 * ⚠️ Quyết định "huỷ cái nào" nằm ở hàm THUẦN `chonTaiDoDeHuy` (đã có test);
 * ở đây chỉ có phần gọi mạng. Hàm nhận bộ chọn qua tham số để test được cả nhánh
 * chưa cấu hình mà không phải giả lập AWS SDK.
 */
export type KetQuaDonTaiDo = { daHuy: number; conGiu: number } | { chuaLamDuoc: string };

type BoChon = <T extends { key: string; initiated: Date | null }>(
  ds: T[],
  moc: Date,
) => { huy: T[]; giu: T[] };

export async function donTaiDo(boChon: BoChon, moc: Date): Promise<KetQuaDonTaiDo> {
  let bucket: string;
  try {
    bucket = getElearningBucket();
  } catch {
    // Chưa cấu hình bucket là trạng thái BÌNH THƯỜNG trước ngày bật module —
    // nói ra thay vì trả 0, vì 0 đọc thành "đã quét và không có gì".
    return { chuaLamDuoc: "R2_ELEARNING_BUCKET_NAME chưa cấu hình" };
  }

  const s3 = getR2Client();
  let daHuy = 0;
  let conGiu = 0;
  let keyMarker: string | undefined;
  let idMarker: string | undefined;

  // Quét theo trang, có trần vòng lặp: một bucket rác nặng không được làm cron
  // đêm chạy vô hạn.
  for (let trang = 0; trang < 20; trang += 1) {
    const kq = await s3.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        Prefix: "elearning/",
        KeyMarker: keyMarker,
        UploadIdMarker: idMarker,
      }),
    );
    const ds = (kq.Uploads ?? []).map((u) => ({
      key: u.Key ?? "",
      initiated: u.Initiated ?? null,
      uploadId: u.UploadId ?? "",
    }));

    const { huy, giu } = boChon(ds, moc);
    conGiu += giu.length;

    for (const u of huy) {
      if (!u.uploadId) continue;
      try {
        await s3.send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: u.key,
            UploadId: u.uploadId,
          }),
        );
        daHuy += 1;
      } catch {
        // Một lượt huỷ hỏng không được làm chết cả vòng quét — lần sau quét lại
        // vẫn thấy nó.
        conGiu += 1;
      }
    }

    if (!kq.IsTruncated) break;
    keyMarker = kq.NextKeyMarker;
    idMarker = kq.NextUploadIdMarker;
  }

  return { daHuy, conGiu };
}
