import { z } from "zod";
import type { ActionConfig, ScopedDb } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import {
  doiNguonBaiVideo,
  LoiDoiNguon,
  xemTruocDoiNguon,
  type KetQuaDoiNguon,
  type KetQuaXemTruoc,
} from "@/lib/elearning/video-doi-nguon";
import { LY_DO_TOI_DA, lyDoChuaNguon, type NguonBai } from "@/lib/elearning/video-doi-nguon-rule";
import type { Prisma } from "@prisma/client";
import { VIDEO_MAX_SEC, VIDEO_MIN_SEC, YOUTUBE_MAX_SEC } from "@/lib/elearning/media-rules";
import { tachMaYoutube } from "@/lib/elearning/youtube-link";
import { kiemCodec, THONG_BAO_CODEC } from "@/lib/elearning/mp4-probe";

/**
 * EL-10 — LƯU SIÊU DỮ LIỆU BÀI VIDEO.
 *
 * Mảnh cuối làm cả chuỗi EL-10 dùng được: không có đường này thì bucket, presign,
 * bộ đọc mp4 và route phát đều đã sẵn mà KHÔNG bài học nào mang được một
 * `videoKey`.
 *
 * ⚠️ `trnLessonCreateSchema` (`lib/validators/elearning.ts:328`) đã có đủ 7 cột
 * video và đúng luật từ lâu, nhưng trước PR này nó CHỈ được gọi trong test — tức
 * luật viết ra mà không đường nào thi hành. Action này là call-site thật đầu tiên
 * của các luật đó.
 *
 * ⚠️ Thời lượng lưu vào DB là con số ĐỌC TỪ TỆP (`mp4-probe`), không phải con số
 * trình duyệt khai. Con số client chỉ dùng chặn sớm ở bước mở lượt tải.
 */

/**
 * CỔNG CÁCH LY CƠ SỞ cho đổi nguồn video — ĐỌC KHOÁ QUA `scopedDb`.
 *
 * ⚠️ `TrnLesson`/`TrnModule` KHÔNG nằm trong `SCOPED_MODELS` nên `db.trnLesson.findFirst` trả bài của MỌI cơ sở, và
 * `can(..., "elearning:content:publish")` không mang target (quyền seed là GLOBAL) nên cũng không từ chối ai. Không có
 * lượt đọc này thì người soạn ở CS1 đổi nguồn — và với quyền xuất bản còn chụp + bắt đầu lại tiến độ lượt đang học —
 * của khoá riêng CS2, và không gì báo. Mẫu: `lesson-cue-authoring.ts` (`layBaiVideo`).
 *
 * Trả CÙNG một lỗi với "bài không tồn tại": phân biệt hai thứ là nói cho người dò biết id nào có thật.
 */
async function chanPhamViKhoa(db: ScopedDb, courseId: string): Promise<string | null> {
  const khoa = await db.trnCourse.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true, orgUnitId: true, centerId: true },
  });
  if (!khoa) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");
  // Phạm vi cơ sở cho audit của nhánh KHÔNG đổi nguồn (factory ghi): `resolveAuditOrgUnitId` nhận cả OrgUnit.id lẫn Center.id.
  return khoa.orgUnitId ?? khoa.centerId ?? null;
}

/**
 * Ghi nguồn mới của bài qua giao dịch đổi nguồn (`doiNguonBaiVideo`): tăng phiên bản + chụp + bắt đầu lại tiến độ khi nguồn
 * THẬT SỰ đổi, chỉ ghi metadata khi không. Lỗi chính sách (thiếu quyền xuất bản, chưa xác nhận tác động) trở thành
 * `ActionError` có mã để form hiện hộp xác nhận — giao dịch đã rollback, không có gì được ghi.
 */
