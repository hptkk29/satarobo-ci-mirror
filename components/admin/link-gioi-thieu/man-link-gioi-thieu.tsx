// components/admin/link-gioi-thieu/man-link-gioi-thieu.tsx — «Link giới thiệu của tôi» của NHÂN SỰ (nội dung màn, server component).
//
// Luồng (chủ dự án chốt 21/11/2026 — đảo bản 20/11 «membership chờ duyệt»): vào màn ⇒ đọc QUY ĐỊNH chương trình + CHÍNH SÁCH HOA HỒNG ⇒ bấm «Tôi đã đọc và đồng ý» ⇒ vào luôn,
// KHÔNG AI DUYỆT. Đã vào thì MỘT trang (thiết kế chủ dự án 21/11/2026, bỏ tab): «Lấy link Aff» · bốn ô số · «Dòng hoa hồng» (sổ hoa hồng THẬT, SĐT che, xuất CSV).
//
// Ai thấy gì: người đăng nhập có hồ sơ nhân sự đang làm việc thấy hồ sơ giới thiệu CỦA CHÍNH MÌNH (`Affiliate.employeeId`). Không khoá RBAC riêng — quyền là dữ liệu sở hữu (lõi
// `lib/affiliate/doi-tac-nhan-su.ts`, `userId` từ PHIÊN). Nút chỉ vẽ khi máy chủ sẽ nhận (luật 12). Lọc bảng là form GET (`?q=&tt=`, đọc ở máy chủ).
// Hai trang gọi: `app/(admin)/admin/link-gioi-thieu/page.tsx` · `app/(teacher)/teacher/link-gioi-thieu/page.tsx`.
import { Info, Search } from "lucide-react";

import { GoiY } from "@/components/admin/link-gioi-thieu/goi-y";
import { NutDongY } from "@/components/admin/link-gioi-thieu/nut-dong-y";
import { NutXuatCsv } from "@/components/admin/link-gioi-thieu/nut-xuat-csv";
import { DanhSachTheTrangDich } from "@/components/admin/link-gioi-thieu/the-trang-dich";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { docLinkGioiThieuCuaToi, linkGioiThieuBat, LOI_CHUA_CAU_HINH, LOI_KHONG_NHAN_SU } from "@/lib/affiliate/doi-tac-nhan-su";
import { vanBanQuyDinhNhanSu } from "@/lib/affiliate/quy-dinh-nhan-su";
import { dungTheTrangDich } from "@/lib/affiliate/the-trang-dich";
import { NHAN_TRANG_THAI_DONG_HH, docHoaHongGioiThieuNhanSu, type TrangThaiDongHH } from "@/lib/nguon/hoa-hong-gioi-thieu";
import { docKhachMangVeNhanSu } from "@/lib/nguon/thu-nhap-them";
import { cn } from "@/lib/utils";

function HopBao({ children, loai = "thuong" }: { children: React.ReactNode; loai?: "thuong" | "canh-bao" }) {
  return (
    <p role="status" className={loai === "canh-bao" ? "rounded-xl bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink" : "rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground"}>
      {children}
    </p>
  );
}


/**
 * Nội dung màn — DÙNG CHUNG cho admin (`/link-gioi-thieu`) và site giáo viên (`/teacher/link-gioi-thieu`): giáo viên THUẦN bị đá khỏi host admin sang giaovien, nên thiếu bản ở
 * site GV là họ không có lối vào. `userId` LUÔN từ phiên (trang gọi `auth()`); `trang` = đường dẫn của chính trang để form lọc GET trỏ về đúng chỗ.
 */
