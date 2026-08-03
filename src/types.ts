export type ItemKind = "prompt" | "note" | "link" | "image";
export type ItemStatus = "open" | "done";
export type QueueFilter = "inbox" | "prompts" | "notes" | "done";
export type SectionFilter = "all" | "unfiled" | string;

export type ShortcutAction =
  | "capture"
  | "save"
  | "paste"
  | "search"
  | "close"
  | "settings"
  | "dismiss"
  | "next"
  | "previous"
  | "copy"
  | "copyAsList"
  | "markDone"
  | "edit"
  | "merge"
  | "delete";

export type KeyboardShortcutSettings = Record<ShortcutAction, string>;

export type AppSettings = {
  shortcuts: KeyboardShortcutSettings;
  keepOpen: boolean;
};

export type CaptureItem = {
  id: string;
  kind: ItemKind;
  content: string;
  status: ItemStatus;
  sourceApp: string | null;
  sourceBundleId: string | null;
  sectionId: string | null;
  attachmentPath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Section = {
  id: string;
  name: string;
  createdAt: string;
};

export type CreateItemInput = {
  content: string;
  kind: ItemKind;
  sourceApp?: string | null;
};

export type UpdateItemInput = {
  id: string;
  content: string;
  kind: ItemKind;
};

export type PermissionStatus = {
  accessibilityTrusted: boolean;
  postEventTrusted: boolean;
  globalShortcutRegistered: boolean;
};
