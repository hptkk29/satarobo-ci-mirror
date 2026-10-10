// lib/students/lead-nguon-view.test.ts — tầng che của khối "Lead nguồn" trên hồ sơ học viên.
//
// Fixture mang HÌNH DẠNG THẬT (luật đọc số): SĐT lưu dạng canonical `84…` như đường ghi
// hiện hành; ghi chú có dòng MÁY ghi trộn với chữ người gõ như `buildNote()` sinh ra; hoạt
// động có dòng NOTE do máy ghi (`metadata.system`) MỚI HƠN lần Sale gọi thật.
import { describe, it, expect } from "vitest";
import type { LeadActivityType } from "@prisma/client";
import {
  dungLeadGoiY,
  dungLeadNguonChiTiet,
  locPhanDienTheoQuyen,
  type LeadThoChiTiet,
} from "./lead-nguon-view";
import { SYSTEM_ACTIVITY_META } from "@/lib/lead/activity-clock";
import { MASKED_TEXT } from "@/lib/lead/pii";

const LEAD: LeadThoChiTiet = {
  id: "lead_1",
  parentName: "Nguyễn Thị Lan",
  phone: "84905123456",
  status: "DA_DANG_KY",
  source: "Facebook",
  note: "Nhân viên nhập: SR.NV.02\nCon thích lắp robot, hẹn gọi chiều thứ 5\n⚠️ Đã chia tự động cho Sale A",
  createdAt: new Date("2026-08-02T03:15:00.000Z"),
  course: { name: "Sata 3" },
  center: { name: "Trụ sở chính - Nguyễn Hữu Thọ" },
  assignedTo: { name: "Trần Văn Sale" },
  affiliate: { name: "Phụ huynh Minh", code: "PHMINH" },
};

const CON = { id: "child_1", fullName: "Nguyễn Minh Khôi", tenLop: "SATA3-CS1-T7" };

const act = (type: LeadActivityType, iso: string, metadata?: unknown) => ({
  type,
  createdAt: new Date(iso),
  metadata,
});

// Lần Sale GỌI thật lúc 09:00 ngày 10/09; sau đó máy tự ghi một NOTE lúc 02:00 ngày 12/09.
const HOAT_DONG = [
  act("CALL", "2026-09-10T02:00:00.000Z"),
  act("NOTE", "2026-09-12T19:00:00.000Z", SYSTEM_ACTIVITY_META),
  act("STATUS_CHANGE", "2026-09-13T01:00:00.000Z"),
];

function dung(canViewPii: boolean, canViewAll: boolean) {
  return dungLeadNguonChiTiet({
    lead: LEAD,
    nguoiNhap: { name: "Lê Thị Nhập", employeeCode: "SR.NV.06" },
    khoaQuanTamCuaCon: null,
    hoatDong: HOAT_DONG,
    con: CON,
    canViewPii,
    canViewAll,
    sdtHocVienBiChe: false,
  });
}

describe("[LNV-01] thiếu leads:view-pii ⇒ mọi chuỗi danh tính đã che TRƯỚC khi rời server", () => {
  const v = dung(false, true);

  it("tên phụ huynh che (giữ họ), không còn tên thật", () => {
    expect(v.tenPhuHuynh).not.toBe("Nguyễn Thị Lan");
    expect(v.tenPhuHuynh).toBe("Nguyễn T. L.");
  });

  it("SĐT che — không lộ đầu số + 1 (mặt nạ chuẩn giữ 3 đầu 3 cuối)", () => {
    expect(v.sdt).not.toBeNull();
    expect(v.sdt).not.toContain("0905");
    expect(v.sdt).not.toContain("84905");
    expect(v.sdt).not.toContain("123456");
  });

  it("ghi chú ẩn HẲN (nội dung tự do), không che từng phần", () => {
    expect(v.ghiChu).toBe(MASKED_TEXT);
  });

  it("tên CON che tay — maskLeadPiiFields không phủ LeadChild.fullName", () => {
    expect(v.con?.ten).toBe("Nguyễn M. K.");
    expect(JSON.stringify(v)).not.toContain("Minh Khôi");
  });

  it("cả khối không còn một chuỗi PII thô nào", () => {
    const s = JSON.stringify(v);
    for (const tho of ["Nguyễn Thị Lan", "0905123456", "84905123456", "thứ 5", "Minh Khôi"]) {
      expect(s, tho).not.toContain(tho);
    }
  });
});

