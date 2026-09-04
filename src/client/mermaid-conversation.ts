/**
 * Mermaid diagram renderer for the DSH conversation area. The main chat
 * renders markdown through the DSH `MarkdownText` component, which produces
 * `.md-code-block` elements with `language-mermaid` classes. This module
 * watches the document for those blocks and swaps them for rendered diagrams
 * using the same mermaid infrastructure as the markdown preview — but through
 * a MutationObserver rather than a React layout effect, because the
 * conversation DOM is owned by DSH, not by this plugin.
 *
 * Architecture:
 * 1. A MutationObserver on `document.body` (subtree) detects new `.md-code-block`
 *    elements whose `<code>` child has a `language-mermaid` class.
 * 2. The mermaid chunk is loaded on first detection (lazy, same chunk as the
 *    markdown preview).
 * 3. Each detected block gets a React root rendering the chunk's
 *    `MermaidDiagram` component.
 * 4. When a block is removed from the DOM, its root is unmounted.
 * 5. The observer uses `data-dsh-mermaid-conversation` markers to avoid
 *    re-processing already-rendered blocks and to distinguish from the
 *    sidebar's own `data-mermaid-processed` marker.
 *
 * The mermaid library is inlined in `lib/client-mermaid.js` (~7 MB) and only
 * fetched when the conversation actually contains a mermaid fence.
 */

import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'
import { loadChunk } from './chunk-loader.ts'
import type { MermaidDiagram as MermaidDiagramType } from './mermaid.tsx'

/** Marker attribute on blocks already rendered by this observer. */
const CONVERSATION_MARKER = 'data-dsh-mermaid-conversation'

/**
 * True when a rendered CodeBlock is a mermaid fence. Mirrors the logic in
 * `mermaid.tsx`'s `isMermaidBlock` — duplicated here because the mermaid
 * chunk is lazy-loaded and we must decide whether to load it before the
 * chunk arrives. Stays in sync with the chunk's version.
 */
function isMermaidFence(block: HTMLElement): boolean {
  // Shiki-rendered path: the <code> element carries `language-mermaid`.
  const code = block.querySelector('code')
  if (code !== null && [...code.classList].some(c => c.startsWith('language-mermaid'))) return true
  // Plain path: the infostring banner shows 'mermaid'.
  const infostring = block.firstElementChild?.firstElementChild?.firstElementChild
  return infostring !== null
    && infostring !== undefined
    && (infostring.textContent ?? '').trim() === 'mermaid'
}

/** One rendered block: the React root + the source code it last rendered. */
interface MermaidMount {
  root: Root
  source: string
}

/** In-flight chunk load promise (null = not started, shared by all blocks). */
let chunkPromise: Promise<{ MermaidDiagram: typeof MermaidDiagramType }> | null = null

/** Active mounts keyed by block element (WeakMap so GC cleans up orphans). */
const mounts = new WeakMap<HTMLElement, MermaidMount>()

/** Ensure the mermaid chunk is loaded (idempotent — shared promise). */
function ensureChunk(): Promise<{ MermaidDiagram: typeof MermaidDiagramType }> {
  if (chunkPromise !== null) return chunkPromise
  chunkPromise = loadChunk('mermaid').then(exports => {
    if (typeof exports.MermaidDiagram !== 'function') {
      throw new Error('[dsh-better-sidebar] mermaid chunk missing MermaidDiagram export')
    }
    return exports as unknown as { MermaidDiagram: typeof MermaidDiagramType }
  })
  void chunkPromise.catch(() => { chunkPromise = null })
  return chunkPromise
}

/** Render (or re-render) one mermaid code block. */
function renderBlock(block: HTMLElement): void {
  const source = block.querySelector('code')?.textContent ?? ''
  if (source.trim() === '') return
  const existing = mounts.get(block)
  if (existing !== undefined && existing.source === source) return
  void ensureChunk().then(({ MermaidDiagram }) => {
    if (!document.body.contains(block)) return
    const freshSource = block.querySelector('code')?.textContent ?? ''
    if (freshSource.trim() === '') return
    if (existing !== undefined) {
      existing.source = freshSource
      existing.root.render(createElement(MermaidDiagram, { code: freshSource }))
    } else {
      // Replace the code block's children with a host div for the React root.
      const host = document.createElement('div')
      host.style.cssText = 'display:contents'
      block.replaceChildren(host)
      block.setAttribute(CONVERSATION_MARKER, 'true')
      const root = createRoot(host)
      mounts.set(block, { root, source: freshSource })
      root.render(createElement(MermaidDiagram, { code: freshSource }))
    }
  }).catch((error) => {
    console.warn('[dsh-better-sidebar] mermaid conversation render failed:', error)
  })
}

/** Unmount the React root for a block and restore nothing (the block is leaving the DOM). */
function unmountBlock(block: HTMLElement): void {
  const mount = mounts.get(block)
  if (mount === undefined) return
  mount.root.unmount()
  mounts.delete(block)
}

/** Scan the entire document for unprocessed mermaid blocks. */
function scanDocument(): void {
  for (const block of document.querySelectorAll<HTMLElement>('.md-code-block')) {
    if (block.hasAttribute(CONVERSATION_MARKER)) continue
    // Skip blocks already rendered by the markdown preview (sidebar).
    if (block.hasAttribute('data-mermaid-processed')) continue
    if (isMermaidFence(block)) renderBlock(block)
  }
}

/**
 * Start watching the conversation area for mermaid code blocks. Returns a
 * disposer that stops the observer and unmounts all rendered diagrams.
 * Safe to call multiple times (subsequent calls are no-ops).
 */
export function startMermaidConversationObserver(): () => void {
  let disposed = false

  // Initial scan: catch blocks already in the DOM before the observer starts.
  scanDocument()

  const observer = new MutationObserver((mutations) => {
    if (disposed) return
    for (const mutation of mutations) {
      // Added nodes: scan for new mermaid blocks.
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (node.matches?.('.md-code-block') && isMermaidFence(node)
          && !node.hasAttribute(CONVERSATION_MARKER)
          && !node.hasAttribute('data-mermaid-processed')) {
          renderBlock(node)
        }
        // Also scan descendants of added subtrees for nested blocks.
        for (const block of node.querySelectorAll<HTMLElement>('.md-code-block')) {
          if (block.hasAttribute(CONVERSATION_MARKER)) continue
          if (block.hasAttribute('data-mermaid-processed')) continue
          if (isMermaidFence(block)) renderBlock(block)
        }
      }
      // Removed nodes: clean up mounts.
      for (const node of mutation.removedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (node.matches?.('.md-code-block')) unmountBlock(node)
        for (const block of node.querySelectorAll<HTMLElement>('.md-code-block')) {
          unmountBlock(block)
        }
      }
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })

  return () => {
    disposed = true
    observer.disconnect()
    // Unmount all remaining mounts.
    for (const block of document.querySelectorAll<HTMLElement>(`[${CONVERSATION_MARKER}]`)) {
      unmountBlock(block)
    }
    chunkPromise = null
  }
}