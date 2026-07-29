/**
 * Static checks on the wiring inside src/main.js.
 *
 * The modules introduced by #65 — process-guards, server-listen,
 * secure-response — are covered by their own unit tests, and those tests are
 * genuinely discriminant. But the defect issue #60 set out to close does not
 * live inside those modules: it lives at the point where main.js uses them.
 * Commenting out `installProcessGuards()` and putting `server.listen(PORT, cb)`
 * back in place of `listenWithRetry` reintroduces the exact crash-loop bug with
 * the whole suite still green, because src/main.js is excluded from
 * collectCoverageFrom and nothing else reads it.
 *
 * This is the same class of defect fixed in v0.12.2 (#57): a test covering a
 * reimplementation of the logic instead of the real site of the failure.
 *
 * src/main.js is not unit-testable as it stands — it wires a dozen singletons
 * and starts the process on require — so what is asserted here is the shape of
 * the source, in the same register as the static checks at the end of
 * tests/shell/install-sh.test.sh.
 *
 * It is parsed rather than grepped, for two reasons that decide the outcome:
 *
 * - the regression to catch is a call being *commented out*, and a
 *   commented-out call is simply absent from a syntax tree. No pattern has to
 *   be hand-tuned to tell code from prose.
 * - the negative assertions ("main.js never calls .listen directly") would
 *   otherwise fire on any prose mentioning the thing they forbid — including
 *   the comments in main.js that explain why it is forbidden.
 *
 * What this buys is narrow, and worth stating: it proves the calls are there,
 * not that they run or that their arguments are right. A test that loaded
 * main.js for real would prove more, but it would have to stub the entire
 * startup path and would then break on every new dependency main() acquires.
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const MAIN_PATH = path.join(__dirname, '..', '..', 'src', 'main.js');
const source = fs.readFileSync(MAIN_PATH, 'utf8');
const program = parse(source, { sourceType: 'script', attachComment: false }).program;

/** Depth-first walk over every node reachable from `node`. */
function walk(node, visit) {
  visit(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === 'string') walk(child, visit);
      }
    } else if (value && typeof value.type === 'string') {
      walk(value, visit);
    }
  }
}

function collect(predicate, root = program) {
  const found = [];
  walk(root, (node) => {
    if (predicate(node)) found.push(node);
  });
  return found;
}

function find(predicate) {
  return collect(predicate)[0] || null;
}

/** `name(...)` — a call on a bare identifier. */
function isCallTo(node, name) {
  return node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === name;
}

/** `<anything>.name(...)` — a method call, whatever the receiver. */
function methodCalls(name) {
  return collect((node) =>
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === name);
}

/** Local names bound by `const … = require(specifier)`. */
function requiredNames(specifier) {
  const names = new Set();
  collect((node) =>
    node.type === 'VariableDeclarator' &&
    node.init &&
    isCallTo(node.init, 'require') &&
    node.init.arguments.length === 1 &&
    node.init.arguments[0].type === 'StringLiteral' &&
    node.init.arguments[0].value === specifier
  ).forEach((declarator) => {
    if (declarator.id.type === 'Identifier') {
      names.add(declarator.id.name);
    } else if (declarator.id.type === 'ObjectPattern') {
      for (const property of declarator.id.properties) {
        if (property.type === 'ObjectProperty' && property.value.type === 'Identifier') {
          names.add(property.value.name);
        }
      }
    }
  });
  return names;
}

/** Index in the module body of the top-level statement calling `name`. */
function topLevelStatementCalling(name) {
  return program.body.findIndex((statement) =>
    collect((node) => isCallTo(node, name), statement).length > 0);
}

/** Offending source lines, formatted so a failure names the line to look at. */
function locate(nodes) {
  return nodes.map((node) =>
    `line ${node.loc.start.line}: ${source.slice(node.start, node.end).split('\n')[0].trim()}`);
}

describe('src/main.js wiring', () => {
  describe('process guards (#60)', () => {
    it('takes installProcessGuards from the module that is under test', () => {
      // Not a local reimplementation: the unit tests only mean something if
      // main.js runs the code they cover.
      expect(requiredNames('./process/process-guards')).toContain('installProcessGuards');
    });

    it('calls installProcessGuards() at module scope, before main() starts', () => {
      const guards = topLevelStatementCalling('installProcessGuards');
      const start = topLevelStatementCalling('main');

      // Inside main() the handlers would be installed after loadConfig() and
      // the constructors have already had their chance to throw, which is
      // precisely the window they exist to cover.
      expect(guards).toBeGreaterThanOrEqual(0);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(guards).toBeLessThan(start);
    });
  });

  describe('HTTP bind (#60)', () => {
    it('takes listenWithRetry from the module that is under test', () => {
      expect(requiredNames('./http/server-listen')).toContain('listenWithRetry');
    });

    it('binds the port through listenWithRetry', () => {
      const calls = collect((node) => isCallTo(node, 'listenWithRetry'));

      expect(calls).toHaveLength(1);
      // Server and port: a call short of those is not binding anything.
      expect(calls[0].arguments.length).toBeGreaterThanOrEqual(2);
    });

    it('never calls .listen() directly', () => {
      // server.listen(PORT, cb) wires only the success path. The 'error' event
      // is left without a listener, Node escalates that to an uncaught
      // exception, and it is emitted asynchronously — so neither the try/catch
      // in main() nor main().catch() ever sees it. Five such deaths inside
      // StartLimitIntervalSec exhaust systemd's StartLimitBurst and the unit
      // stops being restarted at all, which for an unattended box in an
      // elderly person's home means a house call.
      expect(locate(methodCalls('listen'))).toEqual([]);
    });

    it('keeps the handle and cancels the pending retry on shutdown', () => {
      const assignment = find((node) =>
        node.type === 'AssignmentExpression' &&
        isCallTo(node.right, 'listenWithRetry') &&
        node.left.type === 'Identifier');
      const declarator = find((node) =>
        node.type === 'VariableDeclarator' &&
        node.init &&
        isCallTo(node.init, 'listenWithRetry') &&
        node.id.type === 'Identifier');
      const handle = assignment ? assignment.left.name : declarator && declarator.id.name;

      expect(handle).toBeTruthy();

      // The retry timer is deliberately not unref'd, so a handle nobody
      // cancels holds the event loop open and turns SIGTERM into a systemd
      // timeout followed by SIGKILL.
      const cancels = collect((node) =>
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === handle &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'cancel');

      expect(cancels.length).toBeGreaterThan(0);
    });
  });

  describe('HTTP responses (#60)', () => {
    it('takes the response helpers from the module that is under test', () => {
      const names = requiredNames('./http/secure-response');

      expect(names).toContain('writeSecureResponse');
      expect(names).toContain('sendSecureJson');
    });

    it('never calls res.writeHead() directly', () => {
      // The handlers answer on the happy path and answer again from their
      // catch block. A bare writeHead on the second answer throws
      // ERR_HTTP_HEADERS_SENT, and since main.js dispatches those async
      // handlers without awaiting them, the throw becomes an unhandled
      // rejection — fatal since Node 15.
      expect(locate(methodCalls('writeHead'))).toEqual([]);
    });
  });
});
