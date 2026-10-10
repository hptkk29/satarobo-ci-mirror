/**
 * lib/nguon/di-tru-db.ts — TẦNG ĐỌC của di trú 28 nhãn → 8 nguồn mặc định + UNKNOWN (PR1: CHỈ ĐỌC). Đặc tả `07 §2.6.6`.
 *
 * ⚠️ TỆP NÀY KHÔNG ĐƯỢC CÓ LỆNH GHI NÀO — nó nằm trong đồ thị import của `scripts/nguon/di-tru-nguon-cu.ts`
 * (chạy bằng user chỉ-đọc trên PROD). Mọi câu truy vấn của kịch bản nằm Ở ĐÂY chứ không ở kịch bản
 * (PB-13); lưới `[QN-DT-01]` quét cả hai tệp và mọi tệp `lib/nguon/*` mà kịch bản import. PR3 thêm chế độ
 * ghi thì viết tầng GHI riêng (dùng `ghi-nguon.ts`), đừng nhét lệnh ghi vào đây.
 *
 * Chín câu, CỐ ĐỊNH theo lượt (không N+1 — bài học `goiYDon`/P2028, trần transaction tương tác 5 giây).
 * Phạm vi là tham số BẮT BUỘC (luật 7): kịch bản truyền "TAT_CA", ca test truyền đúng id fixture.
 */
import type { Prisma } from "@prisma/client";
import { phoneKey } from "@/lib/phone";
import {
  anhXaNhanCu,
  chuanHoaNhanNguon,
  laNhanTheoNguoiNhap,
  MOC_NGUOI_NHAP,
  type HangDiTru,
} from "./anh-xa-nhan-cu";
import { DANH_MUC_GOC, NHOM_NHAN_SU_GOC, VAI_SANG_NGUON_MAC_DINH, nhomGocHoacNem, type MaNhomGoc, type MaVaiNguon } from "./danh-muc-goc";
import { bocMaNhanVienTuNote, chuanHoaMaNhanVien, giaiMaNhanVienTheoNgay, type DoiMa } from "./ma-nhan-vien";

type Tx = Prisma.TransactionClient;

/** [PB-19] Phạm vi BẮT BUỘC (luật 7): kịch bản truyền "TAT_CA"; ca test truyền đúng leadId fixture. */
export type PhamViDiTru = "TAT_CA" | { leadIds: readonly string[] };

const loc = (p: PhamViDiTru): { id?: { in: string[] } } => (p === "TAT_CA" ? {} : { id: { in: [...p.leadIds] } });

type DongVai = { status: string; effectiveFrom: Date; effectiveTo: Date | null; role: { code: string } };

/**
 * Vai của người nhập TẠI `tai` (PB-12). Vai tại ngày = mọi dòng có `effectiveFrom ≤ tai < (effectiveTo ?? ∞)`
 * (kể cả dòng nay đã EXPIRED — lúc đó nó đang hiệu lực). Rỗng ⇒ vai HÔM NAY (dòng `status = ACTIVE`, bất
 * kể mốc) và `vaiTuHienTai = true` — vì `UserOrgRole` có khoá chính (userId, orgUnitId, roleId) ⇒ MỘT dòng
 * mỗi vai, `effectiveFrom @default(now())`: vai cấp lại SAU ngày tạo phiếu rơi khỏi phép "tại ngày".
 * Cả hai rỗng ⇒ `roleCodes = []` (⇒ nhóm 8) và `vaiTuHienTai = true`.
 * (Vai thu hồi bằng XOÁ dòng vẫn mất khỏi phép tính — giới hạn biết trước, báo cáo ghi lại.)
 */
function vaiTaiNgay(rows: readonly DongVai[], tai: Date): { roleCodes: string[]; vaiTuHienTai: boolean } {
  const t = tai.getTime();
  const taiNgay = rows.filter((r) => r.effectiveFrom.getTime() <= t && (r.effectiveTo === null || t < r.effectiveTo.getTime()));
  if (taiNgay.length > 0) return { roleCodes: [...new Set(taiNgay.map((r) => r.role.code))], vaiTuHienTai: false };
  const hienTai = rows.filter((r) => r.status === "ACTIVE");
  return { roleCodes: [...new Set(hienTai.map((r) => r.role.code))], vaiTuHienTai: true };
}

