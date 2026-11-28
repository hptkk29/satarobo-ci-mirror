// [SNC-NULL-*] — CHỨNG MINH «NULL là fail-closed» trên CHÍNH hàm của hai engine hoa hồng (không mô phỏng), và ghim chỗ NULL KHÔNG fail-closed.
//
// Lệnh sửa người chốt đưa `Lead.convertedById` về NULL khi bằng chứng không đủ. Điều đó chỉ an toàn nếu:
//   (1) engine CŨ (`mapButToanHoaHong` + `tinhHoaHongTheoKy` + `thongKe`) bỏ tầng SALE và BÁO số tiền treo — không rơi về người nhập phiếu;
//   (2) engine MỚI (`phanGiaiNguoiHuong`) trả TREO `LEAD_THIEU_NGUOI` — không sinh dòng, không đoán;
//   (3) CHỖ NÀO NULL không treo thì phải biết và nói ra: `chonSaleCuaPhuHuynh` lùi về `assignedToId` — nay CHỈ với lead CHƯA TỪNG chuyển đổi
//       (`convertedAt = NULL`); lead đã chuyển đổi mà người chốt NULL là HOLD (xem `sua-nguoi-chot-hold.test.ts` [SNC-HOLD-*]).
import { describe, expect, it } from "vitest";
import { mapButToanHoaHong, thongKe, type HangThanhToanHoaHong } from "@/lib/crm/commission-run";
import { DEFAULT_RATES } from "@/lib/crm/commission";
import { TRANG_THAI_THUC_THU } from "@/lib/finance/thuc-thu";
import { tinhHoaHongTheoKy } from "@/lib/crm/commission-thuc-thu";
import { phanGiaiNguoiHuong, type NguCanhNguoiHuong, type VaiResolver } from "@/lib/hoa-hong/nguoi-huong";
import { chonSaleCuaPhuHuynh } from "@/lib/nguon/sale-cua-phu-huynh";
import { vaLeadTrongBoNho, type UngVienLead } from "@/lib/nguon/noi-don";
import { leadSauKhiSua, nguoiChotMoiTheoLead, vaNguoiChotTrongBoNho, type DongKeHoach } from "@/lib/nguon/sua-nguoi-chot";

const PERIOD = "2026-06";
const NGAY = new Date("2026-06-15T03:00:00.000Z");
const ratesAt = () => DEFAULT_RATES;

type Hang = HangThanhToanHoaHong & { orderId: string };
function hang(orderId: string, leadId: string | null, convertedById: string | null): Hang {
  return {
    id: `p-${orderId}`,
    orderId,
    amount: 10_000_000,
    accountantStatus: TRANG_THAI_THUC_THU[0],
    adjustmentOfId: null,
    paidDate: NGAY,
    confirmedAt: NGAY,
    centerId: "cs-2",
    adjustmentOf: null,
    enrollment: { renewedFromEnrollmentId: null },
    order: { leadId, centerId: "cs-2", lead: leadId === null ? null : { convertedById, adminId: null, centerId: "cs-1" } },
  };
}
const saleDong = (rows: Hang[]) => {
  const bt = mapButToanHoaHong(rows, []);
  const dong = tinhHoaHongTheoKy({ period: PERIOD, butToan: bt, ratesAt });
  return { bt, dong, sale: dong.filter((d) => d.tier === "SALE"), thongKe: thongKe(PERIOD, bt, dong, ratesAt) };
};
const TIEN_SALE = Math.round(10_000_000 * DEFAULT_RATES.SALE);

describe("[SNC-NULL] NULL ở tầng SALE là FAIL-CLOSED trên cả hai engine", () => {
  it("[SNC-NULL-01] engine CŨ: convertedById NULL ⇒ KHÔNG có dòng SALE, tiền SALE hiện ở `chuaCoNguoiHuong` (treo, KHÔNG biến mất); đối chứng: có người ⇒ có dòng", () => {
    const co = saleDong([hang("o1", "L1", "u-admin")]);
    expect(co.sale).toHaveLength(1);
    expect(co.sale[0]!.recipientId).toBe("u-admin");
    expect(co.sale[0]!.amount).toBe(TIEN_SALE);
    expect(co.thongKe.chuaCoNguoiHuong.SALE ?? 0).toBe(0);

    const khong = saleDong([hang("o1", "L1", null)]);
    expect(khong.bt[0]!.recipients.SALE).toBeUndefined();
    expect(khong.sale).toEqual([]);
    expect(khong.thongKe.chuaCoNguoiHuong.SALE).toBe(TIEN_SALE);
  });

  it("[SNC-NULL-02] engine MỚI: LEAD_CONVERTED_BY mà lead chưa có người ⇒ TREO LEAD_THIEU_NGUOI; có người ⇒ CO_NGUOI", () => {
    const vai: VaiResolver = { code: "SALE", resolverType: "TRANSACTION_ROLE", resolverKey: "LEAD_CONVERTED_BY" };
    const ctx = (convertedById: string | null): NguCanhNguoiHuong => ({
      centerId: "cs-2",
      assigneeDate: NGAY,
      lead: { convertedById, adminId: null },
      phanCongCoSo: [],
      gvTrialUserId: null,
      attribution: null,
      trangThaiNhanSu: new Map(),
      affiliateConHoatDong: new Map(),
    });
    expect(phanGiaiNguoiHuong(vai, ctx(null))).toMatchObject({ loai: "TREO", lyDo: "LEAD_THIEU_NGUOI" });
    expect(phanGiaiNguoiHuong(vai, ctx("u-sale"))).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ id: "u-sale" }] });
  });

  it("[SNC-NULL-03] GHIM: `chonSaleCuaPhuHuynh` lùi về `assignedToId` CHỈ khi lead CHƯA TỪNG chuyển đổi (convertedAt NULL — dữ liệu cũ); lead ĐÃ chuyển đổi mà convertedById NULL ⇒ null (hold)", () => {
    const lead = { id: "L1", convertedById: null, assignedToId: "u-lien", convertedAt: null, createdAt: new Date("2026-08-06T00:00:00Z"), deletedAt: null };
    const kq = chonSaleCuaPhuHuynh({ studentId: "s1", parentUserId: null, hocVien: [{ id: "s1", parentUserId: null, lead }], bayGio: new Date("2026-10-22T00:00:00Z") });
    expect(kq).toBe("u-lien");
    // lead ĐÃ chuyển đổi (convertedAt có) + convertedById NULL = «người chốt chưa xác định» ⇒ KHÔNG đoán từ người chăm
    const daChuyenDoi = { ...lead, convertedAt: new Date("2026-08-07T01:13:57Z") };
    expect(chonSaleCuaPhuHuynh({ studentId: "s1", parentUserId: null, hocVien: [{ id: "s1", parentUserId: null, lead: daChuyenDoi }], bayGio: new Date("2026-10-22T00:00:00Z") })).toBeNull();
    // đối chứng: có convertedById thì convertedById thắng assignedToId
    expect(chonSaleCuaPhuHuynh({ studentId: "s1", parentUserId: null, hocVien: [{ id: "s1", parentUserId: null, lead: { ...lead, convertedById: "u-admin" } }], bayGio: new Date("2026-10-22T00:00:00Z") })).toBe("u-admin");
  });
});

