import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { cuonTienDoKhoa } from "@/lib/elearning/course-completion";
import {
  kiemLyDoDoiNguon,
  nguonDaDoi,
  quyetDinhDoiNguon,
  soNguoiDaHoc,
  TAC_DONG_RONG,
  thongBaoTacDong,
  type MaTuChoiDoiNguon,
  type NguonBai,
  type TacDongDoiNguon,
} from "@/lib/elearning/video-doi-nguon-rule";
import {
  bamNguonMoi,
  bamTapTacDong,
  kiemXacNhan,
  kyXacNhan,
  XAC_NHAN_TTL_MS,
  type DongTacDong,
} from "@/lib/elearning/video-doi-nguon-xac-nhan";

/**
 * ĐỔI NGUỒN BÀI VIDEO — phần GIAO DỊCH: tăng `mediaRevision`, chụp bất biến tiến độ cũ, bắt đầu lại tiến độ của lượt
 * đang học, cập nhật `progressPercent` — TẤT CẢ trong MỘT giao dịch cùng với việc ghi nguồn mới.
 *
 * Luật chính sách ở `video-doi-nguon-rule.ts`. Thiết kế + đối soát + phục hồi: docs/elearning/video/THIET-KE-…, mục B.
 *
 * ── Khoá ────────────────────────────────────────────────────────────────────────────────────────────────────
 * Giao dịch lấy `SELECT … FOR UPDATE` trên dòng bài NGAY ĐẦU. Nhịp xem lấy `FOR SHARE` trên cùng dòng (xem `ghiNhipXem`),
 * nên một nhịp hoặc ghi xong TRƯỚC khi ta lấy khoá (và bị chụp cùng) hoặc đứng chờ rồi thấy phiên bản MỚI và bị từ chối —
 * không có đường thứ ba ghi nhịp của video cũ vào tiến độ của video mới. Thứ tự khoá: bài → hàng tiến độ; ta KHÔNG lấy
 * khoá tư vấn (người, bài) nào nên không có chu trình chờ với nhịp xem (tư vấn → bài → tiến độ).
 *
 * ── Từ chối = `throw` ───────────────────────────────────────────────────────────────────────────────────────
 * Mọi cổng đứng TRƯỚC phép ghi đầu tiên và từ chối bằng `LoiDoiNguon` (ném ⇒ giao dịch rollback). `return` không rollback.
 */

export class LoiDoiNguon extends Error {
  constructor(
    readonly ma: MaTuChoiDoiNguon | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "LoiDoiNguon";
  }
}

export type KetQuaDoiNguon = {
  /** Nguồn/thời lượng có thật sự đổi — `false` ⇒ chỉ ghi metadata, KHÔNG đụng phiên bản, tiến độ. */
  doiNguon: boolean;
  revCu: number;
  revMoi: number;
  tacDong: TacDongDoiNguon;
  /** Số bản chụp được GHI MỚI vào `TrnLessonProgressRevision` (mọi hàng ở phiên bản cũ, kể cả lượt đóng băng). */
  daChup: number;
  /** Số hàng tiến độ của lượt ĐANG HỌC được đặt lại ở phiên bản mới. */
  daDatLai: number;
  /** Số lượt đang học đổi `progressPercent`. */
  daLamMoiPhanTram: number;
  /** `true` ⇒ audit đã được ghi TRONG giao dịch này (factory không ghi lần hai). */
  daGhiAudit: boolean;
};

type Tx = Prisma.TransactionClient;
type Doc = Pick<Tx, "$queryRaw" | "trnLessonCue" | "trnCourse" | "trnModule">;

const CHUNK = 4000;

/**
 * Đếm tác động của việc đổi nguồn lên bài — CHỈ ĐỌC, không tên người nào. Dùng trong giao dịch (sau khoá) lẫn để xem trước.
 * Đếm trên hàng tiến độ ở PHIÊN BẢN HIỆN TẠI của bài.
 */
export async function docTacDongDoiNguon(c: Doc, lessonId: string, rev: number): Promise<TacDongDoiNguon> {
  const [r] = await c.$queryRaw<
    { dangHoc: number; dongBang: number; xongDangHoc: number; xongDongBang: number }[]
  >`
    SELECT
      count(*) FILTER (WHERE e."status" IN ('NOT_STARTED','IN_PROGRESS','OVERDUE') AND p."status" <> 'NOT_STARTED')::int AS "dangHoc",
      count(*) FILTER (WHERE e."status" IN ('COMPLETED','COMPLETED_LATE','REVOKED') AND p."status" <> 'NOT_STARTED')::int AS "dongBang",
      count(*) FILTER (WHERE e."status" IN ('NOT_STARTED','IN_PROGRESS','OVERDUE') AND p."status" = 'DONE')::int AS "xongDangHoc",
      count(*) FILTER (WHERE e."status" IN ('COMPLETED','COMPLETED_LATE','REVOKED') AND p."status" = 'DONE')::int AS "xongDongBang"
    FROM "TrnLessonProgress" p
    JOIN "TrnEnrollment" e ON e."id" = p."enrollmentId"
    WHERE p."lessonId" = ${lessonId} AND p."mediaRevision" = ${rev}`;
  const soCau = await c.trnLessonCue.count({ where: { lessonId } });
  return {
    ...TAC_DONG_RONG,
    ghiDanhDangHoc: r?.dangHoc ?? 0,
    ghiDanhDongBang: r?.dongBang ?? 0,
    daXongDangHoc: r?.xongDangHoc ?? 0,
    daXongDongBang: r?.xongDongBang ?? 0,
    soCauHoiChen: soCau,
  };
}

