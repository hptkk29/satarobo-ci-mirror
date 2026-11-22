// lib/cham-cong/generate-db.ts — Sinh lưới tháng từ khung ca tuần: đọc pattern + ô hiện có,
// lập kế hoạch (generate.ts, thuần), ghi QUA `chayLenhO` (ghi-o.ts), trả kết quả TỪNG Ô. Không "use server".
//
// T04 (07/10/2026): file này KHÔNG CÒN tự huỷ/tạo ô. Nó chỉ (1) đọc khung + ô hiện có, (2) lập kế hoạch bằng bộ thuần,
// (3) đổi kế hoạch thành LỆNH rồi giao cho service ghi ô — chỗ duy nhất có khoá, transaction, cổng kỳ chốt và mã ca
// theo cơ sở. Kết cục THẬT của từng ô (kể cả ô bị bỏ vì kỳ chốt / thiếu quyền / mã lạ) lấy từ service, nên bảng xem
// trước không còn ghi "TẠO" cho một ô rốt cuộc bị bỏ.
import type { PrismaClient } from "@prisma/client";
import { db as dbTran } from "@/lib/db";
import { planMonthFromPatterns, warnNoWeeklyRest, type ExistingCell, type PatternRow, type PlannedCell } from "./generate";
import { chayLenhO, type KetQuaO, type LenhO } from "./ghi-o";
import type { LyDoBoQua } from "./ghi-o-luat";
import type { CenterMap } from "./place";

/** Chỉ còn dùng để ĐỌC khung ca (client có thể đã lọc theo cơ sở của người thao tác). Ô được đọc/ghi bằng client trần. */
export type GenerateDb = Pick<PrismaClient, "shiftWeeklyPattern">;

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
  /** Ô nằm trong kỳ công đã CHỐT — không đổi (T04). */
  skippedKyDaChot: number;
  /** Khung thuộc khối không ánh xạ được sang cơ sở — trước T04 bị gán thầm cho Hội sở (T04). */
  skippedCoSoLa: number;
  /** Từng ô một, để màn XEM TRƯỚC bày ra bảng. Cùng dữ liệu ở cả hai chế độ. */
  chiTiet: DongKeHoach[];
  restWarnings: { userId: string; from: string; to: string }[];
  warnings: string[];
};

function unitOfCenter(centerId: string, map: CenterMap): string | null {
  if (centerId === map.hoCenterId) return "HO";
  return Object.entries(map.byCode).find(([, c]) => c.centerId === centerId)?.[0] ?? null;
}

/** Một ô trong kế hoạch, đã rút gọn cho màn hình. */
export type DongKeHoach = {
  userId: string;
  /** "YYYY-MM-DD". */
  ngay: string;
  /** Kết cục THẬT: hành động của kế hoạch, hoặc BO_QUA kèm lý do khi service từ chối. */
  action: PlannedCell["action"] | "BO_QUA";
  /** Chỉ có khi `action === "BO_QUA"` và do SERVICE bỏ (kế hoạch đã nói `SKIP_*` thì `action` tự nói lên). */
  lyDo?: LyDoBoQua;
  /** Mã đang có trên lưới (rỗng = chưa có ô nào). */
  maCu: string;
  /** Mã theo khung ca tuần (rỗng = khung không xếp gì ngày đó). */
  maMoi: string;
};

