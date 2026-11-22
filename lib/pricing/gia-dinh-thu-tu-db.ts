import "server-only";
// lib/pricing/gia-dinh-thu-tu-db.ts — ĐỌC dữ liệu gia đình + lịch sử mua từ DB để nuôi `gia-dinh-thu-tu.ts`. CHỈ ĐỌC, không ghi gì. CHƯA NỐI (`[GDT-PIN]`).
//
// Tệp này CHỈ gom DỮ KIỆN. Mọi quyết định (ai cùng gia đình, ai trước ai, ai "đang học") nằm ở phần thuần — để test được không cần DB và để câu hỏi mở
// (ngày tạo đơn hay ngày tiền về, "đang học" hay "từng học") chỉ có một chỗ phải đổi.
//
// GIỚI HẠN ĐÃ BIẾT (đừng coi là đã bao quát):
//  · Trùng SĐT chỉ so các BIẾN THỂ định dạng (0… / 84… / +84…) qua `expandPhoneVariants`. SĐT lưu có dấu cách / dấu chấm ("0905 123 456") không khớp được bằng
//    câu `in` — phần dư đó thuộc về bước "chuẩn hoá SĐT" đã huỷ khỏi kế hoạch (CLAUDE.md) cho tới khi đo được dòng thật.
//  · `soBuoi` của lần mua lấy từ `OrderItem.metadata` (`phamVi.soBuoiMua` rồi `soBuoi`). Dòng không có ⇒ `null` ⇒ phần thuần xếp vào hàng chờ khi cần biết 48 buổi.
//  · "Ngày tiền về" lấy từ `Payment.paidDate` của các khoản ĐÃ GHI NHẬN (`KHOAN_DA_GHI_NHAN`: không tính khoản bị kế toán từ chối; khoản đang chờ kế toán VẪN tính).
//    Chọn trục "đã ghi nhận" hay "đã xác nhận" là một phần của câu hỏi mở D2 — không phải quyết định của tệp này.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { canonicalPhone, expandPhoneVariants } from "@/lib/phone";
import { docPhamViDong } from "@/lib/orders/pham-vi/doc-dong";
import type { CuaSoHieuLuc } from "./hieu-luc-chinh-sach";
import {
  phanLoaiDangHocTuTruoc,
  type ConTrongGiaDinh,
  type DauVaoXacDinhGiaDinh,
  type HocVienGiaDinh,
  type LanMuaLichSu,
} from "./gia-dinh-thu-tu";

type Client = Prisma.TransactionClient | typeof db;

/**
 * Mọi dạng một SĐT có thể đang nằm trong hồ sơ để tra bằng `in`: `84…`, `0…` (từ `expandPhoneVariants`) và thêm `+84…` — dạng hay gặp khi nhập tay /
 * dán từ Zalo. Thêm ở ĐÂY (chỉ cho việc nhận diện gia đình) thay vì sửa `phoneVariants`, vì hàm đó được 30+ chỗ gọi để GHI/tra dữ liệu chuẩn.
 */
const bienTheSdt = (raws: readonly unknown[]): string[] => [
  ...new Set([...expandPhoneVariants(raws), ...raws.map((r) => canonicalPhone(r)).filter((c): c is string => c !== null).map((c) => `+${c}`)]),
];

const HOC_VIEN_SELECT = { id: true, parentUserId: true, parentPhone: true, parent2Phone: true } as const;
const toHocVien = (s: { id: string; parentUserId: string | null; parentPhone: string | null; parent2Phone: string | null }): HocVienGiaDinh => ({
  studentId: s.id,
  parentUserId: s.parentUserId,
  parentPhone: s.parentPhone,
  parent2Phone: s.parent2Phone,
});

