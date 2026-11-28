import { describe, it, expect } from "vitest";
import {
  buildTransferContent,
  transferContentForOrder,
  transferContentParts,
  transferPhonePart,
  shortCourseToken,
  COURSE_TOKEN_MAX,
  MAX_TRANSFER_CONTENT,
  VIETQR_ADDINFO_MAX,
} from "./vietqr";

// =============================================================================
// 20/08 — NỘI DUNG CHUYỂN KHOẢN dạng người đọc `HoTenCon_SdtPH_TenKhoa`.
//
// Đây là chuỗi sale đọc cho phụ huynh qua điện thoại VÀ là chỗ duy nhất webhook
// còn bám được để tra ra đơn (nhánh SĐT). Sai định dạng ở đây = tiền rơi vào đối
// soát tay hàng loạt, nên mọi ca lệch chuẩn phải có test.
// =============================================================================

describe("buildTransferContent — định dạng chốt", () => {
  it("ra đúng mẫu chủ dự án yêu cầu: NguyenVanA_0987654321_Sata4 (SĐT nội địa, chốt 14/09)", () => {
    expect(buildTransferContent("Nguyễn Văn A", "0987654321", "Sata 4")).toBe(
      "NguyenVanA_0987654321_Sata4",
    );
  });

  it("bỏ dấu tiếng Việt + đ/Đ, bỏ khoảng trắng TRONG từng thành phần", () => {
    // Tên khoá rút về MÃ NGẮN 5 ký tự (`shortCourseToken`) nên "Combo 1 và 2" → "Combo".
    expect(buildTransferContent("Đặng Thị Hồng Nhung", "0912345678", "Combo 1 và 2")).toBe(
      "DangThiHongNhung_0912345678_Combo",
    );
  });

  it("KHÔNG còn mã đơn trong chuỗi (bỏ hẳn quy ước ORD… cũ)", () => {
    const out = buildTransferContent("Le Minh", "0905123456", "Sata 1");
    expect(out).not.toMatch(/ORD/i);
    expect(out).toBe("LeMinh_0905123456_Sata1");
  });

  it("thiếu SĐT → bỏ qua thành phần đó, KHÔNG để lại dấu gạch dưới đôi", () => {
    expect(buildTransferContent("Nguyễn Văn A", null, "Sata 4")).toBe("NguyenVanA_Sata4");
    expect(buildTransferContent("Nguyễn Văn A", "", "Sata 4")).toBe("NguyenVanA_Sata4");
  });

  it("thiếu tên khoá → chỉ còn tên + SĐT", () => {
    expect(buildTransferContent("Nguyễn Văn A", "0987654321", null)).toBe(
      "NguyenVanA_0987654321",
    );
    expect(buildTransferContent("Nguyễn Văn A", "0987654321", "")).toBe(
      "NguyenVanA_0987654321",
    );
  });

  it("thiếu cả hai → chỉ còn tên, không có dấu gạch dưới thừa", () => {
    expect(buildTransferContent("Nguyễn Văn A", null, null)).toBe("NguyenVanA");
    expect(buildTransferContent("Nguyễn Văn A", null, null)).not.toMatch(/_/);
  });

  it("tên chỉ toàn ký tự lạ → chuỗi vẫn hợp lệ, không mở đầu bằng gạch dưới", () => {
    const out = buildTransferContent("★ ★", "0987654321", "Sata 4");
    expect(out).toBe("0987654321_Sata4");
  });
});

