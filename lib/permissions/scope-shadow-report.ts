// lib/permissions/scope-shadow-report.ts — Nền Hệ thống P3 · US-12 (AC2 + AC4).
//
// Ghi lệch + thống kê + CỔNG quyết định cutover (US-13 AC1: 7 ngày liên tục 0 lệch
// chưa giải thích). Soi gương `lib/auth/shadow-report.ts` (đã dùng cho can() v1↔v2)
// để hai cổng đọc giống nhau, người vận hành không phải học hai kiểu báo cáo.
import { db } from "@/lib/db";
import type { Actor, Target } from "@/lib/auth/actor";
import { soSanhQuyetDinh, type KetQuaSoSanh } from "@/lib/permissions/scope-shadow";

/** Giữ 1 trong bao nhiêu lượt GIỐNG. Đủ thưa để không tốn, đủ dày để mỗi ngày
 *  vận hành bình thường luôn có vài bản ghi làm bằng chứng. */
const TI_LE_MAU = 500;

/**
 * Chạy shadow cho MỘT lần kiểm quyền và ghi lại nếu không "giống".
 *
 * ⚠️ AC3 — KHÔNG BAO GIỜ CHẶN. Hàm này trả `void`, không trả quyết định, và nuốt mọi
 * lỗi. Người gọi đã có kết quả thật từ `can()` rồi; đây chỉ là quan sát viên. Thiết kế
 * vậy để không thể lỡ tay dùng kết quả mới làm quyết định trong pha shadow.
 *
 * GHI THƯA ca `giong` (mặc định 1/500) — KHÔNG bỏ hẳn.
 *
 * Ghi mọi lần là tự làm ngập DB (mỗi request gọi `can()` nhiều lần). Nhưng bỏ hẳn thì
 * khi mọi thứ đã sạch, bảng RỖNG — và lúc đó "0 lệch trong 7 ngày" không phân biệt
 * được với "shadow không chạy ngày nào". Đúng bài học `inconclusive` của đối soát
 * OrgUnit: quét 0 dòng mà báo sạch là xanh giả. Mẫu thưa cho ta MẪU SỐ.
 */
export async function ghiScopeShadow(params: {
  actor: Actor;
  permissionKey: string;
  target?: Target;
  /** Cho test bơm sẵn kết quả; runtime để trống. */
  ketQua?: KetQuaSoSanh & { nguon?: "grant" | "perm" };
  /** Cho test ép nhịp lấy mẫu (0 = chắc chắn lấy); runtime để trống. */
  nhipMau?: number;
}): Promise<void> {
  try {
    const kq =
      params.ketQua ??
      soSanhQuyetDinh(params.actor, params.permissionKey, params.target);
    if (kq.ketQua === "giong") {
      // Mẫu thưa: chỉ giữ ~1/TI_LE_MAU lượt giống, đủ để chứng minh shadow có chạy.
      const nhip = params.nhipMau ?? Math.random();
      if (nhip >= 1 / TI_LE_MAU) return;
    }

    const targetOrgUnitId = params.target?.orgUnitId ?? null;
    await db.scopeShadowDiff.create({
      data: {
        ketQua:
          kq.ketQua === "lech"
            ? "LECH"
            : kq.ketQua === "chua-phu"
              ? "CHUA_PHU"
              : "GIONG",
        permissionKey: params.permissionKey,
        // Nguồn quyết định: "grant" (bảng PermissionGrant P0) hay "perm" (đường cũ
        // đang enforce). Báo cáo tách theo đây mới biết shadow phủ được chỗ nào.
        nguon: kq.nguon ?? "perm",
        userId: params.actor.userId,
        cu: kq.cu,
        moi: kq.moi,
        roleId: null,
        targetCenterId: params.target?.centerId ?? null,
        targetOrgUnitId,
        orgUnitId: targetOrgUnitId,
        lyDo: kq.lyDo ?? null,
      },
    });
  } catch {
    // Nuốt: quan sát viên không được phép làm hỏng thứ nó quan sát.
  }
}

export type ScopeShadowStats = {
  soNgay: number;
  lech: number;
  chuaPhu: number;
  /** Lệch theo permissionKey — biết nên điều tra chỗ nào trước. */
  lechTheoQuyen: Record<string, number>;
  /** Chưa phủ theo permissionKey — biết chỗ gọi nào còn thiếu `orgUnitId`. */
  chuaPhuTheoQuyen: Record<string, number>;
};

