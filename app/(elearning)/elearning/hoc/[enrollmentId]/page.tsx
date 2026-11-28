import Link from "next/link";
import { ArrowLeft, ArrowRight, Award, CircleCheck, CircleDot, Circle, Info, Lock } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { napDeCuongKhoa } from "@/lib/elearning/course-view";
import { dongHan, trangThaiHienThi } from "@/lib/elearning/dashboard-pure";
import { dongGiaHan, dongHoanThanh } from "@/lib/elearning/de-cuong-pure";
import { chonBaiTiepTheo } from "@/lib/elearning/lesson-tree";
import { EmptyState } from "@/components/admin/ui/states";
import { NUT_CHINH, NUT_PHU } from "../../_components/ui/nut";
import { TienDoDam } from "../../_components/ui/tien-do";
import { ChamTrangThai } from "../../_components/ui/trang-thai-nhom";

/**
 * EL-04 — ĐỀ CƯƠNG MỘT KHOÁ, dựng theo `01-nhan-vien/NvDeCuong.html` + `NvDeCuongXong.html` (V4, 19/11/2026): liên kết quay về, tiêu đề + dòng
 * "chương trình · n chương · m bài"; cột trái = từng CHƯƠNG là một mục (danh sách dòng: biểu tượng trạng thái · tên + loại/thời lượng · nhãn);
 * cột phải (dính) = tiến độ (chuỗi chấm), hạn/người giao/chứng nhận, nút "Tiếp tục bài k", các dải ghi chú (gia hạn · quá hạn · hoàn thành).
 *
 * ⚠️ Route này là ĐÍCH của ba đường dẫn đã tồn tại từ lâu và từng trả 404: thông báo "được giao khoá", thông báo "quá hạn", và chuông việc-chưa-xong.
 * Điều kiện hoàn thành, số bài bắt buộc, chứng nhận lấy NGUYÊN từ `napDeCuongKhoa`.
 *
 * SAI KHÁC CÓ CHỦ ĐÍCH (DECISIONS.md D-20): KHÔNG có "Học tuần tự — xong bài trước mới mở bài sau" và KHÔNG khoá mọi bài sau bằng ổ khoá "Chưa mở": Q7 (học tuần
 * tự) chưa chốt. Bài chưa học hiện "Chưa học"; chỉ bài thật sự không tự mở được (vd. buổi trực tiếp do giảng viên điểm danh) có ổ khoá + lý do.
 * Không có "Xem lại bài kiểm tra" và "tiến độ không bị tính lại" — mã chưa làm/chưa chốt (lưới nv-p2 canh hai câu đó vắng mặt).
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Khoá học | Sata Robo",
  robots: { index: false, follow: false },
};

/** Tiêu đề chương theo thiết kế "Chương 1 · Chuẩn bị"; tên chương đã tự mang "Chương 1…" thì giữ nguyên (không lặp). */
function tieuDeChuong(thuTu: number, ten: string): string {
  return /^\s*chương\s*\d+/i.test(ten) ? ten.trim() : `Chương ${thuTu} · ${ten}`;
}

/** Dải ghi chú (`.note`): nền nâng, chữ phụ, biểu tượng 18px; sắc `ok`/`warn` theo thiết kế. */
function GhiChu({ sac = "mac-dinh", icon, children }: { sac?: "mac-dinh" | "ok" | "warn"; icon: React.ReactNode; children: React.ReactNode }) {
  const lop = {
    "mac-dinh": "bg-secondary text-[color:var(--el-text2)]",
    ok: "bg-state-success-soft text-state-success-ink",
    warn: "bg-state-warning-soft text-state-warning-ink",
  }[sac];
  return (
    <p role="status" className={`flex items-start gap-2.5 rounded-[10px] px-3.5 py-3 text-[13px] leading-[19px] ${lop}`}>
      <span className="flex-none pt-px [&>svg]:size-[18px]" aria-hidden>
        {icon}
      </span>
      <span>{children}</span>
    </p>
  );
}

