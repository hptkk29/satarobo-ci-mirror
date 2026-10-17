import "server-only";
// lib/payments/pos/quet-sach.ts — QUÉT SẠCH phiếu thu thẻ cuối ngày (GĐ2 POS · 06/10/2026). Cron
// `/api/cron/pos-quet-sach` lúc 23:30 giờ VN (16:30Z). Thiết kế: docs/pos-gd2-thiet-ke.md §5 (U14).
//
// Kiểm MỌI phiếu còn MỞ (không lọc tuổi — đỡ cho trường hợp poller dừng; cũ trước, ≤ 300 phiếu, ngân sách
// 240 giây) qua `kiemTraPhieuPos` nguồn QUET_SACH — KHÔNG chịu cửa sổ chống bấm dồn (U3: chốt cuối ngày
// chạy cùng phút với poller, trả câu cũ là mất đúng thông tin mới vừa về) — cộng phiếu HET_HAN CHƯA BỊ
// THAY trong 7 ngày (rà đối kháng 06/10/2026, cùng tập với đồng bộ sau import). Phiếu vừa được ghi nhận bởi
// CHÍNH lượt quét (DA_THU / LECH_TIEN / CAN_XU_LY) ⇒ `console.warn` + MỘT chuông/ngày cho Kế toán HO ∪
// Quản trị tối cao (`nguoiNhanBaoPos`, cùng tập T17). Không ghi nhận gì ⇒ không chuông: chuông mỗi tối
// cho phiếu bỏ dở là chuông người ta học cách tắt.
//
// "Ghi nhận" là đường tiền GĐ1: provider PAID ⇒ `khopGiaoDichThe` ⇒ (đúng số) Payment PENDING, hoặc
// (lệch / lý do khác) giao dịch vào hàng chờ tay. KHÔNG đường tiền riêng (lưới `[POS2-W1]`), KHÔNG ghi
// HET_HAN (việc của poller — `[POS2-QS-06]`), KHÔNG hỏi cờ (T8). Chạy cùng poller/nút không ghi đôi:
// khoá ĐƠN → khoá GIAO DỊCH của `thuTheoPhieuGop` + `@@unique([provider, providerTxnId])` (`[POS2-QS-03]`).
import type { PosIntentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { notifyStaffChiTiet } from "@/lib/notifications/notify";
import { congNgay, dauNgayTuChuoi, ngayVN } from "@/lib/format/thoi-gian-vn";
import { CUA_SO_DONG_BO_MS, idPhieuHetHanChuaBiThay } from "./dong-bo-sau-nhap";
import { chonPosProvider } from "./provider/chon";
import type { PosProvider } from "./provider/kieu";
import { TRANG_THAI_MO } from "./phieu-pos-luat";
import { khoaQuetSach, NGAN_SACH_QUET_SACH_MS, TRAN_QUET_SACH } from "./lich-kiem";
import { NHAN_TRANG_THAI_PHIEU } from "./nhat-ky-loc";
import { nguoiNhanBaoPos } from "./nguoi-nhan-bao-pos";
import { kiemTraPhieuPos } from "./xu-ly-ket-qua";

/** Trạng thái "đã ghi nhận" — tiền đã đi một đường (vào sổ hoặc vào hàng chờ tay). */
const DA_GHI_NHAN: ReadonlySet<PosIntentStatus> = new Set(["DA_THU", "LECH_TIEN", "CAN_XU_LY"]);

export type KetQuaQuetSach = {
  daKiem: number;
  /** Phiếu CHÍNH lượt quét vừa đưa sang trạng thái đã ghi nhận. */
  ghiNhan: { intentId: string; code5: string; status: PosIntentStatus }[];
  /** Phiếu còn MỞ tạo hôm nay (giờ VN) — nhắc kiểm đã nhập file Techcombank chưa. */
  conMoHomNay: number;
  loi: number;
  boQuaHetGio: number;
  /** Số người VỪA được rung (chuông mới hoặc mở lại — `canRung`); 0 khi không ghi nhận gì. */
  daBao: number;
};

export async function quetSachPhieuPos(input: {
  /** BẮT BUỘC (luật 19). Gọi MỚI cho từng phiếu. */
  dongHo: () => Date;
  provider?: PosProvider;
}): Promise<KetQuaQuetSach> {
  // GĐ4 (T5 + rà đối kháng RV-03): lượt máy KHÔNG chờ job; agent không sẵn sàng ⇒ chỉ tin PAID, giữ D9 ([POS4-W4]).
  const provider = input.provider ?? chonPosProvider({ cheDo: "MAY" });
  const batDau = input.dongHo();
  const ngay = ngayVN(batDau);
  const kq: KetQuaQuetSach = { daKiem: 0, ghiNhan: [], conMoHomNay: 0, loi: 0, boQuaHetGio: 0, daBao: 0 };

  const mo = await db.posPaymentIntent.findMany({
    where: { status: { in: [...TRANG_THAI_MO] } },
    orderBy: { createdAt: "asc" },
    take: TRAN_QUET_SACH,
    select: { id: true, code5: true },
  });
  // Rà đối kháng 06/10/2026: thêm phiếu HET_HAN CHƯA BỊ THAY trong cửa sổ đồng bộ (poller ghi HET_HAN lúc
  // 24 giờ, file nhập muộn) — lưới đỡ khi đồng bộ sau import hụt. Chung trần, phiếu mở trước.
  const hetHanIds = await idPhieuHetHanChuaBiThay({ now: batDau, cuaSoMs: CUA_SO_DONG_BO_MS, take: TRAN_QUET_SACH });
  const hetHan =
    hetHanIds.length === 0
      ? []
      : await db.posPaymentIntent.findMany({
          where: { id: { in: hetHanIds } },
          orderBy: { createdAt: "asc" },
          select: { id: true, code5: true },
        });
  const ds = [...mo, ...hetHan].slice(0, TRAN_QUET_SACH);
  for (let i = 0; i < ds.length; i += 1) {
    const t = input.dongHo();
    if (t.getTime() - batDau.getTime() > NGAN_SACH_QUET_SACH_MS) {
      kq.boQuaHetGio += ds.length - i;
      break;
    }
    const { id: intentId, code5 } = ds[i]!;
    try {
      const r = await kiemTraPhieuPos({ intentId, provider, triggeredBy: "QUET_SACH", now: t, nguoiKiemId: null });
      kq.daKiem += 1;
      if (r.doiTrangThai && DA_GHI_NHAN.has(r.status)) {
        kq.ghiNhan.push({ intentId, code5, status: r.status });
        console.warn(`[pos:quet-sach] phiếu ${code5} → ${r.status} — poller/nút/đồng bộ đã bỏ sót`);
      }
    } catch (err) {
      kq.loi += 1;
      console.error(`[pos:quet-sach] phiếu ${intentId} lỗi:`, err);
    }
  }

  kq.conMoHomNay = await db.posPaymentIntent.count({
    where: { status: { in: [...TRANG_THAI_MO] }, createdAt: { gte: dauNgayTuChuoi(ngay) } },
  });

  if (kq.ghiNhan.length > 0) {
    const nguoi = await nguoiNhanBaoPos(batDau);
    if (nguoi.length === 0) {
      console.warn(`[pos:quet-sach] ${kq.ghiNhan.length} phiếu ghi nhận muộn nhưng không có Kế toán HO / Quản trị nào để báo`);
    } else {
      // KHÔNG in số tiền (khuôn PRD T5 của `phieu-gop.da-chia:` — panel chuông mở giữa chỗ đông người).
      // MỘT chuông/ngày/người — nhưng chạy lại cùng ngày (gọi tay / chạy lại cron) thì thân là HỢP mọi lượt
      // quét trong ngày (`phieuGhiNhanTrongNgay`, đọc nhật ký kiểm) và `reopen` rung lại người đã đọc: lượt
      // này CHẮC CHẮN có phiếu mới (nhánh chỉ chạy khi `ghiNhan` không rỗng). Bản trước đè danh sách bằng
      // lượt mới và giữ "đã đọc" ⇒ phiếu của lượt sau im lặng (rà đối kháng 06/10/2026).
      const tatCa = await phieuGhiNhanTrongNgay(ngay, kq.ghiNhan);
      const danhSach = tatCa
        .slice(0, 10)
        .map((x) => `${x.code5} (${NHAN_TRANG_THAI_PHIEU[x.status]})`)
        .join(" · ");
      const them = tatCa.length > 10 ? ` và ${tatCa.length - 10} phiếu khác` : "";
      // `daBao` = số người VỪA được rung (`canRung`), không phải số người trong danh sách nhận.
      kq.daBao = (
        await notifyStaffChiTiet({
          userIds: nguoi,
          dedupeKey: khoaQuetSach(batDau),
          reopen: true,
          title: `Đối soát thẻ cuối ngày: ${tatCa.length} phiếu vừa được ghi nhận muộn`,
          body:
            `Mã ${danhSach}${them}. ` +
            (kq.conMoHomNay > 0
              ? `Còn ${kq.conMoHomNay} phiếu thu thẻ hôm nay chưa thấy giao dịch — kiểm đã nhập file Techcombank hôm nay chưa.`
              : "Không còn phiếu thu thẻ nào của hôm nay đang chờ."),
          href: `/bien-dong-so-du/nhat-ky-pos?nguon=QUET_SACH&tu=${ngay}&den=${ngay}`,
        })
      ).canRung.length;
    }
  }
  return kq;
}

/**
 * Phiếu được QUÉT SẠCH ghi nhận trong NGÀY VN `ngay` (mọi lượt trong ngày) — đọc nhật ký kiểm (`statusSau`
 * ∈ đã ghi nhận). Quét sạch chỉ kiểm phiếu MỞ / HET_HAN nên `statusSau` đã ghi nhận nghĩa là CHÍNH lượt đó
 * chuyển trạng thái. Hợp thêm `lanNay` (ghi nhật ký nuốt lỗi — U4 — không được làm mất phiếu khỏi chuông).
 * Mỗi phiếu một dòng, trạng thái của lượt MUỘN nhất, xếp theo lần đầu được ghi nhận.
 */
async function phieuGhiNhanTrongNgay(
  ngay: string,
  lanNay: KetQuaQuetSach["ghiNhan"],
): Promise<{ intentId: string; code5: string; status: PosIntentStatus }[]> {
  const nk = await db.posCheckLog.findMany({
    where: {
      triggeredBy: "QUET_SACH",
      statusSau: { in: [...DA_GHI_NHAN] },
      createdAt: { gte: dauNgayTuChuoi(ngay), lt: dauNgayTuChuoi(congNgay(ngay, 1)) },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { intentId: true, statusSau: true, intent: { select: { code5: true } } },
  });
  const theoPhieu = new Map<string, { intentId: string; code5: string; status: PosIntentStatus }>();
  for (const d of nk) {
    if (d.statusSau) theoPhieu.set(d.intentId, { intentId: d.intentId, code5: d.intent.code5, status: d.statusSau });
  }
  for (const x of lanNay) theoPhieu.set(x.intentId, x);
  return [...theoPhieu.values()];
}
