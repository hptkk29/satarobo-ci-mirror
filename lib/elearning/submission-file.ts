import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client } from "@/lib/storage/r2-client";
import { getElearningBucket } from "@/lib/storage/elearning-storage";
import {
  NOP_MAX_BYTES,
  NOP_MAX_TEP,
  mimeDuocNhan,
  tienToKhoaBaiNop,
  khoaThuocLuotNop,
  vanTayKhop,
} from "@/lib/elearning/submission-file-rules";

/**
 * EL-15c — TỆP ĐÍNH KÈM của lượt nộp: ký URL và xác minh.
 *
 * ⚠️ ĐƯỜNG TẢI RIÊNG, không dùng lại `app/api/elearning/media/upload`. Route đó
 * đòi `elearning:content:author`, mà hai vai PHẢI nộp bài (`TEACHER`,
 * `CENTER_SALES_CSM`) chỉ có `portal:access` + `lesson:learn` + `progress:view-own`.
 * Hai lối vá đều bị cấm: cấp `content:author` cho giáo viên là mở quyền biên soạn
 * khoá cho toàn bộ giáo viên; đẻ khoá thứ 18 là đỏ CI.
 *
 * ⚠️ Dùng PUT MỘT LẦN, không multipart. Trần 300MB nằm gọn trong giới hạn của một
 * lượt PUT, và multipart kéo theo cả một vòng đời (tạo/ký từng phần/hoàn tất/dọn
 * dở) — mỗi bước là một chỗ hỏng nữa, cho một thứ người học chỉ làm vài lần.
 */

export const kyTepSchema = z
  .object({
    submissionId: z.string().min(1),
    tenTep: z.string().trim().min(1).max(200),
    mime: z.string().trim().min(1).max(100),
    size: z.number().int().min(1),
  })
  .strict();

export type KyTepInput = z.infer<typeof kyTepSchema>;

export type LoiKyTep =
  | { ma: "MIME_KHONG_NHAN"; noi: string }
  | { ma: "QUA_LON"; noi: string }
  | { ma: "QUA_NHIEU_TEP"; noi: string };

/**
 * Kiểm một tệp TRƯỚC khi ký URL — thuần, không chạm mạng.
 *
 * ⚠️ Kiểm ở đây là kiểm SỚM cho người dùng, KHÔNG phải cổng an toàn: `size` và
 * `mime` do phía tải lên tự khai. Cổng thật là bước XÁC MINH sau khi tệp đã nằm
 * trên kho (`xacMinhTep`), nơi đọc kích thước thật và vân tay thật.
 */
export function kiemTepTruocKhiKy(input: {
  mime: string;
  size: number;
  soTepHienCo: number;
}): LoiKyTep | null {
  if (!mimeDuocNhan(input.mime)) {
    return {
      ma: "MIME_KHONG_NHAN",
      noi: "Chỉ nhận video MP4, ghi âm MP3/M4A, hoặc PDF",
    };
  }
  if (input.size > NOP_MAX_BYTES) {
    return {
      ma: "QUA_LON",
      noi: `Tệp tối đa ${Math.round(NOP_MAX_BYTES / 1024 / 1024)}MB`,
    };
  }
  if (input.soTepHienCo >= NOP_MAX_TEP) {
    return {
      ma: "QUA_NHIEU_TEP",
      noi: `Mỗi lượt nộp tối đa ${NOP_MAX_TEP} tệp`,
    };
  }
  return null;
}

/**
 * Khoá trên kho cho một tệp.
 *
 * ⚠️ Tên tệp người dùng KHÔNG đi vào khoá. Nó có thể chứa dấu gạch chéo, ký tự
 * điều khiển, hay tên của một người (`ghi-am-chi-Lan-0905xxx.mp3`) — và khoá thì
 * hiện trong URL đã ký. Giữ tên gốc ở cột dữ liệu, không giữ trong đường dẫn.
 *
 * ⚠️ KHÔNG dùng SỐ THỨ TỰ. Bản đầu lấy `dsTep.length` làm số, và nó va nhau ở ba ca
 * đều xảy ra thật:
 *  · hai tab cùng đính tệp ⇒ cùng đọc `length = 0` ⇒ CÙNG một khoá ⇒ tệp sau ĐÈ tệp
 *    trước trên kho, còn sổ ghi tên và kích thước của tệp trước;
 *  · một lượt tải hỏng giữa chừng rồi thử lại ⇒ lặp lại đúng khoá cũ;
 *  · ngày nào có đường XOÁ tệp thì `length` tụt xuống và khoá quay vòng.
 *
 * Chuỗi ngẫu nhiên không có ca nào trong ba ca đó. Nó không cần đoán được — sổ trong
 * `attachmentsJson` là thứ giữ danh sách, không phải quy tắc đặt tên.
 */
export function khoaChoTep(submissionId: string, mime: string): string {
  const rieng = randomBytes(12).toString("hex");
  return `${tienToKhoaBaiNop(submissionId)}${rieng}.${duoiChuan(mime)}`;
}

/** Đuôi tệp theo loại — `audio/mp4` là `.m4a`, không phải `.mp4`. */
function duoiChuan(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "audio/mpeg") return "mp3";
  if (mime === "audio/mp4") return "m4a";
  return "mp4";
}

