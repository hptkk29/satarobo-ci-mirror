"use server";

// app/(admin)/admin/cham-cong/khung-ca/_actions.ts — L3: KHUNG CA CỐ ĐỊNH HẰNG TUẦN (ShiftWeeklyPattern)
// + nút "Sinh lưới tháng". Quyền `hr_attendance:assign` theo khối (cơ sở / "hoi-so").
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { HO_CENTER_ID, loadCenterMap } from "@/lib/cham-cong/home-center";
import {
  generateMonthAssignments,
  type GenerateDb,
  type GenerateResult,
} from "@/lib/cham-cong/generate-db";
import { chanSuaKyDaChot } from "@/lib/cham-cong/ky-gac";
import {
  KHUNG_CA_EFFECTIVE_FROM,
  chiaLoThem,
  nguoiLechSection,
  sectionChoCum,
  thuTuTheoNguoi,
  type KetQuaThemHangLoat,
} from "@/lib/cham-cong/khung-ca";
import { vnDateOnly } from "@/lib/time/vn";

type Res<T = null> = { ok: true; data: T } | { ok: false; error: string };

/** Mốc hiệu lực duy nhất của màn này — luật + lý do: `lib/cham-cong/khung-ca.ts`. */
const DEFAULT_EFFECTIVE_FROM = KHUNG_CA_EFFECTIVE_FROM;

const cellSchema = z.object({
  userId: z.string().min(1),
  centerId: z.string().min(1), // khối: centerId thật hoặc "hoi-so"
  weekday: z.number().int().min(0).max(6),
  code: z.string().trim().toUpperCase().nullable(),
  sheetName: z.string().trim().max(60).optional(),
  jobLabel: z.string().trim().max(60).optional(),
});