describe("buildTransferContent — trần 80 ký tự", () => {
  const longName = "Nguyễn Thị Hoàng Yến Hoàng Yến Hoàng Yến Hoàng Yến Hoàng Yến Hoàng Yến Nhi";

  it("không bao giờ vượt trần", () => {
    const out = buildTransferContent(longName, "0987654321", "Combo Sata 1 và Sata 2");
    expect(out.length).toBeLessThanOrEqual(MAX_TRANSFER_CONTENT);
  });

  it("cắt TÊN CON chứ không cắt mất SĐT — đường đối khớp phải sống sót", () => {
    const out = buildTransferContent(longName, "0987654321", "Combo Sata 1 và Sata 2");
    expect(out).toContain("0987654321");
    expect(out).toContain("Combo");
    expect(out.startsWith("NguyenThiHoangYen")).toBe(true);
  });

  it("cắt xong không để lại dấu gạch dưới treo ở cuối", () => {
    // maxLength rơi đúng vào vị trí dấu phân cách.
    const out = buildTransferContent("Nguyen Van A", "0987654321", "Sata 4", 11);
    expect(out).not.toMatch(/_$/);
    expect(out.length).toBeLessThanOrEqual(11);
  });

  it("trần riêng cho payOS (25 ký tự) vẫn giữ trọn SĐT", () => {
    const out = buildTransferContent("Nguyễn Thị Minh Khai", "0987654321", "Sata 4", 25);
    expect(out.length).toBeLessThanOrEqual(25);
    expect(out).toContain("0987654321");
    expect(out).toContain("Sata4");
    // Tên con KHÔNG được biến mất — đó là cả mục đích của định dạng mới. Họ tên
    // dài thì thu về TÊN GỌI (chữ cuối) chứ KHÔNG cắt cụt giữa chừng.
    expect(out.startsWith("Khai_")).toBe(true);
  });
});

// =============================================================================
// 20/08 (vòng 4) — MÃ KHOÁ NGẮN.
//
// Bản trước lấy thẳng `OrderItem.itemName` (= `Course.name`, tên marketing dài) làm
// thành phần tên khoá. Đo trên danh mục thật: tên khoá sạch dài 17–24 ký tự nên
// ngân sách tên con ở trần 25 luôn ≤ 0 ⇒ TÊN CON BIẾN MẤT Ở 11/11 KHOÁ, và tên khoá
// còn cụt giữa từ ("0987654321_Sata4ButPhaGi"). Mục đích nghiệp vụ — kế toán nhìn
// sao kê biết tiền của CON NÀO — không đạt. Đây là bộ test khoá lại việc đó.
// =============================================================================

/**
 * 11 khoá THẬT. Nguồn: `prisma/seed-courses.ts` ghép `${c.id} — ${c.displayName}`
 * từ `components/legacy-laptrinhrobot/_data/courses-pricing.ts`, cộng 2 khoá gốc
 * trong `prisma/seed.ts`. Dấu gạch là gạch DÀI "—" (U+2014) đúng như seed.
 */
const KHOA_THAT: { name: string; token: string }[] = [
  { name: "Sata1 — Robosim Master", token: "Sata1" },
  { name: "Sata2 — Đấu trường Robot", token: "Sata2" },
  { name: "Sata3 — Ươm Mầm Tài Năng", token: "Sata3" },
  { name: "Sata4 — Bứt Phá Giới Hạn", token: "Sata4" },
  { name: "Sata5 — Khơi Nguồn Sáng Tạo", token: "Sata5" },
  { name: "Sata6 — Chinh Phục Đấu Trường", token: "Sata6" },
  { name: "Sata7 — Kiến Tạo Tương Lai", token: "Sata7" },
  { name: "Sata8 — Vé Vàng Chung Kết", token: "Sata8" },
  { name: "Combo — Full Lộ Trình Luyện Thi", token: "Combo" },
  // 2 khoá gốc không có phần mã ⇒ cắt ở COURSE_TOKEN_MAX.
  { name: "Lập trình Robot", token: "Laptr" },
  { name: "Luyện thi Robosim", token: "Luyen" },
];

