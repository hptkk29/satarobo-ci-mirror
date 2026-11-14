import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { TemplateForm } from "../../_components/template-form";
import { TestSendButton } from "../../_components/test-send-button";

export const metadata = { title: "Sửa email template | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditTemplatePage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("emails:manage")))
    redirect("/dashboard?error=unauthorized");

  // EmailTemplate là model global (∉ SCOPED_MODELS) → sdb pass-through.
  const actor = await resolveActor(session.user.id);
  const { id } = await params;
  const template = await scopedDb(actor).emailTemplate.findUnique({ where: { id } });
  if (!template) notFound();

  const currentUserEmail = session.user.email ?? null;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Sửa template: {template.name}</h1>
        <TestSendButton
          templateId={template.id}
          trigger={template.trigger}
          currentUserEmail={currentUserEmail}
        />
      </div>
      <TemplateForm
        initial={{
          id: template.id,
          code: template.code,
          name: template.name,
          description: template.description ?? "",
          trigger: template.trigger,
          isActive: template.isActive,
          subject: template.subject,
          bodyText: template.bodyText,
          bodyHtml: template.bodyHtml,
          fromName: template.fromName ?? "",
          replyTo: template.replyTo ?? "",
        }}
      />
    </div>
  );
}
