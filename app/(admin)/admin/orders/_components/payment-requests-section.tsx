"use client";

// Danh sách PHIẾU THU của đơn + nút "Xuất QR" NGAY TRÊN TỪNG DÒNG (không phải nút
// cấp đơn). Sale nhìn một bảng là biết đợt nào còn thiếu bao nhiêu và quét mã nào.
//
// ⚠️ Đồng hồ đếm ngược ở đây CHỈ LÀ HIỂN THỊ. QR hết hạn VẪN nhận được tiền — đối
// khớp bám vào ĐƠN (SĐT trong nội dung CK), không theo phiên QR. Dòng chữ nhắc
// điều đó phải luôn hiện cạnh đồng hồ, nếu không sale sẽ tưởng hết giờ là mất tiền
// và giục phụ huynh chuyển lại → tiền về 2 lần.
//
// ⚠️ 20/08 — nội dung CK của MỌI ĐỢT trong cùng một đơn là GIỐNG NHAU
// (`HoTenCon_SdtPH_TenKhoa`). Không phải lỗi hiển thị: định dạng chủ dự án chọn
// không mang thông tin đợt. Cái phân biệt đợt là SỐ TIỀN in trên QR, còn tiền về
// thì rót vào đợt chưa đóng đủ sớm nhất rồi tràn sang đợt sau (waterfall).
//   ⤷ ĐÍNH CHÍNH 14/09: khoá đối khớp `ORD…D1` nay ĐỨNG TRƯỚC phần người đọc, nên
//     mỗi đợt LẠI khác nhau. Câu trên chỉ còn đúng với mã phát trước 14/09.
//
// ⚠️ 24/09 — `session.transferContent` là chuỗi ĐỌC RA TỪ ẢNH, không phải chuỗi tính
// lại (`lib/payments/noi-dung-trong-anh.ts`). Đừng thay nó bằng một giá trị tính ở
// client: cả lớp lỗi "màn in một đằng, mã mang một nẻo" sinh ra đúng từ việc đó.

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { QrCode, RefreshCw, Loader2, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QrZoom } from "./qr-zoom";
import { issueQrForRequest, regenerateQr } from "../_qr-actions";
import { taoPhieuGopAction, huyPhieuGopAction, dongPhieuGopAction } from "../_actions";
import { Input } from "@/components/ui/input";
import type { PhieuGopView } from "./cong-no-theo-con";
import { trangThaiQrDot, loiDotKhacDangGiu } from "@/lib/payments/qr-theo-dot";
import type { QrIssueResult, QrSessionView } from "../_qr-core";
import { formatDateVN } from "@/lib/format/date";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { trangThaiDot } from "@/lib/payments/trang-thai-dot";

export type PaymentRequestRow = {
  id: string;
  /** 0 = thu toàn bộ đơn; 1,2,… = số thứ tự đợt. */
  installmentNo: number;
  amountDue: number;
  /** Tổng đã phân bổ về phiếu này (từ PaymentAllocation). */
  allocated: number;
  dueDate: string | null;
  status: "PENDING" | "PARTIAL" | "PAID" | "VOID";
  matchKey: string | null;
};

const STATUS_LABEL: Record<PaymentRequestRow["status"], string> = {
  PENDING: "Chờ thu",
  PARTIAL: "Thu một phần",
  PAID: "Đã đủ",
  VOID: "Đã huỷ",
};

const STATUS_CLASS: Record<PaymentRequestRow["status"], string> = {
  PENDING: "bg-state-warning-soft text-state-warning-ink hover:bg-state-warning-soft",
  PARTIAL: "bg-state-info-soft text-state-info-ink hover:bg-state-info-soft",
  PAID: "bg-state-success-soft text-state-success-ink hover:bg-state-success-soft",
  VOID: "bg-muted text-muted-foreground hover:bg-muted",
};

function vnd(n: number): string {
  return n.toLocaleString("vi-VN") + "đ";
}

/**
 * Đợt nào SALE ĐÃ THU TAY (`OrderInstallment.status === "PAID"`) — sổ DUY NHẤT biết tới
 * tiền mặt, vì `PaymentRequest.status` chỉ suy từ `PaymentAllocation` mà tiền mặt không
 * sinh allocation nào.
 *
 * ⚠️ Thiếu nó thì bảng này in "Đợt 1 · Chờ thu · còn thiếu 2.000.000đ" cho một đợt sale đã
 * thu xong, và nút "Xuất QR" vẫn mở — mời khách trả lần hai. Đo trên ORD-260915-000007.
 */
