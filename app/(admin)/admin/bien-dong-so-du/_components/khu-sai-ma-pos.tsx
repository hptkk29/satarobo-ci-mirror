// Khối "Sale báo nhập sai mã trên máy POS" ở ĐẦU khu "Giao dịch thẻ POS cần xử lý" của `/bien-dong-so-du` (Việc 3 · 09/10/2026).
// Thiết kế: docs/pos-hai-nut-khai-may.md §5.3.9.
//
// Server component — chỉ HIỂN THỊ (nút ở `NutXuLySaiMa`). Hai bảng, mỗi bảng bọc `PhanTrangBang cuonNgang` (cuộn TRONG khung — trang
// không tràn ở 375px):
//   (a) VIỆC CẦN LÀM: yêu cầu đang chờ duyệt, hoặc đang ghi, hoặc KẸT ≥ 2 phút (nút "Thử lại ghi nhận"). Đây là khối đầu tiên của khu
//       thẻ POS dành cho giao dịch CÓ TIỀN — trước đây khu này chỉ nạp dòng không có giao dịch (chú thích `khu-the-pos.tsx`).
//   (b) HẬU KIỂM 7 NGÀY: chỉ đọc, ≤ 20 dòng — đã ghi nhận (kèm chip "Sale tự xác nhận" cho bậc không qua kế toán: bậc đó ghi tiền mà
//       không ai duyệt, nên phần bù là NHÌN LẠI được), bị từ chối, đã xử lý ở nơi khác.
//
// ⚠️ CỘT "XỬ LÝ" DÍNH MÉP PHẢI (smoke 1280px/375px 09/10/2026): bản đầu không dính — ở 1280px bảng rộng hơn khung nên nút Duyệt/Từ chối
// nằm sau thanh cuộn ngang, ở 375px chỉ thấy hai cột đầu. Cùng khuôn với bảng giao dịch phía trên (`bank-txn-client.tsx`): ô dính cần
// nền ĐỤC — dòng "chờ" tô `warning-soft/40` (trong suốt) nên ô dính phủ đúng lớp màu đó lên `bg-muted`.
// Cột "Vì sao cần kế toán" dùng NHÃN NGẮN (`nhanLyDo`), không câu đầy đủ của sale: câu đầy đủ làm mỗi dòng cao 5–6 dòng chữ.
//
// Dữ liệu chủ thẻ: CHỈ 4 số cuối thẻ. Ghi chú là chữ người gõ — ĐÃ `lamSachGhiChuHienThi` ở loader, render bằng text node.
// Đơn ngoài tầm nhìn người xem ⇒ "Đơn ở cơ sở khác", không mã/tên/link (loader đã che).
import Link from "next/link";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { ngayGioVN } from "@/lib/format/date";
import { cachXetHauKiem, lamSachGhiChuHienThi, nhanLyDo, type HieuLucSaiMa } from "@/lib/payments/pos/sai-ma";
import type { DongSaiMa, HangChoSaiMa } from "@/lib/payments/pos/sai-ma-doc";
import { NutXuLySaiMa } from "./nut-xu-ly-sai-ma";

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

const TH = "whitespace-nowrap px-3 py-2";
const TD = "px-3 py-2 align-top";
const O_DINH = "sticky right-0 z-10 border-l border-border/60";
/** Nền ĐỤC cho ô dính trên dòng tô `warning-soft/40` — cùng chuỗi với `NEN_O_DINH_CAN_XU_LY` của `bank-txn-client.tsx`. */
const NEN_O_DINH_CHO =
  "bg-muted [background-image:linear-gradient(color-mix(in_oklab,var(--color-state-warning-soft)_40%,transparent),color-mix(in_oklab,var(--color-state-warning-soft)_40%,transparent))]";

