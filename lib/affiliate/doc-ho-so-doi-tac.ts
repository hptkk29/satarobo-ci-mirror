/**
 * lib/affiliate/doc-ho-so-doi-tac.ts — ĐỌC cho TRANG CHI TIẾT ĐỐI TÁC (AFF-L3a): các chương trình đối tác đang tham gia (kèm XEM TRƯỚC nguồn khách của từng cái), các campaign có thể ghi danh thêm,
 * và CHECKLIST «đủ để phát link chưa». Chỉ ĐỌC.
 *
 * ── Không viết lại luật nào ───────────────────────────────────────────────────────────────────────────────────
 *  · Nguồn khách: `dungDauVaoXemTruoc` + `xemTruocNguon` (→ `giaiNguonCuaDoiTac`) — CÙNG hàm với trang campaign và với lúc referral được ghi nhận. Đọc cấu hình MỘT lần cho cả danh sách campaign
 *    (không N+1) rồi chạy hàm thuần cho từng campaign.
 *  · Ghi danh được không: `kiemThemMembership` (cùng cổng với `themMembership`). Lý do chặn hiện thành câu thay vì nút.
 *  · Đủ để phát link: `kiemChuoiLink` qua `danhGiaPhatLink` (xem `onboarding-doi-tac.ts`); chuỗi ứng viên dựng bằng `chuoiTuDong` — hàm dựng chuỗi DUY NHẤT của repo.
 *  · Nút trên dòng thành viên: `thaoTacKhaDung` của `ghi-membership-dau-vao.ts`.
 *
 * ── Cách ly / PII ──────────────────────────────────────────────────────────────────────────────────────────────
 * Campaign / Loại / Nhãn / Website là danh mục TOÀN HỆ ⇒ cách ly nằm ở cổng quyền của trang. Không SĐT/email nào ở đây (header đối tác đi qua `docDoiTacTheoId`, đã che).
 */
import { db } from "@/lib/db";
import { chuoiTuDong, type HangChuoi } from "./doc-link";
import { dungDauVaoXemTruoc, xemTruocNguon, type KetQuaXemTruoc } from "./ghi-campaign-dau-vao";
import { kiemThemMembership, thaoTacKhaDung, type ThaoTacMembership, type TrangThaiMembership } from "./ghi-membership-dau-vao";
import { CHON_RANG_BUOC_CAMPAIGN, CHON_TRANG_DICH, rangBuocCuaCampaign, trangDichHieuLuc } from "./trang-dich-hieu-luc";
import { hostTrongDanhSach } from "./website-hop-le";
import { cacBuocOnboarding, danhGiaPhatLink, duongDanUngVien, type BuocOnboarding, type KetQuaSanSangPhatLink, type UngVienPhatLink } from "./onboarding-doi-tac";

/** Trần số campaign đưa vào ô «Ghi danh thêm» — danh sách chọn, không phải đường tải danh mục. */
export const TOI_DA_UNG_VIEN_GHI_DANH = 50;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export type ChuongTrinhCuaDoiTac = {
  membershipId: string;
  campaign: { id: string; ma: string; ten: string; trangThai: "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED" };
  trangThai: TrangThaiMembership;
  nhom: string | null;
  tu: string;
  den: string | null;
  /** ISO của `updatedAt` — mốc khoá lạc quan khi duyệt / ngừng thành viên. */
  capNhatLuc: string;
  nguon: KetQuaXemTruoc;
  /** Thao tác khả dụng trên dòng (cùng định nghĩa với tab Campaign) — mỗi cái kèm lý do bị chặn. */
  thaoTac: { thaoTac: ThaoTacMembership; lyDoChan: string | null }[];
};

export type UngVienGhiDanh = {
  campaignId: string;
  ma: string;
  ten: string;
  trangThai: "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED";
  nguon: KetQuaXemTruoc;
  /** null = ghi danh được ngay. Khác null = câu của CHÍNH cổng `kiemThemMembership`. */
  lyDoChan: string | null;
};

