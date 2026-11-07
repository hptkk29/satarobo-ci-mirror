// lib/finance/hoa-don/nha-cung-cap/bo-test-hop-dong.ts — BỘ TEST HỢP ĐỒNG DÙNG CHUNG cho mọi adapter nhà cung cấp.
//
// KHÔNG phải tệp `*.test.ts` (vitest không tự nhặt) — nó EXPORT một hàm đăng ký các ca; mỗi adapter có tệp
// test riêng gọi `chayBoTestHopDong(...)`. Thêm adapter mới (VIN, Viettel…) = một lời gọi nữa, KHÔNG viết
// lại ca nào; adapter nào không qua bộ này thì `adapterImplements` của nó không được bật (TD-05).
//
// Bộ này khoá luật ba kết quả của `CongHoaDon` (lib/misa/meinvoice/cong.ts):
//   · DA_PHAT_HANH — cùng khoá (refId) phát hành hai lần là CÙNG một hoá đơn, không bao giờ hai.
//   · TU_CHOI      — chắc chắn chưa có hoá đơn nào (traCuu cùng khoá ⇒ CHUA_CO).
//   · KHONG_RO     — timeout/mất kết nối: KHÔNG có refId mới nào được sinh, nơi gọi phải traCuu THEO KHOÁ CŨ.
// …và hợp đồng năng lực: thứ adapter không nối thì `duocPhep` chặn trước khi gọi; cờ khai khớp phương thức có thật.
//
// Mỗi ca tự tạo adapter qua `taoAdapter(kichBan)` ⇒ chạy MỘT MÌNH vẫn xanh (luật 18); refId gắn theo tên ca
// ⇒ không đọc đồng hồ, không đụng nhau (luật 19).

