// @vitest-environment node
/**
 * EL-16 — chứng nhận: mã, hạn hiệu lực, trạng thái hiển thị.
 *
 * Bộ này canh ba thứ mà sai thì không ai thấy cho tới khi đã muộn:
 *  · hạn hiệu lực suy sai ⇒ lộ ra sau CHU KỲ ĐẦU TIÊN, tức hàng loạt chứng nhận đã
 *    phát ra tay người ta;
 *  · trạng thái đọc từ cột đệm ⇒ trang xác minh công khai nói dối người đi kiểm;
 *  · `verifyToken` đoán được ⇒ IDOR trên đúng trang được thiết kế để ai cũng mở.
 */
import { describe, it, expect } from "vitest";
import {
  cauTrangThai,
  congThang,
  duDieuKienCap,
  maChungNhan,
  suyHanHieuLuc,
  taoVerifyToken,
  tinhHanChoLuot,
  trangThaiHienThi,
} from "@/lib/elearning/certificate";

const D = (s: string) => new Date(s);

describe("mã chứng nhận", () => {
  it("đúng khuôn SR.CN.YYYY.NNNNN", () => {
    expect(maChungNhan(2026, 1)).toBe("SR.CN.2026.00001");
    expect(maChungNhan(2026, 12345)).toBe("SR.CN.2026.12345");
  });

  it("số vượt 5 chữ số thì KHÔNG cắt cụt", () => {
    // Cắt cụt là sinh mã TRÙNG một cách im lặng. Thà mã dài hơn khuôn còn hơn hai
    // tấm chứng nhận khác nhau mang cùng một số hiệu.
    expect(maChungNhan(2026, 123456)).toBe("SR.CN.2026.123456");
  });
});