describe("shortCourseToken — rút mã khoá", () => {
  it("rút đúng mã cho cả 11 khoá thật", () => {
    for (const k of KHOA_THAT) {
      expect(shortCourseToken(k.name), k.name).toBe(k.token);
    }
  });

  it("nhận cả gạch ngắn CÓ khoảng trắng hai bên (dạng shortName trong bảng giá)", () => {
    expect(shortCourseToken("Sata1 - Robosim Master")).toBe("Sata1");
    expect(shortCourseToken("Sata2 – Đấu trường Robot")).toBe("Sata2");
  });

  it("KHÔNG cắt ở gạch nối DÍNH chữ — đó là dấu nối trong từ, không phải phân cách", () => {
    // "E-learning" mà cắt ở gạch thì mã khoá còn mỗi "E".
    expect(shortCourseToken("E-learning Robotics")).toBe("Elear");
  });

  it("tên mở đầu bằng chính dấu gạch → lùi về cả chuỗi, không trả rỗng", () => {
    expect(shortCourseToken("— Bứt Phá Giới Hạn")).toBe("ButPh");
  });

  it("rỗng/null → chuỗi rỗng (thành phần bị bỏ qua)", () => {
    expect(shortCourseToken(null)).toBe("");
    expect(shortCourseToken(undefined)).toBe("");
    expect(shortCourseToken("   ")).toBe("");
    expect(shortCourseToken("★★")).toBe("");
  });

  it("không bao giờ dài quá trần", () => {
    for (const k of KHOA_THAT) {
      expect(shortCourseToken(k.name).length).toBeLessThanOrEqual(COURSE_TOKEN_MAX);
    }
  });
});

describe("chuỗi 25 ký tự (trần mã QR) — 11 khoá thật", () => {
  const CHILD = "Nguyễn Minh Khôi";
  const PHONE = "0987654321";

  it("mẫu chủ dự án nêu ra khi chốt định dạng phải ra ĐÚNG như thế", () => {
    expect(
      buildTransferContent("Nguyễn Văn A", "0987654321", "Sata4 — Bứt Phá Giới Hạn", 25),
    ).toBe("A_0987654321_Sata4");
    // Mẫu thứ hai chủ dự án đưa khi chốt quy tắc rút gọn (21/08).
    expect(
      buildTransferContent("Trần Minh An", "0987654321", "Sata4 — Bứt Phá Giới Hạn", 25),
    ).toBe("An_0987654321_Sata4");
  });

  it("mọi khoá đều CÓ tên con VÀ CÓ mã khoá NGUYÊN VẸN", () => {
    for (const k of KHOA_THAT) {
      const parts = transferContentParts(CHILD, PHONE, k.name, VIETQR_ADDINFO_MAX);
      expect(parts.content.length, k.name).toBeLessThanOrEqual(VIETQR_ADDINFO_MAX);
      // Tên con: phải còn, và là TÊN GỌI nguyên vẹn (không cụt).
      expect(parts.name, k.name).toBe("Khoi");
      // SĐT: trọn vẹn — khoá đối khớp duy nhất của nhánh (d).
      expect(parts.phone, k.name).toBe("0987654321");
      // Mã khoá: không cụt.
      expect(parts.course, k.name).toBe(k.token);
      expect(parts.content, k.name).toBe(`Khoi_0987654321_${k.token}`);
    }
  });

  it("tên con NGẮN thì được giữ trọn, không bị cắt về hạn mức tối thiểu", () => {
    // "Le An" (5 ký tự) < hạn mức 7 ⇒ giữ nguyên, phần thừa không ai lấy mất.
    expect(buildTransferContent("Lê An", "0987654321", "Sata4 — Bứt Phá Giới Hạn", 25)).toBe(
      "LeAn_0987654321_Sata4",
    );
  });
});