/** Loại nguồn để GHI SỔ (không bao giờ ghi mã YouTube / khoá tệp). */
const loaiNguon = (b: Pick<NguonBai, "youtubeId" | "videoKey">): "YOUTUBE" | "TEP" | null =>
  b.youtubeId ? "YOUTUBE" : b.videoKey ? "TEP" : null;

/**
 * Mọi thứ cổng đổi nguồn cần biết về một bài, đọc bằng cùng một đường cho GIAO DỊCH (sau khoá) lẫn XEM TRƯỚC:
 * tác động (đếm), DẤU của tập người bị ảnh hưởng (chống TOCTOU), khoá đã xuất bản chưa, phạm vi cơ sở của khoá (để ghi audit).
 */
export async function docBoiCanhDoiNguon(c: Doc, cu: { id: string; mediaRevision: number; moduleId: string }) {
  const tacDong = await docTacDongDoiNguon(c, cu.id, cu.mediaRevision);
  const dong = await c.$queryRaw<{ id: string; lop: "H" | "B"; tienDo: "N" | "D" | "I" }[]>`
    SELECT p."enrollmentId" AS "id",
      CASE WHEN e."status" IN ('NOT_STARTED','IN_PROGRESS','OVERDUE') THEN 'H' ELSE 'B' END AS "lop",
      CASE p."status" WHEN 'NOT_STARTED' THEN 'N' WHEN 'DONE' THEN 'D' ELSE 'I' END AS "tienDo"
    FROM "TrnLessonProgress" p
    JOIN "TrnEnrollment" e ON e."id" = p."enrollmentId"
    WHERE p."lessonId" = ${cu.id} AND p."mediaRevision" = ${cu.mediaRevision}
    ORDER BY p."enrollmentId"`;
  const dau = bamTapTacDong(
    dong.map((d): DongTacDong => ({ enrollmentId: d.id, lop: d.lop, tienDo: d.tienDo })),
    tacDong.soCauHoiChen,
  );
  const mod = await c.trnModule.findUnique({ where: { id: cu.moduleId }, select: { courseId: true } });
  const khoa = mod
    ? await c.trnCourse.findUnique({
        where: { id: mod.courseId },
        select: {
          id: true,
          status: true,
          centerId: true,
          orgUnitId: true,
          versions: { where: { status: "PUBLISHED" }, select: { id: true }, take: 1 },
        },
      })
    : null;
  const khoaDaXuatBan = khoa != null && (khoa.status === "PUBLISHED" || khoa.versions.length > 0);
  return { tacDong, dau, khoaDaXuatBan, khoaId: khoa?.id ?? null, orgUnitId: khoa?.orgUnitId ?? null, centerId: khoa?.centerId ?? null };
}

export type KetQuaXemTruoc = {
  /** Nội dung có thật sự đổi — `false` ⇒ lưu thẳng, không có gì để hỏi. */
  doiNguon: boolean;
  khoaDaXuatBan: boolean;
  coQuyenXuatBan: boolean;
  /** Việc đổi đòi QUYỀN xuất bản (khoá đã xuất bản, hoặc đã có người học). Cùng điều kiện với `yeuCauXacNhan`, tách tên để UI nói đúng việc. */
  yeuCauQuyenXuatBan: boolean;
  /** Phải có xác nhận (khoá đã xuất bản, hoặc đã có người học). */
  yeuCauXacNhan: boolean;
  /** Số liệu tác động. ⚠️ Người THIẾU quyền xuất bản mà việc đổi đòi quyền đó nhận bản RỖNG: số lượt học là thông tin của người có quyền. */
  tacDong: TacDongDoiNguon;
  /** Câu nói thẳng tác động để hiện trong hộp xác nhận; `null` khi không có gì phải hỏi. */
  thongBao: string | null;
  /** Chuỗi xác nhận ràng buộc nội dung + tập người học HIỆN TẠI. `null` khi không cần, hoặc người gọi thiếu quyền xuất bản. */
  xacNhanToken: string | null;
  hetHanLuc: number | null;
};

/**
 * XEM TRƯỚC tác động — CHỈ ĐỌC (không khoá, không ghi, không audit). Trả cho form số liệu + chuỗi xác nhận.
 * Chuỗi chỉ phát cho người có quyền xuất bản: người không có quyền không có gì để xác nhận (lưu sẽ bị từ chối).
 * Giao dịch lưu TỰ KIỂM LẠI chuỗi trên tập người học tính lại sau khoá — xem trước chỉ là chỗ lấy chuỗi, không phải cổng.
 */
