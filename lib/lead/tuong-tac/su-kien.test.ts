/**
 * CÂU CHỮ của lịch sử tương tác lead.
 *
 * Yêu cầu của chủ dự án khi chọn cách lưu: **"cần chuyển sang ngôn ngữ người dùng"**. Đó
 * là một yêu cầu về CHỮ, nên bộ này kiểm CHỮ — và ca [TT-U-04] là ca giữ đúng yêu cầu ấy:
 * nó dựng một sự việc mẫu cho TỪNG mã việc rồi soi xem có mã máy nào lọt ra câu không.
 *
 * ⚠️ Mọi mốc thời gian ở đây là ngày TUYỆT ĐỐI truyền vào hàm (luật 19) — không hàm nào
 * trong `su-kien.ts` được đọc `new Date()`, nên bộ này không đổi kết quả theo tờ lịch.
 */
import { describe, expect, it } from "vitest";
import { moTaTuongTac, NHAN_VIEC, type MaViec, type SuKienLead } from "./su-kien";

// 20/09/2026 14:30 giờ VN = 07:30Z. Chọn THÁNG 9 có chủ đích: `vnParts().month` là 0-11,
// nên bản đầu in ra "20/08". Ca [TT-U-01] là chỗ bắt lỗi đó.
const NGAY_20_09 = new Date("2026-09-20T07:30:00.000Z");
const NGAY_22_09 = new Date("2026-09-22T02:00:00.000Z"); // 09:00 VN

describe("[TT-U-01] mốc thời gian in ra theo giờ VN, KHÔNG lệch tháng", () => {
  it("ngày 20/09 in ra đúng 20/09 (không phải 20/08)", () => {
    const s = moTaTuongTac({
      viec: "trial.diem-danh",
      tenCon: "Nguyễn An",
      tenLop: "TN-CS1-SATA4-01",
      coMat: true,
      ngay: NGAY_20_09,
    });
    expect(s).toContain("20/09");
    expect(s).not.toContain("20/08");
  });

  it("⚠️ mốc rơi vào đêm theo UTC vẫn in ra NGÀY VN", () => {
    // 19/09 17:30Z = 20/09 00:30 giờ VN. Đọc bằng `getUTCDate()` sẽ ra "19/09" — lệch
    // một ngày, và lệch đúng về phía làm người đọc tưởng buổi học đã qua.
    const s = moTaTuongTac({
      viec: "trial.diem-danh",
      tenCon: "Nguyễn An",
      tenLop: "TN-01",
      coMat: true,
      ngay: new Date("2026-09-19T17:30:00.000Z"),
    });
    expect(s).toContain("20/09");
    expect(s).not.toContain("19/09");
  });

  it("dời lịch in cả ngày lẫn giờ — giờ đến từ cột chuỗi, không từ `Date`", () => {
    // `TrialClassSession.date` là `@db.Date` (không mang giờ), giờ nằm ở `startTime`/
    // `endTime`. Ghép chúng thành `Date` là tự dựng một mốc không có trong DB.
    const s = moTaTuongTac({
      viec: "trial.doi-lich",
      tenLop: "TN-CS1-SATA4-01",
      ngayTruoc: NGAY_20_09,
      gioTruoc: "14:00–16:00",
      ngaySau: NGAY_22_09,
      gioSau: "09:00–11:00",
      lyDo: "phụ huynh xin dời",
    });
    expect(s).toBe(
      "Đổi lịch buổi trải nghiệm lớp TN-CS1-SATA4-01: 20/09 14:00–16:00 → 22/09 09:00–11:00." +
        " Lý do: phụ huynh xin dời.",
    );
  });
});

