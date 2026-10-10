// lib/trial/service.ts — R7-02: service layer cho LỚP TRẢI NGHIỆM V2 (N buổi).
//
// Sinh buổi theo lịch TUẦN (mỗi 7 ngày) từ startDate, né Holiday (dời buổi +7).
// Ghi danh 1 con / 1 lớp ACTIVE (partial-unique ở DB) — bắt P2002 thành lỗi VI.
// FL-R2 (QĐ-R2-W3): tiến độ do markAttendance lo per-lead (idempotent): ≥1 buổi PRESENT →
// con IN_PROGRESS + lead "Đang học thử"; đủ buổi (totalSessions per-lead) → con ATTENDED +
// lead "Chờ quyết định" (AWAITING_DECISION) NGAY (TBD-2). TRIAL_ATTENDED để dành lead đã chốt.
import { Prisma } from "@prisma/client";
import { laLopTheoKhung, thuocCase } from "@/lib/trial/nghia-null";
import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import { baoDaoTaoBuoiChuaCoGiaoVien } from "./notify-training";
import { tenLopTrial, tenLopTrialTheoNgay } from "@/lib/trial/lop-moi";
import { teacherCenterAssignmentError } from "@/lib/teachers/center-filter";
import { nextSeq, yy } from "@/lib/codegen";
import { publishEvent } from "@/lib/events/publish";
import { writeAudit } from "@/lib/audit/audit-log";
import { LEAD_PIPELINE_EXIT_STATUSES } from "@/lib/leads/status";
import { setLeadStatus } from "@/lib/leads/set-status";
import { danhGiaDoiLich, saleDuocDeXuat } from "@/lib/trial/reschedule-rules";
import { getSetting } from "@/lib/settings/service";

// ─── PURE helpers (deterministic — KHÔNG new Date() ở top) ─────────────────────

/** "YYYY-MM-DD" theo local (so khớp Holiday). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Ngày của N buổi trải nghiệm: TUẦN (mỗi 7 ngày) kể từ `startDate`, BỎ QUA ngày
 * rơi vào Holiday — buổi đó DỜI tới tuần kế (+7). Deterministic.
 */
export function buildTrialSessionDates(startDate: Date, count: number, holidays: Date[]): Date[] {
  const out: Date[] = [];
  if (count <= 0) return out;
  const holiSet = new Set(holidays.map(ymd));
  const cur = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const maxIter = count + holidays.length + 400; // chặn vòng lặp vô hạn
  let i = 0;
  while (out.length < count && i < maxIter) {
    i++;
    if (!holiSet.has(ymd(cur))) {
      out.push(new Date(cur));
    }
    cur.setDate(cur.getDate() + 7);
  }
  return out;
}

/**
 * Quyết định vượt sĩ số (PURE): tại/quá sức chứa + KHÔNG override.
 *
 * `capacity === null` = lớp KHÔNG giới hạn sĩ số (mặc định từ 28/08, khi trường sĩ số
 * rời khỏi form tạo lớp). Coi null là 0 thì lớp mới tạo chặn ngay học viên đầu tiên và
 * báo "Vượt sĩ số" — người dùng không có cách nào đoán ra nguyên nhân.
 */
