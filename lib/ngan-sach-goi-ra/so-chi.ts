import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import {
  KHOA_MOC_CANH_BAO,
  KHOA_TRAN_THANG,
  MA_CHAN_NGAN_SACH,
  MA_KHONG_DEM_DUOC,
  NHAN_TRUC,
  TRUC_CHI_PHI,
  dinhDangVnd,
  kyThangDeDoc,
  kyThangVn,
  quyetDinhNganSach,
  thongDiepChan,
  tongTran,
  type TrucChiPhi,
} from "./chinh-sach";
import {
  sqlDanhDauBiChan,
  sqlDanhDauCanhBao,
  sqlDatCho,
  sqlHoanLai,
  sqlTaoDongKy,
} from "./cau-lenh";

// =============================================================================
// Trần chi phí tháng — SỔ CHI (tầng DB).
//
// Đây là chỗ duy nhất được phép quyết định "còn tiền để gọi ra không". Mọi trục gọi
// ra ngoài đi qua `datChoNganSach()` trước khi chạm nhà cung cấp, và gọi
// `hoanNganSach()` khi hoá ra lượt đó không phát sinh phí.
//
// Ba điều đã cân nhắc và chốt, ghi lại để lần sau không bị "sửa cho đúng" thành khác:
//
//  1. ĐẶT CHỖ TRƯỚC, HOÀN SAU — không phải "gọi xong rồi ghi sổ". Ghi sổ sau thì
//     giữa lúc gọi và lúc ghi, hàng chục lượt khác đã kịp lọt qua cùng một số dư cũ.
//
//  2. KHÔNG ĐẾM ĐƯỢC ⇒ TỪ CHỐI (fail-closed). DB lỗi thì trả `OUTBOUND_BUDGET_
//     UNAVAILABLE` chứ không cho đi tiếp. Đúng luật nhà của kho ("trạng thái an toàn
//     luôn là không gửi" — `lib/settings/registry.ts`, khối `zalo.znsLive`)
//     và đúng tinh thần chốt 27/08: thứ nguy hiểm nhất là tiêu tiền mà không ai đếm.
//
//  3. TRẦN ĐỌC QUA `getSetting` nên dính cache 300s của tầng cấu hình. Chấp nhận:
//     trần là con số đổi mỗi tháng một lần, không phải công tắc tắt gấp. Ngược lại,
//     SỐ ĐÃ TIÊU KHÔNG BAO GIỜ ĐƯỢC CACHE — nó đọc thẳng trong chính câu UPDATE.
// =============================================================================

export type KetQuaDatCho =
  | {
      ok: true;
      truc: TrucChiPhi;
      kyThang: string;
      /** Đã tiêu SAU khi trừ lượt này. */
      daTieuVnd: number;
      tranVnd: number;
      conLaiVnd: number;
      /** Lượt này vừa đẩy tổng qua mốc cảnh báo (đã phát cảnh báo). */
      canhBaoVuaVuot: boolean;
    }
  | {
      ok: false;
      ma: typeof MA_CHAN_NGAN_SACH | typeof MA_KHONG_DEM_DUOC;
      thongDiep: string;
      truc: TrucChiPhi;
      kyThang: string;
      daTieuVnd: number;
      tranVnd: number;
    };

interface DongSoChi {
  spentVnd: number;
  chargeCount: number;
  blockedCount: number;
  warnedAt: Date | null;
  blockedAt: Date | null;
}

async function docDong(kyThang: string, truc: TrucChiPhi): Promise<DongSoChi | null> {
  return db.outboundSpendCounter.findUnique({
    where: { period_axis: { period: kyThang, axis: truc } },
    select: {
      spentVnd: true,
      chargeCount: true,
      blockedCount: true,
      warnedAt: true,
      blockedAt: true,
    },
  });
}

/**
 * Xin một suất ngân sách cho lượt gọi ra sắp tới.
 *
 * `chiPhiVnd` là ƯỚC TÍNH của nơi gọi (đơn giá tin / giá một lượt chấm). Nơi gọi biết
 * đơn giá của mình, module này chỉ giữ trần và cái sổ — nhờ vậy thêm trục mới không phải
 * sửa file này.
 */
