import { AlertTriangle, CircleCheck, CircleHelp, ShieldAlert } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { ClosePlan, Session, WorktreeVerdict } from "../../../shared/types.ts";
import { folderName, plural } from "../lib/format.ts";
import { act, api, setState, useStore } from "../store.ts";
import { Spinner } from "./Primitives.tsx";

const ADVICE: Record<WorktreeVerdict, { label: string; tone: "good" | "maybe" | "keep" | "na" }> = {
  safe: { label: "Safe to delete", tone: "good" },
  "probably-safe": { label: "Probably safe", tone: "maybe" },
  keep: { label: "Keep it for now", tone: "keep" },
  "in-use": { label: "In use", tone: "keep" },
  main: { label: "Can't delete", tone: "na" },
  gone: { label: "Already gone", tone: "na" },
};

export function VerdictPill({ verdict }: { verdict: WorktreeVerdict }) {
  const a = ADVICE[verdict];
  const Icon = a.tone === "good" ? CircleCheck : a.tone === "maybe" ? CircleHelp : a.tone === "keep" ? ShieldAlert : AlertTriangle;
  return (
    <span className={`verdict verdict-${a.tone}`}>
      <Icon size={13} /> {a.label}
    </span>
  );
}

function Checkbox(props: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className={`check ${props.disabled ? "is-disabled" : ""}`}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="check-box" aria-hidden />
      <span className="check-label">{props.children}</span>
    </label>
  );
}

export function CloseDialog({ s }: { s: Session }) {
  const [plan, setPlan] = useState<ClosePlan | null>(null);
  const [close, setClose] = useState(true);
  const [del, setDel] = useState(false);
  const [force, setForce] = useState(false);
  const busy = useStore((st) => st.busy[`${s.pid}:close`] === true);

  useEffect(() => {
    void api<ClosePlan | null>(`/api/sessions/${s.pid}/close-plan`).then(setPlan);
  }, [s.pid]);

  const wt = plan?.worktree ?? null;
  const paths = s.claims.reduce((n, c) => n + c.paths.length, 0);
  const leases = [...new Set(s.claims.flatMap((c) => c.leases))];
  const canDelete = !!wt && (wt.verdict === "safe" || wt.verdict === "probably-safe" || wt.verdict === "keep");
  const needsForce = !!wt && wt.verdict === "keep";
  const ready = close && (!del || (canDelete && (!needsForce || force)));
  const dismiss = () => setState({ closing: null });

  const submit = async () => {
    const out = await act(`${s.pid}:close`, `/api/sessions/${s.pid}/close`, { close, deleteWorktree: del, force: del && force });
    if (out.ok) setState({ closing: null, drawer: null });
  };

  return (
    <div className="scrim" onClick={dismiss}>
      <motion.div
        className="dialog"
        role="dialog"
        aria-modal
        aria-labelledby="close-title"
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 36 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && dismiss()}
      >
        <h2 id="close-title">Close this session?</h2>
        <p className="dialog-sub">{s.name}</p>

        <div className="close-option">
          <Checkbox
            checked={close}
            onChange={(v) => {
              setClose(v);
              if (!v) setDel(false);
            }}
          >
            <b>Close the session and release all claims</b>
            <span>
              Stops Claude{s.vscodeLinked ? " and closes its terminal tab" : ""}.{" "}
              {s.claims.length
                ? `Releases ${plural(paths, "claimed path")}${leases.length ? ` and the ${leases.join(", ")} lease${leases.length === 1 ? "" : "s"}` : ""}.`
                : "This session holds no claims."}
            </span>
          </Checkbox>
        </div>

        <div className={`close-option ${!wt ? "is-muted" : ""}`}>
          <Checkbox checked={del} disabled={!close || !canDelete} onChange={setDel}>
            <b>
              Delete the worktree{wt ? <span className="mono"> {folderName(wt.path)}</span> : null}
            </b>
            <span>{wt ? "Removes the folder. The branch stays, on GitHub and locally." : plan ? "This session does not run in a separate worktree." : "Checking the worktree…"}</span>
          </Checkbox>
          <div className="advice">
            {!plan ? (
              <Spinner />
            ) : wt ? (
              <>
                <VerdictPill verdict={wt.verdict} />
                <p className="advice-reason">{wt.reason}</p>
                <div className="advice-facts">
                  <span className={wt.dirty ? "tone-bad" : ""}>{plural(wt.dirty, "uncommitted change")}</span>
                  <span className={wt.unpushed ? "tone-warn" : ""}>{plural(wt.unpushed, "unpushed commit")}</span>
                  {wt.pr && <span>PR #{wt.pr.number} {wt.pr.state.toLowerCase()}</span>}
                </div>
              </>
            ) : null}
          </div>
          {del && needsForce && (
            <div className="force-confirm">
              <Checkbox checked={force} onChange={setForce}>
                <b className="tone-bad">Delete anyway. I read the advice above{wt && (wt.dirty || wt.unpushed) ? " and accept losing that work" : ""}.</b>
              </Checkbox>
            </div>
          )}
        </div>

        <div className="dialog-buttons">
          <button type="button" className="btn btn-ghost" onClick={dismiss}>
            Cancel
          </button>
          <button type="button" className={`btn ${del ? "btn-danger" : "btn-primary"}`} disabled={!ready || busy} onClick={() => void submit()}>
            {busy ? <Spinner /> : null}
            {del ? "Close and delete worktree" : "Close session"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
