"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  themCauVaoDeAction,
  goCauKhoiDeAction,
  sapXepDeAction,
  kichHoatDeAction,
  suaDeAction,
} from "../_actions";

/**
 * EL-14c — DỰNG BỘ CÂU CHO MỘT ĐỀ.
 *
 * ⚠️ Đề đã kích hoạt thì màn này chỉ ĐỌC. Server cũng chặn, nhưng để bấm được rồi
 * mới báo lỗi là bắt người soạn thao tác một vòng vô ích — và với nút "Kích hoạt"
 * thì còn tệ hơn: họ tưởng mình vừa làm hỏng cái gì.
 */

export type CauTrongDe = {
  examQuestionId: string;
  stem: string;
  type: string;
  points: number;
};

const NHAN_LOAI: Record<string, string> = {
  SINGLE: "Một đáp án",
  MULTIPLE: "Nhiều đáp án",
  TRUE_FALSE: "Đúng / Sai",
  SHORT_ANSWER: "Trả lời ngắn",
  ESSAY: "Tự luận",
};

export function ExamBuilder(props: {
  examId: string;
  isActive: boolean;
  passScore: number;
  maxScore: number;
  title: string;
  durationMin: number;
  maxAttempts: number;
  cacCau: CauTrongDe[];
  /** Câu trong kho chưa có trong đề này. */
  khoCon: { id: string; stem: string; type: string; defaultPoints: number }[];
  duocKichHoat: boolean;
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [thuTu, setThuTu] = useState(props.cacCau.map((c) => c.examQuestionId));
  const [moSua, setMoSua] = useState(false);
  const [form, setForm] = useState({
    title: props.title,
    passScore: String(props.passScore),
    durationMin: String(props.durationMin),
    maxAttempts: String(props.maxAttempts),
  });

  const tong = props.cacCau.reduce((s, c) => s + c.points, 0);
  const coCauChamTay = props.cacCau.some(
    (c) => c.type === "SHORT_ANSWER" || c.type === "ESSAY",
  );

  const chay = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, ok: string) =>
    batDau(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error?.message ?? "Không thực hiện được");
        return;
      }
      toast.success(ok);
      router.refresh();
    });

  const doiCho = (i: number, huong: -1 | 1) => {
    const j = i + huong;
    if (j < 0 || j >= thuTu.length) return;
    const moi = [...thuTu];
    [moi[i], moi[j]] = [moi[j]!, moi[i]!];
    setThuTu(moi);
    chay(() => sapXepDeAction({ examId: props.examId, thuTu: moi }), "Đã đổi thứ tự");
  };

  if (props.isActive) {
    return (
      <div className="space-y-3">
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Đề đã kích hoạt — bộ câu và tổng điểm ({props.maxScore}) đã đóng băng. Sửa
          bộ câu sau khi có người thi sẽ làm lệch điểm của những lượt đã chấm, nên
          muốn thay đổi thì tạo đề mới.
        </p>
        <ol className="space-y-1 text-sm">
          {props.cacCau.map((c, i) => (
            <li key={c.examQuestionId} className="rounded-md border p-2">
              <span className="mr-2 text-xs text-muted-foreground">{i + 1}.</span>
              {c.stem}
              <span className="ml-2 text-xs text-muted-foreground">
                {NHAN_LOAI[c.type] ?? c.type} · {c.points} điểm
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-3 text-sm">
        <p>
          <strong>{props.cacCau.length}</strong> câu · tổng <strong>{tong}</strong> điểm
          · đạt từ <strong>{props.passScore}</strong>
        </p>
        {props.passScore > tong && props.cacCau.length > 0 ? (
          // Nói TRƯỚC, không đợi tới lúc bấm kích hoạt mới báo.
          <p className="mt-1 text-xs text-amber-800">
            Điểm đạt đang lớn hơn tổng điểm — thêm câu, hoặc sửa điểm đạt bên dưới,
            nếu không sẽ không ai qua được đề này.
          </p>
        ) : null}
        {coCauChamTay ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Đề có câu chấm tay — lượt thi sẽ vào hàng chờ chấm, không ra điểm ngay.
          </p>
        ) : null}
      </div>

      {/* ⚠️ Đường SỬA phải nằm ngay cạnh câu bảo người ta đi sửa. Câu cảnh báo ở
          trên nói "sửa điểm đạt" — nếu không có nút nào ở đây thì đó là một lựa chọn
          không có lối đi, và người soạn phải xoá đề làm lại từ đầu. */}
      {!props.isActive ? (
        <div className="rounded-md border p-3 text-sm">
          {moSua ? (
            <div className="space-y-2">
              <label className="block text-xs">
                <span className="text-muted-foreground">Tên đề</span>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  maxLength={200}
                  className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <label className="text-xs">
                  <span className="text-muted-foreground">Điểm đạt</span>
                  <input
                    type="number"
                    min={0}
                    value={form.passScore}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, passScore: e.target.value }))
                    }
                    className="mt-1 block w-24 rounded-md border px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs">
                  <span className="text-muted-foreground">Thời lượng (phút)</span>
                  <input
                    type="number"
                    min={1}
                    value={form.durationMin}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, durationMin: e.target.value }))
                    }
                    className="mt-1 block w-24 rounded-md border px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs">
                  <span className="text-muted-foreground">Số lượt tối đa</span>
                  <input
                    type="number"
                    min={1}
                    value={form.maxAttempts}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, maxAttempts: e.target.value }))
                    }
                    className="mt-1 block w-24 rounded-md border px-2 py-1 text-sm"
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {/* Nói TRƯỚC rằng cửa này sẽ đóng, để người soạn kiểm lại lần cuối
                    thay vì phát hiện lúc đã có người thi. */}
                Sửa được tới khi kích hoạt. Sau đó đề có người đang thi, đổi điểm đạt
                là chấm lại hồi tố các lượt đã xong.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={dangChay}
                  onClick={() =>
                    chay(
                      () =>
                        suaDeAction({
                          examId: props.examId,
                          title: form.title.trim(),
                          passScore: Number(form.passScore),
                          durationMin: Number(form.durationMin),
                          maxAttempts: Number(form.maxAttempts),
                        }),
                      "Đã lưu",
                    )
                  }
                  className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                >
                  Lưu
                </button>
                <button
                  type="button"
                  onClick={() => setMoSua(false)}
                  className="rounded-md border px-3 py-1.5 text-xs"
                >
                  Thôi
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setMoSua(true)}
              className="rounded-md border px-2 py-1 text-xs"
            >
              Sửa thông số đề
            </button>
          )}
        </div>
      ) : null}

      <ol className="space-y-1">
        {thuTu.map((eqId, i) => {
          const c = props.cacCau.find((x) => x.examQuestionId === eqId);
          if (!c) return null;
          return (
            <li key={eqId} className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm">
              <div>
                <span className="mr-2 text-xs text-muted-foreground">{i + 1}.</span>
                {c.stem}
                <span className="ml-2 text-xs text-muted-foreground">
                  {NHAN_LOAI[c.type] ?? c.type} · {c.points} điểm
                </span>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={dangChay || i === 0}
                  onClick={() => doiCho(i, -1)}
                  className="rounded border px-2 text-xs disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={dangChay || i === thuTu.length - 1}
                  onClick={() => doiCho(i, 1)}
                  className="rounded border px-2 text-xs disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={dangChay}
                  onClick={() =>
                    chay(
                      () =>
                        goCauKhoiDeAction({
                          examId: props.examId,
                          examQuestionId: eqId,
                        }),
                      "Đã gỡ câu khỏi đề",
                    )
                  }
                  className="rounded border px-2 text-xs disabled:opacity-30"
                >
                  Gỡ
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <div>
        <h3 className="text-sm font-bold">Thêm câu từ kho</h3>
        {props.khoCon.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Kho không còn câu nào chưa dùng cho đề này.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {props.khoCon.map((q) => (
              <li key={q.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <span>
                  {q.stem}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {NHAN_LOAI[q.type] ?? q.type} · {q.defaultPoints} điểm
                  </span>
                </span>
                <button
                  type="button"
                  disabled={dangChay}
                  onClick={() =>
                    chay(
                      () => themCauVaoDeAction({ examId: props.examId, questionId: q.id }),
                      "Đã thêm câu vào đề",
                    )
                  }
                  className="shrink-0 rounded-md border px-2 py-1 text-xs disabled:opacity-40"
                >
                  Thêm
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {props.duocKichHoat ? (
        <button
          type="button"
          disabled={dangChay || props.cacCau.length === 0 || props.passScore > tong}
          onClick={() =>
            chay(() => kichHoatDeAction({ examId: props.examId }), "Đã kích hoạt đề")
          }
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          Kích hoạt đề (đóng băng bộ câu)
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Kích hoạt đề cần quyền xuất bản nội dung — nhờ Đào tạo bấm giúp.
        </p>
      )}
    </div>
  );
}
