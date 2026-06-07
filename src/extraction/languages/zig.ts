import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getNodeText, getChildByField } from '../tree-sitter-helpers';
import type { LanguageExtractor, ExtractorContext } from '../tree-sitter-types';

const ZIG_TYPE_DECL_TYPES = new Set([
  'struct_declaration',
  'enum_declaration',
  'union_declaration',
  'opaque_declaration',
  'error_set_declaration',
]);

const INSTANTIATION_KINDS = new Set(['struct_initializer']);

/** Type-expression node types that indicate a type alias (not a struct/enum/opaque). */
const TYPE_ALIAS_NODE_TYPES = new Set([
  'pointer_type', 'fn', 'function_signature', 'builtin_type',
  'slice_type', 'array_type', 'optional_type', 'error_union_type',
  'field_expression', 'identifier', 'type_expression', 'primary_type_expression',
]);

function hasKeyword(node: SyntaxNode, keyword: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)?.type === keyword) return true;
  }
  return false;
}

function findTypeDeclaration(node: SyntaxNode): SyntaxNode | null {
  if (ZIG_TYPE_DECL_TYPES.has(node.type)) return node;
  if (
    node.type === 'type_expression' ||
    node.type === 'primary_type_expression' ||
    node.type === 'parenthesized_expression'
  ) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;
      const found = findTypeDeclaration(child);
      if (found) return found;
    }
  }
  return null;
}

function buildFieldChain(node: SyntaxNode, source: string): string {
  const object = getChildByField(node, 'object');
  const member = getChildByField(node, 'member');
  const memberName = member ? getNodeText(member, source) : '';
  if (object && object.type === 'field_expression') {
    return buildFieldChain(object, source) + '.' + memberName;
  }
  const objectName = object ? getNodeText(object, source) : '';
  if (objectName && memberName) {
    // Skip `self`/`this`/`super` receivers — these are method-call
    // conventions, not real type names. The bare method name is used
    // so the resolver can match it against the enclosing container.
    const SKIP_RECEIVERS = new Set(['self', 'this', 'super']);
    if (SKIP_RECEIVERS.has(objectName)) return memberName;
    return objectName + '.' + memberName;
  }
  return objectName || memberName;
}

function findImportBuiltin(node: SyntaxNode, source: string): SyntaxNode | null {
  if (node.type === 'builtin_function') {
    const text = source.substring(node.startIndex, node.endIndex);
    if (/@import\s*\(\s*"([^"]+)"\s*\)/.test(text)) return node;
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    const found = findImportBuiltin(child, source);
    if (found) return found;
  }
  return null;
}

/** Check if a node ID on the stack belongs to a container type (struct/enum/union/opaque). */
function isInsideContainer(nodeStack: readonly string[], nodes: ReadonlyArray<{ id: string; kind: string }>): boolean {
  if (nodeStack.length === 0) return false;
  const parentId = nodeStack[nodeStack.length - 1];
  if (!parentId) return false;
  const parentNode = nodes.find((n) => n.id === parentId);
  if (!parentNode) return false;
  return parentNode.kind === 'struct' || parentNode.kind === 'enum' ||
    parentNode.kind === 'class' || parentNode.kind === 'interface' ||
    parentNode.kind === 'trait' || parentNode.kind === 'module';
}

