// lib/payments/pos/dong-the-chua-ket-luan.ts — "DÒNG THẺ MANG MÃ MÀ CHƯA THÀNH GIAO DỊCH" (Việc 4 · rà đối kháng 09/10/2026).
//
// Cổng của nút "Huỷ phiếu thẻ" cần BIẾT khách có thể đã quẹt hay chưa. Hai nguồn đã có:
//   · kết quả lượt kiểm gần nhất ĐÃ LƯU (`lastResultKind` + câu) — nhưng nó chỉ đúng tại lúc kiểm, và với chế độ FILE lượt
//     kiểm cuối của một lượt nhập chạy MỘT lần ở cuối cả lượt (cửa sổ dài hơn một request);
//   · giao dịch UNMATCHED mang mã (`maCoGiaoDichChoTay`, `the-dang-mo.ts`).
// Còn một lớp MÙ cả hai: dòng thẻ mang mã nằm trong DB mà KHÔNG thành giao dịch — "Đang xử lý"/chữ lạ (`phanLoaiDongPos`
// luật 1 ⇒ BO_QUA, không sinh `BankTransaction`), "Thành công" số ≤ 0 (luật 4, CAN_XU_LY không giao dịch).
// Dòng đã VỀ mà lượt kiểm lưu trước đó vẫn nói "Chưa thấy…" ⇒ sale huỷ phiếu thẻ, rồi "Huỷ phiếu" (gộp) phát mã/QR mới, dòng
// treo thành "Thành công" ⇒ khách bị trừ thẻ VÀ trả QR (đo: tests/finance `[HN4-DB-16a]`).
//
// Vị từ ghép từ CHÍNH các hàm `phan-loai-pos.ts` mà provider (`provider/doc-du-lieu.ts`) dùng cho luật 4/5 của nó — không có
// bản thứ hai của luật "treo": đổi định nghĩa "thất bại"/"hủy toàn phần" ở một chỗ thì cả provider lẫn cổng huỷ đổi theo.
//
// Tệp LÁ, thuần (không import `@/lib/db`): hàm đọc nhận `client` (db hoặc tx) như `maCoGiaoDichChoTay`.
import type { Prisma } from "@prisma/client";
import { huyDaKetLuanTrenDong, laLoaiThanhToan, maTrangThaiPos } from "./phan-loai-pos";
import { tachMaPos } from "./tach-ma-pos";

type Tx = Prisma.TransactionClient;

/** Phần của một dòng `PosCardTransaction` mà vị từ đọc — `select` bên dưới khớp đúng hình này. */
export type DongTheDeXet = {
  dienGiai: string;
  loaiGiaoDich: string;
  trangThai: string;
  trangThaiHoanHuy: string | null;
  matchStatus: string;
  matchReason: string | null;
  bankTransactionId: string | null;
};

/** `maTrangThaiPos("Thất bại")` — chữ DUY NHẤT được gọi là thất bại (cùng luật 5 của provider). */
const MA_THAT_BAI = "THAT_BAI";

/**
 * Dòng này có làm "khách đã quẹt hay chưa" trở nên CHƯA NGÃ NGŨ không (mà các cổng khác không thấy)?
 *   · đã thành giao dịch UNMATCHED / MATCHED ⇒ KHÔNG (hàng chờ tay và cổng "phiếu gộp đã đóng" đã nói);
 *   · dòng Hủy/Hoàn (loại ≠ Thanh toán) ⇒ KHÔNG (dòng GỐC mới nói về tiền);
 *   · "Thất bại" · hủy TOÀN PHẦN ⇒ KHÔNG (không còn tiền bị trừ);
 *   · đã thành giao dịch IGNORED ⇒ KHÔNG: đó là QUYẾT ĐỊNH của kế toán ("Bỏ qua" ở hàng chờ — ca `[HN4-DB-03]` đối chứng của
 *     CO_GIAO_DICH_CHO_TAY ghim: gỡ khỏi hàng chờ thì phiếu thẻ huỷ được) hoặc kết luận hủy/hoàn của tầng nhập lô. Hoàn MỘT PHẦN
 *     (Q-G, giao dịch IGNORED + cảnh báo) KHÔNG phân biệt được với "kế toán bỏ qua" từ chính dòng — CHƯA bao quát (docs §6.14);
 *   · còn lại (treo · chữ lạ · "Thành công" mà không thành giao dịch) ⇒ CÓ — fail-closed.
 */
export function laDongTheChuaKetLuan(r: DongTheDeXet, code5: string): boolean {
  if (!tachMaPos(r.dienGiai).includes(code5)) return false;
  if (!laLoaiThanhToan(r.loaiGiaoDich)) return false;
  if (huyDaKetLuanTrenDong(r) === "TOAN_PHAN") return false;
  if (maTrangThaiPos(r.trangThai) === MA_THAT_BAI) return false;
  return r.bankTransactionId === null;
}

/** Trần số dòng kéo về mỗi lượt — bảng nhỏ; mã lạ không kéo cả bảng (cùng `take: 200` của `maCoGiaoDichChoTay`). */
const TRAN_DONG = 200;

/**
 * Mã nào trong `phieu` còn dòng thẻ mang mã mà CHƯA NGÃ NGŨ (xem đầu tệp), quẹt từ `tu` trở đi. `tu` = CÙNG mốc `mocChoTay`
 * (`the-dang-mo.ts`) mà `maCoGiaoDichChoTay` dùng — tính trên MỌI phiếu thẻ của phiếu gộp, không riêng phiếu đang xét.
 *
 * KHÔNG scope (câu tra để CHẶN — CLAUDE.md "PaymentMethod"): quẹt ở máy cơ sở khác vẫn là tiền đã trừ thẻ khách.
 */
export async function maCoDongTheChuaKetLuan(
  client: Pick<Tx, "posCardTransaction">,
  phieu: readonly { code5: string; tu: Date }[],
): Promise<Set<string>> {
  if (phieu.length === 0) return new Set();
  const rows = await client.posCardTransaction.findMany({
    where: {
      OR: phieu.map((x) => ({
        dienGiai: { contains: x.code5, mode: "insensitive" as const },
        thoiGianGiaoDich: { gte: x.tu },
      })),
      // CHƯA thành giao dịch. UNMATCHED / MATCHED đã có chỗ khác nói; IGNORED là quyết định của kế toán (xem vị từ).
      bankTransactionId: null,
    },
    select: {
      dienGiai: true,
      loaiGiaoDich: true,
      trangThai: true,
      trangThaiHoanHuy: true,
      matchStatus: true,
      matchReason: true,
      bankTransactionId: true,
      thoiGianGiaoDich: true,
    },
    take: TRAN_DONG,
  });
  const co = new Set<string>();
  for (const x of phieu) {
    if (
      rows.some(
        (r) =>
          r.thoiGianGiaoDich.getTime() >= x.tu.getTime() &&
          laDongTheChuaKetLuan(r, x.code5),
      )
    ) {
      co.add(x.code5);
    }
  }
  return co;
}