describe("bất biến giữa chuỗi 25 và chuỗi 80", () => {
  const PHONE = "0912345678";

  it("SĐT và MÃ KHOÁ giống hệt nhau ở hai trần; tên con ở bản 25 là TIỀN TỐ của bản 80", () => {
    for (const k of KHOA_THAT) {
      const short = transferContentParts("Nguyễn Thị Hồng Nhung", PHONE, k.name, 25);
      const long = transferContentParts(
        "Nguyễn Thị Hồng Nhung",
        PHONE,
        k.name,
        MAX_TRANSFER_CONTENT,
      );
      expect(short.phone, k.name).toBe(long.phone);
      expect(short.course, k.name).toBe(long.course);
      // Bản 80 giữ HỌ TÊN đầy đủ, bản 25 chỉ còn TÊN GỌI — nên tên bản 25 là
      // HẬU TỐ (chữ cuối) của bản 80, không phải tiền tố như quy tắc cũ.
      expect(long.name.endsWith(short.name), k.name).toBe(true);
      expect(short.name, k.name).toBe("Nhung");
    }
  });

  it("tên con vừa ngân sách ⇒ chuỗi 25 là CHUỖI CON thật sự của chuỗi 80", () => {
    // "Lê An" đủ ngắn nên không bị cắt ⇒ hai chuỗi trùng khít nhau.
    const short = buildTransferContent("Lê An", PHONE, "Sata4 — Bứt Phá Giới Hạn", 25);
    const long = buildTransferContent(
      "Lê An",
      PHONE,
      "Sata4 — Bứt Phá Giới Hạn",
      MAX_TRANSFER_CONTENT,
    );
    expect(long).toContain(short);
  });

  it("thu về TÊN GỌI ⇒ chuỗi 25 VẪN là chuỗi con của chuỗi 80", () => {
    // Bất biến này QUAY LẠI nhờ quy tắc 21/08 và nó không phải trùng hợp:
    // `sanitizePart(họ tên)` luôn KẾT THÚC bằng `givenNamePart(họ tên)` (sạch hoá chỉ
    // bỏ khoảng trắng/dấu, không đảo thứ tự chữ), mà `phone` và `course` thì giống
    // hệt ở hai trần ⇒ chuỗi 25 luôn là phần ĐUÔI của chuỗi 80.
    // Giá trị thực tế: phụ huynh gõ tay theo lời sale (bản 80) vẫn khớp TẦNG 1 với
    // chuỗi hệ thống phát ra (bản 25) — xem payos-ingest.ts `expectedContentsFor`.
    const short = buildTransferContent("Nguyễn Văn A", PHONE, "Sata4 — Bứt Phá Giới Hạn", 25);
    const long = buildTransferContent("Nguyễn Văn A", PHONE, "Sata4 — Bứt Phá Giới Hạn");
    expect(short).toBe("A_0912345678_Sata4");
    expect(long).toBe("NguyenVanA_0912345678_Sata4");
    expect(long).toContain(short);
  });
});