const NHAN_HIEU_LUC: Record<HieuLucSaiMa, { label: string; cls: string }> = {
  CHO_DUYET: { label: "Chờ duyệt", cls: "bg-state-warning-soft text-state-warning-ink" },
  DANG_GHI: { label: "Đang ghi", cls: "bg-state-info-soft text-state-info-ink" },
  KET: { label: "Kẹt — thử lại", cls: "bg-state-danger-soft text-state-danger-ink" },
  DA_GHI_NHAN: { label: "Đã ghi nhận", cls: "bg-state-success-soft text-state-success-ink" },
  TU_CHOI: { label: "Đã từ chối", cls: "bg-muted text-muted-foreground" },
  DA_XU_LY_NGOAI: { label: "Đã xử lý ở nơi khác", cls: "bg-muted text-muted-foreground" },
};

function Chip({ hieuLuc }: { hieuLuc: HieuLucSaiMa }) {
  const ui = NHAN_HIEU_LUC[hieuLuc];
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${ui.cls}`}>{ui.label}</span>
  );
}

function CotGuiLuc({ d }: { d: DongSaiMa }) {
  return (
    <td className={TD}>
      <div className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{ngayGioVN(d.guiLuc)}</div>
      <div className="mt-0.5 max-w-[120px] truncate text-xs text-foreground" title={d.nguoiGui}>
        {d.nguoiGui}
      </div>
    </td>
  );
}

function CotDon({ d }: { d: DongSaiMa }) {
  return (
    <td className={TD}>
      <div className="whitespace-nowrap text-xs">
        {d.orderId ? (
          <Link href={`/orders/${d.orderId}`} className="font-medium text-state-info-ink hover:underline">
            {d.maDon}
          </Link>
        ) : (
          <span className="font-medium text-foreground">{d.maDon}</span>
        )}
      </div>
      <div className="mt-0.5 whitespace-nowrap text-xs text-muted-foreground">
        Phiếu thẻ <span className="font-mono">{d.maPhieu}</span>
      </div>
    </td>
  );
}

function CotGiaoDich({ d }: { d: DongSaiMa }) {
  return (
    <td className={TD}>
      <div className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        {d.gioQuet ? ngayGioVN(d.gioQuet) : "—"}
      </div>
      <div className="mt-0.5 whitespace-nowrap font-semibold tabular-nums">{fmt(d.soTien)}đ</div>
      <div className="mt-0.5 whitespace-nowrap text-xs text-muted-foreground">
        {d.soTheCuoi ? <>thẻ …{d.soTheCuoi}</> : "—"}
        {d.tenMay && <> · máy {d.tenMay}</>}
      </div>
    </td>
  );
}

function CotGhiChu({ d }: { d: DongSaiMa }) {
  // Chữ NGƯỜI GÕ trên máy: loader đã làm sạch, ở đây làm sạch LẠI (idempotent) — chữ và `title` cùng một chuỗi, ≤ 120 ký tự + "…".
  const ghiChu = lamSachGhiChuHienThi(d.ghiChu);
  return (
    <td className={TD}>
      {ghiChu ? (
        <div className="line-clamp-3 max-w-[136px] break-words font-mono text-xs text-foreground" title={ghiChu}>
          {ghiChu}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">(để trống)</span>
      )}
    </td>
  );
}

export function KhuSaiMaPos({ hang, nguoiXemId }: { hang: HangChoSaiMa; nguoiXemId: string }) {
  if (hang.cho.length === 0 && hang.hauKiem.length === 0) return null;
  return (
    <div id="the-pos-sai-ma" className="mb-8 scroll-mt-6">
      <div className="mb-3 border-b border-border pb-2">
        <h3 className="text-base font-semibold text-foreground">Sale báo nhập sai mã trên máy POS</h3>
        <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
          Khách đã quẹt thành công nhưng ghi chú trên máy gõ sai mã. Sale chọn đúng giao dịch của khách; <b>Duyệt</b> ghi tiền vào đúng
          phiếu như khớp tự động, <b>Từ chối</b> trả giao dịch về hàng chờ để gắn tay. Người duyệt phải khác người gửi.
        </p>
      </div>

      {hang.cho.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-state-warning/40">
          <PhanTrangBang cuonNgang tenDonVi="yêu cầu" khoaGhiNho="bien-dong-pos-sai-ma">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-muted text-left text-xs font-medium uppercase text-muted-foreground">
                <tr>
                  <th className={`${TH} w-36`}>Gửi lúc · Người gửi</th>
                  <th className={`${TH} w-36`}>Đơn · Phiếu thẻ</th>
                  <th className={`${TH} w-44`}>Giao dịch</th>
                  <th className={`${TH} w-40`}>Ghi chú trên máy</th>
                  <th className={TH}>Vì sao cần kế toán</th>
                  <th className={`${O_DINH} ${TH} w-44 bg-muted`}>Xử lý</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {hang.cho.map((d) => (
                  <tr key={d.id} className="bg-state-warning-soft/40">
                    <CotGuiLuc d={d} />
                    <CotDon d={d} />
                    <CotGiaoDich d={d} />
                    <CotGhiChu d={d} />
                    <td className={TD}>
                      {d.lyDo.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <ul className="max-w-[240px] space-y-0.5 text-xs text-state-warning-ink">
                          {d.lyDo.map((ly) => (
                            <li key={ly}>{nhanLyDo(ly)}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className={`${O_DINH} ${TD} ${NEN_O_DINH_CHO}`}>
                      <div className="mb-1.5">
                        <Chip hieuLuc={d.hieuLuc} />
                      </div>
                      {d.orderId && (d.hieuLuc === "CHO_DUYET" || d.hieuLuc === "KET") ? (
                        <NutXuLySaiMa
                          orderId={d.orderId}
                          yeuCauId={d.id}
                          tomTat={`${d.maDon} · ${fmt(d.soTien)}đ${d.soTheCuoi ? ` · thẻ …${d.soTheCuoi}` : ""}`}
                          laNguoiGui={d.nguoiGuiId === nguoiXemId}
                          thuLai={d.hieuLuc === "KET"}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      ) : (
        <p className="rounded-lg border border-border px-3 py-4 text-center text-sm text-muted-foreground">
          Không có yêu cầu nào đang chờ kế toán.
        </p>
      )}

      {hang.hauKiem.length > 0 && (
        <div className="mt-5">
          <h4 className="mb-2 text-sm font-semibold text-foreground">Đã xử lý 7 ngày qua</h4>
          <div className="overflow-hidden rounded-lg border border-border">
            <PhanTrangBang cuonNgang tenDonVi="yêu cầu" khoaGhiNho="bien-dong-pos-sai-ma-hau-kiem">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-muted text-left text-xs font-medium uppercase text-muted-foreground">
                  <tr>
                    <th className={`${TH} w-36`}>Gửi lúc · Người gửi</th>
                    <th className={`${TH} w-36`}>Đơn · Phiếu thẻ</th>
                    <th className={`${TH} w-44`}>Giao dịch</th>
                    <th className={`${TH} w-40`}>Ghi chú trên máy</th>
                    <th className={TH}>Kết quả</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {hang.hauKiem.map((d) => {
                    const xet = cachXetHauKiem(d);
                    return (
                      <tr key={d.id}>
                        <CotGuiLuc d={d} />
                        <CotDon d={d} />
                        <CotGiaoDich d={d} />
                        <CotGhiChu d={d} />
                        <td className={TD}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Chip hieuLuc={d.hieuLuc} />
                            {xet.chipSaleTuXacNhan && (
                              <span className="inline-flex whitespace-nowrap rounded-full bg-state-info-soft px-2 py-0.5 text-xs font-medium text-state-info-ink">
                                Sale tự xác nhận
                              </span>
                            )}
                          </div>
                          {d.hieuLuc === "TU_CHOI" && d.lyDoTuChoi && (
                            // Lý do tối đa 500 ký tự: kẹp 3 dòng (mật độ — dòng bảng không dài tuỳ ý), đủ chữ ở `title`.
                            <div className="mt-1 line-clamp-3 max-w-[260px] break-words text-xs text-muted-foreground" title={d.lyDoTuChoi}>
                              Lý do: {d.lyDoTuChoi}
                            </div>
                          )}
                          {d.nguoiQuyet && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {xet.nhanNguoiQuyet} {d.nguoiQuyet}
                              {d.quyetLuc && <span className="tabular-nums"> · {ngayGioVN(d.quyetLuc)}</span>}
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
        </div>
      )}
    </div>
  );
}