export type KetQuaDocDiTru = {
  hang: HangDiTru[];
  /** Chỉ trong phạm vi. */
  trungSdt: Set<string>;
  /** Các nhóm lead trùng SĐT (mỗi nhóm ≥ 2 leadId, đã sắp) — để gộp bằng `gop-lead-prod.yml`; KHÔNG mang SĐT. */
  nhomTrungSdt: string[][];
  /** Lead `deletedAt ≠ null` TRONG PHẠM VI — đếm riêng, không ghi. */
  daXoa: number;
  /** Lead (còn sống, trong phạm vi) ĐÃ có quy nguồn — bỏ qua, không vào `hang`; 0 khi bảng chưa có. */
  daCoQuyNguon: number;
  /** Chỉ nhãn THEO_NGUOI_NHAP ≥ mốc có mã trong note. */
  maNv: {
    ma: string;
    soPhieu: number;
    employeeId: string | null;
    vaiTuHienTai: number;
    nhom: MaNhomGoc | null;
    /** Vai ngữ nghĩa của người nhập TẠI ngày phiếu (snapshot sẽ ghi `referrerRoleCode`). null khi chưa giải được. */
    vai: MaVaiNguon | null;
  }[];
  /** Dòng AuditLog đổi mã có entityId không phải Employee.id (đường import ghi `String(id ?? employeeCode)`). */
  lichSuKhongDung: number;
  /** Mã trong DANH_MUC_GOC chưa có dòng LeadSourceGroup (khi coBangQuyNguon). */
  thieuDanhMuc: MaNhomGoc[];
};