async function ghiNguon(i: {
  lessonId: string;
  moi: NguonBai;
  duLieu: Prisma.TrnLessonUpdateInput;
  actor: Actor;
  actorName: string;
  /** Chuỗi xác nhận từ `xemTruocDoiNguon`. Giao dịch kiểm LẠI trên tập người học tính lại sau khoá. */
  xacNhanToken: string | null;
  lyDo: string | null;
}): Promise<KetQuaDoiNguon> {
  try {
    return await doiNguonBaiVideo({
      lessonId: i.lessonId,
      moi: i.moi,
      duLieu: i.duLieu,
      actorUserId: i.actor.userId,
      actorName: i.actorName,
      coQuyenXuatBan: can(i.actor, "elearning:content:publish"),
      xacNhanToken: i.xacNhanToken,
      lyDo: i.lyDo,
    });
  } catch (e) {
    if (e instanceof LoiDoiNguon) throw new ActionError(e.ma, e.message);
    throw e;
  }
}

/** Lý do tự do do client gửi: chặn độ dài TRƯỚC mọi thứ (nó đi vào sổ audit bất biến và bản chụp tiến độ). */
function chanLyDoQuaDai(lyDo: unknown): void {
  if (lyDo == null) return;
  // `opts.reason` của Server Action đi từ client mà KHÔNG qua zod: kiểu sai phải là lỗi VALIDATION, không phải 500; và đo cả chuỗi THÔ
  // (megabyte khoảng trắng + vài ký tự thật qua được phép đo sau cắt rồi nằm nguyên trong sổ audit của nhánh không đổi nguồn).
  if (typeof lyDo !== "string") throw new ActionError("VALIDATION", "Lý do phải là văn bản", "reason");
  if (lyDo.length > LY_DO_TOI_DA * 4 || lyDo.trim().length > LY_DO_TOI_DA) {
    throw new ActionError("VALIDATION", `Lý do tối đa ${LY_DO_TOI_DA} ký tự`, "reason");
  }
  if (lyDoChuaNguon(lyDo)) {
    throw new ActionError("VALIDATION", "Lý do không được chứa link hoặc đường dẫn video — mã nguồn là bí mật của video không công khai", "reason");
  }
}

/**
 * Phần audit cho nhánh KHÔNG đổi nguồn (chỉ metadata) — factory ghi sổ ở bước 5. Nhánh ĐỔI nguồn (`kq.daGhiAudit`) KHÔNG đi
 * qua đây: giao dịch đã ghi audit đầy đủ (actor, phạm vi cơ sở, phiên bản cũ/mới, lý do, số lượt) CÙNG giao dịch với việc đổi.
 * KHÔNG chứa mã YouTube, khoá tệp, tên hay email người học.
 */
function auditDoiNguon(kq: KetQuaDoiNguon) {
  return { mediaRevision: kq.revMoi, doiNguon: kq.doiNguon };
}

export const luuBaiVideoSchema = z
  .object({
    lessonId: z.string().min(1),
    title: z.string().trim().min(1, "Tên bài không được trống"),
    videoKey: z.string().min(1, "Bài video phải có tệp video"),
    /** Thời lượng ĐỌC TỪ TỆP, tính bằng giây. */
    durationSec: z.number().int().min(VIDEO_MIN_SEC).max(VIDEO_MAX_SEC),
    captionKey: z.union([z.null(), z.string().min(1)]).optional(),
    audioKey: z.union([z.null(), z.string().min(1)]).optional(),
    transcriptMd: z.union([z.null(), z.string()]).optional(),
    /**
     * Chuỗi xác nhận lấy từ `xemTruocDoiNguonAction` — ký, gắn bài + người + nguồn mới + tập người học bị ảnh hưởng.
     * KHÔNG phải cờ boolean: server kiểm lại trong giao dịch, tập người học đổi ⇒ `TAC_DONG_DA_DOI` ⇒ xem trước lại.
     */
    xacNhanToken: z.string().min(1).max(2000).optional(),
    /** Kết quả đọc header mp4 — dùng để chốt codec, không lưu thô. */
    codec: z
      .object({
        videoCodec: z.union([z.null(), z.enum(["avc1", "hev1", "khac"])]),
        audioCodec: z.union([z.null(), z.enum(["mp4a", "khac"])]),
        brand: z.string(),
      })
      .optional(),
  })
  .strict();

export type LuuBaiVideoInput = z.infer<typeof luuBaiVideoSchema>;

