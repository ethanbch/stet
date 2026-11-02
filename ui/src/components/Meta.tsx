import { useState } from "react";
import { KINDS, bump, post, useData, type Projects } from "../api";

const NEW = "\u0000new";

/** Kind and project of a card: filled by the agent, changed here in one click. The card's status stays. */
export function MetaPickers({ title, kind, project, onProblem }: { title: string; kind: string | null; project: string | null; onProblem: (m: string) => void }) {
  const { data } = useData<Projects>("/api/projects");
  const [adding, setAdding] = useState<string>();

  const save = async (meta: { kind?: string | null; project?: string | null }) => {
    const r = await post("/api/card/meta", { title, ...meta });
    if (r.ok) bump();
    else onProblem(r.problems?.[0]?.message ?? "The change was refused.");
  };

  const addProject = async (name: string) => {
    const clean = name.trim();
    if (!clean) return setAdding(undefined);
    const r = await post("/api/projects", { name: clean });
    if (!r.ok && !r.problems?.[0]?.message.includes("already")) return onProblem(r.problems?.[0]?.message ?? "Could not add the project.");
    setAdding(undefined);
    await save({ project: clean });
  };

  return (
    <>
      <label className={`meta-pick ${kind ? "is-set" : ""}`} title="Kind: what this card holds">
        <span className="sr-only">Kind</span>
        <select value={kind ?? ""} onChange={(e) => void save({ kind: e.target.value || null })}>
          <option value="">No kind</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      {adding === undefined ? (
        <label className={`meta-pick meta-pick--project ${project ? "is-set" : ""}`} title="Project">
          <span className="sr-only">Project</span>
          <select
            value={project ?? ""}
            onChange={(e) => {
              if (e.target.value === NEW) setAdding("");
              else void save({ project: e.target.value || null });
            }}
          >
            <option value="">No project</option>
            {(data?.projects ?? []).map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
            <option value={NEW}>New project…</option>
          </select>
        </label>
      ) : (
        <form
          className="meta-new"
          onSubmit={(e) => {
            e.preventDefault();
            void addProject(adding);
          }}
        >
          <input
            autoFocus
            className="tag-input"
            placeholder="Project name"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(undefined)}
            aria-label="New project name"
          />
          <button className="link-button" type="submit">
            Add
          </button>
        </form>
      )}
    </>
  );
}
