import { describe, it, expect } from "vitest";
import {
  extractVnPhone,
  extractVnPhoneCandidates,
  collectMatchKeyCandidates,
  decideByPhoneCandidates,
  type PhoneCandidate,
} from "./payos-ingest";
import { buildTransferContent, VIETQR_ADDINFO_MAX } from "./vietqr";

// =============================================================================
// 20/08 — nội dung CK đổi sang `HoTenCon_SdtPH_TenKhoa`, nên SĐT trở thành đường
// đối khớp (nhánh (d) của resolvePaymentTarget). `extractVnPhone` là THUẦN nên
// test được ở đây; phần tra DB của nhánh (d) nằm ở tests/e2e/r7/payos-webhook.spec.ts
// (cần Postgres thật).
//
// ⚠️ Sai sót ở hàm này đi theo 1 trong 2 hướng, cả hai đều tốn tiền:
//   - bỏ sót số  → tiền rơi vào UNMATCHED, kế toán gán tay;
//   - nhặt nhầm  → tra ra đơn của người khác. Nên hàm cố tình KHÔNG nhận dạng
//     9 số trần (mọi số tài khoản sẽ thành "SĐT").
// =============================================================================

describe("extractVnPhone — nội dung CK dạng mới", () => {
  it("bóc được SĐT khỏi đúng định dạng chốt", () => {
    expect(extractVnPhone("NguyenVanA_84987654321_Sata4")).toBe("84987654321");
  });

  it("nhận cả dạng 0… (10 số) và chuẩn hoá về 84…", () => {
    expect(extractVnPhone("NguyenVanA_0987654321_Sata4")).toBe("84987654321");
  });

  it("ngân hàng thay gạch dưới bằng khoảng trắng / chèn thêm chữ", () => {
    expect(extractVnPhone("CK NguyenVanA 0987654321 Sata4")).toBe("84987654321");
    expect(extractVnPhone("CHUYEN TIEN HOC PHI 84987654321 BE AN")).toBe("84987654321");
    expect(extractVnPhone("MBVCB.123.NguyenVanA-0987654321-Sata4.CT")).toBe("84987654321");
  });

  it("số tiền đứng trước SĐT không bị đọc nhầm thành SĐT", () => {
    expect(extractVnPhone("CK 10000000 NguyenVanA 0987654321 Sata4")).toBe("84987654321");
    // 8 chữ số — không phải độ dài SĐT nào cả.
    expect(extractVnPhone("CK 10000000 hoc phi")).toBeNull();
  });

  it("dò được cả khi ngân hàng dán các cụm số DÍNH LIỀN nhau", () => {
    // Vòng theo biên token trượt (một cụm 19 số) → vòng cửa sổ trượt phải cứu.
    expect(extractVnPhone("HD12345670987654321 hoc phi")).toBe("84987654321");
  });

  it("KHÔNG nhận 9 số trần — số tài khoản không được hoá thành SĐT", () => {
    expect(extractVnPhone("STK 987654321 NguyenVanA")).toBeNull();
  });

  it("số cố định / số rác → null (nhánh (d) im lặng nhường cho đối soát tay)", () => {
    expect(extractVnPhone("NguyenVanA_02363888999_Sata4")).toBeNull();
    expect(extractVnPhone("ORD260820000001D1")).toBeNull();
    expect(extractVnPhone("CHUYEN TIEN HOC PHI BE AN")).toBeNull();
    expect(extractVnPhone("")).toBeNull();
    expect(extractVnPhone(null)).toBeNull();
    expect(extractVnPhone(undefined)).toBeNull();
  });

  it("đầu số không hợp lệ (1,2,4,6) bị loại", () => {
    expect(extractVnPhone("NguyenVanA_0287654321_Sata4")).toBeNull();
    expect(extractVnPhone("NguyenVanA_84187654321_Sata4")).toBeNull();
  });

  it("ưu tiên cụm 84… trước khi thử cụm 0… (không đọc mảnh của số khác)", () => {
    expect(extractVnPhone("84987654321")).toBe("84987654321");
  });
});

describe("collectMatchKeyCandidates — hồi quy với định dạng CK mới", () => {
  it("nội dung dạng mới KHÔNG đẻ ra ứng viên trùng dạng matchKey ORD…", () => {
    const cands = collectMatchKeyCandidates({ description: "NguyenVanA_84987654321_Sata4" });
    expect(cands.every((c) => !/^ORD\d{12}D\d+$/i.test(c))).toBe(true);
  });

  it("nội dung dạng CŨ (ORD…D1) vẫn ra đúng ứng viên — QR phát trước 20/08 phải khớp", () => {
    const cands = collectMatchKeyCandidates({ description: "CK ORD260820000001D1" });
    expect(cands).toContain("ORD260820000001D1");
  });
});

