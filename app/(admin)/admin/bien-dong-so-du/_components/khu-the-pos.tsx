// Khu "Giao dịch thẻ POS cần xử lý" trên `/bien-dong-so-du` (docs/pos-the-smartpos.md).
//
// Server component — chỉ HIỂN THỊ. Ba mảnh, và cố ý KHÔNG lặp lại thứ bảng giao dịch ở trên đã có:
//   (a) CẢNH BÁO chưa đóng, HAI loại (`loaiCanhBaoPos`) — câu chữ phải nói đúng loại:
//       · "Hủy sau khi đã ghi nhận": tiền đã vào sổ, giao dịch thẻ đã bị hủy/hoàn. Tầng POS KHÔNG
//         BAO GIỜ tự đảo bút toán; kế toán gỡ gắn / hoàn bằng luồng hiện có rồi đóng cảnh báo.
//       · "Hoàn một phần" (Q-G 30/09/2026): bị hoàn một phần TRƯỚC khi ghi nhận ⇒ hệ thống đã đưa
//         giao dịch ra khỏi hàng chờ để không ai gắn tay SỐ GỘP; Kế toán HO ghi số ròng bằng luồng
//         điều chỉnh rồi đóng cảnh báo. Bản đầu gọi chung là "bị hủy sau khi đã ghi nhận" — sai
//         với loại này (tiền CHƯA vào sổ).
//   (b) Dòng CAN_XU_LY KHÔNG có `BankTransaction` (dòng hủy chưa thấy gốc, số tiền ≤ 0…) — những
//       dòng này không có chỗ nào khác để hiện. Dòng CAN_XU_LY CÓ tiền đã nằm trong bảng
//       giao dịch (UNMATCHED + `unmatchedNote`) và gắn tay bằng đúng luồng chuyển khoản — không
//       làm nút thứ hai.
//   (c) 10 lô import gần nhất.
//
// Dữ liệu chủ thẻ: CHỈ số thẻ đã che + loại thẻ. Tên chủ thẻ không tồn tại trong hệ thống.

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { ngayGioVN } from "@/lib/format/date";
import { tieuDeCanhBaoPos, type LoaiCanhBaoPos } from "@/lib/payments/pos/phan-loai-pos";
import type { TrangThaiLoHienThi } from "@/lib/payments/pos/trang-thai-lo";
import { DongCanhBaoPos } from "./dong-canh-bao-pos";

/** `orderId: null` = đơn ở cơ sở NGOÀI tầm nhìn người xem — chỉ in số tiền, không mã, không tên. */
/** `khoa` = `paymentRequestId` của phân bổ — duy nhất trong một giao dịch, dùng làm key React. */
export type DonDaVao = {
  khoa: string;
  orderId: string | null;
  orderCode: string;
  customerName: string | null;
  amount: number;
};

export type CanhBaoPosItem = {
  id: string;
  maGiaoDich: string;
  thoiGian: Date;
  soTien: number;
  maThietBi: string | null;
  soTheMasked: string | null;
  loaiThe: string | null;
  matchReason: string | null;
  /** `loaiCanhBaoPos(matchReason)` — quyết định câu chữ của dòng + tiêu đề khu. */
  loai: LoaiCanhBaoPos;
  /** Trạng thái `BankTransaction` HIỆN TẠI — MATCHED nghĩa là tiền vẫn còn trong sổ. */
  trangThaiSo: string | null;
  donDaVao: DonDaVao[];
};

export type DongPosItem = {
  id: string;
  maGiaoDich: string;
  maGiaoDichGoc: string | null;
  loaiGiaoDich: string;
  trangThaiHoanHuy: string | null;
  thoiGian: Date;
  soTien: number;
  dienGiai: string;
  maThietBi: string | null;
  maQuay: string | null;
  soTheMasked: string | null;
  loaiThe: string | null;
  matchStatus: "TU_KHOP" | "CAN_XU_LY" | "BO_QUA";
  matchReason: string | null;
};

