import { type NextRequest } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { ok, fail } from "@/lib/api/response";
import { getR2Client } from "@/lib/storage/r2-client";
import { getElearningBucket } from "@/lib/storage/elearning-storage";
import { docMp4, kiemCodec, THONG_BAO_CODEC } from "@/lib/elearning/mp4-probe";
import { kiemChuanNopVideo } from "@/lib/elearning/media-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// EL-10 — XÁC MINH TỆP VIDEO SAU KHI TẢI XONG (chốt 24/08).
//
// Presign nghĩa là máy chủ không thấy byte nào lúc tải, nên codec và thời lượng
// THẬT chỉ đọc được ở đây: tải vài chục KB bằng Range và đọc cây hộp MP4.
//
// ⚠️ Hộp `moov` có thể ở ĐẦU hoặc ở CUỐI tệp. Bộ đọc trả về "cần đọc thêm ở đâu"
// và vòng lặp dưới đi theo; bỏ nhánh đuôi là báo "tệp hỏng" cho mọi tệp xuất ra
// không bật fast-start.
//
// ⚠️ Trần 6 lượt đọc: một tệp dị dạng không được làm hàm chạy mãi.
const TRAN_LUOT_DOC = 6;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return fail("UNAUTHENTICATED", "Chưa đăng nhập", { status: 401 });
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:content:author")) {
    return fail("PERMISSION_DENIED", "Không có quyền", { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const khoa = sp.get("khoa");
  const lessonId = sp.get("lessonId");
  if (!khoa || !lessonId) {
    return fail("VALIDATION", "Thiếu ?khoa= hoặc ?lessonId=");
  }
  // Khoá đến từ thanh địa chỉ — chỉ cho đọc tệp của đúng bài đang soạn.
  if (!khoa.startsWith(`elearning/master/${lessonId}/`) || khoa.includes("..")) {
    return fail("NOT_FOUND", "Không tìm thấy tệp", { status: 404 });
  }

  let bucket: string;
  try {
    bucket = getElearningBucket();
  } catch {
    return fail("STORAGE_UNCONFIGURED", "Kho media chưa được cấu hình", { status: 503 });
  }
  const s3 = getR2Client();

  const docKhoang = async (tu: number, dai: number) => {
    const r = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: khoa,
        Range: `bytes=${tu}-${tu + dai - 1}`,
      }),
    );
    const b = await (r.Body as { transformToByteArray: () => Promise<Uint8Array> })
      .transformToByteArray();
    const coTep = Number(r.ContentRange?.split("/")[1] ?? 0);
    return { b, coTep };
  };

  // ⚠️ `transformToByteArray` ĐƯỢC dùng ở ĐÂY, khác đường phát: mỗi lượt chỉ đọc
  // vài chục KB đến tối đa 4MB, có trần, và không nằm trên đường người học xem.
  let tu = 0;
  let dai = 65536;
  let coTep = 0;
  let kq: ReturnType<typeof docMp4> | null = null;

  try {
    for (let i = 0; i < TRAN_LUOT_DOC; i += 1) {
      const { b, coTep: c } = await docKhoang(tu, dai);
      if (c) coTep = c;
      kq = docMp4(b, tu, coTep);
      if (kq.xong || "loi" in kq) break;
      tu = kq.canDoc.tu;
      dai = Math.min(kq.canDoc.dai, 4 * 1024 * 1024);
    }
  } catch {
    return fail("NOT_FOUND", "Không đọc được tệp vừa tải", { status: 404 });
  }

  if (!kq || !kq.xong) {
    const ma = kq && "loi" in kq ? kq.loi : "HONG";
    return fail(
      ma,
      ma === "KHONG_PHAI_MP4"
        ? "Tệp không phải MP4 thật — đổi tên đuôi tệp không làm nó thành MP4"
        : "Không đọc được thông tin video trong tệp — thử xuất lại tệp",
    );
  }

  const codec = kiemCodec(kq);
  if (!codec.ok) return fail(codec.code, THONG_BAO_CODEC[codec.code]);

  // Đối chiếu LẠI chuẩn nộp bằng con số THẬT. Bước mở lượt tải dùng con số trình
  // duyệt khai — nó có thể sai, hoặc bị sửa.
  const chuan = kiemChuanNopVideo({
    filename: "x.mp4",
    mime: "video/mp4",
    sizeBytes: coTep,
    durationSec: kq.durationSec,
    // Độ phân giải đọc TỪ TỆP. Truyền `null` ở đây là bỏ qua trần 720p — mà trần
    // đó tồn tại vì hệ KHÔNG hạ cỡ hộ: tệp nộp lên chính là tệp người học tải về.
    rong: kq.rong,
    cao: kq.cao,
  });
  if (!chuan.ok) return fail(chuan.code, chuan.message);

  return ok({
    durationSec: kq.durationSec,
    rong: kq.rong,
    cao: kq.cao,
    videoCodec: kq.videoCodec,
    audioCodec: kq.audioCodec,
    brand: kq.brand,
    sizeBytes: coTep,
  });
}