/** Ghi một ô khung ca (mã hoặc trống). Trống = xoá dòng pattern của thứ đó. */
export async function savePatternCellAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = cellSchema.safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  const { userId, centerId, weekday, code } = p.data;
  if (!(await checkPermission("hr_attendance:assign", { centerId })))
    return { ok: false, error: "Không có quyền xếp khung ca ở khối này" };
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const where = {
    userId_centerId_weekday_effectiveFrom: {
      userId,
      centerId,
      weekday,
      effectiveFrom: DEFAULT_EFFECTIVE_FROM,
    },
  };
  if (!code) {
    await sdb.shiftWeeklyPattern.deleteMany({
      where: {
        userId,
        centerId,
        weekday,
        effectiveFrom: DEFAULT_EFFECTIVE_FROM,
      },
    });
  } else {
    // Khối HO không có Center thật ⇒ chỉ nhận mã dùng chung; khối cơ sở nhận mã dùng chung + mã riêng.
    const isHoBlock = centerId === HO_CENTER_ID;
    const tpl = await sdb.shiftTemplate.findFirst({
      where: {
        code,
        isActive: true,
        OR: isHoBlock
          ? [{ centerId: null }]
          : [{ centerId: null }, { centerId }],
      },
      select: { id: true, code: true },
    });
    if (!tpl)
      return { ok: false, error: `Mã "${code}" không có trong danh mục` };

    // ── CỔNG (d): một người chỉ mang MỘT `section` trong cùng (khối, effectiveFrom) ──
    //
    // Đây là đường ghi ĐỜI THƯỜNG làm gãy bất biến, không phải giả định: action này
    // trước nay KHÔNG hề set `section`, nên dòng MỚI rơi về `@default(KINH_DOANH)` của
    // schema. Thêm một ô cho người đã được nhập file với vai GIÁO_VIÊN là cụm của họ
    // lập tức mang hai giá trị — im lặng, không lỗi.
    //
    // Hậu quả nằm ở `brief-db.ts:45-52`: nó `distinct: ["userId","centerId"]` rồi lọc
    // thông báo bằng `audience === sectionOfUser.get(u.id)`. `distinct` trả MỘT dòng bất
    // kỳ trong bảy ⇒ người ấy nhận thông báo của bộ phận nào là do thứ tự truy vấn.
    const cumHienCo = await sdb.shiftWeeklyPattern.findMany({
      where: { userId, centerId, effectiveFrom: DEFAULT_EFFECTIVE_FROM },
      select: { userId: true, section: true },
    });
    const section = sectionChoCum(cumHienCo.map((r) => r.section));
    const map = await loadCenterMap();
    const orgUnitId = isHoBlock
      ? null
      : // eslint-disable-next-line no-restricted-syntax -- tra bảng đơn vị, không phải kiểm quyền
        (Object.values(map.byCode).find((c) => c.centerId === centerId)
          ?.orgUnitId ?? null);
    await sdb.shiftWeeklyPattern.upsert({
      where,
      create: {
        userId,
        centerId,
        orgUnitId,
        weekday,
        templateId: tpl.id,
        templateCode: tpl.code,
        sheetName: p.data.sheetName ?? null,
        jobLabel: p.data.jobLabel ?? null,
        section,
        effectiveFrom: DEFAULT_EFFECTIVE_FROM,
      },
      update: {
        templateId: tpl.id,
        templateCode: tpl.code,
        orgUnitId,
        // ⚠️ HỒI SINH — bắt buộc, không phải cho đẹp. Gỡ người khỏi khối là gỡ MỀM
        // (`effectiveTo`), mà khoá duy nhất `(userId, centerId, weekday, effectiveFrom)`
        // KHÔNG đổi khi gỡ. Nên `upsert` một ô của người đã gỡ rơi vào đúng nhánh này và
        // sửa dòng đã đóng; thiếu dòng dưới thì ghi xong ô vẫn tàng hình (màn lọc
        // `effectiveTo: null`) và người dùng thấy "bấm mà không có gì xảy ra".
        effectiveTo: null,
        ...(p.data.sheetName ? { sheetName: p.data.sheetName } : {}),
        ...(p.data.jobLabel ? { jobLabel: p.data.jobLabel } : {}),
      },
    });

    // Cụm ĐÃ lệch sẵn (dữ liệu cũ, hoặc file nhập phủ nửa vời) thì kéo cả cụm về một
    // giá trị. Chỉ chạy khi thật sự lệch — mỗi lần lưu một ô không cần thêm một lượt ghi.
    if (nguoiLechSection(cumHienCo).size > 0) {
      await sdb.shiftWeeklyPattern.updateMany({
        where: { userId, centerId, effectiveFrom: DEFAULT_EFFECTIVE_FROM },
        data: { section },
      });
    }
  }
  revalidatePath("/cham-cong/khung-ca");
  return { ok: true, data: null };
}

const loSchema = z.object({
  centerId: z.string().min(1),
  userIds: z.array(z.string().min(1)).min(1).max(200),
});

/**
 * Thêm NHIỀU người vào khung ca của một khối trong một lượt. **Idempotent**.
 *
 * Trước đây chỉ thêm được từng người, mỗi lần một vòng server — dựng khung ca cho một cơ
 * sở 20 người là 20 lượt bấm, và không có gì ngăn bấm trùng.
 *
 * Ba nhóm (luật + lý do ở `lib/cham-cong/khung-ca.ts`):
 *   · đang trong khối → BỎ QUA, không lỗi, không nhân đôi;
 *   · từng ở, đã gỡ   → MỞ LẠI cụm cũ (xoá `effectiveTo`), giữ nguyên lịch tuần và
 *     `sheetName` — không dựng lại từ đầu;
 *   · chưa có          → tạo dòng Thứ Hai = X để hàng xuất hiện, y như thêm từng người.
 *
 * ⚠️ Trả về ĐỦ ba nhóm chứ không chỉ số đếm: một thao tác hàng loạt không nói rõ nó đã
 * làm gì với TỪNG người là đúng loại thao tác vừa xoá trắng 9 hồ sơ prod hôm nay.
 */