export async function xemTruocDoiNguon(i: {
  lessonId: string;
  moi: NguonBai;
  actorUserId: string;
  coQuyenXuatBan: boolean;
  now?: Date;
}): Promise<KetQuaXemTruoc> {
  const now = i.now ?? new Date();
  const cu = await db.trnLesson.findFirst({
    where: { id: i.lessonId, deletedAt: null },
    select: { id: true, mediaRevision: true, youtubeId: true, videoKey: true, durationSec: true, moduleId: true },
  });
  if (!cu) throw new LoiDoiNguon("NOT_FOUND", "Không tìm thấy bài học");
  if (!nguonDaDoi(cu, i.moi)) {
    return {
      doiNguon: false,
      khoaDaXuatBan: false,
      coQuyenXuatBan: i.coQuyenXuatBan,
      yeuCauQuyenXuatBan: false,
      yeuCauXacNhan: false,
      tacDong: TAC_DONG_RONG,
      thongBao: null,
      xacNhanToken: null,
      hetHanLuc: null,
    };
  }
  const bc = await docBoiCanhDoiNguon(db, cu);
  const yeuCauXacNhan = bc.khoaDaXuatBan || soNguoiDaHoc(bc.tacDong) > 0;
  if (yeuCauXacNhan && !i.coQuyenXuatBan) {
    // Đường lưu cố ý giấu số lượt học khỏi người thiếu quyền (từ chối chỉ mang một câu cố định); xem trước không được làm hỏng điều đó.
    return {
      doiNguon: true,
      khoaDaXuatBan: bc.khoaDaXuatBan,
      coQuyenXuatBan: false,
      yeuCauQuyenXuatBan: true,
      yeuCauXacNhan: true,
      tacDong: TAC_DONG_RONG,
      thongBao: null,
      xacNhanToken: null,
      hetHanLuc: null,
    };
  }
  const token =
    yeuCauXacNhan && i.coQuyenXuatBan
      ? kyXacNhan(
          { lessonId: cu.id, userId: i.actorUserId, rev: cu.mediaRevision, nguon: bamNguonMoi(i.moi), dau: bc.dau },
          now.getTime(),
        )
      : null;
  return {
    doiNguon: true,
    khoaDaXuatBan: bc.khoaDaXuatBan,
    coQuyenXuatBan: i.coQuyenXuatBan,
    yeuCauQuyenXuatBan: yeuCauXacNhan,
    yeuCauXacNhan,
    tacDong: bc.tacDong,
    thongBao: yeuCauXacNhan ? thongBaoTacDong(bc.tacDong, bc.khoaDaXuatBan) : null,
    xacNhanToken: token,
    hetHanLuc: token ? now.getTime() + XAC_NHAN_TTL_MS : null,
  };
}

/**
 * Ghi nguồn mới của một bài video. `duLieu` là TOÀN BỘ cột bài sẽ ghi (tiêu đề, nguồn, phụ đề…) do hai đường lưu dựng;
 * hàm này thêm `mediaRevision` khi — và chỉ khi — nguồn/thời lượng thật sự đổi.
 */
