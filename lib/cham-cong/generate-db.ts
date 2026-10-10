// lib/cham-cong/generate-db.ts — Sinh lưới tháng từ khung ca tuần: đọc pattern + ô hiện có,
// lập kế hoạch (generate.ts, thuần), ghi ShiftAssignment, xếp hàng tính lại. Không "use server".
import type { Prisma, PrismaClient } from "@prisma/client";
import type { PlaceToken, ShiftSegment } from "./catalog";
import { planMonthFromPatterns, warnNoWeeklyRest, type ExistingCell, type PatternRow, type PlannedCell } from "./generate";
import { resolvePlace, type CenterMap } from "./place";
import { markAttendanceDaysDirtyMany } from "./recompute";

export type GenerateDb = Pick<PrismaClient, "shiftTemplate" | "shiftWeeklyPattern" | "shiftAssignment">;

export type GenerateResult = {
  created: number;
  replaced: number;
  kept: number;
  cleared: number;
  skippedProtected: number;
  skippedNoPermission: number;
  unknownCode: number;
  people: number;
  /** Ngày ≤ HÔM NAY bị chừa lại — lượt sinh lưới không chạm quá khứ và hôm nay. */
  skippedPast: number;
  /** Từng ô một, để màn XEM TRƯỚC bày ra bảng. Cùng dữ liệu ở cả hai chế độ. */
  chiTiet: DongKeHoach[];
  restWarnings: { userId: string; from: string; to: string }[];
  warnings: string[];
};

function unitOfCenter(centerId: string, map: CenterMap): string {
  if (centerId === map.hoCenterId) return "HO";
  return Object.entries(map.byCode).find(([, c]) => c.centerId === centerId)?.[0] ?? "HO";
}

/** Một ô trong kế hoạch, đã rút gọn cho màn hình. */
export type DongKeHoach = {
  userId: string;
  /** "YYYY-MM-DD". */
  ngay: string;
  action: PlannedCell["action"];
  /** Mã đang có trên lưới (rỗng = chưa có ô nào). */
  maCu: string;
  /** Mã theo khung ca tuần (rỗng = khung không xếp gì ngày đó). */
  maMoi: string;
};

