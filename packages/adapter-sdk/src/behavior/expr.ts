/**
 * Safe expression evaluator for the behavior DSL.
 *
 * Supports a small, sandboxed expression language used inside behavior packs:
 *   literals      42  3.14  'str'  "str"  true  false  null
 *   member access self.status   body.metadata.foo
 *   arrays        ['a', 'b']
 *   unary         !x   -n
 *   binary        == != < > <= >=   && ||   + - * / %   in
 *   ternary       cond ? a : b
 *   parens        (a + b)
 *
 * There is NO access to globals, functions, or `eval` — identifiers resolve
 * only against the provided scope object. This keeps adapter behavior packs
 * declarative and safe to ship as data.
 */

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'punc'; v: string };

const KEYWORDS: Record<string, unknown> = { true: true, false: false, null: null };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  const two = ['==', '!=', '<=', '>=', '&&', '||'];
  while (i < n) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    // string
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      let s = '';
      while (j < n && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < n) { s += src[j + 1]; j += 2; continue; }
        s += src[j]; j++;
      }
      if (j >= n) throw new Error(`Unterminated string in expression: ${src}`);
      toks.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    // number
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j]!)) j++;
      toks.push({ t: 'num', v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    // identifier / keyword / dotted path
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$.]/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      if (word === 'in') toks.push({ t: 'op', v: 'in' });
      else toks.push({ t: 'id', v: word });
      i = j;
      continue;
    }
    // two-char operators
    const pair = src.slice(i, i + 2);
    if (two.includes(pair)) { toks.push({ t: 'op', v: pair }); i += 2; continue; }
    // single-char
    if ('+-*/%<>!'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    if ('?:'.includes(c)) { toks.push({ t: 'punc', v: c }); i++; continue; }
    if ('()[],'.includes(c)) { toks.push({ t: 'punc', v: c }); i++; continue; }
    throw new Error(`Unexpected character '${c}' in expression: ${src}`);
  }
  return toks;
}

// Binary operator precedence (higher binds tighter).
const PREC: Record<string, number> = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3,
  '<': 4, '>': 4, '<=': 4, '>=': 4, 'in': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

class Parser {
  private pos = 0;
  constructor(private toks: Tok[], private src: string) {}

  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private next(): Tok | undefined { return this.toks[this.pos++]; }

  parse(): AstNode {
    const node = this.parseTernary();
    if (this.pos !== this.toks.length) throw new Error(`Trailing tokens in expression: ${this.src}`);
    return node;
  }

  private parseTernary(): AstNode {
    const cond = this.parseBinary(0);
    const p = this.peek();
    if (p && p.t === 'punc' && p.v === '?') {
      this.next();
      const yes = this.parseTernary();
      const colon = this.next();
      if (!colon || colon.t !== 'punc' || colon.v !== ':') throw new Error(`Expected ':' in ternary: ${this.src}`);
      const no = this.parseTernary();
      return { k: 'tern', cond, yes, no };
    }
    return cond;
  }

  private parseBinary(minPrec: number): AstNode {
    let left = this.parseUnary();
    for (;;) {
      const p = this.peek();
      if (!p || p.t !== 'op' || !(p.v in PREC)) break;
      const prec = PREC[p.v]!;
      if (prec < minPrec) break;
      this.next();
      const right = this.parseBinary(prec + 1);
      left = { k: 'bin', op: p.v, left, right };
    }
    return left;
  }

