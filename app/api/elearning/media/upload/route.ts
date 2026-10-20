import { type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { ok, fail } from "@/lib/api/response";
import { rateLimit } from "@/lib/rate-limit";
import { getR2Client } from "@/lib/storage/r2-client";
import { getElearningBucket } from "@/lib/storage/elearning-storage";
import { khoaMedia, kiemChuanNopVideo } from "@/lib/elearning/media-rules";
import { chiaPhan, ghepPhan, hanLinkKy } from "@/lib/elearning/multipart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// EL-10 — TẢI VIDEO NHIỀU PHẦN lên R2 bằng link ký.
//
// Bốn bước của giao thức S3: Create → (ký link cho từng Part) → Complete/Abort.
// Trình duyệt PUT thẳng lên R2, máy chủ không bao giờ thấy byte nào — đó là cách
// duy nhất tải được tệp 200MB qua Vercel (trần body ~4.5MB).
//
// ⚠️ Hệ quả của presign: máy chủ KHÔNG kiểm được codec ở bước này. Con số trình
// duyệt khai chỉ chặn sớm những trường hợp rõ ràng sai. Xác minh THẬT làm sau khi
// Complete, bằng cách đọc header mp4 (`lib/elearning/mp4-probe.ts`) — chốt 24/08.
//
// ⚠️ Có `rateLimit`: đây là đường tốn băng thông và tốn tiền lưu trữ.

const taoSchema = z.object({
  buoc: z.literal("tao"),
  lessonId: z.string().min(1),
  filename: z.string().min(1),
  mime: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  durationSec: z.union([z.null(), z.number().positive()]).optional(),
  /**
   * Độ phân giải trình duyệt đọc được. Như `durationSec`, đây là con số CHẶN SỚM
   * chứ không phải bằng chứng — bước xác minh đọc lại từ tệp.
   */
  rong: z.union([z.null(), z.number().int().positive()]).optional(),
  cao: z.union([z.null(), z.number().int().positive()]).optional(),
});

const kySchema = z.object({
  buoc: z.literal("ky-phan"),
  khoa: z.string().min(1),
  uploadId: z.string().min(1),
  soPhan: z.number().int().min(1).max(10_000),
});

const xongSchema = z.object({
  buoc: z.literal("hoan-tat"),
  khoa: z.string().min(1),
  uploadId: z.string().min(1),
  parts: z
    .array(z.object({ partNumber: z.number().int(), etag: z.string().min(1) }))
    .min(1),
});

const huySchema = z.object({
  buoc: z.literal("huy"),
  khoa: z.string().min(1),
  uploadId: z.string().min(1),
});

const schema = z.discriminatedUnion("buoc", [taoSchema, kySchema, xongSchema, huySchema]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return fail("UNAUTHENTICATED", "Chưa đăng nhập", { status: 401 });
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:content:author")) {
    return fail("PERMISSION_DENIED", "Không có quyền tải nội dung", { status: 403 });
  }

  const gioiHan = await rateLimit({
    key: `el-media-upload:${session.user.id}`,
    max: 120,
    windowMs: 60 * 60 * 1000,
  });
  if (!gioiHan.success) {
    return fail("RATE_LIMITED", "Tải quá nhiều lần, thử lại sau ít phút", { status: 429 });
  }

  let than: unknown;
  try {
    than = await req.json();
  } catch {
    return fail("VALIDATION", "Nội dung gửi lên không hợp lệ");
  }
  const parsed = schema.safeParse(than);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail("VALIDATION", i?.message ?? "Dữ liệu không hợp lệ", {
      field: i?.path.join("."),
    });
  }
  const input = parsed.data;

  let bucket: string;
  try {
    bucket = getElearningBucket();
  } catch {
    return fail("STORAGE_UNCONFIGURED", "Kho media chưa được cấu hình", { status: 503 });
  }
  const s3 = getR2Client();

  if (input.buoc === "tao") {
    // Chặn SỚM những gì kiểm được mà không cần byte: dung lượng, đuôi, mime, và
    // thời lượng trình duyệt khai.
    const chuan = kiemChuanNopVideo({
      filename: input.filename,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      durationSec: input.durationSec ?? null,
      rong: input.rong ?? null,
      cao: input.cao ?? null,
    });
    if (!chuan.ok) return fail(chuan.code, chuan.message, { field: "filename" });

    const chia = chiaPhan(input.sizeBytes);
    if ("loi" in chia) {
      return fail("QUA_LON", "Tệp quá lớn để chia phần — nén lại rồi thử lại");
    }

    const khoa = khoaMedia({
      lessonId: input.lessonId,
      loai: "master",
      uuid: randomUUID(),
    });
    const kq = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: khoa,
        ContentType: input.mime,
      }),
    );

    return ok({
      khoa,
      uploadId: kq.UploadId,
      soPhan: chia.soPhan,
      partSize: chia.partSize,
      hanGiay: hanLinkKy({ soPhan: chia.soPhan }),
    });
  }

  if (input.buoc === "ky-phan") {
    const han = hanLinkKy({ soPhan: input.soPhan });
    const links: { partNumber: number; url: string }[] = [];
    for (let n = 1; n <= input.soPhan; n += 1) {
      links.push({
        partNumber: n,
        url: await getSignedUrl(
          s3,
          new UploadPartCommand({
            Bucket: bucket,
            Key: input.khoa,
            UploadId: input.uploadId,
            PartNumber: n,
          }),
          { expiresIn: han },
        ),
      });
    }
    return ok({ links, hanGiay: han });
  }

  if (input.buoc === "hoan-tat") {
    // ⚠️ SẮP LẠI và kiểm liên tục TRƯỚC khi gọi R2. Gửi phần sai thứ tự hoặc
    // thiếu một phần ở giữa thì R2 vẫn ghép và trả về một mp4 hợp lệ về cấu trúc
    // nhưng hỏng nội dung — không lỗi nào nổ ra.
    const ghep = ghepPhan(input.parts);
    if (!ghep.ok) return fail(ghep.code, ghep.message, { field: "parts" });

    const kq = await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: input.khoa,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: ghep.parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );

    // Xác minh THẬT (codec + thời lượng) là bước riêng, không làm ở đây: nó cần
    // đọc lại tệp bằng Range và có thể phải đọc tới đuôi tệp.
    return ok({ khoa: input.khoa, etag: kq.ETag ?? null, canXacMinh: true });
  }

  await s3.send(
    new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: input.khoa,
      UploadId: input.uploadId,
    }),
  );
  return ok({ daHuy: true });
}
