// A folder typed in Settings: saved when you leave the field or press Enter.
import { useEffect, useState } from "react";
import type { ActionResult } from "../../../shared/types.ts";
import { api, toast } from "../store.ts";

/** A folder that is not there goes back to the saved one. */
export function FolderField({ value, label, placeholder, save }: { value: string; label: string; placeholder?: string; save: (text: string) => object }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text.trim() === value) return;
    void api<ActionResult>("/api/settings", save(text.trim())).then(
      (r) => {
        if (!r.ok) {
          toast(r.message, "error");
          setText(value);
        }
      },
      () => setText(value),
    );
  };
  return (
    <input
      className="input mono set-folder"
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