export type LoImportItem = {
  id: string;
  tenFile: string;
  nguoiNhap: string;
  luc: Date;
  soDong: number;
  soMoi: number;
  soCapNhat: number;
  soTuKhop: number;
  soCanXuLy: number;
  soBoQua: number;
  soLoi: number;
  /** Đã SUY sẵn ở trang (`trangThaiHienThiLo`) — kể cả "Dừng giữa chừng" của lượt bỏ dở. */
  trangThai: TrangThaiLoHienThi;
};

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

const NHAN_CANH_BAO: Record<CanhBaoPosItem["loai"], string> = {
  HUY_SAU_GHI_NHAN: "Hủy sau khi đã ghi nhận",
  HOAN_MOT_PHAN: "Hoàn một phần",
};

const TRANG_THAI_UI: Record<DongPosItem["matchStatus"], { label: string; cls: string }> = {
  CAN_XU_LY: { label: "Cần xử lý", cls: "bg-state-warning-soft text-state-warning-ink" },
  BO_QUA: { label: "Bỏ qua", cls: "bg-muted text-muted-foreground" },
  TU_KHOP: { label: "Tự khớp", cls: "bg-state-success-soft text-state-success-ink" },
};

const TRANG_THAI_LO_UI: Record<TrangThaiLoHienThi["loai"], string> = {
  XONG: "bg-state-success-soft text-state-success-ink",
  DANG_NHAP: "bg-state-info-soft text-state-info-ink",
  DUNG: "bg-state-warning-soft text-state-warning-ink",
};

const TH = "whitespace-nowrap px-3 py-2";
/** Cột số của bảng lịch sử import: hẹp hơn để cả bảng vừa khung 1280px không cuộn ngang. */
const TH_SO = "whitespace-nowrap px-2.5 py-2 text-right";
const TD_SO = "whitespace-nowrap px-2.5 py-2 align-top text-right tabular-nums";
const TD = "px-3 py-2 align-top";

function The({ loaiThe, soTheMasked }: { loaiThe: string | null; soTheMasked: string | null }) {
  if (!loaiThe && !soTheMasked) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="whitespace-nowrap">
      {loaiThe && <span className="text-foreground">{loaiThe}</span>}
      {loaiThe && soTheMasked && " · "}
      {soTheMasked && <span className="font-mono text-muted-foreground">{soTheMasked}</span>}
    </span>
  );
}

