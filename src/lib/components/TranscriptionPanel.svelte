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
    onFocusGroup: (lineIndices: number[], rect?: { x: number; y: number; w: number; h: number }) => void;
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

<div class="overflow-y-auto p-3 font-serif text-[0.95rem] leading-relaxed h-full" bind:this={panelEl}>
  {#each groups as group, gi}
    <div class="mb-2 border-l-3 rounded" style="border-color: {GROUP_COLORS[gi % GROUP_COLORS.length]}">
      <div class="flex items-center gap-1.5 px-2 py-1.5 bg-white/[0.03] text-xs font-sans select-none cursor-pointer" onclick={() => onFocusGroup(group.lineIndices, group.rect)}>
        <button class="bg-transparent border-none text-muted-foreground cursor-pointer p-0 text-[0.65rem] w-4" onclick={(e) => { e.stopPropagation(); onToggleGroup(group.id); }}>
          {group.collapsed ? '\u25B6' : '\u25BC'}
        </button>
        {#if editingGroupId === group.id}
          <input
            class="bg-card border border-current text-foreground rounded px-1 py-0.5 text-xs w-32 outline-none"
            style="border-color: {GROUP_COLORS[gi % GROUP_COLORS.length]}"
            bind:value={editName}
            onkeydown={(e) => { if (e.key === 'Enter') finishRename(group.id); if (e.key === 'Escape') editingGroupId = null; }}
            onblur={() => finishRename(group.id)}
          />
        {:else}
          <span class="font-semibold cursor-default" style="color: {GROUP_COLORS[gi % GROUP_COLORS.length]}" ondblclick={() => startRename(group)}>{group.name}</span>
        {/if}
        <span class="text-[0.7rem] text-muted-foreground ml-auto">{group.lineIndices.length}</span>
        <button class="bg-transparent border-none text-muted-foreground cursor-pointer px-0.5 text-xs opacity-50 hover:opacity-100" style="--hover-color: {GROUP_COLORS[gi % GROUP_COLORS.length]}" onclick={(e) => { e.stopPropagation(); onFocusGroup(group.lineIndices, group.rect); }} title="Zoom to group">&#x2316;</button>
        <button class="bg-transparent border-none text-muted-foreground cursor-pointer px-0.5 text-xs opacity-50 hover:opacity-100 hover:text-destructive" onclick={(e) => { e.stopPropagation(); onDeleteGroup(group.id); }} title="Delete group">x</button>
      </div>
      {#if !group.collapsed}
        <div class="pl-1">
          {#each group.lineIndices as lineIdx}
            {#if lines[lineIdx]}
              <div
                class="flex items-baseline gap-2 px-2 py-1 rounded cursor-pointer transition-colors {lineIdx === currentLine || lineIdx === hoveredLine ? 'bg-orange-500/[0.08]' : ''} {selectedLines.has(lineIdx) ? 'bg-yellow-400/[0.12] outline outline-1 outline-yellow-400/30' : ''}"
                data-line={lineIdx}
                onmouseenter={() => onHoverLine(lineIdx)}
                onmouseleave={() => onHoverLine(-1)}
                onclick={(e) => handleLineClick(lineIdx, e)}
                ondblclick={() => startEditLine(lineIdx)}
              >
                <span class="text-muted-foreground text-xs min-w-[1.5rem] text-right font-mono select-none">{lineIdx + 1}</span>
                {#if editingLineIdx === lineIdx}
                  <input
                    class="flex-1 bg-card border border-border text-foreground font-inherit text-inherit px-1 py-0.5 rounded outline-none focus:border-primary"
                    bind:value={editLineText}
                    onkeydown={(e) => { if (e.key === 'Enter') finishEditLine(); if (e.key === 'Escape') editingLineIdx = -1; }}
                    onblur={finishEditLine}
                    onclick={(e) => e.stopPropagation()}
                    ondblclick={(e) => e.stopPropagation()}
                  />
                {:else}
                  <span class="flex-1">
                    {lines[lineIdx].text}{#if lineIdx === currentLine && !lines[lineIdx].complete}<span class="animate-pulse text-orange-500">|</span>{/if}
                  </span>
                  {#if lines[lineIdx].complete}
                    <span class="text-xs text-muted-foreground font-mono">{(lines[lineIdx].confidence * 100).toFixed(0)}%</span>
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
      <div class="text-xs text-muted-foreground font-sans pt-2 px-2 pb-0.5 uppercase tracking-wide">Ungrouped</div>
    {/if}
    {#each ungroupedIndices as lineIdx}
      {#if lines[lineIdx]}
        <div
          class="flex items-baseline gap-2 px-2 py-1 rounded cursor-pointer transition-colors {lineIdx === currentLine || lineIdx === hoveredLine ? 'bg-orange-500/[0.08]' : ''} {selectedLines.has(lineIdx) ? 'bg-yellow-400/[0.12] outline outline-1 outline-yellow-400/30' : ''}"
          data-line={lineIdx}
          onmouseenter={() => onHoverLine(lineIdx)}
          onmouseleave={() => onHoverLine(-1)}
          onclick={(e) => handleLineClick(lineIdx, e)}
          ondblclick={() => startEditLine(lineIdx)}
        >
          <span class="text-muted-foreground text-xs min-w-[1.5rem] text-right font-mono select-none">{lineIdx + 1}</span>
          {#if editingLineIdx === lineIdx}
            <input
              class="flex-1 bg-card border border-border text-foreground font-inherit text-inherit px-1 py-0.5 rounded outline-none focus:border-primary"
              bind:value={editLineText}
              onkeydown={(e) => { if (e.key === 'Enter') finishEditLine(); if (e.key === 'Escape') editingLineIdx = -1; }}
              onblur={finishEditLine}
              onclick={(e) => e.stopPropagation()}
              ondblclick={(e) => e.stopPropagation()}
            />
          {:else}
            <span class="flex-1">
              {lines[lineIdx].text}{#if lineIdx === currentLine && !lines[lineIdx].complete}<span class="animate-pulse text-orange-500">|</span>{/if}
            </span>
            {#if lines[lineIdx].complete}
              <span class="text-xs text-muted-foreground font-mono">{(lines[lineIdx].confidence * 100).toFixed(0)}%</span>
            {/if}
          {/if}
        </div>
      {/if}
    {/each}
  {/if}

  {#if lines.length === 0}
    <p class="text-muted-foreground italic text-center mt-8">Transcription will appear here...</p>
  {/if}
</div>
