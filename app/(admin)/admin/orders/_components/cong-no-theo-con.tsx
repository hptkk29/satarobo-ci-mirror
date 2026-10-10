"use client";

import { useState, useTransition } from "react";
import {
  ArrowLeftRight,
  ArrowRightLeft,
  CalendarClock,
  CircleStop,
  HandCoins,
  MoreHorizontal,
  Plus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// Hằng mật độ DÙNG CHUNG của admin (24 tệp đang dùng). Tệp này trước lượt 24/09 không
// dùng cái nào và tự gõ `py-1.5`/`py-2` — tức tự đẻ một chuẩn mật độ thứ hai.
import { adminTd, adminTh } from "@/components/admin/ui/table";

/**
 * Một con KÈM NHÃN NGƯỜI ĐỌC [25/09/2026].
 *
 * Chủ dự án: *"2 con học cùng khoá thì sao biết là đang giảm đơn cho con nào?"*
 * `NoCuaCon.ten` là `OrderItem.itemName`, và trên `/orders/new` cột đó là tên KHOÁ —
 * hai con cùng khoá ⇒ hai dòng đọc y hệt nhau, ở cả nhãn nút lẫn `aria-label`.
 *
 * ⚠️ Hai trường dưới dựng MỘT LẦN ở `CongNoTheoCon` rồi truyền xuống mọi hộp thoại con.
 * Mỗi nơi tự ghép lấy là mỗi nơi có thể ghép khác nhau, và nhãn tiền thì không được có
 * hai phiên bản. Phép ghép nằm ở `lib/orders/ten-con-tren-dong.ts`, có bộ ca `[TCD-*]`.
 */
type ConVoiNhan = NoTheoConKetQua["con"][number] & {
  /** Tên bé THẬT. `null` = dòng chưa gắn bé nào — màn hình phải NÓI RA, đừng đoán. */
  tenBe: string | null;
  /** Cụm chữ gọi tên dòng cho nhãn nút / `aria-label` / câu văn. Xem `moTaDong`. */
  nhan: string;
};
import { tranTaoDot, type NoTheoConKetQua } from "@/lib/finance/no-theo-con";
import { tenConTrenDong, moTaDong } from "@/lib/orders/ten-con-tren-dong";
import { canhBaoTruocVoidDot, nhanNutKemPhieu } from "@/lib/finance/soat-phieu-gop";
import { type CachHapThu } from "@/lib/orders/chinh-sach-uu-dai";
import {
  canhBaoMienGiamChuaHapThu,
  chuaHapThuKhiMienGiam,
  dotSeHuyKhiMienGiam,
  keHoachMienGiam,
  moTaTruocMienGiamCapDon,
  type DongKeHoachDon,
  type PhieuThuDeMien,
} from "@/lib/finance/mien-giam";
import { CanhBaoPhieuTruoc } from "./canh-bao-phieu-truoc";
import {
  chiaDotChoCon,
  type ChiaDotKetQua,
  type DotDonDeChia,
} from "@/lib/finance/chia-dot-cho-con";
import type { TrangThaiDungHocCuaCon } from "@/lib/finance/dung-hoc-con";
import { NutDungHoc } from "./dung-hoc-dialog";
import { NutDoiKhoa, type LopChon } from "./doi-khoa-dialog";

import {
  boGanKhoanChoConAction,
  chuyenTienGiuaConAction,
  mienGiamNoAction,
  ganKhoanChoConAction,
  huyDotChoConAction,
  tachKhoanChoConAction,
  taoDotChoConAction,
  taoPhieuGopAction,
} from "../_actions";

/**
 * KHỐI "CÔNG NỢ THEO CON" — trang chi tiết đơn [PHIÊN A, 16/09/2026].
 *
 * Chủ dự án chốt: *"Mỗi con 1 dòng: khoá, học phí thực, đã thu, còn nợ, các đợt đang mở.
 * Nút 'Tạo đợt' trên từng con: số tiền + hạn. Không bắt lên lịch cả khoá, không trần số đợt."*
 *
 * ── NAY LÀ MỘT CÁI BẢNG [PHIÊN K · 24/09/2026] ──
 *
 * ⚠️ Đoạn cũ ở đây tên là *"Vì sao KHÔNG phải một cái bảng"* và nó lập luận rằng hành
 * động nằm TRONG một con nên bảng sẽ tách người dùng khỏi con số họ vừa đọc. Lập luận ấy
 * đúng cho bản 16/09 — lúc khối này là thứ DUY NHẤT trên màn nói về từng con. Nó hết đúng
 * ngày 24/09, khi bảng chia đợt ra đời và in lại cùng một tập con ngay phía trên: từ đó
 * màn có HAI danh sách liệt kê cùng một thứ, và cái thẻ là cái thừa.
 *
 * Giữ nguyên lời dặn cũ là để lại một câu CẤM SỬA cho một luật đã chết.
 *
 * Cách giải mối lo cũ (hành động xa con số) KHÔNG phải bỏ bảng, mà là:
 *   · "Còn nợ" đứng NGAY TRƯỚC ô hành động — cuộn tới nút là thấy số;
 *   · bảng đúng 6 cột CỐ ĐỊNH, bề rộng không phụ thuộc số đợt, nên nút không bao giờ bị
 *     đẩy ra sau một quãng cuộn dài như khi gộp cột đợt vào;
 *   · việc thường làm nhất ("+ Đợt") là nút riêng; bốn việc hiếm vào menu `⋯`;
 *   · hàng CHI TIẾT mở ngay dưới hàng của chính bé đó — đợt, khoản đã gắn, form — nên
 *     "xem đợt rồi tạo thêm đợt" vẫn làm được mà mắt không rời khỏi bé đang xử.
 *
 * ── Ràng buộc đã tuân (DESIGN.md) ──
 * · admin = shadcn/ui, KHÔNG Magic UI / Framer Motion (ESLint chặn cứng);
 * · mọi màu qua token ngữ nghĩa `state-*`, không hex rời, không gradient, không viền trái dày;
 * · mật độ dòng lấy từ hằng DÙNG CHUNG `adminTh`/`adminTd` (~44px), không tự gõ padding;
 * · `min-w-0` + `truncate` ở mọi ô có tên người — tên tiếng Việt dài là mặc định;
 * · bảng cuộn ngang trong khung của nó, trang KHÔNG cuộn ngang;
 * · transition 150ms, không bounce.
 */

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

const ngay = (d: Date | string | null) =>
  d == null ? "chưa có hạn" : new Date(d).toLocaleDateString("vi-VN");

/** Một ô số. `tone` đi qua token ngữ nghĩa, không mượn màu thương hiệu. */
/**
 * Chip trạng thái nhỏ, nằm CÙNG DÒNG với tên con.
 *
 * ⚠️ Thay cho component `O` (nhãn in hoa + số `text-xl`) đã gỡ ở PHIÊN K. `O` là đúng
 * khuôn "hero-metric" mà craft floor xếp vào mục KHÔNG dùng mặc định: bốn ô số to cho một
 * thực thể, trong đó ba ô thường là "0đ". Số nay nằm trong cột bảng, `tabular-nums`, và
 * cái duy nhất còn cần một hình dạng riêng là NHÃN TRẠNG THÁI.
 *
 * Chữ `text-[11px]` là hợp lệ: đây là metadata phụ, không phải nội dung đọc (DESIGN.md §7
 * chỉ cấm chữ dưới 12px cho nội dung đọc được).
 */
function Chip({ tone, children }: { tone: "warn" | "muted"; children: React.ReactNode }) {
  const mau =
    tone === "warn"
      ? "border-state-warning-soft bg-state-warning-soft/50 text-state-warning-ink"
      : "border-border bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex shrink-0 whitespace-nowrap rounded border px-1.5 text-[11px] font-medium ${mau}`}
    >
      {children}
    </span>
  );
}

function FormTaoDot({
  orderId,
  orderItemId,
  toiDa,
  tenCon,
  dong,
}: {
  orderId: string;
  orderItemId: string;
  toiDa: number;
  tenCon: string;
  dong: () => void;
}) {
  const [soTien, setSoTien] = useState("");
  const [han, setHan] = useState("");
  const [dangChay, batDau] = useTransition();

  const gui = () => {
    const n = Number(soTien.replace(/\D/g, ""));
    batDau(async () => {
      const r = await taoDotChoConAction({
        orderId,
        orderItemId,
        soTien: n,
        dueDate: han || null,
      });
      // Câu lỗi do server trả về đã mang TÊN CON và CON SỐ (xem `kiemTaoDot`) — in nguyên văn
      // thay vì thay bằng một câu chung, vì đó mới là thứ sale sửa được ngay.
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(`Đã tạo đợt ${vnd(n)} cho ${tenCon}`);
        dong();
      }
    });
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            Số tiền · tối đa {vnd(toiDa)}
          </span>
          <Input
            inputMode="numeric"
            value={soTien}
            onChange={(e) => setSoTien(e.target.value)}
            placeholder="0"
            className="tabular-nums"
            aria-label={`Số tiền đợt thu của ${tenCon}`}
          />
        </label>
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            Hạn đóng (không bắt buộc)
          </span>
          <Input
            type="date"
            value={han}
            onChange={(e) => setHan(e.target.value)}
            aria-label={`Hạn đóng đợt thu của ${tenCon}`}
          />
        </label>
        <div className="flex gap-2">
          <Button type="button" onClick={gui} disabled={dangChay || soTien.trim() === ""}>
            {dangChay ? "Đang tạo…" : "Tạo đợt"}
          </Button>
          <Button type="button" variant="ghost" onClick={dong} disabled={dangChay}>
            Huỷ
          </Button>
        </div>
      </div>
    </div>
  );
}

function NutHuyDot({
  orderId,
  paymentRequestId,
  moTa,
  canhBaoPhieu,
}: {
  orderId: string;
  paymentRequestId: string;
  moTa: string;
  /**
   * Đợt nằm trong phiếu gộp đang mở ⇒ câu nói TRƯỚC rằng cả phiếu sẽ bị huỷ/đóng
   * (`canhBaoTruocVoidDot(...).cau`). `null` khi đợt không thuộc phiếu nào. Bắt buộc truyền — luật 7.
   */
  canhBaoPhieu: string | null;
}) {
  const [dangChay, batDau] = useTransition();
  const [xacNhan, datXacNhan] = useState(false);

  // Xác nhận 2 bấm, theo nếp sẵn có của admin. Huỷ đợt tự nó hoàn tác được bằng cách tạo lại đợt,
  // NHƯNG mã phiếu gộp đã huỷ thì không sống lại (rà vòng 4, luật 12) — nên lần bấm đầu NÓI TRƯỚC
  // phiếu nào sẽ bị huỷ/đóng, lần bấm hai báo lại kết quả thật từ server.
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={dangChay}
      aria-label={`Huỷ đợt ${moTa}`}
      onClick={() => {
        if (!xacNhan) {
          datXacNhan(true);
          if (canhBaoPhieu) toast.warning(canhBaoPhieu, { duration: 10_000 });
          return;
        }
        batDau(async () => {
          const r = await huyDotChoConAction({ orderId, paymentRequestId });
          if (!r.ok) toast.error(r.error);
          else {
            toast.success("Đã huỷ đợt");
            if (r.thongDiepPhieu) toast.warning(r.thongDiepPhieu, { duration: 15_000 });
          }
          datXacNhan(false);
        });
      }}
      onBlur={() => datXacNhan(false)}
      className="shrink-0 text-muted-foreground transition-colors duration-150 hover:text-state-danger-ink"
    >
      {xacNhan ? (
        <span className="text-xs font-semibold text-state-danger-ink">
          {canhBaoPhieu ? "Bấm lần nữa · cả phiếu" : "Bấm lần nữa"}
        </span>
      ) : (
        <X className="size-4" aria-hidden />
      )}
    </Button>
  );
}