/** Dữ kiện nhận diện gia đình của một học viên. `null` = không có học viên (hoặc đã xoá mềm). */
export async function docDauVaoGiaDinh(studentId: string, client: Client = db): Promise<DauVaoXacDinhGiaDinh | null> {
  const hv = await client.student.findFirst({ where: { id: studentId, deletedAt: null }, select: HOC_VIEN_SELECT });
  if (!hv) return null;
  const hocVien = toHocVien(hv);
  if (hocVien.parentUserId === null) {
    return { hocVien, hoSo: null, cacConCungHoSo: [], hocVienKhacHoSoCungSdt: [], hoSoKhacCungSdt: [] };
  }
  const pid = hocVien.parentUserId;

  const [user, conCungHoSo] = await Promise.all([
    client.user.findFirst({ where: { id: pid, deletedAt: null, OR: [{ role: "PARENT" }, { roles: { has: "PARENT" } }] }, select: { id: true, phone: true } }),
    client.student.findMany({ where: { parentUserId: pid, deletedAt: null }, select: HOC_VIEN_SELECT, orderBy: { id: "asc" } }),
  ]);
  const hoSo = user ? { userId: user.id, phone: user.phone } : null;
  const cacConCungHoSo = conCungHoSo.map(toHocVien);

  // Mọi SĐT của gia đình: tài khoản + SĐT phụ huynh trên hồ sơ các con.
  const sdt = bienTheSdt([hoSo?.phone, ...cacConCungHoSo.flatMap((h) => [h.parentPhone, h.parent2Phone])]);
  if (sdt.length === 0) return { hocVien, hoSo, cacConCungHoSo, hocVienKhacHoSoCungSdt: [], hoSoKhacCungSdt: [] };

  const [khacHv, khacHoSo] = await Promise.all([
    client.student.findMany({
      where: { deletedAt: null, OR: [{ parentUserId: null }, { parentUserId: { not: pid } }], AND: [{ OR: [{ parentPhone: { in: sdt } }, { parent2Phone: { in: sdt } }] }] },
      select: HOC_VIEN_SELECT,
      orderBy: { id: "asc" },
    }),
    client.user.findMany({
      where: { deletedAt: null, id: { not: pid }, phone: { in: sdt }, OR: [{ role: "PARENT" }, { roles: { has: "PARENT" } }] },
      select: { id: true, phone: true },
      orderBy: { id: "asc" },
    }),
  ]);
  return {
    hocVien,
    hoSo,
    cacConCungHoSo,
    hocVienKhacHoSoCungSdt: khacHv.map(toHocVien),
    hoSoKhacCungSdt: khacHoSo.map((u) => ({ userId: u.id, phone: u.phone })),
  };
}

function soBuoiCuaDong(metadata: unknown): number | null {
  const pv = docPhamViDong(metadata);
  if (pv) return pv.soBuoiMua;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const v = (metadata as Record<string, unknown>).soBuoi;
    if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  }
  return null;
}

export interface LichSuGiaDinh {
  readonly lichSu: readonly LanMuaLichSu[];
  readonly cacCon: readonly ConTrongGiaDinh[];
}

/**
 * Lịch sử mua + danh sách con (kèm "đang học từ trước") của một gia đình. `orderIdDangXet` bị LOẠI khỏi lịch sử (mọi dòng của đơn đang xét đi vào `cungDon` của
 * phần thuần). Chỉ đơn chưa xoá mềm; đơn `CANCELLED`/`REFUNDED` vẫn trả về nhưng `conHieuLuc=false` để phần thuần quyết (không lọc ngầm ở đây).
 */
export async function docLichSuGiaDinh(
  vao: { readonly hocVienIds: readonly string[]; readonly sdtGiaDinh: readonly (string | null | undefined)[]; readonly orderIdDangXet: string; readonly cuaSo: CuaSoHieuLuc },
  client: Client = db,
): Promise<LichSuGiaDinh> {
  const sdt = bienTheSdt(vao.sdtGiaDinh);
  const don = await client.order.findMany({
    where: {
      deletedAt: null,
      id: { not: vao.orderIdDangXet },
      OR: [{ items: { some: { studentId: { in: [...vao.hocVienIds] } } } }, ...(sdt.length > 0 ? [{ customerPhone: { in: sdt } }] : [])],
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      items: { where: { type: "COURSE_ENROLLMENT" }, select: { id: true, studentId: true, metadata: true } },
      installments: { select: { id: true } },
      payments: { where: KHOAN_DA_GHI_NHAN, select: { paidDate: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const lichSu: LanMuaLichSu[] = [];
  const muaTrongDot = new Set<string>();
  for (const o of don) {
    const ngayTienVe = o.payments.map((p) => p.paidDate);
    const conHieuLuc = o.status !== "CANCELLED" && o.status !== "REFUNDED";
    for (const it of o.items) {
      lichSu.push({
        orderItemId: it.id,
        orderId: o.id,
        studentId: it.studentId,
        soBuoi: soBuoiCuaDong(it.metadata),
        // Đơn có kế hoạch nhiều đợt (mô hình cũ) KHÔNG phải "thanh toán trọn gói trong 01 lần" (SR.QD.233 Đ3.2).
        traGopNhieuDot: o.installments.length > 1,
        conHieuLuc,
        taoLuc: o.createdAt,
        ngayTienVe,
      });
      if (conHieuLuc && it.studentId && o.createdAt >= vao.cuaSo.tu && o.createdAt < vao.cuaSo.den) muaTrongDot.add(it.studentId);
    }
  }

  const ghiDanh = await client.enrollment.findMany({
    where: { studentId: { in: [...vao.hocVienIds] }, deletedAt: null },
    select: { studentId: true, status: true, createdAt: true },
  });
  const cacCon: ConTrongGiaDinh[] = vao.hocVienIds.map((studentId) => ({
    studentId,
    dangHocTuTruoc: phanLoaiDangHocTuTruoc(
      ghiDanh.filter((g) => g.studentId === studentId),
      muaTrongDot.has(studentId),
      vao.cuaSo,
    ),
  }));
  return { lichSu, cacCon };
}
