// lib/parttime/san-sang.ts — `checkParttimeReadiness()`: môi trường này đã đủ điều kiện để bật Công Parttime chưa. CHỈ ĐỌC.
//
// Dùng bởi công cụ cutover (`scripts/parttime-cutover.ts`) và người vận hành trước mỗi đợt thí điểm. Không bật / tắt gì.
// Luật chặn GHI: RBAC v2 tắt ⇒ BLOCKED (v1 không xét cơ sở — `[SCOPE-V1]`); thiếu bảng / thiếu migration ⇒ BLOCKED.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { vnYmd } from "@/lib/time/vn";
import { chinhSachTaiNgay } from "./chinh-sach";
import { docPhamViCongTac, rbacV2ChoParttime } from "./cong-tac-doc";
import { LOAI_CONG_TAC, type LoaiCongTac } from "./cong-tac-thuan";
import { docChinhSach } from "./phan-cong-db";

/** Migration của Công Parttime theo THỨ TỰ phát hành (manifest: docs/cham-cong/parttime/17-RELEASE-MANIFEST.md). */
export const MIGRATION_PARTTIME = [
  "20261026090000_cong_parttime_nen",
  "20261026100000_cong_parttime_yeu_cau_tro_giang",
  "20261027090000_cong_parttime_workunit",
  "20261027100000_cong_parttime_truc_van_hanh",
  "20261027110000_cong_parttime_dieu_chinh",
  "20261028090000_cong_parttime_cutover",
] as const;

export const BANG_PARTTIME = [
  "CompensationPolicyVersion",
  "TeacherRankHistory",
  "SessionStaffAssignment",
  "StaffAssignmentAcceptance",
  "ClassStaffingRequirement",
  "WorkUnit",
  "WorkConfirmation",
  "OperationsDutyAssignment",
  "OperationsDutyAcceptance",
  "CompensationAdjustment",
  "TeachingUnitPolicyOverride",
] as const;

export type SanSangParttime = {
  rbacV2: boolean;
  schemaReady: boolean;
  bangThieu: string[];
  migrationState: { daChay: string[]; thieu: string[] };
  congTac: Record<LoaiCongTac, { macDinh: boolean; ghiDe: { orgUnitId: string; centerId: string | null; bat: boolean }[] }>;
  policyVersion: { code: string; loai: string } | null;
  ghi: "READY" | "BLOCKED";
  lyDoChan: string[];
};

export async function checkParttimeReadiness(p: { now: Date }): Promise<SanSangParttime> {
  const rbacV2 = rbacV2ChoParttime();
  const bang = await db.$queryRaw<{ ten: string; co: boolean }[]>(
    Prisma.sql`SELECT t.ten, to_regclass(format('public.%I', t.ten)) IS NOT NULL AS co FROM unnest(${[...BANG_PARTTIME]}::text[]) AS t(ten)`,
  );
  const bangThieu = bang.filter((b) => !b.co).map((b) => b.ten);
  const schemaReady = bangThieu.length === 0;
  const mig = await db.$queryRaw<{ migration_name: string }[]>(
    Prisma.sql`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL AND migration_name = ANY(${[...MIGRATION_PARTTIME]}::text[])`,
  );
  const daChay = MIGRATION_PARTTIME.filter((m) => mig.some((r) => r.migration_name === m));
  const thieu = MIGRATION_PARTTIME.filter((m) => !daChay.includes(m));

  const congTac = {} as SanSangParttime["congTac"];
  const phamVi = await Promise.all(LOAI_CONG_TAC.map((loai) => docPhamViCongTac(loai)));
  const idDonVi = [...new Set(phamVi.flatMap((pv) => [...pv.theoDonVi.keys()]))];
  const ou = idDonVi.length ? await db.orgUnit.findMany({ where: { id: { in: idDonVi } }, select: { id: true, centerId: true } }) : [];
  const coSoCua = new Map(ou.map((o) => [o.id, o.centerId]));
  LOAI_CONG_TAC.forEach((loai, i) => {
    congTac[loai] = {
      macDinh: phamVi[i]!.macDinh,
      ghiDe: [...phamVi[i]!.theoDonVi].map(([orgUnitId, bat]) => ({ orgUnitId, centerId: coSoCua.get(orgUnitId) ?? null, bat })),
    };
  });

  let policyVersion: SanSangParttime["policyVersion"] = null;
  if (schemaReady) {
    const cs = chinhSachTaiNgay(await docChinhSach(), vnYmd(p.now));
    policyVersion = cs ? { code: cs.code, loai: cs.thamSo.loai } : null;
  }

  const lyDoChan = [
    ...(rbacV2 ? [] : ["RBAC_V2_REQUIRED_FOR_PARTTIME — RBAC_V2_ENABLED khác 'true'"]),
    ...(schemaReady ? [] : [`Thiếu bảng: ${bangThieu.join(", ")}`]),
    ...(thieu.length ? [`Thiếu migration: ${thieu.join(", ")}`] : []),
  ];
  return { rbacV2, schemaReady, bangThieu, migrationState: { daChay, thieu }, congTac, policyVersion, ghi: lyDoChan.length ? "BLOCKED" : "READY", lyDoChan };
}
