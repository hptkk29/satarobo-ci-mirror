// Khu «Ngoại lệ hoá đơn» trong tab Cảnh báo & sai sót (Invoice Hub S12). SERVER component: đọc theo phạm vi kế toán của người xem, bộ lọc nằm TRÊN URL (nl*),
// hành động xử lý là một client component nhỏ ở từng dòng. Không tạo màn mới — khu này nằm trên cùng tab, trước các ngăn lệch số / đơn huỷ / cần điều chỉnh.
//
// Cờ scanner (`hoaDon.hubQuet`) TẮT ⇒ khu KHÔNG hiện (tab giữ nguyên như trước S12). Bốn trạng thái: khung chờ (Suspense ở trang) · rỗng (nói vì sao + làm gì) · lỗi (thử lại) ·
// ngoài phạm vi (cơ sở lọc không thuộc người xem ⇒ coi như không lọc; kế toán không có cơ sở nào ⇒ danh sách rỗng, nói rõ).
//
// Bố cục: MỘT danh sách `<ul>` dạng lưới — mobile xếp dọc, ≥ md thành cột — để chỉ có MỘT bản markup (không trùng id / tab-stop như bản «bảng + thẻ»). Số dòng chặn ở
// `CO_TRANG_NGOAI_LE` (20) và phân trang ở máy chủ (`DieuHuongTrangLink`).
import Link from "next/link";
import { resolveActor } from "@/lib/auth/actor";
import { laHubQuetBat } from "@/lib/finance/hoa-don/feature";
import { docDanhSachNgoaiLe, docTomTatNghiaVu, type DongNgoaiLe } from "@/lib/finance/hoa-don/ngoai-le-db";
import { cauTomTatNghiaVu, type TomTatNghiaVu } from "@/lib/finance/hoa-don/nghia-vu-tom-tat";
import {
  GOI_Y_XU_LY,
  KHOA_URL_NGOAI_LE,
  NHAN_LOAI_NGOAI_LE,
  NHAN_MUC_NGOAI_LE,
  NHAN_TRANG_THAI_NGOAI_LE,
  coSoHopLe,
  dinhDangThoiDiemVN,
  hrefNgoaiLe,
  locDanhSachNgoaiLe,
  type MucNgoaiLeHienThi,
} from "@/lib/finance/hoa-don/ngoai-le-xu-ly";
import { EmptyState, ErrorState } from "@/components/admin/ui/states";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CHU_PILL } from "./mau-pill";
import { NgoaiLeHanhDong } from "./ngoai-le-hanh-dong";

export type ThamSoNgoaiLe = { nlNhom?: string; nlMuc?: string; nlLoai?: string; nlTrang?: string };

const TONE_MUC: Record<MucNgoaiLeHienThi, PillTone> = { KHAN: "danger", CAN_XU_LY: "warning", THONG_TIN: "info" };
const TONE_TRANG_THAI: Record<string, PillTone> = { MO: "warning", DANG_XU_LY: "info", DA_XU_LY: "success", BO_QUA_CO_LY_DO: "muted" };

/** Lưới của một dòng khi KHUNG CHỨA rộng ≥ 56rem (`@4xl`): mức · việc · đơn & cơ sở · thời điểm & trạng thái · hành động. Hẹp hơn thì các ô xếp dọc.
 * Theo khung chứa, KHÔNG theo viewport: thanh bên chiếm chỗ nên viewport 768px chỉ còn ~500px cho nội dung (đo bằng trình duyệt thật: 39 phần tử tràn ở 768px khi dùng `md:`). */
const LUOI_DONG = "@4xl:grid-cols-[6rem_minmax(0,1fr)_minmax(0,11rem)_9.5rem_minmax(0,18rem)]";

const NHAN_CHIP = "inline-flex min-h-8 items-center rounded-full border px-3 text-sm pointer-coarse:min-h-11";
const CHIP_DANG_CHON = "border-primary bg-primary/10 font-semibold text-foreground";
const CHIP_THUONG = "border-border text-muted-foreground hover:bg-muted hover:text-foreground";
const O_CHON = "h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm pointer-coarse:h-11";