export async function datChoNganSach(args: {
  truc: TrucChiPhi;
  chiPhiVnd: number;
  now?: Date;
}): Promise<KetQuaDatCho> {
  const { truc } = args;
  const kyThang = kyThangVn(args.now ?? new Date());

  const khongDemDuoc = (thongDiep: string, tranVnd = 0, daTieuVnd = 0): KetQuaDatCho => ({
    ok: false,
    ma: MA_KHONG_DEM_DUOC,
    thongDiep,
    truc,
    kyThang,
    daTieuVnd,
    tranVnd,
  });

  if (!Number.isFinite(args.chiPhiVnd) || args.chiPhiVnd < 0) {
    // Lỗi lập trình, không phải sự cố vận hành — nhưng vẫn KHÔNG cho gọi ra, vì một
    // chi phí vô nghĩa nghĩa là ta không biết lượt này tốn bao nhiêu.
    console.error(
      `[ngan-sach-goi-ra] chi phí không hợp lệ cho trục ${truc}: ${String(args.chiPhiVnd)}`,
    );
    return khongDemDuoc("Chi phí một lượt không hợp lệ — không thể đối chiếu ngân sách.");
  }

  let tranVnd: number;
  let mocPhanTram: number;
  try {
    [tranVnd, mocPhanTram] = await Promise.all([
      getSetting(KHOA_TRAN_THANG[truc]),
      getSetting(KHOA_MOC_CANH_BAO),
    ]);
  } catch {
    console.error(`[ngan-sach-goi-ra] không đọc được cấu hình trần cho trục ${truc}.`);
    return khongDemDuoc("Không đọc được cấu hình trần chi phí — tạm ngừng gọi ra.");
  }

  try {
    await db.$executeRaw(sqlTaoDongKy({ kyThang, truc }));

    // CỔNG THẬT: một câu, khoá dòng, tự đánh giá lại điều kiện. 0 dòng = hết ngân sách.
    const duoc = await db.$queryRaw<{ spentVnd: number }[]>(
      sqlDatCho({ kyThang, truc, chiPhiVnd: args.chiPhiVnd, tranVnd }),
    );

    if (duoc.length === 0) {
      await db.$executeRaw(sqlDanhDauBiChan({ kyThang, truc })).catch(() => {});
      const dong = await docDong(kyThang, truc).catch(() => null);
      const daTieuVnd = dong?.spentVnd ?? 0;
      console.error(
        `[ngan-sach-goi-ra] CHẠM TRẦN ${truc} kỳ ${kyThang}: ` +
          `${dinhDangVnd(daTieuVnd)}đ / ${dinhDangVnd(tranVnd)}đ — NGỪNG gọi ra.`,
      );
      return {
        ok: false,
        ma: MA_CHAN_NGAN_SACH,
        thongDiep: thongDiepChan({ truc, kyThang, daTieuVnd, tranVnd }),
        truc,
        kyThang,
        daTieuVnd,
        tranVnd,
      };
    }

    const daTieuVnd = Number(duoc[0]!.spentVnd);

    // Mốc cảnh báo: dùng lại đúng phép tính của bản thuần để hai nơi không lệch.
    const mocCanhBaoVnd = quyetDinhNganSach({
      daTieuVnd: 0,
      chiPhiVnd: 0,
      tranVnd,
      mocCanhBaoPhanTram: mocPhanTram,
    }).mocCanhBaoVnd;

    let canhBaoVuaVuot = false;
    if (mocCanhBaoVnd > 0 && daTieuVnd >= mocCanhBaoVnd) {
      const dauMoc = await db
        .$queryRaw<{ spentVnd: number }[]>(
          sqlDanhDauCanhBao({ kyThang, truc, mocVnd: mocCanhBaoVnd }),
        )
        .catch(() => []);
      if (dauMoc.length > 0) {
        canhBaoVuaVuot = true;
        const phanTram = tranVnd > 0 ? Math.round((daTieuVnd / tranVnd) * 100) : 100;
        console.error(
          `[ngan-sach-goi-ra] CẢNH BÁO ${mocPhanTram}% — ${NHAN_TRUC[truc]} kỳ ` +
            `${kyThangDeDoc(kyThang)} đã dùng ${dinhDangVnd(daTieuVnd)}đ / ` +
            `${dinhDangVnd(tranVnd)}đ (${phanTram}%).`,
        );
      }
    }

    return {
      ok: true,
      truc,
      kyThang,
      daTieuVnd,
      tranVnd,
      conLaiVnd: Math.max(0, tranVnd - daTieuVnd),
      canhBaoVuaVuot,
    };
  } catch (err) {
    console.error(
      `[ngan-sach-goi-ra] lỗi sổ chi trục ${truc} kỳ ${kyThang}:`,
      err instanceof Error ? err.message : err,
    );
    return khongDemDuoc("Không ghi được sổ chi phí — tạm ngừng gọi ra.", tranVnd);
  }
}

