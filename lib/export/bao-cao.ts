// lib/export/bao-cao.ts — năm đường xuất BÁO CÁO: công nợ · ghi danh · tài khoản · ma trận
// vai×quyền · buổi học.
//
// ─────────────────────────────────────────────────────────────────────────────
// KHÁC `nhap-lai.ts` Ở ĐÂU
//
// Bảy tệp ở `nhap-lai.ts` sinh ra để NHẬP LẠI, nên tiêu đề là khoá máy. Năm tệp ở đây sinh
// ra để ĐỌC và gửi đi (kế toán chốt tháng, giám đốc soát quyền), nên tiêu đề là **nhãn tiếng
// Việt** — không màn nhập nào ăn chúng, in khoá máy chỉ làm người đọc phải dịch.
//
// Cờ phân biệt là `tieuDeLaKhoa` trong `lib/export/bo-xuat.ts`. Một route phục vụ cả hai.
//
// ─────────────────────────────────────────────────────────────────────────────
// LUẬT 12b — ĐỌC SỐ CỦA MÀN, KHÔNG DỰNG LẠI
//
// Ba trong năm tệp gọi ĐÚNG hàm mà màn đang gọi:
//   · công nợ      → `getDebtRows` (`lib/finance/debt.ts`)
//   · vai × quyền  → `listRoles`   (`lib/auth/rbac-service.ts`)
//   · buổi học     → cùng `where`/`select` với `/sessions`
//
// Vì sao đây là luật chứ không phải sở thích: đã ba lần trong repo này một màn in con số
// khác màn khác cho cùng một ô. Với công nợ thì hậu quả là tệp gửi kế toán KHÁC số quản lý
// vừa duyệt trên màn — và hai bên không bao giờ gặp nhau để phát hiện.
//
// ⚠️ `getDebtRows` có hai phạm vi và màn /cong-no cố ý gọi CẢ HAI. Tệp này lấy phạm vi RỘNG
// (`keCaChuaChotGia: true`, không lọc `debt > 0`) — cùng phạm vi bảng đối soát, vì tệp phải
// hiện cả em đã đóng đủ (để người nhập biết đã xong) lẫn em chưa chốt giá (nhóm mà bộ lọc
// hẹp giấu mất hẳn). Đổi sang phạm vi hẹp là làm tệp mất đúng những dòng cần soát.
import type { Prisma } from "@prisma/client";
import type { scopedDb } from "@/lib/db-scope";
import { getDebtRows, overdueBucket } from "@/lib/finance/debt";
import { locDonDangBaoLuu } from "@/lib/bao-luu/dang-bao-luu-db";
import { listRoles } from "@/lib/auth/rbac-service";
import { roleLabel } from "@/lib/labels";
import { ngayNhapLai, type CotNhapLai, type KetQuaNap } from "./nhap-lai";

type ScopedDb = ReturnType<typeof scopedDb>;

const c = <T,>(x: CotNhapLai<T>): CotNhapLai<T> => x;

