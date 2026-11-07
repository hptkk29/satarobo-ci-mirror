import "server-only";
// lib/payments/pos/nhat-ky-doc.ts — NẠP dữ liệu màn "Nhật ký kiểm thẻ POS" (GĐ2 POS). Thiết kế:
// docs/pos-gd2-thiet-ke.md §7.3.
//
// NHẬN `sdb` (scopedDb của người xem) — không import `@/lib/db`: `PosCheckLog` ∈ SCOPED_MODELS (prefix
// `payments:`) nên `findMany` + `groupBy` tự lọc theo cơ sở người xem được thấy (`[POS2-NK-03]`). Kế toán HO
// (neo HO) thấy mọi cơ sở; vai cơ sở nào sau này được cấp `payments:import-pos` chỉ thấy cơ sở mình.
// Một lô `Promise.all` — dòng (≤ 500, mới nhất trước) + đếm theo kết quả + đếm theo nguồn.
import type { PosCheckLogKind, PosCheckTrigger, PosIntentStatus } from "@prisma/client";
import type { scopedDb } from "@/lib/db-scope";
import { gioVN } from "@/lib/format/thoi-gian-vn";
import { TRAN_DONG_NHAT_KY, whereNhatKy, type LocNhatKy } from "./nhat-ky-loc";

type Sdb = ReturnType<typeof scopedDb>;

export type DongNhatKyView = {
  id: string;
  /** ISO giờ VN (+07:00). */
  luc: string;
  centerId: string;
  intentId: string;
  code5: string;
  orderId: string;
  orderCode: string | null;
  nguon: PosCheckTrigger;
  ketQua: PosCheckLogKind;
  errorCode: string | null;
  durationMs: number;
  providerTxnId: string | null;
  statusSau: PosIntentStatus | null;
  /** Tên người bấm / nhập file; `null` ⇒ máy (poller · quét sạch · agent) hoặc tài khoản đã xoá. */
  nguoiBam: string | null;
};

export type DuLieuNhatKy = {
  dong: DongNhatKyView[];
  /** Tổng số lượt khớp bộ lọc (không bị trần cắt). */
  tong: number;
  theoKetQua: Partial<Record<PosCheckLogKind, number>>;
  theoNguon: Partial<Record<PosCheckTrigger, number>>;
  /** Số dòng chạm trần — màn nói "chỉ hiện 500 lượt mới nhất". */
  chamTran: boolean;
  /**
   * DẢI TỔNG (các con số cạnh nút lọc nhanh): đếm theo bộ lọc ĐÃ BỎ vế kết quả. Mỗi nút lọc nhanh THAY
   * `ketQua` và giữ mọi thứ khác ⇒ số cạnh nút phải đếm đúng tập nút đó sẽ ra (luật 12). Bản trước đếm
   * TRONG bộ lọc kết quả đang áp ⇒ đang lọc "Lỗi kết nối" thì "Đã thu 0" mà bấm ra w dòng, và "Bấm dồn"
   * luôn 100% / 0% (rà đối kháng 06/10/2026). Không lọc kết quả ⇒ trùng `tong` / `theoKetQua`.
   */
  daiTong: { tong: number; theoKetQua: Partial<Record<PosCheckLogKind, number>> };
};

export async function docNhatKy(sdb: Sdb, loc: LocNhatKy): Promise<DuLieuNhatKy> {
  const where = whereNhatKy(loc);
  const [ds, nhomKetQua, nhomNguon, nhomDaiTong] = await Promise.all([
    sdb.posCheckLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TRAN_DONG_NHAT_KY,
      select: {
        id: true,
        createdAt: true,
        centerId: true,
        intentId: true,
        triggeredBy: true,
        kind: true,
        errorCode: true,
        durationMs: true,
        providerTxnId: true,
        statusSau: true,
        createdBy: { select: { name: true } },
        intent: {
          select: { code5: true, paymentBill: { select: { orderId: true, order: { select: { code: true } } } } },
        },
      },
    }),
    sdb.posCheckLog.groupBy({ by: ["kind"], where, _count: { _all: true } }),
    sdb.posCheckLog.groupBy({ by: ["triggeredBy"], where, _count: { _all: true } }),
    // Dải tổng: bỏ vế kết quả (chỉ cần câu thứ hai khi đang lọc kết quả). Vẫn qua `sdb` ⇒ vẫn theo phạm vi.
    loc.ketQua
      ? sdb.posCheckLog.groupBy({ by: ["kind"], where: whereNhatKy({ ...loc, ketQua: null }), _count: { _all: true } })
      : null,
  ]);

  const demTheoKetQua = (ds: typeof nhomKetQua) => {
    const m: Partial<Record<PosCheckLogKind, number>> = {};
    for (const n of ds) m[n.kind] = n._count._all;
    return { theoKetQua: m, tong: ds.reduce((s, n) => s + n._count._all, 0) };
  };
  const { theoKetQua, tong } = demTheoKetQua(nhomKetQua);
  const theoNguon: Partial<Record<PosCheckTrigger, number>> = {};
  for (const n of nhomNguon) theoNguon[n.triggeredBy] = n._count._all;
  const daiTong = nhomDaiTong ? demTheoKetQua(nhomDaiTong) : { theoKetQua, tong };

  return {
    dong: ds.map((d) => ({
      id: d.id,
      luc: gioVN(d.createdAt),
      centerId: d.centerId,
      intentId: d.intentId,
      code5: d.intent.code5,
      orderId: d.intent.paymentBill.orderId,
      orderCode: d.intent.paymentBill.order?.code ?? null,
      nguon: d.triggeredBy,
      ketQua: d.kind,
      errorCode: d.errorCode,
      durationMs: d.durationMs,
      providerTxnId: d.providerTxnId,
      statusSau: d.statusSau,
      nguoiBam: d.createdBy?.name ?? null,
    })),
    tong,
    theoKetQua,
    theoNguon,
    chamTran: tong > ds.length,
    daiTong,
  };
}
