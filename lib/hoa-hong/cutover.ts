// lib/hoa-hong/cutover.ts — MỐC CUTOVER (`hoaHong.kyCutover`): đọc, trạng thái kỳ CŨ + manifest, và ĐƯỜNG GHI DUY NHẤT (`datMocCutover`).
//
// Nguồn: docs/source-commission/05 "Quy tắc cutover chính thức" (CUT-1..CUT-8), §2.2c; 04 §3.
//
// Khoá `hoaHong.kyCutover` có trong registry nhưng mang `ghiQuaActionRieng: true`: `setGlobalSetting`/`setCenterSetting`/`clearCenterSetting`
// TỪ CHỐI nó, màn Cấu hình vận hành chỉ HIỆN giá trị. Đường ghi duy nhất là `datMocCutover` ở đây — một `$transaction` đọc DB TRỰC TIẾP (không
// qua `getSetting`, cache 300 giây), chạy mọi cổng, `throw` trước phép ghi đầu tiên (luật 12). Lưới `[NHH-W9]`: phép ghi `SystemSetting` cho khoá
// này chỉ có ở tệp này.
//
// Vì sao đọc THẲNG `SystemSetting`: một cổng tiền không được đọc mốc cũ 5 phút (05 §2.2c bước 4).
import { Prisma, type PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/actor";
import { khoangKy, kyCuaButToan } from "@/lib/crm/commission-thuc-thu";
import { clearSettingsCache } from "@/lib/settings/service";

import { thangThuocSoMoi, type KyCu } from "./chu-so-huu";
import { HoaHongError, batLyDoToiThieu } from "./kieu";

type Khach = PrismaClient | Prisma.TransactionClient;

export const KHOA_KY_CUTOVER = "hoaHong.kyCutover";
const DANG_THANG = /^\d{4}-(0[1-9]|1[0-2])$/;
/**
 * Khoá advisory của mốc cutover. `datMocCutover` giữ khoá ĐỘC QUYỀN; mọi lượt ghi sổ (`chayTrongKhoa`) giữ khoá CHIA SẺ rồi mới đọc mốc ⇒ một
 * lượt ghi đang dở và một lượt dời/gỡ mốc không thể cùng thấy "chưa có dòng nào". Thiếu cặp khoá này thì cổng "dời muộn / gỡ khi đã có dòng sổ"
 * là cổng đọc-rồi-ghi: hai transaction cùng qua cổng rồi cùng commit (đọc ở READ COMMITTED không thấy dòng chưa commit).
 */
export const KHOA_ADVISORY_MOC = "hoa-hong:moc-cutover";

export async function khoaChungMocCutover(tx: Prisma.TransactionClient): Promise<void> {
  // `$executeRaw`: `pg_advisory_xact_lock*()` trả `void`, Prisma không đọc được kiểu đó (cùng lý do `ghi-so.ts`).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${KHOA_ADVISORY_MOC})::bigint)`;
}

/**
 * Mốc cutover hiện tại; `null` = CHƯA đặt (05 §2.2: "`null` ⇒ engine không ghi kỳ nào").
 * Giá trị sai hình dạng ⇒ NÉM, không rơi về `null`: một mốc hỏng mà coi như "chưa đặt" thì cổng đường cũ mở toang.
 */
export async function docMocCutover(client: Khach): Promise<string | null> {
  const row = await client.systemSetting.findUnique({ where: { key: KHOA_KY_CUTOVER }, select: { valueJson: true } });
  if (!row || row.valueJson === null) return null;
  const v = row.valueJson;
  if (typeof v !== "string" || !DANG_THANG.test(v)) {
    throw new HoaHongError("MOC_CUTOVER_HONG", `Mốc cutover "${JSON.stringify(v)}" sai dạng "YYYY-MM" — dừng engine, không đoán.`);
  }
  return v;
}

/** Tháng k đã có ít nhất một dòng sổ MỚI? (vế hai của `thangThuocSoMoi` — giữ đúng kể cả khi mốc bị SQL tay.) */
export async function coDongSoMoiTrongThang(client: Khach, thang: string): Promise<boolean> {
  const dong = await client.commissionTransaction.findFirst({ where: { period: { period: thang } }, select: { id: true } });
  return dong !== null;
}

/**
 * "Tháng này thuộc sổ MỚI không" — MỘT câu hỏi cho năm cổng đường cũ, `datMocCutover` và engine (04 §3.2). Đọc mốc THẲNG từ DB trong chính `client`
 * (trong transaction thì thấy mốc của transaction). Thân quyết định là hàm thuần `thangThuocSoMoi` (chu-so-huu.ts).
 */
export async function docThangThuocSoMoi(client: Khach, k: string): Promise<boolean> {
  const kyCutover = await docMocCutover(client);
  // `k ≥ mốc` đã đủ để trả lời "có" — khỏi hỏi vế hai (đường nóng: mọi lượt convert sau cutover).
  if (kyCutover !== null && k >= kyCutover) return true;
  const coDongSoMoi = await coDongSoMoiTrongThang(client, k);
  return thangThuocSoMoi(k, { kyCutover, coDongSoMoi });
}

// ── Kỳ CŨ + MANIFEST ─────────────────────────────────────────────────────────────────────────

/**
 * MANIFEST của một bảng kê đã duyệt (04 §3.1): danh sách `paymentId` mà lần chốt CUỐI TRƯỚC `approvedAt` đã nạp, đọc từ audit chốt
 * (`setStatementLines` ghi `newValues.paymentIds` từ PR0m). `null` = KHÔNG BIẾT (kỳ duyệt trước PR0m, hoặc audit không có danh sách) — fail-closed.
 */
async function docManifestCuaBangKe(client: Khach, stmt: { id: string; approvedAt: Date | null }): Promise<ReadonlySet<string> | null> {
  const audit = await client.auditLog.findMany({
    where: {
      entityType: "CommissionStatement",
      entityId: stmt.id,
      action: "UPDATE",
      ...(stmt.approvedAt ? { createdAt: { lte: stmt.approvedAt } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { newValues: true },
    take: 50,
  });
  for (const a of audit) {
    const nv = a.newValues;
    if (nv && typeof nv === "object" && !Array.isArray(nv)) {
      const ids = (nv as Record<string, unknown>).paymentIds;
      if (Array.isArray(ids) && ids.every((x) => typeof x === "string")) return new Set(ids as string[]);
    }
  }
  return null;
}

/**
 * Trạng thái kỳ CŨ (`CommissionStatement`) cho các tháng cần hỏi. Trả hàm tra đồng bộ cho `chuSoHuuButToan`.
 * `manifest` chỉ được nạp cho bảng kê APPROVED (chỉ ca đó cần); thiếu ⇒ `null` ⇒ khoản của kỳ cũ ĐÃ DUYỆT vào MANUAL_REVIEW_REQUIRED
 * (fail-closed, 04 §3.1) — không bao giờ ghi nhầm hay bỏ sót im lặng.
 */
export async function docKyCu(client: Khach, thang: readonly string[]): Promise<(ky: string) => KyCu> {
  const duy = [...new Set(thang)];
  const rows = duy.length
    ? await client.commissionStatement.findMany({ where: { period: { in: duy } }, select: { id: true, period: true, status: true, approvedAt: true } })
    : [];
  const map = new Map<string, KyCu>();
  for (const r of rows) {
    map.set(r.period, { trangThai: r.status, manifest: r.status === "APPROVED" ? await docManifestCuaBangKe(client, r) : null });
  }
  return (ky) => map.get(ky) ?? null;
}

// ── ĐẶT / DỜI / GỠ MỐC ───────────────────────────────────────────────────────────────────────

export type HanhDongDatMoc = "DAT_LAN_DAU" | "DOI_SOM" | "DOI_MUON" | "GO";

export type DauVaoDatMoc = {
  cu: string | null;
  moi: string | null;
  /** Tháng hiện tại giờ VN — từ `now` TRUYỀN VÀO (luật 19). */
  thangHienTai: string;
  /** Có `CommissionStatement` (MỌI trạng thái) cho tháng ≥ `moi`. */
  coBangKeTuMoi: boolean;
  /** Tháng của `CommissionStatement` APPROVED có tháng < `moi` mà KHÔNG có manifest. */
  kyApprovedThieuManifest: readonly string[];
  /** Số dòng sổ MỚI nằm trong vùng bị đổi quyền sở hữu: [cu, moi) khi dời muộn · [cu, ∞) khi gỡ. */
  soDongSoMoiBiAnhHuong: number;
};

export type QuyetDinhDatMoc = { ok: true; hanhDong: HanhDongDatMoc } | { ok: false; ma: string; lyDo: string };

const tu = (ma: string, lyDo: string): QuyetDinhDatMoc => ({ ok: false, ma, lyDo });

/**
 * Cổng của `datMocCutover` (05 §2.2c bước 3). THUẦN. Không có mặc định nguy hiểm: mọi trường BẮT BUỘC (luật 7).
 *
 *   đặt lần đầu (null → P) · dời SỚM (P → P' < P) : P > tháng hiện tại · không có bảng kê cũ nào cho tháng ≥ P · mọi bảng kê APPROVED < P đều có manifest
 *   dời MUỘN (P → P' > P)                         : không có dòng sổ mới nào ở [P, P')
 *   gỡ (P → null)                                 : không có dòng sổ mới nào ở kỳ ≥ P
 */
export function quyetDinhDatMoc(i: DauVaoDatMoc): QuyetDinhDatMoc {
  if (i.moi !== null && !DANG_THANG.test(i.moi)) return tu("MOC_SAI_DANG", `Mốc "${i.moi}" sai dạng "YYYY-MM".`);
  if (i.moi === i.cu) return tu("MOC_KHONG_DOI", i.cu === null ? "Mốc đang chưa đặt." : `Mốc đã là ${i.cu}.`);

  if (i.moi === null) {
    // gỡ
    if (i.soDongSoMoiBiAnhHuong > 0) {
      return tu("CO_DONG_SO_MOI", `Đã có ${i.soDongSoMoiBiAnhHuong} dòng sổ hoa hồng mới từ kỳ ${i.cu} — không gỡ mốc (sửa bằng dòng điều chỉnh; tắt engine nếu cần dừng).`);
    }
    return { ok: true, hanhDong: "GO" };
  }

  if (i.cu !== null && i.moi > i.cu) {
    // dời muộn
    if (i.soDongSoMoiBiAnhHuong > 0) {
      return tu("CO_DONG_SO_MOI", `Đã có ${i.soDongSoMoiBiAnhHuong} dòng sổ hoa hồng mới ở các kỳ từ ${i.cu} đến trước ${i.moi} — không dời mốc muộn hơn (sẽ trả hai lần).`);
    }
    return { ok: true, hanhDong: "DOI_MUON" };
  }

  // đặt lần đầu hoặc dời sớm
  if (i.moi <= i.thangHienTai) return tu("MOC_KHONG_O_TUONG_LAI", `Mốc ${i.moi} phải SAU tháng hiện tại (${i.thangHienTai}).`);
  if (i.coBangKeTuMoi) return tu("CO_BANG_KE_CU", `Đã có bảng kê hoa hồng cũ cho tháng từ ${i.moi} — đường cũ phải ngừng trước khi đặt mốc.`);
  if (i.kyApprovedThieuManifest.length > 0) {
    return tu("THIEU_MANIFEST", `Bảng kê đã duyệt chưa có manifest: ${i.kyApprovedThieuManifest.join(", ")} — không xác định được khoản nào đã nằm trong bảng kê (04 §3.1).`);
  }
  return { ok: true, hanhDong: i.cu === null ? "DAT_LAN_DAU" : "DOI_SOM" };
}

export type NguoiDatMoc = { actor: Actor; ten: string };

export type KetQuaDatMoc = { cu: string | null; moi: string | null; hanhDong: HanhDongDatMoc; canhBao: string[] };

/**
 * ĐƯỜNG GHI DUY NHẤT của `hoaHong.kyCutover` (05 §2.2c). Chỉ SUPER_ADMIN; lý do ≥ 10 ký tự; audit cùng transaction; `clearSettingsCache()` sau commit.
 * Không kiểm quyền chức năng ở đây — chỗ gọi (action) gác ở đầu hàm; service chỉ gác điều kiện nghiệp vụ.
 */
export async function datMocCutover(client: PrismaClient, nguoi: NguoiDatMoc, i: { mocMoi: string | null; lyDo: string; now: Date }): Promise<KetQuaDatMoc> {
  if (!nguoi.actor.isSuperAdmin) throw new HoaHongError("KHONG_CO_QUYEN", "Chỉ quản trị tối cao được đặt mốc chuyển sang hoa hồng mới.");
  const lyDo = batLyDoToiThieu(i.lyDo, "Đặt mốc cutover");

  const ra = await client.$transaction(
    async (tx): Promise<KetQuaDatMoc> => {
      // Độc quyền: chờ mọi lượt ghi sổ đang dở (chúng giữ khoá chia sẻ), và chặn lượt mới cho tới khi xong.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${KHOA_ADVISORY_MOC})::bigint)`;

      const cu = await docMocCutover(tx);
      const dauVao = await docDauVaoDatMoc(tx, cu, i.mocMoi, i.now);
      const qd = quyetDinhDatMoc(dauVao);
      if (!qd.ok) throw new HoaHongError(qd.ma, qd.lyDo);

      const canhBao = i.mocMoi !== null && qd.hanhDong !== "DOI_MUON" ? await canhBaoChinhSach(tx, i.mocMoi) : [];

      if (i.mocMoi === null) {
        await tx.systemSetting.deleteMany({ where: { key: KHOA_KY_CUTOVER } });
      } else {
        await tx.systemSetting.upsert({
          where: { key: KHOA_KY_CUTOVER },
          create: { key: KHOA_KY_CUTOVER, valueJson: i.mocMoi, updatedById: nguoi.actor.userId, updatedByName: nguoi.ten },
          update: { valueJson: i.mocMoi, updatedById: nguoi.actor.userId, updatedByName: nguoi.ten },
        });
      }
      await writeAudit({
        actor: { id: nguoi.actor.userId, name: nguoi.ten },
        module: "hoa-hong",
        entityType: "SystemSetting",
        entityId: KHOA_KY_CUTOVER,
        action: cu === null ? "CREATE" : i.mocMoi === null ? "DELETE" : "UPDATE",
        oldValues: { value: cu },
        newValues: { value: i.mocMoi, hanhDong: qd.hanhDong, canhBao },
        reason: lyDo,
        tx,
      });
      return { cu, moi: i.mocMoi, hanhDong: qd.hanhDong, canhBao };
    },
    { maxWait: 20_000, timeout: 60_000 },
  );
  clearSettingsCache();
  return ra;
}

async function docDauVaoDatMoc(tx: Prisma.TransactionClient, cu: string | null, moi: string | null, now: Date): Promise<DauVaoDatMoc> {
  const thangHienTai = kyCuaButToan(now);
  const coBangKeTuMoi = moi !== null ? (await tx.commissionStatement.count({ where: { period: { gte: moi } } })) > 0 : false;
  const kyApprovedThieuManifest: string[] = [];
  if (moi !== null) {
    const approved = await tx.commissionStatement.findMany({ where: { status: "APPROVED", period: { lt: moi } }, select: { id: true, period: true, approvedAt: true }, orderBy: { period: "asc" } });
    for (const s of approved) if ((await docManifestCuaBangKe(tx, s)) === null) kyApprovedThieuManifest.push(s.period);
  }

  let soDongSoMoiBiAnhHuong = 0;
  if (cu !== null && (moi === null || moi > cu)) {
    soDongSoMoiBiAnhHuong = await tx.commissionTransaction.count({
      where: { period: { period: moi === null ? { gte: cu } : { gte: cu, lt: moi } } },
    });
  }
  return { cu, moi, thangHienTai, coBangKeTuMoi, kyApprovedThieuManifest, soDongSoMoiBiAnhHuong };
}

/** Cảnh báo (KHÔNG chặn — 05 §7.5 bước 1): vai đang hoạt động mà chưa có chính sách ACTIVE hiệu lực tại đầu kỳ P. */
async function canhBaoChinhSach(tx: Prisma.TransactionClient, moi: string): Promise<string[]> {
  const dau = khoangKy(moi).start;
  const [vai, coRule] = await Promise.all([
    tx.beneficiaryRole.findMany({ where: { isActive: true }, select: { id: true, code: true }, orderBy: { sortOrder: "asc" } }),
    tx.commissionRule.findMany({
      where: { version: { status: "ACTIVE", effectiveFrom: { lte: dau }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: dau } }] } },
      select: { beneficiaryRoleId: true },
      distinct: ["beneficiaryRoleId"],
    }),
  ]);
  const co = new Set(coRule.map((r) => r.beneficiaryRoleId));
  const thieu = vai.filter((v) => !co.has(v.id)).map((v) => v.code);
  return thieu.length > 0 ? [`Chưa có chính sách ACTIVE hiệu lực tại ${moi} cho vai: ${thieu.join(", ")}`] : [];
}
