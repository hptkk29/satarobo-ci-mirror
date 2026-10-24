import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getCenterOptions, resolveCenterParam } from "@/lib/org/center-options";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { EmptyState } from "@/components/admin/ui/states";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import { docSoTheMoiCot, SO_THE_MOI_COT_MAC_DINH } from "@/lib/ui/phan-trang";
import { COOKIE_SO_DONG_HOC_BU } from "@/lib/hoc-bu/huy";
import { formatDateVN } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import { docDanhSachCanBu, docDanhSachDaHuy, whereCanBu, whereDaHuy } from "@/lib/hoc-bu/danh-sach-db";
import { docDanhSachCase, whereCase, type DongCase, type TrangThaiCase } from "@/lib/hoc-bu/case-doc";
import { BangCanBu } from "./_components/bang-can-bu";
import { OLoc, OTim } from "./_components/bo-loc";
import { chuanHoaTim } from "@/lib/hoc-bu/loc";
import { BangDaHuy } from "./_components/bang-da-huy";
import { ChonSoDongNho } from "./_components/chon-so-dong-nho";

// Học bù đời mới (docs/hoc-bu/DAC-TA.md). Bốn tab trên MỘT màn — "Cần bù" (buổi vắng chờ xếp),
// "Case dạy bù" (case SẮP dạy), "Case hoàn thành" (đã chốt: đã dạy · không bé nào tới · đã huỷ) và
// "Đã huỷ" (buổi huỷ không bù) — vì người xếp đi qua lại giữa chúng liên tục. Luồng cũ "xếp bé vào
// buổi của lớp khác" đã gỡ (chốt 10).
//
// [20/10/2026] Case đã chốt TÁCH khỏi "Case dạy bù": trước đó tab này liệt kê MỌI trạng thái trong khi
// số trên tab chỉ đếm case sắp dạy — case cũ chất đống che mất case đang cần xếp/điểm danh.
//
// Số dòng: 5/10/20/50/100, mặc định 5 (chủ dự án chốt 29/09) — dùng đúng bộ mức của Kanban lead
// (`MUC_THE_MOI_COT`), vì bộ mức của bảng không có 5.

export const metadata = { title: "Học bù | Admin" };
export const dynamic = "force-dynamic";

type Tab = "can-bu" | "case" | "case-xong" | "da-huy";

const NHAN_TT: Record<TrangThaiCase, { nhan: string; tone: "info" | "success" | "muted" | "warning" }> = {
  // 20/10/2026 — case do Sale tạo, chờ quản lý cơ sở duyệt: chưa là lịch thật, giáo viên chưa thấy.
  PENDING_APPROVAL: { nhan: "Chờ duyệt", tone: "warning" },
  SCHEDULED: { nhan: "Sắp dạy", tone: "info" },
  COMPLETED: { nhan: "Đã dạy", tone: "success" },
  CANCELLED: { nhan: "Đã huỷ", tone: "muted" },
  NO_SHOW: { nhan: "Không bé nào tới", tone: "muted" },
};

/** Case CHƯA chốt — tab "Case dạy bù": đã duyệt đang chờ dạy + đang chờ quản lý cơ sở duyệt (Sale vẫn thấy case của mình để biết nó đang ở đâu). */
const CASE_DANG_MO = ["SCHEDULED", "PENDING_APPROVAL"] as const satisfies readonly TrangThaiCase[];

/** Case ĐÃ CHỐT — tab "Case hoàn thành". Ô lọc trạng thái của tab chỉ bày đúng ba giá trị này. */
const CASE_DA_CHOT = ["COMPLETED", "NO_SHOW", "CANCELLED"] as const satisfies readonly TrangThaiCase[];