export async function addPeopleToBlockAction(
  input: unknown,
): Promise<Res<KetQuaThemHangLoat>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = loSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Danh sách không hợp lệ" };
  const { centerId, userIds } = p.data;
  // `scopedDb` KHÔNG che WRITE — cổng quyền tự đứng ở đây.
  if (!(await checkPermission("hr_attendance:assign", { centerId })))
    return { ok: false, error: "Không có quyền xếp khung ca ở khối này" };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // Đọc TRỌN cụm của khối (mọi thứ, cả dòng đã đóng) — `chiaLoThem` cần phân biệt
  // "đang trong khối" với "từng ở, đã gỡ", và hai thứ đó chỉ khác nhau ở `effectiveTo`.
  const daCo = await sdb.shiftWeeklyPattern.findMany({
    where: {
      centerId,
      userId: { in: userIds },
      effectiveFrom: DEFAULT_EFFECTIVE_FROM,
    },
    select: { userId: true, effectiveTo: true },
  });
  const lo = chiaLoThem(userIds, daCo);

  // Mở lại cụm đã gỡ: một câu, không vòng lặp. Giữ nguyên mã ca của từng thứ.
  if (lo.hoiSinh.length > 0) {
    await sdb.shiftWeeklyPattern.updateMany({
      where: {
        centerId,
        userId: { in: lo.hoiSinh },
        effectiveFrom: DEFAULT_EFFECTIVE_FROM,
        effectiveTo: { not: null },
      },
      data: { effectiveTo: null },
    });
  }

  // Người mới: đi qua `savePatternCellAction` để dùng lại NGUYÊN cổng của nó — tra mã ca
  // hợp lệ theo khối, suy `orgUnitId`, ghi kép. Chép lại đoạn đó ở đây là hai bộ luật
  // lệch nhau ngay lần sửa sau.
  const hong: string[] = [];
  for (const userId of lo.themMoi) {
    const r = await savePatternCellAction({
      userId,
      centerId,
      weekday: 1,
      code: "X",
    });
    if (!r.ok) hong.push(userId);
  }
  if (hong.length > 0) {
    // Không nuốt: nếu mã "X" không có trong danh mục thì cả lượt vô nghĩa, phải nói ra.
    return {
      ok: false,
      error: `Không thêm được ${hong.length} người — kiểm tra mã "X" (nghỉ) có trong danh mục mã ca chưa`,
    };
  }

  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "ShiftWeeklyPattern",
    entityId: centerId,
    action: "PATTERN_ADD_BULK",
    newValues: {
      centerId,
      themMoi: lo.themMoi,
      hoiSinh: lo.hoiSinh,
      boQua: lo.boQua,
    },
    reason: "Thêm hàng loạt vào khung ca tuần của khối",
  });

  revalidatePath("/cham-cong/khung-ca");
  return { ok: true, data: lo };
}

const thuTuSchema = z.object({
  centerId: z.string().min(1),
  /** Thứ tự hiển thị mong muốn của CẢ khối, từ trên xuống. */
  userIds: z.array(z.string().min(1)).min(1).max(500),
});

/**
 * Ghi thứ tự hiển thị của một khối.
 *
 * ⚠️ Ghi **cùng một `displayOrder` cho CẢ CỤM 7 dòng** của một người — vì thế là
 * `updateMany` trên `(userId, centerId, effectiveFrom)`, không phải `update` từng dòng.
 *
 * Vì sao nó quan trọng: `khung-ca/page.tsx` sắp theo `displayOrder` **rồi mới** gom theo
 * `userId`. Cụm có 7 số khác nhau thì vị trí hàng do dòng nào tình cờ đứng trước quyết
 * định, và có thể đổi giữa hai lần tải trang. Nguồn lệch có thật: `import-core.ts:218`
 * ghi `displayOrder: row.stt` theo từng DÒNG của file.
 *
 * Không đổi hạt bảng, không migration — cột đã có sẵn.
 */
