"use client";

// Hộp PHIẾU THU THẺ POS (GĐ1 · 06/10/2026) — docs/pos-gd1-thiet-ke.md §7.3.
//
// Cảnh dùng: sale đứng quầy, phụ huynh đứng chờ, máy SmartPOS trên tay. Hai thứ sale phải ĐỌC
// từ màn để GÕ vào máy — số tiền và mã 5 ký tự — nên chúng là chữ to nhất của hộp; mọi thứ khác
// lùi lại. Sau khi khách quẹt, việc duy nhất là bấm "Kiểm tra thanh toán" và đọc MỘT câu.
//
// Luật 12 (affordance nói thật):
//   · "Báo admin" chỉ hiện khi cổng máy chủ sẽ cho — hỏi CHÍNH `lyDoKhongBaoAdmin` mà
//     `baoAdminPhieuPos` hỏi lại, không chép điều kiện (`[POS1-UI-W4]`);
//   · "Tạo phiếu mới" chỉ khi phiếu HẾT HẠN. Phiếu thất bại vẫn MỞ — khách quẹt lại với CÙNG mã;
//     giao dịch còn ở hàng chờ kế toán (T21) thì không có nút nào mời quẹt lần hai;
//   · số GÕ VÀO MÁY là còn phải thu HIỆN TẠI của phiếu gộp, không phải số lúc tạo.
//
// BA LỐI trong một hộp (ghép Việc 3 × Việc 4, 10/10/2026 — docs §7.8), mỗi lối một tiền đề NGƯỢC nhau:
//   · "Kiểm tra thanh toán"      — việc hằng ngày; nút CHÍNH (đặc, cao 44px ở màn chạm);
//   · "Tôi nhập sai mã trên máy" — khách ĐÃ quẹt THÀNH CÔNG, sale gõ sai mã; ở THÂN hộp, ngay dưới câu "Chưa thấy…";
//   · "Huỷ phiếu thẻ"            — khách CHƯA quẹt; ở CHÂN hộp, bên trái, xa nút chính (việc phá huỷ không đứng cạnh việc hằng ngày).
// Nút nào hiện, dòng "Chưa huỷ được…" có in không, và có cần câu nói khác biệt hay không đều do MỘT hàm thuần quyết (`nutTrongHopPhieuThe`); component CHỈ vẽ theo
// kết quả. Hai ngoại lệ có chủ đích: "vừa gửi, trang chưa về" (nút huỷ BIẾN MẤT, không chỉ khoá) và "kế toán vừa từ chối" (MỘT lệnh cấm — dòng đỏ — không dòng thứ hai).
//
// `admin-scope` trên `DialogContent`: hộp portal ra ngoài khung admin, thiếu class là nút lấy
// `--primary` CAM của :root (tiền lệ `nhap-file-pos.tsx`).

import { useEffect, useState, useTransition, type TransitionStartFunction } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BellRing,
  Check,
  CircleCheck,
  CircleX,
  Copy,
  CreditCard,
  Info,
  Loader2,
  Search,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
// VIỆC 4 (09/10/2026) — nút "Huỷ phiếu thẻ" + dòng "chưa huỷ được": toàn bộ state / hộp xác nhận nằm ở tệp riêng.
import { DongKhongHuyDuoc, NutHuyPhieuThe } from "./huy-phieu-the-dialog";
import { lyDoKhongBaoAdmin, type PhieuPosView } from "@/lib/payments/pos/phieu-pos-luat";
import { CAU_CANH_BAO_HAI_KENH } from "@/lib/payments/kenh-thu";
import { thongDiepTrangThai, type MucDoPos } from "@/lib/payments/pos/thong-diep-pos";
import { CAU_DON_DA_CO_VET_BAC, cauTuChoi, nutNhapSaiMa, type KetQuaTimSaiMa } from "@/lib/payments/pos/sai-ma";
// GHÉP Việc 3 × Việc 4 (10/10/2026) — MỘT hàm quyết nút nào hiện (docs §7.8): component CHỈ vẽ theo kết quả, không tự so trạng thái.
import { buocSaiMaConHieuLuc, canhBaoDonDaBac, CAU_PHAN_BIET_HAI_NUT, nutTrongHopPhieuThe } from "@/lib/payments/pos/nut-trong-hop-phieu-the";
import { baoAdminPhieuPosAction, kiemTraPhieuPosAction, taoPhieuPosAction } from "../_actions";
import { guiSaiMaAction, timUngVienSaiMaAction } from "../_pos-sai-ma-actions";
import { BuocSaiMa } from "./buoc-sai-ma";

/** Máy POS đang bật của cơ sở giữ đơn — nhãn là mã quầy (thứ in trên thân máy). */
export type MayPosView = { id: string; nhan: string };

/** Rớt kết nối giữa chừng (action reject): câu tiếng Việt, không chữ kỹ thuật. Ca `[HN3-R20]` `[HN3-R21]`. */
const CAU_MAT_KET_NOI = "Không kết nối được máy chủ — kiểm tra mạng rồi bấm lại.";
const CAU_MAT_KET_NOI_KHI_GUI =
  "Mất kết nối khi gửi — chưa rõ yêu cầu đã tới nơi chưa. Đã tải lại trạng thái phiếu; xem lại rồi mới chọn lại.";