describe("[TT-U-02] câu của từng nhóm đọc được như người viết", () => {
  it("xếp con vào lớp trải nghiệm", () => {
    expect(
      moTaTuongTac({ viec: "trial.xep-lop", tenCon: "Nguyễn An", tenLop: "TN-CS1-SATA4-01" }),
    ).toBe("Xếp Nguyễn An vào lớp trải nghiệm TN-CS1-SATA4-01.");
  });

  it("điểm danh vắng nói rõ là VẮNG", () => {
    const s = moTaTuongTac({
      viec: "trial.diem-danh",
      tenCon: "Nguyễn An",
      tenLop: "TN-CS1-SATA4-01",
      coMat: false,
      ngay: NGAY_20_09,
    });
    expect(s).toContain("vắng");
    expect(s).not.toContain("có mặt");
  });

  it("tiền in theo lối Việt, không phải số trần", () => {
    const s = moTaTuongTac({ viec: "don.tao", maDon: "DH-0007", tongTien: 5_200_000 });
    expect(s).toBe("Tạo đơn DH-0007, tổng 5.200.000đ.");
    expect(s).not.toContain("5200000");
  });

  it("⚠️ chốt lead kể TÊN CON, và KHÔNG phán số tiền", () => {
    // `convertLeadV2` chỉ trả `studentIds`/`enrollmentIds` — không có tiền. Muốn in tiền
    // thì phải tự tra đơn của lead, mà lượt tra đó trả về MỌI đơn của lead chứ không
    // riêng đơn vừa sinh ⇒ in ra một con số không thuộc việc vừa làm.
    //
    // Ca này sinh ra vì lưới từng XANH GIẢ: cấy một nhánh `return` in "tổng 0đ" vào
    // `chuyen-doi` mà cả bộ vẫn xanh — [TT-U-04] chỉ soi tiếng máy và dấu câu, còn
    // "Chốt lead: tổng 0đ." thì hợp lệ về cả hai.
    const s = moTaTuongTac({ viec: "chuyen-doi", tenCon: ["Nguyễn An", "Nguyễn Bình"] });
    expect(s).toBe("Chốt lead thành học viên: 2 học viên (Nguyễn An, Nguyễn Bình).");
    expect(s).not.toContain("tổng");
    expect(s).not.toContain("đ.");
  });

  it("chốt lead không có tên con nào ⇒ vẫn là câu hoàn chỉnh", () => {
    expect(moTaTuongTac({ viec: "chuyen-doi", tenCon: [] })).toBe("Chốt lead thành học viên.");
  });

  it("trạng thái ĐƠN dịch sang nhãn tiếng Việt, không in tên enum", () => {
    const s = moTaTuongTac({
      viec: "don.doi-trang-thai",
      maDon: "DH-0007",
      tu: "DRAFT",
      den: "CONFIRMED",
    });
    expect(s).not.toContain("DRAFT");
    expect(s).not.toContain("CONFIRMED");
    expect(s).toContain("→");
  });

  it("trạng thái GHI DANH cũng dịch", () => {
    const s = moTaTuongTac({
      viec: "ghi-danh.doi-trang-thai",
      tenCon: "Nguyễn An",
      tenLop: "CS1-SATA4-K01",
      tu: "STUDYING",
      den: "WITHDREW",
    });
    expect(s).toContain("Đang học");
    expect(s).toContain("Nghỉ học");
    expect(s).not.toContain("WITHDREW");
  });

  it("thiếu trạng thái NGUỒN thì in gạch, không in chữ null", () => {
    const s = moTaTuongTac({
      viec: "don.doi-trang-thai",
      maDon: "DH-1",
      tu: null,
      den: "PENDING_PAYMENT",
    });
    expect(s).toContain("—");
    expect(s).not.toMatch(/null|undefined/);
  });
});

describe("[TT-U-03] lý do và danh sách trường — đuôi câu không treo lơ lửng", () => {
  it("có lý do ⇒ nối vào cuối câu", () => {
    const s = moTaTuongTac({
      viec: "trial.go-lop",
      tenCon: "Nguyễn An",
      tenLop: "TN-01",
      lyDo: "phụ huynh xin đổi buổi",
    });
    expect(s).toBe("Gỡ Nguyễn An khỏi lớp trải nghiệm TN-01. Lý do: phụ huynh xin đổi buổi.");
  });

  it("lý do TRỐNG / toàn khoảng trắng ⇒ KHÔNG sinh đuôi 'Lý do:' rỗng", () => {
    for (const lyDo of [null, undefined, "", "   "]) {
      const s = moTaTuongTac({ viec: "trial.go-lop", tenCon: "An", tenLop: "TN-01", lyDo });
      expect(s, `lyDo=${JSON.stringify(lyDo)}`).toBe("Gỡ An khỏi lớp trải nghiệm TN-01.");
    }
  });

  it("sửa ≤3 trường ⇒ kể hết tên", () => {
    expect(moTaTuongTac({ viec: "ho-so.sua", truong: ["tên phụ huynh", "email"] })).toBe(
      "Sửa hồ sơ lead: tên phụ huynh, email.",
    );
  });

  it("sửa >3 trường ⇒ gom lại, câu không dài vô tận", () => {
    const s = moTaTuongTac({
      viec: "ho-so.sua",
      truong: ["tên phụ huynh", "email", "tên con", "tuổi con", "khoá quan tâm"],
    });
    expect(s).toBe("Sửa hồ sơ lead: tên phụ huynh, email và 3 trường khác.");
  });

  it("danh sách trường RỖNG ⇒ vẫn là câu hoàn chỉnh, không có dấu hai chấm cụt", () => {
    expect(moTaTuongTac({ viec: "ho-so.sua", truong: [] })).toBe("Sửa hồ sơ lead.");
    expect(moTaTuongTac({ viec: "ho-so.sua", truong: ["", "  "] })).toBe("Sửa hồ sơ lead.");
  });
});

