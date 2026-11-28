import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { napDuyetKhoa } from "@/lib/elearning/soan-khoa-view";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { CircleCheck, CircleX } from "lucide-react";
import { GhiChu, QuayLai, TrangQuanTri } from "../../../_components/ui/trang";
import { TrangThaiBadge } from "../../../_components/ui/trang-thai-badge";
import { DuyetHanhDong } from "../../_components/duyet-hanh-dong";

/**
 * MÀN DUYỆT KHOÁ — người duyệt thấy: bản nào, ai gửi/lúc nào, các cổng (dàn bài, phụ đề), và bản này KHÁC bản đã xuất bản ở đâu
 * (thêm/bớt/đổi nội dung/đổi bắt buộc/đổi thứ tự). Chỉ ĐỌC + nút của action vòng đời có sẵn.
 *
 * ⚠️ Vân tay nội dung chỉ phủ trường của bài (tên, chữ, nguồn video, đề/khung gắn…), KHÔNG phủ nội dung CÂU HỎI của đề hay tiêu chí của
 * khung — nói thẳng ở cuối màn thay vì hứa "so sánh đầy đủ". Bài của bản cũ (trước P5a) chưa có vân tay ⇒ "chưa so được", không phải "đã sửa".
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Duyệt khoá | Sata Robo",
  robots: { index: false, follow: false },
};

const NHAN: Record<string, { nhan: string; sac: "warning" | "info" | "muted" }> = {
  DRAFT: { nhan: "Nháp", sac: "muted" },
  PENDING_REVIEW: { nhan: "Chờ duyệt", sac: "warning" },
  APPROVED: { nhan: "Đã duyệt — chờ xuất bản", sac: "info" },
};

function ngayGio(d: Date | null): string {
  if (!d) return "—";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.hour}:${p.minute} ngày ${p.day}/${p.month}/${p.year}`;
}

export default async function Page({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
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
        <PageHeader title="Duyệt khoá" />
        <NoPermission permission="elearning:content:author" what="màn duyệt khoá" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const d = await napDuyetKhoa(scopedDb(actor), courseId);
  if (!d) {
    return (
      <TrangQuanTri rong="hep">
        <QuayLai href="/elearning/soan-khoa">Danh sách khoá</QuayLai>
        <EmptyState
          title="Không có bản nào để duyệt"
          description="Khoá không tồn tại, không thuộc phạm vi của bạn, hoặc chưa có phiên bản nào đang soạn/chờ duyệt."
        />
      </TrangQuanTri>
    );
  }

  const nhan = NHAN[d.ban.status] ?? NHAN.DRAFT!;
  const s = d.soSanh;
  // Danh sách thay đổi HỢP NHẤT theo thiết kế (nhãn thêm / bớt / sửa / …). Bài GIỮ NGUYÊN không liệt kê tên (chỉ đếm): so sánh chỉ trả bài ĐỔI, và liệt kê cả bài không đổi
  // làm danh sách dài ra mà không giúp người duyệt quyết định (ca `[QT-P5A-02]` ghim điều này).
  const dongDoi: { nhan: string; sac: "them" | "bot" | "sua" | "khac"; ten: string; moTa: string }[] = s
    ? [
        ...s.them.map((b) => ({ nhan: "thêm", sac: "them" as const, ten: b.title, moTa: "Bài mới trong bản này" })),
        ...s.bot.map((b) => ({ nhan: "bớt", sac: "bot" as const, ten: b.title, moTa: "Bản đang phát hành có bài này, bản này không còn" })),
        ...s.doiNoiDung.map((b) => ({ nhan: "sửa", sac: "sua" as const, ten: b.title, moTa: "Nội dung bài đã đổi" })),
        ...s.doiBatBuoc.map((b) => ({ nhan: "sửa", sac: "sua" as const, ten: b.title, moTa: `${b.tu ? "bắt buộc" : "tuỳ chọn"} → ${b.den ? "bắt buộc" : "tuỳ chọn"}` })),
        ...s.doiThuTu.map((b) => ({ nhan: "thứ tự", sac: "khac" as const, ten: b.title, moTa: "Đổi vị trí trong khoá" })),
      ]
    : [];
  const soBaiGiu = s ? Math.max(0, d.tongBai - new Set([...s.them, ...s.doiNoiDung, ...s.doiBatBuoc, ...s.doiThuTu].map((b) => b.title)).size) : 0;
  return (
    <TrangQuanTri rong="vua">
      <div>
        <QuayLai href="/elearning/soan-khoa?tab=cho-duyet">Chờ duyệt</QuayLai>
        <PageHeader
          className="mb-0 mt-1"
          title={`${d.khoa.title} — bản ${d.ban.nhan}`}
          subtitle={
            <>
              <span className="font-mono text-xs">{d.khoa.code}</span>
              {` · ${nhan.nhan}`}
              {d.ban.nguoiGui ? ` · gửi bởi ${d.ban.nguoiGui}` : ""}
              {d.ban.guiLuc ? ` ${ngayGio(d.ban.guiLuc)}` : ""}
              {d.ban.ghiChu ? ` · ghi chú: ${d.ban.ghiChu}` : ""}
            </>
          }
        />
      </div>

      <div className="mt-6 grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        {/* ── Trái: so với bản đang phát hành + kiểm tra tự động ─────────────── */}
        <div className="min-w-0 space-y-8">
          <section aria-label={d.banDaPhat ? "So với bản đang phát hành" : "So sánh bản"} id="so-sanh-ban" className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">{d.banDaPhat ? `So với bản đang phát hành (${d.banDaPhat.nhan})` : "So sánh bản"}</h2>
            {s === null ? (
              <p className="text-sm text-muted-foreground">Khoá chưa từng xuất bản — chưa có bản nào để so. Toàn bộ nội dung là mới.</p>
            ) : s.khongDoi && s.chuaSoDuoc === 0 ? (
              <p className="text-sm">Không có thay đổi nào so với bản đang phát hành.</p>
            ) : (
              <>
                <ul className="border-t border-border">
                  {dongDoi.map((m, i) => (
                    <li key={`${m.ten}-${i}`} className="flex items-start gap-3 border-b border-border py-3 text-sm">
                      <NhanDoi sac={m.sac}>{m.nhan}</NhanDoi>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{m.ten}</p>
                        <p className="text-[13px] text-muted-foreground">{m.moTa}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                {soBaiGiu > 0 ? <p className="text-[13px] text-muted-foreground">{soBaiGiu} bài giữ nguyên (không liệt kê).</p> : null}
                {s.chuaSoDuoc > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {s.chuaSoDuoc} bài chưa so được nội dung (bản đang phát hành được lưu trước khi hệ thống ghi vân tay) — không có nghĩa là bài đã sửa.
                  </p>
                ) : null}
              </>
            )}
            <p className="text-xs text-muted-foreground">
              So sánh phủ tên, nội dung chữ, nguồn video/phụ đề, thời lượng và đề/khung được gắn. Nội dung câu hỏi bên trong đề thi và tiêu chí bên trong khung
              chấm không nằm trong phép so này.
            </p>
          </section>

          <section aria-label="Kiểm tra tự động" id="cac-cong" className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Kiểm tra tự động</h2>
            {d.kiem.ok ? (
              <ul className="border-t border-border">
                <li className="flex items-center gap-3 border-b border-border py-3 text-sm">
                  <CircleCheck className="h-5 w-5 shrink-0 text-state-success" aria-hidden />
                  Dàn bài hợp lệ — đủ điều kiện để duyệt và xuất bản.
                </li>
              </ul>
            ) : (
              <ul aria-label="Việc còn phải làm" className="border-t border-border">
                {d.kiem.loi.map((l, i) => (
                  <li key={`${l.code}-${i}`} className="flex items-center gap-3 border-b border-border py-3 text-sm">
                    <CircleX className="h-5 w-5 shrink-0 text-state-danger" aria-hidden />
                    {l.chiTiet}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── Phải (dính): Quyết định + bản đang xét ───────────────────────── */}
        <aside aria-label="Quyết định" className="min-w-0 space-y-6 lg:sticky lg:top-20">
          {d.ban.status === "DRAFT" ? (
            <GhiChu sac="info" tieuDe="Bản này còn là nháp">
              Gửi duyệt ở trình soạn trước; khi đó màn này mới có nút Duyệt.
            </GhiChu>
          ) : (
            <section id="quyet-dinh" className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">Quyết định</h2>
              <DuyetHanhDong
                courseId={d.khoa.id}
                trangThai={d.ban.status as "PENDING_REVIEW" | "APPROVED"}
                coQuyen={can(actor, "elearning:content:publish")}
                conLoi={!d.kiem.ok}
              />
            </section>
          )}

          <section id="ban-dang-xet" aria-label="Bản đang xét" className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">Bản đang xét</h2>
            <dl className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">Trạng thái</dt>
                <dd>
                  <TrangThaiBadge sac={nhan.sac}>{nhan.nhan}</TrangThaiBadge>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Người gửi duyệt</dt>
                <dd>{d.ban.nguoiGui ?? "Chưa ghi nhận"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Gửi lúc</dt>
                <dd>{ngayGio(d.ban.guiLuc)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Duyệt lúc</dt>
                <dd>{ngayGio(d.ban.duyetLuc)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Số bài</dt>
                <dd>
                  {d.tongBai} (bắt buộc {d.baiBatBuoc})
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Bản đang phát hành</dt>
                <dd>{d.banDaPhat ? `${d.banDaPhat.nhan} · ${ngayGio(d.banDaPhat.phatLuc)}` : "Chưa có"}</dd>
              </div>
            </dl>
            {d.doiSauKhiGui != null && d.doiSauKhiGui > 0 ? (
              <GhiChu sac="warning" tieuDe={<>Bản đã đổi {d.doiSauKhiGui} chỗ kể từ lúc gửi duyệt</>}>
                Nội dung bài được sửa tại chỗ sau khi gửi. Đọc lại phần “So với bản đang phát hành” trước khi duyệt.
              </GhiChu>
            ) : null}
          </section>
        </aside>
      </div>
    </TrangQuanTri>
  );
}

/** Nhãn loại thay đổi ở đầu dòng (thiết kế: thêm · sửa · giữ). */
function NhanDoi({ sac, children }: { sac: "them" | "bot" | "sua" | "khac"; children: React.ReactNode }) {
  const lop = {
    them: "bg-state-success-soft text-state-success-ink",
    bot: "bg-state-danger-soft text-state-danger-ink",
    sua: "bg-state-warning-soft text-state-warning-ink",
    khac: "bg-muted text-muted-foreground",
  }[sac];
  return <span className={`mt-0.5 inline-flex min-w-12 shrink-0 justify-center rounded-md px-2 py-0.5 text-xs font-medium ${lop}`}>{children}</span>;
}
