// app/(admin)/admin/nguon-hoa-hong/campaign/[maCampaign]/page.tsx — CHI TIẾT MỘT CAMPAIGN AFFILIATE (AFF-P0b): trang đầy đủ, các mục chia bằng tiêu đề + đường kẻ (KHÔNG thẻ lồng thẻ):
//   Thông tin · Hoa hồng (AFF-L1) · Hiệu quả (AFF-P3, chỉ đọc) · Quy tắc quy nguồn · Xem trước nguồn · Website · Thành viên.
//
// Cổng và cách ly (khuôn `nguon/[maNguon]`): `vaoTab("campaign")` (cờ tắt ⇒ 404, đứng TRƯỚC quyền) → `PAGE_GATES["/nguon-hoa-hong/campaign"]` (xem) → mã trên URL giải bằng `giaiMaTrenUrl`
// (hỏng ⇒ 404, không URIError) → không có campaign ⇒ `notFound()`. Campaign là danh mục toàn hệ — không cách ly theo cơ sở; cách ly nằm ở cổng quyền.
//
// MỖI NÚT GHI vẽ bằng ĐÚNG khoá mà action của nó kiểm ở đầu hàm (luật 12 — `scope.has(k)` ↔ `checkPermission(k)`):
//   · Sửa · quy tắc · website            → `affiliate_campaigns:manage`
//   · Kích hoạt · tạm dừng · kết thúc    → `affiliate_campaigns:activate` (KHÁC `manage`: có manage mà thiếu activate thì không thấy nút)
//   · Thêm / duyệt / ngừng thành viên    → `affiliate_memberships:manage`
//   · Chọn «có thưởng / không có mức riêng» → `affiliate_campaigns:manage`; xem chính sách của campaign → `commission_policies:view`; đường «Soạn chính sách» → `commission_policies:manage` ∧ engine bật
// Điều kiện kích hoạt còn thiếu (`chanKichHoat`) tính bằng CHÍNH `kiemKichHoatCampaign` mà hàm ghi dùng, nên nút và máy chủ nói cùng một điều — và LIỆT KÊ TẤT CẢ, mỗi cái kèm đường tới chỗ sửa.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Pencil, TriangleAlert } from "lucide-react";
import { KhoiHieuQua } from "@/components/admin/nguon-hoa-hong/campaign/khoi-hieu-qua";
import { KhoiHoaHong } from "@/components/admin/nguon-hoa-hong/campaign/khoi-hoa-hong";
import { XemTruocHoaHong } from "@/components/admin/nguon-hoa-hong/campaign/xem-truoc-hoa-hong";
import { KhoiQuyTac } from "@/components/admin/nguon-hoa-hong/campaign/khoi-quy-tac";
import { KhoiWebsite } from "@/components/admin/nguon-hoa-hong/campaign/khoi-website";
import { NHAN_LUU_Y_HIEU_LUC, ngayHienThi, nhanHieuLuc, soVN } from "@/components/admin/nguon-hoa-hong/campaign/nhan-campaign";
import { NutDoiTrangThaiCampaign } from "@/components/admin/nguon-hoa-hong/campaign/nut-doi-trang-thai-campaign";
import { ThemMembership } from "@/components/admin/nguon-hoa-hong/campaign/them-membership";
import { TrangThaiCampaignPill } from "@/components/admin/nguon-hoa-hong/campaign/trang-thai-pill";
import { BTN_OUTLINE, CHIP, CHIP_ACTIVE, CHIP_IDLE } from "@/components/admin/nguon-hoa-hong/classes";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { Separator } from "@/components/ui/separator";
import { giaiKhoangNgay } from "@/lib/affiliate/bao-cao";
import { docBaoCaoHieuQua } from "@/lib/affiliate/doc-bao-cao";
import { quyenBaoCaoTuScope } from "@/lib/affiliate/quyen-bao-cao";
import { luaChonTuBool, NHAN_LUA_CHON_XEM_TIEN } from "@/lib/affiliate/quyen-xem-tien";
import { docChiTietCampaign, docDoiTacChoCampaign, docLuaChonChoCampaign, docMembership, docXemTruocNguon } from "@/lib/affiliate/doc-campaign";
import { MO_TA_MO_HINH, NHAN_MO_HINH, NHAN_TRANG_THAI_CAMPAIGN, hrefMucSua } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { docPhienBanChinhSachCuaCampaign } from "@/lib/affiliate/hoa-hong-campaign-doc";
import { CO_SO_MAU_MAC_DINH, docXemTruocHoaHongCampaign } from "@/lib/affiliate/xem-truoc-hoa-hong";
import { NHAN_TRANG_THAI_MEMBERSHIP, TRANG_THAI_MEMBERSHIP } from "@/lib/affiliate/ghi-membership-dau-vao";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docTranHoaHong } from "@/lib/hoa-hong/chinh-sach-service";
import { DUONG_CAU_HINH_TRAN } from "@/lib/hoa-hong/huong-xu-ly-tran";
import { dinhDangTranPhanTram } from "@/lib/hoa-hong/mo-phong-ui";
import { docCoQuyenSuaTran } from "@/lib/hoa-hong/quyen-sua-tran";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { TAB_HREF } from "@/lib/nguon-hoa-hong/tab";
import { docTrang, giaiMaTrenUrl, hrefVoi, kepTrang, motGiaTri } from "@/lib/nguon-hoa-hong/url";
import { cn } from "@/lib/utils";
import { vaoTab } from "../../_lib/vao-tab";
import { BangMembership } from "../_components/bang-membership";
import { XemTruocNguon } from "../_components/xem-truoc-nguon";

