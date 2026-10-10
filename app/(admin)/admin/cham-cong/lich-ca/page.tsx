// app/(admin)/admin/cham-cong/lich-ca/page.tsx — LỊCH CA CỦA TÔI.
//
// Vì sao màn này tồn tại: nhân viên KHÔNG tự đăng ký ca nữa (màn "đề xuất ca" cũ đã đóng băng ở
// L5) — Quản lý xếp lịch trên lưới phân ca, muốn đổi thì nộp đơn. Đây là chỗ DUY NHẤT một người
// thường thấy đủ ca của mình trong tháng, công tạm tính và cờ hậu kiểm của từng ngày.
//
// DỄ VỠ:
// 1. ĐƯỜNG DẪN LÀ HREF ĐANG NẰM TRONG DB — thông báo `shift.changed` / `shift.brief` /
//    `request.decided` trỏ thẳng vào đây (`lib/cham-cong/requests.ts`, `brief-db.ts`). Đổi route
//    là làm chết mọi thông báo đã gửi.
// 2. Không gate quyền: dữ liệu là của CHÍNH người đăng nhập (`getMyAssignments` lọc theo userId).
//    Thêm `checkPermission` ở đây là khoá màn của chính nhân viên.
// 3. Ngày `@db.Date` là UTC 00:00 — đọc bằng `getUTC*`, đừng dùng `getDay()/getDate()` (lệch 1
//    ngày trên Vercel chạy UTC).
// 4. Bảng phải hiện HẾT tháng: `soDongMacDinh={50}` vì 31 ngày + hàng tách tuần > 20 dòng mặc
//    định, và hàng tách tuần phải nằm TRONG `<tbody>` (PhanTrangBang chỉ nhận đúng một tbody).
import { TRANG_THAI_CON_HIEU_LUC } from "@/lib/cham-cong/don-trong-ngay-db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import {
  getMyAssignments,
  getMyAttendanceDays,
  getMyPeriod,
} from "@/lib/cham-cong/my-schedule";
import { tomTatCongThang } from "@/lib/cham-cong/bang-cong-gv";
import { congDayCuaNguoi } from "@/lib/cham-cong/cong-day";
import { loadBuoiDay, loadLoaiCongDay } from "@/lib/cham-cong/cong-day-db";
import { laNgayNghi, nhanGioCa } from "@/lib/cham-cong/nhan-ca";
import { currentPeriodKey, parsePeriodKey, periodRange } from "@/lib/cham-cong/period";
import { hrefWith, shiftKy } from "@/lib/cham-cong/scope-href";
import { vnYmd } from "@/lib/time/vn";
import { cn } from "@/lib/utils";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { EmptyState } from "@/components/admin/ui/states";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { MeNav } from "@/components/admin/cham-cong/me-nav";
import { BTN_PRIMARY, PILL } from "@/components/admin/cham-cong/classes";
import { FlagList } from "@/components/cham-cong/ui/flag-chip";
import { ShiftCodeChip, type ShiftSource } from "@/components/cham-cong/ui/shift-code-chip";
import { BangGioCa } from "@/components/cham-cong/ui/bang-gio-ca";
import { MA_CA_SELECT, dongGioCa, locMaCaDaDung } from "@/lib/cham-cong/gio-ca";
import { TongHopCongThang } from "@/components/cham-cong/ui/tong-hop-cong-thang";