/**
 * URL đã ký để TẢI LÊN.
 *
 * Chỉ ký `Content-Type` — xem chú thích ở `chat-storage`: header đã-ký-nhưng-không-
 * gửi làm R2 trả 403.
 *
 * ⚠️ URL này KHÔNG ràng buộc được dung lượng. Nghĩa là một tệp quá cỡ vẫn LÊN ĐƯỢC
 * kho; bước `xacMinhTep` sẽ từ chối GHI SỔ nó, nhưng byte đã nằm đó. Đó là lý do có
 * `xoaTepTrenKho` ngay dưới, và là lý do bước "xong" phải dọn khi từ chối — không
 * dọn thì kho tích dần những tệp không ai biết là của ai.
 */
export async function kyUrlTaiLen(
  khoa: string,
  mime: string,
  ttlSeconds = 900,
): Promise<string> {
  return getSignedUrl(
    getR2Client(),
    new PutObjectCommand({
      Bucket: getElearningBucket(),
      Key: khoa,
      ContentType: mime,
    }),
    { expiresIn: ttlSeconds },
  );
}

/**
 * XOÁ một tệp khỏi kho.
 *
 * ⚠️ Dùng khi bước xác minh TỪ CHỐI: tệp đã nằm trên kho rồi, và nội dung ở đây có
 * thể là video lớp học hay ghi âm phụ huynh (§13.3). Để lại một tệp bị từ chối là
 * giữ dữ liệu của người thứ ba mà không sổ nào ghi nhận nó tồn tại.
 */
export async function xoaTepTrenKho(khoa: string): Promise<void> {
  await getR2Client().send(
    new DeleteObjectCommand({ Bucket: getElearningBucket(), Key: khoa }),
  );
}

/**
 * URL đã ký để TẢI VỀ.
 *
 * ⚠️ Chỗ gọi PHẢI tự kiểm quyền trước. Hàm này không biết ai đang hỏi — nó chỉ ký.
 * Người chấm cần đọc được tệp của người khác (đó là việc của họ), nên không thể
 * dùng lại vé của EL-10 vốn buộc `ve.userId === session.user.id`.
 */
export async function kyUrlTaiVe(khoa: string, ttlSeconds = 600): Promise<string> {
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: getElearningBucket(), Key: khoa }),
    { expiresIn: ttlSeconds },
  );
}

export type KetQuaXacMinh =
  | { ok: true; size: number }
  | { ok: false; ma: "KHONG_THAY" | "QUA_LON" | "SAI_LOAI"; noi: string };

/**
 * XÁC MINH tệp SAU khi đã nằm trên kho — đây mới là cổng thật.
 *
 * ⚠️ Đọc kích thước THẬT và VÂN TAY THẬT. `size`/`mime` ở bước ký là lời khai của
 * phía tải lên; tin nó là để một tệp 3GB hay một tệp thực thi đặt tên `.mp4` nằm
 * trong kho và được phát ra cho người chấm tải về.
 *
 * ⚠️ Đọc ĐÚNG 16 byte đầu bằng `Range`, không tải cả tệp. Kéo nguyên một video
 * 300MB về máy chủ chỉ để xem 4 byte là đốt băng thông và giữ một khe socket lâu
 * hơn cần thiết.
 */
export async function xacMinhTep(input: {
  khoa: string;
  submissionId: string;
  mime: string;
}): Promise<KetQuaXacMinh> {
  if (!khoaThuocLuotNop(input.khoa, input.submissionId)) {
    return { ok: false, ma: "KHONG_THAY", noi: "Tệp không thuộc lượt nộp này" };
  }

  let than: import("@aws-sdk/client-s3").GetObjectCommandOutput;
  try {
    than = await getR2Client().send(
      new GetObjectCommand({
        Bucket: getElearningBucket(),
        Key: input.khoa,
        Range: "bytes=0-15",
      }),
    );
  } catch {
    return { ok: false, ma: "KHONG_THAY", noi: "Chưa thấy tệp trên kho" };
  }

  // `ContentRange` dạng `bytes 0-15/12345` — phần sau dấu `/` là kích thước THẬT.
  //
  // ⚠️ KHÔNG đọc được thì TỪ CHỐI, đừng cho qua. Bản đầu chỉ chặn khi
  // `Number.isFinite(dai)` — tức một phản hồi thiếu `ContentRange` sẽ bỏ QUA trần
  // dung lượng hoàn toàn, và đó đúng là ca người ta sẽ tìm ra nếu muốn nhét một tệp
  // 3GB vào kho.
  const dai = Number(String(than.ContentRange ?? "").split("/")[1] ?? NaN);
  if (!Number.isFinite(dai)) {
    return {
      ok: false,
      ma: "KHONG_THAY",
      noi: "Không đọc được kích thước tệp trên kho — thử tải lại",
    };
  }
  if (dai > NOP_MAX_BYTES) {
    return {
      ok: false,
      ma: "QUA_LON",
      noi: `Tệp tối đa ${Math.round(NOP_MAX_BYTES / 1024 / 1024)}MB`,
    };
  }

  const buf = await than.Body?.transformToByteArray();
  if (!buf || !vanTayKhop(input.mime, buf)) {
    return {
      ok: false,
      ma: "SAI_LOAI",
      noi: "Nội dung tệp không khớp loại đã khai — tải lại đúng tệp",
    };
  }

  return { ok: true, size: dai };
}
