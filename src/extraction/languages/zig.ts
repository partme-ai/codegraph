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

const INSTANTIATION_KINDS = new Set(['new_expression', 'object_creation_expression']);

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
  if (objectName && memberName) return objectName + '.' + memberName;
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
    } else if (INSTANTIATION_KINDS.has(node.type)) {
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

      // @import — may be direct or nested inside field_expression
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child) continue;
        const importNode = findImportBuiltin(child, ctx.source);
        if (importNode) {
          const text = ctx.source.substring(importNode.startIndex, importNode.endIndex);
          const m = text.match(/@import\s*\(\s*"([^"]+)"\s*\)/);
          if (m) {
            ctx.addUnresolvedReference({
              fromNodeId: ctx.nodeStack[ctx.nodeStack.length - 1] || '',
              referenceName: m[1],
              referenceKind: 'imports',
              line: importNode.startPosition.row + 1,
              column: importNode.startPosition.column,
            });
          }
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
        const parentId = ctx.nodeStack[ctx.nodeStack.length - 1];
        if (parentId) {
          ctx.addUnresolvedReference({
            fromNodeId: parentId,
            referenceName: m[1],
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