// =============================================================================
// 20/08 (vòng 4) — hai vá đi kèm nhau, cùng nằm ở nhánh (d):
//   VIỆC 1: tie-break theo SỐ TIỀN đang so SAI ĐƠN VỊ (phần còn thiếu của cả ĐƠN
//           với số tiền của MỘT PHIẾU) ⇒ rót tiền vào SAI ĐƠN.
//   VIỆC 2: tên khoá rút về MÃ NGẮN ⇒ tên con quay lại chuỗi 25 ⇒ anh em ruột
//           không còn sinh chuỗi giống hệt ⇒ tầng 1 tự tách được, đỡ phải trông
//           vào tie-break tiền.
// Cả hai đều test được THUẦN qua `decideByPhoneCandidates` (không cần Postgres).
// =============================================================================

const KHOA = "Sata4 — Bứt Phá Giới Hạn";
const SDT = "0987654321";
const SDT_CANON = "84987654321";

type Req = { id: string; amountDue: number; sortOrder: number; allocated?: number };

/** Dựng một đơn ứng viên tối thiểu — chỉ những field nhánh (d) thực sự đọc. */
function donHang(
  id: string,
  code: string,
  studentName: string,
  reqs: Req[],
  courseName: string = KHOA,
): PhoneCandidate {
  return {
    id,
    code,
    customerName: "Nguyen Van Hung",
    customerPhone: SDT,
    student: { name: studentName },
    items: [{ itemName: courseName }],
    paymentRequests: reqs.map((r) => ({
      id: r.id,
      amountDue: r.amountDue,
      sortOrder: r.sortOrder,
      status: "PENDING",
      allocations: r.allocated ? [{ amount: r.allocated }] : [],
    })),
  };
}

describe("narrowByAmount — so số tiền ĐÚNG ĐƠN VỊ (phiếu thu, không phải đơn)", () => {
  // Ca hỏng gốc: cùng SĐT, cùng tên con, cùng khoá ⇒ chuỗi tái dựng TRÙNG NHAU ⇒
  // hoà ở tầng 1 ⇒ rơi xuống tie-break tiền.
  //   Đơn A trả góp 2 đợt: còn thiếu 10tr, đợt 1 = 5tr.
  //   Đơn B trọn gói:      còn thiếu 5tr.
  // Phụ huynh quét QR ĐỢT 1 CỦA A rồi chuyển 5tr — mọi QR đều phát theo PHIẾU.
  const A = donHang("A", "ORD-260820-000001", "Nguyễn Văn An", [
    { id: "A1", amountDue: 5_000_000, sortOrder: 1 },
    { id: "A2", amountDue: 5_000_000, sortOrder: 2 },
  ]);
  const B = donHang("B", "ORD-260820-000002", "Nguyễn Văn An", [
    { id: "B1", amountDue: 5_000_000, sortOrder: 1 },
  ]);
  const NOI_DUNG = buildTransferContent("Nguyễn Văn An", SDT, KHOA, VIETQR_ADDINFO_MAX);

  it("hai đơn cùng có phiếu 5tr ⇒ KHÔNG rót vào đơn nào, nhường cho gán tay", () => {
    const res = decideByPhoneCandidates(
      [{ phone: SDT_CANON, orders: [A, B] }],
      NOI_DUNG,
      5_000_000,
    );
    // ⚠️ HỒI QUY: bản cũ so 5tr với phần còn thiếu của CẢ ĐƠN (A = 10tr, B = 5tr)
    // nên thấy "đúng một đơn khớp" và rót HẾT vào B — B tự CONFIRMED + gửi biên
    // nhận + cấp tài khoản phụ huynh, còn A vẫn nợ.
    expect(res.target).toBeNull();
    expect(res.target?.orderId).not.toBe("B");
    expect(res.note).toContain("ORD-260820-000001");
    expect(res.note).toContain("ORD-260820-000002");
  });

  it("số tiền trùng phần còn thiếu của CẢ ĐƠN (10tr) cũng không rót — không phải đơn vị QR phát ra", () => {
    const res = decideByPhoneCandidates(
      [{ phone: SDT_CANON, orders: [A, B] }],
      NOI_DUNG,
      10_000_000,
    );
    expect(res.target).toBeNull();
  });

  it("vẫn tách được khi ĐÚNG MỘT đơn có phiếu đúng số tiền đó", () => {
    const C = donHang("C", "ORD-260820-000003", "Nguyễn Văn An", [
      { id: "C1", amountDue: 7_000_000, sortOrder: 1 },
    ]);
    const res = decideByPhoneCandidates(
      [{ phone: SDT_CANON, orders: [A, C] }],
      NOI_DUNG,
      7_000_000,
    );
    expect(res.target).toEqual({ paymentRequestId: "C1", orderId: "C", via: "phone" });
  });

  it("phiếu đã đóng một phần: so PHẦN CÒN THIẾU chứ không so amountDue", () => {
    const D = donHang("D", "ORD-260820-000004", "Nguyễn Văn An", [
      { id: "D1", amountDue: 8_000_000, sortOrder: 1, allocated: 5_000_000 }, // còn thiếu 3tr
    ]);
    const E = donHang("E", "ORD-260820-000005", "Nguyễn Văn An", [
      { id: "E1", amountDue: 3_000_000, sortOrder: 1, allocated: 3_000_000 }, // đã đủ
      { id: "E2", amountDue: 9_000_000, sortOrder: 2 },
    ]);
    const res = decideByPhoneCandidates(
      [{ phone: SDT_CANON, orders: [D, E] }],
      NOI_DUNG,
      3_000_000,
    );
    expect(res.target).toEqual({ paymentRequestId: "D1", orderId: "D", via: "phone" });
  });

  it("số tiền 0 / âm không bao giờ được dùng để tách", () => {
    const res = decideByPhoneCandidates([{ phone: SDT_CANON, orders: [A, B] }], NOI_DUNG, 0);
    expect(res.target).toBeNull();
  });
});

