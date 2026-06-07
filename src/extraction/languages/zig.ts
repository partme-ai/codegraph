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

export const zigExtractor: LanguageExtractor = {
  functionTypes: ['function_declaration'],
  classTypes: [],
  methodTypes: ['function_declaration'],
  interfaceTypes: [],
  structTypes: [
    'struct_declaration',
    'enum_declaration',
    'union_declaration',
    'opaque_declaration',
    'error_set_declaration',
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

  getVisibility: (node) => (hasKeyword(node, 'pub') ? 'public' : 'private'),

  isExported: (node) => hasKeyword(node, 'pub'),

  isConst: (node) => hasKeyword(node, 'const'),

  getSignature: (node, source) => {
    // tree-sitter-zig doesn't expose 'parameters' as a named field on
    // function_declaration — find the parameters node among named children.
    let paramsNode: SyntaxNode | null = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'parameters') {
        paramsNode = child;
        break;
      }
    }
    const returnType = getChildByField(node, 'type');
    let sig = paramsNode ? getNodeText(paramsNode, source) : '';
    if (returnType) sig += ' ' + getNodeText(returnType, source);
    return sig.trim() || undefined;
  },

  visitNode: (node, ctx) => {
    // Named type declarations: const Foo = struct { ... }; etc.
    // The variable_declaration wraps a type declaration as its value.
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
        if (name && !valueNode) {
          valueNode = findTypeDeclaration(child);
        }
      }

      if (name && valueNode) {
        const isPub = hasKeyword(node, 'pub');
        const isEnum =
          valueNode.type === 'enum_declaration' || valueNode.type === 'error_set_declaration';
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
              ctx.createNode('enum_member', getNodeText(nameField, ctx.source), child);
            }
          } else {
            ctx.visitNode(child);
          }
        }
        ctx.popScope();
        return true;
      }

      // Check if this variable wraps @import("...") — the value is a
      // builtin_function that extractVariable won't descend into.
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child) continue;
        if (child.type === 'builtin_function') {
          const text = ctx.source.substring(child.startIndex, child.endIndex);
          const m = text.match(/@import\s*\(\s*"([^"]+)"\s*\)/);
          if (m) {
            ctx.addUnresolvedReference({
              fromNodeId: ctx.nodeStack[ctx.nodeStack.length - 1] || '',
              referenceName: m[1],
              referenceKind: 'imports',
              line: child.startPosition.row + 1,
              column: child.startPosition.column,
            });
          }
        }
      }
      return false;
    }

    // @import("...") builtins — emit an imports reference.
    // tree-sitter-zig parses @import as builtin_function, not call_expression.
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
