// Khối "Lớp & tiến độ" của hồ sơ học viên (25/09/2026, chủ dự án chốt D3) — GỘP hai khối
// cũ "Tiến độ học tập" + "Lịch sử học tập" vốn kể cùng một chuyện hai lần (lớp đang học
// hiện ở cả hai, và trang gọi `getStudentClassProgress` HAI lần cho mỗi lớp đó).
//
// Chỉ HIỂN THỊ — mọi số đã tính ở trang (`[id]/edit/page.tsx`), khối này không truy vấn.
//   · lớp đang học: một dòng mỗi lớp — buổi x/y + thanh tiến độ (mang SỐ, không trang trí)
//     + 4 chỉ số + nút PDF;
//   · lịch sử ghi danh (đã xong / bảo lưu / chờ xếp…): bảng gọn, phân trang;
//   · buổi vắng: gấp lại trong <details> — cần mới mở.

import Link from "next/link";
import type { EnrollmentStatus } from "@prisma/client";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { ngayVN } from "@/lib/format/date";
import type { StudentAbsence } from "@/lib/students/progress";
import { cn } from "@/lib/utils";
import { GeneratePdfButton } from "../../[id]/edit/_pdf-button";
import {
  NHAN_GHI_DANH,
  NHAN_TRANG_THAI_HV,
  phanTramDaHoc,
  type TrangThaiHocVien,
} from "./nhan-ho-so";
import { NUT_VIEN } from "./o-nhap";

export type LopCuaDong = {
  id: string;
  ten: string;
  ma: string | null;
  khoa: string;
  coSo: string | null;
};

export type BuoiCuaDong = {
  total: number;
  attended: number;
  remaining: number;
  absentNoMakeup: number;
  currentSession: number;
};

export type DongLopDangHoc = {
  enrollmentId: string;
  lop: LopCuaDong;
  buoi: BuoiCuaDong;
  /** Chỉ số từ `getStudentProgressForClasses` — `null` khi không tính được. */
  chiSo: {
    diemDanh: string;
    tyLeDiemDanh: number;
    baiHoc: string;
    baiTap: string;
    diemTB: number | null;
  } | null;
};

export type DongLichSu = {
  enrollmentId: string;
  lop: LopCuaDong;
  status: EnrollmentStatus;
  batDau: Date;
  ketThuc: Date | null;
  buoi: Pick<BuoiCuaDong, "total" | "attended" | "absentNoMakeup">;
};

const TH = "whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const TD = "whitespace-nowrap px-4 py-3";

function ChiSo({ nhan, giaTri, phu }: { nhan: string; giaTri: string; phu?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{nhan}</dt>
      <dd className="text-sm font-semibold tabular-nums text-foreground">
        {giaTri}
        {phu && <span className="ml-1 text-xs font-normal text-muted-foreground">{phu}</span>}
      </dd>
    </div>
  );
}

