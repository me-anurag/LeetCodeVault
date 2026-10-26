// Splits a (sanitized) LeetCode statement into the parts the phone reader shows separately:
// the problem text, each example's input / output / explanation, the constraints, and anything after them
// (follow-up, notes). Handles both the older <pre> examples and the newer `example-block` markup.
// If the statement has no recognizable structure, everything stays in `intro`.

const clean = (s) => (s || '').replace(/ /g, ' ').trim()
const isElement = (n) => n.nodeType === 1
const isExampleLabel = (n) => isElement(n) && /^example\s*\d*\s*:?$/i.test(clean(n.textContent))
const isConstraintsLabel = (n) => isElement(n) && /^constraints\s*:?$/i.test(clean(n.textContent))
const isExtraStart = (n) => /^(follow[- ]?up|note)\b/i.test(clean(n.textContent))
const isBlank = (n) =>
  (n.nodeType === 3 || isElement(n)) && !clean(n.textContent) && !(isElement(n) && (n.tagName === 'IMG' || n.querySelector('img')))
const fieldOf = (n) => {
  if (!isElement(n) || !['STRONG', 'B'].includes(n.tagName)) return null
  const m = /^(input|output|explanation)\s*:?$/i.exec(clean(n.textContent))
  return m ? m[1].toLowerCase() : null
}

function serialize(nodes) {
  const box = document.createElement('div')
  for (const n of nodes) box.append(n.cloneNode(true))
  return box.innerHTML.trim()
}

// The node list of the statement, unwrapping a single wrapper <div> if LeetCode added one.
function topLevel(html) {
  let root = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html').body
  const meaningful = () => [...root.childNodes].filter((n) => !isBlank(n) && n.nodeType !== 8)
  while (meaningful().length === 1 && root.firstElementChild?.tagName === 'DIV' && !isExampleLabel(root.firstElementChild)) {
    root = root.firstElementChild
  }
  return [...root.childNodes].filter((n) => n.nodeType !== 8)
}

function splitExample(title, nodes) {
  const fields = { figure: [], input: [], output: [], explanation: [] }
  let current = 'figure'
  let pre = false
  const step = (n) => {
    const field = fieldOf(n)
    if (field) return void (current = field)
    // <p><strong>Input:</strong> ...</p> (example-block markup): the label sits inside the paragraph.
    if (isElement(n) && n.tagName === 'P') {
      const kids = [...n.childNodes].filter((k) => !isBlank(k))
      const labelled = kids.length && fieldOf(kids[0])
      if (labelled) {
        current = labelled
        return void fields[current].push(...kids.slice(1))
      }
    }
    if (!isBlank(n) || fields[current].length) fields[current].push(n)
  }
  for (const n of nodes) {
    if (isBlank(n)) continue
    if (isElement(n) && (n.tagName === 'PRE' || n.classList.contains('example-block'))) {
      pre ||= n.tagName === 'PRE'
      n.childNodes.forEach(step)
    } else {
      step(n)
    }
  }
  const out = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, serialize(v)]))
  return out.input || out.output
    ? { title, pre, ...out }
    : { title, pre, raw: serialize(nodes) } // unrecognized layout: show it as-is
}

export function splitStatement(html) {
  const intro = []
  const examples = [] // [{ title, nodes }]
  let constraints = ''
  const extra = []
  let mode = 'intro'

  for (const n of topLevel(html)) {
    if (isExampleLabel(n)) {
      mode = 'example'
      examples.push({ title: clean(n.textContent).replace(/:$/, ''), nodes: [] })
    } else if (isConstraintsLabel(n)) {
      mode = 'constraints'
    } else if (mode === 'intro') {
      intro.push(n)
    } else if (mode === 'example') {
      if (isExtraStart(n)) {
        mode = 'extra'
        extra.push(n)
      } else {
        examples.at(-1).nodes.push(n)
      }
    } else if (mode === 'constraints' && !constraints && isElement(n) && ['UL', 'OL'].includes(n.tagName)) {
      constraints = n.outerHTML
    } else if (!isBlank(n)) {
      mode = 'extra'
      extra.push(n)
    } else if (mode === 'extra') {
      extra.push(n)
    }
  }

  // Drop trailing spacer paragraphs (<p>&nbsp;</p>) before the first example.
  while (intro.length && isBlank(intro.at(-1))) intro.pop()

  const extraHtml = serialize(extra)
  return {
    intro: serialize(intro),
    examples: examples.map((e) => splitExample(e.title, e.nodes)),
    constraints,
    extra: extraHtml,
    extraTitle: /^follow/i.test(clean(extra[0]?.textContent)) ? 'Follow-up' : 'Note',
  }
}