export default async function HocBuPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    page?: string;
    size?: string;
    coSo?: string;
    khoa?: string;
    lop?: string;
    tt?: string;
    q?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission([...PAGE_GATES["/hoc-bu"]]))) redirect("/dashboard?error=unauthorized");
  const [xemTatCa, coTheXep, coTheHuy, sp] = await Promise.all([
    checkPermission("makeup:view-all"),
    checkPermission("makeup:manage"),
    checkPermission("makeup:waive"),
    searchParams,
  ]);

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  // Sale (không có view-all) chỉ thấy học viên MÌNH phụ trách (chốt 29/09).
  const chiCuaSale = xemTatCa ? null : session.user.id;
  const tab: Tab = sp.tab === "case" ? "case" : sp.tab === "case-xong" ? "case-xong" : sp.tab === "da-huy" ? "da-huy" : "can-bu";
  // Số dòng: URL trước, rồi lựa chọn đã NHỚ trong cookie (chốt 29/09: quay lại trang không reset).
  const soDong = docSoTheMoiCot(sp.size ?? (await cookies()).get(COOKIE_SO_DONG_HOC_BU)?.value);
  const trang = Number(sp.page) || 1;

  const [coSoList, khoaList] = await Promise.all([
    getCenterOptions(actor),
    sdb.course.findMany({
      where: { isActive: true, isTeachable: true, choPhepHocBu: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const coSo = resolveCenterParam(sp.coSo, coSoList);
  // Cột "Cơ sở" chỉ khi người xem thấy ≥2 cơ sở (Admin, QLCS nhiều cơ sở — chốt 30/09).
  const tenCoSo = coSoList.length > 1 ? Object.fromEntries(coSoList.map((c) => [c.id, c.code || c.name])) : null;
  const courseId = khoaList.some((k) => k.id === sp.khoa) ? sp.khoa : undefined;
  // Lọc trạng thái chỉ có ở tab "Case hoàn thành" — tab "Case dạy bù" chỉ có MỘT trạng thái (sắp dạy).
  const tt = tab === "case-xong" ? CASE_DA_CHOT.find((x) => x === sp.tt) : undefined;
  const tim = chuanHoaTim(sp.q);

  // Bộ lọc CHUNG cho ba tab (cơ sở · khoá · chuỗi tìm) — số trên tab đi cùng bộ lọc, nên tìm một
  // bé là thấy ngay bé có mấy buổi chờ bù, mấy case, mấy buổi đã huỷ.
  const chung = { centerId: coSo.centerId, courseId, tim, chiCuaSale };
  // "Lớp" chỉ bày lớp ĐANG có dòng ở tab hiện tại — không bày một danh sách lớp rỗng.
  const whereLop = tab === "da-huy" ? whereDaHuy(chung) : tab === "can-bu" ? whereCanBu(chung) : null;
  const lopList = whereLop
    ? (
        await sdb.makeupNeed.findMany({
          where: whereLop,
          distinct: ["classId"],
          select: { class: { select: { id: true, name: true } } },
        })
      )
        .map((r) => r.class)
        .sort((a, b) => a.name.localeCompare(b.name, "vi"))
    : [];
  const classId = lopList.some((l) => l.id === sp.lop) ? sp.lop : undefined;

  const [demCanBu, demCaseSap, demCaseXong, demDaHuy, demChoDuyet] = await Promise.all([
    sdb.makeupNeed.count({ where: whereCanBu({ ...chung, classId: tab === "can-bu" ? classId : undefined }) }),
    // Cùng `whereCase` với danh sách bên dưới — số trên tab và số dòng không được lệch nhau.
    sdb.makeupCase.count({ where: whereCase({ ...chung, trangThai: CASE_DANG_MO }) }),
    sdb.makeupCase.count({ where: whereCase({ ...chung, trangThai: tt ?? CASE_DA_CHOT }) }),
    sdb.makeupNeed.count({ where: whereDaHuy({ ...chung, classId: tab === "da-huy" ? classId : undefined }) }),
    // Số case chờ DUYỆT — chỉ người có quyền duyệt cần biết (không lọc theo ô tìm / khoá: đây là việc phải làm, không phải kết quả tìm kiếm).
    // + số LÔ yêu cầu thêm học viên vào case có sẵn (24/10/2026) — cùng màn "Duyệt case", cùng chỗ nhìn.
    coTheHuy
      ? Promise.all([
          sdb.makeupCase.count({ where: { status: "PENDING_APPROVAL" } }),
          sdb.makeupCaseAddRequest.findMany({ where: { status: "PENDING" }, distinct: ["batchId"], select: { batchId: true } }),
        ]).then(([caseCho, loCho]) => caseCho + loCho.length)
      : Promise.resolve(0),
  ]);
  const dangLoc = !!(tim || courseId || classId || tt || coSo.centerId);

  const hrefTab = (t: Tab) => {
    const p = new URLSearchParams();
    if (t !== "can-bu") p.set("tab", t);
    if (coSo.centerId) p.set("coSo", coSo.centerId);
    if (courseId) p.set("khoa", courseId);
    if (tim) p.set("q", tim);
    const q = p.toString();
    return q ? `/hoc-bu?${q}` : "/hoc-bu";
  };
  const hrefTrang = (t: number) => {
    const p = new URLSearchParams();
    if (tab !== "can-bu") p.set("tab", tab);
    if (coSo.centerId) p.set("coSo", coSo.centerId);
    if (courseId) p.set("khoa", courseId);
    if (classId && (tab === "can-bu" || tab === "da-huy")) p.set("lop", classId);
    if (tim) p.set("q", tim);
    if (tt) p.set("tt", tt);
    if (soDong !== SO_THE_MOI_COT_MAC_DINH) p.set("size", String(soDong));
    if (t > 1) p.set("page", String(t));
    const q = p.toString();
    return q ? `/hoc-bu?${q}` : "/hoc-bu";
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <PageHeader
        title="Học bù"
        subtitle={
          xemTatCa
            ? "Buổi vắng chờ bù và các case dạy bù của cơ sở"
            : "Học viên bạn phụ trách — mở case để thấy đủ các bé học chung"
        }
        actions={
          // Sale (không quyền nào trong hai quyền dưới) không có nút nào ⇒ KHÔNG dựng khối rỗng (khối rỗng vẫn chiếm khoảng cách `gap` dưới tiêu đề ở 375px).
          !coTheHuy && !xemTatCa ? undefined : (
          <>
            {/* Màn duyệt case: người có `makeup:waive` (quản lý cơ sở / quản trị) — cùng cổng với chính màn đó và với từng Server Action duyệt. */}
            {coTheHuy && (
              <Link
                href="/hoc-bu/duyet"
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium sm:min-h-9",
                  demChoDuyet > 0
                    ? "border-[color:var(--state-warning)] bg-[color:var(--state-warning-soft)] text-[color:var(--state-warning)] hover:opacity-90"
                    : "border-border text-foreground hover:bg-muted",
                )}
              >
                Duyệt case{demChoDuyet > 0 ? ` (${demChoDuyet})` : ""}
              </Link>
            )}
            {/* Màn rà soát chỉ đọc có tên học viên của MỌI Sale ⇒ chỉ bày cho người có `makeup:view-all` (cùng cổng với chính màn đó). */}
            {xemTatCa && (
              <Link
                href="/hoc-bu/ra-soat"
                className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted sm:min-h-9"
              >
                Rà soát dữ liệu
              </Link>
            )}
          </>
          )
        }
      />

      <PageHelp>
        <p>
          <b>Lượt bù</b> tính theo số buổi phụ huynh mua: mỗi học phần 1 lượt (chỉnh ở trang khoá
          học), dùng chung cả khoá. Hết lượt thì <b>tạo phí bù</b> và thu xong mới xếp được. Tick nhiều
          bé <b>cùng khoá, cùng buổi vắng</b> để xếp chung một case. Bé vắng buổi bù thì quay lại danh
          sách, không mất lượt.
        </p>
      </PageHelp>

      {/* Bốn nhãn + số không vừa 375px ⇒ cuộn ngang TRONG thanh tab (mỗi tab shrink-0), không kéo cả trang. */}
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-border" aria-label="Học bù">
        {(
          [
            ["can-bu", "Cần bù", demCanBu],
            ["case", "Case dạy bù", demCaseSap],
            ["case-xong", "Case hoàn thành", demCaseXong],
            ["da-huy", "Đã huỷ", demDaHuy],
          ] as const
        ).map(([k, nhan, dem]) => (
          <Link
            key={k}
            href={hrefTab(k)}
            aria-current={tab === k ? "page" : undefined}
            className={cn(
              // 375px: không xuống dòng nhãn tab ("Cần / bù"), và vùng chạm cao 44px trên điện thoại.
              "-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors sm:h-10 sm:min-h-0",
              tab === k
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {nhan}
            <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{dem}</span>
          </Link>
        ))}
      </nav>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <OTim giaTri={tim ?? ""} goiY="Tìm học viên — tên, mã HV, tên lớp" />
        {xemTatCa && coSoList.length > 1 && (
          <OLoc
            nhan="Cơ sở"
            thamSo="coSo"
            giaTri={coSo.centerId ?? ""}
            tatCa="Tất cả cơ sở"
            luaChon={coSoList.map((c) => ({ value: c.id, label: c.code || c.name }))}
          />
        )}
        <OLoc
          nhan="Khoá"
          thamSo="khoa"
          giaTri={courseId ?? ""}
          tatCa="Tất cả khoá"
          luaChon={khoaList.map((k) => ({ value: k.id, label: k.name }))}
        />
        {tab === "can-bu" || tab === "da-huy" ? (
          <OLoc
            nhan="Lớp"
            thamSo="lop"
            giaTri={classId ?? ""}
            tatCa={lopList.length ? `Tất cả lớp (${lopList.length})` : "Tất cả lớp"}
            luaChon={lopList.map((l) => ({ value: l.id, label: l.name }))}
          />
        ) : tab === "case-xong" ? (
          <OLoc
            nhan="Trạng thái"
            thamSo="tt"
            giaTri={tt ?? ""}
            tatCa="Tất cả"
            luaChon={CASE_DA_CHOT.map((k) => ({ value: k, label: NHAN_TT[k].nhan }))}
          />
        ) : null}
        {dangLoc && (
          <Link
            href={tab === "can-bu" ? "/hoc-bu" : `/hoc-bu?tab=${tab}`}
            className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Xoá lọc
          </Link>
        )}
        <div className="sm:ml-auto">
          <ChonSoDongNho
            soDong={soDong}
            tong={tab === "can-bu" ? demCanBu : tab === "da-huy" ? demDaHuy : tab === "case-xong" ? demCaseXong : demCaseSap}
            tenDonVi={tab === "case" ? "case sắp dạy" : tab === "case-xong" ? "case đã chốt" : tab === "da-huy" ? "buổi đã huỷ" : "buổi vắng"}
          />
        </div>
      </div>
      {coSo.invalid && (
        <p className="mb-3 text-sm text-[color:var(--state-warning)]">
          Cơ sở trong đường dẫn không còn trong tầm nhìn của bạn — đang hiện tất cả.
        </p>
      )}

      {tab === "da-huy" ? (
        <TabDaHuy
          userId={session.user.id}
          loc={{ ...chung, trang, soDong, classId }}
          dangLoc={dangLoc}
          coTheKhoiPhuc={coTheHuy}
          tenCoSo={tenCoSo}
          hrefTrang={hrefTrang}
        />
      ) : tab === "can-bu" ? (
        <TabCanBu
          userId={session.user.id}
          loc={{ ...chung, trang, soDong, classId }}
          dangLoc={dangLoc}
          coTheXep={coTheXep}
          coTheHuy={coTheHuy}
          tenCoSo={tenCoSo}
          hrefTrang={hrefTrang}
        />
      ) : (
        <TabCase
          userId={session.user.id}
          loc={{ ...chung, trang, soDong, trangThai: tab === "case" ? CASE_DANG_MO : (tt ?? CASE_DA_CHOT) }}
          daChot={tab === "case-xong"}
          dangLoc={dangLoc}
          tenCoSo={tenCoSo}
          hrefTrang={hrefTrang}
        />
      )}
    </div>
  );
}

// ⚠️ Tab nhận `userId`, KHÔNG nhận `sdb`: prop của server component được React (bản dev) chép vào
// debug info, và chép một proxy Prisma làm mảng `_debugInfo` nở gấp đôi tới khi sập với
// "RangeError: Invalid array length" (đo 30/09). `resolveActor` có `cache()` nên không tra lại.
async function TabCanBu({
  userId,
  loc,
  dangLoc,
  coTheXep,
  coTheHuy,
  tenCoSo,
  hrefTrang,
}: {
  userId: string;
  loc: Parameters<typeof docDanhSachCanBu>[1];
  dangLoc: boolean;
  coTheXep: boolean;
  coTheHuy: boolean;
  tenCoSo: Record<string, string> | null;
  hrefTrang: (t: number) => string;
}) {
  const { dong, trang, soTrang } = await docDanhSachCanBu(scopedDb(await resolveActor(userId)), loc);
  if (dong.length === 0) {
    if (dangLoc) return <KhongKhop tim={loc.tim} />;
    return (
      <EmptyState
        title="Không có buổi vắng nào đang chờ bù"
        description={
          loc.chiCuaSale
            ? "Chưa học viên nào bạn phụ trách vắng buổi cần bù. Buổi vắng xuất hiện ở đây ngay khi giáo viên điểm danh vắng."
            : "Buổi vắng xuất hiện ở đây ngay khi giáo viên điểm danh vắng. Đổi bộ lọc cơ sở/khoá nếu bạn đang tìm một bé cụ thể."
        }
      />
    );
  }
  return (
    <>
      <BangCanBu dong={dong} coTheXep={coTheXep} coTheHuy={coTheHuy} tenCoSo={tenCoSo} />
      <DieuHuongTrangLink className="mt-4" trang={trang} soTrang={soTrang} hrefCua={hrefTrang} />
    </>
  );
}

async function TabCase({
  userId,
  loc,
  daChot,
  dangLoc,
  tenCoSo,
  hrefTrang,
}: {
  userId: string;
  loc: Parameters<typeof docDanhSachCase>[1];
  /** Tab "Case hoàn thành" (case đã chốt) thay vì "Case dạy bù" (sắp dạy) — chỉ đổi câu trống. */
  daChot: boolean;
  dangLoc: boolean;
  tenCoSo: Record<string, string> | null;
  hrefTrang: (t: number) => string;
}) {
  const { dong, trang, soTrang } = await docDanhSachCase(scopedDb(await resolveActor(userId)), loc);
  if (dong.length === 0) {
    if (dangLoc) return <KhongKhop tim={loc.tim} />;
    return daChot ? (
      <EmptyState
        title="Chưa có case nào hoàn thành"
        description="Case dạy xong (hoặc không bé nào tới, hoặc đã huỷ) sẽ chuyển sang đây để tab “Case dạy bù” chỉ còn case đang cần làm."
      />
    ) : (
      <EmptyState
        title="Chưa có case nào sắp dạy"
        description="Tạo case từ tab “Cần bù”: tick các bé cùng buổi vắng rồi bấm “Xếp vào case”. Case dạy xong sẽ chuyển sang tab “Case hoàn thành”."
      />
    );
  }
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1060px] text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className={adminTh}>Ngày · giờ</th>
                <th className={adminTh}>Khoá · buổi bù</th>
                <th className={adminTh}>Học viên</th>
                <th className={cn(adminTh, "text-right")}>Sĩ số</th>
                <th className={adminTh}>Giáo viên</th>
                <th className={adminTh}>Phòng</th>
                {tenCoSo && <th className={adminTh}>Cơ sở</th>}
                <th className={adminTh}>Điểm danh · nhận xét</th>
                <th className={adminTh}>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {dong.map((c) => (
                <tr key={c.id} className={cn(adminTr, "relative cursor-pointer")}>
                  <td className={adminTd}>
                    <Link
                      href={`/hoc-bu/case/${c.id}`}
                      className="font-medium tabular-nums after:absolute after:inset-0 focus-visible:underline"
                    >
                      {formatDateVN(c.date)} · {c.startTime}–{c.endTime}
                    </Link>
                  </td>
                  <td className={cn(adminTd, "max-w-[280px]")}>
                    <p className="truncate">{c.khoa}</p>
                    <p className="truncate text-xs text-muted-foreground">{c.buoi}</p>
                  </td>
                  <td className={cn(adminTd, "max-w-[260px]")}>
                    {c.hocVien.length ? (
                      <p className="truncate" title={c.hocVien.join(", ")}>
                        {c.hocVien.join(", ")}
                      </p>
                    ) : (
                      <span className="text-muted-foreground">Chưa có bé nào</span>
                    )}
                  </td>
                  <td className={cn(adminTd, "text-right tabular-nums")}>
                    {c.status === "SCHEDULED" || c.status === "PENDING_APPROVAL" ? c.soBe : `${c.soCoMat}/${c.soBe}`}
                  </td>
                  <td className={cn(adminTd, "max-w-[180px] truncate")}>{c.giaoVien}</td>
                  <td className={cn(adminTd, "max-w-[200px] truncate")}>
                    {c.phong ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  {tenCoSo && <td className={adminTd}>{tenCoSo[c.centerId] ?? "—"}</td>}
                  <td className={adminTd}>
                    <TienDo c={c} />
                  </td>
                  <td className={adminTd}>
                    <StatusPill tone={NHAN_TT[c.status].tone}>{NHAN_TT[c.status].nhan}</StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <DieuHuongTrangLink className="mt-4" trang={trang} soTrang={soTrang} hrefCua={hrefTrang} />
    </>
  );
}

async function TabDaHuy({
  userId,
  loc,
  dangLoc,
  coTheKhoiPhuc,
  tenCoSo,
  hrefTrang,
}: {
  userId: string;
  loc: Parameters<typeof docDanhSachDaHuy>[1];
  dangLoc: boolean;
  coTheKhoiPhuc: boolean;
  tenCoSo: Record<string, string> | null;
  hrefTrang: (t: number) => string;
}) {
  const { dong, trang, soTrang } = await docDanhSachDaHuy(scopedDb(await resolveActor(userId)), loc);
  if (dong.length === 0) {
    if (dangLoc) return <KhongKhop tim={loc.tim} />;
    return (
      <EmptyState
        title="Chưa có buổi nào bị huỷ"
        description="Buổi chọn “Huỷ — không bù” ở tab Cần bù sẽ nằm ở đây, kèm lý do. Phụ huynh đổi ý thì khôi phục lại được."
      />
    );
  }
  return (
    <>
      <BangDaHuy dong={dong} coTheKhoiPhuc={coTheKhoiPhuc} tenCoSo={tenCoSo} />
      <DieuHuongTrangLink className="mt-4" trang={trang} soTrang={soTrang} hrefCua={hrefTrang} />
    </>
  );
}

// Danh sách trống VÌ BỘ LỌC — nói rõ là lọc, không nói "chưa có gì" (luật 12: câu trống phải thật).
function KhongKhop({ tim }: { tim?: string }) {
  return (
    <EmptyState
      title={tim ? `Không có học viên nào khớp “${tim}”` : "Không có dòng nào khớp bộ lọc"}
      description="Gõ một phần tên hoặc mã học viên, đổi bộ lọc, hoặc bấm “Xoá lọc” để xem lại tất cả."
    />
  );
}

// Tiến độ của case để Sale nhắc GV/giáo vụ (chốt 30/09): Sale chỉ XEM, không nhập. Buổi chưa tới
// thì chưa có gì để nhắc; tới rồi mà còn thiếu thì tô cảnh báo.
function TienDo({ c }: { c: DongCase }) {
  // Case chờ duyệt chưa có gì để điểm danh hay nhắc giáo viên.
  if (c.status === "CANCELLED" || c.status === "PENDING_APPROVAL" || !c.tienDo || c.soBe === 0) return <span className="text-muted-foreground">—</span>;
  const homNay = new Date();
  homNay.setUTCHours(0, 0, 0, 0);
  if (c.status === "SCHEDULED" && c.date.getTime() > homNay.getTime()) {
    return <span className="text-xs text-muted-foreground">Chưa tới buổi</span>;
  }
  const t = c.tienDo;
  const duDiemDanh = t.daDiemDanh === c.soBe;
  return (
    <div className="flex flex-wrap gap-1.5">
      <StatusPill tone={duDiemDanh ? "success" : "warning"}>
        Điểm danh {t.daDiemDanh}/{c.soBe}
      </StatusPill>
      {t.coMat > 0 && (
        <StatusPill tone={t.daNhanXet === t.coMat ? "success" : "warning"}>
          Nhận xét {t.daNhanXet}/{t.coMat}
        </StatusPill>
      )}
    </div>
  );
}
