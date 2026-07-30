import { Check, FolderPlus, Plus, X } from "lucide-react";
import { useState } from "react";
import type { Section } from "../types";

export type SectionFilter = "all" | "unfiled" | string;

type SectionBarProps = {
  sections: Section[];
  active: SectionFilter;
  onChange: (section: SectionFilter) => void;
  onCreate: (name: string) => Promise<void>;
};

export function SectionBar({
  sections,
  active,
  onChange,
  onCreate,
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
          All
        </button>
        <button
          data-active={active === "unfiled"}
          onClick={() => onChange("unfiled")}
        >
          Unfiled
        </button>
        {sections.map((section) => (
          <button
            key={section.id}
            data-active={active === section.id}
            onClick={() => onChange(section.id)}
          >
            {section.name}
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