export async function docDuLieuDiTru(
  tx: Tx,
  opts: { coBangQuyNguon: boolean; phamVi: PhamViDiTru },
): Promise<KetQuaDocDiTru> {
  const { coBangQuyNguon, phamVi } = opts;

  // 1. Mọi lead còn sống trong phạm vi. `attribution` chỉ được CHỌN khi bảng đã có (chưa có ⇒ join sai).
  const leads = await tx.lead.findMany({
    where: { deletedAt: null, ...loc(phamVi) },
    select: {
      id: true,
      source: true,
      createdAt: true,
      createdById: true,
      note: true,
      affiliateId: true,
      phone: true,
      attribution: coBangQuyNguon ? { select: { id: true } } : false,
    },
    orderBy: { id: "asc" },
  });
  // 2. Đã xoá mềm — đếm riêng.
  const daXoa = await tx.lead.count({ where: { deletedAt: { not: null }, ...loc(phamVi) } });

  const daCo = (l: (typeof leads)[number]): boolean => coBangQuyNguon && l.attribution != null;
  const daCoQuyNguon = leads.filter(daCo).length;
  const canDiTru = leads.filter((l) => !daCo(l));

  // Trùng SĐT: trong phạm vi, mọi lead còn sống; "" không vào nhóm nào.
  const theoSdt = new Map<string, string[]>();
  for (const l of leads) {
    if (l.phone === "") continue;
    const k = phoneKey(l.phone);
    const ds = theoSdt.get(k);
    if (ds) ds.push(l.id);
    else theoSdt.set(k, [l.id]);
  }
  const trungSdt = new Set<string>();
  const nhomTrungSdt: string[][] = [];
  for (const ds of theoSdt.values()) {
    if (ds.length < 2) continue;
    for (const id of ds) trungSdt.add(id);
    nhomTrungSdt.push([...ds].sort());
  }
  nhomTrungSdt.sort((a, b) => a[0]!.localeCompare(b[0]!));

  // 3. Affiliate có thật.
  const affIds = [...new Set(canDiTru.map((l) => l.affiliateId).filter((x): x is string => x !== null))];
  const affTon = new Set(
    affIds.length === 0 ? [] : (await tx.affiliate.findMany({ where: { id: { in: affIds } }, select: { id: true } })).map((a) => a.id),
  );

  // Dòng cần giải NGƯỜI NHẬP: nhãn "máy" (sale-form / sale-form-app) và phiếu từ 01/10/2026.
  const canNguoi = canDiTru.filter(
    (l) => laNhanTheoNguoiNhap(chuanHoaNhanNguon(l.source)) && l.createdAt.getTime() >= MOC_NGUOI_NHAP.getTime(),
  );

  // 4. createdById → User.employeeId.
  const createdByIds = [...new Set(canNguoi.map((l) => l.createdById).filter((x): x is string => x !== null))];
  const userTheoId = new Map(
    (createdByIds.length === 0
      ? []
      : await tx.user.findMany({ where: { id: { in: createdByIds } }, select: { id: true, employeeId: true } })
    ).map((u) => [u.id, u]),
  );

  // 5. Mọi nhân viên (bảng mã HÔM NAY). Bảng nhỏ, một câu.
  const nhanVien = await tx.employee.findMany({ select: { id: true, employeeCode: true } });
  const maHienTai = new Map(nhanVien.map((e) => [chuanHoaMaNhanVien(e.employeeCode), e.id] as const));
  const idNhanVien = new Set(nhanVien.map((e) => e.id));

  // 6. Lịch sử đổi mã — nguồn DUY NHẤT còn giữ ánh xạ theo thời gian (06/10 §0.6b).
  const lsRaw = await tx.$queryRaw<{ entityId: string; createdAt: Date; maCu: string | null; maMoi: string | null }[]>`
    SELECT "entityId", "createdAt",
           "oldValues"->>'employeeCode' AS "maCu", "newValues"->>'employeeCode' AS "maMoi"
    FROM "AuditLog"
    WHERE "entityType" = 'Employee' AND 'employeeCode' = ANY("changedFields")`;
  let lichSuKhongDung = 0;
  const lichSu: DoiMa[] = [];
  for (const r of lsRaw) {
    if (r.maMoi === null) continue;
    if (!idNhanVien.has(r.entityId)) {
      lichSuKhongDung += 1;
      continue;
    }
    lichSu.push({
      employeeId: r.entityId,
      maCu: r.maCu === null ? null : chuanHoaMaNhanVien(r.maCu),
      maMoi: chuanHoaMaNhanVien(r.maMoi),
      luc: r.createdAt,
    });
  }

  // Giải nhân viên cho từng dòng cần người: createdById → User.employeeId TRƯỚC, không có thì mã trong note
  // theo NGÀY tạo phiếu.
  type NguoiGiai = { employeeId: string | null; userIds: string[]; maTrongNote: string | null };
  const giai = new Map<string, NguoiGiai>();
  for (const l of canNguoi) {
    const maTho = bocMaNhanVienTuNote(l.note);
    const ma = maTho === null ? null : chuanHoaMaNhanVien(maTho);
    const u = l.createdById ? userTheoId.get(l.createdById) : undefined;
    if (u?.employeeId) {
      giai.set(l.id, { employeeId: u.employeeId, userIds: [u.id], maTrongNote: ma });
      continue;
    }
    const emp = ma === null ? null : giaiMaNhanVienTheoNgay(ma, l.createdAt, lichSu, maHienTai);
    // userIds để TRỐNG: người giải từ MÃ phải đi qua `User.employeeId` (câu 7), không mượn User của createdById.
    giai.set(l.id, { employeeId: emp, userIds: [], maTrongNote: ma });
  }

  // 7. [PB-12] Người giải từ MÃ chỉ ra `employeeId` — muốn có vai phải đi tiếp sang `User`.
  const empGiaiTuMa = [
    ...new Set([...giai.values()].filter((g) => g.userIds.length === 0 && g.employeeId !== null).map((g) => g.employeeId!)),
  ];
  const userTheoEmp = new Map<string, string[]>();
  if (empGiaiTuMa.length > 0) {
    for (const u of await tx.user.findMany({
      where: { employeeId: { in: empGiaiTuMa } },
      select: { id: true, employeeId: true },
    })) {
      if (u.employeeId === null) continue;
      const ds = userTheoEmp.get(u.employeeId);
      if (ds) ds.push(u.id);
      else userTheoEmp.set(u.employeeId, [u.id]);
    }
  }
  for (const g of giai.values()) {
    if (g.userIds.length === 0 && g.employeeId !== null) g.userIds = userTheoEmp.get(g.employeeId) ?? [];
  }

  // 8. Vai — KHÔNG lọc `status` ở câu đọc (dòng EXPIRED vẫn là vai tại ngày xưa).
  const tatCaUser = [...new Set([...giai.values()].flatMap((g) => g.userIds))];
  const vaiTheoUser = new Map<string, DongVai[]>();
  if (tatCaUser.length > 0) {
    for (const r of await tx.userOrgRole.findMany({
      where: { userId: { in: tatCaUser } },
      select: { userId: true, status: true, effectiveFrom: true, effectiveTo: true, role: { select: { code: true } } },
    })) {
      const ds = vaiTheoUser.get(r.userId);
      if (ds) ds.push(r);
      else vaiTheoUser.set(r.userId, [r]);
    }
  }

  // 9. Danh mục còn đủ 9 mã gốc không (khi bảng đã có).
  let thieuDanhMuc: MaNhomGoc[] = [];
  if (coBangQuyNguon) {
    const co = new Set((await tx.leadSourceGroup.findMany({ select: { code: true } })).map((g) => g.code));
    thieuDanhMuc = DANH_MUC_GOC.map((d) => d.code).filter((c) => !co.has(c));
  }

  // ── Ánh xạ từng lead ───────────────────────────────────────────────────────────────────────────
  const hang: HangDiTru[] = [];
  const maNv = new Map<
    string,
    { ma: string; soPhieu: number; employeeId: string | null; vaiTuHienTai: number; nhom: MaNhomGoc | null; vai: MaVaiNguon | null }
  >();
  for (const l of canDiTru) {
    const nhanChuan = chuanHoaNhanNguon(l.source);
    const g = giai.get(l.id);
    let nguoiNhap: Parameters<typeof anhXaNhanCu>[0]["nguoiNhap"] = null;
    if (g && g.employeeId !== null) {
      const dongVai = g.userIds.flatMap((uid) => vaiTheoUser.get(uid) ?? []);
      const v = vaiTaiNgay(dongVai, l.createdAt);
      nguoiNhap = { employeeId: g.employeeId, roleCodes: v.roleCodes, vaiTuHienTai: v.vaiTuHienTai };
    }
    const kq = anhXaNhanCu(
      {
        nhan: l.source,
        createdAt: l.createdAt,
        affiliate: l.affiliateId ? { ton: affTon.has(l.affiliateId), loai: null } : null,
        nguoiNhap,
        maNvTrongNote: g?.maTrongNote ?? null,
      },
      VAI_SANG_NGUON_MAC_DINH,
      NHOM_NHAN_SU_GOC, // di trú = dữ liệu lịch sử: đích cố định, KHÔNG theo setting đường sống
    );
    hang.push({ leadId: l.id, kq, nhanChuan, createdAt: l.createdAt });

    if (g?.maTrongNote) {
      const d = maNv.get(g.maTrongNote) ?? {
        ma: g.maTrongNote,
        soPhieu: 0,
        employeeId: g.employeeId,
        vaiTuHienTai: 0,
        nhom: null,
        vai: null,
      };
      d.soPhieu += 1;
      if (nguoiNhap?.vaiTuHienTai) d.vaiTuHienTai += 1;
      if (d.nhom === null && kq.loai !== "INVALID") d.nhom = nhomGocHoacNem(kq.nhom);
      if (d.vai === null && kq.loai !== "INVALID") d.vai = kq.vaiNguon;
      maNv.set(g.maTrongNote, d);
    }
  }

  return {
    hang,
    trungSdt,
    nhomTrungSdt,
    daXoa,
    daCoQuyNguon,
    maNv: [...maNv.values()].sort((a, b) => b.soPhieu - a.soPhieu || a.ma.localeCompare(b.ma)),
    lichSuKhongDung,
    thieuDanhMuc,
  };
}