describe("verifyToken", () => {
  it("dài 32 ký tự và không lặp lại", () => {
    const a = taoVerifyToken();
    expect(a).toHaveLength(32);
    const bo = new Set(Array.from({ length: 500 }, () => taoVerifyToken()));
    expect(bo.size).toBe(500);
  });

  it("chỉ ký tự an toàn cho URL", () => {
    // Trang xác minh nhận token thẳng từ đường dẫn. Ký tự phải escape sẽ vỡ QR ở
    // một tỉ lệ nhỏ các lần cấp — loại lỗi không tái hiện được khi có người báo.
    for (let i = 0; i < 200; i++) {
      expect(taoVerifyToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
    }
  });
});

describe("cộng tháng theo LỊCH", () => {
  it("12 tháng = cùng ngày sang năm", () => {
    expect(congThang(D("2026-03-15T00:00:00Z"), 12).toISOString()).toBe(
      "2027-03-15T00:00:00.000Z",
    );
  });

  it("31/01 + 1 tháng = 28/02, KHÔNG nhảy sang 03/03", () => {
    // Đây là hành vi mặc định của `Date.setMonth` và nó âm thầm đẩy hạn sang tháng
    // sau. Trên một khoá tuân thủ thì đó là ba ngày không có hiệu lực mà báo cáo
    // vẫn tính là còn.
    expect(congThang(D("2026-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("29/02 năm nhuận + 12 tháng = 28/02 năm thường", () => {
    expect(congThang(D("2028-02-29T00:00:00Z"), 12).toISOString()).toBe(
      "2029-02-28T00:00:00.000Z",
    );
  });

  it("KHÔNG phải cộng 30 ngày", () => {
    // Cộng ngày làm hạn trôi dần qua mỗi vòng tái chứng nhận.
    const a = congThang(D("2026-01-01T00:00:00Z"), 1);
    expect(a.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(a.getTime() - D("2026-01-01T00:00:00Z").getTime()).toBe(31 * 86_400_000);
  });
});

describe("suy hạn hiệu lực — cả BA nhánh (case T3 bắt buộc)", () => {
  const issuedAt = D("2026-05-10T00:00:00Z");

  it("(1) có yêu cầu có chu kỳ ⇒ lấy chu kỳ của YÊU CẦU", () => {
    const r = suyHanHieuLuc({
      issuedAt,
      chuKyTuYeuCau: 12,
      // Chương trình khai 24 tháng, nhưng yêu cầu THẮNG — nó là nguồn sự thật.
      chuKyTuChuongTrinh: 24,
    });
    expect(r.nguon).toBe("YEU_CAU");
    expect(r.validUntil?.toISOString()).toBe("2027-05-10T00:00:00.000Z");
  });

  it("(2) không có yêu cầu ⇒ rơi về chu kỳ CHƯƠNG TRÌNH", () => {
    const r = suyHanHieuLuc({
      issuedAt,
      chuKyTuYeuCau: null,
      chuKyTuChuongTrinh: 24,
    });
    expect(r.nguon).toBe("CHUONG_TRINH");
    expect(r.validUntil?.toISOString()).toBe("2028-05-10T00:00:00.000Z");
  });

  it("(3) cả hai NULL ⇒ VÔ THỜI HẠN, và nói rõ là vô thời hạn", () => {
    const r = suyHanHieuLuc({
      issuedAt,
      chuKyTuYeuCau: null,
      chuKyTuChuongTrinh: null,
    });
    expect(r.validUntil).toBeNull();
    // ⚠️ Phần quan trọng: `null` phải kèm NGUỒN. Một ô trống trong DB không phân
    // biệt được "vô thời hạn" với "chưa tính được", mà hai thứ đó khác hẳn nhau với
    // người cầm tấm chứng nhận.
    expect(r.nguon).toBe("VO_THOI_HAN");
  });

  it("chu kỳ 0 hoặc âm KHÔNG được coi là có chu kỳ", () => {
    // `0` lọt qua một phép kiểm `!= null` sẽ cho ra hạn = ngay ngày cấp: chứng nhận
    // hết hiệu lực đúng lúc vừa cấp.
    expect(suyHanHieuLuc({ issuedAt, chuKyTuYeuCau: 0, chuKyTuChuongTrinh: null }).nguon).toBe(
      "VO_THOI_HAN",
    );
    expect(suyHanHieuLuc({ issuedAt, chuKyTuYeuCau: -3, chuKyTuChuongTrinh: 6 }).nguon).toBe(
      "CHUONG_TRINH",
    );
  });

  it("công nhận tương đương: hạn tính từ MỐC GỐC, không từ ngày cấp", () => {
    // Lấy ngày bấm nút công nhận làm mốc là gia hạn thêm trọn một chu kỳ cho một
    // chứng chỉ cũ — hệ thống tự cấp cho mình quyền nó chỉ đang ghi nhận.
    const r = suyHanHieuLuc({
      issuedAt,
      chuKyTuYeuCau: 12,
      chuKyTuChuongTrinh: null,
      mocGoc: D("2025-01-20T00:00:00Z"),
    });
    expect(r.mocTinh.toISOString()).toBe("2025-01-20T00:00:00.000Z");
    expect(r.validUntil?.toISOString()).toBe("2026-01-20T00:00:00.000Z");
    // Và mốc gốc đủ cũ thì tấm chứng nhận sinh ra ĐÃ hết hạn — đúng, không phải lỗi.
    expect(
      trangThaiHienThi({ status: "VALID", validUntil: r.validUntil }, issuedAt),
    ).toBe("EXPIRED");
  });
});

describe("gộp khớp yêu cầu + suy hạn", () => {
  const chung = {
    issuedAt: D("2026-05-10T00:00:00Z"),
    nguoi: {
      userId: "u1",
      departmentId: "dep-daotao",
      orgUnitPath: "/ho/danang/cs1/",
      positionId: null,
    },
  };

  it("lấy chu kỳ NGẮN NHẤT khi dính nhiều yêu cầu", () => {
    // Thứ tự DB trả về thì không ai bảo đảm. Lấy cái dài hơn là để người ta quá hạn
    // theo yêu cầu chặt hơn trong khi hệ thống vẫn báo còn hiệu lực.
    const r = tinhHanChoLuot({
      ...chung,
      chuKyTuChuongTrinh: null,
      dsYeuCau: [
        {
          id: "y1",
          scopeKind: "ALL_STAFF",
          positionId: null,
          departmentId: null,
          levelTag: null,
          orgUnitPath: null,
          validityMonths: 24,
        },
        {
          id: "y2",
          scopeKind: "DEPARTMENT",
          positionId: null,
          departmentId: "dep-daotao",
          levelTag: null,
          orgUnitPath: null,
          validityMonths: 6,
        },
      ],
    });
    expect(r.soThang).toBe(6);
  });

  it("yêu cầu KHÔNG đối chiếu được thì báo ra, không im lặng bỏ qua", () => {
    // Đây là ca đắt nhất của tệp. Một khoá tuân thủ chu kỳ 12 tháng khai phạm vi
    // `POSITION` (bảng `Position` rỗng trên prod) sẽ rơi xuống nhánh 3 và tấm chứng
    // nhận thành VÔ THỜI HẠN — không lỗi, không cảnh báo, chỉ là hai năm sau không
    // ai phải học lại.
    const r = tinhHanChoLuot({
      ...chung,
      chuKyTuChuongTrinh: null,
      dsYeuCau: [
        {
          id: "y1",
          scopeKind: "POSITION",
          positionId: "p1",
          departmentId: null,
          levelTag: null,
          orgUnitPath: null,
          validityMonths: 12,
        },
      ],
    });
    expect(r.nguon).toBe("VO_THOI_HAN");
    expect(r.khongDoiChieuDuoc).toHaveLength(1);
    expect(r.khongDoiChieuDuoc[0]!.lyDo).toContain("Position");
  });
});

describe("trạng thái hiển thị — SUY, không đọc cột đệm", () => {
  const now = D("2026-06-01T00:00:00Z");

  it("cột nói VALID nhưng đã quá hạn ⇒ hiển thị EXPIRED", () => {
    // Cột `status` do cron cập nhật mỗi ngày; hạn thì trôi qua vào một khoảnh khắc.
    // Tin cột ấy là để hệ thống nói dối người đi kiểm, ở đúng trang được dựng để
    // không nói dối.
    expect(
      trangThaiHienThi({ status: "VALID", validUntil: D("2026-05-31T00:00:00Z") }, now),
    ).toBe("EXPIRED");
  });

  it("hết hạn ĐÚNG khoảnh khắc đó ⇒ đã hết, không còn", () => {
    expect(
      trangThaiHienThi({ status: "VALID", validUntil: now }, now),
    ).toBe("EXPIRED");
  });

  it("THU HỒI thì thắng tất cả — kể cả khi còn hạn", () => {
    // `REVOKED` là quyết định của con người, không suy được từ ngày tháng.
    expect(
      trangThaiHienThi({ status: "REVOKED", validUntil: D("2030-01-01T00:00:00Z") }, now),
    ).toBe("REVOKED");
  });

  it("cột nói EXPIRED nhưng hạn còn ⇒ vẫn VALID", () => {
    // Chiều ngược lại cũng phải đúng: cron chạy sớm hoặc dữ liệu được gia hạn thì
    // cột đệm cũ không được phép giữ người ta ở trạng thái hết hiệu lực.
    expect(
      trangThaiHienThi({ status: "EXPIRED", validUntil: D("2027-01-01T00:00:00Z") }, now),
    ).toBe("VALID");
  });

  it("vô thời hạn thì mãi VALID", () => {
    expect(trangThaiHienThi({ status: "VALID", validUntil: null }, now)).toBe("VALID");
  });
});

describe("câu chữ trên trang xác minh", () => {
  it("vô thời hạn nói rõ là KHÔNG THỜI HẠN, không để trống", () => {
    // Ô trống ở dòng hiệu lực đọc ra thành "hệ thống không biết", và người đi kiểm
    // sẽ gọi điện hỏi.
    expect(cauTrangThai("VALID", { validUntil: null, revokedAt: null })).toContain(
      "không thời hạn",
    );
  });

  it("thu hồi có ngày thì nói ngày", () => {
    expect(
      cauTrangThai("REVOKED", { validUntil: null, revokedAt: D("2026-04-02T00:00:00Z") }),
    ).toContain("2/4/2026");
  });
});

describe("đủ điều kiện cấp", () => {
  const base = { status: "COMPLETED", verifiedAt: D("2026-01-01"), revokedAt: null };

  it("hoàn thành + đã kiểm chứng ⇒ cấp", () => {
    expect(duDieuKienCap(base)).toBe(true);
  });

  it("hoàn thành TRỄ vẫn cấp", () => {
    // Trễ là một sự thật cần ghi lại, không phải lý do từ chối chứng từ; báo cáo
    // tuân thủ đọc `isLate` riêng.
    expect(duDieuKienCap({ ...base, status: "COMPLETED_LATE" })).toBe(true);
  });

  it("chưa kiểm chứng ⇒ KHÔNG cấp", () => {
    expect(duDieuKienCap({ ...base, verifiedAt: null })).toBe(false);
  });

  it("lượt đã THU HỒI ⇒ không cấp, dù status còn sót giá trị cũ", () => {
    expect(duDieuKienCap({ ...base, revokedAt: D("2026-02-01") })).toBe(false);
  });

  it("đang học ⇒ không cấp", () => {
    expect(duDieuKienCap({ ...base, status: "IN_PROGRESS" })).toBe(false);
  });
});
