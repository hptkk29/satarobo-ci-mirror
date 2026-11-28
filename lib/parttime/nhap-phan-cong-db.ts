// lib/parttime/nhap-phan-cong-db.ts — tầng DB của nhập phân công GV (lưới phân công GV · PR5).
// `dungNguCanhNhap` đọc THEO LÔ mọi thứ hàm xét thuần cần; `apDungNhap` ghi qua đúng các dịch vụ màn hình đang dùng
// (`giaoTruc` · `huyTruc` · `phanCongVaoBuoi`) — import không có đường ghi riêng, nên mọi cổng của dịch vụ vẫn chạy.
// Mỗi dòng MỘT giao dịch: dòng hỏng không kéo dòng khác; chạy lại cả file thì dòng đã ghi thành KHONG_DOI.
import "server-only";
import { db } from "@/lib/db";
import { docGiaoVienCuaCoSo } from "@/lib/teachers/giao-vien-co-so";
import { docBuoi, docChinhSach, phanCongVaoBuoi, type Nguon, type NguoiThaoTac, type ThongBaoPhanCong } from "./phan-cong-db";
import { TRANG_THAI_SONG } from "./phan-cong";
import { CASE_CHO_DUYET } from "@/lib/hoc-bu/duyet-case-thuan";
import { giaoTruc, huyTruc } from "./truc-van-hanh-db";
import type { DongNhap, KetQuaDong, NguCanhNhap } from "./nhap-phan-cong";

const ngayDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const vnHomNay = (now: Date) => new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

export async function dungNguCanhNhap(p: { dong: readonly DongNhap[]; coSoDuocPhan: readonly string[]; coSoDaBat: readonly string[]; now: Date }): Promise<NguCanhNhap> {
  const ma = [...new Set(p.dong.map((d) => d.MaGV).filter(Boolean))];
  const email = [...new Set(p.dong.map((d) => d.EmailThamChieu.toLowerCase()).filter(Boolean))];
  const ngay = [...new Set(p.dong.map((d) => d.Ngay).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))];
  const thang = [...new Set(ngay.map((x) => x.slice(0, 7)))];
  const sessionIds = [...new Set(p.dong.map((d) => d.SessionId).filter(Boolean))];

  const [centers, nv, theoEmail, chinhSach, ky, csIds, mkIds, trIds] = await Promise.all([
    db.center.findMany({ select: { id: true, code: true } }),
    ma.length ? db.employee.findMany({ where: { employeeCode: { in: ma } }, select: { employeeCode: true, userAccount: { select: { id: true } } } }) : [],
    email.length ? db.user.findMany({ where: { email: { in: email, mode: "insensitive" } }, select: { id: true, email: true } }) : [],
    docChinhSach(),
    thang.length ? db.attendancePeriod.findMany({ where: { periodKey: { in: thang }, status: { in: ["LOCKED", "CLOSING"] } }, select: { centerId: true, periodKey: true } }) : [],
    sessionIds.length ? db.classSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true } }) : [],
    // Case học bù CHỜ DUYỆT không phải lịch thật (engine coi là ĐÓNG) ⇒ không nhận làm buổi gắn TA: lọt vào thì xem trước nói "Thêm"
    // rồi phanCongVaoBuoi từ chối lúc ghi.
    sessionIds.length ? db.makeupCase.findMany({ where: { id: { in: sessionIds }, status: { not: CASE_CHO_DUYET } }, select: { id: true } }) : [],
    sessionIds.length ? db.trialClassSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true } }) : [],
  ]);

  const gvTheoMa = new Map<string, { userId: string; coSoCuaGv: string[] }>();
  const userIds = [...new Set([...nv.flatMap((e) => (e.userAccount ? [e.userAccount.id] : [])), ...theoEmail.map((u) => u.id)])];
  const coSoCua = new Map((await docGiaoVienCuaCoSo(centers.map((c) => c.id), p.now)).map((g) => [g.id, g.coSo]));
  for (const e of nv) if (e.userAccount && e.employeeCode) gvTheoMa.set(e.employeeCode, { userId: e.userAccount.id, coSoCuaGv: coSoCua.get(e.userAccount.id) ?? [] });
  for (const u of theoEmail) if (u.email) gvTheoMa.set(u.email.toLowerCase(), { userId: u.id, coSoCuaGv: coSoCua.get(u.id) ?? [] });

  // Buổi: đọc qua đúng hàm chiếu `docBuoi` mà dịch vụ phân công dùng — ngày/giờ/cơ sở khớp một nghĩa.
  const nguon: Nguon[] = [
    ...csIds.map((x) => ({ sourceType: "CLASS_SESSION" as const, sourceId: x.id })),
    ...mkIds.map((x) => ({ sourceType: "MAKEUP_CASE" as const, sourceId: x.id })),
    ...trIds.map((x) => ({ sourceType: "TRIAL_SESSION" as const, sourceId: x.id })),
  ];
  const buoi = new Map<string, { centerId: string; ngay: string; gioBatDau: string; gioKetThuc: string; sourceType: string }>();
  if (nguon.length) {
    const ds = await db.$transaction(async (tx) => Promise.all(nguon.map((n) => docBuoi(tx, n))));
    for (const b of ds) if (b) buoi.set(b.sourceId, { centerId: b.centerId, ngay: b.ngay, gioBatDau: b.gioBatDau, gioKetThuc: b.gioKetThuc, sourceType: b.sourceType });
  }

  const [truc, ta] = await Promise.all([
    userIds.length && ngay.length
      ? db.operationsDutyAssignment.findMany({
          where: { userId: { in: userIds }, workDate: { in: ngay.map(ngayDate) }, status: { in: [...TRANG_THAI_SONG] } },
          select: { id: true, userId: true, workDate: true, shiftCode: true, centerId: true },
        })
      : [],
    sessionIds.length
      ? db.sessionStaffAssignment.findMany({ where: { sourceId: { in: sessionIds }, role: "TEACHING_ASSISTANT", status: { in: [...TRANG_THAI_SONG] } }, select: { sourceId: true, userId: true } })
      : [],
  ]);

  const maCa = new Set(chinhSach.flatMap((c) => (c.thamSo.loai === "SR_QD_238" ? c.thamSo.ca.map((x) => x.ma) : [])));
  return {
    homNay: vnHomNay(p.now),
    coSoTheoMa: new Map(centers.flatMap((c) => (c.code ? [[c.code.toUpperCase(), c.id] as const] : []))),
    coSoDuocPhan: new Set(p.coSoDuocPhan),
    coSoDaBat: new Set(p.coSoDaBat),
    gvTheoMa,
    buoi,
    maCa,
    trucSong: new Map(truc.map((t) => [`${t.userId}|${ymd(t.workDate)}|${t.shiftCode}`, { id: t.id, centerId: t.centerId }])),
    taSong: new Set(ta.map((t) => `${t.sourceId}|${t.userId}`)),
    kyDaKhoa: new Set(ky.map((k) => `${k.centerId}|${k.periodKey}`)),
  };
}

