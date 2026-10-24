import "server-only";
import { notifyStaff } from "@/lib/notifications/notify";
import { db } from "@/lib/db";
import { nguoiGiuQuyenTaiCoSo } from "@/lib/org/nguoi-giu-quyen-tai-co-so";

// lib/bao-luu/thong-bao.ts — chuông cho nhân sự quanh hồ sơ bảo lưu (Phiên 3).
//
// Gọi SAU KHI giao dịch đã commit, KHÔNG nằm trong giao dịch: một lỗi chuông không được làm mất một lượt duyệt đã xong
// (spec §I — "broadcast fail → log, không rollback" cùng tinh thần). Nên mọi hàm ở đây NUỐT lỗi và trả số người nhận.
//
// dedupeKey = `pause.<mốc>:<reserveId>` — mỗi hồ sơ chỉ có MỘT lần "chờ duyệt", một lần "đã duyệt" hoặc "từ chối" (hồ sơ
// đã ra khỏi PENDING thì không quay lại), nên khoá theo hồ sơ là đủ chống trùng khi action bị bấm lại.

export type HoSoBao = { id: string; centerId: string | null; tenHocVien: string; tenKhoa: string };

// ─── NGƯỜI NHẬN = NGƯỜI GIỮ QUYỀN [chốt 12/10/2026] ─────────────────────────────────────────────────────────────
// Sự cố nghiệm thu R2 (ô C5b): chuông "chờ duyệt" tới một "Giáo vụ" mà `User.role` cũ là CENTER_MANAGER còn vai RBAC không có `bao-luu:approve` — người
// nhận được chuông về một nút họ không có. Gốc: `quanLyCoSo()` chọn theo vai CŨ (`User.roles` + `User.centerId`) ∪ vai `CENTER_MANAGER`.
// Nay MỖI chuông đòi ĐÚNG quyền của việc nó nhắc, và người nhận là người GIỮ quyền đó ở cơ sở của hồ sơ (hoặc đơn vị cha — HO/khối), còn hoạt động.
// ⚠️ ĐỪNG quay lại `quanLyCoSo` / `User.role` ở đây: hai nguồn lệch nhau chính là lỗi. `quanLyCoSo` vẫn đúng cho module khác (hoá đơn, học bù) — không đổi.
// Lưới: `tests/finance/bao-luu-chuong.test.ts` ([BLC-*], DB thật) + `lib/bao-luu/thong-bao.test.ts` (neo mã nguồn).
export const QUYEN_CHUONG = {
  /** Hồ sơ mới lập — việc nhắc là DUYỆT / TỪ CHỐI. */
  choDuyet: ["bao-luu:approve"],
  /** Đề nghị gia hạn — việc nhắc là duyệt / từ chối gia hạn (`duyetGiaHanAction` · `tuChoiGiaHanAction` đòi `bao-luu:extend`). */
  giaHanChoDuyet: ["bao-luu:extend"],
  /** Hồ sơ MẤT người lập (nhắc hạn / quá hạn / kết quả gia hạn thường gửi người lập) ⇒ rơi về người giữ quyền duyệt. */
  nguoiLapMat: ["bao-luu:approve"],
  /** Quá hạn chưa liên hệ ⇒ ghi liên hệ / ghi thông báo chính thức (`thongBaoChinhThucAction` đòi approve). */
  leoThang: ["bao-luu:approve"],
  chamDut: ["bao-luu:approve"],
  thuHoiKit: ["bao-luu:approve"],
  /** Tạm dừng CẢ LỚP quá ngày dự kiến mở lại — việc của người giữ quyền tạm dừng lớp. */
  centerQuaNgay: ["bao-luu:center-pause"],
} as const satisfies Record<string, readonly string[]>;

/**
 * Người giữ MỘT TRONG các quyền `actions` ở cơ sở `centerId` (leo cây tổ tiên — người neo vai ở HO/khối vẫn là người duyệt hợp lệ), loại tài khoản
 * khoá / đã xoá (bộ phân giải dùng chung không lọc `User.isActive`; chuông gửi cho tài khoản đã khoá là chuông không ai đọc).
 */
export async function nguoiGiuQuyenBaoLuu(centerId: string, actions: readonly string[]): Promise<string[]> {
  const ids = await nguoiGiuQuyenTaiCoSo(centerId, actions);
  if (ids.length === 0) return [];
  const conHoatDong = await db.user.findMany({ where: { id: { in: ids }, isActive: true, deletedAt: null }, select: { id: true } });
  return conHoatDong.map((u) => u.id);
}