/**
 * Trả lại suất đã đặt chỗ khi lượt gọi KHÔNG phát sinh phí (nhà cung cấp từ chối,
 * mạng lỗi, mô phỏng…). Best-effort: hoàn hụt chỉ làm ta dè dặt hơn, nên không bao
 * giờ ném lỗi ngược lên đường gửi.
 */
export async function hoanNganSach(args: {
  truc: TrucChiPhi;
  chiPhiVnd: number;
  now?: Date;
}): Promise<void> {
  if (!Number.isFinite(args.chiPhiVnd) || args.chiPhiVnd <= 0) return;
  const kyThang = kyThangVn(args.now ?? new Date());
  try {
    await db.$executeRaw(sqlHoanLai({ kyThang, truc: args.truc, chiPhiVnd: args.chiPhiVnd }));
  } catch (err) {
    console.error(
      `[ngan-sach-goi-ra] hoàn ngân sách hụt (trục ${args.truc}, kỳ ${kyThang}):`,
      err instanceof Error ? err.message : err,
    );
  }
}

export interface TinhHinhTruc {
  truc: TrucChiPhi;
  nhan: string;
  tranVnd: number;
  daTieuVnd: number;
  conLaiVnd: number;
  phanTram: number;
  soLuot: number;
  soLuotBiChan: number;
  daCanhBao: boolean;
  daChamTran: boolean;
}

export interface TinhHinhNganSach {
  kyThang: string;
  mocCanhBaoPhanTram: number;
  theoTruc: TinhHinhTruc[];
  /** Tổng SUY RA từ các trục — không có ô nhập riêng cho tổng (xem `chinh-sach.ts`). */
  tongTranVnd: number;
  tongDaTieuVnd: number;
}

/** Ảnh chụp ngân sách của kỳ hiện tại — cho màn quản trị / cron đối soát đọc. */
export async function docTinhHinhNganSach(now?: Date): Promise<TinhHinhNganSach> {
  const kyThang = kyThangVn(now ?? new Date());
  const [mocCanhBaoPhanTram, ...tranTheoTruc] = await Promise.all([
    getSetting(KHOA_MOC_CANH_BAO),
    ...TRUC_CHI_PHI.map((truc) => getSetting(KHOA_TRAN_THANG[truc])),
  ]);

  // Đọc BÁO CÁO thì fail-OPEN, ngược với đường ĐẶT CHỖ. Hai đường khác nhau có chủ
  // đích: không đếm được mà vẫn tiêu tiền là hỏng thật, còn không đọc được báo cáo thì
  // cùng lắm là hiện 0. Cụ thể: trong cửa sổ triển khai (mã mới đã lên nhưng migration
  // chưa chạy), bảng chưa tồn tại — để nó ném ra là làm sập cả màn Tích hợp ngoài vì
  // một khối thống kê.
  const dong = await db.outboundSpendCounter
    .findMany({
      where: { period: kyThang },
      select: {
        axis: true,
        spentVnd: true,
        chargeCount: true,
        blockedCount: true,
        warnedAt: true,
        blockedAt: true,
      },
    })
    .catch((err: unknown) => {
      console.error(
        "[ngan-sach-goi-ra] không đọc được sổ chi để dựng báo cáo:",
        err instanceof Error ? err.message : err,
      );
      return [] as { axis: string; spentVnd: number; chargeCount: number; blockedCount: number; warnedAt: Date | null; blockedAt: Date | null }[];
    });
  const theoAxis = new Map(dong.map((d) => [d.axis, d]));

  const tranMap = Object.fromEntries(
    TRUC_CHI_PHI.map((truc, i) => [truc, tranTheoTruc[i] ?? 0]),
  ) as Record<TrucChiPhi, number>;

  const theoTruc: TinhHinhTruc[] = TRUC_CHI_PHI.map((truc) => {
    const d = theoAxis.get(truc);
    const daTieuVnd = d?.spentVnd ?? 0;
    const tranVnd = tranMap[truc];
    return {
      truc,
      nhan: NHAN_TRUC[truc],
      tranVnd,
      daTieuVnd,
      conLaiVnd: Math.max(0, tranVnd - daTieuVnd),
      phanTram: tranVnd > 0 ? Math.round((daTieuVnd / tranVnd) * 100) : 100,
      soLuot: d?.chargeCount ?? 0,
      soLuotBiChan: d?.blockedCount ?? 0,
      daCanhBao: d?.warnedAt != null,
      daChamTran: d?.blockedAt != null,
    };
  });

  return {
    kyThang,
    mocCanhBaoPhanTram,
    theoTruc,
    tongTranVnd: tongTran(tranMap),
    tongDaTieuVnd: theoTruc.reduce((t, x) => t + x.daTieuVnd, 0),
  };
}
