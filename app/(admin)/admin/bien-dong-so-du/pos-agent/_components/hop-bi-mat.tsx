"use client";

// Hộp hiện cấu hình máy đồng bộ + BÍ MẬT — MỘT lần (GĐ4 POS — T2, hợp đồng §2.2).
//
// Bí mật chỉ sống trong state của component cha, tới khi hộp đóng. Server KHÔNG lưu bí mật (dẫn xuất từ
// `POS_AGENT_MASTER_KEY`) nên không màn nào hiện lại được — đóng hộp là mất, mất thì "Tạo lại bí mật". Vì vậy:
//   · KHÔNG đóng khi bấm ra ngoài (`disablePointerDismissal`) — một cú bấm trượt không được làm mất bí mật;
//   · KHÔNG đóng bằng phím Esc (đợt /impeccable 07/10): bản trước chỉ chặn chuột, Esc vẫn đi qua `onOpenChange(false)`
//     ⇒ một phím quen tay là mất bí mật. Nay mọi yêu cầu đóng từ Dialog bị bỏ qua — chỉ nút có chữ đóng được;
//   · không nút × góc — đóng bằng nút có chữ nói rõ hệ quả;
//   · nút đóng NÓI THẬT (luật 12): bản trước luôn ghi "Đã chép — đóng" dù người dùng chưa chép gì. Nay: đã chép bí mật
//     (ô bí mật hoặc cả JSON) ⇒ một nhịp; chưa chép ⇒ nhịp đầu chỉ đổi nút thành lời cảnh báo, nhịp hai mới đóng
//     (trình duyệt cấm clipboard thì người dùng chọn chữ chép tay — vẫn đóng được, sau khi đã được nói rõ hệ quả);
//   · bí mật KHÔNG vào `aria-label` / `title` / console / URL.
import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, KeyRound, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CauHinhAgent } from "../_actions";

