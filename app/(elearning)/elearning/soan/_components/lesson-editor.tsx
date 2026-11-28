"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bold, Code, Heading2, History, Italic, Link2, List, Quote } from "lucide-react";
import { MarkdownRenderer } from "@/components/blog/markdown-renderer";
import { computeMinReadSeconds, demoteH1 } from "@/lib/elearning/reading";
import { chuThoiLuongDoc } from "@/lib/elearning/mo-ta-bai";
import { luuBaiDocAction } from "../_actions";
import { NUT_CHINH, O_NHAP } from "../../_components/ui/dieu-khien";
import { BaoTruocTachBan } from "./bao-truoc-tach-ban";

/**
 * EL-04 / QtSoanDoc — TRÌNH SOẠN BÀI ĐỌC, dựng theo `QtSoanDoc.html`: đầu trang (đường về · tên bài · nút Lưu bài), rồi hai khối "Soạn" (bản nháp trên máy · tên bài ·
 * thanh định dạng · Markdown · ngưỡng đọc) và "Xem trước — đúng cách người học sẽ thấy".
 *
 * ⚠️ Khung xem trước dùng ĐÚNG `MarkdownRenderer` và ĐÚNG `demoteH1` mà trang học
 * dùng. Hai bộ render khác nhau là cách chắc chắn nhất để người soạn thấy một
 * đằng còn người học thấy một nẻo — và họ chỉ phát hiện sau khi bài đã phát ra.
 *
 * ⚠️ `dauTrang` là khối đầu trang do SERVER dựng (đường về + tiêu đề): nút Lưu bài nằm cạnh nó nên trình soạn phải tự xếp hàng đầu.
 * `seTachBan` BẮT BUỘC (luật 7): quên truyền là mất dòng "Lưu sẽ tạo bản nháp mới" mà không lỗi nào báo.
 */

const KHOA_NHAP = "el:soan-bai:";

const NUT_CONG_CU =
  "inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

export function LessonEditor(props: {
  lessonId: string;
  titleBanDau: string;
  contentBanDau: string;
  seTachBan: boolean;
  dauTrang: React.ReactNode;
}) {
  const router = useRouter();
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
        if (r.data.daTachBan) {
          // B-11 — bài đã nằm trong bản đã xuất bản: bản vừa lưu là BẢN TÁCH của bản nháp; chuyển sang đúng bài đó (id cũ vẫn là bài đang được người học đọc).
          toast.success("Đã lưu vào bản nháp mới — bản đang phát hành giữ nguyên");
          router.replace(`/elearning/soan/${r.data.lessonId}`);
        } else {
          toast.success("Đã lưu bài");
        }
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-72">{props.dauTrang}</div>
        <button
          type="button"
          onClick={luu}
          disabled={dangLuu || !title.trim() || !noiDung.trim()}
          className={`${NUT_CHINH} mt-1 shrink-0`}
        >
          {dangLuu ? "Đang lưu…" : "Lưu bài"}
        </button>
      </div>

      <BaoTruocTachBan seTachBan={props.seTachBan} />

      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
        <section aria-label="Soạn" className="min-w-0 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Soạn</h2>

          {coBanNhap && (
            <div role="status" className="space-y-2 rounded-xl bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
              <p className="flex items-center gap-2 font-medium">
                <History className="h-4 w-4 shrink-0" aria-hidden />
                Có bản nháp chưa lưu trên máy này
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-8 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
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
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-8 items-center rounded-lg px-3 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
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
            </div>
          )}

          <div>
            <label htmlFor="el-ten-bai-doc" className="mb-1 block text-[13px] font-medium text-[color:var(--el-text2)]">
              Tên bài
            </label>
            <input
              id="el-ten-bai-doc"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tên bài"
              aria-label="Tên bài"
              className={O_NHAP}
            />
          </div>

          <div className="flex flex-wrap gap-0.5" role="toolbar" aria-label="Định dạng Markdown">
            {(
              [
                ["Đậm", "**", "**", Bold],
                ["Nghiêng", "_", "_", Italic],
                ["Tiêu đề", "## ", "", Heading2],
                ["Danh sách", "- ", "", List],
                ["Trích dẫn", "> ", "", Quote],
                ["Mã", "`", "`", Code],
                ["Liên kết", "[", "](https://)", Link2],
              ] as const
            ).map(([nhan, truoc, sau, BieuTuong]) => (
              <button key={nhan} type="button" onClick={() => chen(truoc, sau)} aria-label={nhan} title={nhan} className={NUT_CONG_CU}>
                <BieuTuong className="h-4 w-4" aria-hidden />
              </button>
            ))}
          </div>

          <div>
            <label htmlFor="el-soan" className="mb-1 block text-[13px] font-medium text-[color:var(--el-text2)]">
              Nội dung, định dạng Markdown
            </label>
            <textarea
              id="el-soan"
              value={noiDung}
              onChange={(e) => setNoiDung(e.target.value)}
              aria-label="Nội dung bài, định dạng Markdown"
              className="min-h-[24rem] w-full rounded-lg border border-input bg-card p-3 font-mono text-sm outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-2 text-[13px] text-muted-foreground">
              Ngưỡng đọc của bài này: <strong className="font-semibold text-foreground">{chuThoiLuongDoc(nguong)}</strong> — người học phải ở lại ít nhất chừng đó và xem tới
              90% bài thì mới tính là hoàn thành.
            </p>
          </div>
        </section>

        <section aria-label="Xem trước" className="min-w-0 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Xem trước — đúng cách người học sẽ thấy</h2>
          <div className="min-h-[24rem] overflow-auto rounded-xl border border-border bg-card p-5">
            {/* Hạ `#` y hệt trang học: không hạ thì ở đây thấy tiêu đề, còn trang
                học nuốt mất, và người soạn không hiểu vì sao. */}
            <MarkdownRenderer content={demoteH1(noiDung)} />
          </div>
        </section>
      </div>
    </div>
  );
}
