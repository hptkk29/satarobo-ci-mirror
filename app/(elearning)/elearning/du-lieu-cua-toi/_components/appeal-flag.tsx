"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { khieuNaiCoAction } from "../../_actions";

/**
 * EL-13 — Ô KHIẾU NẠI MỘT CỜ NGHI NGỜ.
 *
 * ⚠️ Màn này phải nói CẢ BA thứ, không chỉ "bạn bị gắn cờ":
 *  · cờ này dựa trên CON SỐ NÀO (bằng chứng đã đóng băng),
 *  · còn BAO NHIÊU NGÀY để nói lại,
 *  · và điều gì xảy ra nếu không nói gì.
 *
 * Thiếu vế cuối là để người ta phát hiện khi đã muộn: hết 14 ngày, cờ tự chốt
 * thành "giữ cờ", và lúc đó không mở lại được nữa.
 */

const nhan: Record<string, string> = {
  WATCH_TIME_TOO_LOW: "Nội dung ghi nhận đã xem nhiều hơn thời gian thực tế cho phép",
  SEEK_ABUSE: "Nhiều lần tua tới phần chưa xem",
  TOO_FAST: "Tốc độ ghi nhận vượt trần tốc độ phát",
  HEARTBEAT_FLOOD: "Nhịp gửi lên dày bất thường so với chu kỳ chuẩn",
};

export function AppealFlag(props: {
  flagId: string;
  ruleCode: string;
  status: string;
  openedAt: string;
  appealDeadline: string;
  conNgay: number;
  evidence: Record<string, number>;
  appealNote?: string | null;
  decisionNote?: string | null;
}) {
  const [mo, setMo] = useState(false);
  const [noiDung, setNoiDung] = useState("");
  const [dangGui, batDau] = useTransition();

  const guiKhieuNai = () => {
    batDau(async () => {
      const r = await khieuNaiCoAction({ flagId: props.flagId, noiDung });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success("Đã gửi khiếu nại — người phụ trách sẽ trả lời trong 5 ngày làm việc");
      setMo(false);
    });
  };

  const conMoDuoc = props.status === "OPEN" && props.conNgay > 0;

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/60 p-3 text-sm">
      <p className="font-medium">{nhan[props.ruleCode] ?? props.ruleCode}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Ghi nhận lúc {props.openedAt}
      </p>

      {/* Bằng chứng hiện NGUYÊN con số. Người bị gắn cờ phải thấy chính thứ người
          xử nhìn — nếu không, mọi trao đổi là hai bên nói về hai bộ số khác nhau. */}
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {Object.entries(props.evidence).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-mono">{v}</dd>
          </div>
        ))}
      </dl>

      {props.status === "OPEN" ? (
        <p className="mt-2 text-xs">
          {props.conNgay > 0 ? (
            <>
              Còn <strong>{props.conNgay} ngày</strong> để khiếu nại (hạn{" "}
              {props.appealDeadline}). Hết hạn mà không có khiếu nại,{" "}
              <strong>cờ tự chốt thành “giữ cờ”</strong> và không mở lại được.
            </>
          ) : (
            <>Đã hết cửa sổ khiếu nại ({props.appealDeadline}).</>
          )}
        </p>
      ) : null}

      {props.status === "APPEALED" ? (
        <p className="mt-2 text-xs text-blue-800">
          Đã gửi khiếu nại — đang chờ người phụ trách trả lời.
        </p>
      ) : null}

      {props.status === "UPHELD" || props.status === "REVOKED" ? (
        <p className="mt-2 text-xs">
          Kết quả:{" "}
          <strong>{props.status === "REVOKED" ? "đã gỡ cờ" : "giữ cờ"}</strong>
          {props.decisionNote ? ` — ${props.decisionNote}` : ""}
        </p>
      ) : null}

      {props.appealNote ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Khiếu nại của bạn: {props.appealNote}
        </p>
      ) : null}

      {conMoDuoc ? (
        mo ? (
          <div className="mt-3 space-y-2">
            <textarea
              value={noiDung}
              onChange={(e) => setNoiDung(e.target.value)}
              rows={3}
              placeholder="Nói rõ vì sao số liệu này không đúng…"
              className="w-full rounded-md border px-2 py-1 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={dangGui || noiDung.trim().length < 10}
                onClick={guiKhieuNai}
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
              >
                {dangGui ? "Đang gửi…" : "Gửi khiếu nại"}
              </button>
              <button
                type="button"
                onClick={() => setMo(false)}
                className="rounded-md border px-3 py-1.5 text-xs"
              >
                Thôi
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMo(true)}
            className="mt-3 rounded-md border px-3 py-1.5 text-xs"
          >
            Tôi không đồng ý với ghi nhận này
          </button>
        )
      ) : null}
    </div>
  );
}