// ── mẫu cho MỌI mã việc — dùng cho ca phủ toàn bộ ─────────────────────────────────────
const MAU: Record<MaViec, SuKienLead> = {
  "trial.xep-lop": { viec: "trial.xep-lop", tenCon: "Nguyễn An", tenLop: "TN-01" },
  "trial.xep-case": { viec: "trial.xep-case", tenCon: "Nguyễn An", tenLop: "TN-01", gio: "18:00–19:00" },
  "trial.go-case": { viec: "trial.go-case", tenCon: "Nguyễn An", tenLop: "TN-01", gio: "18:00–19:00" },
  "trial.go-lop": { viec: "trial.go-lop", tenCon: "Nguyễn An", tenLop: "TN-01", lyDo: "đổi buổi" },
  "trial.diem-danh": {
    viec: "trial.diem-danh",
    tenCon: "Nguyễn An",
    tenLop: "TN-01",
    coMat: true,
    ngay: NGAY_20_09,
  },
  "trial.doi-lich": {
    viec: "trial.doi-lich",
    tenLop: "TN-01",
    ngayTruoc: NGAY_20_09,
    gioTruoc: "14:00–16:00",
    ngaySau: NGAY_22_09,
    gioSau: "09:00–11:00",
    lyDo: null,
  },
  "trial.huy-buoi": { viec: "trial.huy-buoi", tenLop: "TN-01", ngay: NGAY_20_09, lyDo: null },
  "trial.huy-lop": { viec: "trial.huy-lop", tenLop: "TN-01", lyDo: "không đủ sĩ số" },
  "don.tao": { viec: "don.tao", maDon: "DH-0007", tongTien: 5_200_000 },
  "don.doi-trang-thai": {
    viec: "don.doi-trang-thai",
    maDon: "DH-0007",
    tu: "DRAFT",
    den: "CONFIRMED",
  },
  "don.sua-ghi-chu": { viec: "don.sua-ghi-chu", maDon: "DH-0007" },
  "chuyen-doi": { viec: "chuyen-doi", tenCon: ["Nguyễn An"] },
  "ghi-danh.them": { viec: "ghi-danh.them", tenCon: "Nguyễn An", tenLop: "CS1-K01" },
  "ghi-danh.doi-trang-thai": {
    viec: "ghi-danh.doi-trang-thai",
    tenCon: "Nguyễn An",
    tenLop: "CS1-K01",
    tu: "STUDYING",
    den: "WITHDREW",
  },
  "ghi-danh.chuyen-lop": {
    viec: "ghi-danh.chuyen-lop",
    tenCon: "Nguyễn An",
    lopCu: "CS1-K01",
    lopMoi: "CS1-K02",
  },
  "ghi-danh.go": { viec: "ghi-danh.go", tenCon: "Nguyễn An", tenLop: "CS1-K01", lyDo: null },
  "ho-so.sua": { viec: "ho-so.sua", truong: ["email"] },
  "con.them": { viec: "con.them", tenCon: "Nguyễn An" },
  "con.sua": { viec: "con.sua", tenCon: "Nguyễn An", truong: ["tuổi"] },
  "con.go": { viec: "con.go", tenCon: "Nguyễn An" },
  "viec.tao": { viec: "viec.tao", tieuDe: "Gọi lại chốt lớp", hanChot: NGAY_20_09 },
  "viec.xong": { viec: "viec.xong", tieuDe: "Gọi lại chốt lớp" },
};

describe("[TT-U-04] ⚠️ MỌI mã việc đều ra câu người đọc — không lọt tiếng máy", () => {
  const ma = Object.keys(MAU) as MaViec[];

  it("phép quét tự kiểm: có mẫu cho đủ số mã việc đang khai", () => {
    // Nếu ai thêm nhánh vào `SuKienLead` mà quên thêm mẫu ở đây thì `tsc` đã đỏ (MAU là
    // `Record<MaViec, …>`). Ca này chỉ chặn trường hợp bảng mẫu bị bỏ rỗng đi.
    expect(ma.length).toBeGreaterThanOrEqual(20);
    expect(ma.length).toBe(Object.keys(NHAN_VIEC).length);
  });

  it.each(ma)("%s — câu là tiếng Việt hoàn chỉnh", (m) => {
    const s = moTaTuongTac(MAU[m]);
    expect(s.length, "câu rỗng").toBeGreaterThan(8);
    // Kết thúc bằng dấu câu — dòng lịch sử không phải mẩu chuỗi cụt.
    expect(s.trimEnd(), `"${s}" không kết thúc bằng dấu câu`).toMatch(/[.!?]$/);
    // Không lọt giá trị máy.
    expect(s, `"${s}" lọt undefined/null/object`).not.toMatch(
      /undefined|\bnull\b|\[object|NaN/,
    );
    // Không lọt TÊN ENUM (chuỗi ≥4 ký tự chỉ gồm HOA/gạch dưới). Mã đơn "DH-0007" dùng
    // gạch NGANG nên không khớp; "TN-01"/"CS1-K01" cũng vậy.
    const enumLot = s.match(/\b[A-Z][A-Z_]{3,}\b/g);
    expect(enumLot, `"${s}" lọt tên enum: ${enumLot?.join(", ")}`).toBeNull();
    // Không lọt mã việc (kiểu "trial.xep-lop") vào câu người đọc.
    expect(s, `"${s}" lọt mã việc`).not.toContain(m);
  });

  it.each(ma)("%s — có nhãn ngắn cho panel", (m) => {
    const n = NHAN_VIEC[m];
    expect(n, `thiếu nhãn cho ${m}`).toBeTruthy();
    expect(n).not.toContain(".");
    expect(n.length).toBeLessThanOrEqual(30);
  });
});