describe("[SNC-NULL-04] vá người chốt trong bộ nhớ → tác động thật qua engine", () => {
  const dongGhi = (leadId: string, moi: string | null): DongKeHoach => ({
    leadId,
    oldConvertedById: "u-admin",
    newConvertedById: moi,
    loai: moi === null ? "CLEAR" : "REASSIGN",
    reasonCode: "x",
    evidenceClass: "x",
    confidence: "NA",
    sourceActor: "u-admin",
    saleEvidence: "-",
    campusCheck: "NA",
    soDon: 1,
    thuTong: 0,
  });
  const rows = [hang("o1", "L1", "u-admin"), hang("o2", "L2", "u-admin"), hang("o3", null, null)];

  it("[SNC-NULL-04a] REASSIGN: SALE của L1 chuyển sang Sale thật; L2 (không có dòng ghi) và đơn chưa nối GIỮ NGUYÊN", () => {
    const moi = nguoiChotMoiTheoLead([dongGhi("L1", "u-lien")]);
    const sau = saleDong(vaNguoiChotTrongBoNho(rows, moi));
    expect(sau.sale.map((d) => [d.recipientId, d.amount]).sort()).toEqual([["u-admin", TIEN_SALE], ["u-lien", TIEN_SALE]]);
    expect(rows[0]!.order!.lead!.convertedById).toBe("u-admin"); // không đổi đầu vào
  });

  it("[SNC-NULL-04b] CLEAR: SALE của L1 biến khỏi `dong` và hiện ở `chuaCoNguoiHuong` đúng số tiền (không mất tiền)", () => {
    const sau = saleDong(vaNguoiChotTrongBoNho(rows, nguoiChotMoiTheoLead([dongGhi("L1", null)])));
    expect(sau.sale.map((d) => d.recipientId)).toEqual(["u-admin"]); // chỉ còn L2
    expect(sau.thongKe.chuaCoNguoiHuong.SALE).toBe(TIEN_SALE + TIEN_SALE); // L1 (vừa xoá) + đơn chưa nối o3 (thực thu không quy được lead)
  });

  it("[SNC-NULL-04c] dòng KHÔNG ghi (ALREADY_CORRECT/MANUAL_REVIEW) không có trong bản đồ vá ⇒ vá là no-op", () => {
    const kh: DongKeHoach[] = [{ ...dongGhi("L1", "u-lien"), loai: "MANUAL_REVIEW" }, { ...dongGhi("L2", "u-lien"), loai: "ALREADY_CORRECT" }];
    const moi = nguoiChotMoiTheoLead(kh);
    expect(moi.size).toBe(0);
    expect(vaNguoiChotTrongBoNho(rows, moi)).toEqual(rows);
  });

  it("[SNC-NULL-05] «sửa RỒI nối đơn»: đơn chưa nối vào lead đã sửa mang người chốt MỚI; không sửa thì mang người cũ (cột c0 của dry-run)", () => {
    const ungVien: UngVienLead = { leadId: "L1", phone: "0900000001", deletedAt: null, convertedById: "u-admin", adminId: null, centerId: "cs-1" };
    const chuaNoi = [hang("o9", null, null)];
    const va = new Map([["o9", ungVien]]);
    const moi = nguoiChotMoiTheoLead([dongGhi("L1", "u-lien")]);
    const c0 = saleDong(vaLeadTrongBoNho(chuaNoi, va));
    const c2 = saleDong(vaLeadTrongBoNho(chuaNoi, new Map([["o9", leadSauKhiSua(ungVien, moi)]])));
    expect(c0.sale.map((d) => d.recipientId)).toEqual(["u-admin"]);
    expect(c2.sale.map((d) => d.recipientId)).toEqual(["u-lien"]);
  });
});
