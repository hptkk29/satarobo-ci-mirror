"use server";

// app/(admin)/admin/cham-cong/_actions.ts — L5: GHI ĐÈ CÔNG NGÀY (hộp cờ Quản lý — T-01: lượt quét chỉ
// sinh cờ, người quyết là Quản lý). Quyền `hr_attendance:adjust` tại cơ sở chịu công của ngày đó.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { writeAudit } from "@/lib/audit/audit-log";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { setDayOverride } from "@/lib/cham-cong/period";
import { chanSuaKyDaChot } from "@/lib/cham-cong/ky-gac";
import { markAttendanceDayDirty } from "@/lib/cham-cong/recompute";
import {
  SO_MOC_TOI_DA,
  chuanHoaMoc,
  dungDongChinhTay,
  ghiDongChinhTay,
  type LuotBiThay,
} from "@/lib/cham-cong/sua-gio-quet";
import { HO_CENTER_ID, loadCenterMap } from "@/lib/cham-cong/home-center";

type Res = { ok: true } | { ok: false; error: string };

const schema = z.object({
  userId: z.string().min(1),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  units: z.coerce.number().min(0).max(3).nullable(),
  note: z.string().trim().max(300).nullable(),
});

export async function setDayOverrideAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const [y, m, d] = p.data.workDate.split("-").map(Number);
  const workDate = new Date(Date.UTC(y, m - 1, d));
  const sdb = scopedDb(await resolveActor(session.user.id));
  const row = await sdb.staffAttendanceDay.findUnique({ where: { userId_workDate: { userId: p.data.userId, workDate } }, select: { centerId: true } });
  if (!row) return { ok: false, error: "Ngày này chưa được tính" };
  if (!(await checkPermission("hr_attendance:adjust", { centerId: row.centerId }))) return { ok: false, error: "Không có quyền chỉnh công ở cơ sở này" };
  const r = await setDayOverride({ userId: p.data.userId, workDate, units: p.data.units, note: p.data.note, actorId: session.user.id });
  if (!r.ok) return r;
  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "StaffAttendanceDay",
    entityId: `${p.data.userId}:${p.data.workDate}`,
    action: p.data.units == null ? "CLEAR_OVERRIDE" : "SET_OVERRIDE",
    oldValues: { overrideUnits: r.before },
    newValues: { overrideUnits: p.data.units },
    reason: p.data.note ?? undefined,
  });
  revalidatePath("/cham-cong");
  revalidatePath("/cham-cong/ky-cong");
  return { ok: true };
}

// ── Kết luận NGÀY VẮNG (đợt 2, chốt 07/09/2026) ────────────────────────────────────────────
//
// Vì sao phải có người bấm: cờ `KHONG_CO_LUOT` KHÔNG đồng nghĩa nghỉ không phép — nó còn do
// quên quét, quầy hỏng, đi công tác, làm ngoài trung tâm. Chủ dự án chốt không tự động trừ 2%
// từ cờ đó; chỉ ngày quản lý xác nhận mới vào cột trừ nội quy.
//
// Ghi thẳng vào 4 cột `absence*` của `StaffAttendanceDay` thay vì bảng riêng: đúng grain
// (một người × một ngày), và `recomputeAttendanceDay` liệt kê TƯỜNG MINH các cột nó ghi nên
// kết luận của người sống sót qua mọi lần tính lại — y như cặp `override*`.
const absenceSchema = z.object({
  userId: z.string().min(1),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** null = gỡ kết luận, trả ngày về diện "chờ kết luận". */
  status: z.enum(["UNAUTHORISED", "EXCUSED"]).nullable(),
  note: z.string().trim().max(300).nullable(),
});

