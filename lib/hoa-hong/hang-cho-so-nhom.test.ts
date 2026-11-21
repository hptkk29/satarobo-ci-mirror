// @vitest-environment node
/**
 * [NHH-H-NL-U*] — NHÓM + NHÃN của hàng chờ SỔ (CommissionHold), phần THUẦN. Nguồn: 04 §7.1, §10.5; 06 §6 ("vai treo tách khỏi hàng chờ chặn").
 *
 * Chốt Stage 3 (b): đơn KHÔNG có lead ⇒ hàng chờ `UNRESOLVED_BENEFICIARY` hiển thị là «Chưa phân giải người hưởng» — một nhóm RIÊNG, KHÔNG chặn khoá kỳ,
 * và KHÔNG nằm lẫn với hàng chờ chặn. Bảng dưới chép từ ĐẶC TẢ, không từ mã.
 */
import { CommissionHoldCode } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { hangChoChanKy, type MaHold } from "./hang-cho";
import {
  LOAI_HANG_CHO_SO,
  loaiCuaMa,
  NHAN_LOAI,
  NHAN_LY_DO_TREO,
  NHAN_MA_HANG_CHO,
  NHAN_NHOM,
  NHOM_HANG_CHO_SO,
  nhanLyDoTreo,
  nhomCuaMa,
} from "./hang-cho-so-nhom";
import type { LyDoTreo } from "./nguoi-huong";

const TAT_CA_MA = Object.values(CommissionHoldCode) as MaHold[];

describe("[NHH-H-NL-U1] nhóm của hàng chờ sổ", () => {
  it("UNRESOLVED_BENEFICIARY là nhóm RIÊNG «Chưa phân giải người hưởng»; NEGATIVE_BALANCE là «Số dư âm»", () => {
    expect(nhomCuaMa("UNRESOLVED_BENEFICIARY")).toBe("CHUA_PHAN_GIAI_NGUOI_HUONG");
    expect(NHAN_NHOM.CHUA_PHAN_GIAI_NGUOI_HUONG).toBe("Chưa phân giải người hưởng");
    expect(NHAN_MA_HANG_CHO.UNRESOLVED_BENEFICIARY).toBe("Chưa phân giải người hưởng");
    expect(nhomCuaMa("NEGATIVE_BALANCE")).toBe("SO_DU_AM");
  });

  it("nhóm «chặn khoá kỳ» ⇔ `hangChoChanKy` — mọi mã còn lại không bao giờ rơi vào nhóm chặn (và ngược lại)", () => {
    for (const m of TAT_CA_MA) {
      expect(nhomCuaMa(m) === "CHAN_KHOA_KY", `${m}`).toBe(hangChoChanKy(m));
    }
  });

  it("mọi mã của enum đều có nhãn tiếng Việt khác rỗng và không lộ tên mã kỹ thuật", () => {
    expect(Object.keys(NHAN_MA_HANG_CHO).sort()).toEqual([...TAT_CA_MA].sort());
    for (const m of TAT_CA_MA) {
      const nhan = NHAN_MA_HANG_CHO[m];
      expect(nhan.length, m).toBeGreaterThan(3);
      expect(nhan, m).not.toMatch(/[A-Z]{3,}_[A-Z]/); // không có SNAKE_CASE hoa
    }
  });

  it("danh sách nhóm đủ ba nhóm, nhóm chặn đứng đầu (việc quan trọng nhất của kỳ)", () => {
    expect([...NHOM_HANG_CHO_SO]).toEqual(["CHAN_KHOA_KY", "CHUA_PHAN_GIAI_NGUOI_HUONG", "SO_DU_AM"]);
  });
});