export async function generateMonthAssignments(opts: {
  db: GenerateDb;
  periodKey: string; // "YYYY-MM"
  centerMap: CenterMap;
  /** Chỉ sinh cho người có pattern ở các khối này (centerId); rỗng = mọi khối có quyền. */
  centerIds?: string[];
  canWriteCenter: (centerId: string) => boolean;
  actorUserId: string;
  onlyUserIds?: string[];
  /**
   * HÔM NAY theo lịch VN (`vnDateOnly(new Date())`) — BẮT BUỘC, không mặc định.
   * Luật 7 + luật 19: để hàm tự đọc đồng hồ là biến ranh giới "chỉ áp từ ngày mai" thành
   * thứ không test được. Nơi gọi quyết định, và test truyền mốc cố định.
   */
  homNay: Date;
  /**
   * 🔴 GHI THẬT hay chỉ LẬP KẾ HOẠCH. BẮT BUỘC, không mặc định — luật 7.
   *
   * `false` ⇒ hàm đọc DB, dựng kế hoạch, đếm đủ bảy con số và trả `chiTiet`, nhưng **KHÔNG
   * chạy một câu lệnh ghi nào**. Đó là chế độ màn XEM TRƯỚC dùng.
   *
   * Vì sao phải có: hàm này `CANCELLED` rồi tạo lại ô ca cho cả tháng, và trước 13/09/2026
   * bảy con số kết quả **chỉ hiện SAU KHI ĐÃ GHI DB** — đúng hình dạng đã làm mất dữ liệu ở
   * đường nhập file. Cùng khuôn với `previewImportAction`/`applyImportAction` và với
   * `scripts/nhap-danh-muc-nen.ts` (`--apply`); KHÔNG dựng khuôn thứ ba.
   *
   * ⚠️ Đếm bằng CHÍNH vòng lặp ghi, chỉ chặn ở câu lệnh cuối — nếu xem trước có vòng đếm
   * riêng thì sớm muộn hai bản lệch nhau, và người dùng tin bản mình đang nhìn (luật 12b).
   */
  ghiThat: boolean;
}): Promise<GenerateResult> {
  const m = /^(\d{4})-(\d{2})$/.exec(opts.periodKey);
  if (!m) throw new Error(`periodKey không hợp lệ: ${opts.periodKey}`);
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  const from = new Date(Date.UTC(year, month1 - 1, 1));
  const to = new Date(Date.UTC(year, month1, 0));

  const patternsRaw = await opts.db.shiftWeeklyPattern.findMany({
    where: {
      ...(opts.centerIds?.length ? { centerId: { in: opts.centerIds } } : {}),
      ...(opts.onlyUserIds?.length ? { userId: { in: opts.onlyUserIds } } : {}),
    },
    select: { userId: true, centerId: true, weekday: true, templateCode: true, effectiveFrom: true, effectiveTo: true },
  });
  const patterns: PatternRow[] = patternsRaw.map((p) => ({
    userId: p.userId,
    unit: unitOfCenter(p.centerId, opts.centerMap),
    weekday: p.weekday,
    templateCode: p.templateCode,
    effectiveFrom: p.effectiveFrom,
    effectiveTo: p.effectiveTo,
  }));
  const userIds = [...new Set(patterns.map((p) => p.userId))];
  const existingRaw = await opts.db.shiftAssignment.findMany({
    where: { userId: { in: userIds }, workDate: { gte: from, lte: to }, status: "ACTIVE" },
    select: { id: true, userId: true, workDate: true, templateCode: true, centerId: true, source: true },
  });
  const existing: ExistingCell[] = existingRaw.map((e) => ({
    userId: e.userId,
    workDate: e.workDate,
    templateCode: e.templateCode,
    centerUnit: unitOfCenter(e.centerId, opts.centerMap),
    source: e.source,
  }));
  const existingId = new Map(existingRaw.map((e) => [`${e.userId}|${e.workDate.toISOString().slice(0, 10)}`, e]));

  const templates = await opts.db.shiftTemplate.findMany({
    where: { isActive: true, centerId: null },
    select: { id: true, code: true, segments: true, defaultPlace: true, attendanceMode: true, dayCredit: true, isLeave: true, nominalMinutes: true, soCapQuetKyVong: true },
  });
  const tpl = new Map(templates.map((t) => [t.code, t]));

  const plan = planMonthFromPatterns({ year, month1, patterns, existing, onlyUserIds: opts.onlyUserIds, homNay: opts.homNay });
  const result: GenerateResult = { created: 0, replaced: 0, kept: 0, cleared: 0, skippedProtected: 0, skippedPast: 0, skippedNoPermission: 0, unknownCode: 0, people: userIds.length, chiTiet: [], restWarnings: [], warnings: [] };
  const ghi = opts.ghiThat;
  const changed: { userId: string; workDate: Date }[] = [];

  for (const cell of plan) {
    const key = `${cell.userId}|${cell.workDate.toISOString().slice(0, 10)}`;
    const ex = existingId.get(key);
    // Ghi `chiTiet` ở ĐÂY, đầu vòng lặp, cho MỌI ô và MỌI chế độ — một chỗ duy nhất, nên
    // bảng xem trước và kết quả ghi thật không bao giờ kể hai câu chuyện khác nhau.
    result.chiTiet.push({
      userId: cell.userId,
      ngay: key.split("|")[1],
      action: cell.action,
      maCu: ex?.templateCode ?? "",
      maMoi: cell.action === "SKIP_QUA_KHU" || cell.action === "SKIP_PROTECTED" || cell.action === "CLEAR" ? "" : cell.code,
    });
    if (cell.action === "SKIP_PROTECTED") {
      result.skippedProtected += 1;
      continue;
    }
    // Ngày ≤ hôm nay: planner đã quyết định chừa. Ở đây chỉ đếm — KHÔNG có câu lệnh ghi nào
    // sau nhánh này, và đó là điều duy nhất khiến bản vá có nghĩa.
    if (cell.action === "SKIP_QUA_KHU") {
      result.skippedPast += 1;
      continue;
    }
    if (cell.action === "KEEP") {
      result.kept += 1;
      continue;
    }
    if (cell.action === "CLEAR") {
      if (ex && opts.canWriteCenter(ex.centerId)) {
        if (ghi) await opts.db.shiftAssignment.updateMany({ where: { id: ex.id }, data: { status: "CANCELLED" } });
        result.cleared += 1;
        changed.push({ userId: cell.userId, workDate: cell.workDate });
      } else if (ex) result.skippedNoPermission += 1;
      continue;
    }
    const t = tpl.get(cell.code);
    if (!t) {
      result.unknownCode += 1;
      result.warnings.push(`Mã "${cell.code}" không có trong danh mục (người ${cell.userId}, ${key.split("|")[1]})`);
      continue;
    }
    const place = resolvePlace({ segments: (t.segments as ShiftSegment[] | null) ?? [], defaultPlace: t.defaultPlace as PlaceToken, homeUnit: cell.unit || "HO", map: opts.centerMap });
    if (!opts.canWriteCenter(place.centerId)) {
      result.skippedNoPermission += 1;
      continue;
    }
    if (ex) {
      if (!opts.canWriteCenter(ex.centerId)) {
        result.skippedNoPermission += 1;
        continue;
      }
      if (ghi) await opts.db.shiftAssignment.updateMany({ where: { id: ex.id }, data: { status: "CANCELLED" } });
    }
    const orgUnitId = place.centerId === opts.centerMap.hoCenterId ? null : (Object.values(opts.centerMap.byCode).find((c) => c.centerId === place.centerId)?.orgUnitId ?? null);
    if (ghi) await opts.db.shiftAssignment.create({
      data: {
        userId: cell.userId,
        centerId: place.centerId,
        orgUnitId,
        workDate: cell.workDate,
        templateId: t.id,
        templateCode: t.code,
        segments: place.segments as unknown as Prisma.InputJsonValue,
        placeMode: place.placeMode,
        allowedOrgUnitIds: place.allowedOrgUnitIds,
        attendanceMode: t.attendanceMode,
        soCapQuetKyVong: t.soCapQuetKyVong,
        dayCredit: t.dayCredit,
        isLeave: t.isLeave,
        nominalMinutes: t.nominalMinutes,
        sourceCells: cell.sourceCells as Prisma.InputJsonValue,
        source: "PATTERN",
        createdById: opts.actorUserId,
      },
    });
    if (ex) result.replaced += 1;
    else result.created += 1;
    changed.push({ userId: cell.userId, workDate: cell.workDate });
  }
  result.restWarnings = warnNoWeeklyRest(plan);
  // Xếp hàng tính lại chỉ khi ĐÃ GHI. Chế độ xem trước không được để lại dấu vết nào —
  // kể cả một dòng `DomainEvent`, vì cron sẽ nhặt nó lên và tính lại một thứ chưa đổi.
  if (ghi) await markAttendanceDaysDirtyMany(changed, { reason: "generate" });
  return result;
}