export type DotDaThuTay = Record<number, boolean>;

/**
 * Còn thiếu của một phiếu, đọc CẢ HAI SỔ.
 *
 * ⚠️ Nhánh `VOID` phải ở ĐẦU và phải giữ. Phiếu bị huỷ (vd "thu toàn đơn" sau khi lập kế
 * hoạch theo đợt) không còn là khoản phải thu; bỏ nhánh đó là bảng in lại nguyên tổng đơn
 * ở dòng đã huỷ — tôi vừa làm đúng lỗi này và thấy "18.468.000đ" hiện ra ở dòng "Đã huỷ".
 */
function outstanding(r: PaymentRequestRow, daThuTay: DotDaThuTay): number {
  if (r.status === "VOID") return 0;
  return trangThaiDot({
    soDot: r.installmentNo,
    amountDue: r.amountDue,
    daRot: r.allocated,
    keHoachDaThu: daThuTay[r.installmentNo] === true,
  }).conThieu;
}

function requestLabel(r: PaymentRequestRow, totalDots: number): string {
  if (r.installmentNo === 0) return "Thu toàn bộ đơn";
  return totalDots > 1 ? `Đợt ${r.installmentNo}/${totalDots}` : `Đợt ${r.installmentNo}`;
}

/** Đồng hồ đếm ngược tới `expiresAt` — chỉ hiển thị, không chặn tiền về. */
function Countdown({
  expiresAt,
  onExpire,
}: {
  expiresAt: string;
  onExpire: () => void;
}) {
  const [left, setLeft] = useState(() => new Date(expiresAt).getTime() - Date.now());

  useEffect(() => {
    setLeft(new Date(expiresAt).getTime() - Date.now());
    const t = setInterval(() => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setLeft(ms);
      if (ms <= 0) onExpire();
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt, onExpire]);

  if (left <= 0) return <span className="font-semibold text-state-danger-ink">QR đã hết hạn</span>;
  const total = Math.floor(left / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return (
    <span className="font-mono text-lg font-bold tabular-nums text-foreground">
      {mm}:{ss}
    </span>
  );
}

function QrPanel({
  session,
  label,
  expired,
  pending,
  onRegenerate,
  onExpire,
  canManage,
}: {
  session: QrSessionView;
  label: string;
  expired: boolean;
  pending: boolean;
  onRegenerate: () => void;
  onExpire: () => void;
  canManage: boolean;
}) {
  return (
    <div className="mt-3 rounded-lg border border-primary-soft bg-primary-soft/40 p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="shrink-0">
          {session.imageSrc ? (
            // Ảnh QR: URL public img.vietqr.io hoặc data-URL sinh từ chuỗi của cổng.
            // Bấm vào để phóng to — quầy hay phải chìa màn hình cho phụ huynh quét.
            <QrZoom
              src={session.imageSrc}
              alt={`QR thanh toán ${label}`}
              title={`${label}: ${vnd(session.amountShown)}`}
              transferContent={session.transferContent}
              dimmed={expired}
            />
          ) : (
            <div className="flex h-52 w-52 items-center justify-center rounded-lg border border-dashed border-border bg-card text-xs text-muted-foreground">
              Không dựng được ảnh QR
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <p className="text-base font-bold text-foreground">
            {label}: {vnd(session.amountShown)}
          </p>
          {session.transferContent && (
            <p className="break-all text-xs text-muted-foreground">
              Nội dung CK:{" "}
              <span className="font-mono font-semibold text-foreground">
                {session.transferContent}
              </span>
            </p>
          )}
          {/* ⚠️ LUẬT 12 (affordance nói thật). Chuỗi in ra nay ĐỌC TỪ ẢNH, nên nó không
              còn tự đổi theo dữ liệu đơn — mà chính cái "tự đổi" ấy trước đây là tín
              hiệu (vô tình) báo mã đã lỗi thời. Không có khối này thì bản vá đổi một
              lỗi NÓI DỐI lấy một lỗi CÂM. */}
          {session.anhDaCu && (
            <p className="break-all rounded-md border border-state-warning-soft bg-state-warning-soft/60 px-3 py-2 text-xs text-state-warning-ink">
              <b>Mã này mang nội dung cũ.</b> Dữ liệu đơn đã đổi sau lúc xuất mã. Xuất lại
              bây giờ sẽ ra{" "}
              <span className="font-mono font-semibold">{session.noiDungHomNay}</span>.
              Tiền của mã cũ vẫn về đúng phiếu — bấm <b>Tạo lại QR</b> nếu phụ huynh chưa
              chuyển.
            </p>
          )}
          {session.checkoutUrl && (
            <a
              href={session.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs font-semibold text-primary underline"
            >
              Mở trang thanh toán của cổng →
            </a>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Hiệu lực hiển thị
            </span>
            <Countdown expiresAt={session.expiresAt} onExpire={onExpire} />
          </div>

          {/* BẤT BIẾN THIẾT KẾ — đừng gỡ dòng này. */}
          <p className="rounded-md bg-white/80 px-3 py-2 text-xs text-muted-foreground">
            QR hết hạn <b>vẫn nhận được tiền</b> — nếu phụ huynh đã chuyển, không cần
            tạo lại. Đồng hồ chỉ để biết mã đã hiển thị bao lâu.
          </p>

          {canManage && (
            <Button size="sm" variant="outline" onClick={onRegenerate} disabled={pending}>
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Tạo lại QR
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Mã QR của PHIẾU GỘP đang mở — thứ đưa cho phụ huynh quét.
 *
 * Tách riêng khỏi `QrPanel` (đời `QrSession`) vì hai thứ khác nhau ở đúng một điểm quan
 * trọng: phiếu gộp **không hết hạn**. `QrPanel` có đồng hồ đếm ngược; ở đây mà vẽ đồng hồ
 * thì nó đếm về 0 rồi người dùng tưởng mã hỏng và đi phát lại — một lời hứa suông theo
 * chiều ngược (luật 12).
 */
function PhieuGopQr({
  orderId,
  phieu,
  nhanDot,
  duocHuy,
  duocDong,
}: {
  orderId: string;
  phieu: PhieuGopView;
  nhanDot: string;
  duocHuy: boolean;
  duocDong: boolean;
}) {
  const router = useRouter();
  const [lyDo, datLyDo] = useState("");
  // CHỈ còn "DONG": huỷ nay là 2 lần bấm, không qua ô lý do nữa.
  const [dangMo, datDangMo] = useState<"DONG" | null>(null);
  /** Đã bấm "Huỷ phiếu" lần một, đang chờ lần hai. Xem khối chú thích ở nút. */
  const [choHuy, datChoHuy] = useState(false);
  const [dangChay, batDau] = useTransition();

  const ketThuc = (kieu: "HUY" | "DONG") => {
    // ── LÝ DO: CHỈ "ĐÓNG" MỚI BẮT BUỘC [chủ dự án chốt 24/09/2026] ──────────────
    // *"huỷ phiếu kh cần lý do, chỉ cần xác nhận 1 lần nữa là được"*.
    //
    // Ranh giới trùng đúng ranh giới nghiệp vụ: HUỶ chỉ xảy ra khi phiếu CHƯA nhận đồng
    // nào (server gác), tức bỏ một tờ giấy chưa ai trả tiền vào — không có gì để đối
    // soát. ĐÓNG thì có tiền thật dừng giữa chừng, và ba tháng sau kế toán sẽ hỏi.
    //
    // ⚠️ Cổng THẬT nằm ở server (`doiTrangThaiPhieuTrongTx`), không phải ở đây. Chỗ này
    // chỉ để người dùng khỏi bấm rồi ăn một câu từ chối.
    if (kieu === "DONG" && !lyDo.trim()) {
      toast.error("Ghi lý do");
      return;
    }
    batDau(async () => {
      const r =
        kieu === "HUY"
          ? await huyPhieuGopAction({ orderId, billId: phieu.billId, lyDo })
          : await dongPhieuGopAction({ orderId, billId: phieu.billId, lyDo });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(kieu === "HUY" ? "Đã huỷ phiếu" : "Đã đóng phiếu");
      datDangMo(null);
      datChoHuy(false);
      datLyDo("");
      router.refresh();
    });
  };

  return (
    <div className="mt-4 rounded-lg border border-primary-soft bg-primary-soft/40 p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="shrink-0">
          {phieu.qrUrl ? (
            <QrZoom
              src={phieu.qrUrl}
              alt={`Mã QR phiếu ${phieu.ma}`}
              title={`Phiếu ${phieu.ma}: ${vnd(phieu.tongTien)}`}
              transferContent={phieu.noiDungCk}
            />
          ) : (
            // Trạng thái rỗng NÓI VÌ SAO — một ô trống không lý do làm người dùng tưởng
            // QR đang tải và ngồi đợi mãi.
            <div className="flex h-52 w-52 items-center justify-center rounded-lg border border-dashed border-border bg-card p-3 text-center text-xs text-muted-foreground">
              Chưa dựng được QR — cơ sở chưa khai tài khoản nhận tiền, hoặc bạn không có
              quyền xem thông tin liên hệ.
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Phiếu thu gộp · đang chờ tiền
          </p>
          <p className="font-mono text-2xl font-bold tracking-[0.3em] text-foreground">
            {phieu.ma}
          </p>
          <p className="text-base font-bold text-foreground">
            {vnd(phieu.tongTien)}
            {/* Nói RÕ mã này thu đợt nào. Một mã 5 ký tự trần trụi buộc sale tự tra, và
                tra nhầm thì đưa khách mã của đợt khác. */}
            {nhanDot && <span className="ml-2 text-sm font-normal text-muted-foreground">· {nhanDot}</span>}
          </p>
          {phieu.daNhan > 0 && (
            <p className="text-xs text-state-warning-ink">
              Đã nhận {vnd(phieu.daNhan)} từ đường khác — số trên mã là phần CÒN LẠI.
            </p>
          )}
          <p className="break-all text-xs text-muted-foreground">
            Nội dung CK:{" "}
            <span className="font-mono font-semibold text-foreground">{phieu.noiDungCk}</span>
          </p>
          {/* BẤT BIẾN THIẾT KẾ — đừng gỡ. Tiền về phải khớp ĐÚNG SỐ (chốt PHIÊN C:
              "ăn cả hoặc không ăn gì"), nên sale PHẢI biết điều đó trước khi đưa mã. */}
          <p className="rounded-md bg-white/80 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            Phụ huynh phải chuyển <b>đúng {vnd(phieu.tongTien)}</b> và <b>giữ nguyên nội
            dung</b> thì hệ thống mới tự ghi nhận. Lệch số hoặc sửa nội dung ⇒ khoản tiền
            nằm chờ đối soát tay. Mã <b>không hết hạn</b> — nó sống tới khi phiếu bị đóng
            hoặc huỷ bằng nút bên dưới.
          </p>
        </div>
      </div>

      {/* ── THU HỒI PHIẾU — ĐỨNG CÙNG CHỖ VỚI MÃ [24/09/2026] ────────────────────
          Chủ dự án: *"chỗ thu hồi phiếu cũng bỏ xuống dưới phần QR luôn chứ"*.

          Bản trước để mã + ảnh ở đây còn nút huỷ/đóng ở khối "Công nợ theo con" — người
          dùng phải nhìn hai chỗ cho một tờ phiếu. Nay cả phiếu ở một chỗ. */}
      {(duocHuy || duocDong) && (
        <div className="mt-4 border-t border-primary-soft pt-3">
          {dangMo === null ? (
            <div className="flex flex-wrap gap-2">
              {/* Hai nút, và chỉ MỘT trong hai dùng được tuỳ phiếu đã nhận tiền chưa. Hiện
                  cả hai rồi để cổng từ chối là bắt người dùng đoán; ẩn đúng cái không dùng
                  được thì màn hình tự nói luật (luật 12). */}
              {/* HUỶ — XÁC NHẬN 2 LẦN, KHÔNG HỎI LÝ DO (chủ dự án chốt 24/09/2026).
                  Dùng đúng nếp "confirm-delete 2 lần bấm" của repo. Lần bấm thứ hai đổi
                  hẳn màu sang `destructive` và đổi chữ — người dùng phải THẤY mình đang
                  ở bước khác, chứ không phải bấm hai lần vào cùng một cái nút. */}
              {duocHuy && phieu.daNhan === 0 && (
                <>
                  <Button
                    size="sm"
                    variant={choHuy ? "destructive" : "outline"}
                    disabled={dangChay}
                    onClick={() => (choHuy ? ketThuc("HUY") : datChoHuy(true))}
                  >
                    {choHuy ? `Xác nhận huỷ mã ${phieu.ma}` : "Huỷ phiếu"}
                  </Button>
                  {choHuy && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={dangChay}
                      onClick={() => datChoHuy(false)}
                    >
                      Thôi
                    </Button>
                  )}
                </>
              )}
              {duocDong && phieu.daNhan > 0 && (
                <Button size="sm" variant="outline" onClick={() => datDangMo("DONG")}>
                  Đóng phiếu
                </Button>
              )}
              {phieu.daNhan > 0 && !duocDong && (
                <p className="text-xs text-muted-foreground">
                  Phiếu đã nhận tiền — chỉ kế toán đóng được.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 min-w-0 flex-1 text-xs"
                placeholder="Lý do đóng (bắt buộc)"
                value={lyDo}
                onChange={(e) => datLyDo(e.target.value)}
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={dangChay}
                onClick={() => ketThuc(dangMo)}
              >
                Đóng phiếu
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={dangChay}
                onClick={() => {
                  datDangMo(null);
                  datLyDo("");
                }}
              >
                Thôi
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PaymentRequestsSection({
  orderId,
  requests,
  initialSessions,
  canManage,
  duocPhatPhieu,
  duocDongPhieu,
  batThuTheoCon,
  phieuGop,
  daThuTay = {},
  lyDoChuaDuyet = null,
}: {
  orderId: string;
  requests: PaymentRequestRow[];
  /** Phiên QR ACTIVE còn hạn của từng phiếu (server đọc sẵn lúc render). */
  initialSessions: Record<string, QrSessionView>;
  canManage: boolean;
  /**
   * `payments:record` — quyền mà `taoPhieuGopAction` THẬT SỰ hỏi (`congDuongB`).
   *
   * ⚠️ KHÔNG dùng lại `canManage` (`orders:manage`) cho nút phát phiếu: hai quyền khác
   * nhau, và vẽ nút bằng quyền A rồi để action hỏi quyền B là một lời hứa suông (luật
   * 12) — người dùng bấm và ăn "Không có quyền" mà không hiểu vì sao.
   */
  duocPhatPhieu: boolean;
  /** `payments:manage` — quyền ĐÓNG phiếu đã nhận tiền. Khác `duocPhatPhieu`, ba quyền ba việc. */
  duocDongPhieu: boolean;
  /**
   * Đơn đang CHỜ DUYỆT thì vì sao — chuỗi để in, `null` khi không chờ gì.
   *
   * ⚠️ VÌ SAO PROP NÀY TỒN TẠI [25/09/2026]. Cổng thật nằm ở `guardIssuable`
   * (`_qr-core.ts`) và nó CHẶN đúng; trang đơn cũng đã dùng `lyDoChuaDuyet` để giấu ảnh
   * VietQR dựng thẳng. Nhưng bảng này thì KHÔNG biết gì, nên các nút "Xuất QR" vẫn sáng
   * và vẫn mời bấm — bấm xong mới ăn một câu từ chối.
   *
   * Chủ dự án nhìn thấy ngay và hỏi: *"sao tạo 5 đợt vẫn cho xuất QR mà quản lý chưa
   * duyệt?"* — câu hỏi đúng, vì màn hình đang hứa một việc mà máy chủ luôn từ chối
   * (luật 12).
   *
   * ⚠️ Đây là lớp HIỂN THỊ, không phải lớp bảo vệ. Gỡ nó đi thì tiền vẫn an toàn vì
   * `guardIssuable` còn đó — nhưng người dùng lại phải học bằng cách bấm.
   */
  lyDoChuaDuyet?: string | null;
  /**
   * Công tắc `billing.flexV1Enabled` của cơ sở giữ đơn.
   *
   * ⚠️ BẮT BUỘC, cố ý KHÔNG có `?` và KHÔNG có mặc định — luật 11. Prop cờ mặc định
   * `false` mà không ai truyền là lỗi CÂM: không lỗi biên dịch, không ca test nào đỏ, và
   * triệu chứng là "tính năng không bao giờ hiện" — trông y hệt lỗi phân quyền.
   */
  batThuTheoCon: boolean;
  /** Phiếu gộp ĐANG MỞ (mã 5 ký tự) — `null` khi chưa phát, hoặc khi cờ tắt. */
  phieuGop: PhieuGopView | null;
  /** `soDot` → sale đã thu tay. Xem `DotDaThuTay`. */
  daThuTay?: DotDaThuTay;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sessions, setSessions] = useState<Record<string, QrSessionView>>(initialSessions);
  const [expired, setExpired] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<string | null>(
    Object.keys(initialSessions)[0] ?? null,
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  const markExpired = useCallback((id: string) => {
    setExpired((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }, []);

  const totalDots = requests.filter((r) => r.installmentNo > 0).length;

  // ── 24/09/2026 · QR THEO ĐỢT DÙNG MÃ 5 KÝ TỰ ────────────────────────────────
  //
  // Dòng của phiếu gộp đang mở, kèm NHÃN NGƯỜI ĐỌC dựng bằng đúng `requestLabel` mà bảng
  // này đang in — để câu từ chối nói "Đợt 1/3" giống hệt thứ sale đang nhìn, chứ không
  // phải "installmentNo 1".
  const dongPhieuMo =
    phieuGop?.dong.map((d) => {
      const r = requests.find((x) => x.id === d.paymentRequestId);
      return {
        paymentRequestId: d.paymentRequestId,
        nhan: r ? requestLabel(r, totalDots) : `Đợt ${d.installmentNo}`,
      };
    }) ?? null;

  /** Phát phiếu gộp MỘT DÒNG cho đúng đợt này — đường lấy mã 5 ký tự. */
  function phatPhieuChoDot(r: PaymentRequestRow) {
    setBusyId(r.id);
    start(async () => {
      const res = await taoPhieuGopAction({ orderId, paymentRequestIds: [r.id] });
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Đã phát mã ${res.ma} — ${vnd(res.tongTien)}`);
      // KHÔNG tự dựng mã QR ở client: ảnh cần tài khoản nhận tiền của cơ sở VÀ cần biết
      // người xem có `orders:view-pii` không. Cả hai chỉ server biết (xem `PhieuGopView`).
      router.refresh();
    });
  }

  function run(id: string, fn: () => Promise<QrIssueResult>) {
    setBusyId(id);
    start(async () => {
      const res = await fn();
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSessions((prev) => ({ ...prev, [id]: res.session }));
      setExpired((prev) => ({ ...prev, [id]: false }));
      setOpenId(id);
      toast.success(res.reused ? "Đang dùng lại mã QR còn hiệu lực" : "Đã xuất mã QR");
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
        <Receipt className="h-4 w-4 text-primary" /> Phiếu thu &amp; QR theo đợt
      </h2>

      {/* Dải này nói lý do MỘT LẦN cho cả bảng. `title` trên từng nút là cho người đã
          rê chuột vào nút; còn người mở trang và thấy cả cột nút xám thì cần biết ngay
          vì sao, không phải đi rê từng cái. */}
      {lyDoChuaDuyet && (
        <p className="mb-4 rounded-lg border border-state-warning-ink/25 bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
          <b>Chưa xuất được mã QR.</b> {lyDoChuaDuyet}. Mã đã phát trước đó vẫn xem lại được.
        </p>
      )}

      <PhanTrangBang cuonNgang>
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-left">
              <th className="p-2">Phiếu thu</th>
              <th className="p-2 text-right">Phải thu</th>
              <th className="p-2 text-right">Đã thu</th>
              <th className="p-2 text-right">Còn thiếu</th>
              <th className="p-2">Hạn</th>
              <th className="p-2">Trạng thái</th>
              <th className="p-2 text-right">QR</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => {
              const label = requestLabel(r, totalDots);
              const s = sessions[r.id];
              const isOpen = openId === r.id && !!s;
              // ⚠️ `duocPhatPhieu` (= `payments:record`), KHÔNG phải `canManage`
              // (= `orders:manage`) [02/10/2026]. Ô này gác CẢ HAI đường QR, nên dùng
              // `canManage` là giấu nút khỏi đúng hai vai đứng quầy thu tiền:
              // `CENTER_SALES_CSM` và `CENTER_ACCOUNTANT` đều có `payments:record` mà
              // KHÔNG có `orders:manage` (đo `seed-roles.ts` 02/10).
              //
              // Chính chú thích ở khai báo `duocPhatPhieu` bên trên đã cảnh báo đúng lớp
              // lỗi này — "vẽ nút bằng quyền A rồi để action hỏi quyền B là lời hứa
              // suông" — nhưng bản vá 24/09 chỉ áp cho nhánh phiếu gộp BÊN TRONG, còn cổng
              // NGOÀI vẫn hỏi quyền cũ. Kết quả còn tệ hơn lời hứa suông: nút không được
              // vẽ ra, nên người dùng không có gì để bấm mà cũng không có câu nào giải
              // thích. Hai đơn thật 02/10 (`ORD-261002-000001`, `…-000002`) là ca đó.
              //
              // Nay cả hai đường QR cùng hỏi `payments:record`, khớp với cổng server
              // (`_qr-actions.ts` + `taoPhieuGopAction`). Lưới `[QRQ-*]` ghim sự khớp đó.
              const canIssue = duocPhatPhieu && r.status !== "PAID" && r.status !== "VOID";
              // Dòng này vẽ gì — xem `lib/payments/qr-theo-dot.ts`.
              const tt = trangThaiQrDot({
                bat: batThuTheoCon,
                dongPhieuMo,
                paymentRequestId: r.id,
              });
              return (
                <tr key={r.id} className="border-b border-border align-top">
                  <td className="p-2 font-semibold text-foreground">{label}</td>
                  <td className="p-2 text-right tabular-nums">{vnd(r.amountDue)}</td>
                  <td className="p-2 text-right tabular-nums text-state-success-ink">
                    {vnd(r.allocated)}
                  </td>
                  <td className="p-2 text-right font-semibold tabular-nums text-foreground">
                    {vnd(outstanding(r, daThuTay))}
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {r.dueDate ? formatDateVN(r.dueDate) : "—"}
                  </td>
                  <td className="p-2">
                    {/* Nhãn đọc CẢ HAI SỔ. Phiếu VOID giữ nhãn riêng — nó không phải một
                        đợt đang chờ thu mà là phiếu đã bị huỷ. */}
                    {(() => {
                      if (r.status === "VOID") {
                        return <Badge className={STATUS_CLASS.VOID}>{STATUS_LABEL.VOID}</Badge>;
                      }
                      const tt = trangThaiDot({
                        soDot: r.installmentNo,
                        amountDue: r.amountDue,
                        daRot: r.allocated,
                        keHoachDaThu: daThuTay[r.installmentNo] === true,
                      });
                      const ma =
                        tt.ma === "DA_THU" ? "PAID" : tt.ma === "MOT_PHAN" ? "PARTIAL" : "PENDING";
                      return (
                        <Badge className={STATUS_CLASS[ma]}>
                          {tt.nguon === "SALE_THU_TAY" ? "Đã thu (tay)" : STATUS_LABEL[ma]}
                        </Badge>
                      );
                    })()}
                  </td>
                  <td className="p-2 text-right">
                    {!canIssue ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : tt.kieu === "MOI_CUA_DOT_KHAC" ? (
                      // ⚠️ LUẬT 12 — KHÔNG vẽ nút ở đây. `PaymentBill_orderId_open_key` là
                      // chỉ mục từng phần do DB gác: bấm là chắc chắn ăn từ chối. Một cái
                      // nút chắc chắn hỏng là một lời hứa suông; nói thẳng ai đang giữ mã.
                      <span
                        className="text-xs text-state-warning-ink"
                        title={loiDotKhacDangGiu(tt.nhanDotDangGiu)}
                      >
                        Mã đang mở cho {tt.nhanDotDangGiu}
                      </span>
                    ) : tt.kieu === "MOI_CHUA_PHAT" ? (
                      !duocPhatPhieu ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                      <Button
                        size="sm"
                        // Cùng luật với nút "Xuất QR" của đợt: chờ duyệt thì KHÔNG phát
                        // mã mới. Phát phiếu gộp cũng là phát mã cho khách quét.
                        disabled={(pending && busyId === r.id) || lyDoChuaDuyet != null}
                        title={lyDoChuaDuyet ?? undefined}
                        onClick={() => phatPhieuChoDot(r)}
                      >
                        {pending && busyId === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <QrCode className="h-3.5 w-3.5" />
                        )}
                        Xuất QR
                      </Button>
                      )
                    ) : tt.kieu === "MOI_CUA_DOT_NAY" ? (
                      // Mã của phiếu gộp KHÔNG có hạn (không phải `QrSession`), nên ở đây
                      // KHÔNG có đồng hồ đếm ngược — vẽ một cái đồng hồ cho thứ không hết
                      // hạn là nói dối. Mã sống tới khi phiếu bị đóng/huỷ.
                      <span className="font-mono text-xs font-bold text-state-success-ink">
                        Mã {phieuGop?.ma}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant={isOpen ? "outline" : "default"}
                        // Chờ duyệt ⇒ TẮT nút, và `title` nói vì sao. Vẫn cho XEM mã đã
                        // phát trước đó (`s && !expired`): mã ấy đã ra tay khách rồi,
                        // giấu đi không thu hồi được gì mà chỉ làm sale mất đường tra.
                        disabled={
                          (pending && busyId === r.id) ||
                          (lyDoChuaDuyet != null && !(s && !expired[r.id]))
                        }
                        title={
                          lyDoChuaDuyet != null && !(s && !expired[r.id])
                            ? lyDoChuaDuyet
                            : undefined
                        }
                        onClick={() => {
                          if (s && !expired[r.id]) {
                            setOpenId(isOpen ? null : r.id);
                            return;
                          }
                          run(r.id, () => issueQrForRequest({ paymentRequestId: r.id }));
                        }}
                      >
                        {pending && busyId === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <QrCode className="h-3.5 w-3.5" />
                        )}
                        {s && !expired[r.id] ? (isOpen ? "Ẩn QR" : "Xem QR") : "Xuất QR"}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {requests.length === 0 && (
              <tr>
                <td colSpan={7} className="p-3 text-sm text-muted-foreground">
                  Chưa có phiếu thu nào cho đơn này.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </PhanTrangBang>

      {/* ── MÃ QR CỦA PHIẾU GỘP — ĐỨNG Ở ĐÂY, KHÔNG Ở KHỐI "CÔNG NỢ THEO CON" ──────
          Chủ dự án 24/09: *"đưa qr về đúng session phiếu thu & qr theo đợt chứ"*.

          ⚠️ DỜI, KHÔNG NHÂN ĐÔI. Vẽ ảnh ở cả hai khối là hai chỗ cùng nói về một mã —
          đúng lớp lỗi vừa vá sáng nay. Khối "Công nợ theo con" giữ vai QUẢN LÝ phiếu
          (mã · tổng · các đợt · huỷ/đóng); khối này giữ vai ĐƯA MÃ CHO KHÁCH.

          ⚠️ KHÔNG có đồng hồ đếm ngược, và đó là cố ý: mã phiếu gộp KHÔNG phải
          `QrSession`, nó không hết hạn — sống tới khi phiếu bị đóng hoặc huỷ. Vẽ một cái
          đồng hồ cho thứ không hết hạn là nói dối (luật 12). */}
      {phieuGop && (
        <PhieuGopQr
          orderId={orderId}
          phieu={phieuGop}
          nhanDot={dongPhieuMo?.map((d) => d.nhan).join(" + ") ?? ""}
          duocHuy={duocPhatPhieu}
          duocDong={duocDongPhieu}
        />
      )}

      {/* Panel QR của phiếu đang mở — nhãn nói RÕ đang thu đợt nào, bao nhiêu. */}
      {(() => {
        if (!openId) return null;
        const r = requests.find((x) => x.id === openId);
        const s = sessions[openId];
        if (!r || !s) return null;
        return (
          <QrPanel
            session={s}
            label={requestLabel(r, totalDots)}
            expired={!!expired[openId]}
            pending={pending && busyId === openId}
            canManage={canManage}
            onExpire={() => markExpired(openId)}
            onRegenerate={() => run(openId, () => regenerateQr({ paymentRequestId: openId }))}
          />
        );
      })()}

      {/* ⚠️ ĐÃ THAY [14/09/2026]. Câu cũ: "Đơn này CHƯA CÓ KẾ HOẠCH TRẢ GÓP ĐƯỢC DUYỆT
          … gửi Quản lý cơ sở duyệt — duyệt xong bảng này sẽ tách thành từng đợt kèm QR
          riêng." Nó bám `installmentPlanApproved`, mà cờ duyệt đã gỡ nên cờ LUÔN false ⇒
          câu đó hiện trên MỌI đơn, kể cả đơn đã có đủ n phiếu kèm QR ngay bên trên nó.
          Người đọc tưởng QR chưa sinh và đi tìm một khâu duyệt không còn tồn tại.

          Nay chỉ nói khi đơn THẬT SỰ chưa tách đợt, và chỉ đúng đường. */}
      {requests.filter((r) => r.installmentNo > 0).length === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Đơn này <b>chưa tách đợt</b> nên chỉ có một phiếu thu toàn đơn. Muốn tách: lập
          kế hoạch ở mục <b>&ldquo;Kế hoạch thanh toán&rdquo;</b> phía trên — lưu xong là
          mỗi đợt có một phiếu kèm QR riêng ngay, không cần ai duyệt.
        </p>
      )}
    </section>
  );
}
