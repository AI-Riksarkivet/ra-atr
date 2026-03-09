<script lang="ts">
  import type { Line, LineGroup } from '$lib/types';

  interface Props {
    lines: Line[];
    currentLine: number;
    currentText: string;
    hoveredLine: number;
    onHoverLine: (index: number) => void;
    selectedLines: Set<number>;
    onSelectLine: (index: number, additive: boolean) => void;
    groups: LineGroup[];
    onToggleGroup: (groupId: string) => void;
    onRenameGroup: (groupId: string, name: string) => void;
    onDeleteGroup: (groupId: string) => void;
    onFocusGroup: (lineIndices: number[]) => void;
    onFocusLine: (index: number) => void;
    onEditLine: (index: number, text: string) => void;
    selectMode: boolean;
  }

  let {
    lines, currentLine, currentText, hoveredLine, onHoverLine,
    selectedLines, onSelectLine, groups, onToggleGroup, onRenameGroup, onDeleteGroup, onFocusGroup, onFocusLine, onEditLine, selectMode,
  }: Props = $props();
  let panelEl: HTMLDivElement;
  let editingGroupId = $state<string | null>(null);
  let editName = $state('');
  let editingLineIdx = $state<number>(-1);
  let editLineText = $state('');

  // Auto-scroll to current line
  $effect(() => {
    if (currentLine >= 0 && panelEl) {
      const el = panelEl.querySelector(`[data-line="${currentLine}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  // Lines that aren't in any group
  let ungroupedIndices = $derived.by(() => {
    const grouped = new Set<number>();
    for (const g of groups) {
      for (const idx of g.lineIndices) grouped.add(idx);
    }
    return Array.from({ length: lines.length }, (_, i) => i).filter(i => !grouped.has(i));
  });

  function startRename(group: LineGroup) {
    editingGroupId = group.id;
    editName = group.name;
  }

  function finishRename(groupId: string) {
    if (editName.trim()) {
      onRenameGroup(groupId, editName.trim());
    }
    editingGroupId = null;
  }

  function startEditLine(idx: number) {
    editingLineIdx = idx;
    editLineText = lines[idx]?.text ?? '';
  }

  function finishEditLine() {
    if (editingLineIdx >= 0) {
      onEditLine(editingLineIdx, editLineText);
      editingLineIdx = -1;
    }
  }

  function handleLineClick(i: number, e: MouseEvent) {
    if (selectMode) {
      onSelectLine(i, e.shiftKey || e.ctrlKey || e.metaKey);
    } else {
      onFocusLine(i);
    }
  }

  const GROUP_COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#f97316'];
</script>

<div class="transcription-panel" bind:this={panelEl}>
  {#each groups as group, gi}
    <div class="group" style="--group-color: {GROUP_COLORS[gi % GROUP_COLORS.length]}">
      <div class="group-header">
        <button class="toggle-btn" onclick={() => onToggleGroup(group.id)}>
          {group.collapsed ? '\u25B6' : '\u25BC'}
        </button>
        {#if editingGroupId === group.id}
          <input
            class="group-name-input"
            bind:value={editName}
            onkeydown={(e) => { if (e.key === 'Enter') finishRename(group.id); if (e.key === 'Escape') editingGroupId = null; }}
            onblur={() => finishRename(group.id)}
          />
        {:else}
          <span class="group-name" ondblclick={() => startRename(group)}>{group.name}</span>
        {/if}
        <span class="group-count">{group.lineIndices.length}</span>
        <button class="focus-btn" onclick={() => onFocusGroup(group.lineIndices)} title="Zoom to group">&#x2316;</button>
        <button class="delete-btn" onclick={() => onDeleteGroup(group.id)} title="Ungroup">x</button>
      </div>
      {#if !group.collapsed}
        <div class="group-lines">
          {#each group.lineIndices as lineIdx}
            {#if lines[lineIdx]}
              <div
                class="line"
                class:current={lineIdx === currentLine}
                class:hovered={lineIdx === hoveredLine}
                class:selected={selectedLines.has(lineIdx)}
                class:complete={lines[lineIdx].complete}
                data-line={lineIdx}
                onmouseenter={() => onHoverLine(lineIdx)}
                onmouseleave={() => onHoverLine(-1)}
                onclick={(e) => handleLineClick(lineIdx, e)}
                ondblclick={() => startEditLine(lineIdx)}
              >
                <span class="line-number">{lineIdx + 1}</span>
                {#if editingLineIdx === lineIdx}
                  <input
                    class="line-edit"
                    bind:value={editLineText}
                    onkeydown={(e) => { if (e.key === 'Enter') finishEditLine(); if (e.key === 'Escape') editingLineIdx = -1; }}
                    onblur={finishEditLine}
                    onclick={(e) => e.stopPropagation()}
                    ondblclick={(e) => e.stopPropagation()}
                  />
                {:else}
                  <span class="line-text">
                    {lines[lineIdx].text}{#if lineIdx === currentLine && !lines[lineIdx].complete}<span class="cursor">|</span>{/if}
                  </span>
                  {#if lines[lineIdx].complete}
                    <span class="confidence">{(lines[lineIdx].confidence * 100).toFixed(0)}%</span>
                  {/if}
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/each}

  {#if ungroupedIndices.length > 0}
    {#if groups.length > 0}
      <div class="section-label">Ungrouped</div>
    {/if}
    {#each ungroupedIndices as lineIdx}
      {#if lines[lineIdx]}
        <div
          class="line"
          class:current={lineIdx === currentLine}
          class:hovered={lineIdx === hoveredLine}
          class:selected={selectedLines.has(lineIdx)}
          class:complete={lines[lineIdx].complete}
          data-line={lineIdx}
          onmouseenter={() => onHoverLine(lineIdx)}
          onmouseleave={() => onHoverLine(-1)}
          onclick={(e) => handleLineClick(lineIdx, e)}
          ondblclick={() => startEditLine(lineIdx)}
        >
          <span class="line-number">{lineIdx + 1}</span>
          {#if editingLineIdx === lineIdx}
            <input
              class="line-edit"
              bind:value={editLineText}
              onkeydown={(e) => { if (e.key === 'Enter') finishEditLine(); if (e.key === 'Escape') editingLineIdx = -1; }}
              onblur={finishEditLine}
              onclick={(e) => e.stopPropagation()}
              ondblclick={(e) => e.stopPropagation()}
            />
          {:else}
            <span class="line-text">
              {lines[lineIdx].text}{#if lineIdx === currentLine && !lines[lineIdx].complete}<span class="cursor">|</span>{/if}
            </span>
            {#if lines[lineIdx].complete}
              <span class="confidence">{(lines[lineIdx].confidence * 100).toFixed(0)}%</span>
            {/if}
          {/if}
        </div>
      {/if}
    {/each}
  {/if}

  {#if lines.length === 0}
    <p class="placeholder">Transcription will appear here...</p>
  {/if}
</div>

<style>
  .transcription-panel {
    overflow-y: auto;
    padding: 0.75rem;
    font-family: 'Georgia', serif;
    font-size: 0.95rem;
    line-height: 1.6;
    height: 100%;
  }

  .group {
    margin-bottom: 0.5rem;
    border-left: 3px solid var(--group-color, #888);
    border-radius: 4px;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem;
    background: rgba(255, 255, 255, 0.03);
    font-size: 0.8rem;
    font-family: system-ui, sans-serif;
    user-select: none;
  }

  .toggle-btn {
    background: none;
    border: none;
    color: var(--text-muted, #888);
    cursor: pointer;
    padding: 0;
    font-size: 0.65rem;
    width: 1rem;
  }

  .group-name {
    font-weight: 600;
    color: var(--group-color);
    cursor: default;
  }

  .group-name-input {
    background: var(--bg-tertiary, #333);
    border: 1px solid var(--group-color);
    color: var(--text-primary, #fff);
    border-radius: 3px;
    padding: 0.1rem 0.3rem;
    font-size: 0.8rem;
    width: 8rem;
    outline: none;
  }

  .group-count {
    font-size: 0.7rem;
    color: var(--text-muted, #888);
    margin-left: auto;
  }

  .focus-btn,
  .delete-btn {
    background: none;
    border: none;
    color: var(--text-muted, #666);
    cursor: pointer;
    padding: 0 0.2rem;
    font-size: 0.75rem;
    opacity: 0.5;
  }

  .focus-btn:hover {
    opacity: 1;
    color: var(--group-color, #3b82f6);
  }

  .delete-btn:hover {
    opacity: 1;
    color: #ef4444;
  }

  .group-lines {
    padding-left: 0.25rem;
  }

  .section-label {
    font-size: 0.75rem;
    color: var(--text-muted, #666);
    font-family: system-ui, sans-serif;
    padding: 0.5rem 0.5rem 0.2rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    transition: background-color 0.2s;
    cursor: pointer;
  }

  .line.current,
  .line.hovered {
    background-color: rgba(255, 107, 0, 0.08);
  }

  .line.selected {
    background-color: rgba(250, 204, 21, 0.12);
    outline: 1px solid rgba(250, 204, 21, 0.3);
  }

  .line.complete {
    opacity: 1;
  }

  .line-number {
    color: var(--text-muted, #666);
    font-size: 0.75rem;
    min-width: 1.5rem;
    text-align: right;
    font-family: monospace;
    user-select: none;
  }

  .line-text {
    flex: 1;
  }

  .line-edit {
    flex: 1;
    background: var(--bg-tertiary, #333);
    border: 1px solid var(--border-color, #555);
    color: var(--text-primary, #fff);
    font-family: inherit;
    font-size: inherit;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    outline: none;
  }

  .line-edit:focus {
    border-color: #3b82f6;
  }

  .confidence {
    font-size: 0.7rem;
    color: var(--text-muted, #666);
    font-family: monospace;
  }

  .cursor {
    animation: blink 0.7s step-end infinite;
    color: #ff6b00;
  }

  @keyframes blink {
    50% { opacity: 0; }
  }

  .placeholder {
    color: var(--text-muted, #666);
    font-style: italic;
    text-align: center;
    margin-top: 2rem;
  }
</style>
