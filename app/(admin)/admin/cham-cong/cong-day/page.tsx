// app/(admin)/admin/cham-cong/cong-day/page.tsx — CÔNG DẠY của giáo viên trong kỳ.
//
// Yêu cầu chủ dự án 06/09: "thêm module tính giờ dạy của giáo viên… vẫn phải dev thêm các mục
// linh hoạt công dạy khác để dự phòng BLĐ yêu cầu có công dạy cho trial, bù, vượt… tự tạo tự
// add được qua hệ thống chứ không cần code. Làm là 1 tab bên trong phần chấm công."
//
// ⚠️ HAI ĐIỀU PHẢI BIẾT TRƯỚC KHI SỬA:
//
// 1. Màn này KHÔNG đụng tới tiền. Hệ thống chưa có module lương, và hoa hồng giáo viên dạy
//    trải nghiệm đã có đường RIÊNG tính theo % học phí (`lib/crm/trial-teacher-commission.ts`).
//    Công dạy ở đây đếm theo buổi/giờ — gộp hai thứ đó là trả hai lần cho cùng một buổi.
//
// 2. Buổi ở đây hỏi theo NGƯỜI, không theo cơ sở của lớp. Cột "Dạy" ở màn Kỳ công đếm bằng
//    `class: { centerId }`, nên giáo viên neo CS1 đi dạy lớp CS2 thì buổi đó BIẾN MẤT khỏi cả
//    hai kỳ. Hai màn có thể lệch nhau đúng ở những buổi như vậy — và số ở đây mới là số đủ.
//
// 3. (12/10/2026 — "Công dạy giáo viên") Bấm một dòng ⇒ chi tiết TỪNG BUỔI của người đó trong tháng
//    (`?gv=`). Mọi con số ở cả hai chế độ đi qua `lib/cham-cong/cong-day-chi-tiet.ts`, vốn chỉ gọi lại
//    `chiTietCongDay`/`congDayCuaNguoi` — KHÔNG có công thức thứ hai. `?gv=` chỉ nhận người thuộc
//    khối đang xem; buổi ở cơ sở ngoài phạm vi vẫn có công nhưng bị CHE lớp/phòng/người.
//    ⚠️ Kỳ công (`buildPeriodSummary`) KHÔNG lưu công dạy — bản chốt chỉ có số buổi lớp theo cơ sở của
//    lớp + số buổi bù. Màn này vì vậy luôn in dữ liệu HIỆN TẠI, kể cả khi kỳ đã chốt, và nói rõ điều đó.
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, GraduationCap, Hourglass, Layers, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { ASK_WHO, loadModuleScope, periodStatusOf, type ModuleAction } from "@/lib/cham-cong/module-scope";
import { hrefWith, shiftKy } from "@/lib/cham-cong/scope-href";
import { currentPeriodKey, parsePeriodKey, periodRange } from "@/lib/cham-cong/period";
import { chiTietCongDay, congDayCuaNguoi, type BuoiDay } from "@/lib/cham-cong/cong-day";
import { loadBuoiDay, loadLoaiCongDay } from "@/lib/cham-cong/cong-day-db";
import {
  chiTietGiaoVien,
  docBoLoc,
  gvHopLe,
  khopBoLoc,
  tongHopGiaoVien,
  type BoLoc,
} from "@/lib/cham-cong/cong-day-chi-tiet";
import { HO_CENTER_ID } from "@/lib/cham-cong/home-center";
import { CanhBaoDanhMuc } from "@/components/admin/cham-cong/canh-bao-danh-muc";
import { checkPermission } from "@/lib/auth/check-permission";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { BTN_OUTLINE } from "@/components/admin/cham-cong/classes";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { KpiStrip } from "@/components/admin/cham-cong/kpi-strip";
import { SectionCard } from "@/components/admin/cham-cong/section-card";
import { LoaiCongDayTable, type LoaiRow, type PhanLoaiChon } from "./_components/loai-cong-day";
import { CongDayTable, type CongDayRow, type CotSapXep } from "./_components/cong-day-table";
import { ChiTietGiaoVienTable } from "./_components/chi-tiet-giao-vien";

