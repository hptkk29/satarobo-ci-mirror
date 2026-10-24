// app/(admin)/admin/quyen-hoc-hang-doi/page.tsx — HÀNG ĐỢI QUYỀN HỌC ("Thu học phí theo phạm vi học").
//
// Nơi người có `entitlements:manage` xử lý các ca máy KHÔNG được tự quyết: chờ Chuyển đổi (chưa có học viên) · chờ xếp lớp · tiền đảo/huỷ/hoàn cần thu hồi quyền học ·
// quyền học đã tiêu thụ buổi cần duyệt tay · đủ tiền nhưng thiếu quyền học · dữ liệu lệch. Dòng do đường tiền (hích) và cron `quyen-hoc-doi-soat` tạo ra.
// Hướng dẫn vận hành: docs/thu-hoc-phi-pham-vi/HANG-DOI-VAN-HANH.md.
//
// QUYỀN: vào màn = `entitlements:view`; mọi nút ghi = `entitlements:manage` tại cơ sở của dòng (gác ở Server Action + `xetHanhDong`). Tầm nhìn cơ sở do `scopedDb`.
// Tiền: không có `entitlements:view-money` ⇒ số tiền (cột lẫn câu chữ) bị che ngay ở tầng đọc.
// Cờ phạm vi TẮT cho cơ sở nào thì dòng của cơ sở đó vẫn XEM được (lịch sử) nhưng không có nút ghi.
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState } from "@/components/admin/ui/states";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { scopedDb } from "@/lib/db-scope";
import { demDangMo, docHangDoi, type BoLocHangDoi } from "@/lib/entitlements/hang-doi/doc-hang-doi";
import { LOAI_HANG_DOI, NHAN_LOAI, NHAN_TRANG_THAI, laLoaiHangDoi, type LoaiHangDoi, type TrangThaiHangDoi } from "@/lib/entitlements/hang-doi/loai";
import { ngayGioVN } from "@/lib/format/date";
import { getCenterOptions, resolveCenterParam } from "@/lib/org/center-options";
import { parseVnYmd } from "@/lib/time/vn";
import { cn } from "@/lib/utils";
import { XuLyDong } from "./_components/xu-ly-dong";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hàng đợi quyền học | Admin Sata Robo" };

const TONE_LOAI: Readonly<Record<LoaiHangDoi, PillTone>> = {
  CHO_CHUYEN_DOI: "info",
  CHO_XEP_LOP: "info",
  CHO_DUYET_HOC_VUOT: "warning",
  CAN_THU_HOI: "danger",
  TREO_DUYET_TAY: "warning",
  THIEU_QUYEN_HOC: "danger",
  LECH_DU_LIEU: "warning",
};

const TONE_TRANG_THAI: Readonly<Record<TrangThaiHangDoi, PillTone>> = { OPEN: "warning", DA_XU_LY: "success", HUY: "muted" };

const TRANG_THAI_LOC: readonly { ma: string; nhan: string; trangThai: readonly TrangThaiHangDoi[] }[] = [
  { ma: "mo", nhan: "Đang mở", trangThai: ["OPEN"] },
  { ma: "da-dong", nhan: "Đã đóng", trangThai: ["DA_XU_LY", "HUY"] },
  { ma: "tat-ca", nhan: "Tất cả", trangThai: ["OPEN", "DA_XU_LY", "HUY"] },
];

type Sp = { tt?: string; loai?: string; coSo?: string; khoa?: string; q?: string; tu?: string; den?: string; quaHan?: string; trang?: string };

const oLoc = "h-9 min-w-0 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary";