export const metadata = { title: "Lịch ca của tôi | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const SOURCES = new Set<string>(["PATTERN", "IMPORT", "MANUAL", "SWAP", "LEAVE", "HOLIDAY"]);
/** Cờ nói "thiếu mốc quét" ⇒ việc của người này là nộp đơn chỉnh công, không phải chờ ai. */
const MISSING_TAP = new Set(["KHONG_CO_LUOT", "THIEU_LUOT_RA", "RA_KHONG_CO_VAO", "THIEU_BUOI_SANG", "THIEU_BUOI_CHIEU", "THIEU_LUOT_GIUA_CA"]);

const fmtMin = (m: number) => (m ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : "—");
const pad = (n: number) => String(n).padStart(2, "0");

export default async function MyShiftsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Flich-ca");

  const { month } = await searchParams;
  const ky = month && parsePeriodKey(month) ? month : currentPeriodKey();
  const { from, to, days } = periodRange(ky);
  const toExclusive = new Date(to.getTime() + 86_400_000);
  // ── Dữ liệu cho KHỐI TỔNG HỢP (mục 1 bản admin, 15/09/2026) ────────────────
  //
  // Vì sao màn này cũng cần khối ấy: đây là chỗ DUY NHẤT một người KHÔNG phải giáo viên
  // (Sale · Kế toán · Nhân sự · Quản lý cơ sở) xem được công của chính họ — họ không có
  // site GV. Trước đó cả màn chỉ có một dòng chữ nhỏ "Tổng công tạm tính X · Y ca", không
  // công chuẩn, không đi muộn/về sớm, không ngày nghỉ, không đơn của mình.
  //
  // Khối hiển thị là `components/cham-cong/ui/tong-hop-cong-thang.tsx` — CÙNG một bản với
  // `/teacher/bang-cong`, và mọi con số qua `tomTatCongThang` (luật 12b: không dựng lại).
  //
  // ⚠️ `getMyPeriod` là ĐƯỜNG OWN-ROWS, cố ý KHÔNG đi qua `scopedDb`: người thiếu
  // `UserOrgRole` bị scopedDb lọc sạch và trả `null`, không phân biệt được "kỳ chưa lập"
  // với "không được xem" ⇒ màn in "Chưa lập kỳ" cho một kỳ ĐÃ lập (bug 15/09 ở site GV).
  //
  // ⚠️ `WorkRequest` thì NGƯỢC LẠI — đọc qua `scopedDb` là ĐÚNG, vì nó nằm trong
  // SCOPE_EXEMPT (`lib/db-scope.ts`): `centerId` trên đơn chỉ là ảnh chụp và có thể null,
  // nên `scopedDb` cố ý KHÔNG chèn `centerId IN` cho bảng này.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const [shifts, dayRows, kyCong, myRequests, buoiDay, loaiCongDay, mauCa] = await Promise.all([
    getMyAssignments(session.user.id, from, toExclusive),
    getMyAttendanceDays(session.user.id, from, toExclusive),
    getMyPeriod(session.user.id, ky),
    sdb.workRequest.findMany({
      where: { requesterId: session.user.id, fromDate: { gte: from, lt: toExclusive } },
      select: { kind: true, status: true },
      take: 200,
    }),
    // Công dạy: khối tự ẩn khi rỗng, nên người không dạy không thấy gì thêm. Để ở đây vì
    // có người VỪA quản lý VỪA đứng lớp — họ xem công ở màn này chứ không mở site GV.
    loadBuoiDay([session.user.id], from, toExclusive),
    loadLoaiCongDay(),
    // Giờ các ca — để người xem lịch của mình không phải mở màn Cấu hình mới biết `CG` mấy giờ.
    sdb.shiftTemplate.findMany({
      where: { isActive: true },
      select: MA_CA_SELECT,
      orderBy: { displayOrder: "asc" },
    }),
  ]);

  const shiftOf = new Map(shifts.map((s) => [s.date.toISOString().slice(0, 10), s]));
  const dayOf = new Map(dayRows.map((d) => [d.date.toISOString().slice(0, 10), d]));
  const p = parsePeriodKey(ky)!;
  // ⚠️ KHÔNG tự cộng `dayRows` ở đây nữa.
  //
  // Bản cũ cộng MỌI ngày trong tháng, nên sau khi khối tổng hợp (16/09) chuyển sang "tính
  // tới hôm nay", cùng một màn in HAI con số cho cùng một thứ: dòng này 12,5 còn khối ngay
  // dưới 6,5. Hai số cạnh nhau mà lệch thì sẽ có người sửa cho khớp, và sửa nhầm cái đang
  // đúng — nên nay cả hai đọc CHUNG một nguồn `tomTat.cong` (xem `tomTat` dựng bên dưới).
  //
  // `dayRows` vẫn dùng cho bảng, chỉ con số tổng là thôi tự tính.
  // `!isLeave` KHÔNG đủ: `X` (Nghỉ) mang `isLeave: false` nên vẫn bị đếm là ca làm. Cùng gốc
  // với bug nhãn 10/09 — thứ phân biệt là `kind`.
  const shiftCount = shifts.filter((s) => !laNgayNghi(s.kind)).length;
  const todayYmd = vnYmd(new Date());
  const tomorrowYmd = vnYmd(new Date(Date.now() + 86_400_000));

  // Một hàng cho mỗi ngày của kỳ + nhãn tuần ở ngày đầu tiên và mỗi thứ Hai.
  const rows = Array.from({ length: days }, (_, i) => {
    const d = new Date(from.getTime() + i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const wd = d.getUTCDay();
    const dayNo = d.getUTCDate();
    let weekLabel: string | null = null;
    if (i === 0 || wd === 1) {
      const endNo = Math.min(days, dayNo + (wd === 0 ? 0 : 7 - wd));
      weekLabel = `Tuần ${pad(dayNo)}–${pad(endNo)}/${pad(p.m)}`;
    }
    return {
      key,
      weekLabel,
      wd: WD[wd],
      label: `${pad(dayNo)}/${pad(p.m)}`,
      shift: shiftOf.get(key) ?? null,
      day: dayOf.get(key) ?? null,
    };
  });

  const donTheoTrangThai = myRequests.reduce(
    (a, r) => {
      if (r.status === "PENDING") a.choDuyet += 1;
      else if (r.status === "REJECTED") a.tuChoi += 1;
      else if ((TRANG_THAI_CON_HIEU_LUC as readonly string[]).includes(r.status) && r.kind === "TIMESHEET_FIX") a.daDuyetChinhCong += 1;
      return a;
    },
    { choDuyet: 0, daDuyetChinhCong: 0, tuChoi: 0 },
  );

  const tomTat = tomTatCongThang({
    ngay: dayRows.map((d) => d.gop),
    kyKhoa: ky,
    congChuan: kyCong.standardUnits,
    kyTrangThai: kyCong.status,
    kyChotLuc: kyCong.lockedAt,
    // `homNay` là ĐỐI SỐ, hàm không đọc đồng hồ (luật 19).
    homNay: todayYmd,
    dauThang: from.toISOString().slice(0, 10),
    cuoiThang: to.toISOString().slice(0, 10),
    don: donTheoTrangThai,
  });
  const congDay = congDayCuaNguoi(buoiDay, loaiCongDay);

  // ── Vì sao "26 ca đã xếp" mà "25 ngày đã đi làm" ─────────────────────────────
  //
  // Hai con số này nằm CẠNH NHAU trên màn và trông như phải bằng nhau. Chúng không, và
  // cả hai đều đúng:
  //   · `shiftCount` đếm Ô CA trên lưới (mọi mã không phải mã nghỉ);
  //   · `tomTat.ngayCoCa` đếm NGÀY CÔNG mà engine xếp loại `WORK`.
  // Chúng lệch đúng ở những ngày có ca xếp NHƯNG engine xếp ngày đó là lễ / nghỉ.
  //
  // Đo thật trên dữ liệu (local 15/09): `uat.sale1` tháng 8 có 26 ca, 25 ngày `WORK`, và
  // đúng MỘT ngày lệch — 31/08 có ca `C` nhưng `dayType = HOLIDAY`. 25 + 1 lễ = 26.
  //
  // Số dưới đây ĐẾM tập ấy chứ không suy ra bằng phép trừ: phép trừ sẽ ra số dương cả khi
  // nguyên nhân là chuyện khác, rồi giải thích sai cho người đọc. Không có ngày nào như
  // thế thì không in câu nào.
  const dayTypeOf = new Map(dayRows.map((d) => [d.date.toISOString().slice(0, 10), d.gop.dayType]));
  // Ca đã xếp cho ngày CHƯA DIỄN RA. Cần con số này vì từ 16/09 khối tổng hợp chỉ đếm tới
  // hôm nay, nên "26 ca đã xếp" (cả tháng) và "ngày đã đi làm … / 13" (tới hôm nay) lệch
  // nhau một khoảng lớn. Không nói ra thì lại đúng cái bẫy "hai số cạnh nhau trông như phải
  // bằng nhau" — lần này còn to hơn trước.
  const caChuaToi = shifts.filter((sh) => {
    if (laNgayNghi(sh.kind)) return false;
    return sh.date.toISOString().slice(0, 10) > todayYmd;
  }).length;

  const caTrungNgayNghi = shifts.filter((sh) => {
    if (laNgayNghi(sh.kind)) return false; // mã nghỉ vốn không nằm trong `shiftCount`
    const dt = dayTypeOf.get(sh.date.toISOString().slice(0, 10));
    return dt != null && dt !== "WORK";
  }).length;

  const prevHref = hrefWith("/cham-cong/lich-ca", { month: shiftKy(ky, -1) });
  const nextHref = hrefWith("/cham-cong/lich-ca", { month: shiftKy(ky, 1) });
  const isEmpty = shifts.length === 0 && dayRows.length === 0;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Lịch ca của tôi"
        subtitle="Ca do Quản lý xếp trên lưới phân ca. Muốn đổi thì nộp đơn — duyệt xong lịch đổi ngay."
        actions={
          <Link href="/don-tu/cua-toi" className={BTN_PRIMARY}>
            <CalendarClock className="h-4 w-4" aria-hidden />
            Nộp đơn
          </Link>
        }
      />
      <MeNav active="lich-ca" month={ky} />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <Link
          href={prevHref}
          scroll={false}
          aria-label="Tháng trước"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-muted"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Link>
        <span className="min-w-[9rem] text-center text-sm font-semibold tabular-nums text-foreground">
          Tháng {pad(p.m)}/{p.y}
        </span>
        <Link
          href={nextHref}
          scroll={false}
          aria-label="Tháng sau"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-muted"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
        {/* Dòng này GIỮ LẠI dù khối tổng hợp ngay dưới có số đầy đủ hơn: nó là con số của
            ĐÚNG cái bảng bên dưới (mỗi ngày một dòng, đếm ca), còn khối tổng hợp nói về cả
            tháng. Hai phạm vi khác nhau — nên nhãn phải nói ra "ca đã xếp", đừng để người
            đọc tưởng nó mâu thuẫn với "ngày đã đi làm" ở khối dưới. */}
        <span className="ml-auto text-xs text-muted-foreground">
          Tổng công tạm tính{" "}
          <strong className="tabular-nums text-foreground">{tomTat.cong}</strong> tới hôm nay ·{" "}
          <strong className="tabular-nums text-foreground">{shiftCount}</strong> ca đã xếp
          {caChuaToi > 0 && (
            <>
              {" · "}
              <strong className="tabular-nums text-foreground">{caChuaToi}</strong>{" "}
              ca chưa tới
            </>
          )}
          {caTrungNgayNghi > 0 && (
            <>
              {" · "}
              {/* `{" "}` TƯỜNG MINH — JSX nuốt khoảng trắng quanh chỗ xuống dòng, và bản đầu
                  in ra "1ca rơi vào". Cùng một lỗi đã dính ở trang GV hôm nay; chỉ ảnh chụp
                  bắt được, tsc và lint đều xanh. */}
              <strong className="tabular-nums text-foreground">{caTrungNgayNghi}</strong>{" "}
              ca rơi vào ngày lễ/nghỉ nên không nằm trong &ldquo;ngày đã đi làm&rdquo;
            </>
          )}
        </span>
      </div>

      {/* CHỈ mã ca có trong tháng của CHÍNH người này — lịch cá nhân thường chỉ 2–3 mã. */}
      <BangGioCa
        maCa={locMaCaDaDung(dongGioCa(mauCa), shifts.map((x) => x.code))}
        className="mb-4"
      />

      <div className="mb-4">
        <TongHopCongThang
          tomTat={tomTat}
          nhanThang={`Tháng ${pad(p.m)}/${p.y}`}
          nhanChotLuc={
            kyCong.lockedAt ? kyCong.lockedAt.toISOString().slice(0, 10).split("-").reverse().join("/") : undefined
          }
          congDay={congDay.dong}
          // Màu nhấn do SITE quyết — file dùng chung không được mang `primary-*`
          // (`docs/cham-cong/DESIGN-CHAM-CONG-ADMIN.md`). Ở đây là tím của `.admin-scope`.
          lopNhanManh="text-primary-ink"
          lopLink="text-primary-ink"
          // KHÔNG truyền `hrefLoc`: màn này chưa có tham số lọc `?loc=co`, và một đường dẫn
          // không đi tới đâu là lời hứa suông (luật 12). Thêm bộ lọc là việc riêng.
        />
      </div>

      <PageHelp guideSlug="nhan-su-giao-vien">
        <p>
          Công ngày được máy tính lại vài phút sau mỗi lượt quét hoặc mỗi lần đổi ca, nên số ở đây là
          <strong> tạm tính</strong> cho tới khi kế toán chốt kỳ.
        </p>
        <p className="mt-2">
          Ô công có chữ <em>ghi đè</em> nghĩa là Quản lý đã sửa tay số công ngày đó. Ngày có ổ khoá là kỳ đã chốt —
          muốn đổi phải qua đơn chỉnh công. Thấy cờ &ldquo;Không có lượt&rdquo; hay &ldquo;Thiếu lượt ra&rdquo; thì
          bấm <em>Nộp đơn chỉnh công</em> ở cột cuối và điền mốc giờ bị thiếu.
        </p>
      </PageHelp>

      {isEmpty ? (
        <EmptyState
          title={`Tháng ${pad(p.m)}/${p.y} chưa có ca nào xếp cho bạn`}
          description="Người Hội sở và người thuộc diện miễn chấm công không có lịch ca — đây không phải lỗi. Nếu bạn có ca mà chưa thấy, hỏi Quản lý cơ sở đã sinh lưới tháng này chưa."
        />
      ) : (
        // Vỏ thẻ chuẩn của bảng danh sách trong module (giống `period-table` và
        // `request-queue-table`) — `TableSkeleton` ở `loading.tsx` cũng vẽ đúng vỏ này, thiếu nó là
        // khung bo góc hiện ra rồi biến mất mỗi lần đổi tháng.
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang cuonNgang tenDonVi="dòng" khoaGhiNho="lich-ca" soDongMacDinh={50}>
            <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th scope="col" className={adminTh}>Ngày</th>
                <th scope="col" className={adminTh}>Ca</th>
                <th scope="col" className={adminTh}>Giờ</th>
                <th scope="col" className={adminTh}>Nơi</th>
                <th scope="col" className={adminTh}>Giờ làm</th>
                <th scope="col" className={adminTh}>Công</th>
                <th scope="col" className={adminTh}>Cờ</th>
                <th scope="col" className={adminTh}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isToday = r.key === todayYmd;
                // ⚠️ NGÀY CHƯA DIỄN RA: không cờ, không nút nộp đơn (sự cố 16/09/2026).
                //
                // Bản trước in "Không có lượt" cho 17/09 → 30/09 kèm đường dẫn "Nộp đơn chỉnh
                // công". Tức màn bảo người ta đi xin bổ sung giờ cho NGÀY MAI — và nếu ai làm
                // theo thì đơn chạy thẳng vào hàng chờ duyệt của Quản lý. Chủ dự án bắt được
                // trên localhost; không cổng nào khác bắt, vì nó là màn hình nói dối chứ
                // không phải mã ném lỗi.
                //
                // Rỗng HẾT chứ không lọc riêng nhóm "thiếu mốc quét": mọi cờ đều là lời kể
                // về một việc ĐÃ xảy ra, nên không cờ nào có nghĩa cho ngày chưa tới.
                const chuaToi = r.key > todayYmd;
                const flags = chuaToi
                  ? []
                  : (r.day?.flags ?? []).filter((f) => f !== "KHONG_CO_LUOT" || r.shift);
                const locked = r.day?.locked ?? false;
                const needsFix =
                  !chuaToi && !locked && (r.day?.flags ?? []).some((f) => MISSING_TAP.has(f));
                const canSwap = Boolean(r.shift) && r.key > todayYmd;
                const source = r.shift && SOURCES.has(r.shift.source) ? (r.shift.source as ShiftSource) : undefined;
                return [
                  r.weekLabel ? (
                    <tr key={`w-${r.key}`}>
                      <td
                        colSpan={8}
                        className="bg-muted/40 px-5 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        {r.weekLabel}
                      </td>
                    </tr>
                  ) : null,
                  <tr key={r.key} className={cn(adminTr, isToday && "bg-primary-soft", !r.shift && !r.day && "text-muted-foreground")}>
                    <td className={cn(adminTd, "whitespace-nowrap tabular-nums")}>
                      <span className="mr-1 text-xs text-muted-foreground">{r.wd}</span>
                      {r.label}
                      {r.key === tomorrowYmd && (
                        <span className={cn(PILL, "ml-1.5 bg-state-info-soft text-state-info-ink")}>Ngày mai</span>
                      )}
                    </td>
                    <td className={cn(adminTd, "whitespace-nowrap")}>
                      {r.shift ? (
                        <span className="inline-flex items-center gap-1.5">
                          <ShiftCodeChip code={r.shift.code} source={source} size="sm" />
                          <span className="max-w-[10rem] truncate text-xs text-muted-foreground" title={r.shift.name}>
                            {r.shift.name}
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={cn(adminTd, "whitespace-nowrap font-mono text-xs tabular-nums")}>
                      {r.shift ? nhanGioCa(r.shift.kind, r.shift.timeLabel) : ""}
                    </td>
                    <td className={cn(adminTd, "whitespace-nowrap text-xs")}>{r.shift?.centerLabel ?? ""}</td>
                    <td className={cn(adminTd, "whitespace-nowrap tabular-nums")}>{r.day ? fmtMin(r.day.worked) : ""}</td>
                    <td className={cn(adminTd, "whitespace-nowrap font-semibold tabular-nums")}>
                      {r.day ? (
                        <span className="inline-flex items-center gap-1.5">
                          {r.day.units}
                          {r.day.override && (
                            <span className={cn(PILL, "bg-state-warning-soft text-state-warning-ink")}>ghi đè</span>
                          )}
                          {locked && (
                            <>
                              <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
                              <span className="sr-only">Kỳ đã chốt</span>
                            </>
                          )}
                        </span>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className={cn(adminTd, "whitespace-normal")}>
                      <FlagList codes={flags} />
                    </td>
                    <td className={cn(adminTd, "whitespace-nowrap")}>
                      {needsFix ? (
                        <Link
                          href={`/don-tu/cua-toi?type=TIMESHEET_FIX&date=${r.key}`}
                          className="text-sm font-medium text-primary-ink hover:underline"
                        >
                          Nộp đơn chỉnh công
                        </Link>
                      ) : canSwap ? (
                        <Link
                          href={`/don-tu/cua-toi?type=SHIFT_SWAP&date=${r.key}`}
                          className="text-sm font-medium text-primary-ink hover:underline"
                        >
                          Xin đổi ca
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}
    </div>
  );
}
