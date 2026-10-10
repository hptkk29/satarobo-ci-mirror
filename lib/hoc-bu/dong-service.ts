// lib/hoc-bu/dong-service.ts — NƠI DUY NHẤT tạo và chuyển trạng thái MỘT dòng cần bù (MakeupNeed = MakeupLine). T05, 07/10/2026.
//
// Trước T05: 17 chỗ ghi `MakeupNeed` (6 chỗ ngoài test), 10 chỗ đổi `status` mà chỉ 6 chỗ ghi có điều kiện trạng thái cũ; tạo dòng sau
// điểm danh nằm NGOÀI giao dịch của điểm danh với lỗi bị nuốt (⇒ điểm danh "cần bù" mà không có dòng — TV-08); huỷ lớp cascade huỷ dòng
// và để `MakeupCaseStudent` mồ côi. Hai việc ở đây và chỉ hai việc đó:
//   1. `taoDongHocBu`       — tạo IDEMPOTENT (unique (học viên, buổi gốc) ⇒ tối đa MỘT dòng), mang NGUỒN + điểm danh gốc + khoá.
//   2. `chuyenTrangThaiDong` — đổi trạng thái theo BẢNG cạnh (`dong-trang-thai.ts`), ghi CÓ ĐIỀU KIỆN trạng thái cũ, lệch ⇒ ném.
//
// Gọi BÊN TRONG giao dịch của người gọi (điểm danh, duyệt phiếu, xếp case…): dòng và nguồn của nó commit hoặc rollback CÙNG nhau.
// Không `import "server-only"`: hai đường chết (`lms/makeup-service`, `lms/attendance-record`) còn được spec R3 nạp, mà cấu hình R3 không có shim.
import type { MakeupNeedStatus, MakeupSourceType, Prisma } from "@prisma/client";
import { publishEvent } from "@/lib/events/publish";
import { dieuKienBaoLuuTaiNgay } from "@/lib/bao-luu/dieu-kien-bao-luu";
import { laCanhHopLe, type LyDoChuyen } from "@/lib/hoc-bu/dong-trang-thai";
import { LoiHocBu } from "@/lib/hoc-bu/loi";

type Tx = Prisma.TransactionClient;

export type MaLoiDong = "DONG_DA_DOI" | "BUOI_KHONG_TON_TAI" | "CANH_KHONG_HOP_LE";

/**
 * Lỗi nghiệp vụ của dòng cần bù — `message` nói được thẳng với người dùng; ném ⇒ giao dịch của người gọi rollback. Kế thừa `LoiHocBu`
 * để mọi action đang bắt `LoiHocBu` hiện đúng câu này mà không phải sửa từng nơi.
 */
export class LoiDong extends LoiHocBu {
  constructor(
    readonly ma: MaLoiDong,
    message: string,
  ) {
    super(message);
    this.name = "LoiDong";
  }
}

export const cauDongDaDoi = "Buổi cần bù vừa được người khác xử lý — tải lại trang rồi làm lại.";

/**
 * Đổi trạng thái các dòng `ids` từ `tu` sang `sang` vì `lyDo`. Cạnh (tu, sang, lyDo) PHẢI nằm trong bảng, và ghi CÓ ĐIỀU KIỆN
 * `status = tu` (cùng `ngoai` nếu có): hai người cùng lúc thì chỉ một lượt ăn. Mặc định lệch số dòng ⇒ ném `DONG_DA_DOI`;
 * `chiNeuCo` = đường "thu hồi nếu còn" (vd. buổi gốc sửa sang có mặt) — không có dòng nào thì trả 0, không lỗi.
 */
