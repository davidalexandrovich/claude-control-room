// Folders you sort sessions into: a header over each one's rows in the side list, a chip on its first card on the wall,
// its right-click menu, and the Folder row of a session's menu.
import { ArrowDown, ArrowUp, ChevronRight, Folder, Pencil, Plus, Trash2 } from "lucide-react";
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Session } from "../../../shared/types.ts";
import { editFolder, needsYou, setFolder, setState, toggleFolded, useStore } from "../store.ts";
import { StatusOrb } from "./Primitives.tsx";

const MAX_FOLDER = 40;

/** A one-line box for a folder's name: Enter or leaving it saves, Esc cancels. `save` says whether it took. */
function FolderInput(props: { initial: string; className: string; placeholder?: string; save: (name: string) => Promise<boolean>; done: () => void }) {
  const [value, setValue] = useState(props.initial);
  const box = useRef<HTMLInputElement>(null);
  // Enter, Esc and the blur that follows them all end the edit; only the first one counts.
  const ended = useRef(false);
  const finish = async (keep: boolean) => {
    if (ended.current) return;
    ended.current = true;
    const name = value.trim();
    if (!keep || !name || name === props.initial) return props.done();
    if (await props.save(name)) return props.done();
    ended.current = false;
    box.current?.focus();
  };
  return (
    <input
      ref={box}
      className={`name-input ${props.className}`}
      value={value}
      maxLength={MAX_FOLDER}
      autoFocus
      aria-label="Folder name"
      placeholder={props.placeholder}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") void finish(true);
        else if (e.key === "Escape") void finish(false);
      }}
      onBlur={() => void finish(true)}
    />
  );
}

/** Opens a folder's right-click menu. */
function openFolderMenu(e: React.MouseEvent, name: string): void {
  e.preventDefault();
  e.stopPropagation();
  setState({ folderMenu: { name, x: e.clientX, y: e.clientY } });
}

/** A folder's header in the side list: a click shuts or opens it, a drag moves the folder up or down (folderDrag.ts). Shut, it still shows when one of its sessions needs you. */
export function FolderHead({ name, sessions }: { name: string; sessions: Session[] }) {
  const folded = useStore((st) => st.folded.includes(name));
  const renaming = useStore((st) => st.renamingFolder === name);
  const menuOn = useStore((st) => st.folderMenu?.name === name);
  const asking = sessions.filter(needsYou).length;
  if (renaming)
    return (
      <div className="focus-folder is-renaming">
        <ChevronRight size={13} className={`focus-folder-chev ${folded ? "" : "is-open"}`} />
        <FolderInput
          initial={name}
          className="focus-folder-input"
          save={async (to) => (await editFolder(name, { rename: to })).ok}
          done={() => setState({ renamingFolder: null })}
        />
      </div>
    );
  return (
    <button
      type="button"
      className={`focus-folder ${menuOn ? "has-menu" : ""}`}
      aria-expanded={!folded}
      onClick={() => toggleFolded(name)}
      onContextMenu={(e) => openFolderMenu(e, name)}
      draggable
      data-folder-drag={name}
    >
      <ChevronRight size={13} className={`focus-folder-chev ${folded ? "" : "is-open"}`} />
      <span className="focus-folder-name">{name}</span>
      {folded && asking > 0 && (
        <span className="focus-folder-ask" title={`${asking} ${asking === 1 ? "needs" : "need"} you`}>
          <StatusOrb kind="approval" size={7} />
          {asking}
        </span>
      )}
      <span className="focus-folder-count">{sessions.length}</span>
    </button>
  );
}

/** On the wall, on the first card of each folder: a drag moves the folder left or right (folderDrag.ts). */
export function FolderChip({ name }: { name: string }) {
  const menuOn = useStore((st) => st.folderMenu?.name === name);
  return (
    <span
      className={`chip chip-folder ${menuOn ? "has-menu" : ""}`}
      draggable
      data-folder-drag={name}
      data-tip="Drag left or right to move the folder. Right-click to rename or remove it."
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => openFolderMenu(e, name)}
    >
      <Folder size={12} />
      <span className="chip-text">{name}</span>
    </span>
  );
}