export const metadata = { title: "Chi tiết campaign Affiliate | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const KICH_THUOC_TRANG = 25;

type Sp = { xemTruoc?: string | string[]; tt?: string | string[]; trang?: string | string[]; tu?: string | string[]; den?: string | string[] };

function Dong({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <dt className="text-sm text-muted-foreground">{nhan}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );
}

function Muc({ id, tieuDe, moTa, children }: { id?: string; tieuDe: string; moTa?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-tieu-de` : undefined} className="space-y-3 py-5">
      <div>
        <h2 id={id ? `${id}-tieu-de` : undefined} className="text-base font-semibold text-foreground">
          {tieuDe}
        </h2>
        {moTa && <p className="mt-0.5 text-sm text-muted-foreground">{moTa}</p>}
      </div>
      {children}
    </section>
  );
}

export default async function ChiTietCampaignPage({ params, searchParams }: { params: Promise<{ maCampaign: string }>; searchParams: Promise<Sp> }) {
  const { actor, scope } = await vaoTab("campaign");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/campaign"])) {
    return <ThieuQuyen tab="campaign" scope={scope} soHangCho={{}} />;
  }
  const [{ maCampaign }, sp] = await Promise.all([params, searchParams]);
  // `%` đơn lẻ trên URL: decodeURIComponent trần ném URIError ⇒ 500 + một lỗi giả trong Sentry. Mã hỏng = mã lạ = 404.
  const ma = giaiMaTrenUrl(maCampaign);
  if (ma === null) notFound();
  const now = new Date();

  // MỖI cờ quyền hỏi MỘT lần từ scope — cùng khoá với action tương ứng.
  const coTheSoan = scope.has("affiliate_campaigns:manage");
  const coTheKichHoat = scope.has("affiliate_campaigns:activate");
  const coTheThanhVien = scope.has("affiliate_memberships:manage");

  const [campaign, luaChon, soHangCho] = await Promise.all([docChiTietCampaign(ma, now), docLuaChonChoCampaign(now), docSoHangChoTheoTab(actor, scope)]);
  if (!campaign) notFound();

  const goc = `/nguon-hoa-hong/campaign/${encodeURIComponent(campaign.code)}`;
  const ttLoc = TRANG_THAI_MEMBERSHIP.find((t) => t === motGiaTri(sp.tt)) ?? null;
  const partyXemTruoc = motGiaTri(sp.xemTruoc);

  // Đợt hai: cần `campaign.id`. Ô «Thêm đối tác» / «Xem trước» đọc CÙNG một danh sách đối tác (chỉ tên · mã · loại).
  const trang = docTrang(sp.trang);
  // AFF-P3: khối «Hiệu quả» cùng lượt song song (không thêm một bậc `await` tuần tự). MỖI khối của nó chỉ được truy vấn khi người xem có ĐÚNG khoá của khối ấy:
  //   (khoá nào ↔ khối nào: `quyenBaoCaoTuScope` — lượt bấm = tab Link · referral/đã đăng ký = tab Referral · hoa hồng = xem sổ cơ sở ∧ engine bật.)
  const khoang = giaiKhoangNgay({ tu: motGiaTri(sp.tu), den: motGiaTri(sp.den), now });
  const quyenBaoCao = quyenBaoCaoTuScope(scope);
  // AFF-L1: phiên bản chính sách của campaign chỉ được TRUY VẤN khi người xem có `commission_policies:view` (số tiền hoa hồng); thiếu quyền ⇒ `null` và khối nói «chưa có quyền», không in danh sách rỗng.
  const xemChinhSach = scope.has("commission_policies:view");
  const [thanhVien, doiTac, xemTruoc, hieuQua, phienBanHoaHong, tranHoaHong, coQuyenSuaTran, xemTruocTien] = await Promise.all([
    docMembership({ campaignId: campaign.id, trangThai: ttLoc, trang, kichThuoc: KICH_THUOC_TRANG }),
    docDoiTacChoCampaign(campaign.id),
    partyXemTruoc ? docXemTruocNguon({ campaignId: campaign.id, partyId: partyXemTruoc, now }) : Promise.resolve(null),
    docBaoCaoHieuQua(actor, { campaignId: campaign.id, campaignMa: campaign.code, khoang, quyen: quyenBaoCao }),
    xemChinhSach ? docPhienBanChinhSachCuaCampaign(actor, campaign.id, now) : Promise.resolve(null),
    docTranHoaHong().catch(() => null),
    docCoQuyenSuaTran().catch(() => false),
    // Hoa hồng dự kiến của đối tác đang chọn ở «Xem trước nguồn»: cũng chỉ tra khi có quyền xem chính sách (số tiền). Cùng `partyXemTruoc` nên hai khối luôn nói về MỘT đối tác.
    partyXemTruoc && xemChinhSach ? docXemTruocHoaHongCampaign({ campaignId: campaign.id, partyId: partyXemTruoc, loaiGd: "NEW", coSo: CO_SO_MAU_MAC_DINH, now }) : Promise.resolve(null),
  ]);
  // Danh sách co lại khi lọc / khi ai đó kết thúc bớt: F5 ở trang cuối rơi quá biên thì về trang cuối, không vẽ «Hiển thị 26–10 / 10».
  const trangHopLe = kepTrang(trang, thanhVien.tong, thanhVien.kichThuoc);
  if (thanhVien.tong > 0 && trangHopLe !== trang) redirect(`${hrefVoi(goc, { tt: ttLoc, xemTruoc: partyXemTruoc, trang: trangHopLe })}#thanh-vien`);

  const hl = nhanHieuLuc(campaign.effectiveFrom, campaign.effectiveTo, now);
  const khongKichHoatDuoc = (campaign.status === "DRAFT" || campaign.status === "PAUSED") && campaign.chanKichHoat.length > 0;
  const tongMembership = TRANG_THAI_MEMBERSHIP.reduce((n, t) => n + campaign.demMembership[t], 0);
  const giuLoc = { tt: ttLoc };

  return (
    <KhungModule
      tab="campaign"
      scope={scope}
      soHangCho={soHangCho}
      tieuDe={campaign.name}
      phuDe={`Mã ${campaign.code} · ${NHAN_TRANG_THAI_CAMPAIGN[campaign.status]}`}
      actions={
        coTheSoan || coTheKichHoat ? (
          <>
            {coTheSoan && campaign.status !== "ENDED" && (
              <Link href={`${goc}/sua`} className={BTN_OUTLINE}>
                <Pencil aria-hidden className="h-4 w-4" />
                Sửa campaign
              </Link>
            )}
            {coTheKichHoat && (
              <NutDoiTrangThaiCampaign campaign={{ id: campaign.id, name: campaign.name, status: campaign.status, capNhatLuc: campaign.capNhatLuc }} chanKichHoat={campaign.chanKichHoat} goc={goc} />
            )}
          </>
        ) : undefined
      }
    >
      <Link href="/nguon-hoa-hong/campaign" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-primary-ink hover:underline">
        <ChevronLeft aria-hidden className="h-4 w-4" />
        Tất cả campaign
      </Link>

      <div className="rounded-xl border border-border bg-card px-4 py-1 sm:px-6">
        <Muc id="thong-tin" tieuDe="Thông tin">
          {khongKichHoatDuoc && (
            <div role="status" className="rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
              <p className="flex items-center gap-1.5 font-medium">
                <TriangleAlert aria-hidden className="h-4 w-4 shrink-0" />
                Chưa kích hoạt được — còn {campaign.chanKichHoat.length} điều kiện
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-9">
                {campaign.chanKichHoat.map((c) => (
                  <li key={c.ma + c.thongBao}>
                    {c.thongBao}{" "}
                    <Link href={hrefMucSua(goc, c.muc)} className="whitespace-nowrap font-semibold underline underline-offset-2 hover:no-underline">
                      Sửa
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <dl className="space-y-2">
            <Dong nhan="Trạng thái">
              <TrangThaiCampaignPill status={campaign.status} />
            </Dong>
            <Dong nhan="Mô hình ghi nhận">
              <span className="font-medium">{NHAN_MO_HINH[campaign.attributionModel]}</span>
              <span className="block text-muted-foreground">{MO_TA_MO_HINH[campaign.attributionModel]}</span>
            </Dong>
            <Dong nhan="Cửa sổ cookie">{soVN(campaign.cookieWindowDays)} ngày</Dong>
            <Dong nhan="Thời gian bảo vệ">{soVN(campaign.protectWindowDays)} ngày</Dong>
            <Dong nhan="Tự giới thiệu">{campaign.allowSelfReferral ? "Cho phép" : "Không cho phép"}</Dong>
            <Dong nhan="Số tiền ở cổng đối tác">{NHAN_LUA_CHON_XEM_TIEN[luaChonTuBool(campaign.partnerCanViewAmount)]}</Dong>
            <Dong nhan="Nguồn mặc định">
              {campaign.nguonMacDinh ? (
                <>
                  {campaign.nguonMacDinh.ten}
                  {!campaign.nguonMacDinh.chonDuoc && <span className="block text-state-warning-ink">Nguồn này hiện không dùng được — sửa nguồn mặc định trước khi kích hoạt.</span>}
                </>
              ) : (
                <span className="text-muted-foreground">Chưa đặt — dùng quy tắc, rồi nguồn mặc định của loại đối tác</span>
              )}
            </Dong>
            <Dong nhan="Hiệu lực">
              {hl.chu}
              {hl.luuY && campaign.status !== "ENDED" && <span className="ml-2 text-state-warning-ink">{NHAN_LUU_Y_HIEU_LUC[hl.luuY]}</span>}
            </Dong>
            {campaign.activatedAt && <Dong nhan="Kích hoạt gần nhất">{ngayHienThi(campaign.activatedAt)}</Dong>}
            {campaign.description && <Dong nhan="Mô tả">{campaign.description}</Dong>}
          </dl>
        </Muc>
        <Separator />

        <Muc id="hoa-hong" tieuDe="Hoa hồng" moTa="Campaign này có thưởng không, theo chính sách nào, và engine tính ra sao. Chọn xong chưa kích hoạt gì — kích hoạt chính sách và campaign là hai bước riêng.">
          <KhoiHoaHong
            campaignId={campaign.id}
            maCampaign={campaign.code}
            capNhatLuc={campaign.capNhatLuc}
            trangThai={campaign.status}
            cheDoThuong={campaign.cheDoThuong}
            phienBan={phienBanHoaHong}
            quyen={{ doiCheDo: coTheSoan, xemChinhSach, soanChinhSach: scope.has("commission_policies:manage") && scope.co.engine }}
            tran={tranHoaHong === null ? null : dinhDangTranPhanTram(tranHoaHong)}
            hrefTran={coQuyenSuaTran ? DUONG_CAU_HINH_TRAN.href : null}
          />
          {xemChinhSach && <XemTruocHoaHong ketQua={xemTruocTien} daChonDoiTac={partyXemTruoc !== null} hrefTran={coQuyenSuaTran ? DUONG_CAU_HINH_TRAN.href : null} />}
        </Muc>
        <Separator />

        <Muc id="hieu-qua" tieuDe="Hiệu quả" moTa="Từ lượt bấm tới hoa hồng đã ghi sổ của campaign này — chỉ đọc.">
          <KhoiHieuQua
            bc={hieuQua}
            action={goc}
            hrefSo={scope.tabMoDuoc("so") ? hrefVoi(TAB_HREF.so, { xem: "tat-ca", camp: campaign.code }) : null}
          />
        </Muc>
        <Separator />

        <Muc id="quy-tac" tieuDe="Quy tắc quy nguồn" moTa="Khách do đối tác giới thiệu được ghi vào nguồn nào, theo loại và nhãn của đối tác.">
          <KhoiQuyTac
            campaignId={campaign.id}
            trangThai={campaign.status}
            quyTac={campaign.quyTac}
            loai={luaChon.loai}
            nhan={luaChon.nhan}
            nguon={luaChon.nguon}
            coTheGhi={coTheSoan}
          />
        </Muc>
        <Separator />

        <Muc id="xem-truoc-nguon" tieuDe="Xem trước nguồn" moTa="Thử với một đối tác cụ thể: nguồn nào sẽ được gán, và vì sao.">
          <XemTruocNguon action={goc} giu={giuLoc} doiTac={doiTac.doiTac} conNua={doiTac.conNua} dangChon={partyXemTruoc} ketQua={xemTruoc} />
        </Muc>
        <Separator />

        <Muc id="website" tieuDe="Website" moTa="Website nào được đặt link của campaign này. Tạo và sửa website ở tab Website.">
          <KhoiWebsite campaignId={campaign.id} trangThai={campaign.status} daGan={campaign.website} tatCa={luaChon.website} coTheGhi={coTheSoan} />
        </Muc>
        <Separator />

        <Muc id="thanh-vien" tieuDe="Thành viên" moTa="Đối tác tham gia campaign này. Mỗi đối tác một dòng; thêm lại đối tác đã kết thúc sẽ mở lại đúng dòng cũ.">
          {coTheThanhVien && campaign.status !== "ENDED" && <ThemMembership campaignId={campaign.id} doiTac={doiTac.doiTac} conNua={doiTac.conNua} />}
          <nav aria-label="Lọc thành viên theo trạng thái" className="flex w-full items-center gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>a]:shrink-0 [&>a]:whitespace-nowrap">
            <Link href={`${hrefVoi(goc, {})}#thanh-vien`} aria-current={ttLoc === null ? "page" : undefined} className={cn(CHIP, ttLoc === null ? CHIP_ACTIVE : CHIP_IDLE)}>
              Tất cả ({tongMembership})
            </Link>
            {TRANG_THAI_MEMBERSHIP.map((t) => (
              <Link key={t} href={`${hrefVoi(goc, { tt: t })}#thanh-vien`} aria-current={ttLoc === t ? "page" : undefined} className={cn(CHIP, ttLoc === t ? CHIP_ACTIVE : CHIP_IDLE)}>
                {NHAN_TRANG_THAI_MEMBERSHIP[t]} ({campaign.demMembership[t]})
              </Link>
            ))}
          </nav>
          <BangMembership
            dong={thanhVien.dong}
            tong={thanhVien.tong}
            trang={trangHopLe}
            kichThuoc={thanhVien.kichThuoc}
            hrefTrang={(t) => `${hrefVoi(goc, { tt: ttLoc, xemTruoc: partyXemTruoc, trang: t })}#thanh-vien`}
            campaignStatus={campaign.status}
            coTheGhi={coTheThanhVien}
            dangLoc={ttLoc !== null}
          />
        </Muc>
      </div>
    </KhungModule>
  );
}
