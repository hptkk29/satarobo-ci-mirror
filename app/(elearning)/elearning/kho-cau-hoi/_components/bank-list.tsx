"use client";

import { useState } from "react";
import { QuestionForm, type CauHoiHienCo } from "./question-form";

/**
 * EL-14b — DANH SÁCH KHO CÂU HỎI.
 *
 * ⚠️ `xemNoiDung` quyết định người này có thấy ĐỀ BÀI và ĐÁP ÁN không. Nó được cắt
 * ở SERVER (trang không gửi nội dung xuống nếu thiếu quyền), còn ở đây chỉ là vẽ.
 * Ẩn bằng CSS là để nội dung nằm trong HTML — mở F12 ra là đọc được, và cả kho câu
 * hỏi mất giá trị.
 */

const NHAN_LOAI: Record<string, string> = {
  SINGLE: "Một đáp án",
  MULTIPLE: "Nhiều đáp án",
  TRUE_FALSE: "Đúng / Sai",
  SHORT_ANSWER: "Trả lời ngắn",
  ESSAY: "Tự luận",
};

const NHAN_KHO: Record<string, string> = {
  EASY: "Dễ",
  MEDIUM: "TB",
  HARD: "Khó",
};

export type DongKho = {
  id: string;
  bankPath: string;
  type: string;
  difficulty: string;
  defaultPoints: number;
  /** `null` khi người xem không có quyền thấy nội dung. */
  stem: string | null;
  daVaoDe: boolean;
  chiTiet: CauHoiHienCo | null;
};

export function BankList(props: {
  dong: DongKho[];
  xemNoiDung: boolean;
  bankPathMacDinh: string;
}) {
  const [dangSua, setDangSua] = useState<string | null>(null);
  const [themMoi, setThemMoi] = useState(false);

  return (
    <div className="space-y-4">
      {props.xemNoiDung ? (
        themMoi ? (
          <QuestionForm
            bankPathMacDinh={props.bankPathMacDinh}
            onXong={() => setThemMoi(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setThemMoi(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          >
            Thêm câu hỏi
          </button>
        )
      ) : (
        // Nói THẲNG vì sao trống, thay vì để họ tưởng kho chưa có gì.
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Bạn xem được thống kê kho câu hỏi nhưng không xem được nội dung câu và đáp
          án — phần đó dành cho Đào tạo.
        </p>
      )}

      {props.dong.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có câu hỏi nào ở nhánh này.</p>
      ) : (
        <ul className="space-y-2">
          {props.dong.map((d) => (
            <li key={d.id} className="rounded-md border p-3 text-sm">
              {dangSua === d.id && d.chiTiet ? (
                <QuestionForm
                  cauHienCo={d.chiTiet}
                  bankPathMacDinh={props.bankPathMacDinh}
                  onXong={() => setDangSua(null)}
                />
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={d.stem ? "" : "italic text-muted-foreground"}>
                      {d.stem ?? "(nội dung ẩn)"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="font-mono">{d.bankPath}</span> ·{" "}
                      {NHAN_LOAI[d.type] ?? d.type} · {NHAN_KHO[d.difficulty] ?? d.difficulty}{" "}
                      · {d.defaultPoints} điểm
                      {d.daVaoDe ? " · đã dùng trong đề" : ""}
                    </p>
                  </div>
                  {props.xemNoiDung && d.chiTiet ? (
                    <button
                      type="button"
                      onClick={() => setDangSua(d.id)}
                      // Câu đã vào đề thì server từ chối sửa. Khoá nút luôn để họ
                      // không gõ xong mới bị báo lỗi.
                      disabled={d.daVaoDe}
                      title={d.daVaoDe ? "Câu đã nằm trong đề — nhân bản thay vì sửa" : ""}
                      className="shrink-0 rounded-md border px-2 py-1 text-xs disabled:opacity-40"
                    >
                      Sửa
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
