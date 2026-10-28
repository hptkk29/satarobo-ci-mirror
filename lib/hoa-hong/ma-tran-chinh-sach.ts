// lib/hoa-hong/ma-tran-chinh-sach.ts — MA TRẬN CHÍNH SÁCH chỉ đọc (06 §5.2): vai hưởng × (nhóm nguồn + UNKNOWN). THUẦN.
//
// Ma trận KHÔNG có luật riêng. Mỗi ô là câu trả lời của chính bộ chọn của engine (`chonQuyTac`), cột UNKNOWN là
// `quyTacChoNguonKhongRo` (mức thấp nhất, tính động — D7). Viết lại "cụ thể thắng chung" ở đây là dựng nguồn thứ hai cho
// luật quyết định tiền: ma trận in 4% mà engine trả 3% là loại lỗi không test nào bắt. Hàng cuối so tổng với trần bằng SỐ
// NGUYÊN micro (9% đúng bằng trần ⇒ không vượt; 9,0001% ⇒ vượt) — cùng phép so với `kiemTran`.
//
// Ngữ cảnh xem: `orgUnitPath` = đơn vị của GIAO DỊCH giả định ("/" = toàn hệ thống; đường dẫn cơ sở = xem tại cơ sở đó),
// `rateDate` = ngày hiệu lực. Không có người hưởng/đối tác/vai RBAC cụ thể ⇒ các phạm vi PERSON/AFFILIATE/ROLE không khớp:
// ma trận trả lời "mức nền", không phải "mức của một người".
import { CO_SO_CHUAN } from "./guardrail-kich-hoat";
import {
  chonQuyTac,
  quyTacChoNguonKhongRo,
  type PhamVi,
  type QuyTac,
} from "./chon-quy-tac";
import { microSangPhanTram, microSangTiLe } from "./phan-tram";
import { tiLeSangMicro } from "./tien";

export type CotMaTran = {
  /** id nhóm nguồn, hoặc "UNKNOWN". */
  khoa: string;
  nhan: string;
  laUnknown: boolean;
  /** Có ô CHONG_LAN trong cột — tổng của cột không tin được. */
  coChongLan: boolean;
};

type NguonGocO = { cuThe: boolean; policyId: string; policyCode: string; version: number; phamVi: PhamVi };

export type OMaTran = { cot: string } & (
  | ({ kieu: "PERCENT"; tiLe: string; phanTram: string; /** UNKNOWN: mã nhóm làm nên mức thấp nhất. */ nhomMin?: string } & NguonGocO)
  | ({ kieu: "EXCLUDE" } & NguonGocO)
  | ({ kieu: "CO_DINH"; soTien: number } & NguonGocO)
  | ({ kieu: "KHAC_KIEU"; kieuTinh: string } & NguonGocO)
  | { kieu: "KHONG_CO" }
  | { kieu: "CHONG_LAN"; lyDo: string }
);

export type DongMaTran = {
  /** `isAcquisition` để bảng tách «hoa hồng nguồn» khỏi «giao dịch khác» (`nhom-hoa-hong.ts`); không ảnh hưởng cách chọn quy tắc hay cách cộng tổng. */
  vai: { code: string; name: string; isAcquisition: boolean };
  o: OMaTran[];
};

export type TongCot = {
  khoa: string;
  /** Tổng các tỉ lệ PERCENT của cột, dạng "9" / "8,5" / "9,0001". */
  tongPhanTram: string;
  vuotTran: boolean;
  /** Cột có ô chồng lấn / kiểu tính không quy ra % được ⇒ con số tổng chỉ là phần biết được. */
  khongTinDuoc: boolean;
};

export type MaTran = { cot: CotMaTran[]; dong: DongMaTran[]; tong: TongCot[]; tranPhanTram: string };

export type MaTranDauVao = {
  quyTac: readonly QuyTac[];
  /** Nhóm nguồn ĐANG HOẠT ĐỘNG (không gồm UNKNOWN), đã sắp. */
  nhomNguon: readonly { id: string; code: string; name: string; coHoaHong: boolean }[];
  vai: readonly { code: string; name: string; isAcquisition: boolean }[];
  loai: "NEW" | "RENEWAL";
  orgUnitPath: string;
  rateDate: Date;
  /** BẮT BUỘC (luật 7): thứ tự phạm vi lấy từ cấu hình, hàm không có mặc định. */
  thuTuPhamVi: readonly PhamVi[];
  /** BẮT BUỘC: `getSetting("crm.commissionMaxTotalRate")`. */
  tran: number;
};

