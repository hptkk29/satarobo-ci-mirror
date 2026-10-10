// Ghi khoá học cho MỘT bé trong lớp trial — tức ghi khoá quan tâm của bé.
//
// Luật + lý do: `lib/trial/khoa-truoc-case.ts`. Phép ghi + đồng bộ sang lead dùng CHUNG
// với màn lead: `lib/lead/khoa-quan-tam-con.ts`. Ở đây chỉ bọc transaction — cổng quyền
// nằm ở Server Action gọi hàm này (`datKhoaHocTrialAction`).

import { db } from "@/lib/db";
import { datKhoaQuanTamCon } from "@/lib/lead/khoa-quan-tam-con";

export async function datKhoaHocChoBeTrial(p: {
  leadChildId: string;
  courseId: string;
  actorId: string | null;
  actorName: string;
}): Promise<{ doi: boolean }> {
  return db.$transaction((tx) =>
    datKhoaQuanTamCon(tx, {
      leadChildId: p.leadChildId,
      courseId: p.courseId,
      actorId: p.actorId,
      actorName: p.actorName,
      noiDoi: "lop-trial",
    }),
  );
}