/** Walk a function/method body to extract call references, resolving chained field chains. */
function walkBodyForCalls(body: SyntaxNode, functionId: string, ctx: ExtractorContext): void {
  const visit = (node: SyntaxNode): void => {
    if (node.type === 'call_expression') {
      const func = node.namedChild(0);
      if (!func) return;
      let calleeName: string;
      if (func.type === 'field_expression') {
        calleeName = buildFieldChain(func, ctx.source);
      } else if (func.type === 'identifier') {
        calleeName = getNodeText(func, ctx.source);
      } else {
        calleeName = ctx.source.substring(func.startIndex, func.endIndex);
      }
      if (calleeName) {
        ctx.addUnresolvedReference({
          fromNodeId: functionId,
          referenceName: calleeName,
          referenceKind: 'calls',
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        });
      }
    } else if (node.type === 'builtin_function') {
      // @as, @ptrCast, @sizeOf, @intCast, etc. (non-@import builtins)
      const text = ctx.source.substring(node.startIndex, Math.min(node.endIndex, node.startIndex + 40));
      if (!/@import\s*\(/.test(text)) {
        // Extract the builtin name: @foo or @"foo"
        const m = text.match(/^@[a-zA-Z_]\w*/);
        if (m) {
          ctx.addUnresolvedReference({
            fromNodeId: functionId,
            referenceName: m[0],
            referenceKind: 'calls',
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
          });
        }
      }
    } else if (INSTANTIATION_KINDS.has(node.type)) {
      // struct_initializer: Foo{} or Foo{.x=1} → instantiates Foo
      const typeId = node.namedChild(0);
      if (typeId?.type === 'identifier') {
        const typeName = getNodeText(typeId, ctx.source);
        if (typeName) {
          ctx.addUnresolvedReference({
            fromNodeId: functionId,
            referenceName: typeName,
            referenceKind: 'instantiates',
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
          });
        }
      }
    } else if (node.type === 'anonymous_struct_initializer') {
      const typeNode = getChildByField(node, 'type') ?? getChildByField(node, 'constructor') ?? node.namedChild(0);
      if (typeNode) {
        let name = getNodeText(typeNode, ctx.source);
        const lt = name.indexOf('<');
        if (lt > 0) name = name.slice(0, lt);
        ctx.addUnresolvedReference({
          fromNodeId: functionId,
          referenceName: name,
          referenceKind: 'instantiates',
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        });
      }
    }
    // Recurse into all children for nested calls
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) visit(child);
    }
  };
  visit(body);
}

function extractFnName(node: SyntaxNode, source: string): string {
  const nameField = getChildByField(node, 'name');
  if (nameField) return getNodeText(nameField, source);
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === 'identifier') return getNodeText(child, source);
  }
  return '';
}

function findFnBody(node: SyntaxNode): SyntaxNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === 'block') return child;
  }
  return null;
}

function extractFnSignature(node: SyntaxNode, source: string): string | undefined {
  let paramsNode: SyntaxNode | null = null;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === 'parameters') { paramsNode = child; break; }
  }
  const returnType = getChildByField(node, 'type');
  let sig = paramsNode ? getNodeText(paramsNode, source) : '';
  if (returnType) sig += ' ' + getNodeText(returnType, source);
  return sig.trim() || undefined;
}

/** Walk a Zig type subtree to find custom type identifiers, emitting `references`. */
function extractZigTypeRefs(node: SyntaxNode, fromNodeId: string, ctx: ExtractorContext): void {
  if (node.type === 'builtin_type') return;
  if (node.type === 'parameter') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child || child.type === 'identifier') continue;
      extractZigTypeRefs(child, fromNodeId, ctx);
    }
    return;
  }
  // field_expression like `std.mem.Allocator`: only the last identifier
  // (`Allocator`) is the type — skip the module-path segments (`std`, `mem`).
  if (node.type === 'field_expression') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;
      // The `object` part is the namespace chain — only recurse, don't emit
      if (child.type === 'field_expression' || child.type === 'identifier') {
        const fieldName = node.fieldNameForNamedChild(i);
        if (fieldName === 'object') continue; // module path, not a type ref
        extractZigTypeRefs(child, fromNodeId, ctx);
      } else {
        extractZigTypeRefs(child, fromNodeId, ctx);
      }
    }
    return;
  }
  if (node.type === 'identifier') {
    ctx.addUnresolvedReference({
      fromNodeId,
      referenceName: getNodeText(node, ctx.source),
      referenceKind: 'references',
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
    });
    return;
  }
  if (node.type === 'anonymous_struct_initializer' || node.type === 'struct_initializer') return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) extractZigTypeRefs(child, fromNodeId, ctx);
  }
}

