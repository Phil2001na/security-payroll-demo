import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

type Site = { id: string; name: string };

/**
 * Multi-select site picker used to scope a supervisor to specific sites.
 * Persists on close (only when the selection actually changed).
 */
export function SiteAssignPopover({
  assignedSiteIds,
  sites,
  onSave,
  disabled,
}: {
  assignedSiteIds: string[];
  sites: Site[];
  onSave: (siteIds: string[]) => void;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(assignedSiteIds);
  const [open, setOpen] = useState(false);

  const siteNames = useMemo(() => {
    const map = new Map(sites.map((s) => [s.id, s.name]));
    return assignedSiteIds.map((id) => map.get(id)).filter(Boolean) as string[];
  }, [sites, assignedSiteIds]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          // Re-sync from props each time we open (data may have changed).
          setSelected(assignedSiteIds);
        } else if (
          JSON.stringify([...selected].sort()) !==
          JSON.stringify([...assignedSiteIds].sort())
        ) {
          onSave(selected);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="font-normal" disabled={disabled}>
          {siteNames.length > 0
            ? `${siteNames.length} site${siteNames.length > 1 ? "s" : ""}`
            : "Assign sites"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="max-h-72 overflow-y-auto p-2">
          {sites.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center p-4">No sites yet</p>
          ) : (
            sites.map((s) => {
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
                  <span className="text-sm">{s.name}</span>
                </label>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