export type HoSoOnboarding = {
  chuongTrinh: ChuongTrinhCuaDoiTac[];
  ungVien: UngVienGhiDanh[];
  /** Có thêm campaign chưa liệt kê (vượt trần). */
  conUngVien: boolean;
  sanSang: KetQuaSanSangPhatLink;
  buoc: BuocOnboarding[];
};

type NguonDoc = { id: string; code: string; name: string; status: string; selectable: boolean; effectiveFrom: Date | null; effectiveTo: Date | null };

export async function docOnboardingDoiTac(p: { partyId: string; now: Date }): Promise<HoSoOnboarding | null> {
  const doiTac = await db.affiliate.findUnique({
    where: { id: p.partyId },
    select: {
      id: true,
      status: true,
      type: { select: { id: true, defaultSourceGroupId: true } },
      tags: { select: { tagId: true } },
      memberships: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          status: true,
          groupLabel: true,
          effectiveFrom: true,
          effectiveTo: true,
          updatedAt: true,
          campaign: {
            select: {
              id: true,
              code: true,
              name: true,
              status: true,
              effectiveFrom: true,
              effectiveTo: true,
              cookieWindowDays: true,
              defaultSourceGroupId: true,
              rules: { select: { typeId: true, tagId: true, sourceGroupId: true } },
              landings: CHON_RANG_BUOC_CAMPAIGN,
              sites: {
                select: {
                  site: { select: { id: true, name: true, baseUrl: true, allowedDomains: true, status: true, trackingEnabled: true, landingPages: { select: CHON_TRANG_DICH } } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!doiTac) return null;

  const [ungVienRows, soTaiKhoanHoatDong] = await Promise.all([
    db.affiliateCampaign.findMany({
      where: { status: { not: "ENDED" }, NOT: { memberships: { some: { partyId: p.partyId, status: { not: "ENDED" } } } } },
      orderBy: [{ code: "asc" }],
      take: TOI_DA_UNG_VIEN_GHI_DANH + 1,
      select: { id: true, code: true, name: true, status: true, defaultSourceGroupId: true, rules: { select: { typeId: true, tagId: true, sourceGroupId: true } } },
    }),
    // Tài khoản đang vào được cổng — cho bước «Tài khoản truy cập» của checklist.
    db.affiliatePartyUser.count({ where: { partyId: p.partyId, status: "ACTIVE" } }),
  ]);

  // Nguồn: MỘT câu cho mọi nguồn được nhắc tới (quy tắc · mặc định campaign · mặc định loại).
  const idNguon = new Set<string>();
  const gom = (c: { defaultSourceGroupId: string | null; rules: readonly { sourceGroupId: string }[] }) => {
    if (c.defaultSourceGroupId) idNguon.add(c.defaultSourceGroupId);
    for (const r of c.rules) idNguon.add(r.sourceGroupId);
  };
  for (const m of doiTac.memberships) gom(m.campaign);
  for (const c of ungVienRows) gom(c);
  if (doiTac.type?.defaultSourceGroupId) idNguon.add(doiTac.type.defaultSourceGroupId);
  const nguon: NguonDoc[] = idNguon.size
    ? await db.leadSourceGroup.findMany({ where: { id: { in: [...idNguon] } }, select: { id: true, code: true, name: true, status: true, selectable: true, effectiveFrom: true, effectiveTo: true } })
    : [];
  const bangNguon = new Map(nguon.map((n) => [n.id, { id: n.id, code: n.code, ten: n.name, status: n.status, selectable: n.selectable, effectiveFrom: n.effectiveFrom, effectiveTo: n.effectiveTo }]));
  const xemTruoc = (c: { defaultSourceGroupId: string | null; rules: readonly { typeId: string | null; tagId: string | null; sourceGroupId: string }[] }): KetQuaXemTruoc =>
    xemTruocNguon({
      dauVao: dungDauVaoXemTruoc({
        quyTac: c.rules,
        campaignMacDinh: c.defaultSourceGroupId,
        doiTac: { loaiId: doiTac.type?.id ?? null, nhanIds: doiTac.tags.map((t) => t.tagId) },
        loaiMacDinh: doiTac.type?.defaultSourceGroupId ?? null,
      }),
      nguon: bangNguon,
      now: p.now,
    });

  const chuongTrinh: ChuongTrinhCuaDoiTac[] = doiTac.memberships.map((m) => ({
    membershipId: m.id,
    campaign: { id: m.campaign.id, ma: m.campaign.code, ten: m.campaign.name, trangThai: m.campaign.status },
    trangThai: m.status,
    nhom: m.groupLabel,
    tu: m.effectiveFrom.toISOString(),
    den: iso(m.effectiveTo),
    capNhatLuc: m.updatedAt.toISOString(),
    nguon: xemTruoc(m.campaign),
    thaoTac: thaoTacKhaDung({ status: m.status, campaign: { status: m.campaign.status }, doiTac: { status: doiTac.status } }),
  }));

  const ungVien: UngVienGhiDanh[] = ungVienRows.slice(0, TOI_DA_UNG_VIEN_GHI_DANH).map((c) => {
    const cong = kiemThemMembership({ campaign: { status: c.status }, doiTac: { status: doiTac.status }, hienCo: null });
    return { campaignId: c.id, ma: c.code, ten: c.name, trangThai: c.status, nguon: xemTruoc(c), lyDoChan: cong.ok ? null : cong.loi };
  });

  // Chuỗi ứng viên cho từng (thành viên chưa kết thúc × website của campaign).
  const ungVienLink: UngVienPhatLink[] = doiTac.memberships
    .filter((m) => m.status !== "ENDED")
    .map((m) => ({
      membershipId: m.id,
      campaignMa: m.campaign.code,
      campaignTen: m.campaign.name,
      websites: m.campaign.sites.map(({ site }) => {
        // Trang đích ứng viên = trang DÙNG ĐƯỢC đầu tiên sau khi giải host + thu hẹp theo campaign (cùng hàm với cổng phát). Không có ⇒ chuỗi tự báo TRANG_DICH_KHONG_CON.
        const dung = trangDichHieuLuc({ baseUrl: site.baseUrl, trangDich: site.landingPages, rangBuoc: rangBuocCuaCampaign(m.campaign.landings, site.id) }).find(
          (t) => t.isActive && t.trackingEnabled && hostTrongDanhSach(site.allowedDomains, t.host),
        );
        const hang: HangChuoi = {
          status: "ACTIVE",
          landingPath: dung ? duongDanUngVien([dung]) : "/",
          landingHost: dung ? dung.host : null,
          siteId: site.id,
          party: { status: doiTac.status },
          membership: { status: m.status, effectiveFrom: m.effectiveFrom, effectiveTo: m.effectiveTo },
          campaign: {
            code: m.campaign.code,
            status: m.campaign.status,
            effectiveFrom: m.campaign.effectiveFrom,
            effectiveTo: m.campaign.effectiveTo,
            cookieWindowDays: m.campaign.cookieWindowDays,
            sites: m.campaign.sites.map((s) => ({ siteId: s.site.id })),
            landings: m.campaign.landings,
          },
          site: { baseUrl: site.baseUrl, allowedDomains: site.allowedDomains, status: site.status, trackingEnabled: site.trackingEnabled, landingPages: site.landingPages },
        };
        return { tenWebsite: site.name, chuoi: chuoiTuDong(hang) };
      }),
    }));
  const sanSang = danhGiaPhatLink(ungVienLink, p.now);

  const dem: Record<TrangThaiMembership, number> = { PENDING: 0, ACTIVE: 0, SUSPENDED: 0, ENDED: 0 };
  for (const m of doiTac.memberships) dem[m.status] += 1;
  const thieuNguon = chuongTrinh.filter((c) => c.trangThai !== "ENDED" && (c.nguon.loai === "XEM_TAY" || c.nguon.canhBao !== null)).length;
  const buoc = cacBuocOnboarding({
    doiTac: { status: doiTac.status, coLoai: doiTac.type !== null },
    thanhVien: dem,
    soChuongTrinhThieuNguon: thieuNguon,
    soTaiKhoanHoatDong,
    sanSangPhatLink: sanSang.sanSang,
  });

  return { chuongTrinh, ungVien, conUngVien: ungVienRows.length > TOI_DA_UNG_VIEN_GHI_DANH, sanSang, buoc };
}
