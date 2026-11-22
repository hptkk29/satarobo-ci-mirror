import "server-only";
import { db } from "@/lib/db";
import { maLoiAnToan } from "./crm";
import { luuThanhVien, taoSo } from "./so-gia-dinh/ghi";
import { keHoachSauNhan, type HienCo, type KeHoach } from "./thong-tin-sau-nhan";

/**
 * Chạy SAU KHI nhận bài (xem `thong-tin-sau-nhan.ts` — vì sao KHÔNG tạo học viên): đặt tên tài khoản, thêm bé vào phiếu khách (`LeadChild`),
 * dựng Sổ gia đình có chủ sổ + bé. Mỗi bước độc lập, không ném (việc nhận đã xong; thiếu một bước còn hơn làm hỏng nhận) và IDEMPOTENT: chạy lại
 * (nhận thêm bài thứ hai của cùng người) không nhân đôi gì.
 *
 * LOG: chỉ MÃ lỗi (`maLoiAnToan`), không bao giờ tên người/bé — lỗi Prisma hay mang giá trị cột.
 */
export type KetQuaSauNhan = {
  readonly boQua: "KHONG_DUOC_NHAN" | null;
  readonly datTen: boolean;
  readonly leadChildDaTao: number;
  readonly soDaTao: boolean;
  readonly thanhVienDaThem: number;
};

const RONG: KetQuaSauNhan = { boQua: null, datTen: false, leadChildDaTao: 0, soDaTao: false, thanhVienDaThem: 0 };

async function docDauVao(submissionId: string, userId: string) {
  const [bai, user, hocVien, so] = await Promise.all([
    db.discSubmission.findUnique({
      where: { id: submissionId },
      select: {
        leadId: true,
        consentSubjectRole: true,
        subjects: { select: { role: true, fullName: true, birthYear: true, grade: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    db.user.findUnique({ where: { id: userId }, select: { name: true } }),
    db.student.findMany({ where: { parentUserId: userId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 20 }),
    db.discGiaDinh.findUnique({ where: { ownerUserId: userId }, select: { thanhVien: { where: { deletedAt: null }, select: { ten: true } } } }),
  ]);
  const conTrenPhieu = bai?.leadId ? await db.leadChild.findMany({ where: { leadId: bai.leadId }, select: { fullName: true } }) : [];
  return { bai, user, hocVien, so, conTrenPhieu };
}

export async function dongBoThongTinSauNhan(p: { submissionId: string; now?: Date }): Promise<KetQuaSauNhan> {
  const now = p.now ?? new Date();
  const ghi = await db.discSubmission.findUnique({ where: { id: p.submissionId }, select: { claimStatus: true, claimedUserId: true } });
  // Chỉ chạy cho bài ĐÃ được nhận và chỉ cho CHÍNH người đã nhận (quyền lấy từ dòng bài, không từ tham số).
  if (!ghi || ghi.claimStatus !== "CLAIMED" || !ghi.claimedUserId) return { ...RONG, boQua: "KHONG_DUOC_NHAN" };
  const userId = ghi.claimedUserId;

  const { bai, user, hocVien, so, conTrenPhieu } = await docDauVao(p.submissionId, userId);
  if (!bai || !user) return { ...RONG, boQua: "KHONG_DUOC_NHAN" };

  const ph = bai.subjects.find((s) => s.role === "PARENT");
  const hienCo: HienCo = {
    tenTaiKhoan: user.name,
    conTrenPhieu: conTrenPhieu.map((c) => c.fullName),
    coPhieu: !!bai.leadId,
    hocVien: hocVien.map((h) => ({ id: h.id, ten: h.name })),
    so: so ? { thanhVien: so.thanhVien } : null,
  };
  const kh: KeHoach = keHoachSauNhan({
    nguoiLon: ph ? { ten: ph.fullName, namSinh: ph.birthYear, vaiTro: bai.consentSubjectRole } : null,
    tre: bai.subjects.filter((s) => s.role === "STUDENT").map((s) => ({ ten: s.fullName, namSinh: s.birthYear, bacHoc: s.grade })),
    hienCo,
    namNay: now.getUTCFullYear(),
  });

  let datTen = false;
  let leadChildDaTao = 0;
  let soDaTao = false;
  let thanhVienDaThem = 0;

  // 1) Tên tài khoản — `updateMany` có điều kiện «chưa có tên» trong where ⇒ hai lượt đua không đè tên người dùng vừa đặt.
  if (kh.datTenTaiKhoan) {
    try {
      const r = await db.user.updateMany({ where: { id: userId, OR: [{ name: null }, { name: "" }] }, data: { name: kh.datTenTaiKhoan } });
      datTen = r.count === 1;
    } catch (e) {
      const ma = maLoiAnToan(e);
      console.error("[disc:sau-nhan] đặt tên:", ma);
    }
  }

  // 2) Bé vào phiếu khách — đúng chỗ chốt khoá học cần (`convertLeadV2` đòi `leadChildId`). Có phiếu mới ghi.
  if (bai.leadId && kh.leadChildMoi.length > 0) {
    try {
      const r = await db.leadChild.createMany({
        data: kh.leadChildMoi.map((c) => ({ leadId: bai.leadId!, fullName: c.fullName, ageYears: c.ageYears, gradeLevel: c.gradeLevel, note: c.note })),
      });
      leadChildDaTao = r.count;
    } catch (e) {
      const ma = maLoiAnToan(e);
      console.error("[disc:sau-nhan] bé vào phiếu:", ma);
    }
  }

  // 3) Sổ gia đình: tạo (chủ sổ = phụ huynh) rồi thêm bé. Dùng ĐÚNG hàm của cổng (kiểm tra đầu vào, hạn mức, audit) — không ghi tay bảng.
  try {
    if (kh.taoSo) {
      const r = await taoSo(userId, { ...kh.taoSo, goiYHocVien: false }, now);
      soDaTao = r.ok;
      // DA_CO_SO (đua với lượt khác) là bình thường — sổ đã có thì cứ thêm bé vào.
    }
    for (const m of kh.thanhVienMoi) {
      const r = await luuThanhVien(userId, { ten: m.ten, vaiTro: "con", namSinh: m.namSinh, lop: m.lop, studentId: m.studentId }, now);
      if (r.ok) thanhVienDaThem += 1;
    }
  } catch (e) {
    const ma = maLoiAnToan(e);
    console.error("[disc:sau-nhan] sổ gia đình:", ma);
  }
  return { boQua: null, datTen, leadChildDaTao, soDaTao, thanhVienDaThem };
}