/** A folder's right-click menu. */
export function FolderMenu() {
  const at = useStore((st) => st.folderMenu);
  const folders = useStore((st) => st.snapshot?.folders);
  if (!at || !folders?.includes(at.name)) return null;
  return <Menu key={`${at.name}:${at.x}:${at.y}`} name={at.name} x={at.x} y={at.y} folders={folders} />;
}

function Menu({ name, x, y, folders }: { name: string; x: number; y: number; folders: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: x, top: y, visibility: "hidden" });
  const close = () => setState({ folderMenu: null });
  const run = (fn: () => unknown) => () => {
    close();
    void fn();
  };
  useLayoutEffect(() => {
    const el = box.current!;
    setStyle({ left: Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8)), top: Math.max(8, Math.min(y, innerHeight - el.offsetHeight - 8)) });
    el.focus();
  }, [x, y]);
  useEffect(() => {
    const away = (e: Event) => !box.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, []);
  const at = folders.indexOf(name);
  const item = (icon: React.ReactNode, label: string, onClick: () => void, opts: { danger?: boolean; disabled?: boolean } = {}) => (
    <button type="button" role="menuitem" className={`ctx-item ${opts.danger ? "is-danger" : ""}`} disabled={opts.disabled} onClick={onClick}>
      <span className="ctx-icon">{icon}</span>
      <span className="ctx-label">{label}</span>
    </button>
  );
  return createPortal(
    <div ref={box} className="menu ctx-menu folder-menu" role="menu" aria-label={`${name}: actions`} tabIndex={-1} style={style} onContextMenu={(e) => e.preventDefault()}>
      <div className="ctx-head">
        <div className="ctx-name">{name}</div>
      </div>
      <div className="ctx-group">
        {item(<Pencil size={14} />, "Rename", run(() => setState({ renamingFolder: name })))}
        {item(<ArrowUp size={14} />, "Move up", run(() => editFolder(name, { shift: -1 })), { disabled: at <= 0 })}
        {item(<ArrowDown size={14} />, "Move down", run(() => editFolder(name, { shift: 1 })), { disabled: at >= folders.length - 1 })}
      </div>
      <div className="ctx-group">
        {item(<Trash2 size={14} />, "Remove folder", run(() => editFolder(name, { remove: true })), { danger: true })}
        <div className="ctx-note folder-menu-note">Its sessions stay, out of any folder.</div>
      </div>
    </div>,
    document.body,
  );
}

/** The Folder row of a session's menu: one click moves it. `adding` is the menu's, so Esc in the box doesn't close it. */
export function FolderPicker({ s, adding, setAdding, done }: { s: Session; adding: boolean; setAdding: (on: boolean) => void; done: () => void }) {
  const folders = useStore((st) => st.snapshot?.folders) ?? [];
  const busy = useStore((st) => !!st.busy[`${s.pid}:folder`]);
  const pick = (folder: string | null) => {
    done();
    if (folder !== s.folder) void setFolder(s, folder);
  };
  const pill = (label: string, folder: string | null) => (
    <button
      key={folder ?? ""}
      type="button"
      role="radio"
      aria-checked={s.folder === folder}
      className={`ctx-pill ${s.folder === folder ? "is-on" : ""}`}
      disabled={busy}
      onClick={() => pick(folder)}
    >
      {label}
    </button>
  );
  return (
    <div className="ctx-tune" role="radiogroup" aria-label="Folder">
      <span className="ctx-tune-label">Folder</span>
      <div className="ctx-pills">
        {pill("None", null)}
        {folders.map((f) => pill(f, f))}
        {adding ? (
          <FolderInput
            initial=""
            className="ctx-pill ctx-pill-input"
            placeholder="New folder"
            save={async (name) => {
              const r = await setFolder(s, name);
              if (r.ok) done();
              return r.ok;
            }}
            done={() => setAdding(false)}
          />
        ) : (
          <button type="button" className="ctx-pill ctx-pill-new" disabled={busy} onClick={() => setAdding(true)}>
            <Plus size={11} /> New
          </button>
        )}
      </div>
    </div>
  );
}
