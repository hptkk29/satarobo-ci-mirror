// Ca [LHC-*] — bộ lọc CƠ SỞ + THÁNG của màn Hoá đơn điện tử (docs/ke-toan-hoa-don/PLAN.md §10 —
// "[CS1 ▾] [Tháng 9 ▾]"; mục "Điều chỉnh khi thi công GĐ 4" số 7).
//
// Luật cần khoá:
//   · Ngăn "Đã xuất" / "Không xuất" (sổ đã xong) giới hạn theo THÁNG; ngăn việc tồn (chờ · lệch ·
//     nháp · cần điều chỉnh · đơn huỷ) KHÔNG giới hạn — việc tồn phải thấy hết.
//   · Lọc ở CÂU TRA (không nạp hết rồi lọc), và câu tra với phép lọc dòng nói CÙNG một luật tháng —
//     lệch nhau là dòng hiện ở ngăn này mà đếm ở ngăn kia, hoặc biến mất không lời.
//   · Tháng tính theo giờ VIỆT NAM (+07) TƯỜNG MINH — không dựa vào múi giờ của máy chủ.
//   · Cơ sở chỉ nhận cơ sở trong phạm vi KẾ TOÁN của người xem; ngoài phạm vi ⇒ bỏ (fail-closed:
//     bộ lọc chỉ THU HẸP, không bao giờ mở rộng tầm nhìn).
import { describe, expect, it } from "vitest";
import { LY_DO_DA_XUAT_NGOAI, LY_DO_KHACH_KHONG_LAY } from "./ly-do-khong-xuat";
import {
  cacThangChon,
  dieuKienCoSoChon,
  dieuKienDonHangCho,
  dieuKienHoaDonTrongThang,
  docBoLoc,
  giuDongTheoThang,
  khoangThang,
  locUrlTu,
  nhanThang,
  queryHoaDon,
  thangCuaHoaDon,
  thangVN,
} from "./loc-hang-cho";

const NOW = new Date("2026-09-28T03:00:00Z");

describe("[LHC-01] tháng theo giờ Việt Nam — tường minh +07, không đọc múi giờ máy", () => {
  it("biên nửa đêm VN: 16:59:59Z ngày 31/8 còn tháng 8; 17:00Z (00:00 VN 1/9) sang tháng 9", () => {
    expect(thangVN(new Date("2026-08-31T16:59:59Z"))).toBe("2026-08");
    expect(thangVN(new Date("2026-08-31T17:00:00Z"))).toBe("2026-09");
    expect(thangVN(new Date("2026-12-31T17:00:00Z"))).toBe("2027-01");
  });

  it("khoảng tháng: ngày lịch (cột @db.Date) mở đầu tháng UTC; mốc giờ (timestamptz) lùi 7 giờ", () => {
    expect(khoangThang("2026-09")).toEqual({
      ngayTu: new Date("2026-09-01T00:00:00Z"),
      ngayDen: new Date("2026-10-01T00:00:00Z"),
      lucTu: new Date("2026-08-31T17:00:00Z"),
      lucDen: new Date("2026-09-30T17:00:00Z"),
    });
    expect(khoangThang("2026-12").ngayDen).toEqual(new Date("2027-01-01T00:00:00Z"));
  });
});

describe("[LHC-02] đọc bộ lọc từ URL — sai dạng ⇒ mặc định; ngoài phạm vi kế toán ⇒ bỏ", () => {
  it("tháng sai dạng hoặc thiếu ⇒ tháng hiện tại (giờ VN)", () => {
    for (const thang of [undefined, null, "", "2026-13", "2026-9", "2026-00", "abc", "2026-09-01"]) {
      expect(docBoLoc({ thang }, { phamViKeToan: "ALL", now: NOW }).thang, String(thang)).toBe("2026-09");
    }
    expect(docBoLoc({ thang: "2026-07" }, { phamViKeToan: "ALL", now: NOW }).thang).toBe("2026-07");
  });

  it("cơ sở trong phạm vi ⇒ giữ; ngoài phạm vi / rỗng ⇒ null (không lọc — tầm nhìn vẫn là scopedDb)", () => {
    const ctx = { phamViKeToan: ["cs1"] as const, now: NOW };
    expect(docBoLoc({ coSo: "cs1" }, ctx).coSo).toBe("cs1");
    expect(docBoLoc({ coSo: "cs2" }, ctx).coSo).toBeNull();
    expect(docBoLoc({ coSo: "  " }, ctx).coSo).toBeNull();
    expect(docBoLoc({ coSo: "cs2" }, { phamViKeToan: "ALL", now: NOW }).coSo).toBe("cs2");
  });

  it("fail-closed: không là kế toán ở đâu ⇒ KHÔNG nhận cơ sở nào", () => {
    expect(docBoLoc({ coSo: "cs1" }, { phamViKeToan: [], now: NOW }).coSo).toBeNull();
  });
});