export async function setDayAbsenceAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = absenceSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  // Kết luận "không phép" là chuyện tiền bạc — bắt buộc nêu căn cứ. "Có lý do" thì không ép,
  // vì lý do thường đã nằm ở đơn từ hoặc tin nhắn.
  if (p.data.status === "UNAUTHORISED" && !p.data.note) {
    return { ok: false, error: "Ghi lý do kết luận không phép — đây là căn cứ trừ % nội quy" };
  }

  const [y, m, d] = p.data.workDate.split("-").map(Number);
  const workDate = new Date(Date.UTC(y, m - 1, d));
  const sdb = scopedDb(await resolveActor(session.user.id));
  const row = await sdb.staffAttendanceDay.findUnique({
    where: { userId_workDate: { userId: p.data.userId, workDate } },
    select: { centerId: true, status: true, absenceStatus: true, dayType: true, dayCreditExpected: true },
  });
  if (!row) return { ok: false, error: "Ngày này chưa được tính" };
  // Hộp chi tiết ngày đã che nút này cho ngày không phải ngày công, nhưng Server Action là
  // ENDPOINT RIÊNG — gọi thẳng vẫn tới. Không chặn thì kết luận "không phép" cho một ngày nghỉ
  // tuần cũng trừ 2%, vì `noi-quy.ts` cộng `ngayKhongPhep` bất kể ngày đó có phải ngày công.
  if (p.data.status === "UNAUTHORISED" && (row.dayType !== "WORK" || row.dayCreditExpected <= 0)) {
    return { ok: false, error: "Ngày này không phải ngày công — không kết luận nghỉ không phép được" };
  }
  // `scopedDb` KHÔNG che đường ghi — phải tự gác bằng target thật.
  if (!(await checkPermission("hr_attendance:adjust", { centerId: row.centerId }))) {
    return { ok: false, error: "Không có quyền kết luận ngày vắng ở cơ sở này" };
  }
  if (row.status === "LOCKED") {
    return { ok: false, error: "Kỳ đã chốt — mở lại kỳ trước khi đổi kết luận" };
  }

  // Ghi qua `sdb`: `scopedDb` KHÔNG tự che đường ghi, nhưng dòng này đã qua hai cổng thật —
  // `findUnique` ở trên chạy qua sdb (nên actor phải NHÌN THẤY được dòng) và `checkPermission`
  // với target là cơ sở chịu công của chính ngày đó.
  await sdb.staffAttendanceDay.update({
    where: { userId_workDate: { userId: p.data.userId, workDate } },
    data: {
      absenceStatus: p.data.status,
      absenceById: p.data.status ? session.user.id : null,
      absenceAt: p.data.status ? new Date() : null,
      absenceNote: p.data.status ? p.data.note : null,
    },
  });

  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "StaffAttendanceDay",
    entityId: `${p.data.userId}:${p.data.workDate}`,
    action: p.data.status ? "SET_ABSENCE" : "CLEAR_ABSENCE",
    oldValues: { absenceStatus: row.absenceStatus },
    newValues: { absenceStatus: p.data.status },
    reason: p.data.note ?? undefined,
  });
  revalidatePath("/cham-cong");
  revalidatePath("/cham-cong/thong-ke");
  revalidatePath("/cham-cong/ky-cong");
  return { ok: true };
}


// ── GHI ĐÈ GIỜ CHẤM CÔNG CỦA NGÀY (chốt chủ dự án 09/09/2026 · ĐẢO 06/10/2026) ────────────
//
// Quản lý sửa được giờ quét mà KHÔNG cần người lao động nộp đơn. Đổi lại: lý do BẮT BUỘC —
// đó là thứ thay cho "đơn của người lao động làm căn cứ". Không có đơn thì phải có chữ.
//
// ~~⚠️ GHI THÊM, KHÔNG SỬA ĐÈ. Dòng quét gốc BẤT BIẾN; lượt sửa chỉ sinh dòng MỚI.~~
// **[ĐẢO 06/10/2026]** Chủ dự án: "ca có 4 lần check in/out thì QLCS hoặc admin cũng ghi đè
// được đủ 4 mốc (chỉ vào + ra thì không biết lúc nào với lúc nào)" — và chốt: chỉnh tay của
// quản lý là GHI ĐÈ THẬT. Nhập 1–4 mốc [vào 1, ra 1, vào 2, ra 2]; mọi lượt CÒN TÍNH của ngày
// (kể cả lượt chỉnh tay cũ) được đánh dấu `DISMISSED` — GIỮ trong DB để xem/audit, KHÔNG còn
// tính công — rồi các mốc mới được ghi `MANUAL_ADJUST`. Không xoá dòng nào, không sửa giờ dòng
// nào. Dựng + ghi đi qua ĐÚNG lõi mà đường duyệt đơn TIMESHEET_FIX dùng
// (`lib/cham-cong/sua-gio-quet.ts`).
//
// BỐN CỔNG, bỏ cái nào cũng mở một lỗ — và cả bốn đứng TRƯỚC phép ghi đầu tiên:
//   1. quyền `hr_attendance:adjust` tại cơ sở CHỊU CÔNG của ngày đó (không phải cơ sở người bấm);
//   2. lý do không rỗng + danh sách mốc hợp lệ (dựng dòng xong mới mở transaction);
//   3. kỳ đã chốt — dùng lại `chanSuaKyDaChot`, đường vượt cấp Hội sở cùng khuôn
//      `generateMonthAction` / `decideRequestAction`. Kiểm TRONG transaction, trước phép ghi;
//   4. AuditLog before (danh sách lượt bị thay) / after (mốc mới).
// Đây là đường ghi THỨ TƯ vào kỳ; ba đường kia đều đã có cổng 3.
const hhmmMoc = z.string().trim().regex(/^\d{1,2}:\d{2}$/, "Giờ phải dạng HH:mm");
const suaGioSchema = z.object({
  userId: z.string().min(1),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /**
   * Mốc theo thứ tự [vào 1, ra 1, vào 2, ra 2], "HH:mm" giờ VN; ô trống = `null` hoặc `""`.
   * Ghi đè ⇒ không được bỏ trống ô GIỮA (lõi kiểm).
   */
  moc: z.array(z.union([hhmmMoc, z.literal("")]).nullable()).min(1).max(SO_MOC_TOI_DA),
  /** Căn cứ thay cho đơn — BẮT BUỘC, tối thiểu 5 ký tự. */
  lyDo: z.string().trim().min(5, "Ghi lý do sửa giờ (tối thiểu 5 ký tự) — đây là căn cứ thay cho đơn").max(300),
  /** Đường vượt cổng "kỳ đã chốt sổ" — chỉ cấp Hội sở. */
  boQuaKyDaChot: z.boolean().optional(),
});

