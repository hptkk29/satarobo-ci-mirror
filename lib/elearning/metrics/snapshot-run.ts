import { db } from "@/lib/db";
import { apNguong, type DongAnhChup } from "@/lib/elearning/metrics/snapshot";
import { laDungHan, type LuotDeGop } from "@/lib/elearning/report-r4";

/**
 * EL-20 — CHỐT ẢNH CHỤP CHỈ SỐ cho một kỳ.
 *
 * ⚠️ IDEMPOTENT bằng `@@unique([metricKey, periodStart, periodEnd, dimensionKey])`.
 * Chạy lại việc chốt cho cùng kỳ KHÔNG sinh bản thứ hai — và đó là yêu cầu tường minh
 * của TS-37 bước ⑥.
 *
 * ⚠️ Và chạy lại cũng KHÔNG GHI ĐÈ. Ảnh chụp là bất biến: nếu số liệu quá khứ đổi
 * (một lượt được gia hạn, một người nghỉ việc), bản đã chụp phải giữ nguyên. Ghi đè
 * là đúng cái mà cả bảng này sinh ra để tránh.
 */

export type KetQuaChot = {
  kyBatDau: Date;
  kyKetThuc: Date;
  daGhi: number;
  daCo: number;
  /** Số nhóm bị chặn công bố vì dưới ngưỡng n — nói ra, không giấu. */
  biChan: number;
  loi: string[];
};

/** Kỳ THÁNG chứa `now`, tính theo UTC. */
export function kyThang(now: Date): { batDau: Date; ketThuc: Date } {
  const batDau = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const ketThuc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return { batDau, ketThuc };
}

export async function chotAnhChup(now = new Date()): Promise<KetQuaChot> {
  const { batDau, ketThuc } = kyThang(now);
  const ket: KetQuaChot = {
    kyBatDau: batDau,
    kyKetThuc: ketThuc,
    daGhi: 0,
    daCo: 0,
    biChan: 0,
    loi: [],
  };

  try {
    const ds = await db.trnEnrollment.findMany({
      where: { createdAt: { lt: ketThuc } },
      select: {
        snapDepartmentId: true,
        snapJobTitle: true,
        userId: true,
        verifiedAt: true,
        dueAtOriginal: true,
        dueAt: true,
        startedAt: true,
        status: true,
        progressPercent: true,
        pausedAt: true,
        centerId: true,
      },
      take: 5000,
    });

    const dong: DongAnhChup[] = [];

    // ── M2 tổng ──────────────────────────────────────────────────────────────
    dong.push(m2Cua(ds, {}, ds.length));

    // ── M2 theo phòng ban ────────────────────────────────────────────────────
    for (const [dep, nhom] of gomTheo(ds, (r) => r.snapDepartmentId)) {
      dong.push(m2Cua(nhom, { phongBan: dep }, soNguoi(nhom)));
    }

    // ── M2 theo CHỨC DANH ────────────────────────────────────────────────────
    //
    // ⚠️ "Theo chức danh", KHÔNG "theo vị trí": bảng `Position` rỗng trên prod, nên
    // tách theo vị trí cho ra đúng một nhóm rỗng và một báo cáo trông như hỏng.
    // Nguồn là `snapJobTitle` — cột ảnh chụp, phủ 100%.
    for (const [cd, nhom] of gomTheo(ds, (r) => r.snapJobTitle)) {
      dong.push(m2Cua(nhom, { chucDanh: cd }, soNguoi(nhom)));
    }

    const deGhi = apNguong(dong);
    ket.biChan = deGhi.filter((d) => d.suppressed).length;

    for (const d of deGhi) {
      try {
        await db.trnMetricSnapshot.create({
          data: {
            metricKey: d.metricKey,
            periodStart: batDau,
            periodEnd: ketThuc,
            dimensionJson: d.chieu,
            dimensionKey: d.dimensionKey,
            numerator: d.numerator,
            denominator: d.denominator,
            groupN: d.groupN,
            suppressed: d.suppressed,
          },
        });
        ket.daGhi += 1;
      } catch (err) {
        // P2002 = kỳ này đã chốt rồi. Đây là đường chạy lại BÌNH THƯỜNG, không phải
        // lỗi — và cố ý KHÔNG ghi đè: ảnh chụp là bất biến.
        if ((err as { code?: string }).code === "P2002") {
          ket.daCo += 1;
          continue;
        }
        throw err;
      }
    }
  } catch (e) {
    ket.loi.push(`chot-anh-chup: ${String(e)}`);
  }

  return ket;
}

type Dong = {
  snapDepartmentId: string | null;
  snapJobTitle: string;
  userId: string;
  verifiedAt: Date | null;
  dueAtOriginal: Date | null;
  dueAt: Date | null;
  startedAt: Date | null;
  status: string;
  progressPercent: number;
  pausedAt: Date | null;
};

function gomTheo(
  ds: readonly Dong[],
  lay: (r: Dong) => string | null,
): Map<string, Dong[]> {
  const m = new Map<string, Dong[]>();
  for (const r of ds) {
    const k = lay(r);
    // ⚠️ Nhóm `null` KHÔNG bị bỏ — nó thành một nhóm có tên. Bỏ đi là làm mẫu số hụt
    // mà không ai biết hụt bao nhiêu.
    const key = k ?? "(chưa gán)";
    const a = m.get(key) ?? [];
    a.push(r);
    m.set(key, a);
  }
  return m;
}

/** Số NGƯỜI khác nhau — `groupN` đo người, không đo lượt. */
function soNguoi(ds: readonly Dong[]): number {
  return new Set(ds.map((r) => r.userId)).size;
}

function m2Cua(
  ds: readonly Dong[],
  chieu: Record<string, string>,
  groupN: number,
): DongAnhChup {
  const nhu = (r: Dong): LuotDeGop => ({
    userId: r.userId,
    nhomId: null,
    verifiedAt: r.verifiedAt,
    dueAtOriginal: r.dueAtOriginal,
    dueAt: r.dueAt,
    startedAt: r.startedAt,
    status: r.status,
    progressPercent: r.progressPercent,
    pausedAt: r.pausedAt,
  });
  // Mẫu số: lượt CÓ hạn gốc. Lượt không có hạn đứng ngoài phép đo về hạn — cùng luật
  // với R4, và dùng chung hàm để hai báo cáo không bao giờ trả lời khác nhau.
  const coHan = ds.filter((r) => r.dueAtOriginal != null);
  return {
    metricKey: "M2",
    chieu,
    numerator: coHan.filter((r) => laDungHan(nhu(r))).length,
    denominator: coHan.length,
    groupN,
  };
}