export default async function QuyenHocHangDoiPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fquyen-hoc-hang-doi");
  if (!(await checkAnyPermission([...PAGE_GATES["/quyen-hoc-hang-doi"]]))) redirect("/dashboard?error=unauthorized");

  const [sp, actor] = await Promise.all([searchParams, resolveActor(session.user.id)]);
  const sdb = scopedDb(actor);
  const now = new Date();

  const [coSoList, khoaList] = await Promise.all([
    getCenterOptions(actor),
    sdb.course.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 300 }),
  ]);
  const coSo = resolveCenterParam(sp.coSo, coSoList);
  const ttLoc = TRANG_THAI_LOC.find((t) => t.ma === sp.tt) ?? TRANG_THAI_LOC[0]!;
  const loai = laLoaiHangDoi(sp.loai) ? sp.loai : undefined;
  const khoa = khoaList.some((k) => k.id === sp.khoa) ? sp.khoa : undefined;
  const tim = sp.q?.trim().slice(0, 80) || undefined;
  const tu = sp.tu ? (parseVnYmd(sp.tu) ?? undefined) : undefined;
  const denNgay = sp.den ? parseVnYmd(sp.den) : null;
  const den = denNgay ? new Date(denNgay.getTime() + 86_400_000) : undefined; // hết ngày `den` (loại trừ đầu ngày kế tiếp)
  const quaHan = sp.quaHan === "1";
  const trang = Math.max(1, Number(sp.trang) || 1);

  const loc: BoLocHangDoi = { trangThai: ttLoc.trangThai, loai: loai ? [loai] : undefined, centerId: coSo.centerId, courseId: khoa, q: tim, tu, den, quaHan };
  const [kq, dem] = await Promise.all([docHangDoi(actor, loc, trang, now), demDangMo(actor)]);

  const hrefTrang = (t: number): string => {
    const p = new URLSearchParams();
    if (ttLoc.ma !== "mo") p.set("tt", ttLoc.ma);
    if (loai) p.set("loai", loai);
    if (coSo.centerId) p.set("coSo", coSo.centerId);
    if (khoa) p.set("khoa", khoa);
    if (tim) p.set("q", tim);
    if (sp.tu && tu) p.set("tu", sp.tu);
    if (sp.den && denNgay) p.set("den", sp.den);
    if (quaHan) p.set("quaHan", "1");
    if (t > 1) p.set("trang", String(t));
    const q = p.toString();
    return q ? `/quyen-hoc-hang-doi?${q}` : "/quyen-hoc-hang-doi";
  };
  const dangLoc = !!(loai || coSo.centerId || khoa || tim || tu || denNgay || quaHan || ttLoc.ma !== "mo");
  const tongMo = LOAI_HANG_DOI.reduce((s, l) => s + dem[l], 0);
  const hienCotCoSo = coSoList.length > 1;

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageHeader
        title="Hàng đợi quyền học"
        subtitle="Các ca thu học phí theo phạm vi học cần người có quyền xử lý — máy không tự quyết."
      />

      <div role="group" aria-label="Số dòng đang mở theo loại" className="mb-4 flex flex-wrap gap-2">
        {LOAI_HANG_DOI.map((l) => (
          <Link
            key={l}
            href={`/quyen-hoc-hang-doi?loai=${l}`}
            aria-current={loai === l ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              loai === l ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {NHAN_LOAI[l]}
            <span className="tabular-nums">{dem[l]}</span>
          </Link>
        ))}
        <span className="inline-flex h-9 items-center text-sm text-muted-foreground">Tổng đang mở: <strong className="ml-1 tabular-nums">{tongMo}</strong></span>
      </div>

      <form method="get" action="/quyen-hoc-hang-doi" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Trạng thái
          <select name="tt" defaultValue={ttLoc.ma} className={oLoc}>
            {TRANG_THAI_LOC.map((t) => (
              <option key={t.ma} value={t.ma}>
                {t.nhan}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Loại
          <select name="loai" defaultValue={loai ?? ""} className={oLoc}>
            <option value="">Tất cả loại</option>
            {LOAI_HANG_DOI.map((l) => (
              <option key={l} value={l}>
                {NHAN_LOAI[l]}
              </option>
            ))}
          </select>
        </label>
        {hienCotCoSo && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Cơ sở
            <select name="coSo" defaultValue={coSo.centerId ?? ""} className={oLoc}>
              <option value="">Tất cả cơ sở</option>
              {coSoList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code || c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Khoá
          <select name="khoa" defaultValue={khoa ?? ""} className={cn(oLoc, "max-w-[14rem]")}>
            <option value="">Tất cả khoá</option>
            {khoaList.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Học viên / bé
          <input name="q" defaultValue={tim ?? ""} placeholder="Tên…" maxLength={80} className={cn(oLoc, "w-40")} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Tạo từ
          <input type="date" name="tu" defaultValue={sp.tu && tu ? sp.tu : ""} className={oLoc} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          đến
          <input type="date" name="den" defaultValue={sp.den && denNgay ? sp.den : ""} className={oLoc} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="quaHan" value="1" defaultChecked={quaHan} />
          Chỉ dòng quá hạn (&gt; 72 giờ)
        </label>
        <button type="submit" className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">
          Lọc
        </button>
        {dangLoc && (
          <Link href="/quyen-hoc-hang-doi" className="inline-flex h-9 items-center px-2 text-sm text-muted-foreground hover:underline">
            Xoá lọc
          </Link>
        )}
      </form>

      {coSo.invalid && (
        <p role="status" className="mb-3 rounded-lg border border-state-warning-soft bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
          Cơ sở trong đường dẫn không hợp lệ hoặc nằm ngoài phạm vi của bạn — đã bỏ lọc cơ sở.
        </p>
      )}

      {kq.dong.length === 0 ? (
        <EmptyState
          title={dangLoc ? "Không có dòng nào khớp bộ lọc." : "Hàng đợi trống — không có ca nào cần xử lý."}
          description={dangLoc ? undefined : "Dòng xuất hiện khi tiền xác nhận mà chưa cấp được quyền học, hoặc khi tiền bị đảo / huỷ / hoàn sau khi đã cấp."}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className={adminTh}>Loại</th>
                  <th scope="col" className={adminTh}>Học viên · khoá</th>
                  <th scope="col" className={adminTh}>Đơn</th>
                  {hienCotCoSo && <th scope="col" className={adminTh}>Cơ sở</th>}
                  <th scope="col" className={adminTh}>Lý do</th>
                  <th scope="col" className={adminTh}>Cập nhật</th>
                  <th scope="col" className={adminTh}>
                    <span className="sr-only">Hành động</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {kq.dong.map((d) => (
                  <tr key={d.id} className={cn(adminTr, "align-top")}>
                    <td className={cn(adminTd, "align-top")}>
                      <StatusPill tone={TONE_LOAI[d.loai]}>{NHAN_LOAI[d.loai]}</StatusPill>
                      <p className="mt-1">
                        <StatusPill tone={TONE_TRANG_THAI[d.trangThai]}>{NHAN_TRANG_THAI[d.trangThai]}</StatusPill>
                        {d.quaHan && <span className="ml-2 text-xs font-semibold text-state-warning">quá hạn</span>}
                      </p>
                    </td>
                    <td className={cn(adminTd, "max-w-[16rem] align-top")}>
                      <p className="truncate font-semibold">{d.hocVien?.ten ?? d.be?.ten ?? "Chưa có học viên"}</p>
                      <p className="truncate text-xs text-muted-foreground">{d.khoa?.ten ?? "—"}{d.lop ? ` · ${d.lop.ten}` : ""}</p>
                    </td>
                    <td className={cn(adminTd, "align-top")}>
                      {d.don ? (
                        <Link href={`/orders/${d.don.id}`} className="font-medium text-primary-ink hover:underline">
                          {d.don.ma}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    {hienCotCoSo && <td className={cn(adminTd, "align-top")}>{d.coSo?.ten ?? "—"}</td>}
                    <td className={cn(adminTd, "max-w-[26rem] whitespace-normal align-top text-muted-foreground")}>
                      <p className="line-clamp-3">{d.lyDo}</p>
                    </td>
                    <td className={cn(adminTd, "align-top tabular-nums")}>{ngayGioVN(d.capNhatLuc)}</td>
                    <td className={cn(adminTd, "align-top text-right")}>
                      <XuLyDong dong={d} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
            <span>
              {kq.tong} dòng · trang {kq.trang}/{kq.soTrang}
            </span>
            <DieuHuongTrangLink trang={kq.trang} soTrang={kq.soTrang} hrefCua={hrefTrang} />
          </div>
        </div>
      )}
    </div>
  );
}