const so = (n: number) => n.toLocaleString("vi-VN");
const gio = (iso: string) => iso.slice(11, 16);
const gioNgay = (iso: string) => `${iso.slice(11, 16)} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Mở (hoặc nhận lại) phiếu thu thẻ cho MỘT đợt. Đặt ở đây để cả nút trên dòng đợt lẫn hộp (chọn
 * máy · tạo phiếu mới khi hết hạn) đi CÙNG một lời gọi — một chỗ dịch lỗi, một chỗ làm mới trang.
 */
export function useTaoPhieuPos(orderId: string) {
  const router = useRouter();
  const [dangTao, start] = useTransition();
  function tao(
    paymentRequestId: string,
    posTerminalId: string | undefined,
    xong: (phieu: PhieuPosView) => void,
  ) {
    start(async () => {
      const res = await taoPhieuPosAction({
        orderId,
        paymentRequestId,
        ...(posTerminalId ? { posTerminalId } : {}),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      xong(res.phieu);
      router.refresh();
    });
  }
  return { tao, dangTao };
}

const TONE: Record<MucDoPos, { khung: string; chu: string; Icon: typeof Info }> = {
  thanh_cong: { khung: "border-state-success/30 bg-state-success-soft", chu: "text-state-success-ink", Icon: CircleCheck },
  canh_bao: { khung: "border-state-warning/40 bg-state-warning-soft", chu: "text-state-warning-ink", Icon: TriangleAlert },
  loi: { khung: "border-state-danger/30 bg-state-danger-soft", chu: "text-state-danger-ink", Icon: CircleX },
  thong_tin: { khung: "border-border bg-muted/60", chu: "text-foreground", Icon: Info },
};

function NutChep({ giaTri, nhan }: { giaTri: string; nhan: string }) {
  const [daChep, datDaChep] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={`${nhan}: ${giaTri}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(giaTri);
          datDaChep(true);
          setTimeout(() => datDaChep(false), 1500);
        } catch {
          toast.error("Trình duyệt không cho chép — đọc và gõ tay");
        }
      }}
    >
      {daChep ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {daChep ? "Đã chép" : nhan}
    </Button>
  );
}

/** `luc` = "hh:mm" giờ VN, `null` khi không có. */
type KetQuaVuaKiem = { thongDiep: string; mucDo: MucDoPos; luc: string | null };

/**
 * Việc 3 — sale vừa GỬI một giao dịch thành công và trang CHƯA làm mới. Câu của máy chủ ("Đã ghi nhận…" / "Đã gửi kế toán…") đứng
 * thay câu cũ cho tới khi dữ liệu MỚI về; `dauVet` là ảnh chụp các trường mà việc gửi đổi ở phiếu lúc bấm — props đổi bất kỳ trường
 * nào (trang mới đã về) thì câu tạm này TỰ hết hiệu lực, không cần effect nào dọn.
 *
 * ⚠️ VÌ SAO CẦN [09/10/2026]: hộp KHÔNG đóng sau khi gửi và `router.refresh()` không reset `useState`. Không có phần này thì (a) `vuaKiem`
 * ("Chưa thấy giao dịch…" của lượt Kiểm tra trước) sống sót và che câu "Chờ kế toán xác nhận giao dịch nhập sai mã" / câu thu tiền; (b) chỉ
 * xoá `vuaKiem` thì trong lúc chờ trang mới, props vẫn là CHO_QUET + câu lưu "Chưa thấy…" ⇒ nút "Tôi nhập sai mã" và bốn bước mời quẹt BẬT
 * LẠI ngay trước mặt khách vừa được gửi kế toán. Ca `[HN3-R14]` `[HN3-R14b]`.
 */
type DaGui = { intentId: string; dauVet: string; thongDiep: string; mucDo: MucDoPos };
const dauVetPhieu = (p: PhieuPosView) =>
  JSON.stringify([p.hienThi, p.trangThai, p.thongDiep ?? null, p.saiMa?.trangThai ?? null, p.saiMa?.hieuLuc ?? null]);

