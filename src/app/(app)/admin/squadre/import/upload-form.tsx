"use client";

import { useActionState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Label } from "@/components/ui/label";
import { previewRostersImport } from "@/lib/import/rosters-actions";

export function RostersUploadForm() {
  const [state, action, pending] = useActionState(previewRostersImport, undefined);

  return (
    <form action={action} className="flex flex-col gap-4" encType="multipart/form-data">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file">Export rose (.xlsx)</Label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          className="border-line bg-surface file:bg-surface-2 file:text-foreground min-h-11 w-full rounded-[var(--radius-control)] border text-sm file:mr-3 file:min-h-11 file:rounded-l-[var(--radius-control)] file:border-0 file:border-r file:px-3 file:font-medium"
        />
      </div>
      <FormMessage>{state?.message}</FormMessage>
      <Button type="submit" disabled={pending}>
        <Upload className="size-4" aria-hidden />
        {pending ? "Analisi del file…" : "Carica e mostra anteprima"}
      </Button>
    </form>
  );
}
