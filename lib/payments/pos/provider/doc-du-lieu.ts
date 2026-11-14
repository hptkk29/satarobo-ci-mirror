import "server-only";
// lib/payments/pos/provider/doc-du-lieu.ts — ĐỌC dữ liệu Techcombank ĐÃ ĐỒNG BỘ cho một phiếu thu thẻ (GĐ1 POS,
// dời ra ở GĐ4). CHỈ ĐỌC. Thiết kế: docs/pos-gd1-thiet-ke.md §2.3 + docs/pos-gd4-thiet-ke.md §6.4.
//
// Thân `TcbFileImportProvider.checkStatus` (GĐ1) DỜI NGUYÊN VĂN về đây để HAI chế độ dùng chung — dòng của file
// lẫn dòng của máy đồng bộ (agent) nằm CÙNG bảng `PosCardTransaction` (T1). Chế độ FILE giữ byte-cho-byte hành
// vi GĐ1 (ca GĐ1/GĐ2 xanh nguyên văn); chế độ AGENT khác ĐÚNG ba chỗ (bảng §6.4):
//   · cận trên cửa sổ = lúc đọc + 5′ (T27 — đồng hồ máy POS nhanh vài chục giây là giao dịch rơi khỏi cửa sổ
//     trong lúc sale chờ agent đồng bộ);
//   · "dữ liệu cập nhật lần cuối" = max(agent.lastSyncedAt, lô import mới nhất);
//   · FAILED mang `maLyDoThatBai` (T14 — vd USER_CANCELLED ⇒ "Khách huỷ trên máy — cho quẹt lại").
// Cả hai chế độ tìm theo MÃ trên MỌI dòng đã đồng bộ, KHÔNG lọc cơ sở (T31 = T4 GĐ1 — xem điều 1 dưới).
//
// BA ĐIỀU CỐ Ý, đừng "sửa":
//  1. KHÔNG lọc theo cơ sở / máy (T4). Quẹt ở máy cơ sở khác phải ra CAN_XU_LY (Q-E chặn khớp ở
//     pha tiền) — trả NOT_FOUND là MỜI QUẸT LẠI một khoản đã trừ thẻ khách. Phạm vi đọc vẫn hẹp:
//     chỉ dòng mang mã của CHÍNH phiếu mà người bấm đã qua cổng phạm vi đơn. Ca `[POS1-QE-01]`.
//  2. Phép quyết mã là `tachMaPos` (token đứng riêng, dài đúng 5, qua checksum, in hoa — D2); ILIKE
//     chỉ là lọc thô. "XK7M2NX" không khớp, "k7m2n." khớp. Ca `[POS1-D2-01]`.
//  3. Loại giao dịch ĐÃ THUỘC phiếu POS KHÁC (vd phiếu LECH_TIEN cũ của cùng phiếu gộp) — không thì
//     phiếu mới nhận nhầm giao dịch lệch của phiếu cũ. Ca `[POS1-PRV-04]`.
//
// Provider KHÔNG trả PAID_AMOUNT_MISMATCH / CANCELLED_AFTER_PAID (T3): đúng/lệch số và hủy-hoàn do
// pha tiền tự suy từ CHÍNH dữ liệu đã lưu (`phanLoaiDongPos` + tập hủy đã lưu).
//
// HAI LUẬT THÊM (rà đối kháng 06/10/2026):
//  4. Lần quẹt đã bị HỦY/HOÀN TOÀN PHẦN (cột Hoàn/Hủy nói toàn phần · dòng Hủy đã lưu trỏ tới, đúng
//     số · dòng POS import đã kết luận BO_QUA vì hủy) KHÔNG được chọn khi CÒN lần quẹt thành công
//     khác — "hủy → quẹt lại CÙNG mã" là luồng thiết kế mời làm (§7.3). Ca `[POS1-PRV-10]`.
//     Chỉ còn lần đã hủy ⇒ vẫn trả nó (pha tiền kết luận "đã hủy trên máy").
//  5. Chỉ "Thất bại" mới là FAILED. Trạng thái chưa ngã ngũ ("Đang xử lý") hay chữ LẠ ⇒ NOT_FOUND
//     kèm `trangThaiTreo` (fail-closed, Q-I). Ca `[POS1-PRV-09]`.
import { db } from "@/lib/db";
import { gioVN } from "@/lib/format/thoi-gian-vn";
import { tachMaPos } from "../tach-ma-pos";
import {
  CTX_XET_HUY,
  dongTuBanGhi,
  huyDaKetLuanTrenDong,
  laHuyToanPhanVoiGoc,
  laLoaiThanhToan,
  laTrangThaiThanhCong,
  maTrangThaiPos,
  phanLoaiDongPos,
} from "../phan-loai-pos";
import type { IntentDeKiem, PosCheckResult } from "./kieu";

