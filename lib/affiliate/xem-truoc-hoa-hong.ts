/**
 * lib/affiliate/xem-truoc-hoa-hong.ts — XEM TRƯỚC «hoa hồng dự kiến» của MỘT campaign với MỘT đối tác mẫu, TRƯỚC khi kích hoạt (AFF-L1).
 *
 * KHÔNG có bộ mô phỏng thứ hai. Phần tính là CHÍNH `tinhChinhSachChoPhan` (hàm mà engine thật · thử tính · «dự kiến của bạn» cùng gọi — L11) chạy trên cấu hình mà `dungKichBan` + `haiBoCauHinh`
 * dựng (CÙNG hàm với thử tính): bản chính sách của campaign được coi là đang hiệu lực, thay thế mọi bản khác của cùng chính sách. Nguồn của đối tác mẫu lấy từ `docXemTruocNguon` (CÙNG hàm giải nguồn
 * với P1) — màn xem trước nguồn đã đứng ngay bên dưới nên hai nơi không thể nói hai nguồn khác nhau.
 *
 * Nói thật về giả định (luật 12): đây là MỘT khoản mẫu, không phải khách thật — cơ sở tính do người xem nhập (mặc định 10.000.000đ), sự kiện luôn là «khoản học phí đã thu», giao dịch giả định ở
 * Hội sở, và các vai khác (Sale, QLCS…) KHÔNG có người nên chỉ tính vào TRẦN, không ra tiền. Cửa sổ ghi công 90 ngày KHÔNG đo (khoản mẫu không có ngày quy nguồn).
 * Thử tính trên khoản thu THẬT nằm ở trình soạn chính sách (bước «Thử tính»).
 */
import { db } from "@/lib/db";
import type { QuyTac } from "@/lib/hoa-hong/chon-quy-tac";
import { docHoaHongContext, docQuyTacCuaVersion } from "@/lib/hoa-hong/chinh-sach-service";
import { NHAN_LOAI_GD } from "@/lib/hoa-hong/chinh-sach-form";
import type { HoaHongContext } from "@/lib/hoa-hong/kieu";
import { dungKichBan, haiBoCauHinh } from "@/lib/hoa-hong/mo-phong";
import type { KetQuaNguoiHuong } from "@/lib/hoa-hong/nguoi-huong";
import { dinhDangPhanTram } from "@/lib/hoa-hong/phan-tram";
import { tinhChinhSachChoPhan } from "@/lib/hoa-hong/tinh-chinh-sach";
import { MASTER_VAI_HUONG } from "@/lib/hoa-hong/vai-huong";
import { docXemTruocNguon } from "./doc-campaign";

/** Cơ sở tính mặc định của khoản mẫu — CÙNG số với `CO_SO_CHUAN` của guardrail (04 §6.5). */
export const CO_SO_MAU_MAC_DINH = 10_000_000;

export type LoaiGdMau = "NEW" | "RENEWAL";

export type DongVaiXemTruoc = {
  roleCode: string;
  vai: string;
  /** Kiểu + mức của quy tắc thắng, dạng chữ («3%», «500.000đ mỗi lần mua», «không trả»); `null` = vai không có quy tắc nào áp. */
  quyTac: string | null;
  /** Tiền của vai trên khoản mẫu; `null` = không ra tiền (vai không có người trong ví dụ, hoặc không có quy tắc). */
  soTien: number | null;
  ghiChu: string | null;
};

export type KetQuaXemTruocHoaHong =
  | { loai: "NGUON_XEM_TAY"; lyDo: string }
  | { loai: "CHUA_CO_CHINH_SACH" }
  | { loai: "CHONG_LAN"; lyDo: string }
  | { loai: "VUOT_TRAN"; tiLe: number; tran: number }
  | {
      loai: "OK";
      campaign: string;
      nguon: string;
      doiTac: string;
      suKien: string;
      coSo: number;
      chinhSach: { policyCode: string; versionNo: number; trangThai: "DRAFT" | "ACTIVE" };
      vai: DongVaiXemTruoc[];
      /** Σ tỉ lệ tương đương của MỌI quy tắc thắng (gồm vai không ra tiền) — thứ đem so với trần. */
      tiLeTuongDuong: number;
      tran: number;
    };

