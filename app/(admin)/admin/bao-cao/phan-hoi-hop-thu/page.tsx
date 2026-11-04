// app/(admin)/admin/bao-cao/phan-hoi-hop-thu/page.tsx — GĐ3: ai đang theo kịp khách.
//
// VÌ SAO Ở `/bao-cao/*`: segment `bao-cao` đã có trong `ADMIN_ROUTE_SEGMENTS`
// (lib/auth/route-policy.ts) nên không phải sửa route policy, và đây đúng là một báo
// cáo — không phải công cụ quản trị hội thoại.
//
// CỔNG QUYỀN `inbox:view` — ĐÚNG key mà hộp thư dùng, gọi KHÔNG target. Không đặt ra
// một quyền mới cho riêng màn này: người đã xem được hội thoại của cơ sở mình thì xem
// được số đếm của chính những hội thoại đó, còn cách ly cơ sở nằm ở
// `inboxOrgScopeWhere(actor)` bên trong `baoCaoPhanHoi` (giống mọi màn hộp thư khác).
//
// TRANG NÀY KHÔNG HIỆN MỘT CHỮ NỘI DUNG TIN NÀO: chỉ đếm và đo thời gian chờ. Không
// tên khách, không số điện thoại, không trích nội dung.
import { redirect } from "next/navigation";
import { Clock3 } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { baoCaoPhanHoi, type DongBaoCaoPhanHoi } from "@/lib/inbox/bao-cao-phan-hoi";
import { isZalocrmEnabled } from "@/lib/flags";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Phản hồi hộp thư | Admin" };
export const dynamic = "force-dynamic";

/** Số ngày mặc định của kỳ. 7 ngày là nhịp họp đội Sale. */
const SO_NGAY_MAC_DINH = 7;

function docSoNgay(raw: string | undefined): number {
  const n = Number(raw);
  // Giá trị lạ ⇒ về mặc định, KHÔNG báo lỗi: người ta sửa URL bằng tay để xem nhanh,
  // và một màn lỗi vì gõ nhầm số thì chẳng giúp ai.
  return Number.isFinite(n) && n >= 1 && n <= 90 ? Math.floor(n) : SO_NGAY_MAC_DINH;
}

function nhanChoLau(phut: number | null): { chu: string; gap: boolean } {
  if (phut === null) return { chu: "—", gap: false };
  if (phut < 60) return { chu: `${phut} phút`, gap: phut >= 30 };
  const gio = Math.floor(phut / 60);
  if (gio < 24) return { chu: `${gio} giờ`, gap: true };
  return { chu: `${Math.floor(gio / 24)} ngày`, gap: true };
}

function Bang({ tieuDe, cot, dong }: { tieuDe: string; cot: string; dong: DongBaoCaoPhanHoi[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">{tieuDe}</h2>
      {dong.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Không có hội thoại nào trong kỳ.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{cot}</TableHead>
                <TableHead className="text-right">Hội thoại</TableHead>
                <TableHead className="text-right">Đang chờ trả lời</TableHead>
                <TableHead className="text-right">Khách chờ lâu nhất</TableHead>
                <TableHead className="text-right">Tin đến</TableHead>
                <TableHead className="text-right">Tin đã trả lời</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dong.map((d) => {
                const cho = nhanChoLau(d.choLauNhatPhut);
                return (
                  <TableRow key={d.khoa ?? "__trong__"}>
                    <TableCell className="font-medium">{d.ten}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.soHoiThoai}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.choTraLoi > 0 ? (
                        <Badge variant="destructive">{d.choTraLoi}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${cho.gap ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                    >
                      {cho.chu}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{d.tinDen}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.tinDi}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

export default async function BaoCaoPhanHoiPage({
  searchParams,
}: {
  searchParams: Promise<{ ngay?: string; kenh?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fbao-cao%2Fphan-hoi-hop-thu");
  if (!(await checkPermission("inbox:view"))) redirect("/dashboard?error=unauthorized");

  const sp = await searchParams; // Next 16: searchParams là Promise, BẮT BUỘC await
  const soNgay = docSoNgay(sp.ngay);
  const actor = await resolveActor(session.user.id);

  const den = new Date();
  const tu = new Date(den.getTime() - soNgay * 24 * 60 * 60 * 1000);
  // Chỉ nhận đúng một giá trị lọc kênh, và chỉ khi trục ZaloCRM đang bật — chưa bật thì
  // kênh đó không có dữ liệu và một bộ lọc rỗng chỉ làm người đọc tưởng mình lọc sai.
  const kenh = sp.kenh === "zalo-ca-nhan" && isZalocrmEnabled() ? "ZALO_CA_NHAN" : null;

  const bc = await baoCaoPhanHoi({ actor, tu, den, channel: kenh, now: den });

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
          <Clock3 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Phản hồi hộp thư</h1>
          <p className="text-sm text-muted-foreground">
            {soNgay} ngày gần nhất{kenh ? " · chỉ kênh Zalo cá nhân" : " · mọi kênh"}. Bảng này
            để tìm chỗ đang kẹt, không phải để xếp hạng ai chăm.
          </p>
        </div>
      </header>

      <Bang tieuDe="Theo người phụ trách" cot="Người phụ trách" dong={bc.theoNguoi} />
      <Bang tieuDe="Theo đơn vị" cot="Đơn vị" dong={bc.theoDonVi} />

      <p className="rounded-lg bg-muted p-4 text-xs text-muted-foreground">
        <strong>Đọc đúng ba cột:</strong> “Đang chờ trả lời” là khách đã nhắn mà chưa có tin
        nào <em>gửi được</em> sau đó. “Tin đã trả lời” chỉ đếm tin THẬT SỰ đi tới khách — tin
        mô phỏng hoặc gửi lỗi không tính. Cố ý <strong>không có</strong> cột “thời gian phản
        hồi trung bình”: con số đó phải ghép từng tin đến với tin trả lời kế tiếp, còn cách
        tính rẻ tiền (lấy lần trả lời gần nhất) làm một hội thoại bỏ quên ba ngày vẫn hiện
        “2 phút”.
      </p>
    </div>
  );
}