export async function chuyenTrangThaiDong(
  tx: Tx,
  p: {
    ids: readonly string[];
    tu: MakeupNeedStatus;
    sang: MakeupNeedStatus;
    lyDo: LyDoChuyen;
    /** Điều kiện THÊM (vd. `waivedAt: null`). */
    ngoai?: Prisma.MakeupNeedWhereInput;
    /** Cột đi kèm cạnh (completedAt, waived*, usedQuota…). Không được chứa `status` — trạng thái do hàm này quyết. */
    them?: Omit<Prisma.MakeupNeedUncheckedUpdateManyInput, "status">;
    chiNeuCo?: boolean;
  },
): Promise<number> {
  if (!laCanhHopLe(p.tu, p.sang, p.lyDo)) {
    throw new LoiDong("CANH_KHONG_HOP_LE", `Không được chuyển dòng cần bù ${p.tu} → ${p.sang} vì "${p.lyDo}".`);
  }
  if (p.ids.length === 0) return 0;
  const r = await tx.makeupNeed.updateMany({
    where: { AND: [{ id: { in: [...p.ids] }, status: p.tu }, p.ngoai ?? {}] },
    data: { ...(p.them ?? {}), status: p.sang },
  });
  if (!p.chiNeuCo && r.count !== p.ids.length) throw new LoiDong("DONG_DA_DOI", cauDongDaDoi);
  // T11 — dòng rời "chờ xếp" thì đơn xin học bù của phụ huynh gắn với nó hết ý nghĩa: đóng ngay, CÙNG giao dịch (không để chiếm trần đơn mở của phụ huynh).
  if (r.count > 0) await dongYeuCauPhuHuynh(tx, p.ids, p.sang, p.lyDo);
  return r.count;
}

/**
 * Đóng đơn xin học bù (`ParentRequest` MAKEUP, còn PENDING) gắn với các dòng vừa chuyển sang `sang`:
 *   · SCHEDULED / COMPLETED ⇒ APPROVED ("đã xếp lịch" / "đã hoàn tất");  · CANCELLED ⇒ REJECTED (quản lý huỷ "không bù nữa", hoặc buổi gốc đã sửa sang có mặt).
 * Khớp theo `makeupNeedId`; đơn CŨ chưa có khoá (cùng học viên + `sessionId` = buổi gốc, `makeupNeedId` null) cũng đóng. Chỉ các dòng THỰC SỰ đang ở `sang`
 * (đường `chiNeuCo` có thể truyền id chưa đổi). Đơn đã xử lý (APPROVED/REJECTED/CANCELLED) KHÔNG bị đụng. Trả số đơn đã đóng.
 */
export async function dongYeuCauPhuHuynh(tx: Tx, ids: readonly string[], sang: MakeupNeedStatus, lyDo: LyDoChuyen): Promise<number> {
  if (sang === "PENDING" || ids.length === 0) return 0;
  const dong = await tx.makeupNeed.findMany({
    where: { id: { in: [...ids] }, status: sang },
    select: { id: true, studentId: true, missedSessionId: true },
  });
  if (dong.length === 0) return 0;
  const ket =
    sang === "CANCELLED"
      ? {
          status: "REJECTED" as const,
          response:
            lyDo === "TU_HUY_DA_CO_MAT"
              ? "Buổi học gốc đã được ghi nhận có mặt — không cần học bù."
              : "Trung tâm không tổ chức học bù cho buổi này.",
        }
      : {
          status: "APPROVED" as const,
          response:
            sang === "SCHEDULED"
              ? "Trung tâm đã xếp lịch học bù cho buổi này — xem ngày giờ ở mục Buổi học bù."
              : "Buổi học bù đã hoàn tất.",
        };
  const r = await tx.parentRequest.updateMany({
    where: {
      type: "MAKEUP",
      status: "PENDING",
      OR: [
        { makeupNeedId: { in: dong.map((d) => d.id) } },
        ...dong.map((d) => ({ studentId: d.studentId, sessionId: d.missedSessionId, makeupNeedId: null })),
      ],
    },
    data: { ...ket, handledByName: "Hệ thống", handledAt: new Date() },
  });
  return r.count;
}

/**
 * `BO_QUA_BAO_LUU` (BR-09): buổi nằm trong khoảng bảo lưu theo quy chế "không tính vắng, không trừ hạn mức bù" ⇒ KHÔNG ghi gì, không có dòng ⇒
 * `id`/`status` là `null`. Chỉ nguồn ABSENCE mới rơi vào nhánh này; mọi nguồn khác luôn có `id`.
 */
export type KetTaoDong =
  | { id: string; ket: "TAO" | "DA_CO" | "HOI_SINH"; status: MakeupNeedStatus }
  | { id: null; ket: "BO_QUA_BAO_LUU"; status: null };