export const metadata = { title: "Công dạy giáo viên | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const VIEW: ModuleAction = "hr_attendance:view";
const BASE = "/cham-cong/cong-day";

function kyLabelOf(ky: string): string {
  const p = parsePeriodKey(ky);
  return p ? `${String(p.m).padStart(2, "0")}/${p.y}` : ky;
}

/** "1,5" — dấu phẩy thập phân, bỏ đuôi ",0". */
function so(n: number): string {
  return (Math.round(n * 100) / 100).toString().replace(".", ",");
}

/** "115,5 giờ" — gọn cho thẻ KPI (thẻ hẹp, "115 giờ 30 phút" bị cắt). */
function gioGon(phut: number): string {
  return `${so(phut / 60)} giờ`;
}

/** "42 giờ" / "42 giờ 30 phút" / "90 phút". */
function gio(phut: number): string {
  if (phut <= 0) return "0";
  const h = Math.floor(phut / 60);
  const m = phut % 60;
  if (h === 0) return `${m} phút`;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

const COT_SAP_XEP: readonly CotSapXep[] = ["ten", "buoi", "gio", "kt"];

/** Buổi còn lại sau bộ lọc — lọc trên DÒNG ĐÃ QUY ĐỔI rồi trả về buổi gốc, để mọi tổng sau đó gọi lại
 *  đúng hàm quy đổi trên đúng tập buổi đang hiện. */
function buoiSauLoc(ds: readonly BuoiDay[], danhMuc: Parameters<typeof chiTietCongDay>[1], loc: BoLoc): BuoiDay[] {
  if (!loc.loai && !loc.trangThai) return [...ds];
  return chiTietCongDay(ds, danhMuc)
    .filter((d) => khopBoLoc(d, loc))
    .map((d) => d.buoi);
}

export default async function CongDayPage({
  searchParams,
}: {
  searchParams: Promise<{ ky?: string; coSo?: string; gv?: string; loai?: string; tt?: string; sx?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fcong-day");
  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  const ky = sp.ky && parsePeriodKey(sp.ky) ? sp.ky : currentPeriodKey();
  const kyLabel = kyLabelOf(ky);

  const visible = scope.blocksWith(VIEW);
  if (visible.length === 0) {
    return (
      <div className="max-w-6xl">
        <PageHeader title={`Công dạy tháng ${kyLabel}`} />
        <ModuleNav active="congday" scope={scope} ctx={{ ky, coSo: sp.coSo ?? null }} />
        <NoPermission permission={VIEW} what="công dạy giáo viên" askWho={ASK_WHO[VIEW]} />
      </div>
    );
  }

  const block = scope.pick(sp.coSo, VIEW) ?? visible[0];
  const coSo = block.id;
  const ctx = { ky, coSo };
  const { from, to } = periodRange(ky);

  const sdb = scopedDb(await resolveActor(session.user.id));
  // Người của khối này trong kỳ = HỢP của hai tập, không phải chỉ một:
  //
  //  (a) người có ô lưới ở khối này — lấy từ lưới chứ không từ bảng công ngày, vì ngày tương lai
  //      chưa có dòng công nào mà lịch dạy thì đã xếp;
  //  (b) người THỰC DẠY buổi của lớp thuộc cơ sở này trong kỳ.
  //
  // Thiếu (b) là lặp lại đúng lỗi màn này sinh ra để vá: giáo viên dạy thật nhưng chưa được xếp
  // lưới tháng đó (thỉnh giảng, mới vào, quên xếp) không có dòng nào ở BẤT KỲ cơ sở nào ⇒ buổi
  // biến mất — trong khi phần trợ giúp ngay dưới đang hứa "buổi luôn về đúng người, dù dạy ở đâu".
  const [oLuoi, buoiCuaCoSo] = await Promise.all([
    sdb.shiftAssignment.findMany({
      where: { centerId: coSo, workDate: { gte: from, lte: to }, status: "ACTIVE" },
      select: { userId: true },
      distinct: ["userId"],
    }),
    sdb.classSession.findMany({
      where: { status: "COMPLETED", date: { gte: from, lt: new Date(to.getTime() + 86_400_000) }, class: { centerId: coSo } },
      select: { actualTeacherId: true, substituteTeacherId: true, class: { select: { teacherId: true, assistantId: true } } },
    }),
  ]);
  const userIds = [
    ...new Set([
      ...oLuoi.map((n) => n.userId),
      ...buoiCuaCoSo.flatMap((s) =>
        [s.actualTeacherId, s.substituteTeacherId, s.class?.teacherId, s.class?.assistantId].filter(
          (x): x is string => typeof x === "string",
        ),
      ),
    ]),
  ];

  // Người của khối = tập DUY NHẤT mà `?gv=` được phép trỏ vào (dựng bằng `scopedDb` ở trên).
  const nguoiCuaKhoi = new Set(userIds);
  const gv = gvHopLe(sp.gv, nguoiCuaKhoi);

  const [danhMuc, buoi, users, canConfig, phanLoai, period] = await Promise.all([
    loadLoaiCongDay(),
    loadBuoiDay(userIds, from, to),
    userIds.length
      ? sdb.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, employee: { select: { employeeCode: true } } },
        })
      : Promise.resolve([]),
    checkPermission("hr_attendance:config", { centerId: HO_CENTER_ID }),
    // Chỉ phân loại ĐANG DÙNG mới vào ô chọn khi thêm dòng — thêm dòng trỏ vào phân loại đã tắt
    // là tạo ra một dòng không bao giờ nhận được buổi nào.
    sdb.sessionCategory.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
      select: { code: true, name: true },
    }),
    periodStatusOf(sdb, coSo, ky),
  ]);
  const tenCua = new Map(users.map((u) => [u.id, { ten: u.name ?? u.email ?? u.id, ma: u.employee?.employeeCode ?? null }]));
  const loc = docBoLoc(sp, danhMuc.map((l) => l.code));
  const sapXep: CotSapXep = COT_SAP_XEP.includes(sp.sx as CotSapXep) ? (sp.sx as CotSapXep) : "ten";
  // Cơ sở người xem đọc được chi tiết — buổi ở cơ sở khác vẫn có công nhưng bị che lớp/phòng/người.
  const coSoXemDuoc = new Set(visible.map((b) => b.id));
  const tenCoSo = Object.fromEntries(scope.blocks.map((b) => [b.id, b.code]));

  const buoiCua = new Map<string, BuoiDay[]>();
  for (const b of buoi) {
    const ds = buoiCua.get(b.userId) ?? [];
    ds.push(b);
    buoiCua.set(b.userId, ds);
  }

  // Tham số lọc giữ khi đi giữa tổng hợp ↔ chi tiết ↔ sắp xếp.
  const giuLoc = { ky, coSo, loai: loc.loai, tt: loc.trangThai };

  const rows: CongDayRow[] = userIds
    .map((userId) => {
      const cuaNguoi = buoiSauLoc(buoiCua.get(userId) ?? [], danhMuc, loc);
      const t = tongHopGiaoVien(userId, cuaNguoi, danhMuc);
      const tachLoai = congDayCuaNguoi(cuaNguoi, danhMuc);
      const u = tenCua.get(userId);
      return {
        userId,
        name: u?.ten ?? userId,
        employeeCode: u?.ma ?? null,
        href: hrefWith(BASE, { ...giuLoc, gv: userId }),
        lopChinh: t.theoNhom.LOP_CHINH,
        dayThay: t.theoNhom.DAY_THAY,
        hocBu: t.theoNhom.HOC_BU,
        khac: t.theoNhom.KHAC,
        tongBuoi: t.tongBuoi,
        buoiChiTheoDoi: t.buoiChiTheoDoi,
        tongPhut: t.tongPhut,
        tongGioLabel: gio(t.tongPhut),
        tongCong: t.tongCong,
        tongCongLabel: so(t.tongCong),
        canKiemTra: t.canKiemTra,
        soDong: cuaNguoi.length,
        dong: tachLoai.dong.map((d) => ({
          code: d.code,
          name: d.name,
          buoi: d.buoi,
          congLabel: so(d.cong),
          tinhVaoKy: d.tinhVaoKy,
          boQuaThieuGio: d.boQuaThieuGio,
        })),
      };
    })
    // Người không có buổi nào (sau lọc) thì không phải dòng của bảng này — họ đã có mặt ở Kỳ công.
    // Đếm theo DÒNG chi tiết chứ không theo buổi có công: buổi rơi khỏi công vì không khớp loại vẫn
    // phải thấy được, kẻo đúng chỗ cần kiểm tra lại biến mất.
    .filter((r) => r.soDong > 0)
    .sort((a, b) => {
      const ten = a.name.localeCompare(b.name, "vi");
      if (sapXep === "buoi") return b.tongBuoi - a.tongBuoi || ten;
      if (sapXep === "gio") return b.tongPhut - a.tongPhut || ten;
      if (sapXep === "kt") return b.canKiemTra - a.canKiemTra || ten;
      return ten;
    });

  const buoiTheoLoai = new Map<string, number>();
  for (const r of rows) for (const d of r.dong) buoiTheoLoai.set(d.code, (buoiTheoLoai.get(d.code) ?? 0) + d.buoi);

  const tenPhanLoai = new Map(phanLoai.map((c) => [c.code, c.name]));
  const loaiRows: LoaiRow[] = danhMuc.map((l) => ({
    code: l.code,
    name: l.name,
    source: l.source,
    role: l.role,
    basis: l.basis,
    factor: l.factor,
    countsInPeriod: l.countsInPeriod,
    isActive: l.isActive,
    categoryCode: l.categoryCode,
    // Phân loại đã TẮT không có trong `phanLoai` — vẫn phải in ra mã để dòng không hiện "mọi
    // phân loại", vì nó KHÔNG phải dòng bao sân.
    categoryName: l.categoryCode ? (tenPhanLoai.get(l.categoryCode) ?? l.categoryCode) : null,
    buoiTrongKy: buoiTheoLoai.get(l.code) ?? 0,
  }));
  const phanLoaiChon: PhanLoaiChon[] = phanLoai.map((c) => ({ code: c.code, name: c.name }));

  const tongCong = rows.reduce((s, r) => s + r.tongCong, 0);
  const tongBuoi = rows.reduce((s, r) => s + r.tongBuoi, 0);
  const tongPhut = rows.reduce((s, r) => s + r.tongPhut, 0);
  const chiTheoDoi = rows.reduce((s, r) => s + r.buoiChiTheoDoi, 0);
  const canKiemTra = rows.reduce((s, r) => s + r.canKiemTra, 0);
  const thieuGio = rows.reduce((s, r) => s + r.dong.reduce((x, d) => x + d.boQuaThieuGio, 0), 0);

  // ── Chi tiết một giáo viên ──
  const chiTiet = gv ? chiTietGiaoVien(buoiCua.get(gv) ?? [], danhMuc, loc, coSoXemDuoc) : null;
  // Tên người trong ô chi tiết (GV chính / GV thay / người đứng lớp) — chỉ id CHƯA bị che, qua `scopedDb`.
  const idNguoiChiTiet = chiTiet
    ? [
        ...new Set(
          chiTiet.ngays.flatMap((n) =>
            n.dongs.flatMap((d) => [d.gvChinhId, d.gvThayId, d.nguoiDayThucId].filter((x): x is string => !!x)),
          ),
        ),
      ]
    : [];
  const nguoiChiTiet = idNguoiChiTiet.length
    ? await sdb.user.findMany({ where: { id: { in: idNguoiChiTiet } }, select: { id: true, name: true, email: true } })
    : [];
  const tenNguoi = Object.fromEntries(nguoiChiTiet.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  const tachLoaiGv = gv ? congDayCuaNguoi(buoiCua.get(gv) ?? [], danhMuc) : null;

  const daChot = period.status === "LOCKED";
  const giaoVienChon = rows
    .map((r) => ({ id: r.userId, ten: r.name }))
    .sort((a, b) => a.ten.localeCompare(b.ten, "vi"));
  const coLoc = !!(loc.loai || loc.trangThai);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={`Công dạy giáo viên tháng ${kyLabel} — ${block.label}`}
        subtitle="Buổi đứng lớp đã hoàn tất, quy ra công theo hệ số của từng loại. Đây là số ĐẾM, không phải tiền — và khác Bảng công tháng (ngày làm việc)."
      />

      <ModuleNav active="congday" scope={scope} ctx={ctx} />

      {/* Màn này KHÔNG đi qua `ConfigTabs` nên phải render riêng — và nó là màn CẦN cảnh
          báo nhất: `TeachingCreditType` rỗng thì mọi con số ở đây ra 0 mà không báo gì
          (đo prod 09/09/2026, luật 15). Đây là chỗ thứ hai và CUỐI CÙNG; thêm nữa thì
          dùng `ConfigTabs`. */}
      <CanhBaoDanhMuc
        coSoVanHanhIds={scope
          .blocksWith("hr_attendance:config")
          .filter((b) => b.id !== HO_CENTER_ID)
          .map((b) => b.id)}
      />

      <ScopeBar
        basePath={BASE}
        blocks={visible.map((b) => ({ id: b.id, label: b.label }))}
        coSo={coSo}
        month={{
          ky,
          prevHref: hrefWith(BASE, { ...giuLoc, ky: shiftKy(ky, -1), gv }),
          nextHref: hrefWith(BASE, { ...giuLoc, ky: shiftKy(ky, 1), gv }),
        }}
        keep={{ ky }}
        period={{ ...period, href: hrefWith("/cham-cong/ky-cong", ctx) }}
      />

      {/* Kỳ đã chốt: bản chốt KHÔNG lưu công dạy (chỉ số buổi lớp + buổi bù) ⇒ không có "bản đã chốt"
          để in. Nói thẳng ra thay vì để người đọc tưởng đây là số đã khoá. */}
      <p
        className={
          daChot
            ? "mb-4 rounded-lg border border-state-warning-ink/30 bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink"
            : "mb-4 text-xs text-muted-foreground"
        }
      >
        {daChot ? (
          <>
            <b>Kỳ công đã chốt.</b> Bản chốt không lưu công dạy từng buổi — số dưới đây là <b>dữ liệu hiện tại</b>,
            có thể khác lúc chốt nếu buổi được sửa sau đó.
          </>
        ) : (
          <>
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">Dữ liệu tạm tính</span> — kỳ chưa
            chốt, số đổi theo buổi được hoàn tất / sửa.
          </>
        )}
      </p>

      {/* Bộ lọc — form GET thuần, không JS: giá trị lạ trên URL đã rơi về "tất cả" ở server. `key` theo bộ lọc
          hiện tại: `defaultValue` chỉ đọc lúc dựng, điều hướng phía client giữ nguyên ô chọn cũ nếu không dựng lại. */}
      <form key={`${gv ?? ""}|${loc.loai ?? ""}|${loc.trangThai ?? ""}|${ky}|${coSo}`} action={BASE} method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3 text-sm">
        <input type="hidden" name="ky" value={ky} />
        <input type="hidden" name="coSo" value={coSo} />
        {sapXep !== "ten" && <input type="hidden" name="sx" value={sapXep} />}
        <label className="flex min-w-[12rem] flex-col gap-1">
          <span className="text-xs text-muted-foreground">Giáo viên</span>
          <select name="gv" defaultValue={gv ?? ""} className="h-9 rounded-md border border-input bg-background px-2">
            <option value="">Tất cả giáo viên</option>
            {giaoVienChon.map((g) => (
              <option key={g.id} value={g.id}>
                {g.ten}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-col gap-1">
          <span className="text-xs text-muted-foreground">Loại công dạy</span>
          <select name="loai" defaultValue={loc.loai ?? ""} className="h-9 rounded-md border border-input bg-background px-2">
            <option value="">Tất cả</option>
            {danhMuc.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
                {l.isActive ? "" : " (đã tắt)"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-col gap-1">
          <span className="text-xs text-muted-foreground">Trạng thái</span>
          <select name="tt" defaultValue={loc.trangThai ?? ""} className="h-9 rounded-md border border-input bg-background px-2">
            <option value="">Tất cả</option>
            <option value="TINH">Được tính công</option>
            <option value="KHONG_TINH">Không tính công</option>
            <option value="CAN_KIEM_TRA">Cần kiểm tra</option>
          </select>
        </label>
        <button type="submit" className={BTN_OUTLINE}>
          Lọc
        </button>
        {(coLoc || gv) && (
          <Link href={hrefWith(BASE, { ky, coSo })} className="h-9 px-2 leading-9 text-xs text-primary hover:underline">
            Bỏ lọc
          </Link>
        )}
      </form>

      {gv && chiTiet ? (
        <>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">
              {tenCua.get(gv)?.ten ?? gv}
              {tenCua.get(gv)?.ma && <span className="ml-2 font-mono text-xs text-muted-foreground">{tenCua.get(gv)?.ma}</span>}
            </h2>
            <Link href={hrefWith(BASE, { ...giuLoc, sx: sapXep === "ten" ? null : sapXep })} className="text-sm text-primary hover:underline">
              ← Tất cả giáo viên
            </Link>
          </div>
          {tachLoaiGv && tachLoaiGv.dong.length > 0 && (
            <p className="mb-3 text-xs text-muted-foreground">
              Cả tháng (không lọc):{" "}
              {tachLoaiGv.dong
                .map((d) => `${d.name} ${d.buoi} buổi → ${so(d.cong)}${d.tinhVaoKy ? "" : " (chỉ theo dõi)"}`)
                .join(" · ")}{" "}
              · <b className="text-foreground">Công dạy {so(tachLoaiGv.tongCong)}</b>
            </p>
          )}
          {chiTiet.soDong === 0 ? (
            <EmptyState
              title="Không có buổi nào khớp bộ lọc"
              description="Đổi loại / trạng thái, hoặc bỏ lọc để xem cả tháng."
            />
          ) : (
            <ChiTietGiaoVienTable ngays={chiTiet.ngays} tong={chiTiet.tong} tenNguoi={tenNguoi} tenCoSo={tenCoSo} />
          )}
        </>
      ) : (
        <>
          <PageHelp guideSlug="nhan-su-giao-vien">
            <p>
              Bấm vào tên một giáo viên để xem <b>từng buổi</b> trong tháng: giờ, lớp, loại công, hệ số, có tính công
              hay không và vì sao. Dòng tô vàng là <b>Cần kiểm tra</b> — hệ thống chỉ đánh dấu, không tự sửa.
            </p>
            <p className="mt-2">
              Muốn tính công cho một nhóm buổi (trải nghiệm, trợ giảng…) thì <b>bật dòng đó</b> ở bảng “Hệ số đang
              dùng” bên dưới và đặt hệ số — không cần lập trình viên. Đổi xong bảng trên tính lại ngay theo số mới.
            </p>
            <p className="mt-2">
              Số ở đây <em>khác</em> cột <b>Buổi ở cơ sở</b> bên màn Kỳ công, và khác là <b>ĐÚNG</b>. Cột đó đếm buổi
              của những lớp <b>thuộc cơ sở đang xem</b>; màn này hỏi theo <b>người</b> nên buổi luôn về đúng người, dù
              họ dạy ở cơ sở nào. Giáo viên dạy chéo cơ sở là chỗ hai số tách nhau — đừng sửa cho khớp. Buổi ở cơ sở
              bạn không quản lý vẫn được tính công nhưng <b>không hiện tên lớp</b>.
            </p>
            <p className="mt-2">
              <b>Dạy bù và vượt giờ:</b> nay khai được ở tab <b>Cấu hình → Phân loại buổi</b>, nhưng chỉ ra số khi buổi
              đã <em>được gán</em> phân loại ở form sửa buổi. Riêng “vượt giờ” vẫn chưa đo được: giờ dạy thực tế gần như
              luôn để trống nên không biết buổi nào vượt.
            </p>
          </PageHelp>

          <KpiStrip
            cols={5}
            items={[
              { icon: Users, label: "Giáo viên", value: rows.length },
              // "Tổng buổi" — KHÔNG phải "buổi có công": gồm cả buổi của loại "chỉ theo dõi" (không góp vào công).
              {
                icon: Layers,
                label: "Tổng buổi",
                value: tongBuoi,
                hint: chiTheoDoi ? `${chiTheoDoi} buổi chỉ theo dõi · kể cả dạy chéo cơ sở` : "kể cả dạy chéo cơ sở",
              },
              { icon: Hourglass, label: "Tổng giờ dạy", value: gioGon(tongPhut) },
              { icon: GraduationCap, label: "Tổng công dạy", value: so(tongCong), hint: "đã nhân hệ số" },
              {
                icon: AlertTriangle,
                label: "Cần kiểm tra",
                value: canKiemTra,
                tone: canKiemTra ? "warning" : "brand",
                hint: thieuGio ? `${thieuGio} buổi thiếu giờ` : undefined,
              },
            ]}
          />

          {rows.length === 0 ? (
            <EmptyState
              title={
                coLoc
                  ? "Không có buổi nào khớp bộ lọc"
                  : `Chưa có buổi dạy nào trong ${block.label} kỳ tháng ${kyLabel}`
              }
              description="Chỉ buổi đã HOÀN TẤT (và case bù đã dạy) mới vào đây. Buổi đã dạy mà chưa bấm hoàn tất thì chưa tính công."
              action={
                <Link href={hrefWith("/cham-cong/ky-cong", ctx)} className={BTN_OUTLINE}>
                  Sang màn Kỳ công
                </Link>
              }
            />
          ) : (
            <CongDayTable
              rows={rows}
              sapXep={sapXep}
              hrefSapXep={{
                ten: hrefWith(BASE, giuLoc),
                buoi: hrefWith(BASE, { ...giuLoc, sx: "buoi" }),
                gio: hrefWith(BASE, { ...giuLoc, sx: "gio" }),
                kt: hrefWith(BASE, { ...giuLoc, sx: "kt" }),
              }}
            />
          )}

          <div className="mt-5">
            <SectionCard title="Hệ số đang dùng" icon={Layers}>
              <p className="mb-3 text-sm text-muted-foreground">
                {canConfig
                  ? "Sửa hệ số hoặc bỏ “Cộng vào kỳ” là số ở bảng trên đổi theo ngay. Tắt “Đang dùng” thì cả nhóm buổi đó KHÔNG còn công — vẫn liệt kê ở chi tiết, ghi “Loại đang tắt”."
                  : "Sửa hệ số cần quyền cấu hình tại Hội sở — danh mục này dùng chung mọi cơ sở."}
              </p>
              <LoaiCongDayTable rows={loaiRows} phanLoai={phanLoaiChon} canEdit={canConfig} />
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