describe("anh em ruột — tầng 1 tự tách được, không cần tới số tiền", () => {
  it("chuỗi tái dựng khác nhau ⇒ rót đúng đơn của đứa được nhắc tên", () => {
    const anh = donHang("A", "ORD-260820-000001", "Nguyễn An", [
      { id: "A1", amountDue: 5_000_000, sortOrder: 1 },
    ]);
    const em = donHang("B", "ORD-260820-000002", "Nguyễn Bình", [
      { id: "B1", amountDue: 5_000_000, sortOrder: 1 },
    ]);
    // Hai đơn CÙNG số tiền còn thiếu ⇒ tie-break tiền chắc chắn KHÔNG cứu được;
    // tách được là nhờ tên con đã quay lại chuỗi 25 ký tự.
    const noiDung = buildTransferContent("Nguyễn Bình", SDT, KHOA, VIETQR_ADDINFO_MAX);
    const res = decideByPhoneCandidates(
      [{ phone: SDT_CANON, orders: [anh, em] }],
      noiDung,
      5_000_000,
    );
    expect(res.target).toEqual({ paymentRequestId: "B1", orderId: "B", via: "phone" });
  });

  it("phụ huynh gõ tay theo bản 80 ký tự (sale đọc) vẫn khớp ở tầng 1", () => {
    const don = donHang("A", "ORD-260820-000001", "Nguyễn Thị Hồng Nhung", [
      { id: "A1", amountDue: 5_000_000, sortOrder: 1 },
    ]);
    // Bản 80 KHÔNG chứa bản 25 (tên con bị cắt giữa chừng) — nhánh (d) phải tái
    // dựng cả hai trần thì mới nhận, xem `expectedContentsFor`.
    const banDai = buildTransferContent("Nguyễn Thị Hồng Nhung", SDT, KHOA);
    const res = decideByPhoneCandidates([{ phone: SDT_CANON, orders: [don] }], banDai, 5_000_000);
    expect(res.target).toEqual({ paymentRequestId: "A1", orderId: "A", via: "phone" });
  });
});

describe("extractVnPhoneCandidates — bóc SĐT khỏi chuỗi 25 ký tự thật", () => {
  const KHOA_THAT = [
    "Sata1 — Robosim Master",
    "Sata2 — Đấu trường Robot",
    "Sata3 — Ươm Mầm Tài Năng",
    "Sata4 — Bứt Phá Giới Hạn",
    "Sata5 — Khơi Nguồn Sáng Tạo",
    "Sata6 — Chinh Phục Đấu Trường",
    "Sata7 — Kiến Tạo Tương Lai",
    "Sata8 — Vé Vàng Chung Kết",
    "Combo — Full Lộ Trình Luyện Thi",
    "Lập trình Robot",
    "Luyện thi Robosim",
  ];

  it("11/11 khoá: chuỗi nhúng vào QR luôn bóc ra ĐÚNG MỘT SĐT", () => {
    for (const khoa of KHOA_THAT) {
      const s = buildTransferContent("Nguyễn Minh Khôi", SDT, khoa, VIETQR_ADDINFO_MAX);
      // Đúng một ứng viên: nhiều ứng viên = nhập nhằng = tự tay đẩy vào gán tay.
      expect(extractVnPhoneCandidates(s), s).toEqual([SDT_CANON]);
    }
  });
});
