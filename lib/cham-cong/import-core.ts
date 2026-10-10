// lib/cham-cong/import-core.ts — Lõi import lịch phân ca từ Sheet (KHUNG CA → ShiftWeeklyPattern,
// LỊCH Tmm → ShiftAssignment). Không "use server": Server Action ở app/ chỉ lo auth + file, rồi
// gọi vào đây; test tích hợp gọi thẳng với Postgres local.
//
// Luật (kế hoạch §4.1, §6b):
//  - Ánh xạ tên Sheet → userId do NGƯỜI VẬN HÀNH xác nhận (mapping), hệ thống chỉ gợi ý; nhớ
//    lại lần sau qua ShiftWeeklyPattern.sheetName.
//  - Ô con trỏ D1/D2 của người 2 dòng gộp vào ô đích (mergePointerCells).
//  - KHÔNG đè ca có nguồn SWAP / LEAVE / MANUAL (đơn đã duyệt, sửa tay) — chỉ báo "giữ".
//  - Đổi ca = CANCELLED dòng cũ + tạo dòng mới (partial unique ACTIVE).
//  - Hàng của cơ sở mà người import không có quyền `assign` → bỏ qua, đếm riêng, không im lặng.
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ShiftSegment, PlaceToken } from "./catalog";
import { mergePointerCells, resolvePlace, type CenterMap } from "./place";
import type { KhungCaRow, MonthGrid, ParsedWorkbook } from "./sheet-parse";
import { countCodes } from "./sheet-parse";
import {
  suggestCandidates,
  type NameCandidate,
  type NameSuggestion,
} from "./name-match";

const DEFAULT_EFFECTIVE_FROM = new Date(Date.UTC(2000, 0, 1));

export type ImportDb = Pick<
  PrismaClient,
  "shiftTemplate" | "shiftWeeklyPattern" | "shiftAssignment"
>;

/** displayName trên Sheet → userId. */
export type ImportMapping = Record<string, string>;

export type PreviewPerson = {
  displayName: string;
  fullName: string;
  units: string[];
  role: string;
  /** đã nhớ từ lần import trước (ShiftWeeklyPattern.sheetName). */
  rememberedUserId: string | null;
  suggestions: NameSuggestion[];
};

export type ImportPreview = {
  people: PreviewPerson[];
  months: {
    periodKey: string;
    sheetName: string;
    rows: number;
    counts: Record<string, number>;
  }[];
  unknownCodes: string[];
  warnings: string[];
};

export async function buildImportPreview(
  parsed: ParsedWorkbook,
  deps: { db: ImportDb; candidates: readonly NameCandidate[] },
): Promise<ImportPreview> {
  const remembered = await deps.db.shiftWeeklyPattern.findMany({
    where: { sheetName: { not: null } },
    select: { sheetName: true, userId: true },
    distinct: ["sheetName"],
  });
  const rememberedBy = new Map(
    remembered.map((r) => [r.sheetName as string, r.userId]),
  );
  const templates = await deps.db.shiftTemplate.findMany({
    where: { isActive: true },
    select: { code: true },
  });
  const known = new Set(templates.map((t) => t.code));

  const byName = new Map<string, PreviewPerson>();
  const consider = (
    displayName: string,
    fullName: string,
    unit: string,
    role: string,
  ) => {
    const p = byName.get(displayName);
    if (p) {
      if (!p.units.includes(unit)) p.units.push(unit);
      return;
    }
    byName.set(displayName, {
      displayName,
      fullName: fullName || displayName,
      units: [unit],
      role,
      rememberedUserId: rememberedBy.get(displayName) ?? null,
      suggestions: [],
    });
  };
  for (const r of parsed.khungCa)
    consider(r.displayName, r.fullName, r.unit, r.role);
  for (const m of parsed.months)
    for (const r of m.rows) consider(r.name, r.name, r.unit, r.role);
  for (const p of byName.values()) {
    p.suggestions = suggestCandidates(
      {
        displayName: p.displayName,
        fullName: p.fullName,
        unit: p.units.length === 1 ? p.units[0] : null,
      },
      deps.candidates,
    ).slice(0, 5);
  }

  const unknownCodes = new Set<string>();
  const months = parsed.months.map((m) => {
    const counts = countCodes(m);
    for (const c of Object.keys(counts)) if (!known.has(c)) unknownCodes.add(c);
    return {
      periodKey: m.periodKey,
      sheetName: m.sheetName,
      rows: m.rows.length,
      counts,
    };
  });
  for (const r of parsed.khungCa)
    for (const c of Object.values(r.byWeekday))
      if (c && !known.has(c)) unknownCodes.add(c);

  return {
    people: [...byName.values()],
    months,
    unknownCodes: [...unknownCodes].sort(),
    warnings: [...parsed.warnings],
  };
}

