"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loaiBaiChoTrinhSoan, NHAN_LOAI_BAI } from "@/lib/elearning/lesson-kind";
import Link from "next/link";
import { toast } from "sonner";
import {
  taoChuongAction,
  taoBaiAction,
  sapThuTuAction,
  datBatBuocAction,
  datTuanTuAction,
  vongDoiKhoaAction,
  nhanBanKhoaAction,
} from "../../chuong-trinh/_actions";

/**
 * EL-08 — TRÌNH SOẠN DÀN BÀI KHOÁ.
 *
 * ⚠️ Kéo thả dùng HTML5 drag-and-drop có sẵn của trình duyệt, KHÔNG thêm thư viện
 * mới (luật repo: không tự thêm thư viện UI). Đổi lại phải có nút Lên/Xuống bên
 * cạnh: kéo thả không dùng được bằng bàn phím, và trên màn cảm ứng nó hay trượt.
 *
 * ⚠️ Danh sách lỗi dàn bài hiện NGAY trên đầu, không đợi bấm Gửi duyệt.
 */

type Bai = {
  id: string;
  title: string;
  kind: string;
  contentMd: string | null;
  required: boolean;
  /** Cột nối của bài `QUIZ` / `TASK` — dùng để hiện nhãn "chưa gắn" tại chỗ. */
  examId?: string | null;
  rubricId?: string | null;
};
type Chuong = { id: string; title: string; lessons: Bai[] };

/**
 * ⚠️ Đọc từ nguồn chung, KHÔNG chép tay danh sách ở đây.
 *
 * Bản chép tay cũ có đủ 6 loại, trong đó 3 loại không có đường đi nào — người soạn
 * tạo được, khoá xuất bản được, và người học mở ra thì nhận "chưa mở".
 */
const LOAI_BAI = loaiBaiChoTrinhSoan();

const NHAN_TRANG_THAI: Record<string, string> = {
  DRAFT: "Nháp",
  PENDING_REVIEW: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  PUBLISHED: "Đã xuất bản",
  ARCHIVED: "Đã lưu trữ",
};

