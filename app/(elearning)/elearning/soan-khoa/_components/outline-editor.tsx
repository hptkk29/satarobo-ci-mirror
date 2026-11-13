"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  laLoaiBaiDaMo,
  loaiBaiChoTrinhSoan,
  NHAN_LOAI_BAI,
  NHAN_LOI_VAO_SOAN,
} from "@/lib/elearning/lesson-kind";
import Link from "next/link";
import { toast } from "sonner";
import { TrangThaiBadge } from "../../_components/ui/trang-thai-badge";
import { GhiChu } from "../../_components/ui/trang";
import { NUT_CHINH, NUT_PHU, O_CHON_GOC, O_NHAP, O_NHAP_GOC } from "../../_components/ui/dieu-khien";
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
        <GhiChu
          sac="warning"
          tieuDe={<>Còn {props.loiDanBai.length} việc phải làm trước khi gửi duyệt</>}
        >
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {props.loiDanBai.map((l, i) => (
              <li key={`${l.code}-${i}`}>{l.chiTiet}</li>
            ))}
          </ul>
        </GhiChu>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-3">
        <label className="flex min-h-8 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
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
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Trạng thái khoá:
          <TrangThaiBadge sac={props.trangThaiKhoa === "PUBLISHED" ? "success" : props.trangThaiKhoa === "DRAFT" ? "muted" : "info"}>
            {NHAN_TRANG_THAI[props.trangThaiKhoa] ?? props.trangThaiKhoa}
          </TrangThaiBadge>
          {props.phienBan.length > 0 &&
            `${props.phienBan.map((v) => `${v.nhan} ${NHAN_TRANG_THAI[v.status] ?? v.status}`).join(" · ")}`}
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
          className="rounded-xl border border-border bg-card p-4"
        >
          <header className="flex items-center justify-between gap-2">
            <h2 className="min-w-0 text-base font-semibold text-foreground">
              <span className="mr-2 cursor-grab text-muted-foreground" aria-hidden>
                ⠿
              </span>
              {iC + 1}. {c.title}
            </h2>
            <div className="flex shrink-0 gap-1">
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

          <ul className="mt-3 space-y-1.5">
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
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <span className="cursor-grab text-muted-foreground" aria-hidden>
                  ⠿
                </span>
                <span className="min-w-0 flex-1 basis-40 font-medium">{b.title}</span>
                <span className="text-xs text-muted-foreground">
                  {/* Bài loại đã ĐÓNG (tạo từ trước khi khoá lựa chọn) vẫn phải hiện nhãn
                      đúng — hiện mã thô là để người soạn không nhận ra bài của mình. */}
                  {NHAN_LOAI_BAI[b.kind] ?? b.kind}
                </span>
                {b.kind === "READ" && !b.contentMd?.trim() && (
                  <TrangThaiBadge sac="warning">chưa có nội dung</TrangThaiBadge>
                )}
                <label className="flex min-h-8 items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
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
                {/* ⚠️ Lối vào trình soạn phải mở cho MỌI loại bài đã mở, không riêng
                    bài đọc. Bài `QUIZ` cần gắn đề, bài `TASK` cần gắn khung chấm —
                    và cổng xuất bản CHẶN khi thiếu; bài `VIDEO` cần tải tệp, bài
                    `LIVE_SESSION` cần điểm danh. Danh sách loại + chữ nút đọc từ
                    `lesson-kind.ts` (một nguồn): gõ cứng ba loại ở đây từng làm
                    Video và Buổi trực tiếp mất lối vào, người soạn không biết tải
                    video ở đâu. */}
                {laLoaiBaiDaMo(b.kind) && (
                  <Link
                    href={`/elearning/soan/${b.id}`}
                    className="inline-flex min-h-8 items-center rounded text-xs font-medium text-primary-ink underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {NHAN_LOI_VAO_SOAN[b.kind]}
                  </Link>
                )}
                {b.kind === "TASK" && !b.rubricId && (
                  <TrangThaiBadge sac="warning">chưa gắn khung</TrangThaiBadge>
                )}
                {b.kind === "QUIZ" && !b.examId && (
                  <TrangThaiBadge sac="warning">chưa gắn đề</TrangThaiBadge>
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
              <li className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                Chương này chưa có bài nào. Thêm bài ở ô bên dưới.
              </li>
            )}
          </ul>

          <ThemBai moduleId={c.id} dangChay={dangChay} lam={lam} />
        </section>
      ))}

      {/* ── Thêm chương ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <input
          value={tenChuong}
          onChange={(e) => setTenChuong(e.target.value)}
          placeholder="Tên chương mới"
          aria-label="Tên chương mới"
          className={`${O_NHAP_GOC} flex-1 basis-56`}
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
          className={NUT_PHU}
        >
          + Thêm chương
        </button>
      </div>

      {/* ── Vòng đời ────────────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">Xuất bản</h2>
        <input
          value={lyDo}
          onChange={(e) => setLyDo(e.target.value)}
          placeholder="Ghi chú thay đổi (bắt buộc)"
          aria-label="Ghi chú thay đổi (bắt buộc)"
          className={O_NHAP}
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
            className={NUT_PHU}
          >
            Nhân bản khoá
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
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
    <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Tên bài mới"
        aria-label="Tên bài mới"
        className={`${O_NHAP_GOC} flex-1 basis-48`}
      />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        aria-label="Loại bài"
        className={`${O_CHON_GOC} w-auto`}
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
        className={NUT_PHU}
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
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
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
      className={props.nhan === "Xuất bản" ? NUT_CHINH : NUT_PHU}
    >
      {props.nhan}
    </button>
  );
}
