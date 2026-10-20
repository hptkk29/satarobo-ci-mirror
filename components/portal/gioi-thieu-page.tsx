// components/portal/gioi-thieu-page.tsx — trang «Giới thiệu» của cổng (AFF-P3 H3): đối tác xem link, lượt bấm, khách giới thiệu và hoa hồng CỦA CHÍNH MÌNH; (AFF-WEB) tự tạo link ở MỘT form.
//
// Server component thuần (chỉ form tạo link, nút sao chép và nút QR là client). Dữ liệu vào là `GioiThieuCuaToi` — kiểu đó KHÔNG có chỗ chứa tên/SĐT/email khách hay id nội bộ (xem `lib/affiliate/cua-toi.ts`),
// nên giao diện không thể làm rò chúng dù có muốn. Mỗi con số nói đúng thứ nó đếm; tiền «chờ chi» = mọi dòng chưa `PAID`.
import { Gift, TriangleAlert } from "lucide-react";

import { NutQrLinkCuaToi } from "@/components/portal/nut-qr-link-cua-toi";
import { NutSaoChepLink } from "@/components/portal/nut-sao-chep-link";
import { PageHero } from "@/components/portal/page-header";
import { TaoLinkCuaToiForm } from "@/components/portal/tao-link-cua-toi";
import {
  NHAN_CHI_DOI_TAC,
  NHAN_REFERRAL_DOI_TAC,
  NHAN_TRANG_THAI_DOI_TAC,
  TRANG_THAI_DEM_CHO_DOI_TAC,
  type GioiThieuCuaToi,
} from "@/lib/affiliate/cua-toi";
import { dinhDangDong, dinhDangSo } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

// ON_HOLD (AFF-L2): đối tác TỔ CHỨC có tiền đang giữ — ô «Đang giữ» chỉ hiện khi có dòng, để đối tác cá nhân không thấy một ô 0đ vô nghĩa. Tổng dòng thì cộng ĐỦ năm trạng thái.
const TRANG_THAI_CHI = ["PENDING", "APPROVED", "EXPORTED", "PAID"] as const;
const TRANG_THAI_CHI_DU = ["ON_HOLD", ...TRANG_THAI_CHI] as const;

/** Ngày giờ VN từ ISO — ép múi giờ (server chạy UTC, không ép thì 00:00–07:00 giờ VN lùi một ngày). */
function ngayVN(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}
const so = (n: number) => dinhDangSo(n);

// Bảng ở khung hẹp (< sm = dưới 640px): MỖI HÀNG THÀNH MỘT THẺ (nhãn trái · giá trị phải), không cuộn ngang. Bản cũ giữ `min-w-[480px]`/`[520px]` nên ở 375px cột «Trạng thái» / «Số tiền» — thứ người
// giới thiệu mở trang này để xem — nằm NGOÀI màn hình, bị cắt dở chữ («Đã g…», «123…») và không có dấu hiệu nào báo là cuộn ngang được (phát hiện bằng Playwright 375px, tests/e2e/a0/affiliate-375.spec.ts).
// Vẫn là <table> thật (tiêu đề cột chỉ ẩn thị giác bằng sr-only), ≥ sm giữ nguyên bảng và vùng cuộn ngang.
const BANG = "w-full border-collapse text-left text-sm sm:min-w-[480px] max-sm:block";
const HANG = "border-b border-border last:border-0 max-sm:block max-sm:px-3 max-sm:py-2.5";
const O =
  "px-3 py-2 max-sm:flex max-sm:justify-between max-sm:gap-4 max-sm:px-0 max-sm:py-0.5 max-sm:text-right max-sm:before:shrink-0 max-sm:before:text-left max-sm:before:text-xs max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-nhan)]";

