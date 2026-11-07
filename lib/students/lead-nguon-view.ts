// lib/students/lead-nguon-view.ts — DỰNG khối "Lead nguồn" của hồ sơ học viên từ bản ghi
// lead ĐÃ QUA CỔNG (25/09/2026). THUẦN: không DB, không next-auth ⇒ test dựng tay được.
//
// Đây là NƠI DUY NHẤT dữ liệu lead được che trước khi rời server cho màn học viên. Tầng
// đọc (`lib/students/lead-nguon.ts`) chỉ lo "được đọc phiếu nào"; còn "đọc được TỚI ĐÂU"
// nằm ở đây, để luật che nằm một chỗ và test gọi hàm được.
//
// LUẬT CHE — chép đúng trang lead (`app/(admin)/admin/leads/[id]/page.tsx`), không nới:
//   · Tên PH / SĐT / ghi chú đi qua `maskLeadPiiFields` — tầng che DUY NHẤT của S-1
//     (lưới `lib/lead/lead-pii-callsites.test.ts` ghim file này trong MAN_ADMIN).
//   · `maskLeadPiiFields` KHÔNG phủ tên CON (`LeadChild.fullName`) — trang lead che tay
//     bằng `maskPersonName` (page.tsx: `fullName: canViewPii ? c.fullName : maskPersonName(…)`).
//     Ở đây cũng che tay y hệt.
//   · Link Facebook: KHÔNG đưa ra khối này (kiểu `LeadNguonChiTiet` không có ô đó). Muốn
//     xem thì mở phiếu lead — trang lead tự gác bằng `canViewPii`.
//   · Ghi chú: chỉ phần NGƯỜI gõ (`splitLeadNote(...).human`) — dòng máy ghi (mã NV,
//     cảnh báo chia lead) là chẩn đoán vận hành, trang lead gác sau `leads:view-all`, ở
//     màn học viên thì không cần tới.
//   · "Người nhập lead" chỉ điền khi người xem có `leads:view-all` — cùng luật trang lead.
import type { LeadStatus } from "@prisma/client";
import { maskLeadPiiFields, maskPersonName } from "@/lib/lead/pii";
import { splitLeadNote } from "@/lib/lead/note-view";
import {
  LEAD_OUTREACH_TYPES,
  lastLeadOutreachAt,
  type LeadActivityLike,
} from "@/lib/lead/activity-clock";
import { LEAD_STATUS_LABEL } from "@/lib/leads/status";
import { formatPhoneVN } from "@/lib/phone";
import { maskPhone } from "@/lib/utils";
import { nhanNguoiNhapLead, type PhanDien } from "./dien-tu-lead";
import type { LeadGoiY, LeadNguonChiTiet } from "./lead-nguon-types";

/** Đủ cột của một phiếu lead để dựng khối chi tiết — đúng `select` của tầng đọc. */
export type LeadThoChiTiet = {
  id: string;
  parentName: string;
  /** `Lead.phone` có thể là chuỗi RỖNG (lead FB chưa có số) — xem schema. */
  phone: string;
  status: LeadStatus;
  source: string | null;
  note: string | null;
  createdAt: Date;
  course: { name: string } | null;
  center: { name: string } | null;
  assignedTo: { name: string | null } | null;
  affiliate: { name: string; code: string } | null;
};

/** Đủ cột của một phiếu lead để dựng một dòng GỢI Ý gắn. */
export type LeadThoGoiY = {
  id: string;
  parentName: string;
  phone: string;
  status: LeadStatus;
  createdAt: Date;
  center: { name: string } | null;
  assignedTo: { name: string | null } | null;
  children: { id: string; fullName: string }[];
};

/** SĐT để hiển thị: dạng nội địa `0…` rồi mới che (che dạng `84…` ra chuỗi khó đọc). */
function sdtHienThi(phone: string): string | null {
  const t = phone.trim();
  return t ? formatPhoneVN(t) : null;
}

function tenCon(fullName: string, canViewPii: boolean): string {
  return canViewPii ? fullName : maskPersonName(fullName);
}

/**
 * MỘT lời gọi `maskLeadPiiFields` cho cả hai hàm dựng bên dưới — cố ý gom về một chỗ:
 * lưới S-1 đếm LỜI GỌI, và hai lời gọi rải hai nơi thì gỡ một cái lưới vẫn xanh.
 */
function cheLead(
  v: { parentName: string; phone: string; note: string | null },
  canViewPii: boolean,
  sdtHocVienBiChe: boolean,
): { tenPhuHuynh: string; sdt: string | null; ghiChu: string | null } {
  const che = maskLeadPiiFields(
    { parentName: v.parentName, phone: sdtHienThi(v.phone), note: v.note },
    canViewPii,
  );
  // SĐT phụ huynh của HỌC VIÊN đang bị che theo quyền cấp trường (US-03, fieldMask
  // `parentPhone` của `students:view-all`) ⇒ SĐT của LEAD cũng phải che trên màn này: hai số
  // thường là MỘT (lead nguồn của chính gia đình đó), in số lead ra là mở đúng cái vừa che
  // ở ô SĐT ngay bên cạnh. Lượt rà đối kháng 25/09 bắt được.
  const sdt = che.phone ? (sdtHocVienBiChe ? maskPhone(che.phone) : che.phone) : null;
  return { tenPhuHuynh: che.parentName, sdt, ghiChu: che.note ?? null };
}

/**
 * Dựng `LeadNguonChiTiet` — mọi chuỗi ra khỏi đây đã được che theo quyền người xem.
 *
 * Tham số QUYỀN (`canViewPii`, `canViewAll`) cố ý BẮT BUỘC, không mặc định (luật 7): quên
 * truyền phải là lỗi biên dịch chứ không phải một màn lộ PII.
 */