export function OutlineEditor(props: {
  courseId: string;
  sequential: boolean;
  trangThaiKhoa: string;
  chuong: Chuong[];
  loiDanBai: { code: string; chiTiet: string }[];
  phienBan: { nhan: string; status: string }[];
}) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [tenChuong, setTenChuong] = useState("");
  const [keo, setKeo] = useState<{ loai: "CHUONG" | "BAI"; id: string } | null>(null);
  const [lyDo, setLyDo] = useState("");

  const lam = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    chuyen(async () => {
      const r = await fn();
      if (r.ok) router.refresh();
      else toast.error(r.error?.message ?? "Không thực hiện được");
    });

  const sap = (loai: "CHUONG" | "BAI", parentId: string, id: string, viTriMoi: number) =>
    lam(() => sapThuTuAction({ loai, parentId, id, viTriMoi }));

  const banNhapHienCo = props.phienBan.find((v) => v.status === "DRAFT");
  const banChoDuyet = props.phienBan.find((v) => v.status === "PENDING_REVIEW");
  const banDaDuyet = props.phienBan.find((v) => v.status === "APPROVED");
  const banDaPhat = props.phienBan.find((v) => v.status === "PUBLISHED");

  return (
    <div className="mt-4 space-y-4">
      {/* Lỗi dàn bài — hiện NGAY, không đợi bấm Gửi duyệt */}
      {props.loiDanBai.length > 0 && (
        <div className="rounded-lg border border-state-warning-soft bg-state-warning-soft/30 p-3">
          <p className="text-sm font-medium">
            Còn {props.loiDanBai.length} việc phải làm trước khi gửi duyệt
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {props.loiDanBai.map((l, i) => (
              <li key={`${l.code}-${i}`}>{l.chiTiet}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={props.sequential}
            disabled={dangChay}
            onChange={(e) =>
              lam(() =>
                datTuanTuAction({ courseId: props.courseId, sequential: e.target.checked }),
              )
            }
          />
          Học tuần tự (phải xong bài trước mới mở bài sau)
        </label>
        <span className="text-xs text-muted-foreground">
          Trạng thái khoá: {NHAN_TRANG_THAI[props.trangThaiKhoa] ?? props.trangThaiKhoa}
          {props.phienBan.length > 0 &&
            ` · ${props.phienBan.map((v) => `${v.nhan} ${NHAN_TRANG_THAI[v.status] ?? v.status}`).join(" · ")}`}
        </span>
      </div>

      {/* ── Dàn bài ─────────────────────────────────────────────────────── */}
      {props.chuong.map((c, iC) => (
        <section
          key={c.id}
          draggable
          onDragStart={() => setKeo({ loai: "CHUONG", id: c.id })}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (keo?.loai === "CHUONG" && keo.id !== c.id) {
              sap("CHUONG", props.courseId, keo.id, iC);
            }
            setKeo(null);
          }}
          className="rounded-xl border border-border p-3"
        >
          <header className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              <span className="mr-2 cursor-grab text-muted-foreground" aria-hidden>
                ⠿
              </span>
              {iC + 1}. {c.title}
            </h2>
            <div className="flex gap-1">
              {/* Kéo thả không dùng được bằng bàn phím — hai nút này là đường
                  chính cho người dùng bàn phím, không phải phương án dự phòng. */}
              <NutNho
                onClick={() => sap("CHUONG", props.courseId, c.id, iC - 1)}
                disabled={dangChay || iC === 0}
                nhan="Đưa chương lên trên"
              >
                ↑
              </NutNho>
              <NutNho
                onClick={() => sap("CHUONG", props.courseId, c.id, iC + 1)}
                disabled={dangChay || iC === props.chuong.length - 1}
                nhan="Đưa chương xuống dưới"
              >
                ↓
              </NutNho>
            </div>
          </header>

          <ul className="mt-2 space-y-1">
            {c.lessons.map((b, iB) => (
              <li
                key={b.id}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  setKeo({ loai: "BAI", id: b.id });
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.stopPropagation();
                  if (keo?.loai === "BAI" && keo.id !== b.id) {
                    sap("BAI", c.id, keo.id, iB);
                  }
                  setKeo(null);
                }}
                className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1 text-sm"
              >
                <span className="cursor-grab text-muted-foreground" aria-hidden>
                  ⠿
                </span>
                <span className="flex-1">{b.title}</span>
                <span className="text-xs text-muted-foreground">
                  {/* Bài loại đã ĐÓNG (tạo từ trước khi khoá lựa chọn) vẫn phải hiện nhãn
                      đúng — hiện mã thô là để người soạn không nhận ra bài của mình. */}
                  {NHAN_LOAI_BAI[b.kind] ?? b.kind}
                </span>
                {b.kind === "READ" && !b.contentMd?.trim() && (
                  <span className="rounded bg-state-warning-soft px-1.5 py-0.5 text-xs">
                    chưa có nội dung
                  </span>
                )}
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={b.required}
                    disabled={dangChay}
                    onChange={(e) =>
                      lam(() =>
                        datBatBuocAction({
                          courseId: props.courseId,
                          lessonId: b.id,
                          required: e.target.checked,
                        }),
                      )
                    }
                  />
                  bắt buộc
                </label>
                {/* ⚠️ Lối vào trình soạn phải mở cho MỌI loại bài có gì để soạn, không
                    riêng bài đọc. Bài `QUIZ` cần gắn đề, bài `TASK` cần gắn khung
                    chấm — và cổng xuất bản CHẶN khi thiếu. Chỉ mở cho `READ` nghĩa
                    là người soạn thấy "chưa gắn khung" mà không có nút nào để bấm:
                    đúng bẫy quy ước 20, chỉ đổi người bị kẹt. */}
                {(b.kind === "READ" || b.kind === "QUIZ" || b.kind === "TASK") && (
                  <Link href={`/elearning/soan/${b.id}`} className="text-xs underline">
                    {b.kind === "QUIZ"
                      ? "Gắn đề thi"
                      : b.kind === "TASK"
                        ? "Gắn khung chấm"
                        : "Soạn nội dung"}
                  </Link>
                )}
                {b.kind === "TASK" && !b.rubricId && (
                  <span className="rounded bg-state-warning-soft px-1.5 py-0.5 text-xs">
                    chưa gắn khung
                  </span>
                )}
                {b.kind === "QUIZ" && !b.examId && (
                  <span className="rounded bg-state-warning-soft px-1.5 py-0.5 text-xs">
                    chưa gắn đề
                  </span>
                )}
                <NutNho
                  onClick={() => sap("BAI", c.id, b.id, iB - 1)}
                  disabled={dangChay || iB === 0}
                  nhan="Đưa bài lên trên"
                >
                  ↑
                </NutNho>
                <NutNho
                  onClick={() => sap("BAI", c.id, b.id, iB + 1)}
                  disabled={dangChay || iB === c.lessons.length - 1}
                  nhan="Đưa bài xuống dưới"
                >
                  ↓
                </NutNho>
              </li>
            ))}
            {c.lessons.length === 0 && (
              <li className="px-2 py-1 text-xs text-muted-foreground">
                Chương này chưa có bài nào.
              </li>
            )}
          </ul>

          <ThemBai moduleId={c.id} dangChay={dangChay} lam={lam} />
        </section>
      ))}

      {/* ── Thêm chương ─────────────────────────────────────────────────── */}
      <div className="flex gap-2">
        <input
          value={tenChuong}
          onChange={(e) => setTenChuong(e.target.value)}
          placeholder="Tên chương mới"
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={dangChay || !tenChuong.trim()}
          onClick={() =>
            lam(async () => {
              const r = await taoChuongAction({
                courseId: props.courseId,
                title: tenChuong.trim(),
              });
              if (r.ok) setTenChuong("");
              return r;
            })
          }
          className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
        >
          + Thêm chương
        </button>
      </div>

      {/* ── Vòng đời ────────────────────────────────────────────────────── */}
      <section className="space-y-2 rounded-xl border border-border p-3">
        <h2 className="text-sm font-semibold">Xuất bản</h2>
        <input
          value={lyDo}
          onChange={(e) => setLyDo(e.target.value)}
          placeholder="Ghi chú thay đổi (bắt buộc)"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <NutVongDoi
            hien={Boolean(banNhapHienCo)}
            nhan="Gửi duyệt"
            disabled={dangChay || !lyDo.trim() || props.loiDanBai.length > 0}
            onClick={() => lam(() => goi("GUI_DUYET"))}
          />
          <NutVongDoi
            hien={Boolean(banChoDuyet)}
            nhan="Duyệt"
            disabled={dangChay || !lyDo.trim()}
            onClick={() => lam(() => goi("DUYET"))}
          />
          <NutVongDoi
            hien={Boolean(banChoDuyet || banDaDuyet)}
            nhan="Trả lại nháp"
            disabled={dangChay || !lyDo.trim()}
            onClick={() => lam(() => goi("TRA_LAI"))}
          />
          <NutVongDoi
            hien={Boolean(banDaDuyet)}
            nhan="Xuất bản"
            disabled={dangChay || !lyDo.trim()}
            onClick={() => lam(() => goi("XUAT_BAN"))}
          />
          <NutVongDoi
            hien={Boolean(banDaPhat)}
            nhan="Lưu trữ"
            disabled={dangChay || !lyDo.trim()}
            onClick={() => lam(() => goi("LUU_TRU"))}
          />
          <button
            type="button"
            disabled={dangChay}
            onClick={() =>
              lam(async () => {
                const r = await nhanBanKhoaAction({ courseId: props.courseId });
                if (r.ok) {
                  const d = r.data as { courseId: string };
                  window.location.href = `/elearning/soan-khoa/${d.courseId}`;
                }
                return r;
              })
            }
            className="rounded-lg border border-border px-3 py-1.5 text-sm"
          >
            Nhân bản khoá
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Bản đã xuất bản không kéo về nháp được — muốn sửa thì tạo bản nháp mới.
        </p>
      </section>
    </div>
  );

  function goi(hanhDong: string) {
    return vongDoiKhoaAction(
      { courseId: props.courseId, hanhDong },
      { reason: lyDo.trim() },
    );
  }
}

function ThemBai(props: {
  moduleId: string;
  dangChay: boolean;
  lam: (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>("READ");

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Tên bài mới"
        className="flex-1 rounded border border-border px-2 py-1 text-sm"
      />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        className="rounded border border-border px-2 py-1 text-sm"
      >
        {LOAI_BAI.map(({ ma: v, nhan: n }) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={props.dangChay || !title.trim()}
        onClick={() =>
          props.lam(async () => {
            const r = await taoBaiAction({
              moduleId: props.moduleId,
              title: title.trim(),
              kind,
              required: true,
            });
            if (r.ok) setTitle("");
            return r;
          })
        }
        className="rounded border border-border px-2 py-1 text-sm disabled:opacity-50"
      >
        + Thêm bài
      </button>
    </div>
  );
}

function NutNho(props: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  nhan: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.nhan}
      title={props.nhan}
      className="rounded border border-border px-1.5 text-xs disabled:opacity-40"
    >
      {props.children}
    </button>
  );
}

function NutVongDoi(props: {
  hien: boolean;
  nhan: string;
  disabled: boolean;
  onClick: () => void;
}) {
  if (!props.hien) return null;
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50"
    >
      {props.nhan}
    </button>
  );
}
