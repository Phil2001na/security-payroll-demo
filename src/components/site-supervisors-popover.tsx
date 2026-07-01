import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

type Supervisor = { id: string; full_name: string; assigned_site_ids: string[] };

/**
 * Per-site supervisor picker: choose which supervisors cover THIS site.
 * The inverse of SiteAssignPopover — persists on close via set_site_supervisors.
 */
export function SiteSupervisorsPopover({
  siteId,
  supervisors,
  onSave,
  disabled,
}: {
  siteId: string;
  supervisors: Supervisor[];
  onSave: (userIds: string[]) => void;
  disabled?: boolean;
}) {
  // Who currently covers this site.
  const assignedIds = useMemo(
    () => supervisors.filter((s) => s.assigned_site_ids?.includes(siteId)).map((s) => s.id),
    [supervisors, siteId],
  );
  const [selected, setSelected] = useState<string[]>(assignedIds);
  const [open, setOpen] = useState(false);

  const count = assignedIds.length;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setSelected(assignedIds);
        } else if (
          JSON.stringify([...selected].sort()) !== JSON.stringify([...assignedIds].sort())
        ) {
          onSave(selected);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full font-normal" disabled={disabled}>
          <ShieldCheck className="mr-2 h-3.5 w-3.5" />
          {count > 0 ? `${count} supervisor${count > 1 ? "s" : ""}` : "Assign supervisors"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="max-h-72 overflow-y-auto p-2">
          {supervisors.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center p-4">
              No supervisors yet. Create one under System Users (role: Supervisor).
            </p>
          ) : (
            supervisors.map((s) => {
              const checked = selected.includes(s.id);
              return (
                <label
                  key={s.id}
                  className="flex items-center gap-3 px-2 py-2 rounded hover:bg-muted cursor-pointer"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => {
                      if (c) setSelected([...selected, s.id]);
                      else setSelected(selected.filter((id) => id !== s.id));
                    }}
                  />
                  <span className="text-sm">{s.full_name}</span>
                </label>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
