"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { batTatLuatAction } from "../../_actions";

/**
 * EL-18 — BẬT / TẮT một luật tự động hoá.
 *
 * ⚠️ Bật là để hệ thống tự giao việc cho người khác mà không ai bấm nút nữa. Ô lý do
 * chính là bước xác nhận: gõ được một câu giải thích thì không phải bấm nhầm.
 *
 * ⚠️ Nói rõ TẮT không xoá nhật ký — người vận hành hay tưởng tắt là dọn sạch, rồi tắt
 * đi để "làm lại từ đầu" và mất luôn lịch sử trả lời câu "vì sao tôi được giao khoá
 * này".
 */
export function RuleToggle(props: { ruleId: string; dangBat: boolean; ten: string }) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");

  const du = lyDo.trim().length >= 10;
  const sapBat = !props.dangBat;

  const doi = () =>
    batDau(async () => {
      const r = await batTatLuatAction(
        { ruleId: props.ruleId, enabled: sapBat },
        // `reason` ở tham số THỨ HAI — schema `.strict()`.
        { reason: lyDo.trim() },
      );
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(sapBat ? "Đã bật luật" : "Đã tắt luật");
      setMo(false);
      setLyDo("");
      router.refresh();
    });

  if (!mo) {
    return (
      <button
        type="button"
        onClick={() => setMo(true)}
        className="rounded-md border px-2 py-1 text-xs"
      >
        {sapBat ? "Bật luật" : "Tắt luật"}
      </button>
    );
  }

  return (
    <div className="space-y-1 rounded-md border p-2 text-xs">
      <p className="text-muted-foreground">
        {sapBat ? (
          <>
            Bật <strong>{props.ten}</strong>: từ lúc này hệ thống sẽ TỰ giao việc theo
            luật, không ai bấm nút nữa. Mọi lần thi hành đều vào nhật ký.
          </>
        ) : (
          <>
            Tắt <strong>{props.ten}</strong>: luật thôi chạy, nhưng nhật ký đã ghi
            KHÔNG bị xoá — đó là chỗ trả lời câu &ldquo;vì sao tôi được giao khoá
            này&rdquo;.
          </>
        )}
      </p>
      <textarea
        value={lyDo}
        onChange={(e) => setLyDo(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Lý do (bắt buộc, ít nhất 10 ký tự) — sẽ lưu vào nhật ký"
        className="w-full rounded-md border px-2 py-1"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={dangChay || !du}
          onClick={doi}
          className={`rounded-md px-3 py-1 text-primary-foreground disabled:opacity-50 ${
            sapBat ? "bg-primary" : "bg-destructive"
          }`}
        >
          {dangChay ? "Đang lưu…" : sapBat ? "Xác nhận bật" : "Xác nhận tắt"}
        </button>
        <button
          type="button"
          onClick={() => setMo(false)}
          className="rounded-md border px-3 py-1"
        >
          Thôi
        </button>
      </div>
    </div>
  );
}
