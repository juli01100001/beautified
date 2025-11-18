
const editor = document.getElementById("editor");

let debounceTimer = null;
editor.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const raw = editor.innerText;
    if (raw && raw.trim().length) {
      const out = advancedBeautify(raw);
      const findings = scanSensitivePatterns(out);
      const html = annotateSensitive(escapeHtml(out), findings);
      replaceEditorHtmlPreserveCaret(editor, html);
    }
  }, 120);
});

editor.addEventListener("paste", () => {
  setTimeout(() => {
    const raw = editor.innerText;
    if (raw && raw.trim().length) {
      const out = advancedBeautify(raw);
      const findings = scanSensitivePatterns(out);
      const html = annotateSensitive(escapeHtml(out), findings);
      replaceEditorHtmlPreserveCaret(editor, html);
    }
  }, 30);
});

editor.addEventListener("drop", e => {
  e.preventDefault();
  const text = e.dataTransfer.getData("text/plain");
  if (text && text.trim().length) {
    const out = advancedBeautify(text);
    const findings = scanSensitivePatterns(out);
    const html = annotateSensitive(escapeHtml(out), findings);
    replaceEditorHtmlPreserveCaret(editor, html);
  }
});

function advancedBeautify(src) {
  src = src.replace(/\r/g, "");
  const tokens = lex(src);
  const rebuilt = reconstruct(tokens);
  return postProcess(rebuilt);
}

function escapeHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function scanSensitivePatterns(code) {
  const findings = [];
  let m;

  const urls = /\b(?:https?|ftp):\/\/[^\s"'`]+/g;
  while ((m = urls.exec(code)) !== null)
    findings.push({type:"url", value:m[0], index:m.index, length:m[0].length});

  const base64 = /\b[A-Za-z0-9+\/]{20,}={0,2}\b/g;
  while ((m = base64.exec(code)) !== null)
    findings.push({type:"base64_long", value:m[0], index:m.index, length:m[0].length});

  const jwt = /\b[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\b/g;
  while ((m = jwt.exec(code)) !== null)
    findings.push({type:"secret", value:m[0], index:m.index, length:m[0].length});

  const awsAccess = /\bAKIA[0-9A-Z]{16}\b/g;
  while ((m = awsAccess.exec(code)) !== null)
    findings.push({type:"secret", value:m[0], index:m.index, length:m[0].length});

  const longTokens = /\b[A-Za-z0-9_\-=]{25,}\b/g;
  while ((m = longTokens.exec(code)) !== null)
    findings.push({type:"secret", value:m[0], index:m.index, length:m[0].length});

  return findings;
}

function annotateSensitive(escapedCode, findings) {
  if (!findings.length) return escapedCode.replace(/\n/g,"<br>");
  findings.sort((a,b)=>b.index-a.index);
  let out = escapedCode;
  for (const f of findings) {
    const start = f.index;
    const len = f.length;
    const before = out.slice(0, start);
    const mid = out.slice(start, start+len);
    const after = out.slice(start+len);
    const cls = {
      url: "hl-url",
      base64_long: "hl-b64",
      secret: "hl-secret"
    }[f.type] || "hl-secret";
    out = before + `<span class="${cls}">${mid}</span>` + after;
  }
  out = out.replace(/\n/g,"<br>");
  return out;
}


function replaceEditorHtmlPreserveCaret(el, html) {
  const offset = getCaretCharacterOffsetWithin(el);
  el.innerHTML = html;
  setCaretPositionFromOffset(el, offset);
}

function getCaretCharacterOffsetWithin(element) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(element);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

function setCaretPositionFromOffset(element, chars) {
  if (chars <= 0) {
    element.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(element);
    r.collapse(true);
    sel.addRange(r);
    return;
  }
  const nodeStack = [element];
  let node, found = false;
  let charCount = 0;
  let range = document.createRange();
  while (nodeStack.length && !found) {
    node = nodeStack.shift();
    if (node.nodeType === 3) {
      const nextCharCount = charCount + node.length;
      if (chars <= nextCharCount) {
        range.setStart(node, chars - charCount);
        range.collapse(true);
        found = true;
        break;
      } else charCount = nextCharCount;
    } else {
      let i = 0;
      for (; i < node.childNodes.length; i++) nodeStack.unshift(node.childNodes[i]);
    }
  }
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  element.focus();
}

function lex(code) {
  const tokens = [];
  const len = code.length;
  let i = 0;
  const isWhitespace = ch => /\s/.test(ch);
  const isIdStart = ch => /[A-Za-z_$]/.test(ch);
  const isId = ch => /[A-Za-z0-9_$]/.test(ch);
  const twoCharOps = new Set(['==','!=','+=','-=','*=','/=','&&','||','<=','>=','<<','>>','=>','===','!==','>>>','<<=','>>=','**','?.','??']);
  const threeCharOps = new Set(['===','!==','>>>','<<=','>>=']);
  const singleOps = new Set(['+','-','*','/','%','<','>','!','&','|','^','~','?',';',':',',','.','(',')','{','}','[',']','=','@']);
  while (i < len) {
    const ch = code[i];
    if (isWhitespace(ch)) { i++; continue; }
    if (ch === '/' && code[i+1] === '/') {
      let j = i + 2;
      while (j < len && code[j] !== '\n') j++;
      tokens.push({type:'comment', value: code.slice(i, j)});
      i = j;
      continue;
    }
    if (ch === '/' && code[i+1] === '*') {
      let j = i + 2;
      while (j < len && !(code[j] === '*' && code[j+1] === '/')) j++;
      j = Math.min(j+2, len);
      tokens.push({type:'comment', value: code.slice(i, j)});
      i = j;
      continue;
    }
    if (ch === "'" || ch === '"' ) {
      const quote = ch;
      let j = i+1;
      let acc = quote;
      while (j < len) {
        const c = code[j];
        acc += c;
        if (c === '\\') {
          if (j+1 < len) { acc += code[j+1]; j += 2; continue; }
        } else if (c === quote) { j++; break; }
        j++;
      }
      tokens.push({type:'string', value: acc});
      i = j;
      continue;
    }
    if (ch === '`') {
      let j = i+1;
      let acc = '`';
      while (j < len) {
        const c = code[j];
        acc += c;
        if (c === '\\') { if (j+1 < len) { acc += code[j+1]; j += 2; continue; } }
        if (c === '`') { j++; break; }
        j++;
      }
      tokens.push({type:'template', value: acc});
      i = j;
      continue;
    }
    if (ch === '/') {
      let k = i-1;
      while (k >= 0 && /\s/.test(code[k])) k--;
      const prev = k >= 0 ? code[k] : '';
      const regexStarters = ['(', '[', '=', ':', ',', '!', '?', '{', '}', ';'];
      const likelyRegex = prev === '' || regexStarters.includes(prev) || prev === '\n' || prev === '/';
      if (likelyRegex) {
        let j = i+1; let acc = '/'; let inClass = false;
        while (j < len) {
          const c = code[j];
          acc += c;
          if (c === '\\') { if (j+1 < len) { acc += code[j+1]; j += 2; continue; } }
          if (!inClass && c === '/') { j++; break; }
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          j++;
        }
        while (j < len && /[gimsuy]/.test(code[j])) { acc += code[j]; j++; }
        tokens.push({type:'regex', value: acc});
        i = j;
        continue;
      }
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      let acc = '';
      while (j < len && /[0-9xX_.abcdefABCDEF]/.test(code[j])) { acc += code[j++]; }
      tokens.push({type:'number', value: acc});
      i = j;
      continue;
    }
    if (isIdStart(ch)) {
      let j = i+1;
      while (j < len && isId(code[j])) j++;
      const word = code.slice(i, j);
      tokens.push({type:'identifier', value: word});
      i = j;
      continue;
    }
    const three = code.substr(i,3);
    if (threeCharOps.has(three)) {
      tokens.push({type:'op', value: three});
      i += 3;
      continue;
    }
    const two = code.substr(i,2);
    if (twoCharOps.has(two)) {
      tokens.push({type:'op', value: two});
      i += 2;
      continue;
    }
    if (singleOps.has(ch)) {
      tokens.push({type:'op', value: ch});
      i++;
      continue;
    }
    tokens.push({type:'unknown', value: ch});
    i++;
  }
  return tokens;
}

function reconstruct(tokens) {
  let out = "";
  let indent = 0;
  const indentStr = () => "    ".repeat(indent);
  let needIndent = true;
  const isKeyword = t => t.type === 'identifier' && /^(if|for|while|switch|try|catch|finally|function|export|return|throw|else|case|default|const|let|var|async|await)$/.test(t.value);
  const noSpaceBefore = new Set([',', ';', ')', ']', '}', ':']);
  const noSpaceAfter = new Set(['(', '[', '.', '?.']);
  const unaryOps = new Set(['!', 'typeof', 'void', 'delete', '+', '-', '++', '--', '~']);
  const blockOpeners = new Set(['{']);
  const blockClosers = new Set(['}']);
  let prev = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'comment') {
      if (!needIndent) out += "\n";
      out += indentStr() + t.value.trim() + "\n";
      needIndent = true;
      prev = t;
      continue;
    }
    if (t.type === 'op' && t.value === '{') {
      if (!needIndent && out && !out.endsWith(' ')) out += ' ';
      out += "{\n";
      indent++;
      needIndent = true;
      prev = t;
      continue;
    }
    if (t.type === 'op' && t.value === '}') {
      indent = Math.max(0, indent - 1);
      if (!needIndent) out += "\n";
      out += indentStr() + "}";
      const nx = tokens[i+1];
      if (nx && nx.type === 'op' && nx.value === ';') { out += ";"; i++; }
      out += "\n";
      needIndent = true;
      prev = t;
      continue;
    }
    if (t.type === 'op' && t.value === ';') {
      out = out.trimEnd() + ";\n";
      needIndent = true;
      prev = t;
      continue;
    }
    if (t.type === 'identifier' && (t.value === 'case' || t.value === 'default')) {
      if (!needIndent) out += "\n";
      out += indentStr() + t.value + " ";
      let j = i+1;
      while (j < tokens.length && !(tokens[j].type === 'op' && tokens[j].value === ':')) {
        const tt = tokens[j];
        out += renderTokenInline(tt, prev);
        prev = tt;
        j++;
      }
      if (j < tokens.length && tokens[j].type === 'op' && tokens[j].value === ':') {
        out += ":\n";
        i = j;
        needIndent = true;
        prev = tokens[j];
        continue;
      }
    }
    if (t.type === 'identifier' && t.value === 'else') {
      out = out.trimEnd() + "\n";
      out += indentStr() + "else ";
      needIndent = false;
      prev = t;
      continue;
    }
    if (t.type === 'identifier' && (t.value === 'return' || t.value === 'throw')) {
      if (needIndent) out += indentStr();
      out += t.value + " ";
      needIndent = false;
      prev = t;
      continue;
    }
    if (needIndent) out += indentStr();
    const add = renderTokenInline(t, prev);
    out += add;
    needIndent = false;
    prev = t;
  }
  return out.trim() + "\n";
}

