"use client";

// Hai cụm thao tác của màn Sức khoẻ POS Agent (GĐ4 POS — §9.2): TẠO máy đồng bộ, và trên từng thẻ máy: TẠO LẠI
// bí mật · TẮT / BẬT. Trang chỉ vẽ hai cụm này khi người xem có `settings:edit` VÀ máy chủ có master key — đúng
// hai cổng ba action hỏi lại ở server (luật 12: không vẽ nút mà action chắc chắn từ chối).
//
// Bí mật nằm trong state của CHÍNH component gọi action, tới khi hộp đóng. ⚠️ Vị trí của hai component này trên
// cây phải ỔN ĐỊNH qua lượt làm mới sau action (`revalidatePath`): component bị gỡ ⇒ state mất ⇒ bí mật mất trước
// khi người dùng kịp chép. Trang đặt `TaoMayDongBo` ở một khối cố định (không nằm trong nhánh "chưa có máy nào"),
// và `NutMayDongBo` mang `key` = id máy.
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { KeyRound, Plus, Power, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { doiTrangThaiAgentAction, taoLaiBiMatAgentAction, taoPosAgentAction, type CauHinhAgent } from "../_actions";
import { HopBiMat } from "./hop-bi-mat";

const LOI_KHONG_RO = "Không lưu được do lỗi kết nối hoặc máy chủ. Thử lại sau ít phút.";

type HopMo = { cauHinh: CauHinhAgent; tieuDe: string } | null;

/** Đúng năm ô cấu hình — không mang theo gì khác của kết quả action. */
function cauHinhTu(kq: CauHinhAgent): CauHinhAgent {
  return {
    agentId: kq.agentId,
    merchantCode: kq.merchantCode,
    centerCode: kq.centerCode,
    satAroboBaseUrl: kq.satAroboBaseUrl,
    biMat: kq.biMat,
  };
}

/** Khối "Thêm POS Agent": một merchant portal Techcombank = một POS Agent, gắn MỘT cơ sở. */
export function TaoMayDongBo({ coSo }: { coSo: { value: string; label: string }[] }) {
  const [centerId, datCenterId] = useState(coSo.length === 1 ? coSo[0]!.value : "");
  const [merchant, datMerchant] = useState("");
  const [loi, datLoi] = useState<string | null>(null);
  const [hop, datHop] = useState<HopMo>(null);
  const [dangCho, batDau] = useTransition();

  function gui(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    datLoi(null);
    batDau(async () => {
      try {
        const kq = await taoPosAgentAction({ centerId, merchantCode: merchant });
        if (!kq.ok) {
          datLoi(kq.error);
          return;
        }
        const cauHinh = cauHinhTu(kq);
        datMerchant("");
        datHop({ cauHinh, tieuDe: `POS Agent ${cauHinh.centerCode || "mới"} · ${cauHinh.merchantCode}` });
      } catch {
        datLoi(LOI_KHONG_RO);
      }
    });
  }

  if (coSo.length === 0) {
    return (
      <p className="text-sm text-state-warning-ink">
        Bạn chưa quản lý cơ sở nào đang hoạt động nên chưa tạo được POS Agent.
      </p>
    );
  }

  return (
    <>
      <form onSubmit={gui} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end" noValidate>
        <div className="flex min-w-0 flex-col gap-1.5 sm:w-56">
          <Label htmlFor="tao-agent-co-so">Cơ sở</Label>
          <select
            id="tao-agent-co-so"
            value={centerId}
            onChange={(e) => datCenterId(e.target.value)}
            className="h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9"
          >
            {coSo.length > 1 ? <option value="">Chọn cơ sở…</option> : null}
            {coSo.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:w-56">
          <Label htmlFor="tao-agent-merchant">Mã merchant Techcombank</Label>
          <Input
            id="tao-agent-merchant"
            value={merchant}
            onChange={(e) => datMerchant(e.target.value)}
            placeholder="vd NCCPH6KE"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="tao-agent-merchant-goi-y"
            aria-invalid={loi !== null ? true : undefined}
            className="h-11 font-mono uppercase placeholder:font-sans placeholder:normal-case sm:h-9"
          />
        </div>
        <Button type="submit" className="min-h-11 sm:min-h-9" disabled={dangCho || !centerId || merchant.trim() === ""}>
          <Plus aria-hidden />
          {dangCho ? "Đang tạo…" : "Tạo và lấy cấu hình"}
        </Button>
        <p id="tao-agent-merchant-goi-y" className="text-xs text-muted-foreground sm:basis-full">
          Mã merchant in trên portal Techcombank (mục Giao dịch, cột Merchant). Một merchant chỉ có một POS Agent.
        </p>
        {loi ? (
          <p role="alert" className="text-sm text-state-danger-ink sm:basis-full">
            {loi}
          </p>
        ) : null}
      </form>
      <HopBiMat cauHinh={hop?.cauHinh ?? null} tieuDe={hop?.tieuDe ?? ""} onDong={() => datHop(null)} />
    </>
  );
}

/**
 * Nút trên MỘT thẻ máy. "Tạo lại bí mật" và "Tắt" đều xác nhận hai nhịp (nếp admin): bí mật cũ chết NGAY khi
 * tạo lại, còn tắt là đổi chế độ đọc của cả cơ sở. "Bật lại" một nhịp — nó chỉ đưa máy về đúng trạng thái màn
 * đang báo.
 */
export function NutMayDongBo({
  agentId,
  coSo,
  merchantCode,
  secretVersion,
  active,
}: {
  agentId: string;
  coSo: string;
  merchantCode: string;
  secretVersion: number;
  active: boolean;
}) {
  const [cho, datCho] = useState<"bi-mat" | "tat" | null>(null);
  const [hop, datHop] = useState<HopMo>(null);
  const [dangCho, batDau] = useTransition();
  const [viec, datViec] = useState<"bi-mat" | "tat" | "bat" | null>(null);

  function taoLai() {
    if (cho !== "bi-mat") {
      datCho("bi-mat");
      return;
    }
    datViec("bi-mat");
    batDau(async () => {
      try {
        const kq = await taoLaiBiMatAgentAction({ agentId, secretVersionDangThay: secretVersion });
        if (!kq.ok) {
          toast.error(kq.error);
          return;
        }
        const cauHinh = cauHinhTu(kq);
        datHop({ cauHinh, tieuDe: `Bí mật mới — ${coSo} · ${merchantCode}` });
      } catch {
        toast.error(LOI_KHONG_RO);
      } finally {
        datCho(null);
        datViec(null);
      }
    });
  }

  function doi(batLai: boolean) {
    if (!batLai && cho !== "tat") {
      datCho("tat");
      return;
    }
    datViec(batLai ? "bat" : "tat");
    batDau(async () => {
      try {
        const kq = await doiTrangThaiAgentAction({ agentId, active: batLai });
        if (!kq.ok) {
          toast.error(kq.error);
          return;
        }
        toast.success(
          batLai
            ? `Đã bật lại POS Agent ${coSo}.`
            : `Đã tắt POS Agent ${coSo} — phiếu thu thẻ của ${coSo} đọc dữ liệu từ file Techcombank nhập tay.`,
        );
      } catch {
        toast.error(LOI_KHONG_RO);
      } finally {
        datCho(null);
        datViec(null);
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {cho !== null ? (
          <Button type="button" size="sm" variant="ghost" className="min-h-11 sm:min-h-9" disabled={dangCho} onClick={() => datCho(null)}>
            Thôi
          </Button>
        ) : null}
        {cho !== "tat" ? (
          <Button
            type="button"
            size="sm"
            variant={cho === "bi-mat" ? "destructive" : "outline"}
            className={cho === "bi-mat" ? "min-h-11 text-white sm:min-h-9" : "min-h-11 sm:min-h-9"}
            disabled={dangCho}
            onClick={taoLai}
          >
            <KeyRound aria-hidden />
            {viec === "bi-mat" ? "Đang tạo…" : cho === "bi-mat" ? "Bấm lần nữa — bí mật cũ chết ngay" : "Tạo lại bí mật"}
          </Button>
        ) : null}
        {cho !== "bi-mat" ? (
          active ? (
            <Button
              type="button"
              size="sm"
              variant={cho === "tat" ? "destructive" : "outline"}
              className={cho === "tat" ? "min-h-11 text-white sm:min-h-9" : "min-h-11 sm:min-h-9"}
              disabled={dangCho}
              onClick={() => doi(false)}
            >
              <PowerOff aria-hidden />
              {viec === "tat" ? "Đang tắt…" : cho === "tat" ? `Bấm lần nữa — ${coSo} về đọc file` : "Tắt"}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              disabled={dangCho}
              onClick={() => doi(true)}
            >
              <Power aria-hidden />
              {viec === "bat" ? "Đang bật…" : "Bật lại"}
            </Button>
          )
        ) : null}
      </div>
      <HopBiMat cauHinh={hop?.cauHinh ?? null} tieuDe={hop?.tieuDe ?? ""} onDong={() => datHop(null)} />
    </>
  );
}