export function KhuNgoaiLeKhung() {
  return (
    <section aria-busy="true" aria-label="Đang tải ngoại lệ hoá đơn" className="mb-6 rounded-xl border border-border bg-card p-4 sm:p-5">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-2 h-4 w-3/4 max-w-xl" />
      <div className="mt-4 space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </section>
  );
}

function Dong({ d }: { d: DongNgoaiLe }) {
  const muc = (d.muc in NHAN_MUC_NGOAI_LE ? d.muc : "CAN_XU_LY") as MucNgoaiLeHienThi;
  const nhanLoai = NHAN_LOAI_NGOAI_LE[d.loai] ?? d.loai;
  const viec = `${nhanLoai}${d.maDon ? ` — đơn ${d.maDon}` : ""}`;
  const dong = d.trangThai === "DA_XU_LY" || d.trangThai === "BO_QUA_CO_LY_DO";
  const tone = TONE_TRANG_THAI[d.trangThai] ?? "muted";
  return (
    <li className={cn("grid gap-x-4 gap-y-2 px-4 py-3 sm:px-5 @4xl:items-start", LUOI_DONG)}>
      <div className="flex flex-wrap items-center gap-2 @4xl:block">
        <StatusPill tone={TONE_MUC[muc]} className={CHU_PILL[TONE_MUC[muc]]}>
          {NHAN_MUC_NGOAI_LE[muc]}
        </StatusPill>
      </div>

      <div className="min-w-0">
        <p className="font-medium text-foreground">{nhanLoai}</p>
        {dong && d.lyDoXuLy ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground" title={d.lyDoXuLy}>
            Lý do: {d.lyDoXuLy}
          </p>
        ) : (
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground" title={GOI_Y_XU_LY[d.loai]}>
            {GOI_Y_XU_LY[d.loai] ?? "Xem lại khoản thu và hoá đơn của đơn này."}
          </p>
        )}
      </div>

      <div className="min-w-0 text-sm">
        {d.orderId ? (
          <Link href={`/orders/${d.orderId}`} className="inline-flex min-h-6 items-center font-medium text-primary underline-offset-2 hover:underline pointer-coarse:min-h-11">
            {d.maDon ?? "Mở đơn"}
          </Link>
        ) : (
          <span className="text-muted-foreground">Không gắn đơn</span>
        )}
        <p className="truncate text-xs text-muted-foreground" title={d.tenCoSo}>
          {d.tenCoSo}
        </p>
        {/* Ba nút bên phải CHỈ ghi trạng thái — việc thật (hoàn phần dư, gắn đợt, sửa người mua…) làm ở ĐƠN. Nút này là lối đi
            thẳng tới đó, chỉ hiện khi ngoại lệ còn mở (đã đóng thì không còn việc cần làm). */}
        {!dong && d.orderId ? (
          <Link href={`/orders/${d.orderId}`} className="mt-1.5 inline-flex min-h-8 items-center gap-1 rounded-md border border-input px-2.5 text-xs font-medium text-foreground hover:bg-muted pointer-coarse:min-h-11">
            Mở đơn để xử lý <span aria-hidden>→</span>
          </Link>
        ) : null}
        {d.hoaDonId ? (
          <Link href={`/payments/hoa-don?hoaDon=${encodeURIComponent(d.hoaDonId)}`} className="inline-flex min-h-6 items-center text-xs text-primary underline-offset-2 hover:underline pointer-coarse:min-h-11">
            Xem hoá đơn liên quan
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 @4xl:flex-col @4xl:items-start @4xl:gap-1">
        <StatusPill tone={tone} className={CHU_PILL[tone]}>
          {NHAN_TRANG_THAI_NGOAI_LE[d.trangThai as keyof typeof NHAN_TRANG_THAI_NGOAI_LE] ?? d.trangThai}
        </StatusPill>
        <time dateTime={d.createdAt.toISOString()} className="text-xs text-muted-foreground">
          {dinhDangThoiDiemVN(d.createdAt)}
        </time>
      </div>

      <NgoaiLeHanhDong id={d.id} viec={viec} hanhDong={d.hanhDong} />
    </li>
  );
}

/** Tóm tắt nghĩa vụ scanner đã ghi — PHỤ: lỗi ở đây KHÔNG được làm hỏng cả khu (chỉ mất dòng tóm tắt), nên nuốt lỗi và trả `null`. */
async function docTomTatPhu(actor: Awaited<ReturnType<typeof resolveActor>>, coSoId: string | null): Promise<TomTatNghiaVu | null> {
  try {
    return await docTomTatNghiaVu(actor, { coSoId });
  } catch {
    return null;
  }
}

export async function KhuNgoaiLe({ userId, sp }: { userId: string; sp: Record<string, string | undefined> & ThamSoNgoaiLe }) {
  // Cờ TẮT ⇒ tab giữ nguyên như trước S12.
  if (!(await laHubQuetBat())) return null;

  const loc = locDanhSachNgoaiLe(sp);
  const hienTai = sp as Record<string, string | undefined>;
  const hrefDoi = (doi: Parameters<typeof hrefNgoaiLe>[1]) => hrefNgoaiLe(hienTai, doi);
  const coLoc = loc.muc !== null || loc.loai !== null;

  let kq: Awaited<ReturnType<typeof docDanhSachNgoaiLe>>;
  let tomTat: TomTatNghiaVu | null;
  try {
    const actor = await resolveActor(userId);
    const coSoId = coSoHopLe(actor, sp.coSo);
    kq = await docDanhSachNgoaiLe(actor, loc, { coSoId });
    tomTat = await docTomTatPhu(actor, coSoId);
  } catch {
    return (
      <section aria-labelledby="khu-nl-tieu-de" className="mb-6 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 id="khu-nl-tieu-de" className="text-base font-semibold text-foreground">
          Ngoại lệ hoá đơn
        </h2>
        <ErrorState
          title="Không tải được ngoại lệ hoá đơn"
          description="Có lỗi khi đọc danh sách. Các ngăn bên dưới vẫn dùng bình thường."
          action={
            <Link href={hrefDoi({})} className="inline-flex min-h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-muted pointer-coarse:min-h-11">
              Thử lại
            </Link>
          }
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="khu-nl-tieu-de" className="@container mb-6 rounded-xl border border-border bg-card">
      <div className="px-4 pt-4 sm:px-5">
        <h2 id="khu-nl-tieu-de" className="text-base font-semibold text-foreground">
          Ngoại lệ hoá đơn
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Hệ thống tự phát hiện những việc cần người quyết (kiểm tra mỗi 10 phút) và báo kế toán của cơ sở. Xử lý ngay tại đây; ngoại lệ tự đóng khi nguyên nhân không còn.
        </p>
        {tomTat ? (
          <p data-khu="tom-tat-nghia-vu" className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground">
            {cauTomTatNghiaVu(tomTat)}
          </p>
        ) : null}
      </div>

      <nav aria-label="Nhóm ngoại lệ" className="mt-3 flex flex-wrap items-center gap-2 px-4 sm:px-5">
        <Link href={hrefDoi({ nlNhom: null })} aria-current={loc.nhom === "DANG_MO" ? "page" : undefined} className={cn(NHAN_CHIP, loc.nhom === "DANG_MO" ? CHIP_DANG_CHON : CHIP_THUONG)}>
          Đang mở ({kq.dem.dangMo})
        </Link>
        <Link href={hrefDoi({ nlNhom: "DA_DONG" })} aria-current={loc.nhom === "DA_DONG" ? "page" : undefined} className={cn(NHAN_CHIP, loc.nhom === "DA_DONG" ? CHIP_DANG_CHON : CHIP_THUONG)}>
          Đã đóng ({kq.dem.daDong})
        </Link>
        {kq.dem.khan > 0 ? (
          <StatusPill tone="danger" className={CHU_PILL.danger}>
            {kq.dem.khan} khẩn đang mở
          </StatusPill>
        ) : null}
      </nav>

      {/* Bộ lọc GET: chạy không cần JS; giữ nguyên mọi tham số khác của tab (cơ sở, tháng…) bằng ô ẩn. */}
      <form method="get" action="/payments/hoa-don/canh-bao" className="mt-3 flex flex-wrap items-end gap-3 px-4 sm:px-5">
        {Object.entries(hienTai)
          .filter(([k, v]) => v && !(KHOA_URL_NGOAI_LE as readonly string[]).includes(k))
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        {loc.nhom === "DA_DONG" ? <input type="hidden" name="nlNhom" value="DA_DONG" /> : null}
        {/* Nhãn TÁCH khỏi ô chọn (htmlFor/id), không bao quanh: nhãn bao quanh làm tên truy cập thành «Mức Tất cả Khẩn …» (đo bằng trình duyệt thật). */}
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="nl-muc" className="text-xs font-medium text-muted-foreground">
            Mức
          </label>
          <select id="nl-muc" name="nlMuc" defaultValue={loc.muc ?? ""} className={O_CHON}>
            <option value="">Tất cả</option>
            {Object.entries(NHAN_MUC_NGOAI_LE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="nl-loai" className="text-xs font-medium text-muted-foreground">
            Loại
          </label>
          <select id="nl-loai" name="nlLoai" defaultValue={loc.loai ?? ""} className={cn(O_CHON, "max-w-[16rem]")}>
            <option value="">Tất cả</option>
            {Object.entries(NHAN_LOAI_NGOAI_LE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-muted pointer-coarse:h-11">
          Lọc
        </button>
        {coLoc ? (
          <Link href={hrefDoi({ nlMuc: null, nlLoai: null })} className="inline-flex min-h-9 items-center text-sm text-primary underline-offset-2 hover:underline pointer-coarse:min-h-11">
            Bỏ lọc
          </Link>
        ) : null}
      </form>

      {kq.dong.length === 0 ? (
        <div className="px-4 py-4 sm:px-5">
          {coLoc || kq.tong > 0 || kq.trang > 1 ? (
            <EmptyState
              title="Không có ngoại lệ nào khớp"
              description={kq.trang > 1 ? "Trang này không còn dòng nào — có thể ngoại lệ vừa được xử lý." : "Thử bỏ bộ lọc hoặc chuyển sang nhóm khác."}
              action={
                <Link href={kq.trang > 1 ? hrefDoi({ nlTrang: null }) : hrefDoi({ nlMuc: null, nlLoai: null })} className="inline-flex min-h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-muted pointer-coarse:min-h-11">
                  {kq.trang > 1 ? "Về trang đầu" : "Bỏ lọc"}
                </Link>
              }
            />
          ) : loc.nhom === "DANG_MO" ? (
            <EmptyState title="Không có ngoại lệ nào đang mở" description="Hệ thống kiểm tra mỗi 10 phút. Có việc cần người quyết thì nó hiện ở đây và báo cho kế toán của cơ sở." />
          ) : (
            <EmptyState title="Chưa có ngoại lệ nào đã đóng" description="Ngoại lệ đã xử lý hoặc đã bỏ qua sẽ nằm ở đây để tra lại." />
          )}
        </div>
      ) : (
        <>
          <div aria-hidden="true" className={cn("mt-3 hidden gap-x-4 border-y border-border/60 bg-muted/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground @4xl:grid", LUOI_DONG)}>
            <span>Mức</span>
            <span>Việc cần làm</span>
            <span>Đơn · Cơ sở</span>
            <span>Phát hiện</span>
            <span>Xử lý</span>
          </div>
          <ul role="list" className="mt-3 divide-y divide-border/60 border-t border-border/60 @4xl:mt-0 @4xl:border-t-0">
            {kq.dong.map((d) => (
              <Dong key={d.id} d={d} />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 sm:px-5">
            <p className="text-xs text-muted-foreground">
              {kq.tong} ngoại lệ · trang {kq.trang}/{kq.soTrang}
            </p>
            <DieuHuongTrangLink trang={kq.trang} soTrang={kq.soTrang} hrefCua={(t) => hrefDoi({ nlTrang: t <= 1 ? null : String(t) })} />
          </div>
        </>
      )}
    </section>
  );
}
