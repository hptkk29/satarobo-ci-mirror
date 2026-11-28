import Link from "next/link";
import { Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { chuanHoaTim, ngayNgan } from "@/lib/elearning/dashboard-pure";
import { napDanhSachSoanKhoa, type KhoaTrongDanhSach } from "@/lib/elearning/soan-khoa-view";
import {
  MA_TAB_SOAN_KHOA,
  TAB_SOAN_KHOA,
  cacTabCuaKhoa,
  demTheoTab,
  nhanChinhCuaKhoa,
} from "@/lib/elearning/soan-khoa-tab";
import type { NhomMau } from "@/lib/elearning/nhom-mau-trang-thai";
import { tabDangMo, type SearchParamsTho } from "@/lib/elearning/tab-url";
import { ChonTuGui } from "../_components/ui/chon-tu-gui";
import { DanhSachDuLieu, type CotDuLieu } from "../_components/ui/danh-sach-du-lieu";
import { NHAN_O, NUT_CHINH, NUT_LANG_NHO, NUT_PHU, NUT_PHU_NHO, O_NHAP } from "../_components/ui/nut";
import { TabNav } from "../_components/ui/tab-nav";
import { ChamTrangThai } from "../_components/ui/trang-thai-nhom";
import { TrangQuanTri } from "../_components/ui/trang";

/**
 * EL-08 / QtKhoaHoc — DANH SÁCH KHOÁ NỘI BỘ để soạn, theo `03-quan-tri/QtKhoaHoc.html`: tiêu đề "Khoá học nội bộ" + nút "Tạo khoá từ chương trình"; tìm theo tên khoá/người
 * soạn + lọc theo chương trình / người soạn (ô chọn tự gửi); tab "Tất cả · Nháp · Chờ duyệt · Đã duyệt · Đang phát hành · Lưu trữ"; bảng Khoá · Chương trình ·
 * Trạng thái · Chương · bài · Đang giao · Cập nhật · thao tác (Duyệt / Soạn tiếp / Xuất bản / Mở).
 *
 * ⚠️ Trang này TỪNG KHÔNG TỒN TẠI, trong khi `chuong-trinh/page.tsx` có một link trỏ thẳng `/elearning/soan-khoa` — tức một **404**.
 *
 * SAI KHÁC CÓ CHỦ ĐÍCH (DECISIONS.md D-20): dòng mô tả bỏ câu "Video lấy từ YouTube" (khoá còn nhận video tải lên); thao tác "Xuất bản" mở màn duyệt (nơi duy nhất có cổng xuất bản).
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Khoá học nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

const DUONG_DAN = "/elearning/soan-khoa";
const TAB_TAT_CA = "tat-ca";
const CAC_TAB = [TAB_TAT_CA, ...MA_TAB_SOAN_KHOA] as const;

const NHOM_CUA_SAC: Record<"warning" | "info" | "muted" | "success", NhomMau> = {
  warning: "chu-y",
  info: "da-duyet",
  muted: "chua-bat-dau",
  success: "on",
};

const mot = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Thao tác chính của dòng theo trạng thái (thiết kế: Duyệt · Soạn tiếp · Xuất bản · Mở). Chờ duyệt/Đã duyệt đi qua màn duyệt — nơi có cổng. */
function thaoTacCuaKhoa(k: KhoaTrongDanhSach): { nhan: string; href: string; chinh: boolean } {
  const nhan = nhanChinhCuaKhoa(k);
  if (nhan.id === "PENDING_REVIEW") return { nhan: "Duyệt", href: `${DUONG_DAN}/${k.id}/duyet`, chinh: true };
  if (nhan.id === "APPROVED") return { nhan: "Xuất bản", href: `${DUONG_DAN}/${k.id}/duyet`, chinh: true };
  if (nhan.id === "DRAFT" && k.status === "DRAFT") return { nhan: "Soạn tiếp", href: `${DUONG_DAN}/${k.id}`, chinh: false };
  return { nhan: "Mở", href: `${DUONG_DAN}/${k.id}`, chinh: false };
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParamsTho> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:content:author")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Khoá học nội bộ" />
        <NoPermission permission="elearning:content:author" what="màn soạn khoá" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const sp = await searchParams;
  const tab = tabDangMo(sp, CAC_TAB, TAB_TAT_CA);
  const q = mot(sp.q).slice(0, 100).trim();
  const ct = mot(sp.ct).slice(0, 200);
  const ns = mot(sp.ns).slice(0, 200);

  const tatCa = await napDanhSachSoanKhoa(scopedDb(actor));
  const cacChuongTrinh = [...new Set(tatCa.map((k) => k.chuongTrinh).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b, "vi"));
  const cacNguoiSoan = [...new Set(tatCa.map((k) => k.nguoiSoan).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b, "vi"));

  // Lọc theo ô tìm + hai ô chọn TRƯỚC khi đếm: số trên tab là số khớp bộ lọc (như "Khoá của tôi").
  const tim = chuanHoaTim(q);
  const khop = tatCa.filter(
    (k) =>
      (tim === "" || chuanHoaTim(k.title).includes(tim) || chuanHoaTim(k.nguoiSoan ?? "").includes(tim) || chuanHoaTim(k.code).includes(tim)) &&
      (ct === "" || k.chuongTrinh === ct) &&
      (ns === "" || k.nguoiSoan === ns),
  );
  const dem = demTheoTab(khop);
  const cacKhoa = tab === TAB_TAT_CA ? khop : khop.filter((k) => cacTabCuaKhoa(k).includes(tab as (typeof MA_TAB_SOAN_KHOA)[number]));
  const giuLai = { q, ct, ns };
  const tabKhaiBao = [
    { id: TAB_TAT_CA, nhan: "Tất cả", dem: khop.length },
    ...TAB_SOAN_KHOA.map((t) => ({ id: t.id, nhan: t.nhan, dem: dem[t.id] })),
  ];
  const dangLoc = q !== "" || ct !== "" || ns !== "";

  const cot: CotDuLieu<KhoaTrongDanhSach>[] = [
    {
      id: "khoa",
      nhan: "Khoá",
      dienThoai: "tieu-de",
      hien: (k) => (
        <div className="min-w-0">
          <Link
            href={`${DUONG_DAN}/${k.id}`}
            className="block max-w-[28rem] truncate rounded text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring max-[720px]:whitespace-normal"
          >
            {k.title}
          </Link>
          <span className="block text-[13px] leading-[18px] text-muted-foreground">{k.nguoiSoan ?? k.code}</span>
        </div>
      ),
    },
    { id: "chuong-trinh", nhan: "Chương trình", hien: (k) => <span>{k.chuongTrinh ?? "—"}</span> },
    {
      id: "trang-thai",
      nhan: "Trạng thái",
      dienThoai: "thong-tin",
      hien: (k) => {
        const n = nhanChinhCuaKhoa(k);
        return <ChamTrangThai nhom={NHOM_CUA_SAC[n.sac]} nhan={n.nhan} />;
      },
    },
    { id: "chuong-bai", nhan: "Chương · bài", dienThoai: "thong-tin", hien: (k) => <span className="tabular-nums">{k.soChuong} · {k.soBai}</span> },
    { id: "dang-giao", nhan: "Đang giao", hien: (k) => (k.dangGiao > 0 ? <span className="tabular-nums">{k.dangGiao} người</span> : <span>—</span>) },
    { id: "cap-nhat", nhan: "Cập nhật", hien: (k) => <span className="tabular-nums">{ngayNgan(k.capNhatLuc)}</span> },
    {
      id: "thao-tac",
      nhan: "Thao tác",
      thaoTac: true,
      hien: (k) => {
        const t = thaoTacCuaKhoa(k);
        return (
          <Link href={t.href} className={t.chinh ? NUT_PHU_NHO : NUT_LANG_NHO}>
            {t.nhan}
          </Link>
        );
      },
    },
  ];

  return (
    <TrangQuanTri rong="rong">
      <PageHeader
        title="Khoá học nội bộ"
        subtitle="Khoá cho nhân viên. Học viên không bao giờ thấy các khoá này"
        actions={
          <Link href="/elearning/chuong-trinh" className={NUT_CHINH}>
            <Plus className="size-[18px]" aria-hidden />
            Tạo khoá từ chương trình
          </Link>
        }
      />

      {tatCa.length >= 200 ? (
        <p role="note" className="text-sm text-muted-foreground">
          Chỉ hiển thị 200 khoá gần sửa nhất — số đếm trên các mục chỉ tính trong 200 khoá này.
        </p>
      ) : null}

      <form action={DUONG_DAN} method="GET" role="search" className="flex flex-wrap items-end gap-3">
        {tab !== TAB_TAT_CA ? <input type="hidden" name="tab" value={tab} /> : null}
        <label className={`${NHAN_O} flex-[1_1_260px]`}>
          Tìm khoá
          <input type="search" name="q" defaultValue={q} placeholder="Tên khoá, người soạn" className={O_NHAP} />
        </label>
        <label className={`${NHAN_O} min-w-[10rem]`}>
          Chương trình
          <ChonTuGui name="ct" defaultValue={ct} className={O_NHAP}>
            <option value="">Tất cả</option>
            {cacChuongTrinh.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </ChonTuGui>
        </label>
        <label className={`${NHAN_O} min-w-[10rem]`}>
          Người soạn
          <ChonTuGui name="ns" defaultValue={ns} className={O_NHAP}>
            <option value="">Mọi người</option>
            {cacNguoiSoan.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </ChonTuGui>
        </label>
        <noscript>
          <button type="submit" className={NUT_PHU}>
            Áp dụng
          </button>
        </noscript>
        {dangLoc ? (
          <Link href={tab === TAB_TAT_CA ? DUONG_DAN : `${DUONG_DAN}?tab=${tab}`} className="inline-flex h-10 items-center rounded text-[13px] text-primary-ink underline underline-offset-[3px] focus-visible:ring-2 focus-visible:ring-ring">
            Xoá bộ lọc
          </Link>
        ) : null}
      </form>

      <TabNav duongDan={DUONG_DAN} tab={tabKhaiBao} dangMo={tab} giuLai={giuLai} nhanDanhSach="Khoá học nội bộ" />

      <DanhSachDuLieu
        hang={cacKhoa}
        khoa={(k) => k.id}
        cot={cot}
        nhomMau={(k) => NHOM_CUA_SAC[nhanChinhCuaKhoa(k).sac]}
        nhanTrangThai={(k) => nhanChinhCuaKhoa(k).nhan}
        tenDonVi="khoá"
        nhanDanhSach="Danh sách khoá nội bộ"
        trong={
          <EmptyState
            title={tatCa.length === 0 ? "Chưa có khoá nào trong phạm vi của bạn" : dangLoc ? "Không có khoá nào khớp bộ lọc" : "Không có khoá nào ở mục này"}
            description={
              tatCa.length === 0
                ? "Khoá được tạo từ một chương trình đào tạo. Mở màn chương trình, chọn “Tạo khoá”."
                : "Chọn mục khác ở trên, đổi bộ lọc, hoặc tạo khoá mới từ màn chương trình."
            }
            action={
              <Link href="/elearning/chuong-trinh" className={NUT_PHU}>
                Tới màn chương trình
              </Link>
            }
          />
        }
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] leading-[18px] text-muted-foreground" aria-live="polite">
          {cacKhoa.length} khoá
        </span>
      </div>
    </TrangQuanTri>
  );
}