export async function ManLinkGioiThieu({ userId, sp, trang }: { userId: string; sp: { q?: string; tt?: string }; trang: string }) {

  const tieuDe = (
    <PageHeader title="Link giới thiệu của tôi" subtitle="Gửi link cho người quen. Khách bấm vào và để lại thông tin thì lead được ghi nhận nhân sự giới thiệu là bạn." />
  );
  if (!(await linkGioiThieuBat())) {
    return (
      <div data-link-gioi-thieu="tat">
        {tieuDe}
        <HopBao>Chương trình link giới thiệu đang tắt.</HopBao>
      </div>
    );
  }

  const data = await docLinkGioiThieuCuaToi(userId, new Date());

  if (data.loai === "KHONG_NHAN_SU") {
    return (
      <div data-link-gioi-thieu="khong-nhan-su">
        {tieuDe}
        <HopBao>{LOI_KHONG_NHAN_SU} Liên hệ Nhân sự để gắn tài khoản với hồ sơ của bạn.</HopBao>
      </div>
    );
  }

  if (data.loai === "CHUA_THAM_GIA") {
    return (
      <div data-link-gioi-thieu="quy-dinh">
        {tieuDe}
        {data.quyDinh === null ? (
          <HopBao loai="canh-bao">{LOI_CHUA_CAU_HINH}</HopBao>
        ) : (
          <div className="max-w-3xl space-y-4 rounded-2xl border border-border bg-card p-5">
            {vanBanQuyDinhNhanSu(data.quyDinh).map((m) => (
              <section key={m.tieuDe}>
                <h2 className="text-base font-semibold text-foreground">{m.tieuDe}</h2>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-foreground">
                  {m.dong.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </section>
            ))}
            <p className="text-sm text-muted-foreground">Bấm đồng ý là bạn vào chương trình ngay và tạo được link — không cần ai duyệt.</p>
            <NutDongY />
          </div>
        )}
      </div>
    );
  }

  if (data.loai === "BI_CHAN") {
    return (
      <div data-link-gioi-thieu="bi-chan">
        {tieuDe}
        <HopBao loai="canh-bao">{data.lyDo}</HopBao>
      </div>
    );
  }

  const q = (sp.q ?? "").slice(0, 60);
  const trangThai = sp.tt && sp.tt in NHAN_TRANG_THAI_DONG_HH ? (sp.tt as TrangThaiDongHH) : null;
  const [khach, hh] = await Promise.all([
    docKhachMangVeNhanSu({ userId: userId }),
    docHoaHongGioiThieuNhanSu({ userId: userId, q, trangThai }),
  ]);
  const the = dungTheTrangDich(data.taoLink, data.link);
  const luotBam = data.link.reduce((s, l) => s + l.soLuotBam, 0);
  const ghiChuCho = [
    hh.soChoDuyet > 0 ? `${hh.soChoDuyet} chờ duyệt` : null,
    hh.soChoChi > 0 ? `${hh.soChoChi} chờ chi` : null,
    hh.soDangGiu > 0 ? `${hh.soDangGiu} đang giữ` : null,
  ].filter((x): x is string => x !== null);

  return (
    <div data-link-gioi-thieu="da-tham-gia" className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Link giới thiệu của tôi</h1>
        <p className="mt-1 text-sm text-muted-foreground md:text-base">
          Hồ sơ giới thiệu: <span className="font-semibold text-foreground">{data.doiTac.ten}</span> · mã {data.doiTac.ma}
        </p>
      </div>

      <section data-khoi="lay-link" className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
        <TieuDeKhoi tieuDe="Lấy link Aff" goiY="Link dùng để giới thiệu khách và ghi nhận hoa hồng." />
        <div className="mt-4">
          {the.length === 0 ? <HopBao>Chưa có trang đích nào để giới thiệu. Liên hệ Marketing.</HopBao> : <DanhSachTheTrangDich the={the} />}
        </div>
      </section>

      <section data-khoi="so-lieu" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OSo nhan="Lượt bấm link" goiY="Tổng lượt bấm vào các link giới thiệu của bạn." so={so(luotBam)} />
        <OSo nhan="Phụ huynh đã mua" goiY="Số phụ huynh qua link của bạn đã đăng ký học, trên tổng số lead bạn mang về." so={so(khach.daChot)} phu={`${so(khach.tongLead)} lead`} />
        <OSo nhan="Hoa hồng đã nhận" goiY="Tổng hoa hồng giới thiệu đã chi trả cho bạn." so={tien(hh.daNhan)} />
        <OSo
          nhan="Đang chờ"
          goiY="Hoa hồng chưa đủ điều kiện chi trả hoặc đang chờ duyệt."
          so={tien(hh.dangCho)}
          phu={ghiChuCho.length > 0 ? ghiChuCho.join(" · ") : "Không có khoản đang chờ"}
        />
      </section>

      <section data-khoi="dong-hoa-hong" className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TieuDeKhoi tieuDe="Dòng hoa hồng" goiY="Danh sách đơn hàng và trạng thái chi trả hoa hồng." />
          <NutXuatCsv dong={hh.dong} />
        </div>

        <form method="get" action={trang} className="mt-4 flex flex-wrap items-center gap-2">
          <label className="relative min-w-60 flex-1">
            <span className="sr-only">Tìm khách</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input name="q" defaultValue={q} placeholder="Tên phụ huynh, tên bé hoặc số điện thoại" className="h-11 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm md:h-10" />
          </label>
          <select name="tt" defaultValue={trangThai ?? ""} aria-label="Lọc trạng thái" className="h-11 min-w-40 rounded-lg border border-border bg-background px-3 text-sm md:h-10">
            <option value="">Mọi trạng thái</option>
            {(Object.keys(NHAN_TRANG_THAI_DONG_HH) as TrangThaiDongHH[]).map((ma) => (
              <option key={ma} value={ma}>
                {NHAN_TRANG_THAI_DONG_HH[ma]}
              </option>
            ))}
          </select>
          <button type="submit" className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 md:h-10">
            Lọc
          </button>
        </form>

        <div className="mt-4">
          {hh.dong.length === 0 ? (
            <p data-rong="dong-hoa-hong" className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              {q || trangThai ? "Không có dòng hoa hồng khớp bộ lọc." : "Chưa có dòng hoa hồng nào. Khi khách bạn giới thiệu đóng học phí, hoa hồng sẽ hiện ở đây."}
            </p>
          ) : (
            <PhanTrangBang tenDonVi="dòng" cuonNgang khoaGhiNho="link-gioi-thieu-hoa-hong" className="overflow-hidden rounded-xl">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/60 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Phụ huynh được giới thiệu</th>
                    <th className="px-4 py-3 font-medium">Khoá</th>
                    <th className="px-4 py-3 text-right font-medium">Đã đóng (gồm VAT)</th>
                    <th className="px-4 py-3 text-center font-medium">Mức</th>
                    <th className="px-4 py-3 text-right font-medium">Hoa hồng</th>
                    <th className="px-4 py-3 font-medium">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {hh.dong.map((d) => (
                    <tr key={d.khoa} className="border-t border-border">
                      <td className="px-4 py-3">{d.phuHuynh ? `${d.phuHuynh} · ${d.sdtChe}` : "—"}</td>
                      <td className="px-4 py-3">{d.khoaHoc}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{tien(d.daDong)}</td>
                      <td className="px-4 py-3 text-center tabular-nums">{d.muc}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{tien(d.hoaHong)}</td>
                      <td className="px-4 py-3">
                        <span data-trang-thai-hh={d.trangThai} className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", MAU_TRANG_THAI[d.trangThai])}>
                          {d.nhanTrangThai}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PhanTrangBang>
          )}
          {hh.biCat && <p className="mt-2 text-xs text-muted-foreground">Đang hiện 500 dòng gần nhất.</p>}
        </div>

        <p className="mt-4 flex items-start gap-2.5 rounded-xl bg-state-info-soft px-4 py-3 text-sm text-state-info-ink">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          «Đã đóng» là số phụ huynh đóng ở lần thu đó, gồm VAT (lần cọc thì là số cọc); mỗi lần đóng một dòng. Số điện thoại phụ huynh được che — gõ đủ số vào ô tìm để tra đúng một khách.
        </p>
      </section>
    </div>
  );
}

const MAU_TRANG_THAI: Readonly<Record<TrangThaiDongHH, string>> = {
  DANG_GIU: "bg-state-warning-soft text-state-warning-ink",
  CHO_DUYET: "bg-state-info-soft text-state-info-ink",
  CHO_CHI: "bg-state-warning-soft text-state-warning-ink",
  DA_TRA: "bg-state-success-soft text-state-success-ink",
  THU_HOI: "bg-state-danger-soft text-state-danger-ink",
};

const so = (n: number) => n.toLocaleString("vi-VN");
const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

function TieuDeKhoi({ tieuDe, goiY }: { tieuDe: string; goiY: string }) {
  return (
    <h2 className="flex items-center gap-2 text-lg font-bold text-foreground md:text-xl">
      {tieuDe}
      <GoiY nhan={`Giải thích: ${tieuDe}`}>{goiY}</GoiY>
    </h2>
  );
}

function OSo({ nhan, goiY, so: giaTri, phu }: { nhan: string; goiY: string; so: string; phu?: string }) {
  return (
    <div data-o-so={nhan} className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
      <p className="flex items-center gap-2 text-sm text-muted-foreground md:text-base">
        {nhan}
        <GoiY nhan={`Giải thích: ${nhan}`}>{goiY}</GoiY>
      </p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground md:text-3xl">{giaTri}</p>
      {phu && <p className="mt-1 text-sm text-muted-foreground">{phu}</p>}
    </div>
  );
}
