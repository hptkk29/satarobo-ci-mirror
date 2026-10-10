// Dải ĐẦU hồ sơ học viên (25/09/2026) — "đây là ai, con nhà ai, đến từ đâu".
//
// Nỗi đau số 1 của chủ dự án: "không biết học viên này con ai, từ lead nào". Nên LEAD
// NGUỒN là một phần của DANH TÍNH, nằm ngay dưới tên — thấy được mà không phải cuộn.
//
// Bố cục theo bề ngang CHÍNH DẢI (`@container`), không theo cửa sổ (thanh bên admin ăn
// ~260px nên `lg:` nói dối về chỗ thật):
//   · hẹp  — [ảnh | tên + meta] / [dải nguồn] / [nút vòng đời] xếp dọc;
//   · ≥768px (@3xl) — [ảnh | tên + meta + dải nguồn | nút vòng đời] một hàng.

import Link from "next/link";
import { ArrowUpRight, CirclePause, Lock } from "lucide-react";
import type { EnrollmentStatus } from "@prisma/client";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { ngayVN } from "@/lib/format/date";
import type { LeadNguonKetQua } from "@/lib/students/lead-nguon-types";
import { LifecycleActions } from "../lifecycle-actions";
import { AnhDaiDienHoSo } from "./anh-dai-dien";
import { NutMoChonLead } from "./chon-lead";
import { nhanTinhTrangHoSo, type TrangThaiHocVien } from "./nhan-ho-so";
import { NUT_CHU } from "./o-nhap";

type BaoLuu = { id: string; startedAt: Date; reason: string; expectedEndAt: Date | null };

function DaiNguon({
  ketQua,
  studentId,
  tenHocVien,
}: {
  ketQua: LeadNguonKetQua;
  studentId: string;
  tenHocVien: string;
}) {
  const vo =
    "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-sm";

  if (ketQua.kind === "CO_LEAD") {
    const { lead } = ketQua;
    const sale = lead.salePhuTrach ? `Sale ${lead.salePhuTrach}` : "Chưa giao sale";
    return (
      <div className={vo}>
        <span className="text-muted-foreground">Từ lead:</span>
        <Link
          href={lead.href}
          aria-label={`Từ lead: ${lead.tenPhuHuynh} · ${lead.trangThai} · ${sale} — mở phiếu lead`}
          className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 rounded-sm font-medium text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="break-words font-semibold">{lead.tenPhuHuynh}</span>
          <span aria-hidden className="text-muted-foreground">·</span>
          <span className="whitespace-nowrap">{lead.trangThai}</span>
          <span aria-hidden className="text-muted-foreground">·</span>
          <span className="break-words">{sale}</span>
          <ArrowUpRight className="size-4 shrink-0" aria-hidden />
        </Link>
      </div>
    );
  }

  if (ketQua.kind === "KHONG_DUOC_XEM") {
    return (
      <div className={vo}>
        <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-muted-foreground">
          Có lead nguồn — thuộc {ketQua.lyDo === "SALE_KHAC" ? "Sale khác" : "cơ sở khác"}, bạn
          không có quyền xem.
        </span>
      </div>
    );
  }

  return (
    <div className={vo}>
      <span className="text-muted-foreground">
        Chưa nối lead
        {ketQua.goiY.length > 0 && ` · ${ketQua.goiY.length} phiếu gợi ý`}
      </span>
      {ketQua.coTheGan && (
        <NutMoChonLead
          studentId={studentId}
          tenHocVien={tenHocVien}
          goiY={ketQua.goiY}
          nhan="Gắn lead"
          className={`${NUT_CHU} border border-border bg-card text-foreground hover:bg-muted`}
        />
      )}
    </div>
  );
}

export function DaiDanhTinh({
  student,
  meta,
  ketQua,
  activeReserve,
  lifecycleEnrollments,
}: {
  student: {
    id: string;
    name: string;
    avatarUrl: string | null;
    status: TrangThaiHocVien;
  };
  /** Các mẩu dòng phụ đã định dạng (mã HV · tuổi · giới tính · cơ sở) — mẩu rỗng bị bỏ. */
  meta: (string | null)[];
  ketQua: LeadNguonKetQua;
  activeReserve: BaoLuu | null;
  lifecycleEnrollments: { id: string; status: EnrollmentStatus; class: { name: string } }[];
}) {
  // Cùng nhãn với cột trạng thái ở /students (09/10/2026) — xem `nhanTinhTrangHoSo`.
  const trangThai = nhanTinhTrangHoSo(
    student.status,
    lifecycleEnrollments.map((e) => e.status),
  );
  const dongPhu = meta.filter((m): m is string => !!m && m.trim() !== "");

  return (
    <section
      aria-labelledby="ho-so-ten"
      className="@container rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 @3xl:grid-cols-[auto_minmax(0,1fr)_auto]">
        <div className="@3xl:row-span-2">
          <AnhDaiDienHoSo studentId={student.id} ten={student.name} url={student.avatarUrl} />
        </div>

        <div className="min-w-0 space-y-1 self-center @3xl:col-start-2 @3xl:row-start-1 @3xl:self-start">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1
              id="ho-so-ten"
              className="min-w-0 break-words text-xl font-bold leading-tight text-foreground sm:text-2xl"
            >
              {student.name}
            </h1>
            <StatusPill tone={trangThai.tone}>{trangThai.nhan}</StatusPill>
          </div>
          {dongPhu.length > 0 && (
            <p className="break-words text-sm text-muted-foreground">
              {dongPhu.map((m, i) => (
                <span key={i}>
                  {i > 0 && <span aria-hidden> · </span>}
                  <span className="tabular-nums">{m}</span>
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="col-span-2 min-w-0 @3xl:col-span-1 @3xl:col-start-2 @3xl:row-start-2">
          <DaiNguon ketQua={ketQua} studentId={student.id} tenHocVien={student.name} />
        </div>

        <div className="col-span-2 @3xl:col-span-1 @3xl:col-start-3 @3xl:row-span-2 @3xl:row-start-1 @3xl:justify-self-end">
          <LifecycleActions
            studentId={student.id}
            studentName={student.name}
            studentStatus={student.status}
            activeReserve={activeReserve}
            enrollments={lifecycleEnrollments}
          />
        </div>
      </div>
    </section>
  );
}

/** Dải mỏng dưới dải đầu khi học viên ĐANG bảo lưu (trước đây nằm trong thẻ Lifecycle). */
export function DaiDangBaoLuu({ baoLuu }: { baoLuu: BaoLuu }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl border border-state-warning-soft bg-state-warning-soft px-4 py-2.5 text-sm text-state-warning-ink"
    >
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <CirclePause className="size-4 shrink-0" aria-hidden />
        Đang bảo lưu
      </span>
      <span className="tabular-nums">
        từ {ngayVN(baoLuu.startedAt)}
        {baoLuu.expectedEndAt && ` → dự kiến trở lại ${ngayVN(baoLuu.expectedEndAt)}`}
      </span>
      <span className="min-w-0 break-words">· Lý do: {baoLuu.reason}</span>
    </div>
  );
}