describe("[LHC-03] tháng của MỘT hoá đơn (phép lọc dòng)", () => {
  const hd = (o: Partial<Parameters<typeof thangCuaHoaDon>[0]>) =>
    thangCuaHoaDon({
      trangThai: "DA_XAC_NHAN",
      ngayPhatHanh: null,
      xacNhanLuc: null,
      createdAt: new Date("2026-09-10T03:00:00Z"),
      ...o,
    });

  it("ĐÃ XÁC NHẬN theo NGÀY TRÊN TỜ (ngày phát hành), không theo lúc bấm xác nhận", () => {
    expect(hd({ ngayPhatHanh: new Date("2026-08-31T00:00:00Z"), xacNhanLuc: new Date("2026-09-02T02:00:00Z") })).toBe("2026-08");
  });

  it("ĐÃ XÁC NHẬN thiếu ngày phát hành (dữ liệu lạ) ⇒ theo lúc xác nhận, giờ VN", () => {
    expect(hd({ xacNhanLuc: new Date("2026-08-31T17:30:00Z") })).toBe("2026-09");
    expect(hd({})).toBeNull();
  });

  it("KHÔNG XUẤT theo lúc đánh dấu (giờ VN); nháp ⇒ null (không thuộc sổ tháng nào)", () => {
    expect(hd({ trangThai: "KHONG_XUAT", createdAt: new Date("2026-09-30T17:00:00Z") })).toBe("2026-10");
    expect(hd({ trangThai: "NHAP", ngayPhatHanh: new Date("2026-09-12T00:00:00Z") })).toBeNull();
  });
});

/**
 * Bộ chấm TỐI THIỂU cho `HoaDonDienTuWhereInput` mà `dieuKienHoaDonTrongThang` sinh ra. Khoá LẠ ⇒ NÉM:
 * bộ chấm không được lặng lẽ cho qua một điều kiện nó không hiểu (lưới xanh vì không chạm tới luật).
 */
type HdMau = { trangThai: string; ngayPhatHanh: Date | null; xacNhanLuc: Date | null; createdAt: Date };
function khop(w: Record<string, unknown>, hd: HdMau): boolean {
  return Object.entries(w).every(([k, v]) => {
    if (k === "OR") return (v as Record<string, unknown>[]).some((x) => khop(x, hd));
    if (k === "trangThai") return hd.trangThai === v;
    if (k === "ngayPhatHanh" || k === "xacNhanLuc" || k === "createdAt") {
      const gt = hd[k];
      if (v === null) return gt === null;
      const r = v as { gte: Date; lt: Date };
      return gt !== null && gt >= r.gte && gt < r.lt;
    }
    throw new Error(`bộ chấm không hiểu khoá "${k}"`);
  });
}

describe("[LHC-04] câu tra và phép lọc dòng nói CÙNG một luật tháng", () => {
  const MAU: HdMau[] = [];
  for (const trangThai of ["DA_XAC_NHAN", "KHONG_XUAT", "NHAP"]) {
    for (const ngay of [null, "2026-08-31", "2026-09-01", "2026-09-30", "2026-10-01"]) {
      for (const luc of ["2026-08-31T16:59:59Z", "2026-08-31T17:00:00Z", "2026-09-30T16:59:59Z", "2026-09-30T17:00:00Z"]) {
        MAU.push({
          trangThai,
          ngayPhatHanh: ngay ? new Date(`${ngay}T00:00:00Z`) : null,
          xacNhanLuc: trangThai === "DA_XAC_NHAN" ? new Date(luc) : null,
          createdAt: new Date(luc),
        });
      }
    }
  }

  it("mọi mẫu quanh hai biên tháng: khớp câu tra ⇔ thangCuaHoaDon === tháng lọc", () => {
    const nhanh = dieuKienHoaDonTrongThang("2026-09") as Record<string, unknown>[];
    let dung = 0;
    for (const hd of MAU) {
      const theoCau = nhanh.some((w) => khop(w, hd));
      expect(theoCau, JSON.stringify(hd)).toBe(thangCuaHoaDon(hd) === "2026-09");
      if (theoCau) dung += 1;
    }
    // Đối chứng: bộ mẫu thật sự có ca khớp lẫn ca trượt — không phải tất cả cùng một phía.
    expect(dung).toBeGreaterThan(0);
    expect(dung).toBeLessThan(MAU.length);
  });
});

