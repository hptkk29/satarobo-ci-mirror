"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  laLoaiBaiDaMo,
  loaiBaiChoTrinhSoan,
  NHAN_LOAI_BAI,
  NHAN_LOI_VAO_SOAN,
} from "@/lib/elearning/lesson-kind";
import { moTaBaiTrongDanBai } from "@/lib/elearning/mo-ta-bai";
import { BUOC_VONG_DOI, buocVongDoiKhoa } from "@/lib/elearning/vong-doi-buoc";
import { ArrowDown, ArrowUp, Circle, CircleDot, ClipboardList, FileQuestion, FileText, GripVertical, SquarePlay, Users } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { TrangThaiBadge } from "../../_components/ui/trang-thai-badge";
import { NUT_CHINH, NUT_PHU, O_CHON_GOC, O_NHAP_GOC, O_NHAP_VAN_BAN } from "../../_components/ui/dieu-khien";
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
 * EL-08 / QtSoanKhoa — TRÌNH SOẠN DÀN BÀI KHOÁ, dựng theo `QtSoanKhoa.html`: cột trái là dàn bài (chương là tiêu đề, bài là dòng có số thứ tự · tay kéo · biểu tượng ·
 * tên + mô tả · chip · Lên/Xuống), cột phải dính là "Vòng đời khoá" + lỗi chặn + ghi chú + nút.
 *
 * ⚠️ Kéo thả dùng HTML5 drag-and-drop có sẵn của trình duyệt, KHÔNG thêm thư viện
 * mới (luật repo: không tự thêm thư viện UI). Đổi lại phải có nút Lên/Xuống bên
 * cạnh: kéo thả không dùng được bằng bàn phím, và trên màn cảm ứng nó hay trượt.
 *
 * ⚠️ Danh sách lỗi dàn bài hiện NGAY, không đợi bấm Gửi duyệt.
 *
 * ⚠️ KHÔNG vẽ nút "Xem như người học" của thiết kế: chưa có route xem trước (nút không có đích là lời hứa suông — luật 12). Ghi ở DECISIONS D-23.
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
  /** Số đo THẬT để vẽ dòng mô tả (xem `moTaBaiTrongDanBai`). */
  youtubeId?: string | null;
  videoKey?: string | null;
  durationSec?: number | null;
  minReadSeconds?: number | null;
};
type Chuong = { id: string; title: string; lessons: Bai[] };

/**
 * ⚠️ Đọc từ nguồn chung, KHÔNG chép tay danh sách ở đây.
 *
 * Bản chép tay cũ có đủ 6 loại, trong đó 3 loại không có đường đi nào — người soạn
 * tạo được, khoá xuất bản được, và người học mở ra thì nhận "chưa mở".
 */
const LOAI_BAI = loaiBaiChoTrinhSoan();

const BIEU_TUONG_LOAI: Record<string, typeof FileText> = {
  READ: FileText,
  VIDEO: SquarePlay,
  QUIZ: FileQuestion,
  TASK: ClipboardList,
  LIVE_SESSION: Users,
};

const NUT_VUONG =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30";