export async function reorderBlockAction(
  input: unknown,
): Promise<Res<{ soNguoi: number }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = thuTuSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Thứ tự không hợp lệ" };
  const { centerId, userIds } = p.data;
  // `scopedDb` KHÔNG che WRITE — cổng quyền tự đứng ở đây.
  if (!(await checkPermission("hr_attendance:assign", { centerId })))
    return { ok: false, error: "Không có quyền xếp khung ca ở khối này" };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const thuTu = thuTuTheoNguoi(userIds);

  await sdb.$transaction(
    [...thuTu].map(([userId, displayOrder]) =>
      sdb.shiftWeeklyPattern.updateMany({
        // KHÔNG lọc `weekday` — cả cụm phải mang cùng một số.
        // KHÔNG lọc `effectiveTo` — người vừa bị gỡ mà thêm lại phải về đúng chỗ cũ,
        // và một cụm nửa mở nửa đóng cũng không được để lại hai số.
        where: { userId, centerId, effectiveFrom: DEFAULT_EFFECTIVE_FROM },
        data: { displayOrder },
      }),
    ),
  );

  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "ShiftWeeklyPattern",
    entityId: centerId,
    action: "PATTERN_REORDER",
    newValues: { centerId, thuTu: userIds },
    reason: "Sắp lại thứ tự hiển thị của khung ca tuần",
  });

  revalidatePath("/cham-cong/khung-ca");
  return { ok: true, data: { soNguoi: thuTu.size } };
}

const goSchema = z.object({
  userId: z.string().min(1),
  centerId: z.string().min(1),
});

/**
 * Gỡ một người khỏi KHUNG CA của khối — **mềm**, đóng cả cụm 7 dòng bằng `effectiveTo`.
 *
 * Đây KHÔNG phải xoá nhân sự và KHÔNG phải xoá lịch đã xếp. Ba lý do chọn gỡ mềm (đầy đủ
 * ở `lib/cham-cong/khung-ca.ts`), tóm tắt:
 *
 *  · `generate.ts:77-78` bỏ dòng khi `effectiveTo < ngày` ⇒ đóng bằng NGÀY HÔM NAY nghĩa
 *    là "từ mai không xếp nữa", còn ô đã sinh của những ngày trước GIỮ NGUYÊN. Xoá cứng
 *    thì lần sinh lại kế tiếp làm rỗng cả quá khứ;
 *  · dòng khung ca mang `sheetName` — cầu nối tên trên file Sheet với `userId`
 *    (`reconcile-db.ts:23`). Xoá cứng là mất ánh xạ, lần đối chiếu file sau người ấy
 *    thành "không khớp ai";
 *  · gỡ nhầm hoàn tác được — thêm lại người đó là dòng cũ tự sống lại (nhánh `update`
 *    của `savePatternCellAction` xoá `effectiveTo`).
 */
export async function removePersonFromBlockAction(
  input: unknown,
): Promise<Res<{ soDong: number }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = goSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const { userId, centerId } = p.data;
  // `scopedDb` KHÔNG che WRITE — cổng quyền phải tự đứng ở đây, y như `savePatternCellAction`.
  if (!(await checkPermission("hr_attendance:assign", { centerId })))
    return { ok: false, error: "Không có quyền xếp khung ca ở khối này" };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const denHet = vnDateOnly(new Date());

  const { count } = await sdb.shiftWeeklyPattern.updateMany({
    // `effectiveTo: null` trong điều kiện: gỡ hai lần không được lùi ngày của lần gỡ đầu.
    where: {
      userId,
      centerId,
      effectiveFrom: DEFAULT_EFFECTIVE_FROM,
      effectiveTo: null,
    },
    data: { effectiveTo: denHet },
  });
  if (count === 0)
    return { ok: false, error: "Người này không còn trong khung ca của khối" };

  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "ShiftWeeklyPattern",
    entityId: `${centerId}:${userId}`,
    action: "PATTERN_REMOVE",
    newValues: { userId, centerId, effectiveTo: denHet, soDong: count },
    reason: "Gỡ khỏi khung ca tuần của khối (gỡ mềm, không xoá nhân sự)",
  });

  revalidatePath("/cham-cong/khung-ca");
  return { ok: true, data: { soDong: count } };
}