describe("[NHH-H-NL-U3] LOẠI hàng chờ sổ — năm nhóm hiển thị + số dư âm, MỘT nguồn cho tab Sổ và tab Kỳ", () => {
  // Bảng chép từ ĐẶC TẢ (TRACKS T2 §1 / 06 §5.3), không từ mã.
  const DAC_TA: Record<MaHold, (typeof LOAI_HANG_CHO_SO)[number]> = {
    UNRESOLVED_BENEFICIARY: "CHUA_PHAN_GIAI_NGUOI_HUONG",
    POLICY_OVERLAP: "CHO_CHINH_SACH",
    PENDING_REGULATION: "CHO_CHINH_SACH",
    MANUAL_REVIEW_REQUIRED: "CHO_CHINH_SACH",
    CAP_EXCEEDED: "VUOT_TRAN",
    CHUA_GAN_CON: "THIEU_DU_LIEU_THANH_TOAN",
    CHO_HOC_VIEN: "THIEU_DU_LIEU_THANH_TOAN",
    NO_ORG_UNIT: "THIEU_DU_LIEU_THANH_TOAN",
    INTERNAL_TRANSFER: "CHO_DIEU_CHINH",
    NEGATIVE_WITHOUT_ORIGIN: "CHO_DIEU_CHINH",
    INPUT_DRIFT: "CHO_DIEU_CHINH",
    PAYMENT_WITHDRAWN: "CHO_DIEU_CHINH",
    NEGATIVE_BALANCE: "SO_DU_AM",
  };

  it("mỗi mã của enum rơi đúng MỘT loại theo đặc tả, và bảng đặc tả phủ đủ enum (thêm mã mới mà quên phân loại ⇒ đỏ)", () => {
    expect(Object.keys(DAC_TA).sort()).toEqual([...TAT_CA_MA].sort());
    for (const m of TAT_CA_MA) expect(loaiCuaMa(m), m).toBe(DAC_TA[m]);
  });

  it("danh sách loại: đúng thứ tự hiển thị, mỗi loại có nhãn tiếng Việt, mỗi loại có ít nhất một mã (không loại rỗng)", () => {
    expect([...LOAI_HANG_CHO_SO]).toEqual([
      "CHUA_PHAN_GIAI_NGUOI_HUONG",
      "CHO_CHINH_SACH",
      "VUOT_TRAN",
      "THIEU_DU_LIEU_THANH_TOAN",
      "CHO_DIEU_CHINH",
      "SO_DU_AM",
    ]);
    expect(NHAN_LOAI.CHUA_PHAN_GIAI_NGUOI_HUONG).toBe("Chưa phân giải người hưởng");
    for (const l of LOAI_HANG_CHO_SO) {
      expect(NHAN_LOAI[l].length, l).toBeGreaterThan(3);
      expect(TAT_CA_MA.some((m) => loaiCuaMa(m) === l), l).toBe(true);
    }
  });

  it("loại KHÔNG đổi ngữ nghĩa chặn khoá: «chưa phân giải» và «số dư âm» không bao giờ chặn; các loại khác chỉ chứa mã chặn", () => {
    for (const m of TAT_CA_MA) {
      const l = loaiCuaMa(m);
      const khongChan = l === "CHUA_PHAN_GIAI_NGUOI_HUONG" || l === "SO_DU_AM";
      expect(hangChoChanKy(m), `${m}→${l}`).toBe(!khongChan);
    }
  });
});

describe("[NHH-H-NL-U2] lý do treo — tiếng Việt, và «không có lead» nói đúng nguyên nhân", () => {
  const MA_LY_DO: readonly LyDoTreo[] = [
    "KHONG_CO_LEAD",
    "LEAD_THIEU_NGUOI",
    "CHUA_KHAI_NGUOI_PHU_TRACH",
    "KHONG_QUY_VE_CO_SO",
    "KHONG_CO_GV_TRIAL",
    "THIEU_NGUOI_GIOI_THIEU",
    "THIEU_SALE_PHU_HUYNH",
    "NGUON_CHUA_CO_NGUOI_PHU_TRACH",
    "NGUOI_HUONG_NGHI",
    "RESOLVER_CHUA_HO_TRO",
    "RESOLVER_KHONG_BIET",
    "NGOAI_CUA_SO",
    "LEGACY_DA_TRA",
  ];

  it("nhãn phủ ĐỦ mọi lý do treo của resolver (thêm lý do mới mà quên nhãn ⇒ đỏ)", () => {
    expect(Object.keys(NHAN_LY_DO_TREO).sort()).toEqual([...MA_LY_DO].sort());
  });

  it("KHONG_CO_LEAD nêu thẳng «không có lead» và KHÔNG gợi ý đoán người (không nhắc người tạo đơn)", () => {
    const nhan = nhanLyDoTreo("KHONG_CO_LEAD");
    expect(nhan).toMatch(/không có lead/i);
    expect(nhan).not.toMatch(/người tạo đơn|createdBy/i);
  });

  it("mã lạ (dữ liệu cũ / chưa biết) ⇒ null, KHÔNG bịa nhãn", () => {
    expect(nhanLyDoTreo("MA_LA")).toBeNull();
    expect(nhanLyDoTreo(undefined)).toBeNull();
    expect(nhanLyDoTreo(42)).toBeNull();
  });
});