export function isOverCapacity(
  activeCount: number,
  capacity: number | null,
  allowOverride: boolean,
): boolean {
  if (capacity === null) return false;
  return !allowOverride && activeCount >= capacity;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Mốc UTC 00:00 của NGÀY hôm nay theo giờ VN — khớp cột @db.Date của buổi Trial. */
export function vnTodayUtc(now = new Date()): Date {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

type DbClient = Prisma.TransactionClient | typeof db;

/** Mã cơ sở cho code lớp: Center.code (vd "CS1") → fallback sanitize id. */
function sanitizeCenter(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "CS";
}


async function actorName(actorId: string | null | undefined, client: DbClient = db): Promise<string> {
  if (!actorId) return "system";
  const u = await client.user.findUnique({ where: { id: actorId }, select: { name: true } });
  return u?.name ?? actorId;
}

// ─── Config ────────────────────────────────────────────────────────────────────

// 28/08/2026 — GỠ `getActiveTrialConfig` + `setTrialProgramConfig`.
//
// Khối "Cấu hình số buổi (mặc định)" ở màn Lớp Trial đã bỏ theo chốt của chủ dự án: form
// tạo lớp nhập thẳng số buổi nào cũng được, nên một con số mặc định cấp hệ thống chỉ còn
// là ô người dùng phải đọc rồi bỏ qua. Hai hàm này không còn ai gọi.
//
// ⚠️ Bảng `TrialProgramConfig` và cột `TrialClassV2.configId` GIỮ NGUYÊN — bỏ cột trên
// bảng đang có dữ liệu prod là việc của một đợt drop riêng (luật cứng #4, nếp 2 pha).
// `createTrialClass` vẫn nhận `configId`, màn tạo lớp truyền `null`.

/**
 * Tạo lớp trải nghiệm. 28/08 — chỉ còn CƠ SỞ + KHOÁ; tên tự sinh, giờ/phòng/GV/sĩ số
 * chuyển xuống từng buổi.
 */
export async function createTrialClass(params: {
  centerId: string;
  /** Khoá trải nghiệm (= khoá quan tâm của khách). */
  courseId?: string | null;
  /**
   * Tên lớp do người dùng GÕ. Bỏ trống ⇒ sinh theo quy ước `tenLopTrial`.
   *
   * ── ĐẢO CHỐT 28/08/2026 (chủ dự án chốt lại 18/09) ────────────────────────────────
   * Chốt cũ: "Tên lớp KHÔNG nhận từ client… Cho client gửi tên là mời hai lớp trùng tên
   * và mời lệch khỏi quy ước". Nay chủ dự án yêu cầu "được sửa và tự do điều chỉnh tên
   * lớp", và nếp repo là quyết định ra SAU thắng.
   *
   * Hai lo ngại của chốt cũ được xử lý chứ không bỏ qua:
   *  · LỆCH QUY ƯỚC — ô nhập ĐIỀN SẴN tên theo quy ước, nên ai không quan tâm thì bấm
   *    lưu là ra đúng tên cũ. Chỉ người CỐ Ý sửa mới lệch, và đó là điều được yêu cầu.
   *  · TRÙNG TÊN — đã đo: `TrialClassV2.name` KHÔNG `@unique`, chỉ `code` mới unique
   *    (`prisma/schema.prisma`). Nên trùng tên là chuyện KHÓ NHÌN, không phá dữ liệu:
   *    định danh thật của lớp vẫn là `code`, và `code` vẫn do server cấp trong
   *    transaction cùng bộ đếm như trước. KHÔNG thêm ràng buộc unique ở đợt này —
   *    ALTER trên bảng có dữ liệu prod là việc riêng, và chặn cứng tên trùng sẽ cản
   *    đúng thứ vừa được mở ra.
   */
  name?: string | null;
  // FL-R2 (QĐ-R2-1): slot tái sử dụng — startDate tuỳ chọn (null = không gắn ngày cố định).
  // ĐẢO 22/09/2026: đường tạo lớp của màn quản trị NAY LUÔN truyền ngày + khung giờ
  // (xem `createClassSchema`). Giữ `null` được vì còn đường seed/test gọi không ngày.
  startDate?: Date | null;
  /** Khung giờ LỚP mở (bao ngoài mọi case). `null` = lớp cũ, không chặn case theo khung. */
  startTime?: string | null;
  endTime?: string | null;
  configId?: string | null;
  actorId: string;
}): Promise<{ ok: boolean; error?: string; trialClassId?: string }> {
  try {
    // Số buổi khai trước KHÔNG còn ý nghĩa: buổi thêm tay từng cái ở màn chi tiết, và
    // cột hiển thị nay đếm buổi CÓ THẬT. Giữ 0 để cột cũ không nói dối.
    const sessionCount = 0;
    const trialClassId = await db.$transaction(async (tx) => {
      // mã cơ sở cho code.
      const center = await tx.center.findUnique({
        where: { id: params.centerId },
        select: { code: true },
      });
      const cc = sanitizeCenter(center?.code ?? params.centerId);
      // 29/08 — tên lớp mang cả MÃ KHOÁ QUAN TÂM (`CS2-sata4-Lớp trial 3`). Đọc `slug`
      // chứ không `name`: `name` là câu tiếng Việt có dấu ("Sata 4 — Lập trình khối"),
      // nhét vào tên lớp thì vừa dài vừa mang ký tự lạ đi thẳng vào phiếu gửi phụ huynh.
      const khoa = params.courseId
        ? await tx.course.findUnique({
            where: { id: params.courseId },
            select: { slug: true },
          })
        : null;
      const y = yy();
      const seq = await nextSeq(`TRIAL:${cc}:${y}`, tx);
      const code = `TRIAL-${cc}-${y}-${String(seq).padStart(3, "0")}`;

      const trialClass = await tx.trialClassV2.create({
        data: {
          code,
          // Tên theo quy ước `Cơ sở-Khoá-Lớp trial số`, dùng CHÍNH số thứ tự đã cấp
          // cho `code` — hai thứ đi cùng một bộ đếm nên không bao giờ lệch nhau.
          // Người gõ thì lấy tên họ gõ; bỏ trống thì về quy ước cũ (cùng bộ đếm với
          // `code` nên số thứ tự không bao giờ lệch).
          // 23/09 — lớp CÓ NGÀY (mở theo khung) đặt tên theo NGÀY: "CS1-Lớp trial
          // 23/09/2026" (chủ dự án). `startDate` là `@db.Date` = UTC 00:00 của ngày VN,
          // nên `toISOString().slice(0, 10)` ra đúng ngày đó.
          name:
            params.name?.trim() ||
            (params.startDate
              ? tenLopTrialTheoNgay(cc, khoa?.slug ?? null, params.startDate.toISOString().slice(0, 10))
              : tenLopTrial(cc, khoa?.slug ?? null, seq)),
          centerId: params.centerId,
          courseId: params.courseId ?? null,
          startDate: params.startDate ?? null,
          // 28/08 — sĩ số/GV/phòng để null: chúng là thuộc tính của TỪNG BUỔI.
          // 22/09 — riêng GIỜ thì ĐẢO: lớp mang KHUNG BAO để Sale chọn chỗ hẹn khách, còn
          // giờ cụ thể của từng case vẫn nằm ở `TrialClassSession`. Hai thứ khác nhau.
          startTime: params.startTime ?? null,
          endTime: params.endTime ?? null,
          // 23/09 — dấu phân loại lớp (xem lib/trial/nghia-null.ts). TRUE khi và chỉ khi
          // được truyền ĐỦ ngày + khung: ba đường mở lớp mới (form một ngày, cả kỳ, Excel)
          // đều truyền đủ, còn seed/test cũ thì không. Lớp tạo trước hôm nay giữ FALSE
          // (mặc định của migration) dù có giờ cấp lớp.
          theoKhung: Boolean(params.startDate && params.startTime && params.endTime),
          capacity: null,
          teacherId: null,
          roomId: null,
          configId: params.configId ?? null,
          sessionCount,
          // 18/09 — Sale/người TẠO lớp, để bảng danh sách trả lời được "lớp của ai".
          // Lớp tạo trước hôm nay để NULL và màn danh sách rơi về suy từ Sale phụ trách
          // lead của các con trong lớp (`_lib/sale-cua-lop.ts`).
          createdById: params.actorId,
        },
        select: { id: true },
      });

      // 28/08 — GỠ nhánh tự sinh buổi theo `startDate`.
      //
      // Nhánh đó cần giờ/phòng/GV ở CẤP LỚP để rót xuống từng buổi, mà ba thứ ấy nay
      // không còn tồn tại ở cấp lớp. Giữ lại thì buổi sinh ra trắng giờ — tệ hơn là
      // không sinh, vì một buổi không giờ vẫn hiện trên lịch giáo viên.
      // Lớp trải nghiệm vốn là slot tái sử dụng: buổi thêm tay ở màn chi tiết.
      return trialClass.id;
    });
    return { ok: true, trialClassId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi tạo lớp trải nghiệm" };
  }
}

// ─── Buổi ad-hoc (QĐ-R2-1: slot tái sử dụng — lớp không gắn ngày, buổi thêm tay) ──

/**
 * #6 — báo GV qua chuông StaffNotification khi được gán buổi/lớp trải nghiệm
 * (mẫu notifyTeacherAttendanceEdited). Non-fatal: lỗi notify không phá nghiệp vụ.
 */
export async function notifyTrialTeacherAssigned(params: {
  teacherId: string;
  title: string;
  body: string;
  dedupeKey: string;
  href?: string;
  /** Id buổi/lớp trải nghiệm mà thông báo nói tới — để sau này thu hồi khi nó bị xoá. */
  entityId?: string;
}): Promise<void> {
  // `href` phải viết theo đường ADMIN clean-URL: chuông admin push thẳng, chuông site GV
  // đổi qua `teacherHref()`. Mặc định cũ "/teacher/trial" sai cả hai đầu — trên host admin
  // bị route-policy 308 sang public rồi 404, còn `teacherHref` không nhận diện được nên
  // trả null (thông báo thành text chết). "/lop-trial" là màn admin có thật và
  // teacherHref map đúng sang "/trial" của site GV.
  //
  // ⚠️ GĐ6 — thông báo CŨ trong DB vẫn mang href "/trials". Đó là lý do route cũ được
  // giữ dưới dạng chuyển hướng thay vì xoá, và `teacherHref` vẫn nhận diện case cũ.
  const href = params.href ?? "/lop-trial";
  try {
    await notifyStaff({
      userIds: [params.teacherId],
      dedupeKey: params.dedupeKey,
      category: "CLASS",
      title: params.title,
      body: params.body,
      href,
      entityId: params.entityId ?? null,
      // `reopen` — gán lại/đổi nội dung là một lần phân công MỚI cho chính GV đó; đọc bản
      // cũ rồi không có nghĩa là đã biết ca mới.
      reopen: true,
    });
  } catch {
    // nuốt lỗi notify — không chặn luồng chính.
  }
}

/**
 * #1 (BLOCKER go-live) — thêm 1 buổi ad-hoc cho lớp trải nghiệm slot-tái-sử-dụng
 * (startDate null → createTrialClass KHÔNG sinh buổi; trước đây KHÔNG có đường nào
 * tạo TrialClassSession ⇒ roster/lịch GV trống trơn). Buổi nhận GV/phòng của lớp
 * làm mặc định; GV (nếu có) phải CÙNG cơ sở lớp (R2-RBAC-3).
 */
export async function addTrialSession(params: {
  trialClassId: string;
  date: Date; // UTC 00:00 của ngày VN (@db.Date)
  startTime: string;
  endTime: string;
  /** undefined → mặc định GV của lớp; null → buổi chưa gán GV. */
  teacherId?: string | null;
  /** undefined → mặc định phòng của lớp; null → không phòng. */
  roomId?: string | null;
  actorId: string;
}): Promise<{ ok: boolean; error?: string; sessionId?: string }> {
  try {
    const cls = await db.trialClassV2.findUnique({
      where: { id: params.trialClassId },
      select: { id: true, name: true, centerId: true, teacherId: true, roomId: true, status: true },
    });
    if (!cls) return { ok: false, error: "Lớp trải nghiệm không tồn tại" };
    if (cls.status === "CANCELLED" || cls.status === "COMPLETED") {
      return { ok: false, error: "Lớp đã kết thúc/đã huỷ — không thể thêm buổi" };
    }

    const teacherId = params.teacherId === undefined ? cls.teacherId : params.teacherId;
    // R2-RBAC-3 — GV của buổi phải CÙNG cơ sở lớp (chặn gán chéo CS1↔CS2).
    if (teacherId) {
      const t = await db.user.findUnique({
        where: { id: teacherId },
        select: { centerId: true },
      });
      const err = teacherCenterAssignmentError(cls.centerId, [
        { id: teacherId, centerId: t?.centerId },
      ]);
      if (err) return { ok: false, error: err };
    }
    const roomId = params.roomId === undefined ? cls.roomId : params.roomId;

    const sessionId = await db.$transaction(async (tx) => {
      const agg = await tx.trialClassSession.aggregate({
        where: { trialClassId: params.trialClassId },
        _max: { seq: true },
      });
      const created = await tx.trialClassSession.create({
        data: {
          trialClassId: params.trialClassId,
          seq: (agg._max.seq ?? 0) + 1,
          date: params.date,
          startTime: params.startTime,
          endTime: params.endTime,
          roomId,
          teacherId,
          // 23/09/2026 — AI TAO case nay. Luat "Sale chi sua/xoa case cua chinh minh"
          // tua vao cot nay; khong ghi thi moi case moi deu thanh "khong ro cua ai" va
          // roi thang vao nhanh chi-Quan-ly cua `quyenSuaCase`.
          createdById: params.actorId,
        },
        select: { id: true },
      });
      return created.id;
    });

    const dateStr = params.date.toLocaleDateString("vi-VN", { timeZone: "UTC" });
    const moTaBuoi = `${dateStr} ${params.startTime}–${params.endTime}`;

    // #6 — báo GV được gán buổi (không tự báo mình).
    if (teacherId && teacherId !== params.actorId) {
      await notifyTrialTeacherAssigned({
        teacherId,
        title: "Bạn được phân công buổi trải nghiệm",
        body: `Buổi ${moTaBuoi} · lớp ${cls.name}.`,
        dedupeKey: `trial-session.assigned:${sessionId}`,
        entityId: sessionId,
      });
    } else if (!teacherId) {
      // #6b (14/09/2026) — BUỔI KHÔNG CÓ AI DẠY. Trước đợt này nhánh đó im lặng tuyệt đối, và
      // nó là đường MẶC ĐỊNH chứ không phải ca hiếm: ô "Giáo viên" ở form để trống sẵn
      // (`add-session-form.tsx`), lớp trải nghiệm sinh ra đã `teacherId: null` (xem
      // `createTrialClass` bên trên) và KHÔNG màn nào gán giáo viên cấp lớp. Tức bấm "Thêm
      // buổi" theo đường tự nhiên nhất là tạo ra một buổi không ai dạy, không ai biết.
      //
      // Chủ dự án đi đúng vào đường này ngày 13/09 rồi kết luận kênh thông báo hỏng.
      //
      // Cố ý KHÔNG báo cho chính người vừa bấm — họ vừa làm việc đó, họ biết rồi; người cần
      // biết là bộ phận Đào tạo, người đi phân công.
      await baoDaoTaoBuoiChuaCoGiaoVien({
        sessionId,
        centerId: cls.centerId,
        className: cls.name,
        moTaBuoi,
      });
    }
    return { ok: true, sessionId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi thêm buổi trải nghiệm" };
  }
}

// ─── Ghi danh ─────────────────────────────────────────────────────────────────

/** Gói dữ kiện cho tin "có em mới trong ca của bạn" — xem #GV-MỚI bên dưới. */
type TinBaoGvCaMoi = {
  teacherId: string;
  childName: string;
  className: string;
  enrollmentId: string;
  moTaBuoi: string;
};

export async function enrollLeadChild(params: {
  trialClassId: string;
  leadChildId: string;
  addedById: string;
  allowOverride?: boolean;
  // FL-R2 (QĐ-R2-W3): ngưỡng "đủ buổi" cấu hình RIÊNG từng lead (không lấy sessionCount lớp).
  // Bỏ trống → fallback sessionCount của lớp.
  totalSessions?: number;
  // #2 — buổi (TrialClassSession) cụ thể. Bỏ trống → AUTO-GÁN buổi SCHEDULED gần nhất
  // (roster GV ghép HV CHỈ qua scheduledSessionId — enroll không buổi = HV tàng hình).
  sessionId?: string | null;
}): Promise<{ ok: boolean; error?: string; overCapacity?: boolean }> {
  const allowOverride = params.allowOverride ?? false;
  try {
    // #GV-MỚI — gói tin báo giáo viên ĐI thẳng qua giá trị trả về của transaction, không
    // qua biến ngoài: TypeScript không theo được phép gán bên trong callback nên biến
    // đó luôn bị thu về `null`. GỬI thì sau khi commit — gửi trong tx là chuông hỏng
    // kéo theo rollback cả lượt xếp lớp.
    const { tin, ...ket } = await db.$transaction(async (tx): Promise<{
      ok: boolean;
      error?: string;
      overCapacity?: boolean;
      tin?: TinBaoGvCaMoi;
    }> => {
      const cls = await tx.trialClassV2.findUnique({
        where: { id: params.trialClassId },
        // `name` + `teacherId`: dựng nội dung tin báo giáo viên ở cuối hàm (xem khối #GV-MỚI).
        select: {
          id: true,
          name: true,
          capacity: true,
          centerId: true,
          sessionCount: true,
          teacherId: true,
          status: true,
          theoKhung: true,
        },
      });
      if (!cls) return { ok: false, error: "Lớp trải nghiệm không tồn tại" };
      // 23/09 — lớp đã kết thúc thì không nhận thêm bé. Trước đây cửa này không đọc
      // trạng thái lớp: sau khi Quản lý huỷ lớp, các case vẫn SCHEDULED (huỷ lớp không
      // huỷ buổi) nên ô thêm học viên vẫn hiện, và gắn vào là sinh lại một ghi danh
      // ACTIVE trong lớp đã huỷ — chiếm lại đúng chỗ partial-unique mà lượt huỷ lớp sinh
      // ra để trả lại, và giáo viên còn nhận tin "có học viên mới".
      if (cls.status === "CANCELLED" || cls.status === "COMPLETED") {
        return { ok: false, error: "Lớp trải nghiệm đã kết thúc — không xếp thêm học viên" };
      }

      const activeCount = await tx.trialEnrollment.count({
        where: { trialClassId: params.trialClassId, status: "ACTIVE" },
      });
      if (isOverCapacity(activeCount, cls.capacity, allowOverride)) {
        return { ok: false, overCapacity: true, error: "Vượt sĩ số" };
      }

      // Buổi của ghi danh. `null` = học TOÀN BỘ buổi của lớp — đây là MẶC ĐỊNH từ
      // 28/08 (chủ dự án: "add vào là add toàn bộ buổi của lớp trải nghiệm đó").
      //
      // ⚠️ ĐẢO nếp #2. Bản cũ AUTO-GÁN buổi gần nhất khi không truyền `sessionId`, với
      // lý do ghi rõ: "GV chỉ thấy HV qua scheduledSessionId — enroll không buổi = HV
      // tàng hình". Lý do đó nay KHÔNG còn đúng: roster giáo viên đã xếp ghi danh
      // `scheduledSessionId = null` vào MỌI buổi của lớp (xem `lib/lms/teacher-schedule.ts`),
      // và bảng điểm danh vốn đã hiểu null là "hiện ở mọi buổi". Gỡ auto-gán mà KHÔNG
      // sửa roster trước là dựng lại đúng lỗi tàng hình đó — hai thay đổi đi cùng một
      // commit là có chủ đích.
      //
      // Xếp riêng một buổi vẫn làm được: truyền `sessionId` (màn chi tiết lớp, dời lịch).
      const scheduledSessionId: string | null = params.sessionId ?? null;
      if (scheduledSessionId) {
        // Buổi truyền vào phải thuộc đúng lớp đang xếp (chống chọn buổi lớp khác).
        const ses = await tx.trialClassSession.findUnique({
          where: { id: scheduledSessionId },
          select: { trialClassId: true, status: true },
        });
        if (!ses || ses.trialClassId !== params.trialClassId) {
          return { ok: false, error: "Buổi học không thuộc lớp đã chọn" };
        }
        // 23/09 — CÙNG luật với cửa chuyển case (`danhGiaDoiLich` đòi SCHEDULED). Hai
        // cửa đưa bé vào một case mà theo hai luật khác nhau là chỗ để lọt: gắn thẳng
        // vào case ĐÃ HUỶ thì bé kẹt từ đầu (case đó đã biến khỏi lịch giáo viên).
        if (ses.status !== "SCHEDULED") {
          return {
            ok: false,
            error: "Case này không còn nhận học viên (đã huỷ hoặc đã xong) — chọn case khác",
          };
        }
      }

      const enrollment = await tx.trialEnrollment.create({
        data: {
          trialClassId: params.trialClassId,
          leadChildId: params.leadChildId,
          addedById: params.addedById,
          scheduledSessionId,
        },
      });
      const child = await tx.leadChild.update({
        where: { id: params.leadChildId },
        data: { trialStatus: "SCHEDULED" },
        select: { fullName: true },
      });

      // #GV-MỚI (03/09/2026) — BÁO GIÁO VIÊN có em vừa rơi vào ca của mình.
      //
      // Trước bản này, xếp con vào lớp chỉ phát `trial.assigned` — mà tin đó gửi cho
      // SALE phụ trách lead, không phải giáo viên. Lớp trải nghiệm là **slot tái sử
      // dụng**: giáo viên được gán từ lâu, con mới được xếp vào sau ⇒ câu hỏi "có em
      // nào vào ca của tôi chưa" không có tin nào trả lời, giáo viên phải tự mở
      // /teacher/trial mà xem.
      //
      // Người nhận lấy từ BUỔI, không phải từ lớp: từ 28/08 giờ/sĩ số/giáo viên nằm ở
      // TỪNG BUỔI (`TrialClassSession`), `TrialClassV2.teacherId` chỉ còn là mặc định cũ.
      //
      // ⚠️ HAI KIỂU GHI DANH — `scheduledSessionId` null KHÔNG còn nghĩa là "chưa xếp buổi":
      //   · null  = học TOÀN BỘ buổi của lớp (MẶC ĐỊNH từ 28/08, chủ dự án chốt);
      //   · có giá trị = ghim vào đúng một buổi (màn chi tiết lớp, dời lịch).
      // Bản đầu của khối này (03/09) viết khi auto-gán còn sống nên đọc thẳng
      // `findUnique({ id: scheduledSessionId })` — sau khi nhập với 28/08 thì đường thường
      // gặp nhất lại là null. Kiểu dữ liệu bắt được chỗ này; đừng gỡ bớt.
      //
      // Học toàn bộ buổi thì báo cho người dạy BUỔI SẮP TỚI — người gặp bé đầu tiên.
      // Các buổi sau có thể khác người, nhưng bắn tin cho mọi giáo viên của lớp là biến
      // một việc thành một đợt thông báo; ai dạy buổi sau vẫn thấy bé ở /teacher/trial.
      // 23/09 — lớp THEO KHUNG mà bé chưa có case (NULL = "chưa xếp case", xem
      // `lib/trial/nghia-null.ts`) thì CHƯA có giáo viên nào dạy bé. Bản cũ vẫn báo GV
      // của buổi sắp tới "học toàn bộ buổi" — sai người, và khi bé được xếp vào case
      // khác thì người đó không bao giờ được báo lại. Việc báo dời sang lúc XẾP CASE
      // (`xepCaseHocVienAction`).
      const chuaCoCase = !scheduledSessionId && laLopTheoKhung(cls);
      const buoi = chuaCoCase
        ? null
        : scheduledSessionId
        ? await tx.trialClassSession.findUnique({
            where: { id: scheduledSessionId },
            select: { teacherId: true, date: true, startTime: true, endTime: true },
          })
        : await tx.trialClassSession.findFirst({
            where: {
              trialClassId: params.trialClassId,
              status: "SCHEDULED",
              date: { gte: vnTodayUtc() },
            },
            orderBy: [{ date: "asc" }, { seq: "asc" }],
            select: { teacherId: true, date: true, startTime: true, endTime: true },
          });
      const gvId = chuaCoCase ? null : (buoi?.teacherId ?? cls.teacherId ?? null);
      // Không tự báo mình: giáo viên vừa tự xếp con vào ca của chính mình thì biết rồi.
      // Lớp chưa có buổi nào sắp tới và cũng không có GV mặc định ⇒ không có ai để báo.
      const tin: TinBaoGvCaMoi | undefined =
        gvId && gvId !== params.addedById
          ? {
              teacherId: gvId,
              childName: child.fullName,
              className: cls.name,
              enrollmentId: enrollment.id,
              // MỆNH ĐỀ ĐẦY ĐỦ, không phải mảnh để nơi gọi ghép thêm chữ "buổi" vào trước:
              // hai nhánh dưới đây mở đầu khác nhau ("buổi …" vs "toàn bộ buổi …"). Bản
              // trước để nơi gọi ghép cứng `buổi ${…}` nên đường học-cả-lớp bắn ra
              // "· buổi toàn bộ buổi, bắt đầu …" — đo được ở lượt nghiệm thu 04/09.
              //
              // `date` là @db.Date (nửa đêm UTC của ngày VN) ⇒ format PHẢI ép timeZone UTC.
              moTaBuoi: !buoi
                ? "học toàn bộ buổi của lớp"
                : `${scheduledSessionId ? "buổi " : "học toàn bộ buổi, bắt đầu "}${buoi.date.toLocaleDateString("vi-VN", { timeZone: "UTC" })} ${buoi.startTime}–${buoi.endTime}`,
            }
          : undefined;
      // FL-R2 (item 6) — mở/ghi lịch sử học thử per-lead (giữ kể cả khi rời pipeline).
      // totalSessions chốt tại lúc gán; nếu đã có history (lead quay lại) → giữ count cũ.
      //
      // ⚠️ TRẦN ÁP Ở ĐÂY, không chỉ ở tầng action.
      // Chủ dự án chốt trần 4 buổi (đổi được qua cấu hình `crm.trialMaxSessions`).
      // Tầng action chỉ kiểm khi người dùng GÕ SỐ vào ô; bỏ trống ô — thao tác THƯỜNG
      // NHẤT — thì rơi xuống `cls.sessionCount`, mà số buổi của lớp cho phép tới 20.
      // Không kẹp ở đây thì chốt câu 5 không có hiệu lực trên luồng chính.
      const tranBuoi = await getSetting("crm.trialMaxSessions");
      const soBuoiMongMuon =
        params.totalSessions && params.totalSessions > 0
          ? params.totalSessions
          : cls.sessionCount;
      const totalSessions = Math.min(soBuoiMongMuon, tranBuoi);
      await tx.leadTrialHistory.upsert({
        where: {
          leadChildId_trialClassId: {
            leadChildId: params.leadChildId,
            trialClassId: params.trialClassId,
          },
        },
        create: {
          leadChildId: params.leadChildId,
          trialClassId: params.trialClassId,
          centerId: cls.centerId,
          attendedCount: 0,
          totalSessions,
          outcome: "PENDING",
        },
        update: { totalSessions, outcome: "PENDING" },
      });
      // R7-17 — báo Sale phụ trách lead đã xếp lớp trải nghiệm (atomic cùng tx).
      await publishEvent(
        "trial.assigned",
        {
          trialEnrollmentId: enrollment.id,
          leadChildId: params.leadChildId,
          trialClassId: params.trialClassId,
        },
        { tx, dedupeKey: `trial.assigned:${enrollment.id}` },
      );
      // AC4 — ghi audit khi override sĩ số (xếp vượt capacity bằng quyền override).
      // `capacity === null` = lớp không giới hạn ⇒ KHÔNG có gì để "vượt", nên cũng
      // không ghi audit override. Ghi bừa là đẻ ra vết vi phạm cho một luật không tồn tại.
      if (allowOverride && cls.capacity !== null && activeCount >= cls.capacity) {
        await writeAudit({
          actor: { id: params.addedById, name: await actorName(params.addedById, tx) },
          module: "trial",
          entityType: "TrialEnrollment",
          entityId: enrollment.id,
          action: "CREATE",
          newValues: { override: true, capacity: cls.capacity, activeCount, trialClassId: params.trialClassId, leadChildId: params.leadChildId },
          tx,
        });
      }
      return { ok: true, tin };
    });

    // Ngoài transaction — xem #GV-MỚI. `notifyTrialTeacherAssigned` tự nuốt lỗi.
    if (ket.ok && tin) {
      await notifyTrialTeacherAssigned({
        teacherId: tin.teacherId,
        title: "Có học viên mới trong ca trải nghiệm của bạn",
        // `moTaBuoi` là MỆNH ĐỀ ĐẦY ĐỦ (tự mang chữ "buổi" / "toàn bộ buổi") — ĐỪNG
        // ghép thêm tiền tố nào ở đây, xem chú thích tại chỗ dựng nó.
        body: `${tin.childName} vừa được xếp vào lớp ${tin.className} · ${tin.moTaBuoi}.`,
        dedupeKey: `trial-enroll.assigned:${tin.enrollmentId}`,
        entityId: tin.enrollmentId,
      });
    }
    return ket;
  } catch (e) {
    // Partial-unique: con đang ACTIVE ở lớp khác (AC3).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Học viên đang ở lớp trải nghiệm khác" };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi ghi danh" };
  }
}

/**
 * Huỷ lớp trải nghiệm: status=CANCELLED + mọi TrialEnrollment ACTIVE → WITHDRAWN
 * (giải phóng partial-unique 1 lớp ACTIVE/con). Audit. (§6 edge case.)
 */
export async function cancelTrialClass(params: {
  trialClassId: string;
  actorId: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    return await db.$transaction(async (tx) => {
      const cls = await tx.trialClassV2.findUnique({
        where: { id: params.trialClassId },
        select: { id: true, status: true },
      });
      if (!cls) return { ok: false, error: "Lớp trải nghiệm không tồn tại" };
      if (cls.status === "CANCELLED") return { ok: true };
      await tx.trialClassV2.update({
        where: { id: params.trialClassId },
        data: { status: "CANCELLED" },
      });
      const freed = await tx.trialEnrollment.updateMany({
        where: { trialClassId: params.trialClassId, status: "ACTIVE" },
        data: { status: "WITHDRAWN" },
      });
      await writeAudit({
        actor: { id: params.actorId, name: await actorName(params.actorId, tx) },
        module: "trial",
        entityType: "TrialClassV2",
        entityId: params.trialClassId,
        action: "STATUS_CHANGE",
        oldValues: { status: cls.status },
        newValues: { status: "CANCELLED", withdrawnEnrollments: freed.count },
        tx,
      });
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi huỷ lớp" };
  }
}

// ─── Điểm danh ──────────────────────────────────────────────────────────────────

/**
 * FL-R2 (QĐ-R2-W3 item 6,7) — đồng bộ tiến độ học thử của 1 ghi danh sau mỗi lần điểm danh.
 * IDEMPOTENT: tính lại từ số buổi PRESENT thực tế (gọi lại bao nhiêu lần cũng cho cùng kết quả).
 *  - Cập nhật LeadTrialHistory: attendedCount (chỉ đếm PRESENT) + first/lastAttendedAt.
 *  - Auto-Kanban per-con: ≥1 buổi → IN_PROGRESS; đủ buổi (totalSessions per-lead) → ATTENDED.
 *  - Auto-Kanban per-lead: có con đang học → "Đang học thử"; MỌI con đủ buổi & chưa chốt
 *    → "Chờ quyết định" (AWAITING_DECISION) NGAY (TBD-2). KHÔNG đụng lead đã chốt/rời pipeline.
 */
async function syncTrialProgress(
  tx: Prisma.TransactionClient,
  trialEnrollmentId: string,
  // GĐ1 — ai gây ra lượt đổi trạng thái này; ghi vào sổ để phân biệt người làm với máy chạy.
  actorId: string | null = null,
): Promise<void> {
  const enr = await tx.trialEnrollment.findUnique({
    where: { id: trialEnrollmentId },
    select: {
      id: true,
      status: true,
      trialClassId: true,
      leadChildId: true,
      trialClass: { select: { centerId: true, sessionCount: true } },
      leadChild: { select: { id: true, leadId: true, trialStatus: true } },
    },
  });
  if (!enr) return;

  // buổi PRESENT của ghi danh này (kèm ngày buổi để tính first/last).
  const presents = await tx.trialAttendance.findMany({
    where: { trialEnrollmentId, status: "PRESENT" },
    select: { trialSession: { select: { date: true } } },
  });
  const attendedCount = presents.length;
  const dates = presents
    .map((p) => p.trialSession.date)
    .sort((a, b) => a.getTime() - b.getTime());
  const firstAttendedAt = dates[0] ?? null;
  const lastAttendedAt = dates[dates.length - 1] ?? null;

  // totalSessions per-lead: giữ giá trị đã chốt khi gán; fallback sessionCount lớp.
  const existing = await tx.leadTrialHistory.findUnique({
    where: {
      leadChildId_trialClassId: { leadChildId: enr.leadChildId, trialClassId: enr.trialClassId },
    },
    select: { totalSessions: true },
  });
  const totalSessions = existing?.totalSessions ?? enr.trialClass.sessionCount;

  await tx.leadTrialHistory.upsert({
    where: {
      leadChildId_trialClassId: { leadChildId: enr.leadChildId, trialClassId: enr.trialClassId },
    },
    create: {
      leadChildId: enr.leadChildId,
      trialClassId: enr.trialClassId,
      centerId: enr.trialClass.centerId,
      attendedCount,
      totalSessions,
      firstAttendedAt,
      lastAttendedAt,
      outcome: "PENDING",
    },
    update: { attendedCount, firstAttendedAt, lastAttendedAt },
  });

  // ── Kanban per-con ──
  const reachedThreshold = totalSessions > 0 && attendedCount >= totalSessions;
  let childStatus = enr.leadChild.trialStatus;
  if (reachedThreshold) childStatus = "ATTENDED";
  else if (attendedCount >= 1 && childStatus !== "ATTENDED") childStatus = "IN_PROGRESS";
  if (childStatus !== enr.leadChild.trialStatus) {
    await tx.leadChild.update({ where: { id: enr.leadChildId }, data: { trialStatus: childStatus } });
  }
  // đủ buổi → đóng ghi danh (giải phóng partial-unique 1 lớp ACTIVE/con).
  if (reachedThreshold && enr.status === "ACTIVE") {
    await tx.trialEnrollment.update({ where: { id: enr.id }, data: { status: "COMPLETED" } });
  }

  // ── Kanban per-lead ──
  const leadId = enr.leadChild.leadId;
  const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { status: true } });
  if (!lead) return;
  // KHÔNG động vào lead đã chốt / rời pipeline (sale tự quản từ đây).
  // GĐ0 — đây là chỗ DUY NHẤT dùng tập "rời phễu" (có thêm DA_DANG_KY so với tập
  // "đã đóng" của round-robin/bàn giao). Trước GĐ0 hai tập nằm ở 5 file rời và không
  // ai biết vì sao chúng lệch nhau; nay khác biệt được đặt tên và có test khoá.
  if (LEAD_PIPELINE_EXIT_STATUSES.includes(lead.status)) return;

  // mọi con (đang/đã học thử) của lead này đã đủ buổi?
  const siblings = await tx.trialEnrollment.findMany({
    where: { status: { in: ["ACTIVE", "COMPLETED"] }, leadChild: { leadId } },
    select: { leadChild: { select: { trialStatus: true } } },
  });
  const allAttended =
    siblings.length > 0 && siblings.every((s) => s.leadChild.trialStatus === "ATTENDED");

  // GĐ1 — hai đường này trước đây đổi trạng thái lead mà KHÔNG để lại vết nào, dù
  // đây là đường có lưu lượng cao nhất (mỗi lượt điểm danh đều chạy qua). Nay đi
  // chung cửa `setLeadStatus`: sổ ghi đủ, và hàm tự bỏ qua khi trạng thái không đổi
  // nên gọi lại nhiều lần không đẻ dòng rác.
  if (allAttended) {
    const res = await setLeadStatus({
      tx,
      leadId,
      to: "CHO_QUYET_DINH",
      source: "trial",
      actorId,
    });
    if (res.changed) {
      await publishEvent(
        "lead.awaitingDecision",
        { leadId },
        { tx, dedupeKey: `lead.awaitingDecision:${leadId}` },
      );
    }
  } else if (attendedCount >= 1 && lead.status === "DA_HEN_HOC_THU") {
    const res = await setLeadStatus({
      tx,
      leadId,
      to: "DANG_HOC_THU",
      source: "trial",
      actorId,
    });
    if (res.changed) {
      await publishEvent(
        "lead.trialInProgress",
        { leadId },
        { tx, dedupeKey: `lead.trialInProgress:${leadId}` },
      );
    }
  }
}

export async function markAttendance(params: {
  trialSessionId: string;
  trialEnrollmentId: string;
  status: "PRESENT" | "ABSENT";
  note?: string | null;
  actorId: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    // ⚠️ CHỐNG IDOR — kiểm CA và BUỔI thuộc CÙNG MỘT LỚP trước khi ghi.
    //
    // Action gọi vào đây chỉ scope được `trialSessionId` (qua `loadScopedTrialSession`),
    // còn `trialEnrollmentId` đi thẳng từ client. Không kiểm thì POST tay ghi được điểm
    // danh cho ca của lớp/cơ sở KHÁC — và tệ hơn, `syncTrialProgress` bên dưới sẽ đổi
    // luôn trạng thái lead bên đó. Lỗ này có từ màn cũ, không phải hồi quy của đợt này.
    const [ses, enr] = await Promise.all([
      db.trialClassSession.findUnique({
        where: { id: params.trialSessionId },
        select: {
          trialClassId: true,
          status: true,
          trialClass: { select: { theoKhung: true } },
        },
      }),
      db.trialEnrollment.findUnique({
        where: { id: params.trialEnrollmentId },
        select: { trialClassId: true, scheduledSessionId: true },
      }),
    ]);
    if (!ses || !enr) return { ok: false, error: "Không tìm thấy buổi hoặc ca trải nghiệm" };
    if (ses.trialClassId !== enr.trialClassId) {
      // Gộp một thông điệp cho cả hai ca (không tồn tại / khác lớp) — nói rõ hơn là
      // biến thông báo lỗi thành kênh dò id.
      return { ok: false, error: "Học viên không thuộc lớp của buổi này" };
    }
    // 23/09 — buổi ĐÃ HUỶ đã biến khỏi lịch giáo viên (và giáo viên đã nhận tin huỷ).
    // Điểm danh vào đó là ghi có mặt cho một buổi không diễn ra, và `syncTrialProgress`
    // bên dưới sẽ đẩy lead theo con số giả đó.
    if (ses.status === "CANCELLED") {
      return { ok: false, error: "Buổi đã huỷ — không điểm danh được" };
    }
    // 23/09 — bé phải thuộc ĐÚNG case này. Trước đây chỉ kiểm cùng lớp, còn luật "bé
    // chỉ hiện ở case của mình" chỉ nằm ở bộ lọc phía trình duyệt: POST tay là điểm
    // danh được một bé ở hai case, sinh hai dòng có mặt, thổi số buổi đã dự và tự đẩy
    // lead của Sale khác lên CHO_QUYET_DINH. Nghĩa của NULL theo loại lớp — xem
    // `lib/trial/nghia-null.ts` (lớp cũ: NULL = học cả lớp, vẫn điểm danh được).
    if (!thuocCase(enr, params.trialSessionId, laLopTheoKhung(ses.trialClass))) {
      return {
        ok: false,
        error: "Học viên không thuộc case này — xếp hoặc chuyển bé vào case trước rồi mới điểm danh",
      };
    }

    await db.$transaction(async (tx) => {
      await tx.trialAttendance.upsert({
        where: {
          trialSessionId_trialEnrollmentId: {
            trialSessionId: params.trialSessionId,
            trialEnrollmentId: params.trialEnrollmentId,
          },
        },
        create: {
          trialSessionId: params.trialSessionId,
          trialEnrollmentId: params.trialEnrollmentId,
          status: params.status,
          note: params.note ?? null,
          // GĐ4 — ghi AI điểm danh. Từ GĐ4 việc này chuyển từ giáo viên sang Sale, nên
          // không lưu người thao tác là mất luôn khả năng quy trách nhiệm khi có tranh cãi.
          markedById: params.actorId,
        },
        update: {
          status: params.status,
          note: params.note ?? null,
          markedById: params.actorId,
        },
      });
      // ghi lịch sử + auto-Kanban (idempotent — tính lại từ số buổi PRESENT).
      await syncTrialProgress(tx, params.trialEnrollmentId, params.actorId ?? null);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi điểm danh" };
  }
}

// ─── Hoàn tất buổi ────────────────────────────────────────────────────────────

export async function completeTrialSession(params: {
  trialSessionId: string;
  actorId: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    return await db.$transaction(async (tx) => {
      const session = await tx.trialClassSession.findUnique({
        where: { id: params.trialSessionId },
        select: { id: true, trialClassId: true, status: true },
      });
      if (!session) return { ok: false, error: "Buổi học không tồn tại" };
      // 23/09 — CHỈ buổi SCHEDULED mới hoàn tất được. Bản cũ ghi đè không đọc trạng
      // thái, nên bấm "Hoàn tất" trên case ĐÃ HUỶ là hồi sinh nó thành COMPLETED: case
      // hiện lại trên thanh khung giờ và trên lịch giáo viên — người vừa nhận tin huỷ.
      if (session.status === "CANCELLED") {
        return { ok: false, error: "Buổi đã huỷ — không hoàn tất được" };
      }
      if (session.status === "COMPLETED") return { ok: true }; // idempotent

      // `updateMany` CÓ ĐIỀU KIỆN (mẫu chống-đua FIX-H9 của repo): nếu ai đó huỷ buổi
      // giữa lúc đọc và lúc ghi thì phép ghi đổi 0 dòng — commit vô hại — thay vì đè
      // CANCELLED thành COMPLETED.
      const upd = await tx.trialClassSession.updateMany({
        where: { id: session.id, status: "SCHEDULED" },
        data: { status: "COMPLETED" },
      });
      if (upd.count === 0) {
        return { ok: false, error: "Buổi vừa đổi trạng thái — tải lại trang rồi thử lại" };
      }
      // FL-R2 (QĐ-R2-W3): tiến độ lead/Kanban do markAttendance lo per-lead (đủ buổi →
      // AWAITING_DECISION NGAY, không chờ buổi cuối). Hoàn tất buổi chỉ khoá lifecycle buổi.
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi hoàn tất buổi học" };
  }
}

// ─── Gỡ học viên khỏi CASE (vẫn ở trong lớp) ─────────────────────────────────────

/**
 * Gỡ một bé khỏi case đang xếp — bé VẪN ở trong lớp.
 *
 * Chủ dự án 23/09/2026: "học viên khi bị gỡ khỏi case thì phải về chưa xếp case, rồi từ
 * chưa xếp case mới gỡ khỏi lớp". Nên đây là việc KHÁC `unenrollLeadChild`: ghi danh giữ
 * nguyên ACTIVE, chỉ `scheduledSessionId` về NULL. Nghĩa của NULL theo loại lớp
 * (`lib/trial/nghia-null.ts`): lớp theo khung ⇒ "Chưa xếp case"; lớp cũ ⇒ "học cả lớp".
 *
 * ⚠️ CHẶN khi bé ĐÃ ĐƯỢC ĐIỂM DANH ở case này — CHỈ ở lớp theo khung. Gỡ ra thì bé về
 * "Chưa xếp case", được xếp vào case khác và điểm danh lần nữa ⇒ hai dòng có mặt trong
 * CÙNG MỘT buổi học thật, thổi số buổi đã dự và tự đẩy trạng thái lead. Ở lớp cũ không
 * có rủi ro đó: NULL là học mọi buổi, điểm danh cũ vẫn đúng chỗ của nó.
 *
 * Mọi cổng đứng TRƯỚC phép ghi đầu tiên (luật rollback); phép ghi là `updateMany` CÓ
 * ĐIỀU KIỆN (mẫu chống-đua FIX-H9): ai đó vừa chuyển bé sang case khác thì nó đổi 0 dòng.
 */
export async function goHocVienKhoiCase(params: {
  trialEnrollmentId: string;
  actorId: string;
}): Promise<{
  ok: boolean;
  error?: string;
  /** Case vừa rời — để nơi gọi báo giáo viên + ghi lịch sử. */
  caseCu?: { id: string; teacherId: string | null; gio: string; daHuy: boolean };
}> {
  try {
    return await db.$transaction(async (tx) => {
      const enr = await tx.trialEnrollment.findUnique({
        where: { id: params.trialEnrollmentId },
        select: {
          id: true,
          status: true,
          scheduledSessionId: true,
          trialClass: { select: { theoKhung: true } },
        },
      });
      if (!enr) return { ok: false, error: "Không tìm thấy ca trải nghiệm" };
      if (enr.status !== "ACTIVE") {
        return { ok: false, error: "Chỉ gỡ khỏi case được bé còn đang học thử" };
      }
      if (!enr.scheduledSessionId) {
        return { ok: false, error: "Bé chưa ở case nào" };
      }
      const ses = await tx.trialClassSession.findUnique({
        where: { id: enr.scheduledSessionId },
        select: { id: true, teacherId: true, startTime: true, endTime: true, status: true },
      });
      if (enr.trialClass.theoKhung) {
        const daDiemDanh = await tx.trialAttendance.count({
          where: { trialSessionId: enr.scheduledSessionId, trialEnrollmentId: enr.id },
        });
        if (daDiemDanh > 0) {
          return {
            ok: false,
            error:
              "Bé đã được điểm danh ở case này — không gỡ khỏi case được " +
              "(xếp sang case khác rồi điểm danh lại là tính trùng buổi đã dự).",
          };
        }
      }

      const upd = await tx.trialEnrollment.updateMany({
        where: { id: enr.id, status: "ACTIVE", scheduledSessionId: enr.scheduledSessionId },
        // Phân công GV theo ca (`gvPhanCongId`) đi theo CASE: rời case là rời phân công —
        // cùng nếp với `rescheduleTrialEnrollment`.
        data: { scheduledSessionId: null, gvPhanCongId: null },
      });
      if (upd.count === 0) {
        return { ok: false, error: "Bé vừa được chuyển sang chỗ khác — tải lại trang rồi thử lại" };
      }
      return {
        ok: true,
        caseCu: ses
          ? {
              id: ses.id,
              teacherId: ses.teacherId,
              gio: `${ses.startTime}–${ses.endTime}`,
              daHuy: ses.status === "CANCELLED",
            }
          : undefined,
      };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi gỡ khỏi case" };
  }
}

// ─── Huỷ gán học viên ────────────────────────────────────────────────────────────

/**
 * FL-R2 (item 4) — gỡ 1 học viên khỏi lớp trải nghiệm: SOFT-withdraw (status=WITHDRAWN),
 * GIỮ LeadTrialHistory (lead quay lại không mất dấu). Nếu CHƯA điểm danh buổi nào →
 * revert trialStatus về NONE + xoá history rỗng (chưa từng học). Audit.
 */
export async function unenrollLeadChild(params: {
  trialClassId: string;
  leadChildId: string;
  actorId: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    return await db.$transaction(async (tx) => {
      const enr = await tx.trialEnrollment.findFirst({
        where: { trialClassId: params.trialClassId, leadChildId: params.leadChildId, status: "ACTIVE" },
        select: {
          id: true,
          leadChildId: true,
          _count: { select: { attendances: true } },
          trialClass: { select: { centerId: true } },
        },
      });
      if (!enr) return { ok: false, error: "Không tìm thấy ghi danh đang hoạt động" };

      await tx.trialEnrollment.update({ where: { id: enr.id }, data: { status: "WITHDRAWN" } });

      const neverAttended = enr._count.attendances === 0;
      if (neverAttended) {
        // chưa học buổi nào → coi như chưa từng học thử lớp này.
        await tx.leadChild.update({ where: { id: enr.leadChildId }, data: { trialStatus: "NONE" } });
        await tx.leadTrialHistory.deleteMany({
          where: { leadChildId: enr.leadChildId, trialClassId: params.trialClassId, attendedCount: 0 },
        });
      }

      await writeAudit({
        actor: { id: params.actorId, name: await actorName(params.actorId, tx) },
        module: "trial",
        entityType: "TrialEnrollment",
        entityId: enr.id,
        action: "STATUS_CHANGE",
        oldValues: { status: "ACTIVE" },
        newValues: { status: "WITHDRAWN", neverAttended, leadChildId: enr.leadChildId, trialClassId: params.trialClassId },
        tx,
      });
      return { ok: true };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi gỡ học viên" };
  }
}

// ─── GĐ3 — DỜI LỊCH một ca trải nghiệm ────────────────────────────────────────

/**
 * Dời một ca trải nghiệm sang buổi khác.
 *
 * Luồng đã chốt với chủ dự án (25/08/2026): phụ huynh vắng hoặc xin dời → Sale bấm
 * "Dời lịch", chọn buổi mới → **giáo viên đang phụ trách ca đó MẤT PHÂN CÔNG**, Sale
 * đề xuất lại nếu muốn (không bắt buộc), và giáo viên được BÁO là lịch đã dời.
 *
 * Ba điều dễ làm sai, đã xử ở đây:
 *
 * 1. **Không xoá bản ghi điểm danh của buổi cũ.** Bé vắng ở buổi cũ chính là lý do
 *    phải dời; xoá đi là mất luôn bằng chứng và `attendedCount` sẽ tính sai.
 * 2. **Không đụng giáo viên của LỚP hay của BUỔI.** Chỉ ca này mất phân công; lớp có
 *    nhiều bé, gỡ ở cấp lớp là gỡ nhầm của người khác.
 * 3. **Ghi vết vào `TrialReschedule` dù trên màn bé đó biến mất khỏi buổi cũ.** Tỷ lệ
 *    dời lịch là chỉ số chất lượng chốt lịch của Sale, xoá thẳng là mất hẳn.
 */
export async function rescheduleTrialEnrollment(params: {
  trialEnrollmentId: string;
  toSessionId: string;
  reason?: string | null;
  actorId: string | null;
}): Promise<{ ok: boolean; error?: string; gvBiGoId?: string | null }> {
  try {
    return await db.$transaction(async (tx) => {
      const enr = await tx.trialEnrollment.findUnique({
        where: { id: params.trialEnrollmentId },
        select: {
          id: true,
          status: true,
          trialClassId: true,
          leadChildId: true,
          scheduledSessionId: true,
          gvPhanCongId: true,
          rescheduleCount: true,
          trialClass: { select: { centerId: true, orgUnitId: true, name: true } },
        },
      });
      if (!enr) return { ok: false, error: "Không tìm thấy ca trải nghiệm" };

      // Buổi mới phải thuộc ĐÚNG lớp đó và chưa diễn ra. Kiểm ở server chứ không chỉ
      // ở UI: action nhận id thẳng từ client.
      const ses = await tx.trialClassSession.findUnique({
        where: { id: params.toSessionId },
        select: { id: true, trialClassId: true, status: true },
      });

      // Toàn bộ phần quyết định nằm ở hàm thuần (có test phủ đủ nhánh) — ở đây chỉ
      // nạp dữ liệu rồi hỏi. Hai bản logic là hai cơ hội lệch nhau.
      const luat = danhGiaDoiLich({
        caStatus: enr.status,
        caTrialClassId: enr.trialClassId,
        caSessionId: enr.scheduledSessionId,
        buoiMoi: ses
          ? { id: ses.id, trialClassId: ses.trialClassId, status: ses.status }
          : null,
      });
      if (!luat.ok) return { ok: false, error: luat.error };

      const gvBiGoId = enr.gvPhanCongId;

      await tx.trialEnrollment.update({
        where: { id: enr.id },
        data: {
          scheduledSessionId: params.toSessionId,
          // Mất phân công. Xoá luôn đề xuất cũ để Sale đề xuất lại từ đầu — giữ đề
          // xuất cũ thì Đào tạo dễ tưởng Sale đã cân nhắc cho lịch MỚI.
          gvPhanCongId: null,
          gvDeXuatId: null,
          rescheduleCount: enr.rescheduleCount + 1,
        },
      });

      await tx.trialReschedule.create({
        data: {
          trialEnrollmentId: enr.id,
          fromSessionId: enr.scheduledSessionId,
          toSessionId: params.toSessionId,
          gvBiGoId,
          reason: params.reason?.trim() || null,
          changedById: params.actorId,
          changedByName: await actorName(params.actorId, tx),
          centerId: enr.trialClass.centerId,
          orgUnitId: enr.trialClass.orgUnitId,
        },
      });

      await writeAudit({
        actor: { id: params.actorId, name: await actorName(params.actorId, tx) },
        module: "trial",
        entityType: "TrialEnrollment",
        entityId: enr.id,
        action: "UPDATE",
        oldValues: { scheduledSessionId: enr.scheduledSessionId, gvPhanCongId: gvBiGoId },
        newValues: { scheduledSessionId: params.toSessionId, gvPhanCongId: null },
        orgUnitId: enr.trialClass.centerId,
        tx,
      });

      return { ok: true, gvBiGoId };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi dời lịch" };
  }
}

/**
 * Người được ĐỀ XUẤT hoặc PHÂN CÔNG cho một ca phải THẬT SỰ là giáo viên đang hoạt động.
 *
 * ⚠️ Trước bản vá này, hai hàm dưới chỉ `findUnique` kiểm TỒN TẠI, nên gọi thẳng action
 * gán được tài khoản phụ huynh hoặc kế toán làm giáo viên của ca. Đường gán ở cấp LỚP
 * vốn đã kiểm (`teacherCenterAssignmentError`), chỉ đường theo CA là hở.
 *
 * Tính cả người giữ TEACHER ở vị trí PHỤ (`roles[]`), giống mọi nơi khác trong repo —
 * quản lý cơ sở kiêm dạy là ca có thật.
 */
async function laGiaoVienHopLe(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true, deletedAt: true, role: true, roles: true },
  });
  if (!u || !u.isActive || u.deletedAt) return false;
  return u.role === "TEACHER" || u.roles.includes("TEACHER");
}

const KHONG_PHAI_GV = "Người được chọn không phải giáo viên đang hoạt động" as const;

/**
 * Sale ĐỀ XUẤT giáo viên cho một ca. Chỉ ghi được khi Đào tạo CHƯA chốt — sau khi
 * `gvPhanCongId` có giá trị thì Sale không sửa nữa (chốt câu 1).
 */
export async function proposeTrialTeacher(params: {
  trialEnrollmentId: string;
  gvDeXuatId: string | null;
  actorId: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const enr = await db.trialEnrollment.findUnique({
    where: { id: params.trialEnrollmentId },
    select: { id: true, status: true, gvPhanCongId: true },
  });
  if (!enr) return { ok: false, error: "Không tìm thấy ca trải nghiệm" };
  const luat = saleDuocDeXuat({ status: enr.status, gvPhanCongId: enr.gvPhanCongId });
  if (!luat.ok) return { ok: false, error: luat.error };
  if (params.gvDeXuatId && !(await laGiaoVienHopLe(params.gvDeXuatId))) {
    return { ok: false, error: KHONG_PHAI_GV };
  }
  await db.trialEnrollment.update({
    where: { id: enr.id },
    data: { gvDeXuatId: params.gvDeXuatId },
  });
  return { ok: true };
}

/**
 * Đào tạo PHÂN CÔNG giáo viên cho một ca (duyệt đề xuất của Sale hoặc chỉ định người
 * khác). Ghi đè được, vì đây là quyền quyết định cuối.
 */
export async function assignTrialCaseTeacher(params: {
  trialEnrollmentId: string;
  gvPhanCongId: string | null;
  actorId: string | null;
}): Promise<{ ok: boolean; error?: string; daDoi?: boolean }> {
  const enr = await db.trialEnrollment.findUnique({
    where: { id: params.trialEnrollmentId },
    select: { id: true, status: true, gvPhanCongId: true },
  });
  if (!enr) return { ok: false, error: "Không tìm thấy ca trải nghiệm" };
  if (enr.status !== "ACTIVE") return { ok: false, error: "Ca này đã kết thúc" };
  if (params.gvPhanCongId && !(await laGiaoVienHopLe(params.gvPhanCongId))) {
    return { ok: false, error: KHONG_PHAI_GV };
  }
  await db.trialEnrollment.update({
    where: { id: enr.id },
    data: { gvPhanCongId: params.gvPhanCongId },
  });
  return { ok: true, daDoi: enr.gvPhanCongId !== params.gvPhanCongId };
}
