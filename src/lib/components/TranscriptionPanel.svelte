<script lang="ts">
  import type { ImageDocument } from '$lib/types';

  interface Props {
    documents: ImageDocument[];
    activeDocumentId: string | null;
    onSwitchDocument: (id: string) => void;
    hoveredLine: number;
    onHoverLine: (index: number) => void;
    selectedLines: Set<number>;
    onSelectLine: (index: number, additive: boolean) => void;
    onToggleGroup: (groupId: string) => void;
    onRenameGroup: (groupId: string, name: string) => void;
    onDeleteGroup: (groupId: string) => void;
    onFocusGroup: (lineIndices: number[], rect?: { x: number; y: number; w: number; h: number }) => void;
    onFocusLine: (index: number) => void;
    onEditLine: (index: number, text: string) => void;
    selectMode: boolean;
    activeRegions: Set<string>;
    activeImageIds: Set<string>;
  }

  let {
    documents, activeDocumentId, onSwitchDocument,
    hoveredLine, onHoverLine,
    selectedLines, onSelectLine,
    onToggleGroup, onRenameGroup, onDeleteGroup, onFocusGroup, onFocusLine, onEditLine,
    selectMode, activeRegions, activeImageIds,
  }: Props = $props();

  let panelEl: HTMLDivElement;
  let editingGroupId = $state<string | null>(null);
  let editName = $state('');
  let editingLineIdx = $state<number>(-1);
  let editLineText = $state('');

  function startRename(group: { id: string; name: string }) {
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
    const doc = documents.find(d => d.id === activeDocumentId);
    editLineText = doc?.lines[idx]?.text ?? '';
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

  // Collapsed document state
  let collapsedDocs = $state(new Set<string>());

  function toggleDoc(docId: string) {
    const next = new Set(collapsedDocs);
    if (next.has(docId)) next.delete(docId); else next.add(docId);
    collapsedDocs = next;
  }
</script>

<div class="overflow-y-auto p-3 font-serif text-[0.95rem] leading-relaxed h-full" bind:this={panelEl}>
  {#each documents as doc}
    {@const isActive = doc.id === activeDocumentId}
    {@const isCollapsed = collapsedDocs.has(doc.id)}
    {@const isWorking = activeImageIds.has(doc.id)}
    {@const totalLines = doc.lines.length}
    {@const completedLines = doc.lines.filter(l => l.complete).length}

    <!-- Document header -->
    <div
      class="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer select-none font-sans text-xs mb-1 {isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50'}"
      onclick={() => { onSwitchDocument(doc.id); if (isCollapsed) toggleDoc(doc.id); }}
    >
      <button class="bg-transparent border-none text-current cursor-pointer p-0 text-[0.65rem] w-4" onclick={(e) => { e.stopPropagation(); toggleDoc(doc.id); }}>
        {isCollapsed ? '\u25B6' : '\u25BC'}
      </button>
      {#if isWorking}
        <span class="inline-block size-2 rounded-full bg-orange-500 animate-pulse"></span>
      {/if}
      <span class="font-semibold truncate flex-1">{doc.name}</span>
      {#if totalLines > 0}
        <span class="text-[0.7rem] font-mono">{completedLines}/{totalLines}</span>
      {/if}
    </div>

    <!-- Document content (groups + ungrouped lines) -->
    {#if !isCollapsed && isActive}
      {@const ungroupedIndices = (() => {
        const grouped = new Set<number>();
        for (const g of doc.groups) for (const idx of g.lineIndices) grouped.add(idx);
        return Array.from({ length: doc.lines.length }, (_, i) => i).filter(i => !grouped.has(i));
      })()}

      <div class="pl-2">
        {#each doc.groups as group, gi}
          {@const groupWorking = group.regionId ? activeRegions.has(group.regionId) : false}
          <div class="mb-2 border-l-3 rounded" style="border-color: {GROUP_COLORS[gi % GROUP_COLORS.length]}">
            <div
              class="flex items-center gap-1.5 px-2 py-1.5 bg-white/[0.03] text-xs font-sans select-none cursor-pointer"
              onclick={() => onFocusGroup(group.lineIndices, group.rect)}
            >
              <button class="bg-transparent border-none text-muted-foreground cursor-pointer p-0 text-[0.65rem] w-4" onclick={(e) => { e.stopPropagation(); onToggleGroup(group.id); }}>
                {group.collapsed ? '\u25B6' : '\u25BC'}
              </button>
              {#if groupWorking}
                <span class="inline-block size-2 rounded-full bg-orange-500 animate-pulse"></span>
              {/if}
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
              <button class="bg-transparent border-none text-muted-foreground cursor-pointer px-0.5 text-xs opacity-50 hover:opacity-100" onclick={(e) => { e.stopPropagation(); onFocusGroup(group.lineIndices, group.rect); }} title="Zoom to group">&#x2316;</button>
              <button class="bg-transparent border-none text-muted-foreground cursor-pointer px-0.5 text-xs opacity-50 hover:opacity-100 hover:text-destructive disabled:opacity-20 disabled:cursor-not-allowed" onclick={(e) => { e.stopPropagation(); onDeleteGroup(group.id); }} title={groupWorking ? 'Cannot delete while transcribing' : 'Delete group'} disabled={groupWorking}>x</button>
            </div>
            {#if !group.collapsed}
              <div class="pl-1">
                {#each group.lineIndices as lineIdx}
                  {#if doc.lines[lineIdx]}
                    <div
                      class="flex items-baseline gap-2 px-2 py-1 rounded cursor-pointer transition-colors {lineIdx === hoveredLine ? 'bg-orange-500/[0.08]' : ''} {selectedLines.has(lineIdx) ? 'bg-yellow-400/[0.12] outline outline-1 outline-yellow-400/30' : ''}"
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
                          {doc.lines[lineIdx].text}{#if !doc.lines[lineIdx].complete && doc.lines[lineIdx].text}<span class="animate-pulse text-orange-500">|</span>{/if}
                        </span>
                        {#if doc.lines[lineIdx].complete}
                          <span class="text-xs text-muted-foreground font-mono">{(doc.lines[lineIdx].confidence * 100).toFixed(0)}%</span>
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
          {#if doc.groups.length > 0}
            <div class="text-xs text-muted-foreground font-sans pt-2 px-2 pb-0.5 uppercase tracking-wide">Ungrouped</div>
          {/if}
          {#each ungroupedIndices as lineIdx}
            {#if doc.lines[lineIdx]}
              <div
                class="flex items-baseline gap-2 px-2 py-1 rounded cursor-pointer transition-colors {lineIdx === hoveredLine ? 'bg-orange-500/[0.08]' : ''} {selectedLines.has(lineIdx) ? 'bg-yellow-400/[0.12] outline outline-1 outline-yellow-400/30' : ''}"
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
                    {doc.lines[lineIdx].text}{#if !doc.lines[lineIdx].complete && doc.lines[lineIdx].text}<span class="animate-pulse text-orange-500">|</span>{/if}
                  </span>
                  {#if doc.lines[lineIdx].complete}
                    <span class="text-xs text-muted-foreground font-mono">{(doc.lines[lineIdx].confidence * 100).toFixed(0)}%</span>
                  {/if}
                {/if}
              </div>
            {/if}
          {/each}
        {/if}

        {#if doc.lines.length === 0 && doc.groups.length === 0}
          <p class="text-muted-foreground italic text-center text-sm mt-4">Draw regions to detect text lines</p>
        {/if}
      </div>
    {:else if !isCollapsed}
      <!-- Non-active document: show summary -->
      <div class="pl-6 pb-2">
        {#if doc.lines.length === 0 && doc.groups.length === 0}
          <p class="text-muted-foreground italic text-xs">No regions detected</p>
        {:else}
          <p class="text-muted-foreground text-xs">{doc.groups.length} group{doc.groups.length !== 1 ? 's' : ''}, {doc.lines.length} line{doc.lines.length !== 1 ? 's' : ''}</p>
        {/if}
      </div>
    {/if}
  {/each}

  {#if documents.length === 0}
    <p class="text-muted-foreground italic text-center mt-8">No images loaded</p>
  {/if}
</div>
