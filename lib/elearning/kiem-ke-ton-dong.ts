import { scopedDb } from "@/lib/db-scope";
import { SYSTEM_ACTOR } from "@/lib/auth/system-actor";
import { AN_HAN_GIAY } from "@/lib/elearning/exam-grading";
import { CUA_SO_BAO_NGUOI_HOC_MS, canDongLuot, hanChotLuot } from "@/lib/elearning/exam-close-pure";

/**
 * KIỂM KÊ lượt thi tồn đọng — chỉ-đọc, tách khỏi `cron-dong-luot-thi.ts` để script chạy được ngoài Next (tệp kia kéo theo
 * `notify-gate` → `notifications/notify` có `import "server-only"` mà tsx thuần không có).
 */

const TRANG = 200;
/** Trần số hàng quét (bội của trang) — chạm trần thì các số là CẬN DƯỚI. */
const TRAN_QUET = 2000;

type Dong = {
  id: string;
  startedAt: Date;
  exam: { title: string; durationMin: number };
};

export type KiemKeTonDong = {
  /** Số lượt đang `IN_PROGRESS` trong vùng quét. */
  dangLam: number;
  /** Quá hạn + biên chờ ⇒ CRON SẼ ĐÓNG nếu cờ bật (chưa kể giới hạn tuổi). */
  seDong: number;
  /** Trong `seDong`: không lưu câu nào ⇒ sẽ chấm 0, TRƯỢT và TIÊU một lượt thi. */
  seDongKhongCoCauTraLoi: number;
  /** Trong `seDong`: hạn chót cách đây quá 24 giờ ⇒ đóng IM LẶNG (không báo người học). */
  seDongImLang: number;
  /** Trong `seDong`: cũ hơn `tuoiToiDaNgay` ⇒ sẽ GIỮ NGUYÊN. Rỗng khi không đặt giới hạn. */
  seBoQuaQuaCu: number;
  /** Hạn chót cũ nhất trong `seDong` (ISO) hoặc null. */
  cuNhat: string | null;
  /** Số lượt `seDong` theo tiêu đề đề thi — KHÔNG có định danh người học. */
  theoDe: { tieuDe: string; soLuot: number }[];
  /** `true` nếu chạm trần quét ⇒ các số trên là CẬN DƯỚI. */
  chamTranQuet: boolean;
};

/**
 * KIỂM KÊ chỉ-đọc trước lần bật đầu tiên: cron SẼ đóng bao nhiêu lượt, trong đó bao nhiêu lượt không có câu trả lời nào (trượt + mất một lượt
 * thi), bao nhiêu đóng im lặng. Không ghi gì, không gửi gì. Dùng `scripts/uat/kiem-ke-luot-ton-dong.ts` để chạy và đưa số cho owner.
 */
export async function kiemKeLuotTonDong(
  now: Date,
  opts: { marginPhut: number; tuoiToiDaNgay?: number; trang?: number },
): Promise<KiemKeTonDong> {
  const sdb = scopedDb(SYSTEM_ACTOR);
  const gioiHan = new Date(now.getTime() - (AN_HAN_GIAY + opts.marginPhut * 60) * 1000);
  const kichTrang = opts.trang ?? TRANG;
  const ra: KiemKeTonDong = {
    dangLam: 0,
    seDong: 0,
    seDongKhongCoCauTraLoi: 0,
    seDongImLang: 0,
    seBoQuaQuaCu: 0,
    cuNhat: null,
    theoDe: [],
    chamTranQuet: false,
  };
  const quaHan: { id: string; tieuDe: string; hanChot: Date }[] = [];
  let conTro: string | undefined;
  let daQuet = 0;
  for (;;) {
    const trang: Dong[] = await sdb.trnExamAttempt.findMany({
      where: { status: "IN_PROGRESS", exam: { deletedAt: null } },
      select: {
        id: true,
        startedAt: true,
        exam: { select: { title: true, durationMin: true } },
      },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      take: kichTrang,
      ...(conTro ? { cursor: { id: conTro }, skip: 1 } : {}),
    });
    daQuet += trang.length;
    ra.dangLam += trang.length;
    for (const r of trang) {
      if (r.startedAt >= gioiHan) continue;
      if (!canDongLuot({ startedAt: r.startedAt, durationMin: r.exam.durationMin, now, marginPhut: opts.marginPhut })) continue;
      quaHan.push({ id: r.id, tieuDe: r.exam.title, hanChot: hanChotLuot({ startedAt: r.startedAt, durationMin: r.exam.durationMin }) });
    }
    if (trang.length < kichTrang) break;
    if (daQuet >= 20 * TRAN_QUET) {
      ra.chamTranQuet = true;
      break;
    }
    conTro = trang[trang.length - 1]!.id;
  }

  const seDong =
    opts.tuoiToiDaNgay === undefined
      ? quaHan
      : quaHan.filter((x) => now.getTime() - x.hanChot.getTime() <= opts.tuoiToiDaNgay! * 86_400_000);
  ra.seBoQuaQuaCu = quaHan.length - seDong.length;
  ra.seDong = seDong.length;
  ra.seDongImLang = seDong.filter((x) => now.getTime() - x.hanChot.getTime() > CUA_SO_BAO_NGUOI_HOC_MS).length;
  ra.cuNhat = seDong.length ? new Date(Math.min(...seDong.map((x) => x.hanChot.getTime()))).toISOString() : null;

  const coCau = new Set<string>();
  for (let i = 0; i < seDong.length; i += 500) {
    const nhom = await sdb.trnExamAnswer.groupBy({
      by: ["attemptId"],
      where: { attemptId: { in: seDong.slice(i, i + 500).map((x) => x.id) } },
    });
    for (const g of nhom) coCau.add(g.attemptId);
  }
  ra.seDongKhongCoCauTraLoi = seDong.filter((x) => !coCau.has(x.id)).length;

  const dem = new Map<string, number>();
  for (const x of seDong) dem.set(x.tieuDe, (dem.get(x.tieuDe) ?? 0) + 1);
  ra.theoDe = [...dem.entries()].map(([tieuDe, soLuot]) => ({ tieuDe, soLuot })).sort((a, b) => b.soLuot - a.soLuot);
  return ra;
}