type KqGhi = { ok: true; thongBao?: readonly ThongBaoPhanCong[] } | { ok: false; loi: string };

/** Mọi cơ sở — action hỏi quyền + công tắc theo TỪNG id (không để client gửi danh sách). */
export async function docMoiCoSoId(): Promise<string[]> {
  return (await db.center.findMany({ select: { id: true } })).map((c) => c.id);
}

export type KetQuaApDung = { soDong: number; importKey: string; ok: boolean; thongDiep: string };

/** Ghi các dòng THEM/HUY. Dòng khác bỏ qua. Thông báo trả về cho nơi gọi gửi SAU commit. */
export async function apDungNhap(p: {
  ketQua: readonly KetQuaDong[];
  dong: readonly DongNhap[];
  actor: NguoiThaoTac;
}): Promise<{ ketQua: KetQuaApDung[]; thongBao: ThongBaoPhanCong[] }> {
  const theoSo = new Map(p.dong.map((d) => [d.soDong, d]));
  const ketQua: KetQuaApDung[] = [];
  const thongBao: ThongBaoPhanCong[] = [];
  for (const r of p.ketQua) {
    if (!r.keHoach) continue;
    const d = theoSo.get(r.soDong);
    const ghiChu = [`Import ${r.importKey}`, d?.LyDo, d?.GhiChu].filter(Boolean).join(" · ").slice(0, 300);
    const k = r.keHoach;
    try {
      const kq = await db.$transaction<KqGhi>(async (tx) => {
        if (k.loai === "GAN_TRUC") return giaoTruc(tx, { ...k, note: ghiChu, nguonGiao: "TAY", actor: p.actor });
        if (k.loai === "HUY_TRUC") return huyTruc(tx, { dutyId: k.dutyId, lyDo: ghiChu, actor: p.actor });
        return phanCongVaoBuoi(tx, {
          nguon: { sourceType: k.sourceType as Nguon["sourceType"], sourceId: k.sourceId },
          userId: k.userId,
          role: "TEACHING_ASSISTANT",
          assignmentType: "MANUAL",
          nguonGiao: "TAY",
          actor: p.actor,
          note: ghiChu,
        });
      });
      // Thông báo chỉ gom SAU commit — rollback thì không có gì để báo.
      if (kq.ok) thongBao.push(...(kq.thongBao ?? []));
      ketQua.push({ soDong: r.soDong, importKey: r.importKey, ok: kq.ok, thongDiep: kq.ok ? r.thongDiep : kq.loi });
    } catch (e) {
      ketQua.push({ soDong: r.soDong, importKey: r.importKey, ok: false, thongDiep: e instanceof Error ? e.message : "Không ghi được — thử lại." });
    }
  }
  return { ketQua, thongBao };
}
