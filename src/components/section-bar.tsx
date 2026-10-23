import { Check, FolderPlus, Plus, X } from "lucide-react";
import { useState, type MouseEvent } from "react";
import type { Section, SectionFilter } from "../types";

export type { SectionFilter };

export type SectionCounts = { all: number; unfiled: number; bySection: ReadonlyMap<string, number> };

type SectionBarProps = {
  sections: Section[];
  active: SectionFilter;
  counts: SectionCounts;
  onChange: (section: SectionFilter) => void;
  onCreate: (name: string) => Promise<void>;
  onContextMenu: (
    section: Section,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
};

/// Sections as chips, each carrying its live count.
export function SectionBar({
  sections,
  active,
  counts,
  onChange,
  onCreate,
  onContextMenu,
}: SectionBarProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const submit = async () => {
    const nextName = name.trim();
    if (!nextName) return;
    await onCreate(nextName);
    setName("");
    setCreating(false);
  };

  return (
    <div className="section-bar" aria-label="Capture sections">
      <div className="section-scroll">
        <button data-active={active === "all"} onClick={() => onChange("all")}>
          All<small>{counts.all}</small>
        </button>
        <button
          data-active={active === "unfiled"}
          onClick={() => onChange("unfiled")}
        >
          Unfiled<small>{counts.unfiled}</small>
        </button>
        {sections.map((section) => (
          <button
            key={section.id}
            data-active={active === section.id}
            onClick={(event) => {
              if (event.ctrlKey) {
                event.preventDefault();
                onContextMenu(section, event);
              } else {
                onChange(section.id);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onContextMenu(section, event);
            }}
          >
            {section.name}<small>{counts.bySection.get(section.id) ?? 0}</small>
          </button>
        ))}
      </div>

      {creating ? (
        <div className="section-create">
          <input
            autoFocus
            value={name}
            maxLength={40}
            placeholder="Section name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
              if (event.key === "Escape") setCreating(false);
            }}
          />
          <button aria-label="Create section" onClick={() => void submit()}>
            <Check size={12} />
          </button>
          <button aria-label="Cancel section" onClick={() => setCreating(false)}>
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          className="section-add"
          aria-label="New section"
          title="New section"
          onClick={() => setCreating(true)}
        >
          {sections.length ? <Plus size={13} /> : <FolderPlus size={13} />}
        </button>
      )}
    </div>
  );
}
