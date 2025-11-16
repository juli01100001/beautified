function unminify(code) {
  let out = "", indent = 0, inString = false, s = "", last = "";
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if ((c === '"' || c === "'" || c === "`") && last !== "\\" && !inString) { inString = true; s = c; }
    else if (inString && c === s && last !== "\\") inString = false;
    out += c;
    if (!inString) {
      if (c === "{") out += "\n" + "  ".repeat(++indent);
      else if (c === "}") out = out.trimEnd() + "\n" + "  ".repeat(--indent) + "}";
      else if (c === ";" || c === ",") out += "\n" + "  ".repeat(indent);
      else if (c === "\n") out += "  ".repeat(indent);
    }
    last = c;
  }
  return out.replace(/\n\s*\n+/g, "\n").trim();
}

const ed = document.getElementById("editor");

function transform() {
  ed.value = unminify(ed.value);
}

ed.addEventListener("input", () => {
  const pos = ed.selectionStart;
  transform();
  ed.selectionEnd = ed.selectionStart = pos;
});

ed.addEventListener("dragover", e => {
  e.preventDefault();
  ed.style.border = "2px dashed var(--accent)";
});
ed.addEventListener("dragleave", () => ed.style.border = "none");

ed.addEventListener("drop", e => {
  e.preventDefault();
  ed.style.border = "none";
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    ed.value = unminify(ev.target.result);
  };
  r.readAsText(f);
});

document.getElementById("themeToggle").onclick = () => {
  document.body.classList.toggle("dark");
  const b = document.getElementById("themeToggle");
  b.textContent = document.body.classList.contains("dark") ? "🌙" : "☀️";
};
