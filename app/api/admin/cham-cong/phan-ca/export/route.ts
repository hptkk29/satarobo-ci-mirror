// GET /api/admin/cham-cong/phan-ca/export?ky=YYYY-MM&coSo=A[,B,…] — xuất LƯỚI PHÂN CA THÁNG
// (người × ngày = mã ca) của MỘT hoặc NHIỀU khối, đúng như màn `/cham-cong/phan-ca` đang hiện.
// Người dùng chọn khối ở nút "Xuất Excel" (chủ dự án 07/10/2026).
//
// Cổng quyền = cổng XEM màn, kiểm TỪNG khối: `hr_attendance:assign` HOẶC `hr_attendance:view`
// tại đúng khối (cả hai mang scope CENTER nên phải hỏi kèm cơ sở) + cổng vai xuất
// (`phan-ca-thang`). Khối không đủ quyền bị BỎ RA và ghi cảnh báo trong tệp — im lặng bỏ qua là
// người xuất tưởng mình cầm lịch của cả công ty trong khi thiếu một khối.
//
// ⚠️ Dữ liệu đọc qua `loadLuoiPhanCa` — CÙNG hàm với màn hình. Đừng truy vấn lại ở đây: lịch gửi
// đi mà khác lịch quản lý vừa xếp trên màn là lỗi không tự lộ ra.
import { NextResponse, type NextRequest } from "next/server";
import { requireLiveSession } from "@/lib/auth/live-session";
import { checkPermission } from "@/lib/auth/check-permission";
import { chanXuatVai } from "@/lib/export/chan-xuat";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { getAuditActor } from "@/lib/audit/log";
import { exportWatermark } from "@/lib/export/watermark";
import { db } from "@/lib/db";
import { vnYmd } from "@/lib/time/vn";
import { HO_CENTER_ID, loadCenterMap } from "@/lib/cham-cong/home-center";
import { parsePeriodKey } from "@/lib/cham-cong/period";
import { dongGioCa, locMaCaDaDung } from "@/lib/cham-cong/gio-ca";
import { loadLuoiPhanCa, type LuoiHang, type LuoiMaCa, type LuoiNgay } from "@/lib/cham-cong/luoi-phan-ca-db";
import { NHAN_THU, tongCongNghi } from "@/lib/cham-cong/luoi-phan-ca";
import { dungWorkbook, tenTepAnToan, type CotXuat } from "@/lib/cham-cong/xuat-bang";

/** Một hàng của tệp, kèm nhãn khối khi xuất nhiều khối. */
type HangCoKhoi = LuoiHang & { khoiLabel: string };

