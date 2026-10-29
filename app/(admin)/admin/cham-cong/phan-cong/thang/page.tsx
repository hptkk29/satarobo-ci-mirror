// app/(admin)/admin/cham-cong/phan-cong/thang/page.tsx — CÔNG PARTTIME THÁNG của một cơ sở (SR.QD.238 · P5d).
//
// Hai góc nhìn trên CÙNG một lớp đọc (`docBaoCaoThang`):
//   · Báo cáo  — mỗi người một dòng, mỗi con số là LIÊN KẾT tới đúng danh sách dòng sinh ra nó (tổng = chi tiết).
//   · Đối soát — việc QLCS phải quyết: xác nhận thực hiện (hàng loạt cho dòng sạch, từng dòng có lý do cho ngoại lệ), xác nhận ca
//     trực, giao trực tường minh, dựng / quyết khoản trừ đề xuất.
// Không phải bảng lương: có đơn vị + đơn giá chụp sẵn + điều chỉnh tách riêng; không có "thực lĩnh".
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  CircleAlert,
  Clock3,
  GraduationCap,
  HandCoins,
  ShieldAlert,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { luatKy } from "@/lib/phan-cong/cong-o";
import { docCongOThang, docPhanAnhChoDuyet } from "@/lib/phan-cong/cong-o-db";
import { docKyLuatMoi } from "@/lib/phan-cong/ky-luat-db";
import { TongHopTuDong } from "./_components/tong-hop-tu-dong";
import { PhanAnhChoDuyet } from "./_components/phan-anh-cho-duyet";
import {
  ASK_WHO,
  loadModuleScope,
  type ModuleAction,
} from "@/lib/cham-cong/module-scope";
import { hrefWith } from "@/lib/cham-cong/scope-href";
import { currentPeriodKey } from "@/lib/cham-cong/period";
import {
  laChiSo,
  NHAN_CHI_SO,
  soCua,
  type ChiSo,
  type DongTongHop,
} from "@/lib/parttime/bao-cao-thang";
import {
  docBaoCaoThang,
  type BaoCaoThang,
} from "@/lib/parttime/bao-cao-thang-db";
import { chinhSachTaiNgay } from "@/lib/parttime/chinh-sach";
import { nhanBangChung } from "@/lib/parttime/nhan-bang-chung";
import { docChinhSach } from "@/lib/parttime/phan-cong-db";
import { trangThaiCongTacTai } from "@/lib/parttime/cong-tac";
import { CAU_RBAC_V2, KHOA_CONG_TAC } from "@/lib/parttime/cong-tac-thuan";
import { khoiParttime } from "@/lib/cham-cong/khoi-parttime";
import { nhanCuaKey } from "@/lib/settings/nhan-van-hanh";
import { ParttimeChuaBat } from "@/components/admin/cham-cong/parttime-chua-bat";
import { BTN_OUTLINE } from "@/components/admin/cham-cong/classes";
import { getAssignableTeachers } from "@/lib/teachers/assignable";
import { vnYmd } from "@/lib/time/vn";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { NoPermission } from "@/components/admin/ui/states";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { KpiStrip, type KpiItem } from "@/components/admin/cham-cong/kpi-strip";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { NutQuyet } from "./_components/nut-quyet";
import { GiaoTruc } from "./_components/giao-truc";
import { BangTuanThu } from "../_components/bang-tuan-thu";

export const metadata = {
  title: "Công parttime tháng | Admin",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const VIEW: ModuleAction = "hr_attendance:view";
const ASSIGN: ModuleAction = "hr_attendance:assign";
const BASE = "/cham-cong/phan-cong/thang";
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const gio = (d: Date | null) =>
  d
    ? d.toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Ho_Chi_Minh",
      })
    : "—";
const tien = (n: number) =>
  `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("vi-VN")}đ`;
const soGio = (phut: number) =>
  (phut / 60).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
