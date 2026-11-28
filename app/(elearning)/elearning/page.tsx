import Link from "next/link";
import { ArrowRight, Award, Download, Play } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { napTongQuanHocTap, type TongQuanHocTap } from "@/lib/elearning/dashboard-view";
import type { ChungNhanCuaToi } from "@/lib/elearning/certificate-mine";
import {
  chuDongHo,
  daXong,
  dongHanCuaBan,
  dongNgayTongQuan,
  ngayDayDu,
  type KhoaRut,
  type SacThai,
} from "@/lib/elearning/dashboard-pure";
import type { NhomMau } from "@/lib/elearning/nhom-mau-trang-thai";
import { EmptyState } from "@/components/admin/ui/states";
import { NUT_CHINH, NUT_LANG_NHO, NUT_PHU } from "./_components/ui/nut";
import { TienDoDam } from "./_components/ui/tien-do";
import { ChamTrangThai } from "./_components/ui/trang-thai-nhom";

/**
 * TỔNG QUAN HỌC TẬP — dựng theo `01-nhan-vien/Main.html` (VISUAL-AUDIT.md §2.1): tiêu đề "Học tập của tôi" + dòng ngày, thẻ "Bài tiếp theo"
 * (chuỗi chấm tiến độ, nút Học tiếp + Đề cương, khung video bên phải), hai cột "Hạn của bạn" · "Chứng nhận".
 *
 * Mọi con số đến từ `napTongQuanHocTap` (số truy vấn cố định, không theo số khoá). KHÔNG KPI giả, KHÔNG ảnh bìa giả.
 *
 * SAI KHÁC CÓ CHỦ ĐÍCH so với HTML (DECISIONS.md D-20):
 *  · Khối "Lộ trình Giáo viên mới" KHÔNG vẽ — chính thiết kế gắn nhãn "Đề xuất · cần dữ liệu lộ trình": lượt học từ luật tự động hoá không truy ngược
 *    được lộ trình (SCREEN-STATUS `Main`).
 *  · Khung video là ô PHÁT mô tả bằng dữ liệu thật (độ dài, nguồn), không phải ảnh thu nhỏ: ảnh bìa của video không công khai cần quyết định riêng.
 *  · Giữ lối vào `Dữ liệu của tôi` ở cuối trang: đó cũng là màn khiếu nại cờ nghi ngờ xem video
 *    (cửa sổ 14 ngày chạy im lặng — xem `tests/elearning/loi-vao-ui.test.ts`).
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tổng quan | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

const SO_DONG_HAN = 5;

const NHOM_CUA_SAC: Record<SacThai, NhomMau> = {
  danger: "tre-loi",
  warning: "chu-y",
  success: "on",
  info: "da-duyet",
  muted: "chua-bat-dau",
};

export default async function ElearningHomePage() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </main>
    );
  }
  const actor = await resolveActor(session.user.id);
  const now = new Date();
  const tq = await napTongQuanHocTap(scopedDb(actor), session.user.id, now);
  const { kpi } = tq;

  const hanCuaBan = tq.khoa
    .filter((k) => !daXong(k.status))
    .sort((a, b) => (a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY))
    .slice(0, SO_DONG_HAN);

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-[clamp(16px,4vw,40px)] pb-16 pt-8 max-[720px]:gap-6 max-[720px]:pb-6 max-[720px]:pt-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.01em] text-foreground max-[720px]:text-[23px] max-[720px]:leading-[30px]">
            Học tập của tôi
          </h1>
          <p className="max-w-[68ch] text-[color:var(--el-text2)]">{dongNgayTongQuan(now, kpi)}</p>
        </div>
      </header>

      {kpi.tong === 0 ? (
        // Rỗng ≠ lỗi tải. Nói rõ vì sao rỗng và hỏi ai (phòng Đào tạo là nơi giao khoá).
        <EmptyState
          title="Bạn chưa được giao khoá nào"
          description="Phòng Đào tạo là nơi giao khoá học. Khi có khoá được giao, nó sẽ hiện ở đây cùng hạn hoàn thành. Liên hệ phòng Đào tạo nếu bạn nghĩ đây là nhầm lẫn."
        />
      ) : (
        <>
          {tq.tiepTuc ? <BaiTiepTheo tt={tq.tiepTuc} tienDo={tq.tienDoBai[tq.tiepTuc.khoa.enrollmentId]} /> : null}

          <div className="grid items-start gap-10 min-[961px]:grid-cols-[minmax(0,1fr)_minmax(0,340px)] max-[960px]:gap-8">
            <HanCuaBan ds={hanCuaBan} now={now} tienDoBai={tq.tienDoBai} />
            <ChungNhanGanDay ds={tq.chungNhanGanDay} />
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Muốn xem hệ thống lưu gì về việc học của bạn?{" "}
        <Link href="/elearning/du-lieu-cua-toi" className="underline">
          Dữ liệu của tôi
        </Link>
      </p>
    </main>
  );
}

function BaiTiepTheo({
  tt,
  tienDo,
}: {
  tt: NonNullable<TongQuanHocTap["tiepTuc"]>;
  tienDo: TongQuanHocTap["tienDoBai"][string] | undefined;
}) {
  const { khoa, bai, href, conLai } = tt;
  const xong = tienDo?.xong ?? 0;
  const tong = tienDo?.tong ?? 0;
  const batDau = xong === 0 && khoa.progressPercent === 0;
  const nhanNut = bai?.viTri ? `${batDau ? "Bắt đầu" : "Học tiếp"} bài ${bai.viTri}` : batDau ? "Bắt đầu học" : "Học tiếp";
  const mota = [khoa.tenKhoa, bai?.viTri && tong > 0 ? `bài ${bai.viTri} trên ${tong}` : null, bai?.moTaThoiLuong ? bai.moTaThoiLuong.toLowerCase() : null]
    .filter(Boolean)
    .join(" · ");
  const coKhungVideo = bai?.kind === "VIDEO" && bai.moDuoc;

  return (
    <section
      aria-labelledby="bai-tiep-theo"
      className={`grid items-center gap-7 rounded-[14px] border border-border bg-card p-6 ${
        coKhungVideo ? "min-[961px]:grid-cols-[minmax(0,1fr)_minmax(0,340px)]" : ""
      }`}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <span id="bai-tiep-theo" className="text-[13px] leading-[18px] text-muted-foreground">
          Bài tiếp theo
        </span>
        <h2 className="text-[22px] font-medium leading-7 text-foreground">{bai ? bai.title : khoa.tenKhoa}</h2>
        <p className="text-[color:var(--el-text2)]">{bai ? mota : "Khoá này chưa có bài học nào cho bạn."}</p>
        {tong > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <TienDoDam tong={tong} xong={xong} dangHoc={bai?.viTri ? xong : undefined} nhan={khoa.tenKhoa} lon />
            {conLai ? <span className="text-[13px] leading-[18px] text-muted-foreground">{conLai}</span> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Link href={href} className={NUT_CHINH}>
            {nhanNut}
            <ArrowRight className="size-[18px]" aria-hidden />
          </Link>
          <Link href={`/elearning/hoc/${khoa.enrollmentId}`} className={NUT_PHU}>
            Đề cương
          </Link>
        </div>
      </div>

      {coKhungVideo && bai ? (
        <Link href={href} aria-label={`Mở video ${bai.viTri ? `bài ${bai.viTri}` : bai.title}`} className="block min-w-0 rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <div className="relative aspect-video overflow-hidden rounded-[14px] bg-[#0f0f10]">
            <span className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90">
              <Play className="size-7 fill-[#1f1b16] text-[#1f1b16]" aria-hidden />
            </span>
            <span className="absolute bottom-2.5 left-2.5 rounded-md bg-black/60 px-2 py-0.5 text-xs leading-4 text-white">
              {[bai.nguonYoutube ? "YouTube · không công khai" : "Video", bai.thoiLuongGiay ? chuDongHo(bai.thoiLuongGiay) : null].filter(Boolean).join(" · ")}
            </span>
          </div>
        </Link>
      ) : null}
    </section>
  );
}

function HanCuaBan({
  ds,
  now,
  tienDoBai,
}: {
  ds: readonly KhoaRut[];
  now: Date;
  tienDoBai: TongQuanHocTap["tienDoBai"];
}) {
  return (
    <section aria-labelledby="han-cua-ban" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="han-cua-ban" className="text-[17px] font-medium leading-6 text-foreground">
          Hạn của bạn
        </h2>
        <Link href="/elearning/khoa-cua-toi" className="text-[13px] leading-[18px] text-primary-ink underline underline-offset-[3px]">
          Khoá của tôi
        </Link>
      </div>
      {ds.length === 0 ? (
        <p className="border-y border-border py-3 text-sm text-muted-foreground">Bạn không còn khoá nào cần hoàn thành.</p>
      ) : (
        <ul className="m-0 list-none border-t border-border p-0">
          {ds.map((k) => {
            const d = dongHanCuaBan(k, now, tienDoBai[k.enrollmentId]);
            return (
              <li key={k.enrollmentId} className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border py-3">
                <span className="min-w-0 flex-[1_1_220px] max-[720px]:flex-[1_1_160px]">
                  <Link
                    href={`/elearning/hoc/${k.enrollmentId}`}
                    className="block rounded text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {k.tenKhoa}
                  </Link>
                  <span className="text-[13px] leading-[18px] text-muted-foreground">{d.phu}</span>
                </span>
                <ChamTrangThai nhom={NHOM_CUA_SAC[d.sac]} nhan={d.nhan} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Dòng phụ của chứng nhận: "Cấp 02/11/2026 · hiệu lực đến 02/11/2027" / "· không hết hạn" / "· đã thu hồi". */