import { describe, expect, it, vi } from "vitest";
import type { PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import type { HoaDonNhaCungCap, MaNhaCungCap, PhuongThucNhaCungCap } from "./hop-dong";
import { PHUONG_THUC_CUA_NANG_LUC } from "./hop-dong";
import { NANG_LUC, chayNeuDuocPhep, duocPhep, type NangLuc } from "./nang-luc";

/** Kịch bản phía nhà cung cấp mà adapter thử phải dựng được. */
export type KichBan =
  /** Mọi lời gọi thành công. */
  | "THANH_CONG"
  /** Nhà cung cấp ĐÃ ghi nhận hoá đơn nhưng câu trả lời phát hành bị mất (timeout). */
  | "TIMEOUT_DA_GHI"
  /** Timeout mà nhà cung cấp CHƯA nhận gì. */
  | "TIMEOUT_CHUA_GHI"
  /** Đăng nhập/xác thực thất bại ở mọi lời gọi. */
  | "LOI_XAC_THUC";

export type AdapterThu = {
  readonly adapter: HoaDonNhaCungCap;
  /** Nhật ký nội bộ adapter đã ghi (nếu có) — bộ test soát rằng nó không chứa bí mật. */
  readonly nhatKy?: () => readonly string[];
  /**
   * Đổi kịch bản của CHÍNH adapter này giữa chừng (vd cấp hoá đơn ở THANH_CONG rồi chuyển sang LOI_XAC_THUC).
   * Tuỳ chọn: adapter nào không đổi được (MISA — kịch bản gắn với cổng dựng sẵn) thì không khai, và ca
   * [HDNCC-HD-08] rơi về đường tải bằng mã tra cứu tuỳ ý. Có khai ⇒ ca tải tệp thử bằng mã tra cứu THẬT,
   * để nhánh "lỗi xác thực" của taiTep không bị che bởi nhánh "mã lạ".
   */
  readonly datKichBan?: (kichBan: KichBan) => void;
};

export type KyVongHopDong = {
  readonly nhaCungCap: MaNhaCungCap;
  /** ĐÚNG tập năng lực adapter được phép khai `adapterImplements=true` — thừa hay thiếu đều đỏ. */
  readonly adapterImplements: readonly NangLuc[];
  /** Chuỗi bí mật (tài khoản/mật khẩu/AppID giả của kịch bản) — KHÔNG được xuất hiện trong lỗi/nhật ký. */
  readonly biMat: readonly string[];
};

export const MST_NGUOI_BAN_MAU = "0402145678";

export function phieuMauHopDong(refId: string): PhieuPhatHanh {
  return {
    refId,
    kyHieu: "1C26TSR",
    mstNguoiBan: MST_NGUOI_BAN_MAU,
    ngayHoaDon: new Date("2026-09-30T00:00:00.000Z"),
    nguoiMua: { hoTen: "Nguyễn Văn A", donVi: null, mst: null, diaChi: null, email: null, maKhachHang: null },
    hinhThucThanhToan: "Chuyển khoản",
    dong: [
      { stt: 1, ten: "Học phí", donViTinh: "Khoá", soLuong: 1, donGia: 5000000, thanhTien: 5000000, thueSuat: "KCT", tienThue: 0 },
    ],
    tongTruocThue: 5000000,
    tongThue: 0,
    tongThanhToan: 5000000,
    soTienBangChu: "Năm triệu đồng.",
  };
}

/** Phiếu SAI (ký hiệu sai dạng) — mọi adapter phải tự chặn TRƯỚC khi gửi ⇒ TU_CHOI chắc chắn. */
function phieuSai(refId: string): PhieuPhatHanh {
  return { ...phieuMauHopDong(refId), kyHieu: "KY-HIEU-SAI" };
}

/** Mẫu rò bí mật chung, ngoài chuỗi bí mật cụ thể của kịch bản. */
const MAU_RO_BI_MAT = /bearer\s+\S+|authorization|password\s*[:=]|mat[_ ]?khau\s*[:=]/i;

function docChuoi(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

export function chayBoTestHopDong(
  tenAdapter: string,
  taoAdapter: (kichBan: KichBan) => AdapterThu,
  kyVong: KyVongHopDong,
): void {
  describe(`[HDNCC-HD] hợp đồng nhà cung cấp — ${tenAdapter}`, () => {
    it("[HDNCC-HD-01] khai báo năng lực KHỚP kỳ vọng: đúng tập adapterImplements, providerSupports hợp lệ, implements ⇒ providerSupports=CO", () => {
      const { adapter } = taoAdapter("THANH_CONG");
      expect(adapter.nhaCungCap).toBe(kyVong.nhaCungCap);
      const dangNoi = NANG_LUC.filter((nl) => adapter.nangLuc[nl].adapterImplements);
      expect([...dangNoi].sort()).toEqual([...kyVong.adapterImplements].sort());
      for (const nl of NANG_LUC) {
        const muc = adapter.nangLuc[nl];
        expect(["CO", "KHONG", "CHUA_XAC_MINH"], nl).toContain(muc.providerSupports);
        expect(muc.ghiChu.trim().length, `${nl} thiếu ghiChu`).toBeGreaterThan(0);
        if (muc.adapterImplements) expect(muc.providerSupports, nl).toBe("CO");
      }
    });

    it("[HDNCC-HD-02] phương thức có thật KHỚP cờ: có phương thức ⟺ ít nhất một năng lực của nó adapterImplements", () => {
      const { adapter } = taoAdapter("THANH_CONG");
      const theoPhuongThuc = new Map<PhuongThucNhaCungCap, boolean>();
      for (const nl of NANG_LUC) {
        const pt = PHUONG_THUC_CUA_NANG_LUC[nl];
        theoPhuongThuc.set(pt, (theoPhuongThuc.get(pt) ?? false) || adapter.nangLuc[nl].adapterImplements);
      }
      for (const [pt, duocNoi] of theoPhuongThuc) {
        expect(typeof adapter[pt] === "function", `phương thức ${pt}`).toBe(duocNoi);
      }
    });

    it("[HDNCC-HD-03] năng lực không nối ⇒ duocPhep chặn và hàm KHÔNG được gọi; năng lực đã nối ⇒ gọi đúng một lần", () => {
      const { adapter } = taoAdapter("THANH_CONG");
      let soBiChan = 0;
      let soChoQua = 0;
      for (const nl of NANG_LUC) {
        const spy = vi.fn(() => "x");
        const kq = chayNeuDuocPhep(adapter.nangLuc, nl, spy);
        if (kyVong.adapterImplements.includes(nl)) {
          soChoQua++;
          expect(kq.chay, nl).toBe(true);
          expect(spy, nl).toHaveBeenCalledTimes(1);
          expect(duocPhep(adapter.nangLuc, nl), nl).toBe(true);
        } else {
          soBiChan++;
          expect(kq.chay, nl).toBe(false);
          expect(spy, nl).not.toHaveBeenCalled();
          expect(duocPhep(adapter.nangLuc, nl), nl).toBe(false);
        }
      }
      // chống bộ rỗng: cả hai nhánh đều đã chạy thật
      expect(soChoQua).toBeGreaterThan(0);
      expect(soBiChan + soChoQua).toBe(NANG_LUC.length);
    });

    it("[HDNCC-HD-04] IDEMPOTENCY: cùng khoá phát hành hai lần ⇒ CÙNG một hoá đơn; traCuu theo khoá trả đúng nó; khoá khác ⇒ hoá đơn khác", async () => {
      const { adapter } = taoAdapter("THANH_CONG");
      const a1 = await adapter.phatHanh(phieuMauHopDong("hdncc-hd-04-a"));
      const a2 = await adapter.phatHanh(phieuMauHopDong("hdncc-hd-04-a"));
      const b = await adapter.phatHanh(phieuMauHopDong("hdncc-hd-04-b"));
      expect(a1.loai).toBe("DA_PHAT_HANH");
      expect(a2).toEqual(a1);
      if (a1.loai !== "DA_PHAT_HANH" || b.loai !== "DA_PHAT_HANH") throw new Error("kịch bản THANH_CONG phải ra DA_PHAT_HANH");
      expect(b.soHoaDon).not.toBe(a1.soHoaDon);
      const tc = await adapter.traCuu("hdncc-hd-04-a", MST_NGUOI_BAN_MAU);
      expect(tc).toEqual(a1);
    });

    it("[HDNCC-HD-05] BA KẾT QUẢ — DA_PHAT_HANH mang đủ số/ký hiệu/mã tra cứu và đúng khoá; TU_CHOI ⇒ traCuu CHUA_CO", async () => {
      const { adapter } = taoAdapter("THANH_CONG");
      const ok = await adapter.phatHanh(phieuMauHopDong("hdncc-hd-05-ok"));
      expect(ok.loai).toBe("DA_PHAT_HANH");
      if (ok.loai === "DA_PHAT_HANH") {
        expect(ok.refId).toBe("hdncc-hd-05-ok");
        expect(ok.soHoaDon.length).toBeGreaterThan(0);
        expect(ok.kyHieu).toBe("1C26TSR");
        expect(ok.maTraCuu.length).toBeGreaterThan(0);
      }

      const tuChoi = await adapter.phatHanh(phieuSai("hdncc-hd-05-sai"));
      expect(tuChoi.loai).toBe("TU_CHOI");
      if (tuChoi.loai === "TU_CHOI") {
        expect(tuChoi.ma.length).toBeGreaterThan(0);
        expect(tuChoi.thongDiep.length).toBeGreaterThan(0);
      }
      // TU_CHOI nghĩa là CHẮC CHẮN chưa có hoá đơn ⇒ tra cứu đúng khoá đó phải ra CHUA_CO
      expect(await adapter.traCuu("hdncc-hd-05-sai", MST_NGUOI_BAN_MAU)).toEqual({ loai: "CHUA_CO" });
    });

    it("[HDNCC-HD-06] TIMEOUT (nhà cung cấp ĐÃ ghi) ⇒ KHONG_RO, KHÔNG sinh refId mới, phiếu không bị sửa; traCuu THEO KHOÁ CŨ ra hoá đơn đó", async () => {
      const { adapter } = taoAdapter("TIMEOUT_DA_GHI");
      const phieu = Object.freeze(phieuMauHopDong("hdncc-hd-06"));
      const kq = await adapter.phatHanh(phieu);
      expect(kq.loai).toBe("KHONG_RO");
      if (kq.loai === "KHONG_RO") expect(kq.thongDiep.length).toBeGreaterThan(0);
      // KHONG_RO không mang refId/số hoá đơn nào — nơi gọi chỉ có khoá cũ của chính mình
      expect(kq).not.toHaveProperty("refId");
      expect(kq).not.toHaveProperty("soHoaDon");
      expect(phieu.refId).toBe("hdncc-hd-06");

      const tc = await adapter.traCuu("hdncc-hd-06", MST_NGUOI_BAN_MAU);
      expect(tc.loai).toBe("DA_PHAT_HANH");
      if (tc.loai === "DA_PHAT_HANH") expect(tc.refId).toBe("hdncc-hd-06");
    });

    it("[HDNCC-HD-07] TIMEOUT (nhà cung cấp CHƯA nhận) ⇒ vẫn KHONG_RO (không được đọc thành TU_CHOI); traCuu theo khoá cũ ra CHUA_CO", async () => {
      const { adapter } = taoAdapter("TIMEOUT_CHUA_GHI");
      const kq = await adapter.phatHanh(phieuMauHopDong("hdncc-hd-07"));
      expect(kq.loai).toBe("KHONG_RO");
      expect(await adapter.traCuu("hdncc-hd-07", MST_NGUOI_BAN_MAU)).toEqual({ loai: "CHUA_CO" });
    });

    it("[HDNCC-HD-08] LỖI XÁC THỰC: phát hành ⇒ TU_CHOI, tra cứu ⇒ KHONG_RO, tải tệp ⇒ ném; KHÔNG thông điệp/nhật ký nào lộ bí mật", async () => {
      const { adapter, nhatKy } = taoAdapter("LOI_XAC_THUC");
      const thuThap: string[] = [];

      const ph = await adapter.phatHanh(phieuMauHopDong("hdncc-hd-08"));
      expect(ph.loai).toBe("TU_CHOI");
      if (ph.loai === "TU_CHOI") thuThap.push(ph.ma, ph.thongDiep);

      const tc = await adapter.traCuu("hdncc-hd-08", MST_NGUOI_BAN_MAU);
      expect(tc.loai).toBe("KHONG_RO");
      if (tc.loai === "KHONG_RO") thuThap.push(tc.thongDiep);

      // Tải tệp khi xác thực hỏng. Adapter đổi được kịch bản ⇒ cấp một hoá đơn THẬT trước, rồi mới hỏng xác thực,
      // và tải bằng mã tra cứu THẬT của nó: nếu lấy mã bất kỳ thì adapter ném ở nhánh "mã lạ" và nhánh "lỗi xác
      // thực" của taiTep không bao giờ chạy (cấy bỏ nhánh đó vẫn xanh).
      let loiTai: unknown = null;
      let nhatKyTai: (() => readonly string[]) | undefined;
      const thuTai = taoAdapter("THANH_CONG");
      let maThat: string | null = null;
      if (thuTai.datKichBan) {
        const daCap = await thuTai.adapter.phatHanh(phieuMauHopDong("hdncc-hd-08-tai"));
        if (daCap.loai !== "DA_PHAT_HANH") throw new Error("kịch bản THANH_CONG phải ra DA_PHAT_HANH");
        maThat = daCap.maTraCuu;
        // đối chứng DƯƠNG (NGOÀI try — lỗi khẳng định không được bị nuốt thành "lỗi tải"): mã thật tải được
        // trước khi hỏng xác thực ⇒ lỗi bên dưới đến từ xác thực, không phải từ mã lạ.
        expect(docChuoi(await thuTai.adapter.taiTep(maThat, "pdf", MST_NGUOI_BAN_MAU)).startsWith("%PDF")).toBe(true);
        thuTai.datKichBan("LOI_XAC_THUC");
        nhatKyTai = thuTai.nhatKy;
      }
      try {
        if (maThat !== null) await thuTai.adapter.taiTep(maThat, "pdf", MST_NGUOI_BAN_MAU);
        else await adapter.taiTep("MA-TRA-CUU-BAT-KY", "pdf", MST_NGUOI_BAN_MAU);
      } catch (e) {
        loiTai = e;
      }
      expect(loiTai).toBeInstanceOf(Error);
      if (loiTai instanceof Error) thuThap.push(loiTai.message);

      if (nhatKy) thuThap.push(...nhatKy());
      if (nhatKyTai) thuThap.push(...nhatKyTai());
      // chống quét rỗng: có ít nhất 3 thông điệp thật để soát
      expect(thuThap.filter((s) => s.trim().length > 0).length).toBeGreaterThanOrEqual(3);
      for (const dong of thuThap) {
        for (const biMat of kyVong.biMat) expect(dong).not.toContain(biMat);
        expect(dong).not.toMatch(MAU_RO_BI_MAT);
      }
    });

    it("[HDNCC-HD-09] tải tệp theo mã tra cứu của hoá đơn đã phát hành: PDF bắt đầu '%PDF', XML bắt đầu '<'", async () => {
      const { adapter } = taoAdapter("THANH_CONG");
      const kq = await adapter.phatHanh(phieuMauHopDong("hdncc-hd-09"));
      if (kq.loai !== "DA_PHAT_HANH") throw new Error("kịch bản THANH_CONG phải ra DA_PHAT_HANH");
      const pdf = await adapter.taiTep(kq.maTraCuu, "pdf", MST_NGUOI_BAN_MAU);
      const xml = await adapter.taiTep(kq.maTraCuu, "xml", MST_NGUOI_BAN_MAU);
      expect(docChuoi(pdf).startsWith("%PDF")).toBe(true);
      expect(docChuoi(xml).trimStart().startsWith("<")).toBe(true);
    });

    it("[HDNCC-HD-11] ký hiệu viết thường / thừa khoảng trắng vẫn hợp lệ và được CHUẨN HOÁ (hoa, bỏ khoảng trắng) trong hoá đơn trả về", async () => {
      // Fixture mặc định đã viết hoa sạch nên chuẩn hoá không bao giờ được thử — ca này cố ý đưa dạng bẩn vào.
      const { adapter } = taoAdapter("THANH_CONG");
      const phieu = { ...phieuMauHopDong("hdncc-hd-11"), kyHieu: "  1c26tsr " };
      const kq = await adapter.phatHanh(phieu);
      expect(kq.loai).toBe("DA_PHAT_HANH");
      if (kq.loai === "DA_PHAT_HANH") expect(kq.kyHieu).toBe("1C26TSR");
      expect(phieu.kyHieu).toBe("  1c26tsr "); // phiếu của nơi gọi không bị sửa
    });

    it.runIf(kyVong.adapterImplements.includes("KIEM_TRA_KET_NOI"))(
      "[HDNCC-HD-10] kiemTraKetNoi (đã nối): trả {ok, ghiChu} và ghiChu không chứa bí mật — cả khi lỗi xác thực",
      async () => {
        for (const kichBan of ["THANH_CONG", "LOI_XAC_THUC"] as const) {
          const { adapter } = taoAdapter(kichBan);
          if (!adapter.kiemTraKetNoi) throw new Error("adapter khai KIEM_TRA_KET_NOI nhưng không có phương thức");
          const kq = await adapter.kiemTraKetNoi();
          expect(typeof kq.ok).toBe("boolean");
          expect(kq.ghiChu.length).toBeGreaterThan(0);
          for (const biMat of kyVong.biMat) expect(kq.ghiChu).not.toContain(biMat);
          expect(kq.ghiChu).not.toMatch(MAU_RO_BI_MAT);
          expect(kq.ok).toBe(kichBan === "THANH_CONG");
        }
      },
    );
  });
}