function thangLech(thang: string, n: number) {
  const [y, m] = thang.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
const NHAN_VAI = {
  MAIN_TEACHER: "Đứng chính",
  TEACHING_ASSISTANT: "Trợ giảng",
  OPERATIONS_SUPPORT: "Vận hành",
} as const;
const NHAN_LOP: Record<string, string> = {
  TU_DONG: "Sạch",
  XEM_TAY: "Có ngoại lệ",
  CHAN: "Không xác nhận được",
  CHUA_XONG: "Chưa xong",
  CHO: "Chờ",
  KHONG_AP_DUNG: "Không áp dụng",
};
const NHAN_NX: Record<string, string> = {
  ON_TIME: "Đúng hạn",
  LATE: "Nộp trễ",
  MISSING: "Thiếu",
  PENDING: "Chưa tới hạn",
  KHONG_YEU_CAU: "Không cần",
  CHUA_DIEM_DANH: "Chưa điểm danh",
};
const NHAN_TT: Record<string, string> = {
  PROPOSED: "Đề xuất",
  CONFIRMED: "Đã xác nhận",
  REJECTED: "Không áp",
  CANCELLED: "Đã huỷ",
};

/** Nhóm cột của bảng tháng — mỗi cột là một chỉ số; ô là liên kết tới danh sách chi tiết của chính chỉ số đó. */
const NHOM: { ten: string; cot: ChiSo[] }[] = [
  {
    ten: "Dạy (tiết đã xác nhận)",
    cot: ["mainThuong", "mainDayThay", "mainHocBu", "mainHocVuot", "troGiang"],
  },
  { ten: "Trực vận hành", cot: ["trucDu", "trucNua", "trucKhong"] },
  { ten: "Bằng chứng", cot: ["diMuon", "veSom", "thieuNhanXet", "nopTre"] },
  { ten: "Cần xử lý", cot: ["choXacNhan", "ngoaiLe", "donViCu"] },
];
const NGAN: Record<ChiSo, string> = {
  mainThuong: "Thường",
  mainDayThay: "Dạy thay",
  mainHocBu: "Học bù",
  mainHocVuot: "Học vượt",
  mainKhac: "Khác",
  troGiang: "Trợ giảng",
  trucDu: "1,0",
  trucNua: "0,5",
  trucKhong: "0",
  diMuon: "Muộn",
  veSom: "Về sớm",
  thieuNhanXet: "Thiếu NX",
  nopTre: "NX trễ",
  deXuat: "Đề xuất",
  daXacNhanTru: "Đã xác nhận",
  ngoaiLe: "Ngoại lệ",
  choXacNhan: "Chờ xác nhận",
  donViCu: "Cũ",
};

export default async function CongThangPage({
  searchParams,
}: {
  searchParams: Promise<{
    coSo?: string;
    thang?: string;
    xem?: string;
    nguoi?: string;
    chiSo?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user)
    redirect("/login?callbackUrl=%2Fcham-cong%2Fphan-cong%2Fthang");
  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  const now = new Date();
  const homNay = vnYmd(now);
  const thang =
    sp.thang && /^\d{4}-\d{2}$/.test(sp.thang) ? sp.thang : homNay.slice(0, 7);
  const ky = currentPeriodKey();
  // Khối nào: MỘT hàm với tab điều hướng và với màn Phân công buổi (`khoiParttime`).
  const pt = khoiParttime(scope, sp.coSo);
  if (!pt) {
    return (
      <div className="max-w-6xl">
        <PageHeader title="Công parttime tháng" />
        <ModuleNav
          active="congpt"
          scope={scope}
          ctx={{ ky, coSo: sp.coSo ?? null }}
        />
        <NoPermission
          permission={VIEW}
          what="công parttime tháng"
          askWho={ASK_WHO[VIEW]}
        />
      </div>
    );
  }
  const { khoi, block } = pt;
  const coSo = block.id;
  // GĐ6 (kỳ ≥ 2026-11): thêm "Tổng hợp tự động" + "Phản ánh chờ duyệt"; kỳ cũ không có hai góc nhìn này (chốt 8).
  const luatThang = luatKy(thang, await docKyLuatMoi());
  const XEM_MOI = ["tu-dong", "phan-anh"] as const;
  const xem: "bao-cao" | "doi-soat" | "tu-dong" | "phan-anh" =
    sp.xem === "doi-soat"
      ? "doi-soat"
      : luatThang === "MOI" && (XEM_MOI as readonly string[]).includes(sp.xem ?? "")
        ? (sp.xem as (typeof XEM_MOI)[number])
        : "bao-cao";

  const [bc, ctBong, ctPhanCong, ctTien, coAssign, coApprove, chinhSach, giaoVien, suaCauHinh] = await Promise.all(
    [
      docBaoCaoThang({ centerId: coSo, thang, now }),
      // Ba công tắc ĐỘC LẬP: đối soát / xác nhận = chạy bóng; giao trực = phân công; quyết khoản tiền = tiền.
      trangThaiCongTacTai("WORKUNIT_SHADOW", { centerId: coSo }),
      trangThaiCongTacTai("STAFFING", { centerId: coSo }),
      trangThaiCongTacTai("COMPENSATION", { centerId: coSo }),
      checkPermission(ASSIGN, { centerId: coSo }),
      checkPermission("hr_attendance:approve", { centerId: coSo }),
      docChinhSach(),
      getAssignableTeachers({ centerIds: [coSo] }),
      // Chỉ Quản trị tối cao bật được công tắc Parttime (không khoá nào khai `qlcsSuaDuoc`) ⇒ nút "Mở cấu hình Chấm công".
      checkPermission("settings:edit"),
    ],
  );
  const homQua = vnYmd(new Date(now.getTime() - 86_400_000));
  const [congO, phanAnhCho] = await Promise.all([
    xem === "tu-dong" ? docCongOThang({ centerId: coSo, periodKey: thang, den: homQua, userId: null }) : null,
    xem === "phan-anh" ? docPhanAnhChoDuyet({ centerId: coSo, periodKey: thang }) : null,
  ]);
  const bat = ctBong.dung;
  const cong = { bong: ctBong.dung, phanCong: ctPhanCong.dung, tien: ctTien.dung };
  const csHomNay = chinhSachTaiNgay(chinhSach, homNay);
  const ca =
    csHomNay && csHomNay.thamSo.loai === "SR_QD_238" ? csHomNay.thamSo.ca : [];
  const giu = { coSo, thang, xem: xem === "bao-cao" ? undefined : xem };
  const tong = bc.tongHop.reduce(
    (a, r) => ({
      tiet: a.tiet + r.soTiet,
      phut: a.phut + r.phutChuanDay,
      truc: a.truc + r.donViTruc,
      phutTruc: a.phutTruc + r.phutCoMatTruc,
      deXuat: a.deXuat + r.tienDeXuat,
      daXN: a.daXN + r.tienDaXacNhan,
      cho: a.cho + soCua(r, "choXacNhan"),
      ngoaiLe: a.ngoaiLe + soCua(r, "ngoaiLe"),
    }),
    {
      tiet: 0,
      phut: 0,
      truc: 0,
      phutTruc: 0,
      deXuat: 0,
      daXN: 0,
      cho: 0,
      ngoaiLe: 0,
    },
  );
  const the: KpiItem[] = [
    {
      icon: GraduationCap,
      value: tong.tiet.toLocaleString("vi-VN"),
      label: "Tiết đã xác nhận",
      tone: "brand",
      hint: `${soGio(tong.phut)} giờ chuẩn`,
    },
    {
      icon: CalendarClock,
      value: tong.truc.toLocaleString("vi-VN"),
      label: "Đơn vị trực",
      tone: "brand",
      hint: `${soGio(tong.phutTruc)} giờ có mặt thực tế`,
    },
    // GĐ6: kỳ luật mới không có bước QLCS xác nhận — thẻ trỏ sang "Tổng hợp tự động" thay vì đếm "chờ xác nhận" (luật 12).
    luatThang === "MOI"
      ? { icon: Clock3, value: "Tự động", label: "Công tính theo lượt quét", tone: "brand", href: hrefWith(BASE, { ...giu, xem: "tu-dong" }) }
      : {
          icon: Clock3,
          value: tong.cho.toLocaleString("vi-VN"),
          label: "Chờ QLCS xác nhận",
          tone: tong.cho ? "warning" : "success",
          href: hrefWith(BASE, { ...giu, xem: "doi-soat" }),
        },
    {
      icon: CircleAlert,
      value: tong.ngoaiLe.toLocaleString("vi-VN"),
      label: "Ngoại lệ cần xem",
      tone: tong.ngoaiLe ? "danger" : "success",
      href: hrefWith(BASE, { ...giu, xem: "doi-soat" }),
    },
    {
      icon: HandCoins,
      value: tien(tong.deXuat),
      label: "Khoản trừ đề xuất",
      tone: tong.deXuat ? "warning" : "success",
      hint: `đã xác nhận ${tien(tong.daXN)}`,
    },
  ];
  const ten = (id: string | null) => (id ? (bc.ten[id] ?? "—") : "—");
  const chon =
    sp.nguoi && laChiSo(sp.chiSo) ? { nguoi: sp.nguoi, chiSo: sp.chiSo } : null;
  const dongChon = chon
    ? (bc.tongHop.find((r) => r.userId === chon.nguoi) ?? null)
    : null;

  return (
    <div className="max-w-6xl 2xl:max-w-none">
      <PageHeader
        title={`Công parttime tháng — ${block.label}`}
        subtitle="Tiết dạy và ca trực đã được xác nhận, bằng chứng chấm công, nhận xét, khoản trừ đề xuất. Chưa phải bảng lương."
        actions={
          // Cùng tên với tab "Phân công buổi" — trước 20/10/2026 nút này ghi "← Phân công tuần".
          <Link href={hrefWith("/cham-cong/phan-cong", { coSo })} className={BTN_OUTLINE}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Phân công buổi
          </Link>
        }
      />
      <ModuleNav active="congpt" scope={scope} ctx={{ ky, coSo }} />
      <ScopeBar
        basePath={BASE}
        blocks={khoi.map((b) => ({ id: b.id, label: b.label }))}
        coSo={coSo}
        keep={{ thang }}
        month={{
          ky: thang,
          prevHref: hrefWith(BASE, { ...giu, thang: thangLech(thang, -1) }),
          nextHref: hrefWith(BASE, { ...giu, thang: thangLech(thang, 1) }),
        }}
      />

      {!bat && (
        <ParttimeChuaBat
          tinhNang="Đối soát Parttime (chạy bóng)"
          coSo={block.label}
          chan={ctBong.chan ? CAU_RBAC_V2 : null}
          tenCongTac={nhanCuaKey(KHOA_CONG_TAC.WORKUNIT_SHADOW).ten}
          suaDuoc={suaCauHinh}
          conXem={
            <>
              Màn đang <b>chỉ để xem</b>: số liệu dưới đây (nếu có) chưa được ai xác nhận, và xác nhận thực hiện / giao trực bị từ chối
              cho tới khi bật. Đây là số công Parttime theo SR.QD.238 — <b>chưa phải bảng lương</b>, và khác “Bảng công tháng” (công
              ngày theo ca của mọi nhân sự).
            </>
          }
        />
      )}
      {bat && !cong.tien && (
        <div className="mb-4 rounded-lg border border-state-info-ink/20 bg-state-info-soft px-3 py-2.5 text-sm text-state-info-ink">
          <b>Chạy bóng — chưa phải căn cứ lương.</b> Số liệu tháng dưới đây để đối soát; khoản điều chỉnh tiền chỉ ở dạng đề
          xuất, không ai quyết được cho tới khi bật công tắc tiền của cơ sở.
        </div>
      )}

      <nav aria-label="Góc nhìn" className="mb-4 flex flex-wrap gap-2">
        {([...(["bao-cao", "doi-soat"] as const), ...(luatThang === "MOI" ? XEM_MOI : [])] as const).map((k) => (
          <Link
            key={k}
            href={hrefWith(BASE, {
              ...giu,
              xem: k === "bao-cao" ? undefined : k,
            })}
            aria-current={xem === k ? "page" : undefined}
            className={`rounded-full border px-3 py-1.5 text-sm ${xem === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"}`}
          >
            {k === "bao-cao" ? "Báo cáo" : k === "doi-soat" ? "Đối soát & xác nhận" : k === "tu-dong" ? "Tổng hợp tự động" : "Phản ánh chờ duyệt"}
          </Link>
        ))}
      </nav>

      {bc.chuaGiaiQuyet.length > 0 && (
        <div
          role="note"
          className="mb-4 rounded-lg border border-state-danger-ink/30 bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink"
        >
          <p className="flex items-center gap-1.5 font-medium">
            <ShieldAlert className="size-4 shrink-0" aria-hidden /> Chưa chốt
            được kỳ: {bc.chuaGiaiQuyet.length} mục chờ quyết định chính sách
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {[
              ...new Set(bc.chuaGiaiQuyet.map((m) => m.cauHoi ?? "Xem tay")),
            ].map((q) => {
              const ds = bc.chuaGiaiQuyet.filter(
                (m) => (m.cauHoi ?? "Xem tay") === q,
              );
              return (
                <li key={q}>
                  <b>{q}</b> · {ds.length} mục — {ds[0].moTa}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <KpiStrip cols={5} items={the} />

      {xem === "tu-dong" && congO ? (
        <TongHopTuDong o={congO.o} tu={congO.tu} den={congO.den} />
      ) : xem === "phan-anh" && phanAnhCho ? (
        <PhanAnhChoDuyet ds={phanAnhCho} coQuyen={coAssign} />
      ) : xem === "bao-cao" ? (
        <>
          <BangTuanThu ds={bc.tuanThu} ten={bc.ten} tieuDe="Tuân thủ buổi dạy trong tháng" />
          <BangThang bc={bc} giu={giu} chon={chon} />
          {chon && dongChon && (
            <ChiTiet
              bc={bc}
              r={dongChon}
              chiSo={chon.chiSo}
              ten={ten}
              dong={hrefWith(BASE, {
                ...giu,
                nguoi: undefined,
                chiSo: undefined,
              })}
            />
          )}
        </>
      ) : (
        <DoiSoat
          bc={bc}
          coSo={coSo}
          cong={cong}
          coAssign={coAssign}
          coApprove={coApprove}
          tuDong={luatThang === "MOI"}
          ten={ten}
          ca={ca}
          homNay={homNay}
          nguoi={giaoVien.map((g) => ({ id: g.id, ten: g.name ?? g.id }))}
        />
      )}

      <PageHelp>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Một <b>tiết chuẩn</b> = 10 phút chuẩn bị + 90 phút dạy = 100 phút.
            Buổi 60′ / 120′ chưa quy được số tiết (chờ chủ dự án) nên không xác
            nhận được.
          </li>
          <li>
            <b>Trực vận hành</b> chỉ tính khi quản lý <b>giao trực</b>: có ô ca
            hay có mặt ở cơ sở mà không được giao thì không có công trực. Trong
            ca được giao: 0 tiết = 1 ca, 1 tiết = 0,5 ca, 2 tiết trở lên = 0.
          </li>
          <li>
            Khoản trừ chỉ là <b>đề xuất</b> cho tới khi quản lý cơ sở xác nhận;
            mục chờ quyết định chính sách không có số tiền.
          </li>
          <li>
            Mỗi con số trong bảng là một liên kết — bấm để xem đúng các dòng tạo
            ra nó.
          </li>
        </ul>
      </PageHelp>
    </div>
  );
}

function BangThang({
  bc,
  giu,
  chon,
}: {
  bc: BaoCaoThang;
  giu: Record<string, string | undefined>;
  chon: { nguoi: string; chiSo: ChiSo } | null;
}) {
  if (bc.tongHop.length === 0)
    return (
      <p className="rounded-lg border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        Tháng này chưa có tiết dạy hay ca trực nào thuộc SR.QD.238.
      </p>
    );
  const o = (r: DongTongHop, k: ChiSo) => {
    const n = soCua(r, k);
    const dang = chon?.nguoi === r.userId && chon.chiSo === k;
    return n === 0 ? (
      <span className="text-muted-foreground">0</span>
    ) : (
      <Link
        href={hrefWith(BASE, { ...giu, nguoi: r.userId, chiSo: k })}
        aria-current={dang ? "true" : undefined}
        aria-label={`${NHAN_CHI_SO[k]}: ${n} — xem chi tiết`}
        className={`font-medium tabular-nums underline-offset-2 hover:underline ${dang ? "rounded bg-primary px-1.5 text-primary-foreground" : "text-primary"}`}
      >
        {n}
      </Link>
    );
  };
  const nguoi = [...bc.tongHop].sort((a, b) =>
    (bc.ten[a.userId] ?? "").localeCompare(bc.ten[b.userId] ?? "", "vi"),
  );
  return (
    <div className="rounded-lg border border-border bg-card">
      <PhanTrangBang
        cuonNgang
        tenDonVi="người"
        khoaGhiNho="pt-thang"
        khoaTrang={`${bc.thang}`}
        classThanh="px-4 pb-3"
      >
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <caption className="sr-only">
            Công parttime tháng {bc.thang} theo người
          </caption>
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <th
                rowSpan={2}
                scope="col"
                className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium"
              >
                Người
              </th>
              {NHOM.map((g) => (
                <th
                  key={g.ten}
                  colSpan={
                    g.cot.length +
                    (g.ten.startsWith("Dạy")
                      ? 2
                      : g.ten.startsWith("Trực")
                        ? 2
                        : 0)
                  }
                  scope="colgroup"
                  className="border-l border-border px-2 py-1.5 text-center font-medium"
                >
                  {g.ten}
                </th>
              ))}
              <th
                colSpan={2}
                scope="colgroup"
                className="border-l border-border px-2 py-1.5 text-center font-medium"
              >
                Khoản trừ
              </th>
            </tr>
            <tr className="border-b border-border text-xs text-muted-foreground">
              {NHOM.flatMap((g) => [
                ...g.cot.map((k, i) => (
                  <th
                    key={k}
                    scope="col"
                    title={NHAN_CHI_SO[k]}
                    className={`px-2 py-1.5 text-right font-medium ${i === 0 ? "border-l border-border" : ""}`}
                  >
                    {NGAN[k]}
                  </th>
                )),
                ...(g.ten.startsWith("Dạy")
                  ? [
                      <th
                        key="tiet"
                        scope="col"
                        className="px-2 py-1.5 text-right font-medium"
                      >
                        Tổng tiết
                      </th>,
                      <th
                        key="gio"
                        scope="col"
                        className="px-2 py-1.5 text-right font-medium"
                      >
                        Giờ chuẩn
                      </th>,
                    ]
                  : []),
                ...(g.ten.startsWith("Trực")
                  ? [
                      <th
                        key="dv"
                        scope="col"
                        className="px-2 py-1.5 text-right font-medium"
                      >
                        Đơn vị
                      </th>,
                      <th
                        key="gc"
                        scope="col"
                        className="px-2 py-1.5 text-right font-medium"
                      >
                        Giờ có mặt
                      </th>,
                    ]
                  : []),
              ])}
              <th
                scope="col"
                className="border-l border-border px-2 py-1.5 text-right font-medium"
              >
                Đề xuất
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Đã xác nhận
              </th>
            </tr>
          </thead>
          <tbody>
            {nguoi.map((r) => (
              <tr
                key={r.userId}
                className="border-b border-border last:border-0"
              >
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium text-foreground"
                >
                  {bc.ten[r.userId] ?? r.userId}
                </th>
                {NHOM.flatMap((g) => [
                  ...g.cot.map((k, i) => (
                    <td
                      key={k}
                      className={`px-2 py-2 text-right ${i === 0 ? "border-l border-border" : ""}`}
                    >
                      {o(r, k)}
                    </td>
                  )),
                  ...(g.ten.startsWith("Dạy")
                    ? [
                        <td
                          key="tiet"
                          className="px-2 py-2 text-right font-semibold tabular-nums"
                        >
                          {r.soTiet.toLocaleString("vi-VN")}
                        </td>,
                        <td
                          key="gio"
                          className="px-2 py-2 text-right tabular-nums"
                        >
                          {soGio(r.phutChuanDay)}
                        </td>,
                      ]
                    : []),
                  ...(g.ten.startsWith("Trực")
                    ? [
                        <td
                          key="dv"
                          className="px-2 py-2 text-right font-semibold tabular-nums"
                        >
                          {r.donViTruc.toLocaleString("vi-VN")}
                        </td>,
                        <td
                          key="gc"
                          className="px-2 py-2 text-right tabular-nums"
                        >
                          {soGio(r.phutCoMatTruc)}
                        </td>,
                      ]
                    : []),
                ])}
                <td className="border-l border-border px-2 py-2 text-right tabular-nums">
                  {r.tienDeXuat ? (
                    <Link
                      className="text-primary underline-offset-2 hover:underline"
                      href={hrefWith(BASE, {
                        ...giu,
                        nguoi: r.userId,
                        chiSo: "deXuat",
                      })}
                    >
                      {tien(r.tienDeXuat)}
                    </Link>
                  ) : (
                    "0đ"
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {r.tienDaXacNhan ? (
                    <Link
                      className="text-primary underline-offset-2 hover:underline"
                      href={hrefWith(BASE, {
                        ...giu,
                        nguoi: r.userId,
                        chiSo: "daXacNhanTru",
                      })}
                    >
                      {tien(r.tienDaXacNhan)}
                    </Link>
                  ) : (
                    "0đ"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PhanTrangBang>
    </div>
  );
}

/** Danh sách chi tiết của MỘT ô — đúng các khoá trong `r.ds[chiSo]` (tổng = chi tiết). */
function ChiTiet({
  bc,
  r,
  chiSo,
  ten,
  dong,
}: {
  bc: BaoCaoThang;
  r: DongTongHop;
  chiSo: ChiSo;
  ten: (id: string | null) => string;
  dong: string;
}) {
  const khoa = new Set(r.ds[chiSo]);
  const day = bc.day.filter((x) => khoa.has(x.dong.bc.assignmentId));
  const truc = bc.truc.filter((t) => khoa.has(t.dutyId));
  const khoan = bc.day.flatMap((x) =>
    x.dieuChinh.filter((a) => khoa.has(a.id)).map((a) => ({ a, x })),
  );
  // Đơn vị / khoản mồ côi (phân công đã bị thay / huỷ): không có dòng đối soát nào để in kèm — in riêng, KHÔNG để mất.
  const moCoi = bc.moCoi.filter((w) => khoa.has(w.assignmentId ?? w.id));
  const khoanMoCoi = bc.khoanMoCoi.filter((a) => khoa.has(a.id));
  return (
    <section
      aria-labelledby="chi-tiet"
      className="mt-4 rounded-lg border border-primary/40 bg-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 id="chi-tiet" className="text-sm font-semibold text-foreground">
          {ten(r.userId)} · {NHAN_CHI_SO[chiSo]} ·{" "}
          <span className="tabular-nums">{khoa.size}</span> dòng
        </h2>
        <Link
          href={dong}
          className="text-sm text-primary underline-offset-2 hover:underline"
        >
          Đóng
        </Link>
      </header>
      <ul className="divide-y divide-border">
        {day.map((x) => {
          const d = x.dong;
          const n = nhanBangChung(d.bc);
          return (
            <li
              key={d.bc.assignmentId}
              className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]"
            >
              <span className="tabular-nums text-muted-foreground">
                {dm(d.bc.workDate)} ·{" "}
                {gio(
                  d.bc.requiredTo && d.ungVien.thoiLuongDayPhut != null
                    ? new Date(
                        d.bc.requiredTo.getTime() -
                          d.ungVien.thoiLuongDayPhut * 60_000,
                      )
                    : null,
                )}
                –{gio(d.bc.requiredTo)}
              </span>
              <span className="min-w-0">
                <b className="text-foreground">
                  {bc.nhanBuoi[`${d.bc.sourceType}:${d.bc.sourceId}`] ??
                    d.bc.sourceType}
                </b>{" "}
                · {NHAN_VAI[d.bc.role]}
                {x.assignmentType === "SUBSTITUTE" ? " · dạy thay" : ""}
                {d.bc.activity === "MAKEUP"
                  ? " · học bù"
                  : d.bc.activity === "ADVANCE"
                    ? " · học vượt"
                    : ""}
                {x.sourceWorkRequestId ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · đơn #{x.sourceWorkRequestId.slice(-6)}
                  </span>
                ) : null}
                <span className="block text-muted-foreground">
                  Người đứng lớp: {ten(d.bc.dongDoi.nguoiDayId)} · Xếp loại:{" "}
                  {NHAN_LOP[d.ungVien.lop]}
                  {d.ungVien.lyDo.length
                    ? ` (${d.ungVien.lyDo.join(", ")})`
                    : ""}
                </span>
              </span>
              <span className="min-w-0 text-muted-foreground">
                Chấm công:{" "}
                <span className="text-foreground">{n?.nhan ?? "—"}</span>
                {x.nhanXet ? (
                  <>
                    {" "}
                    · Nhận xét:{" "}
                    <span className="text-foreground">
                      {NHAN_NX[x.nhanXet.trangThai]}
                    </span>{" "}
                    ({x.nhanXet.daCo}/{x.nhanXet.canCo})
                  </>
                ) : null}
                <span className="block">
                  Đơn vị:{" "}
                  {d.donVi ? (
                    <span className="text-foreground">
                      {d.donVi.quantity} ×{" "}
                      {d.donVi.rateSnapshot.toLocaleString("vi-VN")}đ ·{" "}
                      {d.donVi.hieuLuc === "CONFIRMED"
                        ? "hiệu lực"
                        : d.donVi.hieuLuc === "STALE"
                          ? "cũ — xác nhận lại"
                          : "đã huỷ"}
                    </span>
                  ) : (
                    "chưa có"
                  )}
                  {x.dieuChinh.map((a) => (
                    <span key={a.id} className="ml-1">
                      · {tien(a.amount)} {NHAN_TT[a.status]}
                    </span>
                  ))}
                </span>
              </span>
            </li>
          );
        })}
        {truc.map((t) => (
          <li
            key={t.dutyId}
            className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]"
          >
            <span className="tabular-nums text-muted-foreground">
              {dm(t.ngay)} · ca {t.shiftCode}
            </span>
            <span>
              Trực{" "}
              {t.danhGia.khung
                ? `${t.danhGia.khung.tu}–${t.danhGia.khung.den}`
                : ""}{" "}
              · {t.danhGia.soTietTrongCa} tiết trong ca · đơn vị{" "}
              {t.danhGia.donViTra ?? "chưa tính"}
            </span>
            <span className="text-muted-foreground">
              Có mặt {soGio(t.danhGia.phutCoMatTrongCa)} giờ ·{" "}
              {NHAN_LOP[t.danhGia.lop]}
              {t.danhGia.lyDo.length ? ` (${t.danhGia.lyDo.join(", ")})` : ""}
            </span>
          </li>
        ))}
        {khoan.map(({ a, x }) => (
          <li
            key={a.id}
            className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]"
          >
            <span className="tabular-nums text-muted-foreground">
              {dm(x.dong.bc.workDate)}
            </span>
            <span>
              <b className="tabular-nums text-foreground">{tien(a.amount)}</b> ·{" "}
              {a.ruleCode} ·{" "}
              {bc.nhanBuoi[`${x.dong.bc.sourceType}:${x.dong.bc.sourceId}`] ??
                ""}
            </span>
            <span className="text-muted-foreground">
              {NHAN_TT[a.status]}
              {a.decisionReason ? ` — ${a.decisionReason}` : ""}
            </span>
          </li>
        ))}
      {moCoi.map((w) => (
          <li key={w.id} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]">
            <span className="text-muted-foreground">Phân công đã bị thay / huỷ</span>
            <span>
              Đơn vị {w.workUnitType === "ASSISTANT_TEACHING" ? "trợ giảng" : "đứng chính"} · {w.quantity} tiết
            </span>
            <span className="text-muted-foreground">{w.hieuLuc === "STALE" ? "cũ — xác nhận lại hoặc từ chối" : "kỳ đã khoá"}</span>
          </li>
        ))}
        {khoanMoCoi.map((a) => (
          <li key={a.id} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]">
            <span className="text-muted-foreground">Phân công đã bị thay / huỷ</span>
            <span>
              <b className="tabular-nums text-foreground">{tien(a.amount)}</b>
            </span>
            <span className="text-muted-foreground">{NHAN_TT[a.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DoiSoat({
  bc,
  coSo,
  cong,
  coAssign,
  coApprove,
  tuDong,
  ten,
  ca,
  homNay,
  nguoi,
}: {
  bc: BaoCaoThang;
  coSo: string;
  /** Ba công tắc độc lập tại cơ sở này (đã gộp RBAC v2). */
  cong: { bong: boolean; phanCong: boolean; tien: boolean };
  coAssign: boolean;
  coApprove: boolean;
  /** GĐ6 — kỳ luật công mới: KHÔNG xác nhận tay (máy chủ `kiemXacNhan` cũng từ chối) ⇒ không vẽ nút nào ở đây (luật 12). */
  tuDong: boolean;
  ten: (id: string | null) => string;
  ca: { ma: string; tu: string; den: string }[];
  homNay: string;
  nguoi: { id: string; ten: string }[];
}) {
  const lam = cong.bong && coAssign && !tuDong;
  const chuaQuyet = bc.day.filter(
    (x) =>
      x.dong.donVi?.hieuLuc !== "CONFIRMED" &&
      x.dong.xacNhan?.decision !== "REJECTED" &&
      (x.dong.ungVien.lop === "TU_DONG" ||
        x.dong.ungVien.lop === "XEM_TAY" ||
        x.dong.ungVien.lop === "CHAN"),
  );
  const sach = chuaQuyet.filter((x) => x.dong.ungVien.lop === "TU_DONG");
  const khac = chuaQuyet.filter((x) => x.dong.ungVien.lop !== "TU_DONG");
  const trucChua = bc.truc.filter(
    (t) =>
      t.danhGia.lop !== "KHONG_AP_DUNG" &&
      t.donVi?.hieuLuc !== "CONFIRMED" &&
      !(t.xacNhan?.decision === "CONFIRMED" && t.danhGia.donViTra === "0"),
  );
  const deXuat = bc.day.flatMap((x) =>
    x.dieuChinh.filter((a) => a.status === "PROPOSED").map((a) => ({ a, x })),
  );
  const lyDoKhoa = tuDong
    ? "Kỳ này tính công tự động theo lượt quét — không xác nhận tay; công ghi cứng lúc chốt kỳ (xem “Tổng hợp tự động” và “Phản ánh chờ duyệt”)."
    : !cong.bong
    ? "Đối soát Parttime chưa bật ở cơ sở này."
    : !coAssign
      ? "Bạn không có quyền phân công ở cơ sở này."
      : null;
  const the = "rounded-lg border border-border bg-card";
  return (
    <div className="space-y-4">
      {lyDoKhoa && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Chỉ xem: {lyDoKhoa}
        </p>
      )}

      {bc.chuaDanhDauCu > 0 && (
        <div role="note" className="flex flex-col gap-2 rounded-lg border border-state-warning-ink/30 bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink sm:flex-row sm:items-center sm:justify-between">
          <p>
            <b className="tabular-nums">{bc.chuaDanhDauCu}</b> đơn vị đã xác nhận nay <b>lệch</b> với dữ liệu hiện tại (lịch / chấm công / người
            đứng lớp đổi). Báo cáo đã coi là cũ; bấm để ghi lại trạng thái và rút khoản trừ đề xuất đi kèm.
          </p>
          {lam && <NutQuyet nhan="Đánh dấu cần xác nhận lại" lenh={{ loai: "danhDauCu", centerId: coSo, tu: bc.tu, den: bc.den }} />}
        </div>
      )}

      <section aria-labelledby="ds-day" className={the}>
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 id="ds-day" className="text-sm font-semibold">
            Tiết dạy chờ xác nhận ·{" "}
            <span className="tabular-nums">{chuaQuyet.length}</span>
          </h2>
          {lam && sach.length > 0 && (
            <NutQuyet
              bien="default"
              nhan={`Xác nhận ${sach.length} dòng sạch`}
              lenh={{
                loai: "hangLoat",
                muc: sach.map((x) => ({
                  assignmentId: x.dong.bc.assignmentId,
                  phienBanDaXem: x.dong.bc.assignmentVersion,
                  dauVanDaXem: x.dong.bc.dauVan,
                })),
              }}
            />
          )}
        </header>
        {chuaQuyet.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            Không còn tiết nào chờ xác nhận.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {[...khac, ...sach].map((x) => {
              const d = x.dong;
              const base = {
                assignmentId: d.bc.assignmentId,
                phienBanDaXem: d.bc.assignmentVersion,
                dauVanDaXem: d.bc.dauVan,
              };
              return (
                <li
                  key={d.bc.assignmentId}
                  className="flex flex-col gap-2 px-4 py-3 text-sm lg:flex-row lg:items-start lg:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-foreground">
                      <b>{ten(d.bc.userId)}</b> · {NHAN_VAI[d.bc.role]} ·{" "}
                      <span className="tabular-nums">{dm(d.bc.workDate)}</span>{" "}
                      ·{" "}
                      {bc.nhanBuoi[`${d.bc.sourceType}:${d.bc.sourceId}`] ??
                        d.bc.sourceType}
                    </p>
                    <p className="text-muted-foreground">
                      <span
                        className={
                          d.ungVien.lop === "TU_DONG"
                            ? "text-state-success-ink"
                            : d.ungVien.lop === "CHAN"
                              ? "text-state-danger-ink"
                              : "text-state-warning-ink"
                        }
                      >
                        {NHAN_LOP[d.ungVien.lop]}
                      </span>
                      {d.ungVien.lyDo.length
                        ? ` — ${d.ungVien.lyDo.join(", ")}`
                        : ""}{" "}
                      · Chấm công: {nhanBangChung(d.bc)?.nhan ?? "—"}
                      {d.xacNhan?.decision === "NEEDS_INFO"
                        ? ` · Đang chờ bổ sung: ${d.xacNhan.reason ?? ""}`
                        : ""}
                    </p>
                  </div>
                  {lam && (
                    <div className="flex flex-wrap items-start gap-2">
                      {d.ungVien.lop !== "CHAN" && (
                        <NutQuyet
                          nhan="Xác nhận"
                          canLyDo={d.ungVien.lop === "XEM_TAY"}
                          bien="default"
                          lenh={{
                            loai: "day",
                            ...base,
                            quyetDinh: "CONFIRMED",
                          }}
                        />
                      )}
                      <NutQuyet
                        nhan="Cần bổ sung"
                        canLyDo
                        lenh={{ loai: "day", ...base, quyetDinh: "NEEDS_INFO" }}
                      />
                      <NutQuyet
                        nhan="Không thực hiện"
                        canLyDo
                        bien="destructive"
                        lenh={{ loai: "day", ...base, quyetDinh: "REJECTED" }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="ds-truc" className={the}>
        <header className="border-b border-border px-4 py-3">
          <h2 id="ds-truc" className="text-sm font-semibold">
            Trực vận hành ·{" "}
            <span className="tabular-nums">{bc.truc.length}</span> ca được giao
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Chỉ ca được giao mới có công trực — có ô ca hay có mặt mà không được
            giao thì không tính.
          </p>
        </header>
        {cong.phanCong && coAssign && ca.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <GiaoTruc
              centerId={coSo}
              nguoi={nguoi}
              ca={ca}
              macDinhNgay={homNay}
            />
          </div>
        )}
        {trucChua.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            Không có ca trực nào chờ xác nhận.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {trucChua.map((t) => {
              const base = {
                dutyId: t.dutyId,
                phienBanDaXem: t.phienBan,
                dauVanDaXem: t.dauVan,
              };
              return (
                <li
                  key={t.dutyId}
                  className="flex flex-col gap-2 px-4 py-3 text-sm lg:flex-row lg:items-start lg:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-foreground">
                      <b>{ten(t.userId)}</b> · ca {t.shiftCode} ·{" "}
                      <span className="tabular-nums">{dm(t.ngay)}</span> ·{" "}
                      {t.danhGia.soTietTrongCa} tiết trong ca ⇒ đơn vị{" "}
                      {t.danhGia.donViTra ?? "chưa tính"}
                    </p>
                    <p className="text-muted-foreground">
                      {NHAN_LOP[t.danhGia.lop]}
                      {t.danhGia.lyDo.length
                        ? ` — ${t.danhGia.lyDo.join(", ")}`
                        : ""}{" "}
                      · có mặt {soGio(t.danhGia.phutCoMatTrongCa)} giờ · trạng
                      thái giao: {t.status}
                    </p>
                  </div>
                  {lam && t.danhGia.lop !== "CHO" && (
                    <div className="flex flex-wrap items-start gap-2">
                      {t.danhGia.lop !== "CHAN" && (
                        <NutQuyet
                          nhan="Xác nhận"
                          canLyDo={t.danhGia.lop === "XEM_TAY"}
                          bien="default"
                          lenh={{
                            loai: "truc",
                            ...base,
                            quyetDinh: "CONFIRMED",
                          }}
                        />
                      )}
                      <NutQuyet
                        nhan="Không thực hiện"
                        canLyDo
                        bien="destructive"
                        lenh={{ loai: "truc", ...base, quyetDinh: "REJECTED" }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="ds-tru" className={the}>
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 id="ds-tru" className="text-sm font-semibold">
              Khoản trừ đề xuất ·{" "}
              <span className="tabular-nums">{deXuat.length}</span>
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Bản nháp của Ban lãnh đạo, chưa ký. Chỉ quản lý cơ sở quyết; không
              ai quyết khoản của chính mình.
            </p>
          </div>
          {lam && (
            <NutQuyet
              nhan="Dựng / cập nhật đề xuất"
              lenh={{ loai: "dongBo", centerId: coSo, tu: bc.tu, den: bc.den }}
            />
          )}
        </header>
        {deXuat.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            Không có khoản trừ nào đang đề xuất.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {deXuat.map(({ a, x }) => (
              <li
                key={a.id}
                className="flex flex-col gap-2 px-4 py-3 text-sm lg:flex-row lg:items-start lg:justify-between"
              >
                <p className="min-w-0 text-foreground">
                  <b>{ten(x.dong.bc.userId)}</b> ·{" "}
                  <span className="tabular-nums">{dm(x.dong.bc.workDate)}</span>{" "}
                  · <b className="tabular-nums">{tien(a.amount)}</b> ·{" "}
                  {a.ruleCode}
                </p>
                {cong.tien && coApprove ? (
                  <div className="flex flex-wrap items-start gap-2">
                    <NutQuyet
                      nhan="Xác nhận trừ"
                      bien="default"
                      lenh={{ loai: "dieuChinh", id: a.id, quyet: "CONFIRMED" }}
                    />
                    <NutQuyet
                      nhan="Không áp"
                      canLyDo
                      lenh={{ loai: "dieuChinh", id: a.id, quyet: "REJECTED" }}
                    />
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {cong.tien
                      ? "Chỉ quản lý cơ sở (quyền duyệt chấm công) quyết khoản trừ."
                      : "Công tắc tiền chưa bật ở cơ sở này — khoản chỉ là đề xuất."}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