export const cauHinhLuuBaiVideo: ActionConfig<LuuBaiVideoInput, { durationSec: number }> = {
  name: "luuBaiVideo",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnLesson",
  auditAction: "UPDATE",
  schema: luuBaiVideoSchema,
  handler: async ({ db, input, actor, reason, actorName }) => {
    const cu = await db.trnLesson.findFirst({
      where: { id: input.lessonId, deletedAt: null },
      select: {
        id: true,
        kind: true,
        title: true,
        videoKey: true,
        durationSec: true,
        captionKey: true,
        module: { select: { courseId: true } },
      },
    });
    if (!cu) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");
    const phamVi = await chanPhamViKhoa(db, cu.module.courseId);
    if (cu.kind !== "VIDEO") {
      throw new ActionError(
        "WRONG_KIND",
        `Bài này là dạng ${cu.kind}, không phải bài video`,
        "lessonId",
      );
    }

    // ⚠️ Chốt codec ở ĐÂY, không chỉ ở bước tải lên. Bước tải lên có thể bị gọi
    // lại, bị bỏ giữa chừng, hay bị thay tệp; đây là chỗ duy nhất mà tệp và bản
    // ghi bài học gắn với nhau.
    if (input.codec) {
      const k = kiemCodec({
        xong: true,
        brand: input.codec.brand,
        durationSec: input.durationSec,
        videoCodec: input.codec.videoCodec,
        audioCodec: input.codec.audioCodec,
        // `kiemCodec` chỉ đọc hai trường codec; độ phân giải đã được chặn ở
        // bước xác minh, không kiểm lại ở đây.
        rong: null,
        cao: null,
      });
      if (!k.ok) throw new ActionError(k.code, THONG_BAO_CODEC[k.code], "videoKey");
    }

    // Khoá phải thuộc đúng bài này. Không kiểm thì một bài có thể trỏ vào tệp của
    // bài khác, và xoá bài kia là làm bài này mất video mà không ai nối được
    // nguyên nhân.
    for (const [ten, khoa] of [
      ["videoKey", input.videoKey],
      ["captionKey", input.captionKey],
      ["audioKey", input.audioKey],
    ] as const) {
      if (!khoa) continue;
      if (!khoa.includes(`/${cu.id}/`)) {
        throw new ActionError(
          "KEY_NGOAI_BAI",
          "Tệp không thuộc bài học này — tải lại tệp cho đúng bài",
          ten,
        );
      }
    }

    chanLyDoQuaDai(reason);
    const kq = await ghiNguon({
      lessonId: cu.id,
      moi: { youtubeId: null, videoKey: input.videoKey, durationSec: input.durationSec },
      actor,
      actorName,
      xacNhanToken: input.xacNhanToken ?? null,
      lyDo: reason,
      duLieu: {
        title: input.title,
        videoKey: input.videoKey,
        // Bản 360p thuộc về video CŨ: thay tệp là bỏ nó (đường YouTube cũng đặt null). Giữ lại là để rendition của video đã bị thay
        // vẫn là 'tệp hiện hành' được phát.
        videoKey360: null,
        // Hai nguồn LOẠI TRỪ nhau: tải tệp lên là bỏ link YouTube. Giữ cả hai thì trang
        // học phải chọn một, và người soạn không biết nó chọn cái nào.
        youtubeId: null,
        youtubePhuDe: false,
        durationSec: input.durationSec,
        captionKey: input.captionKey ?? null,
        audioKey: input.audioKey ?? null,
        // Bản chép lời sinh TỪ phụ đề, không nhập tay lần thứ hai: hai nguồn cho
        // cùng một nội dung thì sớm muộn chúng lệch nhau, và không ai biết bên
        // nào đúng.
        transcriptMd: input.transcriptMd ?? null,
      },
    });

    return {
      entityId: cu.id,
      data: { durationSec: input.durationSec },
      oldValues: {
        title: cu.title,
        coVideo: Boolean(cu.videoKey),
        durationSec: cu.durationSec,
        coPhuDe: Boolean(cu.captionKey),
      },
      newValues: {
        title: input.title,
        durationSec: input.durationSec,
        coPhuDe: Boolean(input.captionKey),
        videoCodec: input.codec?.videoCodec ?? null,
        ...auditDoiNguon(kq),
      },
      orgUnitId: phamVi,
      daGhiAudit: kq.daGhiAudit,
    };
  },
};