const tenVai = (code: string): string => MASTER_VAI_HUONG.find((v) => v.code === code)?.name ?? code;

function moTaQuyTac(q: QuyTac): string {
  if (q.kieuTinh === "PERCENT") return `${dinhDangPhanTram(String(q.giaTri))}%`;
  if (q.kieuTinh === "FIXED_PER_PURCHASE") return `${Number(q.giaTri).toLocaleString("vi-VN")}đ mỗi lần mua (trả một lần, ở khoản thu đầu)`;
  if (q.kieuTinh === "EXCLUDE") return "không trả";
  return "theo bậc";
}

/**
 * THUẦN. `hoaHong` đã là cấu hình «sau khi áp bản đề xuất». Đối tác mẫu đóng vai AFFILIATE (người hưởng DUY NHẤT trong ví dụ); mọi vai còn lại TREO ("KHONG_CO_LEAD") — vẫn vào kiểm trần, không ra tiền.
 * Tên không lộ gì ngoài tên campaign / nguồn / đối tác mà người xem đã thấy ở trang.
 */
export function tinhXemTruocHoaHong(d: {
  hoaHong: HoaHongContext;
  campaign: { id: string; ten: string };
  nguon: { sourceGroupId: string; ten: string; coHoaHong: boolean };
  doiTac: { id: string; ten: string };
  chinhSach: { policyCode: string; versionNo: number; trangThai: "DRAFT" | "ACTIVE" };
  loaiGd: LoaiGdMau;
  coSo: number;
  rateDate: Date;
}): KetQuaXemTruocHoaHong {
  const coQuyTac = new Set(d.hoaHong.quyTac.map((q) => q.roleCode));
  const nguoiHuong = new Map<string, KetQuaNguoiHuong>();
  for (const v of d.hoaHong.vaiHuong) {
    if (!v.isActive || !coQuyTac.has(v.code)) continue;
    nguoiHuong.set(
      v.code,
      v.code === "AFFILIATE"
        ? { loai: "CO_NGUOI", nguoi: [{ kind: "AFFILIATE", id: d.doiTac.id }], biLoai: [], canCu: "Đối tác mẫu" }
        : { loai: "TREO", lyDo: "KHONG_CO_LEAD", canCu: "Khoản mẫu không có khách thật" },
    );
  }
  const kq = tinhChinhSachChoPhan({
    hoaHong: d.hoaHong,
    loaiGiaoDich: d.loaiGd,
    coSo: d.coSo,
    rateDate: d.rateDate,
    orgUnitPath: "/",
    nguon: { sourceGroupId: d.nguon.sourceGroupId, coHoaHong: d.nguon.coHoaHong, affiliateId: d.doiTac.id, sourceId: null, campaignId: d.campaign.id, eventId: null },
    nguoiHuong,
    roleDefIdsTheoNguoi: new Map(),
    // Khoản mẫu LÀ khoản thu đầu của một lần mua (FIXED_PER_PURCHASE trả một lần, ở khoản đầu) và `coSo` là cơ sở của chính nó — xem trước nói «lần mua đầu tiên thu ngần này thì ra ngần này».
    lanMua: { laKhoanDau: true, coSoGoc: d.coSo },
  });
  if (kq.loai === "CHONG_LAN") return { loai: "CHONG_LAN", lyDo: kq.lyDo };
  if (kq.loai === "VUOT_TRAN") return { loai: "VUOT_TRAN", tiLe: kq.tiLeTuongDuong, tran: kq.tran };
  const vai: DongVaiXemTruoc[] = kq.cacVai.map((v) => ({
    roleCode: v.roleCode,
    vai: tenVai(v.roleCode),
    quyTac: v.quyTac ? moTaQuyTac(v.quyTac) : null,
    soTien: v.trangThai === "SINH_DONG" ? v.tienVai : null,
    ghiChu:
      v.trangThai === "TREO"
        ? "Không có người trong ví dụ — chỉ tính vào trần"
        : v.trangThai === "KHONG_RULE"
          ? "Không có quy tắc nào áp cho vai này"
          : v.trangThai === "EXCLUDE"
            ? "Loại trừ rõ ràng"
            : null,
  }));
  return {
    loai: "OK",
    campaign: d.campaign.ten,
    nguon: d.nguon.ten,
    doiTac: d.doiTac.ten,
    // Có vai nhận số tiền CỐ ĐỊNH ⇒ nói thẳng ví dụ này là khoản thu ĐẦU của lần mua (số cố định chỉ trả ở khoản ấy; các khoản sau của cùng lần mua không trả thêm).
    suKien: `Khoản học phí đã thu — ${NHAN_LOAI_GD[d.loaiGd].toLowerCase()}${kq.cacVai.some((v) => v.quyTac?.kieuTinh === "FIXED_PER_PURCHASE") ? " · ví dụ này là khoản thu ĐẦU của lần mua (số tiền cố định chỉ trả ở khoản đầu)" : ""}`,
    coSo: d.coSo,
    chinhSach: d.chinhSach,
    vai,
    tiLeTuongDuong: kq.tiLeTuongDuong,
    tran: d.hoaHong.tranTongTiLe,
  };
}