function The({ nhan, gia, ghiChu, soLieu }: { nhan: string; gia: string; ghiChu?: string; soLieu: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{nhan}</p>
      <p data-so={soLieu} className="mt-1 break-words text-xl font-bold tabular-nums text-foreground sm:text-2xl">
        {gia}
      </p>
      {ghiChu && <p className="mt-1 text-xs text-muted-foreground">{ghiChu}</p>}
    </div>
  );
}

function Muc({ id, tieuDe, moTa, children }: { id: string; tieuDe: string; moTa?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-td`} className="mt-8">
      <h2 id={`${id}-td`} className="text-base font-bold text-foreground">
        {tieuDe}
      </h2>
      {moTa && <p className="mt-0.5 text-sm text-muted-foreground">{moTa}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function GioiThieuPageV2({ data }: { data: GioiThieuCuaToi }) {
  const { referral, hoaHong, luotBam } = data;
  const tenDoiTac = data.doiTac.map((d) => d.ten).join(", ");
  const conHoatDong = data.doiTac.some((d) => d.trangThai === "ACTIVE");
  // `hoaHong` là null khi KHÔNG chương trình nào cho đối tác thấy số tiền: khi đó trang không có chỗ nào để vẽ một con số tiền.
  const tongDongHoaHong = hoaHong === null ? 0 : TRANG_THAI_CHI_DU.reduce((n, t) => n + hoaHong.theoTrangThai[t].soDong, 0);

  return (
    <div data-gioi-thieu>
      <PageHero icon={Gift} overline="Đối tác giới thiệu" title="Giới thiệu bạn bè" subtitle={`Hồ sơ: ${tenDoiTac}`} />

      {!conHoatDong && (
        <p role="status" data-khong-hoat-dong className="mb-4 flex items-start gap-2 rounded-xl bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            Hồ sơ đối tác của bạn hiện {data.doiTac.map((d) => NHAN_TRANG_THAI_DOI_TAC[d.trangThai].toLowerCase()).join(", ")}. Link giới thiệu sẽ không ghi nhận khách mới cho tới khi hồ sơ hoạt động trở lại — liên hệ trung tâm để được hỗ trợ.
          </span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <The soLieu="luot-bam" nhan="Lượt bấm link" gia={so(luotBam.hopLe)} ghiChu={luotBam.khongDung > 0 ? `+ ${so(luotBam.khongDung)} lượt vào link không còn dùng được` : "Link dùng được"} />
        <The soLieu="da-ghi-nhan" nhan="Khách được ghi nhận" gia={so(referral.theoTrangThai.VALID)} ghiChu={`Trên ${so(referral.tong)} lượt gửi biểu mẫu`} />
        <The soLieu="da-dang-ky" nhan="Đã đăng ký học" gia={so(referral.daDangKy)} ghiChu="Trong số khách được ghi nhận" />
        {hoaHong !== null && (
          <The soLieu="cho-chi" nhan="Hoa hồng chờ chi" gia={dinhDangDong(hoaHong.choChi)} ghiChu={`Đã chi ${dinhDangDong(hoaHong.daChi)}`} />
        )}
      </div>
      {hoaHong === null && (
        <p data-khong-hien-tien className="mt-3 rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          Số tiền hoa hồng không hiển thị ở trang này. Bạn vẫn theo dõi được link, lượt bấm và trạng thái từng khách giới thiệu; cần biết về hoa hồng, hãy liên hệ trung tâm.
        </p>
      )}

      {conHoatDong && (
        <Muc id="tao-link" tieuDe="Tạo link giới thiệu" moTa="Chọn chương trình, website và trang đích rồi bấm Tạo. Link mới hiện ở danh sách bên dưới, kèm nút sao chép và mã QR.">
          <TaoLinkCuaToiForm data={data.taoLink} />
        </Muc>
      )}

      <Muc id="link" tieuDe="Link giới thiệu của bạn" moTa="Gửi link này cho người quen. Khách bấm vào và để lại thông tin trên website thì được ghi nhận cho bạn.">
        {data.link.length === 0 ? (
          <p data-rong="link" className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Bạn chưa có link nào. {conHoatDong ? "Tạo link đầu tiên ở mục phía trên." : "Liên hệ trung tâm để được hỗ trợ."}
          </p>
        ) : (
          <ul className="space-y-3">
            {data.link.map((l, i) => (
              <li key={i} data-link className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-semibold text-foreground">
                    {l.campaign}
                    {l.nhan && <span className="ml-2 font-normal text-muted-foreground">· {l.nhan}</span>}
                  </p>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", l.hoatDong ? "bg-state-success-soft text-state-success-ink" : "bg-muted text-muted-foreground")}>
                    {l.hoatDong ? "Đang dùng" : "Đã thu hồi"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Website {l.website} · Trang đích <span className="font-mono">{l.trangDich}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span data-so-luot-bam className="tabular-nums">{so(l.soLuotBam)}</span> lượt bấm
                  {l.soLuotBamLoi > 0 && <> (+ <span className="tabular-nums">{so(l.soLuotBamLoi)}</span> lượt vào khi link không dùng được)</>}
                  {" · "}
                  <span data-so-referral className="tabular-nums">{so(l.soReferral)}</span> referral
                </p>
                {l.lyDoKhongDung && (
                  <p role="status" data-link-tam-ngung className="mt-2 text-xs text-state-warning-ink">
                    Link tạm chưa ghi nhận khách: {l.lyDoKhongDung}
                  </p>
                )}
                {l.hoatDong && l.urlCuoi && (
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">URL cuối (nơi khách đến)</p>
                    <div className="flex flex-wrap items-start gap-3">
                      <code data-url-cuoi className="min-w-0 flex-1 basis-60 select-all break-all rounded-lg bg-muted px-3 py-2 text-xs text-foreground">
                        {l.urlCuoi}
                      </code>
                      <NutSaoChepLink diaChi={l.urlCuoi} nhan={`link ${l.campaign}`} />
                    </div>
                  </div>
                )}
                {l.hoatDong && l.lienKetNgan && (
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">Link ngắn (in ấn, QR — đếm được lượt bấm)</p>
                    <div className="flex flex-wrap items-start gap-3">
                      <code data-dia-chi className="min-w-0 flex-1 basis-60 select-all break-all rounded-lg bg-muted px-3 py-2 text-xs text-foreground">
                        {l.lienKetNgan}
                      </code>
                      <NutSaoChepLink diaChi={l.lienKetNgan} nhan={`link ngắn ${l.campaign}`} />
                      <NutQrLinkCuaToi id={l.id} nhan={`${l.campaign} — ${l.website}`} />
                    </div>
                  </div>
                )}
                {l.hoatDong && !l.lienKetNgan && !data.taoLink.coGocLinkNgan && (
                  <p data-thieu-goc className="mt-3 text-xs text-state-warning-ink">
                    Chưa có link ngắn / mã QR (hệ thống chưa cấu hình địa chỉ công khai) — dùng URL cuối ở trên.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Muc>

      <Muc id="khach" tieuDe="Khách bạn giới thiệu" moTa="Thông tin của khách được bảo mật: bạn chỉ thấy ngày, chương trình, trạng thái và một mã rút gọn của hồ sơ.">
        <ul aria-label="Số lượt giới thiệu theo trạng thái" className="mb-3 flex flex-wrap gap-2">
          {TRANG_THAI_DEM_CHO_DOI_TAC.map((t) => (
            <li key={t} className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground">
              {NHAN_REFERRAL_DOI_TAC[t]} <b className="tabular-nums">{so(referral.theoTrangThai[t])}</b>
            </li>
          ))}
        </ul>
        {referral.gan.length === 0 ? (
          <p data-rong="referral" className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Chưa có khách nào được giới thiệu qua link của bạn.
          </p>
        ) : (
          <div className="rounded-2xl border border-border bg-card sm:overflow-x-auto">
            <table className={BANG}>
              <thead className="max-sm:sr-only">
                <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Ngày
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Chương trình
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Trạng thái
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Mã hồ sơ
                  </th>
                </tr>
              </thead>
              <tbody className="max-sm:block">
                {referral.gan.map((r, i) => (
                  <tr key={i} data-referral className={HANG}>
                    <td data-nhan="Ngày" className={cn(O, "tabular-nums")}>{ngayVN(r.luc)}</td>
                    <td data-nhan="Chương trình" className={O}>{r.campaign}</td>
                    <td data-nhan="Trạng thái" className={O}>{NHAN_REFERRAL_DOI_TAC[r.trangThai]}</td>
                    <td data-nhan="Mã hồ sơ" className={cn(O, "font-mono text-xs")}>{r.maPhieu ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {referral.tong > referral.gan.length && (
          <p className="mt-2 text-xs text-muted-foreground">Hiện {referral.gan.length} lượt gần nhất trong tổng {so(referral.tong)} lượt.</p>
        )}
      </Muc>

      {hoaHong !== null && (
      <Muc id="hoa-hong" tieuDe="Hoa hồng của bạn" moTa="Hoa hồng đã ghi sổ. Khi có hoàn tiền hoặc điều chỉnh, hệ thống ghi thêm một dòng điều chỉnh riêng — dòng cũ không bị sửa.">
        {data.hoaHongMotPhan && (
          <p data-hoa-hong-mot-phan className="mb-3 text-xs text-muted-foreground">
            Chỉ gồm các chương trình có hiển thị số tiền. Khoản của chương trình khác không nằm trong các con số dưới đây.
          </p>
        )}
        <ul aria-label="Hoa hồng theo trạng thái chi" className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {(hoaHong.theoTrangThai.ON_HOLD.soDong > 0 ? TRANG_THAI_CHI_DU : TRANG_THAI_CHI).map((t) => (
            <li key={t} className="rounded-xl border border-border bg-card px-3 py-2">
              <p className="text-xs text-muted-foreground">{NHAN_CHI_DOI_TAC[t]}</p>
              <p data-chi={t} className="text-sm font-semibold tabular-nums text-foreground">
                {dinhDangDong(hoaHong.theoTrangThai[t].tien)}
              </p>
            </li>
          ))}
        </ul>
        {hoaHong.gan.length === 0 ? (
          <p data-rong="hoa-hong" className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Chưa có khoản hoa hồng nào được ghi sổ. Hoa hồng xuất hiện sau khi khách bạn giới thiệu đã đóng học phí và kế toán xác nhận.
          </p>
        ) : (
          <div className="rounded-2xl border border-border bg-card sm:overflow-x-auto">
            <table className={BANG}>
              <thead className="max-sm:sr-only">
                <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Ngày ghi sổ
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Chương trình
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Loại
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Số tiền
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Chi trả
                  </th>
                </tr>
              </thead>
              <tbody className="max-sm:block">
                {hoaHong.gan.map((h, i) => (
                  <tr key={i} data-hoa-hong className={HANG}>
                    <td data-nhan="Ngày ghi sổ" className={cn(O, "tabular-nums")}>{ngayVN(h.luc)}</td>
                    <td data-nhan="Chương trình" className={O}>{h.campaign ?? "—"}</td>
                    <td data-nhan="Loại" className={O}>{h.loai}</td>
                    <td data-nhan="Số tiền" className={cn(O, "text-right tabular-nums", h.soTien < 0 && "text-state-danger-ink")}>{dinhDangDong(h.soTien)}</td>
                    <td data-nhan="Chi trả" className={O}>{NHAN_CHI_DOI_TAC[h.trangThaiChi]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tongDongHoaHong > hoaHong.gan.length && (
          <p data-bi-cat-hoa-hong className="mt-2 text-xs text-muted-foreground">
            Hiện {hoaHong.gan.length} dòng gần nhất trong tổng {so(tongDongHoaHong)} dòng.
          </p>
        )}
      </Muc>
      )}
    </div>
  );
}