/**
 * LƯU BÀI VIDEO DÙNG LINK YOUTUBE (video "Không công khai").
 *
 * Người học xem ngay trong trang của hệ thống (trình phát nhúng), và server vẫn đo
 * "đã xem bao nhiêu %" bằng đúng đường nhịp xem của tệp tải lên — `ghiNhipXem` chỉ
 * cần `durationSec` của bài, không cần biết nguồn.
 *
 * ⚠️ Thời lượng ở đây là con số TRÌNH DUYỆT CỦA NGƯỜI SOẠN đọc được từ chính trình
 * phát YouTube (server không có cách đọc header như với MP4). Nó là MẪU SỐ của mọi
 * phần trăm xem, nên server chỉ chặn ngoài khoảng hợp lý; người có quyền soạn nội
 * dung là người đáng tin ở đây. Khác với tệp tải lên: ở đó thời lượng đọc từ tệp.
 *
 * ⚠️ Mã video do SERVER tự tách lại từ `url`, không nhận mã đã tách từ client.
 *
 * ⚠️ Mã video là bí mật của video không công khai ⇒ KHÔNG ghi vào audit.
 */
export const luuBaiVideoYoutubeSchema = z
  .object({
    lessonId: z.string().min(1),
    title: z.string().trim().min(1, "Tên bài không được trống"),
    url: z.string().trim().min(1, "Chưa dán link YouTube").max(500),
    durationSec: z.number().int().min(VIDEO_MIN_SEC).max(YOUTUBE_MAX_SEC),
    /** Người soạn xác nhận video đã bật phụ đề tiếng Việt bên YouTube. */
    coPhuDe: z.boolean(),
    /** Xem `luuBaiVideoSchema.xacNhanToken`. */
    xacNhanToken: z.string().min(1).max(2000).optional(),
  })
  .strict();

export type LuuBaiVideoYoutubeInput = z.infer<typeof luuBaiVideoYoutubeSchema>;

export const cauHinhLuuBaiVideoYoutube: ActionConfig<
  LuuBaiVideoYoutubeInput,
  { durationSec: number }
> = {
  name: "luuBaiVideoYoutube",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnLesson",
  auditAction: "UPDATE",
  schema: luuBaiVideoYoutubeSchema,
  handler: async ({ db, input, actor, reason, actorName }) => {
    const cu = await db.trnLesson.findFirst({
      where: { id: input.lessonId, deletedAt: null },
      select: {
        id: true,
        kind: true,
        title: true,
        videoKey: true,
        youtubeId: true,
        durationSec: true,
        module: { select: { courseId: true } },
      },
    });
    if (!cu) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");
    const phamVi = await chanPhamViKhoa(db, cu.module.courseId);
    if (cu.kind !== "VIDEO") {
      throw new ActionError(
        "WRONG_KIND",
        `Bài này là dạng ${cu.kind}, không phải bài video`,
        "lessonId",
      );
    }

    const ma = tachMaYoutube(input.url);
    if (!ma) {
      throw new ActionError(
        "LINK_YOUTUBE_SAI",
        "Không đọc được link YouTube này — dán link dạng youtu.be/… hoặc youtube.com/watch?v=…",
        "url",
      );
    }

    chanLyDoQuaDai(reason);
    const kq = await ghiNguon({
      lessonId: cu.id,
      moi: { youtubeId: ma, videoKey: null, durationSec: input.durationSec },
      actor,
      actorName,
      xacNhanToken: input.xacNhanToken ?? null,
      lyDo: reason,
      duLieu: {
        title: input.title,
        youtubeId: ma,
        youtubePhuDe: input.coPhuDe,
        durationSec: input.durationSec,
        // Loại trừ với tệp tải lên. Phụ đề/âm thanh là của TỆP (`.vtt`, `.m4a` trên
        // R2) nên đi theo nó; cổng phụ đề đọc `youtubePhuDe` cho nguồn này.
        videoKey: null,
        videoKey360: null,
        captionKey: null,
        audioKey: null,
      },
    });

    return {
      entityId: cu.id,
      data: { durationSec: input.durationSec },
      oldValues: {
        title: cu.title,
        coVideo: Boolean(cu.videoKey) || Boolean(cu.youtubeId),
        nguon: cu.youtubeId ? "YOUTUBE" : cu.videoKey ? "TEP" : null,
        durationSec: cu.durationSec,
      },
      newValues: {
        title: input.title,
        nguon: "YOUTUBE",
        durationSec: input.durationSec,
        coPhuDe: input.coPhuDe,
        ...auditDoiNguon(kq),
      },
      orgUnitId: phamVi,
      daGhiAudit: kq.daGhiAudit,
    };
  },
};

