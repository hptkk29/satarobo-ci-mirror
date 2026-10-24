// lib/org/drift-report.ts — Nền Hệ thống P1 · US-07 AC3: đối soát centerId ↔ orgUnitId.
//
// Dùng chung cho script chạy tay (`scripts/nen-p1-doi-soat-orgunit.ts`) và cron đêm
// (`app/api/cron/orgunit-drift`). Một hiện thực — hai vỏ.
//
// ⚠️ MỌI SỐ ĐỀU ĐI KÈM MẪU SỐ. Prod đã bị dọn sạch dữ liệu vận hành 01/08/2026, nên tiêu
// chí kiểu "0 lệch là đạt" rất dễ là XANH GIẢ vì mẫu số bằng 0 — 7 đêm sạch trên một bảng
// rỗng không chứng minh được gì về backfill. Vì vậy mỗi dòng báo cáo mang cả `totalRows`.

import { db } from "@/lib/db";
import { BACKFILL_SPECS, PR_A_MODELS, type BackfillSpec, type CenterNullMeaning } from "./center-bridge";

export type DriftRow = {
  model: string;
  nullMeaning: CenterNullMeaning;
  scoped: boolean;
  totalRows: number;
  withCenter: number;
  withOrgUnit: number;
  /** Có centerId nhưng THIẾU orgUnitId — nợ backfill/ghi kép. */
  missingOrgUnit: number;
  /** Có cả hai nhưng orgUnitId KHÔNG trỏ về đúng OrgUnit của centerId đó — sai ánh xạ. */
  mismatched: number;
};

/**
 * 28 bảng của PR-A cũng phải đối soát: backfill 15/06 chạy đúng MỘT LẦN, còn đường ghi
 * thì tiếp tục đẻ dòng thiếu `orgUnitId` từ đó tới nay. Nhưng chúng CHƯA được rà nghiệp vụ
 * nên mang nhãn `CHUA_RA_SOAT` — đếm và hiện, không tính là lệch (xem center-bridge.ts).
 */
const PR_A_SPECS: BackfillSpec[] = PR_A_MODELS.map((model) => ({
  model,
  nullMeaning: "CHUA_RA_SOAT" as const,
  scoped: false,
  vi: "PR-A 15/06 — đã có cột, chưa rà nghĩa của NULL",
}));

export const ALL_DRIFT_SPECS: readonly BackfillSpec[] = [...BACKFILL_SPECS, ...PR_A_SPECS];

/**
 * Bảng nào trong DB có ĐỦ hai cột `centerId` + `orgUnitId` — hỏi thẳng `information_schema`
 * thay vì tin danh sách chép tay.
 *
 * Vì sao: bản danh sách chép tay ĐẦU TIÊN của US-07 sai 11 tên model (đưa vào những bảng
 * không hề có `centerId`), và script đối soát ném lỗi SQL thô thay vì báo lệch. Nếu lỗi đó
 * chạy lần đầu lúc 3h sáng trên prod thì nó chỉ hiện ra dưới dạng "cron đỏ", không ai biết
 * vì sao. Dùng để đối chiếu với ALL_DRIFT_SPECS — chênh nhau là có bảng chưa ai phân loại.
 */
export async function discoverDualColumnTables(): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ table_name: string }>>`
    SELECT c1.table_name
    FROM information_schema.columns c1
    WHERE c1.table_schema = 'public' AND c1.column_name = 'orgUnitId'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns c2
        WHERE c2.table_schema = 'public' AND c2.table_name = c1.table_name
          AND c2.column_name = 'centerId'
      )
    ORDER BY 1
  `;
  return rows.map((r) => r.table_name);
}

/** Bảng có đủ 2 cột nhưng KHÔNG có trong bảng phân loại — nợ phải đóng, không được im lặng. */
export async function findUnclassifiedTables(): Promise<string[]> {
  const known = new Set(ALL_DRIFT_SPECS.map((s) => s.model));
  return (await discoverDualColumnTables()).filter((t) => !known.has(t));
}

/**
 * Đếm cho MỘT bảng. Dùng SQL thô có chủ đích: cần đếm theo nhiều điều kiện trên cùng một
 * lần quét, và cần chạy được trên bảng mà Prisma Client chưa chắc có model (bảng thêm ở
 * migration khác nhánh).
 *
 * Định nghĩa "khớp" bám đúng cầu ánh xạ hai nhánh của `center-bridge.ts` — kể cả nhánh
 * `OrgUnit.code = Center.code` cho Center mồ côi. Thiếu nhánh đó thì toàn bộ dữ liệu Hội
 * sở bị báo "sai ánh xạ" dù đúng.
 */
async function countOne(spec: BackfillSpec): Promise<DriftRow> {
  const t = `"${spec.model}"`;
  const rows = await db.$queryRawUnsafe<Array<Record<string, bigint>>>(`
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (WHERE t."centerId" IS NOT NULL)::bigint AS with_center,
      count(*) FILTER (WHERE t."orgUnitId" IS NOT NULL)::bigint AS with_org,
      count(*) FILTER (WHERE t."centerId" IS NOT NULL AND t."orgUnitId" IS NULL)::bigint AS missing,
      count(*) FILTER (
        WHERE t."centerId" IS NOT NULL
          AND t."orgUnitId" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "Center" c
            JOIN "OrgUnit" ou
              ON ou."deletedAt" IS NULL
             AND (ou."centerId" = c."id"
                  OR (ou."centerId" IS NULL AND c."code" IS NOT NULL AND ou."code" = c."code"))
            WHERE c."id" = t."centerId" AND ou."id" = t."orgUnitId"
          )
      )::bigint AS mismatched
    FROM ${t} t
  `);
  const r = rows[0] ?? {};
  return {
    model: spec.model,
    nullMeaning: spec.nullMeaning,
    scoped: spec.scoped,
    totalRows: Number(r.total ?? 0),
    withCenter: Number(r.with_center ?? 0),
    withOrgUnit: Number(r.with_org ?? 0),
    missingOrgUnit: Number(r.missing ?? 0),
    mismatched: Number(r.mismatched ?? 0),
  };
}