const genSchema = z.object({
  periodKey: z.string().regex(/^\d{4}-\d{2}$/),
  centerIds: z.array(z.string().min(1)).min(1).max(10),
  /** Đường vượt cổng "kỳ đã chốt sổ" — chỉ cấp Hội sở, bắt buộc lý do. */
  boQuaKyDaChot: z.boolean().optional(),
  lyDo: z.string().trim().max(300).optional(),
});

/** Sinh lưới tháng từ khung ca cho các khối được chọn. Không đè ô đã sửa tay / đơn / file. */
/**
 * 🔴 LÕI DÙNG CHUNG cho XEM TRƯỚC và GHI THẬT — một thân hàm, hai cửa.
 *
 * Vì sao KHÔNG chép thành hai action: cổng quyền + cổng kỳ ĐÃ CHỐT nằm trong đây. Một bản
 * xem trước thiếu cổng sẽ hứa một kết quả mà lượt ghi thật từ chối — tức là lại một affordance
 * nói dối (luật 12). Xem trước phải dự đoán ĐÚNG thứ sắp xảy ra, nên nó đi qua ĐÚNG các cổng.
 *
 * Chỉ ba thứ khác nhau giữa hai chế độ, và đều nằm ở CUỐI: câu lệnh ghi (chặn trong
 * `generateMonthAssignments` bằng `ghiThat`), dòng audit, và `revalidatePath`.
 */