function renderTokenInline(t, prev) {
  if (t.type === 'string' || t.type === 'template' || t.type === 'regex' || t.type === 'number') return t.value;
  if (t.type === 'comment') return t.value;
  if (t.type === 'identifier') {
    if (prev && (prev.type === 'identifier' || prev.type === 'number' || (prev.type === 'op' && prev.value === ')'))) return ' ' + t.value;
    return t.value;
  }
  if (t.type === 'op') {
    if (t.value === '.') return '.';
    if (t.value === '?.') return '?.';
    if (t.value === '(') return '(';
    if (t.value === ')') return ')';
    if (t.value === '[') return '[';
    if (t.value === ']') return ']';
    if (t.value === ',') return ', ';
    if (t.value === ':') return ':';
    if (t.value === ';') return ';';
    if ((t.value === '!' || t.value === '+' || t.value === '-' || t.value === '~') && (!prev || prev.type === 'op' || (prev.type === 'identifier' && prev.value === 'return'))) {
      return t.value;
    }
    if (/^[+\-*/%=&|^<>!]+$/.test(t.value) || ['===','!==','==','!=','=>','<=','>=','&&','||','??'].includes(t.value)) {
      return ' ' + t.value + ' ';
    }
    return t.value;
  }
  return t.value;
}

function postProcess(s) {
  s = s.replace(/ +, /g, ', ').replace(/ +;/g, ';');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.split('\n').map(line => line.replace(/\s+$/,'')).join('\n');
  return s;
}

function placeCaretAtEnd(el) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}