describe("anh em ruột — cùng SĐT, cùng khoá, khác tên", () => {
  it("sinh HAI chuỗi khác nhau ngay ở trần 25 (trước 20/08 là trùng khít)", () => {
    const anh = buildTransferContent("Nguyễn An", "0987654321", "Sata4 — Bứt Phá Giới Hạn", 25);
    const em = buildTransferContent("Nguyễn Bình", "0987654321", "Sata4 — Bứt Phá Giới Hạn", 25);
    // ⚠️ `anh` giữ được HỌ TÊN chứ không co về tên gọi — đó là ký tự dôi ra từ việc
    // đổi SĐT sang dạng nội địa 14/09 (10 số thay vì 11). Ngân sách:
    //   25 + 1 − (10 + 1) = 15; "NguyenAn" tốn 9, "Sata4" tốn 6 ⇒ vừa KHÍT 15.
    // Với SĐT `84…` cũ ngân sách chỉ 14 nên nó phải co về "An". Nhiều thông tin hơn
    // trong cùng một mã QR, không phải hồi quy.
    expect(anh).toBe("NguyenAn_0987654321_Sata4");
    expect(anh).toHaveLength(25);
    // "NguyenBinh" tốn 11 + 6 = 17 > 15 ⇒ vẫn co về tên gọi.
    expect(em).toBe("Binh_0987654321_Sata4");
    expect(anh).not.toBe(em);
  });

  it("hai tên chỉ khác nhau ở chữ CUỐI vẫn tách được — giới hạn cũ đã hết", () => {
    // Trước 21/08 quy tắc cắt 7 ký tự đầu cho cả hai ra "NguyenV" nên hoà ở tầng 1
    // và phải nhờ tiêu chí số tiền. Lấy TÊN GỌI thì tách ngay — đúng chỗ tên anh em
    // ruột khác nhau trong thực tế (trùng họ + chữ đệm, khác chữ cuối).
    const a = buildTransferContent("Nguyễn Văn An", "0987654321", "Sata4 — Bứt Phá Giới Hạn", 25);
    const b = buildTransferContent("Nguyễn Văn Anh", "0987654321", "Sata4 — Bứt Phá Giới Hạn", 25);
    expect(a).toBe("An_0987654321_Sata4");
    expect(b).toBe("Anh_0987654321_Sata4");
    expect(a).not.toBe(b);
  });
});

describe("transferPhonePart — in SĐT dạng NỘI ĐỊA 0…", () => {
  it("mọi dạng phụ huynh hay gõ đều về dạng NỘI ĐỊA 0XXXXXXXXX", () => {
    // ĐỔI 14/09/2026 (chủ dự án): chuỗi này là thứ sale ĐỌC và phụ huynh GÕ, mà
    // không ai đọc số của mình theo dạng `84…`. Dạng LƯU TRỮ vẫn là canonical `84…`
    // — `canonicalPhone` không đổi; chỉ khâu IN RA đổi.
    expect(transferPhonePart("0987654321")).toBe("0987654321");
    expect(transferPhonePart("0987654321")).toBe("0987654321");
    expect(transferPhonePart("+0987654321")).toBe("0987654321");
    expect(transferPhonePart("+84 0987 654 321")).toBe("0987654321");
    expect(transferPhonePart("0987.654.321")).toBe("0987654321");
  });

  it("rỗng/null → chuỗi rỗng (caller bỏ qua thành phần)", () => {
    expect(transferPhonePart(null)).toBe("");
    expect(transferPhonePart(undefined)).toBe("");
    expect(transferPhonePart("   ")).toBe("");
    expect(transferPhonePart("khong-co-so")).toBe("");
  });

  it("số không phải di động VN (số bàn) → vẫn in phần chữ số cho người đối chiếu", () => {
    // Không chuẩn hoá được nhưng KHÔNG được nuốt mất: kế toán còn soi sao kê.
    expect(transferPhonePart("02363 888 999")).toBe("02363888999");
  });
});

describe("transferContentForOrder — một công thức duy nhất cho mọi chỗ in ra", () => {
  it("ưu tiên tên học viên, lùi về tên người mua khi đơn chưa gắn học viên", () => {
    expect(
      transferContentForOrder({
        studentName: "Trần Bảo Long",
        customerName: "Trần Văn Hùng",
        customerPhone: "0912345678",
        courseName: "Sata 2",
      }),
    ).toBe("TranBaoLong_0912345678_Sata2");

    expect(
      transferContentForOrder({
        studentName: null,
        customerName: "Trần Văn Hùng",
        customerPhone: "0912345678",
        courseName: "Sata 2",
      }),
    ).toBe("TranVanHung_0912345678_Sata2");
  });

  it("tên học viên toàn khoảng trắng cũng lùi về tên người mua", () => {
    expect(
      transferContentForOrder({
        studentName: "   ",
        customerName: "Trần Văn Hùng",
        customerPhone: "0912345678",
        courseName: null,
      }),
    ).toBe("TranVanHung_0912345678");
  });
});