export function OutlineEditor(props: {
  courseId: string;
  sequential: boolean;
  trangThaiKhoa: string;
  chuong: Chuong[];
  loiDanBai: { code: string; chiTiet: string }[];
  phienBan: { nhan: string; status: string }[];
  /** Phần xếp THÊM ở cuối cột phải (vd "Công nhận tương đương" — server dựng, vì nó cần danh sách nhân sự). */
  canhPhai?: React.ReactNode;
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
  const buocHienTai = buocVongDoiKhoa(props.trangThaiKhoa, props.phienBan);
  let soThuTuBai = 0;

  return (
    <div className="mt-6 grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
      {/* ── Cột trái: dàn bài ─────────────────────────────────────────────── */}
      <div className="min-w-0 space-y-8">
        <label className="flex min-h-8 items-center gap-2.5 text-sm font-medium text-foreground">
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
          Học tuần tự — phải xong bài trước mới mở bài sau
        </label>

        {props.chuong.map((c, iC) => (
          <section
            key={c.id}
            aria-label={`Chương ${iC + 1}: ${c.title}`}
            draggable
            onDragStart={() => setKeo({ loai: "CHUONG", id: c.id })}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (keo?.loai === "CHUONG" && keo.id !== c.id) {
                sap("CHUONG", props.courseId, keo.id, iC);
              }
              setKeo(null);
            }}
          >
            <header className="flex items-center justify-between gap-2">
              <h2 className="min-w-0 cursor-grab text-lg font-semibold text-foreground">
                Chương {iC + 1} · {c.title}
              </h2>
              <div className="flex shrink-0 gap-0.5">
                {/* Kéo thả không dùng được bằng bàn phím — hai nút này là đường
                    chính cho người dùng bàn phím, không phải phương án dự phòng. */}
                <NutNho
                  onClick={() => sap("CHUONG", props.courseId, c.id, iC - 1)}
                  disabled={dangChay || iC === 0}
                  nhan="Đưa chương lên trên"
                >
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </NutNho>
                <NutNho
                  onClick={() => sap("CHUONG", props.courseId, c.id, iC + 1)}
                  disabled={dangChay || iC === props.chuong.length - 1}
                  nhan="Đưa chương xuống dưới"
                >
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </NutNho>
              </div>
            </header>

            <ul className="mt-3 border-b border-border">
              {c.lessons.map((b, iB) => {
                soThuTuBai += 1;
                const BieuTuong = BIEU_TUONG_LOAI[b.kind] ?? FileText;
                return (
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
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border py-3 text-sm"
                  >
                    <span className="w-4 shrink-0 text-xs text-muted-foreground" aria-hidden>
                      {soThuTuBai}
                    </span>
                    <span className="cursor-grab text-muted-foreground" aria-hidden>
                      <GripVertical className="h-4 w-4" />
                    </span>
                    <BieuTuong className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1 basis-44">
                      <p className="font-medium text-foreground">{b.title}</p>
                      <p className="text-[13px] text-muted-foreground">
                        {/* Bài loại đã ĐÓNG (tạo từ trước khi khoá lựa chọn) vẫn phải hiện nhãn
                            đúng — `moTaBaiTrongDanBai` giữ mã thô cho loại lạ thay vì giấu. */}
                        {moTaBaiTrongDanBai(b)}
                        {/* ⚠️ Lối vào trình soạn phải mở cho MỌI loại bài đã mở, không riêng
                            bài đọc. Bài `QUIZ` cần gắn đề, bài `TASK` cần gắn khung chấm —
                            và cổng xuất bản CHẶN khi thiếu; bài `VIDEO` cần tải tệp, bài
                            `LIVE_SESSION` cần điểm danh. Danh sách loại + chữ nút đọc từ
                            `lesson-kind.ts` (một nguồn): gõ cứng ba loại ở đây từng làm
                            Video và Buổi trực tiếp mất lối vào, người soạn không biết tải
                            video ở đâu. */}
                        {laLoaiBaiDaMo(b.kind) && (
                          <>
                            {" · "}
                            <Link
                              href={`/elearning/soan/${b.id}`}
                              className="inline-flex min-h-6 items-center rounded font-medium text-primary-ink underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {NHAN_LOI_VAO_SOAN[b.kind]}
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {b.kind === "READ" && !b.contentMd?.trim() && (
                        <TrangThaiBadge sac="warning">chưa có nội dung</TrangThaiBadge>
                      )}
                      {b.kind === "TASK" && !b.rubricId && <ChamDo>chưa gắn khung</ChamDo>}
                      {b.kind === "QUIZ" && !b.examId && <ChamDo>chưa gắn đề</ChamDo>}
                      {/* Chip "bắt buộc" CHÍNH LÀ ô bật/tắt: đặc (đang bắt buộc) hoặc nét đứt (tuỳ chọn). */}
                      <label
                        className={`inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                          b.required ? "bg-muted text-foreground" : "border border-dashed border-border text-muted-foreground"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
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
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      <NutNho
                        onClick={() => sap("BAI", c.id, b.id, iB - 1)}
                        disabled={dangChay || iB === 0}
                        nhan="Đưa bài lên trên"
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </NutNho>
                      <NutNho
                        onClick={() => sap("BAI", c.id, b.id, iB + 1)}
                        disabled={dangChay || iB === c.lessons.length - 1}
                        nhan="Đưa bài xuống dưới"
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </NutNho>
                    </div>
                  </li>
                );
              })}
              {c.lessons.length === 0 && (
                <li className="border-t border-border py-3 text-sm text-muted-foreground">
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
      </div>

      {/* ── Cột phải (dính): vòng đời + lỗi chặn + ghi chú + nút ─────────── */}
      <aside aria-label="Vòng đời khoá" className="min-w-0 space-y-6 lg:sticky lg:top-20">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Vòng đời khoá</h2>
          <ol className="space-y-1.5 text-sm">
            {BUOC_VONG_DOI.map((b) => {
              const hienTai = b.ma === buocHienTai;
              const Dau = hienTai ? CircleDot : Circle;
              return (
                <li key={b.ma} aria-current={hienTai ? "step" : undefined} className={`flex items-center gap-2 ${hienTai ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                  <Dau className={`h-4 w-4 shrink-0 ${hienTai ? "text-primary" : ""}`} aria-hidden />
                  <span>
                    {b.nhan}
                    {b.moTa ? ` — ${b.moTa}` : hienTai ? " — đang ở đây" : ""}
                  </span>
                </li>
              );
            })}
          </ol>
          {props.phienBan.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {props.phienBan.map((v) => `${v.nhan} ${NHAN_TRANG_THAI[v.status] ?? v.status}`).join(" · ")}
            </p>
          ) : null}
        </section>

        {/* Lỗi dàn bài — hiện NGAY, không đợi bấm Gửi duyệt */}
        {props.loiDanBai.length > 0 && (
          <div role="status" className="rounded-xl bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
            <p className="font-medium">
              Còn {props.loiDanBai.length} lỗi chặn gửi duyệt
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {props.loiDanBai.map((l, i) => (
                <li key={`${l.code}-${i}`}>{l.chiTiet}</li>
              ))}
            </ul>
          </div>
        )}

        <section className="space-y-3">
          <label className="block text-[13px] font-medium text-[color:var(--el-text2)]" htmlFor="el-ghi-chu-doi">
            Ghi chú thay đổi (bắt buộc)
          </label>
          <textarea
            id="el-ghi-chu-doi"
            value={lyDo}
            onChange={(e) => setLyDo(e.target.value)}
            placeholder="Bản này thêm gì, sửa gì"
            aria-label="Ghi chú thay đổi (bắt buộc)"
            className={O_NHAP_VAN_BAN}
          />
          <div className="flex flex-wrap gap-2">
            <NutVongDoi
              hien={Boolean(banNhapHienCo)}
              nhan="Gửi duyệt"
              rong
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
          </div>
          <div className="flex flex-wrap items-center gap-1">
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
              className={NUT_CHU}
            >
              Nhân bản khoá
            </button>
            {banDaPhat ? (
              <button type="button" disabled={dangChay || !lyDo.trim()} onClick={() => lam(() => goi("LUU_TRU"))} className={NUT_CHU}>
                Lưu trữ
              </button>
            ) : null}
          </div>
          <p className="text-[13px] text-muted-foreground">
            Bản đã xuất bản không kéo về nháp được: lưu thay đổi sẽ tạo bản nháp mới, người đang học vẫn đọc bản cũ.
          </p>
          {banChoDuyet || banDaDuyet ? (
            <p className="text-sm">
              <Link href={`/elearning/soan-khoa/${props.courseId}/duyet`} className="font-medium text-primary-ink underline-offset-2 hover:underline">
                Mở màn duyệt (so với bản đang phát hành)
              </Link>
            </p>
          ) : null}
        </section>

        {props.canhPhai}
      </aside>
    </div>
  );

  function goi(hanhDong: string) {
    return vongDoiKhoaAction(
      { courseId: props.courseId, hanhDong },
      { reason: lyDo.trim() },
    );
  }
}

const NHAN_TRANG_THAI: Record<string, string> = {
  DRAFT: "Nháp",
  PENDING_REVIEW: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  PUBLISHED: "Đã xuất bản",
  ARCHIVED: "Đã lưu trữ",
};

const NUT_CHU =
  "inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

/** Chấm đỏ + chữ: "chưa gắn khung" / "chưa gắn đề" — lỗi chặn gửi duyệt ngay trên dòng. */
function ChamDo(props: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-state-danger-ink">
      <span className="h-1.5 w-1.5 rounded-full bg-state-danger" aria-hidden />
      {props.children}
    </span>
  );
}

function ThemBai(props: {
  moduleId: string;
  dangChay: boolean;
  lam: (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>("READ");

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-border p-4">
      <div className="min-w-0 flex-1 basis-48">
        <label htmlFor={`el-ten-bai-${props.moduleId}`} className="mb-1 block text-[13px] font-medium text-[color:var(--el-text2)]">
          Tên bài mới
        </label>
        <input
          id={`el-ten-bai-${props.moduleId}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ví dụ: Đọc giá trị khoảng cách"
          aria-label="Tên bài mới"
          className={`${O_NHAP_GOC} w-full`}
        />
      </div>
      <div>
        <label htmlFor={`el-loai-bai-${props.moduleId}`} className="mb-1 block text-[13px] font-medium text-[color:var(--el-text2)]">
          Loại bài
        </label>
        <select
          id={`el-loai-bai-${props.moduleId}`}
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
      </div>
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
      className={NUT_VUONG}
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
  rong?: boolean;
}) {
  if (!props.hien) return null;
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={`${props.nhan === "Xuất bản" || props.nhan === "Gửi duyệt" ? NUT_CHINH : NUT_PHU}${props.rong ? " w-full" : ""}`}
    >
      {props.nhan}
    </button>
  );
}