export async function doiNguonBaiVideo(i: {
  lessonId: string;
  moi: NguonBai;
  duLieu: Prisma.TrnLessonUpdateInput;
  actorUserId: string;
  /** Tên người đổi — vào sổ audit. */
  actorName: string;
  coQuyenXuatBan: boolean;
  /** Chuỗi xác nhận từ `xemTruocDoiNguon`; kiểm LẠI ở đây trên tập người học tính lại sau khoá. */
  xacNhanToken: string | null;
  lyDo: string | null;
  now?: Date;
}): Promise<KetQuaDoiNguon> {
  const now = i.now ?? new Date();
  return db.$transaction(
    async (tx) => {
      // ① Khoá GHI dòng bài và đọc lại nguồn HIỆN TẠI TRONG khoá (bản đọc ở handler đã có thể cũ).
      const [cu] = await tx.$queryRaw<
        { id: string; mediaRevision: number; youtubeId: string | null; videoKey: string | null; durationSec: number | null; moduleId: string }[]
      >`SELECT "id", "mediaRevision", "youtubeId", "videoKey", "durationSec", "moduleId" FROM "TrnLesson" WHERE "id" = ${i.lessonId} AND "deletedAt" IS NULL FOR UPDATE`;
      if (!cu) throw new LoiDoiNguon("NOT_FOUND", "Không tìm thấy bài học");

      const doi = nguonDaDoi(cu, i.moi);
      if (!doi) {
        await tx.trnLesson.update({ where: { id: cu.id }, data: i.duLieu });
        return {
          doiNguon: false,
          revCu: cu.mediaRevision,
          revMoi: cu.mediaRevision,
          tacDong: TAC_DONG_RONG,
          daChup: 0,
          daDatLai: 0,
          daLamMoiPhanTram: 0,
          daGhiAudit: false,
        };
      }

      // ② Bối cảnh — đọc SAU khoá, TRƯỚC mọi phép ghi: tác động, dấu tập người học, khoá đã xuất bản chưa.
      const bc = await docBoiCanhDoiNguon(tx, cu);
      const { tacDong, khoaDaXuatBan } = bc;

      // ③ Cổng. Xác nhận KHÔNG phải cờ boolean: là chuỗi ký gắn bài + người + phiên bản + nguồn mới + DẤU TẬP NGƯỜI HỌC vừa
      // tính lại ở trên. Có người bắt đầu/xong bài từ lúc xem trước ⇒ dấu khác ⇒ `TAC_DONG_DA_DOI`, phải xem trước lại.
      const xn = kiemXacNhan(
        i.xacNhanToken,
        { lessonId: cu.id, userId: i.actorUserId, rev: cu.mediaRevision, nguon: bamNguonMoi(i.moi), dau: bc.dau },
        now.getTime(),
      );
      const qd = quyetDinhDoiNguon({
        doi: true,
        tacDong,
        khoaDaXuatBan,
        coQuyenXuatBan: i.coQuyenXuatBan,
        daXacNhan: xn.ok,
      });
      if (qd.loai === "TU_CHOI" && qd.ma === "CAN_QUYEN_XUAT_BAN") throw new LoiDoiNguon(qd.ma, qd.thongBao);
      // Lý do bắt buộc khi NỘI DUNG thật sự đổi — đi vào bản chụp bất biến và sổ audit.
      const ld = kiemLyDoDoiNguon(i.lyDo);
      if (!ld.ok) throw new LoiDoiNguon("CAN_LY_DO", ld.thongBao);
      if (qd.loai === "TU_CHOI") {
        if (!xn.ok && xn.ly === "TAC_DONG_DA_DOI") {
          throw new LoiDoiNguon(
            "TAC_DONG_DA_DOI",
            `Người học bị ảnh hưởng đã thay đổi kể từ lúc bạn xem trước — xem lại và xác nhận lại. ${qd.thongBao}`,
          );
        }
        throw new LoiDoiNguon(qd.ma, qd.thongBao);
      }

      const revCu = cu.mediaRevision;
      const revMoi = revCu + 1;
      const noiDung = i.moi.durationSec ?? 0;

      // ③ CHỤP BẤT BIẾN mọi hàng tiến độ ở phiên bản cũ (kể cả lượt đóng băng — bằng chứng thống nhất, không phụ thuộc
      // việc hàng gốc còn nằm đó). ON CONFLICT DO NOTHING: chạy lại không đẻ bản trùng; khoá duy nhất (lượt, bài, phiên bản).
      const daChup = await tx.$executeRaw`
        INSERT INTO "TrnLessonProgressRevision"
          ("id","enrollmentId","lessonId","userId","mediaRevision","segmentBitmap","segmentSec","coveredSec","contentSec",
           "totalWatchSec","maxPositionSec","seekCount","blockedSeekCount","attnAskedCount","attnPassedCount","cueLogJson",
           "status","firstStartedAt","completedAt","verifiedAt","lastActivityAt","bitmapPurgedAt",
           "supersededAt","supersededByUserId","reason")
        SELECT gen_random_uuid()::text, p."enrollmentId", p."lessonId", p."userId", p."mediaRevision", p."segmentBitmap",
               p."segmentSec", p."coveredSec", p."contentSec", p."totalWatchSec", p."maxPositionSec", p."seekCount",
               p."blockedSeekCount", p."attnAskedCount", p."attnPassedCount", p."cueLogJson", p."status",
               p."firstStartedAt", p."completedAt", p."verifiedAt", p."lastActivityAt", p."bitmapPurgedAt",
               ${now}::timestamptz, ${i.actorUserId}::text, ${ld.lyDo}::text
        FROM "TrnLessonProgress" p
        WHERE p."lessonId" = ${cu.id} AND p."mediaRevision" = ${revCu}
        ON CONFLICT ("enrollmentId","lessonId","mediaRevision") DO NOTHING`;

      // ④ ĐẶT LẠI hàng tiến độ của lượt ĐANG HỌC ở phiên bản mới. Lượt đã kết thúc KHÔNG đụng (đóng băng ở phiên bản cũ).
      // Giữ `seq` (không bao giờ hạ — hạ là mở lại cổng nhịp cũ), `lastActivityAt`, `readSeconds`/`scrollMaxPct`, các cột
      // điểm danh. `RETURNING` để biết lượt nào cần làm mới `progressPercent`.
      const datLai = await tx.$queryRaw<{ enrollmentId: string }[]>`
        UPDATE "TrnLessonProgress" p SET
          "segmentBitmap" = NULL, "coveredSec" = 0, "contentSec" = ${noiDung}, "totalWatchSec" = 0, "maxPositionSec" = 0,
          "seekCount" = 0, "blockedSeekCount" = 0, "attnAskedCount" = 0, "attnPassedCount" = 0,
          "attnPendingAt" = NULL, "attnPendingPosSec" = NULL, "cueLogJson" = NULL,
          "status" = 'NOT_STARTED', "firstStartedAt" = NULL, "completedAt" = NULL, "verifiedAt" = NULL, "bitmapPurgedAt" = NULL,
          "mediaRevision" = ${revMoi}, "updatedAt" = ${now}::timestamptz
        FROM "TrnEnrollment" e
        WHERE e."id" = p."enrollmentId" AND p."lessonId" = ${cu.id} AND p."mediaRevision" = ${revCu}
          AND e."status" IN ('NOT_STARTED','IN_PROGRESS','OVERDUE')
        RETURNING p."enrollmentId"`;

      // ⑤ `progressPercent` của lượt vừa đặt lại — CHỈ cột đó, không đụng `status` (cuộn khoá đầy đủ sẽ lật OVERDUE →
      // IN_PROGRESS và là việc của nhịp xem kế tiếp, không phải của một lần đổi nguồn).
      const daLamMoiPhanTram = await lamMoiPhanTramKhoa(tx, datLai.map((r) => r.enrollmentId));

      // ⑥ Ghi nguồn mới + tăng phiên bản. Cuối cùng, để mọi cổng ở trên đã qua.
      await tx.trnLesson.update({
        where: { id: cu.id },
        data: { ...i.duLieu, mediaRevision: revMoi },
      });

      // ⑦ AUDIT TRONG CÙNG GIAO DỊCH: ghi lỗi ⇒ ném ⇒ cả việc đổi nguồn, bản chụp, đặt lại rollback. Trước đây factory ghi
      // audit SAU khi giao dịch đã commit nên audit lỗi để lại bài đã đổi mà không dấu vết. KHÔNG ghi mã YouTube / khoá tệp.
      await writeAudit({
        tx,
        actor: { id: i.actorUserId, name: i.actorName },
        module: "elearning",
        entityType: "TrnLesson",
        entityId: cu.id,
        action: "UPDATE",
        oldValues: { nguon: loaiNguon(cu), mediaRevision: revCu, durationSec: cu.durationSec },
        newValues: {
          nguon: loaiNguon(i.moi),
          mediaRevision: revMoi,
          durationSec: i.moi.durationSec,
          doiNguon: true,
          khoaId: bc.khoaId,
          khoaDaXuatBan,
          daXacNhanTacDong: xn.ok,
          ghiDanhDangHoc: tacDong.ghiDanhDangHoc,
          ghiDanhDongBang: tacDong.ghiDanhDongBang,
          daChup,
          daDatLai: datLai.length,
          daLamMoiPhanTram,
          soCauHoiChen: tacDong.soCauHoiChen,
        },
        reason: ld.lyDo,
        // `resolveAuditOrgUnitId` nhận cả OrgUnit.id lẫn Center.id: khoá nhập bằng SQL thô có thể chỉ mang `centerId` (chưa ghi kép).
        orgUnitId: bc.orgUnitId ?? bc.centerId,
      });

      return { doiNguon: true, revCu, revMoi, tacDong, daChup, daDatLai: datLai.length, daLamMoiPhanTram, daGhiAudit: true };
    },
    // Đặt lại cả nghìn hàng + làm mới phần trăm: rộng hơn mặc định 5 giây của giao dịch tương tác.
    { timeout: 60_000, maxWait: 15_000 },
  );
}