export default async function Page({
  params,
}: {
  params: Promise<{ enrollmentId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-16 text-center text-sm">
        <h1 className="text-lg font-semibold">Chưa đăng nhập</h1>
        <p className="mt-2 text-muted-foreground">Đăng nhập rồi mở lại trang này.</p>
      </main>
    );
  }
  const actor = await resolveActor(session.user.id);
  const { enrollmentId } = await params;
  const kh = await napDeCuongKhoa(scopedDb(actor), {
    enrollmentId,
    userId: session.user.id,
  });

  if (!kh) {
    // Không phân biệt "không có" với "không phải của bạn": nói một câu cho cả hai,
    // vì phân biệt ra là tiết lộ lượt học của người khác có tồn tại.
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <EmptyState
          title="Không mở được khoá này"
          description="Có thể lượt học đã bị thu hồi, hoặc đường dẫn không đúng."
          action={
            <Link href="/elearning/khoa-cua-toi" className={NUT_PHU}>
              Về danh sách khoá của tôi
            </Link>
          }
        />
      </div>
    );
  }

  const now = new Date();
  const tt = trangThaiHienThi(kh, now);
  const han = dongHan(kh, now);
  const quaHan = kh.status === "OVERDUE";
  const tatCaBai = kh.chuong.flatMap((c) => c.lessons);
  const tiep = chonBaiTiepTheo(tatCaBai);
  const batDau = kh.progressPercent === 0 && tiep?.trangThai !== "DANG_HOC";
  const giaHan = dongGiaHan(kh);
  const hoanThanh = ["COMPLETED", "COMPLETED_LATE"].includes(kh.status) ? dongHoanThanh(kh.completedAt) : null;
  const soChuong = kh.chuong.length;
  const soBai = tatCaBai.length;
  // "Tiếp tục bài 3": thứ tự trong các bài BẮT BUỘC (cùng cách đếm với chuỗi chấm); bài tuỳ chọn thì không đánh số.
  const batBuoc = tatCaBai.filter((b) => b.batBuoc);
  const viTriTiep = tiep ? batBuoc.findIndex((b) => b.lessonId === tiep.lessonId) + 1 : 0;
  const nhanTiep = `${batDau ? "Bắt đầu" : "Tiếp tục"}${viTriTiep > 0 ? ` bài ${viTriTiep}` : " học"}`;
  const xongKhoa = hoanThanh !== null;

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-[clamp(16px,4vw,40px)] pb-16 pt-8 max-[720px]:gap-6 max-[720px]:pb-6 max-[720px]:pt-6">
      <header className="flex min-w-0 flex-col gap-2">
        <Link
          href={xongKhoa ? "/elearning/khoa-cua-toi?tab=da-xong" : "/elearning/khoa-cua-toi"}
          className="inline-flex items-center gap-1 self-start rounded text-[13px] leading-[18px] text-[color:var(--el-text2)] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Khoá của tôi
        </Link>
        <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.01em] text-foreground max-[720px]:text-[23px] max-[720px]:leading-[30px]">
          {kh.tenKhoa}
        </h1>
        <p className="max-w-[68ch] text-[color:var(--el-text2)]">
          {[kh.tenChuongTrinh ?? tt.nhan, soBai > 0 ? `${soChuong} chương` : null, soBai > 0 ? `${soBai} bài` : null].filter(Boolean).join(" · ")}
        </p>
      </header>

      <div className="grid items-start gap-10 min-[961px]:grid-cols-[minmax(0,1fr)_minmax(0,340px)] max-[960px]:gap-8">
        <div className="flex min-w-0 flex-col gap-8">
          {kh.chuong.length === 0 ? (
            <EmptyState
              title="Khoá này chưa có bài nào"
              description="Người soạn chưa thêm nội dung. Báo với phòng Đào tạo."
            />
          ) : (
            kh.chuong.map((c, i) => (
              <section key={c.moduleId} aria-labelledby={`chuong-${c.moduleId}`} className="flex min-w-0 flex-col gap-3">
                <h2 id={`chuong-${c.moduleId}`} className="text-[17px] font-medium leading-6 text-foreground">
                  {tieuDeChuong(i + 1, c.title)}
                </h2>
                {c.lessons.length === 0 ? (
                  <p className="border-y border-border py-3 text-sm text-muted-foreground">Chương này chưa có bài nào.</p>
                ) : (
                  <ul className="m-0 list-none border-t border-border p-0">
                    {c.lessons.map((b) => {
                      const xong = b.trangThai === "XONG";
                      const dangHoc = b.trangThai === "DANG_HOC";
                      const Icon = xong ? CircleCheck : dangHoc ? CircleDot : b.moDuoc ? Circle : Lock;
                      const sac = xong ? "text-state-success-ink" : dangHoc ? "text-primary-ink" : "text-muted-foreground";
                      const noiDung = (
                        <>
                          <span className={`block ${b.moDuoc ? "text-foreground" : "text-muted-foreground"}`}>{b.title}</span>
                          <span className="block text-[13px] leading-[18px] text-muted-foreground">
                            {b.moTaThoiLuong ?? b.nhanLoai}
                            {b.batBuoc ? "" : " · tuỳ chọn"}
                            {/* Không dựng link thì phải NÓI VÌ SAO ngay tại đây. Một dòng chữ xám không bấm được, không
                                kèm lý do, đọc ra thành "bạn chưa được phép" — trong khi sự thật là bài này giảng viên
                                điểm danh hộ. */}
                            {b.moDuoc ? "" : b.viSaoKhongMo ? ` · ${b.viSaoKhongMo}` : ""}
                          </span>
                        </>
                      );
                      return (
                        <li key={b.lessonId} className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border py-3">
                          <Icon className={`size-5 flex-none ${sac}`} aria-hidden />
                          {b.moDuoc ? (
                            <Link
                              href={`/elearning/hoc/${kh.enrollmentId}/${b.lessonId}`}
                              className="min-w-0 flex-[1_1_220px] rounded no-underline outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring max-[720px]:flex-[1_1_160px]"
                            >
                              {noiDung}
                            </Link>
                          ) : (
                            <span className="min-w-0 flex-[1_1_220px] max-[720px]:flex-[1_1_160px]">{noiDung}</span>
                          )}
                          <ChamTrangThai
                            nhom={xong ? "on" : dangHoc ? "chu-y" : "chua-bat-dau"}
                            nhan={xong ? "Đã xong" : dangHoc ? "Đang học" : "Chưa học"}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))
          )}
        </div>

        <aside aria-label="Thông tin khoá" className="flex min-w-0 flex-col gap-4 min-[961px]:sticky min-[961px]:top-20">
          {hoanThanh ? <GhiChu sac="ok" icon={<CircleCheck />}>{hoanThanh}</GhiChu> : null}

          {kh.soBaiBatBuoc > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] leading-[18px] text-muted-foreground">Tiến độ</span>
              <div className="flex flex-wrap items-center gap-3">
                <TienDoDam
                  tong={kh.soBaiBatBuoc}
                  xong={kh.soBaiXong}
                  dangHoc={kh.soBaiXong < kh.soBaiBatBuoc ? kh.soBaiXong : undefined}
                  nhan={kh.tenKhoa}
                  lon
                />
                <span className="text-[13px] leading-[18px] text-foreground">
                  {kh.soBaiXong} trên {kh.soBaiBatBuoc} bài bắt buộc
                </span>
              </div>
            </div>
          ) : null}

          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-y border-border py-4 text-sm">
            <dt className="text-muted-foreground">Hạn của bạn</dt>
            <dd className={`m-0 ${han?.sac === "danger" ? "text-state-danger-ink" : han?.sac === "warning" ? "text-state-warning-ink" : "text-foreground"}`}>
              {han ? han.chu.replace(/^Hạn /, "") : "Đã hoàn thành"}
            </dd>
            {kh.nguoiGiao ? (
              <>
                <dt className="text-muted-foreground">Người giao</dt>
                <dd className="m-0 text-foreground">{kh.nguoiGiao}</dd>
              </>
            ) : null}
            {kh.chungNhan ? (
              <>
                <dt className="text-muted-foreground">Chứng nhận</dt>
                <dd className="m-0 font-mono text-[13px] text-foreground">{kh.chungNhan.certCode}</dd>
              </>
            ) : null}
          </dl>

          {kh.chungNhan ? (
            // ⚠️ Chứng nhận cấp TỰ ĐỘNG qua hàng đợi sự kiện. Không hiện ở đây thì người học không có cách nào biết mình đã có.
            <>
              <Link href={`/elearning/chung-nhan-cua-toi/${encodeURIComponent(kh.chungNhan.certCode)}`} className={`${NUT_CHINH} w-full`}>
                <Award className="size-[18px]" aria-hidden />
                Xem chứng nhận
              </Link>
              <a
                href={`/api/elearning/chung-nhan?id=${kh.chungNhan.id}`}
                target="_blank"
                rel="noopener"
                className={`${NUT_PHU} w-full`}
              >
                Tải bản PDF (có mã QR tra cứu)
              </a>
              <span className="text-[13px] leading-[18px] text-muted-foreground">
                Bạn đã có chứng nhận hoàn thành khoá này
                {kh.chungNhan.validUntil ? ` · có hiệu lực đến ${kh.chungNhan.validUntil.toLocaleDateString("vi-VN")}` : " · không thời hạn"}
              </span>
            </>
          ) : null}

          {tiep && !xongKhoa ? (
            <Link href={`/elearning/hoc/${kh.enrollmentId}/${tiep.lessonId}`} className={`${NUT_CHINH} w-full`}>
              {nhanTiep}
              <ArrowRight className="size-[18px]" aria-hidden />
            </Link>
          ) : null}

          {giaHan ? <GhiChu icon={<Info />}>{giaHan}</GhiChu> : null}
          {kh.slaGraceDays > 0 ? (
            // ⚠️ Nói cho người học biết hạn của họ ĐÃ được nới, và vì sao. Không nói thì họ thấy một cái hạn khác với hạn ban đầu và tưởng hệ thống tính sai.
            <GhiChu icon={<Info />}>
              Hạn của bạn đã được nới thêm <strong>{kh.slaGraceDays} ngày làm việc</strong> vì bài nộp phải chờ chấm quá hạn cam kết. Bạn không bị tính trễ vì việc đó.
            </GhiChu>
          ) : null}
          {quaHan ? <GhiChu sac="warn" icon={<Info />}>Khoá đã quá hạn. Liên hệ phòng Đào tạo nếu cần gia hạn.</GhiChu> : null}
        </aside>
      </div>
    </main>
  );
}