/** Dòng này có phải LỆCH THẬT không (khác với "null có nghĩa" và "chưa ai rà"). */
export function isDrift(row: DriftRow): boolean {
  // Sai ánh xạ LUÔN là lỗi, không phụ thuộc nhóm: orgUnitId trỏ về một đơn vị khác với
  // centerId trên cùng dòng là mâu thuẫn nội tại, không có cách đọc nào cho nó là đúng.
  if (row.mismatched > 0) return true;
  // Bảng chưa ai rà nghĩa của NULL: chỉ đếm và hiện, KHÔNG báo động. Kêu sói mỗi đêm trên
  // 28 bảng chưa duyệt là cách nhanh nhất khiến cả đội thôi đọc alert.
  if (row.nullMeaning === "CHUA_RA_SOAT") return false;
  // Ba nhóm đã rà: có centerId mà thiếu orgUnitId là lỗi thật (null nằm ở cột centerId,
  // không phải ở dòng đã có centerId).
  return row.missingOrgUnit > 0;
}

export type DriftReport = {
  rows: DriftRow[];
  drift: DriftRow[];
  tablesChecked: number;
  totalRows: number;
  durationMs: number;
};

export async function runDriftReport(): Promise<DriftReport> {
  const t0 = Date.now();
  const rows: DriftRow[] = [];
  for (const spec of ALL_DRIFT_SPECS) {
    rows.push(await countOne(spec));
  }
  return {
    rows,
    drift: rows.filter(isDrift),
    tablesChecked: rows.length,
    totalRows: rows.reduce((s, r) => s + r.totalRows, 0),
    durationMs: Date.now() - t0,
  };
}

/** Ghi một lượt chạy vào nhật ký. Chỉ lưu DÒNG LỆCH; số tổng nằm ở bản ghi run. */
export async function saveDriftRun(rep: DriftReport, note?: string): Promise<string> {
  const run = await db.orgUnitDriftRun.create({
    data: {
      tablesChecked: rep.tablesChecked,
      driftCount: rep.drift.length,
      totalRows: BigInt(rep.totalRows),
      durationMs: rep.durationMs,
      note: note ?? null,
    },
    select: { id: true },
  });
  if (rep.drift.length > 0) {
    await db.orgUnitDriftItem.createMany({
      data: rep.drift.map((r) => ({
        runId: run.id,
        model: r.model,
        nullMeaning: r.nullMeaning,
        totalRows: BigInt(r.totalRows),
        withCenter: BigInt(r.withCenter),
        withOrgUnit: BigInt(r.withOrgUnit),
        missingOrgUnit: BigInt(r.missingOrgUnit),
        mismatched: BigInt(r.mismatched),
      })),
    });
  }
  return run.id;
}

/** AC3 — "log giữ 30 ngày". Dọn ngay trong cùng lượt chạy, không cần job riêng. */
export async function pruneDriftLog(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const res = await db.orgUnitDriftRun.deleteMany({ where: { ranAt: { lt: cutoff } } });
  return res.count;
}

/** Bảng Markdown cho $GITHUB_STEP_SUMMARY / log cron (theo mẫu scripts/shadow-report.ts). */
export function formatDriftMarkdown(rep: DriftReport): string {
  const head = [
    `**Đối soát centerId ↔ orgUnitId** — ${rep.tablesChecked} bảng · ${rep.totalRows.toLocaleString("vi-VN")} dòng · ${rep.durationMs}ms`,
    "",
  ];
  if (rep.drift.length === 0) {
    head.push(
      rep.totalRows === 0
        ? "⚠️ 0 lệch, NHƯNG mẫu số bằng 0 — không kết luận được gì. Cần dữ liệu thật rồi đo lại."
        : "✅ Không có bảng nào lệch.",
    );
    return head.join("\n");
  }
  head.push(
    `❌ ${rep.drift.length} bảng lệch:`,
    "",
    "| Bảng | Nhóm | Tổng dòng | Có centerId | Thiếu orgUnitId | Sai ánh xạ | scopedDb |",
    "|---|---|---:|---:|---:|---:|:--:|",
  );
  for (const r of rep.drift) {
    head.push(
      `| ${r.model} | ${r.nullMeaning} | ${r.totalRows} | ${r.withCenter} | ${r.missingOrgUnit} | ${r.mismatched} | ${r.scoped ? "CÓ" : "—"} |`,
    );
  }
  head.push(
    "",
    "> Cột `scopedDb = CÓ` là nhóm nguy hiểm nhất: khi P4 lật scope sang `orgUnitId`, mọi dòng `orgUnitId` NULL sẽ **biến mất** với người dùng cấp cơ sở.",
  );
  return head.join("\n");
}