/** Đặc tả: [intent.createdAt − 5 phút, now] — sale có thể bấm "Thẻ POS" ngay sau khi khách quẹt. */
export const CUA_SO_LUI_MS = 5 * 60_000;
/** [GĐ4 T27] Chế độ AGENT: cận trên = lúc đọc + chừng này (dung sai đồng hồ máy POS). */
export const DUNG_SAI_GIO_MAY_MS = 5 * 60_000;
/** Bảng nhỏ (hàng chục dòng/ngày/cơ sở) — trần chỉ để một mã lạ không kéo cả bảng. */
const TRAN_UNG_VIEN = 50;
/** `maTrangThaiPos("Thất bại")` — chữ DUY NHẤT của file được gọi là thất bại (luật 5). */
const MA_THAT_BAI = "THAT_BAI";

export type CheDoDoc = { cheDo: "FILE" } | { cheDo: "AGENT"; lastSyncedAt: Date | null };

export async function docKetQuaDaDongBo(intent: IntentDeKiem, now: Date, che: CheDoDoc): Promise<PosCheckResult> {
  const agent = che.cheDo === "AGENT";
  try {
    const tu = new Date(intent.createdAt.getTime() - CUA_SO_LUI_MS);
    const den = agent ? new Date(now.getTime() + DUNG_SAI_GIO_MAY_MS) : now;
    const ungVien = await db.posCardTransaction.findMany({
      where: {
        thoiGianGiaoDich: { gte: tu, lte: den },
        dienGiai: { contains: intent.code5, mode: "insensitive" },
      },
      select: {
        maGiaoDich: true,
        loaiGiaoDich: true,
        trangThai: true,
        soTien: true,
        thoiGianGiaoDich: true,
        dienGiai: true,
        maChuanChi: true,
        soTheMasked: true,
        maThietBi: true,
        bankTransactionId: true,
        trangThaiHoanHuy: true,
        matchStatus: true,
        matchReason: true,
        maLyDoThatBai: true,
      },
      orderBy: { thoiGianGiaoDich: "asc" },
      take: TRAN_UNG_VIEN,
    });
    const coMa = ungVien.filter((r) => tachMaPos(r.dienGiai).includes(intent.code5));

    // Giao dịch đã thuộc phiếu POS KHÁC — không phải của phiếu này (điều 3).
    const btIds = coMa.map((r) => r.bankTransactionId).filter((x): x is string => !!x);
    const daThuoc = new Set(
      btIds.length === 0
        ? []
        : (
            await db.posPaymentIntent.findMany({
              where: { bankTransactionId: { in: btIds }, id: { not: intent.id } },
              select: { bankTransactionId: true },
            })
          )
            .map((x) => x.bankTransactionId)
            .filter((x): x is string => !!x),
    );
    const thanhToan = coMa.filter(
      (r) => laLoaiThanhToan(r.loaiGiaoDich) && !(r.bankTransactionId && daThuoc.has(r.bankTransactionId)),
    );

    const thanhCong = thanhToan.filter((r) => laTrangThaiThanhCong(r.trangThai) && r.soTien > 0);
    if (thanhCong.length > 0) {
      // Luật 4 — lần quẹt đã hủy/hoàn TOÀN PHẦN. Dòng Hủy ĐÃ LƯU trỏ vào ứng viên: đi qua ĐÚNG phép
      // phân loại + so số của tầng nhập lô (`phanLoaiDongPos` + `laHuyToanPhanVoiGoc`).
      const soTheoMa = new Map(thanhCong.map((r) => [r.maGiaoDich, r.soTien]));
      const huyDaLuu = await db.posCardTransaction.findMany({
        where: { maGiaoDichGoc: { in: [...soTheoMa.keys()] } },
        select: {
          maGiaoDich: true,
          loaiGiaoDich: true,
          trangThai: true,
          soTien: true,
          maGiaoDichGoc: true,
          trangThaiHoanHuy: true,
        },
      });
      const daHuyBoiDong = new Set<string>();
      for (const h of huyDaLuu) {
        const p = phanLoaiDongPos(dongTuBanGhi(h), CTX_XET_HUY);
        const goc = h.maGiaoDichGoc?.trim();
        const soGoc = goc ? soTheoMa.get(goc) : undefined;
        if (p.loai === "HUY" && goc && soGoc !== undefined && laHuyToanPhanVoiGoc(p, h.soTien, soGoc)) {
          daHuyBoiDong.add(goc);
        }
      }
      const daHuy = (r: (typeof thanhCong)[number]) =>
        // Cột Hoàn/Hủy đã lưu · kết luận BO_QUA "đã hủy" không giao dịch — CÙNG vị từ với tầng nhập lô (GĐ3, rà
        // đối kháng #1/#5; gộp GĐ3 × GĐ4: thân `tcb-file.ts` của GĐ3 nay sống ở đây, CẢ HAI chế độ FILE/AGENT).
        huyDaKetLuanTrenDong(r) === "TOAN_PHAN" || daHuyBoiDong.has(r.maGiaoDich);
      const conHieuLuc = thanhCong.filter((r) => !daHuy(r));

      // Phiếu ĐÃ nhận một giao dịch ⇒ trả lại CHÍNH nó (lượt kiểm sau không lật sang giao dịch khác
      // cùng mã — phiếu nhận giao dịch thì đã ĐÓNG, phiếu mới của cùng phiếu gộp tự tìm lần quẹt
      // khác); chưa nhận ⇒ lần quẹt CÒN HIỆU LỰC sớm nhất, không còn thì lần sớm nhất (đã hủy).
      const r =
        (intent.bankTransactionId
          ? thanhCong.find((x) => x.bankTransactionId === intent.bankTransactionId)
          : undefined) ??
        conHieuLuc[0] ??
        thanhCong[0]!;
      const khac = conHieuLuc.filter((x) => x.maGiaoDich !== r.maGiaoDich).length;
      return {
        kind: "PAID",
        providerTxnId: r.maGiaoDich,
        amount: r.soTien,
        paidAt: gioVN(r.thoiGianGiaoDich),
        approvalCode: r.maChuanChi,
        cardMasked: r.soTheMasked,
        terminalCode: r.maThietBi,
        dienGiai: r.dienGiai,
        // Lần quẹt THÀNH CÔNG CÒN HIỆU LỰC khác cùng mã (cảnh báo thu đôi) — lần đã hủy không đếm.
        giaoDichKhac: khac,
        ...(agent ? { cheDoNguon: "AGENT" as const } : {}),
      };
    }

    // Luật 5 — chỉ "Thất bại" mới là thất bại. Dòng Thành công mà số tiền ≤ 0 là dữ liệu lạ, để kế
    // toán xử. Dòng TREO (chưa ngã ngũ / chữ lạ) thắng dòng thất bại: còn một lần quẹt chưa ngã ngũ
    // thì chưa được mời quẹt lại.
    const khongThanhCong = thanhToan.filter((r) => !laTrangThaiThanhCong(r.trangThai));
    const treo = khongThanhCong.filter((r) => maTrangThaiPos(r.trangThai) !== MA_THAT_BAI);
    const thatBai = khongThanhCong.filter((r) => maTrangThaiPos(r.trangThai) === MA_THAT_BAI);
    const cuoiTreo = treo[treo.length - 1];
    const cuoi = thatBai[thatBai.length - 1];
    if (cuoi && !cuoiTreo) {
      return {
        kind: "FAILED",
        providerTxnId: cuoi.maGiaoDich,
        // [GĐ4 T14] Chế độ AGENT: mã lý do thất bại portal đọc được (USER_CANCELLED…), vắng ⇒ THAT_BAI.
        reasonCode: agent ? (cuoi.maLyDoThatBai ?? MA_THAT_BAI) : MA_THAT_BAI,
        dienGiai: cuoi.dienGiai,
        ...(agent ? { cheDoNguon: "AGENT" as const } : {}),
      };
    }

    // "Giao dịch mới nhất" tính trên dòng của CHÍNH cơ sở phiếu (máy đã khai cho cơ sở đó) — nó
    // quyết câu cấm quẹt lại (T14: dữ liệu chưa có giao dịch nào sau lúc tạo phiếu). Lấy max TOÀN
    // HỆ là để file cơ sở KHÁC nhập muộn hơn che mất việc dữ liệu cơ sở này còn cũ ⇒ câu cấm biến
    // mất ⇒ sale mời quẹt lại một khoản có thể đã trừ thẻ. (Khớp tiền vẫn KHÔNG lọc cơ sở — T4.)
    const [lo, moiNhat] = await Promise.all([
      db.posImportBatch.findFirst({
        where: { soLoXong: { gt: 0 } },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
      db.posCardTransaction.aggregate({
        where: { centerId: intent.centerId },
        _max: { thoiGianGiaoDich: true },
      }),
    ]);
    // [GĐ4] Chế độ AGENT: dữ liệu mới nhất = lần agent đồng bộ xong gần nhất HOẶC lô file mới nhất.
    const capNhat =
      agent && che.lastSyncedAt && (!lo || che.lastSyncedAt.getTime() > lo.updatedAt.getTime()) ? che.lastSyncedAt : (lo?.updatedAt ?? null);
    return {
      kind: "NOT_FOUND",
      duLieuCapNhatLuc: capNhat ? gioVN(capNhat) : null,
      gdMoiNhatLuc: moiNhat._max.thoiGianGiaoDich ? gioVN(moiNhat._max.thoiGianGiaoDich) : null,
      ...(cuoiTreo ? { trangThaiTreo: maTrangThaiPos(cuoiTreo.trangThai).slice(0, 64) } : {}),
      ...(agent ? { cheDoNguon: "AGENT" as const } : {}),
    };
  } catch (err) {
    console.error(agent ? "[pos-provider:tcb-agent]" : "[pos-provider:tcb-file]", err);
    return { kind: "PROVIDER_ERROR", reasonCode: agent ? "TCB_AGENT_DB" : "TCB_FILE_DB" };
  }
}