export function HopPhieuPos({
  orderId,
  mo,
  onDong,
  phieu,
  paymentRequestId,
  nhanDot,
  mayPos,
  tao,
  dangTao,
  canhBaoHaiKenh,
  onPhieu,
  onVeChonMay,
}: {
  orderId: string;
  mo: boolean;
  onDong: () => void;
  /** Phiếu đang xem — `null` khi chưa tạo (cơ sở nhiều máy: bước chọn máy). */
  phieu: PhieuPosView | null;
  /** Đợt bấm vào — nguồn của "Tạo phiếu" / "Tạo phiếu mới". */
  paymentRequestId: string;
  nhanDot: string;
  mayPos: MayPosView[];
  tao: ReturnType<typeof useTaoPhieuPos>["tao"];
  dangTao: boolean;
  /**
   * Mã này đang mở cho CẢ chuyển khoản và thẻ (`canhBaoHaiKenh`, `lib/payments/kenh-thu.ts`) ⇒ hộp in cảnh báo.
   * ⚠️ BẮT BUỘC, không `?` và không mặc định (luật 11): thiếu là lỗi CÂM — hộp thẻ im lặng trong đúng lúc khách có thể
   * trả hai lần. `tsc` liệt kê chỗ gọi thay vì để cảnh báo biến mất.
   */
  canhBaoHaiKenh: boolean;
  onPhieu: (p: PhieuPosView) => void;
  /** Phiếu hết hạn trên máy đã tắt (cơ sở nhiều máy) ⇒ quay về bước chọn máy. */
  onVeChonMay: () => void;
}) {
  const router = useRouter();
  const [dangKiem, startKiem] = useTransition();
  const [dangBao, startBao] = useTransition();
  // Việc 3 — bước "Chọn giao dịch của khách" (nút "Tôi nhập sai mã trên máy"). `buocCua` = phiếu mà bước này thuộc về: đổi phiếu ⇒ bỏ.
  const [dangTim, startTim] = useTransition();
  const [dangGui, startGui] = useTransition();
  // Việc 4 — đường HUỶ PHIẾU THẺ. Transition nằm ở ĐÂY (không trong nút) để `dongDuoc` biết "đang huỷ": nó bao cả `router.refresh()` nên kéo dài
  // tới khi trang mới về, mà cửa sổ đó (hộp xác nhận đã đóng, nút còn quay) là chỗ duy nhất hộp ngoài vẫn đóng được giữa chừng. Docs §7.8.
  const [dangHuy, startHuy] = useTransition();
  const [buocCua, datBuocCua] = useState<string | null>(null);
  const [timKq, datTimKq] = useState<KetQuaTimSaiMa | null>(null);
  const [dangGuiGiaoDich, datDangGuiGiaoDich] = useState<string | null>(null);
  const [vuaKiem, datVuaKiem] = useState<KetQuaVuaKiem | null>(null);
  const [daGui, datDaGui] = useState<DaGui | null>(null);
  const [mayChon, datMayChon] = useState<string | null>(mayPos.length === 1 ? mayPos[0]!.id : null);
  // Đồng hồ cho nút "Báo admin" (mở sau 10 phút) — chỉ chạy khi hộp mở.
  const [bayGio, datBayGio] = useState(() => new Date());
  useEffect(() => {
    if (!mo) return;
    datBayGio(new Date());
    const t = setInterval(() => datBayGio(new Date()), 15_000);
    return () => clearInterval(t);
  }, [mo]);

  // Câu vừa kiểm thuộc về CHÍNH phiếu đang xem — đổi phiếu thì bỏ.
  const [vuaKiemCua, datVuaKiemCua] = useState<string | null>(null);
  // Vừa GỬI xong và props còn y nguyên lúc bấm ⇒ đang chờ trang mới (xem `DaGui`).
  const guiDangCho = daGui !== null && phieu !== null && daGui.intentId === phieu.intentId && daGui.dauVet === dauVetPhieu(phieu) ? daGui : null;
  const ketQuaHienThi =
    guiDangCho !== null
      ? { thongDiep: guiDangCho.thongDiep, mucDo: guiDangCho.mucDo, luc: null }
      : vuaKiem && phieu && vuaKiemCua === phieu.intentId
        ? vuaKiem
        : phieu?.thongDiep
          ? { thongDiep: phieu.thongDiep, mucDo: phieu.mucDo, luc: phieu.kiemLuc ? gio(phieu.kiemLuc) : null }
          : null;

  /**
   * Bỏ câu của lượt Kiểm tra TRƯỚC khỏi state của hộp. `router.refresh()` KHÔNG reset `useState`: không bỏ thì "Chưa thấy giao dịch…" sống sót và
   * che câu đúng (câu "đã huỷ" của Việc 4, câu "Chờ kế toán…" / "Đã ghi nhận…" của Việc 3). MỘT hàm cho cả hai đường dùng nó — gửi sai mã thành công
   * và huỷ phiếu thẻ — để hai nơi không lệch nhau về việc "bỏ những gì" (`[HN3-UW2]`, `[HNG-W2]`).
   */
  function boCauKiemCu() {
    datVuaKiem(null);
    datVuaKiemCua(null);
  }

  function kiemTra(p: PhieuPosView) {
    startKiem(async () => {
      const res = await kiemTraPhieuPosAction({ orderId, intentId: p.intentId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // Giờ của lượt kiểm THẬT (lượt bấm dồn trả câu cũ ⇒ giờ cũ), không phải giờ bấm.
      datVuaKiem({ thongDiep: res.ketQua.thongDiep, mucDo: res.ketQua.mucDo, luc: gio(res.ketQua.kiemLuc) });
      datVuaKiemCua(p.intentId);
      router.refresh();
    });
  }

  function baoAdmin(p: PhieuPosView) {
    startBao(async () => {
      const res = await baoAdminPhieuPosAction({ orderId, intentId: p.intentId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Đã báo ${res.soNguoi} người (Kế toán HO / Quản trị)`);
    });
  }

  /** Mở bước chọn giao dịch và HỎI máy chủ tìm ứng viên (sự kiện bấm, không phải effect). */
  function moBuocSaiMa(p: PhieuPosView) {
    datBuocCua(p.intentId);
    datTimKq(null);
    startTim(async () => {
      try {
        datTimKq(await timUngVienSaiMaAction({ orderId, intentId: p.intentId }));
      } catch {
        // Rớt kết nối: câu tiếng Việt trong chính bước này — không để lỗi chưa bắt văng cả trang (React 19 đẩy lỗi của action bất đồng bộ
        // lên error boundary), không để bước trắng.
        datTimKq({ ok: false, error: CAU_MAT_KET_NOI });
      }
    });
  }

  function dongBuocSaiMa() {
    datBuocCua(null);
    datTimKq(null);
  }

  function chonGiaoDich(p: PhieuPosView, bankTransactionId: string) {
    datDangGuiGiaoDich(bankTransactionId);
    startGui(async () => {
      let res: Awaited<ReturnType<typeof guiSaiMaAction>> | null;
      try {
        res = await guiSaiMaAction({ orderId, intentId: p.intentId, bankTransactionId });
      } catch {
        res = null; // rớt kết nối: CHƯA RÕ yêu cầu đã tới máy chủ chưa
      }
      datDangGuiGiaoDich(null); // luôn nhả nút — kể cả khi rớt kết nối (không kẹt vòng quay)
      if (res === null) {
        toast.error(CAU_MAT_KET_NOI_KHI_GUI);
        router.refresh(); // lấy sự thật: yêu cầu có thể ĐÃ tới nơi, khi đó trang mới sẽ nói "Chờ kế toán…"
        return;
      }
      if (!res.ok) {
        // Danh sách có thể đã cũ (giao dịch vừa bị người khác giữ…): lấy lại cho đúng sự thật.
        toast.error(res.error);
        // Rà đối kháng Việc 3 [HN3-RV-07]: từ chối CÓ THỂ đến SAU khi máy chủ đã đổi trạng thái (giữ giao dịch xong rồi pha tiền ném — câu
        // "ĐỪNG cho khách quẹt lại" khi đó chỉ nằm trong toast vài giây, còn hộp phiếu vẫn là phiếu CHO_QUET cũ với bốn bước mời quẹt và nút
        // "Tôi nhập sai mã"). Làm mới trang để hộp nói theo sự thật; vô hại với lỗi cổng thường (không đổi state của hộp).
        router.refresh();
        try {
          datTimKq(await timUngVienSaiMaAction({ orderId, intentId: p.intentId }));
        } catch {
          datTimKq({ ok: false, error: CAU_MAT_KET_NOI });
        }
        return;
      }
      if (res.trangThai === "DA_GHI_NHAN") toast.success(res.thongDiep);
      else toast.message(res.thongDiep);
      // Phiếu vừa đổi trạng thái ⇒ câu của lượt Kiểm tra trước ("Chưa thấy…") đã LỖI THỜI: bỏ, và để câu của máy chủ đứng thay cho tới
      // khi trang mới về (`DaGui`). `router.refresh()` KHÔNG reset useState nên không tự dọn giúp.
      boCauKiemCu();
      datDaGui({
        intentId: p.intentId,
        dauVet: dauVetPhieu(p),
        thongDiep: res.thongDiep,
        mucDo: res.trangThai === "DA_GHI_NHAN" ? "thanh_cong" : "canh_bao",
      });
      dongBuocSaiMa();
      router.refresh();
    });
  }

  // Hộp ngoài CHỈ đóng được khi KHÔNG việc nào đang chạy — kể cả "đang huỷ phiếu thẻ" (Việc 4): đóng giữa lượt là mất dấu một việc chưa biết kết cục.
  const dongDuoc = !dangTao && !dangKiem && !dangBao && !dangTim && !dangGui && !dangHuy;
  // `buocCua` là state — `router.refresh()` KHÔNG reset nó. Trang mới về với CÙNG intentId nhưng phiếu đã HUY / CAN_XU_LY / DA_THU thì bước chọn giao dịch phải nhường chỗ cho câu
  // trạng thái (rà ghép 10/10/2026: huỷ xong mà hộp kẹt ở bước chọn + câu lỗi, che câu "đã huỷ"). Hàm thuần quyết, component không tự so trạng thái.
  const dangODoSaiMa = phieu !== null && buocCua === phieu.intentId && buocSaiMaConHieuLuc(phieu.hienThi);
  const choBaoAdmin =
    phieu !== null &&
    lyDoKhongBaoAdmin(
      { status: phieu.trangThai, lastResultKind: phieu.ketQuaGanNhat, createdAt: new Date(phieu.taoLuc) },
      bayGio,
    ) === null;

  return (
    <Dialog
      open={mo}
      onOpenChange={(o) => {
        if (!o && dongDuoc) {
          dongBuocSaiMa();
          onDong();
        }
      }}
    >
      <DialogContent className="admin-scope flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        {phieu !== null && dangODoSaiMa ? (
          <BuocSaiMa
            maDung={phieu.code5}
            dangTim={dangTim}
            ketQua={timKq}
            dangGui={dangGui}
            dangGuiGiaoDich={dangGuiGiaoDich}
            choBaoAdmin={choBaoAdmin}
            dangBao={dangBao}
            onChon={(id) => chonGiaoDich(phieu, id)}
            onBao={() => baoAdmin(phieu)}
            onQuayLai={dongBuocSaiMa}
          />
        ) : phieu === null ? (
          <BuocChonMay
            nhanDot={nhanDot}
            mayPos={mayPos}
            mayChon={mayChon}
            datMayChon={datMayChon}
            dangTao={dangTao}
            onTao={() => mayChon && tao(paymentRequestId, mayChon, onPhieu)}
          />
        ) : (
          <NoiDungPhieu
            orderId={orderId}
            // VIỆC 4: sau khi huỷ, câu của lượt Kiểm tra TRƯỚC phải biến mất — `router.refresh()` không reset useState.
            onBoKetQuaCu={boCauKiemCu}
            dangHuy={dangHuy}
            batDauHuy={startHuy}
            phieu={phieu}
            nhanDot={nhanDot}
            ketQua={ketQuaHienThi}
            dangKiem={dangKiem}
            dangBao={dangBao}
            dangTao={dangTao}
            canhBaoHaiKenh={canhBaoHaiKenh}
            choBaoAdmin={choBaoAdmin}
            choLamMoi={guiDangCho !== null}
            onKiem={() => kiemTra(phieu)}
            onBao={() => baoAdmin(phieu)}
            onMoSaiMa={() => moBuocSaiMa(phieu)}
            onTaoMoi={() => {
              // Máy cũ còn bật thì quẹt lại trên máy cũ; cơ sở nhiều máy mà máy cũ đã tắt ⇒ về bước chọn.
              const mayCu = phieu.may && mayPos.some((m) => m.id === phieu.may?.id) ? phieu.may.id : undefined;
              if (mayPos.length > 1 && !mayCu) {
                datMayChon(null);
                onVeChonMay();
                return;
              }
              tao(paymentRequestId, mayPos.length > 1 ? mayCu : undefined, onPhieu);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BuocChonMay({
  nhanDot,
  mayPos,
  mayChon,
  datMayChon,
  dangTao,
  onTao,
}: {
  nhanDot: string;
  mayPos: MayPosView[];
  mayChon: string | null;
  datMayChon: (id: string) => void;
  dangTao: boolean;
  onTao: () => void;
}) {
  return (
    <>
      <DialogHeader className="border-b border-border px-5 pt-5 pb-4 pr-12">
        <DialogTitle className="text-base font-semibold">Thu thẻ POS — {nhanDot}</DialogTitle>
        <DialogDescription className="text-xs">
          Cơ sở có {mayPos.length} máy. Chọn máy khách sẽ quẹt — phiếu chỉ khớp giao dịch của máy thuộc cơ sở này.
        </DialogDescription>
      </DialogHeader>
      <div role="radiogroup" aria-label="Máy POS" className="grid gap-2 px-5 py-4 sm:grid-cols-2">
        {mayPos.map((m) => {
          const chon = m.id === mayChon;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={chon}
              onClick={() => datMayChon(m.id)}
              className={cn(
                "flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                chon ? "border-primary bg-primary-soft font-semibold text-foreground" : "border-border hover:bg-muted",
              )}
            >
              <CreditCard className={cn("size-4 shrink-0", chon ? "text-primary" : "text-muted-foreground")} aria-hidden />
              <span className="min-w-0 truncate font-mono">{m.nhan}</span>
            </button>
          );
        })}
      </div>
      <DialogFooter className="mx-0 mb-0 px-5 py-3">
        <Button type="button" disabled={!mayChon || dangTao} onClick={onTao} className="gap-2">
          {dangTao ? <Loader2 className="animate-spin" aria-hidden /> : <CreditCard aria-hidden />}
          Tạo phiếu thu thẻ
        </Button>
      </DialogFooter>
    </>
  );
}

function NoiDungPhieu({
  orderId,
  onBoKetQuaCu,
  dangHuy,
  batDauHuy,
  phieu,
  nhanDot,
  ketQua,
  dangKiem,
  dangBao,
  dangTao,
  canhBaoHaiKenh,
  choBaoAdmin,
  choLamMoi,
  onKiem,
  onBao,
  onTaoMoi,
  onMoSaiMa,
}: {
  /** VIỆC 4 — cho nút "Huỷ phiếu thẻ" (`huyPhieuTheAction({ orderId, … })`). BẮT BUỘC, không mặc định (luật 11). */
  orderId: string;
  /** VIỆC 4 — bỏ câu của lượt Kiểm tra cũ khỏi state của hộp cha. BẮT BUỘC, không mặc định (luật 11). */
  onBoKetQuaCu: () => void;
  /**
   * VIỆC 4 (ghép) — lượt huỷ phiếu thẻ đang chạy; transition của nó nằm ở hộp ngoài để `dongDuoc` biết. BẮT BUỘC, không mặc định (luật 11): thiếu thì
   * hộp ngoài đóng được giữa lượt huỷ mà không lỗi nào báo. Trong lúc huỷ, các việc khác trên CÙNG phiếu (Kiểm tra · Báo admin) đứng yên — đối xứng với
   * nút huỷ bị khoá khi Kiểm tra/Báo admin chạy.
   */
  dangHuy: boolean;
  batDauHuy: TransitionStartFunction;
  phieu: PhieuPosView;
  nhanDot: string;
  ketQua: KetQuaVuaKiem | null;
  dangKiem: boolean;
  dangBao: boolean;
  dangTao: boolean;
  canhBaoHaiKenh: boolean;
  choBaoAdmin: boolean;
  /**
   * Việc 3 — sale vừa GỬI một giao dịch và trang mới CHƯA về: props còn là CHO_QUET nhưng khách đã quẹt xong ⇒ không mời quẹt (bốn
   * bước ẩn). ⚠️ BẮT BUỘC, không `?` và không mặc định (luật 11): thiếu thì hộp im lặng mời quẹt lại trong đúng lúc nguy hiểm nhất.
   */
  choLamMoi: boolean;
  onKiem: () => void;
  onBao: () => void;
  onTaoMoi: () => void;
  /** Việc 3 — bấm "Tôi nhập sai mã trên máy". */
  onMoSaiMa: () => void;
}) {
  const h = phieu.hienThi;
  // Việc 3 — kế toán đã TỪ CHỐI giao dịch sale chọn: phiếu về CHO_QUET (phiếu MỞ), nhưng khách CÓ THỂ đã bị trừ tiền ⇒ KHÔNG mời quẹt
  // lại: ẩn bốn bước hướng dẫn và in một dòng riêng đọc từ DÒNG YÊU CẦU (`phieu.saiMa`), không từ câu lưu (poller/Kiểm tra ghi đè câu
  // lưu trong vài phút). Hiện cả khi phiếu vừa quá hạn — chỗ có nút "Tạo phiếu mới".
  // VIỆC 6 · a2: bị từ chối KHÔNG còn giấu nút "Huỷ phiếu thẻ" (chủ dự án chốt 10/10/2026) — `nutTrongHopPhieuThe` quyết, component chỉ vẽ. Cờ này vẫn phải giữ NGUYÊN văn bản `phieu.saiMa?.trangThai === "TU_CHOI" && …` (lưới `[HN3-W*]`).
  // Cũng vì thế hai nút "Chép số" / "Chép mã" ẨN khi `daBiTuChoi`: chúng là lời mời gõ số tiền + mã vào máy, nằm ngay dưới dòng đỏ "ĐỪNG cho khách quẹt lại" (luật 12 — cùng họ `tienDangBay`).
  const daBiTuChoi = phieu.saiMa?.trangThai === "TU_CHOI" && (h === "CHO_QUET" || h === "THAT_BAI" || h === "HET_HAN");
  const soGo = phieu.soTienPhaiThu;
  const daDoiSo = soGo !== null && soGo !== phieu.soTienLucTao;
  const cauTrangThai = thongDiepTrangThai(phieu.trangThai);
  const hien = ketQua ?? (h === "CHO_QUET" ? null : { thongDiep: cauTrangThai.cau, mucDo: cauTrangThai.mucDo, luc: null });
  // Câu LƯU của phiếu vừa bị từ chối CHÍNH LÀ câu từ chối (lib ghi `cauTuChoi(lyDo)` vào `lastResultMessage`) ⇒ in hai lần liền nhau
  // (đo ở smoke 375px 09/10/2026). Dòng cảnh báo RIÊNG bên dưới (đọc từ DÒNG YÊU CẦU) là bản duy nhất khi hai câu trùng; câu lưu KHÁC
  // (poller / Kiểm tra đã ghi đè bằng "Chưa thấy…") vẫn hiện như cũ. `nutNhapSaiMa` bên dưới vẫn hỏi câu THẬT (`hien`), không hỏi câu đã giấu.
  const cauDaTuChoi = daBiTuChoi ? cauTuChoi(phieu.saiMa?.lyDoTuChoi ?? null) : null;
  // Việc 5 (rà đối kháng): phiếu thẻ MỚI của đơn từng có giao dịch bị bác không có dòng từ chối riêng (`saiMa = null`) — một dòng nhắc, KHÔNG đổi nút, KHÔNG giấu hướng dẫn quẹt.
  const canhBaoDon = canhBaoDonDaBac({ hienThi: h, daBiTuChoi, donDaCoVetBac: phieu.donDaCoVetBac });
  const hienDeIn = hien && hien.thongDiep === cauDaTuChoi ? null : hien;
  const tone = hienDeIn ? TONE[hienDeIn.mucDo] : null;
  // Điều kiện nút nằm ở MỘT hàm thuần (`nutNhapSaiMa`) — component không tự viết lại. Dùng đúng câu đang HIỆN (lượt vừa bấm hoặc câu lưu).
  const nutSaiMa = nutNhapSaiMa({ hienThi: h, thongDiep: hien?.thongDiep ?? null });
  // GHÉP Việc 3 × Việc 4: BA lối cùng sống trong một hộp ("Kiểm tra" · "Tôi nhập sai mã" · "Huỷ phiếu thẻ") nên MỘT hàm thuần quyết nút nào hiện, dòng
  // lý do nào in, và có cần câu nói khác biệt hay không. Component KHÔNG tự so trạng thái / `huyDuoc` / `choLamMoi` để vẽ hay giấu — `nut` là nguồn duy nhất.
  const nut = nutTrongHopPhieuThe({
    hienThi: h,
    huyPhieuThe: phieu.huyPhieuThe,
    saiMa: phieu.saiMa,
    nutSaiMa,
    daBiTuChoi,
    choLamMoi,
    dangHuy,
  });
  // Còn cần gõ vào máy? Chỉ khi hàm quyết MỜI quẹt (phiếu còn chờ quẹt · không dấu hiệu tiền đang bay · không ở cửa sổ vừa gửi / đang huỷ · không sau từ chối) VÀ phiếu gộp
  // còn khoản phải thu. Vừa gửi / đang huỷ / có dấu hiệu tiền đang bay ⇒ KHÔNG còn việc gõ vào máy: ẩn bốn bước, làm mờ hai ô số/mã.
  const conCanGo = nut.moiQuet && soGo !== null;

  return (
    <>
      <DialogHeader className="border-b border-border px-5 pt-5 pb-4 pr-12">
        <DialogTitle className="text-base font-semibold">Thu thẻ POS — {nhanDot}</DialogTitle>
        <DialogDescription className="text-xs">
          {phieu.may ? (
            <>
              Quẹt trên máy <span className="font-mono font-medium text-foreground">{phieu.may.nhan}</span> ·{" "}
            </>
          ) : null}
          Tạo {gio(phieu.taoLuc)} · hết hạn {gioNgay(phieu.hetHanLuc)}
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {/* ── Hai thứ gõ vào máy: SỐ TIỀN rồi MÃ (đúng thứ tự trên máy SmartPOS). ── */}
        <div className={cn("grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2", !conCanGo && "opacity-60")}>
          <div className="min-w-0 bg-card px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">1 · Số tiền</span>
              {soGo !== null && h !== "HUY" && !nut.tienDangBay && !dangHuy && !daBiTuChoi && <NutChep giaTri={String(soGo)} nhan="Chép số" />}
            </div>
            {soGo !== null ? (
              <p className="mt-0.5 font-mono text-3xl font-bold tabular-nums tracking-tight text-foreground">
                {so(soGo)}
                <span className="ml-1 text-lg font-semibold text-muted-foreground">đ</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Phiếu gộp không còn khoản phải thu</p>
            )}
          </div>
          <div className="bg-card px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">2 · Mã ghi chú</span>
              {h !== "HUY" && !nut.tienDangBay && !dangHuy && !daBiTuChoi && <NutChep giaTri={phieu.code5} nhan="Chép mã" />}
            </div>
            <p className="mt-0.5 font-mono text-4xl font-bold tracking-[0.3em] text-primary">{phieu.code5}</p>
            {/* Mã 5 ký tự là MỘT cho cả QR chuyển khoản và thẻ (phiếu gộp). Nói ra để sale không tưởng thẻ có mã riêng. */}
            {conCanGo && <p className="mt-1 text-xs text-muted-foreground">Cùng mã với QR chuyển khoản</p>}
          </div>
        </div>

        {/* Cả hai kênh đã mở cho cùng mã: khách chỉ được trả MỘT cách. Hệ thống KHÔNG tự huỷ kênh kia (huỷ phiếu thẻ lúc khách
            có thể đang quẹt là rủi ro hơn để mở) — chỉ nói. Sale chắc khách CHƯA quẹt thì tự bấm "Huỷ phiếu thẻ" ở chân hộp
            (Việc 4: hộp xác nhận hai bước, máy chủ đọc lại dưới khoá). */}
        {canhBaoHaiKenh && (
          <p className="rounded-lg border border-state-warning/40 bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
            {CAU_CANH_BAO_HAI_KENH}
          </p>
        )}

        {daDoiSo && conCanGo && (
          <p className="rounded-lg border border-state-warning/40 bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
            Số phải thu đã đổi từ {so(phieu.soTienLucTao)}đ thành <b>{so(soGo)}đ</b> — nhập {so(soGo)}đ.
          </p>
        )}

        {phieu.dongDot.length > 1 && (
          <div className="rounded-lg border border-border">
            <p className="border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Mã này thu cả {phieu.dongDot.length} đợt
            </p>
            <ul className="divide-y divide-border text-sm">
              {phieu.dongDot.map((d, i) => (
                <li key={`${d.nhan}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate">{d.nhan}</span>
                  <span className="shrink-0 tabular-nums">{so(d.soTien)}đ</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {conCanGo && (
          <div>
            <ol className="space-y-1.5 text-sm text-foreground">
              {[
                "Nhập số tiền vào máy.",
                "Gõ mã vào ô Ghi chú — một mình nó, hoa hay thường đều được.",
                "Cho khách chạm hoặc quẹt thẻ.",
                "Biên lai báo “Thành công” thì bấm Kiểm tra thanh toán.",
              ].map((b, i) => (
                <li key={b} className="flex gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="pt-px">{b}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Chỉ gõ một mã. Gõ thêm mã khác hoặc dính liền vào chữ thì giao dịch phải xử lý tay.
            </p>
          </div>
        )}

        {cauDaTuChoi !== null && (
          <div role="alert" className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm", TONE.loi.khung, TONE.loi.chu)}>
            <TONE.loi.Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="min-w-0 leading-relaxed">{cauDaTuChoi}</p>
          </div>
        )}

        {canhBaoDon && (
          <div role="alert" className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm", TONE.canh_bao.khung, TONE.canh_bao.chu)}>
            <TONE.canh_bao.Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="min-w-0 leading-relaxed">{CAU_DON_DA_CO_VET_BAC}</p>
          </div>
        )}

        {h === "PHIEU_DA_DONG" && (
          <p className="text-sm text-muted-foreground">
            Phiếu gộp của mã này đã đóng — đừng nhập mã này vào máy nữa. Vẫn kiểm tra được giao dịch đã quẹt.
          </p>
        )}

        <div aria-live="polite" className="min-h-0">
          {/* GĐ4 — cơ sở có máy POS Agent thì một lượt kiểm có thể CHỜ máy đồng bộ đọc portal tới ~8 giây. Nói
              trước thời gian chờ để sale không bấm dồn / cho khách quẹt lại. Câu cố ý KHÔNG nhắc "máy đồng bộ":
              trình duyệt không biết cơ sở này đọc từ agent hay từ file (luật 12 — câu phải đúng ở cả hai chế độ). */}
          {dangKiem ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              Đang hỏi Techcombank (tối đa ~10 giây)…
            </p>
          ) : null}
          {!dangKiem && hienDeIn && tone && (
            <div className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm", tone.khung, tone.chu)}>
              <tone.Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="leading-relaxed">{hienDeIn.thongDiep}</p>
                {hienDeIn.luc && <p className="mt-0.5 text-xs opacity-80">Kiểm lúc {hienDeIn.luc}</p>}
              </div>
            </div>
          )}
          {/* Rà ghép 10/10/2026 — DẤU HIỆU TIỀN ĐANG BAY (giao dịch chờ tay · dòng thẻ chưa ngã ngũ · …): lý do nằm NGAY dưới câu trạng thái, TRƯỚC mọi nút, tông cảnh báo —
              không phải dòng 12px xám cuối hộp. Câu lưu của lượt kiểm trước ("Chưa thấy…") có thể cãi nhau với dấu hiệu mới hơn; câu đúng không được nằm ở chỗ yếu nhất.
              Dấu hiệu khác (lỗi kết nối · kết quả chưa chốt) vẫn là dòng xám — cùng một cổng, cùng một nguồn `nut`. */}
          {nut.huyPhieuThe === "DONG_LY_DO" && (
            <div className="mt-2.5">
              <DongKhongHuyDuoc huy={phieu.huyPhieuThe} canh={nut.tienDangBay} />
            </div>
          )}
          {/* Việc 3 — khách ĐÃ quẹt thành công mà sale gõ sai mã: chọn đúng giao dịch của khách thay vì để kế toán tự tìm. Chỉ hiện đúng
              lúc hệ thống nói "Chưa thấy giao dịch" (`nutNhapSaiMa`); máy chủ không tin nút mà kiểm lại bằng sự thật. */}
          {!dangKiem && nut.nhapSaiMa && (
            <div className="mt-2.5">
              <Button type="button" variant="outline" onClick={onMoSaiMa} className="min-h-11 w-full gap-2 sm:min-h-9 sm:w-auto">
                <Search aria-hidden />
                Tôi nhập sai mã trên máy
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">
                Dùng khi biên lai máy đã báo THÀNH CÔNG nhưng mã ở ô Ghi chú gõ sai.
              </p>
              {/* GHÉP: cả "Tôi nhập sai mã" (khách ĐÃ quẹt) lẫn "Huỷ phiếu thẻ" (khách CHƯA quẹt) cùng hiện — chọn nhầm nút huỷ lúc khách đã quẹt là chính
                  điều cổng Việc 4 canh. Một câu nói vế còn lại, đứng NGAY dưới câu của nút này để hai vế đọc liền nhau. */}
              {nut.phanBiet && <p className="mt-1.5 text-xs text-muted-foreground">{CAU_PHAN_BIET_HAI_NUT}</p>}
            </div>
          )}
        </div>

        {/* VIỆC 4 — dòng "vì sao chưa huỷ được" của phiếu còn chờ quẹt đã in ở trên (ngay dưới câu trạng thái, trước các nút). Phiếu đã đóng · vừa gửi · đã bị từ
            chối MÀ KHÔNG huỷ được: hộp đã có câu nói đúng hơn nên `nut.huyPhieuThe` là "KHONG" (không in thêm một lệnh "ĐỪNG cho khách quẹt lại" thứ hai).
            VIỆC 6 · a2: đã bị từ chối mà cổng thường CHO huỷ thì `nut.huyPhieuThe` là "NUT" — nút "Huỷ phiếu thẻ" ở chân hộp, dưới dòng đỏ của yêu cầu. */}
      </div>

      {/* VIỆC 4: phiếu HUY không còn nút nào để đặt vào footer — ẩn, kẻo còn lại một dải xám rỗng. */}
      <DialogFooter className={cn("mx-0 mb-0 shrink-0 px-5 py-3", h === "HUY" && "hidden")}>
        {nut.huyPhieuThe === "NUT" && (
          <NutHuyPhieuThe
            orderId={orderId}
            phieu={phieu}
            dangBan={dangKiem || dangBao || dangTao}
            dangChay={dangHuy}
            batDau={batDauHuy}
            onBoKetQuaCu={onBoKetQuaCu}
          />
        )}
        {h === "HET_HAN" && !phieu.choKeToan && (
          <Button type="button" variant="outline" disabled={dangTao} onClick={onTaoMoi} className="min-h-11 gap-2 sm:min-h-10">
            {dangTao && <Loader2 className="animate-spin" aria-hidden />}
            Tạo phiếu mới
          </Button>
        )}
        {choBaoAdmin && (
          <Button type="button" variant="outline" disabled={dangBao || dangHuy} onClick={onBao} className="min-h-11 gap-2 sm:min-h-10">
            {dangBao ? <Loader2 className="animate-spin" aria-hidden /> : <BellRing aria-hidden />}
            Báo admin
          </Button>
        )}
        {phieu.duocKiemTra && (
          <Button
            type="button"
            variant={conCanGo || h === "HET_HAN" || h === "PHIEU_DA_DONG" ? "default" : "outline"}
            disabled={dangKiem || dangHuy}
            onClick={onKiem}
            // Xếp hạng: nút CHÍNH không được nhỏ hơn nút phụ cùng chân hộp — "Huỷ phiếu thẻ" (min-h-11) từng cao hơn "Kiểm tra" (40px) ở 375px (đo 10/10/2026).
            className="min-h-11 gap-2 sm:min-h-10"
          >
            {dangKiem && <Loader2 className="animate-spin" aria-hidden />}
            {dangKiem ? "Đang kiểm tra…" : "Kiểm tra thanh toán"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