/** Mốc cho dedupeKey của lần HỒI SINH: theo NGÀY — đổi ngày thì phụ huynh được báo lại, bấm Lưu nhiều lần trong ngày thì một tin. */
const mocHoiSinh = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Tạo dòng cần bù cho (học viên, buổi gốc) — IDEMPOTENT. `INSERT … ON CONFLICT DO NOTHING` (không `create` rồi bắt P2002 — lỗi trùng
 * khoá làm Postgres đánh dấu giao dịch HỎNG và câu đọc kế tiếp nổ `25P02`).
 *
 *  · `nguon` BẮT BUỘC: nguồn không suy lại được sau này (`note` bị ghi đè).
 *  · `originalAttendanceId`: điểm danh gốc (null với ORDER_CONVERSION/MANUAL). Dòng ĐÃ CÓ mà chưa liên kết thì được liên kết thêm.
 *  · `hoiSinh`: cho phép dựng lại dòng CANCELLED **không** `waivedAt`. Chỉ bật khi đây là một CHUYỂN TRẠNG THÁI thật ("học viên vừa
 *    được đánh vắng lại"), KHÔNG cho mỗi lần bấm Lưu. Dòng có `waivedAt` là quản lý CHỦ Ý huỷ — KHÔNG BAO GIỜ tự hồi sinh.
 *  · dòng SCHEDULED/COMPLETED giữ nguyên: đã hẹn buổi bù thì không được đặt lại sau lưng người xếp lịch.
 */
export async function taoDongHocBu(
  tx: Tx,
  p: {
    studentId: string;
    missedSessionId: string;
    nguon: MakeupSourceType;
    /**
     * Nhãn nguồn của CHƯƠNG TRÌNH BẢO LƯU (cột `MakeupNeed.nguon`, độc lập với `sourceType`). Hiện chỉ có `PHUC_HOC` (BR-22: buổi bù khi phục học vào lớp
     * đi trước). Dòng mang nhãn này MIỄN PHÍ — không HOLD/CONSUME lượt, không phí (`laDongMienPhi`). Gọi kèm `nguon: "OTHER"` để không lẫn với vắng thường.
     */
    nguonBaoLuu?: "PHUC_HOC";
    originalAttendanceId?: string | null;
    createdById?: string | null;
    note?: string | null;
    hoiSinh?: boolean;
    /** Mốc cho khoá phát sự kiện lần hồi sinh. Mặc định giờ thật — chỉ test cần truyền. */
    now?: Date;
  },
): Promise<KetTaoDong> {
  const sess = await tx.classSession.findUnique({
    where: { id: p.missedSessionId },
    select: { id: true, classId: true, lessonId: true, date: true, class: { select: { centerId: true, courseId: true, course: { select: { choPhepHocBu: true } } } } },
  });
  if (!sess) throw new LoiDong("BUOI_KHONG_TON_TAI", "Buổi học không tồn tại");

  // Bảo lưu theo quy chế (BR-09, Bảo lưu P4): buổi trong khoảng bảo lưu của em (kể cả khoảng LÙI NGÀY) không phát sinh nghĩa vụ bù. Đứng ở MỘT cửa
  // này để MỌI đường tạo dòng nguồn ABSENCE (điểm danh thật, `createMakeupNeed`) cùng được che — trước T05 luật nằm trong `createMakeupNeed`
  // và điểm danh thật đi qua nó; T05 chuyển điểm danh sang cửa này nên luật phải đi theo, nếu không bảo lưu bị bỏ qua mà không test nào đỏ.
  // Đứng TRƯỚC phép ghi đầu tiên.
  if (p.nguon === "ABSENCE") {
    // Đọc TRONG giao dịch của người gọi, cùng điều kiện với `daBaoLuuTaiBuoi` (`dieuKienBaoLuuTaiNgay` — một nguồn).
    const baoLuu = await tx.studentReserve.findFirst({
      where: { studentId: p.studentId, enrollment: { classId: sess.classId }, ...dieuKienBaoLuuTaiNgay(sess.date) },
      select: { id: true },
    });
    if (baoLuu) return { id: null, ket: "BO_QUA_BAO_LUU", status: null };
  }

  const tao = await tx.makeupNeed.createMany({
    data: [
      {
        studentId: p.studentId,
        classId: sess.classId,
        centerId: sess.class.centerId,
        courseId: sess.class.courseId,
        missedSessionId: sess.id,
        missedLessonId: sess.lessonId,
        sourceType: p.nguon,
        nguon: p.nguonBaoLuu ?? null,
        originalAttendanceId: p.originalAttendanceId ?? null,
        note: p.note ?? null,
        createdById: p.createdById ?? null,
      },
    ],
    skipDuplicates: true,
  });
  const dong = await tx.makeupNeed.findUniqueOrThrow({
    where: { studentId_missedSessionId: { studentId: p.studentId, missedSessionId: sess.id } },
    select: { id: true, status: true, waivedAt: true, originalAttendanceId: true },
  });

  let ket: KetTaoDong["ket"] = tao.count === 1 ? "TAO" : "DA_CO";
  let status = dong.status;
  const now = p.now ?? new Date();

  if (ket === "DA_CO") {
    if (p.note != null) await tx.makeupNeed.updateMany({ where: { id: dong.id }, data: { note: p.note } });
    if (p.originalAttendanceId && dong.originalAttendanceId === null) {
      await tx.makeupNeed.updateMany({
        where: { id: dong.id, originalAttendanceId: null },
        data: { originalAttendanceId: p.originalAttendanceId },
      });
    }
    if (dong.status === "CANCELLED" && dong.waivedAt === null && p.hoiSinh === true) {
      await chuyenTrangThaiDong(tx, {
        ids: [dong.id],
        tu: "CANCELLED",
        sang: "PENDING",
        lyDo: "HOI_SINH_VANG_LAI",
        ngoai: { waivedAt: null },
        them: { makeupSessionId: null, completedAt: null },
      });
      ket = "HOI_SINH";
      status = "PENDING";
    }
  }

  // Báo PH nhu cầu bù đã ghi nhận — CHỈ nguồn ABSENCE (giữ đúng hành vi trước T05; ma trận thông báo thật sự là T13). Ghi CÙNG
  // giao dịch ⇒ rollback nghiệp vụ thì không có sự kiện. Lần hồi sinh là MỘT SỰ KIỆN MỚI: giữ nguyên khoá cũ thì outbox nuốt luôn.
  // T13: khoá TẮT học bù ⇒ buổi vắng không cần bù ⇒ KHÔNG báo phụ huynh "đã ghi nhận yêu cầu học bù" (dòng vẫn được tạo — checker TV-09 nhìn thấy).
  if (p.nguon === "ABSENCE" && sess.class.course.choPhepHocBu) {
    await publishEvent(
      "makeup.requested",
      { makeupNeedId: dong.id, studentId: p.studentId, centerId: sess.class.centerId },
      { tx, dedupeKey: `makeup.requested:${dong.id}${ket === "HOI_SINH" ? `:revived-${mocHoiSinh(now)}` : ""}` },
    );
  }
  return { id: dong.id, ket, status };
}

/**
 * Buổi gốc sửa sang CÓ MẶT ⇒ thu hồi dòng PENDING còn treo của (học viên, buổi). Chỉ PENDING: dòng đã SCHEDULED (đã hẹn buổi bù với
 * phụ huynh) hoặc COMPLETED giữ nguyên để người xếp bù xử lý, không tự huỷ sau lưng. Không có dòng thì không làm gì.
 */
export async function thuHoiDongKhiCoMat(tx: Tx, p: { studentId: string; missedSessionId: string }): Promise<number> {
  const dong = await tx.makeupNeed.findUnique({
    where: { studentId_missedSessionId: { studentId: p.studentId, missedSessionId: p.missedSessionId } },
    select: { id: true, status: true },
  });
  if (!dong || dong.status !== "PENDING") return 0;
  return chuyenTrangThaiDong(tx, {
    ids: [dong.id],
    tu: "PENDING",
    sang: "CANCELLED",
    lyDo: "TU_HUY_DA_CO_MAT",
    chiNeuCo: true,
  });
}
