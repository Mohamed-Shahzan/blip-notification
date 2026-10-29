"""Copy chosen real lines from logs/received.jsonl into cleaned test fixtures.

Keeps only the fields the translator reads. Session ids, prompt ids and tool
inputs are replaced by short placeholders, mapped consistently so pairs still match.
"""
import json, sys

# Run from the repo root: python3 -I app/src-tauri/src/fixtures/make_fixtures.py logs/received.jsonl app/src-tauri/src/fixtures
src, out = sys.argv[1], sys.argv[2]
L = [json.loads(l) for l in open(src)]

CASES = {
    "allow.jsonl": range(31, 39),
    "deny.jsonl": range(39, 48),
    "mod_before_stop.jsonl": range(53, 56),
    "question_then_esc.jsonl": range(56, 90),
    "freeze_burst.jsonl": list(range(90, 95)) + list(range(112, 122)),
}
HOOK_KEEP = ["hook_event_name", "session_id", "prompt_id", "tool_name", "agent_id"]
MOD_KEEP = ["kind", "session", "reason", "agentId"]

for name, idx in CASES.items():
    maps = {"s": {}, "p": {}, "i": {}}
    def short(kind, value):
        m = maps[kind]
        return m.setdefault(value, f"{kind}{len(m) + 1}")
    base = L[idx[0]]["ts"]
    lines = []
    for i in idx:
        d = L[i]
        e = d["event"]
        if d["src"] == "hook":
            c = {k: e[k] for k in HOOK_KEEP if k in e}
            c["session_id"] = short("s", e["session_id"])
            if "prompt_id" in e:
                c["prompt_id"] = short("p", e["prompt_id"])
            if "tool_input" in e:
                # Each field's value becomes a placeholder; the field names stay, since
                # AskUserQuestion's PostToolUse adds an "answers" field.
                c["tool_input"] = {k: short("i", json.dumps(v, sort_keys=True)) for k, v in e["tool_input"].items()}
        else:
            c = {k: e[k] for k in MOD_KEEP if k in e}
            c["session"] = short("s", e["session"])
            c["ts"] = round(e["ts"] - base, 3)
        lines.append(json.dumps({"line": i + 1, "at": round(d["ts"] - base, 3), "src": d["src"], "event": c}))
    with open(f"{out}/{name}", "w") as f:
        f.write("\n".join(lines) + "\n")
    print(name, len(lines))