export type ApplyResult = {
  patterns: {
    upserted: number;
    deleted: number;
    skippedNoMapping: number;
    skippedNoPermission: number;
    unknownCode: number;
  };
  assignments: {
    created: number;
    cancelled: number;
    unchanged: number;
    keptManual: number;
    skippedNoMapping: number;
    skippedNoPermission: number;
    unknownCode: number;
  };
  /** 15 con số: đếm trên Sheet vs đếm ACTIVE trong DB sau import (chỉ người đã ánh xạ). */
  counts: {
    periodKey: string;
    sheet: Record<string, number>;
    db: Record<string, number>;
  }[];
  /** Ngày công có ca đổi (tạo/huỷ) — action xếp hàng tính lại (hr.attendance_day_dirty). */
  changedDays: { userId: string; workDate: Date }[];
  warnings: string[];
};

type TemplateRow = {
  id: string;
  code: string;
  segments: ShiftSegment[];
  defaultPlace: PlaceToken;
  attendanceMode: "REQUIRED" | "OPTIONAL" | "NONE";
  soCapQuetKyVong: number;
  dayCredit: number;
  isLeave: boolean;
  nominalMinutes: number | null;
};

function unitCenterId(unit: string, map: CenterMap): string {
  return unit === "HO"
    ? map.hoCenterId
    : (map.byCode[unit]?.centerId ?? map.hoCenterId);
}

function sectionOf(role: string): "KINH_DOANH" | "GIAO_VIEN" | "VAN_PHONG" {
  const r = role.toLowerCase();
  if (r.includes("giáo viên") || r.includes("giao vien")) return "GIAO_VIEN";
  if (
    r.includes("tư vấn") ||
    r.includes("quản lý") ||
    r.includes("tu van") ||
    r.includes("quan ly")
  )
    return "KINH_DOANH";
  return "VAN_PHONG";
}

