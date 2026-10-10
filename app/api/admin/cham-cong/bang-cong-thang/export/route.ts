// GET /api/admin/cham-cong/bang-cong-thang/export?ky=YYYY-MM&coSo=A,B,C — xuất Bảng công tháng.
//
// Quyền `hr_attendance:export` kiểm TỪNG cơ sở. Cơ sở nào không có quyền thì BỎ RA khỏi tệp VÀ
// ghi thành một dòng cảnh báo trong sheet `_watermark` — im lặng bỏ qua là người xuất tưởng
// mình đang cầm số của cả công ty trong khi thiếu mất một khối.
//
// ⚠️ Dùng CHUNG `loadBangCongThang` với màn hình. Không truy vấn lại ở đây: file gửi kế toán mà
// in số khác màn quản lý vừa duyệt là lỗi tệ nhất một module chấm công có thể có, và nó không
// tự lộ ra — hai bên không bao giờ gặp nhau.
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
import { periodStatusOf } from "@/lib/cham-cong/module-scope";
import {
  loadBangCongThang,
  type HangBangCong,
  type MaCaDong,
  type NgayCot,
} from "@/lib/cham-cong/bang-cong-thang-db";
import { MAU_O, THU_TU_CHU_GIAI, DAU_HIEU_META, type DauHieu } from "@/lib/cham-cong/mau-o-cong";
import { dungWorkbook, tenTepAnToan, type CotXuat, type KhoiNguoi } from "@/lib/cham-cong/xuat-bang";

/**
 * Nền dòng trong sheet "Chi tiet theo nguoi", khớp màu trên màn hình.
 *
 * Chỉ tô những trạng thái CẦN NHÌN THẤY. Ngày bình thường để trắng — tô hết thì không còn
 * gì nổi lên, đúng lỗi "đỏ lòm mất nghĩa" đã vá trên lưới.
 */
const NEN: Partial<Record<string, string>> = {
  DI_MUON: "FFFAC7C7",
  VE_SOM: "FFFBDEDE",
  NGHI_KHONG_PHEP: "FF3F3F3F",
  THIEU_LUOT: "FFFDF0CE",
  THIEU_GIO: "FFFCE9C2",
  CHO_KET_LUAN: "FFEDEDED",
  NGHI: "FFE3EDFB",
};

/** Một hàng của sheet tổng hợp, kèm nhãn cơ sở khi xuất nhiều khối. */
type HangCoCoSo = HangBangCong & { coSoLabel: string };