/**
 * Tính lại `progressPercent` cho các lượt vừa đặt lại tiến độ bài — dùng ĐÚNG công thức của `cuonTienDoKhoa` (một nguồn
 * duy nhất cho con số này). Chỉ ghi khi số đổi; không đụng cột nào khác.
 */
async function lamMoiPhanTramKhoa(tx: Tx, enrollmentIds: string[]): Promise<number> {
  if (enrollmentIds.length === 0) return 0;
  let daDoi = 0;
  for (let o = 0; o < enrollmentIds.length; o += CHUNK) {
    const ids = enrollmentIds.slice(o, o + CHUNK);
    const luot = await tx.trnEnrollment.findMany({
      where: { id: { in: ids } },
      select: { id: true, courseId: true, assignment: { select: { courseVersionId: true } } },
    });
    // Nhóm theo (khoá, phiên bản ghim): mỗi nhóm có MỘT tập bài bắt buộc.
    const nhom = new Map<string, { courseId: string; versionId: string | null; ids: string[] }>();
    for (const l of luot) {
      const versionId = l.assignment?.courseVersionId ?? null;
      const k = `${l.courseId}|${versionId ?? ""}`;
      const g = nhom.get(k) ?? { courseId: l.courseId, versionId, ids: [] };
      g.ids.push(l.id);
      nhom.set(k, g);
    }
    for (const g of nhom.values()) {
      const baiBatBuoc = g.versionId
        ? (
            await tx.trnCourseVersionLesson.findMany({
              where: { versionId: g.versionId, required: true, lesson: { deletedAt: null } },
              select: { lessonId: true },
            })
          ).map((x) => x.lessonId)
        : (
            await tx.trnLesson.findMany({
              where: { deletedAt: null, module: { courseId: g.courseId } },
              select: { id: true },
            })
          ).map((x) => x.id);
      const xong = await tx.trnLessonProgress.groupBy({
        by: ["enrollmentId"],
        where: { enrollmentId: { in: g.ids }, status: "DONE", lessonId: { in: baiBatBuoc } },
        _count: { _all: true },
      });
      const soXong = new Map(xong.map((x) => [x.enrollmentId, x._count._all]));
      const theoPhanTram = new Map<number, string[]>();
      for (const id of g.ids) {
        const pct = cuonTienDoKhoa({
          soBaiBatBuoc: baiBatBuoc.length,
          soBaiDaXong: soXong.get(id) ?? 0,
          statusHienTai: "IN_PROGRESS",
          dueAtOriginal: null,
          now: new Date(0),
        }).progressPercent;
        theoPhanTram.set(pct, [...(theoPhanTram.get(pct) ?? []), id]);
      }
      for (const [pct, danhSach] of theoPhanTram) {
        const r = await tx.trnEnrollment.updateMany({
          where: { id: { in: danhSach }, progressPercent: { not: pct } },
          data: { progressPercent: pct },
        });
        daDoi += r.count;
      }
    }
  }
  return daDoi;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// ĐỐI SOÁT và PHỤC HỒI
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

export type DoiChieuBai = {
  revHienTai: number;
  /** Hàng tiến độ của lượt ĐANG HỌC mà phiên bản lệch phiên bản bài. KỲ VỌNG 0 sau mỗi lần đổi nguồn. */
  hangDangHocLech: number;
  /** Hàng của lượt ĐÃ KẾT THÚC còn ở phiên bản cũ (đóng băng) — thông tin, không phải lỗi. */
  hangDongBangOPhienBanCu: number;
  /** Theo từng phiên bản đã bị thay: số bản chụp và tổng số giây phủ đã lưu. */
  banChup: { rev: number; soBan: number; tongCoveredSec: number; tongTotalWatchSec: number; soDone: number }[];
  /** Hàng tiến độ hiện hành mà KHÔNG có bản chụp ở phiên bản liền trước — tiến độ bị đặt lại mà không để lại dấu. KỲ VỌNG 0. */
  hangMatBanChup: number;
};

/**
 * ĐỐI SOÁT một bài sau khi đổi nguồn (chạy được bất cứ lúc nào, CHỈ ĐỌC). Cùng các phép đo với SQL ở tài liệu thiết kế,
 * mục B5. Cách dùng: ghi `tacDong` TRƯỚC khi đổi (hoặc lấy từ audit), đổi, rồi so — tổng số hàng/số giây ở `banChup` của
 * phiên bản cũ phải KHỚP con số lúc trước.
 */
export async function doiChieuTheoBai(c: Pick<Tx, "$queryRaw">, lessonId: string): Promise<DoiChieuBai> {
  const [bai] = await c.$queryRaw<{ rev: number }[]>`SELECT "mediaRevision" AS "rev" FROM "TrnLesson" WHERE "id" = ${lessonId}`;
  // Bài không tồn tại KHÔNG được báo 'KHỚP' (gõ nhầm --bai ra kết quả xanh giả): ném lỗi để kịch bản dừng.
  if (!bai) throw new LoiDoiNguon("NOT_FOUND", "Không tìm thấy bài học");
  const revHienTai = bai.rev;
  const [lech] = await c.$queryRaw<{ dangHocLech: number; dongBangCu: number }[]>`
    SELECT
      count(*) FILTER (WHERE e."status" IN ('NOT_STARTED','IN_PROGRESS','OVERDUE') AND p."mediaRevision" <> ${revHienTai})::int AS "dangHocLech",
      count(*) FILTER (WHERE e."status" IN ('COMPLETED','COMPLETED_LATE','REVOKED') AND p."mediaRevision" < ${revHienTai})::int AS "dongBangCu"
    FROM "TrnLessonProgress" p JOIN "TrnEnrollment" e ON e."id" = p."enrollmentId"
    WHERE p."lessonId" = ${lessonId}`;
  const banChup = await c.$queryRaw<DoiChieuBai["banChup"]>`
    SELECT "mediaRevision" AS "rev", count(*)::int AS "soBan", coalesce(sum("coveredSec"),0)::int AS "tongCoveredSec",
           coalesce(sum("totalWatchSec"),0)::int AS "tongTotalWatchSec", count(*) FILTER (WHERE "status" = 'DONE')::int AS "soDone"
    FROM "TrnLessonProgressRevision" WHERE "lessonId" = ${lessonId}
    GROUP BY "mediaRevision" ORDER BY "mediaRevision"`;
  const [mat] = await c.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS "n" FROM "TrnLessonProgress" p
    WHERE p."lessonId" = ${lessonId} AND p."mediaRevision" > 1
      AND NOT EXISTS (
        SELECT 1 FROM "TrnLessonProgressRevision" r
        WHERE r."enrollmentId" = p."enrollmentId" AND r."lessonId" = p."lessonId" AND r."mediaRevision" = p."mediaRevision" - 1
      )`;
  return {
    revHienTai,
    hangDangHocLech: lech?.dangHocLech ?? 0,
    hangDongBangOPhienBanCu: lech?.dongBangCu ?? 0,
    banChup,
    hangMatBanChup: mat?.n ?? 0,
  };
}

export type KeHoachKhoiPhuc = {
  /** Lượt sẽ được khôi phục (hàng hiện hành còn nguyên như lúc đặt lại, bản chụp còn bitmap). */
  khoiPhuc: number;
  /** Bỏ qua, kèm lý do đếm được — không bao giờ ghi đè tiến độ học SAU khi đặt lại. */
  boQua: {
    daCoTienDoMoi: number;
    banChupDaDonBitmap: number;
    luotDaKetThuc: number;
    khongCoHangHienHanh: number;
    /** Bản chụp mang thời lượng nội dung KHÁC thời lượng bài hiện hành — nạp bitmap của video khác độ dài vào là sai mẫu số. */
    khacThoiLuong: number;
  };
  daApDung: boolean;
};

/**
 * PHỤC HỒI tiến độ của lượt ĐANG HỌC từ bản chụp phiên bản `tuRev` vào hàng hiện hành — cho ca người soạn đổi nguồn NHẦM rồi
 * đổi lại đúng video cũ (nội dung hiện hành LÀ nội dung của `tuRev`). KHÔNG tự chạy: dry-run mặc định, `apply` do người vận
 * hành quyết. Không bao giờ ghi đè hàng đã có tiến độ mới; không đụng lượt đã kết thúc; không đụng `status`/chứng nhận của lượt.
 *
 * Khôi phục một lượt tới `DONE` không tự hoàn thành khoá — nhịp xem / `cuonKhoaSauKhiXongBai` kế tiếp làm việc đó.
 */
export async function khoiPhucTienDoTuBanChup(i: {
  lessonId: string;
  tuRev: number;
  apply: boolean;
  now?: Date;
}): Promise<KeHoachKhoiPhuc> {
  const now = i.now ?? new Date();
  return db.$transaction(
    async (tx) => {
      // CHẠY THỬ = CHỈ ĐỌC THẬT: giao dịch `READ ONLY` (câu đầu tiên của giao dịch) + snapshot nhất quán (RepeatableRead) và KHÔNG
      // lấy khoá dòng bài. Trước đây chạy thử cũng `SELECT … FOR UPDATE` ⇒ (a) cần quyền ghi (vai chỉ-đọc báo permission denied),
      // (b) giữ khoá dòng bài suốt lúc chạy, chặn nhịp xem của mọi người đang học bài đó. `FOR UPDATE` không được phép trong
      // giao dịch READ ONLY nên không thể "lỡ" thêm lại: PostgreSQL sẽ từ chối.
      if (!i.apply) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [bai] = i.apply
        ? await tx.$queryRaw<{ rev: number; durationSec: number | null }[]>`
            SELECT "mediaRevision" AS "rev", "durationSec" FROM "TrnLesson" WHERE "id" = ${i.lessonId} FOR UPDATE`
        : await tx.$queryRaw<{ rev: number; durationSec: number | null }[]>`
            SELECT "mediaRevision" AS "rev", "durationSec" FROM "TrnLesson" WHERE "id" = ${i.lessonId}`;
      if (!bai) throw new LoiDoiNguon("NOT_FOUND", "Không tìm thấy bài học");
      if (i.tuRev >= bai.rev) throw new LoiDoiNguon("NOT_FOUND", "Phiên bản nguồn phải cũ hơn phiên bản hiện tại của bài");

      const [r] = await tx.$queryRaw<
        { khoiPhuc: number; daCo: number; donBitmap: number; ketThuc: number; khongHang: number; khacTL: number }[]
      >`
        SELECT
          count(*) FILTER (WHERE p."id" IS NOT NULL AND e."status" IN ('NOT_STARTED','IN_PROGRESS','OVERDUE')
                            AND p."mediaRevision" = ${bai.rev} AND p."coveredSec" = 0 AND p."status" = 'NOT_STARTED'
                            AND r."bitmapPurgedAt" IS NULL AND r."contentSec" = ${bai.durationSec ?? 0})::int AS "khoiPhuc",
          count(*) FILTER (WHERE p."id" IS NOT NULL AND e."status" IN ('NOT_STARTED','IN_PROGRESS','OVERDUE')
                            AND p."mediaRevision" = ${bai.rev} AND p."coveredSec" = 0 AND p."status" = 'NOT_STARTED'
                            AND r."bitmapPurgedAt" IS NULL AND r."contentSec" <> ${bai.durationSec ?? 0})::int AS "khacTL",
          count(*) FILTER (WHERE p."id" IS NOT NULL AND e."status" IN ('NOT_STARTED','IN_PROGRESS','OVERDUE')
                            AND p."mediaRevision" = ${bai.rev} AND (p."coveredSec" > 0 OR p."status" <> 'NOT_STARTED'))::int AS "daCo",
          count(*) FILTER (WHERE p."id" IS NOT NULL AND e."status" IN ('NOT_STARTED','IN_PROGRESS','OVERDUE')
                            AND p."mediaRevision" = ${bai.rev} AND p."coveredSec" = 0 AND p."status" = 'NOT_STARTED'
                            AND r."bitmapPurgedAt" IS NOT NULL)::int AS "donBitmap",
          count(*) FILTER (WHERE e."status" IN ('COMPLETED','COMPLETED_LATE','REVOKED'))::int AS "ketThuc",
          count(*) FILTER (WHERE p."id" IS NULL)::int AS "khongHang"
        FROM "TrnLessonProgressRevision" r
        JOIN "TrnEnrollment" e ON e."id" = r."enrollmentId"
        LEFT JOIN "TrnLessonProgress" p ON p."enrollmentId" = r."enrollmentId" AND p."lessonId" = r."lessonId"
        WHERE r."lessonId" = ${i.lessonId} AND r."mediaRevision" = ${i.tuRev}`;

      const ke: KeHoachKhoiPhuc = {
        khoiPhuc: r?.khoiPhuc ?? 0,
        boQua: {
          daCoTienDoMoi: r?.daCo ?? 0,
          banChupDaDonBitmap: r?.donBitmap ?? 0,
          luotDaKetThuc: r?.ketThuc ?? 0,
          khongCoHangHienHanh: r?.khongHang ?? 0,
          khacThoiLuong: r?.khacTL ?? 0,
        },
        daApDung: false,
      };
      if (!i.apply || ke.khoiPhuc === 0) return ke;

      const duoc = await tx.$queryRaw<{ enrollmentId: string }[]>`
        UPDATE "TrnLessonProgress" p SET
          "segmentBitmap" = r."segmentBitmap", "segmentSec" = r."segmentSec", "coveredSec" = r."coveredSec",
          "contentSec" = ${bai.durationSec ?? 0}, "totalWatchSec" = r."totalWatchSec", "maxPositionSec" = r."maxPositionSec",
          "seekCount" = r."seekCount", "blockedSeekCount" = r."blockedSeekCount",
          "attnAskedCount" = r."attnAskedCount", "attnPassedCount" = r."attnPassedCount", "cueLogJson" = r."cueLogJson",
          "status" = r."status", "firstStartedAt" = r."firstStartedAt", "completedAt" = r."completedAt", "verifiedAt" = r."verifiedAt",
          "updatedAt" = ${now}::timestamptz
        FROM "TrnLessonProgressRevision" r, "TrnEnrollment" e
        WHERE r."lessonId" = ${i.lessonId} AND r."mediaRevision" = ${i.tuRev}
          AND p."enrollmentId" = r."enrollmentId" AND p."lessonId" = r."lessonId"
          AND e."id" = r."enrollmentId" AND e."status" IN ('NOT_STARTED','IN_PROGRESS','OVERDUE')
          AND p."mediaRevision" = ${bai.rev} AND p."coveredSec" = 0 AND p."status" = 'NOT_STARTED'
          AND r."bitmapPurgedAt" IS NULL AND r."contentSec" = ${bai.durationSec ?? 0}
        RETURNING p."enrollmentId"`;
      await lamMoiPhanTramKhoa(tx, duoc.map((d) => d.enrollmentId));
      // Ghi đè tiến độ học (có thể đặt DONE/completedAt) KHÔNG được để lại vết nào ngoài bảng bản chụp: audit TRONG giao dịch, cùng sống
      // hoặc cùng chết với việc khôi phục. Không ghi mã nguồn.
      if (duoc.length > 0) {
        await writeAudit({
          tx,
          actor: { id: null, name: "Kịch bản khôi phục tiến độ (vận hành)" },
          module: "elearning",
          entityType: "TrnLesson",
          entityId: i.lessonId,
          action: "UPDATE",
          newValues: { khoiPhucTuPhienBan: i.tuRev, phienBanHienTai: bai.rev, daKhoiPhuc: duoc.length },
          reason: "Khôi phục tiến độ từ bản chụp bất biến (kịch bản vận hành)",
        });
      }
      return { ...ke, khoiPhuc: duoc.length, daApDung: true };
    },
    // Chạy thử: RepeatableRead cho ảnh chụp nhất quán giữa hai câu đọc; ghi thật giữ mức mặc định (đã có khoá dòng bài).
    i.apply
      ? { timeout: 60_000, maxWait: 15_000 }
      : { timeout: 60_000, maxWait: 15_000, isolationLevel: "RepeatableRead" },
  );
}
