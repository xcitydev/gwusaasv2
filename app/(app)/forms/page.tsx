import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FORM_DEFS } from "@/lib/forms-def";
import { formIcon } from "@/components/forms/form-icon";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MySubmissions } from "@/components/forms/my-submissions";
import { FormsGate } from "@/components/forms/forms-gate";

export default function FormsPage() {
  return (
    <FormsGate>
      <PageHeader
        title="GWU Onboarding Forms"
        description="Onboarding — we review every request and start once payment is confirmed."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {FORM_DEFS.map((def) => {
          const Icon = formIcon(def.icon);
          return (
            <Link key={def.slug} href={`/forms/${def.slug}`} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardHeader className="flex flex-row items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4.5" />
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{def.title}</CardTitle>
                    <Badge
                      variant="outline"
                      className="mt-1 px-1.5 py-0 text-[10px] text-muted-foreground"
                    >
                      {def.category}
                    </Badge>
                  </div>
                  <ArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </CardHeader>
                <CardContent className="pt-0 text-sm text-muted-foreground">
                  {def.description}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
      <MySubmissions />
    </FormsGate>
  );
}