export async function GET(req: NextRequest) {
  const session = await requireLiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ky = req.nextUrl.searchParams.get("ky") ?? "";
  // Nhận cả `coSo=a&coSo=b` lẫn `coSo=a,b` — người dán tay URL hay viết kiểu thứ hai.
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

  // Kiểm quyền TỪNG cơ sở. Tuần tự có chủ đích: `checkPermission` đọc actor theo request nên
  // song song không nhanh hơn, mà lại khó truy vết ai bị chặn ở đâu.
  const duoc: string[] = [];
  const biChan: string[] = [];
  for (const c of xin) {
    if (await checkPermission("hr_attendance:export", { centerId: c })) duoc.push(c);
    else biChan.push(c);
  }
  if (duoc.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Cổng VAI (chốt 27/09/2026). `chanXuatVai` vì cổng đọc ở đây kiểm theo TỪNG cơ sở ngay
  // trên (`hr_attendance:export` mang scope CENTER — hỏi không kèm cơ sở là luôn false với
  // vai cấp cơ sở), nên danh mục khai `quyenGoc: null`.
  const chan = await chanXuatVai("cham-cong-thang", session);
  if (chan) return chan;

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const map = await loadCenterMap();
  const today = vnYmd(new Date());

  const centers = await db.center.findMany({
    where: { id: { in: duoc.filter((c) => c !== HO_CENTER_ID) } },
    select: { id: true, code: true, name: true },
  });
  const nhanCoSo = (id: string) => {
    if (id === HO_CENTER_ID) return "HO · Hội sở";
    const c = centers.find((x) => x.id === id);
    return c ? `${c.code ?? ""} ${c.name}`.trim() : id;
  };

  const hang: HangCoCoSo[] = [];
  let days: NgayCot[] = [];
  const maCaGop = new Map<string, MaCaDong>();
  const daChot: string[] = [];

  for (const coSo of duoc) {
    const orgUnitId =
      coSo === HO_CENTER_ID
        ? null
        : (Object.values(map.byCode).find((c) => c.centerId === coSo)?.orgUnitId ?? null);
    const period = await periodStatusOf(sdb, coSo, ky);
    const kq = await loadBangCongThang({
      sdb,
      coSo,
      ky,
      orgUnitId,
      today,
      lockedStatus: period.status,
    });
    if (days.length === 0) days = kq.days;
    if (kq.locked) daChot.push(nhanCoSo(coSo));
    for (const m of kq.maCa) if (!maCaGop.has(m.code)) maCaGop.set(m.code, m);

    const label = nhanCoSo(coSo);
    for (const r of kq.rows) hang.push({ ...r, coSoLabel: label });

  }

  const nhieuCoSo = duoc.length > 1;
  const cotCoSo: CotXuat<HangCoCoSo>[] = nhieuCoSo
    ? [{ nhan: "Cơ sở", lay: (r) => r.coSoLabel, rong: 26 }]
    : [];

  const cot: CotXuat<HangCoCoSo>[] = [
    ...cotCoSo,
    { nhan: "Họ tên", lay: (r) => r.name, rong: 28 },
    { nhan: "Chức danh", lay: (r) => r.jobLabel ?? "", rong: 16 },
    { nhan: "Tổng công", lay: (r) => r.tongCong },
    { nhan: "Giờ làm (phút)", lay: (r) => r.tongPhut, rong: 14 },
    { nhan: "Đi làm", lay: (r) => r.dem.DU_CONG },
    { nhan: "Thiếu lượt", lay: (r) => r.dem.THIEU_LUOT },
    { nhan: "Đi muộn", lay: (r) => r.soDiMuon },
    { nhan: "Về sớm", lay: (r) => r.soVeSom },
    { nhan: "Thiếu giờ", lay: (r) => r.dem.THIEU_GIO },
    { nhan: "Vi phạm", lay: (r) => r.dem.nang },
    { nhan: "— nghỉ không phép", lay: (r) => r.dem.NGHI_KHONG_PHEP, rong: 20 },
    { nhan: "Vắng chờ kết luận", lay: (r) => r.dem.CHO_KET_LUAN, rong: 18 },
    { nhan: "Nghỉ có lý do", lay: (r) => r.dem.NGHI, rong: 15 },
    { nhan: "Chưa tới ngày", lay: (r) => r.dem.CHUA_TOI, rong: 15 },
  ];

  const cotNgay = days.map((d) => String(d.day).padStart(2, "0"));
  const nhanHang = (r: HangCoCoSo) => (nhieuCoSo ? `${r.coSoLabel} — ${r.name}` : r.name);
  const now = new Date();
  const { actorId, actorName } = getAuditActor(session);

  const ghiChu = [
    daChot.length === duoc.length
      ? "Kỳ đã chốt — số trong file này không đổi dù lưới sửa sau."
      : daChot.length === 0
        ? "Bản tạm — số có thể đổi tới khi chốt kỳ."
        : `Chốt một phần: đã chốt ${daChot.join(" · ")}; các cơ sở còn lại là bản tạm.`,
    "Hàng xếp theo số ngày vi phạm, nhiều nhất lên đầu.",
    ...(biChan.length > 0
      ? [`CẢNH BÁO: đã BỎ RA ${biChan.length} cơ sở vì tài khoản này không có quyền xuất.`]
      : []),
  ];

  const wb = dungWorkbook<HangCoCoSo>({
    tieuDe: `BẢNG CÔNG THÁNG ${ky} — ${nhieuCoSo ? `${duoc.length} cơ sở` : nhanCoSo(duoc[0])}`,
    tenSheet: "Tong hop",
    cot,
    dong: hang,
    watermark: exportWatermark(actorName, actorId, hang.length, now),
    ghiChu,
    luoi: [
      {
        ten: "Luoi ma ca",
        gocTraiTren: "Nhân sự",
        cotNgay,
        dong: hang.map((r) => ({
          nhan: nhanHang(r),
          // Mã dạng số ("12", "21") bị Excel đọc thành số — nháy đơn đầu giữ nguyên chữ.
          o: days.map((d) => {
            const c = r.o[d.day]?.code;
            if (!c) return "";
            return /^[0-9]+$/.test(c) ? `'${c}` : c;
          }),
        })),
      },
      {
        // Công từng ngày — kế toán dán thẳng sang bảng lương, không phải đọc mã ca rồi tra.
        ten: "Luoi cong",
        gocTraiTren: "Nhân sự",
        cotNgay,
        dong: hang.map((r) => ({
          nhan: nhanHang(r),
          o: days.map((d) => r.o[d.day]?.cong ?? ""),
        })),
      },
      {
        ten: "Luoi trang thai",
        gocTraiTren: "Nhân sự",
        cotNgay,
        dong: hang.map((r) => ({
          nhan: nhanHang(r),
          o: days.map((d) => {
            const o = r.o[d.day];
            return o && o.mau !== "TRONG" ? MAU_O[o.mau].nhan : "";
          }),
        })),
      },
    ],
    khoiNguoi: {
      // "Chia ra từng nhân viên, chia ra từng ngày" — chốt 25/09. Mỗi người một khối: tên +
      // tổng ở trên, rồi bảng từng ngày kẻ viền. Cuộn một mạch, Ctrl+F ra đúng người.
      ten: "Chi tiet theo nguoi",
      rong: { Ngày: 9, Thứ: 6, "Mã ca": 7, "Giờ ca": 26, "Vào 1": 7, "Ra 1": 7, "Vào 2": 7, "Ra 2": 7, Công: 7, "Trạng thái": 22, "Ghi chú": 26 },
      khoi: hang.map((r): KhoiNguoi => ({
        tieuDe: [r.name, r.jobLabel, nhieuCoSo ? r.coSoLabel : null].filter(Boolean).join(" · "),
        tomTat:
          `Tổng ${r.tongCong} công · ${Math.floor(r.tongPhut / 60)}h${String(r.tongPhut % 60).padStart(2, "0")} làm thật` +
          ` · ${r.soDiMuon} đi muộn · ${r.soVeSom} về sớm · ${r.dem.THIEU_LUOT} thiếu lượt`,
        // BỐN mốc, không phải hai. Ca khai 2 lần chấm (`HC`, `ST`) đòi 4 lượt quét — in mỗi
        // mốc đầu/cuối là giấu mất lượt giữa ca, đúng thứ người quản lý cần kiểm.
        cot: ["Ngày", "Thứ", "Mã ca", "Giờ ca", "Vào 1", "Ra 1", "Vào 2", "Ra 2", "Công", "Trạng thái", "Ghi chú"],
        dong: days.map((d) => {
          const o = r.o[d.day];
          const ma = o?.code ?? "";
          return {
            nen: o ? NEN[o.mau] : undefined,
            o: [
              d.label,
              ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][d.wd],
              ma,
              ma ? (maCaGop.get(ma)?.gio ?? "") : "",
              o?.cacCap[0]?.vao ?? "",
              o?.cacCap[0]?.ra ?? "",
              o?.cacCap[1]?.vao ?? "",
              o?.cacCap[1]?.ra ?? "",
              o && o.cong > 0 ? o.cong : "",
              o && o.mau !== "TRONG" ? MAU_O[o.mau].nhan : "",
              [
                ...(o?.dauHieu ?? []).map((k) => DAU_HIEU_META[k].nhan),
                // Quét hơn 2 cặp trong ngày là bất thường — nói ra chứ đừng cắt mất lặng lẽ.
                (o?.cacCap.length ?? 0) > 2 ? `còn ${(o?.cacCap.length ?? 0) - 2} cặp quét nữa` : "",
              ]
                .filter(Boolean)
                .join(" · "),
            ],
          };
        }),
      })),
    },
    chuGiai: [
      ...THU_TU_CHU_GIAI.map((k) => [MAU_O[k].nhan, MAU_O[k].moTa] as [string, string]),
      ["", ""],
      ...(Object.keys(DAU_HIEU_META) as DauHieu[]).map(
        (k) => [`Ghi chú: ${DAU_HIEU_META[k].nhan}`, DAU_HIEU_META[k].moTa] as [string, string],
      ),
      ["", ""],
      ...[...maCaGop.values()].map(
        (m) =>
          [
            `Mã ca ${m.code}`,
            `${m.name}${m.gio ? ` · ${m.gio}` : ""} · ${m.cong} công · ${
              m.soCapQuet === 0 ? "không kiểm số lượt quét" : `${m.soCapQuet} lần chấm/ngày`
            }`,
          ] as [string, string],
      ),
    ],
  });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "hr_attendance",
    entityType: "AttendancePeriod",
    entityId: `${duoc.join(",")}:${ky}`,
    action: "EXPORT",
    newValues: {
      man: "bang-cong-thang",
      coSo: duoc,
      biChan,
      periodKey: ky,
      people: hang.length,
    },
  });

  const tenTep = nhieuCoSo
    ? `bang-cong-thang-${duoc.length}-co-so-${ky}`
    : `bang-cong-thang-${nhanCoSo(duoc[0]).split(" ")[0]}-${ky}`;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${tenTepAnToan(tenTep)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