/** Extract type references from a Zig function_declaration's parameters and return type. */
function extractFnTypeRefs(node: SyntaxNode, nodeId: string, ctx: ExtractorContext): void {
  // Parameters — not a named field in tree-sitter-zig
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === 'parameters') {
      extractZigTypeRefs(child, nodeId, ctx);
      break;
    }
  }
  // Return type — the `type` named field
  const returnType = getChildByField(node, 'type');
  if (returnType) extractZigTypeRefs(returnType, nodeId, ctx);
}

export const zigExtractor: LanguageExtractor = {
  functionTypes: ['function_declaration'],
  classTypes: [],
  methodTypes: ['function_declaration'],
  interfaceTypes: [],
  structTypes: [
    'struct_declaration', 'enum_declaration', 'union_declaration',
    'opaque_declaration', 'error_set_declaration',
  ],
  enumTypes: [],
  typeAliasTypes: [],
  importTypes: [],
  callTypes: ['call_expression', 'builtin_function'],
  variableTypes: ['variable_declaration'],
  fieldTypes: ['container_field'],
  nameField: 'name',
  bodyField: 'body',
  paramsField: 'parameters',
  returnField: 'type',

  classifyClassNode: (node) => {
    if (hasKeyword(node, 'enum') || hasKeyword(node, 'error')) return 'enum';
    return 'struct';
  },

  getVisibility: (node) => {
    if (hasKeyword(node, 'pub') || hasKeyword(node, 'export')) return 'public';
    return 'private';
  },

  isExported: (node) => hasKeyword(node, 'pub') || hasKeyword(node, 'export'),

  isConst: (node) => hasKeyword(node, 'const'),

  getSignature: (node, source) => extractFnSignature(node, source),

  visitNode: (node, ctx) => {
    // ---------- function_declaration (including methods) ----------
    // Handled entirely in visitNode because the core's visitFunctionBody
    // bypasses this hook when walking call expressions, and the default
    // extractCall cannot resolve nested field_expression chains
    // (e.g. std.debug.print resolves to just "print").
    if (node.type === 'function_declaration') {
      const name = extractFnName(node, ctx.source);
      const body = findFnBody(node);
      if (!name || !body) return false;

      const isMethod = isInsideContainer(ctx.nodeStack, ctx.nodes);
      const kind = isMethod ? 'method' : 'function';
      const isPub = hasKeyword(node, 'pub');
      const isExport = hasKeyword(node, 'export');

      const fnNode = ctx.createNode(kind, name, node, {
        signature: extractFnSignature(node, ctx.source),
        visibility: (isPub || isExport) ? 'public' : 'private',
        isExported: isPub || isExport,
      });
      if (!fnNode) return true;

      ctx.pushScope(fnNode.id);
      walkBodyForCalls(body, fnNode.id, ctx);
      extractFnTypeRefs(node, fnNode.id, ctx);
      ctx.popScope();
      return true;
    }

    // ---------- variable_declaration ----------
    if (node.type === 'variable_declaration') {
      let name = '';
      let valueNode: SyntaxNode | null = null;

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child) continue;
        if (child.type === 'identifier' && !name) {
          name = getNodeText(child, ctx.source);
          continue;
        }
        if (name && !valueNode) valueNode = findTypeDeclaration(child);
      }

      // Named type: const Foo = struct/enum/union/opaque { ... };
      if (name && valueNode) {
        const isPub = hasKeyword(node, 'pub');
        const isEnum = valueNode.type === 'enum_declaration' || valueNode.type === 'error_set_declaration';
        const kind = isEnum ? 'enum' : 'struct';

        const typeNode = ctx.createNode(kind, name, node, {
          visibility: isPub ? 'public' : 'private',
          isExported: isPub,
        });
        if (!typeNode) return true;

        ctx.pushScope(typeNode.id);
        for (let i = 0; i < valueNode.namedChildCount; i++) {
          const child = valueNode.namedChild(i);
          if (!child) continue;
          if (child.type === 'container_field' && isEnum) {
            const nameField = getChildByField(child, 'name');
            if (nameField) {
              const memberName = getNodeText(nameField, ctx.source);
              if (memberName !== '_') ctx.createNode('enum_member', memberName, child);
            }
          } else {
            ctx.visitNode(child);
          }
        }
        ctx.popScope();
        return true;
      }

      // @import — may be direct or nested inside field_expression.
      // Create an `import` node (like Java) for each @import, plus an
      // unresolved `imports` reference. Return `true` to skip the core's
      // extractVariable (avoids duplicate `constant` node).
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child) continue;
        const importNode = findImportBuiltin(child, ctx.source);
        if (importNode) {
          const text = ctx.source.substring(importNode.startIndex, importNode.endIndex);
          const m = text.match(/@import\s*\(\s*"([^"]+)"\s*\)/);
          if (m) {
            const moduleName = m[1]!;
            const sig = ctx.source.substring(node.startIndex, Math.min(node.endIndex, node.startIndex + 80)).trim();
            const importId = ctx.createNode('import', moduleName, node, { signature: sig });
            if (importId) {
              ctx.addUnresolvedReference({
                fromNodeId: importId.id,
                referenceName: moduleName,
                referenceKind: 'imports',
                line: importNode.startPosition.row + 1,
                column: importNode.startPosition.column,
              });
            }
          }
        }
      }
      // Skip core's extractVariable if we found an @import
      for (let i = 0; i < node.namedChildCount; i++) {
        if (node.namedChild(i) && findImportBuiltin(node.namedChild(i)!, ctx.source)) return true;
      }

      // Type alias: const Name = type_expression (not a struct/enum/opaque).
      // e.g. `pub const Callback = *const fn() void;` or `pub const MyInt = i32;`
      // Distinguished from a regular constant by having exactly 2 named children
      // (identifier + type expression) with NO value literal (integer/string/call).
      const VALUE_LITERAL_TYPES = new Set(['integer', 'string', 'float', 'boolean', 'call_expression', 'struct_initializer', 'anonymous_struct_initializer']);
      if (name && !valueNode && !hasKeyword(node, 'var') && node.namedChildCount === 2) {
        const second = node.namedChild(1);
        if (second && TYPE_ALIAS_NODE_TYPES.has(second.type) && !VALUE_LITERAL_TYPES.has(second.type)) {
          const isPub = hasKeyword(node, 'pub');
          ctx.createNode('type_alias', name, node, {
            visibility: isPub ? 'public' : 'private',
            isExported: isPub,
            signature: ctx.source.substring(second.startIndex, Math.min(second.endIndex, second.startIndex + 60)).trim(),
          });
          return true;
        }
      }

      return false;
    }

    // ---------- test_declaration ----------
    if (node.type === 'test_declaration') {
      let testName = '';
      let body: SyntaxNode | null = null;
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child) continue;
        if (!testName && child.type === 'string') {
          testName = ctx.source.substring(child.startIndex + 1, child.endIndex - 1);
        } else if (!testName && child.type === 'identifier') {
          testName = getNodeText(child, ctx.source);
        }
        if (child.type === 'block') body = child;
      }
      if (testName && body) {
        const fnNode = ctx.createNode('function', testName, node, {
          visibility: 'private',
          isExported: false,
        });
        if (fnNode) {
          ctx.pushScope(fnNode.id);
          walkBodyForCalls(body, fnNode.id, ctx);
          ctx.popScope();
        }
      }
      return true;
    }

    // ---------- comptime_declaration ----------
    if (node.type === 'comptime_declaration') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) ctx.visitNode(child);
      }
      return true;
    }

    // ---------- using_namespace_declaration ----------
    if (node.type === 'using_namespace_declaration') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) ctx.visitNode(child);
      }
      return true;
    }

    // ---------- @import builtins (standalone, not inside a variable) ----------
    if (node.type === 'call_expression' || node.type === 'builtin_function') {
      const text = ctx.source.substring(node.startIndex, node.endIndex);
      const m = text.match(/@import\s*\(\s*"([^"]+)"\s*\)/);
      if (m) {
        const moduleName = m[1]!;
        const importId = ctx.createNode('import', moduleName, node, { signature: text.trim() });
        if (importId) {
          ctx.addUnresolvedReference({
            fromNodeId: importId.id,
            referenceName: moduleName,
            referenceKind: 'imports',
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
          });
        }
        return true;
      }
      return false;
    }

    return false;
  },
};
