import type { ScopedDb } from "@/lib/actions/factory";
import { writeAudit } from "@/lib/audit/audit-log";
import { notifyElearning } from "@/lib/elearning/notify-gate";
import { TRAN_THAO_TAC_HANG_LOAT } from "@/lib/elearning/chon-nhieu";
import { conPhaiHoc, dangTre, type DongNguoiHoc } from "@/lib/elearning/nguoi-hoc";
import { nhacHocHomNay, traNguoiHocTheoId } from "@/lib/elearning/nguoi-hoc-query";
import type { PhamViCoSo } from "@/lib/elearning/report-scope";
import { khoaNhacTrongNgay, soanLoiNhac, type KetQuaNhacHoc } from "@/lib/elearning/nhac-hoc-pure";

export { khoaNhacTrongNgay, ngayVn, soanLoiNhac, tomTatKetQuaNhac, type KetQuaNhacHoc, type LoiNhac } from "@/lib/elearning/nhac-hoc-pure";

/**
 * P7 — NHẮC HỌC THỦ CÔNG (nút "Nhắc học" của màn Người học, thiết kế 20/11).
 *
 * Khác với bảy mốc nhắc TỰ ĐỘNG (`cron-reminders.ts`): đây là người của Đào tạo / quản lý cơ sở chủ động nhắc một nhóm người. Đi qua CÙNG cổng gửi
 * (`notifyElearning` — cổng người nhận UAT) và cùng kênh (chuông + Web Push), KHÔNG kênh mới.
 *
 * ⚠️ QUYẾT ĐỊNH MẶC ĐỊNH CHỜ DUYỆT (ghi ở DECISIONS D-41): tối đa MỘT lần nhắc thủ công / người / ngày (giờ VN). Chống chuông thành nguồn nhiễu (PRD trần 30 mục/ngày)
 * và chống bấm đúp. Con số "một ngày" là chính sách vận hành, KHÔNG phải KPI — đổi ở đúng một chỗ (`khoaNhacTrongNgay`).
 *
 * ⚠️ Ranh giới phạm vi: id từ client KHÔNG phải nguồn tin cậy. Chỉ người có ≥ 1 lượt học TRONG tầm nhìn (`scopedDb` + `locCoSoLuotHoc`) mới được nhắc; id còn lại vào
 * `khongThay` (không phân biệt "không tồn tại" với "ở cơ sở khác" — không để dò id).
 */

export const TRAN_NHAC_HOC = TRAN_THAO_TAC_HANG_LOAT;

export async function nhacHocNguoi(p: {
  sdb: ScopedDb;
  coSo: PhamViCoSo;
  userIds: readonly string[];
  nguoiGui: { id: string; name: string };
  now?: Date;
}): Promise<KetQuaNhacHoc> {
  const now = p.now ?? new Date();
  const ids = [...new Set(p.userIds.filter(Boolean))].slice(0, TRAN_NHAC_HOC);
  const ket: KetQuaNhacHoc = { daNhac: [], daNhacHomNay: [], khongCanNhac: [], khongThay: [], chuaGuiDuoc: [] };
  if (ids.length === 0) return ket;

  const lanDau = await traNguoiHocTheoId(p.sdb, p.coSo, ids);
  const theoNguoi = new Map<string, DongNguoiHoc[]>();
  for (const d of lanDau) theoNguoi.set(d.userId, [...(theoNguoi.get(d.userId) ?? []), d]);
  const homNay = await nhacHocHomNay(ids, now);

  for (const id of ids) {
    const ds = theoNguoi.get(id);
    if (!ds) {
      ket.khongThay.push(id);
      continue;
    }
    if (homNay.has(id)) {
      ket.daNhacHomNay.push(id);
      continue;
    }
    const loi = soanLoiNhac(ds, now);
    if (!loi) {
      ket.khongCanNhac.push(id);
      continue;
    }
    const soNhan = await notifyElearning({
      userIds: [id],
      dedupeKey: khoaNhacTrongNgay(id, now),
      title: loi.title,
      body: loi.body,
      href: "/elearning/khoa-cua-toi",
      entityId: id,
    });
    if (soNhan <= 0) {
      ket.chuaGuiDuoc.push(id);
      continue;
    }
    ket.daNhac.push(id);
    // Sổ: chỉ ghi khi ĐÃ gửi thật — dòng này cũng là nguồn của chữ "Đã nhắc hh:mm" và của luật một-lần-một-ngày.
    await writeAudit({
      actor: { id: p.nguoiGui.id, name: p.nguoiGui.name },
      module: "elearning",
      entityType: "User",
      entityId: id,
      action: "REMIND",
      newValues: { soKhoaConNo: ds.filter(conPhaiHoc).length, soKhoaTre: ds.filter((d) => dangTre(d, now)).length },
    });
  }
  return ket;
}