describe("[LNV-02] có leads:view-pii ⇒ bản thô, SĐT ở dạng người đọc `0…`", () => {
  const v = dung(true, true);

  it("tên + SĐT + tên con nguyên văn", () => {
    expect(v.tenPhuHuynh).toBe("Nguyễn Thị Lan");
    expect(v.sdt).toBe("0905123456");
    expect(v.con).toEqual({ id: "child_1", ten: "Nguyễn Minh Khôi", lopTaiTrungTam: "SATA3-CS1-T7" });
  });

  it("ghi chú chỉ là phần NGƯỜI gõ — dòng máy ghi (mã NV, cảnh báo) không lọt ra", () => {
    expect(v.ghiChu).toBe("Con thích lắp robot, hẹn gọi chiều thứ 5");
    expect(v.ghiChu).not.toContain("SR.NV.02");
    expect(v.ghiChu).not.toContain("⚠️");
  });

  it("lead chưa có SĐT (chuỗi rỗng — lead FB) ⇒ sdt null, không phải chuỗi rỗng", () => {
    const r = dungLeadNguonChiTiet({
      lead: { ...LEAD, phone: "" },
      nguoiNhap: null,
      khoaQuanTamCuaCon: null,
      hoatDong: [],
      con: null,
      canViewPii: true,
      canViewAll: true,
      sdtHocVienBiChe: false,
    });
    expect(r.sdt).toBeNull();
  });
});

describe("[LNV-03] 'Người nhập lead' chỉ cho leads:view-all — khuôn MÃ_Tên", () => {
  it("thiếu leads:view-all ⇒ nguoiNhap null VÀ hienNguoiNhap false (dù có được đưa dữ liệu vào)", () => {
    const v = dung(true, false);
    expect(v.nguoiNhap).toBeNull();
    expect(v.hienNguoiNhap).toBe(false);
    expect(JSON.stringify(v)).not.toContain("SR.NV.06");
  });

  it("có leads:view-all ⇒ 'MÃ_Tên'", () => {
    const v = dung(true, true);
    expect(v.nguoiNhap).toBe("SR.NV.06_Lê Thị Nhập");
    expect(v.hienNguoiNhap).toBe(true);
  });
});

describe("[LNV-04] tương tác gần nhất = lần NGƯỜI chạm khách, bỏ dòng máy ghi", () => {
  it("NOTE máy ghi mới hơn KHÔNG được tính — ra lần CALL của Sale", () => {
    expect(dung(true, true).tuongTacGanNhat).toBe("2026-09-10T02:00:00.000Z");
  });

  it("chỉ có dòng máy ghi + đổi trạng thái ⇒ null (chưa ai chạm), không rơi về ngày nhận lead", () => {
    const v = dungLeadNguonChiTiet({
      lead: LEAD,
      nguoiNhap: null,
      khoaQuanTamCuaCon: null,
      hoatDong: [HOAT_DONG[1]!, HOAT_DONG[2]!],
      con: null,
      canViewPii: true,
      canViewAll: true,
      sdtHocVienBiChe: false,
    });
    expect(v.tuongTacGanNhat).toBeNull();
  });
});

describe("[LNV-05] các ô phễu còn lại", () => {
  const v = dung(true, true);

  it("khoá quan tâm của PHIẾU đi trước khoá của con", () => {
    const r = dungLeadNguonChiTiet({
      lead: LEAD,
      nguoiNhap: null,
      khoaQuanTamCuaCon: "Sata 1",
      hoatDong: [],
      con: null,
      canViewPii: true,
      canViewAll: true,
      sdtHocVienBiChe: false,
    });
    expect(r.khoaQuanTam).toBe("Sata 3");
    const r2 = dungLeadNguonChiTiet({
      lead: { ...LEAD, course: null },
      nguoiNhap: null,
      khoaQuanTamCuaCon: "Sata 1",
      hoatDong: [],
      con: null,
      canViewPii: true,
      canViewAll: true,
      sdtHocVienBiChe: false,
    });
    expect(r2.khoaQuanTam).toBe("Sata 1");
  });

  it("nhãn trạng thái, AFF 'Tên (MÃ)', link phiếu, ngày ISO", () => {
    expect(v.trangThai).toBe("Đã đăng ký");
    expect(v.nguoiGioiThieu).toBe("Phụ huynh Minh (PHMINH)");
    expect(v.href).toBe("/leads/lead_1");
    expect(v.ngayNhanLead).toBe("2026-08-02T03:15:00.000Z");
    expect(v.salePhuTrach).toBe("Trần Văn Sale");
    expect(v.coSo).toBe("Trụ sở chính - Nguyễn Hữu Thọ");
  });
});

