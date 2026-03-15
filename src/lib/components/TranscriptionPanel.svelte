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
    onRemoveVolume: (manifestId: string) => void;
    onTranscribeVolume: (manifestId: string) => void;
    selectMode: boolean;
    activeRegions: Set<string>;
    activeImageIds: Set<string>;
  }

  let {
    documents, activeDocumentId, onSwitchDocument,
    hoveredLine, onHoverLine,
    selectedLines, onSelectLine,
    onToggleGroup, onRenameGroup, onDeleteGroup, onFocusGroup, onFocusLine, onEditLine,
    onRemoveVolume, onTranscribeVolume,
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

  let copiedGroupId = $state<string | null>(null);

  async function copyGroupLines(group: { id: string; lineIndices: number[]; rect?: { x: number; y: number; w: number; h: number } }) {
    const doc = documents.find(d => d.id === activeDocumentId);
    if (!doc) return;

    const text = group.lineIndices
      .map(i => doc.lines[i]?.text ?? '')
      .filter(t => t.trim())
      .join('\n');

    const items: Record<string, Blob> = {
      'text/plain': new Blob([text], { type: 'text/plain' }),
    };

    if (doc.imageUrl && group.rect) {
      try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = doc.imageUrl!;
        });
        const r = group.rect;
        const canvas = document.createElement('canvas');
        canvas.width = r.w;
        canvas.height = r.h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob(b => resolve(b!), 'image/png')
        );
        items['image/png'] = blob;
      } catch { /* fall back to text-only */ }
    }

    await navigator.clipboard.write([new ClipboardItem(items)]);
    copiedGroupId = group.id;
    setTimeout(() => { if (copiedGroupId === group.id) copiedGroupId = null; }, 1500);
  }

  const GROUP_COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#f97316'];

  let copiedLineIdx = $state<number>(-1);
  let confirmRemoveVolume = $state<string | null>(null);

  async function copyLinePrompt(doc: ImageDocument, lineIdx: number) {
    const group = doc.groups.find(g => g.lineIndices.includes(lineIdx));
    const groupLines = group ? group.lineIndices : [lineIdx];

    const contextLines: string[] = [];
    for (const idx of groupLines) {
      const text = doc.lines[idx]?.text ?? '';
      if (idx === lineIdx) {
        contextLines.push('[THIS LINE]');
      } else if (text.trim()) {
        contextLines.push(text);
      }
    }

    const prompt = `This is a handwritten line from a 17th-19th century Swedish document.

Surrounding text from the same region:
${contextLines.map(l => `> ${l}`).join('\n')}

[IMAGE: see attached line cutout]

Read the handwritten text in the image. Use the surrounding text for context.
Provide only the transcription, nothing else.`;

    await navigator.clipboard.writeText(prompt);
    copiedLineIdx = lineIdx;
    setTimeout(() => { if (copiedLineIdx === lineIdx) copiedLineIdx = -1; }, 1500);
  }

  async function copyLineImage(doc: ImageDocument, lineIdx: number) {
    const line = doc.lines[lineIdx];
    if (!doc.imageUrl || !line?.bbox) return;

    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = doc.imageUrl!;
      });
      const b = line.bbox;
      const pad = 8;
      const sx = Math.max(0, b.x - pad);
      const sy = Math.max(0, b.y - pad);
      const sw = Math.min(img.width - sx, b.w + pad * 2);
      const sh = Math.min(img.height - sy, b.h + pad * 2);
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob(b => resolve(b!), 'image/png')
      );
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      copiedLineIdx = lineIdx;
      setTimeout(() => { if (copiedLineIdx === lineIdx) copiedLineIdx = -1; }, 1500);
    } catch { /* ignore */ }
  }

  // Filter for transcriptions
  let searchQuery = $state('');
  let filter = $derived(searchQuery.trim().toLowerCase());

  function highlightText(text: string): { before: string; match: string; after: string }[] {
    if (!filter || !text) return [{ before: text, match: '', after: '' }];
    const idx = text.toLowerCase().indexOf(filter);
    if (idx === -1) return [{ before: text, match: '', after: '' }];
    return [{
      before: text.slice(0, idx),
      match: text.slice(idx, idx + filter.length),
      after: text.slice(idx + filter.length),
    }];
  }

  function lineMatches(doc: ImageDocument, lineIdx: number): boolean {
    if (!filter) return true;
    return doc.lines[lineIdx]?.text?.toLowerCase().includes(filter) ?? false;
  }

  function groupHasMatches(doc: ImageDocument, lineIndices: number[]): boolean {
    if (!filter) return true;
    return lineIndices.some(i => lineMatches(doc, i));
  }

  function docHasMatches(doc: ImageDocument): boolean {
    if (!filter) return true;
    return doc.lines.some((l) => l.text?.toLowerCase().includes(filter));
  }

  // Collapsed state
  let collapsedVolumes = $state(new Set<string>());
  let collapsedDocs = $state(new Set<string>());

  // Auto-collapse other volumes when switching to a different one
  let lastActiveManifest = $state('');
  $effect(() => {
    const activeDoc = documents.find(d => d.id === activeDocumentId);
    const manifest = activeDoc?.manifestId ?? '';
    if (manifest && manifest !== lastActiveManifest) {
      // Collapse all volumes except the active one
      const next = new Set<string>();
      for (const doc of documents) {
        if (doc.manifestId && doc.manifestId !== manifest) {
          next.add(doc.manifestId);
        }
      }
      collapsedVolumes = next;
      lastActiveManifest = manifest;
    }
  });

  function toggleVolume(id: string) {
    const next = new Set(collapsedVolumes);
    if (next.has(id)) next.delete(id); else next.add(id);
    collapsedVolumes = next;
  }

  function toggleDoc(docId: string) {
    const next = new Set(collapsedDocs);
    if (next.has(docId)) next.delete(docId); else next.add(docId);
    collapsedDocs = next;
  }

  interface Volume {
    manifestId: string;
    docs: ImageDocument[];
  }

  let volumes = $derived.by(() => {
    const vols = new Map<string, ImageDocument[]>();
    for (const doc of documents) {
      const key = doc.manifestId || 'unnamed';
      const list = vols.get(key);
      if (list) list.push(doc); else vols.set(key, [doc]);
    }
    return [...vols.entries()].map(([manifestId, docs]) => ({ manifestId, docs })) as Volume[];
  });