/** Từ chối TRONG transaction — `throw` để rollback (luật rollback CLAUDE.md), action dịch lại. */
class TuChoiSuaGio extends Error {}

export async function suaGioQuetTayAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = suaGioSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const moc = chuanHoaMoc(p.data.moc);
  if (moc.length === 0) return { ok: false, error: "Nhập ít nhất một mốc giờ (vào hoặc ra)" };

  const [y, m, d] = p.data.workDate.split("-").map(Number);
  const workDate = new Date(Date.UTC(y, m - 1, d));
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // ── Cơ sở CHỊU CÔNG của ngày đó ────────────────────────────────────────────────────
  //
  // Ưu tiên ô lưới (`ShiftAssignment`) vì nó mang cả `orgUnitId`; ngày chưa có ca thì rơi về
  // dòng công đã tính. Không có cả hai ⇒ không xác định được cơ sở, và đoán bừa `centerId` là
  // ghi một dòng vô hình với chính người cần thấy nó.
  const [oLuoi, ngay] = await Promise.all([
    sdb.shiftAssignment.findFirst({
      where: { userId: p.data.userId, workDate, status: "ACTIVE" },
      select: { centerId: true, orgUnitId: true },
    }),
    sdb.staffAttendanceDay.findUnique({
      where: { userId_workDate: { userId: p.data.userId, workDate } },
      select: { centerId: true, status: true },
    }),
  ]);
  const centerId = oLuoi?.centerId ?? ngay?.centerId ?? null;
  if (!centerId) {
    return { ok: false, error: "Ngày này chưa có ca xếp và chưa được tính — chưa xác định được cơ sở chịu công" };
  }
  const map = await loadCenterMap();
  // ⚠️ `eslint-disable-next-line` phủ ĐÚNG MỘT dòng kế tiếp — nên phép so phải nằm trọn
  //    trên dòng ngay dưới nó. Tách xuống nhiều dòng là chú thích trượt và lint đỏ lại.
  //
  // TRA DỮ LIỆU, không phải kiểm quyền: tìm `orgUnitId` của cơ sở đã xác định ở trên.
  // Cổng quyền là `checkPermission` ngay dưới, target là chính `centerId` này.
  // eslint-disable-next-line no-restricted-syntax -- tra orgUnitId theo centerId, không phải cổng quyền
  const ouTheoCoSo = Object.values(map.byCode).find((c) => c.centerId === centerId)?.orgUnitId ?? null;
  const orgUnitId = oLuoi?.orgUnitId ?? ouTheoCoSo;

  // ── CỔNG 1: quyền tại cơ sở chịu công ──────────────────────────────────────────────
  // `scopedDb` KHÔNG che đường ghi — phải tự gác, và target phải là cơ sở THẬT của ngày đó.
  if (!(await checkPermission("hr_attendance:adjust", { centerId }))) {
    return { ok: false, error: "Không có quyền chỉnh công ở cơ sở này" };
  }
  // Quyền vượt kỳ đã chốt hỏi TRƯỚC transaction: nó là câu hỏi về NGƯỜI BẤM chứ không về dữ
  // liệu, và `checkPermission` không đi qua `tx`. Cổng 3 bên trong dùng kết quả này.
  const coQuyenVuotKy =
    p.data.boQuaKyDaChot === true &&
    (await checkPermission("hr_attendance:close-period", { centerId: HO_CENTER_ID }));

  // ── CỔNG 2: dựng dòng qua LÕI DÙNG CHUNG — mốc sai thì dừng ở đây, chưa mở transaction ──
  const now = new Date();
  const dung = dungDongChinhTay({
    userId: p.data.userId,
    centerId,
    orgUnitId,
    workDate,
    moc,
    // Quản lý / admin LUÔN ghi đè (chủ dự án chốt 06/10/2026).
    cheDo: "GHI_DE",
    actorId: session.user.id,
    now,
    lyDo: p.data.lyDo,
    canCu: { kieu: "SUA_TAY" },
  });
  if (!dung.ok) return { ok: false, error: dung.error };

  // ── Transaction GHI ĐÈ ─────────────────────────────────────────────────────────────
  //
  // `bypass: true` — CỐ Ý, sau khi cổng 1 đã kiểm quyền tại đúng cơ sở chịu công. Ghi đè phải
  // THẤY mọi lượt của người đó trong ngày: engine tính công trên TOÀN BỘ lượt, không lọc nơi
  // quét (`recompute.ts`). Đọc qua scope thì lượt quét ở cơ sở khác KHÔNG bị đánh dấu thay và
  // vẫn vào công — đúng thứ ghi đè sinh ra để chặn, mà không báo gì.
  const periodKey = p.data.workDate.slice(0, 7);
  let ketQua: { thayThe: LuotBiThay[]; vuotKy: boolean };
  try {
    ketQua = await scopedDb(actor, { bypass: true }).$transaction(async (txRaw) => {
      // Ép kiểu: client mở rộng của `scopedDb` khác kiểu `Prisma.TransactionClient` ở tầng
      // generic (`$extends`), còn hành vi thì như nhau — cùng khuôn `_may-pos-actions.ts`.
      const tx = txRaw as unknown as Prisma.TransactionClient;
      // ── CỔNG 3: kỳ đã chốt — TRƯỚC phép ghi đầu tiên ───────────────────────────────
      const kyChot = await tx.attendancePeriod.findFirst({
        where: { centerId, periodKey, status: "LOCKED" },
        select: { periodKey: true, status: true },
      });
      if (kyChot) {
        const loi = chanSuaKyDaChot({ status: kyChot.status, periodKey: kyChot.periodKey });
        // Đường vượt cấp HỘI SỞ. Cơ sở tự vượt cổng chặn của chính mình thì cổng đó không tồn tại.
        if (!p.data.boQuaKyDaChot) throw new TuChoiSuaGio(loi!);
        if (!coQuyenVuotKy) throw new TuChoiSuaGio("Chỉ cấp Hội sở mới sửa được giờ quét của kỳ đã chốt");
      }

      // Phép ghi đầu tiên: đánh dấu lượt cũ + tạo mốc mới (lõi chụp "before" TRƯỚC khi đánh dấu).
      const g = await ghiDongChinhTay(tx, {
        userId: p.data.userId,
        workDate,
        cheDo: "GHI_DE",
        rows: dung.rows,
        actorId: session.user.id,
        now,
        lyDo: p.data.lyDo,
        canCu: { kieu: "SUA_TAY" },
      });
      await markAttendanceDayDirty(p.data.userId, workDate, { tx, reason: "SUA_GIO_TAY" });
      return { thayThe: g.thayThe, vuotKy: !!kyChot };
    });
  } catch (err) {
    if (err instanceof TuChoiSuaGio) return { ok: false, error: err.message };
    throw err;
  }

  // ── CỔNG 4: AuditLog before/after ──────────────────────────────────────────────────
  //
  // "Before" = danh sách lượt VỪA BỊ THAY (chụp trong transaction, trước khi đánh dấu) — kèm
  // ghi chú/căn cứ cũ của chúng, vì cột `reviewNote` của dòng bị thay nay mang lý do thay.
  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "StaffTimeLog",
    entityId: `${p.data.userId}:${p.data.workDate}`,
    action: "MANUAL_TIME_ADJUST",
    oldValues: {
      luotQuetDangCo: ketQua.thayThe.map((t) => ({
        id: t.id,
        dir: t.direction,
        luc: t.loggedAt.toISOString(),
        nguon: t.source,
        co: t.flags,
        coSo: t.centerId,
        donId: t.adjustRequestId,
        nguoiDung: t.reviewedById,
        ghiChu: t.reviewNote,
      })),
    },
    newValues: {
      cheDo: "GHI_DE",
      mocMoi: dung.rows.map((r) => ({ dir: r.direction, luc: (r.loggedAt as Date).toISOString(), nguon: "MANUAL_ADJUST" })),
      soLuotBiThay: ketQua.thayThe.length,
      // Ghi thẳng ra: lượt này KHÔNG đi kèm đơn nào. Đọc audit sau này phân biệt được ngay.
      canCu: "SUA_TAY_KHONG_DON",
      boQuaKyDaChot: ketQua.vuotKy,
    },
    reason: p.data.lyDo,
  });

  revalidatePath("/cham-cong");
  revalidatePath("/cham-cong/ky-cong");
  return { ok: true };
}
