"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/blog/markdown-renderer";
import { computeMinReadSeconds, demoteH1 } from "@/lib/elearning/reading";
import { luuBaiDocAction } from "../_actions";

/**
 * EL-04 — TRÌNH SOẠN BÀI ĐỌC: soạn bên trái, xem trước bên phải.
 *
 * ⚠️ Khung xem trước dùng ĐÚNG `MarkdownRenderer` và ĐÚNG `demoteH1` mà trang học
 * dùng. Hai bộ render khác nhau là cách chắc chắn nhất để người soạn thấy một
 * đằng còn người học thấy một nẻo — và họ chỉ phát hiện sau khi bài đã phát ra.
 */

const KHOA_NHAP = "el:soan-bai:";

export function LessonEditor(props: {
  lessonId: string;
  titleBanDau: string;
  contentBanDau: string;
}) {
  const [title, setTitle] = useState(props.titleBanDau);
  const [noiDung, setNoiDung] = useState(props.contentBanDau);
  const [dangLuu, chuyen] = useTransition();
  const [coBanNhap, setCoBanNhap] = useState(false);
  const khoa = KHOA_NHAP + props.lessonId;
  const daNapNhap = useRef(false);

  // ── Bản nháp: khôi phục được sau khi đóng nhầm tab ────────────────────────
  useEffect(() => {
    if (daNapNhap.current) return;
    daNapNhap.current = true;
    try {
      const luu = window.localStorage.getItem(khoa);
      if (!luu) return;
      const j = JSON.parse(luu) as { title: string; noiDung: string };
      // KHÔNG tự khôi phục đè lên nội dung đang có: bản nháp có thể cũ hơn bản
      // người khác vừa lưu trên server. Chỉ BÁO là có, để người soạn tự chọn.
      if (j.noiDung !== props.contentBanDau) setCoBanNhap(true);
    } catch {
      // localStorage hỏng/đầy không được làm chết trình soạn.
    }
  }, [khoa, props.contentBanDau]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(khoa, JSON.stringify({ title, noiDung }));
      } catch {
        /* đầy bộ nhớ — bỏ qua, không chặn việc soạn */
      }
    }, 800);
    return () => clearTimeout(t);
  }, [khoa, title, noiDung]);

  // ── Ngưỡng đọc: hiện NGAY để người soạn thấy hệ quả của độ dài bài ────────
  // Dùng CHÍNH hàm server dùng lúc lưu — không ước lượng lại ở client, vì hai
  // công thức lệch nhau thì con số hiện ở đây là lời hứa sai.
  const nguong = useMemo(() => computeMinReadSeconds(noiDung), [noiDung]);

  const luu = () =>
    chuyen(async () => {
      const r = await luuBaiDocAction({
        lessonId: props.lessonId,
        title,
        contentMd: noiDung,
      });
      if (r.ok) {
        try {
          window.localStorage.removeItem(khoa);
        } catch {
          /* không quan trọng */
        }
        setCoBanNhap(false);
        toast.success("Đã lưu bài");
      } else {
        toast.error(r.error.message);
      }
    });

  const chen = (truoc: string, sau = "") => {
    const el = document.getElementById("el-soan") as HTMLTextAreaElement | null;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const chon = noiDung.slice(a, b);
    setNoiDung(noiDung.slice(0, a) + truoc + chon + sau + noiDung.slice(b));
    // Trả con trỏ về giữa cặp dấu, nếu không người dùng phải tự bấm vào — thao
    // tác nhỏ nhưng lặp mỗi lần chèn.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + truoc.length, a + truoc.length + chon.length);
    });
  };

  return (
    <div className="space-y-3">
      {coBanNhap && (
        <div className="rounded-lg border border-state-warning-soft bg-state-warning-soft/40 px-3 py-2 text-xs">
          Có bản nháp chưa lưu trên máy này.{" "}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              try {
                const j = JSON.parse(
                  window.localStorage.getItem(khoa) ?? "{}",
                ) as { title?: string; noiDung?: string };
                if (j.title) setTitle(j.title);
                if (j.noiDung) setNoiDung(j.noiDung);
                setCoBanNhap(false);
              } catch {
                setCoBanNhap(false);
              }
            }}
          >
            Khôi phục
          </button>{" "}
          ·{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              try {
                window.localStorage.removeItem(khoa);
              } catch {
                /* bỏ qua */
              }
              setCoBanNhap(false);
            }}
          >
            Bỏ bản nháp
          </button>
        </div>
      )}

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Tên bài"
        aria-label="Tên bài"
        className="w-full rounded-lg border border-border px-3 py-2 text-lg font-bold"
      />

      <div className="flex flex-wrap gap-1">
        {(
          [
            ["Đậm", "**", "**"],
            ["Nghiêng", "_", "_"],
            ["Tiêu đề", "## ", ""],
            ["Danh sách", "- ", ""],
            ["Trích dẫn", "> ", ""],
            ["Mã", "`", "`"],
            ["Liên kết", "[", "](https://)"],
          ] as const
        ).map(([nhan, truoc, sau]) => (
          <button
            key={nhan}
            type="button"
            onClick={() => chen(truoc, sau)}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            {nhan}
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <textarea
          id="el-soan"
          value={noiDung}
          onChange={(e) => setNoiDung(e.target.value)}
          aria-label="Nội dung bài, định dạng Markdown"
          className="min-h-[28rem] w-full rounded-lg border border-border p-3 font-mono text-sm"
        />
        <div className="min-h-[28rem] overflow-auto rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Xem trước — đúng cách người học sẽ thấy
          </p>
          {/* Hạ `#` y hệt trang học: không hạ thì ở đây thấy tiêu đề, còn trang
              học nuốt mất, và người soạn không hiểu vì sao. */}
          <MarkdownRenderer content={demoteH1(noiDung)} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Ngưỡng đọc của bài này: <strong>{nguong} giây</strong> — người học phải ở
          lại ít nhất chừng đó và xem tới 90% bài thì mới tính là hoàn thành.
        </p>
        <button
          type="button"
          onClick={luu}
          disabled={dangLuu || !title.trim() || !noiDung.trim()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {dangLuu ? "Đang lưu…" : "Lưu bài"}
        </button>
      </div>
    </div>
  );
}