async function chayGenerate(
  input: unknown,
  ghiThat: boolean,
): Promise<Res<GenerateResult>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = genSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Kỳ / khối không hợp lệ" };
  const allowed = new Set<string>();
  for (const id of p.data.centerIds)
    if (await checkPermission("hr_attendance:assign", { centerId: id }))
      allowed.add(id);
  if (allowed.size === 0)
    return { ok: false, error: "Không có quyền phân ca ở khối nào đã chọn" };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // ── CHẶN CỨNG: không xếp lại khung ca vào kỳ ĐÃ CHỐT SỔ (08/09/2026) ─────────
  //
  // `generateMonthAssignments` ghi đè `ShiftAssignment` cho cả tháng và KHÔNG hỏi
  // trạng thái kỳ. Kỳ đã chốt thì `StaffAttendanceDay` đã đóng băng theo số cũ, nên ghi
  // đè là làm lệch bảng công đã ký. Đo 08/09: prod 1 kỳ OPEN / 0 LOCKED — lỗ chưa ai
  // khai thác được, và đang mở sẵn cho lần chốt kỳ ĐẦU TIÊN.
  //
  // Đặt TRƯỚC khi gọi engine: cổng phải chặn trước khi có dòng nào bị ghi.
  const kyDaChot = await sdb.attendancePeriod.findMany({
    where: {
      centerId: { in: [...allowed] },
      periodKey: p.data.periodKey,
      status: "LOCKED",
    },
    select: { centerId: true },
  });
  if (kyDaChot.length > 0) {
    const loi = chanSuaKyDaChot({
      status: "LOCKED",
      periodKey: p.data.periodKey,
    });
    // Đường vượt cấp HỘI SỞ + lý do bắt buộc — cùng khuôn `reopenPeriodAction`. Cơ sở tự
    // vượt cổng chặn của chính mình thì cổng đó không tồn tại.
    if (!p.data.boQuaKyDaChot) return { ok: false, error: loi! };
    if (
      !(await checkPermission("hr_attendance:close-period", {
        centerId: HO_CENTER_ID,
      }))
    ) {
      return {
        ok: false,
        error: "Chỉ cấp Hội sở mới xếp lại được khung ca của kỳ đã chốt",
      };
    }
    if ((p.data.lyDo ?? "").trim().length < 5) {
      return {
        ok: false,
        error:
          "Xếp lại khung ca của kỳ đã chốt phải ghi lý do (tối thiểu 5 ký tự)",
      };
    }
  }

  const map = await loadCenterMap();
  const result = await generateMonthAssignments({
    db: sdb as unknown as GenerateDb,
    // Ranh giới "chỉ áp KỂ TỪ NGÀY MAI" — đọc đồng hồ ở ĐÂY, tầng ngoài cùng, để lõi thuần
    // vẫn test được bằng mốc cố định (luật 19).
    homNay: vnDateOnly(new Date()),
    periodKey: p.data.periodKey,
    centerMap: map,
    centerIds: [...allowed],
    canWriteCenter: (c) => allowed.has(c),
    actorUserId: session.user.id,
    ghiThat,
  });
  // Audit CHỈ khi ghi thật — một lượt xem trước không đổi gì thì không có gì để ghi vào sổ,
  // và nhét nó vào là làm loãng đúng cái sổ người ta mở ra để tìm "ai đã đổi lưới".
  if (ghiThat) await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "ShiftAssignment",
    entityId: p.data.periodKey,
    action: "GENERATE",
    newValues: {
      periodKey: p.data.periodKey,
      centerIds: [...allowed],
      boQuaKyDaChot: p.data.boQuaKyDaChot === true,
      kyDaChot: kyDaChot.map((k: { centerId: string }) => k.centerId),
      ...result,
      restWarnings: result.restWarnings.length,
    },
    reason: p.data.lyDo,
  });
  // Làm giàu TÊN cho cảnh báo 7 ngày không nghỉ. Tầng lib cố ý không tra được tên
  // (`GenerateDb` chỉ có 3 model, không có `user`), nên hộp thoại trước đây chỉ in được khoảng
  // ngày rồi phải nói vòng "xem lưới bên dưới để biết là ai" — tự nó thừa nhận thiếu.
  // `User` thuộc `SCOPE_EXEMPT` nên `sdb` vẫn tra được tên; rỗng thì bỏ hẳn truy vấn, đừng bắn
  // `in: []`. Audit ở trên GIỮ NGUYÊN chỉ số đếm — đừng nhét tên người vào `newValues`.
  const idCanhBao = [...new Set(result.restWarnings.map((w) => w.userId))];
  const tenCua = idCanhBao.length
    ? new Map(
        (
          await sdb.user.findMany({
            where: { id: { in: idCanhBao } },
            select: { id: true, name: true, email: true },
          })
        ).map((u) => [u.id, u.name ?? u.email ?? u.id]),
      )
    : new Map<string, string>();

  if (ghiThat) revalidatePath("/cham-cong/phan-ca");
  return {
    ok: true,
    data: {
      ...result,
      restWarnings: result.restWarnings.map((w) => ({
        ...w,
        name: tenCua.get(w.userId) ?? null,
      })),
    },
  };
}

/**
 * XEM TRƯỚC — đọc DB, dựng kế hoạch, trả đủ bảy con số + `chiTiet` từng ô. **KHÔNG ghi gì.**
 *
 * Đây là MẶC ĐỊNH của nút "Sinh lưới từ khung": `generateMonthAssignments` huỷ rồi tạo lại ô
 * ca cho cả tháng, và trước 13/09/2026 bảy con số ấy chỉ hiện SAU KHI ĐÃ GHI — đúng hình dạng
 * đã làm mất dữ liệu ở đường nhập file. Cùng khuôn `previewImportAction`/`applyImportAction`.
 */
export async function xemTruocSinhLuoiAction(input: unknown): Promise<Res<GenerateResult>> {
  return chayGenerate(input, false);
}

/** GHI THẬT — bước xác nhận THỨ HAI, sau khi người dùng đã đọc bảng xem trước. */
export async function generateMonthAction(input: unknown): Promise<Res<GenerateResult>> {
  return chayGenerate(input, true);
}
