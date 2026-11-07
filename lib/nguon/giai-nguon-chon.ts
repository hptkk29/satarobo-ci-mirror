/**
 * lib/nguon/giai-nguon-chon.ts — GIẢI lựa chọn thô của ô chọn nguồn (PR7) thành `NguonChonDaGiai` cho resolver. THUẦN.
 *
 * Tầng đọc (`thu-thap-tin-hieu`) tra DB (nhóm, nhân sự + vai, học viên, phụ huynh, đối tác) rồi đưa kết quả TRA vào đây; hàm này chỉ
 * quyết định — nên test mọi nhánh không cần Postgres.
 *
 * ── Quy tắc (03 §2.8, D5, D13) ───────────────────────────────────────────────────────────────────────────────
 *  1. Nhóm người nhập bấm phải còn chọn được (ACTIVE ∧ selectable) — UNKNOWN không bao giờ lọt qua đây.
 *  2. Nhóm GHI = nhóm người nhập CHỌN RÕ, KỂ CẢ nhóm do admin tạo có yêu cầu NHÂN SỰ (SPEC nguồn động §2 V1). Vai của nhân sự chỉ là ẢNH CHỤP
 *     (`anhChup.referrerRoleCode`) — KHÔNG chọn nhóm: bản cũ ghi đè mọi nhóm kiểu nhân sự về nhóm cố định theo vai, nên chính sách riêng
 *     của nguồn do admin tạo không bao giờ áp dụng.
 *  3. Nhân sự chỉ ACTIVE/ON_LEAVE (D13: người đã nghỉ không được claim MỚI).
 *  4. Người/giải trình kiểm bằng ĐÚNG `kiemThamChieu`/`kiemGiaiTrinh` mà đường đổi nguồn dùng — một câu lỗi cho cả hai đường.
 *  5. Người được chọn phải TỒN TẠI: FK `referrer*` là Restrict, một id không có thật làm `lead.create` nổ và MẤT KHÁCH (T4).
 *
 * Không ném: mọi lỗi nằm ở `loi` (chuỗi tiếng Việt cho người nhập). `loi` ≠ null ⇒ đường nhập CHẶN trước transaction.
 */
import { suyVaiNguon, type DongVaiSangNguon } from "./danh-muc-goc";
import { kiemGiaiTrinh, kiemThamChieu, type ThamChieuNguon } from "./kiem-nguon";
import { ANH_CHUP_TRONG, type AnhChupNguon, type NguoiGioiThieu, type NguonChonDaGiai, type NguonChonDauVao, type ThuocTinhNhom } from "./tin-hieu";

export type NhomTraCuu = ThuocTinhNhom & { id: string };

export type TraCuuNguoiChon = {
  /** Nhân sự theo `employeeId` — null nếu không có; `roleCodes` là vai hiệu lực. */
  nhanSu: { status: string; roleCodes: readonly string[]; employeeCode?: string | null; orgUnitId?: string | null } | null;
  /** Học viên (`studentId`) có tồn tại, chưa xoá. */
  hocVienCo: boolean;
  /** User phụ huynh (`parentUserId`) có tồn tại, chưa xoá. */
  phuHuynhCo: boolean;
  /** Đối tác có tồn tại và đang hoạt động. */
  doiTacCo: boolean;
  /** Sale phụ trách của phụ huynh được chọn (ĐÃ tra ở tầng đọc, tại thời điểm ghi); null = không tìm được. BẮT BUỘC khai (luật 7). */
  saleCuaPhuHuynh: string | null;
};

const gon = (v: string | null | undefined): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

const LOI_NHOM = "Nguồn đã chọn không còn dùng được — hãy chọn lại.";

export function giaiNguonChon(p: {
  chon: NguonChonDauVao;
  nhomTheoId: ReadonlyMap<string, NhomTraCuu>;
  vaiSangNguon: readonly DongVaiSangNguon[];
  tra: TraCuuNguoiChon;
}): NguonChonDaGiai {
  const { chon, tra } = p;
  const ref: ThamChieuNguon = {
    employeeId: gon(chon.employeeId),
    parentUserId: gon(chon.parentUserId),
    studentId: gon(chon.studentId),
    affiliateId: gon(chon.affiliateId),
  };
  const loiKhong = (code: string, loi: string): NguonChonDaGiai => ({ groupCode: code, nguoi: null, giaiTrinh: null, loi, anhChup: ANH_CHUP_TRONG });

  // 1. Nhóm đã bấm.
  const bam = p.nhomTheoId.get(chon.groupId);
  if (!bam || !bam.active || !bam.selectable) return loiKhong(bam?.code ?? "", LOI_NHOM);

  // 2–3. Nhóm GHI = nhóm đã chọn (không ghi đè theo vai). Nhân sự chỉ ACTIVE/ON_LEAVE (D13).
  const ghi = bam;
  if (ref.employeeId && bam.referrerRequirement === "EMPLOYEE") {
    const ns = tra.nhanSu;
    if (!ns || (ns.status !== "ACTIVE" && ns.status !== "ON_LEAVE")) return loiKhong(bam.code, "Nhân sự giới thiệu không còn làm việc hoặc không tồn tại.");
  }

  // 4. Người + giải trình — cùng luật với đường đổi nguồn.
  const gt = gon(chon.giaiTrinh);
  const loiNguoi = kiemThamChieu(ghi, ref);
  if (loiNguoi) return loiKhong(ghi.code, loiNguoi);
  const loiGiaiTrinh = kiemGiaiTrinh(ghi, gt);
  if (loiGiaiTrinh) return loiKhong(ghi.code, loiGiaiTrinh);

  // 5. Người phải TỒN TẠI (FK Restrict) + ẢNH CHỤP.
  let nguoi: NguoiGioiThieu | null = null;
  let anhChup: AnhChupNguon = ANH_CHUP_TRONG;
  if (ref.employeeId) {
    if (!tra.nhanSu) return loiKhong(ghi.code, "Nhân sự giới thiệu không còn làm việc hoặc không tồn tại.");
    nguoi = { kind: "EMPLOYEE", employeeId: ref.employeeId };
    anhChup = {
      referrerRoleCode: suyVaiNguon(tra.nhanSu.roleCodes, p.vaiSangNguon),
      referrerSaleUserId: null,
      nguoiGioiThieu: { employeeCode: tra.nhanSu.employeeCode ?? null, roleCodes: [...tra.nhanSu.roleCodes], orgUnitId: tra.nhanSu.orgUnitId ?? null },
      nguon: null,
    };
  } else if (ref.parentUserId || ref.studentId) {
    if ((ref.studentId && !tra.hocVienCo) || (ref.parentUserId && !tra.phuHuynhCo)) return loiKhong(ghi.code, "Phụ huynh giới thiệu không tồn tại.");
    nguoi = { kind: "PARENT", parentUserId: ref.parentUserId, studentId: ref.studentId };
    anhChup = { referrerRoleCode: null, referrerSaleUserId: tra.saleCuaPhuHuynh, nguoiGioiThieu: null, nguon: null };
  } else if (ref.affiliateId) {
    if (!tra.doiTacCo) return loiKhong(ghi.code, "Đối tác giới thiệu không tồn tại hoặc đã tắt.");
    nguoi = { kind: "AFFILIATE", affiliateId: ref.affiliateId };
  }

  return { groupCode: ghi.code, nguoi, giaiTrinh: ghi.requiresNote ? gt : null, loi: null, anhChup };
}
