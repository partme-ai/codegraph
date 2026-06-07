/**
 * Zig Extraction Tests
 *
 * Tests for tree-sitter-zig based extraction.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { extractFromSource } from '../src/extraction';
import { detectLanguage, isLanguageSupported, initGrammars, loadGrammarsForLanguages } from '../src/extraction/grammars';

beforeAll(async () => {
  await initGrammars();
  await loadGrammarsForLanguages(['zig']);
});

describe('Zig Language Detection', () => {
  it('should detect .zig files as zig', () => {
    expect(detectLanguage('main.zig')).toBe('zig');
  });

  it('should detect .zon files as zig', () => {
    expect(detectLanguage('build.zig.zon')).toBe('zig');
  });

  it('should report zig as supported', () => {
    expect(isLanguageSupported('zig')).toBe(true);
  });
});

describe('Zig Function Extraction', () => {
  it('should extract a basic function', () => {
    const code = `
fn add(a: i32, b: i32) i32 {
    return a + b;
}
`;
    const result = extractFromSource('math.zig', code);
    const funcs = result.nodes.filter((n) => n.kind === 'function');
    expect(funcs.length).toBe(1);
    expect(funcs[0]?.name).toBe('add');
    expect(funcs[0]?.signature).toContain('a: i32, b: i32');
  });

  it('should extract a pub function as exported/visible', () => {
    const code = `
pub fn main() void {
    _ = add(1, 2);
}
`;
    const result = extractFromSource('main.zig', code);
    const funcs = result.nodes.filter((n) => n.kind === 'function');
    expect(funcs.length).toBe(1);
    expect(funcs[0]?.name).toBe('main');
    expect(funcs[0]?.isExported).toBe(true);
    expect(funcs[0]?.visibility).toBe('public');
  });

  it('should extract function with return type', () => {
    const code = `
fn calculate(x: f64) f64 {
    return x * 2.0;
}
`;
    const result = extractFromSource('calc.zig', code);
    const funcs = result.nodes.filter((n) => n.kind === 'function');
    expect(funcs.length).toBe(1);
    expect(funcs[0]?.signature).toContain('f64');
  });

  it('should extract multiple functions from the same file', () => {
    const code = `
fn foo() void { }
fn bar() void { }
pub fn baz() i32 { return 42; }
`;
    const result = extractFromSource('multi.zig', code);
    const funcs = result.nodes.filter((n) => n.kind === 'function');
    expect(funcs.length).toBe(3);
    const names = funcs.map((f) => f.name).sort();
    expect(names).toEqual(['bar', 'baz', 'foo']);
    expect(funcs.find((f) => f.name === 'baz')?.isExported).toBe(true);
  });
});

describe('Zig Type Declaration Extraction', () => {
  it('should extract a named struct from variable declaration', () => {
    const code = `
const Point = struct {
    x: f64,
    y: f64,
};
`;
    const result = extractFromSource('point.zig', code);
    const structs = result.nodes.filter((n) => n.kind === 'struct');
    expect(structs.length).toBe(1);
    expect(structs[0]?.name).toBe('Point');
  });

  it('should extract a pub struct with correct visibility', () => {
    const code = `
pub const Config = struct {
    port: u16,
    host: []const u8,
};
`;
    const result = extractFromSource('config.zig', code);
    const structs = result.nodes.filter((n) => n.kind === 'struct');
    expect(structs.length).toBe(1);
    expect(structs[0]?.name).toBe('Config');
    expect(structs[0]?.isExported).toBe(true);
    expect(structs[0]?.visibility).toBe('public');
  });

  it('should extract named enum from variable declaration', () => {
    const code = `
const Color = enum {
    red,
    green,
    blue,
};
`;
    const result = extractFromSource('color.zig', code);
    const enums = result.nodes.filter((n) => n.kind === 'enum');
    expect(enums.length).toBe(1);
    expect(enums[0]?.name).toBe('Color');
  });

  it('should extract enum members', () => {
    const code = `
const Status = enum {
    ok,
    not_found,
    pending,
};
`;
    const result = extractFromSource('status.zig', code);
    const members = result.nodes.filter((n) => n.kind === 'enum_member');
    expect(members.length).toBe(3);
    const names = members.map((m) => m.name).sort();
    expect(names).toEqual(['not_found', 'ok', 'pending']);
  });

  it('should extract named union from variable declaration', () => {
    const code = `
const Value = union(enum) {
    int: i32,
    float: f64,
    str: []const u8,
};
`;
    const result = extractFromSource('value.zig', code);
    const structs = result.nodes.filter((n) => n.kind === 'struct');
    expect(structs.some((s) => s.name === 'Value')).toBe(true);
  });

  it('should extract error set declaration', () => {
    const code = `
const MyError = error{
    NotFound,
    PermissionDenied,
    OutOfMemory,
};
`;
    const result = extractFromSource('errors.zig', code);
    const enums = result.nodes.filter((n) => n.kind === 'enum');
    expect(enums.some((n) => n.name === 'MyError')).toBe(true);
  });

  it('should extract opaque declaration', () => {
    const code = `
pub const Handle = opaque {
    pub fn close(self: *Handle) void {
        _ = self;
    }
};
`;
    const result = extractFromSource('handle.zig', code);
    const structs = result.nodes.filter((n) => n.kind === 'struct');
    expect(structs.some((s) => s.name === 'Handle')).toBe(true);
  });
});

describe('Zig Container Fields', () => {
  it('should extract struct fields', () => {
    const code = `
const User = struct {
    id: u64,
    name: []const u8,
    active: bool,
};
`;
    const result = extractFromSource('user.zig', code);
    const fields = result.nodes.filter((n) => n.kind === 'field');
    expect(fields.length).toBe(3);
    const names = fields.map((f) => f.name).sort();
    expect(names).toEqual(['active', 'id', 'name']);
  });
});

describe('Zig Methods', () => {
  it('should extract function declarations inside struct as methods', () => {
    const code = `
const Counter = struct {
    count: u32,

    pub fn init() Counter {
        return Counter{ .count = 0 };
    }

    pub fn increment(self: *Counter) void {
        self.count += 1;
    }
};
`;
    const result = extractFromSource('counter.zig', code);
    const methods = result.nodes.filter((n) => n.kind === 'method');
    expect(methods.length).toBe(2);
    const names = methods.map((m) => m.name).sort();
    expect(names).toEqual(['increment', 'init']);
  });
});

describe('Zig Variable Declarations', () => {
  it('should extract const declarations', () => {
    const code = `
const x: i32 = 42;
const greeting = "hello";
`;
    const result = extractFromSource('vars.zig', code);
    const consts = result.nodes.filter((n) => n.kind === 'constant');
    const vars = result.nodes.filter((n) => n.kind === 'variable');
    // Both are `const`, so both should be `constant`
    expect(consts.length + vars.length).toBeGreaterThanOrEqual(2);
  });

  it('should extract var declarations', () => {
    const code = `
var counter: u32 = 0;
var running = true;
`;
    const result = extractFromSource('mut.zig', code);
    const vars = result.nodes.filter((n) => n.kind === 'variable');
    expect(vars.length).toBeGreaterThanOrEqual(2);
    expect(vars.every((v) => v.name === 'counter' || v.name === 'running')).toBe(true);
  });

  it('should distinguish const from var', () => {
    const code = `
const immutable: u32 = 1;
var mutable: u32 = 0;
`;
    const result = extractFromSource('both.zig', code);
    const consts = result.nodes.filter((n) => n.kind === 'constant');
    const vars = result.nodes.filter((n) => n.kind === 'variable');
    expect(consts).toHaveLength(1);
    expect(vars).toHaveLength(1);
    expect(consts[0]?.name).toBe('immutable');
    expect(vars[0]?.name).toBe('mutable');
  });
});

describe('Zig @import Detection', () => {
  it('should detect @import calls and create import references', () => {
    const code = `
const std = @import("std");
const testing = @import("std").testing;
`;
    const result = extractFromSource('imports.zig', code);
    const refs = result.unresolvedReferences.filter((r) => r.referenceKind === 'imports');
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs.some((r) => r.referenceName === 'std')).toBe(true);
  });
});

describe('Zig Function Calls', () => {
  it('should track function calls inside function bodies', () => {
    const code = `
fn a() void { }
fn b() void { _ = a(); }
`;
    const result = extractFromSource('calls.zig', code);
    const calls = result.unresolvedReferences.filter((r) => r.referenceKind === 'calls');
    expect(calls.some((r) => r.referenceName === 'a')).toBe(true);
  });
});

describe('Zig Chained Method Calls', () => {
  it('resolves std.debug.print as full chain', () => {
    const code = `
const std = @import("std");
pub fn main() void {
    std.debug.print("hello\\n", .{});
}
`;
    const result = extractFromSource('chained.zig', code);
    const calls = result.unresolvedReferences.filter((r) => r.referenceKind === 'calls');
    expect(calls.some((r) => r.referenceName === 'std.debug.print')).toBe(true);
  });

  it('resolves std.mem.eql as full chain', () => {
    const code = `
const std = @import("std");
pub fn main() void {
    _ = std.mem.eql(u8, "a", "b");
}
`;
    const result = extractFromSource('mem.zig', code);
    const calls = result.unresolvedReferences.filter((r) => r.referenceKind === 'calls');
    expect(calls.some((r) => r.referenceName === 'std.mem.eql')).toBe(true);
  });

  it('resolves simple obj.method() correctly', () => {
    const code = `
const Foo = struct { pub fn bar(self: *Foo) void { } };
fn main() void { var f: Foo = undefined; f.bar(); }
`;
    const result = extractFromSource('obj.zig', code);
    const calls = result.unresolvedReferences.filter((r) => r.referenceKind === 'calls');
    expect(calls.some((r) => r.referenceName === 'f.bar')).toBe(true);
  });

  it('detects @import("std").testing import inside field expression', () => {
    const code = `
const testing = @import("std").testing;
`;
    const result = extractFromSource('stdtest.zig', code);
    const refs = result.unresolvedReferences.filter((r) => r.referenceKind === 'imports');
    expect(refs.some((r) => r.referenceName === 'std')).toBe(true);
  });
});

describe('Zig Test Declarations', () => {
  it('should extract a test declaration with string name as function', () => {
    const code = `
test "basic addition" {
    _ = add(1, 2);
}
`;
    const result = extractFromSource('test_basic.zig', code);
    const funcs = result.nodes.filter((n) => n.kind === 'function');
    expect(funcs.length).toBe(1);
    expect(funcs[0]?.name).toBe('basic addition');
  });

  it('should extract a test declaration with identifier name', () => {
    const code = `
test addWorks {
    _ = add(1, 2);
}
`;
    const result = extractFromSource('test_id.zig', code);
    const funcs = result.nodes.filter((n) => n.kind === 'function');
    expect(funcs.length).toBe(1);
    expect(funcs[0]?.name).toBe('addWorks');
  });

  it('should track calls inside test declarations', () => {
    const code = `
fn add(a: i32, b: i32) i32 { return a + b; }
test "uses add" { _ = add(1, 2); }
`;
    const result = extractFromSource('test_calls.zig', code);
    const calls = result.unresolvedReferences.filter((r) => r.referenceKind === 'calls');
    expect(calls.some((r) => r.referenceName === 'add')).toBe(true);
  });
});

describe('Zig Non-Exhaustive Enum', () => {
  it('should not extract _ as an enum member', () => {
    const code = `
const E = enum(u8) {
    a = 1,
    b,
    _,
};
`;
    const result = extractFromSource('nonexhaustive.zig', code);
    const members = result.nodes.filter((n) => n.kind === 'enum_member');
    const names = members.map((m) => m.name);
    expect(names).toEqual(['a', 'b']);
    expect(names).not.toContain('_');
  });
});

describe('Zig Export Visibility', () => {
  it('should treat export fn as exported', () => {
    const code = `
export fn hello() void { }
`;
    const result = extractFromSource('exportfn.zig', code);
    const funcs = result.nodes.filter((n) => n.kind === 'function');
    expect(funcs.length).toBe(1);
    expect(funcs[0]?.isExported).toBe(true);
    expect(funcs[0]?.visibility).toBe('public');
  });

  it('should track export fn call from another function', () => {
    const code = `
export fn run() void { }
fn main() void { _ = run(); }
`;
    const result = extractFromSource('export_calls.zig', code);
    const calls = result.unresolvedReferences.filter((r) => r.referenceKind === 'calls');
    expect(calls.some((r) => r.referenceName === 'run')).toBe(true);
  });
});

describe('Zig Comptime Blocks', () => {
  it('should extract declarations inside comptime blocks', () => {
    const code = `
comptime {
    const version: u32 = 1;
    var counter: u32 = 0;
}
`;
    const result = extractFromSource('comptime_vars.zig', code);
    const consts = result.nodes.filter((n) => n.kind === 'constant');
    const vars = result.nodes.filter((n) => n.kind === 'variable');
    expect(consts).toHaveLength(1);
    expect(vars).toHaveLength(1);
    expect(consts[0]?.name).toBe('version');
    expect(vars[0]?.name).toBe('counter');
  });
});

describe('Zig Packed and Extern Types', () => {
  it('should extract packed struct', () => {
    const code = `
const S = packed struct {
    x: i32,
    y: i32,
};
`;
    const result = extractFromSource('packed.zig', code);
    const structs = result.nodes.filter((n) => n.kind === 'struct');
    expect(structs.length).toBe(1);
    expect(structs[0]?.name).toBe('S');
  });

  it('should extract extern struct', () => {
    const code = `
const E = extern struct {
    id: u32,
    name: [32]u8,
};
`;
    const result = extractFromSource('extern_struct.zig', code);
    const structs = result.nodes.filter((n) => n.kind === 'struct');
    expect(structs.length).toBe(1);
    expect(structs[0]?.name).toBe('E');
  });
});

describe('Zig Threadlocal Variable', () => {
  it('should extract threadlocal var as variable (not constant)', () => {
    const code = `
threadlocal var counter: u32 = 0;
`;
    const result = extractFromSource('threadlocal.zig', code);
    const vars = result.nodes.filter((n) => n.kind === 'variable');
    expect(vars.length).toBe(1);
    expect(vars[0]?.name).toBe('counter');
  });
});

describe('Zig Usingnamespace', () => {
  it('should detect @import inside usingnamespace', () => {
    const code = `
usingnamespace @import("foo");
`;
    const result = extractFromSource('usingns.zig', code);
    const refs = result.unresolvedReferences.filter((r) => r.referenceKind === 'imports');
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs.some((r) => r.referenceName === 'foo')).toBe(true);
  });
});