export function KhuThePos({
  canhBao,
  dong,
  lo,
  hienBoQua,
  soBoQua,
  hrefBatTatBoQua,
  hrefCanXuLyThe,
  canDongCanhBao,
}: {
  canhBao: CanhBaoPosItem[];
  dong: DongPosItem[];
  lo: LoImportItem[];
  hienBoQua: boolean;
  soBoQua: number;
  hrefBatTatBoQua: string;
  /** Link sang bảng trên, lọc sẵn Thẻ POS · Cần xử lý. */
  hrefCanXuLyThe: string;
  /** `payments:import-pos` — cùng quyền `dongCanhBaoHuyPosAction` hỏi. */
  canDongCanhBao: boolean;
}) {
  return (
    <section id="the-pos" className="mt-10 scroll-mt-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-border pb-2">
        <div className="min-w-0 flex-1 basis-[28rem]">
          <h2 className="text-lg font-semibold text-foreground">Giao dịch thẻ POS cần xử lý</h2>
          <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
            Giao dịch thẻ <b>có tiền</b> nhưng chưa khớp được phiếu đã nằm trong bảng trên —{" "}
            <Link href={hrefCanXuLyThe} scroll={false} className="font-medium text-state-info-ink hover:underline">
              lọc Thẻ POS · Cần xử lý
            </Link>{" "}
            rồi gắn tay như chuyển khoản. Mục này chỉ chứa những thứ bảng trên không chứa được.
          </p>
        </div>
        {(soBoQua > 0 || hienBoQua) && (
          <Link
            href={hrefBatTatBoQua}
            scroll={false}
            className="shrink-0 whitespace-nowrap rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted"
          >
            {hienBoQua ? "Ẩn dòng bỏ qua" : `Hiện cả dòng bỏ qua (${fmt(soBoQua)})`}
          </Link>
        )}
      </div>

      {/* ── (a) Cảnh báo hủy sau ghi nhận ─────────────────────────────────── */}
      {canhBao.length > 0 && (
        <div className="mb-6 overflow-hidden rounded-lg border border-state-danger">
          <div className="flex items-start gap-2 bg-state-danger-soft px-3 py-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-state-danger-ink" aria-hidden />
            <div className="text-sm text-state-danger-ink">
              <p className="font-semibold">{tieuDeCanhBaoPos(canhBao)}</p>
              {canhBao.some((c) => c.loai === "HUY_SAU_GHI_NHAN") && (
                <p className="mt-0.5 text-xs leading-relaxed">
                  <b>Hủy sau khi đã ghi nhận:</b> tiền đã vào sổ nhưng giao dịch thẻ đã bị hủy/hoàn — gỡ
                  gắn / hoàn bằng luồng hiện có rồi đóng cảnh báo. Hệ thống không tự đảo bút toán.
                </p>
              )}
              {canhBao.some((c) => c.loai === "HOAN_MOT_PHAN") && (
                <p className="mt-0.5 text-xs leading-relaxed">
                  <b>Hoàn một phần:</b> giao dịch bị hoàn một phần trước khi ghi nhận — hệ thống đã đưa nó
                  ra khỏi hàng chờ để không ai gắn tay số gộp. Kế toán Hội sở ghi số ròng bằng luồng
                  điều chỉnh rồi đóng cảnh báo.
                </p>
              )}
            </div>
          </div>
          <PhanTrangBang cuonNgang tenDonVi="cảnh báo" khoaGhiNho="bien-dong-pos-canh-bao">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="border-t border-state-danger bg-muted text-left text-xs font-medium uppercase text-muted-foreground">
                <tr>
                  <th className={`${TH} w-36`}>Thời gian quẹt</th>
                  <th className={`${TH} w-32 text-right`}>Số tiền</th>
                  <th className={TH}>Giao dịch thẻ</th>
                  <th className={TH}>Tiền đã vào</th>
                  <th className={TH}>Lý do</th>
                  {canDongCanhBao && <th className={`${TH} w-40`}>Xử lý</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {canhBao.map((c) => (
                  <tr key={c.id}>
                    <td className={`${TD} whitespace-nowrap text-xs text-muted-foreground`}>{ngayGioVN(c.thoiGian)}</td>
                    <td className={`${TD} whitespace-nowrap text-right font-semibold tabular-nums`}>{fmt(c.soTien)}đ</td>
                    <td className={`${TD} text-xs`}>
                      <div className="font-mono text-foreground">{c.maGiaoDich}</div>
                      <div className="mt-0.5 text-muted-foreground">
                        <The loaiThe={c.loaiThe} soTheMasked={c.soTheMasked} />
                        {c.maThietBi && <span className="whitespace-nowrap"> · máy {c.maThietBi}</span>}
                      </div>
                    </td>
                    <td className={`${TD} text-xs`}>
                      {c.donDaVao.length === 0 && c.loai === "HOAN_MOT_PHAN" && c.trangThaiSo !== "MATCHED" ? (
                        <span className="text-state-danger-ink">Chưa vào sổ — ghi số ròng bằng luồng điều chỉnh</span>
                      ) : c.donDaVao.length === 0 ? (
                        <span className="text-state-success-ink">
                          {c.trangThaiSo === "UNMATCHED"
                            ? "Đã gỡ khỏi đơn — có thể đóng cảnh báo"
                            : c.trangThaiSo === "IGNORED"
                              ? "Đã bỏ qua — có thể đóng cảnh báo"
                              : "—"}
                        </span>
                      ) : (
                        <ul className="space-y-0.5">
                          {c.donDaVao.map((d) => (
                            <li key={d.khoa} className="whitespace-nowrap">
                              {d.orderId ? (
                                <Link href={`/orders/${d.orderId}`} className="font-medium text-state-info-ink hover:underline">
                                  {d.orderCode}
                                </Link>
                              ) : (
                                <span className="font-medium text-foreground">{d.orderCode}</span>
                              )}
                              <span className="text-muted-foreground">
                                {" "}
                                · <b className="tabular-nums">{fmt(d.amount)}đ</b>
                                {d.customerName && ` · ${d.customerName}`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className={`${TD} max-w-[240px] text-xs text-state-danger-ink`}>
                      <span className="mb-0.5 inline-block whitespace-nowrap rounded bg-state-danger-soft px-1.5 py-0.5 font-semibold">
                        {NHAN_CANH_BAO[c.loai]}
                      </span>
                      <div>{c.matchReason ?? "—"}</div>
                    </td>
                    {canDongCanhBao && (
                      <td className={TD}>
                        <DongCanhBaoPos id={c.id} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}

      {/* ── (b) Dòng thẻ không có giao dịch tiền ──────────────────────────── */}
      {dong.length === 0 ? (
        <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {hienBoQua
            ? "Không có giao dịch thẻ nào cần xử lý hay đã bỏ qua ngoài bảng trên."
            : "Không có giao dịch thẻ nào cần xử lý ngoài bảng trên."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <PhanTrangBang cuonNgang tenDonVi="giao dịch thẻ" khoaGhiNho="bien-dong-pos-can-xu-ly">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-muted text-left text-xs font-medium uppercase text-muted-foreground">
                <tr>
                  <th className={`${TH} w-36`}>Thời gian quẹt</th>
                  <th className={`${TH} w-32 text-right`}>Số tiền</th>
                  <th className={TH}>Giao dịch thẻ</th>
                  <th className={TH}>Máy · Thẻ</th>
                  <th className={TH}>Ghi chú trên máy</th>
                  <th className={`${TH} w-56`}>Kết quả</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dong.map((d) => {
                  const ui = TRANG_THAI_UI[d.matchStatus];
                  const laThanhToan = d.loaiGiaoDich.trim() === "Thanh toán";
                  return (
                    <tr key={d.id} className={d.matchStatus === "CAN_XU_LY" ? "bg-state-warning-soft/40" : undefined}>
                      <td className={`${TD} whitespace-nowrap text-xs text-muted-foreground`}>{ngayGioVN(d.thoiGian)}</td>
                      <td className={`${TD} whitespace-nowrap text-right font-semibold tabular-nums`}>{fmt(d.soTien)}đ</td>
                      <td className={`${TD} text-xs`}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-foreground">{d.maGiaoDich}</span>
                          {!laThanhToan && (
                            <span className="inline-flex whitespace-nowrap rounded-full bg-state-danger-soft px-2 py-0.5 text-[11px] font-medium text-state-danger-ink">
                              {d.loaiGiaoDich.trim() || "Hủy/hoàn"}
                            </span>
                          )}
                        </div>
                        {d.maGiaoDichGoc && (
                          <div className="mt-0.5 text-muted-foreground">
                            gốc <span className="font-mono">{d.maGiaoDichGoc}</span>
                          </div>
                        )}
                        {d.trangThaiHoanHuy && <div className="mt-0.5 text-muted-foreground">{d.trangThaiHoanHuy}</div>}
                      </td>
                      <td className={`${TD} text-xs text-muted-foreground`}>
                        <div className="whitespace-nowrap">
                          {d.maThietBi ? `máy ${d.maThietBi}` : "(không rõ máy)"}
                          {d.maQuay && ` · quầy ${d.maQuay}`}
                        </div>
                        <div className="mt-0.5">
                          <The loaiThe={d.loaiThe} soTheMasked={d.soTheMasked} />
                        </div>
                      </td>
                      <td className={TD}>
                        <div className="max-w-[200px] truncate font-mono text-xs text-foreground" title={d.dienGiai}>
                          {d.dienGiai || "—"}
                        </div>
                      </td>
                      <td className={TD}>
                        <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${ui.cls}`}>
                          {ui.label}
                        </span>
                        {d.matchReason && (
                          <div
                            className={`mt-1 text-xs ${d.matchStatus === "CAN_XU_LY" ? "text-state-warning-ink" : "text-muted-foreground"}`}
                          >
                            {d.matchReason}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}

      {/* ── (c) Lịch sử import ─────────────────────────────────────────────── */}
      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-foreground">10 lần import gần nhất</h3>
        {lo.length === 0 ? (
          <p className="rounded-lg border border-border px-3 py-4 text-center text-sm text-muted-foreground">
            Chưa import file giao dịch thẻ nào.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <PhanTrangBang cuonNgang tenDonVi="lần import" khoaGhiNho="bien-dong-pos-lo">
              {/* Người nhập xếp dưới giờ, Mới / Cập nhật xếp dưới số dòng: bản 10 cột ngang đẩy
                  "Bỏ qua" / "Lỗi" ra sau thanh cuộn ở 1280px (audit 29/09). */}
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted text-left text-xs font-medium uppercase text-muted-foreground">
                  <tr>
                    <th className={`${TH} w-40`}>Lúc · Người nhập</th>
                    <th className={TH}>File</th>
                    <th className={TH}>Trạng thái</th>
                    <th className={TH_SO}>Dòng</th>
                    <th className={TH_SO}>Tự khớp</th>
                    <th className={TH_SO}>Cần xử lý</th>
                    <th className={TH_SO}>Bỏ qua</th>
                    <th className={TH_SO}>Lỗi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lo.map((l) => (
                    <tr key={l.id}>
                      <td className={TD}>
                        <div className="whitespace-nowrap text-xs tabular-nums text-foreground">{ngayGioVN(l.luc)}</div>
                        <div className="mt-0.5 max-w-[160px] truncate text-xs text-muted-foreground" title={l.nguoiNhap}>
                          {l.nguoiNhap}
                        </div>
                      </td>
                      <td className={TD}>
                        <div className="max-w-[200px] truncate text-xs text-foreground" title={l.tenFile}>
                          {l.tenFile}
                        </div>
                      </td>
                      <td className={TD}>
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TRANG_THAI_LO_UI[l.trangThai.loai]}`}
                        >
                          {l.trangThai.nhan}
                        </span>
                        {l.trangThai.chiTiet && (
                          <div className="mt-0.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                            {l.trangThai.chiTiet}
                          </div>
                        )}
                      </td>
                      <td className={TD_SO}>
                        <div className="text-foreground">{fmt(l.soDong)}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {fmt(l.soMoi)} mới · {fmt(l.soCapNhat)} cập nhật
                        </div>
                      </td>
                      <td className={`${TD_SO} ${l.soTuKhop > 0 ? "font-semibold text-state-success-ink" : "text-muted-foreground"}`}>
                        {fmt(l.soTuKhop)}
                      </td>
                      <td className={`${TD_SO} ${l.soCanXuLy > 0 ? "font-semibold text-state-warning-ink" : "text-muted-foreground"}`}>
                        {fmt(l.soCanXuLy)}
                      </td>
                      <td className={`${TD_SO} text-muted-foreground`}>{fmt(l.soBoQua)}</td>
                      <td className={`${TD_SO} ${l.soLoi > 0 ? "font-semibold text-state-danger-ink" : "text-muted-foreground"}`}>
                        {fmt(l.soLoi)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PhanTrangBang>
          </div>
        )}
      </div>
    </section>
  );
}