function oTuQuyTac(cot: string, q: QuyTac, nhomMin?: string): OMaTran {
  const goc: NguonGocO = {
    // "Cụ thể" = khác GLOBAL, hoặc do một ĐƠN VỊ cụ thể (độ sâu ≥ 0) sở hữu: rule của cơ sở cụ thể hơn rule Hội sở.
    cuThe: q.scopeType !== "GLOBAL" || q.orgUnitDepth >= 0,
    policyId: q.policyId,
    policyCode: q.policyCode,
    version: q.version,
    phamVi: q.scopeType,
  };
  switch (q.kieuTinh) {
    case "PERCENT": {
      const micro = tiLeSangMicro(String(q.giaTri));
      return { cot, kieu: "PERCENT", tiLe: microSangTiLe(micro), phanTram: microSangPhanTram(micro), ...(nhomMin ? { nhomMin } : {}), ...goc };
    }
    case "EXCLUDE":
      return { cot, kieu: "EXCLUDE", ...goc };
    case "FIXED_PER_PURCHASE":
      return { cot, kieu: "CO_DINH", soTien: Number(q.giaTri), ...goc };
    default:
      return { cot, kieu: "KHAC_KIEU", kieuTinh: q.kieuTinh, ...goc };
  }
}

export function dungMaTran(d: MaTranDauVao): MaTran {
  const nhomGon = d.nhomNguon.map((n) => ({ id: n.id, code: n.code, coHoaHong: n.coHoaHong }));
  const cot: CotMaTran[] = [
    ...d.nhomNguon.map((n) => ({ khoa: n.id, nhan: n.name, laUnknown: false, coChongLan: false })),
    { khoa: "UNKNOWN", nhan: "Không rõ nguồn", laUnknown: true, coChongLan: false },
  ];

  const dong: DongMaTran[] = d.vai.map((v) => {
    const o: OMaTran[] = d.nhomNguon.map((n): OMaTran => {
      const r = chonQuyTac({
        ctx: {
          roleCode: v.code,
          transactionType: d.loai,
          revenueComponent: "TUITION",
          rateDate: d.rateDate,
          orgUnitPath: d.orgUnitPath,
          nguoiHuongUserId: null,
          affiliateId: null,
          sourceId: null,
          campaignId: null,
          eventId: null,
          sourceGroupId: n.id,
          nguonCoHoaHong: n.coHoaHong,
          roleDefIds: [],
        },
        quyTac: d.quyTac,
        thuTuPhamVi: d.thuTuPhamVi,
      });
      if (r.loai === "THANG") return oTuQuyTac(n.id, r.quyTac);
      if (r.loai === "CHONG_LAN") return { cot: n.id, kieu: "CHONG_LAN", lyDo: r.lyDo };
      return { cot: n.id, kieu: "KHONG_CO" };
    });

    const u = quyTacChoNguonKhongRo({
      ctx: {
        roleCode: v.code,
        transactionType: d.loai,
        revenueComponent: "TUITION",
        rateDate: d.rateDate,
        orgUnitPath: d.orgUnitPath,
        nguoiHuongUserId: null,
        roleDefIds: [],
      },
      nhomDangHoatDong: nhomGon,
      quyTac: d.quyTac,
      thuTuPhamVi: d.thuTuPhamVi,
      coSo: CO_SO_CHUAN,
    });
    o.push(
      u.loai === "THANG"
        ? oTuQuyTac("UNKNOWN", u.quyTac, u.nhomMin.code)
        : u.loai === "CHONG_LAN"
          ? { cot: "UNKNOWN", kieu: "CHONG_LAN", lyDo: u.lyDo }
          : { cot: "UNKNOWN", kieu: "KHONG_CO" },
    );
    return { vai: v, o };
  });

  const tran = tiLeSangMicro(d.tran);
  const tong: TongCot[] = cot.map((c) => {
    let micro = BigInt(0);
    let khongTin = false;
    for (const r of dong) {
      const x = r.o.find((y) => y.cot === c.khoa);
      if (!x) continue;
      if (x.kieu === "PERCENT") micro += tiLeSangMicro(x.tiLe);
      else if (x.kieu === "CHONG_LAN" || x.kieu === "CO_DINH" || x.kieu === "KHAC_KIEU") khongTin = true;
    }
    c.coChongLan = dong.some((r) => r.o.find((y) => y.cot === c.khoa)?.kieu === "CHONG_LAN");
    return { khoa: c.khoa, tongPhanTram: microSangPhanTram(micro), vuotTran: micro > tran, khongTinDuoc: khongTin };
  });

  return { cot, dong, tong, tranPhanTram: microSangPhanTram(tran) };
}