/**
 * FORM TÁCH MỘT KHOẢN CHO NHIỀU BÉ [20/09/2026].
 *
 * Ca thật: `ORD-260918-000001` — một khoản 9.530.000đ cho hai bé. Trước bản này màn hình chỉ
 * có câu "chưa hỗ trợ".
 *
 * ── Vì sao có Ô ĐẾM NGƯỢC, và vì sao nút khoá khi chưa khớp ──
 * Luật là Σ **đúng bằng** số tiền khoản. Đo trên chính đơn pilot: hai nửa học phí là
 * 4.488.000 + 5.016.000 = 9.504.000, mà khoản là 9.530.000 ⇒ **lệch 26.000đ**. Người nhập
 * hai con số "đúng" ấy rồi bấm sẽ ăn một câu từ chối mà không hiểu vì sao — nên phần còn
 * thiếu / còn thừa phải hiện NGAY khi họ gõ, và nút khoá cho tới khi khớp. Câu từ chối của
 * server vẫn là thẩm quyền cuối, nhưng nó không nên là nơi người ta học luật.
 *
 * ── "tối đa" lấy từ `conCoTheNhan`, KHÔNG phải `conNo` ──
 * Trần của cổng là tập RỘNG (trừ cả tiền chờ xác nhận). Ô "Còn nợ" phía trên in trục A. Hai
 * số lệch nhau khi bé đã có tiền chờ duyệt — nên form phải in ĐÚNG con số mà cổng dùng, kẻo
 * màn nói một đằng cổng chặn một nẻo (bài học của cổng tạo đợt).
 */
