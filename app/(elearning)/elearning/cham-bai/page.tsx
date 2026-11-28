import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { napHangCho, napLuotDeCham, type LuotDeCham } from "@/lib/elearning/exam-grading-queue";
import { TAB_CHAM_THI, cauTomTatMay, idThiKeTiep, locHangThi, nhanCho, tomTatMayCham, type TabChamThi } from "@/lib/elearning/cham-thi-hien";
import { hrefTab, tabDangMo, type SearchParamsTho } from "@/lib/elearning/tab-url";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TabNav } from "../_components/ui/tab-nav";
import { GhiChu, KhoiRong, QuayLai, TrangQuanTri } from "../_components/ui/trang";
import { LIEN_KET_CHU, NHAN_O, NUT_PHU, O_NHAP } from "../_components/ui/dieu-khien";
import { GradingForm } from "./_components/grading-form";

/**
 * EL-14e + P8 — CHẤM BÀI THI TỰ LUẬN theo thiết kế `QtChamThi` (master-detail): hàng chờ bên trái, lượt đang chấm bên phải, chuyển lượt bằng `?id=`.
 *
 * ⚠️ Màn này là LỐI RA của trạng thái `PENDING_GRADE`. Không có nó thì mọi lượt thi có câu tự luận treo vĩnh viễn: điểm mãi `null`, bài không
 * bao giờ xong, và người học đứng nguyên tại một bài nghĩa vụ có hạn chót cứng cho tới lúc bị khoá vì quá hạn.
 *
 * Nghiệp vụ KHÔNG đổi: cùng `napHangCho` / `napLuotDeCham` (qua `scopedDb` — lượt đọc chính là cổng cách ly cơ sở) và cùng `chamLuotThiAction`
 * (chấm TRỌN một lượt, không nháp; không tự chấm bài của mình). Người chờ lâu nhất xếp trước. Trang riêng `/cham-bai/[attemptId]` vẫn dùng được (liên kết cũ).
 *
 * ⚠️ MIỀN DỮ LIỆU: chỉ lượt thi NỘI BỘ (`TrnExamAttempt`). Bài kiểm tra của khoá online thuộc miền Online (`OnlAttempt`, tự chấm hoàn toàn — chưa có câu
 * tự luận chấm tay), nên tab "Học viên online" nói thẳng là chưa có hàng chờ, KHÔNG đọc `Trn*` thay thế (D-44).
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chấm bài thi | Sata Robo",
  robots: { index: false, follow: false },
};

const dinhDang = (d: Date) =>
  new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(d);
const MAU = { danger: "text-state-danger-ink", warning: "text-state-warning-ink", muted: "text-muted-foreground" } as const;

export default async function Page({ searchParams }: { searchParams: Promise<SearchParamsTho> }) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:exam:grade")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Chấm bài thi tự luận" />
        <NoPermission permission="elearning:exam:grade" what="hàng chờ chấm bài thi" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const tab = tabDangMo(sp, TAB_CHAM_THI, "nhan-vien") as TabChamThi;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";
  const idTho = Array.isArray(sp.id) ? sp.id[0] : sp.id;

  const db = scopedDb(actor);
  const { dong: dsNoiBo, conNua } = await napHangCho(db, { bayGio: new Date() });
  const hienTai = tab === "hoc-vien-online" ? [] : locHangThi(dsNoiBo, q);
  const idChon = idTho && hienTai.some((d) => d.attemptId === idTho) ? idTho : (hienTai[0]?.attemptId ?? null);

  // Lượt đang chọn. Lỗi tải ⇒ báo TRONG khung phải, danh sách bên trái vẫn dùng được.
  let luot: LuotDeCham | null = null;
  let loiTai = false;
  if (idChon) {
    try {
      luot = await napLuotDeCham(db, idChon);
    } catch {
      loiTai = true;
    }
  }
  const giuLai = { q };
  const hrefLuot = (id: string) => `${hrefTab("/elearning/cham-bai", tab, giuLai)}&id=${encodeURIComponent(id)}`;
  const idTiep = idChon ? idThiKeTiep(hienTai, idChon) : null;
  const hrefTiep = idTiep ? hrefLuot(idTiep) : hrefTab("/elearning/cham-bai", tab, giuLai);
  const tomTat = luot ? tomTatMayCham(luot.cacCau) : null;

  return (
    <TrangQuanTri rong="vua">
      <div>
        <nav aria-label="Liên quan" className="flex flex-wrap gap-x-4">
          <QuayLai href="/elearning/de-thi">Đề thi</QuayLai>
          {/* Nối chéo hai hàng chờ: cùng NGƯỜI chấm, khác nhịp và khác hình dạng nên tách màn — nhưng người chấm phải đi lại được giữa hai bên. */}
          <Link href="/elearning/cham-bai-tap" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
            Chấm bài tập
          </Link>
        </nav>
        <PageHeader className="mb-0 mt-1" title="Chấm bài thi tự luận" subtitle="Người chờ lâu nhất xếp trước." />
      </div>

      <TabNav
        duongDan="/elearning/cham-bai"
        nhanDanhSach="Nguồn bài thi chờ chấm"
        dangMo={tab}
        giuLai={giuLai}
        tab={[
          { id: "nhan-vien", nhan: "Nhân viên", dem: dsNoiBo.length },
          { id: "hoc-vien-online", nhan: "Học viên online" },
        ]}
      />

      {conNua ? (
        // Im lặng cắt danh sách là để người chấm đọc hết trang rồi tin là hết việc.
        <GhiChu sac="warning">Còn bài chờ chấm ngoài danh sách này — chấm bớt rồi tải lại trang để thấy tiếp.</GhiChu>
      ) : null}

      {tab === "hoc-vien-online" ? (
        <KhoiRong
          title="Khoá online chưa có bài thi chấm tay"
          description="Bài kiểm tra của khoá online hiện được hệ thống tự chấm hoàn toàn nên không có hàng chờ. Khi miền Online có câu tự luận chấm tay sẽ có hàng chờ riêng, tách khỏi nhân viên (xem D-44). Bài thi của nhân viên ở tab Nhân viên."
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <section aria-label="Bài thi đang chờ chấm" className="space-y-3">
            <form method="get" action="/elearning/cham-bai" role="search" aria-label="Tìm bài thi chờ chấm" className="flex items-end gap-2">
              <input type="hidden" name="tab" value={tab} />
              <label className={`${NHAN_O} min-w-0 flex-1`}>
                <span className="sr-only">Tìm người học hoặc tên đề</span>
                <input name="q" defaultValue={q} placeholder="Tìm người học hoặc đề" className={O_NHAP} />
              </label>
              <button type="submit" className={NUT_PHU}>
                Tìm
              </button>
            </form>
            {hienTai.length === 0 ? (
              <KhoiRong
                title={dsNoiBo.length === 0 ? "Không có bài nào đang chờ chấm" : "Không có bài nào khớp"}
                description={
                  dsNoiBo.length === 0 ? "Lượt thi có câu tự luận sẽ vào hàng chờ này sau khi người học nộp bài." : "Thử bỏ từ khoá tìm kiếm."
                }
              />
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {hienTai.map((d) => {
                  const cho = nhanCho(d.soNgayCho);
                  const chon = d.attemptId === idChon;
                  return (
                    <li key={d.attemptId}>
                      <Link
                        href={hrefLuot(d.attemptId)}
                        aria-current={chon ? "true" : undefined}
                        className={`block border-l-2 px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring ${chon ? "border-primary bg-card" : "border-transparent hover:bg-card/60"}`}
                      >
                        <span className="block text-sm text-foreground">{d.tenNguoiHoc}</span>
                        <span className="block text-xs text-muted-foreground">
                          Nhân viên · {d.tenDe} · lượt {d.attemptNo}
                        </span>
                        <span className={`mt-1 block text-xs ${MAU[cho.sac]}`}>{cho.chu}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-label="Khung chấm bài thi" className="min-w-0 space-y-4">
            {loiTai ? (
              <EmptyState title="Không tải được bài này" description="Có lỗi khi đọc bài thi. Tải lại trang hoặc chọn bài khác; nếu vẫn lỗi, báo kỹ thuật." />
            ) : !idChon ? (
              <KhoiRong title="Chưa có bài để chấm" description="Chọn một bài ở danh sách bên trái khi có bài chờ chấm." />
            ) : !luot ? (
              // Không phân biệt "không có" với "đã chấm rồi" thì người chấm bấm vào một dòng cũ sẽ gặp trang trắng và tưởng hỏng. Nói cả hai khả năng.
              <EmptyState title="Không mở được lượt này" description="Có thể đã có người chấm xong, hoặc lượt thi không thuộc phạm vi của bạn." />
            ) : (
              <>
                <header className="min-w-0">
                  <h2 className="text-lg font-medium text-foreground">{luot.tenDe}</h2>
                  <p className="text-sm text-muted-foreground">
                    {luot.tenNguoiHoc} · {luot.nopLuc ? `nộp ${dinhDang(luot.nopLuc)} · ` : ""}lượt {luot.attemptNo}
                  </p>
                </header>
                {tomTat ? <GhiChu sac="info">{cauTomTatMay(tomTat)}</GhiChu> : null}
                {luot.nguoiHocUserId === session.user.id ? (
                  <GhiChu sac="warning">
                    <span role="note">Đây là bài thi của chính bạn — không tự chấm được. Nhờ một người khác có quyền chấm xử lý.</span>
                  </GhiChu>
                ) : (
                  <GradingForm
                    key={luot.attemptId}
                    attemptId={luot.attemptId}
                    passScore={luot.passScore}
                    maxScore={luot.maxScore}
                    cacCau={luot.cacCau}
                    hrefTiep={hrefTiep}
                  />
                )}
              </>
            )}
          </section>
        </div>
      )}
    </TrangQuanTri>
  );
}
