import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { napHangChoTap, napLuotNopDeCham, type LuotNopDeCham } from "@/lib/elearning/task-grading-queue";
import { SLA_GRADE_DAYS } from "@/lib/elearning/metrics/constants";
import { TAB_CHAM, chuHanCham, idKeTiep, locHangCham, type TabCham } from "@/lib/elearning/cham-bai-tap-hien";
import { hrefTab, tabDangMo, type SearchParamsTho } from "@/lib/elearning/tab-url";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TabNav } from "../_components/ui/tab-nav";
import { GhiChu, KhoiRong, QuayLai, TrangQuanTri } from "../_components/ui/trang";
import { NHAN_O, O_NHAP, NUT_PHU } from "../_components/ui/dieu-khien";
import { TaskGradingForm } from "./_components/task-grading-form";

/**
 * EL-15c + P8 — CHẤM BÀI TẬP theo thiết kế `QtChamBai` (master-detail): danh sách chờ chấm bên trái, khung chấm bên phải, chuyển bài bằng `?id=`.
 *
 * ⚠️ Xếp theo HẠN CHẤM, không theo lúc nộp: hai lượt nộp cùng ngày có hạn khác nhau nếu vắt qua cuối tuần, và thứ người chấm cần biết là
 * "cái nào sắp vỡ SLA". Nghiệp vụ chấm KHÔNG đổi: cùng `napHangChoTap` / `napLuotNopDeCham` (qua `scopedDb`) và cùng `chamBaiTapAction`
 * (chấm trọn một lượt, không nháp; không tự chấm bài của mình). Trang chi tiết riêng `/cham-bai-tap/[submissionId]` vẫn dùng được (liên kết cũ).
 *
 * ⚠️ MIỀN DỮ LIỆU: tab "Nhân viên" đọc `TrnSubmission` (nội bộ). Tab "Học viên online" thuộc miền ONLINE — hiện KHÔNG có mô hình nộp sản phẩm/khung chấm
 * ở `Onl*` (chỉ có `OnlAssessment`/`OnlAttempt` tự chấm), nên tab nói thẳng là chưa có luồng, KHÔNG đọc `Trn*` thay thế. Xem D-44.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chấm bài tập | Sata Robo",
  robots: { index: false, follow: false },
};

const dinhDang = (d: Date) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(d);
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
        <PageHeader title="Chấm bài tập và sản phẩm" />
        <NoPermission permission="elearning:exam:grade" what="hàng chờ chấm bài" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const tab = tabDangMo(sp, TAB_CHAM, "tat-ca") as TabCham;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";
  const idTho = Array.isArray(sp.id) ? sp.id[0] : sp.id;

  const now = new Date();
  const db = scopedDb(actor);
  const { dong, conNua } = await napHangChoTap(db, { bayGio: now });
  const dsNoiBo = dong; // nguồn nội bộ (Trn*) — nguồn online chưa có (D-44)
  const hienTai = tab === "hoc-vien-online" ? [] : locHangCham(dsNoiBo, q);
  const idChon = idTho && hienTai.some((d) => d.submissionId === idTho) ? idTho : (hienTai[0]?.submissionId ?? null);

  // Khung chấm của bài đang chọn. Lỗi tải ⇒ báo TRONG khung phải, danh sách bên trái vẫn dùng được.
  let luot: LuotNopDeCham | null = null;
  let loiTai = false;
  if (idChon) {
    try {
      luot = await napLuotNopDeCham(db, idChon);
    } catch {
      loiTai = true;
    }
  }
  const giuLai = { q };
  const hrefBai = (id: string) => `${hrefTab("/elearning/cham-bai-tap", tab, giuLai)}&id=${encodeURIComponent(id)}`;
  const idTiep = idChon ? idKeTiep(hienTai, idChon) : null;
  const hrefTiep = idTiep ? hrefBai(idTiep) : hrefTab("/elearning/cham-bai-tap", tab, giuLai);
  const dongChon = hienTai.find((d) => d.submissionId === idChon);

  return (
    <TrangQuanTri rong="vua">
      <div>
        <QuayLai href="/elearning/cham-bai">Chấm bài thi</QuayLai>
        <PageHeader
          className="mb-0 mt-1"
          title="Chấm bài tập và sản phẩm"
          subtitle={
            <>
              Bài tập của nhân viên và sản phẩm của học viên khoá online. Hạn chấm là <strong>{SLA_GRADE_DAYS} ngày làm việc</strong> kể từ lúc nộp,
              không ai chấm được bài của chính mình.
            </>
          }
        />
      </div>

      <TabNav
        duongDan="/elearning/cham-bai-tap"
        nhanDanhSach="Nguồn bài chờ chấm"
        dangMo={tab}
        giuLai={giuLai}
        tab={[
          { id: "tat-ca", nhan: "Tất cả", dem: dsNoiBo.length },
          { id: "nhan-vien", nhan: "Nhân viên", dem: dsNoiBo.length },
          { id: "hoc-vien-online", nhan: "Học viên online" },
        ]}
      />

      {conNua ? <GhiChu sac="warning">Còn bài chờ chấm ngoài danh sách này — chấm bớt rồi tải lại trang.</GhiChu> : null}

      {tab === "hoc-vien-online" ? (
        <KhoiRong
          title="Chưa có luồng nộp sản phẩm cho học viên online"
          description="Khoá online hiện chỉ có bài kiểm tra tự chấm. Chấm sản phẩm của học viên cần mô hình nộp bài và khung chấm riêng của miền Online — đang chờ quyết định (xem D-44); bài của nhân viên ở tab Nhân viên."
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <section aria-label="Bài đang chờ chấm" className="space-y-3">
            <form method="get" action="/elearning/cham-bai-tap" role="search" aria-label="Tìm bài chờ chấm" className="flex items-end gap-2">
              <input type="hidden" name="tab" value={tab} />
              <label className={`${NHAN_O} min-w-0 flex-1`}>
                <span className="sr-only">Tìm người học hoặc tên bài</span>
                <input name="q" defaultValue={q} placeholder="Tìm người học hoặc bài" className={O_NHAP} />
              </label>
              <button type="submit" className={NUT_PHU}>
                Tìm
              </button>
            </form>
            {hienTai.length === 0 ? (
              <KhoiRong
                title={dsNoiBo.length === 0 ? "Không có bài tập nào đang chờ chấm" : "Không có bài nào khớp"}
                description={dsNoiBo.length === 0 ? "Khi người học nộp bài tập, bài sẽ xuất hiện ở đây theo hạn chấm." : "Thử bỏ từ khoá tìm kiếm."}
              />
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {hienTai.map((d) => {
                  const han = chuHanCham(d, now);
                  const chon = d.submissionId === idChon;
                  return (
                    <li key={d.submissionId}>
                      <Link
                        href={hrefBai(d.submissionId)}
                        aria-current={chon ? "true" : undefined}
                        className={`block border-l-2 px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring ${chon ? "border-primary bg-card" : "border-transparent hover:bg-card/60"}`}
                      >
                        <span className="block text-sm text-foreground">{d.tenNguoiHoc}</span>
                        <span className="block text-xs text-muted-foreground">Nhân viên · {d.tenBai}</span>
                        <span className={`mt-1 block text-xs ${MAU[han.sac]}`}>{han.chu}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-label="Khung chấm" className="min-w-0 space-y-4">
            {loiTai ? (
              <EmptyState title="Không tải được bài này" description="Có lỗi khi đọc bài nộp. Tải lại trang hoặc chọn bài khác; nếu vẫn lỗi, báo kỹ thuật." />
            ) : !idChon ? (
              <KhoiRong title="Chưa có bài để chấm" description="Chọn một bài ở danh sách bên trái khi có bài chờ chấm." />
            ) : !luot ? (
              <EmptyState title="Không mở được lượt nộp này" description="Có thể đã có người chấm xong, hoặc lượt nộp không thuộc phạm vi của bạn." />
            ) : (
              <>
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-medium text-foreground">{luot.tenBai}</h2>
                    <p className="text-sm text-muted-foreground">
                      {luot.tenNguoiHoc} · {luot.nopLuc ? `nộp ${dinhDang(luot.nopLuc)} · ` : ""}lần {luot.attemptNo} · chấm theo {luot.tenKhung}
                    </p>
                  </div>
                  {dongChon ? <span className={`text-sm ${MAU[chuHanCham(dongChon, now).sac]}`}>{chuHanCham(dongChon, now).chu}</span> : null}
                </header>
                {luot.nguoiHocUserId === session.user.id ? (
                  <GhiChu sac="warning">
                    <span role="note">Đây là bài nộp của chính bạn — không tự chấm được. Nhờ một người khác có quyền chấm xử lý.</span>
                  </GhiChu>
                ) : (
                  <TaskGradingForm key={luot.submissionId} luot={luot} hrefTiep={hrefTiep} />
                )}
              </>
            )}
          </section>
        </div>
      )}
    </TrangQuanTri>
  );
}