/** Ngày + giờ VN, cho bảng cần biết buổi lúc mấy giờ. */
function ngayGioVn(d: Date | null | undefined): string {
  if (!d) return "";
  const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(vn.getUTCDate())}/${p(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()} ${p(vn.getUTCHours())}:${p(vn.getUTCMinutes())}`;
}

const NHAN_QUA_HAN: Record<string, string> = {
  none: "Chưa tới hạn",
  "1-7": "Quá hạn 1–7 ngày",
  "8-30": "Quá hạn 8–30 ngày",
  ">30": "Quá hạn trên 30 ngày",
};

// ─────────────────────────────────────────────────────────────────────────────
// CÔNG NỢ HỌC PHÍ
type DongNo = {
  hocVien: string;
  khoa: string;
  hocPhi: number | string;
  daXacNhan: number;
  daGhiNhan: number;
  choXacNhan: number;
  conNo: number | string;
  chuaChotGia: boolean;
};

async function napCongNo(sdb: ScopedDb): Promise<KetQuaNap<DongNo>> {
  const rows = await getDebtRows(sdb as unknown as Parameters<typeof getDebtRows>[0], {
    keCaChuaChotGia: true,
  });

  const dong: DongNo[] = rows.map((r) => ({
    hocVien: r.studentName ?? "",
    khoa: r.courseName ?? "",
    // Ghi danh CHƯA chốt giá thì `finalPrice` VÔ NGHĨA (ghi chú ở `DongDoiSoat`). In số 0
    // vào đây là khai rằng học phí bằng không — người đọc sẽ tin, và nhóm này chính là
    // nhóm cần người xử lý.
    hocPhi: r.chuaChotGia ? "chưa chốt giá" : r.finalPrice,
    daXacNhan: r.confirmedPaid,
    daGhiNhan: r.recordedPaid,
    // Trục B trừ trục A = tiền Sale đã nhập mà kế toán chưa xác nhận. Đây là con số người
    // ta mở tệp để tìm, nên tính sẵn thay vì bắt họ trừ tay.
    choXacNhan: Math.max(0, r.recordedPaid - r.confirmedPaid),
    conNo: r.chuaChotGia ? "chưa xác định" : r.debt,
    chuaChotGia: r.chuaChotGia,
  }));

  // ── NHÓM TUỔI NỢ — ở BẢNG PHỤ, KHÔNG phải một cột trên mỗi dòng ─────────────
  //
  // ⚠️ Bản đầu của tệp này có cột "Tình trạng hạn" trên từng dòng ghi danh. SAI: hạn nằm
  // trên TỪNG ĐỢT trả góp (`OrderInstallment.dueDate`), và một ghi danh có thể có nhiều đợt
  // ở nhiều nhóm tuổi khác nhau — nên một nhóm cho cả dòng là bịa. `Enrollment` KHÔNG có
  // cột `dueDate` nào (tsc bắt được, may).
  //
  // Cách đúng là cách màn /cong-no đang làm: cộng tiền theo đợt PENDING rồi nhóm. Chép đúng
  // truy vấn đó để hai bên không lệch.
  const now = new Date();
  const donCoDot = await sdb.order.findMany({
    where: { installments: { some: { status: "PENDING" } } },
    select: {
      id: true,
      installments: { where: { status: "PENDING" }, select: { amount: true, dueDate: true } },
    },
  });
  // Phiên 1 bảo lưu: cùng luật với màn /cong-no — đơn mà MỌI bé đang bảo lưu thì không vào nhóm quá hạn.
  const donBaoLuu = await locDonDangBaoLuu(donCoDot.map((d) => d.id), now);
  const tongTheoNhom: Record<string, number> = { none: 0, "1-7": 0, "8-30": 0, ">30": 0 };
  for (const d of donCoDot) {
    for (const dot of d.installments) {
      tongTheoNhom[donBaoLuu.has(d.id) ? "none" : overdueBucket(dot.dueDate, now)] += dot.amount;
    }
  }

  return {
    dong,
    cot: [
      c<DongNo>({ khoa: "hocVien", nhan: "Học viên", lay: (r) => r.hocVien, rong: 26 }),
      c<DongNo>({ khoa: "khoa", nhan: "Khoá học", lay: (r) => r.khoa, rong: 26 }),
      c<DongNo>({ khoa: "hocPhi", nhan: "Học phí", lay: (r) => r.hocPhi, rong: 15 }),
      c<DongNo>({ khoa: "daXacNhan", nhan: "Đã thu (kế toán xác nhận)", lay: (r) => r.daXacNhan, rong: 20 }),
      c<DongNo>({ khoa: "daGhiNhan", nhan: "Đã ghi nhận (Sale nhập)", lay: (r) => r.daGhiNhan, rong: 20 }),
      c<DongNo>({ khoa: "choXacNhan", nhan: "Chờ kế toán xác nhận", lay: (r) => r.choXacNhan, rong: 18 }),
      c<DongNo>({ khoa: "conNo", nhan: "Còn nợ", lay: (r) => r.conNo, rong: 15 }),
    ],
    bangPhu: [
      {
        tieuDe: "Nhóm tuổi nợ quá hạn (tính theo TỪNG ĐỢT trả góp còn phải thu)",
        cot: ["Nhóm", "Tổng tiền"],
        dong: (["none", "1-7", "8-30", ">30"] as const).map((k) => [
          NHAN_QUA_HAN[k]!,
          tongTheoNhom[k]!,
        ]),
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GHI DANH
type DongGhiDanh = Prisma.EnrollmentGetPayload<{
  select: {
    status: true;
    enrolledAt: true;
    startedAt: true;
    finalPrice: true;
    student: { select: { name: true; studentCode: true; parentName: true } };
    class: {
      select: { name: true; classCode: true; center: { select: { name: true } } };
    };
  };
}>;

const NHAN_TT_GHI_DANH: Record<string, string> = {
  PENDING: "Chờ xác nhận",
  CONFIRMED: "Đã xác nhận",
  ACTIVE: "Đang học",
  STUDYING: "Đang học",
  PAUSED: "Bảo lưu",
  COMPLETED: "Hoàn thành",
  DROPPED: "Nghỉ học",
  TRANSFERRED: "Chuyển lớp",
  CANCELLED: "Huỷ",
};

async function napGhiDanh(sdb: ScopedDb): Promise<KetQuaNap<DongGhiDanh>> {
  const dong = await sdb.enrollment.findMany({
    // Cùng điều kiện với màn: `deletedAt` KHÔNG phải cờ "đã xoá" ở model này — nó là sổ
    // sách (xem memory `enrollment-deletedat-la-so-sach`). Lọc nó ra là tụt công nợ.
    where: { deletedAt: null },
    orderBy: [{ status: "asc" }, { enrolledAt: "desc" }],
    select: {
      status: true,
      enrolledAt: true,
      startedAt: true,
      finalPrice: true,
      student: { select: { name: true, studentCode: true, parentName: true } },
      class: { select: { name: true, classCode: true, center: { select: { name: true } } } },
    },
  });
  return {
    dong,
    cot: [
      c<DongGhiDanh>({ khoa: "maHS", nhan: "Mã HS", lay: (r) => r.student?.studentCode ?? "", chuoi: true, rong: 14 }),
      c<DongGhiDanh>({ khoa: "hocVien", nhan: "Học viên", lay: (r) => r.student?.name ?? "", rong: 26 }),
      c<DongGhiDanh>({ khoa: "phuHuynh", nhan: "Phụ huynh", lay: (r) => r.student?.parentName ?? "", rong: 24 }),
      c<DongGhiDanh>({ khoa: "maLop", nhan: "Mã lớp", lay: (r) => r.class?.classCode ?? "", chuoi: true, rong: 14 }),
      c<DongGhiDanh>({ khoa: "lop", nhan: "Lớp", lay: (r) => r.class?.name ?? "", rong: 26 }),
      c<DongGhiDanh>({ khoa: "coSo", nhan: "Cơ sở", lay: (r) => r.class?.center?.name ?? "", rong: 24 }),
      c<DongGhiDanh>({ khoa: "trangThai", nhan: "Trạng thái", lay: (r) => NHAN_TT_GHI_DANH[r.status] ?? r.status, rong: 16 }),
      c<DongGhiDanh>({ khoa: "hocPhi", nhan: "Học phí đã chốt", lay: (r) => r.finalPrice ?? "", rong: 16 }),
      c<DongGhiDanh>({ khoa: "ngayDangKy", nhan: "Ngày đăng ký", lay: (r) => ngayNhapLai(r.enrolledAt), rong: 13 }),
      c<DongGhiDanh>({ khoa: "ngayBatDau", nhan: "Ngày bắt đầu học", lay: (r) => ngayNhapLai(r.startedAt), rong: 15 }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TÀI KHOẢN ĐĂNG NHẬP
type DongTaiKhoan = Prisma.UserGetPayload<{
  include: {
    employee: { select: { fullName: true; employeeCode: true } };
    center: { select: { name: true } };
    _count: { select: { permissionGrants: true } };
  };
}>;

async function napTaiKhoan(sdb: ScopedDb): Promise<KetQuaNap<DongTaiKhoan>> {
  const dong = await sdb.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      employee: { select: { fullName: true, employeeCode: true } },
      center: { select: { name: true } },
      _count: { select: { permissionGrants: true } },
    },
  });
  return {
    dong,
    cot: [
      c<DongTaiKhoan>({ khoa: "ten", nhan: "Tên", lay: (r) => r.name ?? "", rong: 26 }),
      c<DongTaiKhoan>({ khoa: "email", nhan: "Email đăng nhập", lay: (r) => r.email ?? "", rong: 28 }),
      c<DongTaiKhoan>({ khoa: "sdt", nhan: "Số điện thoại", lay: (r) => r.phone ?? "", chuoi: true, rong: 14 }),
      // Vai = HỢP của `role` và `roles[]`, đúng luật của hệ (`User.roles[]` — quyền là union).
      // In riêng `role` là báo thiếu vai của mọi tài khoản đa vai.
      c<DongTaiKhoan>({
        khoa: "vaiTro",
        nhan: "Vai trò",
        lay: (r) => [...new Set([r.role, ...r.roles])].filter(Boolean).map(roleLabel).join(", "),
        rong: 32,
      }),
      c<DongTaiKhoan>({ khoa: "coSo", nhan: "Cơ sở", lay: (r) => r.center?.name ?? "", rong: 24 }),
      c<DongTaiKhoan>({ khoa: "nhanSu", nhan: "Hồ sơ nhân sự", lay: (r) => r.employee?.fullName ?? "", rong: 24 }),
      c<DongTaiKhoan>({ khoa: "maNV", nhan: "Mã NV", lay: (r) => r.employee?.employeeCode ?? "", chuoi: true, rong: 12 }),
      c<DongTaiKhoan>({ khoa: "dangHoatDong", nhan: "Đang hoạt động", lay: (r) => (r.isActive ? "Có" : "Không"), rong: 15 }),
      // ⚠️ Cột này đáng soát: `can()` v2 KHÔNG có nhánh DENY (CLAUDE.md), nên một grant
      // `DENY` bị bỏ qua IM LẶNG. Ai có grant riêng thì phải xem lại bằng tay.
      c<DongTaiKhoan>({ khoa: "soQuyenRieng", nhan: "Số quyền cấp riêng", lay: (r) => r._count.permissionGrants, rong: 18 }),
      c<DongTaiKhoan>({ khoa: "ngayTao", nhan: "Ngày tạo", lay: (r) => ngayNhapLai(r.createdAt), rong: 13 }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MA TRẬN VAI × QUYỀN
//
// Tệp này phục vụ đúng việc "ai được làm gì" — câu mà trước đây phải mở `seed-roles.ts` mới
// trả lời được, và mở sai chỗ thì trả lời sai (bẫy chú thích: `grep audit-logs` ra một dòng
// và nó là chú thích chứ không phải dòng khai quyền — CLAUDE.md).
//
// MỘT DÒNG = MỘT CẶP (vai, quyền). Không phải một dòng một vai với ô quyền dài: 15 vai ×
// hàng trăm quyền thì ô đó không đọc nổi và không lọc/pivot được trong Excel.
type DongQuyenVai = {
  maVai: string;
  tenVai: string;
  laVaiHeThong: boolean;
  soNguoiGiu: number;
  quyen: string;
  phamVi: string;
};

const NHAN_PHAM_VI: Record<string, string> = {
  GLOBAL: "Toàn hệ thống",
  CENTER: "Theo cơ sở",
  CLASS: "Theo lớp",
  OWN: "Của chính mình",
  CHILDREN: "Của con mình",
  ASSIGNED: "Được phân công",
};

async function napQuyenVai(): Promise<KetQuaNap<DongQuyenVai>> {
  // `listRoles` đọc `RoleDef` + `RolePermission` từ DB — tức nguồn mà RBAC v2 THỰC SỰ
  // enforce trên prod, không phải file seed. Đọc file seed là đọc ý định; đọc đây là đọc
  // hiện trạng.
  const vai = await listRoles();
  const dong: DongQuyenVai[] = vai.flatMap((v) =>
    // Vai KHÔNG có quyền nào vẫn phải ra MỘT dòng: "không có dòng" và "vai không quyền"
    // trông giống nhau trong tệp, mà chúng khác nhau hoàn toàn khi soát.
    (v.permissions.length > 0
      ? v.permissions
      : [{ action: "(chưa cấp quyền nào)", scopeType: "" }]
    ).map((p) => ({
      maVai: v.code,
      tenVai: v.name?.trim() || v.code,
      laVaiHeThong: v.isSystem,
      soNguoiGiu: v._count.userRoles,
      quyen: p.action,
      phamVi: NHAN_PHAM_VI[p.scopeType] ?? p.scopeType,
    })),
  );
  return {
    dong,
    cot: [
      c<DongQuyenVai>({ khoa: "maVai", nhan: "Mã vai", lay: (r) => r.maVai, chuoi: true, rong: 24 }),
      c<DongQuyenVai>({ khoa: "tenVai", nhan: "Tên vai", lay: (r) => r.tenVai, rong: 28 }),
      c<DongQuyenVai>({ khoa: "quyen", nhan: "Quyền", lay: (r) => r.quyen, rong: 34 }),
      c<DongQuyenVai>({ khoa: "phamVi", nhan: "Phạm vi", lay: (r) => r.phamVi, rong: 18 }),
      c<DongQuyenVai>({ khoa: "soNguoiGiu", nhan: "Số người đang giữ vai", lay: (r) => r.soNguoiGiu, rong: 20 }),
      c<DongQuyenVai>({ khoa: "vaiHeThong", nhan: "Vai hệ thống (không xoá được)", lay: (r) => (r.laVaiHeThong ? "Có" : ""), rong: 24 }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUỔI HỌC
type DongBuoi = Prisma.ClassSessionGetPayload<{
  select: {
    date: true;
    topic: true;
    status: true;
    class: { select: { name: true; classCode: true; center: { select: { name: true } } } };
    _count: { select: { attendances: true } };
  };
}>;

const NHAN_TT_BUOI: Record<string, string> = {
  SCHEDULED: "Chưa dạy",
  IN_PROGRESS: "Đang dạy",
  COMPLETED: "Đã dạy",
  CANCELLED: "Huỷ",
};

async function napBuoiHoc(sdb: ScopedDb): Promise<KetQuaNap<DongBuoi>> {
  const dong = await sdb.classSession.findMany({
    orderBy: { date: "desc" },
    select: {
      date: true,
      topic: true,
      status: true,
      class: { select: { name: true, classCode: true, center: { select: { name: true } } } },
      _count: { select: { attendances: true } },
    },
  });
  return {
    dong,
    cot: [
      // ⚠️ `ClassSession.date` là `@db.Timestamptz(6)` và MANG GIỜ THẬT — khác 9 model có
      // `date` là `@db.Date` (nửa đêm đúng). Khớp theo tên cột là sai; ở đây phải in cả
      // giờ, vì "buổi ngày 12/09" mà không giờ thì không biết là buổi chiều hay buổi tối.
      c<DongBuoi>({ khoa: "ngayGio", nhan: "Ngày và giờ buổi học", lay: (r) => ngayGioVn(r.date), rong: 20 }),
      c<DongBuoi>({ khoa: "maLop", nhan: "Mã lớp", lay: (r) => r.class?.classCode ?? "", chuoi: true, rong: 14 }),
      c<DongBuoi>({ khoa: "lop", nhan: "Lớp", lay: (r) => r.class?.name ?? "", rong: 26 }),
      c<DongBuoi>({ khoa: "coSo", nhan: "Cơ sở", lay: (r) => r.class?.center?.name ?? "", rong: 24 }),
      c<DongBuoi>({ khoa: "noiDung", nhan: "Nội dung buổi", lay: (r) => r.topic ?? "", rong: 34 }),
      c<DongBuoi>({ khoa: "trangThai", nhan: "Trạng thái", lay: (r) => NHAN_TT_BUOI[r.status] ?? r.status, rong: 14 }),
      // Đây là SỐ DÒNG điểm danh đã ghi, KHÔNG phải số em có mặt. Nhãn phải nói đúng thế —
      // "sĩ số" ở đây là một lời hứa sai (luật 12).
      c<DongBuoi>({ khoa: "soLuotDiemDanh", nhan: "Số lượt điểm danh đã ghi", lay: (r) => r._count.attendances, rong: 22 }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
export const BO_NAP_BAO_CAO: Record<string, (sdb: ScopedDb) => Promise<KetQuaNap<never>>> = {
  "cong-no": napCongNo as never,
  "ghi-danh": napGhiDanh as never,
  "tai-khoan": napTaiKhoan as never,
  "quyen-vai": napQuyenVai as never,
  "buoi-hoc": napBuoiHoc as never,
};

export const MA_BAO_CAO = Object.keys(BO_NAP_BAO_CAO);