describe("[LNV-06] dòng GỢI Ý gắn — cùng luật che", () => {
  const lead = {
    id: "lead_2",
    parentName: "Phạm Văn Hùng",
    phone: "0935111222",
    status: "MOI" as const,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    center: { name: "CS2" },
    assignedTo: null,
    children: [{ id: "c1", fullName: "Phạm Gia Bảo" }],
  };

  it("thiếu PII ⇒ tên PH, SĐT, tên các con đều che", () => {
    const g = dungLeadGoiY({ lead, lyDo: "CUNG_SDT", canViewPii: false, sdtHocVienBiChe: false });
    const s = JSON.stringify(g);
    for (const tho of ["Phạm Văn Hùng", "0935111222", "Gia Bảo"]) expect(s, tho).not.toContain(tho);
    expect(g.cacCon).toEqual([{ id: "c1", ten: "Phạm G. B." }]);
    expect(g.lyDo).toBe("CUNG_SDT");
  });

  it("có PII ⇒ nguyên văn", () => {
    const g = dungLeadGoiY({ lead, lyDo: "TIM_KIEM", canViewPii: true, sdtHocVienBiChe: false });
    expect(g.tenPhuHuynh).toBe("Phạm Văn Hùng");
    expect(g.sdt).toBe("0935111222");
    expect(g.cacCon[0]?.ten).toBe("Phạm Gia Bảo");
  });
});

describe("[LNV-07] nút 'Gắn lead' do người bấm: thiếu PII thì KHÔNG chép PII sang hồ sơ", () => {
  const phan = {
    dateOfBirth: new Date("2018-05-01T00:00:00.000Z"),
    gender: "MALE" as const,
    school: "TH Lê Văn Tám",
    currentGrade: 3,
    parentEmail: "lan@gmail.com",
    parentGender: "FEMALE" as const,
    parentDob: new Date("1988-01-01T00:00:00.000Z"),
    parentFacebookUrl: "https://facebook.com/lan",
    city: "Thành phố Đà Nẵng",
    ward: "Phường Hải Châu",
    address: "12 Lê Lợi",
  };

  it("thiếu PII ⇒ bỏ ngày sinh con, trường, email/ngày sinh/FB phụ huynh; giữ phần còn lại", () => {
    const r = locPhanDienTheoQuyen(phan, false);
    expect(Object.keys(r).sort()).toEqual(
      ["address", "city", "currentGrade", "gender", "parentGender", "ward"].sort(),
    );
  });

  it("có PII ⇒ giữ nguyên (và không sửa đối tượng đầu vào)", () => {
    expect(locPhanDienTheoQuyen(phan, true)).toEqual(phan);
    locPhanDienTheoQuyen(phan, false);
    expect(phan.parentEmail).toBe("lan@gmail.com");
  });
});

// 25/09/2026 — lượt rà đối kháng: SĐT phụ huynh của HỌC VIÊN bị che theo quyền cấp trường
// (US-03) nhưng khối "Lead nguồn" / gợi ý "Cùng SĐT" in SĐT lead — thường là CÙNG một số.
describe("[LNV-08] SĐT học viên đang bị che ⇒ SĐT lead cũng che, kể cả khi có leads:view-pii", () => {
  it("khối chi tiết: số thô KHÔNG xuất hiện; không che thì in đủ", () => {
    const che = dungLeadNguonChiTiet({
      lead: LEAD,
      nguoiNhap: null,
      khoaQuanTamCuaCon: null,
      hoatDong: [],
      con: null,
      canViewPii: true,
      canViewAll: true,
      sdtHocVienBiChe: true,
    });
    const khongChe = dungLeadNguonChiTiet({
      lead: LEAD,
      nguoiNhap: null,
      khoaQuanTamCuaCon: null,
      hoatDong: [],
      con: null,
      canViewPii: true,
      canViewAll: true,
      sdtHocVienBiChe: false,
    });
    expect(khongChe.sdt).toBeTruthy();
    expect(che.sdt).toBeTruthy();
    expect(che.sdt).not.toBe(khongChe.sdt);
    expect(che.sdt).toMatch(/x/);
  });

  it("dòng gợi ý: cùng luật che", () => {
    const lead = {
      id: "l9",
      parentName: "Trần Thị Lan",
      phone: "84905123456",
      status: "MOI" as const,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      center: null,
      assignedTo: null,
      children: [],
    };
    const che = dungLeadGoiY({ lead, lyDo: "TIM_KIEM", canViewPii: true, sdtHocVienBiChe: true });
    const khongChe = dungLeadGoiY({ lead, lyDo: "TIM_KIEM", canViewPii: true, sdtHocVienBiChe: false });
    expect(khongChe.sdt).toBe("0905123456");
    expect(che.sdt).not.toContain("905123");
  });
});