function dongPhuChungNhan(c: ChungNhanCuaToi): string {
  const cap = `Cấp ${ngayDayDu(c.issuedAt)}`;
  if (c.trangThai === "REVOKED") return `${cap} · đã thu hồi`;
  return c.validUntil ? `${cap} · hiệu lực đến ${ngayDayDu(c.validUntil)}` : `${cap} · không hết hạn`;
}

function ChungNhanGanDay({ ds }: { ds: readonly ChungNhanCuaToi[] }) {
  return (
    <section aria-labelledby="chung-nhan-gan-day" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="chung-nhan-gan-day" className="text-[17px] font-medium leading-6 text-foreground">
          Chứng nhận
        </h2>
        {ds.length > 0 ? (
          <Link href="/elearning/chung-nhan-cua-toi" className="text-[13px] leading-[18px] text-primary-ink underline underline-offset-[3px]">
            Xem tất cả
          </Link>
        ) : null}
      </div>
      {ds.length === 0 ? (
        <p className="border-y border-border py-3 text-sm text-muted-foreground">Bạn chưa có chứng nhận nào.</p>
      ) : (
        <ul className="m-0 list-none border-t border-border p-0">
          {ds.map((c) => (
            <li key={c.id} className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border py-3">
              <Award className="size-5 flex-none text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-[1_1_160px]">
                <Link
                  href={`/elearning/chung-nhan-cua-toi/${encodeURIComponent(c.certCode)}`}
                  aria-label={`Xem chứng nhận ${c.tenKhoa}`}
                  className="block rounded text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {c.tenKhoa}
                </Link>
                <span className="block text-[13px] leading-[18px] text-muted-foreground">{dongPhuChungNhan(c)}</span>
              </span>
              {c.trangThai === "REVOKED" ? null : (
                <a
                  href={`/api/elearning/chung-nhan?id=${c.id}`}
                  target="_blank"
                  rel="noopener"
                  aria-label={`Tải PDF chứng nhận ${c.tenKhoa}`}
                  className={NUT_LANG_NHO}
                >
                  <Download className="size-[18px]" aria-hidden />
                  Tải PDF
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
