'use strict'

const SETUP_HELPERS = new Set([
  'defineProps',
  'defineEmits',
  'defineModel',
  'defineExpose',
  'defineOptions',
  'defineSlots',
])

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Flag <script setup> bindings whose actual usage is confined to a subtree of the template (a candidate for component extraction).',
      recommended: false,
    },
    schema: [
      {
        type: 'object',
        properties: {
          minLocalizedBindings: { type: 'integer', minimum: 1 },
          minSubtreeContent: { type: 'integer', minimum: 0 },
          ignorePatterns: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      overScoped:
        '`{{name}}` is only used inside <{{tag}}> at line {{line}}. Consider extracting that subtree into a child component so this binding can be local to it.',
      subtreeCandidate:
        '<{{tag}}> only depends on script-local bindings ({{names}}) that are not referenced elsewhere. Strong candidate for extraction into a child component.',
    },
  },

  create(context) {
    const services =
      context.parserServices ||
      (context.sourceCode && context.sourceCode.parserServices) ||
      {}
    if (typeof services.defineTemplateBodyVisitor !== 'function') {
      return {}
    }

    const options = context.options[0] || {}
    const minLocalized = options.minLocalizedBindings ?? 2
    const minSubtreeContent = options.minSubtreeContent ?? 1
    const ignorePatterns = (options.ignorePatterns || []).map(
      (p) => new RegExp(p)
    )

    function contentSize(elem) {
      if (!elem || !elem.children) return 0
      let n = 0
      for (const c of elem.children) {
        if (c.type === 'VElement') n++
        else if (c.type === 'VExpressionContainer') n++
        else if (c.type === 'VText' && c.value && c.value.trim().length > 0) n++
      }
      return n
    }

    /** name -> { declNode, refs: Set<VElement>, scriptUsed: boolean, bodyRange: [number, number] | null } */
    const bindings = new Map()

    function isHelperCall(node) {
      return (
        node &&
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        SETUP_HELPERS.has(node.callee.name)
      )
    }

    function bodyRangeOf(declNode) {
      if (declNode.type === 'VariableDeclarator' && declNode.init) {
        return [declNode.init.range[0], declNode.init.range[1]]
      }
      if (declNode.type === 'FunctionDeclaration' && declNode.body) {
        return [declNode.body.range[0], declNode.body.range[1]]
      }
      return null
    }

    function record(name, declNode) {
      if (bindings.has(name)) return
      if (ignorePatterns.some((r) => r.test(name))) return
      bindings.set(name, {
        declNode,
        refs: new Set(),
        scriptUsed: false,
        bodyRange: bodyRangeOf(declNode),
      })
    }

    function nearestVElement(node) {
      let cur = node && node.parent
      while (cur) {
        if (cur.type === 'VElement') return cur
        cur = cur.parent
      }
      return null
    }

    function ancestorsFromRoot(node) {
      const chain = []
      let cur = node
      while (cur) {
        chain.push(cur)
        cur = cur.parent
      }
      chain.reverse()
      return chain
    }

    function lca(nodes) {
      if (nodes.length === 0) return null
      let common = ancestorsFromRoot(nodes[0])
      for (let i = 1; i < nodes.length; i++) {
        const chain = ancestorsFromRoot(nodes[i])
        let j = 0
        while (j < common.length && j < chain.length && common[j] === chain[j]) {
          j++
        }
        common = common.slice(0, j)
        if (common.length === 0) return null
      }
      return common[common.length - 1]
    }

    function isRootEquivalent(node) {
      if (!node) return false
      if (node.type !== 'VElement') {
        // VDocumentFragment or anything above the root <template>
        return true
      }
      // The root <template> tag itself
      if (
        node.name === 'template' &&
        node.parent &&
        node.parent.type === 'VDocumentFragment'
      ) {
        return true
      }
      // The single root child of <template> (single-root SFCs)
      const parent = node.parent
      if (
        parent &&
        parent.type === 'VElement' &&
        parent.name === 'template' &&
        parent.parent &&
        parent.parent.type === 'VDocumentFragment'
      ) {
        const elementChildren = (parent.children || []).filter(
          (c) => c.type === 'VElement'
        )
        if (elementChildren.length === 1 && elementChildren[0] === node) {
          return true
        }
      }
      return false
    }

    function getModuleScope(programNode, sourceCode) {
      let scope = sourceCode.getScope
        ? sourceCode.getScope(programNode)
        : context.getScope()
      if (scope.type === 'global') {
        const child = (scope.childScopes || []).find(
          (s) => s.type === 'module'
        )
        if (child) return child
      }
      return scope
    }

    // Indirect-reference graph: usedName -> Set<containerBindingName>
    const indirectEdges = new Map()

    function analyzeScriptScope(programNode) {
      const sourceCode = context.sourceCode || context.getSourceCode()
      const scope = getModuleScope(programNode, sourceCode)
      const scriptRange = programNode.range

      function inScript(range) {
        return range[0] >= scriptRange[0] && range[1] <= scriptRange[1]
      }

      function findContainer(refRange) {
        for (const [n, b] of bindings) {
          const r = b.bodyRange
          if (r && refRange[0] >= r[0] && refRange[1] <= r[1]) return n
        }
        return null
      }

      function walk(s) {
        for (const variable of s.variables) {
          const b = bindings.get(variable.name)
          if (!b) continue
          const defRanges = (variable.defs || [])
            .map((d) => d.name && d.name.range)
            .filter(Boolean)
          const isDeclSite = (r) =>
            defRanges.some((dr) => dr[0] === r[0] && dr[1] === r[1])
          for (const ref of variable.references) {
            const id = ref.identifier
            if (!id || !id.range) continue
            if (ref.init) continue
            if (isDeclSite(id.range)) continue
            if (!inScript(id.range)) continue
            const containerName = findContainer(id.range)
            if (containerName && containerName !== variable.name) {
              if (!indirectEdges.has(variable.name)) {
                indirectEdges.set(variable.name, new Set())
              }
              indirectEdges.get(variable.name).add(containerName)
            } else {
              b.scriptUsed = true
            }
          }
        }
        for (const c of s.childScopes) walk(c)
      }
      walk(scope)
    }

    function finalReport() {
      // Propagate scriptUsed through the indirect graph
      let changed = true
      while (changed) {
        changed = false
        for (const [usedName, containers] of indirectEdges) {
          const b = bindings.get(usedName)
          if (!b || b.scriptUsed) continue
          for (const c of containers) {
            const cb = bindings.get(c)
            if (cb && cb.scriptUsed) {
              b.scriptUsed = true
              changed = true
              break
            }
          }
        }
      }

      function effectiveRefs(name, visited = new Set()) {
        if (visited.has(name)) return new Set()
        visited.add(name)
        const b = bindings.get(name)
        if (!b) return new Set()
        const acc = new Set(b.refs)
        const containers = indirectEdges.get(name) || new Set()
        for (const containerName of containers) {
          for (const r of effectiveRefs(containerName, visited)) acc.add(r)
        }
        return acc
      }

      const candidatesPerLca = new Map()
      for (const [name, b] of bindings) {
        if (b.scriptUsed) continue
        const eff = [...effectiveRefs(name)]
        if (eff.length === 0) continue
        const ancestor = lca(eff)
        if (!ancestor || isRootEquivalent(ancestor)) continue
        const elem =
          ancestor.type === 'VElement' ? ancestor : nearestVElement(ancestor)
        if (!elem || isRootEquivalent(elem)) continue

        const list = candidatesPerLca.get(elem) || []
        list.push({ name, declNode: b.declNode })
        candidatesPerLca.set(elem, list)
      }

      for (const [elem, list] of candidatesPerLca) {
        if (list.length < minLocalized) continue
        if (contentSize(elem) < minSubtreeContent) continue
        for (const { name, declNode } of list) {
          context.report({
            node: declNode,
            messageId: 'overScoped',
            data: { name, tag: elem.name, line: elem.loc.start.line },
          })
        }
        context.report({
          loc: elem.startTag.loc,
          messageId: 'subtreeCandidate',
          data: {
            tag: elem.name,
            names: list.map((c) => c.name).join(', '),
          },
        })
      }
    }

    return services.defineTemplateBodyVisitor(
      // ===== Template AST visitor =====
      {
        VExpressionContainer(node) {
          const refs = node.references || []
          for (const ref of refs) {
            const b = bindings.get(ref.id.name)
            if (!b) continue
            const elem = nearestVElement(ref.id)
            if (elem) b.refs.add(elem)
          }
        },
        "VElement[name='template']:exit"(node) {
          if (!node.parent || node.parent.type !== 'VDocumentFragment') return
          finalReport()
        },
      },
      // ===== Script AST visitor =====
      {
        'Program > VariableDeclaration > VariableDeclarator'(node) {
          if (isHelperCall(node.init)) return
          if (node.id.type === 'Identifier') {
            record(node.id.name, node)
          }
        },
        'Program > FunctionDeclaration'(node) {
          if (node.id) record(node.id.name, node)
        },
        'Program:exit'(programNode) {
          analyzeScriptScope(programNode)
        },
      }
    )
  },
}