async function gui(p: Parameters<typeof notifyStaff>[0]): Promise<number> {
  try {
    return await notifyStaff(p);
  } catch (e) {
    console.error("[bao-luu] chuông lỗi", { key: p.dedupeKey, loi: e instanceof Error ? e.name : "?" });
    return 0;
  }
}

/** Hồ sơ mới lập ⇒ Quản lý cơ sở (trừ chính người lập, nếu họ cũng là QLCS). */
export async function baoChoDuyet(hs: HoSoBao, nguoiLapId: string): Promise<number> {
  if (!hs.centerId) return 0;
  let nhan: string[];
  try {
    nhan = (await nguoiGiuQuyenBaoLuu(hs.centerId, QUYEN_CHUONG.choDuyet)).filter((id) => id !== nguoiLapId);
  } catch (e) {
    console.error("[bao-luu] tìm người duyệt lỗi", e instanceof Error ? e.name : "?");
    return 0;
  }
  if (nhan.length === 0) return 0;
  return gui({
    userIds: nhan,
    dedupeKey: `pause.cho-duyet:${hs.id}`,
    category: "pause",
    title: `Hồ sơ bảo lưu chờ duyệt — ${hs.tenHocVien}`,
    body: `${hs.tenKhoa}. Mở hồ sơ để xem đơn, lý do và duyệt hoặc từ chối.`,
    href: `/bao-luu/${hs.id}`,
    entityId: hs.id,
  });
}

/** Duyệt xong ⇒ báo người lập để họ báo phụ huynh. */
export async function baoDaDuyet(hs: HoSoBao, nguoiLapId: string | null, ngayBatDau: string): Promise<number> {
  if (!nguoiLapId) return 0;
  return gui({
    userIds: [nguoiLapId],
    dedupeKey: `pause.da-duyet:${hs.id}`,
    category: "pause",
    title: `Đã duyệt bảo lưu — ${hs.tenHocVien}`,
    body: `${hs.tenKhoa}. Bảo lưu bắt đầu từ ${ngayBatDau}. Hãy báo lại phụ huynh.`,
    href: `/bao-luu/${hs.id}`,
    entityId: hs.id,
  });
}

/** Từ chối ⇒ báo người lập, kèm lý do. */
export async function baoTuChoi(hs: HoSoBao, nguoiLapId: string | null, lyDo: string): Promise<number> {
  if (!nguoiLapId) return 0;
  return gui({
    userIds: [nguoiLapId],
    dedupeKey: `pause.tu-choi:${hs.id}`,
    category: "pause",
    title: `Hồ sơ bảo lưu bị từ chối — ${hs.tenHocVien}`,
    body: `${hs.tenKhoa}. Lý do: ${lyDo}`,
    href: `/bao-luu/${hs.id}`,
    entityId: hs.id,
  });
}

// ─── Phiên 5: chuông của cron & vòng đời ────────────────────────────────────────────────────────────
// Người nhận: "NGUOI_LAP" = người lập hồ sơ (`createdByUserId`; mất thì rơi về người giữ `bao-luu:approve`); còn lại = người giữ quyền ghi trong `QUYEN_CHUONG`.
// dedupeKey theo (loại mốc, hồ sơ): mỗi mốc ĐÚNG MỘT lần dù cron chạy lại (TC-10). Leo thang có thêm NGÀY vì có thể lặp sau mỗi
// chu kỳ liên hệ.

export type HoSoChuong = HoSoBao & { nguoiLapId: string | null };

/** `"NGUOI_LAP"` = người lập hồ sơ (mất thì rơi về người giữ `QUYEN_CHUONG.nguoiLapMat`); còn lại = tên chuông trong `QUYEN_CHUONG`. */
type AiNhan = "NGUOI_LAP" | "leoThang" | "chamDut" | "thuHoiKit" | "centerQuaNgay";

async function nguoiNhan(hs: HoSoChuong, ai: AiNhan): Promise<string[]> {
  if (ai === "NGUOI_LAP" && hs.nguoiLapId) return [hs.nguoiLapId];
  if (!hs.centerId) return [];
  try {
    return await nguoiGiuQuyenBaoLuu(hs.centerId, QUYEN_CHUONG[ai === "NGUOI_LAP" ? "nguoiLapMat" : ai]);
  } catch (e) {
    console.error("[bao-luu] tìm người nhận chuông lỗi", e instanceof Error ? e.name : "?");
    return [];
  }
}

async function bao(hs: HoSoChuong, ai: AiNhan, key: string, title: string, body: string): Promise<number> {
  const userIds = await nguoiNhan(hs, ai);
  if (userIds.length === 0) return 0;
  return gui({ userIds, dedupeKey: key, category: "pause", title, body, href: `/bao-luu/${hs.id}`, entityId: hs.id });
}

