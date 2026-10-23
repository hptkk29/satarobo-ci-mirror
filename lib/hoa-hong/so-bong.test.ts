// @vitest-environment node
/**
 * [SBG-*] — SO BÓNG engine cũ ↔ mới, phần THUẦN (phân loại EXPECTED / UNEXPECTED, tóm tắt, dấu vân). Không DB, không đồng hồ.
 *
 * Luật 14: lưới chưa từng đỏ là lưới chưa được chứng minh. Mỗi ca dưới đây đo CẢ HAI đầu (đối chứng dương cạnh ca từ chối): một ca chỉ khẳng định
 * «là UNEXPECTED» luôn đạt khi bộ phân loại đã hỏng thành «mọi thứ đều UNEXPECTED».
 *
 * Phân loại chỉ đọc LỜI GIẢI THÍCH của engine mới (`VaiDuKien`), nên fixture ở đây KHÔNG có trường nào mang mã nguồn — đó chính là bằng chứng
 * «không so mã» của `[SBG-02]`: một nguồn do admin tạo (mã bất kỳ) có dòng loại trừ vẫn ra đúng mã lý do.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { nhanMaSoBong } from "./so-bong-nhan";
import { BO_LUAT_PHAN_LOAI } from "./phan-loai-giao-dich";
import type { KetQuaPhanBo } from "./phan-bo-khoan";
import {
  MA_EXPECTED,
  PHIEN_BAN_LUAT_SO_BONG,
  dauVanSoBong,
  TRICH_DAN,
  soSanhKhoan,
  thanhPhanKhoanBoQua,
  tongHopSoBong,
  type ChinhSachHieuLuc,
  type DongCu,
  type DongMoi,
  type KhoanSoBong,
  type NgoaiPhamViNap,
  type VaiDuKien,
} from "./so-bong";

const NGOAI: NgoaiPhamViNap = { khoanHoan: { soKhoan: 0, soTien: 0 }, khoanChuyenNoiBo: 0, khoanKhongPhaiHocPhi: { soKhoan: 0, soTien: 0 } };
const CUA_SO = { tuNgay: "2026-07-01", denNgay: "2026-09-30" };
const CS: ChinhSachHieuLuc[] = [{ policyCode: "SR.QD.208", versionId: "v1", version: 1 }];

const cu = (roleCode: string, nguoiId: string, soTien: number): DongCu => ({ roleCode, nguoiId, soTien });
const moi = (roleCode: string, nguoiId: string, soTien: number, kind: DongMoi["kind"] = "USER"): DongMoi => ({ roleCode, kind, nguoiId, soTien });

function vai(roleCode: string, p: Partial<VaiDuKien> = {}): VaiDuKien {
  return { roleCode, trangThai: "SINH_DONG", scopeType: "GLOBAL", nguonKhongRo: false, thuHut: false, resolverType: "TRANSACTION_ROLE", coDongLoaiTruNhom: false, chinhSachCampaign: null, ...p };
}
const vaiLoaiTru = (nguonKhongRo = false): VaiDuKien => vai("MARKETING", { trangThai: "EXCLUDE", scopeType: "SOURCE_GROUP", nguonKhongRo, resolverType: "ORG_UNIT_ROLE" });
const vaiChuNguon = vai("SOURCE_OWNER", { thuHut: true, scopeType: "SOURCE_GROUP", resolverType: "SOURCE_OWNER" });
const vaiGioiThieu = vai("REFERRER_PARENT_SALE", { thuHut: true, scopeType: "SOURCE_GROUP", resolverType: "DIRECT_PERSON" });

function khoan(p: { id?: string; cu?: DongCu[]; dong?: DongMoi[]; vai?: VaiDuKien[]; treo?: { roleCode: string; lyDo: string }[]; moi?: KhoanSoBong["moi"]; cuLaTaiTuc?: boolean; loaiMoi?: KhoanSoBong["loaiMoi"] }): KhoanSoBong {
  return {
    paymentId: p.id ?? "p1",
    ngayThu: "2026-09-10",
    soTienThu: 10_000_000,
    cu: p.cu ?? [],
    cuLaTaiTuc: p.cuLaTaiTuc ?? false,
    loaiMoi: p.loaiMoi === undefined ? "NEW" : p.loaiMoi,
    moi: p.moi ?? { loai: "TINH", dong: p.dong ?? [], vai: p.vai ?? [], treoCoHangCho: p.treo ?? [] },
  };
}

const bao = (ks: KhoanSoBong[], cs = CS, asOf = "2026-09-30") => tongHopSoBong({ khoan: ks, ngoai: NGOAI, cuaSo: CUA_SO, asOf, chinhSach: cs });

describe("[SBG-01] hai engine giống hệt ⇒ MATCH, 0 EXPECTED, 0 UNEXPECTED (đối chứng dương của mọi ca dưới)", () => {
  it("[SBG-01] cùng người, cùng vai, cùng số ⇒ MATCH; không có dòng nào bị đánh dấu chênh", () => {
    const k = khoan({
      cu: [cu("SALE", "u1", 400_000), cu("CENTER_MANAGER", "u2", 200_000), cu("MARKETING", "u3", 100_000)],
      dong: [moi("SALE", "u1", 400_000), moi("CENTER_MANAGER", "u2", 200_000), moi("MARKETING", "u3", 100_000)],
      vai: [vai("SALE"), vai("CENTER_MANAGER"), vai("MARKETING", { resolverType: "ORG_UNIT_ROLE" })],
    });
    const b = bao([k]);
    expect(b.match.soDong).toBe(3);
    expect(b.expected.soDong).toBe(0);
    expect(b.unexpected.soDong).toBe(0);
    expect(b.dong.every((d) => d.loai === "MATCH" && d.ma === null && d.chenh === 0)).toBe(true);
  });
});

describe("[SBG-02] Marketing bị dòng loại trừ phạm vi nguồn ⇒ EXPECTED, KHÔNG phụ thuộc mã nguồn", () => {
  it("[SBG-02] cũ 100.000, mới 0, vai EXCLUDE phạm vi nguồn ⇒ MARKETING_REMOVED_FOR_NON_AD_SOURCE kèm trích dẫn tài liệu", () => {
    const b = bao([khoan({ cu: [cu("MARKETING", "u3", 100_000)], dong: [], vai: [vaiLoaiTru()] })]);
    expect(b.expected.theoMa).toHaveProperty("MARKETING_REMOVED_FOR_NON_AD_SOURCE");
    expect(b.expected.soDong).toBe(1);
    expect(b.expected.chenh).toBe(-100_000);
    expect(b.unexpected.soDong).toBe(0);
    expect(b.dong[0]!.lyDo).toContain("08 §3.1");
  });

  it("[SBG-02] đối chứng: CÙNG chênh nhưng rule loại trừ thuộc phạm vi GLOBAL (không phải nguồn) ⇒ UNEXPECTED — phân loại đọc phạm vi của rule thắng, không đọc «có chênh Marketing»", () => {
    const b = bao([khoan({ cu: [cu("MARKETING", "u3", 100_000)], dong: [], vai: [{ ...vaiLoaiTru(), scopeType: "GLOBAL" }] })]);
    expect(b.expected.soDong).toBe(0);
    expect(b.unexpected.soDong).toBe(1);
  });

  it("[SBG-02] đối chứng: vai KHÁC Marketing bị loại trừ bởi rule phạm vi nguồn ⇒ UNEXPECTED (tài liệu chỉ nói rõ Marketing)", () => {
    const b = bao([khoan({ cu: [cu("SALE_ADMIN", "u9", 100_000)], dong: [], vai: [vai("SALE_ADMIN", { trangThai: "EXCLUDE", scopeType: "SOURCE_GROUP" })] })]);
    expect(b.expected.soDong).toBe(0);
    expect(b.unexpected.soDong).toBe(1);
  });
});

describe("[SBG-03] chênh MỘT PHẦN luôn là UNEXPECTED", () => {
  it("[SBG-03] Marketing được EXPECTED nhưng SALE lệch 10.000 (3,99% thay vì 4%) ở CÙNG khoản ⇒ đúng một dòng UNEXPECTED, dòng Marketing vẫn EXPECTED", () => {
    const b = bao([
      khoan({ cu: [cu("SALE", "u1", 400_000), cu("MARKETING", "u3", 100_000)], dong: [moi("SALE", "u1", 399_000)], vai: [vai("SALE"), vaiLoaiTru()] }),
    ]);
    expect(b.expected.soDong).toBe(1);
    expect(b.unexpected.soDong).toBe(1);
    expect(b.unexpected.chenh).toBe(-1_000);
    expect(b.dong.find((d) => d.loai === "UNEXPECTED")).toMatchObject({ roleCode: "SALE", ma: "SO_TIEN_KHAC", cu: 400_000, moi: 399_000 });
  });

  it("[SBG-03] Marketing còn trả MỘT PHẦN (cũ 100.000, mới 50.000, vai còn SINH_DONG) ⇒ UNEXPECTED, không phải «đã loại»", () => {
    const b = bao([khoan({ cu: [cu("MARKETING", "u3", 100_000)], dong: [moi("MARKETING", "u3", 50_000)], vai: [vai("MARKETING", { resolverType: "ORG_UNIT_ROLE" })] })]);
    expect(b.expected.soDong).toBe(0);
    expect(b.unexpected.soDong).toBe(1);
  });

  // Cấy 10/10/2026: bỏ vế `h.moi !== 0` ở `biLoai` ⇒ 0 ca đỏ — ca trên dùng vai SINH_DONG nên `biLoai` đã sai ở vế trạng thái, không chạm vế số tiền.
  // Ca này giữ LỜI GIẢI THÍCH «EXCLUDE theo nguồn» đứng nguyên và chỉ làm số tiền mới KHÁC 0: lời giải thích đúng mà số tiền không khớp là chênh một phần.
  it("[SBG-03c] vai Marketing nói EXCLUDE theo nguồn nhưng engine mới VẪN trả 50.000 (cũ 100.000) ⇒ UNEXPECTED; đối chứng: mới = 0 ⇒ EXPECTED", () => {
    const loi = bao([khoan({ cu: [cu("MARKETING", "u3", 100_000)], dong: [moi("MARKETING", "u3", 50_000)], vai: [vaiLoaiTru()] })]);
    expect(loi.expected.soDong).toBe(0);
    expect(loi.unexpected.soDong).toBe(1);
    const dung = bao([khoan({ cu: [cu("MARKETING", "u3", 100_000)], dong: [], vai: [vaiLoaiTru()] })]);
    expect(dung.expected.soDong).toBe(1);
    expect(dung.unexpected.soDong).toBe(0);
  });
});

describe("[SBG-04] đổi NGƯỜI nhận ở nguồn quảng cáo (Marketing → chủ nguồn)", () => {
  const vaiHai = [vaiLoaiTru(), vaiChuNguon];
  it("[SBG-04] Marketing −100.000 và chủ nguồn +100.000 ⇒ hai dòng đối nhau, cùng EXPECTED MARKETING_MOVED_TO_SOURCE_OWNER, tổng chênh khoản = 0", () => {
    const b = bao([khoan({ cu: [cu("MARKETING", "q1", 100_000)], dong: [moi("SOURCE_OWNER", "o1", 100_000)], vai: vaiHai })]);
    expect(b.expected.soDong).toBe(2);
    expect(Object.keys(b.expected.theoMa)).toEqual(["MARKETING_MOVED_TO_SOURCE_OWNER"]);
    expect(b.expected.chenh).toBe(0);
    expect(b.unexpected.soDong).toBe(0);
  });

  it("[SBG-04] lệch 1 ĐỒNG (chủ nguồn nhận 100.001) ⇒ dòng chủ nguồn UNEXPECTED; Marketing vẫn «bị loại» chứ không còn là «đã chuyển»", () => {
    const b = bao([khoan({ cu: [cu("MARKETING", "q1", 100_000)], dong: [moi("SOURCE_OWNER", "o1", 100_001)], vai: vaiHai })]);
    expect(b.unexpected.soDong).toBe(1);
    expect(b.dong.find((d) => d.loai === "UNEXPECTED")).toMatchObject({ roleCode: "SOURCE_OWNER", ma: "CHU_NGUON_LECH_SO_TIEN_MARKETING_BI_LOAI" });
    expect(b.expected.theoMa).not.toHaveProperty("MARKETING_MOVED_TO_SOURCE_OWNER");
    expect(b.expected.theoMa).toHaveProperty("MARKETING_REMOVED_FOR_NON_AD_SOURCE");
  });

  it("[SBG-04] hai QC chia đều (50.000 + 50.000) và chủ nguồn nhận đúng 100.000 ⇒ vẫn là chuyển người nhận (so TỔNG của khoản, không so từng dòng Marketing)", () => {
    const b = bao([khoan({ cu: [cu("MARKETING", "q1", 50_000), cu("MARKETING", "q2", 50_000)], dong: [moi("SOURCE_OWNER", "o1", 100_000)], vai: vaiHai })]);
    expect(b.expected.soDong).toBe(3);
    expect(b.unexpected.soDong).toBe(0);
  });
});

describe("[SBG-05] nguồn không rõ mất Marketing", () => {
  // Engine KHÔNG trả EXCLUDE cho nguồn không rõ: mức thấp nhất giữa các nhóm = 0 ⇒ `KHONG_RULE` + `nguonKhongRo` (chon-quy-tac.ts `quyTacChoNguonKhongRo`; đo ở ca DB [SBG-02]).
  const vaiKhongRoMatMarketing = (coDongLoaiTruNhom: boolean): VaiDuKien =>
    vai("MARKETING", { trangThai: "KHONG_RULE", scopeType: null, nguonKhongRo: true, resolverType: "ORG_UNIT_ROLE", coDongLoaiTruNhom });

  it("[SBG-05] nguồn không rõ: KHONG_RULE + `nguonKhongRo` + bộ quy tắc CÓ dòng loại trừ nhóm cho Marketing ⇒ MARKETING_REMOVED_UNKNOWN_SOURCE (mã riêng, không lẫn với nguồn không quảng cáo)", () => {
    const b = bao([khoan({ cu: [cu("MARKETING", "u3", 100_000)], dong: [], vai: [vaiKhongRoMatMarketing(true)] })]);
    expect(Object.keys(b.expected.theoMa)).toEqual(["MARKETING_REMOVED_UNKNOWN_SOURCE"]);
    expect(b.unexpected.soDong).toBe(0);
  });

  it("[SBG-05] đối chứng: CÙNG KHONG_RULE nhưng bộ quy tắc KHÔNG có dòng loại trừ nào (lỗ cấu hình: vai không có rule) ⇒ UNEXPECTED — mất Marketing không phải lúc nào cũng là cố ý", () => {
    const b = bao([khoan({ cu: [cu("MARKETING", "u3", 100_000)], dong: [], vai: [vaiKhongRoMatMarketing(false)] })]);
    expect(b.expected.soDong).toBe(0);
    expect(b.unexpected.soDong).toBe(1);
  });

  it("[SBG-05] nguồn BIẾT RÕ mà KHONG_RULE (không có `nguonKhongRo`) dù bộ quy tắc có dòng loại trừ ⇒ UNEXPECTED — cờ `coDongLoaiTruNhom` chỉ có nghĩa với nguồn không rõ", () => {
    const b = bao([khoan({ cu: [cu("MARKETING", "u3", 100_000)], dong: [], vai: [{ ...vaiKhongRoMatMarketing(true), nguonKhongRo: false }] })]);
    expect(b.expected.soDong).toBe(0);
    expect(b.unexpected.soDong).toBe(1);
  });

  it("[SBG-05] đối chứng: UNKNOWN làm vai KHÁC Marketing giảm tiền (mức thấp nhất) ⇒ UNEXPECTED — danh sách đóng chỉ có Marketing", () => {
    const b = bao([khoan({ cu: [cu("SALE", "u1", 400_000)], dong: [moi("SALE", "u1", 300_000)], vai: [vai("SALE", { nguonKhongRo: true })] })]);
    expect(b.expected.soDong).toBe(0);
    expect(b.dong[0]).toMatchObject({ loai: "UNEXPECTED", ma: "SO_TIEN_KHAC_THEO_NGUON_KHONG_RO" });
  });
});

describe("[SBG-06] nguồn giới thiệu: vai thu hút +2%", () => {
  it("[SBG-06] cũ 0, mới 200.000 cho vai thu hút thắng ở rule phạm vi nguồn ⇒ ACQUISITION_ADDED_BY_SOURCE_POLICY (không cần cặp với Marketing)", () => {
    const b = bao([khoan({ cu: [], dong: [moi("REFERRER_PARENT_SALE", "s1", 200_000)], vai: [vaiGioiThieu] })]);
    expect(b.expected.theoMa).toHaveProperty("ACQUISITION_ADDED_BY_SOURCE_POLICY");
    expect(b.expected.chenh).toBe(200_000);
    expect(b.unexpected.soDong).toBe(0);
  });

  it("[SBG-06] cùng khoản có Marketing −100.000: hai dòng với HAI mã khác nhau (loại bỏ và cộng thêm), tổng +100.000 — không bị gộp thành «chuyển»", () => {
    const b = bao([khoan({ cu: [cu("MARKETING", "q1", 100_000)], dong: [moi("REFERRER_PARENT_SALE", "s1", 200_000)], vai: [vaiLoaiTru(), vaiGioiThieu] })]);
    expect(Object.keys(b.expected.theoMa).sort()).toEqual(["ACQUISITION_ADDED_BY_SOURCE_POLICY", "MARKETING_REMOVED_FOR_NON_AD_SOURCE"]);
    expect(b.expected.chenh).toBe(100_000);
  });

  it("[SBG-06] đối chứng: vai thu hút thắng ở rule GLOBAL (không phải chính sách nguồn) ⇒ UNEXPECTED", () => {
    const b = bao([khoan({ cu: [], dong: [moi("REFERRER_PARENT_SALE", "s1", 200_000)], vai: [{ ...vaiGioiThieu, scopeType: "GLOBAL" }] })]);
    expect(b.expected.soDong).toBe(0);
    expect(b.dong[0]).toMatchObject({ loai: "UNEXPECTED", ma: "DONG_MOI_NGOAI_DANH_SACH" });
  });

  // Cấy 10/10/2026: bỏ vế `trangThai === "SINH_DONG"` ở `themThuHut` ⇒ 0 ca đỏ. Vai thu hút ở rule phạm vi nguồn mà lời giải thích KHÔNG phải «sinh dòng»
  // nhưng số tiền mới > 0 là mâu thuẫn bên trong engine mới ⇒ không được gọi là «cộng thêm theo chính sách».
  it("[SBG-06c] vai thu hút rule phạm vi nguồn nhưng trạng thái TREO mà mới vẫn > 0 ⇒ UNEXPECTED; đối chứng: SINH_DONG ⇒ EXPECTED", () => {
    const loi = bao([khoan({ cu: [], dong: [moi("REFERRER_PARENT_SALE", "s1", 200_000)], vai: [{ ...vaiGioiThieu, trangThai: "TREO" }] })]);
    expect(loi.expected.soDong).toBe(0);
    expect(loi.unexpected.soDong).toBe(1);
    const dung = bao([khoan({ cu: [], dong: [moi("REFERRER_PARENT_SALE", "s1", 200_000)], vai: [vaiGioiThieu] })]);
    expect(dung.expected.soDong).toBe(1);
    expect(dung.unexpected.soDong).toBe(0);
  });
});

describe("[SBG-07] lỗi thật trong engine mới phải lộ ra", () => {
  it("[SBG-07] Sale 3,99% khi KHÔNG có lý do thiết kế nào ⇒ UNEXPECTED; còn engine khớp thì 0 — hai đầu cùng một fixture", () => {
    const loi = bao([khoan({ cu: [cu("SALE", "u1", 400_000)], dong: [moi("SALE", "u1", 399_000)], vai: [vai("SALE")] })]);
    const dung = bao([khoan({ cu: [cu("SALE", "u1", 400_000)], dong: [moi("SALE", "u1", 400_000)], vai: [vai("SALE")] })]);
    expect(loi.unexpected.soDong).toBe(1);
    expect(dung.unexpected.soDong).toBe(0);
  });

  it("[SBG-07] đổi người nhận Sale (cùng số tiền, người khác) ⇒ HAI dòng UNEXPECTED (−/+) dù tổng bằng 0", () => {
    const b = bao([khoan({ cu: [cu("SALE", "u1", 400_000)], dong: [moi("SALE", "u2", 400_000)], vai: [vai("SALE")] })]);
    expect(b.unexpected.soDong).toBe(2);
    expect(b.unexpected.chenh).toBe(0);
  });
});

describe("[SBG-08] hai khoản bù trừ nhau vẫn ra hai dòng riêng", () => {
  it("[SBG-08] khoản A mới thấp hơn 100.000, khoản B mới cao hơn 100.000 ⇒ 2 dòng UNEXPECTED, không bị cấn trừ", () => {
    const b = bao([
      khoan({ id: "pA", cu: [cu("SALE", "u1", 400_000)], dong: [moi("SALE", "u1", 300_000)], vai: [vai("SALE")] }),
      khoan({ id: "pB", cu: [cu("SALE", "u1", 300_000)], dong: [moi("SALE", "u1", 400_000)], vai: [vai("SALE")] }),
    ]);
    expect(b.unexpected.soDong).toBe(2);
    expect(b.unexpected.chenh).toBe(0);
  });

  // Cấy 10/10/2026: gomMoi bỏ `kind` (khoá người = `USER:<id>` cho cả AFFILIATE) ⇒ 0 ca đỏ. Người hưởng loại AFFILIATE khác người hưởng loại USER dù trùng id.
  it("[SBG-08c] cũ trả cho USER a1, mới trả cho AFFILIATE a1 (cùng id, cùng số tiền) ⇒ hai dòng UNEXPECTED, không khớp; đối chứng: cùng loại USER ⇒ MATCH", () => {
    const loi = bao([khoan({ cu: [cu("SALE", "a1", 100_000)], dong: [moi("SALE", "a1", 100_000, "AFFILIATE")], vai: [vai("SALE")] })]);
    expect(loi.match.soDong).toBe(0);
    expect(loi.unexpected.soDong).toBe(2);
    const dung = bao([khoan({ cu: [cu("SALE", "a1", 100_000)], dong: [moi("SALE", "a1", 100_000, "USER")], vai: [vai("SALE")] })]);
    expect(dung.match.soDong).toBe(1);
    expect(dung.unexpected.soDong).toBe(0);
  });
});

describe("[SBG-10] dấu vân tất định", () => {
  const k1 = khoan({ id: "p1", cu: [cu("SALE", "u1", 400_000)], dong: [moi("SALE", "u1", 400_000)], vai: [vai("SALE")] });
  const k2 = khoan({ id: "p2", cu: [cu("MARKETING", "u3", 100_000)], dong: [], vai: [vaiLoaiTru()] });

  it("[SBG-10] hai lượt cùng đầu vào ⇒ cùng dấu; đảo thứ tự khoản ⇒ vẫn cùng dấu", () => {
    expect(bao([k1, k2]).dauVan).toBe(bao([k1, k2]).dauVan);
    expect(bao([k2, k1]).dauVan).toBe(bao([k1, k2]).dauVan);
    expect(bao([k1, k2]).dauVan).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[SBG-10] đổi MỘT thứ nào vào là dấu đổi: phiên bản chính sách · ngày dữ liệu · 1 đồng ở một dòng · cửa sổ", () => {
    const goc = bao([k1, k2]).dauVan;
    expect(bao([k1, k2], [{ ...CS[0]!, versionId: "v2", version: 2 }]).dauVan).not.toBe(goc);
    expect(bao([k1, k2], CS, "2026-10-01").dauVan).not.toBe(goc);
    const k1Lech = khoan({ id: "p1", cu: [cu("SALE", "u1", 400_000)], dong: [moi("SALE", "u1", 400_001)], vai: [vai("SALE")] });
    expect(bao([k1Lech, k2]).dauVan).not.toBe(goc);
    expect(tongHopSoBong({ khoan: [k1, k2], ngoai: NGOAI, cuaSo: { tuNgay: "2026-06-01", denNgay: "2026-09-30" }, asOf: "2026-09-30", chinhSach: CS }).dauVan).not.toBe(goc);
  });

  it("[SBG-10] báo cáo ghi phiên bản luật phân loại (của tệp này và của bộ NEW/RENEWAL) — đổi luật ⇒ đổi dấu có chủ đích", () => {
    const b = bao([k1]);
    expect(b.phienBanLuat).toBe(PHIEN_BAN_LUAT_SO_BONG);
    expect(b.boLuatPhanLoai).toMatch(/^\d{4}-\d{2}-\d{2}\.v\d+$/);
  });

  // Cấy 10/10/2026: bỏ `v: b.phienBanLuat` khỏi dấu ⇒ 0 ca đỏ — ca trên chỉ khẳng định báo cáo GHI phiên bản, không khẳng định phiên bản NẰM TRONG dấu.
  it("[SBG-10c] đổi chuỗi phiên bản luật của tệp này HOẶC của bộ NEW/RENEWAL (giữ nguyên mọi số liệu) ⇒ dấu đổi", () => {
    const { dauVan: goc, ...thanBao } = bao([k1, k2]);
    expect(dauVanSoBong(thanBao)).toBe(goc);
    expect(dauVanSoBong({ ...thanBao, phienBanLuat: `${thanBao.phienBanLuat}-x` })).not.toBe(goc);
    expect(dauVanSoBong({ ...thanBao, boLuatPhanLoai: `${thanBao.boLuatPhanLoai}-x` })).not.toBe(goc);
  });
});

describe("[SBG-11] tái tục: chênh do HAI engine phân loại khác nhau là EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE (D-E, AFF-L2) — nhưng KHÔNG nuốt việc đổi người", () => {
  it("[SBG-11] engine cũ coi là tái tục (0 dòng), engine mới coi là học viên mới (Sale 400.000) ⇒ EXPECTED, mã EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE (đã đổi có chủ đích: trước AFF-L2 ca này ra UNEXPECTED PHAN_LOAI_TAI_TUC_KHAC)", () => {
    const b = bao([khoan({ cuLaTaiTuc: true, cu: [], dong: [moi("SALE", "u1", 400_000)], vai: [vai("SALE")], loaiMoi: "NEW" })]);
    expect(b.unexpected.soDong).toBe(0);
    expect(b.dong[0]).toMatchObject({ loai: "EXPECTED_BUSINESS_DELTA", ma: "EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE" });
    expect(b.dong[0]!.lyDo).toContain("D-E");
  });

  it("[SBG-11] đối chứng: cả hai cùng coi là tái tục (cùng trả 0) ⇒ KHÔNG có dòng chênh nào", () => {
    const b = bao([khoan({ cuLaTaiTuc: true, cu: [], dong: [], vai: [vai("SALE", { trangThai: "KHONG_RULE", scopeType: null })], loaiMoi: "RENEWAL" })]);
    expect(b.dong).toHaveLength(0);
    expect(b.unexpected.soDong).toBe(0);
  });
});

describe("[SBG-12] khoản không phải học phí: học cụ ⇒ EXPECTED; lệ phí khác ⇒ UNEXPECTED", () => {
  it("[SBG-12] học cụ: engine cũ trả, engine mới bỏ ra ngoài ⇒ MATERIAL_OUT_OF_BASE cho TỪNG dòng cũ", () => {
    const b = bao([khoan({ cu: [cu("SALE", "u1", 40_000), cu("MARKETING", "u3", 10_000)], moi: { loai: "NGOAI_PHAM_VI", thanhPhan: "MATERIAL" } })]);
    expect(b.expected.soDong).toBe(2);
    expect(Object.keys(b.expected.theoMa)).toEqual(["MATERIAL_OUT_OF_BASE"]);
    expect(b.unexpected.soDong).toBe(0);
  });

  it("[SBG-12] lệ phí thi / phí học bù (thành phần OTHER) ⇒ UNEXPECTED (04 §4.3 tự ghi «SUY… xác nhận ở Q9»); không rõ thành phần ⇒ UNEXPECTED", () => {
    const khac = bao([khoan({ cu: [cu("SALE", "u1", 40_000)], moi: { loai: "NGOAI_PHAM_VI", thanhPhan: "OTHER" } })]);
    const khongRo = bao([khoan({ cu: [cu("SALE", "u1", 40_000)], moi: { loai: "NGOAI_PHAM_VI", thanhPhan: "KHAC" } })]);
    expect(khac.unexpected.theoMa).toHaveProperty("THANH_PHAN_KHAC_CHUA_CHOT");
    expect(khongRo.unexpected.theoMa).toHaveProperty("NGOAI_PHAM_VI_KHONG_RO");
    expect(khac.expected.soDong + khongRo.expected.soDong).toBe(0);
  });
});

describe("[SBG-13] khoản GIU là hàng chờ, không phải chênh lệch", () => {
  it("[SBG-13] `lapThu` trả GIU ⇒ 0 dòng chênh, +1 hold, ghi số tiền cũ dự kiến — không hiện hai lần (một lỗ dữ liệu = một dòng báo)", () => {
    const b = bao([khoan({ cu: [cu("SALE", "u1", 400_000)], moi: { loai: "GIU", ma: "CHUA_GAN_CON", maLuat: null, mucDo: "SOFT" } })]);
    expect(b.dong).toHaveLength(0);
    expect(b.unexpected.soDong).toBe(0);
    expect(b.hold).toEqual({ tong: 1, khoanGiu: 1, treoCoHangCho: 0 });
    expect(b.chuaTinh).toMatchObject({ soKhoan: 1, tienCuDuKien: 400_000, soTienThu: 10_000_000 });
    expect(b.chuaTinh.theoMa.CHUA_GAN_CON).toMatchObject({ soKhoan: 1, mucDo: "SOFT" });
  });

  it("[SBG-13] vai TREO có hàng chờ (thiếu người) đếm vào hold; đối chứng: không có vai treo ⇒ hold 0", () => {
    const co = bao([khoan({ cu: [], dong: [moi("SALE", "u1", 400_000)], vai: [vai("SALE")], treo: [{ roleCode: "CENTER_MANAGER", lyDo: "CHUA_KHAI_NGUOI_PHU_TRACH" }] })]);
    const khong = bao([khoan({ cu: [cu("SALE", "u1", 400_000)], dong: [moi("SALE", "u1", 400_000)], vai: [vai("SALE")] })]);
    expect(co.hold).toEqual({ tong: 1, khoanGiu: 0, treoCoHangCho: 1 });
    expect(khong.hold.tong).toBe(0);
  });
});

describe("[SBG-14] lỗi cấu hình (vượt trần · chồng lấn) ⇒ UNEXPECTED kèm lý do", () => {
  it("[SBG-14] engine mới ghi 0 dòng vì VUOT_TRAN: mọi dòng cũ là UNEXPECTED với mã VUOT_TRAN", () => {
    const b = bao([khoan({ cu: [cu("SALE", "u1", 400_000), cu("MARKETING", "u3", 100_000)], moi: { loai: "LOI_CAU_HINH", ma: "VUOT_TRAN", lyDo: "Σ tỉ lệ 10% > trần 9%" } })]);
    expect(b.unexpected.soDong).toBe(2);
    expect(Object.keys(b.unexpected.theoMa)).toEqual(["VUOT_TRAN"]);
    expect(b.khoan.loiCauHinh).toBe(1);
  });

  it("[SBG-14] phía cũ rỗng vẫn phải HIỆN một dòng cấp khoản — lỗi cấu hình chặn cutover dù không có số tiền để so", () => {
    const b = bao([khoan({ cu: [], moi: { loai: "LOI_CAU_HINH", ma: "CHONG_LAN", lyDo: "hai rule cùng hạng" } })]);
    expect(b.unexpected.soDong).toBe(1);
    expect(b.dong[0]).toMatchObject({ roleCode: "-", ma: "CHONG_LAN" });
  });
});

describe("[SBG-15] GV Trial: phía cũ đi đường riêng ⇒ KHÔNG so theo khoản, nhưng KHÔNG giấu", () => {
  it("[SBG-15] dòng TRIAL_TEACHER của engine mới không vào EXPECTED/UNEXPECTED mà được đếm ở `ngoai.trialTeacher`", () => {
    const b = bao([khoan({ cu: [cu("SALE", "u1", 400_000)], dong: [moi("SALE", "u1", 400_000), moi("TRIAL_TEACHER", "g1", 100_000)], vai: [vai("SALE"), vai("TRIAL_TEACHER")] })]);
    expect(b.unexpected.soDong).toBe(0);
    expect(b.dong).toHaveLength(1);
    expect(b.ngoai.trialTeacher).toEqual({ soKhoan: 1, soDong: 1, soTien: 100_000 });
  });
});

describe("[SBG-16] tập EXPECTED ĐÓNG", () => {
  it("[SBG-16] mỗi mã EXPECTED có trích dẫn tài liệu không rỗng; mọi dòng EXPECTED mang đúng một mã trong tập", () => {
    for (const m of MA_EXPECTED) expect(TRICH_DAN[m].length).toBeGreaterThan(40);
    const b = bao([
      khoan({ id: "a", cu: [cu("MARKETING", "q1", 100_000)], dong: [moi("SOURCE_OWNER", "o1", 100_000)], vai: [vaiLoaiTru(), vaiChuNguon] }),
      khoan({ id: "b", cu: [cu("SALE", "u1", 40_000)], moi: { loai: "NGOAI_PHAM_VI", thanhPhan: "MATERIAL" } }),
    ]);
    for (const d of b.dong.filter((x) => x.loai === "EXPECTED_BUSINESS_DELTA")) expect(MA_EXPECTED as readonly string[]).toContain(d.ma);
  });

  it("[SBG-16] soSanhKhoan thuần: cùng đầu vào ⇒ cùng kết quả (không đồng hồ, không ngẫu nhiên)", () => {
    const k = khoan({ cu: [cu("MARKETING", "q1", 100_000)], dong: [], vai: [vaiLoaiTru()] });
    expect(soSanhKhoan(k)).toEqual(soSanhKhoan(k));
  });
});

describe("[SBG-HLM] hold của BỘ PHÂN LOẠI tách khỏi lỗi dữ liệu — chỉ hiển thị, không đổi cổng", () => {
  const giu = (id: string, maLuat: string | null, soTien = 10_000_000): KhoanSoBong => ({
    ...khoan({ id, cu: [cu("SALE", "u1", 400_000)], moi: { loai: "GIU", ma: "MANUAL_REVIEW_REQUIRED", maLuat, mucDo: "HARD" } }),
    soTienThu: soTien,
  });

  it("[SBG-HLM-01] đếm riêng PREVIOUS_PURCHASE_UNRESOLVED và BACKFILL_ORDER_TIME_UNVERIFIED theo maLuat; mã khác (CHUA_GAN_CON, KHONG_RA_HOC_VIEN, null) KHÔNG lọt vào", () => {
    const b = bao([
      giu("p1", "PREVIOUS_PURCHASE_UNRESOLVED", 3_000_000),
      giu("p2", "PREVIOUS_PURCHASE_UNRESOLVED", 2_000_000),
      giu("p3", "BACKFILL_ORDER_TIME_UNVERIFIED", 7_000_000),
      giu("p4", "KHONG_RA_HOC_VIEN"),
      giu("p5", "LICH_SU_MO_HO"),
      giu("p6", null),
    ]);
    expect(b.holdLichSuMua).toEqual({ lanMuaTruocChuaChot: { soKhoan: 2, soTienThu: 5_000_000 }, thuTuMuaChuaKiem: { soKhoan: 1, soTienThu: 7_000_000 } });
  });

  it("[SBG-HLM-02] CỔNG KHÔNG ĐỔI: hold.tong vẫn đếm đủ mọi khoản GIU (kể cả hai mã trên) — tách để hiển thị, KHÔNG trừ ra", () => {
    const b = bao([giu("p1", "PREVIOUS_PURCHASE_UNRESOLVED"), giu("p2", "BACKFILL_ORDER_TIME_UNVERIFIED"), giu("p3", "KHONG_RA_HOC_VIEN")]);
    expect(b.hold).toEqual({ tong: 3, khoanGiu: 3, treoCoHangCho: 0 });
    expect(b.chuaTinh.soKhoan).toBe(3);
  });

  it("[SBG-HLM-03] đối chứng dương: không có khoản GIU nào ⇒ hai số 0; và đổi mã luật của MỘT khoản đổi dấu vân (người xem phải xem lại)", () => {
    expect(bao([]).holdLichSuMua).toEqual({ lanMuaTruocChuaChot: { soKhoan: 0, soTienThu: 0 }, thuTuMuaChuaKiem: { soKhoan: 0, soTienThu: 0 } });
    expect(bao([giu("p1", "PREVIOUS_PURCHASE_UNRESOLVED")]).dauVan).not.toBe(bao([giu("p1", "BACKFILL_ORDER_TIME_UNVERIFIED")]).dauVan);
  });
});

describe("[SBG-18] phiên bản luật so bóng đi cùng bộ luật phân loại NEW/RENEWAL", () => {
  // BẢNG CẶP (bộ luật phân loại → phiên bản so bóng). Đổi `BO_LUAT_PHAN_LOAI` mà quên nâng `PHIEN_BAN_LUAT_SO_BONG` là lỗi CÂM: dấu vân vẫn đổi (nó băm cả bộ luật) nên không ca nào đỏ,
  // nhưng báo cáo tự khai «luật so bóng v1» trong khi chạy trên luật phân loại v2. Bảng này buộc hai số đi cùng nhau: đổi một bên là đỏ cho tới khi thêm cặp mới VÀ nâng bên kia.
  const CAP: readonly (readonly [string, string])[] = [
    ["2026-10-16.v2", "2026-10-16.v2"],
    ["2026-10-17.v3", "2026-10-17.v3"],
    ["2026-10-17.v4", "2026-10-17.v4"],
    ["2026-10-17.v5", "2026-10-17.v5"],
    // AFF-L2 (13/10/2026): bảng EXPECTED đổi (D-D, D-E) nhưng bộ luật phân loại vẫn v5 ⇒ HAI phiên bản so bóng cùng một bộ luật.
    ["2026-10-17.v5", "2026-10-26.v6"],
  ];

  it("[SBG-18] phiên bản so bóng hiện hành là dòng CUỐI của bảng, và dòng đó gắn ĐÚNG bộ luật phân loại hiện hành", () => {
    const cuoi = CAP[CAP.length - 1]!;
    expect(PHIEN_BAN_LUAT_SO_BONG, `PHIEN_BAN_LUAT_SO_BONG đã đổi: thêm cặp mới vào CUỐI bảng này`).toBe(cuoi[1]);
    expect(BO_LUAT_PHAN_LOAI, `BO_LUAT_PHAN_LOAI đã đổi sang "${BO_LUAT_PHAN_LOAI}": nâng PHIEN_BAN_LUAT_SO_BONG rồi thêm cặp vào bảng này`).toBe(cuoi[0]);
  });

  it("[SBG-18] mỗi phiên bản so bóng chỉ xuất hiện MỘT lần (không dùng lại số cũ); một bộ luật phân loại có thể có NHIỀU phiên bản so bóng (bảng EXPECTED đổi mà bộ luật phân loại không đổi), nhưng chúng LIỀN NHAU — bộ luật cũ không quay lại sau bộ luật mới", () => {
    expect(new Set(CAP.map(([, pb]) => pb)).size).toBe(CAP.length);
    const thuTu = CAP.map(([bo]) => bo);
    for (const [i, bo] of thuTu.entries()) if (i > 0 && bo !== thuTu[i - 1]) expect(thuTu.slice(0, i - 1), `bộ luật phân loại "${bo}" xuất hiện lại sau khi đã chuyển sang bộ khác`).not.toContain(bo);
  });
});
describe("[SBG-19] khoản mà bộ phân loại NEW/RENEWAL đặt ra ngoài phạm vi trong khi engine cũ đã trả", () => {
  const tach: KetQuaPhanBo = { loai: "TACH", orderItemId: "oi1", thanhPhan: "TUITION", cachTach: "DONG", studentId: "s1" };

  it("[SBG-19] bảng quyết định thành phần: học cụ · lệ phí khác · phân bổ ĐÃ cho qua mà vẫn BO_QUA ⇒ THEO_PHAN_LOAI · mọi trường hợp khác ⇒ KHAC (không đoán)", () => {
    expect(thanhPhanKhoanBoQua({ loai: "NGOAI_PHAM_VI", thanhPhan: "MATERIAL", cachTach: "DONG" }, "NGOAI_PHAM_VI")).toBe("MATERIAL");
    expect(thanhPhanKhoanBoQua({ loai: "NGOAI_PHAM_VI", thanhPhan: "OTHER", cachTach: "DONG" }, "NGOAI_PHAM_VI")).toBe("OTHER");
    expect(thanhPhanKhoanBoQua(tach, "NGOAI_PHAM_VI")).toBe("THEO_PHAN_LOAI");
    // phân bổ cho qua nhưng lý do loại KHÔNG phải ngoài phạm vi ⇒ không có căn cứ nói «do bộ phân loại»
    expect(thanhPhanKhoanBoQua(tach, "KHONG_PHAI_CHU")).toBe("KHAC");
    // phân bổ còn GIỮ thì lapThu đã trả GIU chứ không BO_QUA — gặp tổ hợp này là dữ liệu lạ, không nhận vơ
    expect(thanhPhanKhoanBoQua({ loai: "GIU", ma: "CHUA_GAN_CON", lyDo: "x" }, "NGOAI_PHAM_VI")).toBe("KHAC");
  });

  it("[SBG-19] cũ trả, bộ phân loại loại ra ngoài ⇒ UNEXPECTED mã LOAI_BO_THEO_LUAT_V2 (lý do nêu đúng gốc), KHÔNG phải NGOAI_PHAM_VI_KHONG_RO, và KHÔNG tự thành EXPECTED", () => {
    const b = bao([khoan({ cu: [cu("SALE", "u1", 400_000)], moi: { loai: "NGOAI_PHAM_VI", thanhPhan: "THEO_PHAN_LOAI" } })]);
    expect(b.unexpected.soDong).toBe(1);
    expect(b.expected.soDong).toBe(0);
    expect(b.dong[0]).toMatchObject({ loai: "UNEXPECTED", ma: "LOAI_BO_THEO_LUAT_V2", cu: 400_000, moi: 0 });
    expect(b.dong[0]!.lyDo).toContain("phân loại");
    expect(b.dong[0]!.lyDo).not.toContain("không xác định được thành phần");
    expect(b.unexpected.theoMa).not.toHaveProperty("NGOAI_PHAM_VI_KHONG_RO");
    // đối chứng: thành phần KHAC thật sự không rõ vẫn mang mã cũ — hai mã không bị gộp
    const khongRo = bao([khoan({ cu: [cu("SALE", "u1", 400_000)], moi: { loai: "NGOAI_PHAM_VI", thanhPhan: "KHAC" } })]);
    expect(khongRo.dong[0]).toMatchObject({ loai: "UNEXPECTED", ma: "NGOAI_PHAM_VI_KHONG_RO" });
  });

  it("[SBG-19] cũ KHÔNG trả gì (cùng nhận định «ngoài phạm vi») ⇒ không dòng chênh nào; khoản vẫn được đếm là ngoài phạm vi", () => {
    const b = bao([khoan({ cu: [], moi: { loai: "NGOAI_PHAM_VI", thanhPhan: "THEO_PHAN_LOAI" } })]);
    expect(b.dong).toHaveLength(0);
    expect(b.unexpected.soDong).toBe(0);
    expect(b.khoan.ngoaiPhamVi).toBe(1);
  });

  it("[SBG-19] mã mới có nhãn tiếng Việt riêng (không rơi về chính mã)", () => {
    expect(nhanMaSoBong("LOAI_BO_THEO_LUAT_V2")).not.toBe("LOAI_BO_THEO_LUAT_V2");
    expect(nhanMaSoBong("LOAI_BO_THEO_LUAT_V2").length).toBeGreaterThan(10);
  });
});

describe("[SBG-W1] tệp thuần không so mã nguồn, không đọc đồng hồ, không ghi", () => {
  const doc = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const MA_NGUON = ["PAID_ADS", "PARENT_REFERRAL", "EMPLOYEE_REFERRAL", "CENTER_ORGANIC", "WALK_IN", "UNKNOWN"];

  it("[SBG-W1] `so-bong.ts` không chứa mã nguồn nào (kể cả trong chuỗi), không `new Date()`/`Date.now()`", () => {
    const t = boChuThich(doc("lib/hoa-hong/so-bong.ts"));
    // Mã nguồn đứng MỘT MÌNH trong nháy (`"PAID_ADS"`) — không bắt tên mã lý do `MARKETING_REMOVED_UNKNOWN_SOURCE` có chứa chữ UNKNOWN.
    for (const m of MA_NGUON) expect(t, `mã nguồn ${m}`).not.toMatch(new RegExp(`["'\`]${m}["'\`]`));
    expect(t).not.toMatch(/new Date\(\)|Date\.now\(/);
  });
});