describe("[LHC-05] điều kiện ĐƠN của câu tra — việc tồn KHÔNG giới hạn tháng", () => {
  const coMocNgay = (o: unknown) => /ngayPhatHanh|xacNhanLuc|createdAt/.test(JSON.stringify(o));

  it("không bộ lọc (đường thu hẹp theo đơn) ⇒ đúng hình dạng CŨ, không cơ sở, không tháng", () => {
    const w = dieuKienDonHangCho(null);
    expect(w).not.toHaveProperty("centerId");
    expect(coMocNgay(w)).toBe(false);
    expect(w.OR).toHaveLength(2);
  });

  it("có cơ sở ⇒ `centerId`; không cơ sở ⇒ KHÔNG có khoá `centerId`", () => {
    expect(dieuKienDonHangCho({ coSo: "cs1", thang: "2026-09" })).toMatchObject({ centerId: "cs1" });
    expect(dieuKienDonHangCho({ coSo: null, thang: "2026-09" })).not.toHaveProperty("centerId");
  });

  it("CHỈ hai nhánh mang mốc ngày (sổ đã xuất / không xuất); khoản chờ, nháp, cần điều chỉnh thì không", () => {
    const w = dieuKienDonHangCho({ coSo: null, thang: "2026-09" });
    const nhanh = w.OR as Record<string, unknown>[];
    expect(nhanh.filter(coMocNgay)).toHaveLength(2);
    // Khoản chờ (hàng chờ + đơn huỷ): không mốc ngày.
    expect(nhanh.some((n) => "payments" in n && !coMocNgay(n))).toBe(true);
    // Nháp + (bước 1 MISA) đang / lỗi phát hành: việc TỒN, không mốc ngày.
    expect(
      nhanh.some(
        (n) =>
          JSON.stringify(n) ===
          JSON.stringify({ hoaDonDienTu: { some: { trangThai: { in: ["NHAP", "DANG_PHAT_HANH", "LOI_PHAT_HANH"] } } } }),
      ),
    ).toBe(true);
    // Cần điều chỉnh: đơn huỷ/hoàn sau khi xuất + khoản có bút toán trỏ vào — không mốc ngày.
    const canDieuChinh = nhanh.filter((n) => /CANCELLED|adjustments/.test(JSON.stringify(n)));
    expect(canDieuChinh).toHaveLength(2);
    expect(canDieuChinh.some(coMocNgay)).toBe(false);
  });
});

describe("[LHC-09] 29/09 — 'Cần điều chỉnh' mới cũng KHÔNG giới hạn tháng", () => {
  const nhanh = () => dieuKienDonHangCho({ coSo: null, thang: "2026-09" }).OR as Record<string, unknown>[];
  const coMocNgay = (o: unknown) => /ngayPhatHanh|xacNhanLuc|createdAt/.test(JSON.stringify(o));

  it("(Q1) có nhánh 'đơn có yêu cầu hoàn ĐÃ DUYỆT + còn bản đã xuất', không mốc ngày, không nhận CHỜ", () => {
    const hoan = nhanh().filter((n) => JSON.stringify(n).includes("refundRequests"));
    expect(hoan).toHaveLength(1);
    expect(coMocNgay(hoan[0])).toBe(false);
    const s = JSON.stringify(hoan[0]);
    expect(s).toContain('"APPROVED"');
    expect(s).toContain('"PAID"');
    expect(s).not.toContain('"PENDING"');
    expect(s).toContain(LY_DO_DA_XUAT_NGOAI); // bản "đã xuất ngoài hệ thống" cũng được tính là đã xuất
  });

  it("(Q3) nhánh 'khoản bị đảo / xoá' nhận cả bản KHONG_XUAT 'Đã xuất ngoài hệ thống' — và CHỈ lý do đó", () => {
    const dao = nhanh().filter((n) => JSON.stringify(n).includes("adjustments"));
    expect(dao).toHaveLength(1);
    const s = JSON.stringify(dao[0]);
    expect(s).toContain(`{"trangThai":"KHONG_XUAT","lyDo":"${LY_DO_DA_XUAT_NGOAI}"}`);
    expect(s).not.toContain(LY_DO_KHACH_KHONG_LAY);
  });
});