function NutChep({
  giaTri,
  nhan,
  nhanNut = "Chép",
  onDaChep,
}: {
  giaTri: string;
  nhan: string;
  nhanNut?: string;
  onDaChep?: () => void;
}) {
  const [daChep, datDaChep] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-11 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground sm:h-8"
      aria-label={`Chép ${nhan}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(giaTri);
          datDaChep(true);
          onDaChep?.();
          setTimeout(() => datDaChep(false), 1500);
        } catch {
          toast.error("Trình duyệt không cho chép — chọn chữ rồi chép tay.");
        }
      }}
    >
      {daChep ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {daChep ? "Đã chép" : nhanNut}
    </Button>
  );
}

export function HopBiMat({
  cauHinh,
  tieuDe,
  onDong,
}: {
  cauHinh: CauHinhAgent | null;
  tieuDe: string;
  onDong: () => void;
}) {
  const [daChepBiMat, datDaChepBiMat] = useState(false);
  const [xacNhanDong, datXacNhanDong] = useState(false);
  const chepBiMat = () => {
    datDaChepBiMat(true);
    datXacNhanDong(false);
  };
  function dong() {
    if (!daChepBiMat && !xacNhanDong) {
      datXacNhanDong(true);
      return;
    }
    datDaChepBiMat(false);
    datXacNhanDong(false);
    onDong();
  }
  // Cấu hình dán vào trang Options của extension — tên khoá ĐÚNG hợp đồng §2.1.
  const json = cauHinh
    ? JSON.stringify(
        {
          agentId: cauHinh.agentId,
          merchantCode: cauHinh.merchantCode,
          centerCode: cauHinh.centerCode,
          agentSecret: cauHinh.biMat,
          satAroboBaseUrl: cauHinh.satAroboBaseUrl,
        },
        null,
        2,
      )
    : "";
  const o: { nhan: string; giaTri: string; biMat?: boolean }[] = cauHinh
    ? [
        { nhan: "Mã máy (agentId)", giaTri: cauHinh.agentId },
        { nhan: "Merchant (merchantCode)", giaTri: cauHinh.merchantCode },
        { nhan: "Cơ sở (centerCode)", giaTri: cauHinh.centerCode || "—" },
        { nhan: "Địa chỉ satarobo (satAroboBaseUrl)", giaTri: cauHinh.satAroboBaseUrl || "—" },
        { nhan: "Bí mật (agentSecret)", giaTri: cauHinh.biMat, biMat: true },
      ]
    : [];

  return (
    <Dialog
      open={cauHinh !== null}
      disablePointerDismissal
      // Bỏ qua MỌI yêu cầu đóng từ Dialog (Esc, bấm ra ngoài) — chỉ nút có chữ ở chân hộp đóng được (xem đầu tệp).
      onOpenChange={() => {}}
    >
      {/* `admin-scope`: Dialog render qua PORTAL ra ngoài khung admin ⇒ thiếu class này là nút lấy `--primary`
          của :root thay vì màu admin (tiền lệ `tab-may-pos-bang.tsx`). */}
      <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" aria-hidden />
            {tieuDe}
          </DialogTitle>
          <DialogDescription>
            Dán năm ô này vào trang Options của extension “SataRobo POS Agent” trên đúng hồ sơ Chrome của cơ
            sở, rồi lưu.
          </DialogDescription>
        </DialogHeader>

        <div
          role="note"
          className="flex gap-2 rounded-lg bg-state-warning-soft px-3 py-2 text-xs leading-relaxed text-state-warning-ink"
        >
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <p>
            <b className="font-semibold">Đóng hộp này là mất bí mật</b>{" "}
            — hệ thống không lưu và không hiện lại. Mất
            hoặc lộ thì bấm “Tạo lại bí mật” trên thẻ của máy: bí mật cũ chết ngay.
          </p>
        </div>

        <dl className="divide-y divide-border rounded-lg border border-border">
          {o.map((x) => (
            <div key={x.nhan} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <dt className="text-xs text-muted-foreground">{x.nhan}</dt>
                {/* `select-all`: trình duyệt cấm clipboard thì một cú bấm chọn trọn giá trị để chép tay — đúng lời
                    toast "chọn chữ rồi chép tay" hứa. */}
                <dd
                  className={
                    x.biMat
                      ? "mt-0.5 select-all font-mono text-xs font-semibold text-foreground [overflow-wrap:anywhere]"
                      : "mt-0.5 truncate select-all font-mono text-xs text-foreground"
                  }
                >
                  {x.giaTri}
                </dd>
              </div>
              {x.giaTri !== "—" ? <NutChep giaTri={x.giaTri} nhan={x.nhan} onDaChep={x.biMat ? chepBiMat : undefined} /> : null}
            </div>
          ))}
        </dl>

        {cauHinh && !cauHinh.satAroboBaseUrl ? (
          <p className="text-xs text-muted-foreground">
            Không suy được địa chỉ satarobo từ trình duyệt — điền tay: prod <code className="font-mono">https://admin.satarobo.vn</code>,
            test <code className="font-mono">https://test.satarobo.vn</code>.
          </p>
        ) : null}

        {xacNhanDong ? (
          <p role="alert" className="text-xs text-state-danger-ink">
            Bạn chưa chép bí mật bằng nút “Chép”. Đã chép tay thì bấm lần nữa để đóng.
          </p>
        ) : null}
        <DialogFooter className="gap-2 sm:justify-between">
          <NutChep giaTri={json} nhan="cấu hình JSON" nhanNut="Chép cả cấu hình (JSON)" onDaChep={chepBiMat} />
          <Button
            type="button"
            variant={xacNhanDong ? "destructive" : "default"}
            // Repo chưa khai `--destructive-foreground` ⇒ biến thể destructive in chữ gần đen trên nền đỏ (đo: 4,4:1,
            // dưới 4,5:1). Chữ trắng trên cùng nền: 4,7:1.
            className={xacNhanDong ? "min-h-11 text-white sm:min-h-9" : "min-h-11 sm:min-h-9"}
            onClick={dong}
          >
            {daChepBiMat ? "Đã chép — đóng" : xacNhanDong ? "Bấm lần nữa — đóng và mất bí mật" : "Đóng"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