export const baoNhacTruocHan = (hs: HoSoChuong, conNgay: number, han: string) =>
  bao(hs, "NGUOI_LAP", `pause.nhac-truoc-han:${hs.id}`, `Bảo lưu sắp hết hạn — ${hs.tenHocVien}`, `Còn ${conNgay} ngày (hạn ${han}). Liên hệ phụ huynh để chốt phục học hoặc gia hạn.`);

export const baoNhacDungHan = (hs: HoSoChuong, han: string) =>
  bao(hs, "NGUOI_LAP", `pause.nhac-het-han:${hs.id}`, `Hôm nay hết hạn bảo lưu — ${hs.tenHocVien}`, `Hạn bảo lưu là ${han}. Chưa phục học hoặc gia hạn thì hồ sơ sẽ chuyển QUÁ HẠN từ ngày mai.`);

export const baoQuaHan = (hs: HoSoChuong, han: string) =>
  bao(hs, "NGUOI_LAP", `pause.qua-han:${hs.id}`, `Bảo lưu đã quá hạn — ${hs.tenHocVien}`, `Hạn ${han} đã qua. Liên hệ phụ huynh; nếu không liên hệ được, Quản lý sẽ gửi thông báo chính thức.`);

export const baoLeoThang = (hs: HoSoChuong, quaHanNgay: number, ngay: string) =>
  bao(hs, "leoThang", `pause.leo-thang:${hs.id}:${ngay}`, `Bảo lưu quá hạn ${quaHanNgay} ngày chưa liên hệ — ${hs.tenHocVien}`, `${hs.tenKhoa}. Chưa có liên hệ phụ huynh. Mở hồ sơ để ghi liên hệ hoặc gửi thông báo chính thức.`);

export const baoChamDut = (hs: HoSoChuong) =>
  bao(hs, "chamDut", `pause.cham-dut:${hs.id}`, `Đã chấm dứt bảo lưu — ${hs.tenHocVien}`, `${hs.tenKhoa}. Hết hạn phản hồi thông báo chính thức: ghi danh đã đóng, KHÔNG sinh yêu cầu hoàn. Cần thu hồi kit/học cụ (nếu có) và huỷ quyền lợi chưa dùng.`);

export const baoThuHoiKit = (hs: HoSoChuong) =>
  bao(hs, "thuHoiKit", `pause.thu-hoi-kit:${hs.id}`, `Việc: thu hồi kit — ${hs.tenHocVien}`, `Bảo lưu bị chấm dứt. Liên hệ phụ huynh thu hồi kit/học cụ đã cấp (nếu có).`);

export const baoCenterQuaNgay = (hs: HoSoChuong, quaNgay: number, ngay: string) =>
  bao(hs, "centerQuaNgay", `pause.center-qua-ngay:${hs.id}:${ngay}`, `Tạm dừng lớp quá ngày dự kiến mở lại — ${hs.tenHocVien}`, `Đã quá ${quaNgay} ngày. Chọn: chờ tiếp · chuyển khoá · sinh yêu cầu hoàn.`);

export const baoGiaHanChoDuyet = (hs: HoSoChuong, nguoiDeNghiId: string) =>
  hs.centerId
    ? nguoiGiuQuyenBaoLuu(hs.centerId, QUYEN_CHUONG.giaHanChoDuyet)
        .then((ids) => ids.filter((i) => i !== nguoiDeNghiId))
        .then((userIds) =>
          userIds.length === 0
            ? 0
            : gui({ userIds, dedupeKey: `pause.gia-han-cho-duyet:${hs.id}:${nguoiDeNghiId}`, category: "pause", title: `Đề nghị gia hạn bảo lưu chờ duyệt — ${hs.tenHocVien}`, body: `${hs.tenKhoa}. Mở hồ sơ để duyệt hoặc từ chối.`, href: `/bao-luu/${hs.id}`, entityId: hs.id }),
        )
        .catch(() => 0)
    : Promise.resolve(0);

export const baoGiaHanKetQua = (hs: HoSoChuong, duyet: boolean, ngay: string, ghiChu: string) =>
  bao(
    hs, "NGUOI_LAP", `pause.gia-han-${duyet ? "da-duyet" : "tu-choi"}:${hs.id}:${ngay}`,
    duyet ? `Đã duyệt gia hạn bảo lưu — ${hs.tenHocVien}` : `Đề nghị gia hạn bị từ chối — ${hs.tenHocVien}`,
    duyet ? `Hạn mới: ${ghiChu}. Hãy báo lại phụ huynh.` : `Lý do: ${ghiChu}`,
  );