function FormTachKhoan({
  orderId,
  paymentId,
  soTienKhoan,
  con,
  dong,
}: {
  orderId: string;
  paymentId: string;
  soTienKhoan: number;
  con: ConVoiNhan[];
  dong: () => void;
}) {
  const [oTien, datOTien] = useState<Record<string, string>>({});
  const [dangChay, batDau] = useTransition();

  const so = (id: string) => Number((oTien[id] ?? "").replace(/\D/g, "")) || 0;
  const daChia = con.reduce((s, c) => s + so(c.orderItemId), 0);
  const conLai = soTienKhoan - daChia;
  const soBeDaNhap = con.filter((c) => so(c.orderItemId) > 0).length;
  const khop = conLai === 0 && soBeDaNhap >= 2;

  const gui = () => {
    batDau(async () => {
      const r = await tachKhoanChoConAction({
        orderId,
        paymentId,
        phan: con
          .map((c) => ({ orderItemId: c.orderItemId, soTien: so(c.orderItemId) }))
          .filter((p) => p.soTien > 0),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Đã tách ${vnd(r.soTien)} cho ${r.tenCon.filter(Boolean).join(" · ")}`);
      dong();
    });
  };

  return (
    <div className="mt-2 rounded-lg border border-border bg-background p-3">
      <p className="text-xs text-muted-foreground">
        Chia <b className="tabular-nums text-foreground">{vnd(soTienKhoan)}</b> cho từng bé.
        Tổng phải <b>đúng bằng</b> số này.
      </p>

      <div className="mt-2 space-y-2">
        {con.map((c) => (
          <label key={c.orderItemId} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="min-w-0 flex-1 truncate text-sm">
              {c.nhan}
              <span className="ml-2 text-xs text-muted-foreground">
                tối đa {vnd(c.conCoTheNhan)}
              </span>
            </span>
            <Input
              inputMode="numeric"
              className="h-9 tabular-nums sm:w-44"
              placeholder="0"
              value={oTien[c.orderItemId] ?? ""}
              onChange={(e) =>
                datOTien((cu) => ({ ...cu, [c.orderItemId]: e.target.value }))
              }
              aria-label={`Số tiền tách cho ${c.nhan}`}
            />
          </label>
        ))}
      </div>

      {/* Ô đếm ngược — thứ duy nhất trên màn này nói cho người nhập biết họ còn thiếu bao nhiêu. */}
      <p className="mt-2 text-xs">
        Đã chia <b className="tabular-nums">{vnd(daChia)}</b>
        {conLai === 0 ? (
          <span className="ml-2 font-semibold text-state-success-ink">· khớp</span>
        ) : conLai > 0 ? (
          <span className="ml-2 font-semibold text-state-danger-ink">
            · còn THIẾU {vnd(conLai)}
          </span>
        ) : (
          <span className="ml-2 font-semibold text-state-danger-ink">
            · chia THỪA {vnd(-conLai)}
          </span>
        )}
      </p>
      {conLai === 0 && soBeDaNhap < 2 && (
        <p className="mt-1 text-xs text-state-warning-ink">
          Tách là chia cho từ hai bé trở lên — một bé thì dùng “Gắn cho bé…”.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" disabled={dangChay || !khop} onClick={gui}>
          {dangChay ? "Đang tách…" : "Tách"}
        </Button>
        <Button size="sm" variant="ghost" disabled={dangChay} onClick={dong}>
          Thôi
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Tách rồi thì <b>không gộp lại được</b>. Sửa nhầm: kế toán bỏ gắn từng phần rồi gắn
        hoặc tách lại.
      </p>
    </div>
  );
}

/**
 * G1 · US-22 — MIỄN GIẢM một phần nợ của một bé [22/09/2026].
 *
 * ⚠️ Mở TẠI CHỖ, không hộp thoại: người bấm cần nhìn con số "còn nợ" của bé ngay lúc gõ, và
 * trần của ô nhập CHÍNH LÀ con số ấy.
 *
 * ⚠️ Nút chỉ vẽ khi bé CÒN NỢ. Miễn giảm cho một bé hết nợ (hoặc đang đóng thừa) là thao tác
 * mà máy chủ luôn từ chối — vẽ nút ở đó là lời hứa suông (luật 12).
 */
function FormMienGiam({
  orderId,
  con,
  phieu,
  hapThu,
  daDungHoc,
  phieuThu,
  keHoachDon,
  conNoDon,
  tongDon,
  dong,
}: {
  orderId: string;
  con: ConVoiNhan;
  /** Phiếu gộp đang mở của đơn — để NÓI TRƯỚC nếu miễn giảm huỷ mã của cả nhà (rà vòng 4). */
  phieu: PhieuGopView | null;
  /**
   * Chính sách "giảm muộn trừ vào đợt nào" của cơ sở — CÙNG giá trị `mienGiamNoAction` đọc
   * (`docChinhSachUuDai(...).hapThu`). Không có mặc định (luật 7): đoán chính sách là đoán sai
   * đợt nào bị huỷ, tức lời nói trước sai.
   */
  hapThu: CachHapThu;
  /** Bé đã dừng học — cùng vế `status === "STOPPED"` mà đường ghi dùng. */
  daDungHoc: boolean;
  /**
   * Q-L — MỌI phiếu thu của đơn (kể cả phiếu CẤP ĐƠN) và kế hoạch đợt: `keHoachMienGiam` cần cả hai để
   * biết phần miễn trừ vào đâu (đợt của bé / phiếu cấp đơn dựng lại) hay bị CHẶN. BẮT BUỘC (luật 7).
   */
  phieuThu: readonly PhieuThuDeMien[];
  keHoachDon: readonly DongKeHoachDon[];
  /**
   * Rà vòng 6 — còn nợ CẢ ĐƠN (`so.conNoDon`, cùng `docSoTheoCon` đường ghi đọc dưới khoá) và tổng đơn
   * hiện tại (`order.totalAmount`). BẮT BUỘC (luật 7): thiếu vế đơn là đơn đã thu đủ vẫn miễn được im lặng.
   */
  conNoDon: number;
  tongDon: number;
  dong: () => void;
}) {
  const [oTien, datOTien] = useState("");
  const [lyDo, datLyDo] = useState("");
  const [dangChay, batDau] = useTransition();

  const soTien = Number((oTien || "").replace(/\D/g, "")) || 0;
  const toiDa = Math.max(0, con.conNo);
  // Rà vòng 4/5 + Q-L (luật 12): phiếu nào sẽ bị VOID & dựng lại, hay miễn giảm bị CHẶN — CHÍNH hàm
  // `keHoachMienGiam` mà `mienGiamNoChoCon` chạy trên cùng dữ liệu. Phiếu ấy nằm trong phiếu gộp ⇒ nói
  // TRƯỚC mã của cả nhà sẽ bị huỷ/đóng; bị chặn ⇒ in CHÍNH câu máy chủ trả và khoá nút.
  const keHoach =
    soTien > 0 && soTien <= toiDa
      ? keHoachMienGiam({ orderItemId: con.orderItemId, phieuThu, keHoachDon, canGiam: soTien, cach: hapThu, daDungHoc, conNoDon, tongDon })
      : null;
  const chan = keHoach?.cach === "CHAN" ? keHoach.loi : null;
  const canhBaoPhieu = keHoach ? canhBaoTruocVoidDot(phieu, dotSeHuyKhiMienGiam(keHoach)) : null;
  // Luật cũ (bé có đợt theo con đã nhận tiền): phần không trừ được vào đợt nào ⇒ QR vẫn đòi số cũ.
  const canhBaoChuaHapThu = keHoach ? canhBaoMienGiamChuaHapThu(chuaHapThuKhiMienGiam(keHoach)) : null;
  // Q-L: phần miễn trừ vào phiếu CẤP ĐƠN — nói phiếu nào dựng lại theo số mới.
  const moTaCapDon = keHoach ? moTaTruocMienGiamCapDon(keHoach) : null;
  const hopLe = keHoach !== null && !chan && !!lyDo.trim();

  const gui = () => {
    batDau(async () => {
      const r = await mienGiamNoAction({
        orderId,
        orderItemId: con.orderItemId,
        soTien,
        lyDo: lyDo.trim(),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `Đã miễn ${vnd(r.soTien)} cho ${r.tenCon}` +
          // Phiếu CẤP ĐƠN dựng lại thì câu `thongDiepCapDon` ngay dưới nói đúng phiếu nào (phiếu toàn đơn
          // không phải "đợt") — không đếm lại ở đây.
          (r.soDotDaDoi > 0 && !r.thongDiepCapDon ? ` — ${r.soDotDaDoi} đợt được tạo lại` : ""),
      );
      if (r.thongDiepPhieu) toast.warning(r.thongDiepPhieu, { duration: 15_000 });
      // Q-L: phiếu cấp đơn đã dựng lại theo số nào — đọc từ transaction thật (thẩm quyền cuối).
      if (r.thongDiepCapDon) toast.info(r.thongDiepCapDon, { duration: 15_000 });
      const baoChuaHapThu = canhBaoMienGiamChuaHapThu(r.chuaHapThu);
      if (baoChuaHapThu) toast.warning(baoChuaHapThu, { duration: 15_000 });
      dong();
    });
  };

  return (
    <div className="mt-3 rounded-lg border border-state-warning-soft bg-state-warning-soft/20 p-3">
      <p className="text-xs text-muted-foreground">
        Miễn một phần nợ của <b className="text-foreground">{con.nhan}</b>. Đây là tiền
        {" "}<b className="text-foreground">KHÔNG BAO GIỜ về</b> — không có bước duyệt nào phía
        sau và không hoàn tác được. Tối đa {vnd(toiDa)} (đúng phần bé còn nợ).
      </p>

      <div className="mt-2 space-y-2">
        <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="min-w-0 flex-1 text-sm">Số tiền miễn</span>
          <Input
            inputMode="numeric"
            className="tabular-nums sm:w-56"
            placeholder="0"
            value={oTien}
            onChange={(e) => datOTien(e.target.value)}
            aria-label={`Số tiền miễn giảm cho ${con.nhan}`}
          />
        </label>
        <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="min-w-0 flex-1 text-sm">Lý do *</span>
          <Input
            className="sm:w-56"
            placeholder="VD: hoàn cảnh gia đình, QLCS duyệt"
            value={lyDo}
            onChange={(e) => datLyDo(e.target.value)}
            aria-label="Lý do miễn giảm"
          />
        </label>
      </div>

      {/* Q-L: không có đường an toàn ⇒ máy chủ CHẮC CHẮN từ chối — in đúng câu đó, khoá nút (luật 12). */}
      {chan && (
        <p role="alert" className="mt-3 rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-xs text-state-danger-ink">
          {chan}
        </p>
      )}
      {moTaCapDon && (
        <p role="status" className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
          {moTaCapDon}
        </p>
      )}
      {canhBaoPhieu && (
        <div className="mt-3">
          <CanhBaoPhieuTruoc canhBao={canhBaoPhieu} />
        </div>
      )}
      {canhBaoChuaHapThu && (
        <p role="status" className="mt-3 rounded-lg border border-state-warning bg-state-warning-soft px-3 py-2 text-xs text-state-warning-ink">
          {canhBaoChuaHapThu}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={!hopLe || dangChay} onClick={gui}>
          {nhanNutKemPhieu("Miễn giảm", canhBaoPhieu)}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={dangChay} onClick={dong}>
          Huỷ
        </Button>
      </div>
    </div>
  );
}

/**
 * F1 — CHUYỂN TIỀN từ bé này sang bé khác CÙNG ĐƠN [22/09/2026].
 *
 * ⚠️ Mở TẠI CHỖ, không hộp thoại — cùng lối với "Tạo đợt" và "Tách khoản": người bấm cần
 * nhìn thấy con số "đã thu" và "còn nợ" của cả hai bé ngay lúc gõ. Chỉ "Dừng học" mới
 * dùng hộp thoại, vì nó không hoàn tác được.
 */
function FormChuyenTien({
  orderId,
  cho,
  con,
  dong,
}: {
  orderId: string;
  cho: ConVoiNhan;
  con: ConVoiNhan[];
  dong: () => void;
}) {
  const conLai = con.filter((c) => c.orderItemId !== cho.orderItemId);
  const [den, datDen] = useState(conLai[0]?.orderItemId ?? "");
  const [oTien, datOTien] = useState("");
  const [lyDo, datLyDo] = useState("");
  const [dangChay, batDau] = useTransition();

  const beNhan = conLai.find((c) => c.orderItemId === den);
  const soTien = Number((oTien || "").replace(/\D/g, "")) || 0;
  // Gợi ý = nhỏ hơn giữa hai trần. CHỈ là gợi ý — cổng thật nằm ở máy chủ.
  const toiDa = beNhan ? Math.min(Math.max(0, cho.daThu), Math.max(0, beNhan.conNo)) : 0;
  const hopLe = soTien > 0 && soTien <= toiDa && !!lyDo.trim() && !!beNhan;

  const gui = () => {
    batDau(async () => {
      const r = await chuyenTienGiuaConAction({
        orderId,
        tuOrderItemId: cho.orderItemId,
        denOrderItemId: den,
        soTien,
        lyDo: lyDo.trim(),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Đã chuyển ${vnd(r.soTien)} từ ${r.tenCho} sang ${r.tenNhan}`);
      dong();
    });
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-background p-3">
      <p className="text-xs text-muted-foreground">
        Chuyển phần <b className="text-foreground">kế toán ĐÃ XÁC NHẬN</b> của {cho.nhan}
        {" "}sang một bé khác cùng đơn. Tối đa {vnd(Math.max(0, cho.daThu))} (phần đã xác nhận
        của {cho.nhan}), và không vượt phần còn nợ của bé nhận.
      </p>

      <div className="mt-2 space-y-2">
        <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="min-w-0 flex-1 text-sm">Chuyển sang</span>
          <select
            aria-label="Chọn bé nhận tiền"
            className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm sm:w-56"
            value={den}
            onChange={(e) => datDen(e.target.value)}
          >
            {conLai.map((c) => (
              <option key={c.orderItemId} value={c.orderItemId}>
                {c.nhan} — còn nợ {vnd(Math.max(0, c.conNo))}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="min-w-0 flex-1 text-sm">
            Số tiền
            <span className="ml-2 text-xs text-muted-foreground">tối đa {vnd(toiDa)}</span>
          </span>
          <Input
            inputMode="numeric"
            className="tabular-nums sm:w-56"
            placeholder="0"
            value={oTien}
            onChange={(e) => datOTien(e.target.value)}
            aria-label={`Số tiền chuyển từ ${cho.nhan}`}
          />
        </label>

        <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="min-w-0 flex-1 text-sm">Lý do *</span>
          <Input
            className="sm:w-56"
            placeholder="VD: gắn nhầm bé lúc đối soát"
            value={lyDo}
            onChange={(e) => datLyDo(e.target.value)}
            aria-label="Lý do chuyển tiền"
          />
        </label>
      </div>

      {/* Nút bị vô hiệu thì phải NÓI VÌ SAO (luật 12) — nếu không, người vận hành đọc nó
          như hệ thống hỏng và đi tìm nhầm chỗ. Ca thật: mọi bé còn lại đều hết nợ. */}
      {toiDa <= 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
          {beNhan
            ? `${beNhan.nhan} không còn nợ đồng nào — chuyển sang là làm bé đó đóng thừa.`
            : "Đơn không còn bé nào khác để nhận."}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={!hopLe || dangChay} onClick={gui}>
          Chuyển
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={dangChay} onClick={dong}>
          Huỷ
        </Button>
      </div>
    </div>
  );
}

/**
 * KHỐI "KHOẢN ĐÃ THU CHƯA GẮN CON" — đường B [18/09/2026].
 *
 * ⚠️ Trước bản này chỗ đây là một dòng chữ tĩnh *"Gắn ở màn Thanh toán"* — và câu ấy KHÔNG
 * ĐÚNG với đơn nhiều con: màn biến động số dư chỉ thao tác trên `BankTransaction` đang
 * `UNMATCHED`, còn 4 khoản của `ORD-260917-000001` là `Payment` nhập tay, không có giao dịch
 * nào phía sau. Người đọc dòng ấy sẽ đi sang màn kia và không tìm thấy gì.
 * Affordance phải nói thật (luật 12) — nên nút nằm ở đây, ngay cạnh con số.
 *
 * ⚠️ **[ĐẢO 20/09/2026]** Câu "chưa tách được một khoản cho hai bé" ĐÃ HẾT ĐÚNG — nút
 * "Tách cho nhiều bé…" nằm ngay cạnh "Gắn cho bé…". Giữ lại vế còn đúng: MỘT lần bấm "Gắn"
 * vẫn cho đúng MỘT bé; muốn chia thì bấm nút kia.
 */
function KhoiKhoanChoGan({
  orderId,
  khoan,
  con,
  duocGan,
}: {
  orderId: string;
  khoan: NoTheoConKetQua["khoanDaVeChiTiet"];
  con: ConVoiNhan[];
  duocGan: boolean;
}) {
  const [dangChon, datDangChon] = useState<string | null>(null);
  const [beDaChon, datBeDaChon] = useState<string>("");
  /** Khoản nào đang mở form TÁCH. Rời với `dangChon` — hai việc, hai form, không chồng nhau. */
  const [dangTach, datDangTach] = useState<string | null>(null);
  const [dangChay, batDau] = useTransition();

  if (khoan.length === 0) return null;
  const tong = khoan.reduce((s, k) => s + k.amount, 0);

  const gan = (paymentId: string) => {
    if (!beDaChon) {
      toast.error("Chọn bé trước đã");
      return;
    }
    batDau(async () => {
      const r = await ganKhoanChoConAction({ orderId, paymentId, orderItemId: beDaChon });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Đã gắn ${vnd(r.soTien)} cho ${r.tenCon}`);
      datDangChon(null);
      datBeDaChon("");
    });
  };

  return (
    <div className="mb-4 rounded-lg border border-state-warning-ink/25 bg-state-warning-soft p-3">
      <p className="text-sm text-state-warning-ink">
        Có <b className="tabular-nums">{vnd(tong)}</b> đã vào đơn nhưng{" "}
        <b>chưa gắn cho con nào</b> — công nợ từng con chưa trừ khoản này.
      </p>

      <ul className="mt-2 space-y-2">
        {khoan.map((k) => {
          const moChon = dangChon === k.id;
          return (
            <li key={k.id} className="rounded-md bg-background/70 px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <span className="min-w-0 text-sm">
                  <b className="tabular-nums">{vnd(k.amount)}</b>
                  {k.trangThaiKeToan !== "CONFIRMED" && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      kế toán chưa xác nhận
                    </span>
                  )}
                </span>
                {duocGan && !moChon && dangTach !== k.id && (
                  <span className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" onClick={() => datDangChon(k.id)}>
                      Gắn cho bé…
                    </Button>
                    {/* Chỉ mời TÁCH khi đơn có từ hai bé — một bé thì tách vô nghĩa và cổng
                        sẽ từ chối. Đừng vẽ nút rồi để cổng nói không (luật 12). */}
                    {con.length >= 2 && (
                      <Button size="sm" variant="outline" onClick={() => datDangTach(k.id)}>
                        Tách cho nhiều bé…
                      </Button>
                    )}
                  </span>
                )}
              </div>

              {moChon && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/* `select` thuần chứ không phải shadcn `Select`: danh sách chỉ 2-3 bé và
                      `SelectValue` của base-ui hiện GIÁ TRỊ THÔ chứ không tra nhãn — một bẫy
                      đã ghi trong sổ repo. */}
                  <select
                    aria-label="Chọn bé để gắn khoản này"
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                    value={beDaChon}
                    onChange={(e) => datBeDaChon(e.target.value)}
                  >
                    <option value="">— chọn bé —</option>
                    {con.map((c) => (
                      <option key={c.orderItemId} value={c.orderItemId}>
                        {c.nhan}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" disabled={dangChay} onClick={() => gan(k.id)}>
                    Gắn
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={dangChay}
                    onClick={() => {
                      datDangChon(null);
                      datBeDaChon("");
                    }}
                  >
                    Thôi
                  </Button>
                </div>
              )}

              {dangTach === k.id && (
                <FormTachKhoan
                  orderId={orderId}
                  paymentId={k.id}
                  soTienKhoan={k.amount}
                  con={con}
                  dong={() => datDangTach(null)}
                />
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-xs text-state-warning-ink/80">
        Một lần bấm <b>“Gắn cho bé…”</b> cho đúng một bé. Phụ huynh chuyển một lần cho nhiều
        con thì bấm <b>“Tách cho nhiều bé…”</b> — tổng các phần phải đúng bằng số tiền khoản,
        và <b>tách rồi không gộp lại được</b>.
      </p>
    </div>
  );
}

/**
 * Các khoản ĐÃ gắn cho một bé, kèm nút bỏ gắn (kế toán).
 *
 * Bỏ gắn BẮT BUỘC ghi lý do — đây là đường sửa quyết định của người khác, nên nó phải để lại
 * câu trả lời cho "vì sao". Ô lý do mở TẠI CHỖ, không hộp thoại: cùng lối với form tạo đợt
 * ngay dưới, và việc này không cần ngắt mạch người dùng.
 */
function KhoanCuaCon({
  orderId,
  khoan,
  duocBoGan,
}: {
  orderId: string;
  khoan: NoTheoConKetQua["khoanDaVeChiTiet"];
  duocBoGan: boolean;
}) {
  const [dangMo, datDangMo] = useState<string | null>(null);
  const [lyDo, datLyDo] = useState("");
  const [dangChay, batDau] = useTransition();

  if (khoan.length === 0) return null;

  const boGan = (paymentId: string) => {
    if (!lyDo.trim()) {
      toast.error("Ghi lý do bỏ gắn");
      return;
    }
    batDau(async () => {
      const r = await boGanKhoanChoConAction({ orderId, paymentId, lyDo });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Đã bỏ gắn ${vnd(r.soTien)}`);
      datDangMo(null);
      datLyDo("");
    });
  };

  return (
    <ul className="mt-2 space-y-1">
      {khoan.map((k) => (
        <li key={k.id} className="rounded-md bg-muted/40 px-2 py-1.5 text-xs">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="min-w-0 text-muted-foreground">
              Khoản <b className="tabular-nums text-foreground">{vnd(k.amount)}</b>
              {k.trangThaiKeToan !== "CONFIRMED" && " · kế toán chưa xác nhận"}
            </span>
            {/* Bút toán ĐẢO (số âm) không phải khoản để bỏ gắn — bỏ gắn nó là đưa một dòng
                đối ứng ra khỏi bé trong khi dòng nó đối ứng vẫn ở đó. Ẩn nút thay vì để cổng
                từ chối sau khi bấm (luật 12). */}
            {duocBoGan && k.loaiButToan === "PAYMENT" && dangMo !== k.id && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-state-danger-ink hover:underline"
                onClick={() => datDangMo(k.id)}
              >
                Bỏ gắn bé
              </button>
            )}
          </div>
          {dangMo === k.id && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Input
                className="h-8 min-w-0 flex-1 text-xs"
                placeholder="Lý do bỏ gắn (bắt buộc)"
                value={lyDo}
                onChange={(e) => datLyDo(e.target.value)}
              />
              <Button size="sm" variant="destructive" disabled={dangChay} onClick={() => boGan(k.id)}>
                Bỏ gắn
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
        </li>
      ))}
    </ul>
  );
}

/**
 * Phiếu gộp đang mở của đơn — bộ số màn hình cần, đã dựng sẵn ở SERVER.
 *
 * ⚠️ `qrUrl` và `noiDungCk` dựng ở server chứ không ở đây, vì cả hai đều cần tài khoản nhận
 * tiền của cơ sở (`resolveOrderPaymentConfig`) và cần biết người xem có `orders:view-pii`
 * không. Dựng ở client là hoặc lộ SĐT cho người không có quyền, hoặc nhúng một chuỗi ĐÃ CHE
 * vào ảnh QR — và QR mang chuỗi che thì tiền không về được.
 */
export type PhieuGopView = {
  billId: string;
  ma: string;
  tongTien: number;
  /** Σ đã rót vào các đợt của phiếu. > 0 ⇒ chỉ ĐÓNG được, không huỷ được. */
  daNhan: number;
  dong: {
    /** ĐỊNH DANH đợt — bảng phiếu thu cần nó để biết dòng nào đang giữ mã này. */
    paymentRequestId: string;
    installmentNo: number;
    ten: string;
    soTien: number;
  }[];
  /** `null` khi cơ sở chưa khai tài khoản, hoặc người xem thiếu `orders:view-pii`. */
  qrUrl: string | null;
  /** Nội dung chuyển khoản — bản HIỂN THỊ (có thể đã che SĐT). */
  noiDungCk: string;
};


/**
 * THANH "IN QR" — hiện khi sale đã tick ít nhất một đợt.
 *
 * ⚠️ Nút in ĐÚNG số tiền sắp đòi ngay trên mặt nút. Một nút "In QR" trần trụi buộc người bấm
 * tự cộng nhẩm các ô vừa tick, và cộng nhẩm sai thì tờ QR đòi sai — mà lúc đó phụ huynh là
 * người phát hiện ra.
 */
function ThanhInQr({
  orderId,
  chon,
  tong,
  xoaChon,
}: {
  orderId: string;
  chon: string[];
  tong: number;
  xoaChon: () => void;
}) {
  const [dangChay, batDau] = useTransition();
  if (chon.length === 0) return null;

  const gui = () => {
    batDau(async () => {
      const r = await taoPhieuGopAction({ orderId, paymentRequestIds: chon });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Đã phát phiếu ${r.ma} — ${vnd(r.tongTien)}`);
      xoaChon();
    });
  };

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3">
      <p className="min-w-0 text-sm">
        Đã chọn <b>{chon.length}</b> đợt · tổng{" "}
        <b className="tabular-nums">{vnd(tong)}</b>
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={dangChay} onClick={gui}>
          {dangChay ? "Đang phát…" : `In QR ${vnd(tong)}`}
        </Button>
        <Button size="sm" variant="ghost" disabled={dangChay} onClick={xoaChon}>
          Bỏ chọn
        </Button>
      </div>
    </div>
  );
}

export function CongNoTheoCon({
  orderId,
  so,
  duocSua,
  duocGan,
  duocBoGan,
  dungHoc,
  baoLuu,
  themCon = null,
  lopDoiKhoa = [],
  phieu = null,
  hapThu,
  dotDon = [],
  phieuThu,
  keHoachDon,
  tongDon,
  tenConLead,
}: {
  orderId: string;
  so: NoTheoConKetQua;
  /** Người xem có quyền tạo/huỷ đợt không. Ẩn nút KHÔNG phải kiểm quyền — action tự kiểm. */
  duocSua: boolean;
  /** `payments:record` — gắn một khoản đã thu cho một bé (đường B) + phát/huỷ phiếu gộp. */
  duocGan: boolean;
  /** `payments:manage` — bỏ gắn, đóng phiếu đã nhận tiền. Kế toán. */
  duocBoGan: boolean;
  /**
   * PHIÊN D — trạng thái dừng học + tình hình hoàn tiền của TỪNG dòng, khoá theo
   * `orderItemId`. Dựng ở server bằng `docTrangThaiDungHoc`.
   *
   * ⚠️ Dòng thiếu khoá trong map này được coi là CÒN HỌC. Mặc định fail-safe theo hướng
   * "chưa dừng": hiện nhầm một bé đã dừng thành còn học thì người ta thấy ngay và bấm lại;
   * hiện nhầm chiều ngược lại là giấu mất nút của một bé đang học.
   */
  dungHoc?: Record<string, TrangThaiDungHocCuaCon>;
  /**
   * F2 — con nào ĐANG BẢO LƯU, khoá theo `orderItemId`. Dựng ở server bằng
   * `docBaoLuuCuaDon` (`lib/finance/bao-luu-tien.ts`).
   *
   * ⚠️ Chỉ để HIỂN THỊ. Màn này KHÔNG có nút bảo lưu, và đó là chủ đích: cửa bảo lưu ở
   * màn học viên (`/students/<id>/edit`) vì bảo lưu là việc học vụ (dừng lịch học, dừng
   * giao bài) mà tiền chỉ đi theo. Thêm nút thứ hai ở đây là hai cửa cho một trạng thái.
   */
  baoLuu?: Record<string, { reserveId: string; startedAt: Date | string; expectedEndAt: Date | string | null; soNgayDaDoiHan: number | null }>;
  /**
   * F3 — nút "Thêm con vào đơn…" (hộp thoại riêng, dựng ở trang vì nó cần danh sách khoá học).
   *
   * ⚠️ Nhận sẵn phần tử chứ không nhận `khoa[]` rồi tự vẽ: khối này là client component và
   * danh sách khoá học là một câu tra DB. Đẩy câu tra xuống client là một lượt đi về nữa cho
   * một danh sách hầu như không đổi.
   */
  themCon?: React.ReactNode;
  /**
   * F4 — lớp chọn được khi đổi khoá. Rỗng ⇒ KHÔNG vẽ nút (luật 12: nút dẫn thẳng tới một
   * danh sách trống là lời hứa suông).
   */
  lopDoiKhoa?: LopChon[];
  /** Phiếu gộp ĐANG MỞ của đơn, `null` khi chưa phát. Dựng ở server — xem `PhieuGopView`. */
  phieu?: PhieuGopView | null;
  /**
   * Chính sách hấp thụ phần giảm muộn của cơ sở (`docChinhSachUuDai`) — form miễn giảm cần nó để
   * NÓI TRƯỚC đợt nào sẽ bị huỷ (rà vòng 4). BẮT BUỘC, không mặc định (luật 7).
   */
  hapThu: CachHapThu;
  /**
   * PHIÊN J — các đợt CẤP ĐƠN đang sống (`PaymentRequest.orderItemId IS NULL`, chưa VOID),
   * nguồn của bảng "học phí từng con theo các đợt của đơn".
   *
   * ⚠️ Rỗng ⇒ KHÔNG vẽ bảng. Đơn chưa chia đợt thì một cái bảng một cột không nói thêm gì
   * so với con số "còn nợ" đã có ngay trên (luật 12: đừng vẽ thứ không mang thông tin).
   *
   * ⚠️ Chỉ HIỂN THỊ. Mọi phép thu/đối khớp vẫn đi qua chính các đợt cấp đơn này — bảng
   * không sinh phiếu, không sinh QR. Lý do đầy đủ ở đầu `lib/finance/chia-dot-cho-con.ts`.
   */
  dotDon?: readonly DotDonDeChia[];
  /**
   * Q-L (chủ dự án chốt 30/09/2026) — MỌI phiếu thu của đơn (`paymentRequests` của trang, kèm số đã rót)
   * và kế hoạch đợt (`order.installments`): form miễn giảm NÓI TRƯỚC phiếu cấp đơn nào sẽ dựng lại / bị
   * chặn bằng CHÍNH `keHoachMienGiam` đường ghi dùng. BẮT BUỘC, không mặc định (luật 7) — mặc định rỗng
   * là màn nói "không phiếu nào bị chạm" trong khi máy chủ huỷ mã của cả nhà.
   */
  phieuThu: readonly PhieuThuDeMien[];
  keHoachDon: readonly DongKeHoachDon[];
  /** Rà vòng 6 — `order.totalAmount`: form miễn giảm tính phiếu toàn đơn dựng lại theo nó. BẮT BUỘC (luật 7). */
  tongDon: number;
  /**
   * `LeadChild.id → fullName` cho các dòng CHƯA có hồ sơ học viên [25/09/2026].
   *
   * ⚠️ BẮT BUỘC, cố ý không cho mặc định `{}` (luật 7 + luật 11). Mặc định rỗng là một
   * lỗi CÂM hoàn hảo: không lỗi biên dịch, không ca test nào đỏ, và triệu chứng là MỌI
   * dòng hiện "chưa gắn bé" — trông y hệt dữ liệu cũ. Bắt buộc truyền thì `tsc` liệt kê
   * chỗ gọi. Nhánh này chiếm 96,8% số lead (đo `satarobo_local`), không phải ca biên.
   */
  tenConLead: Record<string, string>;
}) {
  const [dangMoForm, datDangMoForm] = useState<string | null>(null);
  /** F1 — bé nào đang mở form chuyển tiền. Một lúc chỉ một. */
  const [dangMoChuyen, datDangMoChuyen] = useState<string | null>(null);
  /** G1 — bé nào đang mở form miễn giảm. Một lúc một. */
  const [dangMoMien, datDangMoMien] = useState<string | null>(null);
  /**
   * Hai hộp thoại mở TỪ MENU `⋯` nên trạng thái phải sống ở đây, ngoài menu.
   *
   * ⚠️ Để trigger bên trong `DropdownMenuItem` thì lần bấm đóng menu → menu unmount →
   * hộp thoại vừa mở biến mất ngay. Người dùng thấy một cái nháy rồi không có gì, và
   * không lỗi nào báo.
   */
  const [dangMoDung, datDangMoDung] = useState<string | null>(null);
  const [dangMoDoiKhoa, datDangMoDoiKhoa] = useState<string | null>(null);
  /**
   * Các đợt sale đang tick để gộp thành MỘT phiếu.
   *
   * ⚠️ State nằm ở ĐÂY chứ không trong từng khối con: một phiếu gộp trải trên NHIỀU con, nên
   * lựa chọn phải sống ở chỗ nhìn thấy cả hai. Đặt trong khối con là mỗi bé một rổ riêng và
   * không bao giờ gộp được — đúng thứ tính năng này sinh ra để làm.
   */
  const [chon, datChon] = useState<string[]>([]);
  const coPhieu = phieu != null;
  // Đang có phiếu OPEN thì KHÔNG cho tick tiếp: B7 (một đơn một phiếu) do DB gác, và một ô
  // tick dẫn tới câu từ chối là affordance nói dối.
  const choPhepChon = duocGan && !coPhieu;
  const tongChon = so.con
    .flatMap((c) => c.dotDangMo)
    .filter((d) => chon.includes(d.id))
    .reduce((s, d) => s + Math.max(0, d.amountDue - d.daRot), 0);

  // ── NHÃN NGƯỜI ĐỌC CỦA TỪNG CON — dựng MỘT LẦN [25/09/2026] ────────────────────
  //
  // Chủ dự án: *"2 con học cùng khoá thì sao biết là đang giảm đơn cho con nào?"*
  // Không biết được, vì `c.ten` là `OrderItem.itemName` = tên KHOÁ trên đường tạo đơn
  // chính. Từ đây trở xuống, mọi nhãn NGƯỜI ĐỌC dùng `c.nhan` / `c.tenBe`; `c.ten` chỉ
  // còn là nhãn KHOÁ/SẢN PHẨM.
  const banDoTenCon = new Map(Object.entries(tenConLead));
  const conNhan: ConVoiNhan[] = so.con.map((c) => {
    const n = tenConTrenDong(c, banDoTenCon);
    return { ...c, tenBe: n?.ten ?? null, nhan: moTaDong(n, c.ten) };
  });
  /** `orderItemId → nhãn chính` cho bảng chia đợt (nó chỉ cầm `orderItemId`). */
  const nhanTheoDong = new Map(conNhan.map((c) => [c.orderItemId, c.tenBe ?? c.ten]));

  // PHIÊN J — bảng chia đợt. Tính Ở ĐÂY chứ không trong JSX: đây là phép tính trên tiền,
  // và một phép tính inline trong JSX không có chỗ cấy lỗi (luật 12b). Hàm thuần, có bộ ca
  // `[CDC-*]`; chỗ này chỉ nạp đầu vào.
  //
  // ⚠️ `phaiThu` + `daThu` lấy thẳng từ `so.con` — KHÔNG tính lại. Dựng lại hai con số ấy ở
  // đây là đẻ định nghĩa "đã thu" thứ sáu, đúng thứ `lib/finance/no-theo-con.ts` sinh ra để
  // chấm dứt.
  const ketChiaDot =
    dotDon.length > 0
      ? chiaDotChoCon({
          dot: dotDon,
          con: so.con.map((c) => ({
            orderItemId: c.orderItemId,
            ten: c.ten,
            phaiThu: c.phaiThu,
            daThu: c.daThu,
          })),
        })
      : null;

  // ⚠️ ĐƠN DƯỚI HAI CON: KHÔNG DỰNG GÌ CẢ [chủ dự án chốt 25/09/2026].
  //
  //   *"nếu 1 con thì bỏ luôn chứ, nếu lead đó thêm 1 con thì mới xuất hiện, vì nó lấy
  //   lại thông tin của Công nợ đơn hàng rồi"*
  //
  // Đo trên đơn thật `ORD-260925-000001` (1 con): khối này in
  // `19.860.014 / — / — / 19.860.014`, còn khối "Công nợ đơn hàng" ngay trên cùng cột in
  // `19.860.014 / 0đ / 19.860.014 / 0đ`. Bốn con số trùng khít — vì với một con thì
  // "theo con" và "theo đơn" là cùng một phép cộng. Hai khối nói cùng một điều là một
  // khối thừa, và người đọc phải tự đoán vì sao có hai.
  //
  // Đơn 0 dòng cũng không dựng: một khối chỉ để nói "chưa có gì" là một khối chiếm chỗ.
  //
  // 🔴 HỆ QUẢ PHẢI BIẾT, ĐÃ ĐO: khối này là LỐI VÀO DUY NHẤT của năm việc theo con —
  // `Dừng học` · `Đổi khoá/đổi lớp` · `Miễn giảm nợ` · `Chuyển tiền sang bé khác` ·
  // `Gắn khoản đã thu cho bé`. `grep` toàn thư mục `app` + `components` ra 0 tệp nào khác
  // dựng chúng. Với đơn MỘT CON, ba việc đầu vẫn có nghĩa (bé nghỉ, đổi khoá, miễn nợ)
  // nhưng nay KHÔNG còn đường nào bấm tới.
  //
  // Đây là nợ ĐANG GHIM, không phải chuyện đã xong: chỗ đúng cho chúng là hàng của dòng
  // hàng trong khối "Sản phẩm" (một dòng hàng = một bé), vì đó là hành động CỦA DÒNG.
  // Ghim ở `[CDC-10]`.
  //
  // ⚠️ Đừng viết glob "thư mục + gạch chéo + hai dấu sao" trong dòng `//` của tệp này [01/10/2026]:
  // lưới bóc chú thích KHỐI trước coi cặp gạch-chéo-sao ấy là chỗ mở khối và nuốt mã phía sau.
  // Đo khi rà gộp `test`: `[QTD-W4]` mù ~45 dòng ngay dưới đây (cấy một lời gọi action thu hồi phiếu vào đó ⇒ lưới vẫn xanh).
  if (so.con.length < 2) return null;

  // Hai hộp thoại mở từ menu `⋯` dựng NGOÀI `<table>` — xem chú thích ở chỗ dựng.
  // Điều kiện `!daDung` lặp lại Ở ĐÂY có chủ đích: mục menu đã gác rồi, nhưng trạng thái
  // sống qua một lần render nên nếu bé bị dừng bởi một tab khác thì hộp thoại đang mở
  // phải tự đóng, không được thành một cửa sau.
  const conDangDung = conNhan.find(
    (x) => x.orderItemId === dangMoDung && !dungHoc?.[x.orderItemId]?.daDung,
  );
  const conDangDoiKhoa = conNhan.find(
    (x) => x.orderItemId === dangMoDoiKhoa && !dungHoc?.[x.orderItemId]?.daDung,
  );

  return (
    <section
      aria-labelledby="cong-no-theo-con-title"
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="cong-no-theo-con-title"
          className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground"
        >
          <Users className="size-4 text-muted-foreground" aria-hidden />
          Công nợ theo con
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {/* ⚠️ HAI CON SỐ TỔNG ĐÃ GỠ KHỎI ĐÂY [PHIÊN K · 24/09/2026] — chúng nay ở hàng
              `<tfoot>` của bảng, đứng đúng cuối cột mà chúng cộng.

              Trước lượt này con số tổng in ở BỐN chỗ trên cùng một màn: dòng này, hàng
              "Tổng đợt" của bảng chia đợt, các ô "Học phí" của từng thẻ, và cột "Tổng"
              của bảng chia đợt. Tệ hơn: khi chưa thu đồng nào thì `tongPhaiThu` bằng
              đúng `tongConNo`, nên riêng dòng này in CÙNG MỘT SỐ hai lần liền nhau
              ("Tổng 19.959.999đ · còn nợ 19.959.999đ").

              Một con số trôi nổi cạnh tiêu đề không nói được nó là cộng của cái gì; nằm
              cuối cột thì nói được. Đừng đưa nó về đây. */}
          {/* F3 — "Thêm con vào đơn…" đặt ở ĐẦU khối, cạnh con số tổng: nó là thao tác trên
              CẢ ĐƠN (đổi tổng đơn, có thể đổi ưu đãi của mọi bé), không phải thao tác của
              một dòng. Đặt nó dưới một bé cụ thể là nói sai phạm vi của nó. */}
          {duocSua && themCon}
        </div>
      </div>

      {/* Tiền đã vào đơn mà chưa gắn con nào. KHÔNG cộng vào "đã thu" của bất kỳ bé nào —
          cộng vào là tổng đơn trông đúng trong khi từng con vẫn sai.

          ⚠️ Lọc từ `khoanDaVeChiTiet` (tập RỘNG) chứ KHÔNG dùng `so.chuaGanCon > 0` như bản
          cũ: `chuaGanCon` chỉ cộng trục A, nên với 4 khoản `PENDING` của
          `ORD-260917-000001` nó ra 0 và cả khối này BIẾN MẤT — tiền có thật mà màn hình câm.
          Đo được 18/09, không phải phòng xa. */}
      {/* PHIÊN C — phiếu gộp. Đặt TRÊN khối "khoản chờ gắn" có chủ đích: phiếu là việc SẮP
          làm (đang chờ tiền), còn khoản chờ gắn là việc ĐÃ RỒI cần dọn. Thứ tự đọc của màn
          hình nên theo thứ tự đó. */}
      {/* ⚠️ PHIẾU GỘP ĐÃ DỜI HẲN XUỐNG KHỐI "PHIẾU THU & QR THEO ĐỢT" [24/09/2026].
          Chủ dự án: *"chỗ thu hồi phiếu cũng bỏ xuống dưới phần QR luôn chứ"*.

          Bản trước để MỘT NỬA ở đây (mã · tổng · huỷ/đóng) và một nửa ở dưới (ảnh QR) —
          người dùng phải nhìn hai chỗ cho một tờ phiếu. Nay cả phiếu ở một chỗ: xem mã,
          đưa khách, và huỷ/đóng đều tại khối QR.

          Khối này quay về đúng việc của nó: CÔNG NỢ THEO CON. */}
      {choPhepChon && (
        <ThanhInQr
          orderId={orderId}
          chon={chon}
          tong={tongChon}
          xoaChon={() => datChon([])}
        />
      )}

      {/* ⚠️ Lọc thêm HAI vế kể từ phép TÁCH [20/09/2026]. Tách để lại dòng gốc + một bút
          toán đảo, CẢ HAI mang `orderItemId = NULL`; không lọc thì khối này liệt kê một dòng
          `+9.530.000` và một dòng `−9.530.000`, mỗi dòng một nút "Gắn cho bé…" — tổng in ra
          đúng (0đ) mà danh sách thì vô nghĩa, và bấm vào đâu cũng sai.

          · `loaiButToan === "PAYMENT"` — bút toán đảo không phải tiền để gắn;
          · `!daDao`                    — dòng đã bị đảo thì phần tiền của nó nay nằm ở n dòng
                                          mới, gắn nó lần nữa là gắn một khoản đã tiêu.

          Hai trường này KHÔNG đụng vào phép cộng nào (xem `KhoanDaVe`) — chúng chỉ quyết
          định màn hình mời bấm cái gì. */}
      <KhoiKhoanChoGan
        orderId={orderId}
        khoan={so.khoanDaVeChiTiet.filter(
          (k) => k.orderItemId == null && k.loaiButToan === "PAYMENT" && !k.daDao,
        )}
        con={conNhan}
        duocGan={duocGan}
      />

      {/* ── BẢNG SỐ THEO CON ─────────────────────────────────────────────────────────
          PHIÊN K · 24/09/2026. Chủ dự án: *"làm lại session công nợ theo con này gọn hơn"*.

          Trước lượt này mỗi con là một THẺ: tên + bốn ô số `text-xl` + một dải 3–5 nút.
          Đo trên đơn 2 con chưa thu đồng nào (ảnh chụp thật):
            · thẻ con  ≈ 160px × 2
            · riêng hàng bốn ô ≈ 58px/con để in 8 con số, mà 6 trong 8 là "0đ" hoặc suy
              ra được — "Còn nợ" khi chưa thu ĐÚNG BẰNG "Học phí" ngay bên cạnh;
            · ô "Học phí" in lại ĐÚNG cột "Tổng" của bảng chia đợt ngay trên (bất biến
              `tong === phaiThu`, `chia-dot-cho-con.ts`), nên cùng một số nằm ba chỗ;
            · dải nút KHÔNG có container flex: năm nút là anh em trực tiếp của `<li>`,
              mỗi nút tự cõng `mt-3` và `Button` là `inline-flex` ⇒ gap 0 và xuống dòng
              theo luồng inline. Nút rộng nhất, "Tạo đợt cho {tên con}", lặp lại nguyên
              tên con đã in cách đó vài chục pixel.

          Nay: MỘT DÒNG MỘT CON, 44px, đúng chuẩn mật độ admin (`adminTh`/`adminTd` —
          24 tệp admin đã dùng, tệp này trước đó không dùng cái nào và tự gõ `py-1.5`).

          ⚠️ BỀ RỘNG BẢNG NÀY KHÔNG PHỤ THUỘC SỐ ĐỢT — đúng 6 cột, mãi mãi. Đó là lý do
          nó TÁCH khỏi bảng chia đợt phía trên chứ không gộp vào: gộp thì đơn 12 đợt đẩy
          ô hành động ra sau ~2.300px, và "+ Đợt" chỉ bấm được sau một quãng cuộn dài.

          ⚠️ BẢNG NÀY LUÔN DỰNG khi có con, TUYỆT ĐỐI không phụ thuộc `ketChiaDot`. Bảng
          chia đợt biến mất theo HAI đường (`dotDon` rỗng · `ket.co === false`); nếu số
          của từng con chỉ sống trong đó thì đơn chưa chia đợt sẽ không in học phí / đã
          thu / còn nợ của bé ở BẤT KỲ đâu. */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th scope="col" className={adminTh}>
                Con
              </th>
              <th scope="col" className={`${adminTh} text-right`}>
                Phải thu
              </th>
              <th scope="col" className={`${adminTh} text-right`}>
                Đã thu
              </th>
              <th scope="col" className={`${adminTh} text-right`}>
                Chờ xác nhận
              </th>
              {/* "Còn nợ" đứng NGAY TRƯỚC ô hành động, có chủ đích: ở bề ngang hẹp phải
                  cuộn mới tới nút, và khi cuộn tới thì con số quyết định việc bấm nằm
                  ngay cạnh. Đảo thứ tự hai cột này là bắt người ta cuộn đi cuộn lại. */}
              <th scope="col" className={`${adminTh} text-right`}>
                Còn nợ
              </th>
              {/* ⚠️ `aria-label` trên chính `<th>`, KHÔNG phải `<span className="sr-only">`.
                  Đo 25/09/2026: `sr-only` là `position:absolute`, mà thẻ bọc
                  `overflow-x-auto` không `relative` ⇒ nó THOÁT khỏi khung cuộn và kéo
                  `document.scrollWidth` lên 672px ở màn 375px — tức cả TRANG tràn ngang
                  297px trong khi cái bảng 770px thì đã bị kẹp đúng.

                  Ca `[TTC-05]` bắt được. Một phần tử rộng 1px, ẩn hoàn toàn, làm tràn cả
                  trang: không nhìn bằng mắt nào thấy, chỉ phép đo thấy. */}
              <th scope="col" className={adminTh} aria-label="Hành động" />
            </tr>
          </thead>

          {conNhan.map((c) => {
            // ⚠️ TRẦN LẤY TỪ HÀM DÙNG CHUNG, không tự trừ tại chỗ. Bản trước tính
            // `c.conNo - c.tongDotDangMo` — đúng MỘT trong hai vế của `kiemTaoDot`, nên
            // trên đơn đã có kế hoạch phủ trọn học phí thì nút `+ Đợt` vẫn hiện và form
            // in "tối đa 9.879.992đ" trong khi máy chủ từ chối cả 1 đồng.
            const tran = tranTaoDot({
              conNo: c.conNo,
              tongDotDangMo: c.tongDotDangMo,
              conNoDon: so.conNoDon,
              tongDotDangMoDon: so.tongDotDangMoDon,
              soDotDon: so.con.reduce((n, x) => n + x.dotDangMo.length, 0) + so.dotChuaGanCon.length,
            });
            const conLaiTaoDot = tran.duoc ? tran.toiDa : 0;
            const moForm = dangMoForm === c.orderItemId;
            const tt = dungHoc?.[c.orderItemId];
            const bl = baoLuu?.[c.orderItemId];
            const moChuyen = dangMoChuyen === c.orderItemId;
            const moMien = dangMoMien === c.orderItemId;
            const khoanCuaBe = so.khoanDaVeChiTiet.filter(
              (k) => k.orderItemId === c.orderItemId,
            );

            const choMien = duocSua && c.conNo > 0;
            const choChuyen = duocBoGan && so.con.length >= 2 && c.daThu > 0;
            const choDung = duocSua && !tt?.daDung;
            const choDoiKhoa = duocSua && !tt?.daDung && lopDoiKhoa.length > 0;
            const coMenu = choMien || choChuyen || choDung || choDoiKhoa;
            const coNut = coMenu || (duocSua && conLaiTaoDot > 0);

            const coForm = moForm || moChuyen || moMien;
            const coChiTiet =
              coForm ||
              bl != null ||
              tt?.daDung === true ||
              c.dotDangMo.length > 0 ||
              khoanCuaBe.length > 0 ||
              (duocSua && conLaiTaoDot <= 0);

            return (
              // Mỗi con một `<tbody>` — HTML cho phép nhiều `tbody`, và nó là cách gom
              // hàng-chính + hàng-chi-tiết thành MỘT nhóm có đường kẻ chung. Đặt kẻ ở
              // `<tr>` thì hàng chi tiết trông như một con thứ hai.
              <tbody
                key={c.orderItemId}
                className="border-b border-border/60 last:border-0"
              >
                <tr className="transition-colors hover:bg-muted/40">
                  <th
                    scope="row"
                    className={`${adminTd} max-w-0 text-left font-medium`}
                  >
                    {/* Một dòng duy nhất: tên + khoá + chip trạng thái. Xuống dòng là
                        chiều cao hàng nhảy loạn — đúng lỗi DESIGN.md đã ghi ("65–71px
                        và không đều nhau"). */}
                    <span className="flex min-w-0 items-center gap-2">
                      {/* ⚠️ TÊN BÉ ĐỨNG TRƯỚC, TÊN KHOÁ LÙI VỀ SAU [25/09/2026].
                          Cột này vốn in `c.ten` (= `OrderItem.itemName`), mà trên
                          `/orders/new` cột đó là tên KHOÁ. Đơn hai con cùng khoá in ra
                          HAI HÀNG GIỐNG HỆT NHAU — chủ dự án hỏi thẳng: *"2 con học cùng
                          khoá thì sao biết là đang giảm đơn cho con nào?"*

                          Không biết tên bé thì NÓI RA, đừng in tên khoá như thể nó là
                          tên người (luật 12). Chip "chưa gắn bé" là phần bắt buộc của
                          bản vá: nó phân biệt "dữ liệu cũ, không truy được" với "hệ
                          thống đang giấu". */}
                      <span className="truncate" title={c.tenBe ?? c.ten}>
                        {c.tenBe ?? c.ten}
                      </span>
                      {(c.tenBe ? c.ten : c.khoa) && (
                        <span className="min-w-0 shrink truncate text-xs font-normal text-muted-foreground">
                          {c.tenBe ? c.ten : c.khoa}
                        </span>
                      )}
                      {!c.tenBe && <Chip tone="muted">chưa gắn bé</Chip>}
                      {bl && <Chip tone="warn">bảo lưu</Chip>}
                      {tt?.daDung && <Chip tone="muted">đã dừng</Chip>}
                    </span>
                  </th>

                  {/* ⚠️ LUẬT IN SỐ 0 CHIA THEO NGỮ NGHĨA, không áp đồng loạt:
                      · "Đã thu" / "Chờ xác nhận" → `—` khi 0, vì 0 ở đó là sự VẮNG MẶT;
                      · "Phải thu" / "Còn nợ"     → LUÔN in số, vì 0 ở đó là một KHẲNG
                        ĐỊNH ("hết nợ"). In dấu gạch vào đó là biến một câu trả lời
                        thành một chỗ trống. */}
                  <td className={`${adminTd} text-right tabular-nums`}>
                    {vnd(c.phaiThu)}
                    {tt?.daDung && (
                      // Nhãn cột nói "Phải thu", nhưng với bé đã dừng con số này là giá
                      // trị QUYẾT TOÁN. Không nói ra thì cái nhãn nói dối đúng về tiền.
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        quyết toán
                      </span>
                    )}
                  </td>
                  <td
                    className={`${adminTd} text-right tabular-nums ${
                      c.daThu > 0 ? "text-state-success-ink" : "text-muted-foreground"
                    }`}
                  >
                    {c.daThu > 0 ? vnd(c.daThu) : "—"}
                  </td>
                  <td
                    className={`${adminTd} text-right tabular-nums ${
                      c.choXacNhan > 0 ? "text-state-warning-ink" : "text-muted-foreground"
                    }`}
                  >
                    {c.choXacNhan > 0 ? vnd(c.choXacNhan) : "—"}
                  </td>
                  <td
                    className={`${adminTd} text-right font-semibold tabular-nums ${
                      c.conNo > 0 ? "text-state-danger-ink" : "text-state-success-ink"
                    }`}
                  >
                    {vnd(c.conNo)}
                  </td>

                  <td className={`${adminTd} text-right`}>
                    {/* Không có quyền nào ⇒ in `—`, KHÔNG để ô trống câm: một ô trống
                        không lời giải là affordance nói dối theo chiều ngược lại. */}
                    {!coNut ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="flex items-center justify-end gap-1.5">
                        {duocSua && conLaiTaoDot > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              datDangMoForm(moForm ? null : c.orderItemId)
                            }
                            // Nhãn rút gọn còn "Đợt" nhưng `aria-label` mang đủ
                            // "việc — tên con": role name lấy từ đây, nên locator theo
                            // tên vẫn tìm ra và người dùng màn đọc vẫn nghe đủ.
                            aria-label={`Tạo đợt thu cho ${c.nhan}`}
                          >
                            <Plus className="size-4" aria-hidden />
                            Đợt
                          </Button>
                        )}
                        {coMenu && (
                          <DropdownMenu>
                            {/* ⚠️ `DropdownMenuTrigger` của repo là base-ui, KHÔNG có
                                `asChild` — nó tự dựng nút. Theo đúng nếp
                                `components/admin/role-switcher.tsx`: truyền class thẳng.

                                ⚠️ Và cố ý `hover:bg-muted` chứ KHÔNG mượn class của
                                `Button variant="outline"`: trong `.admin-scope`,
                                `hover:bg-accent` của variant ấy ra CAM ĐẶC
                                (`components/admin/cham-cong/classes.ts`). Đó là lỗi có
                                sẵn ở 5 nút khác trong tệp này — chỉ thấy được bằng mắt,
                                typecheck không bắt. Nút mới không đi theo nó. */}
                            <DropdownMenuTrigger
                              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-input bg-background px-2 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label={`Việc khác cho ${c.nhan}`}
                            >
                              <MoreHorizontal className="size-4" aria-hidden />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              {/* ⚠️ Mục menu chỉ ĐẶT CỜ, hộp thoại dựng ở NGOÀI menu
                                  (cuối hàng chi tiết). Đặt trigger của dialog bên trong
                                  `DropdownMenuItem` thì lần bấm đóng menu → menu unmount
                                  → hộp thoại vừa mở biến mất ngay: người dùng thấy một
                                  cái nháy rồi không có gì. */}
                              {/* ⚠️ `onClick`, KHÔNG phải `onSelect` — và đây là một
                                  bản vá, không phải sở thích. `onSelect` TYPECHECK ĐƯỢC
                                  vì nó là sự kiện BÔI ĐEN VĂN BẢN của DOM, nên nó hợp lệ
                                  về kiểu và không bao giờ chạy khi bấm. Triệu chứng: menu
                                  mở, mục bấm được, menu đóng, rồi KHÔNG có gì xảy ra —
                                  console sạch, tsc xanh. Ca `[TTC-04]` bắt được.
                                  Nếp của repo cũng là `onClick`
                                  (`components/admin/role-switcher.tsx`). */}
                              {choMien && (
                                <DropdownMenuItem
                                  onClick={() => datDangMoMien(c.orderItemId)}
                                >
                                  <HandCoins className="size-4" aria-hidden />
                                  Miễn giảm nợ…
                                </DropdownMenuItem>
                              )}
                              {choChuyen && (
                                <DropdownMenuItem
                                  onClick={() => datDangMoChuyen(c.orderItemId)}
                                >
                                  <ArrowLeftRight className="size-4" aria-hidden />
                                  Chuyển tiền sang bé khác
                                </DropdownMenuItem>
                              )}
                              {choDoiKhoa && (
                                <DropdownMenuItem
                                  onClick={() => datDangMoDoiKhoa(c.orderItemId)}
                                >
                                  <ArrowRightLeft className="size-4" aria-hidden />
                                  Đổi khoá / đổi lớp…
                                </DropdownMenuItem>
                              )}
                              {choDung && (
                                <DropdownMenuItem
                                  className="text-state-danger-ink focus:text-state-danger-ink"
                                  onClick={() => datDangMoDung(c.orderItemId)}
                                >
                                  <CircleStop className="size-4" aria-hidden />
                                  Dừng học…
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </span>
                    )}
                  </td>
                </tr>

                {coChiTiet && (
                  <tr>
                    <td colSpan={6} className="px-5 pb-4 pt-0">
                      <div className="space-y-3">
                        {/* Đợt đang mở — dạng CHIP xếp ngang, không phải một dòng một
                            đợt: bốn đợt cũ tốn 4 × 30px, nay gói trong một hàng 32px và
                            xuống dòng khi hết chỗ. Giữ nguyên checkbox gộp QR, nhãn đọc
                            màn, và nút huỷ đợt. */}
                        {c.dotDangMo.length > 0 && (
                          <ul className="flex flex-wrap gap-2">
                            {c.dotDangMo.map((d) => (
                              <li
                                key={d.id}
                                className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs"
                              >
                                {choPhepChon ? (
                                  <input
                                    type="checkbox"
                                    className="size-4 shrink-0 accent-primary"
                                    checked={chon.includes(d.id)}
                                    onChange={(e) =>
                                      datChon((cu) =>
                                        e.target.checked
                                          ? [...cu, d.id]
                                          : cu.filter((x) => x !== d.id),
                                      )
                                    }
                                    aria-label={`Gộp đợt ${vnd(d.amountDue)} của ${c.nhan} vào phiếu QR`}
                                  />
                                ) : (
                                  <CalendarClock
                                    className="size-3.5 shrink-0 text-muted-foreground"
                                    aria-hidden
                                  />
                                )}
                                <span className="truncate">
                                  <b className="tabular-nums">{vnd(d.amountDue)}</b>
                                  <span className="text-muted-foreground">
                                    {" · "}
                                    {ngay(d.dueDate)}
                                    {d.daRot > 0 && ` · đã nhận ${vnd(d.daRot)}`}
                                  </span>
                                </span>
                                {duocSua && d.daRot === 0 && (
                                  <NutHuyDot
                                    orderId={orderId}
                                    paymentRequestId={d.id}
                                    moTa={`${vnd(d.amountDue)} của ${c.nhan}`}
                                    canhBaoPhieu={canhBaoTruocVoidDot(phieu, [d.id])?.cau ?? null}
                                  />
                                )}
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Khoản ĐÃ gắn cho chính bé này — chỗ duy nhất bỏ gắn được. */}
                        <KhoanCuaCon
                          orderId={orderId}
                          khoan={khoanCuaBe}
                          duocBoGan={duocBoGan}
                        />

                        {/* F2 · US-18 — bé ĐANG BẢO LƯU. Hạn các đợt của bé vừa bị dời:
                            một cái hạn 22/11 không lời giải thích đọc như người nhập sai
                            ngày. Và bé bảo lưu KHÔNG bị báo quá hạn — nói luôn, kẻo kế
                            toán đi tìm xem vì sao nó biến khỏi danh sách đối soát. */}
                        {bl && (
                          <div className="rounded-lg border border-state-warning-soft bg-state-warning-soft/40 p-3 text-xs">
                            <p className="font-medium text-foreground">
                              Đang bảo lưu
                              {` từ ${new Date(bl.startedAt).toLocaleDateString("vi-VN")}`}
                              {bl.expectedEndAt
                                ? ` · dự kiến học lại ${new Date(bl.expectedEndAt).toLocaleDateString("vi-VN")}`
                                : " · CHƯA khai ngày học lại"}
                            </p>
                            <p className="mt-0.5 text-muted-foreground">
                              {bl.soNgayDaDoiHan != null && bl.soNgayDaDoiHan > 0
                                ? `Hạn các đợt chưa tới hạn đã dời ${bl.soNgayDaDoiHan} ngày.`
                                : bl.expectedEndAt
                                  ? "Chưa có đợt nào được dời hạn (đợt đã quá hạn từ trước thì không dời)."
                                  : "Không khai ngày học lại thì không dời được hạn đợt nào."}
                              {" "}Trong thời gian bảo lưu, đợt của bé không bị tính quá hạn.
                            </p>
                          </div>
                        )}

                        {/* PHIÊN D — bé ĐÃ DỪNG: quyết toán ra số nào, khoản dư nằm đâu. */}
                        {tt?.daDung && (
                          <div className="rounded-lg bg-muted/40 p-3 text-xs">
                            <p className="font-medium text-foreground">
                              Đã dừng học
                              {tt.stoppedAt &&
                                ` ${new Date(tt.stoppedAt).toLocaleDateString("vi-VN")}`}
                              {tt.stopReason === "TRUNG_TAM_HUY" &&
                                " · trung tâm huỷ, không thu phí"}
                            </p>
                            <p className="mt-0.5 text-muted-foreground">
                              Dùng{" "}
                              <b className="tabular-nums text-foreground">
                                {tt.usedSessions ?? 0}
                              </b>
                              {tt.committedSessions != null && `/${tt.committedSessions}`} buổi
                              {tt.stopUnitPrice != null && tt.stopUnitPrice > 0 && (
                                <> · đơn giá {vnd(tt.stopUnitPrice)}/buổi</>
                              )}
                              {tt.lastSessionDate && (
                                <>
                                  {" "}· buổi cuối{" "}
                                  {new Date(tt.lastSessionDate).toLocaleDateString("vi-VN")}
                                </>
                              )}
                            </p>
                            {tt.stopNote && (
                              <p className="mt-1 text-muted-foreground">
                                Ghi chú: {tt.stopNote}
                              </p>
                            )}
                            {tt.choHoan > 0 && (
                              <p className="mt-1.5 text-state-warning-ink">
                                Chờ kế toán hoàn:{" "}
                                <b className="tabular-nums">{vnd(tt.choHoan)}</b>
                              </p>
                            )}
                            {/* Kế toán TỪ CHỐI yêu cầu hoàn mà bé vẫn còn dư ⇒ khoản đó
                                quay về "chưa ai xử". Không nói ra thì nó hiện như "đóng
                                thừa" vô cớ, và không ai đi tìm. */}
                            {tt.choHoan === 0 && c.conNo < 0 && (
                              <p className="mt-1.5 text-state-danger-ink">
                                Dư <b className="tabular-nums">{vnd(-c.conNo)}</b> CHƯA xử lý
                                {tt.coHoanBiTuChoi && " (kế toán đã từ chối yêu cầu hoàn)"} —
                                chọn lại: chuyển sang bé khác hoặc tạo yêu cầu hoàn mới.
                              </p>
                            )}
                          </div>
                        )}

                        {moForm && (
                          <FormTaoDot
                            orderId={orderId}
                            orderItemId={c.orderItemId}
                            toiDa={conLaiTaoDot}
                            tenCon={c.nhan}
                            dong={() => datDangMoForm(null)}
                          />
                        )}
                        {moMien && (
                          <FormMienGiam
                            orderId={orderId}
                            con={c}
                            phieu={phieu}
                            hapThu={hapThu}
                            daDungHoc={tt?.daDung ?? false}
                            phieuThu={phieuThu}
                            keHoachDon={keHoachDon}
                            conNoDon={so.conNoDon}
                            tongDon={tongDon}
                            dong={() => datDangMoMien(null)}
                          />
                        )}
                        {moChuyen && (
                          <FormChuyenTien
                            orderId={orderId}
                            cho={c}
                            con={conNhan}
                            dong={() => datDangMoChuyen(null)}
                          />
                        )}

                        {/* Trạng thái rỗng NÓI VÌ SAO, không chỉ ẩn nút: nút biến mất
                            không lý do là affordance nói dối theo chiều ngược lại. */}
                        {/* Trạng thái rỗng NÓI VÌ SAO, và nói ĐÚNG lý do nào đang chặn
                            — ba lý do khác nhau, ba câu khác nhau. Câu chung chung là thứ
                            làm người dùng đi hỏi, rồi học cách bỏ qua cổng. */}
                        {duocSua && !moForm && !tran.duoc && (
                          <p className="text-xs text-muted-foreground">{tran.loi}</p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}

              </tbody>
            );
          })}

          {/* Hàng TỔNG ở `<tfoot>`, không phải một dòng chữ cạnh tiêu đề khối. Trước lượt
              này con số tổng in ở BỐN chỗ trên cùng một màn; nay nó đứng đúng cuối cột
              mà nó cộng, nên đọc được là "cộng của cột này" chứ không phải một con số
              trôi nổi.

              ⚠️ Đơn MỘT CON thì không vẽ: tổng của một dòng bằng đúng dòng ấy, in ra là
              bắt người đọc kiểm một phép cộng không có phép cộng nào. */}
          {so.con.length >= 2 && (
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/20">
              <th scope="row" className={`${adminTh} text-left`}>
                Tổng {so.con.length} con
              </th>
              <td className={`${adminTd} text-right font-semibold tabular-nums`}>
                {vnd(so.tongPhaiThu)}
              </td>
              <td
                className={`${adminTd} text-right font-semibold tabular-nums ${
                  so.tongDaThu > 0 ? "text-state-success-ink" : "text-muted-foreground"
                }`}
              >
                {so.tongDaThu > 0 ? vnd(so.tongDaThu) : "—"}
              </td>
              <td
                className={`${adminTd} text-right font-semibold tabular-nums ${
                  so.tongChoXacNhan > 0 ? "text-state-warning-ink" : "text-muted-foreground"
                }`}
              >
                {so.tongChoXacNhan > 0 ? vnd(so.tongChoXacNhan) : "—"}
              </td>
              <td
                className={`${adminTd} text-right font-semibold tabular-nums ${
                  so.tongConNo > 0 ? "text-state-danger-ink" : "text-state-success-ink"
                }`}
              >
                {vnd(so.tongConNo)}
              </td>
              <td className={adminTd} />
            </tr>
          </tfoot>
          )}
        </table>
      </div>

      {/* ⚠️ BẢNG CHIA ĐỢT ĐỨNG SAU BẢNG SỐ [chủ dự án chốt 25/09/2026] — trước đó nó ở ngay
          dưới tiêu đề khối, TRÊN cả bảng "Con".

          Vì sao thứ tự này đúng hơn: bảng "Con" trả lời câu người ta mở khối này để hỏi —
          *"bé nào còn nợ bao nhiêu, bấm gì"*. Bảng chia đợt trả lời câu ĐỌC THÊM —
          *"khoản nợ ấy rải vào các đợt của đơn thế nào"*. Đặt phần đọc-thêm lên trước là
          đẩy phần hành động (nút `+ Đợt`, menu `⋯`) xuống dưới một bảng mà đa số lần mở
          không ai cần tới.

          ⚠️ Nó vẫn phải Ở TRONG khối này, không tách ra ngoài: cột "Tổng" của nó phải đọc
          được cạnh cột "Phải thu" của bảng trên — hai con số ấy là CÙNG MỘT SỐ
          (bất biến `tong === phaiThu`, `chia-dot-cho-con.ts`), và để xa nhau thì không ai
          đối chiếu được nữa. */}
      {/* ⚠️ ĐƠN MỘT CON KHÔNG VẼ BẢNG NÀY [chủ dự án chốt 25/09/2026]: mỗi ô của nó sẽ
          BẰNG ĐÚNG số tiền đợt tương ứng ở khối "Phiếu thu & QR theo đợt" ngay trên, và
          cột "Tổng" bằng đúng học phí của bé. Một bảng chỉ in lại thứ vừa in là nhiễu.
          Từ hai con trở lên nó mới trả lời được câu "đợt này bé nào gánh bao nhiêu". */}
      {so.con.length >= 2 && ketChiaDot && <BangChiaDot ket={ketChiaDot} nhan={nhanTheoDong} />}

      {/* ⚠️ HAI HỘP THOẠI DỰNG Ở ĐÂY, NGOÀI `<table>` — một bản vá, không phải sở thích
          sắp xếp. Bản đầu đặt chúng bên trong `<tbody>` của con tương ứng; hợp lý khi
          đọc, nhưng `<tbody>` CHỈ chứa được `<tr>`, nên hộp thoại không bao giờ dựng ra.
          Đo 25/09/2026 qua ca `[TTC-04]`: menu mở được, mục "Dừng học…" bấm được, rồi
          KHÔNG có gì xảy ra — và console sạch.

          Chúng cũng phải ở ngoài `DropdownMenu`: đặt trigger trong `DropdownMenuItem` thì
          lần bấm đóng menu → menu unmount → hộp thoại vừa mở biến mất ngay. Hai cái bẫy
          khác nhau, cùng một triệu chứng "bấm xong không thấy gì". */}
      {conDangDung && (
        <NutDungHoc
          orderId={orderId}
          orderItemId={conDangDung.orderItemId}
          tenCon={conDangDung.nhan}
          anNut
          mo
          dong={() => datDangMoDung(null)}
        />
      )}
      {conDangDoiKhoa && (
        <NutDoiKhoa
          orderId={orderId}
          orderItemId={conDangDoiKhoa.orderItemId}
          tenCon={conDangDoiKhoa.nhan}
          lop={lopDoiKhoa}
          anNut
          mo
          dong={() => datDangMoDoiKhoa(null)}
        />
      )}
    </section>
  );
}

/**
 * BẢNG "HỌC PHÍ TỪNG CON THEO CÁC ĐỢT CỦA ĐƠN" — PHIÊN J · 24/09/2026.
 *
 * Chủ dự án: *"Làm công nợ theo con được chia đợt theo số đợt thu tiền của tổng đơn."*
 * Chốt kèm: **giữ đợt cấp đơn, đây CHỈ LÀ BẢNG ĐỂ ĐỌC** — không phiếu thu, không QR riêng.
 *
 * ⚠️ VÌ SAO ĐÂY LÀ BẢNG, TRONG KHI PHẦN CÒN LẠI CỦA KHỐI CỐ Ý KHÔNG PHẢI BẢNG
 * (xem chú thích đầu tệp: *"Bảng buộc mọi con vào cùng một tập cột"*).
 * Vì câu hỏi ở đây khác hẳn: không phải *"làm gì cho bé này"* mà *"đợt 1 gồm những ai, cộng
 * lại có bằng số trên phiếu thu không"*. Đó đúng là câu hỏi hai chiều — và một câu hỏi hai
 * chiều đọc bằng bảng. Các khối theo con bên dưới vẫn là nơi thao tác.
 *
 * ⚠️ CỘT PHẢI CỘNG ĐÚNG BẰNG SỐ TIỀN ĐỢT, vì người đọc đối chiếu thẳng với khối "PHIẾU THU &
 * QR THEO ĐỢT" ngay dưới trên cùng màn hình. Bất biến đó do `chiaDotChoCon` giữ; ở đây chỉ
 * việc in ra — và in cả hàng tổng để người đọc TỰ kiểm được, không phải tin lời.
 */
function BangChiaDot({
  ket,
  nhan,
}: {
  ket: ChiaDotKetQua;
  /**
   * `orderItemId → tên bé` [25/09/2026]. BẮT BUỘC — `ChiaDotKetQua.hang[].ten` là
   * `OrderItem.itemName` (tên KHOÁ trên đường tạo đơn chính), nên hai con cùng khoá
   * cho ra hai hàng nhãn giống hệt nhau. Bảng này CHÍNH LÀ chỗ người ta so hai con
   * với nhau, nên nó là chỗ nhãn trùng gây hại nhất.
   */
  nhan: ReadonlyMap<string, string>;
}) {
  if (!ket.co) {
    return (
      <p className="mt-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Chưa chia được theo đợt: {ket.lyDo}
      </p>
    );
  }

  // ⚠️ `mt-4`, KHÔNG phải `mb-4` [25/09/2026]. Bảng này từng đứng ĐẦU khối nên khoảng cách
  // của nó nằm ở DƯỚI; khi chủ dự án chuyển nó xuống sau bảng "Con" thì cái `mb-4` thành
  // khoảng trắng thừa ở đáy còn hai bảng thì DÍNH NHAU — hai khung khác bo góc, khác nền,
  // sát nhau 0px, đọc ra như một khối vỡ.
  //
  // Khoảng cách đi theo VỊ TRÍ của khối, không theo thói quen gõ `mb-*`.
  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Học phí từng con theo {ket.dot.length} đợt của đơn
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Chia theo tỷ lệ số tiền từng đợt · chỉ để đối chiếu, mã QR vẫn theo đợt của đơn
        </p>
      </div>

      {/* Kế hoạch không phủ đúng học phí ⇒ CỘT sẽ lệch. Nói ra, vì người đọc đang đối chiếu
          cột với khối phiếu thu bên dưới và sẽ tưởng hệ thống tính sai. */}
      {!ket.khopKeHoach && (
        <p className="mb-2 rounded border border-state-warning-soft bg-state-warning-soft px-2 py-1.5 text-[11px] text-state-warning-ink">
          Kế hoạch đợt đang là <b className="tabular-nums">{vnd(ket.tongKeHoach)}</b> trong khi
          học phí các con cộng lại là <b className="tabular-nums">{vnd(ket.tongPhaiThu)}</b>. Số
          của từng con vẫn đúng, nhưng cộng theo cột sẽ không khớp số trên phiếu thu.
        </p>
      )}

      {/* `overflow-x-auto` chứ không thu nhỏ chữ: đơn 12 đợt thì bảng phải cuộn được, và ở
          320px cuộn ngang đọc được còn chữ 10px thì không. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="py-1.5 pr-3 font-medium text-muted-foreground">
                Con
              </th>
              {ket.dot.map((d) => (
                <th
                  key={d.installmentNo}
                  scope="col"
                  className="px-3 py-1.5 text-right font-medium text-muted-foreground"
                >
                  <span className="block">Đợt {d.installmentNo}</span>
                  <span className="block text-[11px] font-normal">hạn {ngay(d.dueDate)}</span>
                </th>
              ))}
              <th scope="col" className="py-1.5 pl-3 text-right font-medium text-muted-foreground">
                Tổng
              </th>
            </tr>
          </thead>
          <tbody>
            {ket.hang.map((h) => (
              <tr key={h.orderItemId} className="border-b border-border/60">
                {/* Tên tiếng Việt dài là mặc định — `max-w` + `truncate`, kèm `title` để
                    vẫn đọc được đầy đủ khi trỏ vào. */}
                <th
                  scope="row"
                  className="max-w-[14rem] truncate py-2 pr-3 text-left font-medium"
                  title={nhan.get(h.orderItemId) ?? h.ten}
                >
                  {nhan.get(h.orderItemId) ?? h.ten}
                </th>
                {h.o.map((o, k) => (
                  <td key={k} className="px-3 py-2 text-right tabular-nums">
                    {vnd(o.soTien)}
                    {/* Ba trạng thái, ba câu khác nhau. Im lặng ở ô đã đóng là bỏ mất đúng
                        thứ sale cần biết ("bé này đóng tới đâu rồi"). */}
                    {o.daPhu >= o.soTien && o.soTien > 0 ? (
                      <span className="block text-[11px] font-medium text-state-success-ink">
                        đã đóng
                      </span>
                    ) : o.daPhu > 0 ? (
                      <span className="block text-[11px] text-muted-foreground">
                        còn {vnd(o.soTien - o.daPhu)}
                      </span>
                    ) : null}
                  </td>
                ))}
                <td className="py-2 pl-3 text-right font-semibold tabular-nums">{vnd(h.tong)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {/* Hàng tổng KHÔNG phải trang trí: nó là thứ cho người đọc tự đối chiếu với khối
                phiếu thu bên dưới. Bỏ nó đi là bắt người ta cộng tay 4 cột. */}
            <tr>
              <th scope="row" className="py-1.5 pr-3 text-left text-xs text-muted-foreground">
                Tổng đợt
              </th>
              {ket.tongTheoDot.map((t, k) => (
                <td key={k} className="px-3 py-1.5 text-right text-xs tabular-nums">
                  {vnd(t)}
                </td>
              ))}
              <td className="py-1.5 pl-3 text-right text-xs font-semibold tabular-nums">
                {vnd(ket.tongPhaiThu)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