</script>

<div class="flex flex-col flex-1 min-h-0 bg-card text-card-foreground" bind:this={panelEl}>

  {#if documents.length > 0}
    <!-- Sticky filter -->
    <div class="shrink-0 p-3 pb-2 border-b border-border">
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Filter transcriptions..."
        class="w-full rounded border border-border bg-background px-2 py-1.5 text-xs font-sans text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
      />
      {#if filter && !documents.some(d => docHasMatches(d))}
        <div class="mt-2 text-xs text-muted-foreground font-sans italic px-1">No matches</div>
      {/if}
    </div>
  {/if}

  <!-- Scrollable content -->
  <div class="flex-1 overflow-y-auto p-3 font-serif text-[0.95rem] leading-relaxed">

  <!-- Volumes (Riksarkivet) -->
  {#each volumes as vol}
    {@const volHasMatches = !filter || vol.docs.some(d => docHasMatches(d))}
    {#if volHasMatches}
    {@const volCollapsed = collapsedVolumes.has(vol.manifestId)}
    {@const volLines = vol.docs.reduce((n, d) => n + d.lines.length, 0)}
    {@const volCompleted = vol.docs.reduce((n, d) => n + d.lines.filter(l => l.complete).length, 0)}
    {@const volWorking = vol.docs.some(d => activeImageIds.has(d.id))}

    <div
      class="group/vol flex items-center gap-2 px-2 py-1.5 rounded select-none font-sans text-xs mb-0.5 bg-muted/30 cursor-pointer hover:bg-muted/50"
      onclick={() => toggleVolume(vol.manifestId)}
    >
      <button class="bg-transparent border-none text-current cursor-pointer p-0 text-[0.65rem] w-4">
        {volCollapsed ? '\u25B6' : '\u25BC'}
      </button>
      {#if volWorking}
        <span class="inline-block size-2 rounded-full bg-orange-500 animate-pulse"></span>
      {/if}
      <span class="font-semibold truncate flex-1">{vol.manifestId.startsWith('upload-') ? `Upload ${vol.manifestId.slice(7)}` : vol.manifestId}</span>
      <span class="text-[0.65rem] text-muted-foreground font-mono">{vol.docs.length} pg</span>
      {#if volLines > 0}
        <span class="text-[0.7rem] font-mono">{volCompleted}/{volLines}</span>
      {/if}
      {#if volWorking}
        <span class="inline-block size-2 rounded-full border border-primary/40 border-t-primary animate-spin"></span>
      {:else}
        <button
          class="bg-transparent border-none text-muted-foreground cursor-pointer px-0.5 text-xs opacity-0 group-hover/vol:opacity-50 hover:!opacity-100 hover:text-primary transition-opacity"
          onclick={(e) => { e.stopPropagation(); onTranscribeVolume(vol.manifestId); }}
          title="Transcribe all pages"
        >&#x25B6;</button>
        {#if confirmRemoveVolume === vol.manifestId}
          <button
            class="bg-destructive text-destructive-foreground rounded px-1.5 py-0.5 text-[0.6rem] font-medium cursor-pointer hover:bg-destructive/90"
            onclick={(e) => { e.stopPropagation(); onRemoveVolume(vol.manifestId); confirmRemoveVolume = null; }}
          >Remove</button>
          <button
            class="bg-transparent border-none text-muted-foreground cursor-pointer text-[0.6rem] hover:text-foreground"
            onclick={(e) => { e.stopPropagation(); confirmRemoveVolume = null; }}
          >Cancel</button>
        {:else}
          <button
            class="bg-transparent border-none text-muted-foreground cursor-pointer px-0.5 text-xs opacity-0 group-hover/vol:opacity-30 hover:!opacity-100 hover:text-destructive transition-opacity"
            onclick={(e) => { e.stopPropagation(); confirmRemoveVolume = vol.manifestId; }}
            title="Remove volume"
          >x</button>
        {/if}
      {/if}
    </div>

    {#if !volCollapsed}
      <div class="pl-2">
        {#each vol.docs as doc}
          {#if !filter || docHasMatches(doc)}
          {@const isActive = doc.id === activeDocumentId}
          {@const isCollapsed = collapsedDocs.has(doc.id)}
          {@const isWorking = activeImageIds.has(doc.id)}
          {@const totalLines = doc.lines.length}
          {@const completedLines = doc.lines.filter(l => l.complete).length}

          <div
            class="flex items-center gap-2 px-2 py-1 rounded cursor-pointer select-none font-sans text-xs mb-0.5 {isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50'}"
            onclick={() => { onSwitchDocument(doc.id); if (isCollapsed) toggleDoc(doc.id); }}
          >
            <button class="bg-transparent border-none text-current cursor-pointer p-0 text-[0.65rem] w-4" onclick={(e) => { e.stopPropagation(); toggleDoc(doc.id); }}>
              {isCollapsed ? '\u25B6' : '\u25BC'}
            </button>
            {#if isWorking}
              <span class="inline-block size-2 rounded-full bg-orange-500 animate-pulse"></span>
            {:else if doc.placeholder}
              <span class="inline-block size-2 rounded-full border border-muted-foreground/40 border-t-muted-foreground animate-spin"></span>
            {/if}
            <span class="truncate flex-1">p. {doc.pageNumber ?? '?'}</span>
            {#if totalLines > 0}
              <span class="text-[0.7rem] font-mono">{completedLines}/{totalLines}</span>
            {/if}
          </div>

          {#if !isCollapsed && isActive}
            <div class="pl-3">
              {#each doc.groups as group, gi}
                {#if !filter || groupHasMatches(doc, group.lineIndices)}
                  {@const groupWorking = group.regionId ? activeRegions.has(group.regionId) : false}
                  {@render groupBlock(doc, group, gi, groupWorking)}
                {/if}
              {/each}

              {#if !filter && doc.lines.length === 0 && doc.groups.length === 0}
                <p class="text-muted-foreground italic text-center text-sm mt-2 mb-2">Draw regions to detect text lines</p>
              {/if}
            </div>
          {:else if !isCollapsed}
            <div class="pl-6 pb-1">
              {#if doc.lines.length === 0 && doc.groups.length === 0}
                <p class="text-muted-foreground italic text-xs">No regions detected</p>
              {:else}
                <p class="text-muted-foreground text-xs">{doc.groups.length} group{doc.groups.length !== 1 ? 's' : ''}, {doc.lines.length} line{doc.lines.length !== 1 ? 's' : ''}</p>
              {/if}
            </div>
          {/if}
          {/if}
        {/each}
      </div>
    {/if}
    {/if}
  {/each}

  {#if documents.length === 0}
    <p class="text-muted-foreground italic text-center mt-8 text-xs font-sans">No volumes loaded</p>
  {/if}
  </div>
</div>

<!-- Shared snippets -->

{#snippet groupBlock(doc: ImageDocument, group: import('$lib/types').LineGroup, gi: number, groupWorking: boolean)}
  <div class="mb-2 border-l-3 rounded" style="border-color: {GROUP_COLORS[gi % GROUP_COLORS.length]}">
    <div
      class="flex items-center gap-1.5 px-2 py-1.5 bg-muted/30 text-xs font-sans select-none cursor-pointer"
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
      <button class="bg-transparent border-none text-muted-foreground cursor-pointer px-0.5 text-xs opacity-50 hover:opacity-100" onclick={(e) => { e.stopPropagation(); copyGroupLines(group); }} title="Copy all lines">{copiedGroupId === group.id ? '\u2713' : '\u2398'}</button>
      <button class="bg-transparent border-none text-muted-foreground cursor-pointer px-0.5 text-xs opacity-50 hover:opacity-100" onclick={(e) => { e.stopPropagation(); onFocusGroup(group.lineIndices, group.rect); }} title="Zoom to group">&#x2316;</button>
      <button class="bg-transparent border-none text-muted-foreground cursor-pointer px-0.5 text-xs opacity-50 hover:opacity-100 hover:text-destructive disabled:opacity-20 disabled:cursor-not-allowed" onclick={(e) => { e.stopPropagation(); onDeleteGroup(group.id); }} title={groupWorking ? 'Cannot delete while transcribing' : 'Delete group'} disabled={groupWorking}>x</button>
    </div>
    {#if !group.collapsed}
      <div class="pl-1">
        {#each group.lineIndices as lineIdx}
          {@render lineRow(doc, lineIdx)}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet lineRow(doc: ImageDocument, lineIdx: number)}
  {#if doc.lines[lineIdx] && lineMatches(doc, lineIdx)}
    <div
      class="group/line flex items-baseline gap-2 px-2 py-1 rounded cursor-pointer transition-colors {lineIdx === hoveredLine ? 'bg-orange-500/[0.08]' : ''} {selectedLines.has(lineIdx) ? 'bg-yellow-400/[0.12] outline outline-1 outline-yellow-400/30' : ''}"
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
          {#each highlightText(doc.lines[lineIdx].text) as part}{part.before}{#if part.match}<mark class="bg-yellow-400/40 text-inherit rounded-sm px-px">{part.match}</mark>{/if}{part.after}{/each}{#if !doc.lines[lineIdx].complete && doc.lines[lineIdx].text}<span class="animate-pulse text-orange-500">|</span>{/if}
        </span>
        {#if doc.lines[lineIdx].complete}
          <span class="text-xs text-muted-foreground font-mono">{(doc.lines[lineIdx].confidence * 100).toFixed(0)}%</span>
          <button
            class="bg-transparent border-none text-muted-foreground cursor-pointer px-0.5 text-xs opacity-0 group-hover/line:opacity-50 hover:!opacity-100 transition-opacity"
            onclick={(e) => { e.stopPropagation(); copyLinePrompt(doc, lineIdx); }}
            title="Copy prompt text"
          >{copiedLineIdx === lineIdx ? '\u2713' : 'T'}</button>
          <button
            class="bg-transparent border-none text-muted-foreground cursor-pointer px-0.5 text-xs opacity-0 group-hover/line:opacity-50 hover:!opacity-100 transition-opacity"
            onclick={(e) => { e.stopPropagation(); copyLineImage(doc, lineIdx); }}
            title="Copy line image"
          >{copiedLineIdx === lineIdx ? '\u2713' : '\u{1F5BC}'}</button>
        {/if}
      {/if}
    </div>
  {/if}
{/snippet}
