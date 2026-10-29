import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { rateLimit } from "@/lib/rate-limit";
import {
  kiemTepTruocKhiKy,
  khoaChoTep,
  kyUrlTaiLen,
  xacMinhTep,
  xoaTepTrenKho,
} from "@/lib/elearning/submission-file";
import { NOP_MAX_TEP } from "@/lib/elearning/submission-file-rules";
import { ok, fail } from "@/lib/api/response";

/**
 * EL-15c — TỆP ĐÍNH KÈM của lượt nộp bài tập.
 *
 * ⚠️ ROUTE RIÊNG cho NGƯỜI HỌC. `app/api/elearning/media/upload` đòi
 * `elearning:content:author` — quyền biên soạn nội dung — mà `TEACHER` và
 * `CENTER_SALES_CSM`, đúng hai vai §13.3 bắt nộp video/ghi âm, không có nó. Nới
 * route kia là cấp quyền biên soạn khoá cho toàn bộ giáo viên.
 *
 * ⚠️ Quyền `elearning:lesson:learn` là "được học", KHÔNG phải "học thay người
 * khác": mọi bước ở đây còn kiểm CHÍNH CHỦ của lượt nộp.
 *
 * Hai bước: `ky` (lấy URL tải lên) rồi `xong` (xác minh tệp đã nằm trên kho, rồi
 * mới ghi vào lượt nộp). Không có bước hai thì cột `attachmentsJson` ghi lời khai
 * của phía tải lên chứ không ghi sự thật.
 */

export const runtime = "nodejs";

const kySchema = z.object({
  buoc: z.literal("ky"),
  submissionId: z.string().min(1),
  tenTep: z.string().trim().min(1).max(200),
  mime: z.string().trim().min(1).max(100),
  size: z.number().int().min(1),
});

const xongSchema = z.object({
  buoc: z.literal("xong"),
  submissionId: z.string().min(1),
  khoa: z.string().min(1).max(500),
  tenTep: z.string().trim().min(1).max(200),
  mime: z.string().trim().min(1).max(100),
});

const schema = z.discriminatedUnion("buoc", [kySchema, xongSchema]);

type TepDinhKem = { key: string; name: string; mime: string; size: number };

/** Phong bì chuẩn EL-07/C23: mọi lỗi mang `requestId` để nối được với log. */
const loi = (code: string, message: string, status = 400) =>
  fail(code, message, { status });

/** Đọc `attachmentsJson` — cột khai `Json` nên KHÔNG ép kiểu, phải parse. */
function docTep(raw: unknown): TepDinhKem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is TepDinhKem =>
      typeof x === "object" &&
      x !== null &&
      typeof (x as TepDinhKem).key === "string" &&
      typeof (x as TepDinhKem).mime === "string",
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return loi("UNAUTHENTICATED", "Chưa đăng nhập", 401);

  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:lesson:learn")) {
    return loi("PERMISSION_DENIED", "Không có quyền nộp bài", 403);
  }

  const gioiHan = await rateLimit({
    key: `el-nop-tep:${session.user.id}`,
    max: 60,
    windowMs: 60 * 60 * 1000,
  });
  if (!gioiHan.success) {
    return loi("RATE_LIMITED", "Tải quá nhiều lần, thử lại sau ít phút", 429);
  }

  let than: unknown;
  try {
    than = await req.json();
  } catch {
    return loi("VALIDATION", "Nội dung gửi lên không hợp lệ");
  }
  const parsed = schema.safeParse(than);
  if (!parsed.success) {
    return loi("VALIDATION", parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
  }
  const input = parsed.data;

  const db = scopedDb(actor);
  const lan = await db.trnSubmission.findFirst({
    where: { id: input.submissionId },
    select: {
      id: true,
      userId: true,
      status: true,
      attachmentsJson: true,
    },
  });
  if (!lan) return loi("NOT_FOUND", "Không tìm thấy lượt nộp", 404);

  // ⚠️ CHÍNH CHỦ. Thiếu bước này thì bất kỳ ai có quyền học đều đính tệp vào lượt
  // nộp của người khác — và tệp đó sẽ được chấm như bài của họ.
  if (lan.userId !== session.user.id) {
    return loi("FORBIDDEN", "Đây không phải bài nộp của bạn", 403);
  }
  // Đã chấm rồi thì không đính thêm: thay đổi vật chứng sau khi có điểm.
  if (lan.status !== "SUBMITTED" && lan.status !== "DRAFT") {
    return loi("KHONG_SUA_DUOC", "Lượt nộp này đã chấm — không đính thêm tệp được");
  }

  const dsTep = docTep(lan.attachmentsJson);

  if (input.buoc === "ky") {
    const sai = kiemTepTruocKhiKy({
      mime: input.mime,
      size: input.size,
      soTepHienCo: dsTep.length,
    });
    if (sai) return loi(sai.ma, sai.noi);

    const khoa = khoaChoTep(lan.id, input.mime);
    const url = await kyUrlTaiLen(khoa, input.mime);
    return ok({ khoa, url });
  }

  // ── Bước XONG: xác minh rồi mới ghi ──────────────────────────────────────
  if (dsTep.length >= NOP_MAX_TEP) {
    return loi("QUA_NHIEU_TEP", `Mỗi lượt nộp tối đa ${NOP_MAX_TEP} tệp`);
  }
  if (dsTep.some((t) => t.key === input.khoa)) {
    // Bấm hai lần: coi như xong, đừng ghi trùng.
    return ok({ soTep: dsTep.length });
  }

  const kq = await xacMinhTep({
    khoa: input.khoa,
    submissionId: lan.id,
    mime: input.mime,
  });
  if (!kq.ok) {
    // ⚠️ TỪ CHỐI thì DỌN. Tệp đã nằm trên kho rồi (URL ký không ràng buộc được
    // dung lượng), và nội dung ở đây có thể là video lớp học hay ghi âm phụ huynh
    // (§13.3). Để lại là giữ dữ liệu của người thứ ba mà không sổ nào ghi nhận nó.
    if (kq.ma !== "KHONG_THAY") {
      await xoaTepTrenKho(input.khoa).catch(() => undefined);
    }
    return loi(kq.ma, kq.noi);
  }

  // ⚠️ GHI TRONG GIAO DỊCH, đọc lại sổ ngay trước khi ghi.
  //
  // Bản đầu đọc `attachmentsJson` ở đầu request rồi ghi đè cả mảng ở cuối — hai
  // request song song cho hai tệp KHÁC nhau cùng đọc sổ cũ, và request về sau XOÁ
  // mất tệp của request về trước. Người học thấy tệp mình vừa tải lên biến mất, và
  // không có lỗi nào để họ báo.
  const soTep = await db.$transaction(async (t) => {
    const nay = await t.trnSubmission.findUnique({
      where: { id: lan.id },
      select: { attachmentsJson: true },
    });
    const hienCo = docTep(nay?.attachmentsJson);
    if (hienCo.some((x) => x.key === input.khoa)) return hienCo.length;
    if (hienCo.length >= NOP_MAX_TEP) return -1;

    const moi: TepDinhKem[] = [
      ...hienCo,
      { key: input.khoa, name: input.tenTep, mime: input.mime, size: kq.size },
    ];
    await t.trnSubmission.update({
      where: { id: lan.id },
      data: { attachmentsJson: moi },
    });
    return moi.length;
  });

  if (soTep === -1) {
    await xoaTepTrenKho(input.khoa).catch(() => undefined);
    return loi("QUA_NHIEU_TEP", `Mỗi lượt nộp tối đa ${NOP_MAX_TEP} tệp`);
  }

  return ok({ soTep });
}