export function dungLeadNguonChiTiet(input: {
  lead: LeadThoChiTiet;
  /** Người nhập phiếu (`Lead.createdById` → User). `null` = không tra/không có. */
  nguoiNhap: { name: string | null; employeeCode: string | null } | null;
  /** Tên khoá quan tâm của ĐỨA CON (không FK — chỗ gọi tra theo id). Dùng khi lead chưa có khoá. */
  khoaQuanTamCuaCon: string | null;
  /** Hoạt động của phiếu — hàm tự lọc dòng MÁY ghi (D4: tương tác gần nhất do NGƯỜI làm). */
  hoatDong: readonly LeadActivityLike[];
  con: { id: string; fullName: string; tenLop: string | null } | null;
  canViewPii: boolean;
  canViewAll: boolean;
  /** SĐT phụ huynh trên hồ sơ HV đang bị che cho người xem ⇒ che luôn SĐT lead. BẮT BUỘC. */
  sdtHocVienBiChe: boolean;
}): LeadNguonChiTiet {
  const { lead, canViewPii, canViewAll } = input;

  // Tách phần NGƯỜI gõ trên chuỗi THÔ rồi mới che — giống hệt trang lead, để phần máy ghi
  // không bao giờ lọt ra màn này và phần người gõ vẫn che đúng luật PII.
  const che = cheLead(
    { parentName: lead.parentName, phone: lead.phone, note: splitLeadNote(lead.note).human },
    canViewPii,
    input.sdtHocVienBiChe,
  );

  const tuongTac = lastLeadOutreachAt(input.hoatDong, LEAD_OUTREACH_TYPES);

  return {
    leadId: lead.id,
    href: `/leads/${lead.id}`,
    tenPhuHuynh: che.tenPhuHuynh,
    sdt: che.sdt,
    trangThai: LEAD_STATUS_LABEL[lead.status] ?? lead.status,
    nguon: lead.source?.trim() || null,
    // Cổng kép có chủ đích: tầng đọc KHÔNG tra người nhập khi thiếu `leads:view-all`,
    // và hàm này cũng không in dù có được đưa vào — một chỗ quên không làm lộ.
    nguoiNhap:
      canViewAll && input.nguoiNhap
        ? nhanNguoiNhapLead(input.nguoiNhap.employeeCode, input.nguoiNhap.name)
        : null,
    hienNguoiNhap: canViewAll,
    khoaQuanTam: lead.course?.name ?? input.khoaQuanTamCuaCon ?? null,
    ngayNhanLead: lead.createdAt.toISOString(),
    tuongTacGanNhat: tuongTac ? tuongTac.toISOString() : null,
    salePhuTrach: lead.assignedTo?.name ?? null,
    coSo: lead.center?.name ?? null,
    nguoiGioiThieu: lead.affiliate ? `${lead.affiliate.name} (${lead.affiliate.code})` : null,
    ghiChu: che.ghiChu,
    con: input.con
      ? {
          id: input.con.id,
          ten: tenCon(input.con.fullName, canViewPii),
          lopTaiTrungTam: input.con.tenLop,
        }
      : null,
  };
}

/** Dựng một dòng gợi ý gắn — cùng luật che với khối chi tiết. */
export function dungLeadGoiY(input: {
  lead: LeadThoGoiY;
  lyDo: LeadGoiY["lyDo"];
  canViewPii: boolean;
  /** Như `dungLeadNguonChiTiet` — BẮT BUỘC. */
  sdtHocVienBiChe: boolean;
}): LeadGoiY {
  const { lead, canViewPii } = input;
  // Gợi ý KHÔNG có ghi chú — `note: null` để cùng đi qua một cửa che.
  const che = cheLead(
    { parentName: lead.parentName, phone: lead.phone, note: null },
    canViewPii,
    input.sdtHocVienBiChe,
  );
  return {
    leadId: lead.id,
    tenPhuHuynh: che.tenPhuHuynh,
    sdt: che.sdt,
    trangThai: LEAD_STATUS_LABEL[lead.status] ?? lead.status,
    ngayNhanLead: lead.createdAt.toISOString(),
    salePhuTrach: lead.assignedTo?.name ?? null,
    coSo: lead.center?.name ?? null,
    lyDo: input.lyDo,
    cacCon: lead.children.map((c) => ({ id: c.id, ten: tenCon(c.fullName, canViewPii) })),
  };
}

/**
 * Các ô PII trong phần điền-từ-lead (`dienTuLead`). Trang lead GIẤU các ô tương ứng với
 * người thiếu `leads:view-pii` (ngày sinh + trường của con: `dob`/`schoolName` truyền
 * `null`; email/ngày sinh PH qua `maskLeadPiiFields`; link FB che "•••").
 */
const O_PII_KHI_DIEN = [
  "dateOfBirth",
  "school",
  "parentEmail",
  "parentDob",
  "parentFacebookUrl",
] as const satisfies readonly (keyof PhanDien)[];

/**
 * Nút "Gắn lead" do NGƯỜI bấm: người thiếu `leads:view-pii` KHÔNG được chép PII từ phiếu
 * sang hồ sơ học viên — chép xong là đọc được nó ở màn học viên, nơi không có tầng che
 * của lead, tức một đường vòng qua quyền. Bỏ các ô PII, giữ các ô còn lại (giới tính,
 * lớp, địa chỉ — trang lead không coi là PII).
 *
 * Đường convert/backfill (máy, không có người xem) KHÔNG đi qua hàm này.
 */
export function locPhanDienTheoQuyen(phan: PhanDien, canViewPii: boolean): PhanDien {
  if (canViewPii) return phan;
  const out: PhanDien = { ...phan };
  for (const k of O_PII_KHI_DIEN) delete out[k];
  return out;
}