describe("[LHC-06] phép lọc DÒNG — chỉ hai ngăn sổ đã xong bị cắt theo tháng", () => {
  const d = (ngan: string, hoaDonId: string | null) => ({ ngan, hoaDon: hoaDonId ? { id: hoaDonId } : null, key: `${ngan}:${hoaDonId}` });
  const THANG = new Map<string, string | null>([
    ["hd9", "2026-09"],
    ["hd8", "2026-08"],
    ["hdNhap", null],
  ]);

  it("đã xuất / không xuất: giữ đúng tháng; tháng khác hoặc không rõ tháng ⇒ bỏ", () => {
    const vao = [d("da-xuat", "hd9"), d("da-xuat", "hd8"), d("khong-xuat", "hd8"), d("khong-xuat", "hd9"), d("da-xuat", "hdLa")];
    expect(giuDongTheoThang(vao, THANG, "2026-09").map((x) => x.key)).toEqual(["da-xuat:hd9", "khong-xuat:hd9"]);
  });

  it("đối chứng: ngăn việc tồn giữ NGUYÊN mọi dòng, kể cả hoá đơn tháng khác (cần điều chỉnh)", () => {
    const vao = [d("cho", null), d("lech", null), d("nhap", "hdNhap"), d("can-dieu-chinh", "hd8"), d("don-huy", null)];
    expect(giuDongTheoThang(vao, THANG, "2026-09")).toEqual(vao);
  });
});

describe("[LHC-08] ô chọn cơ sở chỉ bày cơ sở trong phạm vi KẾ TOÁN", () => {
  it("kế toán cơ sở ⇒ đúng tập id của mình; không là kế toán ở đâu ⇒ tập RỖNG (không rơi về mọi cơ sở)", () => {
    expect(dieuKienCoSoChon(["cs1"])).toEqual({ id: { in: ["cs1"] }, code: { not: null } });
    expect(dieuKienCoSoChon([])).toEqual({ id: { in: [] }, code: { not: null } });
  });

  it("đối chứng: phạm vi toàn hệ thống ⇒ mọi cơ sở có mã", () => {
    expect(dieuKienCoSoChon("ALL")).toEqual({ code: { not: null } });
  });
});

describe("[LHC-07] ô chọn tháng + URL giữ bộ lọc", () => {
  it("12 tháng gần nhất, mới nhất trước; tháng đang chọn cũ hơn vẫn có mặt", () => {
    const ds = cacThangChon("2026-09", "2026-09");
    expect(ds).toHaveLength(12);
    expect(ds[0]).toEqual({ gia: "2026-09", nhan: "Tháng 9/2026" });
    expect(ds[11]!.gia).toBe("2025-10");
    const cu = cacThangChon("2026-09", "2024-03");
    expect(cu.map((x) => x.gia)).toContain("2024-03");
    expect(cu.at(-1)!.gia).toBe("2024-03");
    expect(nhanThang("2027-01")).toBe("Tháng 1/2027");
  });

  it("tháng MẶC ĐỊNH không ghi lên URL; cơ sở + tháng khác thì ghi, SAU ngăn + dòng chọn", () => {
    expect(locUrlTu({ coSo: null, thang: "2026-09" }, "2026-09")).toEqual({ coSo: null, thang: null });
    expect(locUrlTu({ coSo: "cs1", thang: "2026-08" }, "2026-09")).toEqual({ coSo: "cs1", thang: "2026-08" });
    expect(queryHoaDon({ coSo: null, thang: null }, { ngan: "cho", chon: "dot:b" })).toBe("ngan=cho&chon=dot%3Ab");
    expect(queryHoaDon({ coSo: "cs1", thang: "2026-08" }, { ngan: "da-xuat" })).toBe("ngan=da-xuat&coSo=cs1&thang=2026-08");
    // Q2 — gộp lần thu: ngăn của dòng đích chưa biết ⇒ không ghi ngăn, trang chọn theo dòng.
    expect(queryHoaDon({ coSo: "cs1", thang: null }, { chon: "gop:dot:a+k:b" })).toBe("chon=gop%3Adot%3Aa%2Bk%3Ab&coSo=cs1");
    expect(queryHoaDon({ coSo: "cs1", thang: null }, { ngan: "nhap", chon: null })).toBe("ngan=nhap&coSo=cs1");
  });
});