/**
 * XEM TRƯỚC TÁC ĐỘNG của việc đổi nguồn — CHỈ ĐỌC. Trả số liệu cho hộp xác nhận + chuỗi xác nhận ký (xem
 * `video-doi-nguon-xac-nhan.ts`). Cùng cổng với hai đường lưu: quyền soạn, cách ly cơ sở (khoá qua scopedDb), bài phải là
 * VIDEO. Không audit, không ghi.
 */
export const xemTruocDoiNguonSchema = z
  .object({
    lessonId: z.string().min(1),
    loai: z.enum(["TEP", "YOUTUBE"]),
    /** `loai = TEP`: khoá tệp vừa tải lên. */
    videoKey: z.string().min(1).optional(),
    /** `loai = YOUTUBE`: link người soạn dán (server tự tách mã). */
    url: z.string().trim().min(1).max(500).optional(),
    durationSec: z.number().int().min(VIDEO_MIN_SEC).max(YOUTUBE_MAX_SEC),
  })
  .strict();

export type XemTruocDoiNguonInput = z.infer<typeof xemTruocDoiNguonSchema>;

export const cauHinhXemTruocDoiNguon: ActionConfig<XemTruocDoiNguonInput, KetQuaXemTruoc> = {
  name: "xemTruocDoiNguon",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnLesson",
  schema: xemTruocDoiNguonSchema,
  handler: async ({ db, input, actor }) => {
    const cu = await db.trnLesson.findFirst({
      where: { id: input.lessonId, deletedAt: null },
      select: { id: true, kind: true, module: { select: { courseId: true } } },
    });
    if (!cu) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");
    await chanPhamViKhoa(db, cu.module.courseId);
    if (cu.kind !== "VIDEO") {
      throw new ActionError("WRONG_KIND", `Bài này là dạng ${cu.kind}, không phải bài video`, "lessonId");
    }

    let moi: NguonBai;
    if (input.loai === "YOUTUBE") {
      const ma = input.url ? tachMaYoutube(input.url) : null;
      if (!ma) {
        throw new ActionError(
          "LINK_YOUTUBE_SAI",
          "Không đọc được link YouTube này — dán link dạng youtu.be/… hoặc youtube.com/watch?v=…",
          "url",
        );
      }
      moi = { youtubeId: ma, videoKey: null, durationSec: input.durationSec };
    } else {
      if (!input.videoKey) throw new ActionError("VALIDATION", "Bài video phải có tệp video", "videoKey");
      if (input.durationSec > VIDEO_MAX_SEC) {
        throw new ActionError("VALIDATION", "Thời lượng vượt quá chuẩn tệp tải lên", "durationSec");
      }
      if (!input.videoKey.includes(`/${cu.id}/`)) {
        throw new ActionError("KEY_NGOAI_BAI", "Tệp không thuộc bài học này — tải lại tệp cho đúng bài", "videoKey");
      }
      moi = { youtubeId: null, videoKey: input.videoKey, durationSec: input.durationSec };
    }

    try {
      const kq = await xemTruocDoiNguon({
        lessonId: cu.id,
        moi,
        actorUserId: actor.userId,
        coQuyenXuatBan: can(actor, "elearning:content:publish"),
      });
      // Chỉ đọc ⇒ không có gì để ghi sổ.
      return { entityId: cu.id, data: kq, daGhiAudit: true };
    } catch (e) {
      if (e instanceof LoiDoiNguon) throw new ActionError(e.ma, e.message);
      throw e;
    }
  },
};
