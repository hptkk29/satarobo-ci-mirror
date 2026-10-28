// lib/cham-cong/mau-import-phan-ca-db.ts — đọc dữ liệu đổ vào FILE MẪU import lịch phân ca.
//
// Hình dạng (và LÝ DO) của file nằm ở `mau-import-phan-ca.ts`. Ở đây chỉ gom dữ liệu, cố ý đi
// qua CÙNG nguồn với màn lưới (`loadLuoiPhanCa`) để file mẫu không bao giờ nói khác lưới.
//
//  · Người trong file = CHỈ nhân sự còn ACTIVE có tài khoản: người đang có trên lưới của khối
//    (khung ca đang mở hoặc có ca trong tháng) + nhân sự ACTIVE thuộc cơ sở đó nhưng chưa có gì
//    (hàng trống để điền). Người đã nghỉ việc dù còn ca cũ trên lưới thì KHÔNG có tên.
//  · Người có ca chịu công ở KHỐI KHÁC bị loại và được nêu tên — xem lý do ở đầu file kia.
import type { scopedDb } from "@/lib/db-scope";
import { loadLuoiPhanCa } from "@/lib/cham-cong/luoi-phan-ca-db";
import { dongGioCa } from "@/lib/cham-cong/gio-ca";
import { HO_CENTER_ID } from "@/lib/cham-cong/home-center";
import type { DauVaoMau, NguoiMau } from "@/lib/cham-cong/mau-import-phan-ca";

export async function docDauVaoMau(input: {
  sdb: ReturnType<typeof scopedDb>;
  /** Center.id của khối (hoặc HO_CENTER_ID). */
  coSo: string;
  ky: string;
  donVi: DauVaoMau["donVi"];
  nhanKhoi: string;
  orgUnitId: string | null;
  unitOf: (centerId: string) => string;
  today: string;
}): Promise<DauVaoMau> {
  const { sdb, coSo, ky, donVi, nhanKhoi, orgUnitId, unitOf, today } = input;

  const luoi = await loadLuoiPhanCa({ sdb, coSo, ky, orgUnitId, unitHere: donVi, unitOf, today });
  const userIdsLuoi = luoi.rows.map((r) => r.userId);

  const [khungCa, nhanSu] = await Promise.all([
    userIdsLuoi.length
      ? sdb.shiftWeeklyPattern.findMany({
          where: { centerId: coSo, effectiveTo: null, userId: { in: userIdsLuoi } },
          select: { userId: true, weekday: true, templateCode: true },
        })
      : Promise.resolve([]),
    sdb.employee.findMany({
      where: {
        status: "ACTIVE",
        userAccount: { isNot: null },
        OR: [
          { userAccount: { id: { in: userIdsLuoi } } },
          coSo === HO_CENTER_ID ? { OR: [{ centerId: null }, { centerId: HO_CENTER_ID }] } : { centerId: coSo },
        ],
      },
      select: { fullName: true, jobTitle: true, userAccount: { select: { id: true, name: true } } },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const khungCua = new Map<string, Record<number, string | null>>();
  for (const p of khungCa) {
    const k = khungCua.get(p.userId) ?? {};
    k[p.weekday] = p.templateCode;
    khungCua.set(p.userId, k);
  }
  const nhanSuCua = new Map(nhanSu.map((e) => [e.userAccount!.id, e]));

  const nguoi: NguoiMau[] = [];
  const nguoiKiemNhiem: string[] = [];
  const daCo = new Set<string>();

  // 1) Người đang có trên lưới — giữ thứ tự lưới (displayOrder rồi tên).
  for (const r of luoi.rows) {
    const e = nhanSuCua.get(r.userId);
    // Chỉ nhân sự còn ACTIVE: người đã nghỉ việc vẫn có thể còn ca cũ trên lưới nhưng không có tên trong file.
    if (!e) continue;
    const ten = e.fullName;
    if (Object.values(r.cells).some((c) => c.foreignUnit)) {
      nguoiKiemNhiem.push(ten);
      daCo.add(r.userId);
      continue;
    }
    daCo.add(r.userId);
    nguoi.push({
      ten,
      hoTen: ten,
      vaiTro: r.jobLabel ?? e.jobTitle ?? "",
      sdt: null,
      khung: khungCua.get(r.userId) ?? {},
      o: Object.fromEntries(Object.entries(r.cells).map(([d, c]) => [Number(d), c.code])),
    });
  }

  // 2) Nhân sự của cơ sở chưa có gì trên lưới — hàng trống để điền.
  for (const e of nhanSu) {
    const uid = e.userAccount!.id;
    if (daCo.has(uid)) continue;
    nguoi.push({ ten: e.fullName, hoTen: e.fullName, vaiTro: e.jobTitle ?? "", sdt: null, khung: {}, o: {} });
  }

  const maCa = dongGioCa(luoi.templates).map(({ code, name, gio }) => ({ code, name, gio }));
  return { ky, donVi, nhanKhoi, nguoi, nguoiKiemNhiem, maCa };
}