/** Thống kê trong cửa sổ `soNgay` gần nhất (AC4). */
export async function thongKeScopeShadow(opts?: {
  soNgay?: number;
  now?: Date;
}): Promise<ScopeShadowStats> {
  const soNgay = opts?.soNgay ?? 7;
  const now = opts?.now ?? new Date();
  const tu = new Date(now.getTime() - soNgay * 24 * 60 * 60 * 1000);

  const rows = await db.scopeShadowDiff.groupBy({
    by: ["ketQua", "permissionKey"],
    where: { createdAt: { gte: tu } },
    _count: { _all: true },
  });

  const stats: ScopeShadowStats = {
    soNgay,
    lech: 0,
    chuaPhu: 0,
    lechTheoQuyen: {},
    chuaPhuTheoQuyen: {},
  };
  for (const r of rows) {
    const n = r._count._all;
    if (r.ketQua === "GIONG") continue; // mẫu chứng, không phải vấn đề
    if (r.ketQua === "LECH") {
      stats.lech += n;
      stats.lechTheoQuyen[r.permissionKey] =
        (stats.lechTheoQuyen[r.permissionKey] ?? 0) + n;
    } else {
      stats.chuaPhu += n;
      stats.chuaPhuTheoQuyen[r.permissionKey] =
        (stats.chuaPhuTheoQuyen[r.permissionKey] ?? 0) + n;
    }
  }
  return stats;
}

export type CongCutover = {
  dat: boolean;
  lyDo: string[];
  lech: number;
  chuaPhu: number;
  soNgay: number;
  /** Số ngày THỰC SỰ có dữ liệu shadow trong cửa sổ — mẫu số của phép "sạch". */
  soNgayCoDuLieu: number;
};

/**
 * CỔNG CUTOVER (US-13 AC1). Ba điều kiện, KHÔNG phải một:
 *
 *  ① `lech = 0` trong cửa sổ — điều kiện ai cũng nghĩ tới.
 *  ② `chuaPhu = 0` — nếu chỗ gọi chưa truyền `orgUnitId` thì resolver mới CHƯA HỀ
 *     được thử ở đó. Bật cutover lúc đó là bật một thứ chưa ai đo.
 *  ③ có dữ liệu ở ĐỦ `soNgay` ngày riêng biệt — "0 lệch" trên một cửa sổ mà shadow
 *     không chạy ngày nào là **xanh giả**. Đây đúng bài học `inconclusive` của đối
 *     soát OrgUnit: quét 0 dòng mà báo sạch thì con số vô nghĩa.
 *
 * Điều ③ là lý do hàm này không chỉ đếm hai con số rồi trả true.
 */
export async function congCutoverDat(opts?: {
  soNgay?: number;
  now?: Date;
}): Promise<CongCutover> {
  const soNgay = opts?.soNgay ?? 7;
  const now = opts?.now ?? new Date();
  const tu = new Date(now.getTime() - soNgay * 24 * 60 * 60 * 1000);

  const stats = await thongKeScopeShadow({ soNgay, now });

  // Số ngày riêng biệt CÓ bản ghi shadow — MẪU SỐ của phép "sạch".
  // Đếm được là nhờ mẫu thưa `GIONG`: khi mọi thứ đã sạch, bảng vẫn có bản ghi, nên
  // phân biệt được "sạch thật" với "shadow không chạy ngày nào".
  const ngayCoDuLieu = await db.$queryRaw<{ ngay: Date }[]>`
    SELECT DISTINCT date_trunc('day', "createdAt") AS ngay
      FROM "ScopeShadowDiff"
     WHERE "createdAt" >= ${tu}
  `;
  const soNgayCoDuLieu = ngayCoDuLieu.length;

  const lyDo: string[] = [];
  if (stats.lech > 0) lyDo.push(`còn ${stats.lech} lệch trong ${soNgay} ngày`);
  if (stats.chuaPhu > 0)
    lyDo.push(
      `còn ${stats.chuaPhu} lượt CHƯA PHỦ (chỗ gọi chưa truyền orgUnitId) — resolver mới chưa được thử ở đó`,
    );
  if (soNgayCoDuLieu < soNgay) {
    lyDo.push(
      `chỉ có bản ghi shadow ở ${soNgayCoDuLieu}/${soNgay} ngày — chưa đủ bằng chứng shadow chạy LIÊN TỤC; "0 lệch" trên cửa sổ thiếu ngày là XANH GIẢ`,
    );
  }

  return {
    dat: lyDo.length === 0,
    lyDo,
    lech: stats.lech,
    chuaPhu: stats.chuaPhu,
    soNgay,
    soNgayCoDuLieu,
  };
}
