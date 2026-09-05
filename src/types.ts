export type ItemKind = "prompt" | "note" | "link" | "image";
export type ItemStatus = "open" | "done";
export type QueueFilter = "inbox" | "prompts" | "notes" | "done";
export type SectionFilter = "all" | "unfiled" | string;
export type CopyMode = "native" | "sourceMarkdown" | "markdownList";

export type CopyResult = {
  format: "markdown" | "markdownList" | "image";
  count: number;
};

export type ShortcutAction =
  | "capture"
  | "captureClipboard"
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
  thumbnailPath: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
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
  expectedUpdatedAt: string;
};

export type CaptureDetailRequest = {
  ids: string[];
  mode: "preview" | "edit";
};

export type CapturesChangedEvent = {
  revision: number;
  upserts: CaptureItem[];
  deletedIds: string[];
};

export type QueueSnapshot = {
  revision: number;
  items: CaptureItem[];
  sections: Section[];
  settings: AppSettings;
};

export type ImageImportInput = { requestId: string; sectionId: string | null };
export type ImageImportIssue = { index: number | null; name: string | null; code: string; message: string };
export type ImageImportResult = {
  requestId: string;
  cancelled: boolean;
  items: CaptureItem[];
  issues: ImageImportIssue[];
  warnings: ImageImportIssue[];
};

export type PermissionStatus = {
  accessibilityTrusted: boolean;
  postEventTrusted: boolean;
  globalShortcutRegistered: boolean;
  setupSeen: boolean;
};

export type PermissionRequiredEvent = {
  operation: "capture" | "paste";
  accessibilityTrusted: boolean;
  postEventTrusted: boolean;
};

export type ContextMenu =
  | { kind: "queue"; x: number; y: number }
  | { kind: "image"; x: number; y: number }
  | {
      kind: "section";
      x: number;
      y: number;
      sectionId: string;
      confirmingDelete: boolean;
    };