export async function applyImport(
  parsed: ParsedWorkbook,
  opts: {
    db: ImportDb;
    mapping: ImportMapping;
    /** Chỉ áp các kỳ này (vd ["2026-09"]); rỗng = không áp lưới, chỉ khung ca. */
    periodKeys: string[];
    centerMap: CenterMap;
    /** Quyền `hr_attendance:assign` theo cơ sở (kể cả "hoi-so"). */
    canWriteCenter: (centerId: string) => boolean;
    actorUserId: string;
    importKhungCa?: boolean;
  },
): Promise<ApplyResult> {
  const warnings: string[] = [];
  const templates = await opts.db.shiftTemplate.findMany({
    where: { isActive: true, centerId: null },
    select: {
      id: true,
      code: true,
      segments: true,
      defaultPlace: true,
      attendanceMode: true,
      dayCredit: true,
      isLeave: true,
      nominalMinutes: true,
      soCapQuetKyVong: true,
    },
  });
  const tplByCode = new Map<string, TemplateRow>(
    templates.map((t) => [
      t.code,
      {
        id: t.id,
        code: t.code,
        segments: (t.segments as ShiftSegment[] | null) ?? [],
        defaultPlace: t.defaultPlace as PlaceToken,
        attendanceMode: t.attendanceMode,
        dayCredit: t.dayCredit,
        isLeave: t.isLeave,
        nominalMinutes: t.nominalMinutes,
        soCapQuetKyVong: t.soCapQuetKyVong,
      },
    ]),
  );

  const result: ApplyResult = {
    patterns: {
      upserted: 0,
      deleted: 0,
      skippedNoMapping: 0,
      skippedNoPermission: 0,
      unknownCode: 0,
    },
    assignments: {
      created: 0,
      cancelled: 0,
      unchanged: 0,
      keptManual: 0,
      skippedNoMapping: 0,
      skippedNoPermission: 0,
      unknownCode: 0,
    },
    counts: [],
    changedDays: [],
    warnings,
  };

  // ── Khung ca tuần ─────────────────────────────────────────────────────────
  if (opts.importKhungCa !== false) {
    for (const row of parsed.khungCa) {
      const userId = opts.mapping[row.displayName];
      if (!userId) {
        result.patterns.skippedNoMapping += 1;
        continue;
      }
      const centerId = unitCenterId(row.unit, opts.centerMap);
      if (!opts.canWriteCenter(centerId)) {
        result.patterns.skippedNoPermission += 1;
        continue;
      }
      const orgUnitId =
        row.unit === "HO"
          ? null
          : (opts.centerMap.byCode[row.unit]?.orgUnitId ?? null);
      for (let wd = 0; wd <= 6; wd += 1) {
        const code = row.byWeekday[wd] ?? null;
        const where = {
          userId_centerId_weekday_effectiveFrom: {
            userId,
            centerId,
            weekday: wd,
            effectiveFrom: DEFAULT_EFFECTIVE_FROM,
          },
        };
        if (!code) {
          const del = await opts.db.shiftWeeklyPattern.deleteMany({
            where: {
              userId,
              centerId,
              weekday: wd,
              effectiveFrom: DEFAULT_EFFECTIVE_FROM,
            },
          });
          result.patterns.deleted += del.count;
          continue;
        }
        const tpl = tplByCode.get(code);
        if (!tpl) {
          result.patterns.unknownCode += 1;
          warnings.push(
            `KHUNG CA: "${row.displayName}" ${WEEKDAY_LABEL[wd]} mã "${code}" không có trong danh mục — bỏ ô`,
          );
          continue;
        }
        await opts.db.shiftWeeklyPattern.upsert({
          where,
          create: {
            userId,
            centerId,
            orgUnitId,
            weekday: wd,
            templateId: tpl.id,
            templateCode: tpl.code,
            sheetName: row.displayName,
            section: sectionOf(row.role),
            jobLabel: row.role || null,
            displayOrder: row.stt,
            effectiveFrom: DEFAULT_EFFECTIVE_FROM,
          },
          update: {
            templateId: tpl.id,
            templateCode: tpl.code,
            sheetName: row.displayName,
            section: sectionOf(row.role),
            jobLabel: row.role || null,
            displayOrder: row.stt,
            orgUnitId,
            // 🔴 BẮT BUỘC — luật của module, `lib/cham-cong/khung-ca.ts`:
            //   "mọi đường GHI vào cụm phải XOÁ `effectiveTo`."
            // Gỡ người khỏi khối là gỡ MỀM: nó chỉ đặt `effectiveTo`, KHÔNG đổi khoá duy
            // nhất `(userId, centerId, weekday, effectiveFrom)`. Nên `upsert` một ô của
            // người đã gỡ rơi vào ĐÚNG nhánh `update` này và sửa trúng dòng đã đóng —
            // thiếu dòng dưới thì ghi xong ô VẪN TÀNG HÌNH (màn lọc `effectiveTo: null`,
            // `generate.ts` cũng bỏ dòng hết hiệu lực), và người dùng thấy "bấm mà không
            // có gì xảy ra".
            //
            // Đường admin (`khung-ca/_actions.ts`) đã vá chuyện này tuần trước; đường NHẬP
            // FILE thì chưa — cùng một bug, hai cửa, vá cửa còn lại 13/09/2026.
            effectiveTo: null,
          },
        });
        result.patterns.upserted += 1;
      }

      // ── CỔNG (d): kéo CẢ CỤM về một `section` ────────────────────────────
      //
      // Vòng trên chỉ chạm những thứ CÓ MÃ trong file; ô trống thì `continue`/xoá. Nên
      // khi một file phủ nửa vời, dòng cũ giữ `section` cũ còn dòng mới mang giá trị mới
      // — cụm lệch, im lặng. `brief-db.ts:45-52` đọc `distinct` rồi lọc thông báo theo
      // `section`, nên lệch nghĩa là "ai nhận thông báo của bộ phận nào" do thứ tự truy
      // vấn quyết định. Luật đầy đủ: `lib/cham-cong/khung-ca.ts` mục (d).
      //
      // File LÀ nguồn sự thật về vai trò ở đây, nên ghi thẳng `sectionOf(row.role)` cho
      // cả cụm chứ không đi qua `sectionChoCum` (hàm đó giữ giá trị CŨ — đúng cho màn
      // admin, sai cho lượt nhập file).
      await opts.db.shiftWeeklyPattern.updateMany({
        where: { userId, centerId, effectiveFrom: DEFAULT_EFFECTIVE_FROM },
        data: { section: sectionOf(row.role) },
      });
    }
  }

  // ── Lưới tháng ────────────────────────────────────────────────────────────
  for (const grid of parsed.months) {
    if (!opts.periodKeys.includes(grid.periodKey)) continue;
    const perPerson = groupRowsByName(grid);
    const mappedUserIds = new Set<string>();
    for (const [displayName, rows] of perPerson) {
      const userId = opts.mapping[displayName];
      if (!userId) {
        result.assignments.skippedNoMapping += rows.length * grid.daysInMonth;
        continue;
      }
      const employeeId = opts.mapping[`employee:${displayName}`] ?? null;
      let touched = false;
      for (let day = 1; day <= grid.daysInMonth; day += 1) {
        const cellsByUnit: Record<string, string | null> = {};
        for (const r of rows) cellsByUnit[r.unit] = r.cells[day] ?? null;
        const merged = mergePointerCells(cellsByUnit);
        const workDate = new Date(Date.UTC(grid.year, grid.month - 1, day));
        const existing = await opts.db.shiftAssignment.findFirst({
          where: { userId, workDate, status: "ACTIVE" },
          select: {
            id: true,
            templateCode: true,
            centerId: true,
            source: true,
          },
        });
        if (
          existing &&
          (existing.source === "SWAP" ||
            existing.source === "LEAVE" ||
            existing.source === "MANUAL")
        ) {
          result.assignments.keptManual += 1;
          continue;
        }
        if (!merged.code) {
          if (existing) {
            if (!opts.canWriteCenter(existing.centerId)) {
              result.assignments.skippedNoPermission += 1;
              continue;
            }
            await opts.db.shiftAssignment.updateMany({
              where: { id: existing.id },
              data: { status: "CANCELLED" },
            });
            result.assignments.cancelled += 1;
            result.changedDays.push({ userId, workDate });
          }
          continue;
        }
        const tpl = tplByCode.get(merged.code);
        if (!tpl) {
          result.assignments.unknownCode += 1;
          warnings.push(
            `${grid.sheetName}: "${displayName}" ngày ${day} mã "${merged.code}" không có trong danh mục — bỏ ô`,
          );
          continue;
        }
        const homeUnit = merged.unit ?? rows[0].unit;
        const place = resolvePlace({
          segments: tpl.segments,
          defaultPlace: tpl.defaultPlace,
          homeUnit,
          map: opts.centerMap,
        });
        for (const w of place.warnings)
          warnings.push(
            `${grid.sheetName}: "${displayName}" ngày ${day}: ${w}`,
          );
        const centerId = place.centerId;
        if (!opts.canWriteCenter(centerId)) {
          result.assignments.skippedNoPermission += 1;
          continue;
        }
        if (
          existing &&
          existing.templateCode === tpl.code &&
          existing.centerId === centerId
        ) {
          result.assignments.unchanged += 1;
          mappedUserIds.add(userId);
          continue;
        }
        if (existing) {
          await opts.db.shiftAssignment.updateMany({
            where: { id: existing.id },
            data: { status: "CANCELLED" },
          });
          result.assignments.cancelled += 1;
        }
        const orgUnitId =
          centerId === opts.centerMap.hoCenterId
            ? null
            : (Object.values(opts.centerMap.byCode).find(
                (c) => c.centerId === centerId,
              )?.orgUnitId ?? null);
        await opts.db.shiftAssignment.create({
          data: {
            userId,
            employeeId,
            centerId,
            orgUnitId,
            workDate,
            templateId: tpl.id,
            templateCode: tpl.code,
            segments: place.segments as unknown as Prisma.InputJsonValue,
            placeMode: place.placeMode,
            allowedOrgUnitIds: place.allowedOrgUnitIds,
            attendanceMode: tpl.attendanceMode,
            dayCredit: tpl.dayCredit,
            isLeave: tpl.isLeave,
            nominalMinutes: tpl.nominalMinutes,
            soCapQuetKyVong: tpl.soCapQuetKyVong,
            sourceCells: merged.sourceCells as Prisma.InputJsonValue,
            source: "IMPORT",
            createdById: opts.actorUserId,
          },
        });
        result.assignments.created += 1;
        result.changedDays.push({ userId, workDate });
        touched = true;
        mappedUserIds.add(userId);
      }
      if (touched) mappedUserIds.add(userId);
    }
    // Đối chiếu 15 con số: Sheet (người đã ánh xạ) vs DB.
    const sheetCounts = countCodes({
      rows: grid.rows.filter((r) => opts.mapping[r.name]),
    });
    const from = new Date(Date.UTC(grid.year, grid.month - 1, 1));
    const to = new Date(Date.UTC(grid.year, grid.month - 1, grid.daysInMonth));
    const dbRows = await opts.db.shiftAssignment.findMany({
      where: {
        userId: { in: [...mappedUserIds] },
        workDate: { gte: from, lte: to },
        status: "ACTIVE",
      },
      select: { templateCode: true, sourceCells: true },
    });
    const dbCounts: Record<string, number> = {};
    for (const r of dbRows) {
      // Đếm theo Ô Sheet (sourceCells) để so được với lưới: một ngày D2+CG là 2 ô trên Sheet.
      const cells = (r.sourceCells as Record<string, string> | null) ?? {
        "?": r.templateCode,
      };
      for (const code of Object.values(cells))
        dbCounts[code] = (dbCounts[code] ?? 0) + 1;
    }
    result.counts.push({
      periodKey: grid.periodKey,
      sheet: sheetCounts,
      db: dbCounts,
    });
  }
  return result;
}

const WEEKDAY_LABEL = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export function groupRowsByName(
  grid: MonthGrid,
): Map<string, MonthGrid["rows"]> {
  const m = new Map<string, MonthGrid["rows"]>();
  for (const r of grid.rows) {
    const list = m.get(r.name) ?? [];
    list.push(r);
    m.set(r.name, list);
  }
  return m;
}

/** Tiện ích cho action: ứng viên = nhân sự đang làm việc có tài khoản. */
export function toCandidates(
  employees: {
    id: string;
    fullName: string;
    phone: string | null;
    center: { code: string | null } | null;
    userAccount: { id: string; name: string | null } | null;
  }[],
): NameCandidate[] {
  return employees
    .filter((e) => e.userAccount)
    .map((e) => ({
      userId: e.userAccount!.id,
      employeeId: e.id,
      fullName: e.fullName,
      userName: e.userAccount!.name,
      phone: e.phone,
      centerCode: e.center?.code ?? null,
    }));
}

export type { KhungCaRow };