/**
 * Đọc rồi tính. Phiên bản xem trước = NHÁP mới nhất của campaign; không có nháp thì bản ACTIVE (chưa hết hạn) mới nhất; không có gì ⇒ `CHUA_CO_CHINH_SACH`.
 * Client KHÔNG scope (campaign + chính sách campaign là danh mục toàn hệ); người gọi (page) chỉ gọi khi người xem có `commission_policies:view`.
 */
export async function docXemTruocHoaHongCampaign(p: { campaignId: string; partyId: string; loaiGd: LoaiGdMau; coSo: number; now: Date }): Promise<KetQuaXemTruocHoaHong | null> {
  const xt = await docXemTruocNguon({ campaignId: p.campaignId, partyId: p.partyId, now: p.now });
  if (!xt) return null;
  if (xt.ketQua.loai === "XEM_TAY") return { loai: "NGUON_XEM_TAY", lyDo: xt.ketQua.lyDo };

  const versions = await db.commissionPolicyVersion.findMany({
    where: { scopeType: "CAMPAIGN", scopeCampaignId: p.campaignId, status: { in: ["DRAFT", "ACTIVE"] } },
    orderBy: [{ versionNo: "desc" }],
    select: { id: true, policyId: true, versionNo: true, status: true, effectiveTo: true, policy: { select: { policyCode: true } } },
  });
  const dangAp = (v: (typeof versions)[number]) => v.status === "ACTIVE" && (v.effectiveTo === null || v.effectiveTo.getTime() > p.now.getTime());
  const chon = versions.find((v) => v.status === "DRAFT") ?? versions.find(dangAp);
  if (!chon) return { loai: "CHUA_CO_CHINH_SACH" };

  const [camp, nhom, ctx, quyTacDeXuat] = await Promise.all([
    db.affiliateCampaign.findUniqueOrThrow({ where: { id: p.campaignId }, select: { name: true } }),
    db.leadSourceGroup.findUniqueOrThrow({ where: { id: xt.ketQua.sourceGroupId }, select: { commissionEnabled: true, name: true } }),
    docHoaHongContext(db),
    docQuyTacCuaVersion(db, chon.id),
  ]);
  const kb = dungKichBan({ quyTacDaNap: ctx.quyTac, quyTacDeXuat, policyIdDeXuat: chon.policyId, now: p.now });
  return tinhXemTruocHoaHong({
    hoaHong: haiBoCauHinh(ctx, kb).deXuat,
    campaign: { id: p.campaignId, ten: camp.name },
    nguon: { sourceGroupId: xt.ketQua.sourceGroupId, ten: nhom.name, coHoaHong: nhom.commissionEnabled },
    doiTac: { id: xt.doiTac.id, ten: xt.doiTac.ten },
    chinhSach: { policyCode: chon.policy.policyCode, versionNo: chon.versionNo, trangThai: chon.status === "DRAFT" ? "DRAFT" : "ACTIVE" },
    loaiGd: p.loaiGd,
    coSo: p.coSo,
    rateDate: p.now,
  });
}