function DongDangHoc({
  dong,
  studentId,
  tenHocVien,
}: {
  dong: DongLopDangHoc;
  studentId: string;
  tenHocVien: string;
}) {
  const { lop, buoi, chiSo } = dong;
  const pt = phanTramDaHoc(buoi.attended, buoi.total);
  const dongPhu = [lop.ma, lop.khoa, lop.coSo].filter(Boolean).join(" · ");
  return (
    <li className="space-y-3 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/classes/${lop.id}/progress`}
            className="break-words font-semibold text-foreground hover:text-primary-ink hover:underline"
          >
            {lop.ten}
          </Link>
          {dongPhu && <p className="break-words text-xs text-muted-foreground">{dongPhu}</p>}
        </div>
        <GeneratePdfButton
          studentId={studentId}
          classId={lop.id}
          studentName={tenHocVien}
          className={lop.ten}
        />
      </div>

      {/* Tiêu đề, thanh và nhãn đọc màn hình nói CÙNG MỘT số: buổi EM đã học trên tổng buổi.
          Bản đầu để tiêu đề "Buổi {vị trí của LỚP}/{tổng}" cạnh thanh đo buổi của EM ⇒ màn
          chụp thật in "Buổi 10/12" cạnh một thanh RỖNG ("đã học 0") — đọc như mâu thuẫn. Vị
          trí của lớp chuyển xuống dòng phụ, ghi rõ là của LỚP. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {buoi.total > 0 ? `Đã học ${buoi.attended}/${buoi.total} buổi` : `Đã học ${buoi.attended} buổi`}
        </span>
        {pt !== null ? (
          <div
            role="progressbar"
            aria-label={`Đã học ${buoi.attended} trên ${buoi.total} buổi`}
            aria-valuemin={0}
            aria-valuemax={buoi.total}
            aria-valuenow={Math.min(buoi.attended, buoi.total)}
            className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${pt}%` }} />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            Khoá chưa có giáo trình — chưa tính được tiến độ
          </span>
        )}
        <span className="text-xs tabular-nums text-muted-foreground">
          {buoi.total > 0 ? `Lớp đang ở buổi ${buoi.currentSession} · em còn ${buoi.remaining} buổi` : null}
          {buoi.absentNoMakeup > 0 && (
            <span className="text-state-danger-ink"> · vắng chưa bù {buoi.absentNoMakeup}</span>
          )}
        </span>
      </div>

      {chiSo && (
        <dl className="grid grid-cols-2 gap-3 @md:grid-cols-4">
          <ChiSo nhan="Điểm danh" giaTri={chiSo.diemDanh} phu={`${chiSo.tyLeDiemDanh}%`} />
          <ChiSo nhan="Bài học" giaTri={chiSo.baiHoc} />
          <ChiSo nhan="Bài tập" giaTri={chiSo.baiTap} />
          <ChiSo nhan="Điểm TB" giaTri={chiSo.diemTB !== null ? `${chiSo.diemTB}/10` : "—"} />
        </dl>
      )}
    </li>
  );
}

export function LopVaTienDo({
  studentId,
  tenHocVien,
  dangHoc,
  lichSu,
  buoiVang,
  coTheGhiDanh,
  trangThaiHocVien,
}: {
  studentId: string;
  tenHocVien: string;
  dangHoc: DongLopDangHoc[];
  lichSu: DongLichSu[];
  buoiVang: StudentAbsence[];
  /** Có `enrollments:create` không — nút "Ghi danh" chỉ hiện khi bấm vào là làm được. */
  coTheGhiDanh: boolean;
  /**
   * Trạng thái hồ sơ. Màn "Đăng ký học" (/enrollments/new) chỉ liệt kê học viên ĐANG HỌC,
   * nên nút ghi danh cho hồ sơ Bảo lưu/Hoàn thành/Nghỉ học dẫn tới một form KHÔNG chọn được
   * em này — lời hứa suông (luật 12). Chỉ hiện nút khi `ACTIVE`, còn lại nói rõ phải làm gì.
   */
  trangThaiHocVien: TrangThaiHocVien;
}) {
  const chuaCoLop = dangHoc.length === 0 && lichSu.length === 0;
  const ghiDanhDuoc = coTheGhiDanh && trangThaiHocVien === "ACTIVE";
  const canBu = buoiVang.filter((v) => v.makeupStatus === "NEEDS_MAKEUP").length;

  return (
    <section
      aria-labelledby="lop-tien-do"
      className="@container rounded-xl border border-border bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 id="lop-tien-do" className="text-sm font-semibold text-foreground">
          Lớp &amp; tiến độ
          {!chuaCoLop && (
            <span className="ml-1 font-normal text-muted-foreground">
              · {dangHoc.length} lớp đang học
            </span>
          )}
        </h2>
      </div>

      {chuaCoLop ? (
        <div className="space-y-3 px-4 py-6 text-sm">
          <p className="font-semibold text-foreground">Chưa ghi danh lớp nào</p>
          <p className="leading-relaxed text-muted-foreground">
            Học viên đã có hồ sơ nhưng chưa vào lớp, nên chưa có buổi học, điểm danh hay tiến độ.
            {ghiDanhDuoc
              ? " Ghi danh vào lớp để bắt đầu theo dõi."
              : coTheGhiDanh
                ? ` Hồ sơ đang ở trạng thái “${NHAN_TRANG_THAI_HV[trangThaiHocVien].nhan}” — màn Đăng ký học chỉ nhận học viên “Đang học”, nên đổi ô Trạng thái hồ sơ về “Đang học” và lưu trước khi ghi danh.`
                : " Ghi danh do quản lý cơ sở / giáo vụ làm ở màn Đăng ký học."}
          </p>
          {ghiDanhDuoc && (
            <Link href={`/enrollments/new?studentId=${studentId}`} className={NUT_VIEN}>
              Ghi danh vào lớp
            </Link>
          )}
        </div>
      ) : (
        <>
          {dangHoc.length > 0 ? (
            <ul className="divide-y divide-border">
              {dangHoc.map((d) => (
                <DongDangHoc key={d.enrollmentId} dong={d} studentId={studentId} tenHocVien={tenHocVien} />
              ))}
            </ul>
          ) : (
            // 09/10/2026 — trước đây nút ghi danh CHỈ hiện khi chưa từng có ghi danh nào: một
            // dòng lịch sử ("Đã huỷ" sau khi gỡ khỏi lớp) là mất nút, trong khi chính hệ thống
            // vừa báo "chờ xếp lớp lại" (prod, CS2-26-57AWRE). Không ngồi lớp nào ⇒ phải có lối
            // xếp lớp, có lịch sử hay không.
            <div className="space-y-3 px-4 py-3 text-sm">
              <p className="text-muted-foreground">
                Hiện không học lớp nào — các lớp đã qua ở bảng dưới.
              </p>
              {ghiDanhDuoc && (
                <Link href={`/enrollments/new?studentId=${studentId}`} className={NUT_VIEN}>
                  Ghi danh vào lớp
                </Link>
              )}
            </div>
          )}

          {lichSu.length > 0 && (
            <div className="border-t border-border">
              <h3 className="px-4 pb-1 pt-3 text-xs font-semibold text-muted-foreground">
                Lịch sử ghi danh ({lichSu.length})
              </h3>
              <PhanTrangBang cuonNgang tenDonVi="lớp" classThanh="px-4 pb-3">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="border-b border-border">
                    <tr>
                      <th className={TH}>Lớp / Khoá</th>
                      <th className={cn(TH, "text-right")}>Buổi đã học</th>
                      <th className={TH}>Trạng thái</th>
                      <th className={TH}>Bắt đầu</th>
                      <th className={TH}>Kết thúc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lichSu.map((h) => {
                      const nhan = NHAN_GHI_DANH[h.status];
                      return (
                        <tr key={h.enrollmentId} className="border-b border-border last:border-0">
                          <td className={TD}>
                            <Link
                              href={`/classes/${h.lop.id}/progress`}
                              className="font-medium text-foreground hover:text-primary-ink hover:underline"
                            >
                              {h.lop.ma ? `${h.lop.ma} · ` : ""}
                              {h.lop.ten}
                            </Link>
                            <span className="block text-xs text-muted-foreground">{h.lop.khoa}</span>
                          </td>
                          <td className={cn(TD, "text-right tabular-nums text-foreground")}>
                            {h.buoi.attended}/{h.buoi.total || "—"}
                            {h.buoi.absentNoMakeup > 0 && (
                              <span className="ml-1 text-xs text-state-danger-ink">
                                (vắng {h.buoi.absentNoMakeup})
                              </span>
                            )}
                          </td>
                          <td className={TD}>
                            <StatusPill tone={nhan.tone}>{nhan.nhan}</StatusPill>
                          </td>
                          <td className={cn(TD, "tabular-nums text-muted-foreground")}>
                            {ngayVN(h.batDau)}
                          </td>
                          <td className={cn(TD, "tabular-nums text-muted-foreground")}>
                            {h.ketThuc ? ngayVN(h.ketThuc) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </PhanTrangBang>
            </div>
          )}
        </>
      )}

      {buoiVang.length > 0 && (
        <details className="group border-t border-border">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
            <span>
              Buổi vắng ({buoiVang.length})
              {canBu > 0 && (
                <span className="ml-1 font-normal text-state-warning-ink">· {canBu} buổi cần bù</span>
              )}
            </span>
            <span className="text-xs font-normal text-muted-foreground group-open:hidden">Xem</span>
            <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">
              Thu gọn
            </span>
          </summary>
          <PhanTrangBang cuonNgang tenDonVi="buổi" classThanh="px-4 pb-3">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-y border-border">
                <tr>
                  <th className={TH}>Ngày</th>
                  <th className={TH}>Lớp</th>
                  <th className={TH}>Lý do</th>
                  <th className={TH}>Học bù</th>
                </tr>
              </thead>
              <tbody>
                {buoiVang.map((a, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className={cn(TD, "tabular-nums text-foreground")}>{ngayVN(a.date)}</td>
                    <td className={cn(TD, "text-foreground")}>{a.className}</td>
                    <td
                      className={cn(TD, "max-w-[16rem] truncate text-muted-foreground")}
                      title={a.absenceReason ?? undefined}
                    >
                      {a.absenceReason ?? "—"}
                    </td>
                    <td className={TD}>
                      {a.makeupStatus === "MADE_UP" ? (
                        <StatusPill tone="success">Đã bù</StatusPill>
                      ) : a.makeupStatus === "NEEDS_MAKEUP" ? (
                        <StatusPill tone="warning">Cần bù</StatusPill>
                      ) : (
                        <StatusPill tone="muted">Không bù</StatusPill>
                      )}
                      {a.ketQuaBu && (
                        <p className="mt-1 text-xs text-muted-foreground" title={a.ketQuaBu.danhGia ?? undefined}>
                          {a.ketQuaBu.nhan}
                          {a.ketQuaBu.danhGia ? ` · “${a.ketQuaBu.danhGia}”` : ""}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </details>
      )}
    </section>
  );
}