export async function GET(req: NextRequest) {
  const session = await requireLiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ky = req.nextUrl.searchParams.get("ky") ?? "";
  // Nhận cả `coSo=a&coSo=b` lẫn `coSo=a,b`.
  const xin = [
    ...new Set(
      req.nextUrl.searchParams
        .getAll("coSo")
        .flatMap((v) => v.split(","))
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  if (xin.length === 0 || !parsePeriodKey(ky)) {
    return NextResponse.json({ error: "Thiếu coSo / ky" }, { status: 400 });
  }

  // Kiểm quyền TỪNG khối — tuần tự có chủ đích: dễ truy ai bị chặn ở đâu.
  const duoc: string[] = [];
  const biChan: string[] = [];
  for (const c of xin) {
    const xemDuoc =
      (await checkPermission("hr_attendance:assign", { centerId: c })) ||
      (await checkPermission("hr_attendance:view", { centerId: c }));
    (xemDuoc ? duoc : biChan).push(c);
  }
  if (duoc.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const chan = await chanXuatVai("phan-ca-thang", session);
  if (chan) return chan;

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const map = await loadCenterMap();
  const centers = await db.center.findMany({ select: { id: true, code: true, name: true } });
  const unitOf = (centerId: string) =>
    centerId === HO_CENTER_ID ? "HO" : (centers.find((c) => c.id === centerId)?.code ?? "HO");
  const nhanKhoi = (id: string) => {
    if (id === HO_CENTER_ID) return "HO · Hội sở";
    const c = centers.find((x) => x.id === id);
    return c ? `${c.code ?? ""} ${c.name}`.trim() : id;
  };
  const today = vnYmd(new Date());

  const hang: HangCoKhoi[] = [];
  let days: LuoiNgay[] = [];
  let templates: LuoiMaCa[] = [];
  const maDaDung: string[] = [];
  const ghiChuKhoi: string[] = [];

  for (const coSo of duoc) {
    const orgUnitId =
      coSo === HO_CENTER_ID ? null : (Object.values(map.byCode).find((c) => c.centerId === coSo)?.orgUnitId ?? null);
    const l = await loadLuoiPhanCa({ sdb, coSo, ky, orgUnitId, unitHere: unitOf(coSo), unitOf, today });
    if (days.length === 0) days = l.days;
    if (templates.length === 0) templates = l.templates;
    maDaDung.push(...l.maDaDung);
    const label = nhanKhoi(coSo);
    for (const r of l.rows) hang.push({ ...r, khoiLabel: label });
    // Ngày nghỉ tuần / lễ có thể khác theo khối — ghi riêng từng khối.
    const nghiTuan = l.days.filter((d) => d.off).map((d) => d.day);
    const le = l.days.filter((d) => d.holiday).map((d) => d.day);
    ghiChuKhoi.push(
      `${label}: ${l.rows.length} người` +
        (nghiTuan.length ? ` · nghỉ tuần ngày ${nghiTuan.join(", ")}` : "") +
        (le.length ? ` · lễ ngày ${le.join(", ")}` : ""),
    );
  }

  const nhieuKhoi = duoc.length > 1;
  const ma = (r: LuoiHang, day: number): string => {
    const c = r.cells[day];
    if (!c?.code) return "";
    // Ca chịu công ở khối khác: giữ mã + ghi khối, giống ô viền đứt trên màn.
    return c.foreignUnit ? `${c.code}→${c.foreignUnit}` : c.code;
  };

  const cot: CotXuat<HangCoKhoi>[] = [
    ...(nhieuKhoi ? [{ nhan: "Cơ sở", lay: (r: HangCoKhoi) => r.khoiLabel, rong: 26 }] : []),
    { nhan: "Nhân sự", lay: (r) => r.name, rong: 28 },
    { nhan: "Chức danh", lay: (r) => r.jobLabel ?? "", rong: 16 },
    ...days.map(
      (d): CotXuat<HangCoKhoi> => ({
        nhan: `${String(d.day).padStart(2, "0")} ${NHAN_THU[d.wd]}`,
        lay: (r) => ma(r, d.day),
        rong: 7,
        chuoi: true,
      }),
    ),
    { nhan: "Công", lay: (r) => tongCongNghi(r.cells).cong, rong: 7 },
    { nhan: "Nghỉ", lay: (r) => tongCongNghi(r.cells).nghi, rong: 7 },
  ];

  const maCa = locMaCaDaDung(dongGioCa(templates), maDaDung);
  const now = new Date();
  const { actorId, actorName } = getAuditActor(session);

  const wb = dungWorkbook<HangCoKhoi>({
    tieuDe: `LƯỚI PHÂN CA THÁNG ${ky} — ${nhieuKhoi ? `${duoc.length} cơ sở` : nhanKhoi(duoc[0])} — ${hang.length} người`,
    tenSheet: "Luoi phan ca",
    cot,
    dong: hang,
    watermark: exportWatermark(actorName, actorId, hang.length, now),
    ghiChu: [
      "Mỗi ô là mã ca của người đó trong ngày (đúng như màn Lưới phân ca lúc xuất). Ô trống = chưa xếp ca.",
      'Ô dạng "MÃ→CS2" = ca chịu công ở khối khác (trên màn là ô viền đứt, chỉ đọc).',
      "Cột Công đếm ô có mã trừ X và P; cột Nghỉ đếm X và P.",
      ...ghiChuKhoi,
      ...(biChan.length > 0
        ? [`CẢNH BÁO: đã BỎ RA ${biChan.length} cơ sở vì tài khoản này không có quyền xem lưới phân ca ở đó.`]
        : []),
    ],
    chuGiai: maCa.map(
      (m) =>
        [
          `Mã ca ${m.code}`,
          `${m.name}${m.gio ? ` · ${m.gio}` : ""} · ${m.cong} công · ${
            m.soCapQuet === 0 ? "không kiểm số lượt quét" : `${m.soCapQuet} lần chấm/ngày`
          }`,
        ] as [string, string],
    ),
  });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "hr_attendance",
    entityType: "ShiftAssignment",
    entityId: `${duoc.join(",")}:${ky}`,
    action: "EXPORT",
    newValues: { man: "phan-ca", coSo: duoc, biChan, periodKey: ky, people: hang.length },
  });

  const tenTep = nhieuKhoi ? `luoi-phan-ca-${duoc.length}-co-so-${ky}` : `luoi-phan-ca-${unitOf(duoc[0])}-${ky}`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${tenTepAnToan(tenTep)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
