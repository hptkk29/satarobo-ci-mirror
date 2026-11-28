"use client";

// Hộp hiện KHOÁ AGENT — MỘT lần. Khuôn: `bien-dong-so-du/pos-agent/_components/hop-bi-mat.tsx`.
//
// Server KHÔNG lưu khoá (dẫn xuất từ AI_LEAD_AGENT_MASTER_KEY) nên không màn nào hiện lại được — đóng hộp là mất; mất thì “Tạo lại khoá” (khoá cũ chết ngay).
//   · KHÔNG đóng khi bấm ra ngoài hay phím Esc (mọi yêu cầu đóng từ Dialog bị bỏ qua): chỉ nút có chữ ở chân hộp đóng được;
//   · nút đóng NÓI THẬT: chưa chép khoá bằng nút “Chép” thì nhịp đầu chỉ đổi nút thành lời cảnh báo, nhịp hai mới đóng;
//   · khoá chỉ sống trong prop `cauHinh` của cha (state), KHÔNG vào aria-label / title / console / URL / localStorage; cha đặt `null` khi đóng ⇒ khoá biến khỏi DOM.
import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, KeyRound, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CauHinhKhoa } from "../cau-hinh/_actions";

function NutChep({ giaTri, nhan, nhanNut = "Chép", onDaChep }: { giaTri: string; nhan: string; nhanNut?: string; onDaChep?: () => void }) {
  const [daChep, datDaChep] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      className="min-h-11 shrink-0 gap-1.5 px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
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

export function HopKhoa({ cauHinh, tieuDe, onDong }: { cauHinh: CauHinhKhoa | null; tieuDe: string; onDong: () => void }) {
  const [daChepKhoa, datDaChepKhoa] = useState(false);
  const [canhBaoDong, datCanhBaoDong] = useState(false);
  const chepKhoa = () => {
    datDaChepKhoa(true);
    datCanhBaoDong(false);
  };
  function dong() {
    if (!daChepKhoa && !canhBaoDong) {
      datCanhBaoDong(true);
      return;
    }
    datDaChepKhoa(false);
    datCanhBaoDong(false);
    onDong();
  }

  const json = cauHinh
    ? JSON.stringify(
        { agentId: cauHinh.agentId, environment: cauHinh.environment, baseUrl: cauHinh.baseUrl, agentSecret: cauHinh.agentSecret },
        null,
        2,
      )
    : "";
  const o: { nhan: string; giaTri: string; khoa?: boolean }[] = cauHinh
    ? [
        { nhan: "Mã Agent (agentId)", giaTri: cauHinh.agentId },
        { nhan: "Môi trường", giaTri: cauHinh.environment },
        { nhan: "Địa chỉ gốc (baseUrl)", giaTri: cauHinh.baseUrl || "—" },
        { nhan: "Khoá (agentSecret)", giaTri: cauHinh.agentSecret, khoa: true },
      ]
    : [];

  return (
    <Dialog open={cauHinh !== null} disablePointerDismissal onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="admin-scope max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" aria-hidden />
            {tieuDe}
          </DialogTitle>
          <DialogDescription>
            Gửi các giá trị này cho đội Agent qua kênh an toàn. Môi trường TEST và PROD dùng khoá riêng — không dùng chéo.
          </DialogDescription>
        </DialogHeader>

        <div role="note" className="flex gap-2 rounded-lg bg-state-warning-soft px-3 py-2 text-xs leading-relaxed text-state-warning-ink">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <p>
            <b className="font-semibold">Đóng hộp này là mất khoá</b> — hệ thống không lưu và không hiện lại. Mất hoặc lộ thì bấm “Tạo lại khoá”: khoá cũ chết ngay.
          </p>
        </div>

        <dl className="divide-y divide-border rounded-lg border border-border">
          {o.map((x) => (
            <div key={x.nhan} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <dt className="text-xs text-muted-foreground">{x.nhan}</dt>
                {/* `select-all`: trình duyệt cấm clipboard thì một cú bấm chọn trọn giá trị để chép tay. */}
                <dd
                  data-khoa={x.khoa ? "true" : undefined}
                  className={
                    x.khoa
                      ? "mt-0.5 select-all font-mono text-xs font-semibold text-foreground [overflow-wrap:anywhere]"
                      : "mt-0.5 select-all font-mono text-xs text-foreground [overflow-wrap:anywhere]"
                  }
                >
                  {x.giaTri}
                </dd>
              </div>
              {x.giaTri !== "—" ? <NutChep giaTri={x.giaTri} nhan={x.nhan} onDaChep={x.khoa ? chepKhoa : undefined} /> : null}
            </div>
          ))}
        </dl>

        {cauHinh && !cauHinh.baseUrl ? (
          <p className="text-xs text-muted-foreground">
            Không suy được địa chỉ từ trình duyệt — điền tay: prod <code className="font-mono">https://admin.satarobo.vn/api/ai-lead-agent/v1</code>, test{" "}
            <code className="font-mono">https://test.satarobo.vn/api/ai-lead-agent/v1</code>.
          </p>
        ) : null}

        {canhBaoDong ? (
          <p role="alert" className="text-xs text-state-danger-ink">
            Bạn chưa chép khoá bằng nút “Chép”. Đã chép tay thì bấm lần nữa để đóng.
          </p>
        ) : null}
        <DialogFooter className="gap-2 sm:justify-between">
          <NutChep giaTri={json} nhan="cấu hình JSON" nhanNut="Chép cả cấu hình (JSON)" onDaChep={chepKhoa} />
          <Button
            type="button"
            variant={canhBaoDong ? "destructive" : "default"}
            className={canhBaoDong ? "min-h-11 text-white" : "min-h-11"}
            onClick={dong}
          >
            {daChepKhoa ? "Đã chép — đóng" : canhBaoDong ? "Bấm lần nữa — đóng và mất khoá" : "Đóng"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