  private parseUnary(): AstNode {
    const p = this.peek();
    if (p && p.t === 'op' && (p.v === '!' || p.v === '-')) {
      this.next();
      return { k: 'un', op: p.v, arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): AstNode {
    const tok = this.next();
    if (!tok) throw new Error(`Unexpected end of expression: ${this.src}`);
    if (tok.t === 'num') return { k: 'lit', v: tok.v };
    if (tok.t === 'str') return { k: 'lit', v: tok.v };
    if (tok.t === 'id') {
      if (tok.v in KEYWORDS) return { k: 'lit', v: KEYWORDS[tok.v] };
      return { k: 'path', path: tok.v.split('.') };
    }
    if (tok.t === 'punc' && tok.v === '(') {
      const inner = this.parseTernary();
      const close = this.next();
      if (!close || close.t !== 'punc' || close.v !== ')') throw new Error(`Expected ')': ${this.src}`);
      return inner;
    }
    if (tok.t === 'punc' && tok.v === '[') {
      const items: AstNode[] = [];
      if (!(this.peek()?.t === 'punc' && this.peek()?.v === ']')) {
        for (;;) {
          items.push(this.parseTernary());
          const sep = this.peek();
          if (sep && sep.t === 'punc' && sep.v === ',') { this.next(); continue; }
          break;
        }
      }
      const close = this.next();
      if (!close || close.t !== 'punc' || close.v !== ']') throw new Error(`Expected ']': ${this.src}`);
      return { k: 'arr', items };
    }
    throw new Error(`Unexpected token ${JSON.stringify(tok)} in expression: ${this.src}`);
  }
}

type AstNode =
  | { k: 'lit'; v: unknown }
  | { k: 'path'; path: string[] }
  | { k: 'arr'; items: AstNode[] }
  | { k: 'un'; op: string; arg: AstNode }
  | { k: 'bin'; op: string; left: AstNode; right: AstNode }
  | { k: 'tern'; cond: AstNode; yes: AstNode; no: AstNode };

const cache = new Map<string, AstNode>();

function compile(src: string): AstNode {
  let ast = cache.get(src);
  if (!ast) {
    ast = new Parser(tokenize(src), src).parse();
    cache.set(src, ast);
  }
  return ast;
}

function resolvePath(path: string[], scope: Record<string, unknown>): unknown {
  let cur: unknown = scope;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function evalNode(node: AstNode, scope: Record<string, unknown>): unknown {
  switch (node.k) {
    case 'lit': return node.v;
    case 'path': return resolvePath(node.path, scope);
    case 'arr': return node.items.map((it) => evalNode(it, scope));
    case 'un': {
      const v = evalNode(node.arg, scope);
      return node.op === '!' ? !v : -(v as number);
    }
    case 'tern':
      return evalNode(node.cond, scope) ? evalNode(node.yes, scope) : evalNode(node.no, scope);
    case 'bin': {
      // Short-circuit logical operators.
      if (node.op === '&&') return evalNode(node.left, scope) && evalNode(node.right, scope);
      if (node.op === '||') return evalNode(node.left, scope) || evalNode(node.right, scope);
      const l = evalNode(node.left, scope) as never;
      const r = evalNode(node.right, scope) as never;
      switch (node.op) {
        // Equality is strict, EXCEPT null/undefined are treated as equal so
        // that the `x != null` nullish idiom matches both (as in JS `!= null`).
        case '==': return (l == null && r == null) ? true : l === r;
        case '!=': return (l == null && r == null) ? false : l !== r;
        case '<': return l < r;
        case '>': return l > r;
        case '<=': return l <= r;
        case '>=': return l >= r;
        case '+': return (l as never as number) + (r as never as number);
        case '-': return (l as unknown as number) - (r as unknown as number);
        case '*': return (l as unknown as number) * (r as unknown as number);
        case '/': return (l as unknown as number) / (r as unknown as number);
        case '%': return (l as unknown as number) % (r as unknown as number);
        case 'in': return Array.isArray(r) ? (r as unknown[]).includes(l) : false;
        default: throw new Error(`Unknown operator ${node.op}`);
      }
    }
  }
}

/** Evaluate a single expression string against a scope. */
export function evalExpr(src: string, scope: Record<string, unknown>): unknown {
  return evalNode(compile(src), scope);
}

/** Evaluate an expression to a boolean (used by guards / `when`). */
export function evalBool(src: string, scope: Record<string, unknown>): boolean {
  return Boolean(evalExpr(src, scope));
}

const TEMPLATE = /\{\{([^}]+)\}\}/g;

/**
 * Resolve a template value. Strings containing `{{ expr }}`:
 *   - a string that is *exactly* one `{{ expr }}` returns the raw typed value
 *   - otherwise each `{{ expr }}` is stringified and interpolated
 * Objects/arrays are resolved recursively; other primitives pass through.
 */
export function resolveTemplate(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const whole = value.match(/^\{\{([^}]+)\}\}$/);
    if (whole) return evalExpr(whole[1]!.trim(), scope);
    if (value.includes('{{')) {
      return value.replace(TEMPLATE, (_m, expr) => {
        const r = evalExpr(String(expr).trim(), scope);
        return r == null ? '' : String(r);
      });
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplate(v, scope));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveTemplate(v, scope);
    }
    return out;
  }
  return value;
}