export async function generateMonthAssignments(opts: {
  /** Đọc KHUNG ca. Có thể là client đã lọc theo cơ sở — người thao tác chỉ sinh cho khung mình thấy. */
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
   * `false` ⇒ hàm đọc DB, dựng kế hoạch, đếm đủ các con số và trả `chiTiet`, nhưng **KHÔNG
   * chạy một câu lệnh ghi nào**. Đó là chế độ màn XEM TRƯỚC dùng.
   *
   * Vì sao phải có: hàm này `CANCELLED` rồi tạo lại ô ca cho cả tháng, và trước 13/09/2026
   * bảy con số kết quả **chỉ hiện SAU KHI ĐÃ GHI DB** — đúng hình dạng đã làm mất dữ liệu ở
   * đường nhập file. Cùng khuôn với `previewImportAction`/`applyImportAction` và với
   * `scripts/nhap-danh-muc-nen.ts` (`--apply`); KHÔNG dựng khuôn thứ ba.
   *
   * ⚠️ Xem trước và ghi thật đi CÙNG MỘT đường quyết định (`chayLenhO`) — chỉ khác câu lệnh ghi cuối. Nếu xem trước có
   * vòng đếm riêng thì sớm muộn hai bản lệch nhau, và người dùng tin bản mình đang nhìn (luật 12b).
   */
  ghiThat: boolean;
  /**
   * "Ghi đè cả ô nhập thủ công" (IMPORT / MANUAL) — quyết định 07/10. BẮT BUỘC khai, không mặc định (luật 7): mặc định
   * `false` ở chỗ gọi là chỗ duy nhất người dùng có thể vô tình xoá ô họ vừa nhập tay.
   */
  ghiDeNhapTay: boolean;
  /** Vượt cổng kỳ chốt — chỉ `true` khi action ĐÃ kiểm quyền Hội sở + lý do. BẮT BUỘC khai. */
  boQuaKyDaChot: boolean;
  /**
   * Chỉ xét những ngày thoả điều kiện này (đẩy khung "từ ngày X" / "chỉ thứ vừa sửa" — `day-khung.ts`). Bỏ trống = cả tháng.
   * Ô ngoài bộ lọc KHÔNG vào kế hoạch, không vào `chiTiet`, không bị đếm; cảnh báo 7 ngày không nghỉ vẫn tính trên CẢ tháng.
   */
  chiNhungNgay?: (workDate: Date) => boolean;
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
  const result: GenerateResult = { created: 0, replaced: 0, kept: 0, cleared: 0, skippedProtected: 0, skippedPast: 0, skippedNoPermission: 0, skippedKyDaChot: 0, skippedCoSoLa: 0, unknownCode: 0, people: 0, chiTiet: [], restWarnings: [], warnings: [] };
  // Khung thuộc khối không ánh xạ được ⇒ BỎ QUA có báo (trước đây `unitOfCenter` rơi về "HO" âm thầm: ô của cơ sở lạ bị
  // gán cho Hội sở mà không ai biết).
  const patterns: PatternRow[] = [];
  const khoiLa = new Set<string>();
  for (const p of patternsRaw) {
    const unit = unitOfCenter(p.centerId, opts.centerMap);
    if (!unit) {
      khoiLa.add(p.centerId);
      continue;
    }
    patterns.push({ userId: p.userId, unit, weekday: p.weekday, templateCode: p.templateCode, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo });
  }
  if (khoiLa.size > 0) {
    result.skippedCoSoLa = patternsRaw.length - patterns.length;
    result.warnings.push(`${patternsRaw.length - patterns.length} dòng khung thuộc cơ sở không ánh xạ được (${[...khoiLa].join(", ")}) — bỏ qua, không gán cho Hội sở`);
  }
  const userIds = [...new Set(patterns.map((p) => p.userId))];
  result.people = userIds.length;

  // Ô hiện có đọc bằng client TRẦN: client đã lọc theo cơ sở làm ô ở cơ sở khác VÔ HÌNH ⇒ kế hoạch nói "TẠO" ⇒ đụng chỉ mục
  // "một ô ACTIVE mỗi người mỗi ngày". Quyền ghi vẫn do `canWriteCenter` chặn (service kiểm cả ô cũ lẫn ô mới).
  const existingRaw = await dbTran.shiftAssignment.findMany({
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

  const planCaThang = planMonthFromPatterns({ year, month1, patterns, existing, onlyUserIds: opts.onlyUserIds, homNay: opts.homNay, ghiDeNhapTay: opts.ghiDeNhapTay });
  const loc = opts.chiNhungNgay;
  const plan = loc ? planCaThang.filter((c) => loc(c.workDate)) : planCaThang;

  // Kế hoạch → LỆNH. Chỉ ô CREATE / REPLACE / CLEAR cần service quyết; KEEP / SKIP_* đã rõ từ kế hoạch.
  const lenhs: LenhO[] = [];
  const chiTietTheoKhoa = new Map<string, DongKeHoach>();
  for (const cell of plan) {
    const key = `${cell.userId}|${cell.workDate.toISOString().slice(0, 10)}`;
    const ex = existingId.get(key);
    const dong: DongKeHoach = {
      userId: cell.userId,
      ngay: key.split("|")[1],
      action: cell.action,
      maCu: ex?.templateCode ?? "",
      maMoi: cell.action === "SKIP_QUA_KHU" || cell.action === "SKIP_PROTECTED" || cell.action === "CLEAR" ? "" : cell.code,
    };
    // `chiTiet` được dựng ở ĐÂY cho MỌI ô, MỌI chế độ — một chỗ duy nhất; riêng `action` của ô do service quyết sẽ được
    // thay bằng kết cục thật ngay sau khi service chạy.
    result.chiTiet.push(dong);
    chiTietTheoKhoa.set(key, dong);
    if (cell.action === "SKIP_PROTECTED") result.skippedProtected += 1;
    else if (cell.action === "SKIP_QUA_KHU") result.skippedPast += 1;
    else if (cell.action === "KEEP") result.kept += 1;
    else if (cell.action === "CLEAR") lenhs.push({ userId: cell.userId, workDate: cell.workDate, code: null, homeUnit: ex ? (unitOfCenter(ex.centerId, opts.centerMap) ?? "HO") : "HO", source: "PATTERN" });
    else lenhs.push({ userId: cell.userId, workDate: cell.workDate, code: cell.code, homeUnit: cell.unit || "HO", source: "PATTERN", sourceCells: cell.sourceCells });
  }

  const { ketQua } = await chayLenhO({
    ctx: {
      centerMap: opts.centerMap,
      canWriteCenter: opts.canWriteCenter,
      actorUserId: opts.actorUserId,
      homNay: opts.homNay,
      ghiDeNhapTay: opts.ghiDeNhapTay,
      boQuaKyDaChot: opts.boQuaKyDaChot,
    },
    lenhs,
    ghiThat: opts.ghiThat,
  });
  for (const k of ketQua) thuKetQua(result, k, chiTietTheoKhoa);

  result.restWarnings = warnNoWeeklyRest(planCaThang);
  return result;
}

function thuKetQua(result: GenerateResult, k: KetQuaO, chiTiet: Map<string, DongKeHoach>): void {
  const key = `${k.userId}|${k.workDate.toISOString().slice(0, 10)}`;
  const dong = chiTiet.get(key);
  switch (k.ket) {
    case "TAO":
      result.created += 1;
      break;
    case "THAY":
      result.replaced += 1;
      break;
    case "XOA":
      result.cleared += 1;
      break;
    case "GIU":
      // Service thấy ô đã đúng (kế hoạch dựng từ ảnh cũ): coi như GIỮ.
      result.kept += 1;
      if (dong) dong.action = "KEEP";
      break;
    case "BO_QUA":
      switch (k.lyDo) {
        case "O_DUOC_BAO_VE":
          result.skippedProtected += 1;
          break;
        case "KHONG_QUYEN_CO_SO_CU":
        case "KHONG_QUYEN_CO_SO_MOI":
          result.skippedNoPermission += 1;
          break;
        case "MA_KHONG_CO":
          result.unknownCode += 1;
          result.warnings.push(`Mã "${dong?.maMoi ?? "?"}" không có trong danh mục (người ${k.userId}, ${key.split("|")[1]})`);
          break;
        case "KY_DA_CHOT":
          result.skippedKyDaChot += 1;
          break;
        case "CO_SO_LA":
          result.skippedCoSoLa += 1;
          break;
        case "QUA_KHU":
          result.skippedPast += 1;
          break;
      }
      if (dong) {
        dong.action = "BO_QUA";
        dong.lyDo = k.lyDo;
        // Ô bị bỏ ⇒ không còn "mã mới" nào được áp.
        if (k.lyDo !== "MA_KHONG_CO") dong.maMoi = "";
      }
      break;
  }
}